// ===================================================================================
// Heartbeat.js — ANTI-FALHA-SILENCIOSA (P7.1b).
// Gatilhos do GAS podem PARAR sem avisar (teto de ~90 min/dia de execução de gatilhos no
// consumer). Quando isso acontece, tarefas agendadas/alertas simplesmente deixam de rodar
// — sem erro, sem aviso. Este módulo transforma "falha silenciosa" em "falha avisada":
//   1) cada tick "bate o coração" (grava timestamp em Script Property);
//   2) um verificador detecta batidas ATRASADAS, AVISA o dono (WhatsApp, 1x/6h via cache)
//      e tenta RE-ARMAR o gatilho que sumiu;
//   3) o Dashboard lê o status() — é o observador FORA do sistema de gatilhos: mesmo que
//      TODOS os gatilhos morram, o dono vê o alerta (e o motor se re-arma) ao abrir o app.
// ===================================================================================

var Heartbeat = (function () {
  'use strict';

  var P = PropertiesService.getScriptProperties();

  // Jobs monitorados. limite = idade máx (min) antes de considerar atrasado (≈ 2+ batidas perdidas).
  // condicional = só cobra batida se o job DEVERIA estar rodando agora (ex.: alertasVoz some quando vazio).
  var JOBS = {
    agenda:     { handler: 'executarTarefasAgendadas', cadencia: 15, limite: 40 },
    alertasVoz: { handler: 'tickAlertasVoz',           cadencia: 1,  limite: 6, condicional: _temAlertasAtivos }
  };

  function _temAlertasAtivos() {
    try { return (typeof AlertasVoz !== 'undefined') && AlertasVoz.listar().length > 0; } catch (e) { return false; }
  }

  /** Registra uma batida do job (chamar no INÍCIO de cada handler de tick). */
  function bater(nome) { try { P.setProperty('HB_' + nome, String(Date.now())); } catch (e) {} }

  function _ultimo(nome) { var v = Number(P.getProperty('HB_' + nome) || 0); return isFinite(v) ? v : 0; }

  /** Status de saúde de todos os jobs (read-only) — usado pelo Dashboard. */
  function status() {
    var agora = Date.now(), itens = [], triggers = [];
    try { triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
    Object.keys(JOBS).forEach(function (nome) {
      var j = JOBS[nome];
      var ativo = j.condicional ? !!j.condicional() : true;
      var ult = _ultimo(nome);
      var idadeMin = ult ? Math.round((agora - ult) / 60000) : null;
      var atrasado = ativo && (ult === 0 || idadeMin > j.limite);
      var temTrigger = triggers.indexOf(j.handler) !== -1;
      itens.push({ nome: nome, ativo: ativo, idadeMin: idadeMin, limiteMin: j.limite, atrasado: atrasado, temTrigger: temTrigger });
    });
    return { ok: !itens.some(function (i) { return i.atrasado; }), itens: itens };
  }

  /** Re-arma o gatilho de um job que deveria rodar mas não tem trigger. Idempotente. */
  function _rearmar(nome) {
    var j = JOBS[nome]; if (!j) return false;
    try {
      var tem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === j.handler; });
      if (!tem) { ScriptApp.newTrigger(j.handler).timeBased().everyMinutes(j.cadencia).create(); return true; }
    } catch (e) { Logger.log('[Heartbeat] rearmar ' + nome + ': ' + e.message); }
    return false;
  }

  /** Verifica a saúde; se algum job atrasou: re-arma (se faltar trigger) + AVISA o dono (1x/6h). */
  function verificarEAlertar() {
    var st = status(), avisados = [];
    st.itens.forEach(function (i) {
      if (!i.atrasado) return;
      var rearmou = !i.temTrigger ? _rearmar(i.nome) : false;
      // dedup do aviso: no máx 1 a cada 6h por job (não floodar o WhatsApp do dono).
      try { var ck = CacheService.getScriptCache(), chave = 'hb_aviso_' + i.nome; if (ck.get(chave)) return; ck.put(chave, '1', 6 * 3600); } catch (e) {}
      avisados.push({ nome: i.nome, idadeMin: i.idadeMin, rearmou: rearmou });
    });
    if (avisados.length) _notificarDono(avisados);
    return { avisados: avisados, status: st };
  }

  function _notificarDono(avisados) {
    var linhas = avisados.map(function (a) {
      var quando = (a.idadeMin == null) ? 'sem registro de batida' : ('parado há ~' + a.idadeMin + ' min');
      return '• ' + a.nome + ' (' + quando + ')' + (a.rearmou ? ' — gatilho re-armado ✅' : '');
    });
    var msg = '🩺 *Jarvis — saúde do motor*\nUm processo de fundo pode ter parado (cota de gatilhos?):\n'
            + linhas.join('\n') + '\n\nSe persistir, rode `statusJarvis` / reinstale os gatilhos no editor.';
    try { var num = P.getProperty('WHATSAPP_OWNER_NUMBER'); if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, msg); } catch (e) { Logger.log('[Heartbeat] notificar: ' + e.message); }
    try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[heartbeat] ' + linhas.join(' | ')); } catch (e) {}
  }

  return { bater: bater, status: status, verificarEAlertar: verificarEAlertar };
})();

/** Diagnóstico manual no editor: imprime a saúde dos gatilhos. */
function statusHeartbeat() { var s = Heartbeat.status(); Logger.log(JSON.stringify(s, null, 2)); return s; }
/** Força a verificação + aviso + re-arme (teste no editor). */
function verificarHeartbeat() { return Heartbeat.verificarEAlertar(); }
