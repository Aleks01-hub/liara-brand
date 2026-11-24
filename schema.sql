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


-- Cupons promocionais administrados pelo painel da Liara.
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
);
CREATE INDEX IF NOT EXISTS idx_cupons_ativo_validade ON cupons (ativo, data_inicio, data_fim);
