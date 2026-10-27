/* =====================================================
   NUVEM POR LINHA — a regra de ouro (skill app-sempre-junto)

   "Um banco. Muitas janelas. Cada registro e uma linha."
   Tudo o que nasceu depois do app de reservas (guias, disponibilidade,
   contas, orcamentos/CRM, fichas, clientes, tarefas, parceiros, pedidos)
   sobe como uma linha da tabela `itens`. Celular e computador olham para o
   mesmo banco: mexeu num, o outro recebe — sem "qual versao vale".

   As 4 pecas: SOMBRA (o que este aparelho sabe que ja esta no banco), FILA
   (o que ainda nao subiu — sobrevive a fechar o app), MARCA (ate que hora
   ja leu) e EM DIA (so depois da primeira sincronia o app manda coisas).

   TRAVA CONTRA PERDA TOTAL (20/10/2026, igual a base): o "em dia" mora DENTRO
   do DB (DB._itensEmDia), nao numa chave separada. Antes ele morava ao lado:
   o botao "Sincronizar de novo" apagava o DB e deixava a sombra cheia, e o
   primeiro envio depois marcava TUDO como apagado no banco. Agora, DB apagado
   ou trocado = "em dia" some junto = o aparelho rele o banco inteiro antes de
   mandar qualquer coisa, e o que so ele tinha sobe (junta, nao troca).
   Catalogo e reservas continuam no cloud.js, que ja estava testado.
   ===================================================== */
'use strict';

/* precos = a Tabela de preços (tem os CUSTOS dela: vai só para `itens`, que só a
   dona lê — nunca para o appstate público); conversas = o que ela mandou a cada cliente */
/* iaMemoria = o que ela ensinou ao assistente (antes só no aparelho); arquivos = a ficha
   dos comprovantes/documentos (o arquivo em si fica no Drive) — v1.95 */
const ITENS_COLS = ['equipe', 'disp', 'contas', 'orcamentos', 'fichas', 'tarefas', 'clientes', 'parceiros', 'pontos', 'pedidos', 'lembretesVistos', 'interesse', 'precos', 'conversas', 'iaMemoria', 'arquivos', 'iaDiario', 'iaUso', 'privado', 'manualIA'];   /* iaUso = gasto da IA por dia + créditos que ela pôs (07/10); privado = os códigos dos links do kit da viagem (27/10) */
/* estas sao "dicionarios" no DB (chave -> valor); as outras sao listas com id */
const ITENS_DIC = ['fichas', 'lembretesVistos', 'interesse', 'conversas', 'privado'];
const IT_SOMBRA = 'ingrid_sombra_v1', IT_FILA = 'ingrid_fila_v1', IT_MARCA = 'ingrid_marca_v1';
/* a chave antiga do "em dia" (ate 18/10): nao vale mais nada, so e apagada */
const IT_EMDIA_VELHO = 'ingrid_emdia_v1';
const itLe = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const itGrava = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const itEmDia = () => typeof DB !== 'undefined' && !!DB && DB._itensEmDia === true;

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

/* DUAS JANELAS (26/10/2026 — a Ingrid perdeu os guias e as folgas de dezembro):
   a sombra mora no localStorage, que as janelas do mesmo navegador DIVIDEM, mas
   cada janela tem o seu DB na memória. Uma janela aberta antes (sem os guias
   novos) olhava a sombra cheia, não achava os guias no DB DELA e mandava
   "apagado" para o banco. Agora: (1) só apaga o que ESTA janela tinha e tirou;
   (2) o que está na sombra e esta janela nunca viu veio de outra janela → entra
   no DB, não sai; (3) o apagado leva junto o último conteúdo (dá para recuperar). */
const itConhecidos = {};
let itResgatados = 0;
function itConhecer() {
  for (const col of ITENS_COLS) { const k = itConhecidos[col] = itConhecidos[col] || new Set(); for (const [id] of itensDe(col)) k.add(id); }
}
function itAdota(col, id, json) {
  let x; try { x = JSON.parse(json); } catch (e) { return false; }
  if (ITENS_DIC.includes(col)) { DB[col] = DB[col] || {}; if (!(id in DB[col])) DB[col][id] = x; }
  else { DB[col] = Array.isArray(DB[col]) ? DB[col] : []; if (!DB[col].some(y => itemId(col, y) === id)) DB[col].push(x); }
  (itConhecidos[col] = itConhecidos[col] || new Set()).add(id);
  return true;
}
/* compara com a SOMBRA e poe na FILA so o que mudou (e o que sumiu vira apagado) */
function itEnfileirar() {
  if (!itPronto() || !itEmDia()) return 0;
  const sombra = itLe(IT_SOMBRA, {}), fila = itLe(IT_FILA, {});
  let n = 0, adotou = 0;
  for (const col of ITENS_COLS) {
    const s = sombra[col] = sombra[col] || {}, vivos = new Set(), conhe = itConhecidos[col] = itConhecidos[col] || new Set();
    for (const [id, x] of itensDe(col)) {
      vivos.add(id); conhe.add(id); const j = JSON.stringify(x);
      if (s[id] !== j) { s[id] = j; fila[col + '\u0001' + id] = { colecao: col, id, dados: x, apagado: false }; n++; }
    }
    for (const id of Object.keys(s)) if (!vivos.has(id)) {
      if (!conhe.has(id)) { if (itAdota(col, id, s[id])) adotou++; continue; }   /* veio de outra janela: fica */
      let ult = {}; try { ult = JSON.parse(s[id]) || {}; } catch (e) {}
      delete s[id]; conhe.delete(id); fila[col + '\u0001' + id] = { colecao: col, id, dados: ult, apagado: true }; n++;
    }
  }
  if (adotou) try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
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
  const sombra = itLe(IT_SOMBRA, {}), fila = itLe(IT_FILA, {});
  let mudou = 0;
  for (const l of linhas) {
    const col = l.colecao; if (!ITENS_COLS.includes(col)) continue;
    /* o que este aparelho mexeu e ainda nao subiu vale mais que a copia do banco */
    if (fila[col + '\u0001' + l.id]) continue;
    /* RESGATE (26/10/2026): "apagado" SEM conteúdo veio do defeito das duas janelas
       (o apagar de verdade agora leva o conteúdo junto). Se este aparelho ainda tem
       o registro, ele NÃO apaga: devolve para o banco. */
    if (l.apagado && String(l.atualizado_em || '') >= '2026-10-24' && (!l.dados || !Object.keys(l.dados).length)) {
      const local = ITENS_DIC.includes(col) ? (DB[col] || {})[l.id] : (Array.isArray(DB[col]) ? DB[col] : []).find(x => itemId(col, x) === l.id);
      if (local) { fila[col + '\u0001' + l.id] = { colecao: col, id: l.id, dados: local, apagado: false }; itGrava(IT_FILA, fila); itResgatados++; continue; }
    }
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
  itConhecer();
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
/* DB sem a marca = aparelho novo, navegador limpo, "Sincronizar de novo" ou
   a primeira abertura com esta versao (a chave antiga nao vale: o DB pode ter
   sido trocado com ela "em dia"). A sombra e a marca de leitura que sobraram
   nao valem mais nada: zera e rele o banco inteiro. Sem isto, a sombra cheia
   + DB vazio virava "ela apagou tudo" no primeiro envio. Da fila so fica o
   que ainda e igual no DB de agora (o que ela mexeu sem rede e nao subiu);
   apagado e coisa de um DB que nao existe mais vao embora. */
function itRecomecar() {
  const fila = itLe(IT_FILA, {}), atual = {}, resto = {};
  for (const col of ITENS_COLS) for (const [id, x] of itensDe(col)) atual[col + '\u0001' + id] = JSON.stringify(x);
  /* 26/10/2026: o que só estava na FILA (feito sem rede/sem sessão) e o DB novo nem tem
     também fica — é trabalho dela que nunca subiu. Antes ia para o lixo sem volta. Só sai
     da fila o que o DB novo tem DIFERENTE (o DB de agora é mais novo) e os "apagado". */
  for (const [k, l] of Object.entries(fila)) if (l && !l.apagado && (atual[k] === undefined || atual[k] === JSON.stringify(l.dados))) resto[k] = l;
  itGrava(IT_SOMBRA, {}); itGrava(IT_MARCA, ''); itGrava(IT_FILA, resto);
  try { localStorage.removeItem(IT_EMDIA_VELHO); } catch (e) {}
}
/* O RITUAL DE ABRIR: le o banco (insistindo — o plano gratis dorme), junta o
   que este aparelho tinha e o banco nao, e so entao passa a mandar. */
async function itSincronizarAoAbrir() {
  if (!itPronto()) return { ok: false };
  if (!itEmDia()) itRecomecar();
  let r = { ok: false };
  for (let k = 0; k < 3 && !r.ok; k++) { r = await itPuxar(); if (!r.ok) await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); }
  if (!r.ok) return r;
  /* banco lido: agora sim o texto antigo dos orçamentos vira o de hoje (v1.94) */
  if (typeof Precos !== 'undefined' && Precos.migraTextos) try { Precos.migraTextos(); } catch (e) {}
  if (!itEmDia()) {
    /* primeira leitura deste DB: o que so ele tinha sobe (junta, nao troca) */
    DB._itensEmDia = true;
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
  }
  itEnfileirar();
  await itEnviarFila();
  return { ok: true, n: r.n };
}
/* depois de qualquer gravacao: enfileira e manda em ~1 s */
let itT = null;
function itAgendar() {
  if (!itPronto() || !itEmDia()) return;
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
/* de 25 em 25 s, e quando a internet volta (nunca depender so do aviso na hora).
   O relogio tambem pega o que foi gravado sem passar pelo save(), e refaz o
   ritual de abrir se o DB perdeu a marca no meio do caminho. */
let itRelogio = null;
/* outra janela gravou: esta janela passa a olhar o MESMO DB (nunca fica com o velho) */
if (typeof addEventListener === 'function') addEventListener('storage', (e) => {
  if (e.key !== DB_KEY || !e.newValue) return;
  try {
    const novo = JSON.parse(e.newValue); if (!novo || !novo.tours) return;
    DB = novo; if (typeof fillSettings === 'function') DB.settings = fillSettings(DB.settings);
    itConhecer();
    const ae = document.activeElement, digitando = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if (!digitando && typeof route === 'function') route();
  } catch (err) {}
});
function itLigar(onChange) {
  if (itRelogio || !itPronto()) return;
  itConhecer();
  itSincronizarAoAbrir().then(r => { if (r.ok && r.n && onChange) onChange(r); });
  itRelogio = setInterval(async () => {
    if (!itPronto()) return;
    if (!itEmDia()) { const r0 = await itSincronizarAoAbrir(); if (r0.ok && r0.n && onChange) onChange(r0); return; }
    itEnfileirar(); await itEnviarFila();
    const r = await itPuxar(); if (r.ok && r.n && onChange) onChange(r);
  }, 25000);
  if (typeof addEventListener === 'function') addEventListener('online', () => { itEnfileirar(); itEnviarFila(); });
}
