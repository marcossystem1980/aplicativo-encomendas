'use strict';

/* Filtros de período usados pela Visão geral unificada. */

function filterReportOrders(orders) {
  // Sem um período informado, não descarte registros por ausência de data.
  if (!state.reportMonth && !state.reportFrom && !state.reportTo) return orders;

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
