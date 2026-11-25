# Import Laser — Gestão de Compras

Aplicativo React + Vite em português. O ambiente de desenvolvimento conecta Compras e Conferência de NF-e ao Supabase de testes. Sem variáveis de conexão, o aplicativo abre o modo local de Compras.

## Organização do projeto

- `src/app`: entrada React e composição de sessão/módulos.
- `src/features/purchases` e `src/features/receiving`: telas, regras e testes de cada fluxo; autenticação e navegação ficam em `src/features/auth` e `src/features/navigation`.
- `src/shared`: API, dados compartilhados e impressão; `src/styles`: estilos globais.
- `scripts`: provisionamento e verificações de interface; `supabase/migrations` e `supabase/tests`: histórico e testes SQL.
- `docs/database/schema.sql`: proposta antiga de schema; `fixtures`: dados de entrada usados pelos testes.

Use Prettier para manter arquivos de código e documentação no padrão do projeto:

```powershell
npm.cmd run format
npm.cmd run format:check
```

As migrações e demais arquivos SQL existentes são mantidos sem reformatar.

## Executar

```powershell
npm.cmd install
npm.cmd run dev -- --host 127.0.0.1
```

Abra o endereço informado pelo Vite. A instalação do Node.js é necessária. Para compilar: npm.cmd run build (saída em dist). Abrir index.html diretamente não inicia o aplicativo.

## Supabase de desenvolvimento

O arquivo `.env.development` contém a URL e a chave publicável do projeto de testes `fqippqnarynmtxwbkurx`. Execute `npm.cmd run dev` e abra a URL exibida pelo Vite. A tela pede **Usuário** e **Senha**. Para gerar um build apontado ao mesmo projeto, use `npm.cmd run build -- --mode development`. Guarde senhas e chaves privilegiadas fora das variáveis `VITE_*`.

### Ativar o acesso Master de Eduardo

Em um terminal PowerShell privado, na raiz do projeto, execute uma vez:

```powershell
node scripts/provision-eduardo.mjs
```

Nos prompts mascarados, informe uma [chave secreta do projeto de testes](https://supabase.com/dashboard/project/fqippqnarynmtxwbkurx/settings/api-keys) com prefixo `sb_secret_` e defina a senha inicial de Eduardo. O script cria a conta via Auth Admin, associa o perfil Master automaticamente e verifica o login e os dois módulos com o mesmo token. Se já houver uma conta provisionada, o script verifica a senha atual sem redefini-la. Execute o script localmente, fora de terminais gravados ou compartilhados.

No aplicativo, entre como **Eduardo** com a senha definida. Use **Compras** e **Conferência de NF-e** no seletor de módulos. A sessão vale para ambos.

### Operar a conferência

1. Em **Nova conferência**, use um leitor configurado como teclado com Enter ao final, ou digite a chave de 44 dígitos e clique em **Consultar NF-e**. A busca consulta o Supabase. Se a nota ainda não estiver na base, importe o XML correspondente.
2. Informe a quantidade física de cada item, incluindo zero quando houver falta. Em **Produto e observações**, vincule o produto e justifique substituições. Você pode salvar um rascunho e retomar a nota pelo histórico.
3. Revise a prévia por produto ou cliente e finalize. O banco recalcula a distribuição pelos saldos e prioridades vigentes e registra as divergências. Notas finalizadas ficam disponíveis para consulta.
4. Use **Pendências** para verificar os saldos e **Relatórios** para filtrar e exportar os resultados em CSV ou salvar em PDF pelo diálogo de impressão.

### Autenticação e perfis

- O Supabase Auth usa um alias sintético no formato `usuario@login.importlaser.invalid`. O aplicativo deriva esse identificador do nome de usuário, sem pedir um endereço aos usuários. O alias de Eduardo está reservado no banco ao UUID e ao processo administrativo configurados na migração. A senha é enviada apenas ao Supabase Auth por HTTPS.
- O Supabase Auth limita tentativas no endpoint de token por IP. O botão bloqueia envios concorrentes e a interface aplica uma pausa quando recebe HTTP 429. [Limites do Supabase Auth](https://supabase.com/docs/guides/auth/rate-limits)
- **Administrador** usa os dois módulos, o cadastro fiscal e a auditoria. **Comprador** usa Compras e acompanha ocorrências. **Conferente** usa Conferência, XML, distribuição e ocorrências. RLS e as funções do banco aplicam os perfis. Um perfil inativo perde acesso aos módulos.
- Para acrescentar outros usuários, crie a conta no Auth por um canal administrativo com o alias sintético correspondente e vincule o UUID a `public.user_profiles`, com `username` em minúsculas, `full_name` e o perfil apropriado. O alias sintético não recebe e-mails de recuperação. Uma redefinição exige operação administrativa no Supabase Auth.

Em **Conferência de NF-e → Cadastro fiscal**, um administrador vincula o CNPJ ao fornecedor, cadastra o produto com código interno e unidade e valida o código desse produto no fornecedor. Nas solicitações, o SKU precisa corresponder exatamente ao código interno do catálogo para participar da distribuição automática. Descrições livres continuam disponíveis em Compras.

### Dados e regras

- As migrações em `supabase/migrations` correspondem ao histórico do projeto remoto. O arquivo `docs/database/schema.sql` é a proposta antiga.
- Os lotes mantêm sequência e posições gravadas na confirmação. O banco usa a mesma alocação para as visões **Por produto** e **Por cliente**. Compras financeiras e recebimentos físicos têm registros e saldos próprios.
- A interface de Compras mantém seus formatos existentes. As RPCs gravam lotes, solicitações e parcelas nas tabelas relacionais. Uma revisão impede que uma sessão desatualizada sobrescreva outra. Exclusões confirmadas arquivam apenas os IDs selecionados e preservam o histórico financeiro e de auditoria.
- O XML original fica na tabela privada `invoice_xml_sources`. A importação valida a estrutura lida, campos obrigatórios, formato e dígito da chave, CNPJ do emitente e duplicidade. A autorização fiscal, a assinatura digital e a validação XSD completa ficam fora desta integração.
- A finalização bloqueia a distribuição automática quando o produto ou a unidade não tem vínculo seguro. Equivalências de unidade idêntica estão disponíveis. Conversões entre embalagens exigem regras de negócio validadas.
- O documento RN001–RN015 não foi encontrado no workspace. O fluxo usa a especificação de implementação e as regras verificáveis no código existente.

### Testes

Execute `npm.cmd test`, `npm.cmd run build -- --mode development` e `npm.cmd run format:check`. O teste em `supabase/tests/workflow.sql` usa dados fictícios em uma transação com rollback. Execute-o apenas no projeto de testes vazio. Ele verifica bloqueios de acesso, revisão concorrente, saldo entre notas, correção de parcelas, prioridade e idempotência.

O teste em `supabase/tests/master_login.sql` verifica a reserva do alias, a atribuição do perfil Master e as permissões RLS dos três perfis em uma transação com rollback.
O teste `node scripts/check-login-ui.mjs [URL do aplicativo] [URL de depuração]` usa um Chrome isolado e respostas Supabase simuladas para verificar login, troca de módulo, leitura de chave, importação alternativa, rascunho, finalização, distribuição, relatórios e largura móvel.

## Início zerado autorizado em 05/11/2026

Os dados ficam no localStorage, na chave importlaser-compras-v1, separados por navegador e origem (protocolo, endereço e porta). A limpeza solicitada em 05/11/2026 usa a marca purchaseResetVersion: fresh-start-2026-11-05. Uma única vez, antes de remover dados operacionais, salva e verifica uma cópia integral do JSON anterior na chave importlaser-compras-v1-backup-before-fresh-start-2026-11-05. Se essa chave já tiver outra cópia, cria uma chave adicional sem sobrescrevê-la, guardando a referência em resetBackupKey.

Após verificar o backup, zera solicitações, parcelas de compra (que ficam dentro dos registros), lotes, pedidos gerados e eventuais históricos operacionais de versões antigas; remove também a seleção de lote ativo. Fornecedores, vendedores, regras de interpretação e demais configurações são preservados. A sequência de novos lotes começa em Lote 001. Falha de backup ou gravação não apaga a base original. JSON corrompido também não é substituído por dados vazios.

Esta limpeza é aplicada no navegador ao carregar a versão atualizada. Não ocorre em cada atualização de página: novos registros com a marca atual são mantidos. A marca não deve ser alterada em versões rotineiras. Os dados anteriores ficam somente na cópia de segurança, sem restauração automática. Em Configurações → Backup de segurança, baixe a cópia anterior ou o backup atual em JSON para guardar em arquivo.

## Solicitação atual e histórico

Cada confirmação de importação cria um lote próprio, identificado por UUID e número visual (Lote 001, Lote 002 etc.). O agrupamento usa o evento de salvamento, nunca a data, fornecedor, cliente ou status. Um novo cadastro manual também cria um lote; editar um registro não cria outro nem altera sua origem.

Depois de salvar, o sistema abre somente o lote recém-criado, sem seleção antiga e com filtros limpos. A tela Solicitações possui duas visualizações: Solicitação atual e Histórico de solicitações. O histórico lista os lotes e permite abrir qualquer um; o lote ativo continua identificado após recarregar. Filtros de período, fornecedor e pesquisa ajudam a localizar os produtos sem alterar sua origem.

Quando dados antigos tiverem um identificador explícito importId ou batchId, ele permite recuperar o grupo original. Registros sem identificador permanecem em Registros anteriores sem lote, com aviso de origem desconhecida; não são agrupados por data ou fornecedor nem recebem origem inventada. Esse comportamento de compatibilidade se aplica aos dados preservados, sem interferir na limpeza única explicitamente solicitada.

## Fluxo diário

1. Em Nova solicitação, cole a mensagem do WhatsApp e clique em Interpretar mensagem.
2. Confira fornecedor, vendedor, cliente e produtos. Os cadastros existentes identificam fornecedores e vendedores, ignorando caixa, acentos e espaços. Variações como MASTER BR e MASTER - BR são aceitas. Nome livre no cabeçalho identifica cliente, sem cadastro de clientes. Textos ambíguos ficam disponíveis para aproveitamento opcional.
3. Corrija campos na prévia ou em lote. Aplicar aos selecionados altera somente as linhas marcadas; sem seleção, Aplicar a todos altera todas. Campos em lote vazios mantêm os valores atuais.
4. Confirmar e salvar cria o lote. Interpretar não salva. Registrar solicitação cria pendentes com cotação separada; Registrar compra realizada exige confirmação explícita e dados reais.
5. Na Solicitação atual, selecione os produtos e use Gerar pedido. Existe um único texto editável por fornecedor, contendo todos os produtos selecionados daquele fornecedor, com quantidade, descrição completa e preço unitário. Nenhuma divisão por produto, cliente ou vendedor. Cliente e vendedor não entram no texto copiado. Quantidades e preços de cada linha são preservados, sem soma automática de SKUs iguais.
6. Revise, edite e copie cada mensagem. Confirmar pedido gerado marca somente a situação de geração dos produtos selecionados e preserva o lote. Não registra compra, não transfere produtos e não os exclui do histórico. No menu Mais, Marcar pedido para refazer permite desfazer essa marcação mantendo a origem.
7. Após a compra real, use Alterar status nas selecionadas. Comprado prepara automaticamente o saldo pendente e o preço cadastrado. O resumo mostra produtos, novas unidades e total; basta Confirmar compra ou Cancelar. Parcialmente comprado pede somente a quantidade desta nova compra. Data e hora são automáticas; Ajustar preço pago é opcional e afeta somente a parcela nova.

O cadastro manual fica recolhido e abre automaticamente ao editar. A coluna Nº é visual, acompanha filtros e ordenação e não altera IDs. A tabela aceita deslocamento de página para continuidade da numeração, sem controles adicionais de paginação na interface atual.

## Ações em massa e segurança

A seleção geral afeta somente os produtos visíveis do lote aberto. Abrir outro lote, trocar de visualização ou alterar filtros limpa seleção e prévia. Editar permite marcar fornecedor, vendedor, cliente ou data; campos não marcados, descrições, quantidades e preços ficam preservados. Excluir informa a quantidade e pede confirmação. Essas ações não movem produtos entre lotes.

A geração recusa misturar IDs de lotes diferentes. A confirmação de pedido guarda o texto revisado e marca apenas os IDs associados à mensagem do fornecedor. A situação do pedido, o status financeiro e o lote de origem são campos independentes.

Compras são acrescentadas em purchaseEntries com ID de operação, quantidade, custo, data e hora. Repetir a confirmação não duplica lançamentos. Produtos já comprados integralmente ou cancelados são indicados e não recebem nova compra. Parcelas anteriores preservam preços e datas. No Histórico de compras, Editar corrige uma parcela mantendo sua versão anterior como desfeita e sem mudar outras parcelas. Voltar a Pendente mantém registros anteriores desfeitos, excluídos dos gastos. Cancelado não conta como despesa.

## Relatórios

O painel mostra valor efetivamente comprado, pendências, parciais e total por fornecedor. Relatórios permitem período por data de cada compra, cliente, vendedor e fornecedor, com somas e histórico por parcela. Somente quantidades compradas de registros Comprado/Parcial entram nas despesas; pedidos gerados, cotações, pendentes e cancelados não contam.

Datas antigas ausentes não são inventadas. Todo o histórico permite consultar compras sem data para corrigir o registro. Não há integração automática com um sistema de vendas. Não há exportação Excel/CSV; o backup de segurança permanece em JSON.

## Textos não reconhecidos

Como usar este texto é opcional e não bloqueia produtos com campos válidos. Usar como cliente substitui o cliente dos selecionados; Acrescentar às observações adiciona sem apagar as anteriores; Criar uma linha de produto para editar adiciona uma linha na prévia para completar; Manter somente na mensagem original não altera produtos nem status. Não há aprovação de compra nessa seleção.

## Verificação

```powershell
npm.cmd test
npm.cmd run build
```

São 81 testes automatizados para interpretação, lotes, mensagens por fornecedor, dados legados, compras completas/parciais, correções, datas, totais, seleção e proteção da limpeza com backup.

O teste de interface usa node scripts/check-import-ui.mjs [URL do aplicativo] [URL de depuração], com Chromium de teste em depuração remota (padrão http://127.0.0.1:9229) e app em execução (padrão http://127.0.0.1:5173/). Ele cria e descarta um contexto anônimo separado, sem acessar o perfil pessoal. Verifica limpeza e backup, depois o cenário de 8 produtos (5 Master + 3 Potencial) e 4 Imprime, duas mensagens no primeiro lote, uma no segundo, seleção isolada, histórico, reload, compras reais, edição/exclusão em massa, legado, cadastro manual e largura em celular. Mensagens fictícias são usadas apenas em testes, sem criar dados demonstrativos na aplicação.

## Limitações do modo local

Nesse modo, os dados ficam no navegador, sem sincronização entre computadores, navegadores ou portas. As cópias locais dependem da conservação do armazenamento desse navegador. Baixe o JSON para manter uma cópia independente.

## Fornecedores e vendedores

Em Configurações, informe o nome e clique em Adicionar fornecedor. O cadastro usa a mesma lista dos formulários e do interpretador de WhatsApp; nomes vazios ou duplicados (incluindo variações de caixa, acentos e espaços) são rejeitados.

Cada vendedor tem Excluir com confirmação. A remoção afeta somente o cadastro ativo: solicitações, compras, parcelas e totais históricos mantêm o nome original. Na edição de um registro antigo, o vendedor removido aparece como excluído do cadastro e pode ser mantido ou substituído. Novos cadastros não usam vendedores removidos, inclusive se todos forem excluídos. As alterações persistem após recarregar.

## Impressão para a expedição

Na importação por WhatsApp, o botão Imprimir prepara folhas A4 separadas por fornecedor, com vendedores em ordem alfabética dentro de cada fornecedor. Cada linha preserva cliente, quantidade e descrição completa do produto; produtos iguais de clientes diferentes continuam em linhas separadas. A folha não inclui preço unitário, subtotal ou total financeiro.

É possível imprimir logo após colar a mensagem, usando a interpretação existente. Quando já houver uma prévia, são usadas todas as suas linhas e correções, independentemente das caixas de seleção. Se a mensagem original mudar depois de gerar a prévia, é necessário interpretar novamente antes de imprimir, evitando uma folha desatualizada. Dados ausentes aparecem como não informados e textos ainda não convertidos em produtos geram um aviso para conferir a prévia.

A ordenação existe apenas na folha; a tela e os dados originais não são reordenados. O botão abre o diálogo de impressão do navegador, sem salvar lotes, registrar compras ou alterar status. A folha é montada em um documento isolado, com texto escapado, quebra de linhas e cabeçalho de tabela repetido entre páginas.

A impressão da expedição inclui também o fornecedor em cada linha: Cliente, Fornecedor, Quantidade e Item/descrição. A ordem por vendedor é mantida, sem preços ou alterações nos registros. Fornecedor ausente aparece como Fornecedor não informado.

Ao clicar em Imprimir, cada fornecedor começa em uma nova página, com seu nome no cabeçalho. Cliente, fornecedor, quantidade e descrição permanecem em cada linha, sem preços. Fornecedores diferentes não compartilham a mesma folha. Se a lista de um fornecedor ocupar mais de uma página, ela continua sem cortar ou omitir itens. A quebra de página foi verificada em PDF: Master e Potencial produziram duas páginas distintas.

## Último preço unitário pago

No Painel, digite o produto ou SKU no campo Pesquisar. A seção Último preço unitário pago mostra descrição, fornecedor, preço de uma unidade, data/hora da compra quando conhecida e quantidade daquela parcela. O filtro de fornecedor se aplica; a consulta considera o histórico completo, independentemente do período selecionado para o total de gastos. Com Todos, é possível comparar os últimos preços registrados em cada fornecedor. A pesquisa de produto aceita SKU com ou sem hífen/espaços, mantendo descrições diferentes separadas.

A referência vem dos lançamentos de compras efetivadas, inclusive parcelas, excluindo pendentes, cancelados e parcelas desfeitas. Não usa cotação, custo médio da solicitação nem soma financeira. O cartão de despesas continua separado, com o nome Total gasto no período. Compras na mesma data com preços diferentes e sem horário suficiente são sinalizadas, exibindo os valores possíveis em vez de inventar qual foi o último. Registros sem data também são identificados. A consulta não altera preços cadastrados nem registros.

Impressão e exclusão por solicitação: use Imprimir no lote aberto ou no histórico. A folha contém todos os itens do lote, inclusive comprados, com fornecedor, vendedor, cliente, quantidade solicitada e descrição, sem valores. Cada fornecedor começa em nova página. Os filtros da tabela não limitam essa impressão. Excluir solicitação inteira exige confirmação com a quantidade total de itens e o valor retirado dos indicadores; remove também o histórico de compra desses itens, preservando outros lotes e cadastros. Registros antigos sem origem identificada continuam com exclusão individual. A numeração dos lotes não é reutilizada após exclusão.
Validação: 84 testes automatizados, teste de interface em Chrome isolado e npm run build concluídos.

Equivalência permanente de demanda: descrições de toner/cartucho TN2340, completas (TN2340/TN2370/TN630/TN660 2.6K) ou curtas, com C/ ou P/, hífens ou diferenças de caixa, são somadas no ranking de itens mais comprados. A regra fica no código purchaseReports.js e se aplica automaticamente a compras antigas e futuras, sem modificar registros originais. Chips e fotocondutores continuam separados.
