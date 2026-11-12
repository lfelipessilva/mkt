# Listo Carousel Generator

Gera carrosséis TikTok (Image-First) e manda no Telegram. Cron 3x/dia + comandos no bot. Health em `GET /health` (http nativo).

## Setup VPS

```bash
git clone <repo> && cd marketing
cp .env.example .env
# preencha GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_USER_IDS

npm install

# coloque fotos descritivas em:
# media/01_capas  media/02_aleatorias  media/03_listo

pm2 start ecosystem.config.cjs
pm2 save
```

Health: `http://localhost:3000/health`  
Rename batch (Gemini): `POST http://localhost:3000/rename-images` (`?force=1` refaz todas)

## Config

- Contas / volume: `config/accounts.json` (`postsPerRun`)
- Arquétipos de capa: `config/archetypes.json`
- Baits de comentário: `config/baits.json`
- Uso recente (imagens + baits): `data/usage.json` (janela de 7 dias)
- Cron: `CRON_SCHEDULE` (default `0 7,11,17 * * *`, timezone `TZ`)

## Telegram

Mesmo chat (`TELEGRAM_CHAT_ID`):

- `/gerar` — 1 turno (todas as contas)
- `/gerar conta_a` — só uma conta
- `/mais` / `/mais conta_a` — 1 carrossel extra
- `/status`

## Local

```bash
npm test
npm run dry-run   # gera sem Telegram (precisa de mídia + Gemini)
npm start
```
