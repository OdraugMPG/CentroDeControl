-- Participación de la venta por CD (Gestión diaria): venta del archivo de pedidos/despachos agregada por
-- día de venta, CD de picking, tipo de picking (TAREA / ETIQUETA) y SKU.
CREATE TABLE IF NOT EXISTS gestion.venta_cd (
  fecha       date,
  cd          text NOT NULL,
  tipo        text NOT NULL DEFAULT '',
  sku         text NOT NULL,
  dpto        text NOT NULL DEFAULT '',
  descripcion text,
  unidades    numeric NOT NULL DEFAULT 0,
  lineas      integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venta_cd_fecha_idx ON gestion.venta_cd (fecha, tipo);

-- Vista nueva "Participación por CD": la reciben los roles que ya veían Abastecimiento OSR.
UPDATE roles SET permisos = array_append(permisos, 'gd.participacion')
 WHERE 'gd.osr' = ANY(permisos) AND NOT ('gd.participacion' = ANY(permisos));
