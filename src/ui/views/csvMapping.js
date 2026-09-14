/**
 * Asking which column is which, for a file from a broker the app does not know.
 *
 * One panel per layout: several yearly exports from the same broker share
 * headers, so they are answered once. Every field starts from a guess read off
 * the headers, and the date and number formats from the values themselves, so
 * for most files this is a glance and a confirmation rather than a form. The
 * first few rows are shown as the app reads them, because a wrong choice is
 * far easier to see in "SELL 10 AAPL at 1,234" than in a column name.
 */
import { FIELDS } from '../../features/genericCsv.js';

const node = (tag, css = '', text = '') => {
  const el = document.createElement(tag);
  if (css) el.style.cssText = css;
  if (text) el.textContent = text;
  return el;
};

function picker(options, value, onPick) {
  const select = node('select', 'font-size:12px;max-width:100%');
  for (const [optionValue, label] of options) select.add(new Option(label, optionValue));
  select.value = value ?? '';
  select.addEventListener('change', () => onPick(select.value));
  return select;
}

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One transaction as a line a person can check at a glance. */
function describeRow(t) {
  const trade = t.kind === 'buy' || t.kind === 'sell';
  return trade
    ? `${t.date} · ${t.kind.toUpperCase()} ${+t.qty.toFixed(6)} ${t.ticker} at ${money(t.price)} · cash ${money(t.cash)}`
    : `${t.date} · ${t.kind}${t.ticker ? ` ${t.ticker}` : ''} · ${money(t.cash)}`;
}

/**
 * Draw the panels. `groups` are mutated as choices change and `onChange` is
 * called after each, so the caller can re-read the files and redraw.
 */
export function renderCsvMapping(container, groups, onChange) {
  if (!container) return;
  container.replaceChildren();
  container.style.display = groups.length ? '' : 'none';

  for (const group of groups) {
    const box = node('div', 'margin:0 0 12px;padding:10px 12px;border:0.5px solid var(--border2);border-radius:8px');
    box.append(node('div', 'font-size:12px;font-weight:600;margin-bottom:4px', group.names.join(', ')));
    box.append(node('div', 'font-size:11px;color:var(--text3);margin-bottom:10px',
      'Not an Interactive Brokers statement, so check which column is which. The guesses are filled in, '
      + 'and your choice is remembered for files laid out the same way.'));

    const grid = node('div', 'display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:12px');
    const columns = [['', '— not in this file —'], ...group.headers.map((h) => [h, h])];
    for (const field of FIELDS) {
      grid.append(node('label', 'color:var(--text2)', `${field.label}${field.required ? ' *' : ''}`));
      grid.append(picker(columns, group.mapping[field.key], (value) => {
        if (value) group.mapping[field.key] = value; else delete group.mapping[field.key];
        onChange();
      }));
    }
    grid.append(node('label', 'color:var(--text2)', 'Dates are written'));
    // A format picked by hand is kept from then on, rather than re-detected
    // every time a column choice changes.
    grid.append(picker([['dmy', 'Day / month / year'], ['mdy', 'Month / day / year']], group.formats.dateOrder, (value) => {
      group.formats.dateOrder = value;
      group.chosen = { ...group.chosen, dateOrder: true };
      onChange();
    }));
    grid.append(node('label', 'color:var(--text2)', 'Numbers are written'));
    grid.append(picker([['dot', '1,234.56'], ['comma', '1.234,56']], group.formats.numberStyle, (value) => {
      group.formats.numberStyle = value;
      group.chosen = { ...group.chosen, numberStyle: true };
      onChange();
    }));
    box.append(grid);

    if (group.missing?.length) {
      box.append(node('div', 'font-size:11px;color:var(--red);margin-top:10px', `Still needed: ${group.missing.join(', ')}.`));
    } else if (group.sample?.length) {
      const sample = node('div', 'font-size:11px;color:var(--text3);margin-top:10px');
      sample.append(node('div', 'margin-bottom:4px', 'The first rows, as they will be read:'));
      for (const t of group.sample) sample.append(node('div', 'font-family:ui-monospace,monospace', describeRow(t)));
      box.append(sample);
    }

    container.append(box);
  }
}
