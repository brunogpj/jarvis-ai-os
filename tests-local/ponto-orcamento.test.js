// ponto-orcamento.test.js — 10/11/2026: a cobrança de ausência do ponto (19:00) foi barrada em silêncio porque o orçamento diário
// de interrupções (5) já tinha acabado. O que o dono pediu não disputa esse orçamento.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(props) {
  var s = makeSandbox({ props: props || {} });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-11-10' : '12:00'; };
  s.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  loadGasFile('Code.js', s);
  return s;
}
var CHEIO = { PROATIVO_DIA: '2026-11-10', PROATIVO_CONT: '5' };

test('orçamento esgotado barra um aviso comum', function () {
  var g = sb(CHEIO)._governanca('presenca', { cooldownMin: 60 });
  assert.strictEqual(g.permitido, false);
  assert.match(g.motivo, /orçamento diário esgotado/);
});

test('a cobrança do ponto (pedido) passa mesmo com o orçamento esgotado e não o consome', function () {
  var s = sb(CHEIO);
  var g = s._governanca('ponto_ausente', { cooldownMin: 60, pedido: true });
  assert.strictEqual(g.permitido, true);
  var cont = s.PropertiesService.getScriptProperties().getProperty('PROATIVO_CONT');
  assert.strictEqual(String(cont), '5');
});
