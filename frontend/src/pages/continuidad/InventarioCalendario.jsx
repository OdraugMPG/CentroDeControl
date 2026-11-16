// Gestión de inventario, Calendario de planificación: la programación de Control de Existencia (CE) por día y zona-pasillo.
// Se ajusta en la web (reprogramar o quitar un grupo o algunas ubicaciones, y deshacer) sin volver a subir el Excel; los
// ajustes se guardan y se vuelven a aplicar si se carga de nuevo la programación.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import { N, dmy } from '../../lib/fmt.js';

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const COLORES = ['--blue', '--teal', '--yellow', '--green', '--red', '--muted'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaDe = (iso) => new Date(`${iso}T12:00:00`);
const sumar = (iso, n) => { const d = fechaDe(iso); d.setDate(d.getDate() + n); return ymd(d); };
const diaTxt = (iso) => `${DIAS[fechaDe(iso).getDay()]} ${dmy(iso)}`;

// ¿La operación inventarió el pasillo? Según el resultado de la toma (desde 2 días antes de la fecha de operación).
// El reporte no trae las ubicaciones vacías, por eso desde el 90% se da por inventariado.
const COMPLETO = 0.9;
function estadoToma(g, hoy) {
  if (!g.ubicaciones) return null;
  const p = g.tomadas / g.ubicaciones, pct = `${Math.round(p * 100)}%`;
  const det = `${N(g.tomadas)} de ${N(g.ubicaciones)} ubicaciones con resultado (${pct})${g.tarde ? `, ${N(g.tarde)} después de la operación` : ''}${g.ult_toma ? ` · última toma ${dmy(g.ult_toma)}` : ''}`;
  if (p >= COMPLETO) return { k: 'ok', i: '✓', t: `Inventariado: ${det}` };
  if (g.tomadas) return { k: 'parcial', i: pct, t: `Inventariado en parte: ${det}` };
  if (hoy && g.fecha_op < hoy) return { k: 'no', i: '✕', t: `No inventariado: la operación era el ${dmy(g.fecha_op)} y no hay resultado` };
  return { k: 'pend', i: '', t: 'Pendiente: aún no llega la fecha de operación' };
}
// N días hábiles (lunes a sábado) antes
const operacion = (iso, n) => { let f = iso; for (let i = 0; i < n;) { f = sumar(f, -1); if (fechaDe(f).getDay() !== 0) i++; } return f; };

// Asignación de pasillos sin Excel: con el calendario nuevo de CE se elige el día, el CD y las zonas-pasillo
function Asignar({ fechaIni, cdIni, param, onListo, onCerrar }) {
  const { avisar } = useApp();
  const [fecha, setFecha] = useState(fechaIni || '');
  const [cd, setCd] = useState(cdIni || '');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState(new Set());
  const [mover, setMover] = useState(false);
  const [vuelta, setVuelta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const caja = useRef(null);
  useEffect(() => { caja.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const d = useCarga(() => api.get(`/continuidad/inventario/calendario/pasillos?${new URLSearchParams({ cd, fecha })}`), [cd, fecha]);
  const r = d.data;
  const cdAct = cd || r?.cds?.[0] || '';
  const lista = (r?.pasillos || []).filter((x) => (!cdAct || x.cd === cdAct) && (!busca || x.pasillo.includes(busca.toUpperCase())));
  const zonas = new Map();
  for (const x of lista) { if (!zonas.has(x.zona)) zonas.set(x.zona, []); zonas.get(x.zona).push(x); }
  const k = (x) => `${x.cd}|${x.pasillo}`;
  const elegidos = (r?.pasillos || []).filter((x) => sel.has(k(x)));
  const ubic = elegidos.reduce((a, x) => a + x.ubicaciones - (x.en_fecha || 0), 0);
  const conProx = elegidos.filter((x) => x.proxima && x.proxima !== fecha);
  const domingo = fecha && fechaDe(fecha).getDay() === 0;
  // vuelta sugerida: la siguiente a la última de los pasillos elegidos (o del CD)
  const ultV = Math.max(0, ...(elegidos.length ? elegidos : (r?.pasillos || []).filter((x) => x.cd === cdAct)).map((x) => Number(x.vuelta) || 0));
  const vSug = ultV ? String(ultV + 1) : '';
  const alt = (xs, on) => setSel((s0) => { const s1 = new Set(s0); for (const x of xs) on ? s1.add(k(x)) : s1.delete(k(x)); return s1; });
  const asignar = async () => {
    setOcupado(true);
    try {
      const x = await api.post('/continuidad/inventario/asignar-pasillos', { fecha, vuelta, mover, pasillos: elegidos.map((y) => ({ cd: y.cd, pasillo: y.pasillo })) });
      avisar(`${N(x.pasillos)} pasillos asignados a CE ${diaTxt(x.fecha_ce)} (operación ${diaTxt(x.fecha_op)}), vuelta ${x.vuelta}: ${N(x.creadas)} ubicaciones nuevas${x.movidas ? `, ${N(x.movidas)} movidas desde otra fecha` : ''}.`);
      setSel(new Set()); d.recargar(); onListo(x.fecha_ce);
    } catch (e) { avisar(e.message, 'err'); }
    setOcupado(false);
  };
  return (
    <div ref={caja} style={{ scrollMarginTop: 90 }}>
    <Card title="Asignar pasillos" hint="Para el calendario nuevo de Control de Existencia, sin subir el Excel: elige el día, el CD y las zonas-pasillo. Las ubicaciones de cada pasillo salen de la programación anterior y, si nunca se programó, de la Base de stock."
      actions={<button type="button" className="ghost" onClick={onCerrar}>Cerrar</button>}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="field" style={{ width: 'auto' }}><span>Fecha de Control de Existencia</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        {fecha && <span className="hint" style={{ margin: '0 0 8px' }}>{domingo ? 'CE no programa los domingos.' : `Operación: ${diaTxt(operacion(fecha, param.diasAntes))}`}</span>}
        <label className="field" style={{ width: 110 }}><span>Vuelta</span><input type="text" inputMode="numeric" value={vuelta} placeholder={vSug || 'Ej. 12'} required
          title="Vuelta (ciclo) de Control de Existencia de esta programación; queda en todas las ubicaciones asignadas" onChange={(e) => setVuelta(e.target.value.trim())} /></label>
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={cdAct} onChange={(e) => setCd(e.target.value)}>{(r?.cds || []).map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 160 }}><span>Buscar pasillo</span><input type="search" value={busca} placeholder="Ej. IAB" onChange={(e) => setBusca(e.target.value)} /></label>
        <label className="row" style={{ gap: 6, margin: '0 0 8px', fontSize: 13 }} title="Si el pasillo ya tiene programación pendiente en otra fecha, se mueve a esta (queda como ajuste) en vez de programarlo dos veces">
          <input type="checkbox" checked={mover} onChange={(e) => setMover(e.target.checked)} /> Mover la programación pendiente</label>
      </div>
      {!r ? <Cargando error={d.error} /> : <>
        <div className="asg-zonas">{[...zonas].map(([z, xs]) => {
          const todas = xs.every((x) => sel.has(k(x)));
          return (
            <div key={z} className="asg-zona">
              <label className="asg-zh"><input type="checkbox" checked={todas} onChange={(e) => alt(xs, e.target.checked)} /> <b>{z}</b> <span className="muted">{N(xs.reduce((a, x) => a + x.ubicaciones, 0))} ubic.</span></label>
              <div className="asg-pas">{xs.map((x) => {
                const on = sel.has(k(x)), prox = x.proxima && x.proxima !== fecha;
                return (
                  <label key={x.pasillo} className={`asg-p${on ? ' on' : ''}${x.en_fecha ? ' ya' : ''}`}
                    title={`${x.pasillo}: ${N(x.ubicaciones)} ubicaciones${x.conocidas < x.ubicaciones ? ` (${N(x.ubicaciones - x.conocidas)} desde la Base de stock: solo las que tienen stock)` : ''}${x.ultima ? ` · último CE ${dmy(x.ultima)}` : ' · nunca programado'}${x.vuelta ? ` · última vuelta ${x.vuelta}` : ''}${prox ? ` · ya programado el ${dmy(x.proxima)}` : ''}${x.en_fecha ? ` · ${N(x.en_fecha)} ya en esta fecha` : ''}`}>
                    <input type="checkbox" checked={on} onChange={(e) => alt([x], e.target.checked)} />
                    <b>{x.pasillo}</b><span>{x.vuelta ? `V${x.vuelta} · ` : ''}{N(x.ubicaciones)}</span>
                    {x.en_fecha > 0 ? <i className="asg-b ok">en esta fecha</i> : prox ? <i className="asg-b warn">prog. {dmy(x.proxima).slice(0, 5)}</i> : x.ultima ? <i className="asg-b">últ. {dmy(x.ultima).slice(0, 5)}</i> : <i className="asg-b">{x.conocidas ? 'nuevo' : 'solo Base'}</i>}
                  </label>);
              })}</div>
            </div>);
        })}</div>
        {!lista.length && <p className="hint">Sin pasillos para este filtro.</p>}
        <div className="asg-pie">
          <span><b>{N(elegidos.length)}</b> pasillos · <b>{N(ubic)}</b> ubicaciones nuevas{conProx.length ? ` · ${N(conProx.length)} ya programados en otra fecha (${mover ? 'se mueven' : 'quedarán dos veces'})` : ''}</span>
          {elegidos.length > 0 && <button type="button" className="link" onClick={() => setSel(new Set())}>Limpiar</button>}
          {!vuelta && fecha && elegidos.length > 0 && <span className="hint" style={{ margin: 0 }}>Falta la vuelta{vSug ? ` (sugerida: ${vSug})` : ''}</span>}
          <button type="button" className="btn" disabled={!fecha || domingo || !vuelta || !elegidos.length || ocupado} onClick={asignar}>{fecha ? `Asignar al ${diaTxt(fecha)}${vuelta ? ` · vuelta ${vuelta}` : ''}` : 'Elige la fecha'}</button>
        </div>
        <p className="hint">Las asignaciones quedan marcadas ✎ (web). Si después se sube el Excel de CE, para las ubicaciones que trae manda el archivo; el resto se conserva. Para deshacer una asignación, abre el pasillo en el calendario y usa "Eliminar la asignación".</p>
      </>}
    </Card>
    </div>
  );
}

// Detalle de un grupo con sus ubicaciones y los ajustes
function Detalle({ g, ver, param, hoy, turnos, puedeEditar, onCambio, onCerrar }) {
  const { avisar } = useApp();
  const d = useCarga(() => api.get(`/continuidad/inventario/calendario/grupo?${new URLSearchParams({ ver, fecha: g.fecha, cd: g.cd, pasillo: g.pasillo })}`), [g.fecha, g.cd, g.pasillo, ver]);
  const [sel, setSel] = useState(new Set());
  const [nueva, setNueva] = useState('');
  const [todas, setTodas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const filas = d.data || [];
  const activas = filas.filter((u) => !u.excluida);
  const elegidas = filas.filter((u) => sel.has(u.id));
  const objetivo = sel.size ? { ids: [...sel] } : { grupo: { ver, fecha: g.fecha, cd: g.cd, pasillo: g.pasillo } };
  const n = sel.size || activas.length;
  const soloWeb = (sel.size ? elegidas : activas).length > 0 && (sel.size ? elegidas : activas).every((u) => u.web && u.fecha_prog === u.fecha_ce);
  const accion = async (url, cuerpo, ok) => {
    setOcupado(true);
    try { const r = await api.post(url, cuerpo); avisar(ok(r)); setSel(new Set()); setNueva(''); d.recargar(); onCambio(); } catch (e) { avisar(e.message, 'err'); }
    setOcupado(false);
  };
  const domingo = nueva && fechaDe(nueva).getDay() === 0;
  const ver_ = todas ? filas : filas.slice(0, 200);
  return (
    <Card title={`${g.pasillo} · ${g.cd}`} hint={`Control de Existencia ${diaTxt(g.fecha_ce)} · operación ${diaTxt(g.fecha_op)} · ${N(g.ubicaciones)} ubicaciones${g.quitadas ? `, ${N(g.quitadas)} quitadas` : ''}${g.reprog ? ` · ${N(g.reprog)} re-programadas` : ''}${g.ajustadas ? ` · ${N(g.ajustadas)} con ajuste en la web` : ''}${estadoToma(g, hoy) ? ` · ${estadoToma(g, hoy).t}` : ''}`}
      actions={<button type="button" className="ghost" onClick={onCerrar}>Cerrar</button>}>
      {puedeEditar && g.fecha_op >= hoy && <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="field" style={{ width: 'auto' }}><span>Turno de la operación ({diaTxt(g.fecha_op)})</span>
          <select value={g.turno_manual ? g.turno : ''} disabled={ocupado}
            onChange={(e) => accion('/continuidad/inventario/turno-pasillo', { fecha_op: g.fecha_op, cd: g.cd, pasillo: g.pasillo, turno: e.target.value },
              () => (e.target.value ? `${g.pasillo} queda en el turno ${e.target.value} (elegido a mano).` : `${g.pasillo} vuelve al reparto automático.`))}>
            <option value="">Automático{g.turno && !g.turno_manual ? ` (${g.turno})` : ''}</option>
            {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre || t.id}</option>)}
          </select></label>
        <span className="hint" style={{ margin: '0 0 8px' }}>{g.turno ? `Hoy en ${g.turno}${g.turno_manual ? ' (a mano)' : ' (reparto parejo por ubicaciones)'}.` : 'Sin turno asignado.'}</span>
      </div>}
      {puedeEditar && <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 10, borderRadius: 8, background: 'var(--bg)', marginBottom: 10 }}>
        <label className="field" style={{ width: 'auto' }}><span>Nueva fecha de Control de Existencia</span>
          <input type="date" value={nueva} onChange={(e) => setNueva(e.target.value)} /></label>
        {nueva && <span className="hint" style={{ margin: '0 0 8px' }}>{domingo ? 'CE no programa los domingos.' : `Operación: ${diaTxt(operacion(nueva, param.diasAntes))}`}</span>}
        <button type="button" className="btn" disabled={!nueva || domingo || ocupado || !n}
          onClick={() => accion('/continuidad/inventario/reprogramar', { ...objetivo, fecha: nueva }, (r) => `${N(r.ubicaciones)} ubicaciones reprogramadas a CE ${dmy(r.fecha_ce)} (operación ${dmy(r.fecha_op)}).`)}>
          {sel.size ? `Reprogramar ${N(sel.size)} seleccionadas` : 'Reprogramar el grupo'}</button>
        <button type="button" className="ghost" disabled={ocupado || !n || (sel.size > 0 && elegidas.every((u) => u.excluida))}
          onClick={() => window.confirm(soloWeb ? `¿Eliminar la asignación de ${N(n)} ubicaciones hecha en la web?` : `¿Quitar ${N(n)} ubicaciones del calendario? No se planificarán ni se medirán.`) && accion('/continuidad/inventario/quitar', objetivo, (r) => `${N(r.ubicaciones)} ubicaciones quitadas del calendario.`)}>
          {soloWeb ? (sel.size ? 'Eliminar seleccionadas' : 'Eliminar la asignación') : sel.size ? 'Quitar seleccionadas' : 'Quitar el grupo'}</button>
        {(sel.size ? elegidas.some((u) => u.ajustada) : filas.some((u) => u.ajustada)) && <button type="button" className="link" disabled={ocupado}
          onClick={() => accion('/continuidad/inventario/restaurar', objetivo, (r) => `${N(r.ubicaciones)} ubicaciones volvieron a la fecha del Excel.`)}>Deshacer ajustes</button>}
        <span className="hint" style={{ margin: '0 0 8px' }}>{sel.size ? 'Se aplica a las ubicaciones marcadas.' : 'Sin marcar ubicaciones, se aplica a todo el grupo.'}</span>
      </div>}
      {!d.data ? <Cargando error={d.error} /> : <>
        <div className="tscroll" style={{ maxHeight: 420, overflow: 'auto' }}><table>
          <thead><tr>{puedeEditar && <th><input type="checkbox" aria-label="Marcar todas" checked={filas.length > 0 && filas.every((u) => sel.has(u.id))}
            onChange={(e) => setSel(e.target.checked ? new Set(filas.map((u) => u.id)) : new Set())} /></th>}
            <th>Ubicación</th><th>Sección</th><th>Vuelta</th><th>Lado</th><th>Programada</th><th>Re-programación</th><th>CE vigente</th><th>Operación</th><th>Toma CE</th><th>Inventariada</th><th>Estado</th></tr></thead>
          <tbody>{ver_.map((u) => (
            <tr key={u.id} style={u.excluida ? { opacity: 0.5 } : undefined}>
              {puedeEditar && <td><input type="checkbox" aria-label={`Marcar ${u.ubicacion}`} checked={sel.has(u.id)} onChange={() => setSel((s) => { const x = new Set(s); x.has(u.id) ? x.delete(u.id) : x.add(u.id); return x; })} /></td>}
              <td className="mono">{u.ubicacion}</td><td>{u.seccion || '—'}</td><td>{u.vuelta || '—'}</td><td>{u.lado || '—'}</td>
              <td>{dmy(u.fecha_prog)}</td><td>{u.fecha_reprog ? dmy(u.fecha_reprog) : '—'}</td><td>{diaTxt(u.fecha_ce)}</td><td>{diaTxt(u.fecha_op)}</td>
              <td>{u.fecha_toma ? dmy(u.fecha_toma) : '—'}</td>
              <td>{u.inventariada ? <span className={u.inventariada > u.fecha_op ? 'warn' : 'ok'} title={u.inventariada > u.fecha_op ? 'Después de la fecha de operación' : ''}>✓ {dmy(u.inventariada)}</span>
                : u.excluida ? '—' : <span className={hoy && u.fecha_op < hoy ? 'warn' : 'muted'}>{hoy && u.fecha_op < hoy ? 'No' : 'Pendiente'}</span>}</td>
              <td>{u.excluida ? <span className="st vencida">Quitada</span> : u.web && u.fecha_prog === u.fecha_ce ? <span className="st abierta">Asignada en la web</span> : u.ajustada ? <span className="st abierta">Ajustada en la web</span> : u.fecha_reprog ? <span className="st abierta">Re-programada (Excel)</span> : <span className="muted">Según Excel</span>}</td>
            </tr>))}</tbody>
        </table></div>
        {filas.length > 200 && <p className="hint"><button type="button" className="link" onClick={() => setTodas(!todas)}>{todas ? 'Ver solo las primeras 200' : `Ver las ${N(filas.length)}`}</button></p>}
      </>}
    </Card>
  );
}

export default function InventarioCalendario() {
  const { meta, puede } = useApp();
  const hoy = meta?.fechaOperativa;
  const [mes, setMes] = useState(null);           // 'YYYY-MM'
  const [cd, setCd] = useState('');
  const [ver, setVer] = useState('ce');
  const [grupo, setGrupo] = useState(null);
  const [asig, setAsig] = useState(null);         // { fecha } del panel Asignar pasillos
  const [repartiendo, setRepartiendo] = useState(false);
  const { avisar } = useApp();
  const [rango, setRango] = useState({ desde: '', hasta: '' });   // filtro de fechas (desde / hasta)
  const m = mes || hoy?.slice(0, 7);
  const conRango = !!(rango.desde && rango.hasta && rango.desde <= rango.hasta);
  const enRango = (f) => !conRango || (f >= rango.desde && f <= rango.hasta);
  // semanas completas (lunes a domingo) que cubren el mes o el rango elegido
  const { desde, hasta, dias } = useMemo(() => {
    if (!m) return {};
    const ini = conRango ? rango.desde : `${m}-01`, ult = conRango ? rango.hasta : ymd(new Date(+m.slice(0, 4), +m.slice(5, 7), 0));
    const d0 = sumar(ini, -((fechaDe(ini).getDay() + 6) % 7)), d1 = sumar(ult, (7 - fechaDe(ult).getDay()) % 7);
    const out = []; for (let f = d0; f <= d1; f = sumar(f, 1)) out.push(f);
    return { desde: d0, hasta: d1, dias: out };
  }, [m, conRango, rango.desde, rango.hasta]);
  const d = useCarga(() => (desde ? api.get(`/continuidad/inventario/calendario?${new URLSearchParams({ desde, hasta, cd, ver })}`) : null), [desde, hasta, cd, ver]);
  const puedeEditar = puede('co.inventario.planificar');
  if (!meta || !m) return <><PageHead title="Calendario de planificación" /><Cargando /></>;
  const r = d.data;
  const porDia = new Map();
  for (const g of r?.grupos || []) { if (!porDia.has(g.fecha)) porDia.set(g.fecha, []); porDia.get(g.fecha).push(g); }
  const colorCd = (c) => `var(${COLORES[(r?.cds || []).indexOf(c) % COLORES.length] || '--muted'})`;
  const mover = (n) => { const d0 = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); setMes(ymd(d0).slice(0, 7)); setGrupo(null); };
  const totMes = (r?.grupos || []).filter((g) => (conRango ? enRango(g.fecha) : g.fecha.startsWith(m))).reduce((a, g) => a + g.ubicaciones, 0);
  // con rango: una sola fila, solo los días del rango que tienen zonas-pasillo programadas
  const diasVer = conRango ? (dias || []).filter((f) => enRango(f) && porDia.has(f)) : dias || [];
  const ordenCd = (c) => { const i = (r?.cds || []).indexOf(c); return i < 0 ? 99 : i; };
  const ordenT = (t) => { const i = (r?.turnos || []).findIndex((x) => x.id === t); return i < 0 ? 99 : i; };
  // imprimir: siempre en tema claro (se restaura al terminar)
  const imprimir = () => {
    const html = document.documentElement, antes = html.dataset.theme;
    html.dataset.theme = 'light';
    const volver = () => { if (antes === undefined) delete html.dataset.theme; else html.dataset.theme = antes; window.removeEventListener('afterprint', volver); };
    window.addEventListener('afterprint', volver);
    window.print();
  };
  const repartir = async () => {
    setRepartiendo(true);
    try {
      const x = await api.post('/continuidad/inventario/repartir-turnos', { desde: hoy, hasta: sumar(hasta, 7), cd });
      avisar(`${N(x.pasillos)} pasillos repartidos por turno entre el ${dmy(x.desde)} y el ${dmy(x.hasta)}.`); d.recargar();
    } catch (e) { avisar(e.message, 'err'); }
    setRepartiendo(false);
  };

  return (
    <>
      <div className="cal-fijo">
      <PageHead title="Calendario de planificación" sub="La programación de Control de Existencia por día y zona-pasillo. Ajusta fechas o quita ubicaciones aquí, sin volver a subir el Excel: los ajustes se conservan si se carga de nuevo la programación.">
        <Link to="/inventario">Ir a Inventario CD</Link>
      </PageHead>
      <div className="solo-print cal-print">
        <b>Calendario de planificación · {ver === 'op' ? 'por fecha de operación' : 'por fecha de Control de Existencia'}</b>
        <span>{conRango ? `Del ${dmy(rango.desde)} al ${dmy(rango.hasta)}` : `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`} · CD: {cd || 'todos'} · {N(totMes)} ubicaciones · impreso el {new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div className="filters no-print" style={{ alignItems: 'flex-end' }}>
        {!conRango && <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button type="button" className="ghost" aria-label="Mes anterior" onClick={() => mover(-1)}>◀</button>
          <b style={{ minWidth: 150, textAlign: 'center', fontSize: 17 }}>{MESES[+m.slice(5, 7) - 1]} {m.slice(0, 4)}</b>
          <button type="button" className="ghost" aria-label="Mes siguiente" onClick={() => mover(1)}>▶</button>
          {m !== hoy.slice(0, 7) && <button type="button" className="link" onClick={() => { setMes(null); setGrupo(null); }}>Hoy</button>}
        </div>}
        <label className="field" style={{ width: 'auto' }}><span>Desde</span><input type="date" value={rango.desde} max={rango.hasta || undefined}
          onChange={(e) => { setRango({ ...rango, desde: e.target.value }); setGrupo(null); }} /></label>
        <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={rango.hasta} min={rango.desde || undefined}
          onChange={(e) => { setRango({ ...rango, hasta: e.target.value }); setGrupo(null); }} /></label>
        {(rango.desde || rango.hasta) && <button type="button" className="link" style={{ marginBottom: 8 }} onClick={() => { setRango({ desde: '', hasta: '' }); setGrupo(null); }}>Quitar rango</button>}
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={cd} onChange={(e) => { setCd(e.target.value); setGrupo(null); }}>
          <option value="">Todos</option>{(r?.cds || []).map((c) => <option key={c}>{c}</option>)}</select></label>
        <div><span className="hint" style={{ display: 'block', marginBottom: 4 }}>Ver por fecha de</span>
          <div className="row" role="group" aria-label="Ver por fecha de Control de Existencia u operación" style={{ gap: 4 }}>
            {[['ce', 'Control de Existencia'], ['op', 'Operación']].map(([k, l]) => <button key={k} type="button" aria-pressed={ver === k} className={ver === k ? 'btn' : 'ghost'} onClick={() => { setVer(k); setGrupo(null); }}>{l}</button>)}
          </div></div>
        {r && <span className="hint" style={{ margin: 0 }}>{N(totMes)} ubicaciones {conRango ? `del ${dmy(rango.desde)} al ${dmy(rango.hasta)}` : 'en el mes'}</span>}
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <button type="button" className="ghost" onClick={imprimir} disabled={!r} title="Imprime el calendario tal como se ve (rango, CD y vista elegidos)">🖨 Imprimir</button>
        {puedeEditar && <>
          <button type="button" className="ghost" disabled={repartiendo} title="Reparte de nuevo los pasillos de cada día de operación entre sus turnos, de forma pareja por ubicaciones (desde hoy). Hoy solo cuentan los turnos que aún no empiezan; se mantienen los elegidos a mano."
            onClick={repartir}>{repartiendo ? 'Repartiendo…' : 'Repartir por turno'}</button>
          <button type="button" className="btn" onClick={() => { setAsig({ fecha: '' }); setGrupo(null); }}>+ Asignar pasillos</button></>}</div>
      </div>

      {r && <>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', margin: '0 0 8px', fontSize: 12.5 }}>
          {r.cds.map((c) => <span key={c} className="row" style={{ gap: 5, alignItems: 'center' }}><i style={{ width: 10, height: 10, borderRadius: 2, background: colorCd(c), display: 'inline-block' }} />{c}</span>)}
          <span className="muted"><b className="tom-ley t-ok">✓</b> inventariado · <b className="tom-ley t-parcial">%</b> en parte · <b className="tom-ley t-no">✕</b> no inventariado · ↻ re-programada · ✎ ajustada en la web · ✋ turno elegido a mano · tachado = quitada {ver === 'op' ? ' · agrupado por turno (lun. a vie. AM, PM y Noche; sáb. AM y PM)' : ''}</span>
        </div>
        {!conRango && <div className="cal-inv cal-inv-sem" aria-hidden="true">
          {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((x) => <div key={x} className="cal-inv-h">{x}</div>)}
        </div>}
      </>}
      </div>

      {!r ? <Cargando error={d.error} /> : <>
        {conRango && !diasVer.length && <p className="hint">No hay zonas-pasillo programadas entre el {dmy(rango.desde)} y el {dmy(rango.hasta)}.</p>}
        <div className={conRango ? 'cal-inv cal-fila' : 'cal-inv'} role="grid" aria-label={conRango ? `Calendario del ${dmy(rango.desde)} al ${dmy(rango.hasta)}` : `Calendario de ${MESES[+m.slice(5, 7) - 1]}`}>
          {diasVer.map((f) => {
            const gs = enRango(f) ? porDia.get(f) || [] : [];
            const tot = gs.reduce((a, g) => a + g.ubicaciones, 0);
            return (
              <div key={f} role="gridcell" className={`cal-inv-d${(conRango ? enRango(f) : f.startsWith(m)) ? '' : ' fuera'}${f === hoy ? ' hoy' : ''}`}>
                <div className="cal-inv-n"><b>{conRango ? `${DIAS[fechaDe(f).getDay()]} ${f.slice(8, 10)}-${f.slice(5, 7)}` : +f.slice(8, 10)}</b>{tot > 0 && <span>{N(tot)} ubic.</span>}
                  {puedeEditar && enRango(f) && fechaDe(f).getDay() !== 0 && <button type="button" className="cal-add" title={`Asignar pasillos al ${diaTxt(f)}`} aria-label={`Asignar pasillos al ${diaTxt(f)}`}
                    onClick={() => { setAsig({ fecha: f }); setGrupo(null); }}>+</button>}</div>
                {[...gs].sort((a, b) => ordenCd(a.cd) - ordenCd(b.cd) || (ver === 'op' ? ordenT(a.turno) - ordenT(b.turno) : 0) || a.pasillo.localeCompare(b.pasillo)).map((g, i, l) => {
                  const act = grupo && grupo.fecha === g.fecha && grupo.cd === g.cd && grupo.pasillo === g.pasillo;
                  // segmentado por CD (encabezado con su color y total) y, en la vista por operación, por turno dentro del CD
                  const nuevoCd = i === 0 || l[i - 1].cd !== g.cd;
                  const delCd = l.filter((x) => x.cd === g.cd);
                  const totCd = nuevoCd ? delCd.reduce((a, x) => a + x.ubicaciones, 0) : 0;
                  const conTurno = ver === 'op' && delCd.some((x) => x.turno);
                  const enc = conTurno && (nuevoCd || l[i - 1].turno !== g.turno);
                  const totT = enc ? delCd.filter((x) => x.turno === g.turno).reduce((a, x) => a + x.ubicaciones, 0) : 0;
                  const e = estadoToma(g, hoy);
                  return <Fragment key={`${g.cd}|${g.pasillo}`}>
                  {nuevoCd && <div className="cal-cd" style={{ '--cdc': colorCd(g.cd) }} title={`${g.cd}: ${N(delCd.length)} zonas-pasillo, ${N(totCd)} ubicaciones`}><b>{g.cd}</b><span>{N(totCd)} ubic.</span></div>}
                  {enc && <div className="cal-tur" title={g.turno ? `${g.cd}, turno ${g.turno} de la operación: ${N(totT)} ubicaciones` : 'Sin turno asignado'}><b>{g.turno || 'Sin turno'}</b><span>{N(totT)}</span></div>}
                  <button type="button" className={`cal-inv-g${act ? ' act' : ''}${e ? ` tom-${e.k}` : ''}`} style={{ borderLeftColor: colorCd(g.cd), textDecoration: g.ubicaciones ? undefined : 'line-through' }}
                    title={`${g.cd} · ${g.pasillo} · ${N(g.ubicaciones)} ubicaciones · CE ${diaTxt(g.fecha_ce)} · operación ${diaTxt(g.fecha_op)}${e ? `
${e.t}` : ''}`} onClick={() => setGrupo(act ? null : g)}>
                    <span>{e?.i && <i className="tom-i" aria-hidden="true">{e.i}</i>}{g.pasillo}</span><span className="muted">{N(g.ubicaciones)}{g.reprog > 0 ? ' ↻' : ''}{g.ajustadas > 0 ? ' ✎' : ''}{ver === 'op' && g.turno_manual ? ' ✋' : ''}</span></button></Fragment>;
                })}
              </div>);
          })}
        </div>
        <div className="no-print">
        {asig && <Asignar key={asig.fecha} fechaIni={asig.fecha} cdIni={cd} param={r.param} onListo={() => d.recargar()} onCerrar={() => setAsig(null)} />}
        {grupo && <Detalle key={`${grupo.fecha}|${grupo.cd}|${grupo.pasillo}|${ver}`} g={grupo} ver={ver} param={r.param} hoy={hoy} turnos={r.turnos || []} puedeEditar={puedeEditar}
          onCambio={() => { d.recargar(); setGrupo(null); }} onCerrar={() => setGrupo(null)} />}
        </div>
        {!grupo && !asig && <p className="hint no-print">Haz clic en una zona-pasillo para ver sus ubicaciones{puedeEditar ? ' y reprogramarla o quitarla; con + en un día (o "Asignar pasillos") se programan pasillos sin subir el Excel' : ''}.</p>}
        {r.ajustes.length > 0 && <div className="no-print"><Card title="Últimos ajustes hechos en la web" hint="Se vuelven a aplicar si se sube de nuevo el Excel de Control de Existencia.">
          <div className="tscroll"><table>
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>CD</th><th>Zona-pasillo</th><th className="num">Ubicaciones</th><th>Fecha programada (Excel)</th><th>Nueva fecha CE</th></tr></thead>
            <tbody>{r.ajustes.map((a, i) => <tr key={i}><td>{new Date(a.creado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{a.usuario || '—'}</td>
              <td>{a.accion === 'QUITAR' ? 'Quitada' : 'Reprogramada'}</td><td>{a.cd || '—'}</td><td>{a.pasillo || '—'}</td><td className="num">{N(a.ubicaciones)}</td>
              <td>{dmy(a.fecha_prog)}</td><td>{a.fecha_nueva ? diaTxt(a.fecha_nueva) : '—'}</td></tr>)}</tbody>
          </table></div>
        </Card></div>}
      </>}
    </>
  );
}
