-- Vista nueva "Abastecimiento OSR" (Gestión diaria): la reciben los roles que ya veían Optimización ABC.
UPDATE roles SET permisos = array_append(permisos, 'gd.osr')
 WHERE 'gd.optimizacion' = ANY(permisos) AND NOT ('gd.osr' = ANY(permisos));
