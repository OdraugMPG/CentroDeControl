-- Asignación del día se abre en un permiso por paso (configuración, Base del inicio y generar la asignación).
-- Los roles que ya tenían la vista reciben los tres, para que nadie pierda lo que hacía.
UPDATE roles SET permisos = (
  SELECT array_agg(DISTINCT p) FROM unnest(permisos || ARRAY['gd.asignacion.config', 'gd.asignacion.base', 'gd.asignacion.generar']) AS p)
 WHERE 'gd.asignacion' = ANY(permisos);
