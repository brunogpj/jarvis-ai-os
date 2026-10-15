// gastos-categoria.test.js — "liste os gastos fora de mercado e alimentação", "quanto gastei com saúde" (15/10/2026). Pedido real que ficou sem resposta
// (caiu em "Ainda não sei responder isso pela caderneta" e depois no modelo). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-15', livreHoje: 117.18, livreFim: 480.5, aPagar: 0, obrigacoes: [], orcamentos: [], receitas: [],
  mercado: { total: 960.59, noVoucher: 960.59, outros: 0, n: 10 },
  investimentos: { total: 0, itens: [], porCategoria: {} }, metaAlocacao: null,
  gastosMes: { total: 1530.9, n: 22, porCategoria: {
    'Mercado': { total: 700, n: 8, maior: { descricao: 'Supermercado Exemplo', valor: 210 } }, 'Alimentação': { total: 260.59, n: 2, maior: { descricao: 'Padaria Exemplo', valor: 150 } },
    'Saúde': { total: 320.4, n: 3, maior: { descricao: 'Farmácia Exemplo', valor: 180.4 } }, 'Lazer': { total: 150, n: 2, maior: { descricao: 'Cinema Exemplo', valor: 90 } },
    'Transporte': { total: 99.9, n: 7, maior: { descricao: 'Aplicativo de corrida', valor: 30 } } },
    maiores: [] }
};
function jev(intencao, conf, extras) {
  var ans = { intencao: { type: 'choice', choice: intencao, confidence: conf, probabilities: {} } };
  Object.keys(extras || {}).forEach(function (k) { ans[k] = { type: 'choice', choice: extras[k], confidence: 0.9, probabilities: {} }; });
  ans.financas = { type: 'noul', noul: 0.05 };
  return { code: 200, body: { answers: ans } };
}
function sb(dados, resposta) {
  var s = makeSandbox({ props: { TYPESAFE_API_KEY: 'k', OWNER_EMAIL: 'dono@exemplo.com', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) },
    fetch: function (url) { if (/typesafe/.test(url)) return resposta; if (/caderneta/.test(url)) return { code: 200, body: dados || DADOS }; return { code: 404, body: {} }; } });
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s); loadGasFile('Code.js', s);
  s.Jarvis.registrarEvento = function () {};
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('Interpretar: os pedidos reais viram a consulta de gastos (fora de mercado/alimentação, categoria, por categoria)', function () {
  var s = sb();
  assert.deepStrictEqual(J(s.Financas.interpretar('quero que liste e me fale quais foram os gastos que tive esse mês fora da lista de categoria de alimentação e mercado')), { tipo: 'gastos', excluir: ['Mercado', 'Alimentação'] });
  assert.deepStrictEqual(J(s.Financas.interpretar('quanto gastei com saúde esse mês')), { tipo: 'gastos', categoria: 'Saúde' });
  assert.deepStrictEqual(J(s.Financas.interpretar('quanto eu gastei de transporte')), { tipo: 'gastos', categoria: 'Transporte' });
  assert.deepStrictEqual(J(s.Financas.interpretar('me fale os gastos por categoria')), { tipo: 'gastos' });
  assert.deepStrictEqual(J(s.Financas.interpretar('liste os gastos desse mês')), { tipo: 'gastos' });
});

test('Interpretar: o que NÃO mudou — mercado, Swile, semana e registro de gasto seguem nos caminhos de antes', function () {
  var s = sb();
  assert.strictEqual(s.Financas.interpretar('quanto gastei no mercado esse mês').tipo, 'orcamento');
  assert.strictEqual(s.Financas.interpretar('como estão os gastos de supermercado').tipo, 'orcamento');
  assert.strictEqual(s.Financas.interpretar('quanto gastei essa semana'), null, 'semana é do Swile');
  assert.strictEqual(s.Financas.interpretar('onde gastei no swile'), null);
  assert.strictEqual(s.Financas.interpretar('gastei 35 reais no mercado no débito'), null, 'registrar gasto é ação, não consulta');
  assert.strictEqual(s.Financas.interpretar('quanto eu tenho livre').tipo, 'livre_hoje');
});

test('Responder: fora de mercado e alimentação soma só o resto, ordena do maior para o menor e avisa o que não entra', function () {
  var s = sb();
  var r = s.Financas.responder({ tipo: 'gastos', excluir: ['Mercado', 'Alimentação'] });
  assert.match(r, /^Neste mês, fora de Mercado e Alimentação, você lançou R\$ 570,30 em despesas: Saúde R\$ 320,40, Lazer R\$ 150,00, Transporte R\$ 99,90\./);
  assert.match(r, /faturas e contas fixas ficam de fora/);
  assert.ok(!/Mercado R\$|Alimentação R\$/.test(r));
});

test('Responder: uma categoria diz total, quantidade e o maior lançamento; categoria sem gasto e todas as categorias também respondem', function () {
  var s = sb();
  assert.strictEqual(s.Financas.responder({ tipo: 'gastos', categoria: 'Saúde' }), 'Em Saúde você lançou R$ 320,40 neste mês, em 3 lançamentos. O maior foi R$ 180,40 em Farmácia Exemplo.');
  assert.match(s.Financas.responder({ tipo: 'gastos', categoria: 'Educação' }), /^Neste mês não há gastos lançados em Educação\./);
  var todas = s.Financas.responder({ tipo: 'gastos' });
  assert.match(todas, /^Neste mês você lançou R\$ 1\.530,89 em despesas: Mercado R\$ 700,00, Saúde R\$ 320,40, Alimentação R\$ 260,59, Lazer R\$ 150,00, Transporte R\$ 99,90\./);
});

test('Responder: Worker antigo (sem gastosMes) diz que ainda não informa, sem inventar número', function () {
  var antigo = JSON.parse(JSON.stringify(DADOS)); delete antigo.gastosMes;
  assert.strictEqual(sb(antigo).Financas.responder({ tipo: 'gastos' }), 'A caderneta ainda não informa os gastos por categoria.');
});

test('JEV: "onde mais gastei fora do mercado" (paráfrase que a regex não pega) vira cad_gastos com a categoria escolhida', function () {
  var s = sb(null, jev('cad_gastos', 0.92, { categoria_gasto: 'fora_mercado' }));
  var r = s._rotaSemantica('em que mais eu botei dinheiro além da comida', 'dono@exemplo.com', true, { canal: 'voz' });
  assert.match(String(r), /fora de Mercado e Alimentação/);
  assert.strictEqual(s._ROTA_ULTIMA, 'cad_gastos');
  var cat = sb(null, jev('cad_gastos', 0.92, { categoria_gasto: 'lazer' }));
  assert.match(String(cat._rotaSemantica('e o que sobrou de diversão', 'dono@exemplo.com', true, { canal: 'voz' })), /^Em Lazer você lançou R\$ 150,00/);
  assert.strictEqual(sb(null, jev('cad_gastos', 0.65, { categoria_gasto: 'lazer' }))._rotaSemantica('talvez gastos', 'dono@exemplo.com', true, { canal: 'voz' }), null, 'abaixo de 0,70 não responde');
});
