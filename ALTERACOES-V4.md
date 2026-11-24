# Alterações da versão V4 — Exportação A7 em Excel

## Exportação A7
- Substituída a exportação CSV Macintosh por uma planilha Excel `.xlsx` verdadeira.
- O arquivo contém somente três colunas: `CNPJ`, `EAN` e `QTD`.
- CNPJ e EAN são armazenados como texto, preservando zeros à esquerda e evitando conversões automáticas do Excel.
- QTD é armazenado como valor numérico.
- Mantidas a seleção de status, as validações de CNPJ/EAN/quantidade e os filtros aplicados na Visão geral.
- O arquivo não usa delimitadores de texto (vírgulas ou ponto e vírgula): os campos ocupam células independentes da planilha.

## Segurança da implantação
- Esta versão é um pacote separado para homologação.
- Nenhuma alteração foi feita no Supabase ou no site em produção.
- A versão V3 permanece preservada no ZIP anterior.
