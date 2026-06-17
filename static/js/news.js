/**
 * news.js — CoinScanner News Page
 * ==================================
 * All JavaScript for the /news page.
 *
 * SECTIONS:
 *   1. News Search       — filter cards as user types
 *   2. Keyboard Shortcut — Cmd/Ctrl+K to focus search
 *   3. News Modal        — click a card to open article preview
 *
 * NOTE ON FIELD NAMES (newsdata.io format):
 *   - article.title       → headline
 *   - article.description → short summary
 *   - article.content     → full article text (often truncated by API)
 *   - article.image_url   → thumbnail image URL
 *   - article.link        → URL to original article
 *   - article.pubDate     → publish date string e.g. "2026-04-01 12:00:00"
 *   - article.source_id   → source name e.g. "coindesk"
 *
 * These are passed as data-* attributes on .news-modal-trigger elements.
 *
 * Loaded only on news.html via:
 *   {% block extra_js %}
 *     <script src="{{ url_for('static', filename='js/news.js') }}"></script>
 *   {% endblock %}
 */

document.addEventListener("DOMContentLoaded", function () {

  /* ══════════════════════════════════════════════════════
     1. NEWS SEARCH
     Filters .news-card-premium elements as the user types.
     Shows/hides an "empty state" message when no results match.

     Each news card must have visible text content for this to work.
     (Searching is done against the card's full textContent.)
  ══════════════════════════════════════════════════════ */
  const searchInput = document.getElementById("newsSearch");
  const emptyState  = document.getElementById("newsEmpty");

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      const query   = this.value.toLowerCase().trim();
      const cards   = document.querySelectorAll(".news-card-premium");
      let   visible = 0;

      cards.forEach(function (card) {
        const text    = card.textContent.toLowerCase();
        const matches = !query || text.includes(query);
        card.style.display = matches ? "" : "none";
        if (matches) visible++;
      });

      // Show empty state when no cards match the search
      if (emptyState) {
        emptyState.style.display = (visible === 0 && query) ? "flex" : "none";
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     2. KEYBOARD SHORTCUT — Cmd/Ctrl + K focuses search
     Standard shortcut users expect on news/search pages.
  ══════════════════════════════════════════════════════ */
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();   // prevent browser's default address bar focus
      if (searchInput) searchInput.focus();
    }
    // Escape closes modal (handled below too)
    if (e.key === "Escape") closeNewsModal();
  });


  /* ══════════════════════════════════════════════════════
     3. NEWS MODAL
     Clicking a .news-modal-trigger element opens a
     bottom-sheet-style modal with the article preview.

     The article data is passed via data-* attributes
     on the trigger element (set in news.html template).

     Data attributes used:
       data-title    — article headline
       data-desc     — short description
       data-content  — article content snippet
       data-author   — author name (optional)
       data-source   — source name (e.g. "coindesk")
       data-date     — publish date string
       data-url      — link to full article
       data-image    — thumbnail image URL
  ══════════════════════════════════════════════════════ */
  const modal          = document.getElementById("newsModal");
  const modalImage     = document.getElementById("nmodalImage");
  const modalImageWrap = document.getElementById("nmodalImageWrap");
  const modalNoImage   = document.getElementById("nmodalNoImageHeader");
  const modalClose     = document.getElementById("nmodalClose");
  const modalClose2    = document.getElementById("nmodalClose2");
  const modalSource    = document.getElementById("nmodalSource");
  const modalDate      = document.getElementById("nmodalDate");
  const modalTitle     = document.getElementById("nmodalTitle");
  const modalDesc      = document.getElementById("nmodalDesc");
  const modalReadBtn   = document.getElementById("nmodalReadBtn");
  const modalAuthorRow = document.getElementById("nmodalAuthorRow");
  const modalAuthor    = document.getElementById("nmodalAuthor");
  const modalContentBlock = document.getElementById("nmodalContentBlock");
  const modalContentEl = document.getElementById("nmodalContent");
  const modalReadHint  = document.getElementById("nmodalReadHint");

  if (!modal) return;   // modal not in DOM, nothing to do


  /**
   * Format a newsdata.io date string for display.
   * Input: "2026-04-01 12:30:00" or ISO string
   * Output: "1 April 2026, 12:30 PM"
   *
   * @param {string} raw - raw date string from API
   * @returns {string} - formatted date or empty string
   */
  function formatNewsDate(raw) {
    if (!raw) return "";
    try {
      // newsdata.io uses "YYYY-MM-DD HH:MM:SS" — replace space with T for valid ISO
      const d = new Date(raw.replace(" ", "T"));
      return d.toLocaleDateString("en-IN", {
        day:    "numeric",
        month:  "long",
        year:   "numeric",
        hour:   "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return raw.slice(0, 10);   // fallback: just show the date part
    }
  }


  /**
   * Open the news modal with data from a trigger element.
   * @param {HTMLElement} el - the .news-modal-trigger element clicked
   */
  function openNewsModal(el) {
    const title   = el.dataset.title   || "";
    const desc    = el.dataset.desc    || "";
    const content = el.dataset.content || "";
    const author  = el.dataset.author  || "";
    const source  = el.dataset.source  || "";
    const date    = el.dataset.date    || "";
    const url     = el.dataset.url     || "#";
    const image   = el.dataset.image   || "";

    // Fill in modal text fields
    if (modalTitle)  modalTitle.textContent  = title;
    if (modalDesc)   modalDesc.textContent   = desc || "No description available.";
    if (modalSource) modalSource.textContent = source;
    if (modalDate)   modalDate.textContent   = formatNewsDate(date);
    if (modalReadBtn) modalReadBtn.href       = url;

    // Show/hide author row
    if (modalAuthorRow && modalAuthor) {
      if (author) {
        modalAuthor.textContent    = "By " + author;
        modalAuthorRow.style.display = "flex";
      } else {
        modalAuthorRow.style.display = "none";
      }
    }

    // Show content snippet if available and meaningful
    if (modalContentBlock && modalContentEl) {
      if (content && content.length > 20) {
        modalContentEl.textContent      = content;
        modalContentBlock.style.display = "block";
      } else {
        modalContentBlock.style.display = "none";
      }
    }

    // Show "Read full article on source" hint
    if (modalReadHint) modalReadHint.style.display = "flex";

    // Handle image — show it if available, hide and show fallback header if not
    if (modalImageWrap && modalNoImage) {
      if (image) {
        if (modalImage) {
          modalImage.src = image;
          // If image fails to load, switch to no-image header
          modalImage.onerror = function () {
            modalImageWrap.classList.add("hidden");
            modalNoImage.classList.remove("hidden");
          };
        }
        modalImageWrap.classList.remove("hidden");
        modalNoImage.classList.add("hidden");
      } else {
        modalImageWrap.classList.add("hidden");
        modalNoImage.classList.remove("hidden");
      }
    }

    // Show modal and lock background scroll
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }


  /** Close the news modal and restore scroll. */
  function closeNewsModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }


  // Attach open listener to all trigger elements
  document.querySelectorAll(".news-modal-trigger").forEach(function (el) {
    el.addEventListener("click", function () {
      openNewsModal(this);
    });
  });

  // Prevent direct-read anchors inside cards from triggering the modal click
  document.querySelectorAll("a.card-cta, a.meta-read").forEach(function (a) {
    a.addEventListener("click", function (e) {
      // Stop the click from bubbling to the parent .news-modal-trigger
      e.stopPropagation();
      // Let the anchor navigate normally (opens in new tab because of target="_blank")
    });
  });

  // Close buttons inside the modal
  if (modalClose)  modalClose.addEventListener("click",  closeNewsModal);
  if (modalClose2) modalClose2.addEventListener("click", closeNewsModal);

  // Close when clicking the dark backdrop (outside the modal box)
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeNewsModal();
  });

}); // end DOMContentLoaded
