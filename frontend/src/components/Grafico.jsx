// Envoltorio de Chart.js con los colores del tema (se redibuja al cambiar claro/oscuro)
import { Chart as ChartJS, BarController, LineController, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { css } from '../lib/fmt.js';
import { useTema } from '../lib/contexto.jsx';

ChartJS.register(BarController, LineController, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const nf = new Intl.NumberFormat('es-CL');

export default function Grafico({ datos, opciones = {}, alto = 260, apilado = false, horizontal = false, leyenda = true, label }) {
  const oscuro = useTema();
  ChartJS.defaults.font.family = css('--body');
  ChartJS.defaults.color = css('--muted');
  const line = css('--line');
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: leyenda, position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } },
      tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf.format(c.parsed[horizontal ? 'x' : 'y'])}` } }
    },
    scales: {
      x: { stacked: apilado, grid: { display: horizontal, color: line }, border: { color: line } },
      y: { stacked: apilado, grid: { display: !horizontal, color: line }, border: { display: false }, beginAtZero: true,
        ticks: { callback: function (v) { return horizontal ? this.getLabelForValue(v) : nf.format(v); } } }
    }
  };
  const merge = (a, b) => {
    const o = { ...a };
    for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof b[k] !== 'function' ? merge(a[k] || {}, b[k]) : b[k];
    return o;
  };
  return (
    <div className="chart" style={{ height: alto }}>
      <Chart key={oscuro ? 'd' : 'l'} type="bar" data={datos} options={merge(base, opciones)} aria-label={label} role="img" />
    </div>
  );
}
