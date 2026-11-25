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

const catalogVisibilityReady = db.query(
  "ALTER TABLE produtos ADD COLUMN IF NOT EXISTS visivel_catalogo BOOLEAN NOT NULL DEFAULT TRUE"
).catch((error) => {
  console.error("Não foi possível preparar a visibilidade do catálogo:", error.message);
  throw error;
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
app.get(["/admin/pdv", "/admin/pdv/"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "pdv.html"));
});
app.get(["/admin/estoque", "/admin/estoque/"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "estoque.html"));
});
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

const COLS = "nome,descricao,preco,preco_antigo,imagem_url,categoria,genero,variantes,tamanhos,em_estoque,destaque,visivel_catalogo";
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
    b.em_estoque !== false, !!b.destaque, b.visivel_catalogo !== false,
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
  ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS estoque_reservado BOOLEAN NOT NULL DEFAULT FALSE;
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
  await stockTablesReady;
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
    const encontrados = await client.query("SELECT id,nome,preco,variantes,tamanhos,em_estoque,visivel_catalogo FROM produtos WHERE id = ANY($1::int[]) FOR UPDATE", [ids]);
    const produtos = new Map(encontrados.rows.map((p) => [Number(p.id), p]));
    let subtotal = 0;
    const linhas = [];
    for (const item of normalizados) {
      const p = produtos.get(item.id);
      if (!p || !p.em_estoque || p.visivel_catalogo === false) {
        await client.query("ROLLBACK");
        return res.status(409).json({ erro: "Um produto não está mais disponível no catálogo. Atualize a página e confira a sacola." });
      }
      const variantes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : [{ cor: "Único" }];
      const tamanhos = Array.isArray(p.tamanhos) && p.tamanhos.length ? p.tamanhos : ["Único"];
      const corCanonica = variantes.map((v) => String(v.cor || "Único").trim()).find((v) => v.toLowerCase() === item.cor.toLowerCase());
      if (!corCanonica || !tamanhos.includes(item.tamanho)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ erro: "A cor ou o tamanho de um produto mudou. Atualize a página e tente novamente." });
      }
      const preco = valorMonetario(p.preco);
      if (preco === null) throw new Error("Preço inválido cadastrado no produto " + p.id);
      const linhaSubtotal = Math.round(preco * item.quantidade * 100) / 100;
      subtotal += linhaSubtotal;
      linhas.push({ ...item, cor: corCanonica, nome: p.nome, preco, subtotal: linhaSubtotal });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    if (precisaTroco && trocoPara <= subtotal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "O valor informado para troco precisa ser maior que o total." });
    }

    // Reserva cada combinação de cor e tamanho na mesma transação do pedido.
    const codigo = "LB-" + Date.now().toString(36).toUpperCase() + "-" + require("crypto").randomBytes(3).toString("hex").toUpperCase();
    for (const item of linhas) {
      const baixa = await client.query(
        "UPDATE estoque_variantes SET quantidade=quantidade-$4,atualizado_em=now() WHERE produto_id=$1 AND lower(cor)=lower($2) AND tamanho=$3 AND quantidade >= $4 RETURNING quantidade,cor",
        [item.id,item.cor,item.tamanho,item.quantidade]
      );
      if (!baixa.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ erro: "Estoque insuficiente para "+item.nome+" ("+item.cor+" / "+item.tamanho+"). Atualize a sacola." });
      }
      const nova = Number(baixa.rows[0].quantidade);
      await client.query(
        "INSERT INTO movimentacoes_estoque(produto_id,produto_nome,cor,tamanho,tipo,quantidade,quantidade_anterior,quantidade_nova,observacao) VALUES($1,$2,$3,$4,'saida',$5,$6,$7,$8)",
        [item.id,item.nome,item.cor,item.tamanho,item.quantidade,nova+item.quantidade,nova,"Reserva do pedido "+codigo]
      );
    }

    const pedido = await client.query(
      "INSERT INTO pedidos(codigo,cliente_nome,endereco_entrega,forma_pagamento,precisa_troco,troco_para,subtotal,total,estoque_reservado) VALUES($1,$2,$3,$4,$5,$6,$7,$7,TRUE) RETURNING id,codigo,status,subtotal,total,criado_em",
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


// Venda presencial pelo PDV: autenticação obrigatória, preço e estoque sempre conferidos no banco.
app.post("/api/admin/pdv/venda", auth, ah(async (req, res) => {
  await ordersTableReady;
  await stockTablesReady;
  const body = req.body || {};
  const nome = String(body.nome || "Cliente balcão").trim().slice(0,120) || "Cliente balcão";
  const pagamento = String(body.pagamento || "");
  const itensRecebidos = Array.isArray(body.itens) ? body.itens : [];
  if (!["Pix","Cartão","Dinheiro"].includes(pagamento)) return res.status(400).json({ erro: "Forma de pagamento inválida." });
  if (!itensRecebidos.length || itensRecebidos.length > 50) return res.status(400).json({ erro: "Adicione produtos à venda." });
  const mapa = new Map();
  for (const item of itensRecebidos) {
    const id=Number(item.id), quantidade=Number(item.q), cor=String(item.c||"").trim(), tamanho=String(item.z||"").trim();
    if (!Number.isSafeInteger(id)||id<1||!Number.isInteger(quantidade)||quantidade<1||quantidade>100||!cor||cor.length>60||!tamanho||tamanho.length>30) return res.status(400).json({ erro: "Confira os produtos, variações e quantidades." });
    const key=[id,cor.toLowerCase(),tamanho.toLowerCase()].join("|");
    const atual=mapa.get(key);
    if (atual) atual.quantidade+=quantidade; else mapa.set(key,{id,quantidade,cor,tamanho});
  }
  const linhasSolicitadas=[...mapa.values()];
  if (linhasSolicitadas.some(i=>i.quantidade>100)) return res.status(400).json({ erro: "Quantidade máxima por variação: 100." });
  const precisaTroco=pagamento==="Dinheiro" && body.precisa_troco===true;
  const trocoPara=precisaTroco?valorMonetario(body.troco_para):null;
  if (pagamento!=="Dinheiro" && (body.precisa_troco===true || body.troco_para!=null)) return res.status(400).json({ erro: "Troco só pode ser informado para dinheiro." });
  if (precisaTroco && trocoPara===null) return res.status(400).json({ erro: "Informe um valor válido para o troco." });
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    const ids=[...new Set(linhasSolicitadas.map(i=>i.id))].sort((a,b)=>a-b);
    const encontrados=await client.query("SELECT id,nome,preco,variantes,tamanhos,em_estoque FROM produtos WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",[ids]);
    const produtos=new Map(encontrados.rows.map(p=>[Number(p.id),p]));
    const linhas=[]; let total=0;
    for (const item of linhasSolicitadas) {
      const p=produtos.get(item.id);
      if (!p || !p.em_estoque) { await client.query("ROLLBACK"); return res.status(409).json({ erro: "Um produto foi desativado ou não existe mais." }); }
      const variantes=Array.isArray(p.variantes)&&p.variantes.length?p.variantes:[{cor:"Único"}];
      const tamanhos=Array.isArray(p.tamanhos)&&p.tamanhos.length?p.tamanhos:["Único"];
      const cor=variantes.map(v=>String(v.cor||"Único").trim()).find(v=>v.toLowerCase()===item.cor.toLowerCase());
      if (!cor || !tamanhos.includes(item.tamanho)) { await client.query("ROLLBACK"); return res.status(409).json({ erro: "Uma variação do produto não está mais disponível." }); }
      const preco=valorMonetario(p.preco);
      if (preco===null) throw new Error("Preço inválido no produto "+p.id);
      const subtotal=Math.round(preco*item.quantidade*100)/100;
      total=Math.round((total+subtotal)*100)/100;
      linhas.push({...item,cor,nome:p.nome,preco,subtotal});
    }
    if (precisaTroco && trocoPara<=total) { await client.query("ROLLBACK"); return res.status(400).json({ erro: "O valor recebido deve ser maior que o total da venda." }); }
    const codigo="LB-PDV-"+Date.now().toString(36).toUpperCase()+"-"+require("crypto").randomBytes(2).toString("hex").toUpperCase();
    for (const item of linhas) {
      const baixa=await client.query("UPDATE estoque_variantes SET quantidade=quantidade-$4,atualizado_em=now() WHERE produto_id=$1 AND lower(cor)=lower($2) AND tamanho=$3 AND quantidade >= $4 RETURNING quantidade",[item.id,item.cor,item.tamanho,item.quantidade]);
      if (!baixa.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ erro: "Estoque insuficiente: "+item.nome+" · "+item.cor+" · "+item.tamanho }); }
      const nova=Number(baixa.rows[0].quantidade);
      await client.query("INSERT INTO movimentacoes_estoque(produto_id,produto_nome,cor,tamanho,tipo,quantidade,quantidade_anterior,quantidade_nova,observacao) VALUES($1,$2,$3,$4,'saida',$5,$6,$7,$8)",[item.id,item.nome,item.cor,item.tamanho,item.quantidade,nova+item.quantidade,nova,"Venda PDV "+codigo]);
    }
    const pedido=await client.query("INSERT INTO pedidos(codigo,cliente_nome,endereco_entrega,forma_pagamento,precisa_troco,troco_para,subtotal,total,status,origem,estoque_reservado,confirmado_em) VALUES($1,$2,'Venda presencial',$3,$4,$5,$6,$6,'confirmado','pdv',FALSE,now()) RETURNING id,codigo,status,subtotal,total,criado_em",[codigo,nome,pagamento,precisaTroco,trocoPara,total]);
    for (const item of linhas) await client.query("INSERT INTO pedido_itens(pedido_id,produto_id,produto_nome,cor,tamanho,quantidade,preco_unitario,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[pedido.rows[0].id,item.id,item.nome,item.cor,item.tamanho,item.quantidade,item.preco,item.subtotal]);
    await client.query("COMMIT");
    res.status(201).json({...pedido.rows[0],forma_pagamento:pagamento,cliente_nome:nome});
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
  finally { client.release(); }
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
  await stockTablesReady;
  const status = String(req.body?.status || "");
  const id = Number(req.params.id);
  if (!["confirmado", "cancelado"].includes(status) || !Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ erro: "Status ou pedido inválido." });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM pedidos WHERE id=$1 FOR UPDATE", [id]);
    const pedido = found.rows[0];
    if (!pedido || pedido.status !== "pendente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ erro: "Pedido não encontrado ou já finalizado." });
    }
    if (status === "cancelado" && pedido.estoque_reservado) {
      const itens = await client.query("SELECT produto_id,produto_nome,cor,tamanho,quantidade FROM pedido_itens WHERE pedido_id=$1", [id]);
      for (const item of itens.rows) {
        if (!item.produto_id) continue;
        const atual = await client.query(
          "INSERT INTO estoque_variantes(produto_id,cor,tamanho,quantidade,atualizado_em) VALUES($1,$2,$3,$4,now()) ON CONFLICT(produto_id,cor,tamanho) DO UPDATE SET quantidade=estoque_variantes.quantidade+EXCLUDED.quantidade,atualizado_em=now() RETURNING quantidade",
          [item.produto_id,item.cor,item.tamanho,item.quantidade]
        );
        const nova = Number(atual.rows[0].quantidade);
        await client.query(
          "INSERT INTO movimentacoes_estoque(produto_id,produto_nome,cor,tamanho,tipo,quantidade,quantidade_anterior,quantidade_nova,observacao) VALUES($1,$2,$3,$4,'entrada',$5,$6,$7,$8)",
          [item.produto_id,item.produto_nome,item.cor,item.tamanho,item.quantidade,nova-item.quantidade,nova,"Liberação de reserva do pedido "+pedido.codigo]
        );
      }
    }
    const result = await client.query(
      "UPDATE pedidos SET status=$1,estoque_reservado=FALSE,atualizado_em=now(),confirmado_em=CASE WHEN $1='confirmado' THEN now() ELSE confirmado_em END,cancelado_em=CASE WHEN $1='cancelado' THEN now() ELSE cancelado_em END WHERE id=$2 RETURNING *",
      [status,id]
    );
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));


// Estoque detalhado por produto, cor e tamanho. Mantém o campo legado em_estoque para compatibilidade.
const stockTablesReady = db.query(`
  CREATE TABLE IF NOT EXISTS estoque_variantes (
    id BIGSERIAL PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    cor VARCHAR(60) NOT NULL,
    tamanho VARCHAR(30) NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (produto_id, cor, tamanho)
  );
  CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id BIGSERIAL PRIMARY KEY,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
    produto_nome VARCHAR(120) NOT NULL,
    cor VARCHAR(60) NOT NULL,
    tamanho VARCHAR(30) NOT NULL,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    quantidade_anterior INTEGER NOT NULL CHECK (quantidade_anterior >= 0),
    quantidade_nova INTEGER NOT NULL CHECK (quantidade_nova >= 0),
    observacao VARCHAR(240),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_estoque_produto ON estoque_variantes(produto_id);
  CREATE INDEX IF NOT EXISTS idx_mov_estoque_criado ON movimentacoes_estoque(criado_em DESC);
`).then(() => true).catch((error) => {
  console.error("Não foi possível preparar as tabelas de estoque:", error.message);
  throw error;
});

// Consulta todas as combinações cadastradas e sua quantidade atual.
app.get("/api/admin/estoque", auth, ah(async (_req, res) => {
  await stockTablesReady;
  const result = await db.query(`
    SELECT p.id AS produto_id, p.nome AS produto_nome, p.preco,
      COALESCE(v.cor, 'Único') AS cor,
      COALESCE(t.tamanho, 'Único') AS tamanho,
      COALESCE(e.quantidade, 0) AS quantidade,
      e.atualizado_em
    FROM produtos p
    CROSS JOIN LATERAL (
      SELECT COALESCE(NULLIF(btrim(x->>'cor'), ''), 'Único') AS cor
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.variantes)='array' AND jsonb_array_length(p.variantes)>0
          THEN p.variantes ELSE '[{"cor":"Único"}]'::jsonb END
      ) x
    ) v
    CROSS JOIN LATERAL (
      SELECT unnest(CASE WHEN cardinality(p.tamanhos)>0 THEN p.tamanhos ELSE ARRAY['Único']::text[] END) AS tamanho
    ) t
    LEFT JOIN estoque_variantes e
      ON e.produto_id=p.id AND lower(e.cor)=lower(v.cor) AND e.tamanho=t.tamanho
    ORDER BY p.nome, v.cor, t.tamanho
  `);
  res.json(result.rows);
}));

// Registra entrada, saída ou ajuste absoluto e grava o histórico na mesma transação.
app.post("/api/admin/estoque/movimentacoes", auth, ah(async (req, res) => {
  await stockTablesReady;
  const produtoId = Number(req.body?.produto_id);
  const cor = String(req.body?.cor || "").trim();
  const tamanho = String(req.body?.tamanho || "").trim();
  const tipo = String(req.body?.tipo || "");
  const quantidade = Number(req.body?.quantidade);
  const observacao = String(req.body?.observacao || "").trim().slice(0, 240);
  if (!Number.isSafeInteger(produtoId) || produtoId < 1 || !cor || cor.length > 60 || !tamanho || tamanho.length > 30 ||
      !["entrada","saida","ajuste"].includes(tipo) || !Number.isInteger(quantidade) || quantidade < 0 || quantidade > 100000) {
    return res.status(400).json({ erro: "Confira produto, cor, tamanho, tipo e quantidade." });
  }
  if (tipo !== "ajuste" && quantidade < 1) return res.status(400).json({ erro: "Entrada e saída precisam ser maiores que zero." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const pr = await client.query("SELECT id,nome,variantes,tamanhos FROM produtos WHERE id=$1 FOR UPDATE", [produtoId]);
    const p = pr.rows[0];
    if (!p) { await client.query("ROLLBACK"); return res.status(404).json({ erro: "Produto não encontrado." }); }
    const variantes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : [{cor:"Único"}];
    const tamanhos = Array.isArray(p.tamanhos) && p.tamanhos.length ? p.tamanhos : ["Único"];
    const corCanonica = variantes.map(v => String(v.cor || "Único").trim()).find(v => v.toLowerCase() === cor.toLowerCase());
    if (!corCanonica || !tamanhos.includes(tamanho)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "A cor ou o tamanho não pertence a esse produto." });
    }
    const existing = await client.query(
      "SELECT quantidade FROM estoque_variantes WHERE produto_id=$1 AND cor=$2 AND tamanho=$3 FOR UPDATE",
      [produtoId,corCanonica,tamanho]
    );
    const anterior = existing.rows[0] ? Number(existing.rows[0].quantidade) : 0;
    const nova = tipo === "entrada" ? anterior + quantidade : tipo === "saida" ? anterior - quantidade : quantidade;
    if (nova < 0) { await client.query("ROLLBACK"); return res.status(409).json({ erro: "Estoque insuficiente para essa saída." }); }
    await client.query(`
      INSERT INTO estoque_variantes(produto_id,cor,tamanho,quantidade,atualizado_em)
      VALUES($1,$2,$3,$4,now())
      ON CONFLICT(produto_id,cor,tamanho)
      DO UPDATE SET quantidade=EXCLUDED.quantidade,atualizado_em=now()
    `, [produtoId,corCanonica,tamanho,nova]);
    const mov = await client.query(`
      INSERT INTO movimentacoes_estoque(produto_id,produto_nome,cor,tamanho,tipo,quantidade,quantidade_anterior,quantidade_nova,observacao)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [produtoId,p.nome,corCanonica,tamanho,tipo,quantidade,anterior,nova,observacao || null]);
    await client.query("COMMIT");
    res.status(201).json(mov.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

app.get("/api/admin/estoque/movimentacoes", auth, ah(async (req, res) => {
  await stockTablesReady;
  const result = await db.query(
    "SELECT * FROM movimentacoes_estoque ORDER BY criado_em DESC,id DESC LIMIT 300"
  );
  res.json(result.rows);
}));

// Produtos e estoque: a rota administrativa inclui itens ocultos; a pública mostra apenas itens visíveis.
const productRowsSql = `
  SELECT p.*,
    COALESCE(s.variantes, '[]'::json) AS estoque_variantes
  FROM produtos p
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'cor', e.cor, 'tamanho', e.tamanho, 'quantidade', e.quantidade
    )) AS variantes
    FROM estoque_variantes e
    WHERE e.produto_id = p.id
  ) s ON TRUE
`;

app.get("/api/admin/produtos", auth, ah(async (_req, res) => {
  await catalogVisibilityReady;
  await stockTablesReady;
  const result = await db.query(productRowsSql + " ORDER BY p.id");
  res.set("Cache-Control", "no-store");
  res.json(result.rows);
}));

app.get("/api/produtos", ah(async (_req, res) => {
  await catalogVisibilityReady;
  await stockTablesReady;
  const result = await db.query(productRowsSql + " WHERE p.visivel_catalogo IS TRUE ORDER BY p.id");
  res.set("Cache-Control", "no-store");
  res.json(result.rows);
}));

// Operações de produtos protegidas por token de administrador
app.post("/api/produtos", auth, ah(async (req, res) => {
  await catalogVisibilityReady;
  const v = campos(req.body || {});
  if (!v) return res.status(400).json({ erro: "Nome e preço válido são obrigatórios" });
  const placeholders = v.map((_, i) => "$" + (i + 1)).join(",");
  const result = await db.query(
    `INSERT INTO produtos(${COLS}) VALUES(${placeholders}) RETURNING *`, v
  );
  res.status(201).json(result.rows[0]);
}));

app.put("/api/produtos/:id", auth, ah(async (req, res) => {
  await catalogVisibilityReady;
  const v = campos(req.body || {});
  if (!v) return res.status(400).json({ erro: "Nome e preço válido são obrigatórios" });
  const sets = COLS.split(",").map((c, i) => `${c}=${i + 1}`).join(",");
  const result = await db.query(
    `UPDATE produtos SET ${sets}, data_atualizacao=now() WHERE id=$13 RETURNING *`,
    [...v, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ erro: "Produto não encontrado" });
  res.json(result.rows[0]);
}));

app.patch("/api/admin/produtos/:id/catalogo", auth, ah(async (req, res) => {
  await catalogVisibilityReady;
  const visible = req.body?.visivel_catalogo === true;
  const result = await db.query(
    "UPDATE produtos SET visivel_catalogo=$1, data_atualizacao=now() WHERE id=$2 RETURNING id,visivel_catalogo",
    [visible, Number(req.params.id)]
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
