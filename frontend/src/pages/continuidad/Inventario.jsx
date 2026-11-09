// Inventario CD con la programación oficial de Control de Existencia (CE): la operación pasa N días hábiles antes que CE,
// cada grupo (día, CD, zona y pasillo) se asigna al jefe de turno de la empresa externa y a un supervisor Paris, y el
// resultado de la toma mide ERI y ERU con semáforo de caritas.
// Cada bloque tiene su permiso (Administración, Roles y permisos): cargar, asignar, ver la programación y ver los resultados.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead, Kpis } from '../../components/ui.jsx';
import { N, pctf, dmy, fechaHora } from '../../lib/fmt.js';
import { TablaOrden } from '../control/Recepcion.jsx';

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const ESTADO = {
  'A TIEMPO': ['A tiempo', 'cerrada'], 'CON RETRASO': ['Con retraso', 'vencida'], 'NO REALIZADO': ['No realizado', 'vencida'],
  'PARCIAL VENCIDO': ['Parcial, vencido', 'vencida'], PARCIAL: ['Parcial', 'abierta'], HOY: ['Hoy', 'abierta'], PROGRAMADO: ['Programado', 'abierta']
};
const TIPO = { FALTANTE: 'Faltante', SOBRANTE: 'Sobrante', 'NO ENCONTRADO': 'No encontrado', 'NO REGISTRADO': 'No registrado en la ubicación' };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
// N días hábiles (lunes a sábado) antes
const antes = (dia, n) => { let d = dia; for (let i = 0; i < n;) { d = (d + 6) % 7; if (d !== 0) i++; } return d; };

// Carita del semáforo: verde (sano), amarilla (atención) o roja (crítico)
const NIVEL = [['Sano', '--green', 'M6.5 11.5 Q10 15 13.5 11.5'], ['Atención', '--yellow', 'M6.5 13 H13.5'], ['Crítico', '--red', 'M6.5 14 Q10 10.5 13.5 14']];
export function Carita({ nivel, size = 18 }) {
  const [t, c, boca] = NIVEL[nivel];
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={t} style={{ flex: 'none', verticalAlign: 'middle' }}>
      <title>{t}</title>
      <circle cx="10" cy="10" r="9.2" fill={`var(${c})`} stroke="rgba(0,0,0,.25)" strokeWidth=".8" />
      <circle cx="7" cy="7.8" r="1.2" fill="#1b1b1b" /><circle cx="13" cy="7.8" r="1.2" fill="#1b1b1b" />
      <path d={boca} fill="none" stroke="#1b1b1b" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
export const nivelDe = (v, sano, critico) => (v >= sano ? 0 : v >= critico ? 1 : 2);
export function Indicador({ v, sano, critico, grande }) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><Carita nivel={nivelDe(v, sano, critico)} size={grande ? 26 : 18} />{pctf(v)}</span>;
}

export function descargar(filas, nombre) {
  const c = (v) => (/[;"\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
  const blob = new Blob(['﻿' + filas.map((r) => r.map(c).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  a.click(); URL.revokeObjectURL(a.href);
}

// Simulación por turno: cómo la asignación diaria repartirá el inventario de CE del día (mismo cálculo que publica)
function Simulacion({ inicial }) {
  const [fecha, setFecha] = useState(inicial);
  const d = useCarga(() => (fecha ? api.get(`/continuidad/inventario/simulacion?fecha=${fecha}`) : null), [fecha]);
  const s = d.data;
  const hh = (v) => `${(v || 0).toFixed(1).replace('.', ',')} HH`;
  return (
    <Card title="Simulación por turno" hint="Lo que la Asignación diaria publicará como tareas de inventario ese día: zona-pasillos de CE repartidos en los turnos con los recursos de inventario de cada CD, el supervisor Paris y el jefe de turno de la empresa de cada turno (según la rotación)."
      actions={<div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="date" aria-label="Día a simular" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: 'auto' }} />
        <Link to={`/gestion?fecha=${fecha}`}>Ir a la asignación del día</Link></div>}>
      {!s ? <Cargando error={d.error} /> : !s.cds.length ? <p className="empty">Control de Existencia no programó inventario con operación el {dmy(fecha)}.</p> : <>
        <p className="hint" style={{ marginTop: 0 }}>{DIAS[new Date(`${fecha}T12:00:00`).getDay()]} {dmy(fecha)}: {s.nTur} {s.nTur === 1 ? 'turno' : 'turnos'}. HH = ubicaciones × {s.param.invSegUb} s + líneas × {s.param.invSegSku} s + unidades × {s.param.invSegUn} s + {s.param.invSegPas} s por pasillo{s.base ? ` (líneas y unidades de la Base ${s.base.archivo} del ${dmy(s.base.fecha)})` : ' (sin Base cargada: solo ubicaciones)'}. Los recursos de inventario por CD se cambian en Administración, Configuración.</p>
        {s.cds.map((c) => (
          <div key={c.cd} style={{ marginTop: 14 }}>
            <div className="row spread" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>{c.cd === 'SIN CD' ? 'Sin CD (zona no encontrada en la Base)' : c.cd}{c.cd !== 'SIN CD' && !c.activo && <span className="pill" style={{ marginLeft: 8 }}>CD inactivo en Configuración</span>}</h3>
              <span className="hint" style={{ margin: 0 }}>{N(c.resumen.grupos)} zona-pasillos · {N(c.resumen.ubicaciones)} ubic. · {hh(c.resumen.hh)} de {hh(c.capacidad)} disponibles ({c.recInv} recursos × {c.hT} h × {s.nTur} turnos)</span>
            </div>
            {c.cd !== 'SIN CD' && <div className="tscroll"><table>
              <thead><tr><th>Turno</th><th>Supervisor Paris</th><th>Jefe de turno empresa</th><th>Zona-pasillos</th><th className="num">Ubic.</th><th className="num">HH</th><th className="num">Operarios</th><th className="num">Uso</th></tr></thead>
              <tbody>{c.turnos.map((t) => (
                <tr key={t.tt}><td><b>T{t.tt}</b> {t.turno}</td><td>{t.supervisor || <span className="muted">Sin supervisor</span>}</td>
                  <td>{t.jefe ? <>{t.jefe} <span className="muted">· {t.empresa}</span></> : <span className="muted">Sin jefe de turno</span>}</td>
                  <td>{t.lineas.length ? t.lineas.map((l) => <span key={l.zp} className="pill" title={`${l.piso} · ${N(l.ubicaciones)} ubic. · ${hh(l.hh)} · ${l.ops}`} style={{ marginRight: 4, background: 'var(--bg)' }}>{l.zp}{l.pct < 0.999 ? ` ${Math.round(l.pct * 100)}%` : ''}</span>) : <span className="muted">—</span>}</td>
                  <td className="num">{N(t.ubicaciones)}</td><td className="num">{hh(t.hh)}</td><td className="num">{t.operarios || '—'}</td>
                  <td className="num">{pctf(t.hh / (c.recInv * c.hT))}</td></tr>))}</tbody>
            </table></div>}
            {c.pendientes.length > 0 && <p className="msg err" style={{ marginTop: 6 }}>{c.cd === 'SIN CD'
              ? `${N(c.resumen.ubicaciones)} ubicaciones de zonas que no están en la Base (${c.pendientes.map((g) => g.zp).join(', ')}): no se pueden asignar a un CD.`
              : `No alcanza en los turnos del día: ${c.pendientes.map((g) => `${g.zp} (${N(g.ub)} ubic., ${hh(g.hh)})`).join(', ')}. Aumenta los recursos de inventario del CD o reprograma con Control de Existencia.`}</p>}
          </div>))}
      </>}
    </Card>
  );
}

export default function Inventario() {
  const { meta, avisar, puede } = useApp();
  const hoy = meta?.fechaOperativa;
  const [rango, setRango] = useState(null);   // { desde, hasta }
  const [cd, setCd] = useState('');
  const [por, setPor] = useState('op');   // op: día de operación · ce: fecha programada de CE (como el calendario)
  const [fJefe, setFJefe] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [fZona, setFZona] = useState('');
  const [fPasillo, setFPasillo] = useState('');
  const [sel, setSel] = useState(new Set());
  const [asig, setAsig] = useState({ jefe_empresa: '', empresa: '', supervisor: '' });
  const [guardando, setGuardando] = useState(false);
  const desde = rango?.desde || (hoy ? sumar(hoy, -7) : ''), hasta = rango?.hasta || (hoy ? sumar(hoy, 14) : '');
  const d = useCarga(async () => {
    if (!hoy) return null;
    const [r, personas] = await Promise.all([api.get(`/continuidad/inventario/analisis?${new URLSearchParams({ desde, hasta, cd, por })}`), api.get('/continuidad/personas')]);
    return { ...r, personas };
  }, [hoy, desde, hasta, cd, por]);
  const [verCargar, verAsignar, verCal, verRes] = ['cargar', 'asignar', 'calendario', 'resultados'].map((k) => puede(`co.inventario.${k}`));
  const r = d.data;
  const grupos = useMemo(() => (r?.grupos || []).filter((g) => (!fJefe || (fJefe === '-' ? !g.jefe_empresa : g.jefe_empresa === fJefe)) && (!fEstado || g.estado === fEstado)
    && (!fZona || g.zona === fZona) && (!fPasillo || g.pasillo === fPasillo)), [r, fJefe, fEstado, fZona, fPasillo]);
  // zonas y pasillos de la programación del rango (los pasillos, de la zona elegida)
  const zonas = useMemo(() => [...new Set((r?.grupos || []).map((g) => g.zona).filter(Boolean))].sort(), [r]);
  const pasillos = useMemo(() => [...new Set((r?.grupos || []).filter((g) => !fZona || g.zona === fZona).map((g) => g.pasillo).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [r, fZona]);
  if (!meta || !r) return <><PageHead title="Inventario CD" /><Cargando error={d.error} /></>;

  const P = r.param, R = r.resumen;
  // día a simular: el próximo día de operación con programación (desde hoy)
  const proximo = r.grupos.map((g) => g.fecha_op).filter((f) => f >= hoy).sort()[0] || hoy;
  // jefes de turno de empresa externa configurados en Administración, Configuración (con su empresa y turno de la semana)
  const jefesCfg = r.personas.filter((p) => p.rol === 'Jefe de Turno Empresa');
  const sinDatos = !r.cargas.programa;
  const todos = grupos.length > 0 && grupos.every((g) => sel.has(g.k));
  const marcar = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const guardar = async () => {
    setGuardando(true);
    try {
      const gs = r.grupos.filter((g) => sel.has(g.k)).map(({ fecha_op, cd: c, zona, pasillo }) => ({ fecha_op, cd: c, zona, pasillo }));
      await api.put('/continuidad/inventario/asignacion', { grupos: gs, ...asig });
      avisar(`Asignado a ${gs.length} ${gs.length === 1 ? 'grupo' : 'grupos'}.`); setSel(new Set()); d.recargar();
    } catch (e) { avisar(e.message, 'err'); }
    setGuardando(false);
  };
  const colsInd = [['unidReg', 'Unid. registradas', true, N], ['unidCorr', 'Unid. correctas', true, N],
    ['ubicaciones', 'Ubic. verificadas', true, N], ['ubicOk', 'Ubic. correctas', true, N], ['dif', 'Líneas con dif.', true, (v) => (v ? N(v) : '—')],
    ['eri', 'ERI', true, (v) => <Indicador v={v} sano={P.eriSano} critico={P.eriCritico} />], ['eru', 'ERU', true, (v) => <Indicador v={v} sano={P.eruSano} critico={P.eruCritico} />]];
  const corte = (titulo, col, filas, hint) => (
    <Card className="s6" title={titulo} hint={hint}>
      {filas.length ? <TablaOrden filas={filas} inicial={['unidReg', -1]} max={10} clave={(x) => x.v} cols={[['v', col], ...colsInd]} />
        : <p className="empty">Sin resultados en el rango.</p>}
    </Card>
  );

  return (
    <>
      <PageHead title="Inventario CD" sub={`Programación oficial de Control de Existencia: la operación pasa ${P.diasAntes} ${P.diasAntes === 1 ? 'día hábil' : 'días hábiles'} antes (lunes a sábado). Las fechas se confirman los jueves.`}>
        {verCargar && <Link className="btn" to="/cargas#carga-inventario">Cargar archivos (en Datos)</Link>}
      </PageHead>
      {!verCargar && !verAsignar && !verCal && !verRes && <p className="empty">Tu rol no tiene ningún bloque de Inventario CD habilitado. Pídelo en Administración, Roles y permisos.</p>}

      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 'auto' }}><span>Filtrar por</span><select value={por} onChange={(e) => { setPor(e.target.value); setSel(new Set()); }}>
          <option value="op">Día de operación</option><option value="ce">Fecha programada (calendario CE)</option></select></label>
        <label className="field" style={{ width: 'auto' }}><span>{por === 'ce' ? 'Programada desde' : 'Operación desde'}</span><input type="date" value={desde} onChange={(e) => e.target.value && setRango({ desde: e.target.value, hasta })} /></label>
        <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={hasta} onChange={(e) => e.target.value && setRango({ desde, hasta: e.target.value })} /></label>
        <label className="field" style={{ width: 'auto' }}><span>CD</span><select value={cd} onChange={(e) => { setCd(e.target.value); setSel(new Set()); }}><option value="">Todos</option>{r.cds.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Zona</span><select value={fZona} onChange={(e) => { setFZona(e.target.value); setFPasillo(''); }}>
          <option value="">Todas</option>{zonas.map((z) => <option key={z}>{z}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Pasillo</span><select value={fPasillo} onChange={(e) => setFPasillo(e.target.value)}>
          <option value="">Todos</option>{pasillos.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Jefe de turno empresa</span><select value={fJefe} onChange={(e) => setFJefe(e.target.value)}>
          <option value="">Todos</option><option value="-">Sin asignar</option>{r.jefes.map((j) => <option key={j}>{j}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Estado</span><select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos</option>{Object.entries(ESTADO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {rango && <button type="button" className="ghost" onClick={() => setRango(null)}>Rango por defecto</button>}
      </div>

      {sinDatos ? <p className="empty">Aún no hay programación de Control de Existencia cargada.{verCargar && <> Súbela en <Link to="/cargas#carga-inventario">Datos, Cargas</Link>.</>}</p> : <>
        {(verCal || verRes) && <Kpis items={[
          ...(verCal ? [
            ['Grupos programados', <>{N(R.grupos)} <small>{N(R.ubicaciones)} ubic.</small></>],
            ['Ubicaciones contadas', <>{pctf(R.ubicaciones ? R.contadas / R.ubicaciones : 0)} <small>{N(R.contadas)}</small></>],
            ['A tiempo', R.aTiempo, 'ok'], ['Con retraso', R.retraso, R.retraso ? 'warn' : ''], ['No realizados', R.noRealizado, R.noRealizado ? 'warn' : ''],
            ['Sin jefe asignado', R.sinAsignar, R.sinAsignar ? 'warn' : '']] : []),
          ...(verRes ? [['ERI', <><Indicador v={r.tot.eri} sano={P.eriSano} critico={P.eriCritico} grande /> <small>{N(r.tot.unidCorr)} de {N(r.tot.unidReg)} u.</small></>],
            ['ERU', <><Indicador v={r.tot.eru} sano={P.eruSano} critico={P.eruCritico} grande /> <small>{N(r.tot.ubicOk)} de {N(r.tot.ubicaciones)} ubic.</small></>]] : [])]} />}

        <div className="grid">
          <Card className="s6" title="Cuándo pasa la operación" hint="Según la fecha de Control de Existencia (o su re-programación). El parámetro se cambia en Datos, Metas y calendario.">
            <div className="tscroll"><table>
              <tbody>
                <tr><th>Control de Existencia</th>{[1, 2, 3, 4, 5].map((x) => <td key={x} className="c"><b>{DIAS[x]}</b></td>)}</tr>
                <tr><th>Operación</th>{[1, 2, 3, 4, 5].map((x) => <td key={x} className="c">{DIAS[antes(x, P.diasAntes)]}</td>)}</tr>
              </tbody>
            </table></div>
          </Card>
          {verRes && <Card className="s6" title="Indicadores clave" hint="Con la última toma de cada ubicación y SKU.">
            <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13 }}>
              <li><b>ERI</b>, exactitud de registro de inventario = unidades correctas / unidades registradas × 100. Registradas = SISTEMA; correctas = en cada línea, lo que el conteo confirma (el menor entre CONTADO y SISTEMA).</li>
              <li><b>ERU</b>, exactitud de registro de ubicación = ubicaciones correctas / total de ubicaciones verificadas × 100. Una ubicación es correcta si todos sus SKU cuadran.</li>
            </ul>
            <div className="tscroll"><table>
              <thead><tr><th /><th className="c"><Carita nivel={0} /> Sano</th><th className="c"><Carita nivel={1} /> Atención</th><th className="c"><Carita nivel={2} /> Crítico</th></tr></thead>
              <tbody>
                <tr><th>ERI</th><td className="c">≥ {pctf(P.eriSano)}</td><td className="c">{pctf(P.eriCritico)} a {pctf(P.eriSano)}</td><td className="c">&lt; {pctf(P.eriCritico)}</td></tr>
                <tr><th>ERU</th><td className="c">≥ {pctf(P.eruSano)}</td><td className="c">{pctf(P.eruCritico)} a {pctf(P.eruSano)}</td><td className="c">&lt; {pctf(P.eruCritico)}</td></tr>
              </tbody>
            </table></div>
          </Card>}
        </div>

        {verCal && <Card title={`Programación y asignación (${N(grupos.length)} grupos)`}
          hint={`Un grupo = día de operación, CD, zona y pasillo. Programación: ${r.cargas.programa.archivo}, cargada ${fechaHora(new Date(r.cargas.programa.cargado_en).getTime())}.${r.cargas.resultado ? ` Resultado: ${r.cargas.resultado.archivo}, cargado ${fechaHora(new Date(r.cargas.resultado.cargado_en).getTime())}.` : ' Aún no hay resultado de la toma.'}`}>
          {verAsignar && <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10, padding: 10, borderRadius: 8, background: 'var(--bg)' }}>
            {jefesCfg.length ? <label className="field" style={{ width: 'auto' }}><span>Jefe de turno de la empresa</span>
              <select value={asig.jefe_empresa} onChange={(e) => { const p = jefesCfg.find((x) => x.nombre === e.target.value); setAsig({ ...asig, jefe_empresa: e.target.value, empresa: p?.empresa || '' }); }}>
                <option value="">Elegir</option>{jefesCfg.map((p) => <option key={p.id} value={p.nombre}>{p.nombre} · {p.empresa}{p.turno_id ? ` · ${p.turno_id}` : ''}{p.cd ? ` · ${p.cd}` : ''}</option>)}</select></label>
              : <>
                <label className="field" style={{ width: 'auto' }}><span>Jefe de turno de la empresa</span>
                  <input type="text" list="inv-jefes" value={asig.jefe_empresa} onChange={(e) => setAsig({ ...asig, jefe_empresa: e.target.value })} style={{ width: 200 }} /></label>
                <datalist id="inv-jefes">{r.jefes.map((j) => <option key={j} value={j} />)}</datalist>
                <label className="field" style={{ width: 'auto' }}><span>Empresa</span>
                  <input type="text" list="inv-empresas" value={asig.empresa} onChange={(e) => setAsig({ ...asig, empresa: e.target.value })} style={{ width: 150 }} /></label>
                <datalist id="inv-empresas">{r.empresas.map((j) => <option key={j} value={j} />)}</datalist></>}
            <label className="field" style={{ width: 'auto' }}><span>Supervisor Paris</span>
              <select value={asig.supervisor} onChange={(e) => setAsig({ ...asig, supervisor: e.target.value })}><option value="">Sin asignar</option>
                {r.personas.filter((p) => p.rol === 'Supervisor').map((p) => <option key={p.id} value={p.nombre}>{p.nombre}{p.turno_id ? ` (${p.turno_id})` : ''}{p.cd ? ` · ${p.cd}` : ''}</option>)}</select></label>
            <button type="button" className="btn" disabled={!sel.size || !asig.jefe_empresa.trim() || guardando} onClick={guardar}>
              {guardando ? 'Asignando…' : `Asignar a ${N(sel.size)} ${sel.size === 1 ? 'grupo' : 'grupos'}`}</button>
            {sel.size > 0 && <button type="button" className="ghost" onClick={() => setSel(new Set())}>Quitar selección</button>}
            <span className="hint" style={{ margin: 0 }}>Marca los grupos en la tabla y elige al jefe de turno de la empresa externa.</span>
          </div>}
          {grupos.length ? <div className="tscroll" style={{ maxHeight: 560, overflow: 'auto' }}><table>
            <thead><tr>
              {verAsignar && <th><input type="checkbox" aria-label="Seleccionar todos los grupos visibles" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(grupos.map((g) => g.k)))} /></th>}
              <th>Operación</th><th>CD</th><th>Zona</th><th>Pasillo</th><th className="num">Ubic.</th><th>Control de Existencia</th>
              <th>Turno</th><th>Jefe de turno empresa</th><th>Empresa</th><th>Supervisor</th><th className="num">Avance</th><th>Ejecución</th><th className="num">Demora</th><th>Estado</th>
              {verRes && <><th className="num">ERI</th><th className="num">ERU</th></>}</tr></thead>
            <tbody>{grupos.map((g) => { const [l, c] = ESTADO[g.estado] || [g.estado, '']; return (
              <tr key={g.k} style={g.fecha_op === hoy ? { background: 'color-mix(in srgb,var(--blue) 8%,transparent)' } : undefined}>
                {verAsignar && <td><input type="checkbox" aria-label={`Seleccionar ${g.cd} ${g.zona} pasillo ${g.pasillo} del ${dmy(g.fecha_op)}`} checked={sel.has(g.k)} onChange={() => marcar(g.k)} /></td>}
                <td style={{ whiteSpace: 'nowrap' }}><b>{g.dia_op}</b> {dmy(g.fecha_op)}</td><td>{g.cd}</td><td>{g.zona}</td><td>{g.pasillo}</td><td className="num">{N(g.ubicaciones)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{g.dia_ce} {dmy(g.fecha_ce)}{g.reprog > 0 && <span className="pill" title={`${g.reprog} ubicaciones re-programadas`} style={{ marginLeft: 6 }}>re-prog.</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{g.turno ? `T${g.turno}` : '—'}{g.auto && <span className="muted" title="Asignado por la Asignación diaria"> auto</span>}</td>
                <td>{g.jefe_empresa || <span className="muted">Sin asignar</span>}</td><td>{g.empresa || '—'}</td><td>{g.supervisor || '—'}</td>
                <td className="num" title={`${N(g.contadas)} de ${N(g.ubicaciones)} ubicaciones`}>{pctf(g.avance)}</td>
                <td style={{ whiteSpace: 'nowrap' }} title="Columna FECHA del resultado de la toma">{g.ultima ? <><b>{DIAS[new Date(`${g.ultima}T12:00:00`).getDay()]}</b> {dmy(g.ultima)}{g.primera !== g.ultima && <span className="muted"> (desde {dmy(g.primera).slice(0, 5)})</span>}</> : <span className="muted">—</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{g.demora === null ? <span className="muted">—</span>
                  : <span className={g.demora > 0 ? 'warn' : 'ok'} title={g.demoraPend ? 'Sin terminar: días desde la operación hasta hoy' : 'Días de la operación a la última toma'}>{g.demora} {g.demora === 1 ? 'día' : 'días'}</span>}</td>
                <td><span className={`st ${c}`}>{l}</span></td>
                {verRes && <><td className="num"><Indicador v={g.eri} sano={P.eriSano} critico={P.eriCritico} /></td><td className="num"><Indicador v={g.eru} sano={P.eruSano} critico={P.eruCritico} /></td></>}
              </tr>); })}</tbody>
          </table></div> : <p className="empty">No hay grupos con estos filtros.</p>}
          <p className="hint" style={{ marginTop: 6 }}>Ejecución = FECHA del resultado de la toma (si el conteo tomó varios días, el último). Solo cuenta como resultado del grupo una toma hecha desde {P.diasPrevios ?? 2} días antes de su día de operación; una más antigua no se considera. Demora = días entre la operación y la última toma; si el grupo sigue sin terminar, días hasta hoy. A tiempo = todas las ubicaciones del grupo contadas hasta su día de operación. Al generar la Asignación diaria, cada grupo del día queda asignado solo al turno que lo hace, con su supervisor y jefe de turno (marca "auto"); lo asignado a mano se respeta. Una carga nueva de CE reemplaza la programación de sus fechas y conserva lo asignado.</p>
        </Card>}

        {verCal && <Simulacion inicial={proximo} />}

        {verRes && (r.tot.lineas ? <>
          <div className="grid">
            {corte('Por jefe de turno de la empresa', 'Jefe de turno', r.porJefe, 'Según la asignación del grupo al que pertenece la ubicación.')}
            {corte('Por supervisor', 'Supervisor', r.porSupervisor)}
            {corte('Por empresa', 'Empresa', r.porEmpresa, 'Columna EMPRESA del resultado.')}
            {corte('Por turno de ejecución', 'Turno', r.porTurno || [], 'Columna TURNO del resultado.')}
            {corte('Por día de operación', 'Día', r.porDia.map((x) => ({ ...x, v: /^\d{4}-/.test(x.v) ? dmy(x.v) : x.v })))}
            {corte('Por zona', 'CD · zona', r.porZona)}
            {corte('Por usuario', 'Usuario', r.porUsuario, 'Quién contó (columna USUARIO).')}
          </div>
          <Card title={`Diferencias (${N(r.totalDiferencias)})`} hint="Líneas en que CONTADO no cuadra con SISTEMA, primero las de urgencia alta. No encontrado = el sistema lo tiene y no se contó; no registrado = se contó y el sistema no lo tiene en esa ubicación."
            actions={r.diferencias.length > 0 && <button type="button" className="ghost" onClick={() => descargar([
              ['Fecha', 'CD', 'Zona', 'Pasillo', 'Ubicación', 'SKU', 'Contado', 'Sistema', 'Diferencia', 'Tipo', 'Estado', 'Nivel urgencia', 'Requiere supervisor', 'Usuario', 'Empresa', 'Jefe de turno empresa', 'Supervisor'],
              ...r.diferencias.map((x) => [x.fecha, x.cd, x.zona, x.pasillo, x.ubicacion, x.sku, x.contado, x.sistema, x.diferencia, TIPO[x.tipo] || x.tipo, x.estado, x.nivel_urgencia, x.requiere_supervisor, x.usuario, x.empresa, x.jefe_empresa, x.supervisor])
            ], 'diferencias-inventario.csv')}>Descargar CSV</button>}>
            <TablaOrden filas={r.diferencias} inicial={['fecha', -1]} max={30} clave={(x) => `${x.cd}|${x.ubicacion}|${x.sku}|${x.fecha}`} cols={[
              ['fecha', 'Fecha', false, dmy], ['cd', 'CD'], ['ubicacion', 'Ubicación'], ['sku', 'SKU'], ['contado', 'Contado', true, N], ['sistema', 'Sistema', true, N],
              ['diferencia', 'Diferencia', true, (v) => (v ? <b style={{ color: 'var(--red)' }}>{v > 0 ? '+' : ''}{N(v)}</b> : '0')],
              ['tipo', 'Tipo', false, (v) => TIPO[v] || v], ['nivel_urgencia', 'Urgencia'], ['requiere_supervisor', 'Req. supervisor'],
              ['usuario', 'Usuario'], ['jefe_empresa', 'Jefe de turno empresa'], ['supervisor', 'Supervisor']]} />
            {r.totalDiferencias > r.diferencias.length && <p className="hint">Se muestran {N(r.diferencias.length)} de {N(r.totalDiferencias)}; el CSV trae las mismas.</p>}
          </Card>
        </> : <p className="empty">Aún no hay resultados de la toma en el rango.{verCargar && <> Sube el resultado en <Link to="/cargas#carga-inventario">Datos, Cargas</Link>.</>}</p>)}
      </>}
    </>
  );
}
