// categoria-outros.test.js — classificar melhor "Outros" (15/10/2026): o dono ENSINA a categoria por voz ("Railway é Trabalho"), a regra vale para os próximos gastos e corrige os que já
// estão em Outros, com "sim" e "desfaz". Caso real: o JEV sozinho classificou "Railway" (hospedagem) como Transporte com 0,98. Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var OUTROS = [
  { id: 'a1', descricao: 'Railway', valor: 26.81, data: '2026-10-01', meio: 'Cartão de crédito' },
  { id: 'a2', descricao: 'Gastos diversos', valor: 43, data: '2026-10-01', meio: 'Pix / débito' },
  { id: 'a3', descricao: 'Farmácia Nova', valor: 18.5, data: '2026-10-05', meio: 'Pix / débito' },
  { id: 'a4', descricao: 'Assinatura XYZ', valor: 39.8, data: '2026-10-11', meio: 'Cartão de crédito' }
];
function dados(itens) {
  return { mes: '2026-10', hoje: '2026-10-15', livreHoje: 100, livreFim: 100, aPagar: 0, obrigacoes: [], orcamentos: [], receitas: [], mercado: { total: 0, noVoucher: 0, outros: 0, n: 0 },
           investimentos: { total: 0, itens: [], porCategoria: {} }, metaAlocacao: null, gastosMes: { total: 0, n: 0, porCategoria: {}, maiores: [], outrosItens: itens } };
}
/** jev = { 'texto da descrição': ['categoria_ascii', conf] }; o que não consta → outros 0,99. posts guarda os POSTs ao Worker. */
function sb(itens, jev, props, trocaRetorno) {
  var s = makeSandbox({ props: Object.assign({ TYPESAFE_API_KEY: 'k', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, props || {}) });
  s._posts = []; s._jevPerguntas = [];
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-15' : '2026'; };
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (/typesafe/.test(url)) {
      var corpo = JSON.parse(opt.payload); s._jevPerguntas.push(corpo.state);
      var r = (jev || {})[corpo.state.lugar_ou_descricao] || ['outros', 0.99];
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ answers: { cat: { type: 'choice', choice: r[0], confidence: r[1], probabilities: {} } } }); } };
    }
    if (opt && opt.method === 'post') {
      var c = JSON.parse(opt.payload); s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: c });
      var mudou = trocaRetorno ? trocaRetorno(c) : (c.itens || []).map(function (i) { return i.id; });
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ ok: true, mudou: mudou, ignorados: [] }); } };
    }
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(dados(itens)); } };
  } };
  loadGasFile('TypeSafe.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var regras = function (s) { return JSON.parse(s.PropertiesService.getScriptProperties().getProperty('FIN_CAT_REGRAS') || '[]'); };

test('Ensinar: "Railway é trabalho" propõe guardar a regra e mudar o gasto que está em Outros; "sim" faz as duas coisas; "desfaz" desfaz as duas', function () {
  var s = sb(OUTROS);
  var p = J(s.Financas.conversar('Railway é trabalho'));
  assert.strictEqual(p.resp, 'Entendi: gasto com "railway" é Trabalho. Guardo isso para os próximos e mudo 1 gasto de Outros (R$ 26,81) para Trabalho? Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0, 'nada gravado antes do sim');
  assert.deepStrictEqual(regras(s), []);
  var ok = J(s.Financas.conversar('sim'));
  assert.strictEqual(ok.resp, 'Guardei: "railway" é Trabalho. Troquei 1 gasto de Outros. Para desfazer, diga desfaz.');
  assert.deepStrictEqual(s._posts[0], { url: '/categoria', corpo: { itens: [{ id: 'a1', de: 'Outros', para: 'Trabalho' }] } });
  assert.deepStrictEqual(regras(s), [{ t: 'railway', c: 'Trabalho' }]);
  var d = J(s.Financas.conversar('desfaz'));
  assert.strictEqual(d.resp, 'Desfeito: esqueci a regra de "railway" e 1 gasto voltou para Outros.');
  assert.deepStrictEqual(s._posts[1].corpo.itens, [{ id: 'a1', de: 'Trabalho', para: 'Outros' }]);
  assert.deepStrictEqual(regras(s), []);
});

test('Ensinar: a regra vale para os PRÓXIMOS gastos (categoriaDe) e vence a lista de palavras e o JEV; sem item em Outros só guarda a regra', function () {
  var s = sb([], { 'Railway Brasil': ['transporte', 0.98] });
  assert.strictEqual(s.Financas.categoriaDe('Railway Brasil'), 'Trabalho', 'por palavras (hospedagem) — o JEV dizia Transporte');
  var p = J(s.Financas.conversar('classifica o padaria do zé como lazer'));
  assert.match(p.resp, /^Entendi: gasto com "padaria do ze" é Lazer\. Guardo isso para os próximos\? Diga sim ou não\.$/);
  s.Financas.conversar('sim');
  assert.strictEqual(s._posts.length, 0, 'sem item em Outros não chama o Worker');
  assert.strictEqual(s.Financas.categoriaDe('Padaria do Zé'), 'Lazer', 'a regra do dono vence a lista (padaria = Alimentação)');
  assert.strictEqual(s.Financas.categoriaDe('Padaria Estrela'), 'Alimentação', 'outras padarias seguem a lista');
});

test('Ensinar: frases que NÃO são ensino (meta, conversa, categoria sozinha, número) não propõem nada', function () {
  var s = sb(OUTROS);
  ['minha meta é casa', 'isso é trabalho', 'o gasto é casa', 'trabalho é casa', 'o plano 123 é lazer', 'quanto gastei com casa', 'hoje é lazer'].forEach(function (f) {
    var r = s.Financas.conversar(f);
    assert.ok(r === null || !/Entendi: gasto com/.test(r.resp), f + ' → ' + JSON.stringify(r));
  });
});

test('Reclassificar: com regra do dono propõe, o sim troca no Worker e o desfaz volta; o resto fica em Outros', function () {
  var s = sb(OUTROS);
  s.PropertiesService.getScriptProperties().setProperty('FIN_CAT_REGRAS', JSON.stringify([{ t: 'railway', c: 'Trabalho' }]));
  var p = J(s.Financas.conversar('reclassifica os gastos em outros'));
  assert.strictEqual(p.resp, 'Posso mudar 1 gasto de Outros: Railway para Trabalho. Os outros 3 ficam em Outros. Aplico? Diga sim ou não.');
  var ok = J(s.Financas.conversar('sim'));
  assert.strictEqual(ok.resp, 'Troquei a categoria de 1 gasto: Railway para Trabalho. Para desfazer, diga desfaz.');
  assert.deepStrictEqual(s._posts[0].corpo.itens, [{ id: 'a1', de: 'Outros', para: 'Trabalho' }]);
  assert.strictEqual(J(s.Financas.conversar('desfaz')).resp, 'Desfeito: 1 gasto voltou para Outros.');
  assert.deepStrictEqual(s._posts[1].corpo.itens, [{ id: 'a1', de: 'Trabalho', para: 'Outros' }]);
});

test('Reclassificar: sem certeza de nenhum, não muda nada e ensina como ensinar; lista os maiores', function () {
  var s = sb(OUTROS.filter(function (i) { return i.id !== 'a1' && i.id !== 'a3'; }));
  var r = J(s.Financas.conversar('classifica melhor os gastos em outros'));
  assert.strictEqual(r.resp, 'Tenho 2 gastos em Outros, R$ 82,80, e não tenho certeza da categoria de nenhum: Gastos diversos R$ 43,00, Assinatura XYZ R$ 39,80. Para eu aprender, diga por exemplo: "Assinatura é Trabalho".');
  assert.strictEqual(s._posts.length, 0);
});

test('Sugestão automática só quando a lista de palavras E o JEV concordam: "Railway" (palavras Trabalho, JEV Transporte 0,98) NÃO muda; "Farmácia Nova" (palavras Saúde, JEV Saúde 0,9) muda', function () {
  var s = sb(OUTROS, { 'Railway': ['transporte', 0.98], 'Farmácia Nova': ['saude', 0.9] });
  var p = J(s.Financas.conversar('reclassifica os outros'));
  assert.match(p.resp, /^Posso mudar 1 gasto de Outros: Farmácia Nova para Saúde\. Os outros 3 ficam em Outros\./);
  assert.ok(!/Railway para/.test(p.resp), 'o caso real em que o JEV errou com 0,98');
  var discorda = sb(OUTROS, { 'Farmácia Nova': ['lazer', 0.95] });
  assert.ok(!/Farmácia Nova para/.test(J(discorda.Financas.conversar('reclassifica os outros')).resp), 'JEV discordando da lista → não sugere');
  var fraco = sb(OUTROS, { 'Farmácia Nova': ['saude', 0.70] });
  assert.ok(!/Farmácia Nova para/.test(J(fraco.Financas.conversar('reclassifica os outros')).resp), 'certeza < 0,85 → não sugere');
});

test('Worker avisa que a categoria já mudou no app (ignorados): o Jarvis diz que nada mudou, e o desfaz só volta o que de fato mudou', function () {
  var s = sb(OUTROS, null, null, function () { return []; });
  s.Financas.conversar('Railway é trabalho');
  assert.match(J(s.Financas.conversar('sim')).resp, /^Guardei: "railway" é Trabalho\. Para desfazer, diga desfaz\.$/, 'a regra vale mesmo que o gasto já tenha sido mudado no app');
  var r = sb(OUTROS, null, null, function () { return []; });
  r.PropertiesService.getScriptProperties().setProperty('FIN_CAT_REGRAS', JSON.stringify([{ t: 'railway', c: 'Trabalho' }]));
  r.Financas.conversar('reclassifica os outros');
  assert.strictEqual(J(r.Financas.conversar('sim')).resp, 'Nada mudou: essas categorias já tinham sido alteradas no app.');
});
