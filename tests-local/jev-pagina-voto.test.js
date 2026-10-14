// jev-pagina-voto.test.js — monitor de páginas com triagem JEV e voto do insight por JEV (14/10/2026). JEV simulado.
var test = require('node:test');
var assert = require('node:assert');
var crypto = require('node:crypto');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sbWeb(prob, props, semChave) {
  var s = makeSandbox({ props: Object.assign(semChave ? {} : { TYPESAFE_API_KEY: 'k' }, props || {}),
    fetch: function (url, params) { s._jev = (s._jev || 0) + 1; s._corpoJev = JSON.parse(params.payload); return { code: 200, body: { answers: { j: { type: 'noul', noul: prob } } } }; } });
  s.Utilities.DigestAlgorithm = { MD5: 'MD5' };
  s.Utilities.computeDigest = function (alg, txt) { return Array.from(crypto.createHash('md5').update(String(txt)).digest()).map(function (b) { return b > 127 ? b - 256 : b; }); };
  loadGasFile('TypeSafe.js', s); loadGasFile('Web.js', s);
  return s;
}
var ANTES = 'Preço: R$ 199,90\nEm estoque\nVisitas hoje: 1.204\nAnúncio: compre já';
var DEPOIS_RUIDO = 'Preço: R$ 199,90\nEm estoque\nVisitas hoje: 1.377\nAnúncio: oferta relâmpago';
var DEPOIS_PRECO = 'Preço: R$ 149,90\nEm estoque\nVisitas hoje: 1.204\nAnúncio: compre já';

test('Página: mudança de ruído (JEV ≤ 0,15) → relevante:false; mudança de preço → relevante:true com o resumo das linhas novas', function () {
  var r = sbWeb(0.04).Web.julgarMudanca(ANTES, DEPOIS_RUIDO, 'preço do monitor Dell');
  assert.strictEqual(r.relevante, false);
  assert.match(r.resumo, /Visitas hoje: 1\.377/);
  var p = sbWeb(0.96).Web.julgarMudanca(ANTES, DEPOIS_PRECO, 'preço do monitor Dell');
  assert.strictEqual(p.relevante, true);
  assert.match(p.resumo, /R\$ 149,90/);
});

test('Página: o JEV recebe o que o dono acompanha e só as linhas que mudaram (não a página inteira)', function () {
  var s = sbWeb(0.9);
  s.Web.julgarMudanca(ANTES, DEPOIS_PRECO, 'preço do monitor Dell');
  var st = s._corpoJev.state;
  assert.strictEqual(st.o_que_o_dono_acompanha, 'preço do monitor Dell');
  assert.match(st.linhas_que_apareceram, /149,90/);
  assert.doesNotMatch(st.linhas_que_apareceram, /Em estoque/);
  assert.match(st.linhas_que_sumiram, /199,90/);
});

test('Página: na dúvida avisa (0,16 a 0,5); sem texto anterior, sem chave, interruptor off ou erro → null (avisa como antes)', function () {
  assert.strictEqual(sbWeb(0.30).Web.julgarMudanca(ANTES, DEPOIS_RUIDO, 'x').relevante, true);
  var semAntigo = sbWeb(0.01);
  assert.strictEqual(semAntigo.Web.julgarMudanca('', DEPOIS_RUIDO, 'x').relevante, null);
  assert.ok(!semAntigo._jev, 'monitor antigo, sem snapshot: nem consulta o JEV');
  assert.strictEqual(sbWeb(0.01, {}, true).Web.julgarMudanca(ANTES, DEPOIS_RUIDO, 'x').relevante, null);
  assert.strictEqual(sbWeb(0.01, { WEB_MONITOR_JEV: 'nao' }).Web.julgarMudanca(ANTES, DEPOIS_RUIDO, 'x').relevante, null);
  var caiu = makeSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return { code: 500, body: {} }; } });
  loadGasFile('TypeSafe.js', caiu); loadGasFile('Web.js', caiu);
  assert.strictEqual(caiu.Web.julgarMudanca(ANTES, DEPOIS_RUIDO, 'x').relevante, null);
});

test('Página: hash mudou mas as linhas são as mesmas (só espaço/ordem) → não consulta o JEV e avisa', function () {
  var s = sbWeb(0.01);
  var r = s.Web.julgarMudanca('linha um\nlinha dois', 'linha dois\nlinha um', 'x');
  assert.strictEqual(r.relevante, null);
  assert.ok(!s._jev);
});

function tickWeb(prob, textoNovo, docs) {
  var s = sbWeb(prob);
  var avisos = [], eventos = [], atualizados = [];
  s.Firestore = { listDocs: function () { return docs; }, updateDoc: function (c, id, d) { atualizados.push({ id: id, d: d }); }, setDoc: function () {} };
  s.UrlFetchApp = { fetch: function () { return { getResponseCode: function () { return 200; }, getHeaders: function () { return { 'Content-Type': 'text/html' }; },
    getContentText: function () { return '<html><title>Loja</title><body>' + textoNovo.split('\n').map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</body></html>'; } }; } };
  // o JEV é chamado pelo TypeSafe.perguntar via UrlFetchApp — reaproveita o fetch do sandbox para ele
  var jevFetch = s.UrlFetchApp.fetch; var base = jevFetch;
  s.UrlFetchApp.fetch = function (url, o) {
    if (/typesafe/.test(url)) { s._jev = (s._jev || 0) + 1; return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ answers: { j: { type: 'noul', noul: prob } } }); } }; }
    return base(url, o);
  };
  s._avisarDono = function (a) { avisos.push(a); };
  s.Jarvis = { registrarEvento: function (e) { eventos.push(e); } };
  s._r = { avisos: avisos, eventos: eventos, atualizados: atualizados };
  return s;
}
function hashDe(s, t) { return s.Utilities.computeDigest('MD5', t).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }

test('Tick do monitor: ruído não notifica (evento web:triagem) mas atualiza hash e texto; mudança real notifica com o resumo', function () {
  var s = tickWeb(0.03, DEPOIS_RUIDO, null);
  var doc = { id: 'm1', dados: { url: 'https://loja.exemplo/p', descricao: 'preço do monitor Dell', hash: hashDe(s, ANTES), texto: ANTES, ativo: true } };
  s.Firestore.listDocs = function () { return [doc]; };
  assert.strictEqual(s.Web.verificarMudancas(), 0);
  assert.strictEqual(s._r.avisos.length, 0);
  assert.strictEqual(s._r.eventos[0].tool, 'web:triagem');
  assert.strictEqual(s._r.atualizados[0].d.texto.indexOf('1.377') !== -1, true, 'o snapshot avança, senão compara com o antigo para sempre');

  var p = tickWeb(0.97, DEPOIS_PRECO, null);
  var doc2 = { id: 'm2', dados: { url: 'https://loja.exemplo/p', descricao: 'preço do monitor Dell', hash: hashDe(p, ANTES), texto: ANTES, ativo: true } };
  p.Firestore.listDocs = function () { return [doc2]; };
  assert.strictEqual(p.Web.verificarMudancas(), 1);
  assert.match(p._r.avisos[0].texto, /Mudou: .*149,90/);
});

test('Tick do monitor: monitor antigo (sem texto guardado) continua avisando e passa a guardar o texto', function () {
  var s = tickWeb(0.01, DEPOIS_PRECO, null);
  var doc = { id: 'm3', dados: { url: 'https://loja.exemplo/p', descricao: 'x', hash: 'hashantigo', ativo: true } };
  s.Firestore.listDocs = function () { return [doc]; };
  assert.strictEqual(s.Web.verificarMudancas(), 1);
  assert.ok(s._r.atualizados[0].d.texto, 'agora há snapshot para o próximo ciclo');
  assert.ok(!s._jev, 'sem texto anterior não há o que julgar');
});

// ── voto do insight ────────────────────────────────────────────────────────────────────
function sbVoto(escolha, conf, props, semChave) {
  var s = makeSandbox({ props: Object.assign(semChave ? {} : { TYPESAFE_API_KEY: 'k' }, props || {}),
    fetch: function () { return { code: 200, body: { answers: { voto: { type: 'choice', choice: escolha, confidence: conf, probabilities: {} } } } }; } });
  loadGasFile('TypeSafe.js', s);
  return s;
}

test('Voto: elogio e crítica sem as palavras da lista viram up/down (≥ 0,80); o resto não é voto', function () {
  assert.strictEqual(sbVoto('up', 0.92).TypeSafe.votoFeedback('foi bem legal essa dica'), 'up');
  assert.strictEqual(sbVoto('down', 0.88).TypeSafe.votoFeedback('já sabia disso'), 'down');
  assert.strictEqual(sbVoto('up', 0.70).TypeSafe.votoFeedback('hum, mais ou menos'), null, 'abaixo de 0,80 não vota');
  assert.strictEqual(sbVoto('nenhum', 0.99).TypeSafe.votoFeedback('que horas são'), null);
});

test('Voto: sem chave, CONFIRMA_JEV=nao ou erro de rede → null (a regex continua mandando)', function () {
  assert.strictEqual(sbVoto('up', 0.99, {}, true).TypeSafe.votoFeedback('legal'), null);
  assert.strictEqual(sbVoto('up', 0.99, { CONFIRMA_JEV: 'nao' }).TypeSafe.votoFeedback('legal'), null);
  var caiu = makeSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return { code: 500, body: {} }; } });
  loadGasFile('TypeSafe.js', caiu);
  assert.strictEqual(caiu.TypeSafe.votoFeedback('legal'), null);
});
