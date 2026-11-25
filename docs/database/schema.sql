-- PostgreSQL / Supabase: esquema inicial de produção
create extension if not exists pgcrypto;
create table fornecedores (id uuid primary key default gen_random_uuid(), nome text not null unique, ativo boolean not null default true);
insert into fornecedores(nome) values ('Master'),('Potencial'),('Imprime'),('FA Print'),('RHB');
create table vendedores (id uuid primary key default gen_random_uuid(), nome text not null unique, ativo boolean not null default true);
create table solicitacoes (id uuid primary key default gen_random_uuid(), data_solicitacao date not null default current_date, observacoes text, criado_por uuid references auth.users(id), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create table itens_solicitacao (id uuid primary key default gen_random_uuid(), solicitacao_id uuid not null references solicitacoes(id) on delete cascade, vendedor_id uuid not null references vendedores(id), cliente_nome text not null, sku text not null, quantidade_solicitada numeric(14,3) not null check(quantidade_solicitada>0), cancelado boolean not null default false);
create table compras (id uuid primary key default gen_random_uuid(), fornecedor_id uuid not null references fornecedores(id), data_compra date not null default current_date, observacoes text, criado_por uuid references auth.users(id), criado_em timestamptz not null default now());
create table itens_compra (id uuid primary key default gen_random_uuid(), compra_id uuid not null references compras(id) on delete cascade, item_solicitacao_id uuid not null references itens_solicitacao(id), quantidade numeric(14,3) not null check(quantidade>0), custo_unitario numeric(14,4) not null check(custo_unitario>=0));
create index idx_solicitacoes_data on solicitacoes(data_solicitacao);
create index idx_compras_data on compras(data_compra);
create index idx_itens_compra_solicitacao on itens_compra(item_solicitacao_id);
-- Habilitar RLS e criar políticas de acesso por perfil ANTES de conectar clientes web.
alter table fornecedores enable row level security;
alter table vendedores enable row level security;
alter table solicitacoes enable row level security;
alter table itens_solicitacao enable row level security;
alter table compras enable row level security;
alter table itens_compra enable row level security;
