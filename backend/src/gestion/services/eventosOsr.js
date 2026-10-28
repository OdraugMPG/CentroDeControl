// Simulador de eventos comerciales: pasos 2 a 4 del libro AnalisisABC_SegunEvento (MKT_CargarDeptos,
// MKT_SimularEvento y MKT_SimularTodo). Simula la demanda de cada SKU en un evento (mercado del regalo) y
// sugiere qué disponibilizar en el OSR antes del peak.
//   Demanda base/día   = VENTAS / días de venta
//   Demanda día evento = base x factor categoría-evento x escenario
//   Demanda periodo    = demanda día x (días del evento + días de cobertura)
//   Sugerencia OSR     = demanda periodo (mín. MIN_OSR_PRIORITARIO en deptos OSR), tope = stock; Faltante = sugerencia - stock en OSR
//   Elegible OSR       = Logística OSR = "Y", o "N"/"REVISION" con stock en OSR
import { q } from '../db.js';
import { normTxt, txt, up, cmp, hoyIso, fmtFecha, diaNum, sumarDias } from '../engine/util.js';
import { libro } from './tareas.js';
import { baseSku, deptosPrioritarios, pesoXyz, DIAS_VENTAS } from './abastecimientoOsr.js';

export const ESCENARIOS = ['Conservador', 'Base', 'Optimista'];
const PAR_ESC = { Conservador: 'evtEscCons', Base: 'evtEscBase', Optimista: 'evtEscOpt' };

// Calendario y factores por categoría del libro (CrearEventos / CrearCategorias)
const EVENTOS_DEF = [
  { evento: 'Black Friday 2026', clave: 'BLACKFRIDAY', inicio: '2026-11-27', fin: '2026-11-30', prep: 21, cob: 3, fecha: 'Inicio confirmado 27-nov', nota: 'CCS 2025: US$426M en 3 dias, 56% online' },
  { evento: 'Navidad 2026', clave: 'NAVIDAD', inicio: '2026-12-12', fin: '2026-12-24', prep: 30, cob: 0, fecha: 'Ventana de peak', nota: 'CCS: diciembre +32% vs promedio; vestuario +92%; consolas x4' },
  { evento: 'Dia de la Madre 2027', clave: 'MADRE', inicio: '2027-05-01', fin: '2027-05-09', prep: 21, cob: 0, fecha: '2do domingo de mayo', nota: 'CCS 2026: semana previa > US$2.000M (+7%); peak sabado previo' },
  { evento: 'CyberDay 2027', clave: 'CYBERDAY', inicio: '2027-06-07', fin: '2027-06-09', prep: 21, cob: 3, fecha: 'ESTIMADA - confirmar CCS', nota: 'CCS 2026: US$531M en 3 dias; dia 1 el mas fuerte' },
  { evento: 'Dia del Padre 2027', clave: 'PADRE', inicio: '2027-06-13', fin: '2027-06-20', prep: 14, cob: 0, fecha: '3er domingo de junio', nota: 'Pegado al CyberDay: preparar ambos juntos' },
  { evento: 'Dia del Nino 2027', clave: 'NINO', inicio: '2027-08-01', fin: '2027-08-08', prep: 21, cob: 0, fecha: '2do domingo de agosto', nota: 'Mercado Libre 2026: juguetes hasta +48% a/a' },
  { evento: 'CyberMonday 2027', clave: 'CYBERMONDAY', inicio: '2027-10-04', fin: '2027-10-06', prep: 21, cob: 3, fecha: 'ESTIMADA - confirmar CCS', nota: 'CCS 2026: proyeccion US$460M en 3 dias' },
];
const CLAVES_CAT = ['CYBERDAY', 'CYBERMONDAY', 'BLACKFRIDAY', 'NAVIDAD', 'MADRE', 'PADRE', 'NINO'];
const cat = (categoria, f, palabras) => ({ categoria, factores: Object.fromEntries(CLAVES_CAT.map((k, i) => [k, f[i]])), palabras });
const CATEGORIAS_DEF = [
  cat('JUGUETERIA', [2, 2, 2.2, 3, 1, 1, 2.5], 'JUGUET|JUEGO|MUNEC|PELUCH|LEGO|DIDACT|MANUALID'),
  cat('TECNOLOGIA', [3.5, 3.5, 3, 2.5, 1.2, 1.5, 1.2], 'TECNO|ELECTRON|COMPUT|NOTEBOOK|CELULAR|TELEFON|AUDIO|VIDEO|CONSOLA|GAMER|TELEVIS|FOTO|SMART|PARLANT|AUDIFON'),
  cat('VESTUARIO_CALZADO', [2.5, 2.5, 2.5, 1.9, 1.5, 1.4, 1.1], 'VEST|ROPA|MODA|CALZ|ZAPAT|POLERA|PANTAL|JEANS|LENCER|PIJAMA|POLERON|CHAQUETA'),
  cat('BELLEZA_PERFUMERIA', [2.2, 2.2, 2.2, 1.8, 1.8, 1.3, 1], 'PERFUM|BELLEZA|COSMET|MAQUILL|FRAGANC|CUIDADO PERSONAL|DERMO'),
  cat('ACCESORIOS_JOYERIA', [2, 2, 2, 1.8, 1.6, 1.3, 1], 'ACCESOR|JOY|RELOJ|CARTER|BOLSO|BILLETER|LENTE|BISUT'),
  cat('HOGAR_DECO', [2.5, 2.5, 2.2, 1.6, 1.3, 1.1, 1], 'HOGAR|DECO|COCINA|MUEBLE|BANO|DORMIT|BLANCO|MENAJE|ILUMIN|ORGANIZ|ELECTRODOM'),
  cat('DEPORTE', [2.2, 2.2, 2.2, 1.5, 1.1, 1.4, 1.2], 'DEPORT|BICI|FITNESS|OUTDOOR|CAMPING|SPORT|GIMNAS'),
  cat('INFANTIL_BEBE', [2, 2, 2, 1.8, 1, 1, 1.6], 'BEBE|INFANT|NINO|NINA|MATERN|COCHE'),
  cat('GENERAL', [1.8, 1.8, 1.8, 1.35, 1.1, 1.1, 1.05], ''),
];

// ---------------------------------------------------------------------------------------------
// Configuración (en parametros, como JSON): eventos, categorías y categoría asignada a cada depto
// ---------------------------------------------------------------------------------------------
const K = { eventos: 'evtEventos', categorias: 'evtCategorias', deptos: 'evtDeptos' };
async function leerJson(clave, def) {
  const { rows } = await q('SELECT valor FROM parametros WHERE clave = $1', [clave]);
  try { return rows[0] ? JSON.parse(rows[0].valor) : def; } catch { return def; }
}
const guardarJson = (clave, v) => q('INSERT INTO parametros (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [clave, JSON.stringify(v)]);

export async function configEventos() {
  return { eventos: await leerJson(K.eventos, EVENTOS_DEF), categorias: await leerJson(K.categorias, CATEGORIAS_DEF), deptos: await leerJson(K.deptos, {}) };
}

export async function guardarConfigEventos({ eventos, categorias, deptos } = {}) {
  if (eventos) {
    const ev = eventos.map((e) => ({ evento: txt(e.evento), clave: normTxt(e.clave || e.evento), inicio: txt(e.inicio).slice(0, 10), fin: txt(e.fin).slice(0, 10),
      prep: Math.max(0, Number(e.prep) || 0), cob: Math.max(0, Number(e.cob) || 0), fecha: txt(e.fecha), nota: txt(e.nota) })).filter((e) => e.evento && e.clave);
    for (const e of ev) if (!/^\d{4}-\d{2}-\d{2}$/.test(e.inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(e.fin) || e.fin < e.inicio)
      throw Object.assign(new Error(`Revisa las fechas de "${e.evento}": inicio y fin válidos, y fin igual o posterior al inicio.`), { status: 400 });
    await guardarJson(K.eventos, ev);
  }
  if (categorias) {
    const cs = categorias.map((c) => ({ categoria: normEsp(c.categoria).trim().replace(/\s+/g, '_'), palabras: txt(c.palabras),
      factores: Object.fromEntries(Object.entries(c.factores || {}).map(([k, v]) => [normTxt(k), Number(String(v).replace(',', '.')) || 0])) })).filter((c) => c.categoria);
    if (!cs.some((c) => c.categoria === 'GENERAL')) cs.push(CATEGORIAS_DEF.at(-1));
    await guardarJson(K.categorias, cs);
  }
  if (deptos) await guardarJson(K.deptos, Object.fromEntries(Object.entries(deptos).filter(([, v]) => txt(v))));
  return configEventos();
}

export async function restablecerConfigEventos() {
  await q('DELETE FROM parametros WHERE clave = ANY($1)', [[K.eventos, K.categorias]]);
  return configEventos();
}

/** Categoría a partir de un texto: primera categoría cuya palabra clave aparezca (sin tildes). */
function categoriaTexto(texto, categorias) {
  const s = normEsp(texto);
  if (s) for (const c of categorias) for (const pp of String(c.palabras || '').split('|')) if (pp.trim() && s.includes(normEsp(pp))) return c.categoria;
  return 'GENERAL';
}
const normEsp = (s) => txt(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Paso 2: deptos de la Base con la categoría asignada (o sugerida), si son deptos OSR y cuántos SKU tienen. */
export async function deptosEventos() {
  const [{ p, skus }, cfg] = await Promise.all([baseSku(), configEventos()]);
  const prior = deptosPrioritarios(p.deptosOsr);
  const m = new Map();
  for (const x of skus) {
    const d = m.get(x.depto) || { depto: x.depto, cod: x.cod, skus: 0 };
    d.skus++;
    m.set(x.depto, d);
  }
  const lista = [...m.values()].sort((a, b) => cmp(a.depto, b.depto)).map((d) => {
    const sug = categoriaTexto(d.depto, cfg.categorias), asig = cfg.deptos[d.depto];
    return { ...d, categoria: asig || sug, sugerida: sug, origen: asig ? 'MANUAL' : sug === 'GENERAL' ? 'SIN MATCH - revisar' : 'AUTO', osr: prior.has(d.cod) };
  });
  return { deptos: lista, categorias: cfg.categorias.map((c) => c.categoria) };
}

// ---------------------------------------------------------------------------------------------
// Pasos 3 y 4: simulación por evento y escenario
// ---------------------------------------------------------------------------------------------
async function contexto() {
  const [b, cfg] = await Promise.all([baseSku(), configEventos()]);
  return { ...b, cfg };
}

function simular(ctx, ev, escenario) {
  const { p, skus, cfg } = ctx;
  const clave = normTxt(ev.clave);
  const factores = new Map(cfg.categorias.filter((c) => c.factores && clave in c.factores).map((c) => [c.categoria, Number(c.factores[clave]) || 0]));
  if (!factores.size) throw Object.assign(new Error(`La clave ${clave} no tiene factores en las categorías.`), { status: 400 });
  if (!factores.has('GENERAL')) factores.set('GENERAL', 1);
  const prior = deptosPrioritarios(p.deptosOsr);
  const soloOSR = up(p.soloDeptosOsr) !== 'NO';
  const mEsc = Number(p[PAR_ESC[escenario]]) || 1;
  const horizonte = diaNum(ev.fin) - diaNum(ev.inicio) + 1 + (Number(ev.cob) || 0);
  const topN = Math.max(1, Number(p.evtTopN) || 300), umbral = Number(p.evtUmbral) || 1.3, minPrior = Number(p.osrMinPrior) || 0;
  const catDepto = new Map();
  const out = skus.map((x) => {
    let c = catDepto.get(x.depto);
    if (!c) { c = cfg.deptos[x.depto] || categoriaTexto(x.depto, cfg.categorias); catDepto.set(x.depto, c); }
    const fEv = (factores.has(c) ? factores.get(c) : factores.get('GENERAL')) * mEsc;
    const stk = x.qty, dBase = x.vta / DIAS_VENTAS, dDia = dBase * fEv, dPer = dDia * horizonte;
    const riesgo = stk <= 0 ? 'SIN STOCK' : dDia <= 0 ? 'SIN VENTA' : stk < dPer ? 'QUIEBRE' : stk < dPer * umbral ? 'AJUSTADO' : 'OK';
    const esPrior = prior.has(x.cod);
    let eleg = x.log === 'Y' || (['N', 'REVISION'].includes(x.log) && x.osr > 0);
    if (soloOSR && !esPrior) eleg = false;
    let sug = 0, falt = 0;
    if (eleg && stk > 0 && dDia > 0) {
      sug = Math.ceil(dPer);
      if (esPrior && sug < minPrior) sug = minPrior;
      if (sug > stk) sug = stk;
      falt = Math.max(0, sug - x.osr);
    }
    return { sku: x.sku, desc: x.desc, depto: x.depto, categoria: c, matriz: x.matriz, ventas: x.vta, stock: stk, osr: x.osr, dBase, fEv, dDia, dPer,
      cob: dDia > 0 ? stk / dDia : null, riesgo, eleg, prior: esPrior, sug, falt, prioridad: '', score: dDia * pesoXyz(x.xyz, p) };
  });
  // ordenar por score = demanda día evento x confianza XYZ (desc) y armar ranking
  out.sort((a, b) => b.score - a.score || cmp(a.sku, b.sku));
  let elegibles = 0, quiebreTop = 0, sugTop = 0, demTop = 0, faltTop = 0;
  out.forEach((r, i) => {
    r.rank = i + 1;
    if (r.eleg && r.dDia > 0) {
      elegibles++;
      if (elegibles <= topN) {
        r.prioridad = elegibles;
        sugTop += r.sug; demTop += r.dPer; faltTop += r.falt;
        if (r.riesgo === 'QUIEBRE') quiebreTop++;
      }
    }
  });
  const inicioPrep = sumarDias(ev.inicio, -(Number(ev.prep) || 0));
  return { evento: ev.evento, clave, escenario, inicio: ev.inicio, fin: ev.fin, inicioPrep, diasAPrep: diaNum(inicioPrep) - diaNum(hoyIso()), horizonte,
    analizados: out.length, elegibles, quiebreTop, sugTop, demTop, faltTop, topN, out };
}

const buscarEvento = (cfg, clave) => {
  const ev = cfg.eventos.find((e) => normTxt(e.clave) === normTxt(clave)) || cfg.eventos[0];
  if (!ev) throw Object.assign(new Error('No hay eventos en el calendario.'), { status: 400 });
  return ev;
};
const resumen = ({ out, ...r }) => r;
const RIESGOS = ['QUIEBRE', 'AJUSTADO', 'OK', 'SIN VENTA', 'SIN STOCK'];

/** Paso 3: todos los eventos x 3 escenarios. */
export async function simularTodo() {
  const ctx = await contexto();
  const filas = [];
  for (const ev of ctx.cfg.eventos) for (const e of ESCENARIOS) filas.push(resumen(simular(ctx, ev, e)));
  return { filas, topN: Number(ctx.p.evtTopN) || 300, hoy: hoyIso() };
}

/** Paso 4: detalle de un evento y escenario. */
export async function simularEvento({ clave, escenario = 'Base', riesgo = '', soloTop = false, categoria = '' } = {}) {
  const ctx = await contexto();
  const esc = ESCENARIOS.includes(escenario) ? escenario : 'Base';
  const r = simular(ctx, buscarEvento(ctx.cfg, clave), esc);
  const porRiesgo = RIESGOS.map((k) => ({ riesgo: k, skus: r.out.filter((x) => x.riesgo === k).length, top: r.out.filter((x) => x.riesgo === k && x.prioridad).length }));
  const cats = Object.entries(r.out.reduce((a, x) => { const c = (a[x.categoria] ??= { skus: 0, sug: 0, falt: 0, top: 0, fEv: x.fEv }); c.skus++; if (x.prioridad) { c.top++; c.sug += x.sug; c.falt += x.falt; } return a; }, {}))
    .map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.sug - a.sug || cmp(a.categoria, b.categoria));
  const lista = r.out.filter((x) => (!riesgo || x.riesgo === riesgo) && (!soloTop || x.prioridad) && (!categoria || x.categoria === categoria));
  return { ...resumen(r), porRiesgo, categorias: cats, filtrados: lista.length, detalle: lista.slice(0, 500) };
}

const ENC_SIM = ['Rank', 'SKU', 'Descripción', 'Desc. Depto', 'Categoría', 'ABC-XYZ', 'Ventas periodo', 'Stock total', 'Stock en OSR', 'Venta base/día', 'Factor evento',
  'Demanda día evento', 'Demanda periodo', 'Cobertura (días)', 'Riesgo', 'Elegible OSR', 'Depto prioritario', 'Sugerencia OSR', 'Faltante a subir', 'Prioridad', 'Score (demanda x confianza XYZ)'];
const R = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const filaSim = (x) => [x.rank, x.sku, x.desc, x.depto, x.categoria, x.matriz, x.ventas, x.stock, x.osr, R(x.dBase, 2), R(x.fEv, 2), R(x.dDia, 2), R(x.dPer, 1),
  x.cob === null ? '' : R(x.cob, 1), x.riesgo, x.eleg ? 'SI' : 'NO', x.prior ? 'SI' : 'NO', x.sug, x.falt, x.prioridad ? `PRIORIDAD ${x.prioridad}` : '', R(x.score, 4)];

export async function archivoEvento({ clave, escenario = 'Base' } = {}) {
  const ctx = await contexto();
  const esc = ESCENARIOS.includes(escenario) ? escenario : 'Base';
  const r = simular(ctx, buscarEvento(ctx.cfg, clave), esc);
  const aoa = [
    [`${r.evento} | Escenario ${esc}`],
    [`Ventana ${fmtFecha(r.inicio)} a ${fmtFecha(r.fin)} | Horizonte ${r.horizonte} días | Iniciar preparación ${fmtFecha(r.inicioPrep)} | Generado ${fmtFecha(hoyIso())}`],
    [`SKU elegibles OSR con venta: ${r.elegibles} | Top ${r.topN} en riesgo de quiebre: ${r.quiebreTop} | Unidades sugeridas en OSR (top): ${r.sugTop} | Faltante por subir al OSR (top): ${r.faltTop}`],
    ENC_SIM, ...r.out.map(filaSim),
  ];
  return { buffer: libro([[`SIM_${r.clave}_${esc.slice(0, 4)}`.slice(0, 31), aoa, [6, 14, 40, 24, 20, 8, 10, 10, 10, 10, 9, 10, 10, 10, 11, 9, 9, 11, 10, 13, 12]]]),
    nombre: `Simulacion_${r.clave}_${esc}_${hoyIso()}.xlsx` };
}

export async function archivoTodo() {
  const { filas } = await simularTodo();
  const aoa = [
    ['Evento', 'Escenario', 'Inicio', 'Fin', 'Inicio preparación', 'Días a preparación', 'SKU analizados', 'SKU elegibles OSR', 'Top N en quiebre', 'Unid. sugeridas OSR (top)', 'Demanda periodo (top)', 'Faltante a subir OSR (top)'],
    ...filas.map((r) => [r.evento, r.escenario, fmtFecha(r.inicio), fmtFecha(r.fin), fmtFecha(r.inicioPrep), r.diasAPrep, r.analizados, r.elegibles, r.quiebreTop, r.sugTop, Math.round(r.demTop), r.faltTop]),
    [], ['Días a preparación de 7 o menos: empezar ya a preparar el evento.'],
  ];
  return { buffer: libro([['MKT_Resumen', aoa, [24, 12, 11, 11, 13, 11, 11, 12, 11, 14, 14, 14]]]), nombre: `Simulacion_eventos_${hoyIso()}.xlsx` };
}
