// tts-prompt.test.js — o estilo da voz NÃO pode ser falado (15/10/2026: o briefing abria com "Leia em voz alta em tom de narrador sério…" antes do "Bom dia, Bruno").
// Medido ao vivo com transcrição do áudio; aqui trava o formato do prompt para ninguém voltar ao prefixo falado.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(props) {
  var s = makeSandbox({ props: Object.assign({ GEMINI_API_KEY: 'k' }, props || {}),
    fetch: function (url, params) {
      s._corpo = JSON.parse(params.payload);
      return { code: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(4800).toString('base64') } }] } }] } };
    } });
  s.Utilities.base64Decode = function (str) { return Array.from(new Int8Array(Buffer.from(str, 'base64'))); };
  s.Utilities.base64Encode = function (b) { return Buffer.from(Int8Array.from(b)).toString('base64'); };
  s.Utilities.newBlob = function () { return {}; };
  loadGasFile('Voz.js', s);
  return s;
}
var enviado = function (s) { return s._corpo.contents[0].parts[0].text; };

test('Gemini TTS: o estilo vai num perfil antes da transcrição e a fala começa na saudação (nunca "Leia em voz alta em …")', function () {
  var s = sb();
  var r = s.Voz.sintetizarGemini('Bom dia, Bruno. Em Belo Horizonte, o dia pede atenção com o tempo.', { estilo: 'caloroso, simpático e acolhedor' });
  assert.strictEqual(r.status, 'success');
  var txt = enviado(s);
  assert.doesNotMatch(txt, /Leia em voz alta/i);
  assert.match(txt, /^# PERFIL DE ÁUDIO\nEstilo: caloroso, simpático e acolhedor\.\n\n## TRANSCRIÇÃO\nBom dia, Bruno\./);
});

test('Gemini TTS: sem estilo manda só o texto; ponto final do estilo não duplica; TTS_STYLE da propriedade é usado', function () {
  var s = sb();
  s.Voz.sintetizarGemini('Bom dia, Bruno.', { estilo: '' });
  assert.strictEqual(enviado(s), 'Bom dia, Bruno.');
  s.Voz.sintetizarGemini('Oi.', { estilo: 'tom calmo.  ' });
  assert.match(enviado(s), /Estilo: tom calmo\.\n\n## TRANSCRIÇÃO\nOi\./);
  var p = sb({ TTS_STYLE: 'animado' });
  p.Voz.sintetizarGemini('Oi.');
  assert.match(enviado(p), /Estilo: animado\./);
});

test('Gemini TTS: promptModelo/instrucaoSistema só existem para experimento (diag ttsEco) e não mudam o caminho normal', function () {
  var s = sb();
  s.Voz.sintetizarGemini('Texto.', { estilo: 'x', promptModelo: '[tag] {t}' });
  assert.strictEqual(enviado(s), '[tag] Texto.');
  assert.ok(!('systemInstruction' in s._corpo));
  s.Voz.sintetizarGemini('Texto.', { estilo: 'x', instrucaoSistema: 'seja um locutor' });
  assert.ok(s._corpo.systemInstruction);
  s.Voz.sintetizarGemini('Texto.', { estilo: 'x' });
  assert.ok(!('systemInstruction' in s._corpo), 'caminho normal sem instrução de sistema');
});
