import React, { useState } from 'react';
import { api, qs, fmt, hora, fFecha } from './api.js';
import { Subir, toast, useCarga, Tiles } from './ui.jsx';

export default function Conciliacion({ fecha }) {
  const [turno, setTurno] = useState('1');
  const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState(null);
  const [lista, , recargar] = useCarga(() => api.get('/api/conciliaciones' + qs({ fecha })), [fecha]);
  const [k, , recK] = useCarga(() => api.get('/api/kpi' + qs({ fecha })), [fecha]);
  const cierre = async (f) => {
    setOcupado(true); setRes(null);
    try {
      const fd = new FormData();
      fd.append('archivo', f); fd.append('fecha', fecha); fd.append('turno', turno);
      const r = await api.post('/api/cargas/cierre', fd);
      setRes(r); recargar(); recK();
      toast(`${r.ejecutadas} tareas ejecutadas y ${r.parciales} parciales según el stock de cierre.`);
    } catch (e) { toast(e.message, true); }
    setOcupado(false);
  };
  const importar = async (f) => {
    setOcupado(true);
    try {
      const fd = new FormData(); fd.append('archivo', f);
      const r = await api.post('/api/avances/importar', fd);
      toast(`${r.actualizadas} tareas actualizadas desde el archivo.`); recK();
      if (r.errores.length) toast(r.errores.join(' · '), true);
    } catch (e) { toast(e.message, true); }
    setOcupado(false);
  };
  return (
    <>
      <div className="top"><div><h1>Conciliación</h1><div className="sub">Al cierre de cada turno carga el mismo archivo de stock. La plataforma lo compara con la Base del inicio y marca cada tarea según dónde quedó el stock; nadie digita el avance.</div></div></div>
      <div className="sec">
        <h2>Stock al cierre del turno</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label className="lbl" htmlFor="c-t">Turno que cierra</label><select id="c-t" value={turno} onChange={(e) => setTurno(e.target.value)}><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></div>
          <Subir etiqueta="Cargar stock de cierre" onArchivo={cierre} cargando={ocupado} />
        </div>
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>Proceso</th><th>Regla de cruce con el stock</th></tr></thead>
          <tbody>
            <tr><td><span className="tag">CONS</span></td><td>Baja el SKU en la ubicación de origen y sube en la de destino. Cuenta lo menor de ambos.</td></tr>
            <tr><td><span className="tag">SU</span></td><td>La unidad aparece en la ubicación reservada (o en otra reservada) y salió del origen.</td></tr>
            <tr><td><span className="tag">SM</span></td><td>Baja el SKU en la ubicación de origen (sale a la zona slow moving u otro CD).</td></tr>
            <tr><td><span className="tag">INV</span></td><td>El stock no muestra si una zona se contó: el supervisor la marca como contada en "Mi turno".</td></tr>
          </tbody>
        </table>
        <p className="note">Se revisan las tareas pendientes o parciales de los turnos hasta el elegido. Una tarea nunca retrocede: si ya estaba ejecutada, se mantiene.</p>
        {res && <div className="alert good">{fmt(res.revisadas)} tareas revisadas: {fmt(res.ejecutadas)} ejecutadas, {fmt(res.parciales)} parciales, {fmt(res.sinCambio)} sin movimiento{res.revisar ? `, ${res.revisar} para revisar (el origen bajó pero el destino no recibió)` : ''}.</div>}
      </div>
      {k && <Tiles k={k.total} meta={k.meta} />}
      <div className="sec">
        <h2>Cargas de cierre del {fFecha(fecha)}</h2>
        <table>
          <thead><tr><th>Hora</th><th>Turno</th><th>Archivo</th><th className="num">Revisadas</th><th className="num">Ejecutadas</th><th className="num">Parciales</th><th className="num">Revisar</th></tr></thead>
          <tbody>
            {(lista || []).map((c) => <tr key={c.id}><td>{hora(c.creado_en)}</td><td>{c.turno ? 'T' + c.turno : '—'}</td><td>{c.archivo}</td><td className="num">{c.resumen.revisadas}</td><td className="num">{c.resumen.ejecutadas}</td><td className="num">{c.resumen.parciales}</td><td className="num">{c.resumen.revisar}</td></tr>)}
            {lista && !lista.length && <tr><td colSpan={7} className="note">Aún no hay cargas de cierre.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sec">
        <h2>Respaldo: archivo del supervisor</h2>
        <p className="note">Si un turno no tiene foto de stock, el supervisor puede completar su archivo .xlsx (descargado en "Asignación del día") e importarlo aquí, igual que en el libro Excel.</p>
        <Subir etiqueta="Importar archivo del turno" onArchivo={importar} cargando={ocupado} accept=".xlsx" />
      </div>
    </>
  );
}
