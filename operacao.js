/* =====================================================
   OPERACAO — os dados do dia a dia da Ingrid

   Nasceu do pedido de 28/09/2026 (brainstorm "EM roma" + a reuniao do Meet).
   Ela nao e mais a guia: ela AGENCIA. Tem guias e motoristas na Italia
   toda, recebe um sinal e o resto e pago no dia, em dinheiro, para quem
   faz o servico. E recebe em varias contas, no Brasil e na Europa, com um
   contador em cada lado.

   Este arquivo e so a camada de dados — nada de tela. Da para testar sem
   navegador (testes/operacao.test.js). As telas estao em operacao-telas.js.

   Colecoes novas no DB (so no aparelho enquanto nao houver banco; quando
   houver, vao para tabelas PRIVADAS, nunca para o "appstate", que e
   publico):
     DB.equipe     [{id, nome, tipo:'guia'|'motorista', whats, cidades[], idiomas, obs, pref}]
     DB.disp       [{pessoaId, data, turno, estado:'livre'|'ocupada', nota, em}]
     DB.contas     [{id, nome, pais:'brasil'|'europa', metodo}]
     DB.orcamentos [{id, num, criado, status, origem, pedidoId, cliente{}, itens[], ...}]
     DB.fichas     {chaveDoCliente: {notas, tags}}
   E na reserva (Booking), os campos da operacao:
     voo, origem, destino, obsOp, prestadorId, restoPara:'prestador'|'ingrid',
     custo, acertado
   ===================================================== */
'use strict';

/* ---------- turnos ----------
   Ela pensa em MANHA e TARDE ("bloquear a parte da manha ou a parte da
   tarde quando ela ja me fala: nao posso, ja to ocupada"). A noite existe
   porque ha passeio noturno as 19h30. "Dia inteiro" e so um atalho que
   marca os tres. */
const TURNOS = [['manha', 'Manhã', 'Morning'], ['tarde', 'Tarde', 'Afternoon'], ['noite', 'Noite', 'Evening']];
function turnoNome(tu) {
  if (tu === 'dia') return (typeof LANG !== 'undefined' && LANG === 'en') ? 'All day' : 'Dia inteiro';
  const r = TURNOS.find(x => x[0] === tu);
  return r ? ((typeof LANG !== 'undefined' && LANG === 'en') ? r[2] : r[1]) : tu;
}
function turnoDaHora(h) {
  const m = String(h || '').match(/(\d{1,2})/);
  const n = m ? +m[1] : 9;
  return n < 13 ? 'manha' : n < 18 ? 'tarde' : 'noite';
}
/* Um bate e volta ocupa o dia; um passeio de 3h ocupa o turno em que comeca.
   Um de 4h que comeca as 11h entra pela tarde — conta os dois. */
function turnosDoServico(b) {
  const x = typeof Tours !== 'undefined' ? Tours.get(b.tourId) : null;
  if (x && (x.type === 'day' || x.type === 'conexao')) return ['manha', 'tarde'];
  const t0 = turnoDaHora(b.time);
  const hIni = parseInt(String(b.time || '').match(/(\d{1,2})/)?.[1] || '9', 10);
  const dur = parseInt(String((x && x.duration) || '').match(/(\d+)\s*h/)?.[1] || '0', 10);
  if (t0 === 'manha' && dur && hIni + dur > 13) return ['manha', 'tarde'];
  return [t0];
}

/* ---------- guias e motoristas ---------- */
function _opSave() {
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
  /* a linha que mudou sobe para o banco em ~1 s (nuvem-itens.js) */
  if (typeof itAgendar === 'function') itAgendar();
}
function _opSaveBooking(b) {
  try { if (typeof Orc !== 'undefined' && Orc.daReserva) Orc.daReserva(b); } catch (e) {}
  _opSave();
  if (b && typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
}
const Equipe = {
  /* na ordem de preferencia dela: "eu pego sempre as melhores primeiro" */
  all(tipo) {
    return [...(DB.equipe || [])]
      .filter(p => !tipo || p.tipo === tipo)
      .sort((a, b) => (a.pref || 0) - (b.pref || 0));
  },
  get(id) { return (DB.equipe || []).find(p => p.id === id) || null; },
  salva(p) {
    DB.equipe = DB.equipe || [];
    const limpa = (v) => String(v || '').trim();
    const dados = {
      nome: limpa(p.nome), tipo: p.tipo === 'motorista' ? 'motorista' : 'guia',
      whats: limpa(p.whats), idiomas: limpa(p.idiomas), obs: limpa(p.obs),
      cidades: (Array.isArray(p.cidades) ? p.cidades : String(p.cidades || '').split(','))
        .map(limpa).filter(Boolean),
    };
    if (!dados.nome) return null;
    let x = p.id && Equipe.get(p.id);
    if (x) Object.assign(x, dados);
    else {
      const ult = Math.max(0, ...DB.equipe.map(q => q.pref || 0));
      x = { id: uid(), pref: ult + 1, ...dados };
      DB.equipe.push(x);
    }
    _opSave();
    return x;
  },
  remove(id) {
    DB.equipe = (DB.equipe || []).filter(p => p.id !== id);
    DB.disp = (DB.disp || []).filter(d => d.pessoaId !== id);
    for (const b of DB.bookings) if (b.prestadorId === id) { b.prestadorId = ''; }
    _opSave();
  },
  /* sobe ou desce na ordem de preferencia, dentro do mesmo tipo */
  move(id, dir) {
    const p = Equipe.get(id); if (!p) return;
    const lista = Equipe.all(p.tipo);
    const i = lista.findIndex(q => q.id === id), j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= lista.length) return;
    const tmp = lista[i].pref; lista[i].pref = lista[j].pref; lista[j].pref = tmp;
    if (lista[i].pref === lista[j].pref) lista[j].pref += dir < 0 ? 1 : -1;
    _opSave();
  },
  cidades() {
    const s = new Set();
    for (const p of DB.equipe || []) for (const c of p.cidades || []) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  },
  atende(p, cidade) {
    if (!cidade) return true;
    const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (p.cidades || []).some(c => n(c) === n(cidade));
  },
};

/* ---------- disponibilidade ----------
   Ela nao tem a agenda das guias ("elas fazem tudo a mao no papel"). O que
   existe e o que cada uma RESPONDEU: livre ou ocupada, por dia e turno.
   E o servico que ela mesma ja passou para a guia tambem ocupa — esse o
   app sabe sozinho, sem ela marcar nada. */
const Disp = {
  _linha(pessoaId, data, turno) {
    return (DB.disp || []).find(d => d.pessoaId === pessoaId && d.data === data && d.turno === turno);
  },
  /* {estado:'ocupada'|'livre'|'', servico?, nota?} */
  estado(pessoaId, data, turno) {
    const b = DB.bookings.find(x => x.prestadorId === pessoaId && x.date === data
      && x.status !== 'cancelled' && turnosDoServico(x).includes(turno));
    if (b) return { estado: 'ocupada', servico: b };
    const l = Disp._linha(pessoaId, data, turno);
    return l ? { estado: l.estado, nota: l.nota || '' } : { estado: '' };
  },
  /* estado '' apaga a resposta (volta a "nao perguntei") */
  marca(pessoaId, data, turno, estado, nota) {
    DB.disp = DB.disp || [];
    const turnos = turno === 'dia' ? TURNOS.map(x => x[0]) : [turno];
    for (const tu of turnos) {
      DB.disp = DB.disp.filter(d => !(d.pessoaId === pessoaId && d.data === data && d.turno === tu));
      if (estado) DB.disp.push({ pessoaId, data, turno: tu, estado, nota: String(nota || '').trim(), em: new Date().toISOString() });
    }
    _opSave();
  },
  /* "dia 25/10 de manha, que guia de Roma esta livre?" — por preferencia.
     Volta todo mundo, separado em livres, sem resposta e ocupadas: a que
     nao respondeu ainda pode ser a melhor opcao, e ela decide. */
  quem({ data, turno, cidade, tipo }) {
    const turnos = turno === 'dia' ? ['manha', 'tarde'] : [turno];
    const gente = Equipe.all(tipo || 'guia').filter(p => Equipe.atende(p, cidade));
    const livres = [], semResposta = [], ocupadas = [];
    for (const p of gente) {
      const es = turnos.map(tu => Disp.estado(p.id, data, tu));
      const ocup = es.find(e => e.estado === 'ocupada');
      if (ocup) ocupadas.push({ p, ...ocup });
      else if (es.every(e => e.estado === 'livre')) livres.push({ p, estado: 'livre', nota: es.map(e => e.nota).filter(Boolean).join(' · ') });
      else semResposta.push({ p, estado: '' });
    }
    return { livres, semResposta, ocupadas };
  },
};

/* ---------- a reserva vista pela operacao ---------- */
const Op = {
  /* Quem recebe o resto. O caso mais comum dela: sinal na reserva e o resto
     NO DIA, em dinheiro, para a guia ou o motorista. Transfer ja nasce
     assim (politica 'sinal'). Quando ela recebe tudo (agencia, cliente que
     "nao quer tocar em dinheiro"), o resto e com ela. */
  restoPara(b) {
    if (b.restoPara === 'prestador' || b.restoPara === 'ingrid') return b.restoPara;
    return b.policy === 'sinal' ? 'prestador' : 'ingrid';
  },
  /* O caso da semana da reuniao: "Ingrid, o cliente quer pagar 35". Eram 70.
     Esta e a linha que responde isso sem abrir planilha. */
  /* UMA regra para o dinheiro que falta (revisão de 02/10): o SINAL combinado que
     ainda não caiu é da Ingrid (ela cobra); só o resto é pago no dia a quem faz.
     Antes o sinal não pago aparecia como "pague €95 ao motorista". */
  pagoIngrid(b) { return Math.round((b.payments || []).filter(p => p.conta !== CONTA_PRESTADOR).reduce((s, p) => s + (+p.amount || 0), 0) * 100) / 100; },
  sinalFalta(b) {
    if (!b || b.status === 'cancelled' || Op.restoPara(b) !== 'prestador' || !(+b.sinal > 0)) return 0;
    return Math.min(Bookings.due(b), Math.max(0, Math.round((+b.sinal - Op.pagoIngrid(b)) * 100) / 100));
  },
  dueNoDia(b) { return b && b.status !== 'cancelled' && Op.restoPara(b) === 'prestador' ? Math.max(0, Math.round((Bookings.due(b) - Op.sinalFalta(b)) * 100) / 100) : 0; },
  dueIngrid(b) { return !b || b.status === 'cancelled' ? 0 : Op.restoPara(b) === 'prestador' ? Op.sinalFalta(b) : Bookings.due(b); },
  noDia(b) {
    const falta = Bookings.due(b);
    if (b.status === 'cancelled' || falta <= 0) return { valor: 0, para: '', pessoa: null, sinalFalta: 0 };
    const para = Op.restoPara(b), sf = Op.sinalFalta(b);
    return { valor: para === 'prestador' ? Op.dueNoDia(b) : falta, para, sinalFalta: sf, pessoa: b.prestadorId ? Equipe.get(b.prestadorId) : null };
  },
  escala(bookingId, pessoaId) {
    const b = Bookings.get(bookingId); if (!b) return null;
    b.prestadorId = pessoaId || '';
    _opSaveBooking(b);
    return b;
  },
  /* voo, onde buscar, para onde, observacao, quem faz, custo, quem recebe */
  detalhes(bookingId, d) {
    const b = Bookings.get(bookingId); if (!b) return null;
    const campos = ['voo', 'origem', 'destino', 'obsOp'];
    for (const k of campos) if (d[k] !== undefined) b[k] = String(d[k] || '').trim();
    if (d.prestadorId !== undefined) b.prestadorId = d.prestadorId || '';
    if (d.custo !== undefined) b.custo = Math.max(0, +d.custo || 0);
    if (d.restoPara !== undefined) b.restoPara = d.restoPara === 'prestador' ? 'prestador' : d.restoPara === 'ingrid' ? 'ingrid' : '';
    _opSaveBooking(b);
    return b;
  },
  /* Os links que ficam no servico, como na ficha dela: PDF do ingresso, QR
     code, voucher do parceiro (ela guarda no Drive e cola o link aqui). */
  linkAdd(bookingId, nome, url) {
    const b = Bookings.get(bookingId); if (!b) return null;
    const u = String(url || '').trim(); if (!/^https?:\/\//i.test(u)) return { erro: 'o link precisa começar com http' };
    b.links = b.links || []; const l = { id: uid(), nome: String(nome || '').trim() || 'link', url: u };
    b.links.push(l); _opSaveBooking(b); return l;
  },
  linkRemove(bookingId, linkId) { const b = Bookings.get(bookingId); if (!b) return; b.links = (b.links || []).filter(l => l.id !== linkId); _opSaveBooking(b); },
  /* ingressos: precisa? ja comprou? (servico com ingresso na tabela do passeio) */
  precisaIngresso(b) { const x = Tours.get(b.tourId); return !!((x && (x.ingressos || []).length) || (b.ingressos && (b.ingressos.total || b.ingressos.totalDia))); },
  ingressosOk(bookingId, sim) { const b = Bookings.get(bookingId); if (!b) return; b.ingressosOk = sim ? isoToday() : ''; _opSaveBooking(b); },
  /* servicos sem guia/motorista nos proximos N dias */
  semPrestador(dias) {
    const hoje = isoToday(), ate = addDays(hoje, dias || 7);
    return DB.bookings.filter(b => b.status !== 'cancelled' && !b.prestadorId && b.date >= hoje && b.date <= ate)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
  doDia(data) {
    return DB.bookings.filter(b => b.status !== 'cancelled' && b.date === data)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  },
  /* Emergencia: "o cliente chegou e nao acha o motorista". Ela digita um
     pedaco do nome, o voo ou o codigo e acha em segundos. */
  /* BUSCA GERAL (pedido da Ingrid, 03/10): nome, palavra-chave ou os 4 últimos números do telefone,
     em serviços, clientes, orçamentos, tarefas, anotações, guias/motoristas e parceiros */
  procuraTudo(q) {
    const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const s = n(q).trim(); if (s.length < 2) return null;
    const dig = s.replace(/\D/g, '');
    const tem = (...vs) => vs.some(v => v && n(v).includes(s)) || (dig.length >= 4 && vs.some(v => /\d{4}/.test(String(v || '')) && String(v).replace(/\D/g, '').endsWith(dig.slice(-8))));
    const T = typeof Tarefas !== 'undefined' ? Tarefas.all() : [];
    const R = {
      servicos: Op.busca(q).slice(0, 8),
      clientes: (typeof Cadastro !== 'undefined' ? Cadastro.all() : []).filter(c => tem(c.nome, c.whats, c.email, c.indicadoNome, c.pais)).slice(0, 8),
      orcamentos: (typeof Orc !== 'undefined' ? Orc.all() : []).filter(o => tem(o.cliente.nome, o.cliente.whats, o.cliente.email, o.num, o.obs, (o.itens || []).map(x => x.desc).join(' '))).slice(0, 8),
      tarefas: T.filter(t => t.tipo !== 'nota' && !t.feita && Tarefas.casa(t, q)).slice(0, 8),
      notas: T.filter(t => t.tipo === 'nota' && Tarefas.casa(t, q)).slice(0, 6),
      equipe: (typeof Equipe !== 'undefined' ? Equipe.all() : []).filter(p => tem(p.nome, p.whats, p.obs, (p.cidades || []).join(' '))).slice(0, 6),
      parceiros: (typeof Parceiros !== 'undefined' ? Parceiros.all() : []).filter(p => tem(p.nome, p.cupom, p.contato)).slice(0, 6),
    };
    R.total = Object.values(R).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
    return R;
  },
  busca(q) {
    const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const s = n(q).trim(); if (s.length < 2) return [];
    const dig = s.replace(/\D/g, '');
    return DB.bookings.filter(b => {
      if ([b.name, b.code, b.voo, b.origem, b.destino, b.email].some(v => n(v).includes(s))) return true;
      if (dig.length >= 4 && String(b.whats || '').replace(/\D/g, '').endsWith(dig.slice(-8))) return true;   // 4 últimos números do telefone
      return (b.group || []).some(g => n(g.nome).includes(s));
    }).sort((a, b) => Math.abs(new Date(a.date) - new Date(isoToday())) - Math.abs(new Date(b.date) - new Date(isoToday())));
  },
};

/* ---------- contas e pagamentos ----------
   Ela recebe em Nubank (Brasil), Wise Brasil, Wise Europa, Revolut, link de
   cartao (Europa), em dinheiro, e numa conta separada quando ela mesma
   acompanha. Na hora de registrar ela escolhe a conta; a conta sabe de que
   lado do oceano esta, e cada contador recebe so o dele. */
const CONTA_PRESTADOR = 'prestador';
function contasPadrao() {
  return [
    { id: 'nubank',   nome: 'Nubank (Pix)',            pais: 'brasil', metodo: 'pix' },
    { id: 'wise-br',  nome: 'Wise Brasil',             pais: 'brasil', metodo: 'transfer' },
    { id: 'wise-eu',  nome: 'Wise Europa',             pais: 'europa', metodo: 'transfer' },
    { id: 'revolut',  nome: 'Revolut',                 pais: 'europa', metodo: 'transfer' },
    { id: 'cartao',   nome: 'Link de cartão',          pais: 'europa', metodo: 'card' },
    { id: 'dinheiro', nome: 'Dinheiro (em mãos)',      pais: 'europa', metodo: 'cash' },
    { id: 'acomp',    nome: 'Conta de acompanhamento', pais: 'europa', metodo: 'transfer' },
  ];
}
const Contas = {
  all() { return DB.contas || []; },
  get(id) { return (DB.contas || []).find(c => c.id === id) || null; },
  salva(c) {
    DB.contas = DB.contas || [];
    const nome = String(c.nome || '').trim(); if (!nome) return null;
    const dados = { nome, pais: c.pais === 'brasil' ? 'brasil' : 'europa', metodo: c.metodo || 'transfer' };
    let x = c.id && Contas.get(c.id);
    if (x) Object.assign(x, dados); else { x = { id: uid(), ...dados }; DB.contas.push(x); }
    _opSave(); return x;
  },
  remove(id) { DB.contas = (DB.contas || []).filter(c => c.id !== id); _opSave(); },
  nome(id) {
    if (id === CONTA_PRESTADOR) return (typeof LANG !== 'undefined' && LANG === 'en') ? 'Paid on the day to the guide/driver' : 'Pago no dia ao guia/motorista';
    const c = Contas.get(id); return c ? c.nome : '';
  },
};
/* De que lado cai o pagamento. Pagamento antigo, sem conta, segue a regra
   de antes (Pix = Brasil, o resto = Europa). 'prestador' nao e dela: e o
   dinheiro que a guia recebeu na mao — nao entra em contabilidade nenhuma. */
function ladoDoPagamento(p) {
  if (p.conta === CONTA_PRESTADOR) return 'prestador';
  const c = p.conta && Contas.get(p.conta);
  if (c) return c.pais;
  return String(p.method || '').toLowerCase() === 'pix' ? 'brasil' : 'europa';
}
/* Registrar um pagamento de qualquer valor — o sinal, uma parte, o resto.
   O antigo "recebi o saldo" so sabia dar baixa no total. */
function registraPagamento(bookingId, { valor, conta, data }) {
  const b = Bookings.get(bookingId); if (!b) return null;
  const falta = Bookings.due(b);
  const v = Math.round(Math.min(Math.max(0, +valor || 0), falta) * 100) / 100;
  if (v <= 0) return null;
  const pago = Bookings.paid(b);
  const kind = (pago === 0 && v >= b.total) ? 'full' : (v >= falta ? 'balance' : 'deposit');
  const c = Contas.get(conta);
  const method = conta === CONTA_PRESTADOR ? 'cash' : (c ? c.metodo : 'other');
  const p = { amount: v, date: data || isoToday(), method, kind, conta: conta || '' };
  b.payments.push(p);
  if (conta === CONTA_PRESTADOR) b.restoPara = 'prestador';
  _opSaveBooking(b);
  return p;
}
/* Extrato por conta: o que caiu em cada uma no periodo */
function extratoContas(de, ate) {
  const linhas = [];
  for (const b of DB.bookings) {
    for (const p of b.payments || []) {
      if (p.date < de || p.date > ate) continue;
      linhas.push({ date: p.date, client: b.name, tourId: b.tourId, code: b.code, bookingId: b.id,
                    amount: p.amount, kind: p.kind, method: p.method, conta: p.conta || '',
                    lado: ladoDoPagamento(p) });
    }
  }
  return linhas.sort((a, b) => a.date.localeCompare(b.date));
}
/* O acerto com cada guia/motorista. custo = o que ela paga a pessoa pelo
   servico. Se a pessoa recebeu o resto do cliente no dia, isso ja conta como
   pagamento a ela; a diferenca e o acerto (positivo: Ingrid paga; negativo:
   a guia devolve a Ingrid). */
function acertos(de, ate) {
  const out = [];
  for (const b of DB.bookings) {
    if (b.status === 'cancelled' || !b.prestadorId || b.date < de || b.date > ate) continue;
    const custo = +b.custo || 0;
    const noDiaRecebido = (b.payments || []).filter(p => p.conta === CONTA_PRESTADOR).reduce((s, p) => s + p.amount, 0);
    const aReceberNoDia = Op.dueNoDia(b);
    const comPrestador = noDiaRecebido + aReceberNoDia;
    if (!custo && !comPrestador) continue;
    out.push({ b, pessoa: Equipe.get(b.prestadorId), custo, comPrestador, saldo: custo - comPrestador, acertado: !!b.acertado });
  }
  return out.sort((a, b) => a.b.date.localeCompare(b.b.date));
}
function marcaAcertado(bookingId, sim) {
  const b = Bookings.get(bookingId); if (!b) return;
  b.acertado = sim ? isoToday() : '';
  _opSaveBooking(b);
}

/* ---------- ficha do cliente ----------
   A mesma chave que Clients.all() usa, para a ficha achar tudo dele. */
function chaveCliente(b) { return String(b.email || b.whats || b.name || '').toLowerCase(); }
const Fichas = {
  get(k) { DB.fichas = DB.fichas || {}; return DB.fichas[k] || { notas: '', tags: '' }; },
  salva(k, d) {
    DB.fichas = DB.fichas || {};
    DB.fichas[k] = { notas: String(d.notas || ''), tags: String(d.tags || ''), em: new Date().toISOString() };
    _opSave();
  },
  reservas(k) {
    return DB.bookings.filter(b => chaveCliente(b) === k)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  },
  /* pedidos e orcamentos do mesmo cliente: pelo WhatsApp ou pelo e-mail */
  doCliente(k, whats, email) {
    const w = String(whats || '').replace(/\D/g, '');
    const bate = (x) => {
      const xw = String(x.whats || '').replace(/\D/g, '');
      return (w.length >= 6 && xw && xw.endsWith(w.slice(-8))) || (email && x.email && x.email.toLowerCase() === email.toLowerCase());
    };
    return {
      pedidos: (DB.pedidos || []).filter(bate),
      orcamentos: (DB.orcamentos || []).filter(o => o.clienteKey === k || bate(o.cliente || {})),
    };
  },
};

/* ---------- sob consulta: orcamentos ----------
   O cliente pede varias coisas (transfer, passeio em Roma, passeio em
   Florenca, transfer de saida em Milao). Vira UM orcamento. O app deixa o
   rascunho pronto; ELA confere e manda — nada sai sozinho para o cliente
   ("eu supervisiono tudo que ela ta fazendo antes de mandar"). */
const ORC_STATUS = [
  ['novo', 'Novo', 'New'], ['rascunho', 'Em montagem', 'Drafting'], ['enviado', 'Enviado', 'Sent'],
  ['fechado', 'Fechou', 'Won'], ['perdido', 'Não fechou', 'Lost'],
];
/* O QUE VAI PARA O CLIENTE (Doc 07/10 item 5): nunca "ela informou" — sempre "foi informado". */
function orcTextoCliente(t) {
  return String(t || '').trim()
    .replace(/\b(?:ela|ele|a cliente|o cliente|a ingrid|ingrid|a passageira|o passageiro)\s+(?:nos\s+|me\s+)?(?:informou|disse|falou|comentou|avisou|contou|mencionou)\b/gi, 'foi informado')
    .replace(/\bsegundo (?:ela|ele|a cliente|o cliente)\b/gi, 'conforme informado')
    .replace(/(^|[.!?]\s+)foi informado/g, (m, a) => a + 'Foi informado');
}
/* TRANSFER SEM TODOS OS DADOS (Doc 07/10 item 5): só o que FALTA para este transfer, no texto dela */
function transferFalta(i, o) {
  if (!i || i.perdido) return [];
  const t = [i.desc, i.obs, i.voo].join(' ');
  if (!/transfer|\b(FCO|CIA|MXP|LIN|BGY|NAP|VCE|FLR)\b|aeroporto|fiumicino|ciampino|malpensa|linate|esta[çc][aã]o|termini|tiburtina|porto|civitavecchia|navio/i.test(t)) return [];
  const f = [], voo = String(i.voo || '').trim();
  if (/\b(FCO|CIA|MXP|LIN|BGY|NAP|VCE|FLR)\b|aeroporto|fiumicino|ciampino|malpensa|linate/i.test(t) && !voo && !/\b[A-Z]{2}\s?\d{2,4}\b/.test(String(i.desc || '').replace(/\b(FCO|CIA|MXP|LIN|BGY|NAP|VCE|FLR)\b/g, ''))) f.push('o número do voo');
  else if (/esta[çc][aã]o|termini|tiburtina|\btrem\b/i.test(t) && !voo) f.push('o número do trem');
  else if (/porto|civitavecchia|navio|cruzeiro/i.test(t) && !voo) f.push('o nome do navio');
  if (!String(i.hora || '').trim()) f.push('o horário');
  if (/\bcentro\b/i.test(i.desc || '') || !/hotel|\bvia\b|piazza|viale|largo|corso|endere/i.test(t)) f.push('o nome e o endereço do hotel');
  /* Doc 08/10 item 3: malas não declaradas → a frase dela, inteira (com os outros volumes) */
  const bag = String((o && o.bagagem) || '');
  if (!/mala|bagag/i.test(t + ' ' + bag)) f.push('a quantidade e o tamanho das malas e outros volumes, se houver (carrinho de bebê, equipamento esportivo, caixas, mochilas de despachar ou malas de 10 kg)');
  return f;
}
function transferFaltaTexto(i, o) {
  const f = transferFalta(i, o); if (!f.length) return '';
  return 'Caso queira reservar o transfer, precisamos de: ' + (f.length > 1 ? f.slice(0, -1).join(', ') + ' e ' + f[f.length - 1] : f[0]) + '.';
}
const Orc = {
  /* UM DADO, UM LUGAR (Doc 09/10 item 1): a reserva e o serviço do orçamento de onde ela veio são a
     mesma coisa. Mudou na Planilha, no voucher ou pelo assistente (reserva) → o orçamento acompanha;
     mudou no orçamento já fechado → as reservas acompanham (e o voucher, que lê a reserva). */
  _itemDa(b, o) {
    if (!o || !b) return null;
    if (b.orcItemId) return o.itens.find(i => i.id === b.orcItemId) || null;
    /* reservas de antes deste ajuste: acha pelo dia (e pela hora/serviço quando há mais de um) */
    const mesmos = o.itens.filter(i => !i.perdido && i.data === b.date);
    const it = mesmos.length === 1 ? mesmos[0] : mesmos.find(i => (i.hora || '09:00') === (b.time || '09:00') && (!b.servicoTxt || String(i.desc).trim() === String(b.servicoTxt).trim())) || null;
    if (it) b.orcItemId = it.id;
    return it;
  },
  daReserva(b) {
    if (!b || !b.orcamentoId || Orc._sincronizando) return;
    const o = Orc.get(b.orcamentoId); const it = Orc._itemDa(b, o); if (!it) return;
    const novo = { data: b.date || it.data, hora: b.time || it.hora, pax: +b.pax || it.pax, valor: b.total != null ? +b.total : it.valor };
    if (b.servicoTxt) novo.desc = b.servicoTxt;
    if (b.custo != null) novo.custo = +b.custo || 0;
    if (b.obsOp != null && b.obsOp !== '') novo.obs = b.obsOp;
    if (b.voo) novo.voo = b.voo;
    Object.assign(it, novo);
    if (b.name && o.cliente) o.cliente.nome = o.cliente.nome || b.name;
    o.itens = Orc.ordena(o.itens);
  },
  /* orçamento FECHADO editado → as reservas dele recebem o que mudou */
  paraReservas(o) {
    if (!o || o.status !== 'fechado') return;
    Orc._sincronizando = true;
    try {
      for (const b of DB.bookings || []) {
        if (b.orcamentoId !== o.id || b.status === 'cancelled') continue;
        const it = Orc._itemDa(b, o); if (!it) continue;
        const antes = JSON.stringify([b.date, b.time, b.pax, b.total, b.servicoTxt, b.custo, b.obsOp, b.voo, b.name, b.whats]);
        if (it.data) b.date = it.data; if (it.hora) b.time = it.hora; b.pax = +it.pax || b.pax; b.total = +it.valor || 0;
        if (b.servicoTxt) b.servicoTxt = String(it.desc || '').trim() || b.servicoTxt;
        b.custo = +it.custo || 0; if (it.obs) b.obsOp = it.obs; if (it.voo) b.voo = it.voo;
        if (o.cliente && o.cliente.nome) b.name = o.cliente.nome; if (o.cliente && o.cliente.whats) b.whats = o.cliente.whats;
        if (JSON.stringify([b.date, b.time, b.pax, b.total, b.servicoTxt, b.custo, b.obsOp, b.voo, b.name, b.whats]) !== antes && typeof cloudUpdateBooking === 'function') cloudUpdateBooking(b);
      }
    } finally { Orc._sincronizando = false; }
  },
  /* Doc 08/10 item 5: orçamento (e voucher) sempre em ORDEM DE DATA E HORA — sem precisar apagar e
     cadastrar de novo. O ingresso/gestão que acompanha um passeio fica logo depois dele. Serviço sem data vai pro fim. */
  ordena(itens) {
    const L = (itens || []).slice(), porId = new Map(L.map(i => [i.id, i])), pos = new Map(L.map((i, k) => [i, k]));
    const chave = (i) => { const pai = (i.vinculo || []).map(id => porId.get(id)).find(Boolean);
      const base = pai && !i.data ? pai : i;
      return (base.data || i.data || '9999-99-99') + '|' + ((pai && (pai.hora || '')) || i.hora || '99:99') + '|' + (pai ? '1' : '0'); };
    return L.sort((a, b) => chave(a).localeCompare(chave(b)) || pos.get(a) - pos.get(b));
  },
  all() { return [...(DB.orcamentos || [])].sort((a, b) => (b.criado || '').localeCompare(a.criado || '')); },
  get(id) { return (DB.orcamentos || []).find(o => o.id === id) || null; },
  cria(d) {
    DB.orcamentos = DB.orcamentos || [];
    const n = DB.orcamentos.reduce((m, o) => Math.max(m, +String(o.num || '').replace(/\D/g, '') || 0), 0) + 1;
    const o = {
      id: uid(), num: 'ORC-' + String(n).padStart(4, '0'), criado: new Date().toISOString(),
      status: d.status || 'novo', origem: d.origem || 'manual', pedidoId: d.pedidoId || '',
      cliente: { nome: String((d.cliente && d.cliente.nome) || '').trim(), whats: String((d.cliente && d.cliente.whats) || '').trim(),
                 email: String((d.cliente && d.cliente.email) || '').trim() },
      clienteKey: d.clienteKey || '',
      itens: Orc.ordena((d.itens || []).map(Orc._item)),
      sinalPct: d.sinalPct != null ? +d.sinalPct : 30,
      validade: d.validade || addDays(isoToday(), 7),
      obs: orcTextoCliente(d.obs), resumo: String(d.resumo || ''), conversa: String(d.conversa || ''),
      pax: +d.pax || 0, datas: d.datas || [],
      termos: d.termos !== false, bookingIds: [],
    };
    Orc._fichaDo(o);   // pedido da Ingrid (06/10): orçamento já cria/acha a ficha do cliente na aba Clientes
    DB.orcamentos.push(o); _opSave(); return o;
  },
  /* a FICHA do cliente do orçamento: acha pelo WhatsApp, e-mail ou nome (cliente que volta = mesma ficha)
     e cria se não existir — antes a ficha só nascia quando o orçamento virava reserva */
  _fichaDo(o) {
    if (!o || !o.cliente || !String(o.cliente.nome || '').trim() || typeof Cadastro === 'undefined') return null;
    const c = Cadastro.garante({ nome: o.cliente.nome, whats: o.cliente.whats, email: o.cliente.email, criado: o.criado, veioPor: o.veioPor || '' });
    if (c) { o.clienteId = c.id; if (!o.cliente.whats && c.whats) o.cliente.whats = c.whats; if (!o.cliente.email && c.email) o.cliente.email = c.email; }
    return c;
  },
  /* orçamentos antigos sem ficha ganham a ficha (uma vez por abertura de tela; barato) */
  garanteFichas() {
    let n = 0;
    for (const o of DB.orcamentos || []) if (o.cliente && o.cliente.nome && (!o.clienteId || !Cadastro.get(o.clienteId))) { if (Orc._fichaDo(o)) n++; }
    if (n) _opSave();
    return n;
  },
  _item(i) {
    return { id: i.id || uid(), tourId: i.tourId || '', desc: String(i.desc || '').trim(),
             data: i.data || '', hora: i.hora || '', pax: Math.max(1, +i.pax || 1), opcao: +i.opcao || 0,
             valor: Math.max(0, +i.valor || 0), sinal: i.sinal != null && i.sinal !== '' ? Math.max(0, +i.sinal) : null,
             obs: orcTextoCliente(i.obs), sugestao: !!i.sugestao, voo: String(i.voo || '').trim(),
             custo: Math.max(0, +i.custo || 0), cidade: String(i.cidade || '').trim(),
             /* o cliente NAO quis este servico: fica no orcamento como perdido (estatistica dela),
                fora do total e do que vai pro cliente; pode voltar se ele mudar de ideia */
             perdido: !!i.perdido, perdidoEm: i.perdido ? (i.perdidoEm || isoToday()) : '', motivoPerda: String(i.motivoPerda || '').trim(), porPasseio: !!(i.perdido && i.porPasseio),
             /* de que linha da Tabela de preços veio (re-tarifa noturno), turno, se é OPÇÃO
                (o cliente escolhe uma) e o valor cheio antes do desconto (mostrar a economia) */
             precoRef: String(i.precoRef || ''), turno: i.turno || '', alt: !!i.alt,
             valorCheio: Math.max(0, +i.valorCheio || 0), descontoPct: +i.descontoPct || 0,
             /* linha que ACOMPANHA um passeio (ingressos, fones, gestão — 02/10): vinculo = os
                passeios de que ela depende (3 h e/ou 4 h do mesmo dia); auto = que linha é */
             vinculo: Array.isArray(i.vinculo) ? i.vinculo.filter(Boolean).map(String) : [],
             auto: ['ingresso', 'nodia', 'gestao'].includes(i.auto) ? i.auto : '', ingKey: String(i.ingKey || '') };
  },
  /* ---------- O QUE ACOMPANHA O PASSEIO (ingressos, fones, gestão) ----------
     A linha de ingresso conta se ALGUM passeio dela conta: com opção 3 h OU 4 h o
     ingresso do Coliseu (igual nas duas) entra uma vez só; o da Basílica (só no de
     4 h) só entra se a opção de 4 h for a escolhida. */
  _dependeDe(o, i) { return (i.vinculo || []).length ? (o.itens || []).filter(x => i.vinculo.includes(x.id)) : null; },
  /* o cliente não quis o passeio → a linha dele acompanha (e volta se o passeio voltar);
     a linha automática cujo passeio foi APAGADO some junto */
  propaga(o) {
    if (!o || !Array.isArray(o.itens)) return o;
    const ids = new Set(o.itens.map(x => x.id));
    o.itens = o.itens.filter(i => !(i.auto && (i.vinculo || []).length && !i.vinculo.some(id => ids.has(id))));
    for (const i of o.itens) {
      const pais = Orc._dependeDe(o, i); if (!pais || !pais.length) continue;
      i.vinculo = pais.map(x => x.id);
      /* mudou o dia/hora do passeio: o ingresso dele acompanha */
      if (i.auto && pais.every(x => x.data === pais[0].data) && (i.data !== pais[0].data || (pais[0].hora && i.hora !== pais[0].hora))) { i.data = pais[0].data; i.hora = pais[0].hora || i.hora; }
      const vivo = pais.some(x => !x.perdido);
      if (!vivo && !i.perdido) { i.perdido = true; i.perdidoEm = isoToday(); i.motivoPerda = i.motivoPerda || 'acompanha o passeio'; i.porPasseio = true; }
      else if (vivo && i.perdido && i.porPasseio) { i.perdido = false; i.perdidoEm = ''; i.motivoPerda = ''; i.porPasseio = false; }
    }
    return o;
  },
  /* põe junto o que é do mesmo trajeto/passeio e dia: as opções e, logo depois, as
     linhas que acompanham — como no orçamento dela */
  agrupa(o) {
    if (!o || !Array.isArray(o.itens) || typeof Precos === 'undefined' || !Precos.grupoDe) return o;
    const byId = new Map(o.itens.map(i => [i.id, i]));
    const k = (i) => i.precoRef ? Precos.grupoDe(i.precoRef) + '|' + (i.data || '') : '';
    const kDe = (i) => (i.vinculo || []).length ? k(byId.get(i.vinculo[0]) || {}) : k(i);
    const out = [], feito = new Set();
    for (const i of o.itens) {
      if (feito.has(i)) continue;
      const g = kDe(i); if (!g) { out.push(i); feito.add(i); continue; }
      const grupo = o.itens.filter(x => kDe(x) === g);
      /* a ordem do orçamento dela: o(s) passeio(s), os ingressos, os fones, a gestão */
      const R = { ingresso: 0, nodia: 1, gestao: 2 }, deps = grupo.filter(y => (y.vinculo || []).length).map((y, n) => [y, n]).sort((a, b) => ((R[a[0].auto] ?? 3) - (R[b[0].auto] ?? 3)) || a[1] - b[1]).map(z => z[0]);
      for (const x of [...grupo.filter(y => !(y.vinculo || []).length), ...deps]) if (!feito.has(x)) { out.push(x); feito.add(x); }
    }
    o.itens = out; return o;
  },
  /* acrescenta um passeio da Tabela COM o que o acompanha. Se já existe a outra duração
     no mesmo dia (opção 3 h × 4 h), a linha igual é compartilhada, não duplicada.
     pessoas: { adultos, idades } — sem idade = todos adultos (regra dela) */
  comExtras(o, item, pessoas) {
    if (!o || !item || typeof Precos === 'undefined' || !Precos.extrasGuia) return o;
    const it = item.id && o.itens.includes(item) ? item : null; if (!it || !it.precoRef) return o;
    const ex = Precos.extrasGuia(it.precoRef, Object.assign({ pax: it.pax, data: it.data, hora: it.hora }, pessoas || {}));
    if (!ex.length) return o;
    const g = Precos.grupoDe(it.precoRef) + '|' + (it.data || '');
    const irmaos = o.itens.filter(x => x !== it && x.precoRef && Precos.grupoDe(x.precoRef) + '|' + (x.data || '') === g && !(x.vinculo || []).length).map(x => x.id);
    for (const e of ex) {
      const ja = o.itens.find(x => x.auto && x.ingKey === e.ingKey && (x.vinculo || []).some(id => irmaos.includes(id)) && Math.abs((+x.valor || 0) - e.valor) < 0.01);
      if (ja) { if (!ja.vinculo.includes(it.id)) ja.vinculo.push(it.id); }
      else o.itens.push(Orc._item(Object.assign({}, e, { vinculo: [it.id] })));
    }
    Orc.agrupa(o); Orc.propaga(o); return o;
  },
  /* ela soube as idades (ou quantos são): refaz as linhas de ingresso e de fones do orçamento */
  refazIngressos(o, pessoas) {
    if (!o || typeof Precos === 'undefined') return 0;
    let n = 0;
    for (const i of o.itens.filter(x => x.auto === 'ingresso' || x.auto === 'nodia')) {
      const pai = o.itens.find(x => (i.vinculo || []).includes(x.id) && x.precoRef); if (!pai) continue;
      const e = Precos.extrasGuia(pai.precoRef, Object.assign({ pax: pai.pax, data: pai.data, hora: pai.hora }, pessoas || {})).find(y => y.ingKey === i.ingKey);
      if (e) { Object.assign(i, { desc: e.desc, valor: e.valor, custo: e.custo, sinal: e.sinal, pax: e.pax }); n++; }
      else { o.itens = o.itens.filter(x => x !== i); n++; }   // criança de graça: a linha zera e sai
    }
    return n;
  },
  /* OPÇÕES: itens marcados "opção" no mesmo dia = alternativas (carro OU minivan) */
  /* grupo = mesmo trajeto da tabela (ou "manual") + mesmo dia: duas escolhas no mesmo dia não se misturam */
  grupoOpcao(i) {
    if (!i || !i.alt || i.perdido) return '';
    const g = i.precoRef && typeof Precos !== 'undefined' && Precos.grupoDe ? Precos.grupoDe(i.precoRef) : 'manual';
    return 'alt|' + g + '|' + (i.data || '');
  },
  opcoes(o) {
    const g = {};
    for (const i of (o && o.itens) || []) { const k = Orc.grupoOpcao(i); if (k) (g[k] = g[k] || []).push(i); }
    return Object.values(g).filter(l => l.length > 1);
  },
  /* o que entra na CONTA: sem os perdidos e, de cada grupo de opções, só a mais
     barata ("a partir de") — nunca as duas alternativas somadas */
  itensConta(o) {
    const fora = new Set();
    for (const l of Orc.opcoes(o)) { const min = l.reduce((a, b) => ((+b.valor || 0) < (+a.valor || 0) ? b : a)); for (const i of l) if (i !== min) fora.add(i); }
    const conta = ((o && o.itens) || []).filter(i => !i.perdido && !fora.has(i));
    /* a linha que acompanha um passeio só entra se algum passeio dela entrou */
    const ids = new Set(conta.map(i => i.id));
    return conta.filter(i => !(i.vinculo || []).length || i.vinculo.some(id => ids.has(id)));
  },
  /* o cliente escolheu: as outras opções do grupo viram "perdido" (fica a estatística) */
  escolheOpcao(o, itemId) {
    const i = (o.itens || []).find(x => x.id === itemId); if (!i) return null;
    const k = Orc.grupoOpcao(i); if (!k) return i;
    for (const x of o.itens) if (x !== i && Orc.grupoOpcao(x) === k) { x.perdido = true; x.perdidoEm = isoToday(); x.motivoPerda = 'escolheu outra opção'; }
    Orc.propaga(o); _opSave(); return i;
  },
  /* linhas da MESMA seção da tabela no MESMO dia, com veículos diferentes = opções */
  marcaOpcoes(o) {
    if (typeof Precos === 'undefined' || !Precos.grupoDe) return;
    const g = {};
    for (const i of (o && o.itens) || []) if (!i.perdido && i.precoRef) { const k = Precos.grupoDe(i.precoRef) + '|' + (i.data || ''); (g[k] = g[k] || []).push(i); }
    for (const l of Object.values(g)) if (l.length > 1 && new Set(l.map(i => i.precoRef)).size > 1) for (const i of l) i.alt = true;
  },
  /* um servico do catalogo, ja com o preco da tabela dela para aquele grupo */
  itemDoCatalogo(tourId, { pax, data, hora, opcao } = {}) {
    const x = Tours.get(tourId); if (!x) return null;
    const h = hora || (DB.rules.find(r => r.tourId === tourId) || {}).time || '09:00';
    const pr = Bookings.precoDe(x, tourId, data || isoToday(), h, Math.max(1, +pax || 1), { opcao: +opcao || 0 });
    return Orc._item({ tourId, desc: x.name.pt, data: data || '', hora: h, pax, opcao,
                       valor: pr.total || 0, sinal: x.priceMode === 'transfer' ? (pr.sinal || null) : null,
                       obs: pr.consultar ? 'Sem preço na tabela — defina o valor' : '' });
  },
  /* itens "perdidos" (o cliente nao quis) ficam registrados, mas fora da conta;
     de cada grupo de opcoes conta so uma (itensConta) */
  total(o) { return Math.round(Orc.itensConta(o).reduce((s, i) => s + (+i.valor || 0), 0) * 100) / 100; },
  sinalDoItem(o, i) {
    return i.sinal != null ? +i.sinal : Math.round((+i.valor || 0) * (+o.sinalPct || 0) / 100);
  },
  sinal(o) { return Math.round(Orc.itensConta(o).reduce((s, i) => s + Orc.sinalDoItem(o, i), 0) * 100) / 100; },
  salva(o) {
    const x = Orc.get(o.id); if (!x) return null;
    Object.assign(x, o, { itens: Orc.ordena((o.itens || x.itens).map(Orc._item)) });
    if (typeof x.obs === 'string') x.obs = orcTextoCliente(x.obs);
    if (x.status === 'fechado') Orc.paraReservas(x);
    if (o.cliente) Orc._fichaDo(x);
    Orc.propaga(x); _opSave(); return x;
  },
  status(id, st) { const o = Orc.get(id); if (!o) return; o.status = st; _opSave(); },
  linkAdd(id, nome, url) {
    const o = Orc.get(id); if (!o) return null;
    const u = String(url || '').trim(); if (!/^https?:\/\//i.test(u)) return { erro: 'o link precisa começar com http' };
    o.links = o.links || []; const l = { id: uid(), nome: String(nome || '').trim() || 'link', url: u }; o.links.push(l); _opSave(); return l;
  },
  /* o nome do arquivo como ela ja usa: "2026_05_26 Jo Souza" */
  /* pedido dela (02/10): "aaaa_mm_dd Nome do Cliente (Agência se vier de agência)" — a data
     é a do 1º serviço; é o nome que já aparece ao "Salvar como PDF" */
  nomeArquivo(o) {
    if (o.arquivo) return o.arquivo;
    const d = (o.itens.filter(i => !i.perdido).map(i => i.data).filter(Boolean).sort()[0] || o.itens.map(i => i.data).filter(Boolean).sort()[0] || String(o.criado).slice(0, 10)).replace(/-/g, '_');
    const ag = o.veioPor === 'agencia' && String(o.indicou || '').trim() ? ` (${String(o.indicou).trim()})` : '';
    return `${d} ${String(o.cliente.nome || 'Cliente').trim()}${ag}`.replace(/[\\/:*?"<>|]+/g, '-');
  },
  /* FOLLOW-UP planejado (pedido dela, 02/10): grava as datas nas colunas Follow-up 1/2/3 da
     Planilha E cria a tarefa de cada uma (no dia). Tarefa que já existe no mesmo dia pra
     esse cliente vira a do follow-up (não duplica). lista = [{ n, data, resultado }] */
  followUps(id, lista, { tarefas = true } = {}) {
    const o = Orc.get(id); if (!o) return { erro: 'orçamento não encontrado' };
    o.repescagens = o.repescagens || [];
    const feitas = [], nome = o.cliente.nome || 'cliente';
    for (const f of lista || []) {
      const n = Math.max(1, Math.min(3, +f.n || 1));
      let x = o.repescagens.find(y => +y.n === n); if (!x) { x = { n, data: '', resultado: '' }; o.repescagens.push(x); }
      if (f.data !== undefined) x.data = f.data || '';
      if (f.resultado !== undefined) x.resultado = String(f.resultado || '').trim();
      if (tarefas && x.data && x.data >= isoToday() && !x.resultado) {
        const ja = Tarefas.all().find(t => !t.feita && t.prazo === x.data && (t.orcId === o.id || (_nomeN(t.clienteNome) && _nomeN(t.clienteNome) === _nomeN(nome))) && (t.etapa === 'followup' || /follow|repesc|retorno|lembr|mensagem|contato|cutuc/i.test(t.texto)));
        const dados = { texto: `Follow-up ${n} — mandar mensagem para ${nome} (${o.num})`, prazo: x.data, orcId: o.id, clienteNome: nome, whats: o.cliente.whats || '', clienteKey: o.clienteKey || '', etapa: 'followup', tentativa: n, chave: `fu:${o.id}:${n}` };
        if (ja) Object.assign(ja, { orcId: o.id, etapa: 'followup', tentativa: n, chave: dados.chave }); else Tarefas.garante(dados);
      }
      feitas.push(x);
    }
    o.repescagens = o.repescagens.filter(y => y.data || y.resultado).sort((a, b) => a.n - b.n);
    _opSave(); return { ok: true, followups: o.repescagens };
  },
  /* FOLLOW-UP PADRÃO (contrato de 30/09): 30, 15 e 7 dias ANTES do primeiro serviço do orçamento —
     só as datas que ainda estão à frente; serviço perto demais → um follow-up daqui a 2 dias */
  followUpsPadrao(o, hoje) {
    hoje = hoje || isoToday();
    const datas = (o.itens || []).filter(x => !x.perdido && !x.sugestao && /^\d{4}-\d{2}-\d{2}$/.test(x.data || '')).map(x => x.data).sort();
    if (!datas.length) return [];
    let l = [30, 15, 7].map(n => addDays(datas[0], -n)).filter(d => d > hoje);
    if (!l.length && datas[0] > addDays(hoje, 2)) l = [addDays(hoje, 2)];
    return l.map((data, k) => ({ n: k + 1, data }));
  },
  /* ao marcar "enviado" sem nenhum follow-up marcado, as datas padrão entram sozinhas (Planilha + tarefas) */
  followUpsAuto(id) {
    const o = Orc.get(id); if (!o || o.status !== 'enviado' || (o.repescagens || []).some(x => x.data)) return null;
    const l = Orc.followUpsPadrao(o); if (!l.length) return null;
    const r = Orc.followUps(id, l); return r.ok ? r.followups : null;
  },
  /* quantos dias do pedido até fechar (fechado) ou em aberto até hoje (contrato: "tempo até fechar") */
  diasAteFechar(o, hoje) {
    const c = String(o.criado || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(c)) return null;
    const fim = o.status === 'fechado' ? (o.fechadoEm || c) : (o.status === 'perdido' && o.perdidoEm) ? o.perdidoEm : (hoje || isoToday());
    return Math.max(0, Math.round((new Date(fim + 'T12:00:00') - new Date(c + 'T12:00:00')) / 86400000));
  },
  /* apagar: some o orçamento E a tarefa "aguardar a resposta" dele (antes ficava pendurada) */
  remove(id) {
    DB.orcamentos = (DB.orcamentos || []).filter(o => o.id !== id);
    for (const t of DB.tarefas || []) if (!t.feita && t.orcId === id) { t.feita = true; t.feitaEm = new Date().toISOString(); t.obsFim = 'orçamento apagado'; }
    _opSave();
  },
  /* ---------- 1 ORÇAMENTO POR CLIENTE (regra da Ingrid, 02/10) ----------
     até ele pagar e receber o voucher, o cliente tem UM orçamento: mudanças
     entram nele. Depois de fechado, pode nascer outro (pediu mais serviços). */
  mesmoCliente(a, b) {
    const d = (w) => String(w || '').replace(/\D/g, ''), wa = d(a && a.whats), wb = d(b && b.whats);
    if (wa.length >= 8 && wb.length >= 8) return wa.slice(-8) === wb.slice(-8);
    const na = _nomeN(a && a.nome), nb = _nomeN(b && b.nome);
    return !!na && na === nb;
  },
  abertosDoCliente(o) {
    return Orc.all().filter(x => x.id !== (o && o.id) && ['novo', 'rascunho', 'enviado'].includes(x.status) && Orc.mesmoCliente(x.cliente, o && o.cliente));
  },
  /* traz os serviços do repetido pra cá (sem duplicar o mesmo serviço no mesmo dia),
     completa o que faltar do cliente e apaga o repetido */
  junta(destId, origemId) {
    const o = Orc.get(destId), x = Orc.get(origemId); if (!o || !x || o.id === x.id) return null;
    const chave = (i) => _nomeN(i.desc) + '|' + (i.data || '');
    const tem = new Set(o.itens.map(chave));
    let n = 0; const novoId = new Map();
    for (const i of x.itens) if (String(i.desc || '').trim() && !tem.has(chave(i))) { const ni = Orc._item(Object.assign({}, i, { id: uid() })); novoId.set(i.id, ni.id); o.itens.push(ni); tem.add(chave(i)); n++; }
    /* o ingresso trazido continua preso ao passeio trazido junto */
    for (const i of o.itens) if ((i.vinculo || []).length) i.vinculo = i.vinculo.map(id => novoId.get(id) || id);
    for (const k of ['whats', 'email', 'nome']) if (!o.cliente[k] && x.cliente[k]) o.cliente[k] = x.cliente[k];
    if (!o.paxNota && x.paxNota) o.paxNota = x.paxNota;
    if (!o.bagagem && x.bagagem) o.bagagem = x.bagagem;
    if (x.obs && !String(o.obs || '').includes(x.obs)) o.obs = [o.obs, x.obs].filter(Boolean).join('\n');
    if (typeof Orc.marcaOpcoes === 'function') Orc.marcaOpcoes(o);
    Orc.agrupa(o); Orc.salva(o); Orc.remove(x.id);
    return { orc: o, trazidos: n };
  },
  /* Fechou: cada servico do catalogo vira uma reserva de verdade, com o
     cliente e o sinal. Item avulso (sem servico do catalogo) fica so no
     orcamento — ela lanca a parte, se quiser. */
  fecha(id, { sinalRecebido, conta } = {}) {
    const o = Orc.get(id); if (!o || o.status === 'fechado') return [];
    /* opção ainda não escolhida: fechar viraria DUAS reservas (carro E minivan) */
    Orc.erro = '';
    if (Orc.opcoes(o).length) { Orc.erro = 'escolha a opção do cliente antes de fechar (' + Orc.opcoes(o).map(l => l.map(i => i.desc.split(' - ').slice(1, 2).join('') || i.desc).join(' OU ')).join('; ') + ')'; return []; }
    /* nenhum serviço que conta pode sumir calado ao fechar (antes: item da tabela sem data era descartado) */
    const semData = Orc.itensConta(o).filter(i => !(i.tourId && Tours.get(i.tourId)) && !i.sugestao && (!i.data || !String(i.desc || '').trim()));
    if (semData.length) { Orc.erro = 'falta o dia em: ' + semData.map(i => i.desc || '(sem descrição)').join(', '); return []; }
    const criadas = [], contaF = new Set(Orc.itensConta(o));
    for (const i of o.itens) {
      if (i.perdido) continue;   // o cliente nao quis este servico: nao vira reserva (fica so o registro)
      if ((i.vinculo || []).length && !contaF.has(i)) continue;   // ingresso de um passeio que não fechou
      /* do catalogo, ou escrito a mao com data (a planilha dela) */
      const avulso = !(i.tourId && Tours.get(i.tourId));
      if (avulso && (!i.data || !String(i.desc || '').trim() || i.sugestao)) continue;
      const b = Bookings.criarManual({
        tourId: avulso ? tourAvulso(RE_TRANSFER.test(i.desc) ? 'transfer' : 'servico') : i.tourId, date: i.data || isoToday(), time: i.hora || '09:00',
        name: o.cliente.nome || 'Cliente', whats: o.cliente.whats, email: o.cliente.email,
        pax: i.pax, total: i.valor, recebido: 0, veioPor: o.veioPor || '',
      });
      b.origin = 'orcamento'; b.orcamentoId = o.id; b.orcItemId = i.id;
      if (avulso) b.servicoTxt = String(i.desc).trim();
      Object.assign(b, { indicou: o.indicou || '', parceiroTxt: o.parceiroTxt || '', arquivo: Orc.nomeArquivo(o), links: [...(o.links || [])] });
      if (i.cidade) b.destino = i.cidade;
      /* o resto e pago no dia a quem faz o servico — o caso mais comum dela */
      b.policy = 'sinal'; b.sinal = Orc.sinalDoItem(o, i);
      if (i.obs && !i.sugestao) b.obsOp = i.obs;
      if (i.voo) b.voo = i.voo;
      if (+i.custo > 0) b.custo = +i.custo;
      /* linha de ingresso: a reserva sabe que tem ingresso pra comprar (lembrete "comprar os ingressos") */
      if (i.auto === 'ingresso') b.ingressos = { linhas: [], total: +i.valor || 0, noDia: [], totalDia: 0 };
      _opSaveBooking(b);
      if (sinalRecebido && b.sinal > 0) registraPagamento(b.id, { valor: b.sinal, conta });
      criadas.push(b);
    }
    o.status = 'fechado'; o.bookingIds = criadas.map(b => b.id); o.fechadoEm = isoToday();
    _opSave();
    return criadas;
  },
};

/* ---------- ler uma conversa colada do WhatsApp ----------
   Enquanto a Meta nao libera o numero, ela cola a conversa e o app tira o
   que importa: nome, telefone, datas, quantas pessoas, cidades, servicos.
   E o mesmo "apanhador de informacoes" que ela pediu — so que ela cola em
   vez de o robo ler sozinho. Nunca responde nada. */
const CONV_CIDADES = [
  ['Roma', /\broma\b|\brome\b/], ['Florença', /floren[cç]a|firenze|florence/], ['Milão', /mil[aã]o|milano|milan\b/],
  ['Veneza', /veneza|venezia|venice/], ['Nápoles', /n[aá]poles|napoli|naples/], ['Costa Amalfitana', /amalfi|positano|sorrento/],
  ['Capri', /capri/], ['Pompeia', /pompei/], ['Toscana', /toscana|tuscany|siena|pisa|chianti/], ['Assis', /assis|assisi|[uú]mbria/],
];
const CONV_SERVICOS = [
  ['transfer', /transfer|traslado|translado|aeroporto|fiumicino|ciampino|\bfco\b|civitavecchia|porto|esta[cç][aã]o|termini|motorista/],
  ['vaticano-3h', /vaticano|capela sistina|museus do vaticano/],
  ['roma-antiga-3h', /coliseu|coliseo|roma antiga|f[oó]rum romano|palatino/],
  ['papal-convites', /audi[eê]ncia|papa\b/],
  ['bv-pompeia', /pompei/], ['bv-amalfi', /amalfi|positano/], ['bv-tivoli', /tivoli/], ['bv-assis', /assis/],
  ['noturno-3h', /noturno|[aà] noite/],
];
const MESES_PT = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function _isoDe(d, m, y) {
  const hoje = isoToday();
  let ano = y ? (+y < 100 ? 2000 + +y : +y) : +hoje.slice(0, 4);
  const iso = (a) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!(+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31)) return '';
  /* data sem ano que ja passou e do ano que vem */
  if (!y && iso(ano) < hoje) ano += 1;
  return iso(ano);
}
function lerConversa(txt) {
  const bruto = String(txt || '');
  const low = bruto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /* quem escreveu: "[05/10/26 14:32] Maria Silva: oi" ou "05/10/2026 14:32 - Maria Silva: oi" */
  let nome = '';
  const nomeDono = String((typeof guiaNome === 'function' && guiaNome()) || '').toLowerCase();
  const reAutor = /^(?:\[[^\]]+\]\s*|\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*-\s*)([^:\n]{2,40}):/gm;
  let m;
  while ((m = reAutor.exec(bruto))) {
    const quem = m[1].trim();
    if (nomeDono && quem.toLowerCase().includes(nomeDono)) continue;
    if (/emroma|em roma/i.test(quem)) continue;
    if (/^\+?[\d\s()-]+$/.test(quem)) continue;
    nome = quem; break;
  }
  if (!nome) { const mm = bruto.match(/(?:meu nome [eé]|me chamo|sou (?:a|o))\s+([A-ZÀ-Ú][\wÀ-ú]+(?:\s+[A-ZÀ-Ú][\wÀ-ú]+)?)/); if (mm) nome = mm[1]; }
  const tel = (bruto.match(/\+\d[\d\s().-]{8,}\d/) || [''])[0].replace(/[^\d+]/g, '');
  /* datas: 5/10, 05/10/2026, "5 de outubro" — tirando as marcas de hora do proprio WhatsApp */
  const semCarimbo = bruto.replace(/^\[[^\]]+\]/gm, '').replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*-/gm, '');
  const datas = new Set();
  for (const d of semCarimbo.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) { const i = _isoDe(d[1], d[2], d[3]); if (i) datas.add(i); }
  const semCarLow = semCarimbo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const d of semCarLow.matchAll(/\b(\d{1,2})\s+de\s+([a-z]+)/g)) {
    const mi = MESES_PT.indexOf(d[2]); if (mi >= 0) { const i = _isoDe(d[1], mi + 1); if (i) datas.add(i); }
  }
  const num = (re) => { const x = low.match(re); return x ? +x[1] : 0; };
  /* "somos 4 pessoas (2 adultos e 2 criancas)": o total e 4, nao 6 */
  const pessoas = num(/(\d{1,2})\s*(?:pessoas|pax|people)/);
  const adultos = num(/(\d{1,2})\s*(?:adultos?|adults?)/);
  const criancas = num(/(\d{1,2})\s*(?:criancas?|filhos?|kids?|children)/);
  const pax = pessoas || (adultos + criancas) || (/\b(casal|eu e (meu|minha))\b/.test(low) ? 2 : 0);
  const cidades = CONV_CIDADES.filter(([, re]) => re.test(low)).map(([c]) => c);
  const servicos = CONV_SERVICOS.filter(([, re]) => re.test(low)).map(([s]) => s);
  const chegada = /chegada|chego|chegamos|desembarc|pousa|aterriss/.test(low);
  /* "volta" sozinho pegava o "bate e volta" e inventava um transfer de saida */
  const partida = /partida|saida|embarque|vou embora|vamos embora|voo de volta|volta(?:mos)? (?:ao|para o) (?:brasil|aeroporto)/.test(low);
  const voo = (bruto.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/) || [])[0] || '';
  const partes = [];
  if (datas.size) partes.push([...datas].sort().map(d => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', '));
  if (pax) partes.push(pax + (criancas ? ` pessoas (${criancas} criança${criancas > 1 ? 's' : ''})` : ' pessoas'));
  if (cidades.length) partes.push(cidades.join(', '));
  if (servicos.length) partes.push(servicos.map(s => s === 'transfer'
    ? 'transfer' + (chegada && partida ? ' (chegada e partida)' : chegada ? ' (chegada)' : partida ? ' (partida)' : '')
    : ((typeof Tours !== 'undefined' && Tours.get(s)) ? Tours.get(s).name.pt : s)).join(', '));
  if (voo) partes.push('voo ' + voo);
  return { nome, whats: tel, datas: [...datas].sort(), adultos, criancas, pax, cidades, servicos, chegada, partida, voo,
           resumo: partes.join(' · ') };
}
/* O rascunho: cada servico reconhecido vira um item com o preco da tabela.
   Marcado como SUGESTAO — e ela quem confere antes de mandar. */
function rascunhoDaConversa(c) {
  const itens = [];
  const pax = c.pax || 2;
  const datas = c.datas || [];
  /* Uma data so costuma ser a CHEGADA: os passeios vao para os dias
     seguintes, um por dia. Com varias datas, segue a ordem delas. */
  let di = 0;
  const proxData = () => {
    if (datas.length > 1) return datas[Math.min(++di, datas.length - 1)];
    return datas[0] ? addDays(datas[0], ++di) : '';
  };
  for (const s of c.servicos || []) {
    if (s === 'transfer') {
      if (c.chegada || !c.partida) { const it = Orc.itemDoCatalogo('transfer-aeroporto', { pax, data: datas[0] || '' }); if (it) { it.sugestao = true; it.desc += ' — chegada'; it.voo = c.voo || ''; itens.push(it); } }
      if (c.partida) { const it = Orc.itemDoCatalogo('transfer-aeroporto', { pax, data: datas[datas.length - 1] || '' }); if (it) { it.sugestao = true; it.desc += ' — partida'; itens.push(it); } }
      continue;
    }
    const it = Orc.itemDoCatalogo(s, { pax, data: proxData() });
    if (it) { it.sugestao = true; itens.push(it); }
  }
  return itens;
}
/* Do questionario "Monte seu roteiro" para um rascunho: o que ela ofereceria
   em Roma para quem gosta de cada coisa, e o transfer se pediu. */
const ROTEIRO_SUGESTAO = {
  historia: 'roma-antiga-3h', arte: 'vaticano-3h', fe: 'basilicas-3h', noite: 'noturno-3h', fotos: 'panoramas-3h',
  comida: 'degustacao', criancas: 'criancas',
};
function rascunhoDoRoteiro(ped) {
  const itens = [];
  const pax = (+ped.adultos || 1) + (+ped.criancas || 0);
  let dia = ped.ini || '';
  const prox = () => { const d = dia; if (dia) dia = addDays(dia, 1); return d; };
  if ((ped.precisa || []).includes('transfer')) {
    const it = Orc.itemDoCatalogo('transfer-aeroporto', { pax, data: ped.ini || '' });
    if (it) { it.sugestao = true; it.desc += ' — chegada'; itens.push(it); }
  }
  if ((ped.onde || []).includes('roma') || !(ped.onde || []).length) {
    const vistos = new Set();
    for (const g of ped.gosto || []) {
      const id = ROTEIRO_SUGESTAO[g];
      if (!id || vistos.has(id) || !Tours.get(id)) continue;
      vistos.add(id);
      const it = Orc.itemDoCatalogo(id, { pax, data: prox() }); if (it) { it.sugestao = true; itens.push(it); }
    }
    if (!vistos.size && Tours.get('roma-antiga-3h')) {
      const it = Orc.itemDoCatalogo('roma-antiga-3h', { pax, data: prox() }); if (it) { it.sugestao = true; itens.push(it); }
    }
  }
  const foraDeRoma = { pompeia: 'bv-pompeia', amalfi: 'bv-amalfi', umbria: 'bv-assis', castelli: 'bv-tivoli', toscana: 'bv-toscana-sul' };
  for (const o of ped.onde || []) {
    const id = foraDeRoma[o]; if (!id || !Tours.get(id)) continue;
    const it = Orc.itemDoCatalogo(id, { pax, data: prox() }); if (it) { it.sugestao = true; itens.push(it); }
  }
  for (const o of ped.onde || []) {
    if (['florenca', 'veneza', 'milao', 'capri'].includes(o)) {
      const nome = { florenca: 'Florença', veneza: 'Veneza', milao: 'Milão', capri: 'Capri' }[o];
      itens.push(Orc._item({ desc: 'Passeio particular em ' + nome, pax, data: '', valor: 0, sugestao: true, obs: 'Defina o valor — ainda não há tabela desta cidade' }));
    }
  }
  if ((ped.precisa || []).includes('transfer') && ped.fim) {
    const it = Orc.itemDoCatalogo('transfer-aeroporto', { pax, data: ped.fim });
    if (it) { it.sugestao = true; it.desc += ' — partida'; itens.push(it); }
  }
  return itens;
}

/* ---------- termos e voucher ---------- */
/* MODELO. Ela ja tem os termos dela e cola por cima em Ajustes. */
const TERMOS_MODELO = [
  'MODELO — troque pelos seus termos em Ajustes → Termos e condições.',
  '',
  '1. A reserva é confirmada com o pagamento do sinal. Ao pagar, você declara que leu e aceita estes termos.',
  '2. O restante é pago no dia do serviço, em dinheiro, a quem presta o serviço (guia ou motorista), salvo combinado diferente por escrito.',
  '3. Cancelamento: até 48 horas antes, o sinal pode ser usado em outra data; com menos de 48 horas o sinal não é devolvido.',
  '4. Atrasos do cliente podem reduzir a duração do passeio. No transfer, a espera incluída é a informada no orçamento.',
  '5. Ingressos são nominais e comprados com antecedência; depois de emitidos não têm reembolso.',
].join('\n');
/* Os termos REAIS da EmRoma (aba "Orçamento" da planilha dela, 01/10/2026).
   Entram sozinhos nos Ajustes no 1º acesso; ela pode editar por cima. */
const TERMOS_EMROMA = `Todos os valores do orçamento estão sujeitos à mudança sem aviso prévio até a confirmação da reserva.

CONFIRMAÇÃO DA RESERVA
Para garantir a disponibilidade do serviço, é necessário o pagamento de um sinal de reserva via Pix ou Wise.
O sinal possui caráter de bloqueio de agenda e disponibilidade operacional, sendo não reembolsável em caso de cancelamento, independentemente do serviço contratado.
Para pagamentos via Pix, utilizamos a cotação do euro turismo (São Paulo — Melhor Câmbio) no dia da confirmação da reserva.
O valor pago será abatido do total do serviço.

FORMAS DE PAGAMENTO
O valor restante poderá ser quitado no dia do serviço através das seguintes modalidades:
- Em euros (dinheiro)
- Cartão de crédito (+10%)
Para maior comodidade, oferecemos a opção de pagamento antecipado integral com acréscimo de 15%.
Alterações na forma de pagamento devem ser informadas com mínimo de 48 horas de antecedência.
Obs.: O valor referente à guia deverá ser pago exclusivamente em espécie no dia do atendimento. Não aceitamos cartão de crédito para este pagamento. Caso o cliente opte pelo pagamento total antecipado, será aplicado acréscimo de 15%.

INFORMAÇÕES DO SERVIÇO – TRANSFER PRIVATIVO
- Valores informados são por trajeto (não por pessoa).
- Serviço realizado com veículos privativos e motoristas profissionais.
- Tarifa noturna (21h às 6h): acréscimo de €30 por veículo sobre o valor do serviço.
- Custos de combustível e pedágios estão incluídos.
É indispensável informar previamente:
- Quantidade de passageiros
- Quantidade e dimensões das bagagens
- Equipamentos especiais, cadeirinhas, cadeiras de rodas, carrinhos de bebê
- Qualquer item que possa impactar a operação do serviço
Importante:
- Motoristas não falam português.
- Um WhatsApp de suporte 24h em português será disponibilizado no voucher de confirmação.

POLÍTICA DE ESPERA E ATRASOS
O serviço contempla as seguintes tolerâncias de espera:
- Aeroportos: até 1 hora após o pouso do voo
- Portos: até 30 minutos do horário agendado
- Estações de trem: até 15 minutos após a chegada
- Hotéis/Apartamentos: até 5 minutos do horário agendado
Após o período de tolerância, serão aplicadas taxas adicionais de espera:
- Aeroporto/Porto: €40 por hora (por veículo)
- Demais locais: €20 a cada 15 minutos adicionais (por veículo)
Em caso de atraso superior a 30 minutos em trens, ou qualquer alteração de voo (incluindo mudança de número do voo), o cliente deverá informar imediatamente.
Não nos responsabilizamos por falhas na prestação do serviço decorrentes da ausência de aviso prévio.

CANCELAMENTOS, DESISTÊNCIAS E NO-SHOW
Após a chegada do motorista ao local agendado, o serviço será considerado integralmente devido, mesmo em casos de: desistência, mudança de planos, problemas com bagagem, processos migratórios, perda de voo, contratação de outro transporte ou não comparecimento do passageiro.
O tempo de espera seguirá conforme a política descrita acima. Após o período de tolerância, poderão ser aplicadas taxas adicionais.

SERVIÇOS DE PASSEIOS E GUIAS
- Serviços realizados com guias locais credenciados, conforme legislação vigente.
- O idioma do serviço será português.
- Ingressos, refeições e despesas pessoais não estão incluídos, salvo indicação expressa.
- O roteiro poderá sofrer ajustes por motivos operacionais, climáticos ou logísticos.
Horas extras: caso o passeio exceda o período contratado, será aplicado custo adicional previamente informado.

COMPRA DE INGRESSOS (ATRAÇÕES E EXPERIÊNCIAS)
A solicitação de compra de ingressos será realizada conforme a disponibilidade apresentada pelas atrações no momento da aquisição.
Não é possível garantir previamente: datas exatas, horários específicos ou a menor tarifa disponível.
Cada atração possui política própria de venda, disponibilidade dinâmica e limitação de capacidade.
Comprometemo-nos a buscar a melhor disponibilidade compatível com a solicitação do cliente, priorizar horários e datas mais próximos do desejado e informar previamente qualquer alteração antes da emissão.
A compra será efetuada somente após aprovação do cliente quanto às condições disponíveis (data, horário e valor).

POLÍTICA DE VALORES
Os valores poderão sofrer atualização sem aviso prévio até a confirmação da reserva.
Após a confirmação, o valor acordado será garantido até a execução do serviço contratado.

CONDIÇÕES DE CANCELAMENTO
Transfer privativo: possui bloqueio operacional imediato e, por este motivo, não é reembolsável após a confirmação da reserva, incluindo o sinal pago.
Passeios e serviços com guia — em caso de cancelamento:
- 30 dias ou mais de antecedência: retenção de 50% do valor total pago
- 15 a 29 dias de antecedência: retenção de 75% do valor total pago
- 14 dias ou menos: retenção de 100% do valor total pago
O sinal de reserva é não reembolsável e será considerado dentro dos percentuais de retenção acima.
A ausência de resposta após 3 tentativas de contato será considerada cancelamento por iniciativa do cliente.

SITUAÇÕES DE FORÇA MAIOR
Incluem, mas não se limitam a: greves, eventos sanitários, condições climáticas adversas, questões médicas relevantes, restrições governamentais ou operacionais.
Nestes casos:
- O serviço poderá ser remarcado ou convertido em crédito válido por até 12 meses.
- A nova data estará sujeita à disponibilidade.
- Poderá haver atualização tarifária.
- O cancelamento seguirá as regras padrão previstas neste documento.

RESPONSABILIDADES DO CLIENTE
- Pertences pessoais são de responsabilidade exclusiva do cliente.
- Objetos esquecidos não são cobertos pelo serviço.
- A contratação de seguro-viagem é obrigatória para entrada na Itália.
- Equipamentos fornecidos deverão ser devolvidos em perfeito estado. Em caso de perda ou dano: €80 por unidade.

USO DE IMAGEM
O cliente autoriza o uso de imagens (foto e vídeo) para fins institucionais e promocionais.
- Validade da autorização: 5 anos.
- Revogável mediante solicitação formal por escrito.

DISPOSIÇÕES FINAIS
- Este documento permanecerá válido até a conclusão integral dos serviços contratados.
- Qualquer alteração deverá ser formalizada por escrito.
- Os serviços contratados são pessoais e intransferíveis, salvo autorização prévia expressa.`;
function termosTexto() {
  const s = (DB.settings && DB.settings.termos) || {};
  const l = (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt';
  return String(s[l] || s.pt || TERMOS_MODELO);
}

/* ---------- VOUCHER inteligente ----------
   O voucher se monta sozinho pelo que a reserva já sabe: transfer de chegada
   (aeroporto/porto/trem) ou de partida, ou passeio — e puxa o ponto de encontro
   dos Pontos. Estes são os textos padrão (o voucher real dela, Doc de 01/10),
   todos editáveis na aba Voucher. */
const VOUCHER_BLOCOS_EMROMA = {
  pagamento: `MÉTODO DE PAGAMENTO
- Dinheiro (em euros)
- Cartão de crédito: acréscimo de 10%
- PIX ou WISE (antecipado): acréscimo de 15%
Obs.: é possível alterar o método de pagamento com no máximo 24 horas de antecedência.`,
  suporte: `SUPORTE EXCLUSIVO
Em caso de qualquer necessidade durante a sua experiência, o nosso atendimento de plantão estará à sua disposição. Salve este número antes de partir, com o nome SUPORTE EMROMA: +39 375 520 2615.

INFORMAÇÕES GERAIS
- Não é necessário imprimir ou apresentar este voucher ao motorista ou guia.
- O número de suporte é diferente do número comercial e deve ser usado apenas nos casos descritos neste voucher. Leia todas as informações com atenção.
- Caso o acesso de carro ao hotel não seja possível, consulte o hotel para indicar o ponto mais próximo e conveniente para embarque e desembarque.`,
  trocado: `TROCO
- Leve dinheiro trocado, pois os motoristas podem não ter troco devido ao volume de serviços.
- Caso não consiga providenciar o valor trocado, nos informe com pelo menos 24 horas de antecedência.`,
  transferAeroporto: `TRANSFER DE CHEGADA — AEROPORTO
O que NÃO precisa ser comunicado:
- Atraso do voo de até 1 hora.
- Avisar que o voo acabou de aterrissar.
- Informar que está aguardando ou retirando a bagagem.

Entre em contato com o suporte (+39 375 520 2615) quando:
- Precisar estender a espera: o serviço inclui até 1 hora após a aterrissagem; além disso, €40 por hora extra (por veículo).
- Perder a conexão, o voo, ou houver alteração no número do voo — avise assim que tiver as novas informações.
- Houver extravio de bagagem, fila de imigração muito lenta ou atraso superior a 40 minutos dentro do aeroporto.
- Não encontrar o motorista.

ATENÇÃO — CONTATO COM O SUPORTE
- Qualquer atraso dentro do aeroporto superior a 40 minutos (imigração, bagagem, compras, alimentação, etc.) deve ser avisado diretamente pelo WhatsApp de suporte, mesmo que já esteja em contato com o motorista.
- Estar em contato com o motorista não substitui o contato com o suporte.
- A falta de comunicação pode impactar o tempo de espera do motorista e a execução do serviço.

DICA
- Após desembarcar, dirija-se diretamente à fila da imigração.
- Evite parar no caminho (inclusive ao banheiro): a chegada de outros voos pode gerar filas longas em poucos minutos.
- Mantenha o telefone carregado e conectado ao Wi-Fi. Todas as comunicações são feitas via WhatsApp.

COMO IDENTIFICAR O SEU MOTORISTA
- O motorista aguarda na saída do terminal, segurando uma placa com o seu nome.
- O nome do motorista não é informado previamente. Procure com atenção, especialmente em alta temporada.`,
  transferPartida: `TRANSFER DA PARTIDA
Alterações:
- Não é possível alterar o horário do transfer com menos de 24 horas de antecedência.

Como encontrar o seu motorista:
- O motorista chega pontualmente no horário combinado.
- O nome do motorista não é informado previamente.
- Esteja na frente do hotel ou acomodação no horário marcado.
- Se não localizar o motorista, envie mensagem imediatamente ao suporte: +39 375 520 2615.

Dica sobre o terminal do voo:
- O terminal normalmente é informado apenas no dia do voo. Pesquise no Google "Voo + número do voo" (ex.: Voo LA8120) e informe o terminal diretamente ao motorista.`,
  transferPorto: `TRANSFER DE CHEGADA — PORTO
- O motorista aguarda na saída do navio, segurando uma placa com o seu nome.
- O nome do motorista não é informado previamente.
- Caso não encontre o motorista, envie mensagem imediatamente ao suporte: +39 375 520 2615.
- O serviço inclui até 15 minutos de espera após o horário combinado. Após esse período, €40 por hora extra de espera (por veículo).`,
  transferTrem: `TRANSFER DE CHEGADA — ESTAÇÃO DE TREM
Estação Termini:
- O motorista aguarda do lado de fora da estação, em frente ao Caffè Trombetta, segurando uma placa com o seu nome.
- O nome do motorista não é informado previamente.
- O serviço inclui até 15 minutos de espera após a chegada do trem. Após esse período, €20 a cada 15 minutos de espera (por veículo).

Estação Napoli Centrale:
- O motorista aguarda com uma placa com o seu nome em frente à plataforma 24, ao lado do Bar Ciro, em frente à fonte da sereia.
- O serviço inclui até 15 minutos de espera após a chegada do trem. Após esse período, €20 a cada 15 minutos de espera (por veículo).`,
  passeios: `PASSEIOS
Suporte exclusivo: em caso de qualquer assistência durante a experiência, o atendimento de plantão estará à disposição: +39 375 520 2615.

PAGAMENTO
- O valor referente à guia e eventuais extras deverá ser pago em dinheiro (cash) no dia do serviço.

PONTUALIDADE
- As atrações têm horários rigorosos de entrada. Chegue no mínimo 15 minutos antes do horário marcado.
- Em caso de atraso, o tempo será descontado da duração do passeio. Se impossibilitar a entrada, a guia proporá uma atividade alternativa nas proximidades.

DOCUMENTOS (obrigatório no controle de ingressos)
- Passaporte físico, OU foto do passaporte em alta qualidade (impressa ou no celular), OU carteira de identidade da União Europeia.
- Não são aceitos documentos brasileiros (RG, CNH, etc.).
- Vaticano: cada visitante deve ter o próprio documento (no celular ou em mãos), exceto crianças.
- Mantenha o celular com bateria suficiente para apresentá-lo quando solicitado.

INGRESSOS
- Museus do Vaticano: é obrigatória a impressão do ingresso em folha A4, completo e legível.
- Para as demais atrações não é necessário imprimir.

CÓDIGO DE VESTIMENTA
- Calçados confortáveis para caminhada (parte do trajeto pode ter pisos irregulares ou degraus).
- Vaticano e igrejas (obrigatório) — Mulheres: ombros cobertos, evitar roupas curtas ou decotadas, saias ou bermudas na altura do joelho (leve um lenço leve para cobrir os ombros). Homens: camisetas com mangas (regatas não são permitidas) e bermudas na altura do joelho.

BOLSAS, MOCHILAS E GUARDA-CHUVAS
- Leve apenas itens essenciais. Apenas guarda-chuvas pequenos são permitidos na maioria das atrações; bolsas e mochilas grandes não são permitidas.
- Vaticano: caso seja necessário usar o guarda-volumes, não será possível acessar diretamente a Basílica de São Pedro, o que inviabiliza a visita guiada ao interior.

ENCONTRO COM A GUIA
- A guia estará com uma plaquinha personalizada com o seu nome no ponto de encontro indicado neste voucher.`,
  fechamento: `Grazie!!
Espero que a sua viagem traga momentos inesquecíveis, com experiências leves, culturais e cheias de significado. A nossa equipe está à disposição para tirar dúvidas e oferecer suporte antes e durante os passeios. Conte com a gente para o que precisar.
Um abraço carinhoso e até breve,
Ingrid

EM ROMA COM INGRID
www.emroma.com · info@emroma.com · +39 351 563 1485 · @em_roma`,
};
/* a ordem e o rótulo de cada bloco na aba Voucher */
const VOUCHER_BLOCOS_META = [
  { k: 'pagamento', nome: 'Método de pagamento', grupo: 'Sempre aparece', quando: 'em todo voucher' },
  { k: 'suporte', nome: 'Suporte e informações gerais', grupo: 'Sempre aparece', quando: 'em todo voucher' },
  { k: 'trocado', nome: 'Troco (dinheiro trocado)', grupo: 'Transfer', quando: 'nos transfers' },
  { k: 'transferAeroporto', nome: 'Transfer de chegada — Aeroporto', grupo: 'Transfer', quando: 'chegada de avião' },
  { k: 'transferPartida', nome: 'Transfer da partida', grupo: 'Transfer', quando: 'quando vai para o aeroporto/porto/estação' },
  { k: 'transferPorto', nome: 'Transfer de chegada — Porto', grupo: 'Transfer', quando: 'chegada de navio' },
  { k: 'transferTrem', nome: 'Transfer de chegada — Estação de trem', grupo: 'Transfer', quando: 'chegada de trem' },
  { k: 'passeios', nome: 'Passeios (documentos, vestimenta, ingressos…)', grupo: 'Passeios', quando: 'nos passeios com guia' },
  { k: 'fechamento', nome: 'Fechamento e assinatura', grupo: 'Sempre aparece', quando: 'no fim de todo voucher' },
];
function voucherBlocoTxt(k) {
  const b = (DB.settings && DB.settings.voucher && DB.settings.voucher.blocos) || {};
  return (b[k] != null ? b[k] : VOUCHER_BLOCOS_EMROMA[k]) || '';
}
function voucherSalvaBloco(k, txt) {
  if (!DB.settings.voucher) DB.settings.voucher = {};
  if (!DB.settings.voucher.blocos) DB.settings.voucher.blocos = Object.assign({}, VOUCHER_BLOCOS_EMROMA);
  DB.settings.voucher.blocos[k] = String(txt == null ? '' : txt);
  if (typeof save === 'function') save();
}
/* que tipo de transfer é este (pra escolher o bloco certo) */
function voucherTipoTransfer(b) {
  const AERO = /\b(fco|cia)\b|fiumicino|ciampino|aeroport/i, PORTO = /civitavecchia|\bporto\b|navio|cruzeiro|\bcais\b/i, TREM = /termini|tiburtina|stazione|esta[cç][aã]o|\btrem\b|\btreno\b|centrale/i;
  const dest = String(b.destino || '').toLowerCase();
  if (AERO.test(dest) || PORTO.test(dest) || TREM.test(dest)) return 'partida';
  /* a descrição já diz o sentido ("Centro → FCO" = partida) — Doc dela de 06/10: a partida não era reconhecida */
  const nm = String((typeof nomeDoServico === 'function' ? nomeDoServico(b) : '') || b.servicoTxt || ''), seta = nm.indexOf('→');
  if (seta > 0) { const depois = nm.slice(seta + 1).split(' - ')[0]; if (AERO.test(depois) || PORTO.test(depois) || TREM.test(depois)) return 'partida'; }
  const txt = [b.origem, b.servicoTxt, (typeof nomeDoServico === 'function' ? nomeDoServico(b) : '')].filter(Boolean).join(' ');
  if (PORTO.test(txt)) return 'porto';
  if (TREM.test(txt)) return 'trem';
  return 'aeroporto';
}
/* O VOUCHER DA VIAGEM (o modelo dela): um documento por cliente com TODOS os
   serviços da viagem — as reservas não canceladas do mesmo cliente até 30 dias
   antes/depois desta — em ordem de data e hora. */
/* REGRA DELA PARA O VOUCHER (Doc 06/10) — chegada de aeroporto: só depois do print/PDF do pagamento e com
   nome, WhatsApp, quantidade e tamanho das malas, aeroporto, número do voo e endereço do hotel. Devolve o que FALTA. */
function voucherFalta(bs) {
  const out = [];
  if (!bs || !bs.length) return out;
  const b = bs[0], c = b.clienteId && typeof Cadastro !== 'undefined' ? Cadastro.get(b.clienteId) : null;
  const orc = bs.map(x => x.orcamentoId && typeof Orc !== 'undefined' && Orc.get(x.orcamentoId)).find(Boolean) || null;
  const bagagem = (orc && orc.bagagem) || (c && c.viagem && c.viagem.bagagem) || bs.map(x => x.malas).filter(Boolean)[0] || '';
  const pago = bs.some(x => (x.payments || []).some(p => +p.amount > 0 && p.conta !== (typeof CONTA_PRESTADOR !== 'undefined' ? CONTA_PRESTADOR : 'prestador')));
  const chegadas = bs.filter(x => typeof ehTransfer === 'function' && ehTransfer(x) && voucherTipoTransfer(x) === 'aeroporto');
  if (!pago) out.push('o comprovante do pagamento (print ou PDF) — registre o pagamento antes');
  if (!String(b.name || '').trim()) out.push('nome');
  if (!String(b.whats || (c && c.whats) || '').replace(/\D/g, '')) out.push('WhatsApp');
  if (chegadas.length) {
    if (!/\d/.test(bagagem) || !/mala|bagag|kg|volume|mochila|bordo|despach/i.test(bagagem)) out.push('quantidade e tamanho das malas');
    for (const x of chegadas) {
      const quando = (x.date || '').slice(8, 10) + '/' + (x.date || '').slice(5, 7);
      if (!/\b(fco|cia)\b|fiumicino|ciampino|aeroport/i.test((x.origem || '') + ' ' + nomeDoServico(x))) out.push(`aeroporto da chegada (${quando})`);
      if (!String(x.voo || '').trim()) out.push(`número do voo (${quando})`);
      if (!String(x.destino || '').trim() || /^centro$/i.test(String(x.destino).trim())) out.push(`endereço do hotel (${quando})`);
    }
  }
  /* partida: o motorista precisa saber de onde buscar (endereço do hotel) */
  for (const x of bs.filter(x => typeof ehTransfer === 'function' && ehTransfer(x) && voucherTipoTransfer(x) === 'partida')) {
    const quando = (x.date || '').slice(8, 10) + '/' + (x.date || '').slice(5, 7);
    if (!String(x.origem || '').trim() || /^centro$/i.test(String(x.origem).trim())) out.push(`endereço do hotel de onde sai (${quando})`);
  }
  return out;
}
function voucherViagem(b) {
  if (!b) return [];
  const dig = (w) => String(w || '').replace(/\D/g, '');
  const mesmo = (x) => (b.clienteId && x.clienteId === b.clienteId) || (dig(b.whats).length >= 6 && dig(x.whats) === dig(b.whats)) || (_nomeN(x.name) && _nomeN(x.name) === _nomeN(b.name));
  return (DB.bookings || []).filter(x => x.status !== 'cancelled' && (x.id === b.id || (mesmo(x) && Math.abs(_dias(b.date, x.date)) <= 30)))
    .sort((a, c) => (a.date + (a.time || '')).localeCompare(c.date + (c.time || '')));
}
/* os blocos da viagem inteira, SEM repetir: um "passeios" mesmo com 3 passeios;
   chegada e partida aparecem uma vez cada; na ordem do Doc dela */
const VOUCHER_ORDEM = ['pagamento', 'suporte', 'trocado', 'transferAeroporto', 'transferPorto', 'transferTrem', 'transferPartida', 'passeios', 'fechamento'];
function voucherBlocosViagem(bs) {
  const tem = new Set();
  for (const b of bs || []) for (const k of voucherBlocosDe(b)) tem.add(k);
  return VOUCHER_ORDEM.filter(k => tem.has(k));
}
/* os blocos que entram NESTE voucher, na ordem */
function voucherBlocosDe(b) {
  const out = ['pagamento', 'suporte'];
  if (typeof ehTransfer === 'function' && ehTransfer(b)) {
    out.push('trocado');
    const t = voucherTipoTransfer(b);
    out.push(t === 'partida' ? 'transferPartida' : t === 'porto' ? 'transferPorto' : t === 'trem' ? 'transferTrem' : 'transferAeroporto');
  } else {
    out.push('passeios');
  }
  out.push('fechamento');
  return out;
}
/* O que o cliente precisa saber NO DIA. Dicas do servico (o editor do
   passeio tem o campo) ou, sem elas, as do tipo de servico. */
const DICAS_PADRAO = {
  transfer: 'O motorista espera no desembarque com uma plaquinha com o seu nome. Ao pegar as malas, ligue o celular e confira o WhatsApp. Se não encontrar o motorista, chame o número de plantão antes de sair do aeroporto.',
  walk: 'Use sapato confortável e leve água. Chegue 10 minutos antes no ponto de encontro.',
  papal: 'Chegue com antecedência: a fila da segurança é longa. Ombros e joelhos cobertos.',
  day: 'O motorista busca no hotel no horário combinado. Leve documento, água e protetor solar.',
};
function dicasDo(b) {
  const x = Tours.get(b.tourId);
  const l = (typeof LANG !== 'undefined' && LANG === 'en') ? 'en' : 'pt';
  const d = x && x.dicas && (x.dicas[l] || x.dicas.pt);
  if (d) return d;
  if (x && /vaticano|vatican|basilic|papal/i.test(x.id + ' ' + x.name.pt)) {
    return 'Vaticano e basílicas: ombros e joelhos cobertos (vale para homens e mulheres). Nada de regata, short ou saia curta. Mochilas grandes não entram. ' + (DICAS_PADRAO.walk);
  }
  return (x && DICAS_PADRAO[x.type]) || DICAS_PADRAO.walk;
}

/* ---------- garante as colecoes, e a demonstracao ----------
   Quem ja usa o app nao tem DB.equipe etc. — nasce vazio sem quebrar nada.
   Na DEMONSTRACAO (sem banco), semeia guias, contas e o dia de hoje com
   servicos de verdade, para ela fazer o test drive com o painel vivo. */
const OP_SEED = 1;
/* ZERAR PARA TRABALHAR: entrega o app limpo para a Ingrid — sem clientes,
   reservas, guias e parceiros de exemplo — MANTENDO o catálogo de passeios,
   os preços e os pontos de encontro (que são dados reais dela). Em config.js,
   semExemplos liga isto para todo aparelho novo; o botão em Ajustes e a
   migração automática abaixo limpam o aparelho que já viu a demonstração. */
const RESET_VER = 1;
const _semExemplos = () => typeof APP_CONFIG !== 'undefined' && !!APP_CONFIG.semExemplos;
/* cheira a demonstração ainda intacta? (para só auto-limpar quem não começou) */
function _pareceDemo() {
  return (DB.equipe || []).some(p => p.id === 'op-m1')
      || (DB.bookings || []).some(b => b.name === 'Juliana Andrade' || b.name === 'Camila Teixeira');
}
/* apaga o que é de exemplo; guarda catálogo, preços, pontos e os ajustes dela */
function zerarExemplos() {
  DB.bookings = []; DB.clientes = []; DB.equipe = []; DB.disp = [];
  DB.parceiros = []; DB.coupons = []; DB.tarefas = []; DB.orcamentos = [];
  DB.pedidos = []; DB.fichas = {}; DB.interesse = {}; DB.lembretesVistos = {};
  if (Array.isArray(DB.arquivos)) DB.arquivos = [];
  if (DB.settings) DB.settings.avaliacoes = [];
  /* marca para não semear a demonstração de novo */
  DB.opSeed = OP_SEED; DB.interesseSeed = 1; DB.parceirosSeed = 1; DB.tarefasSeed = 1;
  DB.cadastroFeito = 1; DB.resetFeito = RESET_VER;
  _opSave();
  return { ok: true };
}
function opGarante() {
  if (!DB) return;
  DB.equipe = DB.equipe || [];
  DB.disp = DB.disp || [];
  DB.orcamentos = DB.orcamentos || [];
  DB.fichas = DB.fichas || {};
  if (!Array.isArray(DB.contas) || !DB.contas.length) DB.contas = contasPadrao();
  if (DB.settings && !DB.settings.termos) DB.settings.termos = { pt: '', en: '' };
  if (DB.settings && DB.settings.termos && !DB.settings.termos.pt && !DB.settings.termosSeed) { DB.settings.termos.pt = TERMOS_EMROMA; DB.settings.termosSeed = 'emroma1'; }
  if (DB.settings && !DB.settings.voucherSeed) { DB.settings.voucher = DB.settings.voucher || {}; if (!DB.settings.voucher.blocos) DB.settings.voucher.blocos = Object.assign({}, VOUCHER_BLOCOS_EMROMA); DB.settings.voucherSeed = 'emroma1'; }
  if (DB.settings && DB.settings.plantao === undefined) DB.settings.plantao = '';
  DB.tarefas = DB.tarefas || [];
  DB.conversas = DB.conversas || {};
  DB.lembretesVistos = DB.lembretesVistos || {};
  DB.clientes = DB.clientes || [];
  DB.parceiros = DB.parceiros || [];
  DB.pontos = DB.pontos || [];
  const demo = DB.demo && !(typeof temNuvem === 'function' && temNuvem());
  const limpo = _semExemplos();
  /* pontos de encontro são reais (Vaticano, Coliseu, aeroporto) e ligam ao
     catálogo: entram mesmo no app zerado */
  if (demo && !DB.pontosSeed) { opSemeiaPontos(); DB.pontosSeed = 1; }
  if (demo && !limpo && !DB.interesseSeed) { opSemeiaInteresse(); DB.interesseSeed = 1; }
  if (demo && !limpo && (+DB.opSeed || 0) < OP_SEED) {
    opSemeiaDemo();
    DB.opSeed = OP_SEED;
  }
  /* o cadastro nasce das reservas que ja existem (uma vez so) */
  if (!DB.cadastroFeito) {
    for (const bk of [...DB.bookings].sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))) cadastroDaReserva(bk);
    DB.cadastroFeito = 1;
  }
  if (demo && !limpo && !DB.parceirosSeed) { opSemeiaParceiros(); DB.parceirosSeed = 1; }
  /* tarefas de exemplo so uma vez, e so na demonstracao */
  if (demo && !limpo && !DB.tarefasSeed && typeof opSemeiaTarefas === 'function') {
    opSemeiaTarefas();
    DB.tarefasSeed = 1;
  }
  /* o aparelho dela que já viu a demonstração se limpa sozinho uma vez,
     só se os dados ainda são os de exemplo (ela ainda não começou) */
  if (limpo && (+DB.resetFeito || 0) < RESET_VER && _pareceDemo()) { zerarExemplos(); return; }
  _opSave();
}
function opSemeiaDemo() {
  const hoje = isoToday();
  /* nomes ficticios — as guias de verdade ela cadastra */
  const gente = [
    ['g1', 'Marta Bellini', 'guia', '+39 333 100 2001', ['Roma'], 'português, italiano'],
    ['g2', 'Carla Nunes', 'guia', '+39 333 100 2002', ['Roma', 'Tivoli'], 'português, espanhol'],
    ['g3', 'Giulia Rossi', 'guia', '+39 333 100 2003', ['Roma', 'Florença'], 'português, inglês'],
    ['g4', 'Beatriz Lopes', 'guia', '+39 333 100 2004', ['Roma'], 'português'],
    ['g5', 'Sofia Conti', 'guia', '+39 333 100 2005', ['Florença', 'Toscana'], 'português, italiano'],
    ['g6', 'Ana Ferraro', 'guia', '+39 333 100 2006', ['Nápoles', 'Pompeia', 'Costa Amalfitana'], 'português'],
    ['m1', 'Luca (Roma Transfer)', 'motorista', '+39 333 100 3001', ['Roma'], 'italiano, inglês'],
    ['m2', 'Paolo (NCC Paolo)', 'motorista', '+39 333 100 3002', ['Roma', 'Civitavecchia'], 'italiano'],
  ];
  DB.equipe = gente.map(([id, nome, tipo, whats, cidades, idiomas], i) =>
    ({ id: 'op-' + id, nome, tipo, whats, cidades, idiomas, obs: '', pref: i + 1 }));
  DB.contas = contasPadrao();

  /* o dia de hoje e os proximos, como numa semana normal dela */
  const P = [
    { quem: ['Juliana Andrade', 'ju.andrade@email.com', '+55 11 99876 5501'], tourId: 'transfer-aeroporto', d: 0, time: '14:40', pax: 3,
      voo: 'AZ 673 (GRU→FCO)', origem: 'Fiumicino, desembarque T3', destino: 'Hotel Artemide, Via Nazionale 22', pres: 'op-m1', sinalPago: 'wise-br',
      group: [{ nome: 'Marcos Andrade', nasc: '1980-04-12' }, { nome: 'Lia Andrade', nasc: '2014-09-03' }] },
    { quem: ['Roberto Farias', 'roberto.farias@email.com', '+55 21 98765 4402'], tourId: 'vaticano-3h', d: 0, time: '09:00', pax: 2,
      pres: 'op-g1', sinalPago: 'nubank', restoPara: 'prestador', obsOp: 'Casal, primeira vez em Roma. Ela é vegetariana.',
      group: [{ nome: 'Helena Farias', nasc: '' }] },
    { quem: ['Camila Teixeira', 'camila.tx@email.com', '+55 31 99654 3303'], tourId: 'roma-antiga-3h', d: 1, time: '09:00', pax: 4,
      sinalPago: 'wise-eu', restoPara: 'prestador', obsOp: 'Quer o Coliseu por dentro (arena).' },
    { quem: ['Juliana Andrade', 'ju.andrade@email.com', '+55 11 99876 5501'], tourId: 'barroca-3h', d: 1, time: '15:00', pax: 3,
      sinalPago: 'wise-br', restoPara: 'prestador', pres: 'op-g2' },
    { quem: ['Eduardo Pires', 'edu.pires@email.com', '+55 41 99123 2204'], tourId: 'transfer-civitavecchia', d: 2, time: '07:00', pax: 5,
      origem: 'Porto de Civitavecchia — navio MSC Seaview', destino: 'Hotel Quirinale', sinalPago: 'revolut' },
    { quem: ['Grupo Viagens Sol (agência)', 'reservas@viagenssol.com', '+55 11 3333 4405'], tourId: 'bv-pompeia', d: 3, time: '07:30', pax: 6,
      pagoTudo: 'wise-eu', restoPara: 'ingrid', custo: 520, obsOp: 'Agência: cliente já pagou tudo. Ingrid acerta com a guia.' },
  ];
  let k = 0;
  for (const s of P) {
    const x = Tours.get(s.tourId); if (!x) continue;
    const date = addDays(hoje, s.d);
    const pr = Bookings.precoDe(x, x.id, date, s.time, s.pax, { opcao: 0 });
    const total = pr.total || 0;
    const sinal = x.priceMode === 'transfer' ? (pr.sinal || 30) : Math.round(total * 0.3);
    const b = {
      id: 'op' + (++k), code: PREFIXO + '-' + (5100 + k * 41),
      tourId: x.id, date, time: s.time, name: s.quem[0], email: s.quem[1], whats: s.quem[2], insta: '',
      pax: s.pax, total, coupon: null, discount: 0, policy: s.pagoTudo ? 'full' : 'sinal', sinal: s.pagoTudo ? 0 : sinal,
      adultos: s.pax, criancas: 0, idades: [], veiculo: pr.veiculo || '', malas: pr.malas || '',
      group: s.group || [], consent: { ok: true, at: addDays(date, -12) + 'T10:00:00.000Z', src: 'checkout' },
      payments: [], status: 'confirmed', createdAt: addDays(date, -12) + 'T10:00:00.000Z', origin: 'whatsapp',
      voo: s.voo || '', origem: s.origem || '', destino: s.destino || '', obsOp: s.obsOp || '',
      prestadorId: s.pres || '', restoPara: s.restoPara || '', custo: s.custo || 0,
    };
    if (s.pagoTudo) b.payments.push({ amount: total, date: addDays(date, -10), method: 'transfer', kind: 'full', conta: s.pagoTudo });
    else if (s.sinalPago) {
      const c = contasPadrao().find(z => z.id === s.sinalPago);
      b.payments.push({ amount: sinal, date: addDays(date, -12), method: c ? c.metodo : 'transfer', kind: 'deposit', conta: s.sinalPago });
    }
    DB.bookings = DB.bookings.filter(z => z.id !== b.id);
    DB.bookings.push(b);
  }
  /* respostas das guias para amanha de manha — o caso da reuniao */
  const am = addDays(hoje, 1);
  DB.disp = [
    { pessoaId: 'op-g1', data: am, turno: 'manha', estado: 'ocupada', nota: 'já tem grupo', em: new Date().toISOString() },
    { pessoaId: 'op-g3', data: am, turno: 'manha', estado: 'livre', nota: 'até 13h', em: new Date().toISOString() },
    { pessoaId: 'op-g4', data: am, turno: 'manha', estado: 'livre', nota: '', em: new Date().toISOString() },
  ];
  /* um pedido que chegou de madrugada pelo WhatsApp, esperando por ela */
  const conversa = `[${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(2, 4)} 03:12] Fernanda Lima: Oi Ingrid! Tudo bem? Vi seu perfil no Instagram 😊
[${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(2, 4)} 03:13] Fernanda Lima: Somos 4 pessoas (2 adultos e 2 crianças), chegamos em Roma dia ${addDays(hoje, 20).slice(8, 10)}/${addDays(hoje, 20).slice(5, 7)} no voo LA 8070 em Fiumicino
[${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(2, 4)} 03:14] Fernanda Lima: Queremos transfer de chegada, visitar o Vaticano e o Coliseu, e um bate e volta a Pompeia. Depois vamos para Florença de trem
[${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(2, 4)} 03:15] Fernanda Lima: Meu WhatsApp é +55 48 99612 7788`;
  const c = lerConversa(conversa);
  if (!(DB.orcamentos || []).some(o => o.origem === 'whats' && o.cliente.nome === c.nome)) {
    Orc.cria({ origem: 'whats', status: 'novo', cliente: { nome: c.nome, whats: c.whats }, conversa, resumo: c.resumo,
               pax: c.pax, datas: c.datas, itens: rascunhoDaConversa(c) });
  }
}

/* ---------- TAREFAS E ANOTACOES ----------
   Tarefa: tem prazo (ou nao), pode estar ligada a um cliente, a um servico,
   a um orcamento ou a uma guia. Anotacao: texto com data — e onde cai o
   resumo que o robo do WhatsApp vai deixar para ela conferir de manha.
   As duas aparecem na Agenda do app e viram evento na agenda do celular.

   Os LEMBRETES nao sao guardados: o app calcula na hora o que precisa ser
   feito (cliente que deve, orcamento sem resposta, voucher para mandar,
   servico sem guia). Ela marca "feito" e o lembrete some. */
const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
/* "amanha 9h", "sexta", "12/10 14:30" — o prazo sai do proprio texto */
function lerPrazo(txt, hoje) {
  hoje = hoje || isoToday();
  const low = String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let data = '', hora = '';
  if (/\bdepois de amanha\b/.test(low)) data = addDays(hoje, 2);
  else if (/\bamanha\b/.test(low)) data = addDays(hoje, 1);
  else if (/\bhoje\b/.test(low)) data = hoje;
  else {
    const d = low.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (d) data = _isoDe(d[1], d[2], d[3]);
    else {
      const w = DIAS_SEMANA.findIndex(n => new RegExp('\\b' + n + '(-feira)?\\b').test(low));
      if (w >= 0) {
        const hj = new Date(hoje + 'T12:00:00').getDay();
        data = addDays(hoje, ((w - hj + 7) % 7) || 7);
      }
    }
  }
  /* repeticao: "todo dia 01", "toda quinta", "todas as quintas", "todo dia" */
  let repete = '';
  const mDia = low.match(/\btodo (?:o )?dia (\d{1,2})\b/);
  if (mDia) {
    repete = 'mensal';
    const d = +mDia[1], hj = new Date(hoje + 'T12:00:00');
    let alvo = new Date(hj.getFullYear(), hj.getMonth(), d, 12);
    if (alvo.toISOString().slice(0, 10) < hoje) alvo = new Date(hj.getFullYear(), hj.getMonth() + 1, d, 12);
    data = alvo.toISOString().slice(0, 10);
  } else if (/\btod[ao]s? (?:as |os )?(segunda|terca|quarta|quinta|sexta|sabado|domingo)/.test(low)) {
    repete = 'semanal';
    const w = DIAS_SEMANA.findIndex(n => new RegExp('tod[ao]s? (?:as |os )?' + n).test(low));
    const hj = new Date(hoje + 'T12:00:00').getDay();
    data = addDays(hoje, (w - hj + 7) % 7);
  } else if (/\btodo dia\b|\btodos os dias\b|\bdiariamente\b/.test(low)) { repete = 'diario'; data = data || hoje; }
  const h = low.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/);
  if (h && +h[1] < 24) hora = String(+h[1]).padStart(2, '0') + ':' + String(h[2] || h[3] || '00').padStart(2, '0');
  return { data, hora, repete };
}
const Tarefas = {
  all() { return DB.tarefas || []; },
  get(id) { return (DB.tarefas || []).find(t => t.id === id) || null; },
  cria(d) {
    DB.tarefas = DB.tarefas || [];
    const texto = String(d.texto || '').trim(); if (!texto) return null;
    const t = {
      id: uid(), tipo: d.tipo === 'nota' ? 'nota' : 'tarefa', texto, detalhe: String(d.detalhe || '').trim(),
      prazo: d.prazo || '', hora: d.hora || '', feita: false, feitaEm: '', criada: new Date().toISOString(),
      clienteKey: d.clienteKey || '', clienteNome: String(d.clienteNome || '').trim(), whats: String(d.whats || '').trim(),
      bookingId: d.bookingId || '', orcId: d.orcId || '', pessoaId: d.pessoaId || '',
      fixa: !!d.fixa, origem: d.origem || 'manual',
      /* a tarefa inteligente: que tipo de passo e, quando se fecha sozinha,
         a que esta ligada, e de qual tarefa ela nasceu */
      etapa: d.etapa || (d.tipo === 'nota' ? '' : etapaDoTexto(texto)),
      fechaQuando: d.fechaQuando || '', liga: d.liga || {}, chave: d.chave || '',
      tentativa: +d.tentativa || 1, anterior: d.anterior || '', obsFim: '',
      /* "todo dia 01", "toda quinta": ao concluir, nasce a proxima */
      repete: ['diario', 'semanal', 'mensal'].includes(d.repete) ? d.repete : '',
      /* "de 3/10 até 31/10": depois dessa data não nasce a próxima (pedido dela, 03/10) */
      repeteAte: /^\d{4}-\d{2}-\d{2}$/.test(d.repeteAte || '') ? d.repeteAte : '',
    };
    DB.tarefas.push(t); _opSave(); return t;
  },
  /* "aguardar" nao se duplica: se ja existe uma aberta com a mesma chave,
     so empurra o prazo */
  garante(d) {
    const ja = d.chave && Tarefas.all().find(t => !t.feita && t.chave === d.chave);
    if (ja) { if (d.prazo) ja.prazo = d.prazo; if (d.hora !== undefined) ja.hora = d.hora; _opSave(); return ja; }
    return Tarefas.cria(d);
  },
  /* CONCLUIR — e aqui que a tarefa vira a proxima. resultado vem dos botoes
     da tarefa de espera: 'respondeu', 'cutucar' (nao respondeu), ou vazio. */
  conclui(id, resultado) {
    const t = Tarefas.get(id); if (!t || t.feita) return null;
    t.feita = true; t.feitaEm = new Date().toISOString();
    t.obsFim = resultado === 'respondeu' ? 'respondeu' : resultado === 'cutucar' ? 'não respondeu' : '';
    /* FOLLOW-UP (colunas "Follow-up 1/2/3" da planilha dela; antes "Repescagem"): a espera
       de um orçamento que acabou, ou o follow-up que ela fez, vira "Follow-up N · data ·
       resultado" no próprio pedido. Se a data já estava marcada (planejada), completa a mesma. */
    if (t.orcId && (t.etapa === 'aguardar' || t.etapa === 'followup')) {
      const o = Orc.get(t.orcId);
      if (o) { o.repescagens = o.repescagens || []; const n = +t.tentativa || 1;
        const res = t.etapa === 'followup' ? (t.obsFim || 'mandado') : (t.obsFim || resultado || 'feito');
        const x = o.repescagens.find(y => +y.n === n);
        if (x) { if (t.etapa === 'followup' || !x.data || x.data > isoToday()) x.data = isoToday(); x.resultado = res; }
        else { o.repescagens.push({ n, data: isoToday(), resultado: res }); o.repescagens.sort((a, b) => a.n - b.n); } }
    }
    if (t.repete && t.prazo) {
      const d0 = new Date(t.prazo + 'T12:00:00');
      if (t.repete === 'mensal') d0.setMonth(d0.getMonth() + 1); else d0.setDate(d0.getDate() + (t.repete === 'semanal' ? 7 : 1));
      let pz = d0.toISOString().slice(0, 10);
      while (pz < isoToday()) { const dd = new Date(pz + 'T12:00:00'); if (t.repete === 'mensal') dd.setMonth(dd.getMonth() + 1); else dd.setDate(dd.getDate() + (t.repete === 'semanal' ? 7 : 1)); pz = dd.toISOString().slice(0, 10); }
      if (!t.repeteAte || pz <= t.repeteAte)
        Tarefas.cria({ texto: t.texto, detalhe: t.detalhe, prazo: pz, hora: t.hora, repete: t.repete, repeteAte: t.repeteAte || '', clienteKey: t.clienteKey, clienteNome: t.clienteNome, whats: t.whats, etapa: t.etapa === 'aguardar' ? '' : t.etapa });
    }
    const prox = t.repete ? null : proximoPasso(t, resultado);
    const nova = prox ? Tarefas.garante({ ...prox, anterior: t.id, clienteKey: prox.clienteKey ?? t.clienteKey,
      clienteNome: prox.clienteNome ?? t.clienteNome, whats: prox.whats ?? t.whats, bookingId: prox.bookingId ?? t.bookingId,
      orcId: prox.orcId ?? t.orcId, pessoaId: prox.pessoaId ?? t.pessoaId }) : null;
    _opSave();
    return nova;
  },
  adia(id, dias) {
    const t = Tarefas.get(id); if (!t) return;
    t.prazo = addDays(isoToday(), dias || 2); _opSave();
  },
  /* FECHAR SOZINHA: o cliente pagou, o orcamento foi decidido, a guia
     respondeu. Roda antes de desenhar a tela. Devolve o que fechou. */
  sincroniza(hoje) {
    hoje = hoje || isoToday();
    const fechadas = [];
    for (const t of Tarefas.all()) {
      if (t.feita || !t.fechaQuando) continue;
      let motivo = '', resultado = 'respondeu';
      if (t.fechaQuando === 'pago') {
        const bs = t.bookingId ? [Bookings.get(t.bookingId)].filter(Boolean)
          : DB.bookings.filter(b => t.clienteKey && chaveCliente(b) === t.clienteKey && b.status !== 'cancelled');
        if (bs.length && bs.every(b => b.status === 'cancelled' || Op.dueIngrid(b) <= 0)) motivo = 'pagou';
      } else if (t.fechaQuando === 'orc-decidido') {
        const o = Orc.get(t.orcId);
        if (!o && t.orcId) motivo = 'o orçamento foi apagado';
        else if (o && o.status === 'fechado') motivo = 'o orçamento fechou';
        else if (o && o.status === 'perdido') { motivo = 'o orçamento não fechou'; resultado = 'perdido'; }
      } else if (t.fechaQuando === 'guia-respondeu' && t.liga && t.liga.data) {
        const tu = t.liga.turno === 'dia' ? 'manha' : t.liga.turno;
        const e = Disp.estado(t.pessoaId, t.liga.data, tu);
        if (e.estado) { motivo = e.estado === 'livre' ? 'a guia respondeu: livre' : 'a guia respondeu: ocupada'; resultado = e.estado; }
      }
      if (!motivo) continue;
      Tarefas.conclui(t.id, resultado);
      t.obsFim = motivo + ' — concluída sozinha';
      fechadas.push(t);
    }
    if (fechadas.length) _opSave();
    return fechadas;
  },
  salva(id, d) {
    const t = Tarefas.get(id); if (!t) return null;
    for (const k of ['texto', 'detalhe', 'prazo', 'hora', 'clienteKey', 'clienteNome', 'fixa', 'repete', 'repeteAte']) if (d[k] !== undefined) t[k] = typeof d[k] === 'string' ? d[k].trim() : d[k];
    _opSave(); return t;
  },
  marca(id, feita) {
    const t = Tarefas.get(id); if (!t) return;
    t.feita = !!feita; t.feitaEm = feita ? new Date().toISOString() : '';
    _opSave();
  },
  remove(id) { DB.tarefas = (DB.tarefas || []).filter(t => t.id !== id); _opSave(); },
  /* as tarefas abertas, na ordem em que ela resolve o dia */
  grupos(hoje) {
    hoje = hoje || isoToday();
    const abertas = Tarefas.all().filter(t => t.tipo === 'tarefa' && !t.feita)
      .sort((a, b) => ((a.prazo || '9999') + (a.hora || '99')).localeCompare((b.prazo || '9999') + (b.hora || '99')));
    const sem7 = addDays(hoje, 7);
    return {
      atrasadas: abertas.filter(t => t.prazo && t.prazo < hoje),
      hoje: abertas.filter(t => t.prazo === hoje),
      semana: abertas.filter(t => t.prazo > hoje && t.prazo <= sem7),
      depois: abertas.filter(t => t.prazo > sem7),
      semData: abertas.filter(t => !t.prazo),
      feitas: Tarefas.all().filter(t => t.tipo === 'tarefa' && t.feita).sort((a, b) => (b.feitaEm || '').localeCompare(a.feitaEm || '')).slice(0, 30),
    };
  },
  /* a tarefa/anotação casa com a busca? nome, palavra do texto/detalhe/cliente ou 4 últimos números do telefone */
  casa(t, q) {
    const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const s = n(q).trim(); if (!s) return true;
    const dig = s.replace(/\D/g, '');
    if ([t.texto, t.detalhe, t.nota, t.clienteNome, t.obsFim].some(v => v && n(v).includes(s))) return true;
    return dig.length >= 4 && String(t.whats || '').replace(/\D/g, '').endsWith(dig.slice(-8));
  },
  notas(busca) {
    const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = n(busca).trim();
    return Tarefas.all().filter(t => t.tipo === 'nota')
      .filter(t => !q || [t.texto, t.detalhe, t.clienteNome].some(v => n(v).includes(q)))
      .sort((a, b) => (b.fixa - a.fixa) || (b.criada || '').localeCompare(a.criada || ''));
  },
  doDia(data) { return Tarefas.all().filter(t => t.prazo === data).sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99')); },
  /* do mesmo cliente: pela chave da ficha ou pelo WhatsApp */
  doCliente(k, whats) {
    const w = String(whats || '').replace(/\D/g, '');
    return Tarefas.all().filter(t => (k && t.clienteKey === k)
      || (w.length >= 6 && String(t.whats || '').replace(/\D/g, '').endsWith(w.slice(-8))));
  },
};

/* ---------- o fluxo das tarefas inteligentes ----------
   mensagem  -> aguardar resposta (2 dias)
   cobrar    -> aguardar pagamento (fecha sozinha quando o cliente paga)
   orcamento -> aguardar resposta do orcamento (fecha sozinha quando fecha)
   guia      -> aguardar a guia (fecha sozinha quando voce marca livre/ocupada)
   aguardar  -> respondeu: o passo seguinte (fechar, escalar) | nao respondeu:
                mandar um lembrete, que volta a aguardar (ate 3 tentativas) */
const ETAPAS = {
  mensagem:  { nome: 'mensagem', depois: 'aguardar resposta' },
  cobrar:    { nome: 'cobrança', depois: 'aguardar o pagamento' },
  orcamento: { nome: 'orçamento', depois: 'aguardar a resposta do orçamento' },
  guia:      { nome: 'pedir disponibilidade', depois: 'aguardar a guia' },
  aguardar:  { nome: 'aguardando', depois: '' },
  fechar:    { nome: 'fechar', depois: '' },
  escalar:   { nome: 'escalar', depois: 'aguardar a confirmação da guia' },
};
function etapaDoTexto(txt) {
  const low = String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(cobrar|pedir o pagamento|lembrar .* pagamento)/.test(low)) return 'cobrar';
  if (/orcamento/.test(low) && /^(mandar|enviar|montar)/.test(low)) return 'orcamento';
  if (/^(perguntar|confirmar) (a|o|com a|com o) (guia|motorista)/.test(low)) return 'guia';
  if (/^(aguardar|esperar)/.test(low)) return 'aguardar';
  if (/^(mandar|enviar|responder|perguntar|falar|ligar|escrever|chamar|confirmar|avisar|lembrar)/.test(low)) return 'mensagem';
  return '';
}
function _alvo(t) {
  const p = t.pessoaId && Equipe.get(t.pessoaId);
  return (p && p.nome.split(' ')[0]) || (t.clienteNome && t.clienteNome.split(' ')[0]) || 'o cliente';
}
function proximoPasso(t, resultado) {
  const hoje = isoToday(), alvo = _alvo(t);
  if (t.etapa === 'mensagem')
    return { etapa: 'aguardar', texto: `Aguardar resposta de ${alvo}`, detalhe: 'Depois de: ' + t.texto, prazo: addDays(hoje, 2), chave: 'resp:' + (t.clienteKey || t.whats || t.pessoaId || t.id), tentativa: t.tentativa };
  if (t.etapa === 'cobrar')
    return { etapa: 'aguardar', texto: `Aguardar o pagamento de ${alvo}`, prazo: addDays(hoje, 2), fechaQuando: 'pago', chave: 'pago:' + (t.bookingId || t.clienteKey), tentativa: t.tentativa };
  if (t.etapa === 'orcamento')
    return { etapa: 'aguardar', texto: `Aguardar a resposta de ${alvo} sobre o orçamento`, prazo: addDays(hoje, 2), fechaQuando: 'orc-decidido', chave: 'orc:' + t.orcId, tentativa: t.tentativa };
  if (t.etapa === 'guia')
    return { etapa: 'aguardar', texto: `Aguardar a resposta de ${alvo}`, prazo: hoje, fechaQuando: t.liga && t.liga.data ? 'guia-respondeu' : '', liga: t.liga, chave: 'guia:' + t.pessoaId + ':' + ((t.liga && t.liga.data) || ''), tentativa: t.tentativa };
  if (t.etapa === 'followup')
    return { etapa: 'aguardar', texto: `Aguardar a resposta de ${alvo} (follow-up ${+t.tentativa || 1})`, prazo: addDays(hoje, 2), fechaQuando: t.orcId ? 'orc-decidido' : '', chave: 'orc:' + (t.orcId || t.id), tentativa: t.tentativa };
  if (t.etapa === 'escalar')
    return { etapa: 'aguardar', texto: `Aguardar a confirmação de ${alvo}`, prazo: hoje, chave: 'conf:' + t.pessoaId + ':' + t.bookingId };
  if (t.etapa !== 'aguardar') return null;
  /* a espera acabou */
  if (resultado === 'cutucar') {
    const n = (+t.tentativa || 1) + 1;
    if (n > 3) return { etapa: t.orcId ? 'fechar' : '', texto: t.orcId ? `${alvo} não respondeu 3 vezes: marcar o orçamento como "não fechou"?` : `${alvo} não respondeu 3 vezes — decidir o que fazer`, prazo: hoje, chave: 'desiste:' + t.id };
    const cobranca = t.fechaQuando === 'pago';
    return { etapa: cobranca ? 'cobrar' : t.fechaQuando === 'orc-decidido' ? 'orcamento' : t.fechaQuando === 'guia-respondeu' ? 'guia' : 'mensagem',
             texto: cobranca ? `Lembrar ${alvo} do pagamento (${n}ª vez)` : `Mandar um lembrete para ${alvo} (${n}ª vez)`,
             prazo: hoje, tentativa: n, liga: t.liga, chave: 'lembra:' + t.id };
  }
  if (resultado === 'perdido' || resultado === 'ocupada') {
    if (resultado === 'ocupada' && t.liga && t.liga.bookingId && !(Bookings.get(t.liga.bookingId) || {}).prestadorId)
      return { etapa: 'guia', texto: `${alvo} está ocupada: perguntar à próxima da lista`, prazo: hoje, liga: t.liga, pessoaId: '', chave: 'proxima:' + t.liga.bookingId };
    return null;
  }
  if (t.orcId) { const o = Orc.get(t.orcId); if (o && o.status !== 'fechado' && o.status !== 'perdido') return { etapa: 'fechar', texto: `Fechar o orçamento de ${alvo}: registrar o sinal e criar as reservas`, prazo: hoje, chave: 'fechar:' + t.orcId }; }
  if (t.pessoaId && t.liga && t.liga.bookingId) {
    const b = Bookings.get(t.liga.bookingId);
    if (b && !b.prestadorId && resultado !== 'ocupada') return { etapa: 'escalar', texto: `Escalar ${alvo} e mandar o serviço de ${b.name}`, prazo: hoje, bookingId: b.id, chave: 'escalar:' + b.id };
  }
  return null;
}
/* as esperas que as outras telas criam sozinhas */
/* ---------- CONVERSAS — a central de mensagens ----------
   O que ela MANDOU a cada cliente (registrado quando aperta "mandar no
   WhatsApp") e o que está esperando dela (orçamento sem resposta, cobrar,
   confirmar, tarefas de espera). Mensagens que CHEGAM entram quando o
   WhatsApp oficial for ligado (depende da Meta). Chave = a da ficha. */
const Conversas = {
  de(chave) { DB.conversas = DB.conversas || {}; return DB.conversas[chave] || []; },
  log(chave, d) {
    DB.conversas = DB.conversas || {};
    const texto = String((d && d.texto) || '').trim(); if (!chave || !texto) return null;
    const m = { id: uid(), quando: new Date().toISOString(), canal: (d && d.canal) || 'whats', texto, modelo: (d && d.modelo) || '' };
    (DB.conversas[chave] = DB.conversas[chave] || []).push(m); _opSave(); return m;
  },
  ultima(chave) { const l = Conversas.de(chave); return l.length ? l[l.length - 1] : null; },
  /* por que falar com este cliente agora */
  pendencias(c, hoje) {
    hoje = hoje || isoToday(); const out = [], k = chaveFicha(c);
    const E = (v) => (typeof eur === 'function' ? eur(v) : v + ' €');
    const r = Cadastro.resumo(c, hoje);
    const orcs = ((typeof Fichas !== 'undefined' && Fichas.doCliente) ? Fichas.doCliente(k, c.whats, c.email).orcamentos : []) || [];
    for (const o of orcs) if (o.status === 'enviado') out.push({ tipo: 'orc', txt: `orçamento ${o.num} enviado · sem resposta`, link: '#/adm/consulta/' + o.id });
    for (const o of orcs) if (o.status === 'rascunho' || o.status === 'novo') out.push({ tipo: 'orc', txt: `orçamento ${o.num} em montagem`, link: '#/adm/consulta/' + o.id });
    if (r.deve > 0) out.push({ tipo: 'cobrar', txt: `deve ${E(r.deve)}` });
    if (r.prox) { const d = _dias(hoje, r.prox.date); if (d >= 0 && d <= 3) out.push({ tipo: 'confirmar', txt: `${nomeDoServico(r.prox)} ${d === 0 ? 'hoje' : 'em ' + d + ' dia' + (d > 1 ? 's' : '')}` }); }
    const vistos = new Set();
    for (const t of Tarefas.doCliente(k, c.whats).concat(Tarefas.all().filter(t => t.clienteKey === 'c:' + c.id)))
      if (!t.feita && t.etapa === 'aguardar' && !vistos.has(t.id)) { vistos.add(t.id); out.push({ tipo: 'aguardar', txt: t.texto, tarefaId: t.id }); }
    return out;
  },
};
const Espera = {
  /* ela mandou uma mensagem: o app passa a aguardar a resposta (2 dias), uma por dia por cliente */
  mensagem(c, chave) {
    return Tarefas.garante({ etapa: 'aguardar', texto: `Aguardar a resposta de ${String(c.nome || 'o cliente').split(' ')[0]}`,
      prazo: addDays(isoToday(), 2), fechaQuando: '', clienteKey: 'c:' + c.id, clienteNome: c.nome, whats: c.whats,
      chave: 'msg:' + chave + ':' + isoToday(), origem: 'app' });
  },
  orcamento(o) {
    const t = Tarefas.garante({ etapa: 'aguardar', texto: `Aguardar a resposta de ${(o.cliente.nome || 'o cliente').split(' ')[0]} sobre o orçamento ${o.num}`,
      prazo: addDays(isoToday(), 2), fechaQuando: 'orc-decidido', orcId: o.id, clienteNome: o.cliente.nome, whats: o.cliente.whats,
      clienteKey: o.clienteKey || '', chave: 'orc:' + o.id, origem: 'app' });
    if (typeof Orc !== 'undefined' && Orc.followUpsAuto) Orc.followUpsAuto(o.id);   // o follow-up padrão 30/15/7 entra junto
    return t;
  },
  guia(p, data, turno, b) {
    return Tarefas.garante({ etapa: 'aguardar', texto: `Aguardar a resposta de ${p.nome.split(' ')[0]} (${data.slice(8, 10)}/${data.slice(5, 7)} ${turno === 'manha' ? 'manhã' : turno === 'dia' ? 'dia inteiro' : turno})`,
      prazo: isoToday(), fechaQuando: 'guia-respondeu', pessoaId: p.id, liga: { data, turno, bookingId: b ? b.id : '' },
      clienteNome: b ? b.name : '', chave: 'guia:' + p.id + ':' + data + ':' + turno, origem: 'app' });
  },
  pagamento(dev) {
    return Tarefas.garante({ etapa: 'aguardar', texto: `Aguardar o pagamento de ${dev.nome.split(' ')[0]} (${dev.total} €)`,
      prazo: addDays(isoToday(), 2), fechaQuando: 'pago', clienteKey: dev.chave, clienteNome: dev.nome, whats: dev.whats,
      chave: 'pago:' + dev.chave, origem: 'app' });
  },
};

/* o que o app sabe que precisa ser feito — calculado, nunca digitado */
const Lembretes = {
  visto(chave) { return !!((DB.lembretesVistos || {})[chave]); },
  marca(chave) { DB.lembretesVistos = DB.lembretesVistos || {}; DB.lembretesVistos[chave] = isoToday(); _opSave(); },
  /* CLIENTES QUE DEVEM: o que falta pagar a ELA (o resto no dia com a guia
     nao entra — esse a guia recebe). Um por cliente, com o total. */
  devedores(hoje) {
    hoje = hoje || isoToday();
    const map = new Map();
    for (const b of DB.bookings) {
      if (b.status === 'cancelled') continue;
      const falta = Op.dueIngrid(b); if (falta <= 0) continue;   // inclui o sinal combinado que ainda não caiu
      const k = chaveCliente(b);
      const r = map.get(k) || { chave: k, nome: b.name, whats: b.whats, total: 0, prazo: '', servicos: [] };
      r.total += falta; r.servicos.push(b);
      const pz = Bookings.dueDate(b); if (!r.prazo || pz < r.prazo) r.prazo = pz;
      map.set(k, r);
    }
    return [...map.values()].map(r => ({ ...r, atrasado: r.prazo < hoje })).sort((a, b) => a.prazo.localeCompare(b.prazo));
  },
  lista(hoje) {
    hoje = hoje || isoToday();
    const out = [];
    const add = (l) => { if (!Lembretes.visto(l.chave)) out.push(l); };
    for (const o of DB.orcamentos || []) {
      if (o.status === 'novo' || o.status === 'rascunho')
        add({ chave: 'orc-montar:' + o.id, grupo: 'orcamentos', nivel: 'warn', data: String(o.criado).slice(0, 10), txt: `Montar e mandar o orçamento de ${o.cliente.nome || 'um cliente'}`, sub: o.resumo || o.num, href: '#/adm/consulta/' + o.id });
      if (o.status === 'enviado' && o.validade && o.validade <= addDays(hoje, 1))
        add({ chave: 'orc-validade:' + o.id + ':' + o.validade, grupo: 'orcamentos', nivel: o.validade < hoje ? 'bad' : 'warn', data: o.validade, txt: `Orçamento ${o.num} de ${o.cliente.nome} ${o.validade < hoje ? 'venceu' : 'vence'} em ${o.validade.slice(8, 10)}/${o.validade.slice(5, 7)} — perguntar se fecha`, href: '#/adm/consulta/' + o.id, whats: o.cliente.whats });
    }
    for (const p of DB.pedidos || []) {
      if (!p.respondido && !(DB.orcamentos || []).some(o => o.pedidoId === p.id))
        add({ chave: 'roteiro:' + p.id, grupo: 'orcamentos', nivel: 'warn', data: String(p.criado).slice(0, 10), txt: `Responder o pedido de roteiro de ${p.nome}`, href: '#/adm/consulta', whats: p.whats });
    }
    for (const b of DB.bookings) {
      if (b.status === 'cancelled') continue;
      if (b.date >= hoje && b.date <= addDays(hoje, 3) && !b.prestadorId)
        add({ chave: 'escalar:' + b.id, grupo: 'servicos', nivel: b.date <= addDays(hoje, 1) ? 'bad' : 'warn', data: b.date, bookingId: b.id,
              txt: `Escalar ${(Tours.get(b.tourId) || {}).priceMode === 'transfer' ? 'motorista' : 'guia'} para ${b.name} (${b.date.slice(8, 10)}/${b.date.slice(5, 7)} ${b.time})`, href: '#/adm/guias/servico:' + b.id });
      if (b.date >= hoje && b.date <= addDays(hoje, 30) && Op.precisaIngresso(b) && !b.ingressosOk)
        add({ chave: 'ingresso:' + b.id, grupo: 'servicos', nivel: b.date <= addDays(hoje, 7) ? 'bad' : 'warn', data: b.date, bookingId: b.id,
              txt: `Comprar os ingressos de ${b.name} — ${nomeDoServico(b)} (${b.date.slice(8, 10)}/${b.date.slice(5, 7)})`, href: '#/adm/clients/' + encodeURIComponent('c:' + (b.clienteId || '')) });
      if (b.date >= hoje && b.date <= addDays(hoje, 2) && !b.voucherEm)
        add({ chave: 'voucher:' + b.id, grupo: 'servicos', nivel: 'n', data: b.date, bookingId: b.id,
              txt: `Mandar o voucher para ${b.name} (${b.date.slice(8, 10)}/${b.date.slice(5, 7)})`, href: '#/adm/voucher/' + b.id });
      if (+b.custo > 0 && !b.acertado && b.date < hoje && b.prestadorId) {
        const a = acertos(b.date, b.date).find(x => x.b.id === b.id);
        if (a && a.saldo) add({ chave: 'acerto:' + b.id, grupo: 'servicos', nivel: 'n', data: b.date, bookingId: b.id,
          txt: a.saldo > 0 ? `Pagar ${a.saldo} € a ${(a.pessoa || {}).nome || 'quem fez'} (${b.name})` : `Receber ${-a.saldo} € de ${(a.pessoa || {}).nome || 'quem fez'} (${b.name})`, href: '#/adm/money' });
      }
    }
    return out.sort((a, b) => ({ bad: 0, warn: 1, n: 2 }[a.nivel] - { bad: 0, warn: 1, n: 2 }[b.nivel]) || String(a.data).localeCompare(String(b.data)));
  },
};
/* evento para a agenda do celular (Google Agenda, iPhone): com aviso 30 min antes */
function icsTarefa(t) {
  const esc = (v) => String(v || '').replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const dia = (t.prazo || isoToday()).replace(/-/g, '');
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EmRoma//Tarefas//PT', 'BEGIN:VEVENT',
    'UID:' + t.id + '@emroma-tarefas', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'];
  if (t.hora) {
    const [h, m] = t.hora.split(':').map(Number);
    const fim = String(Math.min(23, h + 1)).padStart(2, '0') + String(m).padStart(2, '0');
    linhas.push('DTSTART:' + dia + 'T' + t.hora.replace(':', '') + '00', 'DTEND:' + dia + 'T' + fim + '00');
  } else {
    linhas.push('DTSTART;VALUE=DATE:' + dia, 'DTEND;VALUE=DATE:' + addDays(t.prazo || isoToday(), 1).replace(/-/g, ''));
  }
  linhas.push('SUMMARY:' + esc(t.texto), 'DESCRIPTION:' + esc([t.detalhe, t.clienteNome && 'Cliente: ' + t.clienteNome].filter(Boolean).join('\n')),
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(t.texto), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return linhas.join('\r\n');
}
function opSemeiaInteresse() {
  const hoje = isoToday(), ids = ['vaticano-3h', 'roma-antiga-3h', 'transfer-aeroporto', 'bv-pompeia', 'barroca-3h', 'noturno-3h', 'bv-amalfi', 'papal-convites'];
  const peso = [3, 3, 4, 2, 2, 1, 2, 1];
  DB.interesse = DB.interesse || {};
  ids.forEach((id, k) => {
    if (!Tours.get(id)) return;
    const i = DB.interesse[id] = { visitas: {}, quase: {} };
    for (let d = 0; d < 60; d++) { const dia = addDays(hoje, -d), v = Math.max(0, Math.round(peso[k] * (0.6 + ((d * 7 + k * 3) % 10) / 12))); if (v) { i.visitas[dia] = v; if ((d + k) % 3 === 0) i.quase[dia] = 1; } }
  });
}
function opSemeiaPontos() {
  const P = (nome, endereco, instrucoes) => Pontos.salva({ nome, endereco, instrucoes });
  const vat = P('Museus do Vaticano — entrada', 'Viale Vaticano, 100, Roma', 'Em frente à entrada dos Museus. A guia estará com uma plaquinha EmRoma. Chegue 15 minutos antes.');
  const col = P('Coliseu — saída do metrô Colosseo', 'Piazza del Colosseo, Roma', 'Na saída do metrô (linha B), do lado do Coliseu. A guia estará com a plaquinha EmRoma.');
  const nav = P('Piazza Navona — Fontana dei Quattro Fiumi', 'Piazza Navona, Roma', 'Na fonte do centro da praça.');
  const pie = P('Praça de São Pedro — obelisco', 'Piazza San Pietro, Città del Vaticano', 'Ao lado do obelisco no centro da praça.');
  const hot = P('No seu hotel', '', 'O motorista busca na recepção do hotel no horário combinado.');
  const fco = P('Aeroporto de Fiumicino — Terminal 3, desembarque', 'Aeroporto di Roma-Fiumicino, Terminal 3', 'Depois de pegar as malas, na saída do desembarque: o motorista espera com uma plaquinha com o seu nome.');
  const liga = (id, pts, pad) => { const x = Tours.get(id); if (x) { x.pontos = pts.map(p => p.id); x.pontoPadrao = pad.id; } };
  liga('vaticano-3h', [vat, pie], vat); liga('vaticano-4h', [vat, pie], vat); liga('basilicas-3h', [pie, vat], pie);
  liga('roma-antiga-3h', [col], col); liga('roma-antiga-4h', [col], col); liga('barroca-3h', [nav], nav); liga('noturno-3h', [nav, col], nav);
  liga('transfer-aeroporto', [fco, hot], fco);
  for (const id of ['bv-pompeia', 'bv-amalfi', 'bv-tivoli', 'bv-assis', 'bv-castelli', 'bv-toscana-sul']) liga(id, [hot], hot);
}
function opSemeiaParceiros() {
  const lu = Parceiros.salva({ nome: 'Lu Viaja (RPV)', tipo: 'agencia', contato: '@luviaja', cupom: 'LURPV', desconto: 0, comissao: 10, obs: 'Agência parceira de Recife' });
  const inf = Parceiros.salva({ nome: 'Carol pelo Mundo', tipo: 'influencer', contato: '@carolpelomundo', cupom: 'CAROL10', desconto: 10, comissao: 8 });
  /* duas reservas de exemplo vindas deles, e uma indicacao entre clientes */
  const bs = DB.bookings.filter(b => b.status !== 'cancelled');
  const a1 = bs.find(b => b.name === 'Grupo Viagens Sol (agência)'); if (a1 && !lu.erro) { a1.parceiroId = lu.id; const c = Cadastro.get(a1.clienteId); if (c) { c.veioPor = 'agencia'; c.parceiroId = lu.id; } }
  const a2 = bs.find(b => b.name === 'Camila Teixeira'); if (a2 && !inf.erro) { a2.coupon = 'CAROL10'; const c = Cadastro.get(a2.clienteId); if (c) { c.veioPor = 'influencer'; c.parceiroId = inf.id; } }
  const pat = Cadastro.acha({ nome: 'Patrícia Menezes' }), rob = Cadastro.acha({ nome: 'Roberto Farias' }), jul = Cadastro.acha({ nome: 'Juliana Andrade' });
  if (pat && rob) { rob.veioPor = 'indicacao'; rob.indicadoPor = pat.id; rob.indicadoNome = pat.nome; }
  if (pat && jul) { jul.veioPor = 'indicacao'; jul.indicadoPor = pat.id; jul.indicadoNome = pat.nome; }
  if (pat) { pat.nasc = pat.nasc || addDays(isoToday(), 5).slice(5).split('-').reverse().join('/') + '/1984'; pat.pais = 'Brasil (São Paulo)'; }
}
function opSemeiaTarefas() {
  const hoje = isoToday();
  const jul = DB.bookings.find(b => b.name === 'Juliana Andrade');
  const cam = DB.bookings.find(b => b.name === 'Camila Teixeira');
  const ag = DB.bookings.find(b => /Viagens Sol/.test(b.name));
  const cria = (d) => Tarefas.cria(d);
  cria({ texto: 'Confirmar com o Luca o transfer da Juliana (voo AZ 673)', prazo: hoje, hora: '10:00', clienteKey: jul ? chaveCliente(jul) : '', clienteNome: 'Juliana Andrade', bookingId: jul ? jul.id : '', pessoaId: 'op-m1' });
  cria({ texto: 'Comprar os ingressos do Coliseu com arena para a Camila (4 pessoas)', prazo: hoje, clienteKey: cam ? chaveCliente(cam) : '', clienteNome: 'Camila Teixeira', bookingId: cam ? cam.id : '' });
  cria({ texto: 'Responder a Patrícia sobre o Natal em Roma', prazo: addDays(hoje, -1), clienteNome: 'Patrícia Menezes', clienteKey: 'patricia.menezes@email.com' });
  cria({ texto: 'Pagar a guia do bate e volta de Pompeia (agência Viagens Sol)', prazo: addDays(hoje, 4), hora: '18:00', clienteNome: ag ? ag.name : '', clienteKey: ag ? chaveCliente(ag) : '', bookingId: ag ? ag.id : '' });
  cria({ texto: 'Montar a tabela de preços de Florença com a Sofia', detalhe: 'Mesmo formato da de Roma: 1 a 20 pessoas.' });
  const p01 = lerPrazo('todo dia 01', hoje);
  cria({ texto: 'Mandar o extrato do Nubank para a Aurea (contadora)', prazo: p01.data, repete: 'mensal', etapa: '' });
  const feita = cria({ texto: 'Renovar o seguro do carro do Paolo', prazo: addDays(hoje, -2) }); if (feita) Tarefas.marca(feita.id, true);
  cria({ tipo: 'nota', texto: 'O Luca prefere receber a lista de transfers até as 18h do dia anterior.', fixa: true });
  cria({ tipo: 'nota', texto: 'Ideia: pacote "Roma em 3 dias" para famílias com criança — Coliseu, Vaticano curto e gelato tour.' });
  const o = (DB.orcamentos || []).find(x => x.origem === 'whats');
  if (o) cria({ tipo: 'nota', origem: 'whats', texto: `Resumo do WhatsApp — ${o.cliente.nome}`, detalhe: o.resumo, orcId: o.id, clienteNome: o.cliente.nome, whats: o.cliente.whats });
}

/* ---------- BACKUP ----------
   Um arquivo so, com TUDO o que ela tem (e o que o assistente aprendeu).
   Serve para guardar (pasta do computador, que pode ser a do Google Drive)
   e para VOLTAR: backup que nao restaura nao e backup. */
const BKP_VERSAO = 'emroma-backup-2';
const BKP_KEY = 'ingrid_bkp_v1';
function pacoteBackup() {
  let memoria = [];
  try { if (typeof Mkt !== 'undefined') memoria = Mkt.get().memoria || []; } catch (e) {}
  return {
    app: 'EmRoma', versao: BKP_VERSAO, salvoEm: new Date().toISOString(),
    passeios: DB.tours, regras: DB.rules, datas: DB.departures, bloqueios: DB.blocks, cupons: DB.coupons,
    configuracoes: DB.settings, reservas: DB.bookings, vagasVendidas: DB.seatCounts || [],
    pedidos: DB.pedidos || [], equipe: DB.equipe || [], disponibilidade: DB.disp || [],
    contas: DB.contas || [], orcamentos: DB.orcamentos || [], fichas: DB.fichas || {},
    tarefas: DB.tarefas || [], lembretesVistos: DB.lembretesVistos || {}, memoriaAssistente: memoria,
    clientes: DB.clientes || [], parceiros: DB.parceiros || [], pontos: DB.pontos || [], interesse: DB.interesse || {},
    /* a Tabela de preços editada (com os custos dela) e as Conversas também voltam no backup */
    precos: DB.precos || [], conversas: DB.conversas || {},
    /* a ficha dos arquivos (comprovantes, documentos — o arquivo mesmo fica no Drive) */
    arquivos: DB.arquivos || [],
    /* o diário do assistente (o que foi feito e decidido, dia a dia) */
    iaDiario: DB.iaDiario || [],
  };
}
function resumoBackup(p) {
  const n = (a) => Array.isArray(a) ? a.length : 0;
  return { salvoEm: p.salvoEm || '', reservas: n(p.reservas), passeios: n(p.passeios), guias: n(p.equipe),
           orcamentos: n(p.orcamentos), tarefas: n(p.tarefas), clientes: new Set((p.reservas || []).map(chaveCliente)).size };
}
/* aceita o arquivo antigo (vi-backup-1, so reservas e passeios) e o novo */
function lerBackup(txt) {
  let p; try { p = typeof txt === 'string' ? JSON.parse(txt.replace(/^﻿/, '')) : txt; } catch (e) { return { erro: 'o arquivo não é um backup do app (não abriu)' }; }
  if (!p || !/^(vi-backup|emroma-backup)/.test(String(p.versao || ''))) return { erro: 'este arquivo não é um backup do EmRoma' };
  if (!Array.isArray(p.reservas) || !Array.isArray(p.passeios)) return { erro: 'o backup está incompleto (faltam reservas ou passeios)' };
  return { p, resumo: resumoBackup(p) };
}
function restauraBackup(txt) {
  const r = lerBackup(txt); if (r.erro) return r;
  const p = r.p, novo = _blank();
  Object.assign(novo, {
    tours: p.passeios, rules: p.regras || [], departures: p.datas || [], blocks: p.bloqueios || [], coupons: p.cupons || [],
    bookings: p.reservas, seatCounts: p.vagasVendidas || [], pedidos: p.pedidos || [],
    equipe: p.equipe || [], disp: p.disponibilidade || [], contas: p.contas || [], orcamentos: p.orcamentos || [],
    fichas: p.fichas || {}, tarefas: p.tarefas || [], lembretesVistos: p.lembretesVistos || {},
    clientes: p.clientes || [], parceiros: p.parceiros || [], pontos: p.pontos || [], interesse: p.interesse || {},
    precos: Array.isArray(p.precos) ? p.precos : [], conversas: (p.conversas && typeof p.conversas === 'object') ? p.conversas : {},
    arquivos: Array.isArray(p.arquivos) ? p.arquivos : [],
    iaDiario: Array.isArray(p.iaDiario) ? p.iaDiario : [],
  });
  novo.cadastroFeito = Array.isArray(p.clientes) ? 1 : 0; novo.parceirosSeed = 1; novo.pontosSeed = 1;
  novo.settings = fillSettings(p.configuracoes || {});
  /* voltou dado de verdade: nao e mais demonstracao, e as sementes nao voltam */
  novo.demo = false; novo.opSeed = OP_SEED; novo.tarefasSeed = 1; novo.seedVer = typeof SEED_VER !== 'undefined' ? SEED_VER : 1;
  DB = novo;
  try { if (typeof Mkt !== 'undefined' && Array.isArray(p.memoriaAssistente)) { const m = Mkt.get(); m.memoria = p.memoriaAssistente; Mkt.salva(); } } catch (e) {}
  opGarante();
  if (typeof save === 'function') save();
  return { ok: true, resumo: r.resumo };
}
const Backup = {
  ultimo() { try { return JSON.parse(localStorage.getItem(BKP_KEY)) || {}; } catch (e) { return {}; } },
  marca(onde, arquivo) {
    const u = { em: new Date().toISOString(), onde, arquivo: arquivo || '' };
    try { localStorage.setItem(BKP_KEY, JSON.stringify(u)); localStorage.setItem('vi_bkp_em', String(Date.now())); } catch (e) {}
    return u;
  },
  feitoHoje(hoje) { const u = Backup.ultimo(); return !!u.em && u.em.slice(0, 10) === (hoje || isoToday()); },
  nome(dia) { return `EmRoma-backup-${dia || isoToday()}.json`; },
};

/* ---------- CADASTRO DE CLIENTES ----------
   A planilha dela tem "veio por" em toda linha: e assim que ela sabe de onde
   o cliente chega (Instagram, status do WhatsApp, indicacao de alguem,
   influencer, agencia). Aqui cada pessoa e UM cadastro guardado — quem
   reservou e cada um que veio junto — e ele nasce sozinho na hora da
   reserva. Ninguem precisa digitar de novo.
     DB.clientes [{id, nome, whats, email, insta, nasc, pais, idioma, veioPor,
                   indicadoPor (id), indicadoNome, parceiroId, grupoDe (id),
                   obs, criado, atualizado}] */
/* o nome curto, para a coluna "veio por" da planilha */
/* "VEIO POR" do jeito dela (Doc 07/10 parte 2, item 7): agência, indicação de guia, influencer,
   indicação de um cliente, Instagram, YouTube, outro — e o "por quem" (nome / agência / de onde veio)
   fica no campo ao lado. As opções antigas continuam lidas nos registros que já existem. */
const VEIO_CURTO = { agencia: 'Agência', guia: 'Indicação de guia', influencer: 'Influencer', indicacao: 'Indicação de cliente', instagram: 'Instagram', youtube: 'YouTube', outro: 'Outro', junto: 'Veio junto',
  status: 'Status WhatsApp', google: 'Google / site', voltou: 'Já era cliente' };
const VEIO_POR = [
  ['agencia', 'Agência'], ['guia', 'Indicação de guia'], ['influencer', 'Influencer'], ['indicacao', 'Indicação de um cliente'],
  ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['outro', 'Outro'], ['junto', 'Veio junto com alguém'],
];
const VEIO_ANTIGO = { status: 'Status do WhatsApp', google: 'Google / site', voltou: 'Já era cliente' };
const veioPorNome = (v) => (VEIO_POR.find(x => x[0] === v) || [0, VEIO_ANTIGO[v] || v || '—'])[1];
/* as origens antigas das reservas viram o "veio por" */
const ORIGEM_PARA_VEIO = { instagram: 'instagram', friend: 'indicacao', whatsapp: 'status', agency: 'agencia', site: 'google' };
const _nomeN = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const _dig8 = (v) => String(v || '').replace(/\D/g, '').slice(-8);
/* o numero do cadastro sai do CONTATO da pessoa: o mesmo cliente criado no
   celular e no computador ao mesmo tempo vira a MESMA linha no banco */
function _hashId(s) { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); }
function idDoCliente(d) { const w = _dig8(d.whats), em = String(d.email || '').trim().toLowerCase(); return 'c' + _hashId(w.length >= 8 ? 'w:' + w : em ? 'e:' + em : 'n:' + _nomeN(d.nome) + (d.grupoDe ? '|' + d.grupoDe : '')); }
const Cadastro = {
  all() { return DB.clientes || []; },
  get(id) { return (DB.clientes || []).find(c => c.id === id) || null; },
  /* o mesmo cliente: WhatsApp (os 8 ultimos digitos), e-mail, ou o nome igual
     quando nenhum dos dois tem contato que diga o contrario */
  acha(d) {
    const l = Cadastro.all(), w = _dig8(d.whats), em = String(d.email || '').trim().toLowerCase(), n = _nomeN(d.nome);
    if (w.length >= 8) { const c = l.find(x => _dig8(x.whats) === w); if (c) return c; }
    if (em) { const c = l.find(x => String(x.email || '').toLowerCase() === em); if (c) return c; }
    if (n) return l.find(x => _nomeN(x.nome) === n && (!w || !_dig8(x.whats)) && (!em || !x.email)) || null;
    return null;
  },
  /* cria ou completa. Nunca apaga um dado que ja existe com um vazio. */
  garante(d) {
    DB.clientes = DB.clientes || [];
    const campos = ['nome', 'whats', 'email', 'insta', 'nasc', 'pais', 'idioma', 'veioPor', 'indicadoPor', 'indicadoNome', 'parceiroId', 'grupoDe', 'obs'];
    let c = Cadastro.acha(d);
    if (!c) {
      if (!String(d.nome || '').trim()) return null;
      c = { id: Cadastro.get(idDoCliente(d)) ? uid() : idDoCliente(d), criado: d.criado || new Date().toISOString() };
      for (const k of campos) c[k] = String(d[k] || '').trim();
      DB.clientes.push(c);
    } else {
      for (const k of campos) if (!String(c[k] || '').trim() && String(d[k] || '').trim()) c[k] = String(d[k]).trim();
      if (d.criado && (!c.criado || d.criado < c.criado)) c.criado = d.criado;
    }
    c.atualizado = new Date().toISOString();
    return c;
  },
  salva(id, d) {
    const c = Cadastro.get(id); if (!c) return null;
    for (const k of Object.keys(d)) c[k] = typeof d[k] === 'string' ? d[k].trim() : d[k];
    if (c.indicadoPor && !c.indicadoNome) c.indicadoNome = (Cadastro.get(c.indicadoPor) || {}).nome || '';
    c.atualizado = new Date().toISOString(); _opSave(); return c;
  },
  novo(d) { const c = Cadastro.garante(d); _opSave(); return c; },
  remove(id) { DB.clientes = Cadastro.all().filter(c => c.id !== id); _opSave(); },
  /* as reservas desta pessoa: as que ela fez e as em que veio junto */
  reservas(c) {
    return DB.bookings.filter(b => b.clienteId === c.id || (b.group || []).some(g => g.clienteId === c.id))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  },
  indicou(c) { return Cadastro.all().filter(x => x.indicadoPor === c.id); },
  trouxe(c) { return Cadastro.all().filter(x => x.grupoDe === c.id); },
  /* resumo para o dashboard e a ficha */
  resumo(c, hoje) {
    hoje = hoje || isoToday();
    const bs = Cadastro.reservas(c).filter(b => b.status !== 'cancelled');
    const dele = bs.filter(b => b.clienteId === c.id);
    const prox = bs.filter(b => b.date >= hoje).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null;
    return { reservas: bs.length, gasto: dele.reduce((s, b) => s + Bookings.paid(b), 0), deve: Math.round(dele.reduce((s, b) => s + Op.dueIngrid(b), 0) * 100) / 100,
             ultima: bs.map(b => b.date).filter(d => d < hoje).sort().pop() || '', prox, indicou: Cadastro.indicou(c).length, trouxe: Cadastro.trouxe(c).length };
  },
};
/* NA HORA DA RESERVA: quem reservou e cada um do grupo viram cadastro, e a
   reserva guarda o id de cada um. Chamado pelo store.js (create/criarManual). */
function cadastroDaReserva(b) {
  if (!b || !b.name) return null;
  const parc = b.coupon ? (DB.parceiros || []).find(p => String(p.cupom || '').toUpperCase() === String(b.coupon).toUpperCase()) : null;
  let veio = b.veioPor || (parc ? (parc.tipo === 'agencia' ? 'agencia' : 'influencer') : ORIGEM_PARA_VEIO[b.origin] || '');
  let ind = null;
  if (b.indicadoPor) {
    ind = Cadastro.acha({ nome: b.indicadoPor, whats: b.indicadoPor }) || null;
    if (!veio) veio = 'indicacao';
  }
  const ja = Cadastro.acha({ nome: b.name, whats: b.whats, email: b.email });
  const c = Cadastro.garante({ nome: b.name, whats: b.whats, email: b.email, insta: b.insta, idioma: b.lang, nasc: b.nasc,
    veioPor: ja && Cadastro.reservas(ja).length ? '' : veio, indicadoPor: ind ? ind.id : '', indicadoNome: ind ? ind.nome : (b.indicadoPor || ''),
    parceiroId: parc ? parc.id : '', criado: String(b.createdAt || '').slice(0, 10) ? b.createdAt : '' });
  if (!c) return null;
  b.clienteId = c.id;
  for (const g of b.group || []) {
    if (!g || !String(g.nome || '').trim()) continue;
    const gc = Cadastro.garante({ nome: g.nome, whats: g.whats, nasc: g.nasc, veioPor: 'junto', grupoDe: c.id, criado: b.createdAt });
    if (gc) g.clienteId = gc.id;
  }
  return c;
}

/* reserva que chegou da nuvem (o cliente reservou pelo site) ainda nao tem
   cadastro neste aparelho: completa aqui, antes de desenhar o painel */
/* Doc 06/10 item 18: "@viajandocomgabi também tem 5% de desconto e é influencer" — entra uma vez
   nas parcerias (se ela ainda não cadastrou); o cupom ela põe depois, se quiser */
function parceriaGabi() {
  try {
    if (!DB.settings || DB.settings.parcGabi) return;
    /* só depois que os dados dela chegaram da nuvem (senão um aparelho novo criaria uma repetida) */
    if (typeof temNuvem === 'function' && temNuvem()) { let emDia = false; try { emDia = JSON.parse(localStorage.getItem('ingrid_emdia_v1')) === true; } catch (e) {} if (!emDia) return; }
    DB.parceiros = Array.isArray(DB.parceiros) ? DB.parceiros : [];
    if (!DB.parceiros.some(p => /viajandocomgabi/i.test([p.nome, p.contato, p.cupom].join(' ')))) DB.parceiros.push({ id: uid(), nome: '@viajandocomgabi', tipo: 'influencer', contato: 'Instagram @viajandocomgabi', cupom: '', desconto: 5, comissao: 0, obs: 'Doc 06/10: 5% de desconto, influencer', pagamentos: [] });
    DB.settings.parcGabi = true; _opSave();
  } catch (e) {}
}
/* LIMPAR OS TESTES (pedido da Ingrid, 06/10: "a gente tem que deixar ele so coisa
   real... eu vou selecionar qual tem que apagar"). Apagar um cliente leva junto
   TUDO dele: reservas, orcamentos, tarefas, arquivos, anotacoes e quem veio junto.
   A reserva na nuvem nao some (o banco nao deixa apagar): ela vira apagado:true +
   cancelada, e o app nunca mais a traz de volta. */
const Limpeza = {
  doCliente(c) {
    const junto = Cadastro.all().filter(x => x.grupoDe === c.id);
    const ids = new Set([c.id, ...junto.map(x => x.id)]);
    const reservas = DB.bookings.filter(b => ids.has(b.clienteId));
    const rIds = new Set(reservas.map(b => b.id));
    const orcs = (DB.orcamentos || []).filter(o => ids.has(o.clienteId));
    const oIds = new Set(orcs.map(o => o.id)), nome = _nomeN(c.nome);
    const tarefas = (DB.tarefas || []).filter(t => oIds.has(t.orcId) || rIds.has(t.bookingId) || (nome && _nomeN(t.clienteNome || t.cliente || '') === nome));
    const arquivos = (DB.arquivos || []).filter(a => ids.has(a.clienteId) || rIds.has(a.bookingId));
    return { cliente: c, junto, reservas, orcs, tarefas, arquivos };
  },
  /* o que vai sumir, para o cartao de confirmacao */
  resumo(clienteIds) {
    const t = { clientes: 0, reservas: 0, orcamentos: 0, tarefas: 0, arquivos: 0, pagos: 0 };
    for (const id of clienteIds) { const c = Cadastro.get(id); if (!c) continue; const d = Limpeza.doCliente(c);
      t.clientes += 1 + d.junto.length; t.reservas += d.reservas.length; t.orcamentos += d.orcs.length; t.tarefas += d.tarefas.length; t.arquivos += d.arquivos.length;
      t.pagos += d.reservas.reduce((s, b) => s + (b.payments || []).reduce((x, p) => x + (+p.amount || 0), 0), 0); }
    return t;
  },
  /* LIXEIRA: tudo o que sai fica guardado aqui (30 dias) e volta com "desfazer" */
  lixeira() { try { return JSON.parse(localStorage.getItem('emroma_lixeira') || '[]'); } catch (e) { return []; } },
  _guardaLixo(l) { try { localStorage.setItem('emroma_lixeira', JSON.stringify(l)); } catch (e) {} },
  desfaz(loteId) {
    const l = Limpeza.lixeira(), lote = l.find(x => x.id === loteId); if (!lote) return null;
    const volta = (col, itens) => { DB[col] = DB[col] || []; const tem = new Set(DB[col].map(x => x.id)); for (const x of itens) if (!tem.has(x.id)) DB[col].push(x); };
    for (const b of lote.reservas) { b.apagado = false; b.status = b._statusAntes || 'confirmed'; delete b._statusAntes; if (typeof cloudUpdateBooking === 'function' && b.naNuvem) cloudUpdateBooking(b); }
    volta('bookings', lote.reservas); volta('orcamentos', lote.orcs); volta('tarefas', lote.tarefas); volta('arquivos', lote.arquivos); volta('clientes', lote.clientes);
    DB.fichas = DB.fichas || {}; Object.assign(DB.fichas, lote.fichas || {});
    Limpeza._guardaLixo(l.filter(x => x.id !== loteId)); _opSave();
    return lote;
  },
  apaga(clienteIds) {
    const t = Limpeza.resumo(clienteIds);
    const lote = { id: uid(), em: new Date().toISOString(), nomes: [], clientes: [], reservas: [], orcs: [], tarefas: [], arquivos: [], fichas: {} };
    for (const id of clienteIds) {
      const c = Cadastro.get(id); if (!c) continue; const d = Limpeza.doCliente(c);
      lote.nomes.push(c.nome); lote.clientes.push(c, ...d.junto); lote.orcs.push(...d.orcs); lote.tarefas.push(...d.tarefas); lote.arquivos.push(...d.arquivos);
      for (const b of d.reservas) b._statusAntes = b.status;
      lote.reservas.push(...d.reservas);
      for (const x of [c, ...d.junto]) { try { const k = chaveFicha(x); if (k && DB.fichas && DB.fichas[k]) lote.fichas[k] = DB.fichas[k]; } catch (e) {} }
      const chaves = [c, ...d.junto].map(x => { try { return chaveFicha(x); } catch (e) { return ''; } });
      for (const b of d.reservas) { b.apagado = true; b.status = 'cancelled'; if (typeof cloudUpdateBooking === 'function' && b.naNuvem) cloudUpdateBooking(b); }
      const rIds = new Set(d.reservas.map(b => b.id)), oIds = new Set(d.orcs.map(o => o.id)), tIds = new Set(d.tarefas.map(x => x.id)), aIds = new Set(d.arquivos.map(a => a.id));
      const cIds = new Set([c.id, ...d.junto.map(x => x.id)]);
      DB.bookings = DB.bookings.filter(b => !rIds.has(b.id));
      DB.orcamentos = (DB.orcamentos || []).filter(o => !oIds.has(o.id));
      DB.tarefas = (DB.tarefas || []).filter(x => !tIds.has(x.id));
      DB.arquivos = (DB.arquivos || []).filter(a => !aIds.has(a.id));
      DB.clientes = Cadastro.all().filter(x => !cIds.has(x.id));
      if (DB.fichas) for (const k of chaves) if (k && DB.fichas[k]) delete DB.fichas[k];
      for (const b of DB.bookings) if (Array.isArray(b.group)) for (const g of b.group) if (cIds.has(g.clienteId)) g.clienteId = '';
    }
    const corte = new Date(Date.now() - 30 * 864e5).toISOString();
    Limpeza._guardaLixo([JSON.parse(JSON.stringify(lote)), ...Limpeza.lixeira().filter(x => x.em > corte)].slice(0, 20));
    _opSave();
    return { ...t, lote: lote.id };
  },
};
/* a chave das anotacoes (Fichas) de um cadastro */
function chaveFicha(c) { const b = DB.bookings.find(x => x.clienteId === c.id); return b ? chaveCliente(b) : String(c.email || c.whats || c.nome || '').toLowerCase(); }
function cadastroEmDia() {
  let n = 0;
  for (const b of DB.bookings || []) if (!b.clienteId && b.name) { cadastroDaReserva(b); n++; }
  if (n) _opSave();
  return n;
}

/* ---------- PARCERIAS E CUPONS DE INFLUENCER ----------
   Influencer, agencia ou parceiro com cupom proprio. O app conta quantas
   reservas vieram por ele, quanto faturou e a comissao que ela deve.
     DB.parceiros [{id, nome, tipo, contato, cupom, desconto, comissao, obs, pagamentos:[{valor, data}]}] */
const TIPOS_PARCEIRO = [['influencer', 'Influencer'], ['agencia', 'Agência'], ['parceiro', 'Parceiro (hotel, loja…)']];
const Parceiros = {
  all() { return DB.parceiros || []; },
  get(id) { return (DB.parceiros || []).find(p => p.id === id) || null; },
  salva(d) {
    DB.parceiros = DB.parceiros || [];
    const nome = String(d.nome || '').trim(); if (!nome) return { erro: 'falta o nome' };
    const cupom = String(d.cupom || '').toUpperCase().replace(/\s+/g, '');
    let p = d.id && Parceiros.get(d.id);
    if (cupom && Parceiros.all().some(x => x.cupom === cupom && x !== p)) return { erro: 'já existe um parceiro com esse cupom' };
    const dados = { nome, tipo: TIPOS_PARCEIRO.some(t => t[0] === d.tipo) ? d.tipo : 'influencer', contato: String(d.contato || '').trim(),
      cupom, desconto: Math.max(0, Math.min(100, +d.desconto || 0)), comissao: Math.max(0, Math.min(100, +d.comissao || 0)), obs: String(d.obs || '').trim() };
    if (p) {
      const antigo = p.cupom;
      Object.assign(p, dados);
      if (antigo && antigo !== cupom) DB.coupons = DB.coupons.filter(c => c.code !== antigo);
    } else { p = { id: uid(), criado: isoToday(), pagamentos: [], ...dados }; DB.parceiros.push(p); }
    /* o cupom de verdade, o que o cliente digita na reserva */
    if (cupom) {
      let c = DB.coupons.find(x => x.code === cupom);
      if (!c) { c = { code: cupom, pct: dados.desconto, until: '2099-12-31', oncePerPerson: false, uses: [] }; DB.coupons.push(c); }
      c.pct = dados.desconto; c.parceiroId = p.id;
    }
    _opSave(); return p;
  },
  remove(id) { const p = Parceiros.get(id); if (!p) return; DB.parceiros = Parceiros.all().filter(x => x.id !== id); if (p.cupom) DB.coupons = DB.coupons.filter(c => c.code !== p.cupom); _opSave(); },
  reservas(p) {
    return DB.bookings.filter(b => b.status !== 'cancelled' && ((p.cupom && String(b.coupon || '').toUpperCase() === p.cupom) || b.parceiroId === p.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  /* comissao sobre o valor dos servicos (total), nao sobre o que ja entrou */
  conta(p) {
    const bs = Parceiros.reservas(p);
    const faturado = bs.reduce((s, b) => s + (+b.total || 0), 0);
    const devida = Math.round(faturado * (+p.comissao || 0)) / 100;
    const paga = (p.pagamentos || []).reduce((s, x) => s + (+x.valor || 0), 0);
    const clientes = new Set(bs.map(b => b.clienteId || chaveCliente(b))).size;
    return { reservas: bs.length, clientes, faturado, devida, paga, saldo: Math.round((devida - paga) * 100) / 100 };
  },
  /* TABELA DE COMISSÕES (contrato de 30/09): uma linha por reserva trazida e o total de cada parceiro.
     Separador ; (abre certo no Excel em português) */
  csv() {
    const L = [['Parceiro', 'Tipo', 'Cupom', 'Comissão %', 'Data do serviço', 'Cliente', 'Serviço', 'Valor', 'Comissão', 'Pago ao parceiro', 'Saldo']];
    const n = (v) => String(Math.round((+v || 0) * 100) / 100).replace('.', ',');
    for (const p of Parceiros.all()) {
      const c = Parceiros.conta(p), bs = Parceiros.reservas(p).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const b of bs) L.push([p.nome, p.tipo || '', p.cupom || '', n(p.comissao), b.date || '', b.name || '', nomeDoServico(b), n(b.total), n((+b.total || 0) * (+p.comissao || 0) / 100), '', '']);
      L.push([p.nome + ' — TOTAL', '', '', n(p.comissao), '', '', `${c.reservas} reserva(s)`, n(c.faturado), n(c.devida), n(c.paga), n(c.saldo)]);
    }
    return L;
  },
  paga(id, valor, data) { const p = Parceiros.get(id); if (!p || !(+valor > 0)) return null; p.pagamentos = p.pagamentos || []; p.pagamentos.push({ valor: +valor, data: data || isoToday() }); _opSave(); return p; },
};

/* ---------- idade, servico escrito, comprovante, interesse ---------- */
/* "12/03/1985" ou "1985-03-12" -> anos completos hoje */
function idadeDe(nasc, hoje) {
  const s = String(nasc || '').trim(); let d, m, y;
  let x = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (x) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; } else return null;
  const h = new Date((hoje || isoToday()) + 'T12:00:00');
  let a = h.getFullYear() - y; if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) a--;
  return a >= 0 && a < 120 ? a : null;
}
function aniversarioNoMes(nasc, mes) { const s = String(nasc || ''); const x = s.match(/^(\d{1,2})\/(\d{1,2})\//) || s.match(/^\d{4}-(\d{2})-(\d{2})$/); if (!x) return null; return s.includes('/') ? (+x[2] === mes ? +x[1] : null) : (+x[1] === mes ? +x[2] : null); }
/* quem vai no servico: o comprador (se vai) e o grupo */
function participantesDe(b) {
  const l = [];
  if (b.compradorVai !== false) l.push({ nome: b.name, nasc: b.nasc || '', clienteId: b.clienteId || '', comprador: true });
  for (const g of b.group || []) if (g && g.nome) l.push({ nome: g.nome, nasc: g.nasc || '', clienteId: g.clienteId || '' });
  return l;
}
/* a planilha dela descreve o servico com as proprias palavras ("MXP TP 824 x
   Ibis Styles Milano Centro"); quando existe, e isso que aparece */
function nomeDoServico(b) { if (b.servicoTxt) return b.servicoTxt; const x = typeof Tours !== 'undefined' && Tours.get(b.tourId); return x ? (x.name.pt || '') : '?'; }
/* o comprovante do pagamento: o link do arquivo (Drive, foto) */
function comprovante(bookingId, idx, url) {
  const b = Bookings.get(bookingId); if (!b || !b.payments[idx]) return null;
  const u = String(url || '').trim(); if (u && !/^https?:\/\//i.test(u)) return { erro: 'o link precisa começar com http' };
  b.payments[idx].comprovante = u; _opSaveBooking(b); return b.payments[idx];
}
/* quantas vezes abriram cada passeio e quantas chegaram a preencher os dados.
   So conta no aparelho de quem visita; com o banco ligado, vai para a nuvem. */
const Interesse = {
  conta(tourId, tipo) {
    if (!tourId || (tipo !== 'visitas' && tipo !== 'quase')) return;
    DB.interesse = DB.interesse || {};
    const i = DB.interesse[tourId] = DB.interesse[tourId] || {}, c = i[tipo] = i[tipo] || {}, h = isoToday();
    c[h] = (+c[h] || 0) + 1;
    const dias = Object.keys(c).sort(); if (dias.length > 180) for (const d of dias.slice(0, dias.length - 180)) delete c[d];
    _opSave();
  },
  soma(tourId, tipo, de, ate) { const c = ((DB.interesse || {})[tourId] || {})[tipo] || {}; return Object.entries(c).reduce((n, [d, v]) => n + (d >= de && d <= ate ? (+v || 0) : 0), 0); },
  /* por passeio: visitas, quase reservaram, reservas feitas no periodo, conversao.
     Conversao = reservas (por qualquer caminho) / aberturas: quase todo mundo ve
     o passeio no app e fecha pelo WhatsApp, entao so "pelo site" enganaria. */
  funil(de, ate) {
    return Tours.all().map(x => {
      const bs = DB.bookings.filter(b => b.tourId === x.id && b.status !== 'cancelled' && String(b.createdAt || '').slice(0, 10) >= de && String(b.createdAt || '').slice(0, 10) <= ate);
      const visitas = Interesse.soma(x.id, 'visitas', de, ate), quase = Interesse.soma(x.id, 'quase', de, ate);
      const pelo = bs.filter(b => b.origin === 'site').length;
      return { tourId: x.id, nome: x.name.pt, visitas, quase, reservas: bs.length, peloSite: pelo, valor: bs.reduce((s, b) => s + (+b.total || 0), 0),
               conv: visitas ? bs.length / visitas : null };
    }).filter(r => r.visitas || r.reservas).sort((a, b) => b.visitas - a.visitas || b.reservas - a.reservas);
  },
};

/* ---------- IMPORTAR A PLANILHA DELA (o CRM) ----------
   Ela baixa a planilha como CSV (Arquivo > Fazer download > .csv) e o app le
   as colunas pelo NOME do cabecalho, em qualquer ordem: Data, veio por,
   Whatsapp, Nome, Data Servico, Hora, PAX, Servico pedido, Obs, Cliente Paga,
   Ingrid Paga, Cidade. Cada linha vira uma reserva, cada nome um cadastro. */
function lerCsv(txt) {
  const linhas = []; let campo = '', linha = [], aspas = false;
  const t = String(txt || '').replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch; continue; }
    if (ch === '"') aspas = true; else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(c => String(c).trim()));
}
function _dataPlanilha(v) {
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return '';
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
function _valorPlanilha(v) {
  let s = String(v || '').replace(/[€$R\s]/g, ''); if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  return +s || 0;
}
const COLS_CRM = {
  data: /^data( do)? ?or[cç]amento$|^data$/, veio: /^veio/, indicou: /^agencia|^quem indicou|^quem\??$|influenc/, whats: /whats|telefone|fone/, nome: /^nome( do cliente| completo)?$/, dataServ: /data ?servi/,
  hora: /^hora/, pax: /^pax|pessoas/, servico: /servi[cç]o/, obs: /^obs/, clientePaga: /cliente ?paga/, ingridPaga: /ingrid ?paga|custo/, cidade: /cidade|hotel/,
  parceiro: /^parceiro/, total: /^total/, sinal: /^sinal/, forma: /forma/, emReal: /em real/, comVendor: /comiss.*vend/, comIndic: /comiss.*indic/,
  status: /^status/, motivo: /motivo/, rep1: /^(repescagem|follow[ -]?up) ?1/, res1: /^resultado ?1/, rep2: /^(repescagem|follow[ -]?up) ?2/, res2: /^resultado ?2/, rep3: /^(repescagem|follow[ -]?up) ?3/, res3: /^resultado ?3/,
  arquivo: /nome do arquivo/, lPdf: /link ?pdf/, lOrc: /link ?or/, lVoucher: /link ?voucher/, lComprov: /link ?comprov/, lAval: /link ?avalia/,
};
/* o Status da planilha decide o que a linha vira:
   Enviado (ou vazio)            -> orcamento em aberto (CRM)
   CONFIRMADO / AVALIAR / FINAL. -> reserva (com o sinal na conta certa)
   Perdido                       -> orcamento perdido, com o motivo
   Planilha SEM coluna Status (a lista antiga) -> tudo reserva. */
function _etapaPlanilha(v, temStatus) {
  const t = String(v || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  if (!temStatus) return 'confirmado';
  if (/confirm/.test(t)) return 'confirmado';
  if (/avali/.test(t)) return 'avaliar';
  if (/finaliz/.test(t)) return 'finalizado';
  if (/perd|cancel/.test(t)) return 'perdido';
  return 'aberto';
}
function _contaDaForma(v) {
  const t = String(v || '').toLowerCase();
  if (/pix|nubank/.test(t)) return 'nubank';
  if (/wise/.test(t)) return /br|real|brasil/.test(t) ? 'wise-br' : 'wise-eu';
  if (/revolut/.test(t)) return 'revolut';
  if (/cart|card|link|credito|crédito/.test(t)) return 'cartao';
  if (/dinheiro|cash|esp[eé]cie/.test(t)) return 'dinheiro';
  return t ? 'nubank' : '';
}
const LINKS_PLANILHA = [['lPdf', 'PDF'], ['lOrc', 'Orçamento'], ['lVoucher', 'Voucher'], ['lComprov', 'Comprovante'], ['lAval', 'Avaliação']];
/* os dois servicos "avulsos": o que ela escreve a mao (planilha) nao cabe no catalogo */
const RE_TRANSFER = /\b(FCO|CIA|MXP|LIN|BGY|VCE|NAP|FLR|PSA)\b|transfer|aeroporto|porto|esta[cç][aã]o| x /i;
function tourAvulso(tipo) {
  const id = tipo === 'transfer' ? 'avulso-transfer' : 'avulso-servico';
  if (!Tours.get(id)) DB.tours.push({ id, type: tipo === 'transfer' ? 'transfer' : 'walk', region: tipo === 'transfer' ? 'transfer' : 'roma',
    name: { pt: tipo === 'transfer' ? 'Transfer (da planilha)' : 'Serviço (da planilha)', en: tipo === 'transfer' ? 'Transfer' : 'Service' },
    desc: { pt: '', en: '' }, meeting: '', price: 0, priceMode: 'session', min: 1, max: 60, payPolicy: 'sinal', status: 'draft', order: 999, photo: 'capa.jpg' });
  return id;
}
function importarPlanilha(txt, simular) {
  const L = lerCsv(txt);
  const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const hi = L.findIndex(l => l.some(c => /^nome$/.test(n(c))) && l.some(c => /servi/.test(n(c))));
  if (hi < 0) return { erro: 'não achei o cabeçalho (preciso das colunas Nome e Serviço pedido)' };
  const cab = L[hi].map(n), col = {};
  for (const [k, re] of Object.entries(COLS_CRM)) {
    const j = cab.findIndex((c, idx) => re.test(c) && !Object.values(col).includes(idx) && !(k === 'data' && /servi/.test(c)) && !(k === 'servico' && /data|arquivo/.test(c)));
    if (j >= 0) col[k] = j;
  }
  if (col.clientePaga === undefined && col.total !== undefined) { col.clientePaga = col.total; delete col.total; }
  if (col.nome === undefined || col.servico === undefined || col.dataServ === undefined) return { erro: 'faltam colunas: preciso de Nome, Data Serviço e Serviço pedido' };
  const temStatus = col.status !== undefined;
  const out = [], pulou = [];
  for (const l of L.slice(hi + 1)) {
    const get = (k) => col[k] === undefined ? '' : String(l[col[k]] || '').trim();
    let nome = get('nome'); const serv = get('servico').replace(/\s+/g, ' '), dataTxt = get('dataServ'), data = _dataPlanilha(dataTxt);
    if (nome === '-' || (!nome && !serv) || (!nome && !get('whats') && !get('arquivo'))) continue;
    if (!nome || nome === '?') nome = get('arquivo').replace(/^[\d_ ]+/, '').replace(/\?/g, '').trim() || (get('whats') ? 'Cliente ' + get('whats').replace(/\D/g, '').slice(-4) : 'Sem nome');
    const etapa = _etapaPlanilha(get('status'), temStatus);
    if (!data && etapa !== 'aberto' && etapa !== 'perdido') { pulou.push(nome); continue; }
    const ehTransfer = RE_TRANSFER.test(serv);
    const paxTxt = get('pax'), extra = (paxTxt.match(/\((.*)\)/s) || [])[1];
    const reps = [1, 2, 3].map(k => ({ n: k, data: _dataPlanilha(get('rep' + k)), resultado: get('res' + k) || (get('rep' + k) && !_dataPlanilha(get('rep' + k)) ? get('rep' + k) : '') }))
      .filter(x => x.data || x.resultado).map(x => ({ ...x, resultado: x.resultado || 'mandada' }));
    out.push({ nome, whats: get('whats'), veio: get('veio'), indicou: get('indicou'), criado: _dataPlanilha(get('data')), data, dataTxt: data ? '' : dataTxt,
      hora: (get('hora').match(/\d{1,2}:\d{2}/) || [''])[0], pax: parseInt(paxTxt, 10) || 1, paxObs: extra ? extra.replace(/\s+/g, ' ').trim() : '',
      servico: serv || '(sem serviço)', obs: get('obs'), total: _valorPlanilha(get('clientePaga')), custo: _valorPlanilha(get('ingridPaga')),
      cidade: get('cidade'), parceiro: get('parceiro'), totalPedido: _valorPlanilha(get('total')), sinal: _valorPlanilha(get('sinal')), forma: get('forma'),
      emReal: _valorPlanilha(get('emReal')), comVendor: _valorPlanilha(get('comVendor')), comIndic: _valorPlanilha(get('comIndic')),
      etapa, motivo: get('motivo'), repescagens: reps, arquivo: get('arquivo'),
      links: LINKS_PLANILHA.map(([k, nm]) => ({ nome: nm, url: get(k) })).filter(x => /^https?:\/\//i.test(x.url)), tipo: ehTransfer ? 'transfer' : 'servico' });
  }
  /* as linhas do mesmo pedido: o mesmo arquivo (ou o mesmo cliente no mesmo dia) e o mesmo PDF
     (cada pedido tem o seu PDF; sem PDF, o mesmo Total). As duas opcoes da Aline
     (3 pessoas e 5 pessoas) tem o mesmo arquivo e PDFs diferentes: dois pedidos. */
  const chave = (r) => { const pdf = (r.links || []).find(l => l.nome === 'PDF');
    return [_nomeN(r.arquivo) || (_dig8(r.whats) || _nomeN(r.nome)) + '|' + r.criado, pdf ? pdf.url : (r.totalPedido || '')].join('#'); };
  const pedidos = new Map();
  for (const r of out) { const k = chave(r); (pedidos.get(k) || pedidos.set(k, []).get(k)).push(r); }
  const orcs = [...pedidos.entries()].filter(([, rs]) => rs[0].etapa === 'aberto' || rs[0].etapa === 'perdido');
  const res = out.filter(r => r.etapa !== 'aberto' && r.etapa !== 'perdido');
  if (simular) return { linhas: out, pulou, clientes: new Set(out.map(r => _dig8(r.whats) || _nomeN(r.nome))).size, orcamentos: orcs.length, reservas: res.length };
  const garanteAvulso = tourAvulso;
  const VEIO = [[/status/i, 'status'], [/insta/i, 'instagram'], [/indic|amig|filh|m[aã]e|pai|irm/i, 'indicacao'], [/ag[eê]ncia|rpv|viage|turismo|tour/i, 'agencia'], [/google|site/i, 'google'], [/influ|cupom/i, 'influencer'], [/youtube|you tube/i, 'youtube'], [/\bguia\b/i, 'guia']];
  const veioDe = (r) => (VEIO.find(([re]) => re.test(r.veio)) || [0, r.veio ? 'agencia' : ''])[1];
  const quemDe = (r) => r.indicou || (['agencia', 'indicacao', 'influencer'].includes(veioDe(r)) && !/^status|insta|google|site/i.test(r.veio) ? r.veio : '');
  const obsDe = (r) => [r.obs, r.paxObs, r.dataTxt && 'data: ' + r.dataTxt].filter(Boolean).join(' · ');
  let criadas = 0, orcCriados = 0;
  /* orcamentos (Enviado / Perdido) */
  for (const [k, rs] of orcs) {
    const r0 = rs[0];
    if ((DB.orcamentos || []).some(o => o.chavePlanilha === k)) continue;
    const o = Orc.cria({ origem: 'planilha', status: r0.etapa === 'perdido' ? 'perdido' : 'enviado', cliente: { nome: r0.nome, whats: r0.whats }, sinalPct: 0,
      itens: rs.map((r, x) => ({ desc: r.servico, data: r.data, hora: r.hora, pax: r.pax, valor: r.total, custo: r.custo, obs: [obsDe(r), r.cidade].filter(Boolean).join(' · '), sinal: x === 0 ? r0.sinal : 0 })) });
    Object.assign(o, { chavePlanilha: k, veio: r0.veio, veioPor: veioDe(r0), indicou: quemDe(r0), arquivo: r0.arquivo, motivoPerda: r0.etapa === 'perdido' ? (r0.motivo || 'Outro') : '',
      repescagens: r0.repescagens, links: r0.links, parceiroTxt: r0.parceiro, comVendor: r0.comVendor, comIndic: r0.comIndic, validade: addDays(isoToday(), 7) });
    if (r0.criado) o.criado = r0.criado + 'T10:00:00.000Z';
    orcCriados++;
  }
  /* reservas (CONFIRMADO / AVALIAR / FINALIZADO): o Sinal e do pedido inteiro, entra uma vez */
  const restaSinal = new Map();
  for (const r of res) {
    const ja = DB.bookings.some(b => b.date === r.data && _nomeN(b.name) === _nomeN(r.nome) && (b.servicoTxt || '') === r.servico);
    if (ja) continue;
    const b = Bookings.criarManual({ tourId: garanteAvulso(r.tipo), date: r.data, time: r.hora || '09:00', name: r.nome, whats: r.whats, pax: r.pax, total: r.total, recebido: 0,
      veioPor: veioDe(r), indicadoPor: /indic|filh|m[aã]e|reservou/i.test(r.veio) ? r.veio : '' });
    b.servicoTxt = r.servico; b.obsOp = [obsDe(r), r.cidade].filter(Boolean).join(' · '); b.custo = r.custo; b.origin = 'planilha'; b.policy = 'sinal';
    Object.assign(b, { veioTxt: r.veio, indicou: quemDe(r), parceiroTxt: r.parceiro, comVendor: r.comVendor, comIndic: r.comIndic, arquivo: r.arquivo, links: r.links });
    if (r.criado) b.createdAt = r.criado + 'T10:00:00.000Z';
    if (r.etapa === 'finalizado') b.avaliacaoEm = r.data;
    const k = chave(r);
    if (!restaSinal.has(k)) restaSinal.set(k, r.sinal || 0);
    const v = Math.min(restaSinal.get(k), b.total || restaSinal.get(k));
    if (v > 0) {
      const p = registraPagamento(b.id, { valor: v, conta: _contaDaForma(r.forma), data: r.criado || isoToday() });
      if (p) { if (r.emReal && restaSinal.get(k) === r.sinal) { p.reais = r.emReal; _opSaveBooking(b); } restaSinal.set(k, restaSinal.get(k) - p.amount); }
    }
    if (r.veio && !b.indicadoPor) { const c = Cadastro.get(b.clienteId); if (c && !c.obs) c.obs = 'veio por: ' + r.veio; }
    criadas++;
  }
  _opSave();
  return { ok: true, criadas, orcamentos: orcCriados, repetidas: res.length - criadas, pulou };
}

/* ---------- TRANSFER — a plataforma da New Star Limousine (NCCGest) ----------
   Pedido de 29/09: os transfers de Roma ela pede na area de cliente da New
   Star (newstarlimousine.nccgest.com). Enquanto nao temos o contato tecnico
   deles para mandar sozinho, o app deixa o pedido pronto para colar (em
   italiano, como eles leem) e guarda o numero da reserva deles. */
const NCC_PADRAO = { nome: 'New Star Limousine', url: 'https://newstarlimousine.nccgest.com/clienti/index.php' };
function nccConfig() { return Object.assign({}, NCC_PADRAO, (DB.settings && DB.settings.ncc) || {}); }
function ehTransfer(b) { const x = Tours.get(b.tourId); return !!(x && (x.type === 'transfer' || x.region === 'transfer')) || RE_TRANSFER.test(nomeDoServico(b)); }
/* A New Star so faz transfer em ROMA (29/09). O que e de Milao, Veneza, Bari…
   fica numa lista a parte: outro fornecedor. Sem pista nenhuma = Roma (a base dela). */
const RE_ROMA = /\b(FCO|CIA)\b|fiumicino|ciampino|\broma\b|\brome\b|termini|civitavecchia|tiburtina|ostiense|vaticano|trastevere|colosseo|coliseu/i;
const RE_FORA_ROMA = /\b(MXP|LIN|BGY|VCE|TSF|NAP|FLR|PSA|BRI|BDS|BLQ|VRN)\b|mil[aã]o|milano|veneza|venezia|n[aá]poles|napoli|floren[cç]a|firenze|pisa|\bbari\b|brindisi|monopoli|\bcomo\b|bellagio|siena|amalfi|positano|sorrento|lecce|matera|pesaro|verona|bolonha|bologna|genova|g[eê]nova|turim|torino|palermo|catania/i;
function transferEmRoma(b) {
  const txt = [nomeDoServico(b), b.origem, b.destino, b.obsOp].filter(Boolean).join(' ');
  if (RE_ROMA.test(txt)) return true;
  return !RE_FORA_ROMA.test(txt);
}
/* onde: 'roma' (New Star), 'fora' (outro fornecedor) ou vazio (todos) */
function transfersDe(de, ate, onde) {
  return DB.bookings.filter(b => b.status !== 'cancelled' && b.date >= de && (!ate || b.date <= ate) && ehTransfer(b)
      && (!onde || (onde === 'roma') === transferEmRoma(b)))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function nccTexto(b) {
  const d = b.date ? b.date.slice(8, 10) + '/' + b.date.slice(5, 7) + '/' + b.date.slice(0, 4) : '';
  return [`Data: ${d}  ·  Ora: ${b.time || '?'}`, `Servizio: ${nomeDoServico(b)}`, `Cliente: ${b.name}${b.whats ? '  ·  Tel. ' + b.whats : ''}`,
    `Passeggeri: ${b.pax || 1}`, b.voo ? `Volo/treno: ${b.voo}` : '', b.origem ? `Da: ${b.origem}` : '', b.destino ? `A: ${b.destino}` : '',
    b.obsOp ? `Note: ${b.obsOp}` : '', `Rif. EmRoma: ${b.code || b.id}`].filter(Boolean).join('\n');
}
function nccMarca(id, codigo) {
  const b = Bookings.get(id); if (!b) return null;
  b.ncc = codigo === null ? null : { codigo: String(codigo || '').trim(), em: isoToday() };
  _opSaveBooking(b); return b;
}

/* ---------- AVALIACOES (o menu da frente) ----------
   So avaliacoes de verdade: ela cola as do Google / WhatsApp. Ficam em
   DB.settings.avaliacoes porque sao publicas (vao para o site). O link do
   Google e o mesmo que o CRM usa no "pedir avaliacao". */
const Avaliacoes = {
  all() { return [...((DB.settings && DB.settings.avaliacoes) || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))); },
  media() { const l = Avaliacoes.all().filter(a => +a.nota > 0); return l.length ? Math.round(l.reduce((s, a) => s + +a.nota, 0) / l.length * 10) / 10 : null; },
  salva(d) {
    const nome = String(d.nome || '').trim(), texto = String(d.texto || '').trim();
    if (!nome || !texto) return { erro: 'falta o nome ou o texto da avaliação' };
    const nota = Math.min(5, Math.max(1, parseInt(d.nota, 10) || 5));
    let data = d.data ? _dataDigitada(d.data) : isoToday(); if (data === null) return { erro: 'data em dd/mm/aaaa' };
    DB.settings.avaliacoes = DB.settings.avaliacoes || [];
    const a = { id: d.id || uid(), nome, cidade: String(d.cidade || '').trim(), passeio: String(d.passeio || '').trim(), nota, texto, data: data || isoToday(), fonte: String(d.fonte || '').trim() };
    const k = DB.settings.avaliacoes.findIndex(x => x.id === a.id);
    if (k >= 0) DB.settings.avaliacoes[k] = a; else DB.settings.avaliacoes.push(a);
    save(); return a;
  },
  remove(id) { DB.settings.avaliacoes = (DB.settings.avaliacoes || []).filter(a => a.id !== id); save(); },
};

/* ---------- PONTOS DE ENCONTRO ----------
   O modelo de voucher dela lista varios pontos; para cada cliente ela
   escolhia a mao o do passeio dele. Aqui: uma lista unica de pontos (feita
   uma vez), cada passeio diz quais valem e qual e o normal, e no voucher
   ela escolhe — sai so o ponto daquele cliente.
     DB.pontos [{id, nome, endereco, mapa, instrucoes}]
     Tour: pontos [ids], pontoPadrao; Booking: pontoId */
const Pontos = {
  all() { return DB.pontos || []; },
  get(id) { return (DB.pontos || []).find(p => p.id === id) || null; },
  salva(d) {
    DB.pontos = DB.pontos || [];
    const nome = String(d.nome || '').trim(); if (!nome) return { erro: 'falta o nome do ponto' };
    const dados = { nome, endereco: String(d.endereco || '').trim(), mapa: String(d.mapa || '').trim(), instrucoes: String(d.instrucoes || '').trim() };
    if (dados.mapa && !/^https?:\/\//i.test(dados.mapa)) return { erro: 'o link do mapa precisa começar com http' };
    let p = d.id && Pontos.get(d.id);
    if (p) Object.assign(p, dados); else { p = { id: uid(), ...dados }; DB.pontos.push(p); }
    _opSave(); return p;
  },
  remove(id) { DB.pontos = Pontos.all().filter(p => p.id !== id); for (const t of DB.tours) { if (Array.isArray(t.pontos)) t.pontos = t.pontos.filter(x => x !== id); if (t.pontoPadrao === id) t.pontoPadrao = ''; } _opSave(); },
  /* os que valem para o passeio (nenhum marcado = todos) */
  doPasseio(tourId) { const x = Tours.get(tourId); const ids = (x && x.pontos) || []; return ids.length ? ids.map(Pontos.get).filter(Boolean) : Pontos.all(); },
};
/* o ponto deste servico: o que ela escolheu, senao o normal do passeio */
function pontoDoServico(b) {
  const x = Tours.get(b.tourId);
  return Pontos.get(b.pontoId) || (x && Pontos.get(x.pontoPadrao)) || (x && (x.pontos || []).length ? Pontos.get(x.pontos[0]) : null);
}
function escolhePonto(bookingId, pontoId) { const b = Bookings.get(bookingId); if (!b) return; b.pontoId = pontoId || ''; _opSaveBooking(b); }
function linkMapa(p) { return p.mapa || (p.endereco ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.endereco) : ''); }

/* ---------- O CRM DELA ----------
   A planilha "CRM" e a mais importante da vida dela. Uma linha por servico,
   com as colunas dela e as etapas das abas: CRM (enviado) -> CONFIRMADO ->
   AVALIAR (o servico passou: pedir a avaliacao) -> FINALIZADO, ou PERDIDO
   com o motivo. Aqui as linhas saem do que o app ja sabe: orcamentos em
   aberto e reservas. */
const CRM_ETAPAS = [['aberto', 'CRM'], ['confirmado', 'Confirmado'], ['avaliar', '⭐ Avaliar'], ['finalizado', '💚 Finalizado'], ['perdido', 'Perdido']];
const MOTIVOS_PERDA = ['Preço', 'Data não serve', 'Fechou com outro', 'Não respondeu', 'Desistiu da viagem', 'Outro'];
function etapaDaReserva(b, hoje) {
  hoje = hoje || isoToday();
  if (b.status === 'cancelled') return 'perdido';
  if (b.date >= hoje) return 'confirmado';
  return b.avaliacaoEm ? 'finalizado' : 'avaliar';
}
function crmLinhas(hoje) {
  hoje = hoje || isoToday();
  const out = [];
  const contas = (b) => [...new Set((b.payments || []).map(p => p.conta ? Contas.nome(p.conta) : p.method).filter(Boolean))].join(', ');
  /* o "Total" e o "Sinal" da planilha sao do PEDIDO inteiro (a Jo: 2002) */
  const pedidoDe = (b) => b.orcamentoId || ((b.clienteId || chaveCliente(b)) + '|' + String(b.createdAt || '').slice(0, 10));
  const porPedido = {};
  for (const b of DB.bookings) { if (b.status === 'cancelled') continue; const k = pedidoDe(b); (porPedido[k] = porPedido[k] || []).push(b); }
  /* "veio por" = o tipo (agencia, indicacao, influencer, Instagram...); a coluna
     nova diz QUEM (a agencia, quem indicou, o influencer). Parceiro = o vendor
     (hotel, loja). Comissao vendor e comissao indicacao, como na planilha. */
  const quem = (veio, par, txt) => par && par.tipo !== 'parceiro' ? par.nome : (txt || '');
  const comDe = (b, par, tipo) => { const manual = +(tipo === 'vendor' ? b.comVendor : b.comIndic) || 0; if (manual) return manual;
    return par && ((tipo === 'vendor') === (par.tipo === 'parceiro')) ? Math.round((+b.total || 0) * (+par.comissao || 0)) / 100 : 0; };
  /* agencia: o nome de quem viaja vai entre parenteses (nota [2] da planilha dela) */
  const entre = (nome, veioPor) => veioPor === 'agencia' && nome && !/^\(.*\)$/.test(nome.trim()) ? '(' + nome.trim() + ')' : nome;
  for (const b of DB.bookings) {
    const c = b.clienteId ? Cadastro.get(b.clienteId) : null, par = b.parceiroId ? Parceiros.get(b.parceiroId) : (b.coupon ? Parceiros.all().find(x => x.cupom === String(b.coupon).toUpperCase()) : null);
    const irmas = porPedido[pedidoDe(b)] || [b];
    const pagos = (b.payments || []).filter(p => p.conta !== CONTA_PRESTADOR);
    const veioPor = (c && c.veioPor) || (par ? (par.tipo === 'agencia' ? 'agencia' : par.tipo === 'influencer' ? 'influencer' : '') : '');
    out.push({ tipo: 'reserva', id: b.id, b, pedido: pedidoDe(b), etapa: etapaDaReserva(b, hoje), conta: b.status !== 'cancelled',
      /* nota [1] da planilha: a Data e a do PAGAMENTO, nao a do registro */
      dataPedido: pagos.map(p => p.date).filter(Boolean).sort()[0] || String(b.createdAt || '').slice(0, 10), dataPago: !!pagos.length,
      veio: VEIO_CURTO[veioPor] || '', veioPor, indicou: quem(veioPor, par, b.indicou || (c && c.indicadoNome) || ''),
      whats: b.whats || '', nome: b.name, nomePlan: entre(b.name, veioPor), arquivo: b.arquivo || '',
      dataServ: b.date, hora: b.time, pax: b.pax, servico: nomeDoServico(b) + (b.voo ? ' · ' + b.voo : ''), obs: b.obsOp || '',
      clientePaga: +b.total || 0, ingridPaga: +b.custo || 0, cidade: b.destino || b.origem || '', parceiro: par && par.tipo === 'parceiro' ? par.nome : (b.parceiroTxt || ''),
      /* Total e Sinal sao do PEDIDO (como na planilha dela): o sinal e o que o pedido inteiro ja pagou a ela */
      totalPedido: irmas.reduce((s2, x) => s2 + (+x.total || 0), 0),
      sinal: Math.round(irmas.reduce((s2, x) => s2 + (x.payments || []).filter(p => p.conta !== CONTA_PRESTADOR).reduce((a, p) => a + p.amount, 0), 0) * 100) / 100,
      forma: contas(b), emReal: pagos.reduce((s2, p) => s2 + (+p.reais || 0), 0),
      comVendor: comDe(b, par, 'vendor'), comIndic: comDe(b, par, 'indic'), motivo: b.motivoPerda || '',
      repescagens: (b.orcamentoId && (Orc.get(b.orcamentoId) || {}).repescagens) || [], links: b.links || [] });
  }
  for (const o of DB.orcamentos || []) {
    if (o.status === 'fechado') continue;
    const etapa = o.status === 'perdido' ? 'perdido' : 'aberto';
    const itens = o.itens.length ? o.itens : [{ desc: o.resumo || '(sem serviços ainda)', data: (o.datas || [])[0] || '', hora: '', pax: o.pax || 0, valor: 0 }];
    /* "conta": o item entra nas somas? (perdido e a opção não escolhida aparecem, mas não somam) */
    const conta = new Set(Orc.itensConta(o));
    for (const it of itens) out.push({ tipo: 'orcamento', id: o.id, o, itemId: it.id || '', pedido: o.id, etapa: it.perdido ? 'perdido' : etapa, status: o.status,
      conta: o.status !== 'perdido' && (!o.itens.length || conta.has(it)), opcao: !!(it.alt && !it.perdido && Orc.opcoes(o).some(l => l.includes(it))),
      dataPedido: String(o.criado || '').slice(0, 10), veio: o.veioPor ? (VEIO_CURTO[o.veioPor] || '') : (ORIGEM_ORC_TXT[o.origem] || ''), veioPor: o.veioPor || '', indicou: o.indicou || '',
      whats: o.cliente.whats || '', nome: o.cliente.nome || '', nomePlan: entre(o.cliente.nome || '', o.veioPor), arquivo: Orc.nomeArquivo(o),
      dataServ: it.data || '', hora: it.hora || '', pax: it.pax || '', servico: it.desc + (it.voo ? ' · ' + it.voo : ''), obs: it.obs || '',
      clientePaga: +it.valor || 0, ingridPaga: +it.custo || 0, cidade: it.cidade || '', parceiro: o.parceiroTxt || '', totalPedido: Orc.total(o), sinal: Orc.sinal(o), forma: o.forma || '', emReal: +o.emReal || 0,
      /* comissão é do PEDIDO: só na 1ª linha (senão a soma da planilha conta N vezes) */
      comVendor: it === itens[0] ? (+o.comVendor || 0) : 0, comIndic: it === itens[0] ? (+o.comIndic || 0) : 0, motivo: o.motivoPerda || '',
      repescagens: o.repescagens || [], links: o.links || [] });
  }
  return out.sort((a, b2) => String(a.dataServ || '9999').localeCompare(String(b2.dataServ || '9999')) || String(a.hora).localeCompare(String(b2.hora)));
}
/* ---------- A PLANILHA QUE ELA PREENCHE ----------
   Cada celula da aba Planilha grava direto no registro de verdade: a linha de
   orcamento grava no orcamento (e no servico dele), a linha de reserva grava
   na reserva. Status "CONFIRMADO" num orcamento = Fechou (vira reserva). */
const CRM_STATUS_OPC = { orcamento: [['rascunho', 'Rascunho'], ['enviado', 'Enviado'], ['confirmado', 'CONFIRMADO'], ['perdido', 'Perdido']],
                         reserva: [['confirmado', 'CONFIRMADO'], ['avaliar', '⭐AVALIAR'], ['finalizado', '💚FINALIZADO'], ['perdido', 'Perdido']] };
/* "12/06", "12/06/26", "12/06/2026" ou ISO. Sem ano: a proxima vez que cai essa data */
function _dataDigitada(v, hoje) {
  const t = String(v || '').trim(); if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/); if (!m) return null;
  hoje = hoje || isoToday();
  let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +hoje.slice(0, 4);
  const iso = (a) => `${a}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  if (!m[3] && iso(y) < addDays(hoje, -60)) y++;
  const d = new Date(iso(y) + 'T12:00:00');
  return isNaN(d) || d.getDate() !== +m[1] ? null : iso(y);
}
const _horaDigitada = (v) => { const m = String(v || '').match(/(\d{1,2})\s*[:h]\s*(\d{2})?/); return m ? String(m[1]).padStart(2, '0') + ':' + (m[2] || '00') : ''; };
function crmEdita(ref, campo, valor, hoje) {
  const v = String(valor ?? '').trim(), num = () => _valorPlanilha(v);
  if (ref.tipo === 'orcamento') {
    const o = Orc.get(ref.id); if (!o) return { erro: 'orçamento não encontrado' };
    let it = o.itens.find(x => x.id === ref.itemId) || o.itens[0];
    const precisaItem = ['dataServ', 'hora', 'pax', 'servico', 'obs', 'clientePaga', 'ingridPaga', 'cidade', 'sinal'];
    if (precisaItem.includes(campo) && !it) { it = Orc._item({ desc: '' }); o.itens.push(it); }
    const rp = campo.match(/^(rep|res)([123])$/);
    if (rp) {
      o.repescagens = o.repescagens || []; const n = +rp[2];
      let x = o.repescagens.find(y => y.n === n); if (!x) { x = { n, data: '', resultado: '' }; o.repescagens.push(x); o.repescagens.sort((a, b) => a.n - b.n); }
      if (rp[1] === 'rep') { const d = _dataDigitada(v, hoje); if (d === null) return { erro: 'data em dd/mm' }; x.data = d; } else x.resultado = v;
      if (!x.data && !x.resultado) o.repescagens = o.repescagens.filter(y => y !== x);
      _opSave(); return { ok: true };
    }
    if (CRM_LINK_CAMPO[campo]) return crmLinkPoe(o, CRM_LINK_CAMPO[campo], v);
    switch (campo) {
      case 'nome': o.cliente.nome = v; break;
      case 'whats': o.cliente.whats = v; break;
      case 'veio': o.veioPor = _veioDigitado(v); break;
      case 'indicou': o.indicou = v; break;
      case 'dataPedido': { const d = _dataDigitada(v, hoje); if (d === null) return { erro: 'data em dd/mm' }; o.criado = (d || isoToday()) + 'T10:00:00.000Z'; break; }
      case 'dataServ': { const d = _dataDigitada(v, hoje); if (d === null) return { erro: 'data em dd/mm' }; it.data = d; break; }
      case 'hora': it.hora = _horaDigitada(v); break;
      case 'pax': it.pax = Math.max(1, parseInt(v, 10) || 1); break;
      case 'servico': it.desc = v; break;
      case 'obs': it.obs = v; break;
      case 'clientePaga': it.valor = num(); break;
      case 'ingridPaga': it.custo = num(); break;
      case 'cidade': it.cidade = v; break;
      case 'parceiro': o.parceiroTxt = v; break;
      /* o Sinal do pedido digitado na Planilha é repartido entre os serviços que CONTAM,
         cada um até o próprio valor (antes ia todo pro 1º item, mesmo perdido) */
      case 'sinal': { const cont = Orc.itensConta(o); let resto = Math.round(num() * 100) / 100;
        for (const x of cont) { const v = Math.min(resto, +x.valor || 0); x.sinal = Math.round(v * 100) / 100; resto = Math.round((resto - v) * 100) / 100; }
        if (resto > 0 && cont.length) cont[0].sinal = Math.round((cont[0].sinal + resto) * 100) / 100; break; }
      case 'forma': o.forma = v; break;
      case 'emReal': o.emReal = num(); break;
      case 'comVendor': o.comVendor = num(); break;
      case 'comIndic': o.comIndic = num(); break;
      case 'motivo': o.motivoPerda = v; if (v) o.status = 'perdido'; break;
      case 'arquivo': o.arquivo = v; break;
      case 'status': {
        if (v === 'confirmado') {
          const semData = o.itens.filter(x => String(x.desc || '').trim() && !x.data);
          if (semData.length) return { erro: `falta a data do serviço: ${semData.map(x => x.desc).join(', ')}` };
          const bs = Orc.fecha(o.id, { sinalRecebido: false }); if (!bs.length && Orc.erro) return { erro: Orc.erro }; return { ok: true, reservas: bs.length };
        }
        if (v === 'perdido') { o.status = 'perdido'; o.motivoPerda = o.motivoPerda || 'Outro'; }
        else if (v === 'enviado' || v === 'rascunho') { o.status = v; o.motivoPerda = ''; if (v === 'enviado' && typeof Espera !== 'undefined') Espera.orcamento(o); }
        else return { erro: 'status desconhecido' };
        break;
      }
      default: return { erro: 'esta coluna não se edita aqui' };
    }
    _opSave(); return { ok: true };
  }
  const b = Bookings.get(ref.id); if (!b) return { erro: 'reserva não encontrada' };
  /* Follow-up / Resultado de uma reserva: moram no orçamento de onde ela veio */
  if (/^(rep|res)[123]$/.test(campo)) return b.orcamentoId && Orc.get(b.orcamentoId) ? crmEdita({ tipo: 'orcamento', id: b.orcamentoId }, campo, valor, hoje) : { erro: 'esta reserva não veio de um orçamento' };
  if (CRM_LINK_CAMPO[campo]) return crmLinkPoe(b, CRM_LINK_CAMPO[campo], v);
  switch (campo) {
    case 'nome': if (v) b.name = v; break;
    case 'whats': b.whats = v; break;
    case 'veio': { const c = b.clienteId && Cadastro.get(b.clienteId); if (c) Cadastro.salva(c.id, { veioPor: _veioDigitado(v) }); else b.veioPor = _veioDigitado(v); break; }
    case 'indicou': b.indicou = v; break;
    case 'dataServ': { const d = _dataDigitada(v, hoje); if (!d) return { erro: 'data em dd/mm' }; b.date = d; break; }
    case 'hora': { const h = _horaDigitada(v); if (h) b.time = h; break; }
    case 'pax': b.pax = Math.max(1, parseInt(v, 10) || 1); break;
    case 'servico': b.servicoTxt = v; break;
    case 'obs': b.obsOp = v; break;
    case 'clientePaga': b.total = num(); break;
    case 'ingridPaga': b.custo = num(); break;
    case 'cidade': b.destino = v; break;
    case 'parceiro': b.parceiroTxt = v; break;
    case 'comVendor': b.comVendor = num(); break;
    case 'comIndic': b.comIndic = num(); break;
    case 'motivo': b.motivoPerda = v; break;
    case 'arquivo': b.arquivo = v; break;
    case 'status':
      if (v === 'perdido') { b.status = 'cancelled'; b.motivoPerda = b.motivoPerda || 'Outro'; }
      else { if (b.status === 'cancelled') b.status = 'confirmed'; b.avaliacaoEm = v === 'finalizado' ? (b.avaliacaoEm || isoToday()) : ''; }
      break;
    default: return { erro: 'na reserva, sinal e forma de pagamento entram pelo 💶 Pagamento' };
  }
  _opSaveBooking(b); return { ok: true };
}
const CRM_LINK_CAMPO = { lPdf: 'PDF', lOrc: 'Orçamento', lVoucher: 'Voucher', lComprov: 'Comprovante', lAval: 'Avaliação' };
function crmLinkPoe(x, nome, url) {
  if (url && !/^https?:\/\//i.test(url)) return { erro: 'o link precisa começar com http' };
  x.links = (x.links || []).filter(l => l.nome !== nome);
  if (url) x.links.push({ nome, url });
  if (x.itens) _opSave(); else _opSaveBooking(x);
  return { ok: true };
}
function _veioDigitado(v) {
  const t = _nomeN(v); if (!t) return '';
  const k = Object.keys(VEIO_CURTO).find(x => x === t || _nomeN(VEIO_CURTO[x]) === t);
  if (k) return k;
  return /insta/.test(t) ? 'instagram' : /status/.test(t) ? 'status' : /indic/.test(t) ? 'indicacao' : /influ|cupom/.test(t) ? 'influencer' : /agenc/.test(t) ? 'agencia' : /youtube/.test(t) ? 'youtube' : /\bguia\b/.test(t) ? 'guia' : /google|site/.test(t) ? 'google' : 'outro';
}
/* linha nova na planilha = um pedido novo (orcamento), como ela faz hoje */
function crmNovaLinha(d = {}) {
  return Orc.cria({ origem: 'planilha', status: 'rascunho', cliente: { nome: d.nome || '', whats: d.whats || '' }, sinalPct: 0, itens: [{ desc: '', valor: 0 }] });
}
/* mais um servico no mesmo pedido (a linha de baixo, com o mesmo nome) */
function crmMaisServico(orcId) {
  const o = Orc.get(orcId); if (!o) return null;
  const ult = o.itens[o.itens.length - 1] || {};
  const it = Orc._item({ desc: '', data: ult.data || '', pax: ult.pax || 1, sinal: 0 }); o.itens.push(it); _opSave(); return it;
}
const ORIGEM_ORC_TXT = { whats: 'WhatsApp', site: 'Meu pedido (app)', roteiro: 'Monte seu roteiro', manual: '', planilha: '' };
/* O PAINEL DO CRM (o topo da aba Orcamentos): os numeros que ela olha na
   planilha e a lista "precisa de voce" — o que cada pedido espera dela hoje.
   Recebe as linhas ja filtradas pelo mes que ela escolheu. */
function crmPainel(linhas, hoje) {
  hoje = hoje || isoToday();
  const ped = new Map();
  for (const r of linhas) { const p = ped.get(r.pedido) || { r, linhas: [], etapas: new Set() }; p.linhas.push(r); p.etapas.add(r.etapa); ped.set(r.pedido, p); }
  const P = [...ped.values()];
  const abertos = P.filter(p => p.etapas.has('aberto'));
  const fechados = P.filter(p => ['confirmado', 'avaliar', 'finalizado'].some(e => p.etapas.has(e)));
  const perdidos = P.filter(p => p.etapas.size === 1 && p.etapas.has('perdido'));
  const conf = linhas.filter(r => r.etapa === 'confirmado' && r.b);
  const motivos = {}; perdidos.forEach(p => { const m = p.r.motivo || 'sem motivo'; motivos[m] = (motivos[m] || 0) + 1; });
  const comissoes = Parceiros.all().map(x => ({ x, c: Parceiros.conta(x) })).filter(y => y.c.saldo > 0);
  /* o que espera por ela */
  const agora = [];
  for (const p of abertos) {
    const o = p.r.o; if (!o) continue;
    if (o.status === 'novo' || o.status === 'rascunho') agora.push({ tipo: 'montar', ordem: 2, nome: p.r.nome, o, txt: 'orçamento ainda não mandado' });
    else {
      const t = Tarefas.all().find(t2 => !t2.feita && t2.orcId === o.id && t2.etapa === 'aguardar');
      if (t && t.prazo && t.prazo <= hoje) agora.push({ tipo: 'repescar', ordem: 1, nome: p.r.nome, o, txt: `mandado e sem resposta${(o.repescagens || []).length ? ` · já foram ${o.repescagens.length} follow-up(s)` : ''}` });
    }
  }
  const semSinal = new Map();
  for (const r of conf) if (!Bookings.paid(r.b) && r.dataServ <= addDays(hoje, 14)) semSinal.set(r.pedido, r);
  for (const r of semSinal.values()) agora.push({ tipo: 'sinal', ordem: 3, nome: r.nome, r, txt: `confirmado para ${r.dataServ.slice(8, 10)}/${r.dataServ.slice(5, 7)} e ainda sem sinal` });
  const avaliar = new Map();
  for (const r of linhas) if (r.etapa === 'avaliar') { const a = avaliar.get(r.pedido) || { r, ids: [] }; a.ids.push(r.id); if (r.dataServ > a.r.dataServ) a.r = r; avaliar.set(r.pedido, a); }
  for (const a of avaliar.values()) agora.push({ tipo: 'avaliar', ordem: 4, nome: a.r.nome, r: a.r, ids: a.ids, txt: `o passeio foi ${a.r.dataServ.slice(8, 10)}/${a.r.dataServ.slice(5, 7)} · pedir a avaliação` });
  agora.sort((x, y) => x.ordem - y.ordem || String(y.r ? y.r.dataServ : '').localeCompare(String(x.r ? x.r.dataServ : '')));
  return {
    abertos: { n: abertos.length, valor: abertos.reduce((s2, p) => s2 + (p.r.totalPedido || 0), 0), naoMandados: abertos.filter(p => p.r.o && (p.r.o.status === 'novo' || p.r.o.status === 'rascunho')).length },
    confirmados: { n: new Set(conf.map(r => r.pedido)).size, valor: conf.reduce((s2, r) => s2 + (r.clientePaga || 0), 0),
      recebido: conf.reduce((s2, r) => s2 + Bookings.paid(r.b), 0), falta: conf.reduce((s2, r) => s2 + Bookings.due(r.b), 0) },
    fecha: { fechados: fechados.length, perdidos: perdidos.length, taxa: fechados.length + perdidos.length ? fechados.length / (fechados.length + perdidos.length) : null,
      motivo: Object.entries(motivos).sort((x, y) => y[1] - x[1])[0] || null },
    comissoes: { n: comissoes.length, valor: Math.round(comissoes.reduce((s2, y) => s2 + y.c.saldo, 0) * 100) / 100 },
    agora,
  };
}
/* pedir a avaliacao: a mensagem sai pronta; ela manda. Depois disso a linha vai para Finalizado */
function msgAvaliacao(b) {
  const link = (DB.settings && DB.settings.linkAvaliacao) || '';
  return `Oi ${String(b.name || '').split(' ')[0]}! Tudo certo com ${nomeDoServico(b)}? Foi um prazer receber vocês. ` +
    `Se puder, deixe sua avaliação — ajuda muito o meu trabalho${link ? ': ' + link : '.'} Obrigada! ${typeof guiaNome === 'function' ? guiaNome() : ''}`;
}
function marcaAvaliacao(bookingId) { const b = Bookings.get(bookingId); if (!b) return; b.avaliacaoEm = isoToday(); _opSaveBooking(b); }
function perdeOrcamento(id, motivo) { const o = Orc.get(id); if (!o) return; o.status = 'perdido'; o.motivoPerda = motivo || 'Outro'; _opSave(); }
/* a planilha de volta para o Google Planilhas, com as colunas dela */
const CRM_COLUNAS = ['Data', 'veio por', 'Agência / indicação / influencer', 'Whatsapp', 'Nome', 'Data Serviço', 'Hora', 'PAX', 'Serviço pedido', 'Obs', 'Cliente Paga', 'Ingrid Paga', 'Cidade', 'Parceiro',
  'Total', 'Sinal', 'forma Pagamento', 'Em Real (se fez PIX)', 'Comissao Vendor', 'Comissao indicacao', 'Status', 'Motivo da perda',
  'Follow-up 1', 'Resultado 1', 'Follow-up 2', 'Resultado 2', 'Follow-up 3', 'Resultado 3', 'Nome do arquivo', 'Link PDF', 'Link Orçamento', 'Link Voucher', 'Link Comprov', 'Link Avaliacao'];
/* o Status com as palavras da planilha dela */
function crmStatusTxt(r) {
  if (r.etapa === 'aberto') return r.status === 'enviado' ? 'Enviado' : 'Rascunho';
  return { confirmado: 'CONFIRMADO', avaliar: '⭐AVALIAR', finalizado: '💚FINALIZADO', perdido: 'Perdido' }[r.etapa] || r.etapa;
}
function crmCsv(linhas) {
  const d = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';
  const q = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const num = (v) => v ? String(v).replace('.', ',') : '';
  const rp = (r, k) => { const x = (r.repescagens || []).find(y => y.n === k); return x ? [d(x.data), x.resultado] : ['', '']; };
  const lk = (r, re) => (r.links || []).filter(l => re.test(l.nome)).map(l => l.url).join(' ');
  return [CRM_COLUNAS, ...linhas.map(r => [d(r.dataPedido), r.veio, r.indicou, r.whats, r.nomePlan || r.nome, d(r.dataServ), r.hora, r.pax, r.servico, r.obs, num(r.clientePaga), num(r.ingridPaga),
    r.cidade, r.parceiro, num(r.totalPedido), num(r.sinal), r.forma, num(r.emReal), num(r.comVendor), num(r.comIndic), crmStatusTxt(r), r.motivo,
    ...rp(r, 1), ...rp(r, 2), ...rp(r, 3), r.arquivo, lk(r, /pdf/i), lk(r, /or[cç]amento|planilha/i), lk(r, /voucher/i), lk(r, /comprov/i), lk(r, /avalia/i)])]
    .map(l => l.map(q).join(';')).join('\n');
}

/* ---------- PAINEL DE NUMEROS (a aba Relatorios) ----------
   Cada marcador compara com o periodo ANTERIOR de mesmo tamanho: "este mes
   ate hoje" contra "o mes passado ate o mesmo dia". Sem isto, o dia 3 do mes
   sempre pareceria uma queda contra o mes inteiro anterior.

   Dinheiro que a guia ou o motorista recebeu na mao NAO e receita dela: fica
   fora do "recebido" e aparece separado. */
function _dias(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
function _fimDoMes(iso) { const d = new Date(iso.slice(0, 7) + '-15T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10); }
const Painel = {
  periodo(preset, hoje) {
    hoje = hoje || isoToday();
    if (preset === 'semana') return { de: addDays(hoje, -6), ate: hoje, antDe: addDays(hoje, -13), antAte: addDays(hoje, -7), nome: 'últimos 7 dias', ant: 'os 7 dias antes', antCurto: 'semana anterior' };
    if (preset === '90') return { de: addDays(hoje, -89), ate: hoje, antDe: addDays(hoje, -179), antAte: addDays(hoje, -90), nome: 'últimos 90 dias', ant: 'os 90 dias antes', antCurto: '90 dias antes' };
    if (preset === 'ano') {
      const y = +hoje.slice(0, 4);
      return { de: y + '-01-01', ate: hoje, antDe: (y - 1) + '-01-01', antAte: (y - 1) + hoje.slice(4), nome: 'este ano', ant: 'o mesmo período de ' + (y - 1), antCurto: String(y - 1) };
    }
    /* mes: do dia 1 ate hoje, contra o mes passado ate o mesmo dia */
    const de = hoje.slice(0, 8) + '01';
    const antDe = addDays(de, -1).slice(0, 8) + '01';
    const fimAnt = _fimDoMes(antDe);
    const mesmoDia = antDe.slice(0, 8) + hoje.slice(8, 10);
    return { de, ate: hoje, antDe, antAte: mesmoDia > fimAnt ? fimAnt : mesmoDia, nome: 'este mês', ant: 'o mês passado até o mesmo dia', antCurto: 'mês passado' };
  },
  /* período escolhido à mão (de/até): compara com o período anterior do mesmo tamanho */
  periodoCustom(de, ate) {
    const n = _dias(de, ate) + 1;
    const antAte = addDays(de, -1), antDe = addDays(antAte, -(n - 1));
    const dd = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    return { de, ate, antDe, antAte, nome: `${dd(de)} a ${dd(ate)}`, ant: 'o período anterior de mesmo tamanho', antCurto: 'período anterior' };
  },
  delta(cur, ant) { return ant ? (cur - ant) / ant : (cur ? null : 0); },
  _ativos() { return DB.bookings.filter(b => b.status !== 'cancelled'); },
  recebido(de, ate) {
    let voce = 0, prest = 0, n = 0;
    for (const b of DB.bookings) for (const p of b.payments || []) {
      if (!p.date || p.date < de || p.date > ate) continue;
      if (ladoDoPagamento(p) === 'prestador') prest += p.amount; else { voce += p.amount; n++; }
    }
    return { voce, prest, n };
  },
  /* o que ela VENDEU no periodo: reservas feitas nele, seja qual for a data do servico */
  vendido(de, ate) {
    const bs = Painel._ativos().filter(b => { const c = String(b.createdAt || '').slice(0, 10); return c >= de && c <= ate; });
    return { valor: bs.reduce((s, b) => s + (+b.total || 0), 0), n: bs.length, pax: bs.reduce((s, b) => s + (+b.pax || 0), 0) };
  },
  /* servicos que acontecem no periodo */
  servicos(de, ate) {
    const bs = Painel._ativos().filter(b => b.date >= de && b.date <= ate);
    return { n: bs.length, pax: bs.reduce((s, b) => s + (+b.pax || 0), 0), lista: bs };
  },
  /* a margem so existe onde ela preencheu o custo (Detalhes do servico) */
  margem(de, ate) {
    const bs = Painel.servicos(de, ate).lista;
    const com = bs.filter(b => +b.custo > 0);
    const receita = com.reduce((s, b) => s + (+b.total || 0), 0), custo = com.reduce((s, b) => s + (+b.custo || 0), 0);
    return { receita, custo, margem: receita - custo, pct: receita ? (receita - custo) / receita : null, n: com.length, semCusto: bs.length - com.length };
  },
  aReceber(hoje) {
    hoje = hoje || isoToday();
    let comVoce = 0, noDia = 0, atrasado = 0;
    for (const b of Painel._ativos()) {
      if (Bookings.due(b) <= 0) continue;
      if (b.date >= hoje) noDia += Op.dueNoDia(b);
      const falta = Op.dueIngrid(b); if (falta <= 0) continue;   // o que é dela: o resto (política "tudo a ela") ou o sinal que não caiu
      comVoce += falta;
      if (Bookings.dueDate(b) < hoje) atrasado += falta;
    }
    return { comVoce, noDia, atrasado };
  },
  orcamentos(de, ate) {
    const os = (DB.orcamentos || []).filter(o => { const c = String(o.criado || '').slice(0, 10); return c >= de && c <= ate; });
    const conta = (st) => os.filter(o => o.status === st).length;
    const fechados = conta('fechado'), perdidos = conta('perdido'), enviados = conta('enviado');
    const decididos = fechados + perdidos;
    return { n: os.length, novos: conta('novo') + conta('rascunho'), enviados, fechados, perdidos,
             valorFechado: os.filter(o => o.status === 'fechado').reduce((s, o) => s + Orc.total(o), 0),
             taxa: decididos ? fechados / decididos : null };
  },
  /* PEDIRAM × FECHARAM por serviço e tempo até fechar (contrato de 30/09): dos orçamentos criados no período */
  fechamento(de, ate) {
    const os = (DB.orcamentos || []).filter(o => { const c = String(o.criado || '').slice(0, 10); return c >= de && c <= ate; });
    const nomeDe = (x) => { const t = x.tourId && Tours.get(x.tourId); const s = t ? t.name.pt : String(x.desc || '').split(/\s+[-–]\s+/)[0]; return s.replace(/\s*\(.*$/, '').trim() || '?'; };
    const map = new Map();
    for (const o of os) for (const x of o.itens || []) {
      if (x.auto || x.sugestao || !String(x.desc || '').trim()) continue;
      const k = nomeDe(x), r = map.get(k) || { servico: k, pediram: 0, fecharam: 0, perderam: 0 };
      r.pediram++;
      if (o.status === 'fechado' && !x.perdido) r.fecharam++; else if (x.perdido || o.status === 'perdido') r.perderam++;
      map.set(k, r);
    }
    const porServico = [...map.values()].sort((a, b) => b.pediram - a.pediram).map(r => ({ ...r, taxa: (r.fecharam + r.perderam) ? Math.round(r.fecharam / (r.fecharam + r.perderam) * 100) : null }));
    const dias = os.filter(o => o.status === 'fechado').map(o => Orc.diasAteFechar(o)).filter(d => d != null).sort((a, b) => a - b);
    return { porServico, diasAteFechar: { media: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length * 10) / 10 : null, mediana: dias.length ? dias[Math.floor(dias.length / 2)] : null, fechados: dias.length } };
  },
  /* quem veio: novo ou de volta, e quem veio JUNTO (as indicacoes dela) */
  clientes(de, ate) {
    const bs = Painel.servicos(de, ate).lista;
    const chaves = new Set(bs.map(chaveCliente));
    let voltaram = 0;
    for (const k of chaves) {
      const antes = Painel._ativos().some(b => chaveCliente(b) === k && b.date < de);
      if (antes) voltaram++;
    }
    const junto = bs.reduce((s, b) => s + (b.group || []).filter(g => g && g.nome).length, 0);
    return { n: chaves.size, voltaram, novos: chaves.size - voltaram, junto };
  },
  /* series para os mini-graficos e o grafico de entrada de dinheiro */
  semanas(n, ate, fn) {
    ate = ate || isoToday();
    const out = [];
    let fim = ate;
    for (let i = 0; i < n; i++) {
      const ini = addDays(fim, -6);
      out.unshift({ de: ini, ate: fim, rot: ini.slice(8, 10) + '/' + ini.slice(5, 7), v: fn(ini, fim) });
      fim = addDays(ini, -1);
    }
    return out;
  },
  meses(ano, fn) {
    const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return MES.map((m, i) => { const de = `${ano}-${String(i + 1).padStart(2, '0')}-01`; return { de, ate: _fimDoMes(de), rot: m, v: fn(de, _fimDoMes(de)) }; });
  },
  /* O QUE JA ESTA VENDIDO para as proximas semanas: quanto ja entrou e quanto falta */
  futuro(semanas, hoje) {
    hoje = hoje || isoToday();
    const out = [];
    for (let i = 0; i < (semanas || 8); i++) {
      const de = addDays(hoje, i * 7), ate = addDays(de, 6);
      const bs = Painel._ativos().filter(b => b.date >= de && b.date <= ate);
      const total = bs.reduce((s, b) => s + (+b.total || 0), 0);
      const pago = bs.reduce((s, b) => s + Bookings.paid(b), 0);
      out.push({ de, ate, rot: de.slice(8, 10) + '/' + de.slice(5, 7), total, pago, falta: Math.max(0, total - pago), n: bs.length, pax: bs.reduce((s, b) => s + (+b.pax || 0), 0) });
    }
    return out;
  },
  /* dia da semana x turno: onde a semana dela aperta (e onde faltam guias) */
  calor(de, ate) {
    const m = Array.from({ length: 7 }, () => ({ manha: 0, tarde: 0, noite: 0 }));
    for (const b of Painel.servicos(de, ate).lista) {
      const wd = (new Date(b.date + 'T12:00:00').getDay() + 6) % 7; /* segunda = 0 */
      for (const tu of turnosDoServico(b)) m[wd][tu] += 1;
    }
    return m;
  },
  porServico(de, ate) {
    const map = new Map();
    for (const b of Painel.servicos(de, ate).lista) {
      const r = map.get(b.tourId) || { tourId: b.tourId, valor: 0, n: 0, pax: 0 };
      r.valor += +b.total || 0; r.n++; r.pax += +b.pax || 0;
      map.set(b.tourId, r);
    }
    return [...map.values()].sort((a, b) => b.valor - a.valor || b.n - a.n);
  },
  origens(de, ate) {
    const bs = Painel.servicos(de, ate).lista;
    const map = {};
    for (const b of bs) { const o = b.origin || 'site'; map[o] = (map[o] || 0) + 1; }
    return Object.entries(map).map(([origem, n]) => ({ origem, n, pct: bs.length ? n / bs.length : 0 })).sort((a, b) => b.n - a.n);
  },
  equipe(de, ate) {
    const map = new Map();
    let sem = 0;
    for (const b of Painel.servicos(de, ate).lista) {
      if (!b.prestadorId) { sem++; continue; }
      const r = map.get(b.prestadorId) || { pessoa: Equipe.get(b.prestadorId), n: 0, pax: 0, noDia: 0 };
      r.n++; r.pax += +b.pax || 0;
      r.noDia += (b.payments || []).filter(p => p.conta === CONTA_PRESTADOR).reduce((s, p) => s + p.amount, 0)
               + Op.dueNoDia(b);
      map.set(b.prestadorId, r);
    }
    return { lista: [...map.values()].filter(r => r.pessoa).sort((a, b) => b.n - a.n), sem };
  },
  /* com quanta antecedencia reservam: quando comecar a divulgar cada temporada */
  antecedencia(de, ate) {
    const faixas = [['até 7 dias', 0, 7, 'até 7'], ['8 a 30 dias', 8, 30, '8–30'], ['31 a 90 dias', 31, 90, '31–90'], ['mais de 90 dias', 91, 1e9, '+90']];
    const dias = Painel.servicos(de, ate).lista.filter(b => b.createdAt).map(b => Math.max(0, _dias(String(b.createdAt).slice(0, 10), b.date)));
    const ord = [...dias].sort((a, b) => a - b);
    const mediana = ord.length ? (ord.length % 2 ? ord[(ord.length - 1) / 2] : Math.round((ord[ord.length / 2 - 1] + ord[ord.length / 2]) / 2)) : null;
    return { faixas: faixas.map(([rot, a, z, curto]) => ({ rot, curto, n: dias.filter(d => d >= a && d <= z).length })), mediana, n: dias.length };
  },
};

/* ---------- textos das abas novas ---------- */
if (typeof STR !== 'undefined') {
  Object.assign(STR, {
    admGuias:    { pt: 'Guias e motoristas', en: 'Guides & drivers' },
    admPipeline: { pt: 'Pipeline', en: 'Pipeline' },
    admPrecos:   { pt: 'Tabela de preços', en: 'Price list' },
    admVoucher:  { pt: 'Voucher', en: 'Voucher' },
    admConversas: { pt: 'Conversas', en: 'Conversations' },
    admConsulta: { pt: 'Orçamentos', en: 'Quotes' },
    hubAval: { pt: 'Avaliações', en: 'Reviews' },
    hubAvalSub: { pt: 'O que dizem os clientes', en: 'What our guests say' },
  admPlanilha: { pt: 'Planilha', en: 'Sheet' },
  admTransfer: { pt: 'Transfer', en: 'Transfers' },
    admTarefas:  { pt: 'Tarefas', en: 'Tasks' },
    admClients:  { pt: 'Clientes', en: 'Clients' },
    admCoupons:  { pt: 'Cupons e parcerias', en: 'Coupons & partners' },
    admMoney:    { pt: 'Contabilidade', en: 'Accounting' },
  });
}

opGarante();
