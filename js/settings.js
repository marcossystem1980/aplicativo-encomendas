'use strict';

/* Configurações, cadastro de lojas e importação de planilhas. */

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
