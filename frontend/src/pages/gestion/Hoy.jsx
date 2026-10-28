import React, { useState } from 'react';
import { api, qs, urlApi, fmt, fFecha, hora, PROC } from './api.js';
import { Subir, toast, useCarga } from './ui.jsx';

// [proceso, nombre, medida]: inventario se mide en ubicaciones a contar; el resto en unidades a mover
const PROCS = [['INV', 'Inventario', 'ubicaciones'], ['CONS', 'Consolidación', 'unidades'], ['SU', 'Stock unitario', 'unidades'], ['SM', 'Slow moving', 'unidades'], ['REU', 'Reubicación ABC', 'unidades']];
const AYUDA = {
  INV: 'ubicaciones a contar de las zonas del ciclo.',
  CONS: 'unidades a mover para juntar un SKU repartido en varias ubicaciones; cada movimiento libera una ubicación.',
  SU: 'SKU con 1 unidad en 1 ubicación que se llevan a las ubicaciones reservadas.',
  SM: 'unidades sin venta que van a la zona de slow moving.',
  REU: 'unidades de alta rotación que se acercan al CD prioritario o al OSR.',
};

/** Cantidad asignada (ubicaciones o unidades) y, debajo, el número de tareas. */
function Celda({ x, total }) {
  const cls = 'num' + (total ? ' pub-total' : '');
  if (!x.n) return <td className={cls}><span className="pub-vacio">—</span></td>;
  return <td className={cls}><div className="pub-v">{fmt(x.u)}</div><div className="pub-n">{fmt(x.n)} {x.n === 1 ? 'tarea' : 'tareas'}</div></td>;
}

export default function Hoy({ fecha, irA }) {
  const [est, err, recargar] = useCarga(() => api.get('/api/estado' + qs({ fecha })), [fecha]);
  const [plan] = useCarga(() => api.get('/api/plan' + qs({ fecha })), [fecha, est?.asignacion?.id]);
  const [subiendo, setSubiendo] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [conflicto, setConflicto] = useState(null);
  const [verPlan, setVerPlan] = useState(false);

  const subir = async (f) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('archivo', f); fd.append('fecha', fecha);
      const r = await api.post('/api/cargas/inicio', fd);
      toast(`Base cargada: ${fmt(r.carga.filas)} filas.${r.cdsNuevos.length ? ' CD nuevos en Configuración: ' + r.cdsNuevos.join(', ') : ''}`);
      recargar();
    } catch (e) { toast(e.message, true); }
    setSubiendo(false);
  };
  const generar = async (forzar = false) => {
    setGenerando(true); setConflicto(null);
    try {
      const r = await api.post('/api/asignaciones', { fecha, forzar });
      toast(`Asignación publicada: ${fmt(r.tareas)} tareas en ${Number(r.segundos).toFixed(1)} s.`);
      recargar();
    } catch (e) {
      if (e.status === 409) setConflicto(e.message); else toast(e.message, true);
    }
    setGenerando(false);
  };

  if (err) return <div className="alert bad">{err}</div>;
  if (!est) return <p className="muted">Cargando…</p>;
  const inicio = est.cargas.find((c) => c.tipo === 'INICIO');
  const a = est.asignacion;
  const activos = est.cds.filter((c) => c.activo);
  const sumar = (cd, turno, proceso) => est.conteos.filter((x) => x.cd === cd && (turno === null || x.turno === turno) && x.proceso === proceso)
    .reduce((s, x) => ({ n: s.n + x.n, u: s.u + x.u, sd: s.sd + x.sd }), { n: 0, u: 0, sd: 0 });
  const sinDestinoSU = activos.map((c) => ({ cd: c.cd, sd: sumar(c.cd, null, 'SU').sd })).filter((x) => x.sd > 0);
  // solo los procesos con tareas (o pendientes sin destino) hoy, en el mismo orden para todos los CD
  const procsHoy = PROCS.filter(([p]) => est.conteos.some((x) => x.proceso === p && (x.n || x.sd)));
  const alertas = (a?.log || []).filter((l) => l.tipo !== 'INFO');
  return (
    <>
      <div className="top">
        <div>
          <h1>Asignación del día</h1>
          <div className="sub">Carga la Base del inicio de la jornada y genera en un clic el plan diario, las tareas y el reparto de todos los CD y turnos del {fFecha(fecha)}.</div>
        </div>
      </div>

      <div className="sec">
        <ol className="steps">
          <li className={est.cds.length ? 'ok' : ''}>
            <span className="n">{est.cds.length ? '✓' : 1}</span>
            <div>
              <h3>Configuración</h3>
              <div className="note">{activos.length} CD activos: {activos.map((c) => c.cd).join(', ') || '—'} · {fmt(est.reservadas)} ubicaciones reservadas para stock unitario.</div>
              {!est.cds.length && <div className="note">Los CD se crean solos al cargar la primera Base. Después revisa operarios y supervisores en <button className="btn sm" onClick={() => irA('config')}>Configuración</button></div>}
            </div>
          </li>
          <li className={inicio ? 'ok' : ''}>
            <span className="n">{inicio ? '✓' : 2}</span>
            <div>
              <h3>Base del inicio de la jornada</h3>
              <div className="row" style={{ alignItems: 'center' }}>
                <Subir etiqueta={inicio ? 'Reemplazar Base' : 'Cargar Base de stock'} onArchivo={subir} cargando={subiendo} />
                {inicio ? <span className="note">{inicio.archivo} · {fmt(inicio.filas)} filas · cargada {hora(inicio.creado_en)}</span> : <span className="note">El mismo archivo de stock que hoy pegas en la hoja Base (.xlsx o .csv).</span>}
              </div>
              {(inicio?.avisos || []).map((x) => <div key={x} className="alert warn">{x}</div>)}
            </div>
          </li>
          <li className={a ? 'ok' : ''}>
            <span className="n">{a ? '✓' : 3}</span>
            <div>
              <h3>Asignación diaria</h3>
              <div className="row" style={{ alignItems: 'center' }}>
                <button className="btn primary" disabled={!inicio || generando} onClick={() => generar(false)}>{generando ? 'Generando…' : a ? 'Regenerar asignación' : 'Generar asignación diaria'}</button>
                {a && <span className="note">Generada a las {hora(a.creado_en)} en {Number(a.segundos).toFixed(1)} s · con la Base de las {hora(est.cargas.find((c) => c.id === a.carga_id)?.creado_en)}</span>}
              </div>
              {conflicto && (
                <div className="alert warn">{conflicto}
                  <div className="row" style={{ marginTop: 8 }}><button className="btn sm danger" onClick={() => generar(true)}>Regenerar igual</button><button className="btn sm" onClick={() => setConflicto(null)}>Cancelar</button></div>
                </div>
              )}
            </div>
          </li>
        </ol>
      </div>

      {a && (
        <>
          <div className="sec">
            <div className="row spread" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Tareas publicadas</h2>
              <a className="btn" href={urlApi('/api/archivos/wms' + qs({ fecha }))}>Descargar archivo para el WMS</a>
            </div>
            {sinDestinoSU.length > 0 && (
              <div className="alert warn">
                <b>{fmt(sinDestinoSU.reduce((s, x) => s + x.sd, 0))} SKU de stock unitario sin publicar</b> ({sinDestinoSU.map((x) => `${x.cd} ${fmt(x.sd)}`).join(' · ')}): no hay cupo en las ubicaciones reservadas de su piso.
                Amplía las reservadas en <button className="link" onClick={() => irA('config')}>Configuración</button> y vuelve a generar la asignación.
              </div>
            )}
            <div className="pub-cards">
              {(a.resumen || []).map((c) => {
                const total = procsHoy.reduce((s, [p]) => s + sumar(c.cd, null, p).n, 0);
                return (
                  <div className="pub-card" key={c.cd}>
                    <div className="pub-head"><h3>{c.cd}</h3><span className="note">{fmt(total)} tareas</span></div>
                    <table className="pub">
                      <thead>
                        <tr>
                          <th>Proceso</th>
                          {c.turnos.map((t) => (
                            <th key={t.turno} className="num">
                              <div className="pub-turno">T{t.turno} <a href={urlApi('/api/archivos/turno' + qs({ fecha, cd: c.cd, turno: t.turno }))} title={`Archivo .xlsx de ${t.supervisor}`}>.xlsx</a></div>
                              <div className="pub-sup">{t.supervisor}</div>
                            </th>
                          ))}
                          <th className="num pub-total">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {procsHoy.map(([p, nombre, med]) => {
                          const tot = sumar(c.cd, null, p);
                          return (
                            <tr key={p}>
                              <td><div className="pub-proc">{nombre}</div><div className="pub-med">{med}{tot.sd > 0 && <span className="pub-sd" title="Sin cupo en ubicaciones reservadas: no se publicaron">{fmt(tot.sd)} sin destino</span>}</div></td>
                              {c.turnos.map((t) => <Celda key={t.turno} x={sumar(c.cd, t.turno, p)} />)}
                              <Celda x={tot} total />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            <dl className="pub-leyenda">
              {procsHoy.map(([p, nombre]) => <div key={p}><dt>{nombre}</dt><dd>{AYUDA[p]}</dd></div>)}
            </dl>
          </div>

          <div className="sec">
            <h2>Avisos de la generación ({alertas.length})</h2>
            <div className="log">
              {(a.log || []).map((l, i) => (
                <div key={i}><span className={'pill ' + (l.tipo === 'INFO' ? 'p-PENDIENTE' : 'p-PARCIAL')}>{l.tipo}</span> <b>{l.ctx}</b> · {l.texto}</div>
              ))}
            </div>
          </div>

          <div className="sec">
            <div className="row spread"><h2 style={{ margin: 0 }}>Plan diario por turno</h2><button className="btn sm" onClick={() => setVerPlan(!verPlan)}>{verPlan ? 'Ocultar' : `Ver ${plan?.length || 0} líneas`}</button></div>
            {verPlan && (
              <div className="tbl" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>CD</th><th>Turno</th><th>Tarea</th><th>Piso</th><th>Zona pasillo</th><th className="num">HH plan</th><th className="num">% zona</th><th>Operarios</th><th className="num">Ubic. / movim.</th></tr></thead>
                  <tbody>{(plan || []).map((l, i) => (
                    <tr key={i}><td>{l.cd}</td><td>T{l.turno}</td><td>{l.tarea === 'INVENTARIO' ? PROC.INV : PROC.CONS}</td><td>{l.piso}</td><td className="mono">{l.zona}</td>
                      <td className="num">{fmt(l.hh, 1)}</td><td className="num">{Math.round(l.pct * 100)}%</td><td className="mono">{l.operarios}</td><td className="num">{fmt(l.ubicaciones ?? l.movimientos)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
