// consultor-aviso.test.js — aviso proativo mensal do consultor (quanto dá para aportar e onde) e o registro do aporte por voz (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function dados(o) {
  return Object.assign({
    mes: '2026-10', hoje: '2026-10-14', livreHoje: 900, livreFim: 1500, aPagar: 300, obrigacoes: [],
    receitas: [{ chave: 'r:sal', nome: 'Salário', valor: 3840, recebido: true }],
    investimentos: { total: 31477.82, liquidezDiaria: 25259.91, itens: [],
      porCategoria: { 'Renda fixa': 20759.91, 'Liquidez/Reserva': 4500, 'Tesouro Direto': 3986.36, 'FIIs': 2231.55 } },
    metaAlocacao: { 'Renda fixa': 60, 'Tesouro Direto': 20, 'FIIs': 15, 'Liquidez/Reserva': 5 }, reservaMeses: 11.48
  }, o || {});
}

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  var dia = o.dia || '2026-10-14', hora = o.hora == null ? 10 : o.hora;
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? dia : (p === 'H' ? String(hora) : (p === 'yyyy' ? dia.slice(0, 4) : (p === 'd' ? dia.slice(8) : dia))); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = []; s._avisos = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') { s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) }); if (o.rede) throw new Error('rede caiu'); return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"ok":true,"criado":true,"removido":1}'; } }; }
    if (o.rede) throw new Error('rede caiu');
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(o.dados || dados()); } };
  } };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var prop = function (s, k) { return s.PropertiesService.getScriptProperties().getProperty(k); };

test('plano: quanto dá e onde (sem vender), com as partes ordenadas; sem sobra devolve ok:false', function () {
  var s = sb();
  var p = J(s.Consultor.plano(dados(), s.Consultor.cfg(), '2026-10-14'));
  assert.strictEqual(p.ok, true); assert.strictEqual(p.pode, 1200);
  assert.ok(p.partes.length >= 1 && p.partes.every(function (x) { return x.valor > 0; }));
  assert.ok(Math.abs(p.partes.reduce(function (t, x) { return t + x.valor; }, 0) - 1200) < 0.005);
  assert.ok(p.partes[0].valor >= p.partes[p.partes.length - 1].valor, 'maior primeiro');
  assert.ok(!p.partes.some(function (x) { return x.cat === 'Renda fixa'; }), 'categoria acima do alvo não recebe');
  assert.strictEqual(J(s.Consultor.plano(dados({ livreFim: 200 }), s.Consultor.cfg(), '2026-10-14')).ok, false);
});

test('aviso mensal: livre previsto acima da margem → notifica E fala o MESMO texto (quanto e onde) e guarda a sugestão', function () {
  var s = sb();
  var r = J(s.Consultor.verificarAporte());
  assert.strictEqual(r.avisou, true);
  assert.strictEqual(s._avisos.length, 1);
  var a = s._avisos[0];
  assert.strictEqual(a.falar, a.texto); assert.strictEqual(a.falarLocal, true);
  assert.ok(/dá para aportar até R\$ 1\.200,00/.test(a.texto) && /Para chegar ao alvo sem vender nada: /.test(a.texto) && /Quando aportar, diga: aportei\.$/.test(a.texto), a.texto);
  assert.ok(!/\d/.test(a.logResumo), 'o log não leva valor');
  var sug = J(s.Consultor.sugestaoAporte());
  assert.strictEqual(sug.valor, 1200); assert.ok(sug.partes.length >= 1);
  assert.strictEqual(prop(s, 'CONSULTOR_AVISO_MES'), '2026-10');
});

test('aviso mensal: só UMA vez por mês; no mês seguinte avisa de novo', function () {
  var s = sb();
  s.Consultor.verificarAporte();
  assert.strictEqual(J(s.Consultor.verificarAporte()).pulou, 'já avisou este mês');
  assert.strictEqual(s._avisos.length, 1);
  var nov = sb({ dia: '2026-11-10', props: { CONSULTOR_AVISO_MES: '2026-10' }, dados: dados({ mes: '2026-11', hoje: '2026-11-10' }) });
  assert.strictEqual(J(nov.Consultor.verificarAporte()).avisou, true);
});

test('aviso mensal: não avisa quando não sobra o suficiente, fora da janela, desligado, ou sem a receita fixa recebida (antes do dia 20)', function () {
  assert.strictEqual(J(sb({ dados: dados({ livreFim: 350 }) }).Consultor.verificarAporte()).pulou, 'não sobra o suficiente');
  assert.strictEqual(J(sb({ dados: dados({ livreFim: 380 }), props: { CONSULTOR_AVISO_MIN: '100' } }).Consultor.verificarAporte()).pulou, 'não sobra o suficiente', 'sobram R$ 80, abaixo do mínimo de R$ 100');
  assert.strictEqual(J(sb({ hora: 7 }).Consultor.verificarAporte()).pulou, 'fora da janela');
  assert.strictEqual(J(sb({ hora: 21 }).Consultor.verificarAporte()).pulou, 'fora da janela');
  assert.strictEqual(J(sb({ props: { CONSULTOR_AVISO_ATIVO: 'nao' } }).Consultor.verificarAporte()).pulou, 'desligado');
  var semSal = dados({ receitas: [{ chave: 'r:sal', nome: 'Salário', valor: 3840, recebido: false }] });
  var s1 = sb({ dados: semSal });
  assert.ok(/receita fixa ainda não recebida/.test(J(s1.Consultor.verificarAporte()).pulou)); assert.strictEqual(s1._avisos.length, 0);
  var s2 = sb({ dados: semSal, dia: '2026-10-20' });
  assert.strictEqual(J(s2.Consultor.verificarAporte()).avisou, true, 'a partir do dia 20 avisa mesmo assim');
  assert.strictEqual(J(sb({ props: { FIN_API_URL: '', FIN_API_TOKEN: '' } }).Consultor.verificarAporte()).pulou, 'não configurado');
});

test('ensaio mostra o que avisaria sem enviar nem gravar; teste envia um aviso rotulado com números inventados e não marca o mês', function () {
  var s = sb();
  var e = J(s.Consultor.verificarAporte({ ensaio: true }));
  assert.strictEqual(e.avisaria, true); assert.strictEqual(s._avisos.length, 0); assert.strictEqual(prop(s, 'CONSULTOR_AVISO_MES'), null); assert.strictEqual(s.Consultor.sugestaoAporte(), null);
  var t = J(sb().Consultor.verificarAporte({ teste: true }));
  assert.strictEqual(t.teste, true);
  var st = sb(); st.Consultor.verificarAporte({ teste: true });
  assert.ok(/^Teste do aviso do consultor\./.test(st._avisos[0].falar)); assert.strictEqual(prop(st, 'CONSULTOR_AVISO_MES'), null);
  assert.strictEqual(J(st.Consultor.sugestaoAporte()).teste, true);
});

test('"aportei": repete a divisão sugerida, o sim lança uma Aplicação por destino (chaves diferentes) e limpa a sugestão; desfaz tira todas', function () {
  var s = sb();
  s.Consultor.verificarAporte();
  var p = J(s.Financas.conversar('aportei'));
  assert.ok(/^Confirma registrar o aporte de R\$ 1\.200,00: /.test(p.resp) && /hoje\? Isso sai do seu livre\. Diga sim ou não\.$/.test(p.resp), p.resp);
  assert.strictEqual(s._posts.length, 0, 'nada gravado antes do sim');
  var ok = J(s.Financas.conversar('sim'));
  var aps = s._posts.filter(function (x) { return x.url === '/aplicacao'; });
  assert.ok(aps.length >= 1);
  assert.ok(aps.every(function (x) { return x.corpo.tipo === 'Aplicação' && x.corpo.valor > 0; }));
  assert.strictEqual(new Set(aps.map(function (x) { return x.corpo.chave; })).size, aps.length, 'uma chave por destino');
  assert.ok(Math.abs(aps.reduce(function (t, x) { return t + x.corpo.valor; }, 0) - 1200) < 0.005);
  assert.ok(/^Registrei o aporte de R\$ 1\.200,00 em \d+ destinos?\./.test(ok.resp), ok.resp);
  assert.strictEqual(s.Consultor.sugestaoAporte(), null, 'sugestão consumida');
  var d = J(s.Financas.conversar('desfaz'));
  assert.ok(/Desfeito: tirei o aporte de R\$ 1\.200,00/.test(d.resp), d.resp);
  assert.strictEqual(s._posts.filter(function (x) { return x.url === '/aplicacao/desfazer'; }).length, aps.length);
});

test('"aportei 800" refaz a divisão na mesma proporção e fecha a soma; destino dito vai para a aplicação comum; sem sugestão e sem sobra pede valor e destino', function () {
  var s = sb();
  s.Consultor.verificarAporte();
  var p = J(s.Financas.conversar('aportei 800'));
  assert.ok(/^Confirma registrar o aporte de R\$ 800,00: /.test(p.resp), p.resp);
  s.Financas.conversar('sim');
  var aps = s._posts.filter(function (x) { return x.url === '/aplicacao'; });
  assert.ok(Math.abs(aps.reduce(function (t, x) { return t + x.corpo.valor; }, 0) - 800) < 0.005, 'soma exata');
  var o = sb();
  o.Consultor.verificarAporte();
  assert.ok(/^Confirma a aplicação de R\$ 500,00/.test(J(o.Financas.conversar('aportei 500 no tesouro')).resp), 'com destino é a aplicação normal');
  var vazio = sb({ dados: dados({ livreFim: 200 }) });
  assert.ok(/Não tenho um aporte sugerido agora/.test(J(vazio.Financas.conversar('aportei')).resp));
  assert.ok(/^Confirma a aplicação de R\$ 300,00/.test(J(vazio.Financas.conversar('aportei 300')).resp), 'sem sugestão e com valor: aplicação comum');
});

test('aporte sugerido de TESTE nunca grava; sem sugestão guardada, "aportei" calcula o plano de agora', function () {
  var s = sb();
  s.Consultor.verificarAporte({ teste: true });
  s.Financas.conversar('aportei');
  var r = J(s.Financas.conversar('sim'));
  assert.ok(/só o aviso de teste/.test(r.resp)); assert.strictEqual(s._posts.length, 0);
  var n = sb();
  var p = J(n.Financas.conversar('fiz o aporte do mês'));
  assert.ok(/^Confirma registrar o aporte de R\$ 1\.200,00/.test(p.resp), p.resp);
});

test('caderneta fora do ar: o aporte não grava e diz isso', function () {
  var s = sb();
  s.Consultor.verificarAporte();
  s.Financas.conversar('aportei');
  s.UrlFetchApp.fetch = function () { throw new Error('rede caiu'); };
  assert.ok(/Não consegui registrar o aporte agora\. Não gravei nada/.test(J(s.Financas.conversar('sim')).resp));
});

// ── destino do aporte durante a pausa do rebalanceamento ─────────────────────────────────────────────────────
var DEST = JSON.stringify({ rotulo: 'no cofrinho do Mercado Pago', descricao: 'Cofrinho do Mercado Pago' });
var PAUSA = { CONSULTOR_PAUSA_ATE: '2027-01-01', CONSULTOR_DESTINO_PAUSA: DEST };

test('pausa com destino: o plano manda o aporte INTEIRO para o destino; sem pausa (ou pausa vencida) volta a dividir pelo alvo', function () {
  var s = sb({ props: PAUSA });
  var p = J(s.Consultor.plano(dados(), s.Consultor.cfg(), '2026-10-14'));
  assert.strictEqual(p.pausa, true); assert.strictEqual(p.partes.length, 1);
  assert.deepStrictEqual([p.partes[0].valor, p.partes[0].destino.rotulo], [1200, 'no cofrinho do Mercado Pago']);
  assert.ok(/O rebalanceamento está pausado até janeiro de 2027, então o aporte inteiro vai no cofrinho do Mercado Pago\.$/.test(p.texto), p.texto);
  assert.ok(!/Para chegar ao alvo|seguindo o alvo/.test(p.texto));
  var vencida = sb({ props: { CONSULTOR_PAUSA_ATE: '2026-09-01', CONSULTOR_DESTINO_PAUSA: DEST } });
  var v = J(vencida.Consultor.plano(dados(), vencida.Consultor.cfg(), '2026-10-14'));
  assert.ok(!v.pausa && v.partes.length > 1 && /Para chegar ao alvo sem vender nada/.test(v.texto), 'pausa vencida: pelo alvo');
  var semDest = sb({ props: { CONSULTOR_PAUSA_ATE: '2027-01-01' } });
  var sd = J(semDest.Consultor.plano(dados(), semDest.Consultor.cfg(), '2026-10-14'));
  assert.ok(!sd.pausa && /seguindo o alvo, o aporte iria assim/.test(sd.texto), 'pausa sem destino configurado: comportamento de antes');
  var ruim = sb({ props: { CONSULTOR_PAUSA_ATE: '2027-01-01', CONSULTOR_DESTINO_PAUSA: 'isto nao e json' } });
  assert.strictEqual(ruim.Consultor.cfg().destinoPausa, null, 'valor corrompido é ignorado');
});

test('aviso mensal durante a pausa fala o destino; "aportei" confirma UM destino e o sim lança uma Aplicação com o nome do destino', function () {
  var s = sb({ props: PAUSA });
  s.Consultor.verificarAporte();
  var a = s._avisos[0];
  assert.ok(/dá para aportar até R\$ 1\.200,00/.test(a.texto) && /o aporte inteiro vai no cofrinho do Mercado Pago/.test(a.texto) && a.falar === a.texto, a.texto);
  var p = J(s.Financas.conversar('aportei'));
  assert.strictEqual(p.resp, 'Confirma registrar o aporte de R$ 1.200,00 no cofrinho do Mercado Pago, hoje? Isso sai do seu livre. Diga sim ou não.');
  var ok = J(s.Financas.conversar('sim'));
  var aps = s._posts.filter(function (x) { return x.url === '/aplicacao'; });
  assert.strictEqual(aps.length, 1);
  assert.deepStrictEqual([aps[0].corpo.valor, aps[0].corpo.descricao, aps[0].corpo.tipo], [1200, 'Cofrinho do Mercado Pago', 'Aplicação']);
  assert.ok(/^Registrei o aporte de R\$ 1\.200,00 em 1 destino\./.test(ok.resp), ok.resp);
  var v = sb({ props: PAUSA });
  v.Consultor.verificarAporte();
  var p8 = J(v.Financas.conversar('aportei 800'));
  assert.ok(/^Confirma registrar o aporte de R\$ 800,00 no cofrinho do Mercado Pago, hoje\?/.test(p8.resp), p8.resp);
});

test('configurar o destino da pausa por voz: confirma, grava com rótulo e descrição, desfaz; remover; frase incompleta pede o destino', function () {
  var s = sb();
  var p = J(s.Financas.conversar('o destino da pausa é o cofrinho do Mercado Pago'));
  assert.strictEqual(p.resp, 'Confirma: durante a pausa do rebalanceamento, o aporte inteiro vai no cofrinho do Mercado Pago? Diga sim ou não.');
  assert.strictEqual(prop(s, 'CONSULTOR_DESTINO_PAUSA'), null, 'nada gravado antes do sim');
  var ok = J(s.Financas.conversar('sim'));
  assert.ok(/^Pronto: durante a pausa do rebalanceamento, o aporte inteiro vai no cofrinho do Mercado Pago\./.test(ok.resp), ok.resp);
  assert.deepStrictEqual(JSON.parse(prop(s, 'CONSULTOR_DESTINO_PAUSA')), { rotulo: 'no cofrinho do Mercado Pago', descricao: 'Cofrinho do Mercado Pago' });
  assert.ok(/Desfeito: o valor do destino da pausa voltou/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(prop(s, 'CONSULTOR_DESTINO_PAUSA'), null);
  s.Financas.conversar('defina o destino da pausa para a reserva do Itaú'); s.Financas.conversar('sim');
  assert.strictEqual(JSON.parse(prop(s, 'CONSULTOR_DESTINO_PAUSA')).rotulo, 'na reserva do Itaú');
  assert.ok(/Confirma tirar o destino da pausa/.test(J(s.Financas.conversar('tira o destino da pausa')).resp));
  s.Financas.conversar('sim'); assert.strictEqual(prop(s, 'CONSULTOR_DESTINO_PAUSA'), null);
  assert.ok(/Diga qual é o destino/.test(J(s.Financas.conversar('o destino da pausa é')).resp));
});
