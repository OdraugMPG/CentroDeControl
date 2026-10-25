-- =====================================================================
-- Inicio de sesión: roles con permisos por vista, cuentas y sesiones.
-- Los roles iniciales se cargan desde src/lib/permisos.js (seed.js).
-- =====================================================================

CREATE TABLE roles (
  id          serial PRIMARY KEY,
  nombre      text NOT NULL UNIQUE,
  descripcion text NOT NULL DEFAULT '',
  permisos    text[] NOT NULL DEFAULT '{}',   -- claves de src/lib/permisos.js
  sistema     boolean NOT NULL DEFAULT false, -- Admin: no se edita ni se borra, tiene todo
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id              serial PRIMARY KEY,
  usuario         text NOT NULL,                  -- nombre de inicio de sesión
  nombre          text NOT NULL,                  -- se registra en cierres, cargas y tareas
  clave_hash      text NOT NULL,
  rol_id          int  NOT NULL REFERENCES roles(id),
  -- Persona del Equipo de Continuidad (turno y función). Sin clave foránea a propósito:
  -- npm run db:demo vacía personas con TRUNCATE ... CASCADE y no debe borrar las cuentas.
  persona_id      int,
  activo          boolean NOT NULL DEFAULT true,
  cambiar_clave   boolean NOT NULL DEFAULT false, -- clave temporal: se pide una nueva al entrar
  intentos        int NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  ultimo_acceso   timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_usuario_idx ON usuarios (lower(usuario));

-- Sesiones abiertas. Se guarda el hash del token, nunca el token.
CREATE TABLE sesiones (
  token_hash  text PRIMARY KEY,
  usuario_id  int NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada      timestamptz NOT NULL DEFAULT now(),
  expira      timestamptz NOT NULL,
  ip          text,
  agente      text
);
CREATE INDEX sesiones_usuario_idx ON sesiones (usuario_id);
