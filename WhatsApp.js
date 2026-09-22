// ===================================================================================
// WhatsApp.js — Conector Evolution API (Jarvis como orquestrador multi-plataforma)
// Saída (enviar, gerenciar instâncias) + parser de webhook de entrada.
// Credenciais em Script Properties: EVOLUTION_URL, EVOLUTION_APIKEY, EVOLUTION_INSTANCE.
// ===================================================================================

var WhatsApp = (function () {
  'use strict';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }
  // Compatível com a nomenclatura do projeto Antigravity (EVOLUTION_API_URL/KEY/INSTANCE_NAME) e a nossa.
  function _cfg() {
    return {
      url: String(_p('EVOLUTION_API_URL') || _p('EVOLUTION_URL') || '').replace(/\/+$/, ''),
      key: _p('EVOLUTION_API_KEY') || _p('EVOLUTION_APIKEY') || '',
      instance: _p('EVOLUTION_INSTANCE_NAME') || _p('EVOLUTION_INSTANCE') || ''
    };
  }
  // Instâncias do painel: EVOLUTION_INSTANCES (CSV) ou, por padrão, APENAS a principal (WhatsApp pessoal).
  function instanciasConfig() {
    var raw = _p('EVOLUTION_INSTANCES');
    if (raw && raw.trim()) return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return [_cfg().instance || 'agente_final'];
  }
  // URL do painel (manager) da Evolution.
  function dashboardUrl() { var c = _cfg(); return c.url ? (c.url + '/manager') : ''; }
  // Aponta o webhook da instância para ESTE web app (/exec?wh=SECRET) — Jarvis recebe as mensagens.
  function _setWebhook(instanceName) {
    try {
      var c = _cfg();
      var base = String(ScriptApp.getService().getUrl() || '').replace(/\/dev$/, '/exec');
      if (!base) return;
      var secret = _p('WHATSAPP_WEBHOOK_SECRET') || '';
      var url = base + (secret ? ('?wh=' + secret) : '');
      UrlFetchApp.fetch(c.url + '/webhook/set/' + encodeURIComponent(instanceName), {
        method: 'post', contentType: 'application/json', headers: { apikey: c.key }, muteHttpExceptions: true,
        payload: JSON.stringify({ webhook: { url: url, enabled: true, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] } })
      });
    } catch (e) {}
  }

  // ── EVOLUTION GO (v3): mesma API, DIALETO diferente ──────────────────────────────────────────
  // No clássico a instância vai no PATH (/message/sendText/<inst>); no GO o path é "flat" e a
  // instância vai no BODY (/message/sendText + {instance}). Exceção de forma: o status deixa de ser
  // /instance/connectionState/<inst> e passa a ser /instance/<inst>/status.
  // Mapeamento confirmado no projeto irmão (SGT, já adaptado ao GO). Fica INATIVO por padrão —
  // só liga com EVOLUTION_API_VERSION=go|v3, então o comportamento clássico não muda em nada.
  // ⚠️ Endpoints sem ground truth no GO (instance/connect, webhook/*, chat/find*) seguem a regra
  // GENÉRICA acima — validar um a um contra o servidor real no primeiro deploy.
  function _isGo() {
    var v = String(_p('EVOLUTION_API_VERSION') || '').toLowerCase();
    return v === 'go' || v === 'v3';
  }
  function _traduzirGo(method, path, body) {
    var segs = String(path || '').split('/').filter(Boolean);
    if (segs.length < 3) return { path: path, body: body };   // /instance/create, /instance/fetchInstances
    var inst = decodeURIComponent(segs[segs.length - 1]);
    var grupo = segs[0], acao = segs[1];
    if (grupo === 'instance' && acao === 'connectionState') { // única exceção de FORMA conhecida
      return { path: '/instance/' + encodeURIComponent(inst) + '/status', body: body };
    }
    var novoPath = '/' + grupo + '/' + acao;
    if (String(method).toLowerCase() === 'get' && !body) {     // GET não tem body → vai por query
      return { path: novoPath + '?instance=' + encodeURIComponent(inst), body: body };
    }
    var novoBody = body ? JSON.parse(JSON.stringify(body)) : {};
    novoBody.instance = inst;
    return { path: novoPath, body: novoBody };
  }

  function _req(method, path, body) {
    var c = _cfg();
    if (!c.url || !c.key) return { code: 0, erro: 'Evolution não configurada (EVOLUTION_URL/EVOLUTION_APIKEY).' };
    if (_isGo()) {
      var _t = _traduzirGo(method, path, body);
      path = _t.path; body = _t.body;
    }
    var opt = { method: method, muteHttpExceptions: true, headers: { apikey: c.key }, contentType: 'application/json' };
    if (body) opt.payload = JSON.stringify(body);
    var res;
    try { res = UrlFetchApp.fetch(c.url + path, opt); }
    catch (e) { return { code: 0, erro: 'Falha de rede ao falar com a Evolution (' + String(e && e.message || e).substring(0, 120) + ')' }; }
    var txt = res.getContentText();
    var json; try { json = JSON.parse(txt); } catch (e) { json = txt; }
    return { code: res.getResponseCode(), json: json, text: txt };
  }

  function _so(num) { return String(num || '').replace(/\D/g, ''); }

  // ── ANTI-BAN: throttle (anti-flood) + cadência humana entre envios. ──
  // Detectores de bot flagram rajadas e timing robótico (ver wiki: RABot, AAAI-26). Aqui
  // limitamos volume/minuto e /hora, e garantimos um intervalo mínimo (variável) entre mensagens.
  // Best-effort via CacheService; nunca derruba um envio por erro interno do throttle.
  function _throttle() {
    try {
      var limMin = Number(_p('WA_LIM_MIN')) || 10;     // máx. envios por minuto (rajada)
      var limHora = Number(_p('WA_LIM_HORA')) || 120;  // máx. por hora (proteção contra loop)
      var gapMs = Number(_p('WA_GAP_MS')) || 800;      // intervalo mínimo humano entre envios
      var cache = CacheService.getScriptCache();
      var now = Date.now();
      var arr = [];
      try { arr = JSON.parse(cache.get('WA_SENDS') || '[]'); } catch (e) { arr = []; }
      arr = arr.filter(function (t) { return now - t < 3600000; }); // janela 1h
      var naHora = arr.length;
      var noMin = arr.filter(function (t) { return now - t < 60000; }).length;
      var ult = arr.length ? arr[arr.length - 1] : 0;
      if (naHora >= limHora) {
        return { ok: false, erro: 'Limite de segurança atingido (' + limHora + ' envios/h) — segurei para não parecer spam (anti-ban). Tente mais tarde.' };
      }
      var espera = 0;
      if (ult && (now - ult) < gapMs) espera = gapMs - (now - ult);
      if (noMin >= limMin) espera = Math.max(espera, 2500 + Math.floor(Math.random() * 2000)); // rajada → desacelera
      if (espera > 0) { try { Utilities.sleep(Math.min(espera + Math.floor(Math.random() * 400), 5000)); } catch (e) {} }
      arr.push(Date.now());
      cache.put('WA_SENDS', JSON.stringify(arr.slice(-250)), 3600);
      return { ok: true };
    } catch (e) { return { ok: true }; }
  }

  // Anti-loop: ids de mensagens que NÓS enviamos (o webhook ignora o "eco" delas no self-chat).
  function _marcarEnviado(id) {
    try {
      var c = CacheService.getScriptCache();
      var arr = []; try { arr = JSON.parse(c.get('WA_SENT_IDS') || '[]'); } catch (e) {}
      arr.push(String(id));
      c.put('WA_SENT_IDS', JSON.stringify(arr.slice(-40)), 3600);
    } catch (e) {}
  }
  function foiEnviadoPorMim(id) {
    if (!id) return false;
    try { return JSON.parse(CacheService.getScriptCache().get('WA_SENT_IDS') || '[]').indexOf(String(id)) !== -1; } catch (e) { return false; }
  }

  // Normaliza para comparação de nomes: minúsculas, sem acentos/emojis/pontuação.
  function _norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')     // remove acentos
      .replace(/[^\w\s]/g, ' ')                              // remove emojis/pontuação
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Resolve um "contato" (NOME do contato/grupo OU número) para o remoteJid correto.
  // Se for número: monta jid padrão. Se for nome: busca nas conversas (findChats) e faz match.
  function _resolverJid(contato, instanceName) {
    var t = String(contato || '').trim();
    if (!t) return { erro: 'Contato não informado.' };
    var sp = PropertiesService.getScriptProperties();
    var ownerNum = String(sp.getProperty('WHATSAPP_OWNER_NUMBER') || '').replace(/\D/g, '');
    var ownerEmail = _norm(sp.getProperty('OWNER_EMAIL') || '');
    var n = _norm(t);
    // 1) AUTO-REFERÊNCIA ("eu/mim/meu WhatsApp/para mim") OU o e-mail do dono → número do DONO.
    var selfTokens = ['eu', 'mim', 'me', 'eu mesmo', 'dono', 'meu whatsapp', 'meu zap',
      'meu numero', 'meu celular', 'meu contato', 'para mim', 'pra mim', 'pro dono', 'para o dono'];
    var ehSelf = selfTokens.indexOf(n) !== -1
      || /\b(meu|minha)\b[\s\S]*\b(whats|zap|numero|celular|contato)\b/.test(n)
      || (ownerEmail && n === ownerEmail);
    if (ehSelf) {
      if (ownerNum) return { jid: ownerNum + '@s.whatsapp.net', numero: ownerNum, nome: 'você' };
      return { erro: 'Não sei o seu número — configure WHATSAPP_OWNER_NUMBER.' };
    }
    // 2) jid já formatado do WhatsApp.
    if (/@(s\.whatsapp\.net|g\.us|lid|c\.us)$/i.test(t)) return { jid: t, numero: _so(t), nome: '' };
    // 3) e-mail NÃO é destino de WhatsApp (evita usar o e-mail como contato).
    if (t.indexOf('@') >= 0) return { erro: 'Isso parece um e-mail, não um contato de WhatsApp. Use o nome do contato ou o número (DDI+DDD). Para você mesmo, diga "eu".' };
    var digits = t.replace(/\D/g, '');
    var soDigitos = t.replace(/[\s\-\+\(\)]/g, '');
    if (digits.length >= 8 && digits === soDigitos) {                               // é um número puro
      return { jid: digits + '@s.whatsapp.net', numero: digits, nome: '' };
    }
    // Nome + número juntos (ex.: "Luciana 5511999999999", "manda pro +55 31 99999-9999") → extrai o número.
    var emb = t.match(/(\+?\d[\d .\-()]{8,16}\d)/);
    if (emb) {
      var nEmb = emb[1].replace(/\D/g, '');
      if (nEmb.length >= 10 && nEmb.length <= 15) return { jid: nEmb + '@s.whatsapp.net', numero: nEmb, nome: '' };
    }
    // É um nome → procurar na lista de conversas
    var fc = findChats(instanceName);
    if (fc.status !== 'success') return { erro: 'Não consegui listar as conversas para localizar "' + t + '".' };
    var alvo = _norm(t);
    var melhor = null;
    for (var i = 0; i < fc.conversas.length; i++) {
      var nm = _norm(fc.conversas[i].nome);
      if (!nm) continue;
      if (nm === alvo) { melhor = fc.conversas[i]; break; }                          // match exato vence
      if (!melhor && (nm.indexOf(alvo) >= 0 || alvo.indexOf(nm) >= 0)) melhor = fc.conversas[i];
    }
    if (!melhor) {
      // Fallback: procurar nos CONTATOS do Google (People API) — útil quando a conversa
      // do WhatsApp está "sem nome" mas o contato existe na agenda do dono.
      try {
        if (typeof Contatos !== 'undefined') {
          var telC = Contatos.telefoneDe(t);
          if (telC) { var dC = String(telC).replace(/\D/g, ''); if (dC.length >= 8) return { jid: dC + '@s.whatsapp.net', numero: dC, nome: t }; }
        }
      } catch (eC) {}
      return { erro: 'Não encontrei "' + t + '" nas conversas do WhatsApp nem nos seus Contatos. Veja os nomes com listarConversasWhatsApp ou informe o número (DDI+DDD).' };
    }
    return { jid: melhor.jid, numero: melhor.numero, nome: melhor.nome };
  }

  // ── Saída ──
  // contato = NOME do contato/grupo OU número (DDI+DDD). Resolve o jid automaticamente.
  function enviar(contato, texto, instanceName) {
    var c = _cfg();
    var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'EVOLUTION_INSTANCE não configurada.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var _t = _throttle(); if (!_t.ok) return { status: 'error', erro: _t.erro };
    // Contato comum → envia pelo número; grupo/LID → envia pelo jid completo.
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var r = _req('post', '/message/sendText/' + encodeURIComponent(nome), { number: alvo, text: String(texto || '') });
    if (r.erro) return { status: 'error', erro: _hintDesconectado(r.erro, nome) };
    if (r.code >= 200 && r.code < 300) return { status: 'success', para: rj.nome || alvo };
    return { status: 'error', erro: _hintDesconectado('sendText HTTP ' + r.code + ': ' + String(r.text).substring(0, 160), nome) };
  }

  function listarInstancias() {
    var r = _req('get', '/instance/fetchInstances');
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) {
      var arr = Array.isArray(r.json) ? r.json : ((r.json && r.json.instances) || []);
      // Só as instâncias configuradas neste app (evita expor instâncias fantasma de outros projetos).
      var permitidas = instanciasConfig().map(function (s) { return String(s).toLowerCase(); });
      var lista = arr.map(function (i) {
        var inst = i.instance || i;
        var oj = inst.ownerJid || inst.owner || i.ownerJid || '';
        return {
          nome: inst.instanceName || inst.name || inst.instance || i.name || '',
          estado: inst.state || inst.status || inst.connectionStatus || i.connectionStatus || '',
          numero: oj ? String(oj).split('@')[0] : '',
          perfil: inst.profileName || i.profileName || ''
        };
      }).filter(function (x) { return permitidas.indexOf(String(x.nome).toLowerCase()) !== -1; });
      return { status: 'success', instancias: lista };
    }
    return { status: 'error', erro: 'fetchInstances HTTP ' + r.code };
  }

  function statusInstancia() {
    var c = _cfg();
    if (!c.instance) return { status: 'error', erro: 'EVOLUTION_INSTANCE não configurada.' };
    var r = _req('get', '/instance/connectionState/' + encodeURIComponent(c.instance));
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) {
      var estado = (r.json && (r.json.state || (r.json.instance && r.json.instance.state))) || r.json;
      return { status: 'success', instancia: c.instance, estado: estado };
    }
    return { status: 'error', erro: 'connectionState HTTP ' + r.code };
  }

  function conectar() {
    var c = _cfg();
    var r = _req('get', '/instance/connect/' + encodeURIComponent(c.instance));
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', info: r.json };
    return { status: 'error', erro: 'connect HTTP ' + r.code };
  }

  // ── Entrada: normaliza o payload do webhook da Evolution ──
  function parseWebhook(body) {
    body = body || {};
    var ev = body.event || body.Event || '';
    var data = body.data || body.Data || {};
    var key = data.key || {};
    var jid = key.remoteJid || '';
    var msg = data.message || {};
    var texto = msg.conversation
      || (msg.extendedTextMessage && msg.extendedTextMessage.text)
      || (msg.imageMessage && msg.imageMessage.caption)
      || (msg.videoMessage && msg.videoMessage.caption)
      || '';
    // Detecta mídia (para baixar o binário e transcrever/descrever depois).
    var tipoMidia = '', mimeMidia = '';
    if (msg.audioMessage)         { tipoMidia = 'audio';     mimeMidia = msg.audioMessage.mimetype || 'audio/ogg'; }
    else if (msg.imageMessage)    { tipoMidia = 'imagem';    mimeMidia = msg.imageMessage.mimetype || 'image/jpeg'; }
    else if (msg.documentMessage) { tipoMidia = 'documento'; mimeMidia = msg.documentMessage.mimetype || 'application/octet-stream'; }
    else if (msg.videoMessage)    { tipoMidia = 'video';     mimeMidia = msg.videoMessage.mimetype || 'video/mp4'; }
    return {
      evento: String(ev).toLowerCase(),
      instancia: body.instance || '',
      numero: String(jid).split('@')[0],
      jid: jid,
      fromMe: !!key.fromMe,
      texto: String(texto || ''),
      pushName: data.pushName || '',
      tipoMidia: tipoMidia,
      mimeMidia: mimeMidia,
      key: key,
      mensagemRaw: msg
    };
  }

  // ── Baixa a mídia de uma mensagem recebida (áudio/imagem/doc) como base64 ──
  // Usa o endpoint da Evolution getBase64FromMediaMessage. O formato do body pode
  // variar por versão; tentamos { message: { key, message } } e caímos para { message: key }.
  function baixarMidiaBase64(mensagemRaw, key, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'Instância não configurada.' };
    var tentativas = [
      { message: { key: key, message: mensagemRaw } },
      { message: { key: key } }
    ];
    for (var i = 0; i < tentativas.length; i++) {
      var r = _req('post', '/chat/getBase64FromMediaMessage/' + encodeURIComponent(nome), tentativas[i]);
      if (r.erro) return { status: 'error', erro: r.erro };
      if (r.code >= 200 && r.code < 300 && r.json) {
        var b64 = r.json.base64 || (r.json.media && r.json.media.base64) || '';
        var mt = r.json.mimetype || r.json.mimeType || (r.json.media && r.json.media.mimetype) || '';
        if (b64) return { status: 'success', base64: b64, mimetype: mt };
      }
    }
    return { status: 'error', erro: 'Não consegui baixar a mídia (getBase64FromMediaMessage).' };
  }

  // ── Envia mídia (imagem/documento) para um contato/grupo ──
  // opts = { base64, mimetype, mediatype: 'image'|'document'|'video', legenda, fileName }
  function enviarMidia(contato, opts, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'EVOLUTION_INSTANCE não configurada.' };
    opts = opts || {};
    if (!opts.base64) return { status: 'error', erro: 'Mídia (base64) ausente.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var _tm = _throttle(); if (!_tm.ok) return { status: 'error', erro: _tm.erro };
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var body = {
      number: alvo,
      mediatype: opts.mediatype || 'image',
      media: opts.base64,
      mimetype: opts.mimetype || 'image/png',
      fileName: opts.fileName || ('arquivo.' + ((opts.mimetype || 'image/png').split('/')[1] || 'png'))
    };
    if (opts.legenda) body.caption = String(opts.legenda);
    var r = _req('post', '/message/sendMedia/' + encodeURIComponent(nome), body);
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', para: rj.nome || alvo };
    return { status: 'error', erro: 'sendMedia HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // Acrescenta a dica de RECONEXÃO quando a instância não está 'open' (causa nº1 de falha de envio).
  function _hintDesconectado(base, nome) {
    try { var cs = connState(nome); if (cs && String(cs.status || '').toLowerCase() !== 'open') return base + ' — ⚠️ o WhatsApp parece DESCONECTADO (estado: ' + (cs.status || '?') + '). Reconecte a instância no painel WhatsApp do app (escaneie o QR Code).'; } catch (e) {}
    return base;
  }

  // ── Envia ÁUDIO como nota de voz (PTT). base64 de áudio (idealmente OGG/Opus). ──
  function enviarAudio(contato, base64, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'EVOLUTION_INSTANCE não configurada.' };
    if (!base64) return { status: 'error', erro: 'Áudio (base64) ausente.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var _ta = _throttle(); if (!_ta.ok) return { status: 'error', erro: _ta.erro };
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var r = _req('post', '/message/sendWhatsAppAudio/' + encodeURIComponent(nome), { number: alvo, audio: base64, encoding: true });
    if (r.erro) return { status: 'error', erro: _hintDesconectado(r.erro, nome) };
    if (r.code >= 200 && r.code < 300) {
      // Anti-loop do self-chat: registra o id do ÁUDIO enviado por nós (o webhook ignora o eco dele).
      try { var _idEnv = r.json && ((r.json.key && r.json.key.id) || (r.json[0] && r.json[0].key && r.json[0].key.id)); if (_idEnv) _marcarEnviado(_idEnv); } catch (eId) {}
      return { status: 'success', para: rj.nome || alvo };
    }
    return { status: 'error', erro: _hintDesconectado('sendWhatsAppAudio HTTP ' + r.code + ': ' + String(r.text).substring(0, 160), nome) };
  }

  // ── Postar no STATUS / Stories ──
  // opts = { tipo:'text'|'image', texto, base64, legenda, corDeFundo, font }
  function postarStatus(opts, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'EVOLUTION_INSTANCE não configurada.' };
    opts = opts || {};
    var body;
    if (opts.tipo === 'image' || opts.base64 || opts.url) {
      // Preferir URL pública (a Evolution baixa do link) — evita o limite de tamanho do base64.
      var conteudo = opts.url || opts.base64;
      if (!conteudo) return { status: 'error', erro: 'Imagem (url ou base64) ausente para o status.' };
      body = { type: 'image', content: conteudo, caption: opts.legenda || '', allContacts: true };
    } else {
      if (!opts.texto) return { status: 'error', erro: 'Texto ausente para o status.' };
      body = { type: 'text', content: String(opts.texto), backgroundColor: opts.corDeFundo || '#075E54', font: (opts.font != null ? opts.font : 1), allContacts: true };
    }
    var _ts = _throttle(); if (!_ts.ok) return { status: 'error', erro: _ts.erro };
    var r = _req('post', '/message/sendStatus/' + encodeURIComponent(nome), body);
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', tipo: body.type };
    return { status: 'error', erro: 'sendStatus HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // ── Galeria: baixa as mídias de uma conversa e arquiva no Drive (raw/<categoria>) ──
  // opts = { tipo:'imagem'|'audio'|'documento'|'video'|'', max, limite }
  function baixarMidiasConversa(contato, opts, instanceName) {
    opts = opts || {};
    var raw = lerMensagensRaw(contato, opts.limite || 50, instanceName);
    if (raw.status !== 'success') return raw;
    var filtro = String(opts.tipo || '').toLowerCase();
    var alvo = raw.registros.filter(function (r) {
      var m = r.message || {};
      var t = m.imageMessage ? 'imagem' : (m.audioMessage ? 'audio' : (m.documentMessage ? 'documento' : (m.videoMessage ? 'video' : '')));
      r._t = t;
      return t && (!filtro || t === filtro);
    }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, opts.max || 10);
    var salvos = [];
    for (var i = 0; i < alvo.length; i++) {
      var dl = baixarMidiaBase64(alvo[i].message, alvo[i].key, instanceName);
      if (dl.status !== 'success' || !dl.base64) continue;
      try {
        var mt = dl.mimetype || 'application/octet-stream';
        var ext = ((mt.split('/')[1] || 'bin').split(';')[0]);
        var nomeArq = 'wa-' + String(raw.contato || 'contato').replace(/\W+/g, '_').substring(0, 24) + '-' + (alvo[i].ts || i) + '.' + ext;
        var anexo = { tipo: 'inline', mimeType: mt, data: dl.base64, nome: nomeArq, isImage: mt.indexOf('image/') === 0 };
        var sv = (typeof DriveUploads !== 'undefined') ? DriveUploads.salvar(anexo) : null;
        var thumb = (sv && alvo[i]._t === 'imagem') ? ('https://drive.google.com/thumbnail?id=' + sv.id + '&sz=w600') : '';
        salvos.push({ nome: nomeArq, tipo: alvo[i]._t, url: sv ? sv.url : '', fileId: sv ? sv.id : '', thumbUrl: thumb, categoria: sv ? sv.categoria : '' });
      } catch (e) {}
    }
    return { status: 'success', contato: raw.contato, baixados: salvos.length, arquivos: salvos };
  }

  // ── Reage (emoji) à última mensagem (preferindo a última RECEBIDA) de um contato ──
  function reagir(contato, emoji, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    var raw = lerMensagensRaw(contato, 8, instanceName);
    if (raw.status !== 'success') return raw;
    var recs = raw.registros.slice().sort(function (a, b) { return b.ts - a.ts; });
    var alvo = recs.filter(function (r) { return !r.fromMe; })[0] || recs[0];
    if (!alvo) return { status: 'error', erro: 'Nenhuma mensagem encontrada para reagir.' };
    var r = _req('post', '/message/sendReaction/' + encodeURIComponent(nome), { key: alvo.key, reaction: String(emoji || '👍') });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', emoji: String(emoji || '👍'), para: raw.contato };
    return { status: 'error', erro: 'sendReaction HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // ── Indicador de presença (digitando/gravando) ──
  function enviarPresenca(contato, presenca, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'Instância não configurada.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var r = _req('post', '/chat/sendPresence/' + encodeURIComponent(nome), { number: alvo, presence: presenca || 'composing', delay: 1200 });
    return (r.code >= 200 && r.code < 300) ? { status: 'success' } : { status: 'error', erro: 'sendPresence HTTP ' + r.code };
  }

  // ── Estado de conexão de uma instância ──
  function connState(instanceName) {
    var c = _cfg();
    var nome = instanceName || c.instance;
    var r = _req('get', '/instance/connectionState/' + encodeURIComponent(nome));
    if (r.erro) return { status: 'erro', erro: r.erro };
    if (r.code === 404) return { status: 'inexistente', instancia: nome };
    if (r.code < 200 || r.code >= 300) return { status: 'desconhecido', code: r.code, instancia: nome };
    var estado = (r.json && (r.json.state || (r.json.instance && r.json.instance.state))) || 'desconhecido';
    return { status: estado === 'open' ? 'CONNECTED' : estado, instancia: nome };
  }

  // ── QR Code / conexão (porta de obterQrCodeInstancia do Antigravity) ──
  function obterQrCode(instanceName) {
    var c = _cfg();
    if (!c.url || !c.key) return { status: 'error', erro: 'Evolution não configurada.' };
    var nome = instanceName || c.instance;
    var headers = { apikey: c.key };

    var st = UrlFetchApp.fetch(c.url + '/instance/connectionState/' + encodeURIComponent(nome), { method: 'get', headers: headers, muteHttpExceptions: true });
    var code = st.getResponseCode();

    if (code === 200) {
      var sd; try { sd = JSON.parse(st.getContentText()); } catch (e) { sd = {}; }
      if (sd.instance && sd.instance.state === 'open') {
        var numero = '';
        try {
          var all = JSON.parse(UrlFetchApp.fetch(c.url + '/instance/fetchInstances', { method: 'get', headers: headers, muteHttpExceptions: true }).getContentText());
          for (var k = 0; k < all.length; k++) {
            var it = all[k]; var nm = it.name || (it.instance && it.instance.instanceName);
            if (nm === nome) { var oj = it.ownerJid || (it.instance && it.instance.owner); if (oj) numero = String(oj).split('@')[0]; break; }
          }
        } catch (e2) {}
        return { status: 'CONNECTED', instancia: nome, numero: numero };
      }
    } else if (code === 404) {
      var cr = UrlFetchApp.fetch(c.url + '/instance/create', {
        method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true,
        payload: JSON.stringify({ instanceName: nome, qrcode: true, integration: 'WHATSAPP-BAILEYS' })
      });
      var cc = cr.getResponseCode();
      if (cc !== 200 && cc !== 201) return { status: 'error', erro: 'Falha ao criar instância "' + nome + '" (HTTP ' + cc + ').' };
      _setWebhook(nome);
      try { var cd = JSON.parse(cr.getContentText()); if (cd.qrcode && cd.qrcode.base64) return { status: 'QRCODE', instancia: nome, base64: cd.qrcode.base64 }; } catch (e3) {}
      Utilities.sleep(900);
    }

    var qr = UrlFetchApp.fetch(c.url + '/instance/connect/' + encodeURIComponent(nome), { method: 'get', headers: headers, muteHttpExceptions: true });
    if (qr.getResponseCode() !== 200) return { status: 'AGUARDANDO', instancia: nome, erro: 'QR indisponível (HTTP ' + qr.getResponseCode() + '). Tente novamente em alguns segundos.' };
    var qd; try { qd = JSON.parse(qr.getContentText()); } catch (e) { qd = {}; }
    if (qd.base64) return { status: 'QRCODE', instancia: nome, base64: qd.base64 };
    return { status: 'AGUARDANDO', instancia: nome, erro: 'QR não disponível ainda.' };
  }

  // ── Conversas (chats) da instância ──
  function findChats(instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    var r = _req('post', '/chat/findChats/' + encodeURIComponent(nome), {});
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code < 200 || r.code >= 300) return { status: 'error', erro: 'findChats HTTP ' + r.code };
    var arr = Array.isArray(r.json) ? r.json : ((r.json && (r.json.chats || r.json.records)) || []);
    var chats = arr.slice(0, 50).map(function (ch) {
      var jid = ch.remoteJid || ch.id || ch.jid || '';
      return { numero: String(jid).split('@')[0], nome: ch.pushName || ch.name || ch.profileName || '', jid: jid };
    });
    return { status: 'success', total: chats.length, conversas: chats };
  }

  // ── Mensagens de uma conversa ──
  // contato = NOME do contato/grupo OU número. Resolve o jid automaticamente.
  function findMessages(contato, limite, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var r = _req('post', '/chat/findMessages/' + encodeURIComponent(nome), { where: { key: { remoteJid: rj.jid } }, limit: Number(limite) || 20 });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code < 200 || r.code >= 300) return { status: 'error', erro: 'findMessages HTTP ' + r.code };
    var recs = (r.json && r.json.messages && r.json.messages.records) || (Array.isArray(r.json) ? r.json : ((r.json && r.json.records) || []));
    var msgs = recs.slice(0, 30).map(function (m) {
      var key = m.key || {}; var msg = m.message || {};
      var texto = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text)
        || (msg.imageMessage && (msg.imageMessage.caption || '[imagem]')) || (msg.audioMessage ? '[áudio]' : '')
        || (msg.documentMessage ? '[documento]' : '') || '';
      return { de: key.fromMe ? 'eu' : String(key.remoteJid || '').split('@')[0], fromMe: !!key.fromMe, texto: texto, ts: m.messageTimestamp || '' };
    });
    return { status: 'success', contato: rj.nome || rj.numero, jid: rj.jid, total: msgs.length, mensagens: msgs };
  }

  // ── Mensagens CRUAS (com key + objeto message) — para baixar/transcrever mídia ──
  function lerMensagensRaw(contato, limite, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var r = _req('post', '/chat/findMessages/' + encodeURIComponent(nome), { where: { key: { remoteJid: rj.jid } }, limit: Number(limite) || 12 });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code < 200 || r.code >= 300) return { status: 'error', erro: 'findMessages HTTP ' + r.code };
    var recs = (r.json && r.json.messages && r.json.messages.records) || (Array.isArray(r.json) ? r.json : ((r.json && r.json.records) || []));
    var registros = recs.map(function (m) {
      return { key: m.key || {}, message: m.message || {}, ts: Number(m.messageTimestamp) || 0, fromMe: !!(m.key && m.key.fromMe) };
    });
    return { status: 'success', contato: rj.nome || rj.numero, jid: rj.jid, registros: registros };
  }

  // /exec CANÔNICO do deployment versionado (estável). getService().getUrl() é NÃO-CONFIÁVEL
  // aqui (retorna o /dev de OUTRO deployment), então usamos a Script Property WEBHOOK_EXEC_URL
  // (se setada) ou este padrão. Se um dia trocar o deployment, basta atualizar a propriedade.
  var _EXEC_URL_PADRAO = '';   // sem padrao: defina WEBHOOK_EXEC_URL
  function _execUrl() {
    var u = _p('WEBHOOK_EXEC_URL');
    if (u && /\/exec$/.test(u)) return u;
    return _EXEC_URL_PADRAO;
  }

  // ── Estado do webhook: aponta para ESTE web app? (para o painel mostrar "bot ativo") ──
  function statusWebhook(instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!c.url || !c.key) return { status: 'error', erro: 'Evolution não configurada.' };
    var r = _req('get', '/webhook/find/' + encodeURIComponent(nome));
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code < 200 || r.code >= 300) return { status: 'success', enabled: false, url: '', apontaParaCa: false };
    var wh = (r.json && (r.json.webhook || r.json)) || {};
    var url = wh.url || '';
    var meuId = (_execUrl().match(/\/s\/([^\/]+)\//) || [])[1] || '';
    var secret = _p('WHATSAPP_WEBHOOK_SECRET') || '';
    var apontaParaCa = !!(url && meuId && url.indexOf(meuId) !== -1);
    var temSecret = !secret || url.indexOf('wh=' + secret) !== -1; // se há secret, a URL precisa tê-lo
    var eventos = wh.events || [];
    var temUpsert = eventos.indexOf && eventos.indexOf('MESSAGES_UPSERT') !== -1;
    return { status: 'success', enabled: !!wh.enabled, url: url, eventos: eventos, temSecret: temSecret, apontaParaCa: apontaParaCa && temSecret && !!wh.enabled && temUpsert };
  }

  // ── Ativar o bot: aponta o webhook da instância para ESTE web app (Jarvis recebe as mensagens) ──
  function apontarWebhook(instanceName) {
    var c = _cfg();
    if (!c.url || !c.key) return { status: 'error', erro: 'Evolution não configurada.' };
    var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'Instância não configurada (EVOLUTION_INSTANCE_NAME).' };
    var base = _execUrl(); // /exec canônico (NÃO usar getService().getUrl() — retorna /dev errado)
    if (!base) return { status: 'error', erro: 'URL do web app indisponível (faça o deploy primeiro).' };
    var secret = _p('WHATSAPP_WEBHOOK_SECRET') || '';
    var url = base + (secret ? ('?wh=' + secret) : '');
    var r = _req('post', '/webhook/set/' + encodeURIComponent(nome), {
      webhook: { url: url, enabled: true, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] }
    });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', instancia: nome, webhook: url };
    return { status: 'error', erro: 'webhook/set HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // ── Enviar LOCALIZAÇÃO (sendLocation) ──
  function enviarLocalizacao(contato, lat, lng, titulo, endereco, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'Instância não configurada.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var _tl = _throttle(); if (!_tl.ok) return { status: 'error', erro: _tl.erro };
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var r = _req('post', '/message/sendLocation/' + encodeURIComponent(nome), {
      number: alvo, name: String(titulo || ''), address: String(endereco || ''),
      latitude: Number(lat), longitude: Number(lng)
    });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', para: rj.nome || alvo };
    return { status: 'error', erro: 'sendLocation HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // ── Enviar CONTATO (vCard via sendContact) ──
  function enviarContato(contato, nomeContato, numeroContato, instanceName) {
    var c = _cfg(); var nome = instanceName || c.instance;
    if (!nome) return { status: 'error', erro: 'Instância não configurada.' };
    var rj = _resolverJid(contato, nome);
    if (rj.erro) return { status: 'error', erro: rj.erro };
    var _tc = _throttle(); if (!_tc.ok) return { status: 'error', erro: _tc.erro };
    var alvo = rj.jid.indexOf('@s.whatsapp.net') >= 0 ? rj.numero : rj.jid;
    var fone = _so(numeroContato);
    var r = _req('post', '/message/sendContact/' + encodeURIComponent(nome), {
      number: alvo, contact: [{ fullName: String(nomeContato || ''), wuid: fone, phoneNumber: fone }]
    });
    if (r.erro) return { status: 'error', erro: r.erro };
    if (r.code >= 200 && r.code < 300) return { status: 'success', para: rj.nome || alvo, contatoEnviado: nomeContato };
    return { status: 'error', erro: 'sendContact HTTP ' + r.code + ': ' + String(r.text).substring(0, 160) };
  }

  // ── PROGRAMAÇÃO de mensagens (envio futuro, SEM IA — disparado pelo tick) ──
  var COL_AGEND = 'msgs_agendadas';
  function agendarEnvio(contato, mensagem, quandoMs, opts) {
    opts = opts || {};
    if (!contato || !mensagem) return { status: 'error', erro: 'Informe contato e mensagem.' };
    var quando = Number(quandoMs);
    if (!quando || quando < Date.now() - 60000) return { status: 'error', erro: 'Data/hora inválida ou no passado.' };
    var id = Utilities.getUuid().substring(0, 8);
    var doc = { contato: String(contato), mensagem: String(mensagem), quandoMs: quando, status: 'pendente', criadoEm: Date.now() };
    var rm = Number(opts.repetirMeses) || 0, rd = Number(opts.repetirDias) || 0;
    if (rm > 0) doc.repetirMeses = rm;
    if (rd > 0) doc.repetirDias = rd;
    Firestore.setDoc(COL_AGEND, id, doc);
    return { status: 'success', id: id, quando: new Date(quando).toISOString(), repete: rm ? ('a cada ' + rm + ' mês(es)') : (rd ? ('a cada ' + rd + ' dia(s)') : 'uma vez') };
  }
  // Avança a data-base em meses/dias até cair no futuro (caso o tick tenha atrasado).
  function _proximaOcorrencia(baseMs, meses, dias, agora) {
    var d = new Date(Number(baseMs));
    do {
      if (meses) d.setMonth(d.getMonth() + Number(meses));
      else d.setDate(d.getDate() + Number(dias));
    } while (d.getTime() <= agora);
    return d.getTime();
  }
  function listarAgendadas() {
    return Firestore.listDocs(COL_AGEND, 50)
      .filter(function (m) { return m.dados.status === 'pendente'; })
      .sort(function (a, b) { return (a.dados.quandoMs || 0) - (b.dados.quandoMs || 0); })
      .map(function (m) {
        var d = m.dados;
        var rep = d.repetirMeses ? ('a cada ' + d.repetirMeses + ' mês(es)') : (d.repetirDias ? ('a cada ' + d.repetirDias + ' dia(s)') : 'uma vez');
        return { id: m.id, contato: d.contato, mensagem: d.mensagem, quando: new Date(d.quandoMs).toISOString(), repete: rep };
      });
  }
  function cancelarAgendada(id) {
    var docs = Firestore.listDocs(COL_AGEND, 50);
    var alvo = String(id || '').toLowerCase().trim(), rem = 0;
    docs.forEach(function (m) {
      if (m.id === id || (m.dados.status === 'pendente' && String(m.dados.contato || '').toLowerCase().indexOf(alvo) !== -1)) {
        try { Firestore.deleteDoc(COL_AGEND, m.id); rem++; } catch (e) {}
      }
    });
    return { status: 'success', canceladas: rem };
  }
  // Chamado no tick (a cada ~15 min): envia as mensagens devidas e limpa antigas.
  function enviarAgendadasDevidas() {
    var agora = Date.now(), enviadas = 0;
    try {
      Firestore.listDocs(COL_AGEND, 80).forEach(function (m) {
        var d = m.dados || {};
        if (d.status === 'pendente' && (d.quandoMs || 0) <= agora) {
          var r = enviar(d.contato, d.mensagem);
          if (r.status === 'success') enviadas++;
          if (r.status === 'success' && (d.repetirMeses || d.repetirDias)) {
            // RECORRENTE: reprograma a próxima ocorrência, mantendo pendente.
            var prox = _proximaOcorrencia(d.quandoMs, d.repetirMeses, d.repetirDias, agora);
            try { Firestore.updateDoc(COL_AGEND, m.id, { quandoMs: prox, ultimoEnvio: agora }); } catch (e) {}
          } else {
            try { Firestore.updateDoc(COL_AGEND, m.id, { status: r.status === 'success' ? 'enviada' : 'falhou', resultado: String(r.erro || 'ok').substring(0, 120), enviadaEm: agora }); } catch (e) {}
          }
        } else if (d.status !== 'pendente' && (d.enviadaEm || d.criadoEm || 0) < agora - 24 * 3600000) {
          try { Firestore.deleteDoc(COL_AGEND, m.id); } catch (e) {} // limpa resolvidas >24h
        }
      });
    } catch (e) {}
    return enviadas;
  }

  return {
    enviar: enviar,
    enviarLocalizacao: enviarLocalizacao,
    enviarContato: enviarContato,
    agendarEnvio: agendarEnvio,
    listarAgendadas: listarAgendadas,
    cancelarAgendada: cancelarAgendada,
    enviarAgendadasDevidas: enviarAgendadasDevidas,
    listarInstancias: listarInstancias,
    statusInstancia: statusInstancia,
    conectar: conectar,
    parseWebhook: parseWebhook,
    instanciasConfig: instanciasConfig,
    dashboardUrl: dashboardUrl,
    connState: connState,
    obterQrCode: obterQrCode,
    findChats: findChats,
    findMessages: findMessages,
    apontarWebhook: apontarWebhook,
    baixarMidiaBase64: baixarMidiaBase64,
    enviarMidia: enviarMidia,
    enviarAudio: enviarAudio,
    lerMensagensRaw: lerMensagensRaw,
    postarStatus: postarStatus,
    baixarMidiasConversa: baixarMidiasConversa,
    reagir: reagir,
    enviarPresenca: enviarPresenca,
    statusWebhook: statusWebhook,
    foiEnviadoPorMim: foiEnviadoPorMim,
    throttleStatus: function () {
      var arr = []; try { arr = JSON.parse(CacheService.getScriptCache().get('WA_SENDS') || '[]'); } catch (e) {}
      var now = Date.now();
      return { ultimoMinuto: arr.filter(function (t) { return now - t < 60000; }).length, ultimaHora: arr.filter(function (t) { return now - t < 3600000; }).length };
    }
  };
})();

/** Diagnóstico anti-ban: mostra o ritmo de envios e os limites atuais. Rode no editor. */
function diagAntiBan() {
  var p = PropertiesService.getScriptProperties();
  var s = WhatsApp.throttleStatus();
  Logger.log('📊 Anti-ban WhatsApp — envios no último minuto: ' + s.ultimoMinuto + ' | última hora: ' + s.ultimaHora);
  Logger.log('Limites (ajustáveis em Script Properties): WA_LIM_MIN=' + (p.getProperty('WA_LIM_MIN') || '10') + '/min · WA_LIM_HORA=' + (p.getProperty('WA_LIM_HORA') || '120') + '/h · WA_GAP_MS=' + (p.getProperty('WA_GAP_MS') || '800') + 'ms (intervalo mínimo).');
  return s;
}
