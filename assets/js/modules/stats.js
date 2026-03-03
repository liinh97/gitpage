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
  "Nem TCC": 3000,
  "Nem TCC xù": 3000,
  "Nem TCC vỏ giòn": 3000,
  "Nem TCC phomai": 0,     // ví dụ bán hộ
  "Bánh rán mặn": 0,       // ví dụ bán hộ
  "Bánh rán phomai": 0,    // ví dụ bán hộ
  "Khoai tây chiên": 0,
  "Chân gà rút xương": 0,
  "Bánh xèo nhật chay": 0,
  "Gà chiên mắm": 0,
  "Thịt chưng mắm tép": 0,
  "Bún thang chay": 0,
  "Xôi nấm": 0,
  "Ruốc nấm": 0,
  "Xôi cốm": 0,
  "Cốm xào": 0,
};

export function initStats({ client, products }) {
  _client = client;
  _products = products;

  const btn = document.getElementById('showStatisticalBtn');
  const backdrop = document.getElementById('statsBackdrop');
  const closeBtn = document.getElementById('closeStatsBtn');
  const runBtn = document.getElementById('runStatsBtn');

  if (!btn || !backdrop || !runBtn) return;

  // init inputs defaults
  setFormattedMoneyInput('statsBaseCost', DEFAULT_BASE_COST);
  setFormattedMoneyInput('statsExtraAvgCost', DEFAULT_EXTRA_AVG_COST);

  const extraEveryNEl = document.getElementById('statsExtraEveryN');
  if (extraEveryNEl) extraEveryNEl.value = String(DEFAULT_EXTRA_EVERY_N);

  // set ngay khi init
  setTodayRange();

  // OPEN: mỗi lần mở cũng reset về hôm nay
  btn.addEventListener('click', () => {
    setTodayRange();
    backdrop.classList.remove('hidden');
    backdrop.style.display = 'flex';
  });

  // OPEN (fix: remove hidden because .hidden is display:none!important)
  btn.addEventListener('click', () => {
    backdrop.classList.remove('hidden');
    backdrop.style.display = 'flex';
  });

  // CLOSE
  function close() {
    backdrop.style.display = 'none';
    backdrop.classList.add('hidden');
  }

  closeBtn?.addEventListener('click', close);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) close();
  });

  runBtn.addEventListener('click', async () => {
    await runStats();
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

  summaryEl.textContent = 'Đang tải hoá đơn đã thanh toán...';
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

  const paidInvoices = await loadAllInvoicesByStatus({ status: 2, fromDate, toDate });
  const canceledInvoices = await loadAllInvoicesByStatus({ status: 3, fromDate, toDate });

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

async function loadAllInvoicesByStatus({ status, fromDate, toDate }) {
  const rows = [];
  let cursor = null;
  const limitNum = 50;

  for (let guard = 0; guard < 200; guard++) {
    const res = await _client.listInvoicesByQuery({
      status: status,
      date: null,
      limitNum,
      cursor,
    });

    const batch = res?.rows || [];
    for (const r of batch) rows.push(r);

    cursor = res?.lastDoc || null;
    if (!cursor || batch.length === 0) break;
  }

  const filtered = rows.filter(r => {
    const d = r?.data || {};
    const dt = d.createdAtServer?.toDate ? d.createdAtServer.toDate() : null;
    if (!dt) return true;

    if (fromDate) {
      const [y, m, dd] = fromDate.split('-').map(Number);
      const from = new Date(y, m - 1, dd, 0, 0, 0, 0);
      if (dt < from) return false;
    }
    if (toDate) {
      const [y, m, dd] = toDate.split('-').map(Number);
      const to = new Date(y, m - 1, dd, 23, 59, 59, 999);
      if (dt > to) return false;
    }
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

  let totalRevenueAllItems = 0;     // tổng tiền món sau giảm (tất cả món)
  let totalRevenueIncluded = 0;     // giờ = totalRevenueAllItems (giữ tên cũ cho UI nếu muốn)
  let totalItemsCostIncluded = 0;
  let totalOverhead = 0;
  let totalProfitIncluded = 0;

  let totalShip = 0;
  let totalDiscount = 0;

  const expectedExtraPerInvoice = extraEveryN > 0 ? (extraAvgCost / extraEveryN) : 0;
  const perItem = new Map();

  for (const inv of invoices) {
    const status = Number(inv.status);
    if (status !== 2) continue;

    invoiceCount++;

    const items = Array.isArray(inv.items) ? inv.items : [];
    const ship = Math.max(0, Number(inv.ship) || 0);
    const discount = Math.max(0, Number(inv.discount) || 0);

    totalShip += ship;
    totalDiscount += discount;

    // (A) gross base for discount allocation: ALL items subtotal
    let gross = 0;
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const sub = Math.max(0, Number(it.subtotal) || 0);
      if (qty <= 0 || sub <= 0) continue;
      gross += sub;
    }

    // (B) compute net revenue per item after discount share, and sum base for overhead allocation
    let netBase = 0;
    const normalized = []; // cache per item in this invoice

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

    // (C) overhead per invoice
    const orderOverhead = (Number(baseCostPerInvoice) || 0) + expectedExtraPerInvoice;
    const overheadToAllocate = netBase > 0 ? orderOverhead : 0;
    totalOverhead += overheadToAllocate;

    // (D) aggregate per item
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

    items,
    missingCostItems: Array.isArray(missingCostItems) ? missingCostItems : [...(missingCostItems || [])],
  };
}

function renderStats(res) {
  const summaryEl = document.getElementById('statsSummary');
  const warnEl = document.getElementById('statsWarnings');
  const tbody = document.getElementById('statsTableBody');
  if (!summaryEl || !tbody) return;

  summaryEl.innerHTML = `
    <div>Hoá đơn đã thanh toán: <strong>${res.invoiceCount}</strong></div>
    <div>Hoá đơn đã huỷ: <strong>${res.canceledCount}</strong></div>

    <div style="margin-top:6px;">Tiền món sau giảm (tất cả món): <strong>${formatVND(Math.round(res.totalRevenueAllItems))} ₫</strong></div>
    <div>Doanh thu tính lãi (chỉ món cost > 0): <strong>${formatVND(Math.round(res.totalRevenueIncluded))} ₫</strong></div>
    <div>Tổng lãi (chỉ món cost > 0): <strong>${formatVND(Math.round(res.totalProfitIncluded))} ₫</strong>
      <span class="muted"> (biên lãi ~<strong>${(res.margin * 100).toFixed(1)}%</strong>)</span>
    </div>

    <div class="muted" style="margin-top:6px;">Tiền ship: <strong>${formatVND(Math.round(res.totalShip))} ₫</strong></div>
    <div class="muted">Giảm giá: <strong>${formatVND(Math.round(res.totalDiscount))} ₫</strong></div>
    <div class="muted">Overhead/đơn (base + phát sinh kỳ vọng): ~<strong>${formatVND(Math.round(res.expectedExtraPerInvoice + parseRaw(document.getElementById('statsBaseCost')?.dataset?.raw || '0')))} ₫</strong></div>
  `;

  // info: pass-through items
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
