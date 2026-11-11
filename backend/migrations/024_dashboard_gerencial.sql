-- Dashboard gerencial: lo reciben los roles que ven el Resumen de Operación o el Dashboard de inventario
UPDATE roles SET permisos = array_append(permisos, 'ge.dashboard')
 WHERE ('op.resumen' = ANY(permisos) OR 'co.inventario.dashboard' = ANY(permisos)) AND NOT ('ge.dashboard' = ANY(permisos));
