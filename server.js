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
app.get("/health", (_q, res) => res.send("ok"));
// Painel do dono: abre só em /admin (ou /adm). O arquivo fica fora da pasta public.
app.get(["/admin", "/admin/", "/adm"], (_q, res) => {
  res.set("X-Robots-Tag", "noindex");
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const ah = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ erro: "Erro interno" }); });

function auth(req, res, next) {
  try {
    jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ erro: "Não autorizado" }); }
}

const COLS = "nome,descricao,preco,preco_antigo,imagem_url,categoria,genero,variantes,tamanhos,em_estoque,destaque";
function campos(b) {
  const preco = Number(b.preco);
  if (!b.nome || !String(b.nome).trim() || !(preco >= 0)) return null;
  const antigo = Number(b.preco_antigo);
  return [
    String(b.nome).trim(), b.descricao || "", preco, antigo > 0 ? antigo : null,
    b.imagem_url || null, b.categoria || "Outros", b.genero === "Masculino" ? "Masculino" : "Feminino",
    JSON.stringify(Array.isArray(b.variantes) ? b.variantes : []),
    Array.isArray(b.tamanhos) ? b.tamanhos : [], b.em_estoque !== false, !!b.destaque,
  ];
}

// Login do admin (usuário/senha ficam no .env)
app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  if (usuario === process.env.ADMIN_USER && senha === process.env.ADMIN_PASS)
    return res.json({ token: jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "12h" }) });
  res.status(401).json({ erro: "Usuário ou senha inválidos" });
});

// Público: lista de produtos
app.get("/api/produtos", ah(async (_q, res) => {
  res.json((await db.query("SELECT * FROM produtos ORDER BY id")).rows);
}));

// Admin: criar, editar, trocar estoque, excluir
app.post("/api/produtos", auth, ah(async (req, res) => {
  const v = campos(req.body);
  if (!v) return res.status(400).json({ erro: "Nome e preço são obrigatórios" });
  const r = await db.query(`INSERT INTO produtos(${COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, v);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/produtos/:id", auth, ah(async (req, res) => {
  const v = campos(req.body);
  if (!v) return res.status(400).json({ erro: "Nome e preço são obrigatórios" });
  const sets = COLS.split(",").map((c, i) => `${c}=$${i + 1}`).join(",");
  const r = await db.query(`UPDATE produtos SET ${sets}, data_atualizacao=now() WHERE id=$12 RETURNING *`, [...v, req.params.id]);
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ erro: "Produto não encontrado" });
}));
app.patch("/api/produtos/:id/estoque", auth, ah(async (req, res) => {
  const r = await db.query("UPDATE produtos SET em_estoque=$1, data_atualizacao=now() WHERE id=$2 RETURNING *", [!!req.body.em_estoque, req.params.id]);
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ erro: "Produto não encontrado" });
}));
app.delete("/api/produtos/:id", auth, ah(async (req, res) => {
  const r = await db.query("DELETE FROM produtos WHERE id=$1", [req.params.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ erro: "Produto não encontrado" });
}));

// Fotos enviadas pelo painel ficam no próprio banco (não somem quando o servidor reinicia)
db.query("CREATE TABLE IF NOT EXISTS imagens(id SERIAL PRIMARY KEY, tipo VARCHAR(20) NOT NULL, dados BYTEA NOT NULL, criado TIMESTAMPTZ NOT NULL DEFAULT now())").catch(console.error);
app.post("/api/imagens", auth, ah(async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec((req.body && req.body.dados) || "");
  if (!m) return res.status(400).json({ erro: "Envie uma imagem JPG, PNG ou WebP" });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ erro: "Imagem muito grande (máx. 3 MB)" });
  const r = await db.query("INSERT INTO imagens(tipo,dados) VALUES($1,$2) RETURNING id", [m[1], buf]);
  res.status(201).json({ url: "/api/imagens/" + r.rows[0].id });
}));
app.get("/api/imagens/:id", ah(async (req, res) => {
  const r = await db.query("SELECT tipo,dados FROM imagens WHERE id=$1", [parseInt(req.params.id, 10) || 0]);
  if (!r.rows[0]) return res.status(404).end();
  res.set({ "Content-Type": r.rows[0].tipo, "Cache-Control": "public, max-age=31536000, immutable" }).send(r.rows[0].dados);
}));

app.listen(process.env.PORT || 3000, () => console.log("LIARA BRAND no ar"));
