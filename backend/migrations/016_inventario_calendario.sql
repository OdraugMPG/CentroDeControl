-- Calendario de planificación de inventario: ajustes de la programación de CE hechos en la web (reprogramar o quitar
-- ubicaciones). Se guardan aparte para volver a aplicarlos cuando se sube de nuevo el Excel de CE.
ALTER TABLE inv_programa
  ADD COLUMN IF NOT EXISTS excluida boolean NOT NULL DEFAULT false,   -- quitada del calendario en la web
  ADD COLUMN IF NOT EXISTS ajustada boolean NOT NULL DEFAULT false;   -- con un ajuste hecho en la web
CREATE INDEX IF NOT EXISTS inv_programa_ce_idx ON inv_programa (fecha_ce);

CREATE TABLE IF NOT EXISTS inv_ajuste (
  id             serial PRIMARY KEY,
  cd             text NOT NULL,              -- Loc de la programación
  ubicacion      text NOT NULL,
  fecha_prog     date NOT NULL,              -- fecha programada original del Excel (identifica la fila)
  accion         text NOT NULL CHECK (accion IN ('REPROG', 'QUITAR')),
  fecha_nueva    date,                       -- nueva fecha de CE (REPROG)
  fecha_op_nueva date,                       -- su fecha de operación
  reprog_orig    date,                       -- re-programación que traía el Excel (para restaurar)
  usuario        text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cd, ubicacion, fecha_prog)
);

-- permiso para editar el calendario: lo reciben los roles que ya cargan la programación
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.planificar')
 WHERE 'co.inventario.cargar' = ANY(permisos) AND NOT ('co.inventario.planificar' = ANY(permisos));
