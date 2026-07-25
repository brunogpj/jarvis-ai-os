// ===================================================================================
// Sandbox.js — P9: SANDBOX INLINE para run_dynamic_script (porta do conceito ggsrun de
// Kanshi Tanaike, "Sandbox para scripts GAS gerados por IA"). Mitiga LLM01 (injeção de prompt
// → execução de código) e LLM06 (excessive agency): um script dinâmico não pode exfiltrar dados,
// fazer traversal de Drive nem phishing fora de uma ALLOWLIST.
//
// COMO: o SkillsManager.executeScript injeta os globais (SpreadsheetApp/DriveApp/UrlFetchApp/
// MailApp/GmailApp) como PARÂMETROS do new Function — então passamos as APIS ENVOLVIDAS (_wrapped*)
// em vez das reais. Cada método sensível valida contra a allowlist; o resto é DELEGADO (clone da
// cadeia de protótipos, técnica createSafeWrapper). Opt-in via Script Property SANDBOX_DYNAMIC=true.
//
// Config (Script Property SANDBOX_CONFIG, JSON):
//   { allowedFileIds:[], allowedFolderIds:[], allowedEmails:[], allowedUrls:[], blockedUrls:[] }
//   - blockedUrls tem PRECEDÊNCIA; glob (*) suportado; allowedUrls vazio = só anti-SSRF/blocklist.
// LIMITE CONHECIDO (do artigo): Serviços Avançados (Drive.Files.list) NÃO passam por UrlFetchApp →
// não são cobertos. Sandbox é UMA camada (com hooks + Gate P2), não bala de prata.
// ===================================================================================

var Sandbox = (function () {
  'use strict';

  function _cfg() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SANDBOX_CONFIG') || '{}'); } catch (e) { return {}; } }
  function _ativo() { try { return PropertiesService.getScriptProperties().getProperty('SANDBOX_DYNAMIC') === 'true'; } catch (e) { return false; } }
  function _block(msg) { throw new Error('🛡️ Sandbox bloqueou: ' + msg); }

  // Clona a cadeia de protótipos do objeto nativo, sobrescrevendo SÓ os métodos sensíveis e
  // DELEGANDO todo o resto ao original. (createSafeWrapper — Tanaike.)
  function _createSafeWrapper(original, overrides) {
    var wrapper = {}, visto = {}, proto = original;
    while (proto && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach(function (k) {
        if (visto[k] || k === 'constructor') return;
        visto[k] = 1;
        if (overrides[k]) { wrapper[k] = overrides[k]; return; }
        var v; try { v = original[k]; } catch (e) { return; }
        wrapper[k] = (typeof v === 'function') ? function () { return original[k].apply(original, arguments); } : v;
      });
      try { proto = Object.getPrototypeOf(proto); } catch (e) { proto = null; }
    }
    return wrapper;
  }

  function _glob(url, pattern) {
    var esc = String(pattern).replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
    return new RegExp('^' + esc.replace(/\*/g, '.*') + '$', 'i').test(String(url));
  }
  function _urlPermitida(url, cfg) {
    var u = String(url || '');
    // Anti-SSRF baseline (SEMPRE, mesmo sem config): bloqueia interno/loopback/metadata da nuvem.
    if (/^https?:\/\/(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|localhost|\[?::1\]?|metadata)/i.test(u) || /\/computeMetadata\//i.test(u) || /169\.254\.169\.254/.test(u)) return false;
    var bloq = cfg.blockedUrls || [];
    for (var i = 0; i < bloq.length; i++) if (_glob(u, bloq[i])) return false;   // blocklist PRECEDE
    var perm = cfg.allowedUrls || [];
    if (!perm.length) return true;   // allowlist vazia → libera externo (só anti-SSRF/blocklist) p/ usabilidade
    for (var j = 0; j < perm.length; j++) if (_glob(u, perm[j])) return true;
    return false;
  }

  // Constrói os globais ENVOLVIDOS a partir dos reais. reais = {SpreadsheetApp,DriveApp,UrlFetchApp,MailApp,GmailApp}.
  function wrap(reais) {
    var cfg = _cfg(), out = {};

    // UrlFetchApp — exfiltração / SSRF de saída.
    out.UrlFetchApp = _createSafeWrapper(reais.UrlFetchApp, {
      fetch: function (url, params) { if (!_urlPermitida(url, cfg)) _block('URL não permitida: ' + url); return reais.UrlFetchApp.fetch(url, params); },
      fetchAll: function (reqs) { (reqs || []).forEach(function (r) { var u = (typeof r === 'string') ? r : (r && r.url); if (!_urlPermitida(u, cfg)) _block('URL não permitida: ' + u); }); return reais.UrlFetchApp.fetchAll(reqs); },
      getRequest: function (url, params) { if (!_urlPermitida(url, cfg)) _block('URL não permitida: ' + url); return reais.UrlFetchApp.getRequest(url, params); }
    });

    // GmailApp / MailApp — phishing / spam de saída.
    var emailsOk = cfg.allowedEmails || [];
    function _destOk(dest) { if (!emailsOk.length) return true; var d = String(dest || '').toLowerCase(); return emailsOk.some(function (e) { return d.indexOf(String(e).toLowerCase()) !== -1; }); }
    out.GmailApp = _createSafeWrapper(reais.GmailApp, {
      sendEmail: function (to) { if (!_destOk(to)) _block('destinatário de e-mail não permitido: ' + to); return reais.GmailApp.sendEmail.apply(reais.GmailApp, arguments); },
      createDraft: function (to) { if (!_destOk(to)) _block('destinatário de rascunho não permitido: ' + to); return reais.GmailApp.createDraft.apply(reais.GmailApp, arguments); }
    });
    out.MailApp = _createSafeWrapper(reais.MailApp, {
      sendEmail: function (to) { var dest = (to && typeof to === 'object') ? to.to : to; if (!_destOk(dest)) _block('destinatário não permitido: ' + dest); return reais.MailApp.sendEmail.apply(reais.MailApp, arguments); }
    });

    // DriveApp — traversal / coleta de arquivos.
    var filesOk = cfg.allowedFileIds || [], foldersOk = cfg.allowedFolderIds || [];
    function _idOk(id) { return filesOk.indexOf(id) !== -1 || foldersOk.indexOf(id) !== -1; }
    function _wrapIter(iter) { return { hasNext: function () { return iter.hasNext(); }, next: function () { var it = iter.next(); var id; try { id = it.getId(); } catch (e) {} if ((filesOk.length || foldersOk.length) && !_idOk(id)) _block('recurso do Drive não permitido: ' + id); return it; } }; }
    out.DriveApp = _createSafeWrapper(reais.DriveApp, {
      getFileById: function (id) { if (filesOk.length && !_idOk(id)) _block('arquivo não permitido: ' + id); return reais.DriveApp.getFileById(id); },
      getFolderById: function (id) { if (foldersOk.length && !_idOk(id)) _block('pasta não permitida: ' + id); return reais.DriveApp.getFolderById(id); },
      getFiles: function () { return _wrapIter(reais.DriveApp.getFiles()); },
      getFilesByName: function (n) { return _wrapIter(reais.DriveApp.getFilesByName(n)); },
      searchFiles: function (q) { return _wrapIter(reais.DriveApp.searchFiles(q)); }
    });

    // SpreadsheetApp — acesso a planilhas por ID.
    out.SpreadsheetApp = _createSafeWrapper(reais.SpreadsheetApp, {
      openById: function (id) { if (filesOk.length && !_idOk(id)) _block('planilha não permitida: ' + id); return reais.SpreadsheetApp.openById(id); }
    });

    return out;
  }

  return { ativo: _ativo, wrap: wrap, _urlPermitida: function (u) { return _urlPermitida(u, _cfg()); } };
})();

/** Liga a sandbox e (opcional) grava o SANDBOX_CONFIG. Ex.: configurarSandboxDinamico({allowedUrls:['https://api.github.com/*']}). */
function configurarSandboxDinamico(cfg) {
  var p = PropertiesService.getScriptProperties();
  if (cfg && typeof cfg === 'object') p.setProperty('SANDBOX_CONFIG', JSON.stringify(cfg));
  p.setProperty('SANDBOX_DYNAMIC', 'true');
  return { ok: true, ativo: true, config: JSON.parse(p.getProperty('SANDBOX_CONFIG') || '{}') };
}
function desligarSandboxDinamico() { PropertiesService.getScriptProperties().setProperty('SANDBOX_DYNAMIC', 'false'); return { ok: true, ativo: false }; }

/** Diag (sem custo): valida a lógica do wrapper — fetch interno/externo bloqueado e permitido. */
function testarSandbox() {
  var w = Sandbox.wrap({ SpreadsheetApp: SpreadsheetApp, DriveApp: DriveApp, UrlFetchApp: UrlFetchApp, MailApp: MailApp, GmailApp: GmailApp });
  var r = { ssrf: null, externoSemConfig: null, temWrapper: typeof w.UrlFetchApp.fetch === 'function' };
  try { Sandbox._urlPermitida('http://169.254.169.254/latest/meta-data'); } catch (e) {}
  r.ssrf = Sandbox._urlPermitida('http://169.254.169.254/latest/meta-data') === false ? 'BLOQUEADO ✅' : 'PASSOU ❌';
  r.externoSemConfig = Sandbox._urlPermitida('https://api.github.com/repos/x') === true ? 'PERMITIDO ✅' : 'BLOQUEADO';
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
