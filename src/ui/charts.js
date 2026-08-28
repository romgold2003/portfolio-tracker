/**
 * Chart.js wrappers.
 *
 * Chart.js needs literal colour values, not `var(--x)`, so palette values are
 * resolved from the live computed style on every draw. That is also why the
 * theme toggle re-renders instead of just swapping a class.
 */
import { MONTHS_SHORT } from '../config/constants.js';
import { curveSeries } from '../core/snapshots.js';

/** Live chart instances, so each redraw can destroy the previous one. */
const charts = {};

function cssVar(name, fallback) {
  try {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function chartColors() {
  return {
    grid: cssVar('--grid', '#1a1a1a'),
    txt: cssVar('--text3', '#555'),
    green: cssVar('--green', '#3dba6a'),
    red: cssVar('--red', '#e34948'),
  };
}

/** Draws the account-value curve and returns the period return it implies. */
export function renderCurve(timeframe) {
  const canvas = document.getElementById('curve');
  if (!canvas) return 0;
  const { labels, data, returnPct } = curveSeries(timeframe);
  const c = chartColors();

  charts.curve?.destroy();
  charts.curve = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: c.green,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        backgroundColor: c.green + '14',
        tension: 0.4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: { label: (ctx) => ' $' + Math.round(ctx.raw).toLocaleString() },
        },
      },
      scales: {
        x: { ticks: { color: c.txt, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: c.grid } },
        y: {
          ticks: { color: c.txt, font: { size: 10 }, callback: (v) => '$' + (v / 1000).toFixed(1) + 'k' },
          grid: { color: c.grid },
        },
      },
    },
  });
  return returnPct;
}

/**
 * Percentages drawn onto the wedges themselves.
 *
 * Chart.js has no built-in data labels and the usual plugin is a dependency
 * this project does not want, so this is the whole feature: about fifteen lines
 * of canvas drawing.
 *
 * Thin wedges are left unlabelled. At the size this chart is shown, anything
 * under roughly a twelfth of the circle cannot hold legible text, and a label
 * spilling over its neighbour is worse than no label — the legend carries every
 * figure anyway.
 */
const LABEL_MIN_PCT = 8;

const wedgeLabels = {
  id: 'wedgeLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const values = chart.data.datasets[0].data;
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) return;

    ctx.save();
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    chart.getDatasetMeta(0).data.forEach((arc, i) => {
      const pct = (values[i] / total) * 100;
      if (pct < LABEL_MIN_PCT) return;
      const point = arc.getCenterPoint();
      ctx.fillText(`${pct.toFixed(0)}%`, point.x, point.y);
    });
    ctx.restore();
  },
};

/**
 * The sector allocation doughnut.
 *
 * `rows` come from sectorBreakdown(), which already carries each sector's fixed
 * colour — the chart never decides a colour by position, so opening a new
 * holding cannot repaint the wedges that were already there.
 */
export function renderSectorChart(rows) {
  const canvas = document.getElementById('sectorChart');
  if (!canvas) return;

  charts.sector?.destroy();
  if (!rows.length) return;

  charts.sector = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.colour),
        // The gap reads as separation between wedges without drawing a stroke.
        borderColor: cssVar('--panel', '#131313'),
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '54%',
      layout: { padding: 2 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const row = rows[ctx.dataIndex];
              const money = '$' + Math.round(row.value).toLocaleString('en-US');
              const names = row.holdings.length ? ` · ${row.holdings.join(', ')}` : '';
              return ` ${row.pct.toFixed(1)}% · ${money}${names}`;
            },
          },
        },
      },
    },
    plugins: [wedgeLabels],
  });
}

/** Twelve bars of realised P&L for one calendar year. */
export function renderMonthlyChart(monthlyTotals) {
  const canvas = document.getElementById('monthChart');
  if (!canvas) return;
  const c = chartColors();

  charts.month?.destroy();
  charts.month = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTHS_SHORT,
      datasets: [{
        data: monthlyTotals,
        backgroundColor: monthlyTotals.map((v) => (v < 0 ? c.red : c.green)),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ' ' + (ctx.raw >= 0 ? '+$' : '-$')
              + Math.abs(ctx.raw).toLocaleString('en-US', { minimumFractionDigits: 2 }),
          },
        },
      },
      scales: {
        x: { ticks: { color: c.txt, font: { size: 11 } }, grid: { display: false } },
        y: {
          ticks: {
            color: c.txt,
            font: { size: 10 },
            callback: (v) => (v === 0 ? '$0' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString()),
          },
          grid: { color: c.grid },
          border: { dash: [4, 4] }, // make the zero line readable
        },
      },
    },
  });
}
