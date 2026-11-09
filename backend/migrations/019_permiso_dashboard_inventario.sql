-- Dashboard de inventario (Gestión de inventario): lo reciben los roles que ya ven los resultados de la toma
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.dashboard')
 WHERE 'co.inventario.resultados' = ANY(permisos) AND NOT ('co.inventario.dashboard' = ANY(permisos));
