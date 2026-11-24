# EncomendaFácil — primeira etapa de modularização

## Objetivo

Separar o JavaScript por responsabilidade sem alterar regras de negócio, interface, banco de dados ou configuração do Supabase.

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `js/core.js` | Configuração do cliente, estado compartilhado, utilitários e leitura de dados |
| `js/auth.js` | Login, recuperação de senha, logout e restauração de sessão |
| `js/store.js` | Tela da loja, validação da descrição e criação de encomendas |
| `js/orders.js` | Tabelas, ordenação, filtros, seleção, alteração em lote e arquivamento |
| `js/reports.js` | Relatórios e filtros por período |
| `js/exports.js` | Exportação Excel e planilha Excel A7 |
| `js/settings.js` | Configurações, cadastro de lojas, migração e importação de planilhas |
| `app.js` | Composição das telas, navegação e inicialização |
| `backup/app.original.js` | Cópia do arquivo original de 1.568 linhas para recuperação |

## Decisão de compatibilidade

O código original utiliza diversas funções e variáveis compartilhadas no escopo global. Para evitar uma conversão ampla de dependências de uma só vez, esta primeira etapa mantém scripts clássicos carregados em sequência. Isso permite separar os arquivos sem reescrever as chamadas entre funções.

A conversão para ES Modules (`import`/`export`) fica para uma etapa posterior, depois de validar o comportamento no navegador. Não adicionar `async` às tags locais nem alterar a ordem definida em `index.html`.

## O que foi preservado

- As 79 funções originais foram copiadas sem alteração de conteúdo.
- O bloco de configuração do Supabase permaneceu inalterado.
- Os arquivos HTML de redefinição de senha e seu JavaScript permaneceram inalterados.
- O CSS e os scripts SQL permaneceram inalterados.
- Nenhuma alteração foi feita no banco Supabase ou nas políticas RLS.

## Verificações técnicas executadas

- Verificação de sintaxe JavaScript (`node --check`) nos scripts.
- Comparação do conteúdo das 79 funções com o arquivo original.
- Carregamento sequencial dos oito scripts em um contexto JavaScript compartilhado, sem conflito de declarações.
- Conferência de que as referências de scripts locais em `index.html` apontam para arquivos existentes.

## Testes manuais ainda necessários

Os testes abaixo precisam ser realizados em navegador com conexão ao Supabase de produção ou, preferencialmente, em um ambiente de homologação:

1. Login de loja e login do Comprador.
2. Restauração de sessão e logout.
3. Cadastro e consulta de encomendas.
4. Filtros, pesquisas, ordenação e seleção.
5. Alteração de status em lote e arquivamento.
6. Relatórios por mês e intervalo de datas.
7. Exportação Excel e planilha Excel A7.
8. Importação de lojas e migração de dados legados (somente com cópia/ambiente de teste).
9. Recuperação e alteração de senha.
10. Testes em tela desktop e celular.

**Esta versão é para homologação. Não substituir a publicação em produção antes de concluir os testes manuais.**
