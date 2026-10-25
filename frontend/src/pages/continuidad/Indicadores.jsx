// Indicadores de continuidad y análisis de causas de incumplimiento por turno y jefe
import { useState } from 'react';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api, qs } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { Indice } from './Panel.jsx';
import { N, css, ymd, sum } from '../../lib/fmt.js';

const pc = v => v === null || v === undefined ? '—' : `${v}%`;

function TablaResumen({ filas, primera, extra = [] }) {
  return <div className="tscroll"><table>
    <thead><tr><th>{primera}</th>{extra.map(e => <th key={e[0]}>{e[0]}</th>)}<th className="num">Tareas</th><th className="num">Cerradas</th><th className="num">Pasaron al turno siguiente</th><th className="num">Vencidas</th><th className="num">% cumplimiento</th></tr></thead>
    <tbody>{filas.map((r, i) => <tr key={i}><td>{r.k}</td>{extra.map(e => <td key={e[0]}>{e[1](r)}</td>)}<td className="num">{r.total}</td><td className="num">{r.cerradas}</td>
      <td className={`num ${r.traspasadas ? 'warn' : ''}`}>{r.traspasadas}</td><td className={`num ${r.vencidas ? 'warn' : ''}`}>{r.vencidas}</td><td className="num">{pc(r.pct)}</td></tr>)}</tbody>
  </table></div>;
}

export default function Indicadores() {
  const { meta } = useApp();
  const [dias, setDias] = useState(30);
  const hasta = meta?.fechaOperativa || ymd(new Date());
  const desde = ymd(new Date(new Date(hasta + 'T12:00:00').getTime() - dias * 86400000));
  const d = useCarga(async () => {
    const [ind, pareto] = await Promise.all([api.get('/continuidad/indicadores?dias=' + dias), api.get('/cierres/pareto?' + qs({ desde, hasta }))]);
    return { ind, pareto };
  }, [dias, desde, hasta]);
  if (!meta || !d.data) return <Cargando error={d.error} />;
  const { ind, pareto } = d.data;
  const porCausa = Object.entries(pareto.reduce((m, r) => { m[r.causa] = (m[r.causa] || 0) + r.brecha; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const turnos = meta.turnos.map(t => t.id);
  const pal = ['--blue', '--teal', '--violet'];
  const porJefe = Object.values(pareto.reduce((m, r) => {
    const k = r.jefe || '(sin jefe)'; m[k] = m[k] || { jefe: k, turno: r.turno, brecha: 0, minutos: 0, desvios: 0, causas: {} };
    m[k].brecha += r.brecha; m[k].minutos += r.minutos || 0; m[k].desvios += r.desvios; m[k].causas[r.causa] = (m[k].causas[r.causa] || 0) + r.brecha; return m;
  }, {})).sort((a, b) => b.brecha - a.brecha);
  let acc = 0; const tot = sum(porCausa, x => x[1]);

  return (
    <>
      <PageHead title="Indicadores" sub={`Últimos ${dias} días`}>
        <select value={dias} onChange={e => setDias(+e.target.value)} style={{ width: 'auto' }} aria-label="Período"><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select>
        <Indice valor={ind.indice} />
      </PageHead>
      <Kpis items={[['Entregas de turno', ind.entregas], ['Confirmadas', pc(ind.pctConfirmadas)], ['Confirmadas a tiempo', pc(ind.pctATiempo), ind.pctATiempo !== null && ind.pctATiempo < 80 ? 'warn' : ''],
        ['Minutos promedio para confirmar', ind.minPromedio ?? '—'], ['Cumplimiento de compromisos', pc(ind.pctTareas), ind.pctTareas !== null && ind.pctTareas < 85 ? 'warn' : ''],
        ['Traspasadas al turno siguiente', ind.traspasadas, ind.traspasadas ? 'warn' : ''], ['Traspasadas 2 veces o más', ind.reincidentes, ind.reincidentes ? 'warn' : '']]} />
      <div className="grid">
        <Card className="s7" title="Causas de incumplimiento productivo" hint="Unidades de brecha registradas en los cierres de turno, por causa (Pareto).">
          {porCausa.length ? <Grafico label="Pareto de causas" datos={{ labels: porCausa.map(x => x[0]), datasets: [
            { type: 'line', label: '% acumulado', data: porCausa.map(x => Math.round((acc += x[1]) / Math.max(1, tot) * 100)), borderColor: css('--ink'), backgroundColor: css('--ink'), yAxisID: 'y2', pointRadius: 3 },
            ...turnos.map((t, i) => ({ label: t, yAxisID: 'y', backgroundColor: css(pal[i % pal.length]), borderRadius: 2,
              data: porCausa.map(([c]) => sum(pareto.filter(r => r.causa === c && r.turno === t), r => r.brecha)) }))] }}
            apilado opciones={{ scales: { x: { ticks: { autoSkip: false, maxRotation: 40 } }, y2: { stacked: false, position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + '%' } } } }} />
            : <p className="empty">Aún no hay causas registradas en cierres de turno.</p>}
        </Card>
        <Card className="s5" title="Por jefe de turno" hint="Brecha, minutos perdidos y causa más frecuente en sus cierres.">
          <div className="tscroll"><table>
            <thead><tr><th>Jefe</th><th>Turno</th><th className="num">Desvíos</th><th className="num">Brecha</th><th className="num">Min.</th><th>Causa principal</th></tr></thead>
            <tbody>{porJefe.map(j => <tr key={j.jefe}><td>{j.jefe}</td><td>{j.turno}</td><td className="num">{j.desvios}</td><td className="num">{N(j.brecha)}</td><td className="num">{N(j.minutos)}</td>
              <td>{Object.entries(j.causas).sort((a, b) => b[1] - a[1])[0]?.[0]}</td></tr>)}</tbody>
          </table></div>
        </Card>
      </div>
      <Card title="Compromisos por turno"><TablaResumen primera="Turno" filas={ind.porTurno.map(r => ({ ...r, k: r.turno }))} /></Card>
      <Card title="Compromisos por responsable"><TablaResumen primera="Nombre" filas={ind.porPersona.map(r => ({ ...r, k: r.nombre }))} extra={[['Rol', r => r.rol], ['Turno', r => r.turno]]} /></Card>
      <Card title="Compromisos por categoría"><TablaResumen primera="Categoría" filas={ind.porCategoria.map(r => ({ ...r, k: r.categoria }))} /></Card>
    </>
  );
}
