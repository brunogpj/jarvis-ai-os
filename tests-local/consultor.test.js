// consultor.test.js — FASE 4 (consultor da estratégia do dono) e marcar conta como paga por voz (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-14', livreHoje: 117.18, livreFim: 1500, aPagar: 645.53,
  obrigacoes: [
    { chave: 'd:aluguel', nome: 'Aluguel', tipo: 'conta', dia: 10, valor: 700, pago: false, outroPaga: false },
    { chave: 'c:click', nome: 'Fatura Itaú Click', tipo: 'fatura', dia: 19, valor: 387.57, pago: false, outroPaga: false },
    { chave: 'c:passai', nome: 'Fatura Passaí', tipo: 'fatura', dia: 13, valor: 257.96, pago: false, outroPaga: false },
    { chave: 'd:luz', nome: 'Luz', tipo: 'conta', dia: 5, valor: 252.16, pago: false, outroPaga: true },
    { chave: 'd:agua', nome: 'Água', tipo: 'conta', dia: 20, valor: 250, pago: true, outroPaga: false },
    { chave: 'd:dizimo', nome: 'Dízimo', tipo: 'conta', dia: 7, valor: 500, pago: false, outroPaga: false }
  ],
  orcamentos: [],
  investimentos: { total: 31477.82, liquidezDiaria: 25259.91, rendimentoAno: 1500,
    porCategoria: { 'Renda fixa': 20759.91, 'Liquidez/Reserva': 4500, 'Tesouro Direto': 3986.36, 'FIIs': 2231.55 } },
  metaAlocacao: { 'Renda fixa': 60, 'Tesouro Direto': 20, 'FIIs': 15, 'Liquidez/Reserva': 5 },
  reservaMeses: 11.48
};

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? '2026-10-14' : (p === 'yyyy' ? '2026' : (p === 'd' ? '14' : '2026-10-14')); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = [];
  s.UrlFetchApp = { fetch: function (url, opt) {
    if (opt && opt.method === 'post') s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: JSON.parse(opt.payload) });
    if (o.rede) throw new Error('rede caiu');
    var corpo = (opt && opt.method === 'post') ? (o.pagamento || { ok: true, mudou: true, pago: true, nome: 'x', valor: 1 }) : (o.dados || DADOS);
    return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(corpo); } };
  } };
  loadGasFile('Consultor.js', s);
  loadGasFile('Financas.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var responder = function (s, frase) { var q = s.Financas.interpretar(frase); return q ? s.Financas.responder(J(q)) : null; };

// ── matemática ───────────────────────────────────────────────────────────────────────
test('valorFuturo, mesesAteAlvo e aporteNecessario são coerentes entre si', function () {
  var C = sb().Consultor;
  assert.strictEqual(C.valorFuturo(1000, 100, 0, 12), 2200, 'sem juros é soma');
  var fv = C.valorFuturo(10000, 500, 0.01, 24);
  assert.ok(Math.abs(fv - (10000 * Math.pow(1.01, 24) + 500 * (Math.pow(1.01, 24) - 1) / 0.01)) < 1e-6);
  var n = C.mesesAteAlvo(10000, 500, 0.01, 30000);
  assert.ok(C.valorFuturo(10000, 500, 0.01, n) >= 30000 && C.valorFuturo(10000, 500, 0.01, n - 1) < 30000, 'é o primeiro mês que alcança');
  var a = C.aporteNecessario(10000, 0.01, 60, 100000);
  assert.ok(Math.abs(C.valorFuturo(10000, a, 0.01, 60) - 100000) < 0.01, 'o aporte necessário fecha o alvo');
  assert.strictEqual(C.mesesAteAlvo(500, 0, 0, 1000), null, 'sem aporte nem juros nunca chega');
  assert.strictEqual(C.mesesAteAlvo(2000, 0, 0.01, 1000), 0, 'já passou');
});

test('dividirAporte: soma exata, nunca negativa, favorece o que está abaixo do alvo e nada é vendido', function () {
  var C = sb().Consultor, alvo = DADOS.metaAlocacao, atual = DADOS.investimentos.porCategoria;
  [100, 1000, 2500.55, 37.03, 100000].forEach(function (A) {
    var p = J(C.dividirAporte(atual, alvo, A)), soma = 0;
    Object.keys(p).forEach(function (k) { assert.ok(p[k] >= 0, k); soma += p[k]; });
    assert.ok(Math.abs(soma - A) < 0.005, 'soma ' + soma + ' vs ' + A);
  });
  var p = J(C.dividirAporte(atual, alvo, 1000));
  assert.strictEqual(p['Renda fixa'], 0, 'Renda fixa já passa do alvo: não recebe');
  assert.strictEqual(p['Liquidez/Reserva'], 0, 'Reserva já passa do alvo: não recebe');
  assert.ok(p['FIIs'] > 0 && p['Tesouro Direto'] > 0);
  // aporte grande demais para só fechar os gaps: o excedente vai pelos pesos do alvo
  var g = J(C.dividirAporte(atual, alvo, 100000));
  assert.ok(g['Renda fixa'] > 0 && g['Liquidez/Reserva'] > 0);
});

test('numerosFalados: mil, milhão, milhar com ponto e decimal com vírgula', function () {
  var C = sb().Consultor;
  var v = function (t) { return J(C.numerosFalados(t)).map(function (x) { return x.valor; }); };
  assert.deepStrictEqual(v('150 mil ate 2030'), [150000, 2030]);
  assert.deepStrictEqual(v('1,5 milhao'), [1500000]);
  assert.deepStrictEqual(v('1.000 por mes'), [1000]);
  assert.deepStrictEqual(v('aportar 1.250,90'), [1250.9]);
});

// ── respostas ────────────────────────────────────────────────────────────────────────
test('carteira: compara com o alvo da estratégia e diz qual está mais abaixo; avisa a pausa do rebalanceamento', function () {
  var s = sb();
  var t = responder(s, 'como está a minha carteira');
  assert.ok(/Sua carteira soma R\$ 31\.477,82/.test(t), t);
  assert.ok(/Renda fixa está em 66%, alvo 60%/.test(t) && /Tesouro Direto está em 13%, alvo 20%/.test(t) && /fundos imobiliários está em 7%, alvo 15%/.test(t), t);
  assert.ok(/A mais abaixo do alvo é fundos imobiliários, por 8 pontos percentuais/.test(t), t);
  assert.ok(!/pausado/.test(t));
  var p = sb({ props: { CONSULTOR_PAUSA_ATE: '2027-01-01' } });
  assert.ok(/rebalanceamento está pausado até janeiro de 2027/.test(responder(p, 'como está a distribuição da minha carteira')));
  var sem = sb({ dados: Object.assign({}, DADOS, { metaAlocacao: null }) });
  assert.ok(/Não há distribuição-alvo cadastrada/.test(responder(sem, 'como está a minha carteira')));
});

test('aporte: livre do fim do mês menos a margem, dividido pelo alvo sem vender; sem sobra, diz que não sobra', function () {
  var t = responder(sb(), 'quanto posso aportar esse mês');
  assert.ok(/terá R\$ 1\.500,00 livres, já descontando o que falta pagar/.test(t), t);
  assert.ok(/Deixando R\$ 300,00 de margem, dá para aportar até R\$ 1\.200,00/.test(t), t);
  assert.ok(/Para chegar ao alvo sem vender nada: /.test(t) && /em fundos imobiliários/.test(t) && /em Tesouro Direto/.test(t), t);
  assert.ok(!/em Renda fixa/.test(t), 'Renda fixa já passa do alvo');
  var m = sb({ props: { CONSULTOR_MARGEM: '1000' } });
  assert.ok(/dá para aportar até R\$ 500,00/.test(responder(m, 'quanto posso aportar esse mês')));
  var neg = sb({ dados: Object.assign({}, DADOS, { livreFim: 100 }) });
  assert.ok(/Este mês não sobra para aportar/.test(responder(neg, 'onde devo investir esse mês')));
  var pausa = sb({ props: { CONSULTOR_PAUSA_ATE: '2027-01-01' } });
  assert.ok(/pausado até janeiro de 2027; seguindo o alvo, o aporte iria assim, sem vender nada/.test(responder(pausa, 'como distribuir o aporte deste mês')));
});

test('simular e tempo: usam o patrimônio da caderneta, a taxa configurável e dizem que é estimativa', function () {
  var s = sb();
  var t = responder(s, 'se eu aportar 1000 por mês durante 5 anos quanto eu vou ter');
  var fv = s.Consultor.valorFuturo(31477.82, 1000, 0.008, 60);
  assert.ok(t.indexOf('R$ ' + String(fv.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\.(\d{2})$/, ',$1').replace(/(\d)\.(\d{3},)/, '$1.$2')) !== -1 || /cerca de R\$ /.test(t), t);
  assert.ok(/Aportando R\$ 1\.000,00 por mês durante 5 anos, a 0,8% ao mês/.test(t) && /R\$ 60\.000,00 de aportes/.test(t) && /estimativa, não uma promessa/.test(t), t);
  var r1 = responder(sb({ props: { CONSULTOR_TAXA_MES: '0.01' } }), 'se eu aportar 1000 por mês durante 5 anos quanto eu vou ter');
  assert.ok(/a 1% ao mês/.test(r1), r1);
  var r2 = responder(s, 'se eu aportar 500 por mês em 10 anos a 1% ao mês quanto fico');
  assert.ok(/durante 10 anos, a 1% ao mês/.test(r2), r2);
  var tm = responder(s, 'em quanto tempo chego a 100 mil aportando 1000 por mês');
  assert.ok(/chega a R\$ 100\.000,00 em cerca de \d+ anos?( e \d+ meses?)?/.test(tm), tm);
  assert.ok(/Diga quanto aporta por mês/.test(responder(s, 'em quanto tempo chego a 100 mil')));
  assert.ok(/você já tem R\$ 31\.477,82/i.test(responder(s, 'em quanto tempo chego a 20 mil aportando 100 por mês')));
});

test('reserva contra o alvo: acima ou abaixo, em reais; metas: progresso e aporte necessário', function () {
  var t = responder(sb(), 'minha reserva está boa, qual o alvo');
  assert.ok(/cobre cerca de 11,5 meses/.test(t) && /O alvo é de 6 meses/.test(t) && /acima do alvo/.test(t), t);
  var baixo = responder(sb({ dados: Object.assign({}, DADOS, { reservaMeses: 3 }) }), 'quanto falta para a reserva ideal');
  assert.ok(/Faltam R\$ /.test(baixo), baixo);
  assert.ok(/ainda não cadastrou metas/.test(responder(sb(), 'como estão minhas metas')));
  var m = sb({ props: { CONSULTOR_METAS: JSON.stringify([{ nome: 'Casa própria', alvo: 150000, ate: '2030' }]) } });
  var tm = responder(m, 'como estão minhas metas');
  assert.ok(/Casa própria: você tem R\$ 31\.477,82 de R\$ 150\.000,00, 21%/.test(tm), tm);
  assert.ok(/Até dezembro de 2030 faltam 4 anos e 2 meses; precisa aportar cerca de R\$ /.test(tm), tm);
});

test('interpretar: o que é do consultor e o que NÃO é (as perguntas de sempre seguem na rota de sempre)', function () {
  var F = sb().Financas;
  var t = function (f) { var r = F.interpretar(f); return r && r.tipo; };
  assert.strictEqual(t('como está a minha carteira'), 'carteira');
  assert.strictEqual(t('quanto posso aportar esse mês'), 'aporte');
  assert.strictEqual(t('se eu investir 500 por mês por 3 anos quanto vou ter'), 'simular');
  assert.strictEqual(t('em quanto tempo chego a 200 mil aportando 1500'), 'tempo');
  assert.strictEqual(t('minha reserva está suficiente'), 'reserva_alvo');
  assert.strictEqual(t('quais são as minhas metas'), 'metas');
  assert.strictEqual(t('quanto falta para a casa própria'), 'metas');
  // as de antes continuam iguais
  assert.strictEqual(t('quanto eu tenho investido'), 'investido');
  assert.strictEqual(t('quantos meses de reserva eu tenho'), 'reserva');
  assert.strictEqual(t('quanto tenho livre hoje'), 'livre_hoje');
  assert.strictEqual(F.interpretar('qual o saldo do voucher'), null);
});

// ── marcar conta como paga ───────────────────────────────────────────────────────────
test('paguei o aluguel → propõe com nome, valor e dia; só o sim marca; desfaz volta a pendente', function () {
  var s = sb();
  var p = J(s.Financas.conversar('paguei o aluguel'));
  assert.strictEqual(p.resp, 'Marco como paga: Aluguel, R$ 700,00, dia 10. Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0);
  var ok = J(s.Financas.conversar('sim'));
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.mes, s._posts[0].corpo.chave, s._posts[0].corpo.pago], ['/pagamento', '2026-10', 'd:aluguel', true]);
  assert.ok(/^Marquei Aluguel como paga\. Seu livre hoje agora é R\$ 117,18\. Para desfazer, diga desfaz\.$/.test(ok.resp), ok.resp);
  var d = J(s.Financas.conversar('desfaz'));
  assert.ok(/Desfeito: Aluguel voltou a ficar pendente/.test(d.resp), d.resp);
  assert.strictEqual(s._posts[1].corpo.pago, false);
});

test('paguei: ambígua pede o nome; paga por outra pessoa e já paga não marcam; valor diferente avisa; inexistente não inventa', function () {
  var s = sb();
  assert.ok(/mais de uma: Fatura Itaú Click, Fatura Passaí\. Diga o nome completo/.test(J(s.Financas.conversar('paguei a fatura')).resp));
  assert.ok(/Marco como paga: Fatura Itaú Click, R\$ 387,57, dia 19/.test(J(s.Financas.conversar('paguei a fatura do itaú')).resp));
  s.Financas.conversar('não');
  assert.ok(/Luz é paga por outra pessoa na caderneta/.test(J(s.Financas.conversar('paguei a luz')).resp));
  assert.ok(/Água já está marcada como paga/.test(J(s.Financas.conversar('paguei a água')).resp));
  assert.ok(/Você falou R\$ 400,00, mas na caderneta está R\$ 500,00/.test(J(s.Financas.conversar('paguei o dízimo de 400')).resp));
  assert.ok(/Não achei essa conta/.test(J(s.Financas.conversar('paguei a pensão')).resp));
  assert.strictEqual(s._posts.length, 0, 'nada gravado sem o sim');
});

test('paguei X no mercado continua sendo gasto avulso; pergunta e caderneta fora do ar não marcam nada', function () {
  var s = sb();
  assert.ok(/^Confirma o gasto de R\$ 35,00/.test(J(s.Financas.conversar('paguei 35 reais no mercado no débito')).resp));
  s.Financas.conversar('não');
  assert.strictEqual(s.Financas.conversar('quanto falta pagar'), null);
  assert.strictEqual(sb({ rede: true }).Financas.conversar('paguei o aluguel'), null, 'sem a caderneta, segue o fluxo normal em vez de afirmar algo');
});

// ── meta por voz ─────────────────────────────────────────────────────────────────────
test('meta por voz: propõe com nome, valor e ano; o sim grava; desfaz restaura; incompleta pede o que falta', function () {
  var s = sb();
  var p = J(s.Financas.conversar('minha meta é casa própria, 150 mil, até 2030'));
  assert.strictEqual(p.resp, 'Confirma a meta Casa própria: R$ 150.000,00 até 2030? Diga sim ou não.');
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('CONSULTOR_METAS'), null, 'nada gravado antes do sim');
  var ok = J(s.Financas.conversar('sim'));
  assert.ok(/Cadastrei a meta Casa própria: R\$ 150\.000,00 até 2030/.test(ok.resp), ok.resp);
  assert.deepStrictEqual(J(JSON.parse(s.PropertiesService.getScriptProperties().getProperty('CONSULTOR_METAS'))), [{ nome: 'Casa própria', alvo: 150000, ate: '2030' }]);
  s.Financas.conversar('minha meta é aposentadoria, 1,5 milhão, em 20 anos'); s.Financas.conversar('sim');
  assert.strictEqual(JSON.parse(s.PropertiesService.getScriptProperties().getProperty('CONSULTOR_METAS')).length, 2);
  s.Financas.conversar('desfaz');
  assert.strictEqual(JSON.parse(s.PropertiesService.getScriptProperties().getProperty('CONSULTOR_METAS')).length, 1);
  assert.ok(/diga o nome, o valor e o ano/.test(J(s.Financas.conversar('minha meta é viajar, 20 mil')).resp));
  assert.strictEqual(s.Financas.conversar('quais são as minhas metas'), null, 'pergunta não é cadastro');
});

test('"desfaz" seco sem nada recente responde que não há o que desfazer (não vai para o modelo)', function () {
  var s = sb();
  assert.ok(/Não há nada para desfazer/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.ok(/Não há nada para desfazer/.test(J(s.Financas.conversar('desfazer')).resp));
  assert.strictEqual(s.Financas.conversar('desfaz aquele calendário todo que eu criei ontem'), null, 'frase longa de outro assunto segue o fluxo normal');
});
