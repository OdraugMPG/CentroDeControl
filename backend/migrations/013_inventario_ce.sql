-- Inventario CD con la programación oficial de Control de Existencia (CE): una fila por ubicación y fecha programada.
-- La operación debe pasar antes que CE (fecha_op = N días hábiles, lunes a sábado, antes de la fecha de CE).
CREATE TABLE IF NOT EXISTS inv_programa (
  id           serial PRIMARY KEY,
  cd           text NOT NULL,                -- columna Loc
  ubicacion    text NOT NULL,
  seteo        text,
  zona         text NOT NULL DEFAULT '',
  pasillo      text NOT NULL DEFAULT '',
  seccion      text,
  vuelta       text,
  lado         text,
  fecha_prog   date NOT NULL,                -- Fecha programada por CE
  fecha_reprog date,                         -- Re-Programación (reemplaza a la programada)
  fecha_ce     date NOT NULL,                -- la vigente: re-programación o programada
  fecha_op     date NOT NULL,                -- cuándo debe pasar la operación
  fecha_toma   date,                         -- Fecha Toma de CE
  mes_prog     text,
  mes_toma     text,
  archivo      text,
  cargado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_programa_op_idx ON inv_programa (fecha_op, cd, zona, pasillo);
CREATE INDEX IF NOT EXISTS inv_programa_ubic_idx ON inv_programa (cd, ubicacion);
CREATE INDEX IF NOT EXISTS inv_programa_prog_idx ON inv_programa (fecha_prog);

-- Asignación por grupo (día de operación, CD, zona y pasillo): jefe de turno de la empresa externa y supervisor Paris.
-- Va aparte de la programación para que una nueva carga de CE no borre lo asignado.
CREATE TABLE IF NOT EXISTS inv_asig (
  fecha_op       date NOT NULL,
  cd             text NOT NULL,
  zona           text NOT NULL DEFAULT '',
  pasillo        text NOT NULL DEFAULT '',
  jefe_empresa   text,
  empresa        text,
  supervisor     text,
  asignado_por   text,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha_op, cd, zona, pasillo)
);

-- Resultado de la toma de inventario: una fila por ubicación y SKU contado.
CREATE TABLE IF NOT EXISTS inv_resultado (
  id                  serial PRIMARY KEY,
  cd                  text NOT NULL,
  ubicacion           text NOT NULL,
  empresa             text,
  zona                text,
  pasillo             text,
  sku                 text,
  contado             numeric NOT NULL DEFAULT 0,
  sistema             numeric NOT NULL DEFAULT 0,
  diferencia          numeric NOT NULL DEFAULT 0,
  estado              text,
  usuario             text,
  fecha               date NOT NULL,
  f_mod               timestamp,
  turno               text,
  validacion          text,
  requiere_supervisor text,
  nivel_urgencia      text,
  ultimo_registro     text,
  archivo             text,
  cargado_en          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_resultado_fecha_idx ON inv_resultado (fecha);
CREATE INDEX IF NOT EXISTS inv_resultado_ubic_idx ON inv_resultado (cd, ubicacion);

-- Parámetros: días hábiles de anticipación y umbrales del semáforo de ERI y ERU
INSERT INTO parametros VALUES ('invDiasAntes', '2'), ('eriSano', '0.98'), ('eriCritico', '0.95'), ('eruSano', '0.99'), ('eruCritico', '0.97')
  ON CONFLICT (clave) DO NOTHING;

-- Permisos: "marcar ejecutado" deja de existir (la ejecución sale del resultado de la toma); en su lugar, ver resultados ERI / ERU
UPDATE roles SET permisos = array_replace(permisos, 'co.inventario.gestionar', 'co.inventario.resultados')
 WHERE 'co.inventario.gestionar' = ANY(permisos);
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.resultados')
 WHERE 'co.inventario.calendario' = ANY(permisos) AND NOT ('co.inventario.resultados' = ANY(permisos));
