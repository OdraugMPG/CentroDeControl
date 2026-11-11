-- Movimientos de SKU (Gestión de inventario): cambios de ubicación detectados al comparar la Base de stock de un día
-- con la del día anterior (cargas de INICIO consecutivas). Cada par de cargas se calcula una sola vez.
CREATE TABLE IF NOT EXISTS gestion.stock_mov_par (
  carga_ant    integer NOT NULL REFERENCES gestion.cargas(id) ON DELETE CASCADE,
  carga_id     integer NOT NULL REFERENCES gestion.cargas(id) ON DELETE CASCADE,
  fecha_ant    date NOT NULL,
  fecha        date NOT NULL,
  eventos      integer NOT NULL DEFAULT 0,
  calculado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carga_ant, carga_id)
);
-- un evento por SKU y ubicación: E = el SKU aparece en la ubicación, S = deja de estar
-- clase: traslado (sale de una ubicación y entra a otra, o se reparte / consolida sin cambiar su stock total),
--        almacenamiento (ubicación nueva con stock nuevo) o vaciada (sale de la ubicación y su stock total baja)
CREATE TABLE IF NOT EXISTS gestion.stock_mov (
  carga_ant    integer NOT NULL,
  carga_id     integer NOT NULL,
  fecha        date NOT NULL,
  cd           text,
  sku          text NOT NULL,
  ubicacion    text NOT NULL,
  tipo         char(1) NOT NULL CHECK (tipo IN ('E', 'S')),
  qty          numeric NOT NULL DEFAULT 0,
  clase        text NOT NULL,
  entre_cd     boolean NOT NULL DEFAULT false,
  descripcion  text,
  depto        text,
  FOREIGN KEY (carga_ant, carga_id) REFERENCES gestion.stock_mov_par (carga_ant, carga_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS stock_mov_fecha_idx ON gestion.stock_mov (fecha);
CREATE INDEX IF NOT EXISTS stock_mov_sku_idx ON gestion.stock_mov (sku);
CREATE INDEX IF NOT EXISTS stock_sku_idx ON gestion.stock (sku);

-- Movimientos de SKU: lo reciben los roles que ven los resultados de la toma
UPDATE roles SET permisos = array_append(permisos, 'co.inventario.movimientos')
 WHERE 'co.inventario.resultados' = ANY(permisos) AND NOT ('co.inventario.movimientos' = ANY(permisos));
