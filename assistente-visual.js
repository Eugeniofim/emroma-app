/* =====================================================
   ASSISTENTE — o VISUAL do TI ARTES / Carol, com o CÉREBRO da Ingrid
   (pedido do Eugênio, 08/10/2026: "usar o layout do nosso melhor assistente,
   tipo da Carol, mas mantenha o cérebro desse como está").

   É só pele: nada de ferramentas, prompt, memória, dinheiro, voz ou crédito
   muda. Este arquivo roda DEPOIS de assistente-ingrid.js e, a cada desenho
   da gaveta, veste o mesmo DOM com:
   - gaveta escura da marca (vinho) e bolhas com avatar;
   - o ORBE vivo (skill orbe-de-voz) no topo e grande na tela vazia, que
     acompanha "ouvindo / pensando / falando";
   - "Oi, Ingrid." + as sugestões em cartões na conversa vazia;
   - a engrenagem ⚙ no topo com o que era rodapé (ler em voz alta,
     confirmar antes, nova conversa, créditos).
   ===================================================== */
'use strict';
const Orbe = window.Orbe = window.Orbe || (function () {
  const FRAG = `precision highp float;
uniform vec2 uRes; uniform float uT, uNivel, uGraves, uAgudos, uVisc, uBrilho; uniform vec3 uCor, uCor2, uFundo;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
float sunir(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float campo(vec2 p,float t){
 float ag=mix(.35,1.25,uVisc);
 vec2 w=vec2(fbm(p*1.55+vec2(0.,t*.17*ag)),fbm(p*1.55+vec2(5.2,-t*.13*ag)));
 float amp=.085+.20*uNivel+.05*uAgudos; vec2 q=p+(w-.5)*amp*2.6;
 float R=.56+.055*sin(t*.55)+.11*uGraves+.05*uNivel; float d=length(q)-R;
 for(int i=0;i<3;i++){ float fi=float(i); float a=t*(.21+fi*.085)+fi*2.2;
  float rr=.30+.085*sin(t*.42+fi*1.7)+.10*uNivel; vec2 c=vec2(cos(a),sin(a*1.21))*rr;
  float rl=.20+.055*cos(t*.63+fi)+.075*uNivel; d=sunir(d,length(q-c)-rl,.34); }
 d+=(fbm(q*5.4+t*.5)-.5)*(.018+.055*uAgudos); return d;}
void main(){
 vec2 fc=gl_FragCoord.xy; vec2 p=(fc-.5*uRes)/min(uRes.x,uRes.y)*2.;
 float t=uT, d=campo(p,t); float e=2.2/min(uRes.x,uRes.y);
 float dx=campo(p+vec2(e,0.),t)-campo(p-vec2(e,0.),t); float dy=campo(p+vec2(0.,e),t)-campo(p-vec2(0.,e),t);
 vec3 n=normalize(vec3(dx,dy,e*1.55)); float dentro=smoothstep(.012,-.030,d);
 float fres=pow(1.-clamp(n.z,0.,1.),2.6); vec3 luz=normalize(vec3(-.45,.62,.65));
 float dif=clamp(dot(n,luz)*.5+.5,0.,1.); float esp=pow(clamp(dot(reflect(-luz,n),vec3(0.,0.,1.)),0.,1.),22.);
 float fil=smoothstep(.42,.86,fbm(p*3.1-vec2(t*.22,t*.16)));
 vec3 o=uCor*(.14+.34*dif); o=mix(o,uCor2,fil*(.55+.35*uNivel)); o+=uCor*fil*.18*uNivel;
 o+=mix(uCor,vec3(1.),.50)*fres*(.85+1.00*uNivel); o+=vec3(1.)*esp*.34;
 float sep=fres*.09; o.r+=sep; o.b-=sep*.6; o*=.62+.9*uBrilho;
 o=o/(o+vec3(.85)); o=pow(o,vec3(1./2.2));
 float halo=exp(-max(d,0.)*mix(7.5,3.4,uBrilho))*(.16+.55*uNivel)*(.4+uBrilho);
 vec3 h=pow(uCor/(uCor+vec3(.85)),vec3(1./2.2));
 vec3 col=mix(uFundo,h,clamp(halo*1.3,0.,.85)); col=mix(col,o,dentro);
 col+=(hash(fc+fract(t))-.5)/255.; gl_FragColor=vec4(col,1.);}`;
  const ESTADOS = { repouso: [.45, .50, .35], ouvindo: [.30, .72, .55], pensando: [.92, .62, .45], falando: [.62, .78, 1.0] };
  const lin = (hex) => hex.replace('#', '').match(/../g).map(x => { const c = parseInt(x, 16) / 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); });
  const srgb = (hex) => hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255);
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const O = { nivel: 0, graves: 0, agudos: 0, _alvo: 0, _gl: null, _cv: null, _u: {}, _t: 0, _ult: 0, _visc: .45, _bri: .5, _estado: 'repouso',
    _cor: lin('#E8C08A'), _cor2: lin('#7A1E2E'), _fundo: srgb('#241417'), _fala: 0, _mic: null };
  O.montar = function (cv) {
    if (O._cv === cv && O._gl) return true;
    const gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false }); if (!gl) return false;
    const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['uRes', 'uT', 'uNivel', 'uGraves', 'uAgudos', 'uVisc', 'uBrilho', 'uCor', 'uCor2', 'uFundo']) O._u[k] = gl.getUniformLocation(pr, k);
    O._gl = gl; O._cv = cv;
    if (!O._rodando) { O._rodando = true; requestAnimationFrame(O._quadro); }
    return true;
  };
  O.cor = (hex) => { O._cor = lin(hex); };
  O.fundo = (hex) => { O._fundo = srgb(hex); };
  O.estado = (e) => { O._estado = ESTADOS[e] ? e : 'repouso'; };
  /* fala sintética: sílabas por seno com piso cortado (skill orbe-de-voz) */
  O.falar = (ms) => { O._fala = performance.now() + (ms || 3000); O.estado('falando'); };
  O.calar = () => { O._fala = 0; O.estado('repouso'); };
  O.pulso = (v) => { O._alvo = Math.max(O._alvo, v); };
  O._quadro = (agora) => {
    requestAnimationFrame(O._quadro);
    const gl = O._gl, cv = O._cv;
    if (!gl || !cv || document.hidden || !cv.isConnected || !cv.offsetWidth) { O._ult = agora; return; }
    let dt = Math.min(1 / 20, (agora - (O._ult || agora)) / 1000); O._ult = agora;
    const dpr = Math.min(1.75, devicePixelRatio || 1), W = Math.round(cv.offsetWidth * dpr), H = Math.round(cv.offsetHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; gl.viewport(0, 0, W, H); }
    O._t += dt * (reduz ? .18 : 1);
    /* o alvo do nível: microfone de verdade, ou o envelope de fala, ou nada */
    let alvo = O._alvo; O._alvo *= .86;
    if (O._mic) {
      const { an, buf } = O._mic; an.getFloatTimeDomainData(buf);
      let s = 0; for (const v of buf) s += v * v; alvo = Math.min(1, Math.sqrt(s / buf.length) * 7);
    } else if (O._fala > agora) {
      const x = O._t * 9.5, sil = Math.pow(Math.max(0, Math.sin(x) * .5 + .5 - .12) / .88, 1.4);
      alvo = Math.max(alvo, sil * (.55 + .35 * Math.sin(O._t * 2.3)) + Math.random() * .08);
    } else if (O._fala && O._estado === 'falando') O.calar();
    if (reduz) alvo *= .35;
    const lento = 1 - Math.pow(0.0016, dt), rapido = 1 - Math.pow(0.055, dt);
    O.nivel += (alvo - O.nivel) * (alvo > O.nivel ? rapido : lento);
    O.graves += (alvo * .8 - O.graves) * lento; O.agudos += (alvo * .6 - O.agudos) * (alvo > O.agudos ? rapido : lento);
    const [v, b] = ESTADOS[O._estado]; O._visc += (v - O._visc) * lento; O._bri += (b - O._bri) * lento;
    const u = O._u;
    gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uT, O._t); gl.uniform1f(u.uNivel, O.nivel); gl.uniform1f(u.uGraves, O.graves);
    gl.uniform1f(u.uAgudos, O.agudos); gl.uniform1f(u.uVisc, O._visc); gl.uniform1f(u.uBrilho, O._bri);
    gl.uniform3fv(u.uCor, O._cor); gl.uniform3fv(u.uCor2, O._cor2); gl.uniform3fv(u.uFundo, O._fundo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  /* microfone medindo o nível enquanto ela fala — nunca ligado ao alto-falante (microfonia) */
  O.ouvirMicrofone = async () => {
    if (O._mic || !navigator.mediaDevices) return;
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = .72;
    ctx.createMediaStreamSource(fluxo).connect(an);
    O._mic = { ctx, an, fluxo, buf: new Float32Array(an.fftSize) }; O.estado('ouvindo');
  };
  O.fecharMicrofone = () => {
    if (!O._mic) return; try { O._mic.fluxo.getTracks().forEach(t => t.stop()); O._mic.ctx.close(); } catch (e) {}
    O._mic = null; if (O._estado === 'ouvindo') O.estado('repouso');
  };
  return O;
})();

const IAVG_ENG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
let iavgMenu = false;
/* veste a gaveta (roda depois de cada desenho do cérebro) */
function iavgVeste() {
  const g = iaEl && iaEl.g; if (!g) return;
  g.classList.add('iav');
  const cab = g.querySelector('header'), corpo = g.querySelector('#iaCorpo'), msgs = g.querySelector('#iaMsgs');
  if (!cab || !corpo || !msgs) return;
  /* topo: orbe pequeno + engrenagem */
  if (!cab.querySelector('#iavOrbeTopo')) cab.insertAdjacentHTML('afterbegin', '<span class="iavOrbeTopo" id="iavOrbeTopo"></span>');
  const fecha = cab.querySelector('#iaFecha');
  if (fecha && !cab.querySelector('#iavEng')) {
    fecha.insertAdjacentHTML('beforebegin', `<button type="button" class="iavIco" id="iavEng" aria-label="Ajustes do assistente" title="Ajustes do assistente">${IAVG_ENG}</button>`);
    cab.querySelector('#iavEng').onclick = () => { iavgMenu = !iavgMenu; iavgPintaMenu(); };
  }
  /* a engrenagem guarda o rodapé (os MESMOS elementos: os botões continuam funcionando) */
  let menu = corpo.querySelector('#iavMenu');
  if (!menu) { corpo.insertAdjacentHTML('afterbegin', '<div id="iavMenu" hidden></div>'); menu = corpo.querySelector('#iavMenu'); }
  const pe = corpo.querySelector('#iaPe');
  if (pe && pe.parentNode !== menu) menu.appendChild(pe);
  iavgPintaMenu();
  /* conversa vazia: orbe grande + "Oi, Ingrid." (as sugestões do cérebro viram cartões) */
  const temConversa = !!msgs.querySelector('.iaB.user');
  let hero = msgs.querySelector('#iavHero');
  if (!temConversa && !hero) {
    const nome = (typeof guiaNome === 'function' && guiaNome()) || 'Ingrid';
    msgs.insertAdjacentHTML('afterbegin', `<div class="iavHero" id="iavHero"><div class="iavOrbeGrande" id="iavOrbeLugar"></div>
      <h2>Oi, ${esc(String(nome).split(' ')[0])}.</h2><p>Fale ou escreva. Eu mexo em todas as abas — e mostro antes de gravar.</p></div>`);
    hero = msgs.querySelector('#iavHero');
  } else if (temConversa && hero) { hero.remove(); hero = null; }
  g.classList.toggle('iav-vazio', !temConversa);
  /* o orbe mora no herói (vazio) ou no topo (conversando) */
  const lugar = (hero && hero.querySelector('#iavOrbeLugar')) || cab.querySelector('#iavOrbeTopo');
  cab.querySelector('#iavOrbeTopo').classList.toggle('vazio', !!hero);
  let cv = document.getElementById('iavOrbe');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'iavOrbe'; cv.setAttribute('aria-hidden', 'true'); }
  if (cv.parentNode !== lugar) lugar.appendChild(cv);
  try { if (!Orbe.montar(cv)) cv.classList.add('semGl'); } catch (e) { cv.classList.add('semGl'); }
}
function iavgPintaMenu() {
  const g = iaEl && iaEl.g, m = g && g.querySelector('#iavMenu'); if (!m) return;
  m.hidden = !iavgMenu;
  const b = g.querySelector('#iavEng'); if (b) b.classList.toggle('on', iavgMenu);
}
/* o orbe acompanha o cérebro: ouvindo / pensando / falando */
if (typeof ingOrbe === 'function') {
  const _ingOrbeBase = ingOrbe;
  ingOrbe = function (estado, liga) {
    _ingOrbeBase(estado, liga);
    try {
      if (estado === 'fala') { if (liga) Orbe.falar(60000); else Orbe.calar(); }
      else if (estado === 'pensa') Orbe.estado(liga ? 'pensando' : 'repouso');
      else if (estado === 'ouve') Orbe.estado(liga ? 'ouvindo' : 'repouso');
    } catch (e) {}
  };
}
const _iavgDesenha = iaDesenha;
iaDesenha = function () { const r = _iavgDesenha.apply(this, arguments); try { iavgVeste(); } catch (e) {} return r; };
const _iavgBolha = iaBolha;
iaBolha = function () { const r = _iavgBolha.apply(this, arguments); try { const g = iaEl && iaEl.g; if (g && g.querySelector('#iaMsgs .iaB.user')) iavgVeste(); } catch (e) {} return r; };

/* as cores da EmRoma no visual TI ARTES: fundo vinho escuro, orbe dourado */
(function () {
  const css = `
#iaGaveta.iav{--v-bg:#241417;--v-s1:#311c21;--v-s2:#3d252b;--v-line:rgba(232,192,138,.16);--v-tx:#FFF6F2;--v-tx2:#DCCBC4;--v-tx3:#AE9A93;--v-sky:#E8C08A;--v-lov:#7A1E2E;
  background:var(--v-bg)!important;color:var(--v-tx);border-left:1px solid var(--v-line)}
#iaGaveta.iav header{border-bottom:0;padding:12px 8px 4px 14px;gap:10px;align-items:center;background:transparent}
#iaGaveta.iav header .iaAv{display:none}
#iaGaveta.iav header b,#iaGaveta.iav #iaTit{color:var(--v-tx);font-size:20px}
#iaGaveta.iav .iaModo{color:var(--v-sky)}
#iaGaveta.iav #iaCtx{border:0;color:var(--v-tx3);font-size:12.5px}
#iaGaveta.iav .x{color:var(--v-tx2);border-radius:12px;background:transparent;border:0}
#iaGaveta.iav .x:hover,#iaGaveta.iav .iavIco:hover{background:var(--v-s2);color:var(--v-tx)}
#iaGaveta.iav .iavOrbeTopo{width:42px;height:42px;flex:none;border-radius:50%;overflow:hidden}
#iaGaveta.iav .iavOrbeTopo.vazio{display:none}
#iavOrbe{width:100%;height:100%;display:block;border-radius:50%}
#iavOrbe.semGl{background:radial-gradient(circle at 40% 35%,#FFF6F2 0,#E8C08A 30%,#7A1E2E 70%,transparent 72%)}
#iaGaveta.iav .iavIco{width:44px;height:44px;flex:none;border:0;border-radius:12px;background:transparent;color:var(--v-tx2);display:grid;place-items:center;cursor:pointer}
#iaGaveta.iav .iavIco svg{width:20px;height:20px}
#iaGaveta.iav .iavIco.on{color:var(--v-sky);background:rgba(232,192,138,.12)}
#iaGaveta.iav .ingPalco{display:none!important}
#iaGaveta.iav #iaMsgs{background:transparent!important;padding:6px 16px 16px;gap:14px;scrollbar-width:thin;scrollbar-color:var(--v-s2) transparent}
#iaGaveta.iav #iaCorpo,#iaGaveta.iav #iaMsgs{color:var(--v-tx)}
.iavHero{text-align:center;padding:10px 0 4px}
.iavOrbeGrande{width:150px;height:150px;margin:0 auto 6px}
.iavHero h2{font-family:var(--f-display);font-weight:600;font-size:30px;line-height:1.1;margin:4px 0 6px;color:var(--v-tx)}
.iavHero p{color:var(--v-tx2);font-size:14px;line-height:1.45;margin:0 auto 10px;max-width:320px}
#iaGaveta.iav .iaB{font-size:15px;line-height:1.5;border-radius:16px;max-width:88%}
#iaGaveta.iav .iaB.assistant{position:relative;margin-left:38px;max-width:calc(100% - 38px);background:var(--v-s1)!important;color:var(--v-tx)!important;border:1px solid var(--v-line);border-top-left-radius:4px;box-shadow:none}
#iaGaveta.iav .iaB.assistant::before{content:"E";position:absolute;left:-38px;top:0;width:30px;height:30px;border-radius:50%;background:var(--v-lov);color:var(--v-sky);display:grid;place-items:center;font:700 14px var(--f-display)}
#iaGaveta.iav .iaB.user{background:var(--v-lov)!important;color:var(--v-tx)!important;border:0;border-bottom-right-radius:4px}
#iaGaveta.iav .iaB.pensa{color:var(--v-tx3);margin-left:38px;background:transparent!important;border:0}
#iaGaveta.iav .iaB.erro{background:rgba(240,144,156,.1)!important;color:#F0A6B0!important;border:1px solid rgba(240,144,156,.25)}
#iaGaveta.iav .iaB b{color:#fff}
#iaGaveta.iav .iaB a{color:var(--v-sky)}
#iaGaveta.iav .iaB button,#iaGaveta.iav .iaB .copiar{background:transparent;border:1px solid var(--v-line);color:var(--v-tx2);border-radius:99px}
#iaGaveta.iav .iaDemo,#iaGaveta.iav .iaSug{border-color:var(--v-line);color:var(--v-tx2);background:rgba(232,192,138,.05)}
#iaGaveta.iav .iaDemo b{color:var(--v-sky)}
#iaGaveta.iav .iaCard{background:var(--v-s2)!important;border:1.5px solid var(--v-sky)!important;color:var(--v-tx)!important}
#iaGaveta.iav .iaCard h4,#iaGaveta.iav .iaCard dd{color:var(--v-tx)!important}
#iaGaveta.iav .iaCard dt,#iaGaveta.iav .iaCard .ass{color:var(--v-tx3)!important}
#iaGaveta.iav .iaCard .bts button{background:transparent;border:1px solid var(--v-line);color:var(--v-tx)}
#iaGaveta.iav .iaCard .bts .sim{background:var(--v-sky)!important;color:#2a1a1d!important;border-color:transparent}
/* sugestões: cartões na conversa vazia, chips quando já está conversando */
#iaGaveta.iav .iaBarra{background:transparent}
#iaGaveta.iav .iaBarra button,#iaGaveta.iav .iaBarra a{background:var(--v-s1)!important;border:1px solid var(--v-line)!important;color:var(--v-tx)!important}
#iaGaveta.iav .iaBarra button:hover{border-color:var(--v-sky)!important}
#iaGaveta.iav.iav-vazio .iaBarra{display:grid!important;grid-template-columns:1fr 1fr;gap:8px;overflow:visible;padding:4px 14px 10px}
#iaGaveta.iav.iav-vazio .iaBarra button,#iaGaveta.iav.iav-vazio .iaBarra a{min-height:60px;padding:10px 12px;border-radius:14px!important;white-space:normal;text-align:left;line-height:1.3;font-size:13.5px;justify-content:flex-start}
/* a caixa de escrever */
#iaGaveta.iav #iaForm{margin:0 10px calc(10px + env(safe-area-inset-bottom));padding:5px;border:1px solid var(--v-line)!important;border-radius:18px;background:var(--v-s1)!important;gap:4px;align-items:flex-end}
#iaGaveta.iav #iaForm:focus-within{border-color:rgba(232,192,138,.55)!important;box-shadow:0 0 0 4px rgba(232,192,138,.08)}
#iaGaveta.iav #iaTxt{background:transparent!important;border:0!important;color:var(--v-tx)!important;min-height:44px;font-size:16px;box-shadow:none;outline:none;-webkit-appearance:none}
#iaGaveta.iav #iaTxt::placeholder{color:var(--v-tx3)}
#iaGaveta.iav #iaForm button{color:var(--v-tx2)}
#iaGaveta.iav #iaEnviar{background:var(--v-sky)!important;color:#2a1a1d!important;border:0;border-radius:12px}
#iaGaveta.iav #iaForm .ingFala,#iaGaveta.iav #iaForm [id*="Fala"],#iaGaveta.iav #iaForm [id*="Mic"]{background:var(--v-s2)!important;color:var(--v-tx)!important;border:1px solid var(--v-line)!important;border-radius:12px}
#iaGaveta.iav #iaAnexo{color:var(--v-tx2)}
/* engrenagem */
#iavMenu{padding:8px 16px 12px;border-bottom:1px solid var(--v-line);background:var(--v-s1);max-height:60vh;overflow:auto}
#iavMenu[hidden]{display:none}
#iavMenu #iaPe{display:flex!important;flex-direction:column;align-items:flex-start;gap:10px;background:transparent!important;border:0!important;padding:4px 0!important;font-size:14px!important;color:var(--v-tx2)}
#iavMenu #iaPe label{display:flex;gap:10px;align-items:center;min-height:36px;color:var(--v-tx)}
#iavMenu #iaPe input[type=checkbox]{width:20px!important;height:20px!important;accent-color:#E8C08A}
#iavMenu #iaPe button{font-size:14px!important;color:var(--v-sky)!important;background:none;border:0;text-decoration:underline;padding:6px 0!important}
/* crédito da IA no escuro */
#iaGaveta.iav .ingGasto{background:var(--v-s1);border-color:var(--v-line);color:var(--v-tx2)}
#iaGaveta.iav .ingG-topo b,#iaGaveta.iav .ingG-linha b{color:var(--v-tx)}
#iaGaveta.iav .ingG-barra{background:var(--v-s2)}
#iaGaveta.iav .ingG-acoes button,#iaGaveta.iav .ingG-info{color:var(--v-sky)}
body.ia-dock #iaGaveta.iav{background:var(--v-bg)!important}
#iaGaveta.iav .iaSug,#iaGaveta.iav .iaSug *{background:transparent!important;color:var(--v-tx3)!important;border-color:var(--v-line)!important}
#iaGaveta.iav #iaClip,#iaGaveta.iav #iaForm button:not(#iaEnviar){background:var(--v-s2)!important;color:var(--v-tx2)!important;border:1px solid var(--v-line)!important}
#iaGaveta.iav #iaAnexo,#iaGaveta.iav #iaAnexo *{background-color:transparent}
`;
  const st = document.createElement('style'); st.id = 'iavgCss'; st.textContent = css; document.head.appendChild(st);
})();
