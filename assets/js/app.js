import * as FB from './firebase-client.js';
import { getInvoiceClient } from './services/invoiceClient.js';

import { initPayment } from './modules/payment.js?v=2';
import { initInvoiceUI } from './modules/invoice-ui.js?v=2';
import { initInvoices, renderInvoiceList } from './modules/invoices.js?v=2';
import { initStats } from './modules/stats.js?v=2';
import { state } from './core/state.js';

// NOTE: products.js bạn đã tách thì import tại đây.
// Mình giả định products.js export: initProducts({RAW,FAV_INIT}), collectInvoiceItems(), resetQuantities(), calculateAll()
import * as products from './modules/products.js?v=2';

document.addEventListener('DOMContentLoaded', async () => {
  // Firebase init
  const firebaseConfig = {
    apiKey: "AIzaSyAc6yCnkNHJAHPCh70mM8lt2hixca2gZqI",
    authDomain: "goc6-f82e7.firebaseapp.com",
    projectId: "goc6-f82e7",
    storageBucket: "goc6-f82e7.appspot.com",
    messagingSenderId: "115228381542",
    appId: "1:115228381542:web:4a082d4056974ee11b38a7",
    measurementId: "G-TFMHB4DZNZ"
  };
  FB.initFirebase(firebaseConfig);

  // unify invoice client
  const client = getInvoiceClient(FB);

  // expose setUIMode globally nếu cần (invoices.js có fallback)
  window.setUIMode = setUIMode;

  // data
  const RAW = [
    ["Nem TCC",6000],
    ["Nem TCC xù",7000],
    ["Nem TCC vỏ giòn",7000],
    ["Nem TCC phomai",13000],
    ["Sống Nem TCC",4000],
    ["Sống Nem TCC xù",4200],
    ["Sống Nem TCC vỏ giòn",5200],
    ["Sống Nem TCC phomai",11000],
    ["Bánh rán mặn",9000],
    ["Bánh rán phomai",10000],,
    ["Bánh rán cốm dừa",10000],
    ["Khoai tây chiên",35000],
    ["Chân gà rút xương",80000],
    ["Bánh xèo nhật chay",30000],
    ["Gà chiên mắm",35000],
    ["Lạp xưởng",15000],
    ["Bánh gối",15000],
    ["Nem tảng 0.5kg",145000],
    ["Nem tảng 1kg",280000],
    ["Trà đá",7000],
    ["Trà quất",10000],
    ["Trà chanh",10000],
    ["Nước lọc",10000],
    ["Coca",15000],
    ["Sprite",15000],
    ["Thịt chưng mắm tép",70000],
    ["Bún thang chay",45000],
    ["Xôi nấm",45000],
    ["Ruốc nấm",70000],
    ["Xôi cốm",20000],
    ["Giò chay",120000],
    ["Cốm xào",20000],
    ["Hoa quả theo mùa",20000],
    ["Nộm đu đủ giã lạc",20000],
  ];
  const FAV_INIT = [
    "Nem TCC xù", "Nem TCC vỏ giòn", "Nem TCC phomai",
    "Bánh rán mặn", "Bánh rán phomai",
    "Chân gà rút xương", "Khoai tây chiên",
    "Trà quất", "Trà chanh", "Nước lọc", "Coca", "Sprite"
  ];

  // init modules
  products.initProducts({ RAW, FAV_INIT });
  initPayment();
  initInvoiceUI({ products });
  initInvoices({ client, products, setUIMode });
  initStats({ client, products });

  // top controls
  document.getElementById('showInvoicesBtn').onclick = () => setUIMode('invoices');
  document.getElementById('collapseBtn').onclick = () => setUIMode('items');
  document.getElementById('resetBtn').onclick = () => products.resetQuantities();

  // initial
  setUIMode('items');

  async function setUIMode(mode) {
    document.body.classList.remove('mode-items', 'mode-invoices');
    document.body.classList.add(`mode-${mode}`);

    if (mode === 'invoices') {
      await renderInvoiceList({ client, products });
    }
  }

  const showFavsBtn = document.getElementById('showFavsBtn');
  if (showFavsBtn) {
    // init UI state
    showFavsBtn.classList.toggle('active', state.filterFavsOnly);
    showFavsBtn.setAttribute('aria-pressed', String(state.filterFavsOnly));

    showFavsBtn.addEventListener('click', () => {
      const isInInvoices = document.body.classList.contains('mode-invoices');

      // giống logic bạn từng có: đang ở invoices thì bấm fav sẽ quay về items + bật lọc
      if (isInInvoices) {
        setUIMode('items');
        state.filterFavsOnly = true;
      } else {
        state.filterFavsOnly = !state.filterFavsOnly;
      }

      showFavsBtn.classList.toggle('active', state.filterFavsOnly);
      showFavsBtn.setAttribute('aria-pressed', String(state.filterFavsOnly));
      products.applyFilter();
    });
  }
});










