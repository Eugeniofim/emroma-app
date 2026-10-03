/* ---------- cotação EUR → BRL ----------
   O preço do guia é em euro. Um cliente brasileiro olha "€ 195" e não faz
   ideia se é caro — mostrar o equivalente em real resolve isso, e é o mesmo
   número que o Pix vai cobrar quando o Stripe entrar (Pix só aceita BRL).

   Regra de ouro daqui: número errado é PIOR que número nenhum. Se nenhuma
   fonte responder e não houver nada guardado, não mostramos real nenhum. */
'use strict';

const FX_KEY = 'vi_fx_v1';
const FX_VALIDADE = 6 * 3600e3;   /* o BCE publica uma vez por dia; 6h basta */
const FX_TIMEOUT  = 6000;

/* Duas fontes independentes e gratuitas, ambas com CORS liberado.
   Se uma cair, a outra atende — e as duas batem até a quarta casa. */
const FX_FONTES = [
  { nome: 'bce',    url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=BRL' },
  { nome: 'er-api', url: 'https://open.er-api.com/v6/latest/EUR' },
];

let fxMem = null;

function fxGuardado() {
  try { return JSON.parse(localStorage.getItem(FX_KEY)) || null; } catch (e) { return null; }
}
function fxFresco(c) { return !!(c && c.taxa > 0 && (Date.now() - c.em) < FX_VALIDADE); }

async function fxBusca(f) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FX_TIMEOUT);
  try {
    const r = await fetch(f.url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const taxa = j && j.rates && +j.rates.BRL;
    return taxa > 0 ? taxa : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function fxAtualiza() {
  const guardado = fxGuardado();
  if (fxFresco(guardado)) { fxMem = guardado; return fxMem; }

  for (const f of FX_FONTES) {
    const taxa = await fxBusca(f);
    if (taxa) {
      fxMem = { taxa, em: Date.now(), fonte: f.nome };
      try { localStorage.setItem(FX_KEY, JSON.stringify(fxMem)); } catch (e) {}
      return fxMem;
    }
  }
  /* Sem rede ou as duas fora do ar: fica com o último valor conhecido, mesmo
     vencido. Cotação de ontem ajuda o cliente; nenhuma não ajuda nada. */
  fxMem = guardado || null;
  return fxMem;
}

function fxTaxa() { return (fxMem && fxMem.taxa) || null; }
function fxVencida() { return !!(fxMem && !fxFresco(fxMem)); }

/* Converte já com a margem. A margem não é lucro: a cotação do BCE é a do
   meio do mercado, e quem converte de verdade (Stripe/Ebanx) usa spread e
   cobra taxa. Sem margem, ela recebe menos euro do que pediu. */
function emReais(eur) {
  const taxa = fxTaxa();
  if (!taxa || !(eur > 0)) return null;
  const margem = (typeof DB !== 'undefined' && DB && DB.settings && +DB.settings.fxMargem) || 0;
  return Math.ceil(eur * taxa * (1 + margem / 100) / 5) * 5;   /* arredonda de 5 em 5 */
}

function brl(v) {
  if (v == null) return '';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/* O Stripe recusa Pix acima de R$ 3.000. Deixo folga: entre calcular e a
   pessoa pagar, a cotação pode subir e a cobrança seria rejeitada na cara dela. */
const PIX_TETO = 3000;
const PIX_FOLGA = 2850;
function cabeNoPix(eur) {
  const v = emReais(eur);
  return v != null && v <= PIX_FOLGA;
}
