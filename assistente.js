/* =====================================================
   AGENTES — assistente do painel, Marketing (e anúncios) e Atendimento
   =====================================================
   Arquivo fechado. No resto do app só existe a linha que o carrega no
   index.html: tirando essa linha, o app volta a ser o que era.

   Três agentes, um cérebro só:
   1. Assistente — botão fixo em todas as abas do painel. Lê passeios,
      agenda, vagas e reservas; grava (passeio, preço, horário, bloqueio,
      cupom, plano, criativo, anúncio, memória) depois de um cartão
      "confirma?".
   2. Marketing — plano de postagem ligado às vagas, criativos (foto num
      molde da marca → PNG, nunca imagem de IA), planos de anúncio, kit de
      marca e memória.
   3. Atendimento — WhatsApp e Instagram: a mensagem do cliente chega, o
      agente consulta as vagas reais e escreve a resposta no idioma dele;
      o guia aprova com um toque, ou deixa no automático.

   MODO DEMONSTRAÇÃO (sem chave): o protótipo de venda não tem chave de
   ninguém. Os pedidos prontos rodam as MESMAS ferramentas, de verdade, nos
   dados do protótipo — só o texto do Claude é pré-escrito. Com uma chave
   da Anthropic colada, vira o Claude de verdade.

   A chave fica só no navegador (localStorage), nunca vai para o backup,
   para a nuvem ou para o GitHub. Não existe ferramenta que mande nada
   para fora: o assistente escreve, quem envia é o guia. */
'use strict';

/* Nome próprio de tudo que o assistente guarda no navegador. O endereço
   guia.eugeniofim.com é dividido entre vários apps (a demo, a Ingrid, a Foto,
   a Leda, a Carol, a Dulcineia, a Mari…): com o prefixo fixo 'guia_', a conversa,
   a memória e a chave de IA de um apareciam no outro no mesmo navegador.
   O prefixo sai do DB_KEY (foto_db_v1 → foto_), igual na Carol e na Mari. */
const IA_NS = (typeof DB_KEY !== 'undefined' ? String(DB_KEY).replace(/_db_v\d+$/, '') : 'guia') + '_';
const IA_CHAVE = IA_NS + 'ia_chave';
const IA_HIST = IA_NS + 'ia_hist';
const IA_GASTO = IA_NS + 'ia_gasto';
const IA_CONFIRMA = IA_NS + 'ia_confirma';
/* Migração de uma vez (06/10/2026): quem já usava não perde chave, conversa,
   gasto, "perguntar antes", memória (mkt) nem a chave do Gemini. Se a chave nova
   está vazia e a antiga existe, copia; a antiga só sai depois que a cópia confere.
   Mover e não duplicar: o mkt guarda fotos e, em dobro, estourava o espaço do
   navegador (e aí o save() dos dados do app falha). */
(function iaMudaChavesAntigas() {
  if (IA_NS === 'guia_') return;
  try {
    for (const k of ['ia_chave', 'ia_hist', 'ia_gasto', 'ia_confirma', 'mkt', 'gemini_chave']) {
      const velho = localStorage.getItem('guia_' + k);
      if (velho === null) continue;
      if (localStorage.getItem(IA_NS + k) === null) localStorage.setItem(IA_NS + k, velho);
      if (localStorage.getItem(IA_NS + k) === velho) localStorage.removeItem('guia_' + k);
    }
  } catch (e) {}
})();
const IA_MODELO = 'claude-haiku-4-5';
const IA_PRECO = { in: 1, out: 5, cacheW: 1.25, cacheR: 0.10 };  /* US$ por milhão de tokens */
const IA_MAX_VOLTAS = 10;
/* o histórico guardado: resultado de ferramenta maior que isto é encolhido ao gravar (a resposta
   já foi dada; a próxima mensagem não precisa reenviar 150 linhas da planilha), e o total tem teto */
const IA_RESULT_MAX = 3500, IA_HIST_MAX_CHARS = 45000;   /* 07/10: era 120000 — cada pergunta reenviava ~35 mil tokens de conversa velha (custo da Ingrid) */
/* toda chamada à IA tem prazo — sem isto, rede ruim no celular era "pensando…" para sempre */
const IA_PRAZO_MS = 90000;
function iaFetch(url, opts, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || IA_PRAZO_MS);
  return fetch(url, { ...(opts || {}), signal: ac.signal }).finally(() => clearTimeout(t));
}

const iaLe = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const iaGrava = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const iaChave = () => { try { return (localStorage.getItem(IA_CHAVE) || '').trim(); } catch (e) { return ''; } };
/* Três modos:
   - 'chave': o guia colou a chave dele (produto de verdade);
   - 'vivo':  demo público com o Claude de verdade, pelo cofre (chaves no
              servidor, limite por pessoa e por dia) — ver guia-cofre;
   - 'demo':  sem nada disso, pedidos prontos que rodam as ferramentas. */
const COFRE = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.cofre) || '';
/* De qual cliente é este app. Sem isto, a tela de treino de TODO app
   escreveria por cima do treino do demo — um cliente apagaria o outro. */
const CLIENTE_COFRE = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.clienteCofre) || 'demo';
const urlEnsino = () => COFRE + '/api/ensino?cliente=' + encodeURIComponent(CLIENTE_COFRE);
const COFRE_FIM = IA_NS + 'cofre_fim';
let cofreEstado = { claude: false, imagem: false, instagram: false, whatsapp: false };
const cofreEsgotado = (tipo) => { try { return sessionStorage.getItem(COFRE_FIM + tipo) === new Date().toISOString().slice(0, 10); } catch (e) { return false; } };
const marcaEsgotado = (tipo) => { try { sessionStorage.setItem(COFRE_FIM + tipo, new Date().toISOString().slice(0, 10)); } catch (e) {} };
const iaModo = () => iaChave() ? 'chave' : (cofreEstado.claude && !cofreEsgotado('claude')) ? 'vivo' : 'demo';
const iaDemo = () => iaModo() === 'demo';
if (COFRE) fetch(COFRE + '/api/estado', { cache: 'no-store' }).then(r => r.json()).then(e => {
  cofreEstado = { claude: !!e.claude, imagem: !!e.imagem, instagram: !!e.instagram, whatsapp: !!e.whatsapp };
  if (typeof iaAtualizaFab === 'function') iaAtualizaFab();
  if (iaEl && iaEl.g.classList.contains('aberta') && !iaOcupado) iaDesenha();
  if ((location.hash.startsWith('#/adm/marketing') || location.hash.startsWith('#/adm/inbox')) && typeof route === 'function' && !(typeof isBusyEditing === 'function' && isBusyEditing())) route();
}).catch(() => {});
const iaPerguntaAntes = () => iaLe(IA_CONFIRMA, true) !== false;

/* ---------- textos (PT e EN aqui; FR, IT, DE, ES em IA_TR no fim) ---------- */
const IA_TXT = {
  assistente: { pt: 'Assistente', en: 'Assistant' },
  fechar: { pt: 'Fechar', en: 'Close' },
  vendo: { pt: 'Vendo', en: 'Viewing' },
  pensando: { pt: 'pensando…', en: 'thinking…' },
  enviar: { pt: 'Enviar', en: 'Send' },
  ph: { pt: 'Pergunte ou peça algo…', en: 'Ask or request something…' },
  foto: { pt: 'Mandar uma foto', en: 'Send a photo' },
  fotoPronta: { pt: 'foto pronta para enviar', en: 'photo ready to send' },
  fotosProntas: { pt: '{n} fotos prontas para enviar', en: '{n} photos ready to send' },
  cDuracao: { pt: 'Duração', en: 'Duration' },
  tirar: { pt: 'tirar', en: 'remove' },
  copiar: { pt: 'Copiar', en: 'Copy' },
  copiado: { pt: 'Copiado ✓', en: 'Copied ✓' },
  confirma: { pt: 'confirma?', en: 'confirm?' },
  cancelar: { pt: 'Cancelar', en: 'Cancel' },
  confirmar: { pt: 'Confirmar', en: 'Confirm' },
  feito: { pt: '✓ Feito', en: '✓ Done' },
  cancelado: { pt: 'Cancelado — nada foi gravado', en: 'Cancelled — nothing was saved' },
  assumi: { pt: 'Assumi', en: 'I assumed' },
  perguntar: { pt: 'Perguntar antes de gravar', en: 'Ask before saving' },
  gasto: { pt: 'Gasto aqui: US$', en: 'Spent here: US$' },
  nova: { pt: 'Nova conversa', en: 'New chat' },
  trocarChave: { pt: 'Trocar chave', en: 'Change key' },
  tirarChave: { pt: 'Tirar a chave deste aparelho? Depois é só colar de novo.', en: 'Remove the key from this device? You can paste it again later.' },
  demoTit: { pt: 'Demonstração', en: 'Demo' },
  demoTxt: { pt: 'Toque num pedido. As ações acontecem de verdade nos dados deste protótipo; as respostas são exemplos prontos. Com uma chave da Anthropic, vira o Claude de verdade, escrevendo com as suas palavras.', en: 'Tap a request. The actions really happen on this prototype’s data; the replies are ready-made examples. With an Anthropic key it becomes the real Claude, writing in your own words.' },
  experimente: { pt: 'Experimente pedir', en: 'Try asking' },
  conectar: { pt: 'Conectar o Claude de verdade', en: 'Connect the real Claude' },
  oi: { pt: 'Oi! Consulto passeios, agenda, vagas e reservas; crio e altero passeio, preço, horário, bloqueio e cupom; monto plano de postagem, criativo, anúncio e resposta para cliente. Antes de gravar qualquer coisa, mostro o que vou fazer.', en: 'Hi! I check tours, schedule, seats and bookings; I create and edit tours, prices, times, blocked dates and coupons; I build post plans, creatives, ads and replies to clients. Before saving anything, I show you what I’m about to do.' },
  chaveTit: { pt: 'Para o Claude de verdade responder, cole a sua chave da Anthropic. Ela fica só neste aparelho.', en: 'For the real Claude to answer, paste your Anthropic key. It stays on this device only.' },
  chave1: { pt: 'Entre em console.anthropic.com', en: 'Go to console.anthropic.com' },
  chave2: { pt: 'Em Billing, ponha créditos (US$ 5 duram meses)', en: 'In Billing, add credit (US$ 5 lasts months)' },
  chave3: { pt: 'Em API Keys, crie uma chave e copie', en: 'In API Keys, create a key and copy it' },
  chave4: { pt: 'Cole aqui embaixo', en: 'Paste it below' },
  chaveOk: { pt: 'Guardar e testar', en: 'Save and test' },
  chaveVolta: { pt: '← Voltar para a demonstração', en: '← Back to the demo' },
  chaveRuim: { pt: 'Essa não parece uma chave da Anthropic — ela começa com sk-ant-.', en: 'That doesn’t look like an Anthropic key — it starts with sk-ant-.' },
  testando: { pt: 'Testando…', en: 'Testing…' },
  e401: { pt: 'A chave não foi aceita. Confira se colou inteira.', en: 'The key was not accepted. Check you pasted all of it.' },
  eCredito: { pt: 'Acabaram os créditos da conta Anthropic (console.anthropic.com → Billing).', en: 'Your Anthropic credit ran out (console.anthropic.com → Billing).' },
  e429: { pt: 'Muitas perguntas seguidas. Espere um minuto.', en: 'Too many requests in a row. Wait a minute.' },
  eCheio: { pt: 'A Anthropic está sobrecarregada agora. Tente de novo em instantes.', en: 'Anthropic is overloaded right now. Try again shortly.' },
  eRede: { pt: 'Sem internet, ou a conexão caiu.', en: 'No internet, or the connection dropped.' },
  eFoto: { pt: 'Não consegui abrir essa foto.', en: 'I couldn’t open that photo.' },
  semEspaco: { pt: 'O aparelho ficou sem espaço para fotos. Apague alguma em Marketing → Criativos.', en: 'This device ran out of space for photos. Delete some in Marketing → Creatives.' },
  /* aba Marketing */
  marketing: { pt: 'Marketing', en: 'Marketing' },
  subPlano: { pt: 'Plano de postagem', en: 'Post plan' },
  subCriativos: { pt: 'Criativos', en: 'Creatives' },
  subAnuncios: { pt: 'Anúncios', en: 'Ads' },
  subKit: { pt: 'Kit de marca', en: 'Brand kit' },
  subMemoria: { pt: 'Memória', en: 'Memory' },
  pedirPlano: { pt: '✦ Pedir o plano ao assistente', en: '✦ Ask the assistant for the plan' },
  pedidoPlano: { pt: 'Monte o plano de postagem de {mes}. Olhe a agenda e priorize as saídas com vaga sobrando.', en: 'Build the post plan for {mes}. Check the schedule and prioritise departures with empty seats.' },
  mesVazio: { pt: 'Nada planejado em {mes}, e nenhuma saída com vaga sobrando.', en: 'Nothing planned for {mes}, and no departures with empty seats.' },
  livres: { pt: '{l} de {c} livres', en: '{l} of {c} free' },
  ideia: { pt: 'ideia', en: 'idea' },
  pronto: { pt: 'pronto', en: 'ready' },
  postado: { pt: '✓ postado', en: '✓ posted' },
  copiarLegenda: { pt: 'Copiar legenda', en: 'Copy caption' },
  legendaCopiada: { pt: 'Legenda copiada', en: 'Caption copied' },
  marcarPostado: { pt: 'Marcar postado', en: 'Mark as posted' },
  reescrever: { pt: 'Reescrever', en: 'Rewrite' },
  pedidoReescrever: { pt: 'Reescreva a legenda do item do plano {id} ({tema}).', en: 'Rewrite the caption of plan item {id} ({tema}).' },
  apagar: { pt: 'Apagar', en: 'Delete' },
  apagarItem: { pt: 'Apagar este item?', en: 'Delete this item?' },
  criativosTxt: { pt: 'Foto num molde da sua marca, ou fundo na cor da marca com texto explicativo. Pronto para postar.', en: 'A photo in your brand template, or a brand-colour background with explanatory text. Ready to post.' },
  pedirCriativo: { pt: '✦ Pedir um criativo', en: '✦ Ask for a creative' },
  pedidoCriativo: { pt: 'Monte um story para a próxima saída com vaga sobrando.', en: 'Make a story for the next departure with empty seats.' },
  pedirTexto: { pt: 'Pedir um só de texto', en: 'Ask for a text-only one' },
  pedidoTexto: { pt: 'Monte um post sem foto, com fundo na cor da marca, explicando por que vale a pena fazer o passeio com um guia local.', en: 'Make a post without a photo, on a brand-colour background, explaining why a local guide is worth it.' },
  suasFotos: { pt: 'Suas fotos', en: 'Your photos' },
  enviarFotos: { pt: '+ Enviar fotos', en: '+ Upload photos' },
  fotosTxt: { pt: 'Suas ou de banco de imagens (Unsplash, Pexels — gratuitos). O assistente usa as dos passeios e estas.', en: 'Yours or from free image banks (Unsplash, Pexels). The assistant uses the tour photos and these.' },
  fotoEmUso: { pt: 'Esta foto está num criativo. Apagar mesmo assim?', en: 'This photo is used in a creative. Delete anyway?' },
  baixar: { pt: 'Baixar PNG', en: 'Download PNG' },
  outroTitulo: { pt: 'Outro título', en: 'Another title' },
  pedidoTitulo: { pt: 'Troque o título do criativo {id} por outra opção.', en: 'Give creative {id} a different title.' },
  semCriativo: { pt: 'Nenhum criativo ainda. Peça ao assistente: "faz um story do passeio de sábado".', en: 'No creatives yet. Ask the assistant: "make a story for Saturday’s tour".' },
  anunciosTxt: { pt: 'Planos de anúncio para você montar no Gerenciador de Anúncios da Meta. Quem liga e paga é você.', en: 'Ad plans for you to set up in Meta Ads Manager. You switch them on and pay — never the assistant.' },
  pedirAnuncio: { pt: '✦ Pedir um plano', en: '✦ Ask for a plan' },
  pedidoAnuncio: { pt: 'Monte um plano de anúncio para a saída com mais vaga sobrando nas próximas semanas.', en: 'Build an ad plan for the departure with the most empty seats in the coming weeks.' },
  subiMeta: { pt: 'Subi na Meta', en: 'It’s live on Meta' },
  noAr: { pt: '● no ar', en: '● live' },
  rascunho: { pt: 'rascunho', en: 'draft' },
  objetivo: { pt: 'Objetivo', en: 'Goal' },
  publico: { pt: 'Público', en: 'Audience' },
  verba: { pt: 'Verba', en: 'Budget' },
  porDia: { pt: '/dia', en: '/day' },
  dias: { pt: 'dias', en: 'days' },
  total: { pt: 'total', en: 'total' },
  paraEncher: { pt: 'Para encher', en: 'To fill' },
  fotoRot: { pt: 'Foto', en: 'Photo' },
  porque: { pt: 'Por quê', en: 'Why' },
  versao: { pt: 'Versão', en: 'Version' },
  botaoRot: { pt: 'Botão', en: 'Button' },
  semAnuncio: { pt: 'Nenhum plano de anúncio ainda.', en: 'No ad plans yet.' },
  coresTit: { pt: 'Cores dos criativos', en: 'Creative colours' },
  corPrincipal: { pt: 'Principal', en: 'Main' },
  corDestaque: { pt: 'Destaque', en: 'Accent' },
  corEscura: { pt: 'Escura', en: 'Dark' },
  corNeutra: { pt: 'Neutra', en: 'Neutral' },
  fontesTit: { pt: 'Fontes', en: 'Fonts' },
  fonteImpacto: { pt: 'League Spartan — impacto', en: 'League Spartan — impact' },
  fonteTexto: { pt: 'Montserrat — títulos e texto', en: 'Montserrat — headings and text' },
  vozTit: { pt: 'Sua voz', en: 'Your voice' },
  vozPh: { pt: 'Como você escreve: curto ou longo, com humor ou sério, o que você nunca diria. O assistente segue isto.', en: 'How you write: short or long, witty or serious, what you’d never say. The assistant follows this.' },
  frasesTit: { pt: 'Frases suas (uma por linha)', en: 'Your signature lines (one per line)' },
  proibidasTit: { pt: 'Palavras que o assistente nunca usa (separe por vírgula)', en: 'Words the assistant never uses (comma-separated)' },
  hashtagsTit: { pt: 'Hashtags fixas', en: 'Fixed hashtags' },
  salvar: { pt: 'Salvar', en: 'Save' },
  salvo: { pt: 'Salvo', en: 'Saved' },
  memoriaTxt: { pt: 'O que o assistente aprendeu com você. Ele lê isto antes de cada conversa.', en: 'What the assistant has learned from you. It reads this before every chat.' },
  ensinar: { pt: 'Ensinar algo novo', en: 'Teach something new' },
  ensinarPh: { pt: 'ex.: criança até 6 anos não paga', en: 'e.g. children under 6 go free' },
  guardar: { pt: 'Guardar', en: 'Save' },
  nadaGuardado: { pt: 'Nada guardado ainda.', en: 'Nothing saved yet.' },
  /* aba Atendimento */
  atendimento: { pt: 'Atendimento', en: 'Inbox' },
  inboxTxt: { pt: 'WhatsApp e Instagram num lugar só. O agente lê a pergunta, consulta as vagas de verdade e escreve a resposta no idioma do cliente.', en: 'WhatsApp and Instagram in one place. The agent reads the question, checks the real availability and writes the reply in the client’s language.' },
  inboxDemo: { pt: 'Demonstração: no app real, estas mensagens chegam do WhatsApp e do Instagram do guia.', en: 'Demo: in the real app, these messages arrive from the guide’s WhatsApp and Instagram.' },
  aoVivo: { pt: 'Ao vivo agora', en: 'Live now' },
  sdBom:      { pt: 'Bom dia, {nome}.', en: 'Good morning, {nome}.', fr: 'Bonjour, {nome}.', it: 'Buongiorno, {nome}.', de: 'Guten Morgen, {nome}.', es: 'Buenos días, {nome}.' },
  sdBoa:      { pt: 'Boa tarde, {nome}.', en: 'Good afternoon, {nome}.', fr: 'Bon après-midi, {nome}.', it: 'Buon pomeriggio, {nome}.', de: 'Guten Tag, {nome}.', es: 'Buenas tardes, {nome}.' },
  sdNoite:    { pt: 'Boa noite, {nome}.', en: 'Good evening, {nome}.', fr: 'Bonsoir, {nome}.', it: 'Buonasera, {nome}.', de: 'Guten Abend, {nome}.', es: 'Buenas noches, {nome}.' },
  sdHoje:     { pt: 'Hoje: {n} saída(s), {p} pessoas.', en: 'Today: {n} departure(s), {p} people.', fr: 'Aujourd’hui : {n} départ(s), {p} personnes.', it: 'Oggi: {n} partenza/e, {p} persone.', de: 'Heute: {n} Termin(e), {p} Personen.', es: 'Hoy: {n} salida(s), {p} personas.' },
  sdHojeVazio:{ pt: 'Hoje não há saída marcada.', en: 'No departures today.', fr: 'Aucun départ aujourd’hui.', it: 'Oggi nessuna partenza.', de: 'Heute keine Termine.', es: 'Hoy no hay salidas.' },
  sdFalta:    { pt: 'A receber: {v} em {n} reserva(s).', en: 'Still due: {v} across {n} booking(s).', fr: 'À recevoir : {v} sur {n} réservation(s).', it: 'Da incassare: {v} su {n} prenotazione/i.', de: 'Offen: {v} bei {n} Buchung(en).', es: 'Por cobrar: {v} en {n} reserva(s).' },
  sdConvite:  { pt: 'Me diga o que precisa — eu preencho no app e mostro antes de gravar.', en: 'Tell me what you need — I fill it in the app and show you before saving.', fr: 'Dites-moi ce qu’il vous faut — je remplis l’app et vous montre avant d’enregistrer.', it: 'Dimmi di cosa hai bisogno — riempio l’app e ti mostro prima di salvare.', de: 'Sag mir, was du brauchst — ich trage es ein und zeige es dir vor dem Speichern.', es: 'Dime qué necesitas — lo relleno en la app y te lo muestro antes de guardar.' },
  aoVivoTit: { pt: 'Teste o agente de verdade', en: 'Try the real agent' },
  aoVivoTxt: { pt: 'Mande uma mensagem perguntando sobre um passeio: datas, vagas, preço. Em segundos chega a resposta, escrita pelo agente no seu idioma, com as vagas deste demo.', en: 'Send a message asking about a tour: dates, seats, price. Within seconds the agent replies in your language, with this demo’s availability.' },
  aoVivoNota: { pt: 'Enquanto a Meta analisa o app, o seu Instagram ou número precisa ser liberado antes — peça ao seu contato da Ti Artes (1 minuto).', en: 'While Meta reviews the app, your Instagram or number must be enabled first — ask your Ti Artes contact (1 minute).' },
  ibConversas: { pt: 'Conversas', en: 'Chats' },
  ibEnsinar: { pt: 'Ensinar o agente', en: 'Teach the agent' },
  ensLead: { pt: 'Diga ao agente como falar e o que responder. Passeios, preços e vagas ele já lê sozinho do app.', en: 'Tell the agent how to talk and what to answer. Tours, prices and seats it already reads from the app.' },
  ensReal: { pt: 'Tudo se salva sozinho. No app de verdade, vale na hora para o seu WhatsApp e o seu Instagram; aqui no demo, teste ao lado.', en: 'Everything saves itself. In the real app it applies right away to your WhatsApp and Instagram; in this demo, try it alongside.' },
  ensSalvo: { pt: 'Salvo ✓', en: 'Saved ✓' },
  ensP1: { pt: 'Jeito de falar', en: 'Tone' },
  ensP2: { pt: 'Respostas prontas', en: 'Ready answers' },
  ensP3: { pt: 'Limites', en: 'Limits' },
  ensP4: { pt: 'Testado', en: 'Tested' },
  ensTomTit: { pt: '1. Jeito de falar', en: '1. Tone of voice' },
  tom_simp: { pt: 'Simpático', en: 'Friendly' },
  tom_formal: { pt: 'Formal', en: 'Formal' },
  tom_leve: { pt: 'Leve, com emoji', en: 'Light, with emoji' },
  tom_direto: { pt: 'Direto ao ponto', en: 'Straight to the point' },
  ensTomPh: { pt: 'Algo mais? Ex.: trate o cliente por você', en: 'Anything else? E.g. use first names' },
  ensFaqTit: { pt: '2. Respostas prontas', en: '2. Ready answers' },
  ensFaqSub: { pt: 'O que os clientes sempre perguntam e só você sabe. Toque numa sugestão e escreva do seu jeito.', en: 'What clients always ask and only you know. Tap a suggestion and write it your way.' },
  fqEncontro: { pt: 'Onde é o ponto de encontro?', en: 'Where is the meeting point?' },
  fqIdade: { pt: 'Tem idade mínima?', en: 'Is there a minimum age?' },
  fqCancela: { pt: 'Posso cancelar ou remarcar?', en: 'Can I cancel or reschedule?' },
  fqPaga: { pt: 'Como eu pago?', en: 'How do I pay?' },
  fqLevar: { pt: 'O que devo levar?', en: 'What should I bring?' },
  fqChuva: { pt: 'E se chover?', en: 'What if it rains?' },
  ensOutra: { pt: 'Outra pergunta', en: 'Another question' },
  ensPergunta: { pt: 'Pergunta do cliente', en: 'Client question' },
  ensResposta: { pt: 'Sua resposta', en: 'Your answer' },
  ensRespPh: { pt: 'Sua resposta, do seu jeito. Ex.: na frente da fonte da praça, 10 min antes.', en: 'Your answer, your way. E.g. in front of the fountain in the square, 10 min early.' },
  ensLimTit: { pt: '3. Limites', en: '3. Limits' },
  ensSempre: { pt: 'Sempre ligado: nunca inventa preço, data ou vaga, e só fala de passeios e reservas.', en: 'Always on: never makes up prices, dates or seats, and only talks about tours and bookings.' },
  ensPassaTit: { pt: 'Passa a conversa para você quando for:', en: 'Hands the chat over to you when it’s:' },
  hReclama: { pt: 'Reclamação', en: 'A complaint' },
  hDesconto: { pt: 'Pedido de desconto', en: 'A discount request' },
  hGrupo: { pt: 'Grupo grande', en: 'A large group' },
  hEspecial: { pt: 'Pedido especial (alergia, acessibilidade)', en: 'A special request (allergy, accessibility)' },
  ensNuncaPh: { pt: 'Algo que ele nunca deve dizer? Ex.: não prometer que dá para ver a aurora boreal', en: 'Anything it must never say? E.g. don’t promise the northern lights' },
  ensAplTit: { pt: 'Aplicar no Instagram de verdade', en: 'Apply to the real Instagram' },
  ensAplTxt: { pt: 'Só para o dono: com o código, o robô do @{c} passa a responder com este treino já na próxima mensagem.', en: 'Owner only: with the code, the @{c} bot answers with this training from the next message on.' },
  ensCodigo: { pt: 'Código do dono', en: 'Owner code' },
  ensAplBt: { pt: 'Aplicar agora', en: 'Apply now' },
  ensAplOk: { pt: 'Aplicado — a próxima mensagem já sai assim', en: 'Applied — the next message goes out like this' },
  ensAplErro: { pt: 'Código errado.', en: 'Wrong code.' },
  ensAplSem: { pt: 'O cofre ainda não tem o código configurado.', en: 'The vault has no code set yet.' },
  ensAplFalhou: { pt: 'Não consegui falar com o cofre. Tente de novo.', en: 'Could not reach the vault. Try again.' },
  ensTrazer: { pt: 'Trazer o treino que está no ar', en: 'Load the training that is live' },
  ensTrouxe: { pt: 'Treino do ar carregado aqui.', en: 'Live training loaded here.' },
  ensNadaNoAr: { pt: 'Ainda não há treino no ar: o robô usa o padrão.', en: 'No live training yet: the bot uses the default.' },
  ensTesteTit: { pt: 'Testar agora', en: 'Try it now' },
  ensTesteSub: { pt: 'Escreva como um cliente, em qualquer idioma.', en: 'Write like a client, in any language.' },
  ensTestePh: { pt: 'Mensagem do cliente…', en: 'Client message…' },
  ensLimpar: { pt: 'Recomeçar', en: 'Start over' },
  ensDemoAviso: { pt: 'Agente ao vivo indisponível agora: a resposta vem só das suas respostas prontas.', en: 'Live agent unavailable right now: replies come only from your ready answers.' },
  ensNaoSei: { pt: 'Boa pergunta! O guia confirma isso com você em seguida. 🙂', en: 'Good question! The guide will confirm this with you shortly. 🙂' },
  ibTodas: { pt: 'Todas', en: 'All' },
  ibEspera: { pt: 'esperando você', en: 'waiting for you' },
  ibFeitas: { pt: 'respondidas', en: 'answered' },
  ibLinguas: { pt: 'idiomas', en: 'languages' },
  modoAprovar: { pt: 'Eu aprovo cada resposta', en: 'I approve every reply' },
  modoAuto: { pt: 'Automático', en: 'Automatic' },
  aprovar: { pt: 'Aprovar e enviar', en: 'Approve and send' },
  descartar: { pt: 'Descartar', en: 'Discard' },
  rascunhoIA: { pt: 'Resposta escrita pelo agente', en: 'Reply written by the agent' },
  paraVoce: { pt: 'Para você entender', en: 'So you know what it says' },
  enviada: { pt: 'Enviada', en: 'Sent' },
  enviadaAuto: { pt: 'Respondida sozinha', en: 'Answered automatically' },
  aguardando: { pt: 'aguardando você', en: 'waiting for you' },
  simular: { pt: '+ Simular mensagem nova', en: '+ Simulate a new message' },
  voltar: { pt: '← Conversas', en: '← Chats' },
  escolha: { pt: 'Escolha uma conversa.', en: 'Pick a chat.' },
  falta: { pt: 'Falta um dado que só você tem', en: 'Missing something only you know' },
  descartada: { pt: 'Resposta descartada', en: 'Reply discarded' },
  /* modo demonstração: os pedidos prontos */
  dVagasPede: { pt: 'Quais saídas estão com mais vaga nas próximas semanas?', en: 'Which departures have the most empty seats in the coming weeks?' },
  dVagasResp: { pt: 'As mais vazias:\n{lista}\n\nQuer que eu monte um post ou um anúncio para elas?', en: 'The emptiest ones:\n{lista}\n\nShall I make a post or an ad for them?' },
  dVagasNada: { pt: 'Nas próximas semanas todas as saídas estão cheias ou quase. Boa notícia.', en: 'Every departure in the coming weeks is full or nearly full. Good news.' },
  dPrecoPede: { pt: 'Sobe o preço de "{tour}" para {preco} €', en: 'Raise the price of "{tour}" to €{preco}' },
  dPrecoResp: { pt: 'Pronto: "{tour}" agora custa {preco} €. Reservas que já existem não mudam de valor.', en: 'Done: "{tour}" now costs €{preco}. Existing bookings keep their price.' },
  dPlanoPede: { pt: 'Monta o plano de postagem das próximas duas semanas', en: 'Build the post plan for the next two weeks' },
  dPlanoResp: { pt: 'Salvei {n} posts no plano, puxando as saídas com mais vaga. Estão em Marketing → Plano de postagem, com a legenda pronta para copiar.', en: 'I saved {n} posts to the plan, pushing the departures with the most empty seats. They’re in Marketing → Post plan, captions ready to copy.' },
  dP1Tema: { pt: '{tour}: o que quase ninguém repara', en: '{tour}: what almost nobody notices' },
  dP1Leg: { pt: 'Todo mundo passa por aqui olhando para cima. A melhor parte está na altura dos olhos.\n\n{tour} · {data}, {hora}. Grupo pequeno, no seu ritmo.\n\nReserva pelo link da bio.', en: 'Everyone walks past here looking up. The best part is at eye level.\n\n{tour} · {data}, {hora}. Small group, at your pace.\n\nBook via the link in bio.' },
  dP1Rot: { pt: '0–3 s: close num detalhe da rua, sem música. Fala: "Todo mundo passa por aqui olhando para cima."\n3–12 s: câmera desce até o detalhe. Fala: "E perde isto."\n12–20 s: você explicando em uma frase.\n20–25 s: chamada: "{data}, {hora}. Link na bio."', en: '0–3 s: close-up on a street detail, no music. Line: "Everyone walks past here looking up."\n3–12 s: camera tilts down to the detail. Line: "And misses this."\n12–20 s: you explaining in one sentence.\n20–25 s: call to action: "{data}, {hora}. Link in bio."' },
  dP2Tema: { pt: 'Story: sobram {livres} lugares em {data}', en: 'Story: {livres} seats left on {data}' },
  dP2Leg: { pt: '{data}, {hora}: sobram {livres} lugares no "{tour}". Responde este story que eu te mando o link.', en: '{data}, {hora}: {livres} seats left on "{tour}". Reply to this story and I’ll send you the link.' },
  dP3Tema: { pt: 'Carrossel: 3 coisas para saber antes do "{tour}"', en: 'Carousel: 3 things to know before "{tour}"' },
  dP3Leg: { pt: '1. Dura {dur}. Sapato confortável ajuda.\n2. O encontro é em: {encontro}.\n3. Grupo pequeno: dá para perguntar tudo.\n\nPróxima data: {data}, {hora}.', en: '1. It lasts {dur}. Comfortable shoes help.\n2. We meet at: {encontro}.\n3. Small group: ask me anything.\n\nNext date: {data}, {hora}.' },
  dStoryPede: { pt: 'Faz um story para a saída com mais vaga', en: 'Make a story for the departure with the most empty seats' },
  dStoryTexto: { pt: '{data} · {hora}. Sobram {livres} lugares.', en: '{data} · {hora}. {livres} seats left.' },
  dStoryRod: { pt: '{preco} € · link na bio', en: '€{preco} · link in bio' },
  dStoryResp: { pt: 'Story pronto em Marketing → Criativos, para baixar em PNG. Quer outro título?', en: 'Story ready in Marketing → Creatives, to download as PNG. Want a different title?' },
  dTextoPede: { pt: 'Faz um post só de texto explicando por que fazer o passeio com guia local', en: 'Make a text-only post on why to tour with a local guide' },
  dTextoTit: { pt: 'Por que ir com guia local?', en: 'Why go with a local guide?' },
  dTextoTexto: { pt: 'O mapa mostra onde ir. O guia mostra por que aquilo importa — e o que está fechado, lotado ou mudou desde o último guia de viagem.', en: 'The map shows where to go. A guide shows why it matters — and what’s closed, packed or has changed since the last guidebook.' },
  dTextoResp: { pt: 'Post pronto em Marketing → Criativos, com fundo na cor da marca.', en: 'Post ready in Marketing → Creatives, on a brand-colour background.' },
  dAnuncioPede: { pt: 'Monta um anúncio para encher a saída de {data}', en: 'Build an ad to fill the {data} departure' },
  dAnObj: { pt: 'Mensagens no WhatsApp', en: 'WhatsApp messages' },
  dAnPub: { pt: 'Quem vai viajar para {cidade} nas próximas semanas, 25–60 anos, interesse em viagem, cultura e fotografia; português, inglês e espanhol', en: 'People travelling to {cidade} in the coming weeks, aged 25–60, interested in travel, culture and photography; Portuguese, English and Spanish' },
  dAnPorque: { pt: 'É a saída com mais lugar vazio e a data está perto: verba pequena, curta, direto para conversa.', en: 'It’s the departure with the most empty seats and it’s close: small, short budget, straight to a chat.' },
  dAnT1: { pt: 'Ainda dá tempo', en: 'There’s still time' },
  dAnX1: { pt: '{tour} · {data}, {hora}. Grupo pequeno, no seu ritmo. Sobram {livres} lugares.', en: '{tour} · {data}, {hora}. Small group, at your pace. {livres} seats left.' },
  dAnT2: { pt: 'A cidade que o guia de bolso não mostra', en: 'The city the pocket guide won’t show you' },
  dAnX2: { pt: 'Em {data} eu levo um grupo pequeno pelo "{tour}". Pergunte o que quiser pelo WhatsApp.', en: 'On {data} I’m taking a small group on "{tour}". Ask me anything on WhatsApp.' },
  dAnBot: { pt: 'Enviar mensagem', en: 'Send message' },
  dAnuncioResp: { pt: 'Plano salvo em Marketing → Anúncios: {verba} € por dia durante 7 dias. Você monta no Gerenciador de Anúncios da Meta — eu não ligo nem pago nada.', en: 'Plan saved in Marketing → Ads: €{verba} a day for 7 days. You set it up in Meta Ads Manager — I never switch on or pay for anything.' },
  dBloqPede: { pt: 'Bloqueia o dia 25 de dezembro', en: 'Block 25 December' },
  dBloqResp: { pt: 'Bloqueado: nenhum passeio sai em 25/12. Se alguém já tinha reserva nesse dia, eu aviso aqui antes — o bloqueio não cancela ninguém.', en: 'Blocked: no tours on 25/12. If someone had already booked that day I’d flag it first — blocking never cancels anyone.' },
  dMemPede: { pt: 'Lembra: criança até 6 anos não paga', en: 'Remember: children under 6 go free' },
  dMemResp: { pt: 'Guardado na memória. Vou considerar isso em respostas e anúncios.', en: 'Saved to memory. I’ll take it into account in replies and ads.' },
  /* atendimento: respostas no idioma do cliente */
  aDisp: { pt: 'Oi, {nome}! Tem sim: {data}, às {hora}, sobram {livres} lugares no "{tour}". Custa {preco} € por pessoa. Te mando o link para reservar?', en: 'Hi {nome}! Yes: on {data} at {hora} there are {livres} seats left on "{tour}". It’s €{preco} per person. Shall I send you the booking link?' },
  aDispNao: { pt: 'Oi, {nome}! Essa data já está cheia. A próxima com lugar é {data}, às {hora} ({livres} lugares). Serve?', en: 'Hi {nome}! That date is full. The next one with space is {data} at {hora} ({livres} seats). Would that work?' },
  aPreco: { pt: 'Oi, {nome}! "{tour}" custa {preco} € {modo}. Próximas datas com lugar: {datas}. Quer que eu segure uma?', en: 'Hi {nome}! "{tour}" costs €{preco} {modo}. Next dates with space: {datas}. Shall I hold one for you?' },
  porPessoa: { pt: 'por pessoa', en: 'per person' },
  porSessao: { pt: 'pela sessão', en: 'per session' },
  aSemana: { pt: 'Oi, {nome}! Para {n} pessoas, estas datas têm lugar: {datas}. Qual prefere?', en: 'Hi {nome}! For {n} people, these dates have space: {datas}. Which do you prefer?' },
  aCrianca: { pt: 'Oi, {nome}! Criança é bem-vinda no "{tour}". [idade mínima e preço de criança] Próximas datas: {datas}.', en: 'Hi {nome}! Children are welcome on "{tour}". [minimum age and child price] Next dates: {datas}.' },
  aCriancaFalta: { pt: 'idade mínima e preço de criança', en: 'minimum age and child price' },
  aPagar: { pt: 'Oi, {nome}! Pode pagar com cartão pelo link da reserva. {politica} Te mando o link?', en: 'Hi {nome}! You can pay by card through the booking link. {politica} Shall I send it?' },
  polMetade: { pt: 'Paga metade para garantir a vaga e o resto até 30 dias antes.', en: 'You pay half to secure the seat and the rest up to 30 days before.' },
  polTudo: { pt: 'O valor é pago na reserva.', en: 'The full amount is paid when booking.' },
};

/* texto do assistente no idioma da tela: o escolhido, senão inglês, senão português */
function ia(k, vars) {
  const e = IA_TXT[k];
  let s = e ? (e[LANG] || (LANG !== 'pt' && e.en) || e.pt) : k;
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]);
  return s;
}
/* o mesmo texto num idioma escolhido (resposta ao cliente na língua dele) */
function iaEm(lang, k, vars) {
  const antes = LANG; LANG = lang;
  try { return ia(k, vars); } finally { LANG = antes; }
}
const naLingua = (lang, fn) => { const a = LANG; LANG = lang; try { return fn(); } finally { LANG = a; } };

/* ---------- dados do marketing e do atendimento ----------
   Protótipo: guardados neste navegador. No app de um cliente viram linhas
   no Supabase dele, para celular e laptop verem o mesmo. */
const MKT_KEY = IA_NS + 'mkt';
const KIT_PADRAO = { cores: { principal: '#E8A33D', destaque: '#C4553B', escura: '#1E3A4C', neutra: '#6B6B73' },
  voz: '', frases: '', proibidas: 'imperdível, incrível, experiência única, o melhor', hashtags: '' };
const Mkt = {
  d: null,
  get() {
    if (!this.d) {
      this.d = Object.assign({ posts: [], anuncios: [], criativos: [], memoria: [], fotos: [], conversas: null, modoAuto: false }, iaLe(MKT_KEY, {}));
      this.d.kit = Object.assign({}, KIT_PADRAO, this.d.kit || {});
      this.d.kit.cores = Object.assign({}, KIT_PADRAO.cores, (this.d.kit && this.d.kit.cores) || {});
    }
    return this.d;
  },
  salva() {
    if (iaGrava(MKT_KEY, this.get())) return true;
    toast(ia('semEspaco')); return false;
  },
};

/* ---------- ajudantes ---------- */
const nomeTour = (x) => x ? tl(x.name) : '?';
/* v-data: a data LOCAL do aparelho (isoToday() usa UTC: em Roma e Copenhague, de
   0h às 2h, o app achava que ainda era ontem). E a linha que o assistente lê:
   no TOPO das instruções, com dia da semana, calculada a cada resposta. Turno
   de outro dia vai carimbado, senão o histórico de ontem diz "hoje é 28". */
const hojeLocalIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function linhaHoje() { const d = new Date(); const DS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const iso = hojeLocalIso(); return `HOJE É ${DS[d.getDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} (${iso}). Use esta data para "hoje", "amanhã", "sexta que vem" e prazos. Mensagens marcadas com [dito em DD/MM] são de OUTRO dia: o "hoje" delas não vale mais.`; }
const diaSemanaEn = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
/* o que vai pra API: sem o campo `dia` (a API não aceita) e com o carimbo no que é de outro dia */
function mensagensParaEnvio(ms) { const hoje = hojeLocalIso();
  return ms.map(m => { const { dia, ...r } = m; if (m.role !== 'user' || !dia || dia === hoje) return r;
    const c = '[dito em ' + dia.slice(8, 10) + '/' + dia.slice(5, 7) + '] ';
    r.content = typeof m.content === 'string' ? c + m.content : m.content.map(b => b.type === 'text' ? { ...b, text: c + b.text } : b); return r; }); }
const hojeIso = () => isoToday();
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const nomeDia = (d) => new Date(2026, 0, 4 + d).toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '');
const dataCurta = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }) : '';
const dataLonga = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const FORMATOS_POST = ['post', 'carrossel', 'reel', 'story'];
const CORES_NOMES = ['principal', 'destaque', 'escura', 'neutra'];
const corDe = (n) => Mkt.get().kit.cores[n] || Mkt.get().kit.cores.principal;
const FORMATOS_CRIATIVO = { story: [1080, 1920], post: [1080, 1080], flyer: [1080, 1350] };
/* texto escuro sobre cor clara, branco sobre cor escura */
function tintaSobre(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1b1b' : '#ffffff';
}

/* fotos que existem no app: capa e paradas de cada passeio + as enviadas */
function iaFotos() {
  const out = [];
  for (const x of Tours.all()) {
    if (x.photo) out.push({ ref: x.id + '-capa', src: x.photo, passeio: nomeTour(x), onde: 'capa' });
    (x.stops || []).forEach((s, i) => {
      if (s && s.ph) out.push({ ref: `${x.id}-parada-${i + 1}`, src: s.ph, passeio: nomeTour(x), onde: 'parada ' + (i + 1) + (s.n ? ': ' + tl(s.n) : '') });
    });
  }
  for (const f of Mkt.get().fotos) out.push({ ref: f.id, src: f.src, passeio: null, onde: (f.ia ? 'imagem gerada por IA: ' : '') + (f.nome || 'foto enviada'), ia: !!f.ia });
  return out;
}
const fotoSrc = (ref) => (iaFotos().find(f => f.ref === ref) || {}).src;
function guardaFoto(src, nome) {
  const f = { id: 'foto-' + uid(), src, nome: nome || 'foto enviada', criado: hojeIso() };
  Mkt.get().fotos.unshift(f);
  if (!Mkt.salva()) { Mkt.get().fotos.shift(); return null; }
  return f;
}

/* ---------- imagem por IA: Gemini, com a chave do guia (fica só no aparelho) ---------- */
const IMG_CHAVE = IA_NS + 'gemini_chave';
const IMG_MODELOS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];
const PROPORCAO = { story: '9:16', post: '1:1', flyer: '4:5' };
const imgChave = () => { try { return (localStorage.getItem(IMG_CHAVE) || '').trim(); } catch (e) { return ''; } };
const imgPeloCofre = () => !imgChave() && cofreEstado.imagem && !cofreEsgotado('imagem');
const imgDisponivel = () => !!imgChave() || imgPeloCofre();
async function geraImagemIA(descricao, formato, chave) {
  chave = chave || imgChave();
  if (!chave && imgPeloCofre()) {
    let r;
    try { r = await fetch(COFRE + '/api/imagem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descricao, formato }) }); }
    catch (e) { throw new Error(ia('eRede')); }
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.imagem) return j.imagem;
    if (r.status === 429 && j && j.error && j.error.type === 'limite') { marcaEsgotado('imagem'); throw new Error(ia('imgLimite')); }
    if (r.status === 429) throw new Error(ia('imgCota'));
    throw new Error(ia('imgRecusou'));
  }
  if (!chave) throw new Error(ia('imgSemChave'));
  let ultimo = '';
  for (const modelo of IMG_MODELOS) {
    for (const comProporcao of [true, false]) {
      const corpo = { contents: [{ parts: [{ text: descricao + '. No text, no letters, no logos, no watermark.' }] }],
        generationConfig: { responseModalities: ['IMAGE'], ...(comProporcao ? { imageConfig: { aspectRatio: PROPORCAO[formato] || '1:1' } } : {}) } };
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo) });
      } catch (e) { throw new Error(ia('eRede')); }
      const j = await r.json().catch(() => null);
      if (r.ok) {
        const parte = ((j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).find(p => p.inlineData || p.inline_data);
        const d = parte && (parte.inlineData || parte.inline_data);
        if (d && d.data) return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
        throw new Error(ia('imgRecusou'));
      }
      const msg = (j && j.error && j.error.message) || '';
      if (/API key|API_KEY/i.test(msg) || r.status === 401 || r.status === 403) throw new Error(ia('imgChaveRuim'));
      if (r.status === 429) throw new Error(ia('imgCota'));
      if (r.status === 400 && comProporcao) { ultimo = msg; continue; }   /* modelo sem proporção: tenta sem */
      ultimo = `Gemini ${r.status}. ${msg}`; break;                       /* 404 = modelo não existe: o próximo */
    }
  }
  throw new Error(ultimo || ia('imgRecusou'));
}
/* reduz para JPEG — PNG de 1–2 MB enche o aparelho em poucas imagens */
function reduzImagem(src, lado) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, (lado || 1600) / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.86)); };
    img.onerror = () => falha(new Error(ia('eFoto'))); img.src = src;
  });
}
async function geraEGuarda(descricao, formato) {
  const bruta = await geraImagemIA(descricao, formato);
  const f = guardaFoto(await reduzImagem(bruta, 1600), 'IA: ' + descricao.slice(0, 60));
  if (!f) throw new Error(ia('semEspaco'));
  f.ia = true; Mkt.salva();
  return f;
}

/* saídas das próximas semanas, das mais vazias para as mais cheias */
function saidasVazias(dias) {
  const de = addDays(hojeIso(), 1), ate = addDays(de, dias || 30), out = [];
  for (const x of Tours.live()) for (const d of Cal.departures(x.id, de, ate)) {
    const livres = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
    if (livres > 0) out.push({ x, ...d, livres });
  }
  return out.sort((a, b) => (b.livres / b.capacity) - (a.livres / a.capacity) || a.date.localeCompare(b.date));
}

/* ---------- ferramentas ---------- */
const obj = (props, req) => ({ type: 'object', properties: props || {}, ...(req ? { required: req } : {}) });
const S_ = (d) => ({ type: 'string', ...(d ? { description: d } : {}) });
const N_ = (d) => ({ type: 'number', ...(d ? { description: d } : {}) });

const IA_FERRAMENTAS = [
  { name: 'ver_passeios', description: 'Passeios: id, preço, criança, grupo, publicado ou rascunho, encontro, duração e horários fixos (com id).', input_schema: obj() },
  { name: 'ver_agenda', description: 'Saídas de um período com vagas: capacidade, pagas, livres. Datas AAAA-MM-DD. Sem datas = próximos 30 dias.', input_schema: obj({ de: S_(), ate: S_(), passeio_id: S_() }) },
  { name: 'ver_reservas', description: 'Reservas por data do passeio: cliente, idioma, passeio, data, hora, pessoas, situação, total e pago.', input_schema: obj({ de: S_(), ate: S_() }) },
  { name: 'ver_cupons', description: 'Cupons existentes.', input_schema: obj() },
  { name: 'ver_bloqueios', description: 'Períodos bloqueados na agenda.', input_schema: obj() },
  { name: 'ver_fotos', description: 'Fotos disponíveis para criativos, com a ref de cada uma.', input_schema: obj() },
  { name: 'ver_marketing', description: 'Plano de postagem (mês AAAA-MM opcional), anúncios e criativos salvos.', input_schema: obj({ mes: S_() }) },
  { name: 'criar_passeio', description: 'Cria passeio novo como RASCUNHO.', input_schema: obj({ nome: S_(), descricao: S_(), preco: N_(), por: { type: 'string', enum: ['pessoa', 'sessao'] }, min: { type: 'integer' }, max: { type: 'integer' }, duracao: S_(), ponto_encontro: S_(), foto: { type: 'string', description: 'ref da foto de capa (das fotos enviadas no chat ou de ver_fotos)' } }, ['nome', 'preco']) },
  { name: 'alterar_passeio', description: 'Altera nome, descrição, encontro, duração, grupo ou publicação de um passeio.', input_schema: obj({ passeio_id: S_(), nome: S_(), descricao: S_(), ponto_encontro: S_(), duracao: S_(), min: { type: 'integer' }, max: { type: 'integer' }, publicado: { type: 'boolean' } }, ['passeio_id']) },
  { name: 'mudar_preco', description: 'Muda o preço (adulto e/ou criança) de um passeio.', input_schema: obj({ passeio_id: S_(), preco: N_(), preco_crianca: N_() }, ['passeio_id']) },
  { name: 'adicionar_horario', description: 'Adiciona horário fixo: dias da semana, hora, vagas, período.', input_schema: obj({ passeio_id: S_(), dias: { type: 'array', items: { type: 'string', enum: DIAS } }, hora: S_('HH:MM'), vagas: { type: 'integer' }, de: S_(), ate: S_() }, ['passeio_id', 'dias', 'hora']) },
  { name: 'remover_horario', description: 'Remove um horário fixo (id de ver_passeios).', input_schema: obj({ horario_id: S_() }, ['horario_id']) },
  { name: 'bloquear_datas', description: 'Bloqueia um período: nenhum passeio sai. Não cancela reservas.', input_schema: obj({ de: S_(), ate: S_(), motivo: S_() }, ['de']) },
  { name: 'liberar_datas', description: 'Remove um bloqueio (id de ver_bloqueios).', input_schema: obj({ bloqueio_id: S_() }, ['bloqueio_id']) },
  { name: 'criar_cupom', description: 'Cria cupom de desconto em %.', input_schema: obj({ codigo: S_(), desconto: N_(), validade: S_(), uma_vez_por_pessoa: { type: 'boolean' } }, ['codigo', 'desconto']) },
  { name: 'apagar_cupom', description: 'Apaga um cupom.', input_schema: obj({ codigo: S_() }, ['codigo']) },
  { name: 'salvar_posts', description: 'Salva itens no plano de postagem, com legenda pronta (e roteiro se for reel).', input_schema: obj({ itens: { type: 'array', items: obj({ data: S_(), formato: { type: 'string', enum: FORMATOS_POST }, tema: S_(), passeio_id: S_(), legenda: S_(), roteiro: S_() }, ['data', 'formato', 'tema']) } }, ['itens']) },
  { name: 'mudar_post', description: 'Muda um item do plano.', input_schema: obj({ post_id: S_(), data: S_(), formato: { type: 'string', enum: FORMATOS_POST }, tema: S_(), legenda: S_(), roteiro: S_(), situacao: { type: 'string', enum: ['ideia', 'pronto', 'postado'] } }, ['post_id']) },
  { name: 'apagar_post', description: 'Apaga um item do plano.', input_schema: obj({ post_id: S_() }, ['post_id']) },
  { name: 'salvar_anuncio', description: 'Salva um plano de anúncio (Meta) para o guia montar.', input_schema: obj({ titulo: S_(), objetivo: S_(), publico: S_(), verba_dia: N_(), duracao_dias: { type: 'integer' }, datas_alvo: S_(), passeio_id: S_(), textos: { type: 'array', items: obj({ titulo: S_(), texto: S_(), chamada: S_() }) }, foto: S_(), porque: S_() }, ['titulo', 'objetivo', 'publico', 'verba_dia', 'textos']) },
  { name: 'apagar_anuncio', description: 'Apaga um plano de anúncio.', input_schema: obj({ anuncio_id: S_() }, ['anuncio_id']) },
  { name: 'criar_criativo', description: 'Criativo no molde da marca (nunca imagem de IA): story 1080×1920, post 1080×1080, flyer 1080×1350. foto = ref de ver_fotos, ou "nenhuma" para fundo na cor da marca com texto.', input_schema: obj({ formato: { type: 'string', enum: Object.keys(FORMATOS_CRIATIVO) }, foto: S_(), titulo: S_(), texto: S_(), rodape: S_(), cor: { type: 'string', enum: CORES_NOMES } }, ['formato', 'foto', 'titulo']) },
  { name: 'mudar_criativo', description: 'Muda um criativo salvo.', input_schema: obj({ criativo_id: S_(), formato: { type: 'string', enum: Object.keys(FORMATOS_CRIATIVO) }, foto: S_(), titulo: S_(), texto: S_(), rodape: S_(), cor: { type: 'string', enum: CORES_NOMES } }, ['criativo_id']) },
  { name: 'apagar_criativo', description: 'Apaga um criativo.', input_schema: obj({ criativo_id: S_() }, ['criativo_id']) },
  { name: 'gerar_imagem', description: 'Gera uma imagem por IA (Gemini) para fundo, ilustração, conceito ou textura — nunca para fingir foto de um lugar real, do passeio ou de pessoas. Descreva em inglês, sem texto na imagem. Fica em Suas fotos com o selo IA; a ref volta no resultado para usar em criar_criativo.',
    input_schema: obj({ descricao: S_('em inglês'), formato: { type: 'string', enum: Object.keys(FORMATOS_CRIATIVO) } }, ['descricao']) },
  { name: 'ver_clientes', description: 'Clientes que já reservaram: nome, contato, idioma, quantas reservas, total gasto e a última data.', input_schema: obj() },
  { name: 'ver_relatorio', description: 'Números do período (AAAA-MM-DD): recebido, saídas, pessoas, a receber, e por passeio as visitas, reservas, conversão e receita.', input_schema: obj({ de: S_(), ate: S_() }) },
  { name: 'ver_ajustes', description: 'Perfil do guia: nome, negócio, cidade, bio, texto da home, WhatsApp e Instagram.', input_schema: obj() },
  { name: 'ver_ensino', description: 'Como o agente de atendimento está treinado: tom, respostas prontas, limites.', input_schema: obj() },
  { name: 'criar_reserva', description: 'Cria uma reserva fechada fora do app (WhatsApp, Instagram, na rua). Só o que o guia informou; nunca invente valor recebido.',
    input_schema: obj({ passeio_id: S_(), data: S_('AAAA-MM-DD'), hora: S_('HH:MM'), nome: S_(), pessoas: { type: 'integer' }, whats: S_(), email: S_(),
      total: N_('total combinado; sem isto usa a tabela do passeio'), recebido: N_('quanto já entrou'), metodo: { type: 'string', enum: ['pix', 'card', 'cash', 'transfer'] } }, ['passeio_id', 'data', 'nome', 'pessoas']) },
  { name: 'alterar_reserva', description: 'Muda data, hora, pessoas ou contato de uma reserva (código de ver_reservas).', input_schema: obj({ codigo: S_(), data: S_(), hora: S_(), pessoas: { type: 'integer' }, nome: S_(), whats: S_(), email: S_() }, ['codigo']) },
  { name: 'cancelar_reserva', description: 'Cancela uma reserva (a vaga volta para a agenda).', input_schema: obj({ codigo: S_(), motivo: S_() }, ['codigo']) },
  { name: 'registrar_pagamento', description: 'Registra dinheiro que entrou numa reserva. Sem valor, registra o que falta.', input_schema: obj({ codigo: S_(), valor: N_(), metodo: { type: 'string', enum: ['pix', 'card', 'cash', 'transfer'] } }, ['codigo']) },
  { name: 'alterar_ajustes', description: 'Muda o perfil do guia: nome, negócio, cidade, bio, texto da home, WhatsApp, Instagram.', input_schema: obj({ nome: S_(), negocio: S_(), cidade: S_(), bio: S_(), texto_home: S_(), whats: S_(), insta: S_() }) },
  { name: 'ensinar_agente', description: 'Treina o agente do WhatsApp/Instagram: tom, respostas prontas (pergunta e resposta), o que nunca dizer, quando passar a conversa para o guia.',
    input_schema: obj({ tom: { type: 'string', enum: ['simp', 'formal', 'leve', 'direto'] }, detalhe: S_(), respostas: { type: 'array', items: obj({ pergunta: S_(), resposta: S_() }, ['pergunta', 'resposta']) },
      nunca: S_(), passar: { type: 'array', items: { type: 'string', enum: ['hReclama', 'hDesconto', 'hGrupo', 'hEspecial'] } } }) },
  { name: 'guardar_memoria', description: 'Guarda uma regra ou preferência que vale para sempre.', input_schema: obj({ texto: S_() }, ['texto']) },
  { name: 'apagar_memoria', description: 'Apaga um item da memória.', input_schema: obj({ memoria_id: S_() }, ['memoria_id']) },
];
const IA_LEITURA = new Set(['ver_passeios', 'ver_agenda', 'ver_reservas', 'ver_cupons', 'ver_bloqueios', 'ver_fotos', 'ver_marketing',
  'ver_clientes', 'ver_relatorio', 'ver_ajustes', 'ver_ensino']);

function iaLeitura(nome, i) {
  if (nome === 'ver_passeios') return Tours.all().map(x => ({
    id: x.id, nome: nomeTour(x), publicado: x.status !== 'draft', preco: +x.price || 0,
    por: x.priceMode === 'session' ? 'sessão' : 'pessoa', preco_crianca: +x.priceChild || 0,
    grupo: { min: +x.min || 0, max: +x.max || 0 }, duracao: x.duration || null, ponto_encontro: tl(x.meeting),
    horarios: Cal.rulesFor(x.id).map(r => ({ id: r.id, dias: r.weekdays.map(nomeDia).join(', '), hora: r.time, vagas: r.capacity, de: r.from, ate: r.until })) }));
  if (nome === 'ver_agenda') {
    const de = i.de || hojeIso(), ate = i.ate || addDays(de, 30), out = [];
    for (const x of (i.passeio_id ? [Tours.get(i.passeio_id)].filter(Boolean) : Tours.all()))
      for (const d of Cal.departures(x.id, de, ate)) {
        const livres = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
        out.push({ passeio: nomeTour(x), passeio_id: x.id, data: d.date, hora: d.time, capacidade: d.capacity, pagas: d.capacity - livres, livres });
      }
    return out.length ? out.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)) : 'nenhuma saída neste período';
  }
  if (nome === 'ver_reservas') {
    const de = i.de || hojeIso(), ate = i.ate || '9999-12-31';
    const l = DB.bookings.filter(b => b.date >= de && b.date <= ate).slice(0, 60).map(b => ({
      codigo: b.code, cliente: b.name, idioma: b.lang || null, passeio: nomeTour(Tours.get(b.tourId)), data: b.date, hora: b.time,
      pessoas: b.pax, situacao: b.status, total: b.total, pago: Bookings.paid(b) }));
    return l.length ? l : 'nenhuma reserva neste período';
  }
  if (nome === 'ver_clientes') {
    const m = {};
    for (const b of DB.bookings) {
      if (b.status === 'cancelled') continue;
      const k = (b.email || b.whats || b.name || '?').toLowerCase();
      const c = m[k] = m[k] || { nome: b.name, contato: b.email || b.whats || '', idioma: b.lang || null, reservas: 0, pessoas: 0, gasto: 0, ultima: '' };
      c.reservas++; c.pessoas += b.pax; c.gasto += Bookings.paid(b);
      if (b.date > c.ultima) c.ultima = b.date;
    }
    const l = Object.values(m).sort((a, b) => b.gasto - a.gasto).slice(0, 60);
    return l.length ? l : 'nenhum cliente ainda';
  }
  if (nome === 'ver_relatorio') {
    const de = isoOk(i.de) ? i.de : hojeIso().slice(0, 8) + '01', ate = isoOk(i.ate) ? i.ate : hojeIso();
    const T = Reports.totals(de, ate);
    return { periodo: { de, ate }, recebido: T.revenue, saidas: T.deps, pessoas: T.pax, a_receber: T.due, media_por_pessoa: T.ticket,
      por_passeio: Reports.interesse(de, ate).map(r => ({ passeio: nomeTour(r.tour), visitas: r.visitas, quase_reservaram: r.quase,
        reservas: r.reservas, conversao_pct: r.conv, receita: r.receita })),
      de_onde_vieram: Reports.byOrigin(de, ate) };
  }
  if (nome === 'ver_ajustes') {
    const st = DB.settings || {};
    return { nome: st.admName || '', negocio: st.negocio || '', cidade: st.base || '', bio: st.bio || '', texto_home: st.homeText || '',
      whats: st.whats || '', insta: st.insta || '', moeda: 'euro' };
  }
  if (nome === 'ver_ensino') {
    const e = typeof ensino === 'function' ? ensino() : null;
    if (!e) return 'o agente ainda usa o treino padrão';
    return { tom: e.tom, detalhe: e.tomExtra || '', respostas: e.faq.filter(f => f.p && f.r).map(f => ({ pergunta: f.p, resposta: f.r })),
      nunca: e.nunca || '', passa_para_o_guia: (e.passa || []).map(k => ia(k)) };
  }
  if (nome === 'ver_cupons') return DB.coupons.length ? DB.coupons.map(c => ({ codigo: c.code, desconto: c.pct + '%', validade: c.until })) : 'nenhum cupom';
  if (nome === 'ver_bloqueios') return DB.blocks.length ? DB.blocks.map(b => ({ id: b.id, de: b.from, ate: b.until, motivo: b.note || '' })) : 'nenhum bloqueio';
  if (nome === 'ver_fotos') return iaFotos().map(({ ref, passeio, onde, ia: gerada }) => ({ ref, passeio, onde, gerada_por_ia: !!gerada }));
  if (nome === 'ver_marketing') {
    const m = Mkt.get();
    return { posts: m.posts.filter(p => i.mes ? p.data.startsWith(i.mes) : p.data >= hojeIso()), anuncios: m.anuncios,
      criativos: m.criativos.map(c => ({ id: c.id, formato: c.formato, titulo: c.titulo, foto: c.fotoRef })) };
  }
}

/* ---------- gravação: primeiro o plano (o cartão), depois a ação ---------- */
const E_ = (erro) => ({ erro });
function iaPlano(nome, i) {
  const m = Mkt.get();
  if (nome === 'criar_passeio') {
    const preco = +i.preco; if (!i.nome || !(preco > 0)) return E_('faltou nome ou preço');
    const porSessao = i.por === 'sessao';
    const min = Math.max(1, +i.min || (porSessao ? 1 : 2)), max = Math.max(min, +i.max || (porSessao ? 4 : 12));
    return { titulo: ia('cCriarPasseio'), assumiu: (!i.min || !i.max) ? [`${ia('cGrupo')} ${min}–${max}`] : [],
      linhas: [[ia('cNome'), i.nome], [ia('cPreco'), `${eur(preco)} ${ia(porSessao ? 'cPorSessao' : 'cPorPessoa')}`], [ia('cGrupo'), `${min}–${max}`], ...(i.duracao ? [[ia('cDuracao'), i.duracao]] : []), ...(i.foto && fotoSrc(i.foto) ? [[ia('fotoRot'), '📷']] : [])],
      fazer: () => { const nt = Tours.create({ type: 'walk', region: (regioes()[0] || ['cidade'])[0], name: { pt: i.nome, en: i.nome },
        desc: { pt: i.descricao || '', en: '' }, meeting: i.ponto_encontro || '', duration: i.duracao || '', photo: (i.foto && fotoSrc(i.foto)) || 'capa.jpg',
        price: preco, priceMode: porSessao ? 'session' : 'pp', min, max, payPolicy: 'split', status: 'draft' }); return { ok: true, passeio_id: nt.id }; } };
  }
  if (nome === 'alterar_passeio') {
    const x = Tours.get(i.passeio_id); if (!x) return E_('passeio não encontrado');
    const muda = {}, linhas = [[ia('xPasseio'), nomeTour(x)]];
    if (i.nome) { muda.name = { ...x.name, pt: i.nome }; linhas.push([ia('cNome'), i.nome]); }
    if (i.descricao) { muda.desc = { ...(x.desc || {}), pt: i.descricao }; linhas.push([ia('cDescricao'), i.descricao]); }
    if (i.ponto_encontro) { muda.meeting = typeof x.meeting === 'object' && x.meeting ? { ...x.meeting, pt: i.ponto_encontro } : i.ponto_encontro; linhas.push([ia('cEncontro'), i.ponto_encontro]); }
    if (i.duracao) { muda.duration = i.duracao; linhas.push([ia('cDuracao'), i.duracao]); }
    if (i.min || i.max) { muda.min = +i.min || +x.min; muda.max = +i.max || +x.max; if (muda.max < muda.min) return E_('máximo menor que mínimo'); linhas.push([ia('cGrupo'), `${muda.min}–${muda.max}`]); }
    if (typeof i.publicado === 'boolean') { muda.status = i.publicado ? 'live' : 'draft'; linhas.push([ia('cSite'), i.publicado ? '✓' : '—']); }
    if (linhas.length === 1) return E_('nada muda');
    return { titulo: ia('cAlterarPasseio'), linhas, assumiu: [], fazer: () => { Tours.update(x.id, muda); return { ok: true }; } };
  }
  if (nome === 'mudar_preco') {
    const x = Tours.get(i.passeio_id); if (!x) return E_('passeio não encontrado');
    const muda = {}, linhas = [[ia('xPasseio'), nomeTour(x)]];
    for (const [k, rot, v] of [['price', ia('cPreco'), i.preco], ['priceChild', ia('cCrianca'), i.preco_crianca]]) {
      if (v === undefined || v === null || v === '' || !(+v >= 0) || +v === (+x[k] || 0)) continue;
      muda[k] = +v; linhas.push([rot, `${eur(+x[k] || 0)} → ${eur(+v)}`]);
    }
    if (!Object.keys(muda).length) return E_('nada muda');
    if (muda.price === 0) return E_('preço zero não é permitido');
    return { titulo: ia('cMudarPreco'), linhas, assumiu: [], fazer: () => { Tours.update(x.id, muda); return { ok: true, mudou: muda }; } };
  }
  if (nome === 'adicionar_horario') {
    const x = Tours.get(i.passeio_id); if (!x) return E_('passeio não encontrado');
    const dias = [...new Set((i.dias || []).map(d => DIAS.indexOf(d)).filter(d => d >= 0))].sort();
    if (!dias.length) return E_('faltaram os dias'); if (!/^\d{1,2}:\d{2}$/.test(i.hora || '')) return E_('hora HH:MM');
    const hora = i.hora.padStart(5, '0'), de = isoOk(i.de) ? i.de : hojeIso(), ate = isoOk(i.ate) ? i.ate : addDays(de, 180), vagas = +i.vagas || +x.max || 12;
    return { titulo: ia('cAddHorario'), assumiu: [], linhas: [[ia('xPasseio'), nomeTour(x)], [ia('cDias'), dias.map(nomeDia).join(', ')], [ia('cHora'), hora], [ia('cVagas'), String(vagas)], [ia('cPeriodo'), `${dataCurta(de)} – ${dataCurta(ate)}`]],
      fazer: () => { const r = Cal.addRule({ tourId: x.id, weekdays: dias, time: hora, capacity: vagas, from: de, until: ate }); return { ok: true, horario_id: r.id }; } };
  }
  if (nome === 'remover_horario') {
    const r = DB.rules.find(r => r.id === i.horario_id); if (!r) return E_('horário não encontrado');
    return { titulo: ia('cRemHorario'), assumiu: [], linhas: [[ia('xPasseio'), nomeTour(Tours.get(r.tourId))], [ia('cHorario'), `${r.weekdays.map(nomeDia).join(', ')} · ${r.time}`]],
      fazer: () => { Cal.removeRule(r.id); return { ok: true }; } };
  }
  if (nome === 'bloquear_datas') {
    if (!isoOk(i.de)) return E_('data AAAA-MM-DD'); const ate = isoOk(i.ate) ? i.ate : i.de;
    const afetadas = DB.bookings.filter(b => b.date >= i.de && b.date <= ate && b.status !== 'cancelled').length;
    const linhas = [[ia('cPeriodo'), i.de === ate ? dataLonga(i.de) : `${dataCurta(i.de)} – ${dataCurta(ate)}`]];
    if (i.motivo) linhas.push([ia('cMotivo'), i.motivo]);
    if (afetadas) linhas.push(['⚠', ia('cReservasValem', { n: afetadas })]);
    return { titulo: ia('cBloquear'), linhas, assumiu: [], fazer: () => { const b = Cal.addBlock({ from: i.de, until: ate, note: i.motivo || '' }); return { ok: true, bloqueio_id: b.id }; } };
  }
  if (nome === 'liberar_datas') {
    const b = DB.blocks.find(b => b.id === i.bloqueio_id); if (!b) return E_('bloqueio não encontrado');
    return { titulo: ia('cLiberar'), assumiu: [], linhas: [[ia('cPeriodo'), `${dataCurta(b.from)} – ${dataCurta(b.until)}`]], fazer: () => { Cal.removeBlock(b.id); return { ok: true }; } };
  }
  /* ---- reservas: o guia fecha por fora e o assistente registra ---- */
  if (nome === 'criar_reserva') {
    const x = Tours.get(i.passeio_id); if (!x) return E_('passeio não encontrado — use ver_passeios');
    if (!isoOk(i.data)) return E_('data em AAAA-MM-DD');
    const pax = Math.max(1, +i.pessoas || 1);
    const hora = /^\d{2}:\d{2}$/.test(i.hora || '') ? i.hora : (Cal.rulesFor(x.id)[0] || {}).time;
    if (!hora) return E_('falta a hora (o passeio não tem horário fixo)');
    const livres = Cal.seatsLeft(x.id, i.data, hora, (Cal.rulesFor(x.id).find(r => r.time === hora) || {}).capacity || x.max);
    if (livres < pax) return E_(`só há ${livres} lugar(es) em ${dataCurta(i.data)} ${hora}`);
    const total = +i.total > 0 ? +i.total : Bookings.precoDe(x, x.id, i.data, hora, pax).total;
    const recebido = Math.max(0, +i.recebido || 0);
    const assumiu = [];
    if (!i.hora) assumiu.push(`${ia('cHora')} ${hora}`);
    if (!(+i.total > 0)) assumiu.push(`${ia('cPreco')} ${eur(total)}`);
    return { titulo: ia('cCriarReserva'), assumiu,
      linhas: [[ia('cCliente'), i.nome], [ia('xPasseio'), nomeTour(x)], [ia('cQuando'), `${dataCurta(i.data)} ${hora}`],
        [ia('cPessoas'), String(pax)], [ia('cTotal'), eur(total)], ...(recebido ? [[ia('cRecebido'), eur(recebido)]] : [])],
      fazer: () => { const b = Bookings.criarManual({ tourId: x.id, date: i.data, time: hora, name: i.nome, whats: i.whats || '', email: i.email || '',
        pax, total, recebido, metodo: i.metodo || 'pix' }); return { ok: true, codigo: b.code }; } };
  }
  /* reserva que JÁ EXISTE sobe como atualização (PATCH, igual Bookings.payBalance/cancel).
     O POST de reserva nova levava 409, o cloud.js trata 409 como sucesso e a mudança ou o
     pagamento nunca chegava na nuvem — sumia no próximo cloudPull. Vale para registrar_pagamento. */
  if (nome === 'alterar_reserva') {
    const b = Bookings.byCode(String(i.codigo || '').toUpperCase()); if (!b) return E_('reserva não encontrada — use ver_reservas');
    const x = Tours.get(b.tourId), muda = {}, linhas = [[ia('cCliente'), b.name], [ia('cCodigo'), b.code]];
    if (isoOk(i.data) && i.data !== b.date) { muda.date = i.data; linhas.push([ia('cQuando'), `${dataCurta(b.date)} → ${dataCurta(i.data)}`]); }
    if (/^\d{2}:\d{2}$/.test(i.hora || '') && i.hora !== b.time) { muda.time = i.hora; linhas.push([ia('cHora'), `${b.time} → ${i.hora}`]); }
    if (+i.pessoas > 0 && +i.pessoas !== b.pax) { muda.pax = +i.pessoas; linhas.push([ia('cPessoas'), `${b.pax} → ${+i.pessoas}`]); }
    if (i.nome && i.nome !== b.name) { muda.name = i.nome; linhas.push([ia('cNome'), `${b.name} → ${i.nome}`]); }
    if (i.whats) { muda.whats = i.whats; linhas.push(['WhatsApp', i.whats]); }
    if (i.email) { muda.email = i.email; linhas.push([ia('cEmail'), i.email]); }
    if (!Object.keys(muda).length) return E_('nada para mudar');
    const assumiu = [];
    if (muda.pax) { const novo = Bookings.precoDe(x, b.tourId, muda.date || b.date, muda.time || b.time, muda.pax).total;
      muda.total = novo; assumiu.push(`${ia('cTotal')} ${eur(novo)}`); }
    return { titulo: ia('cAlterarReserva'), assumiu, linhas,
      fazer: () => { Object.assign(b, muda); save(); if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b); return { ok: true }; } };
  }
  if (nome === 'cancelar_reserva') {
    const b = Bookings.byCode(String(i.codigo || '').toUpperCase()); if (!b) return E_('reserva não encontrada');
    if (b.status === 'cancelled') return E_('essa reserva já está cancelada');
    return { titulo: ia('cCancelarReserva'), assumiu: [],
      linhas: [[ia('cCliente'), b.name], [ia('xPasseio'), nomeTour(Tours.get(b.tourId))], [ia('cQuando'), `${dataCurta(b.date)} ${b.time}`],
        [ia('cPessoas'), String(b.pax)], ...(Bookings.paid(b) ? [[ia('cRecebido'), eur(Bookings.paid(b))]] : [])],
      fazer: () => { Bookings.cancel(b.id); return { ok: true, aviso: 'quem avisa o cliente é o guia' }; } };
  }
  if (nome === 'registrar_pagamento') {
    const b = Bookings.byCode(String(i.codigo || '').toUpperCase()); if (!b) return E_('reserva não encontrada');
    const falta = Bookings.due(b);
    const valor = +i.valor > 0 ? +i.valor : falta;
    if (!(valor > 0)) return E_('essa reserva já está paga');
    const metodo = ['pix', 'card', 'cash', 'transfer'].includes(i.metodo) ? i.metodo : 'pix';
    return { titulo: ia('cPagamento'), assumiu: +i.valor > 0 ? [] : [`${ia('cValor')} ${eur(valor)}`],
      linhas: [[ia('cCliente'), b.name], [ia('cCodigo'), b.code], [ia('cValor'), eur(valor)], [ia('cComo'), metodo],
        [ia('cFalta'), eur(Math.max(0, falta - valor))]],
      fazer: () => { b.payments.push({ amount: valor, date: hojeIso(), method: metodo, kind: Bookings.paid(b) ? 'balance' : 'deposit' });
        save(); if (typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b); return { ok: true }; } };
  }
  /* ---- perfil do guia ---- */
  if (nome === 'alterar_ajustes') {
    const st = DB.settings, mapa = [['nome', 'admName'], ['negocio', 'negocio'], ['cidade', 'base'], ['bio', 'bio'], ['texto_home', 'homeText'], ['whats', 'whats'], ['insta', 'insta']];
    const muda = {}, linhas = [];
    for (const [de, para] of mapa) if (i[de] !== undefined && String(i[de]).trim() && String(i[de]) !== String(st[para] || '')) {
      muda[para] = String(i[de]).trim();
      linhas.push([de === 'texto_home' ? ia('cTextoHome') : de === 'bio' ? ia('cBio') : de, String(i[de]).slice(0, 120)]);
    }
    if (!linhas.length) return E_('nada para mudar');
    return { titulo: ia('cAjustes'), assumiu: [], linhas,
      fazer: () => { Object.assign(st, muda); save(); if (typeof cloudPushState === 'function') cloudPushState(); return { ok: true }; } };
  }
  /* ---- treino do agente de atendimento ---- */
  if (nome === 'ensinar_agente') {
    if (typeof ensino !== 'function') return E_('esta parte não existe neste app');
    const e = ensino(), linhas = [], novo = {};
    if (i.tom && ENS_TONS[i.tom]) { novo.tom = i.tom; linhas.push([ia('ensP1'), ia('tom_' + i.tom)]); }
    if (i.detalhe) { novo.tomExtra = String(i.detalhe).slice(0, 300); linhas.push([ia('ensP1'), novo.tomExtra]); }
    const novas = (Array.isArray(i.respostas) ? i.respostas : []).filter(r => r && r.pergunta && r.resposta);
    if (novas.length) linhas.push([ia('ensP2'), novas.map(r => '• ' + r.pergunta).join('\n')]);
    if (i.nunca) { novo.nunca = String(i.nunca).slice(0, 500); linhas.push([ia('ensLimTit'), novo.nunca]); }
    if (Array.isArray(i.passar) && i.passar.length) { novo.passa = i.passar.filter(k => ENS_PASSA.includes(k)); linhas.push([ia('ensPassaTit'), novo.passa.map(k => ia(k)).join(', ')]); }
    if (!linhas.length) return E_('diga o que mudar no treino');
    return { titulo: ia('cEnsinar'), assumiu: [], linhas,
      fazer: () => { Object.assign(e, novo);
        for (const r of novas) { const j = e.faq.findIndex(f => f.p.toLowerCase() === String(r.pergunta).toLowerCase());
          const item = { k: '', p: String(r.pergunta).slice(0, 200), r: String(r.resposta).slice(0, 600) };
          if (j >= 0) e.faq[j] = item; else e.faq.push(item); }
        Mkt.salva(); return { ok: true, aviso: 'para valer no Instagram de verdade, use o botão Aplicar na aba Atendimento' }; } };
  }
  if (nome === 'criar_cupom') {
    const code = String(i.codigo || '').toUpperCase().replace(/\s+/g, ''), pct = +i.desconto;
    if (!code || !(pct > 0 && pct <= 100)) return E_('código e desconto de 1 a 100%');
    if (DB.coupons.some(c => c.code.toUpperCase() === code)) return E_('já existe um cupom com esse código');
    const until = isoOk(i.validade) ? i.validade : addDays(hojeIso(), 90);
    return { titulo: ia('cCriarCupom'), assumiu: [], linhas: [[ia('cCodigo'), code], [ia('cDesconto'), pct + '%'], [ia('cValidade'), dataCurta(until)]],
      fazer: () => { Coupons.create({ code, pct, until, oncePerPerson: i.uma_vez_por_pessoa !== false, uses: [] }); return { ok: true }; } };
  }
  if (nome === 'apagar_cupom') {
    const c = DB.coupons.find(c => c.code.toUpperCase() === String(i.codigo || '').toUpperCase()); if (!c) return E_('cupom não encontrado');
    return { titulo: ia('cApagarCupom'), assumiu: [], linhas: [[ia('cCodigo'), c.code]], fazer: () => { Coupons.remove(c.code); return { ok: true }; } };
  }
  if (nome === 'salvar_posts') {
    const itens = (i.itens || []).filter(p => isoOk(p.data) && p.tema); if (!itens.length) return E_('nenhum item válido');
    return { titulo: `${ia('subPlano')}: ${itens.length}`, assumiu: [], linhas: itens.slice(0, 8).map(p => [dataCurta(p.data), `${p.formato} · ${p.tema}`]),
      fazer: () => { const novos = itens.map(p => ({ id: uid(), data: p.data, formato: FORMATOS_POST.includes(p.formato) ? p.formato : 'post', tema: p.tema,
        passeio_id: p.passeio_id || null, legenda: p.legenda || '', roteiro: p.roteiro || '', situacao: 'ideia' }));
        m.posts.push(...novos); Mkt.salva(); return { ok: true, ids: novos.map(p => p.id) }; } };
  }
  if (nome === 'mudar_post') {
    const p = m.posts.find(p => p.id === i.post_id); if (!p) return E_('item não encontrado');
    const muda = {}; for (const k of ['data', 'formato', 'tema', 'legenda', 'roteiro', 'situacao']) if (i[k] && i[k] !== p[k]) muda[k] = i[k];
    if (!Object.keys(muda).length) return E_('nada muda');
    return { titulo: ia('cMudarPost'), assumiu: [], linhas: [[ia('cItem'), p.tema], ...Object.keys(muda).map(k => [k, String(muda[k]).slice(0, 80)])],
      fazer: () => { Object.assign(p, muda); Mkt.salva(); return { ok: true }; } };
  }
  if (nome === 'apagar_post') {
    const p = m.posts.find(p => p.id === i.post_id); if (!p) return E_('item não encontrado');
    return { titulo: ia('apagar'), assumiu: [], linhas: [[ia('cItem'), p.tema]], fazer: () => { m.posts = m.posts.filter(x => x !== p); Mkt.salva(); return { ok: true }; } };
  }
  if (nome === 'salvar_anuncio') {
    if (!(+i.verba_dia > 0)) return E_('verba por dia'); const dur = +i.duracao_dias || 7;
    return { titulo: ia('subAnuncios'), assumiu: [], linhas: [['', i.titulo], [ia('objetivo'), i.objetivo], [ia('publico'), i.publico],
      [ia('verba'), `${eur(+i.verba_dia)}${ia('porDia')} · ${dur} ${ia('dias')} · ${ia('total')} ${eur(+i.verba_dia * dur)}`]],
      fazer: () => { const a = { id: uid(), criado: hojeIso(), titulo: i.titulo, objetivo: i.objetivo, publico: i.publico, verba_dia: +i.verba_dia, duracao_dias: dur,
        datas_alvo: i.datas_alvo || '', passeio_id: i.passeio_id || null, textos: i.textos || [], fotoRef: i.foto || '', porque: i.porque || '', situacao: 'rascunho' };
        m.anuncios.unshift(a); Mkt.salva(); return { ok: true, anuncio_id: a.id }; } };
  }
  if (nome === 'apagar_anuncio') {
    const a = m.anuncios.find(a => a.id === i.anuncio_id); if (!a) return E_('anúncio não encontrado');
    return { titulo: ia('apagar'), assumiu: [], linhas: [['', a.titulo]], fazer: () => { m.anuncios = m.anuncios.filter(x => x !== a); Mkt.salva(); return { ok: true }; } };
  }
  if (nome === 'criar_criativo' || nome === 'mudar_criativo') {
    const antes = nome === 'mudar_criativo' ? m.criativos.find(c => c.id === i.criativo_id) : null;
    if (nome === 'mudar_criativo' && !antes) return E_('criativo não encontrado');
    const c = Object.assign({ formato: 'story', cor: 'principal', titulo: '', texto: '', rodape: '', fotoRef: 'nenhuma' }, antes || {});
    for (const k of ['formato', 'titulo', 'texto', 'rodape', 'cor']) if (i[k] !== undefined && i[k] !== null) c[k] = i[k];
    if (i.foto) c.fotoRef = i.foto;
    if (!FORMATOS_CRIATIVO[c.formato]) return E_('formato: story, post ou flyer');
    if (!CORES_NOMES.includes(c.cor)) c.cor = 'principal';
    if (c.fotoRef !== 'nenhuma' && !fotoSrc(c.fotoRef)) return E_('foto não encontrada — use ver_fotos, ou "nenhuma"');
    if (!c.titulo) return E_('faltou o título');
    const [w, h] = FORMATOS_CRIATIVO[c.formato];
    return { titulo: ia('subCriativos'), assumiu: [], linhas: [['', `${c.formato} ${w}×${h}`], [ia('fotoRot'), c.fotoRef === 'nenhuma' ? '—' : c.fotoRef], ['', c.titulo]],
      fazer: () => { if (antes) Object.assign(antes, c); else { c.id = uid(); c.criado = hojeIso(); m.criativos.unshift(c); } Mkt.salva(); return { ok: true, criativo_id: c.id }; } };
  }
  if (nome === 'apagar_criativo') {
    const c = m.criativos.find(c => c.id === i.criativo_id); if (!c) return E_('criativo não encontrado');
    return { titulo: ia('apagar'), assumiu: [], linhas: [['', c.titulo]], fazer: () => { m.criativos = m.criativos.filter(x => x !== c); Mkt.salva(); return { ok: true }; } };
  }
  if (nome === 'gerar_imagem') {
    if (!imgDisponivel()) return E_(ia('imgSemChave'));
    const desc = String(i.descricao || '').trim(); if (!desc) return E_('faltou a descrição');
    const formato = FORMATOS_CRIATIVO[i.formato] ? i.formato : 'post';
    return { titulo: ia('imgTit'), assumiu: [], linhas: [['', desc], ['', `${formato} · ${PROPORCAO[formato]}`], ['Gemini', '≈ US$ 0,04']],
      fazer: async () => { const f = await geraEGuarda(desc, formato); return { ok: true, ref: f.id, aviso: 'use esta ref em criar_criativo' }; } };
  }
  if (nome === 'guardar_memoria') {
    const t = String(i.texto || '').trim(); if (!t) return E_('texto vazio');
    return { titulo: ia('subMemoria'), assumiu: [], linhas: [['', t]], fazer: () => { const x = { id: uid(), texto: t, criado: hojeIso() }; m.memoria.push(x); Mkt.salva(); return { ok: true, memoria_id: x.id }; } };
  }
  if (nome === 'apagar_memoria') {
    const x = m.memoria.find(x => x.id === i.memoria_id); if (!x) return E_('item não encontrado');
    return { titulo: ia('apagar'), assumiu: [], linhas: [['', x.texto]], fazer: () => { m.memoria = m.memoria.filter(y => y !== x); Mkt.salva(); return { ok: true }; } };
  }
  return E_('ferramenta desconhecida');
}
IA_TXT.xPasseio = { pt: 'Passeio', en: 'Tour', fr: 'Visite', it: 'Tour', de: 'Tour', es: 'Tour' };
/* rótulos dos cartões de confirmação, nas seis línguas */
IA_TXT.cCriarPasseio = { pt: "Criar passeio (rascunho)", en: "Create tour (draft)", fr: "Créer une visite (brouillon)", it: "Crea tour (bozza)", de: "Tour anlegen (Entwurf)", es: "Crear tour (borrador)" };
IA_TXT.cNome = { pt: "Nome", en: "Name", fr: "Nom", it: "Nome", de: "Name", es: "Nombre" };
IA_TXT.cPreco = { pt: "Preço", en: "Price", fr: "Prix", it: "Prezzo", de: "Preis", es: "Precio" };
IA_TXT.cGrupo = { pt: "Grupo", en: "Group", fr: "Groupe", it: "Gruppo", de: "Gruppe", es: "Grupo" };
IA_TXT.cPorPessoa = { pt: "/ pessoa", en: "/ person", fr: "/ personne", it: "/ persona", de: "/ Person", es: "/ persona" };
IA_TXT.cPorSessao = { pt: "/ sessão", en: "/ session", fr: "/ séance", it: "/ sessione", de: "/ Termin", es: "/ sesión" };
IA_TXT.cAlterarPasseio = { pt: "Alterar passeio", en: "Edit tour", fr: "Modifier la visite", it: "Modifica tour", de: "Tour bearbeiten", es: "Editar tour" };
IA_TXT.cDescricao = { pt: "Descrição", en: "Description", fr: "Description", it: "Descrizione", de: "Beschreibung", es: "Descripción" };
IA_TXT.cEncontro = { pt: "Encontro", en: "Meeting point", fr: "Point de rendez-vous", it: "Punto d’incontro", de: "Treffpunkt", es: "Punto de encuentro" };
IA_TXT.cDuracao = { pt: "Duração", en: "Duration", fr: "Durée", it: "Durata", de: "Dauer", es: "Duración" };
IA_TXT.cSite = { pt: "No site", en: "On the site", fr: "Sur le site", it: "Sul sito", de: "Auf der Website", es: "En el sitio" };
IA_TXT.cMudarPreco = { pt: "Mudar preço", en: "Change price", fr: "Modifier le prix", it: "Cambia prezzo", de: "Preis ändern", es: "Cambiar precio" };
IA_TXT.cCrianca = { pt: "Criança", en: "Child", fr: "Enfant", it: "Bambino", de: "Kind", es: "Niño" };
IA_TXT.cAddHorario = { pt: "Adicionar horário", en: "Add a time slot", fr: "Ajouter un horaire", it: "Aggiungi orario", de: "Termin hinzufügen", es: "Añadir horario" };
IA_TXT.cDias = { pt: "Dias", en: "Days", fr: "Jours", it: "Giorni", de: "Tage", es: "Días" };
IA_TXT.cHora = { pt: "Hora", en: "Time", fr: "Heure", it: "Ora", de: "Uhrzeit", es: "Hora" };
IA_TXT.cVagas = { pt: "Vagas", en: "Seats", fr: "Places", it: "Posti", de: "Plätze", es: "Plazas" };
IA_TXT.cPeriodo = { pt: "Período", en: "Period", fr: "Période", it: "Periodo", de: "Zeitraum", es: "Periodo" };
IA_TXT.cRemHorario = { pt: "Remover horário", en: "Remove time slot", fr: "Supprimer l’horaire", it: "Rimuovi orario", de: "Termin entfernen", es: "Quitar horario" };
IA_TXT.cHorario = { pt: "Horário", en: "Time slot", fr: "Horaire", it: "Orario", de: "Termin", es: "Horario" };
IA_TXT.cBloquear = { pt: "Bloquear agenda", en: "Block dates", fr: "Bloquer des dates", it: "Blocca date", de: "Tage sperren", es: "Bloquear fechas" };
IA_TXT.cMotivo = { pt: "Motivo", en: "Reason", fr: "Motif", it: "Motivo", de: "Grund", es: "Motivo" };
IA_TXT.cReservasValem = { pt: "{n} reserva(s) nessas datas continuam valendo", en: "{n} booking(s) on these dates remain valid", fr: "{n} réservation(s) à ces dates restent valables", it: "{n} prenotazione/i in queste date restano valide", de: "{n} Buchung(en) an diesen Tagen bleiben gültig", es: "{n} reserva(s) en esas fechas siguen válidas" };
IA_TXT.cLiberar = { pt: "Liberar agenda", en: "Unblock dates", fr: "Débloquer des dates", it: "Sblocca date", de: "Tage freigeben", es: "Desbloquear fechas" };
IA_TXT.cCriarCupom = { pt: "Criar cupom", en: "Create coupon", fr: "Créer un code promo", it: "Crea coupon", de: "Gutschein anlegen", es: "Crear cupón" };
IA_TXT.cCodigo = { pt: "Código", en: "Code", fr: "Code", it: "Codice", de: "Code", es: "Código" };
IA_TXT.cDesconto = { pt: "Desconto", en: "Discount", fr: "Réduction", it: "Sconto", de: "Rabatt", es: "Descuento" };
IA_TXT.cValidade = { pt: "Validade", en: "Valid until", fr: "Valable jusqu’au", it: "Valido fino al", de: "Gültig bis", es: "Válido hasta" };
IA_TXT.cApagarCupom = { pt: "Apagar cupom", en: "Delete coupon", fr: "Supprimer le code", it: "Elimina coupon", de: "Gutschein löschen", es: "Borrar cupón" };
IA_TXT.cMudarPost = { pt: "Mudar item do plano", en: "Edit plan item", fr: "Modifier l’élément du plan", it: "Modifica elemento del piano", de: "Planeintrag ändern", es: "Cambiar elemento del plan" };
IA_TXT.cItem = { pt: "Item", en: "Item", fr: "Élément", it: "Elemento", de: "Eintrag", es: "Elemento" };

/* o que é extra: o app de reservas é a base; os agentes são módulos à parte */
IA_TXT.aDispSem = { pt: 'Oi, {nome}! No sábado não tem saída. A próxima com lugar é "{tour}", {data}, às {hora} ({livres} lugares). Serve?',
  en: 'Hi {nome}! There’s no departure on Saturday. The next one with space is "{tour}", {data} at {hora} ({livres} seats). Would that work?',
  fr: 'Bonjour {nome} ! Il n’y a pas de départ samedi. Le prochain avec de la place : « {tour} », {data} à {hora} ({livres} places). Cela vous convient ?',
  it: 'Ciao {nome}! Sabato non ci sono partenze. La prossima con posti liberi è "{tour}", {data} alle {hora} ({livres} posti). Ti va bene?',
  de: 'Hallo {nome}! Am Samstag gibt es keinen Termin. Der nächste mit freien Plätzen: „{tour}“, {data} um {hora} ({livres} Plätze). Passt das?',
  es: '¡Hola, {nome}! El sábado no hay salida. La próxima con plazas es "{tour}", {data} a las {hora} ({livres} plazas). ¿Te va bien?' };
/* imagem por IA (Gemini, com a chave do próprio guia) */
IA_TXT.imgTit = { pt: 'Imagem por IA', en: 'AI image', fr: 'Image par IA', it: 'Immagine con IA', de: 'KI-Bild', es: 'Imagen con IA' };
IA_TXT.imgTxt = { pt: 'Para fundo, ilustração e conceito. Para mostrar lugar e passeio, use foto de verdade.', en: 'For backgrounds, illustrations and concepts. To show places and tours, use real photos.',
  fr: 'Pour les fonds, illustrations et concepts. Pour montrer un lieu ou une visite, utilisez une vraie photo.', it: 'Per sfondi, illustrazioni e concetti. Per mostrare luoghi e tour, usate foto vere.',
  de: 'Für Hintergründe, Illustrationen und Ideen. Für Orte und Touren echte Fotos verwenden.', es: 'Para fondos, ilustraciones y conceptos. Para mostrar lugares y tours, usa fotos reales.' };
IA_TXT.imgPh = { pt: 'ex.: vinhedos no outono em aquarela, sem pessoas', en: 'e.g. autumn vineyards in watercolour, no people', fr: 'ex. : vignes en automne à l’aquarelle, sans personnages',
  it: 'es.: vigneti in autunno ad acquerello, senza persone', de: 'z. B. Weinberge im Herbst als Aquarell, ohne Menschen', es: 'ej.: viñedos en otoño en acuarela, sin personas' };
IA_TXT.imgGerar = { pt: '✦ Gerar', en: '✦ Generate', fr: '✦ Générer', it: '✦ Genera', de: '✦ Erzeugen', es: '✦ Generar' };
IA_TXT.imgGerando = { pt: 'Gerando a imagem…', en: 'Generating the image…', fr: 'Génération de l’image…', it: 'Sto generando l’immagine…', de: 'Bild wird erzeugt…', es: 'Generando la imagen…' };
IA_TXT.imgPronta = { pt: 'Imagem pronta — está em Suas fotos.', en: 'Image ready — it’s in Your photos.', fr: 'Image prête — elle est dans Vos photos.', it: 'Immagine pronta — è in Le vostre foto.', de: 'Bild fertig — es ist unter Ihre Fotos.', es: 'Imagen lista — está en Tus fotos.' };
IA_TXT.imgConectaTxt = { pt: 'Para gerar imagens, conecte o Gemini (Google): entre em aistudio.google.com, toque em "Get API key", crie a chave e cole aqui. Ela fica só neste aparelho. Cada imagem custa alguns centavos na sua conta Google.',
  en: 'To generate images, connect Gemini (Google): go to aistudio.google.com, tap "Get API key", create a key and paste it here. It stays on this device only. Each image costs a few cents on your Google account.',
  fr: 'Pour générer des images, connectez Gemini (Google) : allez sur aistudio.google.com, touchez « Get API key », créez la clé et collez-la ici. Elle reste sur cet appareil. Chaque image coûte quelques centimes sur votre compte Google.',
  it: 'Per generare immagini, collegate Gemini (Google): andate su aistudio.google.com, toccate "Get API key", create la chiave e incollatela qui. Resta solo su questo dispositivo. Ogni immagine costa pochi centesimi sul vostro account Google.',
  de: 'Um Bilder zu erzeugen, verbinden Sie Gemini (Google): aistudio.google.com öffnen, auf „Get API key“ tippen, Schlüssel erstellen und hier einfügen. Er bleibt nur auf diesem Gerät. Jedes Bild kostet ein paar Cent auf Ihrem Google-Konto.',
  es: 'Para generar imágenes, conecta Gemini (Google): entra en aistudio.google.com, toca "Get API key", crea la clave y pégala aquí. Se queda solo en este dispositivo. Cada imagen cuesta unos céntimos en tu cuenta de Google.' };
IA_TXT.imgConectar = { pt: 'Conectar', en: 'Connect', fr: 'Connecter', it: 'Collega', de: 'Verbinden', es: 'Conectar' };
IA_TXT.imgTrocar = { pt: 'Trocar a chave do Gemini', en: 'Change the Gemini key', fr: 'Changer la clé Gemini', it: 'Cambia la chiave Gemini', de: 'Gemini-Schlüssel ändern', es: 'Cambiar la clave de Gemini' };
IA_TXT.imgSemChave = { pt: 'O gerador de imagem ainda não está conectado (Marketing → Criativos → Imagem por IA).', en: 'The image generator isn’t connected yet (Marketing → Creatives → AI image).',
  fr: 'Le générateur d’images n’est pas encore connecté (Marketing → Créations → Image par IA).', it: 'Il generatore di immagini non è ancora collegato (Marketing → Creatività → Immagine con IA).',
  de: 'Der Bildgenerator ist noch nicht verbunden (Marketing → Creatives → KI-Bild).', es: 'El generador de imágenes aún no está conectado (Marketing → Creatividades → Imagen con IA).' };
IA_TXT.imgChaveRuim = { pt: 'O Google não aceitou a chave. Confira se colou inteira.', en: 'Google did not accept the key. Check you pasted all of it.', fr: 'Google n’a pas accepté la clé. Vérifiez qu’elle est complète.',
  it: 'Google non ha accettato la chiave. Controllate di averla incollata tutta.', de: 'Google hat den Schlüssel nicht akzeptiert. Bitte vollständig einfügen.', es: 'Google no aceptó la clave. Comprueba que la pegaste entera.' };
IA_TXT.imgCota = { pt: 'A cota do Gemini acabou por agora. Tente mais tarde ou ative o faturamento na conta Google.', en: 'The Gemini quota is used up for now. Try later or enable billing on the Google account.',
  fr: 'Le quota Gemini est épuisé pour l’instant. Réessayez plus tard ou activez la facturation Google.', it: 'La quota Gemini è esaurita per ora. Riprovate più tardi o attivate la fatturazione Google.',
  de: 'Das Gemini-Kontingent ist vorerst aufgebraucht. Später erneut versuchen oder Abrechnung bei Google aktivieren.', es: 'La cuota de Gemini se agotó por ahora. Prueba más tarde o activa la facturación en Google.' };
IA_TXT.imgRecusou = { pt: 'O Gemini não gerou a imagem. Tente descrever de outro jeito.', en: 'Gemini didn’t generate the image. Try describing it differently.', fr: 'Gemini n’a pas généré l’image. Essayez une autre description.',
  it: 'Gemini non ha generato l’immagine. Provate a descriverla diversamente.', de: 'Gemini hat kein Bild erzeugt. Beschreiben Sie es anders.', es: 'Gemini no generó la imagen. Prueba a describirla de otra forma.' };
IA_TXT.dImgPede = { pt: 'Gera uma imagem de fundo para um post de outono', en: 'Generate a background image for an autumn post', fr: 'Génère une image de fond pour un post d’automne',
  it: 'Genera un’immagine di sfondo per un post d’autunno', de: 'Erzeuge ein Hintergrundbild für einen Herbst-Post', es: 'Genera una imagen de fondo para un post de otoño' };
IA_TXT.dImgTit = { pt: 'O outono chegou', en: 'Autumn is here', fr: 'L’automne est là', it: 'È arrivato l’autunno', de: 'Der Herbst ist da', es: 'Llegó el otoño' };
IA_TXT.dImgTexto = { pt: 'Menos gente, luz mais baixa, ruas mais calmas. A melhor época para andar sem pressa.', en: 'Fewer people, lower light, quieter streets. A good season to walk without hurry.',
  fr: 'Moins de monde, une lumière plus basse, des rues plus calmes. Une belle saison pour flâner.', it: 'Meno gente, luce più bassa, strade più tranquille. Una bella stagione per camminare senza fretta.',
  de: 'Weniger Leute, tieferes Licht, ruhigere Straßen. Eine gute Zeit, um ohne Eile zu gehen.', es: 'Menos gente, luz más baja, calles más tranquilas. Buena época para caminar sin prisa.' };
IA_TXT.dImgResp = { pt: 'Gerei a imagem com IA (está em Suas fotos, marcada "IA") e montei um post com ela em Marketing → Criativos.', en: 'I generated the image with AI (it’s in Your photos, tagged "AI") and made a post with it in Marketing → Creatives.',
  fr: 'J’ai généré l’image par IA (dans Vos photos, marquée « IA ») et créé un post avec elle dans Marketing → Créations.', it: 'Ho generato l’immagine con l’IA (è in Le vostre foto, con l’etichetta "IA") e ho creato un post in Marketing → Creatività.',
  de: 'Ich habe das Bild mit KI erzeugt (unter Ihre Fotos, markiert „KI“) und damit einen Post unter Marketing → Creatives erstellt.', es: 'Generé la imagen con IA (está en Tus fotos, marcada "IA") y armé un post con ella en Marketing → Creatividades.' };
IA_TXT.imgSelo = { pt: 'IA', en: 'AI', fr: 'IA', it: 'IA', de: 'KI', es: 'IA' };
IA_TXT.vivoTit = { pt: 'ao vivo', en: 'live', fr: 'en direct', it: 'dal vivo', de: 'live', es: 'en vivo' };
IA_TXT.vivoTxt = { pt: 'Demonstração ao vivo: é o Claude de verdade respondendo, com os dados deste protótipo. Peça o que quiser — há um limite de mensagens por dia.',
  en: 'Live demo: this is the real Claude answering, using this prototype’s data. Ask anything — there’s a daily message limit.',
  fr: 'Démo en direct : c’est le vrai Claude qui répond, avec les données de ce prototype. Demandez ce que vous voulez — il y a une limite de messages par jour.',
  it: 'Demo dal vivo: risponde il vero Claude, con i dati di questo prototipo. Chiedete ciò che volete — c’è un limite di messaggi al giorno.',
  de: 'Live-Demo: Hier antwortet der echte Claude mit den Daten dieses Prototyps. Fragen Sie, was Sie möchten — es gibt ein Tageslimit.',
  es: 'Demo en vivo: responde el Claude de verdad, con los datos de este prototipo. Pide lo que quieras — hay un límite de mensajes por día.' };
IA_TXT.vivoAcabou = { pt: 'O limite de hoje da demonstração ao vivo acabou. Seguem os exemplos prontos.', en: 'Today’s live demo limit is used up. Here are the ready-made examples.',
  fr: 'La limite du jour de la démo en direct est atteinte. Voici les exemples prêts.', it: 'Il limite di oggi della demo dal vivo è esaurito. Ecco gli esempi pronti.',
  de: 'Das heutige Limit der Live-Demo ist erreicht. Hier sind die fertigen Beispiele.', es: 'Se acabó el límite de hoy de la demo en vivo. Aquí van los ejemplos listos.' };
IA_TXT.imgVivoTxt = { pt: 'Demonstração: até 3 imagens por dia, geradas pelo Gemini de verdade.', en: 'Demo: up to 3 images a day, generated by the real Gemini.',
  fr: 'Démo : jusqu’à 3 images par jour, générées par le vrai Gemini.', it: 'Demo: fino a 3 immagini al giorno, generate dal vero Gemini.',
  de: 'Demo: bis zu 3 Bilder pro Tag, erzeugt vom echten Gemini.', es: 'Demo: hasta 3 imágenes por día, generadas por el Gemini de verdad.' };
IA_TXT.imgLimite = { pt: 'As imagens de hoje da demonstração acabaram. Volte amanhã, ou conecte a sua chave do Gemini.', en: 'Today’s demo images are used up. Come back tomorrow, or connect your own Gemini key.',
  fr: 'Les images du jour de la démo sont épuisées. Revenez demain ou connectez votre clé Gemini.', it: 'Le immagini di oggi della demo sono finite. Tornate domani o collegate la vostra chiave Gemini.',
  de: 'Die heutigen Demo-Bilder sind aufgebraucht. Morgen wieder, oder eigenen Gemini-Schlüssel verbinden.', es: 'Se acabaron las imágenes de hoy de la demo. Vuelve mañana o conecta tu clave de Gemini.' };
IA_TXT.extra = { pt: 'extra', en: 'add-on', fr: 'option', it: 'extra', de: 'Zusatz', es: 'extra' };
IA_TXT.extraAviso = { pt: 'Módulo extra — contratado à parte do app de reservas.', en: 'Add-on module — purchased separately from the booking app.',
  fr: 'Module en option — acheté séparément de l’app de réservation.', it: 'Modulo extra — si acquista a parte rispetto all’app di prenotazione.',
  de: 'Zusatzmodul — separat zur Buchungs-App erhältlich.', es: 'Módulo extra — se contrata aparte de la app de reservas.' };

async function iaRodaFerramenta(nome, input) {
  input = input || {};
  try {
    if (IA_LEITURA.has(nome)) return iaLeitura(nome, input);
    const plano = iaPlano(nome, input);
    if (plano.erro) return plano;
    /* IA_SEMPRE_CONFIRMA (definido pelo app): ferramentas que mostram o cartão mesmo com a
       confirmação desligada — memória, tabela de preços, apagar, backup: um texto malicioso
       colado numa conversa não pode gravar nada disso sozinho */
    if (iaPerguntaAntes() || (typeof IA_SEMPRE_CONFIRMA !== 'undefined' && IA_SEMPRE_CONFIRMA.has(nome))) {
      if (!(await iaPedeConfirmacao(plano))) return { cancelado: true, aviso: 'cancelou: nada foi gravado. Não insista nem refaça. Em UMA linha, pergunte o que ela quer diferente; se ela corrigir, faça do jeito dela e termine perguntando "Guardo isso como regra para sempre?"' };
    } else iaCartaoFeito(plano);
    const r = await plano.fazer();
    iaRedesenhaTela();
    return r;
  } catch (e) { return E_(String(e && e.message || e)); }
}
function iaRedesenhaTela() {
  if (typeof route !== 'function') return;
  if (typeof isBusyEditing === 'function' && isBusyEditing()) return;
  const y = window.scrollY || 0; route(); scrollTo(0, y);
}

/* ---------- instruções do Claude de verdade ---------- */
/* O que está acontecendo no app AGORA — vai junto em toda mensagem, para ele
   falar do dia dela sem precisar chamar ferramenta para o básico. */
/* a primeira linha da conversa: o dia dela em uma frase, e o convite */
function iaSaudacao() {
  const h = new Date().getHours();
  const parte = h < 12 ? 'sdBom' : h < 19 ? 'sdBoa' : 'sdNoite';
  const hoje = hojeIso();
  const bs = DB.bookings.filter(b => b.status !== 'cancelled');
  const hj = bs.filter(b => b.date === hoje);
  const pax = hj.reduce((n, b) => n + b.pax, 0);
  const devendo = bs.filter(b => b.date >= hoje && Bookings.due(b) > 0);
  const falta = devendo.reduce((n, b) => n + Bookings.due(b), 0);
  const linhas = [ia(parte, { nome: guiaNome() })];
  linhas.push(hj.length ? ia('sdHoje', { n: hj.length, p: pax }) : ia('sdHojeVazio'));
  if (devendo.length) linhas.push(ia('sdFalta', { v: eur(falta), n: devendo.length }));
  linhas.push(ia('sdConvite'));
  return linhas.join('\n');
}

function iaAgora() {
  const hoje = hojeIso(), fim = addDays(hoje, 7);
  const bs = DB.bookings.filter(b => b.status !== 'cancelled');
  const hojeSai = bs.filter(b => b.date === hoje);
  const semana = bs.filter(b => b.date > hoje && b.date <= fim);
  const devendo = bs.filter(b => b.date >= hoje && Bookings.due(b) > 0);
  const vazias = (typeof saidasVazias === 'function' ? saidasVazias(7) : [])
    .filter(x => x.livres >= Math.ceil(x.capacity / 2)).slice(0, 4);
  const novas = bs.filter(b => (b.createdAt || '').slice(0, 10) >= addDays(hoje, -2));
  const linha = (b) => `${dataCurta(b.date)} ${b.time} · ${nomeTour(Tours.get(b.tourId))} · ${b.name} (${b.pax})`;
  return [
    linhaHoje(),
    hojeSai.length ? `Saídas de hoje: ${hojeSai.map(linha).join(' | ')}` : 'Hoje não há saída.',
    semana.length ? `Próximos 7 dias: ${semana.length} reserva(s) — ${semana.slice(0, 5).map(linha).join(' | ')}` : 'Próximos 7 dias sem reserva.',
    devendo.length ? `A receber: ${devendo.map(b => `${b.code} ${b.name} ${eur(Bookings.due(b))}`).join(' | ')}` : 'Nada a receber nas próximas saídas.',
    vazias.length ? `Saídas com vaga sobrando: ${vazias.map(x => `${dataCurta(x.date)} ${x.time} ${nomeTour(x.x)} (${x.livres} de ${x.capacity})`).join(' | ')}` : '',
    novas.length ? `Reservas novas (48 h): ${novas.length}` : '',
  ].filter(Boolean).join('\n');
}

function iaSistema() {
  const k = Mkt.get().kit, mem = Mkt.get().memoria;
  const lingua = (LANGS.find(l => l[0] === LANG) || [0, 0, 'Português'])[2];
  return [
    { type: 'text', cache_control: { type: 'ephemeral' }, text: `${linhaHoje()}

Você é o assistente de ${guiaNome()} (${guiaNegocio()}), guia de turismo baseado em ${guiaBase()}. Trabalha dentro do app de reservas: conhece os passeios, a agenda, as vagas e as reservas, e escreve como a equipe de marketing da casa.

## Como você é
Inteligente, elegante e gentil, como uma pessoa de confiança que trabalha com ela há anos. Fala pouco e resolve: frase curta, sem jargão, sem "como posso ajudar?". Chama ela pelo nome de vez em quando, não em toda linha. Nada de emoji em excesso — no máximo um, quando couber.
Você é PROPOSITIVO: depois de responder, ofereça o próximo passo mais útil em uma linha ("quer que eu já ponha isso no plano?", "posso mandar o link do Pedro?"), e pare. Uma pergunta por vez.
Você enxerga o app inteiro em tempo real — o bloco "SITUAÇÃO AGORA" abaixo vem atualizado a cada mensagem. Use esses números em vez de perguntar o óbvio; chame as ferramentas quando precisar de detalhe.
Quando ela contar algo solto, você mesmo transforma em ação no app e mostra o cartão de confirmação. O trabalho dela é falar; o de preencher é seu.
Se um pedido tiver várias partes, faça todas e confirme uma por uma, na ordem que faz sentido.
Se algo estiver estranho no app (vaga sobrando perto da data, reserva sem pagamento, passeio muito visto que não vende), diga em uma linha, sem alarme.

## O que você faz dentro do app
Você é o painel inteiro em forma de conversa. Lê: passeios, agenda, vagas, reservas, clientes, cupons, bloqueios, fotos, marketing, relatório (visitas, conversão e receita por passeio), ajustes e o treino do agente de atendimento. Grava, sempre com cartão de confirmação: passeio, preço, horário, bloqueio, cupom, plano de postagem, criativo, anúncio, memória, **reserva (criar, mudar, cancelar), pagamento recebido, perfil do guia e o treino do agente**.
Quando o guia contar algo que cabe no app ("fechei com o Pedro no dia 10", "recebi 150 do João por Pix", "mudei o ponto de encontro", "o cliente sempre pergunta X"), ofereça gravar você mesmo, em uma frase, e chame a ferramenta. Vários pedidos numa mensagem: resolva todos, um cartão por ação.
O que você não sabe (o dado só existe na cabeça dele), pergunte — uma pergunta por vez, a mais importante primeiro.

## Regra absoluta
Você nunca fala com ninguém de fora: não contata cliente, não publica, não manda mensagem nem e-mail, não liga nem paga anúncio. Você escreve; quem envia e publica é o guia. Não existe ferramenta para mandar nada para fora — é de propósito.

## Gravar no app
Para criar ou mudar algo, chame a ferramenta direto: o app mostra o cartão de confirmação sozinho. Se cancelarem, não grave e não insista. Ler é livre. Vários itens do mesmo tipo: uma chamada só. Datas nas ferramentas em AAAA-MM-DD.

## Qualidade
Nunca invente data, preço, história, tradição ou regra. O que falta vira [colchete] e uma linha dizendo o que falta. Separe fato de lenda. Frases curtas, concretas; nada de texto turístico genérico. Se o texto poderia ter sido escrito por qualquer outro guia, não está pronto.
Palavras proibidas: ${k.proibidas || '—'}.
${k.voz ? 'A voz do guia, nas palavras dele: ' + k.voz : ''}
${k.frases ? 'Frases do guia (use com parcimônia, no máximo uma por peça):\n' + k.frases : ''}
${k.hashtags ? 'Hashtags fixas: ' + k.hashtags : ''}

## Peças
Legenda: primeira linha é gancho, nunca o nome do passeio; 2 a 4 parágrafos curtos; o prático numa linha; chamada simples; 3 a 5 hashtags.
Reel: cena por cena com tempo, imagem, fala literal e direção; gancho nos 3 primeiros segundos; 15 a 30 s.
Story: uma frase e uma imagem; urgência só com fato e data verdadeiros.
Resposta a cliente: na língua do cliente, começando pela resposta; concreta (data, hora, preço); termina com uma pergunta que facilita o próximo passo; junto, a versão no idioma do guia.
Plano de postagem: olhe a agenda; saída com vaga sobrando e data chegando puxa post antes; sem frequência pedida, três por semana. Salve com salvar_posts, legenda pronta.
Passeio a partir de fotos: quando mandarem fotos pedindo um passeio, descreva o que vê, escolha você mesmo um nome e uma descrição curta com base só no que aparece (sem inventar história do lugar; o guia troca depois) e a melhor foto de capa — não pergunte isso. Pergunte numa mensagem só apenas o que falta de verdade: preço (obrigatório, nunca se inventa) e, se não disseram, duração e ponto de encontro. Com o preço, chame criar_passeio com a melhor foto como capa (foto = ref). As outras fotos servem para criativos.
Criativo: foto do app num molde (ver_fotos; a fotografia do próprio guia tem prioridade) ou "nenhuma" para fundo na cor da marca com texto explicativo.
Imagem por IA (gerar_imagem): permitida para fundo, ilustração, conceito ou textura. Nunca para representar um lugar real, o passeio ou pessoas como se fosse foto — isso engana o cliente. Quando usar, diga que a imagem foi gerada por IA.
Anúncio (Meta): objetivo, público, verba diária e duração com o porquê em uma linha, 2 a 3 versões de texto, qual foto. Ligue à agenda. Nunca prometa resultado. Salve com salvar_anuncio.

## Formato
Responda em ${lingua}, curto. Texto para copiar vem pronto, sem comentário em volta. Negrito com parcimônia; nada de tabelas.` },
    { type: 'text', text: `## SITUAÇÃO AGORA (atualizada a cada mensagem)\n${iaAgora()}` },
    { type: 'text', text: `${linhaHoje()} Moeda: euro.` + (iaModo() === 'vivo' ? ' Isto é a demonstração pública do app: quem conversa é um guia conhecendo o produto, e os passeios e reservas são de exemplo.' : '') + (iaContexto() ? ` Tela aberta: ${iaContexto().txt}.` : '') +
      (mem.length ? '\n\n## Memória (o que o guia ensinou)\n' + mem.map(x => `- [${x.id}] ${x.texto}`).join('\n') : '') },
  ];
}

function iaTraduzErro(status, corpo) {
  const msg = (corpo && corpo.error && corpo.error.message) || '';
  if (status === 401) return ia('e401');
  if (status === 400 && /credit balance/i.test(msg)) return ia('eCredito');
  if (status === 429) return ia('e429');
  if (status === 529 || status === 503) return ia('eCheio');
  if (!status) return ia('eRede');
  return `Erro ${status}. ${msg}`.trim();
}
async function iaChamar(mensagens) {
  const vivo = iaModo() === 'vivo';
  let r;
  try {
    r = vivo
      ? await iaFetch(COFRE + '/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ max_tokens: 1500, system: iaSistema(), tools: IA_FERRAMENTAS, messages: mensagensParaEnvio(mensagens) }) })
      : await iaFetch('https://api.anthropic.com/v1/messages', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': iaChave(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: IA_MODELO, max_tokens: 4000, system: iaSistema(), tools: IA_FERRAMENTAS, messages: mensagensParaEnvio(mensagens) }) });
  } catch (e) { throw new Error(iaTraduzErro(0)); }
  const corpo = await r.json().catch(() => null);
  if (vivo && r.status === 429 && corpo && corpo.error && corpo.error.type === 'limite') { marcaEsgotado('claude'); throw Object.assign(new Error(ia('vivoAcabou')), { acabou: true }); }
  if (!r.ok) throw new Error(iaTraduzErro(r.status, corpo));
  if (!vivo) iaSomaGasto(corpo.usage);
  return corpo;
}
function iaSomaGasto(u) {
  if (!u) return;
  const p = IA_PRECO;
  iaGrava(IA_GASTO, (iaLe(IA_GASTO, 0) || 0) + ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out
    + (u.cache_creation_input_tokens || 0) * p.in * p.cacheW + (u.cache_read_input_tokens || 0) * p.in * p.cacheR) / 1e6);
  iaMostraGasto();
}
const ehPergunta = (m) => m.role === 'user' && (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some(b => b.type === 'text') && !m.content.some(b => b.type === 'tool_result')));
/* resultado de ferramenta já respondido: guarda só o começo (a próxima mensagem não reenvia tudo) */
function iaEncolheResultado(b) {
  if (!b || b.type !== 'tool_result' || typeof b.content !== 'string' || b.content.length <= IA_RESULT_MAX) return b;
  return { ...b, content: b.content.slice(0, IA_RESULT_MAX) + ' …[resultado encolhido — chame a ferramenta de novo se precisar do resto]' };
}
function iaAparaHist(h) {
  let x = h.slice(-24);
  while (x.length && !ehPergunta(x[0])) x.shift();
  x = x.map(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image' || b.type === 'document' || b.type === 'tool_result')
    ? { ...m, content: m.content.map(b => (b.type === 'image' || b.type === 'document') ? { type: 'text', text: b.type === 'document' ? '[documento]' : '[foto]' } : iaEncolheResultado(b)) } : m);
  /* teto por tamanho: solta as conversas mais antigas (sempre a partir de uma pergunta dela) */
  while (x.length > 2 && JSON.stringify(x).length > IA_HIST_MAX_CHARS) { x.shift(); while (x.length && !ehPergunta(x[0])) x.shift(); }
  return x;
}
/* o histórico que fica depois de um erro no meio: nunca termina numa ação sem resposta
   (tool_use sem tool_result dá erro 400 na próxima chamada) */
function iaHistSeguro(h) {
  const x = h.slice();
  while (x.length) {
    const u = x[x.length - 1];
    if (u.role === 'user' && Array.isArray(u.content) && u.content.some(b => b.type === 'tool_result')) { x.pop(); continue; }
    if (u.role === 'assistant' && Array.isArray(u.content) && u.content.some(b => b.type === 'tool_use')) { x.pop(); continue; }
    break;
  }
  return x;
}

let iaOcupado = false, iaAbortar = false;
async function iaConversa(texto, fotos) {
  fotos = !fotos ? [] : Array.isArray(fotos) ? fotos : [fotos];
  if (iaOcupado) return;
  iaOcupado = true; iaAbortar = false; iaTravado(true);
  const hist = iaAparaHist(iaLe(IA_HIST, []));
  /* Doc 07/10 parte 2, item 9 ("responde perguntas anteriores quando mando uma nova"): pergunta que
     ficou SEM resposta (erro, internet, cancelada) saía de novo junto com a nova e a IA respondia as duas.
     Agora ela sai do histórico antes da pergunta nova. */
  while (hist.length && ehPergunta(hist[hist.length - 1])) hist.pop();
  const refs = fotos.map(f => guardaFoto(f)).filter(Boolean).map(f => f.id);
  const nota = refs.length ? `\n\n[${refs.length > 1 ? 'fotos guardadas' : 'foto guardada'}; refs (para criativo ou capa de passeio): ${refs.join(', ')}]` : '';
  const pergunta = texto || (fotos.length > 1 ? 'O que dá para fazer com estas fotos?' : 'Escreva uma legenda para esta foto.');
  hist.push({ role: 'user', dia: hojeLocalIso(), content: fotos.length ? [...fotos.map(f => {
    const mt = (String(f).match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
    return /pdf/.test(mt)
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.split(',')[1] } }
      : { type: 'image', source: { type: 'base64', media_type: /^image\//.test(mt) ? mt : 'image/jpeg', data: f.split(',')[1] } };
  }), { type: 'text', text: pergunta + nota }] : pergunta });
  iaBolha('user', pergunta, null, false, fotos);
  const pensando = iaBolha('pensa', ia('pensando'));
  try {
    for (let volta = 0; volta < IA_MAX_VOLTAS; volta++) {
      const resp = await iaChamar(hist);
      if (iaAbortar) return;                           // ela limpou a conversa no meio: para aqui
      hist.push({ role: 'assistant', content: resp.content });
      const txt = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (txt) iaBolha('assistant', txt, pensando);
      if (resp.stop_reason !== 'tool_use') break;
      const res = [];
      for (const b of resp.content.filter(b => b.type === 'tool_use')) res.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await iaRodaFerramenta(b.name, b.input)) });
      hist.push({ role: 'user', content: res });
    }
    if (hist[hist.length - 1].role === 'user') { hist.pop(); hist.pop(); }
    iaGrava(IA_HIST, iaAparaHist(hist));
  } catch (e) {
    /* erro no meio (rede, limite): o que já foi feito fica na conversa, sem ação pela metade */
    if (!iaAbortar) iaGrava(IA_HIST, iaAparaHist(iaHistSeguro(hist)));
    /* acabou o limite do ao vivo: a gaveta vira demonstração e diz por quê */
    if (e.acabou) setTimeout(() => { iaAtualizaFab(); iaDesenha(); iaBolha('assistant', ia('vivoAcabou'), null, true); }, 50);
    else iaBolha('erro', e.message);
  }
  finally { pensando.remove(); iaOcupado = false; iaTravado(false); }
}

function iaReduzFoto(file, lado) {
  lado = lado || 1280;
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => falha(new Error(ia('eFoto')));
    img.src = URL.createObjectURL(file);
  });
}

/* =====================================================
   MODO DEMONSTRAÇÃO — pedidos prontos que rodam as ferramentas de verdade
===================================================== */
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
function iaCenarios() {
  /* as mais vazias, uma por passeio primeiro — lista com o mesmo passeio três vezes não diz nada */
  const primeiras = [], resto = [], vistos = new Set();
  for (const s of saidasVazias(30)) { if (vistos.has(s.x.id)) resto.push(s); else { vistos.add(s.x.id); primeiras.push(s); } }
  const vaz = [...primeiras, ...resto], top = vaz[0];
  const t1 = Tours.live()[0];
  const v = top ? { tour: nomeTour(top.x), data: dataLonga(top.date), hora: top.time, livres: top.livres, preco: top.x.price,
    dur: top.x.duration || '—', encontro: tl(top.x.meeting) || '—' } : null;
  const lista = [];
  lista.push({ id: 'vagas', pede: ia('dVagasPede'), passos: [['ver_agenda', {}]],
    resposta: () => vaz.length ? ia('dVagasResp', { lista: vaz.slice(0, 3).map(s => `• ${nomeTour(s.x)} — ${dataLonga(s.date)}, ${s.time}: ${ia('livres', { l: s.livres, c: s.capacity })}`).join('\n') }) : ia('dVagasNada') });
  if (t1) {
    const novo = Math.round((+t1.price || 30) * 1.1 / 5) * 5 || (+t1.price + 5);
    lista.push({ id: 'preco', pede: ia('dPrecoPede', { tour: nomeTour(t1), preco: novo }), passos: [['mudar_preco', { passeio_id: t1.id, preco: novo }]],
      resposta: () => ia('dPrecoResp', { tour: nomeTour(t1), preco: novo }) });
  }
  if (v) {
    const s2 = vaz[1] || top, s3 = vaz[2] || top;
    const d1 = addDays(hojeIso(), 2), d2 = addDays(hojeIso(), 5), d3 = addDays(hojeIso(), 9);
    lista.push({ id: 'plano', pede: ia('dPlanoPede'), passos: [['ver_agenda', {}], ['salvar_posts', { itens: [
      { data: d1, formato: 'reel', passeio_id: top.x.id, tema: ia('dP1Tema', v), legenda: ia('dP1Leg', v), roteiro: ia('dP1Rot', v) },
      { data: d2, formato: 'story', passeio_id: s2.x.id, tema: ia('dP2Tema', { data: dataCurta(s2.date), livres: s2.livres }),
        legenda: ia('dP2Leg', { data: dataLonga(s2.date), hora: s2.time, livres: s2.livres, tour: nomeTour(s2.x) }) },
      { data: d3, formato: 'carrossel', passeio_id: s3.x.id, tema: ia('dP3Tema', { tour: nomeTour(s3.x) }),
        legenda: ia('dP3Leg', { dur: s3.x.duration || '—', encontro: tl(s3.x.meeting) || '—', data: dataLonga(s3.date), hora: s3.time }) } ] }]],
      resposta: () => ia('dPlanoResp', { n: 3 }) });
    lista.push({ id: 'story', pede: ia('dStoryPede'), passos: [['ver_fotos', {}], ['criar_criativo', { formato: 'story', foto: top.x.id + '-capa',
      titulo: nomeTour(top.x), texto: ia('dStoryTexto', v), rodape: ia('dStoryRod', v), cor: 'principal' }]], resposta: () => ia('dStoryResp') });
    lista.push({ id: 'anuncio', pede: ia('dAnuncioPede', { data: dataCurta(top.date) }), passos: [['salvar_anuncio', {
      titulo: `${nomeTour(top.x)} — ${dataCurta(top.date)}`, objetivo: ia('dAnObj'), publico: ia('dAnPub', { cidade: guiaBase() || '—' }), verba_dia: 6, duracao_dias: 7,
      datas_alvo: `${dataLonga(top.date)}, ${top.time}`, passeio_id: top.x.id, foto: top.x.id + '-capa', porque: ia('dAnPorque'),
      textos: [{ titulo: ia('dAnT1'), texto: ia('dAnX1', v), chamada: ia('dAnBot') }, { titulo: ia('dAnT2'), texto: ia('dAnX2', v), chamada: ia('dAnBot') }] }]],
      resposta: () => ia('dAnuncioResp', { verba: 6 }) });
  }
  lista.push({ id: 'texto', pede: ia('dTextoPede'), passos: [['criar_criativo', { formato: 'post', foto: 'nenhuma', titulo: ia('dTextoTit'), texto: ia('dTextoTexto'), rodape: '@' + (DB.settings.insta || GUIA_CFG.insta || ''), cor: 'escura' }]],
    resposta: () => ia('dTextoResp') });
  if (imgDisponivel()) lista.push({ id: 'imagem', pede: ia('dImgPede'), passos: [
    ['gerar_imagem', { descricao: 'soft watercolor autumn landscape, warm ochre and burgundy tones, gentle hills and vineyards, calm mood, no people', formato: 'post' }],
    ['criar_criativo', (ant) => ({ formato: 'post', foto: ant && ant.ref, titulo: ia('dImgTit'), texto: ia('dImgTexto'), cor: 'escura' })]],
    resposta: () => ia('dImgResp') });
  const natal = `${hojeIso().slice(0, 4)}-12-25`;
  if (!DB.blocks.some(b => natal >= b.from && natal <= b.until))
    lista.push({ id: 'bloq', pede: ia('dBloqPede'), passos: [['bloquear_datas', { de: natal, ate: natal }]], resposta: () => ia('dBloqResp') });
  lista.push({ id: 'mem', pede: ia('dMemPede'), passos: [['guardar_memoria', { texto: ia('dMemPede').replace(/^[^:]+:\s*/, '') }]], resposta: () => ia('dMemResp') });
  return lista;
}

async function iaRodaCenario(c) {
  if (iaOcupado) return;
  iaOcupado = true; iaTravado(true);
  iaBolha('user', c.pede);
  const pensando = iaBolha('pensa', ia('pensando'));
  try {
    await esperar(700);
    let anterior = null;
    for (const [nome, input] of c.passos) {
      const r = await iaRodaFerramenta(nome, typeof input === 'function' ? input(anterior) : input);
      anterior = r;
      if (r && r.cancelado) { pensando.remove(); iaBolha('assistant', ia('cancelado')); return; }
      if (r && r.erro) { pensando.remove(); iaBolha('erro', r.erro); return; }
      await esperar(350);
    }
    await esperar(400);
    iaBolha('assistant', c.resposta(), pensando, true);
  } finally { pensando.remove(); iaOcupado = false; iaTravado(false); iaMostraSugestoes(); }
}

/* =====================================================
   CRIATIVOS — foto + molde da marca → PNG (nunca IA de imagem)
===================================================== */
let fontesProntas = null;
function carregaFontes() {
  if (!fontesProntas) {
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=League+Spartan:wght@700;800&family=Montserrat:wght@500;600;700&display=swap';
    document.head.appendChild(l);
    fontesProntas = new Promise(ok => { l.onload = ok; l.onerror = ok; setTimeout(ok, 3000); })
      .then(() => Promise.all([document.fonts.load('800 80px "League Spartan"'), document.fonts.load('500 40px Montserrat'), document.fonts.load('700 40px Montserrat')])).catch(() => {});
  }
  return fontesProntas;
}
const imgCache = {};
const carregaImg = (src) => imgCache[src] || (imgCache[src] = new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('foto')); i.src = src; }));
function quebra(ctx, texto, largura) {
  const out = []; let linha = '';
  for (const p of String(texto || '').split(/\s+/).filter(Boolean)) {
    const tenta = linha ? linha + ' ' + p : p;
    if (ctx.measureText(tenta).width > largura && linha) { out.push(linha); linha = p; } else linha = tenta;
  }
  if (linha) out.push(linha);
  return out;
}
function cobre(ctx, img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
/* a assinatura no lugar do logo: o nome do negócio, espaçado */
function assinatura(ctx, x, y, cor, tam) {
  ctx.save(); ctx.fillStyle = cor; ctx.font = `700 ${tam}px Montserrat`;
  const nome = guiaNegocio().toUpperCase(); let px = x;
  for (const ch of nome) { ctx.fillText(ch, px, y); px += ctx.measureText(ch).width + tam * 0.12; }
  ctx.restore();
}
function pilula(ctx, texto, x, y, fundo, tinta) {
  ctx.font = '700 34px Montserrat';
  const w = ctx.measureText(texto).width + 56, h = 64, r = 30;
  ctx.fillStyle = fundo; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.fill();
  ctx.fillStyle = tinta; ctx.fillText(texto, x + 28, y + 44);
}

async function desenhaCriativo(c, canvas) {
  const [W, H] = FORMATOS_CRIATIVO[c.formato] || FORMATOS_CRIATIVO.story;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await carregaFontes();
  const cor = corDe(c.cor), tinta = tintaSobre(cor), M = 80;
  const semFoto = !c.fotoRef || c.fotoRef === 'nenhuma';
  const foto = semFoto ? null : await carregaImg(fotoSrc(c.fotoRef) || 'capa.jpg').catch(() => null);

  if (!foto) {
    /* fundo na cor da marca com arcos finos, sempre iguais para o mesmo criativo */
    let semente = [...(c.id || c.titulo || 'x')].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const rnd = () => ((semente = (semente * 1664525 + 1013904223) >>> 0) / 4294967296);
    ctx.fillStyle = cor; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * .85, H * .1, 0, W * .85, H * .1, Math.max(W, H));
    g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(0,0,0,.18)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = tinta === '#ffffff' ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.13)'; ctx.lineWidth = 3;
    const cx = W * (0.6 + rnd() * 0.4), cy = H * (0.05 + rnd() * 0.25);
    for (let r = 120; r < Math.max(W, H) * 1.2; r += 70 + rnd() * 40) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    assinatura(ctx, M, M + 30, tinta, 30);
    const tamT = c.formato === 'story' ? 96 : 76, tamX = c.formato === 'story' ? 44 : 36;
    ctx.font = `800 ${tamT}px "League Spartan"`; const lt = quebra(ctx, c.titulo, W - 2 * M).slice(0, 5);
    ctx.font = `500 ${tamX}px Montserrat`; const lx = c.texto ? quebra(ctx, c.texto, W - 2 * M).slice(0, c.formato === 'story' ? 12 : 8) : [];
    let y = Math.max(M + 220, (H - (lt.length * tamT + (lx.length ? 40 + lx.length * tamX * 1.4 : 0))) / 2 + tamT * .8);
    ctx.fillStyle = tinta; ctx.font = `800 ${tamT}px "League Spartan"`;
    for (const l of lt) { ctx.fillText(l, M, y); y += tamT; }
    if (lx.length) { y += 20; ctx.fillRect(M, y - 10, 90, 8); y += 50; ctx.font = `500 ${tamX}px Montserrat`; for (const l of lx) { ctx.fillText(l, M, y); y += tamX * 1.4; } }
    if (c.rodape) { ctx.font = '700 34px Montserrat'; ctx.fillText(c.rodape, M, H - M); }
    return canvas;
  }

  if (c.formato === 'flyer') {
    const fh = Math.round(H * 0.6);
    ctx.fillStyle = cor; ctx.fillRect(0, 0, W, H); cobre(ctx, foto, 0, 0, W, fh);
    let y = fh + 90; ctx.fillStyle = tinta; ctx.font = '800 84px "League Spartan"';
    for (const l of quebra(ctx, c.titulo, W - 2 * M).slice(0, 3)) { ctx.fillText(l, M, y); y += 84; }
    if (c.texto) { y += 14; ctx.font = '500 38px Montserrat'; for (const l of quebra(ctx, c.texto, W - 2 * M).slice(0, 3)) { ctx.fillText(l, M, y); y += 50; } }
    if (c.rodape) { ctx.font = '700 32px Montserrat'; ctx.fillText(c.rodape, M, H - 60); }
    assinatura(ctx, W - M - 420, H - 60, tinta, 24);
    return canvas;
  }

  cobre(ctx, foto, 0, 0, W, H);
  const g = ctx.createLinearGradient(0, H * .35, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.8)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const gt = ctx.createLinearGradient(0, 0, 0, 260); gt.addColorStop(0, 'rgba(0,0,0,.45)'); gt.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 260);
  assinatura(ctx, M, M + 30, '#ffffff', c.formato === 'story' ? 32 : 26);
  const tamT = c.formato === 'story' ? 104 : 84;
  ctx.font = `800 ${tamT}px "League Spartan"`; const lt = quebra(ctx, c.titulo, W - 2 * M - 30).slice(0, 4);
  ctx.font = '500 40px Montserrat'; const lx = c.texto ? quebra(ctx, c.texto, W - 2 * M).slice(0, 4) : [];
  let y = H - (c.formato === 'story' ? 220 : 90) - (c.rodape ? 110 : 0) - lx.length * 54 - (lx.length ? 20 : 0) - (lt.length - 1) * tamT;
  ctx.fillStyle = cor; ctx.fillRect(M, y - tamT + 12, 14, lt.length * tamT);
  ctx.fillStyle = '#fff'; ctx.font = `800 ${tamT}px "League Spartan"`;
  for (const l of lt) { ctx.fillText(l, M + 36, y); y += tamT; }
  if (lx.length) { y += 10; ctx.font = '500 40px Montserrat'; ctx.fillStyle = 'rgba(255,255,255,.92)'; for (const l of lx) { ctx.fillText(l, M, y); y += 54; } }
  if (c.rodape) pilula(ctx, c.rodape, M, y + 26, cor, tinta);
  return canvas;
}
function baixaCriativo(c) {
  const cv = document.createElement('canvas');
  desenhaCriativo(c, cv).then(() => cv.toBlob(b => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `${c.formato}-${(c.titulo || 'criativo').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png'));
}

/* =====================================================
   ABA MARKETING
===================================================== */
/* A aba abre no que importa: as saídas com vaga sobrando, cada uma com três
   botões (Story · Post · Anúncio) que o assistente resolve na hora. Plano,
   criativos, anúncios e marca ficam a um toque, numa linha só com ícone.
   (21/09/2026 — a versão com cinco pílulas e listas corridas não se explicava.) */
const MKT_ABAS = [['inicio', '✦', 'abInicio'], ['plano', '📅', 'abPlano'], ['criativos', '🎨', 'abCriativos'], ['anuncios', '📣', 'abAnuncios'], ['marca', '🎯', 'abMarca']];
const MKT_ANTIGAS = { kit: 'marca', memoria: 'marca' };
const FMT_ICONE = { reel: '🎬', story: '📱', post: '🖼', carrossel: '🗂' };

/* textos novos da aba, nas seis línguas */
Object.assign(IA_TXT, {
  mkSub: { pt: 'Vaga sobrando vira post, story e anúncio — com um toque.', en: 'Empty seats become posts, stories and ads — in one tap.', fr: 'Les places libres deviennent posts, stories et pubs — en un geste.', it: 'I posti liberi diventano post, storie e annunci — con un tocco.', de: 'Freie Plätze werden zu Posts, Storys und Anzeigen — mit einem Tipp.', es: 'Las plazas libres se vuelven posts, stories y anuncios — con un toque.' },
  mkMontarMes: { pt: 'Montar o mês', en: 'Plan the month', fr: 'Planifier le mois', it: 'Pianifica il mese', de: 'Monat planen', es: 'Armar el mes' },
  abInicio: { pt: 'Início', en: 'Overview', fr: 'Accueil', it: 'Inizio', de: 'Übersicht', es: 'Inicio' },
  abPlano: { pt: 'Plano', en: 'Plan', fr: 'Plan', it: 'Piano', de: 'Plan', es: 'Plan' },
  abCriativos: { pt: 'Criativos', en: 'Creatives', fr: 'Visuels', it: 'Creatività', de: 'Grafiken', es: 'Creatividades' },
  abAnuncios: { pt: 'Anúncios', en: 'Ads', fr: 'Publicités', it: 'Annunci', de: 'Anzeigen', es: 'Anuncios' },
  abMarca: { pt: 'Marca', en: 'Brand', fr: 'Marque', it: 'Marchio', de: 'Marke', es: 'Marca' },
  opTit: { pt: 'Vagas sobrando', en: 'Empty seats', fr: 'Places libres', it: 'Posti liberi', de: 'Freie Plätze', es: 'Plazas libres' },
  opSub: { pt: 'As próximas saídas com mais lugar vazio. Escolha o que o assistente faz por cada uma.', en: 'The next departures with the most empty seats. Pick what the assistant does for each.', fr: 'Les prochains départs avec le plus de places libres. Choisissez ce que l’assistant fait pour chacun.', it: 'Le prossime partenze con più posti liberi. Scegliete cosa fa l’assistente per ognuna.', de: 'Die nächsten Termine mit den meisten freien Plätzen. Wählen Sie, was der Assistent jeweils tut.', es: 'Las próximas salidas con más plazas libres. Elige qué hace el asistente con cada una.' },
  opVazio: { pt: 'Nenhuma saída com vaga sobrando nas próximas três semanas. Boa notícia.', en: 'No departures with empty seats in the next three weeks. Good news.', fr: 'Aucun départ avec des places libres dans les trois prochaines semaines. Bonne nouvelle.', it: 'Nessuna partenza con posti liberi nelle prossime tre settimane. Buona notizia.', de: 'Keine Termine mit freien Plätzen in den nächsten drei Wochen. Gute Nachricht.', es: 'Ninguna salida con plazas libres en las próximas tres semanas. Buena noticia.' },
  opLivres: { pt: '{l} de {c} lugares livres', en: '{l} of {c} seats free', fr: '{l} places libres sur {c}', it: '{l} posti liberi su {c}', de: '{l} von {c} Plätzen frei', es: '{l} de {c} plazas libres' },
  opStory: { pt: 'Story', en: 'Story', fr: 'Story', it: 'Storia', de: 'Story', es: 'Story' },
  opPost: { pt: 'Post', en: 'Post', fr: 'Post', it: 'Post', de: 'Post', es: 'Post' },
  opAnuncio: { pt: 'Anúncio', en: 'Ad', fr: 'Pub', it: 'Annuncio', de: 'Anzeige', es: 'Anuncio' },
  opPedeStory: { pt: 'Faz um story para "{tour}", {data} às {hora} — sobram {livres} lugares.', en: 'Make a story for "{tour}", {data} at {hora} — {livres} seats left.', fr: 'Fais une story pour « {tour} », {data} à {hora} — il reste {livres} places.', it: 'Fai una storia per "{tour}", {data} alle {hora} — restano {livres} posti.', de: 'Mach eine Story für „{tour}“, {data} um {hora} — noch {livres} Plätze frei.', es: 'Haz una story para "{tour}", {data} a las {hora} — quedan {livres} plazas.' },
  opPedePost: { pt: 'Coloca no plano um post para encher "{tour}", {data} às {hora} ({livres} lugares livres).', en: 'Add a post to the plan to fill "{tour}", {data} at {hora} ({livres} seats free).', fr: 'Ajoute au plan un post pour remplir « {tour} », {data} à {hora} ({livres} places libres).', it: 'Metti nel piano un post per riempire "{tour}", {data} alle {hora} ({livres} posti liberi).', de: 'Plane einen Post, um „{tour}“ am {data} um {hora} zu füllen ({livres} Plätze frei).', es: 'Pon en el plan un post para llenar "{tour}", {data} a las {hora} ({livres} plazas libres).' },
  opPedeAnuncio: { pt: 'Monta um anúncio para encher "{tour}", {data} às {hora} ({livres} lugares livres).', en: 'Build an ad to fill "{tour}", {data} at {hora} ({livres} seats free).', fr: 'Prépare une pub pour remplir « {tour} », {data} à {hora} ({livres} places libres).', it: 'Prepara un annuncio per riempire "{tour}", {data} alle {hora} ({livres} posti liberi).', de: 'Erstelle eine Anzeige, um „{tour}“ am {data} um {hora} zu füllen ({livres} Plätze frei).', es: 'Arma un anuncio para llenar "{tour}", {data} a las {hora} ({livres} plazas libres).' },
  dPostTema: { pt: '"{tour}" — ainda dá tempo para {data}', en: '"{tour}" — there’s still time for {data}', fr: '« {tour} » — il est encore temps pour le {data}', it: '"{tour}" — c’è ancora tempo per il {data}', de: '„{tour}“ — für den {data} ist noch Zeit', es: '"{tour}" — aún hay tiempo para el {data}' },
  dPostLeg: { pt: '{data}, {hora}. Sobram {livres} lugares no "{tour}".\n\nGrupo pequeno, no seu ritmo, com as histórias que o guia de bolso não conta.\n\nReserva pelo link da bio.', en: '{data}, {hora}. {livres} seats left on "{tour}".\n\nSmall group, at your pace, with the stories the pocket guide leaves out.\n\nBook via the link in bio.', fr: '{data}, {hora}. Il reste {livres} places pour « {tour} ».\n\nPetit groupe, à votre rythme, avec les histoires que les guides de poche ne racontent pas.\n\nRéservation via le lien en bio.', it: '{data}, {hora}. Restano {livres} posti per "{tour}".\n\nGruppo piccolo, al vostro ritmo, con le storie che la guida tascabile non racconta.\n\nPrenotate dal link in bio.', de: '{data}, {hora}. Noch {livres} Plätze bei „{tour}“.\n\nKleine Gruppe, in Ihrem Tempo, mit den Geschichten, die kein Reiseführer erzählt.\n\nBuchung über den Link in der Bio.', es: '{data}, {hora}. Quedan {livres} plazas en "{tour}".\n\nGrupo pequeño, a tu ritmo, con las historias que la guía de bolsillo no cuenta.\n\nReserva en el enlace de la bio.' },
  dPostResp: { pt: 'Coloquei no plano, com a legenda pronta. Está em Marketing → Plano.', en: 'Added to the plan, caption ready. It’s in Marketing → Plan.', fr: 'Ajouté au plan, légende prête. C’est dans Marketing → Plan.', it: 'Aggiunto al piano, didascalia pronta. È in Marketing → Piano.', de: 'Im Plan, Bildtext fertig. Unter Marketing → Plan.', es: 'Añadido al plan, con el texto listo. Está en Marketing → Plan.' },
  mesTit: { pt: 'Seu marketing', en: 'Your marketing', fr: 'Votre marketing', it: 'Il vostro marketing', de: 'Ihr Marketing', es: 'Tu marketing' },
  stPosts: { pt: 'posts no plano', en: 'posts planned', fr: 'posts prévus', it: 'post nel piano', de: 'Posts geplant', es: 'posts en el plan' },
  stCriativos: { pt: 'criativos prontos', en: 'creatives ready', fr: 'visuels prêts', it: 'creatività pronte', de: 'Grafiken fertig', es: 'creatividades listas' },
  stAnuncios: { pt: 'planos de anúncio', en: 'ad plans', fr: 'plans de pub', it: 'piani di annuncio', de: 'Anzeigenpläne', es: 'planes de anuncio' },
  proxTit: { pt: 'Próximos posts', en: 'Next posts', fr: 'Prochains posts', it: 'Prossimi post', de: 'Nächste Posts', es: 'Próximos posts' },
  proxVazio: { pt: 'Nada no plano ainda. Toque em "Montar o mês" ou num botão de uma vaga acima.', en: 'Nothing planned yet. Tap "Plan the month" or a button on an empty seat above.', fr: 'Rien de prévu. Touchez « Planifier le mois » ou un bouton d’un départ ci-dessus.', it: 'Ancora niente nel piano. Toccate "Pianifica il mese" o un pulsante di una partenza qui sopra.', de: 'Noch nichts geplant. Tippen Sie auf „Monat planen“ oder einen Knopf bei einem Termin oben.', es: 'Aún no hay nada en el plan. Toca "Armar el mes" o un botón de una salida arriba.' },
  verTudo: { pt: 'Ver tudo →', en: 'See all →', fr: 'Tout voir →', it: 'Vedi tutto →', de: 'Alle ansehen →', es: 'Ver todo →' },
  novoCriativo: { pt: 'Novo criativo', en: 'New creative', fr: 'Nouveau visuel', it: 'Nuova creatività', de: 'Neue Grafik', es: 'Nueva creatividad' },
  ncFoto: { pt: 'Com foto', en: 'With a photo', fr: 'Avec photo', it: 'Con foto', de: 'Mit Foto', es: 'Con foto' },
  ncFotoSub: { pt: 'story da próxima vaga', en: 'story for the next empty seat', fr: 'story du prochain départ', it: 'storia della prossima partenza', de: 'Story zum nächsten Termin', es: 'story de la próxima salida' },
  ncTexto: { pt: 'Só texto', en: 'Text only', fr: 'Texte seul', it: 'Solo testo', de: 'Nur Text', es: 'Solo texto' },
  ncTextoSub: { pt: 'fundo na cor da marca', en: 'brand-colour background', fr: 'fond aux couleurs', it: 'sfondo nei colori', de: 'Hintergrund in Markenfarbe', es: 'fondo en el color de marca' },
  ncIA: { pt: 'Imagem por IA', en: 'AI image', fr: 'Image par IA', it: 'Immagine IA', de: 'KI-Bild', es: 'Imagen con IA' },
  ncIASub: { pt: 'ilustração, fundo, conceito', en: 'illustration, background, concept', fr: 'illustration, fond, concept', it: 'illustrazione, sfondo, concetto', de: 'Illustration, Hintergrund, Idee', es: 'ilustración, fondo, concepto' },
  galeria: { pt: 'Prontos para postar', en: 'Ready to post', fr: 'Prêts à publier', it: 'Pronti da pubblicare', de: 'Bereit zum Posten', es: 'Listos para publicar' },
  semana: { pt: 'Semana de {d}', en: 'Week of {d}', fr: 'Semaine du {d}', it: 'Settimana del {d}', de: 'Woche ab {d}', es: 'Semana del {d}' },
  vagaNoDia: { pt: 'vaga sobrando', en: 'empty seats', fr: 'places libres', it: 'posti liberi', de: 'freie Plätze', es: 'plazas libres' },
  anTotal: { pt: 'no total', en: 'in total', fr: 'au total', it: 'in totale', de: 'insgesamt', es: 'en total' },
  memTit: { pt: 'O que o assistente aprendeu', en: 'What the assistant has learned', fr: 'Ce que l’assistant a appris', it: 'Cosa ha imparato l’assistente', de: 'Was der Assistent gelernt hat', es: 'Lo que aprendió el asistente' },
  mkSubSemana: { pt: 'Seus posts da semana, prontos para publicar. Onde sobra vaga, o app sugere o que postar.', en: 'Your posts for the week, ready to publish. Where seats are left, the app suggests what to post.', fr: 'Vos posts de la semaine, prêts à publier. Là où il reste des places, l’app suggère quoi poster.', it: 'I tuoi post della settimana, pronti da pubblicare. Dove restano posti, l’app suggerisce cosa postare.', de: 'Deine Posts der Woche, fertig zum Veröffentlichen. Wo Plätze frei sind, schlägt die App etwas vor.', es: 'Tus posts de la semana, listos para publicar. Donde sobran plazas, la app sugiere qué publicar.' },
  mkCriarSemana: { pt: 'Criar posts da semana', en: 'Create this week’s posts', fr: 'Créer les posts de la semaine', it: 'Crea i post della settimana', de: 'Posts der Woche erstellen', es: 'Crear los posts de la semana' },
  pedidoSemana: { pt: 'Monte o plano de posts desta semana (próximos 7 dias), com legenda pronta, priorizando as saídas com vaga sobrando.', en: 'Build the post plan for this week (next 7 days), captions ready, prioritising departures with empty seats.', fr: 'Fais le plan de posts de cette semaine (7 prochains jours), légendes prêtes, en priorisant les départs avec des places libres.', it: 'Fai il piano dei post di questa settimana (prossimi 7 giorni), didascalie pronte, dando priorità alle partenze con posti liberi.', de: 'Erstelle den Post-Plan für diese Woche (nächste 7 Tage) mit fertigen Texten, zuerst Termine mit freien Plätzen.', es: 'Arma el plan de posts de esta semana (próximos 7 días), con texto listo, priorizando las salidas con plazas libres.' },
  mkSemanaTit: { pt: 'Esta semana', en: 'This week', fr: 'Cette semaine', it: 'Questa settimana', de: 'Diese Woche', es: 'Esta semana' },
  mkSugTxt: { pt: '{n} lugares vazios e nenhum post', en: '{n} empty seats and no post', fr: '{n} places vides et aucun post', it: '{n} posti vuoti e nessun post', de: '{n} freie Plätze und kein Post', es: '{n} plazas vacías y ningún post' },
  mkCriarStory: { pt: 'Criar story', en: 'Create story', fr: 'Créer une story', it: 'Crea storia', de: 'Story erstellen', es: 'Crear story' },
  mkPublicar: { pt: 'Publicar', en: 'Publish', fr: 'Publier', it: 'Pubblica', de: 'Veröffentlichen', es: 'Publicar' },
  mkCopiarTexto: { pt: 'Copiar texto', en: 'Copy text', fr: 'Copier le texte', it: 'Copia testo', de: 'Text kopieren', es: 'Copiar texto' },
  mkPublicado: { pt: 'Publicado', en: 'Published', fr: 'Publié', it: 'Pubblicato', de: 'Veröffentlicht', es: 'Publicado' },
  mkPubDemo: { pt: 'Demonstração: no app de verdade, isto sai direto no Instagram do guia.', en: 'Demo: in the real app, this goes straight to the guide’s Instagram.', fr: 'Démo : dans la vraie app, cela part directement sur l’Instagram du guide.', it: 'Demo: nell’app vera, questo va direttamente sull’Instagram della guida.', de: 'Demo: In der echten App geht das direkt auf das Instagram des Guides.', es: 'Demo: en la app real, esto sale directo en el Instagram del guía.' },
  mkSemanaVazia: { pt: 'Nenhum post para os próximos 7 dias ainda.', en: 'No posts for the next 7 days yet.', fr: 'Aucun post pour les 7 prochains jours.', it: 'Ancora nessun post per i prossimi 7 giorni.', de: 'Noch keine Posts für die nächsten 7 Tage.', es: 'Aún no hay posts para los próximos 7 días.' },
  mkMais: { pt: 'Mais ferramentas', en: 'More tools', fr: 'Plus d’outils', it: 'Altri strumenti', de: 'Weitere Werkzeuge', es: 'Más herramientas' },
  mkCal: { pt: 'Calendário do mês', en: 'Month calendar', fr: 'Calendrier du mois', it: 'Calendario del mese', de: 'Monatskalender', es: 'Calendario del mes' },
  mkCalSub: { pt: 'Tudo que está planejado', en: 'Everything planned', fr: 'Tout ce qui est prévu', it: 'Tutto ciò che è pianificato', de: 'Alles Geplante', es: 'Todo lo planificado' },
  mkImgSub: { pt: 'Stories e posts com a sua marca', en: 'Branded stories and posts', fr: 'Stories et posts à votre image', it: 'Storie e post con il tuo marchio', de: 'Storys und Posts mit deiner Marke', es: 'Stories y posts con tu marca' },
  mkAnSub: { pt: 'Para chegar a quem não te segue', en: 'To reach people who don’t follow you', fr: 'Pour toucher ceux qui ne vous suivent pas', it: 'Per raggiungere chi non ti segue', de: 'Um Nicht-Follower zu erreichen', es: 'Para llegar a quien no te sigue' },
  mkMarcaSub: { pt: 'Cores, tom de voz e fotos', en: 'Colours, tone and photos', fr: 'Couleurs, ton et photos', it: 'Colori, tono e foto', de: 'Farben, Tonfall und Fotos', es: 'Colores, tono y fotos' },
  mkVoltar: { pt: '← Voltar para a semana', en: '← Back to the week', fr: '← Retour à la semaine', it: '← Torna alla settimana', de: '← Zurück zur Woche', es: '← Volver a la semana' },
  mkAgora: { pt: 'O que fazer agora', en: 'What to do now', fr: 'À faire maintenant', it: 'Cosa fare adesso', de: 'Jetzt zu tun', es: 'Qué hacer ahora' },
  mkEncher: { pt: 'Encher “{tour}”', en: 'Fill “{tour}”', fr: 'Remplir « {tour} »', it: 'Riempire “{tour}”', de: '„{tour}“ füllen', es: 'Llenar “{tour}”' },
  mkVazios: { pt: 'lugares vazios', en: 'empty seats', fr: 'places vides', it: 'posti vuoti', de: 'freie Plätze', es: 'plazas vacías' },
  mkDeCap: { pt: 'de {c}', en: 'of {c}', fr: 'sur {c}', it: 'su {c}', de: 'von {c}', es: 'de {c}' },
  mkEscolha: { pt: 'Escolha como divulgar — o assistente monta pra você:', en: 'Pick how to promote it — the assistant builds it for you:', fr: 'Choisissez comment la promouvoir — l’assistant s’en charge :', it: 'Scegli come promuoverla — l’assistente la prepara per te:', de: 'Wähle, wie du werben willst — der Assistent erstellt es:', es: 'Elige cómo promocionarla — el asistente la arma por ti:' },
  expStory: { pt: 'Some em 24 h. Ideal para os próximos dias.', en: 'Gone in 24 h. Best for the next few days.', fr: 'Disparaît en 24 h. Idéal pour les prochains jours.', it: 'Sparisce in 24 h. Ideale per i prossimi giorni.', de: 'Nach 24 h weg. Ideal für die nächsten Tage.', es: 'Desaparece en 24 h. Ideal para los próximos días.' },
  expPost: { pt: 'Fica no perfil. Bom com alguns dias de antecedência.', en: 'Stays on your profile. Good a few days ahead.', fr: 'Reste sur le profil. Bien quelques jours avant.', it: 'Resta sul profilo. Bene qualche giorno prima.', de: 'Bleibt im Profil. Gut ein paar Tage vorher.', es: 'Queda en el perfil. Bien con unos días de antelación.' },
  expAnuncio: { pt: 'Chega a quem ainda não te segue. Verba pequena.', en: 'Reaches people who don’t follow you yet. Small budget.', fr: 'Touche ceux qui ne vous suivent pas encore. Petit budget.', it: 'Raggiunge chi non ti segue ancora. Budget piccolo.', de: 'Erreicht Leute, die dir noch nicht folgen. Kleines Budget.', es: 'Llega a quien aún no te sigue. Presupuesto pequeño.' },
  opOutras: { pt: 'Outras saídas com vaga', en: 'Other departures with seats', fr: 'Autres départs avec places', it: 'Altre partenze con posti', de: 'Weitere Termine mit Plätzen', es: 'Otras salidas con plazas' },
  opDivulgar: { pt: 'Divulgar', en: 'Promote', fr: 'Promouvoir', it: 'Promuovi', de: 'Bewerben', es: 'Promocionar' },
  demoLinha: { pt: 'Demonstração — nada sai deste aparelho.', en: 'Demo — nothing leaves this device.', fr: 'Démo — rien ne quitte cet appareil.', it: 'Demo — niente lascia questo dispositivo.', de: 'Demo — nichts verlässt dieses Gerät.', es: 'Demo — nada sale de este dispositivo.' },
});

/* as saídas das próximas 3 semanas com mais lugar vazio, uma por dia e passeio */
function oportunidades(n) {
  const vistas = new Set(), out = [];
  for (const s of saidasVazias(21)) {
    if (s.livres < Math.ceil(s.capacity / 2)) continue;
    const k = s.x.id + s.date; if (vistas.has(k)) continue;
    vistas.add(k); out.push(s);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.livres - a.livres).slice(0, n || 4);
}
const varsSaida = (s) => ({ tour: nomeTour(s.x), data: dataLonga(s.date), hora: s.time, livres: s.livres, preco: s.x.price,
  dur: s.x.duration || '—', encontro: tl(s.x.meeting) || '—' });

/* um toque numa vaga: com o Claude (chave ou ao vivo) vira pedido de verdade;
   na demonstração, roda as mesmas ferramentas com o texto pronto */
function acaoVaga(tipo, s) {
  const v = varsSaida(s), rot = { story: 'opPedeStory', post: 'opPedePost', anuncio: 'opPedeAnuncio' }[tipo];
  const pede = ia(rot, v);
  iaAbre();
  if (!iaDemo()) return iaConversa(pede);
  const dPost = s.date > addDays(hojeIso(), 2) ? addDays(s.date, -2) : addDays(hojeIso(), 1);
  const cena = {
    story: { passos: [['criar_criativo', { formato: 'story', foto: s.x.id + '-capa', titulo: nomeTour(s.x), texto: ia('dStoryTexto', v), rodape: ia('dStoryRod', v), cor: 'principal' }]], resposta: () => ia('dStoryResp') },
    post: { passos: [['salvar_posts', { itens: [{ data: dPost, formato: 'post', passeio_id: s.x.id, tema: ia('dPostTema', { tour: nomeTour(s.x), data: dataCurta(s.date) }),
      legenda: ia('dPostLeg', v) }] }]], resposta: () => ia('dPostResp') },
    anuncio: { passos: [['salvar_anuncio', { titulo: `${nomeTour(s.x)} — ${dataCurta(s.date)}`, objetivo: ia('dAnObj'), publico: ia('dAnPub', { cidade: guiaBase() || '—' }),
      verba_dia: 6, duracao_dias: 7, datas_alvo: `${dataLonga(s.date)}, ${s.time}`, passeio_id: s.x.id, foto: s.x.id + '-capa', porque: ia('dAnPorque'),
      textos: [{ titulo: ia('dAnT1'), texto: ia('dAnX1', v), chamada: ia('dAnBot') }, { titulo: ia('dAnT2'), texto: ia('dAnX2', v), chamada: ia('dAnBot') }] }]],
      resposta: () => ia('dAnuncioResp', { verba: 6 }) },
  }[tipo];
  iaRodaCenario({ id: 'vaga-' + tipo, pede, ...cena });
}

function pedeAoAssistente(texto) {
  iaAbre();
  if (!iaDemo()) return iaConversa(texto);   /* chave própria ou ao vivo */
  const c = iaCenarios(), mapa = { [ia('pedidoCriativo')]: 'story', [ia('pedidoTexto')]: 'texto', [ia('pedidoAnuncio')]: 'anuncio' };
  const achado = c.find(x => x.id === mapa[texto]) || (/plano|plan|mois|mese|Monat|mes/i.test(texto) ? c.find(x => x.id === 'plano') : null);
  if (achado) iaRodaCenario(achado);
}

let _vagasNaTela = [];
function admMarketing(arg) {
  const [sub0, ...resto] = String(arg || 'inicio').split('-');
  const sub = MKT_ANTIGAS[sub0] || sub0;
  const aba = MKT_ABAS.some(([k]) => k === sub) ? sub : 'inicio';
  const corpo = aba === 'plano' ? mktPlano(resto.join('-')) : aba === 'criativos' ? mktCriativos() : aba === 'anuncios' ? mktAnuncios() : aba === 'marca' ? mktMarca() : mktInicio();
  const mes = new Date().toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  admShell('marketing', `<div class="mk">
    <header class="mkTopo">
      <div class="mkTitulo"><h1 class="pageh">${ia('marketing')} <small class="iaExtra">${ia('extra')}</small></h1><p>${ia(aba === 'inicio' ? 'mkSubSemana' : 'mkSub')}</p></div>
      ${aba === 'inicio' ? `<button class="cta sm mkMes" data-pede="${esc(ia('pedidoSemana'))}">✦ ${ia('mkCriarSemana')}</button>` : ''}
    </header>
    ${aba === 'inicio' ? '' : `<nav class="mkVolta"><button class="mkLink" data-mk="inicio">${ia('mkVoltar')}</button><b>${ia(MKT_ABAS.find(([k]) => k === aba)[2])}</b></nav>`}
    ${corpo}
    <p class="mkRodape">✦ ${ia('extraAviso')}</p>
  </div>`);
  $$('[data-mk]').forEach(b => b.onclick = () => go('/adm/marketing/' + b.dataset.mk));
  /* no celular a barra de abas rola: a aba aberta tem que estar à vista */
  const abaOn = $('.mkAbas .on'); if (abaOn) abaOn.scrollIntoView({ inline: 'center', block: 'nearest' });
  $$('[data-pede]').forEach(b => b.onclick = () => pedeAoAssistente(b.dataset.pede));
  $$('[data-vaga]').forEach(b => b.onclick = () => { const s = _vagasNaTela[+b.dataset.i]; if (s) acaoVaga(b.dataset.vaga, s); });
  $$('[data-publica]').forEach(b => b.onclick = () => { const p = Mkt.get().posts.find(x => x.id === b.dataset.publica); if (!p) return; p.situacao = 'postado'; Mkt.salva(); toast(ia('mkPubDemo')); const y = scrollY; route(); scrollTo(0, y); });
  mktLiga();
}

/* as três formas de divulgar, com uma linha dizendo para que serve cada uma */
const opcoesDivulgar = (i) => [['story', 'opStory', 'expStory'], ['post', 'opPost', 'expPost'], ['anuncio', 'opAnuncio', 'expAnuncio']]
  .map(([t, n, e]) => `<button class="divOp" data-vaga="${t}" data-i="${i}"><b>${ia(n)}</b><small>${ia(e)}</small></button>`).join('');
const quandoSaida = (s) => { const d = new Date(s.date + 'T12:00:00'); return `${nomeDia(d.getDay())} ${dataCurta(s.date)} · ${esc(s.time)}`; };
function cartaoVaga(s, i) {
  const d = new Date(s.date + 'T12:00:00');
  return `<details class="vaga2">
    <summary><span class="vaga2Data"><b>${d.getDate()}</b><small>${nomeDia(d.getDay())}</small></span>
      <span class="vaga2Info"><b>${esc(nomeTour(s.x))}</b><small>${esc(s.time)}</small></span>
      <span class="vaga2Livres">${s.livres} <small>${ia('mkVazios')}</small></span>
      <span class="vaga2Bt">${ia('opDivulgar')}</span></summary>
    <div class="divOps">${opcoesDivulgar(i)}</div></details>`;
}
function cartaoAgora(s) {
  return `<section class="agora"><span class="agoraTag">✦ ${ia('mkAgora')}</span>
    <div class="agoraTopo"><div><h2>${esc(ia('mkEncher', { tour: nomeTour(s.x) }))}</h2><p>${quandoSaida(s)}</p></div>
      <div class="agoraNum"><b>${s.livres}</b><small>${ia('mkVazios')} ${ia('mkDeCap', { c: s.capacity })}</small></div></div>
    <p class="agoraSub">${ia('mkEscolha')}</p>
    <div class="divOps">${opcoesDivulgar(0)}</div></section>`;
}

function cartaoPost(p, curto) {
  const f = FMT_ICONE[p.formato] ? p.formato : 'post', d = new Date(p.data + 'T12:00:00');
  return `<details class="post f-${f} ${p.situacao}">
    <summary><span class="postIco" aria-hidden="true">${FMT_ICONE[f]}</span>
      <span class="postTxt"><b>${esc(p.tema)}</b><small>${nomeDia(d.getDay())} ${dataCurta(p.data)} · ${esc(f)}</small></span>
      <span class="postSit s-${p.situacao}">${ia(p.situacao)}</span></summary>
    ${curto ? '' : ''}
    ${p.legenda ? `<pre class="mkTxt">${esc(p.legenda)}</pre>` : ''}${p.roteiro ? `<pre class="mkTxt">${esc(p.roteiro)}</pre>` : ''}
    <div class="mkBts">${p.legenda ? `<button class="mini" data-copia="${p.id}">${ia('copiarLegenda')}</button>` : ''}
      ${p.situacao !== 'postado' ? `<button class="mini" data-postado="${p.id}">${ia('marcarPostado')}</button>` : ''}
      ${iaDemo() ? '' : `<button class="mini" data-pede="${esc(ia('pedidoReescrever', { id: p.id, tema: p.tema }))}">${ia('reescrever')}</button>`}
      <button class="mini danger" data-apagapost="${p.id}">${ia('apagar')}</button></div>
  </details>`;
}

/* Marketing = "o que eu posto esta semana?". Posts prontos (imagem + texto +
   Publicar) e, nos dias com vaga sobrando sem post, uma sugestão de um toque.
   O resto (calendário, imagens, anúncios, marca) fica em "Mais ferramentas". */
function mktSemeia(m) {
  /* demonstração: começa com dois posts de exemplo para a tela não nascer vazia */
  if (m.semeado || m.posts.length) return;
  m.semeado = true;
  const usados = new Set();
  oportunidades(8).filter(s => !usados.has(s.x.id) && usados.add(s.x.id)).slice(0, 2).forEach((s, k) => {
    const v = varsSaida(s), dia = s.date > addDays(hojeIso(), 2) ? addDays(s.date, -2) : addDays(hojeIso(), 1);
    m.posts.push({ id: 'p-' + uid(), data: dia, formato: k ? 'story' : 'post', passeio_id: s.x.id,
      tema: ia('dPostTema', { tour: nomeTour(s.x), data: dataCurta(s.date) }), legenda: ia('dPostLeg', v), situacao: 'rascunho' });
  });
  Mkt.salva();
}
function cartaoPostSemana(p) {
  const x = p.passeio_id && Tours.get(p.passeio_id), foto = (x && x.photo) || 'capa.jpg', d = new Date(p.data + 'T12:00:00');
  const fmt = p.formato === 'story' ? ia('opStory') : p.formato === 'reel' ? 'Reel' : ia('opPost');
  const feito = p.situacao === 'postado';
  return `<article class="pc ${feito ? 'feito' : ''} ${p.formato === 'story' ? 'story' : ''}">
    <div class="pcImg" style="background-image:url('${esc(foto)}')"><span class="pcFmt">${fmt}</span><b class="pcTit">${esc(p.tema)}</b></div>
    <div class="pcCorpo"><small class="pcQuando">${nomeDia(d.getDay())} ${dataCurta(p.data)}${feito ? ` · <span class="pcOk">✓ ${ia('mkPublicado')}</span>` : ''}</small>
      ${p.legenda ? `<p class="pcLeg">${esc(p.legenda)}</p>` : ''}
      <div class="pcBts">${feito ? '' : `<button class="ibBt" data-publica="${p.id}">${ia('mkPublicar')}</button>`}
        ${p.legenda ? `<button class="pcCopia" data-copia="${p.id}">${ia('mkCopiarTexto')}</button>` : ''}
        <button class="pcX" data-apagapost="${p.id}" aria-label="${ia('apagar')}">×</button></div></div></article>`;
}
function mktInicio() {
  const m = Mkt.get(); mktSemeia(m);
  const hoje = hojeIso(), fim = addDays(hoje, 7);
  const posts = m.posts.filter(p => p.data >= hoje && p.data < fim).sort((a, b) => a.data.localeCompare(b.data));
  const comPost = new Set(posts.map(p => (p.passeio_id || '') + '|' + p.data));
  /* sugestões: saídas da semana com metade ou mais vazia e sem post para elas */
  const sugs = saidasVazias(7).filter(s => s.livres >= Math.ceil(s.capacity / 2) && !m.posts.some(p => p.passeio_id === s.x.id && p.data <= s.date && p.data >= addDays(s.date, -3)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const vistas = new Set(), sug = sugs.filter(s => { const k = s.x.id + s.date; if (vistas.has(k)) return false; vistas.add(k); return true; }).slice(0, 4);
  _vagasNaTela = sug;
  const sugHtml = sug.map((s, i) => { const d = new Date(s.date + 'T12:00:00'); return `<div class="sug">
      <span class="sugData"><b>${d.getDate()}</b><small>${nomeDia(d.getDay())}</small></span>
      <span class="sugTxt"><b>${esc(nomeTour(s.x))} · ${esc(s.time)}</b><small>${ia('mkSugTxt', { n: s.livres })}</small></span>
      <button class="ibBt" data-vaga="story" data-i="${i}">✦ ${ia('mkCriarStory')}</button></div>`; }).join('');
  const ferr = [['plano', 'mkCal', 'mkCalSub', '🗓'], ['criativos', 'abCriativos', 'mkImgSub', '🖼'], ['anuncios', 'abAnuncios', 'mkAnSub', '📣'], ['marca', 'abMarca', 'mkMarcaSub', '🎨']];
  return `
    <section class="mkSec"><h3 class="mkSecTit">${ia('mkSemanaTit')}</h3>
      ${posts.length ? `<div class="pcs">${posts.map(cartaoPostSemana).join('')}</div>`
        : `<div class="mkVazioGrande"><p>${ia('mkSemanaVazia')}</p><button class="cta sm" data-pede="${esc(ia('pedidoSemana'))}">✦ ${ia('mkCriarSemana')}</button></div>`}
    </section>
    ${sug.length ? `<section class="mkSec"><h3 class="mkSecTit">💡 ${ia('opTit')}</h3><div class="sugs">${sugHtml}</div></section>` : ''}
    <section class="mkSec"><h3 class="mkSecTit">${ia('mkMais')}</h3>
      <div class="ferr">${ferr.map(([k, t, sub, ic]) => `<button data-mk="${k}"><span aria-hidden="true">${ic}</span><b>${ia(t)}</b><small>${ia(sub)}</small></button>`).join('')}</div></section>`;
}

function mktPlano(mesArg) {
  const mes = /^\d{4}-\d{2}$/.test(mesArg) ? mesArg : hojeIso().slice(0, 7);
  const [a, mm] = mes.split('-').map(Number);
  const nomeMes = new Date(a, mm - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const nomeMesCap = nomeMes[0].toUpperCase() + nomeMes.slice(1);
  const ant = mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, '0')}`, prox = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`;
  const ini = mes + '-01', fim = addDays(prox + '-01', -1);
  const posts = Mkt.get().posts.filter(p => p.data.startsWith(mes)).sort((x, y) => x.data.localeCompare(y.data));
  const vazias = {};
  for (const x of Tours.live()) for (const d of Cal.departures(x.id, ini, fim)) {
    if (d.date < hojeIso()) continue;
    const livres = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
    if (livres >= d.capacity / 2) (vazias[d.date] = vazias[d.date] || []).push(`${nomeTour(x)} ${d.time} · ${ia('opLivres', { l: livres, c: d.capacity })}`);
  }
  /* agrupa por semana (começando na segunda) — lista corrida de dias cansava */
  const semanaDe = (iso) => { const dt = new Date(iso + 'T12:00:00'); return addDays(iso, -((dt.getDay() + 6) % 7)); };
  const dias = [...new Set([...posts.map(p => p.data), ...Object.keys(vazias)])].sort();
  const semanas = {};
  for (const d of dias) (semanas[semanaDe(d)] = semanas[semanaDe(d)] || []).push(d);
  return `
    <div class="mkMesNav"><button class="mini" data-mes="${ant}" aria-label="‹">‹</button><b>${esc(nomeMesCap)}</b><button class="mini" data-mes="${prox}" aria-label="›">›</button></div>
    ${dias.length ? Object.keys(semanas).sort().map(sem => `
      <section class="mkBloco"><div class="mkBlocoTopo"><h3>${ia('semana', { d: dataCurta(sem) })}</h3></div>
        ${semanas[sem].map(d => {
          const dt = new Date(d + 'T12:00:00'), ps = posts.filter(p => p.data === d), vs = vazias[d] || [];
          return `<div class="dia"><div class="diaData"><b>${dt.getDate()}</b><small>${nomeDia(dt.getDay())}</small></div>
            <div class="diaItens">${vs.map(v => `<div class="diaVaga">● ${ia('vagaNoDia')}: ${esc(v)}</div>`).join('')}${ps.map(p => cartaoPost(p)).join('')}</div></div>`;
        }).join('')}</section>`).join('')
      : `<div class="emptybox"><p>${esc(ia('mesVazio', { mes: nomeMes }))}</p></div>`}`;
}

function mktCriativos() {
  const m = Mkt.get();
  /* imagem por IA: no app de um cliente, ele pode ligar a chave dele; no demo
     público só aparece se o cofre tiver imagem ligada (22/09/2026: sem Gemini) */
  const comIA = imgDisponivel() || (typeof temNuvem === 'function' && temNuvem());
  return `
    <section class="mkBloco"><div class="mkBlocoTopo"><h2>${ia('novoCriativo')}</h2></div>
      <div class="novos" style="grid-template-columns:repeat(${comIA ? 3 : 2},1fr)">
        <button class="novo" data-pede="${esc(ia('pedidoCriativo'))}"><span>📸</span><b>${ia('ncFoto')}</b><small>${ia('ncFotoSub')}</small></button>
        <button class="novo" data-pede="${esc(ia('pedidoTexto'))}"><span>✍️</span><b>${ia('ncTexto')}</b><small>${ia('ncTextoSub')}</small></button>
        ${comIA ? `<button class="novo" id="ncIA"><span>✨</span><b>${ia('ncIA')}</b><small>${ia('ncIASub')}</small></button>` : ''}
      </div></section>
    ${comIA ? `<section class="mkBloco" id="blocoIA"><div class="mkBlocoTopo"><h3>✨ ${ia('imgTit')}</h3></div><p class="mkNota">${ia('imgTxt')}</p>
      ${imgDisponivel() ? `${imgPeloCofre() ? `<p class="mkNota">⚡ ${ia('imgVivoTxt')}</p>` : ''}<div class="mkGera"><textarea id="imgDesc" rows="2" placeholder="${esc(ia('imgPh'))}"></textarea>
        <select id="imgFmt">${Object.keys(FORMATOS_CRIATIVO).map(f => `<option value="${f}">${f}</option>`).join('')}</select>
        <button class="cta sm" id="imgGera">${ia('imgGerar')}</button></div>
        <p class="mkNota" id="imgMsg"></p>${imgChave() ? `<button class="mini" id="imgTroca">${ia('imgTrocar')}</button>` : ''}`
      : `<p class="mkNota">${ia('imgConectaTxt')}</p><div class="mkGera"><input id="imgChaveIn" type="password" autocomplete="off" placeholder="AIza…">
        <button class="cta sm" id="imgChaveOk">${ia('imgConectar')}</button></div><p class="mkNota" id="imgMsg"></p>`}</section>` : ''}
    <section class="mkBloco"><div class="mkBlocoTopo"><h2>${ia('galeria')}</h2></div>
      ${m.criativos.length ? `<div class="mkGrade">${m.criativos.map(c => `
        <figure class="criativo"><canvas data-cv="${c.id}"></canvas>
          <figcaption><b>${esc(c.titulo)}</b><small>${esc(c.formato)}${(m.fotos.find(f => f.id === c.fotoRef) || {}).ia ? ' · ' + ia('imgSelo') : ''}</small></figcaption>
          <div class="mkBts"><button class="mini" data-baixa="${c.id}">⬇ ${ia('baixar')}</button>
            ${iaDemo() ? '' : `<button class="mini" data-pede="${esc(ia('pedidoTitulo', { id: c.id }))}">${ia('outroTitulo')}</button>`}
            <button class="mini danger" data-apagacv="${c.id}" aria-label="${esc(ia('apagar'))}">×</button></div></figure>`).join('')}</div>`
      : `<div class="emptybox"><p>${esc(ia('semCriativo'))}</p></div>`}</section>
    <details class="mkBloco mkFotosBloco"><summary><h3>🖼 ${ia('suasFotos')} <small>(${m.fotos.length})</small></h3></summary>
      <p class="mkNota">${ia('fotosTxt')}</p>
      <button class="cta sm" id="mkFotoAdd">${ia('enviarFotos')}</button><input type="file" id="mkFotoArq" accept="image/*" multiple hidden>
      ${m.fotos.length ? `<div class="mkFotos">${m.fotos.map(f => `<div><img src="${f.src}" alt="">${f.ia ? `<span class="mkSeloIA">${ia('imgSelo')}</span>` : ''}<button class="mini danger" data-tirafoto="${f.id}">×</button></div>`).join('')}</div>` : ''}
    </details>`;
}

function mktAnuncios() {
  const as = Mkt.get().anuncios;
  return `
    <section class="mkBloco"><p class="mkNota">${ia('anunciosTxt')}</p>
      <button class="cta sm" data-pede="${esc(ia('pedidoAnuncio'))}">📣 ${ia('pedirAnuncio').replace(/^✦\s*/, '')}</button></section>
    ${as.length ? as.map(a => {
      const x = a.passeio_id && Tours.get(a.passeio_id), foto = a.fotoRef && fotoSrc(a.fotoRef);
      return `<article class="anuncio">
        ${foto ? `<div class="anFoto" style="background-image:url('${esc(foto)}')"></div>` : ''}
        <div class="anCorpo">
          <div class="anTopo"><b>${esc(a.titulo)}</b><span class="postSit ${a.situacao === 'no ar' ? 's-postado' : 's-ideia'}">${a.situacao === 'no ar' ? ia('noAr') : ia('rascunho')}</span></div>
          <div class="anVerba"><b>${eur(a.verba_dia * a.duracao_dias)}</b><span>${ia('anTotal')} · ${eur(a.verba_dia)}${ia('porDia')} × ${a.duracao_dias} ${ia('dias')}</span></div>
          <dl class="mkDl"><dt>${ia('objetivo')}</dt><dd>${esc(a.objetivo)}</dd><dt>${ia('publico')}</dt><dd>${esc(a.publico)}</dd>
            ${a.datas_alvo ? `<dt>${ia('paraEncher')}</dt><dd>${esc(a.datas_alvo)}</dd>` : ''}
            ${a.porque ? `<dt>${ia('porque')}</dt><dd>${esc(a.porque)}</dd>` : ''}</dl>
          ${(a.textos || []).map((t, n) => `<div class="mkVersao"><small>${ia('versao')} ${n + 1}${t.chamada ? ' · ' + ia('botaoRot') + ': ' + esc(t.chamada) : ''}</small><b>${esc(t.titulo || '')}</b><p>${esc(t.texto || '')}</p></div>`).join('')}
          <div class="mkBts">${a.situacao !== 'no ar' ? `<button class="mini" data-noar="${a.id}">✓ ${ia('subiMeta')}</button>` : ''}<button class="mini danger" data-apagaan="${a.id}">${ia('apagar')}</button></div>
        </div></article>`;
    }).join('') : `<div class="emptybox"><p>${ia('semAnuncio')}</p></div>`}`;
}

function mktMarca() {
  const k = Mkt.get().kit, mem = Mkt.get().memoria;
  const rot = { principal: 'corPrincipal', destaque: 'corDestaque', escura: 'corEscura', neutra: 'corNeutra' };
  return `
    <section class="mkBloco"><div class="mkBlocoTopo"><h2>${ia('coresTit')}</h2></div>
      <div class="mkCores">${CORES_NOMES.map(n =>
        `<label><input type="color" data-cor="${n}" value="${esc(k.cores[n])}"><b>${ia(rot[n])}</b><small>${esc(k.cores[n])}</small></label>`).join('')}</div>
      <div class="fontes"><p style="font:800 28px 'League Spartan',sans-serif">${ia('fonteImpacto')}</p><p style="font:600 18px Montserrat,sans-serif">${ia('fonteTexto')}</p></div></section>
    <section class="mkBloco mkForm"><div class="mkBlocoTopo"><h2>${ia('vozTit')}</h2></div>
      <textarea id="kVoz" rows="4" placeholder="${esc(ia('vozPh'))}">${esc(k.voz)}</textarea>
      <label class="fld">${ia('frasesTit')}<textarea id="kFrases" rows="3">${esc(k.frases)}</textarea></label>
      <label class="fld">${ia('proibidasTit')}<input id="kProib" value="${esc(k.proibidas)}"></label>
      <label class="fld">${ia('hashtagsTit')}<input id="kHash" value="${esc(k.hashtags)}"></label>
      <button class="cta sm" id="kSalva">${ia('salvar')}</button></section>
    <section class="mkBloco"><div class="mkBlocoTopo"><h2>${ia('memTit')}</h2></div><p class="mkNota">${ia('memoriaTxt')}</p>
      <div class="mkGera"><input id="mkMemIn" placeholder="${esc(ia('ensinarPh'))}"><button class="cta sm" id="mkMemAdd">${ia('guardar')}</button></div>
      ${mem.length ? `<ul class="mem">${mem.map(x => `<li><span>${esc(x.texto)}</span><small>${dataCurta(x.criado)}</small><button class="mini danger" data-esquece="${x.id}" aria-label="${esc(ia('apagar'))}">×</button></li>`).join('')}</ul>` : `<p class="mkNota">${ia('nadaGuardado')}</p>`}</section>`;
}

function mktLiga() {
  const m = Mkt.get(), re = () => { const y = scrollY; route(); scrollTo(0, y); };
  $$('[data-mes]').forEach(b => b.onclick = () => go('/adm/marketing/plano-' + b.dataset.mes));
  $$('[data-copia]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const p = m.posts.find(p => p.id === b.dataset.copia); navigator.clipboard && navigator.clipboard.writeText(p.legenda).then(() => toast(ia('legendaCopiada'))); });
  $$('[data-postado]').forEach(b => b.onclick = () => { m.posts.find(p => p.id === b.dataset.postado).situacao = 'postado'; Mkt.salva(); re(); });
  $$('[data-apagapost]').forEach(b => b.onclick = () => { if (!confirm(ia('apagarItem'))) return; m.posts = m.posts.filter(p => p.id !== b.dataset.apagapost); Mkt.salva(); re(); });
  $$('[data-noar]').forEach(b => b.onclick = () => { m.anuncios.find(a => a.id === b.dataset.noar).situacao = 'no ar'; Mkt.salva(); re(); });
  $$('[data-apagaan]').forEach(b => b.onclick = () => { if (!confirm(ia('apagarItem'))) return; m.anuncios = m.anuncios.filter(a => a.id !== b.dataset.apagaan); Mkt.salva(); re(); });
  $$('[data-apagacv]').forEach(b => b.onclick = () => { if (!confirm(ia('apagarItem'))) return; m.criativos = m.criativos.filter(c => c.id !== b.dataset.apagacv); Mkt.salva(); re(); });
  $$('[data-baixa]').forEach(b => b.onclick = () => baixaCriativo(m.criativos.find(c => c.id === b.dataset.baixa)));
  $$('[data-cv]').forEach(cv => { const c = m.criativos.find(c => c.id === cv.dataset.cv); if (c) desenhaCriativo(c, cv).catch(() => {}); });
  $$('[data-esquece]').forEach(b => b.onclick = () => { m.memoria = m.memoria.filter(x => x.id !== b.dataset.esquece); Mkt.salva(); re(); });
  const nc = $('#ncIA'); if (nc) nc.onclick = () => { const b = $('#blocoIA'); b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.classList.add('pisca'); setTimeout(() => b.classList.remove('pisca'), 1400); const d = $('#imgDesc') || $('#imgChaveIn'); if (d) setTimeout(() => d.focus(), 400); };
  const fa = $('#mkFotoAdd'), farq = $('#mkFotoArq');
  if (fa) fa.onclick = () => farq.click();
  if (farq) farq.onchange = async () => { for (const f of [...farq.files]) { try { if (!guardaFoto(await iaReduzFoto(f, 1600), f.name.replace(/\.[^.]+$/, ''))) break; } catch (e) { toast(e.message); } } re(); };
  $$('[data-tirafoto]').forEach(b => b.onclick = () => {
    if (!confirm(m.criativos.some(c => c.fotoRef === b.dataset.tirafoto) ? ia('fotoEmUso') : ia('apagarItem'))) return;
    m.fotos = m.fotos.filter(f => f.id !== b.dataset.tirafoto); Mkt.salva(); re();
  });
  const ig = $('#imgGera');
  if (ig) ig.onclick = async () => {
    const d = $('#imgDesc').value.trim(); if (!d) return;
    ig.disabled = true; $('#imgMsg').textContent = ia('imgGerando');
    try { await geraEGuarda(d, $('#imgFmt').value); toast(ia('imgPronta')); re(); }
    catch (e) { $('#imgMsg').textContent = e.message; ig.disabled = false; }
  };
  const ik = $('#imgChaveOk');
  if (ik) ik.onclick = () => {
    const v = $('#imgChaveIn').value.trim();
    if (!/^AIza[\w-]{20,}$/.test(v)) { $('#imgMsg').textContent = ia('imgChaveRuim'); return; }
    try { localStorage.setItem(IMG_CHAVE, v); } catch (e) {}
    re();
  };
  const it = $('#imgTroca');
  if (it) it.onclick = () => { try { localStorage.removeItem(IMG_CHAVE); } catch (e) {} re(); };
  $$('[data-cor]').forEach(inp => inp.onchange = () => { m.kit.cores[inp.dataset.cor] = inp.value; Mkt.salva(); re(); });
  const ks = $('#kSalva');
  if (ks) ks.onclick = () => { Object.assign(m.kit, { voz: $('#kVoz').value.trim(), frases: $('#kFrases').value.trim(), proibidas: $('#kProib').value.trim(), hashtags: $('#kHash').value.trim() }); Mkt.salva(); toast(ia('salvo')); };
  const add = $('#mkMemAdd');
  if (add) add.onclick = () => { const v = $('#mkMemIn').value.trim(); if (!v) return; m.memoria.push({ id: uid(), texto: v, criado: hojeIso() }); Mkt.salva(); re(); };
}

/* =====================================================
   ABA ATENDIMENTO — WhatsApp e Instagram (demonstração)
   A resposta é montada NA HORA a partir das vagas reais do app: mude um
   preço ou lote uma data e a resposta muda junto.
===================================================== */
const CLIENTES = [
  { id: 'c1', nome: 'Claire', lang: 'fr', canal: 'whats', tipo: 'disp', pessoas: 3, msg: 'Bonjour ! Vous avez encore de la place samedi pour 3 personnes ?' },
  { id: 'c2', nome: 'Marco', lang: 'it', canal: 'insta', tipo: 'preco', msg: 'Ciao! Quanto costa il servizio fotografico? E quando siete liberi?' },
  { id: 'c3', nome: 'Jonas', lang: 'de', canal: 'whats', tipo: 'semana', pessoas: 2, msg: 'Hallo! Gibt es nächste Woche noch Plätze für 2 Personen?' },
  { id: 'c4', nome: 'Emily', lang: 'en', canal: 'insta', tipo: 'crianca', msg: 'Hi! Is the full day trip OK for kids? We have a 7 year old.' },
  { id: 'c5', nome: 'Lucía', lang: 'es', canal: 'whats', tipo: 'pagar', msg: 'Hola, ¿se puede pagar con tarjeta?' },
  { id: 'c6', nome: 'Mariana', lang: 'pt', canal: 'insta', tipo: 'disp', pessoas: 4, msg: 'Oi! Tem vaga no sábado pra 4 pessoas?' },
];
const tourPorTipo = (tipo) => {
  const ts = Tours.live();
  if (tipo === 'preco') return ts.find(x => x.priceMode === 'session') || ts[0];
  if (tipo === 'crianca') return ts.find(x => /dia|day/i.test(tl(x.name) + (x.name.en || ''))) || ts[1] || ts[0];
  return ts[0];
};
function proximoSabado() { let d = hojeIso(); for (let i = 0; i < 8; i++) { if (new Date(d + 'T12:00:00').getDay() === 6 && i > 0) return d; d = addDays(d, 1); } return d; }
function datasComLugar(x, n, pessoas, de) {
  const out = [];
  for (const d of Cal.departures(x.id, de || hojeIso(), addDays(hojeIso(), 60))) {
    const livres = Cal.seatsLeft(x.id, d.date, d.time, d.capacity);
    if (livres >= (pessoas || 1)) out.push({ ...d, livres });
    if (out.length >= n) break;
  }
  return out;
}
/* a resposta, no idioma pedido (o do cliente ou o do guia) */
function respostaPara(c, lang) {
  return naLingua(lang, () => {
    const x = tourPorTipo(c.tipo); if (!x) return { txt: '—', falta: null };
    const preco = +x.price || 0, fmt = (d) => `${dataLonga(d.date)} ${d.time}`;
    if (c.tipo === 'disp') {
      /* sábado que vem: qualquer passeio com saída nesse dia e lugar para o grupo */
      const sab = proximoSabado();
      const noSab = Tours.live().flatMap(t => Cal.departures(t.id, sab, sab).map(d => ({ ...d, t, livres: Cal.seatsLeft(t.id, d.date, d.time, d.capacity) })));
      const cabe = noSab.find(d => d.livres >= c.pessoas);
      if (cabe) return { txt: ia('aDisp', { nome: c.nome, data: dataLonga(cabe.date), hora: cabe.time, livres: cabe.livres, tour: nomeTour(cabe.t), preco: +cabe.t.price || 0 }) };
      const prox = datasComLugar(x, 1, c.pessoas, addDays(hojeIso(), 1))[0];
      if (!prox) return { txt: '—' };
      return { txt: ia(noSab.length ? 'aDispNao' : 'aDispSem', { nome: c.nome, tour: nomeTour(x), data: dataLonga(prox.date), hora: prox.time, livres: prox.livres }) };
    }
    if (c.tipo === 'preco') return { txt: ia('aPreco', { nome: c.nome, tour: nomeTour(x), preco, modo: ia(x.priceMode === 'session' ? 'porSessao' : 'porPessoa'), datas: datasComLugar(x, 3, 1, addDays(hojeIso(), 1)).map(fmt).join('; ') || '—' }) };
    if (c.tipo === 'semana') {
      const ds = Tours.live().flatMap(t => datasComLugar(t, 2, c.pessoas, addDays(hojeIso(), 1)).filter(d => d.date <= addDays(hojeIso(), 10)).map(d => ({ ...d, t })))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3);
      return { txt: ia('aSemana', { nome: c.nome, n: c.pessoas, datas: ds.map(d => `${nomeTour(d.t)}, ${dataLonga(d.date)} ${d.time}`).join('; ') || '—' }) };
    }
    if (c.tipo === 'crianca') return { txt: ia('aCrianca', { nome: c.nome, tour: nomeTour(x), datas: datasComLugar(x, 2, 1, addDays(hojeIso(), 1)).map(fmt).join('; ') || '—' }), falta: ia('aCriancaFalta') };
    if (c.tipo === 'pagar') return { txt: ia('aPagar', { nome: c.nome, politica: ia(x.payPolicy === 'full' ? 'polTudo' : 'polMetade') }) };
    return { txt: '—' };
  });
}
function conversas() {
  const m = Mkt.get();
  if (!m.conversas) { m.conversas = CLIENTES.slice(0, 5).map(c => ({ id: c.id, estado: 'pendente', hora: null })); Mkt.salva(); }
  return m.conversas;
}
/* o agente respondendo de verdade no Instagram (cofre + Meta) */
function aoVivoCartao() {
  const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
  const ig = cfg.agenteInstagram && cofreEstado.instagram, wa = cfg.agenteWhatsapp && cofreEstado.whatsapp;
  if (!ig && !wa) return '';
  const waFmt = (n) => '+' + n.replace(/^1(\d{3})(\d{3})(\d{4})$/, '1 $1 $2 $3');
  return `<section class="ibVivo">
    <div class="ibVivoTxt"><span class="ibVivoTag"><i></i>${ia('aoVivo')}</span>
      <b>${ia('aoVivoTit')}</b><p>${ia('aoVivoTxt')}</p></div>
    <div class="ibVivoBts">
      ${ig ? `<a class="ibVivoBt ig" href="https://ig.me/m/${encodeURIComponent(cfg.agenteInstagram)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg><span><b>Instagram</b><small>@${esc(cfg.agenteInstagram)}</small></span></a>` : ''}
      ${wa ? `<a class="ibVivoBt wa" href="https://wa.me/${encodeURIComponent(cfg.agenteWhatsapp)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg><span><b>WhatsApp</b><small>${esc(waFmt(cfg.agenteWhatsapp))}</small></span></a>` : ''}
    </div>
    <small class="ibVivoNota">${ia('aoVivoNota')}</small></section>`;
}
let inboxAberta = null, inboxFiltro = 'todas';
const ibCores = ['#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6'];
const ibAvatar = (c) => `<span class="ibAv" style="--av:${ibCores[(parseInt(c.id.slice(1), 10) || 0) % ibCores.length]}">${esc(c.nome[0])}<i class="ibAvCanal ${c.canal === 'whats' ? 'wa' : 'ig'}"></i></span>`;
function admAtendimento(arg) {
  if (ibAba === 'ensinar' && !arg) return admEnsinar();
  const m = Mkt.get(), cs = conversas();
  if (arg) inboxAberta = arg;
  const aberta = cs.find(c => c.id === inboxAberta);
  const cli = (id) => CLIENTES.find(c => c.id === id);
  const canalNome = (c) => c.canal === 'whats' ? 'WhatsApp' : 'Instagram';
  const estadoTxt = (v) => v.estado === 'pendente' ? ia('aguardando') : v.estado === 'auto' ? ia('enviadaAuto') : v.estado === 'descartada' ? ia('descartada') : ia('enviada');
  const visiveis = cs.filter(v => inboxFiltro === 'todas' || cli(v.id).canal === inboxFiltro);
  const nEspera = cs.filter(v => v.estado === 'pendente').length;
  const nFeitas = cs.filter(v => v.estado === 'auto' || v.estado === 'enviada').length;
  const nLinguas = new Set(cs.map(v => cli(v.id).lang)).size;
  const filtros = [['todas', ia('ibTodas')], ['whats', 'WhatsApp'], ['insta', 'Instagram']]
    .map(([k, t]) => `<button class="${inboxFiltro === k ? 'on' : ''}" data-filtro="${k}">${t}</button>`).join('');
  const lista = visiveis.map(v => { const c = cli(v.id); return `<button class="ibItem ${v.id === inboxAberta ? 'on' : ''}" data-conv="${v.id}">
    ${ibAvatar(c)}<span class="ibItemTxt"><span class="ibItemTopo"><b>${esc(c.nome)}</b><small class="ibLang">${c.lang.toUpperCase()}</small>${v.estado === 'pendente' ? '<i class="ibPonto"></i>' : ''}</span>
    <span class="ibPrev">${esc(c.msg)}</span><span class="ibEstado ${v.estado}">${estadoTxt(v)}</span></span></button>`; }).join('')
    || `<p class="ibVazio">—</p>`;
  let detalhe = `<div class="ibNada"><span aria-hidden="true">💬</span><p>${ia('escolha')}</p></div>`;
  if (aberta) {
    const c = cli(aberta.id), r = respostaPara(c, c.lang), trad = c.lang !== LANG ? respostaPara(c, LANG) : null;
    const texto = aberta.texto || r.txt;
    detalhe = `<div class="ibConv">
      <header class="ibTopo"><button class="ibVolta" data-voltar aria-label="${ia('voltar')}">←</button>${ibAvatar(c)}
        <div><b>${esc(c.nome)}</b><small>${canalNome(c)} · ${c.lang.toUpperCase()}</small></div></header>
      <div class="ibFio">
        <div class="ibMsg dele">${esc(c.msg)}</div>
        ${aberta.estado === 'pendente' ? '' : aberta.estado === 'descartada' ? `<p class="ibSis">${ia('descartada')}</p>`
          : `<div class="ibMsg minha">${esc(texto)}</div><p class="ibSis dir">${aberta.estado === 'auto' ? '⚡ ' + ia('enviadaAuto') : '✓ ' + ia('enviada')} · ${esc(aberta.hora || '')}</p>`}
      </div>
      ${aberta.estado === 'pendente' ? `<div class="ibComp">
        <span class="ibCompTag">✦ ${ia('rascunhoIA')}</span>
        <textarea id="ibTxt" rows="4">${esc(texto)}</textarea>
        ${r.falta ? `<p class="ibFalta">${ia('falta')}: ${esc((trad || r).falta)}</p>` : ''}
        ${trad ? `<details class="ibTrad"><summary>${ia('paraVoce')}</summary><p>${esc(trad.txt)}</p></details>` : ''}
        <div class="ibCompBts"><button class="ibBt sec" data-descarta="${c.id}">${ia('descartar')}</button><button class="ibBt" data-aprova="${c.id}">${ia('aprovar')} ↑</button></div></div>` : ''}
    </div>`;
  }
  admShell('inbox', `
    ${ibCabecalho('conversas')}
    <div class="ibModoLinha"><div class="ibModo" role="group"><button class="${m.modoAuto ? '' : 'on'}" data-modo="0">${ia('modoAprovar')}</button><button class="${m.modoAuto ? 'on' : ''}" data-modo="1">⚡ ${ia('modoAuto')}</button></div></div>
    <div class="ibKpis"><div><b>${nEspera}</b><span>${ia('ibEspera')}</span></div><div><b>${nFeitas}</b><span>${ia('ibFeitas')}</span></div><div><b>${nLinguas}</b><span>${ia('ibLinguas')}</span></div></div>
    ${aoVivoCartao()}
    <div class="ibApp ${aberta ? 'comConversa' : ''}">
      <aside class="ibLista"><div class="ibFiltros">${filtros}</div><div class="ibItens">${lista}</div>
        <button class="ibSimula" id="ibSimula">${ia('simular')}</button></aside>
      <section class="ibDetalhe">${detalhe}</section></div>
    <p class="ibRodape">${ia('inboxDemo')}</p>`);
  const agora = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const re = () => admAtendimento();
  ligaAbasIb();
  $$('[data-conv]').forEach(b => b.onclick = () => { inboxAberta = b.dataset.conv; re(); });
  $$('[data-filtro]').forEach(b => b.onclick = () => { inboxFiltro = b.dataset.filtro; re(); });
  const vb = $('[data-voltar]'); if (vb) vb.onclick = () => { inboxAberta = null; re(); };
  $$('[data-aprova]').forEach(b => b.onclick = () => { const v = cs.find(x => x.id === b.dataset.aprova); v.texto = $('#ibTxt').value; v.estado = 'enviada'; v.hora = agora(); Mkt.salva(); re(); });
  $$('[data-descarta]').forEach(b => b.onclick = () => { const v = cs.find(x => x.id === b.dataset.descarta); v.estado = 'descartada'; Mkt.salva(); re(); });
  $$('[data-modo]').forEach(b => b.onclick = () => {
    m.modoAuto = b.dataset.modo === '1';
    /* no automático, o que estava esperando sai sozinho — exceto resposta com dado faltando */
    if (m.modoAuto) cs.forEach(v => { if (v.estado === 'pendente' && !respostaPara(cli(v.id), cli(v.id).lang).falta) { v.estado = 'auto'; v.hora = agora(); } });
    Mkt.salva(); re();
  });
  const sim = $('#ibSimula');
  if (sim) sim.onclick = () => {
    const livre = CLIENTES.find(c => !cs.some(v => v.id === c.id));
    const c = livre || CLIENTES[Math.floor(Math.random() * CLIENTES.length)];
    const v = { id: c.id, estado: 'pendente', hora: null };
    const i = cs.findIndex(x => x.id === c.id); if (i >= 0) cs.splice(i, 1);
    if (m.modoAuto && !respostaPara(c, c.lang).falta) { v.estado = 'auto'; v.hora = agora(); }
    cs.unshift(v); inboxAberta = c.id; inboxFiltro = 'todas'; Mkt.salva(); re();
  };
}

/* ---------- Ensinar o agente (22/09/2026) ----------
   O guia diz como o agente fala, o que responde e quando passa a conversa
   para ele. Passeios, preços e vagas o agente já lê do app (ver_passeios /
   ver_agenda). No app de verdade isto vai para o banco do guia e o cofre usa
   ao responder no WhatsApp/Instagram; no demo, vale para o teste ao lado. */
let ibAba = 'conversas', ensTeste = [], ensOcupado = false;
const ENS_TONS = { simp: 1, formal: 1, leve: 1, direto: 1 };
const ENS_FAQ = ['fqEncontro', 'fqIdade', 'fqCancela', 'fqPaga', 'fqLevar', 'fqChuva'];
const ENS_PASSA = ['hReclama', 'hDesconto', 'hGrupo', 'hEspecial'];
const ENS_EXEMPLOS = ['Onde é o ponto de encontro?', 'Can I bring my 5-year-old?', 'Posso cancelar se chover?', '¿Hacen descuento para grupos?', 'Il reste de la place samedi pour 2 ?'];
function ensino() {
  const m = Mkt.get();
  if (!m.ensino) m.ensino = { tom: 'simp', tomExtra: '', faq: [], nunca: '', passa: ['hReclama', 'hDesconto'] };
  return m.ensino;
}
function ibCabecalho(aba) {
  return `<div class="ibCab"><div><h1 class="pageh">${ia('atendimento')}</h1><p class="ibSub">${ia(aba === 'ensinar' ? 'ensLead' : 'inboxTxt')}</p></div></div>
    <p class="mkExtra">✦ ${ia('extraAviso')}</p>
    <div class="ibAbas" role="tablist"><button role="tab" aria-selected="${aba === 'conversas'}" class="${aba === 'conversas' ? 'on' : ''}" data-ibaba="conversas">💬 ${ia('ibConversas')}</button><button role="tab" aria-selected="${aba === 'ensinar'}" class="${aba === 'ensinar' ? 'on' : ''}" data-ibaba="ensinar">✦ ${ia('ibEnsinar')}</button></div>`;
}
function ligaAbasIb() { $$('[data-ibaba]').forEach(b => b.onclick = () => { ibAba = b.dataset.ibaba; admAtendimento(); }); }
function ensPassos(e) {
  const faqOk = e.faq.filter(f => f.p.trim() && f.r.trim()).length;
  return [['ensP1', !!e.tom], ['ensP2', faqOk >= 3, faqOk + '/3'], ['ensP3', !!(e.nunca.trim() || e.passa.length)], ['ensP4', ensTeste.some(x => x.role === 'assistant')]];
}
/* as instruções do atendente: mesmas regras do cofre + o que o guia ensinou */
function ensSistema() {
  const e = ensino();
  const faq = e.faq.filter(f => f.p.trim() && f.r.trim()).map(f => `Q: ${f.p.trim()}\nA: ${f.r.trim()}`).join('\n\n');
  const passa = e.passa.map(k => IA_TXT[k] ? IA_TXT[k].en : k).join('; ');
  return `You are the virtual assistant of "${guiaNegocio()}" (${guiaNome()}, a tour guide in ${guiaBase() || '—'}), answering clients on WhatsApp and Instagram.

LANGUAGE — most important rule: always reply in the language of the client's LAST message (French → French, Spanish → Spanish, English → English, Portuguese → Portuguese, etc.). Never switch to another language. Translate the guide's answers below into that language.

FACTS: only state what comes from the tools (tours, prices, schedules, seats) or from the guide's answers below. The guide's answers apply to every tour unless they say otherwise. If something is not there (minimum age, whether children can come, discounts, accessibility, policies), do NOT say yes or no — say the guide will confirm shortly. preco_crianca 0 means "not informed". Never invent dates, prices or availability; check ver_agenda for seats.

STYLE: like a WhatsApp chat — up to 4 short sentences, no markdown, no lists. Tone: ${{ simp: 'friendly and warm, like someone from the team', formal: 'formal and polite, no slang', leve: 'light and fun, an emoji now and then', direto: 'straight to the point, short sentences' }[e.tom] || 'friendly'}.${e.tomExtra.trim() ? ' Also, from the guide: ' + e.tomExtra.trim() : ''}
Only talk about tours, dates, prices and bookings. To book, name the tour and say booking is done in the guide's app.
${faq ? '\nTHE GUIDE\'S ANSWERS (use them, translated to the client\'s language):\n' + faq + '\n' : ''}${passa ? '\nHAND OVER: when the message is about ' + passa + ', do not solve it and do not promise anything (neither that it exists nor that it doesn\'t) — kindly say the guide will reply personally soon.\n' : ''}${e.nunca.trim() ? '\nNEVER (from the guide): ' + e.nunca.trim() + '\n' : ''}
Today is ${hojeIso()} (${diaSemanaEn()}).`;
}
async function ensChamar(msgs) {
  const modo = iaModo(), tools = IA_FERRAMENTAS.filter(t => t.name === 'ver_passeios' || t.name === 'ver_agenda');
  const corpo = { max_tokens: 700, system: ensSistema(), tools, messages: msgs };
  const r = modo === 'vivo'
    ? await fetch(COFRE + '/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
    : await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': iaChave(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: IA_MODELO, ...corpo }) });
  const j = await r.json().catch(() => null);
  if (modo === 'vivo' && r.status === 429) marcaEsgotado('claude');
  if (!r.ok) throw new Error('falhou');
  if (modo !== 'vivo') iaSomaGasto(j.usage);
  return j;
}
/* sem Claude (demo sem cofre): responde só com as respostas prontas */
function ensSemIA(txt) {
  const e = ensino(), t = txt.toLowerCase();
  const hit = e.faq.find(f => f.p.trim() && f.r.trim() && f.p.toLowerCase().split(/\W+/).filter(w => w.length > 3).some(w => t.includes(w)));
  return hit ? hit.r : ia('ensNaoSei');
}
async function ensPergunta(txt) {
  if (ensOcupado || !txt.trim()) return;
  ensOcupado = true;
  ensTeste.push({ role: 'user', content: txt.trim() });
  admEnsinar();
  let resp = '';
  try {
    if (iaModo() === 'demo') resp = ensSemIA(txt);
    else {
      const conv = ensTeste.map(x => ({ role: x.role, content: x.content }));
      for (let volta = 0; volta < 4; volta++) {
        const j = await ensChamar(conv);
        conv.push({ role: 'assistant', content: j.content });
        resp = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || resp;
        if (j.stop_reason !== 'tool_use') break;
        conv.push({ role: 'user', content: j.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(iaLeitura(b.name, b.input || {})) })) });
      }
    }
  } catch (err) { resp = ensSemIA(txt); }
  ensTeste.push({ role: 'assistant', content: (resp || ia('ensNaoSei')).replace(/\*\*(.+?)\*\*/g, '$1') });
  ensOcupado = false;
  admEnsinar();
  const f = $('#ensFio'); if (f) f.scrollTop = f.scrollHeight;
}
function admEnsinar() {
  const e = ensino(), passos = ensPassos(e), feitos = passos.filter(x => x[1]).length;
  const usadas = new Set(e.faq.map(f => f.k).filter(Boolean));
  const sugestoes = ENS_FAQ.filter(k => !usadas.has(k)).map(k => `<button class="ensChip add" data-addfaq="${k}">+ ${ia(k)}</button>`).join('');
  const faqs = e.faq.map((f, i) => `<div class="ensFaq">
      <input class="ensFaqP" data-faqp="${i}" value="${esc(f.p)}" placeholder="${ia('ensPergunta')}" aria-label="${ia('ensPergunta')}">
      <textarea data-faqr="${i}" rows="2" placeholder="${ia('ensRespPh')}" aria-label="${ia('ensResposta')}">${esc(f.r)}</textarea>
      <button class="ensX" data-faqx="${i}" aria-label="${ia('descartar')}">×</button></div>`).join('');
  const fio = ensTeste.map(x => `<div class="ibMsg ${x.role === 'user' ? 'dele' : 'minha'}">${esc(x.content)}</div>`).join('')
    + (ensOcupado ? `<div class="ibMsg minha ensDigita"><i></i><i></i><i></i></div>` : '');
  admShell('inbox', `${ibCabecalho('ensinar')}
    <div class="ensProg"><div class="ensBarra"><i style="width:${feitos * 25}%"></i></div>
      <ol>${passos.map(([k, ok, extra]) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : ''}</span>${ia(k)}${!ok && extra ? ` <small>${extra}</small>` : ''}</li>`).join('')}</ol></div>
    <div class="ensGrade">
      <div class="ensForm">
        <section class="ensCard"><h3>${ia('ensTomTit')}</h3>
          <div class="ensChips">${Object.keys(ENS_TONS).map(k => `<button class="ensChip ${e.tom === k ? 'on' : ''}" data-tom="${k}">${ia('tom_' + k)}</button>`).join('')}</div>
          <input id="ensTomExtra" value="${esc(e.tomExtra)}" placeholder="${ia('ensTomPh')}"></section>
        <section class="ensCard"><h3>${ia('ensFaqTit')}</h3><p class="ensSub">${ia('ensFaqSub')}</p>
          ${faqs}
          <div class="ensChips">${sugestoes}<button class="ensChip add" data-addfaq="">+ ${ia('ensOutra')}</button></div></section>
        <section class="ensCard"><h3>${ia('ensLimTit')}</h3>
          <p class="ensSempre">🔒 ${ia('ensSempre')}</p>
          <p class="ensSub">${ia('ensPassaTit')}</p>
          <div class="ensChips">${ENS_PASSA.map(k => `<button class="ensChip ${e.passa.includes(k) ? 'on' : ''}" data-passa="${k}">${e.passa.includes(k) ? '✓ ' : ''}${ia(k)}</button>`).join('')}</div>
          <textarea id="ensNunca" rows="2" placeholder="${ia('ensNuncaPh')}">${esc(e.nunca)}</textarea></section>
        <p class="ensReal">${ia('ensReal')} <span id="ensSalvo" class="ensSalvo"></span></p>
        ${ensAplicarCartao()}
      </div>
      <aside class="ensTeste">
        <header><b>${ia('ensTesteTit')}</b><small>${ia('ensTesteSub')}</small>${ensTeste.length ? `<button class="mkLink" id="ensLimpa">${ia('ensLimpar')}</button>` : ''}</header>
        <div class="ibFio" id="ensFio">${fio || `<div class="ensVazio">${ENS_EXEMPLOS.map(x => `<button class="ensChip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>`}</div>
        ${iaModo() === 'demo' ? `<p class="ensAviso">${ia('ensDemoAviso')}</p>` : ''}
        <form class="ensEnvia" id="ensEnvia"><input id="ensMsg" placeholder="${ia('ensTestePh')}" autocomplete="off" ${ensOcupado ? 'disabled' : ''}><button class="ibBt" ${ensOcupado ? 'disabled' : ''} aria-label="${ia('enviar')}">↑</button></form>
      </aside>
    </div>`);
  ligaAbasIb();
  const salva = () => { Mkt.salva(); const s = $('#ensSalvo'); if (s) { s.textContent = ia('ensSalvo'); clearTimeout(salva.t); salva.t = setTimeout(() => { s.textContent = ''; }, 1500); } };
  const re = () => { Mkt.salva(); admEnsinar(); };
  $$('[data-tom]').forEach(b => b.onclick = () => { e.tom = b.dataset.tom; re(); });
  $$('[data-passa]').forEach(b => b.onclick = () => { const k = b.dataset.passa; e.passa = e.passa.includes(k) ? e.passa.filter(x => x !== k) : [...e.passa, k]; re(); });
  $$('[data-addfaq]').forEach(b => b.onclick = () => { const k = b.dataset.addfaq; e.faq.push({ k, p: k ? ia(k) : '', r: '' }); re(); const r = $$('[data-faqr]').pop(); if (r) (k ? r : $$('[data-faqp]').pop()).focus(); });
  $$('[data-faqx]').forEach(b => b.onclick = () => { e.faq.splice(+b.dataset.faqx, 1); re(); });
  $$('[data-faqp]').forEach(x => x.oninput = () => { e.faq[+x.dataset.faqp].p = x.value; salva(); });
  $$('[data-faqr]').forEach(x => { x.oninput = () => { e.faq[+x.dataset.faqr].r = x.value; salva(); }; x.onblur = () => admEnsinarProg(); });
  const te = $('#ensTomExtra'); if (te) te.oninput = () => { e.tomExtra = te.value; salva(); };
  const nu = $('#ensNunca'); if (nu) { nu.oninput = () => { e.nunca = nu.value; salva(); }; nu.onblur = () => admEnsinarProg(); }
  $$('[data-ex]').forEach(b => b.onclick = () => ensPergunta(b.dataset.ex));
  const li = $('#ensLimpa'); if (li) li.onclick = () => { ensTeste = []; admEnsinar(); };
  const f = $('#ensEnvia'); if (f) f.onsubmit = (ev) => { ev.preventDefault(); const i = $('#ensMsg'); const t = i.value; i.value = ''; ensPergunta(t); };
  const fe = $('#ensFio'); if (fe) fe.scrollTop = fe.scrollHeight;
  const af = $('#ensAplForm'); if (af) af.onsubmit = (ev) => { ev.preventDefault(); const c = $('#ensCodigo').value.trim(); if (c) ensAplicar(c); };
  const tz = $('#ensTrazer'); if (tz) tz.onclick = () => ensTrazer();
}
/* Aplicar no robô de verdade (Instagram do demo): só com o código do dono.
   O código fica só nesta aba do navegador (sessionStorage) e vai no cabeçalho. */
let ensAplMsg = '', ensCofreTemCodigo = null;
/* o cofre já tem o código do dono? (503 = não tem; 401 = tem, e faltou o código) —
   sem código o cartão nem aparece, para não mostrar erro numa demonstração */
function ensSondaCodigo() {
  if (ensCofreTemCodigo !== null || !COFRE) return;
  ensCofreTemCodigo = false;
  fetch(urlEnsino(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(r => { ensCofreTemCodigo = r.status === 401 || r.status === 200; if (ensCofreTemCodigo && $('.ensForm') && !$('.ensApl')) admEnsinar(); }).catch(() => {});
}
function ensAplicarCartao() {
  const conta = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.agenteInstagram;
  ensSondaCodigo();
  if (!COFRE || !conta || !cofreEstado.instagram || !ensCofreTemCodigo) return '';
  let cod = ''; try { cod = sessionStorage.getItem(IA_NS + 'admin_codigo') || ''; } catch (e) {}
  return `<section class="ensCard ensApl"><h3>📲 ${ia('ensAplTit')}</h3><p class="ensSub">${esc(ia('ensAplTxt').replace('{c}', conta))}</p>
    <form id="ensAplForm" class="ensAplLinha"><input type="password" id="ensCodigo" value="${esc(cod)}" placeholder="${ia('ensCodigo')}" autocomplete="current-password" aria-label="${ia('ensCodigo')}">
      <button class="ibBt" type="submit">${ia('ensAplBt')}</button></form>
    <button class="mkLink" id="ensTrazer" type="button">↓ ${ia('ensTrazer')}</button>
    ${ensAplMsg ? `<p class="ensAplMsg">${ensAplMsg}</p>` : ''}</section>`;
}
async function ensAplicar(codigo) {
  try { sessionStorage.setItem(IA_NS + 'admin_codigo', codigo); } catch (e) {}
  const e = ensino();
  let r; try { r = await fetch(urlEnsino(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-codigo': codigo }, body: JSON.stringify({ ensino: e }) }); } catch (x) { r = null; }
  const hora = new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  ensAplMsg = r && r.ok ? '✓ ' + ia('ensAplOk') + ' (' + hora + ')' : r && r.status === 401 ? '⚠ ' + ia('ensAplErro') : r && r.status === 503 ? '⚠ ' + ia('ensAplSem') : '⚠ ' + ia('ensAplFalhou');
  if (r && r.status === 401) try { sessionStorage.removeItem(IA_NS + 'admin_codigo'); } catch (x) {}
  admEnsinar();
}
async function ensTrazer() {
  try {
    const j = await fetch(urlEnsino(), { cache: 'no-store' }).then(r => r.json());
    if (j && j.ensino) { const m = Mkt.get(); m.ensino = { ...ensino(), ...j.ensino, faq: j.ensino.faq.map(f => ({ k: '', p: f.p, r: f.r })) }; Mkt.salva(); ensAplMsg = '✓ ' + ia('ensTrouxe'); }
    else ensAplMsg = ia('ensNadaNoAr');
  } catch (x) { ensAplMsg = '⚠ ' + ia('ensAplFalhou'); }
  admEnsinar();
}
/* atualiza só a barra de progresso (sem redesenhar e perder o foco) */
function admEnsinarProg() {
  const box = $('.ensProg'); if (!box) return;
  const passos = ensPassos(ensino()), feitos = passos.filter(x => x[1]).length;
  box.querySelector('.ensBarra i').style.width = feitos * 25 + '%';
  box.querySelectorAll('li').forEach((li, i) => { li.classList.toggle('ok', passos[i][1]); li.querySelector('span').textContent = passos[i][1] ? '✓' : ''; });
}

/* =====================================================
   GAVETA DO ASSISTENTE
===================================================== */
const IA_CSS = `
#iaFab{position:fixed;right:18px;bottom:18px;z-index:900;display:none;align-items:center;gap:8px;padding:12px 18px;border:0;border-radius:999px;
  background:var(--accent,#064c3f);color:#fff;font:600 15px var(--f-ui,system-ui);box-shadow:0 6px 20px rgba(0,0,0,.22);cursor:pointer}
#iaFab.on{display:flex}
body:has(.coach) #iaFab{display:none!important}
.iaExtra{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:99px;background:var(--highlight,#FFD23F);color:#1b1b1b;margin-left:4px;vertical-align:middle}
.iaDemoExtra{display:block;margin-top:8px;font-weight:600;color:var(--ink,#222)}
.mkExtra{margin:-4px 0 14px;font-size:13px;font-weight:600;color:var(--ink-2)} #iaFab .dot{width:9px;height:9px;border-radius:50%;background:var(--highlight,#FFD23F)}
#iaGaveta{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:950;display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#222);
  box-shadow:-8px 0 30px rgba(0,0,0,.18);transform:translateX(105%);transition:transform .22s ease;font-family:var(--f-ui,system-ui)}
#iaGaveta.aberta{transform:none}
body.iaSolta #iaGaveta{outline:3px dashed var(--accent,#064c3f);outline-offset:-6px}
body.iaSolta #iaGaveta::after{content:'Solta aqui — vai pro assistente';position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:rgba(6,76,63,.10);font-weight:800;pointer-events:none}
#iaGaveta header{display:flex;align-items:center;gap:12px;padding:12px 8px 12px 16px;border-bottom:1px solid var(--line,#e5e5e5)}
#iaGaveta .iaAv{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--accent,#064c3f);color:#fff;font-size:16px}
#iaGaveta .iaCab{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#iaGaveta header b{font-size:15.5px;display:flex;align-items:center;gap:8px}
.iaModo{font:700 10.5px var(--f-ui);letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:var(--surface-2,#f1efec);color:var(--ink-2,#555)}
#iaCtx{font-size:12px;color:var(--ink-3,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#iaCtx:empty{display:none}
#iaGaveta .x{border:0;background:none;font-size:24px;line-height:1;cursor:pointer;color:var(--ink-3,#888);min-width:44px;min-height:44px;border-radius:50%}
#iaGaveta .x:hover{background:var(--surface-2,#f1efec);color:inherit}
#iaMsgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;background:var(--surface-2,#f7f5f2)}
.iaB{position:relative;max-width:86%;padding:11px 14px;border-radius:18px;font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.iaB img{display:block;max-width:100%;border-radius:12px;margin-bottom:6px}
.iaFotos{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:4px;margin-bottom:6px} .iaFotos img{margin:0;aspect-ratio:1;object-fit:cover;width:100%}
.iaB.user{align-self:flex-end;background:var(--accent,#064c3f);color:#fff;border-bottom-right-radius:6px}
.iaB.assistant{align-self:flex-start;background:var(--surface,#fff);border-bottom-left-radius:6px}
.iaB.pensa{align-self:flex-start;color:var(--ink-3,#888);font-style:italic;background:none;box-shadow:none;padding:4px 2px}
.iaB.erro{align-self:stretch;background:var(--danger-wash,#fde8e8);color:var(--danger,#a00);box-shadow:none}
.iaB .cp{display:flex;width:fit-content;margin:10px 0 0 auto;align-items:center;gap:5px;border:1px solid var(--line,#e2e0dc);background:none;color:var(--ink-2,#555);font:600 12px var(--f-ui);cursor:pointer;padding:5px 11px;border-radius:999px}
.iaB .cp:hover{border-color:var(--accent,#064c3f);color:var(--accent,#064c3f)}
.iaDemo{align-self:stretch;border:1px dashed var(--line-2,#ccc);border-radius:14px;padding:12px 14px;font-size:13.5px;line-height:1.45;color:var(--ink-2,#555)}
.iaDemo b{display:block;margin-bottom:4px;color:var(--ink,#222)}
.iaSug{align-self:stretch;display:flex;flex-direction:column;gap:6px}
.iaSug small{color:var(--ink-3,#888)}
.iaSug button{text-align:left;min-height:44px;padding:10px 13px;border-radius:14px;border:1px solid var(--line,#ddd);background:var(--surface,#fff);color:inherit;font:14px var(--f-ui);cursor:pointer}
.iaSug button:hover{border-color:var(--accent,#064c3f)}
.iaCard{align-self:stretch;border:2px solid var(--highlight,#FFD23F);border-radius:16px;padding:14px;background:var(--surface,#fff)}
.iaCard h4{margin:0 0 8px;font-size:15px}
.iaCard dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px}
.iaCard dt{color:var(--ink-3,#777)} .iaCard dd{margin:0;font-weight:600;white-space:pre-wrap}
.iaCard .ass{margin:8px 0 0;font-size:12.5px;color:var(--ink-3,#777)}
.iaCard .bts{display:flex;gap:8px;margin-top:12px}
.iaCard .bts button,.iaChave button{flex:1;min-height:44px;border-radius:12px;border:1px solid var(--line,#ddd);background:var(--surface,#fff);font:600 14.5px var(--f-ui);cursor:pointer;color:inherit}
.iaCard .bts .sim,.iaChave .sim{background:var(--accent,#064c3f);color:#fff;border-color:transparent}
.iaCard.feito{border-color:var(--line,#ddd);opacity:.75}
#iaForm{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#e5e5e5);align-items:flex-end;background:var(--surface,#fff)}
#iaTxt{flex:1;min-width:0;resize:none;min-height:44px;max-height:140px;padding:11px 16px;border:1px solid var(--line,#ddd);border-radius:22px;font:15px var(--f-ui);background:var(--surface-2,#f7f5f2);color:inherit;box-sizing:border-box}
#iaTxt:focus{outline:2px solid color-mix(in srgb,var(--accent,#064c3f) 40%,transparent);outline-offset:1px}
#iaEnviar{flex:none;width:44px;height:44px;border:0;border-radius:50%;background:var(--accent,#064c3f);color:#fff;font-size:19px;line-height:1;cursor:pointer;display:grid;place-items:center}
#iaEnviar:disabled{opacity:.45}
#iaClip{flex:none;width:44px;height:44px;border:1px solid var(--line,#ddd);border-radius:50%;background:none;color:var(--ink-3,#888);cursor:pointer;display:grid;place-items:center;transition:color .12s,border-color .12s}
#iaClip:hover{color:var(--accent,#064c3f);border-color:var(--accent,#064c3f)}
#iaAnexo{display:none;padding:0 12px 6px;font-size:12.5px;color:var(--ink-3,#888)} #iaAnexo.on{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#iaAnexo img{height:44px;width:44px;object-fit:cover;border-radius:8px;margin-right:2px} #iaAnexo button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}
#iaPe{display:flex;flex-wrap:wrap;gap:8px 14px;justify-content:space-between;align-items:center;padding:8px 16px calc(10px + env(safe-area-inset-bottom));font-size:12px;color:var(--ink-3,#888);border-top:1px solid var(--line,#eee);background:var(--surface,#fff)}
#iaPe button{border:0;background:none;color:var(--ink-2,#555);cursor:pointer;font:600 12px var(--f-ui);padding:6px 0;text-decoration:underline;text-underline-offset:3px}
#iaPe label{display:flex;gap:7px;align-items:center;cursor:pointer;line-height:1.3}
#iaPe input[type=checkbox]{width:16px;height:16px;flex:none;accent-color:var(--accent,#064c3f)}
#iaGasto{font-variant-numeric:tabular-nums;white-space:nowrap}
.iaChave{padding:18px 16px;display:flex;flex-direction:column;gap:10px;font-size:14.5px;line-height:1.45;overflow-y:auto}
.iaChave input{min-height:44px;padding:10px 12px;border:1px solid var(--line,#ddd);border-radius:10px;font:14px var(--f-mono,monospace);background:var(--surface,#fff);color:inherit}
.iaChave ol{margin:0;padding-left:20px} .iaChave .volta{background:none;border:0;text-decoration:underline;flex:none}
@media (max-width:640px){#iaGaveta{width:100vw} .iaB{max-width:90%}}
.mkHead{display:flex;gap:12px;align-items:center;flex-wrap:wrap} .mkLead{margin:0;flex:1 1 240px}
.mkNav{display:flex;gap:10px;align-items:center;flex:1} .mkNav b{min-width:170px;text-align:center}
.mkDia{display:flex;gap:16px;align-items:flex-start}
.mkData{display:flex;flex-direction:column;align-items:center;min-width:44px} .mkData b{font-size:22px;line-height:1} .mkData small{color:var(--ink-3)}
.mkItens{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.mkVaga{font-size:13.5px;color:var(--warn,#b7791f)}
.mkPost{border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.mkPost summary{cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap;list-style:none}
.mkPost.postado{opacity:.6}
.mkFmt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:99px;background:var(--surface-2)}
.mkSit{margin-left:auto;font-size:12px;color:var(--ink-3)}
.mkTxt{white-space:pre-wrap;font:14px/1.5 var(--f-ui);background:var(--surface-2);padding:10px 12px;border-radius:8px;margin:8px 0}
.mkBts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.mkNota{margin:0 0 10px;color:var(--ink-3);font-size:13.5px}
.mkGrade{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.mkCriativo canvas{width:100%;height:auto;border-radius:10px;display:block;background:var(--surface-2)}
.mkCriativo small{display:block;margin-top:6px;color:var(--ink-3)}
.mkAnTopo{display:flex;gap:10px;align-items:center;margin-bottom:8px}
.mkDl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0 0 10px;font-size:14px} .mkDl dt{color:var(--ink-3)} .mkDl dd{margin:0}
.mkVersao{border-top:1px solid var(--line);padding-top:8px;margin-top:8px} .mkVersao small{display:block;color:var(--ink-3)}
.mkH{margin:0 0 10px;font-size:16px}
.mkCores{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
.mkCores label{display:flex;flex-direction:column;gap:4px;cursor:pointer} .mkCores input{width:100%;height:56px;border:0;border-radius:10px;padding:0;background:none;cursor:pointer}
.mkCores small{color:var(--ink-3)}
.mkForm{display:flex;flex-direction:column;gap:12px} .mkForm textarea,.mkForm input{width:100%}
.mkFotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.mkGera{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:6px}
.mkGera textarea,.mkGera input{flex:1 1 240px;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:inherit;font:14px var(--f-ui)}
.mkGera select{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:inherit;padding:0 10px}
.mkSeloIA{position:absolute;left:4px;bottom:4px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:99px;background:rgba(0,0,0,.7);color:#fff}
.mkFotos div{position:relative} .mkFotos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block} .mkFotos button{position:absolute;top:4px;right:4px}
/* ---- aba Atendimento (22/09/2026): caixa de entrada limpa ---- */
.ibCab{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:6px}
.ibSub{margin:4px 0 0;color:var(--ink-3);font-size:14px;max-width:560px;line-height:1.5}
.ibModo{display:inline-flex;padding:3px;border-radius:999px;background:var(--surface-2);gap:2px;flex:none}
.ibModo button{padding:8px 14px;border:0;border-radius:999px;background:none;color:var(--ink-2);font:600 13px var(--f-ui);cursor:pointer;min-height:36px;transition:background .15s,color .15s}
.ibModo button.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ibKpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 14px}
.ibKpis div{padding:12px 14px;border-radius:14px;border:1px solid var(--line);display:flex;flex-direction:column;gap:2px}
.ibKpis b{font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums} .ibKpis span{font-size:12.5px;color:var(--ink-3)}
.ibVivo{display:grid;grid-template-columns:1fr auto;gap:10px 20px;align-items:center;padding:16px 18px;margin:0 0 14px;border-radius:16px;border:1px solid color-mix(in srgb,#16a34a 35%,var(--line));background:color-mix(in srgb,#16a34a 7%,transparent)}
.ibVivoTxt b{display:block;font-size:15.5px;margin:4px 0 2px} .ibVivoTxt p{margin:0;font-size:13.5px;color:var(--ink-2);line-height:1.45;max-width:520px}
.ibVivoNota{grid-column:1/-1;font-size:12px;color:var(--ink-3);line-height:1.4}
.ibVivoTag{display:inline-flex;align-items:center;gap:6px;font:700 11px var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:#16a34a}
.ibVivoTag i{width:7px;height:7px;border-radius:50%;background:#16a34a;animation:ibPulsa 1.6s infinite}
@keyframes ibPulsa{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}70%{box-shadow:0 0 0 7px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
.ibVivoBts{display:flex;gap:8px;flex-wrap:wrap}
.ibVivoBt{display:inline-flex;align-items:center;gap:10px;padding:9px 16px 9px 12px;border-radius:14px;color:#fff;text-decoration:none;font:13px var(--f-ui);line-height:1.2;transition:transform .12s}
.ibVivoBt:hover{transform:translateY(-1px)} .ibVivoBt span{display:flex;flex-direction:column} .ibVivoBt b{font-size:13.5px} .ibVivoBt small{opacity:.85;font-size:11.5px}
.ibVivoBt.ig{background:linear-gradient(45deg,#f09433,#dc2743 55%,#bc1888)} .ibVivoBt.wa{background:#1fa855}
.ibApp{display:grid;grid-template-columns:minmax(250px,320px) 1fr;height:min(620px,72vh);border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--surface)}
.ibLista{display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0}
.ibFiltros{display:flex;gap:6px;padding:12px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.ibFiltros button{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--ink-2);font:600 12.5px var(--f-ui);cursor:pointer;white-space:nowrap}
.ibFiltros button.on{background:var(--ink);border-color:var(--ink);color:var(--surface)}
.ibItens{flex:1;overflow-y:auto;padding:6px}
.ibItem{display:flex;gap:12px;width:100%;text-align:left;padding:10px;border:0;border-radius:12px;background:none;color:inherit;cursor:pointer;font:14px var(--f-ui);transition:background .12s}
.ibItem:hover{background:var(--surface-2)} .ibItem.on{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.ibItemTxt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ibItemTopo{display:flex;align-items:center;gap:6px}
.ibPonto{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-left:auto}
.ibPrev{color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.ibEstado{font-size:11.5px;color:var(--ink-3)} .ibEstado.pendente{color:var(--accent);font-weight:600}
.ibLang{font-size:10px;padding:1px 6px;border-radius:6px;background:var(--surface-2);color:var(--ink-3);font-weight:700;letter-spacing:.05em}
.ibAv{position:relative;flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--av);color:#fff;font:700 15px var(--f-ui)}
.ibAvCanal{position:absolute;right:-2px;bottom:-2px;width:15px;height:15px;border-radius:50%;border:2px solid var(--surface)}
.ibAvCanal.wa{background:#22c55e} .ibAvCanal.ig{background:linear-gradient(45deg,#f09433,#dc2743,#bc1888)}
.ibSimula{margin:8px 12px 12px;padding:10px;border-radius:12px;border:1px dashed var(--line);background:none;color:var(--ink-2);font:600 13px var(--f-ui);cursor:pointer}
.ibVazio{padding:20px;text-align:center;color:var(--ink-3)}
.ibDetalhe{display:flex;flex-direction:column;min-height:0;min-width:0}
.ibNada{flex:1;display:grid;place-content:center;justify-items:center;gap:6px;color:var(--ink-3);padding:30px} .ibNada span{font-size:30px;opacity:.6} .ibNada p{margin:0}
.ibConv{display:flex;flex-direction:column;height:100%;min-height:0}
.ibTopo{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
.ibTopo b{display:block;font-size:15px} .ibTopo small{color:var(--ink-3);font-size:12.5px}
.ibVolta{display:none;place-items:center;width:34px;height:34px;border-radius:50%;border:0;background:var(--surface-2);color:inherit;font-size:16px;cursor:pointer}
.ibFio{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:8px;background:var(--surface-2)}
.ibMsg{max-width:78%;padding:10px 14px;border-radius:18px;font-size:14.5px;line-height:1.45;white-space:pre-wrap}
.ibMsg.dele{background:var(--surface);border-bottom-left-radius:6px;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.ibMsg.minha{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:6px}
.ibSis{margin:0;font-size:12px;color:var(--ink-3)} .ibSis.dir{text-align:right}
.ibComp{padding:12px 16px 14px;border-top:1px solid var(--line);background:var(--surface)}
.ibCompTag{font:700 11px var(--f-ui);letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.ibComp textarea{width:100%;margin-top:8px;min-height:96px;font:14.5px/1.5 var(--f-ui);padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);color:inherit;resize:vertical}
.ibComp textarea:focus{outline:2px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:1px}
.ibFalta{margin:8px 0 0;font-size:13px;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,#f59e0b 14%,transparent);color:var(--ink)}
.ibTrad{margin-top:8px;font-size:13px} .ibTrad summary{cursor:pointer;color:var(--ink-3)} .ibTrad p{margin:6px 0 0;color:var(--ink-2)}
.ibCompBts{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.ibBt{padding:10px 18px;border-radius:999px;border:0;background:var(--accent);color:#fff;font:600 13.5px var(--f-ui);cursor:pointer;min-height:40px}
.ibBt.sec{background:none;color:var(--ink-2);border:1px solid var(--line)}
.ibRodape{margin:12px 0 0;text-align:center;font-size:12.5px;color:var(--ink-3)}
.ibAbas{display:flex;gap:4px;margin:4px 0 16px;border-bottom:1px solid var(--line)}
.ibAbas button{padding:10px 14px;border:0;background:none;color:var(--ink-3);font:600 14px var(--f-ui);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.ibAbas button.on{color:var(--ink);border-bottom-color:var(--accent)}
.ibModoLinha{display:flex;justify-content:flex-end;margin:-4px 0 12px}
.ensProg{margin:0 0 16px} .ensBarra{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden} .ensBarra i{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width .3s}
.ensProg ol{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;padding:0;margin:10px 0 0;font-size:13px;color:var(--ink-3)}
.ensProg li{display:flex;align-items:center;gap:6px} .ensProg li span{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;font-size:11px;color:#fff}
.ensProg li.ok{color:var(--ink)} .ensProg li.ok span{background:#16a34a;border-color:#16a34a} .ensProg small{color:var(--accent);font-weight:600}
.ensGrade{display:grid;grid-template-columns:1fr minmax(300px,380px);gap:16px;align-items:start}
.ensForm{display:flex;flex-direction:column;gap:14px;min-width:0}
.ensCard{border:1px solid var(--line);border-radius:16px;padding:16px 18px;background:var(--surface)}
.ensCard h3{margin:0 0 10px;font-size:15.5px} .ensSub{margin:-4px 0 10px;font-size:13px;color:var(--ink-3)}
.ensCard input,.ensCard textarea{width:100%;font:14px/1.45 var(--f-ui);padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:inherit;box-sizing:border-box}
.ensCard input:focus,.ensCard textarea:focus,.ensEnvia input:focus{outline:2px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:1px}
.ensChips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.ensChip{padding:8px 13px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--ink-2);font:600 13px var(--f-ui);cursor:pointer;min-height:36px;text-align:left}
.ensChip.on{background:var(--accent);border-color:var(--accent);color:#fff} .ensChip.add{border-style:dashed}
.ensFaq{position:relative;display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:14px;background:var(--surface-2);margin-bottom:10px}
.ensFaq .ensFaqP{font-weight:600;background:var(--surface);padding-right:36px} .ensFaq textarea{background:var(--surface)}
.ensX{position:absolute;top:14px;right:16px;width:26px;height:26px;border-radius:50%;border:0;background:none;color:var(--ink-3);font-size:18px;cursor:pointer}
.ensSempre{margin:0 0 12px;font-size:13px;padding:9px 12px;border-radius:10px;background:var(--surface-2);color:var(--ink-2)}
.ensReal{margin:0;font-size:12.5px;color:var(--ink-3)} .ensSalvo{color:#16a34a;font-weight:600}
.ensApl{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.ensAplLinha{display:flex;gap:8px;margin-bottom:6px} .ensAplLinha input{flex:1;min-width:0}
.ensAplMsg{margin:6px 0 0;font-size:13px;font-weight:600}
.ensTeste{position:sticky;top:16px;display:flex;flex-direction:column;height:min(600px,75vh);border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--surface)}
.ensTeste header{display:grid;grid-template-columns:1fr auto;gap:0 8px;padding:12px 16px;border-bottom:1px solid var(--line)} .ensTeste header small{grid-column:1;color:var(--ink-3);font-size:12.5px} .ensTeste header .mkLink{grid-column:2;grid-row:1/3;padding:0}
.ensVazio{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:auto 0 0} .ensVazio .ensChip{background:var(--surface);font-weight:500}
.ensAviso{margin:0;padding:8px 14px;font-size:12px;color:var(--ink-3);border-top:1px solid var(--line)}
.ensEnvia{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}
.ensEnvia input{flex:1;min-width:0;font:14.5px var(--f-ui);padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:inherit}
.ensEnvia .ibBt{width:42px;padding:0;font-size:17px}
.ensDigita{display:flex;gap:4px;padding:14px 16px} .ensDigita i{width:6px;height:6px;border-radius:50%;background:#fff;opacity:.5;animation:ensPonto 1s infinite} .ensDigita i:nth-child(2){animation-delay:.15s} .ensDigita i:nth-child(3){animation-delay:.3s}
@keyframes ensPonto{50%{opacity:1;transform:translateY(-2px)}}
@media (max-width:900px){.ensGrade{grid-template-columns:1fr} .ensTeste{position:static;height:520px}}
/* ---- Marketing: início limpo (22/09/2026) ---- */
.agora{padding:20px;border-radius:20px;margin:0 0 22px;border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 14%,transparent),transparent 70%)}
.agoraTag{font:700 11px var(--f-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--accent)}
.agoraTopo{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-top:8px}
.agoraTopo h2{margin:0;font-size:22px;line-height:1.25} .agoraTopo p{margin:4px 0 0;color:var(--ink-2);font-size:14px;text-transform:capitalize}
.agoraNum{text-align:right;flex:none} .agoraNum b{display:block;font:800 40px/1 var(--f-display,inherit);color:var(--accent)} .agoraNum small{font-size:12px;color:var(--ink-3)}
.agoraSub{margin:16px 0 10px;font-size:13.5px;color:var(--ink-2)}
.divOps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.divOp{display:flex;flex-direction:column;gap:3px;text-align:left;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;font:inherit;transition:border-color .12s,transform .12s}
.divOp:hover{border-color:var(--accent);transform:translateY(-1px)} .divOp b{font-size:14.5px} .divOp small{font-size:12px;color:var(--ink-3);line-height:1.35}
.mkSec{margin:0 0 22px} .mkSecTopo{display:flex;justify-content:space-between;align-items:center}
.mkSecTit{margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
.mkVazio{margin:0;padding:16px;border-radius:14px;border:1px dashed var(--line);color:var(--ink-3);font-size:13.5px}
.vagas2{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.vaga2+.vaga2{border-top:1px solid var(--line)}
.vaga2 summary{display:grid;grid-template-columns:44px 1fr auto auto;align-items:center;gap:14px;padding:12px 16px;cursor:pointer;list-style:none}
.vaga2 summary::-webkit-details-marker{display:none}
.vaga2 summary:hover{background:var(--surface-2)}
.vaga2Data{text-align:center} .vaga2Data b{display:block;font:800 20px/1 var(--f-display,inherit)} .vaga2Data small{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.vaga2Info{min-width:0} .vaga2Info b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .vaga2Info small{font-size:12.5px;color:var(--ink-3)}
.vaga2Livres{font:700 15px var(--f-ui);text-align:right} .vaga2Livres small{display:block;font:500 11px var(--f-ui);color:var(--ink-3)}
.vaga2Bt{padding:8px 14px;border-radius:999px;background:var(--surface-2);font:600 13px var(--f-ui);white-space:nowrap}
.vaga2[open] .vaga2Bt{background:var(--accent);color:#fff}
.vaga2 .divOps{padding:0 16px 14px}
.mkKpis button{text-align:left;background:none;color:inherit;cursor:pointer;font:inherit} .mkKpis button:hover{border-color:var(--accent)}
@media (max-width:640px){.divOps{grid-template-columns:1fr} .agoraTopo h2{font-size:19px} .agoraNum b{font-size:32px} .vaga2 summary{grid-template-columns:40px 1fr auto;gap:10px} .vaga2Livres{display:none}}
/* ---- Marketing v3: a semana (22/09/2026) ---- */
.mkVolta{display:flex;align-items:center;gap:14px;margin:14px 0 16px;padding-bottom:12px;border-bottom:1px solid var(--line)} .mkVolta b{font-size:16px}
.pcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.pc{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--surface)}
.pc.feito{opacity:.7}
.pcImg{position:relative;aspect-ratio:1/1;background:var(--surface-2) center/cover no-repeat;display:flex;align-items:flex-end;padding:14px}
.pc.story .pcImg{aspect-ratio:4/5}
.pcImg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.72))}
.pcFmt{position:absolute;top:10px;left:10px;z-index:1;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:700 11px var(--f-ui);letter-spacing:.04em;text-transform:uppercase}
.pcTit{position:relative;z-index:1;color:#fff;font-size:16px;line-height:1.25;text-shadow:0 1px 3px rgba(0,0,0,.4)}
.pcCorpo{display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px;flex:1}
.pcQuando{font-size:12px;color:var(--ink-3);text-transform:capitalize} .pcOk{color:#16a34a;font-weight:700;text-transform:none}
.pcLeg{margin:0;font-size:13.5px;line-height:1.45;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
.pcBts{display:flex;gap:8px;align-items:center;margin-top:auto}
.pcBts .ibBt{min-height:38px;padding:8px 16px}
.pcCopia{border:0;background:none;color:var(--ink-2);font:600 13px var(--f-ui);cursor:pointer;padding:8px 4px;text-decoration:underline;text-underline-offset:3px}
.mk .mkTopo{margin-bottom:22px}
.pcX{margin-left:auto;width:32px;height:32px;border-radius:50%;border:0;background:none;color:var(--ink-3);font-size:18px;cursor:pointer}
.mkVazioGrande{display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 16px;border:1px dashed var(--line);border-radius:18px;text-align:center} .mkVazioGrande p{margin:0;color:var(--ink-2)}
.sugs{display:flex;flex-direction:column;gap:8px}
.sug{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;border:1px solid color-mix(in srgb,#f59e0b 35%,var(--line));background:color-mix(in srgb,#f59e0b 7%,transparent)}
.sugData{text-align:center} .sugData b{display:block;font:800 20px/1 var(--f-display,inherit)} .sugData small{font-size:10.5px;color:var(--ink-3);text-transform:uppercase}
.sugTxt b{display:block;font-size:14.5px} .sugTxt small{font-size:12.5px;color:var(--ink-3)}
.ferr{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.ferr button{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:14px;border-radius:14px;border:1px solid var(--line);background:none;color:inherit;cursor:pointer;font:inherit;text-align:left}
.ferr button:hover{border-color:var(--accent)} .ferr span{font-size:20px} .ferr b{font-size:14px} .ferr small{font-size:12px;color:var(--ink-3);line-height:1.35}
@media (max-width:760px){.ferr{grid-template-columns:1fr 1fr} .pcs{grid-template-columns:1fr} .sug{grid-template-columns:40px 1fr} .sug .ibBt{grid-column:1/-1}}
/* ---- aba Marketing (21/09/2026) ---- */
.mk{padding-bottom:96px}
.mkTopo{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
.mkTitulo h1{margin:0;display:flex;align-items:center;gap:10px}
.mkTitulo p{margin:6px 0 0;color:var(--ink-2);font-size:15px;line-height:1.45}
.mkAbas{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;margin:18px 0 18px;border-bottom:1px solid var(--line)}
.mkAbas::-webkit-scrollbar{display:none}
.mkAbas button{flex:none;display:flex;align-items:center;gap:7px;padding:11px 14px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--ink-3);font:600 14px var(--f-ui);cursor:pointer;min-height:44px}
.mkAbas button.on{color:var(--ink);border-bottom-color:var(--accent)}
.mkBloco{background:var(--surface);border-radius:var(--r-lg,16px);padding:18px;margin-bottom:16px;box-shadow:var(--sh-1)}
.mkBlocoTopo{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}
.mkBlocoTopo h2{margin:0;font-size:17px} .mkBlocoTopo h3{margin:0;font-size:15px}
.mkLink{border:0;background:none;color:var(--accent);font:600 13.5px var(--f-ui);cursor:pointer;padding:8px 0}
.vagas{display:grid;gap:10px;margin-top:10px}
.vaga{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2)}
.vagaData{text-align:center} .vagaData b{display:block;font:800 24px/1 var(--f-display,inherit)} .vagaData small{color:var(--ink-3);text-transform:uppercase;font-size:11px;letter-spacing:.05em}
.vagaInfo{min-width:0} .vagaInfo b{display:block;font-size:15px} .vagaInfo small{color:var(--ink-2);font-size:13px}
.vagaBarra{height:6px;border-radius:99px;background:var(--line);margin-top:8px;overflow:hidden} .vagaBarra i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.vagaAcoes{display:flex;gap:6px}
.vagaAcoes button{min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 13px var(--f-ui);cursor:pointer;white-space:nowrap}
.vagaAcoes button:hover,.novo:hover,.stat:hover{border-color:var(--accent)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.stat{text-align:left;padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);cursor:pointer;font:inherit}
.stat b{display:block;font:800 28px/1.1 var(--f-display,inherit)} .stat span{font-size:13px;color:var(--ink-2)}
.posts{margin-top:4px}
.post{--fc:#14B8A6;border:1px solid var(--line);border-left:4px solid var(--fc);border-radius:12px;padding:10px 12px;margin-top:8px;background:var(--surface)}
.post.f-reel{--fc:#8B5CF6} .post.f-story{--fc:#F59E0B} .post.f-post{--fc:#14B8A6} .post.f-carrossel{--fc:#3B82F6}
.post summary{display:flex;gap:10px;align-items:center;cursor:pointer;list-style:none} .post summary::-webkit-details-marker{display:none}
.post.postado{opacity:.6}
.postIco{font-size:20px} .postTxt{flex:1;min-width:0} .postTxt b{display:block;font-size:14.5px;line-height:1.35} .postTxt small{color:var(--ink-3);font-size:12.5px}
.postSit{flex:none;font:600 11.5px var(--f-ui);padding:3px 9px;border-radius:99px;background:var(--surface-2);color:var(--ink-2)}
.postSit.s-pronto{background:rgba(20,184,166,.18)} .postSit.s-postado{background:rgba(34,197,94,.2);color:var(--ok,#16a34a)}
.mkMesNav{display:flex;align-items:center;justify-content:center;gap:12px;margin:0 0 14px} .mkMesNav b{min-width:170px;text-align:center;font-size:16px}
.dia{display:flex;gap:14px;padding:10px 0;border-top:1px solid var(--line)} .mkBlocoTopo + .dia{border-top:0}
.diaData{min-width:44px;text-align:center} .diaData b{display:block;font:800 20px/1 var(--f-display,inherit)} .diaData small{color:var(--ink-3);font-size:11px;text-transform:uppercase}
.diaItens{flex:1;min-width:0} .diaVaga{font-size:13px;color:var(--warn,#b7791f)}
.novos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.novo{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:16px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);text-align:left;cursor:pointer;font:inherit}
.novo span{font-size:26px;margin-bottom:4px} .novo b{font-size:15px} .novo small{color:var(--ink-3);font-size:12.5px}
.criativo{margin:0;background:var(--surface-2);border-radius:14px;padding:10px}
.criativo canvas{width:100%;height:auto;border-radius:10px;display:block;background:var(--surface-3,#222)}
.criativo figcaption{margin:8px 2px 0} .criativo figcaption b{display:block;font-size:14px} .criativo figcaption small{color:var(--ink-3);font-size:12px}
.anuncio{display:grid;grid-template-columns:140px 1fr;overflow:hidden;border-radius:var(--r-lg,16px);background:var(--surface);margin-bottom:16px;box-shadow:var(--sh-1)}
.anFoto{background-size:cover;background-position:center;min-height:100%}
.anCorpo{padding:16px 18px} .anTopo{display:flex;gap:10px;align-items:center;justify-content:space-between}
.anVerba{margin:8px 0 12px} .anVerba b{display:block;font:800 26px/1.1 var(--f-display,inherit)} .anVerba span{font-size:13px;color:var(--ink-3)}
.mkVersao p{margin:4px 0 0;font-size:14px;line-height:1.45}
.fontes{margin-top:12px} .fontes p{margin:6px 0}
.mem{list-style:none;padding:0;margin:10px 0 0} .mem li{display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)} .mem li span{flex:1} .mem li small{color:var(--ink-3)}
.mkFotosBloco summary{cursor:pointer;list-style:none} .mkFotosBloco summary::-webkit-details-marker{display:none} .mkFotosBloco summary h3{display:inline;margin:0;font-size:15px}
.mkFotosBloco[open] summary{margin-bottom:8px}
.mkRodape{margin:18px 0 0;text-align:center;font-size:12.5px;color:var(--ink-3)}
.pisca{box-shadow:0 0 0 3px var(--highlight,#FFD23F)!important;transition:box-shadow .3s}
@media (max-width:640px){
  .mkTopo .mkMes{width:100%;justify-content:center}
  .vaga{grid-template-columns:44px 1fr;gap:12px}
  .vagaAcoes{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr)}
  .vagaAcoes button{padding:8px 6px}
  .stat{padding:12px 10px} .stat b{font-size:22px} .stat span{font-size:12px}
  .anuncio{grid-template-columns:1fr} .anFoto{height:140px}
  .novo{padding:12px 8px;align-items:center;text-align:center} .novo span{font-size:24px;margin:0} .novo b{font-size:13px} .novo small{display:none}
  .mkAbas button{padding:10px 11px;font-size:13.5px}
}
@media (max-width:760px){.ibApp{grid-template-columns:1fr;height:auto} .ibApp.comConversa .ibLista{display:none} .ibApp:not(.comConversa) .ibDetalhe{display:none} .ibVolta{display:grid} .ibCab{flex-direction:column;align-items:stretch} .ibModo{align-self:flex-start} .ibVivo{grid-template-columns:1fr} .ibVivoBts{flex-direction:column} .ibVivoBt{justify-content:flex-start}}
`;

let iaEl = null, iaFoto = [];  /* fotos anexadas à próxima mensagem (até 4) */
function iaMonta() {
  if (iaEl) return;
  const st = document.createElement('style'); st.textContent = IA_CSS; document.head.appendChild(st);
  const fab = document.createElement('button'); fab.id = 'iaFab'; fab.type = 'button'; fab.onclick = iaAbre;
  const g = document.createElement('aside'); g.id = 'iaGaveta';
  g.innerHTML = `<header><span class="iaAv" aria-hidden="true">✦</span><span class="iaCab"><b id="iaTit"></b><small id="iaCtx"></small></span><button class="x" id="iaFecha" aria-label="${esc(ia('fechar'))}">×</button></header>
    <div id="iaCorpo" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`;
  document.body.append(fab, g);
  g.querySelector('#iaFecha').onclick = iaFecha;
  iaEl = { fab, g };
  iaAtualizaFab();
}
function iaContexto() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] !== 'adm') return null;
  const aba = p[1] || 'today';
  const tab = (ADM_TABS.find(([id]) => id === aba) || [aba, aba])[1];
  let txt = STR[tab] ? t(tab) : aba;
  if (aba === 'tours' && p[2] && p[2] !== 'new' && Tours.get(p[2])) txt += ' · ' + nomeTour(Tours.get(p[2]));
  return { aba, arg: p[2] || null, txt };
}
const iaPodeVer = () => location.hash.startsWith('#/adm') && (!temNuvem() || isLoggedIn());
function iaAtualizaFab() {
  if (!iaEl) return;
  const mostra = iaPodeVer();
  if (!mostra) iaEl.g.classList.remove('aberta');
  iaEl.fab.classList.toggle('on', mostra && !iaEl.g.classList.contains('aberta'));
  iaEl.fab.innerHTML = `<span class="dot"></span>${ia('assistente')}<small class="iaExtra">${ia('extra')}</small>`;
  const selo = { demo: ia('demoTit'), vivo: '⚡ ' + ia('vivoTit') }[iaModo()] || '';
  iaEl.g.querySelector('#iaTit').innerHTML = esc(ia('assistente')) + (selo ? ` <span class="iaModo">${esc(selo)}</span>` : '');
  iaEl.g.querySelector('#iaFecha').setAttribute('aria-label', ia('fechar'));
  const c = iaContexto();
  iaEl.g.querySelector('#iaCtx').textContent = c ? ia('vendo') + ': ' + c.txt : '';
  /* o botão fica acima da faixa de proposta e da barra de abas do celular */
  let base = 18;
  const rail = document.querySelector('.rail'), faixa = document.querySelector('.protobar');
  if (rail && getComputedStyle(rail).position === 'fixed' && rail.getBoundingClientRect().top > innerHeight / 2) base += rail.offsetHeight;
  if (faixa && faixa.offsetHeight) base = Math.max(base, innerHeight - faixa.getBoundingClientRect().top + 12);
  iaEl.fab.style.bottom = base + 'px';
}
function iaAbre() { iaEl.g.classList.add('aberta'); iaEl.fab.classList.remove('on'); iaAtualizaFab(); iaDesenha(); }
function iaFecha() { if (!iaEl) return; iaEl.g.classList.remove('aberta'); iaAtualizaFab(); }

let iaMostrandoChave = false;
function iaDesenha() {
  const corpo = iaEl.g.querySelector('#iaCorpo');
  if (iaMostrandoChave) {
    corpo.innerHTML = `<div class="iaChave"><p>${ia('chaveTit')}</p>
      <ol><li>${ia('chave1')}</li><li>${ia('chave2')}</li><li>${ia('chave3')}</li><li>${ia('chave4')}</li></ol>
      <input id="iaChaveIn" type="password" autocomplete="off" placeholder="sk-ant-…">
      <button class="sim" id="iaChaveOk">${ia('chaveOk')}</button><p id="iaChaveMsg" style="margin:0;font-size:13.5px"></p>
      <button class="volta" id="iaChaveVolta">${ia('chaveVolta')}</button></div>`;
    corpo.querySelector('#iaChaveOk').onclick = iaTestaChave;
    corpo.querySelector('#iaChaveVolta').onclick = () => { iaMostrandoChave = false; iaDesenha(); };
    return;
  }
  const demo = iaDemo(), vivo = iaModo() === 'vivo';
  corpo.innerHTML = `<div id="iaMsgs"></div><div id="iaAnexo"></div>
    ${demo ? '' : `<form id="iaForm"><button type="button" id="iaClip" title="${esc(ia('foto'))}" aria-label="${esc(ia('foto'))}"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"/></svg></button>
      <input type="file" id="iaArq" accept="image/*" multiple hidden><textarea id="iaTxt" rows="1" placeholder="${esc(ia('ph'))}"></textarea>
      <button id="iaEnviar" type="submit" aria-label="${esc(ia('enviar'))}" title="${esc(ia('enviar'))}">↑</button></form>`}
    <div id="iaPe"><label><input type="checkbox" id="iaConf" ${iaPerguntaAntes() ? 'checked' : ''}> ${ia('perguntar')}</label>
      ${demo ? `<button type="button" id="iaConecta">${ia('conectar')}</button>` : vivo ? '' : `<span id="iaGasto"></span>`}
      <span><button type="button" id="iaLimpa">${ia('nova')}</button>${demo || vivo ? '' : ` · <button type="button" id="iaTiraChave">${ia('trocarChave')}</button>`}</span></div>`;
  const msgs = corpo.querySelector('#iaMsgs');
  iaBolha('assistant', iaSaudacao(), null, true);
  if (demo) {
    const d = document.createElement('div'); d.className = 'iaDemo'; d.innerHTML = `<b>${ia('demoTit')}</b>${esc(ia('demoTxt'))}<span class="iaDemoExtra">✦ ${esc(ia('extraAviso'))}</span>`; msgs.appendChild(d);
    iaMostraSugestoes();
  } else {
    if (vivo) { const d = document.createElement('div'); d.className = 'iaDemo'; d.innerHTML = `<b>⚡ ${ia('vivoTit')}</b>${esc(ia('vivoTxt'))}<span class="iaDemoExtra">✦ ${esc(ia('extraAviso'))}</span>`; msgs.appendChild(d); }
    for (const m of iaLe(IA_HIST, [])) {
      if (typeof m.content === 'string') iaBolha(m.role, m.content);
      else if (m.role === 'assistant' || ehPergunta(m)) { const t2 = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); if (t2) iaBolha(m.role, t2); }
    }
    const f = corpo.querySelector('#iaForm'), ta = corpo.querySelector('#iaTxt'), arq = corpo.querySelector('#iaArq');
    f.onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v && !iaFoto.length) return; const foto = iaFoto; iaFoto = []; iaMostraAnexo(); ta.value = ''; ta.style.height = ''; iaConversa(v, foto); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); f.requestSubmit(); } };
    ta.oninput = () => { ta.style.height = ''; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    corpo.querySelector('#iaClip').onclick = () => arq.click();
    arq.onchange = async () => { const files = [...arq.files].slice(0, 4 - iaFoto.length); arq.value = ''; for (const file of files) { try { iaFoto.push(await iaReduzFoto(file)); } catch (e) { iaBolha('erro', e.message); } } iaMostraAnexo(); };
    /* arrastar/soltar em qualquer lugar da tela e Cmd+V de print: a foto vai pro assistente, igual ao clipe
       (pedido do Eugênio, 01/10/2026 — vale pra todos os apps com assistente) */
    if (!window.__iaSoltaOk) { window.__iaSoltaOk = true;
      const pega = async (lista) => { const files = [...lista].filter(f => /^image\//.test(f.type)).slice(0, 4 - iaFoto.length); if (!files.length) return;
        if (iaEl && iaEl.g && !iaEl.g.classList.contains('aberta')) iaAbre();
        for (const file of files) { try { iaFoto.push(await iaReduzFoto(file)); } catch (e) {} }
        iaMostraAnexo(); const t = document.querySelector('#iaTxt'); if (t) t.focus(); };
      const temArq = (e) => !!(e.dataTransfer && e.dataTransfer.types && [...e.dataTransfer.types].includes('Files'));
      let tt = null;
      document.addEventListener('dragover', (e) => { if (!temArq(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; document.body.classList.add('iaSolta'); clearTimeout(tt); tt = setTimeout(() => document.body.classList.remove('iaSolta'), 400); });
      document.addEventListener('drop', (e) => { if (!temArq(e)) return; e.preventDefault(); clearTimeout(tt); document.body.classList.remove('iaSolta'); pega(e.dataTransfer.files); });
      document.addEventListener('paste', (e) => { const fs = [...((e.clipboardData && e.clipboardData.items) || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean); if (fs.length) { e.preventDefault(); pega(fs); } });
    }
    const tc = corpo.querySelector('#iaTiraChave');
    if (tc) tc.onclick = () => { if (!confirm(ia('tirarChave'))) return; localStorage.removeItem(IA_CHAVE); iaAtualizaFab(); iaDesenha(); };
    iaMostraGasto();
    if (vivo && !iaLe(IA_HIST, []).length) iaMostraSugestoes();
    if (!('ontouchstart' in window)) ta.focus();
  }
  corpo.querySelector('#iaConf').onchange = (e) => iaGrava(IA_CONFIRMA, e.target.checked);
  corpo.querySelector('#iaLimpa').onclick = () => { if (iaOcupado) { iaAbortar = true; iaCancelaCartaoPendente(); } iaGrava(IA_HIST, []); iaDesenha(); };
  const cn = corpo.querySelector('#iaConecta'); if (cn) cn.onclick = () => { iaMostrandoChave = true; iaDesenha(); };
  msgs.scrollTop = msgs.scrollHeight;
}
function iaMostraSugestoes() {
  const msgs = iaEl && iaEl.g.querySelector('#iaMsgs');
  if (!msgs || iaModo() === 'chave') return;
  if (iaModo() === 'demo' && !msgs.parentNode.querySelector('#iaConecta') && !iaChave()) { iaDesenha(); return; }
  msgs.querySelectorAll('.iaSug').forEach(x => x.remove());
  const box = document.createElement('div'); box.className = 'iaSug';
  box.innerHTML = `<small>${ia('experimente')}</small>`;
  for (const c of iaCenarios()) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = c.pede;
    b.onclick = () => { box.remove(); if (iaModo() === 'vivo') iaConversa(c.pede); else iaRodaCenario(c); };
    box.appendChild(b);
  }
  msgs.appendChild(box); msgs.scrollTop = msgs.scrollHeight;
}
function iaMostraAnexo() {
  const el = iaEl && iaEl.g.querySelector('#iaAnexo'); if (!el) return;
  el.classList.toggle('on', !!iaFoto.length);
  el.innerHTML = iaFoto.length ? `${iaFoto.map(f => `<img src="${f}" alt="">`).join('')} ${iaFoto.length > 1 ? ia('fotosProntas', { n: iaFoto.length }) : ia('fotoPronta')} <button type="button" id="iaTiraFoto">${ia('tirar')}</button>` : '';
  const b = el.querySelector('#iaTiraFoto'); if (b) b.onclick = () => { iaFoto = []; iaMostraAnexo(); };
}
async function iaTestaChave() {
  const inp = iaEl.g.querySelector('#iaChaveIn'), msg = iaEl.g.querySelector('#iaChaveMsg'), v = inp.value.trim();
  if (!/^sk-ant-/.test(v)) { msg.textContent = ia('chaveRuim'); return; }
  msg.textContent = ia('testando');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': v, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: IA_MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'oi' }] }) });
    const corpo = await r.json().catch(() => null);
    if (!r.ok) throw new Error(iaTraduzErro(r.status, corpo));
    localStorage.setItem(IA_CHAVE, v); iaSomaGasto(corpo.usage);
    iaMostrandoChave = false; iaAtualizaFab(); iaDesenha();
  } catch (e) { msg.textContent = e.message; }
}
function iaMostraGasto() {
  const el = iaEl && iaEl.g.querySelector('#iaGasto'); if (!el) return;
  const us = iaLe(IA_GASTO, 0) || 0;
  el.textContent = ia('gasto') + ' ' + us.toFixed(us < 1 ? 3 : 2);
}
const iaHtml = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function iaBolha(tipo, texto, antesDe, semCopiar, foto) {
  const msgs = iaEl && iaEl.g.querySelector('#iaMsgs');
  if (!msgs) return document.createElement('div');
  const d = document.createElement('div'); d.className = 'iaB ' + tipo;
  const fs = !foto ? [] : Array.isArray(foto) ? foto : [foto];
  d.innerHTML = (fs.length ? `<span class="iaFotos">${fs.map(f => `<img src="${f}" alt="">`).join('')}</span>` : '') + iaHtml(texto);
  if (tipo === 'assistant' && texto.length > 80 && !semCopiar) {
    const b = document.createElement('button'); b.className = 'cp'; b.type = 'button'; b.textContent = ia('copiar');
    b.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(texto.replace(/\*\*/g, '')).then(() => { b.textContent = ia('copiado'); }); };
    d.appendChild(b);
  }
  if (antesDe && antesDe.parentNode === msgs) msgs.insertBefore(d, antesDe); else msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}
function iaTravado(sim) {
  const b = iaEl && iaEl.g.querySelector('#iaEnviar'); if (b) b.disabled = sim;
  if (iaEl) iaEl.g.querySelectorAll('.iaSug button').forEach(x => x.disabled = sim);
}
function iaCartao(plano) {
  const c = document.createElement('div'); c.className = 'iaCard';
  c.innerHTML = `<h4>${esc(plano.titulo)} — ${ia('confirma')}</h4>
    <dl>${plano.linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${plano.assumiu.length ? `<p class="ass">${ia('assumi')}: ${esc(plano.assumiu.join('; '))}</p>` : ''}
    <div class="bts"><button type="button" class="nao">${ia('cancelar')}</button><button type="button" class="sim">${ia('confirmar')}</button></div>`;
  const msgs = iaEl.g.querySelector('#iaMsgs'), pensa = msgs.querySelector('.iaB.pensa');
  if (pensa) msgs.insertBefore(c, pensa); else msgs.appendChild(c);
  msgs.scrollTop = msgs.scrollHeight;
  return c;
}
function iaFechaCartao(c, sim) {
  c.classList.add('feito');
  const h = c.querySelector('h4'); h.textContent = h.textContent.replace(' — ' + ia('confirma'), '');
  c.querySelector('.bts').outerHTML = `<p class="ass">${sim ? ia('feito') : ia('cancelado')}</p>`;
}
/* o cartão que espera o toque dela. Se ele sumir da tela (nova conversa, painel redesenhado)
   a espera termina como "cancelou" — antes ficava pendurada e o assistente travava para sempre */
let iaCartaoPendente = null;
function iaCancelaCartaoPendente() { if (iaCartaoPendente) { const p = iaCartaoPendente; iaCartaoPendente = null; p(false); } }
function iaPedeConfirmacao(plano) {
  return new Promise((ok) => {
    const c = iaCartao(plano);
    let fim = false;
    const vigia = setInterval(() => { if (!fim && !c.isConnected) termina(false); }, 500);
    const termina = (sim) => { if (fim) return; fim = true; clearInterval(vigia); iaCartaoPendente = null; if (c.isConnected) iaFechaCartao(c, sim); ok(sim); };
    iaCartaoPendente = termina;
    c.querySelector('.sim').onclick = () => termina(true);
    c.querySelector('.nao').onclick = () => termina(false);
  });
}
function iaCartaoFeito(plano) { iaFechaCartao(iaCartao(plano), true); }

/* =====================================================
   LIGAR — acrescenta as abas e as rotas por fora do app.js
===================================================== */
STR.admMarketing = IA_TXT.marketing;
STR.admInbox = IA_TXT.atendimento;
if (!ADM_TABS.some(([id]) => id === 'inbox')) {
  const i = ADM_TABS.findIndex(([id]) => id === 'bookings');
  ADM_TABS.splice(i < 0 ? 1 : i + 1, 0, ['inbox', 'admInbox']);
}
if (!ADM_TABS.some(([id]) => id === 'marketing')) {
  const i = ADM_TABS.findIndex(([id]) => id === 'coupons');
  ADM_TABS.splice(i < 0 ? ADM_TABS.length : i + 1, 0, ['marketing', 'admMarketing']);
}
const _viewAdmOriginal = viewAdm;
viewAdm = function (tab, arg) {
  if (tab === 'marketing') admMarketing(arg);
  else if (tab === 'inbox') admAtendimento(arg);
  else _viewAdmOriginal(tab, arg);
  marcaExtras();
};
function marcaExtras() {
  for (const id of ['nb-inbox', 'nb-marketing']) {
    const b = document.getElementById(id);
    if (b && !b.querySelector('.iaExtra')) b.insertAdjacentHTML('beforeend', ` <small class="iaExtra">${ia('extra')}</small>`);
  }
}
/* francês, italiano, alemão e espanhol dos textos do assistente */
if (typeof IA_TR !== 'undefined') for (const l in IA_TR) for (const k in IA_TR[l]) if (IA_TXT[k] && !(l in IA_TXT[k])) IA_TXT[k][l] = IA_TR[l][k];

iaMonta();
addEventListener('hashchange', () => setTimeout(iaAtualizaFab, 30));
addEventListener('resize', iaAtualizaFab);
setInterval(iaAtualizaFab, 1500);
if (location.hash.startsWith('#/adm')) route();

/* rótulos dos cartões novos (reservas, pagamento, perfil e treino) */
IA_TXT.cCriarReserva = { pt: 'Criar reserva', en: 'Create booking', fr: 'Créer une réservation', it: 'Crea prenotazione', de: 'Buchung anlegen', es: 'Crear reserva' };
IA_TXT.cAlterarReserva = { pt: 'Mudar reserva', en: 'Change booking', fr: 'Modifier la réservation', it: 'Modifica prenotazione', de: 'Buchung ändern', es: 'Cambiar reserva' };
IA_TXT.cCancelarReserva = { pt: 'Cancelar reserva', en: 'Cancel booking', fr: 'Annuler la réservation', it: 'Annulla prenotazione', de: 'Buchung stornieren', es: 'Cancelar reserva' };
IA_TXT.cPagamento = { pt: 'Registrar pagamento', en: 'Record payment', fr: 'Enregistrer un paiement', it: 'Registra pagamento', de: 'Zahlung erfassen', es: 'Registrar pago' };
IA_TXT.cAjustes = { pt: 'Mudar o perfil', en: 'Update profile', fr: 'Modifier le profil', it: 'Aggiorna profilo', de: 'Profil ändern', es: 'Cambiar el perfil' };
IA_TXT.cEnsinar = { pt: 'Treinar o agente', en: 'Train the agent', fr: 'Former l’agent', it: 'Istruisci l’agente', de: 'Agenten anlernen', es: 'Entrenar al agente' };
IA_TXT.cCliente = { pt: 'Cliente', en: 'Guest', fr: 'Client', it: 'Cliente', de: 'Gast', es: 'Cliente' };
IA_TXT.cQuando = { pt: 'Quando', en: 'When', fr: 'Quand', it: 'Quando', de: 'Wann', es: 'Cuándo' };
IA_TXT.cHora = { pt: 'Hora', en: 'Time', fr: 'Heure', it: 'Ora', de: 'Uhrzeit', es: 'Hora' };
IA_TXT.cPessoas = { pt: 'Pessoas', en: 'People', fr: 'Personnes', it: 'Persone', de: 'Personen', es: 'Personas' };
IA_TXT.cTotal = { pt: 'Total', en: 'Total', fr: 'Total', it: 'Totale', de: 'Gesamt', es: 'Total' };
IA_TXT.cRecebido = { pt: 'Já recebido', en: 'Already received', fr: 'Déjà reçu', it: 'Già ricevuto', de: 'Bereits erhalten', es: 'Ya recibido' };
IA_TXT.cValor = { pt: 'Valor', en: 'Amount', fr: 'Montant', it: 'Importo', de: 'Betrag', es: 'Importe' };
IA_TXT.cComo = { pt: 'Como', en: 'Method', fr: 'Moyen', it: 'Metodo', de: 'Art', es: 'Método' };
IA_TXT.cFalta = { pt: 'Ainda falta', en: 'Still due', fr: 'Reste à payer', it: 'Ancora da pagare', de: 'Noch offen', es: 'Aún falta' };
IA_TXT.cCodigo = { pt: 'Código', en: 'Code', fr: 'Code', it: 'Codice', de: 'Code', es: 'Código' };
IA_TXT.cEmail = { pt: 'E-mail', en: 'Email', fr: 'E-mail', it: 'E-mail', de: 'E-Mail', es: 'Correo' };
IA_TXT.cBio = { pt: 'Quem sou eu', en: 'About you', fr: 'Qui je suis', it: 'Chi sono', de: 'Über dich', es: 'Quién soy' };
IA_TXT.cTextoHome = { pt: 'Texto da capa', en: 'Home text', fr: 'Texte d’accueil', it: 'Testo della home', de: 'Startseitentext', es: 'Texto de portada' };
