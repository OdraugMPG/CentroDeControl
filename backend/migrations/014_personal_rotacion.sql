-- Personal por turno administrado en Administración, Configuración: empresas externas, supervisores Paris, jefes de turno
-- y supervisores de empresas externas, con rotación semanal automática de turno.
CREATE TABLE IF NOT EXISTS empresas (
  id        serial PRIMARY KEY,
  nombre    text NOT NULL UNIQUE,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- personas: nuevos roles de empresa externa; CD, empresa y turno base para la rotación
ALTER TABLE personas DROP CONSTRAINT IF EXISTS personas_rol_check;
ALTER TABLE personas ADD CONSTRAINT personas_rol_check
  CHECK (rol IN ('Jefe de Operaciones', 'Jefe de Turno', 'Supervisor', 'Jefe de Turno Empresa', 'Supervisor Empresa'));
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS empresa_id int REFERENCES empresas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cd         text,
  ADD COLUMN IF NOT EXISTS rota       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS turno_base text REFERENCES turnos(id) ON UPDATE CASCADE;   -- turno en la semana de inicio de la rotación
UPDATE personas SET turno_base = turno_id WHERE turno_base IS NULL;

-- Rotación por grupo: turnos del ciclo en orden, cada cuántas semanas cambia y la semana (lunes) de inicio
CREATE TABLE IF NOT EXISTS rotacion (
  grupo   text PRIMARY KEY CHECK (grupo IN ('SUP_PARIS', 'JEFE_EMPRESA', 'SUP_EMPRESA')),
  activo  boolean NOT NULL DEFAULT false,
  ciclo   text[]  NOT NULL DEFAULT '{AM,PM,Noche}',
  semanas int     NOT NULL DEFAULT 1 CHECK (semanas BETWEEN 1 AND 12),
  inicio  date    NOT NULL DEFAULT date_trunc('week', current_date)::date
);
INSERT INTO rotacion (grupo) VALUES ('SUP_PARIS'), ('JEFE_EMPRESA'), ('SUP_EMPRESA') ON CONFLICT DO NOTHING;
