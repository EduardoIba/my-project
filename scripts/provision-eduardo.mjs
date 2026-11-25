import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createSupabaseApi, loginAlias } from '../supabaseApi.js';

const projectUrl = 'https://fqippqnarynmtxwbkurx.supabase.co';
const masterId = '5366f3fe-a2f7-4150-8c70-985f9097b4e0';
const masterAlias = loginAlias('Eduardo');
const marker = 'master-eduardo-v1';

async function readPrivate(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Execute este comando em um terminal privado e interativo.');
  }
  process.stdout.write(label + ': ');
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
    historySize: 0,
  });
  const controller = new AbortController();
  input.once('SIGINT', () => controller.abort());
  try {
    return await input.question('', { signal: controller.signal });
  } finally {
    input.close();
    process.stdout.write('\n');
  }
}

async function authAdmin(path, key, body) {
  let response;
  try {
    response = await fetch(new URL(path, projectUrl), {
      method: body ? 'POST' : 'GET',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Não foi possível conectar à API administrativa do Supabase de testes.');
  }
  if (!body && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`O Supabase recusou a operação administrativa (HTTP ${response.status}).`);
  return response.json();
}

async function main() {
  const settings = await readFile(new URL('../.env.development', import.meta.url), 'utf8');
  const publishable = settings.match(
    /^VITE_SUPABASE_PUBLISHABLE_KEY=(sb_publishable_\S+)\s*$/m,
  )?.[1];
  if (!publishable) throw new Error('Chave publicável ausente em .env.development.');

  let secret = (await readPrivate('Chave secreta sb_secret_ do Supabase de testes')).trim();
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secret)) {
    throw new Error('Use uma chave sb_secret_ da página API Keys do projeto de testes.');
  }

  let account = await authAdmin('/auth/v1/admin/users/' + masterId, secret);
  if (
    account &&
    (account.id !== masterId ||
      account.email !== masterAlias ||
      account.app_metadata?.import_laser_account !== marker)
  ) {
    throw new Error('A conta existente diverge da reserva de Eduardo.');
  }

  let password;
  if (account) {
    password = await readPrivate('Senha atual de Eduardo para verificar o acesso');
  } else {
    password = await readPrivate('Defina a senha inicial de Eduardo');
    const confirmation = await readPrivate('Confirme a senha inicial');
    if (password !== confirmation || password.length < 12 || Buffer.byteLength(password) > 72) {
      throw new Error(
        'As senhas devem coincidir e conter ao menos 12 caracteres, com limite de 72 bytes.',
      );
    }
    account = await authAdmin('/auth/v1/admin/users', secret, {
      id: masterId,
      email: masterAlias,
      email_confirm: true,
      password,
      app_metadata: { import_laser_account: marker },
    });
    console.log(
      'Conta Eduardo criada. Se a verificação falhar, repita o comando para verificar a senha atual.',
    );
  }
  secret = undefined;
  if (account?.id !== masterId) throw new Error('O Supabase retornou um ID inesperado.');

  const session = await createSupabaseApi(projectUrl, publishable).signIn('Eduardo', password);
  password = undefined;
  const api = createSupabaseApi(projectUrl, publishable, session.access_token);
  try {
    if (
      session.user?.id !== masterId ||
      (await api.rpc('current_profile_role')) !== 'administrador'
    ) {
      throw new Error('O perfil administrador de Eduardo não foi confirmado.');
    }
    await api.rpc('load_buyer_workspace');
    await api.rpc('get_invoice_xml', { note_id: '00000000-0000-0000-0000-000000000000' });
    console.log('Login validado: Eduardo (administrador), Compras e Conferência na mesma sessão.');
  } finally {
    await api.signOut().catch(() => {});
  }
}

main().catch((error) => {
  // Print only fixed messages and status codes, never remote bodies or headers.
  if (error.name === 'AbortError') console.error('Provisionamento cancelado.');
  else if (error.status) console.error(`Falha ao verificar acesso (HTTP ${error.status}).`);
  else if (error instanceof SyntaxError || error.code)
    console.error('Não foi possível concluir o provisionamento.');
  else console.error(error.message);
  process.exitCode = 1;
});
