/* =====================================================
   COMPARE.JS — Browse · Filter · Select · Table · Modal
   Handles:
     1. View toggle — List (default) / Cards
        Persists preference in localStorage
     2. Filter chips — Spot / F&O / P2P / INR / Investment
     3. Search — filters both list rows and cards
     4. Select for compare — + button on list rows & cards
     5. Floating bar — shows selected exchanges
     6. Compare table — side-by-side with winner highlighting
     7. Detail modal — 4 tabs: Assets, Trading, Deposit, About
     8. Toast — max 4 exchanges warning
   ===================================================== */
(function () {
  "use strict";

  /* ── Data ── */
  const ALL  = JSON.parse(document.getElementById("exchangeData").textContent);
  const byId = {};
  ALL.forEach(ex => { byId[ex.id] = ex; });

  let selected       = [];
  let activeFilters  = new Set();
  let searchQuery    = "";
  let currentView    = localStorage.getItem("cmpView") || "list"; // list | card
  let currentModalId = null;

  /* ── DOM refs ── */
  const browseMode    = document.getElementById("browseMode");
  const compareMode   = document.getElementById("compareMode");
  const cmpListView   = document.getElementById("cmpListView");
  const cmpCardView   = document.getElementById("cmpCardView");
  const cmpGrid       = document.getElementById("cmpGrid");
  const cmpEmpty      = document.getElementById("cmpEmpty");
  const cmpBar        = document.getElementById("cmpBar");
  const cmpBarChips   = document.getElementById("cmpBarChips");
  const cmpBarClear   = document.getElementById("cmpBarClear");
  const cmpBarGo      = document.getElementById("cmpBarGo");
  const compareNowBtn = document.getElementById("compareNowBtn");
  const selCountEl    = document.getElementById("selCount");
  const backBtn       = document.getElementById("backToBrowse");
  const filterCount   = document.getElementById("filterCount");
  const filterClear   = document.getElementById("filterClear");
  const cmpSearch     = document.getElementById("cmpSearch");
  const cmpAddSelect  = document.getElementById("cmpAddSelect");
  const cmpResetBtn   = document.getElementById("cmpResetBtn");
  const cmpModal      = document.getElementById("cmpModal");
  const cmpModalClose = document.getElementById("cmpModalClose");
  const viewListBtn   = document.getElementById("viewListBtn");
  const viewCardBtn   = document.getElementById("viewCardBtn");


  /* ══════════════════════════════════════════
     1. VIEW TOGGLE — List / Cards
     Default is List. Saves preference to
     localStorage so it persists on revisit.
  ══════════════════════════════════════════ */
  function setView(view) {
    currentView = view;
    localStorage.setItem("cmpView", view);

    const isList = view === "list";
    cmpListView.style.display = isList ? "" : "none";
    cmpCardView.style.display = isList ? "none" : "";

    viewListBtn.classList.toggle("active", isList);
    viewCardBtn.classList.toggle("active", !isList);
  }

  // Apply saved view on load
  setView(currentView);

  viewListBtn.addEventListener("click", () => setView("list"));
  viewCardBtn.addEventListener("click", () => setView("card"));


  /* ══════════════════════════════════════════
     2. FILTER CHIPS
     Each chip toggles a feature filter.
     Filters apply to both list rows and cards.
  ══════════════════════════════════════════ */
  document.querySelectorAll(".cmp-filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const feat = chip.dataset.filter;
      const isActive = chip.classList.contains("active");
      if (isActive) {
        chip.classList.remove("active");
        activeFilters.delete(feat);
      } else {
        chip.classList.add("active");
        activeFilters.add(feat);
      }
      updateFilterBadge();
      applyFilters();
    });
  });

  function updateFilterBadge() {
    const n = activeFilters.size;
    if (n > 0) {
      filterCount.textContent = n + " active";
      filterCount.classList.remove("hidden");
      filterClear.classList.remove("hidden");
    } else {
      filterCount.classList.add("hidden");
      filterClear.classList.add("hidden");
    }
  }

  filterClear?.addEventListener("click", () => {
    activeFilters.clear();
    document.querySelectorAll(".cmp-filter-chip").forEach(c => c.classList.remove("active"));
    updateFilterBadge();
    applyFilters();
  });

  cmpResetBtn?.addEventListener("click", () => {
    activeFilters.clear();
    searchQuery     = "";
    cmpSearch.value = "";
    document.querySelectorAll(".cmp-filter-chip").forEach(c => c.classList.remove("active"));
    updateFilterBadge();
    applyFilters();
  });


  /* ══════════════════════════════════════════
     3. SEARCH
     Filters both list rows and card items
     simultaneously as the user types.
  ══════════════════════════════════════════ */
  cmpSearch.addEventListener("input", () => {
    searchQuery = cmpSearch.value.toLowerCase().trim();
    applyFilters();
  });


  /* ══════════════════════════════════════════
     APPLY FILTERS (shared helper)
     Runs on every filter or search change.
     Hides/shows both .cmp-list-row and .cmp-card
     based on active filters + search query.
  ══════════════════════════════════════════ */
  function applyFilters() {
    let visible = 0;

    // Filter list rows
    document.querySelectorAll(".cmp-list-row").forEach(row => {
      const show = matchesFilters(row);
      row.style.display = show ? "" : "none";
      if (show) visible++;
    });

    // Filter cards (same data attributes, same logic)
    document.querySelectorAll(".cmp-card").forEach(card => {
      const show = matchesFilters(card);
      card.style.display = show ? "" : "none";
      // Don't double-count — we use list rows as the source of truth for visible count
    });

    cmpEmpty.classList.toggle("hidden", visible > 0);
  }

  /* Returns true if this element matches current search + active filters */
  function matchesFilters(el) {
    const name        = el.dataset.name || "";
    const matchSearch = !searchQuery || name.includes(searchQuery);
    let matchFilter   = true;
    if (activeFilters.size > 0) {
      activeFilters.forEach(feat => {
        if (el.dataset[feat] !== "true") matchFilter = false;
      });
    }
    return matchSearch && matchFilter;
  }


  /* ══════════════════════════════════════════
     4. SELECT FOR COMPARE
     + button on both list rows and cards.
     Also works via the "Add to compare" dropdown.
     Max 4 exchanges allowed.
  ══════════════════════════════════════════ */

  // Attach to card + buttons
  document.querySelectorAll(".cmp-sel-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      toggleSelect(btn.dataset.id);
    });
  });

  // Attach to list row + buttons (separate class, no card CSS conflict)
  document.querySelectorAll(".clt-sel-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      toggleSelect(btn.dataset.id);
    });
  });

  // Dropdown "Add to compare"
  cmpAddSelect.addEventListener("change", () => {
    const id = cmpAddSelect.value;
    if (!id) return;
    if (!selected.includes(id)) toggleSelect(id);
    cmpAddSelect.value = "";
  });

  function toggleSelect(id) {
    if (selected.includes(id)) {
      selected = selected.filter(s => s !== id);
    } else {
      if (selected.length >= 4) {
        showToast("Max 4 exchanges can be compared.");
        return;
      }
      selected.push(id);
    }
    updateSelectionUI();
  }

  /* Updates all visual selection states across list, cards,
     the floating bar, and the Compare Now button */
  function updateSelectionUI() {
    const n = selected.length;

    // Update card selection states
    document.querySelectorAll(".cmp-card").forEach(card => {
      const sel = selected.includes(card.dataset.id);
      card.classList.toggle("selected", sel);
      const btn = card.querySelector(".cmp-sel-btn");
      if (btn) {
        btn.classList.toggle("selected", sel);
        btn.innerHTML = sel
          ? '<i class="fa-solid fa-check"></i>'
          : '<i class="fa-solid fa-plus"></i>';
      }
    });

    // Update list row selection states
    document.querySelectorAll(".cmp-list-row").forEach(row => {
      const sel = selected.includes(row.dataset.id);
      row.classList.toggle("selected", sel);
      const btn = row.querySelector(".clt-sel-btn");
      if (btn) {
        btn.classList.toggle("selected", sel);
        btn.innerHTML = sel
          ? '<i class="fa-solid fa-check"></i>'
          : '<i class="fa-solid fa-plus"></i>';
      }
    });

    // Compare Now button (header)
    if (n >= 2) {
      compareNowBtn.classList.remove("hidden");
      selCountEl.textContent = n;
    } else {
      compareNowBtn.classList.add("hidden");
    }

    // Floating bar
    if (n > 0) {
      cmpBar.classList.remove("hidden");
      renderBarChips();
      cmpBarGo.disabled = n < 2;
    } else {
      cmpBar.classList.add("hidden");
    }

    if (currentModalId) syncModalAddBtn(currentModalId);
  }

  /* Renders the selected exchange chips inside the floating bar */
  function renderBarChips() {
    cmpBarChips.innerHTML = "";
    selected.forEach(id => {
      const ex = byId[id];
      if (!ex) return;
      const chip = document.createElement("div");
      chip.className = "cmp-bar-chip";
      chip.innerHTML =
        '<div class="cmp-bar-chip-logo">' +
          '<img src="' + ex.logo + '" alt="' + ex.name + '" width="16" height="16" ' +
            'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="cmp-bar-chip-logo-fb" style="display:none">' + ex.name[0] + '</div>' +
        '</div>' +
        '<span class="cmp-bar-chip-name">' + ex.name + '</span>' +
        '<button class="cmp-bar-chip-x" data-id="' + id + '">' +
          '<i class="fa-solid fa-xmark"></i>' +
        '</button>';
      cmpBarChips.appendChild(chip);
    });
    cmpBarChips.querySelectorAll(".cmp-bar-chip-x").forEach(btn => {
      btn.addEventListener("click", () => toggleSelect(btn.dataset.id));
    });
  }

  cmpBarClear.addEventListener("click", () => {
    selected = [];
    updateSelectionUI();
  });


  /* ══════════════════════════════════════════
     5. COMPARE TABLE
     Builds a side-by-side table for 2–4 selected
     exchanges. Green cells = winner in that row.
  ══════════════════════════════════════════ */
  function showCompareTable() {
    if (selected.length < 2) return;
    browseMode.style.display  = "none";
    compareMode.style.display = "block";
    cmpBar.classList.add("hidden");
    buildTable();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  compareNowBtn.addEventListener("click", showCompareTable);
  cmpBarGo.addEventListener("click", showCompareTable);

  backBtn.addEventListener("click", () => {
    compareMode.style.display = "none";
    browseMode.style.display  = "block";
    if (selected.length > 0) cmpBar.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function buildTable() {
    const exchanges = selected.map(id => byId[id]).filter(Boolean);
    const thead = document.getElementById("cmpThead");
    const tbody = document.getElementById("cmpTbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    // 3+ exchanges need horizontal scroll on mobile
    const tableWrap = document.querySelector(".cmp-table-wrap");
    if (tableWrap) tableWrap.classList.toggle("has-many", exchanges.length >= 3);

    // Header row with exchange logos + names
    const headRow  = document.createElement("tr");
    const blankTh  = document.createElement("th");
    blankTh.className = "feat-col-hdr";
    headRow.appendChild(blankTh);

    exchanges.forEach(ex => {
      const th = document.createElement("th");
      th.innerHTML =
        '<div class="cmp-ex-header">' +
          '<div class="cmp-th-logo-wrap">' +
            '<img src="' + ex.logo + '" alt="' + ex.name + '" class="cmp-th-logo" ' +
              'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
            '<div class="cmp-th-logo-fb" style="display:none">' + ex.name[0] + '</div>' +
          '</div>' +
          '<div class="cmp-th-name">' + ex.name + '</div>' +
          '<button class="cmp-th-remove" data-id="' + ex.id + '">' +
            '<i class="fa-solid fa-xmark"></i> Remove' +
          '</button>' +
        '</div>';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    thead.querySelectorAll(".cmp-th-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        toggleSelect(btn.dataset.id);
        if (selected.length < 2) backBtn.click();
        else buildTable();
      });
    });

    // Row definitions — groups + data rows
    const rows = [
      { group: "FEES" },
      { label: "Spot Fee",         get: ex => ex.fees.spot },
      { label: "Futures Fee",      get: ex => ex.fees.futures },
      { label: "Deposit Fee",      get: ex => ex.deposit.charges,    winner: "free" },
      { label: "Withdrawal Fee",   get: ex => ex.withdrawal.charges, winner: "free" },
      { label: "Min Deposit",      get: ex => ex.deposit.limit },
      { label: "Min Withdrawal",   get: ex => ex.withdrawal.limit },
      { group: "TRADING" },
      { label: "Max Leverage",     get: ex => ex.leverage,   winner: "highest_num" },
      { label: "Coins Available",  get: ex => ex.currencies, winner: "highest_num" },
      { label: "USP 1",            get: ex => ex.usp1 },
      { label: "USP 2",            get: ex => ex.usp2 },
      { group: "FEATURES" },
      { label: "Spot Trading",     get: ex => ex.features.spot,            bool: true },
      { label: "Futures / F&O",    get: ex => ex.features.derivatives_fno, bool: true },
      { label: "P2P Trading",      get: ex => ex.features.p2p,             bool: true },
      { label: "INR Support",      get: ex => ex.features.inr_support,     bool: true },
      { label: "Investment / SIP", get: ex => ex.features.investment,      bool: true },
      { label: "Earning",          get: ex => ex.earning },
      { label: "Mining",           get: ex => ex.mining },
      { group: "ABOUT" },
      { label: "Founded",          get: ex => ex.about.founded },
      { label: "Headquarters",     get: ex => ex.about.headquarters },
      { label: "Regulated",        get: ex => ex.about.regulated },
    ];

    const groupIcons = { FEES: "💰", TRADING: "📈", FEATURES: "⚙️", ABOUT: "🏢" };

    rows.forEach(row => {
      const tr = document.createElement("tr");

      if (row.group) {
        const td      = document.createElement("td");
        td.className  = "feat-group";
        td.colSpan    = exchanges.length + 1;
        td.textContent= (groupIcons[row.group] || "") + " " + row.group;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      const labelTd       = document.createElement("td");
      labelTd.className   = "feat-col";
      labelTd.textContent = row.label;
      tr.appendChild(labelTd);

      const values  = exchanges.map(ex => row.get(ex));
      const winners = new Set();

      if (row.bool) {
        values.forEach((v, i) => { if (v === true) winners.add(i); });
      } else if (row.winner === "free") {
        values.forEach((v, i) => {
          const clean = String(v || "").replace(/[₹\s,]/g, "");
          if (clean === "0" || clean === "Rs.0" || clean === "Rs0") winners.add(i);
        });
      } else if (row.winner === "highest_num") {
        const nums = values.map(v => {
          const m = String(v || "").replace(/,/g, "").match(/(\d+)/);
          return m ? parseInt(m[1]) : -1;
        });
        const max = Math.max(...nums);
        if (max > 0) nums.forEach((n, i) => { if (n === max) winners.add(i); });
      }

      values.forEach((v, i) => {
        const td = document.createElement("td");
        if (row.bool) {
          td.innerHTML = v
            ? '<i class="fa-solid fa-circle-check tbl-yes"></i>'
            : '<i class="fa-solid fa-circle-xmark tbl-no"></i>';
          if (v) td.classList.add("winner");
        } else {
          td.textContent = v || "—";
          if (winners.has(i)) td.classList.add("winner");
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }


  /* ══════════════════════════════════════════
     6. DETAIL MODAL
     Opens on "View Details" button in both
     list rows and cards.
  ══════════════════════════════════════════ */

  // Attach to card View Details buttons
  document.querySelectorAll(".cmp-view-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openModal(btn.dataset.id);
    });
  });

  // Attach to list row View buttons (separate class)
  document.querySelectorAll(".clt-detail-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openModal(btn.dataset.id);
    });
  });

  // Attach to exchange names (list and card) — click to open details
  document.querySelectorAll(".clt-name").forEach(nameEl => {
    nameEl.style.cursor = "pointer";
    nameEl.addEventListener("click", e => {
      e.stopPropagation();
      const row = nameEl.closest(".cmp-list-row");
      if (row) openModal(row.dataset.id);
    });
  });

  document.querySelectorAll(".cmp-card-name").forEach(nameEl => {
    nameEl.style.cursor = "pointer";
    nameEl.addEventListener("click", e => {
      e.stopPropagation();
      const card = nameEl.closest(".cmp-card");
      if (card) openModal(card.dataset.id);
    });
  });

  function openModal(id) {
    const ex = byId[id];
    if (!ex) return;
    currentModalId = id;

    document.getElementById("mdLogo").src           = ex.logo;
    document.getElementById("mdLogoFb").textContent = ex.name[0];
    document.getElementById("mdName").textContent   = ex.name;

    // Tags
    const tagMap = {
      inr_support:      { cls: "inr",  label: "INR" },
      spot:             { cls: "spot", label: "Spot" },
      derivatives_fno:  { cls: "fno",  label: "F&O" },
      p2p:              { cls: "p2p",  label: "P2P" },
    };
    let tagsHtml = "";
    Object.entries(tagMap).forEach(([feat, t]) => {
      if (ex.features[feat])
        tagsHtml += '<span class="cmp-tag ' + t.cls + '">' + t.label + '</span>';
    });
    document.getElementById("mdTags").innerHTML = tagsHtml;

    // About tab
    document.getElementById("mdAboutLogo").src         = ex.logo;
    document.getElementById("mdAboutName").textContent = ex.name;
    document.getElementById("mdAboutDesc").textContent = ex.about.description;
    document.getElementById("mdFounded").textContent   = ex.about.founded;
    document.getElementById("mdHQ").textContent        = ex.about.headquarters;
    document.getElementById("mdFounders").textContent  = ex.about.founders;
    document.getElementById("mdRegulated").textContent = ex.about.regulated;
    document.getElementById("mdWebsite").href          = ex.referral_link || ex.about.website;

    // Stats strip
    document.getElementById("mdSpotFee").textContent   = ex.fees.spot;
    document.getElementById("mdFutFee").textContent    = ex.fees.futures;
    document.getElementById("mdLeverage").textContent  = ex.leverage;
    document.getElementById("mdUsp1").textContent      = ex.usp1;
    document.getElementById("mdUsp2").textContent      = ex.usp2;
    document.getElementById("mdCoins").textContent     = ex.currencies;

    // Assets & Earning tab
    document.getElementById("mdCoins2").textContent    = ex.currencies;
    document.getElementById("mdInrSupport").textContent= ex.features.inr_support ? "Yes ✓" : "No";
    document.getElementById("mdUsp1Detail").textContent= ex.usp1;
    document.getElementById("mdUsp2Detail").textContent= ex.usp2;
    document.getElementById("mdEarning").textContent   = ex.earning;
    document.getElementById("mdMining").textContent    = ex.mining;
    document.getElementById("mdInvestment").textContent= ex.features.investment ? "Yes ✓" : "No";

    // Trading tab
    document.getElementById("mdSpotFee2").textContent  = ex.fees.spot;
    document.getElementById("mdFutFee2").textContent   = ex.fees.futures;
    document.getElementById("mdLeverage2").textContent = ex.leverage;
    document.getElementById("mdSpot").textContent      = ex.features.spot ? "Yes ✓" : "No";
    document.getElementById("mdFno").textContent       = ex.features.derivatives_fno ? "Yes ✓" : "No";
    document.getElementById("mdP2p").textContent       = ex.features.p2p ? "Yes ✓" : "No";

    // Deposit & Withdrawal tab
    document.getElementById("mdDepLimit").textContent  = ex.deposit.limit;
    document.getElementById("mdDepCharge").textContent = ex.deposit.charges;
    document.getElementById("mdWdLimit").textContent   = ex.withdrawal.limit;
    document.getElementById("mdWdCharge").textContent  = ex.withdrawal.charges;

    syncModalAddBtn(id);
    switchModalTab("assets");
    cmpModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function syncModalAddBtn(id) {
    const mdAddBtn = document.getElementById("mdAddBtn");
    if (!mdAddBtn) return;
    const sel = selected.includes(id);
    mdAddBtn.innerHTML = sel
      ? '<i class="fa-solid fa-check"></i> Added'
      : '<i class="fa-solid fa-plus"></i> Add to Compare';
    mdAddBtn.classList.toggle("selected", sel);
  }

  const mdAddBtn = document.getElementById("mdAddBtn");
  mdAddBtn?.addEventListener("click", () => {
    if (currentModalId) toggleSelect(currentModalId);
  });

  function closeModal() {
    cmpModal.classList.add("hidden");
    document.body.style.overflow = "";
    currentModalId = null;
  }

  cmpModalClose.addEventListener("click", closeModal);
  cmpModal.addEventListener("click", e => { if (e.target === cmpModal) closeModal(); });

  document.querySelectorAll(".cmp-modal-tab").forEach(tab => {
    tab.addEventListener("click", () => switchModalTab(tab.dataset.tab));
  });

  function switchModalTab(name) {
    document.querySelectorAll(".cmp-modal-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.tab === name)
    );
    ["assets", "trading", "deposit", "about"].forEach(t => {
      const el = document.getElementById("tab-" + t);
      if (el) el.classList.toggle("hidden", t !== name);
    });
  }


  /* ══════════════════════════════════════════
     7. TOAST — shown when max exchanges reached
  ══════════════════════════════════════════ */
  function showToast(msg) {
    let t = document.getElementById("cmpToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "cmpToast";
      t.style.cssText =
        "position:fixed;bottom:110px;left:50%;transform:translateX(-50%);" +
        "background:#1e293b;color:#fff;font-size:13px;font-weight:700;" +
        "padding:10px 20px;border-radius:10px;z-index:9999;" +
        "box-shadow:0 8px 24px rgba(0,0,0,0.3);white-space:nowrap;transition:opacity 0.3s;";
      document.body.appendChild(t);
    }
    t.textContent   = msg;
    t.style.opacity = "1";
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = "0"; }, 2500);
  }


  /* ══════════════════════════════════════════
     8. KEYBOARD — Escape closes modal
  ══════════════════════════════════════════ */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !cmpModal.classList.contains("hidden")) closeModal();
  });

})();


/* ══════════════════════════════════════════
   9. EXCHANGE WATCHLIST STARS
   Handles star toggle for both list view
   and card view. Reads auth state from
   <meta name="user-logged-in"> so no
   Jinja templating needed in this file.
══════════════════════════════════════════ */

const _isLoggedIn = document.querySelector('meta[name="user-logged-in"]')?.content === "true";

/* Toggle a single exchange in/out of watchlist */
async function toggleExStar(btn) {
  if (!_isLoggedIn) {
    window.location.href = "/login";
    return;
  }

  const exId   = btn.dataset.id;
  const exName = btn.dataset.name;
  const exLogo = btn.dataset.logo;

  try {
    const res  = await fetch("/watchlist/exchange/toggle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ exchange_id: exId, exchange_name: exName, exchange_logo: exLogo })
    });
    const data = await res.json();
    if (data.ok) {
      const saved = data.saved;
      document.querySelectorAll(`.ex-star-btn[data-id="${exId}"]`).forEach(b => {
        b.classList.toggle("starred", saved);
        b.querySelector("i").className = saved ? "fa-solid fa-star" : "fa-regular fa-star";
        b.title = saved ? "Remove from watchlist" : "Add to watchlist";
      });
    }
  } catch(e) {
    console.error("Exchange watchlist error:", e);
  }
}

/* On page load — fetch saved exchanges and fill gold stars */
(async function loadSavedExStars() {
  if (!_isLoggedIn) return;
  try {
    const res  = await fetch("/api/watchlist/exchanges");
    const data = await res.json();
    if (data.ok) {
      data.exchange_ids.forEach(id => {
        document.querySelectorAll(`.ex-star-btn[data-id="${id}"]`).forEach(b => {
          b.classList.add("starred");
          b.querySelector("i").className = "fa-solid fa-star";
          b.title = "Remove from watchlist";
        });
      });
    }
  } catch(e) {}
})();


/* ═══════════════════════════════════════════════════════
   AFFILIATE DISCLOSURE TOOLTIP
   Uses position:fixed + getBoundingClientRect so it
   escapes the modal's overflow:hidden container.
═══════════════════════════════════════════════════════ */
(function initAffiliateTooltip() {
  /* The tooltip element is rendered in compare.html inside .cmp-open-acc-wrap */
  const wrap = document.querySelector('.cmp-open-acc-wrap');
  const tip  = document.querySelector('.cmp-affiliate-tip');
  if (!wrap || !tip) return;

  /* Override CSS positioning to use fixed coordinates */
  tip.style.position    = 'fixed';
  tip.style.bottom      = 'auto';
  tip.style.right       = 'auto';
  tip.style.opacity     = '0';
  tip.style.pointerEvents = 'none';
  tip.style.transition  = 'opacity 0.2s ease, transform 0.2s ease';
  tip.style.transform   = 'translateY(4px)';

  wrap.addEventListener('mouseenter', function () {
    const rect   = wrap.getBoundingClientRect();
    const tipW   = 260;
    /* Place above the button, aligned to its right edge */
    let left = rect.right - tipW;
    if (left < 8) left = 8;
    tip.style.left      = left + 'px';
    tip.style.top       = (rect.top - tip.offsetHeight - 10) + 'px';
    tip.style.opacity   = '1';
    tip.style.transform = 'translateY(0)';
    tip.style.pointerEvents = 'auto';
  });

  wrap.addEventListener('mouseleave', function () {
    tip.style.opacity       = '0';
    tip.style.transform     = 'translateY(4px)';
    tip.style.pointerEvents = 'none';
  });
})();


/* ═══════════════════════════════════════════════════════
   FILTER CHIP TOOLTIPS
   Reads data-tooltip attribute from each chip and shows
   a floating tooltip below on hover.
═══════════════════════════════════════════════════════ */
(function initFilterTooltips() {
  const chips = document.querySelectorAll('.cmp-filter-chip[data-tooltip]');
  if (!chips.length) return;

  /* Single shared tooltip element */
  const tip = document.createElement('div');
  tip.id = 'filterTip';
  Object.assign(tip.style, {
    position:      'fixed',
    background:    '#0F172A',
    color:         '#E2E8F0',
    fontSize:      '12px',
    fontWeight:    '500',
    lineHeight:    '1.55',
    padding:       '9px 13px',
    borderRadius:  '8px',
    width:         '240px',
    whiteSpace:    'normal',
    zIndex:        '99999',
    boxShadow:     '0 4px 16px rgba(0,0,0,0.18)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.15s ease',
    fontFamily:    '"DM Sans", sans-serif',
  });
  document.body.appendChild(tip);

  chips.forEach(function (chip) {
    chip.addEventListener('mouseenter', function () {
      tip.textContent  = chip.dataset.tooltip;
      const rect       = chip.getBoundingClientRect();
      let left = rect.left;
      /* Keep tooltip within viewport */
      if (left + 240 > window.innerWidth - 8) {
        left = window.innerWidth - 248;
      }
      tip.style.left    = left + 'px';
      tip.style.top     = (rect.bottom + 8) + 'px';
      tip.style.opacity = '1';
    });

    chip.addEventListener('mouseleave', function () {
      tip.style.opacity = '0';
    });
  });
})();


/* ═══════════════════════════════════════════════════════
   STAR BURST ANIMATION
═══════════════════════════════════════════════════════ */
function burstStar(btn) {
  btn.classList.remove('burst');
  void btn.offsetWidth; /* force reflow */
  btn.classList.add('burst');
  setTimeout(function () { btn.classList.remove('burst'); }, 500);
}