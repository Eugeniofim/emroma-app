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
async function pdfDoElemento(el, nome) {
  await pdfCarrega();
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  const LARG = 794;                       /* a folha A4 a 96 dpi */
  let fins = [], altura = 0;
  const canvas = await window.html2canvas(el, {
    scale: 2, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false, windowWidth: 1100,
    onclone: (doc) => {
      const c = el.id ? doc.getElementById(el.id) : null; if (!c) return;
      c.style.width = LARG + 'px'; c.style.maxWidth = LARG + 'px'; c.style.margin = '0';
      /* o que só serve na tela (botões, "pagar agora", "pôr na agenda") não vai para o papel */
      c.querySelectorAll('.kt-tela,[data-pdf-fora]').forEach(x => { x.style.display = 'none'; });
      c.querySelectorAll('*').forEach(x => { const cs = doc.defaultView.getComputedStyle(x); if (cs.boxShadow !== 'none') x.style.boxShadow = 'none'; });
      const topo = c.getBoundingClientRect().top;
      altura = c.getBoundingClientRect().height;
      fins = [...c.querySelectorAll(PDF_BLOCOS)].map(b => b.getBoundingClientRect().bottom - topo).filter(y => y > 0);
    },
  });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const pxPorCss = canvas.width / LARG, folhaCss = LARG * H / W;
  altura = altura || canvas.height / pxPorCss;
  /* passou só um pouquinho de uma folha: encolhe para caber numa (o modelo dela é de 1 folha) */
  if (altura > folhaCss && altura <= folhaCss * 1.12) {
    const k = folhaCss / altura;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (W - W * k) / 2, 0, W * k, H);
  } else {
    const cortes = pdfCortes(altura, folhaCss, fins), limites = [0, ...cortes, altura];
    for (let i = 0; i < limites.length - 1; i++) {
      const y0 = Math.round(limites[i] * pxPorCss), y1 = Math.min(canvas.height, Math.round(limites[i + 1] * pxPorCss));
      if (y1 - y0 < 4) continue;
      const fatia = document.createElement('canvas'); fatia.width = canvas.width; fatia.height = y1 - y0;
      const g = fatia.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, fatia.width, fatia.height);
      g.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
      if (i) pdf.addPage();
      pdf.addImage(fatia.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, (y1 - y0) / pxPorCss * W / LARG);
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
      const r = await pdfDoElemento(el, typeof nome === 'function' ? nome() : nome);
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
