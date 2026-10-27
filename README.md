# LIARA BRAND — catálogo dinâmico + painel admin

## Estrutura
```
server.js          API Express + serve a pasta public/
schema.sql         tabela `produtos` (PostgreSQL)
seed.sql           13 produtos de exemplo (opcional)
.env.example       variáveis de ambiente
public/index.html  catálogo do cliente (seu design) — consome /api/produtos
public/admin.html  painel do dono (login + CRUD)
public/img/        logo e fotos fixas (as fotos novas enviadas pelo painel ficam no banco)
```

## API
| Método | Rota | Acesso |
|---|---|---|
| GET | /api/produtos | público |
| POST | /api/login | público (retorna token) |
| POST | /api/produtos | admin |
| PUT | /api/produtos/:id | admin |
| PATCH | /api/produtos/:id/estoque | admin `{ "em_estoque": false }` |
| DELETE | /api/produtos/:id | admin |
| POST | /api/imagens | admin (envia foto, devolve a URL) |
| GET | /api/imagens/:id | público (mostra a foto) |

## Rodar local
1. Crie um banco PostgreSQL grátis (Supabase ou Neon) e copie a connection string.
2. Rode `schema.sql` e, se quiser, `seed.sql` no editor SQL do banco.
3. `cp .env.example .env` e preencha DATABASE_URL, ADMIN_USER, ADMIN_PASS, JWT_SECRET.
4. `npm install && npm start`
5. Catálogo: http://localhost:3000 · Painel: http://localhost:3000/admin.html

## Publicar (Render)
1. Suba a pasta para um repositório no GitHub (o .env não vai, está no .gitignore).
2. Render → New Web Service → Build `npm install` · Start `node server.js`.
3. Em Environment, cadastre as mesmas variáveis do .env.
4. Aponte seu domínio para o serviço.

## WhatsApp
O número fica na variável `WA` no início do `<script>` de `public/index.html` (formato 5588988745392).
