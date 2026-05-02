# CoinScanner — Technical Map

> Every route, API call, data flow, template, and JavaScript function
> explained in plain English. Use this as a developer handbook.

---

## Table of Contents

1. [Big Picture — How Everything Connects](#big-picture)
2. [Request Lifecycle](#request-lifecycle)
3. [Backend: app.py Deep Dive](#backend-apppy-deep-dive)
4. [Data Layer: How Prices Are Built](#data-layer-how-prices-are-built)
5. [Database: database.py](#database-databasepy)
6. [Static Data: mock_data.py](#static-data-mock_datapy)
7. [Frontend Templates](#frontend-templates)
8. [JavaScript: Detailed Function Map](#javascript-detailed-function-map)
9. [CSS: Class → Component Map](#css-class--component-map)
10. [API Endpoints Used](#api-endpoints-used)
11. [Mobile Navigation Architecture](#mobile-navigation-architecture)
12. [Auth Flow Step by Step](#auth-flow-step-by-step)
13. [Currency Toggle Flow](#currency-toggle-flow)
14. [Coin Modal Flow](#coin-modal-flow)
15. [Compare Feature Flow](#compare-feature-flow)
16. [Known Issues & TODOs](#known-issues--todos)

---

## Big Picture

```
Browser Request
      │
      ▼
  Flask (app.py)
      │
      ├── Reads cache (PRICE_CACHE, META_CACHE, etc.)
      ├── If cache stale → fetch from CoinDCX / CoinGecko / NewsAPI
      ├── Merge data (build_coin)
      └── render_template(page.html, **data)
              │
              ▼
      Jinja2 Template
      (extends base_public.html)
              │
              ├── Injects data into HTML (prices, coin names, etc.)
              ├── Injects data into data-* attributes (for JS to read)
              └── Loads CSS + JS files
                      │
                      ▼
              Browser renders HTML
                      │
              JS runs (DOMContentLoaded)
                      │
                      ├── Draws sparkline charts (Canvas API)
                      ├── Fetches USD rates from CoinGecko (client-side)
                      ├── Fetches Fear & Greed from alternative.me
                      ├── Fetches Trending from CoinGecko
                      ├── Sets up modal click handlers
                      └── Sets up currency toggle listeners
```

---

## Request Lifecycle

### Example: User visits `/coins`

```
1. Browser → GET /coins
2. Flask coins() function runs
3. get_dcx_prices()
   └── Is PRICE_CACHE fresh? (< 60s old)
       ├── YES → return cached dict
       └── NO  → GET https://api.coindcx.com/exchange/ticker
                  Parse all *INR markets
                  Store in PRICE_CACHE with current timestamp
                  Return new data
4. get_coin_metadata()
   └── Is META_CACHE fresh? (< 86400s = 24h old)
       ├── YES → return cached dict
       └── NO  → GET https://api.coingecko.com/api/v3/coins/markets
                  (top 50 by market cap, INR, with sparkline)
                  Store in META_CACHE
                  Return new data
5. Build coin list: [build_coin(id, meta, prices) for each coin]
   └── For each coin:
       ├── Look up DCX symbol via COINGECKO_TO_DCX map
       ├── If DCX data exists → use DCX price/change/volume/high/low
       ├── If not (e.g. exotic coin) → fallback to CoinGecko price
       └── Return unified dict with formatted_price, formatted_volume
6. Sort by market_cap_rank
7. Build gainers (top 5 by 24h change desc)
8. Build losers (top 5 by 24h change asc)
9. picks = all_coins[:5] (top 5 by rank)
10. render_template("public/coins.html", coins=all_coins, gainers=gainers, ...)
11. Jinja2 renders HTML with all data embedded
12. Browser receives complete HTML page
13. coin.js loads → sets up search, modal click handlers, fetches USD in background
```

---

## Backend: app.py Deep Dive

### Cache Variables (Module-Level)

```python
PRICE_CACHE  = {"data": {},    "timestamp": 0}
META_CACHE   = {"data": {},    "timestamp": 0}
GLOBAL_CACHE = {"data": {},    "timestamp": 0}
NEWS_CACHE   = {"data": [],    "timestamp": 0}
MARKET_CACHE = {"data": ([], [], []), "timestamp": 0}
```

Each cache is checked with `time.time() - cache["timestamp"] < TTL`.
If fresh → return `cache["data"]`. If stale → fetch, update, return.

---

### COINGECKO_TO_DCX Map

```python
COINGECKO_TO_DCX = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    ...
}
```

CoinGecko uses full names like `"bitcoin"` as IDs.
CoinDCX uses symbols like `"BTC"` for their ticker market names (`BTCINR`).
This dict is the bridge — without it, we can't look up the DCX price
for a coin we fetched from CoinGecko.

---

### get_dcx_prices() → dict

Fetches `https://api.coindcx.com/exchange/ticker` (no API key needed).

Returns all INR trading pairs as:
```python
{
  "BTC": {
    "last_price": 8500000.0,
    "change_24h": 2.5,
    "high": 8600000.0,
    "low": 8400000.0,
    "volume": 1200.0,
    "bid": 8499000.0,
    "ask": 8501000.0,
  },
  "ETH": { ... },
  ...
}
```

---

### get_coin_metadata() → dict

Fetches `https://api.coingecko.com/api/v3/coins/markets` with:
- `vs_currency=inr`
- `order=market_cap_desc`
- `per_page=50`
- `sparkline=true` (7d price history for sparkline charts)

Returns:
```python
{
  "bitcoin": {
    "id": "bitcoin",
    "name": "Bitcoin",
    "symbol": "BTC",
    "image": "https://...",
    "market_cap": 167000000000000,
    "market_cap_rank": 1,
    "ath": 7400000,
    "sparkline": [7000000, 7100000, ...],  # 7 days of hourly prices
    "cg_price": 8500000,
    "cg_change_24h": 2.5,
    "cg_volume": 210000000000,
    "cg_high": 8600000,
    "cg_low": 8400000,
  },
  ...
}
```

---

### get_global_stats() → dict

Fetches `https://api.coingecko.com/api/v3/global`.

Returns:
```python
{
  "total_market_cap_inr": 271000000000000,
  "total_market_cap_usd": 3200000000000,
  "total_volume_inr": 18000000000000,
  "btc_dominance": 62.3,
  "active_coins": 15800,
  "markets": 1100,
}
```

---

### build_coin(cg_id, meta, prices) → dict

The heart of the data merging logic.

```
Priority for each field:
  price   → DCX last_price  OR  CoinGecko cg_price
  change  → DCX change_24h  OR  CoinGecko cg_change_24h
  volume  → DCX volume      OR  CoinGecko cg_volume
  high    → DCX high        OR  CoinGecko cg_high
  low     → DCX low         OR  CoinGecko cg_low
  rank, market_cap, ATH, supply → always from CoinGecko metadata
```

Returns a flat dict with everything the template needs, including
`formatted_price` (Indian number format) and `formatted_volume`.

---

### get_market_movers() → (gainers, losers, picks)

Cached separately (60s TTL) from the coins page cache.
Used by the home page to get the movers card.

```
gainers = top 5 coins sorted by price_change_percentage_24h DESC
losers  = top 5 coins sorted by price_change_percentage_24h ASC
picks   = top 5 coins by market_cap_rank (i.e. rank 1–5)
```

---

### format_inr(num) → str

Indian number formatting: 1,00,000 style (lakhs system).

```
12345678.50  →  "1,23,45,678.50"
```

Standard `{:,.2f}` gives wrong grouping for Indian system, so this
function manually builds the comma placement.

---

### format_volume(num) → str

Compact volume formatting:
```
123_00_00_000  →  "12.30 Cr"   (crore)
12_34_000      →  "12.34 L"    (lakh)
1_234          →  "1.23 K"     (thousand)
```

---

### coin_page() Route — Parallel API Calls

Uses `ThreadPoolExecutor(max_workers=2)` to fetch coin detail and
chart data *simultaneously*, halving the response time.

```python
with ThreadPoolExecutor(max_workers=2) as executor:
    coin_future  = executor.submit(fetch, coin_url)   # /coins/{id}
    chart_future = executor.submit(fetch, chart_url)  # /market_chart
    coin_res  = coin_future.result()
    chart_res = chart_future.result()
```

Then DCX prices are overlaid on top of the CoinGecko detail data
(same priority logic as build_coin).

---

## Data Layer: How Prices Are Built

```
CoinDCX /ticker  ←──── get_dcx_prices()
                              │
                              │  Keyed by DCX symbol (e.g. "BTC")
                              ▼
                       COINGECKO_TO_DCX map
                              │
                              │  Translates to CoinGecko ID
                              ▼
CoinGecko /markets ←── get_coin_metadata()
                              │
                              │  Has rank, market cap, ATH, sparkline
                              ▼
                         build_coin()
                              │
                    ┌─────────┴──────────┐
                    │                    │
               DCX price          CoinGecko price
            (if available)         (if no DCX data)
                    │                    │
                    └─────────┬──────────┘
                              │
                         Unified coin dict
                    (price, change, volume, etc.)
```

---

## Database: database.py

### get_db_connection()

Opens a connection to `coin_scanner.db` (SQLite file in project root).
Sets `row_factory = sqlite3.Row` so rows behave like dicts:
`user["email"]` instead of `user[2]`.

### init_db()

Called once on startup (`if __name__ == "__main__": init_db()`).
Creates the `users` table if it doesn't exist yet.
Safe to call repeatedly — uses `CREATE TABLE IF NOT EXISTS`.

### Users Table Schema

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Full name from signup |
| `email` | TEXT UNIQUE | Login identifier |
| `phone` | TEXT | Login identifier (alternative) |
| `password_hash` | TEXT | Werkzeug PBKDF2:SHA256 hash |
| `is_verified` | INTEGER | 0 = not verified, 1 = verified |
| `otp_code` | TEXT | 6-digit OTP, nulled after use |
| `otp_expiry` | INTEGER | Unix timestamp (now + 300s) |

---

## Static Data: mock_data.py

Contains two functions — no database, just Python dicts.

### get_exchanges() → list[dict]

14 exchange objects. Each has:
- `id` — URL-safe identifier (e.g. `"coindcx"`)
- `name` — Display name
- `logo` — Google S2 favicon URL (auto-updates as exchanges update their favicon)
- `about` — founded, headquarters, founders, regulated, website, description
- `fees` — spot, futures
- `leverage` — max leverage string
- `liquidity` — "High" / "Medium" / "Low"
- `volume` — same scale
- `withdrawal` — limit, charges
- `deposit` — limit, charges
- `currencies` — count string (e.g. `"500+"`)
- `earning` — comma-separated earning options
- `mining` — mining option or `"-"`
- `features` — dict of booleans: spot, investment, derivatives_fno, p2p, inr_support

### get_insights() → list[dict]

3 insight cards for the compare page (best exchange, highest fees, best for beginners).

### get_wallets() → list[dict]

5 crypto wallet objects (MetaMask, Trust, Ledger, Trezor, Coinbase Wallet).
Not currently used in any route but available for a future wallets page.

---

## Frontend Templates

### Template Inheritance Tree

```
base_public.html          ← Header, footer, mobile tab bar, Chart.js, main.js
    ├── home.html
    ├── coins.html
    ├── coin.html
    ├── compare.html
    ├── news.html
    ├── news_detail.html
    ├── about.html
    └── investors.html

base_auth.html            ← Minimal shell, auth.css only
    ├── login.html
    ├── signup.html
    └── verify.html

base_dashboard.html       ← Dashboard sidebar layout (future use)
    └── (no pages yet)
```

### base_public.html Key Blocks

| Block | What goes in it |
|---|---|
| `{% block title %}` | Page-specific `<title>` tag content |
| `{% block body_class %}` | CSS class on `<body>` |
| `{% block extra_css %}` | Page-specific CSS `<link>` tags |
| `{% block sidebar %}` | Left sidebar (used on some pages) |
| `{% block content %}` | Main page content |
| `{% block extra_js %}` | Page-specific JS `<script>` tags |

### Jinja2 Data Passing Patterns

**Embedding data for JS to use (data-* attributes):**
```html
<!-- Server renders the price into the HTML attribute -->
<tr class="coin-row"
    data-id="{{ coin.id }}"
    data-price-inr="{{ coin.current_price }}"
    data-change="{{ coin.price_change_percentage_24h }}">
```

**Embedding JSON for JS:**
```html
<!-- For the chart, pass the full price array as JSON -->
<canvas id="coinChart"
    data-prices='{{ chart_prices | tojson | safe }}'
    data-coin-id="{{ coin.id }}">
```

**Embedding exchange data for compare.js:**
```html
<!-- compare.js reads this once on load -->
<script id="exchangeData" type="application/json">
  {{ exchanges | tojson | safe }}
</script>
```

---

## JavaScript: Detailed Function Map

### main.js

| Function / Listener | Trigger | What it does |
|---|---|---|
| `DOMContentLoaded` | Page load | Runs all setup below |
| Mobile menu toggle | `#mobileMenuToggle` click | Toggles `.active` on `#mainNav` |
| Account dropdown | `.account-menu` click | Shows/hides `.account-dropdown` |
| Dropdown close | `document` click | Hides dropdown when clicking outside |
| Logout modal open | `#logoutBtn` click | Sets `logoutModal.style.display = "flex"` |
| Logout modal cancel | `#cancelLogout` click | Hides modal |
| `syncAllToggles(currency)` | On load + on change | Adds `.active` to matching `.hdr-cur-btn` and `.currency-btn` |
| `handleCurrencyClick()` | `.hdr-cur-btn` or `.currency-btn` click | Updates global state, saves to localStorage, fires `currencyChanged` event |
| News search | `#newsSearch` input | Filters `.news-card-premium` by text content, shows/hides `#newsEmpty` |
| CMD+K shortcut | `keydown` | Focuses `#newsSearch` |

---

### home.js

| Function | Where called | What it does |
|---|---|---|
| `formatINR(num)` | Price display | Compact INR: ₹1.23 Cr / ₹12.34 L / ₹1.23 K |
| `formatUSD(num)` | Price display | Compact USD: $1.23B / $1.23M / $1.23K |
| `formatPrice(inr, id)` | Price cells | Returns INR or USD based on `currentCurrency` |
| `fetchUSDPrices()` | On load + on USD toggle | CoinGecko `/coins/markets?vs_currency=usd` — fills `usdRates` dict |
| `updateTablePrices()` | After USD fetch | Updates all `.price-cell` elements from `usdRates` |
| `updateCardPrices()` | After USD fetch | Updates `.coin-price` in `.coin-card` elements |
| `currencyChanged` listener | `window` event | Calls `fetchUSDPrices()` then `updateTablePrices()` + `updateTicker()` |
| `.mover-tab` click | Movers tabs | Hides all `.movers-panel`, shows the clicked tab's panel |
| Sparkline drawing | DOMContentLoaded | Reads `data-sparkline` JSON, draws line on `<canvas class="sparkline">` |
| `openModal(row)` | `.coin-row` click | Reads all `data-*` attributes, fills modal HTML, calls `loadChart()` |
| `closeModal()` | Close btn / backdrop / Escape | Hides modal, destroys chart |
| `loadChart(id)` | After modal opens | CoinGecko 7d chart → Chart.js line chart |
| `loadMarketStats()` | DOMContentLoaded + 300ms | CoinGecko `/global` → fills market overview bar |
| `loadFearGreed()` | DOMContentLoaded + 600ms | alternative.me `/fng` → SVG gauge + badge |
| `loadTrending()` | DOMContentLoaded + 900ms | CoinGecko `/search/trending` → renders trending list |
| `setupTicker()` | DOMContentLoaded | Duplicates ticker HTML for seamless infinite scroll |
| `updateTicker(currency)` | On currency change | Swaps ticker prices from INR to USD using `window._usdRates` |
| `updateTrendingCurrency(currency)` | On currency change | Adds "Prices in USD" note (trending always USD from CoinGecko) |

**Note:** API calls are staggered with `setTimeout` (300ms, 600ms, 900ms)
to avoid hitting CoinGecko rate limits on page load.

---

### coin.js

Runs on both `coins.html` and `coin.html`. It detects which page it's on
by checking if `#coinChart` exists.

**On `coin.html` (detail page):**

| Function | What it does |
|---|---|
| `toggleAbout()` | Global function. Shows/hides the extra description text on coin detail |
| `buildDetailChart(priceData)` | Destroys existing chart, creates new Chart.js line chart with gradient |
| `.period-btn` click | Fetches CoinGecko market_chart for selected period (1D/7D/30D/1Y) |

**On `coins.html` (list page):**

| Function | What it does |
|---|---|
| `#coinSearch` input | Filters table rows and card grid by name/symbol, updates count |
| `fmtINR(n)` | Compact INR formatting with Cr/L/K suffixes |
| `fmtUSD(n)` | Compact USD formatting with B/M/K suffixes |
| `fmtPrice(inrVal, id)` | Returns INR or USD depending on `currentCurrency` |
| `fetchUSD()` | CoinGecko `/coins/markets?vs_currency=usd` — fills `usdRates` |
| `updateAllPrices()` | Updates mover rows, card grid, main table, home page rows |
| `currencyChanged` listener | Triggers `fetchUSD()` then `updateAllPrices()` |
| Click handlers | All `.mover-row`, `.coin-card`, `.coin-row` → `openModal(el)` |
| `openModal(el)` | Reads data-* attributes, fills modal, calls `loadModalChart()` |
| `closeModal()` | Hides modal, destroys chart |
| `loadModalChart(id)` | Shows spinner, fetches 7d chart, renders Chart.js, handles 429 retry |

---

### compare.js

Wrapped in an IIFE `(function(){ ... })()` to keep all variables private.

| Section | Functions | What they do |
|---|---|---|
| Data init | — | Parses `#exchangeData` JSON into `ALL` array and `byId` lookup |
| Filter | `.cmp-chip` click, `applyFilters()` | Filters `.cmp-card` visibility by active feature checkboxes + search |
| Filter badge | `updateFilterBadge()` | Shows/hides the "N active" count badge |
| Select | `toggleSelect(id)` | Adds/removes exchange from `selected` array (max 4) |
| Selection UI | `updateSelectionUI()` | Updates card selected states, shows compare button, renders bar chips |
| Bar chips | `renderBarChips()` | Builds the floating bottom bar with selected exchange chips + remove buttons |
| Compare table | `showCompareTable()` | Hides browse, shows compare mode, calls `buildTable()` |
| Table builder | `buildTable()` | Dynamically generates thead (exchange headers) and tbody (feature rows) with winner highlighting |
| Winner logic | Inside `buildTable()` | Different logic per row type: bool (any true wins), free (₹0 wins), highest_num, liquidity score |
| Detail modal | `openModal(id)` | Fills all 4 tabs with exchange data |
| Tab switching | `switchModalTab(name)` | Shows matching tab panel, hides others |
| Add to compare | `mdAddBtn` click | Toggles selected state for current modal's exchange |
| Toast | `showToast(msg)` | Creates temporary notification (e.g. "Max 4 exchanges") |

---

## CSS: Class → Component Map

### Key Layout Classes

| Class | What it is |
|---|---|
| `.app-container` | Full-page flex column wrapper |
| `.app-header` | 64px sticky top header |
| `.app-body` | Flex row containing sidebar + main |
| `.main-content` | `flex: 1` — the scrollable page area |
| `.bottom-tab-bar` | Fixed bottom nav (mobile only, ≤768px) |
| `.home-grid` | 2-col grid: main left + 320px sidebar right |
| `.coins-table-wrap` | Horizontally scrollable table container |
| `.cmp-grid` | 3-col exchange card grid |
| `.news-grid-premium` | 3-col news card grid |

### Modal Classes

| Class | Used in |
|---|---|
| `.coin-modal` | Home + Coins coin popup |
| `.coin-modal-box` | The white/dark box inside the overlay |
| `.cmodal-header` | Dark header with logo, name, price, close |
| `.cmodal-stats-strip` | Market cap, volume, high, low, ATH row |
| `.cmodal-chart-wrap` | 260-280px tall chart area |
| `.cmp-modal` | Compare exchange detail popup |
| `.news-modal` | News article preview popup |

### State Classes (Added by JS)

| Class | Added by | Effect |
|---|---|---|
| `.hidden` | JS | `display: none` |
| `.active` | main.js, compare.js | Active tab/button styling |
| `.selected` | compare.js | Blue border + check on exchange cards |
| `.winner` | compare.js | Green highlight in comparison table cells |
| `mainNav.active` | main.js | Slides mobile nav down |

---

## API Endpoints Used

### Server-Side (Python / app.py)

| URL | Method | Used for |
|---|---|---|
| `https://api.coindcx.com/exchange/ticker` | GET | All live INR prices |
| `https://api.coingecko.com/api/v3/coins/markets` | GET | Coin metadata, market cap, sparkline |
| `https://api.coingecko.com/api/v3/coins/{id}` | GET | Full coin detail data |
| `https://api.coingecko.com/api/v3/coins/{id}/market_chart` | GET | Chart data for coin detail page |
| `https://api.coingecko.com/api/v3/global` | GET | Market overview stats |
| `https://newsapi.org/v2/everything` | GET | Crypto news articles |

### Client-Side (JavaScript)

| URL | Called from | Used for |
|---|---|---|
| `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` | coin.js, home.js | USD price rates for currency toggle |
| `https://api.coingecko.com/api/v3/coins/{id}/market_chart?days=7` | coin.js, home.js | 7-day modal chart |
| `https://api.coingecko.com/api/v3/coins/{id}/market_chart?days={n}` | coin.js | Period chart (1D/7D/30D/1Y) on detail page |
| `https://api.coingecko.com/api/v3/global` | home.js | Market overview bar (client refresh) |
| `https://api.alternative.me/fng/?limit=1` | home.js | Fear & Greed Index |
| `https://api.coingecko.com/api/v3/search/trending` | home.js | Trending coins sidebar |

---

## Mobile Navigation Architecture

```
Desktop (> 768px):
  Header top nav (links: Home, Compare, Coins, News, About)
  + Header currency toggle (₹ INR / $ USD)
  + Account dropdown (avatar click)

Mobile (≤ 768px):
  Hamburger menu (☰) → slides down #mainNav
  Bottom tab bar fixed at bottom:
    Home | Compare | Coins | News | Account
  
  Account tab behaviour:
    - If NOT logged in → link to /login
    - If logged in     → opens a slide-up bottom sheet
      (created dynamically in base_public.html inline script)
      Sheet shows: email, nav links, logout button
```

The bottom tab sheet is created by an inline `<script>` in `base_public.html`
that runs only on mobile (`window.innerWidth > 768 → return`).
It builds the sheet DOM dynamically and appends it to `<body>`.

---

## Auth Flow Step by Step

```
1. User visits /signup
   └── GET → render auth/signup.html

2. User fills form → POST /signup
   └── Validate: name, email, phone, password, confirm_password required
   └── password === confirm_password check
   └── Hash password: generate_password_hash(password, "pbkdf2:sha256")
   └── Generate OTP: random.randint(100000, 999999)
   └── Set expiry: int(time.time()) + 300  (5 minutes from now)
   └── INSERT INTO users (name, email, phone, password_hash, otp_code, otp_expiry)
   └── If UNIQUE constraint fails (email exists) → return "User already exists"
   └── Print OTP to console (email not yet integrated)
   └── redirect to /verify?email=...

3. User visits /verify
   └── GET → render auth/verify.html (shows email in subtitle)
   └── POST /verify → submitted OTP + email from query param
   └── SELECT user WHERE email = ?
   └── Check: user["otp_code"] == entered_otp
   └── Check: int(time.time()) < user["otp_expiry"]
   └── If valid: UPDATE users SET is_verified=1, otp_code=NULL, otp_expiry=NULL
   └── redirect to /login
   └── If invalid: return "Invalid or expired OTP"

4. User visits /login
   └── GET → render auth/login.html
   └── POST /login → identifier (email or phone) + password
   └── SELECT user WHERE email=? OR phone=?
   └── check_password_hash(user["password_hash"], password)
   └── Check: user["is_verified"] == 1
   └── If all pass: session["user_id"] = user["id"]
                    session["user_email"] = user["email"]
                    redirect to /home
   └── If fail: return "Invalid credentials"

5. User visits /logout
   └── session.clear()
   └── redirect to /home
```

---

## Currency Toggle Flow

```
User clicks "$ USD" button (anywhere on page)
        │
        ▼
main.js handleCurrencyClick()
        │
        ├── window.globalCurrency = "usd"
        ├── localStorage.setItem("preferredCurrency", "usd")
        ├── syncAllToggles("usd")  — visual update only
        └── dispatchEvent(new CustomEvent("currencyChanged", {detail:{currency:"usd"}}))
                │
                ├── home.js listener:
                │     └── if !usdFetched → fetchUSDPrices()
                │           └── GET CoinGecko /coins/markets?vs_currency=usd
                │           └── fills usdRates{coinId: price, coinId_mc: marketcap, ...}
                │     └── updateTablePrices()  — updates .price-cell elements
                │     └── updateTicker("usd")   — swaps ticker prices
                │     └── updateTrendingCurrency("usd")
                │
                └── coin.js listener:
                      └── if !usdFetched → fetchUSD()
                      └── updateAllPrices()
                            ├── .mover-row → .mover-td-price
                            ├── .coin-card → .coin-price
                            ├── .coin-row  → .td-price
                            └── home rows  → .price-cell
```

**Why usdFetched flag?** CoinGecko has rate limits. We only fetch USD
prices *once* per page session. After the first fetch, subsequent
toggle clicks just re-render from the cached `usdRates` object.

---

## Coin Modal Flow

```
User clicks a coin row/card
        │
        ▼
JS reads data-* attributes from the clicked element:
  data-id, data-name, data-symbol, data-image,
  data-price-inr, data-change, data-marketcap,
  data-rank, data-high, data-low, data-ath, data-volume
        │
        ▼
openModal(el)
  ├── Set modalViewMore.href = /coin/{id}?currency={current}
  ├── Fill: logo src, name, symbol, rank
  ├── Calculate display price:
  │     if currentCurrency === "usd" && usdRates[id] → formatUSD()
  │     else → fmtINR(data-price-inr)
  ├── Fill: market cap, high, low, ATH, volume (same INR/USD logic)
  ├── Fill: change text ("▲ 2.50%") and color (green/red)
  ├── modal.classList.remove("hidden")
  ├── document.body.style.overflow = "hidden"  ← prevent background scroll
  └── loadModalChart(id)
          ├── Show spinner (replace canvas HTML with loading div)
          ├── GET CoinGecko /coins/{id}/market_chart?vs_currency={cur}&days=7
          ├── If 429 (rate limited) → wait 2s → retry once
          ├── Restore canvas HTML (innerHTML = "<canvas id='modalChart'>")
          └── Create Chart.js line chart (green if up, red if down)

User closes modal:
  ├── Close button click, backdrop click, or Escape key
  └── closeModal()
        ├── modal.classList.add("hidden")
        ├── document.body.style.overflow = ""
        └── modalChart.destroy() + modalChart = null
```

---

## Compare Feature Flow

```
Page load:
  compare.js reads <script id="exchangeData"> → ALL array + byId lookup

BROWSE MODE:
  Filter chips (.cmp-chip) click → applyFilters()
    └── For each .cmp-card:
          match search AND all active feature filters → show/hide
  
  Search input → applyFilters()
  
  .cmp-sel-btn click → toggleSelect(id)
    └── if already selected → remove from selected[]
    └── if not selected:
          if selected.length >= 4 → showToast("Max 4")
          else → selected.push(id)
    └── updateSelectionUI()
          ├── Mark cards selected/unselected
          ├── Show/hide "Compare Now" button (needs ≥ 2)
          ├── Show/hide floating bottom bar
          └── Render bar chips

COMPARE MODE:
  compareNowBtn / cmpBarGo click → showCompareTable()
    ├── Hide browseMode div
    ├── Show compareMode div
    └── buildTable()
          ├── Create <thead> with exchange logos + remove buttons
          └── For each row definition:
                ├── Group headers (FEES, TRADING, FEATURES, ABOUT)
                └── Data rows:
                      ├── Get values from each exchange via row.get(ex)
                      ├── Determine winners (different logic per row)
                      └── Create <td> cells with winner class if applicable

  backBtn click → hide compareMode, show browseMode

DETAIL MODAL:
  .cmp-view-btn click → openModal(id)
    └── Fill all fields for all 4 tabs
    └── switchModalTab("assets")  ← default tab
    └── Show modal

  mdAddBtn click → toggleSelect(currentModalId)
    └── Syncs the "Added/Add to Compare" button state
```

---

## Known Issues & TODOs

### Auth
- [ ] **OTP email delivery not implemented.** OTP is printed to server console only. Need to integrate SendGrid / Brevo / AWS SES.
- [ ] **No "forgot password" flow.** Users who forget their password have no recovery path.
- [ ] **No rate limiting on OTP endpoint.** Could be brute-forced. Add Flask-Limiter.
- [ ] **Signup doesn't check phone uniqueness.** Two users can register with the same phone number.

### Compliance (REQUIRED before public launch)
- [ ] **Privacy Policy page** (`/privacy`) — required because we collect PII (name, email, phone)
- [ ] **Terms & Conditions page** (`/terms`)
- [ ] **Disclaimer page** (`/disclaimer`)
- [ ] **Affiliate disclosure banner** on compare page
- [ ] **Cookie consent banner**
- [ ] **Marketing consent checkbox** on signup form
- [ ] **User deletion request mechanism** (DPDP Act 2023)
- [ ] **"Not an Exchange" statement** in footer (make it more prominent)

### Performance
- [ ] **In-memory cache resets on Gunicorn worker restart.** Use Redis for production with multiple workers.
- [ ] **CoinGecko free tier rate limits.** Consider upgrading or caching chart data server-side.
- [ ] **No CDN for static files.** Images and CSS served directly from Flask.

### Features
- [ ] **Dashboard page is a shell only.** `base_dashboard.html` exists but no routes/content.
- [ ] **Wallets data in mock_data.py** (5 wallets) is unused — no wallets comparison page yet.
- [ ] **USD prices for movers strip on coins page** only update via toggle — not real-time.
- [ ] **News search only works client-side** — no server-side search or pagination.
- [ ] **`/terms`, `/privacy`, `/disclaimer`** routes not yet created in app.py (footer links are broken).

### Code Quality
- [ ] **Error handling in routes** returns plain strings ("Coin not found") — should render a styled 404 page.
- [ ] **No CSRF protection** on login/signup forms — add Flask-WTF.
- [ ] **`import random` inside signup()** — should be at top of file.
- [ ] **Inline script in base_public.html** (mobile tab sheet) — could move to main.js.

---

*Last updated: March 2026*