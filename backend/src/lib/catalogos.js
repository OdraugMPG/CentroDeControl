// Caché de catálogos (turnos, calendario, etapas, metas, causas, parámetros).
// Se invalida cuando se modifica la configuración.
import { q } from '../db.js';

let cache = null, cargadoEn = 0;

export function invalidar() { cache = null; }

export async function cat() {
  if (cache && Date.now() - cargadoEn < 60000) return cache;
  const [turnos, calendario, etapas, metas, causas, params] = await Promise.all([
    q('SELECT * FROM turnos ORDER BY orden'),
    q('SELECT * FROM turno_calendario'),
    q('SELECT * FROM etapas ORDER BY orden'),
    q('SELECT * FROM metas_etapa'),
    q('SELECT * FROM causas ORDER BY orden, nombre'),
    q('SELECT * FROM parametros')
  ]);
  const cal = {};
  for (let d = 0; d < 7; d++) cal[d] = [];
  calendario.rows.filter(r => r.activo).forEach(r => cal[r.dia_semana].push(r.turno_id));
  const orden = Object.fromEntries(turnos.rows.map(t => [t.id, t.orden]));
  for (const d in cal) cal[d].sort((a, b) => orden[a] - orden[b]);
  const metasMap = {};
  metas.rows.forEach(m => { (metasMap[m.area] = metasMap[m.area] || {})[m.turno_id] = m.unidades_hora; });
  cache = {
    turnos: turnos.rows,
    turno: Object.fromEntries(turnos.rows.map(t => [t.id, t])),
    calendario: cal,
    etapas: etapas.rows,
    etapa: Object.fromEntries(etapas.rows.map(e => [e.area, e])),
    metas: metasMap,
    causas: causas.rows,
    p: Object.fromEntries(params.rows.map(r => [r.clave, r.valor]))
  };
  cargadoEn = Date.now();
  return cache;
}

// Registra etapas nuevas que aparezcan en una extracción, deduciendo la fase del prefijo numérico.
export async function asegurarEtapas(areas, client) {
  const c = await cat();
  const nuevas = [...new Set(areas)].filter(a => a && !c.etapa[a]);
  if (!nuevas.length) return;
  const run = client || { query: q };
  let orden = Math.max(0, ...c.etapas.map(e => e.orden));
  for (const a of nuevas) {
    const n = parseInt(a, 10) || 0;
    const fase = n <= 3 ? 'Picking' : n === 4 ? 'Consolidación' : n <= 6 ? 'Empaque' : 'Despacho';
    const nombre = a.replace(/^\d+_/, '').replace(/_/g, ' ').toLowerCase().replace(/^./, x => x.toUpperCase());
    await run.query('INSERT INTO etapas VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [a, nombre, fase, ++orden]);
    for (const t of c.turnos) await run.query('INSERT INTO metas_etapa VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [a, t.id]);
  }
  invalidar();
}
