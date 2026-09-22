// ===================================================================================
// MemoriaConversas.js — P-B · Memória de conversas como BASE DE CONHECIMENTO durável.
// (inspirado em Knowledge Bases / Agent Kernel: sessão = curto prazo; KB = conhecimento
//  reutilizável ENTRE sessões.) Indexa os pares Pergunta→Resposta de conversas PASSADAS
// como VETORES (Gemini embeddings) no Firestore ('conversa_vetores') e permite recall
// SEMÂNTICO cross-conversa — o agente "lembra" do que já foi conversado em outras threads.
//
// Escopo por usuário (campo `email`) — Zero-Trust: cada um só recupera as próprias conversas.
// Indexação RESUMÍVEL (pula pares já indexados) e com orçamento de tempo do GAS + aborto em quota.
// ===================================================================================

var MemoriaConversas = (function () {
  'use strict';
  var COL = 'conversa_vetores';

  function _hash(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'c' + (h >>> 0).toString(36);
  }

  function _cosseno(a, b) {
    a = a || []; b = b || [];
    var n = Math.min(a.length, b.length), dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // Constrói as UNIDADES de memória (pares pergunta→resposta) de uma conversa.
  // Pareia cada turno 'user' com o 'assistant' seguinte (no persistir, assistant.ts = user.ts+1).
  function _unidades(msgs) {
    msgs = (msgs || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.role !== 'user') continue;
      var pergunta = String(m.text || '').trim();
      if (!pergunta) continue;
      var resp = '';
      for (var j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === 'assistant') { resp = String(msgs[j].text || '').trim(); break; }
        if (msgs[j].role === 'user') break;
      }
      // Ignora ruído/erros que não valem como memória durável.
      if (/^[⚠️🔁]/.test(resp) || (pergunta.length < 4 && !resp)) continue;
      out.push({ ts: m.ts || 0, trecho: ('Pergunta: ' + pergunta + (resp ? ('\nResposta: ' + resp) : '')).substring(0, 1500) });
    }
    return out;
  }

  /**
   * Indexa as conversas passadas em vetores. RESUMÍVEL: pula pares já indexados.
   * @param {Object} [opts] { budgetMs, maxPares, forcar, somenteEmail }
   * @return {Object} { status, conversas, pares, pulados, restantes?, erro1 }
   */
  function indexar(opts) {
    opts = opts || {};
    var inicio = Date.now();
    var budget = opts.budgetMs || (4 * 60 * 1000);
    var maxPares = opts.maxPares || 60;
    var pares = 0, pulados = 0, conversas = 0, erro1 = '';

    var usuarios = Firestore.listDocs('usuarios', 1000);
    for (var u = 0; u < usuarios.length; u++) {
      var uid = usuarios[u].id;
      var email = (usuarios[u].dados && usuarios[u].dados.email) || '';
      if (opts.somenteEmail && email !== opts.somenteEmail) continue;

      var convs;
      try { convs = Firestore.listDocs('usuarios/' + uid + '/conversas', 200); } catch (e) { continue; }
      for (var c = 0; c < convs.length; c++) {
        if (Date.now() - inicio > budget || pares >= maxPares) {
          return { status: 'continuar', conversas: conversas, pares: pares, pulados: pulados, restantes: convs.length - c, erro1: erro1 };
        }
        var convId = convs[c].id;
        var titulo = (convs[c].dados && convs[c].dados.titulo) || '';
        var msgs;
        try {
          msgs = Firestore.listDocs('usuarios/' + uid + '/conversas/' + convId + '/mensagens', 500)
            .map(function (m) { return { role: m.dados.role, text: m.dados.text, ts: Number(m.dados.ts || 0) }; });
        } catch (e) { continue; }
        var base = _hash(uid + '|' + convId);
        var unidades = _unidades(msgs);
        conversas++;
        for (var k = 0; k < unidades.length; k++) {
          if (Date.now() - inicio > budget || pares >= maxPares) {
            return { status: 'continuar', conversas: conversas, pares: pares, pulados: pulados, restantes: convs.length - c, erro1: erro1 };
          }
          var docId = base + '_' + unidades[k].ts;
          if (!opts.forcar) {
            try { if (Firestore.getDoc(COL, docId)) { pulados++; continue; } } catch (e) {}
          }
          try {
            var vec = Gemini.embeddar(unidades[k].trecho, { tipo: 'RETRIEVAL_DOCUMENT' });
            if (vec && vec.length) {
              Firestore.setDoc(COL, docId, {
                uid: uid, email: email, conversaId: convId, titulo: titulo,
                trecho: unidades[k].trecho, ts: unidades[k].ts, vetor: JSON.stringify(vec), atualizadoEm: Date.now()
              });
              pares++;
            } else if (!erro1) { erro1 = 'embeddar retornou vetor vazio'; }
          } catch (e) {
            var msg = String(e && e.message || e);
            if (!erro1) erro1 = msg;
            if (/\b429\b|spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
              return { status: 'abortado', motivo: 'quota/limite de gasto', erro1: msg, conversas: conversas, pares: pares, pulados: pulados };
            }
          }
        }
      }
    }
    return { status: 'success', conversas: conversas, pares: pares, pulados: pulados, erro1: erro1 };
  }

  /**
   * Busca semântica nas conversas passadas DO USUÁRIO (scope por email).
   * @return [{ conversaId, titulo, trecho, ts, score }]
   */
  function buscar(email, consulta, k) {
    k = k || 5;
    if (!email) return [];
    var qv = Gemini.embeddar(consulta, { tipo: 'RETRIEVAL_QUERY' });
    var docs = Firestore.listDocs(COL, 2000);
    var scored = docs
      .filter(function (d) { return d.dados && d.dados.email === email; })
      .map(function (d) {
        var vv = d.dados.vetor; if (typeof vv === 'string') { try { vv = JSON.parse(vv); } catch (e) { vv = []; } }
        return { conversaId: d.dados.conversaId, titulo: d.dados.titulo, trecho: d.dados.trecho, ts: d.dados.ts, score: _cosseno(qv, vv || []) };
      });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, k);
  }

  function status(email) {
    var docs = Firestore.listDocs(COL, 2000);
    if (email) docs = docs.filter(function (d) { return d.dados && d.dados.email === email; });
    var convs = {};
    docs.forEach(function (d) { convs[(d.dados || {}).conversaId] = 1; });
    return { pares: docs.length, conversas: Object.keys(convs).length };
  }

  function limpar() {
    var n = 0;
    Firestore.listDocs(COL, 2000).forEach(function (d) { try { Firestore.deleteDoc(COL, d.id); n++; } catch (e) {} });
    return n;
  }

  return { indexar: indexar, buscar: buscar, status: status, limpar: limpar };
})();

/** Indexa a memória de conversas (resumível). Rode no editor; re-rode se vier "continuar". */
function indexarMemoriaConversas() {
  if (typeof Gemini === 'undefined' || !Gemini.temChave()) { Logger.log('❌ GEMINI_API_KEY ausente.'); return; }
  var r = MemoriaConversas.indexar({});
  Logger.log(JSON.stringify(r));
  if (r.status === 'abortado') {
    Logger.log('🛑 Indexação abortada (' + r.motivo + '): ' + r.erro1 + '\n→ Ajuste o teto de gasto e rode de novo.');
  } else if (r.status === 'continuar') {
    Logger.log('⏳ Orçamento atingido — rode indexarMemoriaConversas() de novo para CONTINUAR (' + r.restantes + ' conversas restantes nesta fatia).');
  } else {
    Logger.log('✅ Indexação concluída. ' + r.pares + ' pares novos, ' + r.pulados + ' já indexados, ' + r.conversas + ' conversas varridas.');
  }
  Logger.log('Índice atual: ' + JSON.stringify(MemoriaConversas.status()));
  return r;
}

/** Tick incremental (anexe um gatilho de tempo): indexa uma fatia pequena por execução,
 *  cabendo na cota free. Mantém a memória de conversas fresca sem rodar manualmente. */
function tickMemoriaConversas() {
  if (typeof Gemini === 'undefined' || !Gemini.temChave()) return;
  try { MemoriaConversas.indexar({ budgetMs: 90 * 1000, maxPares: 15 }); } catch (e) { Logger.log('[tickMemoriaConversas] ' + e.message); }
}

/** Diagnóstico: recall semântico nas conversas do dono. Ex.: testarMemoriaConversas('o que decidi sobre o dashboard?'). */
function testarMemoriaConversas(consulta) {
  var email = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '';
  var res = MemoriaConversas.buscar(email, consulta || 'o que conversamos sobre o Jarvis?', 5);
  res.forEach(function (r) { Logger.log('• ' + r.score.toFixed(3) + ' · [' + (r.titulo || r.conversaId) + ']\n   ' + String(r.trecho).substring(0, 180).replace(/\n/g, ' ') + '…'); });
  return res;
}
