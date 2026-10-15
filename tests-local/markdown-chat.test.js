// markdown-chat.test.js — o chat renderiza os relatórios (tabela, título, negrito, citação, link) e NUNCA deixa HTML do texto virar tag (15/10/2026).
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8');
var bloco = JS.slice(JS.indexOf('/*MD_INI*/'), JS.indexOf('/*MD_FIM*/'));
var escapeHtml = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
var M = new Function('escapeHtml', bloco + '; return { pareceMd: pareceMd, mdSeguro: mdSeguro };')(escapeHtml);

test('só vira markdown o texto com tabela ou título; conversa comum fica como texto', function () {
  assert.ok(M.pareceMd('### 📈 Relatório\n\n| a | b |\n|---|---:|\n| 1 | 2 |'));
  assert.ok(M.pareceMd('# Título\ntexto'));
  assert.ok(!M.pareceMd('Oi! Tem **negrito** e um | traço | aqui, sem tabela.'));
  assert.ok(!M.pareceMd('#hashtag sem espaço'));
});

test('tabela, título, negrito, itálico, citação, lista e link com alinhamento', function () {
  var h = M.mdSeguro('### Relatório\n\n**Total:** R$ 10\n\n| Fundo | Saldo |\n|---|---:|\n| [KNRI11](https://www.fundsexplorer.com.br/funds/knri11) | R$ 5 |\n\n> Pesquisa feita\n\n- um\n- dois\n\n_rodapé em itálico_');
  assert.match(h, /<div class="md-h md-h3">Relatório<\/div>/);
  assert.match(h, /<strong>Total:<\/strong>/);
  assert.match(h, /<th style="text-align:right">Saldo<\/th>/);
  assert.match(h, /<td style="text-align:left"><a href="https:\/\/www\.fundsexplorer\.com\.br\/funds\/knri11" target="_blank" rel="noopener noreferrer">KNRI11<\/a><\/td>/);
  assert.match(h, /<blockquote>Pesquisa feita<\/blockquote>/);
  assert.match(h, /<ul><li>um<\/li><li>dois<\/li><\/ul>/);
  assert.match(h, /<em>rodapé em itálico<\/em>/);
});

test('segurança: tag, atributo e link javascript: do texto nunca viram HTML ativo', function () {
  var h = M.mdSeguro('### x\n\n| a |\n|---|\n| <img src=x onerror=alert(1)> |\n\n[clica](javascript:alert(1)) <script>alert(2)</script> [ok](https://a.com/"onmouseover="x)');
  assert.doesNotMatch(h, /<img|<script/i);
  assert.doesNotMatch(h, /href="javascript/i);
  assert.doesNotMatch(h, /href="https:\/\/a\.com\/"onmouseover/);
});

test('ligação no chat: typeOut e o histórico usam o renderizador, e o CSS cobre a tabela', function () {
  assert.match(JS, /if \(pareceMd\(text\)\) \{ definirTextoMsg\(el, text\)/);
  assert.match(JS, /definirTextoMsg\(wrap\.querySelector\("\.msg__text"\), text\)/);
  var CSS = fs.readFileSync(path.join(__dirname, '..', 'Stylesheet.html'), 'utf8');
  assert.match(CSS, /\.msg__text\.md \.md-tab \{ overflow-x: auto/);
});
