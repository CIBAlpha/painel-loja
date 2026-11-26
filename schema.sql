-- Painel da Loja — estrutura do banco de dados
-- Cole tudo isto no Supabase em: SQL Editor > New query > Run

-- 1) Cada coleta do robô (a cada 15 min) fica guardada aqui
create table if not exists public.vendas_snapshot (
  id           bigserial primary key,
  coletado_em  timestamptz not null default now(),
  dia          date        not null,
  vl_fat       numeric,
  tc           numeric,
  tm           numeric,
  dados        jsonb       not null
);
create index if not exists vendas_snapshot_dia_idx
  on public.vendas_snapshot (dia, coletado_em desc);

-- 2) Um resumo por dia (o histórico que fica para sempre)
create table if not exists public.vendas_dia (
  dia           date primary key,
  vl_fat        numeric,
  tc            numeric,
  tm            numeric,
  origem        jsonb,
  atendimento   jsonb,
  pagamento     jsonb,
  atualizado_em timestamptz not null default now()
);

-- 3) Situação do robô (para o painel avisar se parou)
create table if not exists public.robo_status (
  id              int primary key default 1,
  ultima_execucao timestamptz,
  ok              boolean,
  mensagem        text
);

-- Segurança: só quem fizer login no painel consegue LER.
-- O robô grava usando a chave secreta (service_role), que ignora estas regras.
alter table public.vendas_snapshot enable row level security;
alter table public.vendas_dia      enable row level security;
alter table public.robo_status     enable row level security;

drop policy if exists "leitura logado" on public.vendas_snapshot;
drop policy if exists "leitura logado" on public.vendas_dia;
drop policy if exists "leitura logado" on public.robo_status;

create policy "leitura logado" on public.vendas_snapshot for select to authenticated using (true);
create policy "leitura logado" on public.vendas_dia      for select to authenticated using (true);
create policy "leitura logado" on public.robo_status     for select to authenticated using (true);

-- Limpeza: snapshots com mais de 60 dias são apagados (o resumo diário fica)
create or replace function public.limpar_snapshots_antigos() returns void
language sql as $$
  delete from public.vendas_snapshot where coletado_em < now() - interval '60 days';
$$;

-- Produtos vendidos (gravado pelo robô: ref = 'dia:AAAA-MM-DD' ou 'mes:AAAA-MM')
alter table public.vendas_produtos enable row level security;
drop policy if exists "leitura logado" on public.vendas_produtos;
create policy "leitura logado" on public.vendas_produtos for select to authenticated using (true);
