import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { pct, clase, color, fmt } from './api.js';

export function Pill({ estado }) {
  const c = estado === 'NO EJECUTADO' ? 'NO' : estado === 'SIN DESTINO' ? 'SIN' : estado;
  return <span className={'pill p-' + c}>{estado}</span>;
}

export function Tile({ titulo, valor, nota, meta = 0.95 }) {
  return (
    <div className={'kpi ' + clase(valor, meta)}>
      <div className="k">{titulo}</div>
      <div className="v">{pct(valor)}</div>
      <div className="meter"><i style={{ width: Math.min(100, valor * 100) + '%', background: color(valor, meta) }} /><span className="tgt" style={{ left: meta * 100 + '%' }} title={'Meta ' + pct(meta)} /></div>
      <div className="n" style={{ marginTop: 6 }}>{nota} · meta {Math.round(meta * 100)}%</div>
    </div>
  );
}

export function Tiles({ k, meta }) {
  if (!k) return null;
  return (
    <div className="grid-kpi">
      <Tile titulo="Cumplimiento por tareas" valor={k.cumplTareas} nota={`${fmt(k.ejecutadas)} de ${fmt(k.tareas)} ejecutadas`} meta={meta} />
      <Tile titulo="Cumplimiento por unidades" valor={k.cumplUnidades} nota={`${fmt(k.uReal)} de ${fmt(k.uAsig)} unidades`} meta={meta} />
      <div className="kpi"><div className="k">Pendientes</div><div className="v">{fmt(k.pendientes + k.parciales)}</div><div className="n">{fmt(k.parciales)} parciales</div></div>
      <div className={'kpi' + (k.noEjecutadas ? ' bad' : '')}><div className="k">No ejecutadas</div><div className="v">{fmt(k.noEjecutadas)}</div><div className="n">con motivo del supervisor</div></div>
    </div>
  );
}

export function Barra({ valor, meta = 0.95 }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div className="bar" style={{ flex: 1, marginTop: 0, minWidth: 70 }}><i style={{ width: Math.min(100, valor * 100) + '%', background: color(valor, meta) }} /><span className="tgt" style={{ left: meta * 100 + '%' }} /></div>
      <span className="mono" style={{ minWidth: 54, textAlign: 'right' }}>{pct(valor)}</span>
    </div>
  );
}

// Los avisos usan los del centro de control (ver conectarAvisos en Gestion.jsx)
let avisar = () => {};
export const toast = (m, err = false) => avisar(m, err);
export const conectarAvisos = (fn) => { avisar = fn; };

/** Todas las cargas de archivos se hacen en Datos, Cargas: lleva a la tarjeta del archivo (con su modelo). */
export function IrACarga({ id, etiqueta, fecha }) {
  return <Link className="btn primary" to={`/cargas${fecha ? `?fecha=${fecha}` : ''}#carga-${id}`}>{etiqueta}</Link>;
}

export function Subir({ etiqueta, onArchivo, cargando, accept = '.xlsx,.xls,.xlsm,.csv' }) {
  const ref = useRef();
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onArchivo(f); }} />
      <button className="btn primary" disabled={cargando} onClick={() => ref.current.click()}>{cargando ? 'Procesando…' : etiqueta}</button>
    </>
  );
}

export function useCarga(fn, deps) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    setErr(null);
    fn().then((x) => vivo && setD(x)).catch((e) => vivo && setErr(e.message));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [d, err, () => setN((x) => x + 1), setD];
}
