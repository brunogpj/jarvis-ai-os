// file-search.test.js — File Search (conteúdo dos PDFs) e o aviso de teto de gasto do Google (19-20/10/2026). Nenhuma chamada de rede de verdade; arquivos e respostas INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var CAP = 'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.';
var PAGO = 'chave-paga-0000', GRATIS = 'chave-gratis-111';

function resposta(code, json, headers) { return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(json || {}); }, getAllHeaders: function () { return headers || {}; } }; }

function fakeArquivo(o) {
  return { getId: function () { return o.id; }, getName: function () { return o.nome; }, getMimeType: function () { return o.mime || 'application/pdf'; }, getSize: function () { return o.tam || 1000; }, getLastUpdated: function () { return new Date(o.mod || 1000); },
    getParents: function () { return { hasNext: function () { return false; } }; }, getBlob: function () { return { getBytes: function () { return [1, 2, 3]; } }; }, getAs: function () { return { getBytes: function () { return [4, 5, 6]; } }; } };
}

function sb(opts) {
  opts = opts || {};
  var chamadas = [];
  var props = Object.assign({ OWNER_EMAIL: 'dono@exemplo.com', GEMINI_API_KEY: PAGO, GEMINI_API_KEY_FALLBACK: GRATIS, GEMINI_ORDER: 'billing_first', GEMINI_MODEL: 'gemini-3.8-flash', FILE_SEARCH_ATIVA: 'sim' }, opts.props || {});
  var s = makeSandbox({ props: props, fetch: function (url, params) {
    var u = String(url); chamadas.push({ url: u, metodo: (params && params.method) || 'get', corpo: params && params.payload, headers: params && params.headers });
    if (opts.rota) { var r = opts.rota(u, params, chamadas); if (r) return r; }
    return { code: 404, body: {} };
  } });
  // o shim embrulha {code, body}; para controlar cabeçalhos devolvemos o objeto completo
  var base = s.UrlFetchApp.fetch; s.UrlFetchApp = { fetch: function (url, params) { var r = base(url, params); return typeof r.getAllHeaders === 'function' ? r : Object.assign({ getAllHeaders: function () { return {}; } }, r); } };
  s.Utilities.newBlob = function (b) { return { getBytes: function () { return b; } }; };
  s.Utilities.sleep = function () {};
  var arquivos = (opts.arquivos || []).map(fakeArquivo), memoria = {};
  s.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  s.DriveUploads = { pareceCredencial: function (n) { return /senha|token/i.test(n); }, _subpasta: function () { return { createFile: function (nome, json) { memoria.idx = json; return { getId: function () { return 'idx1'; } }; } }; } };
  s.DriveApp = {
    searchFiles: function () { var i = 0; return { hasNext: function () { return i < arquivos.length; }, next: function () { return arquivos[i++]; }, getContinuationToken: function () { return 'tok'; } }; },
    continueFileIterator: function () { return s.DriveApp.searchFiles(); },
    getFileById: function (id) { if (id === 'idx1') return { getBlob: function () { return { getDataAsString: function () { return memoria.idx || '[]'; } }; }, setContent: function (j) { memoria.idx = j; } }; return { getBlob: function () { return { getBytes: function () { return [1]; } }; } }; },
    getFolderById: function () { throw new Error('sem pasta'); }
  };
  loadGasFile('GastoIA.js', s); loadGasFile('Gemini.js', s); loadGasFile('FileSearchDrive.js', s);
  s._chamadas = chamadas; s._mem = memoria;
  s._prop = function (k, v) { s.PropertiesService.getScriptProperties().setProperty(k, v); };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('nome do documento no store carrega o id do Drive e a citação volta com o link do arquivo vivo', function () {
  var s = sb(), n = s.FileSearchDrive._displayName('Contrato de aluguel.pdf', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.strictEqual(n, 'Contrato de aluguel.pdf · 1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.strictEqual(s.FileSearchDrive._idDoTitulo(n), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'); assert.strictEqual(s.FileSearchDrive._nomeDoTitulo(n), 'Contrato de aluguel.pdf');
  assert.strictEqual(s.FileSearchDrive._idDoTitulo('sem id'), null);
  var r = J(s.FileSearchDrive.interpretar({ candidates: [{ content: { parts: [{ text: 'O reajuste é anual pelo IGP-M.' }] }, groundingMetadata: { groundingChunks: [
    { retrievedContext: { title: n, text: 'Cláusula 7: reajuste anual pelo IGP-M.' } }, { retrievedContext: { title: n, text: 'outro trecho do mesmo arquivo' } }, { retrievedContext: { title: 'Outro.pdf · 1ZzZzZzZzZzZzZzZzZzZzZzZzZzZz99999', text: 'x' } }] } }] }));
  assert.strictEqual(r.texto, 'O reajuste é anual pelo IGP-M.');
  assert.deepStrictEqual(r.fontes.map(function (f) { return [f.nome, f.link]; }), [['Contrato de aluguel.pdf', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view'], ['Outro.pdf', 'https://drive.google.com/file/d/1ZzZzZzZzZzZzZzZzZzZzZzZzZzZz99999/view']], 'dois chunks do mesmo arquivo viram uma fonte');
});

test('simular: conta o que entraria sem enviar nada; credencial, FS_EXCLUIR e PDF grande ficam de fora', function () {
  var s = sb({ props: { FS_EXCLUIR: 'rascunho', FS_MAX_MB: '5' }, arquivos: [
    { id: 'a'.repeat(20), nome: 'Contrato aluguel.pdf', tam: 2e6 }, { id: 'b'.repeat(20), nome: 'senhas do wifi.pdf' }, { id: 'c'.repeat(20), nome: 'rascunho de proposta.pdf' },
    { id: 'd'.repeat(20), nome: 'Livro enorme.pdf', tam: 9e6 }, { id: 'e'.repeat(20), nome: 'Ata.docx', mime: 'application/vnd.google-apps.document', tam: 0 }, { id: 'f'.repeat(20), nome: 'foto.png', mime: 'image/png' }] });
  var r = J(s.FileSearchDrive.indexar({ simular: true }));
  assert.deepStrictEqual([r.status, r.candidatos, r.excluidos, r.grandesDemais, r.porTipo.pdf, r.porTipo.documento], ['simulado', 2, 2, 1, 1, 1]);
  assert.strictEqual(s._chamadas.length, 0, 'simular não faz nenhuma chamada de rede');
});

function rotaStore(estado) {
  return function (u, params) {
    if (/\/v1beta\/fileSearchStores\?/.test(u) && params.method === 'post') return { code: 200, body: { name: 'fileSearchStores/s1' } };
    if (/uploadToFileSearchStore/.test(u)) return resposta(200, {}, { 'X-Goog-Upload-URL': 'https://up.exemplo.dev/sessao1' });
    if (/up\.exemplo\.dev/.test(u)) { var n = (estado.n = (estado.n || 0) + 1); return { code: 200, body: { name: 'fileSearchStores/s1/upload/operations/op' + n, response: { documentName: 'fileSearchStores/s1/documents/doc' + n } } }; }
    if (/\/documents\/doc\d+\?/.test(u) && params.method === 'get') return { code: 200, body: { state: estado.estado || 'STATE_PENDING' } };
    if (/\/documents\/doc\d+\?/.test(u) && params.method === 'delete') { (estado.apagados = estado.apagados || []).push(u.match(/doc\d+/)[0]); return { code: 200, body: {} }; }
    return null;
  };
}

test('indexar: cria o store, envia (resumível, bytes como blob), marca "indexando" e o tick seguinte confirma "pronto"', function () {
  var estado = {}, s = sb({ rota: rotaStore(estado), arquivos: [{ id: 'a'.repeat(20), nome: 'Contrato.pdf', mod: 5000 }, { id: 'b'.repeat(20), nome: 'Ata.docx', mime: 'application/vnd.google-apps.document', mod: 6000 }] });
  var r = J(s.FileSearchDrive.indexar({}));
  assert.deepStrictEqual([r.status, r.enviados, r.erros], ['success', 2, 0]);
  var st = s.FileSearchDrive.status();
  assert.deepStrictEqual([st.total, st.indexando, st.prontos, st.store], [2, 2, 0, 'fileSearchStores/s1']);
  var inicio = s._chamadas.filter(function (c) { return /uploadToFileSearchStore/.test(c.url); })[0];
  assert.strictEqual(inicio.headers['X-Goog-Upload-Protocol'], 'resumable'); assert.match(inicio.corpo, /"displayName":"Contrato\.pdf · a{20}"/); assert.match(inicio.corpo, /"drive_id"/);
  assert.ok(s._chamadas.every(function (c) { return /key=chave-paga-0000/.test(c.url) || /up\.exemplo\.dev/.test(c.url); }), 'só a chave paga');
  assert.ok(s._chamadas.every(function (c) { return c.url.indexOf(GRATIS) === -1; }), 'nunca a gratuita');
  estado.estado = 'STATE_ACTIVE';
  var r2 = J(s.FileSearchDrive.indexar({}));
  assert.strictEqual(r2.conferidos, 2); assert.deepStrictEqual([s.FileSearchDrive.status().prontos, s.FileSearchDrive.status().indexando], [2, 0]);
});

test('indexar: arquivo alterado troca o documento no store (apaga o antigo) e documento que o Google recusa vira erro', function () {
  var estado = {}, arqs = [{ id: 'a'.repeat(20), nome: 'Contrato.pdf', mod: 5000 }];
  var s = sb({ rota: rotaStore(estado), arquivos: arqs });
  s.FileSearchDrive.indexar({}); estado.estado = 'STATE_ACTIVE'; s.FileSearchDrive.indexar({});
  assert.strictEqual(s.FileSearchDrive.status().prontos, 1);
  // o arquivo muda no Drive (mod maior) e a varredura completa o encontra de novo
  var s2 = sb({ rota: rotaStore(estado), arquivos: [{ id: 'a'.repeat(20), nome: 'Contrato.pdf', mod: 9000 }] });
  s2._mem.idx = s._mem.idx; s2._prop('FS_INDICE_FILE_ID', 'idx1'); s2._prop('FS_STORE', 'fileSearchStores/s1');
  var r = J(s2.FileSearchDrive.indexar({ forcarCompleta: true }));
  assert.strictEqual(r.atualizados, 1); assert.deepStrictEqual(estado.apagados, ['doc1'], 'o documento antigo saiu do store');
  var falha = {}, s3 = sb({ rota: rotaStore(falha), arquivos: [{ id: 'z'.repeat(20), nome: 'Ruim.pdf', mod: 1 }] });
  s3.FileSearchDrive.indexar({}); falha.estado = 'STATE_FAILED'; s3.FileSearchDrive.indexar({});
  var st = J(s3.FileSearchDrive.status()); assert.strictEqual(st.comErro, 1); assert.match(st.erros[0].erro, /não conseguiu indexar/);
});

test('teto de gasto do Google: o erro é lembrado, o envio não insiste, o painel avisa e uma chamada paga que volta apaga o aviso', function () {
  var s = sb({ rota: function (u, params) { if (/fileSearchStores\?/.test(u)) return { code: 429, body: { error: { message: CAP } } }; return null; }, arquivos: [{ id: 'a'.repeat(20), nome: 'Contrato.pdf' }] });
  var r = J(s.FileSearchDrive.indexar({}));
  assert.strictEqual(r.status, 'erro'); assert.match(r.erro, /monthly spending cap/);
  var cap = J(s.Gemini.capGoogle()); assert.ok(cap && /spending cap/.test(cap.msg), 'o aviso ficou guardado');
  s.Gemini.notarSucessoPago(); assert.strictEqual(s.Gemini.capGoogle(), null);
  assert.strictEqual(s.Gemini.notarFalha('HTTP 500 qualquer'), false); assert.strictEqual(s.Gemini.capGoogle(), null, 'outro erro não vira aviso de teto');
});

test('cascata do Gemini: sem soPago cai para a chave gratuita (e anota o teto); com soPago NUNCA usa a gratuita', function () {
  var ok = { candidates: [{ content: { parts: [{ text: 'oi' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }, usadas = [];
  var s = sb({ rota: function (u) { usadas.push(u); if (/key=chave-paga/.test(u)) return { code: 429, body: { error: { message: CAP } } }; if (/key=chave-gratis/.test(u)) return { code: 200, body: ok }; return null; } });
  var g = J(s.Gemini.gerarComModelo({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, 'gemini-3.8-flash'));
  assert.strictEqual(g.tier, 'free'); assert.ok(s.Gemini.capGoogle(), 'caiu para a gratuita e o aviso ficou');
  usadas.length = 0;
  assert.throws(function () { s.Gemini.gerarComModelo({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, 'gemini-3.8-flash', { soPago: true }); }, /cooldown|monthly spending cap|Sem chave paga/);
  assert.ok(usadas.every(function (u) { return u.indexOf('chave-gratis') === -1; }), 'conteúdo pessoal não vai pela gratuita');
  var s2 = sb({ props: { GEMINI_API_KEY: '' }, rota: function () { return { code: 200, body: ok }; } });
  assert.throws(function () { s2.Gemini.gerarComModelo({ contents: [] }, 'gemini-3.8-flash', { soPago: true }); }, /Sem chave paga disponível/);
  var s3 = sb({ rota: function (u) { return { code: 200, body: ok }; } });
  s3.PropertiesService.getScriptProperties().setProperty('GEMINI_CAP_GOOGLE', JSON.stringify({ desde: 1, em: Date.now(), msg: 'x' }));
  assert.strictEqual(J(s3.Gemini.gerarComModelo({ contents: [] }, 'gemini-3.8-flash', { soPago: true })).tier, 'faturamento'); assert.strictEqual(s3.Gemini.capGoogle(), null, 'a paga voltou: aviso apagado');
});

test('perguntar: desligada, sem chave ou sem PDFs dizem por quê; a resposta vem do store pela chave paga, com as fontes', function () {
  assert.strictEqual(J(sb({ props: { FILE_SEARCH_ATIVA: 'nao' } }).FileSearchDrive.perguntar('qualquer coisa')).desligada, true);
  assert.match(sb({ props: { GEMINI_API_KEY: '' } }).FileSearchDrive.perguntar('x').erro, /chave de faturamento/);
  assert.strictEqual(J(sb().FileSearchDrive.perguntar('x')).vazio, true);
  var corpoVisto = null, s = sb({ rota: function (u, params) {
    if (/models\/gemini-3\.8-flash:generateContent/.test(u)) { corpoVisto = JSON.parse(params.payload); return { code: 200, body: { candidates: [{ content: { parts: [{ text: 'Reajuste anual pelo IGP-M (Contrato de aluguel).' }] }, groundingMetadata: { groundingChunks: [{ retrievedContext: { title: 'Contrato de aluguel.pdf · 1AbCdEfGhIjKlMnOpQrStUvWxYz012345', text: 'Cláusula 7' } }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } } }; }
    return null; } });
  s._prop('FS_STORE', 'fileSearchStores/s1'); s._prop('FS_INDICE_FILE_ID', 'idx1'); s._mem.idx = JSON.stringify([{ id: 'a', nome: 'Contrato de aluguel.pdf', estado: 'pronto' }]);
  var r = J(s.FileSearchDrive.perguntar('Como é o reajuste do aluguel?'));
  assert.strictEqual(r.ok, true); assert.match(r.resposta, /IGP-M/); assert.strictEqual(r.fontes[0].nome, 'Contrato de aluguel.pdf');
  assert.deepStrictEqual(corpoVisto.tools, [{ file_search: { file_search_store_names: ['fileSearchStores/s1'] } }]);
  assert.match(corpoVisto.systemInstruction.parts[0].text, /SOMENTE com base nos trechos/);
  assert.ok(s._chamadas.every(function (c) { return c.url.indexOf(GRATIS) === -1; }), 'a pergunta também só vai pela chave paga');
});

test('Painéis: Custos e Saúde mostram o teto do Google recusado', function () {
  var s = sb(); loadGasFile('Code.js', s);
  var r = J(s._saudeMontar({ agora: Date.now(), hb: { itens: [] }, triggers: [], diario: { h: {} }, eventos: [], capGoogle: { desde: Date.now() - 3600e3, msg: 'x' } }));
  assert.strictEqual(r.nivel, 'atencao'); assert.match(r.alertas[0], /O Google RECUSOU a chave paga.*desde há 1 h/);
  var c = J(s._custosMontar({ gastoBRL: 1, tetoBRL: 29.65, projecaoBRL: 2, porModelo: {} }, { hoje: '2026-10-20', capGoogle: { desde: 1, em: 2, msg: 'cap' } }));
  assert.deepStrictEqual(c.capGoogle, { desde: 1, em: 2, msg: 'cap' });
  var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8');
  assert.match(JS, /O Google recusou a chave paga/);
});

test('sondarChavePaga: descobre o teto do Google sem tráfego pago, guarda o resultado por 30 min e limpa o aviso quando a paga volta', function () {
  var estado = { cap: true, chamadas: 0 };
  var s = sb({ rota: function (u) { if (/embedContent/.test(u)) { estado.chamadas++; return estado.cap ? { code: 429, body: { error: { message: CAP } } } : { code: 200, body: { embedding: { values: [1] } } }; } return null; } });
  var r = J(s.Gemini.sondarChavePaga());
  assert.deepStrictEqual([r.ok, r.tetoGoogle], [false, true]); assert.ok(s.Gemini.capGoogle(), 'aviso guardado');
  assert.strictEqual(J(s.Gemini.sondarChavePaga()).cache, true); assert.strictEqual(estado.chamadas, 1, 'a segunda leitura vem do cache de 30 min');
  s.CacheService.getScriptCache().remove('gem_sonda'); estado.cap = false;
  assert.strictEqual(J(s.Gemini.sondarChavePaga()).ok, true); assert.strictEqual(s.Gemini.capGoogle(), null, 'a chave paga voltou: aviso apagado');
  assert.strictEqual(J(sb({ props: { GEMINI_API_KEY: '' } }).Gemini.sondarChavePaga()).ok, false);
});
