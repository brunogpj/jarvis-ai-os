// gasto.test.js — controle de gasto mensal do Gemini (GastoIA), troca de modelos e rota config_gemini (14/10/2026).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function hojeFixo(iso) {
  return function (d, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return iso;
    if (fmt === 'H') return '10'; if (fmt === 'm') return '0';
    return iso;
  };
}
function gasto(props, iso) {
  var s = makeSandbox({ props: props || {} });
  s.Utilities.formatDate = hojeFixo(iso || '2026-10-15');
  s._avisos = [];
  s._avisarDono = function (a) { s._avisos.push(a); };
  loadGasFile('GastoIA.js', s);
  return s;
}
var perto = function (a, b, tol) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), a + ' ≠ ' + b); };

test('custoUSD: 2.5-flash, 3.8-flash e lite batem com a tabela de preços', function () {
  var G = gasto().GastoIA;
  // 1 milhão de tokens de entrada e 1 milhão de saída
  var uso = { promptTokenCount: 1e6, candidatesTokenCount: 1e6 };
  perto(G.custoUSD('gemini-2.5-flash', uso, '2026-10-15'), 0.30 + 2.50);
  perto(G.custoUSD('gemini-2.5-flash-lite', uso, '2026-10-15'), 0.10 + 0.40);
  perto(G.custoUSD('gemini-3.5-flash-lite', uso, '2026-10-15'), 0.30 + 2.50);
  perto(G.custoUSD('gemini-3.8-flash', uso, '2026-10-15'), 0.75 + 3.75);
});

test('custoUSD: o preço do 3.8-flash dobra em 01/01/2027', function () {
  var G = gasto().GastoIA;
  var uso = { promptTokenCount: 1e6, candidatesTokenCount: 1e6 };
  perto(G.custoUSD('gemini-3.8-flash', uso, '2026-12-31'), 4.5);
  perto(G.custoUSD('gemini-3.8-flash', uso, '2027-01-01'), 9.0);
  perto(G.custoUSD('gemini-3.5-flash-lite', uso, '2027-06-01'), 2.8, 1e-9);   // o lite não dobra
});

test('custoUSD: tokens de raciocínio cobram como saída; entrada de áudio tem preço próprio', function () {
  var G = gasto().GastoIA;
  perto(G.custoUSD('gemini-2.5-flash', { promptTokenCount: 0, candidatesTokenCount: 100000, thoughtsTokenCount: 900000 }, '2026-10-15'), 2.50);
  var comAudio = { promptTokenCount: 1e6, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 1e6 }], candidatesTokenCount: 0 };
  perto(G.custoUSD('gemini-2.5-flash', comAudio, '2026-10-15'), 1.00);
});

test('custoUSD: TTS cobra a saída como áudio (3.8 flash tts = US$ 0,00225 por 10 s)', function () {
  var G = gasto().GastoIA;
  // 10 s de áudio = 250 tokens; entrada de texto de 100 tokens
  var c = G.custoUSD('gemini-3.8-flash-tts', { promptTokenCount: 100, candidatesTokenCount: 250 }, '2026-10-15');
  perto(c, (100 * 0.50 + 250 * 9.00) / 1e6);
  perto(250 * 9 / 1e6, 0.00225);
  var lite = G.custoUSD('gemini-3.8-flash-lite-tts', { candidatesTokenCount: 250 }, '2026-10-15');
  perto(lite, 250 * 6 / 1e6);   // US$ 0,0015 por 10 s
});

test('custoUSD: modelo fora da tabela é cobrado como o Flash mais caro (nunca subestima)', function () {
  var G = gasto().GastoIA;
  perto(G.custoUSD('gemini-9-novo', { promptTokenCount: 1e6, candidatesTokenCount: 1e6 }, '2026-10-15'), 0.75 + 3.75);
});

test('registrar: soma por mês, por modelo, e o mês novo recomeça do zero', function () {
  var s = gasto({}, '2026-10-15'), G = s.GastoIA;
  G.registrar('gemini-3.8-flash', { promptTokenCount: 1e6, candidatesTokenCount: 0 });
  G.registrar('gemini-2.5-flash', { promptTokenCount: 0, candidatesTokenCount: 1e6 });
  var e = G.estado();
  assert.strictEqual(e.mes, '2026-10');
  assert.strictEqual(e.chamadas, 2);
  perto(e.gastoBRL, Math.round((0.75 + 2.50) * 5.7 * 100) / 100);
  assert.strictEqual(e.porModelo['gemini-3.8-flash'].chamadas, 1);
  // vira o mês
  s.Utilities.formatDate = hojeFixo('2026-11-02');
  var n = s.GastoIA.estado();
  assert.strictEqual(n.mes, '2026-11');
  assert.strictEqual(n.gastoBRL, 0);
  assert.strictEqual(n.mesAnterior.mes, '2026-10');
});

test('registrar: as 5.000 primeiras buscas do mês (modelos 3+) são grátis; depois US$ 14 por mil', function () {
  var s = gasto({}, '2026-10-15'), G = s.GastoIA;
  G.registrar('gemini-3.5-flash-lite', {}, { buscas: 4990 });
  assert.strictEqual(G.estado().gastoBRL, 0);
  G.registrar('gemini-3.5-flash-lite', {}, { buscas: 20 });   // 10 grátis + 10 pagas
  perto(G.estado().gastoBRL, Math.round(10 * 0.014 * 5.7 * 100) / 100, 0.011);
  // modelos 2.5 não entram nessa conta
  var s2 = gasto({}, '2026-10-15');
  s2.GastoIA.registrar('gemini-2.5-flash', {}, { buscas: 9000 });
  assert.strictEqual(s2.GastoIA.estado().gastoBRL, 0);
});

test('teto: avisa em 50%, 80% e 100% (uma vez cada) e esgotado() liga aos 100%', function () {
  var s = gasto({ GEMINI_ORCAMENTO_BRL: '10', GEMINI_USD_BRL: '5' }, '2026-10-15'), G = s.GastoIA;
  // US$ 1 = R$ 5 = 50% do teto de R$ 10
  G.registrar('gemini-2.5-flash', { promptTokenCount: 0, candidatesTokenCount: 400000 });   // 0,4 × 2,5 = US$ 1,00
  assert.strictEqual(s._avisos.length, 1);
  assert.match(s._avisos[0].titulo, /50%/);
  assert.strictEqual(G.esgotado(), false);
  G.registrar('gemini-2.5-flash', { candidatesTokenCount: 200000 });                        // +US$ 0,50 → R$ 7,50 = 75%
  assert.strictEqual(s._avisos.length, 1, 'ainda abaixo de 80%');
  G.registrar('gemini-2.5-flash', { candidatesTokenCount: 100000 });                        // +US$ 0,25 → R$ 8,75 = 87,5%
  assert.strictEqual(s._avisos.length, 2);
  G.registrar('gemini-2.5-flash', { candidatesTokenCount: 200000 });                        // +US$ 0,50 → R$ 11,25 = 112%
  assert.strictEqual(s._avisos.length, 3);
  assert.match(s._avisos[2].texto, /Desliguei a chave paga/);
  assert.strictEqual(G.esgotado(), true);
  G.registrar('gemini-2.5-flash', { candidatesTokenCount: 100000 });
  assert.strictEqual(s._avisos.length, 3, 'cada limiar avisa uma vez só');
  // trava desligável
  s.PropertiesService.getScriptProperties().setProperty('GEMINI_ORCAMENTO_ATIVO', 'nao');
  assert.strictEqual(G.esgotado(), false);
});

test('teto padrão é R$ 29,65 (2% de R$ 1.482,74) e o câmbio padrão é 5,70', function () {
  var G = gasto().GastoIA;
  assert.strictEqual(G.teto(), 29.65);
  assert.strictEqual(G.cambio(), 5.7);
});

function geminiSandbox(props, iso, estourou) {
  var s = gasto(props, iso);
  s.UrlFetchApp = { fetch: function () { throw new Error('rede não deve ser usada aqui'); } };
  loadGasFile('Gemini.js', s);
  return s;
}

test('Gemini: modelos padrão novos e nenhum modelo desligado na lista', function () {
  var s = geminiSandbox({ GEMINI_API_KEY_FALLBACK: 'F1', GEMINI_API_KEY: 'B' });
  var l = s.Gemini.pesquisarWeb;   // só garante que existe
  assert.ok(l);
  var fonte = require('fs').readFileSync(require('path').join(__dirname, '..', 'Gemini.js'), 'utf8');
  assert.ok(!/'gemini-2\.0-flash'/.test(fonte), 'gemini-2.0-flash foi desligado em 01/06/2026');
  assert.ok(/'GEMINI_MODEL'\) \|\| 'gemini-3\.8-flash'/.test(fonte));
  var voz = require('fs').readFileSync(require('path').join(__dirname, '..', 'Voz.js'), 'utf8');
  assert.ok(!/gemini-2\.5-flash-preview-tts'/.test(voz.replace(/\/\/.*$/gm, '')), 'o TTS 2.5 desliga em 17/11/2026');
  assert.ok(/gemini-3\.8-flash-lite-tts/.test(voz));
});

test('Gemini: com o teto estourado, a chave de FATURAMENTO sai da cascata; com folga, ela entra primeiro (billing_first)', function () {
  var base = { GEMINI_API_KEY_FALLBACK: 'FREE1', GEMINI_API_KEY: 'BILL', GEMINI_ORDER: 'billing_first', GEMINI_FREE_ONLY: 'false', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_MODEL_FALLBACK: 'gemini-2.5-flash' };
  var chamadas = [];
  function sandboxCom(props) {
    var s = gasto(props, '2026-10-15');
    s.UrlFetchApp = { fetch: function (url) {
      chamadas.push(url);
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }); } };
    } };
    loadGasFile('Gemini.js', s);
    return s;
  }
  var s1 = sandboxCom(base);
  s1.Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
  assert.ok(chamadas[0].indexOf('key=BILL') !== -1, 'com folga e billing_first: chave paga primeiro');
  assert.ok(chamadas[0].indexOf('models/gemini-3.8-flash:') !== -1);
  chamadas.length = 0;
  var s2 = sandboxCom(Object.assign({}, base, { GEMINI_ORCAMENTO_BRL: '1', GEMINI_USD_BRL: '5' }));
  s2.GastoIA.registrar('gemini-2.5-flash', { candidatesTokenCount: 1e6 });   // US$ 2,50 = R$ 12,50 > R$ 1
  assert.strictEqual(s2.GastoIA.esgotado(), true);
  s2.Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
  assert.ok(chamadas[0].indexOf('key=FREE1') !== -1, 'teto estourado: só as chaves gratuitas');
  assert.ok(chamadas.every(function (u) { return u.indexOf('key=BILL') === -1; }), 'a chave paga não é usada');
});

test('Gemini.gerar: cada resposta soma o uso no gasto do mês', function () {
  var s = gasto({ GEMINI_API_KEY: 'BILL', GEMINI_FREE_ONLY: 'false', GEMINI_MODEL: 'gemini-3.8-flash' }, '2026-10-15');
  s.UrlFetchApp = { fetch: function () {
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 1e6, candidatesTokenCount: 1e6 } }); } };
  } };
  loadGasFile('Gemini.js', s);
  s.Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
  perto(s.GastoIA.estado().gastoBRL, Math.round(4.5 * 5.7 * 100) / 100);
});

function rota(props) {
  var s = makeSandbox({ props: Object.assign({ VOICE_API_TOKEN: 'T', OWNER_EMAIL: 'o@x', GEMINI_MODEL: 'gemini-2.5-flash' }, props || {}) });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  loadGasFile('Code.js', s);
  s.__post = function (corpo) { return JSON.parse(s.doPost({ postData: { contents: JSON.stringify(corpo) } }).getContentText()); };
  return s;
}

test('config_gemini: troca modelos, ordem e teto; devolve antes/agora; exige o token da voz', function () {
  var s = rota();
  var r = s.__post({ action: 'config_gemini', token: 'T', valores: { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_ORDER: 'billing_first', GEMINI_FREE_ONLY: 'false', TTS_GEMINI_MODEL: 'gemini-3.8-flash-tts', GEMINI_ORCAMENTO_BRL: '29.65' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.antes.GEMINI_MODEL, 'gemini-2.5-flash');
  assert.strictEqual(r.agora.GEMINI_MODEL, 'gemini-3.8-flash');
  var p = s.PropertiesService.getScriptProperties();
  assert.strictEqual(p.getProperty('GEMINI_ORDER'), 'billing_first');
  assert.strictEqual(p.getProperty('GEMINI_ORCAMENTO_BRL'), '29.65');
  assert.strictEqual(s.__post({ action: 'config_gemini', token: 'ERRADO', valores: { GEMINI_MODEL: 'gemini-3.8-flash' } }).ok, false);
});

test('config_gemini: recusa o que não está na lista (chaves de API, embedding) e valores malformados', function () {
  var s = rota();
  var r = s.__post({ action: 'config_gemini', token: 'T', valores: { GEMINI_API_KEY: 'x'.repeat(40), GEMINI_EMBED_MODEL: 'gemini-embedding-2', GEMINI_ORDER: 'qualquer', GEMINI_MODEL: 'gpt-4', GEMINI_ORCAMENTO_BRL: '-5', TTS_GEMINI_MODEL: 'gemini-3.8-flash-tts; DROP' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.erros.length, 6);
  assert.deepStrictEqual(Object.keys(r.agora), []);
  var p = s.PropertiesService.getScriptProperties();
  assert.strictEqual(p.getProperty('GEMINI_API_KEY'), null, 'nunca grava chave de API por essa rota');
  assert.strictEqual(p.getProperty('GEMINI_MODEL'), 'gemini-2.5-flash', 'valor inválido não altera nada');
});
