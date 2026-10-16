// dashboard-custos-saude.test.js — cartões "Custos de IA" e "Saúde do sistema" do Dashboard (16/10/2026). Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb(props) {
  var s = makeSandbox({ props: Object.assign({ OWNER_EMAIL: 'dono@exemplo.com' }, props || {}) });
  ['GastoIA.js', 'Heartbeat.js', 'Code.js'].forEach(function (f) { loadGasFile(f, s); });
  s.getSessionUser = function (t) { return t === 'tok-dono' ? { email: 'dono@exemplo.com', nome: 'Dono' } : (t === 'tok-outro' ? { email: 'outro@exemplo.com' } : null); };
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
var AGORA = Date.parse('2026-10-16T20:00:00Z');
var iso = function (min) { return new Date(AGORA - min * 60000).toISOString(); };

test('Custos: ordena por gasto, calcula parte, média, dias até o teto e o status (ok / atenção / esgotado)', function () {
  var s = sb();
  var g = { mes: '2026-10', gastoBRL: 6.4, tetoBRL: 29.65, pct: 21.6, projecaoBRL: 13.22, chamadas: 411, buscas: 20, cambio: 5.7, esgotado: false, mesAnterior: { mes: '2026-09', usd: 1 },
            porModelo: { 'gemini-3.8-flash-lite-tts': { chamadas: 30, brl: 1.6 }, 'gemini-3.8-flash': { chamadas: 300, brl: 4.8 } } };
  var r = J(s._custosMontar(g, { hoje: '2026-10-16', modelos: { agente: 'gemini-3.8-flash' }, ordem: 'billing_first', freeOnly: 'false' }));
  assert.deepStrictEqual(r.porModelo.map(function (m) { return [m.modelo, m.pct]; }), [['gemini-3.8-flash', 75], ['gemini-3.8-flash-lite-tts', 25]]);
  assert.deepStrictEqual([r.status, r.mediaDia, r.diasAteTeto, r.mesAnterior.brl, r.travaAtiva], ['ok', 0.4, 58, 5.7, true]);
  assert.strictEqual(J(s._custosMontar(Object.assign({}, g, { projecaoBRL: 40 }), { hoje: '2026-10-16' })).status, 'atencao');
  var e = J(s._custosMontar(Object.assign({}, g, { esgotado: true, gastoBRL: 30 }), { hoje: '2026-10-16' }));
  assert.deepStrictEqual([e.status, e.diasAteTeto], ['esgotado', null]);
  assert.strictEqual(J(s._custosMontar({}, { hoje: '2026-10-01', travaAtiva: 'nao' })).travaAtiva, false);
});

test('dashboardCustos: lê o GastoIA e as properties, e só o dono vê', function () {
  var s = sb({ GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_ORDER: 'billing_first', GEMINI_API_KEY: 'k' });
  var r = s.dashboardCustos('tok-dono');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.modelos.agente, 'gemini-3.8-flash'); assert.strictEqual(r.chaves.faturamento, true);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(s.dashboardCustos('tok-outro').ok, false); assert.strictEqual(s.dashboardCustos('x').ok, false);
});

test('Saúde: tudo em dia = ok; job atrasado ou sem gatilho = crítico; erro e pico lento = atenção', function () {
  var s = sb();
  var base = { agora: AGORA, hb: { itens: [{ nome: 'agenda', ativo: true, idadeMin: 5, limiteMin: 40, atrasado: false, temTrigger: true }] }, triggers: ['a', 'b'],
    diario: { dia: '2026-10-16', h: { tickAlertasVoz: { n: 600, ms: 600000, max: 12000, erros: 0, maxEm: '10:00:00' } } }, eventos: [] };
  var ok = J(s._saudeMontar(base));
  assert.deepStrictEqual([ok.nivel, ok.alertas.length, ok.orcamento.pct, ok.instalados], ['ok', 0, 11.1, 2]);
  var atrasado = J(s._saudeMontar(Object.assign({}, base, { hb: { itens: [{ nome: 'alertasVoz', ativo: true, idadeMin: 30, limiteMin: 6, atrasado: true, temTrigger: false }] } })));
  assert.strictEqual(atrasado.nivel, 'critico'); assert.match(atrasado.alertas[0], /"alertasVoz" está atrasado \(última batida há 30 min\) e SEM gatilho/);
  var semGat = J(s._saudeMontar(Object.assign({}, base, { hb: { itens: [{ nome: 'agenda', ativo: true, idadeMin: 5, limiteMin: 40, atrasado: false, temTrigger: false }] } })));
  assert.strictEqual(semGat.nivel, 'critico');
  var lento = J(s._saudeMontar(Object.assign({}, base, { diario: { h: { tickAlertasVoz: { n: 10, ms: 2200000, max: 220000, erros: 2, ultErro: 'boom', maxEm: '09:30:00' } } } })));
  assert.strictEqual(lento.nivel, 'atencao');
  assert.ok(lento.alertas.some(function (a) { return /pico de 220 s às 09:30:00/.test(a); }) && lento.alertas.some(function (a) { return /2 erros hoje \(boom\)/.test(a); }));
});

test('Saúde: duração do briefing, briefing que começou e não terminou, e falhas das últimas 24 h', function () {
  var s = sb();
  var base = { agora: AGORA, hb: { itens: [] }, triggers: [], diario: { h: {} }, ub: { em: AGORA - 3600e3, tag: 'briefing_manha', texto: 'x'.repeat(900) } };
  var feito = J(s._saudeMontar(Object.assign({}, base, { eventos: [{ tool: 'briefing:inicio', ok: true, ts: iso(65) }, { tool: 'alertaVoz:briefing_manha', ok: true, ms: 1, ts: iso(60) }] })));
  assert.deepStrictEqual([feito.briefing.ultimoInicio.duracaoS, feito.briefing.ultimoInicio.ok, feito.briefing.semTerminar, feito.briefing.ultimo.caracteres], [300, true, false, 900]);
  assert.ok(feito.alertas.some(function (a) { return /levou 300 s/.test(a); }), 'coleta longa vira alerta');
  var morreu = J(s._saudeMontar(Object.assign({}, base, { eventos: [{ tool: 'briefing:inicio', ok: true, ts: iso(30) }] })));
  assert.strictEqual(morreu.briefing.semTerminar, true); assert.ok(morreu.alertas.some(function (a) { return /não terminou/.test(a); }));
  var recente = J(s._saudeMontar(Object.assign({}, base, { eventos: [{ tool: 'briefing:inicio', ok: true, ts: iso(2) }] })));
  assert.strictEqual(recente.briefing.semTerminar, false, 'em andamento ainda não é falha');
  var evs = []; for (var i = 0; i < 7; i++) evs.push({ tool: 'buscarConhecimento', ok: false, ts: iso(100 + i) }); evs.push({ tool: 'x', ok: false, ts: iso(3000) });
  var er = J(s._saudeMontar(Object.assign({}, base, { eventos: evs })));
  assert.deepStrictEqual([er.erros24h.total, er.erros24h.top[0]], [7, { tool: 'buscarConhecimento', n: 7 }]); assert.ok(er.alertas.some(function (a) { return /7 eventos com falha/.test(a); }));
});

test('dashboardSaude: junta Heartbeat, diário e eventos; só o dono vê', function () {
  var s = sb(); s.Firestore = { listDocs: function () { return [{ id: 'e1', dados: { tool: 'x', ok: true, ts: new Date().toISOString() } }]; } };
  var r = s.dashboardSaude('tok-dono');
  assert.strictEqual(r.ok, true); assert.ok(Array.isArray(r.jobs) && Array.isArray(r.gatilhos));
  assert.strictEqual(s.dashboardSaude('tok-outro').ok, false);
});

test('Interface: cada cartão com a sua chamada, texto escapado e CSS das classes novas', function () {
  var JS = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8'), CSS = fs.readFileSync(path.join(__dirname, '..', 'Stylesheet.html'), 'utf8');
  assert.match(JS, /\.dashboardCustos\(authToken\)/); assert.match(JS, /\.dashboardSaude\(authToken\)/); assert.match(JS, /montarCardsCustosSaude\(cards\);/);
  var b = JS.slice(JS.indexOf('/*DASH_CS_INI*/'), JS.indexOf('/*DASH_CS_FIM*/'));
  assert.doesNotMatch(b, /innerHTML[^;]*\+\s*(d|g|j|m|e)\.(erro|nome|modelo|tool|ultErro)\b(?![^;]*escapeHtml)/, 'nada vindo do servidor entra no HTML sem escapeHtml');
  ['cs-barra', 'cs-tab', 'cs-mini', 'sh-alertas', 'cs-gasto'].forEach(function (c) { assert.ok(CSS.indexOf('.' + c) !== -1, 'CSS de ' + c); });
});
