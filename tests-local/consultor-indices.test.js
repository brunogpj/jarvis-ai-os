// consultor-indices.test.js — comparação com IPCA, CDI e poupança (séries do Banco Central) e resumo falado do mês (14/10/2026). Dados INVENTADOS
// (as séries abaixo imitam o formato real do SGS/BCB: mensal, "data" dd/mm/aaaa, "valor" com ponto decimal).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var IPCA = [['01/01/2026', '0.33'], ['01/02/2026', '0.70'], ['01/03/2026', '0.88'], ['01/04/2026', '0.67'], ['01/05/2026', '0.58'], ['01/06/2026', '0.16'], ['01/07/2026', '0.07'], ['01/08/2026', '-0.32'], ['01/09/2026', '0.82']];
var CDI = [['01/01/2026', '1.16'], ['01/02/2026', '1.00'], ['01/03/2026', '1.21'], ['01/04/2026', '1.09'], ['01/05/2026', '1.07'], ['01/06/2026', '1.12'], ['01/07/2026', '1.22'], ['01/08/2026', '1.09'], ['01/09/2026', '1.08'], ['01/10/2026', '0.41']];
function poupanca() {   // diária no BCB: um ponto por dia; só o dia 1 de cada mês conta
  var out = [];
  for (var m = 1; m <= 10; m++) { out.push({ data: '01/' + (m < 10 ? '0' : '') + m + '/2026', dataFim: '01/' + (m + 1) + '/2026', valor: '0.6727' }); out.push({ data: '02/' + (m < 10 ? '0' : '') + m + '/2026', dataFim: 'x', valor: '9.9999' }); }
  return out;
}
var j = function (pares) { return pares.map(function (p) { return { data: p[0], valor: p[1] }; }); };

function dados(o) {
  return Object.assign({
    mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 480.5, receita: 4290, saidas: 3800, sobra: 490, aplicado: 1700, fechado: false, aPagar: 0, obrigacoes: [],
    investimentos: { total: 31477.82, liquidezDiaria: 25259.91, rendimentoAno: 1548.6, itens: [], porCategoria: { 'Renda fixa': 31477.82 } }, reservaMeses: 11.48
  }, o || {});
}

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : '2026-10-14'); };
  s._urls = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    s._urls.push({ url: url, headers: (opt && opt.headers) || {} });
    if (/api\.bcb\.gov\.br/.test(url)) {
      if (o.bcbFora) throw new Error('sem rede');
      var cod = (url.match(/sgs\.(\d+)/) || [])[1];
      var corpo = cod === '433' ? j(IPCA) : (cod === '4391' ? j(CDI) : (cod === '195' ? poupanca() : []));
      if (o.sem433 && cod === '433') return { getResponseCode: function () { return 200; }, getContentText: function () { return '<!doctype html>'; } };
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(corpo); } };
    }
    var mes = (url.match(/mes=(\d{4}-\d{2})/) || [])[1] || '2026-10';
    var d = (o.porMes && o.porMes[mes]) || (mes !== '2026-10' ? dados({ mes: mes, sobra: 300, receita: 4000, saidas: 3700, aplicado: 0, fechado: true }) : dados());
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(d); } };
  } };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var responder = function (s, frase) { var q = s.Financas.interpretar(frase); return q ? s.Financas.responder(J(q)) : null; };

test('acumular: bate com o IPCA de jan a ago/2026 (3,11%) e usa taxa composta', function () {
  var C = sb().Consultor;
  var a = J(C.acumular(IPCA.slice(0, 8).map(function (p) { return { data: p[0], valor: Number(p[1]) }; })));
  assert.ok(Math.abs(a.acum - 3.107) < 0.01, 'IPCA jan-ago ≈ 3,11%: ' + a.acum);
  assert.strictEqual(a.ate, '2026-08'); assert.strictEqual(a.n, 8);
  assert.strictEqual(C.acumular([]), null); assert.strictEqual(C.acumular(null), null);
});

test('comparar: rendimento do ano contra IPCA, CDI e poupança — acima/abaixo certo, aproximação avisada', function () {
  var s = sb();
  var t = responder(s, 'meus investimentos estão rendendo mais que a inflação');
  assert.ok(/No ano, seus investimentos renderam R\$ 1\.548,60, cerca de 5,2% sobre o saldo de começo/.test(t), t);
  assert.ok(/contra IPCA 4,0%, CDI 11,0%, poupança 6,9% no mesmo período\./.test(t), t);
  assert.ok(/Está acima da inflação \(IPCA\)\. Está abaixo do CDI e da poupança\./.test(t), t);
  assert.ok(/É aproximado: os aportes do ano não são descontados, e a inflação vai até setembro de 2026\./.test(t), t);
  var bcb = s._urls.filter(function (u) { return /api.bcb.gov.br/.test(u.url); });
  assert.strictEqual(bcb.length, 3, 'busca as três séries (IPCA, CDI, poupança)');
  assert.ok(bcb.every(function (u) { return u.headers['User-Agent']; }), 'o BCB só responde com User-Agent de navegador');
});

test('comparar: frases de acima/abaixo ficam gramaticais e o resultado muda com o rendimento', function () {
  var alto = sb({ porMes: { '2026-10': dados({ investimentos: { total: 40000, rendimentoAno: 5000, itens: [], porCategoria: {} } }) } });
  var t1 = responder(alto, 'quanto rendeu minha carteira esse ano contra o cdi');
  assert.ok(/Está acima da inflação \(IPCA\), do CDI e da poupança\./.test(t1) && !/Está abaixo/.test(t1), t1);
  var baixo = sb({ porMes: { '2026-10': dados({ investimentos: { total: 31000, rendimentoAno: 100, itens: [], porCategoria: {} } }) } });
  var t2 = responder(baixo, 'meu rendimento está acima da inflação?');
  assert.ok(/Está abaixo da inflação \(IPCA\), do CDI e da poupança\./.test(t2) && !/Está acima/.test(t2), t2);
});

test('comparar: sem os índices (rede, página de erro) diz que não conseguiu; sem rendimento do ano não inventa', function () {
  var fora = sb({ bcbFora: true });
  assert.ok(/Não consegui buscar os índices do Banco Central agora, então não dá para comparar/.test(responder(fora, 'estou rendendo mais que o cdi')));
  var parcial = sb({ sem433: true });
  var t = responder(parcial, 'estou rendendo mais que a inflação');
  assert.ok(/contra CDI /.test(t) && !/IPCA \d/.test(t), 'IPCA fora do ar: compara só com o que veio: ' + t);
  var semRend = sb({ porMes: { '2026-10': dados({ investimentos: { total: 31000, itens: [], porCategoria: {} } }) } });
  assert.ok(/ainda não tem o rendimento do ano/.test(responder(semRend, 'quanto rendeu esse ano')));
});

test('resumo do mês: renda, saídas, sobra, aplicado e previsão, com a comparação com o mês anterior', function () {
  var s = sb();
  var t = responder(s, 'como foi o mês');
  assert.ok(/^Em outubro até agora: renda R\$ 4\.290,00, saídas R\$ 3\.800,00, sobra de R\$ 490,00 antes de aplicar, e aplicado R\$ 1\.700,00\./.test(t), t);
  assert.ok(/A previsão para o fim do mês é de R\$ 480,50 livres\./.test(t), t);
  assert.ok(/Frente a setembro, a sobra está R\$ 190,00 maior\./.test(t), t);
});

test('resumo do mês nomeado: "como foi setembro" usa o mês fechado e compara com agosto; sobra negativa e aplicação negativa soam certo', function () {
  var s = sb({ porMes: { '2026-09': dados({ mes: '2026-09', sobra: -50, receita: 4000, saidas: 4050, aplicado: -300, fechado: true }), '2026-08': dados({ mes: '2026-08', sobra: 200 }) } });
  var t = responder(s, 'como foi setembro');
  assert.ok(/^O mês de setembro está fechado: renda R\$ 4\.000,00, saídas R\$ 4\.050,00, sobra de menos R\$ 50,00 antes de aplicar, e resgatado R\$ 300,00\./.test(t), t);
  assert.ok(!/previsão/.test(t), 'mês fechado não tem previsão');
  assert.ok(/Frente a agosto, a sobra está R\$ 250,00 menor\./.test(t), t);
  var dez = sb();
  var q = dez.Financas.interpretar('como foi dezembro');
  assert.strictEqual(q.tipo, 'mes'); assert.strictEqual(q.mesNum, 12);
});

test('interpretar: o que é e o que NÃO é da comparação e do resumo do mês', function () {
  var F = sb().Financas;
  var t = function (f) { var r = F.interpretar(f); return r && r.tipo; };
  assert.strictEqual(t('estou ganhando da inflação'), 'indices');
  assert.strictEqual(t('a inflação subiu esse mês'), null, 'só falar de inflação não é pergunta sobre rendimento');
  assert.strictEqual(t('minha carteira bateu o cdi'), 'indices');
  assert.strictEqual(t('quanto rendeu minha carteira esse ano'), 'indices');
  assert.strictEqual(t('o rendimento está acima da poupança'), 'indices');
  assert.strictEqual(t('resumo do mês'), 'mes');
  assert.strictEqual(t('balanço do mês'), 'mes');
  assert.strictEqual(t('como está meu mês'), 'mes');
  assert.strictEqual(t('como está minha carteira'), 'carteira');
  assert.strictEqual(t('quanto eu tenho livre esse mês'), 'livre_hoje');
  assert.strictEqual(t('o que vence esse mês'), 'vencimentos');
  assert.strictEqual(t('quanto tenho investido'), 'investido');
});

test('resumo do mês: não compara com um mês sem dados na caderneta', function () {
  var s = sb({ porMes: { '2026-09': dados({ mes: '2026-09', sobra: 2800, receita: 6700, saidas: 3900, aplicado: 2500, fechado: true }), '2026-08': dados({ mes: '2026-08', sobra: 0, receita: 0, saidas: 0, aplicado: 0, fechado: false }) } });
  var t = responder(s, 'como foi setembro');
  assert.ok(/^O mês de setembro está fechado/.test(t) && !/Frente a/.test(t), t);
});
