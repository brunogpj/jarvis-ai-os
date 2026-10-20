// anexos-historico.test.js — o print anexado ao chat reabre no histórico (19/10/2026): a imagem só vivia na memória da página; ao reabrir a conversa sobrava o nome.
// Agora a miniatura é guardada com a mensagem. Também: último push recebido por app financeiro na caixa de notificações.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var JPG = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
function sb(extra) {
  extra = extra || {};
  var s = makeSandbox({ props: { OWNER_EMAIL: 'dono@exemplo.com' } });
  loadGasFile('Code.js', s);
  var gravados = [];
  s.Firestore = { listDocs: function (col) { return (extra.colecoes || {})[col] || []; }, setDoc: function (c, id, d) { gravados.push({ c: c, id: id, d: d }); return true; }, updateDoc: function () { return true; }, getDoc: function () { return null; } };
  s._gravados = gravados;
  s.getSessionUser = function (t) { return t === 'tok-dono' ? { email: 'dono@exemplo.com', nome: 'Dono' } : null; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('_miniaturasValidas: só JPEG pequeno em data URL, no máximo 3 e ~420 KB no total', function () {
  var s = sb();
  var ok = J(s._miniaturasValidas([{ nome: 'a.png', thumb: JPG }, { nome: 'b.png', thumb: JPG }]));
  assert.deepStrictEqual(ok.map(function (m) { return m.nome; }), ['a.png', 'b.png']);
  assert.strictEqual(J(s._miniaturasValidas([{ nome: 'x', thumb: 'data:image/png;base64,AAAA' }, { nome: 'y', thumb: 'javascript:alert(1)' }, { nome: 'z', thumb: 'data:image/jpeg;base64,<script>' }, { nome: 'w' }, null])).length, 0, 'png, esquema estranho, conteúdo fora do base64 e ausência são recusados');
  assert.strictEqual(J(s._miniaturasValidas([{ thumb: 'data:image/jpeg;base64,' + 'A'.repeat(150001) }])).length, 0, 'acima de 150 KB');
  assert.strictEqual(J(s._miniaturasValidas([1, 2, 3, 4, 5].map(function (i) { return { nome: 'n' + i, thumb: JPG }; }))).length, 3, 'no máximo 3');
  var grande = 'data:image/jpeg;base64,' + 'A'.repeat(139000);
  assert.strictEqual(J(s._miniaturasValidas([{ thumb: grande }, { thumb: grande }, { thumb: grande }, { thumb: grande }])).length, 3, 'o terceiro (≈ 420 KB) ainda cabe e o quarto já é cortado pelo teto de 3');
  assert.strictEqual(J(s._miniaturasValidas([{ thumb: 'data:image/jpeg;base64,' + 'A'.repeat(149000) }, { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(149000) }, { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(149000) }])).length, 2, 'o total passa de 420 KB: o terceiro fica de fora');
});

test('_persistirTurno guarda a miniatura do anexo principal e as dos extras junto da mensagem', function () {
  var s = sb();
  s._persistirTurno('u1', null, 'veja o print', { tipo: 'inline', nome: 'print.jpg', mimeType: 'image/jpeg', data: 'x' }, { resposta: 'ok', miniaturas: [{ nome: 'print.jpg', thumb: JPG }, { nome: 'outro.jpg', thumb: JPG }] });
  var msg = s._gravados.filter(function (g) { return /mensagens$/.test(g.c) && g.d.role === 'user'; })[0].d;
  assert.strictEqual(msg.anexo.thumb, JPG); assert.strictEqual(msg.anexo.isImage, true);
  assert.deepStrictEqual(J(msg.anexo.outros), [{ nome: 'outro.jpg', thumb: JPG }]);
  s._gravados.length = 0;
  s._persistirTurno('u1', null, 'sem miniatura', { tipo: 'inline', nome: 'doc.pdf', mimeType: 'application/pdf', data: 'x' }, { resposta: 'ok' });
  var m2 = s._gravados.filter(function (g) { return g.d.role === 'user'; })[0].d;
  assert.strictEqual(m2.anexo.thumb, undefined); assert.strictEqual(m2.anexo.isImage, false);
});

test('dashboardNotificacoes: mostra o último push de cada app financeiro (para notar silêncio)', function () {
  var agora = Date.now();
  var colecoes = { notificacoes: [
    { id: 'n1', dados: { app: 'Mercado Pago', titulo: 'Você pagou X', texto: 'R$ 1', em: agora - 2 * 86400000 } },
    { id: 'n2', dados: { app: 'Mercado Pago', titulo: 'Antiga', texto: 'R$ 2', em: agora - 9 * 86400000 } },
    { id: 'n3', dados: { app: 'Swile BR', titulo: 'Compra aprovada', texto: 'x', em: agora - 3600e3 } },
    { id: 'n4', dados: { app: 'Itaú Investimentos', titulo: 'x', texto: 'y', em: agora - 1000 } }] };
  var s = sb({ colecoes: colecoes }), r = s.dashboardNotificacoes('tok-dono');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ultimoPush['Mercado Pago'].quando, 'há 2 d'); assert.strictEqual(r.ultimoPush['Swile'].quando, 'há 1 h');
  assert.strictEqual(r.ultimoPush['Bradesco'], null); assert.strictEqual(r.ultimoPush['Itaú'], null, 'Itaú Investimentos não conta como o app do banco');
});

test('Interface: a miniatura nasce ao anexar, vai no payload, volta no histórico e o anexo sem original explica em vez de ficar mudo', function () {
  var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8');
  assert.match(JS, /function miniaturaDe\(dataUrl, cb\)/);
  assert.match(JS, /miniaturaDe\(dataUrl, function \(th\) \{ _addPending\(\{ tipo: "inline"[^}]*thumb: th \}\); \}\)/);
  assert.match(JS, /nome: a\.nome, thumb: a\.thumb \|\| ""/);
  assert.match(JS, /isImage: !!m\.anexo\.thumb, dataUrl: m\.anexo\.thumb \|\| ""/);
  assert.match(JS, /m\.anexo\.outros/); assert.match(JS, /if \(att\.semOriginal\) \{ toast\(/);
  assert.match(JS, /\/\^data:image\\\/jpeg;base64,\/\.test\(o\.thumb\)/, 'extras só aceitam JPEG em data URL');
});
