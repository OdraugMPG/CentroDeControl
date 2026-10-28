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
  cdsConsPrimero: { v: 'RCI', n: 'Consolidación entre CD: si el SKU tiene stock en este CD, se consolida ahí directamente (varios con |, en orden de prioridad)' },
  osrPct: { v: 0.8, n: 'Reabasto OSR (PCT_OSR): % de las unidades proyectadas del evento que debe despachar el OSR (0,8 = 80%; la columna % OSR de Pro_Evt lo reemplaza por depto)' },
  osrColchon: { v: 0, n: 'Reabasto OSR (COLCHON): colchón sobre la meta OSR para cubrir error de proyección (0,1 = 10%)' },
  osrOlas: { v: 1, n: 'Reabasto OSR (OLAS_REABASTO): cargas al OSR para cubrir la meta (1 = todo antes del evento; 3 = carga previa + 2 reposiciones)' },
  osrMinPrior: { v: 20, n: 'Reabasto OSR (MIN_OSR_PRIORITARIO): mínimo de unidades por SKU con meta en deptos OSR' },
  deptosOsr: { v: '601-605,620-622,625,626,640-643,646,647,660-664,704,727,741-743', n: 'Reabasto OSR (DEPTOS_PRIORITARIOS): deptos que se trabajan en OSR (códigos separados con coma, rangos con guion)' },
  soloDeptosOsr: { v: 'SI', n: 'Reabasto OSR (SOLO_DEPTOS_OSR): SI = fuera de la lista de deptos OSR no hay meta ni sugerencia OSR' },
  osrClasesAbc: { v: 'A,B,C', n: 'Reabasto OSR (CLASES_ABC): clases ABC que participan (ej. A,B)' },
  osrClasesXyz: { v: 'X,Y,Z', n: 'Reabasto OSR (CLASES_XYZ): clases XYZ que participan (ej. X,Y deja fuera los SKU sin venta)' },
  osrPesoX: { v: 1, n: 'Reabasto OSR (PESO_X): confianza XYZ para ranking y reparto, clase X' },
  osrPesoY: { v: 0.85, n: 'Reabasto OSR (PESO_Y): confianza XYZ para ranking y reparto, clase Y' },
  osrPesoZ: { v: 0, n: 'Reabasto OSR (PESO_Z): confianza XYZ para ranking y reparto, clase Z (0 = no recibe meta)' },
  partTargetOsr: { v: 0.3, n: 'Participación por CD: target de participación de la venta del OSR (0,3 = 30%)' },
  evtEscCons: { v: 0.8, n: 'Simulador de eventos: multiplicador del escenario conservador' },
  evtEscBase: { v: 1, n: 'Simulador de eventos: multiplicador del escenario base' },
  evtEscOpt: { v: 1.25, n: 'Simulador de eventos: multiplicador del escenario optimista' },
  evtTopN: { v: 300, n: 'Simulador de eventos (TOP_N): SKU elegibles a priorizar por evento' },
  evtUmbral: { v: 1.3, n: 'Simulador de eventos (UMBRAL_AJUSTADO): stock / demanda del periodo bajo este valor = AJUSTADO' },
  pickUnHH: { v: 60, n: 'Picking manual: unidades por hora-hombre (para estimar operarios que libera OSR)' },
  invDiasA: { v: 30, n: 'Inventario cíclico: días entre conteos de una ubicación clase A' },
  invDiasB: { v: 90, n: 'Inventario cíclico: días entre conteos de una ubicación clase B' },
  invDiasC: { v: 180, n: 'Inventario cíclico: días entre conteos de una ubicación clase C' },
  horarioT1: { v: '07:00-15:00', n: 'Horario turno 1' },
  horarioT2: { v: '15:00-23:00', n: 'Horario turno 2' },
  horarioT3: { v: '23:00-07:00', n: 'Horario turno 3' },
};
const TEXTO = new Set(['porPiso', 'tramos', 'cdsExcluir', 'smDestino', 'cdPrioritario', 'cdOsr', 'cdsConsPrimero', 'deptosOsr', 'soloDeptosOsr', 'osrClasesAbc', 'osrClasesXyz', 'horarioT1', 'horarioT2', 'horarioT3']);

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
