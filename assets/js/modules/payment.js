import { formatVND, parseRaw } from '../core/utils.js';

const VIETQR_ENDPOINT = 'https://api.vietqr.io/v2/generate';
const VIETQR_CLIENT_ID = '3a7b7288-956c-46fa-a68e-4e641c564f42';
const VIETQR_API_KEY = 'd565ed27-724a-4618-a2ef-ea9822bc9efe';

export function initPayment() {
  document.querySelectorAll('input[name="payment_method"]').forEach(r => {
    r.addEventListener('change', () => {
      const totalText = document.getElementById('modal_total')?.textContent || '0';
      const total = parseRaw(totalText);
      const method = document.querySelector('input[name="payment_method"]:checked')?.value || 'cash';
      updatePaymentUI(method, total);
      if (method === 'qr' && total > 0) showQRCodeForAmount(total);
      else { clearQrContainer(); hideQrError(); }
    });
  });

  setupCashInput();
}

export function updatePaymentUI(method, totalAmount) {
  const qrC = document.getElementById('qrContainer');
  const cashC = document.getElementById('cashContainer');

  if (method === 'qr') {
    qrC?.classList.remove('hidden');
    cashC?.classList.add('hidden');

    const cashIn = document.getElementById('cash_given');
    if (cashIn) { cashIn.dataset.raw = 0; cashIn.value = formatVND(0); }
    document.getElementById('change_due') && (document.getElementById('change_due').textContent = formatVND(0) + 'đ');

  } else {
    qrC?.classList.add('hidden');
    cashC?.classList.remove('hidden');
    recalcChangeFromCash(totalAmount);
  }
}

export async function showQRCodeForAmount(amount) {
  const qrC = document.getElementById('qrContainer');
  hideQrError();
  if (qrC) qrC.innerHTML = `<div class="spinner"></div>`;

  try {
    const body = {
      accountNo: 8382220997058,
      accountName: "HO KINH DOANH GOC 6",
      acqId: 970422,
      amount,
      addInfo: "chuyen tien bang qr",
      format: "text",
      template: "compact"
    };

    // Ưu tiên ảnh QR cố định
    let qrImageLink = 'https://www.bigfootdigital.co.uk/wp-content/uploads/2020/07/image-optimisation-scaled.jpg';

    let qrDataURL = null;
    let qrCodeText = null;

    if (qrImageLink) {
      qrDataURL = qrImageLink;
      qrCodeText = 'chuyển tiền bằng qr';
    } else {
      const res = await fetch(VIETQR_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': VIETQR_CLIENT_ID,
          'x-api-key': VIETQR_API_KEY
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText || 'Error');
        throw new Error(`API lỗi: ${res.status} ${txt}`);
      }

      const json = await res.json();
      qrDataURL = json?.data?.qrDataURL ?? null;
      qrCodeText = json?.data?.qrCode ?? null;
    }

    if (qrDataURL && qrC) {
      qrC.innerHTML = `
        <img
          src="${qrDataURL}"
          alt="QR code"
          style="max-width:100%; max-height:100%; border-radius:6px; object-fit:contain"
        />
      `;
    } else if (qrCodeText && qrC) {
      qrC.innerHTML = `
        <img
          src="https://chart.googleapis.com/chart?cht=qr&chs=500x500&chl=${encodeURIComponent(qrCodeText)}"
          alt="QR code"
          style="max-width:100%; max-height:100%; border-radius:6px; object-fit:contain"
        />
      `;
    } else {
      throw new Error('Không nhận được dữ liệu QR từ server.');
    }
  } catch (err) {
    console.error('QR generation error:', err);
    if (qrC) qrC.innerHTML = '';
    showQrError(String(err.message || err));
  }
}

export function clearQrContainer() {
  const qrC = document.getElementById('qrContainer');
  if (qrC) qrC.innerHTML = '';
}

export function showQrError(msg) {
  const errBox = document.getElementById('qrError');
  if (errBox) {
    errBox.textContent = 'Không tạo được mã QR: ' + msg;
    errBox.classList.remove('hidden');
  }
  const qrC = document.getElementById('qrContainer');
  if (qrC) qrC.innerHTML = `<div class="muted" style="text-align:center">Mã QR không khả dụng</div>`;
}

export function hideQrError() {
  const errBox = document.getElementById('qrError');
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('hidden');
  }
}

function setupCashInput() {
  const el = document.getElementById('cash_given');
  if (!el) return;

  el.dataset.raw = parseRaw(el.value || el.dataset.raw);
  el.value = formatVND(parseRaw(el.dataset.raw));

  el.addEventListener('input', e => {
    const digits = (e.target.value || '').replace(/[^0-9]/g, '');
    const n = parseInt(digits) || 0;
    e.target.dataset.raw = n;
    e.target.value = formatVND(n);

    const totalText = document.getElementById('modal_total')?.textContent || '0';
    recalcChangeFromCash(parseRaw(totalText));
  });

  el.addEventListener('focus', e => {
    e.target.value = String(e.target.dataset.raw || '0');
    setTimeout(() => {
      try { e.target.setSelectionRange(e.target.value.length, e.target.value.length); } catch {}
    }, 0);
  });

  el.addEventListener('blur', e => {
    const n = parseRaw(e.target.value) || parseRaw(e.target.dataset.raw);
    e.target.dataset.raw = n;
    e.target.value = formatVND(n);

    const totalText = document.getElementById('modal_total')?.textContent || '0';
    recalcChangeFromCash(parseRaw(totalText));
  });
}

function recalcChangeFromCash(total) {
  const el = document.getElementById('cash_given');
  const given = el ? parseRaw(el.dataset.raw || el.value) : 0;
  const change = Math.max(0, given - (total || 0));
  const changeDue = document.getElementById('change_due');
  if (changeDue) changeDue.textContent = formatVND(change) + 'đ';
}

