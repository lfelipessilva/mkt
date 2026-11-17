# Carrossel único + tracking automático do Zernio — Design

## Intenção

Eliminar a colisão de pastas que faz carrosséis diferentes compartilharem as mesmas imagens no Silo e fazer o ciclo do Zernio ser automático de ponta a ponta: publicar, refletir o status publicado, puxar métricas diariamente e mostrar o ID do post do Zernio na tela de desempenho. O operador não deve precisar marcar um post como publicado no TikTok quando ele já foi publicado pelo Zernio.

## Por que agora

Evidências do banco de produção em 2026-11-16:

- 14 runs apontam para 4 pastas. `output/2026-11-16/camila.e.thiago.ap/post_01` é usado por 4 runs, todos com os mesmos `slide_1..6.jpg`.
- `getOutputDir()` usa `/tmp/listo-carousels` em produção; o container não tem volume para `/tmp`, então cada deploy/restart reinicia a numeração em `post_01`.
- `/tiktok/sync` é um stub (`posts_updated = 0`) e `ZernioPublisherAdapter.getPostMetrics()` retorna `null`.
- O ID do Zernio já é salvo em `tiktok_posts.external_post_id`, mas não é retornado por `/tiktok/performance` nem exibido no frontend.
- `GET https://zernio.com/api/v1/analytics?postId=<id>` retorna views, likes, comments, shares e `lastUpdated` reais.
- `dispatchCarouselRun` sempre grava o run como `dispatched`; quando o Zernio devolve `published`, o run nunca vira `published` e o card continua oferecendo "Publicado TikTok" manual.

## Objetivos

1. Todo carrossel gerado tem caminho único no Silo, independente de deploy, restart ou geração concorrente.
2. Um post publicado pelo Zernio aparece automaticamente como publicado no painel, sem ação manual.
3. Métricas de views, likes, comments e shares são puxadas do Zernio diariamente e no botão de sincronizar.
4. O ID do post no Zernio fica visível na tela de desempenho e nos detalhes do card.
5. "Publicar no Zernio" é a ação principal do card; Telegram é fallback quando o Zernio falha ou quando a conta não está vinculada.
6. Edição manual de métricas não rebaixa um post do Zernio para "manual".

## Não-objetivos

- Reprocessar ou apagar runs antigos que já compartilham caminho no Silo. Eles ficam como estão.
- Alterar o agendador, janelas de postagem, aprovação por Telegram ou o fluxo Buffer legado.
- Implementar publicação de vídeo.
- Criar backfill histórico de métricas anteriores à primeira sincronização.

## Anti-objetivos

- Publicar sem faixa comercial do TikTok.
- Gravar `0` em métricas quando o Zernio ainda não sincronizou o post.
- Manter dois botões concorrentes de "publicar" no mesmo card.

## Restrições

- `ZernioPublisherAdapter` continua sendo o único provider real; `postforme` segue stub.
- O contrato `SocialPublisherProvider` e os testes existentes de dispatch/polling devem continuar válidos.
- O endpoint `POST /api/v1/tiktok/sync` precisa manter o formato de resposta esperado pelo frontend (`ok`, `posts_updated`, `skipped_manual`, `sync_run_id`).
- Datas de pasta continuam em UTC, como `dayStamp` faz hoje.

## Abordagens consideradas

### Duplicidade

1. **Pasta única por run (escolhida).** Um identificador único entra no nome da pasta no início da geração. Não depende de listar o disco, funciona após restart e em execuções concorrentes. A ordenação visual já é por `created_at`.
2. **Numeração via banco + lock.** Preserva `post_01/post_02`, mas exige consultar o máximo no banco, advisory lock e migração dos caminhos antigos. Mais peças para o mesmo resultado.
3. **Só bloquear clique repetido.** Não resolve a causa: deploy/restart continua zerando a numeração.

### Tracking

1. **Completo via `/v1/analytics` (escolhido).** Implementa métricas no adapter, sincronização real e exposição de ID/status. É a menor ponte entre o que já existe no banco e a API do Zernio.
2. **Só métricas.** Atende a coleta diária, mas mantém o operador sem o ID e sem entender por que o card não reflete o Zernio.
3. **Só exibir o ID.** Não atende a coleta diária.

## Desenho

### 0. Decisões de estado e hierarquia das ações

O card segue esta ordem estrita, da mais forte para a mais fraca:

1. **Post publicado** (`tiktok_post.publish_status = 'published'` ou `run.status = 'published'`) → botão "Publicado" desabilitado, link "Ver no TikTok" quando houver URL, sem "Publicado TikTok" manual. Um post `queued/processing` nunca reabilita o botão: permanece "Enviado ao Zernio" desabilitado para impedir publicação duplicada.
2. **Enviado e ainda processando** (`queued`, `processing`, ou `buffer_dispatched_at` sem falha) → "Enviado ao Zernio" desabilitado.
3. **Falhou no Zernio** (`publish_status = 'failed'` ou `run.status = 'failed'` sem publicado) → "Reenviar ao Zernio" habilitado + Telegram visível como fallback.
4. **Aguardando aprovação** → "Confirmar envio".
5. **Vinculada e ainda não enviada** → "Publicar no Zernio" (ação principal).
6. **Sem conta vinculada** → Zernio invisível; Telegram e "Publicado TikTok" manual continuam disponíveis.

O Telegram fica oculto sempre que o Zernio pode publicar. Ele só aparece quando a conta não tem vínculo ou quando o Zernio falhou. Falha de publicação no Zernio marca `carousel_runs.status = 'failed'` e grava `error_message`, para o filtro "Com Falha" e para o estado de reenvio.

Os cards de desempenho recebem o mesmo `tiktok_post` no run sintetizado, então a mesma ordem vale na aba Desempenho. A URL "Ver no TikTok" vem de `platformPostUrl` do analytics do Zernio e é persistida em `tiktok_posts.video_url` na sincronização diária (sem migração).

### 1. Caminho único por geração

Em `backend/src/domain/runs/generate.ts`:

- No início de `generateOneCarousel`, gerar `generationId = crypto.randomUUID().slice(0, 8)`.
- Montar a pasta como `output/<YYYY-MM-DD>/<account>/post_<HHmmss>_<generationId>` (hora UTC, para manter a pasta do dia coerente com `dayStamp`).
- Remover o uso de `nextPostIndex` no fluxo. A função pode continuar exportada se algum teste depende dela, mas deixa de decidir o caminho.
- Não há migração de banco. Runs antigos seguem apontando para os caminhos antigos.

Resultado: duas gerações, mesmo após apagar `/tmp`, nunca escolhem a mesma pasta. O Silo também recebe prefixos distintos.

### 2. Status publicado automático

Em `backend/src/domain/dispatch/service.ts`:

- Depois de gravar `tiktok_posts`, se `publishRes.status === "published"`, atualizar o run para `published`; senão manter `dispatched`.
- Quando o provider devolver `processing`/`queued`, o polling continua responsável pela transição.

Em `backend/src/domain/social/polling.ts`:

- No início de cada execução, reconciliar runs já publicados:
  `tiktok_posts.publish_status = 'published'` e `carousel_runs.status != 'published'` passam o run para `published`. Isso conserta automaticamente os posts já publicados que hoje aparecem como "despachado".
- Ampliar a janela de polling de `created_at >= NOW() - INTERVAL '24 hours'` para 7 dias, para posts que demoram a ser processados pelo Zernio.
- `mapStatus`: `partial` conta como `published` (só há TikTok neste fluxo); `draft`, `scheduled` e `publishing` continuam `processing`.

### 3. Métricas reais

Em `backend/src/domain/social/providers/zernio.ts`:

- Adicionar `analytics.getAnalytics` à interface `ZernioSdk`.
- `getPostMetrics(externalPostId)` chama `GET /v1/analytics?postId=<externalPostId>` e mapeia:
  - `analytics.views` → `views`
  - `analytics.likes` → `likes`
  - `analytics.comments` → `comments`
  - `analytics.shares` → `shares`
  - `analytics.lastUpdated` → `collectedAt` (fallback: agora)
- Retornar `null` quando não houver `analytics`, quando `syncStatus` for `pending`/`unavailable`, ou quando não houver `lastUpdated` e todos os números forem zero. Assim o sync nunca zera métricas boas por uma coleta incompleta.

Em `backend/src/domain/social/metricsSync.ts`:

- Selecionar apenas `provider = 'zernio'`, `external_post_id IS NOT NULL`, `publish_status = 'published'`, `published_at` nos últimos 30 dias.
- Manter o snapshot em `tiktok_metrics` e o log em `tiktok_sync_runs`.

Em `backend/src/domain/tiktok/store.ts` / `routes.ts`:

- `POST /api/v1/tiktok/sync` passa a executar `syncTikTokMetricsDailyJob` em vez do stub.
- Resposta no formato atual: `ok`, `status`, `posts_updated`, `skipped_manual` (contagem de posts manuais, mantida para compatibilidade), `sync_run_id` e `errors`.
- `GET /tiktok/sync/latest` continua igual.

### 4. Expor ID do Zernio e status

Backend:

- `listTikTokPerformance` passa a selecionar `tp.provider`, `tp.external_post_id`, `tp.publish_status` e `tp.last_polled_at`.
- `mapPerformanceRow` e `mapTikTokPostRow` incluem esses campos.
- `getTikTokPostByRunId` também devolve os campos.
- `CarouselRun` ganha `tiktok_post?: { provider, external_post_id, publish_status, published_at, last_polled_at } | null`, preenchido por `getCarouselRun` e `listCarouselRuns` com um `LEFT JOIN tiktok_posts`. É o que permite o card saber que o post é do Zernio e já está publicado.

Frontend:

- `TikTokPost`, `TikTokPerformanceItem` e `CarouselRun` ganham os campos acima.
- Tela de desempenho: coluna/badge "Zernio" com o `external_post_id` (copiável) e o `publish_status`; os cards de desempenho mostram o ID em "Ver detalhes".
- Modal de métricas manuais: quando `provider = 'zernio'`, mostrar o ID do Zernio e o status como somente leitura e enviar `tracking_mode` preservado (`api`).
- No backend, `upsertTikTokPost` não rebaixa para `manual` um post que tem `provider = 'zernio'` e `external_post_id` preenchido; o `tracking_mode` existente é mantido.

### 5. Ações do card

`resolveBufferPublishState` passa a considerar `run.tiktok_post`:

| Situação | Ação principal | Ações secundárias |
|---|---|---|
| Sem conta Zernio vinculada | Telegram | "Publicado TikTok" manual |
| Vinculada, não publicada | **Publicar no Zernio** | Telegram |
| Publicada pelo Zernio | "Publicado" (desabilitado, com link "Ver no TikTok" quando houver URL) | Nenhuma; esconde "Publicado TikTok" manual |
| Falha no Zernio | **Reenviar ao Zernio** | Telegram |

- "Publicado TikTok" manual só aparece quando não há `tiktok_post` do Zernio publicado (runs legados ou contas sem vínculo).
- Telegram deixa de ser botão de mesma hierarquia quando o Zernio já publicou; fica visível apenas como fallback em falha ou em conta sem vínculo.
- O toast de sucesso deixa de dizer "Carrossel enviado ao Zernio" quando o status já é `published`; passa a "Publicado no TikTok via Zernio".

## Riscos

- `partial` como publicado pode mascarar falha de outra plataforma. Neste fluxo só existe TikTok, então o risco é aceitável.
- Adicionar `tiktok_post` ao `CarouselRun` aumenta o payload; é um objeto pequeno por run.
- O sync manual passa a fazer uma chamada por post. Com o volume atual (poucos posts por dia) é aceitável; o endpoint de delta do Zernio fica como otimização futura.

## Testes

- `generate.test.ts`: duas gerações seguidas, com a pasta base apagada entre elas, produzem `output_dir` diferentes e não compartilham `storage_path`.
- `dispatch/social-dispatch.test.ts`: provider devolve `published` → run vira `published`; provider devolve `processing` → run fica `dispatched`.
- `polling` test: post já publicado reconcilia run `dispatched` para `published`; post `partial` vira publicado.
- `zernio` adapter test: `getPostMetrics` mapeia views/likes/comments/shares e retorna `null` quando `syncStatus` é `pending` ou não há `analytics`.
- `metricsSync` test: seleciona só provider `zernio`, atualiza `tiktok_posts` e grava snapshot; post `pending` é ignorado.
- `tiktok` routes/store test: performance retorna `provider`, `external_post_id`, `publish_status`.
- `RunCard` test: run publicado pelo Zernio não mostra "Publicado TikTok"; run sem vínculo mostra Telegram e manual.
- `ManualTikTokModal`/`upsertTikTokPost` test: editar um post Zernio mantém `tracking_mode = 'api'`.
