'use strict';

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
    overview: { key: 'createdAt', direction: 'desc' },
    report: { key: 'createdAt', direction: 'desc' }
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

function showAuthenticatedApp() {
  state.page = 'home';
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  renderApp();
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

function setLoginRole(role) {
  state.role = role;
  $$('.role-option').forEach(button => {
    const active = button.dataset.role === role;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const label = $('#loginIdLabel');
  const idInput = $('#loginId');
  const hint = $('#loginHint');
  const forgot = $('#forgotPasswordButton');
  if (role === 'loja') {
    label.textContent = 'CNPJ da loja';
    idInput.type = 'text';
    idInput.placeholder = '00.000.000/0000-00';
    idInput.inputMode = 'numeric';
    idInput.autocomplete = 'username';
    hint.innerHTML = '<strong>Acesso da loja</strong><span>Informe o CNPJ da sua loja e utilize a senha global fornecida pela empresa.</span>';
    if (forgot) forgot.classList.add('hidden');
  } else {
    label.textContent = 'E-mail do comprador';
    idInput.type = 'email';
    idInput.placeholder = 'comprador@empresa.com.br';
    idInput.inputMode = 'email';
    idInput.autocomplete = 'username';
    hint.innerHTML = '<strong>Acesso do comprador</strong><span>Entre com seu e-mail e senha cadastrados.</span>';
    if (forgot) forgot.classList.remove('hidden');
  }
  idInput.value = '';
  $('#loginPassword').value = '';
  $('#loginError').textContent = '';
}

async function handleLogin(event) {
  event.preventDefault();
  const enteredId = $('#loginId').value.trim();
  const password = $('#loginPassword').value;
  const submit = $('#loginForm button[type="submit"]');
  const errorBox = $('#loginError');
  errorBox.textContent = '';

  if (!supabaseClient) {
    errorBox.textContent = 'Configure a URL e a chave pública do Supabase no arquivo supabase-config.js.';
    return;
  }
  if (!enteredId || !password) {
    errorBox.textContent = 'Preencha seu acesso e sua senha.';
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Conectando...';
  try {
    await supabaseClient.auth.signOut().catch(() => {});

    if (state.role === 'loja') {
      const cnpj = enteredId.replace(/\D/g, '');
      if (cnpj.length !== 14) throw new Error('Digite um CNPJ com 14 números.');
      const { error: authError } = await supabaseClient.auth.signInAnonymously();
      if (authError) throw new Error(`Não foi possível iniciar a sessão da loja: ${authError.message}`);

      const { data, error } = await supabaseClient.rpc('entrar_como_loja', {
        p_cnpj: cnpj,
        p_senha: password
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'CNPJ ou senha incorretos.');

      state.session = {
        role: 'loja',
        cnpj: data.cnpj || cnpj,
        lojaId: data.loja_id,
        displayName: data.nome || 'Sua loja'
      };
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: enteredId.toLowerCase(),
        password
      });
      if (error) throw new Error('E-mail ou senha incorretos. Confira os dados e tente novamente.');

      const { data: profile, error: profileError } = await supabaseClient
        .from('perfis')
        .select('id, nome, perfil')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.perfil !== 'comprador') {
        await supabaseClient.auth.signOut();
        throw new Error('Este usuário não possui perfil de Comprador autorizado.');
      }
      state.session = {
        role: 'comprador',
        userId: data.user.id,
        email: data.user.email,
        displayName: profile.nome || data.user.email
      };
    }

    await loadRemoteData();
    showAuthenticatedApp();
  } catch (error) {
    console.error('Falha no login:', error);
    state.session = null;
    await supabaseClient.auth.signOut().catch(() => {});
    errorBox.textContent = error.message || 'Não foi possível entrar. Tente novamente.';
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Entrar <span>→</span>';
  }
}

async function sendBuyerPasswordRecovery() {
  const email = $('#loginId').value.trim().toLowerCase();
  const errorBox = $('#loginError');
  errorBox.textContent = '';
  if (!supabaseClient) {
    errorBox.textContent = 'Configure primeiro a conexão com o Supabase.';
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorBox.textContent = 'Informe o e-mail do Comprador para receber o link de recuperação.';
    return;
  }
  const button = $('#forgotPasswordButton');
  button.disabled = true;
  try {
    const redirectTo = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}redefinir-senha.html`;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    toast('Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.');
    errorBox.textContent = 'Solicitação enviada. Verifique sua caixa de entrada e também o spam.';
  } catch (error) {
    console.error('Falha ao solicitar recuperação:', error);
    errorBox.textContent = error.message || 'Não foi possível solicitar a recuperação.';
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut().catch(error => console.warn('Falha ao encerrar sessão:', error));
  state.session = null;
  state.orders = [];
  state.stores = [];
  state.page = 'home';
  state.storeSelectedIds.clear();
  state.buyerSelectedIds.clear();
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginPassword').value = '';
  $('#loginError').textContent = '';
  setLoginRole('loja');
}

async function restoreSession() {
  if (!supabaseClient) return;
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!session) return;

    const { data: profile, error: profileError } = await supabaseClient
      .from('perfis')
      .select('id, nome, perfil, loja_id')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.perfil === 'comprador' && !session.user.is_anonymous) {
      state.session = {
        role: 'comprador',
        userId: session.user.id,
        email: session.user.email,
        displayName: profile.nome || session.user.email
      };
    } else if (profile?.perfil === 'loja' && session.user.is_anonymous) {
      const { data: store, error: storeError } = await supabaseClient
        .from('lojas')
        .select('id, cnpj, nome')
        .eq('id', profile.loja_id)
        .maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Cadastro da loja não encontrado.');
      state.session = { role: 'loja', cnpj: store.cnpj, lojaId: store.id, displayName: store.nome };
    } else {
      await supabaseClient.auth.signOut();
      return;
    }

    await loadRemoteData();
    showAuthenticatedApp();
  } catch (error) {
    console.error('Falha ao restaurar sessão:', error);
    await supabaseClient.auth.signOut().catch(() => {});
  }
}

function getVisibleOrders() {
  return readOrders();
}

function getPageConfig() {
  if (state.session.role === 'loja') {
    return [{ id: 'home', label: 'Visão geral', icon: '⌂' }];
  }
  return [
    { id: 'home', label: 'Visão geral', icon: '⌂' },
    { id: 'reports', label: 'Relatórios', icon: '▥' },
    { id: 'settings', label: 'Configurações', icon: '⚙' }
  ];
}

function applySidebarPreference() {
  const collapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';
  $('#appView').classList.toggle('sidebar-collapsed', collapsed && window.innerWidth > 760);
  updateMenuButton();
}

function updateMenuButton() {
  const button = $('#menuToggleButton');
  if (!button) return;
  const mobileOpen = $('#sidebar').classList.contains('open');
  const collapsed = $('#appView').classList.contains('sidebar-collapsed');
  const expanded = window.innerWidth <= 760 ? mobileOpen : !collapsed;
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Recolher ou fechar menu' : 'Mostrar ou expandir menu');
  button.title = expanded ? 'Recolher ou fechar menu' : 'Mostrar ou expandir menu';
}

function renderApp() {
  if (!state.session) return;
  const session = state.session;
  const isBuyer = session.role === 'comprador';
  const storeName = isBuyer ? '' : getStoreName(session.cnpj);
  const displayName = isBuyer ? (session.displayName || 'Comprador') : (storeName || session.displayName || 'Sua loja');
  const initials = isBuyer ? initialsFor(displayName, 'CO') : initialsFor(storeName, 'LJ');
  const nav = getPageConfig();
  if (!nav.some(item => item.id === state.page)) state.page = 'home';

  $('#profileName').textContent = displayName;
  $('#profileRole').textContent = isBuyer ? 'Comprador' : `Loja · ${formatCnpj(session.cnpj)}`;
  $('#profileAvatar').textContent = initials;
  $('#topAvatar').textContent = initials;
  $('#todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());

  $('#sideNav').innerHTML = nav.map(item => {
    const active = state.page === item.id;
    return `<button type="button" class="nav-item ${active ? 'active' : ''}" data-page="${item.id}" title="${escapeHTML(item.label)}" aria-current="${active ? 'page' : 'false'}"><span class="nav-icon">${item.icon}</span><span class="nav-label">${escapeHTML(item.label)}</span></button>`;
  }).join('');
  $$('.nav-item').forEach(button => button.addEventListener('click', () => {
    state.page = button.dataset.page;
    $('#sidebar').classList.remove('open');
    if (window.innerWidth > 760) {
      $('#appView').classList.add('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_KEY, 'true');
    }
    state.storeSelectedIds.clear();
    state.buyerSelectedIds.clear();
    renderApp();
  }));

  const current = nav.find(item => item.id === state.page) || nav[0];
  $('#breadcrumbCurrent').textContent = current.label;
  applySidebarPreference();
  if (isBuyer) {
    if (state.page === 'reports') renderBuyerReports(readOrders());
    else if (state.page === 'settings') renderSettingsPage();
    else renderBuyerOverview(readOrders());
  } else renderStorePage();
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

function renderStorePage() {
  const allOrders = getVisibleOrders();
  const search = state.storeSearch.toLocaleLowerCase('pt-BR').trim();
  const filtered = allOrders.filter(order => {
    const matchesStatus = state.storeStatus === 'all' || order.status === state.storeStatus;
    const matchesSearch = !search || `${order.ean} ${order.product} ${order.status} ${STATUS[order.status]?.label || ''}`.toLocaleLowerCase('pt-BR').includes(search);
    return matchesStatus && matchesSearch;
  });
  const orders = sortOrders(filtered, 'store');
  pruneSelection('store', orders.map(order => order.id));
  const pending = allOrders.filter(order => order.status === 'pending').length;
  const bought = allOrders.filter(order => order.status === 'bought').length;
  const shortage = allOrders.filter(order => order.status === 'shortage').length;
  const storeName = getStoreName(state.session.cnpj);

  $('#pageContent').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">ÁREA DA LOJA</span><h1>Visão geral</h1><p>Cadastre novas encomendas e acompanhe todas as solicitações da sua loja.</p></div></div>
    <section class="panel store-identity-panel">
      <div class="store-identity-copy"><span class="eyebrow">IDENTIFICAÇÃO AUTOMÁTICA</span><strong>${escapeHTML(storeName || 'CNPJ ainda não cadastrado')}</strong><small>CNPJ ${escapeHTML(formatCnpj(state.session.cnpj))}${storeName ? ' · Loja identificada pelo cadastro de Configurações' : ' · Solicite ao gerente a inclusão deste CNPJ no cadastro de lojas'}</small></div>
      <span class="identity-state ${storeName ? 'is-registered' : 'is-missing'}">${storeName ? 'Cadastro localizado' : 'Cadastro não localizado'}</span>
    </section>
    <div class="stats-grid">
      ${statCard('Total de encomendas', allOrders.length, 'Produtos solicitados', '▤')}
      ${statCard('Pendentes', pending, 'Aguardando ação de Compras', '◷', 'warning')}
      ${statCard('Comprados', bought, 'Solicitações atendidas', '✓')}
      ${statCard('Em falta', shortage, 'Produtos indisponíveis', '!', 'danger')}
    </div>
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">Nova encomenda</h2><p class="panel-subtitle">Informe os dados do produto que sua loja precisa.</p></div><span class="status pending">Novo pedido</span></div>
      <div class="panel-body">
        <form id="newOrderForm" class="form-grid">
          <div class="field"><label for="linkedStoreName">Loja identificada pelo CNPJ</label><input id="linkedStoreName" type="text" value="${escapeHTML(storeName)}" placeholder="${storeName ? '' : 'CNPJ não cadastrado'}" readonly></div>
          <div class="field"><label for="orderEan">EAN / Código de barras</label><input id="orderEan" name="ean" type="text" inputmode="numeric" maxlength="20" placeholder="Ex.: 7891234567890" required></div>
          <div class="field"><label for="orderProduct">Produto</label><input id="orderProduct" name="product" type="text" maxlength="180" placeholder="Cole a descrição do produto" autocomplete="off" spellcheck="false" required></div>
          <div class="field"><label for="orderQty">Quantidade</label><input id="orderQty" name="qty" type="number" min="1" max="99999" step="1" placeholder="0" required></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">+ Enviar encomenda</button></div>
        </form>
        ${!storeName ? '<p class="identity-required-note">Este CNPJ não consta na lista de lojas. Peça ao gerente para importar ou atualizar o cadastro na página Configurações.</p>' : ''}
      </div>
    </section>
    <section class="panel table-panel">
      <div class="panel-header"><div><h2 class="panel-title">Minhas encomendas</h2><p class="panel-subtitle">Pesquise, filtre e acompanhe o andamento das suas solicitações.</p></div><span class="table-total">${filtered.length} registro(s)</span></div>
      <div class="table-tools">
        <div class="table-tools-left"><div class="search-wrap"><span>⌕</span><input id="storeSearch" type="search" placeholder="Buscar EAN ou produto..." value="${escapeHTML(state.storeSearch)}" aria-label="Buscar EAN ou produto"></div>
          <select id="storeStatus" class="filter-control" aria-label="Filtrar por status"><option value="all" ${state.storeStatus === 'all' ? 'selected' : ''}>Todos os status</option><option value="pending" ${state.storeStatus === 'pending' ? 'selected' : ''}>Pendentes</option><option value="bought" ${state.storeStatus === 'bought' ? 'selected' : ''}>Comprados</option><option value="shortage" ${state.storeStatus === 'shortage' ? 'selected' : ''}>Em falta</option></select>
        </div>
      </div>
      ${renderStoreTable(orders)}
    </section>`;

  $('#newOrderForm').addEventListener('submit', createOrder);
  $('#storeSearch').addEventListener('input', event => {
    state.storeSearch = event.target.value;
    state.storeSelectedIds.clear();
    const position = event.target.selectionStart;
    renderStorePage();
    restoreInputCursor('#storeSearch', position);
  });
  $('#storeStatus').addEventListener('change', event => {
    state.storeStatus = event.target.value;
    state.storeSelectedIds.clear();
    renderStorePage();
  });
  bindSorting('store', renderStorePage);
  bindSelectionControls('store');
}

function isProductDescriptionInput(target) {
  return target instanceof HTMLElement && target.matches('#orderProduct');
}

function normalizeProductDescription(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

function handleProductDescriptionKeydown(event) {
  if (!isProductDescriptionInput(event.target)) return;
  const key = String(event.key || '').toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  const navigationKeys = ['tab', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'shift', 'control', 'meta', 'backspace', 'delete'];

  if (modifier && ['a', 'c', 'v', 'arrowleft', 'arrowright', 'home', 'end'].includes(key)) return;
  if (event.shiftKey && key === 'insert') return;
  if (navigationKeys.includes(key)) return;

  // Permite navegação, seleção, colagem e exclusão; bloqueia a digitação manual.
  event.preventDefault();
}

function handleProductDescriptionBeforeInput(event) {
  if (!isProductDescriptionInput(event.target)) return;
  if (['insertFromPaste', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) return;
  event.preventDefault();
}

function handleProductDescriptionPaste(event) {
  if (!isProductDescriptionInput(event.target)) return;
  event.preventDefault();

  const input = event.target;
  const clipboard = event.clipboardData || window.clipboardData;
  const pasted = clipboard?.getData('text/plain') ?? clipboard?.getData('Text') ?? '';
  const normalized = normalizeProductDescription(pasted);

  if (!normalized) {
    toast('Não foi encontrado texto na área de transferência.', 'error');
    return;
  }

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const maxLength = input.maxLength > 0 ? input.maxLength : Number.POSITIVE_INFINITY;
  const available = Math.max(0, maxLength - (input.value.length - (end - start)));
  const inserted = normalized.slice(0, available);
  input.setRangeText(inserted, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  if (inserted.length < normalized.length) {
    toast('A descrição foi limitada a 180 caracteres.', 'warning');
  }
}

function handleProductDescriptionInput(event) {
  if (!isProductDescriptionInput(event.target)) return;
  const input = event.target;
  const normalized = normalizeProductDescription(input.value);
  if (input.value !== normalized) {
    const cursor = input.selectionStart ?? normalized.length;
    input.value = normalized;
    input.setSelectionRange(Math.min(cursor, normalized.length), Math.min(cursor, normalized.length));
  }
}

function handleProductDescriptionDrop(event) {
  if (!isProductDescriptionInput(event.target)) return;
  event.preventDefault();
  toast('Use a opção Colar para inserir a descrição do produto.', 'warning');
}

async function createOrder(event) {
  event.preventDefault();
  const storeName = getStoreName(state.session.cnpj);
  if (!storeName || !state.session.lojaId) {
    toast('Este CNPJ não consta no cadastro ativo. Solicite ao Comprador a inclusão da loja.', 'error');
    return;
  }
  const ean = $('#orderEan').value.trim();
  const product = $('#orderProduct').value.trim().toLocaleUpperCase('pt-BR');
  const qty = Number($('#orderQty').value);
  if (!ean || !product || !Number.isInteger(qty) || qty < 1 || qty > 99999) {
    toast('Confira o EAN, o produto e a quantidade informada.', 'error');
    return;
  }

  const submit = $('#newOrderForm button[type="submit"]');
  submit.disabled = true;
  try {
    const { error } = await supabaseClient.from('encomendas').insert({
      loja_id: state.session.lojaId,
      ean,
      produto: product,
      quantidade: qty,
      status: 'pending'
    });
    if (error) throw error;
    await loadRemoteData();
    state.storeSelectedIds.clear();
    toast('Encomenda enviada para Compras com sucesso.');
    renderApp();
  } catch (error) {
    console.error('Falha ao enviar encomenda:', error);
    toast(error.message || 'Não foi possível enviar a encomenda.', 'error');
  } finally {
    submit.disabled = false;
  }
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `pedido-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortValue(order, key) {
  switch (key) {
    case 'storeName': return resolveStoreName(order);
    case 'cnpj': return String(order.cnpj || '');
    case 'ean': return String(order.ean || '');
    case 'product': return String(order.product || '');
    case 'qty': return Number(order.qty || 0);
    case 'status': return STATUS[order.status]?.label || '';
    case 'updatedAt': return order.updatedAt ? new Date(order.updatedAt).getTime() : 0;
    case 'createdAt': return order.createdAt ? new Date(order.createdAt).getTime() : 0;
    case 'updatedBy': return String(order.updatedBy || '');
    default: return String(order[key] ?? '');
  }
}

function sortOrders(orders, scope) {
  const config = state.sort[scope] || { key: 'createdAt', direction: 'desc' };
  const factor = config.direction === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    const aValue = sortValue(a, config.key);
    const bValue = sortValue(b, config.key);
    let comparison = 0;
    if (typeof aValue === 'number' && typeof bValue === 'number') comparison = aValue - bValue;
    else comparison = String(aValue).localeCompare(String(bValue), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return comparison * factor;
  });
}

function sortableHeader(label, key, scope, className = '') {
  const config = state.sort[scope] || { key: 'createdAt', direction: 'desc' };
  const active = config.key === key;
  const indicator = active ? (config.direction === 'asc' ? '↑' : '↓') : '↕';
  return `<th class="${className}" aria-sort="${active ? (config.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort-trigger" data-sort-scope="${scope}" data-sort-key="${key}" title="Ordenar por ${escapeHTML(label)}">${escapeHTML(label)}<span class="sort-indicator">${indicator}</span></button></th>`;
}

function bindSorting(scope, renderCallback) {
  $$(`.sort-trigger[data-sort-scope="${scope}"]`).forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.sortKey;
    const current = state.sort[scope];
    if (current.key === key) current.direction = current.direction === 'asc' ? 'desc' : 'asc';
    else {
      current.key = key;
      current.direction = 'asc';
    }
    renderCallback();
  }));
}

function pruneSelection(scope, visibleOrders) {
  const key = scope === 'store' ? 'storeSelectedIds' : 'buyerSelectedIds';
  const visibleIds = new Set(visibleOrders.map(order => order.id));
  state[key] = new Set([...state[key]].filter(id => visibleIds.has(id)));
}

function renderSelectionToolbar(scope, orders) {
  const key = scope === 'store' ? 'storeSelectedIds' : 'buyerSelectedIds';
  const selected = state[key];
  const ids = orders.map(order => order.id);
  const selectedVisible = ids.filter(id => selected.has(id)).length;
  const allSelected = ids.length > 0 && selectedVisible === ids.length;
  if (scope === 'buyer') {
    return `<div class="selection-toolbar buyer-selection-toolbar" data-selection-scope="buyer">
      <div class="buyer-selection-main">
        <button type="button" class="btn btn-outline btn-small select-all-visible" data-selection-scope="buyer">${allSelected ? 'Limpar seleção visível' : 'Selecionar todos os visíveis'}</button>
        <span class="selection-count" data-selection-count="buyer">${selected.size} selecionada(s)</span>
      </div>
      <div class="bulk-status-actions ${selected.size ? '' : 'hidden'}" data-bulk-actions="buyer" aria-label="Definir status dos itens selecionados">
        <span class="bulk-actions-label">Definir status:</span>
        <button type="button" class="btn btn-status-pending btn-small" data-bulk-status="pending">Pendente</button>
        <button type="button" class="btn btn-status-bought btn-small" data-bulk-status="bought">Comprado</button>
        <button type="button" class="btn btn-status-shortage btn-small" data-bulk-status="shortage">Em falta</button>
        <button type="button" class="btn btn-danger btn-small delete-selected-button" data-selection-scope="buyer">Excluir</button>
        <button type="button" class="btn btn-quiet btn-small clear-selection-button" data-selection-scope="buyer">Cancelar</button>
      </div>
    </div>`;
  }
  const someSelected = selectedVisible > 0 && !allSelected;
  return `<div class="selection-toolbar">
    <label class="select-visible-label"><input class="select-all-orders" data-selection-scope="store" type="checkbox" ${allSelected ? 'checked' : ''} ${someSelected ? 'data-indeterminate="true"' : ''}><span>Selecionar todos os visíveis</span></label>
    <div class="selection-toolbar-actions"><span class="selection-count">${selectedVisible} selecionada(s)</span><button type="button" class="btn btn-danger btn-small delete-selected-button" data-selection-scope="store" ${selectedVisible ? '' : 'disabled'}>Excluir selecionadas</button></div>
  </div>`;
}

function bindSelectionControls(scope) {
  updateSelectionUI(scope);
}

function updateSelectionUI(scope) {
  const selectedKey = scope === 'store' ? 'storeSelectedIds' : 'buyerSelectedIds';
  const rows = scope === 'store'
    ? $$('.select-order[data-selection-scope="store"]')
    : $$('tr[data-selectable-order]');
  const visibleIds = scope === 'store' ? rows.map(row => row.dataset.orderId) : rows.map(row => row.dataset.selectableOrder);
  const selectedCount = visibleIds.filter(id => state[selectedKey].has(id)).length;

  if (scope === 'buyer') {
    rows.forEach(row => {
      const selected = state.buyerSelectedIds.has(row.dataset.selectableOrder);
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
    });
    const count = $('[data-selection-count="buyer"]');
    if (count) count.textContent = `${state.buyerSelectedIds.size} selecionada(s)`;
    const actions = $('[data-bulk-actions="buyer"]');
    if (actions) actions.classList.toggle('hidden', state.buyerSelectedIds.size === 0);
    const selectAll = $('.select-all-visible[data-selection-scope="buyer"]');
    if (selectAll) {
      const everyVisible = visibleIds.length > 0 && visibleIds.every(id => state.buyerSelectedIds.has(id));
      selectAll.textContent = everyVisible ? 'Limpar seleção visível' : 'Selecionar todos os visíveis';
    }
    return;
  }

  const selectAll = $('.select-all-orders[data-selection-scope="store"]');
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedCount === visibleIds.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
  }
  const text = $('.selection-toolbar .selection-count');
  if (text) text.textContent = `${selectedCount} selecionada(s)`;
  const deleteButton = $('.delete-selected-button[data-selection-scope="store"]');
  if (deleteButton) deleteButton.disabled = selectedCount === 0;
}

function handleSelectionChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.matches('.select-order[data-selection-scope="store"], .select-all-orders[data-selection-scope="store"]')) return;

  const visibleIds = $$('.select-order[data-selection-scope="store"]').map(row => row.dataset.orderId);
  if (input.matches('.select-all-orders')) {
    visibleIds.forEach(id => {
      if (input.checked) state.storeSelectedIds.add(id);
      else state.storeSelectedIds.delete(id);
    });
  } else if (input.checked) state.storeSelectedIds.add(input.dataset.orderId);
  else state.storeSelectedIds.delete(input.dataset.orderId);
  updateSelectionUI('store');
}

function handleBuyerRowSelection(event) {
  if (state.session?.role !== 'comprador' || state.page !== 'home') return;
  if (event.target.closest('button, a, input, select, textarea, label')) return;
  const row = event.target.closest('tr[data-selectable-order]');
  if (!row) return;
  const id = row.dataset.selectableOrder;
  if (state.buyerSelectedIds.has(id)) state.buyerSelectedIds.delete(id);
  else state.buyerSelectedIds.add(id);
  updateSelectionUI('buyer');
}

function handleBuyerRowKeyboard(event) {
  if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('tr[data-selectable-order]')) return;
  event.preventDefault();
  const id = event.target.dataset.selectableOrder;
  if (state.buyerSelectedIds.has(id)) state.buyerSelectedIds.delete(id);
  else state.buyerSelectedIds.add(id);
  updateSelectionUI('buyer');
}

function handleSelectAllVisible(event) {
  const button = event.target.closest('.select-all-visible[data-selection-scope="buyer"]');
  if (!button) return;
  const visibleIds = $$('tr[data-selectable-order]').map(row => row.dataset.selectableOrder);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => state.buyerSelectedIds.has(id));
  visibleIds.forEach(id => {
    if (allSelected) state.buyerSelectedIds.delete(id);
    else state.buyerSelectedIds.add(id);
  });
  updateSelectionUI('buyer');
}

function handleClearSelection(event) {
  const button = event.target.closest('.clear-selection-button');
  if (!button) return;
  state.buyerSelectedIds.clear();
  updateSelectionUI('buyer');
}

async function applyBulkStatus(event) {
  const button = event.target.closest('[data-bulk-status]');
  if (!button || state.session?.role !== 'comprador') return;
  const newStatus = button.dataset.bulkStatus;
  if (!STATUS[newStatus]) return;
  const selected = [...state.buyerSelectedIds];
  if (!selected.length) return;
  button.disabled = true;
  try {
    const { error } = await supabaseClient
      .from('encomendas')
      .update({ status: newStatus })
      .in('id', selected);
    if (error) throw error;
    await loadRemoteData();
    state.buyerSelectedIds.clear();
    toast(`Status ${STATUS[newStatus].label.toLocaleLowerCase('pt-BR')} aplicado às encomendas selecionadas.`);
    renderApp();
  } catch (error) {
    console.error('Falha ao atualizar status:', error);
    toast(error.message || 'Não foi possível atualizar o status.', 'error');
  } finally {
    button.disabled = false;
  }
}

function handleSelectionDeleteClick(event) {
  const button = event.target.closest('.delete-selected-button');
  if (!button) return;
  const scope = button.dataset.selectionScope;
  if (scope !== 'store' && scope !== 'buyer') return;
  const visibleIds = scope === 'store'
    ? $$('.select-order[data-selection-scope="store"]').map(row => row.dataset.orderId)
    : $$('tr[data-selectable-order]').map(row => row.dataset.selectableOrder);
  const renderCallback = scope === 'store' ? renderStorePage : () => renderBuyerOverview(readOrders());
  deleteSelectedOrders(scope, visibleIds, renderCallback);
}

async function deleteSelectedOrders(scope, visibleIds, renderCallback) {
  if (scope !== 'buyer' || state.session?.role !== 'comprador') return;
  const selectedKey = 'buyerSelectedIds';
  const visibleSet = new Set(visibleIds);
  const selected = [...state[selectedKey]].filter(id => visibleSet.has(id));
  if (!selected.length) {
    toast('Selecione ao menos uma encomenda para arquivar.', 'error');
    return;
  }
  const message = selected.length === 1
    ? 'Deseja realmente arquivar a encomenda selecionada? Ela deixará de aparecer nas consultas, mas o histórico será preservado.'
    : `Deseja realmente arquivar as ${selected.length} encomendas selecionadas? Elas deixarão de aparecer nas consultas, mas o histórico será preservado.`;
  if (!window.confirm(message)) return;

  try {
    const { error } = await supabaseClient
      .from('encomendas')
      .update({ excluida_em: new Date().toISOString() })
      .in('id', selected);
    if (error) throw error;
    await loadRemoteData();
    state[selectedKey].clear();
    toast(`${selected.length} encomenda(s) arquivada(s).`);
    renderCallback();
  } catch (error) {
    console.error('Falha ao arquivar encomendas:', error);
    toast(error.message || 'Não foi possível arquivar as encomendas.', 'error');
  }
}

function renderStoreTable(orders) {
  if (!orders.length) return emptyState('Nenhuma encomenda encontrada', 'Ajuste os filtros ou envie uma nova solicitação para começar.');
  return `<div class="table-scroll"><table class="data-table store-data-table">
    <colgroup><col class="col-date"><col class="col-ean"><col class="col-product"><col class="col-qty"><col class="col-status"><col class="col-date"></colgroup>
    <thead><tr>${sortableHeader('Data da solicitação', 'createdAt', 'store')}${sortableHeader('EAN', 'ean', 'store')}${sortableHeader('Produto', 'product', 'store')}${sortableHeader('Qtd.', 'qty', 'store')}${sortableHeader('Status', 'status', 'store')}${sortableHeader('Última atualização', 'updatedAt', 'store')}</tr></thead>
    <tbody>${orders.map(order => `<tr>
      <td class="date-cell">${formatDate(order.createdAt, true)}</td><td class="ean-cell" title="${escapeHTML(order.ean)}">${escapeHTML(order.ean)}</td><td class="product-cell" title="${escapeHTML(order.product)}"><span class="product-text">${escapeHTML(order.product)}</span></td><td class="qty-cell">${Number(order.qty || 0)}</td><td>${statusBadge(order.status)}</td><td class="date-cell">${formatDate(order.updatedAt, true)}</td>
    </tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Use os títulos das colunas para alternar a ordenação.</span><span>${orders.length} item(ns)</span></div>`;
}

function filterBuyerOrders(orders) {
  const search = state.buyerSearch.toLocaleLowerCase('pt-BR').trim();
  return orders.filter(order => {
    const matchesStatus = state.buyerStatus === 'all' || order.status === state.buyerStatus;
    const searchable = `${resolveStoreName(order)} ${formatCnpj(order.cnpj)} ${order.cnpj} ${order.ean} ${order.product} ${STATUS[order.status]?.label || ''}`;
    const matchesSearch = !search || searchable.toLocaleLowerCase('pt-BR').includes(search);
    return matchesStatus && matchesSearch;
  });
}

function renderBuyerOverview(allOrders) {
  const filtered = filterBuyerOrders(allOrders);
  const sorted = sortOrders(filtered, 'overview');
  pruneSelection('buyer', sorted);
  const pending = allOrders.filter(order => order.status === 'pending').length;
  const bought = allOrders.filter(order => order.status === 'bought').length;
  const shortage = allOrders.filter(order => order.status === 'shortage').length;
  const pendingQty = allOrders.filter(order => order.status === 'pending').reduce((sum, order) => sum + Number(order.qty || 0), 0);
  $('#pageContent').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">PAINEL DE COMPRAS</span><h1>Visão geral das encomendas</h1><p>Indicadores e todas as solicitações recebidas das lojas em um único painel.</p></div><div class="heading-actions"><button class="btn btn-outline btn-small" id="exportAll" type="button">↓ Baixar Excel</button></div></div>
    <div class="stats-grid">
      ${statCard('Total de solicitações', allOrders.length, 'Produtos enviados pelas lojas', '▤')}
      ${statCard('Pendentes', pending, `${pendingQty} unidade(s) aguardando`, '◷', 'warning')}
      ${statCard('Comprados', bought, 'Solicitações atendidas', '✓')}
      ${statCard('Em falta', shortage, 'Solicitações indisponíveis', '!', 'danger')}
    </div>
    <section class="panel table-panel overview-table-panel">
      <div class="panel-header"><div><h2 class="panel-title">Painel de encomendas</h2><p class="panel-subtitle">Clique em uma linha para selecioná-la. Use a seleção em lote para atualizar vários status de uma vez.</p></div><span class="table-total">${filtered.length} registro(s)</span></div>
      <div class="table-tools">
        <div class="table-tools-left"><div class="search-wrap"><span>⌕</span><input id="buyerSearch" type="search" placeholder="Buscar loja, CNPJ, EAN ou produto..." value="${escapeHTML(state.buyerSearch)}" aria-label="Buscar loja, CNPJ, EAN ou produto"></div>
          <select id="buyerStatus" class="filter-control" aria-label="Filtrar por status"><option value="all" ${state.buyerStatus === 'all' ? 'selected' : ''}>Todos os status</option><option value="pending" ${state.buyerStatus === 'pending' ? 'selected' : ''}>Pendentes</option><option value="bought" ${state.buyerStatus === 'bought' ? 'selected' : ''}>Comprados</option><option value="shortage" ${state.buyerStatus === 'shortage' ? 'selected' : ''}>Em falta</option></select>
        </div><div class="table-tools-right"><span class="muted-cell result-count">${filtered.length} registro(s)</span></div>
      </div>
      ${renderSelectionToolbar('buyer', sorted)}
      ${renderBuyerTable(sorted, { selectable: true, sortScope: 'overview' })}
    </section>`;
  $('#exportAll').addEventListener('click', () => exportExcel(filtered, 'encomendas_filtradas'));
  $('#buyerSearch').addEventListener('input', event => {
    state.buyerSearch = event.target.value;
    state.buyerSelectedIds.clear();
    const position = event.target.selectionStart;
    renderBuyerOverview(readOrders());
    restoreInputCursor('#buyerSearch', position);
  });
  $('#buyerStatus').addEventListener('change', event => {
    state.buyerStatus = event.target.value;
    state.buyerSelectedIds.clear();
    renderBuyerOverview(readOrders());
  });
  bindSorting('overview', () => renderBuyerOverview(readOrders()));
  bindSelectionControls('buyer');
}

function restoreInputCursor(selector, position) {
  const input = $(selector);
  if (!input) return;
  input.focus();
  try { input.setSelectionRange(position, position); } catch (_) { /* input type may not support selection */ }
}

function renderBuyerTable(orders, options = {}) {
  const { selectable = false, sortScope = 'overview' } = options;
  if (!orders.length) return emptyState('Nenhuma solicitação encontrada', 'Quando as lojas enviarem encomendas, os produtos aparecerão aqui.');
  return `<div class="table-scroll"><table class="data-table buyer-data-table ${selectable ? 'buyer-selectable-table' : ''}">
    <thead><tr>${sortableHeader('Loja', 'storeName', sortScope)}${sortableHeader('CNPJ', 'cnpj', sortScope)}${sortableHeader('EAN', 'ean', sortScope)}${sortableHeader('Produto', 'product', sortScope)}${sortableHeader('Qtd.', 'qty', sortScope)}${sortableHeader('Solicitado em', 'createdAt', sortScope)}${sortableHeader('Status', 'status', sortScope)}${sortableHeader('Atualizado em', 'updatedAt', sortScope)}</tr></thead>
    <tbody>${orders.map(order => `<tr ${selectable ? `data-selectable-order="${escapeHTML(order.id)}" class="selectable-order-row ${state.buyerSelectedIds.has(order.id) ? 'is-selected' : ''}" role="row" tabindex="0" aria-selected="${state.buyerSelectedIds.has(order.id)}" aria-label="Selecionar encomenda ${escapeHTML(order.product)} da loja ${escapeHTML(resolveStoreName(order))}"` : ''}>
      <td class="store-name-cell" title="${escapeHTML(resolveStoreName(order))}"><span class="product-text">${escapeHTML(resolveStoreName(order))}</span></td>
      <td class="cnpj-cell" title="${escapeHTML(formatCnpj(order.cnpj))}">${escapeHTML(formatCnpj(order.cnpj))}</td>
      <td class="ean-cell" title="${escapeHTML(order.ean)}">${escapeHTML(order.ean)}</td>
      <td class="product-cell" title="${escapeHTML(order.product)}"><span class="product-text">${escapeHTML(order.product)}</span></td>
      <td class="qty-cell">${Number(order.qty || 0)}</td><td class="date-cell">${formatDate(order.createdAt, true)}</td>
      <td>${statusBadge(order.status)}</td><td class="date-cell">${formatDate(order.updatedAt, true)}</td>
    </tr>`).join('')}</tbody></table></div><div class="table-footer"><span>${selectable ? 'Clique na linha para selecionar ou retirar da seleção.' : 'Os títulos das colunas permitem ordenar os registros.'}</span><span>${orders.length} item(ns)</span></div>`;
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

function renderSettingsPage() {
  const names = readStoreNames();
  const search = state.storeDirectorySearch.toLocaleLowerCase('pt-BR').trim();
  const stores = Object.entries(names)
    .map(([cnpj, name]) => ({ cnpj, name: String(name || '').trim() }))
    .filter(store => store.cnpj && store.name)
    .filter(store => !search || `${store.cnpj} ${formatCnpj(store.cnpj)} ${store.name}`.toLocaleLowerCase('pt-BR').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  $('#pageContent').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">ADMINISTRAÇÃO DO CADASTRO</span><h1>Configurações</h1><p>Gerencie seu acesso e mantenha a relação oficial de lojas e CNPJs.</p></div></div>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Minha conta</h2><p class="panel-subtitle">Comprador conectado: ${escapeHTML(state.session?.email || '')}</p></div><span class="status bought">Acesso protegido</span></div><div class="panel-body"><form id="changePasswordForm" class="form-grid"><div class="field"><label for="newBuyerPassword">Nova senha</label><input id="newBuyerPassword" type="password" minlength="8" autocomplete="new-password" required placeholder="Mínimo de 8 caracteres"></div><div class="field"><label for="confirmBuyerPassword">Confirmar nova senha</label><input id="confirmBuyerPassword" type="password" minlength="8" autocomplete="new-password" required placeholder="Repita a nova senha"></div><div class="form-actions"><button class="btn btn-primary" type="submit">Atualizar senha</button></div></form><p id="changePasswordFeedback" class="import-feedback" aria-live="polite"></p></div></section>
    ${legacyMigrationAvailable() ? `<section class="panel" style="margin-top:20px"><div class="panel-header"><div><h2 class="panel-title">Migrar dados deste navegador</h2><p class="panel-subtitle">Transfira para o Supabase as lojas e encomendas salvas na versão anterior deste site, caso esteja usando o mesmo navegador e endereço local.</p></div><span class="status pending">Migração opcional</span></div><div class="panel-body"><button type="button" class="btn btn-outline" id="migrateLegacyButton">Migrar dados antigos para o Supabase</button><p class="report-note">Os dados antigos serão preservados no navegador; a migração não os apaga. Execute uma única vez e confira a quantidade de registros após concluir.</p></div></section>` : ''}
    <div class="stats-grid settings-stats">${statCard('Lojas cadastradas', Object.keys(names).length, 'CNPJs com identificação', '▣')}${statCard('Resultado da pesquisa', stores.length, 'Lojas encontradas', '⌕')}${statCard('Origem dos dados', 'Excel', 'Cadastro compartilhado no Supabase', '⇧')}${statCard('Identificação', 'Automática', 'Aplicada pelo CNPJ no login', '✓')}</div>
    <section class="panel import-stores-panel">
      <div class="panel-header"><div><h2 class="panel-title">Importar lojas por Excel</h2><p class="panel-subtitle">Envie uma planilha com duas colunas: CNPJ e Nome da loja.</p></div><span class="status bought">Cadastro de lojas</span></div>
      <div class="panel-body">
        <div class="import-instructions"><strong>Como preparar sua planilha</strong><p>Na primeira linha, utilize os cabeçalhos <b>CNPJ</b> e <b>LOJA</b> (ou <b>NOME DA LOJA</b>). Cada linha seguinte deve conter um CNPJ e o nome correspondente. O CNPJ deve estar formatado como texto para preservar zeros à esquerda.</p><button type="button" class="btn btn-outline btn-small" id="downloadStoreTemplate">↓ Baixar modelo CSV</button></div>
        <form id="storeImportForm" class="store-import-form"><label class="file-dropzone" for="storeImportFile"><span class="file-drop-icon">⇧</span><strong>Selecionar planilha</strong><small>Formatos aceitos: .xlsx e .xls</small><input id="storeImportFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required></label><div class="import-actions"><span id="selectedStoreFile" class="muted-cell">Nenhum arquivo selecionado</span><button class="btn btn-primary" type="submit">Importar cadastro</button></div></form>
        <p class="import-feedback" id="storeImportFeedback" aria-live="polite"></p>
      </div>
    </section>
    <section class="panel table-panel store-directory-panel">
      <div class="panel-header"><div><h2 class="panel-title">Lojas cadastradas</h2><p class="panel-subtitle">O nome será associado automaticamente às encomendas enviadas por cada CNPJ.</p></div><span class="table-total">${Object.keys(names).length} loja(s)</span></div>
      <div class="table-tools"><div class="table-tools-left"><div class="search-wrap"><span>⌕</span><input id="storeDirectorySearch" type="search" placeholder="Buscar nome da loja ou CNPJ..." value="${escapeHTML(state.storeDirectorySearch)}" aria-label="Buscar lojas cadastradas"></div></div><div class="table-tools-right"><span class="muted-cell result-count">${stores.length} resultado(s)</span></div></div>
      ${stores.length ? `<div class="table-scroll"><table class="data-table directory-table"><thead><tr><th>CNPJ</th><th>Nome da loja</th></tr></thead><tbody>${stores.map(store => `<tr><td class="cnpj-cell">${escapeHTML(formatCnpj(store.cnpj))}</td><td class="store-name-cell"><span class="product-text">${escapeHTML(store.name)}</span></td></tr>`).join('')}</tbody></table></div>` : emptyState('Nenhuma loja cadastrada', 'Importe uma planilha Excel para começar a montar o cadastro.')}
    </section>
    <p class="report-note">A importação atualiza os CNPJs existentes e preserva as demais lojas. O cadastro e as encomendas ficam armazenados no Supabase e compartilhados entre os dispositivos autorizados.</p>`;

  $('#changePasswordForm').addEventListener('submit', changeBuyerPassword);
  const migrateButton = $('#migrateLegacyButton');
  if (migrateButton) migrateButton.addEventListener('click', async () => {
    migrateButton.disabled = true;
    migrateButton.textContent = 'Migrando...';
    try { await migrateLegacyBrowserData(); }
    catch (error) { console.error('Falha na migração local:', error); toast(error.message || 'Não foi possível migrar os dados antigos.', 'error'); }
    finally { const current = $('#migrateLegacyButton'); if (current) { current.disabled = false; current.textContent = 'Migrar dados antigos para o Supabase'; } }
  });
  $('#storeImportFile').addEventListener('change', event => {
    $('#selectedStoreFile').textContent = event.target.files?.[0]?.name || 'Nenhum arquivo selecionado';
    $('#storeImportFeedback').textContent = '';
  });
  $('#storeImportForm').addEventListener('submit', importStoreDirectory);
  $('#downloadStoreTemplate').addEventListener('click', downloadStoreTemplate);
  $('#storeDirectorySearch').addEventListener('input', event => {
    state.storeDirectorySearch = event.target.value;
    const position = event.target.selectionStart;
    renderSettingsPage();
    restoreInputCursor('#storeDirectorySearch', position);
  });
}

async function changeBuyerPassword(event) {
  event.preventDefault();
  const password = $('#newBuyerPassword').value;
  const confirmation = $('#confirmBuyerPassword').value;
  const feedback = $('#changePasswordFeedback');
  if (password.length < 8) {
    feedback.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.';
    feedback.classList.remove('success');
    return;
  }
  if (password !== confirmation) {
    feedback.textContent = 'As senhas informadas não conferem.';
    feedback.classList.remove('success');
    return;
  }
  const button = $('#changePasswordForm button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    $('#changePasswordForm').reset();
    feedback.textContent = 'Senha atualizada com sucesso.';
    feedback.classList.add('success');
    toast('Sua senha foi atualizada.');
  } catch (error) {
    console.error('Falha ao alterar senha:', error);
    feedback.textContent = error.message || 'Não foi possível atualizar a senha.';
    feedback.classList.remove('success');
  } finally {
    button.disabled = false;
  }
}

function downloadStoreTemplate() {
  const csv = 'CNPJ,LOJA\r\n11222333000181,Loja Exemplo\r\n';
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'modelo_cadastro_lojas.csv');
}

async function importStoreDirectory(event) {
  event.preventDefault();
  const file = $('#storeImportFile').files?.[0];
  const feedback = $('#storeImportFeedback');
  if (!file) {
    toast('Selecione uma planilha para importar.', 'error');
    return;
  }
  const submit = $('#storeImportForm button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Lendo planilha...';
  feedback.textContent = '';
  try {
    const rows = await readExcelRows(file);
    const imported = extractStoreRecords(rows);
    if (!imported.length) throw new Error('Nenhuma linha válida encontrada. Verifique se a planilha possui CNPJ e nome da loja.');
    const confirmed = window.confirm(`Foram encontrados ${imported.length} registros válidos. Os CNPJs existentes serão atualizados e as demais lojas serão preservadas. Deseja continuar?`);
    if (!confirmed) return;
    const payload = imported.map(store => ({ cnpj: store.cnpj, nome: store.name, ativo: true }));
    const { error } = await supabaseClient.from('lojas').upsert(payload, { onConflict: 'cnpj' });
    if (error) throw error;
    await loadRemoteData();
    const message = `${imported.length} loja(s) importada(s) ou atualizada(s) no banco com sucesso.`;
    feedback.textContent = message;
    feedback.classList.add('success');
    toast(message);
    renderSettingsPage();
  } catch (error) {
    console.error('Falha na importação do cadastro de lojas:', error);
    feedback.textContent = error.message || 'Não foi possível ler essa planilha.';
    feedback.classList.remove('success');
    toast(feedback.textContent, 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Importar cadastro';
  }
}

async function readExcelRows(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'xls' && extension !== 'xlsx') {
    throw new Error('Formato não reconhecido. Envie um arquivo .xls ou .xlsx.');
  }

  // Alguns arquivos .xls são planilhas HTML exportadas pelo Excel. Detecte-as
  // antes de tentar baixar a biblioteca usada para arquivos binários antigos.
  if (extension === 'xls') {
    const preview = await file.slice(0, 4096).text();
    if (/<table[\s>]/i.test(preview)) {
      const text = await file.text();
      const document = new DOMParser().parseFromString(text, 'text/html');
      const rows = [...document.querySelectorAll('table tr')].map(row =>
        [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim())
      );
      if (rows.length) return rows;
    }
    if (!window.XLSX?.read) await ensureSheetJsLibrary();
  }

  if (window.XLSX?.read) {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('A planilha não possui uma aba com dados.');
    return window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '' });
  }

  if (extension === 'xlsx') return readXlsxWithoutLibrary(await file.arrayBuffer());
  throw new Error('Este arquivo .xls usa o formato binário antigo. Conecte-se à internet para carregar o leitor Excel ou salve a planilha como .xlsx.');
}

async function ensureSheetJsLibrary() {
  if (window.XLSX?.read) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    script.async = true;
    script.onload = () => window.XLSX?.read ? resolve() : reject(new Error('A biblioteca de leitura .xls não foi inicializada.'));
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de .xls. Conecte-se à internet ou salve a planilha no formato .xlsx.'));
    document.head.appendChild(script);
  });
}

function extractStoreRecords(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('A planilha deve conter cabeçalho e pelo menos uma loja.');
  const headers = rows[0].map(normalizeHeader);
  const cnpjAliases = ['cnpj', 'cnpjloja', 'cnpjdaloja', 'cnpjfilial', 'documento'];
  const nameAliases = ['loja', 'nomedaloja', 'nome', 'razaosocial', 'nomefantasia', 'fantasia', 'store', 'storename', 'nomeestabelecimento'];
  const cnpjIndex = headers.findIndex(header => cnpjAliases.includes(header) || header.includes('cnpj'));
  const nameIndex = headers.findIndex(header => nameAliases.includes(header) || /loja|nome|fantasia|razaosocial|storename/.test(header));
  if (cnpjIndex < 0 || nameIndex < 0 || cnpjIndex === nameIndex) {
    throw new Error('Não encontrei os cabeçalhos. Use uma coluna CNPJ e outra LOJA ou NOME DA LOJA na primeira linha.');
  }
  const unique = new Map();
  rows.slice(1).forEach(row => {
    const cnpj = normalizeCnpj(row[cnpjIndex]);
    const name = String(row[nameIndex] ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (cnpj && name.length >= 2) unique.set(cnpj, name);
  });
  return [...unique.entries()].map(([cnpj, name]) => ({ cnpj, name }));
}

async function readXlsxWithoutLibrary(buffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador não oferece suporte à leitura local de .xlsx. Atualize o Chrome ou Edge para uma versão recente.');
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido ou danificado.');
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Estrutura interna do Excel inválida.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    files.set(name, { method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const readZipFile = async name => {
    const item = files.get(name);
    if (!item) return '';
    const local = item.localOffset;
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const start = local + 30 + nameLength + extraLength;
    const compressed = bytes.slice(start, start + item.compressedSize);
    let data;
    if (item.method === 0) data = compressed;
    else if (item.method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`Método de compactação não suportado ao ler ${name}.`);
    return new TextDecoder('utf-8').decode(data);
  };
  const parseXml = value => new DOMParser().parseFromString(value, 'application/xml');
  const workbookXml = parseXml(await readZipFile('xl/workbook.xml'));
  const firstSheet = workbookXml.getElementsByTagName('sheet')[0];
  if (!firstSheet) throw new Error('A planilha Excel não possui abas.');
  const relationId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relsXml = parseXml(await readZipFile('xl/_rels/workbook.xml.rels'));
  const relation = [...relsXml.getElementsByTagName('Relationship')].find(node => node.getAttribute('Id') === relationId);
  let target = relation?.getAttribute('Target') || 'worksheets/sheet1.xml';
  target = target.replace(/^\//, '');
  const sheetPath = target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
  const sheetXmlText = await readZipFile(sheetPath);
  if (!sheetXmlText) throw new Error('Não foi possível localizar a primeira aba da planilha.');
  const sheetXml = parseXml(sheetXmlText);
  const sharedXmlText = await readZipFile('xl/sharedStrings.xml');
  const shared = sharedXmlText ? [...parseXml(sharedXmlText).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const columnNumber = reference => {
    const letters = String(reference || '').replace(/[0-9]/g, '');
    let number = 0;
    for (const char of letters) number = number * 26 + char.charCodeAt(0) - 64;
    return Math.max(0, number - 1);
  };
  const rowsOut = [];
  [...sheetXml.getElementsByTagName('row')].forEach(rowNode => {
    const row = [];
    [...rowNode.getElementsByTagName('c')].forEach(cell => {
      const index = columnNumber(cell.getAttribute('r'));
      const type = cell.getAttribute('t');
      let value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      if (type === 's') value = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') value = [...cell.getElementsByTagName('t')].map(node => node.textContent).join('');
      row[index] = value;
    });
    rowsOut.push(row.map(value => value ?? ''));
  });
  return rowsOut;
}

function renderBuyerReports(orders) {
  const filteredBase = state.reportApplied ? filterReportOrders(orders) : orders;
  const filtered = sortOrders(filteredBase, 'report');
  const totalQty = filtered.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const boughtRows = filtered.filter(order => order.status === 'bought');
  const shortageRows = filtered.filter(order => order.status === 'shortage');
  const boughtQty = boughtRows.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const shortageQty = shortageRows.reduce((sum, order) => sum + Number(order.qty || 0), 0);

  $('#pageContent').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">ANÁLISE DE DESEMPENHO</span><h1>Relatórios de encomendas</h1><p>Consulte o volume solicitado e os resultados das solicitações por período.</p></div><div class="heading-actions"><button class="btn btn-primary btn-small" id="exportReport" type="button">↓ Exportar relatório</button></div></div>
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">Filtrar período</h2><p class="panel-subtitle">Escolha um mês ou informe uma data inicial e final.</p></div></div>
      <div class="panel-body"><form id="reportFilterForm" class="report-filters">
        <div class="field"><label for="reportMonth">Mês de referência</label><input id="reportMonth" type="month" value="${escapeHTML(state.reportMonth)}"></div>
        <div class="field"><label for="reportFrom">Data inicial</label><input id="reportFrom" type="date" value="${escapeHTML(state.reportFrom)}"></div>
        <div class="field"><label for="reportTo">Data final</label><input id="reportTo" type="date" value="${escapeHTML(state.reportTo)}"></div>
        <button class="btn btn-primary" type="submit">Aplicar filtros</button>
      </form></div>
    </section>
    <div class="stats-grid report-summary">
      ${statCard('Produtos solicitados', filtered.length, `${totalQty} unidade(s) solicitada(s)`, '▤')}
      ${statCard('Produtos comprados', boughtRows.length, `${boughtQty} unidade(s) comprada(s)`, '✓')}
      ${statCard('Produtos em falta', shortageRows.length, `${shortageQty} unidade(s) em falta`, '!', 'danger')}
      ${statCard('Aguardando compra', filtered.filter(o => o.status === 'pending').length, 'Solicitações pendentes', '◷', 'warning')}
    </div>
    <section class="panel table-panel report-result">
      <div class="panel-header"><div><h2 class="panel-title">Detalhamento dos produtos</h2><p class="panel-subtitle">Lista de quais produtos foram solicitados e o resultado de cada solicitação.</p></div><span class="table-total">${filtered.length} registro(s)</span></div>
      ${renderBuyerTable(filtered, { sortScope: 'report' })}
    </section>
    <p class="report-note">Os indicadores contam solicitações (linhas) e também somam as unidades informadas no campo Quantidade. Um mesmo produto solicitado em datas ou lojas diferentes aparece em linhas separadas. O período considera a data original da solicitação.</p>`;

  $('#reportFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    state.reportMonth = $('#reportMonth').value;
    state.reportFrom = $('#reportFrom').value;
    state.reportTo = $('#reportTo').value;
    if (state.reportFrom && state.reportTo && state.reportFrom > state.reportTo) {
      toast('A data inicial não pode ser posterior à data final.', 'error');
      return;
    }
    if (state.reportMonth && (state.reportFrom || state.reportTo)) {
      toast('Use o filtro por mês ou o intervalo de datas, não os dois ao mesmo tempo.', 'error');
      return;
    }
    state.reportApplied = true;
    renderBuyerReports(readOrders());
  });
  $('#exportReport').addEventListener('click', () => openReportExportDialog(filteredBase));
  bindSorting('report', () => renderBuyerReports(readOrders()));
}

function filterReportOrders(orders) {
  return orders.filter(order => {
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) return false;
    const dateOnly = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (state.reportMonth) return dateOnly.startsWith(state.reportMonth);
    if (state.reportFrom && dateOnly < state.reportFrom) return false;
    if (state.reportTo && dateOnly > state.reportTo) return false;
    return true;
  });
}

function openReportExportDialog(orders) {
  state.reportExportOrders = [...orders];
  $('#exportChoiceView').classList.remove('hidden');
  $('#a7StatusView').classList.add('hidden');
  $$('input[name="a7Status"]').forEach(input => { input.checked = true; });
  const dialog = $('#exportDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'open');
}

function closeExportDialog() {
  const dialog = $('#exportDialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportExcel(orders, filename) {
  if (!orders.length) {
    toast('Não há registros para exportar.', 'error');
    return;
  }
  const headers = ['Nome da loja', 'CNPJ', 'EAN', 'Produto', 'Quantidade', 'Status', 'Data da solicitação', 'Última atualização', 'Atualizado por'];
  const rows = orders.map(order => [
    resolveStoreName(order),
    formatCnpj(order.cnpj),
    order.ean,
    order.product,
    order.qty,
    STATUS[order.status]?.label || 'Pendente',
    formatDate(order.createdAt, true),
    formatDate(order.updatedAt, true),
    order.updatedBy || '—'
  ]);
  const table = `<table><thead><tr>${headers.map(value => `<th>${escapeHTML(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escapeHTML(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const workbook = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse}th,td{border:1px solid #d8e2da;padding:7px}th{background:#e7f1ea;font-weight:bold}</style></head><body>${table}</body></html>`;
  const blob = new Blob(['\ufeff', workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  downloadBlob(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.xls`);
  toast('Relatório completo em Excel gerado com sucesso.');
}

function exportA7CSV(orders, selectedStatuses) {
  if (!orders.length) {
    toast('Não há registros no período selecionado para exportar.', 'error');
    return;
  }
  const selectedRows = orders.filter(order => selectedStatuses.has(order.status));
  if (!selectedRows.length) {
    toast('Não existem encomendas com os status selecionados neste período.', 'error');
    return;
  }
  const lines = ['CNPJ,EAN,QTD'];
  let skippedWithoutEan = 0;
  let skippedInvalid = 0;
  selectedRows.forEach(order => {
    const cnpj = String(order.cnpj || '').replace(/\D/g, '').slice(0, 14);
    const ean = String(order.ean || '').replace(/\D/g, '');
    const qty = Number(order.qty || 0);
    if (cnpj.length !== 14 || !Number.isInteger(qty) || qty < 1) { skippedInvalid++; return; }
    // O A7 recebe três campos numéricos, sem a coluna Produto.
    // EAN ausente ou textual (ex.: "NO EAN") não deve contaminar a coluna.
    if (!ean) { skippedWithoutEan++; return; }
    lines.push(`${cnpj},${ean},${qty}`);
  });
  if (lines.length === 1) {
    toast('Nenhuma linha válida para o A7. Verifique CNPJ, EAN e quantidade.', 'error');
    return;
  }
  // Macintosh clássico: CR como separador de registros e apenas ASCII.
  const csv = `${lines.join('\r')}\r`;
  const blob = new Blob([csv], { type: 'text/csv;charset=us-ascii' });
  downloadBlob(blob, `A7_encomendas_${new Date().toISOString().slice(0, 10)}.csv`);
  const exported = lines.length - 1;
  const warnings = [];
  if (skippedWithoutEan) warnings.push(`${skippedWithoutEan} sem EAN`);
  if (skippedInvalid) warnings.push(`${skippedInvalid} com CNPJ ou quantidade inválida`);
  toast(`${exported} item(ns) exportado(s) para o A7${warnings.length ? `. Ignorados: ${warnings.join('; ')}.` : '.'}`);
}

function bindExportDialog() {
  $('#closeExportDialog').addEventListener('click', closeExportDialog);
  $('#exportCompleteChoice').addEventListener('click', () => {
    const orders = state.reportExportOrders;
    closeExportDialog();
    exportExcel(orders, 'relatorio_completo');
  });
  $('#exportA7Choice').addEventListener('click', () => {
    $('#exportChoiceView').classList.add('hidden');
    $('#a7StatusView').classList.remove('hidden');
  });
  $('#backExportChoices').addEventListener('click', () => {
    $('#a7StatusView').classList.add('hidden');
    $('#exportChoiceView').classList.remove('hidden');
  });
  $('#confirmA7Export').addEventListener('click', () => {
    const statuses = new Set($$('input[name="a7Status"]:checked').map(input => input.value));
    if (!statuses.size) {
      toast('Selecione ao menos um status para exportar.', 'error');
      return;
    }
    const orders = state.reportExportOrders;
    closeExportDialog();
    exportA7CSV(orders, statuses);
  });
  $('#exportDialog').addEventListener('click', event => {
    if (event.target === $('#exportDialog')) closeExportDialog();
  });
}

function toggleMenu() {
  const app = $('#appView');
  const sidebar = $('#sidebar');
  if (window.innerWidth <= 760) {
    sidebar.classList.toggle('open');
  } else {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }
  updateMenuButton();
}

function init() {
  $$('.role-option').forEach(button => button.addEventListener('click', () => setLoginRole(button.dataset.role)));
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#forgotPasswordButton').addEventListener('click', sendBuyerPasswordRecovery);
  $('#togglePassword').addEventListener('click', () => {
    const input = $('#loginPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('#togglePassword').setAttribute('aria-label', input.type === 'password' ? 'Mostrar senha' : 'Ocultar senha');
  });
  $('#loginId').addEventListener('input', event => {
    if (state.role !== 'loja') return;
    event.target.value = formatCnpj(event.target.value);
  });
  $('#logoutButton').addEventListener('click', logout);
  document.addEventListener('keydown', handleProductDescriptionKeydown, true);
  document.addEventListener('beforeinput', handleProductDescriptionBeforeInput, true);
  document.addEventListener('paste', handleProductDescriptionPaste, true);
  document.addEventListener('input', handleProductDescriptionInput, true);
  document.addEventListener('drop', handleProductDescriptionDrop, true);
  $('#menuToggleButton').addEventListener('click', toggleMenu);
  document.addEventListener('change', handleSelectionChange);
  document.addEventListener('click', handleBuyerRowSelection);
  document.addEventListener('keydown', handleBuyerRowKeyboard);
  document.addEventListener('click', handleSelectAllVisible);
  document.addEventListener('click', handleClearSelection);
  document.addEventListener('click', applyBulkStatus);
  document.addEventListener('click', handleSelectionDeleteClick);
  bindExportDialog();
  document.addEventListener('click', event => {
    const sidebar = $('#sidebar');
    if (window.innerWidth <= 760 && sidebar.classList.contains('open') && !sidebar.contains(event.target) && !$('#menuToggleButton').contains(event.target)) {
      sidebar.classList.remove('open');
      updateMenuButton();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) $('#sidebar').classList.remove('open');
    applySidebarPreference();
  });
  restoreSession();
}

document.addEventListener('DOMContentLoaded', init);
