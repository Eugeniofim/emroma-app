/* ---------- Pix copia e cola ----------
   O "copia e cola" do Pix é um padrão aberto do Banco Central (BR Code,
   formato EMV-Co). Dá para montar aqui mesmo, a partir da chave dela:
   sem gateway, sem conta em provedor, sem taxa.

   O que isto FAZ: gera um código com o valor exato da reserva e um
   identificador, para o cliente colar no banco dele e pagar de uma vez.
   O que NÃO faz: avisar o app que o pagamento caiu. Isso exige webhook
   de um provedor — é a etapa seguinte.

   Cuidado com acentos: o padrão é ASCII. "MARIA SOUZA" passa;
   "SÃO PAULO" tem que virar "SAO PAULO" ou o código é recusado. */
'use strict';

/* campo no formato do padrão: id + tamanho (2 dígitos) + valor */
function pixCampo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
}

/* CRC-16/CCITT-FALSE. Validado contra o vetor oficial da norma:
   "123456789" tem que dar 29B1. Se um dia isso mudar, o código para
   de ser aceito pelos bancos. */
function pixCrc(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/* tira acento e o que o padrão não aceita */
function pixLimpa(txt, max) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   /* ã -> a */
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .trim().toUpperCase().slice(0, max);
}

/* o identificador viaja com a cobrança: é como ela sabe QUEM pagou */
function pixTxid(codigo) {
  return String(codigo || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
}

/* Monta o copia e cola.
   valor em reais (número). Sem valor, o cliente digita — evitamos isso. */
/* CPF e CNPJ entram no codigo so com digitos: o guia digita
   "12.345.678/0001-95" e o banco espera "12345678000195". Telefone vira
   +55...; e-mail e chave aleatoria vao como estao. */
function pixChaveLimpa(chave) {
  const k = String(chave || '').trim();
  if (!k) return '';
  const so = k.replace(/[^0-9]/g, '');
  if (/^[0-9.\-/]+$/.test(k) && (so.length === 11 || so.length === 14)) return so;
  return k;
}

function pixCopiaECola({ chave, nome, cidade, valor, txid }) {
  const k = pixChaveLimpa(chave);
  if (!k) return null;

  const conta = pixCampo('00', 'br.gov.bcb.pix') + pixCampo('01', k);
  let p = pixCampo('00', '01')          /* versão do padrão */
        + pixCampo('26', conta)         /* a chave */
        + pixCampo('52', '0000')        /* categoria do comerciante */
        + pixCampo('53', '986');        /* moeda: real */
  if (valor > 0) p += pixCampo('54', Number(valor).toFixed(2));
  p += pixCampo('58', 'BR')
     + pixCampo('59', pixLimpa(nome, 25) || 'RECEBEDOR')
     + pixCampo('60', pixLimpa(cidade, 15) || 'CIDADE')
     + pixCampo('62', pixCampo('05', pixTxid(txid)));
  p += '6304';
  return p + pixCrc(p);
}

/* O guia cobra em euro; o Pix é em real. Usa a mesma conversão e a mesma
   margem do resto do app (fx.js). Sem cotação, não há Pix — melhor não
   oferecer do que cobrar um valor errado. */
function pixValorEmReais(eur) {
  if (typeof emReais !== 'function') return null;
  const v = emReais(eur);
  return v > 0 ? v : null;
}

/* Basta a chave. Nome e cidade sao praticamente decorativos no Pix: o banco
   de quem paga resolve o titular real pela propria chave. Exigir os tres era
   travar o pagamento por um detalhe que o banco ignora. */
function pixDisponivel() {
  const s = (typeof DB !== 'undefined' && DB && DB.settings) || {};
  return !!s.pixKey;
}
function pixNome() {
  const s = (typeof DB !== 'undefined' && DB && DB.settings) || {};
  return s.pixName || s.admName || (typeof guiaNome === 'function' ? guiaNome() : 'GUIA');
}
function pixCidade() {
  const s = (typeof DB !== 'undefined' && DB && DB.settings) || {};
  return s.pixCity || 'SAO PAULO';
}
