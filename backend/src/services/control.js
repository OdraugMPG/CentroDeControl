// Control por hora: unidades que salieron de cada etapa en cada hora, contra la meta.
import { q } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { instancia, diaOperativo, inicioHora } from '../lib/turnos.js';

export async function ultimoCortePedidos() {
  const r = (await q(`SELECT corte FROM cargas WHERE tipo = 'pedidos' ORDER BY corte DESC LIMIT 1`)).rows[0];
  return r ? new Date(r.corte).getTime() : null;
}

// Momento de referencia: ahora, o el corte de la última extracción si es anterior
// (las horas posteriores al último dato se muestran como "sin datos", no como incumplidas).
export async function referencia() {
  const corte = await ultimoCortePedidos();
  const ahora = Date.now();
  return { ahora, corte, ref: corte ? Math.min(ahora, corte) : ahora };
}

export async function controlPorHora(fecha, turno, refInfo) {
  const c = await cat();
  const inst = turno === 'dia' ? diaOperativo(fecha, c) : instancia(fecha, turno, c);
  if (!inst) return { inst: null, rows: [] };
  const { ref, corte, ahora } = refInfo || await referencia();
  const [mov, pers] = await Promise.all([
    q(`SELECT area_origen AS area, date_trunc('hour', fecha_hora) AS h, SUM(qty) AS u
       FROM movimientos_etapa WHERE fecha_hora >= $1 AND fecha_hora < $2 GROUP BY 1, 2`, [new Date(inst.start), new Date(inst.end)]),
    q(`SELECT area_origen AS area, date_trunc('hour', fecha_hora) AS h, COUNT(DISTINCT usuario) AS p
       FROM movimientos_etapa WHERE fecha_hora >= $1 AND fecha_hora < $2 AND usuario IS NOT NULL GROUP BY 1, 2`, [new Date(inst.start), new Date(inst.end)])
  ]);
  const acc = {};
  mov.rows.forEach(r => { acc[r.area + '|' + new Date(r.h).getTime()] = { u: r.u, p: 0 }; });
  pers.rows.forEach(r => { const k = r.area + '|' + new Date(r.h).getTime(); if (acc[k]) acc[k].p = r.p; });

  const cur = inicioHora(ref), frac = Math.max(0.05, new Date(ref).getMinutes() / 60);
  const areas = [...c.etapas.map(e => e.area), ...new Set(mov.rows.map(r => r.area).filter(a => !c.etapa[a]))];
  const turnoDe = h => inst.turnoDeHora ? inst.turnoDeHora[h] : inst.turno;
  const umbral = c.p.umbralDesvio ?? 0.85;

  const rows = areas.map(a => {
    const e = c.etapa[a] || { nombre: a, fase: 'Despacho', orden: 99 };
    const cells = inst.horas.map(h => {
      const v = acc[a + '|' + h] || { u: 0, p: 0 };
      const metaH = (c.metas[a] || {})[turnoDe(h)] || 0;
      const estado = h > cur ? 'fut' : h === cur ? 'cur' : 'done';
      const meta = estado === 'fut' ? metaH : estado === 'cur' ? Math.round(metaH * frac) : metaH;
      return { t: h, u: v.u, p: v.p, estado, metaHora: metaH, meta, pct: meta && estado !== 'fut' ? v.u / meta : null };
    });
    const hechas = cells.filter(x => x.estado !== 'fut');
    const u = hechas.reduce((s, x) => s + x.u, 0), mAc = hechas.reduce((s, x) => s + x.meta, 0);
    const pHoras = hechas.reduce((s, x) => s + x.p, 0);
    const ult = cells.filter(x => x.estado === 'done').at(-1) || null;
    return { area: a, nombre: e.nombre, fase: e.fase, metaHora: inst.turnoDeHora ? null : (c.metas[a] || {})[inst.turno] || 0,
      cells, u, mAc, pct: mAc ? u / mAc : null, personasHora: pHoras, prod: pHoras ? u / pHoras : null, ult,
      bajo: ult && ult.pct !== null && ult.pct < umbral };
  });
  const u = rows.reduce((s, r) => s + r.u, 0), mAc = rows.reduce((s, r) => s + r.mAc, 0);
  const transcurridas = inst.horas.filter(h => h <= cur).length;
  const ultT = inst.horas.filter(h => h < cur).at(-1) || null;
  return { inst, ref, corte, ahora, cur, frac, rows, u, mAc, pct: mAc ? u / mAc : null, transcurridas, ultT, umbral };
}

export async function porOperacion(fecha, turno, area, hora) {
  const c = await cat();
  const inst = turno === 'dia' ? diaOperativo(fecha, c) : instancia(fecha, turno, c);
  const desde = hora ? new Date(+hora) : new Date(inst.start);
  const hasta = hora ? new Date(+hora + 3600000) : new Date(inst.end);
  const { rows } = await q(`SELECT COALESCE(operacion, '(sin operación)') AS operacion, SUM(qty) AS unidades,
      COUNT(DISTINCT (date_trunc('hour', fecha_hora), usuario)) FILTER (WHERE usuario IS NOT NULL) AS personas_hora
    FROM movimientos_etapa WHERE area_origen = $1 AND fecha_hora >= $2 AND fecha_hora < $3
    GROUP BY 1 ORDER BY 2 DESC`, [area, desde, hasta]);
  return rows;
}
