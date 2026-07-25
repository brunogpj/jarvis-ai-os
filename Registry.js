// ===================================================================================
// Registry.js — Registro de Ativos de IA versionado (P8.4 · portado do "Antigravity").
// Permite ajustar MODELOS e trechos de PROMPT SEM redeploy, via Script Properties, com log de
// versões auditável no Firestore ('registry_log'). Se a property não existir, usa o padrão
// hardcoded passado pelo chamador (comportamento atual preservado — adoção incremental).
//   • Modelos:  Script Property REGISTRY_MODELS_<chave>  (JSON array)
//   • Texto:    Script Property REGISTRY_TEXT_<chave>    (string)
// ===================================================================================

var Registry = {
  _props: function () { return PropertiesService.getScriptProperties(); },

  /** Lista de modelos para uma capacidade (ex.: 'chat_fc'); cai no padrão se não configurado. */
  getModelos: function (chave, padrao) {
    try {
      var raw = this._props().getProperty('REGISTRY_MODELS_' + chave);
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; }
    } catch (e) { Logger.log('[Registry] getModelos ' + chave + ': ' + e.message); }
    return padrao;
  },

  /** Texto de ativo (ex.: 'prompt_suffix'); retorna padrão/'' se não configurado. */
  getTexto: function (chave, padrao) {
    try {
      var v = this._props().getProperty('REGISTRY_TEXT_' + chave);
      return (v != null && v !== '') ? v : (padrao || '');
    } catch (e) { return padrao || ''; }
  },

  /** Define um ativo (tipo: 'MODELS' | 'TEXT') e registra a versão no log (auditável). */
  definir: function (tipo, chave, valor) {
    try {
      var v = (typeof valor === 'string') ? valor : JSON.stringify(valor);
      this._props().setProperty('REGISTRY_' + tipo + '_' + chave, v);
      this._log(tipo + ':' + chave, v);
      return true;
    } catch (e) { Logger.log('[Registry] definir: ' + e.message); return false; }
  },

  // Log de versões no Firestore (id = timestamp-reverso → mais recente primeiro em listDocs).
  _log: function (chave, valor) {
    try {
      if (typeof Firestore === 'undefined') return;
      var s = String(valor || '');
      var hash = Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
      ).substring(0, 12);
      var id = String(1e13 - Date.now()) + '_' + Math.random().toString(36).slice(2, 6);
      Firestore.setDoc('registry_log', id, { ts: new Date(), ativo: chave, versao: hash, preview: s.substring(0, 120) });
    } catch (e) { Logger.log('[Registry] _log: ' + e.message); }
  }
};

/** Diag no editor: grava um ativo de teste e mostra o que voltaria. */
function testarRegistry() {
  Registry.definir('MODELS', 'chat_fc', ['gemini-2.5-flash', 'gemini-2.0-flash']);
  var out = {
    modelos: Registry.getModelos('chat_fc', ['(padrão)']),
    textoInexistente: Registry.getTexto('nao_existe', '(usa padrão)')
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
