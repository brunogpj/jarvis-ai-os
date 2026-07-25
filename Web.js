// ===================================================================================
// Web.js — Leitura e MONITORAMENTO de páginas web (UrlFetchApp). NÃO usa IA/Gemini.
//   • lerPagina(url): baixa a página e extrai o TEXTO legível (ou JSON cru de APIs).
//   • Monitor de mudanças: guarda um hash do conteúdo e avisa no WhatsApp quando muda
//     (disparado pelo tick a cada ~15 min). Estado no Firestore ('web_monitores').
//   LIMITES (GAS não tem navegador): só HTTP estático — sem clicar/rolar/login/JS.
//   Guarda de segurança: só http(s) público (bloqueia localhost/IPs privados — anti-SSRF).
// ===================================================================================

var Web = (function () {
  'use strict';
  var COL = 'web_monitores';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  // Bloqueia esquemas não-HTTP e hosts internos/privados (anti-SSRF).
  function _urlSegura(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    var host = url.replace(/^https?:\/\//i, '').split(/[\/:?#]/)[0].toLowerCase();
    if (!host || host === 'localhost' || /\.local$/.test(host)) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '::1' || host === '[::1]') return false;
    return true;
  }

  // HTML → texto legível (remove script/style, vira quebras em blocos, decodifica entidades).
  function _htmlParaTexto(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article|header|footer)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t]+$/gm, '')   // linhas só com espaço → vazias
      .replace(/\n{2,}/g, '\n')    // colapsa linhas em branco repetidas
      .trim();
  }

  function _buscar(url) {
    return UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JarvisBot/1.0)' }
    });
  }

  /** Lê uma página web e extrai o texto (ou JSON). @return {status, tipo, titulo, texto/conteudo}. */
  function lerPagina(url) {
    if (!_urlSegura(url)) return { status: 'error', erro: 'URL inválida ou não permitida (use http/https público).' };
    var res;
    try { res = _buscar(url); } catch (e) { return { status: 'error', erro: 'Falha ao acessar: ' + e.message }; }
    var code = res.getResponseCode();
    if (code >= 400) return { status: 'error', erro: 'HTTP ' + code + ' ao acessar a página.' };
    var ct = String((res.getHeaders() || {})['Content-Type'] || (res.getHeaders() || {})['content-type'] || '');
    var body = res.getContentText();
    if (/json/i.test(ct)) return { status: 'success', tipo: 'json', url: url, conteudo: String(body).substring(0, 8000) };
    var titulo = ((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    return { status: 'success', tipo: 'html', url: url, titulo: titulo, texto: _htmlParaTexto(body).substring(0, 8000) };
  }

  function _hashConteudo(url) {
    var r = lerPagina(url);
    if (r.status !== 'success') return { erro: r.erro };
    var txt = r.texto || r.conteudo || '';
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, txt);
    var hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    return { hash: hex, titulo: r.titulo || url, amostra: txt.substring(0, 200) };
  }

  /** Passa a monitorar uma página: avisa no WhatsApp quando o conteúdo mudar. */
  function monitorar(url, descricao) {
    if (!_urlSegura(url)) return { status: 'error', erro: 'URL inválida ou não permitida.' };
    var h = _hashConteudo(url);
    if (h.erro) return { status: 'error', erro: h.erro };
    var id = Utilities.getUuid().substring(0, 8);
    Firestore.setDoc(COL, id, { url: url, descricao: String(descricao || h.titulo || url), hash: h.hash, ativo: true, criadoEm: Date.now(), ultimoCheck: Date.now() });
    return { status: 'success', id: id, monitorando: url, nota: 'Vou te avisar no WhatsApp quando esta página mudar (checo a cada ~15 min).' };
  }

  function listar() {
    return Firestore.listDocs(COL, 50)
      .filter(function (m) { return m.dados.ativo !== false; })
      .map(function (m) { return { id: m.id, url: m.dados.url, descricao: m.dados.descricao }; });
  }

  function parar(idOuDesc) {
    var alvo = String(idOuDesc || '').toLowerCase().trim(), rem = 0;
    Firestore.listDocs(COL, 50).forEach(function (m) {
      if (m.id === idOuDesc || String(m.dados.url || '').toLowerCase().indexOf(alvo) !== -1 || String(m.dados.descricao || '').toLowerCase().indexOf(alvo) !== -1) {
        try { Firestore.deleteDoc(COL, m.id); rem++; } catch (e) {}
      }
    });
    return { status: 'success', removidos: rem };
  }

  /** Tick (~15 min): verifica todos os monitores e avisa mudanças no WhatsApp do dono. */
  function verificarMudancas() {
    var num = _p('WHATSAPP_OWNER_NUMBER'), avisos = 0;
    Firestore.listDocs(COL, 50).forEach(function (m) {
      var d = m.dados || {};
      if (d.ativo === false) return;
      var h = _hashConteudo(d.url);
      if (h.erro) return; // ignora falha temporária de acesso
      if (d.hash && h.hash !== d.hash) {
        try { if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '🌐 *Página monitorada mudou*\n' + (d.descricao || d.url) + '\n' + d.url); } catch (e) {}
        try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[web] mudança detectada: ' + d.url); } catch (e) {}
        avisos++;
      }
      try { Firestore.updateDoc(COL, m.id, { hash: h.hash, ultimoCheck: Date.now() }); } catch (e) {}
    });
    return avisos;
  }

  return { lerPagina: lerPagina, monitorar: monitorar, listar: listar, parar: parar, verificarMudancas: verificarMudancas };
})();

/** Diagnóstico: lê uma página no editor. Ex.: testarLerPagina('https://example.com'). */
function testarLerPagina(url) {
  var r = Web.lerPagina(url || 'https://example.com');
  Logger.log(JSON.stringify(r).substring(0, 800));
  return r;
}

/**
 * Valida os RECURSOS NOVOS que NÃO dependem do Gemini, direto pelo editor (sem passar pelo chat).
 * Envia para o SEU PRÓPRIO número/e-mail (seguro). Rode no editor com a quota do Gemini travada.
 */
function testarRecursosSemQuota() {
  var sp = PropertiesService.getScriptProperties();
  var num = sp.getProperty('WHATSAPP_OWNER_NUMBER');
  var email = sp.getProperty('OWNER_EMAIL');
  var log = [];

  // 1) gerarAudio (TTS → arquivo MP3 no Drive)
  try {
    var a = Voz.sintetizar('Teste de áudio do Jarvis em MP3.', { formato: 'mp3' });
    if (a.status === 'success') {
      var f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, 'teste-jarvis.mp3'));
      log.push('✅ gerarAudio (mp3): ' + f.getUrl());
    } else log.push('❌ gerarAudio: ' + a.erro);
  } catch (e) { log.push('❌ gerarAudio: ' + e.message); }

  // 2) Gmail — cria um RASCUNHO (não envia)
  try { var d = GmailApp.createDraft(email, '[Teste Jarvis] rascunho', 'Rascunho de teste gerado pelo diagnóstico.'); log.push('✅ Gmail rascunho criado (id ' + d.getId() + ')'); }
  catch (e) { log.push('❌ Gmail rascunho: ' + e.message); }

  // 3) WhatsApp — agenda uma mensagem p/ você mesmo (chega no próximo tick de 15 min)
  try { var r = WhatsApp.agendarEnvio(num, '⏰ Teste de mensagem AGENDADA do Jarvis.', Date.now() + 120000); log.push('✅ WhatsApp agendado (id ' + r.id + ') — chega no próximo tick. Agendadas: ' + JSON.stringify(WhatsApp.listarAgendadas())); }
  catch (e) { log.push('❌ agendar WhatsApp: ' + e.message); }

  // 4) WhatsApp — envia uma LOCALIZAÇÃO p/ você mesmo
  try { var l = WhatsApp.enviarLocalizacao(num, -19.9167, -43.9345, 'Praça da Liberdade', 'Belo Horizonte'); log.push((l.status === 'success' ? '✅' : '❌') + ' WhatsApp localização: ' + JSON.stringify(l)); }
  catch (e) { log.push('❌ localização: ' + e.message); }

  // 5) Web — monitora uma página
  try { var w = Web.monitorar('https://example.com', 'teste de monitor'); log.push((w.status === 'success' ? '✅' : '❌') + ' Web monitor: ' + JSON.stringify(w)); }
  catch (e) { log.push('❌ monitor web: ' + e.message); }

  Logger.log('— Recursos sem quota —\n' + log.join('\n'));
  return log;
}
