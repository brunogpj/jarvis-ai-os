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

// ───────────── 06/10: coleta do briefing em paralelo (a de fila chegou a 243 s e matou o das 21:00) ─────────────
function geminiComFetchAll(o) {
  var s = makeSandbox({ props: { GEMINI_API_KEY_FALLBACK: 'FREE1', GEMINI_API_KEY_FALLBACK2: 'FREE2' } });
  s._lotes = []; s._unitarias = 0;
  function resp(code, texto) {
    return { getResponseCode: function () { return code; },
      getContentText: function () { return code === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }) : '{"error":{"message":"x"}}'; } };
  }
  s.UrlFetchApp = {
    fetchAll: function (reqs) { s._lotes.push(reqs.length); if (o.fetchAllErro) throw new Error('rede'); return reqs.map(function (r, i) { return o.paralelo ? o.paralelo(i, r) : resp(200, 'ok ' + i); }); },
    fetch: function () { s._unitarias++; return resp(200, 'da fila'); }
  };
  return loadGasFile('Gemini.js', s);
}

test('pesquisarWebVarias: uma rodada em paralelo, na mesma ordem', function () {
  var s = geminiComFetchAll({});
  var r = s.Gemini.pesquisarWebVarias(['a', 'b', 'c']);
  assert.deepStrictEqual([...s._lotes], [3]);
  assert.strictEqual(s._unitarias, 0, 'nenhuma busca em fila');
  assert.deepStrictEqual([r[0].texto, r[1].texto, r[2].texto], ['ok 0', 'ok 1', 'ok 2']);
});

test('pesquisarWebVarias: o que falhou no paralelo cai na cascata em fila; o resto fica', function () {
  var s = geminiComFetchAll({ paralelo: function (i) {
    return i === 1 ? { getResponseCode: function () { return 429; }, getContentText: function () { return '{}'; } }
                   : { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ candidates: [{ content: { parts: [{ text: 'par ' + i }] } }] }); } };
  } });
  var r = s.Gemini.pesquisarWebVarias(['a', 'b', 'c']);
  assert.deepStrictEqual([r[0].texto, r[1].texto, r[2].texto], ['par 0', 'da fila', 'par 2']);
  assert.strictEqual(s._unitarias, 1);
});

test('pesquisarWebVarias: fetchAll quebrado → tudo pela cascata; falha total vira {erro}', function () {
  var s = geminiComFetchAll({ fetchAllErro: true });
  var r = s.Gemini.pesquisarWebVarias(['a', 'b']);
  assert.deepStrictEqual([r[0].texto, r[1].texto], ['da fila', 'da fila']);
  var s2 = makeSandbox({}); s2.UrlFetchApp = { fetchAll: function () { throw new Error('x'); }, fetch: function () { throw new Error('x'); } };
  loadGasFile('Gemini.js', s2);
  assert.ok(s2.Gemini.pesquisarWebVarias(['a', 'b'])[0].erro, 'sem chave nenhuma: devolve erro, não lança');
});

test('Briefing.coletar: locais, nacionais e tempo vão numa chamada só quando há pesquisarWebVarias', function () {
  var s = briefing();
  var lotes = [];
  s.Gemini = { pesquisarWebVarias: function (qs) { lotes.push([...qs]); return qs.map(function (q, i) { return { texto: 'T' + i, fontes: ['f'] }; }); },
               pesquisarWeb: function () { throw new Error('não devia usar a fila'); } };
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function () { return []; } }; } };
  var it = s.Briefing.intencoes('Bom dia. panorama da manha: manchetes do Brasil e do mundo, minha agenda de hoje e a previsao do tempo para Belo Horizonte');
  var f = s.Briefing.coletar(it, new Date(Date.UTC(2026, 9, 6, 11, 30)));
  assert.strictEqual(lotes.length, 1);
  assert.strictEqual(lotes[0].length, 3);
  assert.match(lotes[0][0], /notícias locais/); assert.match(lotes[0][1], /Brasil e do mundo/); assert.match(lotes[0][2], /Previsão do tempo/);
  assert.deepStrictEqual([f.locais, f.noticias, f.tempo], ['T0', 'T1', 'T2']);
});

test('Briefing.coletar: uma pesquisa com {erro} marca só a sua fonte', function () {
  var s = briefing();
  s.Gemini = { pesquisarWebVarias: function (qs) { return qs.map(function (q, i) { return i === 1 ? { erro: 'cota' } : { texto: 'ok', fontes: [] }; }); } };
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function () { return []; } }; } };
  var it = s.Briefing.intencoes('Bom dia. panorama da manha: manchetes do Brasil e do mundo, minha agenda de hoje e a previsao do tempo para Belo Horizonte');
  var f = s.Briefing.coletar(it, new Date(Date.UTC(2026, 9, 6, 11, 30)));
  assert.strictEqual(f.locais, 'ok'); assert.strictEqual(f.noticias, null); assert.strictEqual(f.noticiasErro, 'cota'); assert.strictEqual(f.tempo, 'ok');
});

test('Relógio: "qual é o dia de hoje e quantas horas" traz data E hora (04/10: só vinha a data)', function () {
  var s = code({});
  var f = s._interpretarFatoVoz('qual é o dia de hoje e quantas horas');
  assert.strictEqual(f.via, 'relogio'); assert.strictEqual(f.hora, true); assert.strictEqual(f.data, true);
  assert.strictEqual(s._interpretarFatoVoz('quantas horas são').hora, true);
  assert.strictEqual(s._interpretarFatoVoz('quantas horas eu trabalhei hoje'), null, 'não é o relógio');
  assert.strictEqual(s._interpretarFatoVoz('que horas eu bato o ponto'), null);
});

test('Heartbeat: gatilho DIÁRIO presente mas parado é recriado, uma vez por dia (07/10: insight 38 h sem bater)', function () {
  var velho = String(Date.now() - 38 * 3600000);
  var s = makeSandbox({ props: { CURADORIA_HORA: '5', HB_insight: velho, HB_agenda: String(Date.now()), HB_alertasVoz: String(Date.now()) } });
  var apagados = 0, criados = [];
  var trig = { getHandlerFunction: function () { return 'jobInsightDiario'; } };
  s.ScriptApp = {
    getProjectTriggers: function () { return apagados ? [] : [trig]; },
    deleteTrigger: function () { apagados++; },
    newTrigger: function (h) { var b = { timeBased: function () { return b; }, everyDays: function () { return b; }, atHour: function (x) { criados.push([h, x]); return b; }, everyMinutes: function () { return b; }, create: function () {} }; return b; }
  };
  s._avisarDono = function () {};
  loadGasFile('Heartbeat.js', s);
  var r = s.Heartbeat.verificarEAlertar();
  assert.strictEqual(apagados, 1);
  assert.deepStrictEqual(criados.map(function (c) { return [...c]; }), [['jobInsightDiario', 5]]);
  assert.strictEqual(r.avisados[0].rearmou, true);
  // segunda verificação no mesmo dia: não recria de novo
  apagados = 0; criados.length = 0;
  s.ScriptApp.getProjectTriggers = function () { return [trig]; };
  s.CacheService.getScriptCache().put('x', 'y');   // garante que o cache de teste funciona
  s.Heartbeat.verificarEAlertar();
  assert.strictEqual(apagados, 0, 'no máximo 1x por dia');
});
