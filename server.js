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
app.get(["/admin", "/admin/", "/adm"], (_req, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const ah = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ erro: "Erro interno" });
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
