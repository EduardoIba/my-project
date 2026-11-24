# Sidebar compartilhada

## Problema

As áreas de Compras e Conferência usam sidebars diferentes. A navegação muda de formato conforme módulo, tela e perfil, reduzindo consistência para usuários autenticados.

## Escopo e critérios de aceite

- WHEN usuário autenticado abre qualquer tela de Compras ou Conferência THEN sistema SHALL renderizar o mesmo componente de sidebar no padrão visual da Conferência.
- WHEN tela ou módulo muda THEN sistema SHALL atualizar item ativo e opções do módulo sem alterar estrutura, marca ou cartão de perfil.
- WHEN perfil é `comprador` THEN sidebar SHALL mostrar Painel, Nova solicitação, Solicitações, Relatórios e Configurações em Compras; Conferência SHALL ficar indisponível.
- WHEN perfil é `conferente` THEN sidebar SHALL mostrar Painel, Nova conferência, Histórico, Pendências e Relatórios em Conferência, sem Cadastro fiscal; Compras SHALL ficar indisponível.
- WHEN perfil é `administrador` THEN sidebar SHALL manter opções atuais dos dois módulos, incluindo Cadastro fiscal somente em Conferência e troca de módulo no cartão.
- WHEN administrador troca de módulo ou encerra sessão THEN sistema SHALL manter os atalhos existentes no cartão de perfil.
- WHEN viewport tem largura de até 700px THEN sidebar SHALL ficar acima do conteúdo, manter todas as opções alcançáveis por rolagem horizontal e manter cartão da conta, troca de módulo e saída visíveis.

## Premissas

- Opções atuais de cada perfil e módulo são a fonte de verdade.
- Perfil e nível de acesso existentes identificam usuário no cartão; não há requisito de exibir nome/email.
- Layout mobile empilha sidebar acima do conteúdo em 700px ou menos; navegação rola horizontalmente e controles da conta permanecem visíveis.
- Protótipo local permanece funcional e usa o mesmo componente.

## Fora de escopo

- Alterar permissões, rotas, rótulos ou comportamento das telas.
- Persistir a última tela ou módulo selecionado.
