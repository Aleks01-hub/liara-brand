require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

app.use(express.json({ limit: "6mb" }));

// Health check real: confirma que a aplicação e o banco respondem.
app.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check do banco falhou:", error.message);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

// Painel administrativo: o arquivo fica fora da pasta pública.
app.get(["/admin/pedidos", "/admin/pedidos/"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "pedidos.html"));
});
app.get(["/admin/cupons", "/admin/cupons/"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "cupons.html"));
});
app.get(["/admin", "/admin/", "/adm"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const ah = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(e.code === "23505" ? 409 : 500).json({ erro: e.code === "23505" ? "Já existe um cupom com esse código." : "Erro interno" });
  });

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ erro: "Autenticação não configurada no servidor" });
  }
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: "Não autorizado" });
  }
}

const COLS = "nome,descricao,preco,preco_antigo,imagem_url,categoria,genero,variantes,tamanhos,em_estoque,destaque";
function campos(b) {
  const preco = Number(b.preco);
  if (!b.nome || !String(b.nome).trim() || b.preco === "" || b.preco == null || !Number.isFinite(preco) || preco < 0) return null;
  const antigo = Number(b.preco_antigo);
  return [
    String(b.nome).trim(), String(b.descricao || ""), preco,
    Number.isFinite(antigo) && antigo > preco ? antigo : null,
    b.imagem_url || null, b.categoria || "Outros",
    b.genero === "Masculino" ? "Masculino" : "Feminino",
    JSON.stringify(Array.isArray(b.variantes) ? b.variantes : []),
    Array.isArray(b.tamanhos) ? b.tamanhos : [],
    b.em_estoque !== false, !!b.destaque,
  ];
}

// Login do administrador. Configure todas as credenciais nas variáveis de ambiente.
app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.JWT_SECRET) {
    return res.status(503).json({ erro: "Login não configurado no servidor" });
  }
  if (usuario !== process.env.ADMIN_USER || senha !== process.env.ADMIN_PASS) {
    return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  }
  return res.json({
    token: jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "12h" }),
  });
});

const couponTableReady = db.query(`
  CREATE TABLE IF NOT EXISTS cupons (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    tipo_desconto VARCHAR(10) NOT NULL CHECK (tipo_desconto IN ('percentual','fixo')),
    valor_desconto NUMERIC(10,2) NOT NULL CHECK (valor_desconto > 0),
    valor_minimo NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (valor_minimo >= 0),
    data_inicio DATE,
    data_fim DATE,
    limite_usos INTEGER CHECK (limite_usos IS NULL OR limite_usos > 0),
    usos INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (data_inicio IS NULL OR data_fim IS NULL OR data_fim >= data_inicio),
    CHECK (tipo_desconto <> 'percentual' OR valor_desconto <= 100)
  )
`).then(() => db.query("CREATE INDEX IF NOT EXISTS idx_cupons_ativo_validade ON cupons (ativo, data_inicio, data_fim)"))
  .catch((error) => { console.error("Não foi possível preparar a tabela cupons:", error.message); throw error; });

function normalizarCupom(body) {
  const codigo = String(body.codigo || "").trim().toUpperCase().replace(/\s+/g, "");
  const tipo = body.tipo_desconto === "fixo" ? "fixo" : body.tipo_desconto === "percentual" ? "percentual" : "";
  const valor = Number(body.valor_desconto);
  const minimo = body.valor_minimo === "" || body.valor_minimo == null ? 0 : Number(body.valor_minimo);
  const limite = body.limite_usos === "" || body.limite_usos == null ? null : Number(body.limite_usos);
  const inicio = body.data_inicio || null;
  const fim = body.data_fim || null;
  const dataValida = (v) => !v || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")));
  if (!/^[A-Z0-9_-]{3,40}$/.test(codigo)) return { erro: "Use um código de 3 a 40 caracteres: letras, números, hífen ou underline." };
  if (!tipo || !Number.isFinite(valor) || valor <= 0 || (tipo === "percentual" && valor > 100)) return { erro: "Informe um desconto válido." };
  if (!Number.isFinite(minimo) || minimo < 0) return { erro: "O valor mínimo do pedido é inválido." };
  if (limite !== null && (!Number.isInteger(limite) || limite < 1)) return { erro: "O limite de usos deve ser um número inteiro positivo." };
  if (!dataValida(inicio) || !dataValida(fim) || (inicio && fim && fim < inicio)) return { erro: "Confira as datas de validade do cupom." };
  return { valores: [codigo, tipo, valor, minimo, inicio, fim, limite, body.ativo !== false] };
}

// Gerenciamento administrativo de cupons. A validação pública será ativada junto ao checkout.
app.get("/api/admin/cupons", auth, ah(async (_req, res) => {
  await couponTableReady;
  const result = await db.query("SELECT * FROM cupons ORDER BY criado_em DESC, id DESC");
  res.json(result.rows);
}));

app.post("/api/admin/cupons", auth, ah(async (req, res) => {
  await couponTableReady;
  const v = normalizarCupom(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const result = await db.query(
    "INSERT INTO cupons(codigo,tipo_desconto,valor_desconto,valor_minimo,data_inicio,data_fim,limite_usos,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    v.valores
  );
  res.status(201).json(result.rows[0]);
}));

app.put("/api/admin/cupons/:id", auth, ah(async (req, res) => {
  await couponTableReady;
  const v = normalizarCupom(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const result = await db.query(
    "UPDATE cupons SET codigo=$1,tipo_desconto=$2,valor_desconto=$3,valor_minimo=$4,data_inicio=$5,data_fim=$6,limite_usos=$7,ativo=$8,atualizado_em=now() WHERE id=$9 RETURNING *",
    [...v.valores, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ erro: "Cupom não encontrado." });
  res.json(result.rows[0]);
}));

app.patch("/api/admin/cupons/:id/status", auth, ah(async (req, res) => {
  await couponTableReady;
  const result = await db.query("UPDATE cupons SET ativo=$1,atualizado_em=now() WHERE id=$2 RETURNING *", [req.body?.ativo === true, Number(req.params.id)]);
  if (!result.rows[0]) return res.status(404).json({ erro: "Cupom não encontrado." });
  res.json(result.rows[0]);
}));

app.delete("/api/admin/cupons/:id", auth, ah(async (req, res) => {
  await couponTableReady;
  const result = await db.query("DELETE FROM cupons WHERE id=$1", [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ erro: "Cupom não encontrado." });
  res.json({ ok: true });
}));


// Estrutura inicial de pedidos: o catálogo registra o pedido antes de abrir o WhatsApp.
const ordersTableReady = couponTableReady.then(() => db.query(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(32) NOT NULL UNIQUE,
    cliente_nome VARCHAR(120) NOT NULL,
    endereco_entrega TEXT NOT NULL,
    forma_pagamento VARCHAR(20) NOT NULL CHECK (forma_pagamento IN ('Pix','Cartão','Dinheiro')),
    precisa_troco BOOLEAN NOT NULL DEFAULT FALSE,
    troco_para NUMERIC(10,2),
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    desconto NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
    total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
    cupom_id BIGINT REFERENCES cupons(id) ON DELETE SET NULL,
    cupom_codigo VARCHAR(40),
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','cancelado')),
    origem VARCHAR(20) NOT NULL DEFAULT 'catalogo' CHECK (origem IN ('catalogo','pdv')),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmado_em TIMESTAMPTZ,
    cancelado_em TIMESTAMPTZ,
    CHECK ((precisa_troco = FALSE AND troco_para IS NULL) OR (precisa_troco = TRUE AND forma_pagamento = 'Dinheiro' AND troco_para > total))
  );
  CREATE INDEX IF NOT EXISTS idx_pedidos_status_criado ON pedidos(status, criado_em DESC);
  CREATE INDEX IF NOT EXISTS idx_pedidos_codigo ON pedidos(codigo);
  CREATE TABLE IF NOT EXISTS pedido_itens (
    id BIGSERIAL PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
    produto_nome VARCHAR(120) NOT NULL,
    cor VARCHAR(60) NOT NULL,
    tamanho VARCHAR(30) NOT NULL,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);
`)).then(() => true).catch((error) => {
  console.error("Não foi possível preparar as tabelas de pedidos:", error.message);
  throw error;
});

function valorMonetario(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

// Cria pedido pendente usando preço e disponibilidade consultados no banco, nunca os valores enviados pelo navegador.
app.post("/api/pedidos", ah(async (req, res) => {
  await ordersTableReady;
  const body = req.body || {};
  const nome = String(body.nome || "").trim();
  const endereco = String(body.endereco || "").trim();
  const pagamento = String(body.pagamento || "");
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!nome || nome.length > 120 || !endereco || endereco.length > 1000) {
    return res.status(400).json({ erro: "Informe nome e endereço válidos." });
  }
  if (!["Pix", "Cartão", "Dinheiro"].includes(pagamento)) {
    return res.status(400).json({ erro: "Forma de pagamento inválida." });
  }
  if (!itens.length || itens.length > 50) return res.status(400).json({ erro: "A sacola está vazia ou possui itens demais." });
  const normalizados = [];
  for (const item of itens) {
    const id = Number(item.id), quantidade = Number(item.q);
    const cor = String(item.c || "").trim(), tamanho = String(item.z || "").trim();
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50 || !cor || cor.length > 60 || !tamanho || tamanho.length > 30) {
      return res.status(400).json({ erro: "Há um item inválido na sacola. Confira cor, tamanho e quantidade." });
    }
    normalizados.push({ id, quantidade, cor, tamanho });
  }
  const precisaTroco = pagamento === "Dinheiro" && body.precisa_troco === true;
  const trocoPara = precisaTroco ? valorMonetario(body.troco_para) : null;
  if (pagamento !== "Dinheiro" && (body.precisa_troco === true || body.troco_para != null)) {
    return res.status(400).json({ erro: "Troco só pode ser informado para pagamento em dinheiro." });
  }
  if (precisaTroco && trocoPara === null) return res.status(400).json({ erro: "Valor de troco inválido." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ids = [...new Set(normalizados.map((i) => i.id))];
    const encontrados = await client.query("SELECT id,nome,preco,variantes,tamanhos,em_estoque FROM produtos WHERE id = ANY($1::int[]) FOR SHARE", [ids]);
    const produtos = new Map(encontrados.rows.map((p) => [Number(p.id), p]));
    let subtotal = 0;
    const linhas = [];
    for (const item of normalizados) {
      const p = produtos.get(item.id);
      if (!p || !p.em_estoque) {
        await client.query("ROLLBACK");
        return res.status(409).json({ erro: "Um produto não está mais disponível. Atualize a página e confira a sacola." });
      }
      const variantes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : [{ cor: "Único" }];
      const tamanhos = Array.isArray(p.tamanhos) && p.tamanhos.length ? p.tamanhos : ["Único"];
      if (!variantes.some((v) => String(v.cor || "").trim().toLowerCase() === item.cor.toLowerCase()) || !tamanhos.includes(item.tamanho)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ erro: "A cor ou o tamanho de um produto mudou. Atualize a página e tente novamente." });
      }
      const preco = valorMonetario(p.preco);
      if (preco === null) throw new Error("Preço inválido cadastrado no produto " + p.id);
      const linhaSubtotal = Math.round(preco * item.quantidade * 100) / 100;
      subtotal += linhaSubtotal;
      linhas.push({ ...item, nome: p.nome, preco, subtotal: linhaSubtotal });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    if (precisaTroco && trocoPara <= subtotal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "O valor informado para troco precisa ser maior que o total." });
    }
    const codigo = "LB-" + Date.now().toString(36).toUpperCase() + "-" + require("crypto").randomBytes(3).toString("hex").toUpperCase();
    const pedido = await client.query(
      "INSERT INTO pedidos(codigo,cliente_nome,endereco_entrega,forma_pagamento,precisa_troco,troco_para,subtotal,total) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,codigo,status,subtotal,total,criado_em",
      [codigo,nome,endereco,pagamento,precisaTroco,trocoPara,subtotal]
    );
    for (const item of linhas) {
      await client.query(
        "INSERT INTO pedido_itens(pedido_id,produto_id,produto_nome,cor,tamanho,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [pedido.rows[0].id,item.id,item.nome,item.cor,item.tamanho,item.quantidade,item.preco,item.subtotal]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ ...pedido.rows[0], pagamento, precisa_troco: precisaTroco, troco_para: trocoPara });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

// Consulta administrativa de pedidos e seus itens.
app.get("/api/admin/pedidos", auth, ah(async (_req, res) => {
  await ordersTableReady;
  const result = await db.query(`
    SELECT p.*,
      COALESCE(json_agg(json_build_object(
        'produto_id', i.produto_id, 'nome', i.produto_nome, 'cor', i.cor,
        'tamanho', i.tamanho, 'quantidade', i.quantidade,
        'preco_unitario', i.preco_unitario, 'subtotal', i.subtotal
      )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS itens
    FROM pedidos p
    LEFT JOIN pedido_itens i ON i.pedido_id = p.id
    GROUP BY p.id
    ORDER BY p.criado_em DESC, p.id DESC
    LIMIT 200
  `);
  res.json(result.rows);
}));

// O pedido só pode sair de pendente uma vez; confirmado/cancelado são estados finais nesta primeira versão.
app.patch("/api/admin/pedidos/:id/status", auth, ah(async (req, res) => {
  await ordersTableReady;
  const status = String(req.body?.status || "");
  if (!["confirmado", "cancelado"].includes(status)) return res.status(400).json({ erro: "Status inválido." });
  const result = await db.query(
    "UPDATE pedidos SET status=$1,atualizado_em=now(),confirmado_em=CASE WHEN $1='confirmado' THEN now() ELSE confirmado_em END,cancelado_em=CASE WHEN $1='cancelado' THEN now() ELSE cancelado_em END WHERE id=$2 AND status='pendente' RETURNING *",
    [status, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(409).json({ erro: "Pedido não encontrado ou já finalizado." });
  res.json(result.rows[0]);
}));

// Catálogo público
app.get("/api/produtos", ah(async (_req, res) => {
  const result = await db.query("SELECT * FROM produtos ORDER BY id");
  res.set("Cache-Control", "no-store");
  res.json(result.rows);
}));

// Operações de produtos protegidas por token de administrador
app.post("/api/produtos", auth, ah(async (req, res) => {
  const v = campos(req.body || {});
  if (!v) return res.status(400).json({ erro: "Nome e preço válido são obrigatórios" });
  const result = await db.query(
    `INSERT INTO produtos(${COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, v
  );
  res.status(201).json(result.rows[0]);
}));

app.put("/api/produtos/:id", auth, ah(async (req, res) => {
  const v = campos(req.body || {});
  if (!v) return res.status(400).json({ erro: "Nome e preço válido são obrigatórios" });
  const sets = COLS.split(",").map((c, i) => `${c}=$${i + 1}`).join(",");
  const result = await db.query(
    `UPDATE produtos SET ${sets}, data_atualizacao=now() WHERE id=$12 RETURNING *`,
    [...v, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ erro: "Produto não encontrado" });
  res.json(result.rows[0]);
}));

app.patch("/api/produtos/:id/estoque", auth, ah(async (req, res) => {
  const result = await db.query(
    "UPDATE produtos SET em_estoque=$1, data_atualizacao=now() WHERE id=$2 RETURNING *",
    [req.body?.em_estoque === true, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ erro: "Produto não encontrado" });
  res.json(result.rows[0]);
}));

app.delete("/api/produtos/:id", auth, ah(async (req, res) => {
  const result = await db.query("DELETE FROM produtos WHERE id=$1", [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ erro: "Produto não encontrado" });
  res.json({ ok: true });
}));

// Imagens enviadas pelo painel são armazenadas no PostgreSQL.
db.query(`CREATE TABLE IF NOT EXISTS imagens (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL,
  dados BYTEA NOT NULL,
  criado TIMESTAMPTZ NOT NULL DEFAULT now()
)`).catch((error) => console.error("Não foi possível preparar a tabela imagens:", error.message));

app.post("/api/imagens", auth, ah(async (req, res) => {
  const data = req.body?.dados || "";
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) return res.status(400).json({ erro: "Envie uma imagem JPG, PNG ou WebP válida" });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
    return res.status(413).json({ erro: "A imagem deve ter até 3 MB" });
  }
  const result = await db.query(
    "INSERT INTO imagens(tipo,dados) VALUES($1,$2) RETURNING id",
    [match[1], buffer]
  );
  res.status(201).json({ url: "/api/imagens/" + result.rows[0].id });
}));

app.get("/api/imagens/:id", ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).end();
  const result = await db.query("SELECT tipo,dados FROM imagens WHERE id=$1", [id]);
  if (!result.rows[0]) return res.status(404).end();
  res.set({
    "Content-Type": result.rows[0].tipo,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(result.rows[0].dados);
}));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`LIARA BRAND no ar na porta ${port}`));
