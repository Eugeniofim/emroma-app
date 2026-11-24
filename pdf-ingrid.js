/* =====================================================
   PDF DE VERDADE, SEM "IMPRIMIR" (27/10/2026, o mesmo dos outros apps do estúdio)

   O "Imprimir → Salvar como PDF" do navegador não existe no app instalado no
   celular, é bloqueado em alguns navegadores, e no iPhone saía folha em branco.
   Aqui o app DESENHA o documento (html2canvas) e monta o arquivo (jsPDF):
   - toque em "Gerar PDF" → o arquivo fica pronto em 1 ou 2 segundos;
   - no celular: "Enviar" abre o compartilhar do aparelho com o arquivo
     (WhatsApp, e-mail…) — segundo toque de propósito (o iPhone só deixa
     compartilhar logo depois de um toque);
   - no computador: o arquivo baixa sozinho, com o nome do cliente;
   - "Abrir" mostra o PDF numa aba.
   O documento sai na largura de uma folha A4 (794 px), mesmo no celular, e
   quando passa de uma folha corta entre os blocos. As duas bibliotecas vêm do
   cdnjs na hora do primeiro PDF (precisa de internet).
   Uso: pdfLiga(botão, () => elemento, () => 'Nome do arquivo', { aoEntregar(modo) })
   ===================================================== */
'use strict';

const PDF_LIBS = [
  ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
  ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
];
let _pdfLibs = null;
function pdfCarrega() {
  if (window.html2canvas && window.jspdf) return Promise.resolve(true);
  if (_pdfLibs) return _pdfLibs;
  const um = ([nome, url]) => window[nome] ? Promise.resolve() : new Promise((ok, ruim) => {
    const sc = document.createElement('script'); sc.src = url; sc.async = true; sc.crossOrigin = 'anonymous';
    sc.onload = () => ok(); sc.onerror = () => ruim(new Error('sem internet para montar o PDF'));
    document.head.appendChild(sc);
  });
  _pdfLibs = PDF_LIBS.reduce((p, l) => p.then(() => um(l)), Promise.resolve()).then(() => true)
    .catch(e => { _pdfLibs = null; throw e; });
  return _pdfLibs;
}
/* os blocos onde a folha pode virar (o fim de cada um), por documento */
const PDF_BLOCOS = '.od-top,.od-it,.od-opc,.od-sub,.od-cards,.od-total,.od-cond,.od-rod,.od-pe,.od-txtc,.od-sec,' +
  '.fd-topo,.fd-bloco,.fd-tab tr,.fd-tot,.fd-pe,.vo-top,.vo-sec,.vo-pe,.rt-pg,.rt-dia,.rt-parada,.rt-map,.kt-bl,.kt-grade,section,h2,h3,p,li,tr';
function pdfCortes(alturaTotal, folha, fins) {
  const cortes = []; let ini = 0;
  while (alturaTotal - ini > folha + 1) {
    const cabe = fins.filter(y => y > ini + folha * 0.45 && y <= ini + folha);
    const y = cabe.length ? Math.max(...cabe) : ini + folha;
    cortes.push(y); ini = y;
  }
  return cortes;
}
/* 24/11/2026 — PDF EM BRANCO NO IPHONE (apareceu no app de outra guia do estúdio).
   O Safari do iPhone não desenha um canvas acima de ~16,7 milhões de pixels (4096 × 4096) — e não dá
   erro: a imagem simplesmente sai branca. Na escala 2 a folha A4 tem 1588 pixels de largura, então
   qualquer documento com mais de ~4,7 folhas (o kit de uma viagem longa, uma proposta de muitos dias)
   fotografado inteiro de uma vez saía EM BRANCO. Agora:
   - a cópia mede a altura antes de desenhar; se passar do limite, para ali e refaz UMA FOLHA POR VEZ,
     recortada no mesmo lugar onde a folha já virava — mesma nitidez (escala 2) de sempre;
   - uma folha que voltar toda branca vira aviso na tela, nunca um PDF vazio mandado ao cliente.
   O teste no Mac não pegava: o navegador do computador não tem esse limite (testes/pdf-iphone.mjs mede). */
const PDF_LARG = 794;                     /* a folha A4 a 96 dpi */
const PDF_AREA_MAX = 16000000;            /* um pouco abaixo dos 16.777.216 pixels do iPhone */
function pdfOpcoes(el, escala, medida) {
  return {
    scale: escala, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false, windowWidth: 1100,
    onclone: (doc) => {
      const c = el.id ? doc.getElementById(el.id) : null; if (!c) return;
      c.style.width = PDF_LARG + 'px'; c.style.maxWidth = PDF_LARG + 'px'; c.style.margin = '0';
      /* o que só serve na tela (botões, "pagar agora", "pôr na agenda") não vai para o papel */
      c.querySelectorAll('.kt-tela,[data-pdf-fora]').forEach(x => { x.style.display = 'none'; });
      c.querySelectorAll('*').forEach(x => { const cs = doc.defaultView.getComputedStyle(x); if (cs.boxShadow !== 'none') x.style.boxShadow = 'none'; });
      if (!medida) return;
      const topo = c.getBoundingClientRect().top;
      medida.altura = c.getBoundingClientRect().height;
      medida.fins = [...c.querySelectorAll(PDF_BLOCOS)].map(b => b.getBoundingClientRect().bottom - topo).filter(y => y > 0);
      /* grande demais para uma foto só no iPhone: para aqui (antes de desenhar à toa) e refaz folha por folha */
      if (PDF_LARG * medida.altura * escala * escala > PDF_AREA_MAX) throw Object.assign(new Error('grande demais'), { refazer: true });
    },
  };
}
/* a foto voltou vazia? (canvas que passou do limite fica transparente ou todo branco) */
function pdfEmBranco(canvas) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return true;
    const lw = 200, lh = Math.max(8, Math.min(400, Math.round(lw * canvas.height / canvas.width)));
    const p = document.createElement('canvas'); p.width = lw; p.height = lh;
    const g = p.getContext('2d'); g.drawImage(canvas, 0, 0, lw, lh);
    const d = g.getImageData(0, 0, lw, lh).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250)) return false;
    return true;
  } catch (e) { return false; }      /* não deu para olhar: não acusa */
}
const pdfSolta = (c) => { if (c) { c.width = 0; c.height = 0; } };   /* o iPhone também tem teto de memória para canvas */
/* a foto interrompida deixa para trás a cópia escondida da página (um iframe): tira, para não pesar no celular */
const pdfTiraCopias = () => document.querySelectorAll('iframe.html2canvas-container').forEach(f => f.remove());
/* onde a folha vira: o fim de um bloco que caiba na folha */
function pdfLimites(alturaTotal, folhaCss, fins) {
  const cortes = pdfCortes(alturaTotal, folhaCss, fins);
  return [0, ...cortes, alturaTotal];
}
async function pdfDoElemento(el, nome, aoAndar) {
  await pdfCarrega();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const medida = {}, folhaCss = PDF_LARG * H / W;
  let canvas = null;
  try { canvas = await window.html2canvas(el, pdfOpcoes(el, 2, medida)); }
  catch (e) { if (!e || !e.refazer || !medida.altura) throw e; pdfTiraCopias(); }
  if (canvas) {
    if (pdfEmBranco(canvas)) { pdfSolta(canvas); throw new Error('o documento saiu em branco'); }
    const pxPorCss = canvas.width / PDF_LARG;
    const altura = medida.altura || canvas.height / pxPorCss;
    /* passou só um pouquinho de uma folha: encolhe para caber numa (o modelo dela é de 1 folha) */
    if (altura > folhaCss && altura <= folhaCss * 1.12) {
      const k = folhaCss / altura;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (W - W * k) / 2, 0, W * k, H);
    } else {
      const limites = pdfLimites(altura, folhaCss, medida.fins || []);
      for (let i = 0; i < limites.length - 1; i++) {
        const y0 = Math.round(limites[i] * pxPorCss), y1 = Math.min(canvas.height, Math.round(limites[i + 1] * pxPorCss));
        if (y1 - y0 < 4) continue;
        const fatia = document.createElement('canvas'); fatia.width = canvas.width; fatia.height = y1 - y0;
        const g = fatia.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, fatia.width, fatia.height);
        g.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
        if (i) pdf.addPage();
        pdf.addImage(fatia.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, (y1 - y0) / pxPorCss * W / PDF_LARG);
        pdfSolta(fatia);
      }
    }
    pdfSolta(canvas);
  } else {
    /* grande demais para uma foto só no iPhone: uma foto por folha, recortada no mesmo lugar onde
       a folha viraria — mesma nitidez (escala 2) de sempre */
    const limites = pdfLimites(medida.altura, folhaCss, medida.fins || []), n = limites.length - 1;
    let pag = 0;
    for (let i = 0; i < n; i++) {
      const y0 = limites[i], alt = limites[i + 1] - y0; if (alt < 2) continue;
      if (aoAndar) aoAndar(i + 1, n);
      const c = await window.html2canvas(el, { ...pdfOpcoes(el, 2, null), y: y0, width: PDF_LARG, height: Math.ceil(alt) });
      if (pdfEmBranco(c)) { pdfSolta(c); throw new Error(`a folha ${i + 1} de ${n} saiu em branco`); }
      if (pag++) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, c.height / c.width * W);
      pdfSolta(c);
    }
  }
  const arquivo = String(nome || 'documento').replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf';
  const blob = pdf.output('blob');
  return { blob, arquivo, file: (typeof File === 'function') ? new File([blob], arquivo, { type: 'application/pdf' }) : null };
}
const pdfCelular = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function pdfBaixa(r) {
  const url = URL.createObjectURL(r.blob), a = document.createElement('a');
  a.href = url; a.download = r.arquivo; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function pdfPodeCompartilhar(r) { try { return !!(r.file && navigator.canShare && navigator.canShare({ files: [r.file] })); } catch (e) { return false; } }

/* liga um botão "Gerar PDF": gera, e mostra embaixo dele o que fazer com o arquivo */
function pdfLiga(botao, alvo, nome, opts) {
  if (!botao) return;
  opts = opts || {};
  pdfCss();
  const rotulo = botao.textContent;
  const entregou = (modo) => { if (opts.aoEntregar) { try { opts.aoEntregar(modo); } catch (e) {} } };
  botao.onclick = async () => {
    const el = typeof alvo === 'function' ? alvo() : alvo; if (!el) return;
    if (opts.antes) { try { await opts.antes(); } catch (e) {} }
    botao.disabled = true; botao.textContent = 'Preparando o PDF…';
    let painel = document.getElementById('pdfPronto');
    if (!painel) { painel = document.createElement('div'); painel.id = 'pdfPronto'; painel.className = 'pdfPronto'; (botao.closest('.ktBarra,.doc-barra,header,.topbar') || botao.parentNode).insertAdjacentElement('afterend', painel); }
    painel.hidden = false; painel.innerHTML = '<p>Preparando o PDF… (1 ou 2 segundos)</p>';
    try {
      const r = await pdfDoElemento(el, typeof nome === 'function' ? nome() : nome,
        (i, n) => { if (n > 1) painel.innerHTML = `<p>Preparando o PDF… folha ${i} de ${n}</p>`; });
      const share = pdfCelular() && pdfPodeCompartilhar(r);
      painel.innerHTML = `<p><b>PDF pronto:</b> ${esc(r.arquivo)}</p>
        <div class="pdfAcs">${share ? '<button type="button" class="cta sm" data-pdf="enviar">Enviar (WhatsApp, e-mail…)</button>' : ''}
          <button type="button" class="${share ? 'mini' : 'cta sm'}" data-pdf="baixar">Baixar o arquivo</button>
          <button type="button" class="mini" data-pdf="abrir">Abrir o PDF</button></div>
        ${share ? '' : `<p class="why">${pdfCelular() ? 'Baixe e mande pelo WhatsApp (clipe → Documento).' : 'O arquivo foi para a pasta Downloads. No WhatsApp: clipe → Documento.'}</p>`}`;
      const q = (k) => painel.querySelector(`[data-pdf="${k}"]`);
      if (q('enviar')) q('enviar').onclick = async () => {
        try { await navigator.share({ files: [r.file], title: r.arquivo.replace(/\.pdf$/, ''), text: opts.texto ? opts.texto() : '' }); entregou('enviado'); }
        catch (e) { if (!e || e.name !== 'AbortError') { toast('Não abriu o compartilhar — baixei o arquivo'); pdfBaixa(r); entregou('baixado'); } }
      };
      q('baixar').onclick = () => { pdfBaixa(r); entregou('baixado'); };
      q('abrir').onclick = () => { const u = URL.createObjectURL(r.blob); if (!window.open(u, '_blank')) location.href = u; };
      if (!share) { pdfBaixa(r); entregou('baixado'); }
    } catch (e) {
      painel.innerHTML = `<p class="pdfErro">Não consegui montar o PDF: ${esc((e && e.message) || 'erro')}. Confira a internet e toque de novo.</p>`;
    } finally { botao.disabled = false; botao.textContent = rotulo; }
  };
}
function pdfCss() {
  if (document.getElementById('pdfCss')) return;
  const s = document.createElement('style'); s.id = 'pdfCss';
  s.textContent = `
  .pdfPronto{max-width:794px;margin:0 auto 14px;padding:12px 16px;border-radius:14px;background:var(--accent-wash);color:var(--ink);font-size:14px}
  .pdfPronto p{margin:0}
  .pdfPronto .pdfAcs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .pdfPronto .why{margin-top:8px}
  .pdfPronto .pdfErro{color:var(--danger)}
  @media print{.pdfPronto{display:none!important}}`;
  document.head.appendChild(s);
}
