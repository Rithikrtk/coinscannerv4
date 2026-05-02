/**
 * profile.js — CoinScanner Profile Page
 * ========================================
 * Handles everything on the /profile page:
 *
 *   1. Tab Switching     — toggle between Profile and Watchlist tabs
 *   2. Deep Link         — /profile?tab=watchlist jumps straight to watchlist
 *   3. Live Prices       — fetch current INR prices for watchlisted coins
 *   4. Remove Coin       — remove a coin from watchlist without page reload
 *   5. Remove Exchange   — remove an exchange from watchlist without page reload
 *   6. Badge Counter     — update the watchlist count badge when items removed
 *
 * Loaded only on profile.html via:
 *   {% block extra_js %}
 *     <script src="{{ url_for('static', filename='js/profile.js') }}"></script>
 *   {% endblock %}
 */

document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     1. TAB SWITCHING
     Clicking a .profile-tab button shows the matching
     .profile-panel (matched by data-tab attribute).

     HTML structure:
       <button class="profile-tab" data-tab="overview">Profile</button>
       <button class="profile-tab" data-tab="watchlist">Watchlist</button>

       <div class="profile-panel active" id="tab-overview">...</div>
       <div class="profile-panel"        id="tab-watchlist">...</div>
  ══════════════════════════════════════════════════════ */

  /**
   * Activate a profile tab by name.
   * @param {string} name - tab name matching data-tab attribute, e.g. "watchlist"
   */
  function activateTab(name) {
    // Remove active from all tabs and panels
    document.querySelectorAll(".profile-tab").forEach(function (t) {
      t.classList.remove("active");
    });
    document.querySelectorAll(".profile-panel").forEach(function (p) {
      p.classList.remove("active");
    });

    // Activate the matching tab button and panel
    const tab   = document.querySelector(`.profile-tab[data-tab="${name}"]`);
    const panel = document.getElementById("tab-" + name);
    if (tab)   tab.classList.add("active");
    if (panel) panel.classList.add("active");
  }

  // Attach click listeners to all tab buttons
  document.querySelectorAll(".profile-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      activateTab(this.dataset.tab);
    });
  });


  /* ══════════════════════════════════════════════════════
     2. DEEP LINK SUPPORT
     /profile?tab=watchlist should jump directly to watchlist tab.
     Used by the header dropdown "Watchlist" link.
  ══════════════════════════════════════════════════════ */
  const urlParams = new URLSearchParams(window.location.search);
  const urlTab    = urlParams.get("tab");
  if (urlTab) {
    activateTab(urlTab);
  }


  /* ══════════════════════════════════════════════════════
     3. LIVE PRICES FOR WATCHLISTED COINS
     On page load, fetch current INR prices from CoinGecko
     for every coin in the watchlist and update the display.

     Each coin row has:
       id="wl-price-{coinId}"  → price element
       id="wl-chg-{coinId}"    → 24h change element

     We collect all coin IDs from the DOM, make one API call
     for all of them at once (efficient), then update each row.
  ══════════════════════════════════════════════════════ */
  (async function loadWatchlistPrices() {
    // Collect all coin IDs from watchlist rows
    const coinRows = document.querySelectorAll(".wl-coin-row[data-coin-id]");
    if (!coinRows.length) return;   // no watchlist → nothing to do

    const coinIds = [...coinRows].map(function (r) { return r.dataset.coinId; });

    try {
      // Use our own Flask API — fetches from CoinDCX, no rate limiting
      const res  = await fetch(`/api/coins?per_page=200`);
      if (!res.ok) throw new Error("API fetch failed");
      const data = await res.json();

      // Build a quick lookup map by symbol (coin IDs are now DCX symbols e.g. "BTC")
      const coinMap = {};
      (data.coins || []).forEach(function (coin) {
        coinMap[coin.symbol] = coin;
        coinMap[coin.id]     = coin;   // also index by id in case stored as symbol
      });

      // Update each coin's price and 24h change in the DOM
      coinIds.forEach(function (id) {
        const coin    = coinMap[id] || coinMap[id.toUpperCase()];
        if (!coin) return;

        const priceEl = document.getElementById("wl-price-" + id);
        const chgEl   = document.getElementById("wl-chg-"   + id);

        if (priceEl) {
          priceEl.textContent = "₹" + (coin.current_price || 0).toLocaleString("en-IN");
        }

        if (chgEl) {
          const chg = coin.price_change_percentage_24h || 0;
          const up  = chg >= 0;
          const pct = Math.abs(chg).toFixed(2);
          chgEl.innerHTML = `<span class="wl-pill ${up ? "up" : "dn"}">${up ? "▲" : "▼"} ${pct}%</span>`;
        }
      });

    } catch (e) {
      // Silently fail — prices just show as "–" (already in HTML)
      console.warn("Watchlist price fetch failed:", e);
    }
  })();


  /* ══════════════════════════════════════════════════════
     4. REMOVE COIN FROM WATCHLIST
     Called inline from the remove button: onclick="removeCoin('bitcoin')"
     Sends a toggle request to the server (toggles off = removes).
     On success, removes the row from the DOM without page reload.
  ══════════════════════════════════════════════════════ */

  /**
   * Remove a coin from the watchlist.
   * @param {string} coinId - CoinGecko coin ID, e.g. "bitcoin"
   */
  window.removeWatchlistCoin = async function (coinId) {
    try {
      const res  = await fetch("/watchlist/coin/toggle", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // Sending empty name/symbol/image because we just want to remove it
        body:    JSON.stringify({ coin_id: coinId, coin_name: "", coin_symbol: "", coin_image: "" }),
      });
      const data = await res.json();

      if (data.ok && !data.saved) {
        // Remove the row from the DOM
        const row = document.getElementById("coin-row-" + coinId);
        if (row) {
          row.style.opacity    = "0";
          row.style.transition = "opacity 0.3s ease";
          setTimeout(function () { row.remove(); }, 300);   // wait for fade
        }
        updateWatchlistBadge(-1);
        checkEmptyWatchlist();
      }
    } catch (e) {
      console.error("Remove coin error:", e);
    }
  };


  /* ══════════════════════════════════════════════════════
     5. REMOVE EXCHANGE FROM WATCHLIST
     Same pattern as remove coin, but for exchanges.
  ══════════════════════════════════════════════════════ */

  /**
   * Remove an exchange from the watchlist.
   * @param {string} exchangeId - exchange ID, e.g. "coindcx"
   */
  window.removeWatchlistExchange = async function (exchangeId) {
    try {
      const res  = await fetch("/watchlist/exchange/toggle", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ exchange_id: exchangeId, exchange_name: "", exchange_logo: "" }),
      });
      const data = await res.json();

      if (data.ok && !data.saved) {
        const card = document.getElementById("ex-card-" + exchangeId);
        if (card) {
          card.style.opacity    = "0";
          card.style.transition = "opacity 0.3s ease";
          setTimeout(function () { card.remove(); }, 300);
        }
        updateWatchlistBadge(-1);
        checkEmptyWatchlist();
      }
    } catch (e) {
      console.error("Remove exchange error:", e);
    }
  };


  /* ══════════════════════════════════════════════════════
     6. BADGE COUNTER + EMPTY STATE
     The watchlist tab shows a count badge (e.g. "5").
     When an item is removed, we decrement it.
     When the list is empty, show an empty state message.
  ══════════════════════════════════════════════════════ */

  /**
   * Update the watchlist count badge by a delta amount.
   * @param {number} delta - amount to add (use -1 to decrement)
   */
  function updateWatchlistBadge(delta) {
    const badge = document.querySelector(".profile-tab-badge");
    if (!badge) return;
    const current = parseInt(badge.textContent, 10) || 0;
    const newCount = Math.max(0, current + delta);
    badge.textContent = newCount;
  }

  /**
   * Show "Your watchlist is empty" message if no items remain.
   * Checks both coin and exchange sections.
   */
  function checkEmptyWatchlist() {
    const coinSection = document.getElementById("coinWatchlistSection");
    const exSection   = document.getElementById("exWatchlistSection");
    const emptyState  = document.getElementById("watchlistEmpty");

    const hasCoins    = coinSection && coinSection.querySelectorAll(".wl-coin-row").length > 0;
    const hasExchanges= exSection   && exSection.querySelectorAll(".wl-ex-card").length > 0;

    if (emptyState) {
      emptyState.style.display = (!hasCoins && !hasExchanges) ? "flex" : "none";
    }
  }

}); // end DOMContentLoaded


/* ══════════════════════════════════════════════════════
   DARK MODE TOGGLE — Profile / Appearance card
   Reads and writes 'cs_theme' key in localStorage.
   Syncs body.dark class on every toggle.
══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function() {
    const toggle = document.getElementById('darkModeToggle');
    if (!toggle) return;

    // Set initial checked state from localStorage
    try {
        const saved = localStorage.getItem('cs_theme');
        toggle.checked = (saved === 'dark');
    } catch(e) {}

    toggle.addEventListener('change', function() {
        const isDark = toggle.checked;

        // Apply to body immediately
        document.body.classList.toggle('dark', isDark);

        // Persist choice
        try {
            if (isDark) {
                localStorage.setItem('cs_theme', 'dark');
            } else {
                localStorage.removeItem('cs_theme');
                // Also remove the preload class if it's still there
                document.documentElement.classList.remove('dark-preload');
            }
        } catch(e) {}

        // Small visual feedback — flash the card briefly
        const card = document.getElementById('appearanceCard');
        if (card) {
            card.style.transition = 'background 0.3s ease';
            setTimeout(function() { card.style.transition = ''; }, 400);
        }
    });
});
