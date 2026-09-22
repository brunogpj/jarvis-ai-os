// ===================================================================================
// Objetivos.js — Autonomia por OBJETIVO (goal-driven). P4.
// O usuário define uma META de alto nível; o Jarvis PLANEJA subtarefas, EXECUTA cada uma
// em modo autônomo (reusa o loop ReAct via Jarvis.ask interativo:false), ACUMULA os
// resultados e SINTETIZA o desfecho — entregando no WhatsApp do dono + log do wiki.
// Estado persistido no Firestore ('objetivos'): plano[], passoAtual, resultados[], status.
// Fluxo no chat: definirObjetivo → mostra o PLANO p/ confirmação → "sim" → executa sozinho.
// ===================================================================================

var Objetivos = (function () {
  'use strict';

  var COL = 'objetivos';
  var MAX_PASSOS = 6;   // execução em segundo plano (Jobs/daisy-chain) → não limitado pelo tempo do request

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  // Extrai o texto puro de uma resposta do Gemini.gerar({...}).
  function _texto(r) {
    try {
      var parts = ((((r.json || {}).candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map(function (p) { return p.text || ''; }).join('').trim();
    } catch (e) { return ''; }
  }

  /** PLANEJA: quebra o objetivo em 2..MAX_PASSOS passos concretos e autossuficientes. */
  function planejar(objetivo) {
    var prompt =
      'Você é um planejador para um agente de IA pessoal (Jarvis) que tem ferramentas: ler/escrever wiki, ' +
      'pesquisar na web, Google Workspace (Calendar/Gmail/Drive), WhatsApp (ler/enviar/áudio/imagem) e gerar imagem. ' +
      'Quebre o OBJETIVO abaixo em uma lista ENXUTA (2 a ' + MAX_PASSOS + ') de passos concretos, na ordem certa. ' +
      'Cada passo deve ser uma instrução COMPLETA e autossuficiente que o agente execute sozinho (sem perguntar ao usuário). ' +
      'IMPORTANTE: quando o objetivo disser "me avise/me envie/no meu WhatsApp/para mim", o destinatário é o PRÓPRIO dono — escreva o passo usando o contato "eu" (ex.: "Enviar o resumo em áudio no WhatsApp para eu"). NUNCA invente nomes de contato nem use e-mail como contato de WhatsApp. ' +
      'Não inclua passos triviais. Responda SOMENTE com um array JSON de strings.\n\nOBJETIVO: ' + objetivo;
    var r = Gemini.gerar({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    });
    var txt = _texto(r);
    var arr = [];
    try { arr = JSON.parse(txt); }
    catch (e) { var m = txt.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (e2) {} } }
    if (!Array.isArray(arr)) arr = [];
    return arr.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, MAX_PASSOS);
  }

  /** Cria o objetivo (status 'planejado') e devolve { id, plano }. */
  function criar(email, objetivo) {
    var plano = planejar(objetivo);
    if (!plano.length) throw new Error('Não consegui planejar passos para esse objetivo. Reformule de forma mais concreta.');
    var id = Utilities.getUuid();
    Firestore.setDoc(COL, id, {
      objetivo: String(objetivo || ''), email: email || '', plano: plano, status: 'planejado',
      passoAtual: 0, resultados: [], criadoEm: Date.now(), atualizadoEm: Date.now()
    });
    return { id: id, plano: plano };
  }

  /**
   * Executa os passos pendentes do objetivo de forma autônoma; sintetiza e notifica.
   * @param {string} id
   * @param {number} [inicio]  Date.now() do início do lote (p/ orçamento de tempo — uso em Jobs).
   * @param {number} [budget]  Orçamento em ms; se estourar entre passos, devolve { continuar:true } (retoma depois).
   * É RESUMÍVEL: lê d.passoAtual/d.resultados e continua de onde parou (persiste a cada passo).
   */
  function executar(id, inicio, budget) {
    var d = Firestore.getDoc(COL, id);
    if (!d) return { status: 'error', erro: 'objetivo não encontrado' };
    if (d.status === 'concluido') return { status: 'success', sintese: d.sintese || 'já concluído', plano: d.plano, resultados: d.resultados };
    var owner = _p('OWNER_EMAIL');
    var email = d.email || owner;
    var plano = d.plano || [];
    var resultados = d.resultados || [];
    Firestore.updateDoc(COL, id, { status: 'em_andamento', atualizadoEm: Date.now() });

    for (var i = (d.passoAtual || 0); i < plano.length && i < MAX_PASSOS; i++) {
      // Daisy-chain: se o orçamento de tempo estourou, salva progresso e retoma na próxima execução.
      if (inicio && budget && (Date.now() - inicio > budget)) {
        return { status: 'em_andamento', continuar: true, passoAtual: i, totalPassos: plano.length };
      }
      var contexto = resultados.length
        ? ('\n\nResultados dos passos anteriores:\n' + resultados.map(function (r, idx) { return (idx + 1) + ') ' + r; }).join('\n').substring(0, 4000))
        : '';
      var instr = 'OBJETIVO GERAL: ' + d.objetivo +
        '\n\nEXECUTE AGORA SOMENTE ESTE PASSO (' + (i + 1) + '/' + plano.length + '): ' + plano[i] + contexto;
      var resp = '';
      try { resp = String(Jarvis.ask(email, instr, [], null, { interativo: false })); }
      catch (e) { resp = '⚠️ ' + e.message; }
      resultados.push(resp.substring(0, 1500));
      try { Firestore.updateDoc(COL, id, { passoAtual: i + 1, resultados: resultados, atualizadoEm: Date.now() }); } catch (e) {}
    }

    // SÍNTESE final do desfecho.
    var sintese = '';
    try {
      var sr = Gemini.gerar({ contents: [{ role: 'user', parts: [{ text:
        'Um agente executou um objetivo em passos. Escreva um RESUMO final ao usuário (3-5 frases), em português, tom direto, ' +
        'dizendo o que foi realizado e o desfecho.\n\nOBJETIVO: ' + d.objetivo +
        '\n\nRESULTADOS:\n' + resultados.map(function (r, idx) { return (idx + 1) + ') ' + r; }).join('\n\n')
      }] }] });
      sintese = _texto(sr) || ('✅ Objetivo processado em ' + resultados.length + ' passos.');
    } catch (e) { sintese = '✅ Objetivo processado em ' + resultados.length + ' passos.'; }

    Firestore.updateDoc(COL, id, { status: 'concluido', sintese: sintese.substring(0, 1500), atualizadoEm: Date.now() });
    try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[objetivo] ' + d.objetivo + ' → ' + sintese.substring(0, 150)); } catch (e) {}
    try {
      var num = _p('WHATSAPP_OWNER_NUMBER');
      if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '🎯 Objetivo concluído — ' + String(d.objetivo).substring(0, 80) + ':\n\n' + sintese.substring(0, 1400));
    } catch (e) {}
    return { status: 'success', plano: plano, resultados: resultados, sintese: sintese };
  }

  function listar() {
    return Firestore.listDocs(COL, 50)
      .sort(function (a, b) { return (b.dados.criadoEm || 0) - (a.dados.criadoEm || 0); })
      .map(function (o) {
        return { id: o.id, objetivo: o.dados.objetivo, status: o.dados.status, passoAtual: o.dados.passoAtual, totalPassos: (o.dados.plano || []).length };
      });
  }

  /** Acha o objetivo 'planejado' mais recente do usuário (usado ao confirmar sem id). */
  function ultimoPlanejado(email) {
    var pend = Firestore.listDocs(COL, 50)
      .filter(function (o) { return o.dados.status === 'planejado' && (!email || o.dados.email === email); })
      .sort(function (a, b) { return (b.dados.criadoEm || 0) - (a.dados.criadoEm || 0); });
    return pend.length ? pend[0].id : '';
  }

  function cancelar(idOuTrecho) {
    var alvo = String(idOuTrecho || '').toLowerCase().trim();
    var rem = 0;
    Firestore.listDocs(COL, 50).forEach(function (o) {
      if (o.id === idOuTrecho || String(o.dados.objetivo || '').toLowerCase().indexOf(alvo) !== -1) {
        try { Firestore.deleteDoc(COL, o.id); rem++; } catch (e) {}
      }
    });
    return { status: 'success', removidos: rem };
  }

  return { planejar: planejar, criar: criar, executar: executar, listar: listar, ultimoPlanejado: ultimoPlanejado, cancelar: cancelar };
})();

/** Diagnóstico: planeja + executa um objetivo de teste. Rode no editor. */
function testarObjetivo() {
  var r = Objetivos.criar(String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || ''), 'Pesquise as principais novidades do Google Gemini em 2025 e salve um resumo curto no meu wiki.');
  Logger.log('Plano: ' + JSON.stringify(r.plano));
  var x = Objetivos.executar(r.id);
  Logger.log('Síntese: ' + (x.sintese || x.erro));
  return x;
}
