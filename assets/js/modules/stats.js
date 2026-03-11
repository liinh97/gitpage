// assets/js/modules/stats.js
import { formatVND, parseRaw } from '../core/utils.js';
import { state } from '../core/state.js';

let _client = null;
let _products = null;

// ====== CONFIG DEFAULTS (bạn đổi được trong UI) ======
const DEFAULT_COST_RATIO = 0.4; // thiếu cost -> 0% (bán hộ)
const DEFAULT_EXTRA_EVERY_N = 7;
const DEFAULT_EXTRA_AVG_COST = 500;
const DEFAULT_BASE_COST = 2000;

// ====== COST OVERRIDES (bạn điền dần) ======
// unit cost / 1 đơn vị món
// cost = 0 => bán hộ
const ITEM_COST_OVERRIDES = {
  "Nem TCC": 2750,
  "Sống Nem TCC": 2700,
  "Nem TCC xù": 2875,
  "Sống Nem TCC xù": 2875,
  "Nem TCC vỏ giòn": 3050,
  "Sống Nem TCC vỏ giòn": 3050,
  "Nem TCC phomai": 6816,
  "Sống Nem TCC phomai": 6816,
  "Bánh rán mặn": 3630,
  "Bánh rán phomai": 3414,
  "Bánh rán cốm dừa": 0,
  "Khoai tây chiên": 16250,
  "Chân gà rút xương": 0,
  "Bánh xèo nhật chay": 10000,
  "Gà chiên mắm": 17750,
  "Lạp xưởng": 7500,
  "Bánh gối": 0,
  "Nem tảng 0.5kg": 120000,
  "Nem tảng 1kg": 240000,
  "Trà đá": 0,
  "Trà quất": 2500,
  "Trà chanh": 2810,
  "Nước lọc": 3250,
  "Coca": 7292,
  "Sprite": 7000,
  "Thịt chưng mắm tép": 31500,
  "Bún thang chay": 0,
  "Xôi nấm": 0,
  "Ruốc nấm": 0,
  "Xôi cốm": 0,
  "Giò chay": 0,
  "Cốm xào": 0,
  "Hoa quả theo mùa": 0,
  "Nộm đu đủ giã lạc": 0,
};

export function initStats({ client, products }) {
  _client = client;
  _products = products;

  const btn = document.getElementById('showStatisticalBtn');
  const backdrop = document.getElementById('statsBackdrop');
  const closeBtn = document.getElementById('closeStatsBtn');
  const runBtn = document.getElementById('runStatsBtn');
  const toggleSummaryBtn = document.getElementById('toggleStatsSummaryBtn');
  const summaryWrap = document.getElementById('statsSummaryWrap');

  if (!btn || !backdrop || !runBtn || !toggleSummaryBtn || !summaryWrap) return;

  setFormattedMoneyInput('statsBaseCost', DEFAULT_BASE_COST);
  setFormattedMoneyInput('statsExtraAvgCost', DEFAULT_EXTRA_AVG_COST);

  const extraEveryNEl = document.getElementById('statsExtraEveryN');
  if (extraEveryNEl) extraEveryNEl.value = String(DEFAULT_EXTRA_EVERY_N);

  summaryWrap.classList.add('hidden');
  toggleSummaryBtn.classList.add('hidden');
  toggleSummaryBtn.textContent = 'Hiển thị tổng quát';

  setTodayRange();

  btn.addEventListener('click', () => {
    setTodayRange();
    backdrop.classList.remove('hidden');
    backdrop.style.display = 'flex';

    summaryWrap.classList.add('hidden');
    toggleSummaryBtn.classList.add('hidden');
    toggleSummaryBtn.textContent = 'Hiển thị tổng quát';
  });

  function close() {
    backdrop.style.display = 'none';
    backdrop.classList.add('hidden');

    summaryWrap.classList.add('hidden');
    toggleSummaryBtn.classList.add('hidden');
    toggleSummaryBtn.textContent = 'Hiển thị tổng quát';
  }

  closeBtn?.addEventListener('click', close);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) close();
  });

  toggleSummaryBtn.addEventListener('click', () => {
    const isHidden = summaryWrap.classList.contains('hidden');
    summaryWrap.classList.toggle('hidden', !isHidden);
    toggleSummaryBtn.textContent = isHidden ? 'Ẩn tổng quát' : 'Hiển thị tổng quát';
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const oldText = runBtn.textContent;
    runBtn.textContent = 'Đang thống kê...';

    try {
      await runStats();

      toggleSummaryBtn.classList.remove('hidden');
      summaryWrap.classList.add('hidden');
      toggleSummaryBtn.textContent = 'Hiển thị tổng quát';
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = oldText;
    }
  });
}

function setTodayRange() {
  const today = getTodayYYYYMMDD();
  const fromEl = document.getElementById('statsFromDate');
  const toEl = document.getElementById('statsToDate');
  if (fromEl) fromEl.value = today;
  if (toEl) toEl.value = today;
}

async function runStats() {
  const summaryEl = document.getElementById('statsSummary');
  const warnEl = document.getElementById('statsWarnings');
  const tbody = document.getElementById('statsTableBody');

  if (!summaryEl || !tbody) return;

  warnEl?.classList.add('hidden');
  if (warnEl) warnEl.textContent = '';

  summaryEl.textContent = 'Đang tải thống kê thanh toán...';
  tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:10px;">Đang tải...</td></tr>`;

  if (!_client?.listInvoicesByQuery) {
    summaryEl.textContent = 'Thiếu client.listInvoicesByQuery';
    return;
  }

  // filters
  const fromDate = document.getElementById('statsFromDate')?.value || null; // yyyy-mm-dd
  const toDate = document.getElementById('statsToDate')?.value || null;

  const baseCost = parseRaw(document.getElementById('statsBaseCost')?.dataset?.raw || '0');
  const extraEveryN = Number(document.getElementById('statsExtraEveryN')?.value || DEFAULT_EXTRA_EVERY_N) || DEFAULT_EXTRA_EVERY_N;
  const extraAvgCost = parseRaw(document.getElementById('statsExtraAvgCost')?.dataset?.raw || String(DEFAULT_EXTRA_AVG_COST));

  // build cost map from products list + overrides
  const { costMap, missingCostItems } = buildCostMapFromProducts();

  const allInvoices = await loadAllInvoicesInRange({ fromDate, toDate });

  const paidInvoices = allInvoices.filter(inv => normalizePaymentStatus(inv?.paymentStatus, inv) === 'paid');
  const canceledInvoices = allInvoices.filter(inv => Number(inv?.status) === 3);
  
  const result = computeStats({
    invoices: paidInvoices,
    canceledCount: canceledInvoices.length,
    costMap,
    missingCostItems,
    baseCostPerInvoice: baseCost,
    extraEveryN,
    extraAvgCost,
  });

  renderStats(result);
}

function buildCostMapFromProducts() {
  const costMap = new Map();
  const missingCostItems = new Set();

  const productsList = state?.PRODUCTS || _products?.state?.PRODUCTS || [];

  for (const p of productsList) {
    const name = p?.name;
    if (!name) continue;

    // override
    if (Object.prototype.hasOwnProperty.call(ITEM_COST_OVERRIDES, name)) {
      const v = Number(ITEM_COST_OVERRIDES[name]);
      if (Number.isFinite(v) && v > 0) {
        costMap.set(name, v);
      } else {
        // override <=0 coi như chưa khai (không cho bán hộ nữa)
        missingCostItems.add(name);
        const price = Number(p?.variants?.[0]?.price || 0);
        const est = Math.round(price * DEFAULT_COST_RATIO);
        costMap.set(name, est);
      }
      continue;
    }

    // no override -> estimate by ratio + warn
    const price = Number(p?.variants?.[0]?.price || 0);
    const est = Math.round(price * DEFAULT_COST_RATIO);
    costMap.set(name, est);
    missingCostItems.add(name);
  }

  // ensure overrides apply even if not in products list
  for (const [k, vRaw] of Object.entries(ITEM_COST_OVERRIDES)) {
    const v = Number(vRaw);
    if (Number.isFinite(v) && v > 0) {
      costMap.set(k, v);
      missingCostItems.delete(k);
    } else {
      // <=0: coi như chưa khai
      if (!costMap.has(k)) {
        costMap.set(k, 0);
      }
      missingCostItems.add(k);
    }
  }

  return { costMap, missingCostItems };
}

async function loadAllInvoicesInRange({ fromDate, toDate }) {
  const rows = [];
  let cursor = null;
  const limitNum = 50;

  for (let guard = 0; guard < 200; guard++) {
    const res = await _client.listInvoicesByQuery({
      date: null,
      limitNum,
      cursor,
    });

    const batch = Array.isArray(res?.rows) ? res.rows : [];
    for (const r of batch) rows.push(r);

    cursor = res?.lastDoc || null;
    if (!cursor || batch.length === 0) break;
  }

  const from = parseYYYYMMDDStart(fromDate);
  const to = parseYYYYMMDDEnd(toDate);

  const filtered = rows.filter(r => {
    const d = r?.data || {};
    const dt = d.createdAtServer?.toDate ? d.createdAtServer.toDate() : null;
    if (!dt) return true;
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    return true;
  });

  return filtered.map(r => r.data).filter(Boolean);
}

/**
 * Core rules (NEW):
 * - Ship: ignore completely (khách trả)
 * - Discount: allocate proportional to ALL items subtotal (không có bán hộ)
 * - Every item must have unitCost (override hoặc ước lượng theo ratio)
 * - Overhead (base + expected extra) is per-invoice, allocated to ALL items
 *   proportional to net item revenue (after discount share)
 */
function computeStats({
  invoices,
  canceledCount = 0,
  costMap,
  missingCostItems,
  baseCostPerInvoice,
  extraEveryN,
  extraAvgCost,
}) {
  let invoiceCount = 0;

  let totalRevenueAllItems = 0;
  let totalRevenueIncluded = 0;
  let totalItemsCostIncluded = 0;
  let totalOverhead = 0;
  let totalProfitIncluded = 0;

  let totalShip = 0;
  let totalDiscount = 0;

  let totalPaidCash = 0;
  let totalPaidBank = 0;

  const expectedExtraPerInvoice = extraEveryN > 0 ? (extraAvgCost / extraEveryN) : 0;
  const perItem = new Map();

  for (const inv of invoices) {
    const paymentStatus = normalizePaymentStatus(inv?.paymentStatus, inv);
    if (paymentStatus !== 'paid') continue;

    invoiceCount++;

    const items = Array.isArray(inv.items) ? inv.items : [];
    const ship = Math.max(0, Number(inv.ship) || 0);
    const discount = Math.max(0, Number(inv.discount) || 0);
    const total = Math.max(0, Number(inv.total) || 0) - Math.max(0, Number(inv.ship) || 0);

    totalShip += ship;
    totalDiscount += discount;

    const paymentMethod = normalizePaymentMethod(inv?.paymentMethod);
    if (paymentMethod === 'cash') totalPaidCash += total;
    else totalPaidBank += total;

    let gross = 0;
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const sub = Math.max(0, Number(it.subtotal) || 0);
      if (qty <= 0 || sub <= 0) continue;
      gross += sub;
    }

    let netBase = 0;
    const normalized = [];

    for (const it of items) {
      const name = String(it?.name || '(Không tên)');
      const qty = Number(it.qty) || 0;
      const sub = Math.max(0, Number(it.subtotal) || 0);
      if (!name || qty <= 0 || sub <= 0) continue;

      const discountShare = gross > 0 ? (discount * (sub / gross)) : 0;
      const netSub = Math.max(0, sub - discountShare);

      normalized.push({ name, qty, sub, netSub });
      netBase += netSub;

      totalRevenueAllItems += netSub;
    }

    const orderOverhead = (Number(baseCostPerInvoice) || 0) + expectedExtraPerInvoice;
    const overheadToAllocate = netBase > 0 ? orderOverhead : 0;
    totalOverhead += overheadToAllocate;

    for (const x of normalized) {
      const { name, qty, netSub } = x;

      const unitCost = Number(costMap.get(name));
      const safeUnitCost = Number.isFinite(unitCost) && unitCost > 0 ? unitCost : 0;

      const cost = safeUnitCost * qty;
      const overheadShare = netBase > 0 ? (overheadToAllocate * (netSub / netBase)) : 0;
      const profit = netSub - cost - overheadShare;

      let row = perItem.get(name);
      if (!row) {
        row = { name, qty: 0, revenue: 0, cost: 0, overhead: 0, profit: 0 };
        perItem.set(name, row);
      }

      row.qty += qty;
      row.revenue += netSub;
      row.cost += cost;
      row.overhead += overheadShare;
      row.profit += profit;

      totalRevenueIncluded += netSub;
      totalItemsCostIncluded += cost;
      totalProfitIncluded += profit;
    }
  }

  const margin = totalRevenueIncluded > 0 ? (totalProfitIncluded / totalRevenueIncluded) : 0;
  const items = [...perItem.values()].sort((a, b) => (b.profit - a.profit));

  return {
    invoiceCount,
    canceledCount,

    totalRevenueAllItems,
    totalRevenueIncluded,
    totalItemsCostIncluded,
    totalOverhead,
    totalProfitIncluded,
    margin,

    totalShip,
    totalDiscount,
    expectedExtraPerInvoice,

    totalPaidCash,
    totalPaidBank,
    totalPaidAll: totalPaidCash + totalPaidBank,

    items,
    missingCostItems: Array.isArray(missingCostItems) ? missingCostItems : [...(missingCostItems || [])],
  };
}

function renderStats(res) {
  const summaryEl = document.getElementById('statsSummary');
  const warnEl = document.getElementById('statsWarnings');
  const tbody = document.getElementById('statsTableBody');
  const summaryWrap = document.getElementById('statsSummaryWrap');

  if (!summaryEl || !tbody) return;

  summaryEl.innerHTML = `
    <div class="stats-card">
      <div class="stats-card-label">Hoá đơn đã thanh toán</div>
      <div class="stats-card-value">${res.invoiceCount}</div>
    </div>
  
    <div class="stats-card">
      <div class="stats-card-label">Hoá đơn đã huỷ</div>
      <div class="stats-card-value">${res.canceledCount}</div>
    </div>
  
    <div class="stats-card highlight">
      <div class="stats-card-label">Tổng tiền đã thanh toán</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalPaidAll))} ₫</div>
    </div>
  
    <div class="stats-card">
      <div class="stats-card-label">Chuyển khoản</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalPaidBank))} ₫</div>
    </div>
  
    <div class="stats-card">
      <div class="stats-card-label">Tiền mặt</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalPaidCash))} ₫</div>
    </div>
  
    <div class="stats-card">
      <div class="stats-card-label">Tiền món sau giảm</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalRevenueAllItems))} ₫</div>
    </div>
  
    <div class="stats-card">
      <div class="stats-card-label">Doanh thu tính lãi</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalRevenueIncluded))} ₫</div>
    </div>
  
    <div class="stats-card profit">
      <div class="stats-card-label">Tổng lãi</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalProfitIncluded))} ₫</div>
      <div class="stats-card-sub">Biên lãi ~ ${(res.margin * 100).toFixed(1)}%</div>
    </div>
  
    <div class="stats-card soft">
      <div class="stats-card-label">Tiền ship</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalShip))} ₫</div>
    </div>
  
    <div class="stats-card soft">
      <div class="stats-card-label">Giảm giá</div>
      <div class="stats-card-value">${formatVND(Math.round(res.totalDiscount))} ₫</div>
    </div>
  
    <div class="stats-card soft">
      <div class="stats-card-label">Overhead / đơn</div>
      <div class="stats-card-value">${formatVND(Math.round(
        res.expectedExtraPerInvoice + parseRaw(document.getElementById('statsBaseCost')?.dataset?.raw || '0')
      ))} ₫</div>
    </div>
  `;

  const missing = (res.missingCostItems || []).filter(Boolean);
  if (warnEl) {
    if (missing.length) {
      warnEl.classList.remove('hidden');
      warnEl.innerHTML = `
        Có <strong>${missing.length}</strong> món <strong>chưa khai cost chuẩn</strong>.
        Hệ thống đang <strong>ước lượng theo DEFAULT_COST_RATIO</strong> để thống kê không bị sai về 0.
        Bạn nên điền dần vào <code>ITEM_COST_OVERRIDES</code>.
      `;
    } else {
      warnEl.classList.add('hidden');
      warnEl.textContent = '';
    }
  }

  if (!res.items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:10px;">Không có dữ liệu.</td></tr>`;
    return;
  }

  tbody.innerHTML = res.items.map(r => {
    const revenue = r.revenue || 0;
    const cost = r.cost || 0;
    const overhead = r.overhead || 0;
    const profit = r.profit || 0;
    const m = revenue > 0 ? (profit / revenue) : 0;

    return `
      <tr>
        <td style="padding:10px; border-bottom:1px solid #eef1f6;">
          ${escapeCell(r.name)}
        </td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;">${r.qty}</td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;">${formatVND(Math.round(revenue))} ₫</td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;">${formatVND(Math.round(cost))} ₫</td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;">${formatVND(Math.round(overhead))} ₫</td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;"><strong>${formatVND(Math.round(profit))} ₫</strong></td>
        <td style="padding:10px; text-align:right; border-bottom:1px solid #eef1f6;">${(m * 100).toFixed(1)}%</td>
      </tr>
    `;
  }).join('');
}

// ===== utils =====
function escapeCell(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setFormattedMoneyInput(id, initial) {
  const el = document.getElementById(id);
  if (!el) return;

  el.dataset.raw = String(initial || 0);
  el.value = formatVND(initial || 0);

  el.addEventListener('input', e => {
    const digits = (e.target.value || '').replace(/[^0-9]/g, '');
    const v = parseInt(digits, 10) || 0;
    e.target.dataset.raw = String(v);
    e.target.value = formatVND(v);
  });

  el.addEventListener('focus', e => {
    e.target.value = String(e.target.dataset.raw || '0');
    setTimeout(() => {
      try { e.target.setSelectionRange(e.target.value.length, e.target.value.length); } catch {}
    }, 0);
  });

  el.addEventListener('blur', e => {
    const v = parseRaw(e.target.value) || parseRaw(e.target.dataset.raw);
    e.target.dataset.raw = String(v);
    e.target.value = formatVND(v);
  });
}

function getTodayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYYYYMMDDStart(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function parseYYYYMMDDEnd(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function normalizePaymentStatus(value, invoice = null) {
  if (value === 'paid') return 'paid';

  // fallback cho dữ liệu cũ:
  // trước đây status=2 là đơn hoàn thành / đã xử lý xong,
  // chưa có field paymentStatus thì coi như đã thanh toán
  if (!value && Number(invoice?.status) === 2) {
    return 'paid';
  }

  return 'unpaid';
}

function normalizePaymentMethod(value) {
  return value === 'cash' ? 'cash' : 'bank';
}
