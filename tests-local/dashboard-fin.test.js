// dashboard-fin.test.js — cartão "Finanças" e caixa de notificações do Dashboard (16/10/2026). A compra do Mercado Pago de 15/10 sumiu porque o formato do push era novo
// e ninguém soube; a caixa mostra o que o Jarvis ENTENDEU e põe em vermelho o que tem valor e não foi registrado. Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var RESUMO = {
  mes: '2026-10', hoje: '2026-10-16', livreHoje: 117.18, livreFim: -20.5, aPagar: 530, nPendentes: 2, reservaMeses: 11.46,
  obrigacoes: [{ nome: 'Aluguel', dia: 10, valor: 400, pago: false, outroPaga: false }, { nome: 'Internet', dia: 16, valor: 130, pago: false, outroPaga: false }, { nome: 'Luz', dia: 20, valor: 90, pago: true, outroPaga: false }],
  receitas: [], orcamentos: [], metaAlocacao: null,
  investimentos: { total: 31477.82, rendimentoAno: 2299.68, itens: [] },
  gastosMes: { total: 1530.9, dias: { hoje: { total: 12.5, n: 1 }, ontem: { total: 70, n: 2 } }, semana: { total: 310.2, n: 6 }, porCategoria: {}, maiores: [] }
};
function sb(extra) {
  extra = extra || {};
  var s = makeSandbox({ props: { OWNER_EMAIL: 'dono@exemplo.com', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) },
    fetch: function (url) { return /caderneta/.test(url) ? { code: 200, body: RESUMO } : { code: 404, body: {} }; } });
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s); loadGasFile('Code.js', s);
  s.getSessionUser = function (t) { return t === 'tok-dono' ? { email: 'dono@exemplo.com', nome: 'Dono' } : (t === 'tok-outro' ? { email: 'outro@exemplo.com' } : null); };
  s.Firestore = { listDocs: function (col) { return (extra.colecoes || {})[col] || []; }, getDoc: function (col, id) { return ((extra.colecoes || {})[col] || []).filter(function (x) { return x.id === id; })[0] || null; }, setDoc: function () { return true; } };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var MP_NOVO = { app: 'Mercado Pago', titulo: 'Você pagou Divino fogao-comi', texto: 'Debitamos R$ 32,99 da sua conta.' };

test('Financas.painel: livre, previsão, a pagar, vencimentos (atrasada/hoje), investido, gastos e só o dono vê', function () {
  var s = sb(), p = J(s.Financas.painel());
  assert.strictEqual(p.ok, true);
  assert.deepStrictEqual([p.livreHoje, p.livreFim, p.aPagar, p.nPendentes, p.investido, p.rendimentoAno], [117.18, -20.5, 530, 2, 31477.82, 2299.68]);
  assert.deepStrictEqual(p.gastos, { hoje: 12.5, semana: 310.2, mes: 1530.9 });
  assert.deepStrictEqual(p.vencimentos.map(function (v) { return [v.nome, v.atrasada, v.hoje]; }), [['Aluguel', true, false], ['Internet', false, true]]);
  assert.strictEqual(s.dashboardFinancas('tok-dono').ok, true);
  assert.strictEqual(s.dashboardFinancas('tok-outro').ok, false);
  assert.strictEqual(s.dashboardFinancas('lixo').ok, false);
});

test('Classificação: reconhecida sem registro, formato desconhecido, informativa e app que não é financeiro', function () {
  var s = sb();
  var c1 = J(s._notifFinClassificar(MP_NOVO, {}));
  assert.deepStrictEqual([c1.classe, c1.alerta, c1.valor, c1.reprocessavel], ['sem_registro', true, 32.99, true]);
  var c2 = J(s._notifFinClassificar({ app: 'Mercado Pago', titulo: 'Pagamento aprovado', texto: 'Seu pagamento de R$ 50,00 foi aprovado em Loja Y.' }, {}));
  assert.deepStrictEqual([c2.classe, c2.alerta], ['nao_reconhecida', true]);
  var c3 = J(s._notifFinClassificar({ app: 'Mercado Pago', titulo: 'Ganhe cashback', texto: 'Ganhe R$ 20 de desconto na compra.' }, {}));
  assert.deepStrictEqual([c3.classe, c3.alerta], ['informativa', false]);
  assert.strictEqual(s._notifFinClassificar({ app: 'WhatsApp', titulo: 'Maria', texto: 'pagou R$ 10?' }, {}), null);
  assert.strictEqual(s._notifFinClassificar({ app: 'Itaú Investimentos', titulo: 'x', texto: 'R$ 10' }, {}), null);
});

test('Classificação pelo que o financeiro guardou: registrada, aguarda, pendente, recusada', function () {
  var s = sb(), k = function (n) { return n.app + '|' + n.titulo + '|' + n.texto; };
  [['registrado', 'registrada', false], ['aguarda_validacao', 'aguarda', false], ['aguarda_confirmacao', 'aguarda', false], ['pendente', 'pendente', true], ['recusado', 'recusado', true], ['formato_desconhecido', 'nao_reconhecida', true]]
    .forEach(function (x) {
      var m = {}; m[k(MP_NOVO)] = { caderneta: x[0], valor: 32.99 };
      var c = J(s._notifFinClassificar(MP_NOVO, m));
      assert.deepStrictEqual([c.classe, c.alerta], [x[1], x[2]], x[0]);
    });
});

test('Mercado Pago/Bradesco com valor e verbo de transação num formato novo viram "desconhecido" (guarda o bruto e avisa), sem pegar promoção, saque, fatura nem rendimento', function () {
  var s = sb();
  assert.deepStrictEqual(J(s._bancoParse('Mercado Pago', 'Pagamento aprovado', 'Seu pagamento de R$ 50,00 foi aprovado.')), { desconhecido: true, origem: 'mp', auto: false });
  assert.deepStrictEqual(J(s._bancoParse('Bradesco', 'BRADESCO', 'Compra aprovada de R$ 12,00 em LOJA.')).desconhecido, true);
  [['Mercado Pago', 'Promoção', 'Ganhe R$ 20 de desconto no pix.'], ['Bradesco', 'BRADESCO', 'Saque de R$ 100,00 no caixa.'], ['Mercado Pago', 'Fatura', 'Sua fatura de R$ 300 vence amanhã (boleto).'],
   ['Mercado Pago', 'Rendimento', 'Seu dinheiro rendeu R$ 1,20 hoje.'], ['Mercado Pago', 'Olá', 'Sem valor nenhum aqui.']]
    .forEach(function (n) { assert.strictEqual(s._bancoParse(n[0], n[1], n[2]), null, n[2]); });
  assert.ok(s._pareceTransacao('Você pagou R$ 5 no pix') && !s._pareceTransacao('Você ganhou R$ 5 de cashback no pix'));
});

test('Caixa de notificações: classifica cada uma com o financeiro, conta alertas e só o dono vê', function () {
  var em = Date.now() - 3600e3;
  var colecoes = {
    notificacoes: [
      { id: 'n1', dados: { app: 'Mercado Pago', titulo: MP_NOVO.titulo, texto: MP_NOVO.texto, em: em } },
      { id: 'n2', dados: { app: 'Bíblia', titulo: 'Palavra do dia', texto: 'João 3:16', em: em - 1000 } },
      { id: 'n3', dados: { app: 'Swile BR', titulo: 'Compra aprovada', texto: 'Compra aprovada de R$ 13,80 na carteira Refeição e Alimentação, no estabelecimento PADARIA X.', em: em - 2000 } }
    ],
    financeiro: [{ id: 'f1', dados: { app: 'Swile BR', titulo: 'Compra aprovada', texto: 'Compra aprovada de R$ 13,80 na carteira Refeição e Alimentação, no estabelecimento PADARIA X.', caderneta: 'registrado', valor: 13.8 } }]
  };
  var s = sb({ colecoes: colecoes }), r = J(s.dashboardNotificacoes('tok-dono'));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.resumo, { total: 3, financeiras: 2, alertas: 1 });
  var por = {}; r.itens.forEach(function (i) { por[i.id] = i; });
  assert.deepStrictEqual([por.n1.classe, por.n1.alerta, por.n1.reprocessavel], ['sem_registro', true, true]);
  assert.deepStrictEqual([por.n2.financeira, por.n2.classe], [false, 'comum']);
  assert.deepStrictEqual([por.n3.classe, por.n3.alerta], ['registrada', false]);
  assert.strictEqual(s.dashboardNotificacoes('tok-outro').ok, false);
});

test('Reprocessar: só do dono, só banco, e devolve "não reconheço" quando o formato é desconhecido', function () {
  var colecoes = { notificacoes: [
    { id: 'a', dados: { app: 'Bíblia', titulo: 'x', texto: 'y', em: 1 } },
    { id: 'b', dados: { app: 'Mercado Pago', titulo: 'Olá', texto: 'nada de valor', em: Date.now() } }] };
  var s = sb({ colecoes: colecoes });
  assert.strictEqual(s.reprocessarNotificacao('tok-outro', 'a').ok, false);
  assert.match(s.reprocessarNotificacao('tok-dono', 'a').erro, /Só reprocesso notificações de banco/);
  assert.match(s.reprocessarNotificacao('tok-dono', 'b').erro, /Não reconheço esse formato/);
  assert.match(s.reprocessarNotificacao('tok-dono', 'zzz').erro, /não encontrada/);
});

test('Interface: os dois cartões carregam sozinhos, escapam o texto e o CSS cobre as classes que o JS gera', function () {
  var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8'), CSS = fs.readFileSync(path.join(__dirname, '..', 'Stylesheet.html'), 'utf8');
  assert.match(JS, /\.dashboardFinancas\(authToken\)/); assert.match(JS, /\.dashboardNotificacoes\(authToken\)/); assert.match(JS, /\.reprocessarNotificacao\(authToken,/);
  assert.match(JS, /montarCardsFinNotif\(cards\);/);
  var bloco = JS.slice(JS.indexOf('/*DASH_FIN_INI*/'), JS.indexOf('/*DASH_FIN_FIM*/'));
  assert.doesNotMatch(bloco, /innerHTML\s*[+]?=[^;]*\bi\.(texto|titulo|app)\b(?![^;]*escapeHtml)/, 'nenhum texto de notificação entra no HTML sem escapeHtml');
  ['dash-wide', 'fin-kpis', 'fin-chip', 'nt-lista', 'nt-row', 'nt-alerta', 'fin-filtro'].forEach(function (c) { assert.ok(CSS.indexOf('.' + c) !== -1, 'CSS de ' + c); });
});
