-- Almacenamiento: lo pendiente por almacenar (foto del WMS, una fila por iLPN: ZONA, UBICACION, ILPN_ID, ITEM_ID, QTY, ORIGEN,
-- FECHA_MOD, FECHA_CREAC, AÑO, MES, DIA, EMPRESA_USUARIO, LEVEL, DESC_DEPTO, TEMPORADA, CD_DESDE, CD, COSTO_LPN…).
-- Cada carga reemplaza la foto anterior; las columnas que no se analizan quedan en "otros".
ALTER TABLE cargas DROP CONSTRAINT IF EXISTS cargas_tipo_check;
ALTER TABLE cargas ADD CONSTRAINT cargas_tipo_check CHECK (tipo IN ('pedidos','recepcion','almacenamiento','olas','almacenado','pendiente'));

CREATE TABLE IF NOT EXISTS alm_pendiente (
  carga_id         int  NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  ilpn             text,
  sku              text,
  descripcion      text,
  qty              int  NOT NULL DEFAULT 0,
  zona             text,
  ubicacion        text,
  origen           text,
  fecha_mod        timestamptz,
  fecha_creac      timestamptz,
  anio             text,
  mes              text,
  dia              text,
  empresa_usuario  text,
  level            text,
  depto            text,
  desc_depto       text,
  desc_subdepto    text,
  desc_familia     text,
  temporada        text,
  cd_desde         text,
  cd               text,
  status           text,
  process          text,
  asn              text,
  hay_en_osr       text,
  responsable      text,
  supervisor       text,
  costo_unit       numeric,
  costo_lpn        numeric,
  volumen          numeric,
  otros            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS alm_pendiente_carga_idx ON alm_pendiente (carga_id);
