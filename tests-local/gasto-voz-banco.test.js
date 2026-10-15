// gasto-voz-banco.test.js — gasto avulso por voz (com confirmação) e gasto de banco por notificação (14/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(o) {
  o = o || {};
  var s = makeSandbox({ props: Object.assign({ FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'a'.repeat(40) }, o.props || {}) });
  var dia = o.dia || '2026-10-14';
  s.Utilities.formatDate = function (d, tz, p) { return p === 'yyyy-MM-dd' ? (d && d.getTime && d.getTime() < Date.now() - 3600000 ? '2026-10-13' : dia) : (p === 'd' ? dia.slice(8) : (p === 'H' ? '10' : dia)); };
  if (!s.Utilities.getUuid) s.Utilities.getUuid = function () { return 'abcd1234-ef56-7890-abcd-ef1234567890'; };
  s._posts = []; s._avisos = []; s._docs = {};
  s.UrlFetchApp = { fetch: function (url, opt) {
    var corpo = JSON.parse(opt.payload);
    s._posts.push({ url: url.replace(/^.*\/api\/jarvis/, ''), corpo: corpo });
    if (o.rede) throw new Error('rede caiu');
    var code = o.codigo || 200;
    var resp = /desfazer/.test(url) ? { ok: true, removido: 1 } : (o.resposta || { ok: true, criado: true });
    return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(code === 200 ? resp : { erro: 'x' }); } };
  } };
  s.Firestore = {
    getDoc: function (c, id) { return s._docs[id] || null; },
    setDoc: function (c, id, d) { s._docs[id] = d; },
    updateDoc: function (c, id, p) { Object.assign(s._docs[id], p); },
    listDocs: function () { return Object.keys(s._docs).map(function (k) { return { id: k, dados: s._docs[k] }; }); }
  };
  loadGasFile('Financas.js', s);
  loadGasFile('Code.js', s);
  s._avisarDono = function (a) { s._avisos.push(a); return { ok: true }; };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

var MP = { app: 'Mercado Pago', pacote: '', titulo: 'Você pagou R$ 30 a Google CLOUD T7VH4R', texto: 'O valor vai entrar na próxima fatura do seu Cartão Mercado Pago.' };
var BD = { app: 'Bradesco', pacote: '', titulo: 'BRADESCO', texto: 'Você fez uma compra com seu cartão de débito final 2102, de R$ 5,90, em: SAM S CLUB LJ 6.' };

// ── notificação do banco ─────────────────────────────────────────────────────────────────────────────────────
test('_bancoParse: os formatos reais do Mercado Pago e do Bradesco', function () {
  var s = sb();
  var a = J(s._bancoParse(MP.app, MP.titulo, MP.texto));
  assert.deepStrictEqual([a.origem, a.valor, a.estabelecimento, a.meio, a.auto], ['mp', 30, 'Google CLOUD T7VH4R', 'Cartão de crédito', true]);
  var b = J(s._bancoParse(BD.app, BD.titulo, BD.texto));
  assert.deepStrictEqual([b.origem, b.valor, b.estabelecimento, b.meio, b.auto], ['bd', 5.9, 'SAM S CLUB LJ 6', 'Pix / débito', true]);
  var c = J(s._bancoParse('Mercado Pago', 'Você pagou R$ 1.234,56 a LOJA X', 'Pagamento feito com o saldo da conta.'));
  assert.deepStrictEqual([c.valor, c.meio, c.auto], [1234.56, 'Pix / débito', false], 'sem a linha da fatura não registra sozinho');
  var d = J(s._bancoParse('Bradesco', 'BRADESCO', 'Você fez um Pix de R$ 80,00 para Maria Silva.'));
  assert.deepStrictEqual([d.valor, d.auto], [80, false]);
});

test('_bancoParse: Mercado Pago formato 2 (REAL 15/10): título só com o estabelecimento e "Debitamos R$ X da sua conta" no corpo registra sozinho como débito', function () {
  var s = sb();
  var a = J(s._bancoParse('Mercado Pago', 'Você pagou Divino fogao-comi', 'Debitamos R$ 32,99 da sua conta.'));
  assert.deepStrictEqual([a.origem, a.valor, a.estabelecimento, a.meio, a.auto], ['mp', 32.99, 'Divino fogao-comi', 'Pix / débito', true]);
  var b = J(s._bancoParse('Mercado Pago', 'Você pagou Loja Exemplo', 'O valor de R$ 1.200,50 vai entrar na próxima fatura.'));
  assert.deepStrictEqual([b.valor, b.meio, b.auto], [1200.5, 'Cartão de crédito', true]);
  assert.strictEqual(s._bancoParse('Mercado Pago', 'Você pagou Loja Exemplo', 'Obrigado por usar o Mercado Pago.'), null, 'sem valor no corpo não vira gasto');
});

test('_bancoParse: Pix recebido é ENTRADA (nunca gasto nem automática)', function () {
  var e = J(sb()._bancoParse('Bradesco', 'BRADESCO', 'Você recebeu um Pix de R$ 63,00 de Iago, da Instituição BANCO PAN'));
  assert.deepStrictEqual([e.entrada, e.auto, e.valor, e.remetente, e.instituicao], [true, false, 63, 'Iago', 'BANCO PAN']);
});

test('_bancoParse: o que NÃO é gasto não vira gasto (saque, extrato, promoção, Swile)', function () {
  var s = sb();
  [['Bradesco', 'BRADESCO', 'Você fez um saque com o cartão de débito final 2102 de R$ 500,00 no caixa eletrônico 0009156.'],
   ['Mercado Pago', 'Seu extrato de conta em pdf está pronto', 'Baixe e confira quais foram suas transações.'], ['Bradesco', 'Já pensou nisso?', ''], ['Swile BR', 'Compra aprovada de R$ 5,00', 'x']]
    .forEach(function (n) { assert.strictEqual(s._bancoParse(n[0], n[1], n[2]), null, n[2] || n[1]); });
});

test('compra no crédito do Mercado Pago → POST /gasto (origem mp, categoria Trabalho), guarda o desfaz e avisa sem valor no log', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(MP));
  assert.strictEqual(r.status, 'registrado'); assert.strictEqual(r.categoria, 'Trabalho');
  var p = s._posts[0];
  assert.strictEqual(p.url, '/gasto');
  assert.deepStrictEqual([p.corpo.origem, p.corpo.valor, p.corpo.meio, p.corpo.categoria, p.corpo.descricao, p.corpo.data], ['mp', 30, 'Cartão de crédito', 'Trabalho', 'Google CLOUD T7VH4R', '2026-10-14']);
  assert.ok(/^b[a-z0-9]+_2026-10-14$/.test(p.corpo.chave));
  assert.strictEqual(s._avisos.length, 1); assert.ok(!/\d/.test(s._avisos[0].logResumo));
  var doc = s._docs[p.corpo.chave]; assert.strictEqual(doc.caderneta, 'registrado'); assert.strictEqual(doc.tipo, 'gasto_banco');
  // o "desfaz" por voz vale para o gasto que veio da notificação
  var d = J(s.Financas.conversar('desfaz'));
  assert.ok(/Desfeito: tirei o gasto de R\$ 30,00 em Google CLOUD T7VH4R/.test(d.resp), d.resp);
  assert.strictEqual(s._posts[1].url, '/gasto/desfazer'); assert.strictEqual(s._posts[1].corpo.origem, 'mp');
});

test('débito do Bradesco → Pix / débito, categoria Mercado (Sam\'s Club); mesma notificação não registra de novo', function () {
  var s = sb();
  assert.strictEqual(J(s._bancoParaCaderneta(BD)).categoria, 'Mercado');
  assert.strictEqual(s._posts[0].corpo.meio, 'Pix / débito'); assert.strictEqual(s._posts[0].corpo.origem, 'bd');
  assert.strictEqual(J(s._bancoParaCaderneta(BD)).jaRegistrado, true);
  assert.strictEqual(s._posts.length, 1);
});

test('já existe um gasto igual digitado → não duplica e avisa; caderneta fora → pendente e reenvio; 4xx → recusado', function () {
  var dup = sb({ resposta: { ok: true, criado: false, motivo: 'ja_existe', existente: { data: '2026-10-14', descricao: 'x' } } });
  assert.strictEqual(J(dup._bancoParaCaderneta(MP)).status, 'duplicado_manual');
  assert.ok(/Já havia um gasto igual/.test(dup._avisos[0].texto));
  var off = sb({ rede: true });
  var r = J(off._bancoParaCaderneta(MP));
  assert.strictEqual(r.status, 'pendente');
  off.UrlFetchApp.fetch = function (url, opt) { off._posts.push({ corpo: JSON.parse(opt.payload) }); return { getResponseCode: function () { return 200; }, getContentText: function () { return '{"ok":true,"criado":true}'; } }; };
  assert.strictEqual(J(off._finReenviarPendentes()).reenviados, 1);
  assert.strictEqual(off._docs[Object.keys(off._docs)[0]].caderneta, 'registrado');
  assert.strictEqual(J(sb({ codigo: 400 })._bancoParaCaderneta(MP)).status, 'recusado');
});

test('formato que não registra sozinho fica "aguarda_validacao": avisa e não escreve na caderneta', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta({ app: 'Bradesco', pacote: '', titulo: 'BRADESCO', texto: 'Você fez um Pix de R$ 80,00 para Maria Silva.' }));
  assert.strictEqual(r.status, 'aguarda_validacao'); assert.strictEqual(s._posts.length, 0); assert.strictEqual(s._avisos.length, 1);
});

test('BANCOS_PARA_CADERNETA=nao desliga; a regra de notificação não vira lembrete "chegou em casa" para gasto de banco', function () {
  assert.strictEqual(sb({ props: { BANCOS_PARA_CADERNETA: 'nao' } })._bancoParaCaderneta(MP), null);
  var s = sb({ props: { NOTIF_REGRAS: JSON.stringify([{ id: 'boleto', app: 'bradesco|mercado pago', padrao: 'boleto|fatura|pagamento', acao: 'lembrete_casa' }]) } });
  var r = J(s._notifAplicarRegras(MP));
  assert.strictEqual(r.acao, 'gasto_banco');
});

// ── gasto avulso por voz ─────────────────────────────────────────────────────────────────────────────────────
test('interpretarGasto: valor, meio, local, categoria e dia em várias formas de falar', function () {
  var F = sb().Financas;
  var a = J(F.interpretarGasto('gastei 35 reais no mercado no débito'));
  assert.deepStrictEqual([a.valor, a.meio, a.rotulo, a.descricao, a.categoria, a.dias], [35, 'Pix / débito', 'no débito', 'mercado', 'Mercado', 0]);
  var b = J(F.interpretarGasto('paguei 120,50 de farmácia no pix'));
  assert.deepStrictEqual([b.valor, b.meio, b.descricao, b.categoria], [120.5, 'Pix / débito', 'farmácia', 'Saúde']);
  var c = J(F.interpretarGasto('comprei um lanche de 18 reais no voucher ontem'));
  assert.deepStrictEqual([c.valor, c.carteira, c.dias, c.categoria], [18, 'voucher', 1, 'Alimentação']);
  var d = J(F.interpretarGasto('gastei 60 de gasolina na mobilidade'));
  assert.strictEqual(d.carteira, 'mobilidade');
  var e = J(F.interpretarGasto('gastei 40 reais em dinheiro na padaria'));
  assert.deepStrictEqual([e.meio, e.descricao], ['Dinheiro', 'padaria']);
  var f = J(F.interpretarGasto('gastei 25 reais no cartão de crédito no uber'));
  assert.deepStrictEqual([f.meio, f.categoria], ['Cartão de crédito', 'Transporte']);
  assert.strictEqual(J(F.interpretarGasto('gastei 1.250,90 no mercado no pix')).valor, 1250.9);
  assert.strictEqual(J(F.interpretarGasto('gastei 35 no mercado')).temMeio, false);
});

test('interpretarGasto: perguntas, contas fixas/fatura e frases sem valor NÃO viram gasto', function () {
  var F = sb().Financas;
  ['quanto gastei no mercado', 'onde eu gastei mais', 'quanto eu gastei essa semana', 'paguei o aluguel de 700', 'paguei a fatura do cartão de 387', 'paguei a conta de luz de 150',
   'paguei o dízimo de 400', 'gastei muito esse mês', 'comprei pão', 'que horas são', 'caiu 1000 no voucher'].forEach(function (f) {
    assert.strictEqual(F.interpretarGasto(f), null, f);
  });
  assert.ok(J(F.interpretarGasto('gastei 30000 no pix')).erro, 'acima do limite');
});

test('gasto por voz: propõe repetindo tudo, só o "sim" grava (origem vz, sem dedup), e "desfaz" tira', function () {
  var s = sb();
  var p = J(s.Financas.conversar('gastei 35 reais no mercado no débito'));
  assert.strictEqual(p.resp, 'Confirma o gasto de R$ 35,00 em mercado, no débito, categoria Mercado, hoje? Diga sim ou não.');
  assert.strictEqual(s._posts.length, 0);
  var ok = J(s.Financas.conversar('sim'));
  assert.ok(/Registrei o gasto de R\$ 35,00 em mercado, no débito\. Para desfazer, diga desfaz\./.test(ok.resp), ok.resp);
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.origem, c.valor, c.meio, c.categoria, c.descricao], ['/gasto', 'vz', 35, 'Pix / débito', 'Mercado', 'mercado']);
  assert.ok(/Desfeito: tirei o gasto de R\$ 35,00/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].url, '/gasto/desfazer');
});

test('gasto por voz sem a forma de pagar: pergunta; a resposta completa a proposta; "não" cancela', function () {
  var s = sb();
  var q = J(s.Financas.conversar('gastei 35 no mercado'));
  assert.ok(/Foi no débito, no crédito, no pix, em dinheiro ou no voucher\?/.test(q.resp), q.resp);
  assert.strictEqual(J(s.Financas.conversar('sim')), null, '"sim" não responde à pergunta do meio e não grava');
  var c = J(s.Financas.conversar('no pix'));
  assert.ok(/^Confirma o gasto de R\$ 35,00 em mercado, no pix, categoria Mercado, hoje\?/.test(c.resp), c.resp);
  s.Financas.conversar('não');
  assert.strictEqual(s._posts.length, 0);
  s.Financas.conversar('gastei 20 na padaria');
  assert.ok(/não registrei nada/.test(J(s.Financas.conversar('não')).resp));
});

test('gasto por voz no voucher vai pelo endpoint do Swile; ontem vira a data de ontem; valor alto avisa', function () {
  var s = sb();
  s.Financas.conversar('gastei 18 reais no lanche no voucher ontem');
  s.Financas.conversar('sim');
  assert.strictEqual(s._posts[0].url, '/gasto-voucher');
  assert.deepStrictEqual([s._posts[0].corpo.carteira, s._posts[0].corpo.data], ['voucher', '2026-10-13']);
  assert.ok(/^Esse valor é alto\. Confirma/.test(J(sb().Financas.conversar('gastei 800 no mercado no pix')).resp));
});

test('caderneta fora do ar: a voz diz que não gravou', function () {
  var s = sb({ rede: true });
  s.Financas.conversar('gastei 35 reais no mercado no débito');
  assert.ok(/Não consegui registrar o gasto agora\. Não gravei nada/.test(J(s.Financas.conversar('sim')).resp));
});

// ── aviso falado = aviso notificado; entradas (Pix recebido) com confirmação ───────────────────────────────────
var PIX = { app: 'Bradesco', pacote: '', titulo: 'BRADESCO', texto: 'Você recebeu um Pix de R$ 63,00 de Iago Iglesias Gonçalves Oliveira, da Instituição BANCO PAN' };
var PIX_PROPRIO = { app: 'Bradesco', pacote: '', titulo: 'BRADESCO', texto: 'Você recebeu um Pix de R$ 500,00 de Fulano de Tal Silva, da Instituição MERCADO PAGO IP LTDA.' };

test('todo aviso financeiro sai notificado E falado com o MESMO texto, pela voz do celular', function () {
  var s = sb();
  s._bancoParaCaderneta(MP);
  var a = s._avisos[0];
  assert.strictEqual(a.falar, a.texto); assert.strictEqual(a.falarLocal, true);
  assert.ok(/Registrei R\$ 30,00 em Google CLOUD T7VH4R \(no crédito, Trabalho\)\. Diga desfaz para tirar\./.test(a.texto), a.texto);
  var off = sb({ rede: true });
  off._bancoParaCaderneta(MP);
  assert.ok(/Não consegui falar com a caderneta agora/.test(off._avisos[0].falar), 'falha também fala');
  var sw = sb();
  sw._finGuardarBruto({ app: 'Swile', titulo: 'Compra aprovada', texto: 'Compra aprovada de R$ 12,50 na carteira Refeição e Alimentação, no estabelecimento PADARIA MIRAGO.' });
  assert.strictEqual(sw._avisos[0].falar, sw._avisos[0].texto);
  sw._avisos.length = 0;
  sw.Jarvis.controlarDispositivo = function () { return { status: 'success' }; };
  sw._finPedirSaldo();
  assert.ok(/Caiu a recarga do Swile\. Diga os valores/.test(sw._avisos[0].falar) && sw._avisos[0].falarLocal === true);
});

test('Pix recebido: pergunta "registro como receita extra?" (notifica e fala), e só o sim grava a receita', function () {
  var s = sb();
  var r = J(s._bancoParaCaderneta(PIX));
  assert.strictEqual(r.status, 'aguarda_confirmacao'); assert.strictEqual(s._posts.length, 0, 'nada gravado antes do sim');
  assert.strictEqual(s._avisos[0].falar, 'Você recebeu um Pix de R$ 63,00 de Iago Iglesias Gonçalves Oliveira. Registro como receita extra? Diga sim ou não.');
  var ok = J(s.Financas.conversar('sim'));
  assert.ok(/Registrei a receita extra de R\$ 63,00 de Iago Iglesias Gonçalves Oliveira \(Outros\)\. Para desfazer, diga desfaz\./.test(ok.resp), ok.resp);
  var c = s._posts[0].corpo;
  assert.deepStrictEqual([s._posts[0].url, c.origem, c.valor, c.categoria], ['/receita', 'bd', 63, 'Outros']);
  assert.ok(/Desfeito: tirei a receita de R\$ 63,00/.test(J(s.Financas.conversar('desfaz')).resp));
  assert.strictEqual(s._posts[1].url, '/receita/desfazer');
});

test('Pix recebido: "sim, é reembolso" define a categoria; "não" descarta; sem resposta nada é gravado', function () {
  var s = sb();
  s._bancoParaCaderneta(PIX);
  s.Financas.conversar('sim, é reembolso');
  assert.strictEqual(s._posts[0].corpo.categoria, 'Reembolso');
  var n = sb();
  n._bancoParaCaderneta(PIX);
  assert.ok(/não registrei a receita/.test(J(n.Financas.conversar('não')).resp));
  assert.strictEqual(n._posts.length, 0);
  var q = sb();
  q._bancoParaCaderneta(PIX);
  q.CacheService.getScriptCache().remove('fin_pend_entrada');   // passaram os 15 min
  assert.strictEqual(J(q.Financas.conversar('sim')), null); assert.strictEqual(q._posts.length, 0);
});

test('Pix de você mesmo (FIN_NOME_DONO) é transferência entre contas: avisa e NÃO propõe receita', function () {
  var s = sb({ props: { FIN_NOME_DONO: 'fulano de tal silva' } });
  var r = J(s._bancoParaCaderneta(PIX_PROPRIO));
  assert.strictEqual(r.status, 'transferencia_propria'); assert.strictEqual(s._posts.length, 0);
  assert.ok(/transferência entre as suas contas, não registrei como receita/.test(s._avisos[0].falar));
  assert.strictEqual(J(s.Financas.conversar('sim')), null, 'não ficou nada esperando o sim');
  // sem o nome configurado, pergunta (na dúvida, quem decide é ele)
  assert.strictEqual(J(sb()._bancoParaCaderneta(PIX_PROPRIO)).status, 'aguarda_confirmacao');
});

test('receita por voz: "recebi 450 da Maria no pix" propõe, sim grava; salário e rendimento não entram', function () {
  var s = sb();
  var p = J(s.Financas.conversar('recebi 450 da Maria no pix'));
  assert.ok(/^Confirma a receita extra de R\$ 450,00 de Maria, hoje\? Diga sim ou não\.$/.test(p.resp), p.resp);
  s.Financas.conversar('sim');
  assert.deepStrictEqual([s._posts[0].url, s._posts[0].corpo.origem, s._posts[0].corpo.valor, s._posts[0].corpo.descricao], ['/receita', 'vz', 450, 'maria']);
  ['recebi o salário de 3800', 'quanto recebi esse mês', 'recebi o rendimento de 12'].forEach(function (f) {
    assert.strictEqual(sb().Financas.conversar(f), null, f);
  });
});

test('repetir o gasto inteiro enquanto espera a forma de pagar REFAZ a proposta (não cai no modelo)', function () {
  var s = sb();
  s.Financas.conversar('gastei 35 reais no mercado');
  var r = J(s.Financas.conversar('gastei 35 reais no mercado'));
  assert.ok(r && /Foi no débito, no crédito, no pix, em dinheiro ou no voucher\?/.test(r.resp), 'continua perguntando, sem LLM');
  var c = J(s.Financas.conversar('gastei 35 reais no mercado no débito'));
  assert.ok(/^Confirma o gasto de R\$ 35,00 em mercado, no débito/.test(c.resp), c.resp);
});
