# Design: Zernio Direct Dispatch, Multi-Account API Keys & Telegram Notifications

**Data:** 2026-11-17  
**Status:** Proposto para aprovação  

---

## 1. Contexto & Intenção (Why)

Atualmente na rotina de agendamento diário (`auto_post_slots`), quando um slot de postagem é configurado para o canal `zernio`:
1. O backend gera o carrossel e coloca o slot em `awaiting_approval`.
2. Como não há aprovação humana manual no Telegram antes da expiração da janela, os slots expiram automaticamente marcando `status: skipped` com erro `aprovação expirada` (visível no histórico de postagens).
3. O sistema usa apenas uma única chave global `ZERNIO_API_KEY` via `.env`, impedindo gerenciar perfis em organizações/contas distintas no Zernio.
4. Notificações de publicação e principalmente de erros precisam chegar de forma confiável no Telegram para monitoramento da operação.

A intenção desta alteração é eliminar o gargalo de aprovação manual no Zernio tornando o envio 100% automático e autônomo, permitir que cada conta do sistema tenha sua própria API Key do Zernio e emitir notificações claras de sucesso e erro no Telegram.

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### Objetivos
- **Envio Direto ao Zernio:** No ticker da rotina de agendamento (`runAutomationTick`), quando `channel === 'zernio'`, despachar diretamente via `dispatchCarouselRun` sem pausar em `awaiting_approval` e sem depender de confirmação manual.
- **Múltiplas Contas Zernio (API Key por conta):** Permitir que cada conta (`accounts`) possua seu próprio campo `zernio_api_key`. Ao despachar, consultar métricas ou fazer polling para essa conta, o sistema utiliza sua respectiva API key (com fallback para `process.env.ZERNIO_API_KEY` se vazio).
- **Interface de Contas:** Exibir campo de `Chave API Zernio` (com formato seguro de senha/máscara) na criação e edição de contas no frontend.
- **Notificações Confiáveis no Telegram:**
  - Enviar notificação de sucesso quando a postagem for enviada com êxito para o Zernio.
  - Enviar notificação de falha destacada com motivo claro sempre que ocorrer erro na geração ou no envio ao Zernio.
  - Assegurar que `notifyAutomation` consiga instanciar a API do Telegram (`TELEGRAM_BOT_TOKEN`) mesmo quando executado em segundo plano pelo cron (onde hoje `options.telegramApi` podia ser nulo).

### Não-Objetivos
- Não removeremos o endpoint legado de aprovação manual para compatibilidade caso algum carrossel seja despachado pontualmente com aprovação manual.
- Não alteraremos o fluxo do canal `telegram`, que já despacha direto.

### Anti-Objetivos
- Não expor chaves de API do Zernio em logs ou respostas públicas sem necessidade.
- Não quebrar contas existentes que já funcionam usando a chave padrão no `.env`.

---

## 3. Abordagens Consideradas

- **Opção A (Escolhida pelo usuário):** Campo `zernio_api_key` direto em cada conta (`accounts`).
  - *Vantagens:* Simplicidade, clareza direta (cada conta gerencia sua própria credencial), sem complexidade adicional de tabelas intermediárias.
  - *Trade-off:* Se várias contas usarem a mesma chave secundária, ela é informada em cada uma (ou deixada vazia para usar o fallback global).
- **Opção B:** Tabela de catálogo central de credenciais Zernio com seleção por dropdown nas contas.
  - *Vantagens:* Reutilização de chaves nomeadas.
  - *Desvantagens:* Maior atrito operacional para adicionar ou atualizar contas e mais complexidade de UI/banco.

---

## 4. Detalhes de Implementação

### 4.1 Banco de Dados e Schemas
- Criar migração SQL `007_account_zernio_api_key.sql`:
  ```sql
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS zernio_api_key TEXT;
  ```
- Atualizar `AccountSchema`, `CreateAccountSchema`, `UpdateAccountSchema` em `backend/src/domain/accounts/schemas.ts`.
- Atualizar `store.ts` de accounts (`listAccounts`, `getAccount`, `upsertAccount`, `updateAccount`) para carregar e salvar `zernio_api_key`.

### 4.2 Zernio Adapter & Factory
- Em `backend/src/domain/social/providers/zernio.ts`:
  - Permitir receber `apiKey?: string` no construtor de `ZernioPublisherAdapter`.
  - No método `sdk()`, resolver `this.apiKey || process.env.ZERNIO_API_KEY`.
- Em `backend/src/domain/social/factory.ts`:
  - `getSocialPublisherProvider(name?: string, options?: { apiKey?: string })` repassando `options?.apiKey` para o adapter.

### 4.3 Despacho e Polling por Conta
- Em `backend/src/domain/dispatch/service.ts`:
  - Na ramificação de envio para Zernio (`channel === 'zernio'`), recuperar `account.zernio_api_key` e instanciar o provider com essa chave específica (ou fallback global).
- Em `backend/src/domain/social/polling.ts` e `metricsSync.ts`:
  - Ao processar posts vinculados a uma conta específica, resolver e instanciar o provider com a chave de API da conta correspondente.

### 4.4 Ticker de Automação (Envio Direto sem Aprovação)
- Em `backend/src/domain/automation/ticker.ts`:
  - Quando `channel === "zernio"`:
    - Chamar `dispatchFn({ runId: run.id, channel: "zernio", triggeredBy: "auto_schedule", pool })`.
    - Em caso de sucesso: atualizar slot para `done`, preencher `finished_at` e disparar notificação `zernio_accepted` / `buffer_accepted`.
    - Em caso de falha: disparar notificação `publish_failed` com o erro e acionar `handleRetry(slot, errorMsg, now, pool)`.

### 4.5 Notificações do Telegram
- Em `backend/src/domain/automation/notifications.ts`:
  - Garantir fallback: se `options.telegramApi` não for injetado, instanciar via `new Api(process.env.TELEGRAM_BOT_TOKEN)` se o token e o chat existirem.
  - Melhorar as mensagens:
    - Envio ao Zernio: `📤 Enviado ao Zernio (TikTok) — @account — arquétipo: ...`
    - Falha de publicação: `❌ Falha na publicação Zernio — @account — motivo: ...`
    - Falha de geração: `❌ Falha ao gerar carrossel — @account — motivo: ...`

### 4.6 Frontend
- Em `frontend/src/types.ts`:
  - Adicionar `zernio_api_key?: string | null` aos tipos `Account`, `CreateAccountInput`, `UpdateAccountInput`.
- Em `frontend/src/tabs/settings/AccountsPage.tsx`:
  - Adicionar campo no modal de conta: "Chave API Zernio (opcional)", com tipo `password` ou toggle de visibilidade e hint "Se não preenchido, usará a chave padrão do sistema".
  - Salvar e carregar o valor no formulário.

---

## 5. Verificação & Testes
- Executar e atualizar a suíte de testes unitários e de integração do backend:
  - Teste do `ticker`: garantir que slot Zernio é despachado direto, marcado como `done` e notifica o Telegram.
  - Teste do `ZernioPublisherAdapter`: garantir uso da chave informada na conta ou fallback para `ZERNIO_API_KEY`.
  - Teste do `notifications`: garantir envio de mensagens com ou sem `telegramApi` pré-injetado.
- Testes do frontend:
  - Garantir compilação com `npm run build` / `npm test` no frontend.
