-- =====================================================================
-- Centro de control del CD + Continuidad Operacional
-- Esquema inicial. Zona horaria de trabajo: America/Santiago.
-- =====================================================================

-- ---------- Catálogos ----------
CREATE TABLE turnos (
  id          text PRIMARY KEY,              -- 'AM', 'PM', 'Noche'
  nombre      text NOT NULL,
  hora_inicio int  NOT NULL CHECK (hora_inicio BETWEEN 0 AND 23),
  duracion_h  int  NOT NULL CHECK (duracion_h BETWEEN 1 AND 24),
  orden       int  NOT NULL
);

-- Qué turnos operan cada día de la semana (0 = domingo ... 6 = sábado)
CREATE TABLE turno_calendario (
  dia_semana int  NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  turno_id   text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  activo     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (dia_semana, turno_id)
);

-- Etapas del flujo de pedidos (valores de la columna AREA de la extracción)
CREATE TABLE etapas (
  area    text PRIMARY KEY,                  -- '05_En_Empaque'
  nombre  text NOT NULL,                     -- 'En empaque'
  fase    text NOT NULL CHECK (fase IN ('Picking','Consolidación','Empaque','Despacho')),
  orden   int  NOT NULL
);

-- Meta de unidades por hora que deben salir de cada etapa, por turno
CREATE TABLE metas_etapa (
  area          text NOT NULL REFERENCES etapas(area) ON UPDATE CASCADE ON DELETE CASCADE,
  turno_id      text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  unidades_hora int  NOT NULL DEFAULT 0 CHECK (unidades_hora >= 0),
  PRIMARY KEY (area, turno_id)
);

-- Catálogo de causas de desvío (base del Pareto)
CREATE TABLE causas (
  id     serial PRIMARY KEY,
  nombre text NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true,
  orden  int NOT NULL DEFAULT 0
);

-- Parámetros generales (umbrales, meta de recepción, etc.)
CREATE TABLE parametros (
  clave text PRIMARY KEY,
  valor jsonb NOT NULL
);

-- ---------- Extracciones del WMS ----------
CREATE TABLE cargas (
  id          serial PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('pedidos','recepcion','almacenamiento')),
  archivo     text NOT NULL,
  filas       int  NOT NULL DEFAULT 0,
  corte       timestamptz NOT NULL,            -- momento que representa la foto
  cargado_en  timestamptz NOT NULL DEFAULT now(),
  cargado_por text,
  resumen     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX cargas_tipo_idx ON cargas (tipo, id DESC);

-- Foto del flujo de pedidos (una fila por tarea de la extracción)
CREATE TABLE pedido_tareas (
  carga_id          int  NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  task_key          text NOT NULL,             -- ORDEN|ITEM, estable entre etapas
  task_id           text,
  area              text NOT NULL,
  operacion         text,
  qty               int  NOT NULL DEFAULT 0,
  f_mod             timestamptz,
  orden             text,
  nro_ola           text,
  jaula             text,
  flujo             text,
  fecha_compromiso  date,
  tipo_ola          text,
  cd                text,
  tipo_od           text,
  region            text,
  tipo_transaccion  text,
  especial          text,
  retira            text,
  item              text,
  descripcion       text,
  usuario           text,
  transporte        text,
  comuna            text,
  pasillo           text,
  ubicacion         text
);
CREATE INDEX pedido_tareas_carga_idx ON pedido_tareas (carga_id);

-- Unidades que salieron de cada etapa. Se generan comparando dos extracciones seguidas.
CREATE TABLE movimientos_etapa (
  id           bigserial PRIMARY KEY,
  carga_id     int REFERENCES cargas(id) ON DELETE CASCADE,
  fecha_hora   timestamptz NOT NULL,
  area_origen  text NOT NULL,
  area_destino text NOT NULL,                  -- 'SALIDA' si la unidad dejó el flujo (despachada)
  operacion    text,
  qty          int  NOT NULL,
  usuario      text,
  task_key     text,
  origen       text NOT NULL DEFAULT 'extraccion'   -- 'extraccion' | 'demo'
);
CREATE INDEX movimientos_fecha_idx ON movimientos_etapa (fecha_hora);
CREATE INDEX movimientos_area_idx ON movimientos_etapa (area_origen, fecha_hora);

-- Recepción: citas del día (se actualizan con cada carga)
CREATE TABLE recepcion_citas (
  fecha      date NOT NULL,
  cita       text NOT NULL,
  proveedor  text,
  prog       timestamptz,
  llegada    timestamptz,
  inicio     timestamptz,
  fin        timestamptz,
  anden      int,
  esperadas  int NOT NULL DEFAULT 0,
  recibidas  int NOT NULL DEFAULT 0,
  estado     text NOT NULL DEFAULT 'Programada'
             CHECK (estado IN ('Programada','En patio','Descargando','En inspección','Recibida')),
  carga_id   int REFERENCES cargas(id) ON DELETE SET NULL,
  PRIMARY KEY (fecha, cita)
);

-- Almacenamiento: fotos por carga
CREATE TABLE alm_zonas (
  carga_id   int NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  zona       text NOT NULL,
  posiciones int  NOT NULL,
  ocupadas   int  NOT NULL
);
CREATE TABLE alm_lpn (
  carga_id        int NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  lpn             text NOT NULL,
  zona            text,
  qty             int NOT NULL DEFAULT 0,
  estado          text NOT NULL CHECK (estado IN ('Por ubicar','En curso','Ubicado')),
  fecha_recepcion timestamptz,
  cita            text
);
CREATE TABLE alm_reposiciones (
  carga_id   int NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  zona       text NOT NULL,
  pendientes int NOT NULL DEFAULT 0,
  urgentes   int NOT NULL DEFAULT 0
);

-- ---------- Continuidad Operacional ----------
CREATE TABLE personas (
  id        serial PRIMARY KEY,
  nombre    text NOT NULL,
  rol       text NOT NULL CHECK (rol IN ('Jefe de Operaciones','Jefe de Turno','Supervisor')),
  turno_id  text REFERENCES turnos(id) ON UPDATE CASCADE,
  reporta_a int  REFERENCES personas(id) ON DELETE SET NULL,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);
-- Un solo Jefe de Turno activo por turno
CREATE UNIQUE INDEX un_jefe_por_turno ON personas (turno_id) WHERE rol = 'Jefe de Turno' AND activo;

CREATE TABLE handovers (
  id            serial PRIMARY KEY,
  fecha         date NOT NULL,                 -- fecha operativa del turno que entrega
  turno_id      text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  jefe          text NOT NULL,
  situacion     text,
  riesgos       text,
  entregado_en  timestamptz NOT NULL DEFAULT now(),
  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado')),
  jefe_entrante text,
  confirmado_en timestamptz
);
CREATE INDEX handovers_turno_idx ON handovers (fecha, turno_id);

-- Compromisos y tareas. Cuando una tarea no se cierra, se marca 'traspasada' y se crea
-- una copia en el turno siguiente; así cada turno conserva su propio cumplimiento.
CREATE TABLE tareas (
  id                serial PRIMARY KEY,
  titulo            text NOT NULL,
  categoria         text NOT NULL DEFAULT 'Otra',
  responsable       text,
  fecha             date NOT NULL,
  turno_id          text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  cd                text,
  estado            text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada','traspasada')),
  origen            text NOT NULL DEFAULT 'operaciones' CHECK (origen IN ('operaciones','turno')),
  asignado_por      text,
  asignado_a        int REFERENCES personas(id) ON DELETE SET NULL,
  handover_id       int REFERENCES handovers(id) ON DELETE SET NULL,
  prioridad         text NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('normal','alta')),
  heredada_de       int REFERENCES tareas(id) ON DELETE SET NULL,
  veces_transferida int NOT NULL DEFAULT 0,
  plazo             timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  cerrado_en        timestamptz,
  cerrado_por       text
);
CREATE INDEX tareas_turno_idx ON tareas (fecha, turno_id);

-- Dotación requerida por turno y fila (cargo o cargo::área)
CREATE TABLE dotacion_requerida (
  turno_id text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  fila     text NOT NULL,
  cantidad int  NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  PRIMARY KEY (turno_id, fila)
);

CREATE TABLE asistencia (
  fecha          date NOT NULL,
  turno_id       text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  valores        jsonb NOT NULL DEFAULT '{}',   -- {fila: presentes}
  confirmado_por text NOT NULL,
  confirmado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, turno_id)
);

CREATE TABLE inv_layout (
  id      serial PRIMARY KEY,
  cd      text NOT NULL,
  nivel   text NOT NULL DEFAULT '',
  zona    text NOT NULL DEFAULT '',
  pasillo text NOT NULL DEFAULT '',
  UNIQUE (cd, nivel, zona, pasillo)
);

CREATE TABLE inv_asignaciones (
  id              serial PRIMARY KEY,
  cd              text NOT NULL,
  nivel           text,
  zona            text,
  pasillo         text,
  jefe_turno      text,
  supervisor      text,
  qty_op          text,
  adecco          text,
  fecha_asignado  date NOT NULL,
  fecha_ejecutado date,
  tiempo          text,
  estado_original text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

-- ---------- Cierre de turno ----------
CREATE TABLE cierres_turno (
  fecha       date NOT NULL,
  turno_id    text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  jefe        text,
  resumen     jsonb,
  cerrado_en  timestamptz,
  cerrado_por text,
  PRIMARY KEY (fecha, turno_id)
);

-- Causa registrada por cada hora en que una etapa quedó bajo el umbral
CREATE TABLE desvio_causas (
  fecha      date NOT NULL,
  turno_id   text NOT NULL REFERENCES turnos(id) ON UPDATE CASCADE,
  area       text NOT NULL,
  hora       timestamptz NOT NULL,
  causa_id   int REFERENCES causas(id),
  minutos    int CHECK (minutos BETWEEN 0 AND 60),
  comentario text,
  brecha     int,                       -- unidades bajo la meta, guardadas al registrar
  registrado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, turno_id, area, hora)
);
