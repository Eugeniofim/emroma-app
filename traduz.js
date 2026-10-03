/* ---------- tradução PT → EN ----------
   O guia escreve só em português. O inglês sai daqui.

   Duas regras que não podem ser quebradas:

   1. NÃO sobrescrever inglês que já existe se o português não mudou. Os dois
      passeios de Natal têm inglês escrito à mão, melhor que o automático.
   2. Nunca apagar o que ela tem. Se a tradução falhar, fica o que estava —
      inglês velho serve, inglês vazio não.

   Sobre a qualidade: o tradutor gratuito erra tempo verbal e escolhe palavra
   literal ("is another" no lugar de "is a different place"). Serve para ela
   não ter que escrever, mas o texto fica visível no editor para ela corrigir. */
'use strict';

const TR_TIMEOUT = 12000;

/* Guarda o português que gerou cada tradução. Se o português for o mesmo,
   não traduz de novo — economiza chamada e preserva ajuste manual dela. */
function trAssinatura(pt) {
  let h = 0;
  const s = String(pt || '');
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return s.length + ':' + h;
}

async function trUma(pt) {
  const txt = String(pt || '').trim();
  if (!txt) return '';
  /* o serviço gratuito corta textos longos; mando em pedaços por parágrafo */
  const partes = txt.split(/\n{2,}/);
  const saida = [];
  for (const parte of partes) {
    if (!parte.trim()) { saida.push(''); continue; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TR_TIMEOUT);
    try {
      const u = 'https://api.mymemory.translated.net/get?langpair=pt-BR%7Cen-GB&q='
              + encodeURIComponent(parte);
      const r = await fetch(u, { signal: ctrl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      const out = j && j.responseData && j.responseData.translatedText;
      if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) return null;
      saida.push(out);
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  return saida.join('\n\n');
}

/* Traduz um conjunto de campos {chave: textoPt}.
   `antes` é o mapa de assinaturas da última tradução, para não repetir.
   Devolve { textos:{chave:en}, assinaturas:{chave:sig}, falhas:[chave] } */
async function traduzCampos(campos, antes = {}) {
  const textos = {}, assinaturas = { ...antes }, falhas = [];
  for (const [chave, pt] of Object.entries(campos)) {
    const sig = trAssinatura(pt);
    if (antes[chave] === sig) continue;      /* português não mudou */
    const en = await trUma(pt);
    if (en == null) { falhas.push(chave); continue; }
    textos[chave] = en;
    assinaturas[chave] = sig;
  }
  return { textos, assinaturas, falhas };
}
