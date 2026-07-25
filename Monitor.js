// ===================================================================================
// Monitor.js — Autonomia dirigida por EVENTO. Monitora o Gmail e, quando chega algo
// relevante (filtro configurável), aciona o Jarvis para resumir/agir e avisa no WhatsApp.
// Reusa o MESMO tick do agendador (executarTarefasAgendadas chama Monitor.verificar()).
// Config em Script Property GMAIL_MONITOR. Requer escopo gmail + script.scriptapp.
// ===================================================================================

var Monitor = (function () {
  'use strict';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }
  var TICK = 'executarTarefasAgendadas'; // tick compartilhado com a Agenda

  function _garantirTick() {
    try {
      var jaTem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === TICK; });
      if (!jaTem) ScriptApp.newTrigger(TICK).timeBased().everyMinutes(15).create();
    } catch (e) { Logger.log('[Monitor] _garantirTick falhou: ' + e.message); }
  }

  /** Configura o monitor de Gmail. query = filtro Gmail; acao = o que o Jarvis deve fazer. */
  function configurar(query, acao) {
    PropertiesService.getScriptProperties().setProperty('GMAIL_MONITOR', JSON.stringify({
      query: query || 'is:unread is:important',
      acao: acao || 'Resuma cada e-mail em 1-2 frases e destaque se exige ação minha (e qual).',
      ultimaVerificacao: Date.now(),
      ativo: true
    }));
    _garantirTick();
    return { status: 'success', info: 'Monitor de Gmail ativo (filtro: ' + (query || 'is:unread is:important') + '). Verifico a cada ~15 min e te aviso no WhatsApp.' };
  }

  function desativar() {
    var raw = _p('GMAIL_MONITOR');
    if (!raw) return { status: 'success', info: 'Não havia monitor ativo.' };
    var cfg = JSON.parse(raw); cfg.ativo = false;
    PropertiesService.getScriptProperties().setProperty('GMAIL_MONITOR', JSON.stringify(cfg));
    return { status: 'success', info: 'Monitor de Gmail desativado.' };
  }

  function status() {
    var raw = _p('GMAIL_MONITOR');
    return raw ? JSON.parse(raw) : { ativo: false };
  }

  /** Chamado pelo tick: processa e-mails novos desde a última verificação.
   *  forcar=true (teste): ignora o corte de tempo e processa os recentes que casam. */
  function verificar(forcar) {
    var raw = _p('GMAIL_MONITOR');
    if (!raw) { Logger.log('[Monitor] sem GMAIL_MONITOR configurado.'); return; }
    var cfg; try { cfg = JSON.parse(raw); } catch (e) { return; }
    if (!cfg.ativo) { Logger.log('[Monitor] inativo.'); return; }

    var corte = forcar ? 0 : Number(cfg.ultimaVerificacao || 0);
    var novos = [];
    try {
      var threads = GmailApp.search(cfg.query + ' newer_than:2d', 0, 15);
      threads.forEach(function (t) {
        var msgs = t.getMessages();
        var m = msgs[msgs.length - 1];
        if (m.getDate().getTime() > corte) {
          novos.push({ de: m.getFrom(), assunto: t.getFirstMessageSubject(), trecho: m.getPlainBody().substring(0, 500) });
        }
      });
      Logger.log('[Monitor] query="' + cfg.query + '" → threads=' + threads.length + ', novos=' + novos.length + (forcar ? ' (forçado)' : ''));
    } catch (e) { Logger.log('[Monitor] busca Gmail falhou: ' + e.message); return; }

    if (novos.length) {
      var owner = _p('OWNER_EMAIL');
      var num = _p('WHATSAPP_OWNER_NUMBER');
      var lista = novos.slice(0, 5).map(function (n, i) {
        return (i + 1) + ') De: ' + n.de + '\n   Assunto: ' + n.assunto + '\n   Trecho: ' + n.trecho;
      }).join('\n\n');
      var instrucao = 'MONITOR DE E-MAIL: chegaram ' + novos.length + ' e-mail(s) novo(s) que correspondem ao filtro. ' +
        cfg.acao + '\n\nE-mails:\n' + lista;
      var resp = '';
      try { resp = Jarvis.ask(owner, instrucao, [], null, { interativo: false }); } catch (e) { resp = '⚠️ ' + e.message; }
      try { if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '📬 Monitor de e-mail — ' + novos.length + ' novo(s):\n\n' + String(resp).substring(0, 1500)); } catch (e) {}
      try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[monitor-gmail] ' + novos.length + ' e-mail(s) → ' + String(resp).substring(0, 150)); } catch (e) {}
    }

    cfg.ultimaVerificacao = Date.now();
    PropertiesService.getScriptProperties().setProperty('GMAIL_MONITOR', JSON.stringify(cfg));
  }

  return { configurar: configurar, desativar: desativar, status: status, verificar: verificar };
})();

/** Diagnóstico: força uma verificação do monitor IGNORANDO o corte de tempo
 *  (processa e-mails recentes que casam com o filtro). Rode no editor. */
function testarMonitorGmail() {
  Logger.log('Config: ' + JSON.stringify(Monitor.status()));
  Monitor.verificar(true); // forçado: ignora ultimaVerificacao
  Logger.log('Verificação (forçada) executada — veja as linhas [Monitor] acima.');
}
