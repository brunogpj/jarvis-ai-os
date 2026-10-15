// mercado-fii.test.js — mercado dos FIIs (Funds Explorer) ao lado da caderneta, cotas e proventos por voz (15/10/2026). Dados e HTML INVENTADOS,
// na mesma estrutura da página real (cabeçalho com preço, caixas de indicadores e o JSON embutido do último rendimento).
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function pagina(p) {
  return '<div class="headerTicker__content__price">\n<p>R$ ' + p.cot + '</p><span class="baixa">' + p.var + '%</span>\n</div>' +
    '<div class="indicators__box"><p>Último Rendimento</p><p><small>R$</small><b> ' + p.rend + ' </b></p></div>' +
    '<div class="indicators__box"><p>Dividend Yield</p><p><b> ' + p.dy + ' <small>%</small></b></p><p>últ. 12 meses</p></div>' +
    '<div class="indicators__box"><p>Valor Patrimonial</p><p><b><small>R$</small> ' + p.vp + ' </b></p><p>por cota</p></div>' +
    '<div class="indicators__box"><p>P/VP</p><p><b> ' + p.pvp + ' </b></p></div>' +
    '<script>{"dividendos_12_meses":13.2,"pr_valor":' + p.rend.replace(',', '.') + ',"pr_cotacaobase":157.01,"pr_database":"' + p.com + 'T00:00:00","pr_datapagamento":"' + p.pag + 'T00:00:00"}</script>';
}
var PAGINAS = {
  knri11: pagina({ cot: '164,06', var: '-0,09', rend: '1,10', dy: '8,05', vp: '163,38', pvp: '1,00', com: '2026-09-30', pag: '2026-10-15' }),
  mxrf11: pagina({ cot: '9,36', var: '-0,11', rend: '0,10', dy: '12,77', vp: '9,26', pvp: '1,01', com: '2026-09-30', pag: '2026-10-15' })
};
function dados(cotas, pagamentoFuturo) {
  return {
    mes: '2026-10', hoje: '2026-10-15', livreHoje: 100, livreFim: 400, aPagar: 0, obrigacoes: [], orcamentos: [], receitas: [], reservaMeses: 4,
    metaAlocacao: { 'FIIs': 15, 'Liquidez/Reserva': 5 },
    investimentos: { total: 0, porCategoria: {}, itens: [
      { id: 'knri11', nome: 'FII Kinea (KNRI11)', instituicao: 'Itaú', categoria: 'FIIs', saldo: 829.5, rendimentoAno: 0, cotas: cotas, liquidez: 'Mercado (bolsa)', atualizado: '2026-10-13' },
      { id: 'mxrf11', nome: 'FII Maxi Renda (MXRF11)', instituicao: 'Itaú', categoria: 'FIIs', saldo: 614.25, rendimentoAno: 2, cotas: cotas ? cotas * 13 : null, liquidez: 'Mercado (bolsa)', atualizado: '2026-10-13' },
      { id: 'cofre', nome: 'Cofrinho Exemplo (Mercado Pago)', instituicao: 'Mercado Pago', categoria: 'Liquidez/Reserva', saldo: 2500, rendimentoAno: 0, taxa: '115% do CDI', liquidez: 'Diária', atualizado: '2026-10-13' } ] }
  };
}
function sb(cotas, posts) {
  var d = dados(cotas);
  var s = makeSandbox({ props: { OWNER_EMAIL: 'dono@exemplo.com', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) },
    fetch: function (url, params) {
      var m = String(url).match(/fundsexplorer\.com\.br\/funds\/(\w+)/);
      if (m) return PAGINAS[m[1]] ? { code: 200, body: PAGINAS[m[1]] } : { code: 404, body: '' };
      if (/caderneta/.test(url)) {
        if (params && params.method === 'post') {
          var corpo = JSON.parse(params.payload); (posts || []).push({ url: url, corpo: corpo });
          if (/\/jarvis\/rendimento$/.test(url)) return { code: 200, body: { ok: true, nome: corpo.id, antes: corpo.rendimento_esperado, depois: Math.round((corpo.rendimento_esperado + corpo.delta) * 100) / 100 } };
          return { code: 200, body: { ok: true, nome: corpo.id, antes: null, depois: corpo.cotas } };
        }
        return { code: 200, body: d };
      }
      return { code: 404, body: {} };
    } });
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('MercadoFii.js', s); loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('MercadoFii.parse lê cotação, P/VP, valor patrimonial, DY e o último rendimento com data-com e pagamento', function () {
  var s = sb(null), r = J(s.MercadoFii.parse(PAGINAS.knri11, 'KNRI11'));
  assert.deepStrictEqual(r, { ticker: 'KNRI11', cotacao: 164.06, variacao: -0.09, pvp: 1, vp: 163.38, dy12: 8.05, rendimento: { valor: 1.1, dataCom: '2026-09-30', pagamento: '2026-10-15' } });
  assert.strictEqual(s.MercadoFii.parse('<html>sem nada</html>', 'X').cotacao, null, 'página que mudou de formato não vira número inventado');
  assert.strictEqual(s.MercadoFii.tickerValido('knri11'), 'KNRI11'); assert.strictEqual(s.MercadoFii.tickerValido('CDB'), null);
});

test('Relatório de FIIs: mercado ao lado da caderneta, com link da fonte, e a posição em R$ quando há cotas', function () {
  var t = sb(5).Financas.relatorio({ tipo: 'relatorio', classe: 'fii' }, 'chat');
  assert.match(t, /### 🌐 Mercado dos fundos \(Funds Explorer, lido em /);
  assert.match(t, /\[KNRI11\]\(https:\/\/www\.fundsexplorer\.com\.br\/funds\/knri11\)/);
  assert.match(t, /R\$ 164,06/); assert.match(t, /30\/09 → 15\/10/);
  assert.match(t, /\*\*Sua posição\*\*/);
  assert.match(t, /\| KNRI11 \| 5 \| R\$ 820,30 \|/);   // 5 × 164,06
  assert.match(t, /sem recomendação/);
});

test('Relatório de FIIs sem cotas diz como informar, e página fora do ar não derruba o relatório', function () {
  var t = sb(null).Financas.relatorio({ tipo: 'relatorio', classe: 'fii' }, 'chat');
  assert.match(t, /Falta a quantidade de cotas de KNRI11/);
  var s = sb(5); s.UrlFetchApp.fetch = (function (f) { return function (u, p) { if (/fundsexplorer/.test(u)) throw new Error('fora'); return f(u, p); }; })(s.UrlFetchApp.fetch);
  assert.match(s.Financas.relatorio({ tipo: 'relatorio', classe: 'fii' }, 'chat'), /Não consegui ler o mercado agora/);
});

test('Relatório de cofrinhos: tabela da caderneta + pesquisa na web com fontes (ou aviso quando não houver)', function () {
  var s = sb(5);
  assert.match(s.Financas.relatorio({ tipo: 'relatorio', classe: 'liquidez' }, 'chat'), /Não consegui pesquisar a taxa vigente/);
  var s2 = sb(5); s2.Gemini = { temChave: function () { return true; }, pesquisarWeb: function () { return { texto: 'Campanha de 140% do CDI até 31/12.', fontes: ['Money Times — https://exemplo.com/a'] }; } };
  var t = s2.Financas.relatorio({ tipo: 'relatorio', classe: 'liquidez' }, 'chat');
  assert.match(t, /Cofrinho Exemplo/); assert.match(t, /115% do CDI/); assert.match(t, /> Campanha de 140% do CDI/); assert.match(t, /\[Money Times\]\(https:\/\/exemplo\.com\/a\)/);
});

test('interpretarRelatorio: "relatório de cofrinhos" é da classe liquidez', function () {
  var s = sb(5);
  assert.deepStrictEqual(J(s.Financas.interpretarRelatorio('execute a automacao relatorio de cofrinhos')), { tipo: 'relatorio', classe: 'liquidez' });
});

test('Cotas por voz: propor → sim → desfaz, com o controle otimista e vários fundos numa frase', function () {
  var posts = [], s = sb(null, posts);
  var p = s.Financas.conversar('tenho 5 cotas do KNRI11 e 65 do MXRF11');
  assert.match(p.resp, /Confirma guardar as cotas: KNRI11, 5; MXRF11, 65\? Diga sim ou não\./);
  assert.strictEqual(posts.length, 0, 'nada grava antes do sim');
  var ok = s.Financas.conversar('sim');
  assert.match(ok.resp, /Guardei as cotas de KNRI11, MXRF11/);
  assert.deepStrictEqual(posts.map(function (x) { return [x.corpo.id, x.corpo.cotas, x.corpo.cotas_esperadas]; }), [['knri11', 5, null], ['mxrf11', 65, null]]);
  var d = s.Financas.conversar('desfaz');
  assert.match(d.resp, /Desfeito: devolvi as cotas de 2 fundos/);
  assert.deepStrictEqual(posts.slice(2).map(function (x) { return [x.corpo.id, x.corpo.cotas, x.corpo.cotas_esperadas]; }), [['knri11', 0, 5], ['mxrf11', 0, 65]]);
});

test('Cotas por voz não pega pergunta nem ticker que não é da caderneta', function () {
  var s = sb(null);
  assert.strictEqual(s.Financas.conversar('quantas cotas do KNRI11 eu tenho'), null);
  assert.strictEqual(s.Financas.conversar('tenho 10 cotas do ABCD11'), null);
});

test('Proventos por voz: soma cotas × valor só do que já pagou, não lança duas vezes e o desfaz subtrai', function () {
  var posts = [], s = sb(5, posts);
  var p = s.Financas.conversar('lança os proventos dos fundos');
  assert.match(p.resp, /KNRI11, 5 cotas a R\$ 1,10, R\$ 5,50; MXRF11, 65 cotas a R\$ 0,10, R\$ 6,50\. Total R\$ 12,00/);
  assert.match(p.resp, /Não mexe no saldo nem no livre/);
  assert.strictEqual(posts.length, 0);
  var ok = s.Financas.conversar('sim');
  assert.match(ok.resp, /Lancei R\$ 12,00 de proventos \(KNRI11, MXRF11\)/);
  assert.deepStrictEqual(posts.map(function (x) { return [x.corpo.id, x.corpo.delta, x.corpo.rendimento_esperado]; }), [['knri11', 5.5, 0], ['mxrf11', 6.5, 2]]);
  assert.match(s.Financas.conversar('lança os proventos dos fundos').resp, /já estão lançados/);
  assert.match(s.Financas.conversar('desfaz').resp, /Desfeito: tirei os proventos lançados de 2 fundos/);
  assert.deepStrictEqual(posts.slice(2).map(function (x) { return x.corpo.delta; }), [-5.5, -6.5]);
  assert.match(s.Financas.conversar('lança os proventos dos fundos').resp, /KNRI11, 5 cotas/, 'depois do desfaz pode lançar de novo');
});

test('Proventos sem cotas pede a quantidade; "rendimento do cofrinho" não é desta ação', function () {
  var s = sb(null);
  assert.match(s.Financas.conversar('lança os proventos dos fundos').resp, /Antes de lançar eu preciso da quantidade de cotas\. Faltam as cotas de KNRI11, MXRF11/);
  assert.strictEqual(s.Financas.conversar('recebi o rendimento do cofrinho'), null);
});
