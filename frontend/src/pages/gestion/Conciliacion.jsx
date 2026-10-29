import React from 'react';
import { api, qs, fmt, hora, fFecha } from './api.js';
import { IrACarga, useCarga, Tiles } from './ui.jsx';

export default function Conciliacion({ fecha }) {
  const [lista] = useCarga(() => api.get('/api/conciliaciones' + qs({ fecha })), [fecha]);
  const [k] = useCarga(() => api.get('/api/kpi' + qs({ fecha })), [fecha]);
  return (
    <>
      <div className="top"><div><h1>Conciliación</h1><div className="sub">Al cierre de cada turno carga el mismo archivo de stock. La plataforma lo compara con la Base del inicio y marca cada tarea según dónde quedó el stock; nadie digita el avance.</div></div></div>
      <div className="sec">
        <h2>Stock al cierre del turno</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <IrACarga id="stock" fecha={fecha} etiqueta="Cargar stock de cierre (en Datos)" />
          <span className="note">En Datos, Cargas elige la jornada y "Stock al cierre del turno T1 / T2 / T3".</span>
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
        <p className="note">Si un turno no tiene foto de stock, el supervisor puede completar su archivo .xlsx (descargado en "Asignación del día") e importarlo en Datos, Cargas ("Avance del turno"), igual que en el libro Excel.</p>
        <IrACarga id="avances" etiqueta="Importar archivo del turno (en Datos)" />
      </div>
    </>
  );
}
