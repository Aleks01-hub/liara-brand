# LIARA BRAND — catálogo dinâmico + painel admin

## Estrutura
```
server.js          API Express + serve a pasta public/
schema.sql         tabela de produtos e imagens (PostgreSQL)
seed.sql           13 produtos de exemplo (opcional)
.env.example       variáveis de ambiente
public/index.html  catálogo do cliente — consome /api/produtos
views/admin.html   painel do dono (abre em /admin)
public/img/        logo e fotos fixas; novas fotos enviadas pelo painel ficam no banco
```

## API
| Método | Rota | Acesso |
|---|---|---|
| GET | /api/produtos | público |
| POST | /api/login | público (retorna token) |
| POST | /api/produtos | admin |
| PUT | /api/produtos/:id | admin |
| PATCH | /api/produtos/:id/estoque | admin |
| DELETE | /api/produtos/:id | admin |
| POST | /api/imagens | admin |
| GET | /api/imagens/:id | público |

## Rodar local
1. Crie um banco PostgreSQL (Supabase ou Neon) e copie a connection string.
2. Execute `schema.sql` e, se quiser, `seed.sql` no editor SQL do banco.
3. Copie `.env.example` para `.env` e preencha as variáveis.
4. Execute `npm install` e `npm start`.
5. Catálogo: http://localhost:3000 · Painel: http://localhost:3000/admin

## Publicar (Render)
1. Conecte este repositório ao Render como Web Service.
2. Build Command: `npm install`; Start Command: `node server.js`.
3. Configure no Render as variáveis que estão no `.env.example`.
4. Aponte seu domínio para o serviço.

## WhatsApp
Configure o número na variável `WA` no início do script em `public/index.html`.
