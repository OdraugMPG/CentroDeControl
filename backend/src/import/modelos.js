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
  pendiente: ['Pendiente', ['ZONA', 'UBICACION', 'ILPN_ID', 'ITEM_ID', 'DESCRIPCION', 'QTY', 'ORIGEN', 'FECHA_MOD', 'PINT', 'MES', 'DIA', 'PHYSICAL_ENTITY_CODE_ID', 'PURCHASE_ORDER_ID', 'FINAL_RETURN_DISPOSITION_ID', 'STATUS', 'DESTINATION_LOCATION_ID', 'CREATED_BY', 'PROCESS', 'CANCELLED_OLPN_ID', 'OLPN_CROSS_REFERENCE_ID', 'SOURCE_LPN_ID', 'PARENT_LPN_ID', 'FECHA_CREAC', 'DEPTO', 'UPDATED_BY', 'EMPRESA_USUARIO', 'ASN_ID', 'IMAGE_URL', 'AÑO', 'RESPONSABLE', 'SUPERVISOR', 'DESDE', 'PARCIAL', 'IFCSST', 'LEVEL', 'MARCA', 'GUIA', 'NUMCTL', 'OSR', 'FULL', 'HALF', 'QUARTER', 'VOLUME', 'WEIGHT', 'HEIGHT', 'LENGTH', 'WIDTH', 'NOMBRE', 'DESC_DEPTO', 'DESC_SUBDEPTO', 'DESC_FAMILIA', 'TEMPORADA', 'HAY_EN_OSR', 'EMPRESA', 'CD_DESDE', 'CD', 'COSTO_UNIT', 'COSTO_LPN'],
    [['DZI', 'DZI-00-000-05', 'LPI01332235', '416655999', 'SECADOR PELO SIEGEN SG-3035', 12, 'PROVEEDOR', '2026-11-04 09:15:00', '', '11', '4', '', '', '', 'RECIBIDO', '', '', '', '', '', '', '', '2026-11-04 08:40:00', 'J07', '', 'EMPRESA A', '', '', '2026', '', '', '', '', '', '2 NIVEL', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ELECTRO PERSONAL', '', '', 'PERMANENTE', 'N', '', 'CD1', 'CD2', 9990, 119880]],
    ['Foto del WMS con lo pendiente por almacenar: una fila por iLPN.', 'Obligatorias: ILPN_ID y QTY. Filtros de la vista: ZONA, ORIGEN, AÑO, MES, DIA, EMPRESA_USUARIO, LEVEL, DESC_DEPTO, TEMPORADA, CD_DESDE y CD.',
      'La antigüedad se mide desde FECHA_CREAC (o FECHA_MOD si falta) hasta el momento de la carga. COSTO_LPN y VOLUME se suman.',
      'Cada carga reemplaza la foto anterior. Se sube en la tarjeta Almacenamiento y se analiza en Operación, Almacenamiento.'], 'Modelo_Pendiente_por_almacenar.xlsx'],
  almacenado: ['Almacenados', ['ORG_ID', 'QUANTITY', 'F_MOD', 'DIA', 'HORA', 'TURNO', 'CRITERIA_ID', 'ITEM_ID', 'DESCRIPCION', 'DEPTO', 'OLD_STATUS',
    'TARGET_LOCATION_ID', 'FACILITY_ID', 'USUARIO', 'DESDE', 'NEW_STATUS', 'LOCATION', 'FLUJO', 'MINUTO', 'TRANSACTION_ID', 'ASN_ID', 'CONTAINER_ID',
    'MES', 'NHORA', 'CD', 'OPERACION', 'JORNADA'],
    [['', 12, '2026-05-20 13:16:41', '2026-05-20', '13:16:41', 'AM', 'CRITERIO_ALMACEN_USUARIO', '416655999', 'SECADOR PELO SIEGEN SG-3035', '', '', 'IAA-01-001-07-01',
      '', 'eh2012', 'DZI-00-000-05', '', '', '', '', 'ALM_USER', 'C00221854', 'LPI01279136', '', 13, 'CD2', '2 NIVEL', '']],
    ['Extracción de almacenados del WMS (ALM_USER): una fila por LPN ubicado.', 'Obligatorias: QUANTITY, ITEM_ID y F_MOD (o DIA). Se usan además TURNO, DESCRIPCION, DEPTO, TARGET_LOCATION_ID, USUARIO, DESDE, FLUJO, ASN_ID, CONTAINER_ID, NHORA, CD, OPERACION y JORNADA; las demás se guardan tal cual.',
      'También sirve la versión LITE (16 columnas): lo que no trae queda vacío.',
      'Al cargar se reemplazan solo los días (DIA) que trae el archivo. Se analiza en Operación, Recepción.'], 'Modelo_Almacenados.xlsx'],
  osrcap: ['Capacidad', ['Rack line', 'Positions', 'Locked', 'Occupied', 'Load unit stacked', 'Free/available'],
    [[1, 12000, 40, 10150, 0, 1810], [2, 12000, 25, 10420, 0, 1555], [6, 800, 0, 0, 0, 800]],
    ['Capacidad del OSR por rack line: una fila por rack line.', 'Positions = posiciones (capacidad) de la rack line; Occupied = posiciones ocupadas; Locked = bloqueadas; Free/available = libres.',
      'La rack line 6 son ubicaciones de seguridad para el desplazamiento de la máquina: se muestra pero no cuenta en la capacidad.', 'Cada carga reemplaza la anterior. Se usa en Abastecimiento OSR, Optimización de totes.'], 'Modelo_Capacidad_OSR.xlsx'],
  osrtotes: ['Distribucion', ['Article number', 'Article name', 'Stock', 'Stock locations', 'FULL', 'HALF', 'QUARTER'],
    [['252782007', 'POLERA BASICA XS', 36, 3, 0, 1, 2], ['734130999', 'PIE DE ARBOL RATTAN', 120, 2, 2, 0, 0]],
    ['Distribución de los SKU en los totes del OSR: una fila por SKU.', 'Stock = unidades del SKU en OSR. Stock locations = compartimentos que ocupa (FULL + HALF + QUARTER).',
      'FULL, HALF y QUARTER = cantidad de compartimentos de cada tipo (half = medio tote, quarter = un cuarto de tote).',
      'Cada carga reemplaza la anterior. Se usa en Abastecimiento OSR, Optimización de totes.'], 'Modelo_Distribucion_totes_OSR.xlsx'],
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
