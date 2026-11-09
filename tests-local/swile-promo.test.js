// swile-promo.test.js — 09/11/2026: a propaganda "Voucher Premiado no ar! ... cupons Uber de R$ 100" virou compra de R$ 100 na caderneta.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function parse(t, x) {
  var s = makeSandbox({});
  loadGasFile('Code.js', s);
  return s._finParse(t, x);
}

test('propaganda do Swile com valor em reais NAO e compra', function () {
  assert.strictEqual(parse('Voucher Premiado no ar!', 'Suas compras no Voucher podem valer um iPhones 18 Pro e cupons Uber de R$ 100. Cadastre-se na Promoção!'), null);
});

test('compra aprovada real continua sendo lida', function () {
  var p = parse('Compra aprovada', 'Compra aprovada de R$ 135,20 na carteira Refeição e Alimentação, no estabelecimento ATACADAO 672 SA.');
  assert.strictEqual(p.tipo, 'compra');
  assert.strictEqual(p.valor, 135.2);
  assert.strictEqual(p.carteira, 'voucher');
  assert.strictEqual(p.completo, true);
});

test('aviso "Pague no Voucher" nao e compra', function () {
  var p = parse('Pague no Voucher', 'As carteiras de Refeição e/ou Alimentação só funcionam no Voucher. Peça para o pagamento ser feito nessa opção da maquininha.');
  assert.ok(!p || p.completo === false);   // sem valor nunca vai à caderneta
});
