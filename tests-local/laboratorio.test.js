// laboratorio.test.js — aba Laboratório (playground do Gemini) e galeria de Automações (16/10/2026). Dados INVENTADOS; nenhuma chamada de rede de verdade.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(extra) {
  extra = extra || {};
  var s = makeSandbox({ props: Object.assign({ OWNER_EMAIL: 'dono@exemplo.com', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_MODEL_FALLBACK: 'gemini-2.5-flash', GEMINI_SEARCH_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'k' }, extra.props || {}) });
  ['GastoIA.js', 'Laboratorio.js', 'Code.js'].forEach(function (f) { loadGasFile(f, s); });
  s.getSessionUser = function (t) { return t === 'tok-dono' ? { email: 'dono@exemplo.com' } : (t === 'tok-outro' ? { email: 'outro@exemplo.com' } : null); };
  var docs = (extra.docs || []).slice(), salvos = [], apagados = [];
  s.Firestore = { listDocs: function () { return docs; }, setDoc: function (c, id, d) { salvos.push({ c: c, id: id, d: d }); docs = docs.filter(function (x) { return x.id !== id; }); docs.push({ id: id, dados: d }); return true; }, deleteDoc: function (c, id) { apagados.push(id); return true; }, getDoc: function () { return null; } };
  s._salvos = salvos; s._apagados = apagados;
  s.Gemini = { gerarComModelo: extra.gerar || function (payload, modelo) { return { model: modelo, tier: 'billing', data: { candidates: [{ content: { parts: [{ text: 'Olá' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } }; } };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var PERM = ['gemini-3.8-flash', 'gemini-2.5-flash'];

test('Modelos permitidos: só os configurados + extras, sem embedding, voz, imagem nem lixo', function () {
  var s = sb({ props: { LAB_MODELOS_EXTRA: 'gemini-3.8-flash-lite, gemini-embedding-001, gemini-3.8-flash-lite-tts, ; drop table' } });
  assert.deepStrictEqual(J(s.Laboratorio.modelosPermitidos()), ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash-lite']);
});

test('montar: monta o corpo com sistema, temperatura, ferramentas e raciocínio; recusa modelo fora da lista, pedido vazio e valores absurdos', function () {
  var s = sb();
  var m = J(s.Laboratorio.montar({ modelo: 'gemini-3.8-flash', prompt: ' oi ', sistema: 'seja breve', temperatura: 0.4, maxTokens: 99999, pensamento: 'alto', ferramentas: { busca: true, codigo: true } }, PERM));
  assert.strictEqual(m.ok, true);
  assert.deepStrictEqual(m.payload.contents, [{ role: 'user', parts: [{ text: 'oi' }] }]);
  assert.deepStrictEqual([m.payload.generationConfig.temperature, m.payload.generationConfig.maxOutputTokens, m.payload._thinking], [0.4, 4096, 'high']);
  assert.deepStrictEqual(m.payload.tools, [{ google_search: {} }, { code_execution: {} }]);
  assert.strictEqual(m.payload.systemInstruction.parts[0].text, 'seja breve');
  assert.match(s.Laboratorio.montar({ modelo: 'gemini-9-pro', prompt: 'x' }, PERM).erro, /Modelo não permitido/);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: '  ' }, PERM).erro, /Escreva um pedido/);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', temperatura: 3 }, PERM).erro, /Temperatura/);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x'.repeat(8001) }, PERM).erro, /passa de 8000/);
});

test('montar: JSON com esquema válido; esquema ruim e JSON junto de ferramentas são recusados', function () {
  var s = sb();
  var ok = J(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', json: true, schema: '{"type":"object","properties":{"a":{"type":"string"}}}' }, PERM));
  assert.deepStrictEqual([ok.ok, ok.payload.generationConfig.responseMimeType, ok.payload.generationConfig.responseJsonSchema.type], [true, 'application/json', 'object']);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', json: true, schema: '[1,2]' }, PERM).erro, /esquema JSON/);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', json: true, schema: '{quebrado' }, PERM).erro, /esquema JSON/);
  assert.match(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', json: true, ferramentas: { url: true } }, PERM).erro, /não combina com ferramentas/);
  assert.strictEqual(J(s.Laboratorio.montar({ modelo: PERM[0], prompt: 'x', json: true }, PERM)).ok, true, 'JSON sem esquema é permitido');
});

test('interpretar: texto, código e resultado, fontes, buscas, URLs, tokens e validade do JSON; pensamento fica de fora', function () {
  var s = sb();
  var data = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'pensando…' }, { text: 'Resposta' }, { executableCode: { language: 'PYTHON', code: 'print(1)' } }, { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '1' } }] },
    groundingMetadata: { webSearchQueries: ['q1'], groundingChunks: [{ web: { uri: 'https://a.com/x', title: 'A' } }, { web: {} }] }, urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://b.com', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, thoughtsTokenCount: 30 } };
  var r = J(s.Laboratorio.interpretar(data, { modelo: 'm', tier: 'billing', ms: 1234, custoBRL: 0.01 }));
  assert.deepStrictEqual(r.partes.map(function (p) { return p.t; }), ['texto', 'codigo', 'resultado']);
  assert.deepStrictEqual([r.texto, r.fontes, r.buscas, r.urls, r.uso], ['Resposta', [{ titulo: 'A', url: 'https://a.com/x' }], ['q1'], [{ url: 'https://b.com', status: 'success' }], { entrada: 20, saida: 8, pensamento: 30 }]);
  assert.strictEqual(J(s.Laboratorio.interpretar({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }, { json: true })).jsonValido, true);
  assert.strictEqual(J(s.Laboratorio.interpretar({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] }, { json: true })).jsonValido, false);
  assert.match(J(s.Laboratorio.interpretar({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })).erro, /filtro de segurança/);
});

test('executar: chama o modelo escolhido, calcula custo, e recusa com o gasto perto do teto ou acima do limite por hora', function () {
  var chamadas = [], s = sb({ gerar: function (p, m) { chamadas.push(m); return { model: m, tier: 'billing', data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } } }; } });
  var r = J(s.Laboratorio.executar({ modelo: 'gemini-2.5-flash', prompt: 'oi' }));
  assert.deepStrictEqual([r.ok, r.texto, r.modelo, chamadas], [true, 'ok', 'gemini-2.5-flash', ['gemini-2.5-flash']]);
  assert.ok(r.custoBRL >= 0 && r.custoBRL < 1);
  assert.strictEqual(J(s.Laboratorio.executar({ modelo: 'gemini-pro-x', prompt: 'oi' })).ok, false);
  assert.strictEqual(chamadas.length, 1, 'modelo recusado nem chama a API');
  var cheio = sb();
  cheio.PropertiesService.getScriptProperties().setProperty('GEMINI_GASTO', JSON.stringify({ mes: cheio.GastoIA.estado().mes, usd: 5, n: 1, buscas: 0, porModelo: {}, avisos: {} }));
  cheio.Gemini.gerarComModelo = function () { throw new Error('não deveria chamar'); };
  assert.match(cheio.Laboratorio.executar({ modelo: 'gemini-3.8-flash', prompt: 'oi' }).erro, /teto|%/);
  var erro = sb({ gerar: function () { throw new Error('HTTP 400: modelo sem suporte'); } });
  assert.match(erro.Laboratorio.executar({ modelo: 'gemini-3.8-flash', prompt: 'oi' }).erro, /HTTP 400/);
});

test('Funções do web app: só o dono usa o Laboratório e a galeria', function () {
  var s = sb();
  assert.strictEqual(s.laboratorioConfig('tok-dono').ok, true); assert.strictEqual(s.laboratorioConfig('tok-outro').ok, false);
  assert.strictEqual(s.laboratorioExecutar('tok-outro', { modelo: 'gemini-3.8-flash', prompt: 'oi' }).ok, false);
  assert.strictEqual(s.laboratorioExecutar('tok-dono', { modelo: 'gemini-3.8-flash', prompt: 'oi' }).ok, true);
  assert.strictEqual(s.automacoesListar('x').ok, false); assert.strictEqual(s.automacaoSalvar('tok-outro', { nome: 'a', texto: 'b' }).ok, false); assert.strictEqual(s.automacaoExcluir('tok-outro', 'abc').ok, false);
});

test('Galeria: prontas + minhas; salva, edita, duplica e exclui só as do dono, com limites e validação', function () {
  var s = sb(), l = s.automacoesListar('tok-dono');
  assert.ok(l.base.length >= 6 && l.base.every(function (a) { return /^base-/.test(a.id) && a.tipo === 'chat'; }));
  assert.ok(l.base.some(function (a) { return a.semIA && /Relatório de FIIs/.test(a.texto); }));
  var novo = s.automacaoSalvar('tok-dono', { nome: 'Resumo do meu dia', icone: '🌅', desc: 'bom dia', texto: 'Faça um resumo do meu dia', tipo: 'chat' });
  assert.strictEqual(novo.ok, true); assert.match(novo.automacao.id, /^resumo-do-meu-dia-[a-z0-9]+$/);
  assert.strictEqual(s._salvos[0].c, 'automacoes');
  var lab = s.automacaoSalvar('tok-dono', { nome: 'Teste JSON', tipo: 'lab', texto: 'Extraia', config: { modelo: 'gemini-3.8-flash', json: true, schema: '{"type":"object"}', temperatura: 0.2 } });
  assert.strictEqual(lab.ok, true); assert.strictEqual(lab.automacao.config.json, true);
  assert.match(s.automacaoSalvar('tok-dono', { nome: 'Lab ruim', tipo: 'lab', texto: 'x', config: { modelo: 'gemini-9-pro' } }).erro, /Modelo não permitido/);
  assert.match(s.automacaoSalvar('tok-dono', { nome: '', texto: 'x' }).erro, /nome/);
  assert.match(s.automacaoSalvar('tok-dono', { nome: 'x', texto: '' }).erro, /Jarvis deve fazer/);
  assert.match(s.automacaoSalvar('tok-dono', { id: 'base-fiis', nome: 'x', texto: 'y' }).erro, /inválida/);
  assert.match(s.automacaoSalvar('tok-dono', { id: 'nao-existe-123', nome: 'x', texto: 'y' }).erro, /não encontrada/);
  var ed = s.automacaoSalvar('tok-dono', { id: novo.automacao.id, nome: 'Resumo v2', texto: 'Novo texto' });
  assert.deepStrictEqual([ed.ok, ed.automacao.nome], [true, 'Resumo v2']);
  assert.strictEqual(s.automacaoExcluir('tok-dono', 'base-fiis').ok, false);
  assert.strictEqual(s.automacaoExcluir('tok-dono', novo.automacao.id).ok, true); assert.deepStrictEqual(s._apagados, [novo.automacao.id]);
  var cheio = sb({ docs: Array.apply(null, Array(40)).map(function (_, i) { return { id: 'a-' + i + 'xx', dados: { nome: 'n' + i, texto: 't' } }; }) });
  assert.match(cheio.automacaoSalvar('tok-dono', { nome: 'mais uma', texto: 'x' }).erro, /Limite de 40/);
});

test('Interface: abas, funções do servidor, escape do texto e CSS das classes novas', function () {
  var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8'), CSS = fs.readFileSync(path.join(__dirname, '..', 'Stylesheet.html'), 'utf8'), HTML = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  ['automacoesNav', 'laboratorioNav', 'automacoesView', 'laboratorioView', 'labRodar', 'labSaida', 'autGrid', 'autEditor'].forEach(function (id) { assert.ok(HTML.indexOf('id="' + id + '"') !== -1, 'Index tem ' + id); });
  ['laboratorioConfig', 'laboratorioExecutar', 'automacoesListar', 'automacaoSalvar', 'automacaoExcluir'].forEach(function (f) { assert.ok(JS.indexOf('.' + f + '(authToken') !== -1, 'JS chama ' + f); });
  assert.match(JS, /v === "automacoes" \|\| v === "laboratorio"/);
  var b = JS.slice(JS.indexOf('/*LAB_INI*/'), JS.indexOf('/*LAB_FIM*/'));
  assert.doesNotMatch(b, /innerHTML[^;]*\+\s*(r|a|c|p|f)\.(erro|nome|texto|desc|modelo|v|titulo|url)\b(?![^;]*(escapeHtml|labTextoHtml))/, 'nada do servidor entra no HTML sem escape');
  ['lab-layout', 'lab-saida', 'lab-code', 'aut-card', 'aut-cards', 'aut-editor', 'lab-dupla'].forEach(function (c) { assert.ok(CSS.indexOf('.' + c) !== -1, 'CSS de ' + c); });
});
