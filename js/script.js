/**
 * Invoice Generator — script.js
 *
 * Handles:
 *  - Auto invoice number & date defaults
 *  - Dynamic line item rows (add / remove)
 *  - Real-time totals calculation
 *  - Live preview rendering
 *  - Local storage persistence
 *  - Company logo upload (base64)
 *  - Dark mode toggle
 *  - Form validation
 *  - PDF download via window.print()
 */

'use strict';

// ============================================================
// STATE
// ============================================================

/** Map of item id → { id, name, qty, rate } */
let items = {};
let itemCounter = 0;

/** Map of tax id → { id, name, rate } */
let taxes = {};
let taxCounter = 0;

/** Active currency code — drives all formatCurrency() calls */
let currentCurrency = 'INR';

/** Base64 logo string or null */
let logoData = null;

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', init);

function init() {
  setDefaultDates();
  generateAndSetInvoiceNumber();
  applyStoredCurrency();     // set currentCurrency before anything renders
  attachAllListeners();
  loadFromStorage();         // overwrite defaults with saved data if present
  initCurrencyPicker();      // build list + set button label using currentCurrency
  // If storage had no items, start with one empty row
  if (Object.keys(items).length === 0) {
    addItemRow();
  } else {
    renderAllItems();
  }
  // If storage had no taxes, start with one default GST row
  if (Object.keys(taxes).length === 0) {
    addTaxRow();
  } else {
    renderAllTaxRows();
  }
  updatePreview();
}

// ============================================================
// DEFAULTS
// ============================================================

/** Set invoice date = today, due date = today + 30 days */
function setDefaultDates() {
  const today = new Date();
  document.getElementById('invoiceDate').value = toInputDate(today);

  const due = new Date(today);
  due.setDate(due.getDate() + 30);
  document.getElementById('dueDate').value = toInputDate(due);
}

/** Generate INV-YYYYMMDD-XXX pattern */
function generateAndSetInvoiceNumber() {
  const d = new Date();
  const datePart = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  const rand = String(Math.floor(Math.random() * 900) + 100);
  document.getElementById('invoiceNumber').value = `INV-${datePart}-${rand}`;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function attachAllListeners() {
  // All text/date/number inputs in the form — trigger save + preview
  const formIds = [
    'businessName', 'businessAddress', 'businessEmail', 'businessPhone', 'gstNumber',
    'customerName', 'customerAddress', 'customerEmail', 'customerGST',
    'invoiceNumber', 'invoiceDate', 'dueDate',
    'discount', 'shipping',
    'notes', 'terms',
  ];
  formIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', onFormChange);
  });

  // Add item button
  document.getElementById('addItemBtn').addEventListener('click', () => {
    addItemRow();
    onFormChange();
    window.analytics?.itemAdded();
  });

  // Add tax button
  document.getElementById('addTaxBtn').addEventListener('click', () => {
    addTaxRow();
    onFormChange();
    window.analytics?.taxRowAdded();
  });

  // Logo
  document.getElementById('logoInput').addEventListener('change', handleLogoChange);
  document.getElementById('removeLogoBtn').addEventListener('click', removeLogo);
  document.getElementById('logoUploadArea').addEventListener('click', () => {
    document.getElementById('logoInput').click();
  });

  // Dark mode
  document.getElementById('darkModeToggle').addEventListener('click', toggleDarkMode);

  // Actions
  document.getElementById('downloadBtn').addEventListener('click', downloadPDF);
  document.getElementById('printBtn').addEventListener('click', downloadPDF);
  document.getElementById('clearBtn').addEventListener('click', clearForm);
}

/** Called on any form change — debounced save + immediate preview */
const onFormChange = debounce(() => {
  saveToStorage();
  updatePreview();
}, 150);

// ============================================================
// LINE ITEMS
// ============================================================

/**
 * Add a new item row to the DOM and to the items map.
 * @param {Object} [data] - Optional initial values { name, qty, rate }
 */
function addItemRow(data = {}) {
  itemCounter++;
  const id = itemCounter;

  items[id] = {
    id,
    name: data.name || '',
    qty:  parseFloat(data.qty)  || 1,
    rate: parseFloat(data.rate) || 0,
  };

  const row = createItemRowElement(id);
  document.getElementById('itemsContainer').appendChild(row);
  updateRowTotal(id);
}

/** Re-render all rows from the items map (used after loading from storage) */
function renderAllItems() {
  const container = document.getElementById('itemsContainer');
  container.innerHTML = '';
  Object.values(items).forEach(item => {
    const row = createItemRowElement(item.id);
    container.appendChild(row);
    updateRowTotal(item.id);
  });
}

/** Create the DOM element for a single item row */
function createItemRowElement(id) {
  const item = items[id];
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.id = id;

  // Description input
  const nameInput = makeInput('text', item.name, 'Item description');
  nameInput.addEventListener('input', e => {
    items[id].name = e.target.value;
    onFormChange();
  });

  // Qty input
  const qtyInput = makeInput('number', item.qty, '1');
  qtyInput.min = '0';
  qtyInput.step = '1';
  qtyInput.addEventListener('input', e => {
    items[id].qty = parseFloat(e.target.value) || 0;
    updateRowTotal(id);
    onFormChange();
  });

  // Rate input
  const rateInput = makeInput('number', item.rate || '', '0.00');
  rateInput.min = '0';
  rateInput.step = '0.01';
  rateInput.addEventListener('input', e => {
    items[id].rate = parseFloat(e.target.value) || 0;
    updateRowTotal(id);
    onFormChange();
  });

  // Total display
  const totalSpan = document.createElement('span');
  totalSpan.className = 'item-total-cell';
  totalSpan.dataset.totalFor = id;
  totalSpan.textContent = formatCurrency(0);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-item';
  removeBtn.title = 'Remove item';
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', () => removeItem(id));

  row.appendChild(nameInput);
  row.appendChild(qtyInput);
  row.appendChild(rateInput);
  row.appendChild(totalSpan);
  row.appendChild(removeBtn);

  return row;
}

/** Remove item row by id */
function removeItem(id) {
  // Always keep at least one row
  if (Object.keys(items).length <= 1) {
    showToast('At least one item is required.', 'error');
    return;
  }
  delete items[id];
  const row = document.querySelector(`.item-row[data-id="${id}"]`);
  if (row) row.remove();
  refreshTaxAmounts();
  onFormChange();
  window.analytics?.itemRemoved();
}

/** Recalculate and display row total. Also refreshes tax amounts since subtotal changed. */
function updateRowTotal(id) {
  const item = items[id];
  if (!item) return;
  const total = item.qty * item.rate;
  const cell = document.querySelector(`[data-total-for="${id}"]`);
  if (cell) cell.textContent = formatCurrency(total);
  refreshTaxAmounts();
}

/** Small helper to create a styled input */
function makeInput(type, value, placeholder) {
  const el = document.createElement('input');
  el.type = type;
  el.className = 'form-input';
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

// ============================================================
// TAX ROWS
// ============================================================

/**
 * Add a new tax row. Defaults to "GST" at 18%.
 * @param {Object} [data] - Optional { name, rate }
 */
function addTaxRow(data = {}) {
  taxCounter++;
  const id = taxCounter;
  taxes[id] = {
    id,
    name: data.name || 'GST',
    rate: data.rate != null ? (parseFloat(data.rate) || 0) : 18,
  };
  const row = createTaxRowElement(id);
  document.getElementById('taxRowsContainer').appendChild(row);
  updateTaxRowAmount(id);
}

/** Re-render all tax rows from state (used after loading from storage) */
function renderAllTaxRows() {
  const container = document.getElementById('taxRowsContainer');
  container.innerHTML = '';
  Object.values(taxes).forEach(tax => {
    const row = createTaxRowElement(tax.id);
    container.appendChild(row);
    updateTaxRowAmount(tax.id);
  });
}

/** Build the DOM element for a single tax row */
function createTaxRowElement(id) {
  const tax = taxes[id];
  const row = document.createElement('div');
  row.className = 'tax-row';
  row.dataset.taxId = id;

  const nameInput = makeInput('text', tax.name, 'e.g. CGST, SGST');
  nameInput.addEventListener('input', e => {
    taxes[id].name = e.target.value;
    onFormChange();
  });

  const rateInput = makeInput('number', tax.rate, '0');
  rateInput.min = '0';
  rateInput.max = '100';
  rateInput.step = '0.5';
  rateInput.addEventListener('input', e => {
    taxes[id].rate = parseFloat(e.target.value) || 0;
    updateTaxRowAmount(id);
    onFormChange();
  });

  const amountSpan = document.createElement('span');
  amountSpan.className = 'tax-amount-cell';
  amountSpan.dataset.taxAmountFor = id;
  amountSpan.textContent = formatCurrency(0);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-item';
  removeBtn.title = 'Remove tax';
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', () => removeTaxRow(id));

  row.appendChild(nameInput);
  row.appendChild(rateInput);
  row.appendChild(amountSpan);
  row.appendChild(removeBtn);

  return row;
}

/** Remove a tax row by id */
function removeTaxRow(id) {
  if (Object.keys(taxes).length <= 1) {
    showToast('Keep at least one tax row.', 'error');
    return;
  }
  delete taxes[id];
  const row = document.querySelector(`.tax-row[data-tax-id="${id}"]`);
  if (row) row.remove();
  onFormChange();
}

/** Update the displayed amount for a single tax row */
function updateTaxRowAmount(id) {
  const tax = taxes[id];
  if (!tax) return;
  const subtotal = getSubtotal();
  const amount = (subtotal * tax.rate) / 100;
  const cell = document.querySelector(`[data-tax-amount-for="${id}"]`);
  if (cell) cell.textContent = formatCurrency(amount);
}

/** Refresh amounts in all visible tax rows (called when subtotal changes) */
function refreshTaxAmounts() {
  Object.keys(taxes).forEach(id => updateTaxRowAmount(Number(id)));
}

/** Update every (₹) label in the form to show the current currency symbol */
function refreshCurrencySymbolLabels() {
  const symbol = getCurrencySymbol();
  document.querySelectorAll('.currency-symbol-label').forEach(el => {
    el.textContent = symbol;
  });
}

/** Extract just the symbol for currentCurrency (e.g. '₹', '$', '€') */
function getCurrencySymbol() {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currentCurrency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find(p => p.type === 'currency')
      ?.value ?? currentCurrency;
  } catch (_) {
    return currentCurrency;
  }
}

// ============================================================
// CALCULATIONS
// ============================================================

function getSubtotal() {
  return Object.values(items).reduce((sum, item) => sum + item.qty * item.rate, 0);
}

function getTotals() {
  const subtotal = getSubtotal();
  // Build an array of { name, rate, amount } for each tax row
  const taxLines = Object.values(taxes).map(tax => ({
    name:   tax.name  || 'Tax',
    rate:   parseFloat(tax.rate) || 0,
    amount: (subtotal * (parseFloat(tax.rate) || 0)) / 100,
  }));
  const taxTotal = taxLines.reduce((sum, t) => sum + t.amount, 0);
  const discount = parseFloat(document.getElementById('discount').value) || 0;
  const shipping = parseFloat(document.getElementById('shipping').value) || 0;
  const total    = subtotal + taxTotal - discount + shipping;
  return { subtotal, taxLines, taxTotal, discount, shipping, total };
}

// ============================================================
// FORMATTING
// ============================================================

/** Format amount using the currently selected currency */
function formatCurrency(amount) {
  // Use locale matching the currency for natural grouping (e.g. en-IN for INR)
  const localeMap = { INR: 'en-IN', JPY: 'ja-JP', AED: 'ar-AE', CHF: 'de-CH' };
  const locale = localeMap[currentCurrency] || 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currentCurrency,
    minimumFractionDigits: currentCurrency === 'JPY' ? 0 : 2,
    maximumFractionDigits: currentCurrency === 'JPY' ? 0 : 2,
  }).format(amount);
}

/** Format a date string (YYYY-MM-DD) to DD/MM/YYYY */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Convert Date object to YYYY-MM-DD string for <input type="date"> */
function toInputDate(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Escape HTML special chars to prevent XSS in innerHTML */
function escapeHtml(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ============================================================
// LIVE PREVIEW RENDERING
// ============================================================

function updatePreview() {
  const container = document.getElementById('invoicePreview');
  container.innerHTML = buildPreviewHTML();
}

function buildPreviewHTML() {
  const bName    = val('businessName');
  const bAddr    = val('businessAddress');
  const bEmail   = val('businessEmail');
  const bPhone   = val('businessPhone');
  const bGST     = val('gstNumber');
  const cName    = val('customerName');
  const cAddr    = val('customerAddress');
  const cEmail   = val('customerEmail');
  const cGST     = val('customerGST');
  const invNo    = val('invoiceNumber');
  const invDate  = val('invoiceDate');
  const dueDate  = val('dueDate');
  const notes    = val('notes');
  const terms    = val('terms');
  const { subtotal, taxLines, taxTotal, discount, shipping, total } = getTotals();

  // Show empty state if nothing has been filled yet
  if (!bName && !cName) {
    return `<div class="inv-empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <p>Fill in the form on the left to see your invoice preview here.</p>
    </div>`;
  }

  // Build business contact line
  const contactParts = [bPhone, bEmail].filter(Boolean);
  const contactLine  = contactParts.join(' · ');

  // Build logo HTML
  const logoHTML = logoData
    ? `<img class="inv-logo" src="${logoData}" alt="Company Logo" />`
    : '';

  // Build items rows
  const itemRows = Object.values(items).map((item, idx) => {
    const lineTotal = item.qty * item.rate;
    return `<tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(item.name) || '<span class="text-muted-inv">—</span>'}</td>
      <td style="text-align:center">${item.qty}</td>
      <td style="text-align:center">${formatCurrency(item.rate)}</td>
      <td>${formatCurrency(lineTotal)}</td>
    </tr>`;
  }).join('');

  // Build totals footer — one row per tax line
  const taxRows = taxLines
    .filter(t => t.rate > 0)
    .map(t => `<tr>
      <td colspan="4" style="text-align:right;color:#718096">${escapeHtml(t.name)} (${t.rate}%)</td>
      <td>${formatCurrency(t.amount)}</td>
    </tr>`)
    .join('');

  const discountRow = discount > 0
    ? `<tr><td colspan="4" style="text-align:right;color:#718096">Discount</td>
         <td style="color:#ef4444">− ${formatCurrency(discount)}</td></tr>`
    : '';

  const shippingRow = shipping > 0
    ? `<tr><td colspan="4" style="text-align:right;color:#718096">Shipping / Other</td>
         <td>${formatCurrency(shipping)}</td></tr>`
    : '';

  const gstBadge = bGST
    ? `<span style="display:inline-block;margin-top:.3rem;font-size:.72rem;background:#eef2ff;color:#4f46e5;padding:.15rem .5rem;border-radius:4px;font-weight:600">GSTIN: ${escapeHtml(bGST)}</span>`
    : '';

  const cGSTBadge = cGST
    ? `<div style="margin-top:.3rem;font-size:.75rem;color:#718096">GSTIN: ${escapeHtml(cGST)}</div>`
    : '';

  const notesSection = notes
    ? `<div class="inv-footer-section"><h4>Notes</h4><p>${escapeHtml(notes)}</p></div>`
    : '';

  const termsSection = terms
    ? `<div class="inv-footer-section"><h4>Terms &amp; Conditions</h4><p>${escapeHtml(terms)}</p></div>`
    : '';

  const footerSection = (notesSection || termsSection)
    ? `<div class="inv-footer">${notesSection}${termsSection}</div>`
    : '';

  return `
    <!-- Invoice Header -->
    <div class="inv-header">
      <div class="inv-brand">
        ${logoHTML}
        <div class="inv-biz-name">${escapeHtml(bName) || '<span style="color:#a0aec0">Your Business</span>'}</div>
        <div class="inv-biz-detail">${escapeHtml(bAddr)}</div>
        ${contactLine ? `<div class="inv-biz-detail" style="margin-top:.25rem">${escapeHtml(contactLine)}</div>` : ''}
        ${gstBadge}
      </div>
      <div class="inv-meta">
        <div class="inv-title">INVOICE</div>
        <table class="inv-meta-table">
          <tr><td>Invoice #</td><td>${escapeHtml(invNo) || '—'}</td></tr>
          <tr><td>Date</td><td>${formatDate(invDate)}</td></tr>
          ${dueDate ? `<tr><td>Due Date</td><td>${formatDate(dueDate)}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <hr class="inv-divider" />

    <!-- Bill To -->
    <div class="inv-bill-section">
      <div>
        <div class="inv-bill-label">Bill To</div>
        <div class="inv-bill-name">${escapeHtml(cName) || '<span style="color:#a0aec0">Customer Name</span>'}</div>
        <div class="inv-bill-detail">${escapeHtml(cAddr)}</div>
        ${cEmail ? `<div style="font-size:.8rem;color:#718096;margin-top:.15rem">${escapeHtml(cEmail)}</div>` : ''}
        ${cGSTBadge}
      </div>
    </div>

    <!-- Items Table -->
    <table class="inv-items-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || `<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:1.5rem">No items added yet</td></tr>`}
      </tbody>
      <tfoot>
        <tr class="subtotal-row">
          <td colspan="4" style="text-align:right;color:#718096">Subtotal</td>
          <td>${formatCurrency(subtotal)}</td>
        </tr>
        ${taxRows}
        ${discountRow}
        ${shippingRow}
        <tr class="total-row">
          <td colspan="4" style="text-align:right">Total</td>
          <td>${formatCurrency(total)}</td>
        </tr>
      </tfoot>
    </table>

    ${footerSection}
  `;
}

/** Shorthand: get trimmed value of a form field */
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ============================================================
// LOGO UPLOAD
// ============================================================

function handleLogoChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo must be under 2 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = evt => {
    logoData = evt.target.result;
    document.getElementById('logoPreview').src = logoData;
    document.getElementById('logoPlaceholder').classList.add('hidden');
    document.getElementById('logoPreviewWrap').classList.remove('hidden');
    onFormChange();
    window.analytics?.logoUploaded();
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  logoData = null;
  document.getElementById('logoInput').value = '';
  document.getElementById('logoPreview').src = '';
  document.getElementById('logoPlaceholder').classList.remove('hidden');
  document.getElementById('logoPreviewWrap').classList.add('hidden');
  onFormChange();
}

// ============================================================
// CURRENCY PICKER
// ============================================================

/** All currencies built from browser Intl — populated once at init */
let allCurrencies = [];

/**
 * Build the full currency list using browser-native Intl APIs.
 * No network request, no API key, covers all ISO 4217 codes (~300).
 * Falls back to a small curated list on older browsers.
 */
function buildCurrencyData() {
  // Get all currency codes the browser knows about
  let codes;
  try {
    codes = Intl.supportedValuesOf('currency');
  } catch (e) {
    // Fallback for browsers that don't support supportedValuesOf (pre-2022)
    codes = [
      'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD',
      'BDT','BGN','BHD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD',
      'CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP',
      'DZD','EGP','ERN','ETB','EUR','FJD','GBP','GEL','GHS','GMD','GTQ','HKD',
      'HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD',
      'JPY','KES','KGS','KHR','KMF','KRW','KWD','KZT','LAK','LBP','LKR','LYD',
      'MAD','MDL','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR',
      'MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP',
      'PKR','PLN','PYG','QAR','RON','RSD','RUB','SAR','SCR','SDG','SEK','SGD',
      'SOS','SRD','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD',
      'TZS','UAH','UGX','USD','UYU','UZS','VES','VND','XAF','XCD','XOF','YER',
      'ZAR','ZMW',
    ];
  }

  const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });

  return codes
    .map(code => {
      // Extract the narrow symbol (₹, $, €, £ …)
      let symbol = code;
      try {
        symbol = new Intl.NumberFormat('en', {
          style: 'currency',
          currency: code,
          currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })
          .formatToParts(0)
          .find(p => p.type === 'currency')
          ?.value ?? code;
      } catch (_) {}

      // Full English name ("Indian Rupee", "US Dollar" …)
      let name = code;
      try { name = displayNames.of(code) ?? code; } catch (_) {}

      return { code, symbol, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Set up the custom currency picker: build list, search, selection */
function initCurrencyPicker() {
  allCurrencies = buildCurrencyData();

  const btn       = document.getElementById('currencyPickerBtn');
  const dropdown  = document.getElementById('currencyDropdown');
  const search    = document.getElementById('currencySearch');
  const list      = document.getElementById('currencyList');
  const empty     = document.getElementById('currencyEmpty');

  /** Render list items filtered by query */
  function renderList(query = '') {
    const q = query.toLowerCase().trim();
    const filtered = q
      ? allCurrencies.filter(c =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q))
      : allCurrencies;

    if (filtered.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    list.innerHTML = filtered.map(c => `
      <li data-code="${c.code}" role="option"
          aria-selected="${c.code === currentCurrency}"
          class="${c.code === currentCurrency ? 'selected' : ''}">
        <span class="curr-symbol">${escapeHtml(c.symbol)}</span>
        <span class="curr-code">${c.code}</span>
        <span class="curr-name">${escapeHtml(c.name)}</span>
      </li>`).join('');
  }

  /** Update the button label to show the selected currency */
  function updateBtn() {
    const c = allCurrencies.find(x => x.code === currentCurrency);
    document.getElementById('currencyDisplay').textContent =
      c ? `${c.symbol} ${c.code}` : currentCurrency;
  }

  function openDropdown() {
    dropdown.classList.remove('hidden');
    search.value = '';
    renderList();
    search.focus();
    // Scroll the selected item into view
    requestAnimationFrame(() => {
      const sel = list.querySelector('.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    });
  }

  function closeDropdown() {
    dropdown.classList.add('hidden');
  }

  // Toggle on button click
  btn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.contains('hidden') ? openDropdown() : closeDropdown();
  });

  // Live search filter
  search.addEventListener('input', e => renderList(e.target.value));

  // Select a currency
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-code]');
    if (!li) return;

    currentCurrency = li.dataset.code;
    localStorage.setItem('inv_currency', currentCurrency);
    updateBtn();
    closeDropdown();

    // Refresh every displayed amount
    Object.keys(items).forEach(id => updateRowTotal(Number(id)));
    refreshTaxAmounts();
    refreshCurrencySymbolLabels();
    updatePreview();
    window.analytics?.currencyChanged(currentCurrency);
  });

  // Close when clicking outside the picker
  document.addEventListener('click', e => {
    if (!document.getElementById('currencyPicker').contains(e.target)) {
      closeDropdown();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDropdown();
  });

  updateBtn();
  refreshCurrencySymbolLabels(); // set labels on initial load
}

// ============================================================
// DARK MODE
// ============================================================

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('iconSun').classList.toggle('hidden', !isDark);
  document.getElementById('iconMoon').classList.toggle('hidden', isDark);
  localStorage.setItem('inv_darkMode', isDark ? '1' : '0');
  window.analytics?.darkModeToggled(isDark);
}

function applyStoredDarkMode() {
  const stored = localStorage.getItem('inv_darkMode');
  if (stored === '1') {
    document.body.classList.add('dark');
    document.getElementById('iconSun').classList.remove('hidden');
    document.getElementById('iconMoon').classList.add('hidden');
  }
}

function applyStoredCurrency() {
  const saved = localStorage.getItem('inv_currency');
  if (saved) currentCurrency = saved;
  // Button label is updated later by initCurrencyPicker → updateBtn()
}

// ============================================================
// LOCAL STORAGE — SAVE & LOAD
// ============================================================

const STORAGE_KEY = 'invoiceGeneratorData';

function saveToStorage() {
  const data = {
    businessName:    val('businessName'),
    businessAddress: val('businessAddress'),
    businessEmail:   val('businessEmail'),
    businessPhone:   val('businessPhone'),
    gstNumber:       val('gstNumber'),
    customerName:    val('customerName'),
    customerAddress: val('customerAddress'),
    customerEmail:   val('customerEmail'),
    customerGST:     val('customerGST'),
    invoiceNumber:   val('invoiceNumber'),
    invoiceDate:     val('invoiceDate'),
    dueDate:         val('dueDate'),

    discount:        val('discount'),
    shipping:        val('shipping'),
    notes:           val('notes'),
    terms:           val('terms'),
    items:           Object.values(items),
    taxes:           Object.values(taxes),
    logoData,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Storage quota exceeded — silently ignore
  }
}

function loadFromStorage() {
  applyStoredDarkMode();
  applyStoredCurrency();

  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    data = JSON.parse(raw);
  } catch (e) {
    return;
  }

  // Restore form fields
  const fields = [
    'businessName', 'businessAddress', 'businessEmail', 'businessPhone', 'gstNumber',
    'customerName', 'customerAddress', 'customerEmail', 'customerGST',
    'invoiceNumber', 'invoiceDate', 'dueDate',
    'discount', 'shipping',
    'notes', 'terms',
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el && data[id] !== undefined && data[id] !== '') {
      el.value = data[id];
    }
  });

  // Restore logo
  if (data.logoData) {
    logoData = data.logoData;
    document.getElementById('logoPreview').src = logoData;
    document.getElementById('logoPlaceholder').classList.add('hidden');
    document.getElementById('logoPreviewWrap').classList.remove('hidden');
  }

  // Restore items
  if (Array.isArray(data.items) && data.items.length > 0) {
    items = {};
    itemCounter = 0;
    data.items.forEach(item => {
      itemCounter++;
      items[itemCounter] = { id: itemCounter, name: item.name, qty: item.qty, rate: item.rate };
    });
  }

  // Restore taxes — with backward compat for old single-taxRate saves
  if (Array.isArray(data.taxes) && data.taxes.length > 0) {
    taxes = {};
    taxCounter = 0;
    data.taxes.forEach(tax => {
      taxCounter++;
      taxes[taxCounter] = { id: taxCounter, name: tax.name || 'GST', rate: parseFloat(tax.rate) || 0 };
    });
  } else if (data.taxRate !== undefined) {
    // Migrate old format: single taxRate field → one GST row
    taxes = {};
    taxCounter = 1;
    taxes[1] = { id: 1, name: 'GST', rate: parseFloat(data.taxRate) || 18 };
  }
}

// ============================================================
// VALIDATION
// ============================================================

function validateForm() {
  let valid = true;

  const required = [
    { id: 'businessName',  label: 'Business Name' },
    { id: 'businessAddress', label: 'Business Address' },
    { id: 'customerName',  label: 'Customer Name' },
    { id: 'invoiceNumber', label: 'Invoice Number' },
    { id: 'invoiceDate',   label: 'Invoice Date' },
  ];

  // Clear previous errors
  document.querySelectorAll('.form-input.error, .form-textarea.error').forEach(el => {
    el.classList.remove('error');
  });

  for (const { id, label } of required) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) el.classList.add('error');
      if (valid) {
        // Show error on first missing field
        showToast(`"${label}" is required.`, 'error');
        el && el.focus();
      }
      valid = false;
    }
  }

  // Must have at least one named item
  const hasNamedItem = Object.values(items).some(item => item.name.trim() !== '');
  if (!hasNamedItem) {
    showToast('Add at least one item with a description.', 'error');
    valid = false;
  }

  return valid;
}

// ============================================================
// PDF / PRINT
// ============================================================

function downloadPDF() {
  if (!validateForm()) return;

  // Ensure preview is up to date before printing
  updatePreview();

  // Track the download with invoice value context
  window.analytics?.invoiceDownloaded({
    item_count:   Object.keys(items).length,
    total_amount: Math.round(getTotals().total * 100) / 100,
    currency:     currentCurrency,
  });

  // Notify ads.js so the post-download panel can fire (no-op if ads.js not loaded)
  if (typeof window.onInvoiceDownload === 'function') window.onInvoiceDownload();

  setTimeout(() => window.print(), 100);
}

// ============================================================
// CLEAR FORM
// ============================================================

function clearForm() {
  const confirmed = window.confirm('Clear all form data? This cannot be undone.');
  if (!confirmed) return;
  window.analytics?.formCleared();

  const textIds = [
    'businessName', 'businessAddress', 'businessEmail', 'businessPhone', 'gstNumber',
    'customerName', 'customerAddress', 'customerEmail', 'customerGST',
    'notes', 'terms',
  ];
  textIds.forEach(id => { document.getElementById(id).value = ''; });

  // Reset discount / shipping
  document.getElementById('discount').value = '0';
  document.getElementById('shipping').value = '0';

  // Reset taxes — one default GST row
  taxes = {};
  taxCounter = 0;
  document.getElementById('taxRowsContainer').innerHTML = '';
  addTaxRow();

  // Reset dates & invoice number
  setDefaultDates();
  generateAndSetInvoiceNumber();

  // Reset logo
  removeLogo();

  // Reset items — one empty row
  items = {};
  itemCounter = 0;
  document.getElementById('itemsContainer').innerHTML = '';
  addItemRow();

  // Clear storage
  localStorage.removeItem(STORAGE_KEY);

  updatePreview();
  showToast('Form cleared.');
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================

let toastTimer = null;

function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast show ${type}`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ============================================================
// UTILITY — DEBOUNCE
// ============================================================

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
