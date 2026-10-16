/**
 * Laboratorio — o "Playground" do Web App (estilo Google AI Studio) e a galeria de Automações (16/10).
 *
 * LABORATÓRIO: o dono escolhe modelo, instrução de sistema, temperatura, nível de raciocínio, ferramentas nativas do Gemini (busca no Google, leitura de URL, execução
 * de código) e saída em JSON com esquema, roda o pedido (e, se quiser, em dois modelos lado a lado) e vê texto, fontes, tokens, tempo e custo estimado.
 * É um terreno de teste, NÃO um agente: não chama nenhuma ferramenta do Jarvis (e-mail, agenda, celular, caderneta), então nada aqui age sobre a vida dele.
 * Guardas de custo: só modelos permitidos (os configurados + LAB_MODELOS_EXTRA; modelos "pro" ficam de fora de propósito), teto de tokens de saída, limite de
 * execuções por hora, recusa quando o teto de gasto do mês está perto, e tudo entra no GastoIA como qualquer outra chamada.
 *
 * AUTOMAÇÕES: uma galeria de fluxos. As "prontas" são relatórios do código (sem IA); as do dono são pedidos ao chat do Jarvis ou configurações do Laboratório,
 * guardadas na coleção `automacoes` do Firestore. Executar = rodar o pedido; duplicar = copiar para editar.
 */
var Laboratorio = (function () {
  'use strict';

  var LIM = { prompt: 8000, sistema: 4000, schema: 4000, maxTokens: 4096, porHora: 40, pctTeto: 92, automacoes: 40, nome: 60, desc: 200, texto: 4000 };
  var PENSAMENTO = { padrao: null, baixo: 'low', alto: 'high' };

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }

  /** Modelos que o Laboratório aceita: os que o Jarvis já usa + LAB_MODELOS_EXTRA (lista separada por vírgula). Embedding, voz e imagem ficam de fora (não geram texto). */
  function modelosPermitidos() {
    var l = [_p('GEMINI_MODEL'), _p('GEMINI_MODEL_FALLBACK'), _p('GEMINI_SEARCH_MODEL')].concat(String(_p('LAB_MODELOS_EXTRA') || '').split(','));
    var vistos = {}, out = [];
    l.forEach(function (m) { m = String(m || '').trim(); if (m && /^gemini-[a-z0-9.\-]+$/.test(m) && !/embedding|tts|image|live/.test(m) && !vistos[m]) { vistos[m] = 1; out.push(m); } });
    return out;
  }

  /** Valida o pedido do Laboratório e monta o corpo do generateContent. PURA. → {ok:false, erro} | {ok:true, modelo, payload, json:bool} */
  function montar(req, permitidos) {
    req = req || {};
    var modelo = String(req.modelo || '').trim();
    if (!modelo || (permitidos || []).indexOf(modelo) === -1) return { ok: false, erro: 'Modelo não permitido no Laboratório: "' + modelo + '".' };
    var prompt = String(req.prompt || '').trim();
    if (!prompt) return { ok: false, erro: 'Escreva um pedido.' };
    if (prompt.length > LIM.prompt) return { ok: false, erro: 'O pedido passa de ' + LIM.prompt + ' caracteres.' };
    var sistema = String(req.sistema || '').trim();
    if (sistema.length > LIM.sistema) return { ok: false, erro: 'A instrução de sistema passa de ' + LIM.sistema + ' caracteres.' };
    var temp = req.temperatura === undefined || req.temperatura === null || req.temperatura === '' ? 1 : Number(req.temperatura);
    if (!isFinite(temp) || temp < 0 || temp > 2) return { ok: false, erro: 'Temperatura deve ficar entre 0 e 2.' };
    var maxTok = Math.max(64, Math.min(LIM.maxTokens, Math.round(Number(req.maxTokens) || 1024)));
    var f = req.ferramentas || {}, tools = [];
    if (f.busca) tools.push({ google_search: {} });
    if (f.url) tools.push({ url_context: {} });
    if (f.codigo) tools.push({ code_execution: {} });
    var cfg = { temperature: Math.round(temp * 10) / 10, maxOutputTokens: maxTok };
    var json = !!req.json;
    if (json) {
      if (tools.length) return { ok: false, erro: 'Saída em JSON não combina com ferramentas neste Laboratório: desligue uma das duas.' };
      cfg.responseMimeType = 'application/json';
      var sc = String(req.schema || '').trim();
      if (sc) {
        if (sc.length > LIM.schema) return { ok: false, erro: 'O esquema passa de ' + LIM.schema + ' caracteres.' };
        try { var o = JSON.parse(sc); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('x'); cfg.responseJsonSchema = o; }
        catch (e) { return { ok: false, erro: 'O esquema JSON não é um objeto JSON válido.' }; }
      }
    }
    var payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg };
    if (sistema) payload.systemInstruction = { parts: [{ text: sistema }] };
    if (tools.length) payload.tools = tools;
    var pe = PENSAMENTO[String(req.pensamento || 'padrao')];
    if (pe) payload._thinking = pe;
    return { ok: true, modelo: modelo, payload: payload, json: json };
  }

  /** Resposta do generateContent → resultado para a tela. PURA (o custo entra por `custoBRL`, calculado fora). */
  function interpretar(data, extra) {
    extra = extra || {};
    data = data || {};
    var cand = (data.candidates && data.candidates[0]) || {}, partes = [], texto = [];
    ((cand.content && cand.content.parts) || []).forEach(function (p) {
      if (p.thought) return;
      if (typeof p.text === 'string' && p.text) { partes.push({ t: 'texto', v: p.text }); texto.push(p.text); }
      else if (p.executableCode) partes.push({ t: 'codigo', lang: String(p.executableCode.language || 'python').toLowerCase(), v: String(p.executableCode.code || '') });
      else if (p.codeExecutionResult) partes.push({ t: 'resultado', ok: /OK/i.test(String(p.codeExecutionResult.outcome || '')), v: String(p.codeExecutionResult.output || '') });
    });
    var gm = cand.groundingMetadata || {}, fontes = [];
    (gm.groundingChunks || []).forEach(function (c) { if (c.web && c.web.uri) fontes.push({ titulo: c.web.title || c.web.uri, url: c.web.uri }); });
    var urls = [];
    ((cand.urlContextMetadata && cand.urlContextMetadata.urlMetadata) || []).forEach(function (u) { if (u.retrievedUrl) urls.push({ url: u.retrievedUrl, status: String(u.urlRetrievalStatus || '').replace('URL_RETRIEVAL_STATUS_', '').toLowerCase() }); });
    var u = data.usageMetadata || {}, txt = texto.join('');
    var r = { ok: true, partes: partes, texto: txt, fontes: fontes.slice(0, 8), buscas: (gm.webSearchQueries || []).slice(0, 6), urls: urls.slice(0, 6), fim: cand.finishReason || null,
              uso: { entrada: Number(u.promptTokenCount) || 0, saida: Number(u.candidatesTokenCount) || 0, pensamento: Number(u.thoughtsTokenCount) || 0 },
              modelo: extra.modelo || null, tier: extra.tier || null, ms: extra.ms || 0, custoBRL: extra.custoBRL != null ? extra.custoBRL : null };
    if (extra.json) { try { JSON.parse(txt); r.jsonValido = true; } catch (e) { r.jsonValido = false; } }
    if (!partes.length) { r.ok = false; r.erro = cand.finishReason === 'SAFETY' ? 'A resposta foi bloqueada pelo filtro de segurança.' : 'O modelo não devolveu texto' + (cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.'; }
    return r;
  }

  function _limitePorHora() {
    try {
      var c = CacheService.getScriptCache(), k = 'lab_rl_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMddHH'), n = Number(c.get(k) || 0);
      if (n >= LIM.porHora) return false;
      c.put(k, String(n + 1), 3700); return true;
    } catch (e) { return true; }
  }

  /** Executa UM pedido. Nunca lança: devolve {ok:false, erro}. */
  function executar(req) {
    try {
      var m = montar(req, modelosPermitidos());
      if (!m.ok) return m;
      if (typeof GastoIA !== 'undefined') {
        var est = GastoIA.estado();
        if (est.esgotado || Number(est.pct) >= LIM.pctTeto) return { ok: false, erro: 'O gasto do mês está em ' + est.pct + '% do teto: o Laboratório fica parado até o mês virar ou o teto subir.' };
      }
      if (!_limitePorHora()) return { ok: false, erro: 'Limite de ' + LIM.porHora + ' execuções por hora no Laboratório. Tente daqui a pouco.' };
      var t0 = Date.now(), g = Gemini.gerarComModelo(m.payload, m.modelo), ms = Date.now() - t0, custo = null;
      try { custo = Math.round(GastoIA.custoUSD(g.model, g.data.usageMetadata) * GastoIA.cambio() * 10000) / 10000; } catch (e) {}
      return interpretar(g.data, { modelo: g.model, tier: g.tier, ms: ms, custoBRL: custo, json: m.json });
    } catch (e) { return { ok: false, erro: String(e && e.message || e).slice(0, 300) }; }
  }

  // ── AUTOMAÇÕES ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var COL = 'automacoes';
  /** Prontas: relatórios do código (sem IA) que o chat responde direto. O texto é o que vai ao chat, igual aos botões antigos. */
  var BASE = [
    { id: 'base-investimentos', nome: 'Relatório de investimentos', icone: '📈', grupo: 'Finanças', tipo: 'chat', texto: 'Execute a automação: Relatório de Investimentos', semIA: true,
      desc: 'Todas as aplicações da caderneta: categoria × alvo, rendimento no ano, liquidez e pontos de atenção.' },
    { id: 'base-fiis', nome: 'FIIs com mercado', icone: '🏢', grupo: 'Finanças', tipo: 'chat', texto: 'Execute a automação: Relatório de FIIs', semIA: true,
      desc: 'Seus fundos imobiliários ao lado da cotação, P/VP e último rendimento do Funds Explorer, com fonte e hora.' },
    { id: 'base-cofrinhos', nome: 'Cofrinhos do Mercado Pago', icone: '🐷', grupo: 'Finanças', tipo: 'chat', texto: 'Execute a automação: Relatório de Cofrinhos', semIA: false,
      desc: 'Saldos dos cofrinhos e uma pesquisa na web com fontes sobre a taxa vigente (usa uma busca do Gemini).' },
    { id: 'base-mes', nome: 'Como foi o mês', icone: '🗓️', grupo: 'Finanças', tipo: 'chat', texto: 'Como foi o mês?', semIA: true,
      desc: 'Renda, saídas, sobra, aplicado e previsão do fim do mês, comparados com o mês anterior.' },
    { id: 'base-atividade', nome: 'Relatório de atividade', icone: '🧾', grupo: 'Sistema', tipo: 'chat', texto: 'Execute a automação: Relatório de Atividade', semIA: true,
      desc: 'O que o Jarvis fez nas últimas 24 h: falas por rota, ferramentas, JEV, lentos, falhas e gasto do Gemini.' },
    { id: 'base-agenda', nome: 'Meus próximos compromissos', icone: '📅', grupo: 'Dia a dia', tipo: 'chat', texto: 'Quais meus próximos compromissos?', semIA: false,
      desc: 'Consulta a agenda de verdade e responde (o Jarvis nunca inventa agenda).' },
    { id: 'base-emails', nome: 'Resumo dos e-mails não lidos', icone: '📧', grupo: 'Dia a dia', tipo: 'chat', texto: 'Resuma meus e-mails não lidos', semIA: false,
      desc: 'Lê a caixa de entrada e resume o que importa.' }
  ];

  function _slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'auto'; }

  /** Valida uma automação do dono. PURA. → {ok:false, erro} | {ok:true, a} */
  function validarAutomacao(a, permitidos) {
    a = a || {};
    var nome = String(a.nome || '').trim(), desc = String(a.desc || '').trim(), texto = String(a.texto || '').trim(), icone = String(a.icone || '⚡').trim().slice(0, 4) || '⚡';
    var tipo = a.tipo === 'lab' ? 'lab' : 'chat';
    if (!nome) return { ok: false, erro: 'Dê um nome à automação.' };
    if (nome.length > LIM.nome) return { ok: false, erro: 'O nome passa de ' + LIM.nome + ' caracteres.' };
    if (desc.length > LIM.desc) return { ok: false, erro: 'A descrição passa de ' + LIM.desc + ' caracteres.' };
    if (!texto) return { ok: false, erro: tipo === 'lab' ? 'Escreva o pedido do Laboratório.' : 'Escreva o que o Jarvis deve fazer.' };
    if (texto.length > LIM.texto) return { ok: false, erro: 'O texto passa de ' + LIM.texto + ' caracteres.' };
    var out = { nome: nome, desc: desc, icone: icone, tipo: tipo, texto: texto };
    if (tipo === 'lab') {
      var c = a.config || {}, m = montar({ modelo: c.modelo, prompt: texto, sistema: c.sistema, temperatura: c.temperatura, pensamento: c.pensamento, maxTokens: c.maxTokens, ferramentas: c.ferramentas, json: c.json, schema: c.schema }, permitidos);
      if (!m.ok) return { ok: false, erro: m.erro };
      out.config = { modelo: c.modelo, sistema: String(c.sistema || '').trim(), temperatura: Number(c.temperatura === undefined || c.temperatura === '' ? 1 : c.temperatura), pensamento: String(c.pensamento || 'padrao'), maxTokens: Number(c.maxTokens) || 1024,
                     ferramentas: { busca: !!(c.ferramentas || {}).busca, url: !!(c.ferramentas || {}).url, codigo: !!(c.ferramentas || {}).codigo }, json: !!c.json, schema: String(c.schema || '').trim() };
    }
    return { ok: true, a: out };
  }

  function listarAutomacoes() {
    var custom = [];
    try { custom = (Firestore.listDocs(COL, 80) || []).map(function (d) { var o = d.dados || d; o.id = d.id; return o; }); } catch (e) { custom = []; }
    custom.sort(function (a, b) { return (Number(b.atualizadoEm) || 0) - (Number(a.atualizadoEm) || 0); });
    return { base: BASE.map(function (b) { var o = {}; for (var k in b) o[k] = b[k]; return o; }), minhas: custom.map(function (c) { return { id: c.id, nome: c.nome, desc: c.desc || '', icone: c.icone || '⚡', tipo: c.tipo === 'lab' ? 'lab' : 'chat', texto: c.texto || '', config: c.config || null, atualizadoEm: c.atualizadoEm || 0 }; }) };
  }

  /** Cria (sem id) ou atualiza (id existente) uma automação do dono. */
  function salvarAutomacao(a) {
    var v = validarAutomacao(a, modelosPermitidos());
    if (!v.ok) return v;
    var id = String((a && a.id) || '');
    var existentes = [];
    try { existentes = Firestore.listDocs(COL, 80) || []; } catch (e) {}
    if (id) { if (!/^[a-z0-9-]{3,40}$/.test(id) || /^base-/.test(id)) return { ok: false, erro: 'Automação inválida.' }; if (!existentes.some(function (d) { return d.id === id; })) return { ok: false, erro: 'Automação não encontrada.' }; }
    else {
      if (existentes.length >= LIM.automacoes) return { ok: false, erro: 'Limite de ' + LIM.automacoes + ' automações. Exclua alguma antes de criar outra.' };
      id = _slug(v.a.nome) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    }
    v.a.atualizadoEm = Date.now();
    try { Firestore.setDoc(COL, id, v.a); } catch (e2) { return { ok: false, erro: 'Não consegui salvar agora.' }; }
    v.a.id = id;
    return { ok: true, automacao: v.a };
  }

  function excluirAutomacao(id) {
    id = String(id || '');
    if (!/^[a-z0-9-]{3,40}$/.test(id) || /^base-/.test(id)) return { ok: false, erro: 'Só as suas automações podem ser excluídas.' };
    try { Firestore.deleteDoc(COL, id); return { ok: true }; } catch (e) { return { ok: false, erro: 'Não consegui excluir agora.' }; }
  }

  function config() {
    var perm = modelosPermitidos();
    return { ok: true, modelos: perm, padrao: _p('GEMINI_MODEL') || perm[0] || null, limites: { prompt: LIM.prompt, sistema: LIM.sistema, maxTokens: LIM.maxTokens, porHora: LIM.porHora } };
  }

  return { modelosPermitidos: modelosPermitidos, montar: montar, interpretar: interpretar, executar: executar, config: config, validarAutomacao: validarAutomacao,
           listarAutomacoes: listarAutomacoes, salvarAutomacao: salvarAutomacao, excluirAutomacao: excluirAutomacao, BASE: BASE, LIM: LIM };
})();
