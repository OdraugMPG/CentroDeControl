// Conexión de Gestión Diaria: misma base que el centro de control, con sus tablas en el esquema "gestion"
// (tiene sus propias tablas cargas, parametros y tareas, distintas de las del centro de control).
import pg from 'pg';
import '../db.js';   // valida DATABASE_URL y registra los conversores de tipos

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  options: `-c search_path=gestion -c timezone=${process.env.TZ}`
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
