import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Tareas from '../../components/Tareas.jsx';
import { ymd, dmy, diaNombre } from '../../lib/fmt.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOWS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function Calendario() {
  const { meta } = useApp();
  const hoy = meta?.fechaOperativa || ymd(new Date());
  const [mes, setMes] = useState(() => { const d = new Date(hoy + 'T12:00:00'); return [d.getFullYear(), d.getMonth()]; });
  const [dia, setDia] = useState(hoy);
  const [y, m] = mes;
  const desde = ymd(new Date(y, m, 1)), hasta = ymd(new Date(y, m + 1, 0));
  const d = useCarga(async () => {
    const [tareas, personas] = await Promise.all([api.get('/continuidad/tareas?' + qs({ desde, hasta })), api.get('/continuidad/personas')]);
    return { tareas, personas };
  }, [desde, hasta]);
  if (!meta) return <Cargando />;
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const nDias = new Date(y, m + 1, 0).getDate();
  const celdas = [...Array(offset).fill(null), ...Array.from({ length: nDias }, (_, i) => ymd(new Date(y, m, i + 1)))];
  const porDia = {};
  (d.data?.tareas || []).forEach(t => (porDia[t.fecha] = porDia[t.fecha] || []).push(t));
  const orden = Object.fromEntries(meta.turnos.map(t => [t.id, t.orden]));
  const delDia = (porDia[dia] || []).slice().sort((a, b) => orden[a.turno_id] - orden[b.turno_id]);
  const cats = meta.categorias;
  const mover = n => { const dd = new Date(y, m + n, 1); setMes([dd.getFullYear(), dd.getMonth()]); };

  return (
    <>
      <PageHead title="Calendario de actividades" sub="Los días sin turnos programados aparecen atenuados." />
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <button type="button" className="ghost" onClick={() => mover(-1)}>Anterior</button>
          <h3 style={{ margin: 0 }}>{MESES[m]} {y}</h3>
          <button type="button" className="ghost" onClick={() => mover(1)}>Siguiente</button>
        </div>
        <div className="calgrid">
          {DOWS.map(x => <div key={x} className="dow">{x}</div>)}
          {celdas.map((c, i) => {
            if (!c) return <div key={i} className="calday out" />;
            const items = porDia[c] || [];
            const libre = !(meta.calendario[new Date(c + 'T12:00:00').getDay()] || []).length;
            return <button key={c} type="button" className={`calday ${c === hoy ? 'today' : ''} ${c === dia ? 'sel' : ''} ${libre ? 'libre' : ''}`} onClick={() => setDia(c)}
              aria-label={`${dmy(c)}, ${items.length} actividades`}>
              <span>{+c.slice(8)}</span>
              <span className="dots">{[...new Set(items.map(t => t.categoria))].slice(0, 6).map(ct => <i key={ct} style={{ '--c': cats[ct] || 'var(--muted)' }} />)}</span>
            </button>;
          })}
        </div>
      </Card>
      <Card title={`${diaNombre(dia)} ${dmy(dia)}, ${delDia.length} actividades`}>
        {d.data ? <Tareas tareas={delDia} personas={d.data.personas} onCambio={d.recargar} mostrarTurno vacio="Sin actividades este día." /> : <Cargando error={d.error} />}
      </Card>
    </>
  );
}
