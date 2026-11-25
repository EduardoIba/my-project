import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
});
const { default: Sidebar, sidebarOptions } = await vite.ssrLoadModule('/Sidebar.jsx');
const render = (props) => renderToStaticMarkup(React.createElement(Sidebar, props));

test('Compras e Conferência compartilham estrutura e identidade de sidebar', () => {
  const shared = [
    'il-sidebar-brand',
    'IMPORT LASER',
    'Gestão de Compras',
    'il-sidebar-label',
    'il-sidebar-profile',
  ];
  const buyer = render({
    items: [{ id: 'Painel', label: 'Painel' }],
    active: 'Painel',
    moduleLabel: 'Módulo de compras',
    roleLabel: 'Comprador',
    accessLabel: 'Acesso operacional',
  });
  const receiving = render({
    items: [{ id: 'new', label: 'Nova conferência' }],
    active: 'new',
    moduleLabel: 'Módulo de conferência',
    roleLabel: 'Conferente',
    accessLabel: 'Acesso operacional',
  });
  for (const marker of shared) {
    assert.ok(buyer.includes(marker), `Compras inclui ${marker}`);
    assert.ok(receiving.includes(marker), `Conferência inclui ${marker}`);
  }
  assert.match(buyer, /Comprador/);
  assert.match(buyer, /Acesso operacional/);
});

test('opções do menu respeitam os perfis e permissões atuais', () => {
  const labels = (module, role) => sidebarOptions(module, role).map((item) => item.label);
  assert.deepEqual(labels('buyer', 'comprador'), [
    'Painel',
    'Nova solicitação',
    'Solicitações',
    'Relatórios',
    'Configurações',
  ]);
  assert.deepEqual(labels('buyer', 'administrador'), [
    'Painel',
    'Nova solicitação',
    'Solicitações',
    'Relatórios',
    'Configurações',
  ]);
  assert.deepEqual(labels('receiving', 'conferente'), [
    'Painel',
    'Nova conferência',
    'Histórico',
    'Pendências',
    'Relatórios',
  ]);
  assert.deepEqual(labels('receiving', 'administrador'), [
    'Painel',
    'Nova conferência',
    'Histórico',
    'Pendências',
    'Relatórios',
    'Cadastro fiscal',
  ]);
  assert.deepEqual(labels('buyer', 'conferente'), []);
  assert.deepEqual(labels('receiving', 'comprador'), []);
});

test('tela ativa marca apenas opção selecionada', () => {
  const markup = render({
    items: sidebarOptions('receiving', 'administrador'),
    active: 'catalog',
    moduleLabel: 'Módulo de conferência',
    roleLabel: 'Administrador',
    accessLabel: 'Acesso Master',
  });
  assert.match(markup, /Nova conferência/);
  assert.match(markup, /<button aria-current="page">Cadastro fiscal<\/button>/);
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  const conferenteMarkup = render({
    items: sidebarOptions('receiving', 'conferente'),
    active: 'new',
    moduleLabel: 'Módulo de conferência',
    roleLabel: 'Conferente',
    accessLabel: 'Acesso operacional',
  });
  assert.doesNotMatch(conferenteMarkup, /Cadastro fiscal/);
});

test('cartão mantém troca de módulo e saída e segue visível no mobile', async () => {
  const markup = render({
    items: [],
    active: '',
    moduleLabel: 'Módulo de compras',
    roleLabel: 'Administrador',
    accessLabel: 'Acesso Master',
    switchLabel: 'Conferência',
    onSwitch: () => {},
    onSignOut: () => {},
  });
  assert.match(markup, /Conferência/);
  assert.match(markup, /Sair/);
  const css = await readFile(new URL('./sidebar.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.match(mobile, /\.il-sidebar nav\s*\{\s*display:\s*flex;\s*overflow-x:\s*auto;\s*\}/);
  assert.doesNotMatch(mobile, /\.il-sidebar-profile\s*\{\s*display:\s*none\s*\}/);
  const buyerCss = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(buyerCss, /@media\s*\(max-width:\s*700px\)\s*\{[^}]*\.app\s*\{\s*display:\s*block;/);
  const receivingCss = await readFile(new URL('./receiving.css', import.meta.url), 'utf8');
  assert.match(
    receivingCss,
    /@media\s*\(max-width:\s*700px\)\s*\{\s*\.rx-app\s*\{\s*display:\s*block;/,
  );
});

test.after(async () => vite.close());
