// Sugerencia de aumento de la participación del OSR para bajar headcount de picking manual en los demás CD.
// Parte de la misma simulación de Participación por CD (filtros, CD que entran, tipo de picking, target) y ordena los SKU
// que hoy venden desde otros CD en tres olas: 1) aptos (Logística OSR = Y) que no están en OSR, 2) SKU que ya están en OSR
// pero parte de su venta sale de otros CD (ampliar su stock en OSR) y 3) no aptos (requieren habilitarse: validar medidas).
// Cada SKU necesita en OSR su venta diaria x días de cobertura, guardada en compartimentos de tote (half = ½, quarter = ¼,
// con la capacidad de un tote entero por depto: percentil 90 de las unidades por tote del OSR). Así se sabe cuántas
// ubicaciones nuevas (compartimentos) y totes hacen falta, contra las posiciones libres del OSR (capacidad por rack line) y
// los totes que se liberan reempacando lo que ya está en OSR. El headcount sale de las unidades por día que dejan de
// pickearse a mano (÷ unidades por hora-hombre del picking manual ÷ horas del turno), menos las que suma el OSR.
import { q } from '../db.js';
import { calcularParticipacion, ESTADOS, TEMPS, NOM_TEMP } from './participacionCd.js';
import { CLASES } from './potencialOsr.js';
import { baseSku } from './abastecimientoOsr.js';
import { capacidadTotes, empaque } from './potencialOsr.js';
import { capacidadOsr } from './totesOsr.js';
import { up } from '../engine/util.js';
import { leerParametros } from './parametros.js';

const LIMITE = 400;
const OLAS = [
  { ola: 1, nombre: 'Ingresar SKU aptos', detalle: 'Logística OSR = "Y" y sin stock en OSR' },
  { ola: 2, nombre: 'Ampliar stock en OSR', detalle: 'ya están en OSR, pero parte de su venta sale de otros CD' },
  { ola: 3, nombre: 'Habilitar no aptos', detalle: 'Logística OSR N o REVISION: validar medidas y peso para tote' },
];
const OLA_DE = { [ESTADOS.CAND]: 1, [ESTADOS.SIN_VAL]: 1, [ESTADOS.EN]: 2, [ESTADOS.NO]: 3 };
const num0 = (v, d) => (v === undefined || v === null || v === '' || !(Number(v) >= 0) ? d : Number(v));
const p90 = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? Math.max(4, Math.round(s[Math.floor(0.9 * (s.length - 1))])) : null; };

/** Capacidad de un tote entero por depto y totes que se liberan reempacando lo que ya está en OSR (con la distribución cargada). */
async function capacidades() {
  const base = await baseSku();
  const info = new Map(base.skus.map((x) => [x.sku, x]));
  const { rows: dist } = await q('SELECT sku, stock::float8 AS stock, full_t, half_t, quarter_t FROM osr_totes');
  if (!dist.length) {
    const caps = await capacidadTotes(base.carga, base.osr, base.skus);
    return { ...caps, fuente: 'BASE', libera: null };
  }
  const ocup = dist.map((d) => {
    const totes = d.full_t + d.half_t / 2 + d.quarter_t / 4;
    return { depto: info.get(d.sku)?.depto || '(sin Base)', stock: d.stock, totes, porTote: totes ? d.stock / totes : 0 };
  }).filter((o) => o.totes > 0);
  const porDep = new Map(), todos = [];
  for (const o of ocup) {
    if (!(o.porTote > 0)) continue;
    todos.push(o.porTote);
    if (!porDep.has(o.depto)) porDep.set(o.depto, []);
    porDep.get(o.depto).push(o.porTote);
  }
  const global = p90(todos) || 40;
  const porDepto = new Map([...porDep].filter(([, l]) => l.length >= 10).map(([d, l]) => [d, p90(l)]));
  // reempaque de lo que ya está en OSR: totes enteros llenos + half / quarter para el resto
  let hoy = 0, opt = 0;
  for (const o of ocup) {
    const cap = Math.max(porDepto.get(o.depto) || global, Math.ceil(o.porTote));
    hoy += o.totes; opt += empaque(o.stock, cap, 'AUTO').totes;
  }
  return { global, porDepto, fuente: 'DISTRIBUCION', libera: Math.max(0, Math.floor(hoy) - Math.ceil(opt)), totesHoy: Math.ceil(hoy) };
}

export async function sugerenciaOsr(params = {}) {
  const d = await calcularParticipacion(params);
  if (d.sinDatos) return { sinDatos: true };
  const p = await leerParametros();
  const osr = up(p.cdOsr);
  if (d.cdObj !== osr) return { aplica: false, cdObj: d.cdObj, osr };
  const cob = num0(params.cob, 7) || 7;
  const modo = ['AUTO', 'HALF', 'QUARTER'].includes(params.almac) ? params.almac : 'AUTO';
  const pickUnHH = num0(params.pickUnHH, p.pickUnHH) || 60;
  const osrUnHH = num0(params.osrUnHH, p.osrUnHH);
  const horas = Math.max(1, Number(p.horasTurno) || 8);
  let ocupMax = Number(params.ocupMax);
  if (!(ocupMax > 0)) ocupMax = 0.85;
  if (ocupMax > 1) ocupMax /= 100;
  const dias = Math.max(1, d.porDia.filter((x) => x.fecha).length);
  const { sim, cdObj } = d;

  const [caps, cap] = await Promise.all([capacidades(), capacidadOsr({ target: ocupMax })]);
  const espacio = cap.cargada
    ? { cargada: true, positions: cap.tot.positions, occupied: cap.tot.occupied, ocup: cap.tot.ocup, libre: cap.tot.libre, hastaMeta: Math.max(0, cap.tot.hastaTarget), ocupMax, cargado: cap.cargado }
    : { cargada: false, ocupMax };
  espacio.libera = caps.libera;
  espacio.fuenteCap = caps.fuente;
  espacio.capGlobal = caps.global;

  // candidatos por ola, de mayor a menor venta en otros CD
  const cand = [];
  for (const x of d.skus) {
    const ola = OLA_DE[x.estado];
    if (!ola || !(x.otros > 0)) continue;
    const ventaDia = x.u / dias;
    const necesita = Math.max(1, Math.ceil(ventaDia * cob));
    // ola 2: solo hace falta espacio para lo que no cabe en el stock que ya tiene en OSR
    const guardar = ola === 2 ? Math.max(0, necesita - Math.max(0, x.b?.osr || 0)) : necesita;
    const capT = Math.max(1, caps.porDepto.get(x.b?.depto) || caps.global);
    const e = guardar > 0 ? empaque(guardar, capT, modo) : { comps: { ENTERO: 0, HALF: 0, QUARTER: 0 }, totes: 0, almac: 'sin ubicación nueva' };
    const enteros = guardar > 0 ? empaque(guardar, capT, 'ENTERO').totes : 0;
    cand.push({ x, ola, ventaDia, necesita, guardar, cap: capT, e, enteros });
  }
  // olas 1 y 2 juntas, primero lo que más participación suma por tote (ampliar un SKU que ya tiene espacio no ocupa
  // ubicaciones nuevas); la ola 3 al final porque requiere habilitar los SKU
  const rinde = (c) => c.x.otros / Math.max(c.e.totes, 0.05);
  cand.sort((a, b) => (a.ola === 3) - (b.ola === 3) || rinde(b) - rinde(a) || b.x.otros - a.x.otros);

  // acumulados
  const ac = [];
  let u = sim.obj, totes = 0, enteros = 0;
  const comps = { ENTERO: 0, HALF: 0, QUARTER: 0 };
  for (const c of cand) {
    u += c.x.otros; totes += c.e.totes; enteros += c.enteros;
    for (const k of Object.keys(comps)) comps[k] += c.e.comps[k];
    ac.push({ u, pct: sim.u ? u / sim.u : 0, totes, enteros, comps: { ...comps } });
  }
  // espacio: posiciones libres hasta la ocupación máxima; si no alcanza, sumando los totes que libera el reempaque;
  // después, sobre la ocupación máxima (todas las libres) y si aún no alcanza, faltan posiciones
  const libera = espacio.libera || 0;
  const estadoEsp = (t) => (!espacio.cargada ? 'SIN DATO' : t <= espacio.hastaMeta ? 'OK' : t <= espacio.hastaMeta + libera ? 'CON REEMPAQUE'
    : t <= espacio.libre + libera ? 'SOBRE LA META' : 'FALTA');
  const escenario = (i) => {
    const a = i >= 0 ? ac[i] : { u: sim.obj, pct: sim.pct, totes: 0, enteros: 0, comps: { ENTERO: 0, HALF: 0, QUARTER: 0 } };
    const sel = cand.slice(0, i + 1);
    const mueve = a.u - sim.obj, uDia = mueve / dias;
    const opManual = uDia / pickUnHH / horas, opOsr = osrUnHH > 0 ? uDia / osrUnHH / horas : 0;
    const tot = Math.ceil(a.totes);
    return {
      skus: sel.length, porOla: OLAS.map((o) => sel.filter((c) => c.ola === o.ola).length), pct: a.pct, u: a.u, mueve, uDia,
      comps: a.comps, ubicaciones: a.comps.ENTERO + a.comps.HALF + a.comps.QUARTER, totes: tot, totesEnteros: Math.ceil(a.enteros),
      totesHalf: Math.ceil(a.comps.HALF / 2), totesQuarter: Math.ceil(a.comps.QUARTER / 4),
      espacio: estadoEsp(tot), sobreLibres: espacio.cargada ? Math.max(0, tot - espacio.hastaMeta) : null,
      faltan: espacio.cargada ? Math.max(0, tot - espacio.libre - libera) : null,
      opManual, opOsr, neto: opManual - opOsr,
    };
  };

  // escalones: cada 5 puntos desde el actual, el target y el final de cada ola
  const marcas = new Map();
  const idxPct = (t) => ac.findIndex((a) => a.pct >= t - 1e-9);
  for (let t = Math.ceil((sim.pct * 100 + 1) / 5) * 5; t <= 100; t += 5) {
    const i = idxPct(t / 100);
    if (i < 0) break;
    marcas.set(i, { ...marcas.get(i), paso: `${t}%` });
  }
  // si el target ya se cumple hoy no hace falta llevar nada
  const cumple = sim.pct >= d.target - 1e-9;
  const iT = cumple ? -1 : idxPct(d.target);
  if (iT >= 0) marcas.set(iT, { ...marcas.get(iT), target: true });
  // fin de las olas 1 + 2 (sin habilitar SKU) y fin de la ola 3 (todo)
  const i12 = cand.reduce((m, c, k) => (c.ola !== 3 ? k : m), -1);
  if (i12 >= 0) marcas.set(i12, { ...marcas.get(i12), fin: 'aptos' });
  if (cand.length && cand.length - 1 !== i12) marcas.set(cand.length - 1, { ...marcas.get(cand.length - 1), fin: 'todo' });
  const escalones = [...marcas.entries()].sort((a, b) => a[0] - b[0]).map(([i, m]) => ({ ...m, ...escenario(i) }));

  // propuesta: llegar al target (o al máximo si no alcanza), con lo que entra en el OSR
  const alcanza = cumple || iT >= 0;
  const iP = alcanza ? iT : cand.length - 1;
  const prop = escenario(iP);
  const selP = cand.slice(0, iP + 1);

  // participación por CD hoy y con la propuesta, y operarios que libera cada CD
  const sale = {};
  for (const c of selP) for (const [cd, v] of Object.entries(c.x.porCd)) if (cd !== cdObj) sale[cd] = (sale[cd] || 0) + v;
  const porCd = d.porCd.map((c) => {
    const s = c.obj ? -prop.mueve : sale[c.cd] || 0;
    const uN = c.u - s, uDia = s / dias;
    return { cd: c.cd, obj: c.obj, u: c.u, pct: c.pct, sale: s, uNuevo: uN, pctNuevo: sim.u ? uN / sim.u : 0, uDia, // operarios-turno por día que libera el CD (en el OSR, negativo: los que suma)
      operarios: c.obj ? (osrUnHH > 0 ? uDia / osrUnHH / horas : 0) : uDia / pickUnHH / horas };
  });

  // apertura por clase ABC/XYZ y por temporada: participación hoy y con la propuesta, SKU, ubicaciones y headcount
  const apertura = (claveDe, claves) => {
    const m = new Map(claves.map((k) => [k, { clave: k, skus: 0, u: 0, uObj: 0, sel: 0, mueve: 0, ubicaciones: 0, half: 0, quarter: 0, enteros: 0, totes: 0 }]));
    const de = (k) => { if (!m.has(k)) m.set(k, { clave: k, skus: 0, u: 0, uObj: 0, sel: 0, mueve: 0, ubicaciones: 0, half: 0, quarter: 0, enteros: 0, totes: 0 }); return m.get(k); };
    for (const x of d.skus) { const a = de(claveDe(x)); a.skus++; a.u += x.u; a.uObj += x.uObj; }
    for (const c of selP) {
      const a = de(claveDe(c.x));
      a.sel++; a.mueve += c.x.otros; a.half += c.e.comps.HALF; a.quarter += c.e.comps.QUARTER; a.enteros += c.e.comps.ENTERO; a.totes += c.e.totes;
      a.ubicaciones += c.e.comps.HALF + c.e.comps.QUARTER + c.e.comps.ENTERO;
    }
    return [...m.values()].filter((a) => a.skus).map((a) => {
      const uDia = a.mueve / dias;
      return { ...a, totes: Math.ceil(a.totes), pct: a.u ? a.uObj / a.u : 0, pctNuevo: a.u ? (a.uObj + a.mueve) / a.u : 0, partTotal: sim.u ? a.u / sim.u : 0,
        uDia, opManual: uDia / pickUnHH / horas, opOsr: osrUnHH > 0 ? uDia / osrUnHH / horas : 0 };
    });
  };
  const matriz = apertura((x) => (CLASES.includes(x.b?.matriz) ? x.b.matriz : 'SC'), [...CLASES, 'SC']);
  const porTemporada = apertura((x) => x.temp || 'SIN', TEMPS).map((a) => ({ ...a, nom: NOM_TEMP[a.clave] }));

  const olas = OLAS.map((o) => {
    const l = cand.filter((c) => c.ola === o.ola);
    const sum = (f) => l.reduce((s, c) => s + f(c), 0);
    return { ...o, skus: l.length, u: sum((c) => c.x.otros), totes: Math.ceil(sum((c) => c.e.totes)), ubicaciones: sum((c) => c.e.comps.ENTERO + c.e.comps.HALF + c.e.comps.QUARTER),
      sinStock: l.filter((c) => c.ola !== 2 && !(c.x.b?.fuera > 0)).length };
  });

  const fila = (c) => ({ ola: c.ola, sku: c.x.sku, desc: c.x.desc, depto: c.x.b?.depto || c.x.dptoArch || '', matriz: c.x.b?.matriz || '', temp: c.x.temp, log: c.x.b?.log || '',
    otros: c.x.otros, cdPrincipal: c.x.cdPrincipal, ventaDia: c.ventaDia, necesita: c.necesita, stockOsr: c.x.b ? c.x.b.osr : null, stockFuera: c.x.b ? c.x.b.fuera : null,
    guardar: c.guardar, cap: c.cap, almac: c.e.almac, half: c.e.comps.HALF, quarter: c.e.comps.QUARTER, enteros: c.e.comps.ENTERO, totes: c.e.totes });

  return {
    aplica: true, cdObj, target: d.target, dias, alcanza,
    conf: { cob, almac: modo, pickUnHH, osrUnHH, horas, ocupMax },
    hoy: { u: sim.u, obj: sim.obj, pct: sim.pct }, espacio, olas, escalones, propuesta: prop, porCd, matriz, porTemporada, temporada: d.temporada,
    nSkus: selP.length, skus: selP.slice(0, LIMITE).map(fila), todos: params.todos ? selP.map(fila) : undefined,
  };
}
