/**
 * home.js — CoinScanner Home Page
 * ==================================
 * JavaScript specific to the home page (/):
 *
 *   1. Currency State        — reads from main.js global currency
 *   2. Format Helpers        — fmtINR / fmtUSD for client-side display
 *   3. USD Price Fetch       — fetch USD prices from CoinGecko on demand
 *   4. Update Table Prices   — swap displayed prices when currency changes
 *   5. Currency Event Listen — respond to INR↔USD toggle from main.js
 *   6. Mover Tabs            — gainers/losers/picks tab auto-rotate
 *   7. Sparklines            — SVG mini price charts in the coin table
 *   8. Coin Modal            — click a row to open quick-view popup
 *   9. Market Stats          — fetch and display global market numbers
 *  10. Trending Strip        — fetch top trending coins from CoinGecko
 *  11. Ticker                — scrolling price ticker at the top
 *
 * NOTE: toggleCoinStar() and loadSavedCoinStars() have been moved to main.js
 * because they're shared with the coins page.
 *
 * Loaded only on home.html via:
 *   {% block extra_js %}
 *     <script src="{{ url_for('static', filename='js/home.js') }}"></script>
 *   {% endblock %}
 */


/* ══════════════════════════════════════════════════════
   MODULE-SCOPE HELPERS
   Defined outside DOMContentLoaded so they're accessible
   to the async functions below (loadMarketStats, etc.)
   that run after DOM is ready.
══════════════════════════════════════════════════════ */

/**
 * Format a number as an INR string using Indian number system.
 * (same logic as Python's format_volume — kept in sync)
 * Examples: 85000000000000 → "₹8.50 L.Cr"  |  4200000 → "₹4.20 Cr"
 * @param {number} n
 * @returns {string}
 */
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
  return "₹" + n.toFixed(2);
}

/**
 * Format a number as a USD string using international system.
 * Examples: 1900000000000 → "$1.90T"  |  45000000 → "$45.00M"
 * @param {number} n
 * @returns {string}
 */
function fmtUSD(n) {
  if (!n || isNaN(n)) return "$0";
  n = parseFloat(n);
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n / 1e9).toFixed(2)  + "B";
  if (n >= 1e6)  return "$" + (n / 1e6).toFixed(2)  + "M";
  if (n >= 1e3)  return "$" + (n / 1e3).toFixed(2)  + "K";
  return "$" + n.toFixed(2);
}

/**
 * Re-render the hero band statistics (market cap, volume, BTC dominance)
 * in the correct currency after a currency switch.
 *
 * Reads from window._globalStats which is populated by loadMarketStats().
 * @param {string} currency - "inr" or "usd"
 */
function renderHeroBand(currency) {
  if (!window._globalStats) return;
  const s = window._globalStats;

  // Total Market Cap
  const capEl  = document.getElementById("heroMktCap");
  const capChg = document.getElementById("heroMktCapChg");
  if (capEl) capEl.textContent = currency === "usd" ? fmtUSD(s.total_market_cap_usd) : fmtINR(s.total_market_cap_inr);
  if (capChg) {
    const chg = s.market_cap_change_percentage_24h || 0;
    capChg.textContent = (chg >= 0 ? "▲ " : "▼ ") + Math.abs(chg).toFixed(1) + "%";
    capChg.className   = "hstat-chg " + (chg >= 0 ? "up" : "dn");
  }

  // 24h Volume
  const volEl = document.getElementById("heroVolume");
  if (volEl) volEl.textContent = currency === "usd" ? fmtUSD(s.total_volume_usd) : fmtINR(s.total_volume_inr);

  // BTC Dominance
  const btcEl = document.getElementById("heroBtcDom");
  if (btcEl) btcEl.textContent = s.btc_dominance.toFixed(1) + "%";

  // ETH Dominance
  const ethEl = document.getElementById("heroEthDom");
  if (ethEl) ethEl.textContent = (s.eth_dominance || 0).toFixed(1) + "%";

  // Active coins count
  const coinsEl = document.getElementById("heroCoins");
  if (coinsEl) coinsEl.textContent = s.active_coins.toLocaleString();

  // Market mood indicator (up / down)
  const moodEl  = document.getElementById("heroMood");
  const moodDot = document.getElementById("moodDot");
  const moodTxt = document.getElementById("moodText");
  const chg = s.market_cap_change_percentage_24h || 0;
  if (moodEl && moodTxt) {
    if (chg >= 0) {
      moodEl.classList.remove("down");
      moodTxt.textContent = "Market is up " + Math.abs(chg).toFixed(1) + "% today";
      if (moodDot) moodDot.style.background = "#22C55E";   // green
    } else {
      moodEl.classList.add("down");
      moodTxt.textContent = "Market is down " + Math.abs(chg).toFixed(1) + "% today";
      if (moodDot) moodDot.style.background = "#DC2626";   // red
    }
  }
}


/* ══════════════════════════════════════════════════════
   MAIN — runs after DOM is ready
══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     1. CURRENCY STATE
     Read the current currency from main.js (which loaded first).
     main.js sets window.globalCurrency and fires currencyChanged events.
  ══════════════════════════════════════════════════════ */
  let currentCurrency = window.globalCurrency
                     || localStorage.getItem("preferredCurrency")
                     || "inr";

  // USD price cache — keyed by coin ID
  // e.g. usdRates["bitcoin"] = 85000  (USD price)
  //      usdRates["bitcoin_mc"] = 1700000000000  (market cap)
  let usdRates   = {};
  let usdFetched = false;   // flag to avoid double-fetching


  /* ══════════════════════════════════════════════════════
     2. FORMAT HELPERS (local scope)
  ══════════════════════════════════════════════════════ */

  /**
   * Format a price in the current currency.
   * Falls back to INR if USD rates haven't loaded yet.
   * @param {number|string} inrPrice - the INR price from data-price-inr attribute
   * @param {string}        coinId   - CoinGecko coin ID
   * @returns {string} formatted price string
   */
  function fmtPrice(inrPrice, coinId) {
    if (currentCurrency === "usd") {
      const usd = usdRates[coinId];
      return usd ? fmtUSD(usd) : "...";   // "..." while loading
    }
    return fmtINR(inrPrice);
  }


  /* ══════════════════════════════════════════════════════
     3. FETCH USD PRICES
     Called once when user first switches to USD.
     Fetches prices for all coins currently visible on the page
     by collecting their data-id attributes.

     Also stores market cap, high, low, ATH, volume for the modal.
  ══════════════════════════════════════════════════════ */
  async function fetchUSDPrices() {
    // Collect unique coin IDs from all [data-id] elements on the page
    const ids = [...new Set(
      [...document.querySelectorAll("[data-id]")]
        .map(function (r) { return r.dataset.id; })
        .filter(Boolean)
    )];
    if (!ids.length) return;

    try {
      // Use ExchangeRate-API for INR→USD rate (no rate limiting, no CoinGecko needed)
      const res    = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      if (!res.ok) throw new Error("Rate fetch failed");
      const data   = await res.json();
      const USDINR = data.rates?.INR || 84.5;

      // Convert all INR prices on the page to USD using the live rate
      document.querySelectorAll("[data-price-inr]").forEach(function (row) {
        const inr = parseFloat(row.dataset.priceInr);
        if (inr && row.dataset.id) {
          usdRates[row.dataset.id] = inr / USDINR;
        }
      });

      usdFetched       = true;
      window._usdRates = usdRates;

    } catch (e) {
      // Fallback: approximate USD from INR using a rough exchange rate
      console.warn("USD fetch failed, using INR/84.5 fallback:", e);
      const USDINR = 84.5;
      document.querySelectorAll("[data-price-inr]").forEach(function (row) {
        const inr = parseFloat(row.dataset.priceInr);
        if (inr && row.dataset.id) {
          usdRates[row.dataset.id] = inr / USDINR;
        }
      });
      usdFetched       = true;
      window._usdRates = usdRates;
    }
  }


  /* ══════════════════════════════════════════════════════
     4. UPDATE TABLE PRICES
     Called after currency changes or USD prices load.
     Updates every visible price element on the home page:
       - Mover card prices (.price-cell in .coin-row)
       - Coin table prices (.ct-price in .ct-row)
       - Market cap cells (.ct-mcap)
  ══════════════════════════════════════════════════════ */
  function updateTablePrices() {
    // All elements with data-id that contain a .price-cell child
    document.querySelectorAll("[data-id]").forEach(function (row) {
      const priceCell = row.querySelector(".price-cell");
      if (!priceCell) return;
      priceCell.textContent = fmtPrice(row.dataset.priceInr, row.dataset.id);
    });

    // Market cap cells in the coin table (have their own data-id)
    document.querySelectorAll(".ct-mcap[data-id]").forEach(function (cell) {
      if (currentCurrency === "usd" && window._usdRates) {
        const mcUsd = window._usdRates[cell.dataset.id + "_mc"];
        if (mcUsd) cell.textContent = "$" + (mcUsd / 1e9).toFixed(2) + "B";
      } else {
        // Restore INR market cap from data attribute
        if (cell.dataset.mcapInr) cell.textContent = cell.dataset.mcapInr;
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     5. CURRENCY EVENT LISTENERS
     Listen for the currencyChanged event fired by main.js.
     Also listen for globalStatsLoaded (fired after market stats fetch).
  ══════════════════════════════════════════════════════ */
  window.addEventListener("currencyChanged", async function (e) {
    currentCurrency = e.detail.currency;
    if (currentCurrency === "usd" && !usdFetched) await fetchUSDPrices();
    window._usdRates = usdRates;
    updateTablePrices();
    renderHeroBand(currentCurrency);
    updateTicker(currentCurrency);
  });

  // Re-render hero band once global stats have loaded
  window.addEventListener("globalStatsLoaded", function () {
    renderHeroBand(currentCurrency);
  });


  /* ══════════════════════════════════════════════════════
     6. MOVER TABS — Gainers / Losers / Picks
     Auto-rotates every 6 seconds.
     Manual click restarts the timer.

     HTML:
       <button class="mover-tab" data-tab="gainers">Gainers</button>
       <div class="movers-panel" id="panel-gainers">...</div>
  ══════════════════════════════════════════════════════ */
  const tabOrder = ["gainers", "losers", "picks"];
  let   tabIndex = 0;
  let   autoRotateInterval = null;

  /**
   * Activate a mover tab by name.
   * @param {string} tabName - "gainers", "losers", or "picks"
   */
  function activateMoverTab(tabName) {
    document.querySelectorAll(".mover-tab").forEach(function (t) {
      t.classList.remove("active");
    });
    document.querySelectorAll(".movers-panel").forEach(function (p) {
      p.classList.remove("active");
    });

    const tab   = document.querySelector(`.mover-tab[data-tab="${tabName}"]`);
    const panel = document.getElementById("panel-" + tabName);
    if (tab)   tab.classList.add("active");
    if (panel) panel.classList.add("active");
    tabIndex = tabOrder.indexOf(tabName);
  }

  /** Start (or restart) the 6-second auto-rotation. */
  function startAutoRotate() {
    if (autoRotateInterval) clearInterval(autoRotateInterval);
    autoRotateInterval = setInterval(function () {
      tabIndex = (tabIndex + 1) % tabOrder.length;
      activateMoverTab(tabOrder[tabIndex]);
    }, 6000);
  }

  // Manual tab click — activate and restart timer
  document.querySelectorAll(".mover-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      activateMoverTab(this.dataset.tab);
      startAutoRotate();   // restart timer so it doesn't jump right away
    });
  });

  startAutoRotate();   // kick off auto-rotation on page load


  /* ══════════════════════════════════════════════════════
     7. SVG SPARKLINES
     Draw mini line charts in the .ct-spark cell of each coin row.
     Data comes from data-sparkline attribute (JSON array of prices).

     Also calculates and shows the 7-day % change.
  ══════════════════════════════════════════════════════ */

  /**
   * Draw a small SVG sparkline into a container element.
   * @param {string} containerId - id of the container div
   * @param {number[]} data      - array of price values
   */
  function drawSparklineSVG(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container || !data || data.length < 2) return;

    const W = 80, H = 28;
    const max   = Math.max(...data);
    const min   = Math.min(...data);
    const range = max - min || 1;   // avoid division by zero
    const isUp  = data[data.length - 1] >= data[0];

    // Sample the data down to ~20 points for performance
    const step    = Math.max(1, Math.floor(data.length / 20));
    const sampled = data.filter(function (_, i) { return i % step === 0; });
    // Always include the last point for accuracy
    if (data[data.length - 1] !== sampled[sampled.length - 1]) {
      sampled.push(data[data.length - 1]);
    }

    // Convert prices to SVG coordinates
    const points = sampled.map(function (v, i) {
      const x = (i / (sampled.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    // Fill area under the line
    const fillPoints = "0," + H + " " + points + " " + W + "," + H;
    const color      = isUp ? "#16A34A" : "#DC2626";
    const fillColor  = isUp ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)";

    container.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:visible;">
        <polygon points="${fillPoints}" fill="${fillColor}" stroke="none"/>
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
  }

  // Render sparklines for all coin table rows
  document.querySelectorAll(".ct-row[data-sparkline]").forEach(function (row) {
    let data;
    try   { data = JSON.parse(row.dataset.sparkline || "[]"); }
    catch { return; }
    if (!data.length) return;

    drawSparklineSVG("spark-" + row.dataset.id, data);

    // Calculate and display 7-day % change from sparkline data
    const chg7dEl = row.querySelector(".ct-chg-7d");
    if (chg7dEl && data.length >= 2) {
      const first = data[0];
      const last  = data[data.length - 1];
      if (first && first !== 0) {
        const pct  = ((last - first) / first) * 100;
        const isUp = pct >= 0;
        chg7dEl.innerHTML =
          `<span class="ct-pill ${isUp ? "up" : "dn"}">${isUp ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%</span>`;
      }
    }
  });


  /* ══════════════════════════════════════════════════════
     8. COIN MODAL
     Clicking a .coin-row opens a quick-view popup modal
     with price, 24h stats, and a 7-day chart.
  ══════════════════════════════════════════════════════ */
  const modal         = document.getElementById("coinModal");
  const closeBtn      = document.getElementById("closeModal");
  const modalViewMore = document.getElementById("modalViewMore");

  if (!modal) return;   // modal not in DOM, nothing to do

  let modalChart = null;   // holds Chart.js instance — destroy before re-creating

  /**
   * Open the coin modal, populate all fields, and load the chart.
   * @param {HTMLElement} row - the clicked .coin-row element
   */
  function openCoinModal(row) {
    const id       = row.dataset.id || row.dataset.coinId;
    const inrPrice = row.dataset.priceInr || row.dataset.price || "0";
    const change   = parseFloat(row.dataset.change || 0);

    // Set "Full Details" link to the coin's detail page
    if (modalViewMore) modalViewMore.href = `/coin/${id}?currency=${currentCurrency}`;

    // Fill in modal fields
    document.getElementById("modalLogo").src            = row.dataset.image;
    document.getElementById("modalName").textContent    = row.dataset.name;
    document.getElementById("modalSymbol").textContent  = (row.dataset.symbol || "").toUpperCase();
    document.getElementById("modalRank").textContent    = row.dataset.rank ? "#" + row.dataset.rank : "—";

    // Price (INR or USD depending on current toggle)
    const displayPrice = currentCurrency === "usd" && usdRates[id]
      ? fmtUSD(usdRates[id])
      : fmtINR(inrPrice);
    document.getElementById("modalHeaderPrice").textContent = displayPrice;
    document.getElementById("modalPrice").textContent       = displayPrice;

    // Market Cap
    document.getElementById("modalMarketCap").textContent =
      currentCurrency === "usd" && usdRates[id + "_mc"]
        ? fmtUSD(usdRates[id + "_mc"])
        : fmtINR(row.dataset.marketcap || 0);

    // 24h High
    document.getElementById("modalHigh").textContent =
      currentCurrency === "usd" && usdRates[id + "_high"]
        ? fmtUSD(usdRates[id + "_high"])
        : fmtINR(row.dataset.high || 0);

    // 24h Low
    document.getElementById("modalLow").textContent =
      currentCurrency === "usd" && usdRates[id + "_low"]
        ? fmtUSD(usdRates[id + "_low"])
        : fmtINR(row.dataset.low || 0);

    // All-Time High
    document.getElementById("modalATH").textContent =
      currentCurrency === "usd" && usdRates[id + "_ath"]
        ? fmtUSD(usdRates[id + "_ath"])
        : fmtINR(row.dataset.ath || 0);

    // Volume
    document.getElementById("modalVolume").textContent =
      currentCurrency === "usd" && usdRates[id + "_vol"]
        ? fmtUSD(usdRates[id + "_vol"])
        : fmtINR(row.dataset.volume || 0);

    // 24h Change — green for up, red for down
    const changeText  = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
    const changeColor = change >= 0 ? "#4ade80" : "#f87171";
    const changeEl    = document.getElementById("modalChange");
    const headerChEl  = document.getElementById("modalHeaderChange");
    if (changeEl)  { changeEl.textContent  = changeText;  changeEl.style.color  = changeColor; }
    if (headerChEl){ headerChEl.textContent = changeText; headerChEl.style.color = changeColor; }

    // Show modal and lock page scroll
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Load chart async — pass row for fallback data
    loadModalChart(id, row);
  }

  // Attach click listener to all coin rows
  document.querySelectorAll(".coin-row").forEach(function (row) {
    row.addEventListener("click", function () { openCoinModal(this); });
  });

  // Close modal on X button, backdrop click, or Escape key
  closeBtn?.addEventListener("click", closeCoinModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeCoinModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeCoinModal();
  });

  /** Close the coin modal and destroy its chart instance. */
  function closeCoinModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }

  /**
   * Fetch 7-day price history and render a Chart.js line chart in the modal.
   * @param {string} id - CoinGecko coin ID
   */
  async function loadModalChart(id, row) {
    const canvas = document.getElementById("modalChart");
    if (!canvas) return;
    if (modalChart) { modalChart.destroy(); modalChart = null; }

    const symStr = currentCurrency === "usd" ? "$" : "₹";

    // Try CoinDCX candles first (browser-side, no server blocking)
    try {
      const res = await fetch(
        `https://public.coindcx.com/market_data/candles/?pair=B-${id}_INR&interval=1d&limit=7`,
        { mode: "cors" }
      );
      if (res.ok) {
        const candles = await res.json();
        if (Array.isArray(candles) && candles.length > 0) {
          const prices = candles.slice().reverse().map(function(c) {
            return c.close != null ? parseFloat(c.close) : parseFloat(c[4]);
          }).filter(Boolean);
          const labels = candles.slice().reverse().map(function(c, i) {
            const d = new Date((c.time || c[0] * 1000));
            return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short" });
          });
          if (prices.length >= 2) {
            drawModalChart(canvas, labels, prices, symStr);
            return;
          }
        }
      }
    } catch(e) {
      console.warn("Candle fetch failed, using fallback:", e.message);
    }

    // Fallback: build a 2-point chart from 24h low → current price
    if (row) {
      const low   = parseFloat(row.dataset.low  || 0);
      const high  = parseFloat(row.dataset.high || 0);
      const price = parseFloat(row.dataset.priceInr || 0);
      if (low && high && price) {
        const prices = [low, (low + high) / 2, price];
        const labels = ["24h Low", "Mid", "Now"];
        drawModalChart(canvas, labels, prices, symStr);
      }
    }
  }

  function drawModalChart(canvas, labels, prices, symStr) {
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    const isUp  = prices[prices.length - 1] >= prices[0];
    const color = isUp ? "#16a34a" : "#dc2626";
    modalChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          data:            prices,
          borderColor:     color,
          borderWidth:     2,
          tension:         0.4,
          pointRadius:     0,
          fill:            false,
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
                return " " + symStr + item.formattedValue;
              },
            },
          },
        },
        scales: {
            x: { display: false },
            y: {
              grid:  { color: "#e5e7eb" },
              ticks: {
                color: "#64748b",
                callback: function (v) {
                  if (v >= 1e3)  return symStr + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
                  if (v >= 1)    return symStr + parseFloat(v.toFixed(2));
                  if (v >= 0.01) return symStr + parseFloat(v.toFixed(4));
                  return symStr + parseFloat(v.toFixed(6));
                },
              },
            },
          },
        },
      });
  }

  // Pre-fetch USD prices in the background so toggle is instant
  fetchUSDPrices();

}); // end DOMContentLoaded


/* ══════════════════════════════════════════════════════
   MARKET STATS — fetched from CoinGecko /global
   Runs on page load after a short delay (non-blocking).
   Populates the hero band and fires globalStatsLoaded event.
══════════════════════════════════════════════════════ */

/**
 * Fetch global crypto market statistics from CoinGecko.
 * Stores result in window._globalStats and fires an event
 * so renderHeroBand() (above) can update the UI.
 */
async function loadMarketStats() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global");
    if (!res.ok) return;
    const { data } = await res.json();

    window._globalStats = {
      total_market_cap_usd:             data.total_market_cap?.usd                  || 0,
      total_market_cap_inr:             data.total_market_cap?.inr                  || 0,
      total_volume_usd:                 data.total_volume?.usd                      || 0,
      total_volume_inr:                 data.total_volume?.inr                      || 0,
      btc_dominance:                    data.market_cap_percentage?.btc             || 0,
      eth_dominance:                    data.market_cap_percentage?.eth             || 0,
      active_coins:                     data.active_cryptocurrencies               || 0,
      markets:                          data.markets                               || 0,
      market_cap_change_percentage_24h: data.market_cap_change_percentage_24h_usd  || 0,
    };

    // Render immediately with the current currency setting
    const cur = window.globalCurrency || localStorage.getItem("preferredCurrency") || "inr";
    renderHeroBand(cur);

    // Let other listeners know stats are ready
    window.dispatchEvent(new CustomEvent("globalStatsLoaded"));

  } catch (e) {
    console.error("Market stats error:", e);
  }
}


/* ══════════════════════════════════════════════════════
   TRENDING STRIP
   Fetches trending coins from CoinGecko and renders
   clickable chips in the #trendingChips container.
══════════════════════════════════════════════════════ */

/**
 * Load and render the trending coins strip.
 * Shows top 8 trending coins with 24h % change.
 */
async function loadTrendingStrip() {
  const container = document.getElementById("trendingChips");
  if (!container) return;

  try {
    const res   = await fetch("https://api.coingecko.com/api/v3/search/trending");
    if (!res.ok) return;
    const data  = await res.json();
    const coins = data.coins.slice(0, 8);

    container.innerHTML = coins.map(function (item, i) {
      const c      = item.item;
      const change = c.data?.price_change_percentage_24h?.usd;
      const chgStr = change != null
        ? `<span class="trend-chip-chg ${change >= 0 ? "up" : "dn"}">${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span>`
        : "";
      // Use symbol (e.g. "BTC") for URL — our coin detail page uses DCX symbols
      const sym = (c.symbol || "").toUpperCase();
      return `
        <a href="/coin/${sym}" class="trend-chip">
          <span class="trend-chip-rank">#${i + 1}</span>
          <img src="${c.small}" alt="${c.name}" class="trend-chip-img" onerror="this.style.display='none'">
          <span class="trend-chip-name">${c.name}</span>
          ${chgStr}
        </a>`;
    }).join("");

  } catch (e) {
    console.error("Trending strip error:", e);
    const el = document.getElementById("trendingChips");
    if (el) el.innerHTML = '<span style="font-size:12px;color:#CBD5E1;">Unavailable</span>';
  }
}


/* ══════════════════════════════════════════════════════
   TICKER — scrolling price strip at top of page
   Duplicates content for seamless infinite scroll.
══════════════════════════════════════════════════════ */

// Store the original HTML before duplication
let _tickerOriginalHTML = null;

/** Setup ticker — duplicate content for infinite loop. */
function setupTicker() {
  const track = document.getElementById("tickerTrack");
  if (!track) return;
  _tickerOriginalHTML = track.innerHTML;
  track.innerHTML    += track.innerHTML;   // duplicate for seamless loop
}

/**
 * Update ticker prices when currency changes.
 * @param {string} currency - "inr" or "usd"
 */
function updateTicker(currency) {
  const track = document.getElementById("tickerTrack");
  if (!track || !_tickerOriginalHTML) return;

  // Work on a temporary element to avoid visible flicker
  const temp = document.createElement("div");
  temp.innerHTML = _tickerOriginalHTML;

  temp.querySelectorAll(".ticker-item").forEach(function (item) {
    const nameEl  = item.querySelector(".ticker-name");
    const priceEl = item.querySelector(".ticker-price");
    if (!nameEl || !priceEl) return;

    const symbol = nameEl.textContent.trim().toLowerCase();
    const row    = document.querySelector(`[data-symbol="${symbol}"], [data-id="${symbol}"]`);
    const coinId = row ? row.dataset.id : symbol;

    if (currency === "usd" && window._usdRates?.[coinId]) {
      const usd = window._usdRates[coinId];
      priceEl.textContent = usd >= 1
        ? "$" + usd.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : "$" + usd.toFixed(6);
    }
  });

  track.innerHTML = temp.innerHTML + temp.innerHTML;   // re-duplicate
}


/* ══════════════════════════════════════════════════════
   INIT — run after DOM is ready
   Staggered with setTimeout to not block initial render.
══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", function () {
  setupTicker();
  setTimeout(loadMarketStats,   300);   // 300ms delay — after page renders
  setTimeout(loadTrendingStrip, 600);   // 600ms delay — lowest priority
});


/* ══════════════════════════════════════════════════════
   MOVER CARD SPARKLINES
   Draws tiny SVG sparklines on each .mover-sparkline canvas.
   Data comes from data-sparkline attribute on the <canvas>.
══════════════════════════════════════════════════════ */

/**
 * Draw a mini sparkline on a <canvas> element.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} prices  - array of price values
 * @param {boolean}  isUp    - true = green, false = red
 */
function drawMoverSparkline(canvas, prices, isUp) {
    if (!canvas || !prices || prices.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth  || canvas.parentElement.offsetWidth || 160;
    const H   = 36;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const max   = Math.max.apply(null, prices);
    const min   = Math.min.apply(null, prices);
    const range = max - min || 1;

    // Sample to ~24 points
    const step    = Math.max(1, Math.floor(prices.length / 24));
    const sampled = prices.filter(function(_, i){ return i % step === 0; });
    if (prices[prices.length - 1] !== sampled[sampled.length - 1]) {
        sampled.push(prices[prices.length - 1]);
    }

    const color    = isUp ? '#16A34A' : '#DC2626';
    const fillFrom = isUp ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)';

    ctx.clearRect(0, 0, W, H);

    // Build path
    ctx.beginPath();
    sampled.forEach(function(v, i) {
        const x = (i / (sampled.length - 1)) * W;
        const y = H - ((v - min) / range) * (H - 4) - 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    // Fill under line
    const lastX = W;
    const lastY = H - ((sampled[sampled.length - 1] - min) / range) * (H - 4) - 2;
    ctx.lineTo(lastX, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = fillFrom;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    sampled.forEach(function(v, i) {
        const x = (i / (sampled.length - 1)) * W;
        const y = H - ((v - min) / range) * (H - 4) - 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle   = color;
    ctx.lineWidth     = 1.5;
    ctx.lineJoin      = 'round';
    ctx.lineCap       = 'round';
    ctx.stroke();
}

/** Expose globally so coins.js can reuse it. */
window.drawSparkline = function(containerId, prices) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const isUp = prices.length >= 2 && prices[prices.length - 1] >= prices[0];
    // If it's a canvas — use canvas draw; if div — use SVG (table rows)
    if (el.tagName === 'CANVAS') {
        drawMoverSparkline(el, prices, isUp);
    }
};

/** Draw sparklines on all .mover-sparkline canvases. */
function drawAllMoverSparklines() {
    document.querySelectorAll('.mover-sparkline').forEach(function(canvas) {
        try {
            const prices = JSON.parse(canvas.dataset.sparkline || '[]');
            const change = parseFloat(canvas.dataset.change || '0');
            const isUp   = change >= 0;
            // Wait for canvas to have width in DOM
            requestAnimationFrame(function() {
                drawMoverSparkline(canvas, prices, isUp);
            });
        } catch(e) { /* skip */ }
    });
}


/* ══════════════════════════════════════════════════════
   WATCHLIST SECTION — logged-in users home page
   Reads saved coins from localStorage (set by main.js star logic).
   Matches saved coin IDs against coins already on the page.
══════════════════════════════════════════════════════ */

function renderWatchlistSection() {
    const section = document.getElementById('watchlistSection');
    if (!section) return;   // not logged in or element missing

    const row   = document.getElementById('watchlistRow');
    const empty = document.getElementById('watchlistEmpty');
    if (!row) return;

    // Get saved coin IDs from localStorage
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem('saved_coins') || '[]');
    } catch(e) { saved = []; }

    if (!saved.length) {
        if (empty) empty.style.display = 'flex';
        return;
    }

    // Build a lookup from coin rows already on the page
    const coinMap = {};
    document.querySelectorAll('[data-id][data-price-inr]').forEach(function(el) {
        const id = el.dataset.id;
        if (id && !coinMap[id]) {
            coinMap[id] = {
                id:     id,
                name:   el.dataset.name   || id,
                symbol: el.dataset.symbol || '',
                image:  el.dataset.image  || '',
                price:  el.dataset.priceInr || el.dataset.price || 0,
                change: parseFloat(el.dataset.change || '0'),
            };
        }
    });

    // Also check saved_coins_meta (set by main.js when starring)
    let savedMeta = {};
    try {
        savedMeta = JSON.parse(localStorage.getItem('saved_coins_meta') || '{}');
    } catch(e) {}

    let rendered = 0;
    saved.forEach(function(id) {
        const coin = coinMap[id] || savedMeta[id];
        if (!coin) return;

        const up     = coin.change >= 0;
        const chgAbs = Math.abs(coin.change).toFixed(2);
        const sym    = (coin.symbol || '').toUpperCase();

        // Format price
        let priceStr = '—';
        const p = parseFloat(coin.price);
        if (p) {
            const sym2 = '₹';
            if (p < 0.01)     priceStr = sym2 + p.toFixed(6);
            else if (p < 1)   priceStr = sym2 + p.toFixed(4);
            else               priceStr = sym2 + Number(p).toLocaleString('en-IN', {maximumFractionDigits: 2});
        }

        const chip = document.createElement('a');
        chip.className = 'watchlist-chip';
        chip.href      = '/coin/' + id;
        chip.innerHTML =
            (coin.image ? `<img src="${coin.image}" alt="${coin.name}" onerror="this.style.display='none'">` : '') +
            `<span class="watchlist-chip-name">${sym || coin.name}</span>` +
            `<span class="watchlist-chip-price">${priceStr}</span>` +
            `<span class="watchlist-chip-change ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${chgAbs}%</span>`;

        row.appendChild(chip);
        rendered++;
    });

    if (rendered === 0 && empty) {
        empty.style.display = 'flex';
    }
}


/* ══════════════════════════════════════════════════════
   HOOK INTO EXISTING DOMContentLoaded
   Appended here so the original init block above runs first.
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
    // Draw sparklines on mover cards after a short delay
    // (ensures the mover tab panels are visible / have width)
    setTimeout(drawAllMoverSparklines, 400);

    // Render watchlist section for logged-in users
    renderWatchlistSection();
});
