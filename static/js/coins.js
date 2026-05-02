/* =====================================================
   COINS.JS — Infinite Scroll for /coins page
   CoinScanner · Agreed Financial Tech Pvt. Ltd.

   Works with the existing server-rendered table/card view.
   The first N coins are rendered by Jinja (server-side).
   This script loads subsequent pages via /api/coins on scroll.

   Architecture:
     - IntersectionObserver watches #coinsSentinel
     - When sentinel enters viewport → fetch next page
     - Append rows (table view) or cards (card view) to existing list
     - Stop when API returns has_more: false
   ===================================================== */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────
    const PER_PAGE     = 25;
    const SENTINEL_ID  = 'coinsSentinel';
    const SPINNER_ID   = 'coinsSpinner';
    const ALL_DONE_ID  = 'coinsAllLoaded';

    // ── State ────────────────────────────────────────────
    // Page 1 is already rendered by server. Start fetching from page 2.
    // We track how many coins the server already rendered.
    let currentPage    = 1;
    let isLoading      = false;
    let allLoaded      = false;

    // ── Detect active view (table or card) ───────────────
    function getActiveView() {
        const url = new URL(window.location.href);
        return url.searchParams.get('view') === 'card' ? 'card' : 'table';
    }

    // ── Detect active currency ───────────────────────────
    function getActiveCurrency() {
        try {
            return localStorage.getItem('cs_currency') || 'inr';
        } catch (e) {
            return 'inr';
        }
    }

    // ── Find the container to append rows/cards into ─────
    function getContainer(view) {
        if (view === 'card') {
            // Card view: coins render inside a grid/flex container
            return document.querySelector('.coins-card-grid')
                || document.querySelector('.coins-grid')
                || document.querySelector('.movers-list.active');
        } else {
            // Table view: rows go inside the <tbody> of the main coins table
            return document.querySelector('.coins-table tbody')
                || document.querySelector('.coins-table-body')
                || document.querySelector('.coin-table-body');
        }
    }

    // ── Format helpers (mirrors Python format_inr logic) ─
    function fmtPrice(val, currency) {
        if (!val || isNaN(val)) return '—';
        const sym = currency === 'usd' ? '$' : '₹';
        if (val < 0.01)  return sym + val.toFixed(6);
        if (val < 1)     return sym + val.toFixed(4);
        return sym + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }

    function fmtMcap(val) {
        if (!val) return '—';
        const cr = val / 1e7;
        if (cr >= 1e5)  return '₹' + (cr / 1e5).toFixed(2) + ' L Cr';
        if (cr >= 1000) return '₹' + Number(cr.toFixed(0)).toLocaleString('en-IN') + ' Cr';
        return '₹' + cr.toFixed(1) + ' Cr';
    }

    function fmtChg(val) {
        if (val === null || val === undefined) return '—';
        const up  = val >= 0;
        const abs = Math.abs(val).toFixed(2);
        return `<span class="ct-pill ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${abs}%</span>`;
    }

    // ── Build a table row from API coin data ──────────────
    function buildTableRow(coin) {
        const currency  = getActiveCurrency();
        const price     = fmtPrice(coin.current_price, currency);
        const mcap      = fmtMcap(coin.market_cap);
        const chg24     = fmtChg(coin.price_change_percentage_24h);
        const chg7d     = fmtChg(coin.price_change_percentage_7d);
        const sparkId   = 'spark-' + coin.id;
        const sparkData = JSON.stringify(coin.sparkline || []);

        return `
<div class="ct-row coin-row"
    data-id="${coin.id}"
    data-name="${coin.name}"
    data-symbol="${coin.symbol}"
    data-image="${coin.image || ''}"
    data-price-inr="${coin.current_price || 0}"
    data-volume="${coin.total_volume || 0}"
    data-change="${coin.price_change_percentage_24h || 0}"
    data-marketcap="${coin.market_cap || 0}"
    data-rank="${coin.market_cap_rank || 0}"
    data-high="${coin.high_24h || 0}"
    data-low="${coin.low_24h || 0}"
    data-ath="${coin.ath || 0}"
    data-supply="${coin.circulating_supply || 0}"
    data-sparkline='${sparkData}'>

    <div class="ct-rank">${coin.market_cap_rank || '—'}</div>

    <div class="ct-coin">
        <img src="${coin.image || ''}" alt="${coin.name}"
             class="ct-logo"
             onerror="this.style.display='none'">
        <div>
            <div class="ct-name">
                ${coin.name}
                <button class="coin-star-btn"
                        data-id="${coin.id}"
                        data-name="${coin.name}"
                        data-symbol="${coin.symbol}"
                        data-image="${coin.image || ''}"
                        onclick="event.stopPropagation(); toggleCoinStar(this)"
                        title="Add to watchlist">
                    <i class="fa-regular fa-star"></i>
                </button>
            </div>
            <span class="ct-sym">${coin.symbol ? coin.symbol.toUpperCase() : ''}</span>
        </div>
    </div>

    <div class="ct-price price-cell">${price}</div>
    <div class="ct-chg">${chg24}</div>
    <div class="ct-chg ct-chg-7d">${chg7d}</div>
    <div class="ct-mcap">${mcap}</div>
    <div class="ct-spark" id="${sparkId}"></div>
</div>`;
    }

    // ── Build a card from API coin data ──────────────────
    function buildCard(coin) {
        const currency = getActiveCurrency();
        const price    = fmtPrice(coin.current_price, currency);
        const chg      = coin.price_change_percentage_24h || 0;
        const up       = chg >= 0;
        const chgAbs   = Math.abs(chg).toFixed(2);
        const sym      = (coin.symbol || '').toUpperCase();

        return `
<div class="mover-card coin-card ${up ? 'gain-card' : 'lose-card'}"
    data-id="${coin.id}"
    data-name="${coin.name}"
    data-symbol="${coin.symbol}"
    data-image="${coin.image || ''}"
    data-price-inr="${coin.current_price || 0}"
    data-volume="${coin.total_volume || 0}"
    data-change="${chg}"
    data-marketcap="${coin.market_cap || 0}"
    data-rank="${coin.market_cap_rank || 0}"
    data-high="${coin.high_24h || 0}"
    data-low="${coin.low_24h || 0}"
    data-ath="${coin.ath || 0}"
    data-supply="${coin.circulating_supply || 0}">
    <div class="mover-card-top">
        <span class="mover-badge ${up ? 'gain-badge' : 'lose-badge'}">
            ${up ? '▲' : '▼'} ${chgAbs}%
        </span>
        <button class="mover-star-btn"
                data-id="${coin.id}"
                data-name="${coin.name}"
                data-symbol="${coin.symbol}"
                data-image="${coin.image || ''}"
                onclick="event.stopPropagation(); toggleCoinStar(this)"
                title="Add to watchlist">
            <i class="fa-regular fa-star"></i>
        </button>
    </div>
    <div class="mover-identity">
        <img src="${coin.image || ''}" alt="${coin.name}" class="mover-logo"
             onerror="this.style.display='none'">
        <div class="mover-name-wrap">
            <span class="mover-name">${coin.name}</span>
            <span class="mover-symbol">${sym} · #${coin.market_cap_rank || '—'}</span>
        </div>
    </div>
    <div class="mover-price price-cell">${price}</div>
</div>`;
    }

    // ── Draw sparklines for newly added rows ─────────────
    function drawNewSparklines(rows) {
        // Re-use the global drawSparkline function from coin.js if available
        if (typeof window.drawSparkline !== 'function') return;
        rows.forEach(function (row) {
            const sparkEl = row.querySelector('.ct-spark');
            if (!sparkEl) return;
            try {
                const prices = JSON.parse(row.dataset.sparkline || '[]');
                if (prices.length) window.drawSparkline(sparkEl.id, prices);
            } catch (e) { /* skip */ }
        });
    }

    // ── Re-attach coin-row click handlers for new rows ───
    function reattachClickHandlers(rows) {
        // main.js / coin.js wires .coin-row / .coin-card clicks via delegation on document
        // So new rows are automatically handled — no extra wiring needed.
        // However, re-run star state so saved coins show filled stars
        if (typeof window.loadSavedCoinStars === 'function') {
            window.loadSavedCoinStars();
        }
    }

    // ── Fetch next page from /api/coins ──────────────────
    function loadNextPage() {
        if (isLoading || allLoaded) return;

        const view      = getActiveView();
        const container = getContainer(view);
        if (!container) return;

        const sentinel = document.getElementById(SENTINEL_ID);
        const spinner  = document.getElementById(SPINNER_ID);
        const allDone  = document.getElementById(ALL_DONE_ID);

        isLoading = true;
        if (spinner) spinner.style.display = 'block';

        const nextPage = currentPage + 1;
        const currency = getActiveCurrency();
        const url      = `/api/coins?page=${nextPage}&per_page=${PER_PAGE}&currency=${currency}`;

        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('API error ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data.coins || data.coins.length === 0) {
                    allLoaded = true;
                } else {
                    currentPage = data.page;

                    // Build and insert HTML
                    const fragment = document.createDocumentFragment();
                    const tempWrap = document.createElement('div');

                    if (view === 'table') {
                        data.coins.forEach(function (coin) {
                            tempWrap.innerHTML = buildTableRow(coin);
                            fragment.appendChild(tempWrap.firstElementChild);
                        });
                    } else {
                        data.coins.forEach(function (coin) {
                            tempWrap.innerHTML = buildCard(coin);
                            fragment.appendChild(tempWrap.firstElementChild);
                        });
                    }

                    const newRows = Array.from(fragment.children);
                    container.appendChild(fragment);

                    // Post-render: sparklines + star states
                    requestAnimationFrame(function () {
                        drawNewSparklines(newRows);
                        reattachClickHandlers(newRows);
                    });

                    if (!data.has_more) allLoaded = true;
                }

                if (allLoaded) {
                    if (sentinel) sentinel.style.display = 'none';
                    if (allDone)  allDone.style.display  = 'block';
                }
            })
            .catch(function (err) {
                console.warn('CoinScanner: infinite scroll fetch failed —', err);
            })
            .finally(function () {
                isLoading = false;
                if (spinner) spinner.style.display = 'none';
            });
    }

    // ── IntersectionObserver setup ───────────────────────
    function initInfiniteScroll() {
        const sentinel = document.getElementById(SENTINEL_ID);
        if (!sentinel) return;

        // Calculate how many coins were already rendered by server
        const view      = getActiveView();
        const container = getContainer(view);
        if (container) {
            const renderedCount = container.querySelectorAll(
                view === 'table' ? '.ct-row' : '.mover-card, .coin-card'
            ).length;
            // If server rendered less than PER_PAGE, we're already fully loaded
            if (renderedCount < PER_PAGE) {
                allLoaded = true;
                sentinel.style.display = 'none';
                const allDone = document.getElementById(ALL_DONE_ID);
                if (allDone) allDone.style.display = 'block';
                return;
            }
            // currentPage = how many full pages are rendered
            currentPage = Math.floor(renderedCount / PER_PAGE);
        }

        const observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) loadNextPage();
                });
            },
            { rootMargin: '200px' }  // trigger 200px before sentinel is visible
        );

        observer.observe(sentinel);
    }

    // ── Init ─────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInfiniteScroll);
    } else {
        initInfiniteScroll();
    }

})();
