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

/** desde / hasta: fechas de toma (por defecto, la última semana con tomas); cd, turno y empresa opcionales */
export async function validacionToma({ desde, hasta, cd, turno, empresa } = {}) {
  const { cds: CDS } = await paramsInv();
  const rango = (await q('SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta FROM inv_resultado WHERE cd = ANY($1::text[])', [CDS])).rows[0];
  hasta = soloFecha(hasta) || rango.hasta || null;
  desde = soloFecha(desde) || (hasta ? addDias(hasta, -6) : null);
  if (!hasta) return { datos: null, desde, hasta, cds: [], turnos: [], empresas: [], pasadas: [], sup: null, embudo: null, detalle: [], totalDetalle: 0 };
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const f = (v) => (txt(v) ? txt(v).toUpperCase() : null);
  const [cdF, turF, empF] = [f(cd), f(turno), f(empresa)];

  const [res, opc] = await Promise.all([
    // el último registro de cada pasada por ubicación, SKU y día
    q(`SELECT DISTINCT ON (cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1))
         cd, ubicacion, coalesce(sku, '') AS sku, fecha::text, coalesce(conteo, 1) AS conteo, coalesce(contado, 0)::float AS contado, coalesce(sistema, 0)::float AS sistema,
         upper(coalesce(turno, '')) AS turno, upper(coalesce(empresa, '')) AS empresa, requiere_supervisor, usuario
       FROM inv_resultado
       WHERE fecha BETWEEN $1 AND $2 AND cd = ANY($3::text[]) AND ($4::text IS NULL OR cd = $4)
         AND ($5::text IS NULL OR upper(turno) = $5) AND ($6::text IS NULL OR upper(empresa) = $6)
       ORDER BY cd, ubicacion, coalesce(sku, ''), fecha, coalesce(conteo, 1), f_mod DESC NULLS LAST, id DESC`, [desde, hasta, CDS, cdF, turF, empF]),
    q(`SELECT array_agg(DISTINCT cd ORDER BY cd) AS cds, array_agg(DISTINCT upper(turno) ORDER BY upper(turno)) FILTER (WHERE turno <> '') AS turnos,
         array_agg(DISTINCT upper(empresa) ORDER BY upper(empresa)) FILTER (WHERE empresa <> '') AS empresas
       FROM inv_resultado WHERE cd = ANY($1::text[])`, [CDS])
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
      c1: x.p[1]?.contado ?? null, c2: x.p[2]?.contado ?? null, c3: x.p[3]?.contado ?? null, pasadas: ns.length, final: ult.contado, dif,
      difInicial: primera.contado - primera.sistema, estado, ok: !dif, sup: x.sup, turno: [...x.turnos].join(', '), usuario: [...x.usuarios].join(', ') };
  });

  // embudo: de la 1ª pasada a la última
  const conDif1 = items.filter((x) => x.difInicial !== 0);
  const embudo = {
    lineas: items.length, ubicaciones: new Set(items.map((x) => `${x.cd}|${x.ubicacion}`)).size,
    dif1: conDif1.length, a2: items.filter((x) => x.c2 !== null).length, ok2: items.filter((x) => x.c2 !== null && x.c3 === null && x.ok).length,
    a3: items.filter((x) => x.c3 !== null).length, ok3: items.filter((x) => x.c3 !== null && x.ok).length,
    sinRecontar: conDif1.filter((x) => x.pasadas === 1).length, finalDif: items.filter((x) => !x.ok).length
  };

  // detalle: primero lo que tuvo más de una pasada o sigue con diferencia, por la diferencia final
  const detalle = items.filter((x) => x.pasadas > 1 || !x.ok)
    .sort((a, b) => b.pasadas - a.pasadas || Math.abs(b.dif) - Math.abs(a.dif) || a.ubicacion.localeCompare(b.ubicacion));

  return {
    datos: rango, desde, hasta, cd: cdF, turno: turF, empresa: empF, fechas, cdsDatos,
    cds: opc.rows[0].cds || [], turnos: opc.rows[0].turnos || [], empresas: opc.rows[0].empresas || [],
    pasadas, sup, embudo, detalle: detalle.slice(0, LIMITE), totalDetalle: detalle.length
  };
}
