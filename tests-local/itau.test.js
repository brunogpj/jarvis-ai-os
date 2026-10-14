// itau.test.js — notificações do Itaú SEM formato conhecido (14/10/2026): nada de chute, nada automático. Vira pergunta falada ("Registro como gasto?"), só o "sim"
// grava (origem it), e o texto bruto fica guardado para o parser exato ser escrito depois. Dados INVENTADOS (os textos abaixo são ilustrativos, não o formato real do Itaú).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : (p === 'd' ? '14' : '2026-10-14')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = []; s._avisos = []; s._docs = {};
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') {
      s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(o.resposta || { ok: true, criado: true, removido: 1 }); } };
    }
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
  } };
  s.Firestore = {
    getDoc: function (c, id) { return s._docs[id] || null; },
    setDoc: function (c, id, d) { s._docs[id] = d; },
    updateDoc: function (c, id, p) { Object.assign(s._docs[id], p); },
    listDocs: function () { return Object.keys(s._docs).map(function (k) { return { id: k, dados: s._docs[k] }; }); }
  };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  loadGasFile('Code.js', s);
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var N = function (texto, app) { return { app: app || 'Itaú', pacote: '', titulo: 'Itaú', texto: texto }; };

test('_bancoParse Itaú: um valor + palavra de compra/recebimento vira candidato (nunca automático); o resto não vira transação', function () {
  var s = sb();
  var a = J(s._bancoParse('Itaú', 'Itaú', 'Compra aprovada no cartão de crédito de R$ 50,00 em PADARIA CENTRAL.'));
  assert.deepStrictEqual([a.generico, a.auto, a.valor, a.meio, a.estabelecimento, a.origem], [true, false, 50, 'Cartão de crédito', 'PADARIA CENTRAL', 'it']);
  var b = J(s._bancoParse('Itaú', 'Itaú', 'Compra no débito de R$ 12,30 em LANCHONETE X'));
  assert.deepStrictEqual([b.meio, b.valor], ['Pix / débito', 12.3]);
  var c = J(s._bancoParse('Itaú', 'Itaú', 'Você fez um Pix de R$ 80,00 para Maria Silva.'));
  assert.deepStrictEqual([c.generico, c.meio, c.estabelecimento], [true, 'Pix / débito', 'Maria Silva']);
  var d = J(s._bancoParse('Itaú', 'Itaú', 'Compra aprovada de R$ 20,00 em LOJA Y.'));
  assert.strictEqual(d.meio, null, 'sem dizer crédito/débito/pix a forma de pagar fica em aberto');
  var e = J(s._bancoParse('Itaú', 'Itaú', 'Você recebeu um Pix de R$ 63,00 de João Souza.'));
  assert.deepStrictEqual([e.entrada, e.generico, e.valor, e.remetente], [true, true, 63, 'João Souza']);
  assert.strictEqual(J(s._bancoParse('Itaú', 'Itaú', 'Saldo disponível R$ 100,00 e R$ 200,00 em compras')).desconhecido, true, 'dois valores: não chuta');
  assert.strictEqual(J(s._bancoParse('Itaú', 'Itaú', 'Saque de R$ 100,00 no caixa')).desconhecido, true);
  ['Sua fatura de R$ 387,57 vence dia 19', 'Boleto de R$ 99,90 vence amanhã', 'Oferta: empréstimo de até R$ 5.000,00', 'Seu extrato está disponível', 'Limite de R$ 3.000,00 aumentado']
    .forEach(function (t) { assert.strictEqual(s._bancoParse('Itaú', 'Itaú', t), null, t); });
  assert.strictEqual(s._bancoParse('Itaú Investimentos', 'x', 'Compra de R$ 100,00 em ações'), null, 'o app de investimentos fica de fora (ações vêm depois)');
});

test('gasto no Itaú com forma de pagar no texto: pergunta falada, nada gravado; o sim grava com origem it e categoria; desfaz tira', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(N('Compra aprovada no cartão de crédito de R$ 50,00 em PADARIA CENTRAL.')));
  assert.strictEqual(r.status, 'aguarda_confirmacao'); assert.strictEqual(s._posts.length, 0);
  var av = s._avisos[0];
  assert.strictEqual(av.falar, av.texto); assert.strictEqual(av.falarLocal, true);
  assert.strictEqual(av.texto, 'No Itaú: gasto de R$ 50,00 em PADARIA CENTRAL, no crédito. Registro na caderneta, categoria Alimentação? Diga sim ou não.');
  var ok = J(s.Financas.conversar('sim'));
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.origem, c.valor, c.meio, c.categoria, c.descricao], ['/gasto', 'it', 50, 'Cartão de crédito', 'Alimentação', 'PADARIA CENTRAL']);
  assert.ok(/^Registrei o gasto de R\$ 50,00 em PADARIA CENTRAL, no crédito\./.test(ok.resp), ok.resp);
  assert.ok(/Desfeito: tirei o gasto de R\$ 50,00/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].corpo.origem, 'it');
});

test('gasto no Itaú sem a forma de pagar: pergunta; a resposta completa a proposta; não descarta', function () {
  var s = sb();
  s._bancoParaCaderneta(N('Compra aprovada de R$ 20,00 em LOJA Y.'));
  assert.ok(/Foi no crédito, no débito ou no pix\?$/.test(s._avisos[0].falar), s._avisos[0].falar);
  assert.strictEqual(J(s.Financas.conversar('sim')), null, 'o sim não responde à pergunta da forma de pagar');
  var c = J(s.Financas.conversar('no débito'));
  assert.ok(/^Confirma o gasto de R\$ 20,00 em LOJA Y, no débito, categoria Compras, hoje\? Diga sim ou não\.$/.test(c.resp), c.resp);
  s.Financas.conversar('sim');
  assert.strictEqual(s._posts[0].corpo.meio, 'Pix / débito'); assert.strictEqual(s._posts[0].corpo.origem, 'it');
  var n = sb();
  n._bancoParaCaderneta(N('Compra aprovada no débito de R$ 5,00 em X Y'));
  assert.ok(/Certo, não registrei esse gasto do Itaú/.test(J(n.Financas.conversar('não')).resp));
  assert.strictEqual(n._posts.length, 0);
});

test('gasto do Itaú que ele já digitou: o Worker diz que já existe e o Jarvis não duplica; Pix recebido pergunta e grava como receita origem it', function () {
  var s = sb({ resposta: { ok: true, criado: false, motivo: 'ja_existe' } });
  s._bancoParaCaderneta(N('Compra no débito de R$ 12,30 em LANCHONETE X'));
  assert.ok(/Já havia um gasto igual na caderneta, então não dupliquei\./.test(J(s.Financas.conversar('sim')).resp));
  var e = sb();
  var r = J(e._bancoParaCaderneta(N('Você recebeu um Pix de R$ 63,00 de João Souza.')));
  assert.strictEqual(r.status, 'aguarda_confirmacao'); assert.strictEqual(e._posts.length, 0);
  assert.ok(/^Você recebeu um Pix de R\$ 63,00 de João Souza\. Registro como receita extra\? Diga sim ou não\.$/.test(e._avisos[0].falar), e._avisos[0].falar);
  e.Financas.conversar('sim');
  assert.deepStrictEqual([e._posts[0].url, e._posts[0].corpo.origem, e._posts[0].corpo.valor], ['/receita', 'it', 63]);
});

test('formato que não dá para interpretar: guarda o texto bruto, avisa (e fala) e não propõe nada; fatura e boleto seguem as regras de sempre', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(N('Pagamento programado de R$ 100,00 e tarifa de R$ 7,90 confirmados')));
  assert.strictEqual(r.status, 'formato_desconhecido'); assert.strictEqual(s._posts.length, 0);
  var doc = s._docs[Object.keys(s._docs)[0]];
  assert.deepStrictEqual([doc.tipo, doc.parseado, doc.caderneta], ['banco_desconhecido', false, 'formato_desconhecido']);
  assert.ok(/Pagamento programado de R\$ 100,00 e tarifa de R\$ 7,90 confirmados/.test(doc.bruto));
  assert.ok(/ainda não sei interpretar/.test(s._avisos[0].falar) && s._avisos[0].falar === s._avisos[0].texto);
  assert.strictEqual(J(s._bancoParaCaderneta(N('Sua fatura de R$ 387,57 vence dia 19'))), null);
  assert.strictEqual(J(s._bancoParaCaderneta(N('Promoção imperdível'))), null);
});

test('notificação repetida não gera segunda pergunta; BANCOS_PARA_CADERNETA=nao desliga o Itaú também', function () {
  var s = sb();
  var n = N('Compra aprovada no cartão de crédito de R$ 50,00 em PADARIA CENTRAL.');
  s._bancoParaCaderneta(n);
  assert.strictEqual(J(s._bancoParaCaderneta(n)).jaRegistrado, true);
  assert.strictEqual(s._avisos.length, 1);
  assert.strictEqual(sb({ props: { BANCOS_PARA_CADERNETA: 'nao' } })._bancoParaCaderneta(n), null);
});
