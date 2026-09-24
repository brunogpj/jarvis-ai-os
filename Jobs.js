// ===================================================================================
// Jobs.js — Execução em segundo plano com CONTINUAÇÃO (padrão daisy-chain / Just-In-Time).
// Inspirado no TriggerApp (Kanshi Tanaike): quebra o limite de 6 min do GAS e o limite de
// 20 gatilhos usando UM gatilho temporal recursivo que processa jobs em lotes, respeitando
// um orçamento de tempo (~4,5 min) e se reagendando enquanto houver trabalho pendente.
//
// Jobs ficam no Firestore (coleção 'jobs'). Tipos: 'ingestao', 'loteWhatsApp'.
// Handler do gatilho: função global processarJobsJarvis() (em Code.js) → Jobs.processar().
// Requer o escopo OAuth script.scriptapp (criar gatilhos).
// ===================================================================================

var Jobs = (function () {
  'use strict';

  var COL = 'jobs';
  var BUDGET_MS = 4.5 * 60 * 1000;   // orçamento por execução (limite real do GAS = 6 min)
  var HANDLER = 'processarJobsJarvis';

  function _agendar() {
    try {
      var jaTem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === HANDLER; });
      if (!jaTem) ScriptApp.newTrigger(HANDLER).timeBased().after(15 * 1000).create();
    } catch (e) { Logger.log('[Jobs] _agendar falhou: ' + e.message); }
  }

  function _limparTriggers() {
    try {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === HANDLER) ScriptApp.deleteTrigger(t);
      });
    } catch (e) {}
  }

  function _pendentes() {
    return Firestore.listDocs(COL, 50)
      .filter(function (j) { return j.dados.status === 'pendente'; })
      .sort(function (a, b) { return (a.dados.criadoEm || 0) - (b.dados.criadoEm || 0); });
  }

  /** Enfileira um job e garante que há um gatilho para processá-lo. */
  function enfileirar(tipo, payload) {
    var id = Utilities.getUuid();
    Firestore.setDoc(COL, id, {
      tipo: tipo, payload: JSON.stringify(payload || {}),
      status: 'pendente', criadoEm: Date.now(), atualizadoEm: Date.now()
    });
    _agendar();
    return id;
  }

  /** Handler do gatilho: processa jobs pendentes dentro do orçamento de tempo. */
  function processar() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return; // outra execução já está processando
    try {
      var inicio = Date.now();
      var jobs = _pendentes();
      for (var i = 0; i < jobs.length; i++) {
        if (Date.now() - inicio > BUDGET_MS) break;
        var job = jobs[i];
        try {
          var payload = JSON.parse(job.dados.payload || '{}');
          var r = _dispatch(job.dados.tipo, payload, inicio) || {};
          if (r.continuar) {
            // Trabalho não terminou no orçamento → salva progresso e continua na próxima execução.
            Firestore.updateDoc(COL, job.id, { payload: JSON.stringify(r.payload || payload), atualizadoEm: Date.now() });
          } else {
            Firestore.updateDoc(COL, job.id, { status: 'concluido', resultado: String(r.resultado || 'ok').substring(0, 800), atualizadoEm: Date.now() });
            if (!r.notificado) _notificar(job.dados.tipo, r.resultado); // evita aviso duplicado (ex.: Objetivos já avisa)
          }
        } catch (e) {
          Firestore.updateDoc(COL, job.id, { status: 'erro', erro: e.message, atualizadoEm: Date.now() });
          _notificar(job.dados.tipo, '⚠️ Falha: ' + e.message);
        }
      }
    } finally { lock.releaseLock(); }
    // Recria UM gatilho só se ainda há trabalho (daisy-chain).
    _limparTriggers();
    try { if (_pendentes().length > 0) _agendar(); } catch (e) {}
  }

  function _dispatch(tipo, payload, inicio) {
    if (tipo === 'loteWhatsApp') return _loteWhatsApp(payload, inicio);
    if (tipo === 'ingestao') return (typeof _jobIngestao === 'function') ? _jobIngestao(payload) : { resultado: 'handler de ingestão ausente' };
    if (tipo === 'objetivo') return _objetivo(payload, inicio);
    // SKILL-2 · tipo inesperado pode indicar entrada anômala (A2A/webhook) — alerta o dono.
    _notificar('ALERTA', 'Job de tipo desconhecido recebido: "' + tipo + '". Ignorado.');
    return { resultado: 'tipo de job desconhecido: ' + tipo };
  }

  // Executa um OBJETIVO (goal-driven) em segundo plano, com continuação por passo (daisy-chain).
  // O próprio Objetivos.executar() persiste o progresso (passoAtual) e avisa no WhatsApp ao concluir.
  function _objetivo(payload, inicio) {
    if (typeof Objetivos === 'undefined') return { resultado: '⚠️ Objetivos indisponível' };
    var r = Objetivos.executar(payload.id, inicio, BUDGET_MS);
    if (r && r.continuar) return { continuar: true, payload: payload }; // retoma do passoAtual na próxima
    var msg = (r && r.sintese) ? String(r.sintese).substring(0, 300) : (r && r.erro ? '⚠️ ' + r.erro : 'concluído');
    return { resultado: '🎯 ' + msg, notificado: true }; // Objetivos já avisou no WhatsApp (síntese completa)
  }

  // Envio em lote com CONTINUAÇÃO por chunk (retoma do índice salvo se estourar o tempo).
  function _loteWhatsApp(payload, inicio) {
    var contatos = payload.contatos || [];
    var idx = payload.idx || 0, enviados = payload.enviados || 0, falhas = payload.falhas || 0;
    while (idx < contatos.length) {
      if (Date.now() - inicio > BUDGET_MS) {
        return { continuar: true, payload: { contatos: contatos, mensagem: payload.mensagem, idx: idx, enviados: enviados, falhas: falhas } };
      }
      var r = WhatsApp.enviar(contatos[idx], payload.mensagem);
      if (r && r.status === 'success') enviados++; else falhas++;
      idx++;
      Utilities.sleep(700); // ritmo seguro (evita flood/ban)
    }
    return { resultado: 'Lote concluído: ' + enviados + ' enviados, ' + falhas + ' falhas (de ' + contatos.length + ').' };
  }

  // Avisa o dono (log do wiki + celular) ao concluir/errar um job.
  function _notificar(tipo, resultado) {
    var msg = String(resultado || 'concluída').substring(0, 300);
    try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[job:' + tipo + '] ' + msg); } catch (e) {}
    try { if (typeof _avisarDono === 'function') _avisarDono({ origem: 'job', titulo: '🤖 Segundo plano · ' + tipo, texto: msg }); } catch (e) {}
  }

  return { enfileirar: enfileirar, processar: processar };
})();

/**
 * RODE PRIMEIRO: força a tela de consentimento do escopo de gatilhos (script.scriptapp).
 * Chama ScriptApp diretamente (sem try/catch) para o GAS exigir a permissão.
 */
function autorizarGatilhos() {
  var n = ScriptApp.getProjectTriggers().length; // dispara o pedido de permissão se ainda não concedido
  Logger.log('✅ Permissão de gatilhos concedida. Gatilhos ativos no projeto: ' + n);
  return n;
}

/** Diagnóstico: enfileira um job de teste e processa. Rode no editor (autoriza o escopo de gatilhos). */
function testarJobs() {
  var id = Jobs.enfileirar('loteWhatsApp', { contatos: [], mensagem: 'teste', idx: 0 });
  Logger.log('Job enfileirado: ' + id);
  processarJobsJarvis();
  Logger.log('Processamento disparado. Veja a coleção "jobs" no Firestore.');
}
