/* =====================================================
   APP-GUIA — interface
   Cliente:  #/          hub
             #/tours     vitrine
             #/tour/ID   página + reserva
   Guia:     #/adm/...   painel
   ===================================================== */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- assinatura sonora ----------
   Três sinos e um obturador. Sintetizado na hora,
   não é arquivo — não pesa nada e não precisa carregar.
   O navegador bloqueia som antes de a pessoa tocar na tela; quando isso
   acontecer a gente simplesmente não toca, em vez de insistir. */
function assinaturaSonora() {
  if (localStorage.getItem('vi_som') === 'off') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try { ctx = new AC(); } catch (e) { return; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (ctx.state !== 'running') { ctx.close && ctx.close(); return; }

  const t0 = ctx.currentTime + 0.05;
  const mix = ctx.createGain();
  mix.gain.value = 0.22;                 /* discreto: assinatura, não trilha */
  mix.connect(ctx.destination);

  /* --- sino: fundamental + uma quinta acima, decaimento longo --- */
  const sino = (hz, quando, vol) => {
    [[hz, vol], [hz * 1.5, vol * 0.28], [hz * 2.02, vol * 0.14]].forEach(([f, v]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + quando);
      g.gain.exponentialRampToValueAtTime(v, t0 + quando + 0.012);   /* ataque seco */
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + quando + 2.4); /* cauda de sino */
      o.connect(g); g.connect(mix);
      o.start(t0 + quando); o.stop(t0 + quando + 2.5);
    });
  };

  /* --- obturador: dois estalos curtos de ruído filtrado --- */
  const obturador = (quando) => {
    const dur = 0.05, n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
    [0, 0.028].forEach((atraso, i) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = i ? 2600 : 4200; bp.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.value = i ? 0.30 : 0.42;
      src.connect(bp); bp.connect(g); g.connect(mix);
      src.start(t0 + quando + atraso);
    });
  };

  /* quintas empilhadas — soa a sino, não a toque de celular.
     Os tempos acompanham o desenho da marca. */
  sino(293.66, 0.30, 0.34);   /* ré  — primeira diagonal */
  sino(440.00, 1.00, 0.30);   /* lá  — as vigas descem   */
  sino(659.25, 1.60, 0.26);   /* mi  — a travessa cruza  */
  obturador(2.15);            /* a marca aparece */

  setTimeout(() => { try { ctx.close(); } catch (e) {} }, 6000);
}

/* ---------- abertura ----------
   Aparece uma vez por sessão. Quem só quer reservar não vê a marca
   três vezes seguidas — e um toque pula na hora. */
(function splash() {
  /* a marca da abertura e o titulo da aba vem do config.js */
  const g = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {};
  const marca = g.negocio || g.nome || '';
  if (marca) {
    document.title = marca + (g.nome && g.nome !== marca ? ' — ' + g.nome : '');
    document.documentElement.style.setProperty('--marca-print', JSON.stringify(' — ' + marca + (g.nome ? ' · ' + g.nome : '')));
  }
  const spW = document.getElementById('spWord'); if (spW) spW.textContent = marca;
  const spR = document.getElementById('spRole'); if (spR) spR.textContent = g.badge || g.cidade || '';
  const el = document.getElementById('splash');
  if (!el) return;
  let morta = false;
  const kill = () => { if (!morta) { morta = true; el.remove(); } };
  if (sessionStorage.getItem('vi_seen')) return kill();
  sessionStorage.setItem('vi_seen', '1');
  el.addEventListener('pointerdown', kill);
  /* Antes eu cortava a abertura para 1,25s quando o aparelho pedia menos
     movimento — quem tem essa opcao ligada no iPhone nao via nada. O tempo
     agora e o mesmo para todos; o que muda e o giro, tratado no CSS.
     O som fica de fora: quem pede menos estimulo tambem nao quer barulho. */
  const menosMovimento = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!menosMovimento) assinaturaSonora();
  setTimeout(kill, 4750);
})();

/* ---------- contato (WhatsApp, mapa, agenda, vCard) ---------- */
function waNum() { return (DB.settings.whats || '').replace(/\D/g, ''); }
/* O link do WhatsApp.

   O normal e ter o numero: dai da para mandar a mensagem ja escrita, e e o
   que faz o cliente chegar dizendo "quero o Vaticano dia 12" em vez de "oi".
   Quem so tem o link curto do proprio WhatsApp (wa.me/message/CODIGO) tambem
   funciona — so que o link curto nao aceita texto pronto, entao ali o app
   manda a pessoa sem a mensagem em vez de montar uma URL que nao abre. */
function waLink(text, num) {
  const g = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {};
  const n = num || waNum();
  if (!n && g.whatsLink) return g.whatsLink;
  return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
}
function mapLink(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); }

/* Icones oficiais do Instagram e do WhatsApp (icones de marca, desenho oficial).
   Vetor dentro do arquivo: nao depende de rede nem de fonte de icones. O do
   WhatsApp e o desenho oficial da marca; o do Instagram e o glifo da camera. */
const ICONE_IG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg>';
const ICONE_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
const ICONE_WA_BTN = ICONE_WA.replace('<svg ', '<svg class="wa-ic" ');
/* O campo de horario e livre de proposito: o guia escreve "09h",
   "09h30" ou "10:00 as 18h" — e essa ultima diz mais ao cliente do que
   um horario seco. Mas o arquivo de calendario exige HHMMSS, e
   "10:00 as 18h" gerava um .ics quebrado. Aqui a gente extrai o inicio. */
function horaInicio(txt) {
  const m = String(txt || '').match(/(\d{1,2})\s*(?::|h|H)\s*(\d{2})?/);
  if (!m) return '09:00';
  const h = Math.min(23, parseInt(m[1], 10) || 0);
  const min = Math.min(59, parseInt(m[2] || '0', 10) || 0);
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function icsFor(b, x) {
  const dt = b.date.replace(/-/g, '') + 'T' + horaInicio(b.time).replace(':', '') + '00';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AppGuia//PT', 'BEGIN:VEVENT',
    'UID:' + b.code + '@app-guia', 'DTSTART:' + dt,
    'SUMMARY:' + (x.name[LANG] || x.name.pt) + ' — ' + guiaNome(),
    'LOCATION:' + noIdioma(x.meeting).replace(/,/g, '\\,'),
    'DESCRIPTION:' + (LANG === 'pt' ? 'Código ' : 'Code ') + b.code,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}
function vcfLink() {
  const v = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + guiaNome(),
    'ORG:' + guiaNegocio(), 'TEL;TYPE=CELL:' + DB.settings.whats,
    'URL:' + location.origin + location.pathname,
    'X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/' + DB.settings.insta,
    'END:VCARD'].join('\r\n');
  return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(v);
}

/* ---------- foto: redimensiona no navegador antes de guardar ---------- */
function readImageResized(file, maxW = 1100, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('not image'));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/* ---------- toast ---------- */
const toastEl = document.createElement('div');
toastEl.className = 'toast'; document.body.appendChild(toastEl);
let toastT = null;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3400);
}

/* ---------- tutorial de balões ---------- */
/* O TUTORIAL.

   Era um balao branco sem nenhuma marca: parecia pop-up de propaganda, e o
   Eugenio avisou que dava medo de ser virus. Agora e AMARELO da marca, diz
   "Dica do app" no topo, aponta com uma seta para o botao que explica, e o
   botao explicado ganha um anel pulsando.

   E pode FALAR. O botao "Ouvir" toca a narracao do passo (arquivos em
   audio/, um por passo e idioma). Nunca toca sozinho de primeira — som que
   comeca sem ninguem pedir e exatamente o que parece virus, e o celular
   bloqueia de qualquer jeito. Depois que a pessoa toca "Ouvir" uma vez, os
   proximos passos falam sozinhos (o toque em "Entendi" autoriza). */
const Coach = {
  steps: [], i: 0, el: null, keyFlag: '', voz: false, som: null,
  start(steps, flag) {
    if (!DB.settings[flag]) return;
    this.steps = steps.filter(s => $(s.sel)); this.i = 0; this.keyFlag = flag;
    if (this.steps.length) this.show();
  },
  audio(s) { return s.audio ? `audio/tut-${s.audio}-${LANG === 'en' ? 'en' : 'pt'}.m4a` : ''; },
  fala(s) {
    this.cala();
    const src = this.audio(s); if (!src) return;
    try {
      this.som = new Audio(src);
      const bt = this.el && $('.coach-ouvir', this.el);
      if (bt) bt.classList.add('tocando');
      this.som.onended = () => { if (bt) bt.classList.remove('tocando'); };
      this.som.play().catch(() => { if (bt) bt.classList.remove('tocando'); });
    } catch (e) {}
  },
  cala() { if (this.som) { try { this.som.pause(); } catch (e) {} this.som = null; } },
  show() {
    this.hide();
    const s = this.steps[this.i]; const target = $(s.sel);
    if (!target) return this.next();
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = target.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'coach';
    b.setAttribute('role', 'dialog');
    b.innerHTML = `<div class="coach-top"><span>💡 ${t('tutTitulo')}</span>
        ${this.audio(s) ? `<button class="coach-ouvir" aria-label="${t('tutOuvir')}">🔊 ${t('tutOuvir')}</button>` : ''}</div>
      <div class="coach-txt">${esc(s.txt[LANG] || s.txt.pt)}</div>
      <div class="coach-row">
        <button class="coach-skip">${t('tutSkip')}</button>
        <span class="coach-n">${this.i + 1}/${this.steps.length}</span>
        <button class="coach-next">${t('tutNext')}</button>
      </div>
      <i class="coach-seta" aria-hidden="true"></i>`;
    document.body.appendChild(b);
    const bw = Math.min(290, innerWidth - 20);
    b.style.width = bw + 'px';
    const abaixo = r.bottom + 14 + b.offsetHeight <= innerHeight;
    const top = abaixo ? r.bottom + 14 : Math.max(10, r.top - b.offsetHeight - 14);
    const left = Math.max(10, Math.min(innerWidth - bw - 10, r.left + r.width / 2 - bw / 2));
    b.style.top = top + 'px';
    b.style.left = left + 'px';
    b.classList.add(abaixo ? 'seta-cima' : 'seta-baixo');
    /* a seta aponta para o meio do botao, nao para o meio do balao */
    const seta = $('.coach-seta', b);
    seta.style.left = Math.max(16, Math.min(bw - 30, r.left + r.width / 2 - left - 8)) + 'px';
    target.classList.add('coach-hi');
    this.el = b; this.hiEl = target;
    $('.coach-next', b).onclick = () => this.next();
    $('.coach-skip', b).onclick = () => this.stop(true);
    const ouvir = $('.coach-ouvir', b);
    if (ouvir) ouvir.onclick = () => {
      if (this.som && !this.som.paused) { this.cala(); ouvir.classList.remove('tocando'); return; }
      this.voz = true; this.fala(s);
    };
    if (this.voz) this.fala(s);
  },
  next() { this.i++; if (this.i >= this.steps.length) return this.stop(true); this.show(); },
  hide() { this.cala(); this.el?.remove(); this.el = null; this.hiEl?.classList.remove('coach-hi'); },
  stop(done) {
    this.hide();
    if (this.keyFlag) { DB.settings[this.keyFlag] = false; save(); }
    if (done) toast(t('tutDone'));
  },
};

/* ---------- roteador ---------- */
addEventListener('hashchange', route);
/* Se o hash ja e esse, o navegador NAO dispara hashchange e a tela nao
   redesenha. Era o login que dizia "bem-vindo" e ficava parado: o app
   instalado no celular reabre no ultimo endereco (#/adm/today), mostra o
   login ali mesmo sem mudar o hash, e depois de entrar go('/adm/today')
   nao mudava nada — o evento nunca vinha. Mesmo destino = redesenha na mao. */
function go(h) {
  if (location.hash === '#' + h) route();
  else location.hash = h;
}
function route() {
  Coach.hide();
  const h = location.hash.slice(2) || '';
  const p = h.split('/');
  if (p[0] !== 'adm' && typeof visualAplica === 'function') visualAplica(false);
  document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';
  if (p[0] === 'novasenha') viewNewPass();
  else if (p[0] === 'login') viewLogin();
  else if (p[0] === 'adm') {
    if (DB.settings.authRequired && !isLoggedIn()) return viewLogin('in');
    viewAdm(p[1] || 'today', p[2]);
  }
  else if (p[0] === 'pago')  viewPago(decodeURIComponent((p[1] || '').split('?')[0]));
  else if (p[0] === 'about') viewAbout();
  else if (p[0] === 'avaliacoes') viewAvaliacoes();
  else if (p[0] === 'roteiro') viewRoteiro();
  else if (p[0] === 'pedido') viewPedido();
  else if (p[0] === 'tours') viewShowcase();
  else if (p[0] === 'tour')  viewTour(p[1]);
  else                       viewHub();
  document.body.classList.toggle('em-adm', p[0] === 'adm');
  cestaBarra(p[0]);
  faixaAcimaDaBarra();
  scrollTo(0, 0);
}

/* A faixa do rodape (proposta / demonstracao) e a barra de abas do painel
   ficam as duas presas embaixo no celular — e a faixa, por cima, tapava as
   abas: no painel so aparecia "Hoje". Dentro do painel a faixa sobe e fica
   logo acima da barra. (18/09/2026) */
function faixaAcimaDaBarra() {
  const f = document.querySelector('.protobar'); if (!f) return;
  const rail = document.querySelector('.rail');
  const presaEmbaixo = document.body.classList.contains('em-adm') && rail &&
    getComputedStyle(rail).position === 'fixed';
  f.style.bottom = presaEmbaixo ? rail.offsetHeight + 'px' : '0px';
}
addEventListener('resize', faixaAcimaDaBarra);

/* barra de idioma do cliente */
function langBar(cls) {
  return `<div class="langs ${cls || ''}">
    <button data-lang="pt" class="${LANG === 'pt' ? 'on' : ''}" lang="pt" aria-label="Português">PT</button>
    <span class="langsep" aria-hidden="true">|</span>
    <button data-lang="en" class="${LANG === 'en' ? 'on' : ''}" lang="en" aria-label="English">EN</button></div>`;
}
function bindLang(root) {
  $$('[data-lang]', root).forEach(b => b.onclick = () => { setLang(b.dataset.lang); route(); });
}

/* =====================================================
   CLIENTE
===================================================== */
/* A PRIMEIRA TELA — o "link na bio" dela.

   Hoje o Instagram dela aponta para um Beacons com WhatsApp, transfer,
   hotel, chip, seguro, YouTube e blog. Esta tela faz o mesmo papel, com
   uma diferenca que vale o app inteiro: aqui o cliente RESERVA, ve o preco
   do transfer na hora e pede o roteiro personalizado — no Beacons tudo
   termina num "fale no WhatsApp". Os links de parceiros e as redes saem
   dos Ajustes: ela troca sem precisar de nos. */
const ICONE_YT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"/></svg>';
const ICONE_FB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/></svg>';
const ICONE_BLOG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>';

function linkExterno(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }

function viewHub() {
  const st = DB.settings;
  const txt = (o) => (o && (o[LANG] || o.pt)) || '';
  const redes = [
    st.insta    ? { u: 'https://instagram.com/' + st.insta.replace(/^@/, ''), ic: ICONE_IG, n: 'Instagram', c: 'ig' } : null,
    linkExterno(st.youtube)  ? { u: st.youtube,  ic: ICONE_YT,   n: 'YouTube',  c: 'yt' } : null,
    linkExterno(st.blog)     ? { u: st.blog,     ic: ICONE_BLOG, n: 'Blog',     c: 'bl' } : null,
    linkExterno(st.facebook) ? { u: st.facebook, ic: ICONE_FB,   n: 'Facebook', c: 'fb' } : null,
  ].filter(Boolean);
  const temTransfer = Tours.live().some(x => x.type === 'transfer');
  const links = (st.links || []).filter(l => linkExterno(l.url) && txt(l.titulo));

  app.innerHTML = `
  <div class="hub">
    <div class="hub-bg" style="background-image:url(${esc(st.homePhoto || 'home.jpg')})"></div>
    <div class="hub-in">
      <div class="vcard">
        <div class="hub-brand">${logoFull({ mark: 46, sub: esc(guiaBase()) })}</div>
        <p class="tagline">${esc(noIdioma(st.homeText) || t('tagline'))}</p>
        ${redes.length ? `<div class="redes" aria-label="${t('hubRedes')}">${redes.map(r =>
          `<a class="rede ${r.c}" href="${esc(r.u)}" target="_blank" rel="noopener" aria-label="${r.n}" title="${r.n}">${r.ic}</a>`).join('')}</div>` : ''}
        ${langBar('center')}
      </div>
      <button class="lk main" id="goTours">
        <span class="ic">📍</span><span><b>${t('seeTours')}</b><small>${t('seeToursSub')}</small></span><span class="go" aria-hidden="true">→</span>
      </button>
      ${temTransfer ? `<button class="lk" id="goTransfer">
        <span class="ic">🚘</span><span><b>${t('hubTransfer')}</b><small>${t('hubTransferSub')}</small></span><span class="go" aria-hidden="true">→</span>
      </button>` : ''}
      <button class="lk" id="goRoteiro">
        <span class="ic">🗺️</span><span><b>${t('hubRoteiro')}</b><small>${t('hubRoteiroSub')}</small></span><span class="go" aria-hidden="true">→</span>
      </button>
      <button class="lk" id="goAbout">
        <span class="ic"><img id="hubFace" src="${esc(st.photo || 'guia.jpg')}" alt=""
          style="width:34px;height:34px;border-radius:50%;object-fit:cover;object-position:center 20%"></span><span><b>${t('aboutLink')}</b><small>${t('aboutLinkSub')}</small></span><span class="go" aria-hidden="true">→</span>
      </button>
      ${typeof Avaliacoes !== 'undefined' && (Avaliacoes.all().length || linkExterno(st.linkAvaliacao) || DB.demo) ? `<button class="lk" id="goAval">
        <span class="ic">⭐</span><span><b>${t('hubAval')}</b><small>${Avaliacoes.media() ? `${String(Avaliacoes.media()).replace('.', ',')} ★ · ${Avaliacoes.all().length} ${LANG === 'en' ? (Avaliacoes.all().length === 1 ? 'review' : 'reviews') : (Avaliacoes.all().length === 1 ? 'avaliação' : 'avaliações')}` : t('hubAvalSub')}</small></span><span class="go" aria-hidden="true">→</span>
      </button>` : ''}
      <a class="lk" href="${waLink(t('waHello'))}" target="_blank" rel="noopener"><span class="ic wa">${ICONE_WA}</span><span><b>${t('whatsapp')}</b><small>${t('hubWhatsSub')}</small></span><span class="go" aria-hidden="true">→</span></a>
      ${links.length ? `<p class="hubsec">${t('hubViagem')}</p>
      ${links.map(l => `<a class="lk parc" href="${esc(l.url)}" target="_blank" rel="noopener sponsored">
        <span class="ic">${esc(l.icone || '🔗')}</span><span><b>${esc(txt(l.titulo))}</b>${txt(l.sub) ? `<small>${esc(txt(l.sub))}</small>` : ''}</span><span class="go" aria-hidden="true">↗</span></a>`).join('')}` : ''}
      <button class="adm-entry" id="admEntry">🔒 ${t('admEntry')}</button>
    </div>
  </div>`;
  bindLang(app);
  $('#goTours').onclick = () => { viewShowcase._f = 'all'; go('/tours'); };
  if ($('#goTransfer')) $('#goTransfer').onclick = () => { viewShowcase._f = 'transfer'; go('/tours'); };
  $('#goRoteiro').onclick = () => go('/roteiro');
  fallbackPhoto($('#hubFace'), '☺');
  $('#goAbout').onclick = () => go('/about');
  if ($('#goAval')) $('#goAval').onclick = () => go('/avaliacoes');
  $('#admEntry').onclick = () => go('/adm/today');
  Coach.start([
    { sel: '#goTours',  audio: 'hub-1', txt: { pt: 'Seu cliente começa aqui: toca e vê todos os passeios com datas reais.', en: 'Your guest starts here: all tours with live dates.' } },
    { sel: '#admEntry', audio: 'hub-2', txt: { pt: 'E esta é a SUA porta, ' + guiaNome() + ' — o painel onde você controla tudo.', en: 'And this is YOUR door, ' + guiaNome() + ' — the panel where you control everything.' } },
  ], 'tutorialClient');
}

/* MONTE SEU ROTEIRO — o passeio personalizado.

   Ela disse no audio que o personalizado "nao tem como colocar no
   aplicativo" e que faz a parte. Certo: o app nao monta o roteiro. O que
   ele faz e a parte chata — perguntar datas, quantas pessoas, idades, o
   que a pessoa gosta — e entregar TUDO de uma vez no WhatsApp dela, ja
   organizado. Ela para de arrancar informacao a conta-gotas e comeca a
   conversa sabendo o que propor.

   O pedido tambem fica guardado no painel (Reservas → Pedidos de roteiro). */
const ROTEIRO_ONDE = [
  ['roma', 'Roma', 'Rome'], ['toscana', 'Toscana', 'Tuscany'], ['amalfi', 'Costa Amalfitana', 'Amalfi Coast'],
  ['capri', 'Capri', 'Capri'], ['pompeia', 'Pompeia e Nápoles', 'Pompeii & Naples'],
  ['umbria', 'Assis e Úmbria', 'Assisi & Umbria'], ['castelli', 'Tivoli e Castelli Romani', 'Tivoli & Castelli Romani'],
  ['florenca', 'Florença', 'Florence'], ['veneza', 'Veneza', 'Venice'], ['milao', 'Milão', 'Milan'],
];
const ROTEIRO_GOSTO = [
  ['historia', 'História e arqueologia', 'History & archaeology'], ['arte', 'Arte e museus', 'Art & museums'],
  ['fe', 'Fé: Vaticano e basílicas', 'Faith: Vatican & basilicas'], ['comida', 'Comida e vinho', 'Food & wine'],
  ['compras', 'Compras', 'Shopping'], ['natureza', 'Natureza, lagos e praias', 'Nature, lakes & beaches'],
  ['fotos', 'Lugares para fotos', 'Photo spots'], ['criancas', 'Programas com crianças', 'Kid-friendly'],
  ['noite', 'Roma à noite', 'Rome at night'],
];
const ROTEIRO_PRECISA = [
  ['transfer', 'Transfer (aeroporto, porto, estação)', 'Transfers (airport, port, station)'],
  ['motorista', 'Motorista por vários dias', 'A driver for several days'],
  ['ingressos', 'Ajuda com ingressos', 'Help with tickets'], ['hotel', 'Dica de hotel', 'Hotel tips'],
  ['papal', 'Audiência Papal', 'Papal Audience'],
];
/* "Crie seu roteiro com consultoria de especialista": para quem NAO quer
   guia e paga pela experiencia dela para passear sozinho. */
const ROTEIRO_MODO = [
  ['guia', 'Com guia particular', 'With a private guide'],
  ['consultoria', 'Sozinho, com roteiro de especialista (consultoria)', 'On my own, with a specialist route (consulting)'],
  ['nao-sei', 'Ainda não sei', 'Not sure yet'],
];
const ROTEIRO_RITMO = [['calmo', 'Tranquilo', 'Relaxed'], ['medio', 'Equilibrado', 'Balanced'], ['intenso', 'Ver tudo que der', 'See as much as possible']];

/* A mensagem que chega no WhatsApp dela: uma ficha, nao um "oi". Sai no
   idioma de quem pediu, com as datas por extenso. */
function msgRoteiro(ped) {
  const en = ped.lang === 'en';
  const nome = (lista, v) => { const o = lista.find(z => z[0] === v); return o ? (en ? o[2] : o[1]) : v; };
  const d = (iso) => iso ? fmtDate(iso) : '';
  const L = [];
  L.push(en ? 'Hi ' + guiaNome() + '! I would like a tailor-made trip:' : 'Olá, ' + guiaNome() + '! Quero montar um roteiro personalizado:');
  L.push('');
  if (ped.modo) L.push((en ? '🧭 How: ' : '🧭 Como: ') + nome(ROTEIRO_MODO, ped.modo));
  if (ped.ini || ped.fim) L.push((en ? '🗓 Dates: ' : '🗓 Datas: ') + [d(ped.ini), d(ped.fim)].filter(Boolean).join(' → '));
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  L.push((en ? '👥 Group: ' : '👥 Grupo: ')
    + plural(ped.adultos, en ? 'adult' : 'adulto', en ? 'adults' : 'adultos')
    + (ped.criancas ? ', ' + plural(ped.criancas, en ? 'child' : 'criança', en ? 'children' : 'crianças')
      + (ped.idades ? ' (' + ped.idades + ')' : '') : ''));
  const onde = ped.onde.map(v => nome(ROTEIRO_ONDE, v)).concat(ped.ondeOutro ? [ped.ondeOutro] : []);
  if (onde.length) L.push((en ? '📍 Where: ' : '📍 Onde: ') + onde.join(', '));
  if (ped.gosto.length) L.push((en ? '❤️ Likes: ' : '❤️ Gosta de: ') + ped.gosto.map(v => nome(ROTEIRO_GOSTO, v)).join(', '));
  if (ped.ritmo) L.push((en ? '⏱ Pace: ' : '⏱ Ritmo: ') + nome(ROTEIRO_RITMO, ped.ritmo));
  if (ped.precisa.length) L.push((en ? '🧳 Needs: ' : '🧳 Precisa de: ') + ped.precisa.map(v => nome(ROTEIRO_PRECISA, v)).join(', '));
  if (ped.obs) { L.push(''); L.push(ped.obs); }
  L.push('');
  L.push('— ' + ped.nome + (ped.email ? ' · ' + ped.email : '') + (ped.whats ? ' · ' + ped.whats : ''));
  return L.join('\n');
}

function viewRoteiro() {
  const R = viewRoteiro._s = viewRoteiro._s || { onde: [], gosto: [], precisa: [], ritmo: 'medio', adultos: 2, criancas: 0 };
  const nm = (o) => LANG === 'en' ? o[2] : o[1];
  const chips = (grupo, lista) => lista.map(o =>
    `<button type="button" class="chip ${R[grupo].includes(o[0]) ? 'on' : ''}" data-g="${grupo}" data-v="${o[0]}">${esc(nm(o))}</button>`).join('');
  app.innerHTML = `
  <header class="topbar">
    <button class="backbtn" id="bk" aria-label="${t('back')}">←</button>
    <span class="tbrand">${logoMark(24, 'var(--brand-assinatura)')}<b>${esc(guiaNome())}</b></span>
    ${langBar('right')}
  </header>
  <main class="wrap roteiro">
    <h1 class="pageh">${t('rtTit')}</h1>
    <p class="rtintro">${t('rtIntro')}</p>

    <section class="rtbloco"><h3>${LANG === 'en' ? 'How do you want to explore?' : 'Como você quer conhecer?'}</h3>
      <div class="chips">${ROTEIRO_MODO.map(o => `<button type="button" class="chip ${R.modo === o[0] ? 'on' : ''}" data-modo="${o[0]}">${esc(nm(o))}</button>`).join('')}</div>
      ${R.modo === 'consultoria' ? `<small class="why">${LANG === 'en' ? 'You explore on your own, with a route made by a specialist for you: which streets, where to eat, what to skip — vegan, lactose-free, the best gelato...' : 'Você passeia sozinho, com um roteiro feito por uma especialista para você: por onde ir, onde comer, o que evitar — vegano, sem lactose, o melhor tiramisù, tour de sorvete...'}</small>` : ''}
    </section>

    <section class="rtbloco"><h3>${t('rtQuando')}</h3>
      <div class="frow">
        <label class="fld">${t('rtChega')}<input type="date" id="rtIni" value="${esc(R.ini || '')}"></label>
        <label class="fld">${t('rtSai')}<input type="date" id="rtFim" value="${esc(R.fim || '')}"></label>
      </div>
    </section>

    <section class="rtbloco"><h3>${t('rtQuem')}</h3>
      <div class="paxrow"><span><b>${t('adultsLbl')}</b><small>${t('adultsSub')}</small></span>
        <div class="pm"><button type="button" data-rc="adultos" data-d="-1">−</button><span>${R.adultos}</span><button type="button" data-rc="adultos" data-d="1">+</button></div></div>
      <div class="paxrow"><span><b>${t('kidsLbl')}</b><small>${t('kidsSub')}</small></span>
        <div class="pm"><button type="button" data-rc="criancas" data-d="-1">−</button><span>${R.criancas}</span><button type="button" data-rc="criancas" data-d="1">+</button></div></div>
      ${R.criancas ? `<label class="fld">${t('rtIdades')}<input id="rtIdades" value="${esc(R.idades || '')}" placeholder="${t('rtIdadesPh')}"></label>` : ''}
    </section>

    <section class="rtbloco"><h3>${t('rtOnde')}</h3><small class="why">${t('rtVarios')}</small>
      <div class="chips">${chips('onde', ROTEIRO_ONDE)}</div>
      <label class="fld">${t('rtOndeOutro')}<input id="rtOndeOutro" value="${esc(R.ondeOutro || '')}"></label>
    </section>

    <section class="rtbloco"><h3>${t('rtGosto')}</h3><small class="why">${t('rtVarios')}</small>
      <div class="chips">${chips('gosto', ROTEIRO_GOSTO)}</div>
    </section>

    <section class="rtbloco"><h3>${t('rtRitmo')}</h3>
      <div class="chips">${ROTEIRO_RITMO.map(o => `<button type="button" class="chip ${R.ritmo === o[0] ? 'on' : ''}" data-ritmo="${o[0]}">${esc(nm(o))}</button>`).join('')}</div>
    </section>

    <section class="rtbloco"><h3>${t('rtPrecisa')}</h3><small class="why">${t('rtVarios')}</small>
      <div class="chips">${chips('precisa', ROTEIRO_PRECISA)}</div>
    </section>

    <section class="rtbloco"><h3>${t('rtConte')}</h3>
      <label class="fld"><textarea id="rtObs" rows="4" placeholder="${t('rtContePh')}">${esc(R.obs || '')}</textarea></label>
    </section>

    <section class="rtbloco"><h3>${t('rtVoce')}</h3>
      <label class="fld">${t('fullName')}<input id="rtNome" autocomplete="name" value="${esc(R.nome || '')}"></label>
      <label class="fld">${t('whatsLbl')}<input id="rtWhats" placeholder="+55 11 …" value="${esc(R.whats || '')}"></label>
      <label class="fld">${t('email')}<input id="rtEmail" type="email" autocomplete="email" value="${esc(R.email || '')}"></label>
    </section>

    <button class="cta" id="rtEnviar">${ICONE_WA_BTN} ${t('rtEnviar')}</button>
    <p class="fine">${t('rtFine')}</p>
  </main>`;
  bindLang(app);
  /* guarda o que ja foi digitado antes de redesenhar: ninguem perde texto
     por ter tocado num chip */
  const guarda = () => {
    R.ini = $('#rtIni').value; R.fim = $('#rtFim').value;
    R.idades = $('#rtIdades') ? $('#rtIdades').value : (R.idades || '');
    R.ondeOutro = $('#rtOndeOutro').value; R.obs = $('#rtObs').value;
    R.nome = $('#rtNome').value; R.whats = $('#rtWhats').value; R.email = $('#rtEmail').value;
  };
  $('#bk').onclick = () => go('/');
  $$('[data-g]').forEach(b => b.onclick = () => {
    guarda();
    const g = R[b.dataset.g], v = b.dataset.v, i = g.indexOf(v);
    if (i >= 0) g.splice(i, 1); else g.push(v);
    viewRoteiro();
  });
  $$('[data-ritmo]').forEach(b => b.onclick = () => { guarda(); R.ritmo = b.dataset.ritmo; viewRoteiro(); });
  $$('[data-modo]').forEach(b => b.onclick = () => { guarda(); R.modo = R.modo === b.dataset.modo ? '' : b.dataset.modo; viewRoteiro(); });
  $$('[data-rc]').forEach(b => b.onclick = () => {
    guarda();
    const k = b.dataset.rc, min = k === 'adultos' ? 1 : 0;
    R[k] = Math.max(min, Math.min(40, R[k] + +b.dataset.d));
    viewRoteiro();
  });
  $('#rtEnviar').onclick = () => {
    guarda();
    if (!R.nome.trim() || !R.whats.trim()) return toast(t('rtFalta'));
    const ped = Roteiros.cria(R);
    window.open(waLink(msgRoteiro(ped)), '_blank');
    viewRoteiro._s = null;
    app.innerHTML = `<main class="wrap roteiro fim">
      <div class="okc">✓</div>
      <h2 class="okh">${t('rtOk')}</h2>
      <p class="hint center">${t('rtOkSub')}</p>
      <a class="cta" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="${waLink(msgRoteiro(ped))}">${ICONE_WA_BTN} ${t('rtReenviar')}</a>
      <button class="cta soft" id="rtVolta">${t('seeTours')}</button>
    </main>`;
    $('#rtVolta').onclick = () => go('/tours');
  };
}

/* --- quem sou eu ---
   Vem antes do preço de propósito: quem confia na pessoa
   aceita melhor o valor. A foto e o texto saem dos Ajustes. */
/* AVALIACOES — so as de verdade, que ela cola no painel (Ajustes) */
function viewAvaliacoes() {
  const st = DB.settings, l = Avaliacoes.all(), m = Avaliacoes.media(), en = LANG === 'en';
  const estrelas = (n) => `<span class="av-est" aria-label="${n} ${en ? 'of 5 stars' : 'de 5 estrelas'}">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
  const deixar = linkExterno(st.linkAvaliacao), verTodas = linkExterno(st.linkAvaliacoesVer) || deixar;
  app.innerHTML = `
  <header class="topbar">
    <button class="backbtn" id="bk" aria-label="${t('back')}">←</button>
    <span class="tbrand">${logoMark(24, 'var(--brand-assinatura)')}<b>${esc(guiaNome())}</b></span>
    ${langBar('right')}
  </header>
  <main class="wrap av-pag">
    <h1>⭐ ${t('hubAval')}</h1>
    ${m ? `<div class="av-media"><b>${String(m).replace('.', ',')}</b>${estrelas(Math.round(m))}<small>${l.length} ${en ? (l.length === 1 ? 'review' : 'reviews') : (l.length === 1 ? 'avaliação' : 'avaliações')}</small></div>` : ''}
    ${l.length ? l.map(a => `<article class="av-card">
        <div class="av-top"><b>${esc(a.nome)}</b>${a.cidade ? `<small>${esc(a.cidade)}</small>` : ''}${estrelas(a.nota)}</div>
        <p>${esc(a.texto).replace(/\n/g, '<br>')}</p>
        <small class="av-pe">${[a.passeio, a.data ? new Date(a.data + 'T12:00:00').toLocaleDateString(en ? 'en-GB' : 'pt-BR', { month: 'long', year: 'numeric' }) : '', a.fonte].filter(Boolean).map(esc).join(' · ')}</small>
      </article>`).join('') : `<p class="empty">${en ? 'Reviews from our guests will appear here soon.' : 'Em breve as avaliações dos clientes aparecem aqui.'}</p>
      ${DB.demo ? '<p class="why">No painel › Ajustes › <b>Avaliações do site</b> você cola as avaliações de verdade (do Google, do WhatsApp) e o link para deixar uma avaliação.</p>' : ''}`}
    <div class="av-bts">
      ${deixar ? `<a class="cta" href="${esc(deixar)}" target="_blank" rel="noopener">⭐ ${en ? 'Leave a review' : 'Deixar a minha avaliação'}</a>` : ''}
      ${verTodas && verTodas !== deixar ? `<a class="lk-mini" href="${esc(verTodas)}" target="_blank" rel="noopener">${en ? 'See all on Google' : 'Ver todas no Google'} ↗</a>` : ''}
    </div>
  </main>`;
  bindLang(app);
  $('#bk').onclick = () => go('/');
}

function viewAbout() {
  const st = DB.settings;
  const bio = (st.bio && (st.bio[LANG] || st.bio.pt)) || '';
  const paras = bio.split(/\n\s*\n/).filter(Boolean);
  const nTours = Tours.live().length;

  app.innerHTML = `
  <header class="topbar">
    <button class="backbtn" id="bk" aria-label="${t('back')}">←</button>
    <span class="tbrand">${logoMark(24, 'var(--brand-assinatura)')}<b>${esc(guiaNome())}</b></span>
    ${langBar('right')}
  </header>
  <main class="wrap about">
    <div class="ab-hero">
      <img class="ab-photo" id="abImg" src="${esc(st.photo || 'guia.jpg')}" alt="${esc(guiaNome())}">
      <div class="ab-cap">
        ${st.badge ? `<span class="ab-badge">✓ ${esc(st.badge)}</span>` : ''}
        <h1>${t('aboutTitle')}</h1>
        <p class="ab-meta">${t('role')}</p>
      </div>
    </div>

    <div class="ab-body">
      ${paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
    </div>

    <div class="ab-facts">
      <div><small>${t('aboutBased')}</small><b>${esc(st.base || '')}</b></div>
      <div><small>${LANG === 'pt' ? 'Idiomas' : 'Languages'}</small><b>${t('aboutLangs')}</b></div>
      <div><small>${LANG === 'pt' ? 'Passeios' : 'Tours'}</small><b>${nTours}</b></div>
    </div>

    <div class="ab-cta">
      <h3>${t('aboutMeet')}</h3>
      <p>${t('aboutMeetSub')}</p>
      <div class="ab-btns">
        <button class="cta" id="abTours">${t('aboutCta')}</button>
        <a class="mini" href="${waLink(t('waHello'))}" target="_blank" rel="noopener">${t('aboutTalk')}</a>
        <a class="mini" href="https://instagram.com/${esc(st.insta)}" target="_blank" rel="noopener">@${esc(st.insta)}</a>
      </div>
    </div>
  </main>`;
  bindLang(app);
  /* sem foto ainda: em vez de um ícone quebrado, diz onde ela põe a dela */
  fallbackPhoto($('#abImg'), `<div class="ab-photo none">${LANG === 'pt'
    ? 'Sua foto entra aqui.<br>Ajustes → Sua foto e sua história.'
    : 'Your photo goes here.<br>Settings → Your photo and your story.'}</div>`);
  $('#bk').onclick = () => go('/');
  $('#abTours').onclick = () => go('/tours');
}

/* A foto pode vir do painel (dataURL) ou de um guia.jpg na pasta.
   Se não houver nenhuma das duas, troca a imagem pelo aviso. */
function fallbackPhoto(img, html) {
  if (!img) return;
  const swap = () => { img.outerHTML = html; };
  img.onerror = swap;
  if (img.complete && img.naturalWidth === 0) swap();
}

const TYPE_LABEL = { day: 'fDay', walk: 'fWalk', photo: 'fPhoto', session: 'tSession', bike: 'fBike',
                     transfer: 'fTransfer', papal: 'fPapal', trem: 'fTrem', conexao: 'fConexao', barco: 'fBarco' };

/* Como o valor se anuncia. Tres modos: por pessoa, por sessao, e a tabela
   por numero de pessoas — nesta ultima o cartao mostra o MENOR valor da
   tabela com "a partir de", porque um valor de grupo sem o "a partir de"
   parece caro para quem viaja em dois. */
function precoVitrine(x) {
  if (x.priceMode === 'transfer') return transferMenor(x) || +x.price || 0;
  return x.priceMode === 'tabela' ? (tabelaMenor(x) || +x.price || 0) : +x.price || 0;
}
function unidadePreco(x) {
  if (x.priceMode === 'transfer') return t('perTrip');
  if (x.priceMode === 'tabela')   return t('perGroup');
  if (x.priceMode === 'session')  return t('perSession');
  return t('perPerson');
}

/* QUEM MAIS VEM NO GRUPO.

   Pedido direto da Ingrid, em audio: hoje ela so registra quem fez a
   reserva. Mas muita gente volta depois por indicacao de alguem que veio
   JUNTO e nunca falou com ela — e essa pessoa nao existe na base. Com os
   nomes aqui, ela passa a saber de onde cada cliente chegou.

   Nada e obrigatorio: um campo em branco nao impede a reserva. */
function grupoLinha() {
  return `<div class="grow">
    <input class="gnome" placeholder="${t('grpName')}" autocomplete="off">
    <input class="gnasc" placeholder="${t('grpBirth')}" inputmode="numeric" maxlength="10" autocomplete="off">
  </div>`;
}
function grupoHtml(quantos) {
  const n = Math.max(0, quantos);
  return `<div class="grupo">
    <b>${t('grpTitle')}</b>
    <small class="why">${t('grpWhy')}</small>
    <div id="grpRows">${Array.from({ length: n }, grupoLinha).join('')}</div>
    <button type="button" class="mini wide" id="grpAdd">${t('grpAdd')}</button>
  </div>`;
}
function lerGrupo() {
  return $$('.grow').map(r => ({
    nome: (r.querySelector('.gnome') || {}).value || '',
    nasc: (r.querySelector('.gnasc') || {}).value || '',
  })).map(g => ({ nome: g.nome.trim(), nasc: g.nasc.trim() })).filter(g => g.nome);
}

/* A TABELA DE PRECOS NAO APARECE MAIS NA PAGINA DO PASSEIO.

   Pedido da Ingrid (18/09/2026): "prefiro que eles vejam somente na hora que
   preenchem quantas pessoas sao e quantos adultos e criancas". O cliente ve
   o "a partir de" no cartao e o valor exato do grupo DELE na reserva. */

/* --- quantas pessoas: adultos e criancas ---
   Ela decide, por passeio, se aceita menores de 18 e se ha idade minima.
   O preco continua pela quantidade TOTAL (e assim que a tabela dela e); a
   separacao serve para ela saber quem vem — ingresso, cadeirinha, ritmo. */
function aceitaCriancas(x) { return x.criancas !== false; }

function tetoPessoas(x, S) {
  if (x.priceMode === 'tabela')   return Math.min(tabelaAte(x) || x.max, x.max, S.cap || x.max);
  if (x.priceMode === 'transfer') return Math.min(transferAte(x) || 20, S.cap || 20);
  return Math.min(x.max, S.cap || x.max);
}

function pessoasHtml(x, S) {
  const cri = aceitaCriancas(x);
  const linha = (k, lbl, sub, v) => `<div class="paxrow">
      <span><b>${lbl}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      <div class="pm"><button data-cnt="${k}" data-d="-1" aria-label="−">−</button><span>${v}</span><button data-cnt="${k}" data-d="1" aria-label="+">+</button></div>
    </div>`;
  return `<div class="pessoas">
    ${linha('a', cri ? t('adultsLbl') : t('peopleLbl'), cri ? t('adultsSub') : '', S.adultos)}
    ${cri ? linha('c', t('kidsLbl'), t('kidsSub'), S.criancas) : ''}
    ${cri && S.criancas ? `<div class="idades">
      <small>${t((x.ingressos || []).length ? 'idadesPorque' : 'idadesTit')}</small>
      <div class="idrow">${Array.from({ length: S.criancas }, (_, i) => `
        <label class="idsel"><span>${t('criancaN', { n: i + 1 })}</span>
          <select data-idade="${i}" aria-label="${t('criancaN', { n: i + 1 })}">
            <option value="">${t('idadePh')}</option>
            ${Array.from({ length: 18 }, (_, k) => `<option value="${k}" ${String(S.idades[i]) === String(k) ? 'selected' : ''}>${k === 0 ? t('menos1') : k + ' ' + (k === 1 ? t('ano') : t('anos'))}</option>`).join('')}
          </select></label>`).join('')}</div>
    </div>` : ''}
    ${!cri ? `<p class="why">${t('noKids')}</p>` : (+x.idadeMin ? `<p class="why">${t('minAge', { n: +x.idadeMin })}</p>` : '')}
  </div>`;
}

/* As linhas dos ingressos no resumo da reserva: quanto, por que, e o aviso
   de que o valor e o minimo (o PDF dela diz que pode subir conforme a
   disponibilidade). */
function ingressosResumo(x, S, ing) {
  if (!(x.ingressos || []).length) return '';
  const falta = S.criancas && Array.from({ length: S.criancas }, (_, i) => S.idades[i]).some(v => v === '' || v === undefined || v === null);
  if (falta) return `<p class="why ingfalta">🎟️ ${t('idadesFalta')}</p>`;
  const nome = (o) => (o && (o[LANG] || o.pt)) || '';
  const det = (l) => Object.keys(l.porValor).map(Number).sort((a, b) => b - a)
    .map(v => v === 0 ? t('ingGratis', { n: l.porValor[v] }) : l.porValor[v] + ' × ' + eur(v)).join(' · ')
    + (l.guia ? ' · ' + t('ingGuia', { v: eur(l.guia) }) : '');
  return `<div class="ingbox">
    ${ing.linhas.map(l => `<div class="quebra"><span>🎟️ ${esc(nome(l.nome))}<small>${det(l)}</small></span><b>${eur(l.valor)}</b></div>`).join('')}
    ${ing.noDia.map(l => `<div class="quebra dia"><span>${esc(nome(l.nome))}<small>${t('ingNoDia')} · ${det(l)}</small></span><b>${eur(l.valor)}</b></div>`).join('')}
    <p class="why">${t('ingAviso')}</p>
  </div>`;
}

function ligaPessoas(x, S, root) {
  $$('[data-idade]', root).forEach(sel => sel.onchange = () => {
    S.idades[+sel.dataset.idade] = sel.value === '' ? '' : +sel.value;
    renderBook();
  });
  $$('[data-cnt]', root).forEach(b => b.onclick = () => {
    const d = +b.dataset.d, k = b.dataset.cnt;
    let ad = S.adultos, cr = S.criancas;
    if (k === 'a') ad = Math.max(1, ad + d); else cr = Math.max(0, cr + d);
    const teto = tetoPessoas(x, S);
    if (ad + cr > teto) return toast(t(x.priceMode === 'tabela' || x.priceMode === 'transfer' ? 'bigGroup' : 'maxNote', { n: teto }));
    S.adultos = ad; S.criancas = cr; S.pax = ad + cr;
    S.idades = (S.idades || []).slice(0, cr);
    S.opcao = 0; S.discount = 0; S.coupon = null;
    renderBook();
  });
}

/* --- o transfer: as duas opcoes de veiculo da quantidade escolhida --- */
function transferEscolhaHtml(x, S) {
  const ops = transferOpcoes(x, S.pax);
  if (!ops.length) return `<p class="why">${t('bigGroup', { n: transferAte(x) })}</p>`;
  const noite = transferNoturno(S.time);
  return `<div class="trfpick">
      <b>${t('trfPick')}</b>
      <small class="why">${t('trfPickWhy')}</small>
      <div class="trfopts">${ops.map((o, i) => `
        <button class="trfopt ${S.opcao === i ? 'on' : ''}" data-o="${i}">
          <b>${esc(o.veiculo)}</b>
          <small>${esc(o.malas)}</small>
          <span>${eur(noite ? o.noite : o.dia)}</span>
        </button>`).join('')}</div>
    </div>
    <div class="trfcentro">
      <b>${t('trfCentroQ')}</b>
      <small class="why">${t('trfCentroWhy')}</small>
      <div class="trfsn">
        <button class="popt ${S.noCentro === true ? 'on' : ''}" data-centro="sim"><b>${t('trfCentroSim')}</b></button>
        <button class="popt ${S.noCentro === false ? 'on' : ''}" data-centro="nao"><b>${t('trfCentroNao')}</b></button>
      </div>
    </div>`;
}

/* Quando o app NAO da o preco sozinho e manda falar com ela:
   - transfer com hotel fora do centro ou mais de uma parada (a tabela dela
     diz, com todas as letras: "nao passar o valor, iremos fazer o orcamento");
   - grupo maior do que a tabela responde. */
function precisaOrcamento(x, S, pr) {
  if (x.priceMode === 'transfer') return S.noCentro === false || !!pr.consultar;
  return x.priceMode === 'tabela' && !!pr.consultar;
}

function msgOrcamento(x, S) {
  const nome = x.name[LANG] || x.name.pt;
  const quem = S.criancas ? t('orcQuemCri', { a: S.adultos, c: S.criancas }) : t('orcQuem', { n: S.pax });
  const partes = [t('orcOi'), nome, S.date ? fmtDate(S.date) + (S.time ? ' · ' + S.time : '') : '', quem];
  if (x.priceMode === 'transfer' && S.noCentro === false) partes.push(t('orcForaCentro'));
  return partes.filter(Boolean).join('\n');
}

/* ordem dos filtros da vitrine; so aparece o tipo que o guia realmente vende */
const ORDEM_TIPOS = ['walk', 'day', 'barco', 'transfer', 'papal', 'trem', 'conexao', 'photo', 'session', 'bike'];

function viewShowcase() {
  const tours = Tours.live();
  const filter = viewShowcase._f || 'all';
  /* Onde (cidade/regiao) e O que (tipo). As regioes sao as que ela
     cadastrou nos Ajustes; so aparecem as que tem passeio publicado. */
  const onde = viewShowcase._r || 'all';
  const regs = regioes().filter(([c]) => tours.some(x => x.region === c));
  const list = tours.filter(x => (filter === 'all' || x.type === filter) && (onde === 'all' || x.region === onde));
  app.innerHTML = `
  <header class="topbar">
    <button class="backbtn" id="bk" aria-label="${t('back')}">←</button>
    <span class="tbrand">${logoMark(24, 'var(--brand-assinatura)')}<b>${esc(guiaNome())}</b></span>
    ${langBar('right')}
  </header>
  <main class="wrap">
    <h1 class="pageh">${t('chooseTour')}</h1>
    ${regs.length > 1 ? `<div class="chips onde" id="ondeF">
      <button class="chip ${onde === 'all' ? 'on' : ''}" data-r="all">${t('ondeTodos')}</button>
      ${regs.map(([c]) => `<button class="chip ${onde === c ? 'on' : ''}" data-r="${esc(c)}">📍 ${esc(regiaoLabel(c))}</button>`).join('')}
    </div>` : ''}
    <div class="chips" id="filters">
      ${['all', ...ORDEM_TIPOS.filter(f => tours.some(x => x.type === f))].map(f =>
        `<button class="chip ${filter === f ? 'on' : ''}" data-f="${f}">${t(f === 'all' ? 'fAll' : TYPE_LABEL[f])}</button>`).join('')}
    </div>
    <div class="cards" id="tourCards">
      ${list.length ? list.map(x => `
        <button class="tourcard" data-id="${x.id}">
          <span class="ph" style="background-image:url(${esc(x.photo)})">
            <span class="tbadge">${t(TYPE_LABEL[x.type] || 'fWalk')}</span>
          </span>
          <span class="bd">
            <b>${esc(x.name[LANG] || x.name.pt)}</b>
            ${x.tagline && (x.tagline[LANG] || x.tagline.pt) ? `<small class="ctag">${esc(x.tagline[LANG] || x.tagline.pt)}</small>` : ''}
            <small class="meta">${regiaoLabel(x.region)}${x.duration && x.duration !== '—' ? ' · ' + esc(x.duration) : ''}${(x.stops || []).length ? ' · ' + t('nParadas', { n: x.stops.length }) : ''}</small>
            <span class="cardfoot">
              <span class="pr">${x.priceMode === 'tabela' || x.priceMode === 'transfer' || (x.priceLate && x.earlySeats && x.priceMode !== 'session') ? `<u>${t('fromPrice')}</u> ` : ''}${eur(precoVitrine(x))}
                <i>${unidadePreco(x)}</i></span>
              <span class="cgo" aria-hidden="true">→</span>
            </span>
          </span>
        </button>`).join('')
      : `<p class="empty">${t('emptyFilter')}</p>`}
    </div>
  </main>`;
  bindLang(app);
  $('#bk').onclick = () => go('/');
  $$('#filters .chip').forEach(c => c.onclick = () => { viewShowcase._f = c.dataset.f; viewShowcase(); });
  $$('#ondeF .chip').forEach(c => c.onclick = () => { viewShowcase._r = c.dataset.r; viewShowcase(); });
  $$('.tourcard').forEach(c => c.onclick = () => go('/tour/' + c.dataset.id));
}

/* --- página do passeio + fluxo de reserva --- */
/* A politica de cancelamento e de cada passeio. O de Natal tem sinal NAO
   reembolsavel — anunciar "cancelamento gratis" ali seria prometer ao
   cliente o contrario do que o guia combinou. */
/* So mostra real para quem esta lendo em portugues: para um cliente frances
   ou alemao o numero em real e ruido. E se nao houver cotacao, nao aparece
   nada — inventar um valor seria pior. */
/* No painel ela precisa VER o efeito da margem antes de salvar, senao esta
   escolhendo um numero no escuro. */
function fxResumo() {
  const taxa = (typeof fxTaxa === 'function') && fxTaxa();
  if (!taxa) return t('fxSemCotacao');
  const ex = (DB.tours[0] && +DB.tours[0].price) || 195;
  return t('fxResumo', { taxa: taxa.toFixed(2).replace('.', ','), eur: eur(ex), brl: brl(emReais(ex)) })
       + (typeof fxVencida === 'function' && fxVencida() ? ' · ' + t('fxVelha') : '');
}

function linhaReais(eur) {
  if (LANG !== 'pt') return '';
  if (typeof emReais !== 'function') return '';
  if (!DB.settings || !DB.settings.exibirCotacao) return '';
  const v = emReais(eur);
  if (v == null) return '';
  return `<span class="embrl">${t('aproxBrl', { v: brl(v) })}</span>`;
}

/* texto bilingue: {pt,en}. Existia solto dentro de duas funcoes; agora e um so. */
/* Claro, escuro, ou seguindo o aparelho. Guardado no proprio aparelho:
   e preferencia de quem olha, nao dado do negocio. */
function temaAtual() {
  try { return localStorage.getItem('vi_tema') || 'auto'; } catch (e) { return 'auto'; }
}
function aplicaTema(v) {
  try { if (v === 'auto') localStorage.removeItem('vi_tema'); else localStorage.setItem('vi_tema', v); } catch (e) {}
  const raiz = document.documentElement;
  if (v === 'auto') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', v);
}

function noIdioma(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return a[LANG] || a.pt || a.en || '';
}

function cancelaTxt(x) {
  const c = x.cancel && (x.cancel[LANG] || x.cancel.pt);
  return c || t('freeCancel');
}

function viewTour(id) {
  const x = Tours.get(id);
  if (!x) return go('/tours');
  const S = viewTour._s = { tour: x, date: null, time: null, cap: 0, pax: x.priceMode === 'session' ? 1 : 2, adultos: x.priceMode === 'session' ? 1 : 2, criancas: 0, idades: [], opcao: 0, noCentro: null, step: 1, coupon: null, discount: 0, policy: x.payPolicy === 'split' ? 'split' : 'full' };

  /* quantas vezes abriram este passeio (o relatorio de cliques e conversao).
     Quem mexe no painel nao conta: so visitante. */
  if (typeof Interesse !== 'undefined' && !(typeof isLoggedIn === 'function' && isLoggedIn()) && !sessionStorage.getItem('vi_viu_' + x.id)) {
    try { sessionStorage.setItem('vi_viu_' + x.id, '1'); } catch (e) {}
    Interesse.conta(x.id, 'visitas');
  }
  const stops = Array.isArray(x.stops) ? x.stops : [];
  const L = a => (a && (a[LANG] || a.pt)) || '';
  const lista = a => (Array.isArray(a) ? a : (a && (a[LANG] || a.pt)) || []);

  app.innerHTML = `
  <header class="topbar onhero"><button class="backbtn" id="bk" aria-label="${t('back')}">←</button>
    <span class="tbrand">${logoMark(22, 'var(--brand-assinatura)')}<b>${esc(guiaNome())}</b></span>${langBar('right')}</header>
  <!-- CAPA: como a primeira pagina do PDF dela — imagem cheia, titulo por cima -->
  <div class="tourhero" style="background-image:url(${esc(x.photo)})">
    <div class="thveil"></div>
    <div class="thin">
      <h1>${esc(x.name[LANG] || x.name.pt)}</h1>
      ${x.tagline && (x.tagline[LANG] || x.tagline.pt)
        ? `<p class="thsub">${esc(x.tagline[LANG] || x.tagline.pt)}</p>` : ''}
      <span class="badge onhero">${esc(cancelaTxt(x))}</span>
    </div>
  </div>

  <main class="wrap two-col">
    <section class="tourbody">

      <!-- O PROGRAMA -->
      <div class="sec">
        <span class="seclabel">${t('secProgram')}</span>
        <p class="desc lead">${esc(x.desc[LANG] || x.desc.pt)}</p>
      </div>

      ${stops.length ? `
      <div class="stophead">
        <span class="seclabel">${t('secStops')}</span>
        <small>${t('secStopsSub', { n: stops.length, d: esc(x.duration || '') })}</small>
      </div>
      <ol class="stopgrid">
        ${stops.map((p, i) => `
          <li class="stopcardc">
            ${p.ph ? `<span class="scph" style="background-image:url(${esc(p.ph)})" role="img" aria-label="${esc(L(p.n))}"></span>`
                   : `<span class="scph none" aria-hidden="true"></span>`}
            <div class="scbody">
              <span class="scnum2">${i + 1}</span>
              ${p.t ? `<span class="rtime">${esc(p.t)}</span>` : ''}
              <b>${esc(L(p.n))}</b>
              <p>${esc(L(p.d))}</p>
              ${p.note ? `<small class="scnote">${esc(L(p.note) || p.note)}</small>` : ''}
            </div>
          </li>`).join('')}
      </ol>
      ${miniMap(stops, x)}
      ` : ''}

      <!-- DATAS E HORARIOS -->
      <div class="sec">
        <span class="seclabel">${t('secDates')}</span>
        <div class="factgrid">
          <div><small>${t('fLeaves')}</small><b>${esc(noIdioma(x.meeting))}</b>
            <a class="linkmap" href="${mapLink(noIdioma(x.meeting))}" target="_blank" rel="noopener">${t('openMap')} ↗</a></div>
          ${x.duration ? `<div><small>${t('fHours')}</small><b>${esc(x.duration)}</b></div>` : ''}
          <div><small>${t('fGroup')}</small><b>${t('upTo')} ${x.max} ${t('people')}</b>
            ${x.min > 1 ? `<small class="sub">${t('minNote', { n: x.min })}</small>` : ''}</div>
          <div><small>${t('fLang')}</small><b>PT · EN</b></div>
        </div>
      </div>

      <!-- O QUE INCLUI -->
      <div class="sec">
        <span class="seclabel">${t('secIncludes')}</span>
        <div class="incbox">
          <div>
            <h4>${t('included')}</h4>
            <ul class="inc yes">${lista(x.includes).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
          </div>
          ${lista(x.notIncludes).length ? `<div>
            <h4>${t('notIncluded')}</h4>
            <ul class="inc no">${lista(x.notIncludes).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
          </div>` : ''}
        </div>
      </div>

      <!-- VALOR E RESERVA -->
      <div class="sec">
        <span class="seclabel">${t('secPrice')}</span>
        <div class="pricebox">
          <div class="pbmain">
            <b>${x.priceMode === 'tabela' ? `<u class="fromlbl">${t('fromPrice')}</u> ` : ''}${eur(precoVitrine(x))}</b>
            <small>${unidadePreco(x)}</small>
            ${linhaReais(precoVitrine(x))}
            ${(x.ingressos || []).length ? `<p class="pbing">🎟️ ${t('ingPagina')}</p>` : ''}
            ${x.priceLate && x.earlySeats && x.priceMode !== 'session'
              ? `<span class="pbearly">${t('earlyNote', { n: x.earlySeats, v: eur(x.priceLate) })}</span>` : ''}
          </div>
          <div class="pbterms">
            <p>${esc(cancelaTxt(x))}</p>
            ${x.priceNote && (x.priceNote[LANG] || x.priceNote.pt)
              ? `<small>${esc(x.priceNote[LANG] || x.priceNote.pt)}</small>` : ''}
          </div>
        </div>
      </div>

      ${x.closing && (x.closing[LANG] || x.closing.pt) ? `
      <div class="closing">
        <p>${esc(x.closing[LANG] || x.closing.pt)}</p>
      </div>` : ''}
    </section>
    <aside class="book" id="book"></aside>
  </main>`;
  bindLang(app);
  $('#bk').onclick = () => go('/tours');
  renderBook();
}

/* ---- o trajeto ----
   Não desenho um mapa aqui de propósito. Quatro paradas dentro de 600 m
   viram uma bolinha só numa projeção honesta, e distorcer a escala seria
   mentir. O que ajuda de verdade é o trajeto na ordem — e o mapa de
   verdade, com ruas, a um toque. */
const MODO_MAPA = { day: 'driving', bike: 'bicycling', walk: 'walking', photo: 'walking', session: 'walking' };
const MODO_TXT  = { day: 'mapWhyDrive', bike: 'mapWhyBike' };
function miniMap(stops, x) {
  const pts = stops.filter(p => p.place || (p.lat && p.lng));
  if (pts.length < 2) return '';
  const L = a => (a && (a[LANG] || a.pt)) || '';
  /* endereço digitado pelo guia vale mais que coordenada: o Maps resolve e mostra o nome */
  const q = p => encodeURIComponent(p.place || (p.lat + ',' + p.lng));
  const gmaps = 'https://www.google.com/maps/dir/?api=1'
    + '&origin=' + q(pts[0])
    + '&destination=' + q(pts[pts.length - 1])
    + (pts.length > 2 ? '&waypoints=' + pts.slice(1, -1).map(q).join('%7C') : '')
    + '&travelmode=' + (MODO_MAPA[x && x.type] || 'walking');
  return `
  <h3 class="h3">${t('mapTitle')}</h3>
  <div class="mapbox">
    <ol class="trail">
      ${pts.map((p, i) => `<li><span class="tnum">${i + 1}</span><b>${esc(L(p.n))}</b></li>`).join('')}
    </ol>
    <a class="cta sm wide" href="${gmaps}" target="_blank" rel="noopener">${t('mapOpen')} ↗</a>
    <p class="why">${t(MODO_TXT[x && x.type] || 'mapWhyWalk', { n: pts.length })}</p>
  </div>`;
}


/* ---- como pagar ----
   O app nao cobra nada: quem recebe e ela, por Pix ou transferencia. Esta tela
   mostra so o que ela preencheu no ADM. Sem nada preenchido, diz a verdade
   em vez de inventar um meio de pagamento. */
function prazoSaldo(b, saldo) {
  const d = Bookings.dueDate(b);
  return d > isoToday()
    ? t('balanceNote', { v: eur(saldo), d: fmtDate(d) })
    : t('balanceSoon', { v: eur(saldo) });
}

/* ---------- cartao pelo Stripe ----------
   O app manda so o id da reserva. Quem decide o valor e a funcao no
   servidor, que le a reserva no banco. Ver supabase/functions/pagar. */
const PAGAR_URL = (typeof SUPA_URL !== 'undefined' ? SUPA_URL : '') + '/functions/v1/pagar';

async function pagarNoServidor(corpo, segundos = 20) {
  const ctrl = new AbortController();
  const corta = setTimeout(() => ctrl.abort(), segundos * 1000);
  try {
    const r = await fetch(PAGAR_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json',
                 apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
      body: JSON.stringify(corpo),
    });
    return await r.json();
  } finally { clearTimeout(corta); }
}

function ligaBotaoCartao(b) {
  const bt = $('#btCartao');
  if (!bt) return;
  bt.onclick = async () => {
    bt.disabled = true;
    const antes = bt.textContent;
    bt.textContent = t('cardIndo');
    try {
      const r = await pagarNoServidor({ reservaId: b.id });
      if (r && r.url) { location.href = r.url; return; }
      toast(t('cardErro'));
    } catch (e) { toast(t('cardErro')); }
    /* so volta ao normal se NAO saiu daqui — senao pisca antes de trocar de pagina */
    bt.disabled = false; bt.textContent = antes;
  };
}

/* Volta do Stripe: #/pago/<codigo>?s=<sessao>.
   Quem diz se foi pago e o servidor, perguntando ao Stripe — o navegador
   nao pode ser a autoridade sobre isso. */
async function viewPago(codigo) {
  const sessao = (location.hash.split('?s=')[1] || '').split('&')[0];
  app.innerHTML = `<div class="wrap narrow"><div class="paybox">
    <h2 class="okh" id="pgTit">${t('pgConferindo')}</h2>
    <p class="hint center" id="pgMsg">${t('pgEspere')}</p>
    <a class="mini" href="#/tours">${t('backTours')}</a></div></div>`;
  let r = null;
  try { r = await pagarNoServidor({ verificar: decodeURIComponent(sessao) }, 25); }
  catch (e) { r = null; }
  const msg = $('#pgMsg'), tit = $('#pgTit');
  if (!msg || !tit) return;   /* saiu da tela enquanto conferia */
  if (r && r.pago) {
    tit.textContent = t('pgOkTit');
    msg.innerHTML = t('pgOk', { code: esc(codigo) });
    if (typeof cloudPull === 'function') cloudPull();
  } else {
    tit.textContent = t('pgDuvidaTit');
    msg.innerHTML = t('pgDuvida', { code: esc(codigo) });
  }
}

function comoPagar(b, x) {
  const st = DB.settings || {};
  const agora = b.policy === 'sinal' && b.sinal ? b.sinal
              : b.policy === 'split' ? Math.round(b.total / 2) : b.total;
  const saldo = b.total - agora;
  const linha = (rot, valor, dono) => `
    <div class="payline">
      <small>${rot}</small>
      <div class="crow"><input readonly value="${esc(valor)}"><button class="mini" data-cp="${esc(valor)}">${t('copyBtn')}</button></div>
      ${dono ? `<small class="who">${t('inNameOf')} ${esc(dono)}</small>` : ''}
    </div>`;
  /* Pix com o valor ja embutido: o cliente cola no banco e paga, sem digitar
     valor nenhum (era onde ele errava). Precisa de chave, nome e cidade — o
     padrao exige os tres — e de cotacao, para converter o euro em real. */
  const brl = (typeof pixValorEmReais === 'function') ? pixValorEmReais(agora) : null;
  const codigoPix = (typeof pixDisponivel === 'function' && pixDisponivel() && brl)
    ? pixCopiaECola({ chave: st.pixKey, nome: pixNome(), cidade: pixCidade(),
                      valor: brl, txid: b.code })
    : null;

  const blocoPix = codigoPix ? `
    <div class="pixbox">
      <b class="pixtit">${t('pixTit')}</b>
      <p class="pixvalor">${t('pixValor', { brl: brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }), eur: eur(agora) })}</p>
      ${(typeof qrSvg === 'function') ? `<div class="pixqr">${qrSvg(codigoPix, { tamanho: 190, alt: t('pixTit') })}</div>` : ''}
      <p class="why">${t('pixComo')}</p>
      <textarea class="pixcod" id="pixCod" readonly rows="3">${esc(codigoPix)}</textarea>
      <button class="cta sm" data-cp="${esc(codigoPix)}">${t('pixCopiar')}</button>
    </div>` : '';

  /* Cartao. O botao so chama o servidor com o ID da reserva — o valor e
     calculado la, nunca aqui: se o navegador dissesse quanto pagar, bastava
     mexer no console para fazer o passeio por um euro. */
  const blocoCartao = st.stripeAtivo ? `
    <div class="cardbox">
      <button class="cta sm" id="btCartao">${t('cardPagar', { v: eur(agora) })}</button>
      <small class="why">${t('cardComo')}</small>
    </div>` : '';

  const meios = blocoCartao + blocoPix
              + (st.pixKey && !codigoPix ? linha(t('pixLbl'), st.pixKey, st.pixName) : '')
              + (st.iban ? linha(t('ibanLbl'), st.iban, st.ibanName) : '')
              + (linkExterno(st.wiseLink) ? `<div class="payline"><small>${t('wiseLbl')}</small>
                  <a class="cta sm" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="${esc(st.wiseLink)}">${t('wiseAbrir')}</a></div>` : '')
              + (st.dinheiroNoDia ? `<p class="why">💶 ${t('cashLbl')}</p>` : '');
  return `
  <div class="paybox">
    <h3>${t('howPay')}</h3>
    <p class="paynow"><small>${t('howPayNow')}</small><b>${eur(agora)}</b></p>
    ${saldo > 0 ? `<p class="due">${b.policy === 'sinal' ? t('trfRestoDia', { v: eur(saldo) }) : prazoSaldo(b, saldo)}</p>` : ''}
    ${meios || `<p class="why">${t('howPayNone')}</p>`}
    ${st.payNote ? `<p class="why">${esc(st.payNote)}</p>` : ''}
    ${meios ? `<p class="why">${t('payProof')}</p>` : ''}
  </div>`;
}

function renderBook() {
  const S = viewTour._s, x = S.tour, book = $('#book');
  /* Precos vem de Bookings.precoDe: ele sabe quantas vagas baratas restam
     naquela data e divide as pessoas entre os dois valores. */
  const pr = Bookings.precoDe(x, x.id, S.date, S.time, S.pax, { opcao: S.opcao });
  /* Preco escalonado: 195 para as 3 primeiras da data, 225 depois.
     Enquanto sobra vaga barata, o valor em destaque e 195 e a nota explica.
     Quando as 3 acabam, anunciar "195, depois 225" vira propaganda enganosa —
     ninguem mais consegue aquele valor. Ai o destaque passa a ser 225, limpo. */
  const escalonado = !!(x.priceLate && x.earlySeats) && x.priceMode !== 'session';
  const sobramBaratas = !S.date || !escalonado || (pr.baratasRestantes ?? x.earlySeats) > 0;
  const valorEmDestaque = escalonado && !sobramBaratas ? +x.priceLate : +x.price;
  const priceLine = x.priceMode === 'transfer'
    ? `${eur(pr.total || precoVitrine(x))} <small>${t('perTrip')}</small>`
      + (pr.noturno ? `<em class="pearly">${t('trfNightOn')}</em>` : '')
    : x.priceMode === 'tabela'
    ? `<u class="fromlbl">${t('fromPrice')}</u> ${eur(precoVitrine(x))} <small>${t('perGroup')}</small>`
    : x.priceMode === 'session'
    ? `${eur(x.price)} <small>${t('perSession')}</small>`
    : `${eur(valorEmDestaque)} <small>${t('perPerson')}</small>`
      + (escalonado && sobramBaratas
          ? `<em class="pearly">${t('earlyNote', { n: x.earlySeats, v: eur(x.priceLate) })}</em>` : '')
      + linhaReais(valorEmDestaque);
  const base = pr.total;
  /* ingressos por idade, somados — e ela quem compra, com antecedencia */
  const ing = ingressosDe(x, S.adultos, S.idades);
  const total = base - S.discount + ing.total;

  if (S.step === 1) {
    const today = isoToday();
    const deps = Cal.departures(x.id, today, addDays(today, 120));
    const byDate = {};
    deps.forEach(d => { (byDate[d.date] = byDate[d.date] || []).push(d); });
    const dates = Object.keys(byDate).slice(0, 30);
    book.innerHTML = `
      <div class="bhead"><span class="bprice">${priceLine}</span></div>
      <div class="bstep">${t('step1')}</div>
      ${dates.length ? `
      <div class="dgrid">${dates.map(d =>
        `<button class="dcell ${S.date === d ? 'on' : ''}" data-d="${d}"><b>${fmtDate(d).split(',')[1] || fmtDate(d)}</b><small>${fmtDate(d).split(',')[0]}</small></button>`).join('')}
      </div>
      <div id="times">${S.date ? timesHtml(byDate[S.date]) : `<p class="hint">${t('pickDate')}</p>`}</div>
      <button class="cta" id="next1" ${S.time ? '' : 'disabled'}>${t('cont')}</button>`
      : `<div class="nodates">
          <p>${t('noDatesYet')}</p>
          <a class="cta sm wide" target="_blank" rel="noopener"
             href="${waLink(t('waAskDates', { tour: x.name[LANG] || x.name.pt }))}">${t('askDatesBtn')}</a>
        </div>`}`;
    $$('.dcell', book).forEach(b => b.onclick = () => { S.date = b.dataset.d; S.time = null; renderBook(); });
    $$('[data-t]', book).forEach(b => b.onclick = () => {
      S.time = b.dataset.t; S.cap = +b.dataset.c;
      $$('[data-t]', book).forEach(z => z.classList.remove('on')); b.classList.add('on');
      $('#next1').disabled = false;
    });
    $('#next1')?.addEventListener('click', () => { S.step = 2; renderBook(); });

    function timesHtml(list) {
      return `<p class="hint">${t('pickTime')}</p><div class="times">` + list.map(d => {
        const left = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
        return left > 0
          ? `<button class="slot ${S.time === d.time ? 'on' : ''}" data-t="${d.time}" data-c="${d.capacity}">${d.time}<small>${left} ${t('spotsLeft')}</small></button>`
          : `<button class="slot off" disabled>${d.time}<small>0</small></button>`;
      }).join('') + '</div>';
    }
  }

  if (S.step === 2) {
    book.innerHTML = `
      <div class="bhead"><span class="bprice">${priceLine}</span></div>
      <div class="bstep">${t(x.priceMode === 'transfer' ? 'step2trf' : 'step2')}</div>
      ${x.priceMode === 'session' ? '' : pessoasHtml(x, S)}
      ${x.priceMode === 'transfer' ? transferEscolhaHtml(x, S) : ''}
      <div class="sums">
        <div><span>${fmtDate(S.date)} · ${S.time}</span></div>
        ${S.discount ? `<div><span>${t('couponOk', { c: S.coupon })}</span><b>−${eur(S.discount)}</b></div>` : ''}
        ${x.priceMode === 'transfer'
          ? `<div class="quebra"><span>${esc(pr.veiculo || '')} · ${pr.noturno ? t('trfNight') : t('trfDay')}</span><b>${eur(pr.total)}</b></div>`
            + (pr.sinal ? `<div class="quebra"><span>${t('trfSinalLbl')}</span><b>${eur(pr.sinal)}</b></div>` : '')
          : x.priceMode === 'tabela'
          ? `<div class="quebra"><span>${t('closedPrice', { n: S.pax })}</span><b>${eur(pr.total)}</b></div>`
          : (pr.linhas && pr.linhas.length > 1) ? pr.linhas.map(l =>
          `<div class="quebra"><span>${t('linhaPreco', { qtd: l.qtd, valor: eur(l.valor) })}</span><b>${eur(l.qtd * l.valor)}</b></div>`).join('') : ''}
        ${ingressosResumo(x, S, ing)}
        <div class="tot"><span>${t('total')}</span><b>${eur(total)}</b></div>
        ${linhaReais(total)}
        ${(x.min > 1 && S.pax < x.min) ? `<p class="why">${t('minAviso', { n: x.min })}</p>` : ''}
      </div>
      <details class="coupon"><summary>${t('haveCoupon')}</summary>
        <div class="crow"><input id="cin" placeholder="VOLTA10"><button class="mini" id="capply">OK</button></div>
        <p class="cbad" id="cbad"></p>
      </details>
      <button class="cta" id="next2" ${x.priceMode === 'transfer' && S.noCentro === null ? 'disabled' : ''}>${precisaOrcamento(x, S, pr) ? t('bigGroupBtn') : t('cont')}</button>
      <button class="cta soft" id="toCesta">＋ ${LANG === 'en' ? 'Add to one request with other services' : 'Juntar com outros serviços num pedido só'}</button>
      <button class="linkbtn" id="back1" aria-label="${t('back')}">← ${t('back')}</button>`;
    /* O cliente que quer varias coisas (transfer, Vaticano, Florenca...) junta
       tudo e manda UM pedido — chega para ela em Sob consulta e no WhatsApp. */
    $('#toCesta').onclick = () => {
      cestaAdd({ tourId: x.id, nome: x.name[LANG] || x.name.pt, data: S.date, hora: S.time, pax: S.pax,
                 opcao: S.opcao || 0, valor: pr.consultar ? 0 : total });
      toast(LANG === 'en' ? 'Added to your request' : 'Acrescentado ao seu pedido');
      go('/tours');
    };
    /* Antes o piso era x.min (3 nos passeios dela): apertar "menos" com 2
       pessoas SUBIA para 3, e um casal nao conseguia reservar de jeito nenhum.
       O minimo dela e a regra de saida, nao o tamanho minimo de uma reserva. */
    ligaPessoas(x, S, book);
    $$('.trfopt', book).forEach(b => b.onclick = () => {
      S.opcao = +b.dataset.o; S.discount = 0; S.coupon = null; renderBook();
    });
    $$('[data-centro]', book).forEach(b => b.onclick = () => {
      S.noCentro = b.dataset.centro === 'sim'; renderBook();
    });
    $('#capply').onclick = () => {
      const v = Coupons.validate($('#cin').value, null);
      if (v.ok) { S.coupon = v.coupon.code; S.discount = Math.round(base * v.coupon.pct / 100); renderBook(); }
      else $('#cbad').textContent = t('couponBad');
    };
    $('#next2').onclick = () => {
      if ((x.ingressos || []).length && S.criancas &&
          Array.from({ length: S.criancas }, (_, i) => S.idades[i]).some(v => v === '' || v === undefined || v === null)) {
        return toast(t('idadesFalta'));
      }
      if (precisaOrcamento(x, S, pr)) {
        return window.open(waLink(msgOrcamento(x, S)), '_blank');
      }
      if (x.priceMode === 'tabela' && pr.consultar) {
        return window.open(waLink(t('waAskDates', { tour: x.name[LANG] || x.name.pt })), '_blank');
      }
      S.step = 3; renderBook();
    };
    $('#back1').onclick = () => { S.step = 1; renderBook(); };
  }

  if (S.step === 3) {
    /* chegou a preencher os dados: "quase reservou" (uma vez por visita) */
    if (typeof Interesse !== 'undefined' && !S.contouQuase) { S.contouQuase = true; Interesse.conta(x.id, 'quase'); }
    const half = Math.round(total / 2);
    const splitAllowed = x.payPolicy === 'split';
    book.innerHTML = `
      <div class="bstep">${t('step3')}</div>
      <label class="fld">${t('fullName')}<input id="fN" autocomplete="name"></label>
      <label class="fld">${t('email')}<input id="fE" type="email" autocomplete="email"></label>
      <label class="fld">${t('whatsLbl')}<input id="fW" placeholder="+33 6 …"><small class="why">${t('whyWhats')}</small></label>
      <label class="fld">${t('instaLbl')}<input id="fI" placeholder="@"></label>
      ${participantesHtml(x, S)}
      <label class="optin"><input type="checkbox" id="fOptin">
        <span><b>${t('consentLbl')}</b><small>${t('consentWhy')}</small></span></label>
      ${x.priceMode === 'transfer' && pr.sinal ? `
      <p class="sinalnote">${t('trfSinalNota', { s: eur(pr.sinal), r: eur(Math.max(0, total - pr.sinal)) })}</p>` : ''}
      ${splitAllowed ? `
      <div class="payopts">
        <button class="popt ${S.policy === 'full' ? 'on' : ''}" data-p="full"><b>${t('payFull')}</b><small>${t('payFullSub')} · ${eur(total)}</small></button>
        <button class="popt ${S.policy === 'split' ? 'on' : ''}" data-p="split"><b>${t('paySplit')}</b><small>${t('paySplitSub', { half: eur(half), d: (+x.balanceDays || 1) })}</small></button>
      </div>` : ''}
      <button class="cta" id="payBtn">${x.priceMode === 'transfer' && pr.sinal ? t('payNowBtn', { v: eur(pr.sinal) }) : S.policy === 'split' && splitAllowed ? t('payNowBtn', { v: eur(half) }) : t('payBtn', { v: eur(total) })}</button>
      <p class="fine">${cancelaTxt(x)} · ${t('noHidden')}</p>
      ${DB.settings.termos && (DB.settings.termos[LANG] || DB.settings.termos.pt) ? `<details class="termos-ck"><summary>${LANG === 'en' ? 'By paying you accept the terms and conditions' : 'Ao pagar você aceita os termos e condições'}</summary>
        <p>${esc(DB.settings.termos[LANG] || DB.settings.termos.pt).replace(/\n/g, '<br>')}</p></details>` : ''}
      <p class="fine demo">${t('payAfter')}</p>
      <button class="linkbtn" id="back2" aria-label="${t('back')}">← ${t('back')}</button>`;
    $$('.popt', book).forEach(b => b.onclick = () => {
      /* não re-renderizar: apagaria o que a pessoa já digitou */
      S.policy = b.dataset.p;
      $$('.popt', book).forEach(z => z.classList.toggle('on', z === b));
      $('#payBtn').textContent = S.policy === 'split' ? t('payNowBtn', { v: eur(half) }) : t('payBtn', { v: eur(total) });
    });
    /* quem vai: uma linha por pessoa; "eu tambem vou" tira ou poe uma linha
       sem redesenhar (quem ja digitou nao perde nada) */
    ligaParticipantes(book, S);
    $('#back2').onclick = () => { S.step = 2; renderBook(); };
    $('#payBtn').onclick = () => {
      const name = $('#fN').value.trim(), email = $('#fE').value.trim(), whats = $('#fW').value.trim();
      if (!name || !email || !whats) return toast(LANG === 'pt' ? 'Preencha nome, e-mail e WhatsApp.' : 'Fill in name, email and WhatsApp.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { $('#fE').focus(); return toast(t('badEmail')); }
      const part = lerParticipantes(x);
      if (part.erro) return toast(part.erro);
      if (Cal.seatsLeft(x.id, S.date, S.time, S.cap || x.max) < S.pax) { S.step = 1; S.time = null; renderBook(); return toast(t('lastSpotGone')); }
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = t('confirming');
      setTimeout(() => {
        S.booking = Bookings.create({
          tourId: x.id, date: S.date, time: S.time, name, email, whats,
          insta: $('#fI').value.trim(), pax: S.pax, coupon: S.coupon,
          consent: $('#fOptin').checked, opcao: S.opcao, group: part.grupo,
          nasc: part.nasc, compradorVai: part.vai, veioPor: part.veioPor, indicadoPor: part.indicadoPor,
          adultos: S.adultos, criancas: S.criancas, idades: S.idades.slice(0, S.criancas),
          policy: (x.priceMode === 'transfer' && pr.sinal) ? 'sinal' : splitAllowed ? S.policy : 'full', origin: 'site',
        });
        S.step = 4; renderBook();
      }, 900);
    };
  }

  if (S.step === 4) {
    const b = S.booking, due = Bookings.due(b);
    book.innerHTML = `
      <div class="okc">✓</div>
      <h2 class="okh">${t('booked')}</h2>
      <p class="hint center">${t('sentAll')}</p>
      <div class="voucher">
        <small>${t('yourCode')}</small><div class="code">${esc(b.code)}</div>
        <p>${fmtDate(b.date)} · ${b.time}</p><p>${esc(noIdioma(x.meeting))}</p>
      </div>
      ${comoPagar(b, x)}
      <a class="cta" style="text-decoration:none;text-align:center" target="_blank" rel="noopener"
         href="${waLink(t('waBookingMsg', { code: b.code, tour: x.name[LANG] || x.name.pt, when: fmtDate(b.date) + ' ' + b.time, name: b.name }))}">✆ ${t('waSendBooking')}</a>
      <div class="okrow">
        <a class="mini" href="${icsFor(b, x)}" download="${esc(b.code)}.ics">${t('addCal')}</a>
        <a class="mini" target="_blank" rel="noopener" href="${mapLink(noIdioma(x.meeting))}">${t('seeMap')}</a>
      </div>
      <button class="cta soft" id="again">${t('bookAgain')}</button>`;
    ligaBotaoCartao(b);
    $$('[data-cp]', book).forEach(btn => btn.onclick = async () => {
      try { await navigator.clipboard.writeText(btn.dataset.cp); toast(t('copiedOk')); }
      catch (e) { const i = btn.previousElementSibling; i.select(); document.execCommand('copy'); toast(t('copiedOk')); }
    });
    $('#again').onclick = () => go('/tours');
  }
}

/* =====================================================
   ADM
===================================================== */
/* A ordem do dia dela (reuniao de 28/09/2026): o que acontece hoje, o que
   chegou pedindo orcamento, quem faz, e so depois o resto. */
/* O menu em grupos (como o TI ARTES): cada grupo tem um título e as abas.
   A Planilha (o CRM dela, a planilha mais importante) fica SEMPRE no menu. */
const ADM_GROUPS = [
  { h: 'O dia a dia',           tabs: [['today', 'admToday'], ['conversas', 'admConversas'], ['agenda', 'admAgenda'], ['tarefas', 'admTarefas']] },
  { h: 'Orçamentos e clientes', tabs: [['planilha', 'admPlanilha'], ['pipeline', 'admPipeline'], ['consulta', 'admConsulta'], ['clients', 'admClients'], ['bookings', 'admBookings']] },
  { h: 'Em Roma',               tabs: [['guias', 'admGuias'], ['transfer', 'admTransfer'], ['tours', 'admTours'], ['precos', 'admPrecos'], ['voucher', 'admVoucher']] },
  { h: 'Dinheiro',              tabs: [['money', 'admMoney'], ['reports', 'admReports'], ['coupons', 'admCoupons']] },
  { h: 'O app',                 tabs: [['look', 'temaTit'], ['settings', 'admSettings']] },
];
const ADM_TABS = ADM_GROUPS.flatMap(g => g.tabs);

/* ---- aviso de painel destravado ----
   Desde que as reservas passaram a ser privadas, quem não está logada
   não recebe nada da nuvem. Sem este aviso o painel mostraria uma lista
   vazia como se não houvesse reserva — mentira em silêncio, o pior tipo. */
function noAuthBanner() {
  /* DEMONSTRACAO: nao ha o que proteger — os dados nunca saem do aparelho de
     quem esta olhando, e nao existe conta para criar. O aviso vermelho de
     "qualquer um entra no seu painel" assustaria o prospect a toa, e o botao
     levaria a uma tela de login sem banco atras. */
  /* 29/09: e o app de verdade, para a entrega — sem a faixa de demonstracao
     no painel. (Sem banco ainda, cada aparelho guarda o seu: isso aparece no
     botao 📁 Google Drive, em "Nuvem".) */
  if (typeof temNuvem === 'function' && !temNuvem()) return '';
  if (typeof isLoggedIn === 'function' && isLoggedIn()) return '';
  return `<div class="alert bad nolog">
    <b>⚠ ${t('nlTitle')}</b>
    <p>${t('nlWhy')}</p>
    <p><b>${t('nlWrite')}</b></p>
    <button class="cta sm" id="goProtect">${t('nlCta')}</button>
  </div>`;
}

/* A nuvem avisa quando uma gravação foi recusada. Um aviso por vez —
   o sync roda a cada 25s e não pode virar metralhadora de toast. */
let _rejAviso = 0;
function onCloudRejected() {
  const agora = Date.now();
  if (agora - _rejAviso < 60000) return;
  _rejAviso = agora;
  toast(t('nlNotSaved'));
}

function admShell(tab, inner) {
  /* reserva que chegou do site ganha o cadastro; e a sincronia por linha
     (nuvem-itens.js) liga na primeira tela do painel com ela logada */
  if (typeof cadastroEmDia === 'function') cadastroEmDia();
  if (typeof itLigar === 'function') itLigar(() => { if (isBusyEditing()) pendingSync = true; else route(); });
  if (typeof visualAplica === 'function') visualAplica(true);
  app.innerHTML = `
  <div class="adm">
    <aside class="rail">
      <div class="brand">${logoFull({ mark: 26, sub: 'ADM' })}</div>
      <button class="nb nb-ia" id="nbAssist" type="button">⚡ Assistente</button>
      <nav>${ADM_GROUPS.map(g =>
        `<div class="nav-grp">${g.h ? `<div class="nav-h">${g.h}</div>` : ''}${g.tabs.map(([id, k]) =>
          `<button class="nb ${tab === id ? 'on' : ''}" data-tab="${id}" id="nb-${id}">${t(k)}</button>`).join('')}</div>`).join('')}</nav>
      <div class="railfoot">
        <button class="nb ghost" id="viewSite">👁 ${t('viewSite')}</button>
        <button class="nb ghost" id="exitAdm">← ${t('exit')}</button>
      </div>
    </aside>
    <main class="stage" id="stage">${noAuthBanner()}${typeof atalhosHtml === 'function' ? atalhosHtml() : ''}${inner}</main>
  </div>`;
  const nab = $('#goProtect');
  if (nab) nab.onclick = () => go('/login');
  $$('.nb[data-tab]').forEach(b => b.onclick = () => go('/adm/' + b.dataset.tab));
  if ($('#nbAssist')) $('#nbAssist').onclick = () => { try { if (typeof iaAbre === 'function') iaAbre(); } catch (e) {} };
  $('#viewSite').onclick = () => go('/');
  $('#exitAdm').onclick = async () => {
    if (isLoggedIn()) { await authSignOut(); toast(t('loginOut')); }
    go('/');
  };
}

function viewAdm(tab, arg) {
  if (tab === 'today')    admToday(arg);
  else if (tab === 'pipeline') admPipeline();
  else if (tab === 'guias')    admGuias(arg);
  else if (tab === 'planilha') admConsulta(undefined, 'planilha');
  else if (tab === 'transfer') admTransfer();
  else if (tab === 'precos')   admPrecos(arg);
  else if (tab === 'consulta') admConsulta(arg);
  else if (tab === 'tarefas')  admTarefas(arg);
  else if (tab === 'conversas') admConversas(arg);
  else if (tab === 'voucher' && arg) opDocVoucher(arg);
  else if (tab === 'voucher')  admVoucher();
  else if (tab === 'orcdoc')   opDocOrc(arg);
  else if (tab === 'clients' && arg) admFicha(arg);
  else if (tab === 'tours' && arg) admTourEdit(arg);
  else if (tab === 'tours')    admTours();
  else if (tab === 'bookings') admBookings();
  else if (tab === 'money')    admMoney();
  else if (tab === 'agenda')   admAgenda();
  else if (tab === 'reports')  admReports();
  else if (tab === 'clients')  admClients();
  else if (tab === 'coupons')  admParcerias();
  else if (tab === 'look')     admAparencia();
  else if (tab === 'settings') admSettings();
  else admToday();
}

/* ---- Hoje ----
   O painel da emergencia (operacao-telas.js): cliente, voo, quem faz, quanto
   paga no dia e para quem. Aqui fica so o convite de criar senha. */
function admToday(arg) {
  if (temNuvem() && !DB.settings.authRequired && !isLoggedIn() && !admToday._asked) {
    admToday._asked = true;
    setTimeout(() => {
      if (confirm(t('protectWhy') + '\n\n' + t('protectNow') + '?')) go('/login');
    }, 900);
  }
  admHoje(arg);
}

/* ---- Passeios ---- */
const STATUS_PILL = { live: ['ok', 'live'], draft: ['n', 'draft'], seasonal: ['warn', 'seasonal'] };
function admTours() {
  const tours = Tours.all();
  admShell('tours', `
    <div class="pagehead"><h1 class="pageh">${t('admTours')}</h1>
      <button class="cta sm" id="newTour">${t('newTour')}</button></div>
    ${tours.length ? `<div class="tlist">${tours.map(x => {
      const [cls, k] = STATUS_PILL[x.status] || STATUS_PILL.draft;
      return `<div class="trow">
        <span class="ph sm" style="background-image:url(${esc(x.photo)})"></span>
        <div class="tinfo"><b>${esc(x.name.pt)}</b>
          <small>${t(TYPE_LABEL[x.type] || 'fWalk')} · ${eur(x.price)} ${x.priceMode === 'session' ? t('perSession') : t('perPerson')} · ${regiaoLabel(x.region)}</small></div>
        <span class="pill ${cls}">${t(k)}</span>
        <div class="tacts">
          <button class="mini" data-edit="${x.id}">${t('edit')}</button>
          <button class="mini" data-dup="${x.id}">${t('duplicate')}</button>
          <button class="mini ghost" data-togg="${x.id}">${x.status === 'draft' ? '▶' : '⏸'}</button>
          <button class="mini danger" data-del="${x.id}">×</button>
        </div></div>`;
    }).join('')}</div>`
    : `<div class="emptybox"><p>${t('emptyTours')}</p><button class="cta" id="newTour2">${t('firstTour')}</button></div>`}`);
  $('#newTour')?.addEventListener('click', () => admTourEdit('new'));
  $('#newTour2')?.addEventListener('click', () => admTourEdit('new'));
  $$('[data-edit]').forEach(b => b.onclick = () => go('/adm/tours/' + b.dataset.edit));
  $$('[data-dup]').forEach(b => b.onclick = () => {
    const cp = Tours.duplicate(b.dataset.dup);
    toast(t('duplicated', { n: cp.name.pt })); admTours();
  });
  $$('[data-togg]').forEach(b => b.onclick = () => {
    const x = Tours.get(b.dataset.togg);
    Tours.update(x.id, { status: x.status === 'draft' ? 'live' : 'draft' });
    toast(x.status === 'draft' ? t('published') : t('unpublished')); admTours();
  });
  $$('[data-del]').forEach(b => b.onclick = () => {
    const x = Tours.get(b.dataset.del);
    const n = Tours.futureBookings(x.id).length;
    const msg = t('delTour', { n: x.name.pt }) + (n ? '\n' + t('delTourN', { n }) : '');
    if (confirm(msg)) { Tours.remove(x.id); admTours(); }
  });
}

/* ---- criar / editar passeio + calendário ---- */
/* lista guardada como array vira uma linha por item na caixa de texto */
function linhas(obj, lang) {
  const a = obj && (obj[lang] || obj.pt);
  return Array.isArray(a) ? a.join('\n') : '';
}

/* Linha da tabela de transfer no painel. Ela edita a tabela de 2026 como
   esta no PDF dela: quantas pessoas, veiculo, malas, dia, noite, sinal.
   Duas linhas com o mesmo numero de pessoas = as duas opcoes de veiculo. */
function trfLinhaEd(l) {
  const v = (k) => l[k] === undefined || l[k] === null ? '' : esc(String(l[k]));
  return `<tr>
    <td><input class="tp" type="number" min="1" max="40" value="${v('pax')}" aria-label="${t('edTrfPax')}"></td>
    <td><input class="tv" value="${v('veiculo')}" placeholder="carro" aria-label="${t('edTrfVeic')}"></td>
    <td><input class="tm" value="${v('malas')}" placeholder="2 malas médias e 2 bordo" aria-label="${t('edTrfMalas')}"></td>
    <td><input class="td" type="number" min="0" value="${v('dia')}" aria-label="${t('trfDay')}"></td>
    <td><input class="tn" type="number" min="0" value="${v('noite')}" aria-label="${t('trfNight')}"></td>
    <td><input class="ts" type="number" min="0" value="${v('sinal')}" aria-label="${t('edTrfSinal')}"></td>
    <td><button type="button" class="mini ico" data-trfdel aria-label="${t('edRemove')}">×</button></td>
  </tr>`;
}
/* Ingresso de um passeio, como no PDF dela: "€25 por adulto, €15 ate 19
   anos, gratuito ate 7 anos" vira gratis ate 6, reduzido €15 ate 18,
   inteiro €25. O ingresso da guia (Sao Pedro: "+ €7 da guia") e cobrado uma
   vez. "Pago no dia" fica fora do total (os fones). */
function ingLinhaEd(g) {
  const v = (x) => x === undefined || x === null ? '' : esc(String(x));
  return `<tr>
    <td><input class="in" value="${v(g.nome && g.nome.pt)}" placeholder="Museus do Vaticano" aria-label="${t('edIngNome')}"></td>
    <td><input class="ig" type="number" min="0" max="99" value="${v(g.gratisAte)}" placeholder="—" aria-label="${t('edIngGratis')}"></td>
    <td><input class="ir" type="number" min="0" step="0.5" value="${v(g.reduzido)}" placeholder="—" aria-label="${t('edIngRed')}"></td>
    <td><input class="ira" type="number" min="0" max="99" value="${v(g.reduzidoAte)}" placeholder="—" aria-label="${t('edIngRedAte')}"></td>
    <td><input class="ii" type="number" min="0" step="0.5" value="${v(g.inteiro)}" aria-label="${t('edIngInteiro')}"></td>
    <td><input class="igu" type="number" min="0" step="0.5" value="${v(g.guia)}" placeholder="—" aria-label="${t('edIngGuia')}"></td>
    <td style="text-align:center"><input class="idia" type="checkbox" ${g.noDia ? 'checked' : ''} aria-label="${t('edIngDia')}"></td>
    <td><button type="button" class="mini ico" data-ingdel aria-label="${t('edRemove')}">×</button></td>
  </tr>`;
}
function lerIngLinhas() {
  const num = (v) => v === '' ? null : +v;
  return $$('#ingRows tr').map(tr => {
    const q = (c) => (tr.querySelector('.' + c) || {}).value ?? '';
    const nome = String(q('in')).trim();
    return { nome: { pt: nome, en: nome }, gratisAte: num(q('ig')), reduzido: +q('ir') || 0,
             reduzidoAte: num(q('ira')), inteiro: +q('ii') || 0, guia: +q('igu') || 0,
             noDia: !!(tr.querySelector('.idia') || {}).checked };
  }).filter(g => g.nome.pt && (g.inteiro > 0 || g.reduzido > 0));
}

function lerTrfLinhas() {
  return $$('#trfRows tr').map(tr => {
    const q = (c) => (tr.querySelector('.' + c) || {}).value || '';
    return { pax: +q('tp') || 0, veiculo: q('tv').trim(), malas: q('tm').trim(),
             dia: +q('td') || 0, noite: +q('tn') || 0, sinal: +q('ts') || 0 };
  }).filter(l => l.pax > 0 && (l.dia > 0 || l.noite > 0))
    /* na ordem da tabela: por pessoas, e o veiculo menor primeiro */
    .sort((a, b) => a.pax - b.pax || a.dia - b.dia);
}

function admTourEdit(id) {
  const isNew = id === 'new';
  const x = isNew
    ? { type: 'walk', region: regioes()[0][0], name: { pt: '', en: '' }, desc: { pt: '', en: '' },
        meeting: { pt: '', en: '' }, photo: 'capa.jpg', price: 45, priceMode: 'pp', min: 2, max: 12,
        payPolicy: 'split', status: 'draft' }
    : Tours.get(id);
  if (!x) return go('/adm/tours');

  const selOpts = (opts, cur) => opts.map(([v, k]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t(k)}</option>`).join('');
  admShell('tours', `
    <button class="linkbtn" id="bkT" aria-label="${t('admTours')}">← ${t('admTours')}</button>
    <h1 class="pageh">${isNew ? t('newTour').replace('+ ', '') : esc(x.name.pt)}</h1>
    <div class="formgrid">
      <section class="card">
        <label class="fld">${t('tType')}<select id="fType">${selOpts([['walk','tWalk'],['day','tDay'],['transfer','tTransfer'],['papal','tPapal'],['trem','tTrem'],['conexao','tConexao'],['barco','tBarco'],['photo','tPhotoT'],['session','tSession'],['bike','tBike']], x.type)}</select></label>
        <label class="fld">${t('tRegion')}<select id="fRegion">${regiaoOpts(x.region)}</select></label>
        <label class="fld">${t('tName')}<input id="fNamePt" value="${esc(x.name.pt)}"></label>
        <label class="optin enswitch"><input type="checkbox" id="verEn">
          <span><b>${t('enVer')}</b><small>${t('enAuto')}</small></span></label>
        <label class="fld campo-en">${t('tNameEn')}<input id="fNameEn" value="${esc(x.name.en)}"></label>
        <label class="fld">${t('edTagline')}<input id="fTagPt" value="${esc((x.tagline && x.tagline.pt) || '')}" placeholder="Entre vinhedos, castelos e vilarejos iluminados"><small class="why">${t('edTaglineWhy')}</small></label>
        <label class="fld campo-en">${t('edTagline')} (EN)<input id="fTagEn" value="${esc((x.tagline && x.tagline.en) || '')}"></label>
        <label class="fld">${t('tDesc')}<textarea id="fDescPt">${esc(x.desc.pt)}</textarea><small class="why">${t('tDescHelp')}</small></label>
        <label class="fld campo-en">${t('tDescEn')}<textarea id="fDescEn">${esc(x.desc.en)}</textarea></label>
        <label class="fld">${t('tMeeting')}<input id="fMeetPt" value="${esc(noIdioma(x.meeting))}"></label>
        <label class="fld campo-en">${t('tMeeting')} (EN)<input id="fMeetEn" value="${esc((x.meeting && x.meeting.en) || '')}"></label>
        ${typeof Pontos !== 'undefined' && Pontos.all().length ? `<div class="fld tp-pontos">Pontos de encontro deste passeio <small class="why">marque os que valem; o ◉ é o normal. No voucher você escolhe o de cada cliente. (A lista fica em Ajustes.)</small>
          ${Pontos.all().map(p => `<label class="tp-ponto"><input type="checkbox" data-tpponto="${esc(p.id)}" ${(x.pontos || []).includes(p.id) ? 'checked' : ''}><span>${esc(p.nome)}</span>
            <input type="radio" name="tpPadrao" value="${esc(p.id)}" ${x.pontoPadrao === p.id ? 'checked' : ''} aria-label="ponto normal"></label>`).join('')}</div>` : ''}
        <div class="fld">${t('tPhoto')}
          <div class="photopick">
            <span class="pprev" id="pPrev" style="background-image:url(${esc(x.photo || '')})">${x.photo ? '' : '<i>+</i>'}</span>
            <div class="ppinfo">
              <input type="file" accept="image/*" id="fPhoto">
              <small class="why">${t('tPhotoHelp')}</small>
            </div>
          </div>
        </div>
      </section>
      <section class="card">
        <h3>${t('edMoney')}</h3>
        <div class="frow">
          <label class="fld">${t('tPrice')}<input id="fPrice" type="number" value="${x.price}"></label>
          <label class="fld">${t('tPriceMode')}<select id="fMode">${selOpts([['pp','perPerson'],['session','perSession'],['tabela','perTable'],['transfer','perTransfer']], x.priceMode)}</select></label>
        </div>

        <div id="tabWrap" class="${x.priceMode === 'tabela' ? '' : 'hide'}">
          <div class="rulesep"></div>
          <b>${t('edTable')}</b>
          <p class="why">${t('edTableWhy')}</p>
          <div class="ptabedit">
            ${Array.from({ length: TABELA_MAX }, (_, i) => `
              <label class="fld sm"><span>${t('edTablePax', { n: i + 1 })}</span>
                <input class="ftab" data-i="${i}" type="number" min="0" inputmode="numeric"
                       value="${(x.tabela && +x.tabela[i]) || ''}"></label>`).join('')}
          </div>
        </div>

        <div id="trfWrap" class="${x.priceMode === 'transfer' ? '' : 'hide'}">
          <div class="rulesep"></div>
          <b>${t('edTrf')}</b>
          <p class="why">${t('edTrfWhy')}</p>
          <div class="trfedit-wrap"><table class="trfedit">
            <thead><tr><th>${t('edTrfPax')}</th><th>${t('edTrfVeic')}</th><th>${t('edTrfMalas')}</th><th>${t('trfDay')}</th><th>${t('trfNight')}</th><th>${t('edTrfSinal')}</th><th></th></tr></thead>
            <tbody id="trfRows">${((x.transfer && x.transfer.linhas) || []).map(trfLinhaEd).join('')}</tbody>
          </table></div>
          <button type="button" class="mini" id="trfAdd">${t('edTrfAdd')}</button>
        </div>

        <div class="rulesep"></div>
        <b>${t('edIng')}</b>
        <p class="why">${t('edIngWhy')}</p>
        <div class="trfedit-wrap"><table class="trfedit ingedit">
          <thead><tr><th>${t('edIngNome')}</th><th>${t('edIngGratis')}</th><th>${t('edIngRed')}</th><th>${t('edIngRedAte')}</th><th>${t('edIngInteiro')}</th><th>${t('edIngGuia')}</th><th>${t('edIngDia')}</th><th></th></tr></thead>
          <tbody id="ingRows">${(x.ingressos || []).map(ingLinhaEd).join('')}</tbody>
        </table></div>
        <button type="button" class="mini" id="ingAdd">${t('edIngAdd')}</button>

        <div class="rulesep"></div>
        <b>${t('edEarly')}</b>
        <p class="why">${t('edEarlyWhy')}</p>
        <div class="frow">
          <label class="fld">${t('edEarlySeats')}<input id="fEarlyN" type="number" min="0" value="${x.earlySeats || 0}" placeholder="3"></label>
          <label class="fld">${t('edLatePrice')}<input id="fLate" type="number" min="0" value="${x.priceLate || 0}" placeholder="225"></label>
        </div>
        <label class="fld">${t('edPriceNote')}<input id="fPNotePt" value="${esc((x.priceNote && x.priceNote.pt) || '')}" placeholder="Valor especial para as primeiras reservas, sujeito a disponibilidade."></label>
        <label class="fld campo-en">${t('edPriceNote')} (EN)<input id="fPNoteEn" value="${esc((x.priceNote && x.priceNote.en) || '')}"></label>

        <div class="rulesep"></div>
        <b>${t('edGroup')}</b>
        <div class="frow">
          <label class="fld">${t('tMin')}<input id="fMin" type="number" value="${x.min}"><small class="why">${t('edMinWhy')}</small></label>
          <label class="fld">${t('tMax')}<input id="fMax" type="number" value="${x.max}"></label>
        </div>
        <label class="optin"><input type="checkbox" id="fKids" ${x.criancas === false ? '' : 'checked'}>
          <span><b>${t('edKids')}</b><small>${t('edKidsWhy')}</small></span></label>
        <label class="fld">${t('edIdadeMin')}<input id="fIdadeMin" type="number" min="0" max="99" value="${+x.idadeMin || ''}" placeholder="—"><small class="why">${t('edIdadeMinWhy')}</small></label>

        <div class="rulesep"></div>
        <b>${t('edTerms')}</b>
        <div class="frow">
          <label class="fld">${t('tPay')}<select id="fPay">${selOpts([['full','tPayFull'],['split','tPaySplit'],['sinal','tPaySinal']], x.payPolicy)}</select></label>
          <label class="fld">${t('edBalanceDays')}<input id="fBalDays" type="number" min="0" value="${x.balanceDays || 1}"><small class="why">${t('edBalanceWhy')}</small></label>
        </div>
        <label class="fld">${t('edCancel')}<input id="fCancelPt" value="${esc((x.cancel && x.cancel.pt) || '')}" placeholder="Cancelamento gratis ate 48h antes"><small class="why">${t('edCancelWhy')}</small></label>
        <label class="fld campo-en">${t('edCancel')} (EN)<input id="fCancelEn" value="${esc((x.cancel && x.cancel.en) || '')}"></label>
        <label class="fld">${LANG === 'en' ? 'Tips for the voucher' : 'Dicas para o voucher'}<textarea id="fDicasPt" rows="3" placeholder="${LANG === 'en' ? 'What the guest needs on the day: dress code, where to meet...' : 'O que o cliente precisa saber no dia: como se vestir, onde encontrar, o que levar...'}">${esc((x.dicas && x.dicas.pt) || '')}</textarea></label>
        <label class="fld campo-en">${LANG === 'en' ? 'Tips for the voucher' : 'Dicas para o voucher'} (EN)<textarea id="fDicasEn" rows="3">${esc((x.dicas && x.dicas.en) || '')}</textarea></label>
        <div class="btnrow">
          <button class="cta sm" id="savePub">${t('savePub')}</button>
          <button class="mini" id="saveDraft">${t('saveDraft')}</button>
        </div>
      </section>
      <section class="card span2">
        <h3>${t('edRoute')}</h3>
        <p class="why">${t('edRouteWhy')}</p>
        <div class="frow">
          <label class="fld">${t('edDuration')}<input id="fDur" value="${esc(x.duration || '')}" placeholder="2h30"></label>
          <label class="fld">${t('edDistance')}<input id="fDist" value="${esc(x.distance || '')}" placeholder="3 km"></label>
        </div>
        <div id="stopList"></div>
        <button class="mini" id="addStop">+ ${t('edAddStop')}</button>
      </section>

      <section class="card span2">
        <h3>${t('included')}</h3>
        <p class="why">${t('edIncWhy')}</p>
        <div class="frow">
          <label class="fld">${t('included')} (PT)<textarea id="fIncPt" rows="4">${esc(linhas(x.includes, 'pt'))}</textarea></label>
          <label class="fld campo-en">${t('included')} (EN)<textarea id="fIncEn" rows="4">${esc(linhas(x.includes, 'en'))}</textarea></label>
        </div>
        <div class="frow">
          <label class="fld">${t('notIncluded')} (PT)<textarea id="fNincPt" rows="3">${esc(linhas(x.notIncludes, 'pt'))}</textarea></label>
          <label class="fld campo-en">${t('notIncluded')} (EN)<textarea id="fNincEn" rows="3">${esc(linhas(x.notIncludes, 'en'))}</textarea></label>
        </div>
        <div class="rulesep"></div>
        <b>${t('edClosing')}</b>
        <p class="why">${t('edClosingWhy')}</p>
        <label class="fld">PT<textarea id="fClosePt" rows="2">${esc((x.closing && x.closing.pt) || '')}</textarea></label>
        <label class="fld">EN<textarea id="fCloseEn" rows="2">${esc((x.closing && x.closing.en) || '')}</textarea></label>
      </section>

      ${isNew ? '' : `
      <section class="card span2" id="calCard">
        <h3>${t('whenRuns')}</h3>
        <p class="why autosave">${t('datesAutoSave')}</p>

        <div class="dtbloco">
          <span class="seclabel">${t('dtMarcadas')}</span>
          <div id="rulesList"></div>
        </div>

        <div class="dtbloco destaque">
          <span class="seclabel">${t('dtAdicionar')}</span>
          <div class="frow">
            <label class="fld">${t('dtDia')}<input id="oDate" type="date" value="${addDays(isoToday(), 7)}"></label>
            <label class="fld">${t('dtHora')}<input id="oTime" value="10:00" placeholder="09:00"></label>
            <label class="fld">${t('dtVagas')}<input id="oCap" type="number" min="1" value="${x.max}"></label>
          </div>
          <button class="cta sm" id="addOne">${t('dtBotao')}</button>
        </div>

        <details class="dtbloco">
          <summary><b>${t('dtRepetir')}</b><small class="why">${t('dtRepetirOpc')}</small></summary>
          <div class="ruleform">
            <label class="fld nolabel">${t('dtEscolhaDia')}</label>
            <div class="wdrow" id="wdRow">${t('wd').map((w, i) => `<button class="wd" data-w="${i}">${w}</button>`).join('')}</div>
            <div class="frow">
              <label class="fld">${t('dtHora')}<input id="rTime" value="16:30"></label>
              <label class="fld">${t('dtVagas')}<input id="rCap" type="number" min="1" value="${x.max}"></label>
            </div>
            <label class="fld nolabel">${t('dtPeriodo')}</label>
            <div class="frow">
              <label class="fld">${t('fromLbl')}<input id="rFrom" type="date" value="${isoToday()}"></label>
              <label class="fld">${t('untilLbl')}<input id="rUntil" type="date" value="${addDays(isoToday(), 60)}"></label>
            </div>
            <button class="mini" id="addRule">${t('addRule')}</button>
          </div>
        </details>
      </section>`}
    </div>

    <!-- O formulario e longo: os botoes de salvar ficavam la em cima e
         sumiam da vista. Esta barra acompanha a rolagem. -->
    <div class="savebar">
      <span class="sbwhat">${isNew ? t('sbNew') : esc(x.name.pt || t('sbTour'))}</span>
      <button class="mini" id="saveDraft2">${t('saveDraft')}</button>
      <button class="cta sm" id="savePub2">${t('savePub')}</button>
    </div>`);
  /* ---------- roteiro ---------- */
  let stops = JSON.parse(JSON.stringify(x.stops || []));
  function drawStops() {
    const box = $('#stopList');
    box.innerHTML = stops.length ? stops.map((p, i) => `
      <div class="stopcard" data-i="${i}">
        <div class="sctop">
          <span class="scnum">${i + 1}</span>
          <div class="scmove">
            <button class="mini ico" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${t('edUp')}">↑</button>
            <button class="mini ico" data-dn="${i}" ${i === stops.length - 1 ? 'disabled' : ''} aria-label="${t('edDown')}">↓</button>
            <button class="mini ico danger" data-rm="${i}" aria-label="${t('edRemove')}">✕</button>
          </div>
        </div>
        <div class="frow">
          <label class="fld">${t('edTime')}<input data-f="t" value="${esc(p.t || '')}" placeholder="17h00"></label>
          <label class="fld">${t('edPlace')}<input data-f="place" value="${esc(p.place || '')}" placeholder="Praça principal, cidade"></label>
        </div>
        <div class="frow">
          <label class="fld">${t('edStopName')} (PT)<input data-f="npt" value="${esc((p.n && p.n.pt) || '')}"></label>
          <label class="fld campo-en">${t('edStopName')} (EN)<input data-f="nen" value="${esc((p.n && p.n.en) || '')}"></label>
        </div>
        <div class="frow">
          <label class="fld">${t('edStopText')} (PT)<textarea data-f="dpt" rows="3">${esc((p.d && p.d.pt) || '')}</textarea></label>
          <label class="fld campo-en">${t('edStopText')} (EN)<textarea data-f="den" rows="3">${esc((p.d && p.d.en) || '')}</textarea></label>
        </div>
        <div class="photopick">
          <span class="pprev sm" style="background-image:url(${esc(p.ph || '')})">${p.ph ? '' : '<i>+</i>'}</span>
          <div class="ppinfo">
            <input type="file" accept="image/*" data-ph="${i}">
            <small class="why">${t('edStopPhoto')}</small>
          </div>
        </div>
      </div>`).join('') : `<p class="hint">${t('edNoStops')}</p>`;

    /* guarda o que for digitado, sem redesenhar — redesenhar aqui apagaria o texto */
    $$('[data-f]', box).forEach(el => el.oninput = () => {
      const i = +el.closest('.stopcard').dataset.i, v = el.value;
      const p = stops[i];
      if (el.dataset.f === 't') p.t = v;
      else if (el.dataset.f === 'place') p.place = v;
      else { p.n = p.n || {}; p.d = p.d || {};
        ({ npt: () => p.n.pt = v, nen: () => p.n.en = v,
           dpt: () => p.d.pt = v, den: () => p.d.en = v })[el.dataset.f](); }
    });
    $$('[data-up]', box).forEach(b2 => b2.onclick = () => {
      const i = +b2.dataset.up; [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]]; drawStops();
    });
    $$('[data-dn]', box).forEach(b2 => b2.onclick = () => {
      const i = +b2.dataset.dn; [stops[i + 1], stops[i]] = [stops[i], stops[i + 1]]; drawStops();
    });
    $$('[data-rm]', box).forEach(b2 => b2.onclick = () => {
      const i = +b2.dataset.rm;
      if (!confirm(t('edRemoveAsk'))) return;
      stops.splice(i, 1); drawStops();
    });
    $$('[data-ph]', box).forEach(inp => inp.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        /* 480px chega para a faixa do roteiro e não incha a sincronização */
        stops[+inp.dataset.ph].ph = await readImageResized(f, 480, 0.72);
        inp.closest('.photopick').querySelector('.pprev').style.backgroundImage = `url(${stops[+inp.dataset.ph].ph})`;
        inp.closest('.photopick').querySelector('.pprev').innerHTML = '';
        toast(t('tPhotoOk'));
      } catch (err) { toast(t('tPhotoBad')); }
    });
  }
  drawStops();
  $('#addStop').onclick = () => { stops.push({ t: '', place: '', n: { pt: '', en: '' }, d: { pt: '', en: '' }, ph: '' }); drawStops(); };

  let newPhoto = null;
  $('#fMode').onchange = (e) => {
    $('#trfWrap').classList.toggle('hide', e.target.value !== 'transfer');
    $('#tabWrap').classList.toggle('hide', e.target.value !== 'tabela');
  };
  $('#ingAdd').onclick = () => $('#ingRows').insertAdjacentHTML('beforeend', ingLinhaEd({}));
  $('#ingRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ingdel]'); if (b) b.closest('tr').remove();
  });
  $('#trfAdd').onclick = () => $('#trfRows').insertAdjacentHTML('beforeend', trfLinhaEd({}));
  $('#trfRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-trfdel]'); if (b) b.closest('tr').remove();
  });
  $('#fPhoto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      newPhoto = await readImageResized(f);
      $('#pPrev').style.backgroundImage = `url(${newPhoto})`;
      $('#pPrev').innerHTML = '';
      toast(t('tPhotoOk'));
    } catch (err) { toast(t('tPhotoBad')); }
  };
  $('#bkT').onclick = () => go('/adm/tours');

  /* a barra fixa reaproveita exatamente os mesmos botoes — sem segunda
     versao da logica de salvar, que e onde bugs se escondem */
  /* Os campos em ingles ficam escondidos: ela escreve so em portugues.
     Continuam no DOM (o salvamento le deles) e visiveis se ela quiser ajustar. */
  const editor = $('.formgrid') || app;
  const aplicaEn = () => editor.classList.toggle('mostra-en', !!$('#verEn')?.checked);
  $('#verEn')?.addEventListener('change', aplicaEn);
  aplicaEn();

  $('#savePub2').onclick   = () => $('#savePub').click();
  $('#saveDraft2').onclick = () => $('#saveDraft').click();

  function collect(status) {
    return {
      type: $('#fType').value, region: $('#fRegion').value,
      name: { pt: $('#fNamePt').value.trim(), en: $('#fNameEn').value.trim() || $('#fNamePt').value.trim() },
      desc: { pt: $('#fDescPt').value.trim(), en: $('#fDescEn').value.trim() || $('#fDescPt').value.trim() },
      meeting: par('#fMeetPt', '#fMeetEn'),
      pontos: $$('[data-tpponto]').filter(el => el.checked).map(el => el.dataset.tpponto),
      pontoPadrao: ($('input[name="tpPadrao"]:checked') || {}).value || '',
      price: +$('#fPrice').value || 0, priceMode: $('#fMode').value,
      tabela: $$('.ftab').sort((p, q) => +p.dataset.i - +q.dataset.i).map(el => +el.value || 0),
      transfer: { linhas: lerTrfLinhas() },
      ingressos: lerIngLinhas(),
      criancas: $('#fKids').checked, idadeMin: Math.max(0, +$('#fIdadeMin').value || 0),
      min: +$('#fMin').value || 1, max: +$('#fMax').value || 1,
      payPolicy: $('#fPay').value,
      /* guarda qual portugues gerou o ingles atual: se nao mudar,
         nao traduz de novo e o ajuste manual dela sobrevive */
      trSig: x.trSig || {},
      photo: newPhoto || x.photo, status,
      duration: $('#fDur').value.trim(), distance: $('#fDist').value.trim(),
      tagline:   par('#fTagPt', '#fTagEn'),
      priceNote: par('#fPNotePt', '#fPNoteEn'),
      cancel:    par('#fCancelPt', '#fCancelEn'),
      dicas:     par('#fDicasPt', '#fDicasEn'),
      closing:   par('#fClosePt', '#fCloseEn'),
      earlySeats: +$('#fEarlyN').value || 0,
      priceLate:  +$('#fLate').value || 0,
      balanceDays: Math.max(0, +$('#fBalDays').value || 1),
      includes:    { pt: itens('#fIncPt'),  en: itens('#fIncEn')  },
      notIncludes: { pt: itens('#fNincPt'), en: itens('#fNincEn') },
      /* joga fora parada sem nome — linha em branco na página do cliente é pior que nada */
      stops: stops.filter(p => (p.n && p.n.pt || '').trim()),
    };
  }
  function itens(sel) {
    return $(sel).value.split('\n').map(l => l.trim()).filter(Boolean);
  }
  /* par de campos PT/EN: se o ingles ficar vazio, repete o portugues em vez
     de deixar o cliente estrangeiro sem nada na tela. */
  function par(selPt, selEn) {
    const pt = ($(selPt) && $(selPt).value.trim()) || '';
    const en = ($(selEn) && $(selEn).value.trim()) || '';
    return { pt, en: en || pt };
  }
  function validate(data) {
    const problems = [];
    if (!data.name.pt) problems.push(['fNamePt', t('vName')]);
    if (!data.desc.pt) problems.push(['fDescPt', t('vDesc')]);
    if (!data.meeting.pt) problems.push(['fMeetPt', t('vMeet')]);
    if (data.priceMode === 'transfer') {
      if (!(data.transfer && data.transfer.linhas || []).length) problems.push(['fMode', t('vTrf')]);
    } else if (data.priceMode === 'tabela') {
      if (!(data.tabela || []).some(v => +v > 0)) problems.push(['fMode', t('vTable')]);
    } else if (!(data.price > 0)) problems.push(['fPrice', t('vPrice')]);
    if (data.min > data.max) problems.push(['fMin', t('vMinMax')]);
    $$('.fld .err').forEach(e => e.remove());
    $$('.fld input, .fld textarea').forEach(e => e.classList.remove('invalid'));
    problems.forEach(([id, msg]) => {
      const el = $('#' + id); if (!el) return;
      el.classList.add('invalid');
      const s = document.createElement('small');
      s.className = 'err'; s.textContent = msg;
      el.insertAdjacentElement('afterend', s);
    });
    if (problems.length) {
      const first = $('#' + problems[0][0]);
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      first?.focus();
      toast(t('vFix', { n: problems.length }));
    }
    return problems.length === 0;
  }
  /* Traduz o que mudou e escreve nos campos em ingles ANTES de coletar.
     Se falhar, os campos ficam como estavam — o ingles velho e melhor que
     nenhum — e ela decide se salva assim mesmo. */
  async function traduzAntesDeSalvar() {
    if (typeof traduzCampos !== 'function') return true;
    const mapa = {
      fNamePt: 'fNameEn', fTagPt: 'fTagEn', fDescPt: 'fDescEn',
      fPNotePt: 'fPNoteEn', fCancelPt: 'fCancelEn', fIncPt: 'fIncEn', fNincPt: 'fNincEn',
      fMeetPt: 'fMeetEn',
    };
    const campos = {};
    for (const [pt, en] of Object.entries(mapa)) {
      const ept = $('#' + pt), een = $('#' + en);
      if (!ept || !een) continue;
      const v = ept.value.trim();
      if (v) campos[en] = v;
    }
    /* paradas: nome e texto de cada uma */
    $$('#stopList .stopcard').forEach((row, i) => {
      const npt = row.querySelector('[data-f="npt"]'), npn = row.querySelector('[data-f="nen"]');
      const dpt = row.querySelector('[data-f="dpt"]'), dpn = row.querySelector('[data-f="den"]');
      if (npt && npn && npt.value.trim()) campos['stop' + i + 'n'] = npt.value.trim();
      if (dpt && dpn && dpt.value.trim()) campos['stop' + i + 'd'] = dpt.value.trim();
    });
    if (!Object.keys(campos).length) return true;

    const btn = $('#savePub'); const rotulo = btn.textContent;
    btn.disabled = true; btn.textContent = t('enTraduzindo');
    const antes = (x.trSig || {});
    let r;
    try { r = await traduzCampos(campos, antes); }
    catch (e) { r = { textos: {}, assinaturas: antes, falhas: Object.keys(campos) }; }
    btn.disabled = false; btn.textContent = rotulo;

    for (const [chave, en] of Object.entries(r.textos)) {
      if (chave.startsWith('stop')) {
        const i = +chave.match(/stop(\d+)/)[1];
        const campo = chave.endsWith('n') ? 'nen' : 'den';
        const row = $$('#stopList .stopcard')[i];
        if (row) { const el = row.querySelector(`[data-f="${campo}"]`); if (el) el.value = en; }
      } else {
        const el = $('#' + chave); if (el) el.value = en;
      }
    }
    x.trSig = r.assinaturas;
    if (r.falhas.length) return confirm(t('enFalhou'));
    if (Object.keys(r.textos).length) toast(t('enPronto'));
    return true;
  }

  $('#savePub').onclick = async () => {
    if (!(await traduzAntesDeSalvar())) return;
    const data = collect('live');
    if (!validate(data)) return;
    if (!data.name.pt) return toast(LANG === 'pt' ? 'Dê um nome ao passeio.' : 'Give the tour a name.');
    if (isNew) { const nt = Tours.create(data); toast(t('published')); go('/adm/tours/' + nt.id); }
    else { Tours.update(x.id, data); if (typeof Precos !== 'undefined' && Precos.doCatalogo) Precos.doCatalogo(x.id); toast(t('published')); go('/adm/tours'); }
  };
  $('#saveDraft').onclick = () => {
    if (!$('#fNamePt').value.trim()) { $('#fNamePt').classList.add('invalid'); $('#fNamePt').focus(); return toast(t('vName')); }
    const data = collect('draft');
    if (isNew) { const nt = Tours.create(data); go('/adm/tours/' + nt.id); }
    else { Tours.update(x.id, data); if (typeof Precos !== 'undefined' && Precos.doCatalogo) Precos.doCatalogo(x.id); go('/adm/tours'); }
    toast(t('draft'));
  };

  if (!isNew) {
    const wds = new Set();
    $$('#wdRow .wd').forEach(b => b.onclick = () => {
      const w = +b.dataset.w;
      wds.has(w) ? wds.delete(w) : wds.add(w);
      b.classList.toggle('on', wds.has(w));
    });
    $('#addRule').onclick = () => {
      if (!wds.size) return toast(LANG === 'pt' ? 'Escolha os dias da semana.' : 'Pick the weekdays.');
      Cal.addRule({ tourId: x.id, weekdays: [...wds], time: $('#rTime').value, capacity: +$('#rCap').value || x.max, from: $('#rFrom').value, until: $('#rUntil').value });
      drawRules(); toast('✓');
    };
    $('#addOne').onclick = () => {
      Cal.addDeparture({ tourId: x.id, date: $('#oDate').value, time: $('#oTime').value, capacity: +$('#oCap').value || x.max });
      drawRules(); toast('✓');
    };
    function drawRules() {
      const rules = Cal.rulesFor(x.id);
      const ones = DB.departures.filter(d => d.tourId === x.id);
      $('#rulesList').innerHTML =
        (rules.length || ones.length)
          ? rules.map(r => `<div class="deprow"><span>${r.weekdays.map(w => t('wd')[w]).join(', ')} · <b class="mono">${r.time}</b> · ${r.from} → ${r.until}</span><button class="mini danger" data-rr="${r.id}">×</button></div>`).join('')
            + ones.map(d => `<div class="deprow"><span>${fmtDate(d.date)} · <b class="mono">${d.time}</b> · ${d.capacity} ${t('spotsLeft')}</span><button class="mini danger" data-rd="${d.id}">×</button></div>`).join('')
          : `<p class="empty">${t('noDates')}</p>`;
      $$('[data-rr]').forEach(b => b.onclick = () => { Cal.removeRule(b.dataset.rr); drawRules(); });
      $$('[data-rd]').forEach(b => b.onclick = () => { Cal.removeDeparture(b.dataset.rd); drawRules(); });
    }
    drawRules();
  }
}

/* ---- Reservas ---- */
/* A conta aparece SEMPRE: quanto entrou, de quanto, e o que falta.
   Sem isso o guia olha a lista e nao sabe quem pagou metade. */
function situacaoPgto(b, hoje) {
  const total = +b.total || 0;
  const pago = Bookings.paid(b);
  const falta = Math.max(0, total - pago);
  const conta = t('stDeTotal', { pago: eur(pago), total: eur(total) })
              + (falta > 0 ? ' · ' + t('stFalta', { v: eur(falta) }) : '');

  if (b.status === 'cancelled') return { classe: 'n', titulo: t('cancelled'), conta, aberta: false };
  if (falta <= 0)               return { classe: 'ok', titulo: t('stPago'), conta, aberta: false };

  const prazo = Bookings.dueDate(b);
  if (prazo < hoje) {
    const dias = Math.round((new Date(hoje) - new Date(prazo)) / 864e5);
    return { classe: 'bad', titulo: t('stAtrasado', { n: dias }), conta, aberta: true };
  }
  return {
    classe: 'warn',
    titulo: pago > 0 ? t('stSinal') : t('stEsperando'),
    conta: conta + ' · ' + t('stAte', { d: fmtDate(prazo) }),
    aberta: true,
  };
}

/* Os pedidos de "Monte seu roteiro", no topo das reservas: e trabalho a
   fazer, e novo fica em cima. */
function pedidosHtml() {
  const ps = Roteiros.all();
  const novos = ps.filter(p => !p.respondido).length;
  const d = (iso) => iso ? fmtDate(iso) : '';
  return `<details class="card pedidos" ${novos ? 'open' : ''}>
    <summary><b>🗺️ ${t('pdTit')}</b>${novos ? ` <span class="pill warn">${novos} ${t('pdNovo').toLowerCase()}</span>` : ''}</summary>
    ${ps.length ? ps.map(p => `<div class="pedido ${p.respondido ? 'resp' : ''}">
      <div class="pdtop"><b>${esc(p.nome)}</b>
        <span class="pill ${p.respondido ? 'ok' : 'warn'}">${p.respondido ? t('pdResp') : t('pdNovo')}</span></div>
      <small>${[d(p.ini), d(p.fim)].filter(Boolean).join(' → ') || '—'} · ${p.adultos} ${t('adultsLbl').toLowerCase()}${p.criancas ? ' + ' + p.criancas + ' ' + t('kidsLbl').toLowerCase() : ''}</small>
      <pre class="pdmsg">${esc(msgRoteiro(p))}</pre>
      <div class="tacts">
        ${p.whats ? `<a class="mini cta-ish" target="_blank" rel="noopener" href="${waLink(t('waHi', { name: p.nome.split(' ')[0], tour: '', when: '' }), p.whats.replace(/\D/g, ''))}">${t('pdAbrir')}</a>` : ''}
        <button class="mini" data-pdm="${esc(p.id)}" data-v="${p.respondido ? '0' : '1'}">${p.respondido ? t('pdDesmarca') : t('pdMarca')}</button>
      </div>
    </div>`).join('') : `<p class="why">${t('pdVazio')}</p>`}
  </details>`;
}

function admBookings() {
  const list = Bookings.all();
  const today = isoToday();
  admShell('bookings', `
    <h1 class="pageh">${t('admBookings')}</h1>
    ${pedidosHtml()}
    <details class="card novares">
      <summary><b>${t('novaResTit')}</b><small class="why">${t('novaResSub')}</small></summary>
      <div class="frow">
        <label class="fld">${t('nrPasseio')}<select id="nrTour">${Tours.all().map(tt =>
          `<option value="${esc(tt.id)}">${esc(tt.name[LANG] || tt.name.pt)}</option>`).join('')}</select></label>
        <label class="fld">${t('nrPessoas')}<input id="nrPax" type="number" min="1" value="2"></label>
      </div>
      <div class="frow">
        <label class="fld">${t('nrData')}<input id="nrData" type="date"></label>
        <label class="fld">${t('nrHora')}<input id="nrHora" value="09:00"></label>
      </div>
      <div class="frow">
        <label class="fld">${t('nrNome')}<input id="nrNome" placeholder="Maria Silva"></label>
        <label class="fld">${t('nrWhats')}<input id="nrWhats" placeholder="+55 11 ..."></label>
      </div>
      <label class="fld">${t('nrEmail')}<input id="nrEmail" type="email"></label>
      <div class="frow">
        <label class="fld">${t('nrValor')}<input id="nrValor" type="number" min="0" step="1"></label>
        <label class="fld">${t('nrRecebido')}<input id="nrRecebido" type="number" min="0" step="1" value="0"></label>
      </div>
      <p class="why">${t('nrValorAuto')}</p>
      <label class="fld">${t('nrComo')}<select id="nrComo">
        <option value="">${t('nrNada')}</option>
        ${[['pix','mPix'],['transfer','mTransfer'],['cash','mCash'],['card','mCard'],['other','mOther']]
          .map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join('')}
      </select></label>
      <button class="cta sm" id="nrSalvar">${t('nrSalvar')}</button>
    </details>
    ${list.length ? `<div class="tlist">${list.map(b => {
      const x = Tours.get(b.tourId);
      const due = Bookings.due(b);
      const st = situacaoPgto(b, today);
      const pill = `<span class="pill conta ${st.classe}"><b>${st.titulo}</b><small>${st.conta}</small></span>`;
      const act = st.aberta ? `<button class="mini strong" data-got="${esc(b.id)}">${t('gotBalance')}</button>` : '';
      /* Avisar o cliente so aparece quando faz sentido: o aviso esta ligado,
         a reserva tem e-mail, nao esta cancelada e ainda nao foi avisada.
         Botao que nao pode dar em nada e so ruido no painel dela. */
      const podeConf = DB.settings.avisarClientes && b.email
                       && b.status !== 'cancelled' && !b.clienteConfirmado;
      const conf = podeConf
        ? `<button class="mini strong" data-conf="${esc(b.id)}">${t('confCliente')}</button>`
        : (b.clienteConfirmado ? `<span class="mini done">${t('confClienteFeito')}</span>` : '');
      const first = b.name.split(' ')[0];
      const tourName = x ? (x.name[LANG] || x.name.pt) : '';
      const waText = (b.status !== 'cancelled' && due > 0)
        ? t('waCharge', { name: first, v: eur(due), tour: tourName, when: fmtDate(b.date) })
        : t('waHi', { name: first, tour: tourName, when: fmtDate(b.date) + ' ' + b.time });
      const wa = waLink(waText, (b.whats || '').replace(/\D/g, ''));
      /* cobrar é mandar mensagem. É este o botão que a palavra "cobrar" promete. */
      const cobrar = b.whats
        ? `<a class="mini cta-ish" target="_blank" rel="noopener" href="${wa}">${due > 0 ? t('askPay') : t('sendMsg')}</a>`
        : (b.email
            ? `<a class="mini cta-ish" href="mailto:${esc(b.email)}?subject=${encodeURIComponent(tourName)}&body=${encodeURIComponent(waText)}">${t('askPayMail')}</a>`
            : '');
      /* O grupo aparece aqui porque e aqui que ela olha na vespera do
         passeio: quem vem, e a data de nascimento para os ingressos. */
      const grupo = (b.group && b.group.length)
        ? `<small class="grpline"><b>${t('grpInBooking')}:</b> ` +
          b.group.map(g => esc(g.nome) + (g.nasc ? ' (' + esc(g.nasc) + ')' : '')).join(' · ') + '</small>'
        : '';
      const veic = b.veiculo ? ' · ' + esc(b.veiculo) : '';
      return `<div class="trow">
        <div class="tinfo"><b>${esc(b.name)}</b>
          <small>${esc(x ? x.name.pt : '?')} · ${fmtDate(b.date)} ${esc(b.time)} · ${esc(b.pax)}p${veic} · <span class="mono">${esc(b.code)}</span></small>${grupo}</div>
        <b class="mono">${eur(b.total)}</b>${pill}
        <div class="tacts" id="ta-${esc(b.id)}">${cobrar}${act}${conf}</div>
      </div>`;
    }).join('')}</div>`
    : `<div class="emptybox"><p>${t('emptyBookings')}</p></div>`}`);
  $$('[data-pdm]').forEach(b => b.onclick = () => {
    Roteiros.marca(b.dataset.pdm, b.dataset.v === '1'); admBookings();
  });
  /* ---- lancamento manual ---- */
  const nrRecalcula = () => {
    const tt = Tours.get($('#nrTour').value);
    const pax = +$('#nrPax').value || 1;
    const d = $('#nrData').value, h = $('#nrHora').value;
    if (!tt) return;
    /* mesmo calculo do checkout, inclusive o preco escalonado da data */
    const pr = Bookings.precoDe(tt, tt.id, d, h, pax);
    $('#nrValor').value = pr.total;
  };
  ['#nrTour', '#nrPax', '#nrData', '#nrHora'].forEach(sel => {
    const el = $(sel); if (el) el.addEventListener('change', nrRecalcula);
  });
  if ($('#nrData')) { $('#nrData').value = isoToday(); nrRecalcula(); }

  $('#nrSalvar').onclick = () => {
    const nome = $('#nrNome').value.trim();
    if (!nome) { $('#nrNome').focus(); return toast(t('nrFaltaNome')); }
    const tourId = $('#nrTour').value, data = $('#nrData').value, hora = $('#nrHora').value.trim();
    if (!data) { $('#nrData').focus(); return toast(t('nrFaltaData')); }
    const pax = +$('#nrPax').value || 1;
    /* nao deixa estourar a lotacao da saida — a agenda tem que continuar honesta */
    const tt = Tours.get(tourId);
    const livres = Cal.seatsLeft(tourId, data, hora, tt ? tt.max : pax);
    if (Number.isFinite(livres) && pax > livres) return toast(t('nrSemVaga', { n: Math.max(0, livres) }));

    Bookings.criarManual({
      tourId, date: data, time: hora, name: nome,
      whats: $('#nrWhats').value.trim(), email: $('#nrEmail').value.trim(),
      pax, total: +$('#nrValor').value || 0,
      recebido: +$('#nrRecebido').value || 0, metodo: $('#nrComo').value || 'other',
    });
    toast(t('nrFeita'));
    admBookings();
  };

  /* Dar baixa move dinheiro no extrato. Antes de gravar, perguntamos COMO
     ela recebeu — o botão antigo cravava "cartão" e o extrato saía mentindo. */
  /* Avisar o cliente e irreversivel: o e-mail sai e nao volta. Por isso
     pergunta antes, dizendo para quem vai. */
  $$('[data-conf]').forEach(btn => btn.onclick = () => {
    const b = Bookings.get(btn.dataset.conf);
    if (!b) return;
    if (!confirm(t('confClienteAsk', { email: b.email }))) return;
    Bookings.confirmarCliente(b.id);
    toast(t('confClienteOk', { name: b.name.split(' ')[0] }));
    admBookings();
  });
  $$('[data-got]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.got;
    const cx = document.getElementById('ta-' + id);
    if (!cx) return;
    const formas = [['pix','mPix'],['card','mCard'],['cash','mCash'],['transfer','mTransfer'],['other','mOther']];
    cx.innerHTML = `<span class="howgot">${t('howGot')}:</span>`
      + formas.map(([v, k]) => `<button class="mini" data-m="${v}">${t(k)}</button>`).join('')
      + `<button class="mini ghost" data-m="">${t('cancelSm')}</button>`;
    $$('[data-m]', cx).forEach(b2 => b2.onclick = () => {
      if (!b2.dataset.m) return admBookings();
      const b = Bookings.get(id);
      Bookings.payBalance(id, b2.dataset.m);
      toast(t('charged', { v: eur(b.payments.at(-1).amount), n: b.name.split(' ')[0] }));
      admBookings();
    });
  });
}

const METODO = { pix: 'mPix', card: 'mCard', cash: 'mCash', transfer: 'mTransfer',
                 applepay: 'mApple', other: 'mOther' };
function formaPg(m) { return METODO[m] ? t(METODO[m]) : (m || '—'); }

/* ---- Extrato ---- */
/* Para onde o dinheiro caiu. Pix e conta brasileira e nao entra na
   contabilidade francesa; todo o resto entra na conta europeia dela.
   Regra unica e visivel — se um dia surgir outro meio brasileiro, muda aqui. */
const PGTO_BRASIL = ['pix'];
function destinoPgto(metodo) {
  return PGTO_BRASIL.includes(String(metodo || '').toLowerCase()) ? 'brasil' : 'europa';
}

/* Contabilidade por conta (operacao-telas.js): cada conta sabe de que lado
   fica, e cada contador recebe so o dele. */
function admMoney() { admContabilidade(); }

/* ---- Cupons ---- */
function admCoupons() {
  const list = Coupons.all();
  admShell('coupons', `
    <div class="pagehead"><h1 class="pageh">${t('admCoupons')}</h1></div>
    <section class="card">
      <div class="frow">
        <label class="fld">${t('cCode')}<input id="cC" placeholder="VOLTA10"></label>
        <label class="fld">${t('cPct')}<input id="cP" type="number" value="10"></label>
        <label class="fld">${t('cUntil')}<input id="cU" type="date" value="${addDays(isoToday(), 90)}"></label>
        <label class="fld chk"><input id="cO" type="checkbox" checked> ${t('cOnce')}</label>
        <button class="cta sm" id="cAdd">${t('create')}</button>
      </div>
    </section>
    ${list.length ? `<div class="tlist">${list.map(c => `
      <div class="trow"><div class="tinfo"><b class="mono">${esc(c.code)}</b>
        <small>−${c.pct}% · ${t('cUntil').toLowerCase()} ${c.until} · ${t('cUses', { n: c.uses.length })}</small></div>
        <button class="mini danger" data-cd="${esc(c.code)}">×</button></div>`).join('')}</div>`
    : `<div class="emptybox"><p>${t('emptyCoupons')}</p></div>`}`);
  $('#cAdd').onclick = () => {
    const code = $('#cC').value.trim().toUpperCase();
    if (!code) return;
    Coupons.create({ code, pct: +$('#cP').value || 10, until: $('#cU').value, oncePerPerson: $('#cO').checked, uses: [] });
    admCoupons();
  };
  $$('[data-cd]').forEach(b => b.onclick = () => { Coupons.remove(b.dataset.cd); admCoupons(); });
}

/* ---- Ajustes ---- */
/* Aparencia ganhou tela propria na barra lateral: estava enterrada dentro
   de Ajustes, junto com coisas que nao tem nada a ver. */
/* Linhas editaveis da Aparencia: os links de parceiros da primeira tela e
   as cidades/regioes da vitrine. */
function linkEd(l) {
  const v = (x) => esc(x || '');
  return `<div class="edrow" data-id="${v(l.id)}">
    <div class="frow">
      <label class="fld sm">${t('apIcone')}<input class="li" value="${v(l.icone)}" placeholder="🏨" maxlength="4"></label>
      <label class="fld">${t('apTitulo')}<input class="lt" value="${v(l.titulo && l.titulo.pt)}"></label>
      <button type="button" class="mini ico danger" data-del aria-label="${t('edRemove')}">✕</button>
    </div>
    <label class="fld">${t('apSub')}<input class="ls" value="${v(l.sub && l.sub.pt)}"></label>
    <label class="fld">Link<input class="lu" value="${v(l.url)}" placeholder="https://…"></label>
    <div class="frow">
      <label class="fld">${t('apTitulo')} (EN)<input class="lte" value="${v(l.titulo && l.titulo.en)}"></label>
      <label class="fld">${t('apSub')} (EN)<input class="lse" value="${v(l.sub && l.sub.en)}"></label>
    </div>
  </div>`;
}
function regEd(r) {
  const v = (x) => esc(x || '');
  const usados = r[0] ? Tours.all().filter(x => x.region === r[0]).length : 0;
  return `<div class="edrow" data-cod="${v(r[0])}">
    <div class="frow">
      <label class="fld">${t('apRegNome')}<input class="rp" value="${v(r[1])}" placeholder="Florença"></label>
      <label class="fld">${t('apRegNome')} (EN)<input class="re" value="${v(r[2])}" placeholder="Florence"></label>
      ${usados ? `<small class="why regn">${usados} ${t('apRegUsos')}</small>`
               : `<button type="button" class="mini ico danger" data-del aria-label="${t('edRemove')}">✕</button>`}
    </div>
  </div>`;
}

function admAparencia() {
  const opcao = (v, k, desc) => `
    <button class="lookcard ${temaAtual() === v ? 'on' : ''}" data-tema="${v}">
      <span class="lookprev ${v}"><i></i><i></i><i></i></span>
      <b>${t(k)}</b><small>${desc}</small>
    </button>`;
  admShell('look', `
    <h1 class="pageh">${t('temaTit')}</h1>
    <p class="why">${t('temaHelp')}</p>
    <section class="card">
      <div class="lookgrid">
        ${opcao('auto',  'temaAuto',   t('temaAutoSub'))}
        ${opcao('light', 'temaClaro',  t('temaClaroSub'))}
        ${opcao('dark',  'temaEscuro', t('temaEscuroSub'))}
      </div>
    </section>

    <section class="card">
      <h3>${t('apRedes')}</h3>
      <p class="why">${t('apRedesWhy')}</p>
      <div class="frow">
        <label class="fld">Instagram<input id="apInsta" value="${esc(DB.settings.insta || '')}" placeholder="em_roma"></label>
        <label class="fld">YouTube<input id="apYt" value="${esc(DB.settings.youtube || '')}" placeholder="https://youtube.com/…"></label>
      </div>
      <div class="frow">
        <label class="fld">Blog / site<input id="apBlog" value="${esc(DB.settings.blog || '')}" placeholder="https://…"></label>
        <label class="fld">Facebook<input id="apFb" value="${esc(DB.settings.facebook || '')}" placeholder="https://facebook.com/…"></label>
      </div>
    </section>

    <section class="card">
      <h3>${t('apLinks')}</h3>
      <p class="why">${t('apLinksWhy')}</p>
      <div id="apLinkRows">${(DB.settings.links || []).map(linkEd).join('')}</div>
      <button type="button" class="mini" id="apLinkAdd">${t('apLinkAdd')}</button>
    </section>

    <section class="card">
      <h3>${t('apRegs')}</h3>
      <p class="why">${t('apRegsWhy')}</p>
      <div id="apRegRows">${regioes().map(regEd).join('')}</div>
      <button type="button" class="mini" id="apRegAdd">${t('apRegAdd')}</button>
    </section>

    <button class="cta" id="apSalvar">${t('apSalvar')}</button>`);
  $('#apLinkAdd').onclick = () => $('#apLinkRows').insertAdjacentHTML('beforeend', linkEd({}));
  $('#apRegAdd').onclick  = () => $('#apRegRows').insertAdjacentHTML('beforeend', regEd([]));
  [$('#apLinkRows'), $('#apRegRows')].forEach(box => box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (b) b.closest('.edrow').remove();
  }));
  $('#apSalvar').onclick = () => {
    const st = DB.settings;
    st.insta = $('#apInsta').value.trim().replace(/^@/, '');
    st.youtube = $('#apYt').value.trim(); st.blog = $('#apBlog').value.trim(); st.facebook = $('#apFb').value.trim();
    st.links = $$('#apLinkRows .edrow').map(r => {
      const q = (c) => (r.querySelector('.' + c) || {}).value || '';
      return { id: r.dataset.id || uid(), icone: q('li').trim() || '🔗', url: q('lu').trim(),
               titulo: { pt: q('lt').trim(), en: q('lte').trim() || q('lt').trim() },
               sub: { pt: q('ls').trim(), en: q('lse').trim() || q('ls').trim() } };
    }).filter(l => l.url && l.titulo.pt);
    /* regioes: o codigo nasce do nome e NAO muda depois — e ele que liga o
       passeio a regiao. Trocar o nome de "Roma" nao pode soltar 14 passeios. */
    const usados = new Set();
    st.regioes = $$('#apRegRows .edrow').map(r => {
      const pt = (r.querySelector('.rp') || {}).value.trim(), en = (r.querySelector('.re') || {}).value.trim();
      let c = r.dataset.cod || pt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      while (c && usados.has(c)) c += '-2';
      usados.add(c);
      return [c, pt, en || pt];
    }).filter(r => r[0] && r[1]);
    save(); toast(t('apSalvo')); admAparencia();
  };
  $$('[data-tema]').forEach(b => b.onclick = () => {
    aplicaTema(b.dataset.tema);
    $$('[data-tema]').forEach(z => z.classList.toggle('on', z === b));
    toast(t('temaSalvo'));
  });
}

/* Mostra o e-mail inteiro que o cliente recebe, com as partes dela editaveis
   e o miolo travado. O miolo fica travado de proposito: ele carrega os dados
   da reserva, o Pix, e a frase que diz que o recibo NAO e comprovante de
   pagamento. Ela apagar essa frase sem perceber faria cliente que nao pagou
   achar que esta tudo certo. */
function cartaoEmail(qual) {
  const s = DB.settings, ehRecibo = qual === 'recibo';
  const iK = ehRecibo ? 'emailReciboIntro' : 'emailConfIntro';
  const pK = ehRecibo ? 'emailReciboPS'    : 'emailConfPS';
  const val = (k, l) => esc(((s[k] || {})[l]) || '');
  const fixo = (txt) => `<p class="emfixo">${txt}</p>`;
  return `
    <div class="emcard">
      <b class="emtit">${t(ehRecibo ? 'emRecTit' : 'emConfTit')}</b>
      <small class="why">${t(ehRecibo ? 'emRecQuando' : 'emConfQuando')}</small>

      ${fixo(t('emOla'))}
      <label class="fld">${t('emIntro')} (PT)
        <textarea id="${qual}IntroPt" rows="2" placeholder="${esc(t(ehRecibo ? 'emRecIntroPad' : 'emConfIntroPad'))}">${val(iK, 'pt')}</textarea></label>
      <label class="fld">${t('emIntro')} (EN)
        <textarea id="${qual}IntroEn" rows="2" placeholder="${esc(t(ehRecibo ? 'emRecIntroPadEn' : 'emConfIntroPadEn'))}">${val(iK, 'en')}</textarea></label>

      ${fixo(t('emDados'))}
      ${ehRecibo ? fixo(t('emPix')) : ''}
      ${ehRecibo ? `<p class="emtrava">${t('emAviso')}</p>` : ''}

      <label class="fld">${t('emPS')} (PT)
        <textarea id="${qual}PsPt" rows="2" placeholder="${esc(t('emPSex'))}">${val(pK, 'pt')}</textarea></label>
      <label class="fld">${t('emPS')} (EN)
        <textarea id="${qual}PsEn" rows="2" placeholder="${esc(t('emPSexEn'))}">${val(pK, 'en')}</textarea></label>

      ${fixo(t('emAssina'))}
      <small class="why">${t('emVazio')}</small>
    </div>`;
}

function admSettings() {
  admShell('settings', `
    <h1 class="pageh">${t('admSettings')}</h1>
    ${typeof visualHtml === 'function' ? visualHtml() : ''}
    <section class="card">
      <h3>${t('language')}</h3>
      ${langBar()}
    </section>
    ${DB.demo ? `<div class="demobar">
      <b>🧪 ${t('demoOn')}</b>
      <p>${t('demoWhat')}</p>
      <button class="cta sm" id="demoClear">${t('demoClear')}</button>
    </div>` : `<div class="demobar">
      <b>${t('demoRestore')}</b>
      <p>${t('demoWhat')}</p>
      <button class="mini" id="demoRestore">${t('demoRestore')}</button>
    </div>`}
    <section class="card">
      <h3>${t('yourContact')}</h3>
      ${DB.settings.placeholderContact ? `<div class="alert warn">⚠ ${t('placeholderWarn')}</div>` : ''}
      <p class="why">${t('contactHelp')}</p>
      <div class="frow">
        <label class="fld">${t('yourWhats')}<input id="setWhats" value="${esc(DB.settings.whats)}" placeholder="+33 6 12 34 56 78"></label>
        <label class="fld">${t('yourInsta')}<input id="setInsta" value="${esc(DB.settings.insta)}" placeholder="seu.instagram"></label>
        <button class="cta sm" id="setContactSave">${t('saveBtn')}</button>
      </div>
    </section>
    <section class="card">
      <h3>${t('admHome')}</h3>
      <p class="why">${t('admHomeHelp')}</p>
      <div class="ph-edit">
        <img id="hmThumb" src="${esc(DB.settings.homePhoto || 'home.jpg')}" alt="">
        <div>
          <label class="fld">${t('admHomePhoto')}<input type="file" id="hmFoto" accept="image/*"></label>
        </div>
      </div>
      <label class="fld">${t('admHomeText')} (PT)<textarea id="hmTxtPt" rows="2">${esc((DB.settings.homeText && DB.settings.homeText.pt) || '')}</textarea></label>
      <label class="fld">${t('admHomeText')} (EN)<textarea id="hmTxtEn" rows="2">${esc((DB.settings.homeText && DB.settings.homeText.en) || '')}</textarea></label>
      <div class="btnrow">
        <button class="cta sm" id="hmSave">${t('saveBtn')}</button>
        <button class="mini" id="hmSee">${t('admPreview')}</button>
      </div>
    </section>
    <section class="card">
      <h3>${t('admPay')}</h3>
      <p class="why">${t('admPayHelp')}</p>
      <div class="frow">
        <label class="fld">${t('admPixKey')}<input id="pgPix" value="${esc(DB.settings.pixKey || '')}" placeholder="e-mail, telefone ou chave aleatória"></label>
        <label class="fld">${t('admPixName')}<input id="pgPixName" value="${esc(DB.settings.pixName || '')}" placeholder="NOME COMO NO BANCO"></label>
      </div>
      <div class="frow">
        <label class="fld">${t('admPixCity')}<input id="pgPixCity" value="${esc(DB.settings.pixCity || '')}" placeholder="SAO PAULO"></label>
        <div class="fld"><small class="why">${t('admPixHelp')}</small></div>
      </div>
      <div class="frow">
        <label class="fld">${t('admIban')}<input id="pgIban" value="${esc(DB.settings.iban || '')}" placeholder="FR76 …"></label>
        <label class="fld">${t('admIbanName')}<input id="pgIbanName" value="${esc(DB.settings.ibanName || '')}" placeholder="Nome como no banco"></label>
      </div>
      <label class="fld">${t('admWise')}<input id="pgWise" value="${esc(DB.settings.wiseLink || '')}" placeholder="https://wise.com/pay/…"><small class="why">${t('admWiseHelp')}</small></label>
      <label class="optin"><input type="checkbox" id="pgCash" ${DB.settings.dinheiroNoDia ? 'checked' : ''}>
        <span><b>${t('admCash')}</b><small>${t('admCashHelp')}</small></span></label>
      <label class="fld">${t('admPayNote')}<textarea id="pgNote" rows="3">${esc(DB.settings.payNote || '')}</textarea></label>
      <div class="rulesep"></div>
      <label class="optin"><input type="checkbox" id="pgCard" ${DB.settings.stripeAtivo ? 'checked' : ''}>
        <span><b>${t('admCard')}</b><small>${t('admCardHelp')}</small></span></label>
      <small class="why">${t('admCardNota')}</small>
      <div class="rulesep"></div>
      <label class="optin"><input type="checkbox" id="pgFx" ${DB.settings.exibirCotacao ? 'checked' : ''}>
        <span><b>${t('admFx')}</b><small>${t('admFxHelp')}</small></span></label>
      <div class="frow">
        <label class="fld">${t('admFxMargem')}<input id="pgMargem" type="number" min="0" max="30" step="0.5" value="${esc(DB.settings.fxMargem ?? 4)}"></label>
        <div class="fld"><small class="why">${fxResumo()}</small></div>
      </div>
      <button class="cta sm" id="pgSave">${t('saveBtn')}</button>
    </section>
    ${opAjustesHtml()}
    <section class="card">
      <h3>${t('admAviso')}</h3>
      <p class="why">${t('admAvisoHelp')}</p>
      <label class="fld">${t('admAvisoMail')}<input id="avEmail" type="email"
        value="${esc(DB.settings.admEmail || '')}" placeholder="voce@exemplo.com"></label>
      <small class="why">${t('admAvisoNota')}</small>
      <div class="rulesep"></div>
      <label class="optin"><input type="checkbox" id="avCli" ${DB.settings.avisarClientes ? 'checked' : ''}>
        <span><b>${t('admCli')}</b><small>${t('admCliHelp')}</small></span></label>
      <small class="why">${t('admCliNota')}</small>
      ${cartaoEmail('recibo')}
      ${cartaoEmail('conf')}
      <div class="btnrow"><button class="cta sm" id="avSave">${t('saveBtn')}</button></div>
    </section>
    <section class="card">
      <h3>${t('admAbout')}</h3>
      <p class="why">${t('admAboutHelp')}</p>
      <div class="ph-edit">
        <img id="abThumb" src="${esc(DB.settings.photo || 'guia.jpg')}" alt="">
        <div>
          <label class="fld">${t('admPhoto')}<input type="file" id="abPhoto" accept="image/*"></label>
          <p class="why">${t('admPhotoHelp')}</p>
        </div>
      </div>
      <div class="rulesep"></div>
      <div class="frow">
        <label class="fld">${t('admBadge')}<input id="abBadge" value="${esc(DB.settings.badge || '')}" placeholder="Guia credenciado · associação"></label>
        <label class="fld">${t('admBase')}<input id="abBase" value="${esc(DB.settings.base || '')}" placeholder="Cidade, país"></label>
      </div>
      <label class="fld">${t('admBio')} (PT)<textarea id="abBioPt" rows="6">${esc((DB.settings.bio && DB.settings.bio.pt) || '')}</textarea></label>
      <label class="fld">${t('admBio')} (EN)<textarea id="abBioEn" rows="6">${esc((DB.settings.bio && DB.settings.bio.en) || '')}</textarea></label>
      <p class="why">${t('admBioHelp')}</p>
      <div class="btnrow">
        <button class="cta sm" id="abSave">${t('saveBtn')}</button>
        <button class="mini" id="abSee">${t('admPreview')}</button>
      </div>
    </section>
    <section class="card">
      <h3>${t('share')}</h3>
      <label class="fld">${t('shareLink')}
        <div class="crow"><input id="shLink" readonly value="${esc(location.origin + location.pathname)}">
        <button class="mini" id="shCopy">${t('copyLink')}</button></div></label>
      <div class="qrbox">
        ${typeof qrSvg === 'function' ? qrSvg(location.origin + location.pathname, { tamanho: 150, alt: 'QR' }) : ''}
        <div><b>${t('qrTitle')}</b><p class="why">${t('qrHelp')}</p></div>
      </div>
      <div class="rulesep"></div>
      <b>${t('installTitle')}</b>
      <p class="why">${t('installHelp')}</p>
      <div class="btnrow">
        <button class="cta sm" id="shInstall">${t('installBtn')}</button>
      </div>
      <p class="why">${t('installIos')}</p>
      <p class="why">✓ ${t('autoUpd')}</p>
      <p class="why">⚠ ${t('syncNote')}</p>
    </section>
    <section class="card">
      <h3>${t('sndTitle')}</h3>
      <p class="why">${t('sndWhy')}</p>
      <div class="btnrow">
        <button class="mini" id="sndToggle">${localStorage.getItem('vi_som') === 'off' ? '🔇 ' + t('sndOff') : '🔔 ' + t('sndOn')}</button>
        <button class="mini" id="sndTest">${t('sndTest')}</button>
      </div>
    </section>
    <section class="card">
      <h3>${t('tutorial')}</h3>
      <button class="mini" id="tutAgain">${t('tutorialOn')}</button>
    </section>
    <section class="card">
      <h3>${t('bkpTit')}</h3>
      <p class="why">${t('bkpHelp')}</p>
      <p class="why">${(() => { const d = localStorage.getItem('vi_bkp_em');
        return d ? t('bkpUltimo', { d: new Date(+d).toLocaleString(LANG === 'pt' ? 'pt-BR' : 'en-GB') }) : t('bkpNunca'); })()}</p>
      <div class="btnrow">
        <button class="cta sm" id="bkpTudo">${t('bkpTudo')}</button>
        <button class="mini" id="bkpCli">${t('bkpClientes')}</button>
      </div>
    </section>
    <section class="card">
      <h3>${t('ressyncTit')}</h3>
      <p class="why">${t('ressyncHelp')}</p>
      <button class="cta sm" id="ressync">${t('ressyncBtn')}</button>
    </section>
    <section class="card">
      <button class="mini danger" id="reset">${t('resetDemo')}</button>
    </section>`);
  bindLang(app);
  const dc = $('#demoClear');
  if (dc) dc.onclick = () => {
    if (!confirm(t('demoConfirm'))) return;
    clearAll(); cloudPushState();
    toast(t('demoCleared')); go('/adm/tours');
  };
  const dr = $('#demoRestore');
  if (dr) dr.onclick = () => { restoreDemo(); cloudPushState(); toast(t('demoRestored')); admSettings(); };
  $('#setContactSave').onclick = () => {
    DB.settings.whats = $('#setWhats').value.trim();
    DB.settings.insta = $('#setInsta').value.trim().replace(/^@/, '');
    DB.settings.placeholderContact = false; save();
    toast(t('contactSaved')); admSettings();
  };
  /* primeira tela: foto e frase */
  let hmNova = null;
  $('#hmFoto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    /* 1400px e o mesmo tamanho da foto que ja vem no app — mais que isso so
       pesa no celular da cliente, porque a imagem fica atras de um cartao. */
    hmNova = await readImageResized(f, 1400, 0.78);
    $('#hmThumb').src = hmNova;
  };
  $('#hmSave').onclick = () => {
    if (hmNova) DB.settings.homePhoto = hmNova;
    DB.settings.homeText = { pt: $('#hmTxtPt').value.trim(), en: $('#hmTxtEn').value.trim() };
    save(); cloudPushState();
    toast(t('homeSaved'));
  };
  $('#hmSee').onclick = () => go('/');

  /* Quando o aparelho fica com uma copia velha, isto resolve sem ela precisar
     mexer em configuracao de navegador. So apaga o que esta AQUI. */
  /* ---- backup ----
     Dois formatos de proposito: o JSON e para restaurar (tem tudo, inclusive
     o que a planilha nao representa); a planilha e para ela abrir e ler. */
  const baixaArquivo = (conteudo, nome, tipo) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + conteudo], { type: tipo }));
    a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    try { localStorage.setItem('vi_bkp_em', String(Date.now())); } catch (e) {}
  };
  const hojeArq = () => new Date().toISOString().slice(0, 10);

  $('#bkpTudo').onclick = () => {
    if (!DB.bookings.length && !DB.tours.length) return toast(t('bkpVazio'));
    const pacote = pacoteBackup();   /* operacao.js: tudo, inclusive guias, orcamentos e tarefas */
    baixaArquivo(JSON.stringify(pacote, null, 2), Backup.nome(hojeArq()), 'application/json');
    Backup.marca('download', Backup.nome(hojeArq()));
    toast(t('bkpFeito'));
  };

  $('#bkpCli').onclick = () => {
    if (!DB.bookings.length) return toast(t('bkpVazio'));
    const cols = ['Codigo','Nome','Email','WhatsApp','Instagram','Passeio','Data','Horario',
                  'Pessoas','Total EUR','Pago EUR','Falta EUR','Situacao','Consentimento','Criada em'];
    const esc2 = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = Bookings.all().map(b => {
      const x = Tours.get(b.tourId);
      const pago = Bookings.paid(b), falta = Math.max(0, (+b.total || 0) - pago);
      return [b.code, b.name, b.email, b.whats, b.insta,
              x ? (x.name.pt || '') : '', b.date, b.time, b.pax,
              b.total, pago, falta,
              b.status === 'cancelled' ? 'Cancelada' : (falta <= 0 ? 'Paga' : 'Em aberto'),
              (b.consent && b.consent.ok) ? 'Sim' : 'Nao',
              (b.createdAt || '').slice(0, 10)].map(esc2).join(';');
    });
    baixaArquivo([cols.join(';')].concat(linhas).join('\n'),
                 'clientes-' + hojeArq() + '.csv', 'text/csv;charset=utf-8');
    toast(t('bkpFeito'));
  };

  $('#ressync').onclick = async () => {
    if (!confirm(t('ressyncPerg'))) return;
    try {
      const chaves = await caches.keys();
      await Promise.all(chaves.map(k => caches.delete(k)));
    } catch (e) {}
    try {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem('vi_queue_v1');
      localStorage.removeItem('vi_migr_naNuvem');
    } catch (e) {}
    location.reload();
  };

  $('#pgSave').onclick = () => {
    DB.settings.pixKey   = $('#pgPix').value.trim();
    DB.settings.pixName  = $('#pgPixName').value.trim();
    DB.settings.pixCity  = $('#pgPixCity').value.trim();
    DB.settings.iban     = $('#pgIban').value.trim();
    DB.settings.ibanName = $('#pgIbanName').value.trim();
    DB.settings.wiseLink = linkExterno($('#pgWise').value.trim());
    DB.settings.dinheiroNoDia = $('#pgCash').checked;
    DB.settings.payNote  = $('#pgNote').value.trim();
    DB.settings.stripeAtivo   = $('#pgCard').checked;
    DB.settings.exibirCotacao = $('#pgFx').checked;
    DB.settings.fxMargem = Math.max(0, Math.min(30, +$('#pgMargem').value || 0));
    save(); cloudPushState();
    toast(t('payFieldsSaved'));
  };
  /* e-mail de aviso. Vazio e permitido: quer dizer "nao quero ser avisada".
     O que nao pode e salvar um endereco torto e ela achar que esta avisada. */
  $('#avSave').onclick = () => {
    const v = $('#avEmail').value.trim();
    if (v && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) return toast(t('admAvisoBad'));
    DB.settings.admEmail = v;
    DB.settings.avisarClientes = $('#avCli').checked;
    const pega = (id) => $('#' + id).value.trim();
    DB.settings.emailReciboIntro = { pt: pega('reciboIntroPt'), en: pega('reciboIntroEn') };
    DB.settings.emailReciboPS    = { pt: pega('reciboPsPt'),    en: pega('reciboPsEn') };
    DB.settings.emailConfIntro   = { pt: pega('confIntroPt'),   en: pega('confIntroEn') };
    DB.settings.emailConfPS      = { pt: pega('confPsPt'),      en: pega('confPsEn') };
    save(); cloudPushState();
    toast(t('admAvisoSaved'));
  };
  /* foto + história */
  let abNew = null;
  fallbackPhoto($('#abThumb'), '<div class="none">☺</div>');
  $('#abPhoto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    abNew = await readImageResized(f, 700, 0.82);   /* retrato: 700px basta e pesa pouco */
    const prev = $('.ph-edit img') || $('.ph-edit .none');
    if (prev.tagName === 'IMG') prev.src = abNew;
    else prev.outerHTML = `<img src="${abNew}" alt="">`;
  };
  $('#abSave').onclick = () => {
    if (abNew) DB.settings.photo = abNew;
    DB.settings.badge = $('#abBadge').value.trim();
    DB.settings.base  = $('#abBase').value.trim();
    DB.settings.bio   = { pt: $('#abBioPt').value, en: $('#abBioEn').value };
    save(); cloudPushState();
    toast(t('aboutSaved')); admSettings();
  };
  $('#abSee').onclick = () => go('/about');

  $('#shCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#shLink').value); } catch (e) { $('#shLink').select(); document.execCommand('copy'); }
    toast(t('copied'));
  };
  $('#shInstall').onclick = async () => {
    if (window.__installEvt) {
      window.__installEvt.prompt();
      const r = await window.__installEvt.userChoice;
      if (r.outcome === 'accepted') { toast(t('installed')); window.__installEvt = null; }
    } else toast(t('installIos'));
  };
  $('#sndToggle').onclick = () => {
    const off = localStorage.getItem('vi_som') === 'off';
    localStorage.setItem('vi_som', off ? 'on' : 'off');
    admSettings();
  };
  $('#sndTest').onclick = () => {
    if (localStorage.getItem('vi_som') === 'off') return toast(t('sndOff'));
    /* o clique já é o toque que o navegador exige, então aqui costuma tocar */
    const antes = Date.now();
    assinaturaSonora();
    setTimeout(() => { if (Date.now() - antes < 50) toast(t('sndBlocked')); }, 10);
  };
  $('#tutAgain').onclick = () => {
    DB.settings.tutorialAdm = true; DB.settings.tutorialClient = true; save();
    go('/adm/today');
  };
  $('#reset').onclick = () => { if (confirm(t('resetWarn'))) { resetDemo(); route(); } };
  opAjustesLiga();
}

/* ---------- link vindo do e-mail ----------
   O Supabase entrega a sessão de recuperação no próprio endereço, depois
   do #. Precisa ser lido ANTES de rotear: o roteador não reconhece esse
   formato, mandaria para o hub e o token se perderia junto. */
(function linkDeEmail() {
  const r = typeof authFromHash === 'function' && authFromHash();
  if (!r) return;
  if (r.erro) { setTimeout(() => toast('⚠ ' + r.erro), 500); return; }
  if (r.tipo === 'recovery') location.hash = '#/novasenha';
  else if (r.tipo === 'signup') location.hash = '#/adm/today';
})();


/* =====================================================
   AGENDA — o mês do guia
===================================================== */
function admAgenda() {
  const cur = admAgenda._m || isoToday().slice(0, 7);
  const [Y, M] = cur.split('-').map(Number);
  const first = `${cur}-01`;
  const daysIn = new Date(Y, M, 0).getDate();
  const last = `${cur}-${String(daysIn).padStart(2, '0')}`;
  const startWd = (new Date(first + 'T12:00:00').getDay() + 6) % 7; // segunda = 0

  /* as saídas do mês que TÊM reserva. A Ingrid vende serviço privativo: a
     regra de horário do catálogo não é agenda — só vira agenda quando alguém
     reservou (pedido dela de 01/10: "zerar a agenda"). */
  const deps = [];
  for (const x of Tours.all()) {
    for (const d of Cal.departures(x.id, first, last)) {
      const left = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
      if (d.capacity - left > 0) deps.push({ ...d, tour: x, left, booked: d.capacity - left });
    }
  }
  const byDay = {};
  deps.forEach(d => (byDay[d.date] = byDay[d.date] || []).push(d));

  /* As regras de recorrencia so geram saidas para frente. Sem isto, um mes
     que ja passou aparece vazio mesmo tendo tido gente — o historico dela
     sumia da agenda. Aqui recuperamos os dias pelas reservas que existem. */
  Bookings.all()
    .filter(b => b.status !== 'cancelled' && b.date >= first && b.date <= last)
    .forEach(b => {
      const lista = byDay[b.date] = byDay[b.date] || [];
      if (lista.some(d => d.time === b.time && d.tour && d.tour.id === b.tourId)) return;
      const x = Tours.get(b.tourId);
      if (!x) return;
      const cap = x.max || 0;
      const left = Cal.seatsLeft(x.id, b.date, b.time, cap);
      lista.push({ date: b.date, time: b.time, capacity: cap, tour: x, left, booked: cap - left, pastOnly: true });
    });

  /* o dia escolhido vale mesmo sem passeio: pode ter so tarefa */
  const sel = admAgenda._d && admAgenda._d.slice(0, 7) === cur ? admAgenda._d
            : cur === isoToday().slice(0, 7) ? isoToday() : (Object.keys(byDay).sort()[0] || isoToday());
  const WD = LANG === 'pt' ? ['seg','ter','qua','qui','sex','sáb','dom'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const MN = LANG === 'pt'
    ? ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span class="agc empty"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${cur}-${String(d).padStart(2, '0')}`;
    const list = byDay[iso] || [];
    const isToday = iso === isoToday();
    const dots = list.slice(0, 4).map(x =>
      `<i class="${x.left === 0 ? 'full' : x.left <= 2 ? 'low' : ''}"></i>`).join('');
    const nTf = Tarefas.doDia(iso).filter(t => t.tipo === 'tarefa' && !t.feita).length;
    cells += `<button class="agc ${list.length ? 'has' : ''} ${iso === sel ? 'on' : ''} ${isToday ? 'today' : ''}" data-d="${iso}">
      <b>${d}</b>${list.length ? `<span class="agdots">${dots}</span>` : ''}${nTf ? `<span class="ag-tf" title="${nTf} tarefa(s)">✓${nTf > 1 ? nTf : ''}</span>` : ''}</button>`;
  }

  const selList = (byDay[sel] || []).sort((a, b) => a.time.localeCompare(b.time));

  admShell('agenda', `
    <div class="pagehead"><h1 class="pageh">${t('agTitle')}</h1>
      <div class="chips">
        <button class="mini" id="agPrev" aria-label="${t('agPrev')}">←</button>
        <button class="chip on">${MN[M - 1]} ${Y}</button>
        <button class="mini" id="agNext" aria-label="${t('agNext')}">→</button>
        <button class="mini" id="agNow">${t('agToday')}</button>
      </div></div>
    <div class="two-col">
      <section class="card">
        <div class="agrid head">${WD.map(w => `<span class="agwd">${w}</span>`).join('')}</div>
        <div class="agrid" id="agGrid">${cells}</div>
        <p class="why">${t('agLegend')}</p>
      </section>
      <section class="card">
        <h3>${t('agDayOf', { d: fmtDate(sel) })}</h3>
        ${selList.length ? selList.map(d => {
          const bs = DB.bookings.filter(b => b.tourId === d.tour.id && b.date === d.date
                                        && b.time === d.time && b.status !== 'cancelled');
          return `<div class="deprow">
            <div class="tinfo"><b>${d.time} · ${esc(d.tour.name[LANG] || d.tour.name.pt)}</b>
              <small>${t('agBooked', { n: d.booked })} · ${t('agFree', { n: d.left })}</small></div>
            ${bs.length ? `<div class="paxlist">${bs.map(b =>
              `<span class="pill ${Bookings.due(b) > 0 ? 'warn' : 'ok'}">${esc(b.name.split(' ')[0])} ×${b.pax}</span>`).join('')}</div>` : ''}
          </div>`;
        }).join('') : `<p class="empty">${t('agNoDep')}</p>`}
        <div class="ag-tarefas"><span class="op-lbl">Tarefas do dia</span>
          ${tfMiniHtml(Tarefas.doDia(sel).filter(tt => tt.tipo === 'tarefa'), isoToday(), 'Nenhuma tarefa neste dia.')}
          <div class="frow"><label class="fld grow"><input id="agTf" placeholder="Nova tarefa para ${fmtDate(sel)}"></label><button class="mini strong" id="agTfAdd">+ tarefa</button></div>
          <a class="mini" href="#/adm/today/${sel}">ver o dia completo (clientes, guias, pagamentos)</a>
        </div>
      </section>
    </div>`);
  tfLigaMini(() => admAgenda());
  $('#agTfAdd').onclick = () => {
    const v = $('#agTf').value.trim(); if (!v) return $('#agTf').focus();
    const p = lerPrazo(v, sel);
    Tarefas.cria({ texto: v, prazo: sel, hora: p.hora });
    admAgenda._d = sel; admAgenda();
  };

  const shift = (n) => {
    const d = new Date(Y, M - 1 + n, 1);
    admAgenda._m = d.toISOString().slice(0, 7); admAgenda._d = null; admAgenda();
  };
  $('#agPrev').onclick = () => shift(-1);
  $('#agNext').onclick = () => shift(1);
  $('#agNow').onclick = () => { admAgenda._m = isoToday().slice(0, 7); admAgenda._d = isoToday(); admAgenda(); };
  $$('#agGrid .agc[data-d]').forEach(c => c.onclick = () => { admAgenda._d = c.dataset.d; admAgenda(); });
}

/* =====================================================
   RELATÓRIOS — como foi o período
===================================================== */
/* O painel de numeros (operacao-telas.js): marcadores com comparacao,
   graficos com dica e tabela, e as frases do que os numeros dizem. */
function admReports() { admRelatorios(); }

/* =====================================================
   CLIENTES — a base que nasce sozinha
===================================================== */
/* ---------- ícones de contato ----------
   Antes eram ✆ ✉ ◎ — três círculos cinzas idênticos, indecifráveis a 30px.
   Agora são desenhos, cada um na cor do seu canal, com o nome ao lado. */
const ICO = {
  whats: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 13.8l.9-3A5.9 5.9 0 1 1 5.5 13l-3.3.8Z"/><path d="M6 6.1c.2 1.5 2.4 3.7 3.9 3.9l.9-1 1.3.8-.5 1.1c-1.9.5-5.5-3.1-5-5l1.1-.5.8 1.3-.9.9"/></svg>',
  mail:  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="3.4" width="12.8" height="9.2" rx="1.6"/><path d="m2.2 4.6 5.8 4.4 5.8-4.4"/></svg>',
  insta: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.9" y="1.9" width="12.2" height="12.2" rx="3.6"/><circle cx="8" cy="8" r="2.9"/><circle cx="11.6" cy="4.4" r=".95" fill="currentColor" stroke="none"/></svg>',
};

/* Clientes: o dashboard e a ficha estao em operacao-telas.js (cadastro
   guardado, veio por, indicacao, quem viaja junto). */
function admClients() { admClientes(); }


/* =====================================================
   LOGIN DO GUIA
===================================================== */
/* ---- definir nova senha ----
   Só se chega aqui pelo link do e-mail, que já trouxe a sessão. */
function viewNewPass() {
  app.innerHTML = `
  <div class="loginwrap">
    <div class="logincard">
      <div class="loginlogo">${logoMark(46, 'var(--brand-assinatura)')}</div>
      <h1>${t('npTitle')}</h1>
      <p class="why center">${t('npSub')}</p>
      <label class="fld">${t('npNew')}
        <input id="npA" type="password" autocomplete="new-password"></label>
      <label class="fld">${t('npAgain')}
        <input id="npB" type="password" autocomplete="new-password"></label>
      <button class="cta" id="npGo">${t('npSave')}</button>
      <p class="fine center">🔒 ${t('loginSafe')}</p>
    </div>
  </div>`;
  const go2 = $('#npGo');
  go2.onclick = async () => {
    const a1 = $('#npA').value, b1 = $('#npB').value;
    if (a1.length < 8)  { $('#npA').focus(); return toast(t('loginWeak')); }
    if (a1 !== b1)      { $('#npB').focus(); return toast(t('npMismatch')); }
    go2.disabled = true; go2.textContent = t('loginWait');
    const r = await authSetPassword(a1);
    if (!r.ok) { go2.disabled = false; go2.textContent = t('npSave');
                 return toast(r.error || t('npFail')); }
    /* A sessão do link já vale como login: aproveita e assume a posse.
       O botão só volta ao normal DEPOIS disto — soltar antes deixava a tela
       parada durante uma chamada de rede, e parecia que nada aconteceu. */
    const own = await claimOwnership();
    go2.disabled = false; go2.textContent = t('npSave');
    if (own.taken) { await authSignOut(); return toast(t('loginTaken')); }
    DB.settings.authRequired = true; save();
    toast(t('npOk'));
    go('/adm/today');
  };
  $('#npA').focus();
}

function viewLogin(mode) {
  const m = mode || viewLogin._m || 'in';
  viewLogin._m = m;
  app.innerHTML = `
  <div class="loginwrap">
    <div class="logincard">
      <div class="loginlogo">${logoMark(46, 'var(--brand-assinatura)')}</div>
      <h1>${t('loginTitle')}</h1>
      <p class="why center">${m === 'up' ? t('protectWhy') : t('loginSub')}</p>
      <label class="fld">${t('loginEmail')}
        <input id="lgEmail" type="email" autocomplete="email" inputmode="email" placeholder="voce@exemplo.com"></label>
      <label class="fld">${t('loginPass')}
        <input id="lgPass" type="password" autocomplete="${m === 'up' ? 'new-password' : 'current-password'}"></label>
      <p class="lgerro" id="lgErro" hidden></p>
      <button class="cta" id="lgGo">${m === 'up' ? t('loginCreate') : t('loginBtn')}</button>
      <button class="linkbtn center" id="lgSwap">${m === 'up' ? t('loginBack') : t('loginFirst')}</button>
      ${m === 'in' ? `<button class="linkbtn center" id="lgForgot">${t('loginForgot')}</button>` : ''}
      <p class="fine center">🔒 ${t('loginSafe')}</p>
      <button class="linkbtn center" id="lgHome">← ${t('viewSite')}</button>
    </div>
  </div>`;

  const busy = (on) => { const b = $('#lgGo'); b.disabled = on; b.textContent = on ? t('loginWait') : (m === 'up' ? t('loginCreate') : t('loginBtn')); };

  /* O motivo da falha fica NA TELA ate ela resolver, em portugues.
     Aviso que some em 3 segundos, escrito em ingles pelo servidor, nao ajuda. */
  const mostraErro = (txt) => {
    const e = $('#lgErro'); if (!e) return;
    e.textContent = txt; e.hidden = !txt;
  };
  const traduzErro = (bruto) => {
    const b = String(bruto || '').toLowerCase();
    if (b.includes('invalid login') || b.includes('invalid credentials')) return t('lgErrSenha') + ' ' + t('lgEsqueci');
    if (b.includes('not confirmed') || b.includes('email not confirmed')) return t('lgErrConfirm');
    if (b.includes('rate') || b.includes('too many')) return t('lgErrMuitas');
    if (b.includes('failed to fetch') || b.includes('networkerror')) return t('lgErrRede');
    return bruto || t('loginWrong');
  };

  $('#lgGo').onclick = async () => {
    const email = $('#lgEmail').value.trim(), pass = $('#lgPass').value;
    if (!email) { $('#lgEmail').focus(); return toast(t('loginNoEmail')); }
    if (m === 'up' && pass.length < 8) { $('#lgPass').focus(); return toast(t('loginWeak')); }
    mostraErro('');
    busy(true);
    let r;
    /* sem try/catch, uma falha de rede deixava o botao travado em "Entrando..." */
    try { r = m === 'up' ? await authSignUp(email, pass) : await authSignIn(email, pass); }
    catch (e) { r = { ok: false, error: 'failed to fetch' }; }
    busy(false);
    if (!r.ok) { mostraErro(traduzErro(r.error)); return; }
    if (r.needsConfirm) return toast(t('loginConfirm', { e: email }));
    /* Isto e rede: sem o busy() a tela ficava parada, sem nada girando,
       e parecia que o botao nao tinha funcionado. */
    busy(true);
    const own = await claimOwnership();
    busy(false);
    if (own.taken) { await authSignOut(); mostraErro(t('loginTaken')); return; }

    /* PRIMEIRO buscar, DEPOIS abrir o painel.
       Antes o app marcava a configuracao e salvava — e salvar empurra para a
       nuvem. Num aparelho sem dados, isso abria o painel vazio e ainda corria
       o risco de publicar o vazio por cima do que estava la. */
    /* Espera a nuvem, mas so ate 4 segundos. Se demorar mais, abre o painel
       assim mesmo — a busca continua em segundo plano e a tela se atualiza
       sozinha quando chegar. Antes isto esperava sem limite: era o login
       de um minuto. */
    busy(true);
    try {
      await Promise.race([
        cloudPull(),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    } catch (e) {}
    busy(false);

    DB.settings.authRequired = true;
    localStorage.setItem(DB_KEY, JSON.stringify(DB));   /* grava aqui, sem empurrar */
    toast(t('loginHi'));
    go('/adm/today');
  };
  $('#lgSwap').onclick = () => viewLogin(m === 'up' ? 'in' : 'up');
  const fg = $('#lgForgot');
  if (fg) fg.onclick = async () => {
    const email = $('#lgEmail').value.trim();
    if (!email) { $('#lgEmail').focus(); return toast(t('loginNoEmail')); }
    await authReset(email); toast(t('loginSent', { e: email }));
  };
  $('#lgHome').onclick = () => go('/');
  $('#lgEmail').focus();
}

/* ---------- proteção contra perda de trabalho ----------
   A nuvem chega a cada 25s. Se ela chegar enquanto o guia preenche
   um formulário — ou um cliente está no meio do checkout — a tela NÃO
   pode ser redesenhada. O sync fica pendente e entra assim que der. */
let pendingSync = false;
function isBusyEditing() {
  const h = location.hash;
  if (document.querySelector('.coach')) return true;                 // tutorial aberto
  /* Checkout. A escolha de data e horario acontece no passo 1, e exigir
     step > 1 aqui deixava justamente ela desprotegida: o cliente clicava
     "05/12", a sincronia da nuvem ou a cotacao chegava um segundo depois,
     chamava route(), a tela voltava para "Escolha uma data" e a escolha
     dele sumia. Acontecia nos primeiros segundos da pagina — exatamente
     enquanto ele escolhia. Basta ter comecado a escolher para estar ocupado. */
  const S = viewTour._s;
  if (h.startsWith('#/tour/') && S && (S.step > 1 || S.date || S.time)) return true;
  if (/^#\/adm\/tours\//.test(h)) return true;                      // editando passeio
  if (/^#\/adm\/consulta\/./.test(h)) return true;                  // montando orcamento
  const ae = document.activeElement;
  /* digitando — menos no assistente: o painel dele fica FORA da tela que se redesenha
     (fixo na lateral, v1.95), então a nuvem pode atualizar sem apagar o que ela escreve */
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !(ae.closest && ae.closest('#iaGaveta'))) return true;
  return false;
}
/* quando o usuário sai do que estava fazendo, aplica o que ficou pendente */
addEventListener('hashchange', () => {
  if (pendingSync && !isBusyEditing()) { pendingSync = false; setTimeout(route, 60); }
});

/* ---------- cotacao ----------
   Nao bloqueia o arranque: o app abre com o preco em euro e o valor em real
   entra quando a cotacao chegar. Se nunca chegar, simplesmente nao aparece. */
if (typeof fxAtualiza === 'function') {
  fxAtualiza().then((c) => { if (c && LANG === 'pt' && !isBusyEditing()) route(); });
}

/* ---------- nuvem ---------- */
cloudStart((r) => {
  if (r.bootstrap || r.semMudanca || r.segurando || r.vazio) return;
  if (r.fresh && r.fresh.length && location.hash.startsWith('#/adm')) {
    const b = r.fresh[r.fresh.length - 1];
    toast((LANG === 'pt' ? '🎉 Nova reserva: ' : '🎉 New booking: ') + b.name + ' · ' + eur(b.total));
  }
  /* re-render seguro: nunca por cima de trabalho em andamento */
  if (isBusyEditing()) { pendingSync = true; return; }
route();
});


/* FAIXA DE DEMONSTRACAO — enquanto nao ha banco.

   O link e publico e traz os precos reais dela com um botao de reservar.
   Sem banco, a reserva nao chega a ninguem. Quem cair aqui por acaso tem
   que saber disso antes de achar que reservou. Some sozinha quando o
   config.js ganhar o banco. */
(function faixaDemo() {
  if (typeof temNuvem === 'function' && temNuvem()) return;
  const poe = () => {
    if (document.getElementById('demoFaixa')) return;
    const el = document.createElement('div');
    el.id = 'demoFaixa'; el.className = 'protobar';
    el.innerHTML = LANG === 'en'
      ? '<b>Preview</b> — this app is being set up. Bookings made here are not real yet.'
      : '<b>Demonstração</b> — o app está sendo preparado. Reservas feitas aqui ainda não são reais.';
    document.body.appendChild(el);
  };
  if (document.body) poe(); else addEventListener('DOMContentLoaded', poe);
})();

/* PRIMEIRO DESENHO DA TELA — no FIM do arquivo, de proposito.

   Ficava no meio, antes de "const ICO" e "let pendingSync". Quem abria o app
   direto numa aba que usa os icones (Clientes) — recarregando a pagina, ou
   pelo atalho do celular, que reabre na ultima tela — via a tela em branco:
   "Cannot access 'ICO' before initialization". Achado em 18/09/2026. */
route();
