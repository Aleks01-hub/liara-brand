-- Produtos de exemplo (rode depois do schema.sql)
-- Usa jsonb_build_array/jsonb_build_object para evitar problemas de escaping/line-endings

INSERT INTO produtos (nome, descricao, preco, preco_antigo, imagem_url, categoria, genero, variantes, tamanhos, em_estoque, destaque) VALUES
(
  'Vestido Midi Lara', '', 89.9, 129.9, NULL, 'Vestidos', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Rosa',   'hex', '#e79ab5', 'imagem', ''),
    jsonb_build_object('cor', 'Preto',  'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Vinho',  'hex', '#7a1f3d', 'imagem', ''),
    jsonb_build_object('cor', 'Lilás',  'hex', '#b79cff', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, TRUE
),
(
  'Cropped Canelado', '', 39.9, 59.9, NULL, 'Blusas', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Branco', 'hex', '#ffffff', 'imagem', ''),
    jsonb_build_object('cor', 'Preto',  'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Rosa',   'hex', '#e79ab5', 'imagem', ''),
    jsonb_build_object('cor', 'Verde',  'hex', '#3f8a6a', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, TRUE
),
(
  'Calça Wide Leg', '', 109.9, 149.9, NULL, 'Calças', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Bege', 'hex', '#d9c4a3', 'imagem', ''),
    jsonb_build_object('cor', 'Preto', 'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Azul',  'hex', '#3b6fd0', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, TRUE
),
(
  'Blusa Cetim Soft', '', 69.9, NULL, NULL, 'Blusas', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Lilás',  'hex', '#b79cff', 'imagem', ''),
    jsonb_build_object('cor', 'Vinho',  'hex', '#7a1f3d', 'imagem', ''),
    jsonb_build_object('cor', 'Bege',   'hex', '#d9c4a3', 'imagem', ''),
    jsonb_build_object('cor', 'Branco', 'hex', '#ffffff', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, FALSE
),
(
  'Saia Plissada', '', 74.9, 99.9, NULL, 'Saias', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Preto', 'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Bege',  'hex', '#d9c4a3', 'imagem', ''),
    jsonb_build_object('cor', 'Vinho', 'hex', '#7a1f3d', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, FALSE
),
(
  'Moletom Cropped', '', 119.9, NULL, NULL, 'Moletons', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Rosa',  'hex', '#e79ab5', 'imagem', ''),
    jsonb_build_object('cor', 'Cinza', 'hex', '#9a98a6', 'imagem', ''),
    jsonb_build_object('cor', 'Branco','hex', '#ffffff', 'imagem', '')
  ),
  ARRAY['PP','P','M','G','GG'], TRUE, FALSE
),
(
  'Body Josy', '', 69.9, NULL, 'img/body-josy-chocolate.jpg', 'Bodies', 'Feminino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Chocolate',   'hex', '#4b2a22', 'imagem', 'img/body-josy-chocolate.jpg'),
    jsonb_build_object('cor', 'Preto',       'hex', '#231f1c', 'imagem', 'img/body-josy-preto.jpg'),
    jsonb_build_object('cor', 'Azul marinho','hex', '#1f2a4a', 'imagem', 'img/body-josy-marinho.jpg')
  ),
  ARRAY['M'], TRUE, FALSE
),
(
  'Camiseta Oversized', '', 59.9, 89.9, NULL, 'Blusas', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Preto', 'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Branco','hex', '#ffffff', 'imagem', ''),
    jsonb_build_object('cor', 'Cinza', 'hex', '#9a98a6', 'imagem', ''),
    jsonb_build_object('cor', 'Verde', 'hex', '#3f8a6a', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, TRUE
),
(
  'Moletom Hoodie', '', 139.9, 189.9, NULL, 'Moletons', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Cinza',   'hex', '#9a98a6', 'imagem', ''),
    jsonb_build_object('cor', 'Preto',   'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Azul',    'hex', '#3b6fd0', 'imagem', ''),
    jsonb_build_object('cor', 'Mostarda','hex', '#e3a82b', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, TRUE
),
(
  'Bermuda Cargo', '', 79.9, NULL, NULL, 'Bermudas', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Bege', 'hex', '#d9c4a3', 'imagem', ''),
    jsonb_build_object('cor', 'Preto','hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Verde','hex', '#3f8a6a', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, FALSE
),
(
  'Calça Jogger', '', 99.9, 129.9, NULL, 'Calças', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Preto', 'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Cinza', 'hex', '#9a98a6', 'imagem', ''),
    jsonb_build_object('cor', 'Azul',  'hex', '#3b6fd0', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, TRUE
),
(
  'Camisa Polo', '', 84.9, NULL, NULL, 'Blusas', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Branco', 'hex', '#ffffff', 'imagem', ''),
    jsonb_build_object('cor', 'Azul',   'hex', '#3b6fd0', 'imagem', ''),
    jsonb_build_object('cor', 'Vinho',  'hex', '#7a1f3d', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, FALSE
),
(
  'Jaqueta Corta-vento', '', 129.9, 159.9, NULL, 'Moletons', 'Masculino',
  jsonb_build_array(
    jsonb_build_object('cor', 'Preto',   'hex', '#231f1c', 'imagem', ''),
    jsonb_build_object('cor', 'Verde',   'hex', '#3f8a6a', 'imagem', ''),
    jsonb_build_object('cor', 'Mostarda','hex', '#e3a82b', 'imagem', '')
  ),
  ARRAY['P','M','G','GG'], TRUE, FALSE
);