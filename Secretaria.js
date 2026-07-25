// ===================================================================================
// Secretaria.js — MODO SECRETÁRIA (rascunho + aprovação) para o WhatsApp do dono.
// Quando WHATSAPP_BOT_MODE='secretaria', o bot NÃO responde aos contatos automaticamente:
// para cada mensagem recebida (1:1), ele RASCUNHA uma resposta, NOTIFICA o dono e aguarda.
// O dono aprova/edita/ignora pelo app (ou WhatsApp, se usar número dedicado do bot).
// Pendências no Firestore ('secretaria'); expiram (TTL) para não sobrecarregar o banco.
// ===================================================================================

var Secretaria = (function () {
  'use strict';
  var COL = 'secretaria';
  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  /** Registra uma mensagem recebida + rascunho de resposta e AVISA o dono. */
  function registrar(numero, nome, recebida, rascunho) {
    var id = Utilities.getUuid().substring(0, 8);
    Firestore.setDoc(COL, id, {
      numero: String(numero || ''), nome: String(nome || numero || ''),
      recebida: String(recebida || ''), rascunho: String(rascunho || ''),
      status: 'pendente', criadoEm: Date.now()
    });
    try {
      var dono = _p('WHATSAPP_OWNER_NUMBER');
      if (dono && typeof WhatsApp !== 'undefined') {
        WhatsApp.enviar(dono,
          '💬 *Mensagem de ' + (nome || numero) + '* [' + id + ']\n"' + String(recebida).substring(0, 300) + '"\n\n' +
          '🤖 Sugiro responder:\n"' + String(rascunho).substring(0, 600) + '"\n\n' +
          'No app: *responder ' + id + '* (envia) · *responder ' + id + ': <seu texto>* (edita) · *ignorar ' + id + '*');
      }
    } catch (e) {}
    return { status: 'success', id: id };
  }

  function listar() {
    return Firestore.listDocs(COL, 50)
      .filter(function (a) { return a.dados.status === 'pendente'; })
      .sort(function (a, b) { return (b.dados.criadoEm || 0) - (a.dados.criadoEm || 0); })
      .map(function (a) { return { id: a.id, de: a.dados.nome || a.dados.numero, numero: a.dados.numero, recebida: a.dados.recebida, rascunho: a.dados.rascunho }; });
  }

  function _achar(idOuTrecho) {
    var docs = Firestore.listDocs(COL, 50).filter(function (a) { return a.dados.status === 'pendente'; });
    var alvo = String(idOuTrecho || '').toLowerCase().trim();
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].id === idOuTrecho) return docs[i];
      if (alvo && (String(docs[i].dados.nome || '').toLowerCase().indexOf(alvo) !== -1 || String(docs[i].dados.recebida || '').toLowerCase().indexOf(alvo) !== -1)) return docs[i];
    }
    return (docs.length === 1) ? docs[0] : null;
  }

  /** Aprova: envia o rascunho (ou um texto custom) ao contato. */
  function responder(idOuTrecho, textoCustom) {
    var d = _achar(idOuTrecho);
    if (!d) return { status: 'error', erro: 'Nenhuma pendência correspondente. Use listarPendentes para ver os ids.' };
    var texto = (textoCustom && String(textoCustom).trim()) ? String(textoCustom) : d.dados.rascunho;
    if (!texto) return { status: 'error', erro: 'Sem texto para enviar.' };
    var env;
    try { env = WhatsApp.enviar(d.dados.numero, texto); } catch (e) { return { status: 'error', erro: e.message }; }
    if (!env || env.status !== 'success') return { status: 'error', erro: (env && env.erro) || 'falha ao enviar' };
    try { Firestore.updateDoc(COL, d.id, { status: 'respondido', enviado: texto.substring(0, 500), atualizadoEm: Date.now() }); } catch (e) {}
    return { status: 'success', para: d.dados.nome || d.dados.numero, texto: texto };
  }

  function ignorar(idOuTrecho) {
    var d = _achar(idOuTrecho);
    if (!d) return { status: 'error', erro: 'Nenhuma pendência correspondente.' };
    try { Firestore.deleteDoc(COL, d.id); } catch (e) {}
    return { status: 'success', ignorado: d.dados.nome || d.dados.numero };
  }

  /** TTL: remove pendências antigas e resolvidas — evita acúmulo. */
  function limparExpiradas(minutos) {
    var limite = Date.now() - (Number(minutos) || 30) * 60000;
    var rem = 0;
    try {
      Firestore.listDocs(COL, 80).forEach(function (a) {
        var d = a.dados || {};
        var vencida = d.status === 'pendente' && (d.criadoEm || 0) < limite;
        var resolvidaAntiga = d.status !== 'pendente' && (d.atualizadoEm || d.criadoEm || 0) < (Date.now() - 60 * 60000);
        if (vencida || resolvidaAntiga) { try { Firestore.deleteDoc(COL, a.id); rem++; } catch (e) {} }
      });
    } catch (e) {}
    return rem;
  }

  return { registrar: registrar, listar: listar, responder: responder, ignorar: ignorar, limparExpiradas: limparExpiradas };
})();
