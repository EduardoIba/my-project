import {DEFAULT_SUPPLIERS, getSuppliers} from './catalogs.js';
export const DEFAULT_RULES = {
  aliases: '',
};
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const supplierKey = value => normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function supplierAliases(rules = DEFAULT_RULES, suppliers = DEFAULT_SUPPLIERS) {
  const aliases = new Map();
  for (const name of suppliers) {
    aliases.set(supplierKey(name), name);
    aliases.set(`${supplierKey(name)}br`, name);
  }
  for (const line of (rules.aliases || '').split('\n').filter(line => line.trim())) {
    const parts = line.split('=');
    const supplier = suppliers.find(name => normalize(name) === normalize(parts[1] || ''));
    if (parts.length !== 2 || !parts[0].trim() || !supplier) {
      throw new Error(`Regra inválida: ${line}. Use ALTERNATIVA=Fornecedor cadastrado.`);
    }
    const alias = supplierKey(parts[0]);
    if (aliases.has(alias) && aliases.get(alias) !== supplier) throw new Error(`Apelido conflitante: ${parts[0]}.`);
    aliases.set(alias, supplier);
  }
  return aliases;
}

export function blankItem(values = {}) {
  return {id: makeId(), supplier: '', supplierOriginal: '', seller: '', client: '', quantity: 1,
    sku: '', price: '', date: localDate(), notes: '', originalLine: '', ...values};
}

function readDate(text) {
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const value = br ? `${br[3]}-${br[2]}-${br[1]}` : text;
  return validDate(value) ? value : null;
}

function looksLikeHeaderName(text) {
  const name = normalize(text);
  // Bare client names are accepted only in headers. Product fragments and generic
  // message headings remain visible for review, never silently becoming a client.
  return text.length <= 100 && text.split(/\s+/).length <= 8
    && /^[\p{L}][\p{L}\s.'’&-]*$/u.test(text)
    && !/\b(papel|toner|cartucho|cart|chip|plastico|plastificacao|adesivo|refil|cilindro|tinta|impressora|produto|sku|compativel|glossy|folhas|fornecedor|vendedor|cliente|lista|compras|pedido|orcamento|total|urgente)\b/.test(name)
    && !/^(bom dia|boa tarde|boa noite|ola|obrigad[oa])\b/.test(name);
}

export function parseMessage(message, {sellers = [], suppliers = DEFAULT_SUPPLIERS, rules = DEFAULT_RULES, date = localDate()} = {}) {
  const aliases = supplierAliases(rules, suppliers);
  const context = {supplier: '', supplierOriginal: '', seller: '', client: '', date, notes: ''};
  const items = [], review = [], recognized = [];
  let headerOpen = true, expectingClient = false;
  const unresolved = (text, line, reason) => review.push({id: makeId(), text, line, reason, resolution: ''});
  const lines = message.split(/\r?\n/);
  const nonempty = lines.map((text, index) => ({text: text.trim(), index})).filter(line => line.text);
  const productLine = text => /^\d+\s*[-–—]\s*.+$/.test(text);
  // The simple format takes precedence over name matching for the client.
  // Keep existing supplier-first and explicitly labelled messages compatible.
  const positional = nonempty.length >= 3
    && !nonempty[0].text.includes(':')
    && !nonempty.slice(0, 2).some(line => productLine(line.text) || /^(fornecedor|vendedor|cliente|data(?: da solicitação)?|obs(?:ervações)?)\s*:/i.test(line.text))
    && productLine(nonempty[2].text)
    && (!aliases.has(supplierKey(nonempty[0].text)) || sellers.some(name => normalize(name) === normalize(nonempty[0].text)));
  lines.forEach((original, index) => {
    const text = original.trim();
    if (!text) return;
    const line = index + 1;
    if (positional && index === nonempty[0].index) {
      context.seller = sellers.find(name => normalize(name) === normalize(text)) || '';
      if (context.seller) recognized.push({line, text: original});
      else unresolved(original, line, 'Vendedor da primeira linha não cadastrado. Selecione o vendedor na prévia.');
      return;
    }
    if (positional && index === nonempty[1].index) {
      context.client = text;
      recognized.push({line, text: original});
      return;
    }
    const item = text.match(/^(\d+)\s*[-–—]\s*(.+)$/);
    if (item) {
      headerOpen = false; expectingClient = false;
      let description = item[2], price = '';
      // Only a decimal price at the end, separated from the description, is a price.
      const money = description.match(/(?:\s*R\$\s*|\s*-{2,}\s*|\s+)((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*$/i);
      if (money) {
        price = Number(money[1].replaceAll('.', '').replace(',', '.'));
        description = description.slice(0, money.index).trim();
      }
      items.push(blankItem({...context, quantity: Number(item[1]), sku: description, price, originalLine: original, sourceLine: line}));
      return;
    }
    const labelled = text.match(/^(fornecedor|vendedor|cliente|data(?: da solicita[çc][ãa]o)?|obs(?:erva[çc][õo]es)?)[\s]*:\s*(.*)$/i);
    if (labelled) {
      headerOpen = true;
      const label = normalize(labelled[1]), value = labelled[2].trim();
      if (label === 'fornecedor' && aliases.has(supplierKey(value))) {
        context.supplier = aliases.get(supplierKey(value)); context.supplierOriginal = value;
      } else if (label === 'vendedor' && sellers.some(name => normalize(name) === normalize(value))) {
        context.seller = sellers.find(name => normalize(name) === normalize(value));
        context.client = ''; expectingClient = true;
      } else if (label === 'cliente' && value) {context.client = value; expectingClient = false;}
      else if (label.startsWith('data') && readDate(value)) context.date = readDate(value);
      else if (label.startsWith('obs') && value) context.notes = [context.notes, value].filter(Boolean).join('\n');
      else {
        if (label === 'fornecedor') { context.supplier = ''; context.supplierOriginal = value; }
        if (label === 'vendedor') context.seller = '';
        if (label === 'cliente') context.client = '';
        unresolved(original, line, 'Cabeçalho não reconhecido; confira o valor.'); return;
      }
      recognized.push({line, text: original}); return;
    }
    if (expectingClient) {
      context.client = text; expectingClient = false;
      recognized.push({line, text: original}); return;
    }
    const seller = sellers.find(name => normalize(name) === normalize(text));
    if (aliases.has(supplierKey(text)) && seller) {
      unresolved(original, line, 'Nome cadastrado como fornecedor e vendedor. Defina os campos na prévia.'); return;
    }
    if (aliases.has(supplierKey(text))) {
      headerOpen = true;
      context.supplier = aliases.get(supplierKey(text)); context.supplierOriginal = text;
      expectingClient = false;
      recognized.push({line, text: original}); return;
    }
    if (seller) {
      context.seller = seller; context.client = ''; expectingClient = true; headerOpen = true; recognized.push({line, text: original}); return;
    }
    const nextLine = nonempty.find(entry => entry.index > index);
    if (context.seller && context.client && !headerOpen && looksLikeHeaderName(text.replace(/\bcliente\b/gi, 'Nome')) && nextLine && productLine(nextLine.text)) {
      context.client = text; recognized.push({line, text: original}); return;
    }
    if (headerOpen && !context.client && looksLikeHeaderName(text)) {
      context.client = text; recognized.push({line, text: original}); return;
    }
    unresolved(original, line, 'Texto não identificado automaticamente. Se necessário, aproveite-o na prévia.');
  });
  return {items, review, recognized};
}

export function itemErrors(item, {mode = 'request', sellers = [], suppliers = DEFAULT_SUPPLIERS} = {}) {
  const errors = [];
  if (!suppliers.includes(item.supplier)) errors.push('fornecedor');
  if (!sellers.includes(item.seller)) errors.push('vendedor');
  if (!item.client?.trim()) errors.push('cliente');
  if (!item.sku?.trim()) errors.push('produto');
  if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0) errors.push('quantidade');
  const hasPrice = item.price !== '' && item.price != null;
  if ((hasPrice && (!Number.isFinite(Number(item.price)) || Number(item.price) < 0)) ||
      (mode === 'purchase' && (!hasPrice || Number(item.price) <= 0))) errors.push('valor unitário');
  if (!validDate(item.date)) errors.push('data da solicitação');
  if (hasPrice && !Number.isFinite(Number(item.price) * Number(item.quantity))) errors.push('subtotal');
  return errors;
}

export function previewTotal(items) {
  return items.reduce((sum, item) => {
    const subtotal = Math.round(Number(item.price || 0) * Number(item.quantity) * 100);
    return sum + (Number.isFinite(subtotal) ? subtotal : 0);
  }, 0) / 100;
}

export function importIssues(batch, {sellers = [], suppliers = DEFAULT_SUPPLIERS} = {}) {
  const issues = [];
  if (!batch.items.length) issues.push('Adicione pelo menos um produto.');
  batch.items.forEach((item, index) => {
    const errors = itemErrors(item, {mode: batch.mode, sellers, suppliers});
    if (errors.length) issues.push(`Item ${index + 1}: preencha ou corrija ${errors.join(', ')}.`);
  });
  // Unparsed text is retained for optional review; valid rows do not require a second approval.
  if (batch.mode === 'purchase') {
    if (!validDate(batch.purchaseDate)) issues.push('Informe uma data válida para a compra.');
    if (!batch.purchaseConfirmed) issues.push('Marque a confirmação de compra realizada.');
  }
  return issues;
}

export function applyBulkItems(items, values, selected = []) {
  const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim()).map(([field, value]) => [field, String(value).trim()]));
  return items.map(item => !selected.length || selected.includes(item.id) ? {...item, ...changes} : item);
}

export const REVIEW_ACTIONS = [
  {value: 'client', label: 'Usar texto como cliente dos selecionados', description: 'Substitui o nome do cliente somente nos produtos marcados.'},
  {value: 'notes', label: 'Acrescentar texto às observações dos selecionados', description: 'Acrescenta este texto sem apagar as observações existentes dos produtos marcados.'},
  {value: 'product', label: 'Criar uma linha de produto para editar', description: 'Cria uma linha com este texto na descrição. Complete os campos obrigatórios e confira a quantidade e o preço na prévia.'},
  {value: 'keep', label: 'Manter somente na mensagem original', description: 'Não altera nenhum produto. O texto continua guardado na mensagem original.'},
];

export function applyReviewAction(preview, lineId, action, selected = []) {
  const line = preview.review.find(entry => entry.id === lineId);
  const option = REVIEW_ACTIONS.find(entry => entry.value === action);
  if (!line || !option) throw new Error('Selecione uma ação válida para este texto.');
  if (line.resolution) return preview;
  const targets = preview.items.filter(item => selected.includes(item.id));
  if (['client', 'notes'].includes(action) && !targets.length) throw new Error('Selecione os produtos que receberão este texto usando as caixas da tabela.');
  let items = preview.items;
  if (action === 'product') items = [...items, blankItem({sku: line.text, originalLine: line.text, sourceLine: line.line})];
  else if (action === 'client' || action === 'notes') items = items.map(item => selected.includes(item.id)
    ? {...item, [action]: action === 'client' ? line.text.trim() : [item.notes, line.text].filter(Boolean).join('\n')} : item);
  return {...preview, items, review: preview.review.map(entry => entry.id === lineId
    ? {...entry, action, resolution: option.label + (targets.length && ['client', 'notes'].includes(action) ? ` (${targets.length} produto(s))` : '')} : entry)};
}

export function commitImport(db, batch) {
  // A batch token is reused until this preview has been saved, so repeated clicks are idempotent.
  if ((db.imports || []).some(entry => entry.id === batch.id)) return db;
  if (!batch.id || !batch.items.length) throw new Error('Adicione pelo menos um produto.');
  if (!['request', 'purchase'].includes(batch.mode)) throw new Error('Tipo de importação inválido.');
  const issues = importIssues(batch, {sellers: db.sellers, suppliers: getSuppliers(db)});
  if (issues.length) throw new Error(issues.join('\n'));
  const purchased = batch.mode === 'purchase';
  const createdAt = new Date().toISOString();
  const requests = batch.items.map(item => ({
    id: makeId(), seller: item.seller, client: item.client.trim(), sku: item.sku.trim(),
    quantity: Number(item.quantity), supplier: item.supplier, date: item.date,
    purchasedQty: purchased ? Number(item.quantity) : 0,
    unitCost: purchased ? Number(item.price) : 0,
    referenceUnitPrice: item.price === '' || item.price == null ? null : Number(item.price),
    purchaseDate: purchased ? batch.purchaseDate : '', status: purchased ? 'Comprado' : 'Pendente',
    notes: item.notes || '', orderStatus: 'waiting', importId: batch.id, originalLine: item.originalLine || '',
    supplierOriginal: item.supplierOriginal || '', updatedAt: createdAt,
  }));
  const entry = {id: batch.id, sequence: nextBatchSequence(db), source: 'whatsapp', originalMessage: batch.originalMessage, createdAt, mode: batch.mode,
    review: batch.review, recognized: batch.recognized || [], rules: batch.rules,
    originalItemLines: batch.originalItemLines || [], itemCount: requests.length};
  return {...db, activeBatchId: batch.id, requests: [...requests, ...db.requests], imports: [entry, ...(db.imports || [])]};
}

export const LEGACY_BATCH = '__previous_records__';
export const requestBatchId = row => row.importId || row.batchId || LEGACY_BATCH;
export function nextBatchSequence(db) {
  return Math.max(Number(db.lastBatchSequence) || 0, (db.imports || []).length, ...(db.imports || []).map(entry => Number(entry.sequence) || 0)) + 1;
}
export function requestBatches(db) {
  const entries = db.imports || [];
  const batches = entries.map((entry, index) => ({...entry,
    label: `Lote ${String(entry.sequence || entries.length - index).padStart(3, '0')}`,
    rows: db.requests.filter(row => requestBatchId(row) === entry.id),
  }));
  const known = new Set(entries.map(entry => entry.id));
  const orphanIds = [...new Set(db.requests.map(requestBatchId).filter(id => id !== LEGACY_BATCH && !known.has(id)))];
  for (const id of orphanIds) batches.push({id, label: `Solicitação anterior (${id.slice(0, 8)})`, rows: db.requests.filter(row => requestBatchId(row) === id)});
  const previous = db.requests.filter(row => requestBatchId(row) === LEGACY_BATCH);
  if (previous.length) batches.push({id: LEGACY_BATCH, label: 'Registros anteriores sem lote', rows: previous, legacy: true});
  return batches;
}
export function saveManualRequest(db, item) {
  const id = makeId(), createdAt = new Date().toISOString();
  return {...db, activeBatchId: id, requests: [{...item, importId: id}, ...db.requests], imports: [
    {id, sequence: nextBatchSequence(db), source: 'manual', createdAt, itemCount: 1, originalMessage: ''}, ...(db.imports || []),
  ]};
}
