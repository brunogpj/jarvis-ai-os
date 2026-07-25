// ===================================================================================
// Gmail.js — Pacote avançado de Gmail para o Jarvis (nativo GmailApp; NÃO usa IA/Gemini).
// Pesquisar, ler conteúdo, enviar, responder, encaminhar, marcar lido/não-lido, arquivar,
// excluir (Lixeira), rótulos, spam e anexos. Operações por ID de mensagem (getMessageById).
// Ações externas/destrutivas (enviar/responder/encaminhar/excluir) passam pelo gate P2 e
// são restritas ao dono (Zero-Trust) — a gatilhagem fica no Jarvis.js.
// Escopo: https://mail.google.com/ (já presente em appsscript.json).
// ===================================================================================

var Gmail = (function () {
  'use strict';

  function _msg(id) {
    if (!id) throw new Error('Informe o id do e-mail (use pesquisarEmails para obter o id).');
    var m = GmailApp.getMessageById(String(id));
    if (!m) throw new Error('E-mail ' + id + ' não encontrado.');
    return m;
  }

  function _resumoMsg(m) {
    return {
      id: m.getId(), de: m.getFrom(), para: m.getTo(), assunto: m.getSubject(),
      data: m.getDate().toISOString(), naoLido: m.isUnread(), anexos: m.getAttachments().length,
      trecho: String(m.getPlainBody() || '').substring(0, 160)
    };
  }

  // Busca em TODOS os e-mails (não só não lidos). query no formato do Gmail (ex.: "from:fulano is:unread").
  function pesquisar(query, max) {
    max = Math.min(Number(max) || 10, 25);
    var threads = GmailApp.search(String(query || ''), 0, max);
    var emails = threads.map(function (t) { return _resumoMsg(t.getMessages()[t.getMessageCount() - 1]); });
    return { status: 'success', total: emails.length, emails: emails };
  }

  function ler(id) {
    var m = _msg(id);
    var anexos = m.getAttachments().map(function (a) { return { nome: a.getName(), tipo: a.getContentType(), tamanhoKB: Math.round(a.getSize() / 1024) }; });
    return {
      status: 'success', id: m.getId(), de: m.getFrom(), para: m.getTo(), cc: m.getCc(),
      assunto: m.getSubject(), data: m.getDate().toISOString(), naoLido: m.isUnread(),
      corpo: String(m.getPlainBody() || '').substring(0, 8000), anexos: anexos
    };
  }

  // blobs: array de Blob já resolvidos (a resolução de nomes do Drive é feita no Jarvis.js).
  function enviar(para, assunto, corpo, blobs) {
    if (!para) throw new Error('Destinatário (para) é obrigatório.');
    // REF-1 · respeita a cota diária do GAS (evita falha silenciosa em envio único/lote).
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Cota diária de envio de e-mail esgotada — tente novamente amanhã.');
    var opts = {};
    if (blobs && blobs.length) opts.attachments = blobs;
    GmailApp.sendEmail(String(para), String(assunto || '(sem assunto)'), String(corpo || ''), opts);
    return { status: 'success', enviado: true, para: para, assunto: assunto, anexos: (blobs || []).length };
  }

  function responder(id, corpo, aTodos, blobs) {
    var m = _msg(id);
    var opts = {};
    if (blobs && blobs.length) opts.attachments = blobs;
    if (aTodos) m.replyAll(String(corpo || ''), opts); else m.reply(String(corpo || ''), opts);
    return { status: 'success', respondido: true, para: m.getFrom(), aTodos: !!aTodos };
  }

  function encaminhar(id, para, corpo, blobs) {
    if (!para) throw new Error('Destinatário (para) é obrigatório.');
    var m = _msg(id);
    var opts = {};
    if (corpo) opts.htmlBody = String(corpo).replace(/\n/g, '<br>') + '<br><br>---------- Mensagem encaminhada ----------<br>' + (m.getBody() || '');
    if (blobs && blobs.length) opts.attachments = blobs;
    m.forward(String(para), opts);
    return { status: 'success', encaminhado: true, para: para, assunto: m.getSubject() };
  }

  function marcar(id, statusLido) {
    var m = _msg(id);
    if (statusLido === 'lido') m.markRead(); else m.markUnread();
    return { status: 'success', id: m.getId(), marcado: statusLido === 'lido' ? 'lido' : 'nao_lido' };
  }

  function arquivar(id) {
    var m = _msg(id); m.getThread().moveToArchive();
    return { status: 'success', arquivado: true, assunto: m.getSubject() };
  }

  function excluir(id) {
    var m = _msg(id); var assunto = m.getSubject(); m.getThread().moveToTrash();
    return { status: 'success', excluido: assunto, nota: 'Movido para a Lixeira (recuperável por ~30 dias).' };
  }

  function rotulos(id, nomes, acao) {
    var m = _msg(id); var th = m.getThread();
    (nomes || []).forEach(function (n) {
      n = String(n || '').trim(); if (!n) return;
      var lbl = GmailApp.getUserLabelByName(n) || GmailApp.createLabel(n);
      if (acao === 'remover') th.removeLabel(lbl); else th.addLabel(lbl);
    });
    return { status: 'success', id: m.getId(), acao: acao === 'remover' ? 'remover' : 'adicionar', rotulos: nomes };
  }

  function spam(max) {
    max = Math.min(Number(max) || 10, 25);
    var threads = GmailApp.getSpamThreads(0, max);
    var emails = threads.map(function (t) { return _resumoMsg(t.getMessages()[0]); });
    return { status: 'success', total: emails.length, emails: emails };
  }

  function anexos(id, acao, pastaDestino) {
    var m = _msg(id); var ax = m.getAttachments();
    if (!ax.length) return { status: 'success', anexos: [], nota: 'Este e-mail não tem anexos.' };
    if (acao === 'baixar') {
      var pasta = DriveApp.getRootFolder();
      if (pastaDestino) {
        var it = DriveApp.getFoldersByName(String(pastaDestino));
        pasta = it.hasNext() ? it.next() : DriveApp.createFolder(String(pastaDestino));
      }
      var salvos = ax.map(function (a) { var f = pasta.createFile(a.copyBlob()); return { nome: f.getName(), url: f.getUrl() }; });
      return { status: 'success', baixados: salvos, pasta: pasta.getName() };
    }
    return { status: 'success', anexos: ax.map(function (a) { return { nome: a.getName(), tipo: a.getContentType(), tamanhoKB: Math.round(a.getSize() / 1024) }; }) };
  }

  return {
    pesquisar: pesquisar, ler: ler, enviar: enviar, responder: responder, encaminhar: encaminhar,
    marcar: marcar, arquivar: arquivar, excluir: excluir, rotulos: rotulos, spam: spam, anexos: anexos
  };
})();

/** Diagnóstico: pesquisa e lê o último e-mail. Rode no editor. */
function testarGmailAvancado() {
  var r = Gmail.pesquisar('in:inbox', 3);
  Logger.log('Pesquisa: ' + JSON.stringify(r, null, 2));
  if (r.emails && r.emails.length) Logger.log('Leitura: ' + JSON.stringify(Gmail.ler(r.emails[0].id)).substring(0, 500));
  return r;
}
