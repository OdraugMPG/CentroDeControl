-- Distribución de los SKU en los totes de OSR (archivo del OSR: Article number, Article name, Stock, Stock locations,
-- FULL, HALF, QUARTER). Cada carga reemplaza la anterior; la usa Abastecimiento OSR, Optimización de totes.
CREATE TABLE IF NOT EXISTS gestion.osr_totes (
  sku          text PRIMARY KEY,
  nombre       text,
  stock        numeric NOT NULL DEFAULT 0,
  ubicaciones  integer NOT NULL DEFAULT 0,
  full_t       integer NOT NULL DEFAULT 0,
  half_t       integer NOT NULL DEFAULT 0,
  quarter_t    integer NOT NULL DEFAULT 0
);
