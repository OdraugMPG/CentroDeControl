-- Rotación por empresa externa: turnos que opera la empresa y su ciclo (los turnos que rotan). Sus jefes de turno y
-- supervisores rotan juntos; quien está en un turno fuera del ciclo (por ejemplo, la noche fija) no rota.
CREATE TABLE IF NOT EXISTS rotacion_empresa (
  empresa_id int PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  turnos     text[]  NOT NULL DEFAULT '{AM,PM,Noche}',   -- turnos que opera la empresa
  activo     boolean NOT NULL DEFAULT false,
  ciclo      text[]  NOT NULL DEFAULT '{AM,PM}',         -- turnos que rotan, en orden
  semanas    int     NOT NULL DEFAULT 1 CHECK (semanas BETWEEN 1 AND 12),
  inicio     date    NOT NULL DEFAULT date_trunc('week', current_date)::date
);
INSERT INTO rotacion_empresa (empresa_id) SELECT id FROM empresas ON CONFLICT DO NOTHING;

-- Empresas actuales: Manpower (AM y PM rotan cada semana, sin noche), Alcansa (AM y PM rotan cada semana, noche fija)
-- y Tianel (rotación por definir)
INSERT INTO empresas (nombre) VALUES ('MANPOWER'), ('ALCANSA'), ('TIANEL') ON CONFLICT (nombre) DO NOTHING;
INSERT INTO rotacion_empresa (empresa_id, turnos, activo, ciclo, semanas)
  SELECT id, '{AM,PM}', true, '{AM,PM}', 1 FROM empresas WHERE nombre = 'MANPOWER'
  ON CONFLICT (empresa_id) DO UPDATE SET turnos = EXCLUDED.turnos, activo = EXCLUDED.activo, ciclo = EXCLUDED.ciclo, semanas = EXCLUDED.semanas;
INSERT INTO rotacion_empresa (empresa_id, turnos, activo, ciclo, semanas)
  SELECT id, '{AM,PM,Noche}', true, '{AM,PM}', 1 FROM empresas WHERE nombre = 'ALCANSA'
  ON CONFLICT (empresa_id) DO UPDATE SET turnos = EXCLUDED.turnos, activo = EXCLUDED.activo, ciclo = EXCLUDED.ciclo, semanas = EXCLUDED.semanas;
INSERT INTO rotacion_empresa (empresa_id) SELECT id FROM empresas WHERE nombre = 'TIANEL' ON CONFLICT DO NOTHING;
