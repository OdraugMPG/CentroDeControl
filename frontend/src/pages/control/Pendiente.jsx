// Almacenamiento: lo pendiente por almacenar (última foto del WMS, una fila por iLPN), con filtros por ZONA, ORIGEN, AÑO, MES,
// DIA, EMPRESA_USUARIO, LEVEL, DESC_DEPTO, TEMPORADA, CD_DESDE y CD. La antigüedad se mide desde FECHA_CREAC hasta la carga.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarga } from '../../lib/contexto.jsx';
import { api } from '../../lib/api.js';
import { Kpis, Card, Cargando, PageHead, Segmentador } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import { N, pctf, css, fechaHora } from '../../lib/fmt.js';
import { TablaOrden, Barra } from './Recepcion.jsx';

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
// orden de las opciones: numérico si todas son números, por mes si son nombres de mes, si no alfabético
const ordenar = (vals) => {
  const n = (v) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : MESES.indexOf(String(v).toUpperCase()) >= 0 ? MESES.indexOf(String(v).toUpperCase()) + 1 : null);
  return vals.every((v) => n(v) !== null) ? vals.slice().sort((a, b) => n(a) - n(b)) : vals.slice().sort((a, b) => a.localeCompare(b));
};
// antigüedad en horas a texto
const edadTxt = (h) => (h === null || h === undefined ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${N(h)} h` : `${(h / 24).toFixed(1).replace('.', ',')} días`);
const COLORES_TRAMO = ['--teal', '--teal', '--green', '--yellow', '--yellow', '--red', '--red'];
const $ = (v) => `$${N(v)}`;

// Tabla de un corte (zona, origen, CD…) con participación, antigüedad y costo
function Corte({ titulo, filas, tot, className = 's6', vacio, max = 12, hint }) {
  const conPart = filas.map((x) => ({ ...x, part: tot.unidades ? x.unidades / tot.unidades : 0 }));
  return (
    <Card className={className} title={titulo} hint={hint}>
      <TablaOrden filas={conPart} inicial={['unidades', -1]} max={max} clave={(x) => x.v} cols={[
        ['v', titulo, false, (v) => (v === vacio ? <span className="muted">Sin dato</span> : v)], ['unidades', 'Unidades', true, N],
        ['part', '%', true, (v) => <Barra v={v} color="--yellow" />], ['ilpns', 'iLPN', true, N], ['skus', 'SKU', true, N],
        ['edad_prom', 'Antig. prom.', true, edadTxt], ['edad_max', 'Más antiguo', true, edadTxt], ['costo', 'Costo', true, $]]} />
    </Card>
  );
}

export default function Pendiente({ titulo = 'Almacenamiento', extra = null }) {
  const [filtros, setFiltros] = useState({});
  const f = Object.fromEntries(Object.entries(filtros).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]]));
  const fj = JSON.stringify(f);
  const d = useCarga(() => api.get(`/almacenamiento/pendiente${fj !== '{}' ? `?f=${encodeURIComponent(fj)}` : ''}`), [fj]);
  const r = d.data;
  if (!r) return <><PageHead title={titulo}>{extra}</PageHead><Cargando error={d.error} /></>;
  if (!r.cargado) return (
    <>
      <PageHead title={titulo} sub="Pendiente por almacenar según la foto del WMS">{extra}</PageHead>
      <p className="empty">Aún no hay una foto de lo pendiente por almacenar. Súbela en <Link to="/cargas#carga-almacenamiento">Datos, Cargas (Almacenamiento)</Link>.</p>
    </>
  );

  const t = r.tot, n = Object.keys(f).length, vacio = r.vacio;
  const tramos = r.tramos.map((l, i) => ({ l, ...(r.porTramo.find((x) => x.tramo === i) || { unidades: 0, ilpns: 0 }) }));
  return (
    <>
      <PageHead title={titulo} sub={`Pendiente por almacenar: ${r.carga.archivo}, cargado ${fechaHora(new Date(r.carga.cargado_en).getTime())}. La antigüedad se mide desde la creación del iLPN hasta la carga.`}>
        <Link to="/cargas#carga-almacenamiento">Cargar foto</Link>{extra}
      </PageHead>
      <div className="filters" aria-label="Filtros de pendiente por almacenar">
        {r.dims.map(([k, l]) => {
          const ops = r.opciones[k] || [];
          return <Segmentador key={k} label={l} valores={ordenar(ops.map((o) => o.v))} sel={filtros[k] || new Set()}
            etiqueta={(v) => (v === vacio ? 'Sin dato' : v)} conDatos={new Set(ops.filter((o) => o.unidades > 0).map((o) => o.v))}
            onChange={(s) => setFiltros({ ...filtros, [k]: s })} />;
        })}
        {n > 0 && <button type="button" className="ghost" onClick={() => setFiltros({})}>Limpiar filtros ({n})</button>}
      </div>
      <Kpis items={[
        ['Unidades pendientes', N(t.unidades)],
        ['iLPN', <>{N(t.ilpns)} <small>{t.ilpns ? (t.unidades / t.ilpns).toFixed(1).replace('.', ',') : '—'} un./iLPN</small></>],
        ['SKU', N(t.skus)],
        ['Costo pendiente', $(t.costo)],
        ['Antigüedad promedio', edadTxt(t.edad_prom), t.edad_prom >= 24 ? 'warn' : ''],
        ['Más antiguo', edadTxt(t.edad_max), t.edad_max >= 72 ? 'warn' : ''],
        ['Más de 24 h', <>{pctf(t.unidades ? t.mas_24h / t.unidades : 0)} <small>{N(t.mas_24h)} un.</small></>, t.mas_24h ? 'warn' : '']]} />
      <div className="grid">
        <Card className="s6" title="Antigüedad de lo pendiente" hint="Unidades por tiempo desde la creación del iLPN (FECHA_CREAC) hasta la carga de la foto.">
          <Grafico leyenda={false} label="Unidades pendientes por antigüedad" datos={{
            labels: tramos.map((x) => x.l),
            datasets: [{ label: 'Unidades', data: tramos.map((x) => x.unidades), backgroundColor: tramos.map((_, i) => css(COLORES_TRAMO[i])), borderRadius: 3 }]
          }} opciones={{ plugins: { tooltip: { callbacks: { afterLabel: (c) => `${N(tramos[c.dataIndex].ilpns)} iLPN · ${pctf(tramos[c.dataIndex].unidades / Math.max(1, t.unidades))}` } } } }} />
        </Card>
        <Card className="s6" title="Por zona">
          <Grafico horizontal leyenda={false} alto={Math.max(180, Math.min(r.porZona.length, 12) * 30)} label="Unidades pendientes por zona" datos={{
            labels: r.porZona.slice(0, 12).map((x) => (x.v === vacio ? 'Sin dato' : x.v)),
            datasets: [{ label: 'Unidades', data: r.porZona.slice(0, 12).map((x) => x.unidades), backgroundColor: css('--yellow'), borderRadius: 3 }]
          }} />
        </Card>
        <Corte titulo="Zona" filas={r.porZona} tot={t} vacio={vacio} />
        <Corte titulo="Origen" filas={r.porOrigen} tot={t} vacio={vacio} />
        <Corte titulo="CD" filas={r.porCd} tot={t} vacio={vacio} />
        <Corte titulo="CD desde" filas={r.porCdDesde} tot={t} vacio={vacio} />
        <Corte titulo="Depto" filas={r.porDepto} tot={t} vacio={vacio} />
        <Corte titulo="Temporada" filas={r.porTemporada} tot={t} vacio={vacio} />
        <Corte titulo="Level" filas={r.porLevel} tot={t} vacio={vacio} />
        <Corte titulo="Empresa usuario" filas={r.porEmpresa} tot={t} vacio={vacio} />
        <Corte titulo="Status" filas={r.porStatus} tot={t} vacio={vacio} />
        <Corte titulo="Hay en OSR" filas={r.porOsr} tot={t} vacio={vacio} hint="Columna HAY_EN_OSR del archivo: si el SKU ya tiene stock en el OSR." />
      </div>
      <Card title="iLPN más antiguos sin almacenar" hint={`Los ${N(r.antiguos.length)} más antiguos con los filtros aplicados.`}>
        <TablaOrden filas={r.antiguos.map((x) => ({ ...x, desde: x.desde ? new Date(x.desde).getTime() : null }))} inicial={['edad', -1]} max={50} clave={(x) => x.ilpn + x.sku} cols={[
          ['ilpn', 'iLPN'], ['sku', 'SKU'], ['descripcion', 'Descripción'], ['qty', 'Unid.', true, N], ['zona', 'Zona'], ['ubicacion', 'Ubicación'],
          ['origen', 'Origen'], ['cd_desde', 'CD desde'], ['cd', 'CD'], ['desc_depto', 'Depto'], ['status', 'Status'],
          ['desde', 'Creado', true, (v) => fechaHora(v)], ['edad', 'Antigüedad', true, edadTxt]]} />
      </Card>
    </>
  );
}
