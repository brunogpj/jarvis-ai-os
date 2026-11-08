// propriedades.test.js — auditoria e limpeza das Script Properties (08/11/2026). O ensaio chegou a dizer "apagariam 0" porque as
// barras do regex se perderam na escrita do arquivo: este teste pega esse tipo de erro antes de o editor do Apps Script.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(props) {
  var s = makeSandbox({ props: props });
  var mapa = Object.assign({}, props);
  var sp = { getProperties: function () { return Object.assign({}, mapa); }, getKeys: function () { return Object.keys(mapa); }, getProperty: function (k) { return k in mapa ? mapa[k] : null; },
    setProperty: function (k, v) { mapa[k] = String(v); }, deleteProperty: function (k) { delete mapa[k]; } };
  s.PropertiesService = { getScriptProperties: function () { return sp; } };
  var criados = [];
  s.DriveApp = { createFile: function (nome, conteudo) { criados.push({ nome: nome, conteudo: conteudo }); return { getId: function () { return 'bk1'; } }; } };
  s.Utilities.formatDate = function () { return '2026-11-08'; };
  loadGasFile('Propriedades.js', s);
  s._criados = criados;
  return s;
}
function J(x) { return JSON.parse(JSON.stringify(x)); }

var BASE = {
  PONTO_COBRADO_2026_ANTIGO: 'x',            // formato estranho: não é data, fica
  'PONTO_COBRADO_2026-11-06_480': 'ok', 'PONTO_COBRADO_2026-11-06_720': 'cobrado', 'PONTO_COBRADO_2026-10-30_1140': 'ok',
  'PONTO_COBRADO_2026-11-08_480': 'ok',      // HOJE: precisa ficar
  GEMINI_API_KEY: 'AIza-segredo', VOICE_API_TOKEN: 'a'.repeat(64), FIN_SALDO: '{"a":1}'
};

test('auditar: devolve nomes, tamanho e tipo, e NUNCA o valor', function () {
  var s = sb(BASE);
  var r = J(s.Propriedades.auditar());
  assert.strictEqual(r.total, Object.keys(BASE).length);
  var txt = JSON.stringify(r);
  assert.ok(txt.indexOf('AIza-segredo') === -1, 'a auditoria vazou um valor');
  assert.ok(r.itens.filter(function (i) { return i.chave === 'GEMINI_API_KEY'; })[0].credencial);
});

test('pontoCobrado: pega só as marcas de dias passados e preserva a de hoje', function () {
  var s = sb(BASE);
  var antigas = J(s._pontoCobradoAntigas()).sort();
  assert.deepStrictEqual(antigas, ['PONTO_COBRADO_2026-10-30_1140', 'PONTO_COBRADO_2026-11-06_480', 'PONTO_COBRADO_2026-11-06_720']);
});

test('limpar em ensaio não apaga nem grava backup', function () {
  var s = sb(BASE);
  var r = J(s.Propriedades.limpar(s._pontoCobradoAntigas(), false, []));
  assert.strictEqual(r.ensaio, true);
  assert.strictEqual(r.apagariam.length, 3);
  assert.strictEqual(s._criados.length, 0);
  assert.strictEqual(s.PropertiesService.getScriptProperties().getKeys().length, Object.keys(BASE).length);
});

test('limpar de verdade: grava o backup com os valores ANTES de apagar e deixa o resto intacto', function () {
  var s = sb(BASE);
  var r = J(s.Propriedades.limpar(s._pontoCobradoAntigas(), true, []));
  assert.strictEqual(r.apagadas, 3);
  assert.strictEqual(s._criados.length, 1);
  assert.ok(/backup_propriedades_removidas_/.test(s._criados[0].nome));
  assert.strictEqual(JSON.parse(s._criados[0].conteudo)['PONTO_COBRADO_2026-11-06_720'], 'cobrado');
  var restam = s.PropertiesService.getScriptProperties().getKeys();
  assert.ok(restam.indexOf('PONTO_COBRADO_2026-11-08_480') !== -1 && restam.indexOf('GEMINI_API_KEY') !== -1);
  assert.strictEqual(restam.length, Object.keys(BASE).length - 3);
});

test('limpar recusa credencial na lista comum e só apaga se for nomeada de propósito', function () {
  var s = sb(BASE);
  var r = J(s.Propriedades.limpar(['VOICE_API_TOKEN', 'FIN_SALDO'], true, []));
  assert.deepStrictEqual(r.recusadas_por_parecer_credencial, ['VOICE_API_TOKEN']);
  assert.deepStrictEqual(r.apagariam, ['FIN_SALDO']);
  var s2 = sb(BASE);
  var r2 = J(s2.Propriedades.limpar(['VOICE_API_TOKEN'], false, ['VOICE_API_TOKEN']));
  assert.deepStrictEqual(r2.apagariam, ['VOICE_API_TOKEN']);
});
