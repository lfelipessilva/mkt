# Personas + Media Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four accounts with `mediaRole`-scoped image pools and per-account archetype titles so covers/copy never cross persona.

**Architecture:** Resolve media paths from `mediaRole` + `shared`; select capas from role only, aleatorias from role∪shared, listo from shared; load `archetypesByAccount[account.id]`. No new dependencies. No new automated tests (spec).

**Tech Stack:** Node ≥20 ESM, existing `select.js` / `config.js` / `prompts.js` / `renameImages.js`, JSON config, filesystem media layout.

## Global Constraints

- `mediaRole` values exactly: `mulher` | `homem` | `casal`
- Media tree exactly: `media/{mulher|homem|casal}/{capas|aleatorias}` and `media/shared/{aleatorias|listo}`
- Both couple accounts share pool `casal`
- Archetypes keyed by full account `id` under `archetypesByAccount`
- No automated tests in this cycle
- Do not keep `media/01_capas`, `02_aleatorias`, `03_listo` after migration
- Persona strings and archetype lists: use the exact content from the approved brainstorm / this plan (do not invent shorter stubs)

## File map

| File | Responsibility |
|---|---|
| `config/accounts.json` | 4 accounts + `mediaRole` |
| `config/archetypes.json` | `archetypesByAccount` map |
| `src/config.js` | load map; expose `mediaRoot`; drop flat `media.capas`… |
| `src/pipeline/select.js` | `resolveMediaForRole`, `unionImages`, updated `selectCarousel` |
| `src/pipeline/run.js` | pass `mediaRole` + account archetypes |
| `src/pipeline/prompts.js` | tighten persona coherence line |
| `src/pipeline/renameImages.js` | walk all leaf media dirs |
| `src/server.js` | pass dir list for rename |
| `README.md` | document new layout |
| `media/**` | migrate folders |

---

### Task 1: Config — accounts + archetypes

**Files:**
- Modify: `config/accounts.json`
- Modify: `config/archetypes.json`

**Interfaces:**
- Produces: accounts with `{ id, persona, mediaRole, postsPerRun }`; `archetypesByAccount[id]: string[]`

- [ ] **Step 1: Replace `config/accounts.json`**

```json
{
  "accounts": [
    {
      "id": "rebeca.andrade.daily",
      "mediaRole": "mulher",
      "persona": "Mulher de 25 anos que mora sozinha. Gosta de coisas boas, odeia jogar dinheiro fora com besteira e já pegou o jeito de cuidar da casa e da rotina sem estresse. Fala no singular (eu, minha casa). Nunca mencione namorado ou outras pessoas morando junto.",
      "postsPerRun": 1
    },
    {
      "id": "lucas.mendes.rotina",
      "mediaRole": "homem",
      "persona": "Homem de 27 anos que mora sozinho. Direto ao ponto, prático e avesso a complicação: trata alimentação, treino, compras e finanças como um sistema simples para não perder tempo nem dinheiro à toa. Fala no masculino e no singular (eu, meu apê, cansado, pronto). Nunca mencione namorada ou outras pessoas morando junto.",
      "postsPerRun": 1
    },
    {
      "id": "renata.sousa.daily",
      "mediaRole": "casal",
      "persona": "Mulher de 26 anos que mora junto com o namorado há 7 anos. Casal prático e bem resolvido que divide contas, mercado e tarefas domésticas numa boa, sem drama nem briga por coisa boba. Fala no feminino e no plural quando faz sentido (a gente, meu namorado, nossa casa).",
      "postsPerRun": 1
    },
    {
      "id": "camila.e.thiago.ap",
      "mediaRole": "casal",
      "persona": "Mulher de 28 anos que recém foi morar junto com o noivo. Focados em juntar dinheiro para viajar e mobiliar o apartamento sem abrir mão de comer bem e sair no fim de semana. Cortam gastos invisíveis e organizam tudo em conjunto para sobrar dinheiro no fim do mês. Fala no feminino e no plural quando faz sentido (a gente, meu noivo, nosso apê).",
      "postsPerRun": 1
    }
  ]
}
```

- [ ] **Step 2: Replace `config/archetypes.json`**

Write exactly:

```json
{
  "archetypesByAccount": {
    "rebeca.andrade.daily": [
      "depois de 1 ano morando sozinha, as únicas regras que realmente funcionam",
      "coisas que parecem frescura mas economizam uns 700 reais no meu mês",
      "hábitos meio esnobes que adotei depois dos 24 e não abro mão",
      "5 coisas que eu pago todo mês sem pensar duas vezes pq valem cada centavo",
      "malandragens femininas que aprendi morando sozinha e facilitam tudo",
      "pequenos sistemas que eu criei pra nunca mais perder tempo com besteira",
      "erros de iniciante no mercado que eu parei de cometer morando só",
      "como eu organizo minha semana no domingo pra não surtar na quarta",
      "coisas que mulheres realmente organizadas fazem e ninguém percebe",
      "o que eu cortei da minha rotina depois que parei de romantizar o caos",
      "regras inegociáveis que colocaram minha vida financeira nos trilhos",
      "hábitos que me dão sensação de ter a vida sob controle em 10 minutos",
      "coisas que eu fazia aos 21 e hoje tenho vergonha de lembrar",
      "hacks de casa e mercado que ninguém te ensina quando você sai da casa dos pais",
      "como eu parei de jogar dinheiro fora sem precisar viver no aperto",
      "5 padrões que eu mudei pra sobrar mais dinheiro e tempo no fim do mês",
      "coisas banais que separam quem tem paz mental de quem vive apagando incêndio",
      "minha checklist de domingo à noite que garante uma semana impecável",
      "sinais silenciosos de que você finalmente amadureceu na vida prática",
      "truques de organização que parecem exagero até você testar por uma semana",
      "o que eu parei de comprar por impulso depois que entendi esse padrão",
      "regras de ouro pra fazer compra do mês em 25 minutos e sem estresse",
      "hábitos discretos de quem sabe administrar o próprio dinheiro",
      "coisas que eu automatizei na minha rotina pra não gastar energia à toa",
      "como eu transformei meu apê num ambiente que funciona sozinho",
      "5 decisões pequenas que mudaram completamente meu padrão de vida",
      "o manual não oficial de como não ser feita de otária no supermercado",
      "rotinas que me fazem parecer muito mais organizada do que eu realmente sou",
      "coisas que eu aprendi morando sozinha e hoje não abro mão por nada",
      "hábitos incomuns que comecei a ter e nunca mais parei de fazer",
      "coisas que parecem detalhe bobo mas mudam o nível da sua rotina",
      "o que eu parei de aceitar depois que comecei a valorizar meu tempo",
      "hábitos de gente que nunca tá correndo atrasada pra nada",
      "coisas que eu resolvo no celular em 3 minutos e me poupam horas na semana",
      "segredos de quem tem a casa sempre arrumada sem precisar viver limpando",
      "padrões silenciosos que fazem sobrar dinheiro todo fim de mês",
      "regras pessoais que eu sigo à risca pra não gastar dinheiro com preguiça",
      "hábitos meio polêmicos que deixaram minha vida muito mais leve",
      "detalhes da minha rotina que parecem frescura mas fazem toda diferença",
      "coisas que eu parei de comprar depois que aprendi a olhar o que realmente importa",
      "como eu faço pra dar conta de trabalho, treino e casa sozinha sem surtar",
      "5 hábitos que me fizeram sentir adulta de verdade depois dos 24",
      "regras que eu criei pra nunca mais esquecer nada importante no dia a dia",
      "truques de quem sabe fazer o salário render sem precisar virar mão de vaca",
      "coisas que todo mundo deveria testar por 15 dias morando sozinha",
      "o que eu mudei no meu apartamento pra parar de perder tempo com coisa inútil",
      "malandragens de organização pra quem tem preguiça de planilhas complexas",
      "coisas que eu não compro mais nem se estiverem na promoção",
      "hábitos de domingo que garantem que minha semana não vire uma bagunça",
      "pequenas mudanças que fizeram minha rotina parecer de gente muito bem-sucedida"
    ],
    "lucas.mendes.rotina": [
      "depois de 2 anos morando sozinho, as únicas regras que funcionam no meu apê",
      "coisas que parecem frescura mas economizam uns 800 reais no meu mês",
      "hábitos pragmáticos que adotei depois dos 25 e não abro mão",
      "5 coisas que eu pago todo mês sem pensar duas vezes pq poupam meu tempo",
      "malandragens de quem já entendeu como funciona a vida adulta na prática",
      "sistemas simples que eu criei pra não perder tempo com rotina doméstica",
      "erros de iniciante no supermercado que eu parei de cometer",
      "como eu resolvo minha semana inteira no domingo em menos de 1 hora",
      "coisas que caras realmente organizados fazem e ninguém repara",
      "o que eu cortei da minha rotina depois que parei de gastar à toa",
      "regras simples que colocaram minhas finanças no piloto automático",
      "hábitos que mantêm meu apê em ordem gastando 10 minutos por dia",
      "coisas que eu fazia aos 22 morando sozinho e hoje não fazem sentido",
      "hacks de mercado e alimentação pra quem treina e trabalha o dia inteiro",
      "como eu parei de queimar dinheiro com delivery por pura preguiça",
      "5 ajustes que eu fiz pra sobrar mais dinheiro no fim de todo mês",
      "coisas básicas que separam quem tem a vida sob controle de quem vive perdido",
      "minha rotina de domingo à noite pra não ter dor de cabeça na segunda",
      "sinais claros de que você finalmente aprendeu a morar sozinho",
      "truques de organização que parecem exagero até você aplicar por 15 dias",
      "o que eu parei de comprar no mercado depois que entendi esse padrão",
      "regras práticas pra fazer compra da semana em 20 minutos e sair fora",
      "hábitos discretos de quem sabe gerenciar o próprio dinheiro sem planilha",
      "coisas que eu automatizei no celular pra não gastar energia mental à toa",
      "como eu deixei meu apartamento funcional sem precisar virar escravo de limpeza",
      "5 decisões simples que melhoraram muito meu ritmo de trabalho e treino",
      "o manual básico de como não ser feito de otário no supermercado",
      "rotinas que mantêm tudo funcionando mesmo nas semanas mais corridas",
      "coisas que eu aprendi morando sozinho e hoje são lei pra mim",
      "hábitos meio incomuns que comecei a ter e aumentaram muito meu foco",
      "detalhes da rotina que parecem bobos mas poupam horas na semana",
      "o que eu parei de fazer depois que comecei a valorizar mais meu tempo",
      "hábitos de quem nunca vive correndo atrasado nem apagando incêndio",
      "coisas que eu resolvo no celular em 2 minutos e evitam retrabalho",
      "como manter a casa sempre apresentável sem perder o fim de semana",
      "padrões silenciosos que fazem o salário render bem mais",
      "regras pessoais que eu sigo à risca pra não comprar nada por impulso",
      "hábitos diretos ao ponto que deixaram minha semana muito mais produtiva",
      "detalhes de organização que parecem frescura mas evitam estresse",
      "coisas que eu cortei do carrinho de compras e nunca mais senti falta",
      "como eu concilio trabalho pesado, academia e casa morando sozinho",
      "5 hábitos que mudaram meu nível de disciplina depois dos 25",
      "regras que eu criei pra nunca mais voltar do mercado esquecendo o principal",
      "truques de quem sabe gastar bem sem precisar viver contando moeda",
      "coisas que todo cara que mora sozinho deveria testar por um mês",
      "o que eu mudei na minha cozinha pra parar de jogar comida fora",
      "atalhos de organização pra quem odeia burocracia e planilha",
      "coisas que eu não compro mais nem quando estão em oferta",
      "hábitos de domingo que garantem uma semana limpa e sem improviso",
      "pequenas otimizações que mudaram completamente minha rotina solo"
    ],
    "renata.sousa.daily": [
      "regras silenciosas que eu e meu namorado seguimos pra nossa casa funcionar",
      "acordos que todo casal deveria fazer antes de dividir o mesmo teto",
      "regras de convivência que salvaram meu namoro depois que fomos morar juntos",
      "5 coisas que eu e meu namorado fazemos toda semana e evitam qualquer estresse",
      "o que ninguém te conta sobre dividir a casa e as contas sem perder o romance",
      "acordos simples que fazem a rotina do casal fluir no piloto automático",
      "como eu e meu namorado dividimos compras e tarefas sem nenhuma briga",
      "coisas que parecem detalhe bobo mas mudam a paz de quem mora junto",
      "erros de casal no supermercado que a gente parou de cometer",
      "sistemas que eu e meu namorado criamos pra casa nunca virar bagunça",
      "5 coisas que a gente paga todo mês com gosto pq poupam briga em casa",
      "como a gente organiza a semana no domingo pra ninguém surtar na quarta",
      "hábitos de casais funcionais que não discutem por coisa boba",
      "o que a gente cortou da rotina depois que fomos morar juntos",
      "regras inegociáveis que colocaram nossas finanças a dois nos trilhos",
      "hacks de casa e mercado pra casais que trabalham o dia inteiro",
      "como a gente parou de gastar dinheiro à toa com delivery na semana",
      "5 padrões que eu e meu namorado mudamos pra sobrar mais dinheiro no mês",
      "coisas que separam casais organizados de casais que vivem discutindo por tarefa",
      "nossa checklist de domingo à noite que garante uma semana tranquila",
      "sinais de que você e seu namorado realmente sabem morar juntos",
      "truques de organização a dois que parecem exagero até você testar",
      "regras de ouro pra gente fazer compra do mês em 25 minutos sem atrito",
      "hábitos discretos de casais que administram bem o próprio dinheiro",
      "coisas que a gente automatizou na rotina pra não gastar energia à toa",
      "como transformamos nosso apê num lugar que funciona sem cobrança",
      "o manual não oficial de como fazer mercado em casal sem discutir",
      "coisas que eu aprendi morando com meu namorado e hoje não abro mão",
      "hábitos meio incomuns que eu e meu namorado adotamos em casa",
      "malandragens de organização pra casais sem tempo a perder",
      "coisas que a gente resolve no celular em 3 minutos e evitam mal-entendido",
      "segredos de casais que têm a casa sempre arrumada sem estresse",
      "regras pessoais que a gente segue pra não comprar coisa duplicada",
      "detalhes da nossa rotina a dois que parecem frescura mas salvam o dia",
      "como a gente dá conta de trabalho, treino e casa sem sobrecarregar ninguém",
      "5 hábitos que deixaram nossa convivência muito mais leve depois de 2 anos",
      "regras que criamos pra ninguém nunca esquecer o que tá faltando em casa",
      "truques de quem divide despesas numa boa sem ficar cobrando centavo",
      "coisas que todo casal que mora junto deveria testar por 15 dias",
      "o que mudamos na rotina da cozinha pra parar de desperdiçar comida",
      "acordos práticos pra quem divide apartamento e odeia planilha chata",
      "coisas que eu e meu namorado cortamos do carrinho e economizamos muito",
      "hábitos de domingo que garantem paz mental pra nós dois na semana",
      "pequenas mudanças que fizeram nossa vida a dois funcionar muito melhor",
      "o que a gente parou de fazer por preguiça depois que organizamos a casa",
      "regras básicas de sobrevivência pra casais que dividem o mesmo espaço",
      "detalhes de rotina que evitam 90% das discussões bobas de casal",
      "como simplificamos as compras da casa pra sobrar tempo pro fim de semana",
      "5 decisões pequenas que elevaram o nível da nossa rotina juntos",
      "coisas que parecem exagero no começo mas viram regra em qualquer casal prático"
    ],
    "camila.e.thiago.ap": [
      "5 coisas que eu e meu noivo cortamos pra sobrar dinheiro pras viagens",
      "regras financeiras que eu e meu noivo criamos depois que fomos morar juntos",
      "como a gente economiza uns 1.200 reais no mês sem abrir mão de sair",
      "o que ninguém te conta sobre mobiliar o apê e viajar sem se endividar",
      "acordos financeiros que fizemos antes de juntar as escovas de dentes",
      "erros de casal recém-morando junto que a gente cortou logo no primeiro mês",
      "como eu e meu noivo fazemos o salário render pra viajar todo ano",
      "5 gastos invisíveis que a gente eliminou do nosso apê recentemente",
      "hacks de supermercado pra casais que estão juntando dinheiro pros planos",
      "coisas que parecem frescura mas sobram no orçamento do casal no fim do mês",
      "sistemas simples que eu e meu noivo usamos pra controlar os gastos da casa",
      "o que a gente parou de comprar por impulso pra focar no nosso apartamento",
      "regras de ouro das nossas compras do mês pra não estourar o orçamento",
      "hábitos de casais que constroem patrimônio sem viver no aperto",
      "como a gente organiza a semana pra comer bem sem queimar dinheiro na rua",
      "5 trocas inteligentes que fizemos em casa e aliviaram muito as contas",
      "coisas que eu e meu noivo resolvemos no celular pra nunca comprar duplicado",
      "rotina de domingo que salva nosso bolso e nossa semana inteira",
      "malandragens de consumo inteligente pra casais que gostam de viver bem",
      "o manual prático de como não ser feito de otário no mercado em casal",
      "acordos simples que evitam qualquer briga por dinheiro ou compra em casa",
      "coisas que a gente automatizou na rotina pra sobrar tempo e dinheiro",
      "5 decisões que mudaram completamente a organização financeira do nosso apê",
      "detalhes da nossa rotina que parecem exagero mas pagam nossas passagens",
      "como a gente planeja o mercado da semana antes de sair de casa",
      "o que eu e meu noivo aprendemos sobre dinheiro depois de dividir o mesmo teto",
      "hábitos discretos de casais que têm a vida financeira super alinhada",
      "regras que criamos pra manter o apartamento impecável sem gastar fortuna",
      "coisas que parecem detalhe bobo mas fazem sobrar dinheiro todo mês",
      "como a gente concilia vida social, treino e economia pro casamento/viagens",
      "5 padrões de consumo que cortamos assim que mudamos pro nosso apê",
      "truques de organização doméstica pra casais focados em metas grandes",
      "o que a gente não compra mais no supermercado nem se estiver barato",
      "hábitos de fim de semana que garantem uma semana econômica e organizada",
      "regras silenciosas que fazem nosso orçamento a dois funcionar sem planilha",
      "como transformamos a rotina da casa pra parar de jogar comida e dinheiro fora",
      "sinais de que você e seu noivo estão administrando bem a vida juntos",
      "coisas que todo casal deveria alinhar nos primeiros 6 meses morando junto",
      "pequenos hábitos que aumentaram muito nossa margem pra investir e viajar",
      "o que a gente mudou nas compras de casa pra nunca faltar nem sobrar nada",
      "5 coisas que valem cada centavo na rotina de um casal ocupado",
      "atalhos práticos pra dividir despesas e tarefas sem desgaste",
      "coisas que parecem mão de vaca mas são pura inteligência financeira a dois",
      "nossa checklist de domingo que evita delivery de última hora na semana",
      "regras básicas que blindam o orçamento do casal contra compras por impulso",
      "como a gente mantém o padrão de vida alto cortando só o que é desperdício",
      "hábitos que eu e meu noivo adotamos e mudaram nossa relação com dinheiro",
      "detalhes de organização que fazem nosso apê funcionar no piloto automático",
      "5 escolhas simples que aceleraram nossos planos de viagem esse ano",
      "coisas que a gente aprendeu na marra no primeiro ano dividindo as contas"
    ]
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add config/accounts.json config/archetypes.json
git commit -m "$(cat <<'EOF'
Add four personas with mediaRole and per-account archetypes.

EOF
)"
```

---

### Task 2: Migrate media folders

**Files:**
- Create: `media/mulher/capas`, `media/mulher/aleatorias`, `media/homem/capas`, `media/homem/aleatorias`, `media/casal/capas`, `media/casal/aleatorias`, `media/shared/aleatorias`, `media/shared/listo`
- Move: all files out of `media/01_capas`, `media/02_aleatorias`, `media/03_listo`
- Delete: empty `01_capas`, `02_aleatorias`, `03_listo`

**Interfaces:**
- Produces: filesystem layout expected by `resolveMediaForRole`

- [ ] **Step 1: Create directories**

```bash
mkdir -p media/mulher/capas media/mulher/aleatorias \
  media/homem/capas media/homem/aleatorias \
  media/casal/capas media/casal/aleatorias \
  media/shared/aleatorias media/shared/listo
```

- [ ] **Step 2: Move capas by filename heuristic**

From `media/01_capas/`:

| Destination | Files matching |
|---|---|
| `media/casal/capas/` | name contains `casal` |
| `media/mulher/capas/` | name contains `mulher` or `uma_mulher` |
| `media/homem/capas/` | remaining (`jovem_*` etc.) |

```bash
cd media/01_capas
for f in *casal*; do [ -f "$f" ] && mv "$f" ../casal/capas/; done
for f in *mulher*; do [ -f "$f" ] && mv "$f" ../mulher/capas/; done
for f in *.*; do [ -f "$f" ] && mv "$f" ../homem/capas/; done
cd ../..
```

If a file was misclassified after visual check, move it by hand before committing.

- [ ] **Step 3: Move aleatorias + listo**

All current mid-slides → shared (role-exclusive aleatorias stay empty until you add some later):

```bash
mv media/02_aleatorias/* media/shared/aleatorias/
mv media/03_listo/* media/shared/listo/
rmdir media/01_capas media/02_aleatorias media/03_listo
```

- [ ] **Step 4: Verify counts**

```bash
find media -type f \( -iname '*.jpg' -o -iname '*.png' -o -iname '*.webp' \) | wc -l
ls media/casal/capas media/mulher/capas media/homem/capas media/shared/aleatorias media/shared/listo
```

Expected: every old image still exists under the new tree; old `01_/02_/03_` gone.

- [ ] **Step 5: Commit**

```bash
git add -A media
git commit -m "$(cat <<'EOF'
Restructure media into role and shared folders.

EOF
)"
```

---

### Task 3: `resolveMediaForRole` + `selectCarousel`

**Files:**
- Modify: `src/pipeline/select.js`
- Modify: `src/config.js`
- Modify: `src/pipeline/run.js`

**Interfaces:**
- Consumes: `mediaRoot`, `mediaRole`, `archetypes: string[]`
- Produces:
  - `resolveMediaForRole(mediaRoot, mediaRole) → { capas, aleatoriasRole, aleatoriasShared, listo }`
  - `allMediaImageDirs(mediaRoot) → string[]` (for rename)
  - `selectCarousel({ mediaRoot, mediaRole, archetypes, … })`

- [ ] **Step 1: Add helpers at top of `select.js` (after imports)**

```js
const MEDIA_ROLES = new Set(["mulher", "homem", "casal"]);

export function resolveMediaForRole(mediaRoot, mediaRole) {
  if (!MEDIA_ROLES.has(mediaRole)) {
    throw new Error(`mediaRole inválido: ${mediaRole}`);
  }
  return {
    capas: join(mediaRoot, mediaRole, "capas"),
    aleatoriasRole: join(mediaRoot, mediaRole, "aleatorias"),
    aleatoriasShared: join(mediaRoot, "shared", "aleatorias"),
    listo: join(mediaRoot, "shared", "listo"),
  };
}

export function allMediaImageDirs(mediaRoot) {
  const dirs = [];
  for (const role of MEDIA_ROLES) {
    dirs.push(join(mediaRoot, role, "capas"), join(mediaRoot, role, "aleatorias"));
  }
  dirs.push(join(mediaRoot, "shared", "aleatorias"), join(mediaRoot, "shared", "listo"));
  return dirs;
}

export function unionImages(...pools) {
  const seen = new Set();
  const out = [];
  for (const pool of pools) {
    for (const img of pool) {
      if (seen.has(img.filename)) continue;
      seen.add(img.filename);
      out.push(img);
    }
  }
  return out;
}
```

- [ ] **Step 2: Rewrite `selectCarousel` media + archetype picking**

Replace the function signature and pool loading so it looks like:

```js
export function selectCarousel({
  mediaRoot,
  mediaRole,
  archetypes,
  baits,
  persona,
  accountId,
  usage,
  usageDays = 7,
  aleatoriasCount,
  now = Date.now(),
}) {
  if (!Array.isArray(archetypes) || archetypes.length === 0) {
    throw new Error(`arquétipos ausentes pra conta: ${accountId}`);
  }

  const pruned = pruneUsage(usage, usageDays, now);
  const used = recentlyUsedFilenames(pruned);
  const usedBaits = recentlyUsedBaits(pruned);

  const dirs = resolveMediaForRole(mediaRoot, mediaRole);
  const capas = listImages(dirs.capas);
  const aleatorias = unionImages(
    listImages(dirs.aleatoriasRole),
    listImages(dirs.aleatoriasShared),
  );
  const listos = listImages(dirs.listo);

  if (!capas.length || !listos.length || aleatorias.length < 3) {
    throw new Error(
      `mídia insuficiente (${mediaRole}): capas=${capas.length} aleatorias=${aleatorias.length} listo=${listos.length}`,
    );
  }

  // … keep existing pick logic for capa / listo / aleatorias / mid / slides …

  const arquetipoTitulo = pickRandom(archetypes);
  // … bait + return unchanged shape …
}
```

Remove any use of `mediaDirs.capas|aleatorias|listo`.

- [ ] **Step 3: Update `src/config.js`**

```js
export const config = {
  // … keep other fields …
  accounts: accountsFile.accounts,
  archetypesByAccount: archetypesFile.archetypesByAccount || {},
  baits: baitsFile.baits,
  mediaRoot: join(root, "media"),
  usagePath: join(root, "data/usage.json"),
  outputDir: join(root, "output"),
  usageDays: 7,
};
```

Delete the old `media: { capas, aleatorias, listo }` object and the old `archetypes: archetypesFile.archetypes` field.

- [ ] **Step 4: Update `src/pipeline/run.js` `generateOne`**

```js
  const archetypes = config.archetypesByAccount[account.id];
  if (!Array.isArray(archetypes) || !archetypes.length) {
    throw new Error(`arquétipos ausentes pra conta: ${account.id}`);
  }
  if (!account.mediaRole) {
    throw new Error(`mediaRole ausente pra conta: ${account.id}`);
  }

  const selection = selectCarousel({
    mediaRoot: config.mediaRoot,
    mediaRole: account.mediaRole,
    archetypes,
    baits: config.baits,
    persona: account.persona,
    accountId: account.id,
    usage,
    usageDays: config.usageDays,
  });
```

- [ ] **Step 5: Smoke-check selection without Gemini**

```bash
node --input-type=module -e "
import { loadUsage, selectCarousel } from './src/pipeline/select.js';
import { config } from './src/config.js';
for (const a of config.accounts) {
  const s = selectCarousel({
    mediaRoot: config.mediaRoot,
    mediaRole: a.mediaRole,
    archetypes: config.archetypesByAccount[a.id],
    baits: config.baits,
    persona: a.persona,
    accountId: a.id,
    usage: loadUsage(config.usagePath),
  });
  const capaPath = s.slides[0].path;
  console.log(a.id, a.mediaRole, s.arquetipoTitulo.slice(0,40), capaPath.includes('/'+a.mediaRole+'/capas/'));
}
"
```

Expected: four lines, last field `true` each time; no throw.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/select.js src/config.js src/pipeline/run.js
git commit -m "$(cat <<'EOF'
Select media and archetypes by account mediaRole.

EOF
)"
```

---

### Task 4: Prompts + rename + README

**Files:**
- Modify: `config/prompts.js` (path is `config/prompts.js` in repo)
- Modify: `src/pipeline/renameImages.js`
- Modify: `src/server.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `allMediaImageDirs(mediaRoot)` from Task 3
- Produces: rename walks all role/shared leaf dirs; prompts enforce voice

- [ ] **Step 1: Tighten persona rule in `config/prompts.js`**

Replace rule 5 with:

```
5. COERÊNCIA DE PERSONA: Respeite rigorosamente gênero e número da persona (feminino/masculino, singular/plural). Se for solo, nunca mencione namorado/namorada/noivo/noiva nem alguém morando junto. Se for casal, use exatamente o termo da persona (namorado vs noivo) e o plural quando fizer sentido.
```

- [ ] **Step 2: Change `runRenameImages` to accept a dir list**

```js
export async function runRenameImages({
  dirs,
  apiKey,
  model,
  force = false,
}) {
  const targetDirs = (dirs || []).filter(Boolean);
  // … same loop over targetDirs instead of mediaDirs.capas/aleatorias/listo …
}
```

In `src/server.js`:

```js
import { allMediaImageDirs } from "./pipeline/select.js";
// …
runRenameImages({
  dirs: allMediaImageDirs(config.mediaRoot),
  apiKey: config.geminiApiKey,
  model: config.geminiModel,
  force,
})
```

- [ ] **Step 3: Update README media/config sections**

Replace setup media bullet with:

```
# media/mulher|homem|casal/{capas,aleatorias}
# media/shared/{aleatorias,listo}
```

Config bullets:

```
- Contas: `config/accounts.json` (`mediaRole`, `postsPerRun`)
- Arquétipos por conta: `config/archetypes.json` (`archetypesByAccount`)
```

- [ ] **Step 4: Commit**

```bash
git add config/prompts.js src/pipeline/renameImages.js src/server.js README.md
git commit -m "$(cat <<'EOF'
Align prompts, rename walker, and README with role media.

EOF
)"
```

---

### Task 5: End-to-end dry-run

**Files:** none (verification only)

- [ ] **Step 1: Dry-run one full batch**

```bash
npm run dry-run
```

Expected: generates under `output/<date>/` for all four account ids; no “mídia insuficiente”; capas paths contain the account’s `mediaRole`.

- [ ] **Step 2: Spot-check one meta.json per role**

Open `output/.../rebeca.andrade.daily/post_01/meta.json` and `.../lucas.mendes.rotina/...` and one casal account — confirm `arquetipoTitulo` matches that account’s list tone and `slides[0].path` is under the right role `capas`.

- [ ] **Step 3: If dry-run fails, fix root cause in the same session then re-run Step 1** (do not add tests)

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| 4 accounts + personas + mediaRole | 1 |
| Media tree + migration | 2 |
| Capas role-only / aleatorias union / listo shared | 3 |
| archetypesByAccount | 1 + 3 |
| resolveMediaForRole | 3 |
| prompts voice tweak | 4 |
| rename walks new dirs | 4 |
| README | 4 |
| No automated tests | all (smoke/dry-run only) |
| Success: no cross-role capas | 3 smoke + 5 dry-run |
