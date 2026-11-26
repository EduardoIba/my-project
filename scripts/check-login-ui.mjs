// Run against a development build, with an isolated Chromium debugging port.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const appUrl = process.argv[2] || 'http://127.0.0.1:5173/';
const debugUrl = process.argv[3] || 'http://127.0.0.1:9229';

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', (event) => {
    const { id, result, error } = JSON.parse(event.data);
    if (!pending.has(id)) return;
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(new Error(error.message));
    else resolve(result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

const version = await (await fetch(debugUrl + '/json/version')).json();
const browser = await connect(version.webSocketDebuggerUrl);
const { browserContextId } = await browser.send('Target.createBrowserContext');
let page;
try {
  const { targetId } = await browser.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const targets = await (await fetch(debugUrl + '/json/list')).json();
  page = await connect(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
  const mockAuth = `(() => {
    const realFetch = window.fetch.bind(window);
    window.authCalls = [];
    window.moduleTokens = [];
    window.fetch = async (resource, options) => {
      const url = new URL(String(resource), location.href);
      if (url.hostname !== 'fqippqnarynmtxwbkurx.supabase.co') return realFetch(resource, options);
      const json = data => new Response(JSON.stringify(data));
      if (url.pathname === '/auth/v1/token') {
        const body = JSON.parse(options.body);
        authCalls.push({email: body.email, hasPassword: Boolean(body.password)});
        await new Promise(resolve => setTimeout(resolve, 350));
        if (authCalls.length === 1) return new Response(null, {status: 429, headers: {'Retry-After': '1'}});
        if (authCalls.length === 2) return new Response(null, {status: 400});
        return json({access_token: 'fake-session-token', refresh_token: 'fake-refresh', expires_at: Date.now() / 1000 + 3600});
      }
      if (url.pathname === '/rest/v1/rpc/current_profile_role') return json('administrador');
      if (url.pathname === '/rest/v1/rpc/load_buyer_workspace') {
        moduleTokens.push(options.headers.Authorization);
        return json({revision: 0, data: {requests: [], imports: []}});
      }
      const sampleKey = '35261198765432000199550010000001231111111110';
      const otherKey = '35261198765432000199550010000001231111111179';
      const note = {id:'note', access_key:sampleKey, invoice_number:'123', series:'1', supplier_id:'vendor', status:window.completed ? 'received' : 'imported'};
      const otherNote = {...note,id:'other-note',access_key:otherKey,invoice_number:'124',status:'imported'};
      const line = {id:'item',item_number:1,product_id:'product',description:'Toner de teste',supplier_product_code:'TN',unit:'UN',invoiced_quantity:5};
      const demand = {request_id:'request',supplier_id:'vendor',supplier_name:'Master BR',customer_name:'Cliente A',product_id:'product',
        product_name:'Toner de teste',batch_sequence:1,customer_position:1,item_position:1,pending_quantity:5};
      if (url.pathname === '/rest/v1/invoices') {
        moduleTokens.push(options.headers.Authorization);
        const requested = url.searchParams.get('access_key');
        if (requested && requested !== 'eq.' + sampleKey) return json([]);
        return json(window.imported ? [note, otherNote] : [note]);
      }
      if (url.pathname === '/rest/v1/products') return json([{id:'product',name:'Toner de teste',unit:'UN'}]);
      if (url.pathname === '/rest/v1/suppliers') return json([{id:'vendor',legal_name:'Master BR',is_active:true}]);
      if (url.pathname === '/rest/v1/invoice_items') return json([line]);
      if (url.pathname === '/rest/v1/inspection_items') return json(window.saved ?
        [{invoice_item_id:'item',product_id:'product',received_quantity:window.saved.items[0].received}] : []);
      if (url.pathname === '/rest/v1/distribution_items') return json(window.completed ?
        [{purchase_request_id:'request',product_name:'Toner de teste',customer_name:'Cliente A',allocated_quantity:4}] : []);
      if (url.pathname === '/rest/v1/rpc/receiving_pending_requests') return json([demand]);
      if (url.pathname === '/rest/v1/occurrences') return json([{id:'issue', invoice_id:'note',
        description:'Divergência de quantidade', status:'open', created_at:'2026-11-19T15:00:00Z'}]);
      if (url.pathname === '/rest/v1/rpc/save_inspection') {
        window.saved = JSON.parse(options.body);
        window.completed = saved.complete;
        return json('inspection');
      }
      if (url.pathname === '/rest/v1/rpc/import_invoice_xml') {
        window.imported = JSON.parse(options.body).source.includes(otherKey);
        return json('other-note');
      }
      if (url.pathname.startsWith('/rest/v1/')) return json([]);
      throw new Error('Rota inesperada no teste');
    };
  })()`;
  await page.send('Page.navigate', { url: appUrl });

  async function evaluate(expression) {
    const result = await page.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result.value;
  }
  async function wait(expression) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const status = await evaluate(
      '({screen: document.body.innerText, authCalls: window.authCalls})',
    );
    throw new Error('Condição não atingida: ' + expression + '\n' + JSON.stringify(status));
  }

  async function verifyLayout(module, screen) {
    const buying = module === 'compras';
    const sidebar = buying ? '.app > aside' : '.rx-sidebar';
    const main = buying ? '.buy-main' : '.rx-main';
    const header = buying ? '.buy-header' : '.rx-header';
    for (const width of [1920, 1366, 1024, 390, 320]) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const bounds = await evaluate(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        const outside = [...document.querySelectorAll('${main} .panel, ${main} .rx-card, ${main} .tableWrap, ${main} .rx-table-wrap')]
          .filter(element => {const r = element.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1);})
          .map(element => element.className);
        const occurrence = document.querySelector('.occurrence-body');
        const sidebarNav = document.querySelector('${sidebar} nav');
        const inactive = sidebarNav.querySelector('button:not(.active):not([aria-current])');
        return {width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth,
          sidebar:rect('${sidebar}'), main:rect('${main}'), header:rect('${header}'), outside,
          navOverflows:sidebarNav.scrollWidth > sidebarNav.clientWidth + 1,
          inactiveBackground:getComputedStyle(inactive).backgroundColor,
          occurrenceInside:!!occurrence?.closest('.buy-main')};
      })()`);
      const name = `${module}/${screen} em ${width}px`;
      assert.ok(bounds.scroll <= bounds.width + 1, name + ' tem rolagem horizontal na página');
      assert.equal(bounds.outside.length, 0, name + ' extravasa: ' + bounds.outside.join(', '));
      assert.equal(bounds.sidebar.top, 0, name + ' tem espaço acima da barra lateral');
      assert.ok(
        bounds.header.right <= bounds.main.right + 1,
        name + ' tem cabeçalho fora do conteúdo',
      );
      assert.equal(bounds.navOverflows, false, name + ' tem navegação fora da barra lateral');
      assert.equal(
        bounds.inactiveBackground,
        'rgba(0, 0, 0, 0)',
        name + ' tem fundo indevido na navegação inativa',
      );
      if (width > 700)
        assert.ok(
          bounds.sidebar.right <= bounds.main.left + 1,
          name + ' sobrepõe o conteúdo à barra lateral',
        );
      else
        assert.ok(
          bounds.sidebar.bottom <= bounds.main.top + 1,
          name + ' sobrepõe as seções no celular',
        );
      if (buying) assert.ok(bounds.occurrenceInside, name + ' tem ocorrências fora de Compras');
      if (process.env.LAYOUT_SCREENSHOTS && [1366, 390].includes(width)) {
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
        await mkdir(process.env.LAYOUT_SCREENSHOTS, { recursive: true });
        await writeFile(
          join(process.env.LAYOUT_SCREENSHOTS, `${module}-${screen}-${width}.png`),
          Buffer.from(data, 'base64'),
        );
      }
    }
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  await wait("!!document.querySelector('input[name=username]')");
  await evaluate(mockAuth);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('input')].map(x => x.name)"), [
    'username',
    'password',
  ]);
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1024, 600],
    [390, 844],
    [320, 568],
  ]) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await evaluate(`(() => {
      const frame = document.querySelector('.auth-frame').getBoundingClientRect();
      const form = document.querySelector('.auth-form').getBoundingClientRect();
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
        frame.left >= 0 && frame.right <= innerWidth && form.left >= frame.left && form.right <= frame.right &&
        document.querySelector('.auth-brand').getBoundingClientRect().width > 0;
    })()`),
      true,
      'Login fora da largura em ' + width + 'px',
    );
    if (process.env.LAYOUT_SCREENSHOTS && [1366, 390].includes(width)) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      await mkdir(process.env.LAYOUT_SCREENSHOTS, { recursive: true });
      await writeFile(
        join(process.env.LAYOUT_SCREENSHOTS, 'login-' + width + '.png'),
        Buffer.from(data, 'base64'),
      );
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.querySelector(\'[aria-label="Mostrar senha"]\').click()');
  assert.equal(await evaluate("document.querySelector('input[name=password]').type"), 'text');
  assert.equal(await evaluate('authCalls.length'), 0, 'Mostrar senha não deve enviar o formulário');
  await evaluate('document.querySelector(\'[aria-label="Ocultar senha"]\').click()');
  assert.equal(await evaluate("document.querySelector('input[name=password]').type"), 'password');
  await evaluate("document.querySelector('#auth-username').focus()");
  assert.notEqual(
    await evaluate(
      "getComputedStyle(document.querySelector('#auth-username').parentElement).boxShadow",
    ),
    'none',
  );
  await evaluate(`{
    const user = document.querySelector('input[name=username]');
    const password = document.querySelector('input[name=password]');
    user.value = 'Eduardo';
    password.value = crypto.randomUUID();
    user.form.requestSubmit();
  }`);
  await wait("document.querySelector('.auth-submit[disabled]')?.textContent.includes('Entrando')");
  await wait("document.querySelector('[role=alert]')?.textContent.includes('Muitas tentativas')");
  assert.equal(await evaluate("document.querySelector('.auth-submit').disabled"), true);
  await wait("!document.querySelector('.auth-submit').disabled");
  assert.equal(await evaluate("!!document.querySelector('[role=alert]')"), false);
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait(
    "document.querySelector('[role=alert]')?.textContent.includes('Usuário ou senha inválidos')",
  );
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait("document.querySelector('main h1')?.textContent === 'Painel'");
  await verifyLayout('compras', 'painel');
  await evaluate(
    "[...document.querySelectorAll('.buy-shell aside nav button')].find(b => b.textContent === 'Nova solicitação').click()",
  );
  await wait("document.querySelector('main h1')?.textContent === 'Nova solicitação'");
  await verifyLayout('compras', 'formulario');
  await evaluate(
    "[...document.querySelectorAll('.buy-shell aside nav button')].find(b => b.textContent === 'Relatórios').click()",
  );
  await wait("document.querySelector('main h1')?.textContent === 'Relatórios'");
  await verifyLayout('compras', 'relatorios');
  await evaluate(
    "[...document.querySelectorAll('nav button')].find(b => b.textContent === 'Conferência de NF-e').click()",
  );
  await wait(
    "document.querySelector('main h1')?.textContent === 'Nova conferência' && moduleTokens.length === 2",
  );
  await wait(
    "!document.querySelector('#rx-access-key').disabled && document.activeElement.id === 'rx-access-key'",
  );
  await verifyLayout('conferencia', 'identificacao');
  await evaluate(`window.setValue = (field,value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  await evaluate(`{
    const field = document.querySelector('#rx-access-key');
    setValue(field, '35261198765432000199550010000001231111111110');
    field.form.requestSubmit();
  }`);
  await wait(
    "document.querySelector('main h1')?.textContent === 'Conferência de NF-e' && !!document.querySelector('.rx-product-row')",
  );
  await evaluate("setValue(document.querySelector('.rx-product-data input'), '4')");
  await wait("document.querySelector('.rx-distribution-group')?.innerText.includes('Cliente A')");
  await verifyLayout('conferencia', 'itens');
  await evaluate("document.querySelector('button[value=draft]').click()");
  await wait(
    "window.saved?.complete === false && !document.querySelector('button[value=draft]').disabled",
  );
  await evaluate("document.querySelector('button[value=finalize]').click()");
  await wait(
    "document.querySelector('.rx-distribution h2')?.textContent === 'Distribuição registrada' && !!document.querySelector('.rx-distribution li')",
  );
  await evaluate(
    "[...document.querySelectorAll('.rx-sidebar nav button')].find(b => b.textContent === 'Relatórios').click()",
  );
  await wait("document.querySelector('main h1')?.textContent === 'Relatórios de conferência'");
  await evaluate(
    "[...document.querySelectorAll('.rx-tabs button')].find(b => b.textContent === 'Pendências').click()",
  );
  await wait("document.querySelector('.rx-table tbody')?.innerText.includes('Cliente A')");
  await verifyLayout('conferencia', 'relatorios');
  await evaluate(
    "[...document.querySelectorAll('.rx-sidebar nav button')].find(b => b.textContent === 'Nova conferência').click()",
  );
  await evaluate(`{
    const field = document.querySelector('#rx-access-key');
    setValue(field, '35261198765432000199550010000001231111111179');
    field.form.requestSubmit();
  }`);
  await wait("!!document.querySelector('.rx-upload input')");
  await evaluate(`{
    const field = document.querySelector('.rx-upload input');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35261198765432000199550010000001231111111179"/></NFe>'], 'nota.xml'));
    field.files = transfer.files;
    field.form.requestSubmit();
  }`);
  await wait(
    "window.imported && document.querySelector('.rx-note-summary')?.innerText.includes('NF-e 124')",
  );
  await evaluate(
    "[...document.querySelectorAll('.rx-profile button')].find(b => b.textContent.trim() === 'Compras').click()",
  );
  await wait("document.querySelector('main h1')?.textContent === 'Painel'");
  assert.ok(
    (await evaluate('moduleTokens')).every((token) => token === 'Bearer fake-session-token'),
  );
  assert.deepEqual(
    await evaluate('authCalls'),
    Array(3).fill({ email: 'eduardo@login.importlaser.invalid', hasPassword: true }),
  );
  console.log(
    'UI OK: ambos os módulos em 1920, 1366, 1024, 390 e 320 px. Login, importação, rascunho, finalização e troca de módulo verificados.',
  );
} finally {
  page?.close();
  await browser.send('Target.disposeBrowserContext', { browserContextId });
  browser.close();
}
