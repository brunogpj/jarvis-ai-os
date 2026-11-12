// midia.test.js — "me mostra fotos / vídeos de X" sem o Gemini (Midia.js, 11/11) e a imagem no chat só de endereços permitidos.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(respostas, props) {
  var s = makeSandbox({ props: props || {} });
  var mem = {};
  s.CacheService = { getScriptCache: function () { return { get: function (k) { return mem[k] || null; }, put: function (k, v) { mem[k] = v; }, remove: function (k) { delete mem[k]; } }; } };
  s.Utilities.computeDigest = function (a, t) { return String(t).split('').map(function (c) { return c.charCodeAt(0) & 127; }); };
  s.Utilities.DigestAlgorithm = { MD5: 1 };
  s.Utilities.base64EncodeWebSafe = function (b) { return Buffer.from(b).toString('base64'); };
  s._urls = [];
  s.UrlFetchApp = { fetchAll: function (reqs) {
    return reqs.map(function (r) {
      s._urls.push(r.url);
      var corpo = (respostas || function () { return null; })(r.url);
      return { getResponseCode: function () { return corpo ? 200 : 500; }, getContentText: function () { return JSON.stringify(corpo || {}); } };
    });
  } };
  loadGasFile('Midia.js', s);
  return s;
}

test('entende o pedido e separa o assunto', function () {
  var M = sb().Midia;
  var a = M.interpretar('Me mostra fotos e vídeos do GTA 6');
  assert.deepStrictEqual([a.termo, a.fotos, a.videos], ['gta 6', true, true]);
  var b = M.interpretar('quero ver o trailer de Duna 3, por favor');
  assert.strictEqual(b.termo, 'duna 3'); assert.strictEqual(b.videos, true); assert.strictEqual(b.fotos, false);
  assert.strictEqual(M.interpretar('o que temos de notícias, vídeos e fotos sobre a Serra do Cipó?').termo, 'serra do cipo');
});

test('o assunto para onde começa outra pergunta (frase real de 11/11)', function () {
  var M = sb().Midia;
  assert.strictEqual(M.interpretar('me mostra fotos e vídeos do GTA 6 e o que tem de novo de lançamento a respeito desse jogo').termo, 'gta 6');
  assert.strictEqual(M.interpretar('quero ver vídeos do GTA 6, quando lança?').termo, 'gta 6');
  assert.strictEqual(M.interpretar('me mostra fotos da Serra do Cipó que eu vou visitar').termo, 'serra do cipo');
  assert.strictEqual(M.interpretar('mostra imagens de Ouro Preto e Mariana').termo, 'ouro preto e mariana');
});

test('não pega o que é dele, geração de imagem, nem o que já tem rota', function () {
  var M = sb().Midia;
  ['mostra as minhas fotos do drive', 'gera uma imagem de um gato', 'procura vídeos de receita no youtube', 'quanto gastei com fotos', 'que dia lança o GTA 6',
   'me mostra as fotos do print que anexei'].forEach(function (f) { assert.strictEqual(M.interpretar(f), null, f); });
});

test('assunto vago: usa o tema recente da conversa; sem tema, deixa para o agente', function () {
  var M = sb().Midia;
  assert.strictEqual(M.interpretar('o que temos de notícias vídeos fotos do novo jogo'), null);
  M.lembrarTema('GTA 6 data de lançamento');
  assert.strictEqual(M.interpretar('o que temos de notícias vídeos fotos do novo jogo').termo, 'GTA 6 data de lançamento');
});

test('relatório: vídeos do YouTube com capa, fotos só da Wikimedia e links do Google', function () {
  var s = sb(function (u) {
    if (u.indexOf('googleapis.com/youtube') >= 0) return { items: [{ id: { videoId: 'abcDEF12345' }, snippet: { title: 'Trailer [oficial] <b>2</b>', channelTitle: 'Canal' } }, { id: { videoId: 'x"y' }, snippet: { title: 'lixo' } }] };
    if (u.indexOf('pt.wikipedia') >= 0) return { query: { pages: { '1': { index: 1, title: 'Jogo X', extract: 'Jogo X é um jogo.', fullurl: 'https://pt.wikipedia.org/wiki/Jogo_X', thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' } },
      '2': { index: 2, title: 'Outro', thumbnail: { source: 'https://malicioso.example/a.jpg' } } } } };
    if (u.indexOf('commons') >= 0) return { query: { pages: { '9': { index: 1, title: 'File:Foto.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/b.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Foto.jpg' }] },
      '8': { index: 2, title: 'File:Doc.pdf', imageinfo: [{ mime: 'application/pdf', thumburl: 'https://upload.wikimedia.org/c.jpg' }] } } } };
    return { query: { pages: {} } };
  }, { YOUTUBE_API_KEY: 'k' });
  var t = s.Midia.relatorio({ termo: 'jogo x', fotos: true, videos: true, noticias: false });
  assert.match(t, /^## jogo x: vídeos, fotos, links/);
  assert.match(t, /\[!\[Trailer oficial 2\]\(https:\/\/i\.ytimg\.com\/vi\/abcDEF12345\/mqdefault\.jpg\)\]\(https:\/\/youtu\.be\/abcDEF12345\)/);
  assert.ok(t.indexOf('x"y') < 0, 'id de vídeo inválido fica de fora');
  assert.match(t, /upload\.wikimedia\.org\/a\.jpg/); assert.match(t, /upload\.wikimedia\.org\/b\.jpg/);
  assert.ok(t.indexOf('malicioso.example') < 0); assert.ok(t.indexOf('c.jpg') < 0, 'PDF não é foto');
  assert.match(t, /> Jogo X é um jogo\. \(\[Wikipédia\]/);
  assert.match(t, /\[Imagens\]\(https:\/\/www\.google\.com\/search\?q=jogo%20x&udm=2\)/);
});

test('sem a chave do YouTube: diz isso e dá o link da busca; nenhuma chamada ao YouTube', function () {
  var s = sb(function () { return { query: { pages: {} } }; });
  var t = s.Midia.relatorio({ termo: 'duna 3', fotos: false, videos: true, noticias: false });
  assert.match(t, /precisa da chave do YouTube/); assert.match(t, /youtube\.com\/results\?search_query=duna%203/);
  assert.ok(s._urls.every(function (u) { return u.indexOf('googleapis.com') < 0; }));
});

test('voz: não busca nada, só devolve o link do Google e a frase', function () {
  var s = sb();
  var v = s.Midia.paraVoz({ termo: 'gta 6', fotos: true, videos: true });
  assert.match(v.url, /udm=2$/); assert.match(v.fala, /imagens de gta 6/);
  assert.match(s.Midia.paraVoz({ termo: 'gta 6', fotos: false, videos: true }).url, /udm=7$/);
  assert.strictEqual(s._urls.length, 0);
});

// ---- o chat só mostra imagem de endereços permitidos
var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8');
var bloco = JS.slice(JS.indexOf('/*MD_INI*/'), JS.indexOf('/*MD_FIM*/'));
var escapeHtml = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
var MD = new Function('escapeHtml', bloco + '; return { mdSeguro: mdSeguro };')(escapeHtml);

test('chat: capa do YouTube vira imagem clicável; imagem de outro endereço NÃO vira <img>', function () {
  var h = MD.mdSeguro('## x\n\n[![Trailer](https://i.ytimg.com/vi/abc/mqdefault.jpg)](https://youtu.be/abc)\n\n![Foto](https://upload.wikimedia.org/a_b.jpg)\n\n![espiao](https://rastreador.example/p.gif)\n\n![x](https://i.ytimg.com.evil.example/a.jpg)');
  assert.match(h, /<a class="md-capa" href="https:\/\/youtu\.be\/abc"[^>]*><img class="md-img"[^>]*src="https:\/\/i\.ytimg\.com\/vi\/abc\/mqdefault\.jpg"><\/a>/);
  assert.match(h, /<img class="md-img"[^>]*src="https:\/\/upload\.wikimedia\.org\/a_b\.jpg">/);
  assert.strictEqual((h.match(/<img /g) || []).length, 2);
  assert.ok(h.indexOf('src="https://rastreador') < 0); assert.ok(h.indexOf('src="https://i.ytimg.com.evil') < 0);
});

test('chat: legenda com aspas ou tag não escapa do atributo', function () {
  var h = MD.mdSeguro('## x\n\n![a" onerror="alert(1)](https://upload.wikimedia.org/a.jpg) ![<b>](https://upload.wikimedia.org/b.jpg)');
  assert.ok(h.indexOf('onerror="alert') < 0); assert.ok(h.indexOf('<b>') < 0);
});
