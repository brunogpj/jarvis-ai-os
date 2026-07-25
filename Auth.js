/**
 * Auth.js — Autenticação do Soft App Web Application (Firestore).
 * --------------------------------------------------------------
 * Funções chamadas pelo frontend via google.script.run:
 *   signup(payload) · login(payload) · getSessionUser(token) ·
 *   logout(token) · updateProfile(token, payload)
 *
 * Coleções Firestore:
 *   emails/{emailLower}   -> { uid }                 (índice de e-mail, único)
 *   usuarios/{uid}        -> { nome, email, avatar, senhaHash, salt,
 *                              iterations, role, criadoEm, atualizadoEm }
 *   sessoes/{token}       -> { uid, criadoEm, expiraEm }
 *
 * Senha: SHA-256 iterado (key stretching) com salt aleatório por usuário.
 * O hash em texto puro nunca trafega nem é retornado ao cliente.
 */

var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 dias
var HASH_ITERATIONS = 10000;

/* ============================ API pública ============================ */

function signup(payload) {
  try {
    payload = payload || {};
    var nome = String(payload.nome || '').trim();
    var email = String(payload.email || '').trim().toLowerCase();
    var senha = String(payload.senha || '');
    var avatar = String(payload.avatar || '');

    if (nome.length < 2) return { ok: false, error: 'Informe seu nome completo.' };
    if (!_authValidEmail(email)) return { ok: false, error: 'E-mail inválido.' };
    if (senha.length < 8) return { ok: false, error: 'A senha deve ter ao menos 8 caracteres.' };
    if (avatar.length > 900000) return { ok: false, error: 'Imagem de avatar muito grande.' };

    // Reserva o e-mail de forma atômica (createDoc falha com 409 se já existe).
    try {
      Firestore.createDoc('emails', email, { uid: 'pending' });
    } catch (e) {
      if (String(e).indexOf('409') >= 0) return { ok: false, error: 'Este e-mail já está cadastrado.' };
      throw e;
    }

    var uid = Utilities.getUuid();
    var salt = _authRandomHex(16);
    var hash = _authStretch(senha, salt, HASH_ITERATIONS);
    var nowIso = new Date().toISOString();

    Firestore.setDoc('usuarios', uid, {
      nome: nome, email: email, avatar: avatar,
      senhaHash: hash, salt: salt, iterations: HASH_ITERATIONS, algo: 'SHA256-iter',
      role: 'user', criadoEm: nowIso, atualizadoEm: nowIso
    });
    Firestore.setDoc('emails', email, { uid: uid });

    var token = _authCreateSession(uid);
    return { ok: true, token: token, user: { uid: uid, nome: nome, email: email, avatar: avatar, role: 'user' } };
  } catch (err) {
    return { ok: false, error: 'Erro no cadastro: ' + err.message };
  }
}

function login(payload) {
  try {
    payload = payload || {};
    var email = String(payload.email || '').trim().toLowerCase();
    var senha = String(payload.senha || '');

    var emailDoc = Firestore.getDoc('emails', email);
    if (!emailDoc || !emailDoc.uid || emailDoc.uid === 'pending') {
      return { ok: false, error: 'E-mail ou senha incorretos.' };
    }
    var user = Firestore.getDoc('usuarios', emailDoc.uid);
    if (!user) return { ok: false, error: 'E-mail ou senha incorretos.' };

    var hash = _authStretch(senha, user.salt, user.iterations || HASH_ITERATIONS);
    if (!_authConstTimeEq(hash, user.senhaHash)) {
      return { ok: false, error: 'E-mail ou senha incorretos.' };
    }

    var token = _authCreateSession(emailDoc.uid);
    return { ok: true, token: token, user: _authPublicUser(emailDoc.uid, user) };
  } catch (err) {
    return { ok: false, error: 'Erro no login: ' + err.message };
  }
}

/** Valida o token e devolve o usuário público, ou null. */
function getSessionUser(token) {
  try {
    if (!token) return null;
    var s = Firestore.getDoc('sessoes', token);
    if (!s) return null;
    if (s.expiraEm && Number(s.expiraEm) < Date.now()) {
      Firestore.deleteDoc('sessoes', token);
      return null;
    }
    var user = Firestore.getDoc('usuarios', s.uid);
    if (!user) return null;
    return _authPublicUser(s.uid, user);
  } catch (err) {
    return null;
  }
}

function logout(token) {
  try {
    if (token) Firestore.deleteDoc('sessoes', token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function updateProfile(token, payload) {
  try {
    var pub = getSessionUser(token);
    if (!pub) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };
    payload = payload || {};

    var user = Firestore.getDoc('usuarios', pub.uid);
    if (!user) return { ok: false, error: 'Usuário não encontrado.' };

    if (payload.nome !== undefined) {
      var nome = String(payload.nome).trim();
      if (nome.length < 2) return { ok: false, error: 'Nome inválido.' };
      user.nome = nome;
    }
    if (payload.avatar !== undefined) {
      if (String(payload.avatar).length > 900000) return { ok: false, error: 'Imagem muito grande.' };
      user.avatar = String(payload.avatar);
    }
    if (payload.novaSenha) {
      if (String(payload.novaSenha).length < 8) return { ok: false, error: 'A nova senha deve ter ao menos 8 caracteres.' };
      user.salt = _authRandomHex(16);
      user.iterations = HASH_ITERATIONS;
      user.senhaHash = _authStretch(String(payload.novaSenha), user.salt, HASH_ITERATIONS);
    }
    user.atualizadoEm = new Date().toISOString();
    Firestore.setDoc('usuarios', pub.uid, user);
    return { ok: true, user: _authPublicUser(pub.uid, user) };
  } catch (err) {
    return { ok: false, error: 'Erro ao atualizar perfil: ' + err.message };
  }
}

/* ============================ Helpers ============================ */

function _authPublicUser(uid, u) {
  return { uid: uid, nome: u.nome, email: u.email, avatar: u.avatar || '', role: u.role || 'user' };
}

function _authValidEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

function _authCreateSession(uid) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  Firestore.setDoc('sessoes', token, {
    uid: uid, criadoEm: Date.now(), expiraEm: Date.now() + SESSION_TTL_MS
  });
  return token;
}

/** Key stretching: SHA-256 iterado, misturando o salt a cada volta. */
function _authStretch(senha, salt, iterations) {
  var h = salt + '|' + senha;
  for (var i = 0; i < iterations; i++) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8);
    h = _authBytesToHex(bytes);
  }
  return h;
}

function _authBytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] & 0xFF).toString(16);
    if (v.length < 2) v = '0' + v;
    s += v;
  }
  return s;
}

function _authRandomHex(nbytes) {
  var seed = Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  return _authBytesToHex(bytes).substring(0, nbytes * 2);
}

function _authConstTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}
