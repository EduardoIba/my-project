import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseApi, loginAlias } from './supabaseApi.js';

const url = 'https://database.example.invalid';

test('O nome de usuário gera o alias reservado sem aceitar e-mail', () => {
  assert.equal(loginAlias('  Eduardo  '), 'eduardo@login.importlaser.invalid');
  assert.equal(loginAlias('Eduardo.Compras'), 'eduardo.compras@login.importlaser.invalid');
  for (const invalid of ['eduardo@example.org', 'Edu ardo', '.eduardo', 'a'.repeat(65)]) {
    assert.equal(loginAlias(invalid), null);
  }
});

test('O login usa Supabase Auth através da chave pública e retorna uma sessão', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ access_token: 'jwt-ficticio', refresh_token: 'refresh-ficticio' }),
        { status: 200 },
      ),
  );
  const api = createSupabaseApi(url, 'public-key');
  assert.equal((await api.signIn('Eduardo', 'valor-para-teste')).access_token, 'jwt-ficticio');
  const [endpoint, options] = fetch.mock.calls[0].arguments;
  assert.equal(endpoint.href, url + '/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(options.body), {
    email: 'eduardo@login.importlaser.invalid',
    password: 'valor-para-teste',
  });
  assert.equal(options.headers.apikey, 'public-key');
  assert.equal(options.headers.Authorization, undefined);
});

test('Erros de credencial têm a mesma mensagem e 429 ativa a espera', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ message: 'e-mail inexistente' }), { status: 400 }),
  );
  const api = createSupabaseApi(url, 'public-key');
  await assert.rejects(api.signIn('Eduardo', 'valor-para-teste'), {
    message: 'Usuário ou senha inválidos.',
  });
  fetch.mock.mockImplementation(
    async () => new Response(null, { status: 429, headers: { 'Retry-After': '42' } }),
  );
  await assert.rejects(api.signIn('Eduardo', 'valor-para-teste'), { waitSeconds: 42 });
});

test('A gravação usa o JWT do usuário, a chave pública e os IDs explícitos', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ revision: 8, data: {} }), { status: 200 }),
  );
  const api = createSupabaseApi(url, 'public-key', 'profile-jwt');
  const mandate = { expected_revision: 7, archive_requests: ['request-1'] };
  assert.equal((await api.rpc('save_buyer_workspace', mandate)).revision, 8);
  const [endpoint, options] = fetch.mock.calls[0].arguments;
  assert.equal(endpoint.href, url + '/rest/v1/rpc/save_buyer_workspace');
  assert.equal(options.headers.apikey, 'public-key');
  assert.equal(options.headers.Authorization, 'Bearer profile-jwt');
  assert.deepEqual(JSON.parse(options.body), mandate);
});

test('Uma gravação recusada permanece como erro para a interface', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ message: 'Recarregue antes de salvar' }), { status: 409 }),
  );
  const api = createSupabaseApi(url, 'public-key', 'profile-jwt');
  await assert.rejects(api.rpc('save_buyer_workspace'), /Recarregue antes de salvar/);
});
