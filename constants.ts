export const PYTHON_CODE = `"""
Super Scanner Bot — All-in-one
Features:
- Poll Indodax /api/summaries (stability-first)
- Modules: Scalper, Micro Pump, Breakout, Accumulation (Ghost Bandar), Fast Rebound, Lowcap
- News Impact (basic via configurable RSS/webhook list)
- Scoring / prioritization
- Entry / TP / SL calculation
- Telegram alerts
- Config via .env

Run: python3 super_scanner_bot.py
"""

import os
import time
import math
import json
import requests
import statistics
import logging
from collections import defaultdict, deque
from datetime import datetime, timezone
from telegram import Bot
from dotenv import load_dotenv

# load config
load_dotenv()
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
CHAT_ID = os.getenv('CHAT_ID')
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '20'))
MIN_VOLUME_IDR = float(os.getenv('MIN_VOLUME_IDR', '1000000'))
VOLUME_HISTORY_LEN = int(os.getenv('VOLUME_HISTORY_LEN', '12'))
USER_AGENT = os.getenv('USER_AGENT', 'Mozilla/5.0 (compatible; IndodaxScanner/2.0)')
ALERT_COOLDOWN = int(os.getenv('ALERT_COOLDOWN', '240'))
NEWS_SOURCES = os.getenv('NEWS_SOURCES', '')  # comma separated RSS/JSON endpoints (optional)

# safety
if not TELEGRAM_TOKEN or not CHAT_ID:
    print('Please set TELEGRAM_TOKEN and CHAT_ID in .env')
    exit(1)

bot = Bot(token=TELEGRAM_TOKEN)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('super_scanner')

INDODAX_SUMMARIES = 'https://indodax.com/api/summaries'
INDODAX_TRADES = 'https://indodax.com/api/trades/{}'  # pair
INDODAX_ORDERBOOK = 'https://indodax.com/api/depth/{}'  # pair

# memory
history = defaultdict(lambda: deque(maxlen=VOLUME_HISTORY_LEN))
last_alert = defaultdict(lambda: 0)

# util

def now_ts():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')


def safe_get(url, params=None, retries=3):
    headers = {'User-Agent': USER_AGENT}
    for _ in range(retries):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=6)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    logger.debug('Invalid JSON from %s', url)
            else:
                logger.debug('Status %s from %s', r.status_code, url)
        except requests.RequestException as e:
            logger.debug('Request err %s', e)
        time.sleep(0.3)
    return None


def send_alert(text):
    try:
        bot.send_message(chat_id=CHAT_ID, text=text)
    except Exception as e:
        logger.error('Telegram send failed: %s', e)

# Scoring for priority

def score_signal(pair, now, prev):
    s = 0
    try:
        # price moves
        if now['last'] > prev['last'] * 1.01: s += 2
        if now['last'] > prev['last'] * 1.03: s += 4
        # volume strength
        if now['vol_idr'] > prev['vol_idr'] * 1.5: s += 3
        if now['vol_idr'] > prev['vol_idr'] * 2.5: s += 5
        # buy pressure
        if now.get('vol_buy', 0) > now.get('vol_sell', 1) * 1.4: s += 3
        if now.get('vol_buy', 0) > now.get('vol_sell', 1) * 2.0: s += 5
        # lowcap bonus
        if now['last'] < 200: s += 2
    except Exception:
        pass
    return s

# helpers for entry/TP/SL based on ATR-like simple rule

def calc_levels(entry, mode='scalper'):
    if mode == 'scalper':
        tp = round(entry * 1.035, 6)
        sl = round(entry * 0.992, 6)
        return tp, sl
    elif mode == 'ghost':
        tp = round(entry * 1.10, 6)
        sl = round(entry * 0.987, 6)
        return tp, sl
    elif mode == 'news':
        tp = round(entry * 1.12, 6)
        sl = round(entry * 0.985, 6)
    else:
        tp = round(entry * 1.06, 6)
        sl = round(entry * 0.99, 6)
    return tp, sl

# Detection modules

def module_scalper(pair, now, prev):
    # micro momentum + volume
    try:
        if now['last'] > prev['last'] * 1.008 and now['vol_idr'] > prev['vol_idr'] * 1.25:
            entry = round(now['last'] * 0.999)
            tp, sl = calc_levels(entry, 'scalper')
            return {'mode':'scalper','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except:
        return None


def module_micro_pump(pair, now, prev):
    try:
        if now['last'] > prev['last'] * 1.035 and now['vol_idr'] > prev['vol_idr'] * 1.8:
            entry = round(now['last'] * 0.995)
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'micro_pump','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except:
        return None


def module_breakout(pair, now, hist):
    try:
        if len(hist) < 10: return None
        prices = [h['last'] for h in hist]
        dev = statistics.pstdev(prices)
        # normalized dev threshold
        if dev < (prices[-1] * 0.006) and now['last'] > prices[-1] * 1.02:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'breakout','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, hist[-2])}
    except:
        return None


def module_accumulation(pair, now, prev):
    try:
        if now.get('vol_buy',0) > now.get('vol_sell',1) * 1.7 and now['vol_idr'] > prev['vol_idr'] * 1.3:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'ghost')
            return {'mode':'accumulation','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except:
        return None


def module_rebound(pair, now, prev):
    try:
        if prev['last'] > now['last'] * 1.07 and now['vol_idr'] > prev['vol_idr'] * 1.4:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'rebound','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except:
        return None


def module_lowcap(pair, now, prev):
    try:
        if now['last'] < 200 and now['vol_idr'] > prev['vol_idr'] * 3:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'ghost')
            return {'mode':'lowcap','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except:
        return None

# Ghost bandar detection: approximate by trades/orderbook behavior

def detect_ghost_behaviour(pair):
    # best-effort: check orderbook imbalance quickly
    ob = safe_get(INDODAX_ORDERBOOK.format(pair))
    if not ob: return 0
    try:
        buy = sum([float(x[1]) for x in ob.get('buy',[])[:8]])
        sell = sum([float(x[1]) for x in ob.get('sell',[])[:8]])
        if buy+sell == 0: return 0
        imbalance = (buy - sell) / (buy + sell)
        return imbalance * 100
    except:
        return 0

# News Impact: minimal implementation - check keyword match on passed sources

def check_news_for_pair(pair):
    # placeholder: if NEWS_SOURCES set, we could fetch and search for token symbol or name
    # For now, return None (no news). You can extend this to call RSS/JSON and compute sentiment.
    return None

# main loop

logger.info('Super scanner started — polling every %s seconds', POLL_INTERVAL)
while True:
    data = safe_get(INDODAX_SUMMARIES)
    if not data:
        time.sleep(POLL_INTERVAL)
        continue

    # summaries shape: data['tickers'] or data['prices_24h'] etc. Try both
    tickers = None
    if isinstance(data, dict) and 'tickers' in data:
        tickers = data['tickers']
    elif isinstance(data, dict) and 'prices_24h' in data:
        tickers = data['prices_24h']
    else:
        tickers = data

    for pair, info in list(tickers.items()):
        try:
            if not pair.endswith('idr'):
                continue
            # normalize: many endpoints have different keys
            last = float(info.get('last') or info.get('last_price') or info.get('price') or 0)
            vol_idr = float(info.get('vol_idr') or info.get('volume_idr') or info.get('volume') or 0)
            # estimate vol buy/sell if available
            vol_buy = float(info.get('vol_buy', vol_idr * 0.5))
            vol_sell = float(info.get('vol_sell', vol_idr * 0.5))
            if vol_idr < MIN_VOLUME_IDR:
                continue

            now = {'last': last, 'vol_idr': vol_idr, 'vol_buy': vol_buy, 'vol_sell': vol_sell}
            prev = None
            if history[pair]:
                prev = history[pair][-1]
            history[pair].append(now)

            # skip cooldown
            if time.time() - last_alert[pair] < ALERT_COOLDOWN:
                continue

            # run modules
            candidates = []
            for fn in (module_scalper, module_micro_pump, module_breakout, module_accumulation, module_rebound, module_lowcap):
                try:
                    res = fn(pair, now, prev if fn!=module_breakout else history[pair])
                    if res:
                        # attach ghost score and news
                        res['pair'] = pair
                        try:
                            res['ghost'] = detect_ghost_behaviour(pair)
                        except:
                            res['ghost'] = 0
                        res['news'] = check_news_for_pair(pair)
                        candidates.append(res)
                except Exception as e:
                    logger.debug('Module error %s', e)

            if not candidates:
                continue

            # prioritize by score + ghost + news
            for c in candidates:
                # boost score if ghost imbalance strong
                c['priority'] = c['score'] + (abs(c.get('ghost',0)) * 0.15)
                # news boost
                if c.get('news'):
                    c['priority'] += 8

            # choose best
            best = max(candidates, key=lambda x: x['priority'])

            # apply threshold, only send strong signals
            if best['priority'] >= 6:
                text = (
                    f"🚨 SIGNAL — {best['mode'].upper()}
"
                    f"Pair: {best['pair'].upper()}
"
                    f"Time: {now_ts()}
"
                    f"Entry: {best['entry']}
"
                    f"TP: {best['tp']}
"
                    f"SL: {best['sl']}
"
                    f"Priority: {best['priority']:.1f}
"
                    f"Notes: ghost={best.get('ghost',0):.1f}, news={'yes' if best.get('news') else 'no'}"
                )
                send_alert(text)
                last_alert[pair] = time.time()

        except Exception as e:
            logger.debug('Processing error %s %s', pair, e)

    time.sleep(POLL_INTERVAL)
`;

export const AI_PROMPT = `You are an automated crypto market scanner assistant for Indodax. Every time you run, you'll receive a JSON payload of per-pair summaries from Indodax (/api/summaries). Your job:
1) Normalize each pair that ends with 'idr'.
2) Calculate last price, 24h volume (in IDR), buy/sell ratio if available.
3) Compute the following signals: scalper, micro_pump, breakout, accumulation, rebound, lowcap.
4) For each detected signal, compute a priority score (0-100) using volume spike, price move, buy/sell imbalance, and lowcap bonus.
5) Output only signals with priority >= 60 as an array of objects.

Output format (JSON):
{
  "generated_at": "2025-11-15T12:00:00Z",
  "signals": [
    {
      "pair": "btc_idr",
      "mode": "scalper",
      "entry": 823000000,
      "tp": 850000000,
      "sl": 815000000,
      "priority": 87,
      "reasons": ["volume_x2.5","price_up_1.2%","buy_dom_65%"]
    }
  ]
}

Constraints:
- Use only fields present in the supplied summaries payload or public news endpoints.
- When news is included, add a "news" field with short summary and sentiment score.
- Keep runtime per run under 90 seconds.

Provide a short example output using the format above.`;

export const AI_EXAMPLE_OUTPUT = `{
  "generated_at": "2025-11-15T12:00:00Z",
  "signals": [
    {
      "pair": "btc_idr",
      "mode": "scalper",
      "entry": 823000000,
      "tp": 850000000,
      "sl": 815000000,
      "priority": 87,
      "reasons": ["volume_x2.5","price_up_1.2%","buy_dom_65%"]
    },
    {
      "pair": "eth_idr",
      "mode": "accumulation",
      "entry": 56000000,
      "tp": 61000000,
      "sl": 55200000,
      "priority": 72,
      "reasons": ["strong_buy_imbalance","low_volatility"]
    }
  ]
}`;

export const PINE_SCRIPT_CODE = `//@version=5
indicator('SuperScanner Quick', overlay=true)
len = input.int(20, 'EMA Length')
ema = ta.ema(close, len)
bb = ta.bb(close, 20, 2)
// breakout detection: narrow BB then break
bb_width = bb[0] - bb[1]
narrow = ta.stdev(close, 20) < ta.lowest(ta.stdev(close,20), 50) * 1.02
breakout = narrow and close > ta.highest(high, 12)
plotshape(breakout, title='Breakout', location=location.abovebar, color=color.green, style=shape.triangleup)
// scalper signal: quick 1-3% up + volume spike
vol_surge = volume > ta.sma(volume, 20) * 1.8
scalper = close > close[1] * 1.01 and vol_surge
plotshape(scalper, title='Scalper', location=location.belowbar, color=color.orange, style=shape.circle)
plot(ema, color=color.blue)`;

export const SYSTEMD_CODE = `[Unit]
Description=Super Scanner Bot
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/super_scanner
ExecStart=/usr/bin/python3 /home/ubuntu/super_scanner/super_scanner_bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

export const DEPLOYMENT_COMMANDS = `sudo systemctl daemon-reload
sudo systemctl enable super_scanner
sudo systemctl start super_scanner
sudo journalctl -u super_scanner -f`;

export const TELEGRAM_SETUP_TEXT = `The Python bot sends alerts via Telegram. To set it up, you need to create a \`.env\` file in the same directory as the script with the following content:

TELEGRAM_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
CHAT_ID="YOUR_TELEGRAM_CHAT_ID"

Replace the placeholder values with your actual bot token and the chat ID where you want to receive alerts. You can also configure other parameters like \`POLL_INTERVAL\` and \`MIN_VOLUME_IDR\` in this file.`;

export const BACKEND_CODE = `import time
import threading
import uuid
import requests
import statistics
import logging
from collections import defaultdict, deque
from datetime import datetime, timezone
from flask import Flask, jsonify
from flask_cors import CORS

# --- CONFIGURATION ---
POLL_INTERVAL = 15
MIN_VOLUME_IDR = 1000000
VOLUME_HISTORY_LEN = 12
USER_AGENT = 'Mozilla/5.0 (compatible; IndodaxScanner/2.0)'
MAX_SIGNALS_STORED = 20

# --- LOGGING SETUP ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('super_scanner_backend')

# --- FLASK APP SETUP ---
app = Flask(__name__)
CORS(app)

# --- GLOBAL IN-MEMORY DATA STORE ---
signals_store = deque(maxlen=MAX_SIGNALS_STORED)
history = defaultdict(lambda: deque(maxlen=VOLUME_HISTORY_LEN))

# --- API URLS ---
INDODAX_SUMMARIES = 'https://indodax.com/api/summaries'
INDODAX_ORDERBOOK = 'https://indodax.com/api/depth/{}'  # pair

# --- UTILITY FUNCTIONS ---
def now_ts():
    return datetime.now(timezone.utc).strftime('%H:%M:%S')

def safe_get(url, params=None, retries=3):
    headers = {'User-Agent': USER_AGENT}
    for _ in range(retries):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=6)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    logger.debug('Invalid JSON from %s', url)
            else:
                logger.debug('Status %s from %s', r.status_code, url)
        except requests.RequestException as e:
            logger.debug('Request err %s', e)
        time.sleep(0.3)
    return None

# --- SCORING & LEVEL CALCULATION ---
def score_signal(pair, now, prev):
    s = 0
    try:
        if now['last'] > prev['last'] * 1.01: s += 2
        if now['last'] > prev['last'] * 1.03: s += 4
        if now['vol_idr'] > prev['vol_idr'] * 1.5: s += 3
        if now['vol_idr'] > prev['vol_idr'] * 2.5: s += 5
        if now.get('vol_buy', 0) > now.get('vol_sell', 1) * 1.4: s += 3
        if now.get('vol_buy', 0) > now.get('vol_sell', 1) * 2.0: s += 5
        if now['last'] < 200: s += 2
    except Exception:
        pass
    return s

def calc_levels(entry, mode='scalper'):
    if mode == 'scalper':
        tp, sl = round(entry * 1.035, 6), round(entry * 0.992, 6)
    elif mode == 'ghost':
        tp, sl = round(entry * 1.10, 6), round(entry * 0.987, 6)
    else:
        tp, sl = round(entry * 1.06, 6), round(entry * 0.99, 6)
    return tp, sl

# --- DETECTION MODULES ---
def module_scalper(pair, now, prev):
    try:
        if now['last'] > prev['last'] * 1.008 and now['vol_idr'] > prev['vol_idr'] * 1.25:
            entry = round(now['last'] * 0.999)
            tp, sl = calc_levels(entry, 'scalper')
            return {'mode':'scalper','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except: return None

def module_micro_pump(pair, now, prev):
    try:
        if now['last'] > prev['last'] * 1.035 and now['vol_idr'] > prev['vol_idr'] * 1.8:
            entry = round(now['last'] * 0.995)
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'micro_pump','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except: return None

def module_breakout(pair, now, hist):
    try:
        if len(hist) < 10: return None
        prices = [h['last'] for h in hist]
        dev = statistics.pstdev(prices)
        if dev < (prices[-1] * 0.006) and now['last'] > prices[-1] * 1.02:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'breakout','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, hist[-2])}
    except: return None

def module_accumulation(pair, now, prev):
    try:
        if now.get('vol_buy',0) > now.get('vol_sell',1) * 1.7 and now['vol_idr'] > prev['vol_idr'] * 1.3:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'ghost')
            return {'mode':'accumulation','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except: return None

def module_rebound(pair, now, prev):
    try:
        if prev['last'] > now['last'] * 1.07 and now['vol_idr'] > prev['vol_idr'] * 1.4:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'normal')
            return {'mode':'rebound','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except: return None

def module_lowcap(pair, now, prev):
    try:
        if now['last'] < 200 and now['vol_idr'] > prev['vol_idr'] * 3:
            entry = round(now['last'])
            tp, sl = calc_levels(entry, 'ghost')
            return {'mode':'lowcap','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    except: return None

def detect_ghost_behaviour(pair):
    ob = safe_get(INDODAX_ORDERBOOK.format(pair))
    if not ob: return 0
    try:
        buy = sum([float(x[1]) for x in ob.get('buy',[])[:8]])
        sell = sum([float(x[1]) for x in ob.get('sell',[])[:8]])
        if buy + sell == 0: return 0
        imbalance = (buy - sell) / (buy + sell)
        return round(imbalance * 100, 1)
    except: return 0

# --- MAIN SCANNER WORKER THREAD ---
def scanner_worker():
    logger.info(f"Scanner worker started, polling every {POLL_INTERVAL} seconds.")
    
    detection_modules = (module_scalper, module_micro_pump, module_breakout, module_accumulation, module_rebound, module_lowcap)

    while True:
        data = safe_get(INDODAX_SUMMARIES)
        if not (data and 'tickers' in data):
            time.sleep(POLL_INTERVAL)
            continue
        
        for pair, info in data['tickers'].items():
            try:
                if not pair.endswith('idr'): continue
                
                last = float(info.get('last', 0))
                vol_idr = float(info.get('vol_idr', 0))
                vol_buy = float(info.get('vol_buy', vol_idr * 0.5))
                vol_sell = float(info.get('vol_sell', vol_idr * 0.5))
                if vol_idr < MIN_VOLUME_IDR: continue

                now = {'last': last, 'vol_idr': vol_idr, 'vol_buy': vol_buy, 'vol_sell': vol_sell}
                prev = history[pair][-1] if history[pair] else None
                history[pair].append(now)

                if not prev: continue

                candidates = []
                for fn in detection_modules:
                    res = fn(pair, now, prev if fn != module_breakout else history[pair])
                    if res:
                        res['pair'] = pair
                        res['ghost'] = detect_ghost_behaviour(pair)
                        res['news'] = False # News check not implemented
                        candidates.append(res)

                if not candidates: continue

                for c in candidates:
                    c['priority'] = c['score'] + (abs(c.get('ghost',0)) * 0.15)
                
                best = max(candidates, key=lambda x: x['priority'])

                if best['priority'] >= 6:
                    signal = {
                        "id": str(uuid.uuid4()),
                        "mode": best['mode'],
                        "pair": best['pair'],
                        "time": now_ts(),
                        "entry": best['entry'],
                        "tp": best['tp'],
                        "sl": best['sl'],
                        "priority": round(best['priority'], 1),
                        "ghost": best.get('ghost', 0),
                        "news": best.get('news', False),
                    }
                    logger.info(f"NEW SIGNAL: {signal['mode'].upper()} on {signal['pair'].upper()} (Priority: {signal['priority']})")
                    signals_store.appendleft(signal)

            except Exception as e:
                logger.error(f"Error processing {pair}: {e}", exc_info=False)

        time.sleep(POLL_INTERVAL)

# --- FLASK API ENDPOINT ---
@app.route('/api/signals')
def get_signals():
    return jsonify(list(signals_store))

if __name__ == '__main__':
    print("--- Super-Scanner Live Backend ---")
    scanner_thread = threading.Thread(target=scanner_worker, daemon=True)
    scanner_thread.start()
    
    logger.info("Starting Flask server on http://127.0.0.1:5000")
    logger.info("Dashboard will connect to this server to get live signals.")
    app.run(host='0.0.0.0', port=5000, debug=False)
`;
