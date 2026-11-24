import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const vite = await createServer({configFile: false, appType: 'custom', server: {middlewareMode: true}});
const {default: Sidebar} = await vite.ssrLoadModule('/Sidebar.jsx');
const render = props => renderToStaticMarkup(React.createElement(Sidebar, props));

test('Compras e Conferência compartilham estrutura e identidade de sidebar', () => {
  const shared = ['il-sidebar-brand', 'IMPORT LASER', 'Gestão de Compras', 'il-sidebar-label', 'il-sidebar-profile'];
  const buyer = render({items: [{id: 'Painel', label: 'Painel'}], active: 'Painel', moduleLabel: 'Módulo de compras', roleLabel: 'Comprador', accessLabel: 'Acesso operacional'});
  const receiving = render({items: [{id: 'new', label: 'Nova conferência'}], active: 'new', moduleLabel: 'Módulo de conferência', roleLabel: 'Conferente', accessLabel: 'Acesso operacional'});
  for (const marker of shared) {
    assert.ok(buyer.includes(marker), `Compras inclui ${marker}`);
    assert.ok(receiving.includes(marker), `Conferência inclui ${marker}`);
  }
  assert.match(buyer, /Comprador/);
  assert.match(buyer, /Acesso operacional/);
});

test('opções e tela ativa vêm do módulo/perfil informado', () => {
  const markup = render({items: [{id: 'new', label: 'Nova conferência'}, {id: 'catalog', label: 'Cadastro fiscal'}], active: 'catalog', moduleLabel: 'Módulo de conferência', roleLabel: 'Administrador', accessLabel: 'Acesso Master'});
  assert.match(markup, /Nova conferência/);
  assert.match(markup, /<button aria-current="page">Cadastro fiscal<\/button>/);
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  assert.doesNotMatch(markup, /Configurações/);
});

test('cartão mantém troca de módulo e saída e segue visível no mobile', async () => {
  const markup = render({items: [], active: '', moduleLabel: 'Módulo de compras', roleLabel: 'Administrador', accessLabel: 'Acesso Master', switchLabel: 'Conferência', onSwitch: () => {}, onSignOut: () => {}});
  assert.match(markup, /Conferência/);
  assert.match(markup, /Sair/);
  const css = await readFile(new URL('./sidebar.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media(max-width:700px)'));
  assert.match(mobile, /\.il-sidebar nav \{display:flex;overflow-x:auto\}/);
  assert.doesNotMatch(mobile, /\.il-sidebar-profile \{display:none\}/);
});

test.after(async () => vite.close());
