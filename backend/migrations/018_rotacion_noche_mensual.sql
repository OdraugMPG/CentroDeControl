-- Tipo de rotación "noche mensual": cada equipo hace N semanas de noche (lunes a viernes), sale a PM y alterna AM / PM
-- cada semana (lunes a sábado) hasta volver a la noche. Con 3 equipos desfasados N semanas, cada semana hay un equipo
-- en cada turno. El equipo de cada persona (1, 2 o 3) sale de su turno de esta semana.
ALTER TABLE rotacion
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'ciclo' CHECK (tipo IN ('ciclo', 'noche_mensual')),
  ADD COLUMN IF NOT EXISTS noche_semanas int NOT NULL DEFAULT 4 CHECK (noche_semanas BETWEEN 1 AND 8);
ALTER TABLE rotacion_empresa
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'ciclo' CHECK (tipo IN ('ciclo', 'noche_mensual')),
  ADD COLUMN IF NOT EXISTS noche_semanas int NOT NULL DEFAULT 4 CHECK (noche_semanas BETWEEN 1 AND 8);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS equipo int CHECK (equipo BETWEEN 1 AND 3);

-- Supervisores Paris y Tianel: noche de 4 semanas, después PM, y AM / PM semanal
UPDATE rotacion SET tipo = 'noche_mensual', noche_semanas = 4, activo = true, ciclo = '{AM,PM,Noche}' WHERE grupo = 'SUP_PARIS';
UPDATE rotacion_empresa SET tipo = 'noche_mensual', noche_semanas = 4, activo = true, turnos = '{AM,PM,Noche}', ciclo = '{AM,PM,Noche}'
 WHERE empresa_id = (SELECT id FROM empresas WHERE nombre = 'TIANEL');
