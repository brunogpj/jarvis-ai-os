// ===================================================================================
// Voz.js — Síntese de fala (Google Cloud Text-to-Speech) → OGG/Opus para PTT do WhatsApp.
//   IMPORTANTE: o Cloud TTS NÃO aceita API key — exige OAuth2 (um "principal").
//   Autentica via SERVICE ACCOUNT (mesma do FIRESTORE_SA, do projeto meus-projetos-gas
//   onde a API Cloud Text-to-Speech está habilitada), mintando um token com escopo
//   cloud-platform (JWT RS256). Encoding OGG_OPUS = pronto para nota de voz (PTT).
//   Modelo de voz pt-BR configurável (TTS_VOICE).
//
//   Limite da API: 5.000 caracteres por requisição (texto OU ssml). Para textos maiores,
//   use sintetizarLongo() — fatia por frase/linha, sintetiza cada bloco e junta os bytes.
//   A junção por bytes só é segura em MP3 (OGG_OPUS/LINEAR16 não podem ser concatenados crus).
// ===================================================================================

var Voz = (function () {
  'use strict';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }
  function _temSA() { return !!_p('TTS_SA') || !!_p('FIRESTORE_SA'); }
  function temChave() { return _temSA(); }

  function _b64url(str) {
    return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
  }
  // Token OAuth (escopo cloud-platform) a partir da service account. Reusa a SA do Firestore.
  function _saToken() {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('TTS_SA_TOKEN');
    if (cached) return cached;
    var raw = _p('TTS_SA') || _p('FIRESTORE_SA');
    if (!raw) throw new Error('Service account ausente (defina FIRESTORE_SA ou TTS_SA).');
    var sa = JSON.parse(raw);
    var now = Math.floor(Date.now() / 1000);
    var header = { alg: 'RS256', typ: 'JWT' };
    var claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600
    };
    var signingInput = _b64url(JSON.stringify(header)) + '.' + _b64url(JSON.stringify(claim));
    var sig = Utilities.computeRsaSha256Signature(signingInput, sa.private_key);
    var jwt = signingInput + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post', muteHttpExceptions: true,
      payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
    });
    var body = JSON.parse(res.getContentText() || '{}');
    if (!body.access_token) throw new Error('Falha ao autenticar a SA para TTS: ' + res.getContentText());
    cache.put('TTS_SA_TOKEN', body.access_token, 3300);
    return body.access_token;
  }

  // Limpa o texto para soar natural em áudio: remove URLs, markdown e emojis pesados.
  // NÃO trunca — o teto por requisição (5000) é aplicado em sintetizar(); textos maiores
  // são fatiados em sintetizarLongo(). (Antes havia um substring(0,3000) que limitava o áudio.)
  function _limpar(texto) {
    return String(texto || '')
      .replace(/https?:\/\/\S+/g, '')               // URLs
      .replace(/[*_`#>]+/g, '')                       // marcadores markdown
      .replace(/^\s*[-•]\s*/gm, '')                   // bullets
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // emojis
      .replace(/\n{2,}/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Formatos de saída suportados → {enc API, mime, ext}.
  var _FORMATOS = {
    ogg: { enc: 'OGG_OPUS', mime: 'audio/ogg', ext: 'ogg' },
    mp3: { enc: 'MP3', mime: 'audio/mpeg', ext: 'mp3' },
    wav: { enc: 'LINEAR16', mime: 'audio/wav', ext: 'wav' }
  };

  var _MAX_REQ = 5000;   // teto rígido da API por requisição (texto OU ssml)
  var _CHUNK   = 4500;   // tamanho de bloco no fatiamento (margem sob o teto)

  /**
   * Sintetiza UMA requisição (≤ 5000 chars). Para textos maiores use sintetizarLongo.
   * @param {string} texto  texto comum OU SSML (<speak>…</speak>)
   * @param {Object} [opts] { voz, idioma, formato:'ogg'|'mp3'|'wav', velocidade, tom, volume }
   * @return { status:'success', base64, mime, ext } | { status:'error', erro }
   */
  function sintetizar(texto, opts) {
    opts = opts || {};
    if (!_temSA()) return { status: 'error', erro: 'Service account ausente: o Cloud TTS exige OAuth (defina FIRESTORE_SA ou TTS_SA).' };
    var ehSSML = /<speak[\s>]/i.test(String(texto || ''));
    // _limpar não trunca; o teto da API (5000) é aplicado aqui como salvaguarda do single-shot.
    var conteudo = (ehSSML ? String(texto) : _limpar(texto)).substring(0, _MAX_REQ);
    if (!conteudo) return { status: 'error', erro: 'Texto vazio para sintetizar.' };
    var idioma = opts.idioma || _p('TTS_LANG') || 'pt-BR';
    var voz = opts.voz || _p('TTS_VOICE') || 'pt-BR-Neural2-B';
    var fmt = _FORMATOS[String(opts.formato || 'ogg').toLowerCase()] || _FORMATOS.ogg;
    var audioConfig = { audioEncoding: fmt.enc, speakingRate: Number(opts.velocidade) || 1.0 };
    if (opts.tom != null && opts.tom !== '') audioConfig.pitch = Math.max(-20, Math.min(20, Number(opts.tom)));
    if (opts.volume != null && opts.volume !== '') audioConfig.volumeGainDb = Math.max(-96, Math.min(16, Number(opts.volume)));
    var payload = {
      input: ehSSML ? { ssml: conteudo } : { text: conteudo },
      voice: { languageCode: idioma, name: voz },
      audioConfig: audioConfig
    };
    var token;
    try { token = _saToken(); } catch (e) { return { status: 'error', erro: e.message }; }
    var res = UrlFetchApp.fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      var msg = res.getContentText();
      try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      return { status: 'error', erro: 'TTS falhou (HTTP ' + code + '): ' + String(msg).substring(0, 200) };
    }
    var data = JSON.parse(res.getContentText() || '{}');
    if (!data.audioContent) return { status: 'error', erro: 'TTS não retornou áudio.' };
    return { status: 'success', base64: data.audioContent, mime: fmt.mime, ext: fmt.ext };
  }

  // Fatia o texto em blocos ≤ limite, preferindo cortar em fim de linha/frase (não corta palavra).
  function _fatiarTexto(texto, limite) {
    var partes = [], resto = String(texto || '');
    while (resto.length > 0) {
      if (resto.length <= limite) { partes.push(resto); break; }
      var sub = resto.substring(0, limite);
      var corte = sub.lastIndexOf('\n');
      if (corte < limite * 0.5) corte = Math.max(corte, sub.lastIndexOf('. '), sub.lastIndexOf('! '), sub.lastIndexOf('? '));
      if (corte < limite * 0.5) corte = sub.lastIndexOf(' ');
      if (corte <= 0) corte = limite - 1; // palavra gigante: corta no limite
      partes.push(resto.substring(0, corte + 1).trim());
      resto = resto.substring(corte + 1).trim();
    }
    return partes.filter(function (p) { return p.length > 0; });
  }

  /**
   * Sintetiza texto de QUALQUER tamanho. ≤ ~4500 chars → 1 requisição. Acima → fatia por
   * frase/linha, sintetiza cada bloco e junta os BYTES num único áudio.
   * A junção por bytes só é confiável em MP3 → o caminho longo FORÇA mp3 (e recusa SSML longo).
   * @return { status:'success', base64, mime, ext, partes } | { status:'error', erro }
   */
  function sintetizarLongo(texto, opts) {
    opts = opts || {};
    if (!texto) return { status: 'error', erro: 'Texto vazio para sintetizar.' };
    var ehSSML = /<speak[\s>]/i.test(String(texto));
    var limpo = ehSSML ? String(texto) : _limpar(texto);

    // Curto: uma requisição só (preserva o formato pedido, inclusive ogg p/ PTT do WhatsApp).
    if (limpo.length <= _CHUNK) return sintetizar(texto, opts);

    // Longo + SSML não dá: o fatiamento quebraria as tags <speak>.
    if (ehSSML) return { status: 'error', erro: 'Texto longo com SSML não é suportado (as tags <speak> quebram no fatiamento). Envie SSML em ≤ 5000 caracteres.' };

    // Longo: força MP3 (única junção por bytes confiável) e concatena os blocos.
    var optChunk = {}; for (var k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) optChunk[k] = opts[k]; }
    optChunk.formato = 'mp3';
    var blocos = _fatiarTexto(limpo, _CHUNK);
    var combinado = [];
    for (var i = 0; i < blocos.length; i++) {
      var r = sintetizar(blocos[i], optChunk);
      if (r.status !== 'success') return { status: 'error', erro: 'Falha na parte ' + (i + 1) + '/' + blocos.length + ': ' + r.erro };
      var bytes = Utilities.base64Decode(r.base64);            // Byte[]
      for (var b = 0; b < bytes.length; b++) combinado.push(bytes[b]);  // acumulação segura (≠ .concat em Byte[])
    }
    return { status: 'success', base64: Utilities.base64Encode(combinado), mime: _FORMATOS.mp3.mime, ext: _FORMATOS.mp3.ext, partes: blocos.length };
  }

  /** Lista as vozes disponíveis para um idioma (direto da API voices:list). @return [{name,genero,hz}]. */
  function listarVozes(idioma) {
    idioma = idioma || _p('TTS_LANG') || 'pt-BR';
    var token = _saToken();
    var res = UrlFetchApp.fetch('https://texttospeech.googleapis.com/v1/voices?languageCode=' + encodeURIComponent(idioma),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('voices:list HTTP ' + res.getResponseCode() + ': ' + String(res.getContentText()).substring(0, 160));
    var data = JSON.parse(res.getContentText() || '{}');
    return (data.voices || []).map(function (v) {
      return { name: v.name, genero: v.ssmlGender || '', hz: v.naturalSampleRateHertz || 0 };
    });
  }

  // Mapeia o mime/formato → encoding do Cloud Speech-to-Text. null = não suportado (cai no Gemini).
  function _encParaSpeech(mime) {
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('ogg') !== -1 || m.indexOf('opus') !== -1) return { encoding: 'OGG_OPUS', sampleRate: 48000 }; // WhatsApp PTT
    if (m.indexOf('wav') !== -1 || m.indexOf('x-wav') !== -1) return { encoding: 'LINEAR16', sampleRate: null };  // header tem o rate
    if (m.indexOf('flac') !== -1) return { encoding: 'FLAC', sampleRate: null };
    return null; // mp3/m4a/aac → não suportado nativamente aqui → Gemini
  }

  /**
   * Transcreve áudio via Cloud Speech-to-Text (cota PRÓPRIA, separada da do Gemini). Reusa a SA do TTS.
   * @param {string} base64  áudio em base64
   * @param {string} mime    ex.: 'audio/ogg'
   * @param {Object} [opts]  { idioma, phrases:[...] (biasing léxico nativo) }
   * @return { status:'success', texto } | { status:'unsupported' } | { status:'error', erro }
   */
  function transcrever(base64, mime, opts) {
    opts = opts || {};
    if (!_temSA()) return { status: 'error', erro: 'Service account ausente (FIRESTORE_SA/TTS_SA).' };
    var enc = _encParaSpeech(mime);
    if (!enc) return { status: 'unsupported', erro: 'Formato não suportado pelo Speech: ' + mime };
    var config = {
      languageCode: opts.idioma || _p('TTS_LANG') || 'pt-BR',
      encoding: enc.encoding,
      enableAutomaticPunctuation: true,
      model: 'latest_long'
    };
    if (enc.sampleRate) config.sampleRateHertz = enc.sampleRate;
    // Biasing léxico NATIVO (P-I): nomes de contatos/termos do projeto como speechContexts.
    if (opts.phrases && opts.phrases.length) config.speechContexts = [{ phrases: opts.phrases.slice(0, 200), boost: 15 }];
    var token;
    try { token = _saToken(); } catch (e) { return { status: 'error', erro: e.message }; }
    var res = UrlFetchApp.fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ config: config, audio: { content: base64 } }), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      var msg = res.getContentText();
      try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      return { status: 'error', erro: 'Speech HTTP ' + res.getResponseCode() + ': ' + String(msg).substring(0, 160) };
    }
    var data = JSON.parse(res.getContentText() || '{}');
    var txt = ((data.results || []).map(function (r) { return (((r.alternatives || [])[0] || {}).transcript) || ''; }).join(' ')).trim();
    return { status: 'success', texto: txt };
  }

  // ── GEMINI TTS (modelo gemini-…-flash-tts) — aceita INSTRUÇÃO DE ESTILO em linguagem natural
  // (ex.: "tom caloroso e acolhedor"), diferente do Cloud TTS Chirp3 (estilo fixo). Saída = PCM 24kHz
  // → embrulhamos em WAV. Usa a GEMINI key (free-first). É modelo PREVIEW (pode mudar). ──
  function _keyGemini() {
    // free-first: prioriza as chaves free (mesma lógica do modo 100% free do projeto).
    return _p('GEMINI_API_KEY_FALLBACK') || _p('GEMINI_API_KEY_FALLBACK2') || _p('GEMINI_API_KEY') || '';
  }
  // Embrulha PCM L16 mono (signed Byte[]) num WAV (header RIFF de 44 bytes). @return base64.
  function _pcmParaWav(pcm, rate) {
    rate = rate || 24000;
    var hdr = [], dataLen = pcm.length, byteRate = rate * 2;
    function s8(v) { v &= 255; return v > 127 ? v - 256 : v; }            // 0-255 → signed byte
    function w32(v) { hdr.push(s8(v), s8(v >> 8), s8(v >> 16), s8(v >> 24)); }
    function w16(v) { hdr.push(s8(v), s8(v >> 8)); }
    function ws(s) { for (var i = 0; i < s.length; i++) hdr.push(s8(s.charCodeAt(i))); }
    ws('RIFF'); w32(36 + dataLen); ws('WAVE'); ws('fmt '); w32(16); w16(1); w16(1); w32(rate); w32(byteRate); w16(2); w16(16); ws('data'); w32(dataLen);
    var total = hdr.concat(pcm);  // signed Byte[] completo
    return Utilities.base64Encode(total);
  }

  /**
   * Sintetiza com o GEMINI TTS, controlando o ESTILO por instrução natural.
   * @param {string} texto
   * @param {Object} [opts] { voz (ex.:'Enceladus'), estilo (ex.:'tom caloroso e acolhedor'), idioma, model }
   * @return { status:'success', base64(WAV), mime:'audio/wav', ext:'wav' } | { status:'error', erro }
   */
  function sintetizarGemini(texto, opts) {
    opts = opts || {};
    var key = _keyGemini();
    if (!key) return { status: 'error', erro: 'GEMINI_API_KEY(_FALLBACK) ausente para o Gemini TTS.' };
    var conteudo = _limpar(texto).substring(0, _MAX_REQ);
    if (!conteudo) return { status: 'error', erro: 'Texto vazio para sintetizar.' };
    var voz = opts.voz || _p('TTS_VOICE_GEMINI') || 'Enceladus';
    var estilo = (opts.estilo != null ? opts.estilo : _p('TTS_STYLE')) || '';
    var model = opts.model || _p('TTS_GEMINI_MODEL') || 'gemini-2.5-flash-preview-tts';
    var prompt = estilo ? ('Leia em voz alta em ' + estilo + ': ' + conteudo) : conteudo;
    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } }
    };
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code !== 200) {
      var msg = res.getContentText(); try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      return { status: 'error', erro: 'Gemini TTS HTTP ' + code + ': ' + String(msg).substring(0, 220), model: model };
    }
    var data = JSON.parse(res.getContentText() || '{}');
    var part = (((((data.candidates || [])[0] || {}).content || {}).parts || [])[0]) || {};
    var inline = part.inlineData || part.inline_data;
    if (!inline || !inline.data) return { status: 'error', erro: 'Gemini TTS não retornou áudio (resposta sem inlineData).' };
    // rate do mimeType (ex.: "audio/L16;codec=pcm;rate=24000")
    var rate = 24000; var mm = String(inline.mimeType || inline.mime_type || '').match(/rate=(\d+)/); if (mm) rate = Number(mm[1]);
    var pcm = Utilities.base64Decode(inline.data);
    return { status: 'success', base64: _pcmParaWav(pcm, rate), mime: 'audio/wav', ext: 'wav', voz: voz, estilo: estilo, model: model };
  }

  return { sintetizar: sintetizar, sintetizarLongo: sintetizarLongo, sintetizarGemini: sintetizarGemini, temChave: temChave, listarVozes: listarVozes, transcrever: transcrever };
})();

/** Setup/diagnóstico: configura a voz (opcional) e confirma a SA. Rode no editor.
 *  Auth via service account (reusa FIRESTORE_SA). Para usar uma SA dedicada, passe o JSON em saJson. */
function configurarVoz(voz, idioma, saJson) {
  var p = PropertiesService.getScriptProperties();
  if (voz) p.setProperty('TTS_VOICE', voz);
  if (idioma) p.setProperty('TTS_LANG', idioma);
  if (saJson) p.setProperty('TTS_SA', saJson);
  Logger.log('✅ Voz configurada. Service account presente? ' + (Voz.temChave() ? 'sim' : 'NÃO — defina FIRESTORE_SA/TTS_SA'));
}
function testarVoz() {
  var r = Voz.sintetizar('Olá, aqui é o Jarvis falando. Teste de síntese de voz em português.');
  Logger.log(r.status === 'success' ? ('✅ OK — ' + r.base64.length + ' bytes base64.') : ('❌ ' + r.erro));
  return r.status;
}
/** Diagnóstico do caminho LONGO: sintetiza um texto > 4500 chars e confirma o fatiamento + junção MP3. */
function testarVozLonga() {
  var bloco = 'Esta é uma frase de teste para verificar a síntese de textos longos no Jarvis. ';
  var grande = '';
  while (grande.length < 9000) grande += bloco;
  var r = Voz.sintetizarLongo(grande, { formato: 'mp3' });
  Logger.log(r.status === 'success'
    ? ('✅ OK — ' + r.partes + ' partes, ' + r.base64.length + ' chars base64, mime ' + r.mime)
    : ('❌ ' + r.erro));
  return r.status;
}

/** Diagnóstico: transcreve um áudio do Drive via Cloud Speech-to-Text. Passe o fileId de um .ogg/.wav/.flac.
 *  Ex.: testarTranscricao('1AbC...'). Mostra o texto e prova que o offload do Gemini funciona. */
function testarTranscricao(fileId) {
  if (!fileId) { Logger.log('Passe o fileId de um áudio (.ogg/.wav/.flac) do seu Drive.'); return; }
  var blob = DriveApp.getFileById(fileId).getBlob();
  var r = Voz.transcrever(Utilities.base64Encode(blob.getBytes()), blob.getContentType() || 'audio/ogg', { phrases: ['Jarvis', 'Bruno'] });
  Logger.log(r.status === 'success' ? ('✅ Speech OK: ' + r.texto) : ('❌ (' + r.status + ') ' + r.erro));
  return r;
}

/** Atalho: voz natural padrão (Neural2-B, masculina). Bom custo/qualidade. */
function usarVozPadrao() {
  PropertiesService.getScriptProperties().setProperty('TTS_VOICE', 'pt-BR-Neural2-B');
  Logger.log('✅ TTS_VOICE = pt-BR-Neural2-B (Neural2, natural).');
  return testarVoz();
}
/** Atalho: voz de NARRADOR (Studio-B, masculina) — entonação solene, ideal p/ leitura.
 *  Obs.: vozes Studio têm free tier menor (~100k chars/mês) e custo maior que Neural2. */
function usarVozNarrador() {
  PropertiesService.getScriptProperties().setProperty('TTS_VOICE', 'pt-BR-Studio-B');
  Logger.log('✅ TTS_VOICE = pt-BR-Studio-B (Studio, narração). Free tier menor que Neural2.');
  return testarVoz();
}
/** Diag do GEMINI TTS (estilo por instrução). args:{texto?, estilo?, voz?}. Diz se cabe no free tier. */
function testarVozGemini(args) {
  args = args || {};
  var r = Voz.sintetizarGemini(args.texto || 'Olá! Aqui é o Jarvis, seu assistente pessoal. Que bom falar com você.',
    { estilo: args.estilo || 'tom caloroso e acolhedor', voz: args.voz || 'Enceladus' });
  if (r.status === 'success') { Logger.log('✅ Gemini TTS OK — ' + r.base64.length + ' chars base64 (WAV) · voz=' + r.voz + ' · modelo=' + r.model); return { ok: true, bytes: r.base64.length, voz: r.voz, estilo: r.estilo, model: r.model, mime: r.mime }; }
  Logger.log('❌ ' + r.erro); return { ok: false, erro: r.erro, model: r.model };
}

/** Lista as vozes pt-BR disponíveis no Cloud TTS (nome + gênero + tipo). Rode no editor. */
function listarVozesTTS() {
  try {
    var vozes = Voz.listarVozes();
    vozes.forEach(function (v) { Logger.log(v.name + ' · ' + v.genero + ' · ' + v.hz + 'Hz'); });
    Logger.log('Total: ' + vozes.length + ' vozes. Defina com configurarVoz("pt-BR-...") — ou use o comando /voz no chat para ouvir e escolher.');
    return vozes;
  } catch (e) { Logger.log('❌ ' + e.message); }
}
