// financas.test.js — Jarvis ouve sobre a caderneta (finanças), fase 1: só leitura. Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 480.5, receita: 4290, saidas: 3800, sobra: 490, aPagar: 645.53, nPendentes: 3,
  obrigacoes: [
    { nome: 'Aluguel', tipo: 'conta', dia: 10, valor: 700, pago: true, outroPaga: false },
    { nome: 'Fatura Passaí', tipo: 'fatura', dia: 13, valor: 257.96, pago: false, outroPaga: false },
    { nome: 'Fatura Itaú Click', tipo: 'fatura', dia: 19, valor: 387.57, pago: false, outroPaga: false },
    { nome: 'Água', tipo: 'conta', dia: 20, valor: 250, pago: false, outroPaga: false },
    { nome: 'Internet', tipo: 'conta', dia: 12, valor: 100, pago: false, outroPaga: true },
    { nome: 'Zerada', tipo: 'conta', dia: 15, valor: 0, pago: false, outroPaga: false },
  ],
  orcamentos: [{ nome: 'Mercado', previsto: 1000, usado: 95.5, resta: 904.5, estourou: false }],
  investimentos: { total: 31477.82, liquidezDiaria: 25259.91, rendimentoAno: 1500, porCategoria: {} },
  reservaMeses: 11.48, patrimonio: 31000, saldoDevedor: 0, usoLimite: 0.3, fechado: false,
};

function sandbox(o) {
  o = o || {};
  var props = Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {});
  var s = makeSandbox({ props: props });
  s._fetches = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    s._fetches.push({ url: url, headers: (opt && opt.headers) || {} });
    if (o.rede) throw new Error('rede caiu');
    var code = o.codigo || 200;
    return { getResponseCode: function () { return code; }, getContentText: function () { return code === 200 ? JSON.stringify(o.dados || DADOS) : '{"erro":"x"}'; } };
  } };
  loadGasFile('Financas.js', s);
  return s;
}

test('Financas.interpretar: as perguntas da caderneta', function () {
  var F = sandbox().Financas;
  var casos = [
    ['quanto tenho livre hoje', 'livre_hoje'], ['qual o meu saldo livre', 'livre_hoje'], ['quanto eu tenho livre na conta', 'livre_hoje'],
    ['quanto vai sobrar no fim do mês', 'livre_fim'], ['qual a previsão de livre no fim do mês', 'livre_fim'], ['quanto fica livre até o fim do mês', 'livre_fim'],
    ['o que vence hoje', 'vencimentos'], ['o que vence amanhã', 'vencimentos'], ['o que vence essa semana', 'vencimentos'],
    ['quanto falta pagar', 'falta_pagar'], ['quais contas eu tenho a pagar', 'falta_pagar'], ['o que eu preciso pagar', 'falta_pagar'],
    ['quanto resta no orçamento do mercado', 'orcamento'], ['quanto eu gastei no mercado', 'orcamento'], ['como está o orçamento', 'orcamento'],
    ['quanto eu tenho investido', 'investido'], ['qual o meu patrimônio', 'investido'], ['quantos meses de reserva eu tenho', 'reserva'],
    ['caderneta', 'ajuda'], ['o que você sabe da caderneta', 'ajuda'],
  ];
  casos.forEach(function (c) { var r = F.interpretar(c[0]); assert.ok(r, c[0]); assert.strictEqual(r.tipo, c[1], c[0]); });
  assert.strictEqual(F.interpretar('o que vence amanhã').periodo, 'amanha');
  assert.strictEqual(F.interpretar('o que vence hoje').periodo, 'hoje');
  assert.strictEqual(F.interpretar('o que vence essa semana').periodo, 'semana');
});

test('Financas.interpretar: NÃO rouba frases do Swile, de ações nem de outros assuntos', function () {
  var F = sandbox().Financas;
  ['qual o meu saldo no voucher', 'quanto tenho no cartão alimentação', 'quanto eu gastei essa semana', 'saldo da mobilidade', 'quanto sobrou no vale',
   'quanto eu tenho', 'que horas são', 'o que eu tenho na agenda hoje', 'tenho uma ideia sobre investimento', 'me dá uma ideia de investimento',
   'gastei 35 reais no mercado', 'paguei o aluguel', 'registra um gasto de 20 reais', 'cria um alerta para pagar a conta', 'cancela o que vence hoje',
   'abre o app do mercado', 'recebi 450 da Luciana', 'apliquei 500 no cofrinho'].forEach(function (f) {
    assert.strictEqual(F.interpretar(f), null, f);
  });
});

test('Financas.falar: livre, previsão e negativo', function () {
  var F = sandbox().Financas;
  assert.strictEqual(F.falar('livre_hoje', DADOS), 'Você tem R$ 117,18 livres na conta hoje. A previsão para o fim do mês é de R$ 480,50.');
  assert.strictEqual(F.falar('livre_hoje', Object.assign({}, DADOS, { livreHoje: -42.9, livreFim: -42.9 })), 'Seu saldo livre está negativo em R$ 42,90 hoje.');
  assert.strictEqual(F.falar('livre_hoje', Object.assign({}, DADOS, { livreHoje: 100, livreFim: -250 })), 'Você tem R$ 100,00 livres na conta hoje. A previsão para o fim do mês é ficar negativo em R$ 250,00.');
  assert.strictEqual(F.falar('livre_fim', DADOS), 'A previsão para o fim do mês é de R$ 480,50 livres. Ainda faltam pagar R$ 645,53.');
  assert.strictEqual(F.falar('livre_hoje', Object.assign({}, DADOS, { livreHoje: 1234567.8, livreFim: 1234567.8 })), 'Você tem R$ 1.234.567,80 livres na conta hoje.');
});

test('Financas.falar: falta pagar — só pendentes reais (sem pagos, sem os de outra pessoa, sem zerados)', function () {
  var F = sandbox().Financas;
  var t = F.falar('falta_pagar', DADOS);
  assert.strictEqual(t, 'Faltam pagar R$ 895,53 este mês, em 3 itens: Fatura Passaí, dia 13, R$ 257,96; Fatura Itaú Click, dia 19, R$ 387,57; Água, dia 20, R$ 250,00.');
  assert.ok(!/Aluguel|Internet|Zerada/.test(t));
  assert.strictEqual(F.falar('falta_pagar', Object.assign({}, DADOS, { obrigacoes: [] })), 'Não há nada pendente de pagar neste mês.');
  var muitos = { obrigacoes: [1, 2, 3, 4, 5, 6].map(function (i) { return { nome: 'C' + i, dia: i, valor: 10, pago: false }; }) };
  assert.match(F.falar('falta_pagar', muitos), /; e mais 2\.$/);
});

test('Financas.falar: vencimentos de hoje, amanhã e da semana (com atrasadas)', function () {
  var F = sandbox().Financas;
  assert.strictEqual(F.falar('vencimentos', DADOS, { periodo: 'hoje' }), 'Nada vence hoje. Atenção, está atrasada: Fatura Passaí, dia 13, R$ 257,96.');
  assert.strictEqual(F.falar('vencimentos', Object.assign({}, DADOS, { hoje: '2026-10-19' }), { periodo: 'hoje' }), 'Hoje vence: Fatura Itaú Click, R$ 387,57. Atenção, está atrasada: Fatura Passaí, dia 13, R$ 257,96.');
  assert.strictEqual(F.falar('vencimentos', Object.assign({}, DADOS, { hoje: '2026-10-18' }), { periodo: 'amanha' }), 'Amanhã vence: Fatura Itaú Click, R$ 387,57.');
  assert.strictEqual(F.falar('vencimentos', DADOS, { periodo: 'semana' }),
    'Nos próximos sete dias vencem: Fatura Itaú Click, dia 19, R$ 387,57; Água, dia 20, R$ 250,00. Atenção, está atrasada: Fatura Passaí, dia 13, R$ 257,96.');
  // virada de mês: dia 30, a semana alcança dias 1–6 do mês seguinte
  var out = F.falar('vencimentos', { hoje: '2026-10-30', obrigacoes: [] }, { periodo: 'semana', proximo: { obrigacoes: [{ nome: 'Aluguel', dia: 5, valor: 700, pago: false }, { nome: 'Luz', dia: 20, valor: 300, pago: false }] } });
  assert.match(out, /Aluguel, dia 5, R\$ 700,00/);
  assert.ok(!/Luz/.test(out));
  // amanhã na virada (dia 31 → dia 1 do mês seguinte)
  assert.match(F.falar('vencimentos', { hoje: '2026-10-31', obrigacoes: [] }, { periodo: 'amanha', proximo: { obrigacoes: [{ nome: 'Condomínio', dia: 1, valor: 200, pago: false }] } }), /Amanhã vence: Condomínio, R\$ 200,00/);
});

test('Financas.falar: orçamento, investido e reserva', function () {
  var F = sandbox().Financas;
  assert.strictEqual(F.falar('orcamento', DADOS), 'No orçamento de Mercado, você usou R$ 95,50 de R$ 1.000,00 e restam R$ 904,50.');
  assert.strictEqual(F.falar('orcamento', Object.assign({}, DADOS, { orcamentos: [{ nome: 'Mercado', previsto: 1000, usado: 1100, resta: 0, estourou: true }] })), 'O orçamento de Mercado estourou: você usou R$ 1.100,00 de R$ 1.000,00.');
  // sem orçamento cadastrado: soma Mercado + Alimentação do mês
  var semOrc = Object.assign({}, DADOS, { orcamentos: [], mercado: { total: 1000, noVoucher: 800, outros: 200, n: 9 } });
  assert.strictEqual(F.falar('orcamento', semOrc), 'Neste mês você gastou R$ 1.000,00 com mercado e alimentação, em 9 lançamentos: R$ 800,00 no voucher e R$ 200,00 em outros meios.');
  assert.strictEqual(F.falar('orcamento', Object.assign({}, semOrc, { mercado: { total: 50, noVoucher: 50, outros: 0, n: 1 } })), 'Neste mês você gastou R$ 50,00 com mercado e alimentação, em 1 lançamento, todos no voucher.');
  assert.strictEqual(F.falar('orcamento', Object.assign({}, semOrc, { mercado: { total: 30, noVoucher: 0, outros: 30, n: 2 } })), 'Neste mês você gastou R$ 30,00 com mercado e alimentação, em 2 lançamentos.');
  assert.strictEqual(F.falar('orcamento', Object.assign({}, semOrc, { mercado: { total: 0, noVoucher: 0, outros: 0, n: 0 } })), 'Ainda não há gastos de mercado ou alimentação lançados neste mês.');
  assert.strictEqual(F.falar('orcamento', Object.assign({}, DADOS, { orcamentos: [] })), 'Ainda não há gastos de mercado ou alimentação lançados neste mês.');
  assert.strictEqual(F.falar('investido', DADOS), 'Você tem R$ 31.477,82 investidos, dos quais R$ 25.259,91 com resgate diário. A reserva cobre cerca de 11,5 meses de gastos.');
  assert.strictEqual(F.falar('reserva', DADOS), 'Sua reserva com resgate diário é de R$ 25.259,91 e cobre cerca de 11,5 meses dos seus gastos.');
  assert.match(F.falar('reserva', Object.assign({}, DADOS, { reservaMeses: null })), /Não consegui calcular a reserva/);
});

test('Financas.responder: chama o Worker com o token, usa cache e trata falhas sem lançar', function () {
  var s = sandbox();
  assert.strictEqual(s.Financas.responder({ tipo: 'livre_hoje' }), 'Você tem R$ 117,18 livres na conta hoje. A previsão para o fim do mês é de R$ 480,50.');
  assert.strictEqual(s._fetches.length, 1);
  assert.strictEqual(s._fetches[0].url, 'https://caderneta.exemplo.dev/api/jarvis/resumo');
  assert.strictEqual(s._fetches[0].headers.Authorization, 'Bearer ' + 'a'.repeat(40));
  s.Financas.responder({ tipo: 'investido' });
  assert.strictEqual(s._fetches.length, 1, 'a segunda pergunta em 60 s sai do cache');
  assert.strictEqual(sandbox({ rede: true }).Financas.responder({ tipo: 'livre_hoje' }), 'Não consegui consultar a caderneta agora.');
  assert.match(sandbox({ codigo: 401 }).Financas.responder({ tipo: 'livre_hoje' }), /recusou o acesso/);
  assert.match(sandbox({ codigo: 503 }).Financas.responder({ tipo: 'livre_hoje' }), /Não consegui consultar/);
  assert.match(sandbox({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } }).Financas.responder({ tipo: 'livre_hoje' }), /ainda não está conectada/);
  assert.strictEqual(sandbox().Financas.responder({ tipo: 'ajuda' }), sandbox().Financas.AJUDA);
});

test('Financas.responder: na virada do mês busca também o mês seguinte', function () {
  var s = sandbox({ dados: { mes: '2026-10', hoje: '2026-10-30', obrigacoes: [] } });
  s.Financas.responder({ tipo: 'vencimentos', periodo: 'semana' });
  assert.strictEqual(s._fetches.length, 2);
  assert.match(s._fetches[1].url, /\?mes=2026-11$/);
  var d = sandbox({ dados: { mes: '2026-12', hoje: '2026-12-29', obrigacoes: [] } });
  d.Financas.responder({ tipo: 'vencimentos', periodo: 'semana' });
  assert.match(d._fetches[1].url, /\?mes=2027-01$/, 'dezembro vira janeiro do ano seguinte');
});

// ───────────── integração com a cadeia de voz e com a rota de configuração ─────────────
function vozSandbox(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ VOICE_API_TOKEN: 'T', OWNER_EMAIL: 'o@x', MODO_FALA_VOZ: 'auto', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'b'.repeat(40) }, o.props || {}) });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  s.UrlFetchApp = { fetch: function () { return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(DADOS); } }; } };
  loadGasFile('Code.js', s);
  loadGasFile('Financas.js', s);
  s.__eventos = []; s.__cmds = []; s.__ask = 0;
  s.Jarvis.registrarEvento = function (e) { s.__eventos.push(e); };
  s.Jarvis.controlarDispositivo = function (a) { s.__cmds.push(a); return { status: 'success' }; };
  s.Jarvis.ask = function () { s.__ask++; return 'LLM'; };
  s.__post = function (corpo) { return s.doPost({ postData: { contents: JSON.stringify(corpo) } }).getContentText(); };
  s.__voz = function (m) { return s.__post({ action: 'voice_command', message: m, token: 'T' }); };
  return s;
}

test('Voz: "quanto tenho livre hoje" responde da caderneta, sem passar pelo modelo e sem gravar o número no log', function () {
  var s = vozSandbox();
  var corpo = s.__voz('quanto eu tenho livre hoje');
  assert.match(corpo, /117,18/);
  assert.strictEqual(s.__ask, 0, 'o modelo não participa');
  var ev = s.__eventos.filter(function (e) { return /^voz:/.test(e.tool) && !/entrega/.test(e.tool); })[0];
  assert.strictEqual(ev.tool, 'voz:caderneta');
  assert.ok(!/\d{2,},\d\d|117/.test(ev.resumo), 'o número falado não vai para o log: ' + ev.resumo);
  assert.match(ev.resumo, /não registrada/);
});

test('Voz: o Swile continua sendo o Swile e a caderneta não rouba o "saldo"', function () {
  var s = vozSandbox();
  s.__voz('qual o meu saldo no voucher');
  var ev = s.__eventos.filter(function (e) { return /^voz:/.test(e.tool) && !/entrega/.test(e.tool); })[0];
  assert.strictEqual(ev.tool, 'voz:financeiro');
  assert.strictEqual(s._preverRotaDeterministica('o que vence amanhã'), 'caderneta');
  assert.strictEqual(s._preverRotaDeterministica('quanto tenho no cartão alimentação'), 'financeiro');
});

test('Voz: sem conexão configurada, diz que não está conectada (e não inventa número)', function () {
  var s = vozSandbox({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } });
  var corpo = s.__voz('quanto falta pagar');
  assert.match(corpo, /ainda não está conectada/);
  assert.strictEqual(s.__ask, 0);
});

test('Voz: a caderneta responde no aparelho (TTS local), sem gerar áudio com número na nuvem', function () {
  var s = vozSandbox();
  s.__voz('o que vence essa semana');
  assert.strictEqual(s.__cmds.filter(function (c) { return c.acao === 'falar'; }).length, 0, 'nada de síntese na nuvem');
});

test('config_financas: grava endereço e token, valida o formato e nunca devolve o token', function () {
  var s = vozSandbox({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } });
  var tok = 'c'.repeat(48);
  var r = JSON.parse(s.__post({ action: 'config_financas', token: 'T', url: 'https://caderneta.exemplo.dev/', api_token: tok }));
  assert.deepStrictEqual({ ok: r.ok, configurado: r.configurado }, { ok: true, configurado: true });
  assert.ok(JSON.stringify(r).indexOf(tok) === -1, 'o token não volta na resposta');
  var p = s.PropertiesService.getScriptProperties();
  assert.strictEqual(p.getProperty('FIN_API_URL'), 'https://caderneta.exemplo.dev', 'sem a barra final');
  assert.strictEqual(p.getProperty('FIN_API_TOKEN'), tok);
  assert.strictEqual(JSON.parse(s.__post({ action: 'config_financas', token: 'ERRADO', url: 'https://x.dev', api_token: tok })).ok, false);
  assert.strictEqual(JSON.parse(s.__post({ action: 'config_financas', token: 'T', url: 'http://x.dev', api_token: tok })).ok, false, 'só https');
  assert.strictEqual(JSON.parse(s.__post({ action: 'config_financas', token: 'T', url: 'https://x.dev', api_token: 'curto' })).ok, false);
  assert.strictEqual(JSON.parse(s.__post({ action: 'config_financas', token: 'T', url: 'https://x.dev', api_token: 'não é válido ' + 'd'.repeat(40) })).ok, false);
});

// ── fase 2: avisos proativos ─────────────────────────────────────────────────────────
function sbAv(o) { var s = sandbox(o); return s; }
test('Avisos da manhã: vence hoje, atrasada, saldo negativo e orçamento a 80% — cada um com a sua chave', function () {
  var s = sbAv();
  var d = JSON.parse(JSON.stringify(DADOS));
  d.hoje = '2026-10-14';
  d.obrigacoes.push({ nome: 'Luz', tipo: 'conta', dia: 14, valor: 180, pago: false, outroPaga: false });
  d.livreFim = -50;
  d.orcamentos = [{ nome: 'Mercado', previsto: 1000, usado: 850, resta: 150, estourou: false }];
  var r = JSON.parse(JSON.stringify(s.Financas.avisos(d, null, 'manha')));
  var chaves = r.map(function (a) { return a.chave; });
  assert.ok(chaves.indexOf('venc_hoje:2026-10-14') !== -1);
  assert.ok(chaves.indexOf('atraso:2026-10:Fatura Passaí') !== -1);
  assert.ok(chaves.indexOf('fim_neg:2026-10') !== -1);
  assert.ok(chaves.indexOf('orc80:2026-10:Mercado') !== -1);
  assert.ok(!chaves.some(function (k) { return /venc_amanha/.test(k); }), 'a janela da manhã não fala de amanhã');
  assert.ok(/Luz, R\$ 180,00/.test(r[0].texto));
});

test('Orçamento estourado vira aviso de 100% (não o de 80%)', function () {
  var s = sbAv();
  var d = JSON.parse(JSON.stringify(DADOS)); d.orcamentos = [{ nome: 'Mercado', previsto: 1000, usado: 1100, resta: 0, estourou: true }];
  var ch = JSON.parse(JSON.stringify(s.Financas.avisos(d, null, 'manha'))).map(function (a) { return a.chave; });
  assert.ok(ch.indexOf('orc100:2026-10:Mercado') !== -1); assert.ok(ch.indexOf('orc80:2026-10:Mercado') === -1);
});

test('Aviso da noite: só o que vence amanhã; na virada do mês olha o mês seguinte', function () {
  var s = sbAv();
  var d = JSON.parse(JSON.stringify(DADOS)); d.hoje = '2026-10-18'; d.obrigacoes.push({ nome: 'Seguro', tipo: 'conta', dia: 19, valor: 90, pago: false, outroPaga: false });
  var r = JSON.parse(JSON.stringify(s.Financas.avisos(d, null, 'noite')));
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].chave, 'venc_amanha:2026-10-19');
  assert.ok(/Seguro/.test(r[0].texto) && /Fatura Itaú Click/.test(r[0].texto));
  var fim = { hoje: '2026-10-31' }; var prox = { obrigacoes: [{ nome: 'Aluguel', dia: 1, valor: 700, pago: false, outroPaga: false }] };
  var r2 = JSON.parse(JSON.stringify(s.Financas.avisos(Object.assign({ obrigacoes: [] }, fim), prox, 'noite')));
  assert.strictEqual(r2[0].chave, 'venc_amanha:2026-11-01');
});

test('Nada pendente, saldo positivo, orçamento folgado → nenhum aviso', function () {
  var s = sbAv();
  var d = { hoje: '2026-10-14', livreHoje: 100, livreFim: 300, obrigacoes: [{ nome: 'Aluguel', dia: 10, valor: 700, pago: true }], orcamentos: [{ nome: 'Mercado', previsto: 1000, usado: 100 }] };
  assert.strictEqual(s.Financas.avisos(d, null, 'manha').length, 0);
  assert.strictEqual(s.Financas.avisos(null, null, 'manha').length, 0);
});

function sbVerif(o) {
  var s = sandbox(o);
  s.Utilities.formatDate = function (dt, tz, fmt) { return fmt === 'H' ? String((o && o.hora) == null ? 9 : o.hora) : (fmt === 'd' ? '14' : '2026-10-14'); };
  s._avisos = [];
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
test('verificarAvisos: manda uma vez por janela e não repete no tick seguinte; log sem valores', function () {
  var s = sbVerif({ hora: 9 });
  var r1 = JSON.parse(JSON.stringify(s.Financas.verificarAvisos()));
  assert.strictEqual(r1.ok, true); assert.ok(r1.enviados >= 1, 'deveria ter avisado a fatura atrasada');
  assert.strictEqual(s._avisos.length, 1);
  assert.ok(!/\d/.test(s._avisos[0].logResumo.replace(/\d+ aviso/, '')), 'o log não leva número financeiro');
  var r2 = JSON.parse(JSON.stringify(s.Financas.verificarAvisos()));
  assert.strictEqual(r2.pulou, 'janela já verificada'); assert.strictEqual(s._avisos.length, 1);
});
test('verificarAvisos: fora da janela não consulta a rede; desligado não envia; ensaio não grava', function () {
  var s = sbVerif({ hora: 14 });
  assert.strictEqual(JSON.parse(JSON.stringify(s.Financas.verificarAvisos())).pulou, 'fora da janela'); assert.strictEqual(s._fetches.length, 0);
  var off = sbVerif({ hora: 9, props: { FIN_AVISOS_ATIVO: 'nao' } });
  assert.strictEqual(JSON.parse(JSON.stringify(off.Financas.verificarAvisos())).pulou, 'desligado'); assert.strictEqual(off._avisos.length, 0);
  var en = sbVerif({ hora: 9 });
  var r = JSON.parse(JSON.stringify(en.Financas.verificarAvisos({ ensaio: true, janela: 'manha' })));
  assert.ok(r.avisos.length >= 1); assert.strictEqual(en._avisos.length, 0);
  assert.strictEqual(JSON.parse(JSON.stringify(en.Financas.verificarAvisos({ ensaio: true, janela: 'manha' }))).avisos.length, r.avisos.length, 'ensaio repetido dá o mesmo');
});

test('"supermercado" vai para a caderneta (orçamento do mercado), não para o Swile', function () {
  var s = sandbox();
  ['como estão os gastos de supermercado', 'quanto gastei no supermercado', 'quanto eu gastei no supermercado esse mês', 'como está o orçamento do supermercado', 'quais os gastos do mercado'].forEach(function (f) {
    var r = s.Financas.interpretar(f);
    assert.ok(r && r.tipo === 'orcamento', f + ' → ' + JSON.stringify(r));
  });
  assert.strictEqual(s.Financas.interpretar('quanto tem de saldo do vale do supermercado'), null, 'vale = Swile');
});

test('verificarAvisos teste: entrega um aviso rotulado como teste, com dados inventados, sem tocar na caderneta nem gravar chave', function () {
  var s = sbVerif({ hora: 9 });
  var r = JSON.parse(JSON.stringify(s.Financas.verificarAvisos({ teste: true })));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.teste, true);
  assert.strictEqual(s._avisos.length, 1);
  assert.ok(/^Teste do aviso da caderneta\./.test(s._avisos[0].falar) && /Conta de teste/.test(s._avisos[0].falar));
  assert.strictEqual(s._fetches.length, 0, 'não consultou a caderneta');
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('FIN_AVISOS'), null);
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('FIN_AVISOS_JANELA'), null);
});
