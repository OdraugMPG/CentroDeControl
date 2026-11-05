-- Recepción: lo almacenado (extracción ALM_USER del WMS). Una fila por LPN ubicado: cantidad, fecha y hora, turno, SKU,
-- ubicación destino, usuario, CD y operación. Al cargar se reemplazan los días (DIA) que trae el archivo.
ALTER TABLE cargas DROP CONSTRAINT IF EXISTS cargas_tipo_check;
ALTER TABLE cargas ADD CONSTRAINT cargas_tipo_check CHECK (tipo IN ('pedidos','recepcion','almacenamiento','olas','almacenado'));

CREATE TABLE IF NOT EXISTS recepcion_almacenado (
  carga_id        int  NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  dia             date NOT NULL,
  f_mod           timestamptz,
  hora            int,                 -- hora del día (NHORA o la hora de F_MOD)
  turno           text,
  qty             int  NOT NULL DEFAULT 0,
  sku             text,
  descripcion     text,
  depto           text,
  cd              text,
  operacion       text,
  usuario         text,
  lpn             text,                -- CONTAINER_ID
  asn             text,
  ubicacion       text,                -- TARGET_LOCATION_ID
  location        text,
  desde           text,
  flujo           text,
  jornada         text,
  old_status      text,
  new_status      text,
  org_id          text,
  facility_id     text,
  criteria_id     text,
  transaction_id  text,
  minuto          text,
  mes             text
);
CREATE INDEX IF NOT EXISTS recepcion_almacenado_dia_idx ON recepcion_almacenado (dia, cd);
CREATE INDEX IF NOT EXISTS recepcion_almacenado_carga_idx ON recepcion_almacenado (carga_id);
