// recarga-voz.test.js — recarga do Swile por voz COM CONFIRMAÇÃO (14/10/2026): propor → repetir o valor → "sim" executa → "desfaz".
// Dados INVENTADOS. Ponto de partida das ações por voz da caderneta (bancos e ações seguirão o mesmo molde).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  var dia = o.dia || '2026-10-14';
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? dia : (p === 'd' ? dia.slice(8) : (p === 'H' ? '10' : dia)); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    var corpo = JSON.parse(opt.payload);
    s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: corpo });
    if (o.rede) throw new Error('rede caiu');
    var resp = /desfazer/.test(url) ? { ok: true, removido: 1 } : (o.existente ? { ok: true, criado: false, existente: o.existente } : { ok: true, criado: true });
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(resp); } };
  } };
  loadGasFile('Financas.js', s);
  loadGasFile('Code.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('interpretarRecarga: valores e carteiras em várias formas de falar', function () {
  var s = sb();
  var a = J(s.Financas.interpretarRecarga('caiu 1.002,50 no voucher e 67,98 na mobilidade'));
  assert.deepStrictEqual(a.itens, [{ carteira: 'voucher', valor: 1002.5 }, { carteira: 'mobilidade', valor: 67.98 }]);
  assert.strictEqual(a.referencia, '2026-10');
  var b = J(s.Financas.interpretarRecarga('a recarga do Swile chegou: 67,98 na mobilidade e 1002,50 no voucher'));
  assert.deepStrictEqual(b.itens, [{ carteira: 'voucher', valor: 1002.5 }, { carteira: 'mobilidade', valor: 67.98 }]);
  var c = J(s.Financas.interpretarRecarga('entrou 1.000 no voucher'));
  assert.deepStrictEqual(c.itens, [{ carteira: 'voucher', valor: 1000 }], '1.000 é mil (milhar), não um real');
  var d = J(s.Financas.interpretarRecarga('recarga de novembro, voucher 1000 e mobilidade 70'));
  assert.strictEqual(d.referencia, '2026-11'); assert.strictEqual(d.itens.length, 2);
});

test('interpretarRecarga: mês de uso — dia 20 ou mais = mês seguinte; citado na frase vence', function () {
  var tarde = sb({ dia: '2026-09-30' });
  assert.strictEqual(J(tarde.Financas.interpretarRecarga('caiu 1000 no voucher')).referencia, '2026-10');
  assert.strictEqual(J(tarde.Financas.interpretarRecarga('caiu a recarga de setembro 1000 no voucher')).referencia, '2026-09');
  var ano = sb({ dia: '2026-12-28' });
  assert.strictEqual(J(ano.Financas.interpretarRecarga('caiu 1000 no voucher')).referencia, '2027-01');
});

test('interpretarRecarga: perguntas, gastos e frases sem carteira ou sem rótulo NÃO viram recarga', function () {
  var s = sb();
  ['quanto caiu no voucher', 'qual o saldo do voucher', 'gastei 50 no voucher', 'comprei 30 na mobilidade', 'que horas são', 'o que vence amanhã', 'caiu um raio aqui na rua'].forEach(function (f) {
    assert.strictEqual(s.Financas.interpretarRecarga(f), null, f);
  });
  assert.ok(J(s.Financas.interpretarRecarga('caiu 1000 no swile')).erro, 'sem dizer voucher/mobilidade, pede o rótulo');
  assert.ok(J(s.Financas.interpretarRecarga('caiu mil no voucher')).erro, 'por extenso: pede em números');
  assert.ok(/limite/.test(J(s.Financas.interpretarRecarga('caiu 9000 no voucher')).erro));
});

test('fluxo completo: propõe repetindo o valor, só o "sim" grava, e dá para desfazer', function () {
  var s = sb();
  var p = J(s.Financas.conversar('caiu 1.002,50 no voucher e 67,98 na mobilidade'));
  assert.ok(/^Confirma a recarga de outubro: R\$ 1\.002,50 no voucher e R\$ 67,98 na mobilidade\? Diga sim ou não\.$/.test(p.resp), p.resp);
  assert.strictEqual(s._posts.length, 0, 'nada gravado antes do sim');
  var ok = J(s.Financas.conversar('sim'));
  assert.strictEqual(s._posts.length, 2);
  assert.strictEqual(s._posts[0].url, '/recarga-voucher');
  assert.deepStrictEqual(s._posts[0].corpo.carteira, 'voucher'); assert.strictEqual(s._posts[0].corpo.referencia, '2026-10');
  assert.strictEqual(s._posts[0].corpo.chave, s._posts[1].corpo.chave);
  assert.ok(/Registrei a recarga de outubro/.test(ok.resp) && /diga desfaz/.test(ok.resp), ok.resp);
  assert.strictEqual(J(s.Financas.conversar('sim')), null, 'segundo "sim" não repete (a proposta foi consumida)');
  assert.strictEqual(s._posts.length, 2);
  var d = J(s.Financas.conversar('desfaz'));
  assert.ok(/Desfeito/.test(d.resp), d.resp);
  assert.strictEqual(s._posts.filter(function (x) { return /desfazer/.test(x.url); }).length, 2);
  assert.ok(/Não há nada recente/.test(J(s.Financas.conversar('desfaz a recarga')).resp));
});

test('"não" descarta sem gravar; frase alheia deixa a proposta quieta; sem proposta, "sim" não é com a caderneta', function () {
  var s = sb();
  s.Financas.conversar('caiu 1000 no voucher');
  assert.strictEqual(J(s.Financas.conversar('que horas são')), null);
  assert.ok(/não registrei nada/.test(J(s.Financas.conversar('não')).resp));
  assert.strictEqual(s._posts.length, 0);
  assert.strictEqual(J(s.Financas.conversar('sim')), null);
  assert.ok(/Não há nada recente/.test(J(s.Financas.conversar('desfaz')).resp), '"desfaz" seco não cai no modelo');
});

test('proposta expirada (3 min) não grava; ok com "ok sim pode registrar"', function () {
  var s = sb();
  s.Financas.conversar('caiu 1000 no voucher');
  s.CacheService.getScriptCache().remove('fin_pendente');   // o tempo passou
  assert.strictEqual(J(s.Financas.conversar('sim')), null);
  assert.strictEqual(s._posts.length, 0);
  s.Financas.conversar('caiu 1000 no voucher');
  assert.ok(/Registrei/.test(J(s.Financas.conversar('ok, pode registrar')).resp));
});

test('recarga que já existe no mês: não altera e diz o valor que está lá; rede fora: diz que não gravou', function () {
  var s = sb({ existente: 1002.5 });
  s.Financas.conversar('caiu 1000 no voucher');
  var r = J(s.Financas.conversar('sim'));
  assert.ok(/Já existe recarga de outubro de R\$ 1\.002,50 no voucher, então não mudei/.test(r.resp), r.resp);
  assert.ok(/Não há nada recente/.test(J(s.Financas.conversar('desfaz')).resp), 'nada foi criado, nada a desfazer');
  var off = sb({ rede: true });
  off.Financas.conversar('caiu 1000 no voucher');
  var f = J(off.Financas.conversar('sim'));
  assert.ok(/Não consegui registrar R\$ 1\.000,00 no voucher agora\. Não gravei nada/.test(f.resp), f.resp);
});

test('valor alto avisa antes de pedir o sim; sem caderneta configurada não faz nada', function () {
  var s = sb();
  assert.ok(/^Esse valor é alto\. Confirma/.test(J(s.Financas.conversar('caiu 3500 no voucher')).resp));
  var vazio = sb({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } });
  assert.strictEqual(vazio.Financas.conversar('caiu 1000 no voucher'), null);
});
