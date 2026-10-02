// dia-0110.test.js — o que os logs de 01/10/2026 mostraram:
//  · o despertador das 6h virou "São 6h." (a regra do relógio pegava o "hora atual");
//  · o briefing da manhã passou de 1500 caracteres e veio na outra voz (Cloud TTS);
//  · "Boa tarde, Bruno. Olha só, Bruno, ..." no briefing da tarde;
//  · o autodiagnóstico falou "Parei de receber notificações de Teste do Jarvis".
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function code(o) { return loadGasFile('Code.js', makeSandbox(o)); }
var T0600 = new Date(Date.UTC(2026, 9, 1, 9, 0));   // 01/10/2026 06:00 BRT (quinta)
var PEDIDO_6H = 'Voce e meu despertador agora. Me de um bom dia caloroso me chamando de Bruno, anuncie a hora atual e o dia de hoje.';

test('Despertador: o pedido das 6h é o bom dia composto, não o relógio', function () {
  var s = code({});
  assert.strictEqual(s._interpretarFatoVoz(PEDIDO_6H).via, 'despertador');
  assert.strictEqual(s._preverRotaDeterministica(PEDIDO_6H), 'despertador');
  // continuam sendo o relógio
  assert.strictEqual(s._interpretarFatoVoz('que horas são').via, 'relogio');
  assert.strictEqual(s._interpretarFatoVoz('me diga a hora atual').via, 'relogio');
  // comando do aparelho não é o bom dia
  assert.strictEqual(s._interpretarFatoVoz('cria um despertador às 6h'), null);
});

test('Despertador: saudação, hora, dia e a agenda REAL de hoje', function () {
  var s = code({});
  var pedidos = [];
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function (a, b) { pedidos.push([a, b]); return []; } }; } };
  assert.strictEqual(s._falarDespertador(T0600),
    'Bom dia, Bruno! São 6h desta quinta-feira, 1º de outubro. Hoje, daqui até o fim do dia, você não tem nada na agenda. Tenha um ótimo dia.');
  assert.strictEqual(pedidos.length, 1, 'a agenda foi consultada');
  // sábado leva "deste"
  assert.match(s._falarDespertador(new Date(Date.UTC(2026, 9, 3, 9, 30))), /^Bom dia, Bruno! São 6h30 deste sábado, 3 de outubro\./);
});

test('Despertador: agenda fora do ar não derruba o bom dia', function () {
  var s = code({});
  s.CalendarApp = { getDefaultCalendar: function () { throw new Error('sem permissao'); } };
  assert.match(s._falarDespertador(T0600), /^Bom dia, Bruno! São 6h desta quinta-feira, 1º de outubro\. Não consegui ler a sua agenda agora\./);
});

function briefing(props) {
  var s = makeSandbox({ props: props || {} });
  s.Utilities = s.Utilities || {};
  s.Utilities.formatDate = function (d, tz, fmt) { return fmt === 'H' ? '13' : (fmt === 'yyyy-MM-dd' ? '2026-10-01' : ''); };
  return loadGasFile('Briefing.js', s);
}

test('Briefing.caberNoTeto: corta na última frase inteira que cabe', function () {
  var s = briefing();
  var c = s.Briefing.caberNoTeto;
  assert.strictEqual(c('Frase um. Frase dois. Frase três.', 100), 'Frase um. Frase dois. Frase três.');
  assert.strictEqual(c('Frase um. Frase dois. Frase três.', 22), 'Frase um. Frase dois.');
  assert.strictEqual(c('Frase um. Frase dois.', 0), 'Frase um. Frase dois.', 'sem teto, não mexe');
});

test('Briefing.gerar: texto longo do modelo é cortado para caber na voz do Gemini (01/10: 1526 car.)', function () {
  var s = briefing();
  var frase = 'Em Belo Horizonte, a previsão é de calor intenso com pancadas de chuva à tarde. ';
  s.Gemini = {
    pesquisarWeb: function () { return { texto: 'Fato.', fontes: ['x — https://a'] }; },
    gerar: function () { return { json: { candidates: [{ content: { parts: [{ text: frase.repeat(30) }] } }] } }; }
  };
  s.lerBiblia = function () { return { ok: true, ref: 'Salmos 23:1', texto: 'O Senhor é o meu pastor, nada me faltará.' }; };
  var r = s.Briefing.gerar({ tag: 'briefing', texto: 'me dê uma análise das principais notícias do dia, leia algum texto bíblico' });
  assert.ok(r.texto.length <= 1500 - 80, 'coube com folga: ' + r.texto.length);
  assert.match(r.texto, /Para encerrar, Salmos 23:1/, 'o versículo (fato) fica inteiro');
  assert.match(r.texto, /\.\s+Para encerrar/, 'o corpo termina em frase inteira');
  assert.match(r.rastro.redacao, /cortado p\//);
});

test('Briefing.tirarSaudacao: vocativo com muleta logo no começo (01/10)', function () {
  var s = briefing();
  var t = s.Briefing.tirarSaudacao;
  assert.strictEqual(t('Olha só, Bruno, tem algumas coisas importantes acontecendo por aqui.'), 'Tem algumas coisas importantes acontecendo por aqui.');
  assert.strictEqual(t('Bruno, o dólar caiu.'), 'O dólar caiu.');
  assert.strictEqual(t('Olha só o que o Bruno Henrique fez no jogo.'), 'Olha só o que o Bruno Henrique fez no jogo.', 'nome no meio da notícia fica');
});

test('Autodiag: app raro que saiu da janela não vira "parei de receber"', function () {
  var props = { AUTODIAG_SNAPSHOT: JSON.stringify({ apps: ['Teste do Jarvis', 'Agenda Edu'], contagem: { 'Teste do Jarvis': 1, 'Agenda Edu': 40 } }) };
  var s = code({ props: props });
  s.diagAppsNotificacao = function () { return { ok: true, apps: [], regrasSemTrafego: [], ponto: { armado: true } }; };
  var r = s._autodiagVerificar();
  var sumiu = r.achados.filter(function (a) { return a.chave === 'app_sumiu'; });
  assert.strictEqual(sumiu.length, 1);
  assert.strictEqual(sumiu[0].texto, 'Parei de receber notificações de Agenda Edu.');
  assert.strictEqual(r.estado.contagem && typeof r.estado.contagem, 'object');
});

test('Autodiag: snapshot antigo (sem contagem) não acusa ninguém', function () {
  var s = code({ props: { AUTODIAG_SNAPSHOT: JSON.stringify({ apps: ['Itau', 'Zeldar'] }) } });
  s.diagAppsNotificacao = function () { return { ok: true, apps: [], regrasSemTrafego: [], ponto: { armado: true } }; };
  var r = s._autodiagVerificar();
  assert.strictEqual(r.achados.filter(function (a) { return a.chave === 'app_sumiu'; }).length, 0);
});
