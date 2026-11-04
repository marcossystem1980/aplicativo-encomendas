-- ENCOMENDAFÁCIL — CONFERÊNCIA INICIAL (somente leitura)
-- Execute no SQL Editor do projeto ekgvshtvzguzxzyhlvcu.

-- 1) Confirma o perfil Comprador vinculado.
select p.id, p.nome, p.perfil, u.email
from public.perfis p
join auth.users u on u.id = p.id
where lower(u.email) = lower('coordenador.compras@ultraassessoria.com.br');

-- 2) Confirma se a senha global das lojas já possui hash cadastrado.
select exists (
  select 1 from public.configuracoes_seguranca
  where chave = 'senha_global_lojas'
) as senha_global_configurada;

-- 3) Mostra quantas lojas existem para permitir login por CNPJ.
select count(*) as total_lojas, count(*) filter (where ativo) as lojas_ativas
from public.lojas;
