/**
 * analytics.js — Unified Analytics Layer for Invoice Generator
 *
 * Features:
 *  ① Google Analytics 4 (GA4) — dynamically loaded, async, non-blocking
 *  ② Reusable track() — dispatches to GA4 + Clarity + Hotjar in one call
 *  ③ Session duration — measured from page load, sent on tab close
 *  ④ Device detection — mobile / tablet / desktop, attached to every event
 *  ⑤ Session usage counters — items added, invoices downloaded, etc.
 *  ⑥ Debug mode — set ANALYTICS_CFG.debug = false to silence in production
 *  ⑦ Microsoft Clarity & Hotjar stubs — uncomment one block to activate
 *  ⑧ Shortcut: Ctrl+Shift+S → print full session report to console
 *
 * ── SETUP ─────────────────────────────────────────────────────────────────
 *  1. Replace 'G-XXXXXXXXXX' in ANALYTICS_CFG.measurementId (line ~35).
 *     Get your ID: https://analytics.google.com
 *     Path: Admin → Data Streams → your web stream → Measurement ID
 *  2. (Optional) Uncomment ONE of the Clarity / Hotjar blocks below.
 *  3. Set ANALYTICS_CFG.debug = false before deploying to production.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Completely isolated from invoice logic (script.js / ads.js).
 * Public API exposed on window: window.analytics
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const ANALYTICS_CFG = {
  /**
   * ► REPLACE THIS with your real GA4 Measurement ID.
   *   Get it from: https://analytics.google.com
   *   Path: Admin → Data Streams → your web stream → Measurement ID
   *   Format: G-XXXXXXXXXX
   *   Leave as 'G-XXXXXXXXXX' to keep tracking disabled until ready.
   */
  measurementId: 'G-XXXXXXXXXX',

  /**
   * Debug mode:
   *   true  → console.log every tracked event (use during development)
   *   false → completely silent (set to false before going live)
   */
  debug: true,

  /** sessionStorage key — usage counters reset when the browser tab closes */
  sessionKey: 'inv_analytics_session',
};

// ═══════════════════════════════════════════════════════════
// OPTIONAL: THIRD-PARTY INTEGRATIONS
// ═══════════════════════════════════════════════════════════
// Uncomment ONE of the blocks below to activate the tool.
// They load asynchronously and will not block the page.

/* ── Microsoft Clarity ────────────────────────────────────────────────────
   Records full session replays + heatmaps automatically. The custom tags
   added by track() make individual events searchable in the Clarity portal.

   1. Sign up at https://clarity.microsoft.com
   2. Create a project and copy the Project ID shown in the setup snippet.
   3. Replace YOUR_CLARITY_PROJECT_ID below, then remove the comment markers.

(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,'clarity','script','YOUR_CLARITY_PROJECT_ID');
*/

/* ── Hotjar ───────────────────────────────────────────────────────────────
   Records heatmaps, session recordings, and user surveys.

   1. Sign up at https://www.hotjar.com
   2. Create a site to get your Hotjar Site ID (HJID) and Script Version (HJSV).
      Both are shown in the tracking code snippet on the Hotjar dashboard.
   3. Replace HOTJAR_SITE_ID and HOTJAR_SCRIPT_VERSION below, then uncomment.

(function(h,o,t,j,a,r){
  h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
  h._hjSettings={hjid:HOTJAR_SITE_ID,hjsv:HOTJAR_SCRIPT_VERSION};
  a=o.getElementsByTagName('head')[0];
  r=o.createElement('script');r.async=1;
  r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
  a.appendChild(r);
})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
*/

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

/** Session usage counters — persisted in sessionStorage (resets per tab) */
let _session = {};

/** Epoch ms when this page loaded — used to compute session duration */
const _sessionStart = Date.now();

/** Cached device type, populated once on init */
let _deviceType = null;

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', _init);

function _init() {
  _loadSession();
  _detectDevice();
  _loadGA4();
  _trackPageView();
  _setupSessionDuration();
  _setupKeyboardShortcut();
  _log('Analytics: ready — device:', _deviceType,
       '| GA4:', ANALYTICS_CFG.measurementId);
}

// ═══════════════════════════════════════════════════════════
// GA4 LOADER
// ═══════════════════════════════════════════════════════════

/**
 * Dynamically injects the GA4 <script> tag.
 * Async & non-blocking — the rest of the page is unaffected.
 * If the Measurement ID is still a placeholder, loading is skipped
 * and debug mode will still log all events so you can verify the
 * integration before going live.
 */
function _loadGA4() {
  const id = ANALYTICS_CFG.measurementId;

  if (!id || id === 'G-XXXXXXXXXX') {
    _log('Analytics: GA4 not active (Measurement ID is still a placeholder).');
    _log('  → Open js/analytics.js and set ANALYTICS_CFG.measurementId to activate.');
    return;
  }

  // Inject async gtag.js script exactly as Google recommends
  const script   = document.createElement('script');
  script.async   = true;
  script.src     = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  // Bootstrap the data layer and gtag command queue
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    // We fire page_view manually in _trackPageView() for full control
    send_page_view: false,
  });

  _log(`Analytics: GA4 loaded — ${id}`);
}

// ═══════════════════════════════════════════════════════════
// UNIFIED EVENT DISPATCHER
// ═══════════════════════════════════════════════════════════

/**
 * track(eventName, params)
 *
 * The single entry point for ALL analytics events.
 * Dispatches simultaneously to every configured tool.
 *
 * Automatically attaches common dimensions to every event:
 *   • device_type          — 'mobile' | 'tablet' | 'desktop'
 *   • items_this_session   — running count of items added in this tab
 *
 * @param {string} eventName - snake_case name, e.g. 'invoice_downloaded'
 * @param {Object} [params]  - extra key/value pairs for this specific event
 *
 * Examples:
 *   window.analytics.track('item_added', { item_count: 3 })
 *   window.analytics.track('currency_changed', { currency: 'USD' })
 */
function track(eventName, params = {}) {
  // Enrich with common dimensions on every event
  const enriched = {
    ...params,
    device_type:         _deviceType || 'desktop',
    items_this_session:  _session.items_added || 0,
  };

  // ── Google Analytics 4 ──────────────────────────────────
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, enriched);
  }

  // ── Microsoft Clarity (custom tags) ────────────────────
  // Clarity auto-records sessions; custom tags make events searchable
  // in the Clarity portal under Filters → Custom Tags.
  if (typeof window.clarity === 'function') {
    window.clarity('set', eventName, JSON.stringify(params));
  }

  // ── Hotjar virtual events ────────────────────────────────
  // Shows in Hotjar dashboard under Funnels and Trends.
  if (typeof window.hj === 'function') {
    window.hj('event', eventName);
  }

  _log(`[Analytics] ${eventName}`, enriched);
}

// ═══════════════════════════════════════════════════════════
// PAGE VIEW
// ═══════════════════════════════════════════════════════════

/**
 * Tracks the initial page load.
 * Fires once on DOMContentLoaded.
 *
 * GA4 Explorer: Events → page_view
 * Dimensions: page_title, page_location, device_type
 */
function _trackPageView() {
  track('page_view', {
    page_title:    document.title,
    page_location: window.location.href,
  });
}

// ═══════════════════════════════════════════════════════════
// SESSION DURATION
// ═══════════════════════════════════════════════════════════

/**
 * Fires `session_end` when the user navigates away or closes the tab.
 * Includes total session length (seconds) and all usage counters for
 * the session, giving you a per-visit usage snapshot in GA4.
 *
 * GA4 Explorer: Events → session_end
 * Note: GA4 uses sendBeacon internally, so this event is not dropped
 * even when the tab closes mid-flight.
 */
function _setupSessionDuration() {
  window.addEventListener('beforeunload', () => {
    const durationSec = Math.round((Date.now() - _sessionStart) / 1000);
    track('session_end', {
      session_duration_sec:  durationSec,
      invoices_downloaded:   _session.invoices_downloaded || 0,
      items_added_total:     _session.items_added         || 0,
      items_removed_total:   _session.items_removed       || 0,
      form_clears:           _session.form_clears         || 0,
      tax_rows_added:        _session.tax_rows_added      || 0,
    });
  });
}

// ═══════════════════════════════════════════════════════════
// DEVICE DETECTION
// ═══════════════════════════════════════════════════════════

/**
 * Classifies the user's device once on init.
 * Result is attached to every subsequent event as `device_type`.
 *
 * Values: 'mobile' | 'tablet' | 'desktop'
 */
function _detectDevice() {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    _deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(ua)) {
    _deviceType = 'mobile';
  } else {
    _deviceType = 'desktop';
  }
}

/** Returns the detected device type string */
function getDeviceType() {
  return _deviceType || 'desktop';
}

// ═══════════════════════════════════════════════════════════
// SESSION USAGE COUNTERS
// ═══════════════════════════════════════════════════════════

function _loadSession() {
  try {
    _session = JSON.parse(sessionStorage.getItem(ANALYTICS_CFG.sessionKey)) || {};
  } catch (_) {
    _session = {};
  }
}

function _saveSession() {
  try {
    sessionStorage.setItem(ANALYTICS_CFG.sessionKey, JSON.stringify(_session));
  } catch (_) {}
}

/** Increment a named counter and persist it to sessionStorage */
function _inc(key) {
  _session[key] = (_session[key] || 0) + 1;
  _saveSession();
}

// ═══════════════════════════════════════════════════════════
// HIGH-LEVEL EVENT HELPERS
// ═══════════════════════════════════════════════════════════
// Called from script.js at each user action site.
// Each function: (1) increments the relevant session counter,
//                (2) calls track() with enriched context params.

/**
 * User clicked "+ Add Line Item"
 *
 * GA4 Explorer: Events → item_added
 * Params: items_added_this_session
 */
function itemAdded() {
  _inc('items_added');
  track('item_added', {
    items_added_this_session: _session.items_added,
  });
}

/**
 * User clicked × to remove a line item
 *
 * GA4 Explorer: Events → item_removed
 * Params: net_items_this_session (added minus removed)
 */
function itemRemoved() {
  _inc('items_removed');
  track('item_removed', {
    net_items_this_session: (_session.items_added || 0) - _session.items_removed,
  });
}

/**
 * User successfully validated and triggered a PDF download/print.
 *
 * GA4 Explorer: Events → invoice_downloaded
 * Params: item_count, total_amount, currency, invoices_this_session
 *
 * @param {{ item_count: number, total_amount: number, currency: string }} params
 */
function invoiceDownloaded(params = {}) {
  _inc('invoices_downloaded');
  track('invoice_downloaded', {
    ...params,
    invoices_this_session: _session.invoices_downloaded,
  });
}

/**
 * User confirmed "Clear All" and the form was reset.
 *
 * GA4 Explorer: Events → form_cleared
 * Params: form_clears_this_session
 */
function formCleared() {
  _inc('form_clears');
  track('form_cleared', {
    form_clears_this_session: _session.form_clears,
  });
}

/**
 * User uploaded a company logo.
 *
 * GA4 Explorer: Events → logo_uploaded
 */
function logoUploaded() {
  track('logo_uploaded');
}

/**
 * User selected a different currency from the picker.
 *
 * GA4 Explorer: Events → currency_changed
 * Params: currency (ISO 4217 code, e.g. 'USD')
 *
 * @param {string} currency
 */
function currencyChanged(currency) {
  track('currency_changed', { currency });
}

/**
 * User toggled dark / light mode.
 *
 * GA4 Explorer: Events → dark_mode_toggled
 * Params: dark_mode ('dark' | 'light')
 *
 * @param {boolean} isDark
 */
function darkModeToggled(isDark) {
  track('dark_mode_toggled', { dark_mode: isDark ? 'dark' : 'light' });
}

/**
 * User clicked "+ Add Tax" to add a new tax row.
 *
 * GA4 Explorer: Events → tax_row_added
 * Params: tax_rows_this_session
 */
function taxRowAdded() {
  _inc('tax_rows_added');
  track('tax_row_added', {
    tax_rows_this_session: _session.tax_rows_added,
  });
}

// ═══════════════════════════════════════════════════════════
// DEVELOPER TOOLS
// ═══════════════════════════════════════════════════════════

/**
 * Print a full session report to the browser console.
 * Also accessible via Ctrl+Shift+S anywhere on the page.
 *
 * Returns the report object so you can inspect it programmatically:
 *   const r = window.analytics.sessionStats()
 *   console.log(r.invoices_downloaded)
 */
function sessionStats() {
  const durationSec = Math.round((Date.now() - _sessionStart) / 1000);
  const report = {
    device_type:          getDeviceType(),
    session_duration_sec: durationSec,
    items_added:          _session.items_added         || 0,
    items_removed:        _session.items_removed       || 0,
    invoices_downloaded:  _session.invoices_downloaded || 0,
    form_clears:          _session.form_clears         || 0,
    tax_rows_added:       _session.tax_rows_added      || 0,
    ga4_measurement_id:   ANALYTICS_CFG.measurementId,
    debug_mode:           ANALYTICS_CFG.debug,
  };
  console.group('📈 Analytics Session Report  (Ctrl+Shift+S to reprint)');
  console.table([report]);
  console.log('Tip: set ANALYTICS_CFG.debug = false in analytics.js before going live.');
  console.groupEnd();
  return report;
}

function _setupKeyboardShortcut() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      sessionStats();
    }
  });
}

// ═══════════════════════════════════════════════════════════
// DEBUG LOGGER
// ═══════════════════════════════════════════════════════════

function _log(...args) {
  if (ANALYTICS_CFG.debug) console.log(...args);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * window.analytics
 *
 * Available to script.js, ads.js, and the browser console.
 *
 * Quick-start in the browser console:
 *   window.analytics.sessionStats()       → print full session report
 *   window.analytics.track('test', {})    → fire a test event to GA4
 *   Ctrl+Shift+S                          → same as sessionStats()
 */
window.analytics = {
  // ── Low-level dispatcher ─────────────────────────────────
  // Used by ads.js and for sending custom one-off events.
  track,

  // ── High-level helpers (called from script.js) ───────────
  itemAdded,
  itemRemoved,
  invoiceDownloaded,
  formCleared,
  logoUploaded,
  currencyChanged,
  darkModeToggled,
  taxRowAdded,

  // ── Utilities ────────────────────────────────────────────
  sessionStats,
  getDeviceType,
};

// ─── Dev hint ──────────────────────────────────────────────
// Open the browser console and run:
//   analytics.sessionStats()     → full usage report for this tab
//   analytics.track('test', {})  → verify GA4 is receiving events
// Or press Ctrl+Shift+S anywhere on the page.
