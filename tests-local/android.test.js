// android.test.js — canal do app Android (fase 1, 08/11/2026): push por FCM, registro do aparelho e confirmação de entrega.
// Sem rede: o FCM e o OAuth são simulados.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var TOKEN_FCM = 'fcm_token_de_teste_0123456789:ABCdef-_xyz';

function sb(opts) {
  opts = opts || {};
  var chamadas = [];
  var props = Object.assign({
    FIRESTORE_SA: JSON.stringify({ client_email: 'sa@projeto.iam.gserviceaccount.com', private_key: 'chave-falsa', project_id: 'projeto-teste' })
  }, opts.props || {});
  var s = makeSandbox({ props: props, fetch: function (url, params) {
    var u = String(url);
    chamadas.push({ url: u, corpo: params && params.payload, headers: params && params.headers });
    if (/oauth2\.googleapis\.com\/token/.test(u)) return { code: 200, body: { access_token: 'tok-oauth' } };
    if (/fcm\.googleapis\.com/.test(u)) return opts.fcm ? opts.fcm(u, params) : { code: 200, body: { name: 'projects/projeto-teste/messages/1' } };
    return { code: 404, body: {} };
  } });
  s.Utilities.computeRsaSha256Signature = function () { return [1, 2, 3]; };
  s.Utilities.base64EncodeWebSafe = function (x) { return Buffer.from(x).toString('base64').split('+').join('-').split('/').join('_'); };
  s.Utilities.sleep = function () {};
  loadGasFile('Android.js', s);
  s._chamadas = chamadas;
  return s;
}
function J(x) { return JSON.parse(JSON.stringify(x)); }

test('registrar: só aceita token FCM com cara de token e guarda os dados do aparelho', function () {
  var s = sb();
  assert.strictEqual(J(s.Android.registrar({ fcm_token: 'curto' })).ok, false);
  assert.strictEqual(J(s.Android.registrar({ fcm_token: '<script>' + 'a'.repeat(30) })).ok, false);
  assert.strictEqual(J(s.Android.registrar({ fcm_token: TOKEN_FCM, modelo: '2201117TL', android: '13', app: '0.0.1' })).ok, true);
  var d = J(s.Android.dispositivo());
  assert.strictEqual(d.registrado, true);
  assert.strictEqual(d.modelo, '2201117TL');
});

test('falarAtivo: exige ANDROID_FALAR=sim E aparelho registrado (nada liga sozinho)', function () {
  var s = sb();
  assert.strictEqual(s.Android.falarAtivo(), false);
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  assert.strictEqual(s.Android.falarAtivo(), false, 'registrado mas desligado');
  var s2 = sb({ props: { ANDROID_FALAR: 'sim' } });
  assert.strictEqual(s2.Android.falarAtivo(), false, 'ligado mas sem aparelho');
  s2.Android.registrar({ fcm_token: TOKEN_FCM });
  assert.strictEqual(s2.Android.falarAtivo(), true);
});

test('montarMensagem: dados viram texto, prioridade alta, vazios saem', function () {
  var s = sb();
  var m = J(s.Android.montarMensagem(TOKEN_FCM, 'a1b2c3', 'falar', { texto: 'oi', local: '1', vazio: '', nulo: null, n: 5 }));
  assert.strictEqual(m.message.token, TOKEN_FCM);
  assert.strictEqual(m.message.android.priority, 'HIGH');
  assert.strictEqual(m.message.data.id, 'a1b2c3');
  assert.strictEqual(m.message.data.tipo, 'falar');
  assert.strictEqual(m.message.data.n, '5');
  assert.ok(!('vazio' in m.message.data) && !('nulo' in m.message.data));
});

test('enviarFala: manda ao FCM com o token OAuth e a URL de download do áudio do Drive', function () {
  var s = sb();
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  var r = J(s.Android.enviarFala({ texto: 'Bom dia', audioId: 'DRIVE123' }));
  assert.strictEqual(r.ok, true);
  var fcm = s._chamadas.filter(function (c) { return /fcm\.googleapis/.test(c.url); })[0];
  assert.ok(/projects\/projeto-teste\/messages:send/.test(fcm.url));
  assert.strictEqual(fcm.headers.Authorization, 'Bearer tok-oauth');
  var corpo = JSON.parse(fcm.corpo);
  assert.strictEqual(corpo.message.data.audio_url, 'https://drive.google.com/uc?export=download&id=DRIVE123');
  assert.strictEqual(corpo.message.data.id, r.id);
  assert.strictEqual(J(s.Android.estado(r.id)).estado, 'enviado');
});

test('enviar: sem aparelho registrado devolve erro claro e não chama o FCM', function () {
  var s = sb();
  var r = J(s.Android.enviarFala({ texto: 'x' }));
  assert.strictEqual(r.ok, false);
  assert.ok(/nenhum aparelho/.test(r.erro));
  assert.strictEqual(s._chamadas.filter(function (c) { return /fcm\.googleapis/.test(c.url); }).length, 0);
});

test('enviar: token que o FCM diz não existir mais é apagado (não insiste num aparelho morto)', function () {
  var s = sb({ fcm: function () { return { code: 404, body: { error: { message: 'Requested entity was not found.', status: 'NOT_FOUND' } } }; } });
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  var r = J(s.Android.enviarFala({ texto: 'x' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(J(s.Android.dispositivo()).registrado, false);
});

test('ack: valida o id e o estado, e nunca volta para um estado anterior', function () {
  var s = sb();
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  var id = J(s.Android.enviarFala({ texto: 'x' })).id;
  assert.strictEqual(J(s.Android.ack({ id: '../x', estado: 'recebido' })).ok, false);
  assert.strictEqual(J(s.Android.ack({ id: id, estado: 'abobrinha' })).ok, false);
  assert.strictEqual(J(s.Android.ack({ id: id, estado: 'concluido' })).ok, true);
  var r = J(s.Android.ack({ id: id, estado: 'recebido' }));   // confirmação atrasada
  assert.strictEqual(r.ignorado, true);
  assert.strictEqual(J(s.Android.estado(id)).estado, 'concluido');
});

test('aguardarAck: devolve o estado quando o app confirma e null quando ninguém confirma', function () {
  var s = sb();
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  var id = J(s.Android.enviarFala({ texto: 'x' })).id;
  assert.strictEqual(s.Android.aguardarAck(id, 1), null, 'sem confirmação');
  s.Android.ack({ id: id, estado: 'recebido' });
  assert.strictEqual(J(s.Android.aguardarAck(id, 1000)).estado, 'recebido');
});

test('registrar: guarda o projeto do Firebase informado pelo app e recusa nome inválido', function () {
  var s = sb();
  var ruim = J(s.Android.registrar({ fcm_token: TOKEN_FCM, fcm_project: 'Projeto Com Espaço' }));
  assert.strictEqual(ruim.ok, false);
  assert.strictEqual(J(s.Android.registrar({ fcm_token: TOKEN_FCM, fcm_project: 'xjywkp-27a85b93' })).ok, true);
  s.Android.registrar({ fcm_token: TOKEN_FCM });
  s.Android.enviarFala({ texto: 'x' });
  var fcm = s._chamadas.filter(function (c) { return c.url.indexOf("fcm.googleapis") !== -1; })[0];
  assert.ok(fcm.url.indexOf("/projects/xjywkp-27a85b93/messages:send") !== -1, 'o push deve sair do projeto informado pelo app');
});
