/* =====================================================
   APP-GUIA — marca
   Marca neutra do produto: um anel com a inicial do negocio. O guia troca
   pelo logotipo proprio depois; o codigo nao carrega a marca de ninguem.
   ===================================================== */
'use strict';

function _lgEsc(x) { return String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function marcaInicial() {
  const n = ((typeof guiaNegocio === 'function' && guiaNegocio()) || 'G').trim();
  return (n[0] || 'G').toUpperCase();
}

/* simbolo — para icones, selos e cabecalhos */
/* Se o guia tem logotipo proprio no config, e ele que aparece — o anel com
   a inicial e so o comeco, para quem ainda nao mandou a arte.

   Vao os DOIS arquivos, e o CSS escolhe. O fundo do cabecalho e o --paper,
   que vira escuro no tema escuro: um selo branco fixo sumiria no tema claro
   e um selo vinho fixo sumiria no escuro. */
function logoImg(height, cls) {
  const g = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {};
  if (!g.logo) return '';
  const claro  = g.logoEscuro || g.logo;   /* selo escuro, para fundo claro */
  const escuro = g.logo;                   /* selo branco, para fundo escuro */
  const st = `width:${height}px;height:${height}px;object-fit:contain`;
  return `<span class="vilogo ${cls || ''}">` +
    `<img class="lg-claro"  src="${_lgEsc(claro)}"  alt="" aria-hidden="true" style="${st}">` +
    `<img class="lg-escuro" src="${_lgEsc(escuro)}" alt="" aria-hidden="true" style="${st}">` +
    `</span>`;
}

function logoMark(height = 40, color = '#FFD23F', opts = {}) {
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  const img = logoImg(height, opts.cls);
  if (img) return img;
  return `<svg${cls} viewBox="0 0 100 100" width="${height}" height="${height}" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="none" stroke="${color}" stroke-width="7"/>
    <text x="50" y="50" dy=".36em" font-size="46" text-anchor="middle" fill="${color}"
      font-family="Montserrat, sans-serif" font-weight="700">${marcaInicial()}</text>
  </svg>`;
}

/* simbolo + nome do negocio — cabecalhos e o hub */
function logoFull(opts = {}) {
  const { mark = 30, color = 'var(--brand-assinatura)', sub = '' } = opts;
  const nome = (typeof guiaNegocio === 'function' && guiaNegocio()) || '';
  return `<span class="vi-logo">
    <span class="vi-mark">${logoMark(mark, color)}</span>
    <span class="vi-word">
      <b>${_lgEsc(nome)}</b>
      ${sub ? `<small>${sub}</small>` : ''}
    </span>
  </span>`;
}

/* logotipo completo, empilhado */
function logoLockup(markHeight = 150) {
  const nome = (typeof guiaNegocio === 'function' && guiaNegocio()) || '';
  const base = (typeof guiaBase === 'function' && guiaBase()) || '';
  return `<div class="lockup">
    <div class="lk-mark">${logoMark(markHeight, 'var(--brand-assinatura)', { cls: 'lg-draw' })}</div>
    <div class="lk-word">${_lgEsc(nome)}</div>
    ${base ? `<div class="lk-region">${_lgEsc(base)}</div>` : ''}
    <div class="lk-lang">PT <span>|</span> EN</div>
  </div>`;
}
