/* =====================================================
   APP-GUIA — conta do guia
   Login por e-mail e senha (Supabase Auth).
   A senha é criada por ela; nunca passa por aqui nem por mim.
   ===================================================== */
'use strict';

const AUTH_KEY = 'vi_session_v1';
let SESSION = null;   // { access_token, refresh_token, expires_at, user }

/* Prazo para TODA chamada de rede daqui.

   Sem isto, um `fetch` num celular com sinal fraco fica pendurado para
   sempre: ela aperta ENTRAR, a roda gira e nunca acontece nada. Era esse o
   "login que não entra". O cloud.js já tinha prazo; o auth.js tinha SETE
   chamadas sem nenhum, e é justamente por elas que ela passa para entrar.

   12s é longo o bastante para uma rede ruim e curto o bastante para ela
   receber uma resposta em vez de encarar uma tela parada. */
const REDE_PRAZO = 12000;

async function comPrazo(url, opts = {}) {
  const ctrl = new AbortController();
  const corta = setTimeout(() => ctrl.abort(), REDE_PRAZO);
  try {
    return await fetch(url, { signal: ctrl.signal, ...opts });
  } finally { clearTimeout(corta); }
}

function authLoad() {
  try { SESSION = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { SESSION = null; }
  return SESSION;
}
function authSave(s) {
  SESSION = s;
  if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
  else localStorage.removeItem(AUTH_KEY);
}
function authUser()   { return SESSION && SESSION.user; }
function authEmail()  { return authUser() ? authUser().email : null; }
function authToken()  { return SESSION ? SESSION.access_token : null; }
function isLoggedIn() { return !!authToken(); }

async function authFetch(path, body) {
  const r = await comPrazo(SUPA_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/* criar a conta — ela escolhe a senha */
async function authSignUp(email, password) {
  const r = await authFetch('signup?redirect_to=' + encodeURIComponent(appHome()), { email, password });
  if (!r.ok) return { ok: false, error: r.data.msg || r.data.error_description || r.data.message };
  /* com confirmação de e-mail ligada, ainda não vem sessão */
  if (r.data.access_token) { authSave(sessionFrom(r.data)); return { ok: true, logged: true }; }
  return { ok: true, logged: false, needsConfirm: true };
}

/* entrar */
async function authSignIn(email, password) {
  const r = await comPrazo(SUPA_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: d.error_description || d.msg || d.message };
  authSave(sessionFrom(d));
  return { ok: true };
}

function sessionFrom(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token,
           expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: d.user };
}

async function authRefresh() {
  if (!SESSION || !SESSION.refresh_token) return false;
  /* Rede fora do ar NAO e sessao invalida: se estourar o prazo, devolve
     false e MANTEM a sessao. Apagar aqui derrubaria ela do app so porque
     o metro entrou no tunel. */
  let r;
  try {
    r = await comPrazo(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: SESSION.refresh_token }),
    });
  } catch (e) { return false; }
  if (!r.ok) { authSave(null); return false; }
  try { authSave(sessionFrom(await r.json())); } catch (e) { return false; }
  return true;
}

/* mantém a sessão viva sem ela precisar entrar de novo */
async function authEnsure() {
  if (!SESSION) return false;
  if (Date.now() > SESSION.expires_at - 60000) return authRefresh();
  return true;
}

async function authSignOut() {
  try {
    await comPrazo(SUPA_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + authToken() },
    });
  } catch (e) { /* sair localmente já basta */ }
  authSave(null);
}

/* Endereço deste app, sem hash e sem query. É para cá que o link
   do e-mail tem que voltar — dizer isso explicitamente é o que impede
   o link de cair no Site URL configurado, que pode estar errado. */
function appHome() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function authReset(email) {
  const r = await authFetch('recover?redirect_to=' + encodeURIComponent(appHome()), { email });
  return { ok: r.ok, error: r.data.msg || r.data.message };
}

/* --------- link de recuperação de senha ---------
   O Supabase devolve a sessão no próprio endereço, depois do #.
   Sem ler isso, quem clica no link do e-mail cai no hub e não
   acontece nada — que era exatamente o que este app fazia. */
function authFromHash() {
  const h = location.hash || '';
  if (!/access_token=|error_description=/.test(h)) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  const limpa = () => history.replaceState(null, '', location.pathname + location.search);

  const erro = p.get('error_description');
  if (erro) { limpa(); return { erro: decodeURIComponent(erro.replace(/\+/g, ' ')) }; }

  const at = p.get('access_token');
  if (!at) return null;
  authSave({ access_token: at, refresh_token: p.get('refresh_token'),
             expires_at: Date.now() + (+p.get('expires_in') || 3600) * 1000, user: null });
  const tipo = p.get('type');
  limpa();
  return { tipo };
}

/* Troca a senha usando a sessão que veio do link. */
async function authSetPassword(pass) {
  if (!authToken()) return { ok: false, error: 'sem sessão' };
  try {
    const r = await comPrazo(SUPA_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + authToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.msg || d.message || d.error_description };
    if (SESSION) { SESSION.user = d; authSave(SESSION); }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* --------- posse do app: a primeira conta vira a dona --------- */
async function claimOwnership() {
  if (!isLoggedIn()) return { ok: false };
  const h = { apikey: SUPA_KEY, Authorization: 'Bearer ' + authToken(), 'Content-Type': 'application/json' };
  try {
    const cur = await comPrazo(SUPA_URL + '/rest/v1/app_config?id=eq.1&select=owner_uid', { headers: h })
      .then(r => r.ok ? r.json() : null);
    if (!cur) return { ok: false, noTable: true };           // SQL ainda não aplicado
    const owner = cur[0] && cur[0].owner_uid;
    if (owner && owner !== authUser().id) return { ok: false, taken: true };
    if (owner === authUser().id) return { ok: true, already: true };
    const r = await comPrazo(SUPA_URL + '/rest/v1/app_config?id=eq.1', {
      method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ owner_uid: authUser().id }),
    });
    return { ok: r.ok };
  } catch (e) { return { ok: false }; }
}

authLoad();
