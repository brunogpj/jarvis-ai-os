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
      
      // Processa conforme o tipo
      if (cbDoc.tipo === 'conversa') {
        var textoResposta = "";
        if (botao === '1') textoResposta = cbDoc.opcao1;
        else if (botao === '2') textoResposta = cbDoc.opcao2;
        else textoResposta = resposta;
        
        // Simula a fala do usuário na conversa atual (chama ask)
        var respLLM = Jarvis.ask(cbDoc.emailUser, textoResposta, null, null, { interativo: true, conversaId: cbDoc.conversaId });
        
        // Se tiver WhatsApp configurado, envia a resposta de volta ao usuário para manter a conversa
        var num = PropertiesService.getScriptProperties().getProperty('WHATSAPP_OWNER_NUMBER');
        if (num && typeof WhatsApp !== 'undefined' && respLLM) {
          WhatsApp.enviar(num, "🤖 *Jarvis:* " + respLLM);
        }
        
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
        
        // Envia mensagem de sucesso via WhatsApp
        var num = PropertiesService.getScriptProperties().getProperty('WHATSAPP_OWNER_NUMBER');
        if (num && typeof WhatsApp !== 'undefined') {
          var escolhaStr = (botao === '1' ? cbDoc.opcao1 : (botao === '2' ? cbDoc.opcao2 : resposta));
          var msgSuccess = "✅ *Ação Executada com Sucesso!*\nNotificação: " + cbDoc.texto + "\nEscolha: " + escolhaStr;
          WhatsApp.enviar(num, msgSuccess);
        }
        
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
  var sensivel = _assuntoSensivel(texto) || _assuntoSensivel(de);
  var p = PropertiesService.getScriptProperties();
  var ignorado = _contatoNaLista(p.getProperty('FALA_CONTATO_IGNORAR'), de, numero);
  var discreto = ignorado ? false : ((tipoMidia === 'imagem') || _contatoNaLista(p.getProperty('FALA_CONTATO_DISCRETO'), de, numero) || sensivel);
  var g = _generoPorNome(de);
  return {
    ok: true, de: de,
    decisao: ignorado ? 'IGNORADO (sem aviso)' : (discreto ? 'DISCRETO (não lê o conteúdo)' : 'NORMAL (lê o conteúdo)'),
    assuntoSensivel: sensivel,
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
function criarAlertaVoz(args)    { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.criar(args || {}) : { ok: false, erro: 'AlertasVoz indisponível.' }; }
function listarAlertasVoz()      { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.listar() : []; }
function cancelarAlertaVoz(args) { return (typeof AlertasVoz !== 'undefined') ? AlertasVoz.cancelar(args && (args.alerta || args.id || args)) : { ok: false }; }

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
    var discreto = (tipoMidia === 'imagem') || _contatoNaLista(p.getProperty('FALA_CONTATO_DISCRETO'), nome, numero) || _assuntoSensivel(texto) || _assuntoSensivel(nome);
    var corpo;
    if (discreto) corpo = 'te enviou uma mensagem.';
    else if (tipoMidia === 'audio') corpo = 'enviou um áudio.';
    else { var t = _prepararTextoFala(texto); corpo = t ? ('disse: ' + t) : 'enviou uma mensagem.'; }
    Jarvis.controlarDispositivo({ acao: 'falar', texto: ('Nova mensagem no WhatsApp. ' + nome + ' ' + corpo).substring(0, 600), voz: voz });
  } catch (e) {}
}

// BÍBLIA FALADA: busca o texto do versículo (tradução Almeida, domínio público) na bible-api.com.
// apiRef no formato "MAT+6:7" (código USFM ou nome PT + cap:versículo). Retorna { ok, ref, texto }.
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
function _assuntoSensivel(texto) {
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
  return null;
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
      vozes: ['Enceladus', 'Sulafat', 'Kore', 'Puck', 'Charon', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Fenrir']
    };
    return { ok: true, atual: atual, vozes: vozes, gemini: gemini };
  } catch (e) { return { ok: false, erro: e.message }; }
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
    var v = String(p.vozGemini).trim();
    if (/^[A-Za-z]{3,24}$/.test(v)) out.TTS_VOICE_GEMINI = v;
    else erros.push('Nome de voz Gemini inválido (só letras, ex.: Enceladus, Sulafat).');
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
        emailUser = props.getProperty('OWNER_EMAIL') || 'dono@exemplo.com';
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
        // Inicializa os endereços padrão se não estiverem configurados nas propriedades
        if (!props.getProperty('CASA_ENDERECO')) {
          props.setProperty('CASA_ENDERECO', '<endereço de Casa>');
        }
        if (!props.getProperty('TRABALHO_ENDERECO')) {
          props.setProperty('TRABALHO_ENDERECO', '<endereço de Trabalho>');
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
          var charg = obterValorResolvido(body.carregando);
          var sound = obterValorResolvido(body.modo_som);
          var wifi = obterValorResolvido(body.wifi_nome || body.wifi);
          
          if (bat && precisaStatus) {
            contextLoc += "\n- Nível da Bateria: " + bat.replace('%', '') + "%";
          }
          if (charg && precisaStatus) {
            var cL = charg.toLowerCase();
            var isCharging = (cL.indexOf('charging') !== -1 || cL.indexOf('carregando') !== -1 || cL === 'true' || cL.indexOf('ac') !== -1 || cL.indexOf('usb') !== -1 || cL.indexOf('plugged') !== -1);
            contextLoc += "\n- Carregando: " + (isCharging ? 'Sim' : 'Não');
          }
          if (sound && precisaStatus) {
            var sL = sound.toLowerCase();
            var modeSound = 'Normal';
            if (sL.indexOf('silent') !== -1 || sL.indexOf('silencioso') !== -1 || sL.indexOf('silêncio') !== -1) {
              modeSound = 'Silencioso';
            } else if (sL.indexOf('vibrate') !== -1 || sL.indexOf('vibrar') !== -1) {
              modeSound = 'Vibrar';
            }
            contextLoc += "\n- Modo de Som: " + modeSound;
          }
          if (wifi && precisaStatus) {
            contextLoc += "\n- Conectado ao Wi-Fi: " + wifi;
          }
          
          if (precisaLoc) {
            var casaEnd = _obterEnderecoDaWiki('Casa') || props.getProperty('CASA_ENDERECO') || '<endereço de Casa>';
            var trabEnd = _obterEnderecoDaWiki('Trabalho') || props.getProperty('TRABALHO_ENDERECO') || '<endereço de Trabalho>';
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
              
              historico = msgs.slice(-4).map(function (m) {
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
        var _bib = (function () {
          var LIV = { 'genesis':'GEN','exodo':'EXO','levitico':'LEV','numeros':'NUM','deuteronomio':'DEU','josue':'JOS','juizes':'JDG','rute':'RUT','1 samuel':'1SA','2 samuel':'2SA','1 reis':'1KI','2 reis':'2KI','1 cronicas':'1CH','2 cronicas':'2CH','esdras':'EZR','neemias':'NEH','ester':'EST','jo':'JOB','job':'JOB','salmo':'PSA','salmos':'PSA','proverbios':'PRO','eclesiastes':'ECC','canticos':'SNG','cantares':'SNG','isaias':'ISA','jeremias':'JER','lamentacoes':'LAM','ezequiel':'EZK','daniel':'DAN','oseias':'HOS','joel':'JOL','amos':'AMO','obadias':'OBA','jonas':'JON','miqueias':'MIC','naum':'NAM','habacuque':'HAB','sofonias':'ZEP','ageu':'HAG','zacarias':'ZEC','malaquias':'MAL','mateus':'MAT','marcos':'MRK','lucas':'LUK','joao':'JHN','atos':'ACT','romanos':'ROM','1 corintios':'1CO','2 corintios':'2CO','galatas':'GAL','efesios':'EPH','filipenses':'PHP','colossenses':'COL','1 tessalonicenses':'1TH','2 tessalonicenses':'2TH','1 timoteo':'1TI','2 timoteo':'2TI','tito':'TIT','filemom':'PHM','hebreus':'HEB','tiago':'JAS','1 pedro':'1PE','2 pedro':'2PE','1 joao':'1JN','2 joao':'2JN','3 joao':'3JN','judas':'JUD','apocalipse':'REV' };
          if (!/b[íi]blia|vers[íi]culo/i.test(msgVoz) && !/\b\d{1,3}\s*[:]\s*\d{1,3}\b/.test(msgVoz)) return null;
          var s = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          var m = s.match(/(?:(1|2|3|primeiro|segundo|terceiro)\s+)?([a-z]{2,})\s+(?:capitulo\s+)?(\d{1,3})\s*(?::|,|\s+versiculo\s+|\s+)\s*(\d{1,3})/);
          if (!m) return null;
          var pre = m[1] ? (String(m[1]).replace('primeiro','1').replace('segundo','2').replace('terceiro','3') + ' ') : '';
          var usfmL = LIV[(pre + m[2]).trim()] || LIV[m[2]];
          if (!usfmL) return null;
          var nomeRef = (pre + m[2]).trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          // Intenção de OUVIR o versículo (Jarvis LÊ em voz alta) vs. só ABRIR no YouVersion.
          // Testa sobre o texto SEM acento (s) com padrões ASCII — robusto a encoding do 'í'/'ã'.
          var querFalar = /(biblia\s+falada|versiculo\s+falad|\b(?:leia|ler|recite|recita|declare|narre|declama|declame)\b|\bfal[ae]\b[^.]*\b(?:versiculo|biblia)\b)/.test(s);
          return { usfm: usfmL + '.' + m[3] + '.' + m[4], code: usfmL, cap: m[3], ver: m[4], ref: nomeRef + ' ' + m[3] + ':' + m[4], falar: querFalar };
        })();
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
        // (00) LEMBRETE CONDICIONAL ("quando eu chegar em casa, me lembre de X") — só guarda na fila;
        // quem dispara é a máquina de transições por Wi-Fi.
        var _lemb = _interpretarLembretePresenca(msgVoz);
        if (_lemb) {
          try {
            var _rl = criarLembretePresenca({ gatilho: _lemb.gatilho, texto: _lemb.texto });
            var _ondeTxt = { chegou_casa: 'chegar em casa', chegou_trabalho: 'chegar no trabalho',
                             saiu_casa: 'sair de casa', saiu_trabalho: 'sair do trabalho' }[_lemb.gatilho];
            respVoz = _rl.ok ? ('Combinado. Quando você ' + _ondeTxt + ', eu te lembro: ' + _lemb.texto + '.')
                             : 'Não consegui guardar esse lembrete.';
          } catch (eLb) { respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false }); }
        } else
        // (-1) LEMBRETE CONDICIONAL ("quando eu chegar em casa, me lembre de X") — o atalho MAIS
        // específico, então vem antes de tudo. Determinístico: cria a fila de verdade, sem depender
        // do LLM (que responderia "ok, vou lembrar" e não criaria nada — a armadilha do falso sucesso).
        var _lembC = _interpretarLembreteCondicional(msgVoz);
        // (0) ROTINA COMPOSTA ("modo cinema", "modo foco", "rotina boa noite") — comando explícito e
        // inequívoco; um comando → várias ações no aparelho.
        var _rot = _lembC ? null : _interpretarRotina(msgVoz);
        if (_lembC) {
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
            if (_bib.falar) {
              // BÍBLIA FALADA: o Jarvis LÊ o versículo em voz alta (respVoz é falada no celular) — vai
              // além de só abrir o app. Busca o texto (Almeida) na bible-api; fallback abre o YouVersion.
              var _bv = _lerVersiculoBiblia(_bib.code + '+' + _bib.cap + ':' + _bib.ver);
              if (_bv.ok) {
                respVoz = (_bv.ref || _bib.ref) + '. ' + _bv.texto;
              } else {
                Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'youversion://bible?reference=' + _bib.usfm });
                respVoz = 'Não achei o texto de ' + _bib.ref + ' para ler, então abri no YouVersion.';
              }
            } else {
              Jarvis.controlarDispositivo({ acao: 'abrirUrl', url: 'youversion://bible?reference=' + _bib.usfm });
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
          respVoz = Jarvis.ask(emailUser, instrucaoVoz, historico, null, { interativo: false });
        }
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
        if (modoFalaVc !== 'local' && modoFalaVc !== 'nao' && typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
          try {
            Jarvis.controlarDispositivo({ acao: 'falar', texto: textoLimpo });
          } catch (eCtrl) {
            Logger.log('Erro ao sintetizar áudio no Drive: ' + eCtrl.message);
          }
        }

        return ContentService.createTextOutput(textoLimpo).setMimeType(ContentService.MimeType.TEXT);
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
        var telemetria = Firestore.listDocs('telemetria_dispositivo', 10);
        var eventos = Firestore.listDocs('agente_eventos', 30);
        return ContentService.createTextOutput(JSON.stringify({ telemetria: telemetria, eventos: eventos })).setMimeType(ContentService.MimeType.JSON);
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
      if (tokVa === voiceTokenVa) { okVa = true; emailVa = pVa.getProperty('OWNER_EMAIL') || 'dono@exemplo.com'; }
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
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'dono@exemplo.com').trim().toLowerCase();
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

/** Cria um lembrete condicional. args {gatilho, texto, validadeDias?}. */
function criarLembreteCondicional(args) {
  args = args || {};
  var g = String(args.gatilho || '').trim();
  if (_GATILHOS_LEMBRETE.indexOf(g) === -1) return { ok: false, erro: 'Gatilho inválido.', validos: _GATILHOS_LEMBRETE };
  var texto = String(args.texto || '').trim();
  if (!texto) return { ok: false, erro: 'Informe o texto do lembrete.' };
  var arr = _lembLer();
  var item = { id: Utilities.getUuid().slice(0, 8), gatilho: g, texto: texto,
               validadeDias: Number(args.validadeDias || 7), criadoEm: Date.now(), ativo: true, disparadoEm: null };
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
    if (opts.simular) { entregues.push({ id: l.id, texto: l.texto, canal: noite ? 'notificacao' : 'voz', ok: 'simulado' }); return; }
    var res = null;
    if (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo) {
      res = noite
        ? Jarvis.controlarDispositivo({ acao: 'notificar', titulo: 'Lembrete do Jarvis', texto: l.texto })
        : Jarvis.controlarDispositivo({ acao: 'falar', texto: 'Lembrete, Bruno: ' + l.texto });
    }
    var ok = !!(res && res.status === 'success');
    if (ok) { l.ativo = false; l.disparadoEm = agora; mudou = true; }
    entregues.push({ id: l.id, texto: l.texto, canal: noite ? 'notificacao' : 'voz', ok: ok });
    try {
      if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
        Jarvis.registrarEvento({ tool: 'lembrete:' + gatilho, ms: 0, ok: ok, resumo: String(l.texto).substring(0, 120) });
      }
    } catch (eL) {}
  });
  if (mudou) _lembSalvar(arr);
  return { entregues: entregues, expirados: expirados };
}

/** Texto livre → lembrete condicional. Ex.: "quando eu chegar em casa, me lembre de pagar o boleto". */
function _interpretarLembreteCondicional(msg) {
  var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // preposições cobertas: no/na/nos/nas, o/a/os/as, em, do/da/de ("ao sair DE casa" faltava)
  var m = s.match(/^(?:quando|assim que|se|ao|logo que)\s+(?:eu\s+)?(chegar|sair|voltar|estiver)\s+(?:n?[oa]s?\s+|em\s+|d[eoa]\s+)?(casa|lar|trabalho|servico|firma|empresa)\b[\s,.:;-]*(.*)$/);
  if (!m) return null;
  var verbo = m[1], lugar = m[2], resto = m[3] || '';
  var local = /casa|lar/.test(lugar) ? 'casa' : 'trabalho';
  var gatilho = (verbo === 'sair') ? ('saiu_' + local) : ('chegou_' + local);
  // remove o "me lembre de / me avise de / lembra de..." da frente do conteúdo
  var texto = resto.replace(/^(?:me\s+)?(?:lembr\w+|avis\w+|recorde|fala\w*|diga?)\s*(?:-?me)?\s*(?:de\s+|para\s+|pra\s+|que\s+)?/, '').trim();
  texto = texto.replace(/[\s.,;:!?]+$/, '');
  if (!texto || texto.length < 2) return null;
  return { gatilho: gatilho, texto: texto };
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
  opts = opts || {};
  var p = PropertiesService.getScriptProperties();
  var critica = opts.prioridade === 'critica';
  var agora = new Date();

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
  var cargaTxt = String(_limparValorTelemetria(bruto.carregando || '')).toLowerCase();
  // O [power] do MacroDroid responde em PT: "Ligar" = conectado / "Desligar" = desconectado.
  var carregando = /deslig|discharg|false|\bnao\b/.test(cargaTxt) ? false
                 : (/lig|charg|true|\bsim\b|\bac\b|usb|plugged|full/.test(cargaTxt) ? true : null);
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
    _evsLemb.forEach(function (ev) {
      var rl = _dispararLembretesDe(ev, { simular: simular });
      if (rl.entregues.length) disparos.push({ evento: 'lembretes:' + ev, entregues: rl.entregues });
    });
    if (transicao.para === 'casa') {
      var naoLidos = null;
      try { naoLidos = GmailApp.getInboxUnreadCount(); } catch (eG) {}
      var txtCasa = 'Bem-vindo, Bruno.' + (naoLidos !== null
        ? (naoLidos > 0 ? ' Você tem ' + naoLidos + (naoLidos === 1 ? ' e-mail não lido.' : ' e-mails não lidos.') : ' Sua caixa de entrada está limpa.')
        : '');
      var rCasa = _falarProativo('chegou_casa', txtCasa, { cooldownMin: 180, simular: simular });
      disparos.push({ evento: 'chegou_casa', texto: txtCasa, resultado: rCasa });
    } else if (transicao.para === 'trabalho') {
      var txtTrab = 'Bom trabalho, Bruno.' + (minPonto !== null && minPonto <= 60
        ? ' Você bate o ponto em ' + minPonto + ' minutos.' : ' Lembre-se de bater o ponto.');
      var rTrab = _falarProativo('chegou_trabalho', txtTrab, { cooldownMin: 240, simular: simular });
      disparos.push({ evento: 'chegou_trabalho', texto: txtTrab, resultado: rTrab });
    } else if (transicao.de === 'casa') {
      // Saiu de casa: só vale avisar se o ponto está próximo (senão é interrupção sem valor).
      if (minPonto !== null && minPonto <= 90) {
        var txtSaiu = 'Você bate o ponto em ' + minPonto + ' minutos.' +
          (nivel !== null && nivel < 40 && carregando !== true ? ' Atenção: a bateria está em ' + nivel + ' por cento.' : '');
        var rSaiu = _falarProativo('saiu_casa', txtSaiu, { cooldownMin: 180, simular: simular });
        disparos.push({ evento: 'saiu_casa', texto: txtSaiu, resultado: rSaiu });
      } else {
        disparos.push({ evento: 'saiu_casa', ignorado: 'ponto distante (' + minPonto + ' min)' });
      }
    }
    // LEMBRETES CONDICIONAIS: uma transição pode valer por DOIS eventos (casa→trabalho = saiu_casa
    // E chegou_trabalho). As regras acima usam else-if (só uma fala); os lembretes checam ambos.
    var _evs = [];
    if (transicao.de === 'casa') _evs.push('saiu_casa');
    if (transicao.de === 'trabalho') _evs.push('saiu_trabalho');
    if (transicao.para === 'casa') _evs.push('chegou_casa');
    if (transicao.para === 'trabalho') _evs.push('chegou_trabalho');
    _evs.forEach(function (ev) {
      var rl = _dispararLembretes(ev, { simular: simular });
      if (rl) disparos.push({ evento: 'lembretes', gatilho: ev, resultado: rl });
    });
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
      var rBat = _falarProativo('bateria_baixa', txtBat,
        { cooldownMin: 60, prioridade: critica ? 'critica' : 'normal', simular: simular });
      if (rBat.falou === true) p.setProperty('PROATIVO_BAT_AVISADO', '1');
      disparos.push({ evento: 'bateria_baixa', nivel: nivel, limite: limite, critica: critica, resultado: rBat });
    }
  }

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

/* ===================== LEMBRETES CONDICIONAIS POR PRESENÇA =====================
 * "Quando eu chegar em casa, me lembre de pagar o boleto." A peça difícil (saber ONDE ele está) já
 * existe — isto aqui é só a FILA + o gancho na máquina de transições.
 * Gatilhos: chegou_casa | chegou_trabalho | saiu_casa | saiu_trabalho.
 * ⚠️ Estes NÃO passam pelo orçamento de interrupções: o dono PEDIU explicitamente. Ruído proativo é
 * o que precisa de teto; lembrete pedido é serviço. Vários do mesmo gatilho viram UMA fala só.
 */
var _LEMBRETES_KEY = 'LEMBRETES_PRESENCA';
function _lerLembretes() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(_LEMBRETES_KEY) || '[]'); }
  catch (e) { return []; }
}
function _salvarLembretes(arr) {
  PropertiesService.getScriptProperties().setProperty(_LEMBRETES_KEY, JSON.stringify(arr || []));
}

/** Cria um lembrete. args {gatilho, texto, validadeDias?=7, repetir?=false} */
function criarLembretePresenca(args) {
  args = args || {};
  var GAT = ['chegou_casa', 'chegou_trabalho', 'saiu_casa', 'saiu_trabalho'];
  var g = String(args.gatilho || '').trim();
  var texto = String(args.texto || '').trim();
  if (GAT.indexOf(g) === -1) return { ok: false, erro: 'gatilho inválido', validos: GAT };
  if (!texto) return { ok: false, erro: 'informe o texto do lembrete' };
  var dias = Number(args.validadeDias || 7);
  var item = { id: Utilities.getUuid().slice(0, 8), gatilho: g, texto: texto,
               criadoEm: Date.now(), validadeAte: Date.now() + dias * 86400000,
               repetir: args.repetir === true, ativo: true };
  var arr = _lerLembretes(); arr.push(item); _salvarLembretes(arr);
  return { ok: true, lembrete: item, total: arr.length };
}

/** Lista os lembretes ativos (limpa os vencidos de passagem). */
function listarLembretesPresenca() {
  var agora = Date.now(), arr = _lerLembretes();
  var vivos = arr.filter(function (l) { return l.ativo !== false && Number(l.validadeAte || 0) > agora; });
  if (vivos.length !== arr.length) _salvarLembretes(vivos);      // faxina automática dos vencidos
  return { ok: true, total: vivos.length, lembretes: vivos.map(function (l) {
    return { id: l.id, gatilho: l.gatilho, texto: l.texto, repetir: !!l.repetir,
             expiraEm: new Date(l.validadeAte).toISOString().slice(0, 10) }; }) };
}

function removerLembretePresenca(args) {
  var id = String((args && (args.id || args)) || '');
  var arr = _lerLembretes(), antes = arr.length;
  var novo = arr.filter(function (l) { return l.id !== id; });
  _salvarLembretes(novo);
  return { ok: antes !== novo.length, removido: id, restantes: novo.length };
}

/** Dispara os lembretes de um gatilho: junta tudo numa fala só e consome os de uma vez. */
function _dispararLembretes(gatilho, opts) {
  opts = opts || {};
  var agora = Date.now();
  var arr = _lerLembretes();
  var alvo = arr.filter(function (l) {
    return l.ativo !== false && l.gatilho === gatilho && Number(l.validadeAte || 0) > agora;
  });
  if (!alvo.length) return null;
  var txt = alvo.length === 1
    ? ('Bruno, você pediu para lembrar: ' + alvo[0].texto)
    : ('Bruno, você pediu para lembrar de ' + alvo.length + ' coisas: ' +
       alvo.map(function (l, i) { return (i + 1) + ') ' + l.texto; }).join('. ') + '.');
  if (opts.simular === true) return { gatilho: gatilho, quantos: alvo.length, texto: txt, falou: 'simulado' };
  var res = (typeof Jarvis !== 'undefined' && Jarvis.controlarDispositivo)
    ? Jarvis.controlarDispositivo({ acao: 'falar', texto: txt }) : null;
  var ok = !!(res && res.status === 'success');
  if (ok) {   // consome os de uma vez (os com repetir:true permanecem)
    var ids = {}; alvo.forEach(function (l) { if (!l.repetir) ids[l.id] = 1; });
    _salvarLembretes(arr.filter(function (l) { return !ids[l.id]; }));
  }
  try {
    if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) {
      Jarvis.registrarEvento({ tool: 'lembrete:' + gatilho, ms: 0, ok: ok, resumo: txt.substring(0, 120) });
    }
  } catch (eL) {}
  return { gatilho: gatilho, quantos: alvo.length, texto: txt, falou: ok };
}

/** Texto livre → {gatilho, texto}. Aceita as duas ordens ("quando... me lembre" e "me lembre... quando"). */
function _interpretarLembretePresenca(msg) {
  var s = String(msg || '').trim();
  var norm = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var mapa = function (verbo, lugar) {
    var chegou = /chegar|chego|voltar|volto/.test(verbo);
    var casa = /casa|lar/.test(lugar);
    return (chegou ? 'chegou_' : 'saiu_') + (casa ? 'casa' : 'trabalho');
  };
  // (a) "quando eu chegar em casa, me lembre de X"
  var m = norm.match(/^quando\s+(?:eu\s+)?(chegar|chego|sair|saio|voltar|volto)\s*(?:em|no|na|de|do|da|para|pra)?\s*(casa|lar|trabalho|servico|firma|escritorio)\s*[,.]?\s*(?:me\s+)?(?:lembr\w+|avis\w+)\s*(?:de|pra|para|que)?\s*(.+)$/);
  if (m) return { gatilho: mapa(m[1], m[2]), texto: s.slice(s.length - m[3].length).trim() };
  // (b) "me lembre de X quando eu chegar em casa"
  m = norm.match(/^(?:me\s+)?(?:lembr\w+|avis\w+)\s*(?:me\s+)?(?:de|pra|para|que)?\s*(.+?)\s+quando\s+(?:eu\s+)?(chegar|chego|sair|saio|voltar|volto)\s*(?:em|no|na|de|do|da)?\s*(casa|lar|trabalho|servico|firma|escritorio)\b/);
  if (m) {
    var ini = norm.indexOf(m[1]);
    return { gatilho: mapa(m[2], m[3]), texto: s.substr(ini, m[1].length).trim() };
  }
  return null;
}

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
function diagVoiceParse(args) {
  var msgVoz = String((args && (args.msg || args.message)) || '');
  var s = msgVoz.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var trigger = /b[íi]blia|vers[íi]culo/i.test(msgVoz) || /\b\d{1,3}\s*[:]\s*\d{1,3}\b/.test(msgVoz);
  var m = s.match(/(?:(1|2|3|primeiro|segundo|terceiro)\s+)?([a-z]{2,})\s+(?:capitulo\s+)?(\d{1,3})\s*(?::|,|\s+versiculo\s+|\s+)\s*(\d{1,3})/);
  var querFalar = /(biblia\s+falada|versiculo\s+falad|\b(?:leia|ler|recite|recita|declare|narre)\b|\bfal[ae]\b[^.]*\b(?:versiculo|biblia)\b)/.test(s);
  return { ok: true, msgVoz: msgVoz, s: s, trigger: trigger, parsed: m ? { book: m[2], cap: m[3], ver: m[4] } : null,
    querFalar: querFalar, sCodes: s.split('').map(function (ch) { return ch.charCodeAt(0); }).slice(0, 28) };
}

/** Info não-sensível do banco (p/ montar o link do console real). project_id aparece em toda URL da API. */
function diagFsInfo() {
  try { return { ok: true, projectId: _fsSa().project_id, database: FS_DATABASE }; }
  catch (e) { return { ok: false, erro: e.message }; }
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
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'dono@exemplo.com').trim().toLowerCase();
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
  var email = String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'dono@exemplo.com').trim().toLowerCase();
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
    diagFsInfo:             (typeof diagFsInfo !== 'undefined') ? diagFsInfo : null,
    diagVoiceParse:         (typeof diagVoiceParse !== 'undefined') ? diagVoiceParse : null,
    configurarEvolutionUrl: (typeof configurarEvolutionUrl !== 'undefined') ? configurarEvolutionUrl : null,
    diagEventoProativo:     (typeof diagEventoProativo !== 'undefined') ? diagEventoProativo : null,
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
    if (secret && (!e.parameter || e.parameter.wh !== secret)) return json({ ok: false, error: 'Webhook não autorizado.' });

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
