-- Fotos enviadas pelo painel (o servidor também cria esta tabela sozinho)
CREATE TABLE IF NOT EXISTS imagens (
  id     SERIAL PRIMARY KEY,
  tipo   VARCHAR(20) NOT NULL,
  dados  BYTEA       NOT NULL,
  criado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos (
  id               SERIAL PRIMARY KEY,
  nome             VARCHAR(120)  NOT NULL,
  descricao        TEXT          NOT NULL DEFAULT '',
  preco            NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
  preco_antigo     NUMERIC(10,2),
  imagem_url       TEXT,
  categoria        VARCHAR(60)   NOT NULL DEFAULT 'Outros',
  genero           VARCHAR(10)   NOT NULL DEFAULT 'Feminino' CHECK (genero IN ('Feminino','Masculino')),
  variantes        JSONB         NOT NULL DEFAULT '[]',   -- [{"cor":"Preto","hex":"#000","imagem":"img/x.jpg"}]
  tamanhos         TEXT[]        NOT NULL DEFAULT '{}',   -- {PP,P,M}
  em_estoque       BOOLEAN       NOT NULL DEFAULT TRUE,
  destaque         BOOLEAN       NOT NULL DEFAULT FALSE,
  data_atualizacao TIMESTAMPTZ   NOT NULL DEFAULT now()
);
