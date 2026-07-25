/**
 * Firestore.js — Wrapper REST do Cloud Firestore para Google Apps Script.
 * ----------------------------------------------------------------------
 * Autentica via SERVICE ACCOUNT (JWT RS256 -> access token OAuth) lendo a
 * Script Property `FIRESTORE_SA` (JSON da chave). Sem bibliotecas externas.
 *
 * Banco: projeto = project_id do SA; database = FS_DATABASE.
 * Expõe o objeto global `Firestore` com getDoc/setDoc/createDoc/deleteDoc.
 */

var FS_DATABASE = 'firestore-gas';   // ID do banco criado no console
var _fsSaCache = null;

function _fsSa() {
  if (_fsSaCache) return _fsSaCache;
  var raw = PropertiesService.getScriptProperties().getProperty('FIRESTORE_SA');
  if (!raw) throw new Error('Script Property FIRESTORE_SA ausente.');
  _fsSaCache = JSON.parse(raw);
  return _fsSaCache;
}

function _fsDocBase() {
  return 'https://firestore.googleapis.com/v1/projects/' + _fsSa().project_id +
         '/databases/' + FS_DATABASE + '/documents';
}

function _fsB64url(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

/** Gera (e cacheia) um access token OAuth a partir da service account. */
function _fsAccessToken() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('FS_ACCESS_TOKEN');
  if (cached) return cached;

  var sa = _fsSa();
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  var signingInput = _fsB64url(JSON.stringify(header)) + '.' + _fsB64url(JSON.stringify(claim));
  var sigBytes = Utilities.computeRsaSha256Signature(signingInput, sa.private_key);
  var jwt = signingInput + '.' + Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }
  });
  var body = JSON.parse(res.getContentText());
  if (!body.access_token) {
    throw new Error('Falha ao autenticar no Firestore: ' + res.getContentText());
  }
  cache.put('FS_ACCESS_TOKEN', body.access_token, 3300); // ~55 min
  return body.access_token;
}

function _fsRequest(method, url, body) {
  var opt = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + _fsAccessToken() }
  };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(url, opt);
  var txt = res.getContentText();
  return { code: res.getResponseCode(), json: txt ? JSON.parse(txt) : null, text: txt };
}

/* ---------- Conversão JS <-> formato tipado do Firestore ---------- */
function _fsEncode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return (Math.floor(v) === v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(_fsEncode) } };
  if (typeof v === 'object') return { mapValue: { fields: _fsEncodeFields(v) } };
  return { stringValue: String(v) };
}
function _fsEncodeFields(obj) {
  var f = {};
  Object.keys(obj).forEach(function (k) { f[k] = _fsEncode(obj[k]); });
  return f;
}
function _fsDecode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(_fsDecode);
  if ('mapValue' in v) return _fsDecodeFields((v.mapValue && v.mapValue.fields) || {});
  return null;
}
function _fsDecodeFields(fields) {
  var o = {};
  Object.keys(fields).forEach(function (k) { o[k] = _fsDecode(fields[k]); });
  return o;
}

var Firestore = {
  /** Lê um documento. Retorna objeto ou null (404). */
  getDoc: function (collection, id) {
    var r = _fsRequest('get', _fsDocBase() + '/' + collection + '/' + encodeURIComponent(id));
    if (r.code === 404) return null;
    if (r.code >= 400) throw new Error('Firestore getDoc ' + r.code + ': ' + r.text);
    return _fsDecodeFields((r.json && r.json.fields) || {});
  },

  /** Cria/substitui um documento (upsert). */
  setDoc: function (collection, id, data) {
    var r = _fsRequest('patch', _fsDocBase() + '/' + collection + '/' + encodeURIComponent(id),
                       { fields: _fsEncodeFields(data) });
    if (r.code >= 400) throw new Error('Firestore setDoc ' + r.code + ': ' + r.text);
    return true;
  },

  /** Cria documento SOMENTE se não existir. Lança erro contendo "409" se já existe. */
  createDoc: function (collection, id, data) {
    var url = _fsDocBase() + '/' + collection + '?documentId=' + encodeURIComponent(id);
    var r = _fsRequest('post', url, { fields: _fsEncodeFields(data) });
    if (r.code === 409) throw new Error('409: documento já existe');
    if (r.code >= 400) throw new Error('Firestore createDoc ' + r.code + ': ' + r.text);
    return true;
  },

  /** Remove um documento (idempotente). */
  deleteDoc: function (collection, id) {
    var r = _fsRequest('delete', _fsDocBase() + '/' + collection + '/' + encodeURIComponent(id));
    if (r.code >= 400 && r.code !== 404) throw new Error('Firestore deleteDoc ' + r.code + ': ' + r.text);
    return true;
  },

  /** Atualiza (merge) apenas os campos informados de um documento. */
  updateDoc: function (collection, id, data) {
    var mask = Object.keys(data).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
    var url = _fsDocBase() + '/' + collection + '/' + encodeURIComponent(id) + '?' + mask;
    var r = _fsRequest('patch', url, { fields: _fsEncodeFields(data) });
    if (r.code >= 400) throw new Error('Firestore updateDoc ' + r.code + ': ' + r.text);
    return true;
  },

  /** Lista documentos de uma coleção/subcoleção. Retorna [{ id, dados }].
   *  pageSize = total máximo desejado. Pagina internamente via nextPageToken
   *  em lotes de até 300 documentos por requisição REST (limite conservador).
   *  Teto de segurança: 20 páginas, evitando loop infinito em caso de bug de API. */
  listDocs: function (collectionPath, pageSize) {
    var desejado    = pageSize || 100;
    var tamLote     = Math.min(desejado, 300);
    var base        = _fsDocBase() + '/' + collectionPath;
    var todos       = [];
    var pageToken   = null;
    var MAX_PAGINAS = 20;
    var pagina      = 0;

    do {
      var url = base + '?pageSize=' + tamLote;
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

      var r = _fsRequest('get', url);
      if (r.code === 404) return [];
      if (r.code >= 400) throw new Error('Firestore listDocs ' + r.code + ': ' + r.text);

      var docs = (r.json && r.json.documents) || [];
      for (var i = 0; i < docs.length; i++) {
        todos.push({ id: String(docs[i].name).split('/').pop(),
                     dados: _fsDecodeFields(docs[i].fields || {}) });
      }

      pageToken = (r.json && r.json.nextPageToken) || null;
      pagina++;
    } while (pageToken && todos.length < desejado && pagina < MAX_PAGINAS);

    return todos;
  }
};

/** Função utilitária para testar a conexão pelo editor do Apps Script. */
function testarFirestore() {
  Firestore.setDoc('_diag', 'ping', { ok: true, em: new Date() });
  var doc = Firestore.getDoc('_diag', 'ping');
  Firestore.deleteDoc('_diag', 'ping');
  Logger.log('Firestore OK: ' + JSON.stringify(doc));
  return doc;
}
