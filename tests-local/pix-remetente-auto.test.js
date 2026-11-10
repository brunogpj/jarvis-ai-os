// pix-remetente-auto.test.js — Pix recebido de remetente de confiança (FIN_REMETENTES_AUTO) vira receita sem perguntar (10/11/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-11-09' : (p === 'd' ? '09' : (p === 'H' ? '10' : '2026-11-09')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = []; s._avisos = []; s._docs = {};
  s.UrlFetchApp = { fetch: function (url, opt) {
    s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
    if (o.rede) throw new Error('rede caiu');
    var resp = /desfazer/.test(url) ? { ok: true, removido: 1 } : (o.resposta || { ok: true, criado: true });
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

test('_bancoParse: formatos de Pix recebido do Mercado Pago (corpo "NOME te enviou R$ X", título com valor e nome no corpo)', function () {
  var s = sb();
  var a = J(s._bancoParse('Mercado Pago', 'Você recebeu um Pix', 'MARIA EXEMPLO SOUZA te enviou R$ 1.400,00.'));
  assert.deepStrictEqual([a.entrada, a.origem, a.valor, a.remetente, a.auto], [true, 'mp', 1400, 'MARIA EXEMPLO SOUZA', false]);
  var b = J(s._bancoParse('Mercado Pago', 'Você recebeu R$ 250,00', 'De Maria Exemplo Souza'));
  assert.deepStrictEqual([b.entrada, b.valor, b.remetente], [true, 250, 'Maria Exemplo Souza']);
  var c = J(s._bancoParse('Mercado Pago', 'Pix recebido', 'Você recebeu um Pix de R$ 80,00 de Maria Exemplo Souza.'));
  assert.deepStrictEqual([c.entrada, c.valor, c.remetente], [true, 80, 'Maria Exemplo Souza']);
  var d = J(s._bancoParse('Mercado Pago', 'Maria Exemplo enviou R$ 50,00 para você', ''));
  assert.deepStrictEqual([d.entrada, d.valor, d.remetente], [true, 50, 'Maria Exemplo']);
  // o que ele mesmo enviou não é entrada
  var e = s._bancoParse('Mercado Pago', 'Pix enviado', 'Você enviou R$ 45,00 para Loja X.');
  assert.ok(!e || !e.entrada, 'Pix enviado não vira entrada');
  // os formatos de gasto continuam iguais
  var g = J(s._bancoParse('Mercado Pago', 'Você pagou R$ 30 a Google CLOUD T7VH4R', 'O valor vai entrar na próxima fatura do seu Cartão Mercado Pago.'));
  assert.deepStrictEqual([g.valor, g.meio, g.auto], [30, 'Cartão de crédito', true]);
});

test('remetenteAutomatico: todas as palavras do nome configurado; categoria válida ou Outros', function () {
  var s = sb({ props: { FIN_REMETENTES_AUTO: 'maria exemplo=ajuda da esposa nas despesas; joao teste' } });
  assert.deepStrictEqual(J(s.Financas.remetenteAutomatico('MARIA EXEMPLO SOUZA')), { nome: 'maria exemplo', categoria: 'Ajuda da esposa nas despesas' });
  assert.deepStrictEqual(J(s.Financas.remetenteAutomatico('João Teste da Silva')), { nome: 'joao teste', categoria: 'Outros' });
  assert.strictEqual(s.Financas.remetenteAutomatico('MARIA LIMA'), null, 'só o primeiro nome não basta quando o configurado tem dois');
  assert.strictEqual(s.Financas.remetenteAutomatico('MARIANA EXEMPLO'), null, 'palavra inteira, não pedaço');
  assert.strictEqual(sb().Financas.remetenteAutomatico('MARIA EXEMPLO'), null, 'sem a propriedade, ninguém é automático');
  var x = sb({ props: { FIN_REMETENTES_AUTO: 'maria=categoria inventada' } });
  assert.strictEqual(x.Financas.remetenteAutomatico('Maria Exemplo').categoria, 'Outros');
});

test('Pix de remetente de confiança: registra sozinho como receita, avisa e o "desfaz" tira', function () {
  var s = sb({ props: { FIN_REMETENTES_AUTO: 'maria exemplo' } });
  var r = J(s._bancoParaCaderneta(N('Você recebeu um Pix', 'MARIA EXEMPLO SOUZA te enviou R$ 1.400,00.')));
  assert.strictEqual(r.status, 'registrado');
  assert.strictEqual(s._posts.length, 1);
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.origem, c.valor, c.categoria, c.data], ['/receita', 'mp', 1400, 'Outros', '2026-11-09']);
  assert.ok(/Maria Exemplo Souza/.test(c.descricao), c.descricao);
  assert.ok(/^Registrei o Pix de R\$ 1400,00 de Maria Exemplo Souza como receita \(Outros\)\. Diga desfaz para tirar\.$/.test(s._avisos[0].falar), s._avisos[0].falar);
  assert.strictEqual(J(s.Financas.conversar('sim')), null, 'nada ficou esperando o sim');
  assert.ok(/Desfeito: tirei a receita de R\$ 1\.400,00/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].url, '/receita/desfazer');
  // a mesma notificação de novo não grava outra vez
  var r2 = J(s._bancoParaCaderneta(N('Você recebeu um Pix', 'MARIA EXEMPLO SOUZA te enviou R$ 1.400,00.')));
  assert.strictEqual(r2.jaRegistrado, true);
});

test('remetente de confiança: receita igual já digitada não duplica; caderneta fora do ar volta a perguntar', function () {
  var d = sb({ props: { FIN_REMETENTES_AUTO: 'maria exemplo' }, resposta: { ok: true, criado: false, motivo: 'ja_existe' } });
  assert.strictEqual(J(d._bancoParaCaderneta(N('Você recebeu um Pix', 'Maria Exemplo te enviou R$ 300,00.'))).status, 'duplicado_manual');
  assert.ok(/Já havia uma receita igual/.test(d._avisos[0].falar));
  var f = sb({ props: { FIN_REMETENTES_AUTO: 'maria exemplo' }, rede: true });
  assert.strictEqual(J(f._bancoParaCaderneta(N('Você recebeu um Pix', 'Maria Exemplo te enviou R$ 300,00.'))).status, 'aguarda_confirmacao');
  assert.ok(/Não consegui registrar sozinho\. Você recebeu um Pix de R\$ 300,00 de Maria Exemplo\. Registro como receita extra\?/.test(f._avisos[0].falar), f._avisos[0].falar);
});

test('outros remetentes seguem com a pergunta de sempre', function () {
  var s = sb({ props: { FIN_REMETENTES_AUTO: 'maria exemplo' } });
  var r = J(s._bancoParaCaderneta(N('Você recebeu um Pix', 'Pedro Qualquer te enviou R$ 63,00.')));
  assert.strictEqual(r.status, 'aguarda_confirmacao'); assert.strictEqual(s._posts.length, 0);
  assert.ok(/Registro como receita extra\? Diga sim ou não\./.test(s._avisos[0].falar));
});
