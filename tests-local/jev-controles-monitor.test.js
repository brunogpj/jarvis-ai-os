// jev-controles-monitor.test.js — controles do celular no roteador semântico e triagem JEV do monitor de Gmail (14/10/2026). JEV simulado.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DONO = 'dono@exemplo.com';
function jev(intencao, conf, extras) {
  var ans = { intencao: { type: 'choice', choice: intencao, confidence: conf, probabilities: {} } };
  Object.keys(extras || {}).forEach(function (k) { ans[k] = { type: 'choice', choice: extras[k], confidence: 0.9, probabilities: {} }; });
  ans.financas = { type: 'noul', noul: 0.02 };
  return { code: 200, body: { answers: ans } };
}
function sbCtl(resposta, props, retornoCtl) {
  var s = makeSandbox({ props: Object.assign({ TYPESAFE_API_KEY: 'k', OWNER_EMAIL: DONO }, props || {}),
    fetch: function (url) { return /typesafe/.test(url) ? resposta : { code: 404, body: {} }; } });
  s.__cmds = [];
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s); loadGasFile('Code.js', s);
  s.Jarvis.controlarDispositivo = function (a) { s.__cmds.push(JSON.parse(JSON.stringify(a))); return retornoCtl || { status: 'success' }; };
  s.Jarvis.registrarEvento = function () {};
  return s;
}
var voz = { canal: 'voz' };

test('Controles: paráfrase vira o MESMO comando da regex (pausar, tocar, próxima, anterior, lanterna, não perturbe)', function () {
  var casos = [
    ['midia_pausar', { acao: 'midia', comando: 'pausar' }, /Pausando a mídia/], ['midia_tocar', { acao: 'midia', comando: 'tocar' }, /Retomando a mídia/],
    ['midia_proxima', { acao: 'midia', comando: 'proxima' }, /Próxima faixa/], ['midia_anterior', { acao: 'midia', comando: 'anterior' }, /faixa anterior/],
    ['lanterna', { acao: 'lanterna' }, /lanterna/], ['naoperturbe_ligar', { acao: 'naoperturbe', estado: 'on' }, /Não perturbe ativado/],
    ['naoperturbe_desligar', { acao: 'naoperturbe', estado: 'off' }, /Não perturbe desativado/]
  ];
  casos.forEach(function (c) {
    var s = sbCtl(jev(c[0], 0.93));
    var r = s._rotaSemantica('uma paráfrase qualquer', DONO, true, voz);
    assert.match(String(r), c[2], c[0]);
    assert.deepStrictEqual(s.__cmds, [c[1]], c[0]);
  });
});

test('Controles: volume leva o nível escolhido; nível indefinido não age (o modelo pergunta)', function () {
  var s = sbCtl(jev('volume', 0.92, { nivel_volume: 'baixo' }));
  assert.match(String(s._rotaSemantica('tá alto demais', DONO, true, voz)), /Volume baixo/);
  assert.deepStrictEqual(s.__cmds, [{ acao: 'volume', nivel: 'baixo' }]);
  var m = sbCtl(jev('volume', 0.92, { nivel_volume: 'mudo' }));
  assert.match(String(m._rotaSemantica('cala o celular', DONO, true, voz)), /Volume no mudo/);
  var i = sbCtl(jev('volume', 0.92, { nivel_volume: 'indefinido' }));
  assert.strictEqual(i._rotaSemantica('mexe no volume', DONO, true, voz), null);
  assert.strictEqual(i.__cmds.length, 0);
});

test('Controles: ação exige 0,85 (a 0,80 não age), só por voz, e o interruptor ROTA_JEV_NOVAS=nao desliga', function () {
  var baixo = sbCtl(jev('midia_pausar', 0.80));
  assert.strictEqual(baixo._rotaSemantica('talvez pausar', DONO, true, voz), null);
  assert.strictEqual(baixo.__cmds.length, 0);
  var chat = sbCtl(jev('midia_pausar', 0.95));
  assert.strictEqual(chat._rotaSemantica('pausa', DONO, true, {}), null, 'no chat o dono não está com o celular');
  assert.strictEqual(chat.__cmds.length, 0);
  var off = sbCtl(jev('lanterna', 0.95), { ROTA_JEV_NOVAS: 'nao' });
  assert.strictEqual(off._rotaSemantica('luz', DONO, true, voz), null);
  assert.strictEqual(off.__cmds.length, 0);
});

test('Controles: macro/celular falhou → diz que não conseguiu, em vez de afirmar que fez', function () {
  var s = sbCtl(jev('lanterna', 0.95), {}, { status: 'error', erro: 'fila cheia' });
  assert.match(String(s._rotaSemantica('acende a luz', DONO, true, voz)), /Não consegui agora: fila cheia/);
});

// ── triagem do monitor de Gmail ────────────────────────────────────────────────────────
function sbMon(probs, props, semChave) {
  var s = makeSandbox({ props: Object.assign(semChave ? {} : { TYPESAFE_API_KEY: 'k' }, props || {}),
    fetch: function (url, params) {
      s._jev = (s._jev || 0) + 1;
      var q = JSON.parse(params.payload).questions, ans = {};
      Object.keys(q).forEach(function (k) { ans[k] = { type: 'noul', noul: probs[k] != null ? probs[k] : 0.9 }; });
      return { code: 200, body: { answers: ans } };
    } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Monitor.js', s);
  return s;
}
var EMAILS = [{ de: 'Banco X <av@banco.exemplo>', assunto: 'Seu boleto vence amanhã', trecho: 'O boleto de R$ 200 vence amanhã.' },
              { de: 'Loja Y <promo@loja.exemplo>', assunto: 'Só hoje: 50% OFF', trecho: 'Aproveite as ofertas imperdíveis!' },
              { de: 'Carla <carla@exemplo.com>', assunto: 'Relatório', trecho: 'Pode me mandar o relatório até sexta?' }];
var CFG = { acao: 'Resuma cada e-mail e destaque se exige ação minha.' };

test('Triagem Gmail: descarta só o ruído (JEV ≤ 0,15) e mantém o resto, na ordem', function () {
  var s = sbMon({ e1: 0.97, e2: 0.03, e3: 0.88 });
  var r = s.Monitor.triar(EMAILS, CFG);
  assert.strictEqual(r.relevantes.map(function (n) { return n.assunto; }).join('|'), 'Seu boleto vence amanhã|Relatório');
  assert.strictEqual(r.descartados.length, 1);
  assert.strictEqual(r.descartados[0].assunto, 'Só hoje: 50% OFF');
  assert.strictEqual(s._jev, 1, 'uma requisição para todos os e-mails');
});

test('Triagem Gmail: na dúvida (0,16 a 0,5) avisa; o objetivo do monitor e cada e-mail vão no estado', function () {
  var corpo;
  var s = makeSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function (u, p) { corpo = JSON.parse(p.payload); return { code: 200, body: { answers: { e1: { type: 'noul', noul: 0.30 }, e2: { type: 'noul', noul: 0.16 }, e3: { type: 'noul', noul: 0.9 } } } }; } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Monitor.js', s);
  assert.strictEqual(s.Monitor.triar(EMAILS, CFG).descartados.length, 0);
  assert.strictEqual(corpo.state.objetivo_do_monitor, CFG.acao);
  assert.strictEqual(corpo.state.email_2.assunto, 'Só hoje: 50% OFF');
  assert.match(corpo.questions.e1.instructions, /`email_1`/);
});

test('Triagem Gmail: sem chave, erro de rede, interruptor off ou JEV sem resposta → nada é descartado', function () {
  assert.strictEqual(sbMon({ e2: 0.0 }, {}, true).Monitor.triar(EMAILS, CFG).descartados.length, 0);
  assert.strictEqual(sbMon({ e1: 0, e2: 0, e3: 0 }, { MONITOR_GMAIL_JEV: 'nao' }).Monitor.triar(EMAILS, CFG).descartados.length, 0);
  var caiu = makeSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return { code: 500, body: {} }; } });
  loadGasFile('TypeSafe.js', caiu); loadGasFile('Monitor.js', caiu);
  var r = caiu.Monitor.triar(EMAILS, CFG);
  assert.strictEqual(r.relevantes.length, 3);
  assert.strictEqual(r.descartados.length, 0);
});

test('Monitor Gmail: tudo ruído → nem chama o Gemini nem notifica, mas avança o corte de tempo', function () {
  var s = sbMon({ e1: 0.02, e2: 0.02 }, { OWNER_EMAIL: DONO, GMAIL_MONITOR: JSON.stringify({ ativo: true, query: 'is:unread', acao: CFG.acao, ultimaVerificacao: 1000 }) });
  var agora = Date.now();
  s.GmailApp = { search: function () { return [1, 2].map(function (i) { return { getFirstMessageSubject: function () { return 'Promo ' + i; },
    getMessages: function () { return [{ getDate: function () { return new Date(agora); }, getFrom: function () { return 'x@loja.exemplo'; }, getPlainBody: function () { return 'ofertas imperdíveis'; } }]; } }; }); } };
  var perguntou = 0, avisou = 0;
  s.Jarvis = { ask: function () { perguntou++; return 'resumo'; }, registrarEvento: function () {} };
  s._avisarDono = function () { avisou++; };
  s.Monitor.verificar(false);
  assert.strictEqual(perguntou, 0, 'Gemini poupado');
  assert.strictEqual(avisou, 0, 'sem notificação de ruído');
  assert.ok(JSON.parse(s.PropertiesService.getScriptProperties().getProperty('GMAIL_MONITOR')).ultimaVerificacao > 1000, 'o corte avança, senão reprocessa para sempre');
});
