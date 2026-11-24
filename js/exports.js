'use strict';

/* Exportações de relatórios e integração com o formato A7. */

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

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function excelColumnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  files.forEach(file => {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + data.length;
    centralSize += centralHeader.length;
  });

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function createA7Workbook(rows) {
  const worksheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${excelColumnName(columnIndex)}${rowIndex + 1}`;
      // CNPJ e EAN são gravados como texto para preservar zeros à esquerda.
      if (columnIndex < 2 || rowIndex === 0) {
        return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
      }
      return `<c r="${reference}"><v>${Number(value)}</v></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C${rows.length}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/></cols><sheetData>${worksheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A7" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return createStoredZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: worksheet }
  ]);
}

function exportA7Excel(orders, selectedStatuses) {
  if (!orders.length) {
    toast('Não há registros no período selecionado para exportar.', 'error');
    return;
  }
  const selectedRows = orders.filter(order => selectedStatuses.has(order.status));
  if (!selectedRows.length) {
    toast('Não existem encomendas com os status selecionados neste período.', 'error');
    return;
  }

  const rows = [['CNPJ', 'EAN', 'QTD']];
  let skippedWithoutEan = 0;
  let skippedInvalid = 0;
  selectedRows.forEach(order => {
    const cnpj = String(order.cnpj || '').replace(/\D/g, '').slice(0, 14);
    const ean = String(order.ean || '').replace(/\D/g, '');
    const qty = Number(order.qty || 0);
    if (cnpj.length !== 14 || !Number.isInteger(qty) || qty < 1) { skippedInvalid++; return; }
    if (!ean) { skippedWithoutEan++; return; }
    rows.push([cnpj, ean, qty]);
  });

  if (rows.length === 1) {
    toast('Nenhuma linha válida para o A7. Verifique CNPJ, EAN e quantidade.', 'error');
    return;
  }

  const blob = createA7Workbook(rows);
  downloadBlob(blob, `A7_encomendas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  const exported = rows.length - 1;
  const warnings = [];
  if (skippedWithoutEan) warnings.push(`${skippedWithoutEan} sem EAN`);
  if (skippedInvalid) warnings.push(`${skippedInvalid} com CNPJ ou quantidade inválida`);
  toast(`${exported} item(ns) exportado(s) para o A7 em Excel${warnings.length ? `. Ignorados: ${warnings.join('; ')}.` : '.'}`);
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
    exportA7Excel(orders, statuses);
  });
  $('#exportDialog').addEventListener('click', event => {
    if (event.target === $('#exportDialog')) closeExportDialog();
  });
}
