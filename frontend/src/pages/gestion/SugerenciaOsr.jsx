// Sugerencia de aumento de la participación del OSR (Participación por CD): qué SKU ingresar o ampliar en OSR, cuántas
// ubicaciones nuevas en tote half / quarter hacen falta, si caben en el OSR y cuántos operarios de picking manual se liberan
// en los demás CD. Usa los mismos filtros de la simulación de arriba.
import React, { useState } from 'react';
import { api, fmt, pct } from './api.js';
import { toast } from './ui.jsx';

const tono = (m) => 'm-' + ('ABC'.indexOf(m[0]) + 'XYZ'.indexOf(m[1]));
const SERIE = ['--s1', '--s2', '--s3', '--muted', '--warn'];
const ESPACIO = {
  OK: ['good', 'Cabe en posiciones libres'],
  'CON REEMPAQUE': ['warn', 'Cabe reempacando el OSR'],
  'SOBRE LA META': ['warn', 'Sobre la ocupación máxima'],
  FALTA: ['bad', 'Faltan posiciones'],
  'SIN DATO': ['', 'Sin capacidad cargada'],
};
const ALMAC = [['AUTO', 'Automático'], ['HALF', 'Solo half'], ['QUARTER', 'Solo quarter']];
const OLA = { 1: 'Ingresar', 2: 'Ampliar', 3: 'Habilitar' };
const op = (v) => fmt(v, 1);
const NOM_TEMP = { T: 'Toda temporada', V: 'Verano', I: 'Invierno', SIN: 'Sin temporada' };
const MEDIDAS = [
  ['ubicaciones', 'Ubicaciones nuevas', (a) => fmt(a.ubicaciones)],
  ['sel', 'SKU a llevar', (a) => fmt(a.sel)],
  ['uDia', 'u./día a OSR', (a) => fmt(a.uDia)],
  ['opManual', 'Headcount liberado', (a) => op(a.opManual)],
];

/** Matriz ABC/XYZ de la propuesta: cada celda con su participación OSR hoy → propuesta y la medida elegida (color por su peso). */
function MatrizSug({ m, total }) {
  const [med, setMed] = useState('ubicaciones');
  const [, nomMed, fmtMed] = MEDIDAS.find((x) => x[0] === med);
  const de = new Map(m.map((a) => [a.clave, a]));
  const max = Math.max(1e-9, ...m.map((a) => a[med]));
  const sc = de.get('SC');
  const top = [...m].filter((a) => a[med] > 0).sort((a, b) => b[med] - a[med])[0];
  return (
    <div>
      <div className="row spread" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Matriz ABC/XYZ de la propuesta</h4>
        <div className="chips">{MEDIDAS.map(([k, t]) => <button key={k} className="chip" aria-pressed={med === k} onClick={() => setMed(k)}>{t}</button>)}</div>
      </div>
      <div className="so-mtx" role="table" aria-label={`Matriz ABC/XYZ: ${nomMed}`}>
        <div role="row" className="so-mtx-f"><span /><b>X <small>estable</small></b><b>Y <small>variable</small></b><b>Z <small>errática</small></b></div>
        {['A', 'B', 'C'].map((f) => (
          <div role="row" className="so-mtx-f" key={f}>
            <b>{f} <small>{f === 'A' ? 'alta venta' : f === 'B' ? 'media' : 'baja'}</small></b>
            {['X', 'Y', 'Z'].map((c) => {
              const a = de.get(f + c);
              if (!a) return <div key={c} className="so-cel vacia">—</div>;
              const w = a[med] / max;
              return (
                <div key={c} role="cell" className="so-cel" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(8 + w * 52)}%, var(--panel))` }}
                  title={`${f + c}: ${fmt(a.skus)} SKU con venta · ${fmt(a.sel)} a llevar · ${fmt(a.ubicaciones)} ubicaciones (${fmt(a.quarter)} quarter, ${fmt(a.half)} half, ${fmt(a.enteros)} enteros) · ${fmt(a.totes)} totes · ${fmt(a.uDia)} u./día · −${op(a.opManual)} operarios-turno/día`}>
                  <span className="so-cel-c">{f + c}</span>
                  <span className="so-cel-v">{fmtMed(a)}</span>
                  <span className="so-cel-p">OSR {pct(a.pct)} → <b>{pct(a.pctNuevo)}</b></span>
                  <span className="so-cel-n">{pct(a.partTotal)} de la venta</span>
                </div>);
            })}
          </div>
        ))}
      </div>
      <p className="note">
        {top && <>Donde más pesa la propuesta en {nomMed.toLowerCase()}: <b>{top.clave === 'SC' ? 'SKU sin clase' : top.clave}</b> ({fmtMed(top)}{total[med] ? `, ${pct(top[med] / total[med])} del total` : ''}). </>}
        Las clases A y X son las de más rotación y venta estable: conviene tenerlas completas en OSR. Las C/Z venden poco y de forma errática: van en quarter y con pocos días de cobertura.
        {sc && sc.sel > 0 ? ` Además, ${fmt(sc.sel)} SKU sin clase ABC/XYZ (${fmt(sc.ubicaciones)} ubicaciones).` : ''}
      </p>
    </div>
  );
}

function descargarCsv(filas, nombre) {
  const t = filas.map((r) => r.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`)).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + t], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function SugerenciaOsr({ cuerpo }) {
  const [c, setC] = useState({ cob: 7, almac: 'AUTO', pickUnHH: '', osrUnHH: '', ocupMax: 85 });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  const body = { ...cuerpo, ...c, ocupMax: Number(c.ocupMax) / 100 };
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/participacion/sugerencia', body).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 400);
    return () => clearTimeout(t);
  }, [JSON.stringify(body)]);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });

  const csv = async () => {
    try {
      const d = await api.post('/api/participacion/sugerencia', { ...body, todos: true });
      descargarCsv([['Ola', 'SKU', 'Descripción', 'Depto', 'Temporada', 'Clase', 'Logística OSR', 'Unid. vendidas en otros CD', 'CD principal', 'Venta/día', `Unid. a tener en OSR (${d.conf.cob} días)`,
        'Stock OSR hoy', 'Stock fuera', 'Unid. que necesitan ubicación nueva', 'Capacidad tote', 'Almacenamiento', 'Half', 'Quarter', 'Enteros', 'Totes'],
      ...d.todos.map((x) => [OLA[x.ola], x.sku, x.desc, x.depto, NOM_TEMP[x.temp] || '', x.matriz, x.log, x.otros, x.cdPrincipal, x.ventaDia, x.necesita, x.stockOsr, x.stockFuera, x.guardar, x.cap, x.almac, x.half, x.quarter, x.enteros, x.totes])],
      `sugerencia_osr_${Math.round(d.target * 100)}.csv`);
    } catch (e) { toast(e.message, true); }
  };

  const enc = (
    <div className="row spread" style={{ margin: '22px 0 8px', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ margin: 0 }}>Sugerencia: subir la participación del OSR para bajar headcount</h3>
        <p className="note" style={{ margin: '4px 0 0' }}>Qué SKU llevar al OSR, cuántas ubicaciones nuevas en tote half y quarter se necesitan y cuántas personas de picking manual se liberan en los demás CD.</p>
      </div>
      {cargando && <span className="note">Calculando…</span>}
    </div>
  );
  if (!r) return enc;
  if (r.sinDatos) return null;
  if (!r.aplica) return <>{enc}<div className="alert info">La sugerencia se calcula para el CD del OSR ({r.osr}). Elige {r.osr} como CD objetivo.</div></>;

  const P = r.propuesta, E = r.espacio, k = r.conf;
  const colCd = new Map(r.porCd.map((x, i) => [x.cd, SERIE[i % SERIE.length]]));
  const [estCls, estTxt] = ESPACIO[P.espacio] || ESPACIO['SIN DATO'];
  const salen = r.porCd.filter((x) => !x.obj && x.sale > 0).sort((a, b) => b.sale - a.sale);
  const opMan = salen.reduce((s, x) => s + x.operarios, 0);
  const meta = r.alcanza ? `el target de ${pct(r.target)}` : `el máximo posible (${pct(P.pct)}; el target de ${pct(r.target)} no se alcanza)`;
  const tile = (t, v, cls, n) => <div className={'kpi ' + (cls || '')}><div className="k">{t}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>;
  const barra = (lbl, campo) => (
    <div className="so-fila">
      <span className="so-lbl">{lbl}</span>
      <div className="so-barra" role="img" aria-label={`${lbl}: ${r.porCd.map((x) => `${x.cd} ${pct(x[campo])}`).join(', ')}`}>
        {r.porCd.map((x) => x[campo] > 0 && (
          <i key={x.cd} style={{ width: `${x[campo] * 100}%`, background: `var(${colCd.get(x.cd)})` }} title={`${x.cd}: ${pct(x[campo])}`}>{x[campo] >= 0.06 ? `${x.cd} ${pct(x[campo])}` : ''}</i>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {enc}
      <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
        <div><label className="lbl" htmlFor="so-cob">Días de cobertura en OSR</label><input id="so-cob" type="number" className="w90" min="1" step="1" value={c.cob} onChange={set('cob')} /></div>
        <div>
          <div className="lbl">Ubicaciones nuevas en</div>
          <div className="chips">{ALMAC.map(([v, t]) => <button key={v} className="chip" aria-pressed={c.almac === v} onClick={() => setC({ ...c, almac: v })}>{t}</button>)}</div>
        </div>
        <div><label className="lbl" htmlFor="so-ocup">Ocupación máx. OSR %</label><input id="so-ocup" type="number" className="w90" min="50" max="100" step="1" value={c.ocupMax} onChange={set('ocupMax')} /></div>
        <div><label className="lbl" htmlFor="so-pick">Picking manual u./HH</label><input id="so-pick" type="number" className="w90" min="1" step="5" placeholder={fmt(k.pickUnHH)} value={c.pickUnHH} onChange={set('pickUnHH')} /></div>
        <div><label className="lbl" htmlFor="so-osr">Estación OSR u./HH</label><input id="so-osr" type="number" className="w90" min="0" step="10" placeholder={fmt(k.osrUnHH)} value={c.osrUnHH} onChange={set('osrUnHH')} /></div>
      </div>

      {P.skus === 0 && r.alcanza ? (
        <div className="alert good">El target de {pct(r.target)} ya se cumple hoy ({pct(r.hoy.pct)}): no hace falta llevar SKU. Los escalones de abajo muestran cuánto más se puede subir y qué cuesta.</div>
      ) : (
      <div className="alert info" style={{ color: 'var(--ink)' }}>
        Para llegar a <b>{meta}</b> hay que llevar al OSR <b>{fmt(P.skus)} SKU</b> ({fmt(P.porOla[0])} nuevos aptos, {fmt(P.porOla[1])} ya en OSR con más stock{P.porOla[2] ? `, ${fmt(P.porOla[2])} a habilitar` : ''}).
        Se necesitan <b>{fmt(P.ubicaciones)} ubicaciones nuevas</b>: {fmt(P.comps.QUARTER)} quarter y {fmt(P.comps.HALF)} half{P.comps.ENTERO ? ` + ${fmt(P.comps.ENTERO)} totes enteros` : ''}, el equivalente a <b>{fmt(P.totes)} totes</b>
        {P.totesEnteros > P.totes ? ` (en totes enteros serían ${fmt(P.totesEnteros)})` : ''}.
        Dejan de pickearse a mano <b>{fmt(P.uDia)} u./día</b>{salen.length ? ` (${salen.map((x) => `${x.cd} ${fmt(x.uDia)}`).join(', ')})` : ''}: <b>{op(opMan)} operarios-turno/día menos</b> en picking manual
        {k.osrUnHH > 0 ? <>, {op(P.opOsr)} más en las estaciones del OSR: <b>neto {op(P.neto)}</b></> : ''}.
      </div>
      )}

      <div className="grid-kpi" style={{ marginTop: 12 }}>
        {tile(`Participación OSR propuesta`, pct(P.pct), r.alcanza ? 'good' : 'warn', `hoy ${pct(r.hoy.pct)} · +${fmt((P.pct - r.hoy.pct) * 100, 1)} puntos`)}
        {tile('Ubicaciones nuevas', fmt(P.ubicaciones), '', `${fmt(P.comps.QUARTER)} quarter · ${fmt(P.comps.HALF)} half · ${fmt(P.comps.ENTERO)} enteros`)}
        {tile('Totes a habilitar', fmt(P.totes), estCls, `${estTxt}${E.cargada ? ` · libres hasta ${pct(E.ocupMax)}: ${fmt(E.hastaMeta)}` : ''}`)}
        {tile('Picking manual que se evita', `${fmt(P.uDia)} u./día`, '', `${fmt(P.mueve)} u. en ${r.dias} días de venta`)}
        {tile('Headcount neto', `−${op(P.neto)}`, P.neto > 0 ? 'good' : '', `operarios-turno/día: −${op(P.opManual)} picking manual${k.osrUnHH > 0 ? ` · +${op(P.opOsr)} OSR` : ''}`)}
      </div>

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)' }}>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Participación por CD: hoy y con la propuesta</h4>
          {barra('Hoy', 'pct')}
          {barra('Propuesta', 'pctNuevo')}
          <div className="so-ley">{r.porCd.map((x) => <span key={x.cd}><i style={{ background: `var(${colCd.get(x.cd)})` }} />{x.cd}</span>)}</div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>CD</th><th className="num">Unid. hoy</th><th className="num">% hoy</th><th className="num">Unid. que pasan a OSR</th><th className="num">% propuesta</th><th className="num">u./día</th><th className="num">Operarios-turno/día</th></tr></thead>
            <tbody>{r.porCd.map((x) => (
              <tr key={x.cd} className={x.obj ? 'sel' : ''}>
                <td><i className="so-pt" style={{ background: `var(${colCd.get(x.cd)})` }} />{x.obj ? <b>{x.cd}</b> : x.cd}</td>
                <td className="num">{fmt(x.u)}</td><td className="num">{pct(x.pct)}</td>
                <td className="num">{x.obj ? `+${fmt(-x.sale)}` : x.sale ? fmt(x.sale) : '—'}</td><td className="num"><b>{pct(x.pctNuevo)}</b></td>
                <td className="num">{x.obj ? `+${fmt(-x.uDia)}` : x.uDia ? fmt(x.uDia) : '—'}</td>
                <td className="num">{x.obj ? (k.osrUnHH > 0 ? `+${op(-x.operarios)}` : '—') : x.operarios ? <b style={{ color: 'var(--good)' }}>−{op(x.operarios)}</b> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="note">Operarios-turno/día = unidades por día ÷ {fmt(k.pickUnHH)} u./HH ÷ {fmt(k.horas)} h por turno{k.osrUnHH > 0 ? `; en el OSR, ÷ ${fmt(k.osrUnHH)} u./HH de las estaciones` : ''}. Los parámetros por defecto están en Configuración.</p>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Espacio en el OSR</h4>
          {E.cargada ? (
            <table>
              <tbody>
                <tr><td>Posiciones (rack lines que cuentan)</td><td className="num">{fmt(E.positions)}</td></tr>
                <tr><td>Ocupadas hoy</td><td className="num">{fmt(E.occupied)} · {pct(E.ocup)}</td></tr>
                <tr><td>Libres hasta la ocupación máx. ({pct(E.ocupMax)})</td><td className="num"><b>{fmt(E.hastaMeta)}</b></td></tr>
                <tr><td>Libres en total</td><td className="num">{fmt(E.libre)}</td></tr>
                <tr><td>Totes que libera reempacar lo que ya está en OSR</td><td className="num">{E.libera === null ? 'sin distribución cargada' : fmt(E.libera)}</td></tr>
                <tr className="tot"><td>Totes que necesita la propuesta</td><td className="num">{fmt(P.totes)}</td></tr>
              </tbody>
            </table>
          ) : <div className="alert warn">Carga la capacidad del OSR por rack line (en Datos) para saber si las ubicaciones nuevas caben.</div>}
          <p className="note">
            <span className={'pill so-' + estCls}>{estTxt}</span>{' '}
            {P.espacio === 'CON REEMPAQUE' && `Con las posiciones libres hasta ${pct(E.ocupMax)} faltan ${fmt(P.sobreLibres)} totes: se obtienen reempacando en half / quarter los SKU que hoy ocupan totes enteros con poco llenado (Abastecimiento OSR → Optimización de totes).`}
            {P.espacio === 'SOBRE LA META' && `Cabe, pero deja el OSR sobre la ocupación máxima de ${pct(E.ocupMax)}.`}
            {P.espacio === 'FALTA' && `Faltan ${fmt(P.faltan)} posiciones aun reempacando: bajar los días de cobertura o el target.`}
            {P.espacio === 'OK' && 'Las ubicaciones nuevas caben en las posiciones libres sin pasar la ocupación máxima.'}
          </p>
          <p className="note">Capacidad de un tote entero: percentil 90 de las unidades por tote de su depto en el OSR ({E.fuenteCap === 'DISTRIBUCION' ? 'distribución FULL / HALF / QUARTER cargada' : 'Base de stock'}; {fmt(E.capGlobal)} u. en general). Un half guarda ½ y un quarter ¼. Cada SKU guarda {fmt(k.cob)} días de su venta.</p>
        </div>
      </div>

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', marginTop: 18 }}>
        <MatrizSug m={r.matriz} total={{ ubicaciones: P.ubicaciones, sel: P.skus, uDia: P.uDia, opManual: P.opManual }} />
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Por temporada</h4>
          <table>
            <thead><tr><th>Temporada</th><th className="num">% OSR hoy</th><th className="num">Propuesta</th><th className="num">SKU a llevar</th><th className="num">Ubicaciones</th><th className="num">Headcount</th></tr></thead>
            <tbody>{r.porTemporada.map((t) => (
              <tr key={t.clave}><td>{t.nom}</td><td className="num">{pct(t.pct)}</td><td className="num"><b>{pct(t.pctNuevo)}</b></td><td className="num">{fmt(t.sel)}</td>
                <td className="num">{fmt(t.ubicaciones)}</td><td className="num">{t.opManual ? `−${op(t.opManual)}` : '—'}</td></tr>))}</tbody>
          </table>
          <p className="note">{r.temporada?.sel?.length
            ? `Analizando: ${r.temporada.sel.map((t) => NOM_TEMP[t]).join(' + ')}${r.temporada.auto ? ' (según la fecha)' : ''}. Se cambia con el filtro Temporada de arriba.`
            : 'Analizando todas las temporadas. Con "Según la fecha" quedan solo toda temporada y la temporada que corre.'}</p>
        </div>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>Escalones de participación</h4>
      <div className="tbl">
        <table>
          <thead><tr><th>Escalón</th><th className="num">% OSR</th><th className="num">SKU</th><th className="num">Ubicaciones nuevas</th><th className="num">Quarter</th><th className="num">Half</th><th className="num">Enteros</th>
            <th className="num">Totes</th><th>Espacio</th><th className="num">u./día que salen de picking manual</th><th className="num">Picking manual</th><th className="num">OSR</th><th className="num">Neto</th></tr></thead>
          <tbody>{r.escalones.map((e, i) => {
            const [cl, tx] = ESPACIO[e.espacio] || ESPACIO['SIN DATO'];
            return (
              <tr key={i} className={e.target ? 'sel' : ''}>
                <td>{e.target ? <b>Target {pct(r.target)}</b> : e.paso ? `Llegar a ${e.paso}` : e.fin === 'aptos' ? 'Todos los aptos (sin habilitar)' : 'Habilitando no aptos'}</td>
                <td className="num"><b>{pct(e.pct)}</b></td>
                <td className="num" title={`${fmt(e.porOla[0])} a ingresar · ${fmt(e.porOla[1])} a ampliar · ${fmt(e.porOla[2])} a habilitar`}>{fmt(e.skus)}</td>
                <td className="num">{fmt(e.ubicaciones)}</td><td className="num">{fmt(e.comps.QUARTER)}</td><td className="num">{fmt(e.comps.HALF)}</td><td className="num">{fmt(e.comps.ENTERO)}</td>
                <td className="num"><b>{fmt(e.totes)}</b></td><td><span className={'pill so-' + cl}>{tx}</span></td>
                <td className="num">{fmt(e.uDia)}</td><td className="num">−{op(e.opManual)}</td><td className="num">{k.osrUnHH > 0 ? `+${op(e.opOsr)}` : '—'}</td><td className="num"><b>−{op(e.neto)}</b></td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <p className="note">Orden: primero lo que más participación suma por tote. Ampliar el stock de un SKU que ya está en OSR casi no pide ubicaciones nuevas. Los SKU de baja venta van al final, en quarter. Los no aptos (Logística OSR N o REVISION) van al último porque hay que validar que quepan en tote. Los últimos puntos de participación cuestan muchas más ubicaciones por persona liberada.</p>

      <div className="row spread" style={{ margin: '18px 0 8px' }}>
        <h4 style={{ margin: 0 }}>SKU de la propuesta · {fmt(r.nSkus)}</h4>
        <button className="btn sm" onClick={csv}>Descargar CSV</button>
      </div>
      <div className="tbl" style={{ maxHeight: 420 }}>
        <table>
          <thead><tr><th>Acción</th><th>Clase</th><th>Temp.</th><th>SKU</th><th>Descripción</th><th className="num">Otros CD</th><th>CD principal</th><th className="num">Venta/día</th><th className="num">Tener en OSR</th>
            <th className="num">Stock OSR</th><th className="num">Stock fuera</th><th>Ubicación nueva</th></tr></thead>
          <tbody>{r.skus.map((x) => (
            <tr key={x.sku}>
              <td>{OLA[x.ola]}</td><td>{x.matriz ? <span className={'pill ' + tono(x.matriz)}>{x.matriz}</span> : '—'}</td><td title={NOM_TEMP[x.temp]}>{x.temp === 'SIN' ? '—' : x.temp}</td><td className="mono">{x.sku}</td>
              <td className="wrap">{x.desc}<div className="note" style={{ margin: 0 }}>{x.depto}</div></td>
              <td className="num"><b>{fmt(x.otros)}</b></td><td>{x.cdPrincipal}</td><td className="num">{fmt(x.ventaDia, 1)}</td><td className="num">{fmt(x.necesita)}</td>
              <td className="num">{x.stockOsr === null ? '—' : fmt(x.stockOsr)}</td>
              <td className="num">{x.stockFuera === null ? '—' : x.stockFuera > 0 ? fmt(x.stockFuera) : <span style={{ color: 'var(--bad)' }}>sin stock</span>}</td>
              <td>{x.almac}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {r.nSkus > r.skus.length && <p className="note">Se muestran {fmt(r.skus.length)} de {fmt(r.nSkus)} SKU; el CSV trae todos.</p>}
    </>
  );
}
