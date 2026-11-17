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
| `AI_PROVIDER` | Provedor de IA para geração de copy (`deepseek`, `gemini`) | `deepseek` |
| `DEEPSEEK_API_KEY` | Chave de API DeepSeek para geração de copy | *(obrigatório se AI_PROVIDER=deepseek)* |
| `DEEPSEEK_MODEL` | Modelo DeepSeek utilizado | `deepseek-chat` |
| `GEMINI_API_KEY` | Chave de API Google Gemini (alternativa) | *(obrigatório se AI_PROVIDER=gemini)* |
| `GEMINI_MODEL` | Modelo Gemini utilizado | `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | Token do Bot Telegram | *(opcional)* |
| `TELEGRAM_CHAT_ID` | Chat ID padrão de destino para envios do Telegram | *(opcional)* |
| `TELEGRAM_NOTIFY_CHAT_ID` | Chat ID específico para notificações de automação e botões de aprovação (fallback para `TELEGRAM_CHAT_ID`) | `1234567` *(opcional)* |
| `TELEGRAM_ALLOWED_USER_IDS` | IDs autorizados no Telegram (separados por vírgula) | `1234567,9876543` |
| `APP_BASE_URL` | URL base pública da aplicação web para compor deep links nos botões de aprovação | `https://painel.exemplo.com` *(opcional)* |
| `AUTOMATION_TZ` | Timezone da automação do agendador (`app_settings.auto_post_timezone` > `AUTOMATION_TZ` > `TZ` > `America/Sao_Paulo`) | `America/Sao_Paulo` |
| `AUTO_POST_WINDOWS` | Janelas de postagem padrão em JSON (`app_settings.auto_post_windows` > `AUTO_POST_WINDOWS` > default) | `[{"id":"morning","start":"07:00","end":"09:00"},{"id":"midday","start":"11:30","end":"12:30"},{"id":"evening","start":"18:00","end":"20:00"}]` |
| `AUTOMATION_CRON_SCHEDULE` | Expressão cron do ticker de automação (agenda e despacho) | `* * * * *` |
| `CRON_SCHEDULE` | *(Obsoleto para geração automática; substituído pelo motor de automação por slots)* Expressão cron legada | `0 7,11,17 * * *` |
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

### Fluxo de Aprovação e Publicação via Buffer

O fluxo de envio para o Buffer pode operar em modo manual ou com aprovação interativa integrada ao Telegram e à interface web:

- **Notificação e Botão no Telegram:** Quando um carrossel é gerado em um slot com aprovação pendente (`awaiting_approval`), o bot do Telegram envia uma notificação no chat configurado (`TELEGRAM_NOTIFY_CHAT_ID` ou `TELEGRAM_CHAT_ID`) contendo o botão inline **"Confirmar envio"** e, se `APP_BASE_URL` estiver configurado, um link direto para visualização do carrossel no painel web.
- **Aprovação via Telegram ou API:** O clique no botão inline executa o callback `approve_buffer:<runId>` que aciona o despacho direto para a API do Buffer e edita a mensagem confirmando o envio. Alternativamente, a aprovação pode ser feita via endpoint `POST /api/v1/automation/runs/:runId/approve`.
- **Publicação Manual no Painel (Galeria):** Na tela de Galeria de Carrosséis, o botão **"Publicar no Buffer"** permite o envio direto para a fila do Buffer para contas com canal TikTok vinculado, exibindo modal de confirmação e atualizando o status do item após o despacho bem-sucedido.


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
