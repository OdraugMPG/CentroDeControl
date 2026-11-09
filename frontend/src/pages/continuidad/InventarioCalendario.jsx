// Gestión de inventario, Calendario de planificación: la programación de Control de Existencia (CE) por día y zona-pasillo.
// Se ajusta en la web (reprogramar o quitar un grupo o algunas ubicaciones, y deshacer) sin volver a subir el Excel; los
// ajustes se guardan y se vuelven a aplicar si se carga de nuevo la programación.
import { useMemo, useState } from 'react';
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
// N días hábiles (lunes a sábado) antes
const operacion = (iso, n) => { let f = iso; for (let i = 0; i < n;) { f = sumar(f, -1); if (fechaDe(f).getDay() !== 0) i++; } return f; };

// Detalle de un grupo con sus ubicaciones y los ajustes
function Detalle({ g, ver, param, puedeEditar, onCambio, onCerrar }) {
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
  const accion = async (url, cuerpo, ok) => {
    setOcupado(true);
    try { const r = await api.post(url, cuerpo); avisar(ok(r)); setSel(new Set()); setNueva(''); d.recargar(); onCambio(); } catch (e) { avisar(e.message, 'err'); }
    setOcupado(false);
  };
  const domingo = nueva && fechaDe(nueva).getDay() === 0;
  const ver_ = todas ? filas : filas.slice(0, 200);
  return (
    <Card title={`${g.pasillo} · ${g.cd}`} hint={`Control de Existencia ${diaTxt(g.fecha_ce)} · operación ${diaTxt(g.fecha_op)} · ${N(g.ubicaciones)} ubicaciones${g.quitadas ? `, ${N(g.quitadas)} quitadas` : ''}${g.reprog ? ` · ${N(g.reprog)} re-programadas` : ''}${g.ajustadas ? ` · ${N(g.ajustadas)} con ajuste en la web` : ''}`}
      actions={<button type="button" className="ghost" onClick={onCerrar}>Cerrar</button>}>
      {puedeEditar && <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 10, borderRadius: 8, background: 'var(--bg)', marginBottom: 10 }}>
        <label className="field" style={{ width: 'auto' }}><span>Nueva fecha de Control de Existencia</span>
          <input type="date" value={nueva} onChange={(e) => setNueva(e.target.value)} /></label>
        {nueva && <span className="hint" style={{ margin: '0 0 8px' }}>{domingo ? 'CE no programa los domingos.' : `Operación: ${diaTxt(operacion(nueva, param.diasAntes))}`}</span>}
        <button type="button" className="btn" disabled={!nueva || domingo || ocupado || !n}
          onClick={() => accion('/continuidad/inventario/reprogramar', { ...objetivo, fecha: nueva }, (r) => `${N(r.ubicaciones)} ubicaciones reprogramadas a CE ${dmy(r.fecha_ce)} (operación ${dmy(r.fecha_op)}).`)}>
          {sel.size ? `Reprogramar ${N(sel.size)} seleccionadas` : 'Reprogramar el grupo'}</button>
        <button type="button" className="ghost" disabled={ocupado || !n || (sel.size > 0 && elegidas.every((u) => u.excluida))}
          onClick={() => window.confirm(`¿Quitar ${N(n)} ubicaciones del calendario? No se planificarán ni se medirán.`) && accion('/continuidad/inventario/quitar', objetivo, (r) => `${N(r.ubicaciones)} ubicaciones quitadas del calendario.`)}>
          {sel.size ? 'Quitar seleccionadas' : 'Quitar el grupo'}</button>
        {(sel.size ? elegidas.some((u) => u.ajustada) : filas.some((u) => u.ajustada)) && <button type="button" className="link" disabled={ocupado}
          onClick={() => accion('/continuidad/inventario/restaurar', objetivo, (r) => `${N(r.ubicaciones)} ubicaciones volvieron a la fecha del Excel.`)}>Deshacer ajustes</button>}
        <span className="hint" style={{ margin: '0 0 8px' }}>{sel.size ? 'Se aplica a las ubicaciones marcadas.' : 'Sin marcar ubicaciones, se aplica a todo el grupo.'}</span>
      </div>}
      {!d.data ? <Cargando error={d.error} /> : <>
        <div className="tscroll" style={{ maxHeight: 420, overflow: 'auto' }}><table>
          <thead><tr>{puedeEditar && <th><input type="checkbox" aria-label="Marcar todas" checked={filas.length > 0 && filas.every((u) => sel.has(u.id))}
            onChange={(e) => setSel(e.target.checked ? new Set(filas.map((u) => u.id)) : new Set())} /></th>}
            <th>Ubicación</th><th>Sección</th><th>Vuelta</th><th>Lado</th><th>Programada</th><th>Re-programación</th><th>CE vigente</th><th>Operación</th><th>Toma CE</th><th>Estado</th></tr></thead>
          <tbody>{ver_.map((u) => (
            <tr key={u.id} style={u.excluida ? { opacity: 0.5 } : undefined}>
              {puedeEditar && <td><input type="checkbox" aria-label={`Marcar ${u.ubicacion}`} checked={sel.has(u.id)} onChange={() => setSel((s) => { const x = new Set(s); x.has(u.id) ? x.delete(u.id) : x.add(u.id); return x; })} /></td>}
              <td className="mono">{u.ubicacion}</td><td>{u.seccion || '—'}</td><td>{u.vuelta || '—'}</td><td>{u.lado || '—'}</td>
              <td>{dmy(u.fecha_prog)}</td><td>{u.fecha_reprog ? dmy(u.fecha_reprog) : '—'}</td><td>{diaTxt(u.fecha_ce)}</td><td>{diaTxt(u.fecha_op)}</td>
              <td>{u.fecha_toma ? dmy(u.fecha_toma) : '—'}</td>
              <td>{u.excluida ? <span className="st vencida">Quitada</span> : u.ajustada ? <span className="st abierta">Ajustada en la web</span> : u.fecha_reprog ? <span className="st abierta">Re-programada (Excel)</span> : <span className="muted">Según Excel</span>}</td>
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
  const m = mes || hoy?.slice(0, 7);
  // semanas completas (lunes a domingo) que cubren el mes
  const { desde, hasta, dias } = useMemo(() => {
    if (!m) return {};
    const ini = `${m}-01`, ult = ymd(new Date(+m.slice(0, 4), +m.slice(5, 7), 0));
    const d0 = sumar(ini, -((fechaDe(ini).getDay() + 6) % 7)), d1 = sumar(ult, (7 - fechaDe(ult).getDay()) % 7);
    const out = []; for (let f = d0; f <= d1; f = sumar(f, 1)) out.push(f);
    return { desde: d0, hasta: d1, dias: out };
  }, [m]);
  const d = useCarga(() => (desde ? api.get(`/continuidad/inventario/calendario?${new URLSearchParams({ desde, hasta, cd, ver })}`) : null), [desde, hasta, cd, ver]);
  const puedeEditar = puede('co.inventario.planificar');
  if (!meta || !m) return <><PageHead title="Calendario de planificación" /><Cargando /></>;
  const r = d.data;
  const porDia = new Map();
  for (const g of r?.grupos || []) { if (!porDia.has(g.fecha)) porDia.set(g.fecha, []); porDia.get(g.fecha).push(g); }
  const colorCd = (c) => `var(${COLORES[(r?.cds || []).indexOf(c) % COLORES.length] || '--muted'})`;
  const mover = (n) => { const d0 = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); setMes(ymd(d0).slice(0, 7)); setGrupo(null); };
  const totMes = (r?.grupos || []).filter((g) => g.fecha.startsWith(m)).reduce((a, g) => a + g.ubicaciones, 0);

  return (
    <>
      <PageHead title="Calendario de planificación" sub="La programación de Control de Existencia por día y zona-pasillo. Ajusta fechas o quita ubicaciones aquí, sin volver a subir el Excel: los ajustes se conservan si se carga de nuevo la programación.">
        <Link to="/inventario">Ir a Inventario CD</Link>
      </PageHead>
      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button type="button" className="ghost" aria-label="Mes anterior" onClick={() => mover(-1)}>◀</button>
          <b style={{ minWidth: 150, textAlign: 'center', fontSize: 17 }}>{MESES[+m.slice(5, 7) - 1]} {m.slice(0, 4)}</b>
          <button type="button" className="ghost" aria-label="Mes siguiente" onClick={() => mover(1)}>▶</button>
          {m !== hoy.slice(0, 7) && <button type="button" className="link" onClick={() => { setMes(null); setGrupo(null); }}>Hoy</button>}
        </div>
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={cd} onChange={(e) => { setCd(e.target.value); setGrupo(null); }}>
          <option value="">Todos</option>{(r?.cds || []).map((c) => <option key={c}>{c}</option>)}</select></label>
        <div><span className="hint" style={{ display: 'block', marginBottom: 4 }}>Ver por fecha de</span>
          <div className="row" role="group" aria-label="Ver por fecha de Control de Existencia u operación" style={{ gap: 4 }}>
            {[['ce', 'Control de Existencia'], ['op', 'Operación']].map(([k, l]) => <button key={k} type="button" aria-pressed={ver === k} className={ver === k ? 'btn' : 'ghost'} onClick={() => { setVer(k); setGrupo(null); }}>{l}</button>)}
          </div></div>
        {r && <span className="hint" style={{ margin: 0 }}>{N(totMes)} ubicaciones en el mes</span>}
      </div>

      {!r ? <Cargando error={d.error} /> : <>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', margin: '0 0 8px', fontSize: 12.5 }}>
          {r.cds.map((c) => <span key={c} className="row" style={{ gap: 5, alignItems: 'center' }}><i style={{ width: 10, height: 10, borderRadius: 2, background: colorCd(c), display: 'inline-block' }} />{c}</span>)}
          <span className="muted">↻ re-programada · ✎ ajustada en la web · tachado = quitada</span>
        </div>
        <div className="cal-inv" role="grid" aria-label={`Calendario de ${MESES[+m.slice(5, 7) - 1]}`}>
          {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((x) => <div key={x} className="cal-inv-h" role="columnheader">{x}</div>)}
          {dias.map((f) => {
            const gs = porDia.get(f) || [];
            const tot = gs.reduce((a, g) => a + g.ubicaciones, 0);
            return (
              <div key={f} role="gridcell" className={`cal-inv-d${f.startsWith(m) ? '' : ' fuera'}${f === hoy ? ' hoy' : ''}`}>
                <div className="cal-inv-n"><b>{+f.slice(8, 10)}</b>{tot > 0 && <span>{N(tot)} ubic.</span>}</div>
                {gs.map((g) => {
                  const act = grupo && grupo.fecha === g.fecha && grupo.cd === g.cd && grupo.pasillo === g.pasillo;
                  return <button key={`${g.cd}|${g.pasillo}`} type="button" className={`cal-inv-g${act ? ' act' : ''}`} style={{ borderLeftColor: colorCd(g.cd), textDecoration: g.ubicaciones ? undefined : 'line-through' }}
                    title={`${g.cd} · ${g.pasillo} · ${N(g.ubicaciones)} ubicaciones · CE ${diaTxt(g.fecha_ce)} · operación ${diaTxt(g.fecha_op)}`} onClick={() => setGrupo(act ? null : g)}>
                    <span>{g.pasillo}</span><span className="muted">{N(g.ubicaciones)}{g.reprog > 0 ? ' ↻' : ''}{g.ajustadas > 0 ? ' ✎' : ''}</span></button>;
                })}
              </div>);
          })}
        </div>
        {grupo && <Detalle key={`${grupo.fecha}|${grupo.cd}|${grupo.pasillo}|${ver}`} g={grupo} ver={ver} param={r.param} puedeEditar={puedeEditar}
          onCambio={() => { d.recargar(); setGrupo(null); }} onCerrar={() => setGrupo(null)} />}
        {!grupo && <p className="hint">Haz clic en una zona-pasillo para ver sus ubicaciones{puedeEditar ? ' y reprogramarla o quitarla' : ''}.</p>}
        {r.ajustes.length > 0 && <Card title="Últimos ajustes hechos en la web" hint="Se vuelven a aplicar si se sube de nuevo el Excel de Control de Existencia.">
          <div className="tscroll"><table>
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>CD</th><th>Zona-pasillo</th><th className="num">Ubicaciones</th><th>Fecha programada (Excel)</th><th>Nueva fecha CE</th></tr></thead>
            <tbody>{r.ajustes.map((a, i) => <tr key={i}><td>{new Date(a.creado_en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{a.usuario || '—'}</td>
              <td>{a.accion === 'QUITAR' ? 'Quitada' : 'Reprogramada'}</td><td>{a.cd || '—'}</td><td>{a.pasillo || '—'}</td><td className="num">{N(a.ubicaciones)}</td>
              <td>{dmy(a.fecha_prog)}</td><td>{a.fecha_nueva ? diaTxt(a.fecha_nueva) : '—'}</td></tr>)}</tbody>
          </table></div>
        </Card>}
      </>}
    </>
  );
}
