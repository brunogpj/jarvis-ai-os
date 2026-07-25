// ===================================================================================
// Agenda.js — Tarefas agendadas/recorrentes (Jarvis proativo). P1.2.
// Um ÚNICO gatilho temporal (tick a cada 15 min) verifica as tarefas devidas e as executa
// via Jarvis.ask, entregando o resultado no WhatsApp do dono. Tarefas no Firestore ('tarefas').
// Respeita o limite de gatilhos (1 tick para N tarefas). Requer escopo script.scriptapp.
// ===================================================================================

var Agenda = (function () {
  'use strict';

  var COL = 'tarefas';
  var TICK = 'executarTarefasAgendadas';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  function _garantirTick() {
    try {
      var jaTem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === TICK; });
      if (!jaTem) ScriptApp.newTrigger(TICK).timeBased().everyMinutes(15).create();
    } catch (e) { Logger.log('[Agenda] _garantirTick falhou: ' + e.message); }
  }

  /** Agenda uma tarefa. hora 0-23; diasSemana [0=Dom..6=Sáb] (vazio=todos); frequencia diario|semanal|unico. */
  function agendar(descricao, hora, diasSemana, frequencia, email) {
    var id = Utilities.getUuid();
    Firestore.setDoc(COL, id, {
      descricao: String(descricao || ''), hora: Number(hora), diasSemana: diasSemana || [],
      frequencia: frequencia || 'diario', email: email || '', ativo: true,
      criadoEm: Date.now(), ultimaExecucao: ''
    });
    _garantirTick();
    return id;
  }

  function listar() {
    return Firestore.listDocs(COL, 100)
      .filter(function (t) { return t.dados.ativo !== false; })
      .map(function (t) {
        return { id: t.id, descricao: t.dados.descricao, hora: t.dados.hora, diasSemana: t.dados.diasSemana, frequencia: t.dados.frequencia };
      });
  }

  function cancelar(idOuDesc) {
    var alvo = String(idOuDesc || '').toLowerCase().trim();
    var docs = Firestore.listDocs(COL, 100);
    var rem = 0;
    docs.forEach(function (t) {
      if (t.id === idOuDesc || String(t.dados.descricao || '').toLowerCase().indexOf(alvo) !== -1) {
        try { Firestore.deleteDoc(COL, t.id); rem++; } catch (e) {}
      }
    });
    return { status: 'success', removidas: rem };
  }

  /** Handler do tick (a cada 15 min): executa as tarefas devidas nesta hora (dedup por dia). */
  function executar() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return;
    try {
      var agora = new Date();
      var hora = Number(Utilities.formatDate(agora, 'America/Sao_Paulo', 'H'));
      var dow = Number(Utilities.formatDate(agora, 'America/Sao_Paulo', 'u')) % 7; // 1=Seg..7=Dom → %7: Dom=0,Seg=1..Sáb=6
      var hoje = Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd');
      var owner = _p('OWNER_EMAIL');
      var num = _p('WHATSAPP_OWNER_NUMBER');
      Firestore.listDocs(COL, 100).forEach(function (t) {
        var d = t.dados;
        if (d.ativo === false) return;
        if (Number(d.hora) !== hora) return;
        if (d.diasSemana && d.diasSemana.length && d.diasSemana.indexOf(dow) === -1) return;
        if (d.ultimaExecucao === hoje) return; // já rodou hoje
        var resp = '';
        try { resp = Jarvis.ask(d.email || owner, d.descricao, [], null, { interativo: false }); } catch (e) { resp = '⚠️ ' + e.message; }
        try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[tarefa] ' + d.descricao + ' → ' + String(resp).substring(0, 150)); } catch (e) {}
        try { if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '⏰ Tarefa agendada — ' + d.descricao + ':\n\n' + String(resp).substring(0, 1500)); } catch (e) {}
        var upd = { ultimaExecucao: hoje, ultimoResultado: String(resp).substring(0, 500) };
        if (d.frequencia === 'unico') upd.ativo = false;
        try { Firestore.updateDoc(COL, t.id, upd); } catch (e) {}
      });
    } finally { lock.releaseLock(); }
  }

  return { agendar: agendar, listar: listar, cancelar: cancelar, executar: executar };
})();

/** Handler do gatilho temporal compartilhado: tarefas agendadas + monitor de eventos. NÃO renomear. */
function executarTarefasAgendadas() {
  try { if (typeof Heartbeat !== 'undefined') Heartbeat.bater('agenda'); } catch (e) {}
  try { Agenda.executar(); } catch (e) { Logger.log('[tick] Agenda: ' + e.message); }
  try { if (typeof Monitor !== 'undefined') Monitor.verificar(); } catch (e) { Logger.log('[tick] Monitor: ' + e.message); }
  try { if (typeof WhatsApp !== 'undefined') WhatsApp.enviarAgendadasDevidas(); } catch (e) { Logger.log('[tick] MsgsAgendadas: ' + e.message); }
  try { if (typeof Web !== 'undefined') Web.verificarMudancas(); } catch (e) { Logger.log('[tick] WebMonitor: ' + e.message); }
  try { if (typeof Autorizacoes !== 'undefined') { Autorizacoes.acompanharPendentes(8); Autorizacoes.limparExpiradas(180); } } catch (e) { Logger.log('[tick] Autorizacoes: ' + e.message); }
  try { if (typeof Secretaria !== 'undefined') Secretaria.limparExpiradas(30); } catch (e) { Logger.log('[tick] Secretaria: ' + e.message); }
  // B1 · limpeza de telemetria antiga (agente_eventos/feedback) — no máx. 1x/dia.
  try {
    if (typeof _limparTelemetriaAntiga === 'function') {
      var _sp = PropertiesService.getScriptProperties();
      var _hojeTz = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
      if (_sp.getProperty('ULTIMA_LIMPEZA_TELEMETRIA') !== _hojeTz) {
        _limparTelemetriaAntiga();
        _sp.setProperty('ULTIMA_LIMPEZA_TELEMETRIA', _hojeTz);
      }
    }
  } catch (e) { Logger.log('[tick] LimpezaTelemetria: ' + e.message); }
  // 🩺 Anti-falha-silenciosa: este tick (15 min) vigia os OUTROS jobs (ex.: alertasVoz 1 min) —
  // se algum atrasou, re-arma o gatilho e avisa o dono (1x/6h).
  try { if (typeof Heartbeat !== 'undefined') Heartbeat.verificarEAlertar(); } catch (e) { Logger.log('[tick] Heartbeat: ' + e.message); }
}

/** Diagnóstico: lista tarefas e força um tick. Rode no editor. */
function testarAgenda() {
  Logger.log('Tarefas ativas: ' + JSON.stringify(Agenda.listar()));
  executarTarefasAgendadas();
  Logger.log('Tick executado.');
}
