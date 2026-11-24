# Sidebar compartilhada

## Problema

As áreas de Compras e Conferência usam sidebars diferentes. A navegação muda de formato conforme módulo, tela e perfil, reduzindo consistência para usuários autenticados.

## Escopo e critérios de aceite

- WHEN usuário autenticado abre qualquer tela de Compras ou Conferência THEN sistema SHALL renderizar o mesmo componente de sidebar no padrão visual da Conferência.
- WHEN tela ou módulo muda THEN sistema SHALL atualizar item ativo e opções do módulo sem alterar estrutura, marca ou cartão de perfil.
- WHEN perfil não possui acesso a opção THEN sistema SHALL omitir opção, preservando permissões atuais.
- WHEN administrador troca de módulo ou encerra sessão THEN sistema SHALL manter os atalhos existentes no cartão de perfil.
- WHEN viewport fica estreita THEN sidebar SHALL permanecer navegável e adaptada ao layout mobile.

## Premissas

- Opções atuais de cada perfil e módulo são a fonte de verdade.
- Perfil e nível de acesso existentes identificam usuário no cartão; não há requisito de exibir nome/email.
- Protótipo local permanece funcional e usa o mesmo componente.

## Fora de escopo

- Alterar permissões, rotas, rótulos ou comportamento das telas.
- Persistir a última tela ou módulo selecionado.
