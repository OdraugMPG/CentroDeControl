import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../lib/contexto.jsx';
import { Card, Cargando, PageHead } from '../../components/ui.jsx';
import Grafico from '../../components/Grafico.jsx';
import MapaChile, { regionesDe } from '../../components/MapaChile.jsx';
import { N, pctf, sum, uniq, css, REGIONES, REG_ORDEN, FASES } from '../../lib/fmt.js';
import { filtrar, nFiltros, catalogoEtapas, BLANCO } from '../../lib/ops.jsx';

export default function Mapa() {
  const { snap, meta, filtros } = useApp();
  const [sp, setSp] = useSearchParams();
  if (!snap || !meta) return <Cargando />;
  const region = sp.get('region'), metrica = sp.get('medida') || 'qty';
  const setP = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const toggle = k => setP('region', region === k ? null : k);
  const f = filtrar(snap.pedidos, filtros);
  const reg = regionesDe(f, metrica);
  const tq = sum(Object.values(reg), v => v.qty);
  const rows = region ? f.filter(r => r.region === region) : f;
  const com = {}; rows.forEach(r => { const c = r.comuna || BLANCO; com[c] = com[c] || { q: 0, o: new Set() }; com[c].q += r.qty; com[c].o.add(r.orden); });
  const cl = Object.entries(com).sort((a, b) => b[1].q - a[1].q).slice(0, 12);
  const etapas = catalogoEtapas(meta, snap.pedidos);

  return (
    <>
      <PageHead title="Pedidos por región" sub={nFiltros(filtros) ? `Con ${nFiltros(filtros)} filtros de pedidos aplicados.` : 'Destino de las unidades que hoy están en el flujo.'}>
        <label className="row" style={{ fontSize: 14 }}><span className="muted">Medir por</span>
          <select value={metrica} onChange={e => setP('medida', e.target.value)} style={{ width: 'auto' }}><option value="qty">Unidades</option><option value="ord">Órdenes</option></select></label>
      </PageHead>
      <Card>
        <div className="bigmap">
          <div><MapaChile valores={reg} etiquetas seleccion={region} onSelect={toggle} alto="min(78vh, 760px)" />
            <div className="scale"><span>Menos</span><span className="g" /><span>Más</span></div></div>
          <div>
            <h3>{region ? `Región ${REGIONES[region]}` : 'Todas las regiones'}</h3>
            <div className="tscroll"><table>
              <thead><tr><th>Región</th><th className="num">Unidades</th><th className="num">Órdenes</th><th className="num">% unidades</th></tr></thead>
              <tbody>{REG_ORDEN.map(k => <tr key={k} className={`clic ${region === k ? 'selrow' : ''}`} onClick={() => toggle(k)}>
                <td>{k} {REGIONES[k]}</td><td className="num">{N(reg[k]?.qty)}</td><td className="num">{reg[k]?.ord || 0}</td><td className="num">{tq ? pctf((reg[k]?.qty || 0) / tq) : '—'}</td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{N(tq)}</td><td className="num">{N(uniq(f, 'orden'))}</td><td className="num">100%</td></tr></tfoot>
            </table></div>
            <div className="grid">
              <Card className="s6" title="Comunas con más pedidos">
                {cl.length ? <table><thead><tr><th>Comuna o punto</th><th className="num">Unid.</th><th className="num">Órd.</th></tr></thead>
                  <tbody>{cl.map(([c, v]) => <tr key={c}><td>{c}</td><td className="num">{N(v.q)}</td><td className="num">{v.o.size}</td></tr>)}</tbody></table>
                  : <p className="empty">Sin pedidos para esta región.</p>}
              </Card>
              <Card className="s6" title="Por etapa">
                <Grafico horizontal leyenda={false} alto={260} label="Unidades por etapa" datos={{ labels: etapas.map(e => e.nombre),
                  datasets: [{ label: 'Unidades', borderRadius: 2, data: etapas.map(e => sum(rows.filter(r => r.area === e.area), r => r.qty)), backgroundColor: etapas.map(e => css(FASES[e.fase] || '--slate')) }] }} />
              </Card>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
