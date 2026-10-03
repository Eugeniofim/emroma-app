/* =====================================================
   APP-GUIA — nuvem (Supabase)
   O que sincroniza:
   - appstate  → passeios, regras, datas, cupons, ajustes (1 doc)
   - bookings  → reservas (linha a linha, à prova de corrida)
   Offline: tudo continua funcionando; fila local reenvia.
   ===================================================== */
'use strict';

/* O endereco do banco NAO mora aqui: vem de config.js, carregado antes.
   Assim a mesma base serve qualquer guia, e testes/limpa.test.js garante
   que nenhum banco fica gravado no codigo. */
const SUPA_URL = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.supabaseUrl) || '';
const SUPA_KEY = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.supabaseKey) || '';
/* CADA APP COM A SUA FILA (03/10): no mesmo endereço moram os apps de demonstração, e a fila com
   nome comum ('vi_queue_v1') deixava uma reserva de TESTE deles subir para o banco dela quando o app
   dela, logado, esvaziava a fila. Agora: 'ingrid_fila_envio_v1'. Da fila antiga só vem o que é
   DESTE app (a reserva que existe nos dados dela, ou o catálogo) — o resto fica lá, quieto. */
const QUEUE_KEY = (typeof DB_KEY === 'string' && DB_KEY !== 'vi_db_v1') ? DB_KEY.replace('_db_', '_fila_envio_') : 'vi_queue_v1';
(function () {
  if (QUEUE_KEY === 'vi_queue_v1') return;
  try {
    const velha = JSON.parse(localStorage.getItem('vi_queue_v1') || '[]'); if (!Array.isArray(velha) || !velha.length) return;
    const ids = new Set(((typeof DB !== 'undefined' && DB && DB.bookings) || []).map(b => b.id));
    const minha = [], resto = [];
    for (const j of velha) {
      const p = String((j && j.path) || ''), id = (j && j.body && (j.body.id || (j.body.data && j.body.data.id))) || decodeURIComponent((p.match(/id=eq\.([^&]+)/) || [])[1] || '');
      ((p.startsWith('appstate') || (p.startsWith('bookings') && id && ids.has(id))) ? minha : resto).push(j);
    }
    if (!minha.length) return;
    let atual = []; try { atual = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (e) {}
    localStorage.setItem(QUEUE_KEY, JSON.stringify(atual.concat(minha)));
    localStorage.setItem('vi_queue_v1', JSON.stringify(resto));
  } catch (e) {}
})();

/* Sem prazo maximo, uma requisicao pendurada trava o app inteiro: foi isso
   que fez o login demorar um minuto. 12s e generoso ate para 3G ruim. */
const REDE_TIMEOUT = 12000;

function supaFetch(path, opts = {}) {
  /* Sem nuvem configurada, nada vai para a rede: a fila local segura tudo,
     como se estivesse offline. E o modo "prototipo" de um cliente novo. */
  if (!SUPA_URL) return Promise.reject(new Error('sem nuvem configurada (config.js)'));
  /* logada, fala como ela; deslogado, fala como visitante */
  const tok = (typeof authToken === 'function' && authToken()) || SUPA_KEY;
  const ctrl = new AbortController();
  const corta = setTimeout(() => ctrl.abort(), REDE_TIMEOUT);
  return fetch(SUPA_URL + '/rest/v1/' + path, {
    signal: ctrl.signal,
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + tok,
      'Content-Type': 'application/json',
      /* Aqui vai um INSERT puro, sem nenhum 'resolution='.
         Qualquer resolution vira UPSERT, e upsert exige permissao de UPDATE —
         que desde a trancada e so da dona. Com o upsert, TODA reserva de
         cliente era recusada pelo banco (42501) e sumia numa fila local:
         o cliente via "Esta reservado" e o guia nunca recebia.
         Conflito de id vira 409 e e tratado como sucesso mais abaixo. */
      Prefer: 'return=minimal',
      ...(opts.headers || {}),
    },
  }).finally(() => clearTimeout(corta));
}

/* ---------- fila offline ---------- */
function qAll() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; } }
function qPush(job) { const q = qAll(); q.push(job); localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
async function qFlush() {
  const q = qAll(); if (!q.length) return;
  const rest = [];
  for (const job of q) {
    /* A fila reenvia o que ficou pendente — mas sem passar pela trava do
       cloudPushState. Um envio de catalogo vazio guardado aqui apagaria os
       passeios dela na primeira vez que a rede voltasse. Descarta. */
    if (job.path && job.path.startsWith('appstate')) {
      const t = job.body && job.body.data && job.body.data.tours;
      if (!t || !t.length) continue;
    }
    try {
      const r = await supaFetch(job.path, { method: job.method, body: JSON.stringify(job.body) });
      if (!r.ok && r.status !== 409) rest.push(job);
    } catch (e) { rest.push(job); }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
}

/* ---------- estado (tudo menos reservas) ---------- */
function statePayload() {
  return { tours: DB.tours, rules: DB.rules, departures: DB.departures,
           blocks: DB.blocks, coupons: DB.coupons, settings: DB.settings };
}
/* A trancada do banco devolve HTTP 200 mesmo quando descarta a escrita:
   quem não é a dona simplesmente não altera nenhuma linha. Se a gente
   confiar no 200, o guia vê "salvo" e perde o trabalho. Por isso
   pedimos o registro de volta e contamos as linhas. */
let cloudRejected = false;
async function patchConta(path, body) {
  const r = await supaFetch(path, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, linhas: 0 };
  let linhas = 0;
  try { const j = await r.json(); linhas = Array.isArray(j) ? j.length : 1; } catch (e) { linhas = 1; }
  return { ok: true, linhas };
}

/* ---------- protecao contra perder o que acabou de ser salvo ----------
   O envio e adiado 700ms para nao disparar a cada tecla. Nesse intervalo a
   sincronizacao podia chegar, sobrescrever o DB local com o estado ANTIGO
   da nuvem, e entao o envio adiado publicava justamente esse estado antigo.
   Resultado: o guia adicionava uma data, via "salvo", e a data sumia.
   Enquanto houver alteracao local nao confirmada, a nuvem nao manda mais. */
let alteracaoPendente = false;
let pendenteDesde = 0;
/* A trava existe para proteger o que ela ACABOU de digitar. Mas antes ela so
   era liberada quando um envio dava certo — e se o envio falhasse de vez
   (deslogada, sem rede, recusa do banco) o aparelho ignorava a nuvem PARA
   SEMPRE e ficava exibindo uma copia velha. Depois de um minuto, ou o envio
   funcionou ou nao vai funcionar: mostrar o estado real vale mais. */
const PENDENTE_MAX = 60e3;
function seguraNuvem() {
  if (!alteracaoPendente) return false;
  if (Date.now() - pendenteDesde > PENDENTE_MAX) return false;
  return true;
}
function temAlteracaoPendente() { return alteracaoPendente; }

/* So depois de uma leitura bem-sucedida da nuvem sabemos o que ela tem.
   Antes disso, o que esta neste aparelho nao e fonte de verdade. */
let nuvemJaCarregada = false;

let pushT = null;
function cloudPushState() {
  /* Modo prototipo: nao existe nuvem. Sem esta saida, cada edicao do prospect
     cairia no catch e empilharia um item na fila do localStorage, para sempre. */
  if (!SUPA_URL) return;
  /* TRAVA CONTRA PERDA TOTAL
     Aparelho sem passeio nenhum + nuvem ainda nao lida = navegador recem
     limpo, nao "ela apagou tudo". Publicar isso apagaria o catalogo dela.
     Depois que a nuvem foi lida uma vez, ela pode apagar de verdade. */
  if (!nuvemJaCarregada && !DB.tours.length) return;
  if (!alteracaoPendente) pendenteDesde = Date.now();
  alteracaoPendente = true;              /* marca JA, nao daqui a 700ms */
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    const body = { data: statePayload(), updated_at: new Date().toISOString() };
    try {
      const r = await patchConta('appstate?id=eq.1', body);
      if (!r.ok) { qPush({ path: 'appstate?id=eq.1', method: 'PATCH', body }); return; }
      if (r.linhas === 0) {                 /* o banco recusou em silêncio */
        cloudRejected = true;
        if (typeof onCloudRejected === 'function') onCloudRejected();
        return;                             /* segue pendente: nao foi salvo */
      }
      cloudRejected = false;
      alteracaoPendente = false;            /* agora sim a nuvem tem o que temos */
      lastStamp = body.updated_at;          /* evita reler o que nos mesmos escrevemos */
    } catch (e) { qPush({ path: 'appstate?id=eq.1', method: 'PATCH', body }); }
  }, 700);
}

/* ---------- reservas ----------
   Distinguir "ainda nao subiu" de "foi apagada na nuvem". Sem isso, o
   merge do cloudPull tratava tudo que faltava na nuvem como pendente e
   ressuscitava para sempre o que o guia apagou. */
/* Migracao unica: aparelhos que ja estao em uso tem reservas sem a marca.
   Tratar todas como pendentes manteria os fantasmas para sempre. Reserva
   com mais de uma hora ja teve tempo de subir — e se de fato nao subiu, a
   fila (vi_queue_v1) reenvia por conta propria. */
function migraMarcaDeSincronia() {
  if (localStorage.getItem('vi_migr_naNuvem') === '1') return;
  const limite = Date.now() - 3600e3;
  let mexeu = false;
  for (const b of DB.bookings) {
    if (b.naNuvem === undefined) {
      b.naNuvem = !b.createdAt || new Date(b.createdAt).getTime() < limite;
      mexeu = true;
    }
  }
  if (mexeu) localStorage.setItem(DB_KEY, JSON.stringify(DB));
  localStorage.setItem('vi_migr_naNuvem', '1');
}

function marcaSincronizada(id) {
  const b = DB.bookings.find(x => x.id === id);
  if (b && !b.naNuvem) { b.naNuvem = true; localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
}

async function cloudPushBooking(b) {
  const body = { id: b.id, data: b };
  try {
    const r = await supaFetch('bookings', { method: 'POST', body: JSON.stringify(body) });
    /* 409 = ja existe. Para nos isso e sucesso, nao motivo para reenviar sempre. */
    if (!r.ok && r.status !== 409) { qPush({ path: 'bookings', method: 'POST', body }); return { ok: false }; }
    marcaSincronizada(b.id);
    return { ok: true };
  } catch (e) { qPush({ path: 'bookings', method: 'POST', body }); return { ok: false }; }
}
async function cloudUpdateBooking(b) {
  const body = { data: b };
  const path = 'bookings?id=eq.' + encodeURIComponent(b.id);
  try {
    const r = await patchConta(path, body);
    if (!r.ok) return qPush({ path, method: 'PATCH', body });
    /* 0 linhas logo depois de criar: o POST da reserva pode nao ter chegado ainda
       (corrida). Tenta de novo (1s, 3s, 8s) antes de achar que foi recusado — senao
       o sinal/pagamentos gravados logo apos criar se perdiam na proxima leitura. */
    if (r.linhas === 0) {
      const n = (cloudUpdateBooking._t[b.id] || 0) + 1; cloudUpdateBooking._t[b.id] = n;
      if (n <= 3) { setTimeout(() => cloudUpdateBooking(Bookings.get(b.id) || b), [1000, 3000, 8000][n - 1]); return; }
      delete cloudUpdateBooking._t[b.id];
      cloudRejected = true;
      if (typeof onCloudRejected === 'function') onCloudRejected();
    } else delete cloudUpdateBooking._t[b.id];
  } catch (e) { qPush({ path, method: 'PATCH', body }); }
}
cloudUpdateBooking._t = {};

/* ---------- puxar tudo ---------- */
let lastBookingIds = null;
let lastStamp = null;
async function cloudPull() {
  try {
    migraMarcaDeSincronia();
    await qFlush();
    const logged = typeof isLoggedIn === 'function' && isLoggedIn();
    if (logged && typeof authEnsure === 'function') await authEnsure();

    /* Com fotos de parada, o estado passa de 1 MB. Baixar isso a cada 25s
       queimaria o plano dela e a internet do celular à toa. Primeiro
       perguntamos só a data da última alteração — se não mudou, paramos aqui. */
    if (lastStamp && !logged) {
      try {
        const hR = await supaFetch('appstate?id=eq.1&select=updated_at', { headers: { Prefer: '' } });
        if (hR.ok) {
          const h = (await hR.json())[0];
          if (h && h.updated_at === lastStamp) return { ok: true, semMudanca: true };
        }
      } catch (e) { /* sem rede: segue para o caminho normal */ }
    }

    const [stR, bkR, scR] = await Promise.all([
      supaFetch('appstate?id=eq.1&select=data,updated_at', { headers: { Prefer: '' } }),
      logged ? supaFetch('bookings?select=data&order=created_at.asc', { headers: { Prefer: '' } })
             : Promise.resolve({ ok: true, json: async () => [] }),
      /* visitante só enxerga a contagem de lugares, nunca os dados de quem reservou */
      logged ? Promise.resolve({ ok: true, json: async () => [] })
             : supaFetch('seat_counts?select=*', { headers: { Prefer: '' } }),
    ]);
    /* Os passeios sao publicos; as reservas sao privadas. Antes, se a busca
       das reservas falhasse (sessao expirada, por exemplo), a funcao abortava
       e NAO aplicava nem os passeios — o painel ficava vazio como se ela nao
       tivesse nada. Uma coisa nao pode derrubar a outra. */
    if (!stR.ok) return { ok: false };
    const st = (await stR.json())[0];
    if (st) lastStamp = st.updated_at;

    const reservasOk = bkR.ok;
    let bk = [];
    if (reservasOk) { try { bk = (await bkR.json()).map(r => r.data); } catch (e) { bk = []; } }
    if (!logged && scR.ok) {
      try { DB.seatCounts = (await scR.json()).map(r =>
        ({ tourId: r.tour_id, date: r.date, time: r.time, pax: +r.pax })); } catch (e) {}
    }

    const cloudEmpty = !st || !st.data || !st.data.tours || !st.data.tours.length;
    if (cloudEmpty) {
      /* Nuvem vazia costuma ser primeira vez — mas tambem acontece logo apos
         uma limpeza intencional. Se este aparelho tambem esta vazio, nao ha
         nada a restaurar; sem isto, um celular esquecido aberto ressuscitava
         tudo que ela tinha acabado de apagar no laptop. */
      if (!DB.tours.length && !DB.bookings.length) return { ok: true, vazio: true };
      cloudPushState();
      for (const b of DB.bookings) cloudPushBooking(b);
      return { ok: true, bootstrap: true };
    }

    /* Se ha alteracao local esperando subir, a nuvem NAO manda: aplicar o
       estado remoto aqui apagaria o que o guia acabou de fazer. */
    if (seguraNuvem()) return { ok: true, segurando: true };

    /* nuvem manda */
    const keepLang = DB.settings.lang;
    Object.assign(DB, {
      tours: st.data.tours || [], rules: st.data.rules || [],
      departures: st.data.departures || [], blocks: st.data.blocks || [],
      coupons: st.data.coupons || [],
      /* a nuvem pode ser mais antiga que o app: completa o que faltar */
      settings: fillSettings({ ...st.data.settings, lang: keepLang,
                  tutorialClient: DB.settings.tutorialClient, tutorialAdm: DB.settings.tutorialAdm }),
    });
    /* reservas: nuvem + locais que ainda não subiram.
       Se a busca das reservas falhou, mantemos as que ja estao no aparelho —
       apagar por causa de um erro de rede seria pior. */
    if (logged && reservasOk) {
      const cloudIds = new Set(bk.map(b => b.id));
      /* Se a reserva ja confirmou subida e agora nao esta mais la, ela foi
         APAGADA — nao e pendente. Reinserir seria desfazer a exclusao. */
      const aindaNaoSubiu = DB.bookings.filter(b => !cloudIds.has(b.id) && !b.naNuvem);
      bk.forEach(b => { b.naNuvem = true; });
      DB.bookings = bk.concat(aindaNaoSubiu);
      /* reserva antiga com o texto "Guia Roma — … · 4 pessoas" → o de hoje (v1.94) */
      if (typeof Precos !== 'undefined' && Precos.migraTextos) try { Precos.migraTextos({ reservas: true }); } catch (e) {}
    }
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    nuvemJaCarregada = true;   /* agora sim sabemos o que a nuvem tem */

    /* aviso de reserva nova (para o guia, no ADM) */
    let fresh = [];
    if (reservasOk) {
      if (lastBookingIds) fresh = bk.filter(b => !lastBookingIds.has(b.id));
      lastBookingIds = new Set(bk.map(b => b.id));
    }
    /* passeios chegaram, reservas nao: ela precisa saber que a sessao caiu */
    if (logged && !reservasOk) {
      cloudRejected = true;
      if (typeof onCloudRejected === 'function') onCloudRejected();
    }
    return { ok: true, fresh, semReservas: logged && !reservasOk };
  } catch (e) { return { ok: false }; }
}

/* ---------- relógio de sincronização ---------- */
function cloudStart(onChange) {
  /* Modo prototipo: sem banco, o laco de reconexao ficaria tentando a cada
     15s ate o fim da sessao, sem nunca ter para onde ir. */
  if (!SUPA_URL) return;
  let booted = false;
  const tick = async () => {
    const r = await cloudPull();
    if (r.ok) { booted = true; onChange && onChange(r); }
    return r.ok;
  };
  /* primeira sincronização insiste até conseguir (banco frio, rede lenta) */
  (async () => {
    for (let wait = 1500; !booted; wait = Math.min(wait * 2, 15000)) {
      if (await tick()) break;
      await new Promise(res => setTimeout(res, wait));
    }
  })();
  setInterval(tick, 25000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  addEventListener('online', tick);
}
