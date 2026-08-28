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
