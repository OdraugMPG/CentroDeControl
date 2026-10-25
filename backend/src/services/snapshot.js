// Foto completa para el centro de control (se consulta cada 5 minutos).
import { q } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { fechaOperativa, turnoActual, ultimoTurno, diaOperativo } from '../lib/turnos.js';
import { referencia, controlPorHora } from './control.js';
import { citasDelDia, porHora, ritmoUltimaHora } from './recepcion.js';
import { pendientesDeCierre } from './cierre.js';

const ultimaDe = tabla => q(`SELECT * FROM ${tabla} WHERE carga_id = (SELECT MAX(carga_id) FROM ${tabla})`);

export async function snapshot() {
  const c = await cat();
  const R = await referencia();
  const actual = turnoActual(R.ahora, c), ultimo = ultimoTurno(R.ahora, c);
  const base = actual || ultimo;
  const fechaBase = base?.fecha || fechaOperativa(R.ahora, c);

  const cargaP = (await q(`SELECT * FROM cargas WHERE tipo = 'pedidos' ORDER BY corte DESC LIMIT 1`)).rows[0] || null;
  const pedidos = cargaP ? (await q(`SELECT area, operacion, qty, (EXTRACT(EPOCH FROM f_mod) * 1000)::bigint AS t, orden, nro_ola, jaula, flujo,
      fecha_compromiso, tipo_ola, cd, tipo_od, region, tipo_transaccion, especial, retira, item, descripcion, usuario, transporte, comuna
      FROM pedido_tareas WHERE carga_id = $1`, [cargaP.id])).rows : [];

  const citas = await citasDelDia(fechaBase);
  const dia = diaOperativo(fechaBase, c);
  const horasDia = dia ? dia.horas.filter(h => h <= R.ahora) : [];
  const [zonas, lpns, repos, cargasRA] = await Promise.all([
    ultimaDe('alm_zonas'), ultimaDe('alm_lpn'), ultimaDe('alm_reposiciones'),
    q(`SELECT DISTINCT ON (tipo) tipo, corte, cargado_en, archivo FROM cargas WHERE tipo IN ('recepcion','almacenamiento') ORDER BY tipo, id DESC`)
  ]);
  const ctrl = base ? await controlPorHora(base.fecha, base.turno, R) : null;

  return {
    ahora: R.ahora,
    corte: cargaP ? new Date(cargaP.corte).getTime() : null,
    cargas: {
      pedidos: cargaP ? { archivo: cargaP.archivo, corte: new Date(cargaP.corte).getTime(), cargado_en: new Date(cargaP.cargado_en).getTime() } : null,
      ...Object.fromEntries(cargasRA.rows.map(r => [r.tipo, { archivo: r.archivo, corte: new Date(r.corte).getTime() }]))
    },
    turno: { actual: actual && { fecha: actual.fecha, turno: actual.turno, start: actual.start, end: actual.end },
      base: base && { fecha: base.fecha, turno: base.turno, start: base.start, end: base.end } },
    pedidos: pedidos.map(p => ({ ...p, t: p.t ? Number(p.t) : null })),
    recepcion: { fecha: fechaBase, citas, porHora: porHora(citas, horasDia, R.ahora), ritmo: ritmoUltimaHora(citas, R.ahora),
      turnoDeHora: dia ? dia.turnoDeHora : {} },
    almacenamiento: {
      zonas: zonas.rows,
      lpns: lpns.rows.map(l => ({ ...l, t: l.fecha_recepcion ? new Date(l.fecha_recepcion).getTime() : null })),
      reposiciones: repos.rows
    },
    control: ctrl && { fecha: base.fecha, turno: base.turno, pct: ctrl.pct, u: ctrl.u, mAc: ctrl.mAc, ultT: ctrl.ultT,
      rows: ctrl.rows.map(r => ({ area: r.area, nombre: r.nombre, pct: r.pct, ult: r.ult, bajo: r.bajo })) },
    pendientesCierre: await pendientesDeCierre()
  };
}
