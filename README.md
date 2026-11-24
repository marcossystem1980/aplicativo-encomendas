# EncomendaFácil — Supabase

Aplicação estática em HTML, CSS e JavaScript, conectada ao Supabase Auth e PostgreSQL. Mantém a interface existente e substitui o armazenamento de encomendas/lojas no navegador por dados centralizados no Supabase.

## Arquivos principais

- `index.html`: login e aplicação.
- `styles.css`: identidade visual.
- `app.js`: inicialização e composição das telas.
- `js/core.js`: configuração do Supabase, estado compartilhado e utilitários.
- `js/auth.js`: login, recuperação de senha e restauração de sessão.
- `js/store.js`: telas e operações da área da loja.
- `js/orders.js`: listagem, filtros, seleção e operações de encomendas.
- `js/reports.js`: filtro de período integrado à Visão geral.
- `js/exports.js`: exportação do relatório completo e planilha Excel (.xlsx) para A7.
- `js/settings.js`: configurações, cadastro de lojas e importação de planilhas.
- `supabase-config.js`: Project URL e chave pública (publishable/anon).
- `backup/app.original.js`: cópia de segurança do `app.js` monolítico original.
- `redefinir-senha.html` e `redefinir-senha.js`: fluxo de recuperação de senha do Comprador.
- `database/schema_global_lojas.sql`: schema inicial usado no Supabase.
- `database/vincular_comprador.sql`: associa um usuário Auth ao perfil `comprador`.

## Organização do JavaScript

O JavaScript foi separado por responsabilidade, preservando as funções e regras existentes. Nesta primeira etapa, os arquivos `js/*.js` são carregados como scripts clássicos, em ordem, para manter compatibilidade com o escopo compartilhado que a versão original utilizava. Por isso, mantenha a sequência de scripts no final de `index.html` e não adicione `async` aos arquivos locais.

Esta é uma etapa intermediária de modularização com foco em baixo risco. A conversão para ES Modules (`import`/`export`) pode ser feita depois dos testes funcionais no navegador, com a dependência entre funções tratada de forma explícita.

A pasta `backup` serve apenas para recuperação e não é carregada pelo aplicativo.

## Histórico de melhorias

- V2: `ALTERACOES-V2.md` — exportação na Visão geral e validação para impedir que Produto seja igual ao EAN/código de barras.
- V3: `ALTERACOES-V3.md` — unificação de Visão geral e Relatórios, além da especificação inicial de exportação A7 (substituída por Excel na V4).

Este pacote é destinado à homologação antes de qualquer publicação.

## Configuração inicial

1. A conexão deste pacote já está preenchida com a Project URL e a Publishable Key fornecidas para o projeto `ekgvshtvzguzxzyhlvcu`.
2. A Publishable Key é própria para o navegador; nunca coloque a chave `service_role` ou `secret` no navegador ou no GitHub.
3. No Supabase, habilite `Authentication → Sign In / Providers → Anonymous Sign-Ins` para o acesso das lojas.
4. Confirme que a senha global das lojas foi registrada em `public.configuracoes_seguranca`.
5. O Comprador `coordenador.compras@ultraassessoria.com.br` já foi criado e vinculado ao perfil `comprador`; não execute novamente o SQL de vínculo, a menos que precise recriar o perfil.
6. Em `Authentication → URL Configuration`, inclua a URL de `redefinir-senha.html` para localhost e, depois, para o domínio Vercel.

## Comportamento de acesso

- Loja: CNPJ + senha global. O JavaScript não valida nem armazena a senha; a função RPC `entrar_como_loja` faz a validação no banco e associa a sessão anônima à loja.
- Comprador: e-mail + senha pelo Supabase Auth. Pode pedir recuperação por e-mail e alterar a senha em `Configurações → Minha conta`.
- As políticas RLS definem o que cada sessão pode consultar e alterar.

## Migração dos dados locais antigos

Se o site anterior foi aberto no navegador usando o mesmo endereço e porta, os dados antigos ainda podem existir no `localStorage` desse endereço. Entre como Comprador na nova versão, abra `Configurações` e use `Migrar dados antigos para o Supabase`. O processo preserva os dados legados no navegador e registra a migração para evitar repetição acidental.

A migração automática não consegue ler o `localStorage` de outro domínio, outro protocolo ou outra porta. Por isso, execute-a ainda no endereço local original, antes de mudar para o Vercel.

## Teste local

Abra a pasta no VS Code e execute `index.html` por um servidor local, como Live Server. Não abra o arquivo diretamente com `file://`. Configure Supabase, crie/vincule o Comprador e importe o cadastro de lojas antes de testar o login das lojas.

## Publicação no Vercel

Este é um projeto estático; não requer React, Vite, npm ou etapa de build. Envie o conteúdo desta pasta para o GitHub e importe o repositório no Vercel com Framework Preset `Other`. O diretório raiz publicado precisa conter `index.html`. Depois do primeiro deploy, adicione o endereço Vercel de `redefinir-senha.html` às Redirect URLs do Supabase.


## Visão geral unificada

A tela Visão geral do Comprador concentra os indicadores, filtros por período, pesquisa, status, tabela de encomendas e exportações. A exportação A7 gera uma planilha Excel (.xlsx) com três colunas independentes: CNPJ, EAN e QTD. CNPJ e EAN são armazenados como texto para preservar zeros à esquerda; QTD é numérico.


- V4: `ALTERACOES-V4.md` — substituição do CSV A7 por uma planilha Excel `.xlsx` com três colunas independentes.
