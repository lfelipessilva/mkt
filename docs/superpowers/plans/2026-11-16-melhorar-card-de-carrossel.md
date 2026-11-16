# Melhorar Card de Carrossel e Desempenho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o card de carrossel para ser compacto, caber 3 por tela no desktop, colapsar imagens com modal de slides e lightbox ampliado, priorizar visualmente fotos/legenda/ações, e reformular a tela de desempenho com gráficos, totalizadores e cards ordenados por engajamento.

**Architecture:** 
1. Componentes modais dedicados: `CarouselSlidesModal` para exibir a grade de todos os slides e `SlideLightboxModal` para visualização ampliada com navegação.
2. `RunCard`: Imagens colapsadas na capa com badge de quantidade de slides e trigger para o modal; metadados secundários (arquétipo, tema, isca) agrupados em gaveta/accordion de detalhes; suporte à exibição de métricas quando fornecidas.
3. CSS: `.runs-grid` com media queries para 3 colunas em telas `>= 1024px` e estilização compacta dos cards.
4. `PerformancePage`: KPIs modernos, gráfico visual SVG de barras de engajamento, e renderização dos carrosséis ordenados em cards compactos com alternador para tabela.

**Tech Stack:** React 19, TypeScript, Lucide Icons, Vite, CSS moderno, Node.js test runner (`node:test`, `node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-11-16-melhorar-card-de-carrossel-design.md`

---

### Task 1: Componentes de Modal de Slides e Lightbox (`CarouselSlidesModal` e `SlideLightboxModal`)

**Files:**
- Create: `frontend/src/components/CarouselSlidesModal.tsx`
- Create: `frontend/src/components/SlideLightboxModal.tsx`
- Create: `frontend/src/slides-modal.test.ts`

- [ ] **Step 1: Escrever testes unitários em `frontend/src/slides-modal.test.ts` testando ordenação de slides, índices e regras de navegação**
- [ ] **Step 2: Executar teste para verificar falha inicial**
- [ ] **Step 3: Implementar `SlideLightboxModal.tsx` com navegação (próximo/anterior/escape) e exibição em alta resolução via `AuthImage`**
- [ ] **Step 4: Implementar `CarouselSlidesModal.tsx` exibindo a grade de slides, numeração, identificador de capa e acionamento do lightbox**
- [ ] **Step 5: Executar testes de unidade e verificar aprovação**

---

### Task 2: Refatoração do `RunCard.tsx` com imagens colapsadas e hierarquia priorizada

**Files:**
- Modify: `frontend/src/components/RunCard.tsx`
- Create: `frontend/src/run-card-compact.test.ts`
- Modify: `frontend/src/types.ts` (se necessário para métricas opcionais no card)

- [ ] **Step 1: Escrever testes unitários em `frontend/src/run-card-compact.test.ts` verificando a capa colapsada, badge de slides, exibição de métricas quando presentes e toggle de detalhes**
- [ ] **Step 2: Executar testes e verificar falhas esperadas**
- [ ] **Step 3: Refatorar `RunCard.tsx`:**
  - Substituir filmstrip aberto por capa colapsada clicável com badge de total de slides e stack visual.
  - Integrar abertura do `CarouselSlidesModal` e `SlideLightboxModal`.
  - Adicionar suporte a `metrics` opcionais (`views`, `likes`, `comments`, `shares`).
  - Agrupar arquétipo, tema e isca em accordion/detalhes colapsáveis.
  - Manter botões de ação rápidos: Enviar Telegram, Publicar Buffer, Publicado TikTok.
- [ ] **Step 4: Executar testes e verificar aprovação**

---

### Task 3: Estilização CSS para Grid de 3 Colunas e Cards Compactos

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Atualizar `.runs-grid` com suporte responsivo para 3 colunas em telas `>= 1024px`**
- [ ] **Step 2: Estilizar a capa colapsada com visual stacked/card-stack e badge de contagem de slides**
- [ ] **Step 3: Estilizar a gaveta/accordion de metadados secundários e chips de métricas integrados no card**
- [ ] **Step 4: Estilizar os modais de grade de slides (`.slides-grid-modal`) e lightbox ampliado (`.slide-lightbox-modal`)**

---

### Task 4: Atualização da `GalleryPage.tsx` com o novo card compacto

**Files:**
- Modify: `frontend/src/tabs/GalleryPage.tsx`
- Modify: `frontend/src/gallery-performance.test.ts`

- [ ] **Step 1: Verificar e ajustar integração de `RunCard` na `GalleryPage.tsx`**
- [ ] **Step 2: Executar testes da galeria existentes e garantir que nenhuma funcionalidade foi quebrada**

---

### Task 5: Reformulação da Página de Desempenho com Gráfico, Totalizadores e Cards Ordenados

**Files:**
- Create: `frontend/src/components/PerformanceChart.tsx`
- Modify: `frontend/src/tabs/PerformancePage.tsx`
- Create: `frontend/src/performance-chart.test.ts`
- Modify: `frontend/src/gallery-performance.test.ts`

- [ ] **Step 1: Escrever testes unitários em `frontend/src/performance-chart.test.ts` para cálculo de dados do gráfico (top posts, percentuais, labels)**
- [ ] **Step 2: Implementar `PerformanceChart.tsx` (gráfico SVG puro responsivo de engajamento)**
- [ ] **Step 3: Refatorar `PerformancePage.tsx`:**
  - Adicionar gráfico de engajamento após os KPIs.
  - Adicionar alternador de visualização: Cards Ordenados vs Tabela.
  - Na visualização em cards, renderizar os cards usando o layout compacto de 3 colunas, exibindo métricas de engajamento, capa colapsada e botão de editar métricas TikTok.
- [ ] **Step 4: Executar testes de desempenho e verificar aprovação**

---

### Task 6: Verificação de Build e Testes Globais

- [ ] **Step 1: Rodar toda a suíte de testes do frontend: `npm --prefix frontend test`**
- [ ] **Step 2: Rodar build de produção do frontend: `npm --prefix frontend run build`**
- [ ] **Step 3: Validar que todos os cenários da Issue #3 foram cobertos com evidências nos testes**
