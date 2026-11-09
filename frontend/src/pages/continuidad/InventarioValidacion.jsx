// Validación de la toma (Gestión de inventario): el resultado por pasada según la columna VALIDACION (primera, segunda
// y tercera), en ubicaciones, SKU y unidades, por día de toma y CD; lo que requiere supervisor; cómo se resuelven las
// diferencias de una pasada a la siguiente y el detalle por ubicación y SKU.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, dmy, dm, css } from '../../lib/fmt.js';
import { descargar } from './Inventario.jsx';

const PASADA = { 1: ['Primera pasada', '--blue'], 2: ['Segunda pasada', '--slate'], 3: ['Tercera pasada', '--yellow'] };
const nombre = (n) => PASADA[n]?.[0] || `Pasada ${n}`;
const color = (n) => PASADA[n]?.[1] || '--violet';
const MEDIDAS = [['ubicaciones', 'Ubicaciones'], ['skus', 'SKU'], ['filas', 'Líneas (ubic. × SKU)'], ['unidCont', 'Unidades contadas'], ['abs', 'Unidades con diferencia']];
const div = (a, b) => (b > 0 ? a / b : null);
const signo = (v) => (v > 0 ? `+${N(v)}` : v < 0 ? `−${N(-v)}` : '0');

function Seg({ valor, opciones, onChange, label }) {
  return (
    <div className="seg-inv" role="group" aria-label={label}>
      {opciones.map(([v, t]) => <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

// Tarjeta de una pasada: ubicaciones, SKU y unidades
function Tarjeta({ titulo, c, x, nota }) {
  return (
    <section className="card val-tarjeta" style={{ '--c': `var(${c})` }}>
      <h3>{titulo}</h3>
      {!x ? <p className="muted" style={{ margin: 0 }}>Sin registros</p> : <>
        <dl>
          <div><dt>Ubicaciones</dt><dd>{N(x.ubicaciones)}</dd><small>{N(x.ubicDif)} con dif.</small></div>
          <div><dt>SKU</dt><dd>{N(x.skus)}</dd><small>{N(x.filas)} líneas</small></div>
          <div><dt>Unidades</dt><dd>{N(x.unidCont)}</dd><small>de {N(x.unidSis)} en sistema</small></div>
        </dl>
        <p className="val-dif"><span className="warn">Faltante {N(x.falt)}</span> · <span>Sobrante {N(x.sobr)}</span> · Neto <b>{signo(x.neto)}</b></p>
        {nota && <p className="hint" style={{ margin: 0 }}>{nota}</p>}
      </>}
    </section>
  );
}

// Tabla día x CD de una pasada (como la tabla dinámica), en la medida elegida
function Matriz({ titulo, c, b, fechas, cds, med }) {
  const v = (x) => (x ? x[med] : null);
  return (
    <div className="val-mtx" style={{ '--c': `var(${c})` }}>
      <div className="val-mtx-h">{titulo}</div>
      <div className="tscroll"><table>
        <thead><tr><th>Fecha</th>{cds.map((cd) => <th key={cd} className="num">{cd}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>{fechas.map((f, i) => (
          <tr key={f}><td>{dmy(f)}</td>{cds.map((cd) => <td key={cd} className="num">{N(v(b.celdas[`${f}|${cd}`])) === '—' ? '' : N(v(b.celdas[`${f}|${cd}`]))}</td>)}<td className="num"><b>{b.dias[i] ? N(v(b.dias[i])) : ''}</b></td></tr>))}</tbody>
        <tfoot><tr><th>Total</th>{b.cds.map((x, i) => <th key={i} className="num">{x ? N(v(x)) : ''}</th>)}<th className="num">{N(v(b.tot))}</th></tr></tfoot>
      </table></div>
    </div>
  );
}

export default function InventarioValidacion() {
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', cd: '', turno: '', empresa: '' });
  const [med, setMed] = useState('ubicaciones');
  const [verDet, setVerDet] = useState('todo');
  const d = useCarga(() => api.get(`/continuidad/inventario/validacion?${new URLSearchParams(filtro)}`), [filtro]);
  const r = d.data;
  const detalle = useMemo(() => (r?.detalle || []).filter((x) => verDet === 'todo' || (verDet === 'dif' ? !x.ok : verDet === 'ok' ? x.ok && x.pasadas > 1 : x.sup)), [r, verDet]);
  if (!r) return <><PageHead title="Validación de la toma" /><Cargando error={d.error} /></>;
  const set = (k) => (e) => setFiltro({ ...filtro, desde: filtro.desde || r.desde, hasta: filtro.hasta || r.hasta, [k]: e.target.value });
  const medN = MEDIDAS.find((m) => m[0] === med)[1];
  const P = r.pasadas, E = r.embudo;

  const porDia = {
    labels: r.fechas.map(dm),
    datasets: P.map((p) => ({ label: nombre(p.conteo), data: p.dias.map((x) => (x ? x[med] : 0)), backgroundColor: css(color(p.conteo)), borderRadius: 4, borderSkipped: false, maxBarThickness: 34 }))
  };
  const embudo = E && {
    labels: ['Líneas contadas (1ª)', 'Con diferencia en la 1ª', 'Fueron a 2ª pasada', 'Cuadraron en la 2ª', 'Fueron a 3ª pasada', 'Cuadraron en la 3ª', 'Siguen con diferencia'],
    datasets: [{ label: 'Líneas', data: [E.lineas, E.dif1, E.a2, E.ok2, E.a3, E.ok3, E.finalDif],
      backgroundColor: ['--blue', '--red', '--slate', '--teal', '--yellow', '--teal', '--red'].map(css), borderRadius: 4, borderSkipped: false, maxBarThickness: 22 }]
  };
  const csv = () => descargar([['Fecha', 'CD', 'Ubicación', 'SKU', 'Sistema', '1ª pasada', '2ª pasada', '3ª pasada', 'Pasadas', 'Diferencia final', 'Resultado', 'Requiere supervisor', 'Turno', 'Usuarios'],
    ...detalle.map((x) => [x.fecha, x.cd, x.ubicacion, x.sku, x.sistema, x.c1 ?? '', x.c2 ?? '', x.c3 ?? '', x.pasadas, x.dif, x.estado, x.sup ? 'SI' : 'NO', x.turno, x.usuario])], `validacion_toma_${r.desde}_${r.hasta}.csv`);
  const pc = (x, n) => (x === null ? <span className="muted">—</span> : <span className={x !== n ? 'warn' : ''}>{N(x)}</span>);

  return (
    <>
      <PageHead title="Validación de la toma" sub={r.datos?.hasta ? `Resultado de la toma por pasada (columna VALIDACION). Hay tomas del ${dmy(r.datos.desde)} al ${dmy(r.datos.hasta)}.` : 'Aún no hay resultados de la toma cargados.'}>
        <Link className="btn" to="/inventario/dashboard">Ir al Dashboard</Link>
      </PageHead>
      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 'auto' }}><span>Toma desde</span><input type="date" value={filtro.desde || r.desde || ''} onChange={set('desde')} /></label>
        <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={filtro.hasta || r.hasta || ''} onChange={set('hasta')} /></label>
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={filtro.cd} onChange={set('cd')}><option value="">Todos</option>{r.cds.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Turno</span><select value={filtro.turno} onChange={set('turno')}><option value="">Todos</option>{r.turnos.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Empresa</span><select value={filtro.empresa} onChange={set('empresa')}><option value="">Todas</option>{r.empresas.map((c) => <option key={c}>{c}</option>)}</select></label>
        {(filtro.desde || filtro.cd || filtro.turno || filtro.empresa) && <button type="button" className="ghost" onClick={() => setFiltro({ desde: '', hasta: '', cd: '', turno: '', empresa: '' })}>Quitar filtros</button>}
      </div>

      {!P.length ? <p className="empty">Sin tomas entre el {dmy(r.desde)} y el {dmy(r.hasta)} con estos filtros.</p> : <>
        <div className="val-tarjetas">
          {[1, 2, 3].map((n) => { const p = P.find((x) => x.conteo === n); return <Tarjeta key={n} titulo={nombre(n)} c={color(n)} x={p?.tot} />; })}
          <Tarjeta titulo="Requiere supervisor" c="--violet" x={r.sup.tot.filas ? r.sup.tot : null} nota="Registros con REQUIERE_SUPERVISOR = SI." />
        </div>

        <div className="grid" style={{ marginTop: 12 }}>
          <Card className="s7" title="Por día de toma" actions={<select aria-label="Medida" value={med} onChange={(e) => setMed(e.target.value)} style={{ width: 'auto' }}>{MEDIDAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>}>
            <Grafico alto={280} label={`${medN} por día y pasada`} datos={porDia} />
          </Card>
          <Card className="s5" title="De una pasada a la siguiente" hint="Por ubicación y SKU de cada día: cuántas diferencias de la 1ª pasada se re-contaron y cuántas cuadraron.">
            <Grafico horizontal alto={280} leyenda={false} label="Embudo de pasadas" datos={embudo}
              opciones={{ plugins: { tooltip: { callbacks: { label: (c) => `${N(c.parsed.x)} líneas (${pctf(div(c.parsed.x, E.lineas))} de las contadas)` } } } }} />
            <p className="hint" style={{ margin: '6px 0 0' }}>{N(E.sinRecontar)} {E.sinRecontar === 1 ? 'línea' : 'líneas'} con diferencia en la 1ª pasada no se re-contaron.</p>
          </Card>
        </div>

        <Card title="Por fecha y CD" hint={`En ${medN.toLowerCase()}, como la tabla dinámica del reporte.`}
          actions={<Seg label="Medida" valor={med} onChange={setMed} opciones={MEDIDAS} />}>
          <div className="val-mtxs">
            {P.map((p) => <Matriz key={p.conteo} titulo={nombre(p.conteo)} c={color(p.conteo)} b={p} fechas={r.fechas} cds={r.cdsDatos} med={med} />)}
            {r.sup.tot.filas > 0 && <Matriz titulo="Requiere supervisor = SI" c="--violet" b={r.sup} fechas={r.fechas} cds={r.cdsDatos} med={med} />}
          </div>
        </Card>

        <Card title="Detalle por ubicación y SKU" hint={`Lo que dio cada pasada; en rojo, el conteo que no coincide con el sistema. ${N(r.totalDetalle)} líneas con más de una pasada o con diferencia${r.totalDetalle > r.detalle.length ? ` (se muestran ${N(r.detalle.length)}; el CSV trae las que se ven)` : ''}.`}
          actions={<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Seg label="Ver" valor={verDet} onChange={setVerDet} opciones={[['todo', 'Todo'], ['dif', 'Siguen con diferencia'], ['ok', 'Cuadraron al re-contar'], ['sup', 'Requieren supervisor']]} />
            <button type="button" className="ghost" onClick={csv} disabled={!detalle.length}>Descargar CSV</button></div>}>
          {detalle.length ? <div className="tscroll" style={{ maxHeight: 520, overflow: 'auto' }}><table>
            <thead><tr><th>Fecha</th><th>CD</th><th>Ubicación</th><th>SKU</th><th className="num">Sistema</th><th className="num">1ª</th><th className="num">2ª</th><th className="num">3ª</th><th className="num">Dif. final</th><th>Resultado</th><th>Turno</th><th>Usuarios</th></tr></thead>
            <tbody>{detalle.slice(0, 500).map((x) => (
              <tr key={`${x.fecha}|${x.cd}|${x.ubicacion}|${x.sku}`}>
                <td>{dm(x.fecha)}</td><td>{x.cd}</td><td>{x.ubicacion}</td><td>{x.sku}</td><td className="num">{N(x.sistema)}</td>
                <td className="num">{pc(x.c1, x.sistema)}</td><td className="num">{pc(x.c2, x.sistema)}</td><td className="num">{pc(x.c3, x.sistema)}</td>
                <td className="num"><b className={x.dif ? 'warn' : 'ok'}>{signo(x.dif)}</b></td>
                <td><span className={`st ${x.ok ? 'cerrada' : x.pasadas > 1 ? 'vencida' : 'abierta'}`}>{x.estado}</span>{x.sup && <span className="pill" style={{ marginLeft: 6 }}>Supervisor</span>}</td>
                <td>{x.turno || '—'}</td><td style={{ fontSize: 12 }}>{x.usuario || '—'}</td></tr>))}</tbody>
          </table></div> : <p className="empty">Nada que mostrar con este filtro.</p>}
          {detalle.length > 500 && <p className="hint">Se muestran 500 de {N(detalle.length)} líneas; descarga el CSV para verlas todas.</p>}
        </Card>
      </>}
    </>
  );
}
