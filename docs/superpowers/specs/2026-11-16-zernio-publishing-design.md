# Publicar pelo Zernio, com áudio sempre — Design

**Data:** 2026-11-16
**Status:** Aguardando aprovação

## Intent

As postagens de carrossel no TikTok e o vínculo das contas passam a ser feitos pelo Zernio. O Buffer deixa de ser publicador. Todo post de foto sai com uma faixa da biblioteca comercial do TikTok. Sem faixa, o post não é enviado.

Quem usa: quem opera as personas neste app (sync, conectar TikTok, publicar na hora ou pelo agendador com aprovação).

## Goals

- Um adapter Zernio no contrato `SocialPublisherProvider`: listar contas TikTok, publicar carrossel, ler status do post.
- Sync existente (`POST /api/v1/social/accounts/sync`) passa a importar contas do Zernio.
- Conectar TikTok devolve a `authUrl` do Zernio para a pessoa autorizar.
- Toda publicação de carrossel manda `musicSoundId` (`clip.id`, senão `tracks[].id`). Nunca `commercialMusicId`.
- Se a biblioteca não devolver id, a publicação falha e nada é criado no Zernio.
- O canal de slot, o botão de publicar e a aprovação automática deixam de falar "Buffer" e passam a publicar no Zernio.
- O atraso de 30 minutos que existia só para a fila do Buffer acaba. Aprovar ou clicar em publicar envia com `publishNow: true`.

## Non-goals

- Escolher a música na interface. A faixa vem do chart, escolhida de forma determinística pelo id do run.
- Narrar o carrossel, gerar MP4 ou hospedar áudio nosso.
- Publicar em rede que não seja TikTok.
- Implementar o Post for Me. O stub continua, e conta `postforme` segue sendo pulada com "provider não suportado nesta fase".
- Métricas novas. `getPostMetrics` devolve `null`.
- OAuth headless, seleção de página, ou app OAuth próprio.
- Marcar o post como feito por IA (`video_made_with_ai` quebra post direto de foto).
- Renomear a coluna `carousel_runs.buffer_dispatched_at`. O nome fica. O significado passa a ser "enviado ao publicador".

## Constraints

- API: `https://zernio.com/api/v1`, header `Authorization: Bearer`. Sem SDK novo. `fetch`, como o adapter do Buffer faz hoje.
- Env obrigatório: `ZERNIO_API_KEY`, `ZERNIO_PROFILE_ID`. Sem os dois, sync, connect e publish respondem erro claro, sem chamar a API.
- Contas: `GET /v1/accounts?profileId=`. Body: `{ accounts: [{ _id, platform, username, displayName, isActive }] }`. `platform === "tiktok"` entra; o resto é ignorado. `external_account_id = _id`. O handle do match e da conta nova é `username` (com ou sem `@`). `displayName` vira `display_name` só na conta criada. `isActive === false` é ignorado.
- Connect: `GET /v1/connect/tiktok?profileId=`. A resposta traz `authUrl`. O app só devolve essa URL. Não recebe o callback.
- Post: `POST /v1/posts`. Corpo na raiz, não dentro de `platforms[]`:

  ```json
  {
    "content": "<legenda>",
    "mediaItems": [{ "type": "image", "url": "https://..." }],
    "platforms": [{ "platform": "tiktok", "accountId": "<external_account_id>" }],
    "tiktokSettings": {
      "privacy_level": "PUBLIC_TO_EVERYONE",
      "allow_comment": true,
      "allow_duet": true,
      "allow_stitch": true,
      "content_preview_confirmed": true,
      "express_consent_given": true,
      "media_type": "photo",
      "photo_cover_index": 0,
      "musicSoundInfo": { "musicSoundId": "<clip.id ou tracks[].id>" }
    },
    "publishNow": true
  }
  ```

  Um `mediaItems` por slide, na ordem, URL pública HTTPS que o app já resolve. `content` é a legenda (`run.legenda`), string vazia se não houver. Sem volume, corte, `auto_add_music` ou `draft`. Modo `scheduled` troca `publishNow` por `scheduledFor` (ISO-8601) e não manda os dois.
- Música: `GET /v1/accounts/{accountId}/tiktok/commercial-music` sem `countryCode` (chart global). A faixa é escolhida por hash do `internalPostId` (id do run) sobre o tamanho do chart, para variar entre posts e repetir a mesma faixa num retry do mesmo run. `musicSoundId = clip.id` se existir, senão `tracks[].id`.
- Status: `GET /v1/posts/{postId}`. Mapear `published` → `published`; `failed` → `failed`; o resto (`scheduled`, `queued`, `processing`, `draft`) → `processing`. `externalPostId` é `post._id`.
- `channel` em `auto_post_slots` é TEXT com CHECK (`buffer`, `telegram`, `social`). Precisa de migration.

## Approaches

1. **Zernio no lugar do Buffer, faixa comercial em todo post (escolhida).** O mesmo fluxo (sync, dispatch, slot com aprovação, botão no card). A diferença é o destino e a música obrigatória. O chart muda; a gente não guarda a faixa.
2. **`auto_add_music`.** O TikTok pode não colocar música. Descartada: o pedido é que sempre tenha áudio.
3. **Gerar vídeo com trilha nossa.** Pipeline novo. Descartada: o produto continua carrossel de fotos.

## How — decisions already made

- Factory: só `zernio`. `SOCIAL_PROVIDER` deixa de ser lido. `getSocialPublisherProvider()` devolve o adapter Zernio. O arquivo `providers/buffer.ts` sai. Testes que mockam o provider continuam válidos se o mock implementar a interface.
- `SocialProviderType` ganha `"zernio"`. `"buffer"` sai do tipo. `"postforme"` fica.
- `resolvePlannedChannel`: `external_account_id` preenchido e provider `zernio` → canal `zernio`. Provider `postforme` → `social` (continua skip). Provider vazio, `buffer` ou outro → `telegram`. Conta antiga do Buffer não publica com o id do Buffer.
- Migration nova: slots `pending`, `running` ou `awaiting_approval` com `channel = 'buffer'` viram `skipped`, `last_error = 'buffer removido; sincronize a conta no Zernio'`. O CHECK passa a aceitar `zernio` e deixa de aceitar `buffer`. Slots já `done` / `failed` / `skipped` com `buffer` são atualizados para `zernio` só para o CHECK fechar, sem reenviar.
- Ticker: canal `zernio` faz o que `buffer` faz hoje (gera o run, pede aprovação no Telegram, não publica sozinho). Canal `social` segue skip.
- Aprovar publica na hora (`publishMode: "immediate"`). O agendamento de +30 min sai. Callback novo `approve_zernio:<runId>`. Callback antigo `approve_buffer:<runId>` chama a mesma função, para mensagem que já está no Telegram.
- Dispatch `?channel=zernio` publica imediato. `?channel=buffer` responde 400. `social` continua no código para o stub.
- Rótulos de UI: "Puxar contas do Zernio", "Conectar TikTok", "Publicar no TikTok", "Enviado", "Reenviar". O botão de conectar abre `authUrl` numa aba nova. O botão de sync é o mesmo endpoint de hoje.
- Texto de conta importada: `Conta importada via Zernio (...)`.
- Falha de música ou de API do Zernio sobe `AppError` e o dispatch/aprovação marcam falha como já fazem com erro do Buffer. Não há retry escondido que publique sem música.

## Left to the builder

- Nome do arquivo de migration e o jeito de achar o CHECK (o nome gerado em `004_auto_post_schedule.sql` é o default do Postgres).
- Na resposta de criar ou ler post, aceitar `post._id` ou `_id` no topo. O pedido de criação está fechado acima.
- Quais testes de Buffer reescrever e quais apagar. O comportamento novo precisa de teste no adapter (música presente, lista vazia não chama POST, sync filtra não-TikTok) e no planner (provider `zernio` → canal `zernio`; provider `buffer` → `telegram`).
- Copiar o tratamento de rede e HTTP do adapter do Buffer (timeout não é obrigatório; 429 pode estourar na primeira). Sem fila nova.
