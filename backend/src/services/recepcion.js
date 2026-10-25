// Métricas de recepción calculadas desde las citas.
import { q } from '../db.js';

export async function citasDelDia(fecha) {
  const { rows } = await q('SELECT * FROM recepcion_citas WHERE fecha = $1 ORDER BY prog NULLS LAST, cita', [fecha]);
  const ms = v => v ? new Date(v).getTime() : null;
  return rows.map(r => ({ ...r, prog: ms(r.prog), llegada: ms(r.llegada), inicio: ms(r.inicio), fin: ms(r.fin) }));
}

// Reparte las unidades recibidas de cada cita entre el inicio y el fin de su descarga
export function porHora(citas, horas, ref) {
  const acc = Object.fromEntries(horas.map(h => [h, 0]));
  citas.filter(c => c.recibidas && c.inicio).forEach(c => {
    const a = c.inicio, b = Math.max(a + 60000, c.fin || ref);
    const total = b - a;
    horas.forEach(h => {
      const ov = Math.max(0, Math.min(b, h + 3600000) - Math.max(a, h));
      if (ov) acc[h] += c.recibidas * ov / total;
    });
  });
  return horas.map(h => ({ t: h, unidades: Math.round(acc[h]) }));
}

export function ritmoUltimaHora(citas, ref) {
  const a0 = ref - 3600000;
  return Math.round(citas.filter(x => x.recibidas && x.inicio).reduce((s, x) => {
    const a = x.inicio, b = Math.max(a + 60000, x.fin || ref);
    const ov = Math.max(0, Math.min(b, ref) - Math.max(a, a0));
    return s + x.recibidas * ov / (b - a);
  }, 0));
}
