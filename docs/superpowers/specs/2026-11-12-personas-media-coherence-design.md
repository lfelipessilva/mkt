# Personas + coerência mídia/texto

## Goal

Quatro contas com voz clara e seleção de imagens que não cruza persona (capa de casal na solo, etc.). Arquétipos por conta. Sem testes automatizados neste ciclo.

## Contas

`config/accounts.json` — cada conta:

| Campo | Uso |
|---|---|
| `id` | chave estável (Telegram, output, arquétipos) |
| `persona` | string completa pro Gemini |
| `mediaRole` | `mulher` \| `homem` \| `casal` — pastas de mídia |
| `postsPerRun` | volume por turno |

Contas:

1. `rebeca.andrade.daily` — `mulher` — solo 25, singular feminino, sem parceiro
2. `lucas.mendes.rotina` — `homem` — solo 27, singular masculino, sem parceira
3. `renata.sousa.daily` — `casal` — mora junto há 7 anos, narradora feminina, “meu namorado”
4. `camila.e.thiago.ap` — `casal` — recém-juntados, narradora feminina, “meu noivo”, foco viagem/móveis

Os dois casais compartilham o pool `casal`; diferem só em persona + arquétipos.

## Mídia

```
media/
  mulher/{capas,aleatorias}/
  homem/{capas,aleatorias}/
  casal/{capas,aleatorias}/
  shared/{aleatorias,listo}/
```

Seleção por post:

1. **Capa** → só `media/{mediaRole}/capas`
2. **Aleatórias** → união de `media/{mediaRole}/aleatorias` + `media/shared/aleatorias` (usage 7 dias como hoje; se role tiver pouco, shared completa)
3. **Listo** → só `media/shared/listo`

Remover `media/01_capas`, `02_aleatorias`, `03_listo` após migração.

**Migração (manual na implementação):** classificar capas atuais em `mulher` / `homem` / `casal`; mover a maior parte das aleatórias pra `shared/aleatorias`; deixar poucos exclusivos em cada role se fizer sentido visual; mover `03_listo` → `shared/listo`.

## Arquétipos

`config/archetypes.json` vira:

```json
{ "archetypesByAccount": { "<accountId>": ["...", "..."] } }
```

Conteúdo: o mapa que o usuário já forneceu (rebeca / lucas / renata / camila).  
Seleção: `pickRandom(archetypesByAccount[account.id])`. Erro claro se o id não tiver lista ou estiver vazia.

Baits continuam globais em `config/baits.json`.

## Arquitetura (mudanças enxutas)

### `resolveMediaForRole(root, mediaRole)`

Um helper (em `select.js` ou `config.js`) devolve:

```js
{
  capas: media/{role}/capas,
  aleatoriasRole: media/{role}/aleatorias,
  aleatoriasShared: media/shared/aleatorias,
  listo: media/shared/listo,
}
```

`config.media` deixa de ser paths flat `01_/02_/03_`. O batch usa o helper por conta.

### `selectCarousel`

Assinatura efetiva:

- recebe `mediaRole`, `archetypes` (já filtrados pela conta), `persona`, `accountId`, usage…
- monta pools via helper
- `listImages` em uma pasta; união simples pras aleatórias (dedupe por filename se colidir)
- resto igual: N aleatórias 3–4, categoryPrefix, listo no meio, bait 50%

### `run.js` / `config.js`

- carrega as 4 contas com `mediaRole`
- passa `archetypesByAccount[account.id]` e `mediaRole` pra seleção
- `getAccount` inalterado em espírito

### `prompts.js`

Ajuste mínimo na regra de coerência de persona: respeitar gênero/número da persona; solo nunca inventa parceiro; casal usa o termo da persona (`namorado` vs `noivo`). Sem reescrita grande do system prompt.

### `renameImages`

Em vez de três dirs fixos, descobrir pastas-folha sob `media/` que contenham imagens (ou lista explícita das 8 pastas do layout). Rename continua in-place na pasta da foto.

### README

Documentar a nova árvore e os campos `mediaRole` / `archetypesByAccount`.

## Fora de escopo

- Testes automatizados
- Pastas separadas por casal (`casal_a` / `casal_b`)
- Validação visual por modelo
- Baits por persona

## Success

- Conta `mulher`/`homem` nunca sorteia capa de `casal` (e vice-versa entre roles)
- Título de capa sempre vem do array daquela conta
- Pipeline e rename funcionam só com a árvore nova
- `/gerar` produz um post por conta nas 4 personas
