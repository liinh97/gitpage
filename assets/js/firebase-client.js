// assets/js/firebase-client.js
// Firebase helper (Firestore) — module ES
// Usage:
// import * as FB from './firebase-client.js';
// FB.initFirebase(firebaseConfig);
// await FB.signInAnonymouslyIfNeeded();
// const saved = await FB.saveInvoice(metadata); // { id, ref }
// const rows = await FB.listInvoices({ limit: 20 });

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  where,
  Timestamp,
  startAfter
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

let app = null;
let auth = null;
let db = null;
let lastInitConfig = null;

export function initFirebase(firebaseConfig) {
  if (!firebaseConfig) throw new Error('firebaseConfig required');
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  auth = getAuth(app);
  db = getFirestore(app);
  lastInitConfig = firebaseConfig;
  return { app, auth, db };
}

export function ensureInit(firebaseConfig) {
  if (!app) return initFirebase(firebaseConfig);
  return { app, auth, db };
}

export async function signInAnonymouslyIfNeeded() {
  if (!auth) throw new Error('Firebase not initialized. Call initFirebase() first.');
  if (auth.currentUser) return auth.currentUser;

  await signInAnonymously(auth);

  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        unsub();
        resolve(user);
      }
    });
  });
}

/**
 * saveInvoice(metadata)
 * metadata should be object: { orderName, createdAt, items, ship, discount, total, status }
 * returns { id, ref }
 */
export async function saveInvoice(metadata) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  if (!metadata || typeof metadata !== 'object') throw new Error('metadata required');
  const col = collection(db, 'invoices');
  const payload = {
    ...metadata,
    createdAtServer: serverTimestamp()
  };
  const ref = await addDoc(col, payload);
  return { id: ref.id, ref };
}

/* =========================
   HELPERS
========================= */
export function getDayRange(dateStr) {
  const start = new Date(dateStr);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  };
}

/* =========================
   LIST INVOICES (QUERY)
========================= */
export async function listInvoicesByQuery({
  status = 'all',
  statuses = null,
  date = null,
  limitNum = 10,
  cursor = null,
}) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');

  const constraints = [];

  if (date) {
    const { start, end } = getDayRange(date);
    constraints.push(
      where('createdAtServer', '>=', start),
      where('createdAtServer', '<', end)
    );
  }

  if (Array.isArray(statuses) && statuses.length > 0) {
    const normalized = statuses
      .map(v => Number(v))
      .filter(v => !Number.isNaN(v));

    if (normalized.length > 0) {
      constraints.push(where('status', 'in', normalized));
    }
  } else if (status !== 'all' && status !== '' && status !== null && typeof status !== 'undefined') {
    const s = Number(status);
    if (!Number.isNaN(s)) {
      constraints.push(where('status', '==', s));
    }
  }

  constraints.push(orderBy('createdAtServer', 'desc'));

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  constraints.push(limit(Number(limitNum) || 10));

  const q = query(collection(db, 'invoices'), ...constraints);
  const snap = await getDocs(q);

  return {
    rows: snap.docs.map(d => ({ id: d.id, data: d.data() })),
    lastDoc: snap.docs.at(-1) || null,
  };
}

/**
 * listInvoices({ limit = 20, whereClause })
 * returns array [{ id, data }]
 */
export async function listInvoices(opts = {}) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  const lim = Number(opts.limit) || 10;
  const col = collection(db, 'invoices');
  let q = query(col, orderBy('createdAtServer', 'desc'), limit(lim));
  // optional where filter (caller can pass opts.where = { field, op, value })
  if (opts.where && opts.where.field) {
    q = query(col, where(opts.where.field, opts.where.op || '==', opts.where.value), orderBy('createdAtServer', 'desc'), limit(lim));
  }
  const snap = await getDocs(q);
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, data: d.data() }));
  return rows;
}

/**
 * getInvoice(id) -> { id, data }
 */
export async function getInvoice(id) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  if (!id) throw new Error('id required');
  const dref = doc(db, 'invoices', id);
  const snap = await getDoc(dref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() };
}

/**
 * updateInvoice(id, data)
 * full update of document (partial fields allowed) — Firestore rules must allow it.
 */
export async function updateInvoice(id, data) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  if (!id) throw new Error('id required');
  if (!data || typeof data !== 'object') throw new Error('data required');
  const dref = doc(db, 'invoices', id);
  const payload = { ...data, updatedAtServer: serverTimestamp() };
  await updateDoc(dref, payload);
  return { id };
}

/**
 * updateInvoiceStatus(id, status)
 * status should be numeric 1|2|3|4
 */
export async function updateInvoiceStatus(id, status) {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  if (!id) throw new Error('id required');
  const s = Number(status);
  if (![1,2,3,4].includes(s)) throw new Error('Invalid status');
  const dref = doc(db, 'invoices', id);
  await updateDoc(dref, { status: s, updatedAtServer: serverTimestamp() });
  return { id, status: s };
}

/**
 * Expose globally for non-module code if needed
 */
window.FBClient = window.FBClient || {};
Object.assign(window.FBClient, {
  initFirebase,
  ensureInit,
  signInAnonymouslyIfNeeded,
  saveInvoice,
  listInvoices,
  listInvoicesByQuery,
  getInvoice,
  updateInvoice,
  updateInvoiceStatus
});

console.log('[firebase-client] loaded — Firestore helpers exposed as window.FBClient');
