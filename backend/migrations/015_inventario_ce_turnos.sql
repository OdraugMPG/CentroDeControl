-- Inventario de Control de Existencia en la asignación diaria por turno.
-- Loc de CE es el código del centro (100): el CD de la operación (CD1, SHELVING 3…) y el piso salen de la Base por
-- ubicación o, si la ubicación no tiene stock, por la zona / zona-pasillo.
ALTER TABLE inv_programa ADD COLUMN IF NOT EXISTS cd_op text, ADD COLUMN IF NOT EXISTS piso text;
CREATE INDEX IF NOT EXISTS inv_programa_cdop_idx ON inv_programa (fecha_op, cd_op, pasillo);
CREATE INDEX IF NOT EXISTS inv_programa_ubicacion_idx ON inv_programa (ubicacion);
CREATE INDEX IF NOT EXISTS inv_resultado_ubicacion_idx ON inv_resultado (ubicacion, fecha);

-- asignación hecha por la asignación diaria (se actualiza al regenerar) o a mano en Inventario CD (se respeta)
ALTER TABLE inv_asig ADD COLUMN IF NOT EXISTS automatica boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS turno int;
