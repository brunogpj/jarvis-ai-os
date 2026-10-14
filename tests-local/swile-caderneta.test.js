// swile-caderneta.test.js — a compra do Swile vira gasto no voucher da caderneta; o saldo vem de lá (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var NOTIF = { app: 'Swile', pacote: '', titulo: 'Compra aprovada', texto: 'Compra aprovada de R$ 12,50 na carteira Refeição e Alimentação, no estabelecimento PADARIA MIRAGO.' };
var VOUCHERS = [{ carteira: 'voucher', categoria: 'Refeição e alimentação', recebido: 1000, gasto: 250.5, saldo: 749.5 },
                { carteira: 'mobilidade', categoria: 'Mobilidade', recebido: 70, gasto: 60, saldo: 10 }];

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'd' ? '14' : (p === 'H' ? '10' : '2026-10-14')); };
  s._posts = []; s._avisos = []; s._docs = {};
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') s._posts.push({ url: url, corpo: JSON.parse(opt.payload), auth: opt.headers.Authorization });
    if (o.rede) throw new Error('rede caiu');
    var code = o.codigo || 200;
    var corpo = o.resposta || (/desfazer/.test(url) ? { ok: true, removido: 1 }
      : (opt && opt.method === 'post' ? { ok: true, criado: true } : { mes: '2026-10', hoje: '2026-10-14', vouchers: o.vouchers || VOUCHERS }));
    return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(code === 200 ? corpo : { erro: o.erro || 'x' }); } };
  } };
  s.Firestore = {
    getDoc: function (c, id) { return s._docs[id] || null; },
    setDoc: function (c, id, d) { s._docs[id] = d; },
    updateDoc: function (c, id, p) { Object.assign(s._docs[id], p); },
    listDocs: function () { return Object.keys(s._docs).map(function (k) { return { id: k, dados: s._docs[k] }; }); }
  };
  loadGasFile('Financas.js', s);
  loadGasFile('Code.js', s);
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('compra aprovada → POST na caderneta com chave, carteira, valor e estabelecimento; o doc guarda "registrado"', function () {
  var s = sb();
  var r = J(s._finGuardarBruto(NOTIF));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s._posts.length, 1);
  var p = s._posts[0];
  assert.ok(/\/api\/jarvis\/gasto-voucher$/.test(p.url));
  assert.strictEqual(p.corpo.carteira, 'voucher'); assert.strictEqual(p.corpo.valor, 12.5);
  assert.strictEqual(p.corpo.estabelecimento, 'PADARIA MIRAGO'); assert.strictEqual(p.corpo.data, '2026-10-14');
  assert.ok(/^f[a-z0-9]+_2026-10-14$/.test(p.corpo.chave), 'a chave é o id do lançamento do Firestore');
  assert.strictEqual(s._docs[r.id].caderneta, 'registrado');
  assert.strictEqual(s._avisos.length, 1);
  assert.ok(!/\d/.test(s._avisos[0].logResumo), 'o log não leva valor');
});

test('mobilidade vai como mobilidade; a mesma notificação reenviada não registra de novo', function () {
  var s = sb();
  var n = { app: 'Swile', titulo: 'Compra aprovada', texto: 'Compra aprovada de R$ 60,00 na carteira Mobilidade, no estabelecimento POSTO SHELL.' };
  s._finGuardarBruto(n);
  assert.strictEqual(s._posts[0].corpo.carteira, 'mobilidade');
  var r2 = J(s._finGuardarBruto(n));
  assert.strictEqual(r2.jaRegistrado, true);
  assert.strictEqual(s._posts.length, 1, 'não foi à caderneta de novo');
});

test('caderneta fora do ar → "pendente" e a retentativa do tick registra depois', function () {
  var s = sb({ rede: true });
  var r = J(s._finGuardarBruto(NOTIF));
  assert.strictEqual(s._docs[r.id].caderneta, 'pendente');
  assert.strictEqual(s._avisos.length, 0, 'sem aviso de registro quando não registrou');
  s.UrlFetchApp.fetch = function (url, opt) {
    s._posts.push({ corpo: JSON.parse(opt.payload) });
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"ok":true,"criado":true}'; } };
  };
  var t = J(s._finReenviarPendentes());
  assert.strictEqual(t.reenviados, 1);
  assert.strictEqual(s._docs[r.id].caderneta, 'registrado');
  assert.strictEqual(J(s._finReenviarPendentes()).reenviados, 0, 'não reenvia o que já foi');
});

test('a caderneta recusa o conteúdo (4xx) → "recusado" e não fica tentando para sempre', function () {
  var s = sb({ codigo: 400, erro: 'Valor inválido.' });
  var r = J(s._finGuardarBruto(NOTIF));
  assert.strictEqual(s._docs[r.id].caderneta, 'recusado');
  assert.strictEqual(J(s._finReenviarPendentes()).reenviados, 0);
});

test('estorno não mexe na caderneta: só avisa para ele ajustar', function () {
  var s = sb();
  var r = J(s._finGuardarBruto({ app: 'Swile', titulo: 'Estorno', texto: 'Estorno de R$ 12,50 na carteira Refeição e Alimentação, no estabelecimento PADARIA MIRAGO.' }));
  assert.strictEqual(s._posts.length, 0);
  assert.strictEqual(s._docs[r.id].caderneta, 'estorno_manual');
  assert.strictEqual(s._avisos.length, 1);
});

test('SWILE_PARA_CADERNETA=nao desliga o registro; recarga não gera gasto', function () {
  var s = sb({ props: { SWILE_PARA_CADERNETA: 'nao' } });
  s._finGuardarBruto(NOTIF);
  assert.strictEqual(s._posts.length, 0);
  var s2 = sb();
  s2._finGuardarBruto({ app: 'Swile', titulo: 'Tem carga nova no seu Swile!', texto: 'Já decidiu onde vai usar?' });
  assert.strictEqual(s2._posts.length, 0);
});

test('saldo do Swile vem da caderneta (recebido − gastos), por carteira e nas duas', function () {
  var s = sb();
  assert.strictEqual(s._finFalarSaldo(null), 'Saldo do Swile: R$ 749,50 no voucher; e R$ 10,00 na mobilidade.');
  assert.strictEqual(s._finFalarSaldo('mobilidade'), 'Saldo do Swile: R$ 10,00 na mobilidade.');
  assert.strictEqual(s._finFalarSaldo('voucher'), 'Saldo do Swile: R$ 749,50 no voucher.');
});

test('saldo: mês sem recarga registrada não inventa; negativo é dito como negativo', function () {
  var s = sb({ vouchers: [{ carteira: 'voucher', recebido: 0, gasto: 80, saldo: -80 }, { carteira: 'mobilidade', recebido: 70, gasto: 80, saldo: -10 }] });
  var t = s._finFalarSaldo(null);
  assert.ok(/a mobilidade está negativa em R\$ 10,00/.test(t), t);
  assert.ok(/Ainda não há recarga de outubro registrada na caderneta para voucher/.test(t), t);
  assert.ok(!/80/.test(t), 'não fala o −80 de um mês sem recarga');
});

test('SWILE_FONTE=firestore volta ao saldo antigo; caderneta fora → cai no saldo antigo', function () {
  var s = sb({ props: { SWILE_FONTE: 'firestore' } });
  s.PropertiesService.getScriptProperties().setProperty('FIN_SALDO', JSON.stringify({ voucher: 5, mobilidade: 2, em: Date.now() }));
  assert.ok(/R\$ 5,00/.test(s._finFalarSaldo(null)));
  var off = sb({ rede: true });
  off.PropertiesService.getScriptProperties().setProperty('FIN_SALDO', JSON.stringify({ voucher: 5, mobilidade: 2, em: Date.now() }));
  assert.ok(/R\$ 5,00/.test(off._finFalarSaldo(null)), 'fallback');
});

test('recarga: com a caderneta como fonte, só notifica para ele registrar (sem pedir número)', function () {
  var s = sb();
  var chamadas = [];
  s.Jarvis.controlarDispositivo = function (a) { chamadas.push(a); return { status: 'success' }; };
  var r = J(s._finPedirSaldo());
  assert.strictEqual(r.via, 'caderneta');
  assert.strictEqual(chamadas[0].acao, 'notificar');
  assert.ok(/caderneta/.test(chamadas[0].texto));
});

test('o token vai no cabeçalho; sem configuração não tenta', function () {
  var s = sb();
  s.Financas.registrarGastoSwile({ chave: 'abc123def', data: '2026-10-14', carteira: 'voucher', valor: 1, estabelecimento: 'X' });
  assert.ok(/^Bearer a{40}$/.test(s._posts[0].auth));
  assert.strictEqual(J(s.Financas.desfazerGastoSwile('abc123def')).removido, 1);
  var vazio = sb({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } });
  assert.strictEqual(J(vazio.Financas.registrarGastoSwile({ chave: 'abc123def' })).ok, false);
  assert.strictEqual(vazio._posts.length, 0);
});
