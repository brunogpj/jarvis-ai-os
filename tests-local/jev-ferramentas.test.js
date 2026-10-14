// jev-ferramentas.test.js — pré-filtro semântico de ferramentas (JEV) e sim/não por intenção (14/10/2026). JEV simulado: nada de rede.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

/** JEV simulado: responde cada pergunta pelo id. probs = { agenda: 0.95, ... } (noul); o que não consta vale 0,02. */
function sandboxFerr(probs, props, semChave) {
  var chamadas = 0;
  var s = makeSandbox({
    props: Object.assign(semChave ? {} : { TYPESAFE_API_KEY: 'k' }, props || {}),
    fetch: function (url, params) {
      chamadas++;
      var q = JSON.parse(params.payload).questions, ans = {};
      Object.keys(q).forEach(function (k) { ans[k] = { type: 'noul', noul: probs[k] != null ? probs[k] : 0.02 }; });
      return { code: 200, body: { answers: ans } };
    }
  });
  loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  s._chamadas = function () { return chamadas; };
  return s;
}

test('Pré-filtro: padrão desligado — nenhuma chamada extra, vale a regex', function () {
  var s = sandboxFerr({ agenda: 0.95 });
  var p = s.Jarvis._toolsPermitidas('tenho algo marcado depois do almoço');
  assert.ok(!p.listarProximosEventos, 'sem "agenda/evento/marcar" a regex não abre o calendário');
  assert.strictEqual(s._chamadas(), 0);
});

test('Pré-filtro "adiciona": paráfrase sem palavra-chave ganha a ferramenta que a regex perdeu', function () {
  var s = sandboxFerr({ agenda: 0.95 }, { FERRAMENTAS_JEV: 'adiciona' });
  var p = s.Jarvis._toolsPermitidas('tenho algo marcado depois do almoço');
  assert.ok(p.listarProximosEventos && p.criarEventoCalendar, 'o JEV abriu o grupo da agenda');
  assert.strictEqual(s.Jarvis.ultimoGate().ganhou.map(function (x) { return x.split(' ')[0]; }).join(','), 'agenda');
});

test('Pré-filtro "adiciona": nunca FECHA o que a regex abriu', function () {
  var s = sandboxFerr({ agenda: 0.01 }, { FERRAMENTAS_JEV: 'adiciona' });
  var p = s.Jarvis._toolsPermitidas('o que eu faço hoje de tarde');   // "hoje" abre a agenda por regex
  assert.ok(p.listarProximosEventos);
  assert.strictEqual(s.Jarvis.ultimoGate().perdeu.length, 0);
});

test('Pré-filtro "sim": fecha o grupo que a regex abriu à toa quando o JEV tem certeza de que não precisa', function () {
  var s = sandboxFerr({ agenda: 0.03 }, { FERRAMENTAS_JEV: 'sim' });
  var p = s.Jarvis._toolsPermitidas('me explica o que é inflação hoje em dia');
  assert.ok(!p.listarProximosEventos && !p.criarEventoCalendar, '"hoje" abria o calendário sem ninguém ter pedido');
  assert.ok(p.pesquisarWeb, 'o núcleo nunca sai');
});

test('Pré-filtro "sim": dúvida (acima do limiar de remoção) mantém a ferramenta', function () {
  var s = sandboxFerr({ agenda: 0.30 }, { FERRAMENTAS_JEV: 'sim' });
  assert.ok(s.Jarvis._toolsPermitidas('me explica o que é inflação hoje em dia').listarProximosEventos);
});

test('Pré-filtro: autorizações e skills ficam fora do alcance do JEV (segurança: só regex)', function () {
  var s = sandboxFerr({ autorizacoes: 0.99, skills: 0.99 }, { FERRAMENTAS_JEV: 'sim' });
  var p = s.Jarvis._toolsPermitidas('tem algum pedido pendente de autorizacao');
  assert.ok(p.autorizarPedido, 'a regex abre; o JEV não tem pergunta para esse grupo e não fecha');
  var q = s.Jarvis._toolsPermitidas('faz uma coisa qualquer pra mim agora');
  assert.ok(!q.autorizarPedido && !q.run_dynamic_script, 'e o JEV também não abre');
});

test('Pré-filtro: JEV fora do ar ou sem chave → exatamente a regex', function () {
  var sem = sandboxFerr({ agenda: 0.95 }, { FERRAMENTAS_JEV: 'sim' }, true);
  assert.ok(!sem.Jarvis._toolsPermitidas('tenho algo marcado depois do almoço').listarProximosEventos);
  assert.strictEqual(sem._chamadas(), 0);
  var caiu = makeSandbox({ props: { TYPESAFE_API_KEY: 'k', FERRAMENTAS_JEV: 'sim' }, fetch: function () { return { code: 500, body: {} }; } });
  loadGasFile('TypeSafe.js', caiu); loadGasFile('Jarvis.js', caiu);
  var p = caiu.Jarvis._toolsPermitidas('o que eu faço hoje de tarde');
  assert.ok(p.listarProximosEventos, 'erro HTTP → regex');
  assert.strictEqual(caiu.Jarvis.ultimoGate(), null);
});

test('Pré-filtro: mensagem de uma palavra ("sim") continua liberando tudo, sem chamada', function () {
  var s = sandboxFerr({}, { FERRAMENTAS_JEV: 'sim' });
  assert.strictEqual(s.Jarvis._toolsPermitidas('sim'), null);
  assert.strictEqual(s._chamadas(), 0);
});

test('Pré-filtro: cada domínio da tabela está ligado a um grupo real (renomear ferramenta não deixa pergunta órfã)', function () {
  var s = sandboxFerr({}, { FERRAMENTAS_JEV: 'adiciona' });
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'Jarvis.js'), 'utf8');
  var reps = []; var re = /\{ id: '(\w+)', rep: '(\w+)'(?:, reps: \[([^\]]*)\])?/g, m;
  while ((m = re.exec(src))) reps.push({ id: m[1], rep: m[2] });
  assert.ok(reps.length >= 15, 'tabela lida: ' + reps.length);
  var grupoNomes = src.slice(src.indexOf('var grupos = ['), src.indexOf('// Testa cada grupo contra a mensagem normalizada.'));
  reps.forEach(function (d) { assert.ok(grupoNomes.indexOf("'" + d.rep + "'") !== -1, 'domínio ' + d.id + ': ferramenta ' + d.rep + ' não está em nenhum grupo'); });
});

// ───────────────────────── sim/não por intenção ─────────────────────────
function sandboxSN(escolha, conf, props) {
  var s = makeSandbox({ props: Object.assign({ TYPESAFE_API_KEY: 'k' }, props || {}) });
  s._jevChamadas = 0;
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (/typesafe/.test(url)) {
      s._jevChamadas++;
      var c = typeof escolha === 'function' ? escolha(JSON.parse(opt.payload).state) : [escolha, conf];
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ answers: { resp: { type: 'choice', choice: c[0], confidence: c[1], probabilities: {} } } }); } };
    }
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
  } };
  loadGasFile('TypeSafe.js', s);
  return s;
}

test('respostaSimNao: "sim" é ação (exige 0,85); "não" é seguro (basta 0,70); dúvida vira "outra"', function () {
  assert.strictEqual(sandboxSN('sim', 0.9).TypeSafe.respostaSimNao('pode mandar bala', 'Registro?').resposta, 'sim');
  assert.strictEqual(sandboxSN('sim', 0.80).TypeSafe.respostaSimNao('hum pode ser', 'Registro?').resposta, 'outra', 'sim a 0,80 não grava');
  assert.strictEqual(sandboxSN('nao', 0.75).TypeSafe.respostaSimNao('melhor não', 'Registro?').resposta, 'nao');
  assert.strictEqual(sandboxSN('nao', 0.60).TypeSafe.respostaSimNao('sei lá', 'Registro?').resposta, 'outra');
  assert.strictEqual(sandboxSN('outra', 0.99).TypeSafe.respostaSimNao('que horas são', 'Registro?').resposta, 'outra');
  assert.strictEqual(sandboxSN('sim', 0.99).TypeSafe.respostaSimNao('x', 'y').bruta, 'sim');
});

test('respostaSimNao: a pergunta do assistente vai como contexto', function () {
  var visto;
  var s = sandboxSN(function (st) { visto = st; return ['sim', 0.95]; });
  s.TypeSafe.respostaSimNao('fechado', 'Marco a fatura como paga?');
  assert.strictEqual(visto.pergunta_do_assistente, 'Marco a fatura como paga?');
  assert.strictEqual(visto.resposta_do_dono, 'fechado');
});

function sandboxFin(escolha, conf, props) {
  var s = sandboxSN(escolha, conf, Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, props || {}));
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : (p === 'd' ? '14' : '2026-10-14')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  var jev = s.UrlFetchApp.fetch;
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (/typesafe/.test(url)) return jev(url, opt);
    if (opt && opt.method === 'post') {
      s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ ok: true, criado: true, mudou: true, removido: 1 }); } };
    }
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 480, aPagar: 0, obrigacoes: [], orcamentos: [], receitas: [], investimentos: { total: 0, itens: [], porCategoria: {} }, metaAlocacao: {} }); } };
  } };
  loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('Caderneta: "manda ver" (a regex não pega) confirma a proposta aberta e grava', function () {
  var s = sandboxFin('sim', 0.95);
  var p = J(s.Financas.conversar('gastei 35 no mercado no débito'));
  assert.ok(/Diga sim ou não/.test(p.resp), p.resp);
  assert.strictEqual(s._posts.length, 0);
  var ok = J(s.Financas.conversar('manda ver'));
  assert.ok(ok && /Registrei/.test(ok.resp), JSON.stringify(ok));
  assert.strictEqual(s._posts.length, 1);
  assert.strictEqual(s._jevChamadas, 1);
});

test('Caderneta: "deixa pra lá, melhor não" cancela pelo JEV; "que horas são" (outra) não grava nem cancela', function () {
  var s = sandboxFin('nao', 0.9);
  s.Financas.conversar('gastei 35 no mercado no débito');
  assert.strictEqual(J(s.Financas.conversar('melhor deixar quieto por enquanto')).resp, 'Certo, não registrei nada.');
  assert.strictEqual(s._posts.length, 0);
  var o = sandboxFin('outra', 0.99);
  o.Financas.conversar('gastei 35 no mercado no débito');
  assert.strictEqual(o.Financas.conversar('que horas são'), null, 'segue o fluxo normal');
  assert.strictEqual(o._posts.length, 0);
});

test('Caderneta: sim a 0,80 NÃO grava dinheiro; regex que já pegou NÃO gasta chamada; desfaz nunca vai ao JEV', function () {
  var s = sandboxFin('sim', 0.80);
  s.Financas.conversar('gastei 35 no mercado no débito');
  s.Financas.conversar('hum quem sabe');
  assert.strictEqual(s._posts.length, 0, 'abaixo de 0,85 não age');
  var r = sandboxFin('sim', 0.99);
  r.Financas.conversar('gastei 35 no mercado no débito');
  r.Financas.conversar('sim');
  assert.strictEqual(r._jevChamadas, 0, '"sim" seco é regex: custo zero');
  var d = sandboxFin('nao', 0.99);
  d.Financas.conversar('gastei 35 no mercado no débito');
  d.Financas.conversar('desfaz');
  assert.strictEqual(d._jevChamadas, 0, '"desfaz" é outro comando');
});

test('Caderneta: CONFIRMA_JEV=nao desliga; frase longa e JEV fora do ar também não mudam nada', function () {
  var off = sandboxFin('sim', 0.99, { CONFIRMA_JEV: 'nao' });
  off.Financas.conversar('gastei 35 no mercado no débito');
  off.Financas.conversar('manda ver');
  assert.strictEqual(off._jevChamadas, 0);
  assert.strictEqual(off._posts.length, 0);
  var longa = sandboxFin('sim', 0.99);
  longa.Financas.conversar('gastei 35 no mercado no débito');
  longa.Financas.conversar('olha eu estava aqui pensando em uma série de coisas diferentes e no fim das contas acho que pode ser que sim talvez');
  assert.strictEqual(longa._jevChamadas, 0, 'mais de 12 palavras não vai ao JEV');
  var sem = sandboxFin('sim', 0.99, {}); sem.PropertiesService.getScriptProperties().deleteProperty('TYPESAFE_API_KEY');
  sem.Financas.conversar('gastei 35 no mercado no débito');
  assert.strictEqual(sem.Financas.conversar('manda ver'), null);
});

test('Pré-filtro: a conversa anterior vai ao JEV (continuidade: "e amanhã?" não pode fechar a agenda)', function () {
  var vistos = [];
  var s = makeSandbox({ props: { TYPESAFE_API_KEY: 'k', FERRAMENTAS_JEV: 'sim' }, fetch: function (url, params) {
    var corpo = JSON.parse(params.payload); vistos.push(corpo);
    var ans = {}; Object.keys(corpo.questions).forEach(function (k) { ans[k] = { type: 'noul', noul: 0.9 }; });
    return { code: 200, body: { answers: ans } };
  } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  var doFiltro = function () { return vistos.filter(function (v) { return v.questions.agenda; }).pop(); };   // ("amanhã" também aciona o portão de agendamento: outra chamada)
  s.Jarvis._toolsPermitidas('e amanhã também', { historico: [{ role: 'user', text: 'o que eu tenho hoje na agenda' }, { role: 'assistant', text: 'Hoje você tem dentista às 15h.' }] });
  assert.match(doFiltro().state.conversa_anterior, /dono: o que eu tenho hoje na agenda | assistente: Hoje você tem dentista/);
  assert.match(doFiltro().questions.agenda.instructions, /continua o assunto da conversa anterior/);
  vistos.length = 0;
  s.Jarvis._toolsPermitidas('e quinta também', {});
  assert.ok(!('conversa_anterior' in doFiltro().state), 'sem histórico, nada de contexto inventado');
});

test('Portão de agendamento: também recebe a conversa anterior ("e amanhã também" não vira alerta de voz por falta de contexto)', function () {
  var vistos = [];
  var s = makeSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function (url, params) {
    var corpo = JSON.parse(params.payload); vistos.push(corpo);
    var ans = {}; Object.keys(corpo.questions).forEach(function (k) { ans[k] = { type: 'noul', noul: 0.02 }; });
    return { code: 200, body: { answers: ans } };
  } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  s.Jarvis._toolsPermitidas('e amanhã também', { historico: [{ role: 'user', text: 'o que eu tenho hoje na agenda' }, { role: 'assistant', text: 'Hoje você tem dentista às 15h.' }] });
  var gate = vistos.filter(function (v) { return v.questions.fala; }).pop();
  assert.match(gate.state.conversa_anterior, /o que eu tenho hoje na agenda/);
  assert.match(gate.questions.fala.instructions, /continuação dela/);
});
