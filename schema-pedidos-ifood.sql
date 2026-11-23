-- Painel da Loja — tabelas dos pedidos do iFood (ouvinte do Gestor de Pedidos)
-- Cole tudo isto no Supabase em: SQL Editor > New query > Run
-- Pode rodar mais de uma vez sem problema.
-- LGPD: nenhuma tabela aqui guarda nome, telefone, CPF ou endereço do cliente.

-- 1) Um pedido por linha (valores, itens e a situação mais recente)
create table if not exists public.pedidos_ifood (
  id            text primary key,          -- id do pedido no iFood
  numero        text,                      -- número curto que aparece no Gestor (ex.: 1234)
  merchant_id   text,                      -- id da loja/marca no iFood
  loja          text,                      -- nome da loja/marca
  criado_em     timestamptz,
  tipo          text,                      -- DELIVERY, TAKEOUT...
  agendado      boolean,
  subtotal      numeric,
  taxa_entrega  numeric,
  descontos     numeric,
  total         numeric,
  pagamento     text,
  itens         jsonb,                     -- [{ nome, qtd, total }]
  situacao      text,                      -- PLACED, CONFIRMED, DISPATCHED, CONCLUDED, CANCELLED...
  situacao_em   timestamptz,
  atualizado_em timestamptz not null default now()
);
create index if not exists pedidos_ifood_criado_idx on public.pedidos_ifood (criado_em desc);

-- 2) Histórico de situações de cada pedido
create table if not exists public.pedidos_ifood_eventos (
  pedido_id   text        not null,
  merchant_id text,
  codigo      text        not null,
  quando      timestamptz not null,
  motivo      text,                        -- só o motivo do cancelamento, quando houver
  recebido_em timestamptz not null default now(),
  primary key (pedido_id, codigo, quando)
);

-- 3) Situação de cada loja no iFood (aberta/fechada e por quê)
create table if not exists public.lojas_ifood_status (
  merchant_id   text primary key,
  estado        text,
  disponivel    boolean,
  codigos       jsonb,
  motivo        text,
  atualizado_em timestamptz not null default now()
);

-- Segurança: só quem fizer login no painel consegue LER.
-- O ouvinte grava com a chave secreta (service_role), que ignora estas regras.
alter table public.pedidos_ifood         enable row level security;
alter table public.pedidos_ifood_eventos enable row level security;
alter table public.lojas_ifood_status    enable row level security;

drop policy if exists "leitura logado" on public.pedidos_ifood;
drop policy if exists "leitura logado" on public.pedidos_ifood_eventos;
drop policy if exists "leitura logado" on public.lojas_ifood_status;

create policy "leitura logado" on public.pedidos_ifood         for select to authenticated using (true);
create policy "leitura logado" on public.pedidos_ifood_eventos for select to authenticated using (true);
create policy "leitura logado" on public.lojas_ifood_status    for select to authenticated using (true);

-- Limpeza: histórico de situações com mais de 90 dias pode ser apagado (o pedido fica)
create or replace function public.limpar_eventos_ifood_antigos() returns void
language sql as $$
  delete from public.pedidos_ifood_eventos where quando < now() - interval '90 days';
$$;
