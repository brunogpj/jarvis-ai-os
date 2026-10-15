// relatorios.test.js — botões "Investimentos / FIIs / Atividades" do web app (15/10/2026). O botão antigo mandava "Execute a automação: Relatório de FIIs" ao modelo,
// que não achou automação e inventou uma tabela do IFIX. Agora vem da caderneta/log, no código. Dados INVENTADOS.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

var DADOS = {
  mes: '2026-10', hoje: '2026-10-15', livreHoje: 100, livreFim: 400, aPagar: 0, obrigacoes: [], orcamentos: [], receitas: [], reservaMeses: 4.2,
  metaAlocacao: { 'Renda fixa': 60, 'FII': 25, 'Ações': 15 },
  investimentos: { total: 0, porCategoria: {}, itens: [
    { nome: 'CDB Exemplo', instituicao: 'Banco X', categoria: 'Renda fixa', saldo: 8000, rendimentoAno: 640, liquidez: 'D+0', atualizado: '2026-10-10' },
    { nome: 'FII Alfa', instituicao: 'Corretora Y', categoria: 'FII', saldo: 1500, rendimentoAno: 120, liquidez: 'D+2', atualizado: '2026-08-01' },
    { nome: 'FII Beta', instituicao: 'Corretora Y', categoria: 'FII', saldo: 500, rendimentoAno: 0, liquidez: 'D+2', atualizado: '2026-10-10' } ] }
};
function sb() {
  var s = makeSandbox({ props: { OWNER_EMAIL: 'dono@exemplo.com', FIN_API_URL: 'https://caderneta.exemplo.dev', FIN_API_TOKEN: 'c'.repeat(40) },
    fetch: function (url) { if (/caderneta/.test(url)) return { code: 200, body: DADOS }; return { code: 404, body: {} }; } });
  loadGasFile('TypeSafe.js', s); loadGasFile('AlertasVoz.js', s); loadGasFile('Consultor.js', s); loadGasFile('Financas.js', s); loadGasFile('Code.js', s);
  return s;
}
var J = function (x) { return JSON.parse(JSON.stringify(x)); };

test('interpretarRelatorio: pega o pedido dos botões e dos meus investimentos; não pega análise de mercado nem agendamento', function () {
  var s = sb(), f = s.Financas.interpretarRelatorio;
  assert.deepStrictEqual(J(f('execute a automacao relatorio de fiis')), { tipo: 'relatorio', classe: 'fii' });
  assert.deepStrictEqual(J(f('execute a automacao relatorio de investimentos')), { tipo: 'relatorio' });
  assert.deepStrictEqual(J(f('raio x da minha carteira')), { tipo: 'relatorio' });
  assert.deepStrictEqual(J(f('analisa meus investimentos')), { tipo: 'relatorio' });
  assert.strictEqual(f('analisar principais fiis do ifix'), null);
  assert.strictEqual(f('quais os melhores fiis para comprar'), null);
  assert.strictEqual(f('crie um relatorio de fiis todo dia'), null);
  assert.strictEqual(f('qual a previsao do tempo'), null);
});

test('relatorio (chat): tabelas por categoria e por investimento, com pontos de atenção e aviso de que não há cotação', function () {
  var s = sb(), t = s.Financas.relatorio({ tipo: 'relatorio' }, 'chat');
  assert.match(t, /Relatório de investimentos/);
  assert.match(t, /\| CDB Exemplo \|/);
  assert.match(t, /Saldo desatualizado:\*\* FII Alfa/);
  assert.match(t, /Não inclui cotações de mercado/);
});

test('relatorio por classe e em voz', function () {
  var s = sb(), t = s.Financas.relatorio({ tipo: 'relatorio', classe: 'fii' }, 'chat');
  assert.match(t, /FII Alfa/); assert.doesNotMatch(t, /CDB Exemplo/);
  var v = s.Financas.relatorio({ tipo: 'relatorio' }, 'voz');
  assert.match(v, /somam R\$ 10\.000,00/);
  assert.match(s.Financas.relatorio({ tipo: 'relatorio', classe: 'acoes' }, 'chat'), /Não achei a classe/);
});

test('_rotaDireta intercepta os dois botões antes do modelo', function () {
  var s = sb();
  assert.match(s._rotaDireta('Execute a automação: Relatório de FIIs', 'dono@exemplo.com', true), /FII Alfa/);
  assert.match(s._rotaDireta('Execute a automação: Relatório de Investimentos', 'dono@exemplo.com', true), /CDB Exemplo/);
  assert.strictEqual(s._rotaDireta('Execute a automação: Relatório de FIIs', 'outro@x.com', false), null);
  assert.ok(s._rotaDireta('Execute a automação: Relatório de Atividade', 'dono@exemplo.com', true), 'atividade vem do código, não do modelo');
  assert.ok(s._rotaDireta('o que o jarvis fez hoje', 'dono@exemplo.com', true));
});

test('_relatorioAtividade: soma as últimas 24 h do log e ignora o que é mais velho', function () {
  var s = sb(), agora = Date.parse('2026-10-15T12:00:00Z');
  var ev = [
    { tool: 'voz:caderneta', ts: '2026-10-15T10:00:00Z', ok: true }, { tool: 'voz:caderneta', ts: '2026-10-15T11:00:00Z', ok: true },
    { tool: 'buscarConhecimento', ts: '2026-10-15T09:00:00Z', ok: true, ms: 2000 }, { tool: 'buscarConhecimento', ts: '2026-10-15T09:30:00Z', ok: false, ms: 4000 },
    { tool: 'voz:antigo', ts: '2026-10-10T09:00:00Z', ok: true } ];
  var t = s._relatorioAtividade(ev, agora);
  assert.match(t, /voz:caderneta|caderneta 2/); assert.match(t, /\| buscarConhecimento \| 2 \| 3 s \| 1 \|/);
  assert.doesNotMatch(t, /antigo/);
  assert.match(s._relatorioAtividade([], agora), /Nenhum evento/);
});
