# Design Doc: Geração de Carrosséis na Página de Galeria

## Intent & The Why
Simplificar e unificar a experiência de criação e visualização de carrosséis. A página separada de "Gerar Carrosséis" torna o fluxo fragmentado; ao trazer o botão de geração para a própria Galeria, o usuário dispara a geração de acordo com o contexto em que está (conta específica ou global para todas as contas ativas) e acompanha o resultado imediatamente na mesma tela.

## Goals
- Remover a página dedicada `GeneratePage` e o link "Gerar" na `Sidebar` e `App.tsx`.
- Adicionar botão de "Gerar Carrossel" / "Gerar para Todas as Contas" no topo da `GalleryPage` (header card actions).
- No contexto de uma conta selecionada (`selectedAccountId !== 'all'`), gerar carrossel apenas para essa conta.
- No contexto global (`selectedAccountId === 'all'`), gerar carrosséis para todas as contas habilitadas (`accounts.filter(a => a.enabled)`).
- Durante o processo de geração, fornecer feedback visual imediato (botão desabilitado com spinner e toast de progresso).
- Fazer polling do job de geração (`pollGenerationJob`) até sua conclusão.
- Ao concluir com sucesso, recarregar automaticamente a lista de carrosséis da galeria (`loadRuns()`) e exibir notificação toast de sucesso. Se ocorrer falha, exibir toast de erro.
- Atualizar a mensagem e ações do estado vazio (empty state) da galeria para direcionar a geração pelo botão do cabeçalho ou permitir gerar direto do estado vazio.

## Non-Goals & Anti-Goals
- Não alterar a API do backend (`/api/v1/carousels/generate` e `/api/v1/carousels/jobs/:jobId` permanecem intactas).
- Não criar modais complexos de configuração de prompt ou overrides na galeria neste momento (o disparo segue os arquétipos e temas das contas configuradas).
- Não quebrar filtros existentes de busca, status ou filtro por conta da Galeria.

## Approaches Considered
1. **Redirecionar para a aba Gerar:** Mantinha a aba antiga e apenas adicionava um link/atalho. Rejeitado pelo usuário: a aba Gerar é redundante e deve ser eliminada.
2. **Disparo direto na Galeria com feedback e atualização reativa (Escolhido):** O botão no topo da galeria aciona a geração respeitando o contexto ativo (conta única vs todas as contas habilitadas), faz polling do job e recarrega os carrosséis assim que concluído.
3. **Modal de formulário na Galeria:** Adicionaria etapas e cliques desnecessários para a necessidade atual. Rejeitado em favor do disparo direto e ágil.

## Key Decisions
- `Sidebar.tsx`: Remover grupo ou item `{ id: "gerar", label: "Gerar", icon: Sparkles }`.
- `App.tsx`: Remover renderização da aba `gerar` e atualizar o tipo `NavTab` / títulos.
- `GalleryPage.tsx`:
  - Consumir `accounts` de `useAccount()`.
  - Função auxiliar `resolveTargetAccountIds(selectedAccountId, accounts)`:
    - Se `selectedAccountId !== 'all'`, retorna `[selectedAccountId]`.
    - Se `selectedAccountId === 'all'`, retorna IDs de todas as contas com `enabled === true`.
  - Estado `isGenerating`: desabilita os botões de gerar e atualizar durante o processo.
  - Execução: chama `generateCarousels({ accountIds: targetIds })`, faz `pollGenerationJob(job.id)`, chama `loadRuns()` ao final e notifica via toast.
- Testes:
  - Manter/migrar os testes de unidade de resolução de contas e API de geração para `frontend/src/gallery-generate.test.ts` ou integrar em `gallery-performance.test.ts`.
