// jarvis.test.js — testes da LÓGICA determinística do Code.js (MODO DIRETO + gate sem-cota),
// rodando 100% local (node --test), sem deploy/nuvem/cota. Pega regressões antes do clasp push.
var test = require('node:test');
var assert = require('node:assert');
var { makeSandbox } = require('./gas-shims');
var { loadGasFile } = require('./load');

function code(o) { return loadGasFile('Code.js', makeSandbox(o)); }

// ───────────────────────── _ehErroCota ─────────────────────────
test('_ehErroCota detecta quota/429/spending cap', function () {
  var s = code();
  assert.ok(s._ehErroCota('HTTP 429: quota'));
  assert.ok(s._ehErroCota('Your project has exceeded its monthly spending cap'));
  assert.ok(s._ehErroCota('RESOURCE_EXHAUSTED'));
  assert.ok(!s._ehErroCota('erro de rede qualquer'));
});

// ───────────────────────── MODO DIRETO (_rotaDireta) ─────────────────────────
test('MODO DIRETO: e-mails não lidos = 0', function () {
  var r = code({ emails: [] })._rotaDireta('Liste meus e-mails não lidos', 'dono@exemplo.com', true);
  assert.match(r, /não tem e-mails não lidos/i);
});

test('MODO DIRETO: e-mails não lidos com itens (contagem + principais)', function () {
  var r = code({ emails: [{ assunto: 'Proposta', de: 'João <j@x.com>' }] })
    ._rotaDireta('quantos e-mails não lidos?', 'dono@exemplo.com', true);
  assert.match(r, /1 e-mail/);
  assert.match(r, /Proposta/);
});

test('MODO DIRETO: NÃO intercepta "resuma" (precisa do LLM)', function () {
  var r = code({ emails: [{ assunto: 'X', de: 'y' }] })
    ._rotaDireta('resuma meus 3 principais e-mails', 'dono@exemplo.com', true);
  assert.strictEqual(r, null);
});

test('MODO DIRETO: "o que tenho na agenda" é interceptado (bug do substantivo "agenda")', function () {
  var r = code({ eventos: ['Parabéns!'] })._rotaDireta('O que tenho na agenda esta semana?', 'dono@exemplo.com', true);
  assert.match(r, /Parabéns/);
});

test('MODO DIRETO: agenda vazia', function () {
  var r = code({ eventos: [] })._rotaDireta('quais meus próximos compromissos?', 'dono@exemplo.com', true);
  assert.match(r, /Nada na sua agenda/i);
});

test('MODO DIRETO: NÃO intercepta criação de evento', function () {
  var r = code()._rotaDireta('crie um evento amanhã às 10h', 'dono@exemplo.com', true);
  assert.strictEqual(r, null);
});

test('MODO DIRETO: NÃO intercepta "agende um evento"', function () {
  var r = code()._rotaDireta('agende um evento para amanhã', 'dono@exemplo.com', true);
  assert.strictEqual(r, null);
});

test('MODO DIRETO: Zero-Trust — não-dono não acessa dados', function () {
  var r = code({ emails: [{ assunto: 'X', de: 'y' }] })
    ._rotaDireta('liste e-mails não lidos', 'outro@x.com', false);
  assert.strictEqual(r, null);
});

test('MODO DIRETO: tarefas', function () {
  var r = code({ tarefas: ['Comprar pão', 'Ligar cliente'] })
    ._rotaDireta('liste minhas tarefas', 'dono@exemplo.com', true);
  assert.match(r, /Comprar pão/);
  assert.match(r, /Ligar cliente/);
});

test('MODO DIRETO: autorizações pendentes (vazio)', function () {
  var r = code({ autorizacoes: [] })._rotaDireta('autorizações pendentes', 'dono@exemplo.com', true);
  assert.match(r, /Nenhuma autorização pendente/i);
});

test('MODO DIRETO: pergunta de conhecimento geral → null (não é leitura)', function () {
  var r = code()._rotaDireta('explique o que é RAG', 'dono@exemplo.com', true);
  assert.strictEqual(r, null);
});

// ───────────────────────── Gate sem-cota (_semCotaFallback) ─────────────────────────
test('sem-cota: anexo → aviso honesto, NUNCA reserva (não inventa OCR)', function () {
  var r = code()._semCotaFallback('429 quota', 'faça OCR', [], true);
  assert.match(r, /anexos/i);
  assert.ok(!/modo reserva/i.test(r));
});

test('sem-cota: ação (enviar) → aviso honesto', function () {
  var r = code()._semCotaFallback('429 quota', 'envie "oi" para o Bruno', [], false);
  assert.match(r, /ações/i);
  assert.ok(!/modo reserva/i.test(r));
});

test('sem-cota: conversa → reserva ESTRITA (com selo)', function () {
  var r = code({ reserva: 'RAG é recuperação aumentada.' })
    ._semCotaFallback('429 quota', 'explique RAG', [], false);
  assert.match(r, /modo reserva/i);
  assert.match(r, /RAG é recupera/);
});

test('sem-cota: erro que NÃO é de cota → null (deixa o fluxo normal)', function () {
  var r = code()._semCotaFallback('erro de rede', 'oi', [], false);
  assert.strictEqual(r, null);
});

// ───────────────────────── 📺 _extrairYouTubeUrl (composer: Gemini "assiste" YouTube) ─────────────────────────
test('_extrairYouTubeUrl: reconhece watch/shorts/youtu.be e ignora o resto', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  assert.strictEqual(
    s._extrairYouTubeUrl('resuma este vídeo https://www.youtube.com/watch?v=dQw4w9WgXcQ por favor'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(
    s._extrairYouTubeUrl('veja https://youtu.be/dQw4w9WgXcQ.'),
    'https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(
    s._extrairYouTubeUrl('https://m.youtube.com/shorts/Ab3-xY9_p1Q'),
    'https://m.youtube.com/shorts/Ab3-xY9_p1Q');
  assert.strictEqual(s._extrairYouTubeUrl('acesse https://vimeo.com/12345 hoje'), null);
  assert.strictEqual(s._extrairYouTubeUrl('sem link nenhum aqui'), null);
  // preserva parâmetros (timestamp) e não engole pontuação final
  assert.strictEqual(
    s._extrairYouTubeUrl('olha https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s!'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
});

// ───────────────────────── TURNO DE TRABALHO (AlertasVoz + rota direta) — re-adicionados ─────────────────────────
test('Turno: interpretarTurno entende manhã/tarde e rejeita o resto', function () {
  var s = makeSandbox({}); loadGasFile('AlertasVoz.js', s);
  assert.strictEqual(s.AlertasVoz.interpretarTurno('essa semana vou trabalhar no turno da manhã'), 'manha');
  assert.strictEqual(s.AlertasVoz.interpretarTurno('turno da tarde'), 'tarde');
  assert.strictEqual(s.AlertasVoz.interpretarTurno('turno vespertino'), 'tarde');
  assert.strictEqual(s.AlertasVoz.interpretarTurno('qualquer coisa'), null);
});

test('Turno: definirTurno cria os 4 alertas de ponto Seg–Sex e trocar substitui sem duplicar', function () {
  var s = makeSandbox({}); loadGasFile('AlertasVoz.js', s);
  var r = s.AlertasVoz.definirTurno('vou trabalhar no turno da tarde');
  assert.ok(r.ok); assert.strictEqual(r.turno, 'tarde');
  var alertas = s.AlertasVoz.listar().filter(function (a) { return a.tag === 'ponto'; });
  assert.strictEqual(alertas.length, 4);
  assert.deepStrictEqual([...alertas.map(function (a) { return a.hora; })].sort(function (a, b) { return a - b; }), [14, 19, 20, 23]);
  var r2 = s.AlertasVoz.definirTurno('manha');
  assert.ok(r2.ok);
  var a2 = s.AlertasVoz.listar().filter(function (a) { return a.tag === 'ponto'; });
  assert.strictEqual(a2.length, 4);
  assert.deepStrictEqual([...a2.map(function (a) { return a.hora; })].sort(function (a, b) { return a - b; }), [8, 12, 13, 16]);
});

test('MODO DIRETO: define turno por voz sem LLM e responde consulta do turno atual', function () {
  var s = makeSandbox({});
  loadGasFile('AlertasVoz.js', s);
  loadGasFile('Code.js', s);
  var r = s._rotaDireta('Jarvis, essa semana eu irei trabalhar no turno da manhã', 'dono@exemplo.com', true);
  assert.match(r, /Turno da manhã ativado/i);
  assert.match(r, /16:45/);
  var q = s._rotaDireta('qual meu turno atual?', 'dono@exemplo.com', true);
  assert.match(q, /manhã/);
});

test('Turno: definirTurno remove tambem alertas de ponto LEGADOS ("Marcar ponto digital...")', function () {
  var s = makeSandbox({ props: { ALERTAS_VOZ: JSON.stringify([
    { id: 'leg1', hora: 12, minuto: 0, dias: [1,2,3,4,5], texto: 'Marcar ponto digital para almoço.', ativo: true },
    { id: 'leg2', hora: 16, minuto: 45, dias: [1,2,3,4,5], texto: 'Marcar ponto digital para fim do trabalho.', ativo: true },
    { id: 'out1', hora: 6, minuto: 30, dias: [], texto: 'Bom dia! Resumo do dia.', dinamico: true, ativo: true }
  ]) } });
  loadGasFile('AlertasVoz.js', s);
  var r = s.AlertasVoz.definirTurno('turno da manhã');
  assert.ok(r.ok);
  var arr = s.AlertasVoz.listar();
  var pontos = arr.filter(function (a) { return /marcar (o )?ponto/i.test(a.texto); });
  assert.strictEqual(pontos.length, 4, 'legados substituídos: só os 4 novos de ponto');
  assert.ok(pontos.every(function (a) { return a.tag === 'ponto'; }), 'todos os novos levam tag ponto');
  assert.ok(arr.some(function (a) { return a.id === 'out1'; }), 'alerta NÃO-ponto (despertador) é preservado');
});

// ───────────────────────── 🌐 pesquisarWeb: cascata free-first com cooldown de 429 ─────────────────────────
test('pesquisarWeb: 429 na 1ª chave → troca de chave/modelo; 2ª chamada pula cooldown', function () {
  var s = makeSandbox({ props: { GEMINI_API_KEY_FALLBACK: 'FREE1', GEMINI_API_KEY_FALLBACK2: 'FREE2', GEMINI_API_KEY: 'BILL' } });
  var chamadas = [];
  s.UrlFetchApp = { fetch: function (url) {
    chamadas.push(url);
    var ok = url.indexOf('key=FREE2') !== -1; // FREE1 esgotada (429); FREE2 tem cota
    return {
      getResponseCode: function () { return ok ? 200 : 429; },
      getContentText: function () {
        return ok
          ? JSON.stringify({ candidates: [{ content: { parts: [{ text: 'resposta da web' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'Fonte', uri: 'https://x' } }] } }] })
          : JSON.stringify({ error: { message: 'quota exceeded' } });
      }
    };
  } };
  loadGasFile('Gemini.js', s);
  var r = s.Gemini.pesquisarWeb('cotação do dólar hoje');
  assert.strictEqual(r.texto, 'resposta da web');
  assert.strictEqual([...r.fontes].length, 1);
  assert.strictEqual(chamadas.length, 3, 'FREE1 x 2 modelos (429) + FREE2 (200)');
  // 2ª chamada: combinações 429 estão em cooldown → vai direto à FREE2 (1 único fetch)
  chamadas.length = 0;
  var r2 = s.Gemini.pesquisarWeb('cotação do dólar hoje');
  assert.strictEqual(r2.texto, 'resposta da web');
  assert.strictEqual(chamadas.length, 1, 'cooldown pulou as combinações esgotadas');
});

// ───────────────────────── 📎📎 _normalizarAnexos (multi-anexo do composer) ─────────────────────────
test('_normalizarAnexos: único, multi, array, inválidos e teto de 5', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  var img = { tipo: 'inline', mimeType: 'image/png', data: 'AAA', nome: 'a.png' };
  var pdf = { tipo: 'inline', mimeType: 'application/pdf', data: 'BBB', nome: 'b.pdf' };
  var txt = { tipo: 'texto', texto: 'ola', nome: 'c.txt' };
  // objeto único → principal, sem extras
  var r1 = s._normalizarAnexos(img);
  assert.strictEqual(r1.principal.nome, 'a.png');
  assert.strictEqual([...r1.extras].length, 0);
  // {tipo:'multi'} → 1º principal, resto extras
  var r2 = s._normalizarAnexos({ tipo: 'multi', anexos: [img, pdf, txt] });
  assert.strictEqual(r2.principal.nome, 'a.png');
  assert.deepStrictEqual([...r2.extras.map(function (a) { return a.nome; })], ['b.pdf', 'c.txt']);
  // inválidos (sem data/texto) são filtrados
  var r3 = s._normalizarAnexos({ tipo: 'multi', anexos: [null, { tipo: 'inline' }, pdf] });
  assert.strictEqual(r3.principal.nome, 'b.pdf');
  assert.strictEqual([...r3.extras].length, 0);
  // teto: 7 anexos → 1 principal + 4 extras
  var sete = [img, pdf, txt, img, pdf, txt, img];
  var r4 = s._normalizarAnexos(sete);
  assert.strictEqual([...r4.extras].length, 4);
  // null → null, sem extras
  var r5 = s._normalizarAnexos(null);
  assert.strictEqual(r5.principal, null);
});

// ───────────────────────── 🏠 _montarBriefingChegada (briefing determinístico, zero LLM) ─────────────────────────
test('Briefing de chegada: monta turno + agenda + tarefas + e-mails sem LLM', function () {
  var s = makeSandbox({
    props: { TURNO_TRABALHO_ATUAL: 'tarde' },
    eventos: ['Reunião com a diretoria'],
    tarefas: ['Emitir CT-e da carga 123', 'Revisar tabela de frete'],
    emails: [{ assunto: 'Fatura Bradesco', de: 'banco <b@x.com>' }]
  });
  loadGasFile('AlertasVoz.js', s);
  loadGasFile('Code.js', s);
  var b = s._montarBriefingChegada();
  assert.match(b, /Jarvis com o seu resumo/);
  assert.match(b, /turno desta semana é o da tarde/);
  assert.match(b, /Reunião com a diretoria/);
  assert.match(b, /2 tarefas pendentes/);
  assert.match(b, /Emitir CT-e da carga 123/);
  assert.match(b, /1 e-mail não lido/);
  assert.match(b, /Fatura Bradesco/);
});

test('Briefing de chegada: dia limpo (sem eventos/tarefas/e-mails) fala versão tranquila', function () {
  var s = makeSandbox({ eventos: [], tarefas: [], emails: [] });
  loadGasFile('Code.js', s);
  var b = s._montarBriefingChegada();
  assert.match(b, /Agenda livre/);
  assert.match(b, /Nenhuma tarefa pendente/);
  assert.match(b, /Caixa de entrada em dia/);
});

// ───────────────────────── 🔊 doPost {action:'falar'}: blindagem de texto-mágico não resolvido ─────────────────────────
test('falar: remove códigos {not_...} não resolvidos e rejeita texto que era só código', function () {
  var falas = [];
  var s = makeSandbox({ props: { VOICE_API_TOKEN: 'TOK123' } });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  loadGasFile('Code.js', s);
  s.Jarvis.controlarDispositivo = function (o) { falas.push(o.texto); return { status: 'success' }; };
  var post = function (texto) {
    return s.doPost({ postData: { contents: JSON.stringify({ action: 'falar', texto: texto, token: 'TOK123' }) } }).getContentText();
  };
  // Códigos não resolvidos são removidos antes de falar
  var r1 = post('Notificação do {not_app_name}: {not_title}. Versículo do dia disponível. {not_ticker}');
  assert.match(r1, /OK/);
  assert.strictEqual(falas.length, 1);
  assert.ok(falas[0].indexOf('not_app_name') === -1 && falas[0].indexOf('{') === -1, 'nenhum código literal falado');
  assert.match(falas[0], /Versículo do dia disponível/);
  // Texto que era SÓ código → erro claro, nada é falado
  var r2 = post('{not_title}. {not_ticker}');
  assert.match(r2, /Erro: Texto ausente/);
  assert.strictEqual(falas.length, 1, 'não falou o texto vazio');
  // Texto normal passa intacto
  var r3 = post('Bruno, sua carga chegou.');
  assert.match(r3, /OK/);
  assert.strictEqual(falas[1], 'Bruno, sua carga chegou.');
});

// ───────────────────────── ⚙️ _validarPrefsUI (Preferências do Jarvis — whitelist estrita) ─────────────────────────
test('_validarPrefsUI: aceita valores válidos e mapeia para as properties certas', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  var r = s._validarPrefsUI({ ttsEngine: 'GEMINI', vozGemini: 'Sulafat', estilo: 'tom calmo', volumeDb: 8, modoBot: 'secretaria' });
  assert.strictEqual([...r.erros].length, 0);
  assert.strictEqual(r.valores.TTS_ENGINE, 'gemini');
  assert.strictEqual(r.valores.TTS_VOICE_GEMINI, 'Sulafat');
  assert.strictEqual(r.valores.TTS_STYLE, 'tom calmo');
  assert.strictEqual(r.valores.FALA_VOLUME_DB, '8');
  assert.strictEqual(r.valores.WHATSAPP_BOT_MODE, 'secretaria');
});

test('_validarPrefsUI: rejeita inválidos e NUNCA deixa passar chave fora da whitelist', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  var r = s._validarPrefsUI({ ttsEngine: 'hacker', vozGemini: 'a; DROP', volumeDb: 99, modoBot: 'root', GEMINI_API_KEY: 'roubo', PASSWORD_SALT: 'x' });
  assert.strictEqual([...r.erros].length, 4, 'os 4 campos inválidos geram erro');
  assert.deepStrictEqual([...Object.keys(r.valores)], [], 'nada é salvo com erro — e chaves estranhas são ignoradas');
  // parcial: só campos presentes são validados (edição parcial funciona)
  var r2 = s._validarPrefsUI({ volumeDb: 0 });
  assert.strictEqual([...r2.erros].length, 0);
  assert.deepStrictEqual([...Object.keys(r2.valores)], ['FALA_VOLUME_DB']);
  assert.strictEqual(r2.valores.FALA_VOLUME_DB, '0');
});

// ───────────────────────── ⚙️ _validarPrefsUI (Preferências do popover — whitelist estrita) ─────────────────────────
test('_validarPrefsUI: aceita valores válidos, rejeita inválidos e NUNCA passa chaves fora da whitelist', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  // Válidos
  var ok = s._validarPrefsUI({ ttsEngine: 'GEMINI', vozGemini: 'Sulafat', estilo: 'tom calmo', volumeDb: 12, modoBot: 'secretaria' });
  assert.strictEqual([...ok.erros].length, 0);
  assert.strictEqual(ok.valores.TTS_ENGINE, 'gemini');
  assert.strictEqual(ok.valores.TTS_VOICE_GEMINI, 'Sulafat');
  assert.strictEqual(ok.valores.FALA_VOLUME_DB, '12');
  assert.strictEqual(ok.valores.WHATSAPP_BOT_MODE, 'secretaria');
  // Inválidos → erros e nada gravado para o campo
  var ruim = s._validarPrefsUI({ ttsEngine: 'alexa', vozGemini: 'DROP TABLE;', volumeDb: 99, modoBot: 'talvez' });
  assert.strictEqual([...ruim.erros].length, 4);
  assert.strictEqual(Object.keys(ruim.valores).length, 0);
  // Tentativa de contrabandear propriedade fora da whitelist é IGNORADA (segurança)
  var mal = s._validarPrefsUI({ GEMINI_API_KEY: 'hackz', PASSWORD_SALT: 'x', ttsEngine: 'cloud' });
  assert.deepStrictEqual([...Object.keys(mal.valores)], ['TTS_ENGINE']);
});

// ───────────────────────── 🔀 _ordemCardsDashboard (ordenação inteligente — pura) ─────────────────────────
test('_ordemCardsDashboard: cards com conteúdo/urgência flutuam acima dos ociosos', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  // Dia com autorização pendente, 1 evento e conflito de agenda, mas sem tarefas/pendências
  var ordem = s._ordemCardsDashboard({
    autorizacoes: [{ id: 1 }],
    eventos: [{}], conflitoAgenda: true,
    tarefas: [], pendencias: [], agendadas: [], monitores: [], objetivosAtivos: [], alertasVoz: [],
    provedores: { taxaErro: 2 }, atividade: { erros: 0 }, revisao: { negativos: 0 }
  });
  // autoriz (urgente) e evento (com conflito) devem vir ANTES de tarefa (vazia)
  assert.ok(ordem.indexOf('autoriz') < ordem.indexOf('tarefa'), 'autorização pendente sobe');
  assert.ok(ordem.indexOf('evento') < ordem.indexOf('tarefa'), 'evento com conflito sobe');
  assert.strictEqual(ordem.indexOf('autoriz'), 0, 'autorização pendente é a mais urgente → topo');
  // Todas as 14 chaves presentes, sem perder nenhuma
  assert.strictEqual([...ordem].length, 14);
  assert.strictEqual(new Set(ordem).size, 14);
});

test('_ordemCardsDashboard: provedor com erro alto (>=25%) sobe acima de cards ociosos', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  var vazio = { autorizacoes: [], eventos: [], tarefas: [], pendencias: [], agendadas: [], monitores: [], objetivosAtivos: [], alertasVoz: [], atividade: {}, revisao: {} };
  var comErro = Object.assign({}, vazio, { provedores: { taxaErro: 40, totalChamadas: 100, totalErros: 40 } });
  var ordem = s._ordemCardsDashboard(comErro);
  // provedores (notável por erro alto) deve vir antes de loop/midia/conhecimento (ociosos)
  assert.ok(ordem.indexOf('provedores') < ordem.indexOf('loop'), 'provedor doente sobe acima do loop ocioso');
  assert.ok(ordem.indexOf('provedores') < ordem.indexOf('midia'));
});

test('_ordemCardsDashboard: dia totalmente vazio mantém ordem natural estável', function () {
  var s = makeSandbox({}); loadGasFile('Code.js', s);
  var ordem = s._ordemCardsDashboard({});
  assert.deepStrictEqual([...ordem], ['autoriz','pendencia','evento','tarefa','agendada','monitor','provedores','atividade','revisao','objetivos','conhecimento','midia','loop','alertasVoz']);
});

test('_provedoresResumo: agrega totalChamadas/totalErros/taxaErro', function () {
  var s = makeSandbox({ docs: [
    { dados: { tier: 'free', ok: true } }, { dados: { tier: 'free', ok: false } },
    { dados: { tier: 'free', ok: true } }, { dados: { tier: 'reserva', ok: true } }
  ] });
  loadGasFile('Code.js', s);
  var r = s._provedoresResumo(120);
  assert.strictEqual(r.totalChamadas, 4);
  assert.strictEqual(r.totalErros, 1);
  assert.strictEqual(r.taxaErro, 25); // 1/4 = 25%
});

// ───────────────────────── 🧠 ehMetaArquivoWiki (RAG: não indexar/buscar o manual/índice/log) ─────────────────────────
test('ehMetaArquivoWiki: identifica meta-arquivos e ignora conhecimento real', function () {
  var s = makeSandbox({}); loadGasFile('Semantica.js', s);
  // Meta-arquivos (qualquer subpasta, case-insensitive) → true
  ['index.md', 'log.md', 'LLM.md', 'System.md', 'readme.md', '_estrutura.md', 'ARCHITECTURE.md',
   'wiki/index.md', 'sub/LOG.md'].forEach(function (m) {
    assert.strictEqual(s.ehMetaArquivoWiki(m), true, m + ' deveria ser meta');
  });
  // Conhecimento real → false (NÃO pular)
  ['entities/produto_airfryer-philips-walita.md', 'use-cases/receitas-airfryer.md',
   'concepts/rag.md', 'sources/2026-07-13_manual.md', 'systematic-review.md', 'indexacao-semantica.md'].forEach(function (k) {
    assert.strictEqual(s.ehMetaArquivoWiki(k), false, k + ' NÃO deveria ser meta');
  });
});

// ───────────────────────── 📱 Telemetria do MacroDroid (_telCarregando / _telModoSom) ─────────────────────────
// Os dois nasceram de bugs REAIS encontrados em 21/09 lendo a telemetria de produção, onde o
// aparelho manda o mesmo dado várias vezes e só alguns magic texts são substituídos:
//   carregando = "Desligar|Desligar|[battery_charging]|[charging]"
//   modo_som   = "[ringer_mode]|100|[vol_ringer]"
test('_telCarregando: "Ligar"/"Desligar" do [power] em PT (o negativo contém o positivo)', function () {
  var s = code();
  // A armadilha: "desligar" CONTÉM "lig". Testar o positivo antes dava true p/ desligado.
  assert.strictEqual(s._telCarregando('Desligar|Desligar|[battery_charging]|[charging]'), false);
  assert.strictEqual(s._telCarregando('Ligar|Ligar|[battery_charging]'), true,
    'com o cabo na tomada tem que dar true — o contexto do voice_command dizia "Não"');
  assert.strictEqual(s._telCarregando('Desligar'), false);
  assert.strictEqual(s._telCarregando('Ligar'), true);
  // Variantes em inglês que a macro também pode mandar
  assert.strictEqual(s._telCarregando('charging'), true);
  assert.strictEqual(s._telCarregando('discharging'), false);
  assert.strictEqual(s._telCarregando('usb'), true);
  assert.strictEqual(s._telCarregando('true'), true);
  assert.strictEqual(s._telCarregando('false'), false);
  // Desconhecido = null (≠ false). Quem chama OMITE a linha em vez de afirmar "Não".
  assert.strictEqual(s._telCarregando('[battery_charging]|[charging]'), null, 'só magic text = não sei');
  assert.strictEqual(s._telCarregando(''), null);
  assert.strictEqual(s._telCarregando(null), null);
});

test('_telModoSom: número é VOLUME, nunca modo; sem texto o modo é desconhecido', function () {
  var s = code();
  // O caso de produção: [ringer_mode] nunca resolve e sobra o volume. Antes virava modo "Normal".
  var real = s._telModoSom('[ringer_mode]|100|[vol_ringer]');
  assert.strictEqual(real.modo, null, 'sem texto de modo → null (não inventar "Normal")');
  assert.strictEqual(real.volume, 100, 'o 100 é o volume do toque');
  // Quando o magic text REALMENTE resolve, o modo é lido
  assert.strictEqual(s._telModoSom('Silent|0|[vol_ringer]').modo, 'Silencioso');
  assert.strictEqual(s._telModoSom('Silencioso|0').modo, 'Silencioso');
  assert.strictEqual(s._telModoSom('Vibrate|30').modo, 'Vibrar');
  assert.strictEqual(s._telModoSom('Normal|80').modo, 'Normal');
  assert.strictEqual(s._telModoSom('Vibrate|30').volume, 30);
  // Vazio / só magic text. Campo a campo de propósito: o objeto nasce DENTRO do vm e tem outro
  // Object.prototype, então deepStrictEqual falha por realm mesmo com o conteúdo idêntico.
  ['', '[ringer_mode]', null].forEach(function (v) {
    var r = s._telModoSom(v);
    assert.strictEqual(r.modo, null, 'modo p/ ' + JSON.stringify(v));
    assert.strictEqual(r.volume, null, 'volume p/ ' + JSON.stringify(v));
  });
});

// ───────────────────────── 🔐 Sensibilidade do assunto (JEV / TypeSafe) ─────────────────────────
// Esta é uma PORTA DE PRIVACIDADE: decide se o celular lê o conteúdo em voz alta. O invariante
// que mais importa não é "o JEV acerta", é "a porta NUNCA abre por falha de infraestrutura".
function sensSandbox(o) {
  var s = makeSandbox(o || {});
  loadGasFile('TypeSafe.js', s);
  loadGasFile('Code.js', s);
  return s;
}

test('Sensibilidade: contrato HTTP do JEV (endpoint, Bearer, corpo, leitura do noul)', function () {
  var visto = null;
  var s = sensSandbox({
    props: { TYPESAFE_API_KEY: 'chave-de-teste' },
    fetch: function (url, params) {
      visto = { url: url, params: params };
      return { code: 200, body: { model: 'jev-1.13.0', answers: { j: { type: 'noul', noul: 0.93 } }, usage: {} } };
    }
  });
  var r = s.TypeSafe.noul('texto qualquer', 'É urgente?');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.prob, 0.93);
  assert.strictEqual(r.model, 'jev-1.13.0');
  // O contrato conferido na doc ao vivo + fonte do SDK v0.6.0
  assert.strictEqual(visto.url, 'https://api.typesafe.ai/v1/systemone');
  assert.strictEqual(visto.params.method, 'post');
  assert.strictEqual(visto.params.headers.Authorization, 'Bearer chave-de-teste');
  var corpo = JSON.parse(visto.params.payload);
  assert.strictEqual(corpo.model, 'jev-latest');
  assert.strictEqual(corpo.questions.j.type, 'noul');
  assert.ok(visto.params.muteHttpExceptions, 'sem mute, um 4xx virava exceção em vez de erro tratável');
});

test('Sensibilidade: o JEV decide — prob alta esconde, prob baixa lê', function () {
  function comProb(p) {
    return sensSandbox({
      props: { TYPESAFE_API_KEY: 'k' },
      fetch: function () { return { code: 200, body: { model: 'jev-1', answers: { j: { type: 'noul', noul: p } } } }; }
    });
  }
  var alto = comProb(0.91)._avaliarSensibilidade('o resultado do meu exame deu alterado', 'Dra. Ana');
  assert.strictEqual(alto.sensivel, true);
  assert.strictEqual(alto.via, 'jev');
  assert.strictEqual(alto.prob, 0.91);

  var baixo = comProb(0.04)._avaliarSensibilidade('bora jogar bola sábado?', 'Douglas');
  assert.strictEqual(baixo.sensivel, false, 'conversa banal não vira discreta');
  assert.strictEqual(baixo.via, 'jev');

  // O limiar é BAIXO de propósito (0.35): o custo de falar algo privado em voz alta é assimétrico.
  var meio = comProb(0.40)._avaliarSensibilidade('me liga que preciso te contar uma coisa', 'X');
  assert.strictEqual(meio.sensivel, true, '0.40 >= 0.35 → na dúvida, discreto');
});

test('Sensibilidade: FALHA DE REDE nunca abre a porta (cai na heurística, não em false)', function () {
  var s = sensSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function () { throw new Error('getaddrinfo ENOTFOUND'); }
  });
  var r = s._avaliarSensibilidade('o exame de sangue deu alterado, o medico pediu internacao', 'Clinica');
  assert.strictEqual(r.via, 'heuristica', 'sem rede → rede de segurança, não silêncio');
  assert.strictEqual(r.sensivel, true, 'a porta NÃO pode abrir porque a API caiu');
  assert.ok(r.erro, 'o erro real fica registrado para diagnóstico');
});

test('Sensibilidade: HTTP 500 e 401 também degradam para a heurística', function () {
  [500, 401].forEach(function (code) {
    var s = sensSandbox({
      props: { TYPESAFE_API_KEY: 'k' },
      fetch: function () { return { code: code, body: 'erro' }; }
    });
    var r = s._avaliarSensibilidade('minha senha do banco e 1234', 'Fulano');
    assert.strictEqual(r.via, 'heuristica', 'HTTP ' + code + ' → heurística');
    assert.strictEqual(r.sensivel, true);
  });
});

test('Sensibilidade: sem chave configurada, comportamento antigo intacto', function () {
  var s = sensSandbox({});   // sem TYPESAFE_API_KEY
  assert.strictEqual(s._avaliarSensibilidade('meu cpf e 111', 'X').via, 'heuristica');
  assert.strictEqual(s._assuntoSensivel('resultado do exame medico'), true);
  assert.strictEqual(s._assuntoSensivel('bom dia, tudo bem?'), false);
});

test('Sensibilidade: regra explícita do dono VENCE o modelo (política ≠ julgamento)', function () {
  var chamou = false;
  var s = sensSandbox({
    props: { TYPESAFE_API_KEY: 'k', FALA_ASSUNTO_SENSIVEL: 'projeto omega' },
    fetch: function () { chamou = true; return { code: 200, body: { answers: { j: { type: 'noul', noul: 0.01 } } } }; }
  });
  var r = s._avaliarSensibilidade('novidades do projeto omega?', 'Chefe');
  assert.strictEqual(r.sensivel, true, 'o dono mandou tratar como sensível — não se discute com o modelo');
  assert.strictEqual(r.via, 'regra');
  assert.strictEqual(chamou, false, 'regra resolve local: não gasta rede nem token');
});

// ───────────────────────── 🧭 Roteamento semântico de voz (JEV / TypeSafe) ─────────────────────────
// Invariante central: o JEV só entra DEPOIS que a regex falhou, e só AGE com confiança suficiente.
// Abaixo do limiar ou sem reconhecer → null → o fluxo segue para o LLM exatamente como antes.
function rotaSandbox(o) {
  var s = makeSandbox(o || {});
  loadGasFile('TypeSafe.js', s);
  loadGasFile('AlertasVoz.js', s);
  loadGasFile('Code.js', s);
  return s;
}
function respostaJev(intencao, confianca, extras) {
  var ans = { intencao: { type: 'choice', choice: intencao, confidence: confianca, probabilities: {} } };
  Object.keys(extras || {}).forEach(function (k) {
    ans[k] = { type: 'choice', choice: extras[k], confidence: 0.9, probabilities: {} };
  });
  return { code: 200, body: { model: 'jev-1.13.0', answers: ans } };
}

test('Rota JEV: consulta de turno — o caso REAL que caía no LLM (21/09, ~20s)', function () {
  var s = rotaSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function () { return respostaJev('turno_consultar', 0.93); }
  });
  s.AlertasVoz.definirTurno('manha');
  var r = s._rotaSemantica('qual o meu turno atual', 'dono@exemplo.com', true);
  assert.match(r, /manhã/, 'responde pelo handler determinístico, sem LLM');
});

test('Rota JEV: UMA requisição carrega seletor + argumentos de todos os ramos (fan-out)', function () {
  var chamadas = 0, corpo = null;
  var s = rotaSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function (url, params) { chamadas++; corpo = JSON.parse(params.payload); return respostaJev('nenhuma', 0.9); }
  });
  s._rotaSemantica('qualquer coisa', 'dono@exemplo.com', true);
  assert.strictEqual(chamadas, 1, 'duas idas à rede seria o dobro da latência pela mesma informação');
  assert.deepStrictEqual(Object.keys(corpo.questions).sort(), ['carteira', 'intencao', 'periodo', 'turno']);
  assert.ok(corpo.questions.intencao.criteria.nenhuma, 'a opção de escape TEM que existir');
});

test('Rota JEV: "nenhuma" e baixa confiança devolvem null (segue para o LLM)', function () {
  function r(intencao, conf) {
    return rotaSandbox({
      props: { TYPESAFE_API_KEY: 'k' },
      fetch: function () { return respostaJev(intencao, conf); }
    })._rotaSemantica('frase ambigua', 'dono@exemplo.com', true);
  }
  assert.strictEqual(r('nenhuma', 0.99), null, 'escape explícito → LLM');
  assert.strictEqual(r('notificacoes', 0.55), null, '0.55 < 0.70 → não age');
});

test('Rota JEV: limiar por CONSEQUÊNCIA — definir turno exige mais que consultar', function () {
  function comConf(intencao, conf) {
    var s = rotaSandbox({
      props: { TYPESAFE_API_KEY: 'k' },
      fetch: function () { return respostaJev(intencao, conf, { turno: 'tarde' }); }
    });
    s.AlertasVoz.definirTurno('manha');
    return s._rotaSemantica('turno', 'dono@exemplo.com', true);
  }
  // 0.80 passa na leitura (>=0.70) mas NÃO numa ação que reescreve 4 alertas de ponto (>=0.85)
  assert.ok(comConf('turno_consultar', 0.80), 'leitura a 0.80 → responde');
  assert.strictEqual(comConf('turno_definir', 0.80), null, 'ação a 0.80 → NÃO mexe na escala');
  assert.ok(comConf('turno_definir', 0.90), 'ação a 0.90 → executa');
});

test('Rota JEV: turno ambíguo numa AÇÃO não vira palpite', function () {
  var s = rotaSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function () { return respostaJev('turno_definir', 0.95, { turno: 'indefinido' }); }
  });
  assert.strictEqual(s._rotaSemantica('vou mudar de turno', 'dono@exemplo.com', true), null,
    'sem saber QUAL turno, deixa o LLM perguntar em vez de chutar');
});

test('Rota JEV: sem chave / sem rede / não-dono → null, caminho antigo intacto', function () {
  assert.strictEqual(rotaSandbox({})._rotaSemantica('qual meu turno', 'dono@exemplo.com', true), null,
    'sem TYPESAFE_API_KEY o comportamento é o de hoje');
  var s = rotaSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { throw new Error('ENOTFOUND'); } });
  assert.strictEqual(s._rotaSemantica('qual meu turno', 'dono@exemplo.com', true), null, 'rede caída → LLM');
  var s2 = rotaSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return respostaJev('notificacoes', 0.99); } });
  assert.strictEqual(s2._rotaSemantica('o que eu perdi', 'terceiro@x.com', false), null, 'não-dono nunca roteia');
});

test('Rota JEV: quando a regex JÁ resolve, o JEV nem é consultado', function () {
  var chamou = false;
  var s = rotaSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    eventos: ['Reunião'],
    fetch: function () { chamou = true; return respostaJev('nenhuma', 0.9); }
  });
  var r = s._rotaDireta('o que tenho na agenda hoje?', 'dono@exemplo.com', true);
  assert.match(r, /Reunião/, 'a regex responde, em 0ms');
  assert.strictEqual(chamou, false, 'caminho quente que já funciona NÃO ganha ida à rede');
});

// ───────────────────────── 🔔 Triagem de notificação por pontuação (JEV / TypeSafe) ─────────────────────────
// Só roda no vácuo das regras. Regra do dono é política e vence; janela de silêncio vence o modelo.
function notifSandbox(o) {
  var s = makeSandbox(o || {});
  loadGasFile('TypeSafe.js', s);
  loadGasFile('Code.js', s);
  s.Jarvis.controlarDispositivo = function () { return { status: 'success' }; };
  return s;
}
function respostaScore(score, conf) {
  return { code: 200, body: { model: 'jev-1.13.0', answers: { urgencia: {
    type: 'score', score: score, confidence: conf === undefined ? 0.8 : conf,
    legend: {}, probabilities: {} } } } };
}

test('Triagem JEV: urgente fala, promoção fica para o resumo', function () {
  function tri(score) {
    return notifSandbox({
      props: { TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '00:00-23:59' },
      fetch: function () { return respostaScore(score); }
    })._notifTriagemJev({ app: 'Banco', titulo: 'x', texto: 'y' });
  }
  var urgente = tri(2.9);
  assert.strictEqual(urgente.acao, 'falar');
  assert.strictEqual(urgente.urgencia, 2.9);
  assert.strictEqual(urgente.via, 'jev');

  var promo = tri(0.3);
  assert.strictEqual(promo.acao, 'guardar');
  assert.strictEqual(promo.modo, 'briefing');
  assert.strictEqual(promo.urgencia, 0.3, 'a pontuação fica guardada mesmo quando não fala');
});

test('Triagem JEV: a JANELA DE SILÊNCIO vence o modelo — e nem gasta a chamada', function () {
  var chamou = false;
  var s = notifSandbox({
    props: { TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '03:00-03:01' },  // praticamente nunca
    fetch: function () { chamou = true; return respostaScore(3.0); }
  });
  var r = s._notifTriagemJev({ app: 'Banco', titulo: 'FRAUDE', texto: 'login desconhecido' });
  assert.strictEqual(r.acao, 'guardar', 'fora da janela nada fala, por mais urgente que seja');
  assert.strictEqual(chamou, false, 'perguntar para depois ignorar seria rede e token à toa');
});

test('Triagem JEV: falha e ausência de chave caem no comportamento antigo (guardar)', function () {
  var semChave = notifSandbox({ props: { NOTIF_FALAR_JANELA: '00:00-23:59' } })
    ._notifTriagemJev({ app: 'X', titulo: 't', texto: 'm' });
  assert.strictEqual(semChave.acao, 'guardar');

  var semRede = notifSandbox({
    props: { TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '00:00-23:59' },
    fetch: function () { throw new Error('ENOTFOUND'); }
  })._notifTriagemJev({ app: 'X', titulo: 't', texto: 'm' });
  assert.strictEqual(semRede.acao, 'guardar', 'falha nunca vira fala indevida');
  assert.ok(semRede.erro);
});

test('Triagem JEV: limiar é política — mover o corte muda a decisão sem nova inferência', function () {
  function comLimiar(lim) {
    return notifSandbox({
      props: { TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '00:00-23:59', NOTIF_URGENCIA_LIMIAR: String(lim) },
      fetch: function () { return respostaScore(2.0); }
    })._notifTriagemJev({ app: 'X', titulo: 't', texto: 'm' });
  }
  assert.strictEqual(comLimiar(2.5).acao, 'guardar', '2.0 < 2.5');
  assert.strictEqual(comLimiar(1.5).acao, 'falar', '2.0 >= 1.5');
});

// ───────────────────────── 📨 Notificação só é consumida APÓS entrega ─────────────────────────
// O bug (21/09, medido ao vivo): "o que eu perdi" marcava tudo como lido ao GERAR o texto. Duas
// chamadas com 27s de diferença deram "Agenda Edu (5): ..." e depois "Nada de novo". Como o corpo
// HTTP volta vazio por protocolo, se o áudio não tocasse as notificações sumiam sem aviso.
function notifLidasSandbox(docs) {
  var lidas = {};
  var s = makeSandbox({ props: {}, docs: docs });
  s.Firestore.updateDoc = function (col, id, campos) { if (campos && campos.lida) lidas[id] = true; return true; };
  loadGasFile('TypeSafe.js', s);
  loadGasFile('Code.js', s);
  s._lidas = lidas;
  return s;
}
function notifsRecentes(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ id: 'n' + i, dados: { app: 'Agenda Edu', titulo: 'Comunicado ' + i, em: Date.now() - 60000 } });
  return out;
}

test('Notificações: resumir NÃO marca sozinho; devolve os ids para quem entregar', function () {
  var s = notifLidasSandbox(notifsRecentes(5));
  var r = s.resumirNotificacoes({ horas: 12, marcarLidas: false });
  assert.strictEqual(r.total, 5);
  assert.deepStrictEqual(Object.keys(s._lidas), [], 'gerar o texto NÃO pode consumir');
  assert.strictEqual(r.ids.length, 5, 'os ids voltam para o passo de entrega');
});

test('Notificações: perguntar duas vezes sem entrega devolve a MESMA resposta', function () {
  var s = notifLidasSandbox(notifsRecentes(5));
  var a = s.resumirNotificacoes({ horas: 12, marcarLidas: false });
  var b = s.resumirNotificacoes({ horas: 12, marcarLidas: false });
  assert.strictEqual(a.resumo, b.resumo, 'era aqui que a 2ª virava "Nada de novo"');
  assert.match(a.resumo, /Agenda Edu/);
});

test('Notificações: _notifMarcarLidas consome, e aí sim a resposta muda', function () {
  var s = notifLidasSandbox(notifsRecentes(3));
  var r = s.resumirNotificacoes({ horas: 12, marcarLidas: false });
  assert.strictEqual(s._notifMarcarLidas(r.ids), 3, 'marca as 3 entregues');
  assert.strictEqual(Object.keys(s._lidas).length, 3);
});

test('Notificações: marcarLidas:true segue funcionando p/ quem já usava', function () {
  var s = notifLidasSandbox(notifsRecentes(4));
  s.resumirNotificacoes({ horas: 12, marcarLidas: true });
  assert.strictEqual(Object.keys(s._lidas).length, 4, 'compatibilidade preservada');
});

// ───────────────────────── 🏦 Escalonamento: urgencia fura regra que calou ─────────────────────────
function escalaSandbox(score, props) {
  var falado = [];
  var s = makeSandbox({
    props: Object.assign({ TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '00:00-23:59' }, props || {}),
    fetch: function () {
      return { code: 200, body: { model: 'jev-1', answers: { urgencia: { type: 'score', score: score, confidence: 0.9 } } } };
    }
  });
  s.Jarvis.controlarDispositivo = function (a) { falado.push(a.texto); return { status: 'success' }; };
  loadGasFile('TypeSafe.js', s);
  loadGasFile('Code.js', s);
  s._falado = falado;
  return s;
}

test('Escalonamento: fraude (3.0) fura a regra do banco que mandava calar', function () {
  var s = escalaSandbox(3.0);
  var r = s._notifEscalaSePreciso({ app: 'Itau', titulo: 'Compra nao reconhecida', texto: 'R$ 2.400 em Eletronicos' });
  assert.strictEqual(r.escalou, true, 'o caso real de 21/09 que foi arquivado calado');
  assert.strictEqual(r.urgencia, 3.0);
  assert.match(s._falado[0], /^Atenção\./, 'a fala escalada se anuncia como excecao');
});

test('Escalonamento: extrato comum (1.0) NAO fura — a regra do banco continua valendo', function () {
  var s = escalaSandbox(1.0);
  var r = s._notifEscalaSePreciso({ app: 'Itau', titulo: 'Extrato', texto: 'seu saldo disponivel' });
  assert.strictEqual(r.escalou, false);
  assert.strictEqual(s._falado.length, 0, 'sem fala: era exatamente o que a regra queria');
});

test('Escalonamento: limiar 2.8 é mais alto que o da triagem (2.0) de proposito', function () {
  // 2.2 basta para FALAR num vacuo de regra, mas nao para SOBREPOR uma regra do dono.
  assert.strictEqual(escalaSandbox(2.2)._notifEscalaSePreciso({ app: 'X', titulo: 't', texto: 'm' }).escalou, false);
  assert.strictEqual(escalaSandbox(2.9)._notifEscalaSePreciso({ app: 'X', titulo: 't', texto: 'm' }).escalou, true);
});

test('Escalonamento: janela de silencio vence ate fraude, e nem consulta o modelo', function () {
  var chamou = false;
  var s = makeSandbox({
    props: { TYPESAFE_API_KEY: 'k', NOTIF_FALAR_JANELA: '03:00-03:01' },
    fetch: function () { chamou = true; return { code: 200, body: { answers: { urgencia: { type: 'score', score: 3.0 } } } }; }
  });
  loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  assert.strictEqual(s._notifEscalaSePreciso({ app: 'Itau', titulo: 'FRAUDE', texto: 'x' }).escalou, false);
  assert.strictEqual(chamou, false);
});

// ───────────────────────── 💳 Saldo: frescor e atualizacao por voz ─────────────────────────
test('Saldo: valor velho leva a ressalva NA FRENTE, nao no fim', function () {
  var tresDias = Date.now() - 3 * 86400000;
  var s = makeSandbox({ props: { FIN_SALDO: JSON.stringify({ voucher: 676.98, mobilidade: null, em: tresDias }) } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  var txt = s._finFalarSaldo(null);
  assert.match(txt, /^Atenção/, 'em audio, ressalva no fim passa despercebida');
  assert.match(txt, /3 dias atrás/);
  assert.match(txt, /676,98/, 'o numero continua sendo dito, com a ressalva');
});

test('Saldo: valor de hoje fala normal, sem alarme', function () {
  var s = makeSandbox({ props: { FIN_SALDO: JSON.stringify({ voucher: 2.5, mobilidade: 0.38, em: Date.now() }) } });
  loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  var txt = s._finFalarSaldo(null);
  assert.ok(!/^Atenção/.test(txt), 'dado fresco nao merece ressalva');
  assert.match(txt, /R\$ 2,50/);
  assert.match(txt, /R\$ 0,38/);
  assert.match(txt, /hoje/);
});

test('Saldo: declarar por voz vira tipo "definir"; perguntar continua consulta', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  var d = s._interpretarFinanceiro('meu saldo esta em 2,50 no voucher e 0,38 na mobilidade');
  assert.strictEqual(d.tipo, 'definir');
  assert.strictEqual(d.voucher, 2.5);
  assert.strictEqual(d.mobilidade, 0.38);
  // a consulta nao pode virar declaracao: "quanto tenho" nao traz numero
  assert.strictEqual(s._interpretarFinanceiro('quanto tenho no cartao alimentacao').tipo, 'saldo');
  assert.strictEqual(s._interpretarFinanceiro('quanto eu gastei essa semana').tipo, 'gastos');
});

test('Saldo: parser entende as DUAS ordens de dizer o valor', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  // numero ANTES do rotulo — ordem natural na FALA. Era aqui que "voucher e 0,38" casava errado
  // e gravava 0,38 como voucher, silenciosamente.
  [['meu saldo esta em 2,50 no voucher e 0,38 na mobilidade', 2.5, 0.38],
   ['2,50 no voucher e 0,38 na mobilidade', 2.5, 0.38],
   ['sobrou 2,50 de alimentacao e 0,38 de transporte', 2.5, 0.38],
   ['registra 2,50 no voucher', 2.5, null],
  // rotulo ANTES do numero — ordem do painel interativo, onde ele DIGITA
   ['voucher 2,50 mobilidade 0,38', 2.5, 0.38],
   ['voucher: 700 mobilidade: 250', 700, 250],
   ['alimentacao esta em 15 e mobilidade em 3', 15, 3],
  // sem rotulo nenhum: posicional, como sempre foi
   ['700, 250', 700, 250]
  ].forEach(function (c) {
    var r = s._finLerSaldoDeTexto(c[0]);
    assert.ok(r, 'nao parseou: ' + c[0]);
    assert.strictEqual(r.voucher, c[1], 'voucher em: ' + c[0]);
    assert.strictEqual(r.mobilidade, c[2], 'mobilidade em: ' + c[0]);
  });
});

// ───────────────────────── 🔎 Reranking do RAG com JEV ─────────────────────────
// O RRF funde listas pela POSICAO e nunca le a pergunta: nao distingue "fala do mesmo assunto"
// de "responde ao que foi perguntado". O reranking corrige isso — mas NUNCA pode quebrar a busca.
function rerankSandbox(o) {
  var s = makeSandbox(o || {});
  loadGasFile('TypeSafe.js', s);
  loadGasFile('Semantica.js', s);
  return s;
}
function cands(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ caminho: 'p' + i + '.md', trecho: 'trecho numero ' + i, rrfScore: 1 - i * 0.01 });
  return out;
}
function respostaRerank(mapa) {  // {t0:0.1, t1:0.9, ...}
  var answers = {};
  Object.keys(mapa).forEach(function (k) { answers[k] = { type: 'noul', noul: mapa[k] }; });
  return { code: 200, body: { model: 'jev-1.13.0', answers: answers } };
}

test('Rerank: reordena pela relevancia real, nao pela posicao do RRF', function () {
  var s = rerankSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function () { return respostaRerank({ t0: 0.10, t1: 0.95, t2: 0.40 }); }
  });
  var r = s.Semantica.rerank('qual a senha do wifi?', cands(3));
  assert.strictEqual(r[0].caminho, 'p1.md', 'o 2o do RRF era quem respondia');
  assert.strictEqual(r[1].caminho, 'p2.md');
  assert.strictEqual(r[2].caminho, 'p0.md', 'o 1o do RRF so falava do assunto');
  assert.strictEqual(r[0].jev, 0.95);
});

test('Rerank: UMA requisicao com N perguntas (GAS e sincrono, serial seria ~30s)', function () {
  var chamadas = 0, corpo = null;
  var s = rerankSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function (url, params) { chamadas++; corpo = JSON.parse(params.payload);
      return respostaRerank({ t0: 0.5, t1: 0.6, t2: 0.7, t3: 0.8, t4: 0.9 }); }
  });
  s.Semantica.rerank('pergunta', cands(5));
  assert.strictEqual(chamadas, 1, 'uma chamada por candidato mataria a busca no GAS');
  assert.strictEqual(Object.keys(corpo.questions).length, 5);
  assert.strictEqual(corpo.state.trechos.length, 5, 'o estado viaja UMA vez, com todos os trechos');
  // Cada pergunta precisa nomear seu proprio trecho: o id nao vai para o modelo.
  assert.match(corpo.questions.t3.instructions, /trechos\[3\]/);
});

test('Rerank: falha NUNCA quebra a busca — devolve null e o RRF prevalece', function () {
  ['rede', 'http', 'semChave', 'desligado'].forEach(function (caso) {
    var props = { TYPESAFE_API_KEY: 'k' };
    var fetch = function () { return respostaRerank({ t0: 0.9 }); };
    if (caso === 'rede') fetch = function () { throw new Error('ENOTFOUND'); };
    if (caso === 'http') fetch = function () { return { code: 500, body: 'erro' }; };
    if (caso === 'semChave') props = {};
    if (caso === 'desligado') props.RAG_RERANK = 'off';
    var s = rerankSandbox({ props: props, fetch: fetch });
    assert.strictEqual(s.Semantica.rerank('p', cands(3)), null, 'caso: ' + caso);
  });
});

test('Rerank: resposta parcial nao DESCARTA candidato — manda para o fim', function () {
  var s = rerankSandbox({
    props: { TYPESAFE_API_KEY: 'k' },
    fetch: function () { return respostaRerank({ t0: 0.2, t2: 0.9 }); }   // t1 ausente
  });
  var r = s.Semantica.rerank('p', cands(3));
  assert.strictEqual(r.length, 3, 'perder um trecho por falha parcial seria pior que ordena-lo mal');
  assert.strictEqual(r[0].caminho, 'p2.md');
  assert.strictEqual(r[2].caminho, 'p1.md', 'sem nota vai para o fim');
  assert.strictEqual(r[2].jev, null);
});

test('Rerank: candidatos alem do teto seguem no fim, na ordem do RRF', function () {
  var m = {}; for (var i = 0; i < 12; i++) m['t' + i] = i / 100;
  var s = rerankSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return respostaRerank(m); } });
  var r = s.Semantica.rerank('p', cands(15));
  assert.strictEqual(r.length, 15, 'nenhum candidato some');
  assert.strictEqual(r[12].caminho, 'p12.md', 'os 3 fora do teto mantem a ordem do RRF');
  assert.strictEqual(r[14].caminho, 'p14.md');
});

test('Rerank: lista com 0 ou 1 candidato nao gasta rede', function () {
  var chamou = false;
  var s = rerankSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { chamou = true; return respostaRerank({}); } });
  assert.strictEqual(s.Semantica.rerank('p', cands(1)), null);
  assert.strictEqual(s.Semantica.rerank('p', []), null);
  assert.strictEqual(chamou, false, 'nao ha o que reordenar');
});

// ───────────────────────── 🔔 Notificação cortada NA ORIGEM (Agenda Edu) ─────────────────────────
// Conferido por adb em 23/09: o app entrega o texto truncado até no android.bigText. O texto
// completo não existe na notificação — o Jarvis parava de falar no meio do nome.
function corpoSandbox() {
  var s = makeSandbox({});
  s.Utilities.formatDate = function (d) {        // BRT fixo para o teste (UTC-3)
    var x = new Date(d); return String((x.getUTCHours() + 21) % 24).padStart(2, '0') + ':' + String(x.getUTCMinutes()).padStart(2, '0');
  };
  loadGasFile('TypeSafe.js', s); loadGasFile('Code.js', s);
  return s;
}
var T0735 = Date.UTC(2026, 8, 23, 10, 35);  // 07:35 BRT

test('Notificação: catraca cortada vira QUEM e QUANDO, sem parar no nome', function () {
  var s = corpoSandbox();
  var f = s._notifCorpoFalavel('Catracas | Entrada - Saída: Agenda Edu', 'Informamos que o(a) aluno(a) ANA L...', T0735);
  assert.strictEqual(f, 'Catraca da escola: Ana, às 07:35.');
  assert.ok(!/entrad|sa[ií]d/i.test(f.replace('Catraca da escola', '')), 'NÃO afirma entrada/saída: o texto que diria foi cortado');
});

test('Notificação: corte no MEIO da palavra some a palavra pela metade e avisa', function () {
  var s = corpoSandbox();
  var f = s._notifCorpoFalavel('Central de Notificações', 'Avisos - Prezado(a) responsável, A nota do(a) a...', T0735);
  assert.ok(!/\ba\.\.\./.test(f), 'o "a..." pendurado não pode ser lido');
  assert.match(f, /O restante está no aplicativo\.$/);
});

test('Notificação: reticência de ESTILO (com espaço) não come palavra inteira', function () {
  var s = corpoSandbox();
  var f = s._notifCorpoFalavel('Palavra do dia', 'Não temas, porque eu sou contigo ...', T0735);
  assert.match(f, /contigo/, 'palavra completa antes de " ..." fica');
});

test('Notificação: texto completo passa intacto', function () {
  var s = corpoSandbox();
  assert.strictEqual(s._notifCorpoFalavel('Comunicado', 'Reunião de pais amanhã às 19h.', T0735),
                     'Comunicado. Reunião de pais amanhã às 19h.');
});

// ───────────────────────── 🗓️ Briefings: colisão e a função duplicada ─────────────────────────
function alertasSandbox(alertas, hhmm, dow) {
  var s = makeSandbox({ props: { ALERTAS_VOZ: JSON.stringify(alertas), ALERTA_TOLERANCIA_MIN: '10' } });
  var falas = [];
  s.Utilities.formatDate = function (d, tz, fmt) {
    if (fmt === 'H') return String(Number(hhmm.split(':')[0]));
    if (fmt === 'm') return String(Number(hhmm.split(':')[1]));
    if (fmt === 'u') return String(dow === 0 ? 7 : dow);
    if (fmt === 'yyyy-MM-dd') return '2026-09-24';
    return hhmm;
  };
  s.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  s.ScriptApp = { getProjectTriggers: function () { return []; }, deleteTrigger: function () {},
    newTrigger: function () { return { timeBased: function () { return { everyMinutes: function () { return { create: function () {} }; } }; } }; } };
  s.Jarvis.controlarDispositivo = function (a) { falas.push(a.texto); return { status: 'success' }; };
  s.Jarvis.ask = function () { return 'noticias do dia'; };
  s.Jarvis.registrarEvento = function (ev) { (s._eventos = s._eventos || []).push(ev); };
  loadGasFile('AlertasVoz.js', s);
  s._falas = falas;
  return s;
}
function briefTurno(h, m) { return { id: 'b1', hora: h, minuto: m, dias: [], texto: 'noticias', dinamico: true, ativo: true, ult: '', tag: 'briefing' }; }
var BRIEF_MANHA = { id: 'b2', hora: 8, minuto: 30, dias: [], texto: 'panorama', dinamico: true, ativo: true, ult: '', tag: 'briefing_manha' };

test('Briefing: o do TURNO cede quando colide com briefing de horário fixo (turno manhã)', function () {
  var s = alertasSandbox([briefTurno(7, 30), BRIEF_MANHA], '07:31', 3);
  s.AlertasVoz.tick();
  assert.strictEqual(s._falas.length, 0, '07:30 NÃO fala: as mesmas notícias sairiam de novo às 08:30');
  assert.ok((s._eventos || []).some(function (e) { return e.tool === 'alertaVoz:suprimido'; }), 'deixa rastro');
});

test('Briefing: sem colisão (turno tarde, 13:30) o do turno fala normalmente', function () {
  var s = alertasSandbox([briefTurno(13, 30), BRIEF_MANHA], '13:31', 3);
  s.AlertasVoz.tick();
  assert.strictEqual(s._falas.length, 1, 'papel distinto na tarde: segue valendo');
});

test('Briefing: reposicionarBriefing tem UMA definição e devolve o campo que definirTurno lê', function () {
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'AlertasVoz.js'), 'utf8');
  assert.strictEqual((src.match(/function reposicionarBriefing\(turno\)/g) || []).length, 1,
    'duas definições = a de baixo vence e o anti-colisão de cima nunca roda');
  var s = alertasSandbox([briefTurno(7, 30)], '07:00', 3);
  s.AlertasVoz.definirTurno('manha');
  var r = s.AlertasVoz.reposicionarBriefing('manha');
  assert.ok(r.ok);
  assert.ok(r.briefing, 'sem .briefing o Jarvis diria "seu briefing mudou para as undefined"');
});

// ───────────────────────── 👋 Presença não repete o ponto ─────────────────────────
test('Presença: "Bom trabalho" não repete ponto já alertado, e sai uma vez por expediente', function () {
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'Code.js'), 'utf8');
  assert.ok(src.indexOf("' Lembre-se de bater o ponto.'") === -1, 'o ramo que lembrava de ponto JÁ alertado saiu');
  assert.ok(src.indexOf("_governanca('chegou_trabalho', { cooldownMin: 720") !== -1, 'uma saudação por expediente');
});

// ───────────────────────── 🧠 Portão do JEV: agendar fala só com intenção real ─────────────────────────
function gateSandbox(prob, comChave) {
  var chamou = 0;
  var s = makeSandbox({
    props: comChave === false ? {} : { TYPESAFE_API_KEY: 'k' },
    fetch: function () { chamou++; var pf = (typeof prob === 'object') ? prob.fala : prob, pu = (typeof prob === 'object') ? prob.futuro : prob; return { code: 200, body: { answers: { fala: { type: 'noul', noul: pf }, futuro: { type: 'noul', noul: pu } } } }; }
  });
  loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  s._chamou = function () { return chamou; };
  return s;
}

test('Portão JEV: "seja meu despertador AGORA" NÃO recebe a ferramenta de agendar (o bug de 21/09)', function () {
  var s = gateSandbox(0.15);   // valor REAL medido para esta frase em 23/09
  var p = s.Jarvis._toolsPermitidas('Voce e meu despertador agora. Me de um bom dia caloroso, anuncie a hora atual e fala as noticias');
  assert.ok(!p || !p.agendarAlertaVoz, 'sem a ferramenta, o modelo não tem como congelar a resposta num alarme');
});

test('Portão JEV: "todo dia útil às 8h me fala minha agenda" GANHA a ferramenta (a regex recusava)', function () {
  var s = gateSandbox(0.95);   // valor REAL medido em 23/09
  var p = s.Jarvis._toolsPermitidas('todo dia util as 8h me fala minha agenda no celular');
  assert.ok(p && p.agendarAlertaVoz, 'a hora vinha ANTES do verbo e a regex não casava');
});

test('Portão JEV: sem chave, vale a regex antiga (comportamento anterior)', function () {
  var s = gateSandbox(0.99, false);
  var p = s.Jarvis._toolsPermitidas('me fala a hora');
  assert.ok(p && p.agendarAlertaVoz, 'regex antiga liberava — e sem JEV continua liberando');
  assert.strictEqual(s._chamou(), 0);
});

test('Portão JEV: mensagem sem sinal de horário não gasta chamada', function () {
  var s = gateSandbox(0.5);
  s.Jarvis._toolsPermitidas('resuma meus emails nao lidos');
  assert.strictEqual(s._chamou(), 0, 'o JEV só é consultado quando há sinal de agenda');
});

// ───────────────────────── 🎙️ Voz: o filtro julga o PEDIDO, não as instruções anexadas ─────────────────────────
// Medido em 23/09: a rota de voz anexa ~29.500 caracteres de instrução ("[Interação por voz: abrir app,
// tocar música, rota, alarme...]"). O filtro julgava o texto inteiro e TODO pedido de voz recebia 100
// ferramentas — "qual o meu saldo" deveria receber 12.
var SUFIXO_VOZ = '\n\n[Interação por voz: responda direto. AÇÃO NO CELULAR: abrir app, abra o WhatsApp, ' +
  'tocar música, rota, navegar, alarme, despertador, agenda, lembrete, todo dia às 8h, controlarDispositivo, ' +
  'enviar mensagem, e-mail, notícias, ponto, turno, alerta de voz, objetivo, autorizar, skill, cérebro]';

test('Voz: instruções anexadas NÃO inflam o cardápio de ferramentas', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  var soPedido = Object.keys(s.Jarvis._toolsPermitidas('qual o meu saldo')).length;
  var comVoz = Object.keys(s.Jarvis._toolsPermitidas('qual o meu saldo' + SUFIXO_VOZ)).length;
  assert.ok(comVoz <= soPedido + 1, 'voz não pode abrir o cardápio inteiro: ' + soPedido + ' vs ' + comVoz);
});

test('Voz: controlarDispositivo SEMPRE disponível (as instruções de voz o exigem)', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  var p = s.Jarvis._toolsPermitidas('qual o meu saldo' + SUFIXO_VOZ);
  assert.ok(p.controlarDispositivo, 'sem ela o modelo diria "abri o app" sem ter como abrir');
});

test('Voz: agendamento não vaza das instruções — "seja meu despertador agora" fica sem agendarAlertaVoz', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);   // sem chave: só regex
  var p = s.Jarvis._toolsPermitidas('voce e meu despertador agora, me de bom dia' + SUFIXO_VOZ);
  assert.ok(!p.agendarAlertaVoz, 'as palavras "alarme/despertador/todo dia às 8h" das INSTRUÇÕES liberavam a ferramenta');
});

test('Voz: confirmação curta ("sim") continua liberando tudo', function () {
  var s = makeSandbox({}); loadGasFile('TypeSafe.js', s); loadGasFile('Jarvis.js', s);
  assert.strictEqual(s.Jarvis._toolsPermitidas('sim' + SUFIXO_VOZ), null, 'o fluxo de confirmação do Gate P2 depende disso');
});

// ───────────────────────── 🧠 Portão JEV (2ª pergunta): programar QUALQUER coisa para depois ─────────────────────────
test('Portão JEV: "me fala minha agenda" NÃO recebe agendarTarefa (a regex lia "agenda" como "agend")', function () {
  var s = gateSandbox({ fala: 0.03, futuro: 0.03 });   // valores REAIS medidos em 23/09
  var p = s.Jarvis._toolsPermitidas('me fala minha agenda de hoje');
  assert.ok(!p.agendarTarefa, 'foi assim que reexecutou o agendamento do turno anterior e respondeu "agendei"');
  assert.ok(!p.agendarAlertaVoz && !p.agendarMensagemWhatsApp);
  assert.ok(p.listarProximosEventos, 'a CONSULTA à agenda continua disponível');
});

test('Portão JEV: "manda oi pro Douglas amanhã às 9h" mantém a mensagem agendada, sem virar alerta de voz', function () {
  var s = gateSandbox({ fala: 0.10, futuro: 0.98 });
  var p = s.Jarvis._toolsPermitidas('manda oi pro douglas amanha as 9h');
  assert.ok(!p.agendarAlertaVoz, 'não é uma fala');
  assert.ok(!('agendarMensagemWhatsApp' in p) || p.agendarMensagemWhatsApp,
    'a 2ª pergunta NÃO remove ferramentas quando ele quer programar algo');
});

// ───────────────────────── 🔁 AlertasVoz.criar: sem duplicata e sem sequestrar a tag do turno ─────────────────────────
function criarSandbox() {
  var s = makeSandbox({ props: { ALERTAS_VOZ: '[]' } });
  s.ScriptApp = { getProjectTriggers: function () { return [{ getHandlerFunction: function () { return 'tickAlertasVoz'; } }]; }, deleteTrigger: function () {} };
  loadGasFile('AlertasVoz.js', s);
  return s;
}

test('Alerta: o mesmo pedido duas vezes vira UM alerta (o modelo chamou a ferramenta 2x em 23/09)', function () {
  var s = criarSandbox();
  var o = { hora: 9, minuto: 0, dias: [1, 2, 3, 4, 5], texto: 'o tempo em Belo Horizonte', dinamico: true };
  var a = s.AlertasVoz.criar(o), b = s.AlertasVoz.criar(o);
  assert.ok(a.ok && b.ok);
  assert.strictEqual(b.duplicado, true);
  assert.strictEqual(s.AlertasVoz.listar().length, 1, 'dois idênticos falariam no mesmo minuto');
  assert.strictEqual(a.alerta.id, b.alerta.id);
});

test('Alerta: tag "briefing" vinda de fora é reinferida — é reservada ao briefing do turno', function () {
  var s = criarSandbox();
  var r = s.AlertasVoz.criar({ hora: 9, texto: 'o tempo em Belo Horizonte', dinamico: true, tag: 'briefing' });
  assert.notStrictEqual(r.alerta.tag, 'briefing', 'senão a troca de turno arrastaria o alerta de clima para 07:30');
});

test('Alerta: mesmo texto em horário DIFERENTE continua sendo outro alerta', function () {
  var s = criarSandbox();
  s.AlertasVoz.criar({ hora: 9, texto: 'beba agua' });
  s.AlertasVoz.criar({ hora: 15, texto: 'beba agua' });
  assert.strictEqual(s.AlertasVoz.listar().length, 2);
});

// ───────────────────────── 🤥 Ferramentas de cancelar não podem mentir ─────────────────────────
// Devolviam sucesso sem remover nada; o modelo lia "ok" e anunciava "foi cancelada" (23/09, 2 vezes).
test('Cancelar alerta: nada encontrado = ok:false e diz que nada foi cancelado', function () {
  var s = criarSandbox();
  var r = s.AlertasVoz.cancelar('id-que-nao-existe');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.removidos, 0);
  assert.match(r.erro, /Nada foi cancelado/);
});

test('Cancelar alerta: devolve EXATAMENTE quais saíram, para não generalizar', function () {
  var s = criarSandbox();
  var a = s.AlertasVoz.criar({ hora: 9, texto: 'alerta um' }).alerta;
  s.AlertasVoz.criar({ hora: 10, texto: 'alerta dois' });
  var r = s.AlertasVoz.cancelar(a.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.removidos, 1);
  assert.strictEqual(r.cancelados.length, 1, 'um só — o modelo disse "os alertas" quando era um');
  assert.strictEqual(r.cancelados[0].id, a.id);
  assert.strictEqual(s.AlertasVoz.listar().length, 1, 'o outro continua');
});

test('Cancelar tarefa agendada: nada encontrado NÃO é success', function () {
  var s = makeSandbox({ docs: [] });
  s.Firestore.deleteDoc = function () {};
  loadGasFile('Agenda.js', s);
  var r = s.Agenda.cancelar('95590c31-inexistente');
  assert.notStrictEqual(r.status, 'success', 'foi assim que "cancelou" uma tarefa que já não existia');
  assert.strictEqual(r.removidas, 0);
});

// ───────────────────────── 📲 Avisos proativos: celular, não WhatsApp (Evolution fora do ar desde 10/07) ─────────────────────────
function _janelaSilencioAgora(dentro) {
  var h = new Date().getHours();
  return dentro ? (h + ':00-' + ((h + 1) % 24) + ':00') : (((h + 2) % 24) + ':00-' + ((h + 3) % 24) + ':00');
}

test('Aviso ao dono: sempre notificação, texto limpo e curto (cabe na URL do MacroDroid)', function () {
  var s = code({ props: { PROATIVO_SILENCIO: _janelaSilencioAgora(false) } });
  var cmds = [];
  s.Jarvis.controlarDispositivo = function (a) { cmds.push(a); return { status: 'success' }; };
  var r = s._avisarDono({ origem: 'agenda', titulo: '⏰ *Resumo*', texto: '*Negrito* e _itálico_ ' + 'x'.repeat(900) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(cmds.length, 1, 'sem `falar`, só a notificação');
  assert.strictEqual(cmds[0].acao, 'notificar');
  assert.strictEqual(cmds[0].titulo, '⏰ Resumo', 'markdown do WhatsApp não vai para a notificação');
  assert.ok(cmds[0].texto.indexOf('*') === -1 && cmds[0].texto.indexOf('_') === -1);
  assert.ok(cmds[0].texto.length <= 400, 'texto longo estoura o teto de 2 KB da URL do UrlFetch');
});

test('Aviso ao dono: `falar` só fala fora da janela de silêncio', function () {
  var cmds = [];
  var s = code({ props: { PROATIVO_SILENCIO: _janelaSilencioAgora(false) } });
  s.Jarvis.controlarDispositivo = function (a) { cmds.push(a.acao); return { status: 'success' }; };
  s._avisarDono({ titulo: 'Segurança', texto: '3 tentativas', falar: 'Atenção, Bruno' });
  assert.deepStrictEqual(cmds, ['notificar', 'falar']);

  cmds = [];
  var n = code({ props: { PROATIVO_SILENCIO: _janelaSilencioAgora(true) } });
  n.Jarvis.controlarDispositivo = function (a) { cmds.push(a.acao); return { status: 'success' }; };
  n._avisarDono({ titulo: 'Segurança', texto: '3 tentativas', falar: 'Atenção, Bruno' });
  assert.deepStrictEqual(cmds, ['notificar'], 'de madrugada só notifica, não acorda ninguém');
});

test('Aviso ao dono: falha na entrega fica registrada, não some calada', function () {
  var eventos = [];
  var s = code({});
  s.Jarvis.controlarDispositivo = function () { return { status: 'error', erro: 'macro ausente' }; };
  s.Jarvis.registrarEvento = function (e) { eventos.push(e); };
  var r = s._avisarDono({ origem: 'heartbeat', titulo: 'Rotina parada', texto: 'agenda' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(eventos.length, 1);
  assert.strictEqual(eventos[0].tool, 'aviso:heartbeat');
  assert.match(eventos[0].resumo, /FALHOU: macro ausente/);
});

test('Nenhum aviso proativo ao dono depende mais do WhatsApp', function () {
  var fs = require('fs'), path = require('path');
  ['Agenda.js', 'AsyncBroker.js', 'Heartbeat.js', 'Jobs.js', 'Monitor.js', 'Objetivos.js', 'Web.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(src.indexOf('WhatsApp.enviar(num') === -1, f + ' ainda avisa pelo WhatsApp — que está desligado');
    assert.ok(src.indexOf('_avisarDono(') !== -1, f + ' deveria avisar pelo celular');
  });
});

test('Saldo: pedir as DUAS carteiras responde as duas (não para no voucher)', function () {
  var s = code({});
  var f = s._interpretarFinanceiro('qual o meu saldo no voucher e meu saldo da mobilidade');
  assert.strictEqual(f.tipo, 'saldo');
  assert.strictEqual(f.carteira, null, 'foi voucher em 23/09 e a mobilidade sumiu da fala');
  assert.strictEqual(s._interpretarFinanceiro('qual o saldo do voucher').carteira, 'voucher');
  assert.strictEqual(s._interpretarFinanceiro('quanto tem na mobilidade').carteira, 'mobilidade');
});

// ───────────────────────── 🕐 Hora, data e agenda na voz: fatos, não LLM ─────────────────────────
var T2208 = new Date(Date.UTC(2026, 8, 24, 1, 8));   // 23/09/2026 22:08 BRT (quarta)

test('Relógio: hora e data saem do relógio, não do histórico (23/09: "São 21:29" às 22:08)', function () {
  var s = code({});
  assert.strictEqual(s._interpretarFatoVoz('que horas são').via, 'relogio');
  assert.strictEqual(s._falarRelogio({ hora: true }, T2208), 'São 22h08.');
  var f = s._interpretarFatoVoz('Me diga a data atual e a hora de atual');
  assert.ok(f && f.hora && f.data);
  assert.strictEqual(s._falarRelogio(f, T2208), 'Hoje é quarta-feira, 23 de setembro de 2026, e são 22h08.');
  assert.strictEqual(s._falarRelogio({ data: true }, T2208), 'Hoje é quarta-feira, 23 de setembro de 2026.');
  assert.strictEqual(s._falarRelogio({ hora: true }, new Date(Date.UTC(2026, 8, 24, 12, 0))), 'São 9h.', 'hora cheia sem "00"');
});

test('Relógio: armadilhas que NÃO são o relógio', function () {
  var s = code({});
  assert.strictEqual(s._interpretarFatoVoz('que horas eu bato o ponto'), null, 'é turno');
  assert.strictEqual(s._interpretarFatoVoz('que horas é a reunião'), null, 'é agenda com assunto, fica com o modelo');
  assert.strictEqual(s._interpretarFatoVoz('me lembra daqui a duas horas'), null);
});

test('Agenda: lê a agenda de verdade; vazia é dita como vazia (23/09: reunião inventada)', function () {
  var s = code({});
  var pedidos = [];
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function (a, b) { pedidos.push([a, b]); return []; } }; } };
  var f = s._interpretarFatoVoz('o que eu tenho na agenda amanhã');
  assert.deepStrictEqual({ via: f.via, periodo: f.periodo }, { via: 'agenda', periodo: 'amanha' });
  assert.strictEqual(s._falarAgenda('amanha', T2208), 'Amanhã você não tem nada na agenda.');
  // Amanhã = 24/09 00:00 BRT até 25/09 00:00 BRT, mesmo sendo 22h do dia 23
  assert.strictEqual(pedidos[0][0].toISOString(), '2026-09-24T03:00:00.000Z');
  assert.strictEqual(pedidos[0][1].toISOString(), '2026-09-25T03:00:00.000Z');
});

test('Agenda: eventos falados com hora de Brasília, dia inteiro e excedente', function () {
  var s = code({});
  function ev(t, isoIni, diaTodo) { return { getTitle: function () { return t; }, getStartTime: function () { return new Date(isoIni); }, isAllDayEvent: function () { return !!diaTodo; } }; }
  s.CalendarApp = { getDefaultCalendar: function () { return { getEvents: function () {
    return [ev('Feriado', '2026-09-24T03:00:00Z', true), ev('Dentista', '2026-09-24T17:30:00Z'), ev('Mercado', '2026-09-24T21:00:00Z')];
  } }; } };
  assert.strictEqual(s._falarAgenda('amanha', T2208), 'Amanhã: o dia todo, Feriado; às 14h30, Dentista; e às 18h, Mercado.');
});

test('Agenda: pedido de MUDANÇA fica com o modelo', function () {
  var s = code({});
  assert.strictEqual(s._interpretarFatoVoz('marca uma reunião amanhã às 10h'), null);
  assert.strictEqual(s._interpretarFatoVoz('cancela o compromisso de hoje'), null);
  assert.strictEqual(s._interpretarFatoVoz('me fala minha agenda de hoje').via, 'agenda');
});

test('Golden set da voz continua 100% com as rotas de relógio e agenda', function () {
  var s = code({});
  var r = s.diagGoldenVoz({});
  assert.strictEqual(r.falhou, 0, JSON.stringify(r.falhas));
});

// ───────────────────────── 📥 Notificações: responde já, fala depois (fila) ─────────────────────────
function _sandboxNotif() {
  var s = code({ props: { NOTIF_FALAR_JANELA: '00:00-23:59' } });
  s.__falas = [];
  s.Jarvis.controlarDispositivo = function (a) { s.__falas.push(a.texto); return { status: 'success' }; };
  return s;
}

test('Notificação: a resposta à macro NÃO espera a fala (era a causa de 1/3 das perdidas)', function () {
  var s = _sandboxNotif();
  var r = s.registrarNotificacao({ app: 'Agenda Edu', titulo: 'Catraca', texto: 'Entrada registrada', falar: '1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.guardado, true);
  assert.strictEqual(r.processamento, 'fila');
  assert.strictEqual(s.__falas.length, 0, 'nada de síntese antes de responder');
  var fila = JSON.parse(s.PropertiesService.getScriptProperties().getProperty('NOTIF_FILA'));
  assert.strictEqual(fila.length, 1);
  assert.strictEqual(fila[0].querFalar, true);
});

test('Notificação: o loopback processa a SUA notificação e ela sai da fila (no máximo uma vez)', function () {
  var s = _sandboxNotif();
  s.registrarNotificacao({ app: 'Agenda Edu', titulo: 'Catraca', texto: 'Entrada registrada', falar: '1' });
  var id = JSON.parse(s.PropertiesService.getScriptProperties().getProperty('NOTIF_FILA'))[0].id;
  assert.strictEqual(s._notifProcessarLoopback({ jobId: id }), 1);
  assert.strictEqual(s.__falas.length, 1);
  assert.match(s.__falas[0], /Agenda Edu/);
  assert.strictEqual(s._notifProcessarLoopback({ jobId: id }), 0, 'segundo disparo não fala de novo');
  assert.strictEqual(s.__falas.length, 1);
});

test('Notificação: o tick só recolhe o que o loopback deixou para trás (mais de 20 s)', function () {
  var s = _sandboxNotif();
  s.registrarNotificacao({ app: 'Swile', titulo: 'Compra', texto: 'R$ 10', falar: '1' });
  assert.strictEqual(s._notifProcessarPendentes(), 0, 'recente: ainda é a vez do loopback');
  var sp = s.PropertiesService.getScriptProperties();
  var fila = JSON.parse(sp.getProperty('NOTIF_FILA'));
  fila[0].em -= 25000;
  sp.setProperty('NOTIF_FILA', JSON.stringify(fila));
  assert.strictEqual(s._notifProcessarPendentes(), 1);
  assert.strictEqual(s.__falas.length, 1);
  assert.strictEqual(JSON.parse(sp.getProperty('NOTIF_FILA')).length, 0);
});

test('Notificação: fila tem teto (limite de 9 KB por property) e descarta a mais antiga', function () {
  var s = _sandboxNotif();
  for (var i = 0; i < 20; i++) s.registrarNotificacao({ app: 'App' + i, titulo: 't' + i, texto: 'x'.repeat(900) });
  var raw = s.PropertiesService.getScriptProperties().getProperty('NOTIF_FILA');
  var fila = JSON.parse(raw);
  assert.strictEqual(fila.length, 15);
  assert.strictEqual(fila[0].doc.app, 'App5', 'as 5 mais antigas saíram');
  assert.ok(raw.length < 9000 * 1.2, 'texto é truncado na fila');
});

test('Notificação: modo síncrono (diag) continua falando na hora', function () {
  var s = _sandboxNotif();
  var r = s.registrarNotificacao({ app: 'Teste', titulo: 'T', texto: 'agora', falar: '1', sincrono: true });
  assert.strictEqual(r.falou, true);
  assert.strictEqual(s.__falas.length, 1);
});

test('Abrir app: sai como jarvis_abrir_app com pacote e Activity (nunca abriu nada de jul a set)', function () {
  var urls = [];
  var s = makeSandbox({ props: { MACRODROID_WEBHOOK_URL: 'https://trigger.macrodroid.com/dev/jarvis' },
                        fetch: function (u) { urls.push(u); return { code: 200 }; } });
  loadGasFile('Jarvis.js', s);
  var r = s.Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: 'youtube' });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(urls.length, 1);
  assert.match(urls[0], /\/jarvis_abrir_app\?/, 'era /jarvis_abrirapp — evento que nenhuma macro escuta');
  assert.match(urls[0], /intent_package=com\.google\.android\.youtube/);
  assert.match(urls[0], /intent_class=com\.google\.android\.youtube\.app\.honeycomb\.Shell%24HomeActivity/);
});

// ───────────────────────── 📱 Abrir QUALQUER app instalado (APPS_CELULAR) ─────────────────────────
function _sandboxApps(props) {
  var urls = [];
  var p = Object.assign({ MACRODROID_WEBHOOK_URL: 'https://trigger.macrodroid.com/dev/jarvis',
    APPS_CELULAR: JSON.stringify({ 'com.exemplo.streaming': '.ui.Launch', 'com.escola.agendadigital': '.MainActivity',
                                   'com.ubercab': 'com.ubercab.UberActivity', 'com.banco.um': '.Main', 'com.banco.dois': '.Main' }),
    APPS_APELIDOS: JSON.stringify({ agendaedu: 'com.escola.agendadigital' }) }, props || {});
  var s = makeSandbox({ props: p, fetch: function (u) { urls.push(u); return { code: 200 }; } });
  loadGasFile('Jarvis.js', s);
  s.__urls = urls;
  return s;
}

test('Abrir app: apelido falado resolve para o pacote e a Activity instalados', function () {
  var s = _sandboxApps();
  var r = s.Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: 'Agenda Edu' });
  assert.strictEqual(r.status, 'success');
  assert.match(s.__urls[0], /jarvis_abrir_app\?/);
  assert.match(s.__urls[0], /intent_package=com\.escola\.agendadigital/);
  assert.match(s.__urls[0], /intent_class=com\.escola\.agendadigital\.MainActivity/, 'Activity relativa ganha o pacote na frente');
});

test('Abrir app: sem apelido, acha pelo pedaço do nome do pacote', function () {
  var s = _sandboxApps();
  assert.strictEqual(s.Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: 'Uber' }).status, 'success');
  assert.match(s.__urls[0], /intent_class=com\.ubercab\.UberActivity/);
});

test('Abrir app: app que não existe NÃO vira "Abrindo X" (era falso sucesso)', function () {
  var s = _sandboxApps();
  var r = s.Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: 'Aplicativo Inexistente' });
  assert.strictEqual(r.status, 'error');
  assert.match(r.erro, /Não encontrei/);
  assert.strictEqual(s.__urls.length, 0, 'nada disparado para o celular');
});

test('Abrir app: nome que casa com dois apps pergunta em vez de chutar', function () {
  var s = _sandboxApps();
  var r = s.Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: 'banco' });
  assert.strictEqual(r.status, 'error');
  assert.match(r.erro, /Mais de um app/);
});

test('Rota apps_celular: grava só pacotes válidos e apelidos que apontam para eles', function () {
  var s = code({});
  var r = s.registrarAppsCelular({
    apps: { 'com.exemplo.app': '.Main', 'nao eh pacote': '.Main', 'com.outro.app': 'rm -rf /' },
    apelidos: { 'Meu App': 'com.exemplo.app', 'Fantasma': 'com.nao.instalado' }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.apps, 1);
  assert.strictEqual(r.apelidos, 1);
  assert.strictEqual(r.descartados, 3);
  var sp = s.PropertiesService.getScriptProperties();
  assert.deepStrictEqual(JSON.parse(sp.getProperty('APPS_APELIDOS')), { meuapp: 'com.exemplo.app' });
});

// ───────────────────────── 🧭 Rota: "me direcione" e o status do celular ─────────────────────────
function _vozSandbox() {
  var s = makeSandbox({ props: { VOICE_API_TOKEN: 'T', OWNER_EMAIL: 'o@x' } });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  loadGasFile('Code.js', s);
  s.__cmds = [];
  s.Jarvis.controlarDispositivo = function (a) { s.__cmds.push(a); return { status: 'success' }; };
  s.Jarvis.ask = function () { return 'LLM'; };
  s.__voz = function (m) { return s.doPost({ postData: { contents: JSON.stringify({ action: 'voice_command', message: m, token: 'T' }) } }).getContentText(); };
  return s;
}

test('Rota: "me direcione para X" traça a rota sem passar pelo modelo (24/09: disse que traçou e não traçou)', function () {
  var s = _vozSandbox();
  s.__voz('me direcione para Rua José Rodrigues Pereira 185');
  var nav = s.__cmds.filter(function (c) { return c.acao === 'navegar'; });
  assert.strictEqual(nav.length, 1);
  assert.strictEqual(nav[0].destino, 'Rua José Rodrigues Pereira 185');
});

test('Rota: "em direção é para X" e "me direcione para o trabalho" também', function () {
  var s = _vozSandbox();
  s.__voz('em direção é para Rua José Rodrigues 183');
  s.__voz('me direcione para o trabalho');
  var nav = s.__cmds.filter(function (c) { return c.acao === 'navegar'; }).map(function (c) { return c.destino; });
  assert.deepStrictEqual(nav, ['Rua José Rodrigues 183', 'Trabalho']);
});

test('Status do celular: campo a campo e sem o token (voz sem bateria apagava o status real)', function () {
  var s = code({});
  s.getSessionUser = function () { return { email: 'o@x' }; };
  s.Firestore.listDocs = function (col) {
    if (col !== 'telemetria_dispositivo') return [];
    return [
      { id: 'a', dados: { recebidoEm: '2026-09-24T22:57:00Z', body: { action: 'voice_command', message: 'abre o LinkedIn', token: 'SEGREDO' } } },
      { id: 'b', dados: { recebidoEm: '2026-09-24T22:17:00Z', body: { bateria_nivel: '19', carregando: 'Desligar', wifi_nome: 'Casa', token: 'SEGREDO' } } }
    ];
  };
  var r = s.obterStatusDispositivo('tok');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.telemetria.bateria_nivel, '19');
  assert.strictEqual(r.telemetria.wifi_nome, 'Casa');
  assert.strictEqual(r.telemetria.recebidoEm, '2026-09-24T22:17:00Z', 'a hora é a do último dado do aparelho');
  assert.strictEqual(r.telemetria.token, undefined, 'token nunca vai para o navegador');
  assert.strictEqual(r.telemetria.message, undefined);
});

// ───────────────────────── 💬 WhatsApp desligado por padrão · janela de fala até 22h ─────────────────────────
test('WhatsApp: desligado por padrão, e agendar mensagem é recusado com o motivo', function () {
  var s = code({});
  s._uiOwner = function () { return true; };
  assert.strictEqual(s._whatsappAtivo(), false);
  var r = s.uiAgendarWhatsApp('tok', 'Fulano', 'oi', '2099-01-01T10:00', 0, 0);
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /WhatsApp está desligado/);
  var s2 = code({ props: { WHATSAPP_ATIVO: 'sim' } });
  assert.strictEqual(s2._whatsappAtivo(), true, 'religar é decisão explícita');
});

test('Janela de fala: padrão vai até 22h; a rota aceita só HH:MM-HH:MM', function () {
  var s = makeSandbox({ props: { VOICE_API_TOKEN: 'T' } });
  s.ContentService = { MimeType: { TEXT: 'TEXT', JSON: 'JSON' }, createTextOutput: function (t) { return { setMimeType: function () { return { getContentText: function () { return t; } }; }, getContentText: function () { return t; } }; } };
  loadGasFile('Code.js', s);
  assert.strictEqual(s._NOTIF_JANELA_PADRAO, '06:00-22:00');
  var post = function (b) { return JSON.parse(s.doPost({ postData: { contents: JSON.stringify(b) } }).getContentText()); };
  assert.strictEqual(post({ action: 'janela_notificacoes', token: 'errado', janela: '06:00-22:00' }).ok, false);
  assert.strictEqual(post({ action: 'janela_notificacoes', token: 'T', janela: '25:00-22:00' }).ok, false);
  assert.strictEqual(post({ action: 'janela_notificacoes', token: 'T', janela: '06:00-22:00; rm' }).ok, false);
  var ok = post({ action: 'janela_notificacoes', token: 'T', janela: '06:00-22:00' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(s.PropertiesService.getScriptProperties().getProperty('NOTIF_FALAR_JANELA'), '06:00-22:00');
});

test('Relógio: pedidos compostos ("me diga a data e a hora") não escapam para o modelo', function () {
  var s = code({});
  var f = s._interpretarFatoVoz('me diga a data e a hora');
  assert.ok(f && f.via === 'relogio' && f.hora && f.data, 'em 25/09 foi ao LLM e voltou a hora velha');
  assert.ok(s._interpretarFatoVoz('fala a hora').hora);
  assert.ok(s._interpretarFatoVoz('qual a data de hoje').data);
  assert.strictEqual(s._interpretarFatoVoz('me diga a hora da reunião'), null, 'hora de algo específico fica com o modelo');
});

test('Prompt: a hora real vem do sistema, não do histórico', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'Jarvis.js'), 'utf8');
  assert.match(src, /NUNCA um horário ou data citado em mensagens anteriores/);
});

test('Rota JEV: "que horas eu bato o ponto" traz os HORÁRIOS, não só o nome do turno', function () {
  var s = rotaSandbox({ props: { TYPESAFE_API_KEY: 'k' }, fetch: function () { return respostaJev('turno_consultar', 1.0); } });
  s.AlertasVoz.definirTurno('manha');
  var r = s._rotaSemantica('que horas eu bato o ponto', 'dono@exemplo.com', true);
  assert.match(r, /manhã/);
  assert.match(r, /Pontos: \d+h/, 'em 25/09 respondia só "Seu turno atual é o da manhã"');
});

test('Chat: "qual o status do meu celular?" oferece a ferramenta statusCelular (respondia "não tenho acesso")', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  var p = s.Jarvis._toolsPermitidas('qual o status do meu celular?');
  assert.ok(p && p.statusCelular, 'sugestão da própria tela do chat');
  assert.ok(s.Jarvis._toolsPermitidas('como está a bateria').statusCelular);
});

test('Gate P2 vale na voz: ações sensíveis pedem confirmação também por voz', function () {
  var fs = require('fs'), path = require('path');
  var jv = fs.readFileSync(path.join(__dirname, '..', 'Jarvis.js'), 'utf8');
  var cd = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');
  assert.match(jv, /var gateP2 = interativo \|\| !!\(opts && opts\.canal === 'voz'\)/);
  assert.match(jv, /_execTool\(fc\.name, fc\.args \|\| \{\}, userEmail, isOwner, gateP2\)/, 'a execução recebe o gate, não o "interativo" cru');
  assert.strictEqual((cd.match(/instrucaoVoz, historico, null, \{ interativo: false \}\)/g) || []).length, 0,
    'nenhuma chamada de voz ao modelo sem canal:voz (era por onde "apaga meus e-mails" passaria sem confirmar)');
});

test('WhatsApp desligado: ferramenta chamada devolve o motivo verdadeiro', function () {
  var fs = require('fs'), path = require('path');
  var jv = fs.readFileSync(path.join(__dirname, '..', 'Jarvis.js'), 'utf8');
  assert.match(jv, /\/WhatsApp\/\.test\(name\) && typeof _whatsappAtivo === 'function' && !_whatsappAtivo\(\)/);
  assert.match(jv, /listaCompleta = listaCompleta\.filter\(function \(t\) \{ return !\/WhatsApp\/\.test\(t\.name\); \}\)/);
});

// ───────────────────────── 📧 E-mails pela voz, ideia em 2ª pessoa, volume do Gemini ─────────────────────────
test('E-mails: "resuma meus e-mails não lidos" vira rota direta (era 353 s pelo modelo)', function () {
  var s = code({});
  assert.strictEqual(s._interpretarFatoVoz('resuma meus e-mails não lidos').via, 'emails');
  assert.strictEqual(s._interpretarFatoVoz('quais e-mails chegaram').via, 'emails');
  assert.strictEqual(s._interpretarFatoVoz('manda um e-mail pro João'), null, 'ação fica com o modelo (e o gate)');
  assert.strictEqual(s._interpretarFatoVoz('lê o e-mail do banco'), null, 'e-mail específico fica com o modelo');
  assert.strictEqual(s._interpretarFatoVoz('apaga meus e-mails'), null);
});

test('E-mails: frase falável com remetente sem endereço e total real', function () {
  var s = code({});
  function th(de, ass) { return { getMessages: function () { return [{ getFrom: function () { return de; } }]; }, getFirstMessageSubject: function () { return ass; } }; }
  s.GmailApp = { search: function () { return [th('"Loja X" <promo@loja.com>', 'Oferta de hoje'), th('Banco <aviso@banco.com>', 'Fatura fechada')]; },
                 getInboxUnreadCount: function () { return 8; } };
  var t = s._falarEmails();
  assert.match(t, /^Você tem 8 e-mails não lidos\. Os 2 mais recentes: de Loja X, sobre Oferta de hoje; de Banco, sobre Fatura fechada\.$/);
  assert.ok(t.indexOf('@') === -1 && t.indexOf('*') === -1, 'nada de endereço nem markdown na fala');
  s.GmailApp = { search: function () { return []; }, getInboxUnreadCount: function () { return 0; } };
  assert.match(s._falarEmails(), /não tem e-mails não lidos/);
});

test('Ideia: falada em segunda pessoa ("O Bruno pode criar..." saía assim em 25/09)', function () {
  var s = code({});
  assert.strictEqual(s._insSegundaPessoa('O Bruno pode criar um sistema. Primeiro passo: liste.'), 'Você pode criar um sistema. Primeiro passo: liste.');
  assert.strictEqual(s._insSegundaPessoa('Isso ajuda. Bruno deve testar hoje.'), 'Isso ajuda. Você deve testar hoje.');
  assert.strictEqual(s._insSegundaPessoa('Mostre ao time do Bruno.'), 'Mostre ao time do Bruno.', 'meio de frase não é sujeito');
});

test('Volume: PCM do Gemini é normalizado (saía baixo) sem distorcer nem inflar silêncio', function () {
  var s = makeSandbox({ props: { GEMINI_API_KEY: 'k' }, fetch: function () {
    // 4 amostras L16: pico 4000 → ganho limitado a 4x → 16000
    var pcm = Buffer.from([0xA0, 0x0F, 0x60, 0xF0, 0xE8, 0x03, 0x00, 0x00]);   // 4000, -4000, 1000, 0
    return { code: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] } };
  } });
  s.Utilities.base64Decode = function (b) { return Array.from(Buffer.from(b, 'base64')).map(function (x) { return x > 127 ? x - 256 : x; }); };
  s.Utilities.base64Encode = function (arr) { return Buffer.from(arr.map(function (x) { return x & 255; })).toString('base64'); };
  loadGasFile('Voz.js', s);
  var r = s.Voz.sintetizarGemini('oi', {});
  assert.strictEqual(r.status, 'success');
  var wav = Buffer.from(r.base64, 'base64');
  var amostras = [0, 1, 2, 3].map(function (i) { return wav.readInt16LE(44 + i * 2); });
  assert.deepStrictEqual(amostras, [16000, -16000, 4000, 0], 'ganho de 4x (teto) aplicado igual em todas');
});

test('Volume: sem FALA_VOLUME_DB o ganho é +10 dB (Number(null) = 0 zerava o padrão desde sempre)', function () {
  var s = makeSandbox({}); loadGasFile('Jarvis.js', s);
  var pedido = null;
  s.Voz = { temChave: function () { return true; }, sintetizar: function (t, o) { pedido = o; return { status: 'error', erro: 'parar aqui' }; } };
  s.Jarvis.prepararVozCelular('teste de volume');
  assert.ok(pedido, 'chegou a sintetizar');
  assert.strictEqual(pedido.volume, 10);
  var s2 = makeSandbox({ props: { FALA_VOLUME_DB: '4' } }); loadGasFile('Jarvis.js', s2);
  s2.Voz = { temChave: function () { return true; }, sintetizar: function (t, o) { pedido = o; return { status: 'error', erro: 'x' }; } };
  s2.Jarvis.prepararVozCelular('x');
  assert.strictEqual(pedido.volume, 4, 'property explícita continua mandando');
});
