"""
app.py — CoinScanner Main Application
=======================================
This is the heart of the CoinScanner Flask app.
It handles every URL route, all API calls, user auth,
and the watchlist feature.

HOW FLASK WORKS (quick primer):
  - A "route" is a URL pattern + a Python function.
  - When someone visits /coins, Flask calls the coins() function.
  - That function fetches data, then calls render_template()
    which fills in the HTML template and sends it to the browser.

DATA FLOW:
  Browser → Flask route → fetch from APIs → render HTML → Browser

PRICE DATA SOURCES:
  1. CoinDCX  → live INR prices (free, no key, updates every 60s)
  2. CoinDCX → coin metadata, logos (CryptoCompare CDN), prices (primary for all coins)
     Global market stats → CoinGecko /api/v3/global only (1 call/5min, rarely blocked)  3. If CoinDCX has the coin → use that price (more accurate INR)
     If not → fall back to CoinGecko's INR price

CACHING:
  API calls are expensive (slow + rate-limited). We cache results
  in memory using simple Python dicts. Thread locks prevent two
  requests from fetching at the same time (race condition).

  Cache durations:
    Prices     → 60 seconds  (live feel)
    Metadata   → 24 hours    (logos/mcap don't change often)
    Global     → 5 minutes   (market stats)
    News       → 30 minutes  (news doesn't update that fast)
    Movers     → 60 seconds  (same as prices)
"""

import os
import time
import random
import threading
from functools import wraps

import requests
from flask import (
    Flask, render_template, session, url_for,
    request, redirect, jsonify, abort
)
from werkzeug.security import generate_password_hash, check_password_hash
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

# Import our own modules
import mock_data as data           # static exchange data (compare page)
from database import init_db, get_db_connection, purge_old_logs

# ── Load environment variables from .env file ──────────────
# Variables like SECRET_KEY and NEWS_API_KEY live in .env
# Never hardcode secrets in source code!
load_dotenv()

# ══════════════════════════════════════════════════════════
# APP SETUP
# ══════════════════════════════════════════════════════════
app = Flask(__name__)

# SECRET_KEY is required — used to sign session cookies.
# If missing, raise an error immediately rather than running insecurely.
_secret = os.environ.get("SECRET_KEY")
if not _secret:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set.\n"
        "Add it to your .env file:\n"
        "  SECRET_KEY=some-long-random-string\n"
        "Generate one with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
    )
app.secret_key = _secret

# ── Cookie security settings ───────────────────────────────
# HttpOnly: JS cannot read the session cookie (XSS protection)
# SameSite: Cookie not sent on cross-site requests (CSRF protection)
# Secure:   Cookie only sent over HTTPS — enabled in production only
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE']   = os.environ.get('FLASK_ENV') == 'production'

# CoinDCX API credentials — for authenticated endpoints (candles, market data)
# Generate at: https://coindcx.com/settings/api
COINDCX_API_KEY = os.environ.get("COINDCX_API_KEY", "")
COINDCX_SECRET  = os.environ.get("COINDCX_SECRET",  "")

# News API key (newsdata.io) — optional, news page shows nothing without it
NEWS_API_KEY   = os.environ.get("NEWS_API_KEY")

# Resend API key — for OTP email delivery (signup + forgot password)
# Sign up free at: https://resend.com (3,000 emails/month free)
# If not set, OTPs are console-logged only (development mode)
RESEND_API_KEY   = os.environ.get("RESEND_API_KEY")

# Fast2SMS API key — for OTP SMS delivery to Indian phone numbers
# Sign up free at: https://www.fast2sms.com (50 free credits on signup)
# If not set, SMS OTPs are printed to terminal only (development mode)
FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY")


# ══════════════════════════════════════════════════════════
# SECURITY HEADERS
# Added to every HTTP response automatically.
# These tell the browser to be extra careful about security.
# ══════════════════════════════════════════════════════════
@app.after_request
def set_security_headers(response):
    """
    Add security headers to every response.

    X-Content-Type-Options: Stops browser from guessing file types.
    X-Frame-Options:        Prevents the site being embedded in iframes
                            (clickjacking protection).
    Referrer-Policy:        Controls how much info is sent when clicking links.
    """
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"]        = "SAMEORIGIN"
    response.headers["Referrer-Policy"]        = "strict-origin-when-cross-origin"
    return response


# ══════════════════════════════════════════════════════════
# IN-MEMORY CACHE
# Each cache is a dict with:
#   "data"      → the cached result
#   "timestamp" → when it was last fetched (Unix time)
#
# _cache_lock prevents two threads updating the same cache
# simultaneously (thread safety with Gunicorn).
# ══════════════════════════════════════════════════════════
_cache_lock  = threading.Lock()

PRICE_CACHE  = {"data": {},           "timestamp": 0}  # CoinDCX live prices
META_CACHE   = {"data": {},           "timestamp": 0}  # CoinGecko metadata
GLOBAL_CACHE = {"data": {},           "timestamp": 0}  # CoinGecko global stats
NEWS_CACHE   = {"data": [],           "timestamp": 0}  # newsdata.io articles
MARKET_CACHE = {"data": ([], [], []), "timestamp": 0}  # gainers/losers/picks


# ══════════════════════════════════════════════════════════
# COINGECKO ID → COINDCX SYMBOL MAP
#
# CoinGecko uses slugs like "bitcoin", "ethereum".
# CoinDCX uses trading symbols like "BTC", "ETH".
# This map lets us look up the CoinDCX price for a CoinGecko coin.
# If a coin isn't in this map, we fall back to CoinGecko's price.
# ══════════════════════════════════════════════════════════
COINGECKO_TO_DCX = {
    "bitcoin":          "BTC",
    "ethereum":         "ETH",
    "ripple":           "XRP",
    "solana":           "SOL",
    "binancecoin":      "BNB",
    "cardano":          "ADA",
    "dogecoin":         "DOGE",
    "tron":             "TRX",
    "avalanche-2":      "AVAX",
    "chainlink":        "LINK",
    "polkadot":         "DOT",
    "litecoin":         "LTC",
    "near":             "NEAR",
    "uniswap":          "UNI",
    "stellar":          "XLM",
    "mantle":           "MNT",
    "matic-network":    "MATIC",
    "shiba-inu":        "SHIB",
    "the-open-network": "TON",
    "pi-network":       "PI",
    "leo-token":        "LEO",
    "wrapped-bitcoin":  "WBTC",
    "okb":              "OKB",
    "cosmos":           "ATOM",
    "monero":           "XMR",
    "ethereum-classic": "ETC",
    "filecoin":         "FIL",
    "aptos":            "APT",
    "hedera-hashgraph": "HBAR",
}


# ══════════════════════════════════════════════════════════
# COINDCX AUTH HELPER
# CoinDCX authenticated endpoints require HMAC-SHA256 signing.
# ══════════════════════════════════════════════════════════

import hmac as _hmac
import hashlib as _hashlib
import json as _json

def _dcx_auth_headers(body: dict) -> dict:
    """
    Build CoinDCX authentication headers for private API endpoints.

    CoinDCX uses HMAC-SHA256:
      1. JSON-encode the request body
      2. Sign with your secret key using SHA256
      3. Send X-AUTH-APIKEY + X-AUTH-SIGNATURE headers

    Args:
        body (dict): JSON payload for the request
    Returns:
        dict — headers to merge into your requests.post() call
    """
    body_json = _json.dumps(body, separators=(",", ":")).encode("utf-8")
    secret    = COINDCX_SECRET.encode("utf-8")
    signature = _hmac.new(secret, body_json, _hashlib.sha256).hexdigest()
    return {
        "Content-Type":     "application/json",
        "X-AUTH-APIKEY":    COINDCX_API_KEY,
        "X-AUTH-SIGNATURE": signature,
    }


# ══════════════════════════════════════════════════════════
# API FUNCTIONS — PRICE & METADATA
# ══════════════════════════════════════════════════════════

def get_dcx_prices():
    """
    Fetch live INR prices from CoinDCX (free, no API key needed).

    CoinDCX returns all trading pairs. We filter for INR pairs only
    (e.g. BTCINR, ETHINR) and build a dict keyed by symbol.

    Cached for 60 seconds to avoid hammering the API.

    Returns:
        dict — { "BTC": { last_price, change_24h, high, low, volume, bid, ask }, ... }
    """
    # Return cached data if it's still fresh (under 60 seconds old)
    with _cache_lock:
        if time.time() - PRICE_CACHE["timestamp"] < 60:
            return PRICE_CACHE["data"]

    try:
        res = requests.get("https://api.coindcx.com/exchange/ticker", timeout=10)
        res.raise_for_status()
        tickers = res.json()
    except Exception as e:
        # If API fails, return whatever we had before (could be empty dict on first run)
        app.logger.warning("CoinDCX price error: %s", e)
        return PRICE_CACHE["data"]

    price_map = {}
    for t in tickers:
        market = t.get("market", "")
        # We only care about INR pairs (BTCINR, ETHINR, etc.)
        if market.endswith("INR"):
            symbol = market.replace("INR", "")   # "BTCINR" → "BTC"
            price_map[symbol] = {
                "last_price": float(t.get("last_price",     0) or 0),
                "change_24h": float(t.get("change_24_hour", 0) or 0),
                "high":       float(t.get("high",           0) or 0),
                "low":        float(t.get("low",            0) or 0),
                "volume":     float(t.get("volume",         0) or 0),
                "bid":        float(t.get("bid",            0) or 0),
                "ask":        float(t.get("ask",            0) or 0),
            }

    # Update cache with fresh data
    with _cache_lock:
        PRICE_CACHE["data"]      = price_map
        PRICE_CACHE["timestamp"] = time.time()
    return price_map


def get_coin_metadata():
    """
    Build coin metadata entirely from CoinDCX public APIs — no CoinGecko needed.

    Sources:
      1. GET /exchange/v1/markets_details  — coin name, symbol, base currency
      2. GET /exchange/ticker              — live price, 24h change, high, low, volume
      3. CryptoCompare image CDN           — coin logos (free, no rate limiting)

    We only include INR pairs so all prices are in ₹.
    Market cap is not available from CoinDCX — shown as "—" in templates.

    Cached for 5 minutes (balances freshness vs API load).

    Returns:
        dict — { "BTC": { id, name, symbol, image, ... }, ... } keyed by DCX symbol
    """
    with _cache_lock:
        if time.time() - META_CACHE["timestamp"] < 300:   # 5 min cache
            return META_CACHE["data"]

    # ── Step 1: Get market details (name, base currency) ──
    try:
        res = requests.get(
            "https://api.coindcx.com/exchange/v1/markets_details",
            timeout=15
        )
        res.raise_for_status()
        markets = res.json()
    except Exception as e:
        app.logger.warning("CoinDCX markets_details error: %s", e)
        return META_CACHE["data"]

    # ── Step 2: Get live ticker data ──
    try:
        res2 = requests.get(
            "https://api.coindcx.com/exchange/ticker",
            timeout=10
        )
        res2.raise_for_status()
        tickers = res2.json()
    except Exception as e:
        app.logger.warning("CoinDCX ticker error: %s", e)
        return META_CACHE["data"]

    # Build ticker map keyed by market (e.g. "BTCINR")
    ticker_map = {}
    for t in tickers:
        market = t.get("market", "")
        if market.endswith("INR"):
            ticker_map[market] = t

    # ── Step 3: Build metadata map ──
    # Only include INR spot markets, deduplicate by base symbol
    seen_symbols = set()
    meta_map     = {}

    # Sort by volume descending so highest-volume coin wins on duplicates
    inr_markets = [
        m for m in markets
        if m.get("pair", "").endswith("INR")
        and m.get("status") == "active"
        and m.get("coind_code")  # has a valid symbol
    ]

    for m in inr_markets:
        symbol   = m.get("base_currency_short_name", "").upper()  # e.g. "BTC"
        name     = m.get("base_currency_name", symbol)            # e.g. "Bitcoin"
        pair     = m.get("pair", "")                              # e.g. "BTCINR"
        coind_cd = m.get("coind_code", symbol).upper()

        if not symbol or symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)

        # Get live ticker for this pair
        t = ticker_map.get(pair, {})

        price     = float(t.get("last_price",     0) or 0)
        change    = float(t.get("change_24_hour", 0) or 0)
        high      = float(t.get("high",           0) or 0)
        low       = float(t.get("low",            0) or 0)
        volume    = float(t.get("volume",         0) or 0)

        # CryptoCompare logo — reliable CDN, no auth needed
        image = f"https://www.cryptocompare.com/media/generate/png/icon/{symbol.lower()}"

        meta_map[symbol] = {
            "id":                 symbol,           # use symbol as ID (e.g. "BTC")
            "name":               name,
            "symbol":             symbol,
            "image":              image,
            "market_cap":         0,                # not available from CoinDCX
            "market_cap_rank":    0,
            "ath":                0,
            "atl":                0,
            "circulating_supply": 0,
            "total_supply":       0,
            "sparkline":          [],               # fetched separately via candles
            "cg_price":           price,
            "cg_change_24h":      change,
            "cg_volume":          volume,
            "cg_high":            high,
            "cg_low":             low,
            "pair":               pair,             # e.g. "BTCINR" — for candles API
        }

    with _cache_lock:
        META_CACHE["data"]      = meta_map
        META_CACHE["timestamp"] = time.time()
    app.logger.info("CoinDCX metadata built — %d INR coins", len(meta_map))
    return meta_map


def get_global_stats():
    """
    Fetch global crypto market stats from CoinGecko.

    Returns overall market cap, BTC dominance, active coins, etc.
    Used on the home page hero band and header stats.

    Cached for 5 minutes.

    Returns:
        dict — { total_market_cap_inr, btc_dominance, active_coins, ... }
    """
    with _cache_lock:
        if time.time() - GLOBAL_CACHE["timestamp"] < 300:   # 300s = 5 minutes
            return GLOBAL_CACHE["data"]

    try:
        res = requests.get("https://api.coingecko.com/api/v3/global", timeout=10)
        res.raise_for_status()
        raw = res.json().get("data", {})
    except Exception as e:
        app.logger.warning("CoinGecko global error: %s", e)
        return GLOBAL_CACHE["data"]

    stats = {
        "total_market_cap_inr": raw.get("total_market_cap", {}).get("inr", 0),
        "total_market_cap_usd": raw.get("total_market_cap", {}).get("usd", 0),
        "total_volume_inr":     raw.get("total_volume",     {}).get("inr", 0),
        "btc_dominance":        round(raw.get("market_cap_percentage", {}).get("btc", 0), 1),
        "active_coins":         raw.get("active_cryptocurrencies", 0),
        "markets":              raw.get("markets", 0),
    }

    with _cache_lock:
        GLOBAL_CACHE["data"]      = stats
        GLOBAL_CACHE["timestamp"] = time.time()
    return stats


# ══════════════════════════════════════════════════════════
# COIN BUILDER — merge DCX + CoinGecko into one unified dict
# ══════════════════════════════════════════════════════════

def build_coin(symbol, meta, prices):
    """
    Build a unified coin dict from CoinDCX metadata + live ticker price.

    Since metadata is now sourced from CoinDCX markets_details + ticker,
    both meta and prices are keyed by symbol (e.g. "BTC").

    Args:
        symbol (str):  CoinDCX symbol, e.g. "BTC"
        meta   (dict): metadata entry from get_coin_metadata()
        prices (dict): price map from get_dcx_prices()

    Returns:
        dict — all fields a template needs to display a coin row/card
    """
    dcx    = prices.get(symbol, {})

    # Use live ticker price if available, else fall back to meta snapshot
    price  = dcx.get("last_price")  or meta.get("cg_price", 0)
    change = dcx.get("change_24h")  if dcx else meta.get("cg_change_24h", 0)
    volume = dcx.get("volume")      or meta.get("cg_volume", 0)
    high   = dcx.get("high")        or meta.get("cg_high", 0)
    low    = dcx.get("low")         or meta.get("cg_low", 0)
    change = float(change or 0)
    mcap   = meta.get("market_cap", 0)

    return {
        "id":                          symbol,
        "name":                        meta["name"],
        "symbol":                      symbol,
        "image":                       meta["image"],
        "current_price":               float(price or 0),
        "formatted_price":             format_inr(price),
        "price_change_percentage_24h": change,
        "formatted_volume":            format_volume(volume),
        "formatted_mcap":              "—",           # not available from CoinDCX
        "total_volume":                float(volume or 0),
        "high_24h":                    float(high or 0),
        "low_24h":                     float(low or 0),
        "market_cap":                  0,
        "market_cap_rank":             0,
        "ath":                         0,
        "atl":                         0,
        "circulating_supply":          0,
        "total_supply":                0,
        "sparkline_in_7d":             {"price": meta.get("sparkline", [])},
        "pair":                        meta.get("pair", f"{symbol}INR"),
        "price_source":                "coindcx",
    }


def get_market_movers():
    """
    Return the top 5 gainers, losers, and picks (by market cap rank).

    Results are derived from the already-cached metadata + prices,
    so this is fast. We cache the sorted result for 60 seconds.

    Returns:
        tuple — (gainers, losers, picks)  each is a list of 5 coin dicts
    """
    with _cache_lock:
        if time.time() - MARKET_CACHE["timestamp"] < 60:
            return MARKET_CACHE["data"]

    prices  = get_dcx_prices()
    meta    = get_coin_metadata()
    if not meta:
        return [], [], []

    # Build all coins, then sort 3 ways
    coins   = [build_coin(sym, m, prices) for sym, m in meta.items()]
    gainers = sorted(coins, key=lambda x: x["price_change_percentage_24h"], reverse=True)[:5]
    losers  = sorted(coins, key=lambda x: x["price_change_percentage_24h"])[:5]
    # Picks = highest volume (proxy for popularity since no market cap rank)
    picks   = sorted(coins, key=lambda x: x["total_volume"], reverse=True)[:5]

    with _cache_lock:
        MARKET_CACHE["data"]      = (gainers, losers, picks)
        MARKET_CACHE["timestamp"] = time.time()
    return gainers, losers, picks


# ══════════════════════════════════════════════════════════
# NUMBER FORMATTERS
# These convert raw numbers to human-readable INR strings.
# Used in build_coin() and directly in templates.
# ══════════════════════════════════════════════════════════

def format_volume(num):
    """
    Format a raw INR volume number into a short readable string.

    Uses Indian number system (Lakh Crore, Crore, Lakh, K).

    Examples:
        85_000_000_000_000  → "₹8.50 L.Cr"  (8.5 lakh crore)
        4_200_000_000       → "₹420.00 Cr"
        950_000             → "₹9.50 L"
        18_000              → "₹18.00 K"
        500                 → "₹500"
    """
    if num is None: return "0"
    try:   num = float(num)
    except: return "0"

    if num >= 1_00_000_00_00_000: return f"₹{num / 1_00_000_00_00_000:.2f} L.Cr"
    if num >= 1_00_00_000:        return f"₹{num / 1_00_00_000:.2f} Cr"
    if num >= 1_00_000:           return f"₹{num / 1_00_000:.2f} L"
    if num >= 1_000:              return f"₹{num / 1_000:.2f} K"
    return f"₹{int(num)}"


def format_mcap(num):
    """
    Format a raw INR market cap into a short readable string.

    Market caps are always large so we only need the top 2 tiers.

    Examples:
        1_68_00_000_00_00_000  → "₹1.68 L.Cr"  (Bitcoin-level)
        4_50_00_00_000         → "₹4,500 Cr"
        8_00_00_000            → "₹8.0 Cr"
        50_000                 → "—"  (too small to be meaningful)
    """
    if num is None or num == 0: return "—"
    try:   num = float(num)
    except: return "—"

    LAKH_CR = 1_00_000_00_00_000   # 10 trillion = 1 lakh crore

    if num >= LAKH_CR:
        return f"₹{num / LAKH_CR:.2f} L.Cr"

    if num >= 1_00_00_000:         # 1 crore = 10 million
        cr = num / 1_00_00_000
        # Add comma for large crore values: "₹4,500 Cr" instead of "₹4500 Cr"
        return f"₹{cr:,.0f} Cr" if cr >= 1000 else f"₹{cr:.1f} Cr"

    return "—"   # below 1 crore is negligible / likely bad data


def format_inr(num):
    """
    Format a coin price using the Indian number system.

    Indian format uses commas differently from Western format:
      Western: 1,234,567.89
      Indian:  12,34,567.89  (last 3 digits, then groups of 2)

    Examples:
        8500000.50  → "85,00,000.50"
        1250.75     → "1,250.75"
        0.00042     → "0.00"   (very small coins shown as-is)

    Args:
        num: any number (int, float, or numeric string)
    Returns:
        str — formatted price without ₹ symbol (templates add the ₹)
    """
    if num is None: return "0"
    try:   num = float(num)
    except: return "0"

    s       = f"{num:,.2f}"
    parts   = s.split(".")
    integer = parts[0].replace(",", "")
    decimal = parts[1]

    # Numbers ≤ 999 don't need Indian-style grouping
    if len(integer) <= 3:
        return f"{integer}.{decimal}"

    # Indian grouping: last 3 digits, then groups of 2 from the right
    last3 = integer[-3:]
    rest  = integer[:-3]
    chunks = []
    while len(rest) > 2:
        chunks.insert(0, rest[-2:])
        rest = rest[:-2]
    if rest:
        chunks.insert(0, rest)
    return f"{','.join(chunks)},{last3}.{decimal}"


# ══════════════════════════════════════════════════════════
# NEWS — newsdata.io
# ══════════════════════════════════════════════════════════

def get_crypto_news():
    """
    Fetch crypto news from newsdata.io.

    newsdata.io free tier: 200 requests/day, 10 results/page.
    We cache for 30 minutes to stay well within limits.

    Field mapping (newsdata.io format):
        title       → article title
        description → short summary
        content     → full text (often truncated)
        image_url   → thumbnail image
        link        → URL to original article
        pubDate     → publish date string
        source_id   → source name (e.g. "coindesk")
        source_url  → source website

    Returns:
        list — list of article dicts, or empty list if API key missing/fails
    """
    # If no API key is configured, return empty (news page will show "unavailable")
    if not NEWS_API_KEY:
        app.logger.warning("NEWS_API_KEY not set — news page will be empty")
        return []

    # Return cached data if fresh (under 30 minutes old)
    with _cache_lock:
        if time.time() - NEWS_CACHE["timestamp"] < 1800:
            return NEWS_CACHE["data"]

    url    = "https://newsdata.io/api/1/news"
    params = {
        "apikey":   NEWS_API_KEY,
        "q":        "cryptocurrency OR bitcoin OR ethereum OR crypto",
        "language": "en",
        "category": "business,technology",
    }

    try:
        res = requests.get(url, params=params, timeout=10)
        res.raise_for_status()
        response_data = res.json()
    except Exception as e:
        app.logger.warning("newsdata.io error: %s", e)
        return NEWS_CACHE["data"]   # return stale cache on failure

    # newsdata.io returns { "status": "success", "results": [...] }
    if response_data.get("status") != "success":
        app.logger.warning("newsdata.io bad status: %s", response_data.get("status"))
        return NEWS_CACHE["data"]

    articles = response_data.get("results", [])

    with _cache_lock:
        NEWS_CACHE["data"]      = articles
        NEWS_CACHE["timestamp"] = time.time()

    app.logger.info("newsdata.io refreshed — %d articles cached", len(articles))
    return articles


# ══════════════════════════════════════════════════════════
# AUTH DECORATOR
# Protects routes that require login.
# Usage:
#   @app.route("/profile")
#   @login_required
#   def profile():
#       ...
# ══════════════════════════════════════════════════════════

def login_required(f):
    """
    Decorator that redirects unauthenticated users to the login page.

    Also stores the page they were trying to visit in ?next=
    so after login they're sent back to where they wanted to go.

    Additionally verifies the session version against the database —
    if the user changed their password, all old sessions are invalidated
    immediately even if they haven't expired yet.

    Example: visiting /profile while logged out →
             redirected to /login?next=/profile →
             after login → redirected back to /profile
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = session.get("user_id")
        if not uid:
            return redirect(url_for("login", next=request.path))

        # Session version check — invalidates sessions after password reset
        sv = session.get("sv")
        if sv is not None:
            try:
                conn  = get_db_connection()
                row   = conn.execute(
                    "SELECT session_version FROM users WHERE id = ?", (uid,)
                ).fetchone()
                conn.close()
                if not row or row["session_version"] != sv:
                    session.clear()
                    return redirect(url_for("login", next=request.path))
            except Exception:
                pass  # DB error — allow through, don't lock user out

        return f(*args, **kwargs)
    return decorated


# ══════════════════════════════════════════════════════════
# ERROR HANDLERS
# These run when Flask encounters an error.
# Returns a proper HTML page instead of a raw error string.
# ══════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    """Handle 404 Not Found — page doesn't exist."""
    return render_template("errors/404.html"), 404


@app.errorhandler(500)
def server_error(e):
    """Handle 500 Internal Server Error — something crashed."""
    app.logger.error("500 error: %s", e)
    return render_template("errors/500.html"), 500


# ══════════════════════════════════════════════════════════
# PUBLIC ROUTES
# These pages are accessible without logging in.
# ══════════════════════════════════════════════════════════

@app.route("/")
def home():
    """
    Home page — the main dashboard.

    Fetches:
      - Top 6 news articles (sidebar)
      - Market movers: 5 gainers, 5 losers, 5 top picks
      - Global market stats (total market cap, BTC dominance)
      - Top 25 coins by market cap for the coin table

    Template: templates/public/home.html
    """
    news                   = get_crypto_news()[:6]
    gainers, losers, picks = get_market_movers()
    global_stats           = get_global_stats()
    prices                 = get_dcx_prices()
    meta                   = get_coin_metadata()
    all_coins              = [build_coin(sym, m, prices) for sym, m in meta.items()]
    # Sort by volume descending (proxy for importance since CoinDCX has no market cap rank)
    top_coins              = sorted(all_coins, key=lambda x: x["total_volume"], reverse=True)[:25]

    return render_template(
        "public/home.html",
        page="home",
        top_gainers=gainers,
        top_losers=losers,
        top_picks=picks,
        top_coins=top_coins,
        articles=news,
        global_stats=global_stats,
        year=2026,
    )


@app.route("/compare")
def compare():
    """
    Compare Exchanges page.

    Data comes from mock_data.py (static exchange info).
    No live API calls on this page.

    Template: templates/public/compare.html
    """
    exchanges = data.get_exchanges()
    insights  = data.get_insights()
    return render_template(
        "public/compare.html",
        exchanges=exchanges,
        insights=insights,
        page="compare",
    )


@app.route("/coins")
def coins():
    """
    Coins listing page — full table/card view of all 50 coins.

    Supports ?view=table (default) or ?view=card to switch layout.
    Also computes movers (gainers/losers/picks) for the strip at top.

    Template: templates/public/coins.html
    """
    prices = get_dcx_prices()
    meta   = get_coin_metadata()

    # If metadata fetch failed entirely, show empty state
    if not meta:
        return render_template(
            "public/coins.html",
            coins=[], gainers=[], losers=[], picks=[],
            page="coins", active_view="table"
        )

    all_coins   = [build_coin(sym, m, prices) for sym, m in meta.items()]
    all_coins   = sorted(all_coins, key=lambda x: x["total_volume"], reverse=True)

    # Mover strips at the top of the coins page
    gainers     = sorted(all_coins, key=lambda x: x["price_change_percentage_24h"], reverse=True)[:5]
    losers      = sorted(all_coins, key=lambda x: x["price_change_percentage_24h"])[:5]
    picks       = all_coins[:5]

    # URL param: /coins?view=card  or  /coins?view=table (default)
    active_view = request.args.get("view", "table")

    return render_template(
        "public/coins.html",
        coins=all_coins,
        gainers=gainers,
        losers=losers,
        picks=picks,
        page="coins",
        active_view=active_view,
    )


@app.route("/api/coins")
def api_coins():
    """
    JSON endpoint for infinite scroll on the coins page.

    Uses already-cached metadata — zero extra API calls.
    Slices the cached 250 coins by page.

    Query params:
        ?page=1          (1-indexed, default 1)
        ?per_page=25     (default 25, max 100)
        ?currency=inr    (inr or usd, default inr)

    Returns:
        { coins: [...], page: N, per_page: 25, total: 250, has_more: bool }
    """
    try:
        page     = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 25))))
        currency = request.args.get("currency", "inr")
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid params"}), 400

    prices    = get_dcx_prices()
    meta      = get_coin_metadata()
    all_coins = [build_coin(sym, m, prices) for sym, m in meta.items()]
    all_coins = sorted(all_coins, key=lambda x: x["total_volume"], reverse=True)

    total  = len(all_coins)
    start  = (page - 1) * per_page
    end    = start + per_page
    slice_ = all_coins[start:end]

    # Apply USD conversion if requested (approximate, exchange-rate fallback)
    if currency == "usd":
        try:
            res     = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=5)
            inr_usd = res.json().get("rates", {}).get("INR", 83)
        except Exception:
            inr_usd = 83
        for c in slice_:
            if c.get("current_price"):
                c["current_price_usd"] = round(c["current_price"] / inr_usd, 6)

    # Serialise only what the frontend needs (keep payload small)
    def slim(c):
        sparkline_prices = []
        sp = c.get("sparkline_in_7d")
        if isinstance(sp, dict):
            sparkline_prices = sp.get("price", [])
        elif isinstance(c.get("sparkline"), list):
            sparkline_prices = c.get("sparkline", [])
        return {
            "id":                          c.get("id"),
            "name":                        c.get("name"),
            "symbol":                      c.get("symbol"),
            "image":                       c.get("image"),
            "current_price":               c.get("current_price"),
            "formatted_price":             c.get("formatted_price"),
            "price_change_percentage_24h": c.get("price_change_percentage_24h"),
            "price_change_percentage_7d":  c.get("price_change_percentage_7d_in_currency"),
            "market_cap":                  c.get("market_cap"),
            "formatted_mcap":              c.get("formatted_mcap"),
            "total_volume":                c.get("total_volume"),
            "formatted_volume":            c.get("formatted_volume"),
            "market_cap_rank":             c.get("market_cap_rank"),
            "high_24h":                    c.get("high_24h"),
            "low_24h":                     c.get("low_24h"),
            "ath":                         c.get("ath"),
            "circulating_supply":          c.get("circulating_supply"),
            "sparkline":                   sparkline_prices,
        }

    return jsonify({
        "coins":    [slim(c) for c in slice_],
        "page":     page,
        "per_page": per_page,
        "total":    total,
        "has_more": end < total,
    })


@app.route("/api/coins/<symbol>/chart")
def api_coin_chart(symbol):
    """
    Return 7-day (or N-day) OHLCV chart data for a coin from CoinDCX candles.

    Used by home.js modal sparkline and coin.js detail chart.
    Returns { prices: [[timestamp_ms, price], ...] } — same shape as CoinGecko
    so existing Chart.js rendering code works without changes.

    Query params:
        currency (str): "inr" or "usd" (default: "inr")
        days     (int): number of days of history (default: 7, max: 30)
    """
    symbol   = symbol.upper()
    currency = request.args.get("currency", "inr").lower()
    try:
        days = min(30, max(1, int(request.args.get("days", 7))))
    except (ValueError, TypeError):
        days = 7

    try:
        res = requests.get(
            "https://public.coindcx.com/market_data/candles/",
            params={
                "pair":     f"B-{symbol}_INR",
                "interval": "1d",
                "limit":    days,
            },
            timeout=10,
        )
        res.raise_for_status()
        candles = res.json()
        # CoinDCX candle format: [time, open, high, low, close, volume]
        prices = [
            [int(c[0]) * 1000, float(c[4])]
            for c in candles if len(c) >= 5
        ]

        # Convert to USD if requested
        if currency == "usd" and prices:
            try:
                fx  = requests.get(
                    "https://api.exchangerate-api.com/v4/latest/USD", timeout=5
                ).json()
                inr_per_usd = fx.get("rates", {}).get("INR", 84.5)
                prices = [[t, p / inr_per_usd] for t, p in prices]
            except Exception:
                pass   # return INR prices as fallback

        return jsonify({"prices": prices})

    except Exception as e:
        app.logger.warning("Chart API error for %s: %s", symbol, e)
        return jsonify({"prices": []}), 200   # empty but valid — JS handles it gracefully


@app.route("/coin/<coin_id>")
def coin_page(coin_id):
    """
    Individual coin detail page (e.g. /coin/BTC).

    Fetches price + candle data from CoinDCX.
    Global stats and trending still use CoinGecko (1 call/5min, not rate-limited).

    Args:
        coin_id (str): CoinDCX symbol from the URL, e.g. "BTC"

    Template: templates/public/coin.html
    """
    # Security: only allow alphanumeric + hyphens in coin_id
    if not all(c.isalnum() or c == "-" for c in coin_id):
        abort(404)

    # Validate currency parameter
    currency = request.args.get("currency", "inr").lower()
    if currency not in ("inr", "usd"):
        currency = "inr"

    # Get CoinDCX metadata + prices
    meta    = get_coin_metadata()
    prices  = get_dcx_prices()

    # coin_id in URL is the DCX symbol (e.g. "BTC") — uppercase it
    symbol  = coin_id.upper()
    m       = meta.get(symbol)

    if not m:
        abort(404)

    dcx   = prices.get(symbol, {})
    price = dcx.get("last_price") or m.get("cg_price", 0)
    change= dcx.get("change_24h") if dcx else m.get("cg_change_24h", 0)
    high  = dcx.get("high")       or m.get("cg_high", 0)
    low   = dcx.get("low")        or m.get("cg_low", 0)
    volume= dcx.get("volume")     or m.get("cg_volume", 0)

    # Fetch 7-day candles from CoinDCX for the chart
    pair       = m.get("pair", f"{symbol}INR")
    chart_prices = []
    try:
        candle_url = "https://public.coindcx.com/market_data/candles/"
        candle_res = requests.get(candle_url, params={
            "pair":     f"B-{symbol}_INR",
            "interval": "1d",
            "limit":    7,
        }, timeout=10)
        if candle_res.status_code == 200:
            candles = candle_res.json()
            # CoinDCX candle format: [time, open, high, low, close, volume]
            chart_prices = [
                [int(c[0]) * 1000, float(c[4])]   # [timestamp_ms, close_price]
                for c in candles if len(c) >= 5
            ]
    except Exception as e:
        app.logger.warning("CoinDCX candles error for %s: %s", symbol, e)

    # Build coin_data dict that coin.html template expects
    coin_data = {
        "id":           symbol,
        "name":         m["name"],
        "symbol":       symbol,
        "image":        {"large": m["image"]},
        "price_source": "coindcx",
        "market_data": {
            "current_price":                {"inr": price, "usd": 0},
            "price_change_percentage_24h":  float(change or 0),
            "high_24h":                     {"inr": high},
            "low_24h":                      {"inr": low},
            "total_volume":                 {"inr": volume},
            "market_cap":                   {"inr": 0},
            "circulating_supply":           0,
            "total_supply":                 0,
            "ath":                          {"inr": 0},
            "atl":                          {"inr": 0},
        },
        "description":  {"en": ""},
        "links": {
            "homepage":           [],
            "whitepaper":         "",
            "subreddit_url":      "",
            "repos_url":          {"github": []},
        },
        "developer_data": {},
        "community_data": {},
    }

    return render_template(
        "public/coin.html",
        coin=coin_data,
        chart_prices=chart_prices,
        currency=currency,
        page="coin",
    )


@app.route("/news")
def news():
    """
    News listing page — shows all fetched articles.

    Template: templates/public/news.html
    """
    articles = get_crypto_news()
    return render_template("public/news.html", articles=articles, page="news")


@app.route("/news/<int:article_id>")
def news_detail(article_id):
    """
    Individual news article detail page.

    Articles are stored in a list, accessed by index.
    If the index is out of range, return 404.

    Args:
        article_id (int): index in the articles list (0-based)

    Template: templates/public/news_detail.html
    """
    articles = get_crypto_news()
    if article_id < 0 or article_id >= len(articles):
        abort(404)
    return render_template(
        "public/news_detail.html",
        article=articles[article_id],
        page="news",
    )


@app.route("/about")
def about():
    """About / landing page. Template: templates/public/about.html"""
    return render_template("public/about.html", page="about", year=2026)


@app.route("/investors")
def investors():
    """Investor relations page. Template: templates/public/investors.html"""
    return render_template("public/investors.html", page="investors", year=2026)


# ── Stub pages — footer links must not 404 ─────────────
@app.route("/terms")
def terms():
    """Terms of Service page (content coming soon)."""
    return render_template("public/terms.html", page="terms", year=2026)


@app.route("/privacy")
def privacy():
    """Privacy Policy page (content coming soon)."""
    return render_template("public/privacy.html", page="privacy", year=2026)


@app.route("/disclaimer")
def disclaimer():
    """Disclaimer page (content coming soon)."""
    return render_template("public/disclaimer.html", page="disclaimer", year=2026)


# ══════════════════════════════════════════════════════════
# AUTH HELPERS
# Shared utilities used by the auth routes below.
# ══════════════════════════════════════════════════════════

def send_otp_email(to_email, otp, purpose="signup"):
    """
    Send an OTP to the user's email via Resend.

    Falls back to console logging if RESEND_API_KEY is not set —
    so local development works without any email configuration.

    Args:
        to_email (str): Recipient email address
        otp      (str): The 6-digit OTP code
        purpose  (str): "signup" or "reset" — controls subject + body text
    """
    if purpose == "signup":
        subject  = "Your CoinScanner verification code"
        heading  = "Verify your account"
        body_txt = "Use the code below to verify your CoinScanner account."
        note_txt = "This code expires in 5 minutes."
    else:
        subject  = "CoinScanner password reset code"
        heading  = "Reset your password"
        body_txt = "Use the code below to reset your CoinScanner password."
        note_txt = "This code expires in 5 minutes. If you didn't request this, ignore this email."

    html_body = f"""
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;
                background:#F8FAFC;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-size:22px;font-weight:800;letter-spacing:1px;color:#0F172A;">
          COIN SCANNER
        </span>
      </div>
      <h2 style="font-size:20px;font-weight:700;color:#0F172A;margin-bottom:8px;">
        {heading}
      </h2>
      <p style="font-size:14px;color:#64748B;margin-bottom:24px;">{body_txt}</p>
      <div style="background:#ffffff;border:2px solid #E2E8F0;border-radius:10px;
                  padding:20px;text-align:center;margin-bottom:20px;">
        <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#1D4ED8;">
          {otp}
        </span>
      </div>
      <p style="font-size:12px;color:#94A3B8;text-align:center;">{note_txt}</p>
      <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;">
      <p style="font-size:11px;color:#CBD5E1;text-align:center;">
        CoinScanner · Agreed Financial Tech Pvt. Ltd.<br>
        This is an automated message. Do not reply.
      </p>
    </div>
    """

    if not RESEND_API_KEY:
        # Development fallback — log to console
        print(f"\n==================================================\n[DEV OTP] {purpose.upper()} code for {to_email}: {otp}\n==================================================\n", flush=True)
        return

    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from":    "CoinScanner <noreply@coinscanner.tech>",
            "to":      [to_email],
            "subject": subject,
            "html":    html_body,
        })
        app.logger.info("OTP email sent to %s (purpose=%s)", to_email, purpose)
    except Exception as e:
        # Log the error but don't crash — OTP is already saved in DB
        app.logger.error("Resend email failed for %s: %s", to_email, e)


def send_otp_sms(phone, otp, purpose="signup"):
    """
    Send an OTP to the user's phone via Fast2SMS.

    Falls back to terminal print if FAST2SMS_API_KEY is not set —
    so local development works without SMS configuration.

    Args:
        phone   (str): Indian phone number (10 digits, no +91)
        otp     (str): The 6-digit OTP code
        purpose (str): "signup" or "reset"
    """
    # Normalise phone — strip +91 or leading 0 if present
    phone = phone.strip().lstrip("+")
    if phone.startswith("91") and len(phone) == 12:
        phone = phone[2:]

    if purpose == "signup":
        message = f"Your CoinScanner verification code is {otp}. Valid for 5 minutes. Do not share."
    else:
        message = f"Your CoinScanner password reset code is {otp}. Valid for 5 minutes. Do not share."

    if not FAST2SMS_API_KEY:
        # Development fallback — print to terminal
        print(
            f"\n==================================================\n"
            f"[DEV SMS OTP] {purpose.upper()} code for {phone}: {otp}\n"
            f"==================================================\n",
            flush=True
        )
        return

    try:
        res = requests.post(
            "https://www.fast2sms.com/dev/bulkV2",
            headers={"authorization": FAST2SMS_API_KEY},
            json={
                "route":    "otp",
                "variables_values": otp,
                "flash":    0,
                "numbers":  phone,
            },
            timeout=10
        )
        data = res.json()
        if data.get("return"):
            app.logger.info("SMS OTP sent to %s (purpose=%s)", phone, purpose)
        else:
            app.logger.warning("Fast2SMS failed for %s: %s", phone, data)
    except Exception as e:
        app.logger.error("Fast2SMS error for %s: %s", phone, e)


def log_login_attempt(ip, identifier, success, reason):
    """
    Record a login attempt to the login_log table.

    Args:
        ip         (str):  Client IP address
        identifier (str):  Email/phone that was entered
        success    (bool): True if login succeeded
        reason     (str):  Outcome — "success", "wrong_password",
                           "not_found", "locked", "not_verified"
    """
    try:
        conn = get_db_connection()
        conn.execute(
            "INSERT INTO login_log (ip, identifier, success, reason, timestamp)"
            " VALUES (?, ?, ?, ?, ?)",
            (ip, identifier, 1 if success else 0, reason, int(time.time()))
        )
        conn.commit()
        conn.close()
    except Exception as e:
        app.logger.warning("login_log write failed: %s", e)


# ══════════════════════════════════════════════════════════
# AUTH ROUTES
# Signup → Verify OTP → Login → Logout
# Also: Forgot Password → Verify OTP → Reset Password
# ══════════════════════════════════════════════════════════

@app.route("/login", methods=["GET", "POST"])
def login():
    """
    Login page.

    GET:  Show the login form.
    POST: Validate credentials, create session, redirect home.

    Security features:
      - DB-based lockout: 3 failed attempts → 10 minute lock
      - Login attempt logging (IP + identifier + outcome)
      - Session rotation: session.clear() before setting new session
      - Session version stored in session for invalidation on password change

    Session variables set on success:
        session["user_id"]    = user's database ID
        session["user_email"] = user's email address
        session["sv"]         = session_version (for invalidation checks)

    Template: templates/auth/login.html
    """
    # Already logged in → go home
    if session.get("user_id"):
        return redirect(url_for("home"))

    error = None
    ip    = request.remote_addr or "unknown"

    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        password   = request.form.get("password", "")

        if not identifier or not password:
            error = "Please enter your email/phone and password."
        else:
            conn   = get_db_connection()
            cursor = conn.cursor()
            # Allow login with either email or phone number
            cursor.execute(
                "SELECT * FROM users WHERE email = ? OR phone = ? LIMIT 1",
                (identifier, identifier)
            )
            user = cursor.fetchone()

            if not user:
                # User doesn't exist — generic message prevents enumeration
                conn.close()
                log_login_attempt(ip, identifier, False, "not_found")
                error = "Invalid email/phone or password."

            elif (user["locked_until"] or 0) > int(time.time()):
                # Account is temporarily locked
                remaining = int(((user["locked_until"] or 0) - time.time()) / 60) + 1
                conn.close()
                log_login_attempt(ip, identifier, False, "locked")
                error = (
                    f"Too many failed attempts. "
                    f"Account locked for {remaining} more minute{'s' if remaining != 1 else ''}."
                )

            elif not check_password_hash(user["password_hash"], password):
                # Wrong password — increment failed attempts, lock if ≥ 3
                new_attempts = (user["failed_attempts"] or 0) + 1
                lock_until   = 0
                if new_attempts >= 3:
                    lock_until = int(time.time()) + 600  # 10 minutes
                cursor.execute(
                    "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                    (new_attempts, lock_until, user["id"])
                )
                conn.commit()
                conn.close()
                log_login_attempt(ip, identifier, False, "wrong_password")
                if lock_until:
                    error = "Too many failed attempts. Account locked for 10 minutes."
                else:
                    error = "Invalid email/phone or password."

            else:
                # ✅ Login successful
                # Reset failed attempts counter
                cursor.execute(
                    "UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?",
                    (user["id"],)
                )
                conn.commit()
                conn.close()

                log_login_attempt(ip, identifier, True, "success")

                # Session rotation — clear any existing session first
                # prevents session fixation attacks
                session.clear()
                session["user_id"]    = user["id"]
                session["user_email"] = user["email"]
                session["sv"]         = user["session_version"] or 0

                # Remember me: extend session lifetime to 30 days
                if request.form.get("remember"):
                    app.permanent_session_lifetime = 60 * 60 * 24 * 30
                    session.permanent = True

                # Redirect back to the page they were trying to visit
                next_page = request.args.get("next", "")
                if next_page and next_page.startswith("/") and not next_page.startswith("//"):
                    return redirect(next_page)
                return redirect(url_for("home"))

    return render_template("auth/login.html", error=error)


@app.route("/signup", methods=["GET", "POST"])
def signup():
    """
    Signup — collects name, email, phone, password.
    Generates two separate OTPs:
      - email_otp  → sent to email via Resend
      - phone_otp  → sent to phone via Fast2SMS
    Both stored in DB. User must verify both before account is active.
    """
    if session.get("user_id"):
        return redirect(url_for("home"))

    error = None
    if request.method == "POST":
        name             = request.form.get("name", "").strip()
        email            = request.form.get("email", "").strip().lower()
        phone            = request.form.get("phone", "").strip()
        password         = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not name or not email or not phone or not password:
            error = "All fields are required."
        elif not all(c.isalpha() or c.isspace() for c in name):
            error = "Name must contain letters only — no numbers or special characters."
        elif password != confirm_password:
            error = "Passwords do not match."
        elif len(password) < 8:
            error = "Password must be at least 8 characters."
        else:
            conn   = get_db_connection()
            cursor = conn.cursor()

            # Step 1 — check verified duplicates FIRST, before touching anything
            cursor.execute(
                "SELECT id FROM users WHERE email = ? AND is_verified = 1 LIMIT 1",
                (email,)
            )
            if cursor.fetchone():
                conn.close()
                error = "An account with this email already exists."
            else:
                cursor.execute(
                    "SELECT id FROM users WHERE phone = ? AND is_verified = 1 LIMIT 1",
                    (phone,)
                )
                if cursor.fetchone():
                    conn.close()
                    error = "An account with this mobile number already exists."
                else:
                    # Step 2 — no verified account found, safe to clean up stale rows
                    cursor.execute(
                        "DELETE FROM users WHERE (email = ? OR phone = ?) AND is_verified = 0",
                        (email, phone)
                    )
                    conn.commit()

                    # Step 3 — create new account
                    hashed_pw = generate_password_hash(password, method="pbkdf2:sha256")
                    expiry    = int(time.time()) + 300

                    email_otp = str(random.randint(100000, 999999))
                    phone_otp = str(random.randint(100000, 999999))
                    while phone_otp == email_otp:
                        phone_otp = str(random.randint(100000, 999999))

                    try:
                        cursor.execute(
                            "INSERT INTO users "
                            "(name, email, phone, password_hash, "
                            " email_otp, email_otp_expiry, "
                            " phone_otp, phone_otp_expiry) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (name, email, phone, hashed_pw,
                             email_otp, expiry, phone_otp, expiry)
                        )
                        conn.commit()
                    except Exception as e:
                        error = "Could not create account. Please try again."
                        app.logger.error("Signup insert error: %s", e)
                    finally:
                        conn.close()

                    if not error:
                        send_otp_email(email, email_otp, purpose="signup")
                        send_otp_sms(phone, phone_otp, purpose="signup")
                        return redirect(url_for("verify_email", email=email))

    return render_template("auth/signup.html", error=error,
        form_name=request.form.get("name", ""),
        form_email=request.form.get("email", ""),
        form_phone=request.form.get("phone", ""),
    )


@app.route("/verify-email", methods=["GET", "POST"])
def verify_email():
    """
    Step 1 of 2 — verify email OTP sent at signup.
    On success → redirect to verify_phone.
    """
    email = request.args.get("email", "").strip()
    if not email:
        return redirect(url_for("signup"))

    error = None
    if request.method == "POST":
        entered = request.form.get("otp", "").strip()
        conn    = get_db_connection()
        cursor  = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user    = cursor.fetchone()

        if not user:
            conn.close()
            return redirect(url_for("signup"))

        if not entered:
            error = "Please enter the OTP."
        elif int(time.time()) > (user["email_otp_expiry"] or 0):
            error = "OTP has expired. Please sign up again."
        elif user["email_otp"] != entered:
            error = "Incorrect OTP. Please try again."
        else:
            cursor.execute(
                "UPDATE users SET email_verified = 1, email_otp = NULL, email_otp_expiry = NULL"
                " WHERE email = ?",
                (email,)
            )
            conn.commit()
            conn.close()
            return redirect(url_for("verify_phone", email=email))

        conn.close()

    return render_template(
        "auth/verify_email.html",
        email=email,
        masked=email[:2] + "****" + email[email.index("@"):],
        error=error,
        step=1
    )


@app.route("/verify-phone", methods=["GET", "POST"])
def verify_phone():
    """
    Step 2 of 2 — verify phone OTP sent at signup.
    On success → mark account fully verified → auto-login → home.
    """
    email = request.args.get("email", "").strip()
    if not email:
        return redirect(url_for("signup"))

    error = None
    if request.method == "POST":
        entered = request.form.get("otp", "").strip()
        conn    = get_db_connection()
        cursor  = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user    = cursor.fetchone()

        if not user:
            conn.close()
            return redirect(url_for("signup"))

        # Make sure email was verified first
        if not user["email_verified"]:
            conn.close()
            return redirect(url_for("verify_email", email=email))

        if not entered:
            error = "Please enter the OTP."
        elif int(time.time()) > (user["phone_otp_expiry"] or 0):
            error = "OTP has expired. Please sign up again."
        elif user["phone_otp"] != entered:
            error = "Incorrect OTP. Please try again."
        else:
            # Both verified — mark account active
            cursor.execute(
                "UPDATE users SET phone_verified = 1, is_verified = 1,"
                " phone_otp = NULL, phone_otp_expiry = NULL"
                " WHERE email = ?",
                (email,)
            )
            conn.commit()

            # Auto-login — no need to go to login page
            session.clear()
            session["user_id"]    = user["id"]
            session["user_email"] = user["email"]
            session["sv"]         = user["session_version"] or 0
            conn.close()
            return redirect(url_for("home"))

        conn.close()

    # Mask phone for display
    conn   = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT phone FROM users WHERE email = ?", (email,))
    row    = cursor.fetchone()
    conn.close()
    masked_phone = ""
    if row and row["phone"]:
        p = row["phone"]
        masked_phone = p[:2] + "******" + p[-2:]

    return render_template(
        "auth/verify_phone.html",
        email=email,
        masked_phone=masked_phone,
        error=error,
        step=2
    )


# Keep /verify as alias → redirects to /verify-email for backward compat
@app.route("/verify", methods=["GET", "POST"])
def verify():
    email = request.args.get("email", "")
    return redirect(url_for("verify_email", email=email))


@app.route("/logout")
def logout():
    """
    Log out the current user.

    Clears the entire session (removes user_id, user_email, etc.)
    and redirects to the home page.
    """
    session.clear()
    return redirect(url_for("home"))


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    """
    Forgot Password — Step 1: Enter email or phone.

    Security: Always redirects to OTP page regardless of whether
    the account exists — prevents user enumeration attacks.
    If the email/phone is not registered, no OTP is sent but
    the user sees the same response either way.

    Template: templates/auth/forgot_password.html
    """
    error = None
    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        if not identifier:
            error = "Please enter your email or phone number."
        else:
            conn   = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM users WHERE email = ? OR phone = ? LIMIT 1",
                (identifier, identifier)
            )
            user = cursor.fetchone()

            # Always store identifier and redirect — never reveal if account exists
            session["reset_identifier"] = identifier

            if user:
                # Account found — generate OTP and send via email
                otp    = str(random.randint(100000, 999999))
                expiry = int(time.time()) + 300
                cursor.execute(
                    "UPDATE users SET otp_code = ?, otp_expiry = ? WHERE id = ?",
                    (otp, expiry, user["id"])
                )
                conn.commit()
                send_otp_email(identifier, otp, purpose="reset")
            # No else — silently do nothing if account doesn't exist

            conn.close()
            return redirect(url_for("verify_reset_otp"))

    return render_template("auth/forgot_password.html", error=error)


@app.route("/verify-reset-otp", methods=["GET", "POST"])
def verify_reset_otp():
    """
    Forgot Password — Step 2: Verify OTP.

    Reads identifier from session (set in forgot_password).
    On success → store verified user ID in session → redirect to reset.

    Template: templates/auth/verify_reset_otp.html
    """
    identifier = session.get("reset_identifier")
    if not identifier:
        return redirect(url_for("forgot_password"))

    error = None
    if request.method == "POST":
        entered_otp = request.form.get("otp", "").strip()
        conn        = get_db_connection()
        cursor      = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE email = ? OR phone = ? LIMIT 1",
            (identifier, identifier)
        )
        user = cursor.fetchone()
        conn.close()

        if not user:
            return redirect(url_for("forgot_password"))

        if not entered_otp:
            error = "Please enter the OTP."
        elif int(time.time()) > (user["otp_expiry"] or 0):
            error = "OTP has expired. Please request a new one."
        elif user["otp_code"] != entered_otp:
            error = "Incorrect OTP. Please try again."
        else:
            # ✅ OTP verified — let them set a new password
            session["reset_verified_id"] = user["id"]
            session.pop("reset_identifier", None)
            return redirect(url_for("reset_password"))

    return render_template(
        "auth/verify_reset_otp.html",
        identifier=identifier,
        error=error,
    )


@app.route("/resend-reset-otp", methods=["POST"])
def resend_reset_otp():
    """
    Resend a new OTP for password reset.
    Generates a fresh OTP and resets the 5-minute expiry.
    """
    identifier = session.get("reset_identifier")
    if not identifier:
        return redirect(url_for("forgot_password"))

    otp    = str(random.randint(100000, 999999))
    expiry = int(time.time()) + 300
    conn   = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET otp_code = ?, otp_expiry = ? WHERE email = ? OR phone = ?",
        (otp, expiry, identifier, identifier)
    )
    conn.commit()
    conn.close()
    send_otp_email(identifier, otp, purpose="reset")
    return redirect(url_for("verify_reset_otp"))


@app.route("/reset-password", methods=["GET", "POST"])
def reset_password():
    """
    Forgot Password — Step 3: Set new password.

    Only accessible after OTP verification (requires reset_verified_id in session).

    Template: templates/auth/reset_password.html
    """
    user_id = session.get("reset_verified_id")
    if not user_id:
        return redirect(url_for("forgot_password"))

    error = None
    if request.method == "POST":
        new_pw     = request.form.get("new_password", "")
        confirm_pw = request.form.get("confirm_password", "")

        if not new_pw or not confirm_pw:
            error = "Both fields are required."
        elif new_pw != confirm_pw:
            error = "Passwords do not match."
        elif len(new_pw) < 8:
            error = "Password must be at least 8 characters."
        else:
            conn   = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE users SET password_hash = ?, otp_code = NULL, otp_expiry = NULL,"
                " session_version = session_version + 1"
                " WHERE id = ?",
                (generate_password_hash(new_pw, method="pbkdf2:sha256"), user_id)
            )
            conn.commit()
            conn.close()
            # Clear entire session — invalidates all active sessions on other devices
            session.clear()
            return redirect(url_for("login") + "?reset=1")

    return render_template("auth/reset_password.html", error=error)


# ══════════════════════════════════════════════════════════
# PROFILE & ACCOUNT ROUTES
# ══════════════════════════════════════════════════════════

@app.route("/account")
@login_required
def account():
    """Redirect /account → /profile (dashboard sidebar link)."""
    return redirect(url_for("profile"))


@app.route("/profile")
@login_required
def profile():
    """
    User profile page — shows account info and watchlists.

    Fetches:
      - User's basic info (name, email, join date)
      - Their saved coins (coin_watchlist table)
      - Their saved exchanges (exchange_watchlist table)

    Template: templates/public/profile.html
    """
    user_id = session["user_id"]
    conn    = get_db_connection()
    cursor  = conn.cursor()

    cursor.execute(
        "SELECT id, name, email, created_at FROM users WHERE id = ?",
        (user_id,)
    )
    user = cursor.fetchone()

    # User somehow doesn't exist → clear session and re-login
    if not user:
        session.clear()
        conn.close()
        return redirect(url_for("login"))

    cursor.execute(
        "SELECT * FROM coin_watchlist WHERE user_id = ? ORDER BY added_at DESC",
        (user_id,)
    )
    coin_watchlist = cursor.fetchall()

    cursor.execute(
        "SELECT * FROM exchange_watchlist WHERE user_id = ? ORDER BY added_at DESC",
        (user_id,)
    )
    exchange_watchlist = cursor.fetchall()
    conn.close()

    return render_template(
        "public/profile.html",
        user=user,
        coin_watchlist=coin_watchlist,
        exchange_watchlist=exchange_watchlist,
        page="profile",
    )


@app.route("/change-password", methods=["GET", "POST"])
@login_required
def change_password():
    """
    Change password for a logged-in user who knows their current password.

    Requires entering old password first (security check).
    Different from forgot-password which uses OTP.

    Template: templates/public/change_password.html
    """
    error = success = None

    if request.method == "POST":
        current_pw = request.form.get("current_password", "")
        new_pw     = request.form.get("new_password", "")
        confirm_pw = request.form.get("confirm_password", "")

        if not current_pw or not new_pw or not confirm_pw:
            error = "All fields are required."
        elif new_pw != confirm_pw:
            error = "New passwords do not match."
        elif len(new_pw) < 8:
            error = "Password must be at least 8 characters."
        else:
            conn   = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT password_hash FROM users WHERE id = ?",
                (session["user_id"],)
            )
            row = cursor.fetchone()

            if not row or not check_password_hash(row["password_hash"], current_pw):
                error = "Current password is incorrect."
                conn.close()
            else:
                cursor.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (generate_password_hash(new_pw, method="pbkdf2:sha256"), session["user_id"])
                )
                conn.commit()
                conn.close()
                success = "Password changed successfully."

    return render_template(
        "public/change_password.html",
        error=error,
        success=success,
        page="profile",
    )


# ══════════════════════════════════════════════════════════
# WATCHLIST API ROUTES
# These are called by JavaScript (AJAX), not visited directly.
# They return JSON responses.
# ══════════════════════════════════════════════════════════

@app.route("/watchlist/coin/toggle", methods=["POST"])
@login_required
def watchlist_coin_toggle():
    """
    Toggle a coin in/out of the user's watchlist.

    Called via fetch() from coin.js and home.js when user clicks ★.
    If the coin is already saved → removes it.
    If it's not saved → adds it.

    Request body (JSON):
        { coin_id, coin_name, coin_symbol, coin_image }

    Response (JSON):
        { ok: true, saved: true }   ← coin was added
        { ok: true, saved: false }  ← coin was removed
        { ok: false, error: "..." } ← something went wrong
    """
    payload     = request.get_json(silent=True) or {}
    coin_id     = payload.get("coin_id", "")
    coin_name   = payload.get("coin_name", "")
    coin_symbol = payload.get("coin_symbol", "")
    coin_image  = payload.get("coin_image", "")

    if not coin_id:
        return jsonify({"ok": False, "error": "coin_id required"}), 400

    user_id = session["user_id"]
    conn    = get_db_connection()
    cursor  = conn.cursor()

    # Check if already saved
    cursor.execute(
        "SELECT id FROM coin_watchlist WHERE user_id=? AND coin_id=?",
        (user_id, coin_id)
    )
    if cursor.fetchone():
        # Already saved → remove it
        cursor.execute(
            "DELETE FROM coin_watchlist WHERE user_id=? AND coin_id=?",
            (user_id, coin_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "saved": False})

    # Not saved → add it
    cursor.execute(
        "INSERT INTO coin_watchlist (user_id, coin_id, coin_name, coin_symbol, coin_image)"
        " VALUES (?, ?, ?, ?, ?)",
        (user_id, coin_id, coin_name, coin_symbol, coin_image)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "saved": True})


@app.route("/api/watchlist/coins")
@login_required
def api_watchlist_coins():
    """
    Return list of coin IDs in the current user's watchlist.

    Called on page load by JS to pre-fill the gold star states.

    Response (JSON):
        { ok: true, coin_ids: ["bitcoin", "ethereum", ...] }
    """
    conn   = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT coin_id FROM coin_watchlist WHERE user_id=?",
        (session["user_id"],)
    )
    ids = [r["coin_id"] for r in cursor.fetchall()]
    conn.close()
    return jsonify({"ok": True, "coin_ids": ids})


@app.route("/watchlist/exchange/toggle", methods=["POST"])
@login_required
def watchlist_exchange_toggle():
    """
    Toggle an exchange in/out of the user's watchlist.

    Same logic as watchlist_coin_toggle but for exchanges.

    Request body (JSON):
        { exchange_id, exchange_name, exchange_logo }

    Response (JSON):
        { ok: true, saved: true/false }
    """
    payload       = request.get_json(silent=True) or {}
    exchange_id   = payload.get("exchange_id", "")
    exchange_name = payload.get("exchange_name", "")
    exchange_logo = payload.get("exchange_logo", "")

    if not exchange_id:
        return jsonify({"ok": False, "error": "exchange_id required"}), 400

    user_id = session["user_id"]
    conn    = get_db_connection()
    cursor  = conn.cursor()

    cursor.execute(
        "SELECT id FROM exchange_watchlist WHERE user_id=? AND exchange_id=?",
        (user_id, exchange_id)
    )
    if cursor.fetchone():
        cursor.execute(
            "DELETE FROM exchange_watchlist WHERE user_id=? AND exchange_id=?",
            (user_id, exchange_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "saved": False})

    cursor.execute(
        "INSERT INTO exchange_watchlist (user_id, exchange_id, exchange_name, exchange_logo)"
        " VALUES (?, ?, ?, ?)",
        (user_id, exchange_id, exchange_name, exchange_logo)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "saved": True})


@app.route("/api/watchlist/exchanges")
@login_required
def api_watchlist_exchanges():
    """
    Return list of exchange IDs in the current user's watchlist.

    Response (JSON):
        { ok: true, exchange_ids: ["coindcx", "wazirx", ...] }
    """
    conn   = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT exchange_id FROM exchange_watchlist WHERE user_id=?",
        (session["user_id"],)
    )
    ids = [r["exchange_id"] for r in cursor.fetchall()]
    conn.close()
    return jsonify({"ok": True, "exchange_ids": ids})


# ══════════════════════════════════════════════════════════
# ENTRY POINT
# This block only runs when you execute: python app.py
# It does NOT run when Gunicorn imports the app for production.
# ══════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Create database tables if they don't exist
    init_db()
    # debug=False even in local dev → keeps behaviour consistent
    # Use: flask run --debug  if you want debug mode
    app.run(debug=False)
