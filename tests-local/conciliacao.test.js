// conciliacao.test.js — "reajuste a caderneta com os gastos deste print" (19/10/2026). O modelo só LÊ a imagem; o código compara, propõe e só o "sim" registra. Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var HOJE = '2026-10-19';
var PRINT = { transacoes: [
  { data: '2026-10-18', estabelecimento: 'POSTO EXEMPLO', valor: 150, meio: 'credito', tipo: 'saida' },
  { data: '2026-10-17', estabelecimento: 'Supermercado', valor: 132.6, meio: 'credito', tipo: 'saida' },
  { data: '2026-10-16', estabelecimento: 'ATACADAO 672', valor: 145.27, meio: 'credito', tipo: 'saida' },
  { data: '2026-10-15', estabelecimento: 'Padaria', valor: 32.99, meio: 'saldo', tipo: 'saida' },
  { data: '2026-10-14', estabelecimento: 'Pix recebido', valor: 500, meio: 'pix', tipo: 'entrada' },
  { data: '2025-01-01', estabelecimento: 'Antigo', valor: 10, meio: 'credito', tipo: 'saida' },
  { data: '2026-10-16', estabelecimento: 'Sem meio', valor: 10, meio: 'outro', tipo: 'saida' }
] };
var DESPESAS = [
  { id: 'mp_a', data: '2026-10-17', descricao: 'Supermercado', valor: 132.6, meio: 'Cartão de crédito', categoria: 'Mercado' },
  { id: 'mp_b', data: '2026-10-15', descricao: 'Padaria', valor: 32.99, meio: 'Pix / débito', categoria: 'Alimentação' },
  { id: 'xx', data: '2026-10-10', descricao: 'Outra coisa', valor: 150, meio: 'Dinheiro', categoria: 'Outros' }
];
function sb(opts) {
  opts = opts || {};
  var posts = [];
  var s = makeSandbox({ props: { OWNER_EMAIL: 'dono@exemplo.com', GEMINI_MODEL: 'gemini-3.8-flash', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) },
    fetch: function (url, params) {
      if (/\/lancamentos/.test(url)) return opts.semCaderneta ? { code: 500, body: {} } : { code: 200, body: { despesas: opts.despesas || DESPESAS } };
      if (params && params.method === 'post') { posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(params.payload) }); return /desfazer/.test(url) ? { code: 200, body: { removido: 1 } } : { code: 200, body: { criado: true } }; }
      return { code: 404, body: {} };
    } });
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s); loadGasFile('Conciliacao.js', s);
  s.Gemini = { gerarComModelo: function (payload) { s._payload = payload; if (opts.erroGemini) throw new Error('HTTP 429'); return { model: 'm', tier: 'billing', data: { candidates: [{ content: { parts: [{ text: JSON.stringify(opts.print || PRINT) }] } }] } }; } };
  s._posts = posts;
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var IMG = [{ tipo: 'inline', mimeType: 'image/png', data: 'AAAA', nome: 'print.png' }];

test('ehPedido: ajustar/conferir a caderneta com gastos pega; descrever a imagem ou conversa solta não', function () {
  var s = sb();
  ['Verifiquei que alguns valores gastos no mercado pago não foram inseridos, ajustados na caderneta. Veja quais e corrija.', 'reajuste a caderneta com esses gastos', 'lança esses gastos na caderneta', 'faltam gastos do mercado pago na caderneta', 'concilie o extrato']
    .forEach(function (m) { assert.strictEqual(s.Conciliacao.ehPedido(m), true, m); });
  ['o que tem nessa imagem?', 'transcreva o texto do print', '', 'bom dia', 'quanto gastei ontem'].forEach(function (m) { assert.strictEqual(s.Conciliacao.ehPedido(m), false, m); });
});

test('validar: só saídas legíveis, dentro de 45 dias, com meio conhecido; chaves únicas mesmo para compras iguais', function () {
  var s = sb(), v = J(s.Conciliacao.validar(PRINT, HOJE));
  assert.deepStrictEqual(v.itens.map(function (i) { return [i.data, i.valor, i.meio, i.descricao]; }), [
    ['2026-10-18', 150, 'Cartão de crédito', 'POSTO EXEMPLO'], ['2026-10-17', 132.6, 'Cartão de crédito', 'Supermercado'], ['2026-10-16', 145.27, 'Cartão de crédito', 'ATACADAO 672'], ['2026-10-15', 32.99, 'Pix / débito', 'Padaria']]);
  assert.strictEqual(v.entradas, 1); assert.strictEqual(v.descartadas.length, 2);
  var dup = J(s.Conciliacao.validar({ transacoes: [{ data: '2026-10-18', estabelecimento: 'Cafe', valor: 8, meio: 'credito', tipo: 'saida' }, { data: '2026-10-18', estabelecimento: 'Cafe', valor: 8, meio: 'credito', tipo: 'saida' }] }, HOJE));
  assert.strictEqual(dup.itens.length, 2); assert.notStrictEqual(dup.itens[0].chave, dup.itens[1].chave);
  assert.ok(dup.itens.every(function (i) { return /^[A-Za-z0-9_-]{6,48}$/.test(i.chave); }), 'chave aceita pelo Worker');
  assert.strictEqual(J(s.Conciliacao.validar({ transacoes: [{ data: '2026-10-18', estabelecimento: 'X', valor: -5, meio: 'credito', tipo: 'saida' }, { data: '2026-10-18', estabelecimento: 'Y', valor: 99999, meio: 'credito', tipo: 'saida' }, { data: '18/10', estabelecimento: 'Z', valor: 5, meio: 'credito', tipo: 'saida' }] }, HOJE)).itens.length, 0);
  assert.strictEqual(J(s.Conciliacao.validar(null, HOJE)).itens.length, 0);
});

test('casar: mesmo valor com até 1 dia de diferença; cada despesa casa uma vez', function () {
  var s = sb(), it = function (d, v) { return { chave: 'c' + d + v, data: d, valor: v, meio: 'Cartão de crédito', descricao: 'x' }; };
  var r = J(s.Conciliacao.casar([it('2026-10-17', 132.6), it('2026-10-18', 150), it('2026-10-17', 132.6)], DESPESAS));
  assert.deepStrictEqual([r.jaTem.length, r.faltando.length], [1, 2], 'a de 150 está a 8 dias; a segunda de 132,60 não tem par');
  assert.strictEqual(J(s.Conciliacao.casar([it('2026-10-18', 132.6)], DESPESAS)).jaTem.length, 1, 'um dia de diferença casa');
});

test('analisar: lê o print, compara com a caderneta e diz o que falta (sem gravar nada); o modelo recebe esquema JSON e a imagem', function () {
  var s = sb(), r = J(s.Conciliacao.analisar(IMG, HOJE));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.faltando.map(function (i) { return i.descricao; }), ['POSTO EXEMPLO', 'ATACADAO 672']);
  assert.match(r.texto, /Li \*\*4\*\* saídas no print: \*\*2\*\* já estão na caderneta e \*\*2\*\* faltam/);
  assert.match(r.texto, /\| 18\/10 \| POSTO EXEMPLO \| R\$ 150,00 \| Crédito \| ➕ falta \|/); assert.match(r.texto, /\| 17\/10 \| Supermercado \| R\$ 132,60 \| Crédito \| ✅ já na caderneta \|/);
  assert.match(r.texto, /no total de \*\*R\$ 295,27\*\*/);
  assert.strictEqual(s._posts.length, 0, 'analisar não grava');
  assert.strictEqual(s._payload.generationConfig.responseMimeType, 'application/json'); assert.ok(s._payload.generationConfig.responseJsonSchema);
  assert.deepStrictEqual(J(s._payload.contents[0].parts[1]), { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
  assert.match(s._payload.contents[0].parts[0].text, /ignorar/);
});

test('executar → "sim" → "desfaz": propõe, só o sim registra (origem mp, uma vez cada) e o desfaz tira o conjunto', function () {
  var s = sb(), txt = s.Conciliacao.executar('Veja quais gastos do mercado pago não foram inseridos na caderneta e corrija', IMG, { hoje: HOJE });
  assert.match(txt, /Registro as \*\*2\*\* que faltam/);
  assert.strictEqual(s._posts.length, 0, 'nada grava antes do sim');
  var sim = s.Financas.conversar('sim');
  assert.match(sim.resp, /Registrei 2 gastos \(R\$ 295,27\): Posto Exemplo R\$ 150,00; Atacadao 672 R\$ 145,27\. Diga desfaz/);
  assert.deepStrictEqual(s._posts.map(function (p) { return [p.url, p.corpo.origem, p.corpo.valor, p.corpo.meio, p.corpo.data]; }), [['/gasto', 'mp', 150, 'Cartão de crédito', '2026-10-18'], ['/gasto', 'mp', 145.27, 'Cartão de crédito', '2026-10-16']]);
  var ds = s.Financas.conversar('desfaz');
  assert.match(ds.resp, /Desfeito: tirei 2 gastos da conciliação/);
  assert.deepStrictEqual(s._posts.slice(2).map(function (p) { return [p.url, p.corpo.origem]; }), [['/gasto/desfazer', 'mp'], ['/gasto/desfazer', 'mp']]);
  var nao = sb(); nao.Conciliacao.executar('ajuste a caderneta com esses gastos', IMG, { hoje: HOJE });
  assert.match(nao.Financas.conversar('não').resp, /não registrei nada/); assert.strictEqual(nao._posts.length, 0);
});

test('executar: sem pedido, sem imagem ou sem caderneta devolve null/aviso; falha do modelo ou da caderneta não grava nada', function () {
  var s = sb();
  assert.strictEqual(s.Conciliacao.executar('o que tem nessa imagem?', IMG, { hoje: HOJE }), null);
  assert.strictEqual(s.Conciliacao.executar('ajuste a caderneta com esses gastos', []), null);
  assert.strictEqual(s.Conciliacao.executar('ajuste a caderneta com esses gastos', [{ tipo: 'texto', texto: 'x' }]), null);
  assert.match(sb({ erroGemini: true }).Conciliacao.executar('ajuste a caderneta com esses gastos', IMG, { hoje: HOJE }), /Não consegui ler o print/);
  var semCad = sb({ semCaderneta: true }); assert.match(semCad.Conciliacao.executar('ajuste a caderneta com esses gastos', IMG, { hoje: HOJE }), /não consegui consultar a caderneta/); assert.strictEqual(semCad._posts.length, 0);
  var tudo = sb({ despesas: DESPESAS.concat([{ id: 'p', data: '2026-10-18', descricao: 'Posto', valor: 150 }, { id: 'q', data: '2026-10-16', descricao: 'Atacadão', valor: 145.27 }]) });
  assert.match(tudo.Conciliacao.executar('ajuste a caderneta com esses gastos', IMG, { hoje: HOJE }), /Tudo o que está no print já está na caderneta/);
  assert.strictEqual(tudo.Financas.conversar('sim'), null, 'sem proposta aberta o sim não faz nada');
});

test('Chat: "veja os ajustes na caderneta" vira a pergunta do mês (resposta da caderneta, não do modelo)', function () {
  var s = sb();
  assert.deepStrictEqual(J(s.Financas.interpretar('Veja os ajustes na caderneta.')), { tipo: 'mes' });
  assert.deepStrictEqual(J(s.Financas.interpretar('confira os lançamentos da caderneta')), { tipo: 'mes' });
});

test('_finSemFonte: troca a resposta do modelo que inventa números da caderneta, e deixa passar o que não é isso', function () {
  var s = sb(); loadGasFile('Code.js', s);
  var inventada = 'Novo Panorama de Outubro: **Renda:** R$ 4.440,00; **Saídas:** ~R$ 3.067,85; sobra ~R$ 1.372,15; previsão livre ~-R$ 233,18.';
  assert.match(s._finSemFonte('Veja os ajustes na caderneta', inventada), /Não vou responder isso de cabeça/);
  assert.strictEqual(s._finSemFonte('qual a capital da França', inventada), inventada, 'pergunta que não é da caderneta');
  assert.strictEqual(s._finSemFonte('gastos da caderneta', 'Você gastou R$ 10,00.'), 'Você gastou R$ 10,00.', 'um valor só não dispara');
  assert.strictEqual(s._finSemFonte('o que é uma caderneta', 'É um caderno, custa R$ 5 ou R$ 9.'), 'É um caderno, custa R$ 5 ou R$ 9.', 'sem as palavras da caderneta financeira na resposta');
});
