// Columnas de etapas agrupadas por fase (flujo de pedidos y citas de recepción)
import { N, sum } from '../lib/fmt.js';

export default function Flujo({ etapas, fases, compacto = false, seleccion, onSelect, anchoMin = 96 }) {
  const top = Math.max(1, ...etapas.map(s => s.qty));
  const maxKey = etapas.reduce((m, s) => s.qty > m.qty ? s : m, { qty: 0 }).key;
  const cols = etapas.length;
  let col = 1;
  const cabeceras = (fases || []).map(f => {
    const n = etapas.filter(s => s.fase === f.nombre).length;
    if (!n) return null;
    const el = (
      <div key={f.nombre} className={`phase ${n === 1 ? 'one' : ''}`} style={{ gridColumn: `${col} / span ${n}`, color: `var(${f.color})` }}>
        {f.nombre} <span>{N(sum(etapas.filter(s => s.fase === f.nombre), s => s.qty))} un.</span>
      </div>
    );
    col += n;
    return el;
  });
  return (
    <div className="flowscroll">
      <div className={`flow ${compacto ? 'compact' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(${anchoMin}px, 1fr))`, minWidth: cols * (anchoMin + 4) }}>
        {cabeceras}
        {etapas.map((s, i) => (
          <button key={s.key} type="button" className={`stage ${seleccion === s.key ? 'sel' : ''}`}
            style={{ gridRow: fases ? 2 : 1, gridColumn: i + 1 }} onClick={() => onSelect?.(s.key)}
            aria-label={`${s.nombre}: ${s.qty} unidades`}>
            <span className="tag" style={{ background: `var(${s.color})` }}>{s.nombre}</span>
            <span className="col"><span className="fill" style={{ height: `${s.qty / top * 100}%`, background: `var(${s.color})`, opacity: s.qty ? 1 : 0 }} /></span>
            <span className="n">{N(s.qty)}</span>
            <span className="meta">{maxKey === s.key && s.qty > 0 && !s.sinMarca && <><span className="old">Mayor carga</span><br /></>}{s.meta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
