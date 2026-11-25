const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export function buildDispatchPrintHtml(
  items,
  { createdAt = new Date(), unparsedCount = 0, batchLabel = '' } = {},
) {
  if (!items.length)
    throw new Error(
      'Nenhum produto identificado para imprimir. Interprete ou complete os itens na prévia.',
    );
  const suppliers = new Map();
  const key = (name) =>
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
  for (const [index, item] of items.entries()) {
    if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0)
      throw new Error(`Confira a quantidade do item ${index + 1} antes de imprimir.`);
    const supplier = item.supplier?.trim() || 'Fornecedor não informado';
    if (!suppliers.has(key(supplier)))
      suppliers.set(key(supplier), {
        name: supplier,
        missing: !item.supplier?.trim(),
        sellers: new Map(),
        count: 0,
      });
    const group = suppliers.get(key(supplier)),
      seller = item.seller?.trim() || 'Vendedor não informado';
    if (!group.sellers.has(key(seller)))
      group.sellers.set(key(seller), { name: seller, missing: !item.seller?.trim(), items: [] });
    group.sellers.get(key(seller)).items.push(item);
    group.count++;
  }
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  const compare = (a, b) =>
    Number(a.missing) - Number(b.missing) || collator.compare(a.name, b.name);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Import Laser — Conferência de expedição</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:11pt Arial,sans-serif;color:#111;margin:0}.supplierPage+.supplierPage{break-before:page;page-break-before:always}h1{font-size:17pt;margin:0 0 5mm}.supplierTitle{font-size:15pt;font-weight:bold;margin:3mm 0}header p{margin:2mm 0;font-size:10pt}h2{font-size:13pt;margin:7mm 0 3mm;break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:5mm}th,td{border:1px solid #aaa;padding:3mm;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}th:first-child{width:23%}th:nth-child(2){width:18%}th:nth-child(3){width:10%;text-align:center}td:nth-child(3){text-align:center}thead{display:table-header-group}tr{break-inside:avoid}.notice{border:1px solid #888;padding:3mm;font-size:10pt}footer{margin-top:6mm;font-size:9pt;color:#444}
</style></head><body>
${[...suppliers.values()]
  .sort(compare)
  .map(
    (
      supplier,
      index,
    ) => `<section class="supplierPage" data-supplier="${escapeHtml(supplier.name)}"><header><h1>IMPORT LASER · Conferência de expedição</h1><div class="supplierTitle">Fornecedor: ${escapeHtml(supplier.name)}</div>${batchLabel ? `<p>Solicitação: ${escapeHtml(batchLabel)}</p>` : ''}<p>Destinação dos itens por vendedor</p><p>Emitido em ${escapeHtml(createdAt.toLocaleString('pt-BR'))} · ${supplier.count} item(ns)</p></header>
${unparsedCount && index === 0 ? `<p class="notice">A mensagem contém ${Number(unparsedCount)} texto(s) não convertido(s) em itens. Confira a prévia para garantir que todos os produtos foram incluídos.</p>` : ''}
${[...supplier.sellers.values()]
  .sort(compare)
  .map(
    (
      seller,
    ) => `<section><h2>Vendedor: ${escapeHtml(seller.name)}</h2><table><thead><tr><th>Cliente</th><th>Fornecedor</th><th>Qtd.</th><th>Item / descrição</th></tr></thead><tbody>
${seller.items.map((item) => `<tr><td>${escapeHtml(item.client?.trim() || 'Cliente não informado')}</td><td>${escapeHtml(item.supplier?.trim() || 'Fornecedor não informado')}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.sku?.trim() || 'Item não informado')}</td></tr>`).join('\n')}
</tbody></table></section>`,
  )
  .join(
    '\n',
  )}<footer>Folha para conferência e destinação dos itens na expedição.</footer></section>`,
  )
  .join('\n')}</body></html>`;
}

export function printDispatch(items, options) {
  const html = buildDispatchPrintHtml(items, options);
  document.querySelector('iframe[data-dispatch-print]')?.remove();
  const frame = document.createElement('iframe');
  frame.dataset.dispatchPrint = 'true';
  frame.title = 'Impressão para conferência de expedição';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:1px;border:0';
  return new Promise((resolve, reject) => {
    frame.onload = () => {
      try {
        const target = frame.contentWindow;
        target.addEventListener('afterprint', () => frame.remove(), { once: true });
        target.focus();
        target.print();
        resolve();
      } catch {
        frame.remove();
        reject(new Error('Não foi possível abrir a impressão. Tente novamente neste navegador.'));
      }
    };
    frame.onerror = () => {
      frame.remove();
      reject(new Error('Não foi possível preparar a folha de impressão.'));
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
