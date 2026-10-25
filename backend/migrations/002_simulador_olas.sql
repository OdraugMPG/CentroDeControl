-- =====================================================================
-- Simulador de olas: extracción de líneas por liberar, analizada como
-- tabla dinámica (filtros, filas, columnas y suma de QTY).
-- =====================================================================

ALTER TABLE cargas DROP CONSTRAINT IF EXISTS cargas_tipo_check;
ALTER TABLE cargas ADD CONSTRAINT cargas_tipo_check CHECK (tipo IN ('pedidos','recepcion','almacenamiento','olas'));

-- Una fila por línea de la extracción. Solo se conserva la última carga.
CREATE TABLE olas_lineas (
  carga_id          int  NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  estado            text,
  desc_estado       text,
  jaula             text,
  od                text,
  solicitud         text,
  rut               text,
  destinatario      text,
  sku               text,
  descripcion       text,
  qty               numeric NOT NULL DEFAULT 0,
  dpto              text,
  region            text,
  city              text,
  fecha_salida      date,
  facility          text,
  tipo_orden        text,
  tipo_ola          text,
  fecha_eta_cliente date,
  dia               text,
  mes               text,
  anio              text,
  fecha_venta       date,
  dest              text,
  fecha_mod         timestamptz,
  rut_cliente       text,
  location_id       text,
  zona              text,
  pasillo           text,
  especial          text,
  tipo_picking      text,
  operacion         text,
  cd                text,
  marca_osr         text,
  logistica_osr     text,
  clasif_cd         text,
  clasif_picking    text
);
CREATE INDEX olas_lineas_carga_idx ON olas_lineas (carga_id);
