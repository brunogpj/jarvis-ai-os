/**
 * Android.js — canal do Jarvis para o APP ANDROID PRÓPRIO (substitui, aos poucos, o webhook do MacroDroid).
 * Ver docs/android-app/PLANO.md.
 *
 * Jarvis -> celular: push FCM (HTTP v1), mensagem só de DADOS e prioridade alta. A conta de serviço é a
 * mesma do Firestore (ou ANDROID_SA, se existir), com o papel "Firebase Cloud Messaging API Admin".
 * Celular -> Jarvis: o app avisa por doPost `android_registrar` (token FCM) e `android_ack`
 * (recebido / concluido / erro) com o id da ordem. A confirmação fica no CacheService por 6 h.
 *
 * Por que há confirmação: o webhook do MacroDroid devolvia 200 mesmo quando a macro não rodava, então o
 * Jarvis dizia "falei" sem ter falado. Aqui "enviado" e "recebido pelo aparelho" são coisas diferentes.
 *
 * Nada aqui liga sozinho: a fala só vai por este canal com ANDROID_FALAR=sim E um aparelho registrado.
 * Segredos só em Script Properties: ANDROID_FCM_TOKEN, ANDROID_FCM_PROJECT, ANDROID_SA.
 */
var Android = (function () {
  var TZ = 'America/Sao_Paulo';
  var ESCOPO = 'https://www.googleapis.com/auth/firebase.messaging';

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
  function _setP(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
  function _b64url(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
  function _agora() { return Date.now(); }

  /** Conta de serviço: ANDROID_SA, senão a do Firestore. */
  function _sa() {
    var raw = _p('ANDROID_SA') || _p('FIRESTORE_SA');
    if (!raw) throw new Error('Conta de serviço ausente (ANDROID_SA ou FIRESTORE_SA).');
    return JSON.parse(raw);
  }

  /** Access token OAuth com o escopo do FCM (cache de 55 min). */
  function _token() {
    var cache = CacheService.getScriptCache();
    var c = cache.get('ANDROID_SA_TOKEN');
    if (c) return c;
    var sa = _sa();
    var now = Math.floor(_agora() / 1000);
    var header = { alg: 'RS256', typ: 'JWT' };
    var claim = { iss: sa.client_email, scope: ESCOPO, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    var entrada = _b64url(JSON.stringify(header)) + '.' + _b64url(JSON.stringify(claim));
    var sig = Utilities.computeRsaSha256Signature(entrada, sa.private_key);
    var jwt = entrada + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post', muteHttpExceptions: true,
      payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
    });
    var corpo = {};
    try { corpo = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
    if (!corpo.access_token) throw new Error('Não consegui o token do FCM: ' + String(res.getContentText()).substring(0, 160));
    cache.put('ANDROID_SA_TOKEN', corpo.access_token, 3300);
    return corpo.access_token;
  }

  function _projeto() {
    var p = _p('ANDROID_FCM_PROJECT');
    if (p) return p;
    try { return _sa().project_id; } catch (e) { return ''; }
  }

  // ---------------------------------------------------------------- aparelho ----
  /** Guarda o token FCM do aparelho (o app chama quando o token nasce ou muda). */
  function registrar(info) {
    info = info || {};
    var t = String(info.fcm_token || '').trim();
    if (!/^[A-Za-z0-9:_\-]{20,400}$/.test(t)) return { ok: false, erro: 'token FCM inválido' };
    // O app informa o projeto do Firebase em que está registrado: é daí que o push sai (a conta de serviço do Firestore é de OUTRO projeto).
    var proj = String(info.fcm_project || '').trim();
    if (proj && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(proj)) return { ok: false, erro: 'projeto do Firebase inválido' };
    if (proj) _setP('ANDROID_FCM_PROJECT', proj);
    _setP('ANDROID_FCM_TOKEN', t);
    _setP('ANDROID_DEVICE', JSON.stringify({
      modelo: String(info.modelo || '').substring(0, 60), android: String(info.android || '').substring(0, 20),
      app: String(info.app || '').substring(0, 30), registradoEm: _agora()
    }));
    return { ok: true };
  }

  function dispositivo() {
    var t = _p('ANDROID_FCM_TOKEN') || '';
    var d = {};
    try { d = JSON.parse(_p('ANDROID_DEVICE') || '{}'); } catch (e) {}
    return { registrado: !!t, modelo: d.modelo || '', android: d.android || '', app: d.app || '', registradoEm: d.registradoEm || 0 };
  }

  /** A fala só vai por aqui se o dono ligou (ANDROID_FALAR=sim) e há aparelho registrado. */
  function falarAtivo() {
    return String(_p('ANDROID_FALAR') || 'nao').toLowerCase() === 'sim' && !!_p('ANDROID_FCM_TOKEN');
  }

  /** Os controles do celular (volume, mídia, lanterna, não perturbe, abrir app/link, navegar) só vão por aqui com ANDROID_CONTROLES=sim. */
  function controlesAtivo() {
    return String(_p('ANDROID_CONTROLES') || 'nao').toLowerCase() === 'sim' && !!_p('ANDROID_FCM_TOKEN');
  }

  /** Telemetria pelo app (ordem `telemetria`): o app lê bateria, tomada, Wi-Fi e volume e devolve pela rota android_telemetria. */
  function telemetriaAtiva() {
    return String(_p('ANDROID_TELEMETRIA') || 'nao').toLowerCase() === 'sim' && !!_p('ANDROID_FCM_TOKEN');
  }
  /** Avisos do Jarvis como notificação no celular (ordem `controle` acao `notificar`), no lugar da macro Jarvis Notificar. */
  function notificarAtivo() {
    return String(_p('ANDROID_NOTIFICAR') || 'nao').toLowerCase() === 'sim' && !!_p('ANDROID_FCM_TOKEN');
  }

  /** Lista fechada do que o app aceita como ordem `controle` (o app repete a checagem do lado dele). */
  var CONTROLES_PERMITIDOS = ['volume', 'midia', 'lanterna', 'naoperturbe', 'abrirapp', 'abrirurl', 'navegar', 'notificar'];

  // ------------------------------------------------------------------- envio ----
  function _novoId() { return 'a' + _agora().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  /** Monta o corpo da mensagem FCM v1 (função pura: testável sem rede). Valores de `data` são sempre texto. */
  function montarMensagem(fcmToken, id, tipo, dados) {
    var data = { id: String(id), tipo: String(tipo) };
    Object.keys(dados || {}).forEach(function (k) {
      var v = dados[k];
      if (v === undefined || v === null || v === '') return;
      data[k] = typeof v === 'string' ? v : JSON.stringify(v);
    });
    return { message: { token: fcmToken, android: { priority: 'HIGH', ttl: '120s' }, data: data } };
  }

  /** Envia a ordem. → { ok, id } ou { ok:false, erro, id }. Token que o FCM diz não existir mais é apagado. */
  function enviar(tipo, dados) {
    var id = _novoId();
    try {
      var fcm = _p('ANDROID_FCM_TOKEN');
      if (!fcm) return { ok: false, id: id, erro: 'nenhum aparelho registrado' };
      var proj = _projeto();
      if (!proj) return { ok: false, id: id, erro: 'projeto do FCM não configurado (ANDROID_FCM_PROJECT)' };
      var res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(proj) + '/messages:send', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + _token() },
        payload: JSON.stringify(montarMensagem(fcm, id, tipo, dados))
      });
      var code = res.getResponseCode(), txt = res.getContentText() || '';
      if (code >= 200 && code < 300) {
        _guardarEstado(id, { estado: 'enviado', tipo: tipo, ts: _agora() });
        return { ok: true, id: id };
      }
      if (code === 404 || /UNREGISTERED|NOT_FOUND/.test(txt)) { try { PropertiesService.getScriptProperties().deleteProperty('ANDROID_FCM_TOKEN'); } catch (e) {} }
      var msg = txt; try { msg = JSON.parse(txt).error.message || txt; } catch (e2) {}
      return { ok: false, id: id, erro: 'FCM HTTP ' + code + ': ' + String(msg).substring(0, 200) };
    } catch (e) { return { ok: false, id: id, erro: e.message }; }
  }

  /** Ordem de fala. audioId: arquivo do Drive com o áudio da nuvem; texto + local:true: voz do próprio celular. */
  function enviarFala(o) {
    o = o || {};
    var dados = { texto: String(o.texto || '').substring(0, 1500) };
    if (o.audioId) dados.audio_url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(o.audioId);
    if (o.local) dados.local = '1';
    return enviar('falar', dados);
  }

  /** Ordem de controle do celular. `campos` já normalizados (nivel, comando, estado, pacote, classe, url, destino). */
  function enviarControle(acao, campos) {
    if (CONTROLES_PERMITIDOS.indexOf(acao) === -1) return { ok: false, id: '', erro: 'controle fora da lista: ' + acao };
    var dados = { acao: acao };
    Object.keys(campos || {}).forEach(function (k) { dados[k] = String(campos[k]).substring(0, 1500); });
    return enviar('controle', dados);
  }

  /** Pede a telemetria ao app. Não espera resposta: o app a manda sozinho para android_telemetria. → { ok, id, erro? } */
  function pedirTelemetria() { return enviar('telemetria', {}); }

  // ------------------------------------------------------------ confirmação ----
  function _guardarEstado(id, obj) {
    try { CacheService.getScriptCache().put('android_ordem_' + id, JSON.stringify(obj), 21600); } catch (e) {}
  }
  function estado(id) {
    try { var s = CacheService.getScriptCache().get('android_ordem_' + id); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  /** O app confirma: estado = recebido | tocando | concluido | erro. Idempotente (o /exec às vezes perde a resposta e o app repete). */
  function ack(body) {
    var id = String((body && body.id) || '');
    if (!/^[a-z0-9]{6,30}$/.test(id)) return { ok: false, erro: 'id inválido' };
    var est = String(body.estado || '').toLowerCase();
    if (!/^(recebido|tocando|concluido|erro)$/.test(est)) return { ok: false, erro: 'estado inválido' };
    var ant = estado(id) || {};
    var peso = { enviado: 0, recebido: 1, tocando: 2, concluido: 3, erro: 3 };
    // nunca volta para um estado anterior (confirmação atrasada não desfaz a posterior)
    if ((peso[ant.estado] || 0) > peso[est]) return { ok: true, ignorado: true };
    _guardarEstado(id, { estado: est, tipo: ant.tipo || '', detalhe: String(body.detalhe || '').substring(0, 160), ts: _agora(), enviadoEm: ant.ts || 0 });
    return { ok: true };
  }

  /** Espera o app confirmar o recebimento (até `ms`). → o estado, ou null se ninguém confirmou. */
  function aguardarAck(id, ms) {
    var fim = _agora() + (ms || 6000);
    while (_agora() < fim) {
      var s = estado(id);
      if (s && s.estado !== 'enviado') return s;
      Utilities.sleep(400);
    }
    return null;
  }

  function status() {
    var d = dispositivo();
    return { dispositivo: d, ativo: falarAtivo(), projeto: _projeto() ? 'configurado' : 'faltando',
             canalFalar: String(_p('ANDROID_FALAR') || 'nao').toLowerCase(),
             canalControles: String(_p('ANDROID_CONTROLES') || 'nao').toLowerCase(),
             canalTelemetria: String(_p('ANDROID_TELEMETRIA') || 'nao').toLowerCase(), canalNotificar: String(_p('ANDROID_NOTIFICAR') || 'nao').toLowerCase() };
  }

  return { registrar: registrar, dispositivo: dispositivo, falarAtivo: falarAtivo, controlesAtivo: controlesAtivo, telemetriaAtiva: telemetriaAtiva, notificarAtivo: notificarAtivo, pedirTelemetria: pedirTelemetria, CONTROLES_PERMITIDOS: CONTROLES_PERMITIDOS, montarMensagem: montarMensagem,
           enviar: enviar, enviarFala: enviarFala, enviarControle: enviarControle, ack: ack, estado: estado, aguardarAck: aguardarAck, status: status };
})();
