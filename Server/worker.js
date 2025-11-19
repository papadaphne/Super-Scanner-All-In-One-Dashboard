require('dotenv').config();
const axios = require('axios');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 20) * 1000;
const MIN_VOLUME_IDR = Number(process.env.MIN_VOLUME_IDR || 1000000);
const VOLUME_HISTORY_LEN = Number(process.env.VOLUME_HISTORY_LEN || 12);
const ALERT_COOLDOWN = Number(process.env.ALERT_COOLDOWN || 240);
const USER_AGENT = process.env.USER_AGENT || 'SuperScanner/1.0';
const NEWS_SOURCES = (process.env.NEWS_SOURCES || '').split(',').filter(x=>x);

if (!TELEGRAM_TOKEN || !CHAT_ID) {
  console.error('Set TELEGRAM_TOKEN and CHAT_ID in env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const INDODAX_SUMMARIES = 'https://indodax.com/api/summaries';
const INDODAX_ORDERBOOK = pair => `https://indodax.com/api/depth/${pair}`;

const history = {}; // pair -> array of { last, vol_idr, vol_buy, vol_sell, ts }
const lastAlert = {}; // pair -> timestamp (ms)
const signalsStore = []; // recent signals (in-memory, small list)

// helpers
const nowIso = () => new Date().toISOString();
const httpGet = async (url, params = {}) => {
  try {
    const r = await axios.get(url, { params, headers: { 'User-Agent': USER_AGENT } , timeout: 6000});
    return r.data;
  } catch (e) {
    return null;
  }
};

function addHistory(pair, obj) {
  if (!history[pair]) history[pair] = [];
  history[pair].push(obj);
  if (history[pair].length > VOLUME_HISTORY_LEN) history[pair].shift();
}

function formatId(x){ return Math.round(x); }

// score_signal translation -> returns rawScore
function scoreSignal(pair, now, prev) {
  let s = 0;
  try {
    if (!prev) return 0;
    if (now.last > prev.last * 1.01) s += 2;
    if (now.last > prev.last * 1.03) s += 4;
    if (now.vol_idr > prev.vol_idr * 1.5) s += 3;
    if (now.vol_idr > prev.vol_idr * 2.5) s += 5;
    if ((now.vol_buy || 0) > (now.vol_sell || 1) * 1.4) s += 3;
    if ((now.vol_buy || 0) > (now.vol_sell || 1) * 2.0) s += 5;
    if (now.last < 200) s += 2;
  } catch (e) {}
  return s;
}

// calc_levels
function calcLevels(entry, mode='scalper') {
  if (mode === 'scalper') {
    return { tp: Number((entry * 1.035).toFixed(6)), sl: Number((entry * 0.992).toFixed(6)) };
  } else if (mode === 'ghost') {
    return { tp: Number((entry * 1.10).toFixed(6)), sl: Number((entry * 0.987).toFixed(6)) };
  } else if (mode === 'news') {
    return { tp: Number((entry * 1.12).toFixed(6)), sl: Number((entry * 0.985).toFixed(6)) };
  } else {
    return { tp: Number((entry * 1.06).toFixed(6)), sl: Number((entry * 0.99).toFixed(6)) };
  }
}

// modules (mirror Python logic)
function module_scalper(pair, now, prev) {
  if (!prev) return null;
  try {
    if (now.last > prev.last * 1.008 && now.vol_idr > prev.vol_idr * 1.25) {
      const entry = Math.round(now.last * 0.999);
      const { tp, sl } = calcLevels(entry, 'scalper');
      const score = scoreSignal(pair, now, prev);
      return { mode: 'scalper', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

function module_micro_pump(pair, now, prev) {
  if (!prev) return null;
  try {
    if (now.last > prev.last * 1.035 && now.vol_idr > prev.vol_idr * 1.8) {
      const entry = Math.round(now.last * 0.995);
      const { tp, sl } = calcLevels(entry, 'normal');
      const score = scoreSignal(pair, now, prev);
      return { mode: 'micro_pump', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

function module_breakout(pair, now, hist) {
  try {
    if (!hist || hist.length < 10) return null;
    const prices = hist.map(h => h.last);
    const lastPrice = prices[prices.length-1];
    // population pstdev
    const mean = prices.reduce((a,b)=>a+b,0)/prices.length;
    const variance = prices.reduce((a,b)=>a + Math.pow(b-mean,2),0)/prices.length;
    const dev = Math.sqrt(variance);
    if (dev < (lastPrice * 0.006) && now.last > prices[prices.length-1] * 1.02) {
      const entry = Math.round(now.last);
      const { tp, sl } = calcLevels(entry, 'normal');
      const score = scoreSignal(pair, now, hist[hist.length-2] || hist[hist.length-1]);
      return { mode: 'breakout', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

function module_accumulation(pair, now, prev) {
  if (!prev) return null;
  try {
    if ((now.vol_buy || 0) > (now.vol_sell || 1) * 1.7 && now.vol_idr > prev.vol_idr * 1.3) {
      const entry = Math.round(now.last);
      const { tp, sl } = calcLevels(entry, 'ghost');
      const score = scoreSignal(pair, now, prev);
      return { mode: 'accumulation', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

function module_rebound(pair, now, prev) {
  if (!prev) return null;
  try {
    if (prev.last > now.last * 1.07 && now.vol_idr > prev.vol_idr * 1.4) {
      const entry = Math.round(now.last);
      const { tp, sl } = calcLevels(entry, 'normal');
      const score = scoreSignal(pair, now, prev);
      return { mode: 'rebound', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

function module_lowcap(pair, now, prev) {
  if (!prev) return null;
  try {
    if (now.last < 200 && now.vol_idr > prev.vol_idr * 3) {
      const entry = Math.round(now.last);
      const { tp, sl } = calcLevels(entry, 'ghost');
      const score = scoreSignal(pair, now, prev);
      return { mode: 'lowcap', entry, tp, sl, score };
    }
  } catch(e){}
  return null;
}

// ghost detection (orderbook imbalance)
async function detectGhost(pair) {
  const ob = await httpGet(INDODAX_ORDERBOOK(pair));
  try {
    if (!ob) return 0;
    const buys = (ob.buy || []).slice(0,8).reduce((s,x)=>s + Number(x[1]),0);
    const sells = (ob.sell || []).slice(0,8).reduce((s,x)=>s + Number(x[1]),0);
    if (buys + sells === 0) return 0;
    const imbalance = (buys - sells) / (buys + sells);
    return imbalance * 100;
  } catch(e){ return 0; }
}

// map raw "score" to 0-100 priority
function mapPriority(rawScore, volumeMultiplier=1, priceMovePct=0, ghost=0, newsBoost=0, lowcapBonus=false) {
  // heuristic mapping: rawScore typical range ~0-16 in Python -> scale up and include other factors
  let base = rawScore * 5; // gives 0-80
  base += Math.min(20, (volumeMultiplier - 1) * 20); // volume spike contributes up to +20
  base += Math.min(20, priceMovePct * 10); // price move %
  base += Math.min(15, Math.abs(ghost) * 0.2); // ghost adds modestly
  if (newsBoost) base += 10;
  if (lowcapBonus) base += 5;
  let p = Math.round(Math.max(0, Math.min(100, base)));
  return p;
}

// simple news checker placeholder (could fetch RSS)
async function checkNews(pair) {
  // implement later; return null or { summary, sentiment }
  return null;
}

// in-memory recent signals
const RECENT_SIGNALS_MAX = 100;
function pushSignal(sig) {
  sig.generated_at = nowIso();
  signalsStore.unshift(sig);
  while (signalsStore.length > RECENT_SIGNALS_MAX) signalsStore.pop();
}

// expose API
const app = express();
app.use(express.json());

app.get('/signals', (req, res) => {
  res.json({ generated_at: nowIso(), signals: signalsStore.slice(0,50) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));

// main loop
async function runOnce() {
  const data = await httpGet(INDODAX_SUMMARIES);
  if (!data) return;
  let tickers = data.tickers || data.prices_24h || data;
  if (!tickers) return;

  const pairs = Object.keys(tickers);
  for (const pair of pairs) {
    try {
      if (!pair.toLowerCase().endsWith('idr')) continue;
      const info = tickers[pair] || {};
      const last = Number(info.last || info.last_price || info.price || 0);
      const vol_idr = Number(info.vol_idr || info.volume_idr || info.volume || 0);
      const vol_buy = Number(info.vol_buy || (vol_idr * 0.5));
      const vol_sell = Number(info.vol_sell || (vol_idr * 0.5));
      if (vol_idr < MIN_VOLUME_IDR) continue;

      const now = { last, vol_idr, vol_buy, vol_sell, ts: Date.now() };
      const prevArr = history[pair] || [];
      const prev = prevArr.length ? prevArr[prevArr.length-1] : null;
      addHistory(pair, now);

      // cooldown
      if (lastAlert[pair] && (Date.now() - lastAlert[pair]) < ALERT_COOLDOWN * 1000) continue;

      const candidates = [];
      const fns = [module_scalper, module_micro_pump, module_breakout, module_accumulation, module_rebound, module_lowcap];
      for (const fn of fns) {
        try {
          const res = fn === module_breakout ? fn(pair, now, history[pair]) : fn(pair, now, prev);
          if (res) {
            res.pair = pair;
            res.ghost = await detectGhost(pair).catch(()=>0);
            res.news = await checkNews(pair);
            candidates.push(res);
          }
        } catch(e){
          // ignore module error
        }
      }

      if (candidates.length === 0) continue;

      // compute priority and pick best
      for (const c of candidates) {
        const prevVol = prev ? prev.vol_idr : Math.max(1, now.vol_idr);
        const volMultiplier = now.vol_idr / Math.max(1, prevVol);
        const priceMovePct = prev ? ((now.last - prev.last) / Math.max(1, prev.last)) * 100 : 0;
        const lowcap = now.last < 200;
        const newsBoost = c.news ? 1 : 0;
        c.priority = mapPriority(c.score || 0, volMultiplier, Math.abs(priceMovePct), c.ghost || 0, newsBoost, lowcap);
        c.reasons = [];
        if (volMultiplier > 2.5) c.reasons.push(`volume_x${volMultiplier.toFixed(2)}`);
        if (priceMovePct !== 0) c.reasons.push(`price_${priceMovePct>0?'up':'down'}_${Math.abs(priceMovePct).toFixed(2)}%`);
        if (now.vol_buy && (now.vol_buy / Math.max(1, now.vol_sell)) > 1.4) c.reasons.push(`buy_dom_${Math.round((now.vol_buy/Math.max(1,now.vol_sell))*100)}%`);
        if (lowcap) c.reasons.push('lowcap_bonus');
        if (c.news) { c.reasons.push('news'); }
      }

      const best = candidates.reduce((a,b)=> a.priority>=b.priority ? a : b);

      // threshold: only push >= 60
      if (best.priority >= 60) {
        const signal = {
          pair: best.pair,
          mode: best.mode,
          entry: best.entry,
          tp: best.tp,
          sl: best.sl,
          priority: best.priority,
          reasons: best.reasons,
          ghost: best.ghost || 0,
          news: best.news || null,
          generated_at: nowIso()
        };
        pushSignal(signal);
        // send telegram
        const text = `🚨 SIGNAL — ${signal.mode.toUpperCase()}
Pair: ${signal.pair.toUpperCase()}
Time: ${signal.generated_at}
Entry: ${signal.entry}
TP: ${signal.tp}
SL: ${signal.sl}
Priority: ${signal.priority}
Notes: ${signal.reasons.join(', ')} ghost=${signal.ghost.toFixed?signal.ghost.toFixed(1):signal.ghost}`;
        try {
          await bot.sendMessage(CHAT_ID, text);
        } catch(e){
          console.error('Telegram error', e && e.message);
        }
        lastAlert[pair] = Date.now();
      }

    } catch(e){
      // per-pair error
    }
  }
}

(async function mainLoop(){
  console.log('Super Scanner (Node) started — polling every', POLL_INTERVAL/1000, 's');
  // initial warm run
  try { await runOnce(); } catch(e){}
  setInterval(async ()=>{
    try { await runOnce(); } catch(e){ console.error('Run error', e && e.message); }
  }, POLL_INTERVAL);
})();
