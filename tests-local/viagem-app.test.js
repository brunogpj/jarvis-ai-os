// viagem-app.test.js — modo viagem pelo app (0.16.0): o servidor recebe velocidade e o limite da via (OpenStreetMap, como limiteTela) e devolve o que falar.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb() {
  var s = makeSandbox({ props: {} });
  var mem = {};
  s.CacheService = { getScriptCache: function () { return { get: function (k) { return mem[k] || null; }, put: function (k, v) { mem[k] = v; }, remove: function (k) { delete mem[k]; } }; } };
  loadGasFile('Code.js', s);
  return s;
}

test('abaixo do limite da via: não fala nada', function () {
  var r = sb().registrarViagem({ velocidade: 55, limiteTela: 60 });
  assert.strictEqual(r.falar, ''); assert.strictEqual(r.limite, 60); assert.strictEqual(r.origemLimite, 'placa');
});

test('acima do limite da via: avisa uma vez e respeita o intervalo de 3 min', function () {
  var s = sb();
  var a = s.registrarViagem({ velocidade: 90, limiteTela: 60 });
  assert.match(a.falar, /90 quilômetros por hora\. A via é 60/);
  var b = s.registrarViagem({ velocidade: 92, limiteTela: 60 });
  assert.strictEqual(b.falar, '');
});

test('limite fora da faixa sanitária (lixo de leitura) é ignorado e vale o configurado', function () {
  var r = sb().registrarViagem({ velocidade: 70, limiteTela: 200 });
  assert.strictEqual(r.origemLimite, 'configurado');
});

test('encerrar devolve o resumo e zera a viagem', function () {
  var s = sb();
  s.registrarViagem({ velocidade: 80, limiteTela: 110 });
  var f = s.registrarViagem({ encerrar: true });
  assert.strictEqual(f.encerrada, true); assert.strictEqual(f.maxVelocidade, 80);
  assert.strictEqual(s.registrarViagem({ encerrar: true }).falar, '');
});
