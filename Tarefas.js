// ===================================================================================
// Tarefas.js — Integração com o GOOGLE TAREFAS (Google Tasks) via REST.
// Usa o token OAuth do próprio script (ScriptApp.getOAuthToken) — o web app roda como o
// proprietário (USER_DEPLOYING), então acessa as tarefas do dono. Escopo: .../auth/tasks.
// NÃO confundir com Agenda.js (tarefas AGENDADAS/proativas do Jarvis) — aqui é o app Google Tarefas.
// ===================================================================================

var Tarefas = (function () {
  'use strict';

  var BASE = 'https://tasks.googleapis.com/tasks/v1';

  function _req(method, path, body) {
    var opt = {
      method: method, muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    };
    if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
    var res = UrlFetchApp.fetch(BASE + path, opt);
    var code = res.getResponseCode();
    var txt = res.getContentText();
    if (code >= 400) throw new Error('Google Tasks HTTP ' + code + ': ' + String(txt).substring(0, 180));
    return txt ? JSON.parse(txt) : {};
  }

  /** Resolve o id de uma lista pelo título (ou a lista padrão @default se não informar). */
  function _resolverLista(nomeLista) {
    if (!nomeLista) return '@default';
    var lists = (_req('get', '/users/@me/lists').items) || [];
    var alvo = String(nomeLista).toLowerCase().trim();
    for (var i = 0; i < lists.length; i++) {
      if (String(lists[i].title || '').toLowerCase().indexOf(alvo) !== -1) return lists[i].id;
    }
    return '@default';
  }

  /** Lista as tarefas (pendentes por padrão) de uma lista. */
  function listar(opts) {
    opts = opts || {};
    var lista = _resolverLista(opts.lista);
    var q = '?showCompleted=' + (opts.incluirConcluidas ? 'true' : 'false') + '&maxResults=' + (opts.max || 50);
    var r = _req('get', '/lists/' + encodeURIComponent(lista) + '/tasks' + q);
    return (r.items || []).map(function (t) {
      return { id: t.id, titulo: t.title || '(sem título)', notas: t.notes || '', status: t.status, vencimento: t.due || '' };
    });
  }

  /** Adiciona uma tarefa. due = data ISO (YYYY-MM-DD) opcional. */
  function adicionar(titulo, notas, due, nomeLista) {
    if (!titulo) throw new Error('Informe o título da tarefa.');
    var lista = _resolverLista(nomeLista);
    var body = { title: String(titulo) };
    if (notas) body.notes = String(notas);
    if (due) body.due = (String(due).length === 10 ? (due + 'T00:00:00.000Z') : String(due)); // RFC3339
    var t = _req('post', '/lists/' + encodeURIComponent(lista) + '/tasks', body);
    return { status: 'success', id: t.id, titulo: t.title };
  }

  /** Marca uma tarefa como concluída (busca por trecho do título na lista). */
  function concluir(tituloOuId, nomeLista) {
    var lista = _resolverLista(nomeLista);
    var id = tituloOuId;
    // se não for um id direto, procura por trecho do título
    var itens = (_req('get', '/lists/' + encodeURIComponent(lista) + '/tasks?maxResults=100').items) || [];
    var achou = null;
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].id === tituloOuId) { achou = itens[i]; break; }
      if (String(itens[i].title || '').toLowerCase().indexOf(String(tituloOuId).toLowerCase()) !== -1) { achou = achou || itens[i]; }
    }
    if (!achou) return { status: 'error', erro: 'Tarefa "' + tituloOuId + '" não encontrada.' };
    _req('patch', '/lists/' + encodeURIComponent(lista) + '/tasks/' + encodeURIComponent(achou.id), { status: 'completed' });
    return { status: 'success', concluida: achou.title };
  }

  /** EXCLUI (deleta) uma tarefa de vez — diferente de concluir. Busca por trecho do título. */
  function deletar(tituloOuId, nomeLista) {
    var lista = _resolverLista(nomeLista);
    var itens = (_req('get', '/lists/' + encodeURIComponent(lista) + '/tasks?showCompleted=true&maxResults=100').items) || [];
    var achou = null;
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].id === tituloOuId) { achou = itens[i]; break; }
      if (String(itens[i].title || '').toLowerCase().indexOf(String(tituloOuId).toLowerCase()) !== -1) { achou = achou || itens[i]; }
    }
    if (!achou) return { status: 'error', erro: 'Tarefa "' + tituloOuId + '" não encontrada.' };
    _req('delete', '/lists/' + encodeURIComponent(lista) + '/tasks/' + encodeURIComponent(achou.id));
    return { status: 'success', excluida: achou.title };
  }

  return { listar: listar, adicionar: adicionar, concluir: concluir, deletar: deletar };
})();

/** Diagnóstico: lista as tarefas do Google. Rode no editor (força consentimento do escopo tasks). */
function testarTarefas() {
  var t = Tarefas.listar({});
  Logger.log('Tarefas pendentes: ' + JSON.stringify(t, null, 2));
  return t;
}
