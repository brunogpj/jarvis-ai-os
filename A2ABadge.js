// ===================================================================================
// A2ABadge.js — Crachás efêmeros de escopo mínimo (P8.2 · portado do projeto-irmão "Antigravity").
// Zero-Trust: cada chamada interna/sensível recebe uma credencial EFÊMERA com a permissão EXATA
// de que precisa, e ela EXPIRA rápido. Reduz a janela de replay/abuso de um token estático vazado.
// Usa CacheService (não persiste em lugar nenhum). Casos no Jarvis:
//   • autorizar hops internos (job→tool, e o futuro AsyncBroker/P8.1);
//   • assinar/expirar disparos de webhook (P7.4) com escopo mínimo (ex.: 'falar').
// ===================================================================================

var A2ABadge = {
  TTL_PADRAO: 600, // 10 min em segundos

  /**
   * Emite um crachá efêmero para um agente/uso com escopo mínimo.
   * @param {string} agente            quem recebe (nome do job/skill/uso)
   * @param {string|string[]} escopo   permissão(ões) concedida(s) (ex.: 'falar', 'invoke')
   * @param {number} [ttlSeg]          validade em segundos (padrão 10 min)
   * @return {{token:string, agente:string, escopo:string[], expira:number}}
   */
  emitir: function (agente, escopo, ttlSeg) {
    var ttl = ttlSeg || this.TTL_PADRAO;
    var token = 'a2a_' + Utilities.getUuid().replace(/-/g, '').substring(0, 24);
    var dados = {
      agente: agente || 'desconhecido',
      escopo: Array.isArray(escopo) ? escopo : [escopo || 'invoke'],
      expira: Date.now() + ttl * 1000
    };
    try {
      CacheService.getScriptCache().put('A2ABADGE_' + token, JSON.stringify(dados), ttl);
      Logger.log('[A2ABadge] emitido p/ ' + dados.agente + ' | escopo=' + dados.escopo.join(',') + ' | ttl=' + ttl + 's');
    } catch (e) { Logger.log('[A2ABadge] emitir falhou: ' + e.message); }
    return { token: token, agente: dados.agente, escopo: dados.escopo, expira: dados.expira };
  },

  /**
   * Valida um crachá e (opcionalmente) confere se cobre o escopo exigido.
   * @return {{valido:boolean, agente?:string, escopo?:string[], motivo?:string}}
   */
  validar: function (token, escopoExigido) {
    try {
      var raw = CacheService.getScriptCache().get('A2ABADGE_' + String(token || ''));
      if (!raw) return { valido: false, motivo: 'crachá ausente ou expirado' };
      var dados = JSON.parse(raw);
      if (Date.now() > dados.expira) return { valido: false, motivo: 'crachá expirado' };
      if (escopoExigido && dados.escopo.indexOf(escopoExigido) === -1) {
        return { valido: false, motivo: 'escopo insuficiente (exigido: ' + escopoExigido + ')' };
      }
      return { valido: true, agente: dados.agente, escopo: dados.escopo };
    } catch (e) {
      return { valido: false, motivo: 'erro ao validar: ' + e.message };
    }
  },

  /** Revoga um crachá imediatamente (uso único / após consumo). */
  revogar: function (token) {
    try { CacheService.getScriptCache().remove('A2ABADGE_' + String(token || '')); } catch (e) {}
  }
};

/** Diag no editor: emite → valida (escopo certo e errado) → revoga → valida (deve falhar). */
function testarA2ABadge() {
  var b = A2ABadge.emitir('teste', ['falar'], 30);
  var v1 = A2ABadge.validar(b.token, 'falar');     // valido:true
  var v2 = A2ABadge.validar(b.token, 'apagar');    // escopo insuficiente
  A2ABadge.revogar(b.token);
  var v3 = A2ABadge.validar(b.token, 'falar');     // ausente/expirado
  var out = { emitido: b, escopoOk: v1, escopoErrado: v2, aposRevogar: v3 };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
