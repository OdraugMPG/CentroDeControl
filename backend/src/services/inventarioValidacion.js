// Validación de la toma de inventario por pasada (columna VALIDACION: primera, segunda y tercera).
// Cada pasada se mide en ubicaciones, SKU y unidades (sistema, contado, faltante y sobrante), por día de toma y CD,
// con lo que requiere supervisor, el embudo de una pasada a la siguiente y el detalle por ubicación y SKU.
import { q } from '../db.js';
import { soloFecha, txt } from '../import/excel.js';
import { addDias } from '../lib/turnos.js';
import { paramsInv } from './inventarioCe.js';

const SI = (v) => ['SI', 'S', '1', 'TRUE', 'VERDADERO', 'X', 'Y', 'YES'].includes(String(v || '').trim().toUpperCase());
const LIMITE = 3000;

const nuevo = () => ({ filas: 0, ubic: new Set(), skus: new Set(), sis: 0, cont: 0, falt: 0, sobr: 0, ubicDif: new Set(), lineasDif: 0 });
function acum(x, l) {
  x.filas++; x.ubic.add(l.u); x.skus.add(l.sku); x.sis += l.sistema; x.cont += l.contado;
  const d = l.contado - l.sistema;
  if (d) { x.lineasDif++; x.ubicDif.add(l.u); if (d < 0) x.falt -= d; else x.sobr += d; }
}
const cerrar = (x) => ({ filas: x.filas, ubicaciones: x.ubic.size, skus: x.skus.size, unidSis: x.sis, unidCont: x.cont, falt: x.falt, sobr: x.sobr,
  abs: x.falt + x.sobr, neto: x.sobr - x.falt, lineasDif: x.lineasDif, ubicDif: x.ubicDif.size });

const VER = {
  dif: (x) => !x.ok,                       // siguen con diferencia
  ok: (x) => x.ok && x.pasadas > 1,        // cuadraron al re-contar
  ok1: (x) => x.ok && x.pasadas === 1,     // cuadraron en la 1ª pasada
  sup: (x) => x.sup                        // requieren supervisor
};

/** desde / hasta: fechas de toma (por defecto, la última semana con tomas); cd, zona (3 primeras letras de la ubicación),
 *  turno y empresa opcionales.
 *  ver (dif, ok, ok1, sup) y buscar (ubicación o SKU) filtran solo el detalle. */
export async function validacionToma({ desde, hasta, cd, zona, turno, empresa, ver, buscar } = {}) {
  const { cds: CDS } = await paramsInv();
  const rango = (await q('SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta FROM inv_resultado WHERE cd = ANY($1::text[])', [CDS])).rows[0];
  hasta = soloFecha(hasta) || rango.hasta || null;
  desde = soloFecha(desde) || (hasta ? addDias(hasta, -6) : null);
  if (!hasta) return { datos: null, desde, hasta, cds: [], zonas: [], turnos: [], empresas: [], pasadas: [], sup: null, embudo: null, detalle: [], totalDetalle: 0 };
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const f = (v) => (txt(v) ? txt(v).toUpperCase() : null);
  const [cdF, zonF, turF, empF] = [f(cd), f(zona), f(turno), f(empresa)];

  const [res, opc, zon] = await Promise.all([
    // el último registro de cada pasada por ubicación, SKU y día
    q(`SELECT DISTINCT ON (cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1))
         cd, ubicacion, coalesce(sku, '') AS sku, fecha::text, coalesce(conteo, 1) AS conteo, coalesce(contado, 0)::float AS contado, coalesce(sistema, 0)::float AS sistema,
         upper(coalesce(turno, '')) AS turno, upper(coalesce(empresa, '')) AS empresa, requiere_supervisor, usuario
       FROM inv_resultado
       WHERE fecha BETWEEN $1 AND $2 AND cd = ANY($3::text[]) AND ($4::text IS NULL OR cd = $4)
         AND ($5::text IS NULL OR upper(turno) = $5) AND ($6::text IS NULL OR upper(empresa) = $6) AND ($7::text IS NULL OR left(ubicacion, 3) = $7)
       ORDER BY cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1), f_mod DESC NULLS LAST, id DESC`, [desde, hasta, CDS, cdF, turF, empF, zonF]),
    q(`SELECT array_agg(DISTINCT cd ORDER BY cd) AS cds, array_agg(DISTINCT upper(turno) ORDER BY upper(turno)) FILTER (WHERE turno <> '') AS turnos,
         array_agg(DISTINCT upper(empresa) ORDER BY upper(empresa)) FILTER (WHERE empresa <> '') AS empresas
       FROM inv_resultado WHERE cd = ANY($1::text[])`, [CDS]),
    // zonas (3 primeras letras de la ubicación) con tomas en el rango y el CD elegidos
    q(`SELECT array_agg(DISTINCT left(ubicacion, 3) ORDER BY left(ubicacion, 3)) AS zonas FROM inv_resultado
       WHERE fecha BETWEEN $1 AND $2 AND cd = ANY($3::text[]) AND ($4::text IS NULL OR cd = $4)`, [desde, hasta, CDS, cdF])
  ]);
  const L = res.rows.map((r) => ({ ...r, u: `${r.cd}|${r.ubicacion}` }));

  // por pasada: total, por día y por CD (la matriz día x CD, como la tabla dinámica)
  const fechas = [...new Set(L.map((l) => l.fecha))].sort();
  const cdsDatos = [...new Set(L.map((l) => l.cd))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const bloque = (ls) => {
    const tot = nuevo(), dia = new Map(), celda = new Map(), porCd = new Map();
    const g = (m, k) => { let x = m.get(k); if (!x) m.set(k, (x = nuevo())); return x; };
    for (const l of ls) { acum(tot, l); acum(g(dia, l.fecha), l); acum(g(porCd, l.cd), l); acum(g(celda, `${l.fecha}|${l.cd}`), l); }
    return { tot: cerrar(tot), dias: fechas.map((d) => (dia.has(d) ? cerrar(dia.get(d)) : null)), cds: cdsDatos.map((c) => (porCd.has(c) ? cerrar(porCd.get(c)) : null)),
      celdas: Object.fromEntries([...celda].map(([k, x]) => [k, cerrar(x)])) };
  };
  const nums = [...new Set(L.map((l) => l.conteo))].sort((a, b) => a - b);
  const pasadas = nums.map((n) => ({ conteo: n, ...bloque(L.filter((l) => l.conteo === n)) }));
  const sup = bloque(L.filter((l) => SI(l.requiere_supervisor)));

  // por ubicación y SKU (por día): qué dio cada pasada
  const K = new Map();
  for (const l of L) {
    const k = `${l.cd}|${l.ubicacion}|${l.sku}|${l.fecha}`;
    let x = K.get(k);
    if (!x) K.set(k, (x = { cd: l.cd, ubicacion: l.ubicacion, sku: l.sku, fecha: l.fecha, p: {}, turnos: new Set(), usuarios: new Set(), sup: false }));
    x.p[l.conteo] = { contado: l.contado, sistema: l.sistema };
    if (l.turno) x.turnos.add(l.turno);
    if (l.usuario) x.usuarios.add(l.usuario);
    if (SI(l.requiere_supervisor)) x.sup = true;
  }
  const items = [...K.values()].map((x) => {
    const ns = Object.keys(x.p).map(Number).sort((a, b) => a - b), ult = x.p[ns[ns.length - 1]];
    const dif = ult.contado - ult.sistema, primera = x.p[ns[0]];
    const estado = !dif ? (ns.length > 1 ? `Cuadró en la ${ns[ns.length - 1]}ª pasada` : 'Cuadró en la 1ª pasada')
      : ns.length > 1 ? `Sigue con diferencia tras ${ns.length} pasadas` : 'Con diferencia, sin re-conteo';
    return { cd: x.cd, ubicacion: x.ubicacion, sku: x.sku, fecha: x.fecha, sistema: ult.sistema,
      c: Object.fromEntries(ns.map((n) => [n, x.p[n].contado])), pasadas: ns.length, ultima: ns[ns.length - 1], final: ult.contado, dif,
      difInicial: primera.contado - primera.sistema, estado, ok: !dif, sup: x.sup, turno: [...x.turnos].join(', '), usuario: [...x.usuarios].join(', ') };
  });

  // embudo: de la 1ª pasada a la última
  const conDif1 = items.filter((x) => x.difInicial !== 0);
  const embudo = {
    lineas: items.length, ubicaciones: new Set(items.map((x) => `${x.cd}|${x.ubicacion}`)).size,
    dif1: conDif1.length, a2: items.filter((x) => x.ultima >= 2).length, ok2: items.filter((x) => x.ultima === 2 && x.ok).length,
    a3: items.filter((x) => x.ultima >= 3).length, ok3: items.filter((x) => x.ultima >= 3 && x.ok).length,
    sinRecontar: conDif1.filter((x) => x.pasadas === 1).length, finalDif: items.filter((x) => !x.ok).length
  };

  // match: el mismo SKU falta en una ubicación y sobra en otra del mismo CD; al netear, baja la diferencia de inventario.
  // Con la diferencia final de cada ubicación y SKU (la última toma del rango).
  const ult = new Map();
  for (const x of items) { const k = `${x.cd}|${x.sku}|${x.ubicacion}`, y = ult.get(k); if (!y || x.fecha > y.fecha) ult.set(k, x); }
  const porSku = new Map();
  let absTotal = 0;
  for (const x of ult.values()) {
    if (!x.dif) continue;
    absTotal += Math.abs(x.dif);
    if (!x.sku) continue;
    const k = `${x.cd}|${x.sku}`;
    let g = porSku.get(k);
    if (!g) porSku.set(k, (g = { cd: x.cd, sku: x.sku, ubic: [] }));
    g.ubic.push({ ubicacion: x.ubicacion, fecha: x.fecha, falt: x.dif < 0 ? -x.dif : 0, sobr: x.dif > 0 ? x.dif : 0 });
  }
  const lista = [...porSku.values()].map((g) => {
    const falt = g.ubic.reduce((a, u) => a + u.falt, 0), sobr = g.ubic.reduce((a, u) => a + u.sobr, 0);
    return { ...g, ubic: g.ubic.sort((a, b) => b.falt - a.falt || a.ubicacion.localeCompare(b.ubicacion)), falt, sobr, neteo: Math.min(falt, sobr), queda: sobr - falt };
  }).filter((g) => g.falt && g.sobr)
    .sort((a, b) => a.cd.localeCompare(b.cd, undefined, { numeric: true }) || b.neteo - a.neteo || a.sku.localeCompare(b.sku));
  const neteo = lista.reduce((a, g) => a + g.neteo, 0);
  const match = { lista, skus: lista.length, totales: lista.filter((g) => !g.queda).length, neteo, absTotal, absMatch: 2 * neteo,
    falt: lista.reduce((a, g) => a + g.falt, 0), sobr: lista.reduce((a, g) => a + g.sobr, 0) };

  // detalle: todas las líneas (o las de la vista elegida y la búsqueda); primero las de más pasadas y mayor diferencia final
  const busca = (txt(buscar) || '').toUpperCase();
  const detalle = items.filter((x) => (!VER[ver] || VER[ver](x)) && (!busca || x.ubicacion.includes(busca) || x.sku.toUpperCase().includes(busca)))
    .sort((a, b) => b.pasadas - a.pasadas || Math.abs(b.dif) - Math.abs(a.dif) || a.fecha.localeCompare(b.fecha) || a.ubicacion.localeCompare(b.ubicacion));
  const cuenta = { todo: items.length, ...Object.fromEntries(Object.entries(VER).map(([k, fn]) => [k, items.filter(fn).length])) };

  return {
    datos: rango, desde, hasta, cd: cdF, zona: zonF, turno: turF, empresa: empF, fechas, cdsDatos,
    cds: opc.rows[0].cds || [], zonas: zon.rows[0].zonas || [], turnos: opc.rows[0].turnos || [], empresas: opc.rows[0].empresas || [],
    pasadas, sup, embudo, match, detalle: detalle.slice(0, LIMITE), totalDetalle: detalle.length, cuenta,
    maxPasada: Math.max(3, ...items.map((x) => x.ultima))
  };
}
