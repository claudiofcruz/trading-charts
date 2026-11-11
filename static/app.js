const C = {
  up: '#26a69a', down: '#ef5350',
  volUp: 'rgba(38,166,154,0.5)', volDown: 'rgba(239,83,80,0.5)',
  ema8: '#00e676', ema21: '#ffeb3b', ema50: '#2962ff', ema200: '#ff1744',
  bb: 'rgba(179,157,219,0.8)', bbMid: 'rgba(179,157,219,0.5)',
  rsi: '#7e57c2',
  macd: '#2196f3', signal: '#ff9800',
  sqzLime: '#00e676', sqzGreen: '#1b8a3e', sqzRed: '#ff1744', sqzMaroon: '#8b1a1a',
  dotOn: '#f5f5f5', dotOff: '#787b86', dotNone: '#2962ff',
  draw: '#e0e0e0', note: '#ffd54f',
};

const BASE = {
  autoSize: true,
  layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc', fontSize: 11 },
  grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
  rightPriceScale: { borderColor: '#2a2e39', minimumWidth: 80 },
  timeScale: { borderColor: '#2a2e39', visible: false, rightOffset: 5 },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
};
const RAY_FUTURE = 30;  // quantas barras o raio avança além do último candle
const LINE = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

// converte coluna -> dados do lightweight-charts (null vira "whitespace" para manter alinhamento)
const col = (bars, key, colorFn) => bars.map((b, i) => {
  if (b[key] == null) return { time: b.time };
  const p = { time: b.time, value: b[key] };
  if (colorFn) p.color = colorFn(b, i);
  return p;
});

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => v == null ? '—' : (Math.abs(v) >= 1000 ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : v.toFixed(2));

class Column {
  constructor(root, title, interval) {
    this.interval = interval;
    this.macdMarkers = [];
    this.noteMarkers = [];
    this.drawSeries = [];
    this.drawPriceLines = [];
    root.innerHTML = `
      <div class="col-title">${title}</div>
      <div class="pane main"><div class="legend"></div></div>
      <div class="pane sub"><div class="legend">RSI 14</div></div>
      <div class="pane sub"><div class="legend">MACD 12 26 9 · <span style="color:#26a69a">▲ Up</span> <span style="color:#ef5350">▼ Down</span></div></div>
      <div class="pane sub"><div class="legend">Squeeze Momentum</div></div>`;
    this.title = root.querySelector('.col-title');
    this.titleText = title;
    const panes = root.querySelectorAll('.pane');
    this.legend = panes[0].querySelector('.legend');

    this.main = LightweightCharts.createChart(panes[0], BASE);
    this.rsiC = LightweightCharts.createChart(panes[1], BASE);
    this.macdC = LightweightCharts.createChart(panes[2], BASE);
    this.sqzC = LightweightCharts.createChart(panes[3], { ...BASE, timeScale: { ...BASE.timeScale, visible: true } });
    this.charts = [this.main, this.rsiC, this.macdC, this.sqzC];

    // ---- gráfico principal
    this.candles = this.main.addCandlestickSeries({
      upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down,
    });
    this.candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    this.volume = this.main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    this.main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    this.bbU = this.main.addLineSeries({ ...LINE, color: C.bb });
    this.bbM = this.main.addLineSeries({ ...LINE, color: C.bbMid, lineStyle: LightweightCharts.LineStyle.Dashed });
    this.bbL = this.main.addLineSeries({ ...LINE, color: C.bb });
    this.emas = {
      ema8: this.main.addLineSeries({ ...LINE, color: C.ema8, lineWidth: 2 }),
      ema21: this.main.addLineSeries({ ...LINE, color: C.ema21, lineWidth: 2 }),
      ema50: this.main.addLineSeries({ ...LINE, color: C.ema50, lineWidth: 2 }),
      ema200: this.main.addLineSeries({ ...LINE, color: C.ema200, lineWidth: 2 }),
    };

    // ---- RSI
    this.rsi = this.rsiC.addLineSeries({ ...LINE, color: C.rsi, lineWidth: 2, lastValueVisible: true,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    [70, 50, 30].forEach(p => this.rsi.createPriceLine({ price: p, color: p === 50 ? '#434651' : '#787b86', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false }));

    // ---- MACD
    this.macdH = this.macdC.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    this.macd = this.macdC.addLineSeries({ ...LINE, color: C.macd, lineWidth: 2, lastValueVisible: true });
    this.signal = this.macdC.addLineSeries({ ...LINE, color: C.signal, lineWidth: 2, lastValueVisible: true });

    // ---- Squeeze
    this.sqzH = this.sqzC.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    this.sqzDots = this.sqzC.addLineSeries({ ...LINE, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 });

    this.syncPanes();
    this.main.subscribeClick(param => onChartClick(this, param));
  }

  // marcadores no candle = sinais do MACD + anotações de texto
  refreshCandleMarkers() {
    const all = [...this.macdMarkers, ...this.noteMarkers].sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    this.candles.setMarkers(all);
  }

  // datas de barras futuras (dias úteis no diário, +7 dias no semanal)
  futureTimes(count) {
    const out = [];
    const d = new Date(this.bars[this.bars.length - 1].time + 'T00:00:00Z');
    while (out.length < count) {
      d.setUTCDate(d.getUTCDate() + (this.interval === '1wk' ? 7 : 1));
      if (this.interval === '1d' && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // pontos da linha: segmento p1→p2, ou (raio) de p1 até RAY_FUTURE barras à frente
  trendPoints(d) {
    const [a, b] = [d.p1, d.p2].sort((x, y) => x.time < y.time ? -1 : 1);
    if (!d.ray) return [a, b].map(p => ({ time: p.time, value: p.price }));
    const ia = this.idx.get(a.time), ib = this.idx.get(b.time);
    const slope = (b.price - a.price) / (ib - ia);
    const times = [...this.bars.slice(ia).map(x => x.time), ...this.futureTimes(RAY_FUTURE)];
    return times.map((time, k) => ({ time, value: a.price + slope * k }));
  }

  renderDrawings(drawings) {
    this.drawSeries.forEach(s => this.main.removeSeries(s));
    this.drawPriceLines.forEach(l => this.candles.removePriceLine(l));
    this.drawSeries = []; this.drawPriceLines = []; this.noteMarkers = [];
    const times = this.byTime || new Map();

    for (const d of drawings) {
      if (d.type === 'hline') {
        this.drawPriceLines.push(this.candles.createPriceLine({
          price: d.price, color: C.draw, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true,
        }));
      } else if (d.interval !== this.interval) {
        continue;
      } else if (d.type === 'trend' && times.has(d.p1.time) && times.has(d.p2.time) && d.p1.time !== d.p2.time) {
        const pts = this.trendPoints(d);
        const s = this.main.addLineSeries({ ...LINE, color: C.draw, lineWidth: 2, autoscaleInfoProvider: () => null });
        s.setData(pts);
        this.drawSeries.push(s);
      } else if (d.type === 'note' && times.has(d.time)) {
        this.noteMarkers.push({ time: d.time, position: 'aboveBar', color: C.note, shape: 'circle', text: d.text, size: 0.8 });
      }
    }
    this.refreshCandleMarkers();
  }

  syncPanes() {
    let syncing = false;
    const primary = () => [this.candles, this.rsi, this.macd, this.sqzH];
    this.charts.forEach((chart, i) => {
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (syncing || !range) return;
        syncing = true;
        this.charts.forEach((o, j) => j !== i && o.timeScale().setVisibleLogicalRange(range));
        syncing = false;
      });
      chart.subscribeCrosshairMove(param => {
        if (syncing) return;
        syncing = true;
        const series = primary();
        this.charts.forEach((o, j) => {
          if (j === i) return;
          const v = param.time && this.values[j]?.get(param.time);
          if (v != null) o.setCrosshairPosition(v, param.time, series[j]);
          else o.clearCrosshairPosition();
        });
        syncing = false;
        this.updateLegend(param.time);
      });
    });
  }

  setData(ticker, bars, keepRange = false) {
    const prevRange = keepRange ? this.main.timeScale().getVisibleLogicalRange() : null;
    this.bars = bars;
    this.byTime = new Map(bars.map(b => [b.time, b]));
    this.idx = new Map(bars.map((b, i) => [b.time, i]));
    this.title.textContent = `${this.titleText} — ${ticker}`;

    this.candles.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    this.volume.setData(bars.map(b => ({ time: b.time, value: b.volume ?? 0, color: b.close >= b.open ? C.volUp : C.volDown })));
    this.bbU.setData(col(bars, 'bb_upper'));
    this.bbM.setData(col(bars, 'bb_mid'));
    this.bbL.setData(col(bars, 'bb_lower'));
    Object.entries(this.emas).forEach(([k, s]) => s.setData(col(bars, k)));

    this.rsi.setData(col(bars, 'rsi'));

    this.macd.setData(col(bars, 'macd'));
    this.signal.setData(col(bars, 'macd_signal'));
    this.macdH.setData(col(bars, 'macd_hist', (b, i) => {
      const prev = bars[i - 1]?.macd_hist ?? 0, v = b.macd_hist;
      return v >= 0 ? (v >= prev ? '#26a69a' : '#b2dfdb') : (v < prev ? '#ff5252' : '#ffcdd2');
    }));

    // Up / Down signal: cruzamento da linha MACD com a linha de sinal
    const markers = [];
    for (let i = 1; i < bars.length; i++) {
      const p = bars[i - 1], b = bars[i];
      if (p.macd == null || p.macd_signal == null || b.macd == null || b.macd_signal == null) continue;
      const prevDiff = p.macd - p.macd_signal, diff = b.macd - b.macd_signal;
      if (prevDiff <= 0 && diff > 0)
        markers.push({ time: b.time, position: 'belowBar', color: C.up, shape: 'arrowUp', size: 0.6 });
      else if (prevDiff >= 0 && diff < 0)
        markers.push({ time: b.time, position: 'aboveBar', color: C.down, shape: 'arrowDown', size: 0.6 });
    }
    this.macd.setMarkers(markers);
    this.macdMarkers = markers.map(m => ({ ...m, size: 0.8 }));  // mesmos sinais no gráfico de preço

    this.sqzH.setData(col(bars, 'sqz', (b, i) => {
      const prev = bars[i - 1]?.sqz ?? 0, v = b.sqz;
      return v > 0 ? (v > prev ? C.sqzLime : C.sqzGreen) : (v < prev ? C.sqzRed : C.sqzMaroon);
    }));
    this.sqzDots.setData(bars.map(b => b.sqz_state == null ? { time: b.time } : {
      time: b.time, value: 0,
      color: b.sqz_state === 'on' ? C.dotOn : b.sqz_state === 'off' ? C.dotOff : C.dotNone,
    }));

    // valores para sincronizar o crosshair entre painéis
    const m = k => new Map(bars.filter(b => b[k] != null).map(b => [b.time, b[k]]));
    this.values = [m('close'), m('rsi'), m('macd'), m('sqz')];

    const n = bars.length;
    this.main.timeScale().setVisibleLogicalRange(prevRange || { from: Math.max(0, n - 150), to: n + 5 });
    this.updateLegend();
  }

  updateLegend(time) {
    if (!this.bars?.length) return;
    const b = (time && this.byTime.get(time)) || this.bars[this.bars.length - 1];
    const color = b.close >= b.open ? C.up : C.down;
    const chg = this.bars.indexOf(b) > 0 ? (b.close / this.bars[this.bars.indexOf(b) - 1].close - 1) * 100 : 0;
    this.legend.innerHTML = `
      <div><span>${b.time}</span>
        <span style="color:${color}">O ${fmt(b.open)} H ${fmt(b.high)} L ${fmt(b.low)} C ${fmt(b.close)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)</span>
        <span style="color:var(--muted)">Vol ${b.volume?.toLocaleString('pt-BR') ?? '—'}</span></div>
      <div>
        <span style="color:${C.ema8}">EMA8 ${fmt(b.ema8)}</span>
        <span style="color:${C.ema21}">EMA21 ${fmt(b.ema21)}</span>
        <span style="color:${C.ema50}">EMA50 ${fmt(b.ema50)}</span>
        <span style="color:${C.ema200}">EMA200 ${fmt(b.ema200)}</span>
        <span style="color:${C.bb}">BB(20,2) ${fmt(b.bb_upper)} / ${fmt(b.bb_lower)}</span>
      </div>`;
  }
}


// ============================================================ estado / API
const $ = id => document.getElementById(id);
const input = $('ticker'), status = $('status');
const weekly = new Column($('col-weekly'), 'Semanal', '1wk');
const daily = new Column($('col-daily'), 'Diário', '1d');
const columns = [weekly, daily];

const state = { ticker: null, drawings: [], watchlist: [], tool: null, pending: null };

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}
const putJSON = (url, body) => api(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function setStatus(msg, error = false) { status.className = error ? 'error' : ''; status.textContent = msg; }

// ============================================================ gráficos
async function load(ticker, { refresh = false } = {}) {
  ticker = ticker.trim().toUpperCase();
  if (!ticker) return;
  input.value = ticker;
  if (!refresh) setStatus(`Carregando ${ticker}…`);
  try {
    const q = t => api(`/api/chart?ticker=${encodeURIComponent(ticker)}&interval=${t}`);
    const [w, d, drawings] = await Promise.all([q('1wk'), q('1d'),
      refresh && state.ticker === ticker ? state.drawings : api(`/api/drawings/${encodeURIComponent(ticker)}`)]);
    const keep = refresh && state.ticker === w.ticker;
    state.ticker = w.ticker;
    state.drawings = drawings;
    weekly.setData(w.ticker, w.bars, keep);
    daily.setData(d.ticker, d.bars, keep);
    columns.forEach(c => c.renderDrawings(drawings));
    setStatus(`${d.ticker} · atualizado ${new Date().toLocaleTimeString('pt-BR')}`);
    store.set('lastTicker', w.ticker);
    renderWatchlist();
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ============================================================ desenhos
function setTool(tool) {
  state.tool = state.tool === tool ? null : tool;
  state.pending = null;
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === state.tool));
  document.body.classList.toggle('drawing', !!state.tool);
  if (state.tool === 'trend' || state.tool === 'ray') setStatus(`${state.tool === 'ray' ? 'Raio' : 'Tendência'}: clique no 1º ponto (Esc cancela)`);
  else if (state.tool === 'hline') setStatus('Horizontal: clique no preço desejado');
  else if (state.tool === 'note') setStatus('Texto: clique no candle');
}

async function saveDrawings() {
  columns.forEach(c => c.renderDrawings(state.drawings));
  try { await putJSON(`/api/drawings/${encodeURIComponent(state.ticker)}`, state.drawings); }
  catch (e) { setStatus(`Erro ao salvar desenho: ${e.message}`, true); }
}

function onChartClick(column, param) {
  if (!state.tool || !state.ticker || !param.point) return;
  const price = column.candles.coordinateToPrice(param.point.y);
  if (price == null) return;
  const time = param.time;

  if (state.tool === 'hline') {
    state.drawings.push({ type: 'hline', price: +price.toFixed(4) });
  } else if (state.tool === 'note') {
    if (!time || !column.idx.has(time)) return;
    const text = prompt('Texto da anotação:');
    if (!text) return setTool(null);
    state.drawings.push({ type: 'note', interval: column.interval, time, text: text.slice(0, 60) });
  } else if (state.tool === 'trend' || state.tool === 'ray') {
    if (!time || !column.idx.has(time)) return;   // precisa ser um candle real
    if (!state.pending || state.pending.column !== column) {
      state.pending = { column, time, price };
      return setStatus(`${state.tool === 'ray' ? 'Raio' : 'Tendência'}: clique no 2º ponto`);
    }
    if (state.pending.time === time) return;
    state.drawings.push({ type: 'trend', ray: state.tool === 'ray', interval: column.interval,
      p1: { time: state.pending.time, price: state.pending.price }, p2: { time, price } });
  }
  setTool(null);
  setStatus(`${state.ticker} · desenho salvo`);
  saveDrawings();
}

document.querySelectorAll('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('undo').onclick = () => { if (state.drawings.pop()) saveDrawings(); };
$('clear').onclick = () => {
  if (state.drawings.length && confirm(`Apagar todos os desenhos de ${state.ticker}?`)) { state.drawings = []; saveDrawings(); }
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.tool) { setTool(null); setStatus(state.ticker || ''); }
});

// ============================================================ watchlist + scanner
const SIGNALS = {
  macd_up: ['MACD ▲', 'up'], macd_down: ['MACD ▼', 'down'],
  sqz_fired_up: ['Squeeze ▲', 'up'], sqz_fired_down: ['Squeeze ▼', 'down'],
};
let scanData = new Map();

function badges(sigs, prefix) {
  return sigs.map(s => `<span class="badge ${SIGNALS[s][1]}">${prefix} ${SIGNALS[s][0]}</span>`).join('');
}

function renderWatchlist() {
  $('watchlist').innerHTML = state.watchlist.map(t => {
    const q = scanData.get(t);
    const cls = q?.change_pct >= 0 ? 'up' : 'down';
    const body = !q ? `<span class="wl-price">…</span><span></span>`
      : q.error ? `<span></span><span></span><div class="wl-err">${esc(q.error)}</div>`
      : `<span class="wl-price">${fmt(q.price)}</span>
         <span class="wl-chg" style="color:var(--${cls})">${q.change_pct >= 0 ? '+' : ''}${q.change_pct.toFixed(2)}%</span>
         <div class="wl-badges">${badges(q.daily, 'D')}${badges(q.weekly, 'S')}</div>`;
    return `<div class="wl-row ${t === state.ticker ? 'active' : ''}" data-t="${esc(t)}">
      <span class="wl-sym">${esc(t)}</span>${body}
      <button class="wl-del" data-del="${esc(t)}" title="Remover">×</button></div>`;
  }).join('') || '<div class="empty">Adicione tickers acima</div>';

  const rows = [];
  for (const t of state.watchlist) {
    const q = scanData.get(t);
    if (!q || q.error) continue;
    q.daily.forEach(s => rows.push([t, 'Diário', s]));
    q.weekly.forEach(s => rows.push([t, 'Semanal', s]));
  }
  $('scanner').innerHTML = rows.map(([t, tf, s]) => `<div class="sc-row" data-t="${esc(t)}">
      <span class="wl-sym" style="width:56px">${esc(t)}</span><span class="sc-tf">${tf}</span>
      <span class="badge ${SIGNALS[s][1]}">${SIGNALS[s][0]}</span></div>`).join('')
    || `<div class="empty">${scanData.size ? 'Nenhum sinal na última barra' : 'Carregando…'}</div>`;
}

async function scan() {
  if (!state.watchlist.length) return renderWatchlist();
  try {
    const res = await api(`/api/scan?tickers=${encodeURIComponent(state.watchlist.join(','))}`);
    scanData = new Map(res.map(r => [r.ticker, r]));
    checkAlerts(res);
  } catch (e) { setStatus(`Scanner: ${e.message}`, true); }
  renderWatchlist();
}

async function saveWatchlist() {
  state.watchlist = await putJSON('/api/watchlist', state.watchlist);
  renderWatchlist();
}

$('wl-add').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const t = e.target.value.trim().toUpperCase();
  e.target.value = '';
  if (!t || state.watchlist.includes(t)) return;
  state.watchlist.push(t);
  await saveWatchlist();
  scan();
});

document.querySelector('aside').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    state.watchlist = state.watchlist.filter(t => t !== del.dataset.del);
    return saveWatchlist();
  }
  const row = e.target.closest('[data-t]');
  if (row) load(row.dataset.t);
});

// ============================================================ auto-refresh
function usMarketOpen() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  if (['Sat', 'Sun'].includes(parts.weekday)) return false;
  const mins = +parts.hour * 60 + +parts.minute;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60 + 15;  // pregão + 15 min p/ fechamento
}

const autoSel = $('auto');
autoSel.value = store.get('autoRefresh', '0');
autoSel.onchange = () => { store.set('autoRefresh', autoSel.value); lastRefresh = Date.now(); };
let lastRefresh = Date.now();

// com alertas ligados e auto-atualização desligada, o scanner roda a cada 5 min
setInterval(() => {
  const auto = +autoSel.value, every = auto || (alertsOn ? 5 : 0);
  if (!every) return;
  if (!usMarketOpen()) {
    if (auto && state.ticker) setStatus(`${state.ticker} · mercado fechado (auto-atualização pausada)`);
    return;
  }
  if (Date.now() - lastRefresh < every * 60_000 - 1000) return;
  lastRefresh = Date.now();
  if (auto && state.ticker) load(state.ticker, { refresh: true });
  scan();
}, 15_000);

// ============================================================ alertas
let alertsOn = store.get('alerts', '0') === '1';
const alertBtn = $('alerts');
alertBtn.classList.toggle('active', alertsOn);

alertBtn.onclick = async () => {
  alertsOn = !alertsOn;
  store.set('alerts', alertsOn ? '1' : '0');
  alertBtn.classList.toggle('active', alertsOn);
  if (alertsOn && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  setStatus(alertsOn ? 'Alertas ligados — sinais novos do scanner serão notificados' : 'Alertas desligados');
  if (alertsOn) scan();
};

function checkAlerts(results) {
  if (!alertsOn) return;
  let seen;
  try { seen = JSON.parse(store.get('seenSignals', '[]')); } catch { seen = []; }
  const seenSet = new Set(seen);
  for (const r of results) {
    if (r.error) continue;
    for (const [tf, sigs, date] of [['Diário', r.daily, r.date], ['Semanal', r.weekly, r.weekly_date]]) {
      for (const s of sigs) {
        const key = `${r.ticker}|${tf}|${s}|${date}`;
        if (seenSet.has(key)) continue;
        seenSet.add(key); seen.push(key);
        notify(r.ticker, tf, s, r.price);
      }
    }
  }
  store.set('seenSignals', JSON.stringify(seen.slice(-500)));
}

function notify(ticker, tf, sig, price) {
  const [label, dir] = SIGNALS[sig];
  const title = `${ticker} · ${tf}`, body = `${label} — ${fmt(price)}`;

  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag: `${ticker}|${tf}|${sig}` });
    n.onclick = () => { window.focus(); load(ticker); n.close(); };
  }
  // aviso dentro da página (sempre, caso a notificação do sistema esteja bloqueada)
  const el = document.createElement('div');
  el.className = `toast ${dir}`;
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  el.onclick = () => { load(ticker); el.remove(); };
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 15_000);
}

// ============================================================ início
$('go').onclick = () => load(input.value);
input.addEventListener('keydown', e => e.key === 'Enter' && load(input.value));

(async () => {
  try { state.watchlist = await api('/api/watchlist'); } catch { state.watchlist = []; }
  renderWatchlist();
  load(store.get('lastTicker', state.watchlist[0] || 'SPY'));
  scan();
})();
