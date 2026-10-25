import { useEffect, useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';

export default function Dotacion() {
  const { meta, avisar } = useApp();
  const d = useCarga(() => api.get('/continuidad/dotacion'), []);
  const [v, setV] = useState({});
  useEffect(() => { if (d.data) setV(d.data); }, [d.data]);
  if (!meta || !d.data) return <Cargando error={d.error} />;
  const set = (t, fila, x) => setV({ ...v, [t]: { ...(v[t] || {}), [fila]: x } });
  const guardar = async () => { try { await api.put('/continuidad/dotacion', v); avisar('Dotación requerida guardada.'); d.recargar(); } catch (e) { avisar(e.message, 'err'); } };
  let prev = null;
  const total = t => Object.values(v[t] || {}).reduce((s, x) => s + (+x || 0), 0);
  return (
    <>
      <PageHead title="Dotación requerida" sub="Por turno, cargo y área. Cada jefe de turno confirma los presentes en Mi turno." />
      <Card>
        <div className="tscroll"><table>
          <thead><tr><th>Cargo / área</th>{meta.turnos.map(t => <th key={t.id} className="num">{t.id}</th>)}</tr></thead>
          <tbody>{meta.filasAsistencia.flatMap(f => {
            const out = [];
            if (f.funcion && f.cargo !== prev) out.push(<tr key={'h' + f.cargo} className="grp"><td colSpan={meta.turnos.length + 1}>{f.cargo}</td></tr>);
            prev = f.cargo;
            out.push(<tr key={f.fila}><td>{f.funcion ? <span style={{ paddingLeft: 14 }}>{f.funcion}</span> : <b>{f.cargo}</b>}</td>
              {meta.turnos.map(t => <td key={t.id} className="num"><input type="number" min="0" style={{ width: 76 }} value={v[t.id]?.[f.fila] ?? 0}
                aria-label={`${f.fila} turno ${t.id}`} onChange={e => set(t.id, f.fila, e.target.value)} /></td>)}</tr>);
            return out;
          })}</tbody>
          <tfoot><tr><td>Total</td>{meta.turnos.map(t => <td key={t.id} className="num">{total(t.id)}</td>)}</tr></tfoot>
        </table></div>
        <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={guardar}>Guardar dotación requerida</button></div>
      </Card>
    </>
  );
}
