// ===================================================================================
// Semantica.js — Busca SEMÂNTICA na wiki (RAG com embeddings). P5.1.
// Indexa os trechos das páginas .md do wiki como VETORES (Gemini text-embedding-004),
// guarda no Firestore ('wiki_vetores') e busca por SIMILARIDADE DE COSSENO — encontra por
// SIGNIFICADO (não só palavra-chave), corrigindo a fraqueza do buscarNoWiki atual.
// Indexação é RESUMÍVEL (pula arquivos já indexados) e cabe no orçamento de tempo do GAS.
// ===================================================================================

var Semantica = (function () {
  'use strict';
  var COL = 'wiki_vetores';

  function _p(k) { return PropertiesService.getScriptProperties().getProperty(k); }

  // hash estável p/ compor ids de documento determinísticos por caminho.
  function _hash(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'v' + (h >>> 0).toString(36);
  }

  // Quebra o texto em trechos de ~tam chars, respeitando parágrafos.
  function _chunks(texto, tam) {
    tam = tam || 900;
    var paras = String(texto || '').replace(/\r/g, '').split(/\n{2,}/);
    var out = [], buf = '';
    paras.forEach(function (p) {
      p = p.trim(); if (!p) return;
      if (buf && (buf.length + 2 + p.length) > tam) { out.push(buf); buf = p; }
      else { buf = buf ? (buf + '\n\n' + p) : p; }
    });
    if (buf) out.push(buf);
    return out.filter(function (c) { return c.length > 20; });
  }

  function _cosseno(a, b) {
    a = a || []; b = b || [];
    var n = Math.min(a.length, b.length), dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // Lista recursivamente os arquivos .md do wiki (pula a pasta raw/ E os meta-arquivos).
  // Meta-arquivos (manual/índice/registro) NÃO são conhecimento — indexá-los polui a busca.
  // @return [{id, caminho}].
  function _arquivosWiki() {
    var rootId = _p('WIKI_DRIVE_ID');
    if (!rootId) throw new Error('WIKI_DRIVE_ID ausente. Rode configurarBaseConhecimento(...).');
    var lista = [];
    (function walk(folder, prefixo) {
      var fs = folder.getFiles();
      while (fs.hasNext()) { var f = fs.next(); var nm = f.getName(); if (/\.md$/i.test(nm) && !ehMetaArquivoWiki(nm)) lista.push({ id: f.getId(), caminho: prefixo + nm }); }
      var subs = folder.getFolders();
      while (subs.hasNext()) { var sf = subs.next(); if (/^raw$/i.test(sf.getName())) continue; walk(sf, prefixo + sf.getName() + '/'); }
    })(DriveApp.getFolderById(rootId), '');
    return lista;
  }

  /**
   * Indexa o wiki em vetores. RESUMÍVEL: pula arquivos já indexados (a menos de opts.forcar).
   * @param {Object} [opts] { budgetMs, forcar, maxChunks }
   * @return {Object} { status:'success'|'continuar', arquivos, trechos, pulados, restantes }
   */
  function indexar(opts) {
    opts = opts || {};
    var inicio = Date.now();
    var budget = opts.budgetMs || (4 * 60 * 1000);
    var maxChunks = opts.maxChunks || 50;
    var arquivos = _arquivosWiki();
    var feitos = 0, trechos = 0, pulados = 0, erro1 = '';
    for (var i = 0; i < arquivos.length; i++) {
      if (Date.now() - inicio > budget) {
        return { status: 'continuar', arquivos: feitos, trechos: trechos, pulados: pulados, restantes: arquivos.length - i, erro1: erro1 };
      }
      var a = arquivos[i];
      var base = _hash(a.caminho);
      if (!opts.forcar) {
        try { if (Firestore.getDoc(COL, base + '_0')) { pulados++; continue; } } catch (e) {}
      }
      var texto = '';
      try { texto = DriveApp.getFileById(a.id).getBlob().getDataAsString('UTF-8'); } catch (e) { continue; }
      var cs = _chunks(texto);
      for (var j = 0; j < cs.length && j < maxChunks; j++) {
        try {
          var vec = Gemini.embeddar(cs[j], { tipo: 'RETRIEVAL_DOCUMENT' });
          if (vec && vec.length) {
            // vetor como STRING JSON compacta (parse muito mais rápido que array Firestore verboso).
            Firestore.setDoc(COL, base + '_' + j, { caminho: a.caminho, ord: j, trecho: cs[j].substring(0, 1500), vetor: JSON.stringify(vec), atualizadoEm: Date.now() });
            trechos++;
          } else if (!erro1) { erro1 = 'embeddar retornou vetor vazio'; }
        } catch (e) {
          var msg = String(e && e.message || e);
          if (!erro1) erro1 = msg;
          // Aborta JÁ em erros fatais (quota/teto de gasto) — não adianta seguir martelando a API.
          if (/\b429\b|spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
            return { status: 'abortado', motivo: 'quota/limite de gasto', erro1: msg, arquivos: feitos, trechos: trechos, pulados: pulados };
          }
        }
      }
      feitos++;
    }
    return { status: 'success', arquivos: feitos, trechos: trechos, pulados: pulados, erro1: erro1 };
  }

  // Decodifica o vetor armazenado: string JSON compacta (novo) OU array Firestore (legado).
  function _vetorDe(v) {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return []; } }
    return v || [];
  }

  /** Busca semântica: embeda a consulta e retorna os top-k trechos por cosseno. Resultado cacheado. */
  function buscar(consulta, k) {
    k = k || 5;
    var cache = CacheService.getScriptCache();
    var ck = 'sem_res_' + _hash(String(consulta) + '|' + k);
    try { var hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (eC) {}
    var docs = Firestore.listDocs(COL, 1000);
    if (!docs.length) return [];
    var qv = Gemini.embeddar(consulta, { tipo: 'RETRIEVAL_QUERY' });
    // VAR-1: cache semântico por SIMILARIDADE — se já respondemos uma consulta parecida (cosseno
    // alto entre os embeddings da query), reusa o resultado e pula o escaneamento de TODOS os docs.
    var sim = _simCacheGet(qv, k);
    if (sim) { try { cache.put(ck, JSON.stringify(sim), 1800); } catch (e1) {} return sim; }
    var scored = docs.map(function (d) {
      return { caminho: d.dados.caminho, trecho: d.dados.trecho, score: _cosseno(qv, _vetorDe(d.dados.vetor)) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored.slice(0, k);
    try { cache.put(ck, JSON.stringify(top), 1800); } catch (eP) {}
    _simCachePut(qv, k, top);
    return top;
  }

  // VAR-1 · cache semântico por similaridade (lista curta de {emb arredondado, k, top} no CacheService).
  var _SIM_KEY = 'sem_simcache', _SIM_THRESHOLD = 0.93, _SIM_MAX = 8;
  function _arred(v) { return (v || []).map(function (x) { return Math.round(x * 1e4) / 1e4; }); } // 4 casas → cabe no cache
  function _simCacheGet(qv, k) {
    try {
      var raw = CacheService.getScriptCache().get(_SIM_KEY); if (!raw) return null;
      var list = JSON.parse(raw), bestTop = null, bestS = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i].k !== k) continue;
        var s = _cosseno(qv, list[i].emb);
        if (s > bestS) { bestS = s; bestTop = list[i].top; }
      }
      return (bestTop && bestS >= _SIM_THRESHOLD) ? bestTop : null;
    } catch (e) { return null; }
  }
  function _simCachePut(qv, k, top) {
    try {
      var c = CacheService.getScriptCache(), raw = c.get(_SIM_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list.unshift({ emb: _arred(qv), k: k, top: top });
      if (list.length > _SIM_MAX) list = list.slice(0, _SIM_MAX);
      c.put(_SIM_KEY, JSON.stringify(list), 1800);
    } catch (e) {}
  }

  /** Conta os vetores indexados. */
  function status() {
    var docs = Firestore.listDocs(COL, 1000);
    var paginas = {};
    docs.forEach(function (d) { paginas[d.dados.caminho] = 1; });
    return { trechos: docs.length, paginas: Object.keys(paginas).length };
  }

  /** Limpa todo o índice (para reindexação completa). */
  function limpar() {
    var n = 0;
    Firestore.listDocs(COL, 1000).forEach(function (d) { try { Firestore.deleteDoc(COL, d.id); n++; } catch (e) {} });
    return n;
  }

  /** Purga cirúrgica: remove SÓ os vetores de meta-arquivos (manual/índice/log) já indexados,
   *  sem re-embedar nada (custo zero de cota). Corrige a poluição da busca em bases antigas. */
  function purgarMeta() {
    var n = 0;
    Firestore.listDocs(COL, 1000).forEach(function (d) {
      var cam = d.dados && d.dados.caminho;
      if (cam && ehMetaArquivoWiki(cam)) { try { Firestore.deleteDoc(COL, d.id); n++; } catch (e) {} }
    });
    return n;
  }

  /** Purga cirúrgica: remove os vetores ÓRFÃOS de skills descartadas (por nome de pasta na
   *  denylist), sem re-embedar nada (custo zero de cota). Casa por SEGMENTO do caminho, então
   *  pega em qualquer subpasta (ex.: 'skills/api-patterns/SKILL.md' e 'skills/api-patterns/references/x.md').
   *  @param {string[]} nomes  nomes de pasta a expurgar. */
  function purgarSkills(nomes) {
    var deny = {}; (nomes || []).forEach(function (x) { deny[String(x).toLowerCase()] = true; });
    var n = 0;
    Firestore.listDocs(COL, 5000).forEach(function (d) {
      var cam = d.dados && d.dados.caminho;
      if (!cam) return;
      var segs = String(cam).toLowerCase().split('/');
      for (var i = 0; i < segs.length; i++) {
        if (deny[segs[i]]) { try { Firestore.deleteDoc(COL, d.id); n++; } catch (e) {} break; }
      }
    });
    return n;
  }

  return { indexar: indexar, buscar: buscar, status: status, limpar: limpar, purgarMeta: purgarMeta, purgarSkills: purgarSkills };
})();

/**
 * META-arquivos do wiki: manual/índice/registro/arquitetura — NÃO são conhecimento pesquisável.
 * Indexá-los polui a busca (retorna o manual/log em vez do conteúdo real). Usado pela busca
 * SEMÂNTICA (Semantica) e pela de PALAVRA-CHAVE (WikiMemoryService). GLOBAL e PURA (testável).
 * Casa pelo BASENAME, em qualquer subpasta do wiki.
 */
function ehMetaArquivoWiki(nomeOuCaminho) {
  var b = String(nomeOuCaminho || '').toLowerCase().replace(/^.*\//, '');
  return /^(index|log|llm|system|readme|_estrutura|estrutura|architecture|arquitetura|_index|contributing|changelog)\.md$/.test(b);
}

/** Purga só os vetores de meta-arquivos do índice semântico (rode 1x após corrigir o wiki). */
function purgarMetaVetores() {
  var n = (typeof Semantica !== 'undefined' && Semantica.purgarMeta) ? Semantica.purgarMeta() : 0;
  Logger.log('[Semantica] purgarMetaVetores: ' + n + ' vetor(es) de meta-arquivo removido(s).');
  return n;
}

/**
 * MANUTENÇÃO (rode 1x): move as skills genéricas de "dev-pack" (importadas em massa, inertes no
 * runtime GAS — sem Python/Playwright/CLI) para a LIXEIRA do Drive (recuperável 30 dias), apaga os
 * vetores órfãos que elas deixaram no índice semântico (custo ZERO de cota, não re-embeda) e
 * registra a limpeza no log.md/index.md. Objetivo: o Jarvis parar de disputar o Top-8 e a busca RAG
 * com conhecimento que ele não usa (assistente pessoal, não IDE). Reversível: restaure da lixeira.
 */
function limparSkillsRuido(args) {
  // Casa pelo NOME DA PASTA (é o que o discoverSkills e o índice usam), não pelo 'name:' do frontmatter.
  // Ex.: a pasta 'nextjs-react-expert' contém um SKILL.md cujo frontmatter diz name: react-best-practices.
  var DENY = (args && args.nomes && args.nomes.length) ? args.nomes.map(String) : [
    'api-patterns', 'architecture', 'clean-code', 'database-design', 'frontend-design',
    'mobile-design', 'nodejs-best-practices', 'python-patterns', 'nextjs-react-expert', 'react-best-practices',
    'tailwind-patterns', 'web-design-guidelines', 'performance-profiling', 'testing-patterns',
    'webapp-testing', 'tdd-workflow', 'code-review-checklist', 'deployment-procedures',
    'lint-and-validate', 'app-builder', 'mcp-builder', 'bash-linux', 'powershell-windows',
    'parallel-agents', 'systematic-debugging'
  ];
  var deny = {}; DENY.forEach(function (n) { deny[n.toLowerCase()] = true; });

  // Varre a WIKI inteira (WIKI_DRIVE_ID) — cobre wiki/skills/<x> E pastas de conteúdo puro (agents/,
  // best-practices/workflows/). BASE_CONHECIMENTO_DRIVE_ID aponta só p/ skills/, não alcançaria agents/workflows.
  var props = PropertiesService.getScriptProperties();
  var rootId = (args && args.rootId) || props.getProperty('WIKI_DRIVE_ID') || props.getProperty('BASE_CONHECIMENTO_DRIVE_ID');
  if (!rootId) return { status: 'error', erro: 'WIKI_DRIVE_ID/BASE_CONHECIMENTO_DRIVE_ID ausente.' };

  // Por padrão só mexe em PASTAS DE SKILL (com SKILL.md). Passe exigirSkillMd:false para arquivar
  // também pastas de conteúdo puro (ex.: 'agents', 'workflows'), que são markdown indexado sem runtime.
  var exigirSkill = !(args && args.exigirSkillMd === false);
  var trashed = [], visits = { n: 0 }, MAXV = 800;
  (function scan(folder, depth) {
    if (depth > 8 || visits.n >= MAXV) return;
    var subs = folder.getFolders();
    while (subs.hasNext() && visits.n < MAXV) {
      visits.n++;
      var sf = subs.next(), nome = sf.getName();
      if (deny[nome.toLowerCase()] && (!exigirSkill || sf.getFilesByName('SKILL.md').hasNext())) {
        var reg = { nome: nome, id: sf.getId(), url: sf.getUrl() };
        try { sf.setTrashed(true); trashed.push(reg); } catch (e) { reg.erro = e.message; trashed.push(reg); }
      } else {
        scan(sf, depth + 1);
      }
    }
  })(DriveApp.getFolderById(rootId), 0);

  var vet = (typeof Semantica !== 'undefined' && Semantica.purgarSkills) ? Semantica.purgarSkills(DENY) : 0;
  try { if (typeof SkillsManager !== 'undefined') SkillsManager.invalidarCache('AgenteJarvis'); } catch (e) {}

  var nomes = trashed.map(function (t) { return t.nome; }).join(', ');
  try {
    if (typeof WikiMemoryService !== 'undefined' && WikiMemoryService.registrarNoLog) {
      WikiMemoryService.registrarNoLog('Limpeza de skills-ruído: ' + trashed.length + ' pasta(s) → lixeira (' + nomes +
        '). ' + vet + ' vetor(es) órfão(s) removido(s) do índice semântico. Motivo: dev-pack genérico inerte no runtime GAS; poluía o Top-8 e a busca RAG.');
    }
  } catch (e) {}
  try {
    if (typeof WikiMemoryService !== 'undefined' && WikiMemoryService.escreverWiki) {
      var carimbo = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
      WikiMemoryService.escreverWiki('index.md',
        '> _Manutenção ' + carimbo + ': ' + trashed.length + ' skills genéricas (dev-pack) enviadas à lixeira e desindexadas — o Jarvis passa a focar apenas nas skills de uso real. Detalhes no log.md._',
        'anexar');
    }
  } catch (e) {}

  Logger.log('[limparSkillsRuido] ' + trashed.length + ' pastas → lixeira; ' + vet + ' vetores removidos. (' + nomes + ')');
  return { status: 'success', pastasLixeira: trashed.length, vetoresApagados: vet, detalhes: trashed };
}

/**
 * MANUTENÇÃO: renomeia um arquivo do Drive por ID. Ex.: ativar a drawio-skill renomeando
 * 'SKILL-drawio-skill.md' → 'SKILL.md' (o discoverSkills só reconhece pastas com 'SKILL.md').
 * @param {Object} args { fileId, novoNome }
 */
function renomearArquivoDrive(args) {
  if (!args || !args.fileId || !args.novoNome) return { status: 'error', erro: 'Informe fileId e novoNome.' };
  try {
    var f = DriveApp.getFileById(args.fileId);
    var antigo = f.getName();
    f.setName(String(args.novoNome));
    try { if (typeof SkillsManager !== 'undefined') SkillsManager.invalidarCache('AgenteJarvis'); } catch (e) {}
    Logger.log('[renomearArquivoDrive] "' + antigo + '" → "' + f.getName() + '"');
    return { status: 'success', de: antigo, para: f.getName(), id: f.getId() };
  } catch (e) { return { status: 'error', erro: e.message }; }
}

/**
 * REINDEX LIMPO DO ZERO: purga TODOS os vetores do índice semântico e reenfileira a reindexação
 * assíncrona (broker, resumível, free-first). Use após reestruturar a base para um índice 100%
 * consistente. Custo: re-embeda tudo (cota FREE de embeddings). Roda sozinho até terminar.
 */
function reindexDoZero() {
  var n = 0;
  try { n = (typeof Semantica !== 'undefined' && Semantica.limpar) ? Semantica.limpar() : 0; } catch (e) {}
  // limpar() varre em páginas de 1000; repete enquanto houver resto (bases grandes).
  try {
    var guard = 0;
    while (Semantica.status && Semantica.status().trechos > 0 && guard < 20) { Semantica.limpar(); guard++; }
  } catch (e2) {}
  var job = (typeof brokerReindexRAG === 'function') ? brokerReindexRAG() : { erro: 'broker indisponível' };
  Logger.log('[reindexDoZero] purgados ' + n + '+ vetores; job=' + JSON.stringify(job));
  return { status: 'success', vetoresPurgados: n, rebuild: job };
}

/**
 * MIGRAÇÃO (rode 1x no editor): converte vetores gravados como ARRAY (legado, lento) → STRING JSON
 * compacta (parse muito mais rápido) → acelera a busca semântica. Resumível (orçamento de tempo).
 * NÃO usa Gemini (só lê/grava Firestore — funciona mesmo com a cota esgotada). Ex.: compactarVetores().
 */
function compactarVetores(colName) {
  var COLS = colName ? [colName] : ['wiki_vetores', 'conversa_vetores'];
  var inicio = Date.now(), budget = 4 * 60 * 1000, convertidos = 0, jaOk = 0, restantes = 0;
  for (var c = 0; c < COLS.length; c++) {
    var col = COLS[c], docs;
    try { docs = Firestore.listDocs(col, 3000); } catch (e) { Logger.log('pulei ' + col + ': ' + e.message); continue; }
    for (var i = 0; i < docs.length; i++) {
      if (Date.now() - inicio > budget) { restantes += docs.length - i; break; }
      var d = docs[i], v = d.dados.vetor;
      if (typeof v === 'string') { jaOk++; continue; }       // já compacto
      if (!Array.isArray(v)) continue;
      var nova = {};
      Object.keys(d.dados).forEach(function (kk) { nova[kk] = d.dados[kk]; });
      nova.vetor = JSON.stringify(v);
      try { Firestore.setDoc(col, d.id, nova); convertidos++; } catch (e2) {}
    }
    if (restantes) break;
  }
  Logger.log('🗜️ compactarVetores: ' + convertidos + ' convertidos · ' + jaOk + ' já compactos' +
    (restantes ? (' · ' + restantes + ' restantes → rode de novo') : ' · concluído ✅'));
  return { convertidos: convertidos, jaOk: jaOk, restantes: restantes };
}

/** Indexa o wiki em vetores (resumível). Rode no editor; re-rode se vier "continuar". */
function indexarWikiSemantico() {
  if (typeof Gemini === 'undefined' || !Gemini.temChave()) { Logger.log('❌ GEMINI_API_KEY ausente.'); return; }
  var r = Semantica.indexar({});
  Logger.log(JSON.stringify(r));
  if (r.status === 'abortado') {
    Logger.log('🛑 Indexação abortada (' + r.motivo + '): ' + r.erro1 + '\n→ Ajuste o teto de gasto em https://ai.studio/spend e rode de novo.');
  } else if (r.status === 'continuar') {
    Logger.log('⏳ Orçamento de tempo atingido (' + r.restantes + ' arquivos restantes) — rode indexarWikiSemantico() de novo, OU use brokerReindexRAG() (broker assíncrono: roda sozinho até terminar, sem repetir no editor).');
  } else {
    Logger.log('✅ Indexação concluída. ' + r.trechos + ' trechos novos, ' + r.pulados + ' arquivos já indexados.');
  }
  Logger.log('Índice atual: ' + JSON.stringify(Semantica.status()));
  return r;
}

/** Diagnóstico: busca semântica no editor. Ex.: testarBuscaSemantica('o que é o projeto Soft Web App?'). */
function testarBuscaSemantica(consulta) {
  var res = Semantica.buscar(consulta || 'o que é o projeto Soft Web App Jarvis?', 5);
  res.forEach(function (r) { Logger.log('• ' + r.score.toFixed(3) + ' · ' + r.caminho + '\n   ' + String(r.trecho).substring(0, 160).replace(/\n/g, ' ') + '…'); });
  return res;
}

/** Lista os modelos disponíveis na chave que SUPORTAM embedContent. Rode no editor. */
function listarModelosEmbedding() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY_FALLBACK');
  if (!key) { Logger.log('❌ GEMINI_API_KEY ausente.'); return; }
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key) + '&pageSize=200', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { Logger.log('❌ ListModels HTTP ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return; }
  var data = JSON.parse(res.getContentText() || '{}');
  var emb = (data.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('embedContent') !== -1; });
  Logger.log('Modelos com embedContent (' + emb.length + '):');
  emb.forEach(function (m) { Logger.log('  • ' + m.name + '  | dims: ' + (m.outputDimension || '?')); });
  if (!emb.length) Logger.log('⚠️ Nenhum modelo de embedding disponível nesta chave/projeto.');
  return emb.map(function (m) { return m.name; });
}

/** Diagnóstico ISOLADO: testa embeddar + setDoc/getDoc, SEM engolir erros. Rode no editor. */
function diagSemantica() {
  // 1) Embeddar
  var vec;
  try {
    vec = Gemini.embeddar('Teste de embedding do Jarvis.', { tipo: 'RETRIEVAL_DOCUMENT' });
    Logger.log('1) embeddar OK — dimensão: ' + (vec ? vec.length : 'null') + ' | amostra: ' + JSON.stringify((vec || []).slice(0, 3)));
  } catch (e) {
    Logger.log('1) ❌ embeddar FALHOU: ' + e.message);
    return { etapa: 'embeddar', erro: e.message };
  }
  if (!vec || !vec.length) { Logger.log('1) ❌ embeddar retornou vazio'); return { etapa: 'embeddar', erro: 'vetor vazio' }; }
  // 2) setDoc com o vetor
  try {
    Firestore.setDoc('wiki_vetores', '__diag__', { caminho: '__diag__', ord: 0, trecho: 'teste', vetor: vec, atualizadoEm: Date.now() });
    Logger.log('2) setDoc OK (gravou vetor de ' + vec.length + ' dims)');
  } catch (e) {
    Logger.log('2) ❌ setDoc FALHOU: ' + e.message);
    return { etapa: 'setDoc', erro: e.message };
  }
  // 3) getDoc de volta
  try {
    var d = Firestore.getDoc('wiki_vetores', '__diag__');
    Logger.log('3) getDoc OK — vetor lido com ' + ((d && d.vetor) ? d.vetor.length : 'null') + ' dims');
    Firestore.deleteDoc('wiki_vetores', '__diag__');
  } catch (e) {
    Logger.log('3) ❌ getDoc FALHOU: ' + e.message);
    return { etapa: 'getDoc', erro: e.message };
  }
  Logger.log('✅ TUDO OK — embeddar, setDoc e getDoc funcionam. O problema na indexação é outro (provável: lentidão/volume).');
  return { ok: true, dim: vec.length };
}

/** Reindexação COMPLETA (limpa e reconstrói). Cuidado: pode levar várias execuções. */
function reindexarWikiSemantico() {
  var n = Semantica.limpar();
  Logger.log('🗑️ ' + n + ' vetores removidos. Agora rode brokerReindexRAG() (roda sozinho até terminar) ou indexarWikiSemantico() (quantas vezes precisar).');
  return n;
}
