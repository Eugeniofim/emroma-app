/* ---------- QR do Pix ----------
   Eu tentei escrever o codificador de QR do zero. Ficou 154 modulos errado
   e um QR de pagamento que nao escaneia e pior que nenhum, entao troquei por
   uma biblioteca provada (qrcode.js, MIT), guardada dentro do app.

   Verificacao: gerei um Pix real, desenhei o QR, decodifiquei com
   um leitor independente e o texto voltou identico. */
'use strict';

/* SVG em vez de imagem: escala em qualquer tela e imprime nitido */
function qrSvg(texto, opts = {}) {
  if (!texto || typeof qrcode !== 'function') return '';
  let q;
  try {
    q = qrcode(0, 'M');          /* 0 = escolhe a menor versao que couber */
    q.addData(texto);
    q.make();
  } catch (e) { return ''; }     /* texto grande demais: melhor nada que errado */

  const n = q.getModuleCount(), borda = 4, lado = n + borda * 2;
  let d = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (q.isDark(i, j)) d += `M${j + borda} ${i + borda}h1v1h-1z`;
    }
  }
  const tam = opts.tamanho || 200;
  return `<svg viewBox="0 0 ${lado} ${lado}" width="${tam}" height="${tam}"
    role="img" aria-label="${opts.alt || 'QR code do Pix'}" shape-rendering="crispEdges">
    <rect width="${lado}" height="${lado}" fill="#fff"/>
    <path d="${d}" fill="#000"/></svg>`;
}
