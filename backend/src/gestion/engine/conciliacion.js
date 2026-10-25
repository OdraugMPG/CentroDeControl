// Conciliación del avance comparando dos fotos de stock (inicio de la jornada vs. carga de cierre de turno).
// El WMS sigue siendo el sistema de ejecución: aquí solo se mide si el stock quedó donde la tarea decía.

export function mapaStock(filas) {
  const m = new Map();
  for (const r of filas) {
    if (!r.ubic || !r.sku) continue;
    const k = r.ubic + '|' + r.sku;
    m.set(k, (m.get(k) || 0) + (r.qty || 0));
  }
  return m;
}

/**
 * @param tareas    tareas abiertas [{id, proceso, ubic_origen, ubic_destino, sku, unid_asig, estado}]
 * @param antes     Map ubic|sku -> qty (base con que se generó la asignación)
 * @param despues   Map ubic|sku -> qty (base de cierre)
 * @param reservadas Set de ubicaciones de stock unitario
 * @returns [{id, unid_real, estado, obs}]
 */
export function conciliar(tareas, antes, despues, reservadas) {
  const g = (m, u, s) => m.get(u + '|' + s) || 0;
  const pool = new Map(); // aumento disponible en cada destino|sku
  const poolDe = (u, s) => {
    const k = u + '|' + s;
    if (!pool.has(k)) pool.set(k, Math.max(0, g(despues, u, s) - g(antes, u, s)));
    return k;
  };
  const skuEnReservada = new Set();
  for (const [k, q] of despues) {
    const [u, s] = k.split('|');
    if (q > 0 && reservadas.has(u)) skuEnReservada.add(s);
  }
  const res = [];
  for (const t of tareas) {
    if (t.proceso === 'INV') continue;
    const asig = Number(t.unid_asig) || 0;
    const bajaOri = Math.max(0, g(antes, t.ubic_origen, t.sku) - g(despues, t.ubic_origen, t.sku));
    let real = 0, obs = '';
    if (t.proceso === 'CONS') {
      const k = poolDe(t.ubic_destino, t.sku);
      const disp = pool.get(k);
      real = Math.min(bajaOri, disp, asig);
      pool.set(k, disp - real);
      if (bajaOri > 0 && real < Math.min(bajaOri, asig)) obs = 'El origen bajó pero el destino no recibió todo: revisar dónde quedó el stock.';
    } else if (t.proceso === 'SU') {
      const llego = g(despues, t.ubic_destino, t.sku) > g(antes, t.ubic_destino, t.sku);
      if (llego || (bajaOri > 0 && skuEnReservada.has(t.sku))) real = 1;
      else if (bajaOri > 0) obs = 'Salió del origen pero no aparece en una ubicación reservada.';
    } else if (t.proceso === 'SM' || t.proceso === 'REU') {
      real = Math.min(bajaOri, asig);
    }
    let estado = t.estado;
    if (real >= asig && asig > 0) estado = 'EJECUTADO';
    else if (real > 0) estado = 'PARCIAL';
    if (real > 0 || obs) res.push({ id: t.id, unid_real: real, estado, obs });
  }
  return res;
}
