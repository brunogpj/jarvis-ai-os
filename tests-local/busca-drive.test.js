// busca-drive.test.js — busca semântica nos arquivos do Drive (14/10/2026). Drive, Gemini e Workspace simulados: nada de rede nem de cota.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DOC = 'application/vnd.google-apps.document', SHEET = 'application/vnd.google-apps.spreadsheet', PDF = 'application/pdf';

/** Vetor de "embedding" simulado: saco de palavras em 48 dimensões. Textos com palavras em comum ficam parecidos — dá para testar ranking por sentido. */
function vetor(texto) {
  var v = new Array(48).fill(0);
  String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(function (t) { return t.length >= 3; }).forEach(function (t) {
    var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 48;
    v[h] += 1;
  });
  return v;
}

function sb(opts) {
  opts = opts || {};
  var s = makeSandbox({ props: Object.assign({ BUSCA_DRIVE_ATIVA: 'sim' }, opts.props || {}) });
  var arquivos = opts.arquivos || [];
  var conteudos = {};          // arquivos criados pelo código (o índice)
  s._embeds = []; s._arquivos = arquivos;
  function iterador(pos) {
    return { hasNext: function () { return pos < arquivos.length; }, next: function () { return fakeFile(arquivos[pos++]); }, getContinuationToken: function () { return 'pos:' + pos; } };
  }
  function fakeFile(a) {
    return { getId: function () { return a.id; }, getName: function () { return a.nome; }, getMimeType: function () { return a.mime; }, getSize: function () { return (a.texto || '').length; },
      getLastUpdated: function () { return new Date(a.mod); }, getParents: function () { var i = 0, ps = a.pais || []; return { hasNext: function () { return i < ps.length; }, next: function () { var id = ps[i++]; return { getId: function () { return id; }, getFolders: function () { return { hasNext: function () { return false; } }; } }; } }; },
      getBlob: function () { return { getDataAsString: function () { return a.texto || ''; } }; } };
  }
  s.DriveApp = {
    searchFiles: function (q) { s._ultimaQuery = q; return iterador(0); },
    continueFileIterator: function (t) { return iterador(Number(String(t).split(':')[1])); },
    getFileById: function (id) {
      if (id in conteudos) return { setContent: function (c) { conteudos[id] = c; }, getBlob: function () { return { getDataAsString: function () { return conteudos[id]; } }; } };
      var a = arquivos.filter(function (x) { return x.id === id; })[0]; if (!a) throw new Error('arquivo não existe');
      return fakeFile(a);
    },
    getFolderById: function (id) { return { getId: function () { return id; }, getFolders: function () { return { hasNext: function () { return false; } }; } }; }
  };
  s.DriveUploads = { _subpasta: function () { return { createFile: function (nome, c) { var id = 'idx-' + nome; conteudos[id] = c; return { getId: function () { return id; } }; } }; } };
  s.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  s.DocumentApp = { openById: function (id) { var a = arquivos.filter(function (x) { return x.id === id; })[0]; return { getBody: function () { return { getText: function () { return a.texto || ''; } }; } }; } };
  s.SpreadsheetApp = { openById: function (id) { var a = arquivos.filter(function (x) { return x.id === id; })[0]; return { getSheets: function () { return [{ getName: function () { return 'Aba1'; }, getLastRow: function () { return 2; }, getLastColumn: function () { return 2; },
    getRange: function () { return { getDisplayValues: function () { return [[a.texto || '', 'x'], ['1', '2']]; } }; } }]; } }; } };
  s.Utilities.base64Encode = function (bytes) { return Buffer.from(Int8Array.from(bytes)).toString('base64'); };
  s.Utilities.base64Decode = function (str) { return Array.from(new Int8Array(Buffer.from(str, 'base64'))); };
  s.Gemini = { embeddar: function (texto, o) {
    s._embeds.push({ texto: texto, soPago: !!(o && o.soPago), tipo: o && o.tipo });
    if (opts.erroEmbed) throw new Error(opts.erroEmbed);
    return vetor(texto);
  } };
  s._conteudos = conteudos;
  loadGasFile('BuscaDrive.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var AGORA = Date.parse('2026-10-14T12:00:00Z');
var ARQ = [
  { id: 'd1', nome: 'Contrato de aluguel apartamento', mime: DOC, mod: AGORA, texto: 'Contrato de locação do apartamento: valor do aluguel, reajuste anual e fiador.' },
  { id: 'd2', nome: 'Receitas da vovó', mime: DOC, mod: AGORA, texto: 'Bolo de cenoura, pudim e brigadeiro. Ingredientes e modo de preparo.' },
  { id: 'p1', nome: 'Gastos da viagem', mime: SHEET, mod: AGORA, texto: 'Passagem hotel passeios gastos viagem' },
  { id: 'f1', nome: 'scan-boleto-luz.pdf', mime: PDF, mod: AGORA }
];

test('Quantização int8: o cosseno do vetor sobrevive (erro < 1%) e cada arquivo ocupa ~1 KB, não ~10 KB', function () {
  var s = sb();
  var v = []; for (var i = 0; i < 768; i++) v.push(Math.sin(i) * 0.05 + (i % 7) * 0.003);
  var q = J(s.BuscaDrive._quantizar(v)), d = s.BuscaDrive._decodificar(q);
  var dot = 0, na = 0, nb = 0; for (var k = 0; k < v.length; k++) { dot += v[k] * d[k]; na += v[k] * v[k]; nb += d[k] * d[k]; }
  assert.ok(dot / Math.sqrt(na * nb) > 0.999, 'cosseno ' + dot / Math.sqrt(na * nb));
  assert.ok(q.q.length < 1200, 'tamanho base64 ' + q.q.length);
});

test('Indexar: lê texto de Docs/Planilhas, o PDF entra só pelo nome, só a chave paga é usada e o índice NÃO guarda texto', function () {
  var s = sb({ arquivos: ARQ });
  var r = J(s.BuscaDrive.indexar({}));
  assert.strictEqual(r.status, 'success'); assert.strictEqual(r.novos, 4); assert.strictEqual(r.total, 4);
  assert.ok(s._embeds.every(function (e) { return e.soPago === true && e.tipo === 'RETRIEVAL_DOCUMENT'; }), 'texto pessoal só pela chave paga');
  assert.match(s._embeds[0].texto, /fiador/, 'o texto do Doc entrou no vetor');
  assert.doesNotMatch(s._embeds[3].texto, /boleto-luz[\s\S]*\n[\s\S]*\n.+/, 'PDF: só nome + tipo');
  var bruto = s._conteudos['idx-indice-busca-drive.json'];
  assert.doesNotMatch(bruto, /fiador|brigadeiro|locação/, 'o índice guarda vetor, não conteúdo');
  var itens = JSON.parse(bruto);
  assert.strictEqual(itens.filter(function (i) { return i.parcial; }).length, 1);
});

test('Buscar: acha pelo SENTIDO, devolve o link do arquivo vivo e respeita tipo e k', function () {
  var s = sb({ arquivos: ARQ }); s.BuscaDrive.indexar({});
  var r = J(s.BuscaDrive.buscar('qual o valor do aluguel do apartamento', { k: 2 }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.itens.length, 2);
  assert.strictEqual(r.itens[0].nome, 'Contrato de aluguel apartamento');
  assert.strictEqual(r.itens[0].link, 'https://docs.google.com/document/d/d1/edit');
  var pl = J(s.BuscaDrive.buscar('gastos da viagem', { tipo: 'planilha' }));
  assert.deepStrictEqual(pl.itens.map(function (i) { return i.tipo; }), ['planilha']);
  assert.strictEqual(pl.itens[0].link, 'https://docs.google.com/spreadsheets/d/p1/edit');
  assert.strictEqual(J(s.BuscaDrive.buscar('boleto luz', {})).itens[0].link, 'https://drive.google.com/file/d/f1/view', 'PDF abre pelo Drive');
  var q = s._embeds.filter(function (e) { return e.tipo === 'RETRIEVAL_QUERY'; });
  assert.ok(q.length >= 3 && q.every(function (e) { return e.soPago !== true; }), 'a consulta (sem texto de arquivo) não precisa da chave paga');
});

test('Buscar: nome que contém a palavra da consulta ganha um empurrão', function () {
  var arq = [{ id: 'a', nome: 'Planejamento financeiro', mime: DOC, mod: AGORA, texto: 'metas orcamento' }, { id: 'b', nome: 'Anotações', mime: DOC, mod: AGORA, texto: 'financeiro orcamento metas planejamento' }];
  var s = sb({ arquivos: arq }); s.BuscaDrive.indexar({});
  assert.strictEqual(J(s.BuscaDrive.buscar('planejamento financeiro', {})).itens[0].nome, 'Planejamento financeiro');
});

test('Indexar é RESUMÍVEL: lote pequeno devolve "continuar" com token, a 2ª chamada segue de onde parou e termina', function () {
  var s = sb({ arquivos: ARQ });
  var a = J(s.BuscaDrive.indexar({ maxArquivos: 2 }));
  assert.strictEqual(a.status, 'continuar'); assert.strictEqual(a.novos, 2);
  assert.ok(s.PropertiesService.getScriptProperties().getProperty('BUSCA_DRIVE_TOKEN'), 'token guardado');
  var b = J(s.BuscaDrive.indexar({ maxArquivos: 10 }));
  assert.strictEqual(b.status, 'success'); assert.strictEqual(b.novos, 2); assert.strictEqual(b.total, 4);
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('BUSCA_DRIVE_TOKEN'), null, 'token limpo ao terminar');
  assert.strictEqual(s._embeds.length, 4, 'cada arquivo embeddado uma vez só');
});

test('Varredura seguinte: arquivo que não mudou NÃO gasta embedding; o modificado é refeito; a completa remove o que saiu do Drive', function () {
  var s = sb({ arquivos: ARQ.map(function (x) { return Object.assign({}, x); }) });
  s.BuscaDrive.indexar({});
  var antes = s._embeds.length;
  var r1 = J(s.BuscaDrive.indexar({ forcarCompleta: true }));
  assert.strictEqual(r1.pulados, 4); assert.strictEqual(s._embeds.length, antes, 'nada mudou: custo zero de IA');
  s._arquivos[1].mod = AGORA + 60000; s._arquivos[1].texto = 'Bolo de fubá e pão de queijo.';
  var r2 = J(s.BuscaDrive.indexar({ forcarCompleta: true }));
  assert.strictEqual(r2.atualizados, 1); assert.strictEqual(s._embeds.length, antes + 1);
  s._arquivos.splice(3, 1);   // o PDF foi para a lixeira
  var r3 = J(s.BuscaDrive.indexar({ forcarCompleta: true }));
  assert.strictEqual(r3.removidos, 1); assert.strictEqual(r3.total, 3);
  assert.strictEqual(J(s.BuscaDrive.buscar('boleto luz', {})).itens.filter(function (i) { return /boleto/.test(i.nome); }).length, 0);
});

test('Exclusões: a pasta da wiki e nomes que casam com BUSCA_DRIVE_EXCLUIR não entram', function () {
  var arq = ARQ.map(function (x) { return Object.assign({}, x); });
  arq[1].pais = ['PASTA_WIKI']; arq[2].nome = 'Senhas pessoais 2026';
  var s = sb({ arquivos: arq, props: { WIKI_DRIVE_ID: 'PASTA_WIKI', BUSCA_DRIVE_EXCLUIR: 'senhas?' } });
  var r = J(s.BuscaDrive.indexar({}));
  assert.strictEqual(r.total, 2, 'sobraram o contrato e o PDF');
  assert.ok(!JSON.parse(s._conteudos['idx-indice-busca-drive.json']).some(function (i) { return /Receitas|Senhas/.test(i.nome); }));
});

test('Sem chave paga ou cota estourada: aborta, não grava vetor e não trava o resto (a gratuita nunca recebe texto de arquivo)', function () {
  var s = sb({ arquivos: ARQ, erroEmbed: 'Sem chave paga disponível (faturamento ausente ou teto do mês atingido)' });
  var r = J(s.BuscaDrive.indexar({}));
  assert.strictEqual(r.status, 'abortado'); assert.strictEqual(r.total, 0);
  assert.match(r.erro1, /chave paga/);
  assert.strictEqual(s._embeds.length, 1, 'parou no primeiro erro fatal, sem martelar a API');
});

test('Índice vazio → buscar diz que está vazio (o agente cai na busca por palavra-chave) e tick desligado não toca no Drive', function () {
  var s = sb({ arquivos: ARQ });
  var r = J(s.BuscaDrive.buscar('aluguel', {}));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.vazio, true);
  var off = sb({ arquivos: ARQ, props: { BUSCA_DRIVE_ATIVA: 'nao' } });
  assert.strictEqual(J(off.BuscaDrive.tick()).status, 'desligada');
  assert.strictEqual(off._ultimaQuery, undefined, 'nem listou o Drive');
});

test('A varredura incremental só pede ao Drive o que mudou desde a última (modifiedDate)', function () {
  var s = sb({ arquivos: ARQ }); s.BuscaDrive.indexar({});
  s.BuscaDrive.indexar({});
  assert.match(s._ultimaQuery, /modifiedDate > '2026-|modifiedDate > '20/, 'consulta incremental: ' + s._ultimaQuery);
  assert.match(s._ultimaQuery, /trashed = false/);
});

// ── Gemini.embeddar com soPago ────────────────────────────────────────────────────────
test('Gemini.embeddar soPago: sem chave de faturamento NÃO chama a API (nada de texto pessoal na chave gratuita)', function () {
  var chamadas = 0;
  var s = makeSandbox({ props: { GEMINI_API_KEY_FALLBACK: 'livre1', GEMINI_API_KEY_FALLBACK2: 'livre2' }, fetch: function () { chamadas++; return { code: 200, body: { embedding: { values: [0.1, 0.2] } } }; } });
  loadGasFile('Gemini.js', s);
  assert.throws(function () { s.Gemini.embeddar('texto do contrato', { soPago: true }); }, /Sem chave paga/);
  assert.strictEqual(chamadas, 0);
  assert.deepStrictEqual(J(s.Gemini.embeddar('texto da wiki', {})), [0.1, 0.2], 'sem soPago a cascata de sempre continua valendo');
  var com = makeSandbox({ props: { GEMINI_API_KEY: 'paga', GEMINI_API_KEY_FALLBACK: 'livre1', GEMINI_FREE_ONLY: 'false', GEMINI_ORDER: 'billing_first' },
    fetch: function (url) { com._urls = (com._urls || []).concat(url); return { code: 200, body: { embedding: { values: [0.3] } } }; } });
  loadGasFile('Gemini.js', com);
  com.Gemini.embeddar('texto', { soPago: true });
  assert.ok(com._urls.every(function (u) { return /key=paga/.test(u); }), 'só a chave paga: ' + com._urls.join(','));
});

// ── agente ────────────────────────────────────────────────────────────────────────────
test('Agente: "acha o documento sobre o aluguel" abre a ferramenta buscarArquivosDrive (grupo do Drive)', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  var p = s.Jarvis._toolsPermitidas('acha o documento sobre o aluguel do apartamento');
  assert.ok(p.buscarArquivosDrive, 'ferramenta liberada');
  assert.ok(!s.Jarvis._toolsPermitidas('que horas sao agora').buscarArquivosDrive, 'e não vai para qualquer pedido');
});
