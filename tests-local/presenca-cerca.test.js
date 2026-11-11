// presenca-cerca.test.js — cerca geográfica do app (0.14.0): a decisão do servidor sobre entrou / permaneceu / saiu, com o Wi-Fi como confirmação.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb() {
  var s = makeSandbox({ props: { WIFI_CASA: 'MinhaCasa', WIFI_TRABALHO: 'Escritorio' } });
  s.Utilities.formatDate = function () { return '2026-11-11'; };
  s.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  loadGasFile('Code.js', s);
  return s;
}

test('entrou sem o Wi-Fi de casa: espera (não conta quem só passou na rua)', function () {
  var r = sb()._presencaPorCerca({ evento: 'entrou', lugar: 'casa', wifi_nome: '' }, true);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.acao, 'nenhuma');
});

test('entrou COM o Wi-Fi de casa: é chegada na hora', function () {
  var r = sb()._presencaPorCerca({ evento: 'entrou', lugar: 'casa', wifi_nome: 'MinhaCasa' }, true);
  assert.strictEqual(r.acao, 'transicao'); assert.strictEqual(r.local, 'casa');
});

test('permaneceu 2 min dentro: é chegada mesmo sem Wi-Fi', function () {
  var r = sb()._presencaPorCerca({ evento: 'permaneceu', lugar: 'casa', wifi_nome: '' }, true);
  assert.strictEqual(r.acao, 'transicao'); assert.strictEqual(r.local, 'casa');
});

test('saiu da cerca com o Wi-Fi de casa ainda conectado é ruído de GPS', function () {
  var r = sb()._presencaPorCerca({ evento: 'saiu', lugar: 'casa', wifi_nome: 'MinhaCasa' }, true);
  assert.strictEqual(r.acao, 'nenhuma');
});

test('saiu da cerca de verdade: local passa a "outro"', function () {
  var r = sb()._presencaPorCerca({ evento: 'saiu', lugar: 'casa', wifi_nome: '' }, true);
  assert.strictEqual(r.acao, 'transicao'); assert.strictEqual(r.local, 'outro');
});

test('lugar ou evento inválido é recusado', function () {
  var s = sb();
  assert.strictEqual(s._presencaPorCerca({ evento: 'entrou', lugar: 'praia' }, true).ok, false);
  assert.strictEqual(s._presencaPorCerca({ evento: 'dancou', lugar: 'casa' }, true).ok, false);
});

// ---- resumo do dia ao chegar em casa (substitui a macro Chegada em Casa): mesma fala dos lembretes, dedupe de 4 h
function sbResumo() {
  var s = sb();
  s._montarBriefingChegada = function () { return 'Boa noite, Bruno. RESUMO-DO-DIA.'; };
  s._prepararTextoFala = function (t) { return t; };
  s.GmailApp = { getInboxUnreadCount: function () { return 3; } };
  s.Jarvis = { falas: [], controlarDispositivo: function (a) { if (a.acao === 'falar') s.Jarvis.falas.push(a.texto); return { status: 'success' }; }, registrarEvento: function () {} };
  // já havia uma leitura anterior, fora de casa: na PRIMEIRA leitura o servidor só memoriza o local e não conta transição
  s.PropertiesService.getScriptProperties().setProperty('PROATIVO_SNAPSHOT', JSON.stringify({ local: 'outro' }));
  return s;
}

test('chegada pela cerca fala o resumo do dia UMA vez, no lugar da saudação curta', function () {
  var s = sbResumo();
  var r = s._presencaPorCerca({ evento: 'permaneceu', lugar: 'casa', wifi_nome: '' }, false);
  assert.strictEqual(r.acao, 'transicao');
  assert.strictEqual(s.Jarvis.falas.length, 1);
  assert.match(s.Jarvis.falas[0], /RESUMO-DO-DIA/);
  assert.doesNotMatch(s.Jarvis.falas[0], /Bem-vindo/);
});

test('dentro de 4 h o resumo não repete: cai na saudação curta (ou nada, pelo cooldown)', function () {
  var s = sbResumo();
  s._presencaPorCerca({ evento: 'permaneceu', lugar: 'casa', wifi_nome: '' }, false);
  // sai e volta
  s._presencaPorCerca({ evento: 'saiu', lugar: 'casa', wifi_nome: '' }, false);
  s.Jarvis.falas.length = 0;
  s._presencaPorCerca({ evento: 'permaneceu', lugar: 'casa', wifi_nome: '' }, false);
  s.Jarvis.falas.forEach(function (f) { assert.doesNotMatch(f, /RESUMO-DO-DIA/); });
});

test('GEOCERCA_BRIEFING=nao mantém só a saudação curta', function () {
  var s = sbResumo();
  s.PropertiesService.getScriptProperties().setProperty('GEOCERCA_BRIEFING', 'nao');
  s._presencaPorCerca({ evento: 'permaneceu', lugar: 'casa', wifi_nome: '' }, false);
  s.Jarvis.falas.forEach(function (f) { assert.doesNotMatch(f, /RESUMO-DO-DIA/); });
});
