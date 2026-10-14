// ponto-registrado.test.js — o lembrete de ponto cede quando o Sisponto já registrou (14/10/2026).
// O ponto foi batido às 14:00:29 e o lembrete das 14:00 saiu às 14:01 (o tick roda de minuto em minuto).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function fmt(d, tz, p) {
  var x = new Date(d.getTime() - 3 * 3600e3), z = function (n) { return (n < 10 ? '0' : '') + n; }, dow = x.getUTCDay() || 7;
  return String(p).replace('yyyy', x.getUTCFullYear()).replace('MM', z(x.getUTCMonth() + 1)).replace('dd', z(x.getUTCDate()))
    .replace(/^H$/, String(x.getUTCHours())).replace(/^m$/, String(x.getUTCMinutes())).replace(/^u$/, String(dow))
    .replace(/HH:mm:ss$/, z(x.getUTCHours()) + ':' + z(x.getUTCMinutes()) + ':' + z(x.getUTCSeconds()));
}
function sbTick(jaRegistrado) {
  var falas = [], eventos = [];
  var s = makeSandbox({});
  s.Utilities.formatDate = fmt;
  s.Jarvis.controlarDispositivo = function (a) { falas.push(a.texto); return { status: 'success' }; };
  s.Jarvis.registrarEvento = function (e) { eventos.push(e); };
  s._pontoJaRegistrado = function () { return jaRegistrado; };
  loadGasFile('AlertasVoz.js', s);
  var agora = new Date();
  var h = Number(fmt(agora, '', 'H')), m = Number(fmt(agora, '', 'm'));
  s.PropertiesService.getScriptProperties().setProperty('ALERTAS_VOZ', JSON.stringify([
    { id: 'p1', hora: h, minuto: m, dias: [], texto: 'Bruno, lembre-se de marcar o ponto.', ativo: true, ult: '', tag: 'ponto' },
    { id: 'a1', hora: h, minuto: m, dias: [], texto: 'beber água', ativo: true, ult: '', tag: 'avulso' }]));
  s.__falas = falas; s.__eventos = eventos;
  return s;
}

test('Sisponto já registrou → o lembrete de ponto cala (e deixa rastro); os outros alertas falam', function () {
  var s = sbTick(true);
  s.AlertasVoz.tick();
  assert.deepStrictEqual([...s.__falas], ['beber água']);
  assert.ok(s.__eventos.some(function (e) { return e.tool === 'alertaVoz:suprimido' && /Sisponto já registrou/.test(e.resumo); }));
  s.AlertasVoz.tick();   // no tick seguinte também não volta
  assert.deepStrictEqual([...s.__falas], ['beber água']);
});

test('Sisponto não registrou → o lembrete de ponto fala como sempre', function () {
  var s = sbTick(false);
  s.AlertasVoz.tick();
  assert.ok(s.__falas.some(function (t) { return /marcar o ponto/.test(t); }));
});

test('_pontoJaRegistrado: notificação do Sisponto entre 30 min antes do horário e agora conta; outras não', function () {
  var s = makeSandbox({});
  s.Utilities.formatDate = fmt;
  loadGasFile('Code.js', s);
  var agora = new Date(), minAgora = agora.getHours() * 60 + agora.getMinutes();
  function com(notifs) { s._notifLer = function () { return notifs.map(function (n) { return { id: 'x', d: n }; }); }; return s._pontoJaRegistrado(minAgora, 30); }
  assert.strictEqual(com([{ app: 'Sisponto', em: Date.now() - 20000 }]), true, 'agora mesmo');
  assert.strictEqual(com([{ app: 'Sisponto', em: Date.now() - 20 * 60000 }]), true, '20 min antes do horário');
  assert.strictEqual(com([{ app: 'Sisponto', em: Date.now() - 50 * 60000 }]), false, '50 min antes: é de outro ponto');
  assert.strictEqual(com([{ app: 'WhatsApp', em: Date.now() - 20000 }]), false, 'outro app');
  assert.strictEqual(com([]), false);
  s._notifLer = function () { throw new Error('firestore fora'); };
  assert.strictEqual(s._pontoJaRegistrado(minAgora, 30), false, 'sem leitura → fail-open (lembra)');
});
