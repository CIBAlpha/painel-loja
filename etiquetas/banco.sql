-- Etiqueta Fácil: estrutura do banco
-- Cole tudo isto no Supabase em: SQL Editor > New query > Run
-- (Antes, crie o usuário da loja em Authentication > Users > Add user.)

-- 1) Lojas
create table if not exists public.etq_lojas (
  id   text primary key,
  nome text not null
);
insert into public.etq_lojas (id, nome) values ('alphaville', 'China in Box Alphaville')
on conflict (id) do nothing;

-- 2) Quem pode entrar em cada loja (contas de login)
--    papel 'gerente' = sua conta; papel 'loja' = conta do computador da loja
create table if not exists public.etq_membros (
  user_id uuid not null references auth.users(id) on delete cascade,
  loja_id text not null references public.etq_lojas(id) on delete cascade,
  papel   text not null default 'loja' check (papel in ('gerente','loja')),
  primary key (user_id, loja_id)
);

-- 3) Funcionários (escolhem o nome e digitam um PIN de 4 números)
create table if not exists public.etq_funcionarios (
  id        uuid primary key default gen_random_uuid(),
  loja_id   text not null references public.etq_lojas(id) on delete cascade,
  nome      text not null,
  pin       text not null,            -- PIN embaralhado (não fica guardado em texto)
  gerente   boolean not null default false,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- 4) Lista de produtos da revisão do mês (uma por loja)
create table if not exists public.etq_produtos (
  loja_id        text primary key references public.etq_lojas(id) on delete cascade,
  nome_revisao   text not null,
  produtos       jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

-- 5) Lista da manhã e ajustes da loja
create table if not exists public.etq_config (
  loja_id       text primary key references public.etq_lojas(id) on delete cascade,
  manha         jsonb not null default '[]'::jsonb,
  altura_mm     int not null default 25,
  atualizado_em timestamptz not null default now()
);
insert into public.etq_config (loja_id) values ('alphaville') on conflict (loja_id) do nothing;

-- 6) Registro de cada impressão
create table if not exists public.etq_impressoes (
  id               bigserial primary key,
  loja_id          text not null references public.etq_lojas(id) on delete cascade,
  impresso_em      timestamptz not null default now(),
  funcionario_id   uuid,
  funcionario_nome text,
  produto          text not null,
  validade         text,
  tipo             text,
  qtd              int not null default 1,
  origem           text
);
create index if not exists etq_impressoes_loja_dia on public.etq_impressoes (loja_id, impresso_em desc);

-- Funções de apoio para as regras de acesso
create or replace function public.etq_minhas_lojas() returns setof text
language sql stable security definer set search_path = public as $$
  select loja_id from public.etq_membros where user_id = auth.uid();
$$;
create or replace function public.etq_e_conta_loja() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.etq_membros where user_id = auth.uid() and papel = 'loja');
$$;

-- Segurança: cada conta só enxerga e mexe na própria loja
alter table public.etq_lojas        enable row level security;
alter table public.etq_membros      enable row level security;
alter table public.etq_funcionarios enable row level security;
alter table public.etq_produtos     enable row level security;
alter table public.etq_config       enable row level security;
alter table public.etq_impressoes   enable row level security;

drop policy if exists "etq loja" on public.etq_lojas;
create policy "etq loja" on public.etq_lojas for select to authenticated using (id in (select public.etq_minhas_lojas()));
drop policy if exists "etq membros" on public.etq_membros;
create policy "etq membros" on public.etq_membros for select to authenticated using (user_id = auth.uid());

drop policy if exists "etq loja" on public.etq_funcionarios;
create policy "etq loja" on public.etq_funcionarios for all to authenticated
  using (loja_id in (select public.etq_minhas_lojas())) with check (loja_id in (select public.etq_minhas_lojas()));
drop policy if exists "etq loja" on public.etq_produtos;
create policy "etq loja" on public.etq_produtos for all to authenticated
  using (loja_id in (select public.etq_minhas_lojas())) with check (loja_id in (select public.etq_minhas_lojas()));
drop policy if exists "etq loja" on public.etq_config;
create policy "etq loja" on public.etq_config for all to authenticated
  using (loja_id in (select public.etq_minhas_lojas())) with check (loja_id in (select public.etq_minhas_lojas()));
-- Impressões: pode registrar e ler; não pode apagar nem alterar (para o controle valer)
drop policy if exists "etq ler" on public.etq_impressoes;
create policy "etq ler" on public.etq_impressoes for select to authenticated using (loja_id in (select public.etq_minhas_lojas()));
drop policy if exists "etq gravar" on public.etq_impressoes;
create policy "etq gravar" on public.etq_impressoes for insert to authenticated with check (loja_id in (select public.etq_minhas_lojas()));

-- A conta do computador da loja NÃO enxerga o Painel de vendas
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not like 'etq\_%' loop
    execute format('drop policy if exists "bloqueia conta etiquetas" on public.%I', t.tablename);
    execute format('create policy "bloqueia conta etiquetas" on public.%I as restrictive for all to authenticated using (not public.etq_e_conta_loja())', t.tablename);
  end loop;
end $$;

-- Dar acesso à loja Alphaville:
--   a conta da loja (troque o e-mail abaixo se usou outro) entra como 'loja';
--   as outras contas que já existem (a sua do Painel) entram como 'gerente'.
insert into public.etq_membros (user_id, loja_id, papel)
select id, 'alphaville', case when lower(email) = 'etiquetas.alphaville@cibalpha.com' then 'loja' else 'gerente' end
from auth.users
on conflict (user_id, loja_id) do nothing;
