'use strict';

/* Núcleo: configuração, estado compartilhado e utilitários comuns. */

const SIDEBAR_KEY = 'encomendafacil_sidebar_collapsed_v1';

const supabaseConfig = window.ENCOMENDA_SUPABASE_CONFIG || {};

const supabaseClient = (window.supabase?.createClient && supabaseConfig.url && supabaseConfig.anonKey)
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null;

const STATUS = {
  pending: { label: 'Pendente', className: 'pending' },
  bought: { label: 'Comprado', className: 'bought' },
  shortage: { label: 'Em falta', className: 'shortage' }
};

const state = {
  role: 'loja',
  session: null,
  orders: [],
  stores: [],
  page: 'home',
  storeSearch: '',
  storeStatus: 'all',
  buyerSearch: '',
  buyerStatus: 'all',
  storeSelectedIds: new Set(),
  buyerSelectedIds: new Set(),
  sort: {
    store: { key: 'createdAt', direction: 'desc' },
    overview: { key: 'createdAt', direction: 'desc' }
  },
  reportFrom: '',
  reportTo: '',
  reportMonth: '',
  reportApplied: false,
  reportExportOrders: [],
  storeDirectorySearch: ''
};

const $ = (selector, root = document) => root.querySelector(selector);

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readOrders() {
  return state.orders;
}

function readStoreNames() {
  return Object.fromEntries(state.stores.map(store => [store.cnpj, store.nome]));
}

function getStoreName(cnpj) {
  const digits = String(cnpj || '').replace(/\D/g, '');
  const store = state.stores.find(item => item.cnpj === digits);
  return String(store?.nome || '').trim();
}

function resolveStoreName(order) {
  return getStoreName(order?.cnpj) || String(order?.storeName || '').trim() || 'Nome não cadastrado';
}

function mapDatabaseOrder(row) {
  const joinedStore = Array.isArray(row.lojas) ? row.lojas[0] : row.lojas;
  const store = joinedStore || state.stores.find(item => item.id === row.loja_id);
  return {
    id: String(row.id),
    lojaId: row.loja_id,
    cnpj: String(store?.cnpj || ''),
    storeName: String(store?.nome || ''),
    ean: String(row.ean || ''),
    product: String(row.produto || ''),
    qty: Number(row.quantidade || 0),
    status: STATUS[row.status] ? row.status : 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: ''
  };
}

async function loadRemoteData() {
  if (!supabaseClient || !state.session) throw new Error('A conexão com o Supabase não está configurada.');

  const { data: stores, error: storesError } = await supabaseClient
    .from('lojas')
    .select('id, cnpj, nome, ativo')
    .eq('ativo', true)
    .order('nome', { ascending: true });
  if (storesError) throw storesError;
  state.stores = stores || [];

  const { data: orders, error: ordersError } = await supabaseClient
    .from('encomendas')
    .select('id, loja_id, ean, produto, quantidade, status, created_at, updated_at, lojas(cnpj, nome)')
    .is('excluida_em', null)
    .order('created_at', { ascending: false })
    .range(0, 4999);
  if (ordersError) throw ordersError;
  state.orders = (orders || []).map(mapDatabaseOrder);
}

function readLegacyBrowserData() {
  try {
    const orders = JSON.parse(localStorage.getItem('encomendafacil_orders_v1') || '[]');
    const names = JSON.parse(localStorage.getItem('encomendafacil_store_names_v1') || '{}');
    return {
      orders: Array.isArray(orders) ? orders : [],
      names: names && typeof names === 'object' && !Array.isArray(names) ? names : {}
    };
  } catch (error) {
    console.warn('Não foi possível ler os dados antigos deste navegador:', error);
    return { orders: [], names: {} };
  }
}

function legacyMigrationAvailable() {
  if (localStorage.getItem('encomendafacil_legacy_migrated_v1') === 'true') return false;
  const legacy = readLegacyBrowserData();
  return legacy.orders.length > 0 || Object.keys(legacy.names).length > 0;
}

async function migrateLegacyBrowserData() {
  if (state.session?.role !== 'comprador') throw new Error('Entre como Comprador para migrar os dados antigos.');
  if (localStorage.getItem('encomendafacil_legacy_migrated_v1') === 'true') {
    toast('Os dados antigos deste navegador já foram migrados.');
    return;
  }

  const legacy = readLegacyBrowserData();
  if (!legacy.orders.length && !Object.keys(legacy.names).length) {
    toast('Não encontramos dados antigos neste navegador. A migração precisa ser feita no mesmo navegador e endereço usados pelo site anterior.', 'error');
    return;
  }

  const storeMap = new Map();
  Object.entries(legacy.names).forEach(([rawCnpj, rawName]) => {
    const cnpj = normalizeCnpj(rawCnpj);
    const nome = String(rawName || '').trim();
    if (cnpj && nome.length >= 2) storeMap.set(cnpj, nome);
  });
  legacy.orders.forEach(order => {
    const cnpj = normalizeCnpj(order?.cnpj);
    const nome = String(order?.storeName || '').trim();
    if (cnpj && nome.length >= 2 && !storeMap.has(cnpj)) storeMap.set(cnpj, nome);
  });

  if (storeMap.size) {
    const storesPayload = [...storeMap.entries()].map(([cnpj, nome]) => ({ cnpj, nome, ativo: true }));
    const { error } = await supabaseClient.from('lojas').upsert(storesPayload, { onConflict: 'cnpj' });
    if (error) throw error;
  }

  await loadRemoteData();
  const storeIds = new Map(state.stores.map(store => [store.cnpj, store.id]));
  const now = new Date().toISOString();
  const orderPayload = [];
  let skipped = 0;
  legacy.orders.forEach(order => {
    const cnpj = normalizeCnpj(order?.cnpj);
    const lojaId = storeIds.get(cnpj);
    const ean = String(order?.ean ?? '').trim();
    const produto = String(order?.product ?? order?.produto ?? '').trim().toLocaleUpperCase('pt-BR');
    const quantidade = Number(order?.qty ?? order?.qtd ?? order?.quantidade ?? 0);
    const status = STATUS[order?.status] ? order.status : 'pending';
    if (!lojaId || !ean || produto.length < 2 || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 99999) {
      skipped++;
      return;
    }
    orderPayload.push({
      loja_id: lojaId,
      ean,
      produto,
      quantidade,
      status,
      created_at: order?.createdAt && !Number.isNaN(new Date(order.createdAt).getTime()) ? new Date(order.createdAt).toISOString() : now,
      updated_at: order?.updatedAt && !Number.isNaN(new Date(order.updatedAt).getTime()) ? new Date(order.updatedAt).toISOString() : now
    });
  });

  if (orderPayload.length) {
    const { error } = await supabaseClient.from('encomendas').insert(orderPayload);
    if (error) throw error;
  }

  localStorage.setItem('encomendafacil_legacy_migrated_v1', 'true');
  await loadRemoteData();
  toast(`${storeMap.size} loja(s) e ${orderPayload.length} encomenda(s) migradas.${skipped ? ` ${skipped} registro(s) ignorado(s) por dados incompletos.` : ''}`);
  renderSettingsPage();
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options = withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return new Intl.DateTimeFormat('pt-BR', options).format(date);
}

function formatCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function toast(message, type = 'success') {
  const region = $('#toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'error' : ''}`;
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 3400);
}

function initialsFor(value, fallback = 'LJ') {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toLocaleUpperCase('pt-BR');
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `pedido-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getVisibleOrders() {
  return readOrders();
}

function statCard(label, value, foot, icon, tone = '') {
  return `<article class="stat-card ${tone}"><div class="stat-top"><span class="stat-label">${escapeHTML(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${value}</div><div class="stat-foot">${escapeHTML(foot)}</div></article>`;
}

function statusBadge(status) {
  const meta = STATUS[status] || STATUS.pending;
  return `<span class="status ${meta.className}">${meta.label}</span>`;
}

function emptyState(title, description) {
  return `<div class="empty-state"><div class="empty-icon">⌑</div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p></div>`;
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCnpj(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/e[+-]?\d+/i.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) raw = numeric.toFixed(0);
  }
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 14) digits = digits.slice(-14);
  if (digits.length > 0 && digits.length < 14) digits = digits.padStart(14, '0');
  return digits.length === 14 ? digits : '';
}

function restoreInputCursor(selector, position) {
  const input = $(selector);
  if (!input) return;
  input.focus();
  try { input.setSelectionRange(position, position); } catch (_) { /* input type may not support selection */ }
}
