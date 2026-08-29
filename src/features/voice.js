/**
 * Hands-free control via the Web Speech API (Chrome only).
 *
 * Commands are a table of {pattern, run} rules matched in order, rather than a
 * chain of ifs — adding a phrase means adding one row. The `app` object is
 * injected at init so this module never imports the action layer, and the
 * grammar stays readable on its own.
 */
import { MONTHS_LONG } from '../config/constants.js';
import { showToast } from '../ui/toast.js';

const MONTH_MAP = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

const HELP_TEXT = 'Try: "go home", "open positions", "new trade", "show March 2026", "refresh", "expand BTC", "set long", "edit cash"';

let recognition = null;
let active = false;
/** Injected action surface — see initVoice(). */
let app = null;

const say = (message, type = 'heard', ms) => showToast(message, type, ms);

/** Build the ordered rule table. Each rule returns true once it has handled the phrase. */
function commands() {
  const timeframe = (pattern, tf) => ({
    pattern,
    run: () => { app.setTimeframe(tf); say(`Chart → ${tf}`); },
  });

  return [
    // ── Navigation ────────────────────────────────────────────────
    { pattern: /\b(home|overview|dashboard|start)\b/, run: () => { app.show('home'); say('Home'); } },
    { pattern: /\b(position|positions|my positions|open positions)\b/, run: () => { app.show('positions'); say('Positions'); } },
    { pattern: /\b(new trade|add trade|add position|create trade|open trade)\b/, run: () => { app.show('add'); say('New Trade'); } },
    {
      // "monthly" alone means the page; "monthly … March" is a month lookup.
      pattern: /\b(monthly|month page|monthly page|monthly report)\b/,
      guard: (t) => !MONTHS_LONG.some((m) => t.includes(m.toLowerCase())),
      run: () => { app.show('monthly'); say('Monthly P&L'); },
    },

    // ── Home: chart timeframe ─────────────────────────────────────
    timeframe(/\b(1w|one week|1 week|weekly chart)\b/, '1W'),
    timeframe(/\b(1m|one month|1 month|monthly chart)\b/, '1M'),
    timeframe(/\b(3m|three month|3 month)\b/, '3M'),
    timeframe(/\b(6m|six month|6 month)\b/, '6M'),
    timeframe(/\b(ytd|year to date|this year)\b/, 'YTD'),
    timeframe(/\b(1y|one year|1 year|yearly|annual)\b/, '1Y'),
    timeframe(/\b(all|all time|full history)\b/, 'All'),
    { pattern: /\b(edit cash|update cash|set cash|change cash|cash balance)\b/, run: () => { app.show('home'); app.editCash(); } },

    // ── Positions ─────────────────────────────────────────────────
    { pattern: /\b(refresh|update prices|reload|sync)\b/, run: () => { app.refreshPrices(); say('Refreshing prices…'); } },
    {
      pattern: /\b(open|expand|show|close)\s+([a-z]+(?:\.[a-z])?)\b/,
      run: (match) => {
        const action = match[1];
        const ticker = match[2].toUpperCase();
        if (!app.focusTicker(ticker, action === 'close')) return false;
        say(`${action === 'close' ? 'Closing ' : 'Expanding '}${ticker}`);
        return true;
      },
    },
    { pattern: /\b(collapse|close all|hide all)\b/, run: () => { app.collapseAll(); say('All collapsed'); } },
    { pattern: /\b(settings|api key|finnhub|live price settings|configure)\b/, run: () => { app.openSettings(); say('Settings opened'); } },

    // ── New-trade form ────────────────────────────────────────────
    {
      pattern: /\b(ticker|symbol|asset)\s+([a-z]+(?:\.[a-z])?)\b/,
      run: (match) => {
        const ticker = match[2].toUpperCase();
        app.show('add');
        app.setFormTicker(ticker);
        say(`Ticker set to ${ticker}`);
      },
    },
    { pattern: /\b(go long|set long|direction long|long position)\b/, run: () => { app.show('add'); app.setDirection('Long'); say('Direction → Long'); } },
    { pattern: /\b(go short|set short|direction short|short position)\b/, run: () => { app.show('add'); app.setDirection('Short'); say('Direction → Short'); } },
    { pattern: /\b(set crypto|asset crypto|class crypto)\b/, run: () => { app.show('add'); app.setAssetClass('Crypto'); say('Asset class → Crypto'); } },
    { pattern: /\b(set stock|asset stock|class stock)\b/, run: () => { app.show('add'); app.setAssetClass('Stocks'); say('Asset class → Stocks'); } },
    { pattern: /\b(set commodity|asset commodity|class commodity)\b/, run: () => { app.show('add'); app.setAssetClass('Commodities'); say('Asset class → Commodities'); } },
    { pattern: /\b(clear form|clear|reset form)\b/, run: () => { app.show('add'); app.clearForm(); say('Form cleared'); } },
    { pattern: /\b(save trade|save position|confirm trade|submit)\b/, run: () => { app.show('add'); app.addTrade(); } },

    // ── Monthly ───────────────────────────────────────────────────
    {
      pattern: /\b(chart|year|show year|switch year)\s+(20\d{2})\b/,
      run: (match) => { app.show('monthly'); app.setChartYear(match[2]); say(`Chart year → ${match[2]}`); },
    },
    {
      pattern: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/,
      guard: (t) => /\b20\d{2}\b/.test(t) || /\b(history|show|open|trade)\b/.test(t),
      run: (match, t) => {
        const month = MONTH_MAP[match[1]];
        const year = t.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
        app.show('monthly');
        // The monthly page renders lazily on entry, so the pickers only exist
        // a beat later.
        setTimeout(() => {
          app.showMonth(`${year}-${month}`);
          say(`Showing ${MONTHS_LONG[parseInt(month, 10) - 1]} ${year}`);
        }, 300);
      },
    },

    // ── Voice itself ──────────────────────────────────────────────
    { pattern: /\b(stop|stop listening|voice off|mute|quiet)\b/, run: () => stopVoice() },
    { pattern: /\b(help|what can you do|commands|what can i say)\b/, run: () => say(HELP_TEXT, '', 6000) },
  ];
}

/**
 * Match one phrase against the rule table. Exported so the grammar can be
 * exercised without a microphone.
 */
export function handleVoiceCommand(transcript) {
  const text = transcript.toLowerCase().trim();
  say(`Heard: "${transcript}"`, 'heard', 3000);

  for (const rule of commands()) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    if (rule.guard && !rule.guard(text)) continue;
    if (rule.run(match, text) === false) continue; // rule declined — keep looking
    return;
  }
  say('Not understood. Say "help" for commands.', 'error', 3500);
}

export function toggleVoice() {
  const Supported = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Supported) {
    say('Voice not supported. Use Chrome.', 'error', 4000);
    return;
  }
  if (active) stopVoice();
  else startVoice(Supported);
}

function startVoice(Supported) {
  recognition = new Supported();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    active = true;
    document.getElementById('voiceBtn')?.classList.add('listening');
    const label = document.getElementById('voiceBtnTxt');
    if (label) label.textContent = 'Listening…';
    say('🎙 Listening — say "help" for commands', '', 60000);
  };
  recognition.onresult = (e) => {
    handleVoiceCommand(e.results[e.results.length - 1][0].transcript);
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      say('Microphone access denied — allow it in Chrome', 'error', 4000);
      stopVoice();
    } else if (e.error !== 'no-speech') {
      say(`Voice error: ${e.error}`, 'error', 3000);
    }
  };
  // Chrome ends the session on its own every so often; restart while active.
  recognition.onend = () => { if (active) recognition.start(); };

  recognition.start();
}

function stopVoice() {
  active = false;
  if (recognition) {
    recognition.onend = null;
    recognition.stop();
    recognition = null;
  }
  document.getElementById('voiceBtn')?.classList.remove('listening');
  const label = document.getElementById('voiceBtnTxt');
  if (label) label.textContent = 'Voice control';
  say('Voice off', '', 1500);
}

/** Wire the command table to the app's actions. Called once at boot. */
export function initVoice(actions) {
  app = actions;
}
