// acoes-voz.test.js — salário recebido, aplicação/resgate, saldo de investimento, ajuste do consultor, metas (editar/apagar) e
// "desfaz" depois de 10 minutos (log persistente), tudo por voz COM confirmação (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 1500, aPagar: 0,
  obrigacoes: [{ chave: 'd:aluguel', nome: 'Aluguel', tipo: 'conta', dia: 10, valor: 700, pago: false, outroPaga: false }],
  receitas: [{ chave: 'r:sal', nome: 'Salário', valor: 3840, recebido: false }, { chave: 'r:ext', nome: 'Extra mensal', valor: 100, recebido: true }],
  orcamentos: [],
  investimentos: { total: 31477.82, liquidezDiaria: 25259.91,
    itens: [{ id: 'i1', nome: 'CDB Plus', instituicao: 'Itaú', categoria: 'Renda fixa', saldo: 20759.91 },
            { id: 'i2', nome: 'Cofrinho Economia e investimento', instituicao: 'Mercado Pago', categoria: 'Liquidez/Reserva', saldo: 2500 },
            { id: 'i3', nome: 'Cofrinho Mercado Livre', instituicao: 'Mercado Pago', categoria: 'Liquidez/Reserva', saldo: 2000 },
            { id: 'i4', nome: 'Tesouro Renda+ 2050', instituicao: 'Itaú', categoria: 'Tesouro Direto', saldo: 3986.36 }],
    porCategoria: { 'Renda fixa': 20759.91, 'Liquidez/Reserva': 4500, 'Tesouro Direto': 3986.36, 'FIIs': 2231.55 } },
  metaAlocacao: { 'Renda fixa': 60, 'Tesouro Direto': 20, 'FIIs': 15, 'Liquidez/Reserva': 5 }, reservaMeses: 11.48
};

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : (p === 'd' ? '14' : '2026-10-14')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') {
      var corpo = JSON.parse(opt.payload), rota = url.replace(/^.*\/api\/jarvis/, '');
      s._posts.push({ url: rota, corpo: corpo });
      if (o.rede) throw new Error('rede caiu');
      var resp = { ok: true, criado: true, mudou: true, removido: 1 };
      if (rota === '/investimento') resp = { ok: true, nome: 'CDB Plus', antes: 20759.91, depois: corpo.saldo };
      return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(resp); } };
    }
    if (o.rede) throw new Error('rede caiu');
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(o.dados || DADOS); } };
  } };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var prop = function (s, k) { return s.PropertiesService.getScriptProperties().getProperty(k); };

// ── salário recebido ────────────────────────────────────────────────────────────────
test('"recebi o salário" propõe marcar como recebido (com o valor), o sim marca e diz o livre; desfaz volta', function () {
  var s = sb();
  var p = J(s.Financas.conversar('recebi o salário'));
  assert.strictEqual(p.resp, 'Marco Salário como recebido: R$ 3.840,00. Isso entra no seu livre de hoje. Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0);
  var ok = J(s.Financas.conversar('sim'));
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.chave, s._posts[0].corpo.pago], ['/pagamento', 'r:sal', true]);
  assert.ok(/^Marquei Salário como recebido\. Seu livre hoje agora é R\$ 117,18\. Para desfazer, diga desfaz\.$/.test(ok.resp), ok.resp);
  assert.ok(/Desfeito: Salário voltou a ficar como não recebido/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].corpo.pago, false);
});

test('salário: valor falado diferente avisa; já recebido não marca; receita extra de outra pessoa segue o fluxo da receita extra', function () {
  var s = sb();
  assert.ok(/Você falou R\$ 3\.500,00, mas na caderneta está R\$ 3\.840,00/.test(J(s.Financas.conversar('caiu o salário de 3500')).resp));
  s.Financas.conversar('não');
  assert.ok(/Extra mensal já está marcado como recebido/.test(J(s.Financas.conversar('recebi o extra mensal')).resp));
  var r = J(s.Financas.conversar('recebi 450 da Maria no pix'));
  assert.ok(/^Confirma a receita extra de R\$ 450,00 de Maria/.test(r.resp), r.resp);
  assert.strictEqual(s.Financas.conversar('quanto recebi de salário'), null, 'pergunta não marca nada');
});

// ── aplicação e resgate ─────────────────────────────────────────────────────────────
test('"apliquei 500 no cofrinho": acha o investimento, avisa que sai do livre e só o sim lança a Aplicação (sem mexer no saldo)', function () {
  var s = sb();
  var ambiguo = J(s.Financas.conversar('apliquei 500 no cofrinho'));
  assert.ok(/Achei mais de um: Cofrinho Economia e investimento, Cofrinho Mercado Livre\. Diga qual\./.test(ambiguo.resp), ambiguo.resp);
  var p = J(s.Financas.conversar('apliquei 500 no cofrinho economia'));
  assert.strictEqual(p.resp, 'Confirma a aplicação de R$ 500,00 em Cofrinho Economia e investimento, hoje? Isso sai do seu livre. Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0);
  var ok = J(s.Financas.conversar('sim'));
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.tipo, c.valor, c.descricao], ['/aplicacao', 'Aplicação', 500, 'Cofrinho Economia e investimento']);
  assert.ok(/O saldo do investimento não mudou; atualize com o extrato/.test(ok.resp), ok.resp);
  assert.ok(!s._posts.some(function (x) { return x.url === '/investimento'; }), 'não mexe no saldo do investimento');
  assert.ok(/Desfeito: tirei a aplicação de R\$ 500,00/.test(J(s.Financas.conversar('desfaz')).resp));
});

test('resgate volta para o livre; destino fora da lista vira texto livre; pergunta não vira aplicação', function () {
  var s = sb();
  assert.ok(/^Confirma o resgate de R\$ 300,00 de CDB Plus, hoje\? Isso volta para o seu livre/.test(J(s.Financas.conversar('resgatei 300 do cdb')).resp));
  s.Financas.conversar('não');
  var l = J(s.Financas.conversar('apliquei 200 na poupança'));
  assert.ok(/^Confirma a aplicação de R\$ 200,00 em Poupança, hoje\?/.test(l.resp), l.resp);
  s.Financas.conversar('não');
  assert.strictEqual(s.Financas.conversar('quanto apliquei esse mês'), null);
  assert.ok(/Esse valor é alto\. Confirma/.test(J(s.Financas.conversar('apliquei 8 mil no cdb')).resp));
});

// ── saldo de investimento ───────────────────────────────────────────────────────────
test('"atualiza o saldo do CDB para 20.800": mostra antes → depois, o sim atualiza, desfaz restaura o saldo antigo', function () {
  var s = sb();
  var p = J(s.Financas.conversar('atualiza o saldo do cdb para 20.800'));
  assert.strictEqual(p.resp, 'Atualizo o saldo de CDB Plus de R$ 20.759,91 para R$ 20.800,00 (mais R$ 40,09)? Diga sim ou não.');
  var ok = J(s.Financas.conversar('sim'));
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.id, s._posts[0].corpo.saldo], ['/investimento', 'i1', 20800]);
  assert.ok(/Atualizei o saldo de CDB Plus para R\$ 20\.800,00/.test(ok.resp), ok.resp);
  assert.ok(/Desfeito: o saldo de CDB Plus voltou para R\$ 20\.759,91/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].corpo.saldo, 20759.91);
});

test('saldo: mudança grande avisa; investimento que não existe e saldo do voucher não são com esta ação', function () {
  var s = sb();
  assert.ok(/^A mudança é grande\. Atualizo o saldo de CDB Plus/.test(J(s.Financas.conversar('atualiza o saldo do cdb para 5000')).resp));
  s.Financas.conversar('não');
  assert.strictEqual(s.Financas.conversar('atualiza o saldo do bitcoin para 5000'), null);
  assert.strictEqual(s.Financas.conversar('o saldo do voucher agora é 40'), null);
  assert.strictEqual(s.Financas.conversar('qual o saldo do cdb'), null);
});

// ── ajuste do consultor ─────────────────────────────────────────────────────────────
test('ajustar o consultor por voz: margem, taxa, reserva-alvo, pausa e retomada — confirma, grava e desfaz', function () {
  var s = sb();
  assert.strictEqual(J(s.Financas.conversar('muda a margem para 500')).resp, 'Confirma mudar o valor da margem do consultor de R$ 300,00 para R$ 500,00? Diga sim ou não.');
  s.Financas.conversar('sim');
  assert.strictEqual(prop(s, 'CONSULTOR_MARGEM'), '500');
  assert.ok(/Desfeito: o valor da margem voltou/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(prop(s, 'CONSULTOR_MARGEM'), null);

  assert.ok(/de 0,8% ao mês para 1% ao mês/.test(J(s.Financas.conversar('muda a taxa para 1% ao mês')).resp));
  s.Financas.conversar('sim'); assert.strictEqual(prop(s, 'CONSULTOR_TAXA_MES'), '0.01');
  assert.ok(/entre zero e cinco por cento/.test(J(s.Financas.conversar('muda a taxa para 9% ao mês')).resp));

  s.Financas.conversar('muda a reserva alvo para 8 meses'); s.Financas.conversar('sim');
  assert.strictEqual(prop(s, 'CONSULTOR_RESERVA_ALVO'), '8');

  assert.ok(/Diga até quando/.test(J(s.Financas.conversar('pausa o rebalanceamento')).resp));
  s.Financas.conversar('pausa o rebalanceamento até janeiro de 2027'); s.Financas.conversar('sim');
  assert.strictEqual(prop(s, 'CONSULTOR_PAUSA_ATE'), '2027-01-01');
  assert.ok(/sem pausa/.test(J(s.Financas.conversar('retoma o rebalanceamento')).resp));
  s.Financas.conversar('sim'); assert.strictEqual(prop(s, 'CONSULTOR_PAUSA_ATE'), null);
  assert.strictEqual(s.Financas.conversar('qual é a margem'), null, 'pergunta não ajusta');
});

// ── metas: criar, editar, apagar ─────────────────────────────────────────────────────
test('metas: cria, edita (achando pelo nome parcial), apaga e desfaz cada passo', function () {
  var s = sb();
  s.Financas.conversar('minha meta é casa própria, 150 mil, até 2030'); s.Financas.conversar('sim');
  s.Financas.conversar('minha meta é aposentadoria, 1,5 milhão, até 2050'); s.Financas.conversar('sim');
  var metas = function () { return JSON.parse(prop(s, 'CONSULTOR_METAS')); };
  assert.strictEqual(metas().length, 2);
  var e = J(s.Financas.conversar('muda a meta casa para 180 mil até 2031'));
  assert.strictEqual(e.resp, 'Confirma mudar a meta Casa própria de R$ 150.000,00 até 2030 para R$ 180.000,00 até 2031? Diga sim ou não.');
  s.Financas.conversar('sim');
  assert.deepStrictEqual(J(metas().filter(function (m) { return m.nome === 'Casa própria'; })[0]), { nome: 'Casa própria', alvo: 180000, ate: '2031' });
  assert.strictEqual(metas().length, 2, 'editar não duplica');
  s.Financas.conversar('muda a meta casa para 2032'); s.Financas.conversar('sim');
  assert.strictEqual(metas().filter(function (m) { return m.nome === 'Casa própria'; })[0].alvo, 180000, 'só o ano mudou');
  assert.strictEqual(metas().filter(function (m) { return m.nome === 'Casa própria'; })[0].ate, '2032');
  assert.ok(/Confirma apagar a meta Aposentadoria/.test(J(s.Financas.conversar('apaga a meta aposentadoria')).resp));
  s.Financas.conversar('sim');
  assert.strictEqual(metas().length, 1);
  s.Financas.conversar('desfaz');
  assert.strictEqual(metas().length, 2, 'desfaz traz a meta apagada de volta');
  assert.ok(/Não achei essa meta\. Você tem: /.test(J(s.Financas.conversar('apaga a meta viagem')).resp));
  assert.ok(/Diga o novo valor ou o novo ano/.test(J(s.Financas.conversar('muda a meta casa')).resp));
});

test('metas: as metas cadastradas aparecem no consultor com progresso', function () {
  var s = sb({ props: { CONSULTOR_METAS: JSON.stringify([{ nome: 'Casa própria', alvo: 150000, ate: '2030' }]) } });
  var q = s.Financas.interpretar('como estão minhas metas');
  assert.ok(/Casa própria: você tem R\$ 31\.477,82 de R\$ 150\.000,00, 21%/.test(s.Financas.responder(J(q))));
});

// ── desfaz depois de 10 minutos ──────────────────────────────────────────────────────
test('desfaz depois dos 10 minutos: diz o que foi e há quanto tempo, e só o sim desfaz; antes de 10 min é direto', function () {
  var s = sb();
  s.Financas.conversar('apliquei 500 no cdb'); s.Financas.conversar('sim');
  var log = JSON.parse(prop(s, 'FIN_LOG_ACOES'));
  assert.strictEqual(log.length, 1); assert.strictEqual(log[0].desc, 'a aplicação de R$ 500,00 em CDB Plus');
  log[0].em = Date.now() - 2 * 3600 * 1000;   // passou: faz 2 horas
  s.PropertiesService.getScriptProperties().setProperty('FIN_LOG_ACOES', JSON.stringify(log));
  var q = J(s.Financas.conversar('desfaz'));
  assert.strictEqual(q.resp, 'A última ação foi há 2 horas: a aplicação de R$ 500,00 em CDB Plus. Desfaço? Diga sim ou não.');
  assert.strictEqual(s._posts.filter(function (x) { return /desfazer/.test(x.url); }).length, 0, 'nada desfeito sem o sim');
  var ok = J(s.Financas.conversar('sim'));
  assert.ok(/Desfeito: tirei a aplicação/.test(ok.resp), ok.resp);
  assert.strictEqual(JSON.parse(prop(s, 'FIN_LOG_ACOES')).length, 0, 'saiu do registro');
  s.Financas.conversar('apliquei 100 no cdb'); s.Financas.conversar('sim');
  assert.ok(/^Desfeito/.test(J(s.Financas.conversar('desfaz')).resp), 'dentro de 10 min é direto');
});

test('desfaz: "não" cancela; com o registro vazio ou com mais de 3 dias, diz que não há o que desfazer; "o que você registrou" lista as últimas', function () {
  var s = sb();
  s.Financas.conversar('apliquei 500 no cdb'); s.Financas.conversar('sim');
  var log = JSON.parse(prop(s, 'FIN_LOG_ACOES')); log[0].em = Date.now() - 3 * 3600 * 1000;
  s.PropertiesService.getScriptProperties().setProperty('FIN_LOG_ACOES', JSON.stringify(log));
  s.Financas.conversar('desfaz');
  assert.ok(/não registrei nada/.test(J(s.Financas.conversar('não')).resp));
  assert.strictEqual(JSON.parse(prop(s, 'FIN_LOG_ACOES')).length, 1, 'continua no registro');
  var lista = J(s.Financas.conversar('o que você registrou'));
  assert.ok(/Das últimas ações: a aplicação de R\$ 500,00 em CDB Plus, há 3 horas\./.test(lista.resp), lista.resp);
  log[0].em = Date.now() - 4 * 86400000;
  s.PropertiesService.getScriptProperties().setProperty('FIN_LOG_ACOES', JSON.stringify(log));
  assert.ok(/Não há nada para desfazer nos últimos 3 dias/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.ok(/Não registrei nada na caderneta nos últimos 3 dias/.test(J(s.Financas.conversar('quais foram as últimas ações')).resp));
});
