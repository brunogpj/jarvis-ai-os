// notif-fala-unica.test.js — 11/11/2026: notificação do Agenda Edu (app em NOTIF_FALAR_APPS + regra 'avisar' em modo falar) era lida DUAS vezes.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function sb() {
  var s = makeSandbox({ props: { NOTIF_FALAR_JANELA: '00:00-23:59' } });
  s.Jarvis = { falas: [], controlarDispositivo: function (a) { if (a.acao === 'falar') s.Jarvis.falas.push(a.texto); return { status: 'success' }; }, registrarEvento: function () {} };
  s.Utilities.formatDate = function () { return '2026-11-11'; };
  loadGasFile('Code.js', s);
  s._notifRoteia = function () { return 'falar'; };
  s._notifRegras = function () { return [{ id: 'r1', acao: 'avisar', app: 'agenda edu' }]; };
  s._notifRegraCasa = function () { return true; };
  return s;
}
var DOC = { app: 'Agenda Edu', titulo: 'Catracas', texto: 'Informamos que o aluno entrou', em: Date.now() };

test('app em NOTIF_FALAR_APPS + regra em modo falar: lê UMA vez', function () {
  var s = sb();
  s._notifProcessar({ doc: DOC, querFalar: true });
  assert.strictEqual(s.Jarvis.falas.length, 1);
});

test('sem a fala do job, a regra continua falando (uma vez)', function () {
  var s = sb();
  s._notifProcessar({ doc: DOC, querFalar: false });
  assert.strictEqual(s.Jarvis.falas.length, 1);
});
