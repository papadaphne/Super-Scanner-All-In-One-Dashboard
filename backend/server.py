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
VOLUME_HISTORY_LEN = 40 # Increased for better indicator calculation
USER_AGENT = 'Mozilla/5.0 (compatible; IndodaxScanner/2.0)'
MAX_SIGNALS_STORED = 20
BB_PERIOD = 20
RSI_PERIOD = 14
VOL_SMA_PERIOD = 20

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

# --- INDICATOR CALCULATION ---
def calculate_rsi(prices, period=RSI_PERIOD):
    if len(prices) < period + 1:
        return 50.0
    
    gains = []
    losses = []
    
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
            
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
    if avg_loss == 0: return 100.0
        
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_bollinger_bands(prices, period=BB_PERIOD, std_dev=2.0):
    if len(prices) < period:
        return None, None, None
    
    # Use the most recent 'period' prices
    relevant_prices = prices[-period:]
    sma = statistics.mean(relevant_prices)
    sd = statistics.stdev(relevant_prices)
    
    upper_band = sma + (sd * std_dev)
    lower_band = sma - (sd * std_dev)
    
    return sma, upper_band, lower_band

def calculate_volume_sma(volumes, period=VOL_SMA_PERIOD):
    if not volumes: return 1
    if len(volumes) < period:
        return statistics.mean(volumes)
    return statistics.mean(volumes[-period:])


# --- SCORING & LEVEL CALCULATION ---
def score_signal(pair, now, prev):
    s = 0
    try:
        if now['last'] > prev['last'] * 1.01: s += 2
        if now['last'] > prev['last'] * 1.03: s += 4
        if now.get('vol_buy', 0) > now.get('vol_sell', 1) * 1.4: s += 3
        if now['last'] < 200: s += 2 # lowcap bonus
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

# --- DETECTION MODULES (Now accept indicators dict) ---
def module_scalper(pair, now, prev, indicators):
    vol_sma = indicators.get('vol_sma', 1)
    # Trigger on price momentum and volume surge over its average
    if now['last'] > prev['last'] * 1.008 and now['vol_idr'] > vol_sma * 2.0:
        entry = round(now['last'] * 0.999)
        tp, sl = calc_levels(entry, 'scalper')
        return {'mode':'scalper','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

def module_micro_pump(pair, now, prev, indicators):
    vol_sma = indicators.get('vol_sma', 1)
    # Stronger price move and very significant volume spike
    if now['last'] > prev['last'] * 1.035 and now['vol_idr'] > vol_sma * 3.0:
        entry = round(now['last'] * 0.995)
        tp, sl = calc_levels(entry, 'normal')
        return {'mode':'micro_pump','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

def module_breakout(pair, now, prev, indicators):
    upper_band = indicators.get('upper_band')
    band_width = indicators.get('band_width', 100)
    # Trigger when price breaks above upper BBand, especially after a squeeze
    if upper_band and now['last'] > upper_band and band_width < 10:
        entry = round(now['last'])
        tp, sl = calc_levels(entry, 'normal')
        return {'mode':'breakout','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

def module_accumulation(pair, now, prev, indicators):
    if now.get('vol_buy',0) > now.get('vol_sell',1) * 1.7 and now['vol_idr'] > prev['vol_idr'] * 1.3:
        entry = round(now['last'])
        tp, sl = calc_levels(entry, 'ghost')
        return {'mode':'accumulation','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

def module_rebound(pair, now, prev, indicators):
    lower_band = indicators.get('lower_band')
    # Look for a bounce from a low price point, potentially near the lower BBand
    if prev['last'] > now['last'] * 1.07 or (lower_band and now['last'] < lower_band):
        entry = round(now['last'])
        tp, sl = calc_levels(entry, 'normal')
        return {'mode':'rebound','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

def module_lowcap(pair, now, prev, indicators):
    vol_sma = indicators.get('vol_sma', 1)
    if now['last'] < 200 and now['vol_idr'] > vol_sma * 4.0:
        entry = round(now['last'])
        tp, sl = calc_levels(entry, 'ghost')
        return {'mode':'lowcap','entry':entry,'tp':tp,'sl':sl,'score':score_signal(pair, now, prev)}
    return None

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
                if vol_idr < MIN_VOLUME_IDR: continue

                now = {'last': last, 'vol_idr': vol_idr}
                prev = history[pair][-1] if history[pair] else None
                history[pair].append(now)

                if not prev: continue

                # --- Calculate All Indicators ---
                price_history = [h['last'] for h in history[pair]]
                volume_history = [h['vol_idr'] for h in history[pair]]
                
                rsi = calculate_rsi(list(price_history))
                middle_band, upper_band, lower_band = calculate_bollinger_bands(list(price_history))
                vol_sma = calculate_volume_sma(list(volume_history))
                
                band_width = 100
                if all([upper_band, lower_band, middle_band]) and middle_band > 0:
                    band_width = ((upper_band - lower_band) / middle_band) * 100
                
                indicators = {
                    'rsi': rsi,
                    'upper_band': upper_band,
                    'lower_band': lower_band,
                    'vol_sma': vol_sma,
                    'band_width': band_width
                }

                candidates = []
                for fn in detection_modules:
                    res = fn(pair, now, prev, indicators)
                    if res:
                        res['pair'] = pair
                        res['ghost'] = detect_ghost_behaviour(pair)
                        res['news'] = False
                        res.update(indicators) # Add all indicators to the result
                        candidates.append(res)

                if not candidates: continue

                for c in candidates:
                    # Base priority
                    c['priority'] = c['score'] + (abs(c.get('ghost',0)) * 0.15)
                    
                    # Volume spike bonus (based on SMA)
                    if now['vol_idr'] > c.get('vol_sma', 1) * 2.5: c['priority'] += 5
                    
                    # RSI adjustment
                    current_rsi = c.get('rsi', 50)
                    if current_rsi < 35: c['priority'] += 5
                    elif current_rsi < 50: c['priority'] += 2
                    elif current_rsi > 70: c['priority'] -= 4
                    
                    # Bollinger Band breakout bonus
                    if c.get('upper_band') and now['last'] > c.get('upper_band'): c['priority'] += 8
                    
                    # Squeeze bonus
                    if c.get('band_width', 100) < 5: c['priority'] += 5

                best = max(candidates, key=lambda x: x['priority'])

                if best['priority'] >= 12: # Higher threshold for higher quality
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
                        "rsi": round(best.get('rsi', 50), 1),
                        "volatility": round(best.get('band_width', 100), 1)
                    }
                    logger.info(f"NEW SIGNAL: {signal['mode'].upper()} on {signal['pair'].upper()} (Priority: {signal['priority']}, RSI: {signal['rsi']}, Volatility: {signal['volatility']}%)")
                    signals_store.appendleft(signal)

            except Exception as e:
                logger.error(f"Error processing {pair}: {e}", exc_info=True)

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
