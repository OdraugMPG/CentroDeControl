-- Toma de inventario oficial de Control de Existencia (CE): una fila por ubicación y SKU con Teórico y Físico.
-- Se compara con la toma de la operación (inv_resultado), que se hace días antes.
CREATE TABLE IF NOT EXISTS inv_ce_toma (
  id           serial PRIMARY KEY,
  fecha        date NOT NULL,
  ubicacion    text NOT NULL,
  sku          text,
  descripcion  text,
  costo        numeric,
  teorico      numeric NOT NULL DEFAULT 0,
  fisico       numeric NOT NULL DEFAULT 0,
  diferencia   numeric NOT NULL DEFAULT 0,
  dif_costo    numeric,
  va           text,
  analisis     text,
  observacion  text,
  cd           text,
  zona         text,
  pasillo      text,
  seteo        text,
  seccion      text,
  depto        text,
  sub_depto    text,
  usuario      text,
  semestre     text,
  vuelta       text,
  mes          text,
  semana       text,
  archivo      text,
  cargado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_ce_toma_fecha_idx ON inv_ce_toma (fecha);
CREATE INDEX IF NOT EXISTS inv_ce_toma_ubic_idx ON inv_ce_toma (ubicacion, sku);
CREATE INDEX IF NOT EXISTS inv_resultado_ubic_fecha_idx ON inv_resultado (ubicacion, fecha);

-- Comparación toma CE vs operación: la reciben los roles que ven los resultados de la toma
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.comparacion')
 WHERE 'co.inventario.resultados' = ANY(permisos) AND NOT ('co.inventario.comparacion' = ANY(permisos));
