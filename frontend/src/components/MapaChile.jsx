// Mapa de Chile por región, coloreado por densidad (raíz cuadrada para que la RM no opaque al resto)
import { MAPA_CHILE } from '../data/mapaChile.js';
import { N, REGIONES } from '../lib/fmt.js';

export default function MapaChile({ valores, seleccion, onSelect, etiquetas = false, alto = 520 }) {
  const max = Math.max(1, ...Object.values(valores).map(v => v.v));
  return (
    <div className="map" style={{ height: alto }}>
      <svg viewBox={`-2 -2 ${etiquetas ? 110 : 82} 390`} role="img" aria-label="Mapa de Chile por región">
        {Object.entries(MAPA_CHILE).map(([k, g]) => {
          const v = valores[k]?.v || 0;
          const share = Math.sqrt(v / max);
          const fill = v ? `color-mix(in srgb, var(--blue) ${Math.round(14 + share * 86)}%, transparent)` : 'var(--empty)';
          return (
            <path key={k} d={g.d} fill={fill} className={seleccion === k ? 'sel' : ''} onClick={e => { e.stopPropagation(); onSelect?.(k); }}>
              <title>{`${REGIONES[k]}: ${N(valores[k]?.qty || 0)} un., ${valores[k]?.ord || 0} órdenes`}</title>
            </path>
          );
        })}
        {etiquetas && Object.entries(MAPA_CHILE).map(([k, g]) => <text key={k} x={g.c[0] + 9} y={g.c[1] + 3}>{k}</text>)}
      </svg>
    </div>
  );
}

export function regionesDe(pedidos, metrica = 'qty') {
  const out = {};
  Object.keys(REGIONES).forEach(k => { out[k] = { qty: 0, ords: new Set() }; });
  pedidos.forEach(r => { const o = out[r.region] || (out[r.region] = { qty: 0, ords: new Set() }); o.qty += r.qty; o.ords.add(r.orden); });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { qty: v.qty, ord: v.ords.size, v: metrica === 'ord' ? v.ords.size : v.qty }]));
}
