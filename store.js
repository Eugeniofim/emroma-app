/* =====================================================
   APP-GUIA — camada de dados
   Persistência: localStorage. A troca para Supabase é
   trocar as funções deste arquivo — as telas não mudam.
   ===================================================== */
'use strict';

/* Chave propria, e nao a 'vi_db_v1' do molde: este app mora no mesmo
   endereco da demonstracao (guia.eugeniofim.com/ingrid/), e o navegador
   guarda os dados por endereco. Com a mesma chave, quem abrisse os dois
   veria os passeios de um dentro do outro. */
const DB_KEY = 'ingrid_db_v1';

/* ---------- modelo ----------
Tour       {id, type, region, name:{pt,en}, desc:{pt,en}, meeting, photo,
            price, priceMode:'pp'|'session'|'tabela', tabela:[20 valores], min, max,
            payPolicy:'full'|'split',
            status:'live'|'draft'|'seasonal', order}
Rule       {id, tourId, weekdays:[0-6], time:'16:30', capacity, from:'2026-11-20', until:'2026-12-23'}
Departure  {id, tourId, date:'2026-12-21', time, capacity}  // avulsas; recorrentes são geradas das Rules
Block      {id, from, until, reason}                        // bloqueio global (férias)
Booking    {id, code, tourId, date, time, name, email, whats, insta, pax, total,
            veiculo, malas, sinal,          // so nos transfers (da tabela dela)
            group:[{nome, nasc}],            // quem mais veio, alem de quem reservou
            coupon, discount, policy:'full'|'split'|'sinal',
            adultos, criancas,
            payments:[{amount, date, method, kind:'full'|'deposit'|'balance'}],
            status:'confirmed'|'cancelled', createdAt, origin}
Coupon     {code, pct, until, oncePerPerson, uses:[email]}
------------------------------------------------------ */

/* ---------- quem e o guia ----------
   O config.js da o valor inicial; o guia edita nos Ajustes e o que vale e
   o que esta em DB.settings. Nada disto vem gravado no codigo. */
const GUIA_CFG = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {};
/* Sem banco no config.js o app e uma DEMONSTRACAO: tudo vive no aparelho de
   quem esta olhando e nada sai dali. Meia duzia de telas mudam por causa
   disto, entao a pergunta mora num lugar so. */
function temNuvem() { return !!(typeof APP_CONFIG !== 'undefined' && APP_CONFIG && APP_CONFIG.supabaseUrl); }
const PREFIXO = (GUIA_CFG.prefixo || 'RS').toUpperCase();
function _cfgSettings() { return (typeof DB !== 'undefined' && DB && DB.settings) || {}; }
function guiaNome() { return _cfgSettings().admName || GUIA_CFG.nome || 'Guia'; }
function guiaNegocio() { return _cfgSettings().negocio || GUIA_CFG.negocio || guiaNome(); }
function guiaBase() { return _cfgSettings().base || GUIA_CFG.cidade || ''; }
function regioes() {
  /* O que ela cadastrou no painel vem primeiro. O try e porque DB e "let"
     e pode ainda nao existir quando o arquivo carrega. */
  try {
    const d = DB && DB.settings && DB.settings.regioes;
    if (Array.isArray(d) && d.length) return d;
  } catch (e) {}
  const r = GUIA_CFG.regioes;
  return (r && r.length) ? r : [['cidade', 'Cidade', 'City'], ['arredores', 'Arredores', 'Surroundings']];
}
function regiaoLabel(code) {
  const r = regioes().find(x => x[0] === code);
  if (!r) return code || '';
  return (typeof LANG !== 'undefined' && LANG === 'en') ? r[2] : r[1];
}
function regiaoOpts(cur) {
  const en = typeof LANG !== 'undefined' && LANG === 'en';
  return regioes().map(([v, pt, e]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${en ? e : pt}</option>`).join('');
}

/* ---------- transfer: pessoas, bagagem e horario ----------

   A tabela dela de 2026 (TABELA VALORES 2026 - Transfer Roma.pdf) cobra por
   TRECHO, nunca por pessoa, e o valor depende de tres coisas:

     1. QUANTAS PESSOAS, de 1 a 20 ("1 ou 2 pessoas" e uma linha so);
     2. para cada quantidade ha DUAS opcoes de veiculo, e quem decide entre
        elas e a BAGAGEM (ex.: 3 pessoas com 2 malas cabem num carro; com 6
        malas precisam de minivan);
     3. a HORA: das 21h as 5h59 vale a coluna "Noturno".

   Cada linha tem tambem o SINAL, que e o que o cliente paga antes para
   garantir. O resto e no dia.

   transfer.linhas = [{ pax, malas, veiculo, dia, noite, sinal }]
   pax 2 = "1 ou 2 pessoas". */
const NOITE_DE = 21, NOITE_ATE = 6;   /* 21:00 as 05:59 = noturno */

function transferNoturno(hora) {
  const h = parseInt(String(hora || '').slice(0, 2), 10);
  if (isNaN(h)) return false;
  return h >= NOITE_DE || h < NOITE_ATE;
}

/* "1 ou 2 pessoas" e a mesma linha na tabela dela */
function transferPax(pax) { return Math.max(2, Math.min(20, +pax || 1)); }

/* as opcoes de veiculo para aquela quantidade, na ordem da tabela */
function transferOpcoes(x, pax) {
  const ls = (x.transfer && Array.isArray(x.transfer.linhas)) ? x.transfer.linhas : [];
  const n = transferPax(pax);
  return ls.filter(l => +l.pax === n);
}

function transferLinha(x, pax, opcao) {
  const ops = transferOpcoes(x, pax);
  return ops[Math.max(0, Math.min(ops.length - 1, +opcao || 0))] || null;
}

function transferPreco(x, pax, opcao, hora) {
  const l = transferLinha(x, pax, opcao);
  if (!l) return 0;
  return +(transferNoturno(hora) ? l.noite : l.dia) || 0;
}

/* o "a partir de": o menor valor diurno da tabela */
function transferMenor(x) {
  const ls = (x.transfer && x.transfer.linhas) || [];
  const v = ls.map(l => +l.dia || 0).filter(v => v > 0);
  return v.length ? Math.min(...v) : 0;
}

/* ate quantas pessoas a tabela responde */
function transferAte(x) {
  const ls = (x.transfer && x.transfer.linhas) || [];
  return ls.reduce((m, l) => Math.max(m, +l.pax || 0), 0);
}

/* ---------- ingressos por idade ----------

   Pedido da Ingrid (18/09/2026): "teria como ja somar o valor de ingressos
   por idade?". Os ingressos nao estao no valor do passeio, e o preco muda com
   a idade — no Vaticano, crianca ate 6 nao paga, jovem ate 18 paga €15 e
   adulto €25. Ela compra os ingressos com antecedencia, entao precisa saber
   o valor certo na hora da reserva.

   x.ingressos = [{ nome:{pt,en}, gratisAte, reduzido, reduzidoAte, inteiro,
                    guia, noDia }]
     gratisAte   = ate esta idade (inclusive) nao paga
     reduzido    = valor reduzido, ate reduzidoAte (inclusive)
     inteiro     = o resto, e todo adulto
     guia        = o ingresso da propria guia, cobrado uma vez (Sao Pedro)
     noDia       = pago no dia, fora do total (os fones do Vaticano)

   Adulto nao informa idade: paga o inteiro. */
function precoIngresso(g, idade) {
  const a = idade === null || idade === undefined ? 99 : +idade;
  const tem = (v) => v !== null && v !== undefined && v !== '';
  if (tem(g.gratisAte) && a <= +g.gratisAte) return 0;
  if (+g.reduzido > 0 && tem(g.reduzidoAte) && a <= +g.reduzidoAte) return +g.reduzido;
  return +g.inteiro || 0;
}

function ingressosDe(x, adultos, idades) {
  const ings = Array.isArray(x.ingressos) ? x.ingressos : [];
  const pessoas = Array(Math.max(0, +adultos || 0)).fill(null)
    .concat((idades || []).map(v => (v === '' || v === null || v === undefined) ? null : +v));
  const linhas = [], noDia = [];
  let total = 0, totalDia = 0;
  for (const g of ings) {
    const porValor = {};
    let soma = 0;
    for (const idade of pessoas) {
      const v = precoIngresso(g, idade);
      soma += v; porValor[v] = (porValor[v] || 0) + 1;
    }
    const guia = +g.guia || 0;
    soma += guia;
    const linha = { nome: g.nome, valor: soma, porValor, guia };
    if (g.noDia) { noDia.push(linha); totalDia += soma; } else { linhas.push(linha); total += soma; }
  }
  return { linhas, total, noDia, totalDia };
}

/* ---------- preco por numero de pessoas ----------

   A Ingrid nao cobra por pessoa nem um valor unico: ela tem uma tabela com
   o valor FECHADO do grupo para cada quantidade, de 1 ate 20. Ela montou
   essa tabela justamente para parar de fazer conta a mao no meio de um dia
   cheio — entao o app so serve para alguma coisa se souber ler a tabela.

   tabela[i] = valor total do grupo com (i+1) pessoas. 0 = "consultar":
   grupo grande, caso raro, ela responde a mao e tudo bem. */
const TABELA_MAX = 20;

function tabelaPreco(x, pax) {
  const tb = Array.isArray(x.tabela) ? x.tabela : [];
  const n = Math.max(1, Math.min(TABELA_MAX, +pax || 1));
  return +tb[n - 1] || 0;
}

/* O menor valor da tabela — e o "a partir de" do cartao da vitrine. */
function tabelaMenor(x) {
  const tb = (Array.isArray(x.tabela) ? x.tabela : []).map(v => +v || 0).filter(v => v > 0);
  return tb.length ? Math.min(...tb) : 0;
}

/* Ate quantas pessoas a tabela responde sozinha. Acima disso o app nao
   inventa preco: manda falar com ela. */
function tabelaAte(x) {
  const tb = Array.isArray(x.tabela) ? x.tabela : [];
  let n = 0;
  for (let i = 0; i < TABELA_MAX; i++) if (+tb[i] > 0) n = i + 1;
  return n;
}

function _blank() {
  return { tours: [], rules: [], departures: [], blocks: [], bookings: [], coupons: [], seatCounts: [],
           /* pedidos de roteiro personalizado (o questionario do cliente) */
           pedidos: [],
           settings: { lang: 'pt', tutorialClient: true, tutorialAdm: true,
           /* quem e o guia — nasce do config.js e o guia edita no painel */
           admName: GUIA_CFG.nome || 'Guia', negocio: GUIA_CFG.negocio || '',
           whats: GUIA_CFG.whats || '', insta: GUIA_CFG.insta || '', placeholderContact: false,
           /* o cliente ve antes de reservar */
           photo: '', badge: GUIA_CFG.badge || '',
           base: GUIA_CFG.cidade || '',
           /* como o cliente paga. Vazio ate ela preencher no ADM — e enquanto
              estiver vazio a tela diz a verdade: ela passa os dados no WhatsApp. */
           /* pixName e pixCity sao exigidos pelo padrao do BR Code:
              sem eles o banco recusa o codigo. */
           pixKey: '', pixName: '', pixCity: '', iban: '', ibanName: '', payNote: '',
           /* Wise: link de pagamento (wise.com/pay/...). Dinheiro no dia: o
              transfer dela e cobrado assim. Vazio/falso = nao aparece. */
           wiseLink: '', dinheiroNoDia: false,
           /* A primeira tela e o "link na bio" dela: redes e os links de
              parceiros que ela ja divulga (hotel, chip, seguro). Ela edita
              tudo no painel, em Aparencia. */
           youtube: '', facebook: '', blog: '',
           links: [],
           /* cidades e regioes da vitrine. Vazio = as do config.js. Ela
              acrescenta uma cidade nova pelo painel, sem nos. */
           regioes: [],
           /* para onde vai o aviso de reserva nova. Vazio = ela ainda nao
              preencheu; quem manda o e-mail e o robo, fora do navegador. */
           admEmail: '',
           /* e-mail PARA O CLIENTE. Nasce desligado de proposito: e-mail
              indo para cliente de verdade so depois que ela ler os textos e
              decidir ligar. */
           avisarClientes: false,
           /* cartao pelo Stripe. Desligado ate a gente provar a cobranca
              de ponta a ponta com dinheiro de verdade. */
           stripeAtivo: false,
           /* A voz dela dentro do e-mail. Vazio = usa o texto padrao.
              Ela NAO edita o e-mail inteiro de proposito: o miolo tem os
              dados da reserva, o Pix e o aviso de que o recibo nao e
              comprovante de pagamento. Apagar esse aviso sem perceber faria
              cliente que nao pagou achar que esta tudo certo. */
           emailReciboIntro: { pt: '', en: '' },
           emailReciboPS:    { pt: '', en: '' },
           emailConfIntro:   { pt: '', en: '' },
           emailConfPS:      { pt: '', en: '' },
           /* margem sobre a cotacao do BCE: cobre o spread de conversao e a
              taxa de quem processa. Sem ela, o euro que chega e menor. */
           /* O guia pediu para tirar a cotacao da tela. A chave antiga
              (mostrarReais) ficou 'true' na nuvem; usar um nome novo desliga
              na hora para todo mundo, sem depender de ela abrir o app. */
           fxMargem: 4, exibirCotacao: false,
           /* a primeira tela: foto de fundo e a frase. Vazio = usa o padrao. */
           homePhoto: '', homeText: { pt: '', en: '' },
           bio: {
             pt: 'Aqui vai a sua apresentação: quem você é, há quanto tempo guia, o que faz o seu passeio ser diferente.\n\nO cliente lê isto antes do preço — quem confia na pessoa aceita melhor o valor.\n\nEdite este texto em Ajustes → Sobre você.',
             en: 'This is where you introduce yourself: who you are, how long you have been guiding, what makes your tour different.\n\nGuests read this before the price — people who trust the person accept the value more easily.\n\nEdit this text in Settings → About you.'
           } } };
}

function _seed() {
  const db = _blank();
  db.demo = true;
  db.seedVer = SEED_VER;

  /* A apresentacao dela. Nada aqui foi inventado: e o que esta no portfolio
     (as sete secoes) e no Instagram dela ("Receptivo em toda a Italia",
     "Acompanhante Turistica Habilitada", "Transfer e passeios personalizados
     na Italia", "Experiencias Privativas"). Ela reescreve em
     Ajustes -> Sobre voce quando quiser. */
  db.settings.homeText = {
    pt: 'Receptivo em toda a Itália. Transfer e passeios personalizados, com acompanhante habilitada em português.',
    en: 'Travel services across Italy. Transfers and tailor-made tours, with a licensed Portuguese-speaking guide.',
  };
  /* Os links que estao no Beacons dela hoje (beacons.ai/em_roma), com os
     codigos de parceira DELA — e deles que vem a comissao. O do seguro e o
     que o Eugenio mandou (com pcrid=786). */
  db.settings.links = [
    { id: 'hotel', icone: '🏨', url: 'https://www.booking.com/city/it/rome.pt-br.html?aid=1157924;Label=linktree',
      titulo: { pt: 'Reserve seu hotel em Roma', en: 'Book your hotel in Rome' },
      sub: { pt: 'E ajude a gente — você não paga nada a mais por isso', en: 'And help us — it costs you nothing extra' } },
    { id: 'chip', icone: '📶', url: 'https://viajeconectado.com/?ref=EmRoma',
      titulo: { pt: 'Chip de viagem com desconto', en: 'Travel SIM with a discount' },
      sub: { pt: 'Compre no Brasil e chegue conectado', en: 'Buy it in Brazil and land connected' } },
    { id: 'seguro', icone: '🛡️', url: 'https://www.segurospromo.com.br/?tt=ig14%2F7&cupom=VOUDEPROMO&pcrid=786&utm_medium=afiliado',
      titulo: { pt: 'Seguro viagem — 15% de desconto', en: 'Travel insurance — 15% off' },
      sub: { pt: '+ 5% no boleto. Nunca viaje sem seguro', en: '+ 5% paying by boleto. Never travel uninsured' } },
  ];
  db.settings.youtube  = 'https://www.youtube.com/channel/UCqSttbPSaRurVAJvnwILWYw';
  db.settings.facebook = 'https://www.facebook.com/emroma.com.ingrid/';
  db.settings.blog     = 'https://emroma.com/';
  db.settings.photo    = 'arte/avatar-ingrid.jpg';
  db.settings.dinheiroNoDia = true;
  db.settings.bio = {
    pt: 'Sou a Ingrid Meika. Moro na Itália desde 2004 e em Roma desde 2006 — e sou apaixonada por esta cidade.\n\n'
      + 'Foi esse amor que fez nascer o blog Em Roma, onde conto de comida, eventos, lugares que amo, curiosidades '
      + 'e hábitos romanos. Hoje sou acompanhante turística habilitada e atendo em português em toda a Itália.\n\n'
      + 'Em Roma faço passeios privativos: a Roma Antiga, o Vaticano, as basílicas papais, o centro barroco a pé, '
      + 'a Roma iluminada à noite, os mirantes e a Audiência Papal. Fora de Roma, organizo bate e volta com motorista '
      + 'particular — Toscana, Costa Amalfitana, Pompeia, Assis, Tivoli, Castelli Romani.\n\n'
      + 'E cuido dos seus transfers, com motoristas credenciados e pontuais: aeroportos, Porto de Civitavecchia e estações.\n\n'
      + 'Todos os passeios são privativos: o grupo é só seu.',
    en: 'I am Ingrid Meika. I have lived in Italy since 2004 and in Rome since 2006 — and I am in love with this city.\n\n'
      + 'That love gave birth to the Em Roma blog, where I write about food, events, places I love, curiosities and '
      + 'Roman habits. Today I am a licensed tourist guide and I work in Portuguese across Italy.\n\n'
      + 'In Rome I run private tours: Ancient Rome, the Vatican, the papal basilicas, the baroque centre on foot, '
      + 'Rome by night, the viewpoints and the Papal Audience. Outside Rome, I organise day trips with a private '
      + 'driver — Tuscany, the Amalfi Coast, Pompeii, Assisi, Tivoli, Castelli Romani.\n\n'
      + 'And I take care of your transfers, with licensed, punctual drivers: airports, the Port of Civitavecchia and stations.\n\n'
      + 'Every tour is private: the group is yours alone.',
  };

  db.tours = [
    { id: 'roma-antiga-3h', type: 'walk', region: 'roma',
      name: { pt: 'Roma Antiga · 3 horas', en: 'Ancient Rome · 3 hours' },
      desc: { pt: 'O coração da Roma imperial, com guia em português. Em 3 horas visitamos o Coliseu e, à sua escolha, o Fórum Romano ou o Palatino.',
              en: 'The heart of imperial Rome with a Portuguese-speaking guide. In 3 hours we visit the Colosseum and either the Roman Forum or the Palatine.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/coliseu.jpg', lat: 0, lng: 0,
          n: { pt: 'Coliseu', en: 'Colosseum' },
          d: { pt: 'O maior anfiteatro do Império: 50 mil pessoas assistiam aos jogos aqui. Entramos na arena e eu conto como tudo funcionava por baixo dela.', en: 'The largest amphitheatre of the Empire: 50,000 people watched the games here. We go inside and I explain how it all worked beneath the arena.' } },
        { t: '', ph: 'fotos/forum.jpg', lat: 0, lng: 0,
          n: { pt: 'Fórum Romano', en: 'Roman Forum' },
          d: { pt: 'O centro da vida pública de Roma antiga: templos, arcos triunfais e a rua por onde passavam os desfiles dos generais vitoriosos.', en: 'The heart of ancient Roman public life: temples, triumphal arches and the street where victorious generals paraded.' } },
      ],
      photo: 'fotos/coliseu.jpg',
      tagline: { pt: 'O coração da Roma imperial', en: 'The heart of imperial Rome' },
      ingressos: [
        { nome: { pt: 'Coliseu, Fórum e Palatino', en: 'Colosseum, Forum and Palatine' }, gratisAte: 17, inteiro: 18 },
      ],
      price: 420, priceMode: 'tabela',
      tabela: [420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 1,
      priceNote: { pt: 'Ingressos a partir de €18 por adulto, gratuito para menores de 18 anos. Reserva antecipada obrigatória — o valor pode chegar a €36 por pessoa conforme a disponibilidade, por isso reserve com pelo menos 2 meses de antecedência.',
                   en: 'Tickets from €18 per adult, free under 18. Advance booking required — the price can reach €36 per person depending on availability, so book at least 2 months ahead.' },
    },
    { id: 'roma-antiga-4h', type: 'walk', region: 'roma',
      name: { pt: 'Roma Antiga · 4 horas', en: 'Ancient Rome · 4 hours' },
      desc: { pt: 'O coração da Roma imperial, com guia em português. Em 4 horas visitamos o Coliseu, o Palatino e o Fórum Romano.',
              en: 'The heart of imperial Rome with a Portuguese-speaking guide. In 4 hours we visit the Colosseum and both the Palatine and the Roman Forum.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/coliseu2.jpg', lat: 0, lng: 0,
          n: { pt: 'Coliseu', en: 'Colosseum' },
          d: { pt: 'O começo do passeio: a arena, as arquibancadas e os subterrâneos, com a história que os livros não contam.', en: 'Where we begin: the arena, the stands and the underground, with the stories the guidebooks leave out.' } },
        { t: '', ph: 'fotos/palatino.jpg', lat: 0, lng: 0,
          n: { pt: 'Palatino', en: 'Palatine Hill' },
          d: { pt: 'A colina onde Roma nasceu e onde os imperadores moravam. Lá de cima se vê o Circo Máximo e o Fórum inteiro.', en: 'The hill where Rome was born and where the emperors lived. From the top you see the Circus Maximus and the whole Forum.' } },
        { t: '', ph: 'fotos/forum.jpg', lat: 0, lng: 0,
          n: { pt: 'Fórum Romano', en: 'Roman Forum' },
          d: { pt: 'O centro da vida pública de Roma antiga: templos, arcos triunfais e a rua por onde passavam os desfiles dos generais vitoriosos.', en: 'The heart of ancient Roman public life: temples, triumphal arches and the street where victorious generals paraded.' } },
      ],
      photo: 'fotos/forum2.jpg',
      tagline: { pt: 'Coliseu, Palatino e Fórum, sem pressa', en: 'Colosseum, Palatine and Forum, unhurried' },
      ingressos: [
        { nome: { pt: 'Coliseu, Fórum e Palatino', en: 'Colosseum, Forum and Palatine' }, gratisAte: 17, inteiro: 18 },
      ],
      price: 510, priceMode: 'tabela',
      tabela: [510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 2,
      priceNote: { pt: 'Ingressos a partir de €18 por adulto, gratuito para menores de 18 anos. Reserva antecipada obrigatória — o valor pode chegar a €36 por pessoa conforme a disponibilidade, por isso reserve com pelo menos 2 meses de antecedência.',
                   en: 'Tickets from €18 per adult, free under 18. Advance booking required — the price can reach €36 per person depending on availability, so book at least 2 months ahead.' },
    },
    { id: 'vaticano-3h', type: 'walk', region: 'roma',
      name: { pt: 'Vaticano · 3 horas', en: 'Vatican · 3 hours' },
      desc: { pt: 'Museus do Vaticano e Capela Sistina. Guia em português e reserva de ingresso com antecedência.',
              en: 'Vatican Museums and the Sistine Chapel. Portuguese-speaking guide, tickets booked in advance.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos', 'Fones de ouvido (€1,50 no dia)'],
                    en: ['Tickets', 'Headsets (€1.50 on the day)'] },
      stops: [
        { t: '', ph: 'fotos/museus.jpg', lat: 0, lng: 0,
          n: { pt: 'Museus do Vaticano', en: 'Vatican Museums' },
          d: { pt: 'Séculos de arte reunidos pelos papas: esculturas clássicas, galerias e salas pintadas. Eu escolho o caminho para você ver o essencial sem se perder.', en: 'Centuries of art gathered by the popes: classical sculpture, galleries and painted halls. I pick the route so you see what matters without getting lost.' } },
        { t: '', ph: 'fotos/mapas.jpg', lat: 0, lng: 0,
          n: { pt: 'Galeria dos Mapas', en: 'Gallery of Maps' },
          d: { pt: 'Cento e vinte metros de teto dourado e a Itália inteira pintada nas paredes, região por região, no século XVI.', en: 'A hundred and twenty metres of gilded ceiling and the whole of Italy painted on the walls, region by region, in the 16th century.' } },
        { t: '', ph: 'fotos/sistina.jpg', lat: 0, lng: 0,
          n: { pt: 'Capela Sistina', en: 'Sistine Chapel' },
          d: { pt: 'O teto de Michelangelo e o Juízo Final. Lá dentro a regra é silêncio — por isso eu explico tudo antes de entrarmos.', en: 'Michelangelo’s ceiling and the Last Judgement. Inside, silence is the rule — so I explain everything before we go in.' } },
      ],
      photo: 'fotos/museus.jpg',
      tagline: { pt: 'Dos museus à Capela Sistina', en: 'From the museums to the Sistine Chapel' },
      ingressos: [
        { nome: { pt: 'Museus do Vaticano', en: 'Vatican Museums' }, gratisAte: 6, reduzido: 15, reduzidoAte: 18, inteiro: 25 },
        { nome: { pt: 'Fones de ouvido', en: 'Headsets' }, inteiro: 1.5, noDia: true },
      ],
      price: 420, priceMode: 'tabela',
      tabela: [420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420, 420],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 3,
      priceNote: { pt: 'Ingressos dos Museus do Vaticano: €25 por adulto, €15 até 19 anos, gratuito até 7 anos (podem passar de €40 conforme a disponibilidade). Basílica di San Pietro: €7 por pessoa + €7 da guia. Fones de ouvido: €1,50 por pessoa, pagos no dia. Reserva antecipada obrigatória — reserve com pelo menos 2 meses de antecedência.',
                   en: 'Vatican Museums tickets: €25 per adult, €15 up to 19, free up to 7 (can exceed €40 depending on availability). St Peter’s Basilica: €7 per person + €7 for the guide. Headsets: €1.50 per person, paid on the day. Advance booking required — book at least 2 months ahead.' },
    },
    { id: 'vaticano-4h', type: 'walk', region: 'roma',
      name: { pt: 'Vaticano · 4 horas', en: 'Vatican · 4 hours' },
      desc: { pt: 'Museus do Vaticano e Capela Sistina, mais a Basílica de São Pedro. Guia em português e reserva de ingresso com antecedência.',
              en: 'Vatican Museums and the Sistine Chapel, plus St Peter’s Basilica. Portuguese-speaking guide, tickets booked in advance.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos', 'Fones de ouvido (€1,50 no dia)'],
                    en: ['Tickets', 'Headsets (€1.50 on the day)'] },
      stops: [
        { t: '', ph: 'fotos/museus.jpg', lat: 0, lng: 0,
          n: { pt: 'Museus do Vaticano', en: 'Vatican Museums' },
          d: { pt: 'Séculos de arte reunidos pelos papas: esculturas clássicas, galerias e salas pintadas. Eu escolho o caminho para você ver o essencial sem se perder.', en: 'Centuries of art gathered by the popes: classical sculpture, galleries and painted halls. I pick the route so you see what matters without getting lost.' } },
        { t: '', ph: 'fotos/sistina.jpg', lat: 0, lng: 0,
          n: { pt: 'Capela Sistina', en: 'Sistine Chapel' },
          d: { pt: 'O teto de Michelangelo e o Juízo Final. Lá dentro a regra é silêncio — por isso eu explico tudo antes de entrarmos.', en: 'Michelangelo’s ceiling and the Last Judgement. Inside, silence is the rule — so I explain everything before we go in.' } },
        { t: '', ph: 'fotos/spedro-int.jpg', lat: 0, lng: 0,
          n: { pt: 'Basílica de São Pedro', en: 'St Peter’s Basilica' },
          d: { pt: 'A maior igreja do mundo: a Pietà de Michelangelo logo na entrada e o baldaquino de Bernini sob a cúpula.', en: 'The largest church in the world: Michelangelo’s Pietà by the entrance and Bernini’s canopy beneath the dome.' } },
      ],
      photo: 'fotos/spedro-int.jpg',
      tagline: { pt: 'Museus, Sistina e São Pedro num dia só', en: 'Museums, Sistine and St Peter’s in one day' },
      ingressos: [
        { nome: { pt: 'Museus do Vaticano', en: 'Vatican Museums' }, gratisAte: 6, reduzido: 15, reduzidoAte: 18, inteiro: 25 },
        { nome: { pt: 'Basílica de São Pedro', en: 'St Peter’s Basilica' }, inteiro: 7, guia: 7 },
        { nome: { pt: 'Fones de ouvido', en: 'Headsets' }, inteiro: 1.5, noDia: true },
      ],
      price: 510, priceMode: 'tabela',
      tabela: [510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 4,
      priceNote: { pt: 'Ingressos dos Museus do Vaticano: €25 por adulto, €15 até 19 anos, gratuito até 7 anos (podem passar de €40 conforme a disponibilidade). Basílica di San Pietro: €7 por pessoa + €7 da guia. Fones de ouvido: €1,50 por pessoa, pagos no dia. Reserva antecipada obrigatória — reserve com pelo menos 2 meses de antecedência.',
                   en: 'Vatican Museums tickets: €25 per adult, €15 up to 19, free up to 7 (can exceed €40 depending on availability). St Peter’s Basilica: €7 per person + €7 for the guide. Headsets: €1.50 per person, paid on the day. Advance booking required — book at least 2 months ahead.' },
    },
    { id: 'basilicas-3h', type: 'walk', region: 'roma',
      name: { pt: 'Basílicas Papais · 3 basílicas', en: 'Papal Basilicas · 3 basilicas' },
      desc: { pt: 'As basílicas papais de Roma em 3 horas, com guia em português e motorista particular para o conforto entre uma e outra. São as igrejas que abrem a Porta Santa nos anos de Jubileu.',
              en: 'Rome’s papal basilicas in 3 hours, with a Portuguese-speaking guide and a private driver for comfort in between. These are the churches that open the Holy Door in Jubilee years.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português', 'Motorista particular entre as basílicas'],
                    en: ['Guide in Portuguese', 'Private driver between the basilicas'] },
      notIncludes: { pt: ['Ingresso da Basílica di San Pietro (€7 por pessoa + €7 da guia)', 'Fones de ouvido (€1,50 no dia)'],
                    en: ['St Peter’s Basilica ticket (€7 per person + €7 for the guide)', 'Headsets (€1.50 on the day)'] },
      stops: [
        { t: '', ph: 'fotos/latrao.jpg', lat: 0, lng: 0,
          n: { pt: 'São João de Latrão', en: 'St John Lateran' },
          d: { pt: 'A catedral de Roma e a mais antiga das basílicas papais — é ela, e não São Pedro, a igreja do Papa como bispo da cidade.', en: 'Rome’s cathedral and the oldest of the papal basilicas — it is this church, not St Peter’s, that is the Pope’s seat as bishop of Rome.' } },
        { t: '', ph: 'fotos/smmaior.jpg', lat: 0, lng: 0,
          n: { pt: 'Santa Maria Maior', en: 'St Mary Major' },
          d: { pt: 'A grande basílica dedicada a Nossa Senhora, com mosaicos do século V e o campanário mais alto de Roma.', en: 'The great basilica dedicated to the Virgin Mary, with 5th-century mosaics and the tallest bell tower in Rome.' } },
        { t: '', ph: 'fotos/spaulo.jpg', lat: 0, lng: 0,
          n: { pt: 'São Paulo Fora dos Muros', en: 'St Paul Outside the Walls' },
          d: { pt: 'Construída sobre o túmulo do apóstolo Paulo, com o jardim de palmeiras na entrada e os retratos de todos os papas.', en: 'Built over the tomb of the apostle Paul, with its palm-lined courtyard and portraits of every pope.' } },
      ],
      photo: 'fotos/latrao.jpg',
      tagline: { pt: 'As basílicas papais, com motorista', en: 'The papal basilicas, with a driver' },
      ingressos: [
        { nome: { pt: 'Fones de ouvido', en: 'Headsets' }, inteiro: 1.5, noDia: true },
      ],
      price: 490, priceMode: 'tabela',
      tabela: [490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 5,
      priceNote: { pt: 'Ingresso da Basílica di San Pietro com reserva antecipada obrigatória: €7 por pessoa + €7 da guia. Fones de ouvido: €1,50 por pessoa, pagos no dia diretamente à guia.',
                   en: 'St Peter’s Basilica ticket, advance booking required: €7 per person + €7 for the guide. Headsets: €1.50 per person, paid on the day directly to the guide.' },
    },
    { id: 'basilicas-4h', type: 'walk', region: 'roma',
      name: { pt: 'Basílicas Papais · 4 basílicas', en: 'Papal Basilicas · 4 basilicas' },
      desc: { pt: 'As basílicas papais de Roma em 4 horas, com guia em português e motorista particular para o conforto entre uma e outra. São as igrejas que abrem a Porta Santa nos anos de Jubileu.',
              en: 'Rome’s papal basilicas in 4 hours, with a Portuguese-speaking guide and a private driver for comfort in between. These are the churches that open the Holy Door in Jubilee years.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português', 'Motorista particular entre as basílicas'],
                    en: ['Guide in Portuguese', 'Private driver between the basilicas'] },
      notIncludes: { pt: ['Ingresso da Basílica di San Pietro (€7 por pessoa + €7 da guia)', 'Fones de ouvido (€1,50 no dia)'],
                    en: ['St Peter’s Basilica ticket (€7 per person + €7 for the guide)', 'Headsets (€1.50 on the day)'] },
      stops: [
        { t: '', ph: 'fotos/spedro.jpg', lat: 0, lng: 0,
          n: { pt: 'Basílica de São Pedro', en: 'St Peter’s Basilica' },
          d: { pt: 'A basílica sobre o túmulo de São Pedro, no coração do Vaticano, com a Porta Santa aberta nos anos de Jubileu.', en: 'The basilica built over St Peter’s tomb, at the heart of the Vatican, with its Holy Door opened in Jubilee years.' } },
        { t: '', ph: 'fotos/latrao.jpg', lat: 0, lng: 0,
          n: { pt: 'São João de Latrão', en: 'St John Lateran' },
          d: { pt: 'A catedral de Roma e a mais antiga das basílicas papais — é ela, e não São Pedro, a igreja do Papa como bispo da cidade.', en: 'Rome’s cathedral and the oldest of the papal basilicas — it is this church, not St Peter’s, that is the Pope’s seat as bishop of Rome.' } },
        { t: '', ph: 'fotos/smmaior.jpg', lat: 0, lng: 0,
          n: { pt: 'Santa Maria Maior', en: 'St Mary Major' },
          d: { pt: 'A grande basílica dedicada a Nossa Senhora, com mosaicos do século V e o campanário mais alto de Roma.', en: 'The great basilica dedicated to the Virgin Mary, with 5th-century mosaics and the tallest bell tower in Rome.' } },
        { t: '', ph: 'fotos/spaulo.jpg', lat: 0, lng: 0,
          n: { pt: 'São Paulo Fora dos Muros', en: 'St Paul Outside the Walls' },
          d: { pt: 'Construída sobre o túmulo do apóstolo Paulo, com o jardim de palmeiras na entrada e os retratos de todos os papas.', en: 'Built over the tomb of the apostle Paul, with its palm-lined courtyard and portraits of every pope.' } },
      ],
      photo: 'fotos/spedro.jpg',
      tagline: { pt: 'As quatro basílicas papais', en: 'All four papal basilicas' },
      ingressos: [
        { nome: { pt: 'Basílica de São Pedro', en: 'St Peter’s Basilica' }, inteiro: 7, guia: 7 },
        { nome: { pt: 'Fones de ouvido', en: 'Headsets' }, inteiro: 1.5, noDia: true },
      ],
      price: 580, priceMode: 'tabela',
      tabela: [580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 6,
      priceNote: { pt: 'Ingresso da Basílica di San Pietro com reserva antecipada obrigatória: €7 por pessoa + €7 da guia. Fones de ouvido: €1,50 por pessoa, pagos no dia diretamente à guia.',
                   en: 'St Peter’s Basilica ticket, advance booking required: €7 per person + €7 for the guide. Headsets: €1.50 per person, paid on the day directly to the guide.' },
    },
    { id: 'barroca-3h', type: 'walk', region: 'roma',
      name: { pt: 'Roma Barroca a pé · 3 horas', en: 'Baroque Rome on foot · 3 hours' },
      desc: { pt: 'Uma apresentação da cidade a pé: as principais praças e igrejas do centro histórico, a Fontana di Trevi e o Panteão (visita externa).',
              en: 'An introduction to the city on foot: the main squares and churches of the historic centre, the Trevi Fountain and the Pantheon (seen from outside).' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/navona.jpg', lat: 0, lng: 0,
          n: { pt: 'Piazza Navona', en: 'Piazza Navona' },
          d: { pt: 'A praça que era um estádio romano e ainda tem o formato dele. No centro, a Fonte dos Quatro Rios, de Bernini.', en: 'The square that was a Roman stadium and still keeps its shape. At its centre, Bernini’s Fountain of the Four Rivers.' } },
        { t: '', ph: 'fotos/panteao.jpg', lat: 0, lng: 0,
          n: { pt: 'Panteão', en: 'Pantheon' },
          d: { pt: 'Quase dois mil anos de pé e a maior cúpula de concreto sem reforço do mundo, com um buraco no alto — de propósito.', en: 'Nearly two thousand years standing and the largest unreinforced concrete dome in the world, with an opening at the top — on purpose.' } },
        { t: '', ph: 'fotos/trevi.jpg', lat: 0, lng: 0,
          n: { pt: 'Fontana di Trevi', en: 'Trevi Fountain' },
          d: { pt: 'A fonte mais famosa do mundo. A moeda vai com a mão direita, por cima do ombro esquerdo — e garante a volta a Roma.', en: 'The most famous fountain in the world. The coin goes with your right hand over your left shoulder — and guarantees your return to Rome.' } },
      ],
      photo: 'fotos/navona.jpg',
      tagline: { pt: 'Praças, fontes e o Panteão, a pé', en: 'Squares, fountains and the Pantheon, on foot' },
      price: 360, priceMode: 'tabela',
      tabela: [360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360, 360],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 7,
      priceNote: { pt: 'Também é possível fazer este passeio com motorista + guia. Me chame para o valor.',
                   en: 'This tour can also be done with driver + guide. Message me for a quote.' },
    },
    { id: 'barroca-4h', type: 'walk', region: 'roma',
      name: { pt: 'Roma Barroca a pé · 4 horas', en: 'Baroque Rome on foot · 4 hours' },
      desc: { pt: 'Uma apresentação da cidade a pé: as principais praças e igrejas do centro histórico, a Fontana di Trevi e o Panteão (visita externa).',
              en: 'An introduction to the city on foot: the main squares and churches of the historic centre, the Trevi Fountain and the Pantheon (seen from outside).' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/navona.jpg', lat: 0, lng: 0,
          n: { pt: 'Piazza Navona', en: 'Piazza Navona' },
          d: { pt: 'A praça que era um estádio romano e ainda tem o formato dele. No centro, a Fonte dos Quatro Rios, de Bernini.', en: 'The square that was a Roman stadium and still keeps its shape. At its centre, Bernini’s Fountain of the Four Rivers.' } },
        { t: '', ph: 'fotos/panteao.jpg', lat: 0, lng: 0,
          n: { pt: 'Panteão', en: 'Pantheon' },
          d: { pt: 'Quase dois mil anos de pé e a maior cúpula de concreto sem reforço do mundo, com um buraco no alto — de propósito.', en: 'Nearly two thousand years standing and the largest unreinforced concrete dome in the world, with an opening at the top — on purpose.' } },
        { t: '', ph: 'fotos/trevi.jpg', lat: 0, lng: 0,
          n: { pt: 'Fontana di Trevi', en: 'Trevi Fountain' },
          d: { pt: 'A fonte mais famosa do mundo. A moeda vai com a mão direita, por cima do ombro esquerdo — e garante a volta a Roma.', en: 'The most famous fountain in the world. The coin goes with your right hand over your left shoulder — and guarantees your return to Rome.' } },
      ],
      photo: 'fotos/trevi2.jpg',
      tagline: { pt: 'A Roma barroca, com tempo para tudo', en: 'Baroque Rome, with time for everything' },
      price: 400, priceMode: 'tabela',
      tabela: [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 8,
      priceNote: { pt: 'Também é possível fazer este passeio com motorista + guia. Me chame para o valor.',
                   en: 'This tour can also be done with driver + guide. Message me for a quote.' },
    },
    { id: 'noturno-3h', type: 'walk', region: 'roma',
      name: { pt: 'Roma iluminada · 3 horas', en: 'Rome by night · 3 hours' },
      desc: { pt: 'Conhecer Roma à noite é outra cidade. As principais praças a pé, a Fontana di Trevi e o Panteão (visita externa), sem o sol e sem a multidão do dia.',
              en: 'Rome at night is another city. The main squares on foot, the Trevi Fountain and the Pantheon (from outside), without the sun and without the daytime crowds.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/navona-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Piazza Navona à noite', en: 'Piazza Navona by night' },
          d: { pt: 'Sem o sol e sem a multidão, a praça vira outra: fontes iluminadas, artistas de rua e as igrejas barrocas acesas.', en: 'Without the sun and the crowds the square changes: lit fountains, street artists and baroque churches glowing.' } },
        { t: '', ph: 'fotos/panteao-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Panteão iluminado', en: 'The Pantheon lit up' },
          d: { pt: 'O pórtico de colunas iluminado à noite é das vistas mais bonitas de Roma — e a praça em volta fica tranquila.', en: 'The columned portico lit up at night is one of Rome’s most beautiful sights — and the square around it goes quiet.' } },
        { t: '', ph: 'fotos/trevi-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Fontana di Trevi à noite', en: 'Trevi Fountain by night' },
          d: { pt: 'A fonte iluminada, com a água azul e bem menos gente do que de dia. É aqui que terminamos.', en: 'The fountain lit up, its water glowing blue and far fewer people than by day. This is where we finish.' } },
      ],
      photo: 'fotos/trevi-noite.jpg',
      tagline: { pt: 'Roma iluminada, sem a multidão', en: 'Rome lit up, without the crowds' },
      price: 400, priceMode: 'tabela',
      tabela: [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 9,
      priceNote: { pt: 'Também é possível fazer este passeio com motorista + guia. Me chame para o valor.',
                   en: 'This tour can also be done with driver + guide. Message me for a quote.' },
    },
    { id: 'noturno-4h', type: 'walk', region: 'roma',
      name: { pt: 'Roma iluminada · 4 horas', en: 'Rome by night · 4 hours' },
      desc: { pt: 'Conhecer Roma à noite é outra cidade. As principais praças a pé, a Fontana di Trevi e o Panteão (visita externa), sem o sol e sem a multidão do dia.',
              en: 'Rome at night is another city. The main squares on foot, the Trevi Fountain and the Pantheon (from outside), without the sun and without the daytime crowds.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/navona-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Piazza Navona à noite', en: 'Piazza Navona by night' },
          d: { pt: 'Sem o sol e sem a multidão, a praça vira outra: fontes iluminadas, artistas de rua e as igrejas barrocas acesas.', en: 'Without the sun and the crowds the square changes: lit fountains, street artists and baroque churches glowing.' } },
        { t: '', ph: 'fotos/panteao-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Panteão iluminado', en: 'The Pantheon lit up' },
          d: { pt: 'O pórtico de colunas iluminado à noite é das vistas mais bonitas de Roma — e a praça em volta fica tranquila.', en: 'The columned portico lit up at night is one of Rome’s most beautiful sights — and the square around it goes quiet.' } },
        { t: '', ph: 'fotos/trevi-noite.jpg', lat: 0, lng: 0,
          n: { pt: 'Fontana di Trevi à noite', en: 'Trevi Fountain by night' },
          d: { pt: 'A fonte iluminada, com a água azul e bem menos gente do que de dia. É aqui que terminamos.', en: 'The fountain lit up, its water glowing blue and far fewer people than by day. This is where we finish.' } },
      ],
      photo: 'fotos/panteao-noite.jpg',
      tagline: { pt: 'A noite romana, com calma', en: 'A Roman night, at an easy pace' },
      price: 440, priceMode: 'tabela',
      tabela: [440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 10,
      priceNote: { pt: 'Também é possível fazer este passeio com motorista + guia. Me chame para o valor.',
                   en: 'This tour can also be done with driver + guide. Message me for a quote.' },
    },
    { id: 'panoramas-3h', type: 'walk', region: 'roma',
      name: { pt: 'Panoramas de Roma · 3 horas', en: 'Rome viewpoints · 3 hours' },
      desc: { pt: 'Roma é a cidade das sete colinas. Este passeio leva você aos mirantes com as vistas mais bonitas da cidade, com guia em português e motorista particular durante todo o trajeto.',
              en: 'Rome is the city of seven hills. This tour takes you to the viewpoints with the most beautiful views in the city, with a Portuguese-speaking guide and a private driver throughout.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português', 'Motorista particular'],
                    en: ['Guide in Portuguese', 'Private driver'] },
      notIncludes: { pt: ['Refeições', 'Ingressos — as visitas são externas'],
                    en: ['Meals', 'Tickets — all visits are from outside'] },
      stops: [],
      photo: 'arte/capa-roma.jpg',
      price: 490, priceMode: 'tabela',
      tabela: [490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490, 490],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 11
    },
    { id: 'panoramas-4h', type: 'walk', region: 'roma',
      name: { pt: 'Panoramas de Roma · 4 horas', en: 'Rome viewpoints · 4 hours' },
      desc: { pt: 'Roma é a cidade das sete colinas. Este passeio leva você aos mirantes com as vistas mais bonitas da cidade, com guia em português e motorista particular durante todo o trajeto.',
              en: 'Rome is the city of seven hills. This tour takes you to the viewpoints with the most beautiful views in the city, with a Portuguese-speaking guide and a private driver throughout.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português', 'Motorista particular'],
                    en: ['Guide in Portuguese', 'Private driver'] },
      notIncludes: { pt: ['Refeições', 'Ingressos — as visitas são externas'],
                    en: ['Meals', 'Tickets — all visits are from outside'] },
      stops: [],
      photo: 'arte/capa-roma.jpg',
      price: 580, priceMode: 'tabela',
      tabela: [580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580, 580],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 12
    },
    { id: 'degustacao', type: 'walk', region: 'roma',
      name: { pt: 'Passeio com degustação · 4 horas', en: 'Tasting walk · 4 hours' },
      desc: { pt: 'A Roma Barroca ou Trastevere, o bairro boêmio, com pequenas pausas para um café, um sorvete e outras delícias típicas da cozinha romana pelo caminho.',
              en: 'Baroque Rome or Trastevere, the bohemian quarter, with short stops for a coffee, an ice cream and other Roman specialities along the way.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [],
      photo: 'arte/capa-roma.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 13,
      priceNote: { pt: 'Valor sob consulta — me chame que eu monto com você.',
                   en: 'Price on request — message me and we will put it together.' },
    },
    { id: 'criancas', type: 'walk', region: 'roma',
      name: { pt: 'Passeio com crianças', en: 'Tour with children' },
      desc: { pt: 'Como despertar o interesse das crianças durante a viagem? Este tour une história, curiosidades e momentos lúdicos. Duas opções: a pé pelas principais praças, Fontana di Trevi e Panteão; ou Roma Antiga, com Coliseu e Fórum Romano.',
              en: 'How do you keep children interested on a trip? This tour blends history, curiosities and playful moments. Two options: on foot through the main squares, Trevi Fountain and Pantheon; or Ancient Rome, with the Colosseum and the Roman Forum.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: '3h ou 4h', distance: '', effort: 'easy',
      includes: { pt: ['Guia em português'],
                    en: ['Guide in Portuguese'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [],
      photo: 'arte/capa-roma.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 14,
      priceNote: { pt: 'Valor e disponibilidade sob consulta. Também é possível com motorista + guia.',
                   en: 'Price and availability on request. Also available with driver + guide.' },
    },
    { id: 'papal-convites', type: 'papal', region: 'roma',
      name: { pt: 'Audiência Papal · retirada de convites', en: 'Papal Audience · invitation pick-up' },
      desc: { pt: 'A Audiência Papal acontece tradicionalmente todas as quartas-feiras no Vaticano. Eu solicito, retiro e entrego os convites diretamente no seu hotel.',
              en: 'The Papal Audience traditionally takes place every Wednesday at the Vatican. I request, collect and deliver the invitations directly to your hotel.' },
      meeting: 'Entrega no seu hotel',
      duration: '—', distance: '', effort: 'easy',
      includes: { pt: ['Solicitação dos convites', 'Retirada no Vaticano', 'Entrega no seu hotel'],
                    en: ['Invitation request', 'Pick-up at the Vatican', 'Delivery to your hotel'] },
      notIncludes: { pt: ['Acompanhamento durante a audiência'],
                    en: ['Escort during the audience'] },
      stops: [],
      photo: 'fotos/spedro.jpg',
      tagline: { pt: 'Os convites entregues no seu hotel', en: 'Invitations delivered to your hotel' },
      price: 100, priceMode: 'tabela',
      tabela: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 15,
      priceNote: { pt: 'Condição: o hotel deve ficar no centro histórico de Roma e ter portaria 24 horas.',
                   en: 'Condition: the hotel must be in the historic centre of Rome and have a 24-hour front desk.' },
    },
    { id: 'papal-acompanhamento', type: 'papal', region: 'roma',
      name: { pt: 'Audiência Papal · acompanhamento', en: 'Papal Audience · with escort' },
      desc: { pt: 'Ver o Papa de perto durante a passagem do Papamóvel, com acompanhamento durante toda a audiência. Inclui a retirada dos convites.',
              en: 'See the Pope up close as the Popemobile passes, with an escort throughout the audience. Includes the invitation pick-up.' },
      meeting: 'Combinado por WhatsApp após a reserva',
      duration: 'Manhã de quarta-feira', distance: '', effort: 'easy',
      includes: { pt: ['Retirada dos convites', 'Acompanhamento durante a audiência'],
                    en: ['Invitation pick-up', 'Escort during the audience'] },
      notIncludes: { pt: ['Transfer'],
                    en: ['Transfer'] },
      stops: [
        { t: '', ph: 'fotos/spedro-praca.jpg', lat: 0, lng: 0,
          n: { pt: 'Praça de São Pedro', en: 'St Peter’s Square' },
          d: { pt: 'A praça abraçada pela colunata de Bernini, onde acontece a Audiência Papal nas manhãs de quarta-feira.', en: 'The square embraced by Bernini’s colonnade, where the Papal Audience takes place on Wednesday mornings.' } },
      ],
      photo: 'fotos/spedro-praca.jpg',
      tagline: { pt: 'Veja o Papa de perto', en: 'See the Pope up close' },
      price: 440, priceMode: 'tabela',
      tabela: [440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440, 440],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 16
    },
    { id: 'papal-acomp-transfer', type: 'papal', region: 'roma',
      name: { pt: 'Audiência Papal · acompanhamento + transfer', en: 'Papal Audience · escort + transfer' },
      desc: { pt: 'O acompanhamento completo na Audiência Papal, com transfer de ida a partir do seu hotel.',
              en: 'The full Papal Audience escort, with a transfer from your hotel.' },
      meeting: 'No seu hotel',
      duration: 'Manhã de quarta-feira', distance: '', effort: 'easy',
      includes: { pt: ['Retirada dos convites', 'Acompanhamento durante a audiência', 'Transfer de ida'],
                    en: ['Invitation pick-up', 'Escort during the audience', 'Transfer to the Vatican'] },
      notIncludes: { pt: ['Transfer de volta'],
                    en: ['Return transfer'] },
      stops: [],
      photo: 'arte/capa-marca.jpg',
      price: 510, priceMode: 'tabela',
      tabela: [510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510, 510],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 17,
      priceNote: { pt: 'Transfer válido para hotéis no centro histórico.',
                   en: 'Transfer valid for hotels in the historic centre.' },
    },
    { id: 'bv-assis', type: 'day', region: 'forade',
      name: { pt: 'Assis e Orvieto (ou Cássia)', en: 'Assisi and Orvieto (or Cascia)' },
      desc: { pt: 'A terra natal de São Francisco, com a Basílica de São Francisco e a casa onde o santo nasceu. No caminho, parada na cidade medieval de Orvieto ou em Cássia, onde viveu e morreu Santa Rita.',
              en: 'The birthplace of Saint Francis, with the Basilica of Saint Francis and the house where he was born. On the way, a stop in the medieval town of Orvieto or in Cascia, where Saint Rita lived and died.' },
      meeting: 'No seu hotel, em Roma',
      duration: '10h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/assis.jpg', lat: 0, lng: 0,
          n: { pt: 'Assis', en: 'Assisi' },
          d: { pt: 'A terra de São Francisco: a Basílica de São Francisco e a casa onde o santo nasceu.', en: 'The home of Saint Francis: the Basilica of St Francis and the house where he was born.' } },
        { t: '', ph: 'fotos/orvieto.jpg', lat: 0, lng: 0,
          n: { pt: 'Orvieto', en: 'Orvieto' },
          d: { pt: 'Parada na cidade medieval sobre o penhasco, com a catedral de fachada dourada. (Ou em Cássia, onde viveu Santa Rita.)', en: 'A stop in the medieval clifftop town, with its golden-fronted cathedral. (Or in Cascia, where Saint Rita lived.)' } },
      ],
      photo: 'fotos/assis.jpg',
      tagline: { pt: 'A terra de São Francisco', en: 'The home of Saint Francis' },
      price: 950, priceMode: 'tabela',
      tabela: [950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 18
    },
    { id: 'bv-tivoli', type: 'day', region: 'forade',
      name: { pt: 'Tivoli · Villa Adriana e Villa d’Este', en: 'Tivoli · Villa Adriana and Villa d’Este' },
      desc: { pt: 'A elegante Tivoli, com a Villa Adriana, residência do imperador Adriano, e a Villa d’Este, conhecida no mundo todo pelos jardins renascentistas e pelas fontes.',
              en: 'Elegant Tivoli, with Villa Adriana, the emperor Hadrian’s residence, and Villa d’Este, known worldwide for its Renaissance gardens and fountains.' },
      meeting: 'No seu hotel, em Roma',
      duration: '8h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/villa-deste.jpg', lat: 0, lng: 0,
          n: { pt: 'Villa d’Este — os jardins', en: 'Villa d’Este — the gardens' },
          d: { pt: 'Os jardins renascentistas em terraços, com os espelhos d’água e a Fonte do Órgão, que tocava música com a força da água.', en: 'Terraced Renaissance gardens with reflecting pools and the Organ Fountain, which played music by water power.' } },
        { t: '', ph: 'fotos/villa-deste2.jpg', lat: 0, lng: 0,
          n: { pt: 'Villa d’Este — as fontes', en: 'Villa d’Este — the fountains' },
          d: { pt: 'A Fonte de Netuno e as centenas de jatos d’água que fizeram a Villa d’Este famosa no mundo inteiro.', en: 'The Neptune Fountain and the hundreds of jets that made Villa d’Este famous around the world.' } },
      ],
      photo: 'fotos/villa-deste2.jpg',
      tagline: { pt: 'Villas, jardins e fontes do Renascimento', en: 'Renaissance villas, gardens and fountains' },
      price: 850, priceMode: 'tabela',
      tabela: [850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 19
    },
    { id: 'bv-castelli', type: 'day', region: 'forade',
      name: { pt: 'Castelli Romani', en: 'Castelli Romani' },
      desc: { pt: 'As colinas ao sul de Roma: Castel Gandolfo, com a residência de verão do Papa, a encantadora Nemi e, no fim, Frascati, famosa pelos vinhos. Dá para incluir vinícola com degustação e almoço típico.',
              en: 'The hills south of Rome: Castel Gandolfo, with the Pope’s summer residence, charming Nemi and, to finish, Frascati, famous for its wines. A winery with tasting and a typical lunch can be added.' },
      meeting: 'No seu hotel, em Roma',
      duration: '8h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/gandolfo.jpg', lat: 0, lng: 0,
          n: { pt: 'Castel Gandolfo', en: 'Castel Gandolfo' },
          d: { pt: 'A cidadezinha sobre o Lago Albano onde fica a tradicional residência de verão do Papa.', en: 'The little town above Lake Albano, home to the Pope’s traditional summer residence.' } },
        { t: '', ph: 'fotos/frascati.jpg', lat: 0, lng: 0,
          n: { pt: 'Frascati', en: 'Frascati' },
          d: { pt: 'A última parada, famosa pelos vinhos brancos. Dá para incluir uma vinícola com degustação e almoço típico.', en: 'The last stop, famous for its white wines. A winery with tasting and a typical lunch can be added.' } },
      ],
      photo: 'fotos/gandolfo.jpg',
      tagline: { pt: 'Lagos, vilarejos e os vinhos de Frascati', en: 'Lakes, villages and the wines of Frascati' },
      price: 850, priceMode: 'tabela',
      tabela: [850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 20
    },
    { id: 'bv-bracciano', type: 'day', region: 'forade',
      name: { pt: 'Bracciano e Cerveteri', en: 'Bracciano and Cerveteri' },
      desc: { pt: 'Bracciano fica a uma hora de Roma e é famosa pelo Castelo Orsini-Odescalchi, cenário de casamentos de celebridades. O passeio pode incluir a Necrópole Etrusca de Cerveteri e o museu da cidade.',
              en: 'Bracciano is an hour from Rome and famous for the Orsini-Odescalchi Castle, setting for celebrity weddings. The tour can also include the Etruscan Necropolis of Cerveteri and the town museum.' },
      meeting: 'No seu hotel, em Roma',
      duration: '8h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [],
      photo: 'arte/foto-bracciano.jpg',
      price: 850, priceMode: 'tabela',
      tabela: [850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850, 850],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 21
    },
    { id: 'bv-civita', type: 'day', region: 'forade',
      name: { pt: 'Civita di Bagnoregio e Bolsena', en: 'Civita di Bagnoregio and Bolsena' },
      desc: { pt: 'Conhecida como "a cidade que está morrendo", Civita di Bagnoregio fica isolada sobre uma rocha, e o único acesso é uma longa ponte para pedestres. O passeio inclui o Lago de Bolsena e o castelo medieval Rocca Monaldeschi, ou a cidade medieval de Orvieto.',
              en: 'Known as "the dying town", Civita di Bagnoregio sits isolated on a rock, reached only by a long footbridge. The tour also includes Lake Bolsena and the medieval Rocca Monaldeschi castle, or the medieval town of Orvieto.' },
      meeting: 'No seu hotel, em Roma',
      duration: '8h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/civita.jpg', lat: 0, lng: 0,
          n: { pt: 'Civita di Bagnoregio', en: 'Civita di Bagnoregio' },
          d: { pt: '"A cidade que está morrendo": isolada no alto de uma rocha, no meio do vale, e com um único acesso — a longa ponte para pedestres.', en: '"The dying town": isolated on top of a rock in the middle of a valley, reached only by a long footbridge.' } },
        { t: '', ph: 'fotos/civita-rua.jpg', lat: 0, lng: 0,
          n: { pt: 'As ruas de Civita', en: 'The streets of Civita' },
          d: { pt: 'Lá dentro, ruelas medievais, portas floridas e o silêncio de uma cidade com poucos moradores.', en: 'Inside, medieval lanes, flower-covered doorways and the silence of a town with very few residents.' } },
        { t: '', ph: 'fotos/bolsena.jpg', lat: 0, lng: 0,
          n: { pt: 'Lago de Bolsena', en: 'Lake Bolsena' },
          d: { pt: 'O maior lago vulcânico da Europa, com o castelo medieval Rocca Monaldeschi. (Ou, se preferir, a cidade medieval de Orvieto.)', en: 'Europe’s largest volcanic lake, with the medieval Rocca Monaldeschi castle. (Or, if you prefer, the medieval town of Orvieto.)' } },
      ],
      photo: 'fotos/civita.jpg',
      tagline: { pt: 'A cidade suspensa sobre o vale', en: 'The town suspended above the valley' },
      price: 900, priceMode: 'tabela',
      tabela: [900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 22
    },
    { id: 'bv-amalfi', type: 'day', region: 'forade',
      name: { pt: 'Costiera Amalfitana', en: 'Amalfi Coast' },
      desc: { pt: 'Uma das estradas panorâmicas mais bonitas do mundo, com paradas estratégicas para fotos e para as paisagens da costa. Visitamos Positano e Amalfi.',
              en: 'One of the most beautiful coastal roads in the world, with well-chosen stops for photos and views. We visit Positano and Amalfi.' },
      meeting: 'No seu hotel, em Roma',
      duration: '10h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/costa.jpg', lat: 0, lng: 0,
          n: { pt: 'A estrada da Costa Amalfitana', en: 'The Amalfi Coast road' },
          d: { pt: 'Uma das estradas mais bonitas do mundo, entre a montanha e o mar. Paramos nos mirantes para as fotos.', en: 'One of the most beautiful roads in the world, between the mountains and the sea. We stop at the viewpoints for photos.' } },
        { t: '', ph: 'fotos/positano.jpg', lat: 0, lng: 0,
          n: { pt: 'Positano', en: 'Positano' },
          d: { pt: 'As casinhas coloridas descendo o morro até a praia — o cartão-postal da costa.', en: 'Colourful houses tumbling down the hillside to the beach — the postcard of the coast.' } },
        { t: '', ph: 'fotos/amalfi.jpg', lat: 0, lng: 0,
          n: { pt: 'Amalfi', en: 'Amalfi' },
          d: { pt: 'A antiga república marítima que dá nome à costa, com a catedral no alto da escadaria.', en: 'The old maritime republic that gives the coast its name, with its cathedral at the top of a grand staircase.' } },
      ],
      photo: 'fotos/positano.jpg',
      tagline: { pt: 'Positano, Amalfi e a estrada mais bonita', en: 'Positano, Amalfi and the most beautiful road' },
      price: 1000, priceMode: 'tabela',
      tabela: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 23
    },
    { id: 'bv-toscana-sul', type: 'day', region: 'forade',
      name: { pt: 'Toscana Sul · Montalcino e Pienza', en: 'Southern Tuscany · Montalcino and Pienza' },
      desc: { pt: 'Montalcino, Montepulciano e Pienza, algumas das cidades mais encantadoras da Toscana. É possível visitar vinícolas tradicionais e degustar alguns dos melhores vinhos do mundo.',
              en: 'Montalcino, Montepulciano and Pienza, some of the most charming towns in Tuscany. Traditional wineries can be visited, tasting some of the best wines in the world.' },
      meeting: 'No seu hotel, em Roma',
      duration: '10h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/montalcino.jpg', lat: 0, lng: 0,
          n: { pt: 'Montalcino', en: 'Montalcino' },
          d: { pt: 'A cidade murada no alto da colina, terra do Brunello — um dos vinhos mais famosos da Itália.', en: 'The walled hilltop town, home of Brunello — one of Italy’s most famous wines.' } },
        { t: '', ph: 'fotos/vinho.jpg', lat: 0, lng: 0,
          n: { pt: 'Uma vinícola tradicional', en: 'A traditional winery' },
          d: { pt: 'Se quiser, visitamos uma vinícola da região para degustar alguns dos melhores vinhos do mundo.', en: 'If you like, we visit a local winery to taste some of the best wines in the world.' } },
        { t: '', ph: 'fotos/montepulciano.jpg', lat: 0, lng: 0,
          n: { pt: 'Montepulciano', en: 'Montepulciano' },
          d: { pt: 'Ruas de pedra, palácios renascentistas e vista para o Val d’Orcia de todos os lados.', en: 'Stone streets, Renaissance palaces and views of the Val d’Orcia on every side.' } },
        { t: '', ph: 'fotos/pienza.jpg', lat: 0, lng: 0,
          n: { pt: 'Pienza', en: 'Pienza' },
          d: { pt: 'A "cidade ideal" do Renascimento, desenhada por um papa. Famosa também pelo queijo pecorino.', en: 'The Renaissance "ideal town", designed for a pope. Famous for its pecorino cheese, too.' } },
      ],
      photo: 'fotos/valdorcia.jpg',
      tagline: { pt: 'Val d’Orcia, vilarejos e vinho', en: 'Val d’Orcia, villages and wine' },
      price: 950, priceMode: 'tabela',
      tabela: [950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 24
    },
    { id: 'bv-toscana-norte', type: 'day', region: 'forade',
      name: { pt: 'Toscana Norte · Siena e San Gimignano', en: 'Northern Tuscany · Siena and San Gimignano' },
      desc: { pt: 'Siena, Monteriggioni e San Gimignano, cartões-postais da Toscana. Em San Gimignano fica um dos melhores gelatos do mundo, e vale a parada.',
              en: 'Siena, Monteriggioni and San Gimignano, the postcards of Tuscany. San Gimignano has one of the best gelatos in the world, and it is worth the stop.' },
      meeting: 'No seu hotel, em Roma',
      duration: '10h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/siena.jpg', lat: 0, lng: 0,
          n: { pt: 'Siena', en: 'Siena' },
          d: { pt: 'A Piazza del Campo, em forma de concha, onde acontece o Palio, e a Torre del Mangia.', en: 'The shell-shaped Piazza del Campo, home of the Palio horse race, and the Torre del Mangia.' } },
        { t: '', ph: 'fotos/monteriggioni.jpg', lat: 0, lng: 0,
          n: { pt: 'Monteriggioni', en: 'Monteriggioni' },
          d: { pt: 'O vilarejo medieval ainda cercado pelas muralhas e torres originais — cabe inteiro num passeio curto.', en: 'A medieval village still ringed by its original walls and towers — small enough to see in a short walk.' } },
        { t: '', ph: 'fotos/sangimignano.jpg', lat: 0, lng: 0,
          n: { pt: 'San Gimignano', en: 'San Gimignano' },
          d: { pt: 'A cidade das torres medievais — e de um dos melhores gelatos do mundo. Vale a parada.', en: 'The town of medieval towers — and of one of the best gelatos in the world. Worth the stop.' } },
      ],
      photo: 'fotos/siena.jpg',
      tagline: { pt: 'Siena e as torres de San Gimignano', en: 'Siena and the towers of San Gimignano' },
      price: 950, priceMode: 'tabela',
      tabela: [950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 25
    },
    { id: 'bv-pompeia', type: 'day', region: 'forade',
      name: { pt: 'Pompeia e Nápoles (ou Vesúvio)', en: 'Pompeii and Naples (or Vesuvius)' },
      desc: { pt: 'Nápoles tem o melhor café e a melhor pizza da Itália. Pompeia é a cidade romana soterrada pelas cinzas do Vesúvio em 79 d.C., que preservou a vida da época de um jeito impressionante.',
              en: 'Naples has the best coffee and the best pizza in Italy. Pompeii is the Roman city buried by the ashes of Vesuvius in AD 79, which preserved daily life in astonishing detail.' },
      meeting: 'No seu hotel, em Roma',
      duration: '10h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa à disposição', 'Pedágio, combustível e estacionamentos'],
                    en: ['Portuguese-speaking driver at your disposal', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [
        { t: '', ph: 'fotos/pompeia.jpg', lat: 0, lng: 0,
          n: { pt: 'Pompeia', en: 'Pompeii' },
          d: { pt: 'A cidade romana soterrada pelas cinzas do Vesúvio em 79 d.C.: ruas, casas e afrescos preservados como naquele dia.', en: 'The Roman city buried by Vesuvius’s ash in AD 79: streets, houses and frescoes preserved as they were that day.' } },
        { t: '', ph: 'fotos/napoles.jpg', lat: 0, lng: 0,
          n: { pt: 'Nápoles', en: 'Naples' },
          d: { pt: 'A baía com o Vesúvio ao fundo, o melhor café e a melhor pizza da Itália. (Ou, se preferir, subimos o Vesúvio.)', en: 'The bay with Vesuvius behind it, Italy’s best coffee and best pizza. (Or, if you prefer, we go up Vesuvius.)' } },
      ],
      photo: 'fotos/pompeia.jpg',
      tagline: { pt: 'A cidade que o Vesúvio guardou', en: 'The city Vesuvius preserved' },
      price: 950, priceMode: 'tabela',
      tabela: [950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950],
      min: 1, max: 20, payPolicy: 'split', status: 'live', order: 26
    },
    { id: 'bv-personalizado', type: 'day', region: 'italia',
      name: { pt: 'Roteiro com motorista, personalizado', en: 'Custom itinerary with driver' },
      desc: { pt: 'Uma viagem por diferentes cidades da Itália com motorista privativo. Você monta o seu roteiro ou eu monto com você. São 10 horas de motorista à disposição por dia e cerca de 350 km diários.',
              en: 'A journey through different Italian cities with a private driver. You build your own itinerary or I build it with you. Ten hours of driver at your disposal per day and around 350 km a day.' },
      meeting: 'Onde você estiver hospedado',
      duration: '10h por dia', distance: '', effort: 'easy',
      includes: { pt: ['10 horas de motorista à disposição por dia', 'Cerca de 350 km por dia', 'Pedágio, combustível e estacionamentos'],
                    en: ['Ten hours of driver per day', 'Around 350 km a day', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Guia ou acompanhante', 'Refeições', 'Vinícolas e degustações', 'Ingressos das atrações'],
                    en: ['Guide or escort', 'Meals', 'Wineries and tastings', 'Attraction tickets'] },
      stops: [],
      photo: 'arte/capa-marca.jpg',
      price: 950, priceMode: 'tabela',
      tabela: [950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950, 950],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 27,
      priceNote: { pt: 'Mínimo de 2 diárias consecutivas. O valor é por dia.',
                   en: 'Minimum of two consecutive days. The price is per day.' },
    },
    { id: 'conexao-roma', type: 'conexao', region: 'roma',
      name: { pt: 'Conexão em Roma', en: 'Layover in Rome' },
      desc: { pt: 'Tem uma conexão longa em Roma? A gente monta um passeio de acordo com o seu tempo e com o que você quer ver. Sugestão: transfer de chegada + 3 ou 4 horas de walking tour + transfer de partida. Também há a opção de tour com motorista saindo e voltando ao aeroporto, com paradas no Coliseu, Fórum Romano, Piazza Navona, Piazza Venezia, Fontana di Trevi, Panteão e Piazza di San Pietro.',
              en: 'Got a long layover in Rome? We put together a tour that fits your time and what you want to see. Suggestion: arrival transfer + 3 or 4 hours of walking tour + departure transfer. There is also a driver tour leaving from and returning to the airport, with stops at the Colosseum, Roman Forum, Piazza Navona, Piazza Venezia, Trevi Fountain, Pantheon and St Peter’s Square.' },
      meeting: 'No aeroporto',
      duration: '3h, 4h ou 6h', distance: '', effort: 'easy',
      includes: { pt: ['Transfer de chegada e de partida', 'Walking tour com guia em português'],
                    en: ['Arrival and departure transfers', 'Walking tour with a Portuguese-speaking guide'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [],
      photo: 'arte/capa-conexao.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 28,
      priceNote: { pt: 'Valores sob consulta, e conexões noturnas têm valor próprio. Me chame que eu monto com você.',
                   en: 'Prices on request; night layovers are priced separately. Message me and we will put it together.' },
    },
    { id: 'cruzeiro', type: 'conexao', region: 'roma',
      name: { pt: 'Parada de cruzeiro em Roma', en: 'Cruise stop in Rome' },
      desc: { pt: 'Alguns cruzeiros param no Porto de Civitavecchia para uma visita rápida à cidade. Eu monto o passeio da sua parada: transfer de chegada + 3 ou 4 horas de walking tour + transfer de partida, ou um tour de 10 horas com motorista saindo e voltando ao porto.',
              en: 'Some cruises stop at the Port of Civitavecchia for a quick visit to the city. I build the tour around your stop: arrival transfer + 3 or 4 hours of walking tour + departure transfer, or a ten-hour driver tour leaving from and returning to the port.' },
      meeting: 'No Porto de Civitavecchia',
      duration: 'Até 10h', distance: '', effort: 'easy',
      includes: { pt: ['Transfer de chegada e de partida', 'Walking tour com guia em português'],
                    en: ['Arrival and departure transfers', 'Walking tour with a Portuguese-speaking guide'] },
      notIncludes: { pt: ['Ingressos das atrações'],
                    en: ['Attraction tickets'] },
      stops: [],
      photo: 'arte/capa-cruzeiro.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 29,
      priceNote: { pt: 'Valores sob consulta. Organizamos também experiências gastronômicas.',
                   en: 'Prices on request. We also organise food experiences.' },
    },
    { id: 'trem', type: 'trem', region: 'italia',
      name: { pt: 'Bate e volta de trem', en: 'Day trip by train' },
      desc: { pt: 'O trem é seguro, confortável e rápido, e é uma ótima forma de conhecer outras cidades durante a sua estadia em Roma. Os destinos mais procurados são Capri, Florença e Pisa, Assis, Tivoli, Pompeia e Nápoles.',
              en: 'The train is safe, comfortable and fast, and a great way to see other cities during your stay in Rome. The most requested destinations are Capri, Florence and Pisa, Assisi, Tivoli, Pompeii and Naples.' },
      meeting: 'Estação Termini',
      duration: 'Dia inteiro', distance: '', effort: 'easy',
      includes: { pt: ['Acompanhamento em português'],
                    en: ['Portuguese-speaking escort'] },
      notIncludes: { pt: ['Bilhetes de trem', 'Ingressos das atrações', 'Refeições'],
                    en: ['Train tickets', 'Attraction tickets', 'Meals'] },
      stops: [],
      photo: 'arte/capa-marca.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 30,
      priceNote: { pt: 'Valores sob consulta, variam conforme o destino e a data do bilhete.',
                   en: 'Prices on request; they vary with the destination and the ticket date.' },
    },
    { id: 'transfer-aeroporto', type: 'transfer', region: 'transfer',
      name: { pt: 'Aeroportos de Roma (FCO ou CIA) ↔ Centro', en: 'Rome airports (FCO or CIA) ↔ Centre' },
      desc: { pt: 'Transfer entre os aeroportos de Fiumicino ou Ciampino e o seu hotel no centro de Roma, com motorista credenciado. O serviço mais pedido.',
              en: 'Transfer between Fiumicino or Ciampino airport and your hotel in central Rome, with a licensed driver. The most requested service.' },
      meeting: 'No seu hotel, no aeroporto, no porto ou na estação',
      duration: 'Por trecho', distance: '', effort: 'easy',
      includes: { pt: ['Motorista credenciado', 'Pedágio, combustível e estacionamento'],
                    en: ['Licensed driver', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Espera além da incluída'],
                    en: ['Waiting beyond what is included'] },
      stops: [],
      photo: 'fotos/aeroporto.jpg',
      tagline: { pt: 'Do avião ao hotel, sem preocupação', en: 'From the plane to your hotel, worry-free' },
      price: 90, priceMode: 'transfer',
      transfer: { linhas: [
        { pax: 2, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 90, noite: 120, sinal: 30 },
        { pax: 2, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 100, noite: 130, sinal: 30 },
        { pax: 3, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 95, noite: 125, sinal: 35 },
        { pax: 3, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 105, noite: 135, sinal: 35 },
        { pax: 4, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 110, noite: 140, sinal: 40 },
        { pax: 4, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 120, noite: 150, sinal: 40 },
        { pax: 5, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 115, noite: 145, sinal: 45 },
        { pax: 5, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 125, noite: 155, sinal: 45 },
        { pax: 6, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 120, noite: 150, sinal: 50 },
        { pax: 6, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 130, noite: 160, sinal: 50 },
        { pax: 7, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 135, noite: 165, sinal: 55 },
        { pax: 7, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 195, noite: 255, sinal: 55 },
        { pax: 8, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 140, noite: 170, sinal: 60 },
        { pax: 8, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 200, noite: 260, sinal: 60 },
        { pax: 9, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 205, noite: 265, sinal: 65 },
        { pax: 9, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 215, noite: 275, sinal: 65 },
        { pax: 10, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 210, noite: 270, sinal: 70 },
        { pax: 10, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 220, noite: 280, sinal: 70 },
        { pax: 11, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 220, noite: 280, sinal: 80 },
        { pax: 11, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 230, noite: 290, sinal: 80 },
        { pax: 12, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 240, noite: 300, sinal: 100 },
        { pax: 12, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 250, noite: 310, sinal: 100 },
        { pax: 13, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 270, noite: 330, sinal: 120 },
        { pax: 13, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 280, noite: 340, sinal: 120 },
        { pax: 14, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 280, noite: 340, sinal: 130 },
        { pax: 14, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 290, noite: 350, sinal: 130 },
        { pax: 15, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 300, noite: 360, sinal: 140 },
        { pax: 15, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 350, noite: 440, sinal: 140 },
        { pax: 16, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 320, noite: 380, sinal: 160 },
        { pax: 16, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 370, noite: 460, sinal: 160 },
        { pax: 17, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 380, noite: 470, sinal: 170 },
        { pax: 17, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 410, noite: 500, sinal: 170 },
        { pax: 18, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 390, noite: 480, sinal: 180 },
        { pax: 18, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 420, noite: 510, sinal: 180 },
        { pax: 19, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 430, noite: 520, sinal: 190 },
        { pax: 19, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 510, noite: 630, sinal: 190 },
        { pax: 20, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 440, noite: 530, sinal: 200 },
        { pax: 20, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 520, noite: 640, sinal: 200 },
      ] },
      min: 1, max: 20, payPolicy: 'sinal', status: 'live', order: 31,
      priceNote: { pt: 'Inclui 1 hora de espera no aeroporto após o pouso (acompanhamos pelo número do voo). Depois, €40 por veículo por hora. Valores para hotel no centro histórico e uma parada só. Fora do centro, ou com o grupo em dois hotéis, o orçamento é feito à parte. Valores em dinheiro; no cartão há acréscimo de 10%. O valor é por trecho, não por pessoa. Um sinal garante a reserva e o restante é pago no dia.',
                   en: 'Includes one hour of waiting after landing (we track your flight). After that, €40 per vehicle per hour. Prices for a hotel in the historic centre and a single stop. Outside the centre, or with the group in two hotels, it is quoted separately. Prices in cash; card payments carry a 10% surcharge. The price is per trip, not per person. A deposit secures the booking and the rest is paid on the day.' },
    },
    { id: 'transfer-civitavecchia', type: 'transfer', region: 'transfer',
      name: { pt: 'Porto de Civitavecchia ↔ Centro', en: 'Port of Civitavecchia ↔ Centre' },
      desc: { pt: 'Transfer entre o Porto de Civitavecchia e o seu hotel no centro de Roma, com motorista credenciado.',
              en: 'Transfer between the Port of Civitavecchia and your hotel in central Rome, with a licensed driver.' },
      meeting: 'No seu hotel, no aeroporto, no porto ou na estação',
      duration: 'Por trecho', distance: '', effort: 'easy',
      includes: { pt: ['Motorista credenciado', 'Pedágio, combustível e estacionamento'],
                    en: ['Licensed driver', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Espera além da incluída'],
                    en: ['Waiting beyond what is included'] },
      stops: [],
      photo: 'fotos/porto.jpg',
      tagline: { pt: 'Do navio ao centro de Roma', en: 'From the ship to central Rome' },
      price: 190, priceMode: 'transfer',
      transfer: { linhas: [
        { pax: 2, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 190, noite: 220, sinal: 50 },
        { pax: 2, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 210, noite: 240, sinal: 50 },
        { pax: 3, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 195, noite: 225, sinal: 55 },
        { pax: 3, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 215, noite: 245, sinal: 55 },
        { pax: 4, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 220, noite: 250, sinal: 60 },
        { pax: 4, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 240, noite: 270, sinal: 60 },
        { pax: 5, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 225, noite: 255, sinal: 65 },
        { pax: 5, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 245, noite: 275, sinal: 65 },
        { pax: 6, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 230, noite: 260, sinal: 70 },
        { pax: 6, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 250, noite: 280, sinal: 70 },
        { pax: 7, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 260, noite: 290, sinal: 80 },
        { pax: 7, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 400, noite: 460, sinal: 80 },
        { pax: 8, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 270, noite: 300, sinal: 90 },
        { pax: 8, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 410, noite: 470, sinal: 90 },
        { pax: 9, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 420, noite: 480, sinal: 100 },
        { pax: 9, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 440, noite: 500, sinal: 100 },
        { pax: 10, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 440, noite: 500, sinal: 120 },
        { pax: 10, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 460, noite: 520, sinal: 120 },
        { pax: 11, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 450, noite: 510, sinal: 130 },
        { pax: 11, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 470, noite: 530, sinal: 130 },
        { pax: 12, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 460, noite: 520, sinal: 140 },
        { pax: 12, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 480, noite: 540, sinal: 140 },
        { pax: 13, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 500, noite: 560, sinal: 160 },
        { pax: 13, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 520, noite: 580, sinal: 160 },
        { pax: 14, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 510, noite: 570, sinal: 170 },
        { pax: 14, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 530, noite: 590, sinal: 170 },
        { pax: 15, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 540, noite: 600, sinal: 180 },
        { pax: 15, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 660, noite: 750, sinal: 180 },
        { pax: 16, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 550, noite: 610, sinal: 190 },
        { pax: 16, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 670, noite: 760, sinal: 190 },
        { pax: 17, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 680, noite: 770, sinal: 200 },
        { pax: 17, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 740, noite: 830, sinal: 200 },
        { pax: 18, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 690, noite: 780, sinal: 210 },
        { pax: 18, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 750, noite: 840, sinal: 210 },
        { pax: 19, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 760, noite: 850, sinal: 220 },
        { pax: 19, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 940, noite: 1030, sinal: 220 },
        { pax: 20, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 770, noite: 860, sinal: 230 },
        { pax: 20, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 950, noite: 1040, sinal: 230 },
      ] },
      min: 1, max: 20, payPolicy: 'sinal', status: 'live', order: 32,
      priceNote: { pt: 'Inclui 15 minutos de espera. Depois, €20 a cada 20 minutos. Valores para hotel no centro histórico e uma parada só. Fora do centro, ou com o grupo em dois hotéis, o orçamento é feito à parte. Valores em dinheiro; no cartão há acréscimo de 10%. O valor é por trecho, não por pessoa. Um sinal garante a reserva e o restante é pago no dia.',
                   en: 'Includes 15 minutes of waiting. After that, €20 for every 20 minutes. Prices for a hotel in the historic centre and a single stop. Outside the centre, or with the group in two hotels, it is quoted separately. Prices in cash; card payments carry a 10% surcharge. The price is per trip, not per person. A deposit secures the booking and the rest is paid on the day.' },
    },
    { id: 'transfer-termini', type: 'transfer', region: 'transfer',
      name: { pt: 'Estações de trem ↔ Centro, ou Roma ↔ Roma', en: 'Train stations ↔ Centre, or within Rome' },
      desc: { pt: 'Transfer entre as estações de trem (Termini, Tiburtina e outras) e o centro de Roma, ou entre dois pontos dentro de Roma, com motorista credenciado.',
              en: 'Transfer between the train stations (Termini, Tiburtina and others) and central Rome, or between two points within Rome, with a licensed driver.' },
      meeting: 'No seu hotel, no aeroporto, no porto ou na estação',
      duration: 'Por trecho', distance: '', effort: 'easy',
      includes: { pt: ['Motorista credenciado', 'Pedágio, combustível e estacionamento'],
                    en: ['Licensed driver', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Espera além da incluída'],
                    en: ['Waiting beyond what is included'] },
      stops: [],
      photo: 'fotos/estacao.jpg',
      tagline: { pt: 'Da estação ao hotel', en: 'From the station to your hotel' },
      price: 70, priceMode: 'transfer',
      transfer: { linhas: [
        { pax: 2, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 70, noite: 100, sinal: 30 },
        { pax: 2, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 80, noite: 110, sinal: 30 },
        { pax: 3, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 75, noite: 105, sinal: 35 },
        { pax: 3, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 85, noite: 115, sinal: 35 },
        { pax: 4, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 90, noite: 120, sinal: 40 },
        { pax: 4, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 100, noite: 130, sinal: 40 },
        { pax: 5, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 95, noite: 125, sinal: 45 },
        { pax: 5, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 105, noite: 135, sinal: 45 },
        { pax: 6, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 100, noite: 130, sinal: 50 },
        { pax: 6, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 110, noite: 140, sinal: 50 },
        { pax: 7, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 115, noite: 145, sinal: 55 },
        { pax: 7, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 155, noite: 215, sinal: 55 },
        { pax: 8, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 120, noite: 150, sinal: 60 },
        { pax: 8, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 160, noite: 220, sinal: 60 },
        { pax: 9, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 165, noite: 225, sinal: 65 },
        { pax: 9, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 175, noite: 235, sinal: 65 },
        { pax: 10, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 170, noite: 230, sinal: 70 },
        { pax: 10, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 180, noite: 240, sinal: 70 },
        { pax: 11, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 180, noite: 240, sinal: 80 },
        { pax: 11, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 190, noite: 250, sinal: 80 },
        { pax: 12, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 200, noite: 260, sinal: 100 },
        { pax: 12, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 210, noite: 270, sinal: 100 },
        { pax: 13, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 230, noite: 290, sinal: 120 },
        { pax: 13, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 240, noite: 300, sinal: 120 },
        { pax: 14, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 240, noite: 300, sinal: 130 },
        { pax: 14, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 250, noite: 310, sinal: 130 },
        { pax: 15, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 260, noite: 320, sinal: 140 },
        { pax: 15, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 290, noite: 380, sinal: 140 },
        { pax: 16, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 280, noite: 340, sinal: 160 },
        { pax: 16, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 310, noite: 400, sinal: 160 },
        { pax: 17, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 320, noite: 410, sinal: 170 },
        { pax: 17, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 350, noite: 440, sinal: 170 },
        { pax: 18, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 330, noite: 420, sinal: 180 },
        { pax: 18, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 360, noite: 450, sinal: 180 },
        { pax: 19, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 370, noite: 460, sinal: 190 },
        { pax: 19, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 430, noite: 520, sinal: 190 },
        { pax: 20, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 380, noite: 470, sinal: 200 },
        { pax: 20, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 440, noite: 530, sinal: 200 },
      ] },
      min: 1, max: 20, payPolicy: 'sinal', status: 'live', order: 33,
      priceNote: { pt: 'Inclui 15 minutos de espera. Depois, €20 a cada 20 minutos. Valores para hotel no centro histórico e uma parada só. Fora do centro, ou com o grupo em dois hotéis, o orçamento é feito à parte. Valores em dinheiro; no cartão há acréscimo de 10%. O valor é por trecho, não por pessoa. Um sinal garante a reserva e o restante é pago no dia.',
                   en: 'Includes 15 minutes of waiting. After that, €20 for every 20 minutes. Prices for a hotel in the historic centre and a single stop. Outside the centre, or with the group in two hotels, it is quoted separately. Prices in cash; card payments carry a 10% surcharge. The price is per trip, not per person. A deposit secures the booking and the rest is paid on the day.' },
    },
    { id: 'transfer-outlet', type: 'transfer', region: 'transfer',
      name: { pt: 'Roma → Outlet Castel Romano → Roma', en: 'Rome → Castel Romano Outlet → Rome' },
      desc: { pt: 'Ida e volta entre o centro de Roma e o Outlet Castel Romano, com motorista credenciado.',
              en: 'Round trip between central Rome and the Castel Romano Outlet, with a licensed driver.' },
      meeting: 'No seu hotel, no aeroporto, no porto ou na estação',
      duration: 'Por trecho', distance: '', effort: 'easy',
      includes: { pt: ['Motorista credenciado', 'Pedágio, combustível e estacionamento'],
                    en: ['Licensed driver', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Espera além da incluída'],
                    en: ['Waiting beyond what is included'] },
      stops: [],
      photo: 'fotos/outlet.jpg',
      tagline: { pt: 'Um dia de compras, ida e volta', en: 'A shopping day, round trip' },
      price: 90, priceMode: 'transfer',
      transfer: { linhas: [
        { pax: 2, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 90, noite: 120, sinal: 30 },
        { pax: 2, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 100, noite: 130, sinal: 30 },
        { pax: 3, veiculo: 'carro', malas: '2 malas médias (65x45x28) e 2 bordo', dia: 95, noite: 125, sinal: 35 },
        { pax: 3, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 105, noite: 135, sinal: 35 },
        { pax: 4, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 110, noite: 140, sinal: 40 },
        { pax: 4, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 120, noite: 150, sinal: 40 },
        { pax: 5, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 115, noite: 145, sinal: 45 },
        { pax: 5, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 125, noite: 155, sinal: 45 },
        { pax: 6, veiculo: 'minivan', malas: '6 malas médias (65x45x28) e 4 bordo', dia: 120, noite: 150, sinal: 50 },
        { pax: 6, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 130, noite: 160, sinal: 50 },
        { pax: 7, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 135, noite: 165, sinal: 55 },
        { pax: 7, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 195, noite: 255, sinal: 55 },
        { pax: 8, veiculo: 'van', malas: '8 malas médias (65x45x28) e 6 bordo', dia: 140, noite: 170, sinal: 60 },
        { pax: 8, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 200, noite: 260, sinal: 60 },
        { pax: 9, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 205, noite: 265, sinal: 65 },
        { pax: 9, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 215, noite: 275, sinal: 65 },
        { pax: 10, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 210, noite: 270, sinal: 70 },
        { pax: 10, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 220, noite: 280, sinal: 70 },
        { pax: 11, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 220, noite: 280, sinal: 80 },
        { pax: 11, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 230, noite: 290, sinal: 80 },
        { pax: 12, veiculo: '2 minivans', malas: '12 malas médias (65x45x28) e 8 bordo', dia: 240, noite: 300, sinal: 100 },
        { pax: 12, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 250, noite: 310, sinal: 100 },
        { pax: 13, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 270, noite: 330, sinal: 120 },
        { pax: 13, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 280, noite: 340, sinal: 120 },
        { pax: 14, veiculo: 'minivan + van', malas: '14 malas médias (65x45x28) e 10 bordo', dia: 280, noite: 340, sinal: 130 },
        { pax: 14, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 290, noite: 350, sinal: 130 },
        { pax: 15, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 300, noite: 360, sinal: 140 },
        { pax: 15, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 350, noite: 440, sinal: 140 },
        { pax: 16, veiculo: '2 vans', malas: '16 malas médias (65x45x28) e 12 bordo', dia: 320, noite: 380, sinal: 160 },
        { pax: 16, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 370, noite: 460, sinal: 160 },
        { pax: 17, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 12 bordo', dia: 380, noite: 470, sinal: 170 },
        { pax: 17, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 410, noite: 500, sinal: 170 },
        { pax: 18, veiculo: '3 minivan', malas: '18 malas médias (65x45x28) e 14 bordo', dia: 390, noite: 480, sinal: 180 },
        { pax: 18, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 420, noite: 510, sinal: 180 },
        { pax: 19, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 430, noite: 520, sinal: 190 },
        { pax: 19, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 510, noite: 600, sinal: 190 },
        { pax: 20, veiculo: '3 vans', malas: '24 malas médias (65x45x28) e 18 bordo', dia: 440, noite: 530, sinal: 200 },
        { pax: 20, veiculo: '4 vans', malas: '32 malas médias (65x45x28) e 24 bordo', dia: 520, noite: 610, sinal: 200 },
      ] },
      min: 1, max: 20, payPolicy: 'sinal', status: 'live', order: 34,
      priceNote: { pt: 'Espera no outlet: €60 por hora (carro) ou €70 (minivan). Valores para hotel no centro histórico e uma parada só. Fora do centro, ou com o grupo em dois hotéis, o orçamento é feito à parte. Valores em dinheiro; no cartão há acréscimo de 10%. O valor é por trecho, não por pessoa. Um sinal garante a reserva e o restante é pago no dia.',
                   en: 'Waiting at the outlet: €60 per hour (car) or €70 (minivan). Prices for a hotel in the historic centre and a single stop. Outside the centre, or with the group in two hotels, it is quoted separately. Prices in cash; card payments carry a 10% surcharge. The price is per trip, not per person. A deposit secures the booking and the rest is paid on the day.' },
    },
    { id: 'transfer-disposicao', type: 'transfer', region: 'transfer',
      name: { pt: 'Motorista à sua disposição', en: 'Driver at your disposal' },
      desc: { pt: 'Um motorista particular que fica à sua disposição pelo tempo que você precisar, para ir e vir com conforto. Mínimo de 3 horas de serviço.',
              en: 'A private driver at your disposal for as long as you need, to come and go in comfort. Minimum of three hours.' },
      meeting: 'Onde você estiver',
      duration: 'A partir de 3h', distance: '', effort: 'easy',
      includes: { pt: ['Motorista credenciado'],
                    en: ['Licensed driver'] },
      notIncludes: { pt: ['Refeições', 'Ingressos'],
                    en: ['Meals', 'Tickets'] },
      stops: [],
      photo: 'arte/capa-transfer.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 35,
      priceNote: { pt: 'Valor sob consulta — me chame no WhatsApp.',
                   en: 'Price on request — message me on WhatsApp.' },
    },
    { id: 'transfer-cidades', type: 'transfer', region: 'transfer',
      name: { pt: 'Transfer para outras cidades', en: 'Transfer to other cities' },
      desc: { pt: 'Do seu hotel em Roma para outra cidade da Itália, ou de outra cidade para Roma, com motorista particular em língua portuguesa.',
              en: 'From your hotel in Rome to another Italian city, or from another city to Rome, with a private Portuguese-speaking driver.' },
      meeting: 'No seu hotel',
      duration: 'Por trecho', distance: '', effort: 'easy',
      includes: { pt: ['Motorista em língua portuguesa', 'Pedágio, combustível e estacionamento'],
                    en: ['Portuguese-speaking driver', 'Tolls, fuel and parking'] },
      notIncludes: { pt: ['Refeições'],
                    en: ['Meals'] },
      stops: [],
      photo: 'arte/capa-transfer.jpg',
      price: 0, priceMode: 'tabela',
      tabela: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      min: 1, max: 20, payPolicy: 'split', status: 'draft', order: 36,
      priceNote: { pt: 'Valor sob consulta, conforme a cidade e o tamanho do grupo.',
                   en: 'Price on request, depending on the city and the group size.' },
    },
  ];

  db.rules = [
    { id: 'r1', tourId: 'roma-antiga-3h', weekdays: [1, 2, 3, 4, 5, 6], time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r2', tourId: 'roma-antiga-4h', weekdays: [1, 4, 6],          time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r3', tourId: 'vaticano-3h',    weekdays: [1, 2, 4, 5, 6],    time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r4', tourId: 'vaticano-4h',    weekdays: [1, 4],             time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r5', tourId: 'barroca-3h',     weekdays: [0, 1, 2, 3, 4, 5, 6], time: '10:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r6', tourId: 'noturno-3h',     weekdays: [4, 5, 6],          time: '19:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r7', tourId: 'basilicas-3h',   weekdays: [2, 5],             time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r8', tourId: 'panoramas-3h',   weekdays: [3, 6],             time: '15:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    /* Audiencia Papal: quarta-feira, so. O Vaticano nao faz em outro dia —
       oferecer uma terca aqui seria vender o que nao existe. */
    { id: 'r9',  tourId: 'papal-convites',       weekdays: [3], time: '08:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r10', tourId: 'papal-acompanhamento', weekdays: [3], time: '08:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r11', tourId: 'papal-acomp-transfer', weekdays: [3], time: '07:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r12', tourId: 'bv-tivoli',   weekdays: [1, 3, 5], time: '08:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r13', tourId: 'bv-assis',    weekdays: [2, 6],    time: '07:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r14', tourId: 'bv-pompeia',  weekdays: [0, 4],    time: '07:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r15', tourId: 'bv-amalfi',   weekdays: [5],       time: '07:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r16', tourId: 'bv-castelli', weekdays: [2],       time: '08:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    /* Transfer roda todo dia. Os horarios cobrem os dois lados da virada das
       21h, que e onde a tabela dela troca de valor. */
    { id: 'r17', tourId: 'transfer-aeroporto',     weekdays: [0, 1, 2, 3, 4, 5, 6], time: '09:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r18', tourId: 'transfer-aeroporto',     weekdays: [0, 1, 2, 3, 4, 5, 6], time: '15:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r19', tourId: 'transfer-aeroporto',     weekdays: [0, 1, 2, 3, 4, 5, 6], time: '22:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r20', tourId: 'transfer-civitavecchia', weekdays: [0, 1, 2, 3, 4, 5, 6], time: '07:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r21', tourId: 'transfer-termini',       weekdays: [0, 1, 2, 3, 4, 5, 6], time: '10:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r22', tourId: 'transfer-termini',       weekdays: [0, 1, 2, 3, 4, 5, 6], time: '21:30', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
    { id: 'r23', tourId: 'transfer-outlet',        weekdays: [1, 2, 3, 4, 5, 6],    time: '10:00', capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) },
  ];

  /* Todo passeio no ar tem datas na demonstracao. Sem isto, os que nao tinham
     regra mostravam "me chame que eu te passo as datas" — numa vitrine feita
     para vender, parece passeio que nao acontece. Passeio privativo sai em
     qualquer dia; a Audiencia Papal, so na quarta. */
  const HORA_TIPO = { walk: '09:00', day: '07:30', papal: '08:00', transfer: '10:00' };
  let nRegra = db.rules.length;
  for (const x of db.tours) {
    if (x.status !== 'live' || db.rules.some(r => r.tourId === x.id)) continue;
    db.rules.push({ id: 'r' + (++nRegra), tourId: x.id,
      weekdays: x.type === 'papal' ? [3] : [0, 1, 2, 3, 4, 5, 6],
      time: /^noturno/.test(x.id) ? '19:30' : (HORA_TIPO[x.type] || '09:00'),
      capacity: 20, from: isoToday(), until: addDays(isoToday(), 180) });
  }

  db.coupons = [
    { code: 'VOLTA10', pct: 10, until: '2026-12-31', oncePerPerson: true, uses: [] },
    { code: 'AMIGO15', pct: 15, until: '2026-12-31', oncePerPerson: true, uses: [] },
  ];

  /* ---- clientes e reservas de exemplo (histórico crível) ---- */
  const people = [
    ['Patrícia Menezes',  'patricia.menezes@email.com', '+55 11 98123 4455', 'pat.menezes',  'instagram'],
    ['Rodrigo Tavares',   'rodrigo.tavares@email.com',  '+55 21 99654 1122', '',             'friend'],
    ['Luciana Prado',     'luciana.prado@email.com',    '+55 31 98877 3344', 'lu.prado',     'instagram'],
    ['Fernando Aguiar',   'fernando.aguiar@email.com',  '+351 912 445 778',  '',             'friend'],
    ['Cristina Bonatto',  'cris.bonatto@email.com',     '+55 51 99231 7788', 'cris.bonatto', 'whatsapp'],
    ['Marcelo Yamada',    'm.yamada@email.com',         '+55 11 97744 2211', '',             'site'],
    ['Renata Coutinho',   'renata.coutinho@email.com',  '+55 41 99812 3399', 'recoutinho',   'friend'],
    ['Paulo Sérgio Lima', 'ps.lima@email.com',          '+55 85 98122 6677', '',             'agency'],
  ];
  const plan = [
    /* [pessoa, passeio, dias atrás, pax, quitado?] */
    [0, 'roma-antiga-3h', 46, 2, true],  [1, 'vaticano-3h', 39, 4, true],
    [2, 'barroca-3h',     33, 2, true],  [3, 'bv-tivoli',   27, 5, true],
    [4, 'papal-acompanhamento', 22, 2, true], [0, 'noturno-3h', 18, 2, true],
    [5, 'bv-pompeia',     13, 4, true],  [6, 'vaticano-4h',  9, 3, true],
    [7, 'roma-antiga-3h',  5, 6, true],  [2, 'basilicas-3h', 2, 2, true],
    [1, 'bv-amalfi',      -4, 4, false], [3, 'panoramas-3h', -8, 2, false],
    [6, 'papal-convites', -11, 2, true], [4, 'bv-assis',    -16, 6, false],
  ];
  let n = 0;
  for (const [pi, tourId, back, pax, settled] of plan) {
    const [name, email, whats, insta, origin] = people[pi];
    const x = db.tours.find(z => z.id === tourId);
    const date = addDays(isoToday(), -back);
    const rule = db.rules.find(r => r.tourId === tourId);
    const time = rule ? rule.time : '10:00';
    const total = x.priceMode === 'transfer' ? transferPreco(x, pax, 0, time)
                : x.priceMode === 'tabela' ? tabelaPreco(x, pax)
                : x.priceMode === 'session' ? x.price : x.price * pax;
    const created = addDays(date, -(7 + (n % 9)));
    const payments = [];
    if (x.payPolicy === 'split') {
      payments.push({ amount: Math.round(total / 2), date: created, method: 'card', kind: 'deposit' });
      if (settled) payments.push({ amount: total - Math.round(total / 2), date: addDays(date, -1), method: 'card', kind: 'balance' });
    } else {
      payments.push({ amount: total, date: created, method: n % 3 === 0 ? 'applepay' : 'card', kind: 'full' });
    }
    db.bookings.push({
      id: 'demo' + (++n), code: PREFIXO + '-' + (2100 + n * 37 % 7800),
      tourId, date, time, name, email, whats, insta, pax, total,
      coupon: null, discount: 0, policy: x.payPolicy, payments,
      consent: (n % 3 !== 0)
        ? { ok: true, at: created + 'T10:00:00.000Z', src: 'checkout' }
        : { ok: false },
      status: 'confirmed', createdAt: created + 'T10:00:00.000Z', origin,
    });
  }
  return db;
}

/* apaga tudo — o guia começa do zero */
function clearAll() {
  DB = _blank();
  DB.demo = false;
  save();
}
function restoreDemo() { DB = _seed(); save(); }

/* ---------- migração de ajustes ----------
   Quem já usa o app tem um DB salvo — e a nuvem também. Sem isto,
   todo campo novo que a gente criar nasce vazio para eles e a tela
   quebra em silêncio. Preenche só o que falta; nunca sobrescreve. */
function fillSettings(s) {
  const d = _blank().settings;
  s = s || {};
  for (const k of Object.keys(d)) {
    if (s[k] === undefined || s[k] === null || s[k] === '') s[k] = d[k];
  }
  /* bio é objeto: garante os dois idiomas */
  if (typeof s.bio !== 'object' || !s.bio) s.bio = d.bio;
  else { if (!s.bio.pt) s.bio.pt = d.bio.pt; if (!s.bio.en) s.bio.en = d.bio.en; }
  return s;
}

let DB = null;
/* Versao dos dados de DEMONSTRACAO. Sobe quando o catalogo de exemplo muda.

   Sem isto, quem abriu o link uma vez fica para sempre com os dados daquele
   dia: o navegador guarda a demonstracao e nunca mais olha o catalogo novo.
   Aconteceu em 18/09/2026 — a v1.57 trouxe a tabela de transfer de 2026 e
   os links de parceira, e quem tinha aberto a v1.56 continuava vendo o
   transfer antigo (que nem funcionava mais) e nenhum link.

   So vale para a DEMONSTRACAO e sem nuvem: dados de verdade nunca sao
   trocados por exemplo. Os pedidos de roteiro feitos no aparelho ficam. */
const SEED_VER = 5;   /* 5: ingressos por idade (18/09/2026) */

function load() {
  try { DB = JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { DB = null; }
  if (DB && DB.demo && !temNuvem() && (+DB.seedVer || 1) < SEED_VER) {
    const pedidos = DB.pedidos || [];
    DB = _seed();
    DB.pedidos = pedidos;
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  }
  /* O app esta em producao. Aparelho novo (ou navegador limpo) tem que
     comecar VAZIO e receber o que esta na nuvem — nunca publicar um catalogo
     inventado por cima do dela. Antes isto semeava a demonstracao e o save()
     empurrava para a nuvem: bastava ela instalar no celular para os passeios
     reais virarem os ficticios. A demonstracao so volta pelo botao no ADM. */
  if (!DB || !DB.tours) {
    /* Sem nuvem configurada (config.js vazio) o app e um prototipo: nasce com
       os passeios de exemplo, e nao existe nuvem para onde empurra-los.
       Com nuvem, aparelho novo comeca VAZIO e recebe o que esta la. */
    DB = temNuvem() ? _blank() : _seed();
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  }
  DB.settings = fillSettings(DB.settings);
  return DB;
}
function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
  if (typeof cloudPushState === 'function') cloudPushState();
  if (typeof itAgendar === 'function') itAgendar();
}
function resetDemo() { DB = _seed(); save(); }

const uid = () => Math.random().toString(36).slice(2, 9);
const bookCode = () => PREFIXO + '-' + Math.floor(1000 + Math.random() * 9000);

/* ---------- passeios ---------- */
const Tours = {
  all()      { return [...DB.tours].sort((a, b) => a.order - b.order); },
  live()     { return Tours.all().filter(t => t.status !== 'draft'); },
  get(id)    { return DB.tours.find(t => t.id === id); },
  create(t)  { t.id = uid(); t.order = DB.tours.length + 1; DB.tours.push(t); save(); return t; },
  update(id, patch) { Object.assign(Tours.get(id), patch); save(); },
  duplicate(id) {
    const src = Tours.get(id); if (!src) return null;
    const cp = JSON.parse(JSON.stringify(src));
    cp.id = uid(); cp.order = DB.tours.length + 1; cp.status = 'draft';
    cp.name = { pt: src.name.pt + ' (cópia)', en: src.name.en + ' (copy)' };
    DB.tours.push(cp); save(); return cp;
  },
  remove(id) {
    DB.tours = DB.tours.filter(t => t.id !== id);
    DB.rules = DB.rules.filter(r => r.tourId !== id);
    DB.departures = DB.departures.filter(d => d.tourId !== id);
    save();
  },
  futureBookings(id) {
    const today = isoToday();
    return DB.bookings.filter(b => b.tourId === id && b.status === 'confirmed' && b.date >= today);
  },
};

/* ---------- calendário ---------- */
function isoToday() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

const Cal = {
  rulesFor(tourId) { return DB.rules.filter(r => r.tourId === tourId); },
  addRule(r) { r.id = uid(); DB.rules.push(r); save(); return r; },
  removeRule(id) { DB.rules = DB.rules.filter(r => r.id !== id); save(); },
  addDeparture(d) { d.id = uid(); DB.departures.push(d); save(); return d; },
  removeDeparture(id) { DB.departures = DB.departures.filter(d => d.id !== id); save(); },
  addBlock(b) { b.id = uid(); DB.blocks.push(b); save(); return b; },
  removeBlock(id) { DB.blocks = DB.blocks.filter(x => x.id !== id); save(); },
  blocked(date) { return DB.blocks.some(b => date >= b.from && date <= b.until); },

  /* todas as saídas de um passeio num intervalo: regras expandidas + avulsas − bloqueios */
  departures(tourId, fromIso, toIso) {
    const out = [];
    for (const r of Cal.rulesFor(tourId)) {
      let d = fromIso < r.from ? r.from : fromIso;
      const end = toIso < r.until ? toIso : r.until;
      while (d <= end) {
        const wd = new Date(d + 'T12:00:00').getDay();
        if (r.weekdays.includes(wd) && !Cal.blocked(d)) {
          out.push({ tourId, date: d, time: r.time, capacity: r.capacity, ruleId: r.id });
        }
        d = addDays(d, 1);
      }
    }
    for (const dep of DB.departures.filter(x => x.tourId === tourId)) {
      if (dep.date >= fromIso && dep.date <= toIso && !Cal.blocked(dep.date)) out.push(dep);
    }
    out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return out;
  },

  seatsLeft(tourId, date, time, capacity) {
    /* logada: conta pelas reservas. Visitante: usa a contagem pública,
       que não expõe nome nem telefone de ninguém. */
    const local = DB.bookings
      .filter(b => b.tourId === tourId && b.date === date && b.time === time && b.status === 'confirmed')
      .reduce((s, b) => s + b.pax, 0);
    let taken = local;
    if (Array.isArray(DB.seatCounts) && DB.seatCounts.length) {
      const row = DB.seatCounts.find(c => c.tourId === tourId && c.date === date && c.time === time);
      taken = Math.max(local, row ? row.pax : 0);
    }
    return Math.max(0, capacity - taken);
  },
};

/* ---------- cupons ---------- */
const Coupons = {
  all() { return DB.coupons; },
  create(c) { DB.coupons.push(c); save(); },
  remove(code) { DB.coupons = DB.coupons.filter(c => c.code !== code); save(); },
  validate(code, email) {
    const c = DB.coupons.find(x => x.code.toUpperCase() === String(code).toUpperCase());
    if (!c) return { ok: false, reason: 'notfound' };
    if (c.until && isoToday() > c.until) return { ok: false, reason: 'expired' };
    if (c.oncePerPerson && email && c.uses.includes(email)) return { ok: false, reason: 'used' };
    return { ok: true, coupon: c };
  },
  consume(code, email) {
    const c = DB.coupons.find(x => x.code === code);
    if (c && email && !c.uses.includes(email)) { c.uses.push(email); save(); }
  },
};

/* ---------- reservas e pagamentos ---------- */
const Bookings = {
  all() { return [...DB.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
  get(id) { return DB.bookings.find(b => b.id === id); },
  byCode(code) { return DB.bookings.find(b => b.code === code); },

  create({ tourId, date, time, name, email, whats, insta, pax, coupon, policy, origin, consent, opcao, group, adultos, criancas, idades, veioPor, indicadoPor, nasc, compradorVai }) {
    const tour = Tours.get(tourId);
    /* Tem que ser o MESMO calculo que a tela mostrou. tour.price * pax ignora
       o preco escalonado (195 para as 3 primeiras, 225 depois) e gravava a
       reserva abaixo do que a pessoa acabou de ler. */
    /* O veiculo tem que vir junto: sem ele, uma reserva de minivan as 22h
       era gravada pelo valor do carro diurno. A tela mostrava 130 e o caixa
       guardava 90, e so o extrato no fim do mes acusaria. */
    const pr0 = Bookings.precoDe(tour, tourId, date, time, pax, { opcao });
    const base = pr0.total;
    let discount = 0, couponCode = null;
    if (coupon) {
      const v = Coupons.validate(coupon, email);
      if (v.ok) { discount = Math.round(base * v.coupon.pct) / 100 * 1; discount = Math.round(base * v.coupon.pct / 100); couponCode = v.coupon.code; }
    }
    /* ingressos por idade: somados ao total, porque e ela quem compra */
    const nAdultos = Number.isFinite(+adultos) && adultos !== undefined ? +adultos : pax;
    const ing = ingressosDe(tour, nAdultos, idades || []);
    const total = base - discount + ing.total;
    const b = {
      id: uid(), code: bookCode(), tourId, date, time,
      name, email, whats, insta: insta || '', pax, total,
      coupon: couponCode, discount, policy,
      /* quem vem: adultos e menores de 18. O preco e pelo total; a divisao e
         para ela saber quem e crianca (ingresso, cadeirinha, ritmo). */
      adultos: Number.isFinite(+adultos) && adultos !== undefined ? +adultos : pax,
      criancas: +criancas || 0,
      idades: (idades || []).map(v => (v === '' || v == null) ? null : +v),
      ingressos: ing.total || ing.totalDia ? { linhas: ing.linhas, total: ing.total, noDia: ing.noDia, totalDia: ing.totalDia } : null,
      veiculo: pr0.veiculo || '', malas: pr0.malas || '',
      /* Transfer: o que se paga antes e o SINAL da tabela dela, nao a metade.
         O resto e no dia. */
      sinal: tour && tour.priceMode === 'transfer' ? (pr0.sinal || 0) : 0,
      /* QUEM MAIS VEM NO GRUPO.

         A Ingrid pediu isto em audio: ate hoje ela so registra quem fez a
         reserva, mas muita gente volta depois por indicacao de alguem que
         VEIO JUNTO e nunca falou com ela. Sem os nomes do grupo, essa
         pessoa nao existe na base dela e a indicacao se perde. */
      group: Array.isArray(group) ? group.filter(g => g && g.nome).map(g => ({
        nome: String(g.nome).trim(),
        nasc: String(g.nasc || '').trim(),
        whats: String(g.whats || '').trim(),
      })) : [],
      /* como conheceu (a coluna "veio por" da planilha dela) */
      veioPor: veioPor || '', indicadoPor: String(indicadoPor || '').trim(),
      /* quem compra pode nao ir (reservou para a mae): entao a data de
         nascimento dele so vale para o ingresso se ele for */
      nasc: String(nasc || '').trim(), compradorVai: compradorVai !== false,
      consent: consent ? { ok: true, at: new Date().toISOString(), src: 'checkout' } : { ok: false },
      payments: [], status: 'confirmed',
      createdAt: new Date().toISOString(), origin: origin || 'site',
      /* Em que idioma ele reservou. Sem isto o e-mail de recibo sai em
         portugues para um frances que leu a tela inteira em ingles. */
      lang: (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt',
    };
    /* Aqui havia um pagamento inventado: toda reserva nascia marcada como paga
       no cartao. O painel, o caixa e os relatorios contavam dinheiro que nunca
       entrou. A reserva nasce sem pagamento nenhum — quem registra e o guia,
       quando o dinheiro cai de verdade. E aqui que o Stripe entra um dia. */
    DB.bookings.push(b);
    /* o cadastro de quem reservou e de cada um do grupo (operacao.js) */
    if (typeof cadastroDaReserva === 'function') cadastroDaReserva(b);
    if (couponCode) Coupons.consume(couponCode, email);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudPushBooking === 'function') cloudPushBooking(b);
    if (couponCode && typeof cloudPushState === 'function') cloudPushState();
    return b;
  },

  /* Reserva fechada fora do app (WhatsApp, Instagram, na rua). O guia
     informa o que combinou e quanto ja recebeu — nada e inventado aqui. */
  /* Ela aperta "avisar cliente" quando o dinheiro caiu de verdade. Isto so
     MARCA a reserva; quem manda o e-mail e o robo, de meia em meia hora.
     O e-mail nao pode sair daqui: mandar exige a chave do Resend, e chave
     dentro do navegador fica publica para qualquer um.

     Nao ha "desmarcar": uma vez que o e-mail saiu, ele saiu. Deixar
     desmarcar so criaria um botao que promete desfazer o que nao volta. */
  confirmarCliente(id) {
    const b = Bookings.get(id);
    if (!b || b.clienteConfirmado) return null;
    b.clienteConfirmado = { em: new Date().toISOString() };
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
    return b;
  },

  criarManual({ tourId, date, time, name, whats, email, pax, total, recebido, metodo, veioPor, indicadoPor }) {
    const b = {
      id: uid(), code: bookCode(), tourId, date, time,
      name, email: email || '', whats: whats || '', insta: '',
      pax: +pax || 1, total: Math.max(0, +total || 0),
      coupon: null, discount: 0, policy: 'full',
      consent: { ok: false },
      payments: [], status: 'confirmed',
      createdAt: new Date().toISOString(), origin: 'manual',
      veioPor: veioPor || '', indicadoPor: String(indicadoPor || '').trim(),
    };
    const val = Math.max(0, Math.min(+recebido || 0, b.total));
    if (val > 0) {
      b.payments.push({ amount: val, date: isoToday(), method: metodo || 'other',
                        kind: val >= b.total ? 'full' : 'deposit' });
    }
    DB.bookings.push(b);
    if (typeof cadastroDaReserva === 'function') cadastroDaReserva(b);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudPushBooking === 'function') cloudPushBooking(b);
    return b;
  },

  paid(b)   { return Math.round((b.payments || []).reduce((s, p) => s + (+p.amount || 0), 0) * 100) / 100; },   // em centavos: 30,06+10,10+60,04 não deixa 0,0000001 "a pagar"
  /* ---------- preco escalonado ----------
     O guia vende as primeiras vagas de cada data mais barato: 195 para
     os 3 primeiros, 225 depois. O calculo e por DATA, nao por reserva —
     quem chega quando ja ha 2 vendidos leva 1 barato e o resto caro. */
  precoDe(x, tourId, date, time, pax, opt) {
    const cheio = +x.price || 0;
    const tarde = +x.priceLate || 0;
    const vagasBaratas = +x.earlySeats || 0;
    if (x.priceMode === 'transfer') {
      const opcao = (opt && opt.opcao) || 0;
      const l = transferLinha(x, pax, opcao);
      const v = transferPreco(x, pax, opcao, time);
      return { total: v, linhas: [{ qtd: 1, valor: v, fechado: true }],
               veiculo: l ? l.veiculo : '', malas: l ? l.malas : '', sinal: l ? +l.sinal || 0 : 0,
               noturno: transferNoturno(time), consultar: v === 0 };
    }
    if (x.priceMode === 'tabela') {
      const v = tabelaPreco(x, pax);
      return { total: v, linhas: [{ qtd: pax, valor: v, fechado: true }], consultar: v === 0 };
    }
    if (x.priceMode === 'session') return { total: cheio, linhas: [{ qtd: 1, valor: cheio }] };
    if (!tarde || !vagasBaratas) return { total: cheio * pax, linhas: [{ qtd: pax, valor: cheio }] };

    const jaVendidos = Bookings.vendidosEm(tourId, date, time);
    const baratas = Math.max(0, Math.min(pax, vagasBaratas - jaVendidos));
    const caras = pax - baratas;
    const linhas = [];
    if (baratas) linhas.push({ qtd: baratas, valor: cheio });
    if (caras)   linhas.push({ qtd: caras,   valor: tarde });
    return { total: baratas * cheio + caras * tarde, linhas, baratasRestantes: Math.max(0, vagasBaratas - jaVendidos) };
  },

  /* lugares ja vendidos numa saida — base do preco escalonado e das vagas */
  vendidosEm(tourId, date, time) {
    const local = DB.bookings
      .filter(b => b.tourId === tourId && b.date === date && b.time === time && b.status !== 'cancelled')
      .reduce((s, b) => s + b.pax, 0);
    let n = local;
    if (Array.isArray(DB.seatCounts) && DB.seatCounts.length) {
      const row = DB.seatCounts.find(c => c.tourId === tourId && c.date === date && c.time === time);
      if (row) n = Math.max(local, +row.pax);
    }
    return n;
  },
  due(b)    { return Math.max(0, Math.round(((+b.total || 0) - Bookings.paid(b)) * 100) / 100); },
  /* Cada passeio tem seu prazo. O de Natal cobra o saldo 30 dias antes,
     nao na vespera — usar um numero fixo aqui cobraria tarde demais. */
  dueDate(b){
    /* transfer: o sinal garante, o resto e no dia */
    if (b.policy === 'sinal') return b.date;
    const x = Tours.get(b.tourId);
    const dias = (x && +x.balanceDays) || 1;
    return addDays(b.date, -dias);
  },
  payBalance(id, method) {
    const b = Bookings.get(id); if (!b) return;
    const due = Bookings.due(b); if (due <= 0) return;
    b.payments.push({ amount: due, date: isoToday(), method: method || 'card', kind: 'balance' });
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
  },
  cancel(id) { const b = Bookings.get(id); if (b) { b.status = 'cancelled';
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b); } },

  /* extrato: uma linha por PAGAMENTO (é o que o contador quer) */
  statement(fromIso, toIso) {
    const rows = [];
    for (const b of DB.bookings) {
      for (const p of b.payments) {
        if (p.date >= fromIso && p.date <= toIso) {
          rows.push({ date: p.date, client: b.name, tourId: b.tourId,
                      kind: p.kind, method: p.method, amount: p.amount, code: b.code, conta: p.conta || '' });
        }
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  },
};

load();

/* ---------- pedidos de roteiro personalizado ----------
   O que o cliente respondeu em "Monte seu roteiro". A entrega de verdade e
   pelo WhatsApp dela (a mensagem sai pronta); isto aqui e a memoria, para
   ela ver no painel quem pediu, quando, e se ja respondeu.

   Com a nuvem ligada, o pedido de um cliente vive no aparelho DELE ate
   existir uma tabela propria no Supabase — anotado na entrega. */
const Roteiros = {
  all() { return [...(DB.pedidos || [])].sort((a, b) => (b.criado || '').localeCompare(a.criado || '')); },
  cria(r) {
    const limpa = (v) => String(v || '').trim();
    const ped = {
      id: uid(), criado: new Date().toISOString(), respondido: false,
      nome: limpa(r.nome), whats: limpa(r.whats), email: limpa(r.email),
      ini: limpa(r.ini), fim: limpa(r.fim),
      adultos: Math.max(1, +r.adultos || 1), criancas: Math.max(0, +r.criancas || 0), idades: limpa(r.idades),
      onde: [...(r.onde || [])], ondeOutro: limpa(r.ondeOutro),
      gosto: [...(r.gosto || [])], precisa: [...(r.precisa || [])], ritmo: r.ritmo || '',
      obs: limpa(r.obs), modo: r.modo || '',
      lang: (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt',
    };
    DB.pedidos = DB.pedidos || [];
    DB.pedidos.push(ped);
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    /* o cliente no site: o pedido vai para o banco e chega no celular dela */
    if (typeof itPedidoPublico === 'function' && !(typeof isLoggedIn === 'function' && isLoggedIn())) itPedidoPublico('pedidos', ped);
    return ped;
  },
  marca(id, respondido) {
    const p = (DB.pedidos || []).find(x => x.id === id);
    if (!p) return;
    p.respondido = !!respondido;
    save();
  },
};

/* ---------- clientes (derivados das reservas) ---------- */
const Clients = {
  all() {
    const map = new Map();
    for (const b of DB.bookings) {
      if (b.status === 'cancelled') continue;
      const key = (b.email || b.whats || b.name).toLowerCase();
      const c = map.get(key) || { key, name: b.name, email: b.email, whats: b.whats, insta: b.insta,
                                  tours: 0, spent: 0, last: '', origins: new Set(), consent: false, consentAt: '' };
      c.tours += 1;
      c.spent += Bookings.paid(b);
      if (b.date > c.last) c.last = b.date;
      if (b.origin) c.origins.add(b.origin);
      if (b.consent && b.consent.ok) { c.consent = true; c.consentAt = b.consent.at; }
      if (!c.insta && b.insta) c.insta = b.insta;
      map.set(key, c);

      /* QUEM VEIO JUNTO tambem e cliente.

         A Ingrid explicou o porque: muita gente volta anos depois por
         indicacao de alguem que estava NO GRUPO e nunca falou com ela. Se a
         base so tem quem reservou, essa pessoa chega do nada e a indicacao
         se perde. Aqui ela entra com o nome, a data de nascimento e por
         quem veio.

         Nao tem e-mail nem WhatsApp: a chave e o nome. Homonimo junta os
         dois, e tudo bem — e melhor que nao existir. */
      for (const g of (b.group || [])) {
        /* Trim aqui tambem, e nao so em create(): reserva que chega da nuvem
           nao passa por create, e um nome so com espacos viraria um cliente
           sem nome na base dela. */
        const gnome = String((g && g.nome) || '').trim();
        if (!gnome) continue;
        const gk = 'g:' + gnome.toLowerCase();
        const gc = map.get(gk) || { key: gk, name: gnome, email: '', whats: '', insta: '',
                                    nasc: String((g && g.nasc) || '').trim(), veioCom: b.name, acompanhante: true,
                                    tours: 0, spent: 0, last: '', origins: new Set(),
                                    consent: false, consentAt: '' };
        gc.tours += 1;
        if (b.date > gc.last) gc.last = b.date;
        if (!gc.nasc && g.nasc) gc.nasc = String(g.nasc).trim();
        if (b.origin) gc.origins.add(b.origin);
        map.set(gk, gc);
      }
    }
    /* Acompanhante nao gastou nada por si: ordenar so por gasto jogaria todos
       para o fim da lista. Quem gastou vem primeiro; depois, os mais recentes. */
    return [...map.values()].sort((a, b) =>
      (b.spent - a.spent) || (b.last || '').localeCompare(a.last || ''));
  },
};

/* ---------- relatórios ---------- */
const Reports = {
  /* receita por mês do ano corrente */
  byMonth(year) {
    /* "Recebido" tem que ser dinheiro que ja entrou. Sem este corte, um saldo
       agendado para amanha entrava no grafico como recebido hoje — e o total
       do topo (que so conta ate hoje) discordava do grafico na mesma tela. */
    const hoje = isoToday();
    const out = Array(12).fill(0);
    for (const b of DB.bookings) {
      for (const p of b.payments) {
        if (!p.date || p.date > hoje) continue;
        if (p.date.slice(0, 4) === String(year)) out[+p.date.slice(5, 7) - 1] += p.amount;
      }
    }
    return out;
  },
  /* receita das últimas 8 semanas */
  byWeek(weeks = 8) {
    const out = [];
    let end = isoToday();
    for (let i = 0; i < weeks; i++) {
      const start = addDays(end, -6);
      let sum = 0;
      for (const b of DB.bookings) {
        for (const p of b.payments) if (p.date >= start && p.date <= end) sum += p.amount;
      }
      out.unshift({ label: start.slice(8) + '/' + start.slice(5, 7), value: sum });
      end = addDays(start, -1);
    }
    return out;
  },
  /* desempenho por passeio no intervalo */
  byTour(fromIso, toIso) {
    return Tours.all().map(x => {
      const bs = DB.bookings.filter(b => b.tourId === x.id && b.status !== 'cancelled'
                                    && b.date >= fromIso && b.date <= toIso);
      const deps = new Set(bs.map(b => b.date + b.time));
      const pax = bs.reduce((s, b) => s + b.pax, 0);
      const revenue = bs.reduce((s, b) => s + Bookings.paid(b), 0);
      const seats = deps.size * (x.max || 1);
      return { tour: x, departures: deps.size, pax, revenue,
               occupancy: seats ? Math.round(pax / seats * 100) : 0 };
    }).filter(r => r.departures > 0 || r.revenue > 0);
  },
  /* de onde vieram as reservas */
  byOrigin(fromIso, toIso) {
    const map = {};
    let total = 0;
    for (const b of DB.bookings) {
      if (b.status === 'cancelled' || b.date < fromIso || b.date > toIso) continue;
      const o = b.origin || 'site';
      map[o] = (map[o] || 0) + 1; total++;
    }
    return Object.entries(map)
      .map(([k, n]) => ({ origin: k, n, pct: total ? Math.round(n / total * 100) : 0 }))
      .sort((a, b) => b.n - a.n);
  },
  totals(fromIso, toIso) {
    const bs = DB.bookings.filter(b => b.status !== 'cancelled' && b.date >= fromIso && b.date <= toIso);
    const revenue = DB.bookings.reduce((s, b) =>
      s + b.payments.filter(p => p.date >= fromIso && p.date <= toIso).reduce((t, p) => t + p.amount, 0), 0);
    const pax = bs.reduce((s, b) => s + b.pax, 0);
    const deps = new Set(bs.map(b => b.tourId + b.date + b.time)).size;
    const due = bs.reduce((s, b) => s + Bookings.due(b), 0);
    return { revenue, pax, deps, bookings: bs.length, due,
             ticket: bs.length ? Math.round(revenue / pax || 0) : 0 };
  },
};
