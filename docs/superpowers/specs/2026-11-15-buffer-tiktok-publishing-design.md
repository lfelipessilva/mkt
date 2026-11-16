# Camada de Publicação e Métricas no TikTok (Provider-Agnostic com Buffer) — Design Técnico

**Data:** 2026-11-15  
**Autor:** Antigravity AI & Luis Felipe  
**Status:** Proposto  
**Branch:** `lfelipessilva/feature-buffer-tiktok-publishing`  

---

## 1. Intent & Context

Construir uma camada desacoplada de publicação automática e coleta de métricas de engajamento no TikTok para a plataforma de Marketing Ops (`listo-marketing-ops-root`). 

O sistema deve operar sob o padrão **Adapter (Strategy Pattern)** através de uma interface unificada (`SocialPublisherProvider`). A aplicação core não deve ter conhecimento de especificidades de protocolos externos (como GraphQL do Buffer ou REST do Post for Me).

* **Fase 1 (Atual):** Adapter `BufferPublisherAdapter` (Buffer GraphQL API — Plano Free: até 3 canais ativos, limite de fila de 10 posts agendados, rate limit de 100 req/15min, retenção de métricas de 30 dias, polling de status sem webhooks).
* **Fase 2 (Escala Futura):** Adapter `PostForMePublisherAdapter` (Post for Me REST API — contas ilimitadas, webhooks em tempo real, retenção estendida).

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### Goals
1. **Interface de Domínio Unificada:** Definir `SocialPublisherProvider` para contas (`listConnectedAccounts`), publicação (`publishPost`), consulta de estado (`getPostStatus`) e métricas (`getPostMetrics`).
2. **Suporte Nativo a Carrosséis (Photo Mode):** Permitir postagem de múltiplos slides (carrossel de imagens) consumindo diretamente as URLs públicas armazenadas no **Silo VPS (MinIO S3)** (`carouselsBucket`), além de suporte a vídeo `.mp4` caso fornecido.
3. **Buffer GraphQL Adapter Completo:**
   - Mapear mutation `createPost` com array `assets: [{ image: { url } }]` para carrosséis e `{ video: { url } }` para vídeos.
   - Suportar publicação imediata (`shareNow`) e agendamento (`customScheduled` com `dueAt`).
   - Implementar todos os guardrails do plano Free: trava de 3 contas ativas, controle de fila de 10 posts (com fallback para fila local interna), rate limit com exponential backoff para HTTP 429.
4. **Ciclo de Vida & Workers:**
   - Polling de status assíncrono para o Buffer (verificação a cada 2 min nos primeiros 15 min após disparo).
   - Cron diário de sincronização de métricas (respeitando a janela estrita de 30 dias do Free tier).
5. **Integração com o Pipeline Existente:** Integrar com `carousel_runs`, `dispatch_events` e sincronizar `tiktok_posts` / `tiktok_metrics`.

### Non-Goals
* Construção de transcodificação de slides em vídeo `.mp4` (ffmpeg) no backend nesta fase, uma vez que o TikTok e o Buffer suportam nativamente carrosséis de imagens (Photo Mode).
* Implementação completa de OAuth com telas de login do TikTok no frontend (v1 utiliza o Personal Access Token do Buffer configurado via variável de ambiente).
* Implementação ativa dos endpoints de envio do Post for Me nesta fase (apenas interfaces, stubs e contratos prontos para hot-swap).

### Anti-Goals
* Acoplar chamadas de GraphQL ou endpoints de terceiros dentro dos serviços de domínio de runs (`runs/generate.ts`) ou de contas (`accounts/`).
* Fazer consultas de métricas frequentes (ex.: hora a hora), o que esgotaria os rate limits do Buffer (1.000 req/mês por canal) para dados que a rede só atualiza a cada 24h.

---

## 3. Abordagens Consideradas & Decisão

* **Abordagem 1 (Escolhida — Contrato Nativo de Carrosséis & Vídeos com URLs do Silo):**
  A interface aceita `media: { type: 'carousel', imageUrls: string[] } | { type: 'video', videoUrl: string }`. Os carrosséis já gerados pelo pipeline são enviados ao Silo VPS (`personal-minio`), e suas URLs públicas HTTPS são passadas diretamente para o `assets` do Buffer.
  * *Vantagens:* Zero overhead de CPU com ffmpeg; preserva o formato nativo de carrossel de fotos no TikTok (maior engajamento); desacoplado e aderente ao repositório.
* **Abordagem 2 (Transcodificação para MP4):**
  Converter os slides do carrossel em vídeo `.mp4` antes de enviar ao Buffer.
  * *Desvantagens:* Alto consumo de CPU na VPS, perda do formato interativo de carrossel do TikTok. Descartada.
* **Abordagem 3 (Acoplamento Direto do Buffer no DispatchService):**
  Inserir a mutação do Buffer diretamente em `backend/src/domain/dispatch/service.ts`.
  * *Desvantagens:* Inviabiliza a Fase 2 (Post for Me) e viola a arquitetura provider-agnostic. Descartada.

---

## 4. Contrato de Domínio Unificado (`SocialPublisherProvider`)

Localização: `backend/src/domain/social/types.ts`

```typescript
export type SocialProviderType = "buffer" | "postforme";

export interface SocialAccount {
  internalAccountId: string; // ID da conta no app (ex: 'gabriel', 'lucas')
  provider: SocialProviderType;
  externalAccountId: string; // channelId no Buffer; social_account_id no Post for Me
  username: string;          // @perfil no TikTok
  service: "tiktok";
  isActive: boolean;
}

export type SocialMediaType = "carousel" | "video";

export interface SocialMediaCarousel {
  type: "carousel";
  imageUrls: string[]; // URLs públicas HTTPS dos slides (mínimo 2, máx 35)
}

export interface SocialMediaVideo {
  type: "video";
  videoUrl: string;    // URL pública HTTPS do vídeo .mp4/.mov
  thumbnailOffsetMs?: number;
}

export type SocialMediaContent = SocialMediaCarousel | SocialMediaVideo;

export interface PublishPostRequest {
  internalPostId: string; // UUID do run/post interno
  externalAccountId: string; // ID da conta no provedor
  caption: string;
  media: SocialMediaContent;
  publishMode: "immediate" | "scheduled";
  scheduledAt?: string; // ISO-8601 (obrigatório se scheduled)
}

export type PublishStatus = "queued" | "processing" | "published" | "failed";

export interface PublishPostResponse {
  externalPostId: string;
  status: PublishStatus;
  rawResponse: Record<string, unknown>;
  publishedAt?: string;
  errorMessage?: string;
}

export interface PostMetrics {
  externalPostId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collectedAt: string; // ISO-8601
}

export interface SocialPublisherProvider {
  readonly providerName: SocialProviderType;

  listConnectedAccounts(): Promise<SocialAccount[]>;
  publishPost(request: PublishPostRequest): Promise<PublishPostResponse>;
  getPostStatus(externalPostId: string): Promise<PublishPostResponse>;
  getPostMetrics(externalPostId: string): Promise<PostMetrics | null>;
}
```

---

## 5. Especificação do Adapter 1: Buffer GraphQL (`BufferPublisherAdapter`)

Localização: `backend/src/domain/social/providers/buffer.ts`

### 5.1. Configuração & Headers
* Variáveis de Ambiente:
  * `SOCIAL_PROVIDER=buffer`
  * `BUFFER_API_URL=https://api.buffer.com` (GraphQL HTTP POST no root)
  * `BUFFER_ACCESS_TOKEN=<Personal Token>`
* Headers:
  * `Authorization: Bearer ${BUFFER_ACCESS_TOKEN}`
  * `Content-Type: application/json`

### 5.2. Mapeamento de Operações GraphQL

#### 1. `listConnectedAccounts()`
Executa query de canais filtrando TikTok:
```graphql
query GetChannels {
  account {
    organizations {
      channels {
        id
        service
        name
        serviceUsername
      }
    }
  }
}
```
* Filtro: `channel.service === "tiktok"`.
* Mapeamento: `externalAccountId = channel.id`, `username = channel.serviceUsername || channel.name`.

#### 2. `publishPost(request)`
Executa mutation `createPost`:
```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess {
      post {
        id
        status
        dueAt
      }
    }
    ... on MutationError {
      message
    }
  }
}
```
* **Payload `input`:**
  * `channelId: request.externalAccountId`
  * `text: request.caption`
  * Se `request.media.type === "carousel"`:
    `assets: request.media.imageUrls.map(url => ({ image: { url } }))`
  * Se `request.media.type === "video"`:
    `assets: [{ video: { url: request.media.videoUrl } }]`
    `metadata: { tiktok: { thumbnailOffset: request.media.thumbnailOffsetMs } }`
  * Se `request.publishMode === "immediate"`:
    `schedulingType: automatic`, `mode: shareNow`
  * Se `request.publishMode === "scheduled"`:
    `schedulingType: automatic`, `mode: customScheduled`, `dueAt: request.scheduledAt`

#### 3. `getPostStatus(externalPostId)`
Query de consulta do post:
```graphql
query GetPost($id: ID!) {
  post(id: $id) {
    id
    status
    sentAt
    error {
      message
    }
  }
}
```
* Mapeia status do Buffer (`sent` $\rightarrow$ `published`, `queued` / `buffer` $\rightarrow$ `queued`, `failed` $\rightarrow$ `failed`).

#### 4. `getPostMetrics(externalPostId)`
Query de analytics do post no Buffer:
```graphql
query GetPostMetrics($id: ID!) {
  post(input: { id: $id }) {
    id
    metrics {
      type
      name
      value
      unit
    }
    metricsUpdatedAt
  }
}
```
* O Buffer retorna uma lista normalizada de métricas por tipo (`impressions`/`views`, `reactions`/`likes`, `comments`, `shares`/`reposts`). O adapter percorre o array e normaliza para o objeto `PostMetrics`.

### 5.3. Guardrails e Limites do Plano Free
1. **Trava de Contas:** Limitar no máximo a 3 contas ativas sob o provedor `buffer`.
2. **Controle de Fila (Max 10 posts pendentes):** No modo `scheduled`, se a conta já possui 10 posts na fila do Buffer, o sistema armazena o post como `publish_status = 'internal_pending'` com `scheduled_at` persistido no banco de dados. Um cron verifica posts com `internal_pending` e `scheduled_at <= now()` e dispara automaticamente via `shareNow` no horário estipulado.
3. **Rate Limit & Backoff:** 100 requisições por 15 minutos. Em caso de HTTP `429`, aplicar backoff exponencial (1s, 2s, 4s...) com jitter.
4. **Janela de Métricas de 30 Dias:** Recusar ou ignorar busca de métricas para posts publicados há mais de 30 dias (limite rígido da API Free do Buffer).
5. **Frequência de Métricas:** Cron diário (a cada 24 horas) para respeitar o limite de 1.000 requisições/mês por canal.

---

## 6. Storage Silo (MinIO) & Resolução de URLs Públicas

Para o Buffer conseguir baixar as imagens do carrossel:
* As imagens são salvas pelo pipeline no bucket `carousels` em:
  `{relOutDir}/slide_{numero}.jpg` (ex.: `2026-11-15/gabriel/post_1/slide_1.jpg`).
* **Resolução da URL Pública:**
  Utilizamos uma função helper `getCarouselPublicUrl(storagePathOrRelKey: string): string`:
  Se `SILO_SERVER_URL` estiver configurado e o bucket `carousels` for público no MinIO:
  `https://personal-minio.adaygq.easypanel.host/carousels/${cleanKey}`
  Caso o bucket seja restrito, o backend fornece uma rota pública ou URL pré-assinada com validade de 24 horas (tempo suficiente para o Buffer ingerir).

---

## 7. Banco de Dados e Migrations

Nova migration `003_social_publisher.sql`:

```sql
-- 1. Alter accounts to support social provider linkage
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS social_provider TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS social_account_metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Alter dispatch_channel enum to include buffer and social
ALTER TYPE dispatch_channel ADD VALUE IF NOT EXISTS 'buffer';
ALTER TYPE dispatch_channel ADD VALUE IF NOT EXISTS 'social';

-- 3. Enhance tiktok_posts with provider tracking
ALTER TABLE tiktok_posts
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_post_id TEXT,
  ADD COLUMN IF NOT EXISTS publish_status TEXT DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_response JSONB;

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_external_id ON tiktok_posts(external_post_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_polling ON tiktok_posts(publish_status, last_polled_at);
```

---

## 8. Polling Worker e Cron de Métricas

1. **Job de Polling de Publicação (`pollPendingPostsJob`):**
   - Roda a cada 2 minutos via `node-cron`.
   - Busca posts em `tiktok_posts` onde `publish_status IN ('queued', 'processing')` criados há menos de 30 minutos.
   - Chama `provider.getPostStatus(externalPostId)`.
   - Ao transicionar para `published` ou `failed`, atualiza `tiktok_posts` e o respectivo `carousel_runs.status`.
2. **Job de Métricas Diárias (`syncTikTokMetricsDailyJob`):**
   - Roda 1 vez a cada 24 horas (configurável, ex.: 04:00 AM).
   - Busca posts publicados há menos de 30 dias com `external_post_id IS NOT NULL`.
   - Coleta métricas atualizadas e insere em `tiktok_metrics`.

---

## 9. Hot-Swap: Post for Me (Fase 2)

* Implementação de `PostForMePublisherAdapter` com as mesmas interfaces.
* Endpoint de webhook preparado: `POST /api/v1/webhooks/social/postforme` com verificação de assinatura `POSTFORME_WEBHOOK_SECRET`.
* A troca de provedor é feita alterando apenas `SOCIAL_PROVIDER=postforme` no `.env`.
