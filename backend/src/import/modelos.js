// Modelos (plantillas) de cada archivo que se carga en Datos, Cargas: las columnas que lee el sistema, una o dos filas
// de ejemplo y una hoja de instrucciones. Donde ya hay un archivo de ejemplo con la estructura real, se entrega ese.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { plantilla } from './plantillas.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const ARCHIVOS = {
  pedidos: ['muestra/Flujo_de_pedido.xlsx', 'Modelo_Flujo_de_pedido.xlsx'],
  reservadas: ['ejemplo-gestion/Blq_Stk_unit_ejemplo.xlsx', 'Modelo_Blq_Stk_unit.xlsx'],
  proevt: ['ejemplo-gestion/Pro_Evt_ejemplo.xlsx', 'Modelo_Pro_Evt.xlsx'],
  inventario: ['ejemplo-continuidad/Calendario_inventario_ejemplo.xlsx', 'Modelo_Calendario_inventario.xlsx'],
};

const COLS_PICKING = ['ESTADO', 'DESC_ESTADO', 'JAULA', 'OD', 'SOLICITUD', 'RUT', 'DESTINATARIO', 'SKU', 'DESCRIPCION', 'QTY', 'DPTO', 'REGION', 'CITY',
  'FECHA_SALIDA', 'FACILITY', 'TIPO_OLA', 'TIPO_ORDEN', 'fecha_eta_cliente', 'dia', 'mes', 'anio', 'FECHA_VENTA', 'ESPECIAL', 'DEST', 'FECHA_MOD',
  'NRO_CARGA', 'CATEGORIA_CLIENTE', 'CON_MUESTRA', 'DIA_VENTA', 'VENTA_CYBER', 'QTY_PICKING', 'WORKING_LOCATION_ID', 'NEW_QTY', 'CD_PICKING',
  'FECHA_PICKING', 'TIPO_PICKING'];
const filaPicking = (o) => COLS_PICKING.map((h) => o[h] ?? '');

// [hoja, columnas, filas de ejemplo, instrucciones, nombre del archivo]
const GENERADOS = {
  olas: ['Olas', COLS_PICKING, [
    filaPicking({ ESTADO: '2090', DESC_ESTADO: 'ALLOCATED', OD: '196051406', SOLICITUD: '3133069160', SKU: '252782007', DESCRIPCION: 'POLERA BASICA XS', QTY: 2, DPTO: '664', REGION: '05', CITY: 'Valparaiso', FECHA_SALIDA: '2026-10-30', FACILITY: 'CD1', TIPO_OLA: 'NORMAL', TIPO_ORDEN: 'DESPACHO', FECHA_VENTA: '2026-10-28', CD_PICKING: 'OSR', TIPO_PICKING: 'TAREA' }),
  ], ['Reporte del simulador de olas. Columnas obligatorias: FECHA_SALIDA, TIPO_PICKING y QTY.', 'Cada carga reemplaza a la anterior y se analiza en Operación, Simulador de olas.'], 'Modelo_Simulador_de_olas.xlsx'],
  venta: ['Picking', COLS_PICKING, [
    filaPicking({ ESTADO: '8000', DESC_ESTADO: 'SHIPPED', OD: '196051406', SOLICITUD: '3133069160', SKU: '252782007', DESCRIPCION: 'POLERA BASICA XS', QTY: 2, DPTO: '664', FECHA_SALIDA: '2026-10-13', FACILITY: 'CD1', QTY_PICKING: 2, NEW_QTY: 2, CD_PICKING: 'OSR', FECHA_PICKING: '2026-10-07 16:25', TIPO_PICKING: 'TAREA' }),
    filaPicking({ ESTADO: '8000', DESC_ESTADO: 'SHIPPED', OD: '196051406', SOLICITUD: '3133069160', SKU: '734130999', DESCRIPCION: 'PIE DE ARBOL RATTAN', QTY: 1, DPTO: '727', FECHA_SALIDA: '2026-10-13', FACILITY: 'CD1', QTY_PICKING: 1, NEW_QTY: 1, CD_PICKING: 'CD1', FECHA_PICKING: '2026-10-07 17:02', TIPO_PICKING: 'ETIQUETA' }),
  ], ['Archivo de picking para Participación por CD (y el tipo de picking de la Consolidación entre CD).',
    'Se usan SKU, DESCRIPCION, DPTO, QTY_PICKING, CD_PICKING, TIPO_PICKING, FECHA_SALIDA, DESC_ESTADO y SOLICITUD. Las demás columnas pueden venir vacías.',
    'Las unidades son solo la suma de QTY_PICKING (QTY y NEW_QTY no se usan). Las líneas CANCELLED se excluyen.',
    'También se acepta el libro con la tabla dinámica, si guarda los datos de origen.',
    'Al cargar se reemplazan solo los días (FECHA_SALIDA) que trae el archivo.'], 'Modelo_Picking_por_CD.xlsx'],
  historia: ['Ventas', ['CD', 'SKU', 'MES', 'UNIDADES'], [['CD1', '252782007', '2026-08', 35], ['CD1', '252782007', '2026-09', 41], ['CD2', '734130999', '2026-09', 12]],
    ['Venta mensual por SKU para la clasificación XYZ por historia.', 'Formato largo: CD (opcional), SKU, MES (AAAA-MM) y UNIDADES.',
      'También se acepta formato ancho: SKU y una columna por mes (ej. 2026-08, 2026-09…).', 'Un mes ya cargado para el mismo CD y SKU se reemplaza.'], 'Modelo_Historia_de_ventas.xlsx'],
  slow: ['Listado', ['SKU', 'QTY'], [['252782007', 12], ['734130999', 3]],
    ['Listado de SKU a validar en Slow moving: columnas SKU y QTY.', 'Si el archivo no trae encabezados, se toma la columna A como SKU y la B como QTY. Los SKU repetidos se suman.'], 'Modelo_Listado_Slow_moving.xlsx'],
  avances: ['Tareas', ['Proceso', 'N° Tarea', 'Piso', 'Zona', 'Ubic. origen', 'SKU', 'Descripción', 'Ubic. destino', 'Asignado a', 'Unid. asignadas', 'ESTADO', 'Unid. reales', 'Observación', 'ID'],
    [['Consolidación', 'OP-0001', 'P1', 'A01', 'P1-A01-01-1', '252782007', 'POLERA BASICA XS', 'P1-A01-02-1', 'Juan Pérez', 24, 'EJECUTADO', 24, '', 'W1234']],
    ['Archivo del turno que se descarga en Gestión diaria (Tareas o Mi turno). Se completa ESTADO, Unid. reales y Observación y se vuelve a cargar.',
      'ESTADO: PENDIENTE, PARCIAL, EJECUTADO o NO EJECUTADO. La columna ID identifica la tarea (no la modifiques).',
      'Lo más simple es descargar el archivo del turno real y completarlo: este modelo muestra la estructura.'], 'Modelo_Archivo_del_turno.xlsx'],
};

const estilo = (ws) => {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17212B' } };
  ws.columns.forEach((c) => { c.width = Math.max(12, String(c.header).length + 4); });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};

/** Devuelve { buffer, nombre } del modelo pedido. */
export async function modelo(tipo) {
  if (ARCHIVOS[tipo]) {
    const [rel, nombre] = ARCHIVOS[tipo];
    return { buffer: fs.readFileSync(path.join(DATA, rel)), nombre };
  }
  if (tipo === 'stock') {
    // la Base de ejemplo completa pesa varios MB: el modelo lleva el encabezado y las primeras 20 filas
    const wb = XLSX.read(fs.readFileSync(path.join(DATA, 'ejemplo-gestion/Base_inicio_ejemplo.xlsx')), { type: 'buffer' });
    const hoja = wb.SheetNames[0];
    const m = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: '' }).slice(0, 21);
    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(m), hoja);
    XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet([['Base de stock (la misma hoja Base del libro de consolidación): una fila por SKU y ubicación.'],
      ['Obligatorias: CD, SKU, UBICACION, QTY, PISO, ZONA PASILLO y DESC DEPTO. Opcionales: VENTAS, COSTO, TEMPORADA, FECHA ULT ALMACENAMIENTO, LOGISTICA OSR…'],
      ['Se usa para la Base del inicio de la jornada y para la foto de stock al cierre de cada turno.']]), 'Instrucciones');
    return { buffer: XLSX.write(out, { type: 'buffer', bookType: 'xlsx', compression: true }), nombre: 'Modelo_Base_de_stock.xlsx' };
  }
  if (tipo === 'recepcion' || tipo === 'almacenamiento') return { buffer: Buffer.from(await plantilla(tipo)), nombre: `Modelo_${tipo === 'recepcion' ? 'Recepcion' : 'Almacenamiento'}.xlsx` };
  const g = GENERADOS[tipo];
  if (!g) throw Object.assign(new Error('Modelo desconocido'), { status: 404 });
  const [hoja, cols, filas, instrucciones, nombre] = g;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hoja);
  ws.columns = cols.map((h) => ({ header: h, key: h }));
  filas.forEach((f) => ws.addRow(f));
  estilo(ws);
  const n = wb.addWorksheet('Instrucciones');
  n.addRows(instrucciones.map((t) => [t]));
  n.getColumn(1).width = 110;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre };
}
