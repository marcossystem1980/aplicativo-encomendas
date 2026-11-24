'use strict';

/* Inicialização e composição das telas do aplicativo. */

function getPageConfig() {
  if (state.session.role === 'loja') {
    return [{ id: 'home', label: 'Visão geral', icon: '⌂' }];
  }
  return [
    { id: 'home', label: 'Visão geral', icon: '⌂' },
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
    if (state.page === 'settings') renderSettingsPage();
    else renderBuyerOverview(readOrders());
  } else renderStorePage();
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
