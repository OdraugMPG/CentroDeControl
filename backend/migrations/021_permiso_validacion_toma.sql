-- Validación de la toma (Gestión de inventario): la reciben los roles que ven los resultados de la toma
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.validacion')
 WHERE 'co.inventario.resultados' = ANY(permisos) AND NOT ('co.inventario.validacion' = ANY(permisos));
