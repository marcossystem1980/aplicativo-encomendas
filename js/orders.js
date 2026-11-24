'use strict';

/* Operações, tabelas, filtros e seleção de encomendas. */

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
  // A Visão geral reúne a análise por período e a gestão operacional das encomendas.
  const periodOrders = state.reportApplied ? filterReportOrders(allOrders) : allOrders;
  const filtered = filterBuyerOrders(periodOrders);
  const sorted = sortOrders(filtered, 'overview');
  pruneSelection('buyer', sorted);

  const pendingRows = periodOrders.filter(order => order.status === 'pending');
  const boughtRows = periodOrders.filter(order => order.status === 'bought');
  const shortageRows = periodOrders.filter(order => order.status === 'shortage');
  const totalQty = periodOrders.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const pendingQty = pendingRows.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const boughtQty = boughtRows.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const shortageQty = shortageRows.reduce((sum, order) => sum + Number(order.qty || 0), 0);

  $('#pageContent').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">PAINEL DE COMPRAS</span><h1>Visão geral das encomendas</h1><p>Acompanhe solicitações, resultados e relatórios em uma única tela.</p></div><div class="heading-actions"><button class="btn btn-primary btn-small" id="exportOverviewReport" type="button">↓ Exportar relatório</button></div></div>
    <section class="panel overview-period-panel">
      <div class="panel-header"><div><h2 class="panel-title">Filtrar período</h2><p class="panel-subtitle">Escolha um mês ou informe uma data inicial e final.</p></div></div>
      <div class="panel-body"><form id="overviewPeriodFilterForm" class="report-filters">
        <div class="field"><label for="reportMonth">Mês de referência</label><input id="reportMonth" type="month" value="${escapeHTML(state.reportMonth)}"></div>
        <div class="field"><label for="reportFrom">Data inicial</label><input id="reportFrom" type="date" value="${escapeHTML(state.reportFrom)}"></div>
        <div class="field"><label for="reportTo">Data final</label><input id="reportTo" type="date" value="${escapeHTML(state.reportTo)}"></div>
        <div class="form-actions overview-period-actions"><button class="btn btn-primary" type="submit">Aplicar filtros</button><button class="btn btn-outline" id="clearOverviewPeriodFilter" type="button">Limpar</button></div>
      </form></div>
    </section>
    <div class="stats-grid overview-summary">
      ${statCard('Produtos solicitados', periodOrders.length, `${totalQty} unidade(s) solicitada(s)`, '▤')}
      ${statCard('Pendentes', pendingRows.length, `${pendingQty} unidade(s) aguardando`, '◷', 'warning')}
      ${statCard('Comprados', boughtRows.length, `${boughtQty} unidade(s) comprada(s)`, '✓')}
      ${statCard('Em falta', shortageRows.length, `${shortageQty} unidade(s) em falta`, '!', 'danger')}
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
    </section>
    <p class="report-note">Os indicadores consideram o período selecionado. A pesquisa e o filtro de status refinam a tabela e os arquivos exportados. Cada linha representa uma solicitação; as unidades são somadas pelo campo Quantidade.</p>`;

  $('#overviewPeriodFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    const month = $('#reportMonth').value;
    const from = $('#reportFrom').value;
    const to = $('#reportTo').value;
    if (from && to && from > to) {
      toast('A data inicial não pode ser posterior à data final.', 'error');
      return;
    }
    if (month && (from || to)) {
      toast('Use o filtro por mês ou o intervalo de datas, não os dois ao mesmo tempo.', 'error');
      return;
    }
    state.reportMonth = month;
    state.reportFrom = from;
    state.reportTo = to;
    state.reportApplied = true;
    state.buyerSelectedIds.clear();
    renderBuyerOverview(readOrders());
  });

  $('#clearOverviewPeriodFilter').addEventListener('click', () => {
    state.reportMonth = '';
    state.reportFrom = '';
    state.reportTo = '';
    state.reportApplied = false;
    state.buyerSelectedIds.clear();
    renderBuyerOverview(readOrders());
  });

  $('#exportOverviewReport').addEventListener('click', () => openReportExportDialog(filtered));
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
function renderBuyerTable(orders, options = {}) {
  const { selectable = false, sortScope = 'overview' } = options;
  if (!orders.length) return emptyState('Nenhuma solicitação encontrada', 'Ajuste o período, a pesquisa ou o status para localizar encomendas.');
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
