// Plantillas Excel para las cargas de recepción y almacenamiento.
import ExcelJS from 'exceljs';

const estilo = ws => {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17212B' } };
  ws.columns.forEach(c => { c.width = Math.max(14, String(c.header).length + 4); });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};

export async function plantilla(tipo) {
  const wb = new ExcelJS.Workbook();
  if (tipo === 'recepcion') {
    const ws = wb.addWorksheet('Citas');
    ws.columns = ['FECHA', 'CITA', 'PROVEEDOR', 'HORA_PROGRAMADA', 'HORA_LLEGADA', 'INICIO_DESCARGA', 'FIN_RECEPCION', 'ANDEN',
      'UNIDADES_ESPERADAS', 'UNIDADES_RECIBIDAS', 'ESTADO'].map(h => ({ header: h, key: h }));
    ws.addRow(['2026-10-21', 'CT-4810', 'PRV-1042 Electrohogar', '06:00', '05:56', '06:10', '06:55', 1, 180, 176, 'Recibida']);
    ws.addRow(['2026-10-21', 'CT-4811', 'PRV-2210 Textil Andino', '06:30', '06:41', '06:58', '', 2, 540, 210, 'Descargando']);
    ws.addRow(['2026-10-21', 'CT-4812', 'Traslado desde CD2', '07:00', '', '', '', '', 900, 0, 'Programada']);
    estilo(ws);
    const n = wb.addWorksheet('Instrucciones');
    n.addRows([['Columna obligatoria: CITA. FECHA vacía = día operativo de hoy.'],
      ['Horas en formato HH:MM o fecha y hora completa.'],
      ['ESTADO: Programada, En patio, Descargando, En inspección o Recibida. Si se deja vacío se deduce de las horas.'],
      ['Se puede volver a cargar el mismo día: las citas existentes se actualizan.']]);
    n.getColumn(1).width = 100;
  } else if (tipo === 'almacenamiento') {
    const z = wb.addWorksheet('Ocupacion');
    z.columns = ['ZONA', 'POSICIONES', 'OCUPADAS'].map(h => ({ header: h, key: h }));
    [['RACK', 4200, 3822], ['OSR', 6000, 3752], ['VESTUARIO 1', 900, 844]].forEach(r => z.addRow(r));
    estilo(z);
    const l = wb.addWorksheet('LPN');
    l.columns = ['LPN', 'ZONA', 'QTY', 'ESTADO', 'FECHA_RECEPCION', 'CITA'].map(h => ({ header: h, key: h }));
    l.addRow(['LPN900274', 'VESTUARIO 4', 63, 'Por ubicar', '2026-10-21 07:05', 'CT-4811']);
    l.addRow(['LPN900281', 'RACK', 40, 'En curso', '2026-10-21 07:20', 'CT-4810']);
    estilo(l);
    const r = wb.addWorksheet('Reposiciones');
    r.columns = ['ZONA', 'PENDIENTES', 'URGENTES'].map(h => ({ header: h, key: h }));
    [['OSR', 21, 5], ['RACK', 16, 0]].forEach(x => r.addRow(x));
    estilo(r);
    const n = wb.addWorksheet('Instrucciones');
    n.addRows([['Cada hoja es opcional: carga solo las que tengas. Se reconocen por sus columnas.'],
      ['LPN.ESTADO: Por ubicar, En curso o Ubicado.'],
      ['Cada carga reemplaza la foto anterior de las hojas incluidas.']]);
    n.getColumn(1).width = 90;
  } else throw Object.assign(new Error('Plantilla desconocida'), { status: 404 });
  return wb.xlsx.writeBuffer();
}
