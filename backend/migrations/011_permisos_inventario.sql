-- Inventario CD se abre en un permiso por bloque (cargar calendario, asignar, ver calendario y gestionarlo).
-- Los roles que ya tenían Inventario CD reciben todos, para que nadie pierda lo que hacía.
UPDATE roles SET permisos = (
  SELECT array_agg(DISTINCT p) FROM unnest(permisos || ARRAY['co.inventario.cargar', 'co.inventario.asignar', 'co.inventario.calendario', 'co.inventario.gestionar']) AS p)
 WHERE 'co.inventario' = ANY(permisos);
