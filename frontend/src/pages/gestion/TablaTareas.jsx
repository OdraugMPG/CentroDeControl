import React, { useState } from 'react';
import { api, fmt, PROC } from './api.js';
import { Pill, toast } from './ui.jsx';

const ESTADOS = ['PENDIENTE', 'PARCIAL', 'EJECUTADO', 'NO EJECUTADO'];
const MOTIVOS = ['Ubicación bloqueada', 'SKU sin stock físico', 'Destino sin espacio', 'Equipo no disponible', 'Prioridad operacional'];

function Fila({ t, conCD, onCambio, rapido }) {
  const [ed, setEd] = useState(null);
  const guardar = async (cambios) => {
    try {
      const n = await api.patch('/api/tareas/' + t.id, cambios);
      onCambio(n);
      setEd(null);
      toast(`${t.folio || 'Tarea'} · ${n.estado}`);
    } catch (e) { toast(e.message, true); }
  };
  const cerrada = t.estado === 'EJECUTADO';
  return (
    <tr>
      {conCD && <><td>{t.cd}</td><td>T{t.turno}</td></>}
      <td><span className="tag" title={PROC[t.proceso]}>{t.proceso}</span></td>
      <td className="mono">{t.folio}{t.secuencia ? <span className="muted"> · {t.secuencia}</span> : null}</td>
      <td>{t.piso}</td>
      <td className="mono">{t.proceso === 'INV' ? t.zona : t.ubic_origen}</td>
      <td className="mono">{t.sku || ''}</td>
      <td className="wrap" style={{ maxWidth: 260 }}>{t.descripcion}</td>
      <td className="mono" style={t.ubic_destino === 'SIN UBICACION' ? { color: 'var(--bad)' } : null}>{t.ubic_destino || ''}</td>
      <td className="mono">{t.asignado_a}</td>
      <td className="num">{fmt(t.unid_asig)}</td>
      {ed ? (
        <td colSpan={4}>
          <div className="inline">
            <select aria-label="Estado" value={ed.estado} onChange={(e) => setEd({ ...ed, estado: e.target.value })}>{ESTADOS.map((x) => <option key={x}>{x}</option>)}</select>
            <input aria-label="Unidades reales" className="w60" type="number" min="0" value={ed.unid_real} onChange={(e) => setEd({ ...ed, unid_real: e.target.value })} placeholder="Unid." />
            <input aria-label="Observación" list="motivos" className="w200" type="text" value={ed.observacion} onChange={(e) => setEd({ ...ed, observacion: e.target.value })} placeholder={ed.estado === 'NO EJECUTADO' ? 'Motivo (obligatorio)' : 'Observación'} />
            <button className="btn sm primary" onClick={() => guardar(ed)}>Guardar</button>
            <button className="btn sm" onClick={() => setEd(null)}>Cancelar</button>
          </div>
        </td>
      ) : (
        <>
          <td className="num">{t.unid_real === null ? '—' : fmt(t.unid_real)}</td>
          <td><Pill estado={t.estado} /></td>
          <td className="note wrap" style={{ maxWidth: 260 }}>{t.observacion || ''}{t.fuente ? <div className="muted" style={{ fontSize: 11.5 }}>{t.fuente}</div> : null}</td>
          <td>
            {t.estado !== 'SIN DESTINO' && (
              <div className="inline">
                {rapido && !cerrada && <button className="btn sm" onClick={() => guardar({ estado: 'EJECUTADO' })}>{t.proceso === 'INV' ? 'Zona contada' : 'Ejecutada'}</button>}
                <button className="btn sm" onClick={() => setEd({ estado: t.estado, unid_real: t.unid_real ?? '', observacion: t.observacion || '' })}>Editar</button>
              </div>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

export default function TablaTareas({ tareas, conCD = true, onCambio, rapido = false }) {
  return (
    <div className="tbl">
      <datalist id="motivos">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
      <table>
        <thead>
          <tr>
            {conCD && <><th>CD</th><th>Turno</th></>}
            <th>Proceso</th><th>N° tarea · sec.</th><th>Piso</th><th>Origen / zona</th><th>SKU</th><th>Descripción</th><th>Destino</th><th>Asignado a</th>
            <th className="num">Unid. asig.</th><th className="num">Unid. reales</th><th>Estado</th><th>Observación · origen del dato</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tareas.map((t) => <Fila key={t.id} t={t} conCD={conCD} onCambio={onCambio} rapido={rapido} />)}
          {!tareas.length && <tr><td colSpan={16} className="note" style={{ padding: 20 }}>No hay tareas con estos filtros.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
