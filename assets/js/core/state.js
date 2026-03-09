export const state = {
  UI_MODE: 'items',
  invoiceLoadedOnce: false,

  currentInvoiceId: null,
  editingInvoiceData: null,
  invoiceUIMode: 'create', // 'create' | 'edit' | 'view'

  invoiceFilters: {
    status: 'all',   // all | 1 | 2 | 3
    date: null,      // yyyy-mm-dd
    limit: 10,
    page: 1,
  },

  invoicePaging: {
    currentCursor: null,
    nextCursor: null,
    cursorStack: [],
  },
};

