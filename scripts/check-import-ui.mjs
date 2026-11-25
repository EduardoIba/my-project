// Run against the local app and an isolated Chromium debugging port.
// This script creates/disposes an incognito context; it never uses the personal profile.
import assert from 'node:assert/strict';
import { PURCHASE_RESET_VERSION, RESET_BACKUP_KEY } from '../storage.js';
import { DEFAULT_SELLERS } from '../sellers.js';
const appUrl = process.argv[2] || 'http://127.0.0.1:5173/';
const debugUrl = process.argv[3] || 'http://127.0.0.1:9229';
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url),
      pending = new Map(),
      errors = [];
    let sequence = 0;
    socket.addEventListener('error', reject);
    socket.addEventListener('message', (event) => {
      const result = JSON.parse(event.data);
      if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails);
      if (result.id && pending.has(result.id)) {
        const task = pending.get(result.id);
        pending.delete(result.id);
        result.error
          ? task.reject(new Error(JSON.stringify(result.error)))
          : task.resolve(result.result);
      }
    });
    socket.addEventListener('open', () =>
      resolve({
        errors,
        close: () => socket.close(),
        send: (method, params = {}) =>
          new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
          }),
      }),
    );
  });
}
const version = await (await fetch(`${debugUrl}/json/version`)).json(),
  browser = await connect(version.webSocketDebuggerUrl);
const { browserContextId } = await browser.send('Target.createBrowserContext');
let page;
try {
  const { targetId } = await browser.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const targets = await (await fetch(`${debugUrl}/json/list`)).json();
  page = await connect(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  async function evaluate(expression) {
    const response = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function wait(expression) {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout: ${expression}`);
  }
  const helpers = `window.clickText=text=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!button)throw new Error('Botão ausente: '+text);button.click()};
 window.setField=(selector,value)=>{const el=document.querySelector(selector);if(!el)throw new Error('Campo ausente: '+selector);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};
 window.readDb=()=>JSON.parse(localStorage.getItem('importlaser-compras-v1'));`;
  async function reload() {
    await page.send('Page.reload');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await wait("!!document.querySelector('nav')");
    await evaluate(helpers);
  }
  async function openBatch(label) {
    await evaluate("clickText('Histórico de solicitações')");
    await wait("!!document.querySelector('.batchHistory')");
    await evaluate(`document.querySelector('[aria-label="Abrir ${label}"]').click()`);
    await wait(`document.querySelector('.panelHead h2')?.textContent===${JSON.stringify(label)}`);
  }
  async function importMessage(text, count) {
    await evaluate("clickText('Nova solicitação')");
    await wait("!!document.querySelector('.whatsappImport')");
    await evaluate(`setField('.whatsappImport>label textarea',${JSON.stringify(text)})`);
    await evaluate("clickText('Interpretar mensagem')");
    await wait(`document.querySelectorAll('.importTable tbody tr').length===${count}`);
    const before = await evaluate('readDb().requests.length');
    await evaluate("clickText('Confirmar e salvar solicitações')");
    await wait(
      `document.querySelector('h1')?.textContent==='Solicitações'&&document.querySelectorAll('.productCell').length===${count}`,
    );
    assert.equal(await evaluate('readDb().requests.length'), before + count);
    assert.equal(
      await evaluate("document.querySelectorAll('.tableWrap tbody input:checked').length"),
      0,
    );
  }
  await page.send('Page.navigate', { url: appUrl });
  await wait("!!document.querySelector('nav')");
  const legacy = {
    purchaseResetVersion: PURCHASE_RESET_VERSION,
    suppliers: ['Master', 'Potencial', 'Imprime', 'FA Print', 'RHB'],
    sellers: DEFAULT_SELLERS,
    whatsappRules: { aliases: '' },
    requests: [1, 2].map((id) => ({
      id: `legacy-${id}`,
      sku: `Antigo ${id}`,
      supplier: 'Master',
      seller: 'Cardoso',
      client: 'Anterior',
      quantity: 1,
      purchasedQty: 0,
      unitCost: 0,
      referenceUnitPrice: 1,
      status: 'Pendente',
      date: '2026-11-04',
    })),
    imports: [],
  };
  const resetSource = {
    ...legacy,
    purchaseResetVersion: undefined,
    activeBatchId: 'old',
    imports: [{ id: 'old', itemCount: 2 }],
    requests: legacy.requests.map((row) => ({
      ...row,
      importId: 'old',
      status: 'Comprado',
      purchasedQty: 1,
      unitCost: 10,
      purchaseDate: '2026-11-05',
    })),
  };
  await evaluate(
    `localStorage.setItem('importlaser-compras-v1',${JSON.stringify(JSON.stringify(resetSource))})`,
  );
  await reload();
  assert.deepEqual(await evaluate('readDb().requests'), []);
  assert.deepEqual(await evaluate('readDb().imports'), []);
  assert.equal(await evaluate('readDb().activeBatchId'), '');
  assert.deepEqual(await evaluate('readDb().sellers'), legacy.sellers);
  assert.deepEqual(await evaluate('readDb().suppliers'), legacy.suppliers);
  assert.deepEqual(
    await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(RESET_BACKUP_KEY)})).data`),
    JSON.parse(JSON.stringify(resetSource)),
  );
  assert.ok(
    (
      await evaluate("[...document.querySelectorAll('.stats strong')].map(el=>el.textContent)")
    ).every((text) => text === '0' || text.replace(/\s/g, '') === 'R$0,00'),
  );
  await evaluate("clickText('Relatórios')");
  await wait("!!document.querySelector('.reportTotals')");
  assert.ok(
    (await evaluate("document.querySelector('.reportTotals strong').textContent")).includes('0,00'),
  );
  await reload();
  assert.deepEqual(await evaluate('readDb().requests'), []);
  await evaluate(
    `localStorage.setItem('importlaser-compras-v1',${JSON.stringify(JSON.stringify(legacy))})`,
  );
  await reload();
  assert.deepEqual(await evaluate('readDb().requests'), legacy.requests);
  await evaluate("clickText('Solicitações')");
  await wait("!!document.querySelector('.orderViews')");
  const firstText =
    'Master\nCardoso\nCliente: Cliente Alpha\n05 - FITA ROTULADORA TZE251-24MM R$ 12,41\n05 - FITA ROTULADORA TZE221-9MM R$ 7,63\n05 - Produto Master 3 R$ 3,00\n05 - Produto Master 4 R$ 4,00\n05 - Produto Master 5 R$ 5,00\nPotencial\nCliente: Cliente Beta\n03 - Produto Potencial 1 R$ 6,00\n03 - Produto Potencial 2 R$ 7,00\n03 - Produto Potencial 3 R$ 8,00';
  await importMessage(firstText, 8);
  assert.equal(await evaluate("document.querySelector('.panelHead h2').textContent"), 'Lote 001');
  assert.deepEqual(
    await evaluate("[...document.querySelectorAll('.rowNumber')].map(el=>Number(el.textContent))"),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  const first = await evaluate('readDb().activeBatchId'),
    beforeGeneration = await evaluate('readDb()');
  await evaluate("document.querySelector('thead input[type=checkbox]').click()");
  await evaluate("clickText('Gerar pedido')");
  await wait("document.querySelectorAll('.supplierMessage').length===2");
  const generated = await evaluate(
    "[...document.querySelectorAll('.supplierMessage textarea')].map(el=>el.value)",
  );
  assert.deepEqual(
    generated.map((text) => text.split('\n').length),
    [5, 3],
  );
  assert.ok(generated[0].startsWith('05 - FITA ROTULADORA TZE251-24MM R$ 12,41'));
  assert.ok(generated.every((text) => !/Cliente Alpha|Cliente Beta|Cardoso/.test(text)));
  assert.deepEqual(
    await evaluate('readDb()'),
    beforeGeneration,
    'Opening grouped messages must not register purchases',
  );
  await browser.send('Browser.grantPermissions', {
    browserContextId,
    origin: new URL(appUrl).origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  await page.send('Page.bringToFront');
  await evaluate("document.querySelector('.supplierMessage button').click()");
  await wait(
    "document.querySelector('.orderMessages [role=status]')?.textContent.includes('copiada')",
  );
  assert.equal(
    (await evaluate('navigator.clipboard.readText()')).replaceAll('\r\n', '\n'),
    generated[0],
  );
  await evaluate(
    `setField('.supplierMessage textarea',${JSON.stringify(generated[0].replace('TZE251-24MM', 'TZE251-24MM CONFERIDO'))})`,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.supplierMessage textarea')[1].value"),
    generated[1],
  );
  await evaluate("clickText('Confirmar pedido gerado')");
  await wait("!document.querySelector('.orderMessages')");
  assert.equal(
    await evaluate("document.querySelectorAll('.productCell').length"),
    8,
    'Confirmation does not move products out of their batch',
  );
  assert.ok(
    await evaluate(
      `readDb().requests.filter(row=>row.importId===${JSON.stringify(first)}).every(row=>row.orderStatus==='generated'&&row.status==='Pendente'&&row.purchasedQty===0)`,
    ),
  );
  await evaluate("document.querySelector('.tableWrap tbody input[type=checkbox]').click()");
  const firstSnapshot = await evaluate(
    `readDb().requests.filter(row=>row.importId===${JSON.stringify(first)})`,
  );
  const secondText =
    'Imprime\nCardoso\nCliente: Cliente Gamma\n01 - Produto Imprime 1 R$ 2,00\n01 - Produto Imprime 2 R$ 2,00\n01 - Produto Imprime 3 R$ 2,00\n01 - Produto Imprime 4 R$ 2,00';
  await importMessage(secondText, 4);
  assert.equal(await evaluate("document.querySelector('.panelHead h2').textContent"), 'Lote 002');
  const second = await evaluate('readDb().activeBatchId');
  assert.notEqual(first, second);
  assert.deepEqual(
    await evaluate(`readDb().requests.filter(row=>row.importId===${JSON.stringify(first)})`),
    firstSnapshot,
  );
  assert.ok(
    (await evaluate("document.querySelector('.panel').innerText")).includes('Produto Imprime'),
  );
  await evaluate("setField('.filters input','Imprime 2')");
  await wait("document.querySelectorAll('.rowNumber').length===1");
  assert.equal(await evaluate("document.querySelector('.rowNumber').textContent"), '1');
  await evaluate("document.querySelector('thead input[type=checkbox]').click()");
  await evaluate("document.querySelector('.selectionBar button.secondary').click()");
  await wait("!!document.querySelector('.bulkRequestForm')");
  await evaluate(
    "document.querySelectorAll('.bulkRequestForm .formGrid input[type=checkbox]')[2].click()",
  );
  await evaluate("setField('[aria-label=\"Cliente das selecionadas\"]','Cliente corrigido')");
  await evaluate("clickText('Salvar alterações em massa')");
  await wait("!document.querySelector('.selectionBar')");
  assert.deepEqual(
    await evaluate(`readDb().requests.filter(row=>row.importId===${JSON.stringify(first)})`),
    firstSnapshot,
  );
  const secondSnapshot = await evaluate(
    `readDb().requests.filter(row=>row.importId===${JSON.stringify(second)})`,
  );
  await openBatch('Lote 001');
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 8);
  assert.equal(
    await evaluate("document.querySelectorAll('.tableWrap tbody input:checked').length"),
    0,
  );
  await evaluate("document.querySelector('.tableWrap tbody input[type=checkbox]').click()");
  await evaluate("clickText('Alterar status')");
  await wait('!!document.querySelector(\'[aria-label="Status das selecionadas"]\')');
  await evaluate("setField('[aria-label=\"Status das selecionadas\"]','Comprado')");
  assert.ok(
    (await evaluate("document.querySelector('.purchaseOperationSummary').textContent")).includes(
      '62,05',
    ),
  );
  await evaluate("clickText('Confirmar compra')");
  await wait("!document.querySelector('.selectionBar')");
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 8);
  await evaluate("document.querySelectorAll('.tableWrap tbody input[type=checkbox]')[1].click()");
  await evaluate("clickText('Alterar status')");
  await wait('!!document.querySelector(\'[aria-label="Status das selecionadas"]\')');
  await evaluate("setField('[aria-label=\"Status das selecionadas\"]','Parcial')");
  await evaluate("setField('[aria-label=\"Quantidade desta compra 1\"]','2')");
  await evaluate("clickText('Confirmar compra')");
  await wait("!document.querySelector('.selectionBar')");
  assert.deepEqual(
    await evaluate(`readDb().requests.filter(row=>row.importId===${JSON.stringify(second)})`),
    secondSnapshot,
  );
  assert.ok(
    await evaluate(
      `readDb().requests.filter(row=>row.importId===${JSON.stringify(first)}).every(row=>row.importId===${JSON.stringify(first)})`,
    ),
  );
  await evaluate("clickText('Relatórios')");
  await wait("!!document.querySelector('.reportTotals')");
  assert.ok(
    (await evaluate("document.querySelector('.reportTotals strong').textContent")).includes(
      '77,31',
    ),
  );
  await evaluate("setField('[aria-label=\"Agrupar compras por\"]','seller')");
  assert.ok(
    (await evaluate("document.querySelector('.purchaseSummary tbody').textContent")).includes(
      'Cardoso',
    ),
  );
  await evaluate("clickText('Solicitações')");
  await wait("document.querySelectorAll('.productCell').length===8");
  await reload();
  await evaluate("clickText('Solicitações')");
  await wait("document.querySelectorAll('.productCell').length===8");
  assert.equal(await evaluate('readDb().activeBatchId'), first);
  for (const index of [2, 3])
    await evaluate(
      `document.querySelectorAll('.tableWrap tbody input[type=checkbox]')[${index}].click()`,
    );
  await evaluate(
    "window.confirm=message=>{window.lastConfirm=message;return false};document.querySelector('.selectionBar .danger').click()",
  );
  assert.ok((await evaluate('window.lastConfirm')).includes('2 solicitações'));
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 8);
  await evaluate("window.confirm=()=>true;document.querySelector('.selectionBar .danger').click()");
  await wait("document.querySelectorAll('.productCell').length===6");
  assert.deepEqual(
    await evaluate(`readDb().requests.filter(row=>row.importId===${JSON.stringify(second)})`),
    secondSnapshot,
  );
  await openBatch('Lote 002');
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 4);
  assert.equal(
    await evaluate("document.querySelectorAll('.tableWrap tbody input:checked').length"),
    0,
  );
  await evaluate("document.querySelector('thead input[type=checkbox]').click()");
  await evaluate("clickText('Gerar pedido')");
  await wait("document.querySelectorAll('.supplierMessage').length===1");
  assert.equal(
    (await evaluate("document.querySelector('.supplierMessage textarea').value")).split('\n')
      .length,
    4,
  );
  await evaluate("clickText('Fechar pedido')");
  await reload();
  await evaluate("clickText('Solicitações')");
  await wait("document.querySelectorAll('.productCell').length===4");
  assert.equal(await evaluate('readDb().activeBatchId'), second);
  await openBatch('Registros anteriores sem lote');
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 2);
  assert.deepEqual(
    await evaluate("readDb().requests.filter(row=>row.id.startsWith('legacy-'))"),
    legacy.requests,
  );
  await evaluate("clickText('Nova solicitação')");
  await wait("!!document.querySelector('.manualEntry')");
  assert.equal(await evaluate("document.querySelector('.manualEntry').open"), false);
  await evaluate("document.querySelector('.manualEntry>summary').click()");
  for (const [label, value] of [
    ['Cliente', 'Cliente manual'],
    ['Produto / SKU', 'Produto manual'],
  ]) {
    await evaluate(
      `(()=>{const field=[...document.querySelectorAll('.formPanel label')].find(el=>el.textContent.startsWith(${JSON.stringify(label)})).querySelector('input');field.setAttribute('data-manual',${JSON.stringify(label)});})()`,
    );
    await evaluate(`setField('[data-manual=${JSON.stringify(label)}]',${JSON.stringify(value)})`);
  }
  await evaluate("clickText('Salvar solicitação')");
  await wait("document.querySelector('.panelHead h2')?.textContent==='Lote 003'");
  assert.equal(await evaluate("document.querySelectorAll('.productCell').length"), 1);
  assert.deepEqual(await evaluate('readDb().sellers'), legacy.sellers);
  assert.deepEqual(await evaluate('readDb().suppliers'), legacy.suppliers);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true);
  assert.equal(await evaluate('/CSV|Excel/.test(document.body.innerText)'), false);
  await evaluate("clickText('Configurações')");
  await wait('!!document.querySelector(\'[aria-label="Nome do novo fornecedor"]\')');
  await evaluate("setField('[aria-label=\"Nome do novo fornecedor\"]','Nova Distribuidora')");
  await evaluate("clickText('Adicionar fornecedor')");
  await wait("readDb().suppliers.includes('Nova Distribuidora')");
  const catalogSize = await evaluate('readDb().suppliers.length');
  await evaluate("setField('[aria-label=\"Nome do novo fornecedor\"]',' NOVA DISTRIBUIDORA ')");
  await evaluate("clickText('Adicionar fornecedor')");
  assert.equal(await evaluate('readDb().suppliers.length'), catalogSize);
  const beforeSellerDeletion = await evaluate('readDb().requests');
  await evaluate(
    'window.confirm=()=>false;document.querySelector(\'[aria-label="Excluir vendedor Cardoso"]\').click()',
  );
  assert.ok(await evaluate("readDb().sellers.includes('Cardoso')"));
  await evaluate(
    'window.confirm=()=>true;document.querySelector(\'[aria-label="Excluir vendedor Cardoso"]\').click()',
  );
  await wait("!readDb().sellers.includes('Cardoso')");
  assert.deepEqual(
    await evaluate('readDb().requests'),
    beforeSellerDeletion,
    'Deleting seller never deletes financial/history records',
  );
  await reload();
  assert.ok(await evaluate("readDb().suppliers.includes('Nova Distribuidora')"));
  assert.equal(await evaluate("readDb().sellers.includes('Cardoso')"), false);
  await evaluate("clickText('Solicitações')");
  await wait("!!document.querySelector('.productCell')");
  await evaluate("document.querySelector('.tableWrap tbody .link').click()");
  await wait("!!document.querySelector('.formPanel')");
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.formPanel select option')].find(el=>el.textContent.includes('excluído do cadastro')).value",
    ),
    'Cardoso',
  );
  await evaluate("clickText('Salvar solicitação')");
  await wait("document.querySelector('h1')?.textContent==='Solicitações'");
  await evaluate("clickText('Nova solicitação')");
  await wait("!!document.querySelector('.whatsappImport')");
  await evaluate(
    `setField('.whatsappImport>label textarea',${JSON.stringify('NOVA DISTRIBUIDORA BR\nVendedor: Luiz\nCliente: Cliente novo\n01 - Produto 10,00')})`,
  );
  await evaluate("clickText('Interpretar mensagem')");
  await wait("document.querySelectorAll('.importTable tbody tr').length===1");
  assert.equal(
    await evaluate('document.querySelector(\'[aria-label="Fornecedor do item 1"]\').value'),
    'Nova Distribuidora',
  );
  // Print-only expedition sheet: no persistence, no prices, every client/item kept.
  await evaluate("clickText('Limpar')");
  const dispatchMessage =
    'Master\nVendedor: Luiz\nCliente: Expedição Z\n02 - TONER TN-1060 R$ 15,99\nVendedor: Adriana\nCliente: Expedição A\n01 - PAPEL A4 R$ 9,99\nCliente: Expedição B\n03 - PAPEL A4 R$ 9,99';
  await evaluate(`setField('.whatsappImport>label textarea',${JSON.stringify(dispatchMessage)})`);
  const beforePrint = await evaluate('readDb()');
  await evaluate(
    `window.dispatchPrintCaptures=[];document.addEventListener('load',event=>{const frame=event.target;if(frame.tagName==='IFRAME'&&frame.dataset.dispatchPrint){frame.contentWindow.print=()=>{window.dispatchPrintCaptures.push({text:frame.contentDocument.body.innerText,rows:frame.contentDocument.querySelectorAll('tbody tr').length});};}},true)`,
  );
  await evaluate("clickText('Imprimir')");
  await wait('window.dispatchPrintCaptures.length===1');
  const firstPrint = await evaluate('window.dispatchPrintCaptures[0]');
  assert.equal(firstPrint.rows, 3);
  assert.ok(
    firstPrint.text.indexOf('Vendedor: Adriana') < firstPrint.text.indexOf('Vendedor: Luiz'),
  );
  for (const value of ['Expedição Z', 'Expedição A', 'Expedição B', 'TONER TN-1060', 'PAPEL A4'])
    assert.ok(firstPrint.text.includes(value));
  assert.equal(firstPrint.text.includes('R$'), false);
  assert.equal(firstPrint.text.includes('15,99'), false);
  assert.deepEqual(await evaluate('readDb()'), beforePrint);
  assert.equal(
    await evaluate("document.querySelectorAll('.importTable tbody tr').length"),
    0,
    'Printing raw message does not create or reorder the preview',
  );
  await evaluate("clickText('Interpretar mensagem')");
  await wait("document.querySelectorAll('.importTable tbody tr').length===3");
  await evaluate("setField('[aria-label=\"Cliente do item 1\"]','Cliente corrigido expedição')");
  await evaluate('document.querySelector(\'[aria-label="Selecionar todos os itens"]\').click()');
  await evaluate("clickText('Imprimir')");
  await wait('window.dispatchPrintCaptures.length===2');
  assert.equal(
    await evaluate('window.dispatchPrintCaptures[1].rows'),
    3,
    'Every preview row prints even without checked selections',
  );
  assert.ok(
    (await evaluate('window.dispatchPrintCaptures[1].text')).includes(
      'Cliente corrigido expedição',
    ),
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.importTable select[aria-label^=Vendedor]')].map(el=>el.value)",
    ),
    ['Luiz', 'Adriana', 'Adriana'],
  );
  await evaluate(
    `setField('.whatsappImport>label textarea',${JSON.stringify(dispatchMessage + '\n')})`,
  );
  await evaluate("clickText('Imprimir')");
  assert.equal(
    await evaluate('window.dispatchPrintCaptures.length'),
    2,
    'A stale preview cannot be silently printed',
  );
  assert.deepEqual(await evaluate('readDb()'), beforePrint);
  await evaluate(
    "const printFrame=document.querySelector('iframe[data-dispatch-print]');printFrame.contentWindow.dispatchEvent(new printFrame.contentWindow.Event('afterprint'))",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('iframe[data-dispatch-print]').length"),
    0,
  );
  // Last actual unit price is separate from summed expenses, quote and weighted cost.
  await evaluate(`const priceDb=readDb();priceDb.requests.push(
 {id:'last-price-master',sku:'CART. TONER TN2340',supplier:'Master',seller:'Luiz',client:'Preço A',status:'Comprado',quantity:15,purchasedQty:15,unitCost:32.29,referenceUnitPrice:99,date:'2026-11-01',purchaseDate:'2026-11-06',purchaseEntries:[
 {id:'old-price',quantity:10,unitCost:30,date:'2026-11-04',purchasedAt:'2026-11-04T12:00:00Z'},
 {id:'last-price',quantity:5,unitCost:36.87,date:'2026-11-06',purchasedAt:'2026-11-06T12:00:00Z'}]},
 {id:'last-price-potencial',sku:'CART. TONER TN2340',supplier:'Potencial',seller:'Luiz',client:'Preço B',status:'Comprado',quantity:2,purchasedQty:2,unitCost:35,date:'2026-11-01',purchaseDate:'2026-11-05'});
 localStorage.setItem('importlaser-compras-v1',JSON.stringify(priceDb));`);
  await reload();
  await evaluate("clickText('Painel')");
  await wait("!!document.querySelector('.lastPaidPrices')");
  await evaluate("setField('.filters label:first-child select','mes')");
  await evaluate("setField('.filters label:nth-child(2) select','Master')");
  await evaluate("setField('.filters input','tn2340')");
  await wait("document.querySelectorAll('.lastPaidValue').length===1");
  assert.ok(
    (await evaluate("document.querySelector('.lastPaidValue').textContent")).includes('36,87'),
  );
  assert.equal(
    (await evaluate("document.querySelector('.lastPaidPrices tbody').innerText")).includes('32,29'),
    false,
  );
  assert.ok(
    (await evaluate("document.querySelector('.stats strong').textContent")).includes('484,35'),
  );
  assert.ok(
    (await evaluate("document.querySelector('.lastPaidPrices tbody').innerText")).includes(
      '06/11/2026',
    ),
  );
  await evaluate("setField('.filters label:first-child select','hoje')");
  assert.ok(
    (await evaluate("document.querySelector('.lastPaidValue').textContent")).includes('36,87'),
  );
  await evaluate("setField('.filters label:nth-child(2) select','Todos')");
  await wait("document.querySelectorAll('.lastPaidValue').length===2");
  assert.ok(
    (
      await evaluate("[...document.querySelectorAll('.lastPaidValue')].map(el=>el.textContent)")
    ).some((value) => value.includes('35,00')),
  );
  // Whole-batch printing/deletion acts on the saved solicitation, independently of filters.
  await evaluate("clickText('Solicitações')");
  await openBatch('Lote 001');
  const batchBefore = await evaluate('readDb()');
  await evaluate(
    "window.batchPrint=null;document.addEventListener('load',event=>{const frame=event.target;if(frame.matches?.('iframe[data-dispatch-print]'))frame.contentWindow.print=()=>{window.batchPrint=frame.contentDocument.body.innerText}},true)",
  );
  await evaluate("setField('.filters input','SEM RESULTADO PARA FILTRAR')");
  await evaluate("clickText('Imprimir')");
  await wait('!!window.batchPrint');
  assert.ok((await evaluate('window.batchPrint')).includes('Lote 001'));
  assert.ok((await evaluate('window.batchPrint')).includes('Master'));
  assert.ok((await evaluate('window.batchPrint')).includes('Potencial'));
  assert.deepEqual(await evaluate('readDb()'), batchBefore);
  await evaluate(
    "window.confirm=message=>{window.batchDeletePrompt=message;return false};clickText('Excluir solicitação inteira')",
  );
  assert.deepEqual(await evaluate('readDb()'), batchBefore);
  assert.ok((await evaluate('window.batchDeletePrompt')).includes('6 produto(s)'));
  await evaluate("window.confirm=()=>true;clickText('Excluir solicitação inteira')");
  const batchAfter = await evaluate('readDb()'),
    deletedId = batchBefore.imports.find((entry) => entry.sequence === 1).id;
  assert.deepEqual(
    batchAfter.requests,
    batchBefore.requests.filter((row) => (row.importId || row.batchId) !== deletedId),
  );
  assert.ok(!batchAfter.imports.some((entry) => entry.id === deletedId));
  await reload();
  assert.deepEqual(await evaluate('readDb()'), batchAfter);
  await evaluate(
    "clickText('Painel');setField('.filters label:first-child select','todos');setField('.filters label:nth-child(2) select','Master');setField('.filters input','tn2340')",
  );
  await wait(`!!document.querySelector('[aria-label="Ver compras de Luiz"]')`);
  const rankingValue = await evaluate(
    `document.querySelector('[aria-label="Ver compras de Luiz"]').closest('.barRow').querySelector('b').textContent`,
  );
  await evaluate(`document.querySelector('[aria-label="Ver compras de Luiz"]').click()`);
  await wait("!!document.querySelector('.purchaseReports')");
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Vendedor do relatório"]').value`),
    'Luiz',
  );
  assert.ok(
    (await evaluate("document.querySelector('.reportTotals strong').textContent")).includes(
      rankingValue,
    ),
  );
  assert.equal(
    await evaluate("document.querySelector('.filters label:nth-child(2) select').value"),
    'Master',
  );
  assert.equal(await evaluate("document.querySelector('.filters input').value"), 'tn2340');
  assert.deepEqual(page.errors, []);
  console.log(
    'UI OK: lotes 8 (5 Master + 3 Potencial) e 4 Imprime, mensagens únicas por fornecedor, cópia, confirmação sem compra, histórico, status e compras parciais, reload, edição/exclusão isoladas, legado preservado, cadastro manual e layout móvel.',
  );
} finally {
  page?.close();
  await browser.send('Target.disposeBrowserContext', { browserContextId });
  browser.close();
}
