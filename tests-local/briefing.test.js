// briefing.test.js — briefing com dados reais e trava de agenda inventada (28/09/2026).
// Os briefings da noite de 25/09 e 28/09 saíram sem NENHUMA ferramenta e com agenda inventada.
// Agora o código busca os dados e o modelo só redige notícias.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var ALERTA_NOITE = 'Boa noite, Bruno. Faca o fechamento do dia: o que de mais relevante aconteceu no Brasil e no mundo hoje, destacando o que mudou desde a tarde, e o que ja esta marcado na minha agenda de amanha. Encerre com uma reflexao curta ou um versiculo biblico. Fale de forma corrida e natural, sem listas e sem topicos. REGRAS: use as ferramentas para buscar os dados reais (agenda, tarefas, noticias) antes de falar. Nunca invente compromisso, tarefa ou noticia.';
var ALERTA_MANHA = 'Bom dia, Bruno. Faca o panorama da manha em no maximo dois minutos: as principais manchetes do Brasil e do mundo nas ultimas horas, o que esta na minha agenda e nas minhas tarefas de hoje, e a previsao do tempo para Belo Horizonte. Fale de forma corrida e natural, sem listas e sem topicos. REGRAS: use as ferramentas para buscar os dados reais (agenda, tarefas, noticias) antes de falar.';
var ALERTA_TARDE = 'Resuma meus e-mails não, me dê uma análise das principais notícias do dia, de forma randômica, leia aleatoriamente algum texto bíblico no dia de hoje.';

function briefingSandbox(o) {
  o = o || {};
  var s = makeSandbox({});
  s.Utilities = s.Utilities || {};
  s.Utilities.formatDate = function (d, tz, fmt) {
    var h = o.hora == null ? 21 : o.hora;
    if (fmt === 'H') return String(d && d.__h != null ? d.__h : h);
    if (fmt === 'm') return String(d && d.__m != null ? d.__m : 0);
    if (fmt === 'yyyy-MM-dd') return '2026-09-28';
    if (fmt === 'd') return '28';
    if (fmt === 'M') return '9';
    if (fmt === 'yyyy') return '2026';
    return '';
  };
  s._chamadas = [];
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function () {
    s._chamadas.push('agenda');
    if (o.agendaErro) throw new Error('sem permissao');
    return (o.eventos || []).map(function (e) {
      return { getTitle: function () { return e.t; }, getStartTime: function () { return { __h: e.h, __m: e.m || 0 }; }, isAllDayEvent: function () { return !!e.dia; } };
    });
  } }; } };
  s.Tarefas = { listar: function () { s._chamadas.push('tarefas'); return o.tarefas || []; } };
  s.Gemini = {
    pesquisarWeb: function (q) {
      var tipo = /Previs[aã]o do tempo/i.test(q) ? 'tempo' : (/not[ií]cias locais/i.test(q) ? 'locais' : 'noticias');
      s._chamadas.push('web:' + tipo);
      s._consultas = (s._consultas || []).concat([q]);
      if (o.webErro || (o.webErroNacional && tipo === 'noticias')) throw new Error('cota');
      var txt = { tempo: 'Máxima de 29 graus.', locais: 'Em Contagem, a Via Expressa teve obras.', noticias: 'Fato A. Fato B.' }[tipo];
      return { texto: txt, fontes: ['x — https://a'] };
    },
    gerar: function (p) {
      s._prompt = p; s._chamadas.push('gerar');
      return { json: { candidates: [{ content: { parts: [{ text: o.redacao || 'Hoje o fato A aconteceu. E o fato B também.' }] } }] } };
    }
  };
  s.lerBiblia = function () { s._chamadas.push('biblia'); return { ok: true, ref: 'Salmos 23:1', texto: 'O Senhor é o meu pastor, nada me faltará.' }; };
  loadGasFile('Briefing.js', s);
  return s;
}

test('Briefing.intencoes: os três alertas reais pedem o que dizem pedir (o bloco REGRAS não conta)', function () {
  var s = briefingSandbox();
  var n = s.Briefing.intencoes(ALERTA_NOITE);
  assert.deepStrictEqual([n.agenda, n.periodo, n.tarefas, n.noticias, n.biblia, n.tempo], [true, 'amanha', false, true, true, false]);
  var m = s.Briefing.intencoes(ALERTA_MANHA);
  assert.deepStrictEqual([m.agenda, m.periodo, m.tarefas, m.noticias, m.tempo, m.cidade, m.biblia], [true, 'hoje', true, true, true, 'Belo Horizonte', false]);
  var t = s.Briefing.intencoes(ALERTA_TARDE);
  assert.deepStrictEqual([t.agenda, t.tarefas, t.noticias, t.biblia, t.emails], [false, false, true, true, false]);
});

test('Briefing.fraseAgenda: vazia, com eventos, dia inteiro e erro — nunca inventa', function () {
  var s = briefingSandbox();
  var fh = function (d) { return d.h + 'h'; };
  assert.strictEqual(s.Briefing.fraseAgenda([], 'amanha', null, fh), 'Para amanhã, não há nada marcado na sua agenda.');
  assert.strictEqual(s.Briefing.fraseAgenda([], 'hoje', null, fh), 'Sua agenda de hoje está livre.');
  assert.strictEqual(
    s.Briefing.fraseAgenda([{ titulo: 'Dentista', inicio: { h: 9 } }, { titulo: 'Feriado', diaInteiro: true }], 'amanha', null, fh),
    'Na sua agenda de amanhã: Dentista às 9h e Feriado, o dia todo.');
  assert.strictEqual(s.Briefing.fraseAgenda(null, 'hoje', 'sem permissao', fh), 'Não consegui consultar sua agenda de hoje agora.');
});

test('Briefing.fraseTarefas: nenhuma, vencendo hoje e lista curta', function () {
  var s = briefingSandbox();
  assert.strictEqual(s.Briefing.fraseTarefas([], '2026-09-28'), 'Você não tem tarefas pendentes.');
  assert.strictEqual(
    s.Briefing.fraseTarefas([{ titulo: 'Pagar luz', vencimento: '2026-09-28T00:00:00.000Z' }, { titulo: 'Ler' }], '2026-09-28'),
    'Você tem 2 tarefas pendentes. Para hoje ou atrasadas: Pagar luz.');
  assert.strictEqual(s.Briefing.fraseTarefas([{ titulo: 'Ler' }], '2026-09-28'), 'Você tem uma tarefa pendente: Ler.');
  assert.strictEqual(s.Briefing.fraseTarefas(null, '2026-09-28', 'falhou'), 'Não consegui consultar suas tarefas agora.');
});

test('Briefing.removerFrasesPessoais: corta agenda inventada, mantém notícia com "reunião"', function () {
  var s = briefingSandbox();
  var r = s.Briefing.removerFrasesPessoais('A reunião do G20 terminou hoje. Você tem uma reunião às 10h com o fornecedor. Sua agenda está cheia! O dólar caiu.');
  assert.strictEqual(r, 'A reunião do G20 terminou hoje. O dólar caiu.');
});

test('Briefing.gerar (noite): agenda de amanhã, notícias e versículo; sem tarefas; corta agenda que o modelo inventar', function () {
  var s = briefingSandbox({ hora: 21, eventos: [], redacao: 'O fato A marcou o dia. Você tem uma reunião amanhã às 9h. O fato B veio à tarde.' });
  var r = s.Briefing.gerar({ tag: 'briefing_noite', texto: ALERTA_NOITE });
  assert.deepStrictEqual(s._chamadas.filter(function (c) { return c !== 'gerar'; }).sort(), ['agenda', 'biblia', 'web:locais', 'web:noticias']);
  assert.strictEqual(r.texto.indexOf('Boa noite, Bruno.'), 0, r.texto);
  assert.ok(!/reunião amanhã/.test(r.texto), 'agenda inventada pelo modelo não pode passar');
  assert.match(r.texto, /Para amanhã, não há nada marcado na sua agenda\./);
  assert.match(r.texto, /Para encerrar, Salmos 23:1: O Senhor é o meu pastor/);
  assert.ok(!s._prompt.tools, 'redação sem ferramentas');
  assert.match(s._prompt.systemInstruction.parts[0].text, /Não fale de agenda/);
  assert.strictEqual(r.rastro.agenda, '0 evento(s) amanha');
});

test('Briefing.gerar (manhã): agenda de hoje e tarefas reais entram montadas pelo código', function () {
  var s = briefingSandbox({ hora: 8, eventos: [{ t: 'Consulta', h: 15, m: 30 }], tarefas: [{ titulo: 'Pagar boleto' }] });
  var r = s.Briefing.gerar({ tag: 'briefing_manha', texto: ALERTA_MANHA });
  assert.strictEqual(r.texto.indexOf('Bom dia, Bruno.'), 0);
  assert.match(r.texto, /Na sua agenda de hoje: Consulta às 15h30\./);
  assert.match(r.texto, /Você tem uma tarefa pendente: Pagar boleto\./);
  assert.ok(s._chamadas.indexOf('web:tempo') !== -1, 'previsão do tempo foi buscada');
});

test('Briefing.gerar: notícias LOCAIS em pesquisa própria (BH, região e MG) e vêm ANTES das nacionais', function () {
  var s = briefingSandbox({ hora: 8 });
  var r = s.Briefing.gerar({ tag: 'briefing_manha', texto: ALERTA_MANHA });
  var qLocal = s._consultas.filter(function (q) { return /not[ií]cias locais/i.test(q); })[0];
  assert.ok(qLocal, 'fez a pesquisa local');
  assert.match(qLocal, /Belo Horizonte/); assert.match(qLocal, /Contagem/); assert.match(qLocal, /Minas Gerais/);
  var u = s._prompt.contents[0].parts[0].text;
  assert.ok(u.indexOf('[NOTÍCIAS LOCAIS') !== -1 && u.indexOf('[NOTÍCIAS LOCAIS') < u.indexOf('[NOTÍCIAS DO BRASIL'), 'bloco local primeiro');
  assert.match(s._prompt.systemInstruction.parts[0].text, /COMECE por elas/);
  assert.strictEqual(r.rastro.locais, '1 fonte(s)');
});

test('Briefing.gerar: só a pesquisa nacional falhou → segue com as locais, sem aviso de falha', function () {
  var s = briefingSandbox({ hora: 13, webErroNacional: true });
  var r = s.Briefing.gerar({ tag: 'briefing', texto: ALERTA_TARDE });
  assert.ok(s._chamadas.indexOf('gerar') !== -1);
  assert.ok(!/Não consegui buscar as notícias/.test(r.texto), r.texto);
});

test('Briefing.gerar: pesquisa falhou → diz que não conseguiu, não inventa notícia', function () {
  var s = briefingSandbox({ hora: 13, webErro: true });
  var r = s.Briefing.gerar({ tag: 'briefing', texto: ALERTA_TARDE });
  assert.ok(s._chamadas.indexOf('gerar') === -1, 'sem fatos, o modelo nem é chamado');
  assert.strictEqual(r.texto, 'Boa tarde, Bruno. Não consegui buscar as notícias agora. Para encerrar, Salmos 23:1: O Senhor é o meu pastor, nada me faltará.');
});

test('Briefing.tirarSaudacao: tira a saudação que o modelo repete (ensaio de 28/09)', function () {
  var s = briefingSandbox();
  assert.strictEqual(s.Briefing.tirarSaudacao('Bruno, boa noite. Hoje, no Brasil, uma pesquisa saiu.'), 'Hoje, no Brasil, uma pesquisa saiu.');
  assert.strictEqual(s.Briefing.tirarSaudacao('Boa noite, Bruno! O dólar caiu.'), 'O dólar caiu.');
  assert.strictEqual(s.Briefing.tirarSaudacao('Olá, Bruno. O dólar caiu.'), 'O dólar caiu.');
  assert.strictEqual(s.Briefing.tirarSaudacao('O dólar caiu, boa noite para quem vendeu.'), 'O dólar caiu, boa noite para quem vendeu.');
});

test('Briefing: todo versículo da lista de reflexão é entendido pelo parser da Bíblia', function () {
  var b = briefingSandbox();
  var c = loadGasFile('Code.js', makeSandbox({}));
  b.Briefing.VERSICULOS_REFLEXAO.forEach(function (ref) {
    var r = c._interpretarBiblia('versículo ' + ref);
    assert.ok(r && r.ver, 'não entendeu: ' + ref);
  });
});

test('Jarvis pós-hook: frase de agenda do dono sem ferramenta de agenda no turno é cortada', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  var f = s.Jarvis._agendaSemFonte;
  var r = f('Bom dia! Você tem uma reunião às 10h com a equipe. O tempo está bom.', []);
  assert.strictEqual(r.cortou, 1);
  assert.strictEqual(r.texto, 'Bom dia! O tempo está bom. Não consultei sua agenda nem suas tarefas agora; se quiser, peça "minha agenda de hoje".');
  var ok = f('Você tem uma reunião às 10h.', [{ tool: 'listarProximosEventos', ok: true }]);
  assert.strictEqual(ok.cortou, 0);
  assert.strictEqual(ok.texto, 'Você tem uma reunião às 10h.');
  assert.strictEqual(f('A reunião do Copom manteve os juros.', []).cortou, 0);
});
