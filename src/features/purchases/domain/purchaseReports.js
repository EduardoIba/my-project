import { purchasedValue } from './purchases.js';
import { localDate, validDate } from './whatsapp.js';
import { purchaseHistoryRows } from './purchaseLedger.js';

export function purchasePeriod(period) {
  const today = localDate();
  if (period === 'hoje') return { from: today, to: today };
  if (period === 'mes') {
    const [year, month] = today.split('-').map(Number);
    return {
      from: `${today.slice(0, 7)}-01`,
      to: `${today.slice(0, 7)}-${new Date(year, month, 0).getDate()}`,
    };
  }
  return { from: '', to: '' };
}

// Explicit equivalences supplied by the user take precedence over descriptions/types.
export const DEMAND_MODEL_RULES = [
  ['DR3602', 'dr3602'],
  ['W1810X', 'w1810x?'],
  ['DR2340', 'dr2340'],
  ['TN3492', 'tn3492'],
  ['CE310', 'ce310a?'],
  ['CE311', 'ce311a?'],
  ['CE312', 'ce312a?'],
  ['CE313', 'ce313a?'],
  ['CE314', 'ce314a?'],
  ['CB540', 'cb540a?'],
  ['CB541', 'cb541a?'],
  ['CB542', 'cb542a?'],
  ['CB543', 'cb543a?'],
  ['TN750', 'tn750'],
  ['TN116', 'tn116'],
  ['CF279', 'cf279a?'],
  ['D204U', 'd204u'],
  ['D205E', 'd205e'],
  ['1332', '1332'],
  ['PB210', 'pb210'],
  ['D105L', 'd105l'],
  ['CF226X', 'cf226x'],
];
// Permanent TN2340 equivalence: full compatibility lists, short descriptions,
// C/ or P/ and leading/trailing dashes all describe the same purchased toner.
export const TN2340_DEMAND_MODEL = 'tn2340';
// Other models continue to use type + model; purchase records stay intact.
export function productDemandKey(description) {
  const normalized = String(description || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/([a-z])\s*[-–—]\s*(?=\d)/g, '$1')
    .replace(/\b(tn|dr|cf|ce|cb|w|pb|d)\s+(?=\d{3,})/g, '$1')
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const explicit = DEMAND_MODEL_RULES.find(([, pattern]) =>
    new RegExp('\\b(?:' + pattern + ')\\b').test(normalized),
  );
  if (explicit) return 'equivalent:' + explicit[0];
  const type =
    /\bchip\b/.test(normalized) && !/\b(?:com|sem|c|s)\s+chip\b/.test(normalized)
      ? 'chip'
      : /\b(fotocondutor|cilindro|drum)\b/.test(normalized)
        ? 'fotocondutor'
        : /\btoner\b/.test(normalized)
          ? 'toner'
          : /\b(cartucho|cart)\b/.test(normalized)
            ? 'cartucho'
            : /\b(tinta|refil)\b/.test(normalized)
              ? 'tinta'
              : '';
  // Letter/number codes avoid mistaking capacities and pack sizes for a model.
  const models = normalized.match(/\b[a-z]{1,6}\d{2,}[a-z]{0,3}\b/g) || [];
  if ((!type || type === 'toner' || type === 'cartucho') && models.includes(TN2340_DEMAND_MODEL))
    return 'toner:' + TN2340_DEMAND_MODEL;
  const model = models[0];
  if (type && model) return type + ':' + model;
  return normalized;
}

export function purchaseReport(
  rows,
  { from = '', to = '', supplier = 'Todos', client = '', seller = '', search = '' } = {},
) {
  const purchased = purchaseHistoryRows(rows);
  const base = purchased.filter(
    (row) =>
      (supplier === 'Todos' || row.supplier === supplier) &&
      (!client || row.client === client) &&
      (!seller || (row.seller?.trim() || 'Não informado') === seller) &&
      [row.client, row.seller, row.supplier, row.sku]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const missingDates = base.filter((row) => !validDate(row.purchaseDate)).length;
  const purchases = base
    .filter(
      (row) =>
        (!from && !to) ||
        (validDate(row.purchaseDate) &&
          (!from || row.purchaseDate >= from) &&
          (!to || row.purchaseDate <= to)),
    )
    .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
  const groups = (field, byQuantity = false) => {
    const grouped = new Map();
    for (const row of purchases) {
      const name = row[field]?.trim() || 'Não informado';
      const key = byQuantity ? productDemandKey(name) : name;
      if (!grouped.has(key))
        grouped.set(key, {
          name: key === 'toner:tn2340' ? 'TONER TN2340' : name,
          items: 0,
          units: 0,
          cents: 0,
        });
      const group = grouped.get(key);
      group.items++;
      group.units += Number(row.purchasedQty);
      group.cents += Math.round(purchasedValue(row) * 100);
    }
    return [...grouped.values()]
      .map(({ cents, ...group }) => ({ ...group, total: cents / 100 }))
      .sort(
        (a, b) =>
          (byQuantity ? b.units - a.units : b.total - a.total) ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
  };
  return {
    purchases,
    missingDates,
    total: purchases.reduce((sum, row) => sum + Math.round(purchasedValue(row) * 100), 0) / 100,
    units: purchases.reduce((sum, row) => sum + Number(row.purchasedQty), 0),
    byClient: groups('client'),
    bySeller: groups('seller'),
    bySupplier: groups('supplier'),
    byProduct: groups('sku', true),
  };
}

export function lastPaidPrices(rows, { supplier = 'Todos', search = '' } = {}) {
  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
  const searchable = (value) => normalize(value).replace(/[^a-z0-9]/g, '');
  const query = searchable(search);
  if (!query) return [];
  const groups = new Map();
  for (const row of purchaseHistoryRows(rows)) {
    if (
      (supplier !== 'Todos' && row.supplier !== supplier) ||
      !searchable(row.sku).includes(query) ||
      !Number.isFinite(row.unitCost) ||
      row.unitCost <= 0 ||
      row.purchasedQty <= 0
    )
      continue;
    // Match the complete stored description; do not merge different products
    // merely because a fragment such as TN2340 occurs in both names.
    const key = JSON.stringify([normalize(row.sku), normalize(row.supplier)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .map((entries) => {
      const dated = entries.filter((row) => validDate(row.purchaseDate));
      const date = dated
        .map((row) => row.purchaseDate)
        .sort()
        .at(-1);
      const sameDay = date ? dated.filter((row) => row.purchaseDate === date) : entries;
      const allTimesKnown = sameDay.every(
        (row) => row.purchasedAt && Number.isFinite(Date.parse(row.purchasedAt)),
      );
      const latestTime = allTimesKnown
        ? Math.max(...sameDay.map((row) => Date.parse(row.purchasedAt)))
        : null;
      const candidates =
        latestTime !== null
          ? sameDay.filter((row) => Date.parse(row.purchasedAt) === latestTime)
          : sameDay;
      const prices = [...new Set(candidates.map((row) => row.unitCost))];
      return {
        ...candidates[0],
        purchasedAt: candidates.length === 1 ? candidates[0].purchasedAt : null,
        candidates,
        prices,
        ambiguous: candidates.length > 1 && prices.length > 1,
        hasUndated: dated.length !== entries.length,
        purchaseDate: date || '',
      };
    })
    .sort(
      (a, b) =>
        b.purchaseDate.localeCompare(a.purchaseDate) ||
        a.sku.localeCompare(b.sku, 'pt-BR') ||
        (a.supplier || '').localeCompare(b.supplier || '', 'pt-BR'),
    );
}
