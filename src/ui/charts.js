/**
 * Chart.js wrappers.
 *
 * Chart.js needs literal colour values, not `var(--x)`, so palette values are
 * resolved from the live computed style on every draw. That is also why the
 * theme toggle re-renders instead of just swapping a class.
 */
import { MONTHS_SHORT } from '../config/constants.js';
import { curveSeries, externalFlows } from '../core/snapshots.js';

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

/**
 * Money paid in or taken out, marked on the day it happened.
 *
 * A deposit genuinely makes the account bigger, so the curve steps up and
 * should. But a step that looks like a good week and was a bank transfer is the
 * most misleading thing this chart can draw, and the marker is the difference
 * between reading that jump as performance and knowing it was funding.
 *
 * Small and white: enough to notice, not enough to compete with the line. A
 * withdrawal is the same triangle the other way up.
 */
function cashFlowMarks(marks) {
  return {
    id: 'cashFlowMarks',
    afterDatasetsDraw(chart) {
      if (!marks.length) return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.92;
      for (const mark of marks) {
        const point = meta.data[mark.index];
        if (!point) continue;
        const deposit = mark.amount > 0;
        const size = 4;
        // Held clear of the curve so it never sits on the value it belongs to.
        const y = point.y + (deposit ? -11 : 11);
        ctx.beginPath();
        if (deposit) {
          // Point-down, so the triangle aims at the day it belongs to.
          ctx.moveTo(point.x, y + size);
          ctx.lineTo(point.x + size, y - size);
          ctx.lineTo(point.x - size, y - size);
        } else {
          ctx.moveTo(point.x, y - size);
          ctx.lineTo(point.x + size, y + size);
          ctx.lineTo(point.x - size, y + size);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/**
 * Draws the account curve and returns the series behind it.
 *
 * `mode` picks which of the two curves the same window is drawn as: 'value' in
 * currency, 'percent' as the chained daily return. They share the window, the
 * days and the cash-flow markers — a deposit steps the value line up and leaves
 * the percentage line flat, and seeing that is the point of having both.
 */
export function renderCurve(timeframe, mode = 'value') {
  const canvas = document.getElementById('curve');
  if (!canvas) return null;
  const series = curveSeries(timeframe);
  const percent = mode === 'percent';
  const { labels } = series;
  const data = percent ? series.percent : series.data;
  const c = chartColors();
  canvas.setAttribute('aria-label', percent
    ? `Account return over ${timeframe}, as a percentage`
    : `Account value over ${timeframe}`);

  /**
   * The external flows inside this window, matched to the point they sit on.
   *
   * Indexed by position in the drawn series rather than by date, because that
   * is what the canvas needs — and read from the same daily dataset the curve
   * itself is drawn from, so a marker can never land on a day the line has not
   * got.
   */
  const shown = new Map((series.dates ?? []).map((d, i) => [d, i]));
  const flows = [];
  for (const flow of externalFlows()) {
    const index = shown.get(flow.date);
    if (index == null) continue;
    flows.push({ index, date: flow.date, amount: flow.amount });
  }

  charts.curve?.destroy();
  charts.curve = new Chart(canvas, {
    type: 'line',
    // Built around this window's flows rather than handed them afterwards: a
    // plugin assigned after the constructor misses the first paint entirely,
    // and only reappeared because the animation redrew a frame later.
    plugins: [cashFlowMarks(flows)],
    data: {
      labels,
      datasets: [{
        data,
        /**
         * The value curve is always green: it is a balance, and a balance is
         * not good or bad. A return is, and a red line is how you read a losing
         * window at a glance — so the percentage curve takes the sign of where
         * it ends. The fill runs to the zero line either way, which is why that
         * line is worth having under a percentage.
         */
        borderColor: percent && data[data.length - 1] < 0 ? c.red : c.green,
        borderWidth: 2,
        pointRadius: 0,
        fill: percent ? 'origin' : true,
        backgroundColor: (percent && data[data.length - 1] < 0 ? c.red : c.green) + '14',
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
          callbacks: {
            label: (ctx) => (percent
              ? ` ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(2)}%`
              : ' $' + Math.round(ctx.raw).toLocaleString()),
            /**
             * A deposit is named under the value rather than folded into it.
             * The account really did grow by that much and really did not earn
             * it, and both facts have to reach whoever is reading the day.
             */
            afterBody: (items) => {
              const flow = flows.find((f) => f.index === items[0]?.dataIndex);
              if (!flow) return '';
              const when = new Date(flow.date + 'T00:00:00Z').toLocaleDateString(undefined, {
                timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
              });
              const sign = flow.amount > 0 ? '+$' : '−$';
              return [
                flow.amount > 0 ? 'Deposit' : 'Withdrawal',
                'Date: ' + when,
                'Amount: ' + sign + Math.abs(flow.amount).toLocaleString(),
                // Said outright on the percentage curve, because the line not
                // moving here is the one thing a reader might mistake for a bug.
                ...(percent ? ['Not counted as return'] : []),
              ];
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: c.txt, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: c.grid } },
        y: {
          ticks: {
            color: c.txt,
            font: { size: 10 },
            callback: (v) => (percent
              ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
              : '$' + (v / 1000).toFixed(1) + 'k'),
          },
          grid: { color: c.grid },
        },
      },
    },
  });
  return series;
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
