// ===================================================================================
// Autorizacoes.js — Ponte de autorização (human-in-the-loop) para pedidos de TERCEIROS.
// Quando um número NÃO-dono pede no WhatsApp uma ação restrita ao proprietário (enviar
// arquivo/áudio/imagem, agir em nome dele), o bot NÃO executa: registra o pedido, AVISA o
// dono e aguarda. O dono autoriza/nega pelo app; ao autorizar, o pedido é executado COMO o
// dono e o resultado é entregue ao solicitante. Estado no Firestore ('autorizacoes').
// ===================================================================================

var Autorizacoes = (function () {
  'use strict';
  var COL = 'autorizacoes';
  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }
  // Nome do dono (para falar como humano com o contato, sem revelar que é assistente).
  function _nomeDono() {
    var n = _p('OWNER_NAME');
    if (n) return n;
    var em = _p('OWNER_EMAIL') || 'brunogpj';
    var base = String(em).split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim();
    return base ? (base.charAt(0).toUpperCase() + base.slice(1).split(' ')[0]) : 'Bruno';
  }

  /** Terceiro solicita uma ação restrita → registra e avisa o dono. */
  function solicitar(deNumero, deNome, pedido) {
    var id = Utilities.getUuid().substring(0, 8);
    Firestore.setDoc(COL, id, {
      deNumero: String(deNumero || ''), deNome: String(deNome || deNumero || ''),
      pedido: String(pedido || ''), status: 'pendente', criadoEm: Date.now()
    });
    try {
      var num = _p('WHATSAPP_OWNER_NUMBER');
      if (num && typeof WhatsApp !== 'undefined') {
        WhatsApp.enviar(num, '🔐 *Pedido de autorização* [' + id + ']\nDe: ' + (deNome || deNumero) + ' (' + deNumero + ')\nPedido: "' + String(pedido).substring(0, 400) + '"\n\nResponda AQUI: "Jarvis autorizar ' + id + '" (ou "Jarvis negar ' + id + '") — ou diga o mesmo no app.');
      }
    } catch (e) {}
    return { status: 'success', id: id, info: 'Registrado. Responda ao contato APENAS com algo natural e curto tipo "deixa eu verificar isso e já te retorno 😊". PROIBIDO mencionar autorização/proprietário/permissão — o contato não pode saber da aprovação interna.' };
  }

  function listar() {
    return Firestore.listDocs(COL, 50)
      .filter(function (a) { return a.dados.status === 'pendente'; })
      .sort(function (a, b) { return (b.dados.criadoEm || 0) - (a.dados.criadoEm || 0); })
      .map(function (a) { return { id: a.id, de: a.dados.deNome || a.dados.deNumero, numero: a.dados.deNumero, pedido: a.dados.pedido }; });
  }

  function _achar(idOuTrecho) {
    var docs = Firestore.listDocs(COL, 50).filter(function (a) { return a.dados.status === 'pendente'; });
    var alvo = String(idOuTrecho || '').toLowerCase().trim();
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].id === idOuTrecho) return docs[i];
      if (alvo && (String(docs[i].dados.deNome || '').toLowerCase().indexOf(alvo) !== -1 || String(docs[i].dados.pedido || '').toLowerCase().indexOf(alvo) !== -1)) return docs[i];
    }
    return (docs.length === 1) ? docs[0] : null; // se só há 1 pendente, assume-o
  }

  /** Dono autoriza → executa o pedido COMO dono (Jarvis.ask owner) e entrega ao solicitante. */
  function autorizar(idOuTrecho) {
    var d = _achar(idOuTrecho);
    if (!d) return { status: 'error', erro: 'Nenhum pedido pendente correspondente. Use listarAutorizacoes para ver os ids.' };
    var owner = _p('OWNER_EMAIL') || 'owner';
    var instr = d.dados.pedido +
      '\n\n[CONTEXTO: o proprietário AUTORIZOU este pedido feito por ' + (d.dados.deNome || 'um contato') + ' (' + d.dados.deNumero + '). Execute a ação AGORA. Se for enviar algo no WhatsApp, envie para o número ' + d.dados.deNumero +
      ' e ACOMPANHE com uma mensagem NATURAL, simpática e humanizada ao contato — NÃO mencione "autorização do proprietário", apenas atenda como se fosse o fluxo normal da conversa.]';
    var resp = '';
    try { resp = String(Jarvis.ask(owner, instr, [], null, { interativo: false })); }
    catch (e) { resp = '⚠️ ' + e.message; }
    try { Firestore.updateDoc(COL, d.id, { status: 'autorizado', resultado: resp.substring(0, 500), atualizadoEm: Date.now() }); } catch (e) {}
    // (sem aviso robótico ao contato — o próprio Jarvis já respondeu de forma natural acima.)
    return { status: 'success', atendido: d.dados.pedido, para: d.dados.deNumero, resultado: resp };
  }

  function negar(idOuTrecho) {
    var d = _achar(idOuTrecho);
    if (!d) return { status: 'error', erro: 'Nenhum pedido pendente correspondente.' };
    try { Firestore.updateDoc(COL, d.id, { status: 'negado', atualizadoEm: Date.now() }); } catch (e) {}
    // SEGURANÇA: o contato NUNCA pode saber que houve "autorização/recusa do proprietário".
    // Recusa NATURAL e humanizada (1ª pessoa), sem citar dono/autorização/permissão — como se o
    // próprio dono (com quem o contato pensa que fala) declinasse no fluxo normal da conversa.
    try {
      if (d.dados.deNumero && typeof WhatsApp !== 'undefined')
        WhatsApp.enviar(d.dados.deNumero, 'Oi! Consegui dar uma olhada aqui, mas não vou conseguir te ajudar com isso agora 🙏 Qualquer coisa, a gente se fala!');
    } catch (e) {}
    return { status: 'success', negado: d.dados.pedido };
  }

  /**
   * ACOMPANHAMENTO (chamado no tick): se um pedido fica pendente por mais de `minDemora` minutos,
   * re-lembra o DONO UMA vez. NÃO manda 2ª mensagem ao contato — ele já recebeu o "deixa eu verificar
   * e já te retorno" na 1ª interação; insistir com o contato é desnecessário (decisão do dono).
   */
  function acompanharPendentes(minDemora) {
    var limite = Date.now() - (Number(minDemora) || 8) * 60000;
    var num = _p('WHATSAPP_OWNER_NUMBER');
    var nome = _nomeDono();
    try {
      Firestore.listDocs(COL, 50).forEach(function (a) {
        var d = a.dados || {};
        if (d.status !== 'pendente' || d.acompanhado || (d.criadoEm || 0) > limite) return;
        try { if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '⏰ *Lembrete* — o pedido [' + a.id + '] de ' + (d.deNome || d.deNumero) + ' ainda aguarda você:\n"' + String(d.pedido || '').substring(0, 200) + '"'); } catch (e) {}
        try { Firestore.updateDoc(COL, a.id, { acompanhado: true, acompanhadoEm: Date.now() }); } catch (e) {}
      });
    } catch (e) {}
  }

  /** Limpa pedidos PENDENTES muito antigos e resolvidos — evita acúmulo no Firestore. (Sem mensagem dura ao contato: ele já foi tranquilizado pelo acompanhamento.) */
  function limparExpiradas(minutos) {
    var limite = Date.now() - (Number(minutos) || 180) * 60000;
    var rem = 0;
    try {
      Firestore.listDocs(COL, 80).forEach(function (a) {
        var d = a.dados || {};
        var vencido = d.status === 'pendente' && (d.criadoEm || 0) < limite;
        var resolvidoAntigo = (d.status === 'autorizado' || d.status === 'negado') && (d.atualizadoEm || d.criadoEm || 0) < (Date.now() - 60 * 60000);
        if (vencido || resolvidoAntigo) {
          try { Firestore.deleteDoc(COL, a.id); rem++; } catch (e) {}
        }
      });
    } catch (e) {}
    return rem;
  }

  return { solicitar: solicitar, listar: listar, autorizar: autorizar, negar: negar, acompanharPendentes: acompanharPendentes, limparExpiradas: limparExpiradas };
})();
