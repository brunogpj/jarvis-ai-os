// occ-caderneta.test.js — controle otimista nas escritas da caderneta (14/10/2026): o Jarvis manda o valor que repetiu na proposta e o Worker
// recusa (409) se o dado mudou antes do "sim". Padrão do post "Bidirectional Writeback" (Tanaike). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 1500, aPagar: 0,
  obrigacoes: [{ chave: 'd:aluguel', nome: 'Aluguel', tipo: 'conta', dia: 10, valor: 700, pago: false, outroPaga: false }],
  receitas: [{ chave: 'r:sal', nome: 'Salário', valor: 3840, recebido: false }],
  orcamentos: [],
  investimentos: { total: 31477.82, liquidezDiaria: 25259.91,
    itens: [{ id: 'i1', nome: 'CDB Plus', instituicao: 'Itaú', categoria: 'Renda fixa', saldo: 20759.91 }],
    porCategoria: { 'Renda fixa': 20759.91 } },
  metaAlocacao: { 'Renda fixa': 100 }, reservaMeses: 11.48
};

/** conflito: { '/pagamento': {atual:750}, '/investimento': {atual:21000} } → o Worker devolve 409 nessas rotas. */
function sb(conflito) {
  var s = makeSandbox({ props: { FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) } });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : (p === 'd' ? '14' : '2026-10-14')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') {
      var corpo = JSON.parse(opt.payload), rota = url.replace(/^.*\/api\/jarvis/, '');
      s._posts.push({ url: rota, corpo: corpo });
      if (conflito && conflito[rota] && ((corpo.valor_esperado !== undefined) || (corpo.saldo_esperado !== undefined))) {
        return { getResponseCode: function () { return 409; }, getContentText: function () { return JSON.stringify({ ok: false, conflito: true, erro: 'mudou', atual: conflito[rota].atual }); } };
      }
      var resp = { ok: true, mudou: true };
      if (rota === '/investimento') resp = { ok: true, nome: 'CDB Plus', antes: 20759.91, depois: corpo.saldo };
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(resp); } };
    }
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(DADOS); } };
  } };
  loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('Pagar: o Jarvis manda o valor que repetiu (valor_esperado) e, sem conflito, marca como antes', function () {
  var s = sb();
  s.Financas.conversar('paguei o aluguel');
  var ok = J(s.Financas.conversar('sim'));
  assert.match(ok.resp, /^Marquei Aluguel como paga/);
  assert.strictEqual(s._posts[0].url, '/pagamento');
  assert.strictEqual(s._posts[0].corpo.valor_esperado, 700);
});

test('Pagar: valor mudou no app entre a proposta e o "sim" → 409, nada marcado, o Jarvis diz o valor novo', function () {
  var s = sb({ '/pagamento': { atual: 750 } });
  s.Financas.conversar('paguei o aluguel');
  var r = J(s.Financas.conversar('sim'));
  assert.match(r.resp, /O valor de Aluguel mudou na caderneta desde que eu falei \(agora R\$ 750,00\)\. Não marquei nada/);
  assert.ok(!/Marquei/.test(r.resp));
  assert.strictEqual(s.Financas.conversar('desfaz') && 1, 1);
});

test('Receber (salário): o mesmo controle, com o valor da receita', function () {
  var s = sb({ '/pagamento': { atual: 4000 } });
  s.Financas.conversar('recebi o salário');
  assert.match(J(s.Financas.conversar('sim')).resp, /O valor de Salário mudou na caderneta desde que eu falei \(agora R\$ 4\.000,00\)/);
  assert.strictEqual(s._posts[0].corpo.valor_esperado, 3840);
});

test('Saldo de investimento: manda o "de X" como saldo_esperado; conflito não pisa o valor novo do extrato', function () {
  var s = sb();
  var p = J(s.Financas.conversar('atualiza o saldo do CDB Plus para 20800'));
  assert.match(p.resp, /de R\$ 20\.759,91 para R\$ 20\.800,00/);
  assert.match(J(s.Financas.conversar('sim')).resp, /^Atualizei o saldo de CDB Plus/);
  assert.strictEqual(s._posts[0].corpo.saldo_esperado, 20759.91);

  var c = sb({ '/investimento': { atual: 21000 } });
  c.Financas.conversar('atualiza o saldo do CDB Plus para 20800');
  var r = J(c.Financas.conversar('sim'));
  assert.match(r.resp, /O saldo de CDB Plus mudou na caderneta desde que eu falei \(agora R\$ 21\.000,00, eu tinha dito R\$ 20\.759,91\)\. Não mudei nada/);
});

test('Desfazer o saldo: só volta se o saldo ainda é o que o Jarvis gravou (saldo_esperado = o valor gravado)', function () {
  var s = sb();
  s.Financas.conversar('atualiza o saldo do CDB Plus para 20800');
  s.Financas.conversar('sim');
  var d = J(s.Financas.conversar('desfaz'));
  assert.match(d.resp, /^Desfeito: o saldo de CDB Plus voltou/);
  var volta = s._posts[s._posts.length - 1];
  assert.strictEqual(volta.corpo.saldo, 20759.91);
  assert.strictEqual(volta.corpo.saldo_esperado, 20800);
});
