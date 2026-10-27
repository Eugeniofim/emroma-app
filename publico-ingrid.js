/* =====================================================
   PÁGINAS PÚBLICAS POR LINK (27/10/2026) — o kit da viagem

   O que vai para o cliente viaja DENTRO do próprio link (#/kt/…): o conteúdo
   é comprimido e posto depois do #. Nada fica público em lugar nenhum: só quem
   recebeu o link vê, e o # não vai para o servidor. O link curto (#/k/…) lê
   UM kit no banco pelo código (kit-ingrid.js).

   Publico.codifica(obj) / Publico.le(texto) — o mesmo formato do servidor
   (função avisos do guia-cofre): JSON → deflate-raw → base64url, 'z' na frente
   ('u' = sem compressão).
   ROTAS_EXTRA['kt'] = (partes) => { … } — o app.js não tem rotas extras, então
   este arquivo embrulha o route() (como o link do guia faz na Yalla).
   ===================================================== */
'use strict';

window.ROTAS_EXTRA = window.ROTAS_EXTRA || {};
const Publico = (function () {
  const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const deB64url = (t) => { const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(t).length + 3) % 4)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function comprime(txt) {
    const bytes = new TextEncoder().encode(txt);
    if (typeof CompressionStream === 'undefined') return 'u' + b64url(bytes);
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64url(new Uint8Array(await new Response(cs).arrayBuffer()));
  }
  async function descomprime(t) {
    const tipo = String(t || '').charAt(0), corpo = String(t || '').slice(1);
    const bytes = deB64url(corpo);
    if (tipo === 'u') return new TextDecoder().decode(bytes);
    if (tipo !== 'z' || typeof DecompressionStream === 'undefined') throw new Error('link num formato que este navegador não abre');
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(ds).arrayBuffer());
  }
  return {
    async codifica(obj) { return comprime(JSON.stringify(obj)); },
    async le(t) { return JSON.parse(await descomprime(t)); },
    base() { return location.href.split('#')[0].replace(/\?.*$/, ''); },
    async link(rota, obj) { return this.base() + '#/' + rota + '/' + await this.codifica(obj); },
  };
})();
window.Publico = Publico;

/* a carcaça da página do cliente: a marca, o botão do PDF e o contato */
function paginaPublica(titulo, html, opts) {
  opts = opts || {};
  app.innerHTML = `<div class="pubPg">
    <header class="topbar"><span class="tbrand">${logoMark(24, 'var(--brand-assinatura)')}<b>${esc(guiaNegocio())}</b></span>
      ${opts.semImprimir ? '' : `<button class="mini" id="pubPdf" style="margin-left:auto">Salvar em PDF</button>`}</header>
    <main class="wrap pubWrap" id="pubPrint">${html}</main>
    <p class="why center pubRodape">${esc(opts.rodape || 'Qualquer dúvida, fale com a gente no WhatsApp.')} <a href="${esc(waLink(opts.waTexto || 'Olá!'))}" target="_blank" rel="noopener">WhatsApp</a></p>
  </div>`;
  document.title = titulo;
  const b = document.getElementById('pubPdf');
  if (b) { if (typeof pdfLiga === 'function') pdfLiga(b, () => document.getElementById('pubPrint'), () => document.title); else b.onclick = () => window.print(); }
}
function paginaPublicaErro(msg) {
  paginaPublica(guiaNegocio(), `<section class="card"><h1 class="pageh">Não consegui abrir este link</h1><p class="why">${esc(msg || 'O link pode ter sido cortado ao copiar. Peça para mandarem de novo pelo WhatsApp.')}</p></section>`, { semImprimir: true });
}
function abrePublico(partes, desenha) {
  const dado = (partes || []).join('/');
  if (!dado) return paginaPublicaErro();
  app.innerHTML = '<main class="wrap"><p class="why center" style="margin-top:40px">Abrindo…</p></main>';
  Publico.le(dado).then(desenha).catch(e => paginaPublicaErro(e && e.message));
}

/* ---------- liga no app: #/<rota>/<…> das ROTAS_EXTRA ---------- */
const pubRotaDe = () => { const p = (location.hash.replace(/^#\/?/, '') || '').split('/'); return Object.prototype.hasOwnProperty.call(ROTAS_EXTRA, p[0]) && typeof ROTAS_EXTRA[p[0]] === 'function' && p.length > 1 && p[1] ? p : null; };
const _routeSemPublico = route;
route = function () {
  const p = pubRotaDe();
  if (!p) { route._pub = ''; return _routeSemPublico(); }
  /* a nuvem chegou / o relógio virou: a página do cliente já está desenhada — não redesenha por cima */
  if (route._pub === location.hash && document.getElementById('pubPrint')) return;
  route._pub = location.hash;
  document.body.classList.remove('em-adm');
  try { if (typeof Coach !== 'undefined') Coach.hide(); } catch (e) {}
  try { const c = document.getElementById('cestaBar'); if (c) c.remove(); } catch (e) {}
  if (typeof visualAplica === 'function') try { visualAplica(false); } catch (e) {}
  document.documentElement.lang = 'pt-BR';
  scrollTo(0, 0);
  return ROTAS_EXTRA[p[0]](p.slice(1));
};
/* o app.js registrou o route() antigo no hashchange e ele desenha a capa primeiro; este ouvinte
   roda logo depois, no mesmo instante (antes da tela pintar), e põe a página do cliente.
   Os outros ouvintes (assistente, endereço novo) continuam valendo. */
addEventListener('hashchange', () => { if (pubRotaDe()) route(); });
(function () {
  if (document.getElementById('pubCss')) return;
  const s = document.createElement('style'); s.id = 'pubCss';
  s.textContent = `.pubWrap{max-width:860px}.pubRodape{margin:10px 16px 30px}
  @media print{ .pubPg > header, .pubPg > p, #iaFab, #iaGaveta, .protobar, .toast{display:none!important} body{background:#fff} .pubWrap{max-width:none;padding:0} @page{size:A4;margin:10mm} }`;
  document.head.appendChild(s);
})();
