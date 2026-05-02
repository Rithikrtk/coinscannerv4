/**
 * coin.js — CoinScanner Coin Pages
 * ===================================
 * JavaScript for two pages that share this file:
 *
 *   1. coin.html    — individual coin detail page (/coin/bitcoin)
 *   2. coins.html   — full coins listing page (/coins)
 *
 * The file detects which page it's on by checking for specific
 * DOM elements (#coinChart for detail page, #coinModal for listing page).
 *
 * SECTIONS:
 *   1.  toggleAbout()       — expand/collapse coin description
 *   2.  Coin Detail Chart   — main Chart.js price chart with period buttons
 *   3.  Card Sparklines     — SVG mini charts in card view
 *   4.  Movers Tabs         — gainers/losers/picks tabs on coins page
 *   5.  Movers Collapse     — collapse/expand movers strip
 *   6.  Coin Search         — filter coins as user types
 *   7.  Format Helpers      — fmtINR / fmtUSD (same as home.js, kept in sync)
 *   8.  USD Rates Fetch     — fetch USD prices on currency switch
 *   9.  Update All Prices   — swap displayed prices on INR↔USD toggle
 *  10.  Currency Event      — listen for currencyChanged from main.js
 *  11.  Coin Modal          — quick-view popup on coin click
 *  12.  Modal Chart         — Chart.js chart inside the modal
 *
 * NOTE: toggleCoinStar() has been moved to main.js (shared with home page)
 *
 * Loaded on coins.html and coin.html via:
 *   {% block extra_js %}
 *     <script src="{{ url_for('static', filename='js/coin.js') }}"></script>
 *   {% endblock %}
 */


/* ══════════════════════════════════════════════════════
   1. toggleAbout() — called inline from coin.html
   Expands/collapses the "About" description section.
   Called: onclick="toggleAbout()"
══════════════════════════════════════════════════════ */
function toggleAbout() {
  const shortEl = document.getElementById("aboutShort");
  const fullEl  = document.getElementById("aboutFull");
  const btn     = document.getElementById("readMoreBtn");
  if (!shortEl || !fullEl || !btn) return;

  const isOpen = fullEl.style.display !== "none";
  shortEl.style.display = isOpen ? "block" : "none";
  fullEl.style.display  = isOpen ? "none"  : "block";
  btn.textContent       = isOpen ? "Read more ↓" : "Read less ↑";
}


/* ══════════════════════════════════════════════════════
   MAIN — runs after DOM is ready
══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     2. COIN DETAIL PAGE — Chart + Period Buttons
     Only runs when #coinChart canvas exists (coin.html).
     If it's found, we set up the chart and return early —
     nothing below applies to the detail page.
  ══════════════════════════════════════════════════════ */
  const coinChartCanvas = document.getElementById("coinChart");

  if (coinChartCanvas) {
    // Read currency and coin ID from data attributes on the canvas element
    // These are set in coin.html: <canvas id="coinChart" data-currency="inr" data-coin-id="bitcoin">
    const pageCurrency = coinChartCanvas.dataset.currency || "inr";
    const coinId       = coinChartCanvas.dataset.coinId   || "";
    const symbol       = pageCurrency === "usd" ? "$" : "₹";

    let detailChart = null;   // holds the Chart.js instance

    /**
     * Build (or rebuild) the main price chart from an array of [timestamp, price] pairs.
     * Destroys any existing chart first to prevent canvas conflicts.
     *
     * @param {Array<[number, number]>} priceData - array of [unixMs, price] pairs
     */
    function buildDetailChart(priceData) {
      // Destroy existing chart if any
      const existing = Chart.getChart(coinChartCanvas);
      if (existing)    existing.destroy();
      if (detailChart) { detailChart.destroy(); detailChart = null; }
      if (!priceData || !priceData.length) return;

      const labels  = priceData.map(function (p) {
        return new Date(p[0]).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      });
      const prices  = priceData.map(function (p) { return p[1]; });
      const isUp    = prices[prices.length - 1] >= prices[0];
      const color   = isUp ? "#16a34a" : "#dc2626";
      const bgColor = isUp ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.06)";

      detailChart = new Chart(coinChartCanvas, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data:            prices,
            borderColor:     color,
            backgroundColor: bgColor,
            borderWidth:     2,
            pointRadius:     0,     // no dots on data points
            tension:         0.3,
            fill:            true,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: "index", intersect: false },
          plugins: {
            legend:  { display: false },
            tooltip: {
              callbacks: {
                label: function (item) {
                  return " " + symbol + parseFloat(item.raw).toLocaleString("en-IN", { maximumFractionDigits: 6 });
                },
              },
            },
          },
          scales: {
            x: {
              display: true,
              grid:    { display: false },
              ticks:   { color: "#94a3b8", maxTicksLimit: 7, font: { size: 11 } },
            },
            y: {
              display: true,
              grid:    { color: "#f1f5f9" },
              ticks: {
                color: "#94a3b8",
                font:  { size: 11 },
                callback: function (v) {
                  if (v >= 1e6)  return symbol + (v / 1e6).toFixed(1) + "M";
                  if (v >= 1e3)  return symbol + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
                  if (v >= 1)    return symbol + parseFloat(v.toFixed(2));
                  if (v >= 0.01) return symbol + parseFloat(v.toFixed(4));
                  return symbol + parseFloat(v.toFixed(6));
                },
              },
            },
          },
        },
      });
    }

    // Render initial chart from server-side data (7D, already in the page)
    try {
      const initialData = JSON.parse(coinChartCanvas.dataset.prices || "[]");
      buildDetailChart(initialData);
    } catch (e) {
      console.error("Chart init error:", e);
    }

    // Period buttons (7D / 30D / 90D / 1Y) — fetch fresh data on click
    document.querySelectorAll(".period-btn").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        // Update active button state
        document.querySelectorAll(".period-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        this.classList.add("active");

        const days      = this.dataset.days;
        const loading   = document.getElementById("chartLoading");
        const container = document.querySelector(".cd-chart-container");

        // Show loading state
        if (loading)   loading.style.display  = "flex";
        if (container) container.style.opacity = "0.3";

        try {
          const url = `/api/coins/${coinId}/chart?currency=${pageCurrency}&days=${days}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error("API error");
          const data = await res.json();
          buildDetailChart(data.prices || []);
        } catch (e) {
          console.error("Period chart fetch error:", e);
        } finally {
          // Hide loading state regardless of success/failure
          if (loading)   loading.style.display  = "none";
          if (container) container.style.opacity = "1";
        }
      });
    });

    // IMPORTANT: return early — don't run coins-list code on the detail page
    return;
  }


  /* ══════════════════════════════════════════════════════
     3. CARD SPARKLINES — coins.html card view
     Draws tiny SVG line charts in the card footer.
     Data comes from data-sparkline attribute on each card.

     Called for cards in the card view (coins.html):
       <div class="coin-card" data-sparkline="[1234, 1235, ...]">
         <svg class="card-sparkline" id="card-spark-{id}"></svg>
       </div>
  ══════════════════════════════════════════════════════ */
  document.querySelectorAll(".card-sparkline").forEach(function (svg) {
    const card = svg.closest("[data-sparkline]");
    if (!card) return;

    try {
      const prices = JSON.parse(card.dataset.sparkline || "[]");
      if (prices.length < 2) return;

      const min   = Math.min(...prices);
      const max   = Math.max(...prices);
      const range = max - min || 1;
      const W = 80, H = 24;

      // Map prices to SVG coordinates
      const pts = prices.map(function (p, i) {
        const x = (i / (prices.length - 1)) * W;
        const y = H - ((p - min) / range) * (H - 2) - 1;
        return x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");

      const isUp  = prices[prices.length - 1] >= prices[0];
      const color = isUp ? "#16A34A" : "#DC2626";

      svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } catch (e) {
      // Silent fail — sparkline just won't show
    }
  });


  /* ══════════════════════════════════════════════════════
     4. MOVERS TABS — coins.html
     Gainers / Losers / Picks tab switching.
  ══════════════════════════════════════════════════════ */
  document.querySelectorAll(".mover-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      // Deactivate all tabs and panels
      document.querySelectorAll(".mover-tab").forEach(function (t) {
        t.classList.remove("active");
      });
      document.querySelectorAll(".movers-list").forEach(function (l) {
        l.classList.remove("active");
      });
      // Activate clicked tab and its panel
      tab.classList.add("active");
      const panel = document.getElementById("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");
    });
  });


  /* ══════════════════════════════════════════════════════
     5. MOVERS COLLAPSE BUTTON
     The chevron button at the top-right of the movers section
     collapses/expands the entire movers body.
  ══════════════════════════════════════════════════════ */
  const moversBody = document.getElementById("moversBody");
  const moversBtn  = document.getElementById("moversCollapse");
  let   moversCollapsed = false;

  if (moversBody && moversBtn) {
    moversBtn.addEventListener("click", function () {
      moversCollapsed = !moversCollapsed;
      moversBody.style.display = moversCollapsed ? "none" : "";

      // Flip chevron icon to match state
      const icon = moversBtn.querySelector("i");
      if (icon) {
        icon.className = moversCollapsed
          ? "fa-solid fa-chevron-down"
          : "fa-solid fa-chevron-up";
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     6. COIN SEARCH
     Filters coins in both table view and card view.
     Searches by coin name OR symbol.
     Updates the "Showing X coins" count.
  ══════════════════════════════════════════════════════ */
  const searchInput = document.getElementById("coinSearch");
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      const val     = this.value.toLowerCase().trim();
      let   visible = 0;

      // Filter table rows (table view)
      const tableRows = document.querySelectorAll(
        "#coinsTableBody tr.coin-row, .coins-table tbody tr.coin-row"
      );
      tableRows.forEach(function (row) {
        const match = (row.dataset.name   || "").toLowerCase().includes(val) ||
                      (row.dataset.symbol || "").toLowerCase().includes(val);
        row.style.display    = match ? "" : "none";
        row.style.visibility = match ? "" : "collapse";   // "collapse" helps with <tr> hiding
        if (match) visible++;
      });

      // Filter cards (card view)
      const cards = document.querySelectorAll("#coinsGrid .coin-card, .coins-grid .coin-card");
      cards.forEach(function (card) {
        const match = (card.dataset.name   || "").toLowerCase().includes(val) ||
                      (card.dataset.symbol || "").toLowerCase().includes(val);
        card.style.display = match ? "" : "none";
        if (match) visible++;
      });

      // Update "Showing X coins" count display
      const countEl = document.getElementById("coinCount");
      if (countEl) {
        countEl.textContent = val
          ? visible
          : (tableRows.length || cards.length);   // show total when search is empty
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     7. FORMAT HELPERS
     Kept in sync with home.js — same functions.
     Separate because coin.js needs its own scope with
     its own currentCurrency and usdRates variables.
  ══════════════════════════════════════════════════════ */

  /** Format INR using Indian number system. */
  function fmtINR(n) {
    if (!n || isNaN(n)) return "₹0";
    n = parseFloat(n);
    const LAKH_CR = 1e13, CR = 1e7, LAKH = 1e5, K = 1e3;
    if (n >= LAKH_CR) return "₹" + (n / LAKH_CR).toFixed(2) + " L.Cr";
    if (n >= CR) {
      const cr = n / CR;
      return "₹" + (cr >= 1000 ? cr.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : cr.toFixed(1)) + " Cr";
    }
    if (n >= LAKH) return "₹" + (n / LAKH).toFixed(2) + " L";
    if (n >= K)    return "₹" + (n / K).toFixed(2) + " K";
    return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  /** Format USD using international system. */
  function fmtUSD(n) {
    if (!n || isNaN(n)) return "$0";
    n = parseFloat(n);
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9)  return "$" + (n / 1e9).toFixed(2)  + "B";
    if (n >= 1e6)  return "$" + (n / 1e6).toFixed(2)  + "M";
    if (n >= 1e3)  return "$" + (n / 1e3).toFixed(2)  + "K";
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  /**
   * Format a price in the current currency.
   * @param {number|string} inrVal - INR price from data-price-inr
   * @param {string}        id     - CoinGecko coin ID
   */
  function fmtPrice(inrVal, id) {
    if (currentCurrency === "usd" && usdRates[id]) return fmtUSD(usdRates[id]);
    return fmtINR(inrVal);
  }


  /* ══════════════════════════════════════════════════════
     8. USD RATES FETCH
     Fetches USD prices, market caps, highs, lows, ATH, volumes
     for all coins visible on the page.
     Called once when user first switches to USD.
  ══════════════════════════════════════════════════════ */
  let currentCurrency = window.globalCurrency
                     || localStorage.getItem("preferredCurrency")
                     || "inr";
  let usdRates   = {};
  let usdFetched = false;

  async function fetchUSD() {
    const ids = [...new Set(
      [...document.querySelectorAll("[data-id]")]
        .map(function (c) { return c.dataset.id; })
        .filter(Boolean)
    )];
    if (!ids.length) return;

    try {
      const res    = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      if (!res.ok) return;
      const data   = await res.json();
      const USDINR = data.rates?.INR || 84.5;
      document.querySelectorAll("[data-price-inr]").forEach(function (el) {
        const inr = parseFloat(el.dataset.priceInr);
        if (inr && el.dataset.id) usdRates[el.dataset.id] = inr / USDINR;
      });
      usdFetched = true;
    } catch (e) {
      console.error("USD fetch error:", e);
    }
  }


  /* ══════════════════════════════════════════════════════
     9. UPDATE ALL PRICES ON SCREEN
     Sweeps through every price element and updates it.
     Covers: mover table rows, card grid, main table, home rows.
  ══════════════════════════════════════════════════════ */
  function updateAllPrices() {
    // Mover table rows — .mover-row with .mover-td-price child
    document.querySelectorAll(".mover-row[data-id]").forEach(function (el) {
      const priceEl = el.querySelector(".mover-td-price");
      if (priceEl) priceEl.textContent = fmtPrice(el.dataset.priceInr, el.dataset.id);
    });

    // Mover card rows — .mover-card (home page mover format on coins page)
    document.querySelectorAll(".mover-card[data-id]").forEach(function (el) {
      const priceEl = el.querySelector(".mover-price, .price-cell");
      if (priceEl) priceEl.textContent = fmtPrice(el.dataset.priceInr, el.dataset.id);
    });

    // Card grid — .coin-card with .coin-price child
    document.querySelectorAll(".coins-grid .coin-card[data-id]").forEach(function (el) {
      const priceEl = el.querySelector(".coin-price");
      if (priceEl) priceEl.textContent = fmtPrice(el.dataset.priceInr, el.dataset.id);
    });

    // Main coins table rows — .coin-row with .td-price child
    document.querySelectorAll(".coins-table tbody .coin-row[data-id]").forEach(function (el) {
      const priceEl = el.querySelector(".td-price");
      if (priceEl) priceEl.textContent = fmtPrice(el.dataset.priceInr, el.dataset.id);
    });

    // Any remaining .price-cell in a .coin-row (catches home page if loaded)
    document.querySelectorAll(".coin-row[data-id]").forEach(function (row) {
      const el = row.querySelector(".price-cell");
      if (el) el.textContent = fmtPrice(row.dataset.priceInr, row.dataset.id);
    });
  }


  /* ══════════════════════════════════════════════════════
     10. CURRENCY EVENT LISTENER
     Listens for currencyChanged event fired by main.js.
     Fetches USD rates if needed, then updates all prices.
  ══════════════════════════════════════════════════════ */
  window.addEventListener("currencyChanged", async function (e) {
    currentCurrency = e.detail.currency;
    if (currentCurrency === "usd" && !usdFetched) await fetchUSD();
    updateAllPrices();
  });


  /* ══════════════════════════════════════════════════════
     11. COIN MODAL — quick-view popup
     Clicking any coin row/card opens a bottom-sheet modal
     with price details and a 7-day chart.
  ══════════════════════════════════════════════════════ */
  const modal         = document.getElementById("coinModal");
  if (!modal) return;   // no modal on this page, stop here

  const closeBtn      = document.getElementById("closeModal");
  const modalViewMore = document.getElementById("modalViewMore");
  let   modalChart    = null;

  /**
   * Helper: set text content of an element by ID safely.
   * @param {string} id  - element ID
   * @param {string} val - text to set
   */
  function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /**
   * Open the coin quick-view modal.
   * @param {HTMLElement} el - the clicked coin row or card
   */
  function openModal(el) {
    const id       = el.dataset.id;
    const inrPrice = el.dataset.priceInr || "0";
    const change   = parseFloat(el.dataset.change || 0);

    // Link to full coin detail page
    if (modalViewMore) modalViewMore.href = `/coin/${id}?currency=${currentCurrency}`;

    // Coin identity
    const logo = document.getElementById("modalLogo");
    if (logo) logo.src = el.dataset.image || "";
    set("modalName",   el.dataset.name);
    set("modalSymbol", (el.dataset.symbol || "").toUpperCase());
    set("modalRank",   el.dataset.rank ? "#" + el.dataset.rank : "");

    // Price
    const displayPrice = fmtPrice(inrPrice, id);
    set("modalHeaderPrice", displayPrice);
    set("modalPrice",       displayPrice);

    // Stats — use USD values if available, else INR
    set("modalMarketCap",
      currentCurrency === "usd" && usdRates[id + "_mc"]
        ? fmtUSD(usdRates[id + "_mc"])
        : fmtINR(el.dataset.marketcap || 0));

    set("modalHigh",
      currentCurrency === "usd" && usdRates[id + "_high"]
        ? fmtUSD(usdRates[id + "_high"])
        : fmtINR(el.dataset.high || 0));

    set("modalLow",
      currentCurrency === "usd" && usdRates[id + "_low"]
        ? fmtUSD(usdRates[id + "_low"])
        : fmtINR(el.dataset.low || 0));

    set("modalATH",
      currentCurrency === "usd" && usdRates[id + "_ath"]
        ? fmtUSD(usdRates[id + "_ath"])
        : fmtINR(el.dataset.ath || 0));

    set("modalVolume",
      currentCurrency === "usd" && usdRates[id + "_vol"]
        ? fmtUSD(usdRates[id + "_vol"])
        : fmtINR(el.dataset.volume || 0));

    // 24h change — green for up, red for down
    const changeText  = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
    const changeColor = change >= 0 ? "#4ade80" : "#f87171";
    const changeEl    = document.getElementById("modalHeaderChange");
    if (changeEl) { changeEl.textContent = changeText; changeEl.style.color = changeColor; }
    set("modalChange", changeText);

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    loadModalChart(id);
  }

  // Attach click to all coin elements that should open the modal
  document.querySelectorAll(
    ".mover-row[data-id], .mover-card[data-id], " +
    ".coins-grid .coin-card[data-id], " +
    ".coins-table tbody .coin-row[data-id], " +
    ".coin-card[data-id], .coin-row[data-id]"
  ).forEach(function (el) {
    el.addEventListener("click", function () { openModal(this); });
  });

  // Close modal
  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  function closeModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }


  /* ══════════════════════════════════════════════════════
     12. MODAL CHART
     Fetches 7-day chart data and renders Chart.js chart.
     Shows a spinner while loading.
     Retries once on 429 (CoinGecko rate limit).
  ══════════════════════════════════════════════════════ */
  async function loadModalChart(id) {
    const canvas = document.getElementById("modalChart");
    if (!canvas) return;

    // Destroy any existing chart
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (modalChart) { modalChart.destroy(); modalChart = null; }

    // Show loading spinner while fetching
    const wrap = document.querySelector(".cmodal-chart-wrap");
    if (wrap) {
      wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;">
          <div style="width:28px;height:28px;border:3px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:spin 0.7s linear infinite;"></div>
          <span style="font-size:12px;color:#94a3b8;">Loading chart...</span>
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    }

    try {
      const cur = currentCurrency === "usd" ? "usd" : "inr";
      const sym = currentCurrency === "usd" ? "$" : "₹";
      const url = `/api/coins/${id}/chart?currency=${cur}&days=7`;

      let res = await fetch(url);

      if (!res.ok) {
        if (wrap) wrap.innerHTML = `
          <canvas id="modalChart"></canvas>
          <div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:#94a3b8;">
            Chart unavailable — API limit reached
          </div>`;
        return;
      }

      // Restore canvas and render chart
      if (wrap) wrap.innerHTML = `<canvas id="modalChart"></canvas>`;
      const newCanvas = document.getElementById("modalChart");

      const data = await res.json();
      if (!data.prices?.length) return;

      const prices  = data.prices.map(function (p) { return p[1]; });
      const labels  = data.prices.map(function (p) {
        return new Date(p[0]).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      });
      const isUp    = prices[prices.length - 1] >= prices[0];
      const color   = isUp ? "#4ade80" : "#f87171";
      const bgColor = isUp ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)";

      modalChart = new Chart(newCanvas, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data:            prices,
            borderColor:     color,
            backgroundColor: bgColor,
            borderWidth:     2,
            tension:         0.4,
            pointRadius:     0,
            fill:            true,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: "index", intersect: false },
          plugins: {
            legend:  { display: false },
            tooltip: {
              callbacks: {
                label: function (item) {
                  return " " + sym + parseFloat(item.raw).toLocaleString("en-IN", { maximumFractionDigits: 6 });
                },
              },
            },
          },
          scales: {
            x: { display: false },
            y: {
              grid:  { color: "rgba(255,255,255,0.06)" },
              ticks: {
                color: "#64748b",
                font:  { size: 10 },
                callback: function (v) {
                  if (v >= 1e3)  return sym + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
                  if (v >= 1)    return sym + parseFloat(v.toFixed(2));
                  if (v >= 0.01) return sym + parseFloat(v.toFixed(4));
                  return sym + parseFloat(v.toFixed(6));
                },
              },
            },
          },
        },
      });
    } catch (e) {
      console.error("Modal chart error:", e);
    }
  }

  // Pre-fetch USD rates quietly in background on page load
  fetchUSD();

}); // end DOMContentLoaded
