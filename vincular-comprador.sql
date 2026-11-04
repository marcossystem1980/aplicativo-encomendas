-- ENCOMENDAFÁCIL — VINCULAR USUÁRIO DO SUPABASE AUTH AO PERFIL COMPRADOR
--
-- 1) No Supabase, acesse Authentication > Users > Add user > Create new user.
-- 2) Cadastre o e-mail do Comprador e defina uma senha inicial forte.
-- 3) Confirme o e-mail no painel (ou use a opção de confirmação automática).
-- 4) Substitua o e-mail abaixo e execute este SQL no SQL Editor.
-- 5) O usuário poderá alterar a senha pelo site ou usar "Esqueci minha senha".

insert into public.perfis (id, nome, perfil, loja_id)
select u.id, 'Comprador', 'comprador', null
from auth.users as u
where lower(u.email) = lower('coordenador.compras@ultraassessoria.com.br')
on conflict (id) do update
set nome = excluded.nome,
    perfil = 'comprador',
    loja_id = null,
    updated_at = now();

-- Conferência: deve retornar uma linha com perfil = comprador.
select p.id, p.nome, p.perfil, u.email
from public.perfis p
join auth.users u on u.id = p.id
where lower(u.email) = lower('coordenador.compras@ultraassessoria.com.br');
