/**
 * main.js — CoinScanner Global JavaScript
 * =========================================
 * This file runs on EVERY page of the site (loaded in base_public.html).
 * It handles features that are present across all pages.
 *
 * SECTIONS:
 *   1. Mobile Navigation Menu     — hamburger toggle
 *   2. Account Dropdown           — header avatar menu
 *   3. Logout Confirmation Modal  — confirm before logging out
 *   4. Global Currency Toggle     — INR ↔ USD switch (fires event for other JS)
 *   5. Coin Watchlist Star        — ★ toggle on any page (home, coins)
 *   6. Mobile Bottom Sheet        — "more" sheet on mobile tab bar
 *   7. FAQ Accordion              — about page collapsible Q&A
 *   8. Investor Form              — investors page contact form
 *   9. Header Scroll Effect       — subtle shadow on scroll
 *  10. Page Fade-In Animation     — smooth entrance on load
 */

document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     1. MOBILE NAVIGATION MENU
     The hamburger button (#mobileMenuToggle) toggles the
     nav menu (#mainNav) open/closed on small screens.
     Clicking outside the nav closes it.
  ══════════════════════════════════════════════════════ */
  const menuToggle = document.getElementById("mobileMenuToggle");
  const mainNav    = document.getElementById("mainNav");

  if (menuToggle && mainNav) {
    // Toggle nav open/closed on hamburger click
    menuToggle.addEventListener("click", function (e) {
      e.stopPropagation();   // prevent document click from immediately closing it
      mainNav.classList.toggle("active");
      // Switch icon: bars ↔ xmark
      const icon = menuToggle.querySelector("i");
      if (icon) {
        icon.className = mainNav.classList.contains("active")
          ? "fa-solid fa-xmark"
          : "fa-solid fa-bars";
      }
    });

    // Close nav when clicking anywhere outside it
    document.addEventListener("click", function () {
      mainNav.classList.remove("active");
      const icon = menuToggle.querySelector("i");
      if (icon) icon.className = "fa-solid fa-bars";
    });

    // Prevent clicks inside the nav from closing it
    mainNav.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }


  /* ══════════════════════════════════════════════════════
     2. ACCOUNT DROPDOWN
     The header avatar button shows/hides a dropdown menu.
     Clicking outside closes it.
  ══════════════════════════════════════════════════════ */
  const accountMenu = document.querySelector(".account-menu");
  if (accountMenu) {
    accountMenu.addEventListener("click", function (e) {
      e.stopPropagation();
      const dropdown = accountMenu.querySelector(".account-dropdown");
      if (!dropdown) return;
      // Toggle display
      dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
    });

    // Close dropdown when clicking anywhere outside
    document.addEventListener("click", function () {
      const dropdown = accountMenu.querySelector(".account-dropdown");
      if (dropdown) dropdown.style.display = "none";
    });
  }


  /* ══════════════════════════════════════════════════════
     3. LOGOUT CONFIRMATION MODAL
     Clicking "Logout" in the dropdown shows a confirmation
     modal. User must click "Logout" again to confirm.
     "Cancel" closes the modal without logging out.
  ══════════════════════════════════════════════════════ */
  const logoutBtn    = document.getElementById("logoutBtn");
  const logoutModal  = document.getElementById("logoutModal");
  const cancelLogout = document.getElementById("cancelLogout");

  if (logoutBtn && logoutModal) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      logoutModal.style.display = "flex";   // show modal
    });
  }

  if (cancelLogout && logoutModal) {
    cancelLogout.addEventListener("click", function () {
      logoutModal.style.display = "none";   // hide modal
    });
  }

  // Also close modal if clicking the backdrop (outside the box)
  if (logoutModal) {
    logoutModal.addEventListener("click", function (e) {
      if (e.target === logoutModal) logoutModal.style.display = "none";
    });
  }


  /* ══════════════════════════════════════════════════════
     4. GLOBAL CURRENCY TOGGLE — INR ↔ USD
     This is the central currency state for the whole app.

     HOW IT WORKS:
       - window.globalCurrency stores the current choice ("inr" or "usd")
       - localStorage persists the choice across page loads
       - When the user clicks a toggle button, we:
           a) Update window.globalCurrency
           b) Save to localStorage
           c) Update button visual states
           d) Fire a custom "currencyChanged" event

     OTHER JS FILES LISTEN for "currencyChanged":
       - home.js  → updates home page prices
       - coin.js  → updates coins page prices

     HOW TO ADD A NEW TOGGLE BUTTON in HTML:
       <button class="hdr-cur-btn" data-currency="inr">₹ INR</button>
       <button class="hdr-cur-btn" data-currency="usd">$ USD</button>
  ══════════════════════════════════════════════════════ */

  // Load saved preference, default to INR
  window.globalCurrency = localStorage.getItem("preferredCurrency") || "inr";

  /**
   * Update the visual active state on all currency toggle buttons.
   * Buttons with matching data-currency get the "active" class.
   * @param {string} currency - "inr" or "usd"
   */
  function syncAllCurrencyToggles(currency) {
    document.querySelectorAll(".hdr-cur-btn, .currency-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.currency === currency);
    });
  }

  // Set correct active button on page load (no event fired yet)
  syncAllCurrencyToggles(window.globalCurrency);

  /**
   * Handle a currency toggle button click.
   * Updates state and fires the currencyChanged event.
   * @param {string} selected - "inr" or "usd"
   */
  function handleCurrencyChange(selected) {
    if (selected === window.globalCurrency) return;   // no change needed

    window.globalCurrency = selected;
    localStorage.setItem("preferredCurrency", selected);
    syncAllCurrencyToggles(selected);

    // Broadcast to all other JS that's listening
    window.dispatchEvent(new CustomEvent("currencyChanged", {
      detail: { currency: selected }
    }));
  }

  // Header toggle buttons (₹ INR / $ USD in the top-right)
  document.querySelectorAll(".hdr-cur-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleCurrencyChange(this.dataset.currency);
    });
  });

  // In-page toggle buttons (used on some pages as secondary toggle)
  document.querySelectorAll(".currency-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleCurrencyChange(this.dataset.currency);
    });
  });


  /* ══════════════════════════════════════════════════════
     5. COIN WATCHLIST STAR — SHARED ACROSS ALL PAGES
     This function is called inline from HTML:
       onclick="event.stopPropagation(); toggleCoinStar(this)"

     It reads the auth state from a <meta> tag rather than
     injecting Jinja into JS (cleaner separation of concerns).

     HTML required in base_public.html:
       <meta name="user-logged-in" content="{{ 'true' if session.get('user_id') else 'false' }}">

     The star button needs these data attributes:
       data-id, data-name, data-symbol, data-image
  ══════════════════════════════════════════════════════ */

  // Read auth state from meta tag (set in base_public.html)
  const _isLoggedIn = document.querySelector('meta[name="user-logged-in"]')?.content === "true";

  /**
   * Toggle a coin in/out of the watchlist.
   * Called inline from any star button on any page.
   *
   * @param {HTMLElement} btn - the star button that was clicked
   */
  window.toggleCoinStar = async function (btn) {
    // Not logged in → redirect to login
    if (!_isLoggedIn) {
      window.location.href = "/login";
      return;
    }

    const coinId     = btn.dataset.id;
    const coinName   = btn.dataset.name;
    const coinSymbol = btn.dataset.symbol;
    const coinImage  = btn.dataset.image;

    try {
      const res  = await fetch("/watchlist/coin/toggle", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          coin_id:     coinId,
          coin_name:   coinName,
          coin_symbol: coinSymbol,
          coin_image:  coinImage,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        const saved = data.saved;

        // Update ALL star buttons for this coin on the page
        // (there might be one in the mover strip AND one in the table)
        document.querySelectorAll(
          `.coin-star-btn[data-id="${coinId}"], .mover-star-btn[data-id="${coinId}"]`
        ).forEach(function (b) {
          b.classList.toggle("starred", saved);
          b.querySelector("i").className = saved ? "fa-solid fa-star" : "fa-regular fa-star";
          b.title = saved ? "Remove from watchlist" : "Add to watchlist";

          // Burst animation when adding to watchlist
          if (saved) {
            b.classList.remove("burst");
            void b.offsetWidth;   // force reflow to restart animation
            b.classList.add("burst");
            setTimeout(function () { b.classList.remove("burst"); }, 500);
          }
        });
      }
    } catch (e) {
      console.error("Watchlist toggle error:", e);
    }
  };

  /**
   * On page load: fetch saved coin IDs and fill gold stars.
   * Only runs if user is logged in.
   */
  (async function loadSavedCoinStars() {
    if (!_isLoggedIn) return;

    try {
      const res  = await fetch("/api/watchlist/coins");
      const data = await res.json();
      if (!data.ok) return;

      data.coin_ids.forEach(function (id) {
        document.querySelectorAll(
          `.coin-star-btn[data-id="${id}"], .mover-star-btn[data-id="${id}"]`
        ).forEach(function (btn) {
          btn.classList.add("starred");
          btn.querySelector("i").className = "fa-solid fa-star";
          btn.title = "Remove from watchlist";
        });
      });
    } catch (e) {
      // Silent fail — stars just appear empty (still functional)
    }
  })();


  /* ══════════════════════════════════════════════════════
     6. MOBILE BOTTOM SHEET
     The bottom tab bar has a "More" button on some
     configurations. Tapping it slides up a sheet with
     extra navigation links and logout.

     This avoids Jinja in JS by reading URLs from
     data attributes on the button itself.

     HTML: the sheet content URLs come from data-* attrs
     on #tabMoreBtn set in base_public.html
  ══════════════════════════════════════════════════════ */
  if (window.innerWidth <= 768) {
    const moreBtn = document.getElementById("tabMoreBtn");
    if (!moreBtn) return;   // no "more" button on this page layout

    // Read URLs from data attributes (set in HTML, no Jinja in JS)
    const logoutUrl  = moreBtn.dataset.logoutUrl  || "/logout";
    const userEmail  = moreBtn.dataset.userEmail  || "";

    // Build the bottom sheet HTML
    const sheet = document.createElement("div");
    sheet.id    = "tabSheet";
    sheet.style.display = "none";
    sheet.innerHTML = `
      <!-- Dark overlay behind the sheet -->
      <div id="tabSheetOverlay" style="
        position:fixed;inset:0;
        background:rgba(15,23,42,0.5);
        backdrop-filter:blur(4px);
        z-index:1999;
      "></div>

      <!-- Sheet panel slides up from bottom -->
      <div id="tabSheetPanel" style="
        position:fixed;bottom:0;left:0;right:0;
        background:#fff;
        border-radius:24px 24px 0 0;
        z-index:2000;
        padding-bottom:calc(16px + env(safe-area-inset-bottom, 0px));
        animation:tabSheetUp 0.28s cubic-bezier(0.32,0.72,0,1);
      ">
        <!-- Drag handle -->
        <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:12px auto 0;"></div>

        <!-- User info (if logged in) -->
        ${userEmail ? `
        <div style="display:flex;align-items:center;gap:14px;padding:20px 20px 16px;border-bottom:1px solid #f1f5f9;">
          <i class="fa-solid fa-circle-user" style="font-size:40px;color:#2563eb;"></i>
          <div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;">${userEmail}</div>
            <div style="font-size:11px;color:#16a34a;font-weight:600;margin-top:2px;">Logged in</div>
          </div>
        </div>` : ""}

        <!-- Nav links -->
        <div style="padding:8px 12px;">
          <a href="/coins"   style="display:flex;align-items:center;gap:14px;padding:14px 10px;font-size:15px;font-weight:600;color:#1e293b;text-decoration:none;border-radius:12px;"><i class="fa-solid fa-coins" style="width:20px;color:#2563eb;"></i> Coins</a>
          <a href="/compare" style="display:flex;align-items:center;gap:14px;padding:14px 10px;font-size:15px;font-weight:600;color:#1e293b;text-decoration:none;border-radius:12px;"><i class="fa-solid fa-scale-balanced" style="width:20px;color:#2563eb;"></i> Compare</a>
          <a href="/news"    style="display:flex;align-items:center;gap:14px;padding:14px 10px;font-size:15px;font-weight:600;color:#1e293b;text-decoration:none;border-radius:12px;"><i class="fa-solid fa-newspaper" style="width:20px;color:#2563eb;"></i> News</a>
          <a href="/about"   style="display:flex;align-items:center;gap:14px;padding:14px 10px;font-size:15px;font-weight:600;color:#1e293b;text-decoration:none;border-radius:12px;"><i class="fa-solid fa-circle-info" style="width:20px;color:#2563eb;"></i> About</a>
        </div>

        <!-- Logout button (only if logged in) -->
        ${userEmail ? `
        <div style="padding:8px 20px 0;border-top:1px solid #f1f5f9;">
          <button id="tabSheetLogout" style="
            width:100%;padding:14px;
            background:#fef2f2;color:#dc2626;
            border:1px solid #fecaca;border-radius:12px;
            font-size:14px;font-weight:700;
            display:flex;align-items:center;justify-content:center;gap:10px;
            cursor:pointer;
          ">
            <i class="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        </div>` : ""}
      </div>
    `;

    // Inject CSS animation (only need to do once)
    const animStyle = document.createElement("style");
    animStyle.textContent = `@keyframes tabSheetUp { from{transform:translateY(100%)} to{transform:translateY(0)} }`;
    document.head.appendChild(animStyle);

    document.body.appendChild(sheet);

    /** Close the sheet (hide it + restore scroll) */
    function closeSheet() {
      sheet.style.display  = "none";
      document.body.style.overflow = "";
    }

    // Open sheet on More button click
    moreBtn.addEventListener("click", function () {
      sheet.style.display  = "block";
      document.body.style.overflow = "hidden";   // prevent background scroll
    });

    // Close on overlay click
    sheet.querySelector("#tabSheetOverlay")?.addEventListener("click", closeSheet);

    // Logout button
    sheet.querySelector("#tabSheetLogout")?.addEventListener("click", function () {
      window.location.href = logoutUrl;
    });

  } // end mobile-only block


  /* ══════════════════════════════════════════════════════
     7. FAQ ACCORDION — About Page
     Collapsible FAQ items. Only one open at a time.
     Called inline: onclick="toggleFaq(this)"
  ══════════════════════════════════════════════════════ */

  /**
   * Toggle a FAQ item open/closed.
   * Closes all other open items first (accordion behaviour).
   * @param {HTMLElement} btn - the question button that was clicked
   */
  window.toggleFaq = function (btn) {
    const item   = btn.parentElement;
    const answer = item.querySelector(".lp-faq-a");
    const icon   = btn.querySelector(".lp-faq-icon");
    const isOpen = item.classList.contains("open");

    // Close all open items first
    document.querySelectorAll(".lp-faq-item.open").forEach(function (el) {
      el.classList.remove("open");
      const a = el.querySelector(".lp-faq-a");
      const i = el.querySelector(".lp-faq-icon");
      if (a) a.style.maxHeight = "0";
      if (i) i.style.transform = "rotate(0deg)";
    });

    // If the clicked one was closed, open it
    if (!isOpen) {
      item.classList.add("open");
      if (answer) answer.style.maxHeight = answer.scrollHeight + "px";
      if (icon)   icon.style.transform   = "rotate(180deg)";
    }
  };


  /* ══════════════════════════════════════════════════════
     8. INVESTOR FORM — Investors Page
     Validates and submits the investor inquiry form.
     Falls back to mailto: link since there's no backend
     email sending yet.
     Called inline: onclick="submitInvestorForm()"
  ══════════════════════════════════════════════════════ */

  /**
   * Validate and submit the investor contact form.
   * Shows success state and opens mailto: link.
   */
  window.submitInvestorForm = function () {
    const name    = document.getElementById("inv-name")?.value.trim();
    const email   = document.getElementById("inv-email")?.value.trim();
    const type    = document.getElementById("inv-type")?.value;
    const message = document.getElementById("inv-message")?.value.trim();
    const errEl   = document.getElementById("formError");
    const org     = document.getElementById("inv-org")?.value.trim() || "";

    // Validate required fields
    if (!name || !email || !type || !message) {
      if (errEl) errEl.style.display = "flex";
      return;
    }
    if (errEl) errEl.style.display = "none";

    // Show success state (hide form, show thank you message)
    const formFields = document.getElementById("formFields");
    const formSuccess = document.getElementById("formSuccess");
    if (formFields)  formFields.style.display  = "none";
    if (formSuccess) formSuccess.style.display = "flex";

    // Build mailto link as fallback
    // TODO: Replace with a proper POST to a backend endpoint
    const subject = encodeURIComponent(`Investor Inquiry — ${type} — ${name}`);
    const body    = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nOrganisation: ${org || "N/A"}\nType: ${type}\n\nMessage:\n${message}`
    );

    setTimeout(function () {
      window.location.href = `mailto:coinscanner.tech@gmail.com?subject=${subject}&body=${body}`;
    }, 800);   // small delay so user sees the success message first
  };

  // Allow Enter key on form inputs to trigger submit
  document.querySelectorAll(".inv-form-card input, .inv-form-card select").forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") window.submitInvestorForm();
    });
  });


  /* ══════════════════════════════════════════════════════
     9. HEADER SCROLL EFFECT
     Add a subtle shadow + background blur to the header
     when the user scrolls down, to visually separate it
     from the page content. Removed when back at top.
  ══════════════════════════════════════════════════════ */
  const appHeader = document.querySelector(".app-header");
  if (appHeader) {
    window.addEventListener("scroll", function () {
      if (window.scrollY > 10) {
        appHeader.classList.add("scrolled");
      } else {
        appHeader.classList.remove("scrolled");
      }
    }, { passive: true });   // passive = better scroll performance
  }


  /* ══════════════════════════════════════════════════════
     10. PAGE FADE-IN ANIMATION
     The body starts invisible (opacity:0 set in CSS)
     and fades in on load for a polished feel.
  ══════════════════════════════════════════════════════ */
  // Fade in the page — safety timeout ensures it shows even if something fails
  document.body.style.opacity    = "0";
  document.body.style.transition = "opacity 0.2s ease";
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.body.style.opacity = "1";
    });
  });
  // Hard fallback — force visible after 500ms no matter what
  setTimeout(function () { document.body.style.opacity = "1"; }, 500);

}); // end DOMContentLoaded

/* ══════════════════════════════════════════════════════
   PRICE FLASH ANIMATION
   Called whenever a displayed price updates.
   Adds .flash-up or .flash-down class for 600ms.
══════════════════════════════════════════════════════ */

/**
 * Flash a price cell green (up) or red (down).
 * @param {HTMLElement} el        - the element to flash
 * @param {string}      direction - 'up' or 'down'
 */
window.flashPrice = function(el, direction) {
    if (!el) return;
    // Remove any existing flash classes first
    el.classList.remove('flash-up', 'flash-down');
    // Force reflow so animation restarts
    void el.offsetWidth;
    el.classList.add(direction === 'up' ? 'flash-up' : 'flash-down');
    setTimeout(function() {
        el.classList.remove('flash-up', 'flash-down');
    }, 650);
};

/**
 * Apply flash to all .price-cell elements when prices refresh.
 * Compare old vs new price and flash accordingly.
 * @param {string} coinId   - data-id of the coin row
 * @param {number} newPrice - new price value
 */
window.flashCoinPrice = function(coinId, newPrice) {
    const rows = document.querySelectorAll('[data-id="' + coinId + '"]');
    rows.forEach(function(row) {
        const oldPrice = parseFloat(row.dataset.priceInr || 0);
        if (!oldPrice || oldPrice === newPrice) return;
        const direction = newPrice > oldPrice ? 'up' : 'down';
        const priceEl   = row.querySelector('.price-cell');
        if (priceEl) window.flashPrice(priceEl, direction);
        // Update stored price
        row.dataset.priceInr = newPrice;
    });
};


/* ══════════════════════════════════════════════════════
   DARK MODE — Apply persisted theme on every page load.
   The base_public.html <head> script handles the pre-paint
   flash prevention. This block ensures body.dark is set
   correctly after DOMContentLoaded in all cases.
══════════════════════════════════════════════════════ */

(function applyPersistedTheme() {
    try {
        if (localStorage.getItem('cs_theme') === 'dark') {
            document.body.classList.add('dark');
            // Remove the preload class from <html> — no longer needed
            document.documentElement.classList.remove('dark-preload');
        }
    } catch(e) {}
})();
