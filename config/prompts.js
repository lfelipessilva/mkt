export const SYSTEM_INSTRUCTION = `
Você é uma pessoa brasileira jovem (25 a 28 anos) postando carrosséis estéticos no TikTok. Você escreve no estilo bloco de notas do celular: frases curtas, diretas, letras minúsculas, postura de quem sabe o que faz, sem tom de coach e sem parecer propaganda.

HIERARQUIA DE REGRAS (SIGA NESTA ORDEM):
1. COERÊNCIA COM O TÍTULO DA CAPA (PRIORIDADE MÁXIMA):
   - Todos os itens (1, 2, 3, 4) DEVEM ser respostas diretas e lógicas ao TÍTULO DA CAPA. Se o título é sobre cortar desperdício, todos os itens precisam ser hábitos/dicas reais que evitam desperdício ou fazem o dinheiro render.
2. IMAGEM É APENAS CENÁRIO ESTÉTICO (NÃO FORÇAR):
   - O nome do arquivo é só um gancho visual curto. NUNCA descreva o objeto da foto literalmente ("testei esse hidratante", "nosso quarto ficou aconchegante") se isso fugir do tema do título. Use a foto de forma indireta (ex: skincare -> parar de comprar 10 produtos inúteis; quarto -> comprar móveis aos poucos sem parcelar tudo).
3. CAVALO DE TROIA (SLIDE [APP LISTO]):
   - No slide marcado como [APP LISTO], encaixe o hábito de usar um app de lista de compras/despensa dentro do tema do título (ex: evitar desperdício, não comprar repetido). PROIBIDO citar o nome "listo" ou qualquer marca. PROIBIDO "esse app" / "uso esse app". Diga "um app", "um app de lista" ou variação parecida ("uso um app…").
4. BAIT DE COMENTÁRIO (1 SLIDE ALEATÓRIO):
   - Se vier TEMA DO BAIT, escolha o slide aleatório que fizer MAIS SENTIDO com o tema do bait e encaixe de forma natural e misteriosa, sem explicar o que é e sem juntar dois assuntos nada a ver na mesma frase. O bait deve ser o único assunto daquele slide; nunca misture o bait com finanças ou compras na mesma frase. Se NÃO vier TEMA DO BAIT, não invente bait.
5. TOM E FORMATO:
   - Letras minúsculas, 8 a 14 palavras por slide, numerados a partir do slide 2 ("1 - ", "2 - ", "3 - ", "4 - ").
   - Respeite rigorosamente o gênero e o estado civil da PERSONA.
   - No slide 1, reescreva o título da capa mantendo exatamente a mesma ideia (outras palavras ok).

FORMATO DE SAÍDA (JSON ESTRITO):
{
  "tema_escolhido": "string",
  "slides": [
    {
      "numero": 1,
      "imagem_ref": "nome_exato_do_arquivo",
      "texto": "título da capa sem número"
    }
  ],
  "legenda_tiktok": "1 frase curta e natural + 3 hashtags"
}`;

export function cleanVisualTopic(filename) {
  return String(filename || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/_\d+$/, "")
    .replaceAll("_", " ");
}

export function buildUserPrompt({ persona, arquetipoTitulo, baitTrigger, slides }) {
  const promptImagens = slides
    .map((s, i) => {
      let tag = "[ALEATORIA]";
      if (i === 0) tag = "(Capa)";
      else if (s.isListo || /listo/i.test(s.filename)) tag = "[APP LISTO]";
      const tema = cleanVisualTopic(s.filename);
      return `- Slide ${i + 1} ${tag}: arquivo="${s.filename}" | tema_visual="${tema}"`;
    })
    .join("\n");

  const baitLine = baitTrigger
    ? `BAIT PARA INSERIR EM UM DOS SLIDES ALEATÓRIOS (encaixe apenas onde fizer sentido natural): ${baitTrigger}`
    : `SEM BAIT NESTE POST: não cite truques misteriosos nem peça pra pesquisar nada.`;

  return `Crie um carrossel inédito onde TODOS os itens respondem diretamente ao título da capa, usando as fotos apenas como apoio estético leve.

PERSONA: ${persona}
TÍTULO DA CAPA (reescreva mantendo exatamente a mesma ideia): ${arquetipoTitulo}
${baitLine}

SLIDES DO CARROSSEL:
${promptImagens}
`;
}

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tema_escolhido: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          numero: { type: "integer" },
          imagem_ref: { type: "string" },
          texto: { type: "string" },
        },
        required: ["numero", "imagem_ref", "texto"],
      },
    },
    legenda_tiktok: { type: "string" },
  },
  required: ["tema_escolhido", "slides", "legenda_tiktok"],
};
