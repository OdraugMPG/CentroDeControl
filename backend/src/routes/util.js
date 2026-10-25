import { cat } from '../lib/catalogos.js';

export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function fecha(v, nombre = 'fecha') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw bad(`Parámetro ${nombre} inválido (YYYY-MM-DD).`);
  return v;
}

export async function turno(v, { dia = false } = {}) {
  if (dia && v === 'dia') return v;
  const c = await cat();
  if (!c.turno[v]) throw bad(`Turno inválido: ${v}`);
  return v;
}

export const texto = (v, max = 500) => v == null ? null : String(v).trim().slice(0, max) || null;
// Nombre del usuario de la sesión (queda registrado en cierres, cargas y tareas)
export const usuarioDe = req => req.usuario?.nombre || null;
