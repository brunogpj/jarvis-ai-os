// fechar-mes.test.js — fechar e reabrir o mês por voz, com confirmação (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function mesDados(mes, o) {
  return Object.assign({ mes: mes, hoje: '2026-10-14', inicio: '2026-09', livreHoje: 117.18, livreFim: 480.5, receita: 6709.73, saidas: 3863.81, sobra: 2845.92, aplicado: 2500, fechado: false,
    obrigacoes: [{ chave: 'd:a', nome: 'Aluguel', valor: 700, pago: true, outroPaga: false }], investimentos: { total: 100, itens: [], porCategoria: {} } }, o || {});
}

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : '2026-10-14'); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') {
      s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
      if (o.rede) throw new Error('rede caiu');
      var resp = o.respostaFechar || { ok: true, mudou: true, fechado: true, livreFim: 480.5 };
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(resp); } };
    }
    if (o.rede) throw new Error('rede caiu');
    var mes = (url.match(/mes=(\d{4}-\d{2})/) || [])[1] || '2026-10';
    var d = (o.porMes && o.porMes[mes]) || mesDados(mes);
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(d); } };
  } };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('"fecha setembro": repete renda, saídas, sobra e o livre que passa para outubro; só o sim fecha; desfaz reabre', function () {
  var s = sb();
  var p = J(s.Financas.conversar('fecha setembro'));
  assert.strictEqual(p.resp, 'Fecho setembro? Renda R$ 6.709,73, saídas R$ 3.863,81, sobra de R$ 2.845,92, e o livre que passa para outubro é R$ 480,50. Isso congela os números de setembro. Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0, 'nada gravado antes do sim');
  var ok = J(s.Financas.conversar('sim'));
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.mes, s._posts[0].corpo.acao], ['/fechar-mes', '2026-09', 'fechar']);
  assert.strictEqual(ok.resp, 'Fechei setembro. O livre que passa para outubro é R$ 480,50. Para reabrir, diga desfaz.');
  var log = JSON.parse(s.PropertiesService.getScriptProperties().getProperty('FIN_LOG_ACOES'));
  assert.strictEqual(log[0].desc, 'o fechamento de setembro');
  assert.strictEqual(J(s.Financas.conversar('desfaz')).resp, 'Desfeito: reabri setembro.');
  assert.strictEqual(s._posts[1].corpo.acao, 'reabrir');
});

test('"fecha o mês" sem nome fecha o mês anterior; avisa das contas ainda sem marcar como paga; mês em curso e antes do início não fecham', function () {
  var s = sb({ porMes: { '2026-09': mesDados('2026-09', { obrigacoes: [{ chave: 'd:a', nome: 'Aluguel', valor: 700, pago: false, outroPaga: false }, { chave: 'd:b', nome: 'Água', valor: 150, pago: false, outroPaga: false }, { chave: 'd:c', nome: 'Luz', valor: 300, pago: false, outroPaga: true }] }) } });
  var p = J(s.Financas.conversar('fecha o mês'));
  assert.ok(/^Atenção: ainda há 2 contas sem marcar como paga em setembro: Aluguel, Água\. Fecho setembro\?/.test(p.resp), p.resp);
  s.Financas.conversar('não');
  assert.ok(/Só dá para mexer em mês que já terminou\. Outubro ainda está em curso\./.test(J(s.Financas.conversar('fecha outubro')).resp));
  assert.ok(/A caderneta só começa em setembro, então não há agosto para mexer/.test(J(s.Financas.conversar('fecha agosto')).resp));
  assert.strictEqual(s._posts.length, 0);
});

test('mês já fechado não é refeito por voz; "reabre setembro" confirma e reabre; desfaz fecha de novo; mês aberto não reabre', function () {
  var s = sb({ porMes: { '2026-09': mesDados('2026-09', { fechado: true }) }, respostaFechar: { ok: true, mudou: true, fechado: false } });
  assert.ok(/Setembro já está fechado\. Para atualizar o retrato, use o app; para reabrir, diga reabre setembro\./.test(J(s.Financas.conversar('fecha setembro')).resp));
  var p = J(s.Financas.conversar('reabre setembro'));
  assert.strictEqual(p.resp, 'Reabro setembro? O livre que passa para outubro volta a ser calculado em vez de ficar congelado. Diga sim ou não.');
  assert.strictEqual(J(s.Financas.conversar('sim')).resp, 'Reabri setembro. Para fechar de novo, diga desfaz.');
  assert.strictEqual(s._posts[0].corpo.acao, 'reabrir');
  assert.ok(/Desfeito: fechei setembro de novo\./.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].corpo.acao, 'fechar');
  var aberto = sb();
  assert.ok(/Setembro não está fechado\./.test(J(aberto.Financas.conversar('reabre setembro')).resp));
});

test('frases que não são do fechamento seguem o fluxo normal; caderneta fora do ar não fecha nada', function () {
  var s = sb();
  ['fecha a porta', 'fecha o aplicativo do banco', 'quando fecha o mês', 'quanto sobrou no mês'].forEach(function (f) { assert.strictEqual(s.Financas.conversar(f), null, f); });
  var off = sb();
  off.Financas.conversar('fecha setembro');
  off.UrlFetchApp.fetch = function () { throw new Error('rede caiu'); };
  assert.ok(/Não consegui fechar setembro agora\. Não mudei nada\./.test(J(off.Financas.conversar('sim')).resp));
  var ja = sb({ respostaFechar: { ok: true, mudou: false, fechado: true } });
  ja.Financas.conversar('fecha setembro');
  assert.ok(/Setembro já estava fechado\./.test(J(ja.Financas.conversar('sim')).resp));
});
