import { formatVND, parseRaw, escapeHtml } from '../core/utils.js';
import { clearQrContainer, hideQrError, updatePaymentUI, showQRCodeForAmount } from './payment.js';

export function initInvoiceUI({ products }) {
  const modalBackdrop = document.getElementById('modalBackdrop');

  // click outside close
  modalBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeInvoiceModal();
  });

  // ESC close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop && modalBackdrop.style.display === 'flex') {
      closeInvoiceModal();
    }
  });

  document.getElementById('closeModal')?.addEventListener('click', closeInvoiceModal);

  // open from bottom button
  document.getElementById('collapseBtn')?.addEventListener('click', () => {
    openInvoiceModalFromCurrentSelection({ products });
  });
}

export function openInvoiceModalFromCurrentSelection({ products }) {
  const listEl = document.getElementById('compactList');
  if (!listEl) return;

  listEl.innerHTML = '';

  const items = products.collectInvoiceItems();
  let total = 0;

  items.forEach((it, idx) => {
    total += it.subtotal;
    const row = document.createElement('div');
    row.className = 'line';
    row.innerHTML = `
      <div style="flex:1">${idx + 1}. ${escapeHtml(it.name)} x${it.qty}</div>
      <div style="min-width:90px; text-align:right">${formatVND(it.subtotal)} ₫</div>
    `;
    listEl.appendChild(row);
  });

  if (!items.length) {
    listEl.innerHTML = `<div class="muted">Chưa có món nào được chọn.</div>`;
  }

  const shipEl = document.getElementById('ship_fee');
  const discountEl = document.getElementById('discount');
  const ship = shipEl ? parseRaw(shipEl.dataset.raw || shipEl.value) : 0;
  const discount = discountEl ? parseRaw(discountEl.dataset.raw || discountEl.value) : 0;

  document.getElementById('modal_ship').textContent = formatVND(ship) + 'đ';
  document.getElementById('modal_discount').textContent = formatVND(discount) + 'đ';

  const grand = Math.max(0, total + ship - discount);
  document.getElementById('modal_total').textContent = formatVND(grand) + 'đ';

  // payment area setup
  const selectedMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'cash';
  updatePaymentUI(selectedMethod, grand);

  if (selectedMethod === 'qr' && grand > 0) showQRCodeForAmount(grand);
  else { clearQrContainer(); hideQrError(); }

  // show
  const modalBackdrop = document.getElementById('modalBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'flex';

  // default show save button (invoices.js sẽ override theo mode)
  document.getElementById('saveInvoiceBtn').style.display = 'block';
  document.getElementById('closeModal')?.focus();
}

export function openInvoiceModalFromInvoiceData(invoiceData) {
  const listEl = document.getElementById('compactList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const items = Array.isArray(invoiceData.items) ? invoiceData.items : [];
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'line';
    row.innerHTML = `
      <div style="flex:1">${idx + 1}. ${escapeHtml(it.name)} x${it.qty}</div>
      <div style="min-width:90px; text-align:right">${formatVND(it.subtotal || 0)} ₫</div>
    `;
    listEl.appendChild(row);
  });

  document.getElementById('modal_ship').textContent = formatVND(invoiceData.ship || 0) + 'đ';
  document.getElementById('modal_discount').textContent = formatVND(invoiceData.discount || 0) + 'đ';

  const grand = Number(invoiceData.total || 0) || Math.max(
    0,
    items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0) + (Number(invoiceData.ship) || 0) - (Number(invoiceData.discount) || 0)
  );

  document.getElementById('modal_total').textContent = formatVND(Math.max(0, grand)) + 'đ';

  const selectedMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'cash';
  updatePaymentUI(selectedMethod, grand);

  if (selectedMethod === 'qr' && grand > 0) showQRCodeForAmount(grand);
  else { clearQrContainer(); hideQrError(); }

  const modalBackdrop = document.getElementById('modalBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'flex';

  document.getElementById('closeModal')?.focus();
}

export function closeInvoiceModal() {
  // reset cash
  const cashIn = document.getElementById('cash_given');
  if (cashIn) { cashIn.dataset.raw = 0; cashIn.value = formatVND(0); }
  const changeDue = document.getElementById('change_due');
  if (changeDue) changeDue.textContent = formatVND(0) + 'đ';

  const modalBackdrop = document.getElementById('modalBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';

  clearQrContainer();
  hideQrError();
}

let toastRoot = null;
let toastStyleInjected = false;

function ensureToastRoot() {
  if (toastRoot) return toastRoot;

  toastRoot = document.getElementById('appToastRoot');
  if (toastRoot) return toastRoot;

  toastRoot = document.createElement('div');
  toastRoot.id = 'appToastRoot';
  toastRoot.className = 'app-toast-root';
  document.body.appendChild(toastRoot);

  return toastRoot;
}

function ensureToastStyles() {
  if (toastStyleInjected) return;
  toastStyleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .app-toast-root {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: min(360px, calc(100vw - 24px));
    }

    .app-toast {
      pointer-events: auto;
      min-width: 220px;
      max-width: 360px;
      padding: 12px 14px;
      border-radius: 12px;
      color: #fff;
      font-size: 14px;
      line-height: 1.45;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      opacity: 0;
      transform: translateY(-8px);
      animation: toast-in 0.2s ease forwards;
    }

    .app-toast.success {
      background: #16a34a;
    }

    .app-toast.error {
      background: #dc2626;
    }

    .app-toast.info {
      background: #2563eb;
    }

    .app-toast.hide {
      animation: toast-out 0.25s ease forwards;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes toast-out {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-8px);
      }
    }
  `;
  document.head.appendChild(style);
}

export function showToast(message, type = 'success', duration = 2200) {
  ensureToastStyles();
  const root = ensureToastRoot();

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.textContent = message;

  root.appendChild(toast);

  const hideTimer = window.setTimeout(() => {
    toast.classList.add('hide');

    window.setTimeout(() => {
      toast.remove();
    }, 250);
  }, duration);

  toast.addEventListener('click', () => {
    window.clearTimeout(hideTimer);
    toast.classList.add('hide');

    window.setTimeout(() => {
      toast.remove();
    }, 250);
  });

  return toast;
}
