// aviso-botoes.test.js — 11/11/2026: avisos da caderneta que pedem "sim ou não" / "desfaz" ganham botões na notificação do app.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb() { var s = makeSandbox({}); loadGasFile('Code.js', s); return s; }

test('proposta "Diga sim ou não" → botões Sim e Não', function () {
  assert.strictEqual(sb()._finAcoesDoTexto('Você recebeu um Pix de R$ 50,00 de Maria. Registro como receita extra? Diga sim ou não.'), 'sim,nao');
});
test('registro "Diga desfaz" → botão Desfaz', function () {
  assert.strictEqual(sb()._finAcoesDoTexto('Registrei R$ 35,00 em Mercado (débito). Diga desfaz para tirar.'), 'desfaz');
});
test('aviso informativo → sem botões', function () {
  assert.strictEqual(sb()._finAcoesDoTexto('Pix de R$ 50,00 seu para você mesmo. É transferência entre as suas contas.'), '');
});
test('proposta que também fala em desfaz prefere Sim/Não', function () {
  assert.strictEqual(sb()._finAcoesDoTexto('Marco a conta como paga? Diga sim ou não. Depois, diga desfaz se errar.'), 'sim,nao');
});
