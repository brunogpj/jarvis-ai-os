// ===================================================================================
// TypeSafe.js — Cliente do TypeSafe System One (modelo JEV) para o Jarvis.
// ===================================================================================
// JEV não gera texto: devolve JULGAMENTOS TIPADOS com probabilidade. É o oposto do Gemini
// neste projeto — onde o Gemini escreve, o JEV decide. Serve exatamente aos pontos em que
// o código precisava de "senso comum programável" e só tinha regex.
//
// GAS não roda o SDK oficial (@typesafe-ai/sdk exige npm/Node), então falamos a HTTP API crua
// via UrlFetchApp — contrato conferido na doc ao vivo e no fonte do SDK (v0.6.0):
//   POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <TYPESAFE_API_KEY>
//   body  { state, model, questions: { <id>: { type, instructions, criteria? } } }
//   resp  { model, answers: { <id>: { type:'noul', noul:0..1 } }, usage:{input_tokens,output_tokens} }
//
// PRIMITIVAS (escolha pelo SIGNIFICADO da resposta, não pela conveniência):
//   noul   → probabilidade de uma condição valer (0..1). Sem "confidence" separado.
//   choice → escolhe UMA de um conjunto; traz probabilities + confidence.
//   score  → posição numa dimensão ordenada; traz legend + probabilities + confidence.
//
// SEGREDO em Script Property TYPESAFE_API_KEY. Nunca no código, nunca no git.
// LIMITE CONHECIDO: UrlFetchApp não expõe timeout configurável — quem chama no caminho quente
// precisa assumir que uma chamada ruim custa segundos, e ter fallback local (ver _CHAVE_CACHE).
// ===================================================================================

var TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
var TYPESAFE_MODELO = 'jev-latest';

var TypeSafe = (function () {
  'use strict';

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
  function _chave() { return String(_p('TYPESAFE_API_KEY') || '').trim(); }
  function temChave() { return !!_chave(); }

  function _hash(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** Pergunta ao JEV. `questions` é o mapa {id: {type, instructions, criteria?}} — os IDs são
   *  SÓ para o código (não vão para o modelo), então a pergunta tem que se bastar sozinha.
   *  opts.cacheSeg > 0 memoiza por (state+questions): a mesma pergunta sobre o mesmo estado não
   *  muda de resposta e não vale uma ida à rede.
   *  Retorna SEMPRE um objeto — { ok:false, erro } em vez de lançar. Quem chama decide o fallback,
   *  porque o lado seguro depende do domínio (numa porta de privacidade, falhar é ser discreto). */
  function perguntar(state, questions, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var chave = _chave();
    if (!chave) return { ok: false, erro: 'TYPESAFE_API_KEY ausente', ms: 0 };
    if (!questions || !Object.keys(questions).length) return { ok: false, erro: 'nenhuma pergunta', ms: 0 };

    var corpo = { state: state, model: String(opts.modelo || TYPESAFE_MODELO), questions: questions };
    var json = JSON.stringify(corpo);

    var ck = null;
    if (opts.cacheSeg > 0) {
      ck = 'ts_' + _hash(json);
      try {
        var hit = CacheService.getScriptCache().get(ck);
        if (hit) { var c = JSON.parse(hit); c.cache = true; c.ms = Date.now() - t0; return c; }
      } catch (eC) { ck = null; }
    }

    var res;
    try {
      res = UrlFetchApp.fetch(TYPESAFE_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + chave, Accept: 'application/json' },
        payload: json,
        muteHttpExceptions: true
      });
    } catch (e) {
      return { ok: false, erro: 'rede: ' + e.message, ms: Date.now() - t0 };
    }

    var code = res.getResponseCode();
    var txt = res.getContentText();
    if (code < 200 || code >= 300) {
      return { ok: false, erro: 'HTTP ' + code + ': ' + String(txt).substring(0, 200), http: code, ms: Date.now() - t0 };
    }
    var dados;
    try { dados = JSON.parse(txt); } catch (eJ) {
      return { ok: false, erro: 'resposta não-JSON', ms: Date.now() - t0 };
    }

    var out = { ok: true, answers: dados.answers || {}, model: dados.model || null,
                usage: dados.usage || null, ms: Date.now() - t0 };
    if (ck) { try { CacheService.getScriptCache().put(ck, JSON.stringify(out), Math.min(opts.cacheSeg, 21600)); } catch (eP) {} }
    return out;
  }

  /** Atalho p/ UMA pergunta noul. Devolve { ok, prob, model, ms, erro }.
   *  prob é a probabilidade de SIM (0..1). Perto de 0,5 = o modelo dá chances parecidas para
   *  sim e não — NÃO significa "intensidade média". Quem chama aplica o limiar. */
  function noul(state, instructions, criteria, opts) {
    var q = { j: { type: 'noul', instructions: instructions } };
    if (criteria) q.j.criteria = criteria;
    var r = perguntar(state, q, opts);
    if (!r.ok) return r;
    var a = r.answers && r.answers.j;
    var prob = (a && typeof a.noul === 'number') ? a.noul : null;
    if (prob === null) return { ok: false, erro: 'resposta sem campo noul', ms: r.ms };
    return { ok: true, prob: prob, model: r.model, usage: r.usage, ms: r.ms, cache: !!r.cache };
  }

  return { perguntar: perguntar, noul: noul, temChave: temChave, URL: TYPESAFE_URL };
})();

/** Configura a chave da API. A chave fica SÓ nas Script Properties, nunca no código.
 *
 * ATENÇÃO — o botão "Executar" do editor NÃO passa argumentos: rodar `configurarTypeSafe` pelo
 * menu cai sempre neste erro. A saída certa é uma função-ponte TEMPORÁRIA (ver instrucoesTypeSafe),
 * que você apaga logo depois. NÃO cole a chave dentro deste arquivo para contornar: aconteceu em
 * 21/09, a chave foi parar no corpo desta mensagem de erro e só não vazou para o git porque o
 * `clasp push` seguinte sobrescreveu o arquivo por acaso. */
function configurarTypeSafe(args) {
  var k = (args && (args.chave || args.key || args)) ? String(args.chave || args.key || args).trim() : '';
  if (!k) return { ok: false, erro: 'Sem argumento. O editor não passa args pelo botão Executar — rode instrucoesTypeSafe() para ver como fazer. NÃO cole a chave neste arquivo.' };
  if (k.indexOf('...') !== -1 || k.length < 20) return { ok: false, erro: 'Isso não parece uma chave.' };
  PropertiesService.getScriptProperties().setProperty('TYPESAFE_API_KEY', k);
  return { ok: true, configurado: true, tamanho: k.length, proximoPasso: 'Rode diagTypeSafe() para confirmar.' };
}

/** Imprime o passo a passo de como gravar a chave sem deixá-la no código. */
function instrucoesTypeSafe() {
  var txt = [
    '1. Crie uma função TEMPORÁRIA em qualquer arquivo .gs:',
    '',
    '     function _bootTypeSafe() {',
    '       return configurarTypeSafe({ chave: "COLE_A_CHAVE_AQUI" });',
    '     }',
    '',
    '2. Selecione _bootTypeSafe no menu e clique em Executar.',
    '3. Rode diagTypeSafe() — deve voltar ok:true com o nome do modelo.',
    '4. APAGUE a função _bootTypeSafe. A chave já está nas Script Properties;',
    '   deixá-la no código é o que o projeto inteiro evita.',
    '',
    'Chave gravada agora? ' + (String(PropertiesService.getScriptProperties().getProperty('TYPESAFE_API_KEY') || '') ? 'SIM' : 'NÃO')
  ].join('\n');
  Logger.log(txt);
  return txt;
}

/** DIAGNÓSTICO: a API responde? Usa uma pergunta trivial de ida-e-volta (custo mínimo). */
function diagTypeSafe(args) {
  args = args || {};
  if (!TypeSafe.temChave()) return { ok: false, erro: 'TYPESAFE_API_KEY não configurada. Rode configurarTypeSafe({chave:"..."}).' };
  var r = TypeSafe.noul(
    String(args.texto || 'Socorro! Meus pagamentos estão falhando há 3 dias.'),
    'A mensagem transmite urgência?'
  );
  return { ok: r.ok, prob: r.prob, model: r.model, ms: r.ms, usage: r.usage, erro: r.erro || null };
}
