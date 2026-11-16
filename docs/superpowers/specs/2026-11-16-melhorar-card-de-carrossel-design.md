# Design Doc: Melhorar Card de Carrossel e Desempenho (Issue #3)

## Intent & The Why
O card atual de carrossel na Galeria ocupa muito espaço vertical e horizontal devido ao filmstrip completo de todos os slides e à exibição detalhada de todos os metadados textuais (arquétipo, tema, isca). Como consequência, a tela exibe poucos carrosséis por vez, dificultando a navegação, conferência visual e ações em lote.
Além disso, a aba de Desempenho possui uma tabela tradicional, enquanto a necessidade principal do usuário é ter totalizadores claros, gráficos visuais e ver os próprios cards de carrossel ordenados por engajamento (views, curtidas), com as métricas integradas no próprio card.

## Goals
1. **Layout Compacto (3 cards por tela):**
   - No desktop (resoluções `>= 1024px`), a grade `.runs-grid` deve acomodar 3 cards por linha de forma harmônica e responsiva (1 coluna em mobile, 2 em tablets).
2. **Imagens Colapsadas no Card:**
   - Em vez de listar todos os slides lado a lado no card, exibir uma imagem colapsada da capa (slide 1) com indicador visual de pilha/quantidade de slides (ex.: badge com `1 de N slides` ou `+N slides`).
3. **Modais de Visualização e Preview Ampliado:**
   - Clicar nas imagens colapsadas do card abre o `CarouselSlidesModal` exibindo todos os slides renderizados ordenados por posição.
   - Clicar em qualquer slide dentro do modal abre um preview ampliado (lightbox) em alta resolução com navegação (anterior/próximo slide) e botão de fechar.
4. **Hierarquia de Informação Clara:**
   - Elementos primários visíveis no card: Capa colapsada (fotos), Legenda (descrição com truncamento limpo e ver mais/menos) e Ações rápidas (*Enviar Telegram*, *Publicar Buffer*, *Publicado TikTok*).
   - Metadados secundários (*Arquétipo*, *Tema*, *Isca*, *Timestamps*) agrupados em seção colapsável ("Ver detalhes" / accordion) para manter o card limpo e compacto.
5. **Métricas Integradas no Card:**
   - Quando o carrossel possuir métricas registradas (TikTok / post vinculado), exibir badges compactos de métricas (views, likes, comments) no topo ou rodapé do card.
6. **Reformulação da Página de Desempenho:**
   - Manter e aprimorar os totalizadores (KPIs de publicações, views, curtidas, média views/post).
   - Incluir gráfico visual de engajamento (barras comparativas dos carrosséis por visualizações/curtidas).
   - Exibir abaixo dos gráficos os cards de carrossel ordenados pela métrica selecionada (views, curtidas, data, etc.) utilizando o novo formato compacto de 3 colunas, com opção de alternar para visualização tabular.

## Non-Goals & Anti-Goals
- Não alterar endpoints de geração de carrossel ou schema de banco de dados (reutilizar endpoints existentes de `/carousels/runs` e `/tiktok/performance`).
- Não quebrar integrações existentes de envio ao Telegram, publicação via Buffer e registro de métricas manuais no TikTok.
- Não remover a capacidade de editar métricas do TikTok ou despachar carrosséis a partir dos cards.

## Approaches Considered
1. **Carousel em slider horizontal (slick/swiper) dentro do próprio card:**
   - *Desvantagem:* Deixa o card pesado, causa conflito de scroll em telas menores e dificulta a visualização de múltiplos slides simultaneamente.
2. **Imagens colapsadas com abertura de modal em grade + lightbox ampliado (Escolhido):**
   - *Vantagem:* Card ultra compacto e rápido de carregar; 1 clique abre a galeria completa dos slides daquele carrossel; outro clique amplia qualquer slide em lightbox. Atende exatamente ao solicitado na Issue #3.
3. **Manter página de Desempenho apenas com tabela:**
   - *Desvantagem:* Contraria a solicitação do usuário no comentário da issue #3, que pediu totalizadores, gráficos e os próprios cards ordenados na tela de desempenho.

## Key Decisions & Architecture

### 1. Grid Responsivo de 3 Colunas (`frontend/src/index.css`)
```css
.runs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

@media (min-width: 768px) {
  .runs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .runs-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

### 2. Imagens Colapsadas no `RunCard.tsx`
- Se houver slides, exibe a capa (posição 1) em container com aspect ratio elegante (4:5 ou similar), acompanhada de badge indicando o número de slides (`N slides`) e efeito de sobreposição (stack).
- Clicar na imagem dispara `onClick` abrindo o `CarouselSlidesModal`.

### 3. Modais de Visualização:
- `CarouselSlidesModal`:
  - Recebe `isOpen`, `onClose`, `run`, `slides`, `onSelectSlide(index)`.
  - Mostra todos os slides em grade (2 a 4 colunas dependendo da largura).
  - Cada slide possui seu número e botão/clique para abrir o lightbox.
- `SlideLightboxModal`:
  - Recebe `isOpen`, `onClose`, `slides`, `activeIndex`, `onNavigate(newIndex)`.
  - Exibe a imagem em tamanho grande centralizada com controles de navegação (setas esquerda/direita, teclado Escape/ArrowLeft/ArrowRight) e indicador `Slide X de Y`.

### 4. Hierarquia do Card
- **Topo**: `@conta` + role tag + status badge + métricas rápidas (se houver).
- **Mídia**: Capa colapsada clicável com badge de total de slides.
- **Legenda**: Texto truncado a 2 linhas com toggle "Ver legenda completa".
- **Detalhes colapsáveis**: Botão discreto `Detalhes (Arquétipo, Tema, Isca)` que expande apenas sob demanda.
- **Rodapé de Ações**: Botões de ação alinhados e compactos (`Enviar Telegram`, `Publicar Buffer`, `Publicado TikTok`).

### 5. Aba de Desempenho (`PerformancePage.tsx`)
- Topo: Header com sincronização TikTok e filtros de ordenação.
- KPIs aprimorados: Cards modernos com ícones e métricas totais.
- Gráfico de Desempenho (`PerformanceChart.tsx`): Gráfico de barras SVG responsivo exibindo os top carrosséis por views/curtidas.
- Visualização de Cards Ordenados:
  - Renderiza a lista de `items` como cards ordenados usando `.runs-grid`.
  - Cada card exibe as métricas de engajamento (Views, Curtidas, Comentários, Compartilhamentos), a capa colapsada com modal de slides e o botão para editar métricas.
  - Alternador de visualização: Botões `[ Cards | Tabela ]` para alternar entre a grade de cards ou a tabela analítica detalhada.
