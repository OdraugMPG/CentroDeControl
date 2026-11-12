// Validación de la toma (Gestión de inventario): el resultado por pasada según la columna VALIDACION (primera, segunda
// y tercera), en ubicaciones, SKU y unidades, por día de toma y CD; lo que requiere supervisor; cómo se resuelven las
// diferencias de una pasada a la siguiente y el detalle por ubicación y SKU.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, dmy, dm, css } from '../../lib/fmt.js';
import { descargar } from './Inventario.jsx';

const PASADA = { 1: ['Primera pasada', '--blue'], 2: ['Segunda pasada', '--slate'], 3: ['Tercera pasada', '--yellow'],
  4: ['Cuarta pasada', '--teal'], 5: ['Quinta pasada', '--teal'], 6: ['Sexta pasada', '--teal'] };
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

// Movimientos para corregir el match: la mercadería está físicamente en la ubicación con sobrante (origen) y el sistema la
// espera en la que tiene faltante (destino). Por SKU se emparejan de mayor a mayor y se mueve el menor de los dos.
function movimientosMatch(lista) {
  const out = [];
  for (const g of lista) {
    const orig = g.ubic.filter((u) => u.sobr > 0).map((u) => ({ ...u, q: u.sobr })).sort((a, b) => b.q - a.q);
    const dest = g.ubic.filter((u) => u.falt > 0).map((u) => ({ ...u, q: u.falt })).sort((a, b) => b.q - a.q);
    let i = 0, j = 0;
    while (i < orig.length && j < dest.length) {
      const c = Math.min(orig[i].q, dest[j].q);
      out.push({ cd: g.cd, sku: g.sku, origen: orig[i].ubicacion, fOrigen: orig[i].fecha, destino: dest[j].ubicacion, fDestino: dest[j].fecha, cant: c });
      orig[i].q -= c; dest[j].q -= c;
      if (!orig[i].q) i++;
      if (!dest[j].q) j++;
    }
  }
  return out;
}

// Match: el mismo SKU falta en una ubicación y sobra en otra del mismo CD. Al netearlos baja la diferencia de inventario
// (es mercadería mal ubicada, no una pérdida). Como la tabla dinámica: CD, SKU y ubicación con faltante y sobrante.
function Match({ m, desde, hasta }) {
  const porCd = [...new Set(m.lista.map((g) => g.cd))].map((cd) => ({ cd, gs: m.lista.filter((g) => g.cd === cd) }));
  const suma = (gs, k) => gs.reduce((a, g) => a + g[k], 0);
  const n0 = (v) => (v ? N(v) : '');
  const movs = movimientosMatch(m.lista);
  // por ubicación: a dónde llevar (origen) o de dónde traer (destino)
  const rol = new Map();
  for (const x of movs) {
    const o = `${x.cd}|${x.sku}|${x.origen}`, d = `${x.cd}|${x.sku}|${x.destino}`;
    rol.set(o, [...(rol.get(o) || []), `→ ${x.destino} (${N(x.cant)})`]);
    rol.set(d, [...(rol.get(d) || []), `← ${x.origen} (${N(x.cant)})`]);
  }
  const csvMov = () => descargar([['CD', 'SKU', 'Ubi. origen (sobrante)', 'Fecha toma origen', 'Ubi. destino (faltante)', 'Fecha toma destino', 'Cantidad a mover'],
    ...movs.map((x) => [x.cd, x.sku, x.origen, x.fOrigen, x.destino, x.fDestino, x.cant])], `movimientos_match_${desde}_${hasta}.csv`);
  const csv = () => descargar([['CD', 'SKU', 'Ubicación', 'Fecha de toma', 'Faltante', 'Sobrante', 'Total general'],
    ...m.lista.flatMap((g) => g.ubic.map((u) => [g.cd, g.sku, u.ubicacion, u.fecha, u.falt, u.sobr, u.falt + u.sobr]))], `match_sku_${desde}_${hasta}.csv`);
  return (
    <Card title="Match de faltantes y sobrantes (mismo SKU)" hint="El mismo SKU que falta en una ubicación y sobra en otra del mismo CD: al netearlos baja la diferencia de inventario. Con la diferencia final de cada ubicación (la última toma del rango)."
      actions={m.skus > 0 && <div className="row" style={{ gap: 6 }}><button type="button" className="ghost" onClick={csvMov}>Descargar movimientos</button><button type="button" className="ghost" onClick={csv}>Descargar CSV</button></div>}>
      {!m.skus ? <p className="empty">No hay SKU que falten en una ubicación y sobren en otra del mismo CD con estos filtros.</p> : <>
        <div className="dash-match-k">
          <div><b>{N(m.skus)}</b><span>SKU con match</span><small>{N(m.totales)} netean toda su diferencia</small></div>
          <div><b>{N(m.neteo)}</b><span>Unidades que se netean</span><small>a mover entre ubicaciones</small></div>
          <div><b>{pctf(div(m.absMatch, m.absTotal))}</b><span>Baja la diferencia absoluta</span><small>de {N(m.absTotal)} a {N(m.absTotal - m.absMatch)} unidades</small></div>
        </div>
        <div className="tscroll val-det" style={{ maxHeight: 460, overflow: 'auto', marginTop: 12 }}><table className="val-match">
          <thead><tr><th>CD</th><th>SKU</th><th>Ubicación</th><th className="num">Faltante</th><th className="num">Sobrante</th><th className="num">Total general</th><th>Mover</th><th className="num">Netea</th><th className="num">Queda</th></tr></thead>
          <tbody>{porCd.map(({ cd, gs }) => [
            ...gs.flatMap((g) => [
              ...g.ubic.map((u, i) => (
                <tr key={`${cd}|${g.sku}|${u.ubicacion}`}><td>{i === 0 && g === gs[0] ? <b>{cd}</b> : ''}</td><td>{i === 0 ? <b>{g.sku}</b> : ''}</td>
                  <td title={`Toma ${dmy(u.fecha)}`}>{u.ubicacion}</td><td className="num warn">{n0(u.falt)}</td><td className="num">{n0(u.sobr)}</td><td className="num">{N(u.falt + u.sobr)}</td>
                  <td className="val-mover">{(rol.get(`${cd}|${g.sku}|${u.ubicacion}`) || []).map((t) => <div key={t} className={t[0] === '→' ? '' : 'muted'}>{t}</div>)}</td><td /><td /></tr>)),
              <tr key={`${cd}|${g.sku}|t`} className="val-m-sub"><td /><td colSpan={2}>Total {g.sku}</td><td className="num">{N(g.falt)}</td><td className="num">{N(g.sobr)}</td><td className="num">{N(g.falt + g.sobr)}</td><td />
                <td className="num"><b>{N(g.neteo)}</b></td><td className="num"><b className={g.queda ? 'warn' : 'ok'}>{signo(g.queda)}</b></td></tr>]),
            <tr key={`${cd}|t`} className="val-m-cd"><td colSpan={3}>Total {cd}</td><td className="num">{N(suma(gs, 'falt'))}</td><td className="num">{N(suma(gs, 'sobr'))}</td>
              <td className="num">{N(suma(gs, 'falt') + suma(gs, 'sobr'))}</td><td /><td className="num">{N(suma(gs, 'neteo'))}</td><td className="num">{signo(suma(gs, 'queda'))}</td></tr>])}</tbody>
        </table></div>
        <h4 className="dash-sub" style={{ marginTop: 14 }}>Movimientos a realizar <small>sacar de la ubicación con sobrante y llevar a la que tiene faltante</small></h4>
        <div className="tscroll" style={{ maxHeight: 360, overflow: 'auto' }}><table className="val-match">
          <thead><tr><th>CD</th><th>SKU</th><th>Ubi. origen <small className="muted">(sobrante)</small></th><th /><th>Ubi. destino <small className="muted">(faltante)</small></th><th className="num">Cantidad a mover</th></tr></thead>
          <tbody>{movs.map((x, i) => (
            <tr key={i}><td>{x.cd}</td><td><b>{x.sku}</b></td><td title={`Toma ${dmy(x.fOrigen)}`}>{x.origen}</td><td className="muted" aria-hidden="true">→</td>
              <td title={`Toma ${dmy(x.fDestino)}`}>{x.destino}</td><td className="num"><b>{N(x.cant)}</b></td></tr>))}</tbody>
          <tfoot><tr><th colSpan={5}>{N(movs.length)} {movs.length === 1 ? 'movimiento' : 'movimientos'}</th><th className="num">{N(movs.reduce((a, x) => a + x.cant, 0))}</th></tr></tfoot>
        </table></div>
        <p className="hint">Mover: en la ubicación con sobrante, a dónde llevar (→) y cuánto; en la que tiene faltante, de dónde viene (←). Con varias ubicaciones del mismo SKU se emparejan de mayor a mayor. Verificar físicamente antes de mover y registrar el movimiento en el WMS. Netea: las unidades que se compensan (el menor entre faltante y sobrante). Queda: la diferencia del SKU después de netear (negativo = sigue faltando).</p>
      </>}
    </Card>
  );
}

export default function InventarioValidacion() {
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', cd: '', zona: '', turno: '', empresa: '' });
  const [med, setMed] = useState('ubicaciones');
  const [verDet, setVerDet] = useState('todo');
  const [busca, setBusca] = useState('');
  const [buscar, setBuscar] = useState('');
  // la vista del detalle y la búsqueda se filtran en el servidor, así no se corta ninguna línea por el límite
  const d = useCarga(() => api.get(`/continuidad/inventario/validacion?${new URLSearchParams({ ...filtro, ver: verDet, buscar })}`), [filtro, verDet, buscar]);
  const r = d.data;
  const detalle = r?.detalle || [];
  if (!r) return <><PageHead title="Validación de la toma" /><Cargando error={d.error} /></>;
  const set = (k) => (e) => setFiltro({ ...filtro, desde: filtro.desde || r.desde, hasta: filtro.hasta || r.hasta, [k]: e.target.value });
  const medN = MEDIDAS.find((m) => m[0] === med)[1];
  const P = r.pasadas, E = r.embudo;
  const cols = Array.from({ length: r.maxPasada || 3 }, (_, i) => i + 1);
  const ct = r.cuenta || {};

  const porDia = {
    labels: r.fechas.map(dm),
    datasets: P.map((p) => ({ label: nombre(p.conteo), data: p.dias.map((x) => (x ? x[med] : 0)), backgroundColor: css(color(p.conteo)), borderRadius: 4, borderSkipped: false, maxBarThickness: 34 }))
  };
  const embudo = E && {
    labels: ['Líneas contadas (1ª)', 'Con diferencia en la 1ª', 'Fueron a 2ª pasada', 'Cuadraron en la 2ª', 'Fueron a 3ª pasada', 'Cuadraron en la 3ª', 'Siguen con diferencia'],
    datasets: [{ label: 'Líneas', data: [E.lineas, E.dif1, E.a2, E.ok2, E.a3, E.ok3, E.finalDif],
      backgroundColor: ['--blue', '--red', '--slate', '--teal', '--yellow', '--teal', '--red'].map(css), borderRadius: 4, borderSkipped: false, maxBarThickness: 22 }]
  };
  const csv = () => descargar([['Fecha', 'CD', 'Ubicación', 'SKU', 'Sistema', ...cols.map((n) => `${n}ª pasada`), 'Pasadas', 'Diferencia final', 'Resultado', 'Requiere supervisor', 'Turno', 'Usuarios'],
    ...detalle.map((x) => [x.fecha, x.cd, x.ubicacion, x.sku, x.sistema, ...cols.map((n) => x.c[n] ?? ''), x.pasadas, x.dif, x.estado, x.sup ? 'SI' : 'NO', x.turno, x.usuario])], `validacion_toma_${r.desde}_${r.hasta}.csv`);
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
        <label className="field" style={{ width: 'auto' }}><span>Zona</span><select value={filtro.zona} onChange={set('zona')} title="Las 3 primeras letras de la ubicación">
          <option value="">Todas</option>{(r.zonas || []).map((z) => <option key={z}>{z}</option>)}{filtro.zona && !(r.zonas || []).includes(filtro.zona) && <option>{filtro.zona}</option>}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Turno</span><select value={filtro.turno} onChange={set('turno')}><option value="">Todos</option>{r.turnos.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" style={{ width: 'auto' }}><span>Empresa</span><select value={filtro.empresa} onChange={set('empresa')}><option value="">Todas</option>{r.empresas.map((c) => <option key={c}>{c}</option>)}</select></label>
        {(filtro.desde || filtro.cd || filtro.zona || filtro.turno || filtro.empresa) && <button type="button" className="ghost" onClick={() => setFiltro({ desde: '', hasta: '', cd: '', zona: '', turno: '', empresa: '' })}>Quitar filtros</button>}
      </div>

      {!P.length ? <p className="empty">Sin tomas entre el {dmy(r.desde)} y el {dmy(r.hasta)} con estos filtros.</p> : <>
        <div className="val-tarjetas">
          {[...new Set([1, 2, 3, ...P.map((p) => p.conteo)])].map((n) => { const p = P.find((x) => x.conteo === n); return <Tarjeta key={n} titulo={nombre(n)} c={color(n)} x={p?.tot} />; })}
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

        {r.match && <Match m={r.match} desde={r.desde} hasta={r.hasta} />}

        <Card title="Detalle por ubicación y SKU" hint={`Todas las líneas del archivo (ubicación y SKU por día) con lo que dio cada pasada; en rojo, el conteo que no coincide con el sistema. ${N(r.totalDetalle)} líneas${buscar ? ` con «${buscar}»` : ''}${r.totalDetalle > r.detalle.length ? ` (el CSV trae las primeras ${N(r.detalle.length)}; usa los filtros o la búsqueda para acotar)` : ''}.`}
          actions={<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input type="search" aria-label="Buscar ubicación o SKU" placeholder="Ubicación o SKU (Enter)" value={busca} style={{ width: 200 }}
              onChange={(e) => { setBusca(e.target.value); if (!e.target.value) setBuscar(''); }} onKeyDown={(e) => e.key === 'Enter' && setBuscar(busca.trim())} onBlur={() => setBuscar(busca.trim())} />
            <Seg label="Ver" valor={verDet} onChange={setVerDet} opciones={[['todo', 'Todo'], ['dif', 'Siguen con diferencia'], ['ok', 'Cuadraron al re-contar'], ['ok1', 'Cuadraron en la 1ª'], ['sup', 'Requieren supervisor']]
              .map(([v, t]) => [v, ct[v] !== undefined ? `${t} (${N(ct[v])})` : t])} />
            <button type="button" className="ghost" onClick={csv} disabled={!detalle.length}>Descargar CSV</button></div>}>
          {detalle.length ? <div className="tscroll val-det" style={{ maxHeight: 520, overflow: 'auto' }}><table>
            <thead><tr><th>Fecha</th><th>CD</th><th>Ubicación</th><th>SKU</th><th className="num">Sistema</th>{cols.map((n) => <th key={n} className="num">{n}ª</th>)}<th className="num">Dif. final</th><th>Resultado</th><th>Turno</th><th>Usuarios</th></tr></thead>
            <tbody>{detalle.slice(0, 500).map((x) => (
              <tr key={`${x.fecha}|${x.cd}|${x.ubicacion}|${x.sku}`}>
                <td>{dm(x.fecha)}</td><td>{x.cd}</td><td>{x.ubicacion}</td><td>{x.sku}</td><td className="num">{N(x.sistema)}</td>
                {cols.map((n) => <td key={n} className="num">{pc(x.c[n] ?? null, x.sistema)}</td>)}
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
