// ===================================================================================
// Formularios.js — Integração com o GOOGLE FORMULÁRIOS (FormApp nativo do Apps Script).
// Cria formulários (com perguntas), devolve o link de resposta/edição e lê as respostas.
// Escopo: .../auth/forms (+ drive, já presente). O form é criado no Drive do proprietário.
// ===================================================================================

var Formularios = (function () {
  'use strict';

  // Cria um formulário com uma lista de perguntas.
  // perguntas: [{ titulo, tipo:'texto'|'paragrafo'|'multipla'|'caixas'|'escala', opcoes:[], obrigatoria:bool }]
  function criar(titulo, descricao, perguntas) {
    if (!titulo) throw new Error('Informe o título do formulário.');
    var form = FormApp.create(String(titulo));
    if (descricao) form.setDescription(String(descricao));
    (perguntas || []).forEach(function (q) {
      q = q || {};
      var t = String(q.tipo || 'texto').toLowerCase();
      var item;
      if (t === 'paragrafo') item = form.addParagraphTextItem();
      else if (t === 'multipla' || t === 'multiplaescolha') { item = form.addMultipleChoiceItem(); if (q.opcoes) item.setChoiceValues(q.opcoes); }
      else if (t === 'caixas' || t === 'checkbox') { item = form.addCheckboxItem(); if (q.opcoes) item.setChoiceValues(q.opcoes); }
      else if (t === 'escala') { item = form.addScaleItem().setBounds(Number(q.min) || 1, Number(q.max) || 5); }
      else if (t === 'lista' || t === 'dropdown') { item = form.addListItem(); if (q.opcoes) item.setChoiceValues(q.opcoes); }
      else item = form.addTextItem();
      if (q.titulo) item.setTitle(String(q.titulo));
      if (q.obrigatoria && item.setRequired) item.setRequired(true);
    });
    return {
      status: 'success',
      id: form.getId(),
      titulo: form.getTitle(),
      linkResposta: form.getPublishedUrl(),
      linkEdicao: form.getEditUrl()
    };
  }

  /** Lê as respostas de um formulário (por id ou URL). Retorna resumo por respondente. */
  function respostas(idOuUrl, max) {
    var id = String(idOuUrl || '');
    var m = id.match(/[-\w]{25,}/); // extrai o id de uma URL, se vier URL
    var form = m ? FormApp.openById(m[0]) : FormApp.openById(id);
    var resps = form.getResponses();
    var lim = max || 50;
    var out = resps.slice(-lim).map(function (r) {
      return {
        em: r.getTimestamp(),
        itens: r.getItemResponses().map(function (ir) { return { pergunta: ir.getItem().getTitle(), resposta: ir.getResponse() }; })
      };
    });
    return { status: 'success', titulo: form.getTitle(), total: resps.length, respostas: out };
  }

  return { criar: criar, respostas: respostas };
})();

/** Diagnóstico: cria um formulário de teste. Rode no editor (força consentimento do escopo forms). */
function testarFormularios() {
  var r = Formularios.criar('Formulário de Teste — Jarvis', 'Criado pelo diagnóstico.', [
    { titulo: 'Seu nome?', tipo: 'texto', obrigatoria: true },
    { titulo: 'Como avalia o Jarvis?', tipo: 'escala', min: 1, max: 5 }
  ]);
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
