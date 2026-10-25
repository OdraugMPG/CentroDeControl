import './env.js';
import pg from 'pg';

// DATE se devuelve como texto 'YYYY-MM-DD' para evitar corrimientos de zona horaria
pg.types.setTypeParser(1082, v => v);
// BIGINT (count, sum) como número
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Copia .env.example como .env y completa la conexión.');
  process.exit(1);
}

try {
  const u = new URL(process.env.DATABASE_URL);
  if (u.password === 'TU_CLAVE') console.error('Falta poner la contraseña real en backend/.env (reemplaza TU_CLAVE).');
  console.log(`Conectando a PostgreSQL: usuario "${decodeURIComponent(u.username)}", base "${u.pathname.slice(1)}" en ${u.hostname}:${u.port || 5432}`);
} catch { console.error('DATABASE_URL no tiene un formato válido: postgres://usuario:clave@localhost:5432/base'); }

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c timezone=${process.env.TZ}`
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
