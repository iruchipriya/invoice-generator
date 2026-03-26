/**
 * ads.js — Monetization layer for Invoice Generator
 *
 * Features:
 *  ① Show / hide ads (premium toggle, persisted)
 *  ② Lazy-load via IntersectionObserver (performance)
 *  ③ Sticky bottom bar ad (highest mobile CTR)
 *  ④ Post-download ad reveal (highest intent moment)
 *  ⑤ A/B testing framework — 3 variants, auto-assigned
 *  ⑥ CTR tracking per slot (impressions + clicks)
 *  ⑦ Analytics stubs (wire up GA4 to activate)
 *
 * Completely isolated from invoice logic (script.js).
 * Public API exposed on window: onInvoiceDownload(), adStats()
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const CFG = {
  adPrefKey:        'inv_ads_enabled',
  abVariantKey:     'inv_ab_variant',
  statsKey:         'inv_ad_stats',
  stickyDismissKey: 'inv_sticky_dismissed', // sessionStorage — resets each tab

  // Post-download panel auto-closes after this many ms
  postDownloadTimeout: 9000,

  // A/B variant distribution (must sum to 1)
  abDistribution: { A: 0.40, B: 0.40, C: 0.20 },
};

/*
  ┌─────────────────────────────────────────────────────────┐
  │  A/B VARIANT REFERENCE                                  │
  │                                                         │
  │  Variant A — Control (40%)                              │
  │    Top banner ON  · Sticky OFF · Post-download OFF      │
  │    Best for: desktop, low-distraction, high viewability │
  │                                                         │
  │  Variant B — Sticky (40%)                               │
  │    Top banner OFF · Sticky ON  · Post-download ON       │
  │    Best for: mobile, scrolling users, intent moments    │
  │                                                         │
  │  Variant C — Combined (20%)                             │
  │    Top banner ON  · Sticky ON  · Post-download ON       │
  │    Best for: measuring additive lift of sticky          │
  │                                                         │
  │  Slots always shown in all variants:                    │
  │    In-form (B) · Below-preview (C) · Footer (D)         │
  └─────────────────────────────────────────────────────────┘
*/

const VARIANT_CONFIG = {
  A: { topBanner: true,  sticky: false, postDownload: false },
  B: { topBanner: false, sticky: true,  postDownload: true  },
  C: { topBanner: true,  sticky: true,  postDownload: true  },
};

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

let adsEnabled  = true;
let abVariant   = 'A';        // assigned on first load
let stats       = {};         // { slotId: { impressions, clicks } }
let postDownloadTimer = null;

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', initAds);

function initAds() {
  loadStats();
  loadAdPreference();
  assignABVariant();
  applyAdState(false);
  applyABVariant();
  setupAdToggle();
  setupLazyLoad();
  setupCTRTracking();
  setupStickyDismiss();
  setupPostDownloadClose();
  setupKeyboardShortcut();   // Ctrl+Shift+A → print stats
  trackPageView();
  collapseEmptyInFormAd();
}

/** Mark ad slots as filled when AdSense loads, collapse empty ones */
function collapseEmptyInFormAd() {
  // Check all ad slots after 3 seconds — if no ad filled, keep collapsed
  setTimeout(() => {
    document.querySelectorAll('.ad-slot').forEach(slot => {
      const ins = slot.querySelector('.adsbygoogle');
      if (ins && ins.getAttribute('data-ad-status') === 'filled') {
        slot.classList.add('ad-filled');
      } else {
        slot.style.display = 'none';
      }
    });
  }, 3000);
}

// ═══════════════════════════════════════════════════════════
// AD PREFERENCE (show / hide toggle)
// ═══════════════════════════════════════════════════════════

function loadAdPreference() {
  const stored = localStorage.getItem(CFG.adPrefKey);
  adsEnabled = stored === null ? true : stored === '1';
}

function toggleAds() {
  adsEnabled = !adsEnabled;
  localStorage.setItem(CFG.adPrefKey, adsEnabled ? '1' : '0');
  applyAdState(true);
}

function setupAdToggle() {
  const btn = document.getElementById('adToggleBtn');
  if (btn) btn.addEventListener('click', toggleAds);
}

function applyAdState(animate = true) {
  document.body.classList.toggle('ads-hidden', !adsEnabled);

  const label = document.getElementById('adToggleLabel');
  const icon  = document.getElementById('adToggleIcon');
  if (label) label.textContent = adsEnabled ? 'Hide Ads' : 'Show Ads';
  if (icon)  icon.style.opacity = adsEnabled ? '1' : '0.5';

  const delay = animate ? 300 : 0;
  setTimeout(updateTopBannerOffset, delay);

  // Also hide/show sticky bar
  const sticky = document.getElementById('adStickyBottom');
  if (sticky) {
    sticky.style.display = adsEnabled ? '' : 'none';
    updateStickyBodyPadding();
  }
}

// ═══════════════════════════════════════════════════════════
// A/B TESTING
// ═══════════════════════════════════════════════════════════

function assignABVariant() {
  let stored = localStorage.getItem(CFG.abVariantKey);

  if (!stored || !VARIANT_CONFIG[stored]) {
    // Weighted random assignment
    const r = Math.random();
    const { A, B } = CFG.abDistribution;
    stored = r < A ? 'A' : r < A + B ? 'B' : 'C';
    localStorage.setItem(CFG.abVariantKey, stored);
  }

  abVariant = stored;
  // Stamp on body so CSS can also react if needed
  document.body.dataset.abVariant = abVariant;
}

function applyABVariant() {
  const cfg = VARIANT_CONFIG[abVariant];

  // Top banner
  const topSlot = document.getElementById('adSlotTop');
  if (topSlot) topSlot.style.display = cfg.topBanner ? '' : 'none';

  // Sticky bottom
  const sticky = document.getElementById('adStickyBottom');
  if (sticky) {
    const dismissed = sessionStorage.getItem(CFG.stickyDismissKey);
    sticky.style.display = (cfg.sticky && !dismissed) ? '' : 'none';
    updateStickyBodyPadding();
  }

  updateTopBannerOffset();
  trackEvent('ab_variant_assigned', { variant: abVariant });
}

// ═══════════════════════════════════════════════════════════
// STICKY BOTTOM BAR
// ═══════════════════════════════════════════════════════════

function setupStickyDismiss() {
  const btn = document.getElementById('stickyCloseBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const sticky = document.getElementById('adStickyBottom');
    if (!sticky) return;

    // Animate out
    sticky.style.transform = 'translateY(100%)';
    sticky.style.opacity   = '0';

    setTimeout(() => {
      sticky.style.display = 'none';
      updateStickyBodyPadding();
    }, 300);

    // Remember dismissal for this browser session (reappears on new tab/session)
    sessionStorage.setItem(CFG.stickyDismissKey, '1');
    trackEvent('sticky_ad_dismissed', { variant: abVariant });
  });
}

/** Adds / removes body bottom padding so sticky bar doesn't cover content */
function updateStickyBodyPadding() {
  const sticky = document.getElementById('adStickyBottom');
  const isVisible = sticky &&
    sticky.style.display !== 'none' &&
    adsEnabled &&
    VARIANT_CONFIG[abVariant].sticky;

  document.body.style.paddingBottom = isVisible
    ? (sticky.offsetHeight + 4) + 'px'
    : '';
}

// ═══════════════════════════════════════════════════════════
// POST-DOWNLOAD AD REVEAL
// ═══════════════════════════════════════════════════════════

/**
 * Called by script.js after the user triggers a PDF download.
 * Exposed globally as window.onInvoiceDownload().
 *
 * Only fires if the user's A/B variant includes post-download ads
 * and ads are currently enabled.
 */
function onInvoiceDownload() {
  trackEvent('invoice_downloaded', { variant: abVariant });

  if (!adsEnabled || !VARIANT_CONFIG[abVariant].postDownload) return;

  showPostDownloadPanel();
}

function showPostDownloadPanel() {
  const panel = document.getElementById('adPostDownload');
  if (!panel) return;

  // Reset progress bar
  const bar = panel.querySelector('.pd-progress-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    // Force reflow so the reset takes before we animate
    void bar.offsetWidth;
    bar.style.transition = `width ${CFG.postDownloadTimeout}ms linear`;
    bar.style.width = '0%';
  }

  // Show panel with slide-up animation
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('pd-visible'));

  // Activate the ad inside
  activateAdSlot(panel);

  // Auto-close timer
  clearTimeout(postDownloadTimer);
  postDownloadTimer = setTimeout(() => closePostDownloadPanel(), CFG.postDownloadTimeout);

  trackImpression('adPostDownload');
}

function setupPostDownloadClose() {
  const btn = document.getElementById('pdCloseBtn');
  if (btn) btn.addEventListener('click', closePostDownloadPanel);
}

function closePostDownloadPanel() {
  const panel = document.getElementById('adPostDownload');
  if (!panel) return;

  panel.classList.remove('pd-visible');
  setTimeout(() => panel.classList.add('hidden'), 350);
  clearTimeout(postDownloadTimer);
}

// ═══════════════════════════════════════════════════════════
// LAZY LOADING
// ═══════════════════════════════════════════════════════════

function setupLazyLoad() {
  const slots = document.querySelectorAll('.ad-slot, #adStickyBottom');

  if (!('IntersectionObserver' in window)) {
    slots.forEach(activateAdSlot);
    return;
  }

  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        activateAdSlot(e.target);
        observer.unobserve(e.target);
      }
    }),
    { rootMargin: '150px' }
  );

  slots.forEach(s => observer.observe(s));
}

function activateAdSlot(slot) {
  if (!slot || slot.dataset.activated) return;
  slot.dataset.activated = 'true';
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// CTR TRACKING
// ═══════════════════════════════════════════════════════════

/**
 * Attaches impression + click tracking to every ad slot.
 *
 * Impressions:  counted via IntersectionObserver (50% visible threshold)
 * Clicks:       counted via click listener on the slot container
 *
 * Data stored in localStorage as inv_ad_stats.
 * View live stats: Ctrl+Shift+A (or call window.adStats() in console)
 */
function setupCTRTracking() {
  if (!('IntersectionObserver' in window)) return;

  const impressionObserver = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        trackImpression(e.target.id);
        impressionObserver.unobserve(e.target); // count once per page load
      }
    }),
    { threshold: 0.5 } // 50% of ad must be visible
  );

  document.querySelectorAll('.ad-slot, #adStickyBottom, #adPostDownload').forEach(slot => {
    if (slot.id) {
      impressionObserver.observe(slot);
      // Click tracking — fires on any click within the slot container
      slot.addEventListener('click', () => trackClick(slot.id), true);
    }
  });
}

function trackImpression(slotId) {
  if (!slotId) return;
  if (!stats[slotId]) stats[slotId] = { impressions: 0, clicks: 0 };
  stats[slotId].impressions++;
  saveStats();
}

function trackClick(slotId) {
  if (!slotId) return;
  if (!stats[slotId]) stats[slotId] = { impressions: 0, clicks: 0 };
  stats[slotId].clicks++;
  saveStats();
  trackEvent('ad_click', { slot: slotId, variant: abVariant });
}

function loadStats() {
  try {
    stats = JSON.parse(localStorage.getItem(CFG.statsKey)) || {};
  } catch (_) {
    stats = {};
  }
}

function saveStats() {
  try { localStorage.setItem(CFG.statsKey, JSON.stringify(stats)); } catch (_) {}
}

/** Returns a formatted CTR report — call window.adStats() from the console */
function adStats() {
  const rows = Object.entries(stats).map(([slot, { impressions, clicks }]) => ({
    slot,
    variant:     abVariant,
    impressions,
    clicks,
    'CTR (%)':   impressions ? ((clicks / impressions) * 100).toFixed(2) : '0.00',
  }));
  if (rows.length) {
    console.group('📊 Ad CTR Report');
    console.table(rows);
    console.log('A/B Variant:', abVariant);
    console.groupEnd();
  } else {
    console.log('No ad stats recorded yet.');
  }
  return rows;
}

function setupKeyboardShortcut() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      adStats();
    }
  });
}

// ═══════════════════════════════════════════════════════════
// TOP BANNER HEIGHT COMPENSATION
// ═══════════════════════════════════════════════════════════

function updateTopBannerOffset() {
  const banner = document.getElementById('adSlotTop');
  const visible = adsEnabled &&
                  banner &&
                  banner.style.display !== 'none' &&
                  VARIANT_CONFIG[abVariant].topBanner;
  const h = visible ? banner.offsetHeight : 0;
  document.documentElement.style.setProperty('--ad-top-h', h + 'px');
}

// ═══════════════════════════════════════════════════════════
// ANALYTICS STUBS
// ═══════════════════════════════════════════════════════════
// Wire these up by uncommenting the GA4 <script> tags in index.html
// and replacing G-XXXXXXXXXX with your real Measurement ID.

function trackPageView() {
  if (typeof gtag === 'function') {
    gtag('event', 'page_view', { page_title: 'Invoice Generator' });
  }
}

function trackEvent(eventName, params = {}) {
  const enriched = { ...params, ab_variant: abVariant };

  // Delegate to analytics.js if loaded — sends to GA4 + Clarity + Hotjar
  if (typeof window.analytics?.track === 'function') {
    window.analytics.track(eventName, enriched);
    return;
  }

  // Fallback: call gtag directly if analytics.js is not present
  if (typeof gtag === 'function') {
    gtag('event', eventName, enriched);
  }
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API  (called from script.js or browser console)
// ═══════════════════════════════════════════════════════════

window.onInvoiceDownload = onInvoiceDownload;  // hook for script.js
window.adStats           = adStats;            // developer console helper
window.trackEvent        = trackEvent;         // shared with script.js

// ─── Dev hint ────────────────────────────────────────────
// Open the browser console and run:
//   adStats()             → see per-slot CTR table
//   adStats()[0].variant  → see which A/B group this user is in
// Or press Ctrl+Shift+A anywhere on the page.
