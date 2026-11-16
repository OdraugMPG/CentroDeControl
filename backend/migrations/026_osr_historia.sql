-- Evolución histórica del OSR (Sloting): resumen de cada Base de stock (carga de INICIO), calculado una sola vez por carga.
-- osr_hist_dep: por depto, SKU / unidades / ubicaciones en el OSR, stock de todos los CD y SKU con Logística OSR = Y.
-- osr_hist_sku: unidades en el OSR por SKU (para ver qué SKU entran y salen entre una Base y otra).
CREATE TABLE IF NOT EXISTS gestion.osr_hist_dep (
  carga_id   integer NOT NULL REFERENCES gestion.cargas(id) ON DELETE CASCADE,
  depto      text NOT NULL,
  skus_osr   integer NOT NULL DEFAULT 0,
  u_osr      numeric NOT NULL DEFAULT 0,
  ubic_osr   integer NOT NULL DEFAULT 0,
  skus       integer NOT NULL DEFAULT 0,
  u          numeric NOT NULL DEFAULT 0,
  skus_y     integer NOT NULL DEFAULT 0,
  skus_osr_y integer NOT NULL DEFAULT 0,
  PRIMARY KEY (carga_id, depto)
);
CREATE TABLE IF NOT EXISTS gestion.osr_hist_sku (
  carga_id integer NOT NULL REFERENCES gestion.cargas(id) ON DELETE CASCADE,
  sku      text NOT NULL,
  depto    text NOT NULL,
  u        numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (carga_id, sku)
);
CREATE INDEX IF NOT EXISTS osr_hist_sku_depto_idx ON gestion.osr_hist_sku (depto, carga_id);
