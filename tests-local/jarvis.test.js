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
