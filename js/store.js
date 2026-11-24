'use strict';

/* Funcionalidades da área da loja. */

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
          <div class="field"><label for="orderProduct">Produto</label><input id="orderProduct" name="product" type="text" maxlength="180" placeholder="Cole a descrição do produto" autocomplete="off" spellcheck="false" aria-describedby="productEanError" required><small id="productEanError" class="form-error hidden" role="alert"></small></div>
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
  $('#orderEan').addEventListener('input', validateProductEanMatch);
  $('#orderProduct').addEventListener('input', validateProductEanMatch);
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

function normalizeProductEanComparison(value) {
  return normalizeProductDescription(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function validateProductEanMatch() {
  const eanInput = $('#orderEan');
  const productInput = $('#orderProduct');
  if (!eanInput || !productInput) return true;

  const ean = normalizeProductEanComparison(eanInput.value);
  const product = normalizeProductEanComparison(productInput.value);
  const duplicated = Boolean(ean && product && ean === product);
  const message = 'A descrição do produto não pode ser igual ao EAN / código de barras. Informe a descrição do produto.';

  productInput.setCustomValidity(duplicated ? message : '');
  const errorMessage = $('#productEanError');
  if (duplicated) productInput.setAttribute('aria-invalid', 'true');
  else productInput.removeAttribute('aria-invalid');
  if (errorMessage) {
    errorMessage.textContent = duplicated ? message : '';
    errorMessage.classList.toggle('hidden', !duplicated);
  }

  return !duplicated;
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
  if (!validateProductEanMatch()) {
    toast('A descrição do produto não pode ser igual ao EAN / código de barras.', 'error');
    $('#orderProduct').focus();
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

function renderStoreTable(orders) {
  if (!orders.length) return emptyState('Nenhuma encomenda encontrada', 'Ajuste os filtros ou envie uma nova solicitação para começar.');
  return `<div class="table-scroll"><table class="data-table store-data-table">
    <colgroup><col class="col-date"><col class="col-ean"><col class="col-product"><col class="col-qty"><col class="col-status"><col class="col-date"></colgroup>
    <thead><tr>${sortableHeader('Data da solicitação', 'createdAt', 'store')}${sortableHeader('EAN', 'ean', 'store')}${sortableHeader('Produto', 'product', 'store')}${sortableHeader('Qtd.', 'qty', 'store')}${sortableHeader('Status', 'status', 'store')}${sortableHeader('Última atualização', 'updatedAt', 'store')}</tr></thead>
    <tbody>${orders.map(order => `<tr>
      <td class="date-cell">${formatDate(order.createdAt, true)}</td><td class="ean-cell" title="${escapeHTML(order.ean)}">${escapeHTML(order.ean)}</td><td class="product-cell" title="${escapeHTML(order.product)}"><span class="product-text">${escapeHTML(order.product)}</span></td><td class="qty-cell">${Number(order.qty || 0)}</td><td>${statusBadge(order.status)}</td><td class="date-cell">${formatDate(order.updatedAt, true)}</td>
    </tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Use os títulos das colunas para alternar a ordenação.</span><span>${orders.length} item(ns)</span></div>`;
}
