# Listo Carousel Generator (v2)

Plataforma unificada para geração de carrosséis TikTok (Image-First), agendamento via cron, bot Telegram, painel de controle web (SPA React) e gerenciamento de contas, mídias e métricas de desempenho.

Health check em `GET /health` e API sob `/api/v1/*`.

## Setup VPS

```bash
git clone <repo> && cd shipworm
cp .env.example .env
# Preencha as variáveis de ambiente necessárias no .env (detalhadas abaixo)

npm install
npm run build
npm run db:migrate
npm run db:seed    # Opcional: inicializa contas, arquétipos e baits a partir de config/
npm run media:scan # Opcional: escaneia a pasta media/ para indexar imagens no banco

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
| `MEDIA_ROOT` | Diretório raiz de mídias | `./media` |
| `OUTPUT_DIR` | Diretório onde os carrosséis gerados são salvos | `./output` |
| `USAGE_DAYS` | Janela de dias para deduplicação/rotação de imagens | `7` |
| `DISPATCH_WEBHOOK_URL` | Webhook HTTP opcional para evento de envio/despacho | *(opcional)* |
| `FRONTEND_DIST_DIR` | Caminho personalizado para os estáticos do frontend SPA | `frontend/dist` |

## Estrutura de Mídia

As mídias são organizadas por escopo e categoria:
- `media/<role>/capas/` (`single_woman`, `single_man`, `couple_women`, `couple_men`)
- `media/<role>/aleatorias/`
- `media/shared/aleatorias/`
- `media/shared/listo/`

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
