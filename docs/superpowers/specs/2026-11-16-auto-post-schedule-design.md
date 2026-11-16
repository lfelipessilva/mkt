# Rotina Automática de Posts por Conta + Publicação no Buffer — Design Técnico

**Data:** 2026-11-16  
**Autores:** Luis Felipe & AI  
**Status:** Proposto (aguardando aprovação do parceiro)  
**Escopo:** backend + frontend + migration

---

## 1. Intent & Context

Hoje a plataforma gera carrosséis em um cron fixo (`0 7,11,17`) e, quando `auto_dispatch_enabled` está ligado, chama `generateBatch`, que percorre **todas as contas habilitadas de uma vez**. A publicação no Buffer já existe no backend (`dispatchCarouselRun` com `channel=buffer`), mas não há botão na galeria e a rotina automática não publica em lugar nenhum.

O pedido tem duas partes:

1. **Botão manual "Publicar no Buffer"** em cada carrossel cuja conta esteja vinculada ao Buffer.
2. **Rotina automática nova**: cada conta ativa faz **3 posts por dia**, um em cada janela — **7h–9h, 11h30–12h30, 18h–20h** — em horário sorteado, **uma conta por vez**: gera o carrossel e publica na sequência. Contas vinculadas ao Buffer publicam no Buffer; contas sem vínculo publicam pelo Telegram.

O objetivo é que o TikTok poste sozinho, em horários humanos e espalhados, sem um bloco de contas disparando junto.

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### Goals

1. Botão "Publicar no Buffer" no card da galeria, visível apenas para conta vinculada, chamando `POST /api/v1/carousels/runs/:id/send?channel=buffer`.
2. Plano diário persistido com 1 slot por conta por janela (3 por dia por conta).
3. Horários sorteados dentro de cada janela, com distribuição que evita concentração (fatias iguais).
4. Execução serializada: no máximo 1 slot rodando por vez; gerar → publicar → liberar o próximo.
5. Resolver o canal na hora da execução: `external_account_id` presente → Buffer; ausente → Telegram.
6. Sobreviver a restart/deploy sem duplicar post, sem repostar slot de outro dia e sem perder o plano do dia.
7. Painel somente-leitura em Integrações com a agenda do dia e o status de cada slot.
8. Manter os botões e endpoints manuais existentes (gerar, enviar Telegram, publicar manual no TikTok).

### Non-Goals

- Editar a agenda pela UI (janelas, horários ou quantidade de posts).
- Backfill de janelas perdidas por downtime.
- Agendamento `dueAt` no Buffer; a rotina dispara no horário e publica com `shareNow`.
- Suporte a Post for Me nesta fase (o desenho deixa o ponto de extensão, mas o adapter continua stub).
- Vídeo/transcodificação.
- Múltiplas instâncias de backend coordenando a agenda (ver Constraints).

### Anti-Objetivos

- Rodar todas as contas no mesmo tick/cron.
- Fazer fallback automático de Buffer para Telegram quando o Buffer falhar (muda o canal de publicação sem o usuário pedir).
- Repostar slots atrasados depois de uma queda (conteúdo velho).
- Guardar a agenda apenas em memória.
- Gerar um carrossel novo em retry quando o carrossel anterior já existe (duplicaria mídia e post).

---

## 3. Constraints

- **Processo único:** o backend roda como um processo PM2. O lock de job atual (`withJobLock`) é em memória. A agenda usa claim no Postgres (`FOR UPDATE SKIP LOCKED`) para o slot, mas não há coordenação multi-instância; isso é assumido.
- **Buffer Free:** até 3 canais TikTok e fila de 10 posts agendados. Como usamos `shareNow`, a fila de agendados não é o caminho principal; o polling de status e as métricas existentes continuam valendo.
- **Fuso:** `America/Sao_Paulo` por padrão (`AUTOMATION_TZ` > `TZ` > default). O servidor pode estar em UTC; toda conta de data/hora local passa por um helper de timezone.
- **Pipeline existente:** Gemini, Sharp, Silo/MinIO e `carousel_runs`/`carousel_slides` não mudam.
- **Horário é alvo, não garantia:** a execução é serializada; se uma geração demorar, o próximo slot pode começar alguns minutos depois do horário sorteado.
- **Sem backfill:** janela encerrada = slot `skipped`.

---

## 4. Abordagens Consideradas & Decisão

### A — Plano diário persistido + ticker de minuto (escolhida)

Na virada do dia (ou no primeiro tick do dia), o planner sorteia um horário por conta por janela e grava em `auto_post_slots`. Um ticker de minuto pega o slot pendente mais antigo já vencido e executa um por vez.

- **Ganha:** restart-safe, idempotente, observável, retry simples, agenda visível na UI.
- **Custa:** uma tabela e uma migration.

### B — Sorteio determinístico sem tabela

O horário é derivado de hash `data + conta + janela`; a deduplicação olha runs/eventos existentes.

- **Ganha:** zero migration.
- **Custa:** agenda invisível antes de acontecer; dedupe frágil quando conta/janela mudam; retry e auditoria ruins.

### C — Timers em memória

`setTimeout` por conta ao subir.

- **Ganha:** mais simples de escrever.
- **Custa:** restart/deploy perde a agenda e pode duplicar ou não postar. Descartada.

**Decisão do parceiro:** A.

---

## 5. Design

### 5.1 Janelas, fuso e sorteio

Arquivo novo: `backend/src/domain/automation/windows.ts`.

```ts
export interface PostWindow {
  id: string;          // "morning" | "midday" | "evening"
  start: string;       // "07:00"
  end: string;         // "09:00"
}

export const DEFAULT_WINDOWS: PostWindow[] = [
  { id: "morning", start: "07:00", end: "09:00" },
  { id: "midday",  start: "11:30", end: "12:30" },
  { id: "evening", start: "18:00", end: "20:00" },
];
```

- Override opcional por `AUTO_POST_WINDOWS` (JSON com o mesmo formato), útil para operação/teste.
- Fuso: `AUTOMATION_TZ || process.env.TZ || "America/Sao_Paulo"`.
- Helpers em `backend/src/domain/automation/time.ts`:
  - `localDateString(date, timeZone): string` → `YYYY-MM-DD`.
  - `zonedTimeToUtc(localDate, "HH:mm", timeZone): Date` (converte com o offset do fuso; itera uma vez para cobrir DST).
  - `addLocalDays(localDate, n): string`.
- O planner arredonda o horário sorteado para baixo no minuto.

**Algoritmo de distribuição (fatias iguais):**

Para cada janela e para as contas que ainda não têm slot naquele dia/janela:

1. `availableStart = max(windowStart, now + 5min)`; `availableEnd = windowEnd`.
2. Se `availableEnd - availableStart < 5min`, cria os slots como `skipped` com `last_error = 'janela sem tempo hábil'` e segue.
3. Embaralha as contas (Fisher–Yates com `crypto.randomInt`).
4. `segment = (availableEnd - availableStart) / N`.
5. Para a i-ésima conta: `scheduledAt = availableStart + i*segment + random(0..segment)`, limitado a `availableEnd - 1min`, arredondado para baixo no minuto.
6. Insere com `ON CONFLICT (slot_date, window_id, account_id) DO NOTHING`.

Exemplo com 3 contas na janela 7h–9h: fatias de 40 min → algo como 7:17, 8:12, 8:34. Na janela 11h30–12h30: fatias de 20 min. Não há espaçamento mínimo rígido; a serialização da execução garante que não rodem juntas.

### 5.2 Modelo de dados — migration `004_auto_post_schedule.sql`

```sql
CREATE TABLE auto_post_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date     DATE NOT NULL,
  window_id     TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('buffer', 'telegram', 'social')),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts      INT NOT NULL DEFAULT 0,
  run_id        UUID REFERENCES carousel_runs(id) ON DELETE SET NULL,
  last_error    TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_date, window_id, account_id)
);

CREATE INDEX idx_auto_post_slots_due
  ON auto_post_slots (status, scheduled_at);

CREATE INDEX idx_auto_post_slots_date
  ON auto_post_slots (slot_date, scheduled_at);
```

- `channel` é o canal **planejado** no momento da criação; o executor re-resolve o vínculo e atualiza a coluna se o vínculo mudou.
- `social` fica reservado para providers futuros (Post for Me). Nesta fase, slots com esse canal são pulados com erro claro, não enviados pelo Telegram.
- `run_id` permite retry sem gerar outro carrossel.
- `window_end` permite expirar slots sem depender da configuração atual de janelas.

### 5.3 Planner

Arquivo novo: `backend/src/domain/automation/planner.ts`.

`ensureDailyPlan(options)` roda a cada tick, antes de procurar slot:

1. Se a rotina está desligada (`auto_dispatch_enabled = false`), não cria slots novos. Slots futuros já existentes permanecem `pending`; slots de janelas encerradas são expirados pela regra 2. Ao religar no mesmo dia, o plano continua válido e os slots futuros voltam a executar.
2. Expira slots vencidos: `pending` com `window_end < now` ou `slot_date < today` → `skipped` (`last_error = 'janela encerrada'`). Isso vale mesmo com a rotina desligada, para não sobrar backlog.
3. Para cada janela cujo `windowEnd > now`:
   - Busca contas `enabled = true` que ainda não têm slot em `(slot_date, window_id)`.
   - Aplica o algoritmo de fatias e insere.
4. Contas desabilitadas: não recebem slots novos. Slots futuros já existentes continuam `pending`; o executor decide na hora: se a conta ainda estiver desabilitada, marca `skipped`; se tiver sido reabilitada antes do horário, executa.
5. Contas novas no meio do dia: entram apenas nas janelas que ainda não terminaram; a fatia usa o tempo restante.

**Por que assim:** ligar/desligar a rotina ou uma conta não “queima” as janelas futuras do dia. Não há ressuscitação de slot já pulado por janela encerrada; o que passou, passou.

Chamadas:

- `startCron()` executa `runAutomationTick()` uma vez no boot e agenda o ticker de minuto.
- O endpoint de agenda é **somente-leitura** e não cria plano.

### 5.4 Ticker e executor

Arquivo novo: `backend/src/domain/automation/ticker.ts`.

`runAutomationTick(options)`:

1. Se `auto_dispatch_enabled = false` → `ensureDailyPlan` (só para expirar janelas vencidas) e retorna `{ ran: false }`.
2. Se `getJobStatus().busy` → retorna `{ ran: false, reason: 'busy' }`.
3. Recupera slots `running` com `started_at < now - 15min` → `failed` (`last_error = 'execução travada'`). No boot, qualquer `running` é marcado `failed` (`last_error = 'processo reiniciou durante a execução'`) para não duplicar.
4. `withJobLock`:
   - `ensureDailyPlan`.
   - Claim atômico do próximo slot:
     ```sql
     UPDATE auto_post_slots
     SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM auto_post_slots
       WHERE status = 'pending' AND scheduled_at <= now() AND slot_date = $1
       ORDER BY scheduled_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *;
     ```
   - Se não houver slot, retorna.
   - Executa **um** slot e retorna. O próximo só entra no tick seguinte (1 min depois), garantindo “uma conta por vez”.
5. Flag de módulo `tickerBusy` evita reentrada se um tick demorar mais de 1 minuto.

**Execução de um slot** (`executeSlot`):

1. Carrega a conta. Se não existir ou `enabled = false` → `skipped` (`last_error = 'conta desativada'`).
2. Resolve o canal:
   - `external_account_id` preenchido e provider `buffer`/nulo/vazio → `buffer`.
   - `external_account_id` preenchido e provider `postforme` → `social` (reservado; nesta fase o executor marca `skipped` com `last_error = 'provider não suportado nesta fase'` e **não** envia pelo Telegram).
   - Sem `external_account_id` → `telegram`.
   - Atualiza `auto_post_slots.channel` com o canal resolvido.
3. Se `slot.run_id` existe:
   - Carrega o run.
   - Se já existe `dispatch_events` com status `sent` **para o canal resolvido** → marca slot `done` (proteção contra duplicar após crash).
   - Se o run está `published` (publicação manual ou por outro canal) e não há evento `sent` no canal resolvido → `skipped` (`last_error = 'carrossel já publicado'`), para não duplicar.
   - Se o run tem slides e não está `published` → reutiliza (não gera de novo), mesmo que já tenha sido despachado em outro canal (ex.: Telegram para revisão).
4. Se não há run reutilizável: `generateOneCarousel({ accountId, pool })`. Atualiza `slot.run_id`.
5. `dispatchCarouselRun({ runId, channel, triggeredBy: 'auto_schedule', pool })`.
6. Sucesso (dispatch aceito pelo canal) → `status = 'done'`, `finished_at = now()`, `last_error = null`. `done` significa **entregue ao canal**, não “publicado no TikTok”; o desfecho real é lido de `carousel_runs`/`tiktok_posts` na agenda.
7. Erro → retry:
   - `MAX_ATTEMPTS = 2`.
   - `RETRY_DELAY = 5min`.
   - Se `attempts < 2` e `now + 5min < window_end`: `status = 'pending'`, `scheduled_at = now + 5min`, `last_error = mensagem`.
   - Senão `status = 'failed'`, `last_error = mensagem`, `finished_at = now()`.
   - Se a geração falhou, não há run; o carrossel não aparece na galeria. Se a publicação falhou, o run fica `generated` na galeria para publicação manual.
   - Falha do Buffer **não** cai para Telegram automaticamente.
   - Se `dispatchCarouselRun` detectar que o provider retornou `failed` (sem lançar), isso conta como erro de dispatch e entra no retry (ver 5.5).

Funções de geração e dispatch são injetáveis nas options (`generateFn`, `dispatchFn`) para testes; em produção usam as implementações reais.

### 5.5 Resolução de canal e comportamento de publicação

- **Buffer:** `dispatchCarouselRun` já monta `image_urls` via Silo, chama `publishPost` com `publishMode: 'immediate'` (`shareNow`) e grava/atualiza `tiktok_posts` (`provider = 'buffer'`). O polling existente leva `queued`/`processing` → `published`/`failed`.
- **Correção necessária — resposta `failed` do provider:** `BufferPublisherAdapter.publishPost` pode retornar `{ status: 'failed', errorMessage }` **sem lançar** (ex.: `MutationError`, post ausente na resposta). Hoje `dispatchCarouselRun` trata qualquer retorno como sucesso, marca `dispatch_events` como `sent` e o run como `dispatched`, o que faz um post recusado parecer enviado. O design corrige: quando `publishRes.status === 'failed'`, a função grava/atualiza `tiktok_posts` com `publish_status = 'failed'` (auditoria), deixa o `dispatch_events` como `failed`, **não** muda o run para `dispatched` e lança `AppError`. Com isso o slot entra em retry, o botão manual mostra o erro e `buffer_dispatched_at` só existe para evento `sent` (Buffer aceitou).
- **Telegram:** usa `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. Se faltar configuração, o slot falha com erro claro e passa pelo retry; não invalida a conta.
- **Vínculo alterado no meio do dia:** o executor sempre re-resolve; um slot planejado como Telegram vira Buffer se a conta for vinculada antes de executar, e vice-versa.
- **Provider futuro:** `social_provider = 'postforme'` com `external_account_id` deve usar `channel=social` e o factory existente. Fica como ponto de extensão; nesta fase o adapter é stub.

### 5.6 Toggle e configuração

- Reutiliza a chave existente **`auto_dispatch_enabled`** como liga/desliga da rotina. Não há segunda chave.
- Na UI de Integrações, o card existente muda de texto: “Despacho Automático (Cron)” → “Rotina automática de posts”, explicando 3 posts/conta/dia, janelas, Buffer/Telegram e execução uma por vez.
- Desligar a rotina não apaga o histórico nem queima slots futuros: eles ficam `pending` e voltam a executar quando a rotina for religada. Só slots de janela encerrada viram `skipped`.
- `CRON_SCHEDULE` deixa de ser usado para geração. `AUTOMATION_CRON_SCHEDULE` (default `* * * * *`) controla o ticker. `CRON_SCHEDULE` fica documentado como obsoleto.

### 5.7 Mudanças no cron

`backend/src/cron.ts`:

- Remove `batchTask`/`runCronTick` baseados em `CRON_SCHEDULE` e `generateBatch`.
- Adiciona `automationTask = cron.schedule(AUTOMATION_CRON_SCHEDULE, runAutomationTick, { timezone })`.
- Mantém `pollingTask` (`*/2 * * * *`) e `metricsTask` (`0 4 * * *`) como estão.
- `RunningCronTasks` passa a expor `automationTask`, `pollingTask`, `metricsTask`, `stop`.

O bot do Telegram continua usando `generateBatch` para `/gerar` e `/mais`; isso é independente da rotina automática.

### 5.8 Read model, API e tipos

**Read model de `CarouselRun`:** adicionar `buffer_dispatched_at`.

Em `backend/src/domain/runs/store.ts`, tanto `getCarouselRun` quanto `listCarouselRuns` passam a trazer:

```sql
(
  SELECT de.sent_at
  FROM dispatch_events de
  WHERE de.run_id = carousel_runs.id
    AND de.channel IN ('buffer', 'social')
    AND de.status = 'sent'
  ORDER BY de.sent_at DESC NULLS LAST
  LIMIT 1
) AS buffer_dispatched_at
```

- `CarouselRunSchema` ganha `buffer_dispatched_at: z.coerce.date().nullable().optional()`.
- `frontend/src/types.ts` ganha `buffer_dispatched_at?: string | null`.
- Isso permite o card saber se o run já foi enviado ao Buffer, independentemente de ter passado pelo Telegram antes.

**API nova:** `GET /api/v1/automation/schedule?date=YYYY-MM-DD` (default: hoje no fuso).

```json
{
  "date": "2026-11-16",
  "timezone": "America/Sao_Paulo",
  "enabled": true,
  "slots": [
    {
      "id": "uuid",
      "window_id": "morning",
      "account_id": "gabriel",
      "account_display_name": "Gabriel",
      "account_enabled": true,
      "channel": "buffer",
      "scheduled_at": "2026-11-16T10:17:00.000Z",
      "window_end": "2026-11-16T12:00:00.000Z",
      "status": "pending",
      "attempts": 0,
      "run_id": null,
      "run_status": null,
      "post_status": null,
      "last_error": null
    }
  ]
}
```

- `run_status` vem de `carousel_runs.status`; `post_status` vem de `tiktok_posts.publish_status` (só existe para Buffer). A agenda mostra as duas camadas: **execução** (status do slot) e **publicação** (desfecho real no TikTok/Buffer). Assim um slot `done` com post `failed` aparece como “Enviado” na execução e “Falhou” na publicação.
- `account_enabled` permite sinalizar na UI slots de conta desativada.
- Rota registrada em `app.ts` sob `/api/v1/automation`.
- Se `date` inválido → 400 `validation_error`.
- Endpoint somente-leitura; não cria plano.

**API do botão:** `dispatchCarouselRun` no front passa a aceitar `"buffer"` e `"social"` além de `"telegram" | "api"`.

### 5.9 Frontend

#### 5.9.1 Botão "Publicar no Buffer" (galeria)

- `GalleryPage` monta um mapa `accountsById` a partir do contexto e passa `account` para `RunCard`.
- `RunCard` ganha a prop `account?: Account | null`.
- Função pura nova em `frontend/src/components/RunCard.tsx` (exportada para teste):

```ts
export function resolveBufferPublishState(
  account: Account | null | undefined,
  run: CarouselRun
): { visible: boolean; disabled: boolean; label: string }
```

Regras:

- Conta vinculada = `external_account_id` preenchido e (`social_provider === 'buffer'` ou nulo/vazio).
- Se `run.buffer_dispatched_at` existe e `run.status !== 'failed'` → `visible: true`, `disabled: true`, label `"Enviado ao Buffer"`.
- Se `run.buffer_dispatched_at` existe e `run.status === 'failed'` → `visible: true`, `disabled: false`, label `"Reenviar ao Buffer"`.
- Se não existe `buffer_dispatched_at` e `run.status === 'published'` → `visible: true`, `disabled: true`, label `"Já publicado"` (evita duplicar uma publicação manual).
- Se não existe `buffer_dispatched_at`, a conta está vinculada e o run não está `published` → `visible: true`, `disabled: false`, label `"Publicar no Buffer"`. Isso inclui runs já despachados só para o Telegram, que servem de revisão antes da publicação.
- Caso contrário → `visible: false`.

Comportamento:

- Clique → `dispatchCarouselRun(run.id, 'buffer')`.
- Sucesso → atualiza o run com `result.run` (já vem com `buffer_dispatched_at`), toast “Carrossel enviado ao Buffer”.
- Erro → alerta no card com a mensagem da API.
- O botão de Telegram continua disponível para revisão antes de publicar no Buffer.
- Um badge discreto “Buffer” aparece no cabeçalho do card quando a conta está vinculada.

#### 5.9.2 Painel "Agenda de hoje" (Integrações)

- `frontend/src/api.ts`: `getAutomationSchedule(date?)`.
- `frontend/src/types.ts`: `AutoPostSlot`, `AutomationSchedule`.
- `IntegrationsPage` adiciona um card de largura total abaixo dos cards existentes:
  - Cabeçalho com data, fuso e estado da rotina (ativo/desativado).
  - Tabela: horário, conta (`display_name` ou `id`), canal (`Buffer`/`Telegram`), status da execução (`Agendado`, `Gerando/Publicando`, `Enviado`, `Falhou`, `Pulado`), desfecho da publicação (`Na fila`, `Publicado`, `Falhou` — lido de `run_status`/`post_status`) e erro (quando houver). Conta desabilitada aparece com aviso visual.
  - Recarrega ao abrir a página, no botão “Recarregar” e a cada 60s enquanto a página estiver montada.
- Helpers puros exportados para teste:
  - `formatScheduleStatus(status: string): string`
  - `formatScheduleChannel(channel: string): string`

#### 5.9.3 Texto do toggle

Atualizar o card para deixar explícito:

> “Quando ativado, a rotina gera 3 carrosséis por conta por dia em horários sorteados (7h–9h, 11h30–12h30, 18h–20h), uma conta por vez, e publica no Buffer (contas vinculadas) ou no Telegram (demais).”

### 5.10 Erros, observabilidade e recuperação

- **Logs:** cada execução loga `[automation] slot=<id> account=<id> channel=<...> status=<...>`; erros com a mensagem original.
- **UI:** status e `last_error` visíveis na agenda; erros do botão aparecem no card.
- **Crash durante execução:** `running` vira `failed` no boot; se o run já foi gerado, ele fica na galeria. Não há repost automático.
- **Crash após dispatch mas antes de marcar `done`:** o retry (se acontecer) checa `dispatch_events` `sent` para o mesmo canal antes de despachar de novo.
- **Buffer fora do ar:** retry uma vez em 5 min; depois `failed`. Sem fallback de canal.
- **Telegram sem configuração:** falha clara no slot; retry uma vez; depois `failed`.
- **Relógio/servidor em UTC:** todos os cálculos de janela usam o helper de fuso; `scheduled_at` é `timestamptz`.

### 5.11 Testes

**Backend (testcontainers, padrão existente):**

1. `planner`: 3 contas na janela 7h–9h → 3 slots, um por conta, horários dentro da janela e cada horário na sua fatia (ordenados: fatia 0, 1, 2).
2. `planner`: idempotência — rodar duas vezes no mesmo dia não duplica slots.
3. `planner`: boot ao meio-dia → janelas passadas não geram slots; janela da noite gera; nenhum `scheduled_at` no passado.
4. `planner`: conta nova no meio do dia → slots só em janelas futuras.
5. `planner`: conta desabilitada → não recebe slots novos; slots futuros existentes ficam `pending` e são pulados na execução se a conta continuar desabilitada; reabilitada antes do horário executa.
6. `planner`: `auto_dispatch_enabled = false` → não cria slots novos, mas slots futuros existentes continuam `pending`; ao religar, executam; slots de janela vencida viram `skipped`.
7. `ticker`: claim de no máximo 1 slot por tick; segundo tick executa o próximo.
8. `ticker`: reentrada concorrente retorna `{ ran: false }`.
9. `ticker`: canal Buffer para conta vinculada; Telegram para conta sem vínculo (com `dispatchFn` fake).
10. `ticker`: retry de geração — primeira falha deixa `pending` com `scheduled_at ≈ now+5`; segunda falha marca `failed`.
11. `ticker`: retry de dispatch reutiliza o mesmo `run_id` e não chama geração de novo.
12. `ticker`: `running` antigo (>15 min) vira `failed`.
13. `runs/store`: `getCarouselRun`/`listCarouselRuns` retornam `buffer_dispatched_at` quando há `dispatch_events` `sent` de Buffer, e `null` quando só há Telegram.
14. `cron`: `startCron` agenda o ticker de minuto e mantém polling/métricas; `CRON_SCHEDULE` não é mais usado para geração.
15. Atualizar `tests/runs/cron-filter.test.ts` para a nova API (sem `runCronTick`).
16. `dispatch`: provider Buffer retorna `status='failed'` sem lançar → `dispatch_events` `failed`, run continua `generated`, `buffer_dispatched_at` nulo, slot entra em retry.
17. `ticker`: run despachado só para Telegram → slot Buffer reenvia ao Buffer; run já `published` (manual/outro canal) sem evento `sent` no canal → slot `skipped`.
18. `automation/routes`: agenda retorna `account_enabled`, `run_status` e `post_status`, com join em `carousel_runs` e `tiktok_posts`.
19. `ticker`: conta `postforme` com `external_account_id` → slot `social` e executor marca `skipped` com erro claro, sem enviar Telegram.

**Frontend (node:test puro, sem DOM):**

1. `resolveBufferPublishState`: conta vinculada + run sem envio → botão visível/habilitado com “Publicar no Buffer”.
2. Conta sem vínculo → invisível.
3. `buffer_dispatched_at` presente → “Enviado ao Buffer” desabilitado.
4. `buffer_dispatched_at` presente + `run.status = 'failed'` → “Reenviar ao Buffer” habilitado.
5. `dispatchCarouselRun(id, 'buffer')` chama `POST /api/v1/carousels/runs/:id/send?channel=buffer`.
6. `getAutomationSchedule` chama `GET /api/v1/automation/schedule` com `date` quando informado.
7. `formatScheduleStatus` e `formatScheduleChannel` mapeiam todos os valores.
8. `resolveBufferPublishState`: `run.status='published'` sem `buffer_dispatched_at` → visível, desabilitado, “Já publicado”.
9. `formatPublicationStatus` (novo helper) mapeia `queued`, `processing`, `published`, `failed` e `null`.

### 5.12 Compatibilidade e rollout

- A migration é aditiva; nenhuma coluna existente muda.
- `CRON_SCHEDULE` deixa de gerar; se estava configurado, a rotina nova assume no próximo boot. O toggle existente controla tudo.
- O primeiro boot com `auto_dispatch_enabled = true` cria o plano do dia. Se o boot for no meio de uma janela, o planner usa o tempo restante; se faltar menos de 5 min, marca a janela como `skipped`.
- O bot, os botões manuais e os endpoints antigos continuam funcionando.
- README atualizado com `AUTOMATION_TZ`, `AUTO_POST_WINDOWS`, `AUTOMATION_CRON_SCHEDULE`, a rotina nova e o botão do Buffer.

---

## 6. Decisões do Parceiro

1. **Escopo das contas:** todas as contas ativas entram na rotina. Vinculadas ao Buffer publicam no Buffer; sem vínculo publicam no Telegram.
2. **Abordagem:** plano diário persistido + ticker de minuto (A).
3. **Contas sem vínculo:** não ficam de fora nem apenas na galeria; vão para o Telegram.

## 7. O que fica para o Builder

- Nomes exatos de arquivos, funções auxiliares e classes CSS, seguindo o padrão do repositório.
- Implementação do helper de timezone sem biblioteca nova (usar `Intl.DateTimeFormat`).
- Escolha entre `crypto.randomInt` e `Math.random` no shuffle (recomendado `crypto.randomInt`).
- SQL exato do read model e dos claims, desde que preserve as garantias descritas.
- Organização dos testes e uso de fakes injetáveis para geração/dispatch.
- Se o painel da agenda deve ter polling de 60s ou apenas recarregar manualmente; o design recomenda 60s.
- Textos finais da UI em português, mantendo o tom do restante do painel.

---

## 8. Chamadas de Engenharia (revisão do builder check)

Estas foram decisões tomadas na revisão técnica; ficam registradas para conferência do parceiro.

1. **Resposta `failed` do Buffer não é sucesso.** `dispatchCarouselRun` passa a falhar quando o provider retorna `status='failed'` sem lançar: evento `failed`, `tiktok_posts` com `publish_status='failed'` para auditoria, run não vira `dispatched`, slot entra em retry. `buffer_dispatched_at` só existe para evento `sent`.
2. **Ligar/desligar rotina ou conta não queima janelas futuras.** Slots futuros continuam `pending`; o executor decide na hora. Só janela encerrada vira `skipped`. Não há ressuscitação de slot já vencido.
3. **`done` = entregue ao canal, não confirmado no TikTok.** A agenda junta `run_status` e `post_status` para mostrar o desfecho real; um post que o Buffer recusou depois aparece como “Falhou” na publicação e o card oferece “Reenviar ao Buffer”.
4. **Deduplicação por canal.** Só um `dispatch_events` `sent` **do mesmo canal** marca o slot como `done`. Um envio anterior ao Telegram não impede o envio ao Buffer. Run já `published` (manual/outro canal) faz o slot ser `skipped` para evitar duplicata.
5. **Run já publicado manualmente não ganha botão ativo.** O card mostra “Já publicado” desabilitado quando não há `buffer_dispatched_at` e o run está `published`.
6. **Provider não suportado não cai no Telegram.** Conta `postforme` com `external_account_id` gera slot `social` e é pulada com erro claro nesta fase; o botão do Buffer só aparece para provider Buffer/nulo.
