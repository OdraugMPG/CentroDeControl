// Almacenamiento: análisis de lo pendiente por almacenar (última foto cargada) con filtros por ZONA, ORIGEN, AÑO, MES, DIA,
// EMPRESA_USUARIO, LEVEL, DESC_DEPTO, TEMPORADA, CD_DESDE y CD. La antigüedad se mide desde FECHA_CREAC (o FECHA_MOD) hasta la carga.
import { q } from '../db.js';
import { cat } from '../lib/catalogos.js';
import { fechaOperativa } from '../lib/turnos.js';

export const DIMS = [['zona', 'Zona'], ['origen', 'Origen'], ['anio', 'Año'], ['mes', 'Mes'], ['dia', 'Día'], ['empresa_usuario', 'Empresa usuario'],
  ['level', 'Level'], ['desc_depto', 'Depto'], ['temporada', 'Temporada'], ['cd_desde', 'CD desde'], ['cd', 'CD']];
const COLS = new Set(DIMS.map(d => d[0]));
const VACIO = '(vacío)';
// tramos de antigüedad en horas
export const TRAMOS = [['< 4 h', 0, 4], ['4 a 12 h', 4, 12], ['12 a 24 h', 12, 24], ['1 a 2 días', 24, 48], ['2 a 3 días', 48, 72], ['3 a 7 días', 72, 168], ['> 7 días', 168, null]];

// Procesos abiertos por turno: cada iLPN pendiente se asigna al turno en que se creó (FECHA_CREAC, o FECHA_MOD si falta),
// que es el turno que lo recibió y lo dejó sin almacenar. Se cuenta por turno (AM, PM, Noche) y por turno de cada día.
async function porTurno(W, pe) {
  const c = await cat();
  const { rows } = await q(`SELECT date_trunc('hour', COALESCE(fecha_creac, fecha_mod)) AS h, COALESCE(zona, '${VACIO}') AS zona,
      COUNT(DISTINCT ilpn)::int AS ilpns, SUM(qty)::int AS unidades, COALESCE(SUM(costo_lpn), 0)::float AS costo,
      SUM(qty * EXTRACT(EPOCH FROM ($${pe.length}::timestamptz - COALESCE(fecha_creac, fecha_mod))) / 3600)::float AS edad_u
    ${W} GROUP BY 1, 2`, pe);
  const turnos = c.turnos.slice().sort((a, b) => a.orden - b.orden);
  const turnoDe = (hora) => turnos.find((t) => (hora - t.hora_inicio + 24) % 24 < t.duracion_h)?.id || 'Sin turno';
  const SIN = 'Sin fecha';
  const nuevo = () => ({ ilpns: 0, unidades: 0, costo: 0, edad_u: 0, zonas: {} });
  const sumar = (x, r) => {
    x.ilpns += r.ilpns; x.unidades += r.unidades; x.costo += r.costo; x.edad_u += r.edad_u || 0;
    const z = x.zonas[r.zona] || (x.zonas[r.zona] = { ilpns: 0, unidades: 0 });
    z.ilpns += r.ilpns; z.unidades += r.unidades;
  };
  const porT = new Map(), porI = new Map(), zonas = new Map();
  for (const r of rows) {
    const t = r.h ? new Date(r.h).getTime() : null;
    const tu = t === null ? SIN : turnoDe(new Date(t).getHours());
    const f = t === null ? null : fechaOperativa(t, c);
    if (!porT.has(tu)) porT.set(tu, nuevo());
    sumar(porT.get(tu), r);
    const k = `${f}|${tu}`;
    if (!porI.has(k)) porI.set(k, { fecha: f, turno: tu, ...nuevo() });
    sumar(porI.get(k), r);
    zonas.set(r.zona, (zonas.get(r.zona) || 0) + r.ilpns);
  }
  const cerrar = ({ edad_u, ...x }) => ({ ...x, edad_prom: x.unidades ? edad_u / x.unidades : null });
  const orden = [...turnos.map((t) => t.id), 'Sin turno', SIN];
  return {
    zonas: [...zonas].sort((a, b) => b[1] - a[1]).map(([z]) => z),
    turnos: [...porT].map(([turno, x]) => ({ turno, ...cerrar(x) })).sort((a, b) => orden.indexOf(a.turno) - orden.indexOf(b.turno)),
    instancias: [...porI.values()].map(cerrar).sort((a, b) => b.ilpns - a.ilpns || b.unidades - a.unidades).slice(0, 60)
  };
}

/** filtros = { zona: ['A', 'B'], cd: ['CD1'], ... } (lista vacía o ausente = todos) */
export async function analisisPendiente(filtros = {}) {
  const { rows: [carga] } = await q(`SELECT id, archivo, cargado_en, corte, resumen FROM cargas WHERE tipo = 'pendiente' ORDER BY id DESC LIMIT 1`);
  if (!carga) return { cargado: false, dims: DIMS };
  const f = Object.fromEntries(Object.entries(filtros).filter(([k, v]) => COLS.has(k) && Array.isArray(v) && v.length).map(([k, v]) => [k, v.map(String)]));

  // WHERE con todos los filtros salvo "excepto" (para las opciones de cada filtro)
  const donde = (excepto) => {
    const p = [carga.id], w = ['carga_id = $1'];
    for (const [k, v] of Object.entries(f)) if (k !== excepto) { p.push(v); w.push(`COALESCE(${k}, '${VACIO}') = ANY($${p.length}::text[])`); }
    return { p, W: `FROM alm_pendiente WHERE ${w.join(' AND ')}` };
  };
  const { p, W } = donde(null);
  const edad = `EXTRACT(EPOCH FROM ($${p.length + 1}::timestamptz - COALESCE(fecha_creac, fecha_mod))) / 3600`;
  const pe = [...p, carga.corte];
  const med = `SUM(qty)::int AS unidades, COUNT(*)::int AS lineas, COUNT(DISTINCT ilpn)::int AS ilpns, COUNT(DISTINCT sku)::int AS skus,
    COALESCE(SUM(costo_lpn), 0)::float AS costo`;
  const grupo = async (col) => (await q(`SELECT COALESCE(${col}, '${VACIO}') AS v, ${med}, MAX(${edad})::float AS edad_max, AVG(${edad})::float AS edad_prom
    ${W} GROUP BY 1 ORDER BY unidades DESC`, pe)).rows;

  const [opciones, [tot], tramos, porZona, porOrigen, porCd, porCdDesde, porDepto, porTemporada, porLevel, porEmpresa, porStatus, porOsr, turnos, antiguos] = await Promise.all([
    Promise.all(DIMS.map(async ([k]) => {
      const d = donde(k);
      return (await q(`SELECT COALESCE(${k}, '${VACIO}') AS v, SUM(qty)::int AS unidades ${d.W} GROUP BY 1`, d.p)).rows;
    })),
    q(`SELECT ${med}, COUNT(DISTINCT ubicacion)::int AS ubicaciones,
        COALESCE(SUM(volumen), 0)::float AS volumen, MAX(${edad})::float AS edad_max,
        (SUM(qty * ${edad}) / NULLIF(SUM(qty) FILTER (WHERE COALESCE(fecha_creac, fecha_mod) IS NOT NULL), 0))::float AS edad_prom,
        COALESCE(SUM(qty) FILTER (WHERE ${edad} >= 24), 0)::int AS mas_24h ${W}`, pe).then(r => r.rows),
    q(`SELECT CASE ${TRAMOS.map(([, a, b], i) => `WHEN ${edad} ${b === null ? `>= ${a}` : `< ${b}`} THEN ${i}`).join(' ')} ELSE NULL END AS tramo,
        SUM(qty)::int AS unidades, COUNT(DISTINCT ilpn)::int AS ilpns ${W} GROUP BY 1 ORDER BY 1`, pe).then(r => r.rows),
    grupo('zona'), grupo('origen'), grupo('cd'), grupo('cd_desde'), grupo('desc_depto'), grupo('temporada'), grupo('level'), grupo('empresa_usuario'),
    grupo('status'), grupo('hay_en_osr'), porTurno(W, pe),
    q(`SELECT ilpn, sku, descripcion, qty, zona, ubicacion, origen, cd_desde, cd, desc_depto, level, empresa_usuario, status,
        COALESCE(fecha_creac, fecha_mod) AS desde, ${edad}::float AS edad ${W} ORDER BY COALESCE(fecha_creac, fecha_mod) NULLS LAST LIMIT 200`, pe).then(r => r.rows)
  ]);
  return {
    cargado: true, carga, dims: DIMS, filtros: f, vacio: VACIO, tramos: TRAMOS.map(t => t[0]),
    opciones: Object.fromEntries(DIMS.map(([k], i) => [k, opciones[i]])),
    tot, porTramo: tramos, porZona, porOrigen, porCd, porCdDesde, porDepto, porTemporada, porLevel, porEmpresa, porStatus, porOsr, porTurno: turnos, antiguos
  };
}
