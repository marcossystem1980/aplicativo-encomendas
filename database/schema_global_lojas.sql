-- ============================================================
-- ENCOMENDAFÁCIL — SUPABASE (VERSÃO COM SENHA GLOBAL DAS LOJAS)
--
-- Loja: CNPJ + senha global, validada no banco.
-- Comprador: e-mail + senha pelo Supabase Auth.
--
-- IMPORTANTE:
-- 1. Execute em um projeto Supabase novo/exclusivo para o EncomendaFácil.
-- 2. Habilite Anonymous Sign-Ins em Authentication antes de testar lojas.
-- 3. Crie o usuário Comprador em Authentication e depois vincule seu perfil
--    usando o comando indicado no final deste arquivo.
-- 4. O script NÃO libera acesso direto ao segredo da senha global.
-- ============================================================

-- 0) EXTENSÃO PARA ARMAZENAR A SENHA GLOBAL COM HASH
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 1) TABELAS
create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  cnpj varchar(14) not null unique,
  nome varchar(150) not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lojas_cnpj_14_digitos check (cnpj ~ '^[0-9]{14}$'),
  constraint lojas_nome_nao_vazio check (length(trim(nome)) >= 2)
);

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome varchar(120) not null,
  perfil varchar(20) not null,
  loja_id uuid references public.lojas(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint perfis_perfil_valido check (perfil in ('comprador', 'loja')),
  constraint perfis_vinculo_loja check (
    (perfil = 'comprador' and loja_id is null)
    or (perfil = 'loja' and loja_id is not null)
  )
);

create table if not exists public.encomendas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete restrict,
  ean varchar(30) not null,
  produto varchar(180) not null,
  quantidade integer not null,
  status varchar(20) not null default 'pending',
  solicitado_por uuid not null default auth.uid() references auth.users(id) on delete restrict,
  atualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  excluida_em timestamptz,
  excluida_por uuid references auth.users(id) on delete set null,
  constraint encomendas_status_valido check (status in ('pending', 'bought', 'shortage')),
  constraint encomendas_quantidade_valida check (quantidade between 1 and 99999),
  constraint encomendas_ean_nao_vazio check (length(trim(ean)) >= 1),
  constraint encomendas_produto_nao_vazio check (length(trim(produto)) >= 2)
);

create table if not exists public.historico_encomendas (
  id bigint generated always as identity primary key,
  encomenda_id uuid not null references public.encomendas(id) on delete cascade,
  evento varchar(30) not null,
  status varchar(20),
  alterado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint historico_evento_valido check (evento in ('created', 'status_changed', 'archived')),
  constraint historico_status_valido check (status is null or status in ('pending', 'bought', 'shortage'))
);

-- Tabela interna: contém apenas o hash da senha global. Sem acesso pelo navegador.
create table if not exists public.configuracoes_seguranca (
  chave text primary key,
  valor_hash text not null,
  updated_at timestamptz not null default now()
);

-- A senha global será cadastrada em um comando separado no SQL Editor.
-- Assim, a senha não fica gravada em texto aberto neste arquivo/migração do Git.

-- 2) ÍNDICES
create index if not exists idx_perfis_loja_id
  on public.perfis (loja_id);

create index if not exists idx_encomendas_loja_data
  on public.encomendas (loja_id, created_at desc)
  where excluida_em is null;

create index if not exists idx_encomendas_status_data
  on public.encomendas (status, created_at desc)
  where excluida_em is null;

create index if not exists idx_encomendas_created_at
  on public.encomendas (created_at desc);

create index if not exists idx_historico_encomenda_data
  on public.historico_encomendas (encomenda_id, criado_em desc);

-- 3) FUNÇÕES DE CONTEXTO DO USUÁRIO
create or replace function public.usuario_perfil_atual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.perfil
  from public.perfis as p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.usuario_loja_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.loja_id
  from public.perfis as p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.usuario_tem_acesso_encomenda(p_encomenda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.encomendas as e
    where e.id = p_encomenda_id
      and (
        public.usuario_perfil_atual() = 'comprador'
        or e.loja_id = public.usuario_loja_id()
      )
  );
$$;

-- 4) AUTENTICAÇÃO DAS LOJAS COM A SENHA GLOBAL
-- O front-end primeiro cria uma sessão anônima do Supabase Auth.
-- Esta função valida CNPJ + senha no servidor e associa aquela sessão à loja.
-- A senha nunca precisa ficar escrita no app.js.
create or replace function public.entrar_como_loja(p_cnpj text, p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_hash text;
  v_loja_id uuid;
  v_nome text;
begin
  if v_uid is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Este acesso é exclusivo para sessões de loja.';
  end if;

  if length(v_cnpj) <> 14 then
    return jsonb_build_object('success', false, 'message', 'CNPJ ou senha incorretos.');
  end if;

  select cs.valor_hash
    into v_hash
  from public.configuracoes_seguranca as cs
  where cs.chave = 'senha_global_lojas';

  if v_hash is null or extensions.crypt(coalesce(p_senha, ''), v_hash) <> v_hash then
    return jsonb_build_object('success', false, 'message', 'CNPJ ou senha incorretos.');
  end if;

  select l.id, l.nome
    into v_loja_id, v_nome
  from public.lojas as l
  where l.cnpj = v_cnpj
    and l.ativo = true;

  if v_loja_id is null then
    return jsonb_build_object('success', false, 'message', 'CNPJ ou senha incorretos.');
  end if;

  insert into public.perfis (id, nome, perfil, loja_id)
  values (v_uid, v_nome, 'loja', v_loja_id)
  on conflict (id) do update
    set nome = excluded.nome,
        perfil = 'loja',
        loja_id = excluded.loja_id,
        updated_at = now();

  return jsonb_build_object(
    'success', true,
    'loja_id', v_loja_id,
    'nome', v_nome,
    'cnpj', v_cnpj
  );
end;
$$;

-- 5) DATAS E AUDITORIA
create or replace function public.fn_atualizar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.fn_preparar_atualizacao_encomenda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.atualizado_por := auth.uid();
    if old.excluida_em is null and new.excluida_em is not null then
      new.excluida_por := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.fn_registrar_historico_encomenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.historico_encomendas
      (encomenda_id, evento, status, alterado_por)
    values
      (new.id, 'created', new.status, coalesce(auth.uid(), new.solicitado_por));
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.historico_encomendas
      (encomenda_id, evento, status, alterado_por)
    values
      (new.id, 'status_changed', new.status, coalesce(auth.uid(), new.atualizado_por));
  end if;

  if old.excluida_em is null and new.excluida_em is not null then
    insert into public.historico_encomendas
      (encomenda_id, evento, status, alterado_por)
    values
      (new.id, 'archived', new.status, coalesce(auth.uid(), new.excluida_por));
  end if;

  return new;
end;
$$;

-- 6) TRIGGERS
drop trigger if exists trg_lojas_updated_at on public.lojas;
create trigger trg_lojas_updated_at
before update on public.lojas
for each row execute function public.fn_atualizar_updated_at();

drop trigger if exists trg_perfis_updated_at on public.perfis;
create trigger trg_perfis_updated_at
before update on public.perfis
for each row execute function public.fn_atualizar_updated_at();

drop trigger if exists trg_encomendas_preparar_atualizacao on public.encomendas;
create trigger trg_encomendas_preparar_atualizacao
before update on public.encomendas
for each row execute function public.fn_preparar_atualizacao_encomenda();

drop trigger if exists trg_encomendas_historico on public.encomendas;
create trigger trg_encomendas_historico
after insert or update on public.encomendas
for each row execute function public.fn_registrar_historico_encomenda();

-- 7) ROW LEVEL SECURITY
alter table public.lojas enable row level security;
alter table public.perfis enable row level security;
alter table public.encomendas enable row level security;
alter table public.historico_encomendas enable row level security;
alter table public.configuracoes_seguranca enable row level security;

-- Lojas: comprador enxerga/gerencia todas; loja enxerga somente a própria.
drop policy if exists lojas_select_comprador_ou_propria on public.lojas;
create policy lojas_select_comprador_ou_propria
on public.lojas for select to authenticated
using (
  public.usuario_perfil_atual() = 'comprador'
  or id = public.usuario_loja_id()
);

drop policy if exists lojas_insert_comprador on public.lojas;
create policy lojas_insert_comprador
on public.lojas for insert to authenticated
with check (public.usuario_perfil_atual() = 'comprador');

drop policy if exists lojas_update_comprador on public.lojas;
create policy lojas_update_comprador
on public.lojas for update to authenticated
using (public.usuario_perfil_atual() = 'comprador')
with check (public.usuario_perfil_atual() = 'comprador');

-- Perfis: cada usuário vê o próprio perfil; comprador pode consultar todos.
drop policy if exists perfis_select_proprio_ou_comprador on public.perfis;
create policy perfis_select_proprio_ou_comprador
on public.perfis for select to authenticated
using (
  id = auth.uid()
  or public.usuario_perfil_atual() = 'comprador'
);

-- Encomendas: loja consulta somente sua loja; comprador consulta todas.
drop policy if exists encomendas_select_por_perfil on public.encomendas;
create policy encomendas_select_por_perfil
on public.encomendas for select to authenticated
using (
  excluida_em is null
  and (
    public.usuario_perfil_atual() = 'comprador'
    or loja_id = public.usuario_loja_id()
  )
);

drop policy if exists encomendas_insert_propria_loja_ou_comprador on public.encomendas;
create policy encomendas_insert_propria_loja_ou_comprador
on public.encomendas for insert to authenticated
with check (
  public.usuario_perfil_atual() = 'comprador'
  or (
    public.usuario_perfil_atual() = 'loja'
    and loja_id = public.usuario_loja_id()
    and solicitado_por = auth.uid()
  )
);

drop policy if exists encomendas_update_comprador on public.encomendas;
create policy encomendas_update_comprador
on public.encomendas for update to authenticated
using (public.usuario_perfil_atual() = 'comprador')
with check (public.usuario_perfil_atual() = 'comprador');

-- Histórico: somente leitura, restrita às encomendas que o usuário pode acessar.
drop policy if exists historico_select_por_acesso_encomenda on public.historico_encomendas;
create policy historico_select_por_acesso_encomenda
on public.historico_encomendas for select to authenticated
using (public.usuario_tem_acesso_encomenda(encomenda_id));

-- 8) PERMISSÕES: segredo nunca fica acessível ao navegador.
revoke all on table public.lojas from anon, authenticated, public;
revoke all on table public.perfis from anon, authenticated, public;
revoke all on table public.encomendas from anon, authenticated, public;
revoke all on table public.historico_encomendas from anon, authenticated, public;
revoke all on table public.configuracoes_seguranca from anon, authenticated, public;

grant usage on schema public to authenticated;
grant select, insert, update on public.lojas to authenticated;
grant select on public.perfis to authenticated;
grant select, insert, update on public.encomendas to authenticated;
grant select on public.historico_encomendas to authenticated;

revoke all on function public.usuario_perfil_atual() from public, anon;
revoke all on function public.usuario_loja_id() from public, anon;
revoke all on function public.usuario_tem_acesso_encomenda(uuid) from public, anon;
revoke all on function public.entrar_como_loja(text, text) from public, anon;
revoke all on function public.fn_atualizar_updated_at() from public, anon;
revoke all on function public.fn_preparar_atualizacao_encomenda() from public, anon;
revoke all on function public.fn_registrar_historico_encomenda() from public, anon;

grant execute on function public.usuario_perfil_atual() to authenticated;
grant execute on function public.usuario_loja_id() to authenticated;
grant execute on function public.usuario_tem_acesso_encomenda(uuid) to authenticated;
grant execute on function public.entrar_como_loja(text, text) to authenticated;

-- 9) CADASTRO DO COMPRADOR (execute depois de criar o usuário no Authentication)
-- Substitua o e-mail abaixo pelo e-mail real do Comprador e execute separadamente:
--
-- insert into public.perfis (id, nome, perfil, loja_id)
-- select u.id, 'Comprador', 'comprador', null
-- from auth.users u
-- where lower(u.email) = lower('SEU_EMAIL@EMPRESA.COM.BR')
-- on conflict (id) do update
-- set nome = excluded.nome, perfil = 'comprador', loja_id = null, updated_at = now();
--
-- 10) CADASTRAR OU ALTERAR A SENHA GLOBAL DAS LOJAS (somente SQL Editor)
-- Execute manualmente no SQL Editor, sem salvar esta senha no repositório Git:
--
-- insert into public.configuracoes_seguranca (chave, valor_hash)
-- values ('senha_global_lojas', extensions.crypt('SENHA_GLOBAL_AQUI', extensions.gen_salt('bf')))
-- on conflict (chave) do update
-- set valor_hash = excluded.valor_hash, updated_at = now();
--
-- 11) CONFERÊNCIA
-- select id, cnpj, nome, ativo from public.lojas order by nome;
-- select id, nome, perfil, loja_id from public.perfis;
-- select id, loja_id, ean, produto, quantidade, status, created_at from public.encomendas order by created_at desc;
