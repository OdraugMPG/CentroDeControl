// Almacenado (ruta /recepcion): lo almacenado según la extracción ALM_USER del WMS (una fila por LPN ubicado). Unidades por hora y turno,
// por CD y operación, productividad por usuario y origen, para el rango de días y los filtros elegidos.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, css, hhmm, fechaHora, dmy, dm, diaNombre } from '../../lib/fmt.js';

const COLOR_TURNO = { AM: '--teal', PM: '--blue', NOC: '--violet' };
const colorTurno = (t, i) => css(COLOR_TURNO[t] || ['--yellow', '--slate', '--red'][i % 3]);
const ms = (v) => (v ? new Date(v).getTime() : null);

// Tabla ordenable por cualquier columna: cols = [clave, título, numérica, formato]
export function TablaOrden({ filas, cols, inicial, max, clave }) {
  const [orden, setOrden] = useState(inicial);
  const [todas, setTodas] = useState(false);
  const [k, dir] = orden;
  const ord = useMemo(() => filas.slice().sort((a, b) => {
    const x = a[k], y = b[k];
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  }), [filas, k, dir]);
  const ver = max && !todas ? ord.slice(0, max) : ord;
  return (
    <>
      <div className="tscroll"><table>
        <thead><tr>{cols.map(([c, t, n]) => (
          <th key={c} className={n ? 'num' : ''} aria-sort={k === c ? (dir > 0 ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="link" style={{ font: 'inherit', color: 'inherit' }} onClick={() => setOrden([c, k === c ? -dir : n ? -1 : 1])}>
              {t}{k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>))}</tr></thead>
        <tbody>{ver.map((f, i) => <tr key={clave ? clave(f) : i}>{cols.map(([c, , n, fmt]) => <td key={c} className={n ? 'num' : ''}>{fmt ? fmt(f[c], f) : f[c] || '—'}</td>)}</tr>)}</tbody>
      </table></div>
      {max && ord.length > max && <p className="hint" style={{ marginTop: 6 }}>
        <button type="button" className="link" onClick={() => setTodas(!todas)}>{todas ? `Ver solo los primeros ${max}` : `Ver los ${N(ord.length)}`}</button></p>}
    </>
  );
}

// Barra de participación dentro de la celda
export const Barra = ({ v, color = '--teal' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
    <span style={{ width: 70, height: 8, borderRadius: 4, background: 'var(--empty)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.min(100, v * 100)}%`, background: `var(${color})` }} /></span>
    {pctf(v)}</span>
);

function Filtros({ r, f, set }) {
  const dias = r.dias.map((d) => d.dia), min = dias[0], max = dias[dias.length - 1];
  const sel = (k, l, ops) => (
    <label className="field" style={{ width: 'auto' }}><span>{l}</span>
      <select value={f[k]} onChange={(e) => set({ ...f, [k]: e.target.value })}>
        <option value="">Todos</option>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>);
  return (
    <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
      <label className="field" style={{ width: 'auto' }}><span>Desde</span>
        <input type="date" min={min} max={max} value={f.desde || r.desde} onChange={(e) => set({ ...f, desde: e.target.value, hasta: e.target.value > (f.hasta || r.hasta) ? e.target.value : f.hasta || r.hasta })} /></label>
      <label className="field" style={{ width: 'auto' }}><span>Hasta</span>
        <input type="date" min={min} max={max} value={f.hasta || r.hasta} onChange={(e) => set({ ...f, hasta: e.target.value, desde: e.target.value < (f.desde || r.desde) ? e.target.value : f.desde || r.desde })} /></label>
      {sel('cd', 'CD', r.opciones.cds)}
      {sel('turno', 'Turno', r.opciones.turnos)}
      {sel('operacion', 'Operación', r.opciones.operaciones)}
      <button type="button" className="ghost" onClick={() => set({ ...f, desde: max, hasta: max })}>Último día</button>
      <button type="button" className="ghost" onClick={() => set({ ...f, desde: min, hasta: max })}>Todo lo cargado ({dias.length} días)</button>
    </div>
  );
}

export default function Recepcion({ titulo = 'Almacenado', extra = null }) {
  const [f, setF] = useState({ desde: '', hasta: '', cd: '', turno: '', operacion: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const d = useCarga(() => api.get(`/recepcion/almacenado${qs ? `?${qs}` : ''}`), [qs]);
  const r = d.data;
  if (!r) return <><PageHead title={titulo}>{extra}</PageHead><Cargando error={d.error} /></>;
  if (!r.cargado) return (
    <>
      <PageHead title={titulo} sub="Lo almacenado según la extracción de almacenados del WMS (ALM_USER)">{extra}</PageHead>
      <p className="empty">Aún no hay almacenados cargados. Súbelos en <Link to="/cargas#carga-almacenamiento">Datos, Cargas (Almacenamiento)</Link>.</p>
    </>
  );

  const t = r.tot, varios = r.desde !== r.hasta;
  const turnos = [...new Set(r.porHora.map((x) => x.turno))].sort((a, b) => r.opciones.turnos.indexOf(a) - r.opciones.turnos.indexOf(b));
  // el día operativo parte con la primera hora del turno AM (la noche cruza la medianoche)
  const inicio = Math.min(...r.porHora.filter((x) => x.turno === 'AM').map((x) => x.hora), 7);
  const horas = [...new Set(r.porHora.map((x) => x.hora))].sort((a, b) => ((a - inicio + 24) % 24) - ((b - inicio + 24) % 24));
  const hora = (h, tu) => r.porHora.find((x) => x.hora === h && x.turno === tu);
  const dias = [...new Set(r.porDia.map((x) => x.dia))];
  const porDia = (di, tu) => r.porDia.find((x) => x.dia === di && x.turno === tu);
  const ritmo = t.horas ? t.unidades / t.horas : 0;
  const usuarios = r.porUsuario.map((u) => ({ ...u, uh: u.horas ? u.unidades / u.horas : 0, lh: u.horas ? u.lpns / u.horas : 0, primera: ms(u.primera), ultima: ms(u.ultima) }));
  const areas = r.porArea.map((a) => ({ ...a, part: t.unidades ? a.unidades / t.unidades : 0, ulpn: a.lpns ? a.unidades / a.lpns : 0 }));
  const porCd = Object.values(areas.reduce((m, a) => { (m[a.cd] ||= { cd: a.cd, unidades: 0, lpns: 0 }); m[a.cd].unidades += a.unidades; m[a.cd].lpns += a.lpns; return m; }, {}))
    .sort((a, b) => b.unidades - a.unidades);
  const conPart = (l) => l.map((x) => ({ ...x, part: t.unidades ? x.unidades / t.unidades : 0 }));
  const rango = varios ? `del ${dmy(r.desde)} al ${dmy(r.hasta)}` : `${diaNombre(r.desde)} ${dmy(r.desde)}`;
  const filtrado = [r.filtros.cd, r.filtros.turno, r.filtros.operacion].filter(Boolean).join(' · ');

  return (
    <>
      <PageHead title={titulo} sub={`Almacenado ${rango}${filtrado ? ` · ${filtrado}` : ''}. Última carga: ${r.ultima?.archivo || '—'} (${fechaHora(ms(r.ultima?.cargado_en))}), con datos hasta ${fechaHora(ms(r.ultima?.corte))}.`}>
        <Link to="/cargas#carga-almacenamiento">Cargar almacenados</Link>{extra}
      </PageHead>
      <Filtros r={r} f={f} set={setF} />
      <Kpis items={[
        ['Unidades almacenadas', N(t.unidades)],
        ['LPN ubicados', <>{N(t.lpns)} <small>{t.lpns ? (t.unidades / t.lpns).toFixed(1).replace('.', ',') : '—'} un./LPN</small></>],
        ['SKU', N(t.skus)],
        ['Ubicaciones destino', N(t.ubicaciones)],
        ['Usuarios', <>{N(t.usuarios)} <small>{N(t.usuarios ? t.unidades / t.usuarios : 0)} un. c/u</small></>],
        ['Ritmo por hora activa', <>{N(ritmo)} <small>un./h en {N(t.horas)} h</small></>],
        ['Sin ASN', <>{pctf(t.unidades ? t.sin_asn / t.unidades : 0)} <small>{N(t.sin_asn)} un.</small></>],
        ['ASN', N(t.asns)]]} />
      <div className="grid">
        <Card className={varios ? 's7' : 's12'} title="Unidades almacenadas por hora"
          hint={`Por turno, desde las ${String(inicio).padStart(2, '0')}:00 (el turno noche cruza la medianoche).${varios ? ` Suma de los ${dias.length} días del rango.` : ''}`}>
          <Grafico apilado label="Unidades almacenadas por hora y turno" datos={{
            labels: horas.map((h) => `${String(h).padStart(2, '0')}:00`),
            datasets: turnos.map((tu, i) => ({ label: tu || 'Sin turno', data: horas.map((h) => hora(h, tu)?.unidades || 0), backgroundColor: colorTurno(tu, i), borderRadius: 2 }))
          }} opciones={{ plugins: { tooltip: { callbacks: { afterBody: (it) => { const h = horas[it[0].dataIndex]; const x = r.porHora.filter((y) => y.hora === h); return `${N(x.reduce((s, y) => s + y.lpns, 0))} LPN · ${N(Math.max(...x.map((y) => y.usuarios)))} usuarios`; } } } } }} />
        </Card>
        {varios && <Card className="s5" title="Unidades por día y turno">
          <Grafico apilado label="Unidades almacenadas por día y turno" datos={{
            labels: dias.map((di) => `${diaNombre(di).slice(0, 3)} ${dm(di)}`),
            datasets: turnos.map((tu, i) => ({ label: tu || 'Sin turno', data: dias.map((di) => porDia(di, tu)?.unidades || 0), backgroundColor: colorTurno(tu, i), borderRadius: 2 }))
          }} />
        </Card>}
      </div>
      <Card title="Por turno">
        <div className="tscroll"><table>
          <thead><tr><th>{varios ? 'Día' : 'Turno'}</th>{varios && turnos.map((tu) => <th key={tu} className="num">{tu || 'Sin turno'}</th>)}<th className="num">{varios ? 'Total' : 'Unidades'}</th>{!varios && <><th className="num">%</th><th className="num">LPN</th><th className="num">SKU</th></>}</tr></thead>
          <tbody>
            {varios ? dias.map((di) => <tr key={di}><td>{diaNombre(di)} {dmy(di)}</td>{turnos.map((tu) => <td key={tu} className="num">{N(porDia(di, tu)?.unidades || 0)}</td>)}
              <td className="num"><b>{N(r.porDia.filter((x) => x.dia === di).reduce((s, x) => s + x.unidades, 0))}</b></td></tr>)
              : r.porDia.map((x) => <tr key={x.turno}><td>{x.turno || 'Sin turno'}</td><td className="num">{N(x.unidades)}</td><td className="num">{pctf(x.unidades / Math.max(1, t.unidades))}</td><td className="num">{N(x.lpns)}</td><td className="num">{N(x.skus)}</td></tr>)}
            <tr className="tot"><td>Total</td>{varios && turnos.map((tu) => <td key={tu} className="num">{N(r.porDia.filter((x) => x.turno === tu).reduce((s, x) => s + x.unidades, 0))}</td>)}<td className="num">{N(t.unidades)}</td>{!varios && <><td className="num">100%</td><td className="num">{N(t.lpns)}</td><td className="num">{N(t.skus)}</td></>}</tr>
          </tbody>
        </table></div>
      </Card>
      <div className="grid">
        <Card className="s5" title="Por CD" hint="Participación en las unidades almacenadas.">
          <Grafico horizontal leyenda={false} alto={Math.max(160, porCd.length * 38)} label="Unidades almacenadas por CD" datos={{
            labels: porCd.map((c) => c.cd),
            datasets: [{ label: 'Unidades', data: porCd.map((c) => c.unidades), backgroundColor: css('--blue'), borderRadius: 3 }]
          }} opciones={{ plugins: { tooltip: { callbacks: { afterLabel: (c) => `${pctf(porCd[c.dataIndex].unidades / Math.max(1, t.unidades))} · ${N(porCd[c.dataIndex].lpns)} LPN` } } } }} />
        </Card>
        <Card className="s7" title="Por CD y operación">
          <TablaOrden filas={areas} inicial={['unidades', -1]} clave={(a) => a.cd + a.operacion} cols={[
            ['cd', 'CD'], ['operacion', 'Operación'], ['unidades', 'Unidades', true, N], ['part', '% del total', true, (v) => <Barra v={v} />],
            ['lpns', 'LPN', true, N], ['ulpn', 'Un./LPN', true, (v) => v.toFixed(1).replace('.', ',')], ['skus', 'SKU', true, N], ['usuarios', 'Usuarios', true, N]]} />
        </Card>
      </div>
      <Card title="Productividad por usuario" hint="Horas activas = horas del reloj en que el usuario almacenó al menos un LPN. El CD, la operación y el turno son los más frecuentes del usuario en el rango.">
        <TablaOrden filas={usuarios} inicial={['unidades', -1]} max={40} clave={(u) => u.usuario} cols={[
          ['usuario', 'Usuario'], ['cd', 'CD'], ['operacion', 'Operación'], ['turno', 'Turno'],
          ['unidades', 'Unidades', true, N], ['lpns', 'LPN', true, N], ['skus', 'SKU', true, N], ['horas', 'Horas activas', true, N],
          ['uh', 'Un./hora', true, N], ['lh', 'LPN/hora', true, (v) => v.toFixed(1).replace('.', ',')],
          ['primera', 'Primero', true, (v) => (varios ? fechaHora(v) : hhmm(v))], ['ultima', 'Último', true, (v) => (varios ? fechaHora(v) : hhmm(v))]]} />
      </Card>
      <div className="grid">
        <Card className="s6" title="Origen (DESDE)" hint="Ubicación desde la que se tomó el LPN para almacenarlo (zona de recepción o staging).">
          <TablaOrden filas={conPart(r.porOrigen)} inicial={['unidades', -1]} max={12} clave={(x) => x.desde} cols={[
            ['desde', 'Origen', false, (v) => v || <span className="muted">Sin origen</span>], ['unidades', 'Unidades', true, N],
            ['part', '%', true, (v) => <Barra v={v} color="--violet" />], ['lpns', 'LPN', true, N], ['skus', 'SKU', true, N]]} />
        </Card>
        {r.porDepto.length > 0 ? <Card className="s6" title="Por departamento">
          <TablaOrden filas={conPart(r.porDepto)} inicial={['unidades', -1]} max={12} clave={(x) => x.depto} cols={[
            ['depto', 'Depto', false, (v) => v || <span className="muted">Sin depto</span>], ['unidades', 'Unidades', true, N],
            ['part', '%', true, (v) => <Barra v={v} />], ['lpns', 'LPN', true, N], ['skus', 'SKU', true, N]]} />
        </Card> : <Card className="s6" title="Por departamento"><p className="empty">El archivo cargado no trae la columna DEPTO (la versión LITE no la incluye).</p></Card>}
        {r.porFlujo.length > 0 && <Card className="s6" title="Por flujo">
          <TablaOrden filas={conPart(r.porFlujo)} inicial={['unidades', -1]} clave={(x) => x.flujo} cols={[
            ['flujo', 'Flujo', false, (v) => v || <span className="muted">Sin flujo</span>], ['unidades', 'Unidades', true, N],
            ['part', '%', true, (v) => <Barra v={v} />], ['lpns', 'LPN', true, N]]} />
        </Card>}
        {r.porJornada.length > 0 && <Card className="s6" title="Por jornada">
          <TablaOrden filas={conPart(r.porJornada)} inicial={['unidades', -1]} clave={(x) => x.jornada} cols={[
            ['jornada', 'Jornada', false, (v) => v || <span className="muted">Sin jornada</span>], ['unidades', 'Unidades', true, N],
            ['part', '%', true, (v) => <Barra v={v} />], ['lpns', 'LPN', true, N]]} />
        </Card>}
      </div>
    </>
  );
}
