/**
 * Aplicativo Web Soft App · Chat IA — Web App (Google Apps Script / HtmlService)
 * ------------------------------------------------------------------------------
 * Etapa 1: camada de UI (sidebar recolhível + chat IA) em neumorphism +
 * glassmorphism. Estrutura modular com include():
 *   Index.html  → estrutura (puxa Stylesheet.html e Javascript.html)
 *   Stylesheet.html → <style> com os design tokens
 *   Javascript.html → <script> com o comportamento da UI
 * O backend (banco Google != Sheets, IA, etc.) entra nas próximas etapas.
 */

/**
 * Ponto de entrada do Web App.
 * Usa createTemplateFromFile().evaluate() para PROCESSAR os scriptlets
 * <?!= include('...') ?> dentro do Index.html.
 */
/** Ponte para o painel interativo: o fetch() do painel era CROSS-ORIGIN (a pagina roda em
 *  script.googleusercontent.com e chamava script.google.com), e o GAS nao manda cabecalho CORS —
 *  a requisicao nao chegava. Com google.script.run a chamada e same-origin e devolve o resultado
 *  REAL, para o painel parar de anunciar sucesso que nao houve. */
function responderCallbackInterativo(id, botao, resposta) {
  try {
    var out = doGet({ parameter: { action: 'callback_interativa', id: String(id || ''),
                                   botao: String(botao || ''), resposta: String(resposta || '') } });
    var txt = (out && out.getContent) ? out.getContent() : String(out);
    return { ok: !/^Erro|^N[aã]o entendi|^Digite os saldos/.test(txt), mensagem: txt };
  } catch (e) { return { ok: false, mensagem: 'Falha: ' + e.message }; }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'ler_debug') {
    var jsonOut = function (obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); };
    var tokDb = e.parameter.token;
    var pDb = PropertiesService.getScriptProperties();
    var vtDb = pDb.getProperty('VOICE_API_TOKEN');
    if (!tokDb || tokDb !== vtDb) return jsonOut({ ok: false, erro: 'não autorizado' });
    try {
      var telemetria = Firestore.listDocs('telemetria_dispositivo', 10);
      var eventos = Firestore.listDocs('agente_eventos', 30);
      return jsonOut({ telemetria: telemetria, eventos: eventos });
    } catch (errDb) {
      return jsonOut({ ok: false, erro: errDb.message });
    }
  }
  if (e && e.parameter && e.parameter.action === 'painel_interativa') {
    try {
      var id = e.parameter.id;
      var cbDoc = Firestore.getDoc('callbacks_interativos', id);
      if (!cbDoc) {
        return HtmlService.createHtmlOutput("<h3>Notificação expirada ou inválida.</h3>");
      }
      
      var template = HtmlService.createTemplateFromFile('PainelInterativo');
      template.id = id;
      template.titulo = cbDoc.titulo || 'Notificação';
      template.texto = cbDoc.texto || '';
      template.opcao1 = cbDoc.opcao1 || 'Sim';
      template.opcao2 = cbDoc.opcao2 || 'Não';
      template.tipo = cbDoc.tipo || 'conversa';
      template.respondido = cbDoc.respondido ? true : false;
      
      return template.evaluate()
        .setTitle(cbDoc.titulo || "Jarvis OS")
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (errHtml) {
      return HtmlService.createHtmlOutput("<h3>Erro ao carregar o painel: " + errHtml.message + "</h3>");
    }
  }

  if (e && e.parameter && e.parameter.action === 'callback_interativa') {
    try {
      var id = e.parameter.id;
      var botao = e.parameter.botao; // '1', '2' ou 'texto'
      var resposta = e.parameter.resposta || ''; // se for input de texto
      
      var cbDoc = Firestore.getDoc('callbacks_interativos', id);
      if (!cbDoc) return ContentService.createTextOutput("Erro: Callback não encontrado").setMimeType(ContentService.MimeType.TEXT);
      if (cbDoc.respondido) return ContentService.createTextOutput("Erro: Callback já respondido").setMimeType(ContentService.MimeType.TEXT);
      
      cbDoc.respondido = true;
      Firestore.setDoc('callbacks_interativos', id, cbDoc);
      
      // SALDO: ele digita os dois valores no campo de texto do painel.
      if (cbDoc.tipo === 'saldo') {
        if (botao === '2') return ContentService.createTextOutput('Ok, depois então.').setMimeType(ContentService.MimeType.TEXT);
        if (botao !== 'texto') {
          // botão 1 não carrega valor — reabre para ele digitar, em vez de gravar lixo.
          cbDoc.respondido = false;
          try { Firestore.setDoc('callbacks_interativos', id, cbDoc); } catch (eR) {}
          return ContentService.createTextOutput('Digite os saldos no campo de texto (ex.: 700, 250) e toque em Enviar.').setMimeType(ContentService.MimeType.TEXT);
        }
        var lidoS = (typeof _finLerSaldoDeTexto === 'function') ? _finLerSaldoDeTexto(resposta) : null;
        if (!lidoS) {
          cbDoc.respondido = false;
          try { Firestore.setDoc('callbacks_interativos', id, cbDoc); } catch (eR2) {}
          return ContentService.createTextOutput('Não entendi o valor. Tente algo como "700, 250".').setMimeType(ContentService.MimeType.TEXT);
        }
        var rs = definirSaldoFinanceiro({ voucher: lidoS.voucher, mobilidade: lidoS.mobilidade, origem: 'recarga' });
        var txtOk = rs.ok
          ? ('Saldo registrado - voucher ' + (rs.saldo.voucher === null ? '(nao informado)' : ('R$ ' + rs.saldo.voucher.toFixed(2))) +
             ', mobilidade ' + (rs.saldo.mobilidade === null ? '(nao informado)' : ('R$ ' + rs.saldo.mobilidade.toFixed(2))) + '.')
          : ('Nao consegui gravar: ' + rs.erro);
        return ContentService.createTextOutput(txtOk).setMimeType(ContentService.MimeType.TEXT);
      }

      // Processa conforme o tipo
      if (cbDoc.tipo === 'conversa') {
        var textoResposta = "";
        if (botao === '1') textoResposta = cbDoc.opcao1;
        else if (botao === '2') textoResposta = cbDoc.opcao2;
        else textoResposta = resposta;
        
        // Simula a fala do usuário na conversa atual (chama ask)
        var respLLM = Jarvis.ask(cbDoc.emailUser, textoResposta, null, null, { interativo: true, conversaId: cbDoc.conversaId });
        
        // A resposta volta para o celular: ele acabou de tocar no botão e espera ouvir o retorno.
        // (Ia para o WhatsApp, fora do ar desde 10/07 — a resposta simplesmente sumia.)
        if (respLLM) { try { _avisarDono({ origem: 'interativa', titulo: '🤖 Jarvis', texto: respLLM, falar: respLLM }); } catch (eAv) {} }
        
        return ContentService.createTextOutput("Callback processado. Resposta enviada.").setMimeType(ContentService.MimeType.TEXT);
      } else {
        // Executa ação direta em segundo plano (Opção A)
        var logMsg = "[notificacao_interativa] Ação executada para o callback " + id + " (Botão: " + botao + ")";
        if (resposta) logMsg += " com resposta: " + resposta;
        
        if (typeof WikiMemoryService !== 'undefined') {
          WikiMemoryService.registrarNoLog(logMsg);
        } else {
          Logger.log(logMsg);
        }
        
        // Confirmação no celular (era WhatsApp, fora do ar desde 10/07).
        var escolhaStr = (botao === '1' ? cbDoc.opcao1 : (botao === '2' ? cbDoc.opcao2 : resposta));
        try { _avisarDono({ origem: 'interativa', titulo: '✅ Ação executada', texto: cbDoc.texto + '\nEscolha: ' + escolhaStr }); } catch (eAv) {}
        
        return ContentService.createTextOutput("Ação executada com sucesso.").setMimeType(ContentService.MimeType.TEXT);
      }
    } catch (errCb) {
      return ContentService.createTextOutput("Erro ao processar callback: " + errCb.message).setMimeType(ContentService.MimeType.TEXT);
    }
  }

  // Polling do TASKER (app de automação no celular): GET ?dispositivo=fila&token=DEVICE_API_TOKEN
  // → devolve os comandos pendentes em JSON e ESVAZIA a fila (entrega at-most-once).
  if (e && e.parameter && e.parameter.dispositivo === 'fila') {
    var jsonOut = function (obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); };
    var tok = PropertiesService.getScriptProperties().getProperty('DEVICE_API_TOKEN');
    if (!tok || e.parameter.token !== tok) return jsonOut({ ok: false, erro: 'não autorizado' });
    return jsonOut({ ok: true, comandos: _drainDeviceQueue() });
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Aplicativo Web Soft App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ===== Fila de comandos do DISPOSITIVO (Android via Tasker) =================================
 * O Jarvis ENFILEIRA comandos abstratos ({acao, args}); o Tasker no celular FAZ POLLING do /exec
 * (?dispositivo=fila) e executa a ação nativa. Fila em Script Property (DEVICE_QUEUE) + LockService.
 * ========================================================================================== */
function _enqueueDeviceCmd(acao, args) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) {}
  try {
    var p = PropertiesService.getScriptProperties();
    var fila = []; try { fila = JSON.parse(p.getProperty('DEVICE_QUEUE') || '[]'); } catch (e2) { fila = []; }
    var cmd = { id: Utilities.getUuid().slice(0, 8), acao: String(acao || ''), args: args || {}, ts: Date.now() };
    fila.push(cmd);
    if (fila.length > 50) fila = fila.slice(-50);
    p.setProperty('DEVICE_QUEUE', JSON.stringify(fila));
    return cmd;
  } finally { try { lock.releaseLock(); } catch (e3) {} }
}
function _drainDeviceQueue() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) {}
  try {
    var p = PropertiesService.getScriptProperties();
    var fila = []; try { fila = JSON.parse(p.getProperty('DEVICE_QUEUE') || '[]'); } catch (e2) { fila = []; }
    if (fila.length) p.setProperty('DEVICE_QUEUE', '[]');
    return fila;
  } finally { try { lock.releaseLock(); } catch (e3) {} }
}
/** Diag: vê a fila de comandos do dispositivo SEM esvaziar. */
function verDeviceQueue() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEVICE_QUEUE') || '[]'); } catch (e) { return []; }
}
/** Configura a URL de webhook do MacroDroid (push direto pro celular). args:{url} ou string.
 *  O Jarvis passa a CHAMAR essa URL (com ?acao=...&hora=...) em controlarDispositivo. */
function configurarMacroDroid(args) {
  var url = (args && (args.url || args)) ? String(args.url || args).trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, erro: 'Informe a URL do webhook do MacroDroid (https://...).' };
  PropertiesService.getScriptProperties().setProperty('MACRODROID_WEBHOOK_URL', url);
  Logger.log('✅ MACRODROID_WEBHOOK_URL configurada: ' + url);
  return { ok: true, url: url };
}

/** P7.4 · Gera/guarda o segredo do webhook do MacroDroid. O Jarvis passa a anexar &sig=<segredo>
 *  em todo disparo; no MacroDroid, crie uma Constraint em cada macro: Magic Text [sig] = <segredo>.
 *  Execute UMA VEZ no editor e guarde o valor (vai no passo a passo do MacroDroid). */
function configurarSegredoMacroDroid() {
  var s = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('MACRODROID_WEBHOOK_SECRET', s);
  Logger.log('✅ MACRODROID_WEBHOOK_SECRET gerado:\n' + s + '\n\nNo MacroDroid, em CADA macro (jarvis_falar, jarvis_alarme...),\nadicione uma Restrição (Constraint): Magic Text  [sig]  É igual a  ' + s);
  return { ok: true, segredo: s };
}

/** P7.4 · Gera/guarda o segredo do webhook do WhatsApp (Evolution). Depois, no painel da Evolution,
 *  acrescente ?wh=<segredo> ao final da URL do webhook. Sem isso, o endpoint aceita qualquer POST.
 *  args.segredo (opcional): usa um valor específico em vez de gerar — permite ativação SEM downtime
 *  (atualize a Evolution com o ?wh=<valor> ANTES de setar a property). */
function configurarSegredoWebhookWhatsApp(args) {
  var s = (args && args.segredo) ? String(args.segredo) : Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('WHATSAPP_WEBHOOK_SECRET', s);
  var url = '';
  try { url = ScriptApp.getService().getUrl().replace(/\/dev$/, '/exec'); } catch (e) {}
  Logger.log('✅ WHATSAPP_WEBHOOK_SECRET gerado:\n' + s + '\n\nNa Evolution, configure a URL do webhook como:\n' + (url || '<SUA_URL_/exec>') + '?wh=' + s);
  return { ok: true, segredo: s, exemploUrl: (url || '<SUA_URL_/exec>') + '?wh=' + s };
}

/** Dispara uma FALA REAL no celular (sintetiza + empurra pro MacroDroid). Para testar volume pelo
 *  dispatcher sem digitar no chat. args:{texto}. */
function testarFalaCelular(args) {
  var texto = (args && (args.texto || (typeof args === 'string' ? args : ''))) || 'Teste de áudio do Jarvis no seu celular.';
  var voz = args && args.voz ? String(args.voz) : null;
  if (typeof Jarvis === 'undefined' || !Jarvis.controlarDispositivo) return { ok: false, erro: 'Jarvis.controlarDispositivo indisponível.' };
  var r = Jarvis.controlarDispositivo({ acao: 'falar', texto: texto, voz: voz });
  return { ok: !!(r && r.status === 'success'), texto: texto, voz: voz, resultado: r };
}

/** TESTE da DISCRIÇÃO: roda o fluxo REAL do aviso de contato (analisa o assunto, decide voz por gênero
 *  e modo discreto p/ assunto sensível). args:{de, texto, numero?, tipoMidia?}. Toca no celular E
 *  retorna o que foi decidido. */
function testarAvisoContato(args) {
  args = args || {};
  var de = String(args.de || args.nome || 'Contato Teste');
  var texto = String(args.texto || '');
  var numero = String(args.numero || '');
  var tipoMidia = String(args.tipoMidia || '');
  _FALA_FEITA = false;
  _avisarContatoNoCelular(de, texto, tipoMidia, numero);   // fluxo REAL (pode falar no celular)
  var aval = _avaliarSensibilidade(texto, de);
  var sensivel = aval.sensivel;
  var p = PropertiesService.getScriptProperties();
  var ignorado = _contatoNaLista(p.getProperty('FALA_CONTATO_IGNORAR'), de, numero);
  var discreto = ignorado ? false : ((tipoMidia === 'imagem') || _contatoNaLista(p.getProperty('FALA_CONTATO_DISCRETO'), de, numero) || sensivel);
  var g = _generoPorNome(de);
  return {
    ok: true, de: de,
    decisao: ignorado ? 'IGNORADO (sem aviso)' : (discreto ? 'DISCRETO (não lê o conteúdo)' : 'NORMAL (lê o conteúdo)'),
    assuntoSensivel: sensivel,
    // A análise do JEV vai CRUA no diagnóstico: probabilidade, limiar e quem decidiu.
    analise: { probabilidade: aval.prob, limiar: aval.limiar, decididoPor: aval.via,
               modelo: aval.model || null, ms: aval.ms, erro: aval.erro || null },
    genero: g === 'f' ? 'feminino' : (g === 'm' ? 'masculino' : 'indefinido'),
    voz: (g === 'f') ? 'pt-BR-Chirp3-HD-Sulafat' : 'pt-BR-Chirp3-HD-Enceladus'
  };
}

/** DIAGNÓSTICO: a People API responde? quantos contatos? amostra (nome + últimos 4 dígitos, mascarado). */
function diagContatos() {
  try {
    if (typeof Contatos === 'undefined' || !Contatos.listar) return { ok: false, erro: 'Módulo Contatos ausente.' };
    var lista = Contatos.listar(8);
    return {
      ok: true, total_amostra: lista.length,
      amostra: lista.map(function (c) {
        return { nome: c.nome, tel_final: (c.telefones[0] || '').replace(/\D/g, '').slice(-4), formato: c.telefones[0] || '' };
      })
    };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** DIAGNÓSTICO: dado um número, mostra o nome SALVO (Google Contatos), o gênero detectado e a voz que
 *  seria usada no aviso. args:{numero}. Valida a cadeia nome→gênero→voz com um contato real. */
function testarContatoFala(args) {
  var numero = String((args && (args.numero || args)) || '').replace(/\D/g, '');
  if (numero.length < 6) return { ok: false, erro: 'Informe um número válido (com DDD).' };
  var nome = '';
  try { nome = (typeof Contatos !== 'undefined' && Contatos.nomeDe) ? Contatos.nomeDe(numero) : ''; } catch (e) { return { ok: false, erro: 'People API: ' + e.message }; }
  var g = _generoPorNome(nome || '');
  return {
    ok: true, numero: numero,
    nomeSalvo: nome || '(não encontrado no Google Contatos)',
    genero: g === 'f' ? 'feminino' : (g === 'm' ? 'masculino' : 'indefinido'),
    voz: (g === 'f') ? 'pt-BR-Chirp3-HD-Sulafat' : 'pt-BR-Chirp3-HD-Enceladus'
  };
}

/** Diag: mostra PARA QUAL pasta do Drive o Jarvis aponta (wiki/raw) + lista a raw. Diagnostica
 *  o desync local↔Drive (se o wiki do Drive tem poucas sources, o local não foi sincronizado). */
function diagRaw() {
  var p = PropertiesService.getScriptProperties();
  var info = { WIKI_DRIVE_ID: p.getProperty('WIKI_DRIVE_ID'), RAW_DRIVE_ID: p.getProperty('RAW_DRIVE_ID'), BASE_CONHECIMENTO_DRIVE_ID: p.getProperty('BASE_CONHECIMENTO_DRIVE_ID') };
  try { var wf = DriveApp.getFolderById(info.WIKI_DRIVE_ID); info.wiki_nome = wf.getName(); var par = wf.getParents(); if (par.hasNext()) { var pp = par.next(); info.wiki_pai = pp.getName(); info.wiki_pai_id = pp.getId(); } } catch (e) { info.wiki_erro = e.message; }
  try { var rf = DriveApp.getFolderById(info.RAW_DRIVE_ID); info.raw_nome = rf.getName(); var rpar = rf.getParents(); info.raw_pai = rpar.hasNext() ? rpar.next().getName() : '(sem pai)'; } catch (e) { info.raw_erro = e.message; }
  try { info.lista = (typeof WikiMemoryService !== 'undefined' && WikiMemoryService.listarRaw) ? WikiMemoryService.listarRaw({}) : null; } catch (e) { info.lista_erro = e.message; }
  return info;
}

/** Diag: estado do índice semântico — páginas/trechos JÁ vetorizados vs total de .md no wiki do Drive. */
function diagIndice() {
  var out = { indexado: null, total_md_no_wiki: null };
  try { if (typeof Semantica !== 'undefined' && Semantica.status) out.indexado = Semantica.status(); } catch (e) { out.indexado_erro = e.message; }
  try {
    var rootId = PropertiesService.getScriptProperties().getProperty('WIKI_DRIVE_ID'), n = 0;
    (function walk(folder) {
      var fs = folder.getFiles(); while (fs.hasNext()) { var f = fs.next(); if (/\.md$/i.test(f.getName())) n++; }
      var subs = folder.getFolders(); while (subs.hasNext()) { var sf = subs.next(); if (/^raw$/i.test(sf.getName())) continue; walk(sf); }
    })(DriveApp.getFolderById(rootId));
    out.total_md_no_wiki = n;
  } catch (e) { out.total_erro = e.message; }
  if (out.indexado && out.total_md_no_wiki != null) out.faltam = Math.max(0, out.total_md_no_wiki - (out.indexado.paginas || 0));
  return out;
}

/** Captura um conhecimento no SEGUNDO CÉREBRO (pelo dispatcher). args:{fonte, tema?}. */
function testarCaptura(args) { return (typeof Jarvis !== 'undefined' && Jarvis.capturarConhecimento) ? Jarvis.capturarConhecimento(args || {}) : { status: 'error', erro: 'indisponível' }; }

/** Reposiciona o briefing p/ X min antes do ponto de entrada do turno vigente. args {turno?}. */
function reposicionarBriefing(args) {
  if (typeof AlertasVoz === 'undefined' || !AlertasVoz.reposicionarBriefing) return { ok: false, erro: 'AlertasVoz indisponível.' };
  return AlertasVoz.reposicionarBriefing(args && args.turno);
}

/** Cria/lista/cancela ALERTAS DE VOZ no celular (pelo dispatcher). */
function criarAlertaVoz(args)    { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.criar(args || {}) : { ok: false, erro: 'AlertasVoz indisponível.' }; }   // args.tag define o papel (ponto/briefing/briefing_manha/briefing_noite)
function listarAlertasVoz()      { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.listar() : []; }
function cancelarAlertaVoz(args) { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.cancelar(args && (args.alerta || args.id || args)) : { ok: false }; }
/** Define o turno (manha|tarde): limpa os alertas de ponto antigos e cria os 4 do turno. */
function definirTurnoTrabalho(args) { return (typeof AlertasVoz !== 'undefined' && AlertasVoz.definirTurno) ? AlertasVoz.definirTurno(args && (args.turno || args)) : { ok: false, erro: 'AlertasVoz indisponível.' }; }

/** Liga/desliga o aviso falado no Android quando um contato manda mensagem. args:{estado:'on'|'off'}. */
function configurarAvisoContato(args) {
  var estado = String((args && (args.estado || args)) || '').toLowerCase();
  if (estado !== 'on' && estado !== 'off') return { ok: false, erro: "Informe estado: 'on' ou 'off'." };
  PropertiesService.getScriptProperties().setProperty('FALA_AVISA_CONTATO', estado);
  return { ok: true, FALA_AVISA_CONTATO: estado };
}

/** Configura as listas de contatos do aviso falado. args (todos opcionais, CSV "Nome, 5511...; Outro"):
 *  - ignorar:  contatos que NÃO geram aviso (silêncio total)
 *  - discreto: contatos cujo aviso NÃO lê o conteúdo (só "Fulano te enviou uma mensagem")
 *  - fem:      contatos do gênero feminino (voz Sulafat) — força quando a heurística erra
 *  - sensivel: palavras-extra de assunto sensível (também ativam o modo discreto)
 *  Passe a string vazia "" para LIMPAR uma lista. */
function configurarContatosFala(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var mapa = { ignorar: 'FALA_CONTATO_IGNORAR', discreto: 'FALA_CONTATO_DISCRETO', fem: 'FALA_CONTATO_FEM', sensivel: 'FALA_ASSUNTO_SENSIVEL' };
  var out = {};
  Object.keys(mapa).forEach(function (k) {
    if (args[k] !== undefined && args[k] !== null) { p.setProperty(mapa[k], String(args[k])); }
    out[mapa[k]] = p.getProperty(mapa[k]) || '';
  });
  return { ok: true, listas: out };
}

/** DIAGNÓSTICO de volume: sintetiza a MESMA frase em WAV (PCM16) com ganho 0 e 16 dB e mede o pico.
 *  Diz se o Chirp3 aplica volumeGainDb (pico maior em 16) e quão perto do talo a fonte está (picoDbFS). */
function diagVolumeFala() {
  function medir(db) {
    var r = Voz.sintetizar('Teste de volume, um, dois, três.', { formato: 'wav', volume: db });
    if (r.status !== 'success') return { erro: r.erro };
    var b = Utilities.base64Decode(r.base64);
    var max = 0, n = b.length, soma = 0, cnt = 0;
    for (var i = 44; i + 1 < n; i += 2) {
      var s = ((b[i + 1] << 8) | (b[i] & 0xff)); if (s >= 32768) s -= 65536;
      var a = s < 0 ? -s : s; if (a > max) max = a;
      soma += s * s; cnt++;
    }
    var rms = cnt ? Math.sqrt(soma / cnt) : 0;
    return {
      db: db, amostras: cnt,
      picoDbFS: Number((20 * Math.log(Math.max(1, max) / 32768) / Math.LN10).toFixed(2)),
      rmsDbFS: Number((20 * Math.log(Math.max(1, rms) / 32768) / Math.LN10).toFixed(2)),
      ganhoAteOTopo: Number((20 * Math.log(32768 / Math.max(1, max) / Math.LN10) / 1).toFixed(2))
    };
  }
  var voz = Voz.temChave() ? (PropertiesService.getScriptProperties().getProperty('TTS_VOICE') || 'pt-BR-Chirp3-HD-Enceladus') : '(sem SA)';
  return { voz: voz, ganho0: medir(0) };
}

/** Teste MÍNIMO (≈5 tokens) que mostra qual TIER/modelo respondeu — confirma o free tier funcionando. */
function pingGemini() {
  try {
    var r = Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: 'responda apenas: ok' }] }], generationConfig: { maxOutputTokens: 5, temperature: 0 } });
    var txt = ''; try { txt = r.json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) {}
    return { ok: true, tier: r.tier, model: r.model, resposta: String(txt).substring(0, 40) };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** 💰 MODO ECONOMIA — força o Gemini a usar o FREE TIER primeiro e desliga o que gasta token à toa.
 *  Corrige o gasto na API paga: free_first + gemini-2.5-flash (free) + thinking/crítico/prefetch OFF. */
function modoEconomiaGemini() {
  var p = PropertiesService.getScriptProperties();
  var chaves = ['GEMINI_FREE_ONLY', 'GEMINI_ORDER', 'GEMINI_MODEL', 'GEMINI_MODEL_FALLBACK', 'GEMINI_THINKING', 'CRITIC_ENABLED', 'RAG_PREFETCH'];
  var antes = {}; chaves.forEach(function (k) { antes[k] = p.getProperty(k); });
  p.setProperty('GEMINI_FREE_ONLY', 'true');             // 💯 100% FREE — chave paga EXCLUÍDA de tudo
  p.setProperty('GEMINI_ORDER', 'free_first');
  p.setProperty('GEMINI_MODEL', 'gemini-2.5-flash');      // free tier (gemini-3-preview era pago)
  p.setProperty('GEMINI_MODEL_FALLBACK', 'gemini-2.5-flash-lite');
  p.setProperty('GEMINI_THINKING', 'off');               // sem reasoning extra (corta tokens de saída)
  p.setProperty('CRITIC_ENABLED', 'false');              // sem a chamada extra do revisor
  p.setProperty('RAG_PREFETCH', 'false');                // sem prefetch preditivo (chamadas extras)
  var depois = {}; chaves.forEach(function (k) { depois[k] = p.getProperty(k); });
  return { ok: true, antes: antes, depois: depois,
    nota: '100% FREE: a chave de faturamento foi EXCLUÍDA de TODAS as chamadas (chat, embeddings/RAG, grounding, url_context, imagem). Usa as 2 chaves free. Custo na API paga = R$0. Reative com permitirFaturamentoGemini quando puder.' };
}

/** Religa (ou desliga) o uso da chave de FATURAMENTO como último recurso. args:{ativar:true|false}. */
function permitirFaturamentoGemini(args) {
  var ativar = !!(args && (args.ativar === true || String(args.ativar || args).toLowerCase() === 'true'));
  PropertiesService.getScriptProperties().setProperty('GEMINI_FREE_ONLY', ativar ? 'false' : 'true');
  return { ok: true, freeOnly: !ativar, nota: ativar ? 'Faturamento RELIGADO como último recurso (free continua primeiro; teto do AI Studio te protege).' : '100% FREE: faturamento desligado.' };
}

/** Ajusta o ganho de volume da fala no celular (volumeGainDb do Cloud TTS) sem deploy.
 *  args:{db} entre -96 e 16. Ex.: 16 = mais alto possível na fonte. */
function configurarFalaVolume(args) {
  var db = Number(args && (args.db != null ? args.db : args));
  if (!isFinite(db)) return { ok: false, erro: 'Informe db (número entre -96 e 16).' };
  db = Math.max(-96, Math.min(16, db));
  PropertiesService.getScriptProperties().setProperty('FALA_VOLUME_DB', String(db));
  Logger.log('✅ FALA_VOLUME_DB = ' + db);
  return { ok: true, db: db };
}

/** Garante o arquivo de voz no Drive (ID estável) e devolve a URL FIXA de download p/ colar na macro
 *  "Jarvis Falar" do MacroDroid. args:{texto?} — texto é só p/ gerar o áudio de teste. */
function obterUrlFala(args) {
  var texto = (args && (args.texto || (typeof args === 'string' ? args : ''))) || 'Voz do Jarvis configurada com sucesso.';
  if (typeof Jarvis === 'undefined' || !Jarvis.prepararVozCelular) return { ok: false, erro: 'Jarvis.prepararVozCelular indisponível.' };
  var r = Jarvis.prepararVozCelular(texto);
  if (!r.ok) return { ok: false, erro: r.erro };
  Logger.log('✅ URL FIXA da fala (cole na macro): ' + r.url);
  return { ok: true, id: r.id, url: r.url, dica: 'Cole esta URL na ação "Requisição HTTP" da macro Jarvis Falar.' };
}

/** Gera o DEVICE_API_TOKEN (polling do Tasker). Execute UMA VEZ no editor e guarde. */
function configurarDeviceToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('DEVICE_API_TOKEN', token);
  Logger.log('✅ DEVICE_API_TOKEN gerado:\n' + token + '\n\nNo Tasker, GET → /exec?dispositivo=fila&token=' + token);
  return token;
}

/**
 * Inclui o conteúdo de outro arquivo HTML no template (CSS/JS modular).
 * Aceita o nome com ou sem ".html" (ex.: include('Stylesheet.html')
 * ou include('Stylesheet') funcionam igual).
 *
 * @param {string} filename Nome do arquivo HTML do projeto.
 * @return {string} Conteúdo bruto do arquivo, para injeção no template.
 */
function include(filename) {
  var name = String(filename).replace(/\.html$/i, '');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Stub do endpoint de IA chamado pelo frontend via google.script.run.askIA().
 * Substitua o corpo pela integração real (Gemini, etc.) na etapa de backend.
 *
 * @param {string} mensagem Texto enviado pelo usuário.
 * @param {string} token Token de sessão (validado no servidor).
 * @return {string} Resposta da IA.
 */
// DEGRADAÇÃO GRACIOSA: traduz falhas de dependência (plataforma) em aviso CLARO + o que ainda funciona,
// em vez de erro técnico cru. (Inspirado na tese de "dependência de plataformas" — LABCOM 2026.)
function _erroAmigavel(msg) {
  msg = String(msg || '');
  if (/spending cap|quota|RESOURCE_EXHAUSTED|\b429\b/i.test(msg)) {
    return '⚠️ Estou sem cota do Gemini no momento (teto de gasto mensal atingido) — a parte de IA/conversa está temporariamente indisponível.\n\n' +
      '✅ Seguem funcionando (não usam IA): Gmail, Agenda/Calendar, Tarefas, Contatos, Drive, WhatsApp (enviar/agendar/localização/contato), leitura/monitor de páginas e geração de áudio.\n\n' +
      'Para reativar a IA: ajuste o teto em https://ai.studio/spend (ou aguarde o reset mensal).';
  }
  if (/Firestore/i.test(msg)) return '⚠️ Tive um problema ao acessar o banco de dados (Firestore) agora. Tente novamente em instantes.';
  if (/Text-to-Speech|\bTTS\b|service account/i.test(msg)) return '⚠️ A síntese de voz está indisponível agora (credencial/serviço de voz). O texto continua funcionando normalmente.';
  if (/Evolution|sendText|webhook|instância/i.test(msg)) return '⚠️ A conexão com o WhatsApp (Evolution) falhou agora. Verifique se a instância está conectada no painel.';
  return '⚠️ Tive um problema ao processar isto: ' + msg.substring(0, 300);
}

/**
 * Subagente CRÍTICO (generator-critic, porta do Antigravity). OPT-IN: só roda com a Script
 * Property CRITIC_ENABLED=true (custa 1 chamada Gemini extra por mensagem). Não re-executa a
 * cadeia em caso de reprovação — apenas sinaliza baixa confiança ao usuário (economia de cota).
 */
function _aplicarCritico(pergunta, resposta) {
  var p = PropertiesService.getScriptProperties();
  if ((p.getProperty('CRITIC_ENABLED') || '').toLowerCase() !== 'true') return resposta;
  var txt = String(resposta || '');
  // Não critica erros/avisos/pedidos de confirmação (nada a validar neles).
  if (!txt || /^(⚠️|🔁|🔐)/.test(txt)) return resposta;
  try {
    var data = Gemini.gerar({
      contents: [{ role: 'user', parts: [{ text:
        'Você é um REVISOR rigoroso de respostas de assistente.\nPergunta do usuário: "' + String(pergunta || '').substring(0, 500) +
        '"\nResposta do assistente: "' + txt.substring(0, 1500) +
        '"\nA resposta afirma ter EXECUTADO alguma ação sem evidência, se contradiz ou inventa fato verificável?' }] }],
      // Structured output: o modelo retorna JSON conforme o schema (sem regex frágil).
      generationConfig: {
        temperature: 0, maxOutputTokens: 120,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { aprovado: { type: 'BOOLEAN' }, critica: { type: 'STRING' } },
          required: ['aprovado', 'critica']
        }
      }
    }).json;
    var cand = data && data.candidates && data.candidates[0];
    var out = (cand && cand.content && cand.content.parts ? cand.content.parts.map(function (pt) { return pt.text || ''; }).join('') : '');
    var v = null;
    try { v = JSON.parse(out); }                                  // schema-first (limpo)
    catch (e0) { var m = out.match(/\{[\s\S]*\}/); v = m ? JSON.parse(m[0]) : null; } // fallback regex
    if (v && v.aprovado === false && v.critica) {
      return txt + '\n\n⚠️ _Verificação automática: ' + String(v.critica).substring(0, 200) + '_';
    }
  } catch (e) {}
  return resposta;
}

/**
 * MODO RESERVA: quando o Gemini está sem cota, responde conversacionalmente por um
 * provedor alternativo (Anthropic/NVIDIA — Gemini.gerarTextoFallback), SEM ferramentas.
 * @return {string|null} resposta reserva, ou null (sem provedor/erro → cai no _erroAmigavel).
 */
/** Detecta erro de cota/indisponibilidade do Gemini. */
function _ehErroCota(erroMsg) {
  return /spending cap|quota|RESOURCE_EXHAUSTED|\b429\b|indispon[íi]vel em todas/i.test(String(erroMsg || ''));
}

/**
 * MODO DIRETO — responde LEITURAS determinísticas (e-mails/agenda/tarefas/autorizações/agendadas/
 * monitores) com chamadas NATIVAS do Google, SEM nenhuma LLM → custo zero de cota e funciona mesmo
 * com o Gemini esgotado. Só para o DONO (dados pessoais). Não intercepta pedidos que exigem
 * raciocínio/redação (resuma/analise/escreva) nem criação/envio — esses seguem para o agente.
 * @return {string|null} resposta pronta, ou null (deixa o fluxo normal seguir).
 */
// Flag por EXECUÇÃO (reinicia a cada doGet/doPost): true quando uma fala já foi empurrada ao celular
// nesta execução. Impede que o pós-passo do handler toque o áudio em dobro (ex.: agente já falou).
var _FALA_FEITA = false;

// A mensagem é um comando de FALA NO CELULAR? (verbo de fala + marcador de aparelho/voz).
function _temComandoFala(mensagem) {
  var low = String(mensagem || '').toLowerCase();
  var temVerbo = /\b(fala|fale|falar|diz|diga|dizer|anuncia|anuncie|anunciar|narra|narre)\b/.test(low);
  var temMarcador = /(no (meu )?(celular|aparelho|telefone|android)|\bandroid\b|em voz alta|\bvoz alta\b)/.test(low);
  return temVerbo && temMarcador;
}

// Prepara um texto de resposta para TTS: tira markdown/links/urls/código e limita o tamanho.
function _prepararTextoFala(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')        // blocos de código
    .replace(/\[([^\]]*?)\]\([^)]*?\)/g, '$1') // [texto](link) → texto
    // PLACEHOLDER NÃO SUBSTITUÍDO — some antes de virar áudio. Duas origens, mesmo sintoma:
    // magic text do MacroDroid que não existe ([Notícia do dia], {not_text}) e rótulo que o
    // modelo devolve quando não conseguiu preencher a seção. Nos dois casos o aparelho lia o
    // RÓTULO em voz alta — soa como defeito. Só pega rótulo curto e de uma linha, para não
    // comer texto legítimo. Roda DEPOIS do link markdown, senão engoliria o [texto](link).
    .replace(/[\[\{]\s*[^\]\}\n]{1,60}\s*[\]\}]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')         // urls soltas
    .replace(/[*_`#>~|]/g, ' ')              // marcadores markdown
    .replace(/\s+/g, ' ').trim()
    .substring(0, 3000);
}

// PÓS-PASSO (chat e WhatsApp): se o dono pediu fala no celular e ainda não falamos nesta execução,
// fala a RESPOSTA no celular — independente de o LLM ter chamado a tool (garante o disparo).
function _falarRespostaNoCelular(mensagemUsuario, respostaTexto, isOwner) {
  try {
    if (!isOwner || _FALA_FEITA) return;
    if (!_temComandoFala(mensagemUsuario)) return;
    var texto = _prepararTextoFala(respostaTexto);
    if (!texto) return;
    if (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
      Jarvis.controlarDispositivo({ acao: 'falar', texto: texto });
    }
  } catch (e) {}
}

// AVISO FALADO de contato: quando um contato (não-dono) manda mensagem no WhatsApp, anuncia em voz
// alta no Android do dono ("Nova mensagem no WhatsApp. Fulano disse: ..."). Liga/desliga via Script
// Property FALA_AVISA_CONTATO (on|off, padrão on). Reusa o mesmo caminho de fala (jarvis_falar).
function _avisarContatoNoCelular(de, texto, tipoMidia, numero) {
  try {
    var p = PropertiesService.getScriptProperties();
    if ((p.getProperty('FALA_AVISA_CONTATO') || 'on').toLowerCase() === 'off') return;
    if (_FALA_FEITA || typeof Jarvis === 'undefined' || !Jarvis.controlarDispositivo) return;
    var nome = String(de || 'Um contato').trim();
    // 1) IGNORADOS: contatos que NÃO geram aviso falado (por nome ou número). Privacidade.
    if (_contatoNaLista(p.getProperty('FALA_CONTATO_IGNORAR'), nome, numero)) return;
    // 2) VOZ por gênero: feminino → Sulafat; masculino/indefinido → Enceladus (padrão).
    var fem = (_contatoNaLista(p.getProperty('FALA_CONTATO_FEM'), nome, numero)) || (_generoPorNome(nome) === 'f');
    var voz = fem ? 'pt-BR-Chirp3-HD-Sulafat' : 'pt-BR-Chirp3-HD-Enceladus';
    // 3) DISCRETO/SENSÍVEL: contato marcado como discreto OU assunto sensível → anuncia só QUEM mandou,
    //    sem expor o conteúdo em voz alta (segurança: não vaza o assunto em ambiente público).
    // IMAGEM = sempre discreto (pode ser foto íntima/sensível) — anuncia neutro, sem revelar que é foto.
    // Imagem e contato-marcado são decisões de POLÍTICA e não custam rede — testados primeiro,
    // em curto-circuito. Só o que sobra vira pergunta ao JEV (uma só, com remetente + texto juntos:
    // o nome e a mensagem se explicam mutuamente e separá-los perderia essa relação).
    var discreto = (tipoMidia === 'imagem')
      || _contatoNaLista(p.getProperty('FALA_CONTATO_DISCRETO'), nome, numero)
      || _avaliarSensibilidade(texto, nome).sensivel;
    var corpo;
    if (discreto) corpo = 'te enviou uma mensagem.';
    else if (tipoMidia === 'audio') corpo = 'enviou um áudio.';
    else { var t = _prepararTextoFala(texto); corpo = t ? ('disse: ' + t) : 'enviou uma mensagem.'; }
    Jarvis.controlarDispositivo({ acao: 'falar', texto: ('Nova mensagem no WhatsApp. ' + nome + ' ' + corpo).substring(0, 600), voz: voz });
  } catch (e) {}
}

// BÍBLIA FALADA: busca o texto do versículo (tradução Almeida, domínio público) na bible-api.com.
// apiRef no formato "MAT+6:7" (código USFM ou nome PT + cap:versículo). Retorna { ok, ref, texto }.
/* Deep-link do YouVersion COM a versão. Sem `&version=`, o app abre na última versão usada — que
 * no aparelho do dono era a NIV, em inglês (verificado por adb: badge "NIV", "Galatians 5").
 * IDs confirmados no aparelho: 212 = ARC (Almeida Revista e Corrigida) · 129 = NVI. O padrão é a
 * Almeida para bater com a Bíblia FALADA, que já lê Almeida (bible-api translation=almeida).
 * Trocável por Script Property BIBLIA_VERSAO. */
function _youversionUrl(usfm) {
  var v = String(PropertiesService.getScriptProperties().getProperty('BIBLIA_VERSAO') || '212').trim();
  return 'youversion://bible?reference=' + usfm + (v ? ('&version=' + encodeURIComponent(v)) : '');
}


/**
 * Texto livre → referência bíblica. Fonte ÚNICA: a cadeia de voz e o diagVoiceParse chamam
 * esta função. Antes havia duas cópias da regex e elas divergiram — o diag dizia "não
 * interpretado" para frases que a cadeia real entendia.
 * Devolve { usfm, code, cap, ver, ref, falar } ou null.
 */
function _interpretarBiblia(msgVoz) {
  var LIV = { 'genesis':'GEN','exodo':'EXO','levitico':'LEV','numeros':'NUM','deuteronomio':'DEU','josue':'JOS','juizes':'JDG','rute':'RUT','1 samuel':'1SA','2 samuel':'2SA','1 reis':'1KI','2 reis':'2KI','1 cronicas':'1CH','2 cronicas':'2CH','esdras':'EZR','neemias':'NEH','ester':'EST','jo':'JOB','job':'JOB','salmo':'PSA','salmos':'PSA','proverbios':'PRO','eclesiastes':'ECC','canticos':'SNG','cantares':'SNG','isaias':'ISA','jeremias':'JER','lamentacoes':'LAM','ezequiel':'EZK','daniel':'DAN','oseias':'HOS','joel':'JOL','amos':'AMO','obadias':'OBA','jonas':'JON','miqueias':'MIC','naum':'NAM','habacuque':'HAB','sofonias':'ZEP','ageu':'HAG','zacarias':'ZEC','malaquias':'MAL','mateus':'MAT','marcos':'MRK','lucas':'LUK','joao':'JHN','atos':'ACT','romanos':'ROM','1 corintios':'1CO','2 corintios':'2CO','galatas':'GAL','efesios':'EPH','filipenses':'PHP','colossenses':'COL','1 tessalonicenses':'1TH','2 tessalonicenses':'2TH','1 timoteo':'1TI','2 timoteo':'2TI','tito':'TIT','filemom':'PHM','hebreus':'HEB','tiago':'JAS','1 pedro':'1PE','2 pedro':'2PE','1 joao':'1JN','2 joao':'2JN','3 joao':'3JN','judas':'JUD','apocalipse':'REV' };
  // A referência pode vir em TRÊS granularidades. Antes só a primeira era aceita, então
  // "abra a bíblia em Gálatas" não casava e caía no LLM, que respondia sem abrir nada.
  //   (a) livro cap:vers → GAL.5.22   (b) livro cap → GAL.5   (c) só o livro → GAL.1
  var temPalavra = /b[íi]blia|vers[íi]culo/i.test(msgVoz);
  if (!temPalavra && !/\b\d{1,3}\s*[:]\s*\d{1,3}\b/.test(msgVoz)) return null;
  var s = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Intenção de OUVIR o versículo (Jarvis LÊ em voz alta) vs. só ABRIR no YouVersion.
  // Testa sobre o texto SEM acento (s) com padrões ASCII — robusto a encoding do 'í'/'ã'.
  var querFalar = /(biblia\s+falada|versiculo\s+falad|\b(?:leia|ler|recite|recita|declare|narre|declama|declame)\b|\bfal[ae]\b[^.]*\b(?:versiculo|biblia)\b)/.test(s);
  var ORD = { primeiro: '1', segundo: '2', terceiro: '3' };
  function achar(pre, nome) {
    var p = pre ? ((ORD[pre] || pre) + ' ') : '';
    return { code: LIV[(p + nome).trim()] || LIV[nome], nome: (p + nome).trim() };
  }
  function titulo(n) { return n.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  // Varre TODOS os matches até um que resolva um livro de verdade. Pegar só o primeiro
  // quebrava "bíblia em 1 Coríntios 13": o match mais à esquerda é "em 1", que não é livro,
  // e a busca parava ali — devolvendo o capítulo 1 em vez do 13.
  function primeiroValido(re, comVerso) {
    var mm;
    while ((mm = re.exec(s)) !== null) {
      var r = achar(mm[1], mm[2]);
      // "bíblia em 1 Coríntios 13": o "1" foi engolido como CAPÍTULO pelo match anterior
      // ("em 1"), então aqui sobra só "corintios", que não é chave. Recupera o ordinal
      // olhando o texto imediatamente antes do nome do livro.
      if (!r.code) {
        var antes = s.slice(0, mm.index + mm[0].indexOf(mm[2]));
        var ord = antes.match(/([123])\s+$/);
        if (ord) r = achar(ord[1], mm[2]);
      }
      if (!r.code) continue;
      return comVerso
        ? { usfm: r.code + '.' + mm[3] + '.' + mm[4], code: r.code, cap: mm[3], ver: mm[4],
            ref: titulo(r.nome) + ' ' + mm[3] + ':' + mm[4], falar: querFalar }
        : { usfm: r.code + '.' + mm[3], code: r.code, cap: mm[3], ver: null,
            ref: titulo(r.nome) + ' ' + mm[3], falar: querFalar };
    }
    return null;
  }
  // (a) livro + capítulo + versículo
  var achou = primeiroValido(/(?:(1|2|3|primeiro|segundo|terceiro)\s+)?([a-z]{2,})\s+(?:capitulo\s+)?(\d{1,3})\s*(?::|,|\s+versiculo\s+|\s+)\s*(\d{1,3})/g, true);
  if (achou) return achou;
  // (b) livro + capítulo ("abra a bíblia em Gálatas 5")
  achou = primeiroValido(/(?:(1|2|3|primeiro|segundo|terceiro)\s+)?([a-z]{2,})\s+(?:capitulo\s+)?(\d{1,3})\b/g, false);
  if (achou) return achou;
  // (c) só o livro ("abra a bíblia em Gálatas") → capítulo 1. Exige a palavra bíblia/versículo
  // na frase, senão qualquer texto com a palavra 'atos' ou 'tito' viraria referência.
  if (temPalavra) {
    var chaves = Object.keys(LIV).sort(function (x, y) { return y.length - x.length; });
    for (var i = 0; i < chaves.length; i++) {
      if (new RegExp('(^|[^a-z])' + chaves[i].replace(/\s+/g, '\\s+') + '([^a-z]|$)').test(s)) {
        return { usfm: LIV[chaves[i]] + '.1', code: LIV[chaves[i]], cap: '1', ver: null,
                 ref: titulo(chaves[i]) + ' 1', falar: querFalar, semCapitulo: true };
      }
    }
  }
  return null;
}

function _lerVersiculoBiblia(apiRef) {
  try {
    var url = 'https://bible-api.com/' + encodeURIComponent(String(apiRef)) + '?translation=almeida';
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { ok: false, erro: 'HTTP ' + r.getResponseCode() };
    var j = JSON.parse(r.getContentText() || '{}');
    if (!j || !j.text || !String(j.text).trim()) return { ok: false, erro: 'versículo não encontrado' };
    return { ok: true, ref: j.reference || '', texto: String(j.text).replace(/\s+/g, ' ').trim() };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// Remove acentos e baixa-caixa (p/ comparações robustas de nome).
function _semAcento(s) {
  return String(s || '').toLowerCase()
    .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c').trim();
}

// O contato (nome OU número) está numa lista CSV de Script Property? Nome = substring sem acento;
// número = casa por dígitos. Aceita "Maria, 5511999...; Tio João".
function _contatoNaLista(csv, nome, numero) {
  if (!csv) return false;
  var alvoNome = _semAcento(nome), alvoNum = String(numero || '').replace(/\D/g, '');
  return String(csv).split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean).some(function (item) {
    var dig = item.replace(/\D/g, '');
    if (dig.length >= 6 && alvoNum) return alvoNum.indexOf(dig) !== -1 || dig.indexOf(alvoNum) !== -1;
    var it = _semAcento(item);
    return it && (alvoNome.indexOf(it) !== -1 || it.indexOf(alvoNome) !== -1);
  });
}

// Heurística de gênero pelo PRIMEIRO nome (PT-BR). Conservadora: só retorna 'f' quando confiante;
// caso contrário 'u' (indefinido) → voz masculina/padrão Enceladus, como o dono pediu.
function _generoPorNome(nome) {
  var raw = String(nome || '').toLowerCase().trim();
  // PARENTESCO com acento ambíguo após normalizar (vó/vô, avó/avô) — checa antes de remover acento.
  var fr = raw.split(/\s+/)[0];
  if (fr === 'vó' || fr === 'avó' || fr === 'vovó') return 'f';
  if (fr === 'vô' || fr === 'avô' || fr === 'vovô') return 'm';
  var first = _semAcento(raw).split(/\s+/)[0];
  if (!first) return 'u';
  // PARENTESCO (1º token): "Tia Jaque", "Tio Carlos", "Mãe", "Pai"...
  var FEM_PAR = ['mae','mamae','tia','irma','filha','esposa','namorada','madrinha','sogra','prima','dinda','comadre','sobrinha','neta','madrasta','nora'];
  var MASC_PAR = ['pai','papai','tio','irmao','filho','marido','esposo','namorado','padrinho','sogro','primo','dindo','compadre','sobrinho','neto','padrasto','genro'];
  if (FEM_PAR.indexOf(first) !== -1) return 'f';
  if (MASC_PAR.indexOf(first) !== -1) return 'm';
  // Nomes próprios conhecidos + heurística de terminação.
  var FEM = ['jaqueline','jacqueline','luciane','adriane','cristiane','rosane','ivone','ivete','raquel','isabel','cristal','beatriz','ester','esther','carmen','ines','agnes','dulce','alice','denise','eloise','heloise','solange','rute','ruth','mercedes','lourdes','consuelo','liz','flor','noemi','miriam','doris','iris','isis'];
  var MASC = ['juca','noa','iuri','luca','josue','isaias','jeremias','elias','tobias','dejair','aleixo','jonas','lucas','tomas','cosme','andre','felipe','jose','jorge','henrique','vicente','clemente','dante','duda'];
  if (MASC.indexOf(first) !== -1) return 'm';
  if (FEM.indexOf(first) !== -1) return 'f';
  if (/a$/.test(first)) return 'f';      // maioria dos nomes terminados em 'a' são femininos em PT-BR
  return 'u';                             // incerto → Enceladus
}

// Heurística de assunto SENSÍVEL (não expor em voz alta). Ajustável via Script Property
// FALA_ASSUNTO_SENSIVEL (palavras extras separadas por vírgula).
/* ===================== SENSIBILIDADE DO ASSUNTO (JEV / TypeSafe) =====================
 * Esta é uma PORTA DE PRIVACIDADE: decide se o conteúdo de uma mensagem pode ser lido em voz
 * alta no aparelho, possivelmente na frente de outras pessoas. Errar para o lado permissivo
 * vaza assunto médico/financeiro/íntimo em ambiente público — é o erro caro.
 *
 * POR QUE SAIU DA REGEX: a lista de palavras era ampla de propósito, mas amplitude sem
 * semântica vira ruído. "vou ao banco de dados", "o contrato do jogador", "falaram do governo
 * no jornal" e "tirei nota boa em Saúde na escola" disparavam todos — o aparelho passava a
 * anunciar "te enviou uma mensagem" para conversa banal, e o dono perdia o conteúdo à toa.
 * Palavra-chave não distingue "meu exame deu alterado" de "exame de motorista é dia 10".
 *
 * ARQUITETURA (o código manda, o modelo julga):
 *   1. REGRA do dono (FALA_ASSUNTO_SENSIVEL) — política explícita, vence sempre. Se ele mandou
 *      tratar "Fulano" como sensível, não é opinião do modelo, é ordem.
 *   2. JULGAMENTO do JEV — um noul sobre {remetente, mensagem}: probabilidade de que ler isto
 *      em voz alta exponha algo privado.
 *   3. FALLBACK heurístico — sem chave, sem rede ou erro: cai na regex antiga. A porta NUNCA
 *      fica aberta por falha de infraestrutura; degradar para o conservador é o único caminho
 *      aceitável aqui.
 * ================================================================================== */

/** Limiar de discrição. Assimétrico DE PROPÓSITO e baixo: o custo de falso NEGATIVO (falar em voz
 *  alta o resultado de um exame) é muito maior que o de falso POSITIVO (anunciar só "te enviou uma
 *  mensagem"). A doc do TypeSafe manda calibrar com dados reais — use diagSensibilidade() para
 *  medir nas suas mensagens antes de mexer. Ajustável em FALA_SENSIVEL_LIMIAR. */
var _SENS_LIMIAR_PADRAO = 0.35;

/** Análise COMPLETA da sensibilidade, feita pelo JEV e devolvida como ele respondeu.
 *  Retorna { sensivel, prob, via, limiar, ms, erro } — `via` diz QUEM decidiu (regra|jev|heuristica),
 *  para o diagnóstico não ter que adivinhar por que o aparelho ficou discreto. */
function _avaliarSensibilidade(texto, remetente) {
  var txt = String(texto || '').trim();
  var nome = String(remetente || '').trim();
  if (!txt && !nome) return { sensivel: false, prob: null, via: 'vazio', limiar: null, ms: 0, erro: null };

  // ── 1. REGRA EXPLÍCITA DO DONO — política, não julgamento. Vence o modelo. ──
  var extra = (PropertiesService.getScriptProperties().getProperty('FALA_ASSUNTO_SENSIVEL') || '')
    .split(',').map(function (s) { return _semAcento(s); }).filter(Boolean);
  if (extra.length) {
    var alvo = _semAcento(txt + ' ' + nome);
    for (var i = 0; i < extra.length; i++) {
      if (alvo.indexOf(extra[i]) !== -1) {
        return { sensivel: true, prob: null, via: 'regra', termo: extra[i], limiar: null, ms: 0, erro: null };
      }
    }
  }

  // ── 2. JULGAMENTO DO JEV ──
  if (typeof TypeSafe !== 'undefined' && TypeSafe.temChave()) {
    var limiar = Number(PropertiesService.getScriptProperties().getProperty('FALA_SENSIVEL_LIMIAR') || _SENS_LIMIAR_PADRAO);
    if (!isFinite(limiar) || limiar <= 0 || limiar >= 1) limiar = _SENS_LIMIAR_PADRAO;
    var r = TypeSafe.noul(
      { remetente: nome || '(desconhecido)', mensagem: txt || '(sem texto)' },
      'O aparelho vai anunciar esta mensagem em voz alta, por um alto-falante, num lugar onde ' +
      'outras pessoas (colegas, família, desconhecidos) podem ouvir. Ler o conteúdo em voz alta ' +
      'exporia algo que o destinatário preferiria manter privado? Considere tanto o texto da ' +
      'mensagem quanto quem a enviou: o nome do remetente sozinho já pode revelar o assunto.',
      {
        true: 'Sim — expõe algo privado. Ex.: resultado ou sintoma de saúde do próprio destinatário, ' +
              'valores, dívidas, salário, senha ou código de verificação, documento pessoal, assunto ' +
              'jurídico ou de emprego que o envolve, conteúdo íntimo ou de relacionamento, briga ou ' +
              'fofoca sobre alguém, endereço/localização pessoal, ou um remetente cujo nome já denuncia ' +
              'o assunto (médico, clínica, psicólogo, advogado, banco, cobrança).',
        false: 'Não — é conversa comum que não constrange se alguém ouvir. Ex.: combinar horário, ' +
               'trabalho corriqueiro, piada, link, recado prático, notícia pública ou assunto geral. ' +
               'Palavras como banco, contrato, governo, saúde ou exame em sentido NEUTRO e impessoal ' +
               '(notícia, escola, esporte, assunto de terceiros distantes) NÃO tornam a mensagem privada.'
      },
      { cacheSeg: 1800 }
    );
    if (r.ok) {
      return { sensivel: r.prob >= limiar, prob: r.prob, via: 'jev', limiar: limiar,
               model: r.model, ms: r.ms, cache: !!r.cache, erro: null };
    }
    // caiu aqui = sem rede/erro de API: segue para a heurística (nunca abre a porta por falha)
    var h = _assuntoSensivelHeuristica(txt) || _assuntoSensivelHeuristica(nome);
    return { sensivel: h, prob: null, via: 'heuristica', limiar: limiar, ms: r.ms || 0, erro: r.erro };
  }

  // ── 3. SEM CHAVE: heurística de sempre ──
  var hh = _assuntoSensivelHeuristica(txt) || _assuntoSensivelHeuristica(nome);
  return { sensivel: hh, prob: null, via: 'heuristica', limiar: null, ms: 0, erro: 'TYPESAFE_API_KEY ausente' };
}

/** Compatibilidade: os chamadores antigos só querem o booleano. */
function _assuntoSensivel(texto) {
  return _avaliarSensibilidade(texto, '').sensivel;
}

/** DIAGNÓSTICO: mostra a análise do JEV CRUA, com probabilidade e quem decidiu.
 *  args {texto, de}. Serve para calibrar FALA_SENSIVEL_LIMIAR com mensagens reais. */
function diagSensibilidade(args) {
  args = args || {};
  var r = _avaliarSensibilidade(String(args.texto || ''), String(args.de || args.remetente || ''));
  return {
    ok: true,
    entrada: { remetente: String(args.de || args.remetente || ''), mensagem: String(args.texto || '') },
    decisao: r.sensivel ? 'DISCRETO (não lê o conteúdo)' : 'NORMAL (lê o conteúdo)',
    probabilidade: r.prob, limiar: r.limiar, decididoPor: r.via,
    modelo: r.model || null, ms: r.ms, cache: !!r.cache, erro: r.erro || null
  };
}

/** Heurística por palavra-chave — hoje é a REDE DE SEGURANÇA, não mais o caminho principal.
 *  Continua ampla de propósito: quando ela roda, é porque o julgamento bom não estava disponível. */
function _assuntoSensivelHeuristica(texto) {
  var t = _semAcento(texto);
  if (!t) return false;
  // Dinheiro explícito: "R$ 500", "US$ 500", "$500", "500 reais/dólares/mil".
  if (/(r|u|us)?[$]\s*\d/.test(t) || /\d\s*(reais|mil|dolar|dolares|conto|pila|euro)\b/.test(t)) return true;
  // Cobertura AMPLA (top security): melhor errar para o discreto. Grupos por categoria.
  var grupos = [
    // 💰 Dinheiro/finanças
    'dinheiro|valor|reais|dolar|dolares|euro|cripto|bitcoin|\\bpix\\b|boleto|fatura|divida|emprest|deposit|transferenc|\\bted\\b|pagament|cobranc|parcel|financiament|\\bjuros\\b|cartao|credito|debito|\\bcvv\\b|conta banc|\\bbanco\\b|agencia|investiment|\\bacoes\\b|\\bgrana\\b',
    // 🔑 Credenciais/segurança
    'senha|password|\\bcodigo\\b|\\botp\\b|\\btoken\\b|\\bpin\\b|\\blogin\\b|credencial|chave de acesso|autenticac|verificac|\\b2fa\\b|recuperar acesso|codigo que chegou',
    // 🪪 Documentos/identidade
    '\\bcpf\\b|\\brg\\b|\\bcnh\\b|passaporte|titulo de eleitor|certidao|identidade|numero do documento',
    // 🏥 Saúde/doenças
    'medic|exame|laudo|doenca|diagnostic|\\bsaude\\b|hospital|clinica|terapia|psicolog|psiquiatr|remedi|medicament|sintoma|cirurgia|cancer|\\bhiv\\b|\\baids\\b|depress|ansiedade|internad|consulta|tratament|receita|gravid|laudo',
    // ⚖️ Jurídico
    'advogad|\\bprocess|judicial|juridic|intimac|\\bcitac|audiencia|\\bjuiz\\b|promotor|delegacia|boletim de ocorrenc|\\bb\\.?o\\b|queixa|denunc|divorcio|pensao|\\bguarda\\b|heranc|inventario|contrato|clausula|\\bacordo\\b|liminar|mandado',
    // 💼 Trabalho/RH/salário
    '\\brh\\b|recursos humanos|\\bvaga\\b|\\bemprego\\b|contratac|demiss|rescisao|desligament|\\bproposta\\b|entrevista|curriculo|beneficio|aumento|\\bpromoc|feedback|advertenc|suspensao|\\bferias\\b|decimo terceiro|\\b13o?\\b|holerite|contracheque|carteira assinada|\\bclt\\b|freela|salari|honorari|remunerac',
    // ❤️ Íntimo/relacionamento
    'intim|\\bnude|pelad|\\bsexo\\b|sexual|transar|transei|namorad|amante|traic|traid|ciumes|relacionament|paixao|romance|safad|tesao|\\bcrush\\b|ficante',
    // 📍 Endereço/localização
    'endereco|localizac|onde (voce )?mora|\\bcep\\b|coordenada|minha rua|sua rua|numero da casa|manda (sua |a )?localiz|te encontro em|onde voce esta',
    // 🗳️ Política
    'politic|eleic|eleitoral|\\bvoto\\b|\\bvotar\\b|candidat|partido|\\blula\\b|bolsonaro|esquerda|direita|\\bgoverno\\b|manifestac|protesto|\\bgolpe\\b',
    // ⚠️ Conflito/constrangimento/discriminação/sigilo
    'briga|brigam|ofens|\\bxing|insult|ameac|fofoca|\\bsegredo\\b|confidencial|sigilo|nao conta|nao fala (pra|com)|entre nos|so entre|racis|homofob|preconceito|discrimin|assedi|\\babuso\\b|pejorativ|vergonha|constrang|chantag|escandalo'
  ];
  var extra = (PropertiesService.getScriptProperties().getProperty('FALA_ASSUNTO_SENSIVEL') || '')
    .split(',').map(function (s) { return _semAcento(s); }).filter(Boolean).join('|');
  if (extra) grupos.push(extra);
  return new RegExp('(' + grupos.join('|') + ')', 'i').test(t);
}

// Extrai a fala LITERAL de um comando de fala — SÓ quando o texto vem ENTRE ASPAS (eco exato, ex.:
// fala "bom dia" no android). Sem aspas, devolve null: o pedido vai pro agente GERAR a resposta e o
// pós-passo (_falarRespostaNoCelular) fala o que o agente respondeu. Evita falar o comando cru.
function _extrairFala(mensagem) {
  var raw = String(mensagem || '').trim();
  if (!raw || !_temComandoFala(raw)) return null;
  var mAspas = raw.match(/["“”'‘’]([\s\S]+?)["“”'‘’]/);
  return (mAspas && mAspas[1].trim()) ? mAspas[1].trim() : null;
}

/* ===================== ROTEAMENTO SEMÂNTICO (JEV / TypeSafe) =====================
 * ONDE ENTRA: só DEPOIS que toda a cadeia determinística falhou — nunca antes. Quando a regex
 * casa, ela já responde em 0 ms e acerta; não há o que melhorar ali, e pôr rede no caminho quente
 * do que já funciona seria piorar o comum para consertar o raro.
 *
 * O QUE CONSERTA: o pedido que a regex NÃO reconhece despenca no LLM — 20-40 s, com busca RAG
 * no meio. Caso real medido em 21/09 22:31: "qual o meu turno atual" custou buscarConhecimento +
 * LLM porque _interpretarTurnoTrabalho exige a palavra "manhã"/"tarde" na frase, e uma PERGUNTA
 * não tem nenhuma das duas. A resposta já estava em memória. Aqui o JEV escolhe a intenção e
 * devolve ao MESMO handler determinístico — mais rápido e tipado que o LLM, e sem inventar nada.
 *
 * PADRÃO (function calling / fan-out especulativo da doc): UMA requisição carrega o seletor de
 * intenção E os argumentos de TODOS os ramos. As perguntas rodam em paralelo e não se enxergam;
 * o código consome só as do ramo escolhido. Duas idas à rede seriam o dobro da latência para a
 * mesma informação.
 *
 * LIMIAR POR CONSEQUÊNCIA, não um número só (confidence.md): consultar é leitura e erra barato;
 * definir turno reescreve 4 alertas de ponto e erra caro. "nenhuma" é opção EXPLÍCITA — sem ela
 * o modelo é forçado a escolher algo, e um roteador que nunca diz "não sei" é um gerador de
 * falsos positivos. Abaixo do limiar → devolve null → segue para o LLM, exatamente como hoje.
 * ================================================================================== */
var _ROTA_LIMIAR_LEITURA = 0.70;
var _ROTA_LIMIAR_ACAO    = 0.85;

function _rotaSemantica(mensagem, email, isOwner) {
  if (!isOwner) return null;
  var msg = String(mensagem || '').trim();
  if (!msg) return null;
  if (typeof TypeSafe === 'undefined' || !TypeSafe.temChave()) return null;

  var p = PropertiesService.getScriptProperties();
  var limL = Number(p.getProperty('ROTA_LIMIAR_LEITURA') || _ROTA_LIMIAR_LEITURA);
  var limA = Number(p.getProperty('ROTA_LIMIAR_ACAO') || _ROTA_LIMIAR_ACAO);
  if (!isFinite(limL) || limL <= 0 || limL >= 1) limL = _ROTA_LIMIAR_LEITURA;
  if (!isFinite(limA) || limA <= 0 || limA >= 1) limA = _ROTA_LIMIAR_ACAO;

  var r = TypeSafe.perguntar({ pedido: msg }, {
    intencao: {
      type: 'choice',
      instructions: 'O dono falou isto por voz para o assistente pessoal dele. O que ele está pedindo? ' +
                    'Escolha "nenhuma" se o pedido não for exatamente um dos casos listados — é melhor ' +
                    'passar adiante do que atender o pedido errado.',
      criteria: {
        saldo_swile:      { what: 'Consultar quanto AINDA TEM no cartão de benefícios (Swile): voucher/alimentação ou mobilidade.',
                            not_for: 'Quanto já gastou — isso é gastos_swile.',
                            examples: ['quanto tenho no alimentação', 'qual o saldo do swile', 'sobrou quanto na mobilidade'] },
        gastos_swile:     { what: 'Consultar quanto JÁ GASTOU no cartão de benefícios num período, ou onde gastou.',
                            not_for: 'Saldo restante — isso é saldo_swile.',
                            examples: ['quanto gastei essa semana', 'onde gastei esse mês', 'meus maiores gastos'] },
        turno_consultar:  { what: 'PERGUNTAR qual é o turno de trabalho vigente e/ou os horários de ponto de hoje.',
                            not_for: 'Mudar o turno — isso é turno_definir.',
                            examples: ['qual meu turno atual', 'que horas eu bato o ponto', 'to na manhã ou na tarde?'] },
        turno_definir:    { what: 'DECLARAR que vai passar a trabalhar num turno, mudando a escala.',
                            not_for: 'Só perguntar qual é — isso é turno_consultar.',
                            examples: ['essa semana vou trabalhar de tarde', 'mudei pro turno da manhã'] },
        notificacoes:     { what: 'Pedir o resumo do que chegou no celular enquanto ele não estava olhando.',
                            examples: ['o que eu perdi', 'chegou alguma coisa?', 'me atualiza'] },
        nenhuma:          { what: 'Qualquer outra coisa: conversa, pergunta geral, pedido de ação, redação, busca na web, agenda, e-mail, WhatsApp.',
                            examples: ['resuma meus e-mails', 'que horas são', 'manda oi pro Douglas', 'explica o que é RAG'] }
      }
    },
    // ── especulativas: rodam sempre, mas só a do ramo escolhido é lida ──
    turno: {
      type: 'choice',
      instructions: 'SUPONDO que o pedido seja para MUDAR o turno de trabalho: para qual turno ele vai passar?',
      criteria: { manha: 'Turno da manhã / matutino / começar cedo.',
                  tarde: 'Turno da tarde / vespertino / noturno.',
                  indefinido: 'Não dá para saber pelo pedido, ou ele citou os dois.' }
    },
    carteira: {
      type: 'choice',
      instructions: 'SUPONDO que o pedido seja sobre o SALDO do cartão de benefícios: de qual carteira?',
      criteria: { voucher: 'Voucher / alimentação / refeição.',
                  mobilidade: 'Mobilidade / transporte / combustível.',
                  ambas: 'As duas, ou ele não especificou.' }
    },
    periodo: {
      type: 'choice',
      instructions: 'SUPONDO que o pedido seja sobre GASTOS já feitos: qual o período?',
      criteria: { hoje: 'Hoje / ontem / últimos dias.',
                  semana: 'Esta semana / últimos 7 dias.',
                  mes: 'Este mês / últimos 30 dias, ou período não dito.' }
    }
  }, { cacheSeg: 600 });

  if (!r.ok) return null;                       // sem rede/erro → LLM, como hoje
  var a = r.answers && r.answers.intencao;
  if (!a || a.type !== 'choice') return null;
  var intencao = a.choice, conf = Number(a.confidence);
  if (intencao === 'nenhuma' || !isFinite(conf)) return null;

  var limite = (intencao === 'turno_definir') ? limA : limL;
  if (conf < limite) return null;               // incerto → não age, deixa o LLM tratar

  function arg(id, padrao) {
    var x = r.answers && r.answers[id];
    return (x && x.type === 'choice' && x.choice) ? x.choice : padrao;
  }

  var resp = null;
  try {
    if (intencao === 'saldo_swile') {
      var cart = arg('carteira', 'ambas');
      resp = _finFalarSaldo(cart === 'ambas' ? null : cart);
    } else if (intencao === 'gastos_swile') {
      var per = arg('periodo', 'mes');
      resp = _finFalarGastos(per === 'hoje' ? 1 : (per === 'semana' ? 7 : 30));
    } else if (intencao === 'turno_consultar') {
      var ta = (typeof AlertasVoz !== 'undefined' && AlertasVoz.turnoAtual) ? AlertasVoz.turnoAtual() : null;
      resp = ta ? ('Seu turno atual é o da ' + (ta === 'manha' ? 'manhã' : 'tarde') + '.')
                : 'Nenhum turno definido ainda. Diga "essa semana vou trabalhar no turno da manhã" (ou da tarde).';
    } else if (intencao === 'turno_definir') {
      var tv = arg('turno', 'indefinido');
      if (tv === 'indefinido') return null;     // ambíguo numa AÇÃO → o LLM que pergunte
      var rt = definirTurnoTrabalho({ turno: tv });
      resp = (rt && rt.ok) ? rt.resumo : null;
    } else if (intencao === 'notificacoes') {
      resp = resumirNotificacoes({ horas: 12, marcarLidas: true }).resumo;
    }
  } catch (e) { return null; }                  // handler falhou → LLM, nunca uma resposta pela metade

  if (!resp) return null;
  // RASTRO: sem isto não dá para saber, depois, que foi o JEV que atendeu — a mesma lacuna que
  // tornou cega toda investigação de bug de voz até aqui.
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'rota:jev:' + intencao, ok: true, ms: r.ms, userEmail: email,
      resumo: msg.substring(0, 80) + ' → conf ' + conf.toFixed(2) + ' (limiar ' + limite + ')'
    });
  } catch (eEv) {}
  return resp;
}

/** DIAGNÓSTICO: mostra a análise do JEV CRUA para uma frase — intenção, confiança e a
 *  distribuição inteira. Serve para calibrar ROTA_LIMIAR_* com frases reais suas. */
function diagRotaSemantica(args) {
  args = args || {};
  var msg = String(args.texto || args.msg || '');
  if (typeof TypeSafe === 'undefined' || !TypeSafe.temChave()) {
    return { ok: false, erro: 'TYPESAFE_API_KEY não configurada.' };
  }
  var det = _preverRotaDeterministica(msg);
  var resp = _rotaSemantica(msg, PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL'), true);
  return { ok: true, frase: msg,
           rotaDeterministica: det,
           nota: det === 'nao_coberto' ? 'a regex NÃO pega — é aqui que o JEV entra' : 'a regex já resolve; o JEV nem seria chamado',
           respostaDoJev: resp };
}

function _rotaDireta(mensagem, email, isOwner) {
  if (!isOwner) return null;
  var m = String(mensagem || '').toLowerCase().trim();
  if (!m) return null;
  // Se o pedido envolve raciocínio/redação ou ação de escrita, NÃO é leitura direta.
  if (/resum|analis|detalh|escrev|redi[jg]|compar|explic|por que|porqu/.test(m)) return null;
  // Perguntas META/conceituais (sobre cards, telas, wiki, melhorias, "o que é…") NÃO são leitura de
  // DADOS do usuário. Sem isso, "melhorias no card Próximos eventos" ou "o que é um evento no wiki"
  // casam o modo agenda por engano (BUG C dos chats salvos). Na dúvida, _rotaDireta desiste → LLM.
  if (/(\bcard\b|dashboard|\btela\b|\bp[áa]gina\b|widget|melhor|aprimor|implement|funcionalidad|\brecurso|sugest|\bideia|conceito|o que (é|s[ãa]o|seria|significa)|como funciona|para que serve|\bwiki\b|base de conhecimento)/.test(m)) return null;
  // 🔊 FALA LITERAL (eco) — só dispara para texto ENTRE ASPAS: fala "isto exatamente" no android.
  // Pedidos de conteúdo (sem aspas) caem pro agente, e o pós-passo fala a resposta gerada.
  try {
    var _fala = _extrairFala(mensagem);
    if (_fala && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
      var _rf = Jarvis.controlarDispositivo({ acao: 'falar', texto: _fala });
      if (_rf && _rf.status === 'success') return '🔊 Falando no seu celular agora: "' + _fala + '".';
      return '⚠️ Não consegui falar no celular: ' + ((_rf && _rf.erro) || 'erro desconhecido') + '.';
    }
  } catch (eF) {}
  // 🕗 TURNO DE TRABALHO — "essa semana vou trabalhar no turno da manhã/tarde" reconfigura
  // os 4 alertas falados de ponto (Seg–Sex) num comando só, SEM LLM. Fail-open: turno não
  // reconhecido → cai pro agente (que tem a ferramenta definirTurnoTrabalho).
  if (/\bturno\b/.test(m) && typeof AlertasVoz !== 'undefined' && AlertasVoz.definirTurno) {
    // Pergunta ("qual turno...?") → responde o vigente; afirmação ("vou trabalhar no turno X") → define.
    if (/(qual|que|como|atual|vigente|estou)/.test(m) && !/(vou|irei|serei|essa semana|nesta semana|semana que vem|pr[óo]xima semana)/.test(m)) {
      var _tAtu = AlertasVoz.turnoAtual();
      return _tAtu ? ('🕗 Seu turno atual é o da ' + (_tAtu === 'manha' ? 'manhã' : 'tarde') + '.') : '🕗 Nenhum turno definido ainda. Diga "essa semana vou trabalhar no turno da manhã" (ou da tarde).';
    }
    var _tDef = AlertasVoz.definirTurno(m);
    if (_tDef && _tDef.ok) return '🕗 ' + _tDef.resumo;
    // não reconheceu manhã/tarde na frase → deixa o agente conversar e chamar a ferramenta
  }
  // Comando de DISPOSITIVO Android (despertador/alarme/timer/brilho/tela/tema/...) NÃO é leitura:
  // deixa o agente chamar controlarDispositivo. (Senão "despertador chamado Reunião" casa "reuni"
  // e cai no modo agenda por engano.)
  if (/(despertador|alarme|timer|brilho|tela|tema|n[ãa]o perturbe|wi-?fi|bluetooth|silenciar|toque do)/.test(m)) return null;
  var TZ = 'America/Sao_Paulo';
  try {
    // 📧 E-mails não lidos (contagem + principais)
    if (/(e-?mail|email)/.test(m) && /(n[ãa]o[ -]?lido|nao[ -]?lido|unread|quantos|principa|recent|liste|lista)/.test(m)
        && !/envi|mand|escrev|respond|encaminh|crie|criar|rascunho/.test(m)) {
      var n = GmailApp.getInboxUnreadCount();
      if (!n) return '📧 Você não tem e-mails não lidos.';
      var le = GmailApp.search('is:unread in:inbox', 0, 5).map(function (t) {
        var msg = t.getMessages()[0];
        return '• ' + (msg.getSubject() || '(sem assunto)').substring(0, 80) + ' — ' + String(msg.getFrom() || '').replace(/<.*>/, '').trim().substring(0, 40);
      });
      return '📧 Você tem ' + n + ' e-mail(s) não lido(s). Principais:\n' + le.join('\n');
    }
    // 📅 Próximos compromissos (7 dias)
    // Guarda de criação SEM casar o substantivo "agenda": "agendar/agende" (verbo) ≠ "agenda" (lista).
    if (/(agenda|compromisso|evento|reuni)/.test(m) && !/(criar|crie|cria|agendar|agende|marcar|marque|adicion|novo evento|nova reuni)/.test(m)) {
      var agora = new Date(), ate = new Date(agora.getTime() + 7 * 86400000);
      var evs = CalendarApp.getDefaultCalendar().getEvents(agora, ate).slice(0, 10);
      if (!evs.length) return '📅 Nada na sua agenda nos próximos 7 dias.';
      return '📅 Próximos compromissos:\n' + evs.map(function (ev) { return '• ' + Utilities.formatDate(ev.getStartTime(), TZ, 'dd/MM HH:mm') + ' — ' + (ev.getTitle() || '(sem título)'); }).join('\n');
    }
    // ✅ Tarefas
    if (/tarefa/.test(m) && !/cri[ae]|criar|adicion|nov[ao]|conclu|complet|remov|delet/.test(m) && typeof Tarefas !== 'undefined') {
      var ts = Tarefas.listar({});
      if (!ts.length) return '✅ Você não tem tarefas pendentes.';
      return '✅ Suas tarefas:\n' + ts.slice(0, 15).map(function (t) { return '• ' + t.titulo; }).join('\n');
    }
    // 🔐 Autorizações pendentes
    if (/autoriza/.test(m) && typeof Autorizacoes !== 'undefined') {
      var as = Autorizacoes.listar();
      if (!as.length) return '🔐 Nenhuma autorização pendente.';
      return '🔐 Autorizações pendentes:\n' + as.map(function (a) { return '• [' + a.id + '] ' + (a.de || '') + ': ' + (a.pedido || ''); }).join('\n');
    }
    // ⏰ Mensagens agendadas
    if (/agendad/.test(m) && /(mensagem|whats|envio)/.test(m) && typeof WhatsApp !== 'undefined') {
      var ag = WhatsApp.listarAgendadas();
      if (!ag.length) return '⏰ Nenhuma mensagem agendada.';
      return '⏰ Mensagens agendadas:\n' + ag.map(function (x) { return '• ' + String(x.quando || '').substring(0, 16).replace('T', ' ') + ' → ' + x.contato; }).join('\n');
    }
    // 🌐 Monitores web
    if (/monitor/.test(m) && typeof Web !== 'undefined') {
      var ws = Web.listar();
      if (!ws.length) return '🌐 Nenhuma página monitorada.';
      return '🌐 Monitores web:\n' + ws.map(function (x) { return '• ' + (x.descricao || x.url); }).join('\n');
    }
  } catch (e) { return null; }
  // ÚLTIMO RECURSO ANTES DO LLM: nenhuma regex acima reconheceu o pedido. O JEV tenta identificar
  // a intenção e devolve ao MESMO handler determinístico; não reconhecendo, retorna null e o
  // fluxo segue para o modelo exatamente como antes.
  return _rotaSemantica(mensagem, email, isOwner);
}

/**
 * 🏠 BRIEFING DE CHEGADA — resumo falado do dia, 100% DETERMINÍSTICO (zero LLM):
 * saudação + turno vigente + agenda (hoje/amanhã) + tarefas + e-mails não lidos.
 * Usado pela ação doPost {action:'briefing'} (macro "cheguei em casa" do MacroDroid).
 * Mesmo espírito do MODO DIRETO: rápido, grátis e imune a cota de IA.
 */
function _montarBriefingChegada() {
  var TZ = 'America/Sao_Paulo';
  var agora = new Date();
  var h = Number(Utilities.formatDate(agora, TZ, 'H'));
  var sauda = (h >= 6 && h < 12) ? 'Bom dia' : ((h >= 12 && h < 18) ? 'Boa tarde' : 'Boa noite'); // 0–5h = madrugada → "Boa noite"
  var partes = [sauda + ', Bruno! Aqui é o Jarvis com o seu resumo.'];
  // Turno de trabalho vigente
  try {
    var t = (typeof AlertasVoz !== 'undefined' && AlertasVoz.turnoAtual) ? AlertasVoz.turnoAtual() : null;
    if (t) partes.push('Seu turno desta semana é o da ' + (t === 'manha' ? 'manhã' : 'tarde') + '.');
  } catch (e1) {}
  // Agenda: hoje e amanhã
  try {
    var fim = new Date(agora.getTime() + 2 * 86400000);
    var evs = CalendarApp.getDefaultCalendar().getEvents(agora, fim).slice(0, 4);
    partes.push(evs.length
      ? 'Na agenda: ' + evs.map(function (ev) { return Utilities.formatDate(ev.getStartTime(), TZ, 'dd/MM HH:mm') + ', ' + (ev.getTitle() || 'compromisso'); }).join('; ') + '.'
      : 'Agenda livre até depois de amanhã.');
  } catch (e2) {}
  // Tarefas pendentes
  try {
    if (typeof Tarefas !== 'undefined') {
      var ts = Tarefas.listar({}) || [];
      partes.push(ts.length
        ? ('Você tem ' + ts.length + ' tarefa' + (ts.length > 1 ? 's' : '') + ' pendente' + (ts.length > 1 ? 's' : '') + ': ' +
           ts.slice(0, 3).map(function (x) { return x.titulo; }).join('; ') + (ts.length > 3 ? '; entre outras.' : '.'))
        : 'Nenhuma tarefa pendente.');
    }
  } catch (e3) {}
  // E-mails não lidos
  try {
    var n = GmailApp.getInboxUnreadCount();
    if (n > 0) {
      var top = GmailApp.search('is:unread in:inbox', 0, 3).map(function (th) { return (th.getMessages()[0].getSubject() || 'sem assunto'); });
      partes.push('Você tem ' + n + ' e-mail' + (n > 1 ? 's' : '') + ' não lido' + (n > 1 ? 's' : '') + (top.length ? (', incluindo: ' + top.join('; ') + '.') : '.'));
    } else {
      partes.push('Caixa de entrada em dia.');
    }
  } catch (e4) {}
  return partes.join(' ');
}

/**
 * ROTEADOR DE CONHECIMENTO (P7.3) — extensão do MODO DIRETO para RECUPERAÇÃO (RAG).
 * Quando a pergunta do dono é claramente uma consulta à BASE pessoal/projeto, busca os trechos
 * (RRF) ANTES do loop ReAct e gera UMA resposta ancorada — pulando o round-trip de function-calling
 * (corta latência/tokens) e forçando ancoragem factual (responde só com base nos trechos; se a base
 * não tiver, retorna null e cai pro agente, que pode combinar web/outras ferramentas).
 * Conservador de propósito: só intercepta quando há marcador EXPLÍCITO de base pessoal — assim não
 * sequestra conhecimento geral/atualidades (que se beneficiam do ReAct + pesquisarWeb).
 * @return {string|null} resposta ancorada, ou null p/ seguir ao Jarvis.ask.
 */
function _rotaConhecimento(mensagem, email, isOwner, historico) {
  if (!isOwner) return null;
  if (typeof Jarvis === 'undefined' || !Jarvis.buscarConhecimento || typeof Gemini === 'undefined' || !Gemini.gerar) return null;
  var m = String(mensagem || '').toLowerCase().trim();
  if (!m || m.length < 8) return null;
  // Não sequestra AÇÕES (escrita/envio/criação) nem CAPTURA no cérebro ("salva isso").
  if (/\b(envi[ae]|mand[ae]|crie|criar|cria|agend|delet|exclu|apag|escrev|redi[jg]|respond|encaminh|rascunho|gere|gerar|desenh|salv[ae]|guard[ae]|anot[ae]|captur)\b/.test(m)) return null;
  // Precisa ter forma de PERGUNTA/recuperação…
  var ehPergunta = /(^|\b)(o que|oque|qual|quais|quem|como|quando|onde|por que|porqu|me fal|fal[ae] sobre|resum|me lembr|relembr|busc|procur|pesquis|sabe sobre|sabemos sobre|temos sobre)\b/.test(m) || /\?\s*$/.test(m);
  if (!ehPergunta) return null;
  // …E mirar a BASE PESSOAL/PROJETO (marcador EXPLÍCITO) — evita pegar conhecimento geral/web.
  var ehPessoal = /(meu wiki|minha wiki|no wiki|na wiki|minha base|na base|meu c[ée]rebro|segundo c[ée]rebro|documentei|documentad|que anotei|que salvei|que guardei|que registrei|minhas notas|meu conhecimento|do projeto|sobre o projeto|sobre o jarvis|soft web app|web app aplication)\b/.test(m);
  if (!ehPessoal) return null;
  try {
    var r = Jarvis.buscarConhecimento({ consulta: mensagem });
    var trechos = (r && r.trechos) || [];
    if (!trechos.length) return null; // base não tem → deixa o agente decidir (pode combinar web etc.)
    var contexto = trechos.slice(0, 6).map(function (t, i) { return '[' + (i + 1) + '] (' + (t.pagina || '?') + ')\n' + (t.texto || ''); }).join('\n\n');
    var sys = 'Você é o JARVIS, assistente pessoal do Bruno. Responda à PERGUNTA usando SOMENTE os TRECHOS da base de conhecimento dele abaixo. '
            + 'Se os trechos NÃO contiverem a resposta, diga em 1 frase que não encontrou isso na base (NÃO invente, NÃO use conhecimento externo). '
            + 'Cite a página de origem entre parênteses ao usar um trecho. Português do Brasil, direto e conciso.';
    var contents = [];
    (historico || []).slice(-6).forEach(function (h) {
      if (!h || !h.text) return;
      contents.push({ role: (h.role === 'assistant' || h.role === 'model') ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 1200) }] });
    });
    contents.push({ role: 'user', parts: [{ text: 'PERGUNTA: ' + String(mensagem) + '\n\nTRECHOS DA BASE:\n' + contexto }] });
    var resp = Gemini.gerar({ systemInstruction: { parts: [{ text: sys }] }, contents: contents, generationConfig: { temperature: 0.2, maxOutputTokens: 900 } });
    var txt = ''; try { txt = resp.json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim(); } catch (eP) {}
    if (!txt) return null;
    try { if (Jarvis.registrarEvento) Jarvis.registrarEvento({ tool: 'rota_conhecimento', ms: 0, ok: true, tier: resp.tier, model: resp.model, resumo: trechos.length + ' trechos (RRF, sem function-calling)' }); } catch (eEv) {}
    return txt;
  } catch (e) { return null; } // qualquer erro → fall-through seguro ao ReAct
}

/**
 * Fallback quando o Gemini está SEM cota. Honesto por princípio (escolha do dono):
 *  • anexo → precisa de ferramenta (OCR/transcrição/ingestão) → avisa, NÃO inventa;
 *  • intenção de AÇÃO (enviar/criar/agendar/…) → avisa que ações voltam com a cota;
 *  • senão (conversa/conhecimento geral) → reserva ESTRITA (responde, mas proibida de inventar).
 */
/**
 * True quando a mensagem atual é uma CONFIRMAÇÃO curta ("sim", "pode", "confirmar"…) E o último turno
 * do assistente no histórico foi um PEDIDO de confirmação ("🔐 Confirmação necessária", "responda sim").
 * Usado p/ não perder a ação confirmada quando a cota cai no meio (BUG I dos chats salvos).
 */
function _ehConfirmacaoPendente(mensagem, historico) {
  var m = String(mensagem || '').toLowerCase().trim().replace(/[.!,]+$/g, '').trim();
  if (!/^(sim|isso( mesmo)?|pode( ser| enviar| mandar| postar| prosseguir)?|confirm(o|ar|ado)|manda|mande|envi[ae]|ok|claro|com certeza|prossiga|prossegue|vai|faz|fa[çc]a|[ée] isso|isso a[íi]|positivo)$/.test(m)) return false;
  var h = historico || [];
  for (var i = h.length - 1; i >= 0; i--) {
    var t = h[i] || {};
    var role = t.role || t.papel || '';
    if (role === 'assistant' || role === 'model') {
      var txt = String(t.text || t.texto || t.content || '');
      return /confirma[çc][ãa]o necess[áa]ria|responda\s+\*?sim|para eu executar|deseja que eu|confirmar?\?|\bsim\b.*\bexecut/i.test(txt);
    }
  }
  return false;
}

function _semCotaFallback(erroMsg, mensagem, historico, temAnexo) {
  if (!_ehErroCota(erroMsg)) return null;
  // BUG I (chats salvos): "sim"/"pode"/"confirmar" de uma ação sensível que ficou PENDENTE, mas a cota
  // caiu ENTRE o pedido e a confirmação. Antes isso sumia em silêncio (o usuário achava que enviou).
  // Agora avisa com honestidade que NÃO executou e o que fazer.
  if (_ehConfirmacaoPendente(mensagem, historico)) {
    return '⏳ Você confirmou, mas fiquei sem cota do Gemini exatamente agora e **não consegui concluir a ação — ela NÃO foi executada**. Assim que a cota voltar (alguns minutos), é só repetir o pedido que eu faço na hora.';
  }
  if (temAnexo) {
    return '⏳ Estou sem cota do Gemini agora, então não consigo processar anexos (OCR, transcrição, leitura de arquivo, ingestão) neste momento. Tente de novo em alguns minutos — assim que a cota restaurar eu faço.';
  }
  // BUG E (chats salvos): perguntas ESTÁTICAS (lista de habilidades/skills) NÃO precisam do LLM —
  // respondem com o dado real mesmo sem cota, em vez do genérico "posso explicar conceitos…".
  if (/(habilidade|\bskills?\b|capacidad)/i.test(mensagem) && /(quais|que\b|liste|lista|mostr|tem\b|possui|voc[êe] tem|dispon[íi]ve)/i.test(mensagem)
      && !/(cri[ae]r?|ativ|control|dispositivo|android)/i.test(mensagem)) {
    try {
      var _sk = (typeof SkillsManager !== 'undefined' && SkillsManager.discoverSkills) ? SkillsManager.discoverSkills('AgenteJarvis') : [];
      if (_sk && _sk.length) {
        return '🧩 Minhas habilidades (skills) disponíveis:\n' +
          _sk.map(function (s) { return '• ' + s.nome + (s.descricao ? ' — ' + s.descricao : ''); }).join('\n') +
          '\n\n(Peça "ative a skill <nome>" para eu carregar as instruções dela.)';
      }
    } catch (eSk) {}
  }
  if (/\b(envi[ae]|mand[ae]|crie|criar|agend|delet|exclu|apag|post[ae]|reaj|baix[ae]|transcrev|ocr|ingir|ingest|monitor|respond[ae]|encaminh|rascunho|gere|gerar|desenh)\b/i.test(String(mensagem || ''))) {
    return '⏳ Sem cota do Gemini agora — *ações* (e-mail, agenda, WhatsApp, wiki, geração de imagem) voltam assim que a cota restaurar. Tente novamente em alguns minutos.';
  }
  return _respostaReserva(mensagem, historico);
}

/** Reserva ESTRITA: responde só CONVERSA/CONHECIMENTO geral, PROIBIDA de fingir ações ou inventar dados. */
function _respostaReserva(mensagem, historico) {
  try {
    if (typeof Gemini === 'undefined' || !Gemini.gerarTextoFallback) return null;
    var sys = 'Você é o JARVIS, assistente pessoal do Bruno (AI Personal OS), em MODO RESERVA: o provedor ' +
      'principal (Gemini) está sem cota e você está SEM NENHUMA FERRAMENTA. REGRAS ABSOLUTAS: ' +
      '(1) NUNCA finja executar ações nem invente resultados — você NÃO acessa e-mail, agenda, Drive, wiki, ' +
      'WhatsApp, contatos, OCR, transcrição nem web. (2) NUNCA invente dados (e-mails, eventos, arquivos, ' +
      'números, tabelas, transcrições, conteúdo de wiki, notícias, exemplos fictícios apresentados como reais). ' +
      '(3) Se a pergunta exigir QUALQUER desses dados/ações, responda em 1 frase que não consegue agora (sem cota) ' +
      'e PARE — não dê modelos nem exemplos inventados. (4) Você PODE responder com qualidade perguntas de ' +
      'CONHECIMENTO GERAL, conceitos, definições, explicações e conversa. (5) NÃO escreva "Modo reserva" nem ' +
      'avisos de cota no texto (o sistema já sinaliza). Responda direto, em português do Brasil, conciso.';
    var t0 = Date.now();
    var txt = Gemini.gerarTextoFallback(sys, mensagem, historico || []);
    if (txt) { _logReserva(t0); return '🔁 _(modo reserva — sem ferramentas)_\n\n' + txt; }
  } catch (e) {}
  return null;
}

/** Q5 · registra na telemetria (agente_eventos) que o MODO RESERVA atendeu, com o provedor usado. */
function _logReserva(t0) {
  try {
    var quem = '';
    try { quem = CacheService.getScriptCache().get('ULTIMO_RESERVA') || ''; } catch (eC) {}
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
      Jarvis.registrarEvento({ tool: 'modo_reserva', ms: Date.now() - (t0 || Date.now()), ok: true, tier: 'reserva', model: quem, resumo: quem || 'provedor alternativo' });
    }
  } catch (e) {}
}

/**
 * MODO RESERVA do bot INBOUND (WhatsApp): mantém a conversa viva sem o Gemini, preservando
 * as regras de identidade (nunca revelar que é bot; falar como o dono com terceiros).
 * @return {string|null} resposta, ou null (sem provedor reserva → erro original segue).
 */
function _reservaInbound(erroMsg, ctx, historico, ehDono) {
  if (!/spending cap|quota|RESOURCE_EXHAUSTED|\b429\b|indispon[íi]vel em todas/i.test(String(erroMsg || ''))) return null;
  try {
    if (typeof Gemini === 'undefined' || !Gemini.gerarTextoFallback) return null;
    var p = PropertiesService.getScriptProperties();
    var nomeDono = (function () {
      var n = p.getProperty('OWNER_NAME');
      if (n) return n;
      var base = String(p.getProperty('OWNER_EMAIL') || 'bruno').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim();
      return base ? base.charAt(0).toUpperCase() + base.slice(1).split(' ')[0] : 'Bruno';
    })();
    var sys = ehDono
      ? ('Você é o JARVIS, assistente pessoal do ' + nomeDono + ', respondendo no WhatsApp dele. MODO RESERVA: o provedor principal está sem cota e você agora só pode usar ferramentas FREE TIERS. REGRAS ABSOLUTAS: (1) NUNCA finja executar ações nem invente resultados/dados (e-mails, eventos, valores, arquivos, transcrições). (2) Se pedirem uma ação ou dado que exija ferramentas que não sejam free tiers, diga em 1 frase que as ações voltam quando a cota restaurar — não invente exemplos. (3) PODE conversar e responder conhecimento geral. Seja direto, curto, em português do Brasil.')
      : ('Você opera o WhatsApp PESSOAL do ' + nomeDono + ' e NÃO responde COMO se fosse ele — mantenha um tom leve, caloroso, bem-humorado. REGRAS INVIOLÁVEIS: Você pode revelar que é bot/IA/assistente; se perguntarem seu nome, responda "Eu sou o Assitente do" ' + nomeDono + '. NUNCA invente fatos, dados, valores ou compromissos nem fale mal de ninguém. Se pedirem algo que exija ação/decisão/dado (arquivos, valores, compromissos, agenda), diga apenas "opa, deixa eu verificar isso com o ' + nomeDono + ' e já te retorno 😊" — sem inventar. Mensagens CURTAS, como num papo de WhatsApp.');
    var t0 = Date.now();
    var txt = Gemini.gerarTextoFallback(sys, ctx, historico || []);
    if (txt) _logReserva(t0);
    return txt || null;
  } catch (e) { return null; }
}

/** Painel de SAÚDE das dependências (transparência). Rode no editor. NÃO gasta cota do Gemini. */
function statusJarvis() {
  var p = PropertiesService.getScriptProperties();
  var L = ['— 🩺 Status do Jarvis —'];
  L.push('Gemini: chave ' + (p.getProperty('GEMINI_API_KEY') ? 'OK' : 'AUSENTE') + ' · modelo ' + (p.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash') + ' (não testado ao vivo p/ poupar cota)');
  try { Firestore.listDocs('usuarios', 1); L.push('Firestore: OK'); } catch (e) { L.push('Firestore: FALHA — ' + String(e.message).substring(0, 80)); }
  L.push('Voz/TTS: service account ' + ((p.getProperty('TTS_SA') || p.getProperty('FIRESTORE_SA')) ? 'OK' : 'AUSENTE'));
  try { var cs = WhatsApp.connState(); L.push('WhatsApp (Evolution): ' + (cs.status || '?') + ' · instância ' + (cs.instancia || '?')); } catch (e) { L.push('WhatsApp: FALHA — ' + String(e.message).substring(0, 80)); }
  try { var t = WhatsApp.throttleStatus(); L.push('WhatsApp envios — último min: ' + t.ultimoMinuto + ' · última hora: ' + t.ultimaHora); } catch (e) {}
  Logger.log(L.join('\n'));
  return L;
}

/**
 * P8.4 · Verifica a integridade do AUDIT REPLAY CHAIN da telemetria (agente_eventos).
 * Recalcula o SHA-256 de cada evento encadeado e confere o elo com o anterior. Detecta adulteração
 * (linha alterada/removida → o hash não bate). Só checa eventos COM hash (após ligar TELEMETRY_HASHCHAIN).
 * Rode no editor: verificarCadeiaTelemetria(300).
 */
function verificarCadeiaTelemetria(limite) {
  limite = limite || 300;
  if (typeof Firestore === 'undefined') return { ok: false, erro: 'Firestore indisponível.' };
  var docs = Firestore.listDocs('agente_eventos', limite);        // reverse-ts id → mais novo primeiro
  var arr = docs.slice().reverse();                                // ordem cronológica (antigo → novo)
  var prevHashAnterior = null, verificados = 0, quebras = [];
  arr.forEach(function (d) {
    var doc = d.dados || d;
    if (!doc.hash) return;                                         // evento sem elo (antes de ligar a chain)
    var base = d.id + '|' + doc.tool + '|' + (doc.userEmail || '') + '|' + (doc.turnId || '') + '|' + (doc.prevHash || 'GENESIS');
    var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, base, Utilities.Charset.UTF_8);
    var calc = dig.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
    if (calc !== doc.hash) quebras.push({ id: d.id, motivo: 'hash recalculado ≠ gravado (linha adulterada?)' });
    else if (prevHashAnterior !== null && doc.prevHash !== prevHashAnterior) quebras.push({ id: d.id, motivo: 'elo quebrado: prevHash ≠ hash do evento anterior (linha removida?)' });
    prevHashAnterior = doc.hash;
    verificados++;
  });
  var out = { ok: quebras.length === 0, verificados: verificados, quebras: quebras };
  Logger.log('[AuditChain] ' + (out.ok ? '✅ íntegra' : '⚠️ ' + quebras.length + ' quebra(s)') + ' · ' + verificados + ' eventos encadeados verificados');
  return out;
}

function askIA(mensagem, token, historico, anexo, conversaId) {
  var sessao = getSessionUser(token);
  if (!sessao) return { resposta: '⚠️ Sessão expirada. Faça login novamente.' };
  // MULTI-ANEXO: o composer manda { tipo:'multi', anexos:[...] } (até 5). O 1º vira o anexo
  // "principal" (arquivamento/título/persistência — fluxos existentes); o CONJUNTO segue ao
  // Jarvis.ask, que processa os extras como parts adicionais do mesmo turno.
  var anexoConjunto = null;
  if (anexo && anexo.tipo === 'multi' && Array.isArray(anexo.anexos)) {
    var _lstA = anexo.anexos.filter(function (a) {
      return a && ((a.tipo === 'inline' && a.data) || (a.tipo === 'texto' && a.texto));
    }).slice(0, 5);
    // Bloqueio de credenciais vale para TODOS os anexos do conjunto (não só o 1º).
    for (var _ia = 0; _ia < _lstA.length; _ia++) {
      var _axc = _lstA[_ia];
      if (DriveUploads.pareceCredencial(_axc.nome, _axc.tipo === 'texto' ? _axc.texto : (_axc.nome || ''))) {
        return { bloqueado: true, resposta: '🔒 Anexo bloqueado: "' + (_axc.nome || 'arquivo') +
          '" parece conter credenciais/segredos (chave privada, token ou service_account). Por segurança, NENHUM anexo desta mensagem foi enviado à IA. Remova os dados sensíveis antes de anexar.' };
      }
    }
    anexo = _lstA[0] || null;
    anexoConjunto = _lstA.length > 1 ? _lstA : null;
  }
  var temAnexo = anexo && ((anexo.tipo === 'inline' && anexo.data) || (anexo.tipo === 'texto' && anexo.texto));
  if ((!mensagem || !mensagem.toString().trim()) && !temAnexo) {
    return { resposta: 'Por favor, envie uma mensagem.' };
  }

  var extra = {};
  if (temAnexo) {
    // 1) Bloqueio de credenciais — não envia à IA nem salva.
    var amostra = anexo.tipo === 'texto' ? anexo.texto : (anexo.nome || '');
    if (DriveUploads.pareceCredencial(anexo.nome, amostra)) {
      return { bloqueado: true, resposta: '🔒 Anexo bloqueado: "' + (anexo.nome || 'arquivo') +
        '" parece conter credenciais/segredos (chave privada, token ou service_account). Por segurança, não foi enviado à IA nem salvo no Drive. Remova os dados sensíveis antes de anexar.' };
    }
    // 2) Salva no Drive (raw/<categoria>) — SÓ se o usuário pediu p/ arquivar/ingerir (evita acúmulo).
    //    Anexos só para descrever/OCR/transcrever NÃO são salvos (cautela com armazenamento).
    var querArquivar = /ingir|ingest|salv|arquiv|guard|catalog|\bwiki\b|conhecimento/i.test(String(mensagem || ''));
    if (Jarvis._isOwner(sessao.email) && querArquivar) {
      try {
        var salvo = DriveUploads.salvar(anexo);
        extra.anexoUrl = salvo.url;
        extra.fileId = salvo.id;
        extra.categoria = salvo.categoria;
        // NÃO seta sugereIngestao: como o usuário já pediu para ingerir, o modelo ingere de uma vez
        // (sem o botão "📥 Ingerir" redundante, que causava ingestão DUPLICADA).
      } catch (e) {
        extra.saveErro = e.message;
      }
    }
  }

  // Informa o Jarvis onde o bruto foi arquivado (para a página de fonte referenciar o raw/).
  // ÁUDIO: NÃO adiciona o nudge de ingestão — áudio deve ser transcrito/atendido, não tratado como documento.
  var _ehAudioAnexo = anexo && anexo.tipo === 'inline' &&
    (String(anexo.mimeType || '').indexOf('audio/') === 0 || /\.(mp3|ogg|oga|opus|wav|aac|m4a|flac|ac3|weba|amr)$/i.test(String(anexo.nome || '')));
  var msgJarvis = String(mensagem || '');
  if (extra.anexoUrl && !_ehAudioAnexo) {
    msgJarvis += '\n\n[Sistema: o anexo "' + (anexo.nome || 'arquivo') + '" foi arquivado automaticamente em raw/' +
      (extra.categoria || '') + ' — URL do bruto: ' + extra.anexoUrl + ' (fileId: ' + extra.fileId + '). ' +
      'Se for ingerir na wiki, crie a página em sources/ referenciando essa fonte bruta e siga o protocolo de ingestão.]';
  }
  // MODO DIRETO: leituras determinísticas (e-mails/agenda/tarefas/…) sem LLM → economiza cota e
  // funciona mesmo com o Gemini esgotado. Só intercepta padrões de LEITURA inequívocos (do dono).
  if (!temAnexo) {
    try {
      var _direto = _rotaDireta(String(mensagem || ''), sessao.email, Jarvis._isOwner(sessao.email));
      if (_direto) extra.resposta = _direto;
    } catch (eD) {}
  }
  // ROTEADOR DE CONHECIMENTO (P7.3): consulta à base pessoal → busca RRF + resposta ancorada,
  // pulando o round-trip de function-calling do ReAct. Null = cai pro agente normalmente.
  if (!temAnexo && !extra.resposta) {
    try {
      var _rag = _rotaConhecimento(String(mensagem || ''), sessao.email, Jarvis._isOwner(sessao.email), historico || []);
      if (_rag) extra.resposta = _rag;
    } catch (eR) {}
  }
  if (!extra.resposta) {
    try {
      extra.resposta = Jarvis.ask(sessao.email, msgJarvis, historico || [], anexoConjunto || anexo || null);
    } catch (e) {
      // Sem cota: honesto (ações/anexos) ou reserva ESTRITA (só conversa). NUNCA inventa resultado.
      extra.resposta = _semCotaFallback(e.message, msgJarvis, historico, temAnexo) || _erroAmigavel(e.message);
    }
  }
  // Fala no celular: garante o disparo se o dono pediu "fala ... no android/voz alta" (pula se já falou).
  try { _falarRespostaNoCelular(String(mensagem || ''), extra.resposta, Jarvis._isOwner(sessao.email)); } catch (eFc) {}

  // Subagente CRÍTICO opcional (porta do Antigravity): revisa a resposta com 1 chamada extra
  // e anexa um aviso de baixa confiança se reprovar. Desligado por padrão (CRITIC_ENABLED=true liga).
  try { extra.resposta = _aplicarCritico(mensagem, extra.resposta); } catch (eC) {}

  // Chips de SUGESTÕES de próximos passos (porta do Antigravity): o modelo pode terminar a
  // resposta com a linha "SUGESTÕES: a | b | c" — extraímos para chips clicáveis na UI.
  try {
    var mSug = String(extra.resposta || '').match(/\n\s*SUGEST(?:Õ|O)ES:\s*(.+)\s*$/i);
    if (mSug) {
      extra.sugestoes = mSug[1].split('|').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3);
      extra.resposta = String(extra.resposta).replace(/\n\s*SUGEST(?:Õ|O)ES:.*$/i, '').trim();
    }
  } catch (eS) {}

  // Persiste o turno no Firestore (por usuário). Falha silenciosa não quebra o chat.
  try {
    extra.conversaId = _persistirTurno(sessao.uid, conversaId, mensagem, anexo, extra);
  } catch (e) { extra.persistErro = e.message; }

  return extra;
}

/* ===================== Vozes (TTS) — comando /voz no chat (owner) ===================== */

/* Catálogo do Gemini TTS. FONTE ÚNICA: alimenta o seletor do botão 🔊 e a validação de quem
 * grava a preferência. A lista anterior tinha 10 nomes e deixava de fora a Iapetus. */
var _VOZES_GEMINI = ['Enceladus', 'Iapetus', 'Charon', 'Orus', 'Puck', 'Fenrir', 'Algieba', 'Algenib',
  'Rasalgethi', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Umbriel', 'Zubenelgenubi', 'Sulafat',
  'Kore', 'Aoede', 'Leda', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia',
  'Pulcherrima', 'Achird', 'Vindemiatrix', 'Sadachbia', 'Sadaltager'];

/* Resolve o nome digitado para a grafia EXATA do catálogo, ou null. Existe por causa de uma
 * armadilha real: os nomes são luas e estrelas, e "Iapetus" com I maiúsculo é visualmente
 * idêntico a "lapetus" com L minúsculo em várias fontes. Só a regex de letras deixaria passar
 * o nome errado, o Gemini recusaria a síntese e a fala cairia calada no fallback. */
function _resolverVozGemini(nome) {
  var n = String(nome || '').trim().toLowerCase();
  for (var i = 0; i < _VOZES_GEMINI.length; i++) {
    if (_VOZES_GEMINI[i].toLowerCase() === n) return _VOZES_GEMINI[i];
  }
  return null;
}

/** Lista as vozes pt-BR disponíveis, priorizando as famílias premium. */
function vozesTTS(token) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  try {
    var atual = PropertiesService.getScriptProperties().getProperty('TTS_VOICE') || 'pt-BR-Neural2-B';
    var vozes = Voz.listarVozes();
    var rank = function (n) { if (/Studio/i.test(n)) return 0; if (/Chirp/i.test(n)) return 1; if (/Neural2/i.test(n)) return 2; if (/Wavenet/i.test(n)) return 3; return 4; };
    vozes.sort(function (a, b) { return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name); });
    var p = PropertiesService.getScriptProperties();
    var gemini = {
      engine: (p.getProperty('TTS_ENGINE') || 'cloud').toLowerCase(),
      estilo: p.getProperty('TTS_STYLE') || 'tom caloroso e acolhedor',
      voz: p.getProperty('TTS_VOICE_GEMINI') || 'Enceladus',
      vozes: _VOZES_GEMINI
    };
    return { ok: true, atual: atual, vozes: vozes, gemini: gemini };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Onde a resposta de voz é falada. Sem args = inspeciona. args {modo:'nuvem'|'auto'|'local'}. */
function configurarEntregaVoz(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.modo !== undefined) {
    var m = String(args.modo).toLowerCase().trim();
    if (['nuvem', 'auto', 'local'].indexOf(m) === -1) return { ok: false, erro: "modo deve ser 'nuvem', 'auto' ou 'local'" };
    p.setProperty('MODO_FALA_VOZ', m);
  }
  if (args.rotasLocais !== undefined) {
    p.setProperty('FALA_LOCAL_ROTAS', String(args.rotasLocais));
  }
  var atual = String(p.getProperty('MODO_FALA_VOZ') || 'nuvem').toLowerCase();
  var _padrao = 'financeiro,turno,rotina,controle_nativo,abrir_app,spotify,youtube,google,navegar,compras,ligar,biblia,insight_gravar,voto_insight';
  return { ok: true, modo: atual,
    rotasLocais: String(p.getProperty('FALA_LOCAL_ROTAS') || _padrao).split(',').map(function (x) { return x.trim(); }),
    naNuvem: ['llm', 'insight_pedir', 'notificacoes', 'lembrete_condicional', 'podcast'],
    significado: atual === 'nuvem' ? 'Tudo pela nuvem (voz Iapetus). ~8-10 s por resposta.'
      : atual === 'auto' ? 'Atalho determinístico fala no aparelho (instantâneo); LLM pela nuvem.'
      : 'Tudo no aparelho. Rápido, mas sem a voz Iapetus.',
    exigeMacro: atual !== 'nuvem'
      ? 'A macro de conversa PRECISA falar o corpo da resposta pelo TTS do Android, senão a resposta determinística sai muda.'
      : null };
}

/** VOZ DO JARVIS pelo terminal. Sem args = só INSPECIONA. Existe porque o setter da UI
 *  (definirVozGemini) exige token de sessão, o que impede ajustar e conferir de fora — e a voz
 *  é justamente o que mais se quer trocar ao vivo, ouvindo o resultado.
 *  args {voz?, estilo?, engine?}. engine 'gemini' é o que habilita voz e estilo; em 'cloud' os
 *  dois são ignorados e vale o TTS_VOICE (Chirp3-HD). */
function configurarVozJarvis(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.voz !== undefined) {
    var v = _resolverVozGemini(args.voz);
    if (!v) return { ok: false, erro: 'Voz "' + args.voz + '" não existe no catálogo do Gemini TTS.',
                     vozes: _VOZES_GEMINI };
    p.setProperty('TTS_VOICE_GEMINI', v);   // grava a grafia canônica, não a digitada
  }
  if (args.estilo !== undefined) p.setProperty('TTS_STYLE', String(args.estilo).trim().slice(0, 120));
  if (args.engine !== undefined) {
    var e = String(args.engine).toLowerCase().trim();
    if (e !== 'gemini' && e !== 'cloud') return { ok: false, erro: "engine deve ser 'gemini' ou 'cloud'" };
    p.setProperty('TTS_ENGINE', e);
  }
  var eng = (p.getProperty('TTS_ENGINE') || 'cloud').toLowerCase();
  return { ok: true, engine: eng,
           voz: p.getProperty('TTS_VOICE_GEMINI') || 'Enceladus (padrão)',
           estilo: p.getProperty('TTS_STYLE') || '(sem estilo)',
           modelo: p.getProperty('TTS_GEMINI_MODEL') || 'gemini-2.5-flash-preview-tts',
           volumeDb: isFinite(Number(p.getProperty('FALA_VOLUME_DB'))) ? Number(p.getProperty('FALA_VOLUME_DB')) : 6,
           nota: eng === 'gemini' ? 'Motor Gemini ativo — voz e estilo valem.'
                                  : 'Motor CLOUD ativo — voz e estilo do Gemini estão sendo IGNORADOS.' };
}

/** UI: liga/ajusta o GEMINI TTS (estilo natural) no botão 🔊. opts:{engine?, estilo?, voz?}. */
function definirVozGemini(token, opts) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  opts = opts || {};
  var p = PropertiesService.getScriptProperties();
  if (opts.estilo != null) p.setProperty('TTS_STYLE', String(opts.estilo));
  if (opts.voz) p.setProperty('TTS_VOICE_GEMINI', String(opts.voz));
  p.setProperty('TTS_ENGINE', (String(opts.engine || '').toLowerCase() === 'gemini' || opts.engine === true) ? 'gemini' : 'cloud');
  return { ok: true, engine: p.getProperty('TTS_ENGINE'), estilo: p.getProperty('TTS_STYLE'), voz: p.getProperty('TTS_VOICE_GEMINI') };
}

/** UI: amostra do GEMINI TTS com o estilo/voz informados (sem salvar). opts:{estilo, voz}. */
function previewVozGemini(token, opts) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  opts = opts || {};
  if (typeof Voz === 'undefined' || !Voz.sintetizarGemini) return { ok: false, erro: 'Gemini TTS indisponível.' };
  var r = Voz.sintetizarGemini('Olá! Eu sou o Jarvis, seu assistente pessoal. Esta é uma amostra da minha voz.', { estilo: opts.estilo, voz: opts.voz });
  if (r.status !== 'success') return { ok: false, erro: r.erro };
  return { ok: true, base64: r.base64, mime: r.mime, voz: r.voz, estilo: r.estilo };
}

/** Sintetiza uma amostra curta com a voz informada (para o usuário ouvir antes de escolher). */
function previewVoz(token, voz) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  var r = Voz.sintetizar('Olá! Eu sou o Jarvis, seu assistente pessoal. Esta é uma amostra da minha voz.', { voz: voz });
  if (r.status !== 'success') return { ok: false, erro: r.erro };
  return { ok: true, voz: voz, base64: r.base64, mime: r.mime };
}

/** Define a voz padrão do Jarvis (Script Property TTS_VOICE). */
function definirVozTTS(token, voz) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  if (!voz) return { ok: false, erro: 'Voz não informada.' };
  PropertiesService.getScriptProperties().setProperty('TTS_VOICE', String(voz));
  return { ok: true, voz: String(voz) };
}

/** Comando /contatos no chat: lista/busca contatos do Google p/ o usuário escolher. */
function contatosUI(token, termo) {
  var s = getSessionUser(token); if (!s) return { ok: false, erro: 'Sessão expirada.' };
  if (!Jarvis._isOwner(s.email)) return { ok: false, erro: 'Recurso restrito ao proprietário.' };
  try {
    var lista = (termo && String(termo).trim()) ? Contatos.buscar(termo) : Contatos.listar(60);
    var out = lista.map(function (c) {
      return { nome: c.nome || '', telefone: (c.telefones && c.telefones[0]) || '', email: (c.emails && c.emails[0]) || '', empresa: c.empresa || '' };
    }).filter(function (c) { return c.nome || c.telefone; });
    return { ok: true, contatos: out };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/* ===================== Histórico de conversas (Firestore) ===================== */

function _tituloConversa(mensagem, anexo) {
  var t = String(mensagem || '').trim();
  if (t) return t.length > 48 ? t.substring(0, 48) + '…' : t;
  if (anexo && anexo.nome) return '📎 ' + anexo.nome;
  return 'Nova conversa';
}

function _persistirTurno(uid, conversaId, mensagem, anexo, extra) {
  if (extra.bloqueado) return conversaId || null; // anexo bloqueado: nada a persistir
  // Não salva respostas de erro/aviso (evita poluir o histórico e o contexto de conversas futuras).
  if (String(extra.resposta || '').trim().indexOf('⚠️') === 0) return conversaId || null;
  var base = 'usuarios/' + uid + '/conversas';
  var agora = Date.now();
  if (!conversaId) {
    conversaId = Utilities.getUuid();
    Firestore.setDoc(base, conversaId, { titulo: _tituloConversa(mensagem, anexo), criadoEm: agora, atualizadoEm: agora });
  } else {
    Firestore.updateDoc(base, conversaId, { atualizadoEm: agora });
  }
  var col = base + '/' + conversaId + '/mensagens';
  var anexoRef = null;
  if (anexo) {
    anexoRef = {
      nome: anexo.nome || '',
      url: extra.anexoUrl || '',
      fileId: extra.fileId || '',
      categoria: extra.categoria || '',
      isImage: !!(anexo.tipo === 'inline' && String(anexo.mimeType || '').indexOf('image/') === 0)
    };
  }
  Firestore.setDoc(col, Utilities.getUuid(), { role: 'user', text: String(mensagem || ''), ts: agora, anexo: anexoRef });
  Firestore.setDoc(col, Utilities.getUuid(), { role: 'assistant', text: String(extra.resposta || ''), ts: agora + 1, anexo: null });
  return conversaId;
}

// Remove magic-text do MacroDroid NÃO substituído ([battery_level], {wifi_ssid}, etc.) que às vezes
// vem grudado no valor real (ex.: "100|100|[battery_level]|[battery_charging]"). Devolve o 1º token
// limpo (sem colchetes/chaves). Se TUDO for placeholder, devolve '' (a UI cai no rótulo padrão).
function _limparValorTelemetria(v) {
  if (v == null) return '';
  var partes = String(v).split('|');
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i].trim();
    if (p && !/[\[\]{}]/.test(p)) return p;
  }
  return '';
}

/** Telemetria → está carregando? true/false/null(desconhecido).
 *  O [power] do MacroDroid responde em PT: "Ligar" = na tomada / "Desligar" = fora.
 *  A ORDEM IMPORTA: "desligar" CONTÉM "lig" — o negativo tem que ser testado ANTES.
 *  FONTE ÚNICA de propósito. Isto vivia duplicado: _avaliarEventosProativos acertava, mas o
 *  contexto do voice_command tinha a própria lista (charging/carregando/true/ac/usb/plugged) que
 *  NÃO conhecia "Ligar" — com o cabo na tomada o modelo era informado "Carregando: Não". Bug real
 *  encontrado em 21/09; duas listas para a mesma pergunta divergem, é só questão de tempo. */
function _telCarregando(v) {
  var s = String(_limparValorTelemetria(v) || '').toLowerCase();
  if (!s) return null;
  if (/deslig|discharg|false|\bnao\b/.test(s)) return false;
  if (/lig|charg|true|\bsim\b|\bac\b|usb|plugged|full/.test(s)) return true;
  return null;
}

/** Telemetria → { modo, volume }. modo ∈ Normal|Silencioso|Vibrar|null; volume 0-100 ou null.
 *  O modo_som chega como "[ringer_mode]|100|[vol_ringer]": o magic text do MODO nunca é
 *  substituído pelo MacroDroid e sobra só o VOLUME. _limparValorTelemetria devolvia "100" e o
 *  chamador tratava esse número como se fosse o modo — nenhum teste de silencioso/vibrar casava,
 *  caía no default e AFIRMAVA "Modo de Som: Normal" mesmo com o aparelho no silencioso.
 *  Número é volume; modo só quando vier TEXTO. Sem texto, modo fica null e quem chama OMITE a
 *  linha — dizer "não sei" é barato, afirmar o que não se sabe contamina a resposta do modelo. */
function _telModoSom(v) {
  var out = { modo: null, volume: null };
  String(v == null ? '' : v).split('|').forEach(function (parte) {
    var p = parte.trim();
    if (!p || /[\[\]{}]/.test(p)) return;                 // magic text não substituído
    if (/^\d{1,3}$/.test(p)) { if (out.volume === null) out.volume = Number(p); return; }
    if (out.modo) return;
    var low = p.toLowerCase();
    if (/silent|silencioso|sil[êe]ncio|mudo/.test(low)) out.modo = 'Silencioso';
    else if (/vibrate|vibrar|vibra/.test(low)) out.modo = 'Vibrar';
    else if (/normal/.test(low)) out.modo = 'Normal';
  });
  return out;
}

function obterStatusDispositivo(token) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false, erro: 'não autorizado' };
  try {
    var telemetria = null;
    // Pega o registro MAIS RECENTE (listDocs não garante ordem) e limpa magic-text não substituído.
    var docsTel = Firestore.listDocs('telemetria_dispositivo', 20);
    if (docsTel && docsTel.length > 0) {
      docsTel.sort(function (a, b) {
        var ta = (a.dados && a.dados.recebidoEm) ? new Date(a.dados.recebidoEm).getTime() : 0;
        var tb = (b.dados && b.dados.recebidoEm) ? new Date(b.dados.recebidoEm).getTime() : 0;
        return tb - ta;
      });
      var d = docsTel[0].dados || docsTel[0];
      if (d) {
        telemetria = { recebidoEm: d.recebidoEm || '' };
        if (d.body) {
          Object.keys(d.body).forEach(function (k) {
            telemetria[k] = _limparValorTelemetria(d.body[k]);
          });
        }
      }
    }
    // Logs: SÓ eventos ligados ao DISPOSITIVO (o card é "Logs do Celular", não a telemetria geral do agente).
    var DISPOSITIVO_TOOLS = { controlardispositivo: 1, falar: 1, notificar: 1, navegar: 1, voice_command: 1, briefing: 1 };
    var logs = [];
    var docsLogs = Firestore.listDocs('agente_eventos', 80);
    if (docsLogs && docsLogs.length > 0) {
      docsLogs.sort(function (a, b) {
        var tA = a.dados && a.dados.ts ? new Date(a.dados.ts).getTime() : 0;
        var tB = b.dados && b.dados.ts ? new Date(b.dados.ts).getTime() : 0;
        return tB - tA;
      });
      logs = docsLogs.filter(function (dd) {
        var tool = String((dd.dados && dd.dados.tool) || '').toLowerCase();
        return tool.indexOf('simular_') === 0 || tool.indexOf('dispositivo') !== -1 || DISPOSITIVO_TOOLS[tool];
      }).slice(0, 20).map(function (dd) {
        var doc = dd.dados || dd;
        return { id: dd.id, tool: doc.tool || '', ts: doc.ts || '', resumo: doc.resumo || '', ok: doc.ok !== false };
      });
    }
    return { ok: true, telemetria: telemetria, logs: logs };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

function dispararComandoDispositivo(token, acao, args) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'não autorizado' };
  try {
    args = args || {};
    var payload = { acao: acao };
    Object.keys(args).forEach(function(k) {
      payload[k] = args[k];
    });
    var res = Jarvis.controlarDispositivo(payload);
    try {
      Firestore.setDoc('agente_eventos', 'sim_' + Date.now(), {
        tool: 'simular_' + acao,
        // ts como Date (→ timestampValue), IGUAL ao Jarvis._registrarEvento. Antes era .toISOString()
        // (→ stringValue): tipo misto na coleção quebrava o orderBy (Firestore ordena por tipo antes do valor).
        ts: new Date(),
        resumo: 'Disparado manualmente via Painel Web: ' + JSON.stringify(args),
        ok: res && res.status === 'success',
        userEmail: sessao.email
      });
    } catch(eLog) {}
    return { ok: true, resultado: res };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

function listarConversas(token) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false, conversas: [] };
  try {
    var lista = Firestore.listDocs('usuarios/' + sessao.uid + '/conversas', 100).map(function (c) {
      return { id: c.id, titulo: c.dados.titulo || 'Conversa', atualizadoEm: Number(c.dados.atualizadoEm || 0) };
    });
    lista.sort(function (a, b) { return b.atualizadoEm - a.atualizadoEm; });
    return { ok: true, conversas: lista };
  } catch (e) { return { ok: false, erro: e.message, conversas: [] }; }
}

/** Renomeia uma conversa do usuário (tuning UI: lápis na sidebar). */
function renomearConversa(token, conversaId, novoTitulo) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false, erro: 'Sessão inválida.' };
  var t = String(novoTitulo || '').trim();
  if (!conversaId || !t) return { ok: false, erro: 'Informe o novo título.' };
  try {
    Firestore.updateDoc('usuarios/' + sessao.uid + '/conversas', conversaId, { titulo: t.substring(0, 60), atualizadoEm: Date.now() });
    return { ok: true, titulo: t.substring(0, 60) };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Estado do assistente para o indicador no header (online/reserva/offline). Leve, NÃO gasta cota. */
function estadoAssistente(token) {
  var sessao = getSessionUser(token);
  if (!sessao) return { estado: 'offline', texto: 'Offline' };
  var p = PropertiesService.getScriptProperties();
  var temGemini = !!p.getProperty('GEMINI_API_KEY');
  var temReserva = !!(p.getProperty('OPENROUTER_API_KEY') || p.getProperty('ANTHROPIC_API_KEY') || p.getProperty('NVIDIA_API_KEY'));
  // Sem checar cota ao vivo (custaria 1 chamada). Reporta capacidade configurada.
  if (temGemini) return { estado: 'online', texto: 'Online', reserva: temReserva };
  if (temReserva) return { estado: 'reserva', texto: 'Modo reserva', reserva: true };
  return { estado: 'offline', texto: 'Sem IA configurada' };
}

/**
 * DASHBOARD · Centro de Comando — agregador owner-gated do "dia" do dono.
 * Cada seção é defensiva (try/catch isolado): se um serviço falhar, o card aparece vazio
 * em vez de derrubar o painel inteiro. Inclui o card "Atividade" (P-C · Observabilidade):
 * lê a coleção agente_eventos (telemetria de cada tool call gravada por Jarvis._registrarEvento).
 */
function dashboardResumo(token) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'Apenas o proprietário pode ver o painel.' };
  var TZ = 'America/Sao_Paulo';
  var nome = '';
  try { nome = (s.nome || s.email || '').split(/[ @]/)[0]; nome = nome.charAt(0).toUpperCase() + nome.slice(1); } catch (e) {}
  var out = { ok: true, nome: nome };

  // 📧 E-mails não lidos
  try {
    out.emailsNaoLidos = GmailApp.getInboxUnreadCount();
    out.emails = GmailApp.search('is:unread in:inbox', 0, 5).map(function (t) {
      var m = t.getMessages()[0];
      return { assunto: (m.getSubject() || '(sem assunto)').substring(0, 70), de: String(m.getFrom() || '').replace(/<.*>/, '').trim().substring(0, 40) };
    });
  } catch (e) { out.emails = []; }

  // 📅 Próximos eventos (7 dias) e detecção de conflitos
  var conflitoAgenda = false;
  try {
    var agora = new Date(), ate = new Date(agora.getTime() + 7 * 86400000);
    var evs = CalendarApp.getDefaultCalendar().getEvents(agora, ate);
    out.eventos = evs.slice(0, 8).map(function (ev) {
      return { inicio: Utilities.formatDate(ev.getStartTime(), TZ, 'dd/MM HH:mm'), titulo: (ev.getTitle() || '(sem título)').substring(0, 60) };
    });
    
    // Detecção básica de conflitos de horários (eventos que se sobrepõem)
    for (var j = 0; j < evs.length - 1; j++) {
      var currentEv = evs[j];
      var nextEv = evs[j + 1];
      if (currentEv.getEndTime().getTime() > nextEv.getStartTime().getTime()) {
        conflitoAgenda = true;
        break;
      }
    }
  } catch (e) { out.eventos = []; }
  out.conflitoAgenda = conflitoAgenda;

  // ✅ Tarefas pendentes (com id, p/ ações no card)
  try {
    out.tarefas = (typeof Tarefas !== 'undefined' ? Tarefas.listar({}) : []).slice(0, 12).map(function (t) { return { id: t.id, titulo: t.titulo }; });
  } catch (e) { out.tarefas = []; }

  // 🔐 Autorizações pendentes
  try { out.autorizacoes = (typeof Autorizacoes !== 'undefined' ? Autorizacoes.listar() : []); } catch (e) { out.autorizacoes = []; }

  // 🛡️ Pendências do MODO SECRETÁRIA (rascunhos aguardando aprovação do dono)
  try { out.pendencias = (typeof Secretaria !== 'undefined' ? Secretaria.listar() : []); } catch (e) { out.pendencias = []; }
  try { out.modoSecretaria = (PropertiesService.getScriptProperties().getProperty('WHATSAPP_BOT_MODE') || 'auto').toLowerCase() === 'secretaria'; } catch (e) { out.modoSecretaria = false; }

  // ⏰ Mensagens agendadas
  try { out.agendadas = (typeof WhatsApp !== 'undefined' ? WhatsApp.listarAgendadas() : []); } catch (e) { out.agendadas = []; }

  // 🌐 Monitores web
  try { out.monitores = (typeof Web !== 'undefined' ? Web.listar() : []); } catch (e) { out.monitores = []; }

  // 📊 Atividade (P-C) — últimas execuções de ferramentas (telemetria agente_eventos)
  try { out.atividade = _atividadeRecente(40); } catch (e) { out.atividade = { total: 0, ok: 0, erros: 0, itens: [] }; }

  // 🩹 Revisão (P-L) — aprendizado ativo: respostas marcadas com 👎 p/ revisão
  try { out.revisao = _revisaoFeedback(5); } catch (e) { out.revisao = { positivos: 0, negativos: 0, itens: [] }; }

  // 🛰️ Provedores (Q5) — uso por tier/provedor a partir da telemetria (cota: billing × free × reserva)
  try { out.provedores = _provedoresResumo(120); } catch (e) { out.provedores = { itens: [], reserva: 0 }; }

  // 🔁 Loop / governança (L3) — tetos + eventos de loop (repetições evitadas / cortes de orçamento)
  try { out.loop = _loopResumo(200); } catch (e) { out.loop = { itens: [] }; }

  // 🧠 RAG / conhecimento (CREALO-8) — uso e confiabilidade das ferramentas de recuperação
  try { out.rag = _ragResumo(300); } catch (e) { out.rag = { chamadas: 0, ok: 0, falhas: 0, itens: [] }; }

  // 🔔 Alertas de voz agendados (o Jarvis fala no Android) — p/ o card de gerenciamento no Dashboard.
  try { out.alertasVoz = (typeof AlertasVoz !== 'undefined' ? AlertasVoz.listar() : []); } catch (e) { out.alertasVoz = []; }

  // 🕗 Turno de trabalho vigente (manha|tarde|null) — contexto no cabeçalho + resumo do dia.
  try { out.turno = (typeof AlertasVoz !== 'undefined' && AlertasVoz.turnoAtual) ? AlertasVoz.turnoAtual() : null; } catch (e) { out.turno = null; }

  // 🩺 Saúde do motor (P7.1b) — o Dashboard é o observador FORA dos gatilhos: ao abrir o app,
  // verifica + re-arma gatilhos mortos + avisa (deduped); e expõe o status p/ exibir na UI.
  try { out.saude = (typeof Heartbeat !== 'undefined' ? Heartbeat.verificarEAlertar().status : { ok: true, itens: [] }); }
  catch (e) { try { out.saude = Heartbeat.status(); } catch (e2) { out.saude = { ok: true, itens: [] }; } }

  // 🎯 Objetivos em andamento (progresso)
  try {
    out.objetivosAtivos = (typeof Objetivos !== 'undefined' ? Objetivos.listar() : []).filter(function (o) {
      return o.status === 'em_andamento' || o.status === 'planejado';
    });
  } catch (e) { out.objetivosAtivos = []; }

  // 🖼️ Imagens recentes geradas
  try {
    var pasta = DriveUploads._subpasta('assets');
    var files = pasta.getFiles();
    var imagens = [];
    while (files.hasNext() && imagens.length < 3) {
      var f = files.next();
      var mt = f.getMimeType() || '';
      if (mt.indexOf('image/') === 0) {
        imagens.push({
          id: f.getId(),
          nome: f.getName(),
          thumbUrl: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w600',
          url: f.getUrl()
        });
      }
    }
    out.imagensRecentes = imagens;
  } catch (e) { out.imagensRecentes = []; }

  // 🔀 ORDENAÇÃO INTELIGENTE dos cards: os que exigem atenção/têm conteúdo flutuam ao topo;
  // os ociosos afundam. O frontend renderiza na ordem de out.ordemCards (fallback: ordem natural).
  try { out.ordemCards = _ordemCardsDashboard(out); } catch (e) { out.ordemCards = null; }

  return out;
}

/**
 * 🔀 Ordem inteligente dos cards do Dashboard — PURA (testável offline).
 * peso = base (ordem natural) + 1000 se "notável" (tem conteúdo/algo a fazer) + urgência extra.
 * Cards notáveis flutuam acima de TODOS os ociosos; entre notáveis, urgência manda.
 * @param {Object} d  o próprio objeto de dashboardResumo (usa os counts já calculados)
 * @return {string[]} chaves de card na ordem de exibição
 */
function _ordemCardsDashboard(d) {
  d = d || {};
  function n(x) { return (x && x.length) || 0; }
  var pv = d.provedores || {}, at = d.atividade || {}, rv = d.revisao || {};
  var taxa = Number(pv.taxaErro || 0);
  var defs = [
    { key: 'autoriz',      base: 90, note: n(d.autorizacoes) > 0,  urg: n(d.autorizacoes) > 0 ? 500 : 0 },
    { key: 'pendencia',    base: 85, note: n(d.pendencias) > 0,    urg: 0 },
    { key: 'evento',       base: 80, note: n(d.eventos) > 0,       urg: d.conflitoAgenda ? 400 : 0 },
    { key: 'tarefa',       base: 78, note: n(d.tarefas) > 0,       urg: 0 },
    { key: 'agendada',     base: 70, note: n(d.agendadas) > 0,     urg: 0 },
    { key: 'monitor',      base: 66, note: n(d.monitores) > 0,     urg: 0 },
    { key: 'provedores',   base: 60, note: taxa >= 10,             urg: taxa >= 25 ? 300 : 0 },
    { key: 'atividade',    base: 56, note: Number(at.erros || 0) > 0, urg: 0 },
    { key: 'revisao',      base: 52, note: Number(rv.negativos || 0) > 0, urg: 0 },
    { key: 'objetivos',    base: 48, note: n(d.objetivosAtivos) > 0, urg: 0 },
    { key: 'conhecimento', base: 44, note: false,                  urg: 0 },
    { key: 'midia',        base: 40, note: false,                  urg: 0 },
    { key: 'loop',         base: 36, note: false,                  urg: 0 },
    { key: 'alertasVoz',   base: 32, note: n(d.alertasVoz) > 0,    urg: 0 }
  ];
  return defs
    .map(function (x, i) { return { key: x.key, peso: x.base + (x.note ? 1000 : 0) + x.urg, i: i }; })
    .sort(function (a, b) { return (b.peso - a.peso) || (a.i - b.i); })
    .map(function (o) { return o.key; });
}

/** UI (frontend, token de sessão): cria/edita/exclui ALERTAS DE VOZ. Somente o proprietário. */
function uiCriarAlertaVoz(token, o) {
  var s = getSessionUser(token); if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.criar(o || {}) : { ok: false, erro: 'indisponível' };
}
function uiEditarAlertaVoz(token, id, campos) {
  var s = getSessionUser(token); if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  return (typeof AlertasVoz !== 'undefined' && AlertasVoz.editar) ? AlertasVoz.editar(id, campos || {}) : { ok: false, erro: 'indisponível' };
}
function uiCancelarAlertaVoz(token, id) {
  var s = getSessionUser(token); if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.cancelar(id) : { ok: false, erro: 'indisponível' };
}
/** Dispara um alerta AGORA (prévia no celular) — fala o texto do alerta (ou gera, se dinâmico). */
function uiTestarAlertaVoz(token, id) {
  var s = getSessionUser(token); if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  return (typeof AlertasVoz !== 'undefined' && AlertasVoz.testar) ? AlertasVoz.testar(id) : { ok: false, erro: 'indisponível' };
}

/** ==== Ações dos cards do Dashboard (UI, token de sessão + owner) ==== */
function _uiOwner(token) { var s = getSessionUser(token); return (s && Jarvis._isOwner(s.email)) ? s : null; }
// ✅ Tarefas
function uiTarefaAdicionar(token, titulo) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  if (!String(titulo || '').trim()) return { ok: false, erro: 'Informe o título da tarefa.' };
  var r = Tarefas.adicionar(String(titulo).trim()); return { ok: r && r.status === 'success', titulo: r && r.titulo, erro: r && r.erro };
}
function uiTarefaConcluir(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Tarefas.concluir(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}
function uiTarefaExcluir(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Tarefas.deletar(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}
// 🔐 Autorizações
function uiAutorizar(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Autorizacoes.autorizar(id); return { ok: r && r.status === 'success', erro: r && r.erro, resultado: r && r.resultado };
}
function uiNegar(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Autorizacoes.negar(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}
// 🛡️ Modo Secretária (pendências)
function uiPendenciaResponder(token, id, textoCustom) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Secretaria.responder(id, textoCustom || ''); return { ok: r && r.status === 'success', erro: r && r.erro, para: r && r.para };
}
function uiPendenciaIgnorar(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Secretaria.ignorar(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}
// 🛡️ Liga/desliga o MODO SECRETÁRIA (WHATSAPP_BOT_MODE: secretaria ↔ auto)
function uiToggleSecretaria(token, ativar) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var modo = ativar ? 'secretaria' : 'auto';
  PropertiesService.getScriptProperties().setProperty('WHATSAPP_BOT_MODE', modo);
  return { ok: true, modo: modo, ativo: ativar };
}

// 📅 Google Calendar (Adicionar / Excluir)
function uiEventoAdicionar(token, descricao) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  if (!String(descricao || '').trim()) return { ok: false, erro: 'Informe a descrição do compromisso.' };
  try {
    var cal = CalendarApp.getDefaultCalendar();
    var ev = cal.createEventFromDescription(String(descricao).trim());
    var TZ = 'America/Sao_Paulo';
    return { ok: true, titulo: ev.getTitle(), inicio: Utilities.formatDate(ev.getStartTime(), TZ, 'dd/MM HH:mm') };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

function uiEventoExcluir(token, titulo) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var cal = CalendarApp.getDefaultCalendar();
    var ag = new Date(), ate = new Date(ag.getTime() + 7 * 86400000);
    var evs = cal.getEvents(ag, ate);
    var target = null;
    var tSearch = String(titulo || '').toLowerCase().trim();
    for (var i = 0; i < evs.length; i++) {
      if (String(evs[i].getTitle() || '').toLowerCase().trim() === tSearch) {
        target = evs[i];
        break;
      }
    }
    if (!target) {
      for (var i = 0; i < evs.length; i++) {
        if (String(evs[i].getTitle() || '').toLowerCase().indexOf(tSearch) !== -1) {
          target = evs[i];
          break;
        }
      }
    }
    if (!target) return { ok: false, erro: 'Evento não encontrado nos próximos 7 dias.' };
    var t = target.getTitle();
    target.deleteEvent();
    return { ok: true, titulo: t };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ⏰ Mensagens Agendadas (WhatsApp)
function uiAgendarWhatsApp(token, contato, mensagem, dataISO, repetirDias, repetirMeses) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  if (!contato || !mensagem || !dataISO) return { ok: false, erro: 'Contato, mensagem e data/hora são obrigatórios.' };
  try {
    var quando = new Date(dataISO).getTime();
    if (isNaN(quando) || quando < Date.now() - 60000) {
      return { ok: false, erro: 'Data/hora inválida ou no passado.' };
    }
    var opts = {
      repetirDias: Number(repetirDias) || 0,
      repetirMeses: Number(repetirMeses) || 0
    };
    var r = WhatsApp.agendarEnvio(contato, mensagem, quando, opts);
    if (r.status === 'success') {
      return { ok: true, id: r.id };
    }
    return { ok: false, erro: r.erro };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 🔁 Configurações de Loop e Governança
function uiUpdateLoopSettings(token, maxSteps, maxTools, budgetDay) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var p = PropertiesService.getScriptProperties();
    p.setProperty('LOOP_MAX_STEPS', String(Number(maxSteps) || 12));
    p.setProperty('LOOP_MAX_TOOLS', String(Number(maxTools) || 16));
    p.setProperty('LOOP_BUDGET_DAY', String(Number(budgetDay) || 200));
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 📊 Limpar logs de atividade
function uiLimparLogsEventos(token) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var docs = Firestore.listDocs('agente_eventos', 200);
    docs.forEach(function (d) {
      try { Firestore.deleteDoc('agente_eventos', d.id); } catch (e) {}
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 🩹 Resolver Revisão de Feedback + Ingestão Wiki
function uiRevisaoResolver(token, feedbackId, correcaoWiki, deletar) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    if (correcaoWiki && String(correcaoWiki).trim()) {
      if (typeof WikiMemoryService !== 'undefined') {
        WikiMemoryService.escreverWiki('correcao_ia_' + feedbackId + '.md', String(correcaoWiki).trim());
      }
    }
    if (deletar || (correcaoWiki && String(correcaoWiki).trim())) {
      Firestore.deleteDoc('feedback', feedbackId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 🛰️ Prioridade de Cotas / Ordem Gemini
function uiDefinirOrdemGemini(token, order) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  if (order !== 'billing_first' && order !== 'free_first') return { ok: false, erro: 'Ordem inválida.' };
  try {
    PropertiesService.getScriptProperties().setProperty('GEMINI_ORDER', order);
    return { ok: true, order: order };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ⏰ Mensagens agendadas / 🌐 Monitores web (Lote 2)
function uiCancelarAgendada(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = WhatsApp.cancelarAgendada(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}
function uiMonitorAdicionar(token, url, descricao) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  if (!/^https?:\/\//i.test(String(url || '').trim())) return { ok: false, erro: 'Informe uma URL http(s) válida.' };
  var r = Web.monitorar(String(url).trim(), descricao || ''); return { ok: r && r.status === 'success', erro: r && r.erro };
}
function uiMonitorRemover(token, id) {
  if (!_uiOwner(token)) return { ok: false, erro: 'Apenas o proprietário.' };
  var r = Web.parar(id); return { ok: r && r.status === 'success', erro: r && r.erro };
}

// 📧 Sintetizar Briefing de Comunicações Recentes
function uiSintetizarBriefing(token) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var pends = (typeof Secretaria !== 'undefined' ? Secretaria.listar() : []);
    var emails = [];
    try {
      emails = GmailApp.search('is:unread in:inbox', 0, 5).map(function (t) {
        var m = t.getMessages()[0];
        return 'De: ' + m.getFrom() + ' - Assunto: ' + m.getSubject();
      });
    } catch (e) {}
    
    var ctx = "E-mails não lidos:\n" + (emails.join('\n') || "Nenhum") + "\n\nMensagens pendentes no WhatsApp (Secretária):\n";
    if (pends.length) {
      pends.forEach(function (p) {
        ctx += 'De: ' + p.de + ' - Mensagem: "' + p.recebida + '"\n';
      });
    } else {
      ctx += "Nenhuma pendência";
    }
    
    var prompt = 'Você é o JARVIS. Resuma as comunicações pendentes acima em um briefing extremamente curto e direto (máximo de 2 frases) para o Bruno. Diga o que é mais importante e se há algo urgente. Retorne apenas o texto do briefing.';
    var r = Gemini.gerar({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 256 }
    });
    var briefing = '';
    try {
      var parts = ((((r.json || {}).candidates || [])[0] || {}).content || {}).parts || [];
      briefing = parts.map(function (p) { return p.text || ''; }).join('').trim();
    } catch (e) { briefing = 'Erro ao sintetizar briefing.'; }
    
    return { ok: true, briefing: briefing };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 📅 Organizar meu Dia (Priorização)
function uiOrganizarDia(token) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var instr = 'Organize meu dia hoje. Liste minhas tarefas pendentes e eventos da agenda de hoje e me sugira uma priorização otimizada no WhatsApp.';
    if (typeof Objetivos !== 'undefined' && typeof Jobs !== 'undefined') {
      var obj = Objetivos.criar(sessao.email, instr);
      Jobs.enfileirar('objetivo', { id: obj.id });
      return { ok: true, mensagem: 'Organização iniciada em segundo plano. O Jarvis enviará a agenda otimizada para o seu WhatsApp em breve!' };
    } else {
      var resp = Jarvis.ask(sessao.email, instr, [], null, { interativo: false });
      return { ok: true, mensagem: resp };
    }
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 📥 Upload e Ingestão Instantânea na Wiki
function uiUploadEIngerir(token, base64Data, fileName, mimeType) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    
    var salvo = DriveUploads.salvar({ tipo: 'inline', mimeType: mimeType, data: base64Data, nome: fileName });
    if (!salvo || !salvo.id) return { ok: false, erro: 'Falha ao salvar arquivo no Drive.' };
    
    if (typeof Jobs !== 'undefined') {
      Jobs.enfileirar('ingestao', { email: sessao.email, fileId: salvo.id });
      return { ok: true, mensagem: 'Arquivo salvo com sucesso e enfileirado para ingestão na Wiki!' };
    }
    return { ok: false, erro: 'Serviço de Jobs indisponível.' };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// 🖼️ Buscar Imagens Recentes Geradas (assets)
function uiBuscarImagensRecentes(token) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  try {
    var pasta = DriveUploads._subpasta('assets');
    var files = pasta.getFiles();
    var imagens = [];
    while (files.hasNext() && imagens.length < 3) {
      var f = files.next();
      var mt = f.getMimeType() || '';
      if (mt.indexOf('image/') === 0) {
        imagens.push({
          id: f.getId(),
          nome: f.getName(),
          thumbUrl: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w600',
          url: f.getUrl()
        });
      }
    }
    return { ok: true, imagens: imagens };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}


/**
 * L3 · Governança de loop: lê a telemetria (agente_eventos) e resume o comportamento dos loops —
 * execuções de ferramenta, repetições EVITADAS (não-progresso) e cortes por ORÇAMENTO — junto dos
 * tetos atuais. Mostra que o loop está sendo regulado (economia de tokens/quota).
 */
function _loopResumo(n) {
  var p = PropertiesService.getScriptProperties();
  var maxSteps = Number(p.getProperty('LOOP_MAX_STEPS')) || 12;
  var maxTools = Number(p.getProperty('LOOP_MAX_TOOLS')) || 16;
  var budgetDay = Number(p.getProperty('LOOP_BUDGET_DAY')) || 200;
  var docs = Firestore.listDocs('agente_eventos', n || 200);
  var exec = 0, repet = 0, orc = 0;
  docs.forEach(function (d) {
    var t = String((d.dados || {}).tool || '');
    if (t === 'loop:repeticao') repet++;
    else if (t === 'loop:orcamento') orc++;
    else if (t !== 'modo_reserva' && t.indexOf('hook:') !== 0) exec++;
  });
  return {
    maxSteps: maxSteps, maxTools: maxTools, budgetDay: budgetDay, execucoes: exec, repeticoesEvitadas: repet, cortesOrcamento: orc,
    itens: [
      'Tetos: ' + maxSteps + ' passos · ' + maxTools + ' tool-calls/turno',
      'Execuções de ferramenta: ' + exec,
      'Repetições evitadas (não-progresso): ' + repet,
      'Cortes por orçamento: ' + orc,
      'Orçamento diário: ' + budgetDay + ' execs'
    ]
  };
}

/**
 * Q5 · Observabilidade de cota: agrega a telemetria (agente_eventos) por `tier` → quantas chamadas
 * em cada provedor/camada (faturamento × free × free2 × reserva), com % de erro. Responde
 * "estou na cota free ou no billing? quanto? o reserva entrou?" sem debugar por print.
 */
function _provedoresResumo(n) {
  var p = PropertiesService.getScriptProperties();
  var ordem = p.getProperty('GEMINI_ORDER') || 'billing_first';
  var docs = Firestore.listDocs('agente_eventos', n || 120);
  var por = {}; var reserva = 0;
  docs.forEach(function (d) {
    var x = d.dados || {};
    var tier = x.tier || '(sem tier)';
    var g = por[tier] || (por[tier] = { tier: tier, total: 0, erros: 0 });
    g.total++; if (!x.ok) g.erros++;
    if (tier === 'reserva') reserva++;
  });
  var grupos = Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return b.total - a.total; });
  var totalChamadas = 0, totalErros = 0;
  grupos.forEach(function (g) { totalChamadas += g.total; totalErros += g.erros; });
  var itens = grupos.map(function (g) {
    var rot = ({ faturamento: '💳 Gemini (billing)', free: '🆓 Gemini (free)', free2: '🆓 Gemini (free2)', reserva: '🔁 Reserva (alt)' })[g.tier] || g.tier;
    return rot + ' · ' + g.total + ' chamadas' + (g.erros ? ' · ' + g.erros + ' erro(s)' : '');
  });
  var taxaErro = totalChamadas ? Math.round((totalErros / totalChamadas) * 100) : 0;
  return { itens: itens, reserva: reserva, ordem: ordem, totalChamadas: totalChamadas, totalErros: totalErros, taxaErro: taxaErro };
}

/* ============ Popover · Preferências do Jarvis + Status do sistema (owner) ============ */

/**
 * Valida as preferências editáveis pela UI — WHITELIST estrita (nunca toca em segredos).
 * PURA (testável offline). @return { valores: {PROP: valor}, erros: [msgs] }.
 */
function _validarPrefsUI(p) {
  p = p || {};
  var out = {}, erros = [];
  if (p.ttsEngine !== undefined) {
    var e1 = String(p.ttsEngine).toLowerCase().trim();
    if (e1 === 'gemini' || e1 === 'cloud') out.TTS_ENGINE = e1;
    else erros.push('Motor de voz inválido (use "gemini" ou "cloud").');
  }
  if (p.vozGemini !== undefined) {
    // Confere contra o catálogo, não só o formato: nome bem-formado mas inexistente fazia a
    // síntese falhar silenciosamente lá na frente, já sem contexto para diagnosticar.
    var v = (typeof _resolverVozGemini === 'function') ? _resolverVozGemini(p.vozGemini) : null;
    if (v) out.TTS_VOICE_GEMINI = v;
    else erros.push('Voz Gemini desconhecida (ex.: Enceladus, Iapetus, Sulafat).');
  }
  if (p.estilo !== undefined) {
    out.TTS_STYLE = String(p.estilo).trim().slice(0, 120); // vazio permitido (sem estilo)
  }
  if (p.volumeDb !== undefined) {
    var n = Number(p.volumeDb);
    if (isFinite(n) && n >= 0 && n <= 16) out.FALA_VOLUME_DB = String(Math.round(n));
    else erros.push('Volume da fala deve estar entre 0 e 16 dB.');
  }
  if (p.modoBot !== undefined) {
    var m = String(p.modoBot).toLowerCase().trim();
    if (['auto', 'secretaria', 'off'].indexOf(m) !== -1) out.WHATSAPP_BOT_MODE = m;
    else erros.push('Modo do bot inválido (auto | secretaria | off).');
  }
  return { valores: out, erros: erros };
}

/** Lê as preferências para o modal do popover (somente dono). */
function getPreferenciasUI(token) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário pode ver as preferências.' };
  var p = PropertiesService.getScriptProperties();
  var vdb = Number(p.getProperty('FALA_VOLUME_DB'));
  return {
    ok: true,
    ttsEngine: (p.getProperty('TTS_ENGINE') || 'cloud').toLowerCase(),
    vozGemini: p.getProperty('TTS_VOICE_GEMINI') || 'Enceladus',
    estilo: p.getProperty('TTS_STYLE') || '',
    volumeDb: isFinite(vdb) ? vdb : 6,
    modoBot: (p.getProperty('WHATSAPP_BOT_MODE') || 'auto').toLowerCase()
  };
}

/** Salva as preferências do modal (somente dono; whitelist via _validarPrefsUI). */
function salvarPreferenciasUI(token, prefs) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário pode alterar as preferências.' };
  var v = _validarPrefsUI(prefs);
  if (v.erros.length) return { ok: false, erro: v.erros.join(' ') };
  var p = PropertiesService.getScriptProperties();
  Object.keys(v.valores).forEach(function (k) { p.setProperty(k, v.valores[k]); });
  return { ok: true, salvos: Object.keys(v.valores).length };
}

/** Status do sistema num relance (heartbeat + provedores + turno) — modal do popover (dono). */
function statusSistemaUI(token) {
  var sessao = getSessionUser(token);
  if (!sessao || !Jarvis._isOwner(sessao.email)) return { ok: false, erro: 'Apenas o proprietário.' };
  var out = { ok: true };
  try { out.heartbeat = (typeof Heartbeat !== 'undefined') ? Heartbeat.status() : null; } catch (e1) { out.heartbeat = null; }
  try { out.provedores = _provedoresResumo(120); } catch (e2) { out.provedores = null; }
  try { out.turno = (typeof AlertasVoz !== 'undefined' && AlertasVoz.turnoAtual) ? AlertasVoz.turnoAtual() : null; } catch (e3) { out.turno = null; }
  try { out.alertasVoz = (typeof AlertasVoz !== 'undefined') ? AlertasVoz.listar().length : 0; } catch (e4) { out.alertasVoz = 0; }
  try { out.modoBot = (PropertiesService.getScriptProperties().getProperty('WHATSAPP_BOT_MODE') || 'auto').toLowerCase(); } catch (e5) {}
  return out;
}

/**
 * P-L · Aprendizado ativo: agrega o feedback 👍/👎 (col `feedback`) e devolve as respostas
 * mal avaliadas (👎) mais recentes p/ revisão — "harvest failure cases from production".
 */
function _revisaoFeedback(n) {
  var TZ = 'America/Sao_Paulo';
  var docs = Firestore.listDocs('feedback', 300);
  var ups = 0, downs = [];
  docs.forEach(function (d) {
    var x = d.dados || {};
    if (x.voto === 'up') ups++;
    else if (x.voto === 'down') downs.push({ id: d.id, resposta: x.resposta || '', ts: Number(x.ts || 0) });
  });
  downs.sort(function (a, b) { return b.ts - a.ts; });
  var itens = downs.slice(0, n || 5).map(function (d) {
    var quando = '';
    try { quando = d.ts ? Utilities.formatDate(new Date(d.ts), TZ, 'dd/MM HH:mm') : ''; } catch (e) {}
    var trecho = String(d.resposta || '(sem texto)').replace(/\s+/g, ' ').trim().substring(0, 90);
    return { id: d.id, texto: (quando ? quando + ' · ' : '') + '“' + trecho + '”', respostaCompleta: d.resposta };
  });
  return { positivos: ups, negativos: downs.length, itens: itens };
}

/**
 * Lê a telemetria recente (coleção agente_eventos). Doc id = timestamp-reverso, então listDocs
 * já retorna do mais recente p/ o mais antigo. Retorna agregados + os últimos itens formatados.
 */
function _atividadeRecente(n) {
  var TZ = 'America/Sao_Paulo';
  var docs = Firestore.listDocs('agente_eventos', n || 40);
  var total = docs.length, ok = 0, erros = 0, somaMs = 0;
  docs.forEach(function (d) { var x = d.dados || {}; if (x.ok) ok++; else erros++; somaMs += Number(x.ms) || 0; });
  var itens = docs.slice(0, 8).map(function (d) {
    var x = d.dados || {};
    var quando = '';
    try { quando = x.ts ? Utilities.formatDate(new Date(x.ts), TZ, 'HH:mm') : ''; } catch (e) {}
    return (x.ok ? '✅ ' : '⚠️ ') + (x.tool || '?') + ' · ' + (Number(x.ms) || 0) + 'ms' +
           (x.tier ? ' · ' + x.tier : '') + (quando ? ' · ' + quando : '') +
           (x.ok ? '' : (x.resumo ? ' — ' + x.resumo : ''));
  });
  return { total: total, ok: ok, erros: erros, msMedio: total ? Math.round(somaMs / total) : 0, itens: itens };
}

/**
 * CREALO-8 · Saúde da RAG: agrega na telemetria (agente_eventos) as chamadas às ferramentas de
 * conhecimento (buscarConhecimento/buscarSemantico/buscarNoWiki/lerWiki/lembrarDeConversas) →
 * mede USO e confiabilidade da recuperação. (Correlação por-turno com 👎 exigiria turnId no
 * feedback — ainda não instrumentado; aqui medimos uso/sucesso/latência, que já é acionável.)
 */
function _ragResumo(n) {
  var RAG_TOOLS = { buscarConhecimento: 1, buscarSemantico: 1, buscarNoWiki: 1, lerWiki: 1, lembrarDeConversas: 1 };
  var docs = Firestore.listDocs('agente_eventos', n || 300);
  var chamadas = 0, ok = 0, somaMs = 0, porTool = {};
  docs.forEach(function (d) {
    var x = d.dados || {};
    if (!RAG_TOOLS[x.tool]) return;
    chamadas++; if (x.ok) ok++; somaMs += Number(x.ms) || 0;
    porTool[x.tool] = (porTool[x.tool] || 0) + 1;
  });
  var itens = Object.keys(porTool).sort(function (a, b) { return porTool[b] - porTool[a]; })
    .map(function (t) { return t + ': ' + porTool[t] + 'x'; });
  return { chamadas: chamadas, ok: ok, falhas: chamadas - ok,
           msMedio: chamadas ? Math.round(somaMs / chamadas) : 0,
           taxaOk: chamadas ? Math.round(100 * ok / chamadas) : null, itens: itens };
}

/**
 * P-D · Feedback 👍/👎 por resposta → Firestore ('feedback'). Sinal de qualidade p/ revisão
 * (princípio "gestão de feedback" do Agentic Mesh: cada execução vira fonte de aprendizado).
 */
function registrarFeedback(token, conversaId, voto, resposta) {
  var s = getSessionUser(token);
  if (!s) return { ok: false, erro: 'Sessão inválida.' };
  voto = (voto === 'up' || voto === 'down') ? voto : null;
  if (!voto) return { ok: false, erro: 'Voto inválido.' };
  try {
    Firestore.setDoc('feedback', Utilities.getUuid(), {
      uid: s.uid, email: s.email || '', conversaId: conversaId || '', voto: voto,
      resposta: String(resposta || '').substring(0, 500), ts: Date.now()
    });
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Sintetiza um texto em áudio (botão 🔊 "ouvir" nas respostas).
 *  TTS_ENGINE=gemini → usa o Gemini TTS (estilo natural, ex.: tom caloroso) p/ textos curtos (WAV).
 *  Senão (ou em texto longo / falha) → Cloud TTS (MP3, com fatiamento). WhatsApp/Android seguem no Cloud TTS. */
function sintetizarTexto(token, texto) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false, erro: 'Sessão inválida.' };
  if (typeof Voz === 'undefined' || !Voz.temChave()) return { ok: false, erro: 'Voz indisponível (service account TTS ausente).' };
  var t = String(texto || '').substring(0, 50000);
  var engine = (PropertiesService.getScriptProperties().getProperty('TTS_ENGINE') || 'cloud').toLowerCase();
  if (engine === 'gemini' && Voz.sintetizarGemini && t.length <= 4500) {
    try { var g = Voz.sintetizarGemini(t, {}); if (g.status === 'success') return { ok: true, base64: g.base64, mime: g.mime, engine: 'gemini', voz: g.voz, estilo: g.estilo }; } catch (e) {}
    // falha (cota/preview) → cai para o Cloud TTS abaixo
  }
  var r = Voz.sintetizarLongo(t, { formato: 'mp3' });
  if (r.status !== 'success') return { ok: false, erro: r.erro };
  return { ok: true, base64: r.base64, mime: r.mime || 'audio/mpeg', engine: 'cloud' };
}

/** Liga/ajusta o GEMINI TTS no botão 🔊 do chat. args:{estilo?, voz?, model?, ligar?(false=volta p/ Cloud)}. */
function configurarVozGemini(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.estilo != null) p.setProperty('TTS_STYLE', String(args.estilo));
  if (args.voz) p.setProperty('TTS_VOICE_GEMINI', String(args.voz));
  if (args.model) p.setProperty('TTS_GEMINI_MODEL', String(args.model));
  p.setProperty('TTS_ENGINE', (args.ligar === false) ? 'cloud' : 'gemini');
  return { ok: true, TTS_ENGINE: p.getProperty('TTS_ENGINE'), TTS_STYLE: p.getProperty('TTS_STYLE'), TTS_VOICE_GEMINI: p.getProperty('TTS_VOICE_GEMINI'), TTS_GEMINI_MODEL: p.getProperty('TTS_GEMINI_MODEL') || 'gemini-2.5-flash-preview-tts' };
}

function carregarConversa(token, conversaId) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false };
  try {
    var msgs = Firestore.listDocs('usuarios/' + sessao.uid + '/conversas/' + conversaId + '/mensagens', 1000).map(function (m) {
      return { role: m.dados.role, text: m.dados.text, ts: Number(m.dados.ts || 0), anexo: m.dados.anexo || null };
    });
    msgs.sort(function (a, b) { return a.ts - b.ts; });
    return { ok: true, conversaId: conversaId, mensagens: msgs };
  } catch (e) { return { ok: false, erro: e.message }; }
}

function excluirConversa(token, conversaId) {
  var sessao = getSessionUser(token);
  if (!sessao) return { ok: false };
  try {
    var col = 'usuarios/' + sessao.uid + '/conversas/' + conversaId + '/mensagens';
    Firestore.listDocs(col, 500).forEach(function (m) { try { Firestore.deleteDoc(col, m.id); } catch (e) {} });
    Firestore.deleteDoc('usuarios/' + sessao.uid + '/conversas', conversaId);
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/**
 * Ingere um anexo já salvo no Drive (/raw/) na wiki, via Jarvis (ingerirFonte + escreverWiki).
 * Apenas o proprietário.
 */
function ingerirAnexoWiki(token, fileId) {
  var sessao = getSessionUser(token);
  if (!sessao) return { resposta: '⚠️ Sessão expirada. Faça login novamente.' };
  if (!Jarvis._isOwner(sessao.email)) return { resposta: '⚠️ Apenas o proprietário pode ingerir na wiki.' };
  try {
    // Ingestão é pesada → roda em SEGUNDO PLANO (job + gatilho), liberando o chat e o limite de 6 min.
    Jobs.enfileirar('ingestao', { email: sessao.email, fileId: fileId });
    return { resposta: '📥 Ingestão iniciada em segundo plano. Vou processar a fonte e registrar no log do wiki (e te avisar no WhatsApp, se configurado) ao concluir — costuma levar 1-2 minutos.' };
  } catch (e) {
    return { resposta: '⚠️ Erro ao enfileirar a ingestão: ' + e.message };
  }
}

/** Núcleo da ingestão (reutilizado pelo job em segundo plano). Retorna o texto-resultado do Jarvis. */
function _executarIngestao(email, fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var mime = blob.getContentType() || '';
  var nome = file.getName();
  var url = file.getUrl();

  // Para PDF/imagem: EXTRAI o texto em UMA chamada multimodal (não arrasta o binário por todos os
  // passos do loop → evita estourar os 6 min). Depois ingere com o texto (leve).
  var textoFonte = '';
  if (mime === 'application/pdf' || mime.indexOf('image/') === 0) {
    try {
      var ext = Gemini.gerar({
        contents: [{ role: 'user', parts: [
          { text: 'Extraia o CONTEÚDO TEXTUAL relevante deste documento em português do Brasil (texto corrido, fiel ao original; ignore cabeçalhos/rodapés repetidos e imagens decorativas). Responda apenas com o texto.' },
          { inlineData: { mimeType: mime, data: Utilities.base64Encode(blob.getBytes()) } }
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 }
      }).json;
      var c = ext && ext.candidates && ext.candidates[0];
      textoFonte = (c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '').trim();
    } catch (e) { textoFonte = ''; }
    if (!textoFonte) return '⚠️ Não consegui extrair o texto do arquivo "' + nome + '" (' + mime + ') para ingestão.';
  } else {
    textoFonte = blob.getDataAsString();
  }

  var instrucao =
    'Documente a fonte "' + nome + '" na wiki seguindo o PROTOCOLO DE INGESTÃO (o bruto JÁ está arquivado em raw/: ' + url + ', fileId ' + fileId + '). O conteúdo extraído da fonte está no anexo de texto abaixo.\n' +
    '1) Crie sources/AAAA-MM-DD_slug.md (escreverWiki) com Resumo, Principais Conclusões e o link do bruto.\n' +
    '2) Crie/atualize APENAS as 3-4 entidades/conceitos mais relevantes (páginas concisas).\n' +
    '3) Atualize index.md (lerWiki antes para mesclar).\n' +
    '4) Registre no log com registrarNoLog.\n' +
    '5) Finalize com um resumo curto do que foi documentado.';

  var anexo = { tipo: 'texto', nome: nome, texto: textoFonte.substring(0, 40000) };
  return Jarvis.ask(email, instrucao, [], anexo, { interativo: false });
}

/** Handler do job de ingestão (chamado por Jobs._dispatch). */
function _jobIngestao(payload) {
  var txt = _executarIngestao(payload.email, payload.fileId);
  return { resultado: 'Ingestão concluída. ' + String(txt || '').substring(0, 300) };
}

/** Handler do gatilho temporal de jobs (daisy-chain). NÃO renomear (referenciado por Jobs). */
function processarJobsJarvis() {
  Jobs.processar();
}

/**
 * P7.4 · Rate limiting (defense-in-depth contra flood/loop nos endpoints públicos do /exec).
 * Janela fixa por minuto, contador GLOBAL no CacheService (o GAS não expõe o IP do cliente).
 * FAIL-OPEN: erro de infra nunca bloqueia tráfego legítimo. @return {boolean} true = permitido.
 */
function _rateLimit(bucket, max, windowSec) {
  try {
    var c = CacheService.getScriptCache();
    var k = 'rl_' + bucket + '_' + Math.floor(Date.now() / (windowSec * 1000));
    var n = Number(c.get(k) || 0) + 1;
    c.put(k, String(n), windowSec + 5);
    return n <= max;
  } catch (e) { return true; }
}

/**
 * Endpoint A2A (Agent-to-Agent): permite que SISTEMAS EXTERNOS consultem o Jarvis
 * via POST autenticado por token, no mesmo URL /exec do Web App.
 *
 * Segurança (Zero-Trust): exige A2A_API_TOKEN; a chamada executa como AGENTE EXTERNO
 * (não-proprietário) → Jarvis fica em modo SOMENTE LEITURA (conversa + leitura do wiki),
 * sem acesso ao Workspace, escrita no wiki ou execução de scripts.
 *
 * Body JSON esperado: { "token": "...", "message": "...", "historico": [opcional] }
 */
function doPost(e) {
  var json = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (_) {
        body = {};
        try {
          var pairs = e.postData.contents.split('&');
          for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            if (pair[0]) body[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
          }
        } catch (eUrl) {}
      }
    }
    // Mescla parâmetros da query string (e.parameter) no body para suporte a GET e query params
    if (e && e.parameter) {
      for (var k in e.parameter) {
        body[k] = e.parameter[k];
      }
    }

    // 🔁 P8.1 · BROKER ASSÍNCRONO (loopback de 1s, AsyncBroker.js). Roteado ANTES do rate-limit —
    // é tráfego INTERNO autenticado por HMAC (assinatura inválida = corte imediato e barato).
    if (body && body.__broker) {
      if (typeof brokerVerificarAssinatura !== 'function' || !brokerVerificarAssinatura(body)) return json({ ok: false, error: 'assinatura inválida' });
      if (body.__broker === 'DISPATCH') { _brokerDispatch(body.jobId); return json({ status: 'dispatch-ack' }); }
      if (body.__broker === 'WORKER') { _brokerWorker(body); return json({ status: 'worker-ack' }); }
      return json({ ok: false, error: 'broker op desconhecida' });
    }

    // 🛡️ P7.4 · Rate limiting (defense-in-depth). Cap GLOBAL generoso + cap mais apertado no caminho
    // que dispara o LLM (custo). Janela de 1 min, fail-open.
    if (!_rateLimit('post_all', 240, 60)) return json({ ok: false, error: 'Limite de requisições excedido. Tente novamente em instantes.' });

    // (1) Webhook da Evolution API (WhatsApp) — detectado por body.event
    if (body && (body.event || body.Event)) {
      if (!_rateLimit('post_wa', 60, 60)) return json({ ok: true, ignored: 'rate limited' });
      return _handleWhatsAppWebhook(e, body, json);
    }

    // (1.1) Obter VOICE_API_TOKEN — POST { "action": "get_voice_token", "token": "..." }
    // Apenas para proprietário autenticado. Retorna JSON com o token de voz.
    if (body && body.action === "get_voice_token") {
      var token = body.token || (e && e.parameter && e.parameter.token);
      if (!token) return json({ ok: false, error: 'Token de sessão ausente.' });
      var sessaoUser = getSessionUser(token);
      if (!sessaoUser || !Jarvis._isOwner(sessaoUser.email)) {
        return json({ ok: false, error: 'Não autorizado.' });
      }
      var props = PropertiesService.getScriptProperties();
      var voiceToken = props.getProperty('VOICE_API_TOKEN');
      if (!voiceToken) {
        voiceToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
        props.setProperty('VOICE_API_TOKEN', voiceToken);
      }
      return json({ ok: true, voice_token: voiceToken });
    }

    // (1.2) Webhook do MacroDroid (Comando de voz) — POST { "action": "voice_command", "message": "...", "token": "..." }
    // TELEMETRIA PERIÓDICA (zero-LLM, zero cota): a macro "Jarvis Telemetria" POSTa o status do aparelho
    // ({action:'telemetria', token, bateria_nivel, ...}) quando o backend pinga o webhook jarvis_telemetria
    // (gatilho de 15 min — pingTelemetria) ou quando um gatilho local dispara. Só armazena e responde.
    if (body && body.action === "telemetria") {
      var tokTel = body.token || '';
      var propsTel = PropertiesService.getScriptProperties();
      if (!tokTel || tokTel !== propsTel.getProperty('VOICE_API_TOKEN')) {
        return json({ ok: false, erro: 'não autorizado' });
      }
      try {
        var bodyTel = {};
        Object.keys(body).forEach(function (k) { if (k !== 'token' && k !== 'action') bodyTel[k] = body[k]; });
        bodyTel.origem = bodyTel.origem || 'telemetria';
        Firestore.setDoc('telemetria_dispositivo', String(1e13 - Date.now()), {
          recebidoEm: new Date().toISOString(),
          body: bodyTel
        });
        // EVENTOS PROATIVOS: a telemetria chega a cada 15 min — é o gatilho natural para o Jarvis
        // AGIR sozinho (antes ele só reagia a comando). Determinístico, sem LLM (custo zero).
        var _proat = null;
        try { _proat = _avaliarEventosProativos(bodyTel); } catch (eP) { Logger.log('[Proativo] ' + eP.message); }
        return json({ ok: true, proativo: _proat });
      } catch (eTel) { return json({ ok: false, erro: eTel.message }); }
    }

    // VIAGEM: a macro "Jarvis Viagem" manda velocidade/ETA e recebe de volta o que falar.
    // Texto puro na resposta, para a macro falar direto pelo TTS do Android (sem round-trip de áudio).
    if (body && body.action === 'viagem') {
      var tokVg = body.token || '';
      if (!tokVg || tokVg !== PropertiesService.getScriptProperties().getProperty('VOICE_API_TOKEN')) {
        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }
      try {
        var rVg = registrarViagem(body);
        return ContentService.createTextOutput(String(rVg.falar || '')).setMimeType(ContentService.MimeType.TEXT);
      } catch (eVg) { return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT); }
    }

    // NOTIFICAÇÕES DO CELULAR: a macro "Jarvis Notificações Premium" manda o que chegou.
    // Aceita GET ou POST (os parâmetros da query já foram mesclados no body acima).
    if (body && body.action === "notificacao") {
      var tokNt = body.token || '';
      if (!tokNt || tokNt !== PropertiesService.getScriptProperties().getProperty('VOICE_API_TOKEN')) {
        return json({ ok: false, erro: 'não autorizado' });
      }
      try {
        // ECO DE DIAGNÓSTICO: guarda os valores CRUS, antes de qualquer filtro. Sem isto não há como
        // distinguir "a variável não existe e chegou literal {not_text}" de "existe e veio vazia" —
        // e o conserto é diferente em cada caso.
        try {
          PropertiesService.getScriptProperties().setProperty('NOTIF_ULTIMO_BRUTO', JSON.stringify({
            em: new Date().toISOString(),
            app: String(body.app === undefined ? '(ausente)' : body.app),
            titulo: String(body.titulo === undefined ? '(ausente)' : body.titulo),
            texto: String(body.texto === undefined ? '(ausente)' : body.texto),
            ticker: String(body.ticker === undefined ? '(ausente)' : body.ticker),
            pacote: String(body.pacote === undefined ? '(ausente)' : body.pacote),
            chaves: Object.keys(body).join(',')
          }));
        } catch (eEco) {}

        // texto ou ticker: nem todo app preenche os dois. A macro manda ambos e aqui fica o que veio
        // de fato — _notifTxt já descarta magic text não substituído ("{not_text}" literal).
        var _txtNt = _notifTxt(body.texto) || _notifTxt(body.ticker);
        return json(registrarNotificacao({ app: body.app, pacote: body.pacote, titulo: body.titulo,
                                           texto: _txtNt, falar: body.falar }));
      } catch (eNt) { return json({ ok: false, erro: eNt.message }); }
    }

    // Devolve texto puro (text/plain) para simplificar a leitura direta no celular.
    if (body && body.action === "voice_command") {
      var token = body.token || (e && e.parameter && e.parameter.token);
      if (!token) return ContentService.createTextOutput("Erro: Token ausente").setMimeType(ContentService.MimeType.TEXT);
      
      var props = PropertiesService.getScriptProperties();
      var voiceToken = props.getProperty('VOICE_API_TOKEN');
      
      // Auto-inicialização do token de voz permanente caso não esteja definido
      if (!voiceToken) {
        voiceToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
        props.setProperty('VOICE_API_TOKEN', voiceToken);
        Logger.log('✅ VOICE_API_TOKEN gerado automaticamente: ' + voiceToken);
      }
      
      var isAuthorized = false;
      var emailUser = '';
      if (token === voiceToken) {
        isAuthorized = true;
        emailUser = props.getProperty('OWNER_EMAIL') || '';
      } else {
        var sessaoUser = getSessionUser(token);
        if (sessaoUser && Jarvis._isOwner(sessaoUser.email)) {
          isAuthorized = true;
          emailUser = sessaoUser.email;
        }
      }
      
      if (!isAuthorized) {
        return ContentService.createTextOutput("Erro: Não autorizado").setMimeType(ContentService.MimeType.TEXT);
      }
      
      var msgVoz = String(body.message || body.mensagem || '');
      if (!msgVoz.trim()) {
        return ContentService.createTextOutput("Erro: Mensagem vazia").setMimeType(ContentService.MimeType.TEXT);
      }
      
      try {
        try {
          var idTel = String(1e13 - Date.now());
          Firestore.setDoc('telemetria_dispositivo', idTel, {
            recebidoEm: new Date().toISOString(),
            body: body
          });
        } catch (eDb) {
          Logger.log("Erro ao salvar telemetria_dispositivo: " + eDb.message);
        }

        // Tenta reverter geocódigo da localização atual se vier lat e lon no corpo da requisição
        var localizacaoTexto = "";
        if (body.lat && body.lon) {
          try {
            var lat = Number(body.lat);
            var lon = Number(body.lon);
            if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
              var resGeo = Maps.newGeocoder().reverseGeocode(lat, lon);
              if (resGeo && resGeo.results && resGeo.results.length > 0) {
                var r = resGeo.results[0];
                var neighborhood = "";
                var city = "";
                for (var i = 0; i < r.address_components.length; i++) {
                  var comp = r.address_components[i];
                  if (comp.types.indexOf("sublocality_level_1") !== -1 || comp.types.indexOf("neighborhood") !== -1) {
                    neighborhood = comp.long_name;
                  }
                  if (comp.types.indexOf("locality") !== -1 || comp.types.indexOf("administrative_area_level_2") !== -1) {
                    city = comp.long_name;
                  }
                }
                if (neighborhood && city) {
                  localizacaoTexto = neighborhood + ", " + city;
                } else if (city) {
                  localizacaoTexto = city;
                } else {
                  localizacaoTexto = r.formatted_address;
                }
              }
            }
          } catch (eGeo) {
            Logger.log("Erro ao reverter geocódigo: " + eGeo.message);
          }
        }

        // Monta o contexto do aparelho a ser injetado no prompt
        // Determina se a mensagem de voz necessita de dados de status ou localização
        var precisaStatus = /(bater[ií]a|carreg[aa]|wi-?fi|rede|status|aparelho|dispositivo|como\s+est[aá]\s+meu|som|silencioso)/i.test(msgVoz);
        // SÓ injeta contexto de rota/endereços quando há INTENÇÃO REAL de navegação (evita vazar a rota
        // do trabalho em pedidos que só mencionam "trabalho/casa" de passagem, ex.: "tênis pro trabalho").
        var precisaLoc = /(\brota\b|navegar|naveg[ae]|onde\s+estou|como\s+(ir|chegar)|me\s+lev[ae]|caminho\s+(para|at[eé])|dire[cç][õo]es|ir\s+para\s+(o\s+trabalho|a\s+casa|casa|o\s+servi[çc]o))/i.test(msgVoz);
        
        var contextLoc = '';
        if (precisaStatus || precisaLoc) {
          contextLoc = "\n\n[Contexto do Aparelho:";
          if (localizacaoTexto && precisaLoc) contextLoc += "\n- Localização atual (GPS): " + localizacaoTexto;
          
          function obterValorResolvido(str) {
            if (!str) return '';
            var partes = str.split('|');
            for (var i = 0; i < partes.length; i++) {
              var p = partes[i].trim();
              if (p && p.indexOf('[') === -1 && p.indexOf('{') === -1 && p !== 'null' && p !== '?' && p !== '<not_applicable>' && p !== 'unknown' && p !== '<unknown ssid>') {
                return p;
              }
            }
            return '';
          }
          
          var bat = obterValorResolvido(body.bateria_nivel || body.bateria);
          var charg = _telCarregando(body.carregando);   // true/false/null — "Ligar"/"Desligar" incluídos
          // volume_toque é o campo NOVO ([vol_ring], percentual); modo_som é o legado, mantido
          // para a macro antiga seguir funcionando até ser trocada. Medido em 22/09: o MacroDroid
          // NÃO expõe o modo de som como magic text — 16 nomes testados, todos literais, com
          // controles válidos na mesma requisição. Então `modo` fica null e a linha é omitida:
          // não há de onde tirar essa informação, e inventá-la foi o bug original.
          var som = _telModoSom(body.volume_toque !== undefined ? body.volume_toque : body.modo_som);
          var wifi = obterValorResolvido(body.wifi_nome || body.wifi);

          if (bat && precisaStatus) {
            contextLoc += "\n- Nível da Bateria: " + bat.replace('%', '') + "%";
          }
          // null = a telemetria não disse. Omite a linha em vez de afirmar "Não" por omissão.
          if (charg !== null && precisaStatus) {
            contextLoc += "\n- Carregando: " + (charg ? 'Sim' : 'Não');
          }
          if (precisaStatus && som.modo) {
            contextLoc += "\n- Modo de Som: " + som.modo;
          }
          if (precisaStatus && som.volume !== null) {
            contextLoc += "\n- Volume do toque: " + som.volume + "%";
          }
          if (wifi && precisaStatus) {
            contextLoc += "\n- Conectado ao Wi-Fi: " + wifi;
          }
          
          if (precisaLoc) {
            var casaEnd = _obterEnderecoDaWiki('Casa') || props.getProperty('CASA_ENDERECO');
            var trabEnd = _obterEnderecoDaWiki('Trabalho') || props.getProperty('TRABALHO_ENDERECO');
            contextLoc += "\n- Endereço de Casa salvo: " + casaEnd;
            contextLoc += "\n- Endereço de Trabalho salvo: " + trabEnd;
          }
          contextLoc += "]";
        }

        // Pega o uid do proprietário no Firestore para carregar/persistir o histórico
        var uid = null;
        try {
          var emailLower = String(emailUser || '').trim().toLowerCase();
          var emailDoc = Firestore.getDoc('emails', emailLower);
          if (emailDoc && emailDoc.uid) {
            uid = emailDoc.uid;
          }
        } catch (eUid) {
          Logger.log("[voice_command] Erro ao buscar uid: " + eUid.message);
        }

        // Carrega o histórico da conversa ativa mais recente
        var conversaId = null;
        var historico = [];
        if (uid) {
          try {
            var convs = Firestore.listDocs('usuarios/' + uid + '/conversas', 50);
            if (convs && convs.length > 0) {
              convs.sort(function (a, b) {
                return Number((b.dados || {}).atualizadoEm || 0) - Number((a.dados || {}).atualizadoEm || 0);
              });
              conversaId = convs[0].id;
              
              var colMsgs = 'usuarios/' + uid + '/conversas/' + conversaId + '/mensagens';
              var msgs = Firestore.listDocs(colMsgs, 100).map(function (m) {
                return { role: m.dados.role, text: m.dados.text, ts: Number(m.dados.ts || 0) };
              });
              msgs.sort(function (a, b) { return a.ts - b.ts; });
              
              // Corta por TEMPO antes de pegar os últimos 4: sem isso, um papo antigo (ex.:
              // sobre saldo, há 12h) "vaza" pra dentro de um pedido novo sem nenhuma relação —
              // bug real, visto em produção em 05/08 (pedido de "bom dia" às 06h respondido com
              // saldo do cartão, puxado de uma pergunta financeira da tarde anterior).
              var _JANELA_HIST_MS = 2 * 60 * 60 * 1000; // 2h: fora disso não é mais "a mesma conversa"
              var _agoraHist = Date.now();
              historico = msgs.filter(function (m) {
                return (_agoraHist - m.ts) <= _JANELA_HIST_MS;
              }).slice(-4).map(function (m) {
                return { role: m.role, text: m.text };
              }).filter(function (m) {
                return m.text && m.text.indexOf('[') !== 0 && m.text.indexOf('⚠️') !== 0;
              });
            }
          } catch (eHist) {
            Logger.log("[voice_command] Erro ao carregar histórico: " + eHist.message);
          }
        }

        // Adiciona a instrução para o Jarvis agir de forma conversacional e curta no áudio
        var instrucaoVoz = msgVoz + contextLoc + '\n\n[Interação por voz: responda direto e conversacional (2 a 4 frases). RESPONDA APENAS AO PEDIDO ATUAL (a última fala do usuário). O histórico é SÓ contexto — as ações/buscas/rotas de turnos ANTERIORES JÁ FORAM feitas; NUNCA as repita, re-execute ou mencione de novo na resposta atual (é ERRO grave misturar pedidos de turnos diferentes).\n'
          + 'AÇÃO NO CELULAR (OBRIGATÓRIO CHAMAR A FERRAMENTA): se o pedido for abrir um app, abrir configurações, tocar música, abrir um versículo, pesquisar em um app, navegar/rota ou QUALQUER ação no aparelho, você DEVE chamar a ferramenta controlarDispositivo NESTA MESMA resposta. NUNCA diga que abriu/executou/está abrindo algo sem ter chamado a ferramenta — isso é proibido.\n'
          + '  • SÓ ABRIR um app ("abra o WhatsApp", "abra o Bradesco", "abra o Telegram", "abra as Configurações", "abra a Bíblia Sagrada") → controlarDispositivo com acao:"abrirApp" e nome=<nome do app>.\n'
          + '  • ABRIR e AGIR ("abra o YouTube e pesquise X", "toque Y no Spotify", "abra a Bíblia no João 3:16") → controlarDispositivo com acao:"intent" (VIEW + intent_data deep-link + intent_package). Para músicas Spotify / vídeos YouTube use SEMPRE isto, nunca pesquisarWeb/pesquisarYouTube.\n'
          + '  • ROTA → controlarDispositivo acao:"navegar" (cite origem bairro/cidade e destino, conforme o Contexto do Aparelho).\n'
          + 'TELEMETRIA: NÃO mencione bateria, Wi-Fi nem modo de som por conta própria; só fale disso se o usuário PERGUNTAR explicitamente OU se a bateria estiver abaixo de 20%.]';
        // ATALHO DETERMINÍSTICO p/ "abra/abre o <app>" PURO: o modelo de voz (flash) às vezes só
        // responde "abrindo..." SEM chamar a ferramenta. Aqui chamamos controlarDispositivo DIRETO,
        // garantindo a abertura. Compostos (abrir+pesquisar/tocar/versículo/rota, "gmail e mostre…")
        // caem no LLM normalmente.
        var respVoz;
        // (i) VERSÍCULO DA BÍBLIA → YouVersion (determinístico; o modelo de voz às vezes não chama a tool).
        var _bib = _interpretarBiblia(msgVoz);
        // (ii) TOCAR MÚSICA → Spotify (determinístico; via abrirUrl/OpenWebPage, o caminho que funciona).
        var _spot = (function () {
          if (/youtube|no google|pesquis|liga(?:r)? para|vers[íi]culo|b[íi]blia/i.test(msgVoz)) return null;
          var m = msgVoz.trim().match(/^(?:toque|toquem|toc[ae]|toca(?:r)?|reproduz(?:a|ir)?|escut[ae](?:r)?|ouvir|ou[çc][ae]|p[oõ]e(?:r)?|coloca(?:r)?|bota(?:r)?)\s+(?:a (?:m[uú]sica|can[çc][aã]o|playlist)\s+|o (?:som|louvor|hino|[aá]lbum)\s+(?:de\s+)?|)(.+?)(?:\s+no spotify)?[\s\.!?]*$/i);
          return m ? m[1].trim() : null;
        })();
        // (iii) YOUTUBE e (iv) GOOGLE — busca determinística (via abrirUrl).
        var _yt = (msgVoz.match(/(?:pesquis\w*|procur\w*|busq\w*|abr\w*)\s+(?:por\s+|sobre\s+|o v[íi]deo\s+)?(.+?)\s+n[oa]\s+youtube/i) || msgVoz.match(/(?:no\s+)?youtube\s*,?\s*(?:e\s+)?(?:pesquis\w*|procur\w*|busq\w*)\s+(?:por\s+|sobre\s+)?(.+?)[\.\!\?]*$/i));
        var _gg = (msgVoz.match(/(?:pesquis\w*|procur\w*|busq\w*)\s+(?:por\s+|sobre\s+)?(.+?)\s+n[oa]\s+google/i) || msgVoz.match(/(?:pesquis\w*|procur\w*)\s+(?:por\s+|sobre\s+)?(.+?)\s+na\s+web/i));
        // (v) ROTA/NAVEGAÇÃO → ação "navegar" (determinístico; bypassa o LLM p/ não contaminar/errar).
        var _rota = (function () {
          var m = msgVoz.trim().match(/^(?:tra[çc]ar?\s+(?:a\s+)?rota|rota|navegue?|navegar|me\s+lev[ae]|como\s+(?:eu\s+)?(?:ir|chego|chegar))\s*(?:at[eé]|para|pro|pra|ao|no|na|em|a)?\s+(?:o |a |os |as )?(.+?)[\s\.!?]*$/i);
          if (!m) return null;
          var d = m[1].trim();
          if (/^(trabalho|servi[çc]o|firma|emprego)$/i.test(d)) d = 'Trabalho';
          else if (/^(casa|em casa|minha casa|lar)$/i.test(d)) d = 'Casa';
          return d;
        })();
        // (vi) COMPRAS (buscar produto numa loja) → abrirUrl (determinístico).
        var _loja = (function () {
          var m = msgVoz.match(/(?:pesquis\w*|procur\w*|busq\w*|compr\w*|ach[ae]\w*|quero)\s+(?:por\s+|um\s+|uma\s+|uns\s+|umas\s+|o\s+|a\s+)?(.+?)\s+n[oa]s?\s+(mercado\s*livre|mag(?:azine)?\s*luiza|magalu|amazon|americanas|shopee|aliexpress|casas\s*bahia)\b/i);
          if (!m) return null;
          var q = m[1].trim(), loja = m[2].toLowerCase().replace(/\s+/g, ' '), url;
          if (/mercado/.test(loja)) url = 'meli://search?query=' + encodeURIComponent(q);
          else if (/mag/.test(loja)) url = 'https://www.magazineluiza.com.br/busca/' + encodeURIComponent(q) + '/';
          else if (/amazon/.test(loja)) url = 'https://www.amazon.com.br/s?k=' + encodeURIComponent(q);
          else if (/americanas/.test(loja)) url = 'https://www.americanas.com.br/busca/' + encodeURIComponent(q);
          else if (/shopee/.test(loja)) url = 'https://shopee.com.br/search?keyword=' + encodeURIComponent(q);
          else if (/aliexpress/.test(loja)) url = 'https://pt.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(q);
          else if (/casas/.test(loja)) url = 'https://www.casasbahia.com.br/' + encodeURIComponent(q) + '/b';
          else return null;
          return { url: url, q: q, loja: m[2].trim() };
        })();
        // (vii) LIGAR por NÚMERO → discador (determinístico; só abre o discador, não liga sozinho).
        var _lig = (function () {
          var m = msgVoz.match(/^(?:lig(?:ue|a|ar)|telefon\w+|discar?|disca)\s+(?:para\s+|pro\s+|pra\s+|o\s+|a\s+|no\s+)?(.+?)[\s\.!?]*$/i);
          if (!m) return null;
          var num = m[1].replace(/[^\d]/g, '');
          return (num.length >= 8 && num.length <= 13) ? num : null; // só número; nome → LLM (buscarContato)
        })();
        // (ix) PODCAST DE CONHECIMENTO WIKI -> determinístico (Audio Overview)
        var _pod = (function () {
          var m = msgVoz.trim().match(/(?:ger[ae]|gerar|cri[ae]|criar|faz|fazer)\s+(?:um\s+)?podcast\s+(?:sobre\s+|do\s+|da\s+|de\s+)?(.+?)[\s\.!?]*$/i);
          if (!m) m = msgVoz.trim().match(/podcast\s+(?:sobre\s+|do\s+|da\s+|de\s+)?(.+?)[\s\.!?]*$/i);
          return m ? m[1].trim() : null;
        })();
        var _mAbrir = msgVoz.trim().match(/^(?:abr[ae]|abrir|inicie?|inicia|iniciar|lan[çc]a(?:r)?|lance)\s+(?:o |a |os |as |ao |meu |minha |app |aplicativo (?:d[oae] )?)*(.+?)[\s\.!?]*$/i);
        var _appNome = _mAbrir ? _mAbrir[1].trim() : '';
        var _acaoComposta = /(pesquis|busque|busca|toque|toca|reproduz|\d{1,3}\s*:\s*\d{1,3}|vers[ií]culo|cap[ií]tulo|salmo|rota|navegue|caminho|dire[cç]|conversa|mensagem|manda|envi[ae]|mostre|veja|leia|liga)/i.test(msgVoz);
        var _appSimples = _appNome && _appNome.split(/\s+/).length <= 4 && !/ (e|no|na|para|pra|com|que|sobre) /i.test(' ' + _appNome.toLowerCase() + ' ');
        // (viii) CONTROLES NATIVOS — mídia/volume/lanterna/não-perturbe (determinístico; macros nativas).
        var _ctl = (function () {
          var s2 = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (/\b(pausa\w*|pause)\b/.test(s2) || /\bpar[ae]\s+(a\s+)?(musica|som|midia|video)/.test(s2))
            return { args: { acao: 'midia', comando: 'pausar' }, resp: 'Pausando a mídia.' };
          if (/\b(continua\w*|retoma\w*|despausa\w*)\b/.test(s2) && /musica|som|midia|video|tocar|toca/.test(s2))
            return { args: { acao: 'midia', comando: 'pausar' }, resp: 'Retomando a mídia.' };
          if (/\b(proxima|prox)\s+(faixa|musica|cancao)\b/.test(s2) || /\bpul[ae]\s+(a\s+|essa\s+)?(faixa|musica)/.test(s2))
            return { args: { acao: 'midia', comando: 'proxima' }, resp: 'Próxima faixa.' };
          if (/\b(faixa|musica)\s+anterior\b/.test(s2) || /\banterior\s+(faixa|musica)\b/.test(s2) || /\bvolta\w*\s+(a\s+|uma\s+)?(faixa|musica)/.test(s2))
            return { args: { acao: 'midia', comando: 'anterior' }, resp: 'Voltando para a faixa anterior.' };
          if (/\bvolume\b/.test(s2) || /\b(silencia|muta|mudo)\b.*\b(celular|som|aparelho|telefone)?\b/.test(s2)) {
            var nvl = /mudo|silencia|muta|zero/.test(s2) ? 'mudo'
              : /baixo|fraco|diminu|abaixa|reduz/.test(s2) ? 'baixo'
              : /medio|metade/.test(s2) ? 'medio'
              : /alto|maximo|aumenta|sobe|cheio/.test(s2) ? 'alto' : null;
            var pct = s2.match(/\b(\d{1,3})\s*(?:%|por\s*cento)?\b/);
            if (!nvl && pct) nvl = Number(pct[1]) <= 5 ? 'mudo' : Number(pct[1]) <= 35 ? 'baixo' : Number(pct[1]) <= 70 ? 'medio' : 'alto';
            if (nvl && /\bvolume\b|silencia|muta|\bmudo\b/.test(s2))
              return { args: { acao: 'volume', nivel: nvl }, resp: 'Volume ' + (nvl === 'mudo' ? 'no mudo' : nvl) + '.' };
          }
          if (/\b(lanterna|flash\s*light)\b/.test(s2))
            return { args: { acao: 'lanterna' }, resp: 'Alternando a lanterna.' };
          if (/\b(nao\s+perturbe|dnd|modo\s+prioridade)\b/.test(s2)) {
            var offD = /desativ|deslig|tira|sai(a|r)?\s+do|remove|cancela/.test(s2);
            return { args: { acao: 'naoperturbe', estado: offD ? 'off' : 'on' }, resp: offD ? 'Não perturbe desativado.' : 'Não perturbe ativado.' };
          }
          return null;
        })();
        // (-3) RESPOSTA À OFERTA DE INSIGHT ("quer ouvir?" → "sim"). O atalho MAIS específico de
        // todos: só existe nos 20 min após a oferta. Sem isso, o "sim" cairia no LLM, que não faz
        // ideia do que ele está aceitando.
        // (-4) VOTO no insight ("gostei" / "não gostei"). Dentro de 30 min da entrega, o voto seco
        // basta — o contexto é óbvio. Depois disso exige citar "ideia/insight/sugestão", senão um
        // "gostei" sobre qualquer outra coisa viraria voto sem ele saber.
        var _voto = null;
        if (_insFeedbackAberto()) {
          var _sV = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          var _citou = /\b(ideia|insight|sugest|dica)/.test(_sV);
          if (_insDentroDaJanelaFeedback() || _citou) {
            if (/\b(gostei|boa|bom|otim|util|excelente|massa|top|curti|serviu)\b/.test(_sV) && !/\bnao\s+(gostei|serviu|curti)\b/.test(_sV)) _voto = 'up';
            else if (/\b(nao gostei|nao serviu|nao curti|ruim|inutil|pessim|fraco|obvio|irrelevante|besteira)\b/.test(_sV)) _voto = 'down';
          }
        }
        var _ofr = null;
        if (_voto === null && _insOfertaAberta()) {
          var _sOf = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          // Tira interjeição solta na frente ("Ok quero ouvir", "Ah então quero") — sem isso,
          // qualquer coisa antes do "sim/quero" quebrava o match e caía no LLM livre, que não
          // sabe da oferta pendente e inventa uma recusa (bug real, visto em produção em 05/08).
          var _FILLER_OFR_RE = /^(ok|okay|beleza|entao|bom|ta bom|ta|certo|e ai|eai|pois|bem|enfim|ah)[,.\s]+/;
          for (var _fiOfr = 0; _fiOfr < 3 && _FILLER_OFR_RE.test(_sOf); _fiOfr++) { _sOf = _sOf.replace(_FILLER_OFR_RE, ''); }
          if (/^(sim|claro|quero|manda|pode|pode mandar|bora|vai|conta|fala)\b/.test(_sOf)) _ofr = true;
          else if (/^(nao|agora nao|depois|deixa|passa|nem)\b/.test(_sOf)) _ofr = false;
        }
        // (-1) LEMBRETE CONDICIONAL ("quando eu chegar em casa, me lembre de X") — determinístico:
        // cria a fila de verdade, sem depender do LLM (que responderia "ok, vou lembrar" e não
        // criaria nada — a armadilha do falso sucesso). Quem dispara é a máquina de transições.
        // (0) ROTINA COMPOSTA ("modo cinema", "modo foco") — um comando → várias ações no aparelho.
        // As declarações vêm ANTES da cadeia: antes havia um `else` solto governando só um `var`,
        // então o `if (_lembC)` rodava sempre e o fim da cadeia sobrescrevia a resposta já montada.
        // (-2) "O QUE EU PERDI?" — resumo determinístico das notificações. Zero LLM: a resposta é
        // um fato, não uma opinião, e mandar isso pro modelo só adicionaria custo e risco de invenção.
        // (-3) HORA, DATA E AGENDA — fatos, sem LLM (ver _interpretarFatoVoz: "são 21:29" às 22:08 e
        // uma reunião inventada, ambos em 23/09). Vem antes de tudo e cala o resto da cadeia.
        var _fato = (_voto === null && _ofr === null) ? _interpretarFatoVoz(msgVoz) : null;
        var _perdi = (_voto === null && _ofr === null && _fato === null) ? _interpretarPerdi(msgVoz) : null;
        // (-1.5) SALDO/EXTRATO DO SWILE — determinístico. Número não passa pelo modelo.
        var _fin = (_voto === null && _ofr === null && _perdi === null) ? _interpretarFinanceiro(msgVoz) : null;
        var _trn = (_voto === null && _ofr === null && _perdi === null && _fin === null) ? _interpretarTurnoTrabalho(msgVoz) : null;
        var _insV = (_voto === null && _ofr === null && _perdi === null && _fin === null && _trn === null) ? _interpretarInsight(msgVoz) : null;
        var _livre = (_fato === null && _voto === null && _ofr === null && _perdi === null && _fin === null && _trn === null && _insV === null);
        var _viaJev = false;   // marcado se o roteamento semântico (JEV) atender no lugar do LLM
        var _notifPendentes = null;  // notificações do "o que eu perdi" AGUARDANDO confirmação de entrega
        var _lembC = _livre ? _interpretarLembreteCondicional(msgVoz) : null;
        var _rot   = (_livre && !_lembC) ? _interpretarRotina(msgVoz) : null;
        if (_fato !== null) {
          try { respVoz = (_fato.via === 'agenda') ? _falarAgenda(_fato.periodo) : _falarRelogio(_fato); }
          catch (eFt) { respVoz = 'Não consegui consultar isso agora.'; }
        } else if (_fin !== null) {
          try {
            if (_fin.tipo === 'gastos') {
              respVoz = _finFalarGastos(_fin.dias);
            } else if (_fin.tipo === 'definir') {
              var _rsd = definirSaldoFinanceiro({ voucher: _fin.voucher, mobilidade: _fin.mobilidade, origem: 'voz' });
              function _brV(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
              respVoz = _rsd.ok
                ? ('Saldo atualizado: ' +
                   [(_rsd.saldo.voucher !== null ? 'voucher, ' + _brV(_rsd.saldo.voucher) : null),
                    (_rsd.saldo.mobilidade !== null ? 'mobilidade, ' + _brV(_rsd.saldo.mobilidade) : null)]
                     .filter(Boolean).join('; e ') + '.')
                : ('Não consegui gravar o saldo: ' + (_rsd.erro || 'erro') + '.');
            } else {
              respVoz = _finFalarSaldo(_fin.carteira);
            }
          } catch (eFin) { respVoz = 'Não consegui consultar o saldo agora.'; }
        } else if (_trn !== null) {
          // Chama a MESMA função da ferramenta (definirTurno), que limpa os alertas antigos por tag
          // e cria os 4 do turno numa operação só — em vez de o modelo criar um a um.
          try {
            var _rt = definirTurnoTrabalho({ turno: _trn });
            respVoz = (_rt && _rt.ok) ? _rt.resumo : ('Não consegui trocar o turno: ' + ((_rt && _rt.erro) || 'erro') + '.');
          } catch (eTr) { respVoz = 'Não consegui trocar o turno agora.'; }
        } else if (_insV !== null) {
          try {
            if (_insV.acao === 'gravar') {
              var _rg = _insSalvarComoConceito();
              respVoz = _rg.ok
                ? ('Anotei na wiki, em ' + _rg.caminho + '.')
                : ('Não consegui anotar: ' + (_rg.erro || 'erro') + '.');
            } else {
              var _ip = _insightAtual();
              if (!_ip) { respVoz = 'Ainda não tenho uma ideia pronta hoje. Eu gero uma por dia, de manhã.'; }
              else {
                try { marcarInsightEntregue('voz'); } catch (eM) {}
                respVoz = _ip.insight + (_ip.acao ? ' Primeiro passo: ' + _ip.acao : '');
              }
            }
          } catch (eIn) { respVoz = 'Não consegui trazer a ideia agora.'; }
        } else if (_perdi !== null) {
          try {
            // NÃO marca aqui: só depois que a entrega se confirmar (ver _notifPendentes, abaixo).
            var _rp = resumirNotificacoes({ horas: 12, marcarLidas: false });
            respVoz = _rp.resumo;
            _notifPendentes = _rp.ids || [];
          } catch (eP2) { respVoz = 'Não consegui checar as notificações agora.'; }
        } else if (_voto !== null) {
          try {
            var _rv = registrarFeedbackInsight({ voto: _voto });
            respVoz = _rv.ok
              ? (_voto === 'up' ? 'Anotado, vou trazer mais sobre ' + _rv.categoria + '.'
                                : 'Anotado. Vou evitar esse assunto.')
              : 'Certo.';
          } catch (eV) { respVoz = 'Certo.'; }
        } else if (_ofr !== null) {
          try {
            respVoz = _responderOfertaInsight(_ofr) || 'Certo.';
          } catch (eOf) { respVoz = 'Certo.'; }
        } else if (_lembC) {
          try {
            var _rl = criarLembreteCondicional({ gatilho: _lembC.gatilho, texto: _lembC.texto });
            var _ondeL = _lembC.gatilho.indexOf('casa') !== -1 ? 'em casa' : 'no trabalho';
            var _quandoL = _lembC.gatilho.indexOf('chegou') === 0 ? 'chegar' : 'sair';
            respVoz = _rl.ok
              ? ('Combinado. Quando você ' + _quandoL + ' ' + _ondeL + ', eu te lembro de ' + _lembC.texto + '.')
              : ('Não consegui criar o lembrete: ' + (_rl.erro || 'erro') + '.');
          } catch (eLc) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_rot) {
          try {
            var _rr = executarRotina(_rot);
            respVoz = _rr.ok ? _rr.resposta : ('Não consegui executar o ' + (_rr.nome || _rot) + ' agora.');
          } catch (eRt) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_ctl && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            var _rCtl = Jarvis.controlarDispositivo(_ctl.args);
            respVoz = (_rCtl && _rCtl.status === 'success') ? _ctl.resp : ('Não consegui agora: ' + ((_rCtl && _rCtl.erro) || 'falha no envio ao celular') + '.');
          } catch (eCt) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_bib && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            if (_bib.falar && !_bib.ver) {
              // "leia Gálatas 5" = um capítulo inteiro; ler isso em voz alta seriam minutos de fala.
              // Abre no app e diz o que fez, em vez de despejar o capítulo.
              Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: _youversionUrl(_bib.usfm) });
              respVoz = 'Abri ' + _bib.ref + ' no YouVersion. Me diga o versículo se quiser que eu leia.';
            } else if (_bib.falar) {
              // BÍBLIA FALADA: o Jarvis LÊ o versículo em voz alta (respVoz é falada no celular) — vai
              // além de só abrir o app. Busca o texto (Almeida) na bible-api; fallback abre o YouVersion.
              var _bv = _lerVersiculoBiblia(_bib.code + '+' + _bib.cap + ':' + _bib.ver);
              if (_bv.ok) {
                respVoz = (_bv.ref || _bib.ref) + '. ' + _bv.texto;
              } else {
                Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: _youversionUrl(_bib.usfm) });
                respVoz = 'Não achei o texto de ' + _bib.ref + ' para ler, então abri no YouVersion.';
              }
            } else {
              Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: _youversionUrl(_bib.usfm) });
              respVoz = 'Abrindo a Bíblia em ' + _bib.ref + '.';
            }
          } catch (eBi) {
            respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false });
          }
        } else if (_spot && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'https://open.spotify.com/search/' + encodeURIComponent(_spot) });
            respVoz = 'Tocando ' + _spot + ' no Spotify.';
          } catch (eSp) {
            respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false });
          }
        } else if (_yt && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(_yt[1].trim()) });
            respVoz = 'Pesquisando ' + _yt[1].trim() + ' no YouTube.';
          } catch (eYt) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_gg && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'https://www.google.com/search?q=' + encodeURIComponent(_gg[1].trim()) });
            respVoz = 'Pesquisando ' + _gg[1].trim() + ' no Google.';
          } catch (eGg) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_rota && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'navegar', destino: _rota });
            respVoz = 'Traçando a rota para ' + _rota + '.';
          } catch (eRt) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_pod && typeof Jarvis !== 'undefined' && Jarvis.gerarPodcastWiki) {
          try {
            var _rPod = Jarvis.gerarPodcastWiki({ topico: _pod }, emailUser);
            if (_rPod && _rPod.status === 'success') {
              respVoz = _rPod.mensagem;
            } else {
              respVoz = 'Não consegui criar o podcast sobre ' + _pod + ': ' + ((_rPod && _rPod.erro) || 'erro desconhecido') + '.';
            }
          } catch (ePd) { respVoz = 'Erro ao gerar podcast: ' + ePd.message; }
        } else if (_loja && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: _loja.url });
            respVoz = 'Pesquisando ' + _loja.q + ' no ' + _loja.loja + '.';
          } catch (eLo) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_lig && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            // Único caminho confiável no MIUI = abrirUrl (OpenWebPage). O tel: é "web-ificado" (abre no
            // navegador), mas o navegador mostra o prompt "Ligar?" com o número → 1 toque e chama. abrirApp
            // (componente) é bloqueado pelo congelamento da MIUI; auto-discar exigiria ação nativa na macro.
            Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'tel:' + _lig });
            respVoz = 'Preparei a ligação para ' + _lig.replace(/(\d{2})(\d{4,5})(\d{4})/, '$1 $2-$3') + ' — é só tocar em Ligar.';
          } catch (eLi) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else if (_appNome && _appSimples && !_acaoComposta && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            var _rAb = Jarvis.controlarDispositivo({ acao: 'abrirApp', nome: _appNome });
            respVoz = (_rAb && _rAb.status === 'success')
              ? ('Abrindo ' + _appNome + ' para você.')
              : ('Não consegui abrir ' + _appNome + ' agora, Bruno.');
          } catch (eAb) {
            respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false });
          }
        } else {
          // A cadeia determinística inteira passou batido. ANTES de gastar 20-40 s no LLM, o JEV
          // tenta reconhecer a intenção e responder pelo handler determinístico. Null = ele não
          // reconheceu (ou ficou abaixo do limiar) → LLM, como sempre foi.
          var _sem = null;
          try { _sem = _rotaSemantica(msgVoz, emailUser, true); } catch (eSem) { _sem = null; }
          _viaJev = !!_sem;
          respVoz = _sem || Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false });
        }
        // QUAL ROTA ATENDEU. Sem isto não dá para saber, depois, se um pedido caiu num atalho
        // determinístico ou no LLM — que é exatamente a pergunta que apareceu em toda investigação
        // de bug de voz até aqui (em 13/08 um "o que eu perdi" não deixou vestígio nenhum).
        // A ordem espelha a cadeia if/else if acima; ao mexer lá, mexer aqui também.
        var _viaVoz =
            (_fato  !== null) ? _fato.via
          : (_fin   !== null) ? 'financeiro'
          : (_trn   !== null) ? 'turno'
          : (_insV  !== null) ? ('insight_' + _insV.acao)
          : (_perdi !== null) ? 'notificacoes'
          : (_voto  !== null) ? 'voto_insight'
          : (_ofr   !== null) ? 'oferta_insight'
          : _lembC             ? 'lembrete_condicional'
          : _rot               ? ('rotina:' + _rot)
          : _ctl               ? 'controle_nativo'
          : _bib               ? 'biblia'
          : _spot              ? 'spotify'
          : _yt                ? 'youtube'
          : _gg                ? 'google'
          : _rota              ? 'navegar'
          : _pod               ? 'podcast'
          : _loja              ? 'compras'
          : _lig               ? 'ligar'
          : (_appNome && _appSimples && !_acaoComposta) ? 'abrir_app'
          // 'jev' e 'llm' dividem o mesmo galho (a cadeia acima falhou); quem separa é _viaJev,
          // marcado logo onde o roteamento semântico atendeu. Sem isso os dois casos ficariam
          // indistinguíveis na telemetria — e a pergunta "o JEV está pegando o quê?" não teria dado.
          : (typeof _viaJev !== 'undefined' && _viaJev) ? 'jev'
          : 'llm';
        try {
          if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
            tool: 'voz:' + _viaVoz, ok: true, ms: 0, userEmail: emailUser,
            resumo: msgVoz.substring(0, 100) + ' → ' + String(respVoz).substring(0, 140)
          });
        } catch (eEvV) {}
        var textoLimpo = _prepararTextoFala(respVoz);
        
        // Persiste o turno da conversa por voz no Firestore para manter a continuidade do assunto
        if (uid) {
          try {
            conversaId = _persistirTurno(uid, conversaId, msgVoz, null, { resposta: respVoz });
          } catch (ePersist) {
            Logger.log("[voice_command] Erro ao persistir turno: " + ePersist.message);
          }
        }

        // Gera o áudio da resposta no Google Drive do usuário (ID estável) para download na macro.
        // body.falar='local' → a PRÓPRIA MACRO fala o texto via TTS do Android (resposta imediata);
        // nesse caso NÃO disparamos a voz premium (jarvis_falar), senão o celular fala DUAS vezes.
        var modoFalaVc = String(body.falar || '').toLowerCase();

        /* ONDE A RESPOSTA É FALADA — nuvem ou aparelho.
         * O caminho da nuvem custa 8–10 s: sintetizar (Gemini TTS), subir ~250 KB ao Drive, o
         * MacroDroid baixar e tocar. Vale a pena quando a resposta é do modelo — voz Iapetus,
         * texto longo. NÃO vale quando a resposta veio de um atalho determinístico: o texto já
         * estava pronto em milissegundos e o áudio é o único motivo da espera.
         *
         * MODO_FALA_VOZ (Script Property):
         *   nuvem (padrão) — sempre nuvem. Comportamento histórico, nada muda.
         *   auto           — atalho determinístico fala LOCAL (instantâneo); LLM vai pela nuvem.
         *   local          — nunca sintetiza; o aparelho fala tudo.
         *
         * PROTOCOLO com a macro: o corpo da resposta é O QUE O APARELHO DEVE FALAR.
         * Vazio = não fale nada (a nuvem já está cuidando). Assim a macro não precisa interpretar
         * cabeçalho nem marcador — só manda o corpo para o TTS do Android. Um texto que chega e um
         * áudio que toca ao mesmo tempo seria fala dobrada, e é isso que o vazio evita.
         * O padrão é `nuvem` de propósito: mudar para `auto` sem a macro falar localmente deixaria
         * as respostas determinísticas MUDAS. Os dois lados viram a chave juntos. */
        var _modoCfg = String(PropertiesService.getScriptProperties().getProperty('MODO_FALA_VOZ') || 'nuvem').toLowerCase();
        if (modoFalaVc === 'local' || modoFalaVc === 'nao') _modoCfg = modoFalaVc;   // a macro manda mais que a config

        /* QUAL ROTA FALA NO APARELHO — por NATUREZA da resposta, não por tamanho.
         * O critério anterior era "determinístico e curto", e estava no eixo errado: mandava o
         * INSIGHT (determinístico, 139 car.) para o TTS local, quando é exatamente o tipo de
         * resposta que o Bruno para para ouvir e quer na voz boa.
         *
         * O que decide é o papel da fala:
         *  · CONFIRMAÇÃO DE AÇÃO ('Abrindo o WhatsApp', 'Tocando X', 'Traçando a rota') — a nuvem
         *    não chega só atrasada, chega FORA DE SINCRONIA: o app já abriu há 8 s quando a voz
         *    avisa que vai abrir. Confirmação atrasada não confirma nada. Local é melhor, não
         *    apenas mais rápido.
         *  · DADO PONTUAL (saldo) — número curto, ele pergunta e segue. Velocidade vale mais.
         *  · CONTEÚDO (insight, resumo do que perdeu, resposta do modelo) — ele para e escuta.
         *    Aqui a Iapetus ganha de longe e os segundos não incomodam.
         *
         * Ajustável sem deploy pela property FALA_LOCAL_ROTAS (lista separada por vírgula).
         * O teto de caracteres continua como rede de segurança: resposta de ação que venha longa
         * (um extrato inteiro, por exemplo) volta para a nuvem. */
        var _ROTAS_LOCAIS_PADRAO = 'relogio,agenda,financeiro,turno,rotina,controle_nativo,abrir_app,spotify,youtube,google,navegar,compras,ligar,biblia,insight_gravar,voto_insight';
        var _rotasLocais = String(PropertiesService.getScriptProperties().getProperty('FALA_LOCAL_ROTAS') || _ROTAS_LOCAIS_PADRAO)
          .split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
        var _viaBase = String((typeof _viaVoz !== 'undefined') ? _viaVoz : '').split(':')[0];
        var _rotaEhLocal = _rotasLocais.indexOf(_viaBase) !== -1;
        var _curto = String(textoLimpo || '').length <= 240;
        var _falarLocal = (_modoCfg === 'local') || (_modoCfg === 'auto' && _rotaEhLocal && _curto);
        var _falarNuvem = (_modoCfg !== 'local' && _modoCfg !== 'nao' && !_falarLocal);

        // _falarNuvem/_falarLocal dizem a INTENÇÃO; _entregou diz o que de fato saiu. A distinção
        // existe porque o catch abaixo engole o erro de síntese: sem ela, uma falha de TTS ainda
        // contaria como entrega. Em 'local' a entrega É o texto no corpo (a macro fala); em
        // 'nuvem' só vale se a síntese confirmou.
        var _entregou = !!_falarLocal;
        if (_falarNuvem && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            var _rEnt = Jarvis.controlarDispositivo({ acao: 'falar', texto: textoLimpo });
            _entregou = !!(_rEnt && _rEnt.status === 'success');
          } catch (eCtrl) {
            Logger.log('Erro ao sintetizar áudio no Drive: ' + eCtrl.message);
          }
        }

        try {
          if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
            tool: 'voz:entrega:' + (_falarLocal ? 'local' : (_falarNuvem ? 'nuvem' : 'nenhuma')),
            ok: true, ms: 0, resumo: (typeof _viaVoz !== 'undefined' ? _viaVoz : '?') + ' · ' + String(textoLimpo).length + ' car.'
          });
        } catch (eEnt) {}

        /* CONSUMO DAS NOTIFICAÇÕES — aqui, e só aqui. Este é o primeiro ponto do fluxo em que
         * existe uma entrega de fato: ou o áudio foi sintetizado e está no Drive para a macro
         * tocar (nuvem), ou o texto vai no corpo para o aparelho falar (local). Enquanto nada
         * saiu, elas seguem não-lidas e a mesma pergunta devolve a mesma resposta — que é
         * exatamente o que faltava quando "o que eu perdi" apagou 5 notificações do Agenda Edu
         * sem nunca ter falado nada. Entrega 'nenhuma' NÃO consome. */
        if (_notifPendentes && _notifPendentes.length) {
          var _qtd = _entregou ? _notifMarcarLidas(_notifPendentes) : 0;
          try {
            if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
              tool: 'notif:consumidas', ok: _entregou, ms: 0,
              resumo: _entregou
                ? (_qtd + ' marcadas como lidas APÓS entrega (' + (_falarLocal ? 'local' : 'nuvem') + ')')
                : ('PRESERVADAS: ' + _notifPendentes.length + ' — a entrega falhou, seguem não-lidas')
            });
          } catch (eCm) {}
        }

        // Em modo nuvem devolve o texto (histórico: a macro usa para exibir). Em auto/local o corpo
        // É a fala — então vazio quando quem fala é a nuvem.
        var _corpo = (_modoCfg === 'nuvem') ? textoLimpo : (_falarLocal ? textoLimpo : '');
        return ContentService.createTextOutput(_corpo).setMimeType(ContentService.MimeType.TEXT);
      } catch (evError) {
        return ContentService.createTextOutput("Erro: " + evError.message).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    if (body && body.action === "ler_debug") {
      var tokDb = body.token || (e && e.parameter && e.parameter.token);
      var pDb = PropertiesService.getScriptProperties();
      var vtDb = pDb.getProperty('VOICE_API_TOKEN');
      if (tokDb !== vtDb) return ContentService.createTextOutput("Não autorizado").setMimeType(ContentService.MimeType.TEXT);
      try {
        // n = quantos eventos (padrão 30, teto 200). Com 30, uma investigação de redundância não
        // enxergava nem um dia inteiro — briefing, ponto e presença de manhã já ocupavam tudo.
        var nEv = Math.min(200, Math.max(1, Number(body.n) || 30));
        var telemetria = Firestore.listDocs('telemetria_dispositivo', 10);
        var eventos = Firestore.listDocs('agente_eventos', nEv);
        var saida = { telemetria: telemetria, eventos: eventos };
        // Opcionais, só leitura. Alertas: sem eles não dá para ver QUEM agenda cada fala repetida.
        // Notificações: o texto que de fato chegou, para distinguir corte da ORIGEM de corte nosso.
        if (body.alertas) { try { saida.alertas = (typeof AlertasVoz !== 'undefined') ? AlertasVoz.listar() : null; } catch (eA) { saida.alertas = { erro: eA.message }; } }
        if (body.notificacoes) { try { saida.notificacoes = Firestore.listDocs(_NOTIF_COL, Math.min(200, Number(body.notificacoes) || 40)); } catch (eN) { saida.notificacoes = { erro: eN.message }; } }
        return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
      } catch (errDb) {
        return ContentService.createTextOutput("Erro: " + errDb.message).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // (1.25) FALAR — toca um TEXTO LITERAL na voz premium do Jarvis (Gemini TTS) no celular,
    // SEM LLM e sem aspas aninhadas no body (feito p/ macros do MacroDroid: ler notificações,
    // avisos de bateria, etc.). POST { action:'falar', texto:'...', token: VOICE_API_TOKEN }.
    // Resposta text/plain 'OK' — a fala chega via webhook jarvis_falar (macro "Jarvis Falar").
    if (body && body.action === "falar") {
      var tokFl = body.token || (e && e.parameter && e.parameter.token);
      if (!tokFl) return ContentService.createTextOutput("Erro: Token ausente").setMimeType(ContentService.MimeType.TEXT);
      var pFl = PropertiesService.getScriptProperties();
      var voiceTokenFl = pFl.getProperty('VOICE_API_TOKEN');
      var okFl = false;
      if (voiceTokenFl && tokFl === voiceTokenFl) { okFl = true; }
      else { var suFl = getSessionUser(tokFl); if (suFl && Jarvis._isOwner(suFl.email)) { okFl = true; } }
      if (!okFl) return ContentService.createTextOutput("Erro: Não autorizado").setMimeType(ContentService.MimeType.TEXT);
      var textoFl = String(body.texto || body.text || body.mensagem || '').trim();
      // Guarda: remove "texto mágico" NÃO RESOLVIDO do MacroDroid ({not_title}, {lv=x}...) —
      // acontece quando a macro é disparada sem o contexto (ex.: teste por widget). Assim a voz
      // nunca fala os códigos literalmente.
      textoFl = textoFl.replace(/\{[a-z0-9_]+(=[^}]*)?\}/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,:;!?])/g, '$1').trim();
      if (!textoFl || /^[\s.,:;!?—-]*$/.test(textoFl)) return ContentService.createTextOutput("Erro: Texto ausente (os códigos {…} da macro não foram resolvidos — dispare pela notificação real, não pelo widget).").setMimeType(ContentService.MimeType.TEXT);
      if (textoFl.length > 1200) textoFl = textoFl.substring(0, 1200); // guarda de tamanho (TTS/custo)
      try {
        try { if (typeof _prepararTextoFala === 'function') textoFl = _prepararTextoFala(textoFl); } catch (ePf) {}
        var rFl = Jarvis.controlarDispositivo({ acao: 'falar', texto: textoFl });
        if (rFl && rFl.status === 'success') return ContentService.createTextOutput("OK: falando no celular.").setMimeType(ContentService.MimeType.TEXT);
        return ContentService.createTextOutput("Erro: " + ((rFl && rFl.erro) || 'falha ao falar')).setMimeType(ContentService.MimeType.TEXT);
      } catch (eFl) {
        return ContentService.createTextOutput("Erro: " + eFl.message).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // (1.26) BRIEFING — resumo do dia 100% DETERMINÍSTICO (zero LLM: turno, agenda, tarefas,
    // e-mails), falado na voz premium. Feito p/ macros de contexto do MacroDroid (ex.: "cheguei
    // em casa" = conectou no Wi-Fi). POST { action:'briefing', token, falar?:'nao'|'local', dedupe?:'chegada' }.
    // dedupe: a mesma etiqueta só fala 1x a cada 4h (re-conexões de Wi-Fi não repetem).
    if (body && body.action === "briefing") {
      var tokBf = body.token || (e && e.parameter && e.parameter.token);
      if (!tokBf) return ContentService.createTextOutput("Erro: Token ausente").setMimeType(ContentService.MimeType.TEXT);
      var pBf = PropertiesService.getScriptProperties();
      var vtBf = pBf.getProperty('VOICE_API_TOKEN');
      var okBf = false;
      if (vtBf && tokBf === vtBf) { okBf = true; }
      else { var suBf = getSessionUser(tokBf); if (suBf && Jarvis._isOwner(suBf.email)) { okBf = true; } }
      if (!okBf) return ContentService.createTextOutput("Erro: Não autorizado").setMimeType(ContentService.MimeType.TEXT);
      var dedupeBf = String(body.dedupe || '').trim();
      if (dedupeBf) {
        try {
          var ckBf = 'briefing_' + dedupeBf.replace(/\W+/g, '') + '_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
          var cBf = CacheService.getScriptCache();
          if (cBf.get(ckBf)) return ContentService.createTextOutput("OK: briefing já entregue hoje (dedupe '" + dedupeBf + "').").setMimeType(ContentService.MimeType.TEXT);
          cBf.put(ckBf, '1', 14400); // 4 horas
        } catch (eDBf) {}
      }
      try {
        var txtBf = _montarBriefingChegada();
        try { if (typeof _prepararTextoFala === 'function') txtBf = _prepararTextoFala(txtBf); } catch (ePBf) {}
        var modoBf = String(body.falar || '').toLowerCase();
        if (modoBf !== 'nao' && modoBf !== 'local' && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try { Jarvis.controlarDispositivo({ acao: 'falar', texto: txtBf }); } catch (eFBf) { Logger.log('[briefing] falar: ' + eFBf.message); }
        }
        return ContentService.createTextOutput(txtBf).setMimeType(ContentService.MimeType.TEXT);
      } catch (eBf) {
        return ContentService.createTextOutput("Erro: " + eBf.message).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // (1.3) VOICE_AUDIO — falar com o Jarvis por ÁUDIO, sem depender do reconhecimento de voz do
    // celular. MacroDroid grava o áudio e manda em base64; o JARVIS TRANSCREVE (Cloud Speech, cota
    // própria) → processa → responde. O áudio da resposta toca via jarvis_falar (macro "Jarvis Falar").
    // Devolve o TEXTO da resposta (p/ a notificação na macro). POST {action:'voice_audio', audio, mime?, token}.
    if (body && body.action === "voice_audio") {
      var tokVa = body.token || (e && e.parameter && e.parameter.token);
      if (!tokVa) return ContentService.createTextOutput("Erro: Token ausente").setMimeType(ContentService.MimeType.TEXT);
      var pVa = PropertiesService.getScriptProperties();
      var voiceTokenVa = pVa.getProperty('VOICE_API_TOKEN');
      if (!voiceTokenVa) { voiceTokenVa = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); pVa.setProperty('VOICE_API_TOKEN', voiceTokenVa); }
      var okVa = false, emailVa = '';
      if (tokVa === voiceTokenVa) { okVa = true; emailVa = pVa.getProperty('OWNER_EMAIL') || ''; }
      else { var suVa = getSessionUser(tokVa); if (suVa && Jarvis._isOwner(suVa.email)) { okVa = true; emailVa = suVa.email; } }
      if (!okVa) return ContentService.createTextOutput("Erro: Não autorizado").setMimeType(ContentService.MimeType.TEXT);
      var mimeVa = String(body.mime || body.mimeType || 'audio/ogg');
      var b64 = String(body.audio || body.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');  // tolera data-URI/quebras
      // Alternativa ao base64: MacroDroid sobe o áudio pro Drive (ação nativa) e manda só o fileId.
      if (!b64 && (body.driveId || body.fileId)) {
        try { var blVa = DriveApp.getFileById(String(body.driveId || body.fileId)).getBlob(); b64 = Utilities.base64Encode(blVa.getBytes()); if (!body.mime && !body.mimeType) mimeVa = blVa.getContentType() || mimeVa; }
        catch (eDrv) { return ContentService.createTextOutput("Erro: não li o áudio do Drive: " + eDrv.message).setMimeType(ContentService.MimeType.TEXT); }
      }
      if (!b64) return ContentService.createTextOutput("Erro: Áudio ausente (envie base64 em 'audio' OU o 'driveId').").setMimeType(ContentService.MimeType.TEXT);
      var nomeVa = String(body.nome || ('voz.' + ((mimeVa.split('/')[1] || 'ogg').replace('mpeg', 'mp3'))));
      try {
        var anexoVa = { tipo: 'inline', data: b64, mimeType: mimeVa, nome: nomeVa };
        var respVa = Jarvis.ask(emailVa, '', [], anexoVa, { interativo: false });
        var limpoVa = _prepararTextoFala(respVa);
        try { if (Jarvis.controlarDispositivo) Jarvis.controlarDispositivo({ acao: 'falar', texto: limpoVa }); } catch (eFc) { Logger.log('[voice_audio] falar: ' + eFc.message); }
        return ContentService.createTextOutput(limpoVa).setMimeType(ContentService.MimeType.TEXT);
      } catch (eVa) {
        return ContentService.createTextOutput("Erro: " + eVa.message).setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // (1.5) DISPATCHER de DIAGNÓSTICO (L4) — roda uma função de manutenção do TERMINAL, sem editor
    // e sem invadir o projeto (≠ ggsrun e1/e2). Lista branca + token dedicado (DIAG_TOKEN).
    if (body && body.run) {
      return json(_diagDispatch(body));
    }

    // (1.7) CHAT MOBILE — endpoint REST para o APP ANDROID do dono. POST {token, mensagem, historico?}.
    // Token dedicado MOBILE_API_TOKEN; roda como o DONO (Jarvis COMPLETO). Devolve { ok, resposta }.
    // Gated pelo token certo → se não bater, cai para o A2A abaixo (sem colisão).
    var mtok = PropertiesService.getScriptProperties().getProperty('MOBILE_API_TOKEN');
    if (mtok && body && body.token === mtok && (body.mensagem != null || body.message != null)) {
      var msgMob = String(body.mensagem || body.message || '');
      if (!msgMob.trim()) return json({ ok: false, erro: 'Campo "mensagem" é obrigatório.' });
      var dono = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
      if (!dono) return json({ ok: false, erro: 'OWNER_EMAIL não configurado.' });
      try {
        var respMob = Jarvis.ask(dono, msgMob, Array.isArray(body.historico) ? body.historico : [], null);
        return json({ ok: true, resposta: respMob });
      } catch (em) { return json({ ok: false, erro: em.message }); }
    }

    // (2) A2A (Agent-to-Agent)
    var token = body.token || (e && e.parameter && e.parameter.token);
    var esperado = PropertiesService.getScriptProperties().getProperty('A2A_API_TOKEN');
    if (!esperado) return json({ ok: false, error: 'A2A não configurado. Rode configurarA2A() no editor.' });
    if (!token || token !== esperado) return json({ ok: false, error: 'Não autorizado.' });

    var mensagem = body.message || body.mensagem || '';
    if (!mensagem || !String(mensagem).trim()) return json({ ok: false, error: 'Campo "message" é obrigatório.' });
    // P7.4 · cap mais apertado p/ o caminho EXTERNO (se o token vazar, limita o abuso/custo).
    if (!_rateLimit('post_a2a', 30, 60)) return json({ ok: false, error: 'Limite de requisições excedido.' });

    // Executa como agente externo (não-proprietário) → Jarvis somente leitura/conversa.
    var resposta = Jarvis.ask('a2a-agent@external', String(mensagem), body.historico || [], null);
    return json({ ok: true, agente: 'JARVIS', resposta: resposta });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

/** Gera e grava o A2A_API_TOKEN. Execute UMA VEZ no editor e guarde o token. */
function configurarA2A() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('A2A_API_TOKEN', token);
  Logger.log('✅ A2A_API_TOKEN gerado:\n' + token + '\n\nSistemas externos devem enviar este token no corpo do POST ao URL /exec.');
  return token;
}

/** Gera e grava o VOICE_API_TOKEN (rota de voz do MacroDroid). Execute no editor e guarde. */
function configurarVoiceToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('VOICE_API_TOKEN', token);
  Logger.log('✅ VOICE_API_TOKEN gerado:\n' + token +
    '\n\nInsira este token no campo "token" do corpo da Requisição HTTP no MacroDroid.');
  return token;
}

/** Gera e grava o MOBILE_API_TOKEN (rota de chat do app Android). Execute UMA VEZ no editor e guarde.
 *  O app envia POST ao /exec com { "token": "<MOBILE_API_TOKEN>", "mensagem": "..." } e recebe { ok, resposta }.
 *  Roda como o DONO (Jarvis completo). Trate o token como segredo (guarde no app, nunca no Git). */
function configurarMobileToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('MOBILE_API_TOKEN', token);
  Logger.log('✅ MOBILE_API_TOKEN gerado:\n' + token +
    '\n\nO app Android faz POST ao /exec:\n{ "token": "' + token + '", "mensagem": "Olá Jarvis" }\n→ resposta: { "ok": true, "resposta": "..." }');
  return token;
}

/**
 * Gestão ZERO-LLM da preferência do DONO em Firestore `preferencias/{OWNER_EMAIL}`.
 * Funciona mesmo no modo reserva (não depende do Gemini nem do loop do agente).
 * args: {} -> inspeciona itens atuais | {chave} -> remove a chave | {chave, valor} -> define.
 * Espelha exatamente a estrutura de _salvarPref/_removerPref do Jarvis.js (itens + atualizadoEm).
 */
function gerenciarPrefDono(args) {
  args = args || {};
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
  if (!email) return { ok: false, erro: 'OWNER_EMAIL ausente' };
  var d = Firestore.getDoc('preferencias', email) || {};
  var itens = (d && d.itens) ? d.itens : {};
  var chave = String(args.chave || '').trim().slice(0, 40);
  if (!chave) return { ok: true, acao: 'inspecionar', email: email, itens: itens };
  if (args.valor === undefined || args.valor === null || String(args.valor) === '') {
    var existia = (chave in itens);
    delete itens[chave];
    Firestore.setDoc('preferencias', email, { itens: itens, atualizadoEm: Date.now() });
    return { ok: true, acao: 'remover', chave: chave, removido: existia, itens: itens };
  }
  itens[chave] = String(args.valor).slice(0, 300);
  Firestore.setDoc('preferencias', email, { itens: itens, atualizadoEm: Date.now() });
  return { ok: true, acao: 'definir', chave: chave, valor: itens[chave], itens: itens };
}

/**
 * L4 · DIAGNÓSTICO somente-leitura das conversas salvas do DONO (revisão caso a caso).
 * NÃO modifica nada. args {} → lista TODAS as conversas (MAIS ANTIGA primeiro): {id, titulo, criadoEm, atualizadoEm}.
 * args {id} → mensagens completas dessa conversa: {role, text, ts, anexo}. args {idx} → idx-ésima mais antiga (1-based).
 */
function diagConversas(args) {
  args = args || {};
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
  var emailDoc = Firestore.getDoc('emails', email);
  var uid = (emailDoc && emailDoc.uid) ? emailDoc.uid : null;
  if (!uid) return { ok: false, erro: 'uid do dono não encontrado em emails/' + email };
  var base = 'usuarios/' + uid + '/conversas';

  var lista = Firestore.listDocs(base, 200).map(function (c) {
    var d = c.dados || {};
    return { id: c.id, titulo: d.titulo || '(sem título)', criadoEm: Number(d.criadoEm || d.atualizadoEm || 0), atualizadoEm: Number(d.atualizadoEm || 0) };
  });
  lista.sort(function (a, b) { return a.criadoEm - b.criadoEm; }); // MAIS ANTIGA primeiro

  var alvoId = args.id || null;
  if (!alvoId && args.idx) { var i = Number(args.idx) - 1; if (i >= 0 && i < lista.length) alvoId = lista[i].id; }
  if (!alvoId) return { ok: true, uid: uid, total: lista.length, conversas: lista };

  var meta = null;
  for (var k = 0; k < lista.length; k++) { if (lista[k].id === alvoId) { meta = lista[k]; break; } }
  var msgs = Firestore.listDocs(base + '/' + alvoId + '/mensagens', 1000).map(function (m) {
    var d = m.dados || {};
    return { role: d.role || '', text: String(d.text || ''), ts: Number(d.ts || 0), anexo: d.anexo || null };
  });
  msgs.sort(function (a, b) { return a.ts - b.ts; });
  return { ok: true, uid: uid, meta: meta, n: msgs.length, mensagens: msgs };
}

/* ===================== EXPLORADOR DE FIRESTORE (diag, somente-leitura) ===================== */
// Coleções-raiz que o app usa (levantadas do código). Subcoleções: usuarios/{uid}/conversas[/{cid}/mensagens].
var _FS_COLECOES_RAIZ = ['usuarios', 'emails', 'sessoes', 'telemetria_dispositivo', 'agente_eventos',
  'callbacks_interativos', 'feedback', 'preferencias', 'conversa_vetores', 'wiki_vetores', 'objetivos',
  'evals_log', 'registry_log'];

function _fsPreview(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (Array.isArray(v)) return '[array ' + v.length + ']';
  if (typeof v === 'object') return '{obj ' + Object.keys(v).length + ' campos}';
  return v;
}

/** Mapa do banco: para cada coleção-raiz, amostra de docs e primeiros ids. NÃO conta tudo (custo). */
function diagFsMapa() {
  var out = _FS_COLECOES_RAIZ.map(function (c) {
    try {
      var docs = Firestore.listDocs(c, 40);
      return { colecao: c, amostra: docs.length, atingiuTeto: docs.length >= 40, primeirosIds: docs.slice(0, 3).map(function (d) { return d.id; }) };
    } catch (e) { return { colecao: c, erro: String(e.message).slice(0, 80) }; }
  });
  return { database: 'firestore-gas', colecoes: out };
}

/** Lista docs de uma coleção/subcoleção (caminho completo p/ subcoleção). Retorna id + campos + preview. */
function diagFsListar(args) {
  args = args || {};
  var col = String(args.colecao || args.path || '').trim();
  if (!col) return { ok: false, erro: 'informe args.colecao (ex.: "emails" ou "usuarios/<uid>/conversas")' };
  var lim = Math.min(Number(args.limite) || 25, 300);
  try {
    var docs = Firestore.listDocs(col, lim);
    return { ok: true, colecao: col, total: docs.length, docs: docs.map(function (d) {
      var campos = Object.keys(d.dados || {});
      var prev = {}; campos.slice(0, 5).forEach(function (k) { prev[k] = _fsPreview(d.dados[k]); });
      return { id: d.id, campos: campos, preview: prev };
    }) };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/* ===================== ROTINAS COMPOSTAS (zero-LLM) =====================
 * Um comando → VÁRIAS ações no aparelho, em sequência. Determinístico (sem LLM = custo zero).
 * A ORDEM importa: quando a rotina fala, o "falar" vem ANTES de baixar/mutar o volume — senão o
 * áudio sai inaudível. Cada ação é tolerante a falha: se uma não vai, as outras seguem e o
 * resultado reporta ação por ação (útil porque o "naoperturbe" ainda depende de permissão no MIUI).
 */
var _ROTINAS = {
  cinema: {
    nome: 'Modo cinema',
    acoes: [ { acao: 'naoperturbe', estado: 'on' }, { acao: 'volume', nivel: 'mudo' }, { acao: 'brilho', nivel: 10 } ],
    resposta: 'Modo cinema ativado: não perturbe ligado, som no mudo e brilho baixo.'
  },
  cinema_off: {
    nome: 'Sair do modo cinema',
    acoes: [ { acao: 'naoperturbe', estado: 'off' }, { acao: 'volume', nivel: 'medio' }, { acao: 'brilho', nivel: 60 } ],
    resposta: 'Saindo do modo cinema: não perturbe desligado, som no médio e brilho normal.'
  },
  foco: {
    nome: 'Modo foco',
    acoes: [ { acao: 'naoperturbe', estado: 'on' }, { acao: 'volume', nivel: 'baixo' } ],
    resposta: 'Modo foco ativado: não perturbe ligado e som baixo.'
  },
  boa_noite: {
    nome: 'Rotina boa noite',
    acoes: [ { acao: 'falar', texto: 'Boa noite, Bruno. Vou silenciar o aparelho e baixar o brilho. Seus alertas de ponto continuam armados.' },
             { acao: 'naoperturbe', estado: 'on' }, { acao: 'volume', nivel: 'baixo' }, { acao: 'brilho', nivel: 10 } ],
    resposta: 'Rotina de boa noite executada: avisei, liguei o não perturbe, baixei som e brilho.'
  },
  bom_dia: {
    nome: 'Rotina bom dia',
    acoes: [ { acao: 'brilho', nivel: 80 }, { acao: 'volume', nivel: 'medio' }, { acao: 'naoperturbe', estado: 'off' },
             { acao: 'falar', texto: 'Bom dia, Bruno! Aparelho liberado: som e brilho normais, não perturbe desligado.' } ],
    resposta: 'Rotina de bom dia executada: brilho e som normais, não perturbe desligado.'
  }
};

/** Executa uma rotina composta. opts {simular:true} não toca no aparelho (só relata o plano). */
function executarRotina(nome, opts) {
  opts = opts || {};
  var r = _ROTINAS[nome];
  if (!r) return { ok: false, erro: 'Rotina desconhecida: "' + nome + '".', disponiveis: Object.keys(_ROTINAS) };
  var resultados = [];
  r.acoes.forEach(function (a) {
    if (opts.simular === true) { resultados.push({ acao: a.acao, status: 'simulado' }); return; }
    try {
      var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) ? Jarvis.controlarDispositivo(a) : null;
      resultados.push({ acao: a.acao, status: (res && res.status) || 'sem_resposta', erro: (res && res.erro) || undefined });
    } catch (e) { resultados.push({ acao: a.acao, status: 'error', erro: e.message }); }
  });
  var okN = resultados.filter(function (x) { return x.status === 'success' || x.status === 'simulado'; }).length;
  try {
    if (opts.simular !== true && typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
      Jarvis.registrarEvento({ tool: 'rotina:' + nome, ms: 0, ok: okN === r.acoes.length,
        resumo: r.nome + ' — ' + okN + '/' + r.acoes.length + ' ações OK' });
    }
  } catch (eL) {}
  return { ok: okN > 0, rotina: nome, nome: r.nome, resposta: r.resposta,
           executadas: okN + '/' + r.acoes.length, resultados: resultados };
}

/** Texto livre → nome da rotina. Exige "modo/rotina" explícito para NÃO sequestrar saudações
 *  ("bom dia" solto continua sendo cumprimento, não rotina — mesma armadilha mention-vs-use). */
function _interpretarRotina(texto) {
  var s = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  var desliga = /desativ|deslig|sair|encerra|para o modo|fim do/.test(s);
  if (/modo\s+cinema/.test(s)) return desliga ? 'cinema_off' : 'cinema';
  if (/modo\s+foco/.test(s)) return 'foco';
  if (/\b(rotina|modo)\s+(de\s+)?boa\s+noite/.test(s)) return 'boa_noite';
  if (/\b(rotina|modo)\s+(de\s+)?bom\s+dia/.test(s)) return 'bom_dia';
  return null;
}

/** Endpoint do painel (owner-gated) p/ os botões de rotina da guia Dispositivo. */
function executarRotinaUI(token, nome) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, erro: 'não autorizado' };
  return executarRotina(String(nome || ''));
}

/** Diag: lista as rotinas ou executa uma. args {nome, simular:false p/ valer de verdade}. */
function diagRotina(args) {
  args = args || {};
  if (!args.nome) {
    return { ok: true, rotinas: Object.keys(_ROTINAS).map(function (k) {
      return { chave: k, nome: _ROTINAS[k].nome, acoes: _ROTINAS[k].acoes.map(function (a) { return a.acao; }) }; }) };
  }
  return executarRotina(String(args.nome), { simular: args.simular !== false });
}

/* ===================== CURADORIA · COLETOR DE TEMAS (zero-LLM) =====================
 * Descobre SOBRE O QUE o dono se importa — sem lista hardcoded. A fonte é o segundo cérebro dele:
 * o que ele escreveu/ingeriu É o mapa dos interesses. Peça 1 de 4 da curadoria (temas → geração →
 * entrega contextual → feedback).
 *
 * ATALHO DE CUSTO: em vez de varrer o Drive, lê `wiki_vetores` (o índice semântico já existente),
 * que guarda `caminho` + `ord` por trecho. Uma consulta dá a LISTA de páginas E o PESO (quantos
 * trechos = quanto ele escreveu sobre aquilo) + a recência.
 *
 * Sinais e pesos:
 *  · categoria da pasta — concepts/use-cases valem mais que sources (escrita deliberada > material ingerido)
 *  · volume — nº de trechos daquela página
 *  · recência — mexido nos últimos 30 dias pesa mais
 *  · objetivos ATIVOS — o que ele está perseguindo agora entra no topo
 */
var _CUR_PESO_CATEGORIA = { 'concepts': 1.0, 'use-cases': 0.95, 'best-practices': 0.85, 'prompts': 0.7,
                            'entities': 0.7, 'skills': 0.5, 'sources': 0.4, 'raw': 0.2, '(raiz)': 0.6 };

// EXTRAS do coletor: arquivos de config de agente/repositório que o `ehMetaArquivoWiki` canônico
// (Semantica.js) ainda não cobre. A lista compartilhada mora LÁ — aqui só o que é específico da
// curadoria, para as duas não divergirem.
var _CUR_META_EXTRA = /^(gemini|claude|agents?|indice|sumario|sumário|todo|licen[cç]a|license|_.*)$/i;

function _curEhMeta(arquivo) {
  var base = String(arquivo || '').replace(/\.md$/i, '').trim();
  if (typeof ehMetaArquivoWiki === 'function' && ehMetaArquivoWiki(base + '.md')) return true;
  return _CUR_META_EXTRA.test(base);
}

/** "concepts/rag-memoria-cumulativa.md" → {categoria:'concepts', tema:'rag memoria cumulativa'} */
function _curCaminhoParaTema(caminho) {
  var partes = String(caminho || '').split('/');
  var arquivo = partes.pop() || '';
  var categoria = partes.length ? partes[partes.length - 1] : '(raiz)';
  var base = arquivo.replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[_-]?/, '')       // tira prefixo de data das páginas de fonte
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { categoria: categoria, tema: base, meta: _curEhMeta(arquivo) };
}

/** Coleta e RANQUEIA os temas do segundo cérebro + objetivos ativos. args {limite, semCache}. */
function coletarTemas(args) {
  args = args || {};
  var limite = Math.min(Number(args.limite) || 20, 60);
  var p = PropertiesService.getScriptProperties();

  // cache de 12h (o mapa de interesses não muda de hora em hora)
  if (args.semCache !== true) {
    try {
      var ts = Number(p.getProperty('CURADORIA_TEMAS_TS') || 0);
      if (ts && (Date.now() - ts) < 12 * 3600000) {
        var cache = JSON.parse(p.getProperty('CURADORIA_TEMAS') || '[]');
        if (cache.length) return { ok: true, deCache: true, geradoEm: new Date(ts).toISOString(),
                                   total: cache.length, temas: cache.slice(0, limite) };
      }
    } catch (e) {}
  }

  var agora = Date.now(), porCaminho = {};
  try {
    var docs = Firestore.listDocs('wiki_vetores', 1000);
    (docs || []).forEach(function (d) {
      var dd = d.dados || {};
      var c = String(dd.caminho || '');
      if (!c) return;
      if (!porCaminho[c]) porCaminho[c] = { trechos: 0, atualizadoEm: 0 };
      porCaminho[c].trechos++;
      var at = Number(dd.atualizadoEm || 0);
      if (at > porCaminho[c].atualizadoEm) porCaminho[c].atualizadoEm = at;
    });
  } catch (eV) { return { ok: false, erro: 'Falha ao ler wiki_vetores: ' + eV.message }; }

  var descartados = 0;
  var pesosFb = _curPesosLer();          // multiplicadores aprendidos pelo 👍/👎 (lidos 1x)
  var temas = Object.keys(porCaminho).map(function (c) {
    var info = porCaminho[c], meta = _curCaminhoParaTema(c);
    if (meta.meta || !meta.tema) { descartados++; return null; }
    var pesoCat = _CUR_PESO_CATEGORIA[meta.categoria] !== undefined ? _CUR_PESO_CATEGORIA[meta.categoria] : 0.5;
    var vol = Math.min(info.trechos / 5, 1);                                  // satura em 5 trechos
    var dias = info.atualizadoEm ? (agora - info.atualizadoEm) / 86400000 : 999;
    var rec = dias <= 30 ? (1 - dias / 60) : 0;                               // até +0,5 p/ recém-mexido
    var fb = _curFatorFeedback(pesosFb, meta.categoria, c);
    return { tema: meta.tema, categoria: meta.categoria, caminho: c, trechos: info.trechos,
             diasSemMexer: Math.round(dias), fonte: 'segundo-cerebro', feedback: Number(fb.toFixed(2)),
             peso: Number((pesoCat * (0.5 + 0.5 * vol) * (1 + rec) * fb).toFixed(3)) };
  }).filter(function (t) { return t; });

  // Objetivos ATIVOS entram no topo — é o que ele está perseguindo AGORA.
  try {
    var objs = Firestore.listDocs('objetivos', 50) || [];
    objs.forEach(function (o) {
      var d = o.dados || {};
      if (String(d.status || '') === 'concluido') return;
      var txt = String(d.objetivo || '').trim();
      if (!txt) return;
      var fbO = _curFatorFeedback(pesosFb, 'objetivo', 'objetivos/' + o.id);
      temas.push({ tema: txt.substring(0, 90), categoria: 'objetivo', caminho: 'objetivos/' + o.id,
                   trechos: 0, diasSemMexer: d.atualizadoEm ? Math.round((agora - Number(d.atualizadoEm)) / 86400000) : null,
                   fonte: 'objetivo-ativo', feedback: Number(fbO.toFixed(2)),
                   peso: Number((1.6 * fbO).toFixed(3)) });
    });
  } catch (eO) {}

  temas.sort(function (a, b) { return b.peso - a.peso; });
  try {
    p.setProperty('CURADORIA_TEMAS', JSON.stringify(temas.slice(0, 60)));
    p.setProperty('CURADORIA_TEMAS_TS', String(agora));
  } catch (eP) {}
  return { ok: true, deCache: false, total: temas.length, descartadosMeta: descartados, temas: temas.slice(0, limite),
           resumoPorCategoria: temas.reduce(function (acc, t) { acc[t.categoria] = (acc[t.categoria] || 0) + 1; return acc; }, {}) };
}

/** Sorteia O TEMA DO DIA. args {semRegistrar}.
 * Pegar sempre "o topo" faria o Jarvis repetir a mesma categoria pra sempre (o ranking empata muito:
 * o segundo cérebro foi indexado de uma vez, então recência não separa nada). Sorteio PONDERADO pelo
 * peso mantém a preferência pelo que importa e ainda gira o assunto; o histórico dos 15 últimos
 * bloqueia repetição, e a categoria do último bloqueia dois dias seguidos no mesmo balde. */
function sortearTema(args) {
  args = args || {};
  var col = coletarTemas({ limite: 60 });
  if (!col.ok) return col;
  var p = PropertiesService.getScriptProperties();
  var hist = [];
  try { hist = JSON.parse(p.getProperty('CURADORIA_HISTORICO') || '[]'); } catch (e) {}
  var recentes = hist.slice(0, 15).map(function (h) { return h.caminho; });
  var ultimaCat = hist.length ? hist[0].categoria : null;

  var pool = col.temas.filter(function (t) { return recentes.indexOf(t.caminho) === -1; });
  if (!pool.length) pool = col.temas;                                    // esgotou: recomeça o ciclo
  var variado = pool.filter(function (t) { return t.categoria !== ultimaCat; });
  if (variado.length >= 3) pool = variado;                               // só varia se sobrar escolha

  var soma = pool.reduce(function (s, t) { return s + t.peso; }, 0);
  var r = Math.random() * soma, escolhido = pool[pool.length - 1];
  for (var i = 0; i < pool.length; i++) { r -= pool[i].peso; if (r <= 0) { escolhido = pool[i]; break; } }

  if (args.semRegistrar !== true) {
    hist.unshift({ caminho: escolhido.caminho, categoria: escolhido.categoria, em: Date.now() });
    try { p.setProperty('CURADORIA_HISTORICO', JSON.stringify(hist.slice(0, 30))); } catch (e2) {}
  }
  return { ok: true, tema: escolhido, candidatos: pool.length, totalTemas: col.total,
           evitadosPorRepeticao: col.temas.length - pool.length };
}

/** Diag do coletor: {limite, semCache} | {sortear:true} | {historico:true} | {limparHistorico:true}. */
function diagTemas(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limparHistorico) { p.deleteProperty('CURADORIA_HISTORICO'); return { ok: true, limpo: true }; }
  if (args.historico) { var h = []; try { h = JSON.parse(p.getProperty('CURADORIA_HISTORICO') || '[]'); } catch (e) {} return { ok: true, historico: h }; }
  if (args.sortear) return sortearTema(args);
  return coletarTemas(args);
}

/* ===================== INSIGHT DIÁRIO (curadoria) =====================
 * UMA chamada de LLM por dia. O tema sai do `sortearTema()` (o mundo dele, não a internet); o
 * contexto sai do que ELE JÁ ESCREVEU sobre aquilo (busca semântica na wiki). Sem esse contexto o
 * modelo devolveria um artigo genérico de blog — com ele, devolve algo em cima das notas dele.
 *
 * O insight NÃO é falado aqui. Ele fica PENDENTE; a entrega (próxima fatia) decide quando vale
 * interromper. Separar geração de entrega é o que permite gerar de madrugada e entregar quando ele
 * chegar em casa — e o que impede o job de virar mais uma notificação no meio do turno.
 */
var _INS_KEY = 'CURADORIA_INSIGHT';        // insight pendente/último (objeto)
var _INS_DIA = 'CURADORIA_INSIGHT_DIA';    // 'YYYY-MM-DD' do último gerado (teto de 1/dia)

function _insHoje() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function _insSlug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // escape explicito (range literal fica invisivel no fonte)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60) || 'insight';
}

// HOMÓGLIFOS: o modelo às vezes solta letra CIRÍLICA/GREGA no lugar da latina idêntica ("Versiоnamento"
// com о U+043E). Passa despercebido na tela, mas quebra busca, dedup e slug (vira hífen no nome do
// arquivo). Troca pelo latino equivalente e remove os invisíveis. NÃO toca em acento português.
var _INS_HOMO_DE = 'аеорсухіѕј' +
                   'АВЕКМНОРСТУХЅІЈ' +
                   'ονρ' +
                   'ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ';
var _INS_HOMO_PARA = 'aeopcyxisj' +
                     'ABEKMHOPCTYXSIJ' +
                     'ovp' +
                     'ABEZHIKMNOPTYX';

function _insLimpar(s) {
  var t = String(s || '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')     // zero-width
    .replace(/\u00a0/g, ' ');                  // NBSP
  var saida = '';
  for (var i = 0; i < t.length; i++) {
    var idx = _INS_HOMO_DE.indexOf(t.charAt(i));
    saida += (idx === -1) ? t.charAt(i) : _INS_HOMO_PARA.charAt(idx);
  }
  return saida.trim();
}

/** Trechos que o dono já escreveu sobre o tema — o insight tem que nascer daqui. */
function _insContexto(tema) {
  var trechos = [];
  try {
    var res = (typeof Semantica !== 'undefined' && Semantica.buscar) ? (Semantica.buscar(tema, 5) || []) : [];
    res.forEach(function (r) {
      var t = String(r.texto || r.trecho || '').trim();
      if (t) trechos.push({ de: String(r.caminho || r.pagina || '?'), texto: t.substring(0, 900) });
    });
  } catch (e) { Logger.log('[Insight] contexto: ' + e.message); }
  return trechos;
}

var _INS_SYS =
  'Você é o Jarvis, assistente pessoal do Bruno — desenvolvedor solo que construiu dois sistemas em ' +
  'Google Apps Script: o JARVIS (este assistente: voz, automação do Android, RAG, agentes) e o SGT — ' +
  'Sistema de Gerenciamento de Transportes (ERP de transportadora: CT-e, motoristas, programação, chat com IA).\n' +
  'Tarefa: a partir do TEMA e dos TRECHOS DAS NOTAS DELE, devolva UMA ideia que valha o tempo dele.\n' +
  'Regras:\n' +
  '· Parta do que ele JÁ escreveu. Não repita nem resuma as notas — avance a partir delas.\n' +
  '· UMA ideia só, concreta e aplicável ao Jarvis ou ao SGT. Nada de lista de possibilidades.\n' +
  '· Se a ideia não puder virar algo que ele faça nesta semana, escolha outro ângulo do mesmo tema.\n' +
  '· Sem elogio, sem introdução, sem "que tal". Vá direto.\n' +
  '· ANTES de propor, confira o INVENTÁRIO DE FERRAMENTAS JÁ IMPLEMENTADAS (se vier no prompt). Se a ' +
  'ideia já existe implementada lá, NÃO a proponha como novidade — ou fale do que FALTA além do que já ' +
  'existe, ou escolha outro ângulo do mesmo tema. Proponha do zero algo já pronto é o pior tipo de erro aqui.\n' +
  '· `insight` será FALADO em voz alta: no máximo 45 palavras, português coloquial, sem markdown.\n' +
  'Responda SÓ com JSON: {"titulo","insight","porque","acao"} — `porque` = por que isso importa pra ' +
  'ele agora (1 frase); `acao` = o primeiro passo concreto (1 frase, começando com verbo).';

// Fonte de verdade do que JÁ EXISTE nos dois projetos (Jarvis + SGT) — gerada a partir do CÓDIGO
// real, não da wiki. O GAS não tem acesso ao disco local, então esta página é publicada por fora
// (Claude, com acesso aos .js reais) e o insight diário só a LÊ. Cache de 6h: evita reler a wiki
// toda vez que o job roda, e a lista muda pouco (só quando ferramentas novas entram nos projetos).
var _INS_INVENTARIO_CAMINHO = 'inventario-ferramentas.md';
function _insInventarioFerramentas() {
  var ck = 'ins_inventario_v1';
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(ck);
    if (hit !== null) return hit;
  } catch (e) {}
  var texto = '';
  try {
    var pag = WikiMemoryService.lerWiki(_INS_INVENTARIO_CAMINHO);
    texto = String((pag && (pag.conteudo || pag.texto)) || pag || '');
  } catch (eR) {}
  try { CacheService.getScriptCache().put(ck, texto, 21600); } catch (e2) {}  // 6h
  return texto;
}

/** Publica/atualiza inventario-ferramentas.md na wiki (Drive). args {conteudo} obrigatorio.
 *  Fonte de verdade vem de FORA do GAS (Claude lendo o código real) — este diag só grava o que
 *  já foi extraído. Limpa o cache de 6h para o próximo insight já ler a versão nova.
 */
function diagPublicarInventarioFerramentas(args) {
  args = args || {};
  var conteudo = String(args.conteudo || '');
  if (!conteudo || conteudo.length < 100) return { ok: false, erro: 'args.conteudo vazio ou curto demais' };
  try {
    var r = WikiMemoryService.escreverWiki(_INS_INVENTARIO_CAMINHO, conteudo);
    try { CacheService.getScriptCache().remove('ins_inventario_v1'); } catch (eC) {}
    return { ok: r.status === 'success', resultado: r, tamanho: conteudo.length };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Gera o insight do dia. args {forcar, tema, semSalvar}. */
function gerarInsightDiario(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var hoje = _insHoje();

  if (!args.forcar && p.getProperty(_INS_DIA) === hoje) {
    return { ok: true, pulado: 'ja-gerado-hoje', dia: hoje, insight: _insightAtual() };
  }

  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(10000)) return { ok: false, erro: 'outro job de insight em execução' }; }
  catch (eL) {}

  try {
    var tema;
    if (args.tema) {
      tema = { tema: String(args.tema), categoria: 'manual', caminho: 'manual/' + _insSlug(args.tema), peso: 1 };
    } else {
      var s = sortearTema({});
      if (!s.ok) return s;
      tema = s.tema;
    }

    var ctx = _insContexto(tema.tema);
    if (!ctx.length && tema.caminho && /\.md$/i.test(tema.caminho)) {
      // A busca semântica pode falhar (quota de embeddings). Cai para a página inteira.
      try {
        var pag = WikiMemoryService.lerWiki(tema.caminho);
        var corpo = String((pag && (pag.conteudo || pag.texto)) || pag || '');
        if (corpo && corpo.length > 40) ctx.push({ de: tema.caminho, texto: corpo.substring(0, 3000) });
      } catch (eR) {}
    }
    if (!ctx.length) return { ok: false, erro: 'sem contexto para o tema "' + tema.tema + '" (wiki vazia ou busca indisponível)' };

    var _inv = _insInventarioFerramentas();
    var prompt = 'TEMA: ' + tema.tema + '  (pasta: ' + tema.categoria + ')\n\n' +
      'TRECHOS DAS NOTAS DELE:\n' +
      ctx.map(function (c, i) { return (i + 1) + ') [' + c.de + ']\n' + c.texto; }).join('\n\n') +
      (_inv ? '\n\nINVENTÁRIO DE FERRAMENTAS JÁ IMPLEMENTADAS (código real — confira antes de propor):\n' + _inv.substring(0, 40000) : '');

    var r = Gemini.gerar({
      systemInstruction: { parts: [{ text: _INS_SYS }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85, responseMimeType: 'application/json' },
      _thinking: 'low'
    });

    var bruto = '';
    try { bruto = r.json.candidates[0].content.parts.map(function (x) { return x.text || ''; }).join(''); } catch (eT) {}
    var obj = null;
    try { obj = JSON.parse(bruto); } catch (eJ) {
      var m = bruto.match(/\{[\s\S]*\}/);
      if (m) { try { obj = JSON.parse(m[0]); } catch (eJ2) {} }
    }
    if (!obj || !obj.insight) return { ok: false, erro: 'resposta não-JSON do modelo', bruto: String(bruto).substring(0, 300) };

    var insight = {
      id: Utilities.getUuid().split('-')[0],
      dia: hoje, criadoEm: Date.now(),
      tema: tema.tema, categoria: tema.categoria, caminhoTema: tema.caminho,
      titulo: _insLimpar(obj.titulo || tema.tema),
      insight: _insLimpar(obj.insight),
      porque: _insLimpar(obj.porque),
      acao: _insLimpar(obj.acao),
      fontes: ctx.map(function (c) { return c.de; }).filter(function (v, i, a) { return a.indexOf(v) === i; }),
      modelo: r.model, tier: r.tier,
      status: 'pendente', feedback: null, entregueEm: null
    };

    if (args.semSalvar !== true) {
      insight.wiki = _insArquivar(insight);
      try { p.setProperty(_INS_KEY, JSON.stringify(insight)); p.setProperty(_INS_DIA, hoje); } catch (eP) {}
    }
    return { ok: true, insight: insight };
  } catch (e) {
    return { ok: false, erro: e.message };
  } finally {
    try { lock.releaseLock(); } catch (eU) {}
  }
}

/** Arquiva no segundo cérebro. O valor da curadoria é cumulativo: em um ano são ~365 páginas
 *  ligadas às notas de origem — e o próprio índice semântico passa a indexá-las. */
function _insArquivar(ins) {
  try {
    var caminho = 'insights/' + ins.dia + '-' + _insSlug(ins.titulo) + '.md';
    var md = '# ' + ins.titulo + '\n\n' +
      '> Insight gerado pelo Jarvis em ' + ins.dia + ' · tema: **' + ins.tema + '** (' + ins.categoria + ')\n\n' +
      ins.insight + '\n\n' +
      (ins.porque ? '**Por que agora:** ' + ins.porque + '\n\n' : '') +
      (ins.acao ? '**Primeiro passo:** ' + ins.acao + '\n\n' : '') +
      '---\n\nBaseado em:\n' + ins.fontes.map(function (f) { return '- ' + f; }).join('\n') + '\n';
    WikiMemoryService.escreverWiki(caminho, md);
    return caminho;
  } catch (e) { Logger.log('[Insight] arquivar: ' + e.message); return null; }
}

function _insightAtual() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_INS_KEY) || 'null'); }
  catch (e) { return null; }
}

/** O insight ainda NÃO entregue (usado pela camada de entrega). */
function insightPendente() {
  var i = _insightAtual();
  return (i && i.status === 'pendente') ? i : null;
}

/** Marca como entregue (chamado pela camada de entrega). */
function marcarInsightEntregue(canal) {
  var i = _insightAtual(); if (!i) return null;
  i.status = 'entregue'; i.entregueEm = Date.now(); i.canal = canal || '?';
  try { PropertiesService.getScriptProperties().setProperty(_INS_KEY, JSON.stringify(i)); } catch (e) {}
  try { CacheService.getScriptCache().put('INS_FEEDBACK_ABERTO', i.id, 1800); } catch (e2) {}  // 30 min
  return i;
}

/* ===================== FEEDBACK 👍/👎 DA CURADORIA =====================
 * O coletor sabe SOBRE O QUE ele escreveu — não sabe o que ele quer OUVIR. O voto é o único
 * sinal que separa as duas coisas. Ajusta DOIS níveis:
 *   · CATEGORIA — aprende rápido (poucos baldes, muito sinal por voto): "prompts nunca rende".
 *   · TEMA      — impede insistir num assunto específico que já deu errado.
 * Multiplicativo e LIMITADO a [0,25 … 3]: um dia ruim não mata uma categoria para sempre, e um
 * elogio não faz o Jarvis falar do mesmo assunto pelo resto do ano. Um 👎 também joga o tema no
 * histórico de sorteio, tirando-o do páreo pelas próximas 15 rodadas.
 */
var _CUR_PESOS = 'CURADORIA_PESOS';
var _FB_MIN = 0.25, _FB_MAX = 3.0;
// O voto é sobre UM insight. Atribuí-lo inteiro à categoria generaliza demais a partir de n=1:
// no teste, um 👎 sozinho varreu as 65 páginas de `concepts` do topo. Então o TEMA leva o golpe
// cheio (é o que ele rejeitou) e a CATEGORIA se move devagar, precisando de votos repetidos e
// consistentes para mudar de patamar (~5 votos no mesmo sentido para chegar a 0,5×).
var _FB_UP = 1.35, _FB_DOWN = 0.6;            // tema
var _FB_UP_CAT = 1.12, _FB_DOWN_CAT = 0.88;   // categoria

function _curPesosLer() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_CUR_PESOS) || '{}') || {}; }
  catch (e) { return {}; }
}
function _curLimitar(v) { return Math.max(_FB_MIN, Math.min(_FB_MAX, Number(v) || 1)); }

/** Multiplicador aprendido de um tema (categoria × tema). `pesos` vem pronto p/ não reler a property. */
function _curFatorFeedback(pesos, categoria, caminho) {
  var pc = Number(pesos['cat:' + categoria]);   if (!isFinite(pc) || pc <= 0) pc = 1;
  var pt = Number(pesos['tema:' + caminho]);    if (!isFinite(pt) || pt <= 0) pt = 1;
  return pc * pt;
}

/** Registra o voto no ÚLTIMO insight entregue. args {voto:'up'|'down'}. */
function registrarFeedbackInsight(args) {
  args = args || {};
  var v = String(args.voto || '').toLowerCase().trim();
  var up   = /^(up|\+|1|s|sim|gostei|bom|boa|otim|util|excelente|massa|top)/.test(v);
  var down = /^(down|-|0|n|nao|ruim|inutil|pessim|fraco|obvio|irrelevante)/.test(v);
  if (!up && !down) return { ok: false, erro: 'voto inválido — use up ou down' };

  var ins = _insightAtual();
  if (!ins) return { ok: false, erro: 'nenhum insight para avaliar' };
  if (ins.status !== 'entregue') return { ok: false, erro: 'o insight ainda não foi entregue' };
  if (ins.feedback) return { ok: false, erro: 'esse insight já foi avaliado', feedback: ins.feedback };

  var p = PropertiesService.getScriptProperties();
  var pesos = _curPesosLer();
  var kCat = 'cat:' + ins.categoria, kTema = 'tema:' + ins.caminhoTema;
  pesos[kCat]  = _curLimitar((Number(pesos[kCat])  || 1) * (up ? _FB_UP_CAT : _FB_DOWN_CAT));
  pesos[kTema] = _curLimitar((Number(pesos[kTema]) || 1) * (up ? _FB_UP     : _FB_DOWN));
  try { p.setProperty(_CUR_PESOS, JSON.stringify(pesos)); } catch (e) {}

  ins.feedback = up ? 'up' : 'down';
  ins.feedbackEm = Date.now();
  try { p.setProperty(_INS_KEY, JSON.stringify(ins)); } catch (e2) {}
  try { p.deleteProperty('CURADORIA_TEMAS_TS'); } catch (e3) {}   // pesos mudaram → ranking obsoleto
  try { CacheService.getScriptCache().remove('INS_FEEDBACK_ABERTO'); } catch (e4) {}

  // 👎: além do peso, tira este tema do sorteio pelas próximas rodadas.
  if (!up) {
    try {
      var hist = JSON.parse(p.getProperty('CURADORIA_HISTORICO') || '[]');
      hist.unshift({ caminho: ins.caminhoTema, categoria: ins.categoria, em: Date.now(), via: 'feedback' });
      p.setProperty('CURADORIA_HISTORICO', JSON.stringify(hist.slice(0, 30)));
    } catch (e5) {}
  }
  return { ok: true, voto: ins.feedback, tema: ins.tema, categoria: ins.categoria,
           pesoCategoria: pesos[kCat], pesoTema: pesos[kTema] };
}

/** Há um insight entregue esperando voto? (janela de 30 min p/ aceitar "gostei" sozinho) */
function _insFeedbackAberto() {
  var ins = _insightAtual();
  if (!ins || ins.status !== 'entregue' || ins.feedback) return null;
  return ins;
}
function _insDentroDaJanelaFeedback() {
  try { return CacheService.getScriptCache().get('INS_FEEDBACK_ABERTO') === (_insightAtual() || {}).id; }
  catch (e) { return false; }
}

/** Diag: {} estado · {voto} vota · {limparPesos:true}. */
function diagFeedbackCuradoria(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limparPesos) { p.deleteProperty(_CUR_PESOS); p.deleteProperty('CURADORIA_TEMAS_TS'); return { ok: true, limpo: true }; }
  if (args.voto) return registrarFeedbackInsight(args);
  var ins = _insightAtual() || {};
  return { ok: true, pesos: _curPesosLer(), aguardandoVoto: !!_insFeedbackAberto(),
           janelaAberta: _insDentroDaJanelaFeedback(),
           ultimoInsight: { id: ins.id, tema: ins.tema, categoria: ins.categoria,
                            status: ins.status, feedback: ins.feedback || null } };
}

/* ── ENTREGA CONTEXTUAL ────────────────────────────────────────────────────────────────
 * Gerar é barato; INTERROMPER é caro. A entrega não segue a transição "chegou em casa": no turno
 * da tarde (14:00–23:00) ele chega em casa ~23:40, dentro do silêncio noturno — a oferta nunca
 * sairia. O que vale é o ESTADO: em casa + fora do turno. No turno da tarde isso é a manhã dele;
 * no da manhã, a noite. Avaliado a cada telemetria (15 min), não só na transição.
 *
 * E é OFERTA, não despejo: "tenho uma ideia sobre X, quer ouvir?". Se ele ignorar, custou 7
 * palavras; o insight continua pendente para o próximo dia. O "não" é sinal de feedback.
 */
var _INS_OFERTA = 'insight_oferta';   // chave de cache da oferta aguardando resposta

/** Fora do expediente? Deriva dos alertas de ponto (mesma fonte do briefing) — não hardcoda turno. */
function _insForaDoTurno() {
  try {
    if (typeof AlertasVoz === 'undefined' || !AlertasVoz.listar) return true;
    var agora = new Date(), dow = agora.getDay(), min = agora.getHours() * 60 + agora.getMinutes();
    var pts = AlertasVoz.listar().filter(function (a) {
      if (a.tag !== 'ponto') return false;
      var dias = Array.isArray(a.dias) ? a.dias : String(a.dias || '').split(',').map(Number);
      return dias.indexOf(dow) !== -1;
    }).map(function (a) { return Number(a.hora) * 60 + Number(a.minuto || 0); })
      .sort(function (x, y) { return x - y; });
    if (!pts.length) return true;                       // sem ponto hoje (fim de semana) = livre
    return min < pts[0] || min > pts[pts.length - 1];
  } catch (e) { return true; }
}

/** Presença atual, lida do snapshot da máquina de transições (fonte única). */
function _insLocalAtual() {
  try {
    var s = JSON.parse(PropertiesService.getScriptProperties().getProperty('PROATIVO_SNAPSHOT') || '{}');
    return s.local || 'desconhecido';
  } catch (e) { return 'desconhecido'; }
}

/** Decide se OFERECE o insight agora. args {local, simular}. */
function _avaliarEntregaInsight(local, opts) {
  opts = opts || {};
  var ins = insightPendente();
  if (!ins) return { ofereceu: false, motivo: 'sem insight pendente' };
  if (local !== 'casa') return { ofereceu: false, motivo: 'não está em casa (' + local + ')' };
  if (!_insForaDoTurno()) return { ofereceu: false, motivo: 'dentro do expediente' };

  var texto = 'Bruno, tenho uma ideia sobre ' + ins.tema + '. Quer ouvir?';
  // cooldown longo: no máximo 1 oferta a cada 8h, e o orçamento diário de interrupções ainda manda.
  var r = _falarProativo(_INS_OFERTA, texto, { cooldownMin: 480, simular: opts.simular });
  if (r.falou !== true && r.falou !== 'simulado') {
    return { ofereceu: false, motivo: r.bloqueado || 'falha ao falar' };
  }
  if (!opts.simular) {
    try { CacheService.getScriptCache().put('INS_OFERTA_ID', ins.id, 1200); } catch (e) {}  // 20 min
  }
  return { ofereceu: true, texto: texto, insightId: ins.id };
}

/** Há uma oferta aguardando "sim"? */
function _insOfertaAberta() {
  try {
    var id = CacheService.getScriptCache().get('INS_OFERTA_ID');
    if (!id) return null;
    var ins = _insightAtual();
    return (ins && ins.id === id && ins.status === 'pendente') ? ins : null;
  } catch (e) { return null; }
}

/** Responde ao "sim"/"não" da oferta. Devolve a fala, ou null se não havia oferta aberta. */
function _responderOfertaInsight(aceitou) {
  var ins = _insOfertaAberta();
  if (!ins) return null;
  try { CacheService.getScriptCache().remove('INS_OFERTA_ID'); } catch (e) {}
  if (!aceitou) {
    // "não" agora ≠ ideia ruim. Continua pendente; só não insiste hoje.
    return 'Sem problema. Guardei para depois.';
  }
  marcarInsightEntregue('voz');
  return ins.insight + (ins.acao ? ' Primeiro passo: ' + ins.acao : '');
}

/** Diag da entrega: {} decisão agora | {simular:false} entrega de verdade | {responder:'sim'|'nao'}. */
function diagEntregaInsight(args) {
  args = args || {};
  if (args.responder) {
    var fala = _responderOfertaInsight(/^(s|sim|quero|manda|pode)/i.test(String(args.responder)));
    return { ok: true, tinhaOferta: fala !== null, fala: fala };
  }
  var local = args.local || _insLocalAtual();
  return { ok: true, local: local, foraDoTurno: _insForaDoTurno(),
           pendente: !!insightPendente(), ofertaAberta: !!_insOfertaAberta(),
           decisao: _avaliarEntregaInsight(local, { simular: args.simular !== false }) };
}

/** Handler do gatilho diário. */
function jobInsightDiario() {
  try { if (typeof Heartbeat !== 'undefined' && Heartbeat.bater) Heartbeat.bater('insight'); } catch (e) {}
  var r = gerarInsightDiario({});
  Logger.log('[Insight] ' + JSON.stringify(r).substring(0, 400));
  return r;
}

/** Liga/desliga o gatilho diário. args {hora (0-23, padrão 5), desligar}. */
function configurarInsightDiario(args) {
  args = args || {};
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'jobInsightDiario') { try { ScriptApp.deleteTrigger(t); removidos++; } catch (e) {} }
  });
  if (args.desligar) return { ok: true, ligado: false, removidos: removidos };
  var hora = Math.min(Math.max(Number(args.hora !== undefined ? args.hora : 5), 0), 23);
  ScriptApp.newTrigger('jobInsightDiario').timeBased().everyDays(1).atHour(hora).create();
  try { PropertiesService.getScriptProperties().setProperty('CURADORIA_HORA', String(hora)); } catch (e) {}
  return { ok: true, ligado: true, hora: hora, removidos: removidos };
}

/** Diag: {} status | {gerar:true[,forcar,tema]} | {limpar:true}. */
function diagInsight(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limpar) { p.deleteProperty(_INS_KEY); p.deleteProperty(_INS_DIA); return { ok: true, limpo: true }; }
  if (args.gerar) return gerarInsightDiario(args);
  var trigs = [];
  try {
    trigs = ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getHandlerFunction() === 'jobInsightDiario'; })
      .map(function (t) { return t.getHandlerFunction(); });
  } catch (e) {}
  return { ok: true, dia: p.getProperty(_INS_DIA) || null, hoje: _insHoje(),
           horaConfigurada: p.getProperty('CURADORIA_HORA') || null,
           gatilhoAtivo: trigs.length > 0, atual: _insightAtual() };
}


/* ===================== NOTIFICAÇÕES DO CELULAR (percepção) =====================
 * A macro "Jarvis Notificações Premium" JÁ escuta as notificações do aparelho — o gatilho
 * NotificationTrigger funciona e está filtrado por app. O que faltava não era capacidade, era
 * DESTINO: ela chamava action=falar, então o Jarvis falava e esquecia. Aqui ele passa a LEMBRAR,
 * e com isso responde "o que eu perdi?" e ganha um gatilho proativo com conteúdo de verdade.
 *
 * Princípios (notificação é volume alto e conteúdo sensível):
 *   · a macro filtra por app NO APARELHO; NOTIF_APPS é uma 2ª barreira no servidor (opcional)
 *   · retenção curta e teto diário — isto não é um arquivo permanente da vida dele
 *   · PERCEBER ≠ FALAR: por padrão só guarda; falar exige falar=1 (ou app em NOTIF_FALAR_APPS)
 */
var _NOTIF_COL = 'notificacoes';
var _NOTIF_RETENCAO_DIAS = 7;
var _NOTIF_MAX_DIA = 200;

function _notifTxt(v) {
  var t = String(v === undefined || v === null ? '' : v).trim();
  // Magic text não substituído chega literalmente como "{not_ticker}" — já nos mordeu na telemetria.
  if (/^\{[a-z_]+\}$/i.test(t)) return '';
  return t.replace(/\s+/g, ' ').substring(0, 400);
}

/* O QUE UMA NOTIFICAÇÃO FALA — fonte única para os quatro caminhos que falam notificação
 * (registro direto, regra, triagem JEV e escalonamento). Antes cada um montava a frase do seu
 * jeito, e nenhum sabia lidar com texto cortado.
 *
 * O CORTE VEM DA ORIGEM, NÃO DAQUI. Conferido por adb em 23/09: o Agenda Edu entrega
 * "Informamos que o(a) aluno(a) FULANA L..." tanto em android.text quanto em android.bigText —
 * a versão EXPANDIDA já chega truncada. O texto completo só existe dentro do app. Nenhuma macro
 * recupera o que não foi enviado. O Jarvis lia a frase como veio e parava no meio do nome.
 *
 * O que dá para fazer é falar algo ÚTIL com o que chegou:
 *  - reticência COLADA numa palavra ("L...") é corte no meio da palavra: some a palavra pela
 *    metade e a reticência. Reticência com espaço antes é estilo do app: some só a reticência.
 *  - catraca da escola: o que um responsável precisa é QUEM e QUANDO. O nome sai do texto e o
 *    horário é o de chegada da notificação (segundos depois da catraca). NÃO diz se foi entrada
 *    ou saída: o título é genérico ("Entrada - Saída") e o texto que diria foi cortado — inferir
 *    pelo horário seria afirmar o que não se sabe, sobre uma criança.
 *  - demais cortes: avisa que o resto está no app, em vez de terminar a frase no vazio. */
function _notifCorpoFalavel(titulo, texto, em) {
  var t = String(titulo || '').trim();
  var x = String(texto || '').trim();
  var cortado = false;
  if (/\S(\.\.\.|…)$/.test(x)) { x = x.replace(/\s*\S*(\.\.\.|…)$/, '').trim(); cortado = true; }
  else if (/\s(\.\.\.|…)$/.test(x)) { x = x.replace(/\s*(\.\.\.|…)$/, '').trim(); cortado = true; }

  if (/catraca/i.test(t)) {
    var nome = (x.match(/alun[oa]\s*\(?[oa]?\)?\s+([A-Za-zÀ-ÿ]{2,})/) || [])[1];
    var hora = '';
    try { if (em) hora = Utilities.formatDate(new Date(Number(em)), 'America/Sao_Paulo', 'HH:mm'); } catch (eH) {}
    if (nome) {
      nome = nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
      return 'Catraca da escola: ' + nome + (hora ? ', às ' + hora : '') + '.';
    }
  }
  var corpo = t + (x ? (t ? '. ' : '') + x : '');
  if (cortado) corpo += '. O restante está no aplicativo.';
  return corpo;
}

function _notifListaProp(chave) {
  var v = String(PropertiesService.getScriptProperties().getProperty(chave) || '').trim();
  if (!v) return [];
  return v.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

/** O app está numa lista? Casa por nome OU pacote, por substring (o nome varia de aparelho). */
function _notifNaLista(lista, app, pacote) {
  if (!lista.length) return null;                       // lista vazia = "não opinar"
  var a = String(app || '').toLowerCase(), p = String(pacote || '').toLowerCase();
  for (var i = 0; i < lista.length; i++) {
    if ((a && a.indexOf(lista[i]) !== -1) || (p && p.indexOf(lista[i]) !== -1)) return true;
  }
  return false;
}

/** Grava uma notificação recebida do aparelho. Devolve o que foi feito e por quê. */
function registrarNotificacao(d) {
  d = d || {};
  var app = _notifTxt(d.app), pacote = _notifTxt(d.pacote);
  var titulo = _notifTxt(d.titulo), texto = _notifTxt(d.texto);
  if (!app && !titulo && !texto) return { ok: false, erro: 'notificação vazia' };

  var p = PropertiesService.getScriptProperties();
  // 2ª barreira: se NOTIF_APPS estiver configurado, só passa quem está nela.
  var permitido = _notifNaLista(_notifListaProp('NOTIF_APPS'), app, pacote);
  if (permitido === false) return { ok: true, ignorado: 'app fora do NOTIF_APPS', app: app };

  // REGRA `ignorar` é BARREIRA DE ENTRADA, não de ação: precisa rodar ANTES da gravação. Antes eu
  // avaliava as regras só depois do setDoc — então bloquear mensageiros impedia o Jarvis de AGIR,
  // mas o conteúdo (nome de grupo, remetente) continuava indo parar no banco. Para dado de
  // terceiro, isso não serve: o certo é nem entrar.
  var regrasEntrada = _notifRegras();
  for (var ri = 0; ri < regrasEntrada.length; ri++) {
    if (!_notifRegraCasa(regrasEntrada[ri], app, pacote, titulo, texto)) continue;
    if (String(regrasEntrada[ri].acao || '').toLowerCase() === 'ignorar') {
      return { ok: true, ignorado: 'regra ' + regrasEntrada[ri].id, guardado: false, app: app };
    }
    break;                                  // primeira regra que casa decide; não é ignorar → segue
  }

  // Teto diário — um app em loop não pode encher a coleção.
  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  var cont = (p.getProperty('NOTIF_DIA') === hoje) ? Number(p.getProperty('NOTIF_CONT') || 0) : 0;
  if (cont >= _NOTIF_MAX_DIA) return { ok: true, ignorado: 'teto diário (' + _NOTIF_MAX_DIA + ')' };

  // Dedup curto: mesma app+título em 5 min é repique, não fato novo.
  // O TEXTO entra na chave: o Swile usa sempre o mesmo titulo ('Compra aprovada'), entao
  // duas compras em menos de 5 min eram tratadas como repique e a segunda sumia.
  var chaveDup = 'ntf_' + _notifHash(app + '|' + titulo + '|' + texto);
  try {
    var ck = CacheService.getScriptCache();
    if (ck.get(chaveDup)) return { ok: true, ignorado: 'duplicada (5 min)', app: app };
    ck.put(chaveDup, '1', 300);
  } catch (eC) {}

  var agora = Date.now();
  var doc = { app: app, pacote: pacote, titulo: titulo, texto: texto,
              em: agora, dia: hoje, lida: false };
  try {
    Firestore.setDoc(_NOTIF_COL, String(1e13 - agora) + '_' + Math.floor(Math.random() * 1000), doc);
  } catch (eF) { return { ok: false, erro: 'Firestore: ' + eF.message }; }
  try { p.setProperty('NOTIF_DIA', hoje); p.setProperty('NOTIF_CONT', String(cont + 1)); } catch (eP) {}

  // FALAR é opt-in: falar=1 na macro, ou app listado em NOTIF_FALAR_APPS.
  var querFalar = (String(d.falar || '') === '1' || d.falar === true) ||
                  (_notifNaLista(_notifListaProp('NOTIF_FALAR_APPS'), app, pacote) === true);
  var falou = null;
  if (querFalar && _notifPodeFalar()) {
    var fala = 'Notificação do ' + (app || 'celular') + '. ' + _notifCorpoFalavel(titulo, texto, agora);
    try {
      var r = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
        ? Jarvis.controlarDispositivo({ acao: 'falar', texto: fala }) : null;
      falou = !!(r && r.status === 'success');
    } catch (eV) { falou = false; }
  }
  // Arma a cobrança de ponto na primeira notificação que vier do app de ponto.
  try {
    var _ap = String(p.getProperty('PONTO_APP') || 'sisponto').toLowerCase();
    if ((app + ' ' + pacote).toLowerCase().indexOf(_ap) !== -1) p.setProperty('PONTO_APP_VISTO', String(Date.now()));
  } catch (eA) {}

  // REGRAS: guardar não é agir. A primeira regra que casar decide o que fazer com isto.
  var acaoRegra = null;
  try { acaoRegra = _notifAplicarRegras(doc); } catch (eR) { acaoRegra = { erro: eR.message }; }
  return { ok: true, guardado: true, app: app, titulo: titulo, falou: falou, noDia: cont + 1, regra: acaoRegra };
}

/* A janela de fala saiu da MACRO para cá. Na macro, a restrição 06:00–20:00 ficava no nível do
 * macro inteiro: fora dela o aparelho nem CAPTURAVA a notificação. Com a rota nova isso está errado
 * — perceber deve ser 24h (senão "o que eu perdi?" perde justamente a madrugada), e só a FALA tem
 * hora. Property NOTIF_FALAR_JANELA, padrão idêntico ao que ele já usava. */
function _notifPodeFalar() {
  var j = String(PropertiesService.getScriptProperties().getProperty('NOTIF_FALAR_JANELA') || '06:00-20:00');
  var m = j.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return !_dentroDoSilencio();
  var d = new Date(), atual = d.getHours() * 60 + d.getMinutes();
  var ini = Number(m[1]) * 60 + Number(m[2]), fim = Number(m[3]) * 60 + Number(m[4]);
  return (ini <= fim) ? (atual >= ini && atual < fim) : (atual >= ini || atual < fim);
}

function _notifHash(s) {
  var h = 0; s = String(s);
  for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Lê as notificações guardadas, mais recentes primeiro, já podando as vencidas. */
function _notifLer(limite) {
  var docs = [];
  try { docs = Firestore.listDocs(_NOTIF_COL, 500) || []; } catch (e) { return []; }
  var corte = Date.now() - _NOTIF_RETENCAO_DIAS * 86400000;
  var vivas = [], mortas = [];
  docs.forEach(function (x) {
    var d = x.dados || {};
    if (Number(d.em || 0) < corte) mortas.push(x.id); else vivas.push({ id: x.id, d: d });
  });
  // poda preguiçosa: retenção curta é requisito, não enfeite
  mortas.slice(0, 30).forEach(function (id) { try { Firestore.deleteDoc(_NOTIF_COL, id); } catch (e2) {} });
  vivas.sort(function (a, b) { return Number(b.d.em || 0) - Number(a.d.em || 0); });
  return vivas.slice(0, limite || 50);
}

/** "O que eu perdi?" — resumo determinístico (zero LLM, custo zero). args {horas, marcarLidas}. */
function resumirNotificacoes(args) {
  args = args || {};
  var horas = Number(args.horas || 12);
  var desde = Date.now() - horas * 3600000;
  var lista = _notifLer(200).filter(function (n) {
    return Number(n.d.em || 0) >= desde && (args.todas === true || n.d.lida !== true);
  });
  if (!lista.length) {
    return { ok: true, total: 0, horas: horas, resumo: 'Nada de novo nas últimas ' + horas + ' horas.' };
  }
  var porApp = {};
  lista.forEach(function (n) {
    var a = n.d.app || 'desconhecido';
    if (!porApp[a]) porApp[a] = [];
    porApp[a].push(n.d);
  });
  var partes = Object.keys(porApp).map(function (a) {
    var itens = porApp[a];
    var amostra = itens.slice(0, 2).map(function (i) { return i.titulo || i.texto; })
                       .filter(Boolean).join('; ');
    return itens.length === 1 ? (a + ': ' + amostra)
                              : (a + ' (' + itens.length + '): ' + amostra);
  });
  if (args.marcarLidas === true) {
    _notifMarcarLidas(lista.map(function (n) { return n.id; }));
  }
  return { ok: true, total: lista.length, horas: horas, apps: Object.keys(porApp).length,
           resumo: 'Nas últimas ' + horas + ' horas: ' + partes.join('. ') + '.',
           // IDs para quem quer marcar como lida SÓ DEPOIS de entregar (ver _notifMarcarLidas).
           ids: lista.map(function (n) { return n.id; }),
           itens: lista.map(function (n) {
             return { id: n.id, app: n.d.app, titulo: n.d.titulo, texto: n.d.texto,
                      em: new Date(Number(n.d.em)).toISOString() }; }) };
}

/** Marca notificações como lidas. Separado de resumirNotificacoes DE PROPÓSITO.
 *
 * O BUG (21/09, medido ao vivo): a rota de voz chamava resumirNotificacoes({marcarLidas:true}),
 * que gravava 'lida' no instante em que o TEXTO era gerado — muito antes de o áudio existir.
 * Duas chamadas com 27 s de diferença devolveram "Agenda Edu (5): ..." e depois "Nada de novo".
 * Como o corpo HTTP volta VAZIO por protocolo (quem fala é a nuvem), o dono não tem como saber
 * que perdeu: se o áudio não tocar — Drive lento, macro não disparada, aparelho no silencioso —
 * as notificações já foram consumidas e não há como recuperá-las.
 *
 * Agora quem resume não marca; marca quem ENTREGA. Enquanto a entrega não se confirma, elas
 * continuam não-lidas e a mesma pergunta devolve a mesma resposta. */
function _notifMarcarLidas(ids) {
  var n = 0;
  (ids || []).forEach(function (id) {
    try { Firestore.updateDoc(_NOTIF_COL, id, { lida: true }); n++; } catch (e) {}
  });
  return n;
}

/** Diag: {} resumo · {registrar:{...}} simula chegada · {limpar:true} · {horas} */
function diagNotificacoes(args) {
  args = args || {};
  if (args.limpar === true) {
    var n = 0;
    try { (Firestore.listDocs(_NOTIF_COL, 500) || []).forEach(function (x) { Firestore.deleteDoc(_NOTIF_COL, x.id); n++; }); } catch (e) {}
    PropertiesService.getScriptProperties().deleteProperty('NOTIF_CONT');
    return { ok: true, removidas: n };
  }
  // O eco guarda valores CRUS de UMA notificação — inclusive corpo de mensagem. Depois de
  // diagnosticar, apagar é higiene, não capricho: ele fica numa Script Property em texto puro.
  if (args.limparEco === true) {
    PropertiesService.getScriptProperties().deleteProperty('NOTIF_ULTIMO_BRUTO');
    return { ok: true, ecoApagado: true };
  }
  if (args.eco === true) {
    var bruto = null;
    try { bruto = JSON.parse(PropertiesService.getScriptProperties().getProperty('NOTIF_ULTIMO_BRUTO') || 'null'); } catch (e) {}
    if (!bruto) return { ok: true, eco: null, nota: 'nenhuma notificação chegou pela ROTA ainda (o eco só grava no caminho HTTP real)' };
    // diagnóstico do que fazer: literal {xxx} = nome de variável errado na macro; vazio = variável
    // existe mas o MacroDroid não preencheu; texto = está tudo certo.
    // CUIDADO ao ler "LITERAL": duas causas MUITO diferentes produzem o mesmo sintoma —
    // (a) o nome da variável não existe, ou (b) a ação rodou SEM contexto de notificação
    // ("Testar ações" em vez de testar o gatilho). Se TODAS vierem literais, é (b) — inclusive as
    // que comprovadamente funcionam em notificação real. Só vale concluir (a) quando algumas
    // substituem e outras não.
    var literais = 0, campos = ['app', 'titulo', 'texto', 'ticker', 'pacote'];
    campos.forEach(function (k) { if (/^\{[a-z_]+\}$/i.test(String(bruto[k] || ''))) literais++; });
    var todasLiterais = (literais === campos.length);
    function veredito(v) {
      if (v === '(ausente)') return 'PARÂMETRO NÃO ENVIADO pela macro';
      if (/^\{[a-z_]+\}$/i.test(v)) {
        return todasLiterais ? 'LITERAL (todas) — rodou SEM contexto de notificação; teste o GATILHO, não as ações'
                             : 'LITERAL — este nome de variável não existe no MacroDroid';
      }
      if (!v.trim()) return 'VAZIO — variável existe mas veio sem conteúdo';
      return 'OK (' + v.length + ' caracteres)';
    }
    return { ok: true, eco: bruto, diagnostico: {
      app: veredito(bruto.app), titulo: veredito(bruto.titulo),
      texto: veredito(bruto.texto), ticker: veredito(bruto.ticker), pacote: veredito(bruto.pacote) } };
  }
  if (args.registrar) return registrarNotificacao(args.registrar);
  var p = PropertiesService.getScriptProperties();
  var r = resumirNotificacoes({ horas: Number(args.horas || 24), todas: true });
  r.config = { NOTIF_APPS: p.getProperty('NOTIF_APPS') || '(vazio = aceita o que a macro mandar)',
               NOTIF_FALAR_APPS: p.getProperty('NOTIF_FALAR_APPS') || '(vazio = só fala com falar=1)',
               retencaoDias: _NOTIF_RETENCAO_DIAS, tetoDia: _NOTIF_MAX_DIA,
               noDiaDeHoje: Number(p.getProperty('NOTIF_CONT') || 0) };
  return r;
}

/** Configura o filtro. args {apps:'nubank,gmail', falarApps:'agenda edu', limparApps:true} */
function configurarNotificacoes(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limparApps === true) p.deleteProperty('NOTIF_APPS');
  else if (args.apps !== undefined) p.setProperty('NOTIF_APPS', String(args.apps));
  if (args.falarApps !== undefined) p.setProperty('NOTIF_FALAR_APPS', String(args.falarApps));
  if (args.falarJanela !== undefined) p.setProperty('NOTIF_FALAR_JANELA', String(args.falarJanela));
  return { ok: true, NOTIF_APPS: p.getProperty('NOTIF_APPS') || '', NOTIF_FALAR_APPS: p.getProperty('NOTIF_FALAR_APPS') || '',
           NOTIF_FALAR_JANELA: p.getProperty('NOTIF_FALAR_JANELA') || '06:00-20:00 (padrão)' };
}



/* ===================== FINANCEIRO — FASE 1: captura BRUTA =====================
 * Fase 1 não interpreta NADA. O objetivo é só não perder a notificação da recarga (o app prevê
 * 30/07) — notificação perdida não volta, não fica guardada em lugar nenhum para consultar depois.
 * O parser vem na fase 2, escrito em cima de texto REAL em vez de formato imaginado.
 *
 * Coleção SEPARADA de propósito: "notificacoes" tem retenção de 7 dias, lançamento financeiro
 * precisa durar anos. E o texto BRUTO fica gravado para sempre, ao lado do que vier a ser
 * interpretado: se o parser errar ou o Swile mudar o formato, dá para reprocessar. Guardar só o
 * resultado interpretado transforma erro de parser em perda permanente.
 */
var _FIN_COL = 'financeiro';

/** Guarda a notificação financeira CRUA. Nada de parsing aqui. */
function _finGuardarBruto(d) {
  var agora = Date.now();
  var doc = {
    app: d.app || '', pacote: d.pacote || '',
    titulo: d.titulo || '', texto: d.texto || '',
    bruto: ((d.titulo || '') + ' | ' + (d.texto || '')).trim(),
    em: agora, dia: Utilities.formatDate(new Date(agora), 'America/Sao_Paulo', 'yyyy-MM-dd'),
    parseado: false, versaoParser: 0            // a fase 2 preenche isto sem perder o bruto
  };

  // IDEMPOTÊNCIA POR CONTEÚDO. O id era timestamp + aleatório, então reenviar a MESMA notificação
  // criava outro lançamento E DEBITAVA DE NOVO. Aconteceu de verdade ao recuperar as compras
  // perdidas nos 403: o voucher foi de 1000,04 para 980,04 em vez de 990,04.
  // O id agora vem do CONTEÚDO + o dia. O dia entra porque gastar o mesmo valor no mesmo lugar
  // em dias diferentes é legítimo; no mesmo dia, é reenvio.
  var idFin = 'f' + _notifHash((doc.app || '') + '|' + (doc.titulo || '') + '|' + (doc.texto || '')) + '_' + doc.dia;
  var jaExiste = null;
  try { jaExiste = Firestore.getDoc(_FIN_COL, idFin); } catch (eG) {}
  if (jaExiste) return { ok: true, dia: doc.dia, id: idFin, jaRegistrado: true };

  // FASE 2: interpreta e DEBITA — só aqui, depois de confirmado que o lançamento é novo.
  try {
    var _p2 = _finParse(doc.titulo, doc.texto);
    if (_p2) {
      doc.tipo = _p2.tipo; doc.valor = _p2.valor; doc.carteira = _p2.carteira;
      doc.estabelecimento = _p2.estabelecimento; doc.parseado = true; doc.versaoParser = 1;
      var _ap = _finAplicarSaldo(_p2);
      doc.aplicado = _ap.aplicado === true;
      doc.saldoDepois = _ap.para !== undefined ? _ap.para : null;
    }
  } catch (e2) {}

  try {
    Firestore.setDoc(_FIN_COL, idFin, doc);
    return { ok: true, dia: doc.dia, id: idFin };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Lê os lançamentos brutos, mais recentes primeiro. SEM poda: aqui nada expira. */
function _finLer(limite) {
  var docs = [];
  try { docs = Firestore.listDocs(_FIN_COL, 500) || []; } catch (e) { return []; }
  var itens = docs.map(function (x) { return { id: x.id, d: x.dados || {} }; });
  itens.sort(function (a, b) { return Number(b.d.em || 0) - Number(a.d.em || 0); });
  return itens.slice(0, limite || 100);
}


/* ── FASE 2: PARSER DAS NOTIFICAÇÕES DO SWILE ──────────────────────────────────────────────
 * Escrito sobre UMA amostra real de compra:
 *   "Compra aprovada de R$ 1,19 na carteira Refeição e Alimentação, no estabelecimento PADARIA MIRAGO."
 * A recarga NÃO traz número, então ela não move saldo — quem move é a compra (e o estorno).
 * O bruto continua gravado ao lado do interpretado: se o formato variar (compra negada,
 * transferência, outro idioma), dá para reprocessar tudo com reprocessarFinanceiro().
 */
var _FIN_CARTEIRAS = {
  voucher:    /refei[çc][ãa]o|alimenta[çc][ãa]o|voucher/i,
  mobilidade: /mobilidade|combust[íi]vel|transporte|posto/i
};

/** Interpreta título+texto. Devolve null se não reconhecer o tipo — nunca chuta. */
function _finParse(titulo, texto) {
  var t = String((titulo || '') + '. ' + (texto || '')).replace(/\s+/g, ' ').trim();
  var b = t.toLowerCase();

  var tipo = null;
  if (/estorn|devolv|cancelad|reembols/.test(b)) tipo = 'estorno';
  else if (/carga nova|recarga|recarregad|cr[eé]dito dispon/.test(b)) tipo = 'recarga';
  else if (/compra|pagamento|debitad|transa[çc][ãa]o/.test(b)) tipo = 'compra';
  if (!tipo) return null;

  // Valor em formato BR. "R$ 1,19" · "R$ 1.234,56" · "R$ 89"
  var mv = t.match(/R\$\s*([\d.]*\d(?:,\d{2})?)/i);
  var valor = mv ? _finNum(mv[1]) : null;

  var carteira = null;
  ['voucher', 'mobilidade'].forEach(function (k) {
    if (!carteira && _FIN_CARTEIRAS[k].test(t)) carteira = k;
  });

  // "no estabelecimento X" é o formato do Swile; o resto é rede de segurança.
  var me = t.match(/no estabelecimento\s+([^.,;]{2,60})/i) ||
           t.match(/estabelecimento[:\s]+([^.,;]{2,60})/i);
  var estab = me ? me[1].trim().replace(/[.\s]+$/, '') : null;

  return { tipo: tipo, valor: valor, carteira: carteira, estabelecimento: estab,
           completo: !!(valor !== null && carteira) };
}

/** Move o saldo. Compra debita, estorno credita, recarga não mexe (não traz valor). */
function _finAplicarSaldo(p) {
  if (!p || !p.completo) return { aplicado: false, motivo: 'lançamento incompleto' };
  if (p.tipo === 'recarga') return { aplicado: false, motivo: 'recarga não traz valor' };
  var sd = obterSaldoFinanceiro();
  var atual = sd[p.carteira];
  if (atual === null || atual === undefined) return { aplicado: false, motivo: 'saldo da carteira ainda não informado' };
  var delta = (p.tipo === 'estorno') ? p.valor : -p.valor;
  var novo = Math.round((Number(atual) + delta) * 100) / 100;
  var args = { origem: 'lancamento' };
  args[p.carteira] = novo;
  var r = definirSaldoFinanceiro(args);
  return { aplicado: r.ok, carteira: p.carteira, de: atual, para: novo, delta: delta };
}

/** Reinterpreta TUDO que está guardado como bruto. Idempotente: só aplica saldo uma vez. */
function reprocessarFinanceiro(args) {
  args = args || {};
  var itens = _finLer(500), lidos = 0, aplicados = 0, semParse = [];
  itens.forEach(function (it) {
    var d = it.d;
    var p = _finParse(d.titulo, d.texto);
    if (!p) { semParse.push((d.titulo || '') + ' | ' + (d.texto || '')); return; }
    lidos++;
    var patch = { tipo: p.tipo, valor: p.valor, carteira: p.carteira,
                  estabelecimento: p.estabelecimento, parseado: true, versaoParser: 1 };
    // só move saldo se ainda não moveu para este lançamento
    if (args.aplicarSaldo === true && d.aplicado !== true && p.completo && p.tipo !== 'recarga') {
      var ap = _finAplicarSaldo(p);
      if (ap.aplicado) { patch.aplicado = true; aplicados++; }
    }
    try { Firestore.updateDoc(_FIN_COL, it.id, patch); } catch (e) {}
  });
  return { ok: true, total: itens.length, interpretados: lidos, saldoAplicado: aplicados,
           naoReconhecidos: semParse.slice(0, 10) };
}

/** Extrato determinístico (zero LLM). args {dias, carteira}. */
function consultarGastos(args) {
  args = args || {};
  var dias = Number(args.dias || 30);
  var desde = Date.now() - dias * 86400000;
  var itens = _finLer(500).filter(function (i) {
    return Number(i.d.em || 0) >= desde && i.d.tipo === 'compra' && i.d.valor;
  });
  if (args.carteira) itens = itens.filter(function (i) { return i.d.carteira === args.carteira; });

  var totalV = 0, totalM = 0, porEstab = {}, porDia = {};
  itens.forEach(function (i) {
    var d = i.d, v = Number(d.valor) || 0;
    if (d.carteira === 'mobilidade') totalM += v; else totalV += v;
    var e = d.estabelecimento || '(sem nome)';
    porEstab[e] = Math.round(((porEstab[e] || 0) + v) * 100) / 100;
    porDia[d.dia] = Math.round(((porDia[d.dia] || 0) + v) * 100) / 100;
  });
  var top = Object.keys(porEstab).sort(function (a, b) { return porEstab[b] - porEstab[a]; })
                  .slice(0, 5).map(function (e) { return { estabelecimento: e, total: porEstab[e] }; });
  var sd = obterSaldoFinanceiro();
  return { ok: true, dias: dias, compras: itens.length,
           gastoVoucher: Math.round(totalV * 100) / 100,
           gastoMobilidade: Math.round(totalM * 100) / 100,
           saldoAtual: { voucher: sd.voucher, mobilidade: sd.mobilidade },
           maioresEstabelecimentos: top, porDia: porDia,
           itens: itens.slice(0, 30).map(function (i) {
             return { dia: i.d.dia, valor: i.d.valor, carteira: i.d.carteira,
                      estabelecimento: i.d.estabelecimento }; }) };
}

/** Diag da intenção financeira falada. args {frase}. */
function diagFinanceiroVoz(args) {
  args = args || {};
  var i = _interpretarFinanceiro(args.frase);
  return { ok: true, frase: args.frase, interpretado: i,
           resposta: i ? (i.tipo === 'gastos' ? _finFalarGastos(i.dias) : _finFalarSaldo(i.carteira)) : null };
}

/** Diag do parser: {texto,titulo} testa sem gravar · {reprocessar:true,aplicarSaldo} · {gastos:true} */
function diagParserFinanceiro(args) {
  args = args || {};
  if (args.reprocessar === true) return reprocessarFinanceiro(args);
  if (args.gastos === true) return consultarGastos(args);
  return { ok: true, entrada: { titulo: args.titulo, texto: args.texto },
           interpretado: _finParse(args.titulo, args.texto) };
}

/** Saldo/extrato do Swile em UMA frase, sem LLM. Saldo é fato: o modelo já respondeu só uma
 *  carteira e, no follow-up, repetiu o valor da mobilidade como se fosse o do voucher. Número
 *  não se parafraseia. args {carteira} limita a resposta a uma carteira. */
function _finFalarSaldo(carteira) {
  var sd = obterSaldoFinanceiro();
  function br(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
  if (sd.voucher === null && sd.mobilidade === null) {
    return 'Você ainda não me informou o saldo do Swile. Eu pergunto na próxima recarga.';
  }
  var partes = [];
  if (carteira !== 'mobilidade' && sd.voucher !== null) partes.push('voucher, ' + br(sd.voucher));
  if (carteira !== 'voucher' && sd.mobilidade !== null) partes.push('mobilidade, ' + br(sd.mobilidade));
  /* FRESCOR ANTES DO NÚMERO. O saldo aqui é uma FOTO do que ele digitou, não uma consulta ao
   * Swile — e ele gasta no cartão sem avisar o Jarvis. Em 21/09 o valor gravado dizia R$ 676,98
   * e o real era R$ 2,50: 0,4% do anunciado, com 3 dias de idade. A versão anterior falava o
   * número com confiança total e pendurava " Informado em 19/09." no fim, que em ÁUDIO passa
   * despercebido — quem ouve retém o valor, não a data.
   * Agora a ressalva vem NA FRENTE quando o dado está velho, e o número vem depois. Dizer
   * "pode estar desatualizado" custa nada; induzir alguém a contar com saldo que não existe
   * custa uma compra recusada no caixa. */
  var dias = sd.em ? Math.floor((Date.now() - Number(sd.em)) / 86400000) : null;
  var limite = Number(PropertiesService.getScriptProperties().getProperty('FIN_SALDO_VALIDADE_DIAS') || 2);
  if (!isFinite(limite) || limite < 0) limite = 2;
  var corpo = 'Saldo do Swile: ' + partes.join('; e ') + '.';
  if (dias === null) return corpo;
  if (dias > limite) {
    return 'Atenção: este saldo é de ' + (dias === 1 ? 'ontem' : dias + ' dias atrás') +
           ' e pode estar desatualizado. Na última vez que você me informou: ' +
           partes.join('; e ') + '. Se já gastou depois disso, me diga o valor novo.';
  }
  return corpo + ' Informado ' + (dias === 0 ? 'hoje' : (dias === 1 ? 'ontem' : 'há ' + dias + ' dias')) + '.';
}

/* INSIGHT por voz — determinístico. Dois verbos que o LLM não cobria:
 *  · PEDIR   "me dá uma ideia" / "quero ouvir sua ideia" — hoje só existia aceitar uma OFERTA,
 *    e a oferta expira em 20 min. Fora dessa janela o pedido caía no LLM, que se apoiava no
 *    histórico e repetia a última ação (em 10/08 devolveu a confirmação de TURNO — bug real).
 *  · GRAVAR  "anota essa ideia na wiki" — o insight já é arquivado sozinho em insights/, mas
 *    virar página em concepts/ dependia do LLM lembrar QUAL era a ideia. Em 06/08 ele perguntou
 *    "o que você quer que eu anote?" 71s depois de entregar o insight, e o assunto se perdeu.
 * Ordem importa: GRAVAR é testado ANTES de PEDIR, senão "anota essa ideia" cairia no pedir. */
function _interpretarInsight(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var refIdeia = /\b(ideia|insight|sugest|dica)/.test(s);
  var verboGravar = /\b(anot|grav|salv|registr|guard)/.test(s);
  // GRAVAR: precisa do verbo E de uma referência ao que foi dito (demonstrativo + ideia, ou isso+wiki).
  if (verboGravar) {
    var refDemo = /\b(essa|esse|est[ae]|a|o)\s+(ideia|insight|sugest|dica)/.test(s);
    var refIsso = /\bisso\b/.test(s) && /\bwiki\b/.test(s);
    if (refDemo || refIsso) return { acao: 'gravar' };
    return null;   // "anota na wiki que comprei um carro" NÃO é sobre o insight
  }
  // PEDIR: referência à ideia + verbo de pedido.
  if (refIdeia && /\b(quero ouvir|quero saber|me d[aeê]|me fala|me conta|qual|tem alguma|manda|conta|fala)\b/.test(s)) {
    return { acao: 'pedir' };
  }
  return null;
}

/* Promove o insight ATUAL a uma página de concepts/ (o arquivamento em insights/ já é automático
 * no gerarInsightDiario — isto é a versão "conceito", que foi o que ele pediu nas 3 vezes). */
function _insSalvarComoConceito() {
  var ins = _insightAtual();
  if (!ins) return { ok: false, erro: 'não há insight recente para gravar' };
  try {
    var caminho = 'concepts/' + _insSlug(ins.titulo) + '.md';
    var md = '# ' + ins.titulo + '\n\n' + ins.insight + '\n\n' +
      (ins.porque ? '**Por que importa:** ' + ins.porque + '\n\n' : '') +
      (ins.acao ? '**Primeiro passo:** ' + ins.acao + '\n\n' : '') +
      '---\n\n> Insight gerado pelo Jarvis em ' + ins.dia + ' · tema: **' + ins.tema + '**\n\n' +
      'Baseado em:\n' + (ins.fontes || []).map(function (x) { return '- ' + x; }).join('\n') + '\n';
    var r = WikiMemoryService.escreverWiki(caminho, md);
    if (!r || r.status !== 'success') return { ok: false, erro: (r && (r.erro || r.mensagem)) || 'falha ao escrever' };
    try { WikiMemoryService.registrarNoLog('Insight "' + ins.titulo + '" promovido a conceito em ' + caminho + '.'); } catch (eL) {}
    return { ok: true, caminho: caminho, titulo: ins.titulo };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/* TURNO DE TRABALHO por voz — determinístico.
 * Sem isto, "minha jornada essa semana é de manhã" ia para o LLM, que ANUNCIAVA os 4 horários e
 * criava só 1 alerta avulso (sem tag), deixando os 4 do turno anterior vivos — os dois turnos
 * avisando ao mesmo tempo. Aconteceu de verdade em 03/08.
 * Exige contexto de TRABALHO + palavra do turno: "boa tarde" e "vou trabalhar amanhã" NÃO entram
 * (o \b antes de "manha" impede casar dentro de "amanhã", que foi a armadilha mais perigosa). */
function _interpretarTurnoTrabalho(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!/\b(turno|jornada|expediente|escala|horario|trabalh|servico|plantao)/.test(s)) return null;
  var manha = /\bmanha|\bmatutin|\bde cedo\b/.test(s);
  var tarde = /\btarde\b|\bvespertin|\bnoturn|\bnoite\b/.test(s);
  if (manha && !tarde) return 'manha';
  if (tarde && !manha) return 'tarde';
  return null;   // ambíguo (citou os dois) → deixa o LLM perguntar
}

/** Texto livre → intenção financeira. null quando não for pergunta de saldo/gasto. */
// Fonte UNICA de palavras que indicam pergunta sobre o Swile. Usada pela cadeia determinística
// de voz (_interpretarFinanceiro, abaixo) E pelo filtro de ferramentas do chat (Jarvis.js) —
// antes eram duas regex divergentes: "cartão alimentação" (sem "de") passava na primeira e
// falhava na segunda, deixando o modelo responder sem a ferramenta de saldo (bug real, 05/08).
var _FIN_PALAVRAS_RE = /(swile|suav|suail|swaile|su[ai]le|saldo|vale|voucher|mobilidade|alimenta|refeic|combust|cart[ãa]o|quanto (eu )?(tenho|tem)\b|quanto sobrou|quanto resta|quanto (eu )?gastei|onde (eu )?gastei|extrato|maiores gastos)/i;

function _interpretarFinanceiro(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // "suav", "suail", "swaile": o reconhecimento de voz erra o nome da marca com frequência —
  // por isso ele prefere dizer "cartão alimentação", que também entra aqui.
  var marca = _FIN_PALAVRAS_RE.test(s);
  // Pergunta sobre GASTO é inequívoca por si só: "quanto eu gastei essa semana" não precisa
  // nomear o cartão. Antes exigia a marca e caía fora, indo parar no LLM.
  var pareceGasto = /quanto (eu )?gastei|onde (eu )?gastei|extrato|maiores gastos|meus gastos|gastos d[ae]|gasto total/.test(s);
  if (!marca && !pareceGasto && !/\bsaldo\b/.test(s)) return null;
  if (pareceGasto) {
    var dias = 30;
    if (/hoje/.test(s)) dias = 1; else if (/semana/.test(s)) dias = 7; else if (/m[eê]s/.test(s)) dias = 30;
    return { tipo: 'gastos', dias: dias };
  }
  /* DECLARAR o saldo, não perguntar. Até aqui o único jeito de atualizar era o painel interativo
   * da recarga — se ele perdesse aquela janela, o valor envelhecia calado e o Jarvis seguia
   * anunciando um número morto (21/09: R$ 676,98 gravado contra R$ 2,50 reais). Falar o saldo
   * novo é o gesto mais natural, e não colide com a consulta: "quanto tenho" nunca traz números.
   * Usa a mensagem ORIGINAL (não a sem-acento) porque _finLerSaldoDeTexto casa "alimentação". */
  if (/\d/.test(s) && /(registr|anot|atualiz|corrig|meu saldo (e|eh|esta)|saldo (e|eh|esta)|ta em|esta em|sobrou)/.test(s)) {
    var lido = _finLerSaldoDeTexto(msg);
    if (lido && (lido.voucher !== null || lido.mobilidade !== null)) {
      return { tipo: 'definir', voucher: lido.voucher, mobilidade: lido.mobilidade };
    }
  }
  if (/\bsaldo\b|quanto (eu )?(tenho|tem)\b|quanto sobrou|quanto resta/.test(s)) {  // "quanto tem" tambem e pergunta de saldo (05/08: so "tenho" deixava passar)
    // As DUAS citadas = as duas na resposta. Era if/else-if: em 23/09 "qual o meu saldo no
    // voucher e meu saldo da mobilidade" casou 'voucher' primeiro e a mobilidade sumiu da fala.
    var querV = /voucher|refeic|alimenta/.test(s), querM = /mobilidade|combust|transporte/.test(s);
    var cart = (querV && !querM) ? 'voucher' : (querM && !querV) ? 'mobilidade' : null;
    return { tipo: 'saldo', carteira: cart };
  }
  return null;
}

/* FATOS DE RELÓGIO E AGENDA NA VOZ — sem LLM.
 * Em 23/09 às 22:08, "que horas são" respondeu "São 21:29": o modelo copiou a hora de uma
 * resposta anterior que estava no histórico da voz (janela de 2h), mesmo com a hora certa no
 * prompt de sistema. Minutos depois, "o que eu tenho na agenda amanhã" respondeu "Reunião de
 * Alinhamento às 14:00" SEM chamar a ferramenta de agenda — o evento não existia (agenda vazia).
 * Hora, data e compromissos são fatos: saem do relógio e da agenda, nunca do modelo.
 * Brasília é UTC-3 fixo desde 2019 (sem horário de verão) — dá para calcular sem Utilities,
 * e o mesmo código roda igual no GAS e nos testes locais. */
var _DIAS_SEMANA_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
var _MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function _partesBRT(d) {
  var b = new Date(d.getTime() - 3 * 3600000);
  return { ano: b.getUTCFullYear(), mes: b.getUTCMonth(), dia: b.getUTCDate(), dow: b.getUTCDay(), h: b.getUTCHours(), m: b.getUTCMinutes() };
}
function _horaFalada(h, m) { return h + 'h' + (m ? (m < 10 ? '0' + m : String(m)) : ''); }
/** Meia-noite (BRT) do dia `d` deslocado `mais` dias, como Date real. */
function _inicioDiaBRT(d, mais) {
  var p = _partesBRT(d);
  return new Date(Date.UTC(p.ano, p.mes, p.dia + (mais || 0)) + 3 * 3600000);
}

/** Reconhece pedido de hora, data ou agenda. → {via:'relogio'|'agenda', ...} ou null. */
function _interpretarFatoVoz(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(ok |oi |ei |e ai )?(jarvis )?/, '').replace(/( jarvis| por favor| agora| ai)+$/, '').trim();
  // Pedido de MUDANÇA na agenda não é consulta: marcar, cancelar, mover — isso é do modelo.
  var mexe = /\b(marc|agend(ar|e|ou|ei|amos)\b|cri[ae]|adicion|coloc|bot[ae]|inclu|cancel|remov|exclu|desmarc|mud[ae]|alter|lembr)/.test(s);
  // "que horas eu bato o ponto" e "que horas é a reunião" NÃO são o relógio: o pedido tem de
  // TERMINAR na pergunta (a limpeza acima já tirou "agora", "jarvis", "por favor").
  var hora = /(^|\b)que horas? (sao|e|eh)$/.test(s) || /\bhoras? (de )?(atual|certa)\b/.test(s) ||
             /\b(fala|diz|diga|informa|fale)\w* (a |que )?horas?$/.test(s) || /^horas?$/.test(s);
  var data = /\bque dia (e|eh) hoje$/.test(s) || /\bhoje e que dia$/.test(s) || /\bque data e hoje$/.test(s) ||
             /\b(data|dia) (de hoje|atual)\b/.test(s) || /\b(fala|diz|diga|informa|fale)\w* (a )?data$/.test(s);
  if ((hora || data) && !mexe) return { via: 'relogio', hora: hora, data: data };
  if (mexe) return null;
  var falaDeAgenda = /\b(agenda|compromissos?|eventos?|reunio(es)?|reuniao)\b/.test(s);
  var tenho = /\bo que (eu )?tenho\b/.test(s);
  var periodo = /\bamanha\b/.test(s) ? 'amanha' : /\bhoje\b/.test(s) ? 'hoje'
              : /\b(essa|esta|nesta|da) semana\b|\bproximos dias\b/.test(s) ? 'semana' : null;
  if ((falaDeAgenda || tenho) && periodo) return { via: 'agenda', periodo: periodo };
  if (falaDeAgenda && /\b(minha agenda|agenda de hoje|meus compromissos)\b/.test(s)) return { via: 'agenda', periodo: 'hoje' };
  return null;
}

function _falarRelogio(f, agora) {
  var p = _partesBRT(agora || new Date());
  var dataTxt = _DIAS_SEMANA_PT[p.dow] + ', ' + p.dia + ' de ' + _MESES_PT[p.mes] + ' de ' + p.ano;
  if (f.hora && f.data) return 'Hoje é ' + dataTxt + ', e são ' + _horaFalada(p.h, p.m) + '.';
  if (f.data) return 'Hoje é ' + dataTxt + '.';
  return 'São ' + _horaFalada(p.h, p.m) + '.';
}

/** Lê a agenda de verdade (CalendarApp) e fala o resultado. Agenda vazia é dito como vazia. */
function _falarAgenda(periodo, agora) {
  agora = agora || new Date();
  var ini, fim, rotulo;
  if (periodo === 'amanha') { ini = _inicioDiaBRT(agora, 1); fim = _inicioDiaBRT(agora, 2); rotulo = 'Amanhã'; }
  else if (periodo === 'semana') { ini = agora; fim = _inicioDiaBRT(agora, 7); rotulo = 'Nos próximos 7 dias'; }
  else { ini = agora; fim = _inicioDiaBRT(agora, 1); rotulo = 'Hoje'; }
  var evs;
  try { evs = CalendarApp.getDefaultCalendar().getEvents(ini, fim); }
  catch (e) { return 'Não consegui ler a sua agenda agora.'; }
  if (!evs || !evs.length) {
    return rotulo + (periodo === 'hoje' ? ', daqui até o fim do dia,' : '') + ' você não tem nada na agenda.';
  }
  var itens = evs.slice(0, 6).map(function (e) {
    var t = String(e.getTitle() || 'sem título');
    if (e.isAllDayEvent && e.isAllDayEvent()) return (periodo === 'semana' ? _DIAS_SEMANA_PT[_partesBRT(e.getStartTime()).dow] + ', ' : '') + 'o dia todo, ' + t;
    var p = _partesBRT(e.getStartTime());
    return (periodo === 'semana' ? _DIAS_SEMANA_PT[p.dow] + ' ' : '') + 'às ' + _horaFalada(p.h, p.m) + ', ' + t;
  });
  var resto = evs.length - itens.length;
  var lista = itens.length > 1 ? itens.slice(0, -1).join('; ') + '; e ' + itens[itens.length - 1] : itens[0];
  return rotulo + ': ' + lista + (resto > 0 ? '; e mais ' + resto + '.' : '.');
}

/** Extrato falado, determinístico. */
function _finFalarGastos(dias) {
  var g = consultarGastos({ dias: dias });
  function br(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
  if (!g.compras) return 'Não registrei nenhuma compra do Swile nos últimos ' + dias + ' dias.';
  var top = (g.maioresEstabelecimentos || [])[0];
  return 'Nos últimos ' + dias + ' dias: ' + g.compras + ' compra' + (g.compras > 1 ? 's' : '') +
         ', ' + br(g.gastoVoucher + g.gastoMobilidade) + ' no total.' +
         (top ? ' Maior gasto: ' + top.estabelecimento + ', ' + br(top.total) + '.' : '') +
         ' ' + _finFalarSaldo(null);
}
/** Diag da fase 1. args {} lista · {limpar:true} · {simular:{app,titulo,texto}} */
function diagFinanceiro(args) {
  args = args || {};
  if (args.limpar === true) {
    var n = 0;
    try { (Firestore.listDocs(_FIN_COL, 500) || []).forEach(function (x) { Firestore.deleteDoc(_FIN_COL, x.id); n++; }); } catch (e) {}
    return { ok: true, removidos: n };
  }
  if (args.simular) return _finGuardarBruto(args.simular);
  var itens = _finLer(Number(args.limite || 50));
  return { ok: true, total: itens.length, fase: 1,
           nota: 'Fase 1: só captura bruta. O parser entra na fase 2, com amostras reais.',
           lancamentos: itens.map(function (i) {
             return { em: new Date(Number(i.d.em)).toISOString(), app: i.d.app,
                      titulo: i.d.titulo, texto: i.d.texto, parseado: i.d.parseado === true }; }) };
}


/* ── SALDO DO SWILE: âncora informada por ele ──────────────────────────────────────────────
 * A notificação de recarga do Swile NÃO traz número ("Tem carga nova no seu Swile! / Já decidiu
 * como vai usar?"). É isca de marketing, não aviso de crédito. Então a âncora do saldo não pode
 * vir dela — mas a de SAÍDA vem completa ("Compra aprovada de R$ 1,19 na carteira Refeição e
 * Alimentação, no estabelecimento PADARIA MIRAGO"), e é o que permite decrementar.
 * Desenho: a recarga DISPARA uma notificação interativa pedindo os dois saldos; ele digita uma
 * vez por mês e o Jarvis debita sozinho o resto do tempo.
 */
var _FIN_SALDO = 'FIN_SALDO';

/** "1.234,56" | "700,50" | "700" → número. Formato BR: vírgula decimal, ponto de milhar. */
function _finNum(v) {
  var t = String(v === undefined || v === null ? '' : v).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  var n = Number(t);
  return (isFinite(n) && n >= 0) ? n : null;
}

/** Grava a âncora. args {voucher, mobilidade, origem}. Campo ausente NÃO apaga o que já havia. */
function definirSaldoFinanceiro(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var atual = obterSaldoFinanceiro();
  var v = (args.voucher !== undefined) ? _finNum(args.voucher) : atual.voucher;
  var m = (args.mobilidade !== undefined) ? _finNum(args.mobilidade) : atual.mobilidade;
  if (v === null && m === null) return { ok: false, erro: 'nenhum valor válido informado' };
  var doc = { voucher: v, mobilidade: m, em: Date.now(), origem: String(args.origem || 'manual') };
  try { p.setProperty(_FIN_SALDO, JSON.stringify(doc)); } catch (e) { return { ok: false, erro: e.message }; }
  return { ok: true, saldo: doc };
}

function obterSaldoFinanceiro() {
  try {
    var d = JSON.parse(PropertiesService.getScriptProperties().getProperty(_FIN_SALDO) || 'null');
    if (d) return d;
  } catch (e) {}
  return { voucher: null, mobilidade: null, em: null, origem: null };
}

/** Extrai um ou dois valores de texto livre ("700, 250" · "voucher 700 mobilidade 250"). */
/* As duas ORDENS em que um saldo é dito. A versão anterior só entendia "voucher 2,50" (rótulo
 * antes), porque nasceu do painel interativo, onde ele DIGITA. Falando, a ordem natural em
 * português é a inversa — "2,50 no voucher e 0,38 na mobilidade" — e aí o \D{0,12} atravessava o
 * conector: o rótulo "voucher" casava com o número do OUTRO cartão ("voucher e 0,38"), gravando
 * 0,38 como voucher. Silencioso e errado.
 * Agora os conectores são explícitos e curtos, e "e" fica DE FORA de propósito: é o que separa
 * as duas carteiras, nunca o que liga um rótulo ao seu valor. Número-antes tem prioridade. */
var _FIN_ROTULO_VOUCHER = 'voucher|refei[çc][ãa]o|alimenta[çc][ãa]o';
var _FIN_ROTULO_MOBIL   = 'mobilidade|combust[íi]vel|transporte';

var _FIN_LIGA_ANTES  = '(?:reais?\\s*)?(?:n[oa]|em|d[eoa]|para)?';          // "2,50 no voucher"
var _FIN_LIGA_DEPOIS = '(?:[:=]|est[áa]\\s*em|[ée]h?|de|em|com)?';          // "voucher: 2,50"

/** A frase inteira tem UMA orientação, não uma por carteira. Decidir por rótulo isoladamente
 *  produzia leituras cruzadas: em "voucher 2,50 mobilidade 0,38" o número-antes casava
 *  "2,50 mobilidade" e dava 2,50 às duas. Aqui a orientação sai do PRIMEIRO rótulo — se houver
 *  número logo antes dele, a frase toda é número-antes; senão, rótulo-antes. */
function _finOrientacao(t) {
  var m = t.match(new RegExp('(' + _FIN_ROTULO_VOUCHER + '|' + _FIN_ROTULO_MOBIL + ')', 'i'));
  if (!m) return 'depois';
  // Só o que vem ANTES do PRIMEIRO rótulo decide. Varrer a frase inteira achava o número da
  // outra carteira ("voucher 2,50 mobilidade" casava "2,50 mobilidade") e invertia tudo.
  return new RegExp('[\\d.,]*\\d\\s*' + _FIN_LIGA_ANTES + '\\s*$', 'i').test(t.slice(0, m.index))
    ? 'antes' : 'depois';
}

function _finValorDoRotulo(t, rotulos, orientacao) {
  var re = (orientacao === 'antes')
    ? new RegExp('([\\d.,]*\\d)\\s*' + _FIN_LIGA_ANTES + '\\s*(?:' + rotulos + ')', 'i')
    : new RegExp('(?:' + rotulos + ')\\s*' + _FIN_LIGA_DEPOIS + '\\s*([\\d.,]*\\d)', 'i');
  var m = t.match(re);
  return m ? _finNum(m[1]) : null;
}

function _finLerSaldoDeTexto(txt) {
  var t = String(txt || '');
  var temRotulo = new RegExp('(' + _FIN_ROTULO_VOUCHER + '|' + _FIN_ROTULO_MOBIL + ')', 'i').test(t);
  if (temRotulo) {
    var ori = _finOrientacao(t);
    var v = _finValorDoRotulo(t, _FIN_ROTULO_VOUCHER, ori);
    var m = _finValorDoRotulo(t, _FIN_ROTULO_MOBIL, ori);
    if (v !== null || m !== null) return { voucher: v, mobilidade: m, porRotulo: true, ordem: ori };
  }
  var nums = (t.match(/[\d.,]*\d/g) || []).map(_finNum).filter(function (n) { return n !== null; });
  if (!nums.length) return null;
  return { voucher: nums[0], mobilidade: nums.length > 1 ? nums[1] : null, porRotulo: false };
}

/** Pede os saldos por notificação interativa. Chamado pela regra ao ver a recarga. */
function _finPedirSaldo() {
  if (typeof Jarvis === 'undefined' || !Jarvis.controlarDispositivo) return { ok: false, erro: 'Jarvis indisponível' };
  try {
    var r = Jarvis.controlarDispositivo({
      acao: 'notificacao_interativa',
      modo: 'saldo',
      titulo: 'Recarga do Swile caiu',
      texto: 'Quanto entrou? Toque aqui e digite os dois saldos no campo de texto - ex.: "700, 250" (voucher, mobilidade).',
      opcao1: 'Vou digitar abaixo',
      opcao2: 'Depois'
    });
    return { ok: !!(r && r.status === 'success'), resposta: r };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Diag: {} mostra o saldo · {voucher,mobilidade} define · {texto} interpreta · {pedir:true} dispara. */
function diagSaldo(args) {
  args = args || {};
  if (args.pedir === true) return _finPedirSaldo();
  if (args.texto !== undefined) {
    var lido = _finLerSaldoDeTexto(args.texto);
    if (!lido) return { ok: false, erro: 'não achei número no texto', entrada: args.texto };
    if (args.simular === true) return { ok: true, simulado: true, lido: lido };
    return definirSaldoFinanceiro({ voucher: lido.voucher, mobilidade: lido.mobilidade, origem: 'texto' });
  }
  if (args.voucher !== undefined || args.mobilidade !== undefined) return definirSaldoFinanceiro(args);
  var sd = obterSaldoFinanceiro();
  return { ok: true, saldo: sd, informadoEm: sd.em ? new Date(sd.em).toISOString() : null,
           nota: sd.em ? null : 'nenhum saldo informado ainda — a recarga dispara o pedido' };
}

/* ===================== REGRAS DE NOTIFICAÇÃO (guardar → AGIR) =====================
 * Guardar não é agir. Uma regra é: app + padrão no texto → o que fazer.
 * Ações:
 *   · ignorar      — ruído conhecido (promoção, "confira as ofertas"). Nem guarda.
 *   · avisar       — ROTEIA PELO CONTEXTO: em casa e fora do expediente, fala; caso contrário,
 *                    guarda para o briefing. É o padrão certo para quase tudo.
 *   · falar        — fala AGORA (ainda sob a janela e a governança). Só para o que não pode esperar.
 *   · lembrete_casa / lembrete_trabalho — vira lembrete condicional e chega quando ele CHEGAR lá.
 *                    Reaproveita a fila de presença que já existe.
 * A PRIMEIRA regra que casar vence. Sem regra nenhuma: só guarda (comportamento de hoje).
 */
var _NOTIF_REGRAS = 'NOTIF_REGRAS';

function _notifRegras() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_NOTIF_REGRAS) || '[]') || []; }
  catch (e) { return []; }
}

/** Casa uma regra contra a notificação. padrao vazio = qualquer texto daquele app. */
function _notifRegraCasa(r, app, pacote, titulo, texto) {
  if (r.ativa === false) return false;
  if (r.app) {
    // `app` é REGEX, igual a `padrao` — as sementes usam alternância ("bradesco|itaú|swile").
    // Comparar por substring, como eu fazia, fazia a alternância nunca casar.
    var a = String(app || '').toLowerCase(), p = String(pacote || '').toLowerCase();
    var casou;
    try { var re = new RegExp(String(r.app), 'i'); casou = re.test(a) || re.test(p); }
    catch (e) { var alvo = String(r.app).toLowerCase(); casou = (a.indexOf(alvo) !== -1 || p.indexOf(alvo) !== -1); }
    if (!casou) return false;
  }
  if (!r.padrao) return true;
  try { return new RegExp(r.padrao, 'i').test((titulo || '') + ' ' + (texto || '')); }
  catch (e) { return false; }
}

/** Em casa E fora do expediente = momento de falar. Caso contrário, guarda para o briefing. */
function _notifRoteia() {
  var local = (typeof _insLocalAtual === 'function') ? _insLocalAtual() : 'desconhecido';
  var fora  = (typeof _insForaDoTurno === 'function') ? _insForaDoTurno() : true;
  return (local === 'casa' && fora && _notifPodeFalar()) ? 'falar' : 'briefing';
}

/** Aplica a primeira regra que casar. Devolve o que foi decidido (e por quê). */
function _notifAplicarRegras(d) {
  var regras = _notifRegras();
  for (var i = 0; i < regras.length; i++) {
    var r = regras[i];
    if (!_notifRegraCasa(r, d.app, d.pacote, d.titulo, d.texto)) continue;
    var acao = String(r.acao || 'avisar').toLowerCase();
    // Texto próprio da regra vence (é política do dono); senão, a fonte única de fala.
    var frase = r.texto ? String(r.texto) : _notifCorpoFalavel(d.titulo, d.texto, d.em || Date.now());

    if (acao === 'ignorar') return { regra: r.id, acao: 'ignorar' };

    // guardar = fica no cofre e pronto. Sem fala, sem lembrete. Útil para o que se consulta depois.
    if (acao === 'guardar') return { regra: r.id, acao: 'guardar' };

    // financeiro = também vai para a coleção de retenção longa, com o texto BRUTO preservado.
    // NÃO fala: extrato não é interrupção.
    // recarga: guarda o bruto E pede os saldos, porque a notificação não traz número nenhum.
    if (acao === 'perguntar_saldo') {
      var rfs = _finGuardarBruto(d);
      var rp = _finPedirSaldo();
      return { regra: r.id, acao: 'perguntar_saldo', arquivado: rfs.ok, pediu: rp.ok, erro: rp.erro || null };
    }

    if (acao === 'financeiro') {
      var rf = _finGuardarBruto(d);
      // A regra 'banco'/'financeiro' existe para extrato — e engolia FRAUDE junto. Em 21/09 o
      // "Compra não reconhecida, R$ 2.400" do Itaú foi arquivado calado, porque a regra casa pela
      // FONTE e a fonte é a mesma que manda saldo e promoção. Escalar resolve sem desfazer a regra.
      var escF = _notifEscalaSePreciso(d);
      return { regra: r.id, acao: 'financeiro', arquivado: rf.ok, erro: rf.erro || null,
               escalado: escF.escalou, urgencia: escF.urgencia };
    }

    if (acao === 'lembrete_casa' || acao === 'lembrete_trabalho') {
      var gat = (acao === 'lembrete_casa') ? 'chegou_casa' : 'chegou_trabalho';
      try {
        var rl = criarLembreteCondicional({ gatilho: gat, texto: frase.substring(0, 160), validadeDias: 3 });
        return { regra: r.id, acao: acao, lembrete: rl.ok ? rl.lembrete.id : null, erro: rl.ok ? null : rl.erro };
      } catch (e1) { return { regra: r.id, acao: acao, erro: e1.message }; }
    }

    var modo = (acao === 'falar') ? 'falar' : (acao === 'briefing' ? 'briefing' : _notifRoteia());
    if (modo === 'falar') {
      var falou = false;
      try {
        var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
          ? Jarvis.controlarDispositivo({ acao: 'falar', texto: (d.app || 'Celular') + '. ' + frase }) : null;
        falou = !!(res && res.status === 'success');
      } catch (e2) {}
      return { regra: r.id, acao: acao, modo: 'falar', falou: falou };
    }
    // Mesmo caso do 'financeiro': a regra mandou para o resumo, mas se for nível "não pode
    // esperar" o silêncio deixa de ser a resposta certa.
    var escB = _notifEscalaSePreciso(d);
    return { regra: r.id, acao: acao, modo: escB.escalou ? 'falar' : 'briefing',
             escalado: escB.escalou, urgencia: escB.urgencia };
  }
  // NENHUMA REGRA CASOU. Antes isto virava 'guardar' calado: tudo que o dono ainda não tinha
  // escrito regra ficava invisível até ele perguntar "o que eu perdi" — inclusive o que valia
  // interrupção. Escrever uma regra por app não escala, e a regra não lê o CONTEÚDO: a mesma
  // fonte manda promoção e aviso de fraude. O JEV pontua o quanto AQUELA notificação merece
  // interromper; a política (limiar, janela de silêncio) continua no código.
  return _notifTriagemJev(d);
}

/* ===================== TRIAGEM POR PONTUAÇÃO (JEV / TypeSafe) =====================
 * Só roda no vácuo deixado pelas regras — regra explícita do dono é política e vence sempre,
 * sem gastar rede. Aqui é julgamento: "isto merece tocar o alto-falante agora?"
 *
 * A pontuação é GUARDADA junto da notificação. Trocar o limiar depois não precisa de nova
 * inferência (o padrão "judgments into reusable data"): a evidência e o significado da pergunta
 * não mudaram, só a política de corte.
 * ============================================================================== */
/* Corte em 2.0 porque 2.0 É o nível 2 ("alguém esperando resposta dele, ou prazo HOJE") — o
 * limiar ancora no significado do nível, não num número escolhido a esmo.
 * MEDIDO de verdade contra o jev-1.13.0 em 21/09, com notificações no formato real:
 *   Shopee "MEGA OFERTA" 0.05 · Instagram "novo seguidor" 0.00 · G1 "Resumo do dia" 1.00
 *   Agenda Edu "Atividade escolar amanhã" 1.98 · WhatsApp "consegue me ligar? é urgente" 2.16
 *   Itaú "Compra não reconhecida R$ 2.400" 3.00
 * O primeiro corte que testei (2.2) silenciava o pedido urgente de ligação por 0.04 — errado:
 * é exatamente o caso que justifica interromper. A margem entre 1.98 e 2.16 é estreita, então
 * este número é um PONTO DE PARTIDA: calibre com as suas notificações via diagTriagemNotificacao. */
var _NOTIF_URGENCIA_LIMIAR = 2.0;   // 0..3 — ver os níveis abaixo

/* ESCALONAMENTO — limiar SEPARADO e mais alto (2.8, dentro do nível 3 "não pode esperar").
 * Aqui não se está preenchendo um vácuo: está se SOBREPONDO a uma regra que o dono escreveu.
 * Isso só se justifica no extremo — fraude, segurança, emergência — e o preço de errar é
 * quebrar a confiança nas próprias regras dele. Por isso 2.8 e não 2.0.
 * 'ignorar' NUNCA escala: é supressão explícita, não arquivamento. */
var _NOTIF_ESCALA_LIMIAR = 2.8;

/** FONTE ÚNICA da pergunta de urgência. Dois chamadores a usam — a triagem (vácuo das regras) e
 *  o escalonamento (fura regra que calou). Os limiares diferem porque as consequências diferem,
 *  mas a PERGUNTA é a mesma: duplicá-la seria repetir o erro que já custou caro aqui, quando
 *  duas listas para a mesma pergunta divergiram e só uma conhecia "Ligar".
 *  Devolve { ok, score, confidence, ms, erro }. */
function _notifPontuarUrgencia(d) {
  var r = TypeSafe.perguntar(
    { app: String(d.app || ''), titulo: String(d.titulo || ''), mensagem: String(d.texto || '') },
    { urgencia: {
        type: 'score',
        instructions: 'Esta notificação chegou no celular do dono. Ele está no meio de outra coisa e o ' +
                      'aparelho vai LER ISTO EM VOZ ALTA se a pontuação for alta. O quanto ela merece ' +
                      'interromper agora, em vez de esperar o resumo do fim do dia?',
        criteria: [
          'Promoção, propaganda, newsletter, cupom, novidade de app, curtida ou seguidor novo, notificação de jogo, sugestão automática de conteúdo.',
          'Informação que ele vai querer ver, mas que não muda nada se ele ler daqui a algumas horas: resumo de notícia, atualização de pedido a caminho, lembrete de evento distante, extrato normal.',
          'Alguém esperando resposta dele, ou algo com prazo HOJE: mensagem pessoal direta, cobrança de tarefa, reunião começando em minutos, entrega chegando agora, comunicado da escola do filho sobre amanhã.',
          'Não pode esperar: alerta de segurança ou login desconhecido, dinheiro saindo da conta sem ele reconhecer, código de verificação que ele está usando agora, emergência de saúde ou família, prazo vencendo nas próximas horas.'
        ]
      } },
    { cacheSeg: 900 }
  );
  if (!r.ok) return { ok: false, erro: r.erro, ms: r.ms };
  var a = r.answers && r.answers.urgencia;
  if (!a || typeof a.score !== 'number') return { ok: false, erro: 'resposta sem score', ms: r.ms };
  return { ok: true, score: a.score,
           confidence: (typeof a.confidence === 'number') ? a.confidence : null, ms: r.ms };
}

/** A regra mandou calar. A notificação é urgente o bastante para furar esse silêncio?
 *  Devolve { escalou, urgencia } — e fala, se for o caso. */
function _notifEscalaSePreciso(d) {
  var out = { escalou: false, urgencia: null };
  if (typeof TypeSafe === 'undefined' || !TypeSafe.temChave()) return out;
  if (!_notifPodeFalar()) return out;          // janela vence tudo, inclusive fraude
  var r = _notifPontuarUrgencia(d);
  if (!r.ok) return out;
  out.urgencia = r.score;

  var lim = Number(PropertiesService.getScriptProperties().getProperty('NOTIF_ESCALA_LIMIAR') || _NOTIF_ESCALA_LIMIAR);
  if (!isFinite(lim) || lim <= 0 || lim > 3) lim = _NOTIF_ESCALA_LIMIAR;
  if (r.score < lim) return out;

  try {
    var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
      ? Jarvis.controlarDispositivo({ acao: 'falar',
          texto: 'Atenção. ' + (d.app || 'Celular') + '. ' + _notifCorpoFalavel(d.titulo, d.texto, d.em || Date.now()) }) : null;
    out.escalou = !!(res && res.status === 'success');
  } catch (e) {}
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'notif:escalada', ok: out.escalou, ms: r.ms,
      resumo: 'urg ' + r.score.toFixed(2) + '>=' + lim + ' furou a regra · ' + String(d.app || '') + ': ' + String(d.titulo || '').substring(0, 60)
    });
  } catch (eEv) {}
  return out;
}

function _notifTriagemJev(d) {
  if (typeof TypeSafe === 'undefined' || !TypeSafe.temChave()) return { regra: null, acao: 'guardar' };
  // JANELA DE SILÊNCIO vem ANTES do modelo: fora dela nada fala, por mais urgente que seja.
  // Perguntar para depois ignorar a resposta seria gastar rede e token à toa.
  if (!_notifPodeFalar()) return { regra: null, acao: 'guardar', modo: 'briefing', nota: 'fora da janela de fala' };

  var r = _notifPontuarUrgencia(d);
  if (!r.ok) return { regra: null, acao: 'guardar', erro: r.erro };

  var lim = Number(PropertiesService.getScriptProperties().getProperty('NOTIF_URGENCIA_LIMIAR') || _NOTIF_URGENCIA_LIMIAR);
  if (!isFinite(lim) || lim <= 0 || lim > 3) lim = _NOTIF_URGENCIA_LIMIAR;

  var base = { regra: null, via: 'jev', urgencia: Number(r.score.toFixed(2)),
               confianca: (r.confidence === null) ? null : Number(r.confidence.toFixed(2)),
               limiar: lim, ms: r.ms };
  if (r.score < lim) { base.acao = 'guardar'; base.modo = 'briefing'; return base; }

  var falou = false;
  try {
    var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
      ? Jarvis.controlarDispositivo({ acao: 'falar',
          texto: (d.app || 'Celular') + '. ' + _notifCorpoFalavel(d.titulo, d.texto, d.em || Date.now()) }) : null;
    falou = !!(res && res.status === 'success');
  } catch (e) {}
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'notif:jev', ok: falou, ms: r.ms,
      resumo: 'urg ' + base.urgencia + '/' + lim + ' · ' + String(d.app || '') + ': ' + String(d.titulo || '').substring(0, 60)
    });
  } catch (eEv) {}
  base.acao = 'falar'; base.modo = 'falar'; base.falou = falou;
  return base;
}

/** DIAGNÓSTICO: pontuação CRUA do JEV para uma notificação, com a distribuição entre os níveis.
 *  Serve para calibrar NOTIF_URGENCIA_LIMIAR com notificações reais suas. */
function diagTriagemNotificacao(args) {
  args = args || {};
  if (typeof TypeSafe === 'undefined' || !TypeSafe.temChave()) return { ok: false, erro: 'TYPESAFE_API_KEY não configurada.' };
  var d = { app: String(args.app || ''), titulo: String(args.titulo || ''), texto: String(args.texto || '') };
  var r = _notifTriagemJev(d);
  return { ok: true, entrada: d, resultado: r,
           decisao: r.acao === 'falar' ? 'FALA EM VOZ ALTA' : 'guarda para o resumo' };
}

/** CRUD de regras. args {adicionar:{...}} · {remover:id} · {listar:true} · {semear:true} */
function configurarRegraNotificacao(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var regras = _notifRegras();

  if (args.semear === true) {
    // Sementes tiradas dos apps REAIS dele. Editáveis: são um ponto de partida, não dogma.
    regras = [
      { id: 'promo',    app: '',          padrao: 'oferta|promo[cç][aã]o|desconto|imperd[ií]vel|black|cupom|aproveite', acao: 'ignorar' },
      { id: 'ponto',    app: 'sisponto',  padrao: '',                                  acao: 'briefing' },
      { id: 'boleto',   app: 'bradesco|ita[uú]|mercado pago|swile', padrao: 'boleto|vencimento|vence|fatura|pagamento', acao: 'lembrete_casa' },
      { id: 'banco',    app: 'bradesco|ita[uú]|mercado pago|swile', padrao: '',        acao: 'avisar' },
      { id: 'vaga',     app: 'catho|linkedin',       padrao: 'vaga|oportunidade|candidat|entrevista', acao: 'avisar' },
      { id: 'entrega',  app: 'mercado livre|amazon|olx|sam',        padrao: 'entrega|entregue|saiu para|a caminho|chegou', acao: 'avisar' },
      // O app instalado no aparelho dele é o AgendaKids (com.agendakidsdigital.app); 'agenda edu'
      // sozinho não casava com nada e a notificação da escola era guardada sem ação nenhuma.
      { id: 'escola',   app: 'agenda ?edu|agenda ?kids|agendakids', padrao: '',                acao: 'avisar' },
      { id: 'gov',      app: 'gov.br|inss|carteira de trabalho',    padrao: '',        acao: 'avisar' }
    ];
    p.setProperty(_NOTIF_REGRAS, JSON.stringify(regras));
    return { ok: true, semeadas: regras.length, regras: regras };
  }
  if (args.remover) {
    var antes = regras.length;
    regras = regras.filter(function (r) { return r.id !== String(args.remover); });
    p.setProperty(_NOTIF_REGRAS, JSON.stringify(regras));
    return { ok: antes !== regras.length, restantes: regras.length };
  }
  if (args.adicionar) {
    var nova = args.adicionar;
    if (!nova.id) nova.id = 'r' + Date.now().toString(36);
    regras = regras.filter(function (r) { return r.id !== nova.id; });
    if (args.noTopo === true) regras.unshift(nova); else regras.push(nova);
    p.setProperty(_NOTIF_REGRAS, JSON.stringify(regras));
    return { ok: true, regra: nova, total: regras.length };
  }
  return { ok: true, total: regras.length, regras: regras };
}

/* ===================== TAREFAS AGENDADAS (diagnostico) =====================
 * As tarefas do Agenda.js rodam a cada 15 min mandando a `descricao` para o Jarvis.ask -- ou
 * seja, para o LLM, COM ferramentas. Isso nao aparecia em lugar nenhum: nao havia como listar
 * nem cancelar de fora, e o efeito colateral so era visivel no resultado.
 *
 * O caso que motivou isto: uma tarefa diaria as 8h com a descricao 'Marcar ponto digital para
 * inicio do trabalho.' A frase NAO e uma acao que o agente possa executar -- ele nao bate ponto
 * por ninguem. Entao o modelo improvisava, e improviso com ferramenta na mao vira efeito
 * colateral: todo dia util as 8h ele CRIAVA quatro alertas de ponto do turno da manha. O Bruno
 * passou dias sendo cobrado nos dois turnos e a causa estava invisivel.
 *
 * LICAO, valida para qualquer tarefa agendada: a descricao tem de ser algo que o agente
 * CONSIGA fazer e que seja seguro repetir. Frase que so descreve uma intencao humana faz o
 * modelo inventar o meio. */
function diagTarefasAgendadas(args) {
  args = args || {};
  if (typeof Agenda === 'undefined') return { ok: false, erro: 'Agenda indisponivel.' };
  if (args.cancelar) {
    var r = Agenda.cancelar(String(args.cancelar));
    return { ok: true, removidas: (r && r.removidas) || 0 };
  }
  var docs = [];
  try { docs = Firestore.listDocs('tarefas', 100) || []; } catch (e) { return { ok: false, erro: e.message }; }
  return { ok: true, total: docs.length, tarefas: docs.map(function (t) {
    var d = t.dados || {};
    return { id: t.id, ativo: d.ativo !== false, hora: d.hora, frequencia: d.frequencia,
             diasSemana: d.diasSemana, descricao: d.descricao,
             ultimaExecucao: d.ultimaExecucao || null,
             ultimoResultado: String(d.ultimoResultado || '').substring(0, 160) };
  }) };
}

/* Gera o texto de um alerta DINAMICO pelo caminho REAL (Jarvis.ask, interativo:false) SEM falar
 * no celular. Existe porque diagChat nao serve para isto: ele passa por _rotaDireta, que
 * intercepta 'agenda' antes do modelo e devolve a resposta pronta -- ou seja, testa outro
 * caminho. O briefing so passa pelo modelo, e e la que ele inventava compromisso.
 * args {tag} ou {id}. */
function diagBriefingTexto(args) {
  args = args || {};
  if (typeof AlertasVoz === 'undefined') return { ok: false, erro: 'AlertasVoz indisponivel.' };
  var lista = AlertasVoz.listar() || [];
  var a = null;
  for (var i = 0; i < lista.length; i++) {
    if ((args.id && lista[i].id === args.id) || (args.tag && lista[i].tag === args.tag)) { a = lista[i]; break; }
  }
  if (!a) return { ok: false, erro: 'alerta nao encontrado (tag/id)' };
  if (!a.dinamico) return { ok: false, erro: 'alerta nao e dinamico' };
  var t0 = Date.now(), texto = '', erro = null;
  try {
    var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'owner';
    texto = String(Jarvis.ask(owner, a.texto, [], null, { interativo: false }) || '');
  } catch (e) { erro = e.message; }
  var limpo = '';
  try { limpo = (typeof _prepararTextoFala === 'function') ? _prepararTextoFala(texto) : texto; } catch (eL) { limpo = texto; }
  return { ok: !erro, id: a.id, tag: a.tag, ms: Date.now() - t0, erro: erro,
           caracteres: limpo.length, texto: limpo.substring(0, 1200) };
}

/* ===================== GATILHOS (diagnostico e reparo) =====================
 * O Jarvis ficou 7 dias mudo (31/08 a 07/09) e nao havia como VER por que: os gatilhos de
 * tempo sao o coracao do agente -- tick de alerta a cada minuto, ping de telemetria, jobs
 * diarios -- e nao existia nenhuma forma de listar quais estavam vivos sem abrir o editor.
 * O Apps Script DESATIVA gatilho que falha repetidamente, e quando isso acontece o agente
 * simplesmente para, em silencio, sem nada no log (porque o que escreveria no log era o
 * proprio gatilho). Diagnostico que depende do sistema que quebrou nao serve.
 */
function diagGatilhos(args) {
  args = args || {};
  var esperados = {
    tickAlertasVoz:            'alertas falados (a cada 1 min)',
    pingTelemetria:            'telemetria do celular (a cada 15 min)',
    jobAutoDiagnostico:        'auto-diagnostico diario',
    jobMemoriaConversas:       'indexacao da memoria (diario)',
    jobInsightDiario:          'insight do dia',
    executarTarefasAgendadas:  'tarefas agendadas (a cada 15 min)'
  };
  var vivos = {}, lista = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      vivos[h] = (vivos[h] || 0) + 1;
      lista.push({ handler: h, tipo: String(t.getEventType()), id: t.getUniqueId() });
    });
  } catch (e) { return { ok: false, erro: e.message }; }

  var faltando = Object.keys(esperados).filter(function (k) { return !vivos[k]; });
  var duplicados = Object.keys(vivos).filter(function (k) { return vivos[k] > 1; });

  // REPARO: reinstala os que sumiram. So com args.reparar === true -- criar gatilho e efeito
  // colateral, nao diagnostico.
  var reinstalados = [];
  if (args.reparar === true) {
    faltando.forEach(function (k) {
      try {
        if (k === 'tickAlertasVoz') { ScriptApp.newTrigger(k).timeBased().everyMinutes(1).create(); reinstalados.push(k); }
        else if (k === 'pingTelemetria') { ScriptApp.newTrigger(k).timeBased().everyMinutes(15).create(); reinstalados.push(k); }
        else if (k === 'executarTarefasAgendadas') { ScriptApp.newTrigger(k).timeBased().everyMinutes(15).create(); reinstalados.push(k); }
        else if (k === 'jobAutoDiagnostico') { ScriptApp.newTrigger(k).timeBased().everyDays(1).atHour(8).create(); reinstalados.push(k); }
        else if (k === 'jobMemoriaConversas') { ScriptApp.newTrigger(k).timeBased().everyDays(1).atHour(3).create(); reinstalados.push(k); }
        else if (k === 'jobInsightDiario') { ScriptApp.newTrigger(k).timeBased().everyDays(1).atHour(7).create(); reinstalados.push(k); }
      } catch (eR) {}
    });
  }

  return { ok: true, total: lista.length, vivos: vivos, gatilhos: lista,
           faltando: faltando.map(function (k) { return { handler: k, papel: esperados[k] }; }),
           duplicados: duplicados, reinstalados: reinstalados,
           nota: faltando.length ? 'Gatilho ausente = essa parte do agente esta MUDA. Rode com {reparar:true}.'
                                 : 'Todos os gatilhos esperados estao instalados.' };
}

/* ===================== PAUSA DE PONTO (ferias / folga) =====================
 * Suspende SO os lembretes de ponto ate uma data, sem apagar nada. Quando a data passa, os
 * alertas voltam sozinhos — que e a diferenca entre isto e simplesmente cancelar os alertas.
 * A cobranca de ausencia tambem cala junto: cobrar ponto de quem esta de ferias e pior que
 * o lembrete, porque insiste. */
function configurarPausaPonto(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var TZ = 'America/Sao_Paulo';
  if (args.retomar === true) {
    p.deleteProperty('PONTO_PAUSA_ATE'); p.deleteProperty('PONTO_PAUSA_MOTIVO');
    return { ok: true, pausado: false, info: 'Lembretes de ponto retomados.' };
  }
  if (args.ate !== undefined || args.dias !== undefined) {
    var ate;
    if (args.ate) {
      ate = String(args.ate).trim();
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ate)) return { ok: false, erro: 'Use ate no formato AAAA-MM-DD.' };
    } else {
      var d = new Date(Date.now() + Number(args.dias) * 86400000);
      ate = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    }
    p.setProperty('PONTO_PAUSA_ATE', ate);
    if (args.motivo) p.setProperty('PONTO_PAUSA_MOTIVO', String(args.motivo).substring(0, 60));
  }
  var atual = p.getProperty('PONTO_PAUSA_ATE') || '';
  var hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return { ok: true, pausadoAte: atual || null, motivo: p.getProperty('PONTO_PAUSA_MOTIVO') || null,
           pausadoAgora: !!atual && hoje <= atual, hoje: hoje,
           info: atual ? ('Ponto silenciado ate ' + atual + ' (inclusive). Volta sozinho no dia seguinte.')
                       : 'Sem pausa — lembretes de ponto ativos.' };
}

/* ===================== VIAGEM / DIREÇÃO =====================
 * Recebe telemetria de deslocamento do MacroDroid e devolve, quando vale a pena, UMA frase para
 * o aparelho falar. A divisão é a mesma que já se provou no resto do projeto:
 *
 *   REFLEXO fica no aparelho — excesso de velocidade é conferido localmente a cada poucos
 *   segundos, sem rede, e falado pelo TTS nativo. Alerta de velocidade que depende de round-trip
 *   para a nuvem chega tarde demais para servir.
 *
 *   JULGAMENTO fica aqui — a cada ~60 s o aparelho manda um resumo e este módulo decide o que
 *   merece ser dito: fadiga, chegada, retomada de excesso. Estado de viagem em cache.
 *
 * O QUE ESTE MÓDULO NÃO FAZ, e é importante estar escrito para ninguém prometer depois:
 *  · limite de velocidade REAL da via — exige a Roads API do Google, que é paga e de acesso
 *    restrito. Aqui o limite é o que o Bruno configurar (urbano/rodovia), escolhido por ele.
 *  · radares — não há fonte pública gratuita e confiável.
 *  · trânsito/acidentes em tempo real — exige Directions API com faturamento.
 * Prometer qualquer um dos três sem a fonte de dados seria inventar aviso, que em direção é pior
 * do que não avisar.
 */
var _VIAGEM_KEY = 'VIAGEM_ESTADO';
var _VIAGEM_TTL = 3 * 60 * 60;   // 3 h de cache: viagem que passa disso já não é a mesma sessão

function _viagemLer() {
  try { return JSON.parse(CacheService.getScriptCache().get(_VIAGEM_KEY) || 'null'); } catch (e) { return null; }
}
function _viagemSalvar(v) {
  try { CacheService.getScriptCache().put(_VIAGEM_KEY, JSON.stringify(v), _VIAGEM_TTL); } catch (e) {}
}

/** Config do dono. Limites são ESCOLHA dele, não leitura da via. */
function _viagemCfg() {
  var p = PropertiesService.getScriptProperties();
  return {
    limiteUrbano:  Number(p.getProperty('VIAGEM_LIMITE_URBANO')  || 60),
    limiteRodovia: Number(p.getProperty('VIAGEM_LIMITE_RODOVIA') || 110),
    // acima disto assume rodovia (heurística simples, e assumida como tal)
    corteRodovia:  Number(p.getProperty('VIAGEM_CORTE_RODOVIA')  || 80),
    fadigaMin:     Number(p.getProperty('VIAGEM_FADIGA_MIN')     || 120),
    toleranciaKmh: Number(p.getProperty('VIAGEM_TOLERANCIA')     || 7)
  };
}

/** O dono está dirigindo agora? Usado para calar a proatividade não urgente. */
function _viagemAtiva() {
  var v = _viagemLer();
  if (!v || !v.em) return false;
  return (Date.now() - v.em) < 5 * 60000;   // sem sinal há 5 min = viagem acabou
}

/** ENDPOINT de viagem. Recebe {velocidade, lat, lon, eta, km, encerrar} e devolve {falar}. */
function registrarViagem(d) {
  d = d || {};
  var cfg = _viagemCfg();
  var agora = Date.now();
  var vel = Number(String(d.velocidade || d.speed || '').replace(/[^\d.]/g, '')) || 0;
  var km  = String(d.km || '').trim();
  var eta = String(d.eta || '').trim();

  var v = _viagemLer();
  if (d.encerrar === true || String(d.encerrar) === 'true') {
    if (!v) return { ok: true, falar: '' };
    var minTot = Math.round((agora - v.inicio) / 60000);
    try { CacheService.getScriptCache().remove(_VIAGEM_KEY); } catch (e) {}
    try { if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'viagem:fim', ok: true, ms: 0,
      resumo: 'duracao=' + minTot + 'min maxKmh=' + v.maxVel + ' avisos=' + (v.avisos || 0) }); } catch (e2) {}
    return { ok: true, encerrada: true, minutos: minTot, maxVelocidade: v.maxVel,
             falar: 'Viagem encerrada. ' + minTot + ' minutos, velocidade máxima de ' + v.maxVel + ' quilômetros por hora.' };
  }

  if (!v) v = { inicio: agora, em: agora, maxVel: 0, avisos: 0, ultFadiga: 0, ultExcesso: 0, ultChegada: 0 };
  v.em = agora;
  if (vel > v.maxVel) v.maxVel = vel;

  // LIMITE DA VIA lido do SELO que o proprio Google Maps desenha na tela (text_badge_label).
  // Isso dispensa a Roads API paga — mas so vale quando o Maps esta navegando E mostrando o selo.
  // Sem ele, cai no limite que o Bruno configurou. Faixa sanitaria 20..130 para nao aceitar lixo
  // de leitura de tela (um "200" vindo de outro campo viraria licenca para qualquer velocidade).
  var limiteTela = Number(String(d.limiteTela || d.limite_tela || '').replace(/[^\d]/g, ''));
  var limiteDaVia = (isFinite(limiteTela) && limiteTela >= 20 && limiteTela <= 130) ? limiteTela : 0;
  var limite = limiteDaVia || ((vel >= cfg.corteRodovia) ? cfg.limiteRodovia : cfg.limiteUrbano);
  var origemLimite = limiteDaVia ? 'placa' : 'configurado';
  var falas = [];

  // EXCESSO — rede de segurança. O aviso rápido é do aparelho; aqui só entra se ele persistir,
  // com cooldown de 3 min para não virar ladainha num trecho inteiro acima do limite.
  if (vel > limite + cfg.toleranciaKmh && (agora - v.ultExcesso) > 180000) {
    falas.push('Bruno, ' + vel + ' quilômetros por hora. ' + (origemLimite === 'placa' ? 'A via é ' : 'Seu limite aqui é ') + limite + '.');
    v.ultExcesso = agora; v.avisos = (v.avisos || 0) + 1;
  }

  // FADIGA — tempo ao volante. Regra de trânsito, não invenção: parada a cada 2 h é recomendação
  // consolidada. Cooldown de 30 min depois do primeiro aviso.
  var minDirigindo = Math.round((agora - v.inicio) / 60000);
  if (minDirigindo >= cfg.fadigaMin && (agora - v.ultFadiga) > 1800000) {
    falas.push('Você está dirigindo há ' + Math.round(minDirigindo / 60) + ' horas. Vale parar para descansar.');
    v.ultFadiga = agora;
  }

  // CHEGADA — lida da tela do Maps. Uma vez só.
  var kmNum = Number(String(km).replace(',', '.').replace(/[^\d.]/g, ''));
  if (isFinite(kmNum) && kmNum > 0 && kmNum <= 2 && !v.ultChegada) {
    falas.push('Chegando' + (eta ? ', ' + eta : '') + '.');
    v.ultChegada = agora;
  }

  _viagemSalvar(v);
  return { ok: true, falar: falas.join(' '), velocidade: vel, limite: limite, origemLimite: origemLimite,
           minutos: minDirigindo, maxVelocidade: v.maxVel };
}

/** Diag/config da viagem. args {limiteUrbano, limiteRodovia, fadigaMin, tolerancia} para ajustar. */
function diagViagem(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limiteUrbano  !== undefined) p.setProperty('VIAGEM_LIMITE_URBANO',  String(Number(args.limiteUrbano)));
  if (args.limiteRodovia !== undefined) p.setProperty('VIAGEM_LIMITE_RODOVIA', String(Number(args.limiteRodovia)));
  if (args.corteRodovia  !== undefined) p.setProperty('VIAGEM_CORTE_RODOVIA',  String(Number(args.corteRodovia)));
  if (args.fadigaMin     !== undefined) p.setProperty('VIAGEM_FADIGA_MIN',     String(Number(args.fadigaMin)));
  if (args.tolerancia    !== undefined) p.setProperty('VIAGEM_TOLERANCIA',     String(Number(args.tolerancia)));
  if (args.encerrar === true) return registrarViagem({ encerrar: true });
  var v = _viagemLer();
  return { ok: true, config: _viagemCfg(), dirigindo: _viagemAtiva(),
           viagem: v ? { minutos: Math.round((Date.now() - v.inicio) / 60000), maxVelocidade: v.maxVel,
                         avisos: v.avisos, ultimoSinalHaSeg: Math.round((Date.now() - v.em) / 1000) } : null,
           nota: 'Os limites são ESCOLHA sua — o Jarvis não lê a placa da via. Roads API do Google é paga.' };
}

/* ===================== MEMÓRIA DE CONVERSAS — INDEXAÇÃO E PODA =====================
 * O `MemoriaConversas.js` estava escrito e a ferramenta de recall JÁ estava ligada no Jarvis.js,
 * mas a coleção `conversa_vetores` tinha ZERO documentos: ninguém nunca rodou a indexação. O
 * agente tinha a capacidade de lembrar conversas antigas e nada para lembrar.
 *
 * POR QUE ISSO IMPORTA MAIS DO QUE PARECE. Hoje a continuidade da conversa vem de uma janela
 * cega de 2 horas — arrasta os últimos turnos independentemente de terem a ver com a pergunta.
 * Foi um remendo para a contaminação de histórico (em 10/08 "quero ouvir sua ideia" recebeu a
 * confirmação de TURNO, porque era o que estava no histórico). A janela resolve contaminação
 * jogando contexto fora — inclusive o relevante.
 *
 * Com o índice ligado, o recall passa a ser POR RELEVÂNCIA e sob demanda: em vez de carregar as
 * últimas 2 h sempre, busca o trecho que tem a ver com a pergunta, de qualquer conversa. É a
 * diferença entre lembrar do que veio antes e lembrar do que interessa.
 *
 * A PODA é guarda de armazenamento, não política de esquecimento — e a distinção é deliberada.
 * Apagar por idade descartaria justamente o que memória durável deveria preservar. O padrão é
 * generoso (365 dias) e existe só para a coleção não crescer sem teto.
 */
var _MEM_DIAS_PROP = 'MEMORIA_CONVERSAS_DIAS';

/** Remove vetores de trechos mais antigos que `dias`. Guarda de tamanho, não esquecimento. */
function _memPodar(dias) {
  var corte = Date.now() - Number(dias) * 86400000;
  var n = 0;
  try {
    (Firestore.listDocs('conversa_vetores', 2000) || []).forEach(function (d) {
      var ts = Number((d.dados || {}).ts || 0);
      if (ts && ts < corte) { try { Firestore.deleteDoc('conversa_vetores', d.id); n++; } catch (e) {} }
    });
  } catch (e2) {}
  return n;
}

/** JOB: indexa a memória de conversas (resumível) e poda o que passou da retenção. */
function jobMemoriaConversas(args) {
  args = args || {};
  if (typeof MemoriaConversas === 'undefined') return { ok: false, erro: 'MemoriaConversas indisponível.' };
  var dias = Number(PropertiesService.getScriptProperties().getProperty(_MEM_DIAS_PROP) || 365);
  var r = null;
  // budget curto: o gatilho roda todo dia, então 'continuar' é normal — retoma amanhã de onde parou.
  try { r = MemoriaConversas.indexar({ budgetMs: args.budgetMs || 240000, maxPares: args.maxPares || 60 }); }
  catch (e) { return { ok: false, erro: e.message }; }
  var podados = (args.podar === false) ? 0 : _memPodar(dias);
  var st = null; try { st = MemoriaConversas.status(); } catch (e3) {}
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'memoriaConversas', ok: true, ms: 0,
      resumo: 'indexados=' + (r.pares || 0) + ' pulados=' + (r.pulados || 0) + ' podados=' + podados +
              ' total=' + (st ? st.pares : '?') + ' status=' + (r.status || 'ok')
    });
  } catch (e4) {}
  return { ok: true, indexacao: r, podados: podados, retencaoDias: dias, total: st };
}

/** Instala o gatilho diário da memória. args {hora:3} · {dias:365} · {desligar:true}. */
function configurarMemoriaConversas(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.dias !== undefined) p.setProperty(_MEM_DIAS_PROP, String(Number(args.dias)));
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'jobMemoriaConversas') { ScriptApp.deleteTrigger(t); removidos++; }
  });
  if (args.desligar === true) return { ok: true, removidos: removidos, instalado: false };
  var hora = Number(args.hora); if (!isFinite(hora) || hora < 0 || hora > 23) hora = 3;
  ScriptApp.newTrigger('jobMemoriaConversas').timeBased().everyDays(1).atHour(hora).create();
  return { ok: true, removidos: removidos, instalado: true, hora: hora,
           retencaoDias: Number(p.getProperty(_MEM_DIAS_PROP) || 365) };
}

/** Diag da memória: quantos pares indexados, de quantas conversas. */
function diagMemoriaConversas(args) {
  args = args || {};
  if (typeof MemoriaConversas === 'undefined') return { ok: false, erro: 'MemoriaConversas indisponível.' };
  if (args.indexar === true) return jobMemoriaConversas({ podar: false });
  var st = null; try { st = MemoriaConversas.status(); } catch (e) { return { ok: false, erro: e.message }; }
  return { ok: true, pares: st.pares, conversas: st.conversas,
           retencaoDias: Number(PropertiesService.getScriptProperties().getProperty(_MEM_DIAS_PROP) || 365),
           nota: st.pares === 0 ? 'Índice VAZIO — o recall entre conversas não funciona sem ele.' : 'Recall entre conversas ativo.' };
}

/** "O que eu perdi?" — extraido de dentro do doPost para poder entrar no golden set.
 *  Estava como regex solta na cadeia; regex que ninguem testa e regex que quebra calada. */
function _interpretarPerdi(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(o que (eu )?perdi|perdi algo|perdi alguma coisa|que chegou|chegou algo|alguma notificacao|tem notificacao|novidades? no celular|me atualiza)\b/.test(s) ? true : null;
}

/* ===================== GOLDEN SET DA CADEIA DE VOZ =====================
 * Regressao para os atalhos deterministicos. A motivacao e concreta: em 12/08 um `\b` virou
 * caractere de backspace (codigo 8) dentro de uma regex — `grep` nao achou, `node --check` passou,
 * e so apareceu inspecionando charCodeAt. Uma regex pode quebrar em SILENCIO, e o sintoma (o
 * pedido cai no LLM) parece comportamento normal.
 *
 * COBERTURA — e importante ser honesto sobre o limite:
 *  · COBERTOS os 7 interpretadores que sao FUNCOES compartilhadas (financeiro, turno, insight,
 *    perdi, lembrete condicional, rotina, biblia). Sao os que mudaram nesta semana.
 *  · NAO cobertos spotify/youtube/google/rota/compras/ligar/podcast/abrir-app/controles nativos:
 *    vivem como IIFE dentro do doPost e testa-los exigiria duplicar a regex aqui — duplicata que
 *    envelhece e passa a mentir. Extrai-los e o proximo passo, um de cada vez.
 *  · FORA por natureza: voto e oferta de insight dependem de janela de tempo em cache.
 *
 * O previsor respeita a ORDEM REAL da cadeia. Uma ressalva registrada: no doPost os controles
 * nativos (_ctl) rodam ENTRE rotina e biblia; como nao sao cobertos, uma frase ambigua entre
 * controle nativo e biblia seria prevista errada. As frases do conjunto evitam essa zona.
 */
function _preverRotaDeterministica(msg) {
  var m = String(msg || '');
  var r;
  try { r = _interpretarFatoVoz(m); if (r) return r.via; } catch (e) {}   // vem antes de tudo, como na cadeia
  try { r = _interpretarFinanceiro(m); if (r !== null && r !== undefined) return 'financeiro'; } catch (e) {}
  try { r = _interpretarTurnoTrabalho(m); if (r !== null && r !== undefined) return 'turno'; } catch (e) {}
  try { r = _interpretarInsight(m); if (r) return 'insight_' + r.acao; } catch (e) {}
  try { if (_interpretarPerdi(m) !== null) return 'notificacoes'; } catch (e) {}
  try { r = _interpretarLembreteCondicional(m); if (r) return 'lembrete_condicional'; } catch (e) {}
  try { r = _interpretarRotina(m); if (r) return 'rotina:' + r; } catch (e) {}
  try { r = _interpretarBiblia(m); if (r) return 'biblia'; } catch (e) {}
  return 'nao_coberto';   // cai nos inline do doPost ou no LLM
}

/* Casos canonicos. Cada um nasceu de uma frase REAL ou de uma armadilha REAL. */
var _GOLDEN_VOZ = [
  // --- financeiro: as duas listas de palavras ja divergiram e 'cartao alimentacao' so casava numa
  ['quanto tenho no cartao alimentacao', 'financeiro'],
  ['Ok quanto eu tenho no cartão alimentação', 'financeiro'],
  ['quanto tem na mobilidade', 'financeiro'],
  ['quanto eu gastei essa semana', 'financeiro'],
  ['qual o saldo do swile', 'financeiro'],
  // --- turno: o \b antes de 'manha' e o que impede 'amanha' de casar
  ['essa semana eu trabalho a tarde', 'turno'],
  ['meu turno essa semana e manha', 'turno'],
  ['vou trabalhar amanha', 'nao_coberto'],          // ARMADILHA: 'amanha' contem 'manha'
  ['amanha eu descanso', 'nao_coberto'],
  // --- insight: gravar tem de ser testado ANTES de pedir
  ['me da uma ideia', 'insight_pedir'],
  ['quero ouvir sua ideia', 'insight_pedir'],
  ['anota essa ideia na wiki', 'insight_gravar'],
  ['anote isso na Wiki e depois falaremos', 'insight_gravar'],
  ['anota na wiki que comprei um carro', 'nao_coberto'],   // ARMADILHA: verbo sem referencia a ideia
  ['boa ideia', 'nao_coberto'],
  // --- notificacoes
  ['o que eu perdi', 'notificacoes'],
  ['que horas sao', 'relogio'],
  ['me diga a data atual e a hora atual', 'relogio'],
  ['que horas eu bato o ponto', 'nao_coberto'],    // ARMADILHA: 'que horas' que NAO e o relogio
  ['o que eu tenho na agenda amanha', 'agenda'],
  ['me fala minha agenda de hoje', 'agenda'],
  ['marca uma reuniao amanha as 10h', 'nao_coberto'],
  ['me atualiza', 'notificacoes'],
  // --- rotina composta
  ['modo cinema', 'rotina:cinema'],
  ['sair do modo cinema', 'rotina:cinema_off'],
  ['modo foco', 'rotina:foco'],
  // --- biblia
  ['abre a biblia no salmo 23', 'biblia'],
  ['leia joao 3 versiculo 16', 'biblia'],
  ['salmo 23:1', 'biblia'],                        // caminho do formato cap:vers
  // TRAVA DELIBERADA, virada teste: sem a palavra biblia/versiculo e sem 'cap:vers', NAO casa.
  // Sem essa guarda, qualquer 'palavra + numero' viraria referencia biblica.
  ['salmo 23', 'nao_coberto'],
  // --- lembrete condicional
  ['quando eu chegar em casa me lembre de pagar o boleto', 'lembrete_condicional'],
  // --- tem de cair fora dos atalhos
  ['bom dia jarvis', 'nao_coberto'],
  ['qual a previsao do tempo', 'nao_coberto'],
  ['obrigado', 'nao_coberto']
];

/** Roda o golden set. args {casos:[[frase,esperado],...]} substitui o conjunto padrao. */
function diagGoldenVoz(args) {
  args = args || {};
  var casos = Array.isArray(args.casos) && args.casos.length ? args.casos : _GOLDEN_VOZ;
  var falhas = [], passou = 0;
  casos.forEach(function (c) {
    var frase = c[0], esperado = c[1], obtido;
    try { obtido = _preverRotaDeterministica(frase); } catch (e) { obtido = 'ERRO: ' + e.message; }
    if (obtido === esperado) passou++;
    else falhas.push({ frase: frase, esperado: esperado, obtido: obtido });
  });
  return { ok: falhas.length === 0, total: casos.length, passou: passou,
           falhou: falhas.length, falhas: falhas };
}

/* ===================== AUTO-DIAGNÓSTICO DIÁRIO =====================
 * O Jarvis tem mais de 20 funções de diagnóstico e NENHUMA era executada por ninguém — eram
 * instrumento sem operador. Todo defeito desta semana (ponto mudo, áudio sequestrado, transições
 * invisíveis) precisou de uma sessão forense para aparecer. O que denunciou o último foi uma conta
 * simples: o contador de proatividade dizia 3 e o log tinha 1.
 *
 * Este job faz essa conferência sozinho, todo dia, e SÓ FALA QUANDO ALGO ESTÁ ERRADO. Silêncio é
 * o resultado esperado — um relatório diário que sempre fala vira ruído e deixa de ser lido.
 *
 * Regras de projeto:
 *  · Somente leitura. Nenhuma verificação altera estado (senão o diagnóstico vira efeito colateral).
 *  · Compara com o dia anterior: o que interessa é MUDANÇA, não estado. "Sisponto mudo" é normal
 *    desde sempre; "Bradesco parou de chegar" é novidade e merece aviso.
 *  · Cada achado tem severidade. Só `alta` fala em voz alta; o resto fica no relatório.
 *  · Passa pela governança proativa (cooldown/silêncio/teto) como qualquer outra interrupção.
 */
var _AUTODIAG_KEY = 'AUTODIAG_SNAPSHOT';

function _autodiagLerSnapshot() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_AUTODIAG_KEY) || 'null'); }
  catch (e) { return null; }
}

/** Roda as verificações. Devolve {achados:[{chave,severidade,texto}], estado:{...}}. NÃO fala. */
function _autodiagVerificar() {
  var achados = [], estado = {};
  var ant = _autodiagLerSnapshot() || {};
  var agora = Date.now();

  // 1) NOTIFICAÇÕES — app que CHEGAVA e parou é o sinal mais valioso (macro quebrada, app deslogado).
  try {
    var an = diagAppsNotificacao({});
    estado.apps = (an.apps || []).map(function (x) { return x.app; });
    estado.semTrafego = (an.regrasSemTrafego || []).map(function (x) { return x.regra; });
    estado.pontoArmado = !!(an.ponto && an.ponto.armado);
    if (ant.apps && ant.apps.length) {
      var sumiram = ant.apps.filter(function (x) { return estado.apps.indexOf(x) === -1; });
      if (sumiram.length) achados.push({ chave: 'app_sumiu', severidade: 'alta',
        texto: 'Parei de receber notificações de ' + sumiram.join(', ') + '.' });
    }
    var novasSem = estado.semTrafego.filter(function (x) { return (ant.semTrafego || []).indexOf(x) === -1; });
    if (novasSem.length) achados.push({ chave: 'regra_sem_trafego', severidade: 'media',
      texto: 'Regra sem tráfego nova: ' + novasSem.join(', ') + '.' });
  } catch (e1) { achados.push({ chave: 'erro_notif', severidade: 'media', texto: 'Falha ao checar notificações: ' + e1.message }); }

  // 2) ALERTAS DE VOZ — falha registrada, ou alerta que não dispara há dias (dia útil).
  try {
    var alertas = (typeof AlertasVoz !== 'undefined') ? AlertasVoz.listar() : [];
    var falhos = alertas.filter(function (a) { return a.ultResultado && a.ultResultado.ok === false; });
    if (falhos.length) achados.push({ chave: 'alerta_falhou', severidade: 'alta',
      texto: falhos.length + ' alerta(s) de voz falharam: ' + falhos.map(function (a) { return _hhmmSimples(a); }).join(', ') + '.' });
    estado.alertas = alertas.length;
  } catch (e2) {}

  // 3) LATÊNCIA DA FALA — usa os spans; sem eles não dá para dizer ONDE está lento, só QUE está.
  try {
    var evs = Firestore.listDocs('agente_eventos', 120) || [];
    var falas = [], erros = 0, corte24 = agora - 86400000;
    evs.forEach(function (x) {
      var d = x.dados || {}; var t = d.ts ? new Date(d.ts).getTime() : 0;
      if (t < corte24) return;
      if (d.ok === false) erros++;
      if (String(d.tool || '').indexOf('alertaVoz:') === 0 && Number(d.ms) > 0) falas.push(Number(d.ms));
    });
    if (erros > 0) achados.push({ chave: 'eventos_erro', severidade: 'alta',
      texto: erros + ' evento(s) com falha nas últimas 24 horas.' });
    if (falas.length) {
      var media = Math.round(falas.reduce(function (a, b) { return a + b; }, 0) / falas.length);
      estado.falaMediaMs = media;
      if (ant.falaMediaMs && media > ant.falaMediaMs * 3 && media > 30000) {
        achados.push({ chave: 'fala_lenta', severidade: 'media',
          texto: 'A fala está levando ' + Math.round(media / 1000) + ' segundos, contra ' + Math.round(ant.falaMediaMs / 1000) + ' ontem.' });
      }
    }
  } catch (e3) {}

  // 4) INDEXAÇÃO DA WIKI — página escrita e não indexada é página invisível para a busca.
  try {
    var ix = diagIndexacao({});
    estado.wikiTotal = Number(ix.totalNaWiki || 0);
    if (Number(ix.mudados || 0) > 5) achados.push({ chave: 'wiki_desatualizada', severidade: 'baixa',
      texto: ix.mudados + ' páginas da wiki aguardando indexação.' });
  } catch (e4) {}

  // 5) TELEMETRIA — se o celular parou de reportar, TUDO que depende de presença morre em silêncio.
  try {
    var tel = Firestore.listDocs('telemetria_dispositivo', 5) || [];
    var maisNova = 0;
    tel.forEach(function (x) {
      var r = (x.dados || {}).recebidoEm; var t = r ? new Date(r).getTime() : 0;
      if (t > maisNova) maisNova = t;
    });
    if (maisNova) {
      var horas = Math.round((agora - maisNova) / 3600000);
      estado.telemetriaHoras = horas;
      if (horas >= 3) achados.push({ chave: 'telemetria_parada', severidade: 'alta',
        texto: 'O celular não reporta há ' + horas + ' horas — presença e cobrança de ponto estão cegas.' });
    }
  } catch (e5) {}

  // 6) REGRESSÃO DOS ATALHOS. Barato (só regex, sem I/O) e pega a classe de bug mais traiçoeira:
  // atalho que parou de casar. O sintoma — o pedido cair no LLM — parece funcionamento normal.
  try {
    var g = diagGoldenVoz({});
    estado.goldenFalhou = g.falhou;
    if (g.falhou > 0) achados.push({ chave: 'golden_voz', severidade: 'alta',
      texto: g.falhou + ' atalho(s) de voz pararam de funcionar: ' +
             g.falhas.slice(0, 3).map(function (x) { return '"' + x.frase + '"'; }).join(', ') + '.' });
  } catch (e6) {}

  // 7) MEMÓRIA DE CONVERSAS. Índice vazio = a ferramenta de recall existe e não acha nada —
  // falha silenciosa clássica: o agente responde "não encontrei" e parece limitação, não defeito.
  try {
    var mem = diagMemoriaConversas({});
    estado.memPares = Number(mem.pares || 0);
    if (estado.memPares === 0) achados.push({ chave: 'memoria_vazia', severidade: 'media',
      texto: 'O índice de memória de conversas está vazio — o recall entre conversas não funciona.' });
  } catch (e7) {}

  estado.em = agora;
  return { achados: achados, estado: estado, anterior: ant };
}

/** hh:mm de um alerta, para o texto do achado. */
function _hhmmSimples(a) {
  return ('0' + Number(a.hora)).slice(-2) + ':' + ('0' + Number(a.minuto || 0)).slice(-2);
}

/** JOB diário. args {simular:true} não fala nem grava snapshot. */
function jobAutoDiagnostico(args) {
  args = args || {};
  var simular = args.simular === true;
  var r = _autodiagVerificar();
  var altas = r.achados.filter(function (a) { return a.severidade === 'alta'; });

  // Só fala se houver achado de severidade alta. Relatório que fala todo dia vira ruído.
  var falou = null;
  if (altas.length && !simular) {
    var txt = 'Bruno, diagnóstico do dia. ' + altas.map(function (a) { return a.texto; }).join(' ');
    try { falou = _falarProativo('autodiag', txt, { cooldownMin: 720, simular: false }); } catch (eF) {}
  }

  if (!simular) {
    try { PropertiesService.getScriptProperties().setProperty(_AUTODIAG_KEY, JSON.stringify(r.estado)); } catch (eS) {}
    try {
      if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
        tool: 'autodiag', ok: true, ms: 0,
        resumo: r.achados.length ? r.achados.map(function (a) { return a.severidade[0] + ':' + a.chave; }).join(' ') : 'tudo em ordem'
      });
    } catch (eE) {}
  }

  return { ok: true, simulado: simular, achados: r.achados, altas: altas.length,
           falou: falou ? falou.falou : false, estado: r.estado, anterior: r.anterior };
}

/** Instala o gatilho diário do auto-diagnóstico. args {hora:8} · {desligar:true}. */
function configurarAutoDiagnostico(args) {
  args = args || {};
  var achou = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'jobAutoDiagnostico') { ScriptApp.deleteTrigger(t); achou++; }
  });
  if (args.desligar === true) return { ok: true, removidos: achou, instalado: false };
  var hora = Number(args.hora); if (!isFinite(hora) || hora < 0 || hora > 23) hora = 8;
  ScriptApp.newTrigger('jobAutoDiagnostico').timeBased().everyDays(1).atHour(hora).create();
  return { ok: true, removidos: achou, instalado: true, hora: hora };
}

/** Diag sob demanda: roda tudo SEM falar e sem gravar snapshot. */
function diagAutoDiagnostico(args) {
  args = args || {};
  return jobAutoDiagnostico({ simular: args.executar !== true });
}

/** QUAIS APPS O JARVIS RECEBE DE FATO. Responde a pergunta que não dava para responder de fora:
 *  o filtro de verdade mora na macro do MacroDroid (no aparelho), e daqui só dá para ver o que
 *  CHEGOU. Então o relatório é por evidência: app que apareceu, quando, e qual regra o pegaria.
 *  A parte útil é a última — regra configurada que nunca viu tráfego é sinal de app faltando
 *  no filtro da macro (foi assim que o Sisponto e o AgendaKids apareceram como ausentes). */
function diagAppsNotificacao(args) {
  args = args || {};
  // Teto na RETENÇÃO real: a coleção é podada em _NOTIF_RETENCAO_DIAS, então pedir 14 dias devolve
  // 7 e faz app que chegou há mais tempo parecer ausente do filtro (o LinkedIn caiu nessa).
  var dias = Math.min(Number(args.dias || _NOTIF_RETENCAO_DIAS), _NOTIF_RETENCAO_DIAS);
  var corte = Date.now() - dias * 86400000;
  var p = PropertiesService.getScriptProperties();
  var vistos = {};
  try {
    _notifLer(500).forEach(function (n) {
      var em = Number(n.d.em || 0); if (em < corte) return;
      var app = String(n.d.app || '(sem nome)');
      if (!vistos[app]) vistos[app] = { app: app, n: 0, ultimo: 0 };
      vistos[app].n++; if (em > vistos[app].ultimo) vistos[app].ultimo = em;
    });
  } catch (e) { return { ok: false, erro: e.message }; }

  var regras = _notifRegras();
  var comTrafego = {};
  // Casa SÓ o app da regra, ignorando o `padrao`. Usar o matcher completo aqui era erro meu:
  // regra com padrao (boleto, vaga, entrega) nunca casa com texto vazio, então Bradesco e
  // LinkedIn — que CHEGAM — apareciam como "regra sem tráfego" e afogavam o sinal real,
  // que é app ausente do filtro da macro. Aqui a pergunta é só "esse app chega?".
  function _appCasa(regra, nomeApp) {
    if (!regra.app) return false;
    try { return new RegExp(regra.app, 'i').test(String(nomeApp || '')); }
    catch (e) { return String(nomeApp || '').toLowerCase().indexOf(String(regra.app).toLowerCase()) !== -1; }
  }
  var apps = Object.keys(vistos).map(function (k) {
    var v = vistos[k], ids = [];
    regras.forEach(function (r) { if (_appCasa(r, v.app)) { ids.push(r.id); comTrafego[r.id] = true; } });
    return { app: v.app, notificacoes: v.n,
             ultima: Utilities.formatDate(new Date(v.ultimo), 'America/Sao_Paulo', 'dd/MM HH:mm'),
             regras: ids.length ? ids.join(',') : null,
             acao: ids.length ? 'ver regras' : 'guardar (sem regra)' };
  }).sort(function (a, b) { return b.notificacoes - a.notificacoes; });

  var semTrafego = regras.filter(function (r) {
    return r.app && String(r.acao) !== 'ignorar' && !comTrafego[r.id];
  }).map(function (r) { return { regra: r.id, app: r.app, acao: r.acao }; });

  return { ok: true, dias: dias, retencaoDias: _NOTIF_RETENCAO_DIAS, totalApps: apps.length,
           total: apps.reduce(function (t, a) { return t + a.notificacoes; }, 0),
           apps: apps,
           regrasSemTrafego: semTrafego,
           nota: semTrafego.length ? 'Regra sem tráfego = app provavelmente fora do filtro da macro do MacroDroid.' : 'Toda regra ativa viu tráfego.',
           filtros: { NOTIF_APPS: p.getProperty('NOTIF_APPS') || '(vazio = aceita todos)',
                      NOTIF_FALAR_APPS: p.getProperty('NOTIF_FALAR_APPS') || '',
                      NOTIF_FALAR_JANELA: p.getProperty('NOTIF_FALAR_JANELA') || '06:00-20:00 (padrão)' },
           ponto: { app: p.getProperty('PONTO_APP') || 'sisponto (padrão)',
                    armado: !!p.getProperty('PONTO_APP_VISTO'),
                    nota: p.getProperty('PONTO_APP_VISTO') ? 'cobrança de ausência ATIVA'
                          : 'cobrança DESARMADA — arma sozinha na 1ª notificação do app de ponto' } };
}

/** Diag: {} lista · {simular:{app,titulo,texto}} testa qual regra casaria, SEM efeito colateral. */
function diagRegrasNotificacao(args) {
  args = args || {};
  if (args.simular) {
    var d = args.simular, regras = _notifRegras(), casou = null;
    for (var i = 0; i < regras.length; i++) {
      if (_notifRegraCasa(regras[i], d.app, d.pacote, d.titulo, d.texto)) { casou = regras[i]; break; }
    }
    return { ok: true, entrada: d, regra: casou,
             acaoQueSeria: casou ? (casou.acao === 'avisar' ? ('avisar → ' + _notifRoteia()) : casou.acao) : 'guardar (sem regra)',
             contextoAgora: { local: _insLocalAtual(), foraDoTurno: _insForaDoTurno(), podeFalar: _notifPodeFalar() } };
  }
  return configurarRegraNotificacao({});
}

/* ── DETECÇÃO DE AUSÊNCIA DO PONTO ────────────────────────────────────────────────────────
 * O inverso da proatividade comum, e o mais valioso: NÃO receber é informação. Se o horário do
 * ponto passou e nenhuma notificação do app de ponto chegou, provavelmente ele esqueceu.
 * Os horários vêm dos alertas tag:'ponto' — a mesma fonte do briefing, então segue troca de turno.
 */
function verificarPontoBatido(opts) {
  opts = opts || {};
  var p = PropertiesService.getScriptProperties();
  var appPonto = String(p.getProperty('PONTO_APP') || 'sisponto');
  var tolerancia = Number(p.getProperty('PONTO_TOLERANCIA_MIN') || 15);
  var agora = new Date(), dow = agora.getDay();
  var minAgora = agora.getHours() * 60 + agora.getMinutes();
  var hoje = Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd');

  // TRAVA DE ARMAÇÃO: só cobra se o app de ponto JÁ enviou alguma notificação alguma vez. Sem isso,
  // enquanto o Sisponto não estiver no filtro da macro, o Jarvis cobraria o ponto todo santo dia —
  // ausência de notificação por falta de integração não é ausência de registro.
  // Ferias/folga calam a cobranca junto com o lembrete. Cobrar ponto de quem esta de ferias
  // e pior que o lembrete: o lembrete fala uma vez, a cobranca insiste.
  var _pAte = p.getProperty('PONTO_PAUSA_ATE') || '';
  if (_pAte && Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd') <= _pAte) {
    return { ok: true, pausado: true, ate: _pAte, motivo: p.getProperty('PONTO_PAUSA_MOTIVO') || 'pausa' };
  }
  if (!p.getProperty('PONTO_APP_VISTO')) {
    return { ok: true, desarmado: true, motivo: 'nunca chegou notificação do ' + appPonto +
             ' — adicione-o ao filtro da macro para armar a cobrança' };
  }

  var pontos = [];
  try {
    pontos = AlertasVoz.listar().filter(function (a) {
      if (a.tag !== 'ponto') return false;
      var dias = Array.isArray(a.dias) ? a.dias : String(a.dias || '').split(',').map(Number);
      return dias.indexOf(dow) !== -1;
    }).map(function (a) { return { min: Number(a.hora) * 60 + Number(a.minuto || 0), texto: a.texto || '' }; });
  } catch (e) { return { ok: false, erro: 'sem alertas de ponto' }; }
  if (!pontos.length) return { ok: true, semPontoHoje: true };

  // O ponto "em cobrança" é o mais recente que já passou da tolerância (e não passou de 90 min).
  var alvo = null;
  pontos.forEach(function (pt) {
    var atraso = minAgora - pt.min;
    if (atraso >= tolerancia && atraso <= 90 && (!alvo || pt.min > alvo.min)) alvo = pt;
  });
  if (!alvo) return { ok: true, nenhumPontoVencido: true };

  var chave = 'PONTO_COBRADO_' + hoje + '_' + alvo.min;
  if (p.getProperty(chave)) return { ok: true, jaCobrado: true, ponto: alvo.min };

  // Chegou notificação do app de ponto perto do horário?
  var janelaIni = Date.now() - (minAgora - alvo.min + tolerancia) * 60000;
  var bateu = _notifLer(100).some(function (n) {
    return Number(n.d.em || 0) >= janelaIni &&
           String(n.d.app || '').toLowerCase().indexOf(appPonto.toLowerCase()) !== -1;
  });
  var hh = ('0' + Math.floor(alvo.min / 60)).slice(-2) + ':' + ('0' + (alvo.min % 60)).slice(-2);
  if (bateu) {
    if (!opts.simular) p.setProperty(chave, 'ok');
    return { ok: true, ponto: hh, confirmado: true };
  }
  var txt = 'Bruno, o ponto das ' + hh + ' já passou e eu não vi o registro. Você bateu?';
  var r = _falarProativo('ponto_ausente', txt, { cooldownMin: 60, simular: opts.simular });
  if (!opts.simular && r.falou === true) p.setProperty(chave, 'cobrado');
  return { ok: true, ponto: hh, confirmado: false, cobrou: r.falou, bloqueado: r.bloqueado || null, texto: txt };
}

/** Diag da cobrança de ponto. args {simular:false} cobra de verdade · {limpar:true}. */
function diagPonto(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.limpar === true) {
    var n = 0;
    p.getKeys().forEach(function (k) { if (k.indexOf('PONTO_COBRADO_') === 0) { p.deleteProperty(k); n++; } });
    return { ok: true, marcasRemovidas: n };
  }
  if (args.app !== undefined) p.setProperty('PONTO_APP', String(args.app));
  if (args.toleranciaMin !== undefined) p.setProperty('PONTO_TOLERANCIA_MIN', String(Number(args.toleranciaMin)));
  var r = verificarPontoBatido({ simular: args.simular !== false });
  r.config = { PONTO_APP: p.getProperty('PONTO_APP') || 'sisponto (padrão)',
               toleranciaMin: Number(p.getProperty('PONTO_TOLERANCIA_MIN') || 15) };
  return r;
}

/* ===================== LEMBRETES CONDICIONAIS (por presença) =====================
 * "Quando eu chegar em casa, me lembre de pagar o boleto." A peça difícil (saber ONDE ele está) já
 * existe — aqui é só uma fila pendurada nas transições de presença.
 * Regras de projeto:
 *  · O DONO pediu → não conta no orçamento diário de interrupções (não é o Jarvis se intrometendo).
 *  · À NOITE (janela de silêncio) entrega por NOTIFICAÇÃO em vez de voz — não acorda ninguém.
 *  · Dispara UMA vez e se desativa; expira sozinho depois de validadeDias (default 7).
 */
var _LEMB_KEY = 'LEMBRETES_CONDICIONAIS';
var _GATILHOS_LEMBRETE = ['chegou_casa', 'chegou_trabalho', 'saiu_casa', 'saiu_trabalho'];

function _lembLer() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_LEMB_KEY) || '[]'); } catch (e) { return []; } }
function _lembSalvar(a) { PropertiesService.getScriptProperties().setProperty(_LEMB_KEY, JSON.stringify(a || [])); }

/** Estamos dentro da janela de silêncio noturno? (mesma property da governança) */
function _dentroDoSilencio(quando) {
  var janela = String(PropertiesService.getScriptProperties().getProperty('PROATIVO_SILENCIO') || '22:30-07:00');
  var m = janela.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  var d = quando || new Date();
  var atual = d.getHours() * 60 + d.getMinutes();
  var ini = Number(m[1]) * 60 + Number(m[2]), fim = Number(m[3]) * 60 + Number(m[4]);
  return (ini <= fim) ? (atual >= ini && atual < fim) : (atual >= ini || atual < fim);
}

/* AVISO PROATIVO AO DONO -- um caminho so, e ele vai para o CELULAR.
 * Ate 23/09 cada modulo avisava por conta propria com WhatsApp.enviar: resultado de tarefa
 * agendada, monitor de e-mail, Heartbeat, objetivo concluido, pagina monitorada, alerta de
 * seguranca. A Evolution saiu do ar em 10/07 (o Railway removeu o servico) e o Bruno decidiu
 * mante-la desligada -- desde entao TODOS esses avisos falhavam calados, dentro de try/catch
 * vazio. O Heartbeat, que existe para avisar quando algo para, parou de avisar sem ninguem saber.
 * Agora: notificacao silenciosa sempre (evento jarvis_notificar da macro Jarvis Notificar) e,
 * so quando o chamador passa `falar`, voz tambem -- fora da janela de silencio. Texto de
 * notificacao e curto por construcao: vai na query da URL do MacroDroid, e o UrlFetch tem teto
 * de 2 KB de URL (acento vira %C3%A7, ate 6x o tamanho).
 * o {origem, titulo, texto, falar?} → {ok, notificacao, fala} */
function _avisarDono(o) {
  o = o || {};
  var limpar = function (s) {   // markdown do WhatsApp (*negrito*, _italico_, `codigo`) vira ruido na notificacao
    return String(s || '').replace(/[*_`]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  var titulo = limpar(o.titulo || 'Jarvis').substring(0, 60);
  var texto = limpar(o.texto);
  if (texto.length > 400) texto = texto.substring(0, 399).replace(/\s+\S*$/, '') + '…';
  var r = { ok: false, notificacao: null, fala: null };
  if (typeof Jarvis === 'undefined' || !Jarvis.controlarDispositivo) return r;
  try { r.notificacao = Jarvis.controlarDispositivo({ acao: 'notificar', titulo: titulo, texto: texto }); } catch (eN) { r.notificacao = { status: 'error', erro: eN.message }; }
  if (o.falar && !_dentroDoSilencio()) {
    try { r.fala = Jarvis.controlarDispositivo({ acao: 'falar', texto: String(o.falar) }); } catch (eF) { r.fala = { status: 'error', erro: eF.message }; }
  }
  r.ok = !!(r.notificacao && r.notificacao.status === 'success');
  // Rastro no mesmo log das ferramentas: aviso que nao chega precisa ser visivel em algum lugar.
  try {
    if (Jarvis.registrarEvento) Jarvis.registrarEvento({
      tool: 'aviso:' + (o.origem || 'geral'), ok: r.ok, ms: 0,
      resumo: r.ok ? (titulo + ' — ' + texto).substring(0, 160) : ('FALHOU: ' + ((r.notificacao && (r.notificacao.erro || r.notificacao.status)) || 'sem resposta'))
    });
  } catch (eEv) {}
  return r;
}

/** Cria um lembrete condicional. args {gatilho, texto, validadeDias?, repetir?}. */
function criarLembreteCondicional(args) {
  args = args || {};
  var g = String(args.gatilho || '').trim();
  if (_GATILHOS_LEMBRETE.indexOf(g) === -1) return { ok: false, erro: 'Gatilho inválido.', validos: _GATILHOS_LEMBRETE };
  var texto = String(args.texto || '').trim();
  if (!texto) return { ok: false, erro: 'Informe o texto do lembrete.' };
  var arr = _lembLer();
  // repetir:true = não se consome ao disparar (vale até vencer a validade). Veio do store antigo.
  var item = { id: Utilities.getUuid().slice(0, 8), gatilho: g, texto: texto,
               validadeDias: Number(args.validadeDias || 7), repetir: args.repetir === true,
               criadoEm: Date.now(), ativo: true, disparadoEm: null };
  arr.push(item); _lembSalvar(arr);
  return { ok: true, lembrete: item, pendentes: arr.filter(function (x) { return x.ativo !== false; }).length };
}

/** Lista os lembretes (por padrão só os pendentes). args {todos:true} inclui os já disparados. */
function listarLembretesCondicionais(args) {
  args = args || {};
  var arr = _lembLer();
  var lista = args.todos === true ? arr : arr.filter(function (x) { return x.ativo !== false; });
  return { ok: true, total: lista.length, lembretes: lista.map(function (l) {
    return { id: l.id, gatilho: l.gatilho, texto: l.texto, ativo: l.ativo !== false,
             criadoEm: new Date(l.criadoEm).toISOString(), validadeDias: l.validadeDias,
             disparadoEm: l.disparadoEm ? new Date(l.disparadoEm).toISOString() : null }; }) };
}

/** Cancela/remove um lembrete. args {id} ou {limparTodos:true}. */
function cancelarLembreteCondicional(args) {
  args = args || {};
  var arr = _lembLer();
  if (args.limparTodos === true) { _lembSalvar([]); return { ok: true, removidos: arr.length }; }
  var id = String(args.id || '');
  var antes = arr.length;
  arr = arr.filter(function (l) { return l.id !== id; });
  _lembSalvar(arr);
  return { ok: antes !== arr.length, removidos: antes - arr.length, restantes: arr.length };
}

/** Dispara os lembretes pendentes de um gatilho (chamado pela máquina de transições). */
function _dispararLembretesDe(gatilho, opts) {
  opts = opts || {};
  var arr = _lembLer(), agora = Date.now(), mudou = false, entregues = [], expirados = 0;
  var noite = _dentroDoSilencio();
  arr.forEach(function (l) {
    if (l.ativo === false) return;
    if (l.validadeDias > 0 && (agora - l.criadoEm) > l.validadeDias * 86400000) {
      if (!opts.simular) { l.ativo = false; mudou = true; }
      expirados++; return;
    }
    if (l.gatilho !== gatilho) return;
    // MODO COLETA: não fala aqui. A fala do celular grava um arquivo TTS e a macro toca uma URL
    // FIXA — duas falas no mesmo ciclo sobrescrevem o arquivo com a primeira ainda tocando, e o
    // áudio sai cortado e emendado (foi o que aconteceu na chegada em casa: lembrete do boleto +
    // saudação com e-mails). Quem coleta junta tudo numa fala só e consome depois do sucesso.
    if (opts.coletar && opts.coletar.push) {
      // termina em ponto: sem isso a fala emenda 'guarda-chuva Lembrete: passar no mercado'.
      opts.coletar.push(noite ? null : ('Lembrete: ' + String(l.texto).replace(/[.\s]+$/, '') + '.'));
      if (opts.pendentes && opts.pendentes.push) opts.pendentes.push(l.id);
      if (noite && !opts.simular) {   // madrugada: notificação silenciosa, fora da fala
        try { Jarvis.controlarDispositivo({ acao: 'notificar', titulo: 'Lembrete do Jarvis', texto: l.texto }); } catch (eN) {}
      }
      entregues.push({ id: l.id, texto: l.texto, canal: noite ? 'notificacao' : 'voz-coletada', ok: true });
      return;
    }
    if (opts.simular) { entregues.push({ id: l.id, texto: l.texto, canal: noite ? 'notificacao' : 'voz', ok: 'simulado' }); return; }
    var res = null;
    if (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
      res = noite
        ? Jarvis.controlarDispositivo({ acao: 'notificar', titulo: 'Lembrete do Jarvis', texto: l.texto })
        : Jarvis.controlarDispositivo({ acao: 'falar', texto: 'Lembrete, Bruno: ' + l.texto });
    }
    var ok = !!(res && res.status === 'success');
    if (ok) { if (l.repetir !== true) l.ativo = false; l.disparadoEm = agora; mudou = true; }
    entregues.push({ id: l.id, texto: l.texto, canal: noite ? 'notificacao' : 'voz', ok: ok, repetir: l.repetir === true });
    try {
      if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
        Jarvis.registrarEvento({ tool: 'lembrete:' + gatilho, ms: 0, ok: ok, resumo: String(l.texto).substring(0, 120) });
      }
    } catch (eL) {}
  });
  if (mudou) _lembSalvar(arr);
  return { entregues: entregues, expirados: expirados };
}

/** Marca como entregues os lembretes coletados, DEPOIS que a fala única deu certo. */
function _lembConsumir(ids) {
  if (!ids || !ids.length) return 0;
  var arr = _lembLer(), n = 0, agora = Date.now();
  arr.forEach(function (l) {
    if (ids.indexOf(l.id) === -1) return;
    if (l.repetir !== true) l.ativo = false;
    l.disparadoEm = agora; n++;
  });
  if (n) _lembSalvar(arr);
  return n;
}

/** Texto livre → lembrete condicional. Cobre as DUAS ordens:
 *   (a) "quando eu chegar em casa, me lembre de pagar o boleto"
 *   (b) "me lembre de pagar o boleto quando eu chegar em casa"
 * A forma (b) e os verbos no presente ("chego"/"saio") vinham do parser do store antigo
 * LEMBRETES_PRESENCA, removido na consolidação — sem portá-los, consolidar seria regressão.
 * O texto é recortado de uma cópia SEM ACENTO mas COM A CAIXA ORIGINAL (toLowerCase não muda o
 * comprimento), então "ligar pro Emerson" não volta mais como "ligar pro emerson".
 */
function _interpretarLembreteCondicional(msg) {
  var base = String(msg || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  var s = base.toLowerCase();
  var VERBO = '(chegar|chego|sair|saio|voltar|volto|estiver)';
  var LUGAR = '(casa|lar|trabalho|servico|firma|empresa|escritorio)';
  var PREP  = '(?:n?[oa]s?\\s+|em\\s+|d[eoa]\\s+|para\\s+|pra\\s+)?';
  var COND  = '(?:quando|assim que|se|ao|logo que)';

  function alvo(verbo, lugar) {
    var local = /casa|lar/.test(lugar) ? 'casa' : 'trabalho';
    return (/^(sair|saio)$/.test(verbo) ? 'saiu_' : 'chegou_') + local;
  }
  // tira o "me lembre de / me avise de / lembra de..." da frente do conteúdo
  function limpar(t) {
    return String(t || '')
      .replace(/^(?:me\s+)?(?:lembr\w+|avis\w+|recorde|fala\w*|diga?)\s*(?:-?me)?\s*(?:de\s+|para\s+|pra\s+|que\s+)?/i, '')
      .replace(/[\s.,;:!?]+$/, '').trim();
  }

  // (a) condição na frente
  var m = s.match(new RegExp('^' + COND + '\\s+(?:eu\\s+)?' + VERBO + '\\s+' + PREP + LUGAR + '\\b[\\s,.:;-]*(.*)$'));
  if (m) {
    var t1 = limpar(base.slice(base.length - m[3].length));
    return t1.length >= 2 ? { gatilho: alvo(m[1], m[2]), texto: t1 } : null;
  }
  // (b) condição no fim
  m = s.match(new RegExp('^(?:me\\s+)?(?:lembr\\w+|avis\\w+)\\s*(?:-?me)?\\s*(?:de|pra|para|que)?\\s*(.+?)\\s+' +
                         COND + '\\s+(?:eu\\s+)?' + VERBO + '\\s+' + PREP + LUGAR + '\\b'));
  if (m) {
    var i = s.indexOf(m[1]);
    var t2 = limpar(base.substr(i, m[1].length));
    return t2.length >= 2 ? { gatilho: alvo(m[2], m[3]), texto: t2 } : null;
  }
  return null;
}

/** Diag dos lembretes: sem args lista; {gatilho} dispara (simulado por padrão). */
function diagLembretes(args) {
  args = args || {};
  if (args.gatilho) return { ok: true, gatilho: args.gatilho, simulado: args.simular !== false,
                             resultado: _dispararLembretesDe(String(args.gatilho), { simular: args.simular !== false }) };
  if (args.frase) return { ok: true, frase: args.frase, interpretado: _interpretarLembreteCondicional(String(args.frase)) };
  return listarLembretesCondicionais(args);
}

/* ===================== EVENTOS PROATIVOS (zero-LLM) =====================
 * A telemetria do celular chega a cada 15 min (pingTelemetria → macro → rota action:'telemetria').
 * Esse é o gatilho natural para o Jarvis AGIR sem ser chamado. Tudo determinístico (sem LLM = custo
 * zero e previsível).
 *
 * ARQUITETURA (4 peças):
 *   1) SNAPSHOT      — guarda a leitura anterior (Script Property PROATIVO_SNAPSHOT).
 *   2) TRANSIÇÕES    — evento nasce da MUDANÇA, não do estado. "está em casa" não é notícia;
 *                      "ACABOU DE CHEGAR" é. Sem o snapshot o Jarvis é amnésico.
 *   3) REGRAS        — condição → ação (falar no celular).
 *   4) GOVERNANÇA    — orçamento diário + silêncio noturno + cooldown por evento. Assistente
 *                      proativo que fala demais é silenciado em dois dias; essa peça o mantém
 *                      bem-vindo. Prioridade 'critica' furamos o orçamento/silêncio.
 *
 * PRESENÇA POR WI-FI: o SSID é localização sem GPS e sem app novo. O match é por IGUALDADE EXATA
 * normalizada — NUNCA substring: o SSID do trabalho "Link" casaria com "TP-Link"/"D-Link"/"Linksys"
 * (roteadores comuns) e o Jarvis acharia que ele está no trabalho dentro de um shopping.
 * Config: WIFI_CASA e WIFI_TRABALHO (listas separadas por "|").
 */
function _normSsid(s) {
  return String(s || '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function _listaSsid(prop) {
  return String(PropertiesService.getScriptProperties().getProperty(prop) || '')
    .split('|').map(_normSsid).filter(Boolean);
}
/** SSID → 'casa' | 'trabalho' | 'outro' (inclui sem Wi-Fi/desconhecido). */
function _localPorSsid(ssid) {
  var s = _normSsid(ssid);
  if (!s) return 'outro';
  if (_listaSsid('WIFI_CASA').indexOf(s) !== -1) return 'casa';
  if (_listaSsid('WIFI_TRABALHO').indexOf(s) !== -1) return 'trabalho';
  return 'outro';
}

/** Minutos até o próximo PONTO de hoje (lido dos alertas tag:'ponto' — respeita o turno vigente). */
function _minutosAtePonto() {
  try {
    if (typeof AlertasVoz === 'undefined' || !AlertasVoz.listar) return null;
    var agora = new Date(), dow = agora.getDay(), min = agora.getHours() * 60 + agora.getMinutes();
    var futuros = AlertasVoz.listar().filter(function (a) {
      if (a.tag !== 'ponto') return false;
      var dias = Array.isArray(a.dias) ? a.dias : String(a.dias || '').split(',').map(Number);
      return dias.indexOf(dow) !== -1;
    }).map(function (a) { return Number(a.hora) * 60 + Number(a.minuto || 0); })
      .filter(function (m) { return m >= min; }).sort(function (x, y) { return x - y; });
    return futuros.length ? (futuros[0] - min) : null;
  } catch (e) { return null; }
}

/** GOVERNANÇA: decide se o Jarvis PODE interromper agora. Registra o consumo quando permite. */
function _governanca(chave, opts) {
  // DIRIGINDO: cala o que não é urgente. Interromper quem está ao volante com oferta de insight
  // ou aviso de bateria é pior do que inútil. Crítico e o que ele mesmo pediu continuam passando.
  try {
    if (typeof _viagemAtiva === 'function' && _viagemAtiva() &&
        (opts || {}).prioridade !== 'critica' && String(chave).indexOf('viagem') !== 0 &&
        ['insight_oferta', 'autodiag', 'bateria_baixa'].indexOf(String(chave)) !== -1) {
      return { permitido: false, motivo: 'dirigindo — adiado' };
    }
  } catch (eVgG) {}
  opts = opts || {};
  var p = PropertiesService.getScriptProperties();
  var critica = opts.prioridade === 'critica';
  var agora = new Date();

  /* SECAO CRITICA. O que vem abaixo LE o cooldown e o contador do dia e ESCREVE os dois.
   * Script Properties nao tem leitura-e-escrita atomica entre execucoes, e a telemetria chega
   * em rajada: em 17/08 quatro pings cairam no mesmo minuto, as quatro execucoes leram 'ainda
   * nao avisei' antes de qualquer uma gravar, e o aviso de bateria saiu QUATRO vezes seguidas
   * com 13%. Pior que o incomodo: cada disparo consome o orcamento diario, entao as 5
   * interrupcoes do dia acabaram as 14:53 e tudo depois foi silenciado sem ninguem saber.
   *
   * O lock cobre so a DECISAO, nunca a fala -- a fala leva 5-10 s e segurar o lock nela
   * serializaria o agente inteiro. Quem nao consegue o lock DESISTE em vez de esperar: se
   * outra execucao esta decidindo o mesmo evento agora, esta aqui e duplicata.
   * `simular` fica de fora: diagnostico nao pode disputar lock com o caminho real. */
  var _lkGov = null;
  if (!opts.simular) {
    try {
      _lkGov = LockService.getScriptLock();
      if (!_lkGov.tryLock(2000)) return { permitido: false, motivo: 'disparo simultaneo do mesmo evento' };
    } catch (eLkG) { _lkGov = null; }
  }
  try {

  // Cooldown por evento (anti-repetição), vale até para crítica.
  var cdMin = Number(opts.cooldownMin || 120);
  var ultimo = Number(p.getProperty('PROATIVO_CD_' + chave) || 0);
  if (ultimo && (agora.getTime() - ultimo) < cdMin * 60000) {
    return { permitido: false, motivo: 'cooldown de ' + cdMin + ' min ainda ativo' };
  }
  if (!critica) {
    // Silêncio noturno (ex.: "22:30-07:00"). Atravessa a meia-noite.
    var janela = String(p.getProperty('PROATIVO_SILENCIO') || '22:30-07:00');
    var m = janela.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (m) {
      var atual = agora.getHours() * 60 + agora.getMinutes();
      var ini = Number(m[1]) * 60 + Number(m[2]), fim = Number(m[3]) * 60 + Number(m[4]);
      var dentro = (ini <= fim) ? (atual >= ini && atual < fim) : (atual >= ini || atual < fim);
      if (dentro) return { permitido: false, motivo: 'silêncio noturno (' + janela + ')' };
    }
    // Orçamento diário de interrupções.
    var hoje = Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd');
    var maxDia = Number(p.getProperty('PROATIVO_MAX_DIA') || 5);
    var cont = (p.getProperty('PROATIVO_DIA') === hoje) ? Number(p.getProperty('PROATIVO_CONT') || 0) : 0;
    if (cont >= maxDia) return { permitido: false, motivo: 'orçamento diário esgotado (' + maxDia + ')' };
    if (!opts.simular) { p.setProperty('PROATIVO_DIA', hoje); p.setProperty('PROATIVO_CONT', String(cont + 1)); }
  }
  if (!opts.simular) p.setProperty('PROATIVO_CD_' + chave, String(agora.getTime()));
  return { permitido: true };
  } finally { if (_lkGov) { try { _lkGov.releaseLock(); } catch (eRlG) {} } }
}

/** Fala no celular respeitando a governança. @return {falou, motivo} */
function _falarProativo(chave, texto, opts) {
  opts = opts || {};
  var g = _governanca(chave, opts);
  if (!g.permitido) return { falou: false, bloqueado: g.motivo };
  if (opts.simular) return { falou: 'simulado' };
  var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
    ? Jarvis.controlarDispositivo({ acao: 'falar', texto: texto }) : null;
  var ok = !!(res && res.status === 'success');
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
      Jarvis.registrarEvento({ tool: 'proativo:' + chave, ms: 0, ok: ok, resumo: String(texto).substring(0, 120) });
    }
  } catch (eL) {}
  return { falou: ok };
}

function _avaliarEventosProativos(tel, opts) {
  opts = opts || {};
  var p = PropertiesService.getScriptProperties();
  var simular = opts.simular === true;
  var disparos = [];
  var bruto = tel || {};

  // ── leitura limpa (a telemetria pode vir com magic-text não substituído) ──
  var nivelTxt = _limparValorTelemetria(bruto.bateria_nivel || bruto.bateria || '');
  var nivel = parseInt(String(nivelTxt).replace(/[^\d]/g, ''), 10);
  if (isNaN(nivel) || nivel < 0 || nivel > 100) nivel = null;
  // O [power] do MacroDroid responde em PT: "Ligar" = conectado / "Desligar" = desconectado.
  // Mesma leitura que o contexto do voice_command usa — ver _telCarregando (fonte única).
  var carregando = _telCarregando(bruto.carregando || '');
  var ssid = _limparValorTelemetria(bruto.wifi_nome || bruto.wifi || '');
  var local = _localPorSsid(ssid);

  // ── snapshot anterior ──
  var snap = {};
  try { snap = JSON.parse(p.getProperty('PROATIVO_SNAPSHOT') || '{}') || {}; } catch (e) { snap = {}; }
  var localAnt = snap.local || null;

  // ── TRANSIÇÃO de presença (com debounce na SAÍDA) ──
  // Chegar numa rede conhecida é sinal forte → dispara na hora. Já "sair" pode ser só uma queda de
  // Wi-Fi, então exige 2 leituras seguidas fora antes de assumir que ele realmente saiu.
  var localNovo = localAnt, transicao = null;
  if (localAnt === null) {
    localNovo = local;                                  // primeira leitura: só memoriza
  } else if (local !== localAnt) {
    if (local === 'casa' || local === 'trabalho') {
      localNovo = local; transicao = { de: localAnt, para: local };
    } else {
      var candN = (snap.candidato === local ? Number(snap.candN || 0) : 0) + 1;
      if (candN >= 2) { localNovo = local; transicao = { de: localAnt, para: local }; }
      else if (!simular) {
        p.setProperty('PROATIVO_SNAPSHOT', JSON.stringify({ local: localAnt, candidato: local, candN: candN,
          nivel: nivel, carregando: carregando, ssid: ssid, ts: Date.now() }));
        return { disparos: [], nivel: nivel, carregando: carregando, ssid: ssid, local: localAnt,
                 nota: 'saída pendente de confirmação (' + candN + '/2)' };
      }
    }
  }

  // ── REGRAS de transição ──
  if (transicao) {
    var minPonto = _minutosAtePonto();
    // LEMBRETES CONDICIONAIS pendentes desta transição ("quando eu chegar em casa, me lembre de...").
    // Vêm ANTES das regras do sistema: o dono pediu explicitamente, tem prioridade sobre saudação.
    var _evsLemb = [];
    if (transicao.para === 'casa') _evsLemb.push('chegou_casa');
    if (transicao.para === 'trabalho') _evsLemb.push('chegou_trabalho');
    if (transicao.de === 'casa') _evsLemb.push('saiu_casa');
    if (transicao.de === 'trabalho') _evsLemb.push('saiu_trabalho');
    // UMA fala por transição (ver comentário no modo coleta): junta lembretes + saudação.
    var _falas = [], _pendLemb = [];
    _evsLemb.forEach(function (ev) {
      var rl = _dispararLembretesDe(ev, { simular: simular, coletar: _falas, pendentes: _pendLemb });
      if (rl.entregues.length) disparos.push({ evento: 'lembretes:' + ev, entregues: rl.entregues });
    });
    if (transicao.para === 'casa') {
      var naoLidos = null;
      try { naoLidos = GmailApp.getInboxUnreadCount(); } catch (eG) {}
      var txtCasa = 'Bem-vindo, Bruno.' + (naoLidos !== null
        ? (naoLidos > 0 ? ' Você tem ' + naoLidos + (naoLidos === 1 ? ' e-mail não lido.' : ' e-mails não lidos.') : ' Sua caixa de entrada está limpa.')
        : '');
      var gCasa = _governanca('chegou_casa', { cooldownMin: 180, simular: simular });
      if (gCasa.permitido) _falas.push(txtCasa);
      disparos.push({ evento: 'chegou_casa', texto: txtCasa, permitido: gCasa.permitido, motivo: gCasa.motivo || null });
    } else if (transicao.para === 'trabalho') {
      /* A PRESENÇA NÃO FALA DE PONTO quando o ponto já tem dono. O ponto é coberto por DOIS
       * mecanismos dedicados — o alerta agendado (tag ponto) e a checagem ponto_ausente — e a
       * presença era o TERCEIRO. Medido em 22/09: 08:01 alerta, 08:03 "lembre-se de bater o
       * ponto", 08:18 ponto_ausente. Três vezes o mesmo aviso em 17 minutos. E o ramo antigo
       * dizia "Lembre-se de bater o ponto" justamente quando o próximo ponto estava LONGE —
       * ou seja, lembrava de um que já tinha tido seu próprio alerta.
       * Só volta a mencionar o ponto se NÃO houver alerta de ponto configurado. */
      var _temAlertaPonto = false;
      try {
        _temAlertaPonto = (typeof AlertasVoz !== 'undefined') && AlertasVoz.listar().some(function (al) {
          return al.tag === 'ponto' || /marcar (o )?ponto/i.test(String(al.texto || ''));
        });
      } catch (eAp) {}
      var txtTrab = 'Bom trabalho, Bruno.' + (!_temAlertaPonto && minPonto !== null && minPonto <= 60
        ? ' Você bate o ponto em ' + minPonto + ' minutos.' : '');
      // Uma saudação por EXPEDIENTE, não por chegada. Com 240 min, a volta do almoço (08:17 →
      // 13:18, 5h depois) passava do cooldown e repetia "Bom trabalho" no mesmo dia.
      var gTrab = _governanca('chegou_trabalho', { cooldownMin: 720, simular: simular });
      if (gTrab.permitido) _falas.push(txtTrab);
      disparos.push({ evento: 'chegou_trabalho', texto: txtTrab, permitido: gTrab.permitido, motivo: gTrab.motivo || null });
    } else if (transicao.de === 'casa') {
      // Saiu de casa: só vale avisar se o ponto está próximo (senão é interrupção sem valor).
      if (minPonto !== null && minPonto <= 90) {
        var txtSaiu = 'Você bate o ponto em ' + minPonto + ' minutos.' +
          (nivel !== null && nivel < 40 && carregando !== true ? ' Atenção: a bateria está em ' + nivel + ' por cento.' : '');
        var gSaiu = _governanca('saiu_casa', { cooldownMin: 180, simular: simular });
        if (gSaiu.permitido) _falas.push(txtSaiu);
        disparos.push({ evento: 'saiu_casa', texto: txtSaiu, permitido: gSaiu.permitido, motivo: gSaiu.motivo || null });
      } else {
        disparos.push({ evento: 'saiu_casa', ignorado: 'ponto distante (' + minPonto + ' min)' });
      }
    }

    // A ÚNICA fala da transição. Lembrete vem primeiro: ele pediu, tem prioridade sobre saudação.
    var _txtUnico = _falas.filter(function (x) { return x; }).join(' ');
    if (_txtUnico) {
      var _falou = false;
      if (simular) { _falou = true; }
      else {
        try {
          var _rf = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
            ? Jarvis.controlarDispositivo({ acao: 'falar', texto: _txtUnico }) : null;
          _falou = !!(_rf && _rf.status === 'success');
        } catch (eF) { _falou = false; }
      }
      // só consome o lembrete se a fala saiu — senão ele volta na próxima transição.
      if (_falou && !simular) _lembConsumir(_pendLemb);
      disparos.push({ evento: 'fala_unica', texto: _txtUnico, falou: _falou, lembretesConsumidos: _falou ? _pendLemb.length : 0 });
      // RASTRO. A transição de presença chama _governanca DIRETO (não passa pelo _falarProativo),
      // então consumia o orçamento diário e FALAVA sem registrar nada. O `disparos` acima só vive
      // na resposta HTTP do ping de telemetria, que ninguém lê. Sintoma real em 13/08: o contador
      // marcava 3 interrupções no dia e o agente_eventos tinha 1 — as outras 2 eram estas.
      if (!simular) {
        try {
          if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
            tool: 'proativo:presenca', ok: _falou, ms: 0,
            resumo: (_falou ? '' : 'FALHOU: ') + String(_txtUnico).substring(0, 200)
          });
        } catch (eEvP) {}
      }
    }
  }

  // ── REGRA de bateria (mantém o rearme por ciclo de carga + agora sob governança) ──
  if (nivel !== null) {
    var limite = Number(p.getProperty('PROATIVO_BATERIA_MIN') || 20);
    var jaAvisou = p.getProperty('PROATIVO_BAT_AVISADO') === '1';
    if (carregando === true) {
      if (jaAvisou && !simular) { p.deleteProperty('PROATIVO_BAT_AVISADO'); disparos.push({ evento: 'bateria_rearmada' }); }
    } else if (nivel <= limite && !jaAvisou) {
      var critica = nivel <= 10;
      var txtBat = 'Bruno, atenção: a bateria do celular está em ' + nivel +
                   ' por cento e não está carregando. Melhor colocar no carregador.';
      // MARCA ANTES DE FALAR. Gravar so depois deixava uma janela do tamanho da sintese (5-10 s)
      // em que outra execucao ainda lia 'ainda nao avisei'. O lock acima ja fecha a corrida;
      // marcar antes torna a janela inexistente mesmo se o lock falhar. Custo assumido: se a
      // fala falhar, o aviso nao se repete neste ciclo de carga -- preferivel a avisar 4 vezes.
      if (!simular) p.setProperty('PROATIVO_BAT_AVISADO', '1');
      var rBat = _falarProativo('bateria_baixa', txtBat,
        { cooldownMin: 60, prioridade: critica ? 'critica' : 'normal', simular: simular });
      disparos.push({ evento: 'bateria_baixa', nivel: nivel, limite: limite, critica: critica, resultado: rBat });
    }
  }

  // ── CURADORIA: oferece o insight do dia se o momento for bom (em casa + fora do expediente).
  // Fica por ÚLTIMO de propósito: bateria, ponto e lembretes pedidos por ele valem mais que uma
  // ideia. Se algum deles já falou, o orçamento diário provavelmente barra esta — e tudo bem.
  var rIns = _avaliarEntregaInsight(localNovo, { simular: simular });
  if (rIns.ofereceu) disparos.push({ evento: 'insight_oferta', texto: rIns.texto, insightId: rIns.insightId });

  // PONTO: cobra se o horário passou e nenhuma notificação do app de ponto chegou.
  try {
    var rPonto = verificarPontoBatido({ simular: simular });
    if (rPonto && rPonto.cobrou) disparos.push({ evento: 'ponto_ausente', ponto: rPonto.ponto, texto: rPonto.texto });
  } catch (ePt) {}

  // ── grava o snapshot novo ──
  if (!simular) {
    p.setProperty('PROATIVO_SNAPSHOT', JSON.stringify({ local: localNovo, candidato: null, candN: 0,
      nivel: nivel, carregando: carregando, ssid: ssid, ts: Date.now() }));
  }
  return { disparos: disparos, nivel: nivel, carregando: carregando, ssid: ssid,
           local: localNovo, localAnterior: localAnt, transicao: transicao };
}

/** Simula a chegada de uma telemetria p/ testar as regras SEM esperar 15 min.
 *  args {bateria, carregando, wifi, simular:false p/ AGIR de verdade}. Default = só simula. */
function diagEventoProativo(args) {
  args = args || {};
  var tel = {
    bateria_nivel: String(args.bateria !== undefined ? args.bateria : 50),
    carregando: String(args.carregando !== undefined ? args.carregando : 'Desligar'),
    wifi_nome: String(args.wifi !== undefined ? args.wifi : '')
  };
  var simular = args.simular !== false;
  var r = _avaliarEventosProativos(tel, { simular: simular });
  return { ok: true, simulado: simular, telemetriaUsada: tel, resultado: r, estado: diagProativoEstado().estado };
}

/* ===================== LEMBRETES POR PRESENÇA — CONSOLIDADO =====================
 * Havia DOIS stores paralelos para o mesmo recurso: LEMBRETES_PRESENCA (este) e
 * LEMBRETES_CONDICIONAIS. Os dois dispatchers rodavam na MESMA transição, lendo filas diferentes,
 * e na cadeia de voz o parser antigo vinha primeiro — então a frase falada caía num store e a
 * ferramenta do Jarvis escrevia no outro. Consolidado em LEMBRETES_CONDICIONAIS, que tem validade
 * em dias e cai para NOTIFICAÇÃO dentro do silêncio noturno.
 * O que sobrou aqui são DELEGAÇÕES: os nomes antigos continuam válidos e escrevem na fila única.
 */
var _LEMBRETES_KEY = 'LEMBRETES_PRESENCA';   // mantido só para a migração ler o resíduo

/** Move o que restou do store antigo para a fila única. Idempotente: esvazia a origem. */
function migrarLembretesPresenca(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var antigos = [];
  try { antigos = JSON.parse(p.getProperty(_LEMBRETES_KEY) || '[]'); } catch (e) { antigos = []; }
  var agora = Date.now(), migrados = [], ignorados = [];
  antigos.forEach(function (l) {
    var vivo = l.ativo !== false && Number(l.validadeAte || 0) > agora;
    if (!vivo) { ignorados.push({ texto: l.texto, motivo: 'vencido ou inativo' }); return; }
    // validadeAte (timestamp) -> validadeDias (int), o formato da fila única
    var dias = Math.max(1, Math.ceil((Number(l.validadeAte) - agora) / 86400000));
    var r = args.simular === true
      ? { ok: true, lembrete: { id: '(simulado)' } }
      : criarLembreteCondicional({ gatilho: l.gatilho, texto: l.texto, validadeDias: dias, repetir: l.repetir === true });
    if (r.ok) migrados.push({ de: l.id, para: r.lembrete.id, gatilho: l.gatilho, texto: l.texto, dias: dias, repetir: l.repetir === true });
    else ignorados.push({ texto: l.texto, motivo: r.erro || 'falha' });
  });
  if (args.simular !== true) p.deleteProperty(_LEMBRETES_KEY);
  return { ok: true, simulado: args.simular === true, encontrados: antigos.length,
           migrados: migrados, ignorados: ignorados };
}

// ── Nomes antigos, agora delegando para a fila única ──
function criarLembretePresenca(args) { return criarLembreteCondicional(args); }
function listarLembretesPresenca() { return listarLembretesCondicionais(); }
function removerLembretePresenca(args) {
  return cancelarLembreteCondicional({ id: String((args && (args.id || args)) || '') });
}
function _dispararLembretes(gatilho, opts) { return _dispararLembretesDe(gatilho, opts); }
function _interpretarLembretePresenca(msg) { return _interpretarLembreteCondicional(msg); }

/** Diag dos lembretes. args {} lista · {gatilho,texto} cria · {remover:id} · {disparar:gatilho, simular}. */
function diagLembretePresenca(args) {
  args = args || {};
  if (args.remover) return removerLembretePresenca({ id: args.remover });
  if (args.disparar) return { ok: true, resultado: _dispararLembretes(String(args.disparar), { simular: args.simular !== false }) };
  if (args.texto) return criarLembretePresenca(args);
  if (args.frase) { var i = _interpretarLembretePresenca(args.frase); return { ok: !!i, interpretado: i }; }
  return listarLembretesPresenca();
}

/** Reposiciona o briefing p/ X min antes do ponto de entrada do turno vigente (sem trocar o turno).
 *  args {turno?, antecedenciaMin?} — antecedenciaMin grava BRIEFING_ANTECEDENCIA_MIN (default 30). */
function configurarBriefingTurno(args) {
  args = args || {};
  if (args.antecedenciaMin !== undefined) {
    PropertiesService.getScriptProperties().setProperty('BRIEFING_ANTECEDENCIA_MIN', String(Number(args.antecedenciaMin)));
  }
  if (typeof AlertasVoz === 'undefined' || !AlertasVoz.reposicionarBriefing) return { ok: false, erro: 'AlertasVoz indisponível' };
  var r = AlertasVoz.reposicionarBriefing(args.turno);
  try { r.alertasAgora = AlertasVoz.listar().map(function (a) {
    return { hora: (a.hora < 10 ? '0' : '') + a.hora + ':' + (a.minuto < 10 ? '0' : '') + (a.minuto || 0),
             tag: a.tag || '-', dinamico: !!a.dinamico, texto: String(a.texto || '').substring(0, 45) }; }); } catch (e) {}
  return r;
}

/** Estado atual da governança + snapshot + config de presença. */
function diagProativoEstado() {
  var p = PropertiesService.getScriptProperties();
  var snap = null; try { snap = JSON.parse(p.getProperty('PROATIVO_SNAPSHOT') || 'null'); } catch (e) {}
  return { ok: true, estado: {
    WIFI_CASA: p.getProperty('WIFI_CASA') || '(não configurado)',
    WIFI_TRABALHO: p.getProperty('WIFI_TRABALHO') || '(não configurado)',
    PROATIVO_BATERIA_MIN: p.getProperty('PROATIVO_BATERIA_MIN') || '20 (default)',
    PROATIVO_MAX_DIA: p.getProperty('PROATIVO_MAX_DIA') || '5 (default)',
    PROATIVO_SILENCIO: p.getProperty('PROATIVO_SILENCIO') || '22:30-07:00 (default)',
    consumoHoje: (p.getProperty('PROATIVO_DIA') || '-') + ' → ' + (p.getProperty('PROATIVO_CONT') || '0'),
    PROATIVO_BAT_AVISADO: p.getProperty('PROATIVO_BAT_AVISADO') || '(rearmado)',
    snapshot: snap, minutosAtePonto: _minutosAtePonto()
  } };
}

/** Config das regras proativas e da presença por Wi-Fi.
 *  args {bateriaMin, maxDia, silencio:"22:30-07:00", wifiCasa:"A|B", wifiTrabalho:"A|B",
 *        rearmar:true, resetarSnapshot:true, zerarOrcamento:true} */
function configurarProativo(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.bateriaMin !== undefined) p.setProperty('PROATIVO_BATERIA_MIN', String(Number(args.bateriaMin)));
  if (args.maxDia !== undefined) p.setProperty('PROATIVO_MAX_DIA', String(Number(args.maxDia)));
  if (args.silencio !== undefined) p.setProperty('PROATIVO_SILENCIO', String(args.silencio));
  if (args.wifiCasa !== undefined) p.setProperty('WIFI_CASA', String(args.wifiCasa));
  if (args.wifiTrabalho !== undefined) p.setProperty('WIFI_TRABALHO', String(args.wifiTrabalho));
  if (args.rearmar === true) p.deleteProperty('PROATIVO_BAT_AVISADO');
  if (args.resetarSnapshot === true) p.deleteProperty('PROATIVO_SNAPSHOT');
  if (args.zerarOrcamento === true) { p.deleteProperty('PROATIVO_DIA'); p.deleteProperty('PROATIVO_CONT'); }
  // limparCooldown: true = todos · 'insight_oferta' = só esse. Serve para testar sem esperar horas.
  if (args.limparCooldown) {
    var chs = (args.limparCooldown === true)
      ? ['chegou_casa', 'chegou_trabalho', 'saiu_casa', 'bateria_baixa', _INS_OFERTA]
      : [String(args.limparCooldown)];
    chs.forEach(function (c) { p.deleteProperty('PROATIVO_CD_' + c); });
  }
  return diagProativoEstado();
}

/** TELEMETRIA PERIÓDICA · pinga o webhook jarvis_telemetria do MacroDroid; a macro responde POSTando
 *  o status atual do aparelho na rota action:'telemetria'. Instalado a cada 15 min por configurarPingTelemetria(). */
function pingTelemetria() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('MACRODROID_WEBHOOK_URL');
  if (!url) return { ok: false, erro: 'MACRODROID_WEBHOOK_URL ausente' };
  var alvo = url.replace(/\/[^\/]*$/, '/jarvis_telemetria');           // troca o último trecho pelo evento
  var sec = p.getProperty('MACRODROID_WEBHOOK_SECRET');
  if (sec) alvo += (alvo.indexOf('?') === -1 ? '?' : '&') + 'sig=' + encodeURIComponent(sec);
  try {
    var r = UrlFetchApp.fetch(alvo, { method: 'get', muteHttpExceptions: true, followRedirects: true });
    return { ok: r.getResponseCode() < 400, http: r.getResponseCode(), evento: 'jarvis_telemetria' };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Instala (idempotente) o gatilho de tempo do pingTelemetria a cada 15 min. args {desligar:true} remove. */
function configurarPingTelemetria(args) {
  args = args || {};
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pingTelemetria') { ScriptApp.deleteTrigger(t); removidos++; }
  });
  if (args.desligar === true) return { ok: true, acao: 'desligado', removidos: removidos };
  ScriptApp.newTrigger('pingTelemetria').timeBased().everyMinutes(15).create();
  return { ok: true, acao: 'instalado (15 min)', removidosAntes: removidos, testeAgora: pingTelemetria() };
}

/** DEBUG: replica a extração de telemetria do obterStatusDispositivo — mostra o que o card RECEBE. */
function diagTelemetria() {
  var docsTel = Firestore.listDocs('telemetria_dispositivo', 20);
  if (!docsTel || !docsTel.length) return { ok: false, erro: 'sem telemetria' };
  docsTel.sort(function (a, b) {
    var ta = (a.dados && a.dados.recebidoEm) ? new Date(a.dados.recebidoEm).getTime() : 0;
    var tb = (b.dados && b.dados.recebidoEm) ? new Date(b.dados.recebidoEm).getTime() : 0;
    return tb - ta;
  });
  var d = docsTel[0].dados || docsTel[0];
  var tel = { _id: docsTel[0].id, recebidoEm: d.recebidoEm || '' };
  if (d.body) Object.keys(d.body).forEach(function (k) { tel[k] = _limparValorTelemetria(d.body[k]); });
  return { ok: true, telemetriaLimpa: tel, bodyBruto: d.body || null };
}

/** DEBUG: replica a lógica do atalho de voz da Bíblia p/ ver s/querFalar/parse (verdade de terra). */
/** Testa o atalho determinístico de insight sem passar pelo celular.
 *  args.frase — o que seria dito; args.executar=true também EXECUTA (entrega ou grava de verdade). */
function diagAtalhoInsight(args) {
  args = args || {};
  var frase = String(args.frase || args.msg || args.message || '');
  var r = _interpretarInsight(frase);
  var out = { ok: true, frase: frase, interpretado: !!r, acao: r ? r.acao : null };
  if (!r || args.executar !== true) return out;
  if (r.acao === 'gravar') { out.resultado = _insSalvarComoConceito(); }
  else {
    var i = _insightAtual();
    if (!i) { out.resultado = { ok: false, erro: 'sem insight hoje' }; }
    else { try { marcarInsightEntregue('voz'); } catch (e) {}
      out.resultado = { ok: true, falaria: i.insight + (i.acao ? ' Primeiro passo: ' + i.acao : '') }; }
  }
  return out;
}

function diagVoiceParse(args) {
  var msgVoz = String((args && (args.msg || args.message)) || '');
  var r = _interpretarBiblia(msgVoz);
  return { ok: true, msgVoz: msgVoz, interpretado: !!r, referencia: r ? r.ref : null,
           usfm: r ? r.usfm : null, url: r ? _youversionUrl(r.usfm) : null,
           querFalar: r ? !!r.falar : false, semCapitulo: r ? !!r.semCapitulo : false };
}


/** Info não-sensível do banco (p/ montar o link do console real). project_id aparece em toda URL da API. */
/** Reconstrói o índice compacto de busca semântica no Drive (1x manual, ou reparo). */
function diagReconstruirIndiceSemantico() {
  try {
    if (typeof Semantica === 'undefined' || !Semantica.reconstruirIndice) return { ok: false, erro: 'Semantica indisponível' };
    return Semantica.reconstruirIndice();
  } catch (e) { return { ok: false, erro: e.message }; }
}


function diagFsInfo() {
  try { return { ok: true, projectId: _fsSa().project_id, database: FS_DATABASE }; }
  catch (e) { return { ok: false, erro: e.message }; }
}


/* ===================== REGISTRO DE CONECTIVIDADE =====================
 * O celular manda telemetria a cada ~15 min. Quando ele fica sem internet,
 * a telemetria simplesmente NAO CHEGA — e a AUSENCIA e o sinal. Este modulo
 * le o historico, acha as LACUNAS e as transforma em registro permanente.
 *
 * Por que assim, e nao um "ping" no celular: se o aparelho esta offline, ele
 * nao consegue avisar que esta offline. Detectar do lado do servidor e a unica
 * forma que funciona justamente no momento em que se precisa dela.
 *
 * Idempotente: o id da lacuna vem do instante em que ela comecou, entao rodar
 * duas vezes nao duplica (mesma licao do cofre financeiro).
 * ================================================================== */
var _CONECT_COL = 'conectividade';

/** Converte o id de timestamp invertido da telemetria em milissegundos. */
function _conectMsDoId(id) {
  var n = Number(id);
  return (isFinite(n) && n > 0) ? (1e13 - n) : 0;
}

/** Extrai o primeiro valor util de um campo da macro (ex.: "Link|Link|[wifi_ssid]"). */
function _conectLimpo(v) {
  var partes = String(v || '').split('|');
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i].trim();
    if (p && p.indexOf('[') === -1 && p.indexOf('{') === -1) return p;
  }
  return '';
}

/**
 * Analisa a telemetria e devolve as lacunas (periodos sem contato).
 * args: { minutos: limite p/ considerar lacuna (padrao 25), amostras: quantos
 *         registros olhar (padrao 100 = ~25h), registrar: true p/ persistir }
 */
function diagConectividade(args) {
  args = args || {};
  var LIMITE_MIN = Number(args.minutos || 25);
  var N = Math.min(Number(args.amostras || 100), 100);

  var q = diagFsQuery({ colecao: 'telemetria_dispositivo', limite: N });
  if (!q || !q.ok) return { ok: false, erro: (q && q.erro) || 'falha ao ler telemetria' };

  // normaliza: cada registro vira { ms, wifi, bateria }
  var pts = [];
  (q.resultados || []).forEach(function (r) {
    var ms = _conectMsDoId(r.id);
    if (!ms) {
      var re = (r.dados && r.dados.recebidoEm) ? Date.parse(r.dados.recebidoEm) : 0;
      ms = re || 0;
    }
    if (!ms) return;
    var b = (r.dados && r.dados.body) || {};
    pts.push({ ms: ms, wifi: _conectLimpo(b.wifi_nome), bateria: _conectLimpo(b.bateria_nivel) });
  });
  if (pts.length < 2) return { ok: true, amostras: pts.length, lacunas: [], nota: 'poucos dados' };

  pts.sort(function (a, b) { return a.ms - b.ms; });   // do mais antigo p/ o mais novo

  var lacunas = [], fmt = function (ms) {
    return Utilities.formatDate(new Date(ms), 'America/Sao_Paulo', 'dd/MM HH:mm');
  };
  for (var i = 1; i < pts.length; i++) {
    var dif = (pts[i].ms - pts[i - 1].ms) / 60000;
    if (dif >= LIMITE_MIN) {
      lacunas.push({
        inicio: fmt(pts[i - 1].ms), fim: fmt(pts[i].ms),
        minutos: Math.round(dif),
        wifiAntes: pts[i - 1].wifi || '?', wifiDepois: pts[i].wifi || '?',
        bateriaAntes: pts[i - 1].bateria || '?',
        inicioMs: pts[i - 1].ms
      });
    }
  }

  // quanto tempo desde o ultimo contato (lacuna em curso?)
  var agora = Date.now();
  var desdeUltimo = Math.round((agora - pts[pts.length - 1].ms) / 60000);

  // persiste, se pedido. Id = instante de inicio -> reexecutar nao duplica.
  var gravadas = 0;
  if (args.registrar === true) {
    lacunas.forEach(function (L) {
      var id = 'g' + L.inicioMs;
      var ja = null;
      try { ja = Firestore.getDoc(_CONECT_COL, id); } catch (e) {}
      if (ja) return;
      try {
        Firestore.setDoc(_CONECT_COL, id, {
          inicio: L.inicio, fim: L.fim, minutos: L.minutos,
          wifiAntes: L.wifiAntes, wifiDepois: L.wifiDepois,
          bateriaAntes: L.bateriaAntes, inicioMs: L.inicioMs,
          registradoEm: agora
        });
        gravadas++;
      } catch (e2) {}
    });
  }

  return {
    ok: true,
    amostras: pts.length,
    janela: fmt(pts[0].ms) + ' ate ' + fmt(pts[pts.length - 1].ms),
    limiteMin: LIMITE_MIN,
    minutosDesdeUltimoContato: desdeUltimo,
    offlineAgora: desdeUltimo >= LIMITE_MIN,
    totalLacunas: lacunas.length,
    tempoTotalOffline: lacunas.reduce(function (s, L) { return s + L.minutos; }, 0),
    lacunas: lacunas,
    gravadas: gravadas
  };
}

/** Historico ja registrado de quedas (coleção conectividade). */
function diagHistoricoConectividade(args) {
  args = args || {};
  var q = diagFsQuery({ colecao: _CONECT_COL, limite: Number(args.limite || 30) });
  if (!q || !q.ok) return { ok: false, erro: (q && q.erro) || 'falha' };
  var itens = (q.resultados || []).map(function (r) { return r.dados; })
    .sort(function (a, b) { return (b.inicioMs || 0) - (a.inicioMs || 0); });
  return { ok: true, total: itens.length,
    tempoTotalOffline: itens.reduce(function (s, x) { return s + (Number(x.minutos) || 0); }, 0),
    quedas: itens };
}

/** Job: roda periodicamente e grava as lacunas novas. Sem fala, sem gasto de IA. */
function jobRegistrarConectividade() {
  try {
    var r = diagConectividade({ registrar: true });
    if (r && r.ok && r.gravadas > 0) {
      Logger.log('[conectividade] ' + r.gravadas + ' lacuna(s) nova(s) registrada(s)');
    }
    return r;
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Consulta ESTRUTURADA (runQuery) — traduz args amigáveis p/ structuredQuery REST e executa.
 *  args: { colecao, campo?, op?('=='|'!='|'>'|'>='|'<'|'<='|'contains'|'in'), valor?, ordenarPor?, direcao?('asc'|'desc'), limite? }
 *  Retorna a query enviada (p/ aprender) + os resultados decodificados. */
function diagFsQuery(args) {
  args = args || {};
  var col = String(args.colecao || '').trim();
  if (!col) return { ok: false, erro: 'informe args.colecao' };
  var sq = { from: [{ collectionId: col }] };
  if (args.campo && args.op) {
    var opMap = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL',
      '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', 'contains': 'ARRAY_CONTAINS', 'in': 'IN' };
    var op = opMap[String(args.op)] || String(args.op).toUpperCase();
    sq.where = { fieldFilter: { field: { fieldPath: String(args.campo) }, op: op, value: _fsEncode(args.valor) } };
  }
  if (args.ordenarPor) {
    sq.orderBy = [{ field: { fieldPath: String(args.ordenarPor) },
      direction: (String(args.direcao || 'asc').toLowerCase() === 'desc') ? 'DESCENDING' : 'ASCENDING' }];
  }
  if (args.limite) sq.limit = Math.min(Number(args.limite) || 10, 100);
  try {
    var r = _fsRequest('post', _fsDocBase() + ':runQuery', { structuredQuery: sq });
    if (r.code >= 400) return { ok: false, erro: 'runQuery ' + r.code + ': ' + String(r.text).slice(0, 300), queryEnviada: sq };
    var resultados = ((r.json) || []).filter(function (x) { return x.document; }).map(function (x) {
      return { id: String(x.document.name).split('/').pop(), dados: _fsDecodeFields(x.document.fields || {}) };
    });
    return { ok: true, queryEnviada: sq, total: resultados.length, resultados: resultados };
  } catch (e) { return { ok: false, erro: e.message, queryEnviada: sq }; }
}

/** Documento completo (JSON decodificado) de uma coleção + id. */
function diagFsDoc(args) {
  args = args || {};
  var col = String(args.colecao || args.path || '').trim(), id = String(args.id || '').trim();
  if (!col || !id) return { ok: false, erro: 'informe args.colecao e args.id' };
  try {
    var d = Firestore.getDoc(col, id);
    return { ok: true, colecao: col, id: id, existe: d !== null, dados: d };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/**
 * L4 · EXCLUSÃO IRREVERSÍVEL de TODAS as conversas salvas do DONO (docs + subcoleção mensagens).
 * Guardada por {confirmar:true}. Idempotente (re-rodar apaga o que sobrou). Pedido explícito do Bruno
 * após a análise dos chats. NÃO toca telemetria/wiki/preferências/alertas — só o histórico de chat.
 */
function diagApagarConversas(args) {
  args = args || {};
  if (args.confirmar !== true) return { ok: false, erro: 'Exclusão IRREVERSÍVEL. Passe {confirmar:true} para executar.' };
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
  var emailDoc = Firestore.getDoc('emails', email);
  var uid = (emailDoc && emailDoc.uid) ? emailDoc.uid : null;
  if (!uid) return { ok: false, erro: 'uid do dono não encontrado em emails/' + email };
  var base = 'usuarios/' + uid + '/conversas';
  var convs = Firestore.listDocs(base, 500);
  var apagadas = 0, msgsTot = 0, erros = [];
  convs.forEach(function (c) {
    try {
      var col = base + '/' + c.id + '/mensagens';
      var guard = 0;
      while (guard++ < 30) {
        var ms = Firestore.listDocs(col, 200);
        if (!ms || !ms.length) break;
        ms.forEach(function (m) { try { Firestore.deleteDoc(col, m.id); msgsTot++; } catch (e) {} });
        if (ms.length < 200) break;
      }
      Firestore.deleteDoc(base, c.id);
      apagadas++;
    } catch (e) { erros.push(c.id + ': ' + e.message); }
  });
  return { ok: true, conversasApagadas: apagadas, mensagensApagadas: msgsTot, restantes: Firestore.listDocs(base, 10).length, erros: erros };
}

/**
 * L4 · HARNESS de reprodução do CHAT DE TEXTO. Espelha o pipeline do askIA (_rotaDireta →
 * _rotaConhecimento → Jarvis.ask) com histórico controlado, p/ reproduzir bugs (contaminação,
 * mention-vs-use) do terminal. ⚠️ Executa ferramentas de verdade (dono) — use mensagens SEGURAS.
 * args {message, historico?:[{role,text}]}.
 */
function diagChat(args) {
  args = args || {};
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
  var isOwner = Jarvis._isOwner(email);
  var msg = String(args.message || args.mensagem || '').trim();
  if (!msg) return { ok: false, erro: 'informe args.message' };
  var hist = Array.isArray(args.historico) ? args.historico.map(function (h) {
    return { role: h.role || h.papel || 'user', text: String(h.text || h.texto || '') };
  }) : [];
  var via = 'Jarvis.ask', resp = null, t0 = Date.now();
  try {
    var direto = _rotaDireta(msg, email, isOwner); if (direto) { resp = direto; via = '_rotaDireta'; }
    if (resp === null || resp === undefined) { var rag = _rotaConhecimento(msg, email, isOwner, hist); if (rag) { resp = rag; via = '_rotaConhecimento'; } }
    if (resp === null || resp === undefined) { resp = Jarvis.ask(email, msg, hist, null); }
  } catch (e) { return { ok: false, erro: e.message, via: via }; }
  return { ok: true, ms: Date.now() - t0, via: via, message: msg, resposta: resp };
}

/**
 * L4 · DISPATCHER de diagnóstico. Executa, do TERMINAL (POST /exec com {token, run, args}), uma
 * função de manutenção da LISTA BRANCA abaixo. Token dedicado (DIAG_TOKEN) — nunca aceita nome fora
 * da lista (sem execução arbitrária). Não modifica o projeto (≠ ggsrun e1/e2). Retorna o valor da função.
 */
function _diagDispatch(body) {
  var tok = PropertiesService.getScriptProperties().getProperty('DIAG_TOKEN');
  if (!tok) return { ok: false, erro: 'DIAG_TOKEN não configurado. Rode configurarDiagToken() no editor.' };
  if (!body.token || body.token !== tok) return { ok: false, erro: 'Não autorizado (token inválido).' };

  // LISTA BRANCA — só diagnósticos/manutenção seguros. Use typeof p/ tolerar função ausente no disco.
  var permitidas = {
    statusJarvis:           (typeof statusJarvis !== 'undefined') ? statusJarvis : null,
    testarFirestore:        (typeof testarFirestore !== 'undefined') ? testarFirestore : null,
    diagGemini:             (typeof diagGemini !== 'undefined') ? diagGemini : null,
    testarModoReserva:      (typeof testarModoReserva !== 'undefined') ? testarModoReserva : null,
    testarVoz:              (typeof testarVoz !== 'undefined') ? testarVoz : null,
    listarSkillsJarvis:     (typeof listarSkillsJarvis !== 'undefined') ? listarSkillsJarvis : null,
    configurarLoopBudget:   (typeof configurarLoopBudget !== 'undefined') ? configurarLoopBudget : null,
    rodarQA:                (typeof rodarQA !== 'undefined') ? rodarQA : null,
    indexarWikiSemantico:   (typeof indexarWikiSemantico !== 'undefined') ? indexarWikiSemantico : null,
    indexarMemoriaConversas:(typeof indexarMemoriaConversas !== 'undefined') ? indexarMemoriaConversas : null,
    testarBuscaSemantica:   (typeof testarBuscaSemantica !== 'undefined') ? testarBuscaSemantica : null,
    testarMemoriaConversas: (typeof testarMemoriaConversas !== 'undefined') ? testarMemoriaConversas : null,
    gerenciarPrefDono:      (typeof gerenciarPrefDono !== 'undefined') ? gerenciarPrefDono : null,
    diagConversas:          (typeof diagConversas !== 'undefined') ? diagConversas : null,
    diagChat:               (typeof diagChat !== 'undefined') ? diagChat : null,
    diagApagarConversas:    (typeof diagApagarConversas !== 'undefined') ? diagApagarConversas : null,
    diagFsMapa:             (typeof diagFsMapa !== 'undefined') ? diagFsMapa : null,
    diagFsListar:           (typeof diagFsListar !== 'undefined') ? diagFsListar : null,
    diagFsDoc:              (typeof diagFsDoc !== 'undefined') ? diagFsDoc : null,
    diagFsQuery:            (typeof diagFsQuery !== 'undefined') ? diagFsQuery : null,
    diagReconstruirIndiceSemantico: (typeof diagReconstruirIndiceSemantico !== 'undefined') ? diagReconstruirIndiceSemantico : null,
    diagPublicarInventarioFerramentas: (typeof diagPublicarInventarioFerramentas !== 'undefined') ? diagPublicarInventarioFerramentas : null,
    diagConectividade:      (typeof diagConectividade !== 'undefined') ? diagConectividade : null,
    diagHistoricoConectividade: (typeof diagHistoricoConectividade !== 'undefined') ? diagHistoricoConectividade : null,
    jobRegistrarConectividade: (typeof jobRegistrarConectividade !== 'undefined') ? jobRegistrarConectividade : null,
    diagFsInfo:             (typeof diagFsInfo !== 'undefined') ? diagFsInfo : null,
    diagVoiceParse:         (typeof diagVoiceParse !== 'undefined') ? diagVoiceParse : null,
    diagAtalhoInsight:      (typeof diagAtalhoInsight !== 'undefined') ? diagAtalhoInsight : null,
    configurarVozJarvis:    (typeof configurarVozJarvis !== 'undefined') ? configurarVozJarvis : null,
    configurarEntregaVoz:   (typeof configurarEntregaVoz !== 'undefined') ? configurarEntregaVoz : null,
    diagAutoDiagnostico:    (typeof diagAutoDiagnostico !== 'undefined') ? diagAutoDiagnostico : null,
    diagGoldenVoz:          (typeof diagGoldenVoz !== 'undefined') ? diagGoldenVoz : null,
    diagMemoriaConversas:   (typeof diagMemoriaConversas !== 'undefined') ? diagMemoriaConversas : null,
    diagViagem:             (typeof diagViagem !== 'undefined') ? diagViagem : null,
    configurarPausaPonto:   (typeof configurarPausaPonto !== 'undefined') ? configurarPausaPonto : null,
    diagGatilhos:           (typeof diagGatilhos !== 'undefined') ? diagGatilhos : null,
    diagBriefingTexto:      (typeof diagBriefingTexto !== 'undefined') ? diagBriefingTexto : null,
    diagTarefasAgendadas:   (typeof diagTarefasAgendadas !== 'undefined') ? diagTarefasAgendadas : null,
    jobMemoriaConversas:    (typeof jobMemoriaConversas !== 'undefined') ? jobMemoriaConversas : null,
    configurarMemoriaConversas: (typeof configurarMemoriaConversas !== 'undefined') ? configurarMemoriaConversas : null,
    jobAutoDiagnostico:     (typeof jobAutoDiagnostico !== 'undefined') ? jobAutoDiagnostico : null,
    configurarAutoDiagnostico: (typeof configurarAutoDiagnostico !== 'undefined') ? configurarAutoDiagnostico : null,
    configurarEvolutionUrl: (typeof configurarEvolutionUrl !== 'undefined') ? configurarEvolutionUrl : null,
    diagEventoProativo:     (typeof diagEventoProativo !== 'undefined') ? diagEventoProativo : null,
    diagTemas:              (typeof diagTemas !== 'undefined') ? diagTemas : null,
    diagInsight:            (typeof diagInsight !== 'undefined') ? diagInsight : null,
    diagEntregaInsight:     (typeof diagEntregaInsight !== 'undefined') ? diagEntregaInsight : null,
    migrarLembretesPresenca:(typeof migrarLembretesPresenca !== 'undefined') ? migrarLembretesPresenca : null,
    diagLembretePresenca:   (typeof diagLembretePresenca !== 'undefined') ? diagLembretePresenca : null,
    diagCentralizacao:      (typeof diagCentralizacao !== 'undefined') ? diagCentralizacao : null,
    diagFeedbackCuradoria:  (typeof diagFeedbackCuradoria !== 'undefined') ? diagFeedbackCuradoria : null,
    diagNotificacoes:       (typeof diagNotificacoes !== 'undefined') ? diagNotificacoes : null,
    diagRegrasNotificacao:  (typeof diagRegrasNotificacao !== 'undefined') ? diagRegrasNotificacao : null,
    diagAppsNotificacao:    (typeof diagAppsNotificacao !== 'undefined') ? diagAppsNotificacao : null,
    configurarRegraNotificacao:(typeof configurarRegraNotificacao !== 'undefined') ? configurarRegraNotificacao : null,
    diagPonto:              (typeof diagPonto !== 'undefined') ? diagPonto : null,
    // TypeSafe/JEV: só os de LEITURA. configurarTypeSafe grava a chave e fica fora de propósito —
    // um setter de segredo exposto por HTTP transforma o vazamento do DIAG_TOKEN em troca de chave.
    diagTypeSafe:           (typeof diagTypeSafe !== 'undefined') ? diagTypeSafe : null,
    diagSensibilidade:      (typeof diagSensibilidade !== 'undefined') ? diagSensibilidade : null,
    diagRotaSemantica:      (typeof diagRotaSemantica !== 'undefined') ? diagRotaSemantica : null,
    diagTriagemNotificacao: (typeof diagTriagemNotificacao !== 'undefined') ? diagTriagemNotificacao : null,
    diagFinanceiro:         (typeof diagFinanceiro !== 'undefined') ? diagFinanceiro : null,
    diagSaldo:              (typeof diagSaldo !== 'undefined') ? diagSaldo : null,
    diagParserFinanceiro:   (typeof diagParserFinanceiro !== 'undefined') ? diagParserFinanceiro : null,
    diagFinanceiroVoz:      (typeof diagFinanceiroVoz !== 'undefined') ? diagFinanceiroVoz : null,
    diagIndexacao:          (typeof diagIndexacao !== 'undefined') ? diagIndexacao : null,
    diagOrfaos:             (typeof diagOrfaos !== 'undefined') ? diagOrfaos : null,
    configurarIndexacaoAutomatica:(typeof configurarIndexacaoAutomatica !== 'undefined') ? configurarIndexacaoAutomatica : null,
    configurarNotificacoes: (typeof configurarNotificacoes !== 'undefined') ? configurarNotificacoes : null,
    resumirNotificacoes:    (typeof resumirNotificacoes !== 'undefined') ? resumirNotificacoes : null,
    registrarFeedbackInsight:(typeof registrarFeedbackInsight !== 'undefined') ? registrarFeedbackInsight : null,
    configurarCentralizacao:(typeof configurarCentralizacao !== 'undefined') ? configurarCentralizacao : null,
    configurarInsightDiario:(typeof configurarInsightDiario !== 'undefined') ? configurarInsightDiario : null,
    diagLembretes:          (typeof diagLembretes !== 'undefined') ? diagLembretes : null,
    criarLembreteCondicional:(typeof criarLembreteCondicional !== 'undefined') ? criarLembreteCondicional : null,
    cancelarLembreteCondicional:(typeof cancelarLembreteCondicional !== 'undefined') ? cancelarLembreteCondicional : null,
    diagRotina:             (typeof diagRotina !== 'undefined') ? diagRotina : null,
    configurarBriefingTurno:(typeof configurarBriefingTurno !== 'undefined') ? configurarBriefingTurno : null,
    diagProativoEstado:     (typeof diagProativoEstado !== 'undefined') ? diagProativoEstado : null,
    reposicionarBriefing:   (typeof reposicionarBriefing !== 'undefined') ? reposicionarBriefing : null,
    configurarProativo:     (typeof configurarProativo !== 'undefined') ? configurarProativo : null,
    diagTelemetria:         (typeof diagTelemetria !== 'undefined') ? diagTelemetria : null,
    pingTelemetria:         (typeof pingTelemetria !== 'undefined') ? pingTelemetria : null,
    configurarPingTelemetria: (typeof configurarPingTelemetria !== 'undefined') ? configurarPingTelemetria : null,
    usarGemini3:            (typeof usarGemini3 !== 'undefined') ? usarGemini3 : null,
    modoEconomiaGemini:     (typeof modoEconomiaGemini !== 'undefined') ? modoEconomiaGemini : null,
    permitirFaturamentoGemini: (typeof permitirFaturamentoGemini !== 'undefined') ? permitirFaturamentoGemini : null,
    pingGemini:             (typeof pingGemini !== 'undefined') ? pingGemini : null,
    usarModeloRobusto:      (typeof usarModeloRobusto !== 'undefined') ? usarModeloRobusto : null,
    testarUrlContext:       (typeof testarUrlContext !== 'undefined') ? testarUrlContext : null,
    configurarMobileToken:  (typeof configurarMobileToken !== 'undefined') ? configurarMobileToken : null,
    configurarDeviceToken:  (typeof configurarDeviceToken !== 'undefined') ? configurarDeviceToken : null,
    verDeviceQueue:         (typeof verDeviceQueue !== 'undefined') ? verDeviceQueue : null,
    configurarMacroDroid:   (typeof configurarMacroDroid !== 'undefined') ? configurarMacroDroid : null,
    obterUrlFala:           (typeof obterUrlFala !== 'undefined') ? obterUrlFala : null,
    configurarFalaVolume:   (typeof configurarFalaVolume !== 'undefined') ? configurarFalaVolume : null,
    diagVolumeFala:         (typeof diagVolumeFala !== 'undefined') ? diagVolumeFala : null,
    testarFalaCelular:      (typeof testarFalaCelular !== 'undefined') ? testarFalaCelular : null,
    configurarAvisoContato: (typeof configurarAvisoContato !== 'undefined') ? configurarAvisoContato : null,
    configurarContatosFala: (typeof configurarContatosFala !== 'undefined') ? configurarContatosFala : null,
    testarContatoFala:      (typeof testarContatoFala !== 'undefined') ? testarContatoFala : null,
    diagContatos:           (typeof diagContatos !== 'undefined') ? diagContatos : null,
    testarAvisoContato:     (typeof testarAvisoContato !== 'undefined') ? testarAvisoContato : null,
    criarAlertaVoz:         (typeof criarAlertaVoz !== 'undefined') ? criarAlertaVoz : null,
    definirTurnoTrabalho:   (typeof definirTurnoTrabalho !== 'undefined') ? definirTurnoTrabalho : null,
    listarAlertasVoz:       (typeof listarAlertasVoz !== 'undefined') ? listarAlertasVoz : null,
    cancelarAlertaVoz:      (typeof cancelarAlertaVoz !== 'undefined') ? cancelarAlertaVoz : null,
    tickAlertasVoz:         (typeof tickAlertasVoz !== 'undefined') ? tickAlertasVoz : null,
    testarCaptura:          (typeof testarCaptura !== 'undefined') ? testarCaptura : null,
    diagRaw:                (typeof diagRaw !== 'undefined') ? diagRaw : null,
    diagIndice:             (typeof diagIndice !== 'undefined') ? diagIndice : null,
    purgarMetaVetores:      (typeof purgarMetaVetores !== 'undefined') ? purgarMetaVetores : null,
    limparSkillsRuido:      (typeof limparSkillsRuido !== 'undefined') ? limparSkillsRuido : null,
    renomearArquivoDrive:   (typeof renomearArquivoDrive !== 'undefined') ? renomearArquivoDrive : null,
    reindexDoZero:          (typeof reindexDoZero !== 'undefined') ? reindexDoZero : null,
    indexarWikiSemantico:   (typeof indexarWikiSemantico !== 'undefined') ? indexarWikiSemantico : null,
    testarVozGemini:        (typeof testarVozGemini !== 'undefined') ? testarVozGemini : null,
    configurarVozGemini:    (typeof configurarVozGemini !== 'undefined') ? configurarVozGemini : null,
    // P8 · broker assíncrono + observabilidade/segurança
    testarBroker:           (typeof testarBroker !== 'undefined') ? testarBroker : null,
    brokerReindexRAG:       (typeof brokerReindexRAG !== 'undefined') ? brokerReindexRAG : null,
    brokerStatus:           (typeof brokerStatus !== 'undefined') ? function (a) { return brokerStatus(a && (a.jobId || a)); } : null,
    brokerListJobs:         (typeof brokerListJobs !== 'undefined') ? brokerListJobs : null,
    emergencyHaltBroker:    (typeof emergencyHaltBroker !== 'undefined') ? function (a) { return emergencyHaltBroker(a && (a.jobId || a)); } : null,
    statusHeartbeat:        (typeof statusHeartbeat !== 'undefined') ? statusHeartbeat : null,
    verificarHeartbeat:     (typeof verificarHeartbeat !== 'undefined') ? verificarHeartbeat : null,
    verificarCadeiaTelemetria: (typeof verificarCadeiaTelemetria !== 'undefined') ? verificarCadeiaTelemetria : null,
    testarA2ABadge:         (typeof testarA2ABadge !== 'undefined') ? testarA2ABadge : null,
    testarRegistry:         (typeof testarRegistry !== 'undefined') ? testarRegistry : null,
    rodarEvalsSeguranca:    (typeof rodarEvalsSeguranca !== 'undefined') ? rodarEvalsSeguranca : null,
    // P9 · sandbox do run_dynamic_script
    testarSandbox:          (typeof testarSandbox !== 'undefined') ? testarSandbox : null,
    configurarSandboxDinamico: (typeof configurarSandboxDinamico !== 'undefined') ? configurarSandboxDinamico : null,
    desligarSandboxDinamico:   (typeof desligarSandboxDinamico !== 'undefined') ? desligarSandboxDinamico : null,
    // P7.4 · hardening (segredos de webhook)
    configurarSegredoMacroDroid:     (typeof configurarSegredoMacroDroid !== 'undefined') ? configurarSegredoMacroDroid : null,
    configurarSegredoWebhookWhatsApp:(typeof configurarSegredoWebhookWhatsApp !== 'undefined') ? configurarSegredoWebhookWhatsApp : null,
    reindexarConhecimentoBroker:     (typeof brokerReindexRAG !== 'undefined') ? brokerReindexRAG : null
  };
  var nome = String(body.run || '');
  var fn = permitidas[nome];
  if (!fn) return { ok: false, erro: 'Função não permitida: "' + nome + '".', permitidas: Object.keys(permitidas) };
  try {
    var t0 = Date.now();
    var r = fn(body.args);  // args opcional; funções sem parâmetro ignoram
    return { ok: true, run: nome, ms: Date.now() - t0, resultado: (r === undefined ? '(sem retorno; cheque os logs no editor)' : r) };
  } catch (err) {
    return { ok: false, run: nome, erro: err.message };
  }
}

/**
 * Aponta a Evolution para outro servidor SEM tocar na API KEY (segredo fica intocado).
 * args {} → só INSPECIONA o estado atual (key apenas como "definida: true/false", nunca o valor).
 * args {url, versao?} → grava a URL; versao='go'|'v3' liga o dialeto Evolution GO, 'classica' desliga.
 * Aceita a URL com /manager no fim (é a UI web) e remove — o cliente precisa da URL BASE.
 */
function configurarEvolutionUrl(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  var atual = {
    EVOLUTION_API_URL: p.getProperty('EVOLUTION_API_URL') || p.getProperty('EVOLUTION_URL') || null,
    EVOLUTION_API_VERSION: p.getProperty('EVOLUTION_API_VERSION') || '(clássica)',
    instancia: p.getProperty('EVOLUTION_INSTANCE_NAME') || p.getProperty('EVOLUTION_INSTANCE') || null,
    EVOLUTION_INSTANCES: p.getProperty('EVOLUTION_INSTANCES') || null,
    apiKeyDefinida: !!(p.getProperty('EVOLUTION_API_KEY') || p.getProperty('EVOLUTION_APIKEY'))
  };
  if (!args.url) {
    return { ok: true, acao: 'inspecionar', atual: atual,
             nota: 'passe args.url para alterar. A API key nunca é lida nem alterada por esta função.' };
  }
  var url = String(args.url).trim().replace(/\/+$/, '').replace(/\/manager$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, erro: 'url deve começar com http:// ou https://', atual: atual };
  p.setProperty('EVOLUTION_API_URL', url);
  p.setProperty('EVOLUTION_URL', url); // nomenclatura alternativa também lida pelo _cfg do WhatsApp.js
  if (args.versao !== undefined) {
    var v = String(args.versao).toLowerCase();
    if (v === 'go' || v === 'v3') p.setProperty('EVOLUTION_API_VERSION', 'go');
    else p.deleteProperty('EVOLUTION_API_VERSION'); // clássica = property ausente
  }
  return { ok: true, acao: 'definir', antes: atual,
           agora: { url: url, versao: p.getProperty('EVOLUTION_API_VERSION') || '(clássica)' } };
}

/** Gera e grava o DIAG_TOKEN (rota de diagnóstico do /exec). Execute UMA VEZ no editor e guarde o token. */
function configurarDiagToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('DIAG_TOKEN', token);
  Logger.log('✅ DIAG_TOKEN gerado:\n' + token + '\n\nUse no PowerShell:\n' +
    'Invoke-RestMethod -Method Post -Uri "<SEU_/exec>" -ContentType "application/json" -Body (@{ token="' + token + '"; run="statusJarvis" } | ConvertTo-Json)');
  return token;
}

/**
 * Processa um webhook da Evolution API (mensagem recebida no WhatsApp) e faz o Jarvis responder.
 * Segurança: valida WHATSAPP_WEBHOOK_SECRET (query ?wh=...); ignora mensagens próprias;
 * allowlist opcional (WHATSAPP_ALLOWED); só o número do dono ganha poderes de proprietário.
 */
function _handleWhatsAppWebhook(e, body, json) {
  try {
    var p = PropertiesService.getScriptProperties();
    var secret = p.getProperty('WHATSAPP_WEBHOOK_SECRET');
    /* FAIL-CLOSED. Era `if (secret && ...)`: sem a property, o webhook aceitava QUALQUER um — e a URL
     * /exec ficou exposta em commits órfãos servidos publicamente pelo GitHub (22-23/09). Sem o
     * segredo, alguém podia forjar um messages.upsert "do dono" e o Jarvis o executaria com os
     * privilégios dele. Conferido em 23/09: o segredo está definido e a checagem funciona. Esta
     * mudança só vale no acidente — a property sumir — e aí a porta fica FECHADA, não aberta.
     * Recuperar: configurarSegredoWebhookWhatsApp() e reapontar o webhook da Evolution. */
    if (!secret) return json({ ok: false, error: 'Webhook bloqueado: WHATSAPP_WEBHOOK_SECRET não configurado.' });
    if (!e.parameter || e.parameter.wh !== secret) return json({ ok: false, error: 'Webhook não autorizado.' });

    var w = WhatsApp.parseWebhook(body);
    if (w.evento.indexOf('messages.upsert') === -1 && w.evento.indexOf('messages_upsert') === -1) return json({ ok: true, ignored: w.evento });
    // 🚫 NUNCA responder em GRUPOS/broadcast/newsletter (evita ban e ruído). Só conversas 1:1.
    var _jid = String(w.jid || '');
    if (_jid.indexOf('@g.us') !== -1 || _jid.indexOf('@broadcast') !== -1 || _jid.indexOf('@newsletter') !== -1) {
      return json({ ok: true, ignored: 'grupo/broadcast — bot nao responde' });
    }
    // Modo do bot inbound: 'off' desliga as respostas automáticas; 'auto' (padrão) responde.
    var modoBot = (p.getProperty('WHATSAPP_BOT_MODE') || 'auto').toLowerCase();
    if (modoBot === 'off') return json({ ok: true, ignored: 'bot inbound desligado (WHATSAPP_BOT_MODE=off)' });
    var temMidia = w.tipoMidia === 'audio' || w.tipoMidia === 'imagem';
    // 🤖 CENTRAL DE COMANDO no self-chat ("Bruno (você)" / Mensagens para mim): mensagem SUA,
    // no chat consigo mesmo, começando com "Jarvis" (ou ".j") → vira comando do dono direto do
    // WhatsApp. Ex.: "Jarvis autorizar 49f47b9b", "Jarvis o que tenho agendado hoje?".
    var _ownerNumCmd = (p.getProperty('WHATSAPP_OWNER_NUMBER') || '').replace(/\D/g, '');
    var _txtCmd = String(w.texto || '').trim();
    // Gatilhos no self-chat: "Jarvis ..." / ".j ..." (qualquer comando) e também "autorizar/negar <id>"
    // sem prefixo (inequívocos). Mensagens do PRÓPRIO bot são marcadas com 🤖 e ignoradas (anti-loop).
    var ehComandoSelf = !!(w.fromMe && _ownerNumCmd && String(w.jid || '').indexOf(_ownerNumCmd) !== -1 &&
      _txtCmd.indexOf('🤖') !== 0 &&
      (/^(jarvis|\.j)\b/i.test(_txtCmd) || /^(autorizar|negar)\s+\S+/i.test(_txtCmd) ||
       // ÁUDIO seu no self-chat = comando falado (os áudios que o BOT envia são ignorados pelo id).
       (w.tipoMidia === 'audio' && !(w.key && WhatsApp.foiEnviadoPorMim(w.key.id)))));
    if (ehComandoSelf) {
      w.texto = _txtCmd.replace(/^(jarvis|\.j)\b[,:\s]*/i, '').trim();
      w._comandoSelf = true;
      if (!w.texto && !temMidia) return json({ ok: true, ignored: 'comando vazio' });
    } else if (w.fromMe || (!_txtCmd && !temMidia)) {
      return json({ ok: true, ignored: 'fromMe ou sem conteúdo' });
    }

    // 🛡️ IDEMPOTÊNCIA: a Evolution às vezes REENVIA o mesmo webhook (retry) → processaríamos e
    // responderíamos 2x (e dispararíamos o aviso de voz 2x). Dedupe por ID da mensagem (CacheService).
    try {
      var _mid = (w.key && w.key.id) ? String(w.key.id) : '';
      if (_mid) {
        var _cidem = CacheService.getScriptCache();
        if (_cidem.get('wamsg_' + _mid)) return json({ ok: true, ignored: 'mensagem duplicada (já processada)' });
        _cidem.put('wamsg_' + _mid, '1', 600); // marca por 10 min ANTES de processar (vence o retry)
      }
    } catch (eIdem) {}

    // Allowlist OPCIONAL (números separados por vírgula). Só restringe se houver NÚMEROS válidos —
    // um valor sem dígitos (ex.: "EVOLUTION" por engano) NÃO deve bloquear todo mundo.
    var allowRaw = p.getProperty('WHATSAPP_ALLOWED') || '';
    var permitidos = allowRaw.split(',').map(function (s) { return s.replace(/\D/g, ''); }).filter(Boolean);
    if (permitidos.length) {
      var liberado = false;
      for (var i = 0; i < permitidos.length; i++) {
        if (w.numero.indexOf(permitidos[i]) !== -1 || permitidos[i].indexOf(w.numero) !== -1) { liberado = true; break; }
      }
      if (!liberado) return json({ ok: true, ignored: 'numero nao autorizado' });
    }

    // Número do dono → poderes de proprietário; senão → Jarvis somente leitura/conversa (Zero-Trust).
    var ownerNum = (p.getProperty('WHATSAPP_OWNER_NUMBER') || '').replace(/\D/g, '');
    var ehDono = ownerNum && (w.numero.indexOf(ownerNum) !== -1 || ownerNum.indexOf(w.numero) !== -1);
    var email = ehDono ? (p.getProperty('OWNER_EMAIL') || 'owner') : ('whatsapp:' + w.numero);

    // Contexto da conversa: últimas mensagens trocadas com este contato (para o Jarvis responder com memória).
    var historico = [];
    try {
      var hist = WhatsApp.findMessages(w.jid || w.numero, 10);
      if (hist && hist.status === 'success' && hist.mensagens) {
        historico = hist.mensagens.map(function (m) {
          return { role: m.fromMe ? 'assistant' : 'user', text: m.texto };
        }).filter(function (m) { return m.text && m.text.indexOf('[') !== 0; });
      }
    } catch (eh) {}

    // Para CONTATOS (não-dono), prefere o NOME SALVO nos seus contatos (ex.: "Mãe", "Tia Jaque") —
    // mantém seu padrão de nomenclatura no aviso E nas respostas do agente. Fallback: pushName/número.
    var de = w.pushName || w.numero;
    if (!ehDono) { try { var _salvo = (typeof Contatos !== 'undefined' && Contatos.nomeDe) ? Contatos.nomeDe(w.numero) : ''; if (_salvo) de = _salvo; } catch (eC) {} }
    var ctx = '[Mensagem recebida no WhatsApp de ' + de + ']\n' + w.texto;
    var anexo = null;

    // 🔊 Avisa o dono em VOZ ALTA no Android quando um CONTATO (não-dono) manda mensagem.
    if (!ehDono) _avisarContatoNoCelular(de, w.texto, w.tipoMidia, w.numero);

    // Mídia (áudio/imagem) → baixa o binário e envia como anexo multimodal ao Jarvis.
    if (temMidia) {
      try {
        var mid = WhatsApp.baixarMidiaBase64(w.mensagemRaw, w.key);
        if (mid && mid.status === 'success' && mid.base64) {
          anexo = { tipo: 'inline', data: mid.base64, mimeType: mid.mimetype || w.mimeMidia, nome: (w.tipoMidia === 'audio' ? 'audio.ogg' : 'imagem.jpg') };
          if (w.tipoMidia === 'audio') {
            ctx = '[Áudio recebido no WhatsApp de ' + de + ' — transcreva o áudio e atenda ao pedido]' + (w.texto ? ('\nLegenda: ' + w.texto) : '');
          } else {
            ctx = '[Imagem recebida no WhatsApp de ' + de + ' — descreva e/ou aja conforme o pedido]' + (w.texto ? ('\nLegenda: ' + w.texto) : '');
          }
        } else if (!String(w.texto).trim()) {
          ctx += '\n(Não consegui baixar a mídia ' + w.tipoMidia + '.)';
        }
      } catch (em) {}
    }

    // MODO SECRETÁRIA: para contatos (não-dono), NÃO responde direto — rascunha e pede aprovação.
    var ehSecretaria = (modoBot === 'secretaria') && !ehDono;
    if (ehSecretaria) {
      var ctxDraft = ctx + '\n\n[MODO SECRETÁRIA: NÃO responda à pessoa. RASCUNHE, em nome do proprietário (1ª pessoa), uma resposta curta e adequada a esta mensagem, considerando o histórico. Devolva APENAS o texto da resposta sugerida, sem comentários nem rótulos.]';
      var rascunho = Jarvis.ask(email, ctxDraft, historico, anexo, { interativo: false });
      try { Secretaria.registrar(w.numero, de, (w.tipoMidia ? ('[' + w.tipoMidia + '] ') : '') + String(w.texto || ''), rascunho); } catch (esec) {}
      return json({ ok: true, secretaria: true, pendente: w.numero });
    }

    // Indicador "digitando/gravando" enquanto o Jarvis pensa (parece humano).
    try { WhatsApp.enviarPresenca(w.numero, (w.tipoMidia === 'audio') ? 'recording' : 'composing'); } catch (ep) {}

    var resposta;
    try {
      resposta = Jarvis.ask(email, ctx, historico, anexo, { interativo: false });
    } catch (eAsk) {
      // MODO RESERVA no inbound: sem cota do Gemini, o bot segue conversando (social, sem
      // ferramentas) por um provedor alternativo — em vez de simplesmente não responder.
      resposta = _reservaInbound(eAsk.message, ctx, historico, ehDono);
      if (!resposta) {
        // NUNCA falhar em silêncio: dono recebe o erro; terceiro recebe uma saída natural.
        try {
          WhatsApp.enviar(w.numero, (ehDono || w._comandoSelf)
            ? '🤖 ⚠️ Não consegui processar agora: ' + String(eAsk.message).substring(0, 160)
            : 'opa, me embolei aqui agora 😅 me manda de novo?');
        } catch (eAv) {}
        return json({ ok: false, error: eAsk.message });
      }
    }
    // Resposta vazia (loop terminou sem texto) também não pode virar silêncio.
    if (!String(resposta || '').trim()) {
      resposta = ehDono ? '⚠️ Não consegui gerar uma resposta para isso. Pode reformular?' : 'opa, repete pra mim? 😅';
    }
    // Remove a linha "SUGESTÕES:" (chips são só da UI do app — nunca vazar no WhatsApp).
    resposta = String(resposta || '').replace(/\n\s*SUGEST(?:Õ|O)ES:.*$/i, '').trim();

    // Fala no celular: se o dono pediu "fala ... no android/voz alta", garante o disparo (pula se já falou).
    try { _falarRespostaNoCelular(String(w.texto || ''), resposta, ehDono); } catch (eFc) {}

    // Modo "espelho": se a mensagem recebida foi ÁUDIO, responde em VOZ (PTT). Fallback: texto.
    var modoVoz = (w.tipoMidia === 'audio') && (typeof Voz !== 'undefined') && Voz.temChave();
    if (modoVoz) {
      try {
        var tts = Voz.sintetizar(resposta);
        if (tts.status === 'success') {
          var env = WhatsApp.enviarAudio(w.numero, tts.base64);
          if (env.status === 'success') return json({ ok: true, respondido: w.numero, voz: true });
        }
      } catch (ev) {}
      // se a voz falhar, cai para texto
    }
    // Resposta no SELF-CHAT leva o marcador 🤖 (distingue do que você digita e evita loop no webhook).
    if (w._comandoSelf) resposta = '🤖 ' + resposta;
    WhatsApp.enviar(w.numero, resposta);
    return json({ ok: true, respondido: w.numero, comandoSelf: !!w._comandoSelf, midia: w.tipoMidia || '' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

/** Configura o conector WhatsApp/Evolution (Script Properties). Rode UMA VEZ no editor. */
function configurarWhatsApp(url, apikey, instance, ownerNumber, allowed) {
  var p = PropertiesService.getScriptProperties();
  if (url) p.setProperty('EVOLUTION_URL', String(url).replace(/\/+$/, ''));
  if (apikey) p.setProperty('EVOLUTION_APIKEY', apikey);
  if (instance) p.setProperty('EVOLUTION_INSTANCE', instance);
  if (ownerNumber) p.setProperty('WHATSAPP_OWNER_NUMBER', String(ownerNumber).replace(/\D/g, ''));
  if (allowed !== undefined) p.setProperty('WHATSAPP_ALLOWED', String(allowed || ''));
  if (!p.getProperty('WHATSAPP_WEBHOOK_SECRET')) p.setProperty('WHATSAPP_WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
  var s = p.getProperty('WHATSAPP_WEBHOOK_SECRET');
  Logger.log('✅ WhatsApp/Evolution configurado.');
  Logger.log('Configure na Evolution o webhook (evento messages.upsert) apontando para:');
  Logger.log('   <URL_DA_SUA_WEBAPP>/exec?wh=' + s);
  Logger.log('Opcional: WHATSAPP_ALLOWED = números separados por vírgula (limita quem o bot atende).');
}

/* ===================== Painel de conexão WhatsApp (proprietário) ===================== */
function wppInstancias(token) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, error: 'Apenas o proprietário pode gerenciar conexões.' };
  try {
    var nomes = WhatsApp.instanciasConfig();
    var todas = WhatsApp.listarInstancias();
    var mapa = {};
    if (todas && todas.instancias) todas.instancias.forEach(function (i) { mapa[i.nome] = i; });
    var lista = nomes.map(function (n) {
      var i = mapa[n];
      if (i) return { nome: n, estado: i.estado, numero: i.numero || '', perfil: i.perfil || '' };
      var st; try { st = WhatsApp.connState(n); } catch (e) { st = { status: 'erro' }; }
      return { nome: n, estado: st.status, numero: '', perfil: '' };
    });
    var botAtivo = false;
    try { var wh = WhatsApp.statusWebhook(); botAtivo = !!(wh && wh.apontaParaCa); } catch (eWh) {}
    return { ok: true, instancias: lista, dashboardUrl: WhatsApp.dashboardUrl(), botAtivo: botAtivo };
  } catch (e) { return { ok: false, error: e.message }; }
}
function wppConectar(token, instanceName) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, error: 'Apenas o proprietário.' };
  try { var r = WhatsApp.obterQrCode(instanceName); r.ok = true; return r; } catch (e) { return { ok: false, error: e.message }; }
}
function wppStatus(token, instanceName) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, error: 'Apenas o proprietário.' };
  try { var r = WhatsApp.connState(instanceName); r.ok = true; return r; } catch (e) { return { ok: false, error: e.message }; }
}
/** Ativa o bot: aponta o webhook da instância para este web app (Jarvis passa a RECEBER as mensagens). */
function wppApontarWebhook(token, instanceName) {
  var s = getSessionUser(token);
  if (!s || !Jarvis._isOwner(s.email)) return { ok: false, error: 'Apenas o proprietário.' };
  try { var r = WhatsApp.apontarWebhook(instanceName); r.ok = (r.status === 'success'); return r; } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Aponta o webhook da Evolution para o /exec deste web app (evento MESSAGES_UPSERT).
 * Rode no editor GAS (ou via clasp run) — usa a instância e o secret das Script Properties.
 */
function apontarWebhookJarvis() {
  var r = WhatsApp.apontarWebhook();
  Logger.log(r.status === 'success'
    ? ('✅ Webhook apontado para o Jarvis: ' + r.webhook + ' (instância ' + r.instancia + ')')
    : ('❌ ' + (r.erro || 'falha')));
  return r;
}

/** Define o modo do bot inbound. modo: 'auto' (responde 1:1) | 'secretaria' (rascunha + pede sua aprovação) | 'off'. */
function configurarBotInbound(modo) {
  modo = (modo || 'auto').toLowerCase();
  var validos = ['auto', 'secretaria', 'off'];
  if (validos.indexOf(modo) === -1) { Logger.log('❌ Modo inválido. Use: ' + validos.join(' | ')); return; }
  PropertiesService.getScriptProperties().setProperty('WHATSAPP_BOT_MODE', modo);
  var desc = modo === 'off' ? '(NÃO responde nada)' : (modo === 'secretaria' ? '(rascunha e pede sua aprovação antes de responder; NUNCA grupos)' : '(responde 1:1 sozinho; NUNCA grupos)');
  Logger.log('✅ WHATSAPP_BOT_MODE = ' + modo + ' ' + desc);
  return modo;
}

/** DIAGNÓSTICO do webhook inbound: mostra a config REAL no Evolution × o que o app espera. */
function diagWebhookJarvis() {
  var p = PropertiesService.getScriptProperties();
  var execUrl = ''; try { execUrl = ScriptApp.getService().getUrl(); } catch (e) {}
  var secret = p.getProperty('WHATSAPP_WEBHOOK_SECRET') || '';
  Logger.log('— URL que o app usaria (getService().getUrl()): ' + execUrl);
  Logger.log('— WHATSAPP_WEBHOOK_SECRET configurado? ' + (secret ? ('sim (' + secret.substring(0, 6) + '…)') : 'NÃO'));
  Logger.log('— WHATSAPP_OWNER_NUMBER: ' + (p.getProperty('WHATSAPP_OWNER_NUMBER') || '(vazio)'));
  Logger.log('— WHATSAPP_ALLOWED (allowlist): ' + (p.getProperty('WHATSAPP_ALLOWED') || '(vazio = todos)'));
  var st = WhatsApp.statusWebhook();
  Logger.log('— statusWebhook(): ' + JSON.stringify(st));
  if (st && st.url) {
    Logger.log('— URL configurada NO EVOLUTION: ' + st.url);
    Logger.log('   • contém o ?wh=secret? ' + (secret && st.url.indexOf('wh=' + secret) !== -1 ? 'SIM ✅' : 'NÃO ❌ (inbound será rejeitado)'));
    Logger.log('   • eventos: ' + JSON.stringify(st.eventos) + ' | habilitado: ' + st.enabled + ' | apontaParaCa: ' + st.apontaParaCa);
  }
  Logger.log('➡️ Se a URL no Evolution NÃO tiver ?wh=secret ou NÃO bater com a /exec aberta, rode apontarWebhookJarvis() a partir do MESMO /exec (ou ajuste).');
  return st;
}

/** SIMULA uma mensagem inbound (sem depender da entrega do Evolution): testa o handler + a resposta real. */
function testarInbound(numeroRemetente, texto) {
  var p = PropertiesService.getScriptProperties();
  var inst = p.getProperty('EVOLUTION_INSTANCE') || p.getProperty('EVOLUTION_INSTANCE_NAME') || '';
  var de = (numeroRemetente || '5511999999999').replace(/\D/g, '');
  var body = {
    event: 'messages.upsert', instance: inst,
    data: {
      key: { remoteJid: de + '@s.whatsapp.net', fromMe: false, id: 'TEST-' + Date.now() },
      pushName: 'Teste Inbound',
      message: { conversation: texto || 'Oi Jarvis! Teste de inbound. Me diga uma curiosidade de IA de hoje.' }
    }
  };
  var fakeE = { parameter: { wh: p.getProperty('WHATSAPP_WEBHOOK_SECRET') || undefined } };
  var out = _handleWhatsAppWebhook(fakeE, body, function (o) { return o; });
  Logger.log('Resultado do handler (deve enviar a resposta no WhatsApp de ' + de + '): ' + JSON.stringify(out));
  return out;
}

/** Simula um COMANDO SELF-CHAT ("Jarvis ...") ponta a ponta. Rode no editor; a resposta 🤖 chega no seu WhatsApp. */
function testarComandoSelf(texto) {
  var p = PropertiesService.getScriptProperties();
  var inst = p.getProperty('EVOLUTION_INSTANCE') || p.getProperty('EVOLUTION_INSTANCE_NAME') || '';
  var dono = (p.getProperty('WHATSAPP_OWNER_NUMBER') || '').replace(/\D/g, '');
  if (!dono) { Logger.log('❌ WHATSAPP_OWNER_NUMBER ausente.'); return; }
  var body = {
    event: 'messages.upsert', instance: inst,
    data: {
      key: { remoteJid: dono + '@s.whatsapp.net', fromMe: true, id: 'SELF-' + Date.now() },
      pushName: 'Bruno',
      message: { conversation: texto || 'Jarvis oi! Responda em 1 frase que o comando self-chat está funcionando.' }
    }
  };
  var fakeE = { parameter: { wh: p.getProperty('WHATSAPP_WEBHOOK_SECRET') || undefined } };
  var out = _handleWhatsAppWebhook(fakeE, body, function (o) { return o; });
  Logger.log('Resultado (esperado comandoSelf:true e resposta 🤖 no seu self-chat): ' + JSON.stringify(out));
  if (out && out.ignored) Logger.log('⚠️ Caiu em "' + out.ignored + '" — confira o prefixo "Jarvis"/".j" ou o número do dono.');
  return out;
}

/**
 * Configura a Base de Conhecimento a partir de UMA pasta raiz (BaseConhecimento) no Drive.
 * Resolve e grava: WIKI_DRIVE_ID (wiki/), RAW_DRIVE_ID (raw/) e BASE_CONHECIMENTO_DRIVE_ID (wiki/skills/).
 * Garante que raw/ e wiki/ sejam IRMÃOS dentro da mesma pasta (consistência da ingestão).
 * Ex.: configurarBaseConhecimento('<ID_da_pasta_BaseConhecimento>')
 */
function configurarBaseConhecimento(rootId) {
  var p = PropertiesService.getScriptProperties();
  function sub(folder, nome) { var it = folder.getFoldersByName(nome); return it.hasNext() ? it.next() : null; }
  function ehRaiz(id) { try { var f = DriveApp.getFolderById(id); return !!(sub(f, 'wiki') && sub(f, 'raw')); } catch (e) { return false; } }

  // Pelo botão "Executar" não há argumento → tenta BASE_ROOT_ID; depois BASE_CONHECIMENTO_DRIVE_ID (se for a raiz).
  rootId = rootId || p.getProperty('BASE_ROOT_ID');
  if (!rootId) {
    var cand = p.getProperty('BASE_CONHECIMENTO_DRIVE_ID');
    if (cand && ehRaiz(cand)) rootId = cand; // usuário pôs a pasta-raiz aqui por engano → aproveitamos
  }
  if (!rootId) { Logger.log('❌ Defina a Script Property BASE_ROOT_ID com o ID da pasta BaseConhecimento (a que contém wiki/ e raw/) e rode de novo.'); return; }
  if (!ehRaiz(rootId)) { Logger.log('❌ A pasta ' + rootId + ' não contém as subpastas "wiki" e "raw". Use o ID da pasta MÃE (BaseConhecimento), não o wiki nem o skills.'); return; }
  p.setProperty('BASE_ROOT_ID', rootId);
  var root = DriveApp.getFolderById(rootId);
  var wiki = sub(root, 'wiki');
  var raw = sub(root, 'raw');
  var skills = sub(wiki, 'skills');
  p.setProperty('WIKI_DRIVE_ID', wiki.getId());
  p.setProperty('RAW_DRIVE_ID', raw.getId());
  if (skills) p.setProperty('BASE_CONHECIMENTO_DRIVE_ID', skills.getId());
  // limpa cache de skills p/ redescobrir
  if (typeof SkillsManager !== 'undefined') { try { ['AgenteJarvis','global'].forEach(function(a){ SkillsManager.invalidarCache(a); }); } catch (e) {} }
  Logger.log('✅ BaseConhecimento configurada:\n  WIKI_DRIVE_ID=' + wiki.getId() + '\n  RAW_DRIVE_ID=' + raw.getId() + '\n  BASE_CONHECIMENTO_DRIVE_ID(skills)=' + (skills ? skills.getId() : 'NÃO ENCONTRADA (wiki/skills)'));
}

/**
 * Busca o endereço de Casa ou Trabalho salvo no arquivo markdown "entities/enderecos.md" na Wiki.
 * Se não encontrar ou o arquivo não existir, retorna null.
 * @param {string} tipo "Casa" ou "Trabalho"
 * @return {string|null} O endereço físico completo ou null
 */
function _obterEnderecoDaWiki(tipo) {
  try {
    if (typeof WikiMemoryService !== 'undefined') {
      var res = WikiMemoryService.lerWiki("entities/enderecos.md");
      if (res && res.status === "success" && res.conteudo) {
        var linhas = res.conteudo.split("\n");
        for (var i = 0; i < linhas.length; i++) {
          var lin = linhas[i].trim();
          var match = lin.match(new RegExp("(?:-|\\*|)\\s*" + tipo + "\\s*:\\s*(.+)", "i"));
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Erro ao buscar endereço da Wiki: " + e.message);
  }
  return null;
}

/**
 * B1 · Limpeza de telemetria antiga — evita que agente_eventos e feedback cresçam
 * indefinidamente e estourem o free tier do Firestore (1 GiB).
 *   agente_eventos:  doc id tem prefixo de timestamp-reverso → apaga com > 30 dias.
 *   feedback:        campo ts (ms) → apaga com > 90 dias.
 *   conversa_vetores: campo ts/atualizadoEm (ms) → apaga com > 180 dias (CREALO-10, minimização de dados).
 * Defensivo (try/catch por delete). Retorna { eventosApagados, feedbackApagados, memoriaApagada }.
 */
function _limparTelemetriaAntiga() {
  var agora = Date.now();
  var eventosApagados = 0, feedbackApagados = 0, memoriaApagada = 0;

  // --- agente_eventos (id = "<tsReverso>_<sufixo>") ---
  try {
    var evDocs = Firestore.listDocs('agente_eventos', 2000);
    evDocs.forEach(function (d) {
      try {
        var ts = 1e13 - Number(String(d.id).split('_')[0]);
        var idadeDias = (agora - ts) / 86400000;
        if (idadeDias > 30) {
          try { Firestore.deleteDoc('agente_eventos', d.id); eventosApagados++; } catch (eDel) {}
        }
      } catch (eParse) {}
    });
  } catch (eList) { Logger.log('[_limparTelemetriaAntiga] agente_eventos list: ' + eList.message); }

  // --- feedback (campo ts em ms) ---
  try {
    var fbDocs = Firestore.listDocs('feedback', 1000);
    fbDocs.forEach(function (d) {
      try {
        var fbTs = Number((d.dados || {}).ts);
        if (fbTs && (agora - fbTs) / 86400000 > 90) {
          try { Firestore.deleteDoc('feedback', d.id); feedbackApagados++; } catch (eDel) {}
        }
      } catch (eParse) {}
    });
  } catch (eList) { Logger.log('[_limparTelemetriaAntiga] feedback list: ' + eList.message); }

  // --- conversa_vetores (campo ts/atualizadoEm em ms) — CREALO-10: memória de conversa > 180 dias ---
  try {
    var mvDocs = Firestore.listDocs('conversa_vetores', 5000);
    mvDocs.forEach(function (d) {
      try {
        var mvTs = Number((d.dados || {}).ts || (d.dados || {}).atualizadoEm);
        if (mvTs && (agora - mvTs) / 86400000 > 180) {
          try { Firestore.deleteDoc('conversa_vetores', d.id); memoriaApagada++; } catch (eDel) {}
        }
      } catch (eParse) {}
    });
  } catch (eList) { Logger.log('[_limparTelemetriaAntiga] conversa_vetores list: ' + eList.message); }

  Logger.log('[_limparTelemetriaAntiga] agente_eventos apagados: ' + eventosApagados + ' · feedback apagados: ' + feedbackApagados + ' · memoria apagada: ' + memoriaApagada);
  return { eventosApagados: eventosApagados, feedbackApagados: feedbackApagados, memoriaApagada: memoriaApagada };
}

/** Limpeza manual de telemetria antiga. Rode no editor quando precisar. */
function limparTelemetria() {
  var r = _limparTelemetriaAntiga();
  Logger.log('✅ limparTelemetria: ' + JSON.stringify(r));
  return r;
}

/**
 * Configura as credenciais da API de CT-e (Script Properties). Rode UMA VEZ no editor
 * com a senha NOVA (após rotacioná-la) e depois apague a chamada/limpe o histórico.
 * Ex.: configurarCTeAPI('BRUNO MARQUES', 'NOVA_SENHA', 'LLESL087', 1)
 */
function configurarCTeAPI(usuario, senha, tag, empresa) {
  var p = PropertiesService.getScriptProperties();
  if (usuario) p.setProperty('CTE_API_USUARIO', usuario);
  if (senha) p.setProperty('CTE_API_SENHA', senha);
  p.setProperty('CTE_API_TAG', tag || '');
  p.setProperty('CTE_API_EMPRESA', String(empresa || 1));
  Logger.log('✅ CTE_API_* configurado para o usuário: ' + (p.getProperty('CTE_API_USUARIO') || '(vazio)'));
}

function verificarWebhooks() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('MACRODROID_WEBHOOK_URL=' + props.MACRODROID_WEBHOOK_URL);
  Logger.log('MACRODROID_WEBHOOK_SECRET=' + props.MACRODROID_WEBHOOK_SECRET);
}

/** Grava a URL /exec da implantação ativa. Ela é o endereço PÚBLICO deste web app
 *  (access: ANYONE_ANONYMOUS) — por isso saiu do código e vive só em Script Property.
 *  Pegue com `clasp deployments` e rode UMA VEZ:
 *    configurarExecUrl({url:'https://script.google.com/macros/s/<ID>/exec'})
 *  Usada pelas notificações interativas (botões) e pelo apontamento do webhook do WhatsApp. */
function configurarExecUrl(args) {
  var u = (args && (args.url || args)) ? String(args.url || args).trim() : '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u)) {
    return { ok: false, erro: 'Informe a URL completa terminando em /exec. Ex.: configurarExecUrl({url:"https://script.google.com/macros/s/<ID>/exec"})' };
  }
  PropertiesService.getScriptProperties().setProperty('WEBHOOK_EXEC_URL', u);
  return { ok: true, configurado: true, url: u };
}

/** A URL /exec já está gravada? Diz sem revelar a URL inteira (o log pode ser compartilhado). */
function diagExecUrl() {
  var u = String(PropertiesService.getScriptProperties().getProperty('WEBHOOK_EXEC_URL') || '');
  return { ok: true, configurada: !!u,
           amostra: u ? (u.substring(0, 46) + '…/exec') : null,
           nota: u ? 'Notificações interativas e webhook do WhatsApp operacionais.'
                   : 'AUSENTE — rode configurarExecUrl({url:"…"}). Sem ela, os botões da notificação interativa não funcionam.' };
}
