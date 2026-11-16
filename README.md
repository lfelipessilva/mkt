# Listo Carousel Generator (v2)

Plataforma unificada para geração de carrosséis TikTok (Image-First), agendamento via cron, bot Telegram, painel de controle web (SPA React) e gerenciamento de contas, mídias e métricas de desempenho.

Health check em `GET /health` e API sob `/api/v1/*`.

## Setup VPS

```bash
git clone <repo> && cd shipworm
cp .env.example .env
# Preencha as variáveis de ambiente necessárias no .env (detalhadas abaixo)

# Dependências do sistema (fontes necessárias para renderização de texto pelo Sharp)
sudo apt-get update && sudo apt-get install -y fontconfig fonts-inter fonts-liberation fonts-dejavu-core fonts-noto-core

npm install
npm run build
npm run db:migrate
npm run db:seed    # Opcional: inicializa contas, arquétipos e baits a partir de config/
npm run media:scan # Opcional: sincroniza objetos do Silo (MinIO) para indexar imagens no banco media_assets

# PM2 (executa backend/dist/index.js)
pm2 start ecosystem.config.cjs
pm2 save
```

Ou via Docker Compose:
```bash
docker compose up -d --build
```

Health check: `http://localhost:3000/health`  
Painel Web: `http://localhost:3000/`

## Variáveis de Ambiente (VPS / Produção)

| Variável | Descrição | Padrão / Exemplo |
|---|---|---|
| `PORT` | Porta HTTP da aplicação | `3000` |
| `HOST` | Interface de rede para bind | `0.0.0.0` |
| `NODE_ENV` | Ambiente (`production`, `development`, `test`) | `production` |
| `DATABASE_URL` | String de conexão do banco PostgreSQL | `postgresql://user:pass@localhost:5432/shipworm` |
| `API_TOKEN` / `API_KEY` | Bearer token exigido nas rotas `/api/v1/*` | `your-secret-token` |
| `GEMINI_API_KEY` | Chave de API Google Gemini para geração de copy | *(obrigatório)* |
| `GEMINI_MODEL` | Modelo Gemini utilizado | `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | Token do Bot Telegram | *(opcional)* |
| `TELEGRAM_CHAT_ID` | Chat ID padrão de destino para envios do Telegram | *(opcional)* |
| `TELEGRAM_ALLOWED_USER_IDS` | IDs autorizados no Telegram (separados por vírgula) | `1234567,9876543` |
| `CRON_SCHEDULE` | Expressão cron para geração agendada | `0 7,11,17 * * *` |
| `TZ` | Timezone do agendador e timestamps | `America/Sao_Paulo` |
| `OUTPUT_DIR` | Diretório temporário base onde os carrosséis são montados antes do upload ao Silo | `os.tmpdir()` / `./output` |
| `USAGE_DAYS` | Janela de dias para deduplicação/rotação de imagens | `7` |
| `DISPATCH_WEBHOOK_URL` | Webhook HTTP opcional para evento de envio/despacho | *(opcional)* |
| `FRONTEND_DIST_DIR` | Caminho personalizado para os estáticos do frontend SPA | `frontend/dist` |
| `SILO_SERVER_URL` | URL da API do MinIO / Silo S3 | `https://personal-minio.adaygq.easypanel.host` |
| `SILO_BROWSER_REDIRECT_URL` | URL do console web do MinIO / Silo | `https://console-minio.adaygq.easypanel.host` |
| `SILO_ACCESS_KEY` | Access key do Silo (MinIO) | *(obrigatório para storage remoto)* |
| `SILO_SECRET_KEY` | Secret key do Silo (MinIO) | *(obrigatório para storage remoto)* |
| `SILO_MEDIA_BUCKET` | Bucket para mídias base | `media` |
| `SILO_CAROUSELS_BUCKET` | Bucket para carrosséis gerados | `carousels` |
| `SOCIAL_PROVIDER` | Provedor de publicação social (`buffer`, `postforme`) | `buffer` |
| `BUFFER_API_URL` | URL base da API do Buffer | `https://api.buffer.com` |
| `BUFFER_ACCESS_TOKEN` | Token de acesso OAuth / API do Buffer | *(obrigatório para Buffer)* |

## Publicação Social (Buffer & TikTok)

A plataforma suporta publicação automática de carrosséis gerados para perfis do TikTok conectados via Buffer:

1. **Sincronização de Contas:** `POST /api/v1/social/accounts/sync` obtém os canais/perfis do Buffer e vincula o `external_account_id` às contas cadastradas.
2. **Despacho / Publicação:** Ao despachar com o canal `buffer` (`POST /api/v1/carousels/runs/:id/send?channel=buffer`), as imagens dos slides são resolvidas via URLs públicas do Silo e enviadas para a API do Buffer.
3. **Polling Worker:** Rotina periódica consulta o Buffer para atualizar o status de posts `queued`/`processing` para `published` ou `failed`.
4. **Métricas Diárias:** Worker diário sincroniza visualizações, curtidas, comentários e compartilhamentos de posts publicados há menos de 30 dias (`syncTikTokMetricsDailyJob`), atualizando rankings em `GET /api/v1/tiktok/performance`.

## Estrutura de Mídia e Silo (MinIO)

As mídias são organizadas por escopo e categoria exclusivamente no bucket `media` do Silo:
- `media/<role>/cover/` (`single_woman`, `single_man`, `couple_women`, `couple_men`)
- `media/<role>/random/`
- `media/shared/random/`
- `media/listo/` (escopo separado direto sob `media/listo/`)

Os carrosséis gerados (slides renderizados e `meta.json`) são armazenados de forma permanente no bucket `carousels` do Silo (com arquivos temporários em disco apenas durante a renderização e despacho).

## Telegram Bot

- `/gerar` — Gera carrosséis para todas as contas ativas
- `/gerar <account_id>` — Gera 1 carrossel para uma conta específica
- `/mais` / `/mais <account_id>` — Gera 1 carrossel extra
- `/status` — Informa o estado atual de execução e bloqueio de jobs

## Scripts & Comandos Úteis

```bash
# Testes (backend e frontend)
npm test
npm run test:backend
npm run test:frontend

# Build de produção
npm run build

# Banco de dados
npm run db:migrate
npm run db:seed
npm run media:scan

# Iniciar servidor em produção
npm start
```
