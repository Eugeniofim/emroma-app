/* =====================================================
   NUVEM POR LINHA — a regra de ouro (skill app-sempre-junto)

   "Um banco. Muitas janelas. Cada registro e uma linha."
   Tudo o que nasceu depois do app de reservas (guias, disponibilidade,
   contas, orcamentos/CRM, fichas, clientes, tarefas, parceiros, pedidos)
   sobe como uma linha da tabela `itens`. Celular e computador olham para o
   mesmo banco: mexeu num, o outro recebe — sem "qual versao vale".

   As 4 pecas: SOMBRA (o que este aparelho sabe que ja esta no banco), FILA
   (o que ainda nao subiu — sobrevive a fechar o app), MARCA (ate que hora
   ja leu) e EM_DIA (so depois da primeira sincronia o app manda coisas).
   Catalogo e reservas continuam no cloud.js, que ja estava testado.
   ===================================================== */
'use strict';

/* precos = a Tabela de preços (tem os CUSTOS dela: vai só para `itens`, que só a
   dona lê — nunca para o appstate público); conversas = o que ela mandou a cada cliente */
/* iaMemoria = o que ela ensinou ao assistente (antes só no aparelho); arquivos = a ficha
   dos comprovantes/documentos (o arquivo em si fica no Drive) — v1.95 */
const ITENS_COLS = ['equipe', 'disp', 'contas', 'orcamentos', 'fichas', 'tarefas', 'clientes', 'parceiros', 'pontos', 'pedidos', 'lembretesVistos', 'interesse', 'precos', 'conversas', 'iaMemoria', 'arquivos', 'iaDiario'];
/* estas sao "dicionarios" no DB (chave -> valor); as outras sao listas com id */
const ITENS_DIC = ['fichas', 'lembretesVistos', 'interesse', 'conversas'];
const IT_SOMBRA = 'ingrid_sombra_v1', IT_FILA = 'ingrid_fila_v1', IT_MARCA = 'ingrid_marca_v1', IT_EMDIA = 'ingrid_emdia_v1';
const itLe = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const itGrava = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* id de cada registro: o proprio id; disponibilidade e guia|dia|turno */
function itemId(col, x, chave) {
  if (ITENS_DIC.includes(col)) return chave;
  if (col === 'disp') return `${x.pessoaId}|${x.data}|${x.turno}`;
  return x.id;
}
function itensDe(col) {
  const v = DB && DB[col];
  if (ITENS_DIC.includes(col)) return Object.entries(v || {}).map(([k, d]) => [k, d]);
  return (Array.isArray(v) ? v : []).filter(x => x && itemId(col, x)).map(x => [itemId(col, x), x]);
}
/* a dona, logada e com banco: so assim o app manda e le os itens */
const itPronto = () => typeof temNuvem === 'function' && temNuvem() && typeof isLoggedIn === 'function' && isLoggedIn();

/* compara com a SOMBRA e poe na FILA so o que mudou (e o que sumiu vira apagado) */
function itEnfileirar() {
  if (!itPronto() || !itLe(IT_EMDIA, false)) return 0;
  const sombra = itLe(IT_SOMBRA, {}), fila = itLe(IT_FILA, {});
  let n = 0;
  for (const col of ITENS_COLS) {
    const s = sombra[col] = sombra[col] || {}, vivos = new Set();
    for (const [id, x] of itensDe(col)) {
      vivos.add(id); const j = JSON.stringify(x);
      if (s[id] !== j) { s[id] = j; fila[col + '\u0001' + id] = { colecao: col, id, dados: x, apagado: false }; n++; }
    }
    for (const id of Object.keys(s)) if (!vivos.has(id)) { delete s[id]; fila[col + '\u0001' + id] = { colecao: col, id, dados: {}, apagado: true }; n++; }
  }
  itGrava(IT_SOMBRA, sombra); itGrava(IT_FILA, fila);
  return n;
}
async function itEnviarFila() {
  if (!itPronto()) return false;
  const fila = itLe(IT_FILA, {}), linhas = Object.values(fila);
  if (!linhas.length) return true;
  for (let k = 0; k < linhas.length; k += 200) {
    const lote = linhas.slice(k, k + 200);
    try {
      const r = await supaFetch('itens?on_conflict=colecao,id', { method: 'POST', body: JSON.stringify(lote),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      if (!r.ok) return false;
      const f2 = itLe(IT_FILA, {});
      for (const l of lote) { const kk = l.colecao + '\u0001' + l.id; if (f2[kk] && JSON.stringify(f2[kk]) === JSON.stringify(l)) delete f2[kk]; }
      itGrava(IT_FILA, f2);
    } catch (e) { return false; }
  }
  return true;
}
/* aplica no DB o que veio do banco; grava so no aparelho (nunca re-enfileira) */
function itAplicar(linhas) {
  const sombra = itLe(IT_SOMBRA, {});
  let mudou = 0;
  for (const l of linhas) {
    const col = l.colecao; if (!ITENS_COLS.includes(col)) continue;
    const s = sombra[col] = sombra[col] || {};
    if (ITENS_DIC.includes(col)) {
      DB[col] = DB[col] || {};
      if (l.apagado) delete DB[col][l.id]; else DB[col][l.id] = l.dados;
    } else {
      DB[col] = Array.isArray(DB[col]) ? DB[col] : [];
      const i = DB[col].findIndex(x => itemId(col, x) === l.id);
      if (l.apagado) { if (i >= 0) DB[col].splice(i, 1); }
      else if (i >= 0) DB[col][i] = l.dados; else DB[col].push(l.dados);
    }
    if (l.apagado) delete s[l.id]; else s[l.id] = JSON.stringify(l.dados);
    mudou++;
  }
  itGrava(IT_SOMBRA, sombra);
  if (mudou) try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
  /* chegou orçamento do formato antigo: o texto vira o de hoje (v1.94) */
  if (mudou && typeof Precos !== 'undefined' && Precos.migraTextos) try { Precos.migraTextos(); } catch (e) {}
  /* chegou memória do assistente de outro aparelho: o assistente daqui passa a saber */
  if (mudou && typeof ingMemDesce === 'function') try { ingMemDesce(); } catch (e) {}
  return mudou;
}
async function itPuxar() {
  if (!itPronto()) return { ok: false };
  const marca = itLe(IT_MARCA, '');
  let r;
  try { r = await supaFetch('itens?select=colecao,id,dados,apagado,atualizado_em' + (marca ? '&atualizado_em=gt.' + encodeURIComponent(marca) : '') + '&order=atualizado_em.asc&limit=5000'); }
  catch (e) { return { ok: false }; }
  if (!r.ok) return { ok: false };
  const linhas = await r.json();
  const n = itAplicar(linhas);
  if (linhas.length) itGrava(IT_MARCA, linhas[linhas.length - 1].atualizado_em);
  return { ok: true, n };
}
/* O RITUAL DE ABRIR: le o banco (insistindo — o plano gratis dorme), junta o
   que este aparelho tinha e o banco nao, e so entao passa a mandar. */
async function itSincronizarAoAbrir() {
  if (!itPronto()) return { ok: false };
  let r = { ok: false };
  for (let k = 0; k < 3 && !r.ok; k++) { r = await itPuxar(); if (!r.ok) await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); }
  if (!r.ok) return r;
  /* banco lido: agora sim o texto antigo dos orçamentos vira o de hoje (v1.94) */
  if (typeof Precos !== 'undefined' && Precos.migraTextos) try { Precos.migraTextos(); } catch (e) {}
  if (!itLe(IT_EMDIA, false)) {
    /* primeira vez neste aparelho: o que so ele tinha sobe (junta, nao troca) */
    itGrava(IT_EMDIA, true);
  }
  itEnfileirar();
  await itEnviarFila();
  return { ok: true, n: r.n };
}
/* depois de qualquer gravacao: enfileira e manda em ~1 s */
let itT = null;
function itAgendar() {
  if (!itPronto() || !itLe(IT_EMDIA, false)) return;
  clearTimeout(itT);
  itT = setTimeout(() => { itEnfileirar(); itEnviarFila(); }, 900);
}
/* O VISITANTE (cliente no site) so CRIA pedido: nao le nada, nao muda nada.
   E o que faz o "Meu pedido" e o "Monte seu roteiro" chegarem no celular dela. */
async function itPedidoPublico(colecao, x) {
  if (!(typeof temNuvem === 'function' && temNuvem()) || !['pedidos', 'orcamentos'].includes(colecao) || !x || !x.id) return false;
  try { const r = await supaFetch('itens', { method: 'POST', body: JSON.stringify({ colecao, id: x.id, dados: x, apagado: false }) }); return r.ok || r.status === 409; }
  catch (e) { return false; }
}
/* de 25 em 25 s, e quando a internet volta (nunca depender so do aviso na hora) */
let itRelogio = null;
function itLigar(onChange) {
  if (itRelogio || !itPronto()) return;
  itSincronizarAoAbrir().then(r => { if (r.ok && r.n && onChange) onChange(r); });
  itRelogio = setInterval(async () => { if (!itPronto()) return; itEnfileirar(); await itEnviarFila(); const r = await itPuxar(); if (r.ok && r.n && onChange) onChange(r); }, 25000);
  if (typeof addEventListener === 'function') addEventListener('online', () => { itEnfileirar(); itEnviarFila(); });
}
