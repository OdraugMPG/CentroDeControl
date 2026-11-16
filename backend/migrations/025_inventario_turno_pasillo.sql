-- Calendario de planificación: turno de la operación en que se inventaría cada zona-pasillo en su fecha de operación.
-- Se reparte de forma pareja (por ubicaciones) entre los turnos disponibles del día; el día en que se actualiza el calendario
-- solo cuentan los turnos que aún no empiezan. "manual" = elegido a mano en la web (el reparto automático no lo mueve).
-- Va aparte de inv_programa para que se conserve al volver a cargar el Excel de Control de Existencia.
CREATE TABLE IF NOT EXISTS inv_turno_pasillo (
  fecha_op  date NOT NULL,
  cd        text NOT NULL,
  pasillo   text NOT NULL,
  turno     text NOT NULL REFERENCES turnos(id),
  manual    boolean NOT NULL DEFAULT false,
  usuario   text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha_op, cd, pasillo)
);
