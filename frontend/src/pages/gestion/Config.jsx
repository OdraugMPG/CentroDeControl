import React, { useEffect, useState } from 'react';
import { api, fmt, fFecha } from './api.js';
import { Subir, toast, useCarga } from './ui.jsx';

function FilaCD({ c, onGuardar }) {
  const [x, setX] = useState(c);
  useEffect(() => setX(c), [c]);
  const cambio = JSON.stringify(x) !== JSON.stringify(c);
  const s = (k, tipo) => (e) => setX({ ...x, [k]: tipo === 'b' ? e.target.checked : tipo === 'n' ? Number(e.target.value) : e.target.value });
  return (
    <tr>
      <td><b>{c.cd}</b></td>
      <td><input type="checkbox" aria-label={'Activo ' + c.cd} checked={x.activo} onChange={s('activo', 'b')} /></td>
      <td><input className="w60" type="number" min="1" max="6" aria-label="Recursos inventario" value={x.rec_inv} onChange={s('rec_inv', 'n')} /></td>
      <td><input className="w60" type="number" min="1" aria-label="Operarios consolidación" value={x.op_cons} onChange={s('op_cons', 'n')} /></td>
      {[1, 2, 3].map((t) => <td key={t}><input type="text" style={{ width: 120 }} aria-label={'Supervisor T' + t} value={x['sup_t' + t]} onChange={s('sup_t' + t)} /></td>)}
      <td><input type="checkbox" aria-label="Stock unitario" checked={x.stock_unitario} onChange={s('stock_unitario', 'b')} /></td>
      <td><select aria-label="Turno stock unitario" value={x.turno_su} onChange={s('turno_su', 'n')}>{[1, 2, 3].map((t) => <option key={t} value={t}>T{t}</option>)}</select></td>
      <td><select aria-label="Operarios SU por piso" value={x.op_su} onChange={s('op_su', 'n')}><option value={1}>1</option><option value={2}>2</option></select></td>
      <td><input type="text" style={{ width: 60 }} aria-label="Prefijo" value={x.prefijo} onChange={s('prefijo')} /></td>
      <td><select aria-label="Turno slow moving" value={x.turno_sm} onChange={s('turno_sm', 'n')}>{[1, 2, 3].map((t) => <option key={t} value={t}>T{t}</option>)}</select></td>
      <td><button className="btn sm primary" disabled={!cambio} onClick={() => onGuardar(x)}>Guardar</button></td>
    </tr>
  );
}

export default function Config() {
  const [cds, , recCds] = useCarga(() => api.get('/api/config/cds'), []);
  const [par, , recPar] = useCarga(() => api.get('/api/config/parametros'), []);
  const [res, , recRes] = useCarga(() => api.get('/api/config/reservadas'), []);
  const [ciclo, , recCiclo] = useCarga(() => api.get('/api/config/ciclo'), []);
  const [vals, setVals] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  useEffect(() => { if (par) setVals(Object.fromEntries(Object.keys(par.definiciones).map((k) => [k, String(par.valores[k])]))); }, [par]);
  const guardarCD = async (x) => { try { await api.put('/api/config/cds/' + x.cd, x); toast(`${x.cd} guardado.`); recCds(); } catch (e) { toast(e.message, true); } };
  const guardarPar = async () => { try { await api.put('/api/config/parametros', vals); toast('Parámetros guardados.'); recPar(); } catch (e) { toast(e.message, true); } };
  const subirRes = async (f) => {
    setSubiendo(true);
    try { const fd = new FormData(); fd.append('archivo', f); const r = await api.post('/api/config/reservadas', fd); toast(`${r.cargadas} ubicaciones reservadas cargadas.`); recRes(); } catch (e) { toast(e.message, true); }
    setSubiendo(false);
  };
  const reiniciar = async (cd) => { const r = await api.del('/api/config/ciclo/' + cd); toast(`${cd}: ciclo de inventario reiniciado (${r.eliminadas} zonas).`); recCiclo(); };
  const grupos = (res || []).reduce((a, x) => ({ ...a, [x.grupo || '(sin piso)']: (a[x.grupo || '(sin piso)'] || 0) + 1 }), {});
  return (
    <>
      <div className="top"><div><h1>Configuración</h1><div className="sub">Lo que usa la asignación diaria: CD activos, operarios fijos y supervisores por turno, parámetros del libro y ubicaciones reservadas.</div></div></div>
      <div className="sec">
        <h2>CD y turnos</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>CD</th><th>Activo</th><th>Rec. inv.</th><th>Op. cons.</th><th>Sup. T1</th><th>Sup. T2</th><th>Sup. T3</th><th>Stock unit.</th><th>Turno SU</th><th>Op. SU/piso</th><th>Prefijo</th><th>Turno SM</th><th></th></tr></thead>
            <tbody>{(cds || []).map((c) => <FilaCD key={c.cd} c={c} onGuardar={guardarCD} />)}</tbody>
          </table>
        </div>
        {cds && !cds.length && <p className="note">Los CD aparecen al cargar la primera Base de stock.</p>}
      </div>
      <div className="sec">
        <div className="row spread"><h2 style={{ margin: 0 }}>Ubicaciones reservadas para stock unitario (Blq_Stk_unit)</h2><Subir etiqueta="Cargar Blq_Stk_unit" onArchivo={subirRes} cargando={subiendo} /></div>
        <p className="note">Columna A = ubicación, B = piso o grupo (opcional), C = capacidad MAX (opcional). Sirve la misma hoja del libro (desde la fila 5) o un archivo simple. Estas ubicaciones no son origen ni destino de consolidación.</p>
        <p>{fmt(res?.length || 0)} ubicaciones · {Object.entries(grupos).map(([g, n]) => `${g}: ${n}`).join(' · ')}</p>
      </div>
      <div className="sec">
        <h2>Ciclo de inventario</h2>
        <table><thead><tr><th>CD</th><th className="num">Zonas inventariadas</th><th>Última</th><th></th></tr></thead>
          <tbody>{(ciclo || []).map((c) => <tr key={c.cd}><td>{c.cd}</td><td className="num">{c.zonas}</td><td>{fFecha(c.ultima)}</td><td><button className="btn sm danger" onClick={() => reiniciar(c.cd)}>Reiniciar ciclo</button></td></tr>)}
            {ciclo && !ciclo.length && <tr><td colSpan={4} className="note">Aún no hay zonas cerradas en el ciclo. Una zona entra al ciclo cuando todas sus tareas de inventario del día quedan ejecutadas.</td></tr>}</tbody></table>
      </div>
      {vals && (
        <div className="sec">
          <div className="row spread"><h2 style={{ margin: 0 }}>Parámetros</h2><button className="btn primary" onClick={guardarPar}>Guardar parámetros</button></div>
          <div className="flt" style={{ marginTop: 12 }}>
            {Object.entries(par.definiciones).map(([k, d]) => (
              <div key={k}><label className="lbl" htmlFor={'p-' + k} style={{ textTransform: 'none', letterSpacing: 0 }}>{d.n}</label><input id={'p-' + k} type="text" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} style={{ width: '100%' }} /></div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
