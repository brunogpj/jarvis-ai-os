// android-controles.test.js — fase 4 (10/11/2026): controles do celular pelo app. Lista fechada, ordem montada certa e desvio só com ANDROID_CONTROLES=sim.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(props) {
  var s = makeSandbox({ props: props || {} });
  loadGasFile('Android.js', s);
  return s;
}

test('controlesAtivo exige ANDROID_CONTROLES=sim E aparelho registrado', function () {
  assert.strictEqual(sb({}).Android.controlesAtivo(), false);
  assert.strictEqual(sb({ ANDROID_CONTROLES: 'sim' }).Android.controlesAtivo(), false);
  assert.strictEqual(sb({ ANDROID_CONTROLES: 'sim', ANDROID_FCM_TOKEN: 'x' }).Android.controlesAtivo(), true);
});

test('so as acoes da lista fechada viram ordem', function () {
  var A = sb({}).Android;
  ['volume', 'midia', 'lanterna', 'naoperturbe', 'abrirapp', 'abrirurl', 'navegar'].forEach(function (a) { assert.ok(A.CONTROLES_PERMITIDOS.indexOf(a) !== -1, a); });
  var r = A.enviarControle('apagar_tudo', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /fora da lista/);
});

test('mensagem FCM do controle leva tipo, acao e campos como texto', function () {
  var A = sb({}).Android;
  var m = A.montarMensagem('tok', 'a1', 'controle', { acao: 'volume', nivel: 'baixo' });
  assert.strictEqual(m.message.data.tipo, 'controle');
  assert.strictEqual(m.message.data.acao, 'volume');
  assert.strictEqual(m.message.data.nivel, 'baixo');
});

test('notificacao_interativa entra na lista fechada dos controles do app', function () {
  assert.ok(sb({}).Android.CONTROLES_PERMITIDOS.indexOf('notificacao_interativa') !== -1);
});
