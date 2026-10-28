-- Pedidos (SOLICITUD) por día y SKU del archivo de picking: cuántos pedidos tiene el SKU y cuántos mezclan
-- picking de TAREA y ETIQUETA (se usa en la consolidación entre CD para llevar esos SKU al CD de etiqueta).
CREATE TABLE IF NOT EXISTS gestion.venta_cd_ped (
  fecha   date,
  sku     text NOT NULL,
  pedidos integer NOT NULL DEFAULT 0,
  mixtos  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venta_cd_ped_fecha_idx ON gestion.venta_cd_ped (fecha);
