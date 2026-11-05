// Recepción: análisis de lo almacenado (LPN ubicados) por día, turno, hora, CD / operación, usuario, depto y origen.
import { q } from '../db.js';

const ORDEN_TURNO = { AM: 1, PM: 2, NOC: 3 };
const ordTurno = (a, b) => (ORDEN_TURNO[a] || 9) - (ORDEN_TURNO[b] || 9) || String(a).localeCompare(String(b));

export async function analisisAlmacenado({ desde, hasta, cd, turno, operacion } = {}) {
  const { rows: dias } = await q(`SELECT dia, SUM(qty)::int AS unidades, COUNT(DISTINCT lpn)::int AS lpns FROM recepcion_almacenado GROUP BY dia ORDER BY dia`);
  const { rows: [ultima] } = await q(`SELECT archivo, cargado_en, corte, resumen FROM cargas WHERE tipo = 'almacenado' ORDER BY id DESC LIMIT 1`);
  if (!dias.length) return { cargado: false, dias: [], ultima: ultima || null };
  const fin = hasta || desde || dias[dias.length - 1].dia, ini = desde || fin;

  // filtros del rango (sin los propios filtros, para poder cambiarlos)
  const { rows: opciones } = await q(`SELECT DISTINCT COALESCE(cd, '') AS cd, COALESCE(operacion, '') AS operacion, COALESCE(turno, '') AS turno
    FROM recepcion_almacenado WHERE dia BETWEEN $1 AND $2`, [ini, fin]);
  const unicos = (k, f = (a, b) => a.localeCompare(b)) => [...new Set(opciones.map(o => o[k]).filter(Boolean))].sort(f);

  const p = [ini, fin], w = ['dia BETWEEN $1 AND $2'];
  const filtro = (col, v) => { if (v) { p.push(v); w.push(`COALESCE(${col}, '') = $${p.length}`); } };
  filtro('cd', cd); filtro('turno', turno); filtro('operacion', operacion);
  const W = `FROM recepcion_almacenado WHERE ${w.join(' AND ')}`;
  const grupo = async (cols, extra = '', orden = 'unidades DESC') => (await q(`SELECT ${cols.join(', ')}, SUM(qty)::int AS unidades, COUNT(*)::int AS lineas,
      COUNT(DISTINCT lpn)::int AS lpns, COUNT(DISTINCT sku)::int AS skus${extra} ${W} GROUP BY ${cols.map((_, i) => i + 1).join(', ')} ORDER BY ${orden}`, p)).rows;

  const [[tot], porDia, porHora, porArea, porUsuario, porDepto, porOrigen, porFlujo, porJornada] = await Promise.all([
    q(`SELECT COALESCE(SUM(qty), 0)::int AS unidades, COUNT(*)::int AS lineas, COUNT(DISTINCT lpn)::int AS lpns, COUNT(DISTINCT sku)::int AS skus,
        COUNT(DISTINCT NULLIF(asn, ''))::int AS asns, COUNT(DISTINCT usuario)::int AS usuarios, COUNT(DISTINCT ubicacion)::int AS ubicaciones,
        COALESCE(SUM(qty) FILTER (WHERE asn IS NULL), 0)::int AS sin_asn, COUNT(DISTINCT (dia, hora))::int AS horas,
        COUNT(DISTINCT depto)::int AS deptos, MIN(f_mod) AS primera, MAX(f_mod) AS ultima ${W}`, p).then(r => r.rows),
    grupo(['dia', `COALESCE(turno, '') AS turno`], '', 'dia, turno'),
    grupo(['hora', `COALESCE(turno, '') AS turno`], `, COUNT(DISTINCT dia)::int AS dias, COUNT(DISTINCT usuario)::int AS usuarios`, 'hora, turno'),
    grupo([`COALESCE(cd, 'Sin CD') AS cd`, `COALESCE(operacion, 'Sin operación') AS operacion`], `, COUNT(DISTINCT usuario)::int AS usuarios`),
    grupo(['usuario'], `, COUNT(DISTINCT (dia, hora))::int AS horas, MIN(f_mod) AS primera, MAX(f_mod) AS ultima,
      mode() WITHIN GROUP (ORDER BY cd) AS cd, mode() WITHIN GROUP (ORDER BY operacion) AS operacion, mode() WITHIN GROUP (ORDER BY turno) AS turno,
      COUNT(DISTINCT dia)::int AS dias`),
    grupo([`COALESCE(depto, '') AS depto`]),
    grupo([`COALESCE(desde, '') AS desde`]),
    grupo([`COALESCE(flujo, '') AS flujo`]),
    grupo([`COALESCE(jornada, '') AS jornada`])
  ]);
  porDia.sort((a, b) => a.dia.localeCompare(b.dia) || ordTurno(a.turno, b.turno));
  porHora.sort((a, b) => a.hora - b.hora || ordTurno(a.turno, b.turno));
  return {
    cargado: true, ultima, dias, desde: ini, hasta: fin, filtros: { cd: cd || '', turno: turno || '', operacion: operacion || '' },
    opciones: { cds: unicos('cd'), turnos: unicos('turno', ordTurno), operaciones: unicos('operacion') },
    tot, porDia, porHora, porArea, porUsuario,
    porDepto: porDepto.some(x => x.depto) ? porDepto : [],
    porOrigen, porFlujo: porFlujo.some(x => x.flujo) ? porFlujo : [], porJornada: porJornada.some(x => x.jornada) ? porJornada : []
  };
}
