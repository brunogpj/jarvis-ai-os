// ===================================================================================
// Gemini.js — Caller central da API Gemini com CASCATA de chaves/modelos.
//   1) Primária:  GEMINI_API_KEY           (faturamento) + GEMINI_MODEL          (default gemini-flash-latest)
//   2) Fallback:  GEMINI_API_KEY_FALLBACK  (free tier)   + GEMINI_MODEL_FALLBACK (default gemini-2.5-flash)
// Se a primária falhar (cota/faturamento/erro), tenta automaticamente a fallback.
// Todos os módulos (Jarvis, SkillsManager, DriveUploads) usam Gemini.gerar(payload).
// ===================================================================================

var GEMINI_BUILD = 'b16-2026-06-03-busca-nativa-wiki';

var Gemini = (function () {
  'use strict';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  // Modelos a tentar, em ordem. flash-lite = rápido/barato/thinking-off (sem problema de
  // thought_signature); 2.5-flash = reserva robusta. Sobrescrevíveis por Script Property.
  function _models() {
    var m1 = _p('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
    var m2 = _p('GEMINI_MODEL_FALLBACK') || 'gemini-2.5-flash';
    var arr = [m1];
    if (m2 && m2 !== m1) arr.push(m2);
    return arr;
  }

  // GEMINI_FREE_ONLY=true → a chave de FATURAMENTO é EXCLUÍDA de TODAS as chamadas (100% free tier).
  function _freeOnly() { return String(_p('GEMINI_FREE_ONLY') || '').toLowerCase() === 'true'; }

  // Chave para chamadas DIRETAS (não-cascata: embeddings, grounding, url_context, imagem).
  // Respeita free-only (nunca billing) e free-first (free antes da paga).
  function _keyDireta() {
    var kFree = _p('GEMINI_API_KEY_FALLBACK') || _p('GEMINI_API_KEY_FALLBACK2');
    var kBill = _p('GEMINI_API_KEY');
    if (_freeOnly()) return kFree || null;                                   // 100% free: nunca billing
    if (String(_p('GEMINI_ORDER') || 'free_first') !== 'billing_first') return kFree || kBill || null;
    return kBill || kFree || null;                                          // billing_first
  }

  function _tentativas() {
    var freeOnly = _freeOnly();
    var keys = [];
    // FREE primeiro — e usa AS DUAS chaves free (quando uma bate o limite, a outra assume).
    var kFree = _p('GEMINI_API_KEY_FALLBACK'); if (kFree) keys.push({ key: kFree, tier: 'free' });
    var kFree2 = _p('GEMINI_API_KEY_FALLBACK2'); if (kFree2) keys.push({ key: kFree2, tier: 'free' });
    var kBill = _p('GEMINI_API_KEY');
    if (kBill && !freeOnly) {  // paga só entra se NÃO for free-only
      if (String(_p('GEMINI_ORDER') || 'free_first') === 'billing_first') keys.unshift({ key: kBill, tier: 'faturamento' });
      else keys.push({ key: kBill, tier: 'faturamento' });                  // free_first → paga por último
    }
    var models = _models();
    var list = [];
    keys.forEach(function (k) { models.forEach(function (m) { list.push({ key: k.key, model: m, tier: k.tier }); }); });
    return list;
  }

  function temChave() { return !!(_p('GEMINI_API_KEY') || _p('GEMINI_API_KEY_FALLBACK') || _p('GEMINI_API_KEY_FALLBACK2')); }

  /**
   * Executa generateContent com cascata de chaves/modelos.
   * @param {Object} payload corpo do generateContent (contents, systemInstruction, tools, generationConfig...)
   * @return {Object} { json, model, tier } — lança erro se TODAS as tentativas falharem.
   */
  // THINK-1: traduz o hint interno `payload._thinking` ('low'|'high') no campo de thinking
  // CERTO para cada modelo (Gemini 3 = thinkingLevel; 2.5-flash = thinkingBudget) e SEMPRE remove
  // o `_thinking` antes de enviar (campo interno, não pertence à API). Sem hint → não mexe.
  function _comThinking(payload, model) {
    var body = {}; for (var p in payload) { if (p !== '_thinking') body[p] = payload[p]; }
    var level = payload && payload._thinking;
    if (!level) return body;
    var gc = {}; var src = payload.generationConfig || {}; for (var k in src) gc[k] = src[k];
    var m = String(model || '');
    if (/^gemini-3/.test(m)) {
      gc.thinkingConfig = { thinkingLevel: (level === 'high') ? 'high' : 'low' };
    } else if (/^gemini-2\.5-flash(-\d|$)/.test(m)) {            // 2.5-flash (NÃO o lite, que não pensa)
      gc.thinkingConfig = { thinkingBudget: (level === 'high') ? -1 : 0 }; // -1 dinâmico | 0 desliga
    }
    body.generationConfig = gc;
    return body;
  }

  function gerar(payload) {
    // Modelo via GEMINI_MODEL (Script Property). Com Gemini 3 (pensante), o multi-turn de
    // function-calling funciona porque o loop devolve as `parts` do modelo verbatim
    // (preservando thoughtSignature). A cascata cai para o GEMINI_MODEL_FALLBACK se o primário falhar.
    var tentativas = _tentativas();
    if (!tentativas.length) throw new Error('Nenhuma chave configurada (defina GEMINI_API_KEY e/ou GEMINI_API_KEY_FALLBACK nas Propriedades do script).');
    var erros = [];
    for (var i = 0; i < tentativas.length; i++) {
      var t = tentativas[i];
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + t.model + ':generateContent?key=' + encodeURIComponent(t.key);
      var body = _comThinking(payload, t.model);   // THINK-1: ajusta thinkingConfig por modelo + tira o hint interno
      var res;
      try {
        res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
      } catch (e) { erros.push(t.tier + '/' + t.model + ' → exceção: ' + e.message); continue; }
      var code = res.getResponseCode();
      if (code === 200) {
        try { return { json: JSON.parse(res.getContentText()), model: t.model, tier: t.tier }; }
        catch (e) { erros.push(t.tier + '/' + t.model + ' → 200 mas JSON inválido'); continue; }
      }
      var msg = res.getContentText();
      try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      erros.push(t.tier + '/' + t.model + ' → HTTP ' + code + ': ' + String(msg).substring(0, 140));
      // Qualquer falha (429 cota, 403 faturamento, 5xx, 400) → tenta a próxima chave/modelo.
    }
    var ctx = ' [build=' + GEMINI_BUILD + ' | GEMINI_MODEL=' + _p('GEMINI_MODEL') + ' | GEMINI_ORDER=' + _p('GEMINI_ORDER') + ' | scriptId=' + (function () { try { return ScriptApp.getScriptId(); } catch (e) { return '?'; } })() + ']';
    throw new Error('Gemini indisponível em todas as chaves:\n' + erros.join('\n') + ctx);
  }

  /**
   * Gera uma IMAGEM a partir de um prompt (modelo "nano banana" = gemini-2.5-flash-image).
   * Usa a chave de FATURAMENTO (GEMINI_API_KEY) — o free tier costuma recusar image-gen.
   * @param {string} prompt  descrição da imagem desejada
   * @param {Object} [opts]  { model } para sobrescrever o modelo
   * @return {Object} { base64, mimeType, model } — lança erro se falhar.
   */
  function gerarImagem(prompt, opts) {
    opts = opts || {};
    var key = _keyDireta();
    if (!key) throw new Error('Configure GEMINI_API_KEY (faturamento) para gerar imagens.');
    var model = opts.model || _p('GEMINI_IMAGE_MODEL') || 'gemini-2.5-flash-image';
    // P-M · prompt engineering: guia de SEGURANÇA + negative prompting (survey multimodal §9).
    // nano banana não tem campo negativo formal → embute como diretriz textual concisa.
    var promptFinal = String(prompt || '');
    var negativo = opts.negativo || _p('GEMINI_IMAGE_NEGATIVE') || 'deformações, mãos/dedos extras, texto ilegível, artefatos, baixa resolução, marca d\'água';
    promptFinal += '\n\n[Diretrizes: imagem segura para o trabalho — sem conteúdo sexual explícito, violência gráfica, ódio, ou imitação de pessoas reais identificáveis. Evite: ' + negativo + '.]';
    // Texto + imagens de ENTRADA (edição/composição image-to-image — nano banana edita/combina).
    var parts = [{ text: promptFinal }];
    (opts.imagens || []).forEach(function (im) {
      if (im && im.data) parts.push({ inlineData: { mimeType: im.mimeType || 'image/png', data: im.data } });
    });
    var genCfg = { responseModalities: ['TEXT', 'IMAGE'] };
    if (opts.aspecto) genCfg.imageConfig = { aspectRatio: String(opts.aspecto) }; // 1:1, 16:9, 9:16, 4:3, 3:4
    var payload = { contents: [{ role: 'user', parts: parts }], generationConfig: genCfg };
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code !== 200) {
      var msg = res.getContentText();
      try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      throw new Error('Geração de imagem falhou (HTTP ' + code + '): ' + String(msg).substring(0, 200));
    }
    var data = JSON.parse(res.getContentText() || '{}');
    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.inlineData && p.inlineData.data) {
        return { base64: p.inlineData.data, mimeType: p.inlineData.mimeType || 'image/png', model: model };
      }
    }
    throw new Error('O modelo não retornou imagem. Reformule o prompt ou verifique o modelo (' + model + ').');
  }

  /**
   * Cascata FREE-FIRST para chamadas com TOOL nativa (google_search / url_context):
   * tenta CHAVE × MODELO na ordem de _tentativas() (free → free2 → billing, salvo free_only),
   * com cooldown de 10 min por combinação que devolveu 429 (a cota de grounding é POR PROJETO —
   * a FALLBACK2 e a billing têm cotas independentes; antes, um 429 na 1ª chave matava a busca
   * o dia inteiro). @return { data, model, tier }. Lança erro se TODAS falharem.
   */
  function _fetchComCascata(rotulo, payload, modelos) {
    var tents = _tentativas();
    if (!tents.length) throw new Error('Nenhuma chave configurada (defina GEMINI_API_KEY e/ou GEMINI_API_KEY_FALLBACK).');
    var cache = null; try { cache = CacheService.getScriptCache(); } catch (eC) {}
    var ultErro = '';
    for (var k = 0; k < tents.length; k++) {
      for (var m = 0; m < modelos.length; m++) {
        var ckey = 'g429s_' + rotulo.replace(/\W+/g, '') + '_' + modelos[m] + '_' + String(tents[k].key).slice(-8);
        try { if (cache && cache.get(ckey)) { ultErro = ultErro || (rotulo + ': 429 em cooldown'); continue; } } catch (eG) {}
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelos[m] + ':generateContent?key=' + encodeURIComponent(tents[k].key);
        var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
        var code = res.getResponseCode();
        if (code === 200) return { data: JSON.parse(res.getContentText() || '{}'), model: modelos[m], tier: tents[k].tier };
        var msg = res.getContentText();
        try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (eP) {}
        ultErro = rotulo + ' HTTP ' + code + ': ' + String(msg).substring(0, 160);
        if (code === 429) { try { if (cache) cache.put(ckey, '1', 600); } catch (eW) {} }
        // 400/404 (modelo sem suporte à tool) → próximo modelo; 429/5xx → cascata segue.
      }
    }
    throw new Error(ultErro || (rotulo + ' falhou em todas as chaves/modelos.'));
  }

  /**
   * Pesquisa na WEB usando o grounding do Google Search nativo do Gemini.
   * Faz uma chamada SEPARADA (grounding não combina bem com function calling) e devolve
   * a resposta fundamentada + as fontes. Cascata free-first chave×modelo com cooldown de 429.
   * @return { texto, fontes:[urls] }.
   */
  function pesquisarWeb(consulta) {
    var payload = {
      contents: [{ role: 'user', parts: [{ text: String(consulta || '') }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 }
    };
    var modelos = [(_p('GEMINI_SEARCH_MODEL') || 'gemini-2.5-flash'), 'gemini-2.0-flash']
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var r = _fetchComCascata('busca web', payload, modelos);
    var data = r.data;
    var cand = data.candidates && data.candidates[0];
    var texto = (cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '').trim();
    var fontes = [];
    try {
      var chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
      fontes = chunks.map(function (c) { return c.web && (c.web.title ? (c.web.title + ' — ' + c.web.uri) : c.web.uri); }).filter(Boolean).slice(0, 6);
    } catch (e) {}
    return { texto: texto, fontes: fontes };
  }

  /**
   * Lê/resume uma URL usando o tool nativo `url_context` do Gemini — fetch feito pelos
   * servidores do Google, então lê páginas JS-renderizadas e PDFs (≠ UrlFetchApp cru).
   * Chamada SEPARADA (não combina com functionDeclarations). @return { texto, fontes:[urls] }.
   * Requer modelo com suporte a url_context (Gemini 2.x/3). Lança erro se falhar.
   */
  function lerUrl(url, instrucao) {
    var instr = (instrucao && String(instrucao).trim()) ? String(instrucao).trim()
      : 'Leia o conteúdo desta URL e faça um resumo objetivo e fiel do que é relevante. Baseie-se SOMENTE no conteúdo real da página (não invente).';
    var prompt = instr + '\n\nURL: ' + String(url || '');
    var payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ url_context: {} }],
      generationConfig: { temperature: 0.2 }
    };
    var modelos = [(_p('GEMINI_MODEL') || 'gemini-2.5-flash'), 'gemini-2.0-flash']
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var r = _fetchComCascata('url_context', payload, modelos);
    var data = r.data;
    var cand = data.candidates && data.candidates[0];
    var texto = (cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '').trim();
    var fontes = [];
    try {
      var meta = cand.url_context_metadata || cand.urlContextMetadata || {};
      var arr = meta.url_metadata || meta.urlMetadata || [];
      fontes = arr.map(function (u) { return u.retrieved_url || u.retrievedUrl || u.url || ''; }).filter(Boolean).slice(0, 6);
    } catch (e) {}
    return { texto: texto, fontes: fontes };
  }

  /**
   * Gera o EMBEDDING (vetor semântico) de um texto via text-embedding-004.
   * @param {string} texto
   * @param {Object} [opts] { tipo: 'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY' }
   * @return {number[]} vetor (768 dimensões). Lança erro se falhar.
   */
  // hash estável p/ chave de cache de embedding.
  function _embHash(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  function embeddar(texto, opts) {
    opts = opts || {};
    var model = _p('GEMINI_EMBED_MODEL') || 'gemini-embedding-001';
    var dims = Number(_p('GEMINI_EMBED_DIMS') || 768);
    // Q2b · CACHE de embedding de CONSULTA (RETRIEVAL_QUERY): consultas repetem muito; cachear
    // evita gastar cota do Gemini (embeddings dividem a MESMA cota do chat). Doc-embeddings são
    // únicos → não cacheia. TTL 6h. Chave inclui modelo+dims+texto.
    var cacheQuery = (opts.tipo === 'RETRIEVAL_QUERY');
    var ck = cacheQuery ? ('emb_' + model + '_' + dims + '_' + _embHash(String(texto || '').substring(0, 8000))) : null;
    if (ck) {
      try { var hit = CacheService.getScriptCache().get(ck); if (hit) return JSON.parse(hit); } catch (eC) {}
    }
    // CASCATA FREE-FIRST p/ embeddings: rotaciona TODAS as chaves (free → free2 → billing),
    // com cooldown de 10 min por chave que devolveu 429/quota. Antes usava 1 chave só (_keyDireta):
    // ao estourar a cota de embedding DELA, a reindexação inteira travava (198/284) mesmo com a 2ª
    // chave livre. A cota de embedContent é POR PROJETO → cada chave tem cota independente.
    var tents = _tentativas();
    if (!tents.length) throw new Error('Configure GEMINI_API_KEY (ou FALLBACK) para embeddings.');
    var cache = null; try { cache = CacheService.getScriptCache(); } catch (eCc) {}
    var payload = { model: 'models/' + model, content: { parts: [{ text: String(texto || '').substring(0, 8000) }] } };
    if (opts.tipo) payload.taskType = opts.tipo;
    if (dims) payload.outputDimensionality = dims;
    var ultErro = '';
    for (var t = 0; t < tents.length; t++) {
      var cool = 'emb429_' + String(tents[t].key).slice(-8);
      try { if (cache && cache.get(cool)) { ultErro = ultErro || 'embedding: chave em cooldown de cota'; continue; } } catch (eCg) {}
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':embedContent?key=' + encodeURIComponent(tents[t].key);
      var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
      var code = res.getResponseCode();
      if (code === 200) {
        var data = JSON.parse(res.getContentText() || '{}');
        var vec = (data.embedding && data.embedding.values) || [];
        if (ck && vec.length) { try { cache.put(ck, JSON.stringify(vec), 21600); } catch (eP) {} }
        return vec;
      }
      var msg = res.getContentText();
      try { var j = JSON.parse(msg); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
      ultErro = 'embedContent HTTP ' + code + ': ' + String(msg).substring(0, 160);
      if (code === 429 || /quota|RESOURCE_EXHAUSTED|exceeded|spending cap/i.test(msg)) {
        try { if (cache) cache.put(cool, '1', 600); } catch (eW) {}  // 10 min de cooldown p/ esta chave
      } else if (code === 400 || code === 404) { break; } // modelo/chamada inválida → não adianta rotacionar
    }
    throw new Error(ultErro || 'embedContent falhou em todas as chaves.');
  }

  /**
   * MODO RESERVA multi-cloud (porta do Antigravity): gera TEXTO (sem ferramentas) via
   * Anthropic → NVIDIA quando o Gemini está fora (429/teto de gasto). Mantém o Jarvis
   * conversando mesmo com a cota estourada. Configure ANTHROPIC_API_KEY e/ou NVIDIA_API_KEY.
   * @return {string|null} texto da resposta, ou null se nenhum provedor reserva disponível/funcionou.
   */
  // Marca qual provedor de reserva atendeu (p/ o card "Provedores" do Dashboard — Q5).
  function _marcarReserva(quem) { try { CacheService.getScriptCache().put('ULTIMO_RESERVA', quem, 3600); } catch (e) {} }

  function gerarTextoFallback(system, user, historico) {
    var anKey = (_p('ANTHROPIC_API_KEY') || '').trim();
    var orKey = (_p('OPENROUTER_API_KEY') || '').trim();
    var nvKey = (_p('NVIDIA_API_KEY') || '').trim();
    var miKey = (_p('MISTRAL_API_KEY') || '').trim();
    var gqKey = (_p('GROQ_API_KEY') || '').trim();
    var cbKey = (_p('CEREBRAS_API_KEY') || '').trim();
    if (!anKey && !orKey && !nvKey && !miKey && !gqKey && !cbKey) return null;
    var msgs = [];
    (historico || []).slice(-8).forEach(function (m) {
      if (!m || !m.text) return;
      msgs.push({ role: (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user', content: String(m.text).substring(0, 2000) });
    });
    msgs.push({ role: 'user', content: String(user || '') });

    // Helper p/ provedores OpenAI-compatible (Mistral/Groq/Cerebras/NVIDIA): tenta cada modelo,
    // retorna o 1º texto não-vazio ou null. Q1 · free stacking (edenai: roteia entre free tiers).
    function _oaiChat(rotulo, url, key, modelos, headers) {
      for (var i = 0; i < modelos.length; i++) {
        try {
          var resp = UrlFetchApp.fetch(url, {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: headers,
            payload: JSON.stringify({ model: modelos[i], max_tokens: 1024, messages: [{ role: 'system', content: String(system || '') }].concat(msgs) })
          });
          if (resp.getResponseCode() === 200) {
            var txt = (((JSON.parse(resp.getContentText() || '{}').choices || [])[0] || {}).message || {}).content || '';
            if (txt.trim()) { _marcarReserva(rotulo + ':' + modelos[i]); return txt.trim(); }
          } else {
            Logger.log('[Reserva] ' + rotulo + ' ' + modelos[i] + ' HTTP ' + resp.getResponseCode() + ': ' + String(resp.getContentText()).substring(0, 120));
          }
        } catch (e) { Logger.log('[Reserva] ' + rotulo + ' erro: ' + e.message); }
      }
      return null;
    }

    // ── 0. FREE STACKING (maior cota grátis primeiro) — Mistral (~86k/dia) → Groq → Cerebras ──
    if (miKey) {
      var mi = _oaiChat('Mistral', 'https://api.mistral.ai/v1/chat/completions', miKey,
        [(_p('MISTRAL_MODEL') || 'mistral-small-latest'), 'open-mistral-nemo', 'mistral-large-latest'],
        { Authorization: 'Bearer ' + miKey });
      if (mi) return mi;
    }
    if (gqKey) {
      var gq = _oaiChat('Groq', 'https://api.groq.com/openai/v1/chat/completions', gqKey,
        [(_p('GROQ_MODEL') || 'llama-3.3-70b-versatile'), 'llama-3.1-8b-instant'],
        { Authorization: 'Bearer ' + gqKey });
      if (gq) return gq;
    }
    if (cbKey) {
      var cb = _oaiChat('Cerebras', 'https://api.cerebras.ai/v1/chat/completions', cbKey,
        [(_p('CEREBRAS_MODEL') || 'llama-3.3-70b'), 'llama3.1-8b'],
        { Authorization: 'Bearer ' + cbKey });
      if (cb) return cb;
    }
    // ── 1. ANTHROPIC ──
    if (anKey) {
      var modelos = [(_p('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001'), 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'];
      for (var i = 0; i < modelos.length; i++) {
        try {
          var anResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { 'x-api-key': anKey, 'anthropic-version': '2023-06-01' },
            payload: JSON.stringify({ model: modelos[i], max_tokens: 1024, system: String(system || ''), messages: msgs })
          });
          if (anResp.getResponseCode() === 200) {
            var anData = JSON.parse(anResp.getContentText() || '{}');
            var anTxt = ((anData.content || [])[0] || {}).text || '';
            if (anTxt.trim()) { _marcarReserva('Anthropic:' + modelos[i]); return anTxt.trim(); }
          } else {
            Logger.log('[Reserva] Anthropic ' + modelos[i] + ' HTTP ' + anResp.getResponseCode());
          }
        } catch (eA) { Logger.log('[Reserva] Anthropic erro: ' + eA.message); }
      }
    }
    // ── 2. OPENROUTER (free tier) — descobre os modelos :free DINAMICAMENTE (os ids giram
    //     com o tempo; lista fixa apodrece). Cache de 6h; estáticos só como última linha. ──
    if (orKey) {
      var orModelos = [];
      var orPref = (_p('OPENROUTER_MODEL') || '').trim();
      if (orPref) orModelos.push(orPref);
      try {
        var orCache = CacheService.getScriptCache();
        var livres = [];
        var cachedOR = orCache.get('OR_FREE_MODELS');
        if (cachedOR) {
          livres = JSON.parse(cachedOR);
        } else {
          var lst = UrlFetchApp.fetch('https://openrouter.ai/api/v1/models', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + orKey } });
          if (lst.getResponseCode() === 200) {
            var prio = function (id) { return /gemma/i.test(id) ? 0 : /llama/i.test(id) ? 1 : /deepseek|qwen|mistral/i.test(id) ? 2 : /nemotron/i.test(id) ? 3 : 4; };
            livres = (JSON.parse(lst.getContentText()).data || [])
              .map(function (m) { return m.id; })
              .filter(function (id) { return /:free$/.test(String(id)) && !/embed|guard|vision-only/i.test(String(id)); })
              .sort(function (a, b) { return prio(a) - prio(b); })
              .slice(0, 8);
            orCache.put('OR_FREE_MODELS', JSON.stringify(livres), 21600);
          }
        }
        orModelos = orModelos.concat(livres);
      } catch (eL) { Logger.log('[Reserva] OpenRouter listagem de modelos falhou: ' + eL.message); }
      // Última linha estática (id confirmado em jun/2026 + antigos, caso a listagem falhe).
      orModelos = orModelos.concat(['nvidia/nemotron-nano-9b-v2:free', 'google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free']);
      var _orVistos = {};
      orModelos = orModelos.filter(function (id) { if (!id || _orVistos[id]) return false; _orVistos[id] = 1; return true; }).slice(0, 6);
      for (var j = 0; j < orModelos.length; j++) {
        try {
          var orResp = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + orKey, 'X-Title': 'Jarvis AI Personal OS' },
            payload: JSON.stringify({
              model: orModelos[j], max_tokens: 1024,
              messages: [{ role: 'system', content: String(system || '') }].concat(msgs)
            })
          });
          if (orResp.getResponseCode() === 200) {
            var orData = JSON.parse(orResp.getContentText() || '{}');
            var orTxt = (((orData.choices || [])[0] || {}).message || {}).content || '';
            if (orTxt.trim()) { _marcarReserva('OpenRouter:' + orModelos[j]); return orTxt.trim(); }
          } else {
            Logger.log('[Reserva] OpenRouter ' + orModelos[j] + ' HTTP ' + orResp.getResponseCode() + ': ' + String(orResp.getContentText()).substring(0, 120));
          }
        } catch (eO) { Logger.log('[Reserva] OpenRouter erro: ' + eO.message); }
      }
    }
    // ── 3. NVIDIA (último recurso) ──
    if (nvKey) {
      try {
        var nvResp = UrlFetchApp.fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + nvKey },
          payload: JSON.stringify({
            model: _p('NVIDIA_MODEL') || 'meta/llama-3.3-70b-instruct',
            max_tokens: 1024,
            messages: [{ role: 'system', content: String(system || '') }].concat(msgs)
          })
        });
        if (nvResp.getResponseCode() === 200) {
          var nvData = JSON.parse(nvResp.getContentText() || '{}');
          var nvTxt = (((nvData.choices || [])[0] || {}).message || {}).content || '';
          if (nvTxt.trim()) { _marcarReserva('NVIDIA:' + (_p('NVIDIA_MODEL') || 'meta/llama-3.3-70b-instruct')); return nvTxt.trim(); }
        } else {
          Logger.log('[Reserva] NVIDIA HTTP ' + nvResp.getResponseCode());
        }
      } catch (eN) { Logger.log('[Reserva] NVIDIA erro: ' + eN.message); }
    }
    return null;
  }

  return { gerar: gerar, temChave: temChave, gerarImagem: gerarImagem, pesquisarWeb: pesquisarWeb, lerUrl: lerUrl, embeddar: embeddar, gerarTextoFallback: gerarTextoFallback };
})();

/** Diagnóstico do MODO RESERVA: testa os provedores alternativos (Anthropic/OpenRouter/NVIDIA). Rode no editor. */
function testarModoReserva() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('Chaves reserva — Mistral: ' + (p.getProperty('MISTRAL_API_KEY') ? 'OK' : '—') +
    ' · Groq: ' + (p.getProperty('GROQ_API_KEY') ? 'OK' : '—') +
    ' · Cerebras: ' + (p.getProperty('CEREBRAS_API_KEY') ? 'OK' : '—') +
    ' · OpenRouter: ' + (p.getProperty('OPENROUTER_API_KEY') ? 'OK' : '—') +
    ' · Anthropic: ' + (p.getProperty('ANTHROPIC_API_KEY') ? 'OK' : '—') +
    ' · NVIDIA: ' + (p.getProperty('NVIDIA_API_KEY') ? 'OK' : '—'));
  var t0 = Date.now();
  var txt = Gemini.gerarTextoFallback('Você é o JARVIS em modo reserva. Responda em 1 frase, em português.', 'Diga "modo reserva operacional" e qual modelo você é.', []);
  if (txt) Logger.log('✅ MODO RESERVA OK (' + ((Date.now() - t0) / 1000).toFixed(1) + 's): ' + txt.substring(0, 300));
  else Logger.log('❌ Nenhum provedor reserva respondeu — confira as chaves e os logs [Reserva] acima.');
  return txt;
}

/**
 * Setup das chaves do MODO RESERVA (free stacking). Passe só as que tiver; as omitidas não mudam.
 * Ex.: configurarReservaFree({ mistral: 'xxx', groq: 'yyy' }). Cota é por provedor — empilhar amplia.
 */
function configurarReservaFree(chaves) {
  chaves = chaves || {};
  var p = PropertiesService.getScriptProperties();
  var mapa = { mistral: 'MISTRAL_API_KEY', groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY', nvidia: 'NVIDIA_API_KEY' };
  var setados = [];
  Object.keys(mapa).forEach(function (k) {
    if (chaves[k]) { p.setProperty(mapa[k], String(chaves[k]).trim()); setados.push(mapa[k]); }
  });
  Logger.log(setados.length ? ('✅ Definidas: ' + setados.join(', ')) : 'Nada definido — passe um objeto { mistral, groq, cerebras, ... }.');
  Logger.log('Rode testarModoReserva() para validar.');
  return setados;
}

/** Config padrão de modelos. */
function configurarModelosGemini() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GEMINI_MODEL', 'gemini-2.5-flash');
  p.setProperty('GEMINI_MODEL_FALLBACK', 'gemini-2.5-flash-lite');
  p.setProperty('GEMINI_ORDER', 'billing_first');
  Logger.log('✅ Modelos: gemini-2.5-flash → gemini-2.5-flash-lite (billing_first).');
}

/** MODO ROBUSTO: gemini-2.5-flash como primário — function calling confiável (use para a demo). */
function usarModeloRobusto() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GEMINI_MODEL', 'gemini-2.5-flash');
  p.setProperty('GEMINI_MODEL_FALLBACK', 'gemini-2.5-flash-lite');
  Logger.log('✅ Modo ROBUSTO ativo: gemini-2.5-flash (primário) → flash-lite (reserva). Mais confiável (~+10s).');
}

/** GEMINI 3 (Pro/AI Pro): gemini-3-flash-preview como primário, 2.5-flash como reserva automática.
 *  O loop FC já devolve as `parts` do modelo verbatim (Jarvis.js ~2213), preservando o
 *  thoughtSignature que o Gemini 3 (pensante) exige no multi-turn de function-calling.
 *  Se a chave ainda não tiver acesso ao 3, a cascata cai sozinha para o 2.5-flash. */
function usarGemini3() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GEMINI_MODEL', 'gemini-3-flash-preview');
  p.setProperty('GEMINI_MODEL_FALLBACK', 'gemini-2.5-flash');
  p.setProperty('GEMINI_ORDER', 'billing_first');
  Logger.log('✅ Gemini 3 ativo: gemini-3-flash-preview → gemini-2.5-flash (fallback). Rode rodarQA() para validar o loop FC ao vivo.');
  return { GEMINI_MODEL: 'gemini-3-flash-preview', GEMINI_MODEL_FALLBACK: 'gemini-2.5-flash' };
}

/** MODO RÁPIDO: gemini-2.5-flash-lite como primário — mais veloz, porém menos confiável em FC. */
function usarModeloRapido() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GEMINI_MODEL', 'gemini-2.5-flash-lite');
  p.setProperty('GEMINI_MODEL_FALLBACK', 'gemini-2.5-flash');
  Logger.log('✅ Modo RÁPIDO ativo: gemini-2.5-flash-lite (primário) → 2.5-flash (reserva).');
}

/** Diagnóstico do URL context: lê uma URL pública via Gemini.lerUrl e devolve uma amostra. */
function testarUrlContext(args) {
  args = args || {};
  var url = String(args.url || 'https://pt.wikipedia.org/wiki/Google_Apps_Script');
  try {
    var r = Gemini.lerUrl(url, args.instrucao || 'Resuma em 1-2 frases o que é esta página.');
    return { ok: true, url: url, texto: String(r.texto || '').substring(0, 6000), fontes: r.fontes || [] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Diagnóstico COMPLETO: mostra as propriedades reais + os modelos que serão tentados + teste ao vivo. */
function diagGemini() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('BUILD = ' + GEMINI_BUILD);
  try { Logger.log('scriptId = ' + ScriptApp.getScriptId()); } catch (e) {}
  Logger.log('GEMINI_MODEL = ' + JSON.stringify(p.getProperty('GEMINI_MODEL')));
  Logger.log('GEMINI_MODEL_FALLBACK = ' + JSON.stringify(p.getProperty('GEMINI_MODEL_FALLBACK')));
  Logger.log('GEMINI_ORDER = ' + JSON.stringify(p.getProperty('GEMINI_ORDER')));
  Logger.log('GEMINI_API_KEY presente? ' + !!p.getProperty('GEMINI_API_KEY'));
  Logger.log('GEMINI_API_KEY_FALLBACK presente? ' + !!p.getProperty('GEMINI_API_KEY_FALLBACK'));
  try {
    var r = Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: 'responda apenas: ok' }] }], generationConfig: { maxOutputTokens: 5 } });
    Logger.log('✅ Teste ao vivo OK via ' + r.tier + '/' + r.model);
  } catch (e) { Logger.log('❌ Teste ao vivo FALHOU: ' + e.message); }
}

/** Diagnóstico: testa as duas chaves com uma chamada mínima. Rode no editor. */
function testarChavesGemini() {
  var alvo = { contents: [{ role: 'user', parts: [{ text: 'responda apenas: ok' }] }], generationConfig: { maxOutputTokens: 5 } };
  try {
    var r = Gemini.gerar(alvo);
    Logger.log('✅ Gemini respondeu via ' + r.tier + ' (' + r.model + ').');
  } catch (e) {
    Logger.log('❌ ' + e.message);
  }
}
