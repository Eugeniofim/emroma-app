/* =====================================================
   O KIT DA VIAGEM (27/10/2026)

   Quem compra recebe UM link (ou PDF) com a viagem inteira — "Sua viagem com
   a EmRoma": todos os serviços em ordem de data, cada um com o código, data e
   hora, ponto de encontro (com mapa), voo e trajeto do transfer, o programa,
   incluso e não incluso, o que saber no dia, o pagamento (pago, falta, o que
   paga no dia) e "pôr na minha agenda". Depois: os textos do VOUCHER dela
   (pagamento, suporte, transfer, passeios, fechamento — os da aba Voucher, sem
   repetir), as dicas da cidade (ela edita), descontos para o cliente (se ela
   escrever) e o contato.

   Construído EM CIMA do voucher que já existe (o voucher do painel continua):
   - quem entra: as reservas confirmadas do cliente (chave = e-mail, WhatsApp ou
     nome — a mesma do Clientes), mais as do mesmo cadastro (clienteId);
   - ponto de encontro: o mesmo do voucher (vchEncontro — Pontos, senão o do
     passeio); transfer: o texto dela de cada tipo (aeroporto, porto, trem, partida);
   - os valores respeitam a escolha do voucher ("só o pagar no dia", "nenhum valor");
   - o NOME do motorista/guia não sai: os textos dela dizem que não é informado antes.

   O formato é o v1 do contrato (KIT-CONTRATO.md, igual em todos os apps e no
   servidor). Campos a mais, opcionais (o desenho tolera a falta):
   servico.voo/origem/destino/veiculo (transfer), servico.mapa, servico.encontroObs,
   servico.soDia, servico.diaValor; kit.blocos [{titulo, texto}], kit.bagagem, kit.plantao.
   Nunca vai o e-mail nem o telefone DO CLIENTE (a página é pública).

   O LINK CURTO E SEMPRE ATUALIZADO (#/k/<código>): o kit fica numa tabela só
   dele no banco dela (public.kits — LIGAR-KIT-INGRID.sql). O cliente lê UM kit
   pelo código (função kit), nunca a tabela; só a dona grava. Mudou a hora, o
   ponto ou um pagamento → o app republica sozinho e o cliente vê no mesmo link.
   Sem a tabela (ou sem login), cai no link COMPRIDO (#/kt/…, o kit viaja dentro
   do link): funciona, mas não se atualiza.

   Kit.dados(chave) · Kit.link(chave) → url · Kit.mensagem(chave) → texto
   Kit.abrir(chave) · Kit.urlConhecida(chave) · Kit.daReserva(b) → chave
   ===================================================== */
'use strict';

/* dicas curtas e seguras (só o que é certo); ela troca no painel do kit */
const KIT_DICAS_PADRAO = [
  'Emergência na Itália: 112.',
  'A moeda é o euro. Cartão é aceito na maioria dos lugares; leve um pouco de dinheiro trocado para gastos pequenos.',
  'Tomadas: dois pinos redondos (padrão europeu) ou três pinos em linha (italiano). Um adaptador universal resolve.',
  'Os "nasoni", as fontinhas de rua de Roma, têm água potável: leve uma garrafinha.',
  'No ônibus e no metrô, o bilhete precisa ser validado ao entrar.',
  'Atenção a batedores de carteira no metrô, nos ônibus e nos lugares cheios.',
  'Os hotéis de Roma cobram à parte a taxa de turismo da cidade, por pessoa e por noite.',
];
const kitDicas = () => (Array.isArray(DB.settings.kitDicas) ? DB.settings.kitDicas : KIT_DICAS_PADRAO).map(x => String(x || '').trim()).filter(Boolean);
/* descontos para o cliente (lojas, restaurantes…): ela escreve, uma linha por parceiro "Nome | 10 | como usar".
   Os parceiros do app são indicadores (o cupom dá desconto nos serviços DELA), não lojas com desconto para o cliente. */
const kitParceiros = () => (Array.isArray(DB.settings.kitParceiros) ? DB.settings.kitParceiros : [])
  .filter(p => p && String(p.nome || '').trim()).map(p => ({ nome: String(p.nome).trim(), desconto: Math.max(0, Math.min(100, +p.desconto || 0)), ...(p.como ? { como: String(p.como).trim() } : {}) })).slice(0, 12);
const kitParcTexto = () => kitParceiros().map(p => [p.nome, p.desconto || '', p.como || ''].join(' | ').replace(/( \| )+$/, '')).join('\n');
function kitParcLe(txt) {
  return String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [nome, d, ...como] = l.split('|').map(s => s.trim());
    return { nome, desconto: Math.max(0, Math.min(100, +String(d || '').replace(/[^\d.,]/g, '').replace(',', '.') || 0)), como: como.join(' | ') };
  }).filter(p => p.nome).slice(0, 12);
}
const kitChaveDe = (b) => String((b && (b.email || b.whats || b.name)) || '').toLowerCase();
const kitPrim = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const kitDig = (w) => String(w || '').replace(/\D/g, '');
const kitPt = (a) => !a ? '' : typeof a === 'string' ? a : (a.pt || a.en || '');
const kitLista = (a) => (a && !Array.isArray(a) && (a.pt || a.en) ? (a.pt || a.en) : Array.isArray(a) ? a : []).map(s => String(s || '').trim()).filter(Boolean);
/* um parágrafo vira itens de lista (uma frase por item) */
const kitFrases = (t) => String(t || '').replace(/([.!?])\s+(?=[A-ZÀ-Ú"“(])/g, '$1\n').split('\n').map(s => s.trim()).filter(Boolean);
/* o endereço oficial dela (o link vai para o cliente — nunca o endereço antigo nem o de teste) */
function kitBase() {
  const novo = String((typeof APP_CONFIG !== 'undefined' && APP_CONFIG.novoEndereco) || '').replace(/\/+$/, '');
  if (novo && (location.hostname === new URL(novo).hostname || /guia\.eugeniofim\.com\/ingrid\//.test(location.href))) return novo + '/';
  return Publico.base();
}
function kitData(iso, opts) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, opts || {}));
}
const kitCap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
function kitPeriodo(sv) {
  if (!sv.length) return '';
  const a = sv[0].data, b = sv[sv.length - 1].data;
  const f = (iso, ano) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', Object.assign({ day: 'numeric', month: 'long' }, ano ? { year: 'numeric' } : {}));
  return a === b ? f(a, true) : f(a, false) + ' a ' + f(b, true);
}

/* as reservas do cliente que entram no kit: as que estão por vir (e as de ontem); se a viagem já passou, as 3 últimas */
const kitVale = (b) => b && (b.status || 'confirmed') === 'confirmed' && !b.apagado;
function kitReservas(chave) {
  const base = DB.bookings.filter(b => kitVale(b) && kitChaveDe(b) === chave);
  const ids = new Set(base.map(b => b.clienteId).filter(Boolean));
  const todas = DB.bookings.filter(b => kitVale(b) && (kitChaveDe(b) === chave || (b.clienteId && ids.has(b.clienteId))))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const desde = addDays(isoToday(), -1), vivas = todas.filter(b => b.date >= desde);
  return vivas.length ? vivas : todas.slice(-3);
}
/* a hospedagem: o destino do transfer de chegada (ou a saída do transfer de partida) */
const KIT_NAO_HOTEL = /\b(fco|cia)\b|fiumicino|ciampino|aeroport|termini|esta[cç][aã]o|stazione|\bporto\b|civitavecchia|^centro$/i;
function kitHotel(bs) {
  const trf = (x) => typeof ehTransfer === 'function' && ehTransfer(x);
  for (const x of bs) if (trf(x) && voucherTipoTransfer(x) !== 'partida' && String(x.destino || '').trim() && !KIT_NAO_HOTEL.test(String(x.destino).trim())) return String(x.destino).trim();
  for (const x of bs) if (trf(x) && voucherTipoTransfer(x) === 'partida' && String(x.origem || '').trim() && !KIT_NAO_HOTEL.test(String(x.origem).trim())) return String(x.origem).trim();
  return '';
}
function kitDurMin(x, trf) {
  if (trf) return 60;
  const m = String((x && x.duration) || '').match(/(\d+)\s*h(?:\s*(\d{1,2}))?/i);
  return m ? (+m[1]) * 60 + (+m[2] || 0) : 120;
}
/* o que saber no dia: as dicas do passeio (editor do passeio) ou as do tipo; no transfer de chegada, as do motorista */
function kitLevar(b, x, trf) {
  if (trf) return voucherTipoTransfer(b) === 'aeroporto' && typeof DICAS_PADRAO !== 'undefined' ? kitFrases(DICAS_PADRAO.transfer) : [];
  const d = x && x.dicas && kitPt(x.dicas);
  if (String(d || '').trim()) return kitFrases(d).slice(0, 8);
  if (x && /vaticano|vatican|basilic|papal/i.test((x.id || '') + ' ' + kitPt(x.name)))
    return kitFrases('Vaticano e basílicas: ombros e joelhos cobertos (vale para homens e mulheres). Nada de regata, short ou saia curta. Mochilas grandes não entram. ' + DICAS_PADRAO.walk);
  return typeof DICAS_PADRAO !== 'undefined' ? kitFrases((x && DICAS_PADRAO[x.type]) || DICAS_PADRAO.walk) : [];
}
const kitFoto = (p) => /^data:/i.test(String(p || '')) ? '' : String(p || '');
/* os valores, com a escolha do voucher: tudo · só o "pagar no dia" · nenhum (agência) */
function kitPagamento(b, fora, s) {
  if (fora.has('valores')) { s.pago = 0; s.restante = 0; return; }
  if (fora.has('sodia')) {
    const q = vchContaDe(b); s.pago = 0; s.restante = q.dia; s.soDia = true;
    if (q.dia > 0) { if (q.paraIngrid) s.vence = Bookings.dueDate(b); else s.noDia = true; }
    return;
  }
  s.pago = Bookings.paid(b); s.restante = Bookings.due(b);
  if (s.restante > 0) {
    if (Op.restoPara(b) === 'prestador' && Op.dueIngrid(b) <= 0) s.noDia = true;
    else { s.vence = Bookings.dueDate(b); const nd = Op.dueNoDia(b); if (nd > 0 && nd < s.restante) s.diaValor = nd; }
  }
}
function kitServico(b, hotel, fora) {
  const x = Tours.get(b.tourId) || {};
  const trf = typeof ehTransfer === 'function' && ehTransfer(b);
  const e = vchEncontro(b), pt = e.ponto;
  const encontro = trf ? kitCap(VCH_ENC_TRANSFER[voucherTipoTransfer(b)] || '') : e.txt;
  const s = {
    code: b.code, nome: nomeDoServico(b) || 'Serviço', tipo: trf ? 'transfer' : (x.type || ''),
    data: b.date, hora: b.time || '', pessoas: +b.pax || 1, duracao: trf ? '' : (x.duration || ''), durMin: kitDurMin(x, trf),
    encontro, hotel: trf ? '' : hotel, guia: '', foto: kitFoto(x.photo),
    resumo: kitPt(x.tagline),
    paradas: (x.stops || []).map(p => ({ n: kitPt(p.n), d: kitPt(p.d) })).filter(p => p.n).slice(0, 12),
    inclui: kitLista(x.includes), naoInclui: kitLista(x.notIncludes), levar: kitLevar(b, x, trf),
    pago: 0, restante: 0, cancel: kitPt(x.cancel),
  };
  kitPagamento(b, fora, s);
  if (trf) { for (const k of ['voo', 'origem', 'destino', 'veiculo']) if (String(b[k] || '').trim()) s[k] = String(b[k]).trim(); }
  if (pt) { const m = typeof linkMapa === 'function' ? linkMapa(pt) : ''; if (m) s.mapa = m; if (String(pt.instrucoes || '').trim()) s.encontroObs = String(pt.instrucoes).trim(); }
  else if (trf && voucherTipoTransfer(b) === 'partida' && s.origem && !KIT_NAO_HOTEL.test(s.origem)) s.mapa = mapLink(s.origem);
  return s;
}
/* os textos do voucher da viagem, na ordem dela e sem repetir (os mesmos do voucher do painel) */
function kitBloco(t) {
  const l = String(t).split('\n'), p = (l[0] || '').trim();
  const titulo = p && p.length < 70 && p === p.toUpperCase() && /[A-ZÀ-Ú]/.test(p);
  return titulo ? { titulo: p, texto: l.slice(1).join('\n').trim() } : { titulo: '', texto: String(t).trim() };
}
function kitBlocos(bs) {
  if (typeof voucherBlocosViagem !== 'function' || typeof voucherBlocoTxt !== 'function') return [];
  const cfg = bs.find(x => x.voucherFora || x.voucherNota || x.voucherPg || x.voucherMais) || {};
  const fora = new Set(cfg.voucherFora || []), pg = String(cfg.voucherPg || ''), nota = String(cfg.voucherNota || '').trim();
  const auto = voucherBlocosViagem(bs), mais = (cfg.voucherMais || []).filter(k => !auto.includes(k));
  const ks = (typeof VOUCHER_ORDEM !== 'undefined' ? VOUCHER_ORDEM : auto).filter(k => (auto.includes(k) || mais.includes(k)) && !fora.has(k));
  const out = [];
  for (const k of ks) {
    if (k === 'fechamento') continue;
    let t = voucherBlocoTxt(k); if (k === 'pagamento' && t && typeof vchPgMarca === 'function') t = vchPgMarca(t, pg);
    if (String(t || '').trim()) out.push(kitBloco(t));
  }
  if (nota) out.push({ titulo: 'OBSERVAÇÕES', texto: nota });
  if (ks.includes('fechamento') && String(voucherBlocoTxt('fechamento') || '').trim()) out.push(kitBloco(voucherBlocoTxt('fechamento')));
  return out;
}
/* o kit inteiro (é ISTO que vai para o cliente: sem e-mail nem telefone dele) */
async function kitDados(chave) {
  const bs = kitReservas(chave); if (!bs.length) return null;
  const cfg = bs.find(x => x.voucherFora) || {}, fora = new Set(cfg.voucherFora || []);
  const hotel = kitHotel(bs);
  const sv = bs.map(b => kitServico(b, hotel, fora));
  const c = bs[0].clienteId && typeof Cadastro !== 'undefined' ? Cadastro.get(bs[0].clienteId) : null;
  const st = DB.settings;
  const d = { v: 1, nome: (c && c.nome) || bs[0].name || '', periodo: kitPeriodo(sv), servicos: sv, dicas: kitDicas(), parceiros: kitParceiros(),
    brindes: [], roteiro: '', whats: kitDig(st.whats), email: (typeof GUIA_CFG !== 'undefined' && GUIA_CFG.email) || '',
    insta: String(st.insta || '').replace(/^@/, ''), negocio: guiaNegocio(), gerado: new Date().toISOString() };
  const bag = typeof malasDaViagem === 'function' ? malasDaViagem(bs) : ''; if (bag) d.bagagem = bag;
  const blocos = kitBlocos(bs); if (blocos.length) d.blocos = blocos;
  if (String(st.plantao || '').trim()) d.plantao = String(st.plantao).trim();
  return d;
}
/* o do link comprido: sem as descrições das paradas (link menor) */
function kitEnxuto(d) {
  const o = JSON.parse(JSON.stringify(d));
  o.servicos.forEach(s => { s.paradas = s.paradas.map(p => ({ n: p.n })); });
  delete o.roteiro; return o;
}

/* ---------- o link: curto (tabela) ou comprido (dentro do link) ---------- */
/* o código fica num lugar privado que sincroniza (itens 'privado' → 'kits'), o mesmo desenho dos outros apps */
function kitTokens() { DB.privado = DB.privado || {}; if (!DB.privado.kits || typeof DB.privado.kits !== 'object') DB.privado.kits = {}; return DB.privado.kits; }
function kitNovoToken() {
  const A = 'ACDEFGHJKMNPQRTUVWXYabcdefghjkmnpqrstuvwxyz34679', u = new Uint8Array(10);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(u) : u.forEach((_, i) => { u[i] = Math.random() * 256; });
  return [...u].map(n => A[n % A.length]).join('');
}
const kitPodeNuvem = () => typeof temNuvem === 'function' && temNuvem() && typeof isLoggedIn === 'function' && isLoggedIn() && !Kit.semTabela;
async function kitPublica(chave, dados) {
  if (!kitPodeNuvem()) return false;
  const T = kitTokens(); let t = T[chave];
  if (!t || !t.token) { t = T[chave] = { token: kitNovoToken(), criado: new Date().toISOString() }; save(); }
  try {
    const r = await supaFetch('kits', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ token: t.token, dados, atualizado_em: new Date().toISOString() }) });
    if (r.status === 404 || r.status === 400) { const j = await r.json().catch(() => ({})); if (/kits|relation|schema cache|PGRST205/i.test(JSON.stringify(j))) Kit.semTabela = true; return false; }
    if (!r.ok && r.status !== 201 && r.status !== 204) return false;
    if (!t.publicado) { t.publicado = new Date().toISOString(); save(); }
    return true;
  } catch (e) { return false; }
}
const Kit = {
  semTabela: false,
  dados: kitDados,
  daReserva: kitChaveDe,
  async link(chave) {
    const d = await kitDados(chave); if (!d) throw new Error('esse cliente ainda não tem reserva confirmada');
    if (await kitPublica(chave, d)) return kitBase() + '#/k/' + kitTokens()[chave].token;
    return kitBase() + '#/kt/' + await Publico.codifica(kitEnxuto(d));
  },
  urlConhecida(chave) { const t = (DB.privado && DB.privado.kits && DB.privado.kits[chave]) || null; return t && t.publicado ? kitBase() + '#/k/' + t.token : ''; },
  curto(chave) { return !!this.urlConhecida(chave); },
  async mensagem(chave, url) {
    const d = await kitDados(chave); if (!d) throw new Error('esse cliente ainda não tem reserva confirmada');
    url = url || await this.link(chave);
    const n = d.servicos.length;
    return `Oi, ${kitPrim(d.nome)}! Tudo bem? 😊 Aqui está o kit da sua viagem com a ${d.negocio}: ${n > 1 ? 'os ' + n + ' serviços' : 'o seu serviço'}, os horários, os pontos de encontro e tudo o que você precisa saber, numa página só.\n${url}\n\nGuarde no celular. Qualquer dúvida, me chama aqui!`;
  },
  abrir(chave) { if (!chave) return; const h = location.hash.slice(1); if (h && !/^\/adm\/kit\//.test(h)) Kit._volta = h; go('/adm/kit/' + encodeURIComponent(chave)); },
  /* publica JÁ e espera o código subir para o banco (o e-mail de confirmação procura o link curto lá) */
  async publicarJa(chave) {
    const url = await this.link(chave);
    try { if (typeof itEnfileirar === 'function') { itEnfileirar(); await itEnviarFila(); } } catch (e) {}
    return url;
  },
  /* republica os kits já mandados quando a reserva muda (hora, ponto, pagamento) */
  _fila: new Set(), _t: null,
  agendar(chave) {
    if (!chave || !(DB.privado && DB.privado.kits && DB.privado.kits[chave])) return;
    this._fila.add(chave); clearTimeout(this._t);
    this._t = setTimeout(async () => { const l = [...this._fila]; this._fila.clear(); for (const c of l) { try { const d = await kitDados(c); if (d) await kitPublica(c, d); } catch (e) {} } }, 2500);
  },
  /* a reserva pode estar no kit de outra chave (mesmo cadastro, contato diferente) */
  agendarReserva(b) {
    if (!b) return;
    this.agendar(kitChaveDe(b));
    const T = (DB.privado && DB.privado.kits) || {};
    for (const k of Object.keys(T)) if (k !== kitChaveDe(b) && kitReservas(k).some(x => x.id === b.id)) this.agendar(k);
  },
};
window.Kit = Kit;

/* ---------- a agenda do cliente (.ics e Google) ---------- */
const kitHm = (h) => typeof horaInicio === 'function' ? horaInicio(h) : (String(h || '').match(/\d{1,2}:\d{2}/) || ['09:00'])[0];
function kitSoma(hm, min) { const [h, m] = kitHm(hm).split(':').map(Number); const t = Math.min(1439, h * 60 + m + (min || 120)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
function kitGoogle(s, d) {
  const z = (iso, hm) => iso.replace(/-/g, '') + 'T' + kitHm(hm).replace(':', '') + '00';
  const datas = s.hora ? z(s.data, s.hora) + '/' + z(s.data, kitSoma(s.hora, s.durMin)) : s.data.replace(/-/g, '') + '/' + addDays(s.data, 1).replace(/-/g, '');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: s.nome + ' · ' + (d.negocio || ''), dates: datas, ctz: 'Europe/Rome',
    location: s.encontro || s.hotel || '', details: `Código ${s.code}${d.whats ? ' · WhatsApp +' + d.whats : ''}` });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function kitIcs(d) {
  const z = (iso, hm) => iso.replace(/-/g, '') + 'T' + kitHm(hm).replace(':', '') + '00';
  const e = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ev = d.servicos.map(s => ['BEGIN:VEVENT', 'UID:' + s.code + '@app.emroma.com', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    s.hora ? 'DTSTART;TZID=Europe/Rome:' + z(s.data, s.hora) : 'DTSTART;VALUE=DATE:' + s.data.replace(/-/g, ''),
    s.hora ? 'DTEND;TZID=Europe/Rome:' + z(s.data, kitSoma(s.hora, s.durMin)) : 'DTEND;VALUE=DATE:' + addDays(s.data, 1).replace(/-/g, ''),
    'SUMMARY:' + e(s.nome + ' · ' + d.negocio), 'LOCATION:' + e(s.encontro || s.hotel || ''), 'DESCRIPTION:' + e('Código ' + s.code + (s.voo ? ' · voo/trem ' + s.voo : '')),
    'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(s.nome), 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + (d.negocio || 'Kit') + '//Kit//PT', ...ev, 'END:VCALENDAR'].join('\r\n');
}
function kitBaixaIcs(d) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([kitIcs(d)], { type: 'text/calendar' }));
  a.download = 'viagem-' + (kitPrim(d.nome) || 'roma').toLowerCase() + '.ics'; document.body.appendChild(a); a.click(); a.remove();
}
/* o mapa: o link do ponto; sem ele, a busca pelo lugar (se for um lugar, não "combinado pelo WhatsApp") */
const kitMapaDe = (s) => s.mapa || (s.encontro && !/whats|combinad|confirm|após|apos|hotel|hospedagem|aeroporto|desembarque|navio|esta[cç][aã]o/i.test(s.encontro) ? mapLink(s.encontro + ', Roma') : '');

/* um bloco de texto do voucher: "- item" vira lista, "Sub-título:" fica em negrito, TÍTULO vira cabeçalho */
function kitFmt(txt) {
  let html = '', lista = false;
  const fecha = () => { if (lista) { html += '</ul>'; lista = false; } };
  for (const raw of String(txt || '').split('\n')) {
    const t = raw.trim();
    if (!t) { fecha(); continue; }
    const item = t.match(/^[-•·☐☑]\s*(.*)$/);
    if (item) { if (!lista) { html += '<ul class="kt-levar">'; lista = true; } html += `<li${/^☑/.test(t) ? ' class="kt-marcado"' : ''}>${esc(/^[☐☑]/.test(t) ? t : item[1])}</li>`; continue; }
    fecha();
    if (t.length < 70 && t === t.toUpperCase() && /[A-ZÀ-Ú]/.test(t)) html += `<h4>${esc(t)}</h4>`;
    else if (/:$/.test(t) && t.length < 80) html += `<p class="kt-sub">${esc(t)}</p>`;
    else html += `<p>${esc(t)}</p>`;
  }
  fecha(); return html;
}

/* ---------- o documento (o mesmo no painel, na página do cliente e no PDF) ---------- */
function kitDocHtml(d) {
  const ic = { mapa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>' };
  const sv = d.servicos || [], neg = d.negocio || guiaNegocio();
  const comValores = !sv.some(s => s.soDia);
  const pagoT = sv.reduce((s, x) => s + (+x.pago || 0), 0), faltaT = sv.reduce((s, x) => s + (+x.restante || 0), 0);
  const lista = (a) => Array.isArray(a) ? a : [];
  const pagamento = (s) => {
    const pago = +s.pago || 0, falta = +s.restante || 0;
    if (!(pago > 0) && !(falta > 0)) return '';
    const cel = [];
    if (pago > 0 && !s.soDia) cel.push(`<div><small>Pago</small><b>${esc(eur(pago))}</b></div>`);
    if (falta > 0) {
      const sub = s.noDia ? 'no dia do serviço'
        : s.diaValor ? `${eur(falta - s.diaValor)} de sinal${s.vence && s.vence < s.data ? ' até ' + kitData(s.vence, { weekday: undefined }) : ''} · ${eur(s.diaValor)} no dia`
        : s.vence ? 'até ' + kitData(s.vence, { weekday: undefined }) : '';
      cel.push(`<div class="resta"><small>${s.noDia ? 'Pagar no dia' : 'Falta pagar'}</small><b>${esc(eur(falta))}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`);
    } else cel.push('<div><small>Situação</small><b>Tudo pago ✓</b></div>');
    return `<div class="kt-pg kt-bl">${cel.join('')}</div>${s.pagarUrl ? `<a class="kt-cta kt-tela" href="${esc(s.pagarUrl)}" target="_blank" rel="noopener">Pagar ${esc(eur(s.pagarValor || falta))} agora</a>` : ''}`;
  };
  const servico = (s, k) => {
    const mapa = kitMapaDe(s), trf = s.tipo === 'transfer';
    return `<section class="kt-sv kt-bl" id="kt-sv-${k}">
      <div class="kt-svTopo${s.foto ? '' : ' sem'}">${s.foto ? `<img src="${esc(s.foto)}" alt="" loading="lazy">` : ''}<div class="kt-dia"><small>${esc(kitCap(kitData(s.data, { weekday: 'short', day: undefined, month: undefined })).replace('.', ''))}</small><b>${esc(String(s.data || '').slice(8, 10))}</b><small>${esc(new Date(s.data + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''))}</small></div></div>
      <div class="kt-svCorpo">
        <div class="kt-cab"><p class="kt-eyebrow">${trf ? 'Transfer' : 'Passeio'}</p><div class="kt-cod"><small>Código</small><b>${esc(s.code)}</b></div></div>
        <h2>${esc(s.nome)}</h2>${s.resumo ? `<p class="kt-res">${esc(s.resumo)}</p>` : ''}
        <div class="kt-grade">
          ${(() => { const cel = [`<small>Quando</small><b>${esc(kitCap(kitData(s.data)))}</b>${s.hora ? `<span>às ${esc(s.hora)}${s.duracao && !/conforme/i.test(s.duracao) ? ' · ' + esc(s.duracao) : ''}</span>` : ''}`,
              `<small>Pessoas</small><b>${esc(s.pessoas)} ${+s.pessoas > 1 ? 'pessoas' : 'pessoa'}</b>${s.veiculo ? `<span>${esc(s.veiculo)}</span>` : ''}${s.guia ? `<span>Guia: ${esc(s.guia)}</span>` : ''}`];
            if (s.voo) cel.push(`<small>Voo / trem</small><b>${esc(s.voo)}</b>`);
            if (s.origem) cel.push(`<small>Buscar em</small><b>${esc(s.origem)}</b>`);
            if (s.destino) cel.push(`<small>Levar para</small><b>${esc(s.destino)}</b>`);
            /* número ímpar de quadros: o último ocupa a linha inteira (sem buraco ao lado) */
            return cel.map((c, i) => `<div${cel.length % 2 && i === cel.length - 1 ? ' class="kt-lg"' : ''}>${c}</div>`).join(''); })()}
          <div class="kt-lg"><small>${trf ? 'Onde encontrar o motorista' : 'Ponto de encontro'}</small><b>${esc(s.encontro || 'Confirmamos pelo WhatsApp')}</b>${s.encontroObs ? `<span>${esc(s.encontroObs)}</span>` : ''}${s.hotel ? `<span>Hospedagem: ${esc(s.hotel)}</span>` : ''}
            ${mapa ? `<a class="kt-lk" href="${esc(mapa)}" target="_blank" rel="noopener">${ic.mapa}Abrir no mapa</a>` : ''}</div>
        </div>
        ${lista(s.paradas).length ? `<div class="kt-bl"><h3>O programa</h3><ol class="kt-par">${s.paradas.map(p => `<li><b>${esc(p.n)}</b>${p.d ? `<span>${esc(p.d)}</span>` : ''}</li>`).join('')}</ol></div>` : ''}
        ${lista(s.inclui).length || lista(s.naoInclui).length ? `<div class="kt-duas kt-bl">${lista(s.inclui).length ? `<div><h3>Incluso</h3><ul class="kt-ok">${s.inclui.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${lista(s.naoInclui).length ? `<div><h3>Não incluso</h3><ul class="kt-no">${s.naoInclui.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
        ${lista(s.levar).length ? `<div class="kt-bl"><h3>Para o dia</h3><ul class="kt-levar">${s.levar.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${pagamento(s)}
        <div class="kt-acs kt-tela"><a class="kt-lk" href="${esc(kitGoogle(s, d))}" target="_blank" rel="noopener">${ic.cal}Pôr no Google Agenda</a></div>
        ${s.cancel ? `<p class="kt-fino">${esc(s.cancel)}</p>` : ''}
      </div></section>`;
  };
  const logo = (typeof GUIA_CFG !== 'undefined' && GUIA_CFG.logo) || '';
  return `<article class="ktDoc">
    <header class="kt-topo kt-bl">${logo ? `<img class="kt-selo" src="${esc(logo)}" alt="">` : ''}
      <p class="kt-eyebrow">Sua viagem com a ${esc(neg)}</p>
      <h1>${esc(d.nome || 'Sua viagem')}</h1>
      <p class="kt-per">${esc(d.periodo || '')} · ${sv.length} ${sv.length > 1 ? 'serviços' : 'serviço'}${d.bagagem ? ' · bagagem: ' + esc(d.bagagem) : ''}</p>
      <div class="kt-acsTopo kt-tela">${d.whats ? `<a class="kt-cta" href="${esc(waLink('Olá! Sobre a minha viagem…', d.whats))}" target="_blank" rel="noopener">${typeof ICONE_WA !== 'undefined' ? ICONE_WA : ''}WhatsApp</a>` : ''}<button type="button" class="kt-bt" data-kt-ics>Pôr tudo na minha agenda</button></div>
    </header>
    ${d.plantao ? `<p class="kt-plantao kt-bl"><b>Suporte durante a viagem (plantão):</b> ${esc(d.plantao)}</p>` : ''}
    ${sv.length > 1 ? `<nav class="kt-lista kt-bl" aria-label="Os serviços da viagem">${sv.map((s, k) => `<a href="#kt-sv-${k}" data-kt-ir="${k}"><span class="kt-ld">${esc(String(s.data).slice(8, 10))}/${esc(String(s.data).slice(5, 7))}</span><b>${esc(s.nome)}</b><span>${esc(s.hora || '')}</span></a>`).join('')}</nav>` : ''}
    ${sv.length > 1 && comValores && (pagoT || faltaT) ? `<div class="kt-pg kt-tot kt-bl"><div><small>Total pago</small><b>${esc(eur(pagoT))}</b></div><div class="${faltaT > 0 ? 'resta' : ''}"><small>Falta</small><b>${esc(eur(faltaT))}</b></div></div>` : ''}
    ${sv.map(servico).join('')}
    ${lista(d.blocos).length ? `<section class="kt-box kt-info kt-bl"><h3 class="kt-infoT">Informações importantes</h3>${d.blocos.map(b => `<div class="kt-blk kt-bl">${b.titulo ? `<h4>${esc(b.titulo)}</h4>` : ''}${kitFmt(b.texto)}</div>`).join('')}</section>` : ''}
    ${d.roteiro ? `<section class="kt-box kt-bl"><h3>O seu roteiro personalizado</h3><a class="kt-cta" href="${esc(d.roteiro)}" target="_blank" rel="noopener">Abrir o roteiro</a></section>` : ''}
    ${lista(d.dicas).length ? `<section class="kt-box kt-bl"><h3>Dicas para a viagem</h3><ul class="kt-levar">${d.dicas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${lista(d.parceiros).length ? `<section class="kt-box kt-bl"><h3>Descontos para você</h3><p class="kt-fino">Com esta viagem você tem desconto nestes lugares.</p>${d.parceiros.map(p => `<div class="kt-parc">${+p.desconto ? `<i>${esc((+p.desconto).toLocaleString('pt-BR', { maximumFractionDigits: 1 }))}%</i>` : '<i>★</i>'}<div><b>${esc(p.nome)}</b>${p.cat || p.como ? `<small>${esc([p.cat, p.como].filter(Boolean).join(' · '))}</small>` : ''}</div></div>`).join('')}</section>` : ''}
    ${lista(d.brindes).length ? `<section class="kt-box kt-bl"><h3>Presentes</h3>${d.brindes.map(b => `<a class="kt-lk" href="${esc(b.url)}" target="_blank" rel="noopener">📎 ${esc(b.titulo)}</a>`).join('')}</section>` : ''}
    <footer class="kt-pe kt-bl"><div class="kt-qr" data-kt-qr></div>
      <div><b>Guarde este link no celular</b><span>Tudo da sua viagem num lugar só. Se algo mudar, você vê aqui.</span>
        <span class="kt-cont">${d.whats ? `WhatsApp: +${esc(d.whats)}` : ''}${d.email ? ` · ${esc(d.email)}` : ''}${d.insta ? ` · @${esc(d.insta)}` : ''}</span></div></footer>
  </article>`;
}
function kitLiga(raiz, d, url) {
  if (!raiz) return;
  const b = raiz.querySelector('[data-kt-ics]'); if (b) b.onclick = () => { kitBaixaIcs(d); toast('Agenda baixada: abra o arquivo para pôr tudo no celular'); };
  raiz.querySelectorAll('[data-kt-ir]').forEach(a => a.onclick = (e) => { e.preventDefault(); const el = raiz.querySelector('#kt-sv-' + a.dataset.ktIr); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const q = raiz.querySelector('[data-kt-qr]'); if (q && url && typeof qrSvg === 'function') q.innerHTML = qrSvg(url, { tamanho: 110, alt: 'QR code do kit da viagem' }) || '';
}

/* ---------- a página do cliente ---------- */
function kitPaginaCliente(d, url) {
  kitCss();
  paginaPublica('Sua viagem · ' + (d.nome || d.negocio || guiaNegocio()), kitDocHtml(d), { rodape: 'Guarde este link no celular. Qualquer dúvida, fale com a gente no WhatsApp.', waTexto: 'Olá! Sobre a minha viagem…' });
  kitLiga(document.getElementById('pubPrint'), d, url || location.href);
}
/* o curto: lê o kit no banco pelo código */
ROTAS_EXTRA['k'] = async (partes) => {
  const tok = String((partes || [])[0] || '').replace(/[^A-Za-z0-9]/g, '');
  if (!tok) return paginaPublicaErro();
  app.innerHTML = '<main class="wrap"><p class="why center" style="margin-top:40px">Abrindo a sua viagem…</p></main>';
  try {
    const r = await supaFetch('rpc/kit', { method: 'POST', body: JSON.stringify({ p_token: tok }) });
    const d = r.ok ? await r.json() : null;
    if (!d || !d.servicos) return paginaPublicaErro('Este link de viagem não existe mais. Peça um novo pelo WhatsApp.');
    kitPaginaCliente(d, location.href);
  } catch (e) { paginaPublicaErro('Sem internet para abrir a sua viagem. Tente de novo em instantes.'); }
};
/* o comprido: o kit veio dentro do link (também o do e-mail do servidor) */
ROTAS_EXTRA['kt'] = (partes) => abrePublico(partes, (d) => kitPaginaCliente(d, location.href));

/* ---------- a tela do painel: #/adm/kit/<chave> ---------- */
async function admKit(chave) {
  kitCss();
  /* abriu direto aqui (sem passar por outra aba): a sincronia por linha liga do mesmo jeito (os códigos dos kits moram nela) */
  if (typeof itLigar === 'function') itLigar(() => { if (!(typeof isBusyEditing === 'function' && isBusyEditing())) route(); });
  const d = await kitDados(chave);
  if (!d) { toast('Esse cliente ainda não tem reserva confirmada'); go(Kit._volta || '/adm/clients'); return; }
  const bs = kitReservas(chave), c = bs[0].clienteId && typeof Cadastro !== 'undefined' ? Cadastro.get(bs[0].clienteId) : null;
  const fone = kitDig(bs.map(b => b.whats).find(w => kitDig(w).length >= 8) || (c && c.whats) || '');
  document.body.classList.add('em-adm');
  document.title = 'Kit da viagem - ' + (d.nome || 'cliente');
  const voltar = Kit._volta ? '#' + Kit._volta : (bs[0].clienteId ? '#/adm/clients/' + encodeURIComponent('c:' + bs[0].clienteId) : '#/adm/clients');
  app.innerHTML = `<div class="ktTela">
    <div class="doc-barra ktBarra"><a class="mini" href="${esc(voltar)}">← voltar</a>
      <span class="ktAcs"><button class="mini" id="ktCopia">Copiar link</button><button class="mini" id="ktZap">${fone.length >= 8 ? 'Mandar no WhatsApp' : 'Mandar no WhatsApp (escolher contato)'}</button><button class="cta sm" id="ktPdf">Gerar PDF</button></span></div>
    <p class="ktEstado" id="ktEstado">${kitEstadoTxt(chave)}</p>
    <div id="ktPrint">${kitDocHtml(d)}</div>
    <section class="card ktEd"><h3>Dicas para a viagem</h3><p class="why">Vão em todo kit. Uma por linha.</p>
      <textarea id="ktDicasTx" rows="7">${esc(kitDicas().join('\n'))}</textarea>
      <div class="ktEdAcs"><button class="cta sm" id="ktDicasOk">Salvar as dicas</button><button class="mini" id="ktDicasPadrao">Voltar às dicas padrão</button></div></section>
    <section class="card ktEd"><h3>Descontos para o cliente <small class="why">(opcional)</small></h3><p class="why">Lojas, restaurantes… onde o cliente da viagem tem desconto. Uma linha por lugar: <b>Nome | 10 | como usar</b>. Vazio = a seção não aparece.</p>
      <textarea id="ktParcTx" rows="4" placeholder="Gelateria do Centro | 10 | mostrar este kit no caixa">${esc(kitParcTexto())}</textarea>
      <div class="ktEdAcs"><button class="cta sm" id="ktParcOk">Salvar os descontos</button></div></section>
    <p class="why ktNota">Os textos de pagamento, suporte, transfer e passeios vêm da aba Voucher (o que você muda lá vale aqui). O nome do motorista/guia não sai, como no voucher.</p>
  </div>`;
  kitLiga(document.getElementById('ktPrint'), d, Kit.urlConhecida(chave) || kitBase());
  if (typeof pdfLiga === 'function') pdfLiga($('#ktPdf'), () => $('#ktPrint'), () => document.title);
  const pega = async (b) => { b.disabled = true; try { const url = await Kit.link(chave); const e = $('#ktEstado'); if (e) e.textContent = kitEstadoTxt(chave); kitLiga(document.getElementById('ktPrint'), d, url); return url; } finally { b.disabled = false; } };
  $('#ktCopia').onclick = async (e) => { try { const url = await pega(e.target); try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch (x) { prompt('Copie o link:', url); } } catch (x) { toast(x.message); } };
  $('#ktZap').onclick = async (e) => { try { const url = await pega(e.target); const msg = await Kit.mensagem(chave, url);
    window.open(fone.length >= 8 ? waLink(msg, fone) : 'https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener'); } catch (x) { toast(x.message); } };
  $('#ktDicasOk').onclick = () => { DB.settings.kitDicas = $('#ktDicasTx').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 14); save(); Kit.agendar(chave); toast('Dicas salvas'); admKit(chave); };
  $('#ktDicasPadrao').onclick = () => { delete DB.settings.kitDicas; save(); Kit.agendar(chave); toast('Dicas padrão de volta'); admKit(chave); };
  $('#ktParcOk').onclick = () => { DB.settings.kitParceiros = kitParcLe($('#ktParcTx').value); save(); Kit.agendar(chave); toast('Descontos salvos'); admKit(chave); };
  /* abriu o kit: republica (se já tem o curto), para o link do cliente estar igual ao que ela vê */
  if (Kit.curto(chave)) kitPublica(chave, d);
}
function kitEstadoTxt(chave) {
  return Kit.curto(chave) ? '✓ Link curto e sempre atualizado: o cliente vê as mudanças no mesmo link.'
    : kitPodeNuvem() ? 'O link curto nasce quando você mandar ou copiar.'
    : Kit.semTabela ? 'Link comprido: falta ligar a tabela do kit no Supabase (LIGAR-KIT-INGRID.sql). Funciona, mas não se atualiza sozinho.'
    : 'Link comprido (sem login ou sem nuvem): funciona, mas não se atualiza sozinho.';
}

/* ---------- os botões "Kit da viagem" ---------- */
function kitBotao(chave, cls) { return `<button type="button" class="${esc(cls || 'mini')}" data-kit="${esc(chave)}">Kit da viagem</button>`; }
function ktInjeta() {
  try {
    /* ao lado de cada "Voucher" (cartão do serviço, pipeline, ficha) */
    document.querySelectorAll('#stage a.mini[href^="#/adm/voucher/"]').forEach(v => {
      if (v.nextElementSibling && v.nextElementSibling.hasAttribute('data-kit')) return;
      const id = decodeURIComponent(v.getAttribute('href').split('/').pop()); const b = Bookings.get(id); if (!kitVale(b)) return;
      v.insertAdjacentHTML('afterend', kitBotao(kitChaveDe(b), v.className));
    });
    /* no documento do voucher */
    const m = location.hash.match(/^#\/adm\/voucher\/([^/?]+)/), barra = document.querySelector('#app > .doc-barra');
    if (m && barra && !barra.querySelector('[data-kit]')) { const b = Bookings.get(decodeURIComponent(m[1])); if (kitVale(b)) { const v = barra.querySelector('#docVolta'); (v || barra.firstChild).insertAdjacentHTML('afterend', kitBotao(kitChaveDe(b), 'mini strong')); } }
    /* na ficha do cliente */
    const f = location.hash.match(/^#\/adm\/clients\/([^/?]+)/), ac = document.querySelector('#stage .fc-top .tacts');
    if (f && ac && !ac.querySelector('[data-kit]') && typeof cadastroDaRota === 'function') {
      const arg = decodeURIComponent(f[1]), c = cadastroDaRota(arg);
      const bs = DB.bookings.filter(b => kitVale(b) && (c ? b.clienteId === c.id : kitChaveDe(b) === arg)).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      const alvo = bs.find(b => b.date >= addDays(isoToday(), -1)) || bs[bs.length - 1];
      if (alvo) ac.insertAdjacentHTML('beforeend', kitBotao(kitChaveDe(alvo), 'mini strong'));
    }
    document.querySelectorAll('[data-kit]').forEach(bt => { if (bt._kt) return; bt._kt = true; bt.onclick = (e) => { e.preventDefault(); e.stopPropagation(); Kit.abrir(bt.dataset.kit); }; });
  } catch (e) { console.warn('kit', e); }
}
if (typeof MutationObserver === 'function' && typeof app !== 'undefined' && app) new MutationObserver(() => setTimeout(ktInjeta, 0)).observe(app, { childList: true, subtree: true });

/* ---------- reserva mudou → o kit que o cliente já tem se atualiza ---------- */
/* toda mudança de reserva passa por cloudPushBooking/cloudUpdateBooking (painel, assistente, pagamento, escala) */
for (const nome of ['cloudPushBooking', 'cloudUpdateBooking']) {
  if (typeof window[nome] !== 'function') continue;
  const orig = window[nome];
  const emb = function (b) {
    try { if (b) Kit.agendarReserva(b); } catch (e) {}
    /* a marca provisória do "Avisar cliente" (enquanto o kit sobe) não vai para o banco: o gatilho do e-mail só pode ver a de verdade */
    if (b && b.clienteConfirmado && b.clienteConfirmado.publicandoKit) { const c = Object.assign({}, b); delete c.clienteConfirmado; const a = [...arguments]; a[0] = c; return orig.apply(this, a); }
    return orig.apply(this, arguments);
  };
  Object.assign(emb, orig);   /* cloudUpdateBooking._t (as novas tentativas) mora na própria função */
  window[nome] = emb;
}

/* "Avisar cliente": o e-mail de confirmação leva o link do kit. O gatilho do banco dispara quando a
   reserva é marcada — então o kit é publicado ANTES (no máximo 5 s), com o código já no banco. */
if (typeof Bookings !== 'undefined' && typeof Bookings.confirmarCliente === 'function') {
  const _conf = Bookings.confirmarCliente.bind(Bookings);
  Bookings.confirmarCliente = function (id) {
    const b = Bookings.get(id); if (!b || b.clienteConfirmado) return null;
    if (!kitPodeNuvem()) return _conf(id);
    b.clienteConfirmado = { em: new Date().toISOString(), publicandoKit: true };   /* a tela já mostra "avisado" */
    Promise.race([Kit.publicarJa(kitChaveDe(b)), new Promise(r => setTimeout(r, 5000))]).catch(() => {})
      .finally(() => { delete b.clienteConfirmado; _conf(id); });
    return b;
  };
}

/* ---------- os Ajustes que o servidor lê (públicos) ---------- */
/* kitVersao: o e-mail só leva o link #/kt/ em app que sabe abrir o kit.
   avisarClientes: nascia false sem ninguém escolher; liga UMA vez — mas só quando o e-mail
   ao cliente estiver de pé no servidor dela (config.js avisosEmail), senão o botão "Avisar
   cliente" prometeria um e-mail que não sai. */
function kitAjustes(s) {
  if (!s) return s;
  if (+s.kitVersao !== 1) s.kitVersao = 1;
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.avisosEmail && !s.avisoClientesV1) { s.avisarClientes = true; s.avisoClientesV1 = true; }
  return s;
}
if (typeof DB !== 'undefined' && DB && DB.settings) {
  const antes = JSON.stringify([DB.settings.kitVersao, DB.settings.avisarClientes, DB.settings.avisoClientesV1]);
  kitAjustes(DB.settings);
  if (JSON.stringify([DB.settings.kitVersao, DB.settings.avisarClientes, DB.settings.avisoClientesV1]) !== antes) try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
}
/* a nuvem traz os Ajustes de volta a cada leitura (cloud.js chama fillSettings): o kit continua valendo */
if (typeof fillSettings === 'function') { const _fill = fillSettings; fillSettings = function (s) { return kitAjustes(_fill(s)); }; }

/* ---------- o assistente: kit_viagem (só lê: o link e a mensagem pronta) ---------- */
function kitAchaCliente(q) {
  const s = String(q || '').trim(); if (!s) return { erro: 'de qual cliente? (nome, WhatsApp ou código da reserva)' };
  const N = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const vivas = DB.bookings.filter(kitVale);
  let l = vivas.filter(b => N(b.code) === N(s));
  if (!l.length) { const dig = s.replace(/\D/g, ''); if (dig.length >= 6 && /^[\d\s()+-]+$/.test(s)) l = vivas.filter(b => kitDig(b.whats).endsWith(dig.slice(-8))); }
  if (!l.length) l = vivas.filter(b => N(b.name).includes(N(s)) || N(b.email) === N(s));
  if (!l.length) return { erro: 'não achei reserva confirmada desse cliente' };
  const chaves = [...new Set(l.map(kitChaveDe))];
  if (chaves.length > 1 && new Set(l.map(b => b.clienteId || kitChaveDe(b))).size > 1) return { erro: 'mais de um cliente com esse nome — diga qual: ' + [...new Set(l.map(b => b.name))].slice(0, 8).join(', ') };
  const fut = l.filter(b => b.date >= addDays(isoToday(), -1)).sort((a, b) => a.date.localeCompare(b.date));
  return { chave: kitChaveDe(fut[0] || l[l.length - 1]) };
}
if (typeof IA_FERRAMENTAS !== 'undefined' && Array.isArray(IA_FERRAMENTAS)) {
  IA_FERRAMENTAS.push({ name: 'kit_viagem', description: 'O KIT DA VIAGEM de um cliente: UM link com todos os serviços dele (códigos, horários, ponto de encontro com mapa, voo e trajeto do transfer, programa, pagamento, os textos do voucher e as dicas) + a mensagem pronta para ela mandar no WhatsApp. Só lê (não grava nada). Use quando ela pedir "o kit", "o link da viagem", "manda tudo pro cliente".', input_schema: { type: 'object', properties: { cliente: { type: 'string', description: 'nome, WhatsApp ou código da reserva' } }, required: ['cliente'] } });
  if (typeof IA_LEITURA !== 'undefined') IA_LEITURA.add('kit_viagem');
  const kitFerramenta = async (i) => {
    const r = kitAchaCliente(i && i.cliente); if (r.erro) return { erro: r.erro };
    const d = await kitDados(r.chave); if (!d) return { erro: 'esse cliente ainda não tem reserva confirmada' };
    const url = await Kit.link(r.chave);
    return { cliente: d.nome, servicos: d.servicos.map(s => `${s.code} ${s.data} ${s.hora} ${s.nome}`), link: url, curto: /#\/k\//.test(url),
      mensagem_pronta: await Kit.mensagem(r.chave, url), abrir: '#/adm/kit/' + encodeURIComponent(r.chave),
      regra: 'mostre a ela o link e a mensagem pronta; quem manda é ela (no WhatsApp). Não diga que mandou.' };
  };
  if (typeof ING_LER !== 'undefined') ING_LER.kit_viagem = kitFerramenta;
  else if (typeof iaLeitura === 'function') { const _l = iaLeitura; iaLeitura = function (nome, i) { return nome === 'kit_viagem' ? kitFerramenta(i || {}) : _l(nome, i); }; }
}

/* ---------- ligar no app (aba escondida do painel) ---------- */
const _viewAdmKit = viewAdm;
viewAdm = function (tab, arg) { if (tab === 'kit') return admKit(arg ? decodeURIComponent(arg) : ''); return _viewAdmKit(tab, arg); };
/* abriu direto num link do cliente: o app.js já desenhou a capa; agora a página certa */
if (typeof pubRotaDe === 'function' && pubRotaDe()) route();
else if (/^#\/adm\/kit\//.test(location.hash)) route();

function kitCss() {
  if (document.getElementById('ktCss')) return;
  const s = document.createElement('style'); s.id = 'ktCss';
  /* a marca dela: vinho #5B3145 · dourado #E3B23C · marfim #FBF8F3 · Montserrat nos títulos, Karla no texto */
  s.textContent = `
  .ktTela{padding:16px;background:var(--paper);min-height:100vh}
  .ktBarra{position:static;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;max-width:794px;margin:0 auto 12px}
  .ktAcs{display:flex;gap:8px;flex-wrap:wrap}
  .ktEstado,.ktNota{max-width:794px;margin:0 auto 12px;font-size:13.5px;color:var(--ink-2)}
  .ktEd{max-width:794px;margin:16px auto}.ktEd textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink)}
  .ktEdAcs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .ktDoc{--kt-n:#5B3145;--kt-a:#E3B23C;--kt-c:#FBF8F3;--kt-t:#1F171B;--kt-t2:#4A4045;--kt-l:#E6DDD5;--kt-o:#7A5A12;max-width:794px;margin:0 auto;background:var(--kt-c);color:var(--kt-t);border-radius:18px;overflow:hidden;box-shadow:0 18px 50px -30px rgba(0,0,0,.4);font:15px/1.5 var(--f-ui,Karla,system-ui,sans-serif)}
  .ktDoc h1,.ktDoc h2,.ktDoc h3,.ktDoc h4{font-family:var(--f-display,Montserrat,system-ui);color:var(--kt-n);margin:0}
  .kt-topo{background:var(--kt-n);color:var(--kt-c);padding:28px 28px 24px;position:relative}
  .kt-topo h1{color:#fff;font-size:30px;line-height:1.15;margin:6px 0 4px;overflow-wrap:anywhere}
  .kt-selo{width:66px;height:66px;object-fit:contain;float:right;margin-left:12px}
  .kt-eyebrow{margin:0;font:700 11px/1.3 var(--f-ui,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--kt-a)}
  .kt-svCorpo .kt-eyebrow{color:var(--kt-o)}
  .kt-per{margin:0;opacity:.9}
  .kt-acsTopo{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;clear:both}
  .kt-cta{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;background:var(--kt-a);color:#1F171B;font-weight:700;text-decoration:none;border:0;cursor:pointer;font-size:14.5px}
  .kt-cta svg{width:18px;height:18px}
  .kt-bt{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid rgba(251,248,243,.45);background:transparent;color:var(--kt-c);font:600 14px/1 var(--f-ui,system-ui);cursor:pointer}
  .kt-plantao{margin:16px 22px 0;padding:10px 14px;border-radius:12px;background:#F7EDD8;color:var(--kt-t);font-size:14px}
  .kt-lista{display:grid;margin:18px 22px 4px;border:1px solid var(--kt-l);border-radius:14px;overflow:hidden;background:#fff}
  .kt-lista a{display:grid;grid-template-columns:58px 1fr auto;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid var(--kt-l);color:var(--kt-t);text-decoration:none}
  .kt-lista a:first-child{border-top:0}
  .kt-lista b{overflow-wrap:anywhere}
  .kt-ld{font:700 13px/1 var(--f-mono,ui-monospace);color:var(--kt-n)}
  .kt-lista span:last-child{color:var(--kt-t2);font-size:13px}
  .kt-sv{margin:18px 22px;background:#fff;border:1px solid var(--kt-l);border-radius:16px;overflow:hidden}
  .kt-svTopo{position:relative;min-height:12px}
  .kt-svTopo img{display:block;width:100%;height:170px;object-fit:cover}
  .kt-dia{position:absolute;left:14px;bottom:-22px;width:60px;padding:6px 0;border-radius:12px;background:var(--kt-n);color:#fff;text-align:center;line-height:1.05;box-shadow:0 6px 16px -8px rgba(0,0,0,.5)}
  .kt-svTopo.sem .kt-dia{position:static;margin:14px 0 0 14px}
  .kt-dia b{display:block;font:700 22px/1 var(--f-display,system-ui);color:var(--kt-a)}
  .kt-dia small{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.9}
  .kt-svCorpo{padding:30px 20px 18px}
  .kt-svTopo.sem + .kt-svCorpo{padding-top:14px}
  .kt-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .kt-cod{flex:none;text-align:center;padding:6px 12px;border:1.5px dashed var(--kt-n);border-radius:12px;background:var(--kt-c);line-height:1.1;margin-top:-8px}
  .kt-cod small{display:block;font:700 9.5px/1.2 var(--f-ui,system-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--kt-t2)}
  .kt-cod b{display:block;font:800 17px/1.2 var(--f-mono,ui-monospace);color:var(--kt-n);letter-spacing:.04em}
  .kt-svCorpo h2{font-size:21px;line-height:1.25;margin:4px 0 2px;overflow-wrap:anywhere}
  .kt-res{margin:0 0 6px;color:var(--kt-t2)}
  .kt-grade{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
  .kt-grade > div{background:var(--kt-c);border-radius:12px;padding:10px 12px;min-width:0}
  .kt-grade .kt-lg{grid-column:1/-1}
  .kt-grade small,.kt-pg small{display:block;font:700 10.5px/1.2 var(--f-ui,system-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--kt-t2)}
  .kt-grade b{display:block;color:var(--kt-n);margin-top:2px;overflow-wrap:anywhere}
  .kt-grade span{display:block;color:var(--kt-t2);font-size:13.5px;overflow-wrap:anywhere}
  .kt-lk{display:inline-flex;align-items:center;gap:6px;margin-top:6px;color:var(--kt-n);font-weight:700;font-size:14px;text-decoration:underline;text-underline-offset:3px}
  .kt-lk svg{width:16px;height:16px}
  .kt-sv h3,.kt-box h3{font-size:15px;margin:14px 0 6px}
  .kt-par{margin:0;padding-left:22px}.kt-par li{margin:5px 0}.kt-par li b{display:block;color:var(--kt-n)}.kt-par li span{color:var(--kt-t2);font-size:13.5px}
  .kt-duas{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .kt-ok,.kt-no,.kt-levar{margin:0;padding:0;list-style:none}
  .kt-ok li,.kt-no li,.kt-levar li{position:relative;padding:3px 0 3px 22px;font-size:14px}
  .kt-ok li::before{content:"✓";position:absolute;left:2px;color:#2E6B4F;font-weight:800}
  .kt-no li::before{content:"–";position:absolute;left:4px;color:#a3053f;font-weight:800}
  .kt-levar li::before{content:"";position:absolute;left:6px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--kt-a)}
  .kt-levar li.kt-marcado{font-weight:700}
  .kt-pg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 8px}
  .kt-pg > div{border-radius:12px;padding:10px 12px;background:#E3EDE6}
  .kt-pg > div.resta{background:#F7EDD8}
  .kt-pg b{display:block;font:700 19px/1.2 var(--f-display,system-ui);color:var(--kt-n)}
  .kt-pg span{display:block;font-size:12.5px;color:var(--kt-t2)}
  .kt-tot{margin:14px 22px 0}
  .kt-acs{margin-top:8px}
  .kt-fino{margin:10px 0 0;font-size:12.5px;color:var(--kt-t2)}
  .kt-box{margin:18px 22px;padding:16px 18px;background:#fff;border:1px solid var(--kt-l);border-radius:16px}
  .kt-box > .kt-lk{display:flex}
  .kt-info .kt-infoT{margin:0 0 4px;font-size:17px}
  .kt-blk{padding:10px 0;border-top:1px solid var(--kt-l)}
  .kt-blk:first-of-type{border-top:0}
  .kt-blk h4{font-size:13px;letter-spacing:.08em;margin:8px 0 4px}
  .kt-blk p{margin:4px 0;font-size:14px}
  .kt-blk .kt-sub{font-weight:700;color:var(--kt-n);margin-top:8px}
  .kt-parc{display:flex;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--kt-l)}
  .kt-parc:first-of-type{border-top:0}
  .kt-parc i{font-style:normal;min-width:54px;text-align:center;padding:6px 8px;border-radius:10px;background:var(--kt-n);color:var(--kt-a);font-weight:800}
  .kt-parc small{display:block;color:var(--kt-t2)}
  .kt-pe{display:flex;gap:16px;align-items:center;margin:18px 0 0;padding:18px 22px;background:var(--kt-n);color:var(--kt-c)}
  .kt-pe b{display:block;color:#fff}.kt-pe span{display:block;font-size:13px;opacity:.9;overflow-wrap:anywhere}
  .kt-qr{flex:none;width:110px;min-height:10px;background:#fff;border-radius:10px;padding:6px}
  .kt-qr:empty{display:none}
  .kt-qr svg{display:block;width:100%;height:auto}
  .kt-cont{margin-top:6px}
  @media(max-width:620px){.ktTela{padding:10px}.kt-topo{padding:22px 18px 18px}.kt-topo h1{font-size:25px}.kt-selo{width:52px;height:52px}
    .kt-sv,.kt-box{margin:14px 10px}.kt-lista,.kt-tot,.kt-plantao{margin-left:10px;margin-right:10px}.kt-grade,.kt-duas{grid-template-columns:1fr}.kt-svCorpo{padding:28px 14px 14px}.kt-pe{flex-direction:column;align-items:flex-start}}
  @media print{.kt-tela{display:none!important}}`;
  document.head.appendChild(s);
}
