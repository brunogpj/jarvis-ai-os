// pix-enviado-conta.test.js — Pix enviado e pagamento de conta pelo saldo do Mercado Pago (10/11/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

// obrigações do mês como o Worker devolve no resumo
var OBR = [
  { chave: 'd:luz', nome: 'Luz', tipo: 'conta', dia: 5, valor: 280.5, pago: false, outroPaga: false },
  { chave: 'd:agua', nome: 'Água', tipo: 'conta', dia: 25, valor: 98.1, pago: false, outroPaga: true },
  { chave: 'd:internet', nome: 'Internet', tipo: 'conta', dia: 10, valor: 100, pago: false, outroPaga: false },
  { chave: 'd:aluguel', nome: 'Aluguel', tipo: 'conta', dia: 10, valor: 800, pago: true, outroPaga: false },
  { chave: 'c:itau', nome: 'Fatura Itaú', tipo: 'fatura', dia: 19, valor: 387.57, pago: false, outroPaga: false }
];

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-11-10' : (p === 'd' ? '10' : (p === 'H' ? '13' : '2026-11-10')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = []; s._avisos = []; s._docs = {};
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (/\/resumo/.test(url)) {
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ mes: '2026-11', obrigacoes: o.obr || OBR }); } };
    }
    s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
    var resp = /pagamento/.test(url) ? (o.pagResp || { ok: true, mudou: true }) : { ok: true, criado: true };
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(resp); } };
  } };
  s.Firestore = {
    getDoc: function (c, id) { return s._docs[id] || null; },
    setDoc: function (c, id, d) { s._docs[id] = d; },
    updateDoc: function (c, id, p) { Object.assign(s._docs[id], p); },
    listDocs: function () { return []; }
  };
  loadGasFile('Financas.js', s);
  loadGasFile('Code.js', s);
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var N = function (titulo, texto) { return { app: 'Mercado Pago', pacote: '', titulo: titulo, texto: texto }; };

test('_bancoParse: Pix enviado e pagamento de conta do Mercado Pago registram sozinhos', function () {
  var s = sb();
  var a = J(s._bancoParse('Mercado Pago', 'Pix enviado', 'Você enviou R$ 45,00 para Padaria Exemplo.'));
  assert.deepStrictEqual([a.valor, a.estabelecimento, a.meio, a.auto, a.pixEnviado], [45, 'Padaria Exemplo', 'Pix / débito', true, true]);
  var b = J(s._bancoParse('Mercado Pago', 'Você fez um Pix', 'Você fez um Pix de R$ 1.200,00 para Loja Exemplo Ltda'));
  assert.deepStrictEqual([b.valor, b.estabelecimento, b.auto], [1200, 'Loja Exemplo Ltda', true]);
  var c = J(s._bancoParse('Mercado Pago', 'Pagamento de conta', 'Você pagou R$ 98,10 para COMPANHIA DE AGUA EXEMPLO.'));
  assert.deepStrictEqual([c.valor, c.estabelecimento, c.meio, c.auto, c.contaPaga], [98.1, 'COMPANHIA DE AGUA EXEMPLO', 'Boleto', true, true]);
  var d = J(s._bancoParse('Mercado Pago', 'Conta paga', 'O pagamento de R$ 50,00 foi aprovado.'));
  assert.deepStrictEqual([d.valor, d.estabelecimento, d.meio], [50, 'Pagamento de conta', 'Boleto']);
  assert.ok(!(s._bancoParse('Mercado Pago', 'Pagamento de conta agendado', 'Sua conta de R$ 98,10 vence amanhã.') || {}).contaPaga, 'agendado/vencimento não é pagamento');
  var e = J(s._bancoParse('Mercado Pago', 'Você pagou R$ 297,79 a Concessionaria Energia Exemplo', 'Pagamento feito com o saldo da conta.'));
  assert.deepStrictEqual([e.meio, e.auto, e.pixEnviado], ['Pix / débito', true, true]);
});

test('Pix para a concessionária de luz: marca a conta Luz como paga (não cria gasto) e avisa a diferença do previsto', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 297,79 para CEMIG DISTRIBUICAO S.A.')));
  assert.deepStrictEqual([r.acao, r.status, r.conta], ['conta_fixa', 'conta_paga', 'Luz']);
  assert.strictEqual(s._posts.length, 1);
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.chave, s._posts[0].corpo.pago, s._posts[0].corpo.valor_esperado], ['/pagamento', 'd:luz', true, 280.5]);
  assert.ok(/marquei Luz como paga\. Na caderneta a previsão era R\$ 280,50/.test(s._avisos[0].falar), s._avisos[0].falar);
  assert.ok(/Voltou a ficar pendente|voltou a ficar pendente/.test(J(s.Financas.conversar('desfaz')).resp));
});

test('conta paga por outra pessoa: o dinheiro saiu do saldo dele, então vira GASTO (Casa), não marca a conta', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(N('Pagamento de conta', 'Você pagou R$ 98,10 para COPASA MG.')));
  assert.deepStrictEqual([r.acao, r.status, r.categoria], ['gasto_banco', 'registrado', 'Casa']);
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.valor, c.meio, c.categoria], ['/gasto', 98.1, 'Boleto', 'Casa']);
  assert.ok(/^Água – COPASA MG/.test(c.descricao), c.descricao);
});

test('internet pelo provedor e fatura pelo valor exato; sem conta que case vira gasto comum', function () {
  var s = sb();
  assert.strictEqual(J(s._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 99,90 para Implay Servicos Digitais Ltda.'))).conta, 'Internet');
  var f = sb();
  assert.strictEqual(J(f._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 387,57 para BANCO EXEMPLO S.A.'))).conta, 'Fatura Itaú');
  var g = sb();
  var r = J(g._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 35,00 para Pizzaria Exemplo.')));
  assert.deepStrictEqual([r.acao, r.status], ['gasto_banco', 'registrado']);
  assert.deepStrictEqual([g._posts[0].url, g._posts[0].corpo.meio], ['/gasto', 'Pix / débito']);
  // aluguel já pago: não casa de novo pelo valor; vira gasto comum
  var h = sb();
  assert.strictEqual(J(h._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 800,00 para Fulano Exemplo.'))).acao, 'gasto_banco');
});

test('conta já marcada como paga no app: avisa e não registra de novo; falha ao marcar avisa', function () {
  var s = sb({ pagResp: { ok: true, mudou: false } });
  assert.strictEqual(J(s._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 297,79 para CEMIG DISTRIBUICAO S.A.'))).status, 'conta_ja_paga');
  assert.ok(/já estava marcada como paga/.test(s._avisos[0].falar));
});

test('Pix enviado para ele mesmo (FIN_NOME_DONO) é transferência entre contas, não gasto', function () {
  var s = sb({ props: { FIN_NOME_DONO: 'fulano de tal silva' } });
  var r = J(s._bancoParaCaderneta(N('Pix enviado', 'Você enviou R$ 500,00 para Fulano de Tal Silva.')));
  assert.strictEqual(r.status, 'transferencia_propria'); assert.strictEqual(s._posts.length, 0);
});
