// Reabasto y abastecimiento OSR por evento: pasos 5 y 6 del libro AnalisisABC_SegunEvento
// (MKT_ReabastoProyeccion del módulo modAnalisisEventos y AB_GenerarAbastecimiento de modAbastecimientoOSR).
//   Paso 5: meta OSR del depto = unidades proyectadas (Pro_Evt) x PCT_OSR x (1 + COLCHON). Participan los SKU
//           del depto aptos OSR (Logística OSR = Y o con stock en OSR) y con clase en CLASES_ABC / CLASES_XYZ.
//           Reparto proporcional a VENTAS x confianza XYZ (PESO_X/Y/Z), con tope en el stock del SKU; lo que no
//           cabe pasa a los demás. La meta se cubre en OLAS_REABASTO cargas (carga previa + reposiciones).
//   Paso 6: para cada SKU se toma el stock de las ubicaciones fuera de OSR, primero la ubicación con más unidades;
//           ola 1 = antes del evento, ola 2 = durante.
import XLSX from 'xlsx';
import { q } from '../db.js';
import { leerParametros } from './parametros.js';
import { filasDeCarga, ultimaCargaInicio } from './stock.js';
import { clasificacionActual } from './abcXyz.js';
import { TODOS } from '../engine/abcXyz.js';
import { buscarCol, esAptoOsr } from '../engine/base.js';
import { normTxt, txt, up, num, cmp, hoyIso, fmtFecha } from '../engine/util.js';
import { libro } from './tareas.js';

export const DIAS_VENTAS = 60; // la columna VENTAS de la Base es la venta de los últimos 2 meses
const CLAVE = 'proyEvento';     // la proyección cargada se guarda en parametros (JSON)

// Alias de la hoja Pro_Evt (los mismos del libro)
const AL_PCOD = 'DEPARTAMENTO|DEPTO|DPTO|COD DEPTO|COD DPTO|CODIGO DEPTO';
const AL_PCAT = 'DESC DPTO|DESC DEPTO|DESCRIPCION DPTO|DESCRIPCION DEPTO|DESC DEPARTAMENTO|CATEGORIA';
const AL_PUNI = 'UNIDADES PROYECTADAS|UNIDADES|UNIDADES ESPERADAS|PROYECCION|VENTA PROYECTADA|UNIDADES EVENTO|CANTIDAD';
const AL_PPCT = '% OSR|PCT OSR|PORCENTAJE OSR|PARTICIPACION OSR';

export const TIPOS = { APTO: 'APTO OSR', HABILITAR: 'REQUIERE HABILITAR OSR' };
export const ESTADOS_AB = { COMPLETO: 'ABASTECER COMPLETO', PARCIAL: 'PARCIAL - FALTA STOCK', SIN: 'SIN STOCK FUERA OSR' };
const OLAS = ['1 ANTES DEL EVENTO', '2 DURANTE EVENTO'];
const CLASES9 = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];

// ---------------------------------------------------------------------------------------------
// Utilidades del libro
// ---------------------------------------------------------------------------------------------
/** Primer grupo de dígitos de un texto, sin ceros a la izquierda ("0667 ZAPATILLAS" → "667"). */
export const digitos = (s) => { const m = txt(s).match(/\d+/); return m ? String(Number(m[0])) : ''; };
/** Acepta 0,8 / 80% / 80 → 0,8 */
export function pctNum(x) {
  const s = txt(x);
  let v = s.endsWith('%') ? num(s.slice(0, -1)) / 100 : num(s);
  if (v > 1) v /= 100;
  return v || 0;
}
const redArriba = (x) => (x > 0 ? Math.ceil(Math.round(x * 1e6) / 1e6) : 0);
/** Lista de deptos OSR: "601-605,620,625" (también acepta | o ;). */
export function deptosPrioritarios(s) {
  const d = new Set();
  for (const pz of String(s || '').replace(/\s/g, '').split(/[,;|]/)) {
    if (!pz) continue;
    const r = pz.split('-');
    if (r.length === 2 && /^\d+$/.test(r[0]) && /^\d+$/.test(r[1])) for (let j = Number(r[0]); j <= Number(r[1]); j++) d.add(String(j));
    else if (/^\d+$/.test(pz)) d.add(String(Number(pz)));
  }
  return d;
}
const listaClases = (s, todas) => {
  const d = new Set(String(s || '').toUpperCase().replace(/\s/g, '').split(/[,;]/).filter(Boolean).map((x) => x[0]));
  return d.size ? d : new Set(todas.split(''));
};
export const pesoXyz = (xyz, p) => (xyz === 'X' ? p.osrPesoX : xyz === 'Y' ? p.osrPesoY : p.osrPesoZ);

/** Reparto proporcional con tope (lo que no cabe en un SKU pasa a los demás), igual que RepartoConTope del libro. */
function repartoConTope(total, w, cp) {
  const n = w.length, al = new Array(n).fill(0), activo = w.map((x, k) => cp[k] > 0 && x > 0);
  let resto = total;
  for (let it = 0; it <= n; it++) {
    if (resto <= 1e-6) break;
    let sw = 0;
    for (let k = 0; k < n; k++) if (activo[k]) sw += w[k];
    if (sw <= 0) break;
    let hayTope = false;
    for (let k = 0; k < n; k++) if (activo[k] && al[k] + resto * w[k] / sw >= cp[k]) hayTope = true;
    if (!hayTope) { for (let k = 0; k < n; k++) if (activo[k]) al[k] += resto * w[k] / sw; break; }
    for (let k = 0; k < n; k++) if (activo[k] && al[k] + resto * w[k] / sw >= cp[k]) { al[k] = cp[k]; activo[k] = false; }
    resto = total - al.reduce((s, x) => s + x, 0);
  }
  return al;
}

// ---------------------------------------------------------------------------------------------
// Base agregada por SKU (LeerBaseSKU del libro): stock total, stock en OSR, venta, Logística OSR y clase ABC-XYZ
// ---------------------------------------------------------------------------------------------
export async function baseSku() {
  const carga = await ultimaCargaInicio();
  if (!carga) throw Object.assign(new Error('Carga primero una Base de stock en Asignación del día.'), { status: 400 });
  const p = await leerParametros();
  const osr = up(p.cdOsr);
  const d = await clasificacionActual();
  const clase = new Map(d.grupos.get(TODOS).map((x) => [x.sku, x]));
  const filas = (await filasDeCarga(carga.id)).filter((r) => r.sku);
  const hayCol = filas.some((r) => txt(r.logOsr) !== '');
  const sk = new Map();
  for (const r of filas) {
    let x = sk.get(r.sku);
    if (!x) {
      x = { sku: r.sku, desc: r.desc, depto: txt(r.depto) || '(SIN DEPTO)', qty: 0, vta: 0, osr: 0, apto: false, log: '', origen: [] };
      sk.set(r.sku, x);
    }
    const qty = num(r.qty);
    x.qty += qty;
    if (num(r.ventas) > x.vta) x.vta = num(r.ventas); // VENTAS es del SKU: se toma el mayor, no se suma
    if (esAptoOsr(r.logOsr)) x.apto = true; else if (!x.log && txt(r.logOsr)) x.log = up(r.logOsr);
    if (up(r.cd) === osr) x.osr += qty;
    else if (qty > 0) x.origen.push({ cd: r.cd, ubic: r.ubic || '', qty });
  }
  const skus = [...sk.values()];
  for (const x of skus) {
    const c = clase.get(x.sku);
    if (c && c.ventas > x.vta) x.vta = c.ventas;
    x.abc = c?.abc || 'C';
    x.xyz = c?.matriz?.[1] || (x.vta > 0 ? (x.vta >= x.qty ? 'X' : 'Y') : 'Z');
    x.matriz = x.abc + x.xyz;
    x.st = x.vta > 0 && x.qty + x.vta > 0 ? x.vta / (x.qty + x.vta) : 0; // sell-through = VENTAS / (stock + VENTAS)
    if (x.apto || !hayCol) x.log = 'Y';
    x.fuera = Math.max(0, x.qty - x.osr);
    x.depKey = normTxt(x.depto);
    x.cod = digitos(x.depto);
  }
  return { carga, p, osr, hayCol, skus };
}

// ---------------------------------------------------------------------------------------------
// Proyección del evento (Pro_Evt): Departamento | Desc Dpto | Unidades proyectadas | % OSR (opcional)
// ---------------------------------------------------------------------------------------------
export async function cargarProyeccion(buffer, archivo, evento) {
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
  const hoja = wb.SheetNames.find((n) => normTxt(n) === 'PROEVT') || wb.SheetNames[0];
  const m = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: '' });
  let f = -1, cCod = -1, cNom = -1, cUni = -1, cPct = -1;
  for (let i = 0; i < Math.min(15, m.length); i++) {
    cCod = buscarCol(m[i], AL_PCOD); cNom = buscarCol(m[i], AL_PCAT); cUni = buscarCol(m[i], AL_PUNI);
    if ((cCod >= 0 || cNom >= 0) && cUni >= 0) { f = i; cPct = buscarCol(m[i], AL_PPCT); break; }
  }
  if (f < 0) throw Object.assign(new Error(`No reconocí los encabezados de la hoja "${hoja}": debe tener Departamento (o Desc Dpto) y Unidades proyectadas.`), { status: 400 });
  const filas = [];
  for (const r of m.slice(f + 1)) {
    const cod = cCod >= 0 ? txt(r[cCod]) : '', nom = cNom >= 0 ? txt(r[cNom]) : '', uni = num(r[cUni]);
    if (!(uni > 0) || (!cod && !nom)) continue;
    filas.push({ cod, nom, uni, pct: cPct >= 0 && txt(r[cPct]) !== '' ? pctNum(r[cPct]) : null });
  }
  if (!filas.length) throw Object.assign(new Error('La proyección no tiene departamentos con unidades proyectadas.'), { status: 400 });
  const valor = { archivo, hoja, evento: txt(evento) || archivo.replace(/\.\w+$/, ''), cargado: hoyIso(), filas };
  await q('INSERT INTO parametros (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [CLAVE, JSON.stringify(valor)]);
  return { deptos: filas.length, unidades: filas.reduce((s, x) => s + x.uni, 0), evento: valor.evento };
}

export async function borrarProyeccion() {
  await q('DELETE FROM parametros WHERE clave = $1', [CLAVE]);
  return { ok: true };
}

async function leerProyeccion() {
  const { rows } = await q('SELECT valor FROM parametros WHERE clave = $1', [CLAVE]);
  try { return rows[0] ? JSON.parse(rows[0].valor) : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// Paso 5: MKT_ReabastoProyeccion
// ---------------------------------------------------------------------------------------------
async function reabasto(params = {}) {
  const proy = await leerProyeccion();
  const { carga, p, osr, hayCol, skus } = await baseSku();
  // parámetros (los de la pantalla reemplazan a los de Configuración)
  const pctG = params.pctOsr !== undefined && params.pctOsr !== '' ? pctNum(params.pctOsr) : pctNum(p.osrPct);
  const colchon = params.colchon !== undefined && params.colchon !== '' ? pctNum(params.colchon) : pctNum(p.osrColchon);
  const olas = Math.max(1, Math.floor(Number(params.olas !== undefined && params.olas !== '' ? params.olas : p.osrOlas) || 1));
  const minPri = Math.max(0, Number(params.minimo !== undefined && params.minimo !== '' ? params.minimo : p.osrMinPrior) || 0);
  const listaOSR = deptosPrioritarios(p.deptosOsr);
  const soloOSR = up(p.soloDeptosOsr) !== 'NO';
  const clA = listaClases(p.osrClasesAbc, 'ABC'), clX = listaClases(p.osrClasesXyz, 'XYZ');
  const conf = { pctG, colchon, olas, minPri, soloOSR, listaOSR: p.deptosOsr, clases: `${[...clA].join(',')} / ${[...clX].join(',')}`, pesos: { X: p.osrPesoX, Y: p.osrPesoY, Z: p.osrPesoZ } };
  if (!proy) return { carga, osr, hayCol, conf, sinProyeccion: true };

  // departamentos de la base (DESC_DEPTO) indexados por nombre y por código
  const cats = [], dN = new Map(), dC = new Map();
  for (const x of skus) {
    if (!dN.has(x.depKey)) { dN.set(x.depKey, cats.length); cats.push({ nom: x.depto, cod: x.cod, osr: false, skus: [] }); }
    const c = cats[dN.get(x.depKey)];
    c.skus.push(x);
    x.cat = c;
    if (!soloOSR || listaOSR.has(x.cod)) c.osr = true;
    if (x.cod && !dC.has(x.cod)) dC.set(x.cod, c);
  }
  // proyección: por código de depto o por nombre
  const noEnc = [];
  for (const r of proy.filas) {
    let c = digitos(r.cod) ? dC.get(digitos(r.cod)) : null;
    if (!c && r.nom) c = cats[dN.get(normTxt(r.nom))];
    if (!c) { noEnc.push(`${r.cod} ${r.nom}`.trim()); continue; }
    c.enProy = true; c.proy = (c.proy || 0) + r.uni;
    if (r.pct !== null && r.pct !== undefined) c.pctCat = r.pct;
  }
  const proyectados = cats.filter((c) => c.enProy);
  if (!proyectados.length) throw Object.assign(new Error(`Ningún departamento de la proyección calza con la Base (por código ni por nombre). Revisar: ${noEnc.slice(0, 8).join(' | ')}`), { status: 400 });

  // aptitud por SKU
  for (const x of skus) {
    x.motivo = !x.cat.osr ? 'DEPTO FUERA DE OSR' : x.log === 'Y' ? 'APTO (LOGISTICA_OSR=Y)' : x.osr > 0 ? 'CON STOCK EN OSR' : 'NO APTO OSR';
    x.eleg = x.motivo !== 'NO APTO OSR' && x.motivo !== 'DEPTO FUERA DE OSR';
    if (x.eleg && !clA.has(x.abc)) { x.eleg = false; x.motivo = `CLASE ${x.abc} EXCLUIDA`; }
    if (x.eleg && !clX.has(x.xyz)) { x.eleg = false; x.motivo = `CLASE ${x.xyz} EXCLUIDA`; }
  }

  const detalle = [], noAptos = [];
  for (const c of proyectados) {
    const pct = c.pctCat > 0 ? c.pctCat : pctG;
    c.pct = c.osr ? pct : 0;
    c.meta = c.osr ? redArriba(c.proy * pct * (1 + colchon)) : 0;
    Object.assign(c, { vt: 0, osrStock: 0, ve: 0, cap: 0, nE: 0, nN: 0, asig: 0, antes: 0, durante: 0, asigPot: 0, nNoV: 0, unNo: 0, cls: new Array(9).fill(0) });
    const el = [];
    for (const x of c.skus) {
      c.vt += x.vta; c.osrStock += x.osr;
      if (x.eleg) { el.push(x); c.ve += x.vta; c.cap += x.qty; } else c.nN++;
    }
    c.nE = el.length;
    if (el.length) {
      let w = el.map((x) => { x.peso = pesoXyz(x.xyz, p); return x.vta * x.peso; });
      let sw = w.reduce((s, v) => s + v, 0);
      if (sw <= 0) { w = w.map(() => 1); sw = el.length; } // sin venta ponderada: reparto parejo
      const cp = el.map((x) => x.qty);
      const al = repartoConTope(c.meta, w, cp);
      el.forEach((x, k) => {
        x.ideal = c.meta * w[k] / sw;
        x.partic = c.ve > 0 ? x.vta / c.ve : 0;
        c.asig += al[k];
        let meta = Math.min(redArriba(al[k]), cp[k]);
        if (meta > 0 && meta < minPri) meta = Math.min(minPri, cp[k]); // mínimo por SKU con meta (deptos OSR)
        x.meta = meta;
        x.previa = redArriba(meta / olas);
        x.antes = Math.max(0, x.previa - x.osr);
        x.durante = Math.max(0, meta - Math.max(x.previa, x.osr));
        x.exced = Math.max(0, x.osr - meta);
        c.antes += x.antes; c.durante += x.durante;
        const ci = CLASES9.indexOf(x.matriz);
        if (ci >= 0) c.cls[ci] += meta;
        x.estado = cp[k] <= 0 ? 'SIN STOCK' : al[k] < x.ideal - 0.5 ? 'STOCK INSUFICIENTE' : x.antes > 0 ? 'SUBIR ANTES DEL EVENTO'
          : x.durante > 0 ? 'REPONER DURANTE EVENTO' : x.exced > 0 ? 'OK (excedente en OSR)' : 'OK';
        detalle.push(x);
      });
    }
    // SKU no aptos del depto y potencial si se habilitan en OSR
    const pot = [];
    for (const x of c.skus) {
      if (x.motivo === 'NO APTO OSR') {
        x.unAtr = c.vt > 0 ? c.proy * x.vta / c.vt : 0;
        x.potAl = 0;
        if (x.vta > 0) { c.nNoV++; c.unNo += x.unAtr; }
        noAptos.push(x);
      }
      if (x.qty > 0 && (x.eleg || x.motivo === 'NO APTO OSR')) pot.push(x);
    }
    if (pot.length) {
      const w2 = pot.map((x) => x.vta * pesoXyz(x.xyz, p));
      if (w2.some((v) => v > 0)) {
        const al2 = repartoConTope(c.meta, w2, pot.map((x) => x.qty));
        pot.forEach((x, k) => { c.asigPot += al2[k]; if (!x.eleg) x.potAl = al2[k]; });
      }
    }
    if (c.asigPot < c.asig) c.asigPot = c.asig;
    // reparto de lo proyectado entre SKU aptos / no aptos según su peso en la venta del depto
    c.uAp = Math.min(c.proy, Math.round(c.vt > 0 ? c.proy * c.ve / c.vt : c.nE > 0 ? c.proy : 0));
    c.uNo = Math.max(0, c.proy - c.uAp);
    c.brecha = c.meta - c.asig > 0.5 ? Math.round(c.meta - c.asig) : 0;
    c.estado = !c.osr ? 'DEPTO NO OSR' : c.nE === 0 ? 'SIN SKU APTOS OSR' : c.meta > 0 && c.asig < c.meta - 0.5 ? 'NO ALCANZA META' : c.antes > 0 ? 'SUBIR ANTES DEL EVENTO' : 'OK';
  }
  // RP_Detalle: subir antes desc, ventas desc · RP_NoAptos: aporte potencial desc, ventas desc
  detalle.sort((a, b) => b.antes - a.antes || b.vta - a.vta || cmp(a.sku, b.sku));
  detalle.forEach((x, i) => { x.prioridad = i + 1; });
  noAptos.sort((a, b) => b.potAl - a.potAl || b.vta - a.vta || cmp(a.sku, b.sku));
  noAptos.forEach((x, i) => {
    x.prioridad = i + 1;
    x.pctVenta = x.cat.vt > 0 ? x.vta / x.cat.vt : 0;
    if (x.vta <= 0) { x.impacto = 'SIN VENTA'; x.recomendacion = 'Sin venta en el mes: no prioritario'; }
    else if (x.qty <= 0) { x.impacto = 'SIN STOCK'; x.recomendacion = 'Con venta pero sin stock: gestionar abastecimiento'; }
    else {
      x.impacto = x.abc === 'A' || x.pctVenta >= 0.05 ? 'ALTO' : x.abc === 'B' ? 'MEDIO' : 'BAJO';
      x.recomendacion = x.log === 'REVISION' ? 'En REVISION: priorizar validación para OSR' : 'Evaluar habilitar en OSR (LOGISTICA_OSR)';
    }
  });

  // totales del resumen gerencial
  const g = { tP: 0, tPO: 0, tPF: 0, nDO: 0, nDF: 0, tM: 0, tA: 0, tPot: 0, tAn: 0, tD: 0, tOsr: 0, tNoV: 0, tUnNo: 0, cls: new Array(9).fill(0), peorNom: '', peorCob: 2 };
  for (const c of proyectados) {
    g.tP += c.proy;
    if (c.osr) {
      g.nDO++; g.tPO += c.proy; g.tOsr += c.osrStock; g.tM += c.meta; g.tA += c.asig; g.tPot += c.asigPot;
      g.tAn += c.antes; g.tD += c.durante; g.tNoV += c.nNoV; g.tUnNo += c.unNo;
      c.cls.forEach((v, j) => { g.cls[j] += v; });
      if (c.meta > 0 && c.asig / c.meta < g.peorCob) { g.peorCob = c.asig / c.meta; g.peorNom = c.nom; }
    } else { g.nDF++; g.tPF += c.proy; }
  }
  const sumCls = g.cls.reduce((s, v) => s + v, 0);
  g.pHoy = g.tP > 0 ? g.tA / g.tP : 0; g.pPot = g.tP > 0 ? g.tPot / g.tP : 0; g.pHoyO = g.tPO > 0 ? g.tA / g.tPO : 0;
  g.cob = g.tM > 0 ? g.tA / g.tM : 1;
  g.brecha = g.tM - g.tA >= 0.5 ? g.tM - g.tA : 0;
  const f0 = (v) => Math.round(v).toLocaleString('es-CL'), pc = (v, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')}%`;
  const lectura = [`El evento proyecta ${f0(g.tP)} unid.: ${f0(g.tPO)} (${pc(g.tP ? g.tPO / g.tP : 0)}) en ${g.nDO} deptos que se trabajan en OSR`
    + (g.nDF > 0 ? ` y ${f0(g.tPF)} (${pc(g.tP ? g.tPF / g.tP : 0)}) en ${g.nDF} deptos fuera de la lista OSR, que se pickean desde los demás CD` : '') + '.'];
  if (g.nDO > 0) {
    lectura.push(`Meta OSR: ${pc(pctG)} de lo proyectado en deptos OSR = ${f0(g.tM)} unid. Con el stock y la habilitación actual se cubren ${f0(g.tA)} unid. (${pc(g.cob, 1)} de la meta; ${pc(g.pHoyO, 1)} de lo proyectado en deptos OSR; ${pc(g.pHoy, 1)} del total del evento).`);
    lectura.push(g.brecha > 0 ? `Faltan ${f0(g.brecha)} unid. para cumplir la meta OSR.` : 'La meta OSR se cubre completa con el stock actual de SKU aptos.');
    lectura.push(`Hoy hay ${f0(g.tOsr)} unid. en OSR de estos deptos. Plan de carga: subir ${f0(g.tAn)} unid. antes del evento${olas > 1 ? ` y reponer ${f0(g.tD)} unid. durante el evento (${olas} cargas)` : ''}.`);
    if (g.tNoV > 0) lectura.push(`${g.tNoV} SKU con venta en deptos OSR NO están aptos para OSR y representan ${f0(g.tUnNo)} unid. del proyectado. Habilitarlos subiría la cobertura de la meta a ${pc(g.tM ? g.tPot / g.tM : 0, 1)}.`);
    if (g.tPot < g.tM - 0.5) lectura.push(`Aun habilitando los no aptos faltan ${f0(g.tM - g.tPot)} unid.: se requiere stock adicional (compra / tránsito) o redistribución entre CD.`);
    if (sumCls > 0) lectura.push(`El ${pc((g.cls[0] + g.cls[3]) / sumCls)} de la meta OSR está en SKU de alta rotación (AX / BX); el ${pc((g.cls[2] + g.cls[5] + g.cls[8]) / sumCls)} en clase Z.`);
    if (g.peorNom && g.peorCob < 0.999) lectura.push(`Departamento OSR más crítico: ${g.peorNom} (cubre el ${pc(g.peorCob)} de su meta).`);
  } else lectura.push('Ningún depto proyectado está en la lista de deptos OSR: el evento no tiene meta OSR.');

  return { carga, osr, hayCol, conf, proy, noEnc, deptos: proyectados, detalle, noAptos, g, lectura };
}

// ---------------------------------------------------------------------------------------------
// Paso 6: AB_GenerarAbastecimiento (lee RP_Detalle y, opcional, RP_NoAptos)
// ---------------------------------------------------------------------------------------------
function abastecer(detalle, noAptos, incluirNoAptos) {
  const req = [];
  for (const x of detalle) if (x.antes + x.durante > 0) req.push({ x, tipo: TIPOS.APTO, meta: x.meta, antes: x.antes, durante: x.durante });
  if (incluirNoAptos) for (const x of noAptos) {
    const b = Math.round(x.potAl), a = b - x.osr;
    if (a > 0) req.push({ x, tipo: TIPOS.HABILITAR, meta: b, antes: a, durante: 0 });
  }
  const picking = [];
  req.forEach((r, i) => {
    r.prioridad = i + 1;
    const ubs = r.x.origen.map((o) => ({ ...o, saldo: o.qty })).sort((a, b) => b.qty - a.qty);
    const usadas = new Set();
    r.asignado = 0;
    [r.antes, r.durante].forEach((need, ola) => {
      for (const u of ubs) {
        if (need <= 1e-6) break;
        if (u.saldo <= 0) continue;
        const tome = Math.min(u.saldo, need);
        picking.push({ ola: OLAS[ola], cd: u.cd, ubic: u.ubic, sku: r.x.sku, desc: r.x.desc, depto: r.x.depto, matriz: r.x.matriz, tipo: r.tipo,
          unidades: tome, stockAntes: u.saldo, saldo: u.saldo - tome, prioridad: r.prioridad });
        u.saldo -= tome; need -= tome; r.asignado += tome; usadas.add(u);
      }
    });
    r.total = r.antes + r.durante;
    r.faltante = r.total - r.asignado < 0.5 ? 0 : r.total - r.asignado;
    r.nUb = usadas.size;
    r.estado = r.x.fuera <= 0 ? ESTADOS_AB.SIN : r.faltante > 0 ? ESTADOS_AB.PARCIAL : ESTADOS_AB.COMPLETO;
  });
  picking.sort((a, b) => cmp(a.ola, b.ola) || cmp(a.cd, b.cd) || cmp(a.ubic, b.ubic));
  picking.forEach((l, i) => { l.nro = i + 1; });
  const s = (k) => req.reduce((t, r) => t + r[k], 0);
  const tot = { skus: req.length, aptos: req.filter((r) => r.tipo === TIPOS.APTO).length, total: s('total'), antes: s('antes'), durante: s('durante'),
    asignado: s('asignado'), faltante: s('faltante'), lineas: picking.length, ubicaciones: new Set(picking.map((l) => l.cd + '|' + l.ubic)).size };
  const porEstado = Object.values(ESTADOS_AB).map((e) => ({ estado: e, skus: req.filter((r) => r.estado === e).length, uni: req.filter((r) => r.estado === e).reduce((t, r) => t + r.total, 0) }));
  const porCd = Object.entries(picking.reduce((a, l) => { (a[l.cd] ??= [0, 0])[l.ola === OLAS[0] ? 0 : 1] += l.unidades; return a; }, {}))
    .map(([cd, [antes, durante]]) => ({ cd, antes, durante, total: antes + durante })).sort((a, b) => b.total - a.total);
  return { req, picking, tot, porEstado, porCd };
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------
const filaDep = (c) => ({ nom: c.nom, cod: c.cod, osr: c.osr, proy: c.proy, pct: c.pct, meta: c.meta, uAp: c.uAp, uNo: c.uNo, pctNo: c.proy ? c.uNo / c.proy : 0,
  osrStock: c.osrStock, cap: c.cap, asig: c.asig, cob: c.meta > 0 ? c.asig / c.meta : null, pot: c.meta > 0 ? c.asigPot / c.meta : null, brecha: c.brecha,
  antes: c.antes, durante: c.durante, estado: c.estado, nE: c.nE, nNoV: c.nNoV, unNo: c.unNo, cls: c.cls });
const filaSku = (x) => ({ prioridad: x.prioridad, depto: x.cat.nom, sku: x.sku, desc: x.desc, abc: x.abc, xyz: x.xyz, matriz: x.matriz, vta: x.vta, st: x.st,
  peso: x.peso, partic: x.partic, motivo: x.motivo, osr: x.osr, fuera: x.fuera, ideal: x.ideal, meta: x.meta, previa: x.previa, antes: x.antes, durante: x.durante, exced: x.exced, estado: x.estado });
const filaNo = (x) => ({ prioridad: x.prioridad, depto: x.cat.nom, sku: x.sku, desc: x.desc, matriz: x.matriz, vta: x.vta, pctVenta: x.pctVenta, unAtr: x.unAtr, qty: x.qty,
  osr: x.osr, log: x.log || '(vacío)', potAl: x.potAl, impacto: x.impacto, recomendacion: x.recomendacion });
const filaReq = (r) => ({ prioridad: r.prioridad, depto: r.x.depto, sku: r.x.sku, desc: r.x.desc, matriz: r.x.matriz, tipo: r.tipo, meta: r.meta, osr: r.x.osr,
  antes: r.antes, durante: r.durante, total: r.total, fuera: r.x.fuera, asignado: r.asignado, faltante: r.faltante, nUb: r.nUb, estado: r.estado });

export async function simularAbastecimiento(params = {}) {
  const r = await reabasto(params);
  if (r.sinProyeccion) return r;
  const incluir = params.incluirNoAptos === true || params.incluirNoAptos === '1';
  const ab = abastecer(r.detalle, r.noAptos, incluir);
  const dep = txt(params.depto), est = txt(params.estado);
  const enDep = (x) => !dep || x.cat.nom === dep;
  const det = r.detalle.filter((x) => enDep(x) && (!est || x.estado === est));
  const no = r.noAptos.filter((x) => enDep(x) && (!est || x.impacto === est));
  const req = ab.req.filter((q2) => enDep(q2.x) && (!est || q2.estado === est));
  const skusReq = new Set(req.map((q2) => q2.x.sku));
  const pick = ab.picking.filter((l) => skusReq.has(l.sku));
  const cuenta = (l, k) => Object.entries(l.reduce((a, x) => ({ ...a, [x[k]]: (a[x[k]] || 0) + 1 }), {})).map(([e, n]) => ({ e, n }));
  return {
    carga: r.carga, osr: r.osr, hayCol: r.hayCol, conf: { ...r.conf, olas: r.conf.olas }, incluirNoAptos: incluir,
    proy: { evento: r.proy.evento, archivo: r.proy.archivo, cargado: r.proy.cargado, filas: r.proy.filas.length }, noEnc: r.noEnc,
    g: r.g, lectura: r.lectura, deptos: r.deptos.map(filaDep),
    estadosDet: cuenta(r.detalle, 'estado'), estadosNo: cuenta(r.noAptos, 'impacto'),
    detalle: { total: det.length, filas: det.slice(0, 500).map(filaSku) },
    noAptos: { total: no.length, filas: no.slice(0, 500).map(filaNo) },
    ab: { tot: ab.tot, porEstado: ab.porEstado, porCd: ab.porCd, total: req.length, filas: req.slice(0, 500).map(filaReq), lineas: pick.length, picking: pick.slice(0, 500) },
  };
}

export async function archivoAbastecimiento(params = {}) {
  const r = await reabasto(params);
  if (r.sinProyeccion) throw Object.assign(new Error('Carga primero la proyección del evento (Pro_Evt).'), { status: 400 });
  const incluir = params.incluirNoAptos === true || params.incluirNoAptos === '1';
  const ab = abastecer(r.detalle, r.noAptos, incluir);
  const { g, conf } = r, gen = `Generado ${fmtFecha(hoyIso())}`, pc = (v) => `${Math.round(v * 1000) / 10}%`;
  const R1 = (v) => Math.round(v * 10) / 10;

  const ger = [
    ['RESUMEN GERENCIAL · REABASTO OSR PARA EL EVENTO'],
    [`Objetivo: que el OSR pickee el ${pc(conf.pctG)} del volumen proyectado en los deptos que se trabajan en OSR${conf.colchon > 0 ? ` (+ colchón ${pc(conf.colchon)})` : ''}  |  Proyección: ${r.proy.archivo} (${r.proy.evento})  |  ${gen}`],
    [],
    ['Unidades proyectadas (total evento)', 'Proyectado en deptos OSR', 'Meta OSR', 'Stock actual en OSR (deptos proyectados)', '% de la meta OSR cubierta con stock actual'],
    [g.tP, g.tPO, g.tM, g.tOsr, g.cob],
    ['Brecha vs meta OSR (unid.)', 'Subir al OSR antes del evento', 'Reponer en OSR durante el evento', 'SKU no aptos OSR con venta (deptos OSR)', '% del proyectado pickeable desde OSR (hoy / habilitando no aptos)'],
    [Math.round(g.brecha), g.tAn, g.tD, g.tNoV, `${pc(g.pHoy)} / ${pc(g.pPot)}`],
    [],
    ['LECTURA'],
    ...r.lectura.map((l) => ['• ' + l]),
    [],
    ['DEPARTAMENTOS OSR (ordenados por brecha)'],
    ['Departamento', 'Unid. proyectadas', 'Stock actual en OSR', 'Meta OSR', 'Meta cubierta con stock', '% meta cubierta', '% potencial habilitando no aptos', 'Brecha (unid.)', 'SKU no aptos con venta', 'Unid. proyectadas en no aptos'],
    ...r.deptos.filter((c) => c.osr).sort((a, b) => b.brecha - a.brecha || b.proy - a.proy)
      .map((c) => [c.nom, c.proy, c.osrStock, c.meta, Math.round(c.asig), c.meta ? c.asig / c.meta : '', c.meta ? c.asigPot / c.meta : '', c.brecha, c.nNoV, Math.round(c.unNo)]),
    [],
    ['DEPARTAMENTOS PROYECTADOS FUERA DE LA LISTA OSR (se pickean desde otros CD)'],
    ['Departamento', 'Unid. proyectadas', '% del total proyectado', 'Stock actual en OSR', 'Observación'],
    ...r.deptos.filter((c) => !c.osr).sort((a, b) => b.proy - a.proy || b.osrStock - a.osrStock)
      .map((c) => [c.nom, c.proy, g.tP ? c.proy / g.tP : '', c.osrStock, c.osrStock > 0 ? 'Tiene stock en OSR estando fuera de la lista: revisar' : 'Fuera de alcance OSR']),
    [],
    ['TOP 10 SKU NO APTOS OSR CON MAYOR IMPACTO (detalle completo en RP_NoAptos)'],
    ['Departamento', 'SKU', 'Descripción', 'ABC-XYZ', 'Ventas mes', 'Stock total', 'Unid. proyectadas atribuibles', 'Aporte potencial meta OSR', 'LOGISTICA_OSR'],
    ...r.noAptos.filter((x) => x.vta > 0).sort((a, b) => b.potAl - a.potAl || b.vta - a.vta).slice(0, 10)
      .map((x) => [x.cat.nom, x.sku, x.desc, x.matriz, x.vta, x.qty, Math.round(x.unAtr), Math.round(x.potAl), x.log || '(vacío)']),
  ];
  if (r.noEnc.length) ger.push([], ['Sin SKU en la base: ' + r.noEnc.join(' | ').slice(0, 800)]);

  const res = [
    [`REABASTO OSR SEGÚN PROYECCIÓN DEL EVENTO (${r.proy.evento})`],
    [`Meta: el OSR despacha el ${pc(conf.pctG)} de lo proyectado${conf.colchon > 0 ? ` + colchón ${pc(conf.colchon)}` : ''}  |  Clases: ${conf.clases}  |  Confianza XYZ: X ${conf.pesos.X}, Y ${conf.pesos.Y}, Z ${conf.pesos.Z}  |  Olas de carga: ${conf.olas}  |  Todas las cifras en unidades  |  ${gen}`],
    [],
    ['Departamento (DESC_DEPTO)', 'Unid. proyectadas', '% OSR', 'Meta OSR (unid.)', 'Unid. proyectadas en SKU aptos', 'Unid. proyectadas en SKU no aptos', '% proyectado en SKU no aptos',
      'Stock actual en OSR (unid.)', 'Stock total SKU aptos (unid.)', 'Meta cubierta con stock (unid.)', 'Cobertura alcanzable', 'Brecha (unid.)', 'Subir antes del evento (unid.)', 'Reponer durante evento (unid.)', 'Estado'],
    ...r.deptos.map((c) => [c.nom, c.proy, c.pct, c.meta, c.uAp, c.uNo, c.proy ? c.uNo / c.proy : '', c.osrStock, c.cap, Math.round(c.asig), c.meta ? c.asig / c.meta : '', c.brecha, c.antes, c.durante, c.estado]),
    ['TOTAL', g.tP, g.tP ? g.tM / g.tP : '', g.tM, r.deptos.reduce((s, c) => s + c.uAp, 0), r.deptos.reduce((s, c) => s + c.uNo, 0), '', r.deptos.reduce((s, c) => s + c.osrStock, 0),
      r.deptos.reduce((s, c) => s + c.cap, 0), Math.round(g.tA), g.tM ? g.tA / g.tM : '', Math.round(g.brecha), g.tAn, g.tD, ''],
    [], ['Meta OSR por clase ABC-XYZ (unidades)'],
    ['Departamento', ...CLASES9, '% en clase AX'],
    ...r.deptos.map((c) => { const t = c.cls.reduce((s, v) => s + v, 0); return [c.nom, ...c.cls, t ? c.cls[0] / t : '']; }),
    [],
    ["Cómo leer: todas las cifras son unidades. 'Unid. proyectadas en SKU aptos / no aptos' reparte lo proyectado del depto según el peso de esos SKU en la venta. 'Cobertura alcanzable' = parte de la meta que se cubre con el stock que existe hoy en SKU aptos. Si es baja y '% proyectado en SKU no aptos' es alto, la palanca es habilitar esos SKU en OSR (LOGISTICA_OSR), no comprar más."],
  ];

  const det = [
    ['Prioridad', 'Departamento', 'SKU', 'Descripción', 'ABC', 'XYZ', 'ABC-XYZ', 'Ventas mes', 'Sell-through mes', 'Confianza XYZ', 'Particip. en depto', 'Motivo apto OSR', 'Stock en OSR',
      'Stock fuera OSR', 'Meta ideal', 'Meta OSR (unid.)', 'Carga previa', 'Subir antes del evento', 'Reponer durante evento', 'Excedente en OSR', 'Estado'],
    ...(r.detalle.length ? r.detalle.map((x) => [x.prioridad, x.cat.nom, x.sku, x.desc, x.abc, x.xyz, x.matriz, x.vta, x.st, x.peso, x.partic, x.motivo, x.osr, x.fuera,
      R1(x.ideal), x.meta, x.previa, x.antes, x.durante, x.exced, x.estado]) : [['No hay SKU aptos OSR en los departamentos de la proyección.']]),
  ];

  const no = [
    ['Prioridad', 'Departamento', 'SKU', 'Descripción', 'ABC', 'XYZ', 'ABC-XYZ', 'Ventas mes', '% venta del depto', 'Unid. proyectadas atribuibles', 'Stock total', 'Stock en OSR',
      'LOGISTICA_OSR', 'Aporte potencial a meta OSR', 'Impacto', 'Recomendación'],
    ...(r.noAptos.length ? r.noAptos.map((x) => [x.prioridad, x.cat.nom, x.sku, x.desc, x.abc, x.xyz, x.matriz, x.vta, x.pctVenta, Math.round(x.unAtr), x.qty, x.osr,
      x.log || '(vacío)', Math.round(x.potAl), x.impacto, x.recomendacion]) : [['Todos los SKU de los departamentos proyectados son aptos para OSR.']]),
  ];

  const t = ab.tot, pe = ab.porEstado;
  const abr = [
    ['SUGERENCIA DE ABASTECIMIENTO OSR · POR SKU'],
    [`Base: RP_Detalle${incluir ? ' + RP_NoAptos' : ''}  |  Todas las cifras en unidades  |  Origen: ubicaciones fuera del OSR (CD <> ${r.osr})  |  ${gen}`],
    [`SKU: ${t.skus}  ·  Completos: ${pe[0].skus}  ·  Parciales: ${pe[1].skus}  ·  Sin stock fuera OSR: ${pe[2].skus}  ·  Requeridas: ${t.total}  ·  Asignadas: ${t.asignado}${t.total ? ` (${pc(t.asignado / t.total)})` : ''}  ·  Faltante: ${t.faltante}  ·  Líneas de traslado: ${t.lineas}`],
    [],
    ['Prioridad', 'Departamento', 'SKU', 'Descripción', 'ABC-XYZ', 'Tipo', 'Meta OSR (unid.)', 'Stock en OSR (unid.)', 'Subir antes del evento (unid.)', 'Reponer durante evento (unid.)',
      'Total a abastecer (unid.)', 'Stock fuera OSR (unid.)', 'Asignado desde ubicaciones (unid.)', 'Faltante (unid.)', 'Ubicaciones origen', 'Estado'],
    ...ab.req.map((q2) => [q2.prioridad, q2.x.depto, q2.x.sku, q2.x.desc, q2.x.matriz, q2.tipo, q2.meta, q2.x.osr, q2.antes, q2.durante, q2.total, q2.x.fuera, q2.asignado, q2.faltante, q2.nUb, q2.estado]),
    ['TOTAL', '', '', '', '', '', ab.req.reduce((s, q2) => s + q2.meta, 0), ab.req.reduce((s, q2) => s + q2.x.osr, 0), t.antes, t.durante, t.total, ab.req.reduce((s, q2) => s + q2.x.fuera, 0), t.asignado, t.faltante, ab.req.reduce((s, q2) => s + q2.nUb, 0), ''],
    [],
    ["Cómo leer: 'Total a abastecer' = unidades que deben llegar al OSR para cumplir la meta del SKU (antes del evento + reposición durante el evento). 'Faltante' = unidades que no existen hoy fuera del OSR: requieren compra, tránsito o redistribución. La lista de traslado ubicación por ubicación está en AB_Picking."],
  ];

  const pick = [
    ['LISTA DE TRASLADO AL OSR · POR UBICACIÓN DE ORIGEN'],
    [`Ordenada por ola, CD de origen y ubicación (ruta de picking)  |  Se toma primero la ubicación con más unidades del SKU  |  Total a mover: ${t.asignado} unid. en ${t.lineas} líneas  |  ${gen}`],
    [incluir && ab.req.some((q2) => q2.tipo === TIPOS.HABILITAR) ? "Las líneas con Tipo 'REQUIERE HABILITAR OSR' solo se mueven después de habilitar el SKU en LOGISTICA_OSR." : ''],
    [],
    ['Nro', 'Ola', 'CD origen', 'Ubicación origen', 'SKU', 'Descripción', 'Departamento', 'ABC-XYZ', 'Tipo', 'Unid. a mover', 'Stock en ubicación al retirar', 'Saldo en ubicación', 'Prioridad SKU', 'Movido (SI/NO)'],
    ...(ab.picking.length ? ab.picking.map((l) => [l.nro, l.ola, l.cd, l.ubic, l.sku, l.desc, l.depto, l.matriz, l.tipo, l.unidades, l.stockAntes, l.saldo, l.prioridad, ''])
      : [['No hay stock fuera del OSR para los SKU requeridos: todo el requerimiento queda como faltante (ver AB_Resumen).']]),
    ...(ab.picking.length ? [['TOTAL', '', '', '', '', '', '', '', '', t.asignado]] : []),
  ];

  const evento = normTxt(r.proy.evento).slice(0, 30) || 'Evento';
  return {
    buffer: libro([
      ['RP_Gerencial', ger, [34, 16, 16, 16, 16, 14, 16, 14, 14, 16]],
      ['RP_Resumen', res, [32, 14, 8, 12, 14, 14, 12, 14, 14, 14, 12, 12, 14, 14, 24]],
      ['RP_Detalle', det, [9, 26, 14, 40, 6, 6, 8, 10, 10, 10, 10, 24, 10, 10, 10, 11, 10, 12, 12, 11, 24]],
      ['RP_NoAptos', no, [9, 26, 14, 40, 6, 6, 8, 10, 10, 12, 10, 10, 14, 14, 10, 46]],
      ['AB_Resumen', abr, [9, 26, 14, 40, 9, 22, 11, 11, 13, 13, 13, 13, 14, 11, 11, 24]],
      ['AB_Picking', pick, [7, 20, 10, 16, 14, 40, 24, 9, 22, 11, 13, 13, 10, 11]],
    ]),
    nombre: `Reabasto_OSR_${evento}_${hoyIso()}.xlsx`,
  };
}
