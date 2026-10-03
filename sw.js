/* Service worker — app-guia
   Estratégia: rede primeiro (o app novo chega sempre que houver internet),
   cache como reserva (o app abre mesmo sem internet).
   Para publicar uma atualização: subir os arquivos novos e trocar a VERSION. */
'use strict';

const VERSION = 'ingrid-v1.105.0';
const CORE = [
  './', './index.html', './config.js', './app.js', './fx.js', './pix.js', './qr.js', './qrcode.js', './traduz.js', './store.js', './auth.js', './logo.js', './cloud.js', './nuvem-itens.js', './i18n.js', './operacao.js', './operacao-telas.js', './precos.js', './assistente.js', './assistente-ingrid.js', './tokens.css', './operacao.css', './manifest.webmanifest', './capa.jpg', './home.jpg', './og.jpg', './guia.jpg',
  /* a arte da Ingrid: o selo e as capas do portfolio. Vao para o cache
     porque sao a cara do app — sem elas, offline, a vitrine fica cinza. */
  './arte/avatar-ingrid.jpg', './arte/capa-conexao.jpg', './arte/capa-cruzeiro.jpg',
  './arte/capa-marca.jpg', './arte/capa-roma.jpg', './arte/capa-transfer.jpg',
  './arte/foto-amalfi.jpg', './arte/foto-assis.jpg', './arte/foto-bracciano.jpg',
  './arte/foto-castelli.jpg', './arte/foto-civita.jpg', './arte/foto-pompeia.jpg',
  './arte/foto-tivoli.jpg', './arte/foto-toscana-norte.jpg', './arte/foto-toscana-sul.jpg',
  './arte/logo-ingrid-escuro.png', './arte/logo-ingrid.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      /* so as versoes antigas deste app: a demonstracao mora no mesmo endereco
         e tem o cache dela */
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ingrid-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  /* O GitHub manda o index.html com max-age=600: o navegador guarda a pagina
     por 10 minutos e continua servindo a versao velha mesmo com recarga
     forcada. Para a pagina e para o codigo do app, furamos esse cache. */
  const ehApp = e.request.mode === 'navigate'
    || /\.(?:js|css|webmanifest)$/.test(url.pathname);
  e.respondWith(
    fetch(e.request, ehApp ? { cache: 'reload' } : undefined)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit ||
          (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
  );
});
