# 🪙 CoinScanner

**A crypto intelligence platform built for India.**
Live prices, exchange comparison, market news — all in one place.

> Built with Flask (Python) · CoinDCX + CoinGecko APIs · newsdata.io · SQLite  
> A product of **Agreed Financial Tech Pvt. Ltd.**

---

## 📸 What Does It Do?

| Page | What You Get |
|------|-------------|
| **Home** | Live top 25 coins, market movers (gainers/losers), trending strip, news |
| **Coins** | Full list of 50 coins with table/card view, search, sparklines |
| **Coin Detail** | Price chart, stats, 7D/30D/90D/1Y periods, description |
| **Compare** | Side-by-side comparison of 14 Indian and global exchanges |
| **News** | Latest crypto news via newsdata.io with search and modal preview |
| **Profile** | User's saved coins and exchanges watchlist |
| **Auth** | Signup → OTP verify → Login with strong password enforcement |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 + Flask 3.1 |
| Database | SQLite (file-based, no server needed) |
| Frontend | Jinja2 templates + vanilla CSS + vanilla JS |
| Charts | Chart.js (loaded from CDN) |
| Icons | Font Awesome 6 (loaded from CDN) |
| Fonts | Google Fonts — Inter + Plus Jakarta Sans |
| Prices | CoinDCX API (free, no key) + CoinGecko API (free, no key) |
| News | newsdata.io (free tier, needs API key) |
| Deployment | Gunicorn + Heroku / Railway / Render |

---

## 📁 Project Structure

```
coin_scanner_project/
│
├── app.py                  ← Main Flask application (routes, API calls, auth)
├── database.py             ← Database setup and connection helper
├── mock_data.py            ← Static exchange data for Compare page
│
├── requirements.txt        ← Python packages to install
├── Procfile                ← Tells Gunicorn how to run the app (for deployment)
├── .env.example            ← Template for your environment variables
├── .gitignore              ← Files Git should never track (DB, .env, etc.)
│
├── static/
│   ├── css/
│   │   ├── base.css        ← CSS variables, typography, reset
│   │   ├── layout.css      ← Header, nav, footer layout
│   │   ├── components.css  ← Shared components (buttons, modals, pills)
│   │   ├── home.css        ← Home page specific styles
│   │   ├── coins.css       ← Coins listing page styles
│   │   ├── compare.css     ← Compare page styles
│   │   ├── news.css        ← News page styles
│   │   ├── profile.css     ← Profile page styles
│   │   ├── auth.css        ← Login/Signup/Verify page styles
│   │   ├── about.css       ← About/landing page styles
│   │   ├── investors.css   ← Investor relations page styles
│   │   ├── footer.css      ← Footer styles
│   │   └── password_pages.css ← Forgot/Reset password styles
│   │
│   ├── js/
│   │   ├── main.js         ← Runs on EVERY page (nav, currency toggle, star watchlist)
│   │   ├── home.js         ← Home page (charts, movers, trending, ticker)
│   │   ├── coin.js         ← Coins page + Coin detail page (charts, modal, search)
│   │   ├── compare.js      ← Compare page (filter, select, compare table, modal)
│   │   ├── news.js         ← News page (search, article modal)
│   │   ├── profile.js      ← Profile page (tabs, watchlist management)
│   │   └── auth.js         ← Auth pages (password strength, OTP boxes, validation)
│   │
│   └── images/
│       └── logo.png        ← CoinScanner logo
│
└── templates/
    ├── layouts/
    │   ├── base_public.html    ← Base for all public pages (header, footer, nav)
    │   ├── base_auth.html      ← Base for login/signup (no header/footer)
    │   └── base_dashboard.html ← Base for dashboard pages
    │
    ├── public/
    │   ├── home.html           ← Home page
    │   ├── coins.html          ← Coins listing
    │   ├── coin.html           ← Individual coin detail
    │   ├── compare.html        ← Exchange comparison
    │   ├── news.html           ← News listing
    │   ├── news_detail.html    ← Single news article
    │   ├── profile.html        ← User profile + watchlist
    │   ├── about.html          ← About / landing page
    │   ├── investors.html      ← Investor relations
    │   ├── change_password.html
    │   ├── terms.html          ← Terms of Service (stub)
    │   ├── privacy.html        ← Privacy Policy (stub)
    │   └── disclaimer.html     ← Disclaimer (stub)
    │
    ├── auth/
    │   ├── login.html
    │   ├── signup.html
    │   ├── verify.html         ← OTP verification after signup
    │   ├── forgot_password.html
    │   ├── verify_reset_otp.html
    │   └── reset_password.html
    │
    ├── dashboard/
    │   └── account.html
    │
    └── errors/
        ├── 404.html
        └── 500.html
```

---

## 🚀 Getting Started (Local Development)

### Prerequisites

Make sure you have these installed:
- **Python 3.10 or higher** — [Download here](https://www.python.org/downloads/)
- **pip** — comes with Python
- **Git** — [Download here](https://git-scm.com/)

Check your versions:
```bash
python3 --version   # should be 3.10+
pip --version
git --version
```

---

### Step 1 — Clone the Project

```bash
git clone https://github.com/your-username/coin-scanner.git
cd coin-scanner
```

---

### Step 2 — Create a Virtual Environment

A virtual environment keeps project packages separate from your system Python.

```bash
# Create it
python3 -m venv venv

# Activate it
# On Mac/Linux:
source venv/bin/activate

# On Windows:
venv\Scripts\activate

# You'll see (venv) at the start of your terminal prompt — that means it's active
```

---

### Step 3 — Install Dependencies

```bash
pip install -r requirements.txt
```

This installs: Flask, Werkzeug, Gunicorn, requests, python-dotenv

---

### Step 4 — Set Up Your Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Open .env and fill in your values
nano .env     # or use any text editor
```

Your `.env` file should look like this:
```
SECRET_KEY=your-very-long-random-secret-key-here
NEWS_API_KEY=pub_7c5030553f694cd78f8ac22e82c658eb
```

**Generate a secure SECRET_KEY:**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```
Copy the output and paste it as your SECRET_KEY.

> ⚠️ **Never share your `.env` file or commit it to Git.**  
> The `.gitignore` already excludes it.

---

### Step 5 — Run the App

```bash
python3 app.py
```

You should see:
```
 * Running on http://127.0.0.1:5000
```

Open your browser and go to: **http://localhost:5000**

---

## 🌐 Deployment (Production)

### Deploy to Railway (Recommended — Free Tier Available)

1. Create account at [railway.app](https://railway.app)
2. Click **New Project → Deploy from GitHub**
3. Connect your GitHub repo
4. Add environment variables in Railway dashboard:
   - `SECRET_KEY` = your secret key
   - `NEWS_API_KEY` = your newsdata.io key
5. Railway auto-detects the `Procfile` and deploys

### Deploy to Render

1. Create account at [render.com](https://render.com)
2. New → Web Service → Connect GitHub repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app`
5. Add environment variables in Render dashboard

### Deploy to Heroku

```bash
# Install Heroku CLI, then:
heroku login
heroku create your-app-name
heroku config:set SECRET_KEY=your-secret-key
heroku config:set NEWS_API_KEY=your-news-key
git push heroku main
```

> ⚠️ **SQLite on cloud platforms**: SQLite files reset on Heroku/Railway 
> every time the app restarts (ephemeral filesystem). For production with real users, 
> you should use **PostgreSQL**. Railway and Render both offer free PostgreSQL.

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | ✅ Yes | Signs Flask session cookies. Use a long random string. App crashes without it. |
| `NEWS_API_KEY` | ⚠️ Recommended | Your newsdata.io API key. News page shows empty without it. |

---

## ⚙️ How the App Works

### How Prices Work

```
User visits /coins
    ↓
Flask calls get_dcx_prices()     → CoinDCX API  (free, live INR prices, cached 60s)
Flask calls get_coin_metadata()  → CoinGecko API (logos, market cap, cached 24h)
    ↓
build_coin() merges both:
  - Price: CoinDCX if available, else CoinGecko fallback
  - Logo/Metadata: always from CoinGecko
    ↓
render_template("public/coins.html", coins=all_coins)
    ↓
Browser renders the page
```

### How Auth Works

```
User fills Signup form
    ↓
Flask validates → hashes password (pbkdf2:sha256) → saves to DB
    ↓
Generates 6-digit OTP → logs it to console (TODO: send via email/SMS)
    ↓
User goes to /verify → enters OTP → account activated
    ↓
User goes to /login → enters credentials → session["user_id"] set
    ↓
@login_required routes now accessible
```

### How Caching Works

```python
# Example: Prices cached for 60 seconds
PRICE_CACHE = {"data": {}, "timestamp": 0}

def get_dcx_prices():
    if time.time() - PRICE_CACHE["timestamp"] < 60:
        return PRICE_CACHE["data"]   # Return cached data (fast!)
    
    # Cache is stale → fetch fresh data from API
    result = requests.get("https://api.coindcx.com/exchange/ticker")
    PRICE_CACHE["data"]      = result
    PRICE_CACHE["timestamp"] = time.time()
    return result
```

### How INR/USD Toggle Works

```
User clicks "$ USD" button in header
    ↓
main.js fires CustomEvent("currencyChanged", { detail: { currency: "usd" } })
    ↓
home.js / coin.js listen for this event
    ↓
If first time switching to USD:
  → Fetch USD prices from CoinGecko for all visible coins
    ↓
Update all .price-cell elements on the page
```

---

## 📡 APIs Used

| API | Endpoint | Key Needed | Cache Duration | Used For |
|-----|----------|-----------|----------------|---------|
| CoinDCX | `api.coindcx.com/exchange/ticker` | ❌ Free | 60 seconds | Live INR prices |
| CoinGecko Markets | `api.coingecko.com/api/v3/coins/markets` | ❌ Free | 24 hours | Logos, market cap, sparklines |
| CoinGecko Global | `api.coingecko.com/api/v3/global` | ❌ Free | 5 minutes | Market stats, BTC dominance |
| CoinGecko Trending | `api.coingecko.com/api/v3/search/trending` | ❌ Free | Page load | Trending chips |
| CoinGecko Chart | `api.coingecko.com/api/v3/coins/{id}/market_chart` | ❌ Free | Not cached | Price charts (per click) |
| newsdata.io | `newsdata.io/api/1/news` | ✅ Required | 30 minutes | Crypto news |
| Clearbit Logo | `logo.clearbit.com/{domain}` | ❌ Free | Browser cache | Exchange logos |

---

## ⚠️ Known Limitations & TODOs

| # | Issue | Priority |
|---|-------|----------|
| 1 | **OTP not sent via email/SMS** — currently only logged to console | 🔴 High |
| 2 | **SQLite resets on Heroku** — use PostgreSQL for real production | 🔴 High |
| 3 | **CoinGecko rate limit** — free tier is 10-30 requests/minute | 🟡 Medium |
| 4 | **Legal pages empty** — Terms, Privacy, Disclaimer are stubs | 🟡 Medium |
| 5 | **No email verification** — users can use fake emails | 🟡 Medium |
| 6 | **No rate limiting on auth routes** — brute force possible | 🟡 Medium |
| 7 | **In-memory cache** — resets on each app restart | 🟢 Low |
| 8 | **Single Gunicorn worker** — needed because cache is in-memory | 🟢 Low |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test locally: `python3 app.py`
5. Commit: `git commit -m "Add: your feature description"`
6. Push: `git push origin feature/your-feature`
7. Open a Pull Request

---

## 📄 License

© 2026 Agreed Financial Tech Pvt. Ltd. — CoinScanner. All rights reserved.

CoinScanner is a comparison and information platform, not a financial broker.  
Nothing on this platform constitutes financial advice.

---

## 📞 Contact

- **Instagram**: [@Coin.scanner](https://instagram.com/Coin.scanner)
- **Email**: coinscanner.tech@gmail.com
- **Investor Relations**: [coinscanner.com/investors](/investors)
