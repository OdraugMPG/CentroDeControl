import { q } from '../db.js';

// Valores por defecto: los mismos del libro (Simulacion_Tiempos, Listas y constantes de modComun).
export const DEFAULTS = {
  invSegUb: { v: 20, n: 'Inventario: segundos por ubicación (traslado + escaneo)' },
  invSegSku: { v: 15, n: 'Inventario: segundos por SKU en la ubicación' },
  invSegUn: { v: 2, n: 'Inventario: segundos por unidad contada' },
  invSegPas: { v: 60, n: 'Inventario: segundos por cambio de pasillo' },
  invMax: { v: 6, n: 'Inventario: máximo de recursos por turno' },
  conSegMov: { v: 120, n: 'Consolidación: segundos por movimiento' },
  conSegUn: { v: 3, n: 'Consolidación: segundos por unidad movida' },
  conSegPas: { v: 60, n: 'Consolidación: segundos por cambio de pasillo' },
  horasTurno: { v: 8, n: 'Horas efectivas por turno' },
  turnosLV: { v: 3, n: 'Turnos por día de lunes a viernes' },
  turnosSab: { v: 2, n: 'Turnos el sábado' },
  turnosDom: { v: 0, n: 'Turnos el domingo (0 = no se trabaja)' },
  modoTareas: { v: 3, n: 'Tareas del plan: 1 inventario, 2 consolidación, 3 ambas' },
  porPiso: { v: 'S', n: 'Un piso por operario en consolidación (S/N)' },
  meta: { v: 0.95, n: 'Meta de cumplimiento (0,95 = 95%)' },
  tramos: { v: '90;180;365', n: 'Tramos slow moving en días (activo; lento; muy lento)' },
  cdsExcluir: { v: 'OSR', n: 'CD que no se consolidan (separar con |)' },
  smDestino: { v: 'ZONA SLOW MOVING', n: 'Destino de las tareas slow moving' },
  suMaxDef: { v: 20, n: 'Stock unitario: capacidad por defecto de una reservada' },
  suMin2Op: { v: 20, n: 'Stock unitario: un piso con menos líneas recibe 1 operario' },
  abcA: { v: 80, n: 'ABC: % acumulado de ventas que cubre la clase A' },
  abcB: { v: 95, n: 'ABC: % acumulado de ventas que cubre las clases A + B' },
  xyzRotX: { v: 1, n: 'XYZ por rotación: ventas / stock desde la que un SKU es X (Y = con venta; Z = sin venta o sin stock)' },
  xyzX: { v: 0.5, n: 'XYZ por historia: coeficiente de variación máximo de la clase X' },
  xyzY: { v: 1, n: 'XYZ por historia: coeficiente de variación máximo de la clase Y' },
  xyzMeses: { v: 6, n: 'XYZ por historia: meses de ventas que se analizan' },
  cdPrioritario: { v: 'CD2', n: 'CD prioritario para alta rotación (el más cercano a OSR y empaque)' },
  cdOsr: { v: 'OSR', n: 'CD del OSR (almacén automático)' },
  pickUnHH: { v: 60, n: 'Picking manual: unidades por hora-hombre (para estimar operarios que libera OSR)' },
  invDiasA: { v: 30, n: 'Inventario cíclico: días entre conteos de una ubicación clase A' },
  invDiasB: { v: 90, n: 'Inventario cíclico: días entre conteos de una ubicación clase B' },
  invDiasC: { v: 180, n: 'Inventario cíclico: días entre conteos de una ubicación clase C' },
  horarioT1: { v: '07:00-15:00', n: 'Horario turno 1' },
  horarioT2: { v: '15:00-23:00', n: 'Horario turno 2' },
  horarioT3: { v: '23:00-07:00', n: 'Horario turno 3' },
};
const TEXTO = new Set(['porPiso', 'tramos', 'cdsExcluir', 'smDestino', 'cdPrioritario', 'cdOsr', 'horarioT1', 'horarioT2', 'horarioT3']);

export async function leerParametros() {
  const { rows } = await q('SELECT clave, valor FROM parametros');
  const p = {};
  for (const [k, d] of Object.entries(DEFAULTS)) p[k] = d.v;
  for (const r of rows) if (r.clave in DEFAULTS) p[r.clave] = TEXTO.has(r.clave) ? r.valor : Number(String(r.valor).replace(',', '.'));
  p.tramosArr = String(p.tramos).split(/[;,]/).map((x) => Number(x.trim())).filter((x) => x > 0);
  if (p.tramosArr.length !== 3) p.tramosArr = [90, 180, 365];
  p.excluidos = new Set(String(p.cdsExcluir).split('|').map((x) => x.trim().toUpperCase()).filter(Boolean));
  return p;
}

export async function guardarParametros(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULTS)) continue;
    await q('INSERT INTO parametros (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [k, String(v)]);
  }
  return leerParametros();
}
