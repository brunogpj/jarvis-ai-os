// jev-caderneta.test.js — o JEV (TypeSafe) passa a rotear as perguntas da caderneta, a folga, o repetir-briefing e a rota,
// e a rede de segurança impede o Gemini de inventar número financeiro (14/10/2026). JEV simulado: nada de rede.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 480.5, aPagar: 645.53,
  obrigacoes: [{ nome: 'Fatura Itaú Click', tipo: 'fatura', dia: 19, valor: 387.57, pago: false, outroPaga: false }],
  orcamentos: [], mercado: { total: 960.59, noVoucher: 960.59, outros: 0, n: 10 },
  investimentos: { total: 31477.82, liquidezDiaria: 25259.91 }, reservaMeses: 11.48
};

/** JEV simulado: escolhe `intencao` com `conf`; extras = respostas das perguntas de argumento; pFin = noul da rede de segurança. */
function jev(intencao, conf, extras, pFin) {
  var ans = { intencao: { type: 'choice', choice: intencao, confidence: conf, probabilities: {} } };
  Object.keys(extras || {}).forEach(function (k) { ans[k] = { type: 'choice', choice: extras[k], confidence: 0.9, probabilities: {} }; });
  ans.financas = { type: 'noul', noul: pFin == null ? 0.05 : pFin };
  return { code: 200, body: { model: 'jev-x', answers: ans } };
}

function sandbox(resposta, props) {
  var s = makeSandbox({ props: Object.assign({ TYPESAFE_API_KEY: 'k', OWNER_EMAIL: 'dono@exemplo.com', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) }, props || {}),
                        fetch: function (url, params) {
                          if (/api\.typesafe\.ai/.test(url)) { s.__corpoJev = JSON.parse(params.payload); return typeof resposta === 'function' ? resposta() : resposta; }
                          if (/caderneta/.test(url)) return { code: 200, body: DADOS };
                          return { code: 404, body: {} };
                        } });
  s.__cmds = [];
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Financas.js', s); loadGasFile('Code.js', s);
  s.Utilities.formatDate = function (d, tz, p) { var x = new Date(d.getTime() - 3 * 3600e3), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(p).replace('yyyy', x.getUTCFullYear()).replace('MM', z(x.getUTCMonth() + 1)).replace('dd', z(x.getUTCDate())).replace(/^H$/, String(x.getUTCHours())).replace(/^m$/, String(x.getUTCMinutes())).replace(/^u$/, String(x.getUTCDay() || 7)); };
  s.Jarvis.controlarDispositivo = function (a) { s.__cmds.push(a); return { status: 'success' }; };
  s.Jarvis.registrarEvento = function (e) { (s.__eventos = s.__eventos || []).push(e); };
  return s;
}
var DONO = 'dono@exemplo.com';

test('JEV → caderneta: "dá pra gastar quanto hoje?" vira a resposta determinística de livre hoje', function () {
  var s = sandbox(jev('cad_livre', 0.91, { periodo_livre: 'agora' }));
  var r = s._rotaSemantica('dá pra gastar quanto hoje', DONO, true, { canal: 'voz' });
  assert.match(r, /R\$ 117,18 livres na conta hoje/);
  assert.strictEqual(s._ROTA_ULTIMA, 'cad_livre');
});

test('JEV → caderneta: cada intenção chama o handler certo, com o argumento escolhido', function () {
  var casos = [
    [jev('cad_livre', 0.9, { periodo_livre: 'fim_mes' }), /previsão para o fim do mês é de R\$ 480,50/],
    [jev('cad_vencimentos', 0.9, { periodo_venc: 'semana' }), /Fatura Itaú Click, dia 19/],
    [jev('cad_falta_pagar', 0.9), /Faltam pagar R\$ 387,57/],
    [jev('cad_mercado', 0.9), /R\$ 960,59 com mercado e alimentação/],
    [jev('cad_investido', 0.9, { foco_invest: 'investido' }), /R\$ 31\.477,82 investidos/],
    [jev('cad_investido', 0.9, { foco_invest: 'reserva' }), /Sua reserva com resgate diário/]
  ];
  casos.forEach(function (c) {
    var s = sandbox(c[0]);
    var r = s._rotaSemantica('pergunta qualquer', DONO, true, { canal: 'voz' });
    assert.match(String(r), c[1]);
  });
});

test('JEV → caderneta: leitura exige 0,70; abaixo disso não responde (segue para o fim da cadeia)', function () {
  var s = sandbox(jev('cad_livre', 0.65, { periodo_livre: 'agora' }, 0.30));
  assert.strictEqual(s._rotaSemantica('talvez livre', DONO, true, { canal: 'voz' }), null);
});

test('Rede de segurança: pergunta de dinheiro que ninguém atendeu NÃO vai para o modelo inventar', function () {
  var s = sandbox(jev('nenhuma', 0.95, {}, 0.93));
  var r = s._rotaSemantica('posso comprar um celular de 2 mil reais', DONO, true, { canal: 'voz' });
  assert.match(r, /Ainda não sei responder isso pela caderneta/);
  assert.match(r, /quanto você tem livre/, 'diz o que sabe responder');
  assert.ok(!/\d{2,},\d\d/.test(r), 'e não traz número nenhum');
  assert.strictEqual(s.__eventos.filter(function (e) { return e.tool === 'rota:jev:cad_guarda'; }).length, 1, 'deixa rastro');
});

test('Rede de segurança: abaixo de 0,85 (ou assunto que não é dinheiro) segue para o modelo', function () {
  assert.strictEqual(sandbox(jev('nenhuma', 0.95, {}, 0.60))._rotaSemantica('o que é CDB', DONO, true, { canal: 'voz' }), null);
  assert.strictEqual(sandbox(jev('nenhuma', 0.95, {}, 0.02))._rotaSemantica('conta uma piada', DONO, true, { canal: 'voz' }), null);
});

test('JEV: o Swile continua sendo o Swile (a intenção antiga não foi roubada)', function () {
  var s = sandbox(jev('saldo_swile', 0.92, { carteira: 'voucher' }));
  s.obterSaldoFinanceiro = undefined;
  var r;
  try { r = s._rotaSemantica('quanto tenho no alimentação', DONO, true, { canal: 'voz' }); } catch (e) { r = 'erro'; }
  assert.strictEqual(s._ROTA_ULTIMA, 'saldo_swile');
});

test('JEV → folga do ponto: "hoje é feriado, não trabalho" grava a folga (ação: exige 0,85)', function () {
  var s = sandbox(jev('folga_ponto', 0.93, { dia_folga: 'hoje' }));
  var r = s._rotaSemantica('olha, hoje não tem expediente pra mim', DONO, true, { canal: 'voz' });
  assert.match(r, /hoje é folga/);
  assert.match(s.PropertiesService.getScriptProperties().getProperty('PONTO_FOLGAS'), /^\d{4}-\d{2}-\d{2}$/);
  var s2 = sandbox(jev('folga_ponto', 0.80, { dia_folga: 'hoje' }));
  assert.strictEqual(s2._rotaSemantica('talvez folga', DONO, true, { canal: 'voz' }), null, 'a 0,80 uma ação não age');
  assert.strictEqual(s2.PropertiesService.getScriptProperties().getProperty('PONTO_FOLGAS'), null, 'e não grava nada');
  var s3 = sandbox(jev('folga_ponto', 0.95, { dia_folga: 'ambos' }));
  assert.match(s3._rotaSemantica('hoje e amanhã é feriado', DONO, true, { canal: 'voz' }), /hoje e amanhã é folga/);
});

test('JEV → repetir briefing: só por voz, e usa o guarda-último', function () {
  var s = sandbox(jev('repetir_briefing', 0.92));
  s.PropertiesService.getScriptProperties().setProperty('ULTIMO_BRIEFING', JSON.stringify({ em: Date.now(), tag: 'briefing', texto: 'Boa tarde, Bruno. Notícias do dia, com texto suficiente.' }));
  assert.match(s._rotaSemantica('pet o briefing', DONO, true, { canal: 'voz' }), /repito o briefing em um minuto/);
  var chat = sandbox(jev('repetir_briefing', 0.92));
  assert.strictEqual(chat._rotaSemantica('repete o briefing', DONO, true, {}), null, 'no chat o dono não está ouvindo o celular');
});

test('JEV → navegar: abre a rota com o destino limpo; no chat não abre nada', function () {
  var s = sandbox(jev('navegar', 0.93));
  var r = s._rotaSemantica('para Rua Professor Edésio 105', DONO, true, { canal: 'voz' });
  assert.strictEqual(r, 'Traçando a rota para Rua Professor Edésio 105.');
  assert.deepStrictEqual(s.__cmds.map(function (c) { return [c.acao, c.destino]; }), [['navegar', 'Rua Professor Edésio 105']]);
  var chat = sandbox(jev('navegar', 0.93));
  assert.strictEqual(chat._rotaSemantica('para Rua X 10', DONO, true, {}), null);
  assert.strictEqual(chat.__cmds.length, 0);
  var baixo = sandbox(jev('navegar', 0.80));
  assert.strictEqual(baixo._rotaSemantica('para Rua X 10', DONO, true, { canal: 'voz' }), null, 'ação a 0,80 não abre o mapa');
});

test('_destinoDoPedido: tira só a frase de pedido e deixa o lugar', function () {
  var s = sandbox(jev('nenhuma', 0.9));
  var d = s._destinoDoPedido;
  assert.strictEqual(d('para Rua Professor Edésio 105'), 'Rua Professor Edésio 105');
  assert.strictEqual(d('ir para o Carrefour do Ouro Preto'), 'Carrefour do Ouro Preto');
  assert.strictEqual(d('direções para o trabalho'), 'Trabalho');
  assert.strictEqual(d('me leva pra casa'), 'Casa');
  assert.strictEqual(d('Rua Desembargador Professor Edésio Fernandes'), 'Rua Desembargador Professor Edésio Fernandes', 'endereço sem verbo fica inteiro');
  assert.strictEqual(d('oi'), null);
  assert.strictEqual(d('para'), null);
});

test('diag: o julgamento sai cru e NENHUM handler é executado', function () {
  var s = sandbox(jev('folga_ponto', 0.97, { dia_folga: 'hoje' }, 0.1));
  var j = s._rotaSemantica('hoje é feriado', DONO, true, { diag: true });
  assert.strictEqual(j.intencao, 'folga_ponto');
  assert.strictEqual(j.conf, 0.97);
  assert.strictEqual(j.args.dia_folga, 'hoje');
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('PONTO_FOLGAS'), null, 'diagnóstico não grava');
});

test('a requisição ao JEV continua UMA só e carrega as perguntas novas', function () {
  var chamadas = 0;
  var s = sandbox(function () { chamadas++; return jev('nenhuma', 0.9); });
  s._rotaSemantica('qualquer coisa', DONO, true, { canal: 'voz' });
  assert.strictEqual(chamadas, 1);
  var chaves = Object.keys(s.__corpoJev.questions).sort();
  ['dia_folga', 'financas', 'foco_invest', 'periodo_livre', 'periodo_venc'].forEach(function (k) { assert.ok(chaves.indexOf(k) !== -1, k); });
  ['cad_livre', 'cad_vencimentos', 'cad_falta_pagar', 'cad_mercado', 'cad_investido', 'repetir_briefing', 'folga_ponto', 'navegar', 'nenhuma']
    .forEach(function (k) { assert.ok(s.__corpoJev.questions.intencao.criteria[k], k); });
  assert.strictEqual(s.__corpoJev.questions.financas.type, 'noul');
});

test('Voz: a resposta do JEV da caderneta não vai para o log nem para o histórico', function () {
  var s = sandbox(jev('cad_livre', 0.95, { periodo_livre: 'agora' }), { VOICE_API_TOKEN: 'T', MODO_FALA_VOZ: 'auto' });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  s.Jarvis.ask = function () { return 'LLM não devia ser chamado'; };
  var corpo = s.doPost({ postData: { contents: JSON.stringify({ action: 'voice_command', message: 'tô no azul esse mês?', token: 'T' }) } }).getContentText();
  assert.match(corpo, /117,18/, 'a pessoa ouve o valor');
  var ev = (s.__eventos || []).filter(function (e) { return /^voz:/.test(e.tool) && !/entrega/.test(e.tool); })[0];
  assert.strictEqual(ev.tool, 'voz:jev');
  assert.ok(!/117|\d,\d\d/.test(ev.resumo), 'o log não guarda o valor: ' + ev.resumo);
  assert.match(ev.resumo, /não registrada/);
});

test('Interruptor ROTA_JEV_NOVAS=nao: as intenções novas viram null; as antigas seguem funcionando', function () {
  ['cad_livre', 'cad_mercado', 'folga_ponto', 'navegar', 'repetir_briefing'].forEach(function (i) {
    var s = sandbox(jev(i, 0.99, { dia_folga: 'hoje' }), { ROTA_JEV_NOVAS: 'nao' });
    assert.strictEqual(s._rotaSemantica('frase', DONO, true, { canal: 'voz' }), null, i);
    assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('PONTO_FOLGAS'), null);
    assert.strictEqual(s.__cmds.length, 0);
  });
  var s2 = sandbox(jev('hora_data', 0.95, { relogio: 'hora' }), { ROTA_JEV_NOVAS: 'nao' });
  assert.ok(s2._rotaSemantica('que horas são', DONO, true, { canal: 'voz' }), 'hora_data (antiga) continua ligada');
  // o diagnóstico enxerga as novas mesmo com o interruptor desligado (é assim que se mede antes de ligar)
  var s3 = sandbox(jev('cad_livre', 0.9, { periodo_livre: 'agora' }), { ROTA_JEV_NOVAS: 'nao' });
  assert.strictEqual(s3._rotaSemantica('livre', DONO, true, { diag: true }).intencao, 'cad_livre');
});

test('Cancelar folga: o interpretador devolve remover e nunca vira uma folga nova', function () {
  var s = sandbox(jev('nenhuma', 0.5, {}), {});
  var r = s._interpretarFolgaPonto('cancela a folga de amanhã');
  assert.strictEqual(r.remover, true); assert.strictEqual(r.dias.join(), 'amanha');
  assert.strictEqual(s._interpretarFolgaPonto('amanhã não é mais folga').remover, true);
  assert.strictEqual(s._interpretarFolgaPonto('tira a folga').dias.join(), 'hoje,amanha');
  var n = s._interpretarFolgaPonto('amanhã estou de folga');
  assert.ok(n && !n.remover);
});

test('definirFolgaPonto remover: tira só o dia pedido e responde de acordo', function () {
  var s = sandbox(jev('nenhuma', 0.5, {}), { PONTO_FOLGAS: '2099-01-01,2099-01-02' });
  var r = JSON.parse(JSON.stringify(s.definirFolgaPonto({ dias: ['2099-01-01'], remover: true })));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.folgas.join(), '2099-01-02'); assert.ok(/tirei a folga/.test(r.resumo));
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('PONTO_FOLGAS'), '2099-01-02');
  assert.ok(/Não havia folga/.test(s.definirFolgaPonto({ dias: ['2099-03-03'], remover: true }).resumo));
});
