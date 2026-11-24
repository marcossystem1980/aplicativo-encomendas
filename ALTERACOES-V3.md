# Alterações da versão V3 — Visão geral unificada

## Visão geral e relatórios em uma única tela
- Removida a opção separada **Relatórios** do menu do Comprador.
- A tela **Visão geral** agora reúne os indicadores, filtros de período, pesquisa, filtro por status, tabela operacional e exportações.
- Os indicadores consideram o período aplicado (mês ou intervalo de datas) e mostram quantidade de solicitações e unidades.
- Pesquisa e status refinam a tabela e também a base enviada às exportações.
- Incluído botão para limpar o filtro de período.
- Configurações permanece como área separada.

## Exportação A7 — CSV Macintosh
- Mantidas três colunas: `CNPJ`, `EAN` e `QTD`.
- Delimitador de colunas: vírgula.
- Final de registro: CR (`\r`), padrão clássico Macintosh.
- Codificação ASCII, suficiente porque o arquivo contém somente cabeçalhos e dados numéricos.
- Sem BOM e sem coluna de descrição do produto.
- No Excel configurado para separador regional ponto e vírgula, importar o arquivo por **Dados → De Texto/CSV** e selecionar **Vírgula** como delimitador para visualizar as três colunas.
- Mantida a seleção dos status e a validação de CNPJ, EAN e quantidade.

## Segurança da implantação
- Esta versão é um pacote separado para homologação.
- Nenhuma alteração foi feita no Supabase ou no site em produção.
- A versão V2 permanece preservada no ZIP anterior.
