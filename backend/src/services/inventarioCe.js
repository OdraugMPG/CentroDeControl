// Inventario CD con la programación oficial de Control de Existencia (CE) y el resultado de la toma.
// - Programación: una fila por ubicación con su fecha programada (o re-programada). La operación debe pasar antes:
//   N días hábiles (lunes a sábado) antes de la fecha de CE (con N = 2: CE lunes → viernes, martes → sábado, miércoles → lunes…).
// - Asignación por grupo (día de operación, CD, zona y pasillo): jefe de turno de la empresa externa y supervisor Paris.
// - Resultado de la toma: una fila por ubicación y SKU con CONTADO y SISTEMA. Con la última toma de cada línea se mide:
//   ERI (exactitud de registro de inventario) = unidades correctas / unidades registradas
//       (registradas = SISTEMA; correctas = en cada línea, lo que el conteo confirma: el menor entre CONTADO y SISTEMA)
//   ERU (exactitud de registro de ubicación)  = ubicaciones correctas / total de ubicaciones verificadas
//       (una ubicación es correcta si todos sus SKU cuadran: CONTADO = SISTEMA)
import { q, tx } from '../db.js';
import { buscarTablas, normHeader, txt, num, soloFecha, fechaHora } from '../import/excel.js';
import { cat } from '../lib/catalogos.js';
import { addDias, fechaOperativa } from '../lib/turnos.js';
import { resolverCds, avanceDesdeResultado, SIN_CD } from './inventarioTurnos.js';
import { aplicarAjustes } from './inventarioCalendario.js';

const LOTE = 5000;
const REPROG_MAX_ANTES = 31;   // días
const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const diaSem = (iso) => new Date(`${iso}T12:00:00`).getDay();
const up = (v) => (txt(v) || '').toUpperCase();
const entre = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);

/** N días hábiles (lunes a sábado) antes de la fecha de CE */
export function fechaOperacion(fechaCe, n) {
  let f = fechaCe;
  for (let i = 0; i < n;) { f = addDias(f, -1); if (diaSem(f) !== 0) i++; }
  return f;
}

/** Parámetros del módulo con sus valores por defecto */
export async function paramsInv() {
  const p = (await cat()).p || {};
  const v = (k, d) => (Number.isFinite(Number(p[k])) ? Number(p[k]) : d);
  // CD de almacenamiento: el resultado de la toma de otras áreas (RESERVA, EMPAQUE, PANAL…) no cuenta
  const cds = String(p.invCds || 'CD1,CD2,SHELVING 3,OSR').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  return { cds, diasAntes: v('invDiasAntes', 2), diasPrevios: v('invDiasPrevios', 2), eriSano: v('eriSano', 0.98), eriCritico: v('eriCritico', 0.95), eruSano: v('eruSano', 0.99), eruCritico: v('eruCritico', 0.97) };
}

// ---------- carga de archivos (se reconoce solo cuál es) ----------
// valor de una fila por nombre exacto o por prefijo del encabezado normalizado ("Fecha programada", "Fecha prog.", …)
const campo = (fila, ...claves) => {
  for (const c of claves) {
    if (c in fila) return fila[c];
    const k = Object.keys(fila).find((x) => x.startsWith(c));
    if (k) return fila[k];
  }
  return null;
};

/** todo: la programación del archivo es la base definitiva y reemplaza toda la programación cargada (no solo su rango) */
export async function importarInventario(hojas, archivo, { todo = false } = {}) {
  const res = buscarTablas(hojas, ['UBICACION', 'CONTADO', 'SISTEMA']);
  if (res.length) {
    const r = await guardarResultado(res.flatMap((t) => t.filas), archivo);
    // completa el avance de las tareas de inventario publicadas en la asignación diaria (días de operación hasta 14 días después)
    const dias = []; for (let f = r.desde; f <= addDias(r.hasta, 14); f = addDias(f, 1)) dias.push(f);
    const av = await avanceDesdeResultado(dias).catch(() => ({ actualizadas: 0 }));
    return { tipo: 'resultado', ...r, tareas: av.actualizadas };
  }
  const prog = buscarTablas(hojas, ['UBICACION', 'ZONA', 'PASILLO']).filter((t) => t.filas.some((f) => Object.keys(f).some((k) => k.startsWith('FECHA_PR'))));
  if (prog.length) {
    const r = await guardarPrograma(prog.flatMap((t) => t.filas), archivo, todo);
    // CD de la operación (Loc es el código del centro): desde la Base, para las próximas semanas (el resto se completa al consultar)
    const h = fechaOperativa(Date.now(), await cat());
    await resolverCds({ desde: addDias(h, -30), hasta: addDias(h, 60) }).catch(() => null);
    return { tipo: 'programa', ...r };
  }
  throw Object.assign(new Error('No reconocí el archivo. La programación de CE debe tener Loc, Ubicación, Zona, Pasillo y Fecha programada; el resultado de la toma, UBICACION, CD, SKU, CONTADO y SISTEMA.'), { status: 400 });
}

async function guardarPrograma(crudas, archivo, todo = false) {
  const { diasAntes } = await paramsInv();
  const filas = [];
  let sinFecha = 0, reprogAntigua = 0;
  for (const r of crudas) {
    const cd = up(campo(r, 'LOC', 'CD')), ubic = up(campo(r, 'UBICACION'));
    if (!cd || !ubic) continue;
    const prog = soloFecha(campo(r, 'FECHA_PROGRAMADA', 'FECHA_PR'));
    if (!prog) { sinFecha++; continue; }
    let reprog = soloFecha(campo(r, 'RE_PROGRAMACION', 'REPROGRAMACION', 'RE_PROG', 'REPROG'));
    // una re-programación más de un mes antes de la fecha programada es la toma del ciclo anterior, no una nueva fecha
    if (reprog && reprog < addDias(prog, -REPROG_MAX_ANTES)) { reprog = null; reprogAntigua++; }
    const ce = reprog || prog;
    filas.push({ cd, ubicacion: ubic, seteo: txt(campo(r, 'SETEO')), zona: up(campo(r, 'ZONA')), pasillo: up(campo(r, 'PASILLO')),
      seccion: txt(campo(r, 'SECCION')), vuelta: txt(campo(r, 'VUELTA')), lado: txt(campo(r, 'LADO')),
      fecha_prog: prog, fecha_reprog: reprog, fecha_ce: ce, fecha_op: fechaOperacion(ce, diasAntes),
      fecha_toma: soloFecha(campo(r, 'FECHA_TOMA', 'FECHA_TOM')), mes_prog: txt(campo(r, 'MES_PROGRAMADO', 'MES_PROG')), mes_toma: txt(campo(r, 'MES_DE_TOMA', 'MES_DE_TOM', 'MES_TOMA')) });
  }
  if (!filas.length) throw Object.assign(new Error('El archivo no trae filas con Loc, Ubicación y Fecha programada.'), { status: 400 });
  const fechas = [...new Set(filas.map((f) => f.fecha_prog))].sort();
  const [pDesde, pHasta] = [fechas[0], fechas[fechas.length - 1]];
  const COLS = ['cd', 'ubicacion', 'seteo', 'zona', 'pasillo', 'seccion', 'vuelta', 'lado', 'fecha_prog', 'fecha_reprog', 'fecha_ce', 'fecha_op', 'fecha_toma', 'mes_prog', 'mes_toma'];
  const TIPO = { fecha_prog: 'date', fecha_reprog: 'date', fecha_ce: 'date', fecha_op: 'date', fecha_toma: 'date' };
  let reemplazadas = 0, ajustadas = 0;
  await tx(async (c) => {
    // cada carga reemplaza todo el rango de fechas programadas que cubre (las asignaciones van aparte y se conservan)
    reemplazadas = (todo ? await c.query('DELETE FROM inv_programa')
      : await c.query('DELETE FROM inv_programa WHERE fecha_prog BETWEEN $1 AND $2', [pDesde, pHasta])).rowCount;
    const sql = `INSERT INTO inv_programa (${COLS.join(', ')}, archivo) SELECT *, $${COLS.length + 1} FROM unnest(${COLS.map((k, i) => `$${i + 1}::${TIPO[k] || 'text'}[]`).join(', ')})`;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(sql, [...COLS.map((k) => lote.map((f) => f[k])), archivo]);
    }
    // el layout (CD, zona, pasillo) lo usan otras vistas para elegir CD
    const lay = [...new Map(filas.map((f) => [`${f.cd}|${f.zona}|${f.pasillo}`, f])).values()];
    await c.query(`INSERT INTO inv_layout (cd, nivel, zona, pasillo) SELECT a, '', b, c FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a, b, c) ON CONFLICT DO NOTHING`,
      [lay.map((f) => f.cd), lay.map((f) => f.zona), lay.map((f) => f.pasillo)]);
    // los ajustes hechos en la web (Calendario de planificación) se vuelven a aplicar
    ajustadas = await aplicarAjustes(c, fechas);
  });
  const ops = filas.map((f) => f.fecha_op).sort();
  return { filas: filas.length, sinFecha, reprogAntigua, reemplazadas, todo, desde: pDesde, hasta: pHasta, opDesde: ops[0], opHasta: ops[ops.length - 1], reprogramadas: filas.filter((f) => f.fecha_reprog).length, ajustadas };
}

async function guardarResultado(crudas, archivo) {
  const filas = [];
  for (const r of crudas) {
    const cd = up(campo(r, 'CD')), ubic = up(campo(r, 'UBICACION'));
    const fmod = fechaHora(campo(r, 'F_MOD'));
    const fecha = soloFecha(campo(r, 'FECHA')) || (fmod ? soloFecha(fmod) : null);
    if (!cd || !ubic || !fecha) continue;
    const contado = num(campo(r, 'CONTADO')), sistema = num(campo(r, 'SISTEMA'));
    filas.push({ cd, ubicacion: ubic, empresa: up(campo(r, 'EMPRESA')) || null, zona: up(campo(r, 'ZONA')), pasillo: up(campo(r, 'PASILLO')), sku: txt(campo(r, 'SKU')),
      // DIFERENCIA del reporte viene en positivo (el signo está en ESTADO): se guarda con signo, CONTADO − SISTEMA
      contado, sistema, diferencia: contado - sistema, conteo: conteoDe(campo(r, 'VALIDACION')), estado: txt(campo(r, 'ESTADO')), usuario: txt(campo(r, 'USUARIO')),
      fecha, f_mod: fmod, turno: txt(campo(r, 'TURNO')), validacion: txt(campo(r, 'VALIDACION')), requiere_supervisor: txt(campo(r, 'REQUIERE_SUPERVISOR')),
      nivel_urgencia: txt(campo(r, 'NIVEL_URGENCIA')), ultimo_registro: txt(campo(r, 'ULTIMO_REGISTRO')) });
  }
  if (!filas.length) throw Object.assign(new Error('El archivo no trae filas con UBICACION, CD y FECHA.'), { status: 400 });
  const fechas = [...new Set(filas.map((f) => f.fecha))].sort();
  const COLS = ['cd', 'ubicacion', 'empresa', 'zona', 'pasillo', 'sku', 'contado', 'sistema', 'diferencia', 'conteo', 'estado', 'usuario', 'fecha', 'f_mod', 'turno', 'validacion', 'requiere_supervisor', 'nivel_urgencia', 'ultimo_registro'];
  const TIPO = { contado: 'numeric', sistema: 'numeric', diferencia: 'numeric', conteo: 'smallint', fecha: 'date', f_mod: 'timestamp' };
  let reemplazadas = 0;
  await tx(async (c) => {
    // se reemplazan los días que trae el archivo
    reemplazadas = (await c.query('DELETE FROM inv_resultado WHERE fecha = ANY($1::date[])', [fechas])).rowCount;
    const sql = `INSERT INTO inv_resultado (${COLS.join(', ')}, archivo) SELECT *, $${COLS.length + 1} FROM unnest(${COLS.map((k, i) => `$${i + 1}::${TIPO[k] || 'text'}[]`).join(', ')})`;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      await c.query(sql, [...COLS.map((k) => lote.map((f) => f[k])), archivo]);
    }
  });
  return { filas: filas.length, reemplazadas, desde: fechas[0], hasta: fechas[fechas.length - 1], ubicaciones: new Set(filas.map((f) => `${f.cd}|${f.ubicacion}`)).size };
}

// ---------- asignación ----------
export async function asignar({ grupos, jefe_empresa, empresa, supervisor }, usuario) {
  if (!Array.isArray(grupos) || !grupos.length) throw Object.assign(new Error('Selecciona al menos un grupo.'), { status: 400 });
  const t = (v) => (txt(v) || null);
  await tx(async (c) => {
    for (const g of grupos.slice(0, 2000)) {
      const f = soloFecha(g.fecha_op); if (!f || !txt(g.cd)) continue;
      await c.query(`INSERT INTO inv_asig (fecha_op, cd, zona, pasillo, jefe_empresa, empresa, supervisor, asignado_por, actualizado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) ON CONFLICT (fecha_op, cd, zona, pasillo) DO UPDATE SET
          jefe_empresa = EXCLUDED.jefe_empresa, empresa = EXCLUDED.empresa, supervisor = EXCLUDED.supervisor, asignado_por = EXCLUDED.asignado_por, actualizado_en = now()`,
        [f, up(g.cd), up(g.zona), up(g.pasillo), t(jefe_empresa), t(empresa)?.toUpperCase() || null, t(supervisor), usuario]);
    }
  });
  return { asignados: grupos.length };
}

// ---------- análisis ----------
const ULTIMO = `(upper(coalesce(ultimo_registro, '')) IN ('SI', 'S', '1', 'TRUE', 'VERDADERO', 'X', 'Y', 'YES'))`;
/** Número de conteo desde VALIDACION: PRIMERA = 1, SEGUNDA = 2, TERCERA = 3 */
export function conteoDe(v) {
  const s = up(v);
  const n = ['PRI', 'SEG', 'TER', 'CUA', 'QUI', 'SEX', 'SEP', 'OCT', 'NOV'].findIndex((p) => s.startsWith(p));
  return n >= 0 ? n + 1 : /^\d+/.test(s) ? Math.min(9, parseInt(s, 10)) : 1;
}
/** CTE "fin": el resultado final de cada ubicación y SKU. Por día, el conteo más alto (luego ULTIMO_REGISTRO y F_MOD);
 *  y si dentro de 7 días hay un conteo posterior de la misma ubicación y SKU (re-conteo otro día), vale ese. */
export const finales = (cond) => `t AS (
    SELECT DISTINCT ON (cd, ubicacion, coalesce(sku, ''), fecha) *
    FROM inv_resultado WHERE ${cond}
    ORDER BY cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1) DESC, ${ULTIMO} DESC, f_mod DESC NULLS LAST, id DESC),
  fin AS (SELECT * FROM t WHERE NOT EXISTS (SELECT 1 FROM t t2 WHERE t2.cd = t.cd AND t2.ubicacion = t.ubicacion AND coalesce(t2.sku, '') = coalesce(t.sku, '')
    AND t2.fecha > t.fecha AND t2.fecha <= t.fecha + 7 AND coalesce(t2.conteo, 1) > coalesce(t.conteo, 1)))`;

/** desde / hasta: rango de días de operación (por = 'op') o de fechas programadas de CE (por = 'ce', como el calendario).
 *  Devuelve los grupos con su avance y ERI / ERU, y los cortes de los resultados. */
export async function analisisInventario({ desde, hasta, cd, por } = {}) {
  const p = await paramsInv();
  const hoy = fechaOperativa(Date.now(), await cat());
  desde = soloFecha(desde) || addDias(hoy, -7);
  hasta = soloFecha(hasta) || addDias(hoy, 14);
  const cdF = txt(cd) ? up(cd) : null;
  const porCe = por === 'ce';
  const opDesde = porCe ? addDias(desde, -10) : desde;   // la operación pasa unos días antes que CE

  await resolverCds({ desde: opDesde, hasta }).catch(() => null);
  const [prog, asig, lineas, cargas, cds] = await Promise.all([
    q(`SELECT coalesce(cd_op, '${SIN_CD}') AS cd, cd AS loc, ubicacion, zona, pasillo, fecha_op::text, fecha_ce::text, fecha_prog::text, fecha_reprog::text, fecha_toma::text
       FROM inv_programa WHERE NOT excluida AND ${porCe ? 'fecha_ce' : 'fecha_op'} BETWEEN $1 AND $2 AND ($3::text IS NULL OR coalesce(cd_op, '${SIN_CD}') = $3)`, [desde, hasta, cdF]),
    q('SELECT fecha_op::text, cd, zona, pasillo, jefe_empresa, empresa, supervisor, asignado_por, automatica, turno FROM inv_asig WHERE fecha_op BETWEEN $1 AND $2', [opDesde, hasta]),
    // última toma de cada ubicación y SKU por día, unida a la programación más cercana de esa ubicación: cuenta desde
    // p.diasPrevios días antes del día de operación (una toma más antigua no es resultado de ese grupo) hasta 30 días después
    q(`WITH ${finales('fecha BETWEEN $1::date - 14 AND $2::date + 30 AND ($3::text IS NULL OR cd = $3) AND cd = ANY($5::text[])')}
       SELECT f.cd, f.ubicacion, f.empresa, f.zona, f.pasillo, f.sku, f.contado::float, f.sistema::float, f.diferencia::float, f.estado, f.usuario,
         f.fecha::text, f.turno, f.validacion, f.requiere_supervisor, f.nivel_urgencia,
         pr.fecha_op::text AS p_op, pr.cd AS p_cd, pr.zona AS p_zona, pr.pasillo AS p_pasillo
       FROM fin f LEFT JOIN LATERAL (
         SELECT fecha_op, coalesce(cd_op, '${SIN_CD}') AS cd, zona, pasillo FROM inv_programa x WHERE x.ubicacion = f.ubicacion AND NOT x.excluida AND f.fecha BETWEEN x.fecha_op - $4::int AND x.fecha_op + 30
         ORDER BY abs(x.fecha_op - f.fecha) LIMIT 1) pr ON true`, [desde, hasta, cdF, p.diasPrevios, p.cds]),
    q(`SELECT 'programa' AS tipo, max(archivo) AS archivo, max(cargado_en) AS cargado_en, count(*)::int AS filas FROM inv_programa
       UNION ALL SELECT 'resultado', max(archivo), max(cargado_en), count(*)::int FROM inv_resultado`),
    q(`SELECT DISTINCT coalesce(cd_op, '${SIN_CD}') AS cd FROM inv_programa WHERE fecha_op BETWEEN $1::date - 60 AND $2::date + 60 UNION SELECT DISTINCT cd FROM inv_resultado WHERE cd = ANY($3::text[]) ORDER BY 1`, [desde, hasta, p.cds])
  ]);

  // resultados: solo los del rango (por su día de operación programado o, si no está en la programación, por su fecha)
  // resultados de los grupos del rango (o, si la toma no está en la programación, por su fecha)
  const enRango = new Set(prog.rows.map((r) => `${r.fecha_op}|${r.cd}|${r.zona}|${r.pasillo}`));
  const L = lineas.rows.filter((l) => (l.p_op ? enRango.has(`${l.p_op}|${l.p_cd}|${l.p_zona}|${l.p_pasillo}`) : l.fecha >= desde && l.fecha <= hasta))
    .map((l) => ({ ...l, reg: Math.max(0, l.sistema), corr: Math.max(0, Math.min(l.contado, l.sistema)), ok: l.contado === l.sistema,
      loc: `${l.cd}|${l.ubicacion}|${l.fecha}`,
      tipo: l.contado === l.sistema ? '' : l.sistema <= 0 ? 'NO REGISTRADO' : l.contado <= 0 ? 'NO ENCONTRADO' : l.contado > l.sistema ? 'SOBRANTE' : 'FALTANTE' }));
  // ubicación correcta: todos sus SKU cuadran (por día de toma)
  const locOk = new Map();
  for (const l of L) locOk.set(l.loc, (locOk.get(l.loc) ?? true) && l.ok);
  const acum = (x, l) => { x.lineas++; x.reg += l.reg; x.corr += l.corr; x.locs.add(l.loc); if (!l.ok) { x.dif++; x.unidDif += Math.abs(l.contado - l.sistema); } };
  const indicadores = (x) => {
    let ok = 0; for (const k of x.locs) if (locOk.get(k)) ok++;
    return { lineas: x.lineas, ubicaciones: x.locs.size, ubicOk: ok, dif: x.dif, unidDif: x.unidDif, unidReg: x.reg, unidCorr: x.corr,
      eri: x.reg ? x.corr / x.reg : null, eru: x.locs.size ? ok / x.locs.size : null };
  };

  const clave = (f, cd, z, pa) => `${f}|${cd}|${z}|${pa}`;
  const A = new Map(asig.rows.map((a) => [clave(a.fecha_op, a.cd, a.zona, a.pasillo), a]));
  const G = new Map();
  for (const r of prog.rows) {
    const k = clave(r.fecha_op, r.cd, r.zona, r.pasillo);
    let g = G.get(k);
    if (!g) {
      const a = A.get(k);
      g = { k, fecha_op: r.fecha_op, dia_op: DIAS[diaSem(r.fecha_op)], cd: r.cd, zona: r.zona, pasillo: r.pasillo, fecha_ce: r.fecha_ce, dia_ce: DIAS[diaSem(r.fecha_ce)],
        reprog: 0, ubic: new Set(), tomaCe: 0, jefe_empresa: a?.jefe_empresa || '', empresa: a?.empresa || '', supervisor: a?.supervisor || '', turno: a?.turno || null, auto: !!a?.automatica, contadas: new Set(), primera: null, ultima: null, lineas: 0, reg: 0, corr: 0, locs: new Set(), dif: 0, unidDif: 0 };
      G.set(k, g);
    }
    g.ubic.add(r.ubicacion); if (r.fecha_reprog) g.reprog++; if (r.fecha_toma) g.tomaCe++;
    if (r.fecha_ce < g.fecha_ce) g.fecha_ce = r.fecha_ce;
  }
  for (const l of L) {
    if (!l.p_op) continue;
    const g = G.get(clave(l.p_op, l.p_cd, l.p_zona, l.p_pasillo)); if (!g) continue;
    g.contadas.add(l.ubicacion); acum(g, l);
    if (!g.primera || l.fecha < g.primera) g.primera = l.fecha;
    if (!g.ultima || l.fecha > g.ultima) g.ultima = l.fecha;
  }
  const grupos = [...G.values()].map((g) => {
    const ubicaciones = g.ubic.size, contadas = g.contadas.size;
    const estado = contadas >= ubicaciones ? (g.ultima <= g.fecha_op ? 'A TIEMPO' : 'CON RETRASO')
      : contadas > 0 ? (g.fecha_op < hoy ? 'PARCIAL VENCIDO' : 'PARCIAL')
      : g.fecha_op < hoy ? 'NO REALIZADO' : g.fecha_op === hoy ? 'HOY' : 'PROGRAMADO';
    // días de demora: de la operación a la última toma; sin terminar y vencido, hasta hoy (pendiente)
    const pend = contadas < ubicaciones && g.fecha_op < hoy;
    const demora = pend ? entre(g.fecha_op, hoy) : g.ultima ? Math.max(0, entre(g.fecha_op, g.ultima)) : null;
    return { k: g.k, fecha_op: g.fecha_op, dia_op: g.dia_op, cd: g.cd, zona: g.zona, pasillo: g.pasillo, fecha_ce: g.fecha_ce, dia_ce: g.dia_ce,
      ubicaciones, contadas, avance: ubicaciones ? contadas / ubicaciones : 0, reprog: g.reprog, tomaCe: g.tomaCe,
      jefe_empresa: g.jefe_empresa, empresa: g.empresa, supervisor: g.supervisor, turno: g.turno, auto: g.auto, primera: g.primera, ultima: g.ultima, estado, demora, demoraPend: pend,
      ...(({ ubicaciones: verificadas, ...ind }) => ({ ...ind, verificadas }))(indicadores(g)) };
  }).sort((a, b) => a.fecha_op.localeCompare(b.fecha_op) || a.cd.localeCompare(b.cd) || a.zona.localeCompare(b.zona) || a.pasillo.localeCompare(b.pasillo, undefined, { numeric: true }));

  // cortes de ERI / ERU
  const corte = (fn) => {
    const m = new Map();
    for (const l of L) {
      const k = fn(l) || '(sin dato)';
      let x = m.get(k); if (!x) { x = { v: k, lineas: 0, reg: 0, corr: 0, locs: new Set(), dif: 0, unidDif: 0 }; m.set(k, x); }
      acum(x, l);
    }
    return [...m.values()].map((x) => ({ v: x.v, ...indicadores(x) }))
      .sort((a, b) => b.lineas - a.lineas);
  };
  const jefeDe = new Map(grupos.map((g) => [g.k, g.jefe_empresa]));
  const supDe = new Map(grupos.map((g) => [g.k, g.supervisor]));
  const kL = (l) => (l.p_op ? clave(l.p_op, l.p_cd, l.p_zona, l.p_pasillo) : '');
  const tot = corte(() => 'TOTAL')[0] || { lineas: 0, ubicaciones: 0, ubicOk: 0, dif: 0, unidDif: 0, unidReg: 0, unidCorr: 0, eri: null, eru: null };

  const URG = { ALTA: 0, CRITICA: 0, CRÍTICA: 0, MEDIA: 1, BAJA: 2 };
  const diferencias = L.filter((l) => !l.ok)
    .sort((a, b) => (URG[up(a.nivel_urgencia)] ?? 3) - (URG[up(b.nivel_urgencia)] ?? 3) || Math.abs(b.diferencia) - Math.abs(a.diferencia))
    .slice(0, 500)
    .map((l) => ({ ...l, jefe_empresa: jefeDe.get(kL(l)) || '', supervisor: supDe.get(kL(l)) || '' }));

  const sumG = (f) => grupos.filter(f).length;
  return {
    hoy, desde, hasta, cd: cdF, por: porCe ? 'ce' : 'op', cds: cds.rows.map((x) => x.cd), param: p,
    cargas: Object.fromEntries(cargas.rows.map((c) => [c.tipo, c.filas ? c : null])),
    grupos,
    resumen: {
      grupos: grupos.length, ubicaciones: grupos.reduce((a, g) => a + g.ubicaciones, 0), contadas: grupos.reduce((a, g) => a + g.contadas, 0),
      aTiempo: sumG((g) => g.estado === 'A TIEMPO'), retraso: sumG((g) => g.estado === 'CON RETRASO'), noRealizado: sumG((g) => ['NO REALIZADO', 'PARCIAL VENCIDO'].includes(g.estado)),
      pendientes: sumG((g) => ['PROGRAMADO', 'HOY', 'PARCIAL'].includes(g.estado)), sinAsignar: sumG((g) => !g.jefe_empresa), fueraPrograma: L.filter((l) => !l.p_op).length
    },
    tot,
    porJefe: corte((l) => jefeDe.get(kL(l)) || (l.p_op ? 'Sin asignar' : 'Fuera de la programación')),
    porSupervisor: corte((l) => supDe.get(kL(l)) || (l.p_op ? 'Sin asignar' : 'Fuera de la programación')),
    porEmpresa: corte((l) => l.empresa), porTurno: corte((l) => up(l.turno)), porUsuario: corte((l) => l.usuario), porCd: corte((l) => l.cd), porZona: corte((l) => `${l.cd} · ${l.zona || l.p_zona || '—'}`),
    porDia: corte((l) => l.p_op || l.fecha).sort((a, b) => a.v.localeCompare(b.v)),
    diferencias, totalDiferencias: L.filter((l) => !l.ok).length,
    jefes: [...new Set(asig.rows.map((a) => a.jefe_empresa).concat((await q('SELECT DISTINCT jefe_empresa FROM inv_asig WHERE jefe_empresa IS NOT NULL')).rows.map((x) => x.jefe_empresa)).filter(Boolean))].sort(),
    empresas: [...new Set((await q("SELECT DISTINCT empresa FROM inv_resultado WHERE empresa IS NOT NULL UNION SELECT DISTINCT empresa FROM inv_asig WHERE empresa IS NOT NULL")).rows.map((x) => x.empresa))].sort()
  };
}
