import time
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
