// Sloting → OSR y headcount: cuánto picking sale del OSR y cuánto de los demás CD (picking manual), con los operarios
// que pide cada lado, y la sugerencia para subir la participación del OSR con SKU de Logística OSR = Y y bajar headcount.
// Usa la venta cargada en Participación por CD (archivo de pedidos/despachos).
import React, { useState } from 'react';
import { api, fmt, pct, fFecha } from './api.js';
import { IrACarga, toast } from './ui.jsx';
import SugerenciaOsr from './SugerenciaOsr.jsx';
import { NOM_TEMP } from './ParticipacionCd.jsx';

const TIPOS = [['TAREA', 'Tarea'], ['ETIQUETA', 'Etiqueta'], ['TODOS', 'Ambos']];
const SUB_LOG = { Y: 'SKU "Y" (aptos para OSR)', NO: 'SKU no aptos (N, REVISION…)', SIN: 'SKU que no están en la Base' };
const LECT_LOG = {
  Y: 'Pueden ir al OSR: lo que de ellos se pickea fuera es la oportunidad directa de bajar headcount.',
  NO: 'Hoy no pueden ir al OSR (N, REVISION): habría que validar medidas y peso para tote.',
  SIN: 'Tienen venta pero no están en la Base de stock cargada: no se puede validar su Logística OSR.',
};

const DSEM = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
const diaCorto = (iso) => `${DSEM[new Date(iso + 'T12:00:00').getDay()]} ${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

/** Líneas por día: OSR y fuera del OSR. Las líneas van en SVG estirado; puntos, ejes y textos en HTML para que no se deformen. */
function PorDia({ dias, med, cdOsr }) {
  const [h, setH] = useState(null);
  const k = med === 'u' ? ['osrU', 'fueraU'] : ['osrL', 'fueraL'];
  const n = dias.length || 1;
  const max = Math.max(1, ...dias.flatMap((d) => [d[k[0]], d[k[1]]])) * 1.08;
  const W = 1000, H = 200;
  const x = (i) => ((i + 0.5) / n) * W;
  const y = (v) => H - (v / max) * H;
  const linea = (c) => dias.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[c]).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => (t * max) / 1.08);
  const paso = Math.max(1, Math.ceil(n / 16));
  const d = h !== null ? dias[h] : null;
  const unid = med === 'u' ? 'u.' : 'líneas';
  const pos = (i) => `${((i + 0.5) / n) * 100}%`;
  return (
    <div className="ho-dia">
      <div className="ho-lee" aria-live="polite">
        {d ? <><b>{diaCorto(d.fecha)}</b> · {cdOsr} {fmt(d[k[0]])} {unid} ({pct(d.pct)}) · fuera {fmt(d[k[1]])} {unid}</>
          : <span className="muted">Pasa el mouse sobre un día para ver el detalle.</span>}
      </div>
      <div className="ho-plot">
        <div className="ho-y">{ticks.map((t, i) => <span key={i} style={{ bottom: `${(t / max) * 100}%` }}>{fmt(t)}</span>)}</div>
        <div className="ho-area" onMouseLeave={() => setH(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Picking por día en ${unid}: ${cdOsr} y fuera del OSR`}>
            {ticks.map((t, i) => <line key={i} x1="0" x2={W} y1={y(t)} y2={y(t)} className="ho-grid" />)}
            {h !== null && <line x1={x(h)} x2={x(h)} y1="0" y2={H} className="ho-cruz" />}
            <path d={linea(k[1])} className="ho-l ho-l2" />
            <path d={linea(k[0])} className="ho-l ho-l1" />
            {dias.map((dd, i) => <rect key={dd.fecha} x={(i / n) * W} y="0" width={W / n} height={H} fill="transparent" onMouseEnter={() => setH(i)} />)}
          </svg>
          {n <= 45 && dias.map((dd, i) => <React.Fragment key={dd.fecha}>
            <i className="ho-pt ho-p1" style={{ left: pos(i), bottom: `${(dd[k[0]] / max) * 100}%` }} data-on={h === i || undefined} />
            <i className="ho-pt ho-p2" style={{ left: pos(i), bottom: `${(dd[k[1]] / max) * 100}%` }} data-on={h === i || undefined} />
          </React.Fragment>)}
          {n > 45 && h !== null && <>
            <i className="ho-pt ho-p1" data-on style={{ left: pos(h), bottom: `${(d[k[0]] / max) * 100}%` }} />
            <i className="ho-pt ho-p2" data-on style={{ left: pos(h), bottom: `${(d[k[1]] / max) * 100}%` }} />
          </>}
        </div>
        <div className="ho-x">{dias.map((dd, i) => (i % paso === 0 || i === h) &&
          <span key={dd.fecha} style={{ left: pos(i) }} className={i === h ? 'on' : ''}>{diaCorto(dd.fecha)}</span>)}</div>
      </div>
    </div>
  );
}

function Picking({ r }) {
  const [med, setMed] = useState('u');
  const O = r.osr, F = r.fuera;
  const y = r.porLog.find((g) => g.log === 'Y');
  // apertura de lo que sale fuera del OSR por Logística OSR (cuando el filtro deja más de un grupo)
  const grupos = r.porLog.filter((g) => g.incluida && g.fuera.u > 0);
  const abrir = grupos.length > 1;

  return (
    <>
      <div className="row spread" style={{ margin: '18px 0 8px', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>Picking desde el OSR vs fuera del OSR</h3>
          <p className="note" style={{ margin: '4px 0 0' }}>{r.dias} días de venta · {r.filtraLog ? (r.logOsr === 'Y' ? 'solo SKU con Logística OSR = "Y"' : 'solo SKU sin "Y" (N, REVISION y sin Base)') : 'todos los SKU'} · el picking fuera del OSR es manual.</p>
        </div>
      </div>
      <table className="ho-res">
        <thead><tr><th /><th className="num">Unidades por día</th><th className="num">% de las unidades</th><th className="num">Líneas por día</th><th className="num">SKU</th></tr></thead>
        <tbody>
          <tr><td><i className="so-pt" style={{ background: 'var(--s1)' }} />Desde {r.cdOsr}</td><td className="num"><b>{fmt(O.uDia)}</b></td><td className="num">{pct(r.total.pct)}</td><td className="num">{fmt(O.lDia)}</td><td className="num">{fmt(O.skus)}</td></tr>
          <tr><td><i className="so-pt" style={{ background: 'var(--s2)' }} />Fuera del OSR (manual)</td><td className="num"><b>{fmt(F.uDia)}</b></td><td className="num">{pct(1 - r.total.pct)}</td><td className="num">{fmt(F.lDia)}</td><td className="num">{fmt(F.skus)}</td></tr>
          {abrir && grupos.map((g) => (
            <tr key={g.log} className={'ho-res-sub ho-res-' + g.log}><td style={{ paddingLeft: 26 }}>de eso, {SUB_LOG[g.log]}</td><td className="num"><b>{fmt(g.fuera.uDia)}</b></td>
              <td className="num">{pct(r.total.uDia ? g.fuera.uDia / r.total.uDia : 0)}</td><td className="num">{fmt(g.fuera.lDia)}</td><td className="num">{fmt(g.fuera.skus)}</td></tr>))}
          <tr className="tot"><td>Total picking</td><td className="num">{fmt(r.total.uDia)}</td><td className="num">100%</td><td className="num">{fmt(r.total.lDia)}</td><td className="num">{fmt(r.total.skus)}</td></tr>
        </tbody>
      </table>
      <p className="note">Promedio por día de {r.dias} días. El % de cada fila es sobre el total de unidades. {abrir ? 'Los no aptos necesitan validar medidas y peso para tote antes de ir al OSR; los que no están en la Base no se pueden validar. ' : ''}Un SKU que se pickea en el OSR y también en otro CD cuenta en ambas filas; en el total, una sola vez.</p>

      <div className="row spread" style={{ margin: '14px 0 6px', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0 }}>Por día</h4>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <div className="legend"><span className="lg serie-1-f">{r.cdOsr}</span><span className="lg serie-2-f">Fuera del OSR</span></div>
          <div className="chips">{[['u', 'Unidades'], ['l', 'Líneas']].map(([v, t]) => <button key={v} className="chip" aria-pressed={med === v} onClick={() => setMed(v)}>{t}</button>)}</div>
        </div>
      </div>
      <PorDia dias={r.porDia} med={med} cdOsr={r.cdOsr} />

      <div className="viz-row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', marginTop: 14 }}>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Por CD</h4>
          <table>
            <thead><tr><th>CD</th><th className="num">u./día</th><th className="num">% unid.</th><th className="num">Líneas/día</th><th className="num">% líneas</th><th className="num">SKU</th></tr></thead>
            <tbody>
              {r.porCd.map((c) => (
                <tr key={c.cd} className={c.osr ? 'sel' : ''}>
                  <td><i className="so-pt" style={{ background: `var(${c.osr ? '--s1' : '--s2'})` }} />{c.osr ? <b>{c.cd}</b> : c.cd}</td>
                  <td className="num">{fmt(c.uDia)}</td><td className="num">{pct(c.pct)}</td><td className="num">{fmt(c.lDia)}</td><td className="num">{pct(c.pctL)}</td>
                  <td className="num">{fmt(c.skus)}</td>
                </tr>))}
              <tr className="tot"><td>Total</td><td className="num">{fmt(r.total.uDia)}</td><td className="num">100%</td><td className="num">{fmt(r.total.lDia)}</td><td className="num">100%</td><td /></tr>
            </tbody>
          </table>
          <p className="note">u./día y líneas/día = total del período ÷ {r.dias} días con venta.</p>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Por Logística OSR</h4>
          <table>
            <thead><tr><th>Logística OSR</th><th className="num">SKU</th><th className="num">OSR u./día</th><th className="num">Fuera u./día</th><th className="num">% OSR</th><th className="num">Fuera líneas/día</th></tr></thead>
            <tbody>{r.porLog.map((g) => (
              <tr key={g.log} className={g.log === 'Y' ? 'sel' : ''} title={g.incluida ? LECT_LOG[g.log] : 'Fuera del análisis por el filtro de Logística OSR'} style={{ opacity: g.incluida ? 1 : 0.5 }}>
                <td>{g.nom}<div className="note" style={{ margin: 0 }}>{pct(g.pctTotal)} de la venta</div></td><td className="num">{fmt(g.skus)}</td>
                <td className="num">{fmt(g.osr.uDia)}</td><td className="num"><b>{fmt(g.fuera.uDia)}</b></td><td className="num">{pct(g.pct)}</td><td className="num">{fmt(g.fuera.lDia)}</td>
              </tr>))}</tbody>
          </table>
          <p className="note">{y ? <>De los SKU con Logística OSR = Y, <b>{pct(1 - y.pct)}</b> de sus unidades todavía se pickea a mano en otros CD ({fmt(y.fuera.uDia)} u./día, {fmt(y.fuera.skus)} SKU). Llevarlos al OSR sube la participación sin habilitar SKU nuevos; la sugerencia de abajo dice cuáles, en qué orden y cuánto espacio piden. </> : ''}
            Los sin Y y los que no están en la Base solo suman habilitándolos.</p>
        </div>
      </div>
    </>
  );
}

export default function HeadcountOsr() {
  const [f, setF] = useState({ tipo: 'TAREA', desde: '', hasta: '', target: '', excluir: [], soloOsr: false, temporada: 'AUTO', logOsr: 'Y' });
  const [r, setR] = useState(null);
  const [cargando, setCargando] = useState(false);
  const cuerpo = { ...f, cd: '', modo: 'total', depto: '', estado: '', target: f.target === '' ? '' : Number(f.target) / 100 };
  React.useEffect(() => {
    setCargando(true);
    const t = setTimeout(() => api.post('/api/participacion/picking', cuerpo).then(setR).catch((e) => toast(e.message, true)).finally(() => setCargando(false)), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const altCd = (c) => setF({ ...f, excluir: f.excluir.includes(c) ? f.excluir.filter((x) => x !== c) : [...f.excluir, c] });
  const tSel = f.temporada === 'AUTO' ? (r?.temporada?.sel || []) : f.temporada.split(',').filter(Boolean);
  const altTemp = (t) => {
    const base = f.temporada === 'AUTO' ? (r?.temporada?.sel || []) : tSel.length ? tSel : ['T', 'V', 'I', 'SIN'];
    const n = base.includes(t) ? base.filter((x) => x !== t) : [...base, t];
    set('temporada')(n.length === 4 || !n.length ? '' : n.join(','));
  };
  const info = r?.info;

  return (
    <>
      <div className="top"><h1>OSR y headcount</h1></div>
      <div className="sec">
        {r?.sinDatos && <div className="alert">No hay venta cargada. Carga el archivo de pedidos / despachos: <IrACarga id="venta" etiqueta="Cargar venta (en Datos)" /></div>}
        {info?.registros > 0 && (
          <>
            <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div className="lbl">Tipo de picking</div>
                <div className="chips">{TIPOS.map(([k, t]) => <button key={k} className="chip" aria-pressed={f.tipo === k} onClick={() => set('tipo')(k)}>{t}</button>)}</div>
              </div>
              <div><label className="lbl" htmlFor="ho-desde">Desde</label><input id="ho-desde" type="date" value={f.desde} min={info.desde || undefined} max={info.hasta || undefined} onChange={(e) => set('desde')(e.target.value)} /></div>
              <div><label className="lbl" htmlFor="ho-hasta">Hasta</label><input id="ho-hasta" type="date" value={f.hasta} min={info.desde || undefined} max={info.hasta || undefined} onChange={(e) => set('hasta')(e.target.value)} /></div>
              <div>
                <div className="lbl">Temporada</div>
                <div className="chips">
                  <button className="chip" aria-pressed={f.temporada === 'AUTO'} onClick={() => set('temporada')('AUTO')}
                    title={`Toda temporada + la temporada que corre (meses de verano: ${r.temporada?.mesesVerano}). Incluye los SKU sin temporada.`}>
                    Según la fecha{r.temporada ? ` (T + ${NOM_TEMP[r.temporada.actual]})` : ''}</button>
                  <button className="chip" aria-pressed={f.temporada === ''} onClick={() => set('temporada')('')}>Todas</button>
                  {['T', 'V', 'I', 'SIN'].map((t) => <button key={t} className="chip" aria-pressed={f.temporada !== 'AUTO' && f.temporada !== '' && tSel.includes(t)} onClick={() => altTemp(t)}>{NOM_TEMP[t]}</button>)}
                </div>
              </div>
              <div>
                <div className="lbl">Logística OSR</div>
                <div className="chips">{[['', 'Todos'], ['Y', 'Solo "Y"'], ['NOY', 'Sin "Y"']].map(([k, t]) => (
                  <button key={k} className="chip" aria-pressed={f.logOsr === k} onClick={() => set('logOsr')(k)}
                    title={k === 'Y' ? 'Solo SKU con Logística OSR = Y en la Base: los que pueden ir al OSR (comparativo, target y sugerencia)' : k === 'NOY' ? 'SKU con N, REVISION u otro valor, y los que no están en la Base' : 'Sin filtro de Logística OSR'}>{t}</button>))}</div>
              </div>
              <label className="inline" style={{ fontSize: 13 }}><input type="checkbox" checked={f.soloOsr} onChange={(e) => set('soloOsr')(e.target.checked)} /> Solo deptos OSR</label>
              {cargando && <span className="note">Calculando…</span>}
            </div>
            <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span className="lbl" style={{ margin: 0 }}>CD que entran</span>
              <div className="chips">{info.cds.map((c) => <button key={c} className="chip" aria-pressed={!f.excluir.includes(c)} onClick={() => altCd(c)}>{c}</button>)}</div>
            </div>
            <p className="note">Venta cargada: {fFecha(info.desde)} al {fFecha(info.hasta)} · {info.dias} días · {fmt(info.unidades)} unidades. Se carga y se analiza por CD en Participación por CD.</p>

            {r.osr && <Picking r={r} />}

            <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div><label className="lbl" htmlFor="ho-target">Target {r.cdOsr || 'OSR'} %</label><input id="ho-target" type="number" className="w90" min="0" max="100" step="1" placeholder="parámetro" value={f.target} onChange={(e) => set('target')(e.target.value)} /></div>
            </div>
            <SugerenciaOsr cuerpo={cuerpo} />
          </>
        )}
      </div>
    </>
  );
}
