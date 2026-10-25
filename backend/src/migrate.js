// Aplica en orden los archivos de server/migrations que aún no se han ejecutado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (nombre text PRIMARY KEY, aplicado_en timestamptz DEFAULT now())');
  const hechas = new Set((await pool.query('SELECT nombre FROM schema_migrations')).rows.map(r => r.nombre));
  const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`Migración aplicada: ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Falló ${f}: ${e.message}`);
    } finally { c.release(); }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => { console.log('Base de datos al día.'); return pool.end(); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
