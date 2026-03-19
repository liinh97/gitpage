import { state } from '../core/state.js';
import { formatVND, parseRaw, escapeHtml, getTodayYYYYMMDD } from '../core/utils.js';
import { showToast, openInvoiceModalFromInvoiceData, pickPaymentMethod } from './invoice-ui.js';

const INVOICE_STATUS_MAP = {
  1: { text: 'Đơn mới', class: 'st-new' },
  2: { text: 'Đã ra đơn', class: 'st-processing' },
  3: { text: 'Đã hoàn thành', class: 'st-done' },
  4: { text: 'Đã huỷ', class: 'st-cancel' },
};

const PAYMENT_STATUS_MAP = {
  unpaid: 'Chưa thanh toán',
  paid: 'Đã thanh toán',
};

const PAYMENT_METHOD_MAP = {
  bank: 'Chuyển khoản',
  cash: 'Tiền mặt',
};

let _client = null;
let _products = null;
let _setUIMode = null;
let _invoicesInitialized = false;

export function initInvoices({ client, products, setUIMode }) {
  if (!client?.listInvoicesByQuery) {
    console.warn('initInvoices: client.listInvoicesByQuery missing');
  }

  _client = client;
  _products = products;
  _setUIMode = typeof setUIMode === 'function' ? setUIMode : null;

  if (_invoicesInitialized) return;
  _invoicesInitialized = true;

  attachInvoiceFilterInit();
  attachInvoiceFilterHandlers({ client: _client, products: _products });
  attachInvoicePagingHandlers({ client: _client, products: _products });
  attachInvoiceTabHandlers({ client: _client, products: _products });
  attachSaveHandler({ client: _client, products: _products });
}

export async function renderInvoiceList({ client = _client, products = _products, resetPaging = false } = {}) {
  const listRoot = document.getElementById('invoiceList');
  const emptyEl = document.getElementById('invoiceListEmpty');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

  if (!listRoot) return;

  if (resetPaging) {
    resetInvoicePaging();
  }

  listRoot.innerHTML = '<div class="muted">Đang tải...</div>';
  emptyEl?.classList.add('hidden');

  try {
  if (typeof client.listInvoicesByQuery !== 'function') {
    throw new Error('Thiếu listInvoicesByQuery');
  }
  
  const queryCursor = state.invoicePaging.currentCursor || null;

  const queryParams = {
    date: state.invoiceFilters.date,
    limitNum: state.invoiceFilters.limit,
    cursor: queryCursor,
  };

  if (state.invoiceFilters.status === 1) {
    // Filter "Đơn mới" sẽ lấy cả đơn mới + đã ra đơn
    queryParams.statuses = [1, 2];
  } else if (state.invoiceFilters.status !== '' && state.invoiceFilters.status !== null) {
    queryParams.status = Number(state.invoiceFilters.status);
  }

  const res = await client.listInvoicesByQuery(queryParams);
  await renderPendingItemsSummaryByQuery({ client }).catch(() => {});

  listRoot.innerHTML = '';

  const rows = Array.isArray(res?.rows) ? res.rows : [];
  
  state.invoicePaging.nextCursor = res?.lastDoc || null;

  if (!rows.length) {
    emptyEl?.classList.remove('hidden');
    if (prevBtn) prevBtn.disabled = state.invoicePaging.cursorStack.length === 0;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  rows.forEach(row => {
    listRoot.appendChild(renderInvoiceRow({ row, client, products }));
  });

  if (prevBtn) prevBtn.disabled = state.invoicePaging.cursorStack.length === 0;
  if (nextBtn) nextBtn.disabled = !state.invoicePaging.nextCursor;

  } catch (err) {
    console.error(err);
    listRoot.innerHTML = `<div class="error">Không tải được hoá đơn: ${escapeHtml(err.message || String(err))}</div>`;
    if (prevBtn) prevBtn.disabled = state.invoicePaging.cursorStack.length === 0;
    if (nextBtn) nextBtn.disabled = true;
  }
}

function renderInvoiceRow({ row, client, products }) {
  const id = row.id;
  const d = row.data || {};

  const name = d.orderName || '(Không tên)';
  const created = d.createdAtServer?.toDate ? d.createdAtServer.toDate() : null;
  const time = created
    ? created.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : '';

  const total = (typeof d.total !== 'undefined') ? (formatVND(d.total) + ' ₫') : '-';

  const status = Number(d.status || 1);
  const statusInfo = INVOICE_STATUS_MAP[status] || { text: 'Không rõ', class: 'st-unknown' };

  const paymentStatus = normalizePaymentStatus(d.paymentStatus);
  const paymentMethod = normalizePaymentMethod(d.paymentMethod);
  const itemsSummary = buildInvoiceItemsSummary(d.items);

  const paymentStatusText = PAYMENT_STATUS_MAP[paymentStatus];
  const paymentMethodText = paymentStatus === 'paid'
    ? PAYMENT_METHOD_MAP[paymentMethod]
    : '';

  const isOpenInvoice = status === 1 || status === 2;

  const canEdit = isOpenInvoice;
  const canIssue = status === 1;
  const canMarkPaid = isOpenInvoice && paymentStatus !== 'paid';
  const canComplete = isOpenInvoice;
  const canCancel = isOpenInvoice;
  const canAddNote = status === 2 || status === 3;

  const el = document.createElement('div');
  el.className = 'item invoice-item';

  el.innerHTML = `
    <div class="invoice-header">
      <div class="name">${escapeHtml(name)}</div>
      <div class="price-badge">${escapeHtml(total)}</div>
    </div>
  
    ${itemsSummary ? `
      <div class="invoice-items-summary muted">
        ${escapeHtml(itemsSummary)}
      </div>
    ` : ''}
  
    <div class="invoice-footer">
      <div class="invoice-meta">
        <span class="muted">${escapeHtml(time)}</span>
        <span class="invoice-status ${statusInfo.class}">${statusInfo.text}</span>
        <span class="invoice-payment-status muted">${escapeHtml(paymentStatusText)}</span>
        ${paymentMethodText ? `<span class="invoice-payment-method muted">${escapeHtml(paymentMethodText)}</span>` : ''}
      </div>
  
      <div class="invoice-actions">
        ${canEdit ? `<button class="btn small-edit">Sửa</button>` : ''}
        ${canIssue ? `<button class="btn small-issue">Ra đơn</button>` : ''}
        ${canMarkPaid ? `<button class="btn small-pay">Thanh toán</button>` : ''}
        ${canComplete ? `<button class="btn small-complete">Hoàn thành</button>` : ''}
        ${canAddNote ? `<button class="btn small-note">Ghi chú</button>` : ''}
        ${canCancel ? `<button class="btn small-cancel">Huỷ</button>` : ''}
      </div>
    </div>
  
    ${d.note ? `<div class="invoice-note muted">📝 ${escapeHtml(d.note)}</div>` : ''}
  `;

  // VIEW
  el.addEventListener('click', async () => {
    state.invoiceUIMode = 'view';
    await openInvoiceDetail({ client, id, mode: 'view' });
  });

  // EDIT
  el.querySelector('.small-edit')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    state.invoiceUIMode = 'edit';
    await loadInvoiceToItems({ client, products, invoiceId: id });
  });

  // PAY ONLY
  el.querySelector('.small-pay')?.addEventListener('click', async (e) => {
    e.stopPropagation();

    const method = await pickPaymentMethod();
    if (!method) return;

    await markInvoicePaid({
      client,
      products,
      id,
      paymentMethod: method,
    });
  });

  // COMPLETE (bao gồm thanh toán nếu chưa thanh toán)
  el.querySelector('.small-complete')?.addEventListener('click', async (e) => {
    e.stopPropagation();

    let paymentMethod = null;

    if (paymentStatus !== 'paid') {
      paymentMethod = await pickPaymentMethod();
      if (!paymentMethod) return;
    }

    await completeInvoice({
      client,
      products,
      id,
      paymentMethod,
    });
  });

  // NOTE
  el.querySelector('.small-note')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    state.invoiceUIMode = 'edit';
    await openInvoiceDetail({ client, id, mode: 'note' });
  });

  // CANCEL
  el.querySelector('.small-cancel')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Xác nhận huỷ đơn?')) {
      await changeInvoiceStatus({ client, products, id, newStatus: 4 });
    }
  });

  // ISSUE
  el.querySelector('.small-issue')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await issueInvoice({ client, products, id });
  });

  return el;
}

function normalizePaymentStatus(value) {
  return value === 'paid' ? 'paid' : 'unpaid';
}

function normalizePaymentMethod(value) {
  return value === 'cash' ? 'cash' : 'bank';
}

function buildInvoiceItemsSummary(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';

  return items
    .map(item => {
      const name = (item?.name || '').trim();
      const qty = Number(item?.qty || 0);

      if (!name) return '';
      if (qty > 0) return `${name} x${qty}`;
      return name;
    })
    .filter(Boolean)
    .join(' - ');
}

async function loadInvoiceToItems({ client, products, invoiceId }) {
  if (typeof client.getInvoice !== 'function') return alert('Không lấy được hoá đơn');

  const res = await client.getInvoice(invoiceId);
  if (!res || !res.data) return alert('Hoá đơn không tồn tại');

  const invoice = res.data;
  state.currentInvoiceId = invoiceId;
  state.editingInvoiceData = invoice;

  // reset qty
  products.resetQuantities();

  // map items
  (invoice.items || []).forEach(invItem => {
    const itemEl = [...document.querySelectorAll('.product-item')]
      .find(el => el.dataset.name === invItem.name);
    if (!itemEl) return;

    const q = itemEl.querySelector('.qty-input');
    if (q) q.value = invItem.qty;
  });

  // fill ship/discount
  const shipEl = document.getElementById('ship_fee');
  if (shipEl) {
    shipEl.dataset.raw = invoice.ship || 0;
    shipEl.value = formatVND(invoice.ship || 0);
  }

  const discountEl = document.getElementById('discount');
  if (discountEl) {
    discountEl.dataset.raw = invoice.discount || 0;
    discountEl.value = formatVND(invoice.discount || 0);
  }

  // order name + note
  document.getElementById('order_name') && (document.getElementById('order_name').value = invoice.orderName || '');
  document.getElementById('invoice_note') && (document.getElementById('invoice_note').value = invoice.note || '');

  products.calculateAll();

  // về items mode
  if (_setUIMode) _setUIMode('items');
  else document.body.classList.remove('mode-invoices'), document.body.classList.add('mode-items');
}

async function openInvoiceDetail({ client, id, mode }) {
  if (typeof client.getInvoice !== 'function') return alert('Không thể lấy chi tiết hoá đơn');

  const res = await client.getInvoice(id);
  if (!res || !res.data) return alert('Không tìm thấy hoá đơn.');

  const data = res.data;
  const status = Number(data.status || 1);
  
  data.paymentStatus = normalizePaymentStatus(data.paymentStatus);
  data.paymentMethod = normalizePaymentMethod(data.paymentMethod);

  state.currentInvoiceId = id;

  // fill inputs
  document.getElementById('order_name') && (document.getElementById('order_name').value = data.orderName || '');
  document.getElementById('invoice_note') && (document.getElementById('invoice_note').value = data.note || '');

  openInvoiceModalFromInvoiceData(data);
  applyInvoiceMode({ status, mode });
}

function applyInvoiceMode({ status, mode }) {
  const orderInput = document.getElementById('order_name');
  const noteInput = document.getElementById('invoice_note');
  const saveBtn = document.getElementById('saveInvoiceBtn');

  if (!orderInput || !noteInput || !saveBtn) return;

  if (mode === 'view') {
    orderInput.disabled = true;
    noteInput.disabled = true;
    saveBtn.style.display = 'none';
    return;
  }

  if (status === 1 || status === 2) {
    orderInput.disabled = false;
    noteInput.disabled = false;
    saveBtn.style.display = '';
    saveBtn.textContent = 'Lưu hoá đơn';
    return;
  }

  if (mode === 'note' && status === 3) {
    orderInput.disabled = true;
    noteInput.disabled = false;
    saveBtn.style.display = '';
    saveBtn.textContent = 'Lưu ghi chú';
    return;
  }

  orderInput.disabled = true;
  noteInput.disabled = true;
  saveBtn.style.display = 'none';
} 

async function changeInvoiceStatus({ client, products, id, newStatus }) {
  try {
    if (typeof client.updateInvoiceStatus !== 'function') {
      throw new Error('Thiếu updateInvoiceStatus');
    }

    await client.signInAnonymouslyIfNeeded?.();
    await client.updateInvoiceStatus(id, newStatus);

    showToast('Cập nhật trạng thái thành công', 'success');
    resetInvoicePaging();
    await renderInvoiceList({ client, products }).catch(() => {});
  } catch (err) {
    console.error(err);
    showToast('Cập nhật trạng thái thất bại: ' + (err.message || err), 'error', 3200);
  }
}

function attachSaveHandler({ client, products }) {
  const btn = document.getElementById('saveInvoiceBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    await saveInvoiceFlow({ client, products });
  });
}

async function saveInvoiceFlow({ client, products }) {
  try {
    const saveBtn = document.getElementById('saveInvoiceBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Đang lưu...';
    }

    const items = products.collectInvoiceItems();
    const shipEl = document.getElementById('ship_fee');
    const discountEl = document.getElementById('discount');

    const ship = shipEl ? parseRaw(shipEl.dataset.raw || shipEl.value) : 0;
    const discount = discountEl ? parseRaw(discountEl.dataset.raw || discountEl.value) : 0;

    const totalText = document.getElementById('modal_total')?.textContent || '0';
    const total = parseRaw(totalText);

    const note = document.getElementById('invoice_note')?.value?.trim() || '';

    const orderInput = document.getElementById('order_name');
    const now = new Date();
    const defaultName =
      now.toLocaleTimeString('en-GB', { hour12: false }) + ' ' +
      now.toLocaleDateString('vi-VN').replace(/\//g, '-');

    const orderName = orderInput && orderInput.value.trim() ? orderInput.value.trim() : defaultName;

    await client.signInAnonymouslyIfNeeded?.();

    // UPDATE
    if (state.currentInvoiceId) {
      const existing = await client.getInvoice(state.currentInvoiceId);
      if (!existing || !existing.data) {
        alert('Hoá đơn không tồn tại hoặc đã bị xoá.');
        return;
      }

      const st = Number(existing.data.status);

      if (st === 1 || st === 2) {
        if (items.length === 0) {
          alert('Chưa có món nào để lưu.');
          return;
        }
      
        await client.updateInvoice(state.currentInvoiceId, {
          orderName,
          items,
          ship,
          discount,
          total,
          note,
        });
      } else if (st === 3) {
        await client.updateInvoice(state.currentInvoiceId, {
          note,
        });
      } else {
        alert('Hoá đơn đã huỷ, không thể sửa.');
        return;
      }

      alert('Cập nhật hoá đơn thành công.');
    }
    // CREATE
    else {
      if (items.length === 0) {
        alert('Chưa có món nào để lưu.');
        return;
      }

      const createdAt =
        now.toLocaleTimeString('en-GB', { hour12: false }) + ' ' +
        now.toLocaleDateString('vi-VN').replace(/\//g, '-');

      const payload = {
        orderName,
        createdAt,
        items,
        ship,
        discount,
        total,
        note,
        status: 1,
        paymentStatus: 'unpaid',
        paymentMethod: 'bank',
      };

      const saved = await client.saveInvoice(payload);
      state.currentInvoiceId = saved?.id || null;

      alert('Lưu hoá đơn thành công.');
    }

    // reset state + refresh list
    state.currentInvoiceId = null;
    await renderInvoiceList({ client, products, resetPaging: true }).catch(() => {});

  } catch (err) {
    console.error('saveInvoiceFlow error', err);
    alert('Lưu hoá đơn thất bại: ' + (err.message || err));
  } finally {
    const saveBtn = document.getElementById('saveInvoiceBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lưu hoá đơn';
    }
  }
}

function attachInvoiceTabHandlers({ client, products }) {
  const showInvoicesBtn = document.getElementById('showInvoicesBtn');
  const invoiceListPanel = document.getElementById('invoiceListPanel');
  const refreshBtn = document.getElementById('refreshInvoicesBtn');

  showInvoicesBtn?.addEventListener('click', async () => {
    if (!invoiceListPanel) return;
    const visible = invoiceListPanel.style.display !== 'none';
    invoiceListPanel.style.display = visible ? 'none' : 'block';
    showInvoicesBtn.setAttribute('aria-pressed', String(!visible));
    if (!visible) {
      resetInvoicePaging();
      await renderInvoiceList({ client, products });
    }
  });

  refreshBtn?.addEventListener('click', async () => {
    resetInvoicePaging();
    await renderInvoiceList({ client, products });
  });
}

function resetInvoicePaging() {
  state.invoiceFilters.page = 1;
  state.invoicePaging.currentCursor = null;
  state.invoicePaging.nextCursor = null;
  state.invoicePaging.cursorStack = [];
}

function attachInvoiceFilterInit() {
  state.invoiceFilters.date = getTodayYYYYMMDD();
  state.invoiceFilters.status = 1;
  state.invoiceFilters.limit = Number(document.getElementById('filterLimit')?.value || 10);
  state.invoiceFilters.page = 1;

  const dateEl = document.getElementById('filterDate');
  if (dateEl) dateEl.value = state.invoiceFilters.date || '';

  const statusEl = document.getElementById('filterStatus');
  if (statusEl) statusEl.value = String(state.invoiceFilters.status);

  const limitEl = document.getElementById('filterLimit');
  if (limitEl) limitEl.value = state.invoiceFilters.limit;

  document.getElementById('prevPageBtn') && (document.getElementById('prevPageBtn').disabled = true);
  document.getElementById('nextPageBtn') && (document.getElementById('nextPageBtn').disabled = true);
}

function attachInvoiceFilterHandlers({ client, products }) {
  document.getElementById('filterStatus')?.addEventListener('change', async (e) => {
    const raw = e.target.value;
    state.invoiceFilters.status = raw === '' ? '' : Number(raw);
    resetInvoicePaging();
    await renderInvoiceList({ client, products });
  });

  document.getElementById('filterDate')?.addEventListener('change', async (e) => {
    state.invoiceFilters.date = e.target.value || null;
    resetInvoicePaging();
    await renderInvoiceList({ client, products });
  });

  document.getElementById('filterLimit')?.addEventListener('change', async (e) => {
    state.invoiceFilters.limit = Number(e.target.value) || 10;
    resetInvoicePaging();
    await renderInvoiceList({ client, products });
  });
}

function attachInvoicePagingHandlers({ client, products }) {
  document.getElementById('nextPageBtn')?.addEventListener('click', async () => {
    const nextCursor = state.invoicePaging.nextCursor || null;
    if (!nextCursor) return;

    state.invoicePaging.cursorStack.push(state.invoicePaging.currentCursor || null);
    state.invoicePaging.currentCursor = nextCursor;
    state.invoiceFilters.page = (state.invoiceFilters.page || 1) + 1;

    await renderInvoiceList({ client, products });
  });

  document.getElementById('prevPageBtn')?.addEventListener('click', async () => {
    if (!state.invoicePaging.cursorStack.length) return;

    state.invoicePaging.currentCursor = state.invoicePaging.cursorStack.pop() || null;
    state.invoiceFilters.page = Math.max(1, (state.invoiceFilters.page || 1) - 1);

    await renderInvoiceList({ client, products });
  });
}

async function markInvoicePaid({ client, products, id, paymentMethod }) {
  try {
    await client.signInAnonymouslyIfNeeded?.();

    if (typeof client.getInvoice !== 'function') {
      throw new Error('Thiếu getInvoice');
    }

    const existing = await client.getInvoice(id);
    if (!existing || !existing.data) {
      throw new Error('Hoá đơn không tồn tại');
    }

    const invoice = existing.data || {};
    const currentStatus = Number(invoice.status || 1);

    if (currentStatus !== 1 && currentStatus !== 2) {
      throw new Error('Chỉ đơn đang mở mới được thanh toán');
    }

    if (typeof client.updateInvoice !== 'function') {
      throw new Error('Thiếu updateInvoice');
    }

    await client.updateInvoice(id, {
      paymentStatus: 'paid',
      paymentMethod: paymentMethod || 'bank',
      statusVersion: 2,
    });

    showToast(`Đã thanh toán: ${PAYMENT_METHOD_MAP[paymentMethod || 'bank']}`, 'success');
    resetInvoicePaging();
    await renderInvoiceList({ client, products }).catch(() => {});
  } catch (err) {
    console.error(err);
    showToast('Cập nhật thanh toán thất bại: ' + (err.message || err), 'error', 3200);
  }
}

async function issueInvoice({ client, products, id }) {
  try {
    await client.signInAnonymouslyIfNeeded?.();

    if (typeof client.getInvoice !== 'function') {
      throw new Error('Thiếu getInvoice');
    }

    const existing = await client.getInvoice(id);
    if (!existing || !existing.data) {
      throw new Error('Hoá đơn không tồn tại');
    }

    const invoice = existing.data || {};
    const currentStatus = Number(invoice.status || 1);

    if (currentStatus !== 1) {
      throw new Error('Chỉ đơn mới mới có thể ra đơn');
    }

    await client.updateInvoice(id, {
      status: 2,
    });

    showToast('Đã cập nhật trạng thái ra đơn', 'success');
    resetInvoicePaging();
    await renderInvoiceList({ client, products }).catch(() => {});
  } catch (err) {
    console.error(err);
    showToast('Ra đơn thất bại: ' + (err.message || err), 'error', 3200);
  }
}

async function completeInvoice({ client, products, id, paymentMethod = null }) {
  try {
    await client.signInAnonymouslyIfNeeded?.();

    if (typeof client.getInvoice !== 'function') {
      throw new Error('Thiếu getInvoice');
    }

    const existing = await client.getInvoice(id);
    if (!existing || !existing.data) {
      throw new Error('Hoá đơn không tồn tại');
    }

    const invoice = existing.data || {};
    const currentStatus = Number(invoice.status || 1);
    const currentPaymentStatus = normalizePaymentStatus(invoice.paymentStatus);

    if (currentStatus !== 1 && currentStatus !== 2) {
      throw new Error('Chỉ đơn đang mở mới có thể hoàn thành');
    }

    if (typeof client.updateInvoice !== 'function') {
      throw new Error('Thiếu updateInvoice');
    }

    const payload = {
      status: 3,
      statusVersion: 2,
    };

    // Nếu chưa thanh toán thì hoàn thành sẽ tự thanh toán
    if (currentPaymentStatus !== 'paid') {
      payload.paymentStatus = 'paid';
      payload.paymentMethod = paymentMethod || 'bank';
    } else {
      payload.paymentStatus = 'paid';
      payload.paymentMethod = normalizePaymentMethod(invoice.paymentMethod);
    }

    await client.updateInvoice(id, payload);

    showToast('Đã chuyển đơn sang hoàn thành', 'success');
    resetInvoicePaging();
    await renderInvoiceList({ client, products }).catch(() => {});
  } catch (err) {
    console.error(err);
    showToast('Hoàn thành đơn thất bại: ' + (err.message || err), 'error', 3200);
  }
}

function aggregatePendingItems(rows = []) {
  const itemMap = {};

  rows.forEach(row => {
    const d = row.data || {};
    const status = Number(d.status || 1);

    if (status !== 1) return;

    const items = Array.isArray(d.items) ? d.items : [];
    items.forEach(item => {
      const name = (item?.name || '').trim();
      const qty = Number(item?.qty || 0);

      if (!name || qty <= 0) return;

      if (!itemMap[name]) {
        itemMap[name] = {
          name,
          qty: 0,
        };
      }

      itemMap[name].qty += qty;
    });
  });

  const menuOrder = [...document.querySelectorAll('.product-item')]
    .map((el, index) => ({
      name: (el.dataset.name || '').trim(),
      index,
    }))
    .filter(x => x.name);

  const orderMap = new Map(menuOrder.map(x => [x.name, x.index]));

  return Object.values(itemMap).sort((a, b) => {
    const aIndex = orderMap.has(a.name) ? orderMap.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.has(b.name) ? orderMap.get(b.name) : Number.MAX_SAFE_INTEGER;

    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.name.localeCompare(b.name, 'vi');
  });
}

function renderPendingItemsSummary(rows = []) {
  const root = document.getElementById('pendingItemsSummary');
  if (!root) return;

  const aggregated = aggregatePendingItems(rows);

  if (!aggregated.length) {
    root.innerHTML = `
      <div class="issued-summary-card">
        <div class="issued-summary-title">Các món cần làm tiếp theo</div>
        <div class="muted">Không có món nào đang chờ ra đơn.</div>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="issued-summary-card">
      <div class="issued-summary-title">Các món cần làm tiếp theo</div>
      <div class="issued-summary-list">
        ${aggregated.map(item => `
          <span class="issued-summary-item">
            <span class="issued-summary-name">${escapeHtml(item.name)}</span>
            <span class="issued-summary-qty">x${item.qty}</span>
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

async function renderPendingItemsSummaryByQuery({ client }) {
  const root = document.getElementById('pendingItemsSummary');
  if (!root) return;

  try {
    const res = await client.listInvoicesByQuery({
      date: state.invoiceFilters.date,
      status: 1,
      limitNum: 200,
      cursor: null,
    });

    const rows = Array.isArray(res?.rows) ? res.rows : [];
    renderPendingItemsSummary(rows);
  } catch (err) {
    console.error(err);
    root.innerHTML = `
      <div class="issued-summary-card">
        <div class="issued-summary-title">Các món cần làm tiếp theo</div>
        <div class="error">Không tải được danh sách món cần làm</div>
      </div>
    `;
  }
}