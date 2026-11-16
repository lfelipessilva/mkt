# Geração de Carrosséis na Página de Galeria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar a experiência de geração de carrosséis na página de Galeria, adicionando um botão de geração que respeita o contexto de conta ativa vs todas as contas, e removendo a antiga página separada "Gerar Carrosséis".

**Architecture:** A `GalleryPage` passa a integrar diretamente a chamada à API de geração (`generateCarousels` e `pollGenerationJob`). A função de resolução de contas seleciona o ID da conta pinned quando houver contexto, ou todas as contas ativas (`enabled`) quando em contexto global. A navegação (`Sidebar`, `App.tsx` e `NavTab`) é simplificada para remover a aba redundante de geração.

**Tech Stack:** React 19, TypeScript, Lucide Icons, Vite, Node.js test runner (`node:test`, `node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-11-16-carousel-generate-in-gallery-design.md`

## Global Constraints

- Backend endpoints `/api/v1/carousels/generate` e `/api/v1/carousels/jobs/:jobId` permanecem intactos.
- No contexto de conta (`selectedAccountId !== 'all'`), apenas a conta selecionada deve ser incluída no payload de geração.
- No contexto global (`selectedAccountId === 'all'`), apenas contas com `enabled === true` devem ser incluídas no payload de geração.
- A interface de Galeria deve desabilitar o botão durante a geração e exibir feedback visual contínuo (spinner e toast informativo).
- Ao concluir a geração com sucesso, a lista de carrosséis deve ser atualizada automaticamente via `loadRuns()` sem recarregar a página.

## Review Focus

1. Tentativa de geração quando nenhuma conta está habilitada no contexto global: deve exibir toast de aviso sem disparar requisição inválida.
2. Tentativa de geração quando a conta selecionada está desabilitada: deve avisar ou prosseguir apenas se explicitamente permitido.
3. Falha ou timeout no polling da geração (`pollGenerationJob` rejeitado): deve restaurar o estado do botão (`isGenerating = false`) e exibir mensagem de erro amigável no toast.
4. Concorrência: clicar repetidamente no botão durante a geração deve ser prevenido por `isGenerating` e `disabled`.
5. Navegação: remover `"gerar"` de `NavTab` e `Sidebar` não deve quebrar nenhuma rota padrão ou renderização de tabs existentes.

---

### Task 1: Função de resolução de contas e testes unitários

**WDD class:** wiring

**Files:**
- Create: `frontend/src/gallery-generate.test.ts`
- Modify: `frontend/src/tabs/GalleryPage.tsx:1-30`
- Remove: `frontend/src/generate.test.ts`

**Interfaces:**
- Produces: `export function resolveGalleryTargetAccountIds(selectedAccountId: string, accounts: Account[]): string[]`

- [ ] **Step 1: Write the failing unit tests for account target resolution in `frontend/src/gallery-generate.test.ts`**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGalleryTargetAccountIds } from "./tabs/GalleryPage";
import type { Account } from "./types";

describe("GalleryPage: resolveGalleryTargetAccountIds", () => {
  const mockAccounts: Account[] = [
    { id: "acc_1", display_name: "Account One", persona: "P1", role: "single_woman", enabled: true },
    { id: "acc_2", display_name: "Account Two", persona: "P2", role: "single_man", enabled: false },
    { id: "acc_3", display_name: "Account Three", persona: "P3", role: "couple_men", enabled: true },
  ];

  it("returns only the pinned account ID when selectedAccountId is specific", () => {
    const targets = resolveGalleryTargetAccountIds("acc_1", mockAccounts);
    assert.deepEqual(targets, ["acc_1"]);
  });

  it("returns all enabled account IDs when selectedAccountId is 'all'", () => {
    const targets = resolveGalleryTargetAccountIds("all", mockAccounts);
    assert.deepEqual(targets, ["acc_1", "acc_3"]);
  });

  it("returns empty array when selectedAccountId is 'all' and no accounts are enabled", () => {
    const disabledAccounts: Account[] = [
      { id: "acc_2", persona: "P2", role: "single_man", enabled: false },
    ];
    const targets = resolveGalleryTargetAccountIds("all", disabledAccounts);
    assert.deepEqual(targets, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/gallery-generate.test.ts` (ou via tsx)
Expected: FAIL with "resolveGalleryTargetAccountIds is not a function"

- [ ] **Step 3: Implement `resolveGalleryTargetAccountIds` in `frontend/src/tabs/GalleryPage.tsx`**

```typescript
export function resolveGalleryTargetAccountIds(
  selectedAccountId: string,
  accounts: Account[]
): string[] {
  if (selectedAccountId && selectedAccountId !== "all") {
    return [selectedAccountId];
  }
  return accounts.filter((a) => a.enabled).map((a) => a.id);
}
```

- [ ] **Step 4: Remove obsolete `frontend/src/generate.test.ts` and verify test passes**

Run test to ensure `frontend/src/gallery-generate.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tabs/GalleryPage.tsx frontend/src/gallery-generate.test.ts
git rm frontend/src/generate.test.ts
git commit -m "feat(gallery): add target account resolution for gallery carousel generation"
```

---

### Task 2: Implementar botão de geração, polling e auto-refresh na Galeria

**WDD class:** dense

**Files:**
- Modify: `frontend/src/tabs/GalleryPage.tsx`
- Modify: `frontend/src/gallery-generate.test.ts`

**Interfaces:**
- Consumes: `generateCarousels`, `pollGenerationJob` de `../api`, `useAccount` de `../context`, `Sparkles` de `lucide-react`.

- [ ] **Step 1: Write integration tests in `frontend/src/gallery-generate.test.ts` covering generation trigger logic**

Adicionar testes simulando a chamada de `generateCarousels` e `pollGenerationJob` para verificar os payloads corretos em contexto pinned e global.

- [ ] **Step 2: Run tests to verify failure/missing behavior**

Run: testes de frontend.
Expected: FAIL até implementação completa.

- [ ] **Step 3: Implement generation handler and UI button in `frontend/src/tabs/GalleryPage.tsx`**

- Importar `Sparkles` de `lucide-react`.
- Importar `generateCarousels` e `pollGenerationJob` de `../api`.
- Adicionar estado `isGenerating` (`useState(false)`).
- Implementar `handleGenerateCarousels`:
  - Obter `targetAccountIds = resolveGalleryTargetAccountIds(selectedAccountId, accounts)`.
  - Se `targetAccountIds.length === 0`: exibir toast de aviso (`Nenhuma conta ativa para gerar carrossel.`) e retornar.
  - Setar `isGenerating(true)`.
  - Exibir toast info (`Iniciando geração de carrossel...`).
  - Executar `const job = await generateCarousels({ accountIds: targetAccountIds })`.
  - Executar `await pollGenerationJob(job.id, { intervalMs: 1500 })`.
  - Ao terminar: toast sucesso (`Geração concluída com sucesso!`), disparar `loadRuns()` e `setIsGenerating(false)`.
  - Em `catch (err)`: toast erro (`Erro ao gerar carrossel: ...`) e `setIsGenerating(false)`.
- Adicionar no `.header-actions`:
  ```tsx
  <button
    type="button"
    className="btn btn-primary flex items-center gap-1.5"
    onClick={handleGenerateCarousels}
    disabled={isGenerating || loading}
  >
    <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
    <span>
      {isGenerating
        ? "Gerando carrossel..."
        : selectedAccountId !== "all"
        ? `Gerar Carrossel (@${selectedAccount?.id ?? selectedAccountId})`
        : `Gerar para Todas as Contas`}
    </span>
  </button>
  ```
- Atualizar o estado vazio (`.gallery-empty-state`):
  - Atualizar o texto para: `"Clique em Gerar Carrossel acima para criar novos carrosséis."`
  - Adicionar botão de geração direta dentro do estado vazio quando não houver filtros ativos.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test frontend/src/gallery-generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tabs/GalleryPage.tsx frontend/src/gallery-generate.test.ts
git commit -m "feat(gallery): add carousel generation button with context-aware targets and auto-refresh"
```

---

### Task 3: Remover página GeneratePage da navegação e tipos

**WDD class:** wiring

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types.ts`
- Remove: `frontend/src/tabs/GeneratePage.tsx`

**Interfaces:**
- `NavTab` agora consiste em: `"desempenho" | "galeria" | "contas" | "textos" | "midias" | "integracoes"`.

- [ ] **Step 1: Write verification test for updated `NavTab` and `Sidebar`**

Verificar que as abas suportadas não contêm mais `"gerar"` e que o layout renderiza normalmente.

- [ ] **Step 2: Update `frontend/src/components/Sidebar.tsx`**

Remover `{ id: "gerar", label: "Gerar", icon: Sparkles }` da lista de navegação `NAV_GROUPS`.

- [ ] **Step 3: Update `frontend/src/App.tsx` and `frontend/src/types.ts`**

- Remover `"gerar"` de `NavTab` em `frontend/src/types.ts`.
- Em `App.tsx`: remover `import { GeneratePage } from "./tabs/GeneratePage"`, remover `gerar: "Gerar Carrosséis"` de `TAB_TITLES`, remover bloco condicional `currentTab === "gerar"`.
- Deletar `frontend/src/tabs/GeneratePage.tsx`.

- [ ] **Step 4: Run typecheck and full frontend test suite**

Run: `npx --prefix frontend tsc --noEmit` e rodar testes do frontend.
Expected: PASS sem erros de tipagem e sem quebras.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx frontend/src/types.ts
git rm frontend/src/tabs/GeneratePage.tsx
git commit -m "refactor(frontend): remove standalone GeneratePage and clean up navigation"
```
