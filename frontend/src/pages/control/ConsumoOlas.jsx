// Simulador de olas: consumo de la ola filtrada contra el stock de la Base vigente en cada CD (por CD, clase ABC y depto)
// y decisión de reabastecer el OSR al inicio del turno, con la lista de SKU a subir y desde dónde sacarlos.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Kpis, Card, Cargando } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, css, dmy } from '../../lib/fmt.js';
import { TablaOrden, Barra } from './Recepcion.jsx';

const COLOR_CLASE = { A: '--teal', B: '--yellow', C: '--red' };
const MOTIVO = { 'FALTA EN OSR': ['Falta en OSR', '--red'], 'BAJO EL MINIMO EN OSR': ['Bajo el mínimo', '--yellow'], 'Y PICKEADO FUERA DE OSR': ['"Y" fuera de OSR', '--blue'] };
const Pill = ({ m }) => { const [t, c] = MOTIVO[m] || [m, '--muted']; return <span className="pill" style={{ background: `color-mix(in srgb,var(${c}) 22%,transparent)` }}>{t}</span>; };

function csv(lista, osr) {
  const c = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const filas = [['SKU', 'Descripción', 'Depto', 'Clase', 'Motivo', `Demanda ${osr}`, `Stock ${osr}`, 'Demanda otros CD', 'Necesita', 'Stock otros CD', 'Sugerido', 'Sin cubrir', 'CD origen', 'Ubicación', 'Unidades a extraer']];
  for (const x of lista) {
    const base = [x.sku, x.desc, x.depto, x.matriz || x.abc, MOTIVO[x.motivo]?.[0] || x.motivo, x.demOsr, x.stockOsr, x.demFuera, x.necesita, x.stockFuera, x.sugerido, x.noCubre];
    if (x.desde.length) x.desde.forEach((d) => filas.push([...base, d.cd, d.ubic, d.qty])); else filas.push([...base, '', '', '']);
  }
  const blob = new Blob(['﻿' + filas.map((r) => r.map(c).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'reabasto-osr-ola.csv' });
  a.click(); URL.revokeObjectURL(a.href);
}

export default function ConsumoOlas({ filtros, cargaId }) {
  const [minOsr, setMinOsr] = useState('');
  const [incluirY, setIncluirY] = useState(false);
  const [ver, setVer] = useState(() => { try { return localStorage.getItem('olasConsumoVer') || 'u'; } catch { return 'u'; } });
  const elegir = (v) => { setVer(v); try { localStorage.setItem('olasConsumoVer', v); } catch { /* sin almacenamiento */ } };
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const fj = JSON.stringify(filtros);
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => api.post('/olas/consumo', { filtros, minOsr: Number(minOsr) || 0, incluirY })
      .then((d) => { if (vivo) { setR(d); setErr(null); } }).catch((e) => vivo && setErr(e.message)), 250);
    return () => { vivo = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fj, minOsr, incluirY, cargaId]);

  const titulo = 'Consumo de la ola vs stock en cada CD';
  if (!r) return <Card title={titulo}><Cargando error={err} /></Card>;
  if (!r.hayBase) return <Card title={titulo}><p className="empty">{r.mensaje} El cruce usa la Base de stock vigente: <Link to="/cargas#carga-stock">cárgala en Datos</Link>.</p></Card>;

  const t = r.tot, R = r.reabasto, osr = r.osr;
  const cdsDem = r.cds;
  // ver por unidades (u) o por SKU (sku): en SKU, un SKU que se pickea en dos CD cuenta en ambos
  const porSku = ver === 'sku';
  const totSkuCd = r.porCd.reduce((a, x) => a + x.skus, 0);
  const skusFalta = r.porCd.reduce((a, x) => a + x.skusFalta, 0);
  const porCd = r.porCd.map((x) => ({ ...x, part: porSku ? (totSkuCd ? x.skus / totSkuCd : 0) : t.demanda ? x.demanda / t.demanda : 0 }));
  const deptos = r.porDepto.map((d) => {
    const m = porSku ? d.skuCd : d.porCd, tot = Object.values(m).reduce((a, b) => a + b, 0);
    return { ...d, ...Object.fromEntries(cdsDem.map((c) => [`cd_${c}`, m[c] || 0])), dem: porSku ? d.skus : d.demanda, falta: porSku ? d.skusFalta : d.faltante, pOsr: tot ? (m[osr] || 0) / tot : 0 };
  });
  const rojo = (v) => (v ? <b style={{ color: 'var(--red)' }}>{N(v)}</b> : '—');
  const cob = (v) => <b style={{ color: v < 1 ? 'var(--red)' : undefined }}>{pctf(v)}</b>;
  const colsCd = porSku
    ? [['skus', 'SKU', true, N], ['part', '% de los SKU', true, (v) => <Barra v={v} color="--blue" />], ['skusConStock', 'SKU con stock en el CD', true, N],
      ['coberturaSku', 'Cobertura', true, cob], ['skusFalta', 'SKU con faltante', true, rojo], ['sinStock', 'SKU sin stock', true, rojo]]
    : [['demanda', 'Demanda', true, N], ['part', '% de la ola', true, (v) => <Barra v={v} color="--blue" />], ['skus', 'SKU', true, N],
      ['stock', 'Stock del CD', true, N], ['cobertura', 'Cobertura', true, cob], ['faltante', 'Faltante', true, rojo], ['skusFalta', 'SKU con faltante', true, (v) => (v ? N(v) : '—')]];
  return (
    <Card title={titulo} hint={`Cruza lo que la ola (con los filtros de arriba) pickea en cada CD con el stock de la Base vigente (${r.base.archivo}, jornada ${dmy(r.base.fecha)}). Úsalo al inicio del turno para decidir si hay que reabastecer ${osr}.`}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <div><span className="hint" style={{ display: 'block', marginBottom: 4 }}>Ver por</span>
          <div className="row" role="group" aria-label="Ver por unidades o por SKU" style={{ gap: 4 }}>
            {[['u', 'Unidades'], ['sku', 'SKU']].map(([k, l]) => <button key={k} type="button" aria-pressed={ver === k} className={ver === k ? 'btn' : 'ghost'} onClick={() => elegir(k)}>{l}</button>)}
          </div></div>
        <label className="field" style={{ width: 'auto' }}><span>Stock mínimo en {osr} por SKU después de la ola</span>
          <input type="number" min="0" placeholder="0" value={minOsr} onChange={(e) => setMinOsr(e.target.value)} style={{ width: 110 }} /></label>
        <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
          <input type="checkbox" checked={incluirY} onChange={(e) => setIncluirY(e.target.checked)} />
          Incluir SKU con Logística OSR = "Y" que la ola pickea en otros CD ({N(R.y.skus)} SKU, {N(R.y.unidades)} u.)</label>
      </div>

      <div className={`msg ${R.necesario ? 'err' : ''}`} role="status" style={{ marginBottom: 12, fontWeight: 600 }}>
        {R.necesario
          ? `Reabastecer ${osr}: ${N(R.skus)} SKU que se pickean en ${osr} no tienen stock suficiente allí${r.minOsr ? ` (con mínimo de ${N(r.minOsr)} u.)` : ''}. Hay que subir ${N(R.unidades)} u.: ${N(R.sugerido)} se pueden traer de otros CD desde ${N(R.ubicaciones)} ubicaciones${R.noCubre ? ` y ${N(R.noCubre)} u. no tienen stock en ningún CD` : ''}.`
          : `No hace falta reabastecer ${osr} para esta ola: su stock cubre lo que se pickea ahí${r.minOsr ? ` dejando al menos ${N(r.minOsr)} u. por SKU` : ''}.${R.y.skus ? ` Oportunidad: ${N(R.y.skus)} SKU "Y" (${N(R.y.unidades)} u.) se pickean en otros CD y podrían subir a ${osr}.` : ''}`}
      </div>

      <Kpis items={[
        ['Demanda de la ola', porSku ? <>{N(t.skus)} <small>SKU · {N(t.demanda)} u.</small></> : <>{N(t.demanda)} <small>u. · {N(t.skus)} SKU</small></>],
        ['Cubierta con stock del CD que pickea', pctf(porSku ? (totSkuCd ? (totSkuCd - skusFalta) / totSkuCd : null) : t.cobertura), t.cobertura < 0.98 ? 'warn' : 'ok'],
        ['Faltante', porSku ? <>{N(skusFalta)} <small>SKU · {N(t.faltante)} u.</small></> : <>{N(t.faltante)} <small>u. · {N(skusFalta)} SKU</small></>, t.faltante ? 'warn' : ''],
        ['SKU sin stock en la Base', N(t.sinBase), t.sinBase ? 'warn' : ''],
        [`A subir a ${osr}`, porSku ? <>{N(R.skus)} <small>SKU · {N(R.sugerido)} u.</small></> : <>{N(R.sugerido)} <small>u. · {N(R.skus)} SKU</small></>, R.necesario ? 'warn' : 'ok'],
        [`"Y" pickeados fuera de ${osr}`, porSku ? <>{N(R.y.skus)} <small>SKU · {N(R.y.unidades)} u.</small></> : <>{N(R.y.unidades)} <small>u. · {N(R.y.skus)} SKU</small></>]]} />

      <div className="grid">
        <div className="s7">
          <h3 style={{ margin: '4px 0 6px' }}>Por CD</h3>
          <TablaOrden key={ver} filas={porCd} inicial={[porSku ? 'skus' : 'demanda', -1]} clave={(x) => x.cd} cols={[
            ['cd', 'CD', false, (v) => (v === 'SIN CD' ? <span title="Líneas de la ola sin CD de picking asignado">Sin CD asignado</span> : <b>{v}</b>)],
            ...colsCd]} />
          <p className="hint" style={{ marginTop: 6 }}>{porSku ? 'Un SKU que la ola pickea en dos CD cuenta en ambos. SKU con faltante = su stock en el CD no alcanza para lo que se pickea ahí.' : 'Stock del CD = stock en ese CD de los SKU que la ola pickea ahí.'} Para "Sin CD asignado" se compara con el stock en todos los CD.</p>
        </div>
        <div className="s5">
          <h3 style={{ margin: '4px 0 6px' }}>{porSku ? 'SKU' : 'Unidades'} por CD y clase ABC</h3>
          <Grafico apilado alto={240} label={`${porSku ? 'SKU' : 'Unidades'} de la ola por CD y clase ABC`} datos={{
            labels: cdsDem.map((c) => (c === 'SIN CD' ? 'Sin CD' : c)),
            datasets: r.porClase.slice().sort((a, b) => a.v.localeCompare(b.v)).map((g) => ({ label: `Clase ${g.v}`, data: cdsDem.map((c) => (porSku ? g.skuCd : g.porCd)[c] || 0), backgroundColor: css(COLOR_CLASE[g.v] || '--muted'), borderRadius: 2 }))
          }} />
        </div>
      </div>

      <h3 style={{ margin: '14px 0 6px' }}>Por departamento</h3>
      <TablaOrden key={ver} filas={deptos} inicial={['dem', -1]} max={15} clave={(x) => x.v} cols={[
        ['v', 'Depto'], ['dem', porSku ? 'SKU' : 'Demanda', true, N],
        ...cdsDem.map((c) => [`cd_${c}`, c === 'SIN CD' ? 'Sin CD' : c, true, (v) => (v ? N(v) : <span className="muted">—</span>)]),
        ['pOsr', `% en ${osr}`, true, pctf], ['falta', porSku ? 'SKU con faltante' : 'Faltante', true, rojo],
        porSku ? ['faltante', 'Unid. faltantes', true, (v) => (v ? N(v) : '—')] : ['skusFalta', 'SKU con faltante', true, (v) => (v ? N(v) : '—')]]} />

      <div className="row spread" style={{ margin: '16px 0 6px', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>SKU a reabastecer en {osr}{R.total ? ` (${N(R.total)})` : ''}</h3>
        {R.lista.length > 0 && <button type="button" className="ghost" onClick={() => csv(R.lista, osr)}>Descargar CSV</button>}
      </div>
      {R.lista.length ? <>
        <TablaOrden filas={R.lista} inicial={['necesita', -1]} max={40} clave={(x) => x.sku} cols={[
          ['sku', 'SKU'], ['desc', 'Descripción'], ['depto', 'Depto'], ['matriz', 'Clase', false, (v, x) => v || x.abc],
          ['motivo', 'Motivo', false, (v) => <Pill m={v} />], ['demOsr', `Demanda ${osr}`, true, N], ['stockOsr', `Stock ${osr}`, true, N],
          ['demFuera', 'Demanda otros CD', true, (v) => (v ? N(v) : '—')], ['necesita', 'Necesita', true, (v) => <b>{N(v)}</b>],
          ['stockFuera', 'Stock otros CD', true, N], ['sugerido', 'Sugerido', true, (v) => <b>{N(v)}</b>],
          ['noCubre', 'Sin cubrir', true, (v) => (v ? <b style={{ color: 'var(--red)' }}>{N(v)}</b> : '—')],
          ['desde', 'Desde (CD · ubicación · u.)', false, (v) => v.length ? v.map((d) => <div key={d.cd + d.ubic} style={{ whiteSpace: 'nowrap' }}><span className="muted">{d.cd}</span> {d.ubic} <b>{N(d.qty)}</b></div>) : '—']]} />
        {R.total > R.lista.length && <p className="hint">Se muestran {N(R.lista.length)} de {N(R.total)} SKU.</p>}
      </> : <p className="empty">{incluirY ? `No hay SKU por subir a ${osr} con estos filtros.` : `Ningún SKU que se pickea en ${osr} queda sin stock. Marca la casilla para ver los SKU "Y" que se pickean en otros CD.`}</p>}
      <p className="hint" style={{ marginTop: 8 }}>Necesita = demanda en {osr} + mínimo − stock en {osr} (para los "Y" fuera de {osr}: lo que la ola pickea en otros CD). Sugerido = lo que se puede traer con el stock de otros CD, empezando por las ubicaciones con más unidades.</p>
    </Card>
  );
}
