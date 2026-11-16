# Puxar Contas do Buffer e Atualizar Informações pelo Frontend — Design Técnico

**Data:** 2026-11-16  
**Autor:** Antigravity AI & Luís Felipe  
**Status:** Aprovado  
**Issue:** [lfelipessilva/mkt#1](https://github.com/lfelipessilva/mkt/issues/1)  
**Branch:** `lfelipessilva/fazer-pull-das-contas-do-buffer-e-update-das-inf`  

---

## 1. Intent & Context

A plataforma de marketing (`listo-marketing-ops-root`) possui integração com o Buffer (`BufferPublisherAdapter`) para publicação de carrosséis e coleta de métricas no TikTok. No entanto:
1. O backend só vinculava canais do Buffer a contas locais se elas já existissem previamente no banco de dados com nomes/IDs coincidentes. Novos canais configurados no Buffer não eram importados.
2. O cadastro e atualização de contas (`accounts/store.ts` e `accounts/schemas.ts`) não persistiam nem expunham os campos `external_account_id`, `social_provider` e `social_account_metadata` introduzidos na migration 003.
3. No frontend (`AccountsPage.tsx` e `IntegrationsPage.tsx`), não existia interface para acionar o pull das contas do Buffer, visualizar o canal do Buffer vinculado a cada persona ou atualizar essas informações diretamente.

Este documento formaliza a arquitetura para fazer o pull de canais do Buffer (com auto-import de novos canais) e permitir a atualização completa das informações das contas diretamente pelo frontend.

---

## 2. Objetivos e Não-Objetivos

### Objetivos
1. **Pull com Auto-Import no Backend:**
   - Ao executar a sincronização (`POST /api/v1/social/accounts/sync`), buscar os canais do Buffer via `BufferPublisherAdapter.listConnectedAccounts()`.
   - Para cada canal retornado:
     - Se coincidir com uma conta existente no banco de dados (por ID, persona, display_name ou external_account_id), vincular atualizando `external_account_id`, `social_provider` e `social_account_metadata`.
     - Se for um canal novo ainda não cadastrado localmente, importá-lo automaticamente como uma nova conta com:
       - `id`: username sanitizado sem '@' (ex.: `lucas_fit`).
       - `display_name`: nome do canal no Buffer.
       - `role`: padrão `single_woman` (configurável pelo usuário depois).
       - `persona`: string vazia ou nota de importação.
       - `enabled`: `true`.
       - `external_account_id`: ID do canal no Buffer.
       - `social_provider`: `'buffer'`.
       - `social_account_metadata`: `{ channel_username: username }`.
   - Respeitar a trava de 3 contas ativas do plano Free do Buffer.
2. **Persistência Completa de Contas no Backend:**
   - Permitir `external_account_id`, `social_provider` e `social_account_metadata` nos schemas de `CreateAccountSchema` e `UpdateAccountSchema`.
   - Garantir que `upsertAccount` em `store.ts` persista e retorne esses campos.
3. **Frontend — AccountsPage & IntegrationsPage:**
   - Em `AccountsPage.tsx`:
     - Botão de ação no cabeçalho: **"Puxar Contas do Buffer"** (com loading e feedback de sucesso/erro).
     - Coluna/badge na tabela indicando o status do vínculo com o Buffer (`external_account_id` e username).
     - No formulário de edição/criação de conta: campos opcionais para visualizar/editar `external_account_id` e `social_provider`.
   - Em `IntegrationsPage.tsx`:
     - Card dedicado ao Buffer ("Buffer Social Publishing") com botão de sincronização e resumo dos canais conectados.

### Não-Objetivos
- Implementação de fluxo OAuth interativo no frontend (o Personal Access Token do Buffer continua definido via `BUFFER_ACCESS_TOKEN` no backend).
- Suporte a outras redes sociais além do TikTok nesta fase (o Free tier do Buffer é focado nos 3 canais TikTok).

---

## 3. Abordagens Consideradas

- **Abordagem A (Escolhida — Auto-import no Pull + Edição no Frontend):**  
  O pull busca canais do Buffer, atualiza existentes e cria novas contas para canais ainda não registrados. O usuário ganha visibilidade instantânea dos canais na tabela e pode editar persona, papel (role) e nome diretamente.  
  *Vantagens:* Fluxo fluido e zero atrito; resolve a issue integralmente.
- **Abordagem B (Importação manual restrita):**  
  Exige que o usuário cadastre manualmente primeiro a conta com o username exato antes de puxar do Buffer.  
  *Desvantagens:* Propenso a erros de digitação e obriga o usuário a fazer trabalho duplo. Descartada.

---

## 4. Contratos de API & Interfaces

### Backend
1. `backend/src/domain/accounts/schemas.ts`:
   - `CreateAccountSchema`: aceita `external_account_id?: string | null`, `social_provider?: string | null`, `social_account_metadata?: Record<string, unknown>`.
   - `UpdateAccountSchema`: aceita os mesmos campos opcionais.
2. `backend/src/domain/accounts/store.ts`:
   - `upsertAccount` atualiza as colunas `external_account_id`, `social_provider`, `social_account_metadata` no Postgres (`ON CONFLICT (id) DO UPDATE SET ...`).
3. `backend/src/domain/social/routes.ts`:
   - `syncSocialAccounts()`:
     - Executa `provider.listConnectedAccounts()`.
     - Realiza match com contas locais ou cria nova conta caso não exista correspondente.
     - Retorna `{ synced: number, matched: number, created: number, accounts: [...] }`.

### Frontend
1. `frontend/src/types.ts`:
   - Atualizar `Account`, `CreateAccountInput`, `UpdateAccountInput` com `external_account_id?: string | null` e `social_provider?: string | null`.
2. `frontend/src/api.ts`:
   - Adicionar `syncSocialAccounts(): Promise<SyncAccountsResult>`.
3. `frontend/src/tabs/settings/AccountsPage.tsx`:
   - Adicionar botão "Puxar Contas do Buffer".
   - Exibir badge do Buffer na tabela.
   - Adicionar campos de vínculo Buffer no modal de edição/criação.
4. `frontend/src/tabs/IntegrationsPage.tsx`:
   - Adicionar Card "Buffer Social Publishing" com botão de sincronizar.
