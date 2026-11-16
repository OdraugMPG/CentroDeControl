-- Stock por compartimento del OSR (extracción de KiSoft: PRODUCT_CODE, LOAD_UNIT, SLOT_INT, STOCK_LOCATION_TYPE 111 / 121 / 141,
-- QUANTITY_TOTAL_INT, CAPACITY_111 / 121 / 141…). Una foto por día: cargar el mismo día reemplaza esa foto y se guardan las
-- anteriores para ver la evolución de la ocupación de los totes. La usa Abastecimiento OSR, Optimización de totes (ocupación y recall).
CREATE TABLE IF NOT EXISTS gestion.osr_slots (
  fecha     date NOT NULL,
  load_unit text NOT NULL,
  slot      integer NOT NULL DEFAULT 1,
  tipo      text NOT NULL,
  estado    text,
  sku       text NOT NULL,
  nombre    text,
  qty       numeric NOT NULL DEFAULT 0,
  qty_libre numeric,
  cap111    integer NOT NULL DEFAULT 0,
  cap121    integer NOT NULL DEFAULT 0,
  cap141    integer NOT NULL DEFAULT 0,
  peso      numeric,
  largo     numeric,
  ancho     numeric,
  alto      numeric,
  f_almac   date
);
CREATE INDEX IF NOT EXISTS osr_slots_fecha_sku_idx ON gestion.osr_slots (fecha, sku);
CREATE INDEX IF NOT EXISTS osr_slots_fecha_lu_idx ON gestion.osr_slots (fecha, load_unit);

-- Una fila por foto cargada, con el resumen de ocupación por tipo de tote (para la evolución diaria sin recalcular)
CREATE TABLE IF NOT EXISTS gestion.osr_slots_carga (
  fecha    date PRIMARY KEY,
  archivo  text,
  cargado  timestamptz NOT NULL DEFAULT now(),
  resumen  jsonb NOT NULL DEFAULT '{}'::jsonb
);
