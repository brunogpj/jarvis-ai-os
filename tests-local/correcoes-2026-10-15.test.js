// correcoes-2026-10-15.test.js — correções achadas nos logs reais de 14–15/10/2026 (compra do Swile, voz, monitor de páginas). Dados genéricos.
var test = require('node:test');
var assert = require('node:assert');
var vm = require('vm');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

// ── buscarNoWiki: frase longa não dispara a varredura de 30 arquivos (13 s) ─────────────────────────
function wikiSandbox() {
  var s = makeSandbox({});
  s._lidos = 0; s._varreu = false;
  s.DriveApp = { searchFiles: function () { return { hasNext: function () { return false; } }; } };
  s.ehMetaArquivoWiki = function () { return false; };
  loadGasFile('WikiMemoryService.js', s);
  var W = vm.runInContext('WikiMemoryService', s);
  W._getWikiFolderId = function () { return 'raiz'; };
  W._getWikiRoot = function () { s._varreu = true; return { getFiles: function () { return { hasNext: function () { return false; } }; }, getFolders: function () { return { hasNext: function () { return false; } }; } }; };
  s.W = W;
  return s;
}

test('buscarNoWiki: "o que falta eu fazer" (frase) volta vazio SEM varrer o Drive; termo curto ainda varre', function () {
  var s = wikiSandbox();
  var r = s.W.buscarNoWiki('o que falta eu fazer');
  assert.strictEqual(r.status, 'success'); assert.strictEqual(r.total_encontrados, 0); assert.strictEqual(r.via, 'frase-longa-sem-varredura');
  assert.strictEqual(s._varreu, false, 'a varredura recursiva (a de 13 s) não roda para frase');
  var c = wikiSandbox();
  c.W.buscarNoWiki('cdb');
  assert.strictEqual(c._varreu, true, 'termo curto: a varredura de palavra-chave continua valendo');
});

// ── destino da rota ─────────────────────────────────────────────────────────────────────────────
test('Rota: o reconhecimento repetiu o pedido ("Rua José rota para Rua José Pereira 185 no Estoril") → vale o que vem depois do último "rota para"', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  assert.strictEqual(s._destinoDoPedido('Rua José rota para Rua José Pereira 185 no Estoril'), 'Rua José Pereira 185 no Estoril');
  assert.strictEqual(s._destinoDoPedido('Avenida Brasil, me leva para Avenida Brasil 1500'), 'Avenida Brasil 1500');
  // os pedidos normais não mudam
  assert.strictEqual(s._destinoDoPedido('ir para casa'), 'Casa');
  assert.strictEqual(s._destinoDoPedido('para Rua Professor Edésio 105'), 'Rua Professor Edésio 105');
  assert.strictEqual(s._destinoDoPedido('me leva pro trabalho'), 'Trabalho');
});

// ── monitor de páginas: título sem entidade HTML ───────────────────────────────────────────────
test('Web.lerPagina: o título sai decodificado ("&amp;" vira "&")', function () {
  var s = makeSandbox({});
  s.UrlFetchApp = { fetch: function () { return { getResponseCode: function () { return 200; }, getHeaders: function () { return { 'Content-Type': 'text/html' }; },
    getContentText: function () { return '<html><head><title>Introducing System One Models &amp; Jev &quot;beta&quot; - Blog</title></head><body><p>texto</p></body></html>'; } }; } };
  loadGasFile('Web.js', s);
  assert.strictEqual(s.Web.lerPagina('https://exemplo.dev/post').titulo, 'Introducing System One Models & Jev "beta" - Blog');
});

// ── pré-filtro: ferramentas de conhecimento do núcleo saem quando o JEV tem certeza ─────────────
function sbFerr(probs, props) {
  var s = makeSandbox({ props: Object.assign({ TYPESAFE_API_KEY: 'k', FERRAMENTAS_JEV: 'sim' }, props || {}),
    fetch: function (url, params) { var q = JSON.parse(params.payload).questions, ans = {}; Object.keys(q).forEach(function (k) { ans[k] = { type: 'noul', noul: probs[k] != null ? probs[k] : 0.5 }; }); return { code: 200, body: { answers: ans } }; } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  return s;
}
var CONH = ['buscarConhecimento', 'buscarSemantico', 'lembrarDeConversas', 'buscarNoWiki'];

test('Conhecimento: "o que falta eu fazer" (JEV ≤ 0,05) NÃO recebe buscarConhecimento/lembrarDeConversas, mas ganha a ferramenta certa e o resto do núcleo fica', function () {
  var s = sbFerr({ conhecimento: 0.02, tarefas: 0.9 });
  var p = s.Jarvis._toolsPermitidas('o que falta eu fazer');
  CONH.forEach(function (n) { assert.ok(!p[n], n + ' deveria ter saído'); });
  assert.ok(p.listarTarefas, 'a ferramenta de tarefas abriu');
  assert.ok(p.pesquisarWeb && p.definirPreferencia && p.lerWiki, 'o resto do núcleo não sai');
  assert.match(s.Jarvis.ultimoGate().perdeu.join(','), /conhecimento 0\.02/);
});

test('Conhecimento: na dúvida (0,06+), com pergunta sobre o que ele guardou, ou nos modos "adiciona"/"nao", as ferramentas ficam', function () {
  CONH.forEach(function (n) { assert.ok(sbFerr({ conhecimento: 0.30 }).Jarvis._toolsPermitidas('o que falta eu fazer')[n], 'dúvida mantém ' + n); });
  CONH.forEach(function (n) { assert.ok(sbFerr({ conhecimento: 0.97 }).Jarvis._toolsPermitidas('o que eu anotei sobre o projeto')[n], 'precisa do conhecimento: ' + n); });
  CONH.forEach(function (n) { assert.ok(sbFerr({ conhecimento: 0.01 }, { FERRAMENTAS_JEV: 'adiciona' }).Jarvis._toolsPermitidas('o que falta eu fazer')[n], 'modo adiciona nunca fecha: ' + n); });
  CONH.forEach(function (n) { assert.ok(sbFerr({ conhecimento: 0.01 }, { FERRAMENTAS_JEV: 'nao' }).Jarvis._toolsPermitidas('o que falta eu fazer')[n], 'desligado: ' + n); });
  assert.ok(sbFerr({ conhecimento: 0.04 }, { FERRAMENTAS_JEV_REMOVE_CONH: '0.03' }).Jarvis._toolsPermitidas('o que falta eu fazer').buscarConhecimento, 'o corte é configurável');
});

test('Monitor de páginas: o resumo da notificação prefere linhas com palavras a linhas que são só data', function () {
  var s = makeSandbox({});
  var crypto = require('node:crypto');
  s.Utilities.DigestAlgorithm = { MD5: 'MD5' };
  s.Utilities.computeDigest = function (a, t) { return Array.from(crypto.createHash('md5').update(String(t)).digest()); };
  loadGasFile('Web.js', s);
  var antigo = 'Blog\nPost antigo sobre o produto';
  var novo = 'Blog\nPost antigo sobre o produto\nSep 15, 2026\nSep 15, 2026\nNovo recurso permite classificar mensagens em lote\nSep 15, 2026';
  var r = s.Web.julgarMudanca(antigo, novo, 'blog do produto');   // sem chave de JEV: só o resumo é calculado
  assert.strictEqual(r.relevante, null);
  assert.strictEqual(r.resumo, 'Novo recurso permite classificar mensagens em lote');
  var soDatas = s.Web.julgarMudanca('A', 'A\nSep 15, 2026\nOct 1, 2026', 'x');
  assert.match(soDatas.resumo, /Sep 15, 2026/, 'sem nada melhor, mostra o que houver');
});
