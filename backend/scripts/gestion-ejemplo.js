// Genera archivos de ejemplo con la MISMA estructura de la Base que se usa en el libro Excel.
//   npm run gestion:ejemplo                      -> data/ejemplo-gestion/Base_inicio_ejemplo.xlsx y Blq_Stk_unit_ejemplo.xlsx
//   npm run gestion:ejemplo -- cierre 2026-10-20 1 [0.85]
//        -> data/ejemplo-gestion/Stock_cierre_T1_ejemplo.xlsx: la Base del día con el ~85% de las tareas del turno 1 ejecutadas
//           (simula lo que haría el WMS; sirve para probar la conciliación sin esperar un turno real)
import '../src/env.js';
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// xlsx 0.20 en módulos ES necesita el sistema de archivos para writeFile
XLSX.set_fs(fs);

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ejemplo-gestion');
fs.mkdirSync(dir, { recursive: true });
let seed = 20261020;
const R = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (a) => a[Math.floor(R() * a.length)];
const ENC = ['CD', 'SKU', 'DESCRIPCION', 'MARCA', 'DESC_DEPTO', 'PISO', 'ZONA_PASILLO', 'PASILLO', 'BAHIA', 'NIVEL', 'UBICACION', 'QTY', 'FECHA_ULT_ALMACENAMIENTO', 'VENTAS', 'TEMPORADA', 'COSTO'];

function guardar(nombre, aoa, hoja = 'Base') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: false }), hoja);
  const f = path.join(dir, nombre);
  XLSX.writeFile(wb, f);
  console.log('Creado', path.relative(process.cwd(), f), `(${aoa.length - 1} filas)`);
}

function base() {
  const DEP = {
    'ZAPATOS MUJER': ['Botín cuero café', 'Zapatilla urbana blanca', 'Sandalia plataforma', 'Bota caña alta'],
    'ZAPATOS HOMBRE': ['Zapato vestir negro', 'Zapatilla running', 'Mocasín gamuza'],
    'JEANS HOMBRE': ['Jean slim azul', 'Jean recto negro'],
    'VESTUARIO MUJER': ['Blusa lino', 'Vestido midi', 'Chaqueta parka'],
    'INFANTIL': ['Polerón niño', 'Buzo set niña', 'Pijama polar'],
    'DEPORTES': ['Calza deportiva', 'Polera dry-fit', 'Short running'],
    'BLANCO HOGAR': ['Plumón 2 plazas', 'Juego sábanas 180h', 'Toalla baño'],
    'ACCESORIOS': ['Cartera cuero', 'Cinturón reversible', 'Bufanda tejida'],
  };
  const MARCAS = ['Aurea', 'Kiwen', 'Nativa', 'Trevo', 'Lumen'];
  const rows = [ENC];
  const fecha = (diasAtras) => { const d = new Date(Date.UTC(2026, 9, 20) - diasAtras * 864e5); return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`; };
  const reservadas = [['UBICACIONES RESERVADAS PARA STOCK UNITARIO'], [''], ['A = ubicación · B = piso (opcional) · C = capacidad MAX (opcional)'], ['Ubicación', 'Piso', 'MAX']];
  for (const cd of ['CD01', 'CD02', 'OSR']) {
    const nPisos = cd === 'OSR' ? 1 : 3;
    const ocupadas = new Set();
    const libre = (piso, zona) => {
      for (let i = 0; i < 200; i++) {
        const u = `${zona}-${String(ri(1, 8)).padStart(2, '0')}-${String(ri(1, 30)).padStart(3, '0')}-${ri(1, 4)}`;
        if (!ocupadas.has(cd + u)) { ocupadas.add(cd + u); return u; }
      }
      return null;
    };
    const nSku = cd === 'OSR' ? 400 : 1600;
    const mixtas = [];
    for (let s = 0; s < nSku; s++) {
      const dep = pick(Object.keys(DEP));
      const sku = String(cd === 'CD02' ? 3000000 + s : cd === 'OSR' ? 5000000 + s : 1000000 + s);
      const desc = pick(DEP[dep]), marca = pick(MARCAS), temp = pick(['I', 'I', 'V', 'V', 'T']);
      const costo = pick([3490, 4990, 7990, 9990, 12990, 15990, 19990]);
      const piso = ri(1, nPisos);
      const zona = `${cd === 'OSR' ? 'O' : 'P'}${piso}${pick('ABCD')}`;
      const unitario = R() < 0.07;
      const nUb = unitario ? 1 : pick([1, 1, 2, 2, 3, 3, 4]);
      const dias = pick([5, 20, 45, 80, 120, 160, 200, 260, 320, 400, 480, 600]) + ri(0, 15);
      const vta = dias < 100 ? ri(0, 30) : R() < 0.15 ? ri(1, 5) : 0;
      for (let k = 0; k < nUb; k++) {
        const z = k > 0 && R() < 0.15 ? `${zona.slice(0, 2)}${pick('ABCD')}` : zona;
        const u = libre(piso, z);
        if (!u) continue;
        const qty = unitario ? 1 : k === 0 ? ri(20, 60) : ri(2, 18);
        const p = u.split('-');
        rows.push([cd, sku, desc, marca, dep, `PISO ${piso}`, z, p[1], p[2], p[3], u, qty, fecha(dias + ri(0, 20)), vta, temp, costo]);
        if (R() < 0.04) mixtas.push(rows.length - 1);
      }
    }
    // algunas ubicaciones mezcladas (2 SKU en la misma ubicación)
    for (const i of mixtas) {
      const r = rows[i];
      rows.push([r[0], String(Number(r[1]) + 900000), 'Polera básica algodón', 'Trevo', 'VESTUARIO MUJER', r[5], r[6], r[7], r[8], r[9], r[10], ri(1, 10), r[12], 0, 'T', 4990]);
    }
    if (cd !== 'OSR') {
      for (let piso = 1; piso <= nPisos; piso++) for (let i = 1; i <= 12; i++) {
        reservadas.push([`P${piso}R-01-${String(i).padStart(3, '0')}-1`, `PISO ${piso}`, 15]);
      }
    }
  }
  guardar('Base_inicio_ejemplo.xlsx', rows);
  guardar('Blq_Stk_unit_ejemplo.xlsx', reservadas, 'Blq_Stk_unit');
}

async function cierre(fecha, turno, tasa) {
  const { pool } = await import('../src/gestion/db.js');
  const { filasDeCarga } = await import('../src/gestion/services/stock.js');
  const { rows: a } = await pool.query('SELECT * FROM asignaciones WHERE fecha = $1 ORDER BY id DESC LIMIT 1', [fecha]);
  if (!a.length) throw new Error(`No hay asignación del ${fecha}. Genérala primero en la web.`);
  const filas = (await filasDeCarga(a[0].carga_id)).map((f) => ({ ...f }));
  const { rows: t } = await pool.query("SELECT * FROM tareas WHERE fecha = $1 AND turno <= $2 AND proceso <> 'INV' AND estado <> 'SIN DESTINO'", [fecha, turno]);
  let ej = 0, parc = 0;
  for (const x of t) {
    const r = R();
    if (r > tasa) continue;
    const parcial = r > tasa - 0.05 && x.unid_asig > 1;
    const mover = parcial ? Math.floor(x.unid_asig / 2) : Number(x.unid_asig);
    const o = filas.find((f) => f.ubic === x.ubic_origen && f.sku === x.sku && f.qty > 0);
    if (!o) continue;
    o.qty -= Math.min(o.qty, mover);
    if (x.proceso !== 'SM') {
      const d = filas.find((f) => f.ubic === x.ubic_destino && f.sku === x.sku);
      if (d) d.qty += mover; else filas.push({ ...o, ubic: x.ubic_destino, qty: mover });
    }
    parcial ? parc++ : ej++;
  }
  const iso = (v) => (v ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}` : '');
  const aoa = [ENC, ...filas.filter((f) => f.qty > 0).map((f) => [f.cd, f.sku, f.desc, f.marca, f.depto, f.piso, f.zp, f.pas, f.bah, f.niv, f.ubic, f.qty, iso(f.falm), f.ventas, f.temp, f.costo])];
  guardar(`Stock_cierre_T${turno}_ejemplo.xlsx`, aoa);
  console.log(`Simulado: ${ej} tareas ejecutadas y ${parc} parciales de ${t.length} (turnos 1 a ${turno}).`);
  await pool.end();
}

const [modo, f, tu, tasa] = process.argv.slice(2);
if (modo === 'cierre') cierre(f, Number(tu) || 1, Number(tasa) || 0.85).catch((e) => { console.error(e.message); process.exit(1); });
else base();
