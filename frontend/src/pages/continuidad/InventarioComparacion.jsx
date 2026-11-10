// Toma CE vs operación (Gestión de inventario): la toma oficial de Control de Existencia contra la toma que hizo la
// operación días antes en las mismas ubicaciones. Se comparan diferencias (Físico − Teórico en CE, Contado − Sistema en
// la operación): si son iguales, la operación ya había visto lo que encontró CE; el movimiento del sistema entre ambas
// tomas (Teórico CE − Sistema op.) explica parte de lo que cambia.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import { N, pctf, dmy, dm } from '../../lib/fmt.js';
import { descargar } from './Inventario.jsx';

// orden y color de cada resultado del cruce
const COLOR = { ok: '--green', igual: '--blue', ce: '--red', op: '--yellow', distinta: '--violet', soloCe: '--slate', soloOp: '--teal', sinOp: '--muted' };
const ORDEN = Object.keys(COLOR);
const AYUDA = {
  ok: 'Ninguna de las dos tomas encontró diferencia.',
  igual: 'La operación encontró la misma diferencia que CE: ya estaba vista antes de CE.',
  ce: 'La operación cuadró y CE encontró diferencia: apareció entre ambas tomas o la operación no la vio.',
  op: 'La operación encontró diferencia y CE cuadró: se ajustó antes de CE o el conteo de la operación no fue correcto.',
  distinta: 'Ambas con diferencia, pero distinta.',
  soloCe: 'La operación contó la ubicación, pero no este SKU.',
  soloOp: 'La operación contó este SKU en la ubicación y CE no lo trae.',
  sinOp: 'La operación no contó la ubicación dentro de la ventana de días.'
};
const signo = (v) => (v === null || v === undefined ? '—' : v > 0 ? `+${N(v)}` : v < 0 ? `−${N(-v)}` : '0');
const $ = (v) => (v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}$${N(Math.abs(v))}`);
const dif = (v) => (v === null || v === undefined ? <span className="muted">—</span> : <b className={v ? 'warn' : 'ok'}>{signo(v)}</b>);
const div = (a, b) => (b > 0 ? a / b : null);

function Seg({ valor, opciones, onChange, label }) {
  return (
    <div className="seg-inv" role="group" aria-label={label}>
      {opciones.map(([v, t]) => <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

// Medida de todo el módulo: el nombre, la exactitud que le corresponde y cómo se escribe un valor
const MED = {
  ubic: { t: 'Ubicaciones', c: 'Ubic.', ex: 'ERU', exAyuda: 'ubicaciones con todas sus líneas sin diferencia / ubicaciones contadas' },
  sku: { t: 'SKU', c: 'SKU', ex: 'Exactitud SKU', exAyuda: 'SKU sin diferencia neta (sus ubicaciones juntas) / SKU contados' },
  lineas: { t: 'Líneas', c: 'Líneas', ex: 'Exactitud líneas', exAyuda: 'líneas (ubicación y SKU) sin diferencia / líneas contadas' },
  unid: { t: 'Unidades', c: 'Unid.', ex: 'ERI', exAyuda: 'unidades que el conteo confirma / unidades registradas' },
  valor: { t: 'Valor $', c: 'Valor', ex: 'ERI valorizado', exAyuda: 'valor que el conteo confirma / valor registrado (a costo)' }
};
const MEDIDAS = Object.keys(MED);
const esMonto = (m) => m === 'unid' || m === 'valor';
const p1 = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const fmM = (m) => (v) => (m === 'valor' ? $(v) : N(v));
const signoM = (m) => (v) => (m === 'valor' ? (v > 0 ? `+${$(v)}` : $(v)) : signo(v));
const difM = (m) => (v) => (v === null || v === undefined ? <span className="muted">—</span> : <b className={v ? 'warn' : 'ok'}>{signoM(m)(v)}</b>);
const sumaEst = (est) => ORDEN.reduce((t, k) => t + (est[k] || 0), 0);

// Tabla por fecha de CE, zona, pasillo o SKU en la medida elegida
// encabezados cortos para que la tabla quepa sin desplazamiento (el nombre completo va en el tooltip)
const CORTO = { ok: 'Cuadran', igual: 'Misma dif.', ce: 'Solo CE', op: 'Solo op.', distinta: 'Distintas', soloCe: 'SKU no contado', soloOp: 'SKU no en CE', sinOp: 'Sin toma op.' };
function Resumen({ filas, clave, titulo, fmtClave, nombres, medida }) {
  const M = MED[medida], fm = fmM(medida), dm_ = difM(medida), monto = esMonto(medida);
  return (
    <div className="val-det cmp-tabla" style={{ maxHeight: 420, overflowY: 'auto' }}><table>
      <thead><tr><th>{titulo}</th><th className="num">{M.c} CE</th><th className="num">Con toma op.</th>
        {ORDEN.map((k) => <th key={k} className="num" title={`${nombres[k]}: ${AYUDA[k]}`}><i className="cmp-pt" style={{ background: `var(${COLOR[k]})` }} />{CORTO[k]}</th>)}
        <th className="num" title={`${M.ex} = ${M.exAyuda}`}>{M.ex} CE / op.</th>
        {monto ? <th className="num" title="Diferencia neta de CE / de la operación">Dif. neta CE / op.</th> : <th className="num" title={`${M.t} con diferencia en CE / en la operación`}>Con dif. CE / op.</th>}</tr></thead>
      <tbody>{filas.map((x) => { const m = x.m; return (
        <tr key={x[clave]}>
          <td><b>{fmtClave(x[clave], x)}</b></td><td className="num">{fm(m.total)}</td>
          <td className="num">{fm(m.conOp)} <span className="muted">({pctf(div(m.conOp, m.total))})</span></td>
          {ORDEN.map((k) => <td key={k} className="num">{m.est[k] ? fm(m.est[k]) : <span className="muted">·</span>}</td>)}
          <td className="num">{p1(m.exCe)} <span className="muted">/ {p1(m.exOp)}</span></td>
          {monto ? <td className="num">{dm_(m.ce.neto)} <span className="muted">/</span> {m.op.n ? dm_(m.op.neto) : <span className="muted">—</span>}</td>
            : <td className="num"><b className={m.ce.conDif ? 'warn' : 'ok'}>{N(m.ce.conDif)}</b> <span className="muted">/</span> {m.op.n ? <b className={m.op.conDif ? 'warn' : 'ok'}>{N(m.op.conDif)}</b> : <span className="muted">—</span>}</td>}
        </tr>); })}</tbody>
    </table></div>
  );
}

/** CSV de una tabla de resumen en la medida elegida */
function csvResumen(filas, cols, fila, medida, E, nombre) {
  const M = MED[medida], monto = esMonto(medida);
  descargar([[...cols, 'Medida', `${M.t} CE`, 'Con toma op.', ...ORDEN.map((k) => E[k]), `${M.ex} CE`, `${M.ex} op.`,
    ...(monto ? ['Registrado CE', 'Contado CE', 'Dif. neta CE', 'Dif. abs. CE', 'Registrado op.', 'Contado op.', 'Dif. neta op.', 'Dif. abs. op.'] : ['Con dif. CE', 'Faltante CE', 'Sobrante CE', 'Con dif. op.', 'Faltante op.', 'Sobrante op.'])],
  ...filas.map((x) => { const m = x.m; return [...fila(x), M.t, Math.round(m.total), Math.round(m.conOp), ...ORDEN.map((k) => Math.round(m.est[k] || 0)), m.exCe, m.exOp,
    ...(monto ? [m.ce.base, m.ce.fis, m.ce.neto, m.ce.abs, m.op.base, m.op.fis, m.op.neto, m.op.abs].map(Math.round) : [m.ce.conDif, m.ce.falt, m.ce.sobr, m.op.conDif, m.op.falt, m.op.sobr])]; })], nombre);
}

export default function InventarioComparacion() {
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', zona: '', antes: '10', despues: '0' });
  const [ver, setVer] = useState('dif');
  const [vistaP, setVistaP] = useState('pasillo');
  const [medida, setMedida] = useState('ubic');
  const [busca, setBusca] = useState('');
  const [buscar, setBuscar] = useState('');
  const d = useCarga(() => api.get(`/continuidad/inventario/comparacion?${new URLSearchParams({ ...filtro, ver, buscar, medida })}`), [filtro, ver, buscar, medida]);
  const r = d.data;
  if (!r) return <><PageHead title="Toma CE vs operación" /><Cargando error={d.error} /></>;
  const set = (k) => (e) => setFiltro({ ...filtro, desde: filtro.desde || r.desde || '', hasta: filtro.hasta || r.hasta || '', [k]: e.target.value });
  const T = r.tot, E = r.estados, ct = r.cuenta || {};
  const detalle = r.detalle || [];
  const med = r.medida || medida, M = MED[med], fm = fmM(med), sm = signoM(med), monto = esMonto(med), tm = T?.m;
  const tu = M.t.toLowerCase();
  const conDif = tm ? tm.est.igual + tm.est.ce + tm.est.distinta : 0;
  // pie de las tarjetas de CE y de la operación
  const pie = (x, reg, cont) => (monto
    ? <>{reg} {fm(x.base)} · {cont} {fm(x.fis)} · Neto <b>{sm(x.neto)}</b> · Faltante {fm(x.falt)} · Sobrante {fm(x.sobr)}</>
    : <>{N(x.n)} {tu} contados: {N(x.ok)} sin diferencia · {N(x.falt)} con faltante · {N(x.sobr)} con sobrante{x.conDif - x.falt - x.sobr ? ` · ${N(x.conDif - x.falt - x.sobr)} compensados` : ''}</>);
  const tarjetaDif = (x) => (monto
    ? <div><dt>Diferencia neta</dt><dd className={x.neto ? 'warn' : ''}>{sm(x.neto)}</dd><small>absoluta {fm(x.abs)}</small></div>
    : <div><dt>Con diferencia</dt><dd className={x.conDif ? 'warn' : ''}>{N(x.conDif)}</dd><small>{pctf(div(x.conDif, x.n))} de {N(x.n)}</small></div>);
  const csv = () => descargar([['Fecha CE', 'Ubicación', 'Zona', 'SKU', 'Descripción', 'Depto', 'Costo', 'Teórico CE', 'Físico CE', 'Dif. CE', 'Dif. CE $', 'Fecha op.', 'Días antes', 'CD op.',
    'Sistema op.', 'Contado op.', 'Dif. op.', 'Pasadas op.', 'Mov. sistema', 'Resultado', 'Análisis CE', 'Observación CE'],
  ...detalle.map((x) => [x.fechaCe, x.ubicacion, x.zona, x.sku, x.desc, x.depto, x.costo, x.teo, x.fis, x.difCe, x.difCe === null ? '' : x.difCe * x.costo, x.fechaOp, x.dias, x.cdOp,
    x.sis, x.cont, x.difOp, x.pasadas, x.mov, E[x.estado], x.analisis, x.observacion])], `toma_ce_vs_operacion_${r.desde}_${r.hasta}.csv`);

  return (
    <>
      <PageHead title="Toma CE vs operación" sub={r.datos ? `Toma oficial de Control de Existencia contra la toma de la operación en las mismas ubicaciones. Hay toma de CE del ${dmy(r.datos.desde)} al ${dmy(r.datos.hasta)}.` : 'Aún no hay una toma de CE cargada.'}>
        <Link className="btn" to="/cargas">Cargar toma de CE</Link>
        <Link className="btn" to="/inventario/validacion">Validación de la toma</Link>
      </PageHead>
      {!r.datos ? <p className="empty">Carga el archivo de la toma de Control de Existencia (Fecha, Ubicación, SKU, Teorico, Fisico, Costo…) en Datos, Cargas de archivos, tarjeta Inventario. Se reconoce solo.</p> : <>
        <div className="filters" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 'auto' }} title="Todo el módulo (tarjetas, resultado del cruce y tablas) se mide en esta unidad"><span>Medida</span>
            <Seg label="Medida" valor={med} onChange={setMedida} opciones={MEDIDAS.map((k) => [k, MED[k].t])} /></div>
          <label className="field" style={{ width: 'auto' }}><span>Toma CE desde</span><input type="date" value={filtro.desde || r.desde || ''} onChange={set('desde')} /></label>
          <label className="field" style={{ width: 'auto' }}><span>Hasta</span><input type="date" value={filtro.hasta || r.hasta || ''} onChange={set('hasta')} /></label>
          <label className="field" style={{ width: 'auto' }}><span>Zona</span><select value={filtro.zona} onChange={set('zona')} title="Las 3 primeras letras de la ubicación">
            <option value="">Todas</option>{(r.zonas || []).map((z) => <option key={z}>{z}</option>)}</select></label>
          <label className="field" style={{ width: 'auto' }} title="Hasta cuántos días antes de la toma de CE se busca la toma de la operación (vale la más cercana)">
            <span>Toma op. hasta (días antes)</span><input type="number" min="0" max="60" value={filtro.antes} onChange={set('antes')} style={{ width: 90 }} /></label>
          <label className="field" style={{ width: 'auto' }} title="Si la operación no contó antes, hasta cuántos días después de CE se acepta su toma">
            <span>o días después</span><input type="number" min="0" max="30" value={filtro.despues} onChange={set('despues')} style={{ width: 90 }} /></label>
          {(filtro.desde || filtro.zona || filtro.antes !== '10' || filtro.despues !== '0') && <button type="button" className="ghost" onClick={() => setFiltro({ desde: '', hasta: '', zona: '', antes: '10', despues: '0' })}>Quitar filtros</button>}
        </div>

        {!T || !T.lineas ? <p className="empty">Sin toma de CE entre el {dmy(r.desde)} y el {dmy(r.hasta)} con estos filtros.</p> : <>
          <div className="val-tarjetas">
            <section className="card val-tarjeta" style={{ '--c': 'var(--blue)' }}>
              <h3>Toma de CE · {M.t}</h3>
              <dl>
                <div><dt>{med === 'unid' ? 'Unidades (teórico)' : med === 'valor' ? 'Valor teórico' : M.t}</dt><dd>{fm(tm.total)}</dd><small>{monto ? `físico ${fm(tm.ce.fis)}` : `${N(T.ubicaciones)} ubic. · ${N(tm.ce.n)} con toma de CE`}</small></div>
                <div title={`${M.ex} = ${M.exAyuda}`}><dt>{M.ex}</dt><dd>{p1(tm.exCe)}</dd><small>{monto ? `${fm(tm.ce.ok)} confirmados` : `${N(tm.ce.ok)} de ${N(tm.ce.n)} sin diferencia`}</small></div>
                {tarjetaDif(tm.ce)}
              </dl>
              <p className="val-dif">{pie(tm.ce, 'Teórico', 'Físico')}</p>
            </section>
            <section className="card val-tarjeta" style={{ '--c': 'var(--slate)' }}>
              <h3>Toma de la operación (mismas ubicaciones) · {M.t}</h3>
              <dl>
                <div><dt>Con toma op.</dt><dd>{pctf(div(tm.conOp, tm.total))}</dd><small>{fm(tm.conOp)} de {fm(tm.total)}{monto ? '' : ` ${tu}`}</small></div>
                <div title={`${M.ex} = ${M.exAyuda}`}><dt>{M.ex}</dt><dd>{p1(tm.exOp)}</dd><small>{monto ? `${fm(tm.op.ok)} confirmados` : `${N(tm.op.ok)} de ${N(tm.op.n)} sin diferencia`}</small></div>
                {tarjetaDif(tm.op)}
              </dl>
              <p className="val-dif">{pie(tm.op, 'Sistema', 'Contado')} · {T.diasProm === null ? '' : `${T.diasProm.toFixed(1).replace('.', ',')} días antes de CE en promedio`}</p>
            </section>
            <section className="card val-tarjeta" style={{ '--c': 'var(--green)' }}>
              <h3>Coincidencia · {M.t}</h3>
              <dl>
                <div><dt>Mismo resultado</dt><dd>{pctf(div(tm.est.ok + tm.est.igual, sumaEst(tm.est) - tm.est.sinOp))}</dd><small>{monto ? 'de lo que tiene toma op.' : `de ${tu} con toma op.`}</small></div>
                <div><dt>Dif. de CE ya vistas</dt><dd>{pctf(div(tm.est.igual, conDif))}</dd><small>{fm(tm.est.igual)} de {fm(conDif)}</small></div>
                <div><dt>Dif. solo en CE</dt><dd className={tm.est.ce ? 'warn' : ''}>{fm(tm.est.ce)}</dd><small>la operación cuadró</small></div>
              </dl>
              <p className="val-dif">Días entre la toma op. y CE (ubicaciones): {Object.entries(T.histDias).sort(([a], [b]) => a - b).map(([k, v]) => `${k} d: ${N(v)}`).join(' · ') || '—'}</p>
            </section>
          </div>

          <Card title="Por fecha de toma de CE" hint={`La toma de la operación es la más cercana hasta ${r.antes} días antes de CE${r.despues ? ` (o hasta ${r.despues} días después)` : ''}.`}>
            <Resumen filas={r.fechas} clave="fecha" titulo="Fecha CE" fmtClave={dmy} nombres={E} medida={med} />
          </Card>
          <Card title="Por zona" hint="Ordenado por la diferencia absoluta valorizada de CE.">
            <Resumen filas={r.porZona} clave="zona" titulo="Zona" fmtClave={(z) => z} nombres={E} medida={med} />
          </Card>
          <Card title={vistaP === 'sku' ? 'Por SKU' : 'Por pasillo'}
            hint={vistaP === 'sku'
              ? `Cada SKU con todas sus ubicaciones juntas: la diferencia neta compensa lo que falta en una ubicación con lo que sobra en otra. ${N(r.porSku.total)} SKU${filtro.zona ? ` de la zona ${filtro.zona}` : ''}${r.porSku.total > r.porSku.filas.length ? ` (se muestran los ${N(r.porSku.filas.length)} con mayor diferencia)` : ''}, ordenados por la diferencia absoluta valorizada de CE.`
              : `Pasillo = los 5 primeros caracteres de la ubicación, como en el Calendario de planificación. ${N(r.porPasillo.length)} pasillos${filtro.zona ? ` de la zona ${filtro.zona}` : ''}, ordenados por la diferencia absoluta valorizada de CE.`}
            actions={<div className="row" style={{ gap: 8 }}>
              <Seg label="Vista" valor={vistaP} onChange={setVistaP} opciones={[['pasillo', 'Por pasillo'], ['sku', 'Por SKU']]} />
              <button type="button" className="ghost" onClick={() => {
                const sku = vistaP === 'sku';
                csvResumen(sku ? r.porSku.filas : r.porPasillo, sku ? ['SKU', 'Descripción', 'Depto'] : ['Pasillo'], (x) => (sku ? [x.sku, x.desc, x.depto] : [x.pasillo]), med, E,
                  `toma_ce_vs_operacion_${sku ? 'sku' : 'pasillos'}_${med}_${r.desde}_${r.hasta}.csv`);
              }}>Descargar CSV</button></div>}>
            {vistaP === 'sku'
              ? <Resumen filas={r.porSku.filas} clave="sku" titulo="SKU" nombres={E} medida={med}
                fmtClave={(s, x) => <>{s}{x?.desc && <div className="hint" style={{ margin: 0, fontSize: 11, fontWeight: 400, whiteSpace: 'normal' }}>{x.desc}</div>}</>} />
              : <Resumen filas={r.porPasillo} clave="pasillo" titulo="Pasillo" fmtClave={(z) => z} nombres={E} medida={med} />}
          </Card>

          <Card title="Detalle por ubicación y SKU" hint={`${N(r.totalDetalle)} líneas${buscar ? ` con «${buscar}»` : ''}, ordenadas por la diferencia de CE valorizada. El detalle es siempre por línea (ubicación y SKU), sea cual sea la medida. Mov. sistema = Teórico CE − Sistema op.: lo que el sistema cambió entre ambas tomas.${r.totalDetalle > detalle.length ? ` El CSV trae las primeras ${N(detalle.length)}.` : ''}`}
            actions={<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input type="search" aria-label="Buscar ubicación o SKU" placeholder="Ubicación o SKU (Enter)" value={busca} style={{ width: 200 }}
                onChange={(e) => { setBusca(e.target.value); if (!e.target.value) setBuscar(''); }} onKeyDown={(e) => e.key === 'Enter' && setBuscar(busca.trim())} onBlur={() => setBuscar(busca.trim())} />
              <select aria-label="Ver" value={ver} onChange={(e) => setVer(e.target.value)} style={{ width: 'auto' }}>
                <option value="todo">Todo ({N(ct.todo)})</option>
                <option value="dif">Con alguna diferencia ({N((ct.todo || 0) - (ct.ok || 0) - (ct.sinOp || 0))})</option>
                {ORDEN.map((k) => <option key={k} value={k}>{E[k]} ({N(ct[k] || 0)})</option>)}
              </select>
              <button type="button" className="ghost" onClick={csv} disabled={!detalle.length}>Descargar CSV</button></div>}>
            {detalle.length ? <div className="tscroll val-det" style={{ maxHeight: 560, overflow: 'auto' }}><table>
              <thead><tr><th>Fecha CE</th><th>Ubicación</th><th>SKU</th><th className="num">Teórico CE</th><th className="num">Físico CE</th><th className="num">Dif. CE</th><th className="num">Dif. CE $</th>
                <th>Toma op.</th><th className="num">Sistema op.</th><th className="num">Contado op.</th><th className="num">Dif. op.</th><th className="num">Mov. sistema</th><th>Resultado</th><th>Análisis CE</th></tr></thead>
              <tbody>{detalle.slice(0, 500).map((x) => (
                <tr key={`${x.fechaCe}|${x.ubicacion}|${x.sku}|${x.estado}`}>
                  <td>{dm(x.fechaCe)}</td><td>{x.ubicacion}</td>
                  <td>{x.sku}{x.desc && <div className="hint" style={{ margin: 0, fontSize: 11 }}>{x.desc}</div>}</td>
                  <td className="num">{N(x.teo)}</td><td className="num">{N(x.fis)}</td><td className="num">{dif(x.difCe)}</td><td className="num">{x.difCe ? $(x.difCe * x.costo) : <span className="muted">—</span>}</td>
                  <td>{x.fechaOp ? <>{dm(x.fechaOp)} <span className="muted">({x.dias} d{x.cdOp ? ` · ${x.cdOp}` : ''})</span></> : <span className="muted">—</span>}</td>
                  <td className="num">{N(x.sis)}</td><td className="num">{N(x.cont)}</td><td className="num">{dif(x.difOp)}</td>
                  <td className="num">{x.mov ? <span title="El sistema cambió entre la toma de la operación y la de CE">{signo(x.mov)}</span> : <span className="muted">{x.mov === 0 ? '0' : '—'}</span>}</td>
                  <td><span className="cmp-res" style={{ '--c': `var(${COLOR[x.estado]})` }} title={AYUDA[x.estado]}>{E[x.estado]}</span></td>
                  <td style={{ fontSize: 12 }}>{x.analisis || x.observacion || ''}</td></tr>))}</tbody>
            </table></div> : <p className="empty">Nada que mostrar con este filtro.</p>}
            {detalle.length > 500 && <p className="hint">Se muestran 500 de {N(detalle.length)} líneas; descarga el CSV para verlas todas.</p>}
          </Card>
        </>}
      </>}
    </>
  );
}
