// Carga backend/.env y fija la zona horaria antes de usar fechas.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// override: el .env manda aunque exista una variable DATABASE_URL en Windows
const r = dotenv.config({ path: path.resolve(here, '../.env'), override: true });
if (r.error) console.warn(`No encontré ${path.resolve(here, '../.env')}. Copia .env.example como .env.`);
process.env.TZ = process.env.TZ || 'America/Santiago';
