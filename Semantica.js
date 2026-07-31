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

  /* ── CENTRALIZAÇÃO (anisotropia) ──────────────────────────────────────────────────────────
   * Embeddings de modelos generativos não são isotrópicos: uma direção dominante é compartilhada
   * por quase todos os vetores. Com ela dentro, o cosseno entre dois documentos QUAISQUER já
   * começa alto antes de qualquer semântica — e o sinal que separa relevante de irrelevante fica
   * espremido no resíduo. Subtrair o vetor médio do corpus (μ) devolve resolução ao ranking.
   * É a correção barata do mesmo diagnóstico que o paper SHIFT ataca com uma ponte treinada.
   * Custo: ZERO chamada de IA — só aritmética sobre vetores que o buscar() já carregou.
   */
  var _CENTROIDE_CK = 'sem_centroide_v1';

  /** μ do corpus, a partir dos docs JÁ carregados (sem leitura extra do Firestore). */
  function _centroide(docs) {
    var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) {}
    var ck = _CENTROIDE_CK + '_' + docs.length;    // muda o nº de trechos → recalcula
    if (cache) { try { var hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e1) {} }
    var soma = null, n = 0;
    for (var i = 0; i < docs.length; i++) {
      var v = _vetorDe(docs[i].dados.vetor);
      if (!v.length) continue;
      if (!soma) { soma = []; for (var z = 0; z < v.length; z++) soma[z] = 0; }
      for (var j = 0; j < v.length && j < soma.length; j++) soma[j] += v[j];
      n++;
    }
    if (!soma || !n) return null;
    for (var m = 0; m < soma.length; m++) soma[m] = soma[m] / n;
    soma = _arred(soma);      // mesmo valor no 1º cálculo e nas leituras do cache (A/B reprodutível)
    if (cache) { try { cache.put(ck, JSON.stringify(soma), 21600); } catch (e2) {} }
    return soma;
  }

  /** Cosseno com μ removido dos dois lados. Sem μ, cai no cosseno normal. */
  function _cossenoCentrado(a, b, mu) {
    if (!mu) return _cosseno(a, b);
    a = a || []; b = b || [];
    var n = Math.min(a.length, b.length, mu.length), dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) {
      var x = a[i] - mu[i], y = b[i] - mu[i];
      dot += x * y; na += x * x; nb += y * y;
    }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  /** Ligada por padrão; SEMANTICA_CENTRALIZAR='off' desliga (serve para medir A/B). */
  function _centralizando() { return _p('SEMANTICA_CENTRALIZAR') !== 'off'; }

  /* ── O QUE CONTA COMO CONHECIMENTO INDEXÁVEL ──────────────────────────────────────────────
   * Só TEXTO. PDF, imagem, áudio e vídeo exigiriam visão/transcrição, e isso queima cota do
   * Gemini a cada arquivo. Markdown, .txt e Google Docs são lidos por API do Workspace — custo
   * ZERO de IA. É o que torna viável despejar as sínteses do NotebookLM aqui sem medo.
   * Um Doc do Google é o caminho mais fácil na interface do Drive: Novo → Documentos, colar.
   */
  var _MIME_DOC = 'application/vnd.google-apps.document';

  function _ehIndexavel(file) {
    var nm = file.getName();
    var mime = '';
    try { mime = file.getMimeType(); } catch (e) {}
    if (mime === _MIME_DOC) return !ehMetaArquivoWiki(nm + '.md');   // Doc não tem extensão
    if (!/\.(md|markdown|txt)$/i.test(nm)) return false;
    return !ehMetaArquivoWiki(nm.replace(/\.(markdown|txt)$/i, '.md'));
  }

  /** Texto puro do arquivo. Zero chamada de IA — Drive/Docs API apenas. */
  function _textoDoArquivo(id) {
    var file = DriveApp.getFileById(id);
    var mime = '';
    try { mime = file.getMimeType(); } catch (e) {}
    if (mime === _MIME_DOC) {
      try { return DocumentApp.openById(id).getBody().getText(); }
      catch (e) { return ''; }
    }
    try { return file.getBlob().getDataAsString('UTF-8'); } catch (e) { return ''; }
  }
  // Lista recursivamente os arquivos de TEXTO do wiki (pula a pasta raw/ E os meta-arquivos).
  // Meta-arquivos (manual/índice/registro) NÃO são conhecimento — indexá-los polui a busca.
  // @return [{id, caminho}].
  function _arquivosWiki() {
    var rootId = _p('WIKI_DRIVE_ID');
    if (!rootId) throw new Error('WIKI_DRIVE_ID ausente. Rode configurarBaseConhecimento(...).');
    var lista = [];
    (function walk(folder, prefixo) {
      var fs = folder.getFiles();
      while (fs.hasNext()) { var f = fs.next(); if (_ehIndexavel(f)) lista.push({ id: f.getId(), caminho: prefixo + f.getName() }); }
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
      try { texto = _textoDoArquivo(a.id); } catch (e) { continue; }
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

  // Algoritmo Lexical BM25 (Best Matching 25) para ranking textual no Apps Script
  function _bm25Buscar(consulta, docs, k) {
    k = k || 5;
    if (!docs || !docs.length) return [];
    var termos = String(consulta || '').toLowerCase().replace(/[^\w\s\u00C0-\u00FF]/g, ' ').split(/\s+/).filter(function(t) { return t.length > 2; });
    if (!termos.length) return [];

    var N = docs.length;
    var avgdl = 0;
    var docTokens = docs.map(function(d) {
      var tok = String((d.dados && d.dados.trecho) || d.trecho || '').toLowerCase().replace(/[^\w\s\u00C0-\u00FF]/g, ' ').split(/\s+/).filter(Boolean);
      avgdl += tok.length;
      return tok;
    });
    avgdl = N > 0 ? (avgdl / N) : 1;

    var k1 = 1.5, b = 0.75;
    var idf = {};
    termos.forEach(function(t) {
      var n_t = 0;
      docTokens.forEach(function(toks) {
        if (toks.indexOf(t) !== -1) n_t++;
      });
      idf[t] = Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5));
    });

    var scored = docs.map(function(d, idx) {
      var toks = docTokens[idx];
      var docLen = toks.length;
      var score = 0;

      termos.forEach(function(t) {
        var tf = 0;
        for (var i = 0; i < toks.length; i++) { if (toks[i] === t) tf++; }
        if (tf > 0) {
          var num = tf * (k1 + 1);
          var den = tf + k1 * (1 - b + b * (docLen / avgdl));
          score += (idf[t] || 0) * (num / den);
        }
      });

      var cam = String((d.dados && d.dados.caminho) || d.caminho || '').toLowerCase();
      termos.forEach(function(t) {
        if (cam.indexOf(t) !== -1) score += 3.0;
      });

      return { caminho: (d.dados && d.dados.caminho) || d.caminho, trecho: (d.dados && d.dados.trecho) || d.trecho, score: Number(score.toFixed(4)), via: 'bm25' };
    });

    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.filter(function(s) { return s.score > 0; }).slice(0, k);
  }

  /** Busca semântica: embeda a consulta e retorna os top-k trechos por cosseno. Se a cota de embeddings esgotar, faz fallback gracioso para BM25. */
  function buscar(consulta, k, opts) {
    k = k || 5;
    var cache = CacheService.getScriptCache();
    var modo = ((opts && opts.centralizar !== undefined) ? !!opts.centralizar : _centralizando()) ? 'c' : 'r';
    var ck = 'sem_res_' + modo + '_' + _hash(String(consulta) + '|' + k);
    try { var hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (eC) {}
    var docs = Firestore.listDocs(COL, 1000);
    if (!docs.length) return [];

    var qv = null;
    try {
      qv = Gemini.embeddar(consulta, { tipo: 'RETRIEVAL_QUERY' });
    } catch (eEmb) {
      Logger.log('[Semantica] Gemini.embeddar indisponível (' + eEmb.message + ') — ativando fallback BM25.');
    }

    if (!qv || !qv.length) {
      var resBM25 = _bm25Buscar(consulta, docs, k);
      try { cache.put(ck, JSON.stringify(resBM25), 600); } catch (eP) {}
      return resBM25;
    }

    var mu = (modo === 'c') ? _centroide(docs) : null;
    var sim = _simCacheGet(qv, k, modo);
    if (sim) { try { cache.put(ck, JSON.stringify(sim), 1800); } catch (e1) {} return sim; }

    var scored = docs.map(function (d) {
      return { caminho: d.dados.caminho, trecho: d.dados.trecho, score: _cossenoCentrado(qv, _vetorDe(d.dados.vetor), mu) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored.slice(0, k);
    try { cache.put(ck, JSON.stringify(top), 1800); } catch (eP) {}
    _simCachePut(qv, k, top, modo);
    return top;
  }

  /**
   * Busca HÍBRIDA (Cosseno + BM25 fundidos via RRF - Reciprocal Rank Fusion).
   * Se embeddings estiverem indisponíveis (cota 429), degrada perfeitamente para BM25.
   */
  function buscarHibrido(consulta, k) {
    k = k || 5;
    var docs = Firestore.listDocs(COL, 1000);
    if (!docs.length) return [];

    var rankBM25 = _bm25Buscar(consulta, docs, 20);
    var rankSem = [];
    try {
      rankSem = buscar(consulta, 20);
    } catch (e) {
      Logger.log('[Semantica] Erro na busca semântica para RRF: ' + e.message);
    }

    var rrfScores = {};
    var rrfConst = 60;

    rankSem.forEach(function(item, rank) {
      var key = item.caminho + '|||' + item.trecho.substring(0, 50);
      if (!rrfScores[key]) rrfScores[key] = { caminho: item.caminho, trecho: item.trecho, rrfScore: 0, semScore: item.score, bm25Score: 0 };
      rrfScores[key].rrfScore += (1 / (rrfConst + (rank + 1)));
    });

    rankBM25.forEach(function(item, rank) {
      var key = item.caminho + '|||' + item.trecho.substring(0, 50);
      if (!rrfScores[key]) rrfScores[key] = { caminho: item.caminho, trecho: item.trecho, rrfScore: 0, semScore: 0, bm25Score: item.score };
      rrfScores[key].bm25Score = item.score;
      rrfScores[key].rrfScore += (1 / (rrfConst + (rank + 1)));
    });

    var fused = Object.keys(rrfScores).map(function(k) { return rrfScores[k]; });
    fused.sort(function(a, b) { return b.rrfScore - a.rrfScore; });

    return fused.slice(0, k).map(function(f) {
      return { caminho: f.caminho, trecho: f.trecho, score: Number(f.rrfScore.toFixed(4)), semScore: f.semScore, bm25Score: f.bm25Score };
    });
  }

  // VAR-1 · cache semântico por similaridade (lista curta de {emb arredondado, k, top} no CacheService).
  var _SIM_KEY = 'sem_simcache', _SIM_THRESHOLD = 0.93, _SIM_MAX = 8;
  function _arred(v) { return (v || []).map(function (x) { return Math.round(x * 1e4) / 1e4; }); } // 4 casas → cabe no cache
  function _simCacheGet(qv, k, modo) {
    try {
      var raw = CacheService.getScriptCache().get(_SIM_KEY); if (!raw) return null;
      var list = JSON.parse(raw), bestTop = null, bestS = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i].k !== k) continue;
        if ((list[i].modo || 'r') !== (modo || 'r')) continue;   // não misturar centrado com cru
        var s = _cosseno(qv, list[i].emb);
        if (s > bestS) { bestS = s; bestTop = list[i].top; }
      }
      return (bestTop && bestS >= _SIM_THRESHOLD) ? bestTop : null;
    } catch (e) { return null; }
  }
  function _simCachePut(qv, k, top, modo) {
    try {
      var c = CacheService.getScriptCache(), raw = c.get(_SIM_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list.unshift({ emb: _arred(qv), k: k, top: top, modo: modo || 'r' });
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


  /* ── INDEXAÇÃO INCREMENTAL ────────────────────────────────────────────────────────────────
   * O elo NotebookLM → Drive é manual e não tem conserto (não há API). Mas Drive → Jarvis tem:
   * hoje um arquivo novo na wiki só é encontrado depois de alguém mandar reindexar. Este job
   * fecha o ciclo — ele salva a síntese e o Jarvis já responde por voz, sem mais nenhum passo.
   *
   * Detecta por DATA DE MODIFICAÇÃO, não por listagem completa: guarda o instante da última
   * varredura e só reindexa o que mudou desde então. Arquivo EDITADO também entra (o indexar()
   * normal pula o que já tem vetor, então edição passava batida).
   */
  var _VARREDURA = 'SEMANTICA_ULTIMA_VARREDURA';

  /** Como _arquivosWiki, mas traz a data de modificação de cada arquivo. */
  function _arquivosWikiComData() {
    var rootId = _p('WIKI_DRIVE_ID');
    if (!rootId) throw new Error('WIKI_DRIVE_ID ausente.');
    var lista = [];
    (function walk(folder, prefixo) {
      var fs2 = folder.getFiles();
      while (fs2.hasNext()) {
        var fl = fs2.next(), nm = fl.getName();
        if (!_ehIndexavel(fl)) continue;
        lista.push({ id: fl.getId(), caminho: prefixo + nm, em: fl.getLastUpdated().getTime() });
      }
      var subs = folder.getFolders();
      while (subs.hasNext()) {
        var sf = subs.next();
        if (/^raw$/i.test(sf.getName())) continue;
        walk(sf, prefixo + sf.getName() + '/');
      }
    })(DriveApp.getFolderById(rootId), '');
    return lista;
  }

  /** Apaga os vetores de UM caminho, por id determinístico — sem listar a coleção inteira. */
  function _purgarCaminho(caminho, maxChunks) {
    var base = _hash(caminho), n = 0;
    for (var i = 0; i < (maxChunks || 60); i++) {
      try { if (Firestore.getDoc(COL, base + '_' + i)) { Firestore.deleteDoc(COL, base + '_' + i); n++; } else if (i > 2) break; }
      catch (e) { break; }
    }
    return n;
  }

  /**
   * Indexa só o que mudou. opts { maxArquivos, budgetMs, desde, simular }.
   * @return { status, novos, reindexados, trechos, restantes, proximaVarredura }
   */
  function indexarNovos(opts) {
    opts = opts || {};
    var inicio = Date.now();
    var budget = opts.budgetMs || (4 * 60 * 1000);
    var maxArq = opts.maxArquivos || 8;          // teto por execução: embedding custa cota
    var props = PropertiesService.getScriptProperties();
    var desde = (opts.desde !== undefined) ? Number(opts.desde) : Number(props.getProperty(_VARREDURA) || 0);

    var arquivos = _arquivosWikiComData();

    // PRIMEIRA EXECUÇÃO: sem marcador, TODO arquivo parece novo — seriam 172 reindexações e uma
    // queima de cota para refazer o que já está indexado. O corpus atual já foi indexado pelo
    // indexar() normal, então aqui só cravamos o marco: daqui para frente, só o que mudar.
    // Para forçar uma passada completa, use indexar({forcar:true}) — é outra operação, deliberada.
    if (!desde && opts.desde === undefined) {
      var agora0 = Date.now();
      if (opts.simular !== true) props.setProperty(_VARREDURA, String(agora0));
      return { status: 'success', primeiraExecucao: true, novos: 0, reindexados: 0, trechos: 0,
               restantes: 0, totalNaWiki: arquivos.length,
               nota: 'marcador ajustado para agora — a partir daqui indexa só o que mudar' };
    }

    var mudados = arquivos.filter(function (a) { return a.em > desde; })
                          .sort(function (a, b) { return a.em - b.em; });   // mais antigo primeiro
    if (opts.simular === true) {
      return { status: 'simulado', desde: desde ? new Date(desde).toISOString() : '(nunca varreu)',
               totalNaWiki: arquivos.length, mudados: mudados.length,
               amostra: mudados.slice(0, 10).map(function (a) { return a.caminho; }) };
    }
    if (!mudados.length) {
      props.setProperty(_VARREDURA, String(Date.now()));
      return { status: 'success', novos: 0, reindexados: 0, trechos: 0, restantes: 0, nota: 'nada mudou' };
    }

    var novos = 0, reidx = 0, trechos = 0, erro1 = '', maiorEm = desde;
    for (var i = 0; i < mudados.length && i < maxArq; i++) {
      if (Date.now() - inicio > budget) break;
      var a = mudados[i];
      var base = _hash(a.caminho);
      var jaTinha = false;
      try { jaTinha = !!Firestore.getDoc(COL, base + '_0'); } catch (e) {}
      if (jaTinha) _purgarCaminho(a.caminho);        // editado: troca os vetores, não duplica

      var texto = '';
      try { texto = _textoDoArquivo(a.id); } catch (e) { continue; }
      var cs = _chunks(texto);
      var okArquivo = true;
      for (var j = 0; j < cs.length && j < 50; j++) {
        try {
          var vec = Gemini.embeddar(cs[j], { tipo: 'RETRIEVAL_DOCUMENT' });
          if (vec && vec.length) {
            Firestore.setDoc(COL, base + '_' + j, { caminho: a.caminho, ord: j,
              trecho: cs[j].substring(0, 1500), vetor: JSON.stringify(vec), atualizadoEm: Date.now() });
            trechos++;
          }
        } catch (e) {
          var msg = String(e && e.message || e);
          if (!erro1) erro1 = msg;
          okArquivo = false;
          // Cota estourada: para TUDO e não avança o marcador — o resto entra na próxima rodada.
          if (/\b429\b|quota|RESOURCE_EXHAUSTED|exceeded|spending cap/i.test(msg)) {
            return { status: 'cota', novos: novos, reindexados: reidx, trechos: trechos,
                     restantes: mudados.length - i, erro1: erro1,
                     nota: 'marcador NÃO avançado — retoma de onde parou' };
          }
        }
      }
      if (okArquivo) { if (jaTinha) reidx++; else novos++; if (a.em > maiorEm) maiorEm = a.em; }
    }

    // Avança o marcador até o arquivo mais recente CONCLUÍDO — não até "agora". Se algo falhou,
    // ele volta na próxima varredura em vez de sumir.
    props.setProperty(_VARREDURA, String(maiorEm));
    var restantes = Math.max(0, mudados.length - Math.min(mudados.length, maxArq));
    return { status: restantes ? 'continuar' : 'success', novos: novos, reindexados: reidx,
             trechos: trechos, restantes: restantes, erro1: erro1,
             proximaVarredura: new Date(maiorEm).toISOString() };
  }

  return { indexar: indexar, indexarNovos: indexarNovos, buscar: buscar, buscarHibrido: buscarHibrido, status: status, limpar: limpar, purgarMeta: purgarMeta, purgarSkills: purgarSkills };
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

/**
 * A/B da CENTRALIZAÇÃO (anisotropia): roda o mesmo conjunto de consultas com e sem μ e informa
 * em que POSIÇÃO a página correta apareceu em cada modo. Sem isso, ligar a centralização é fé.
 * args {casos:[{consulta, esperado}], k}. Sem casos, usa o conjunto padrão da wiki do Bruno.
 * Custo: 1 embedding por consulta (cacheado), zero geração.
 */
function diagCentralizacao(args) {
  args = args || {};
  var k = Number(args.k || 10);
  var casos = args.casos || [
    { consulta: 'como funciona a malha de IA agentica',        esperado: 'malha-ia-agentica' },
    { consulta: 'o que e zero trust para agentes',             esperado: 'zero-trust-agentes' },
    { consulta: 'padrao de LockService no Apps Script',        esperado: 'lock-service-pattern' },
    { consulta: 'como funciona a fila de emissao de CT-e',     esperado: 'fila-emissao-cte' },
    { consulta: 'o que e vibe coding',                         esperado: 'vibe-coding' },
    { consulta: 'OCR no cadastro de motoristas',               esperado: 'ocr-cadastro-motoristas' },
    { consulta: 'padrao de log de atividade',                  esperado: 'activity-log-pattern' },
    { consulta: 'controle de acesso RBAC no GAS',              esperado: 'rbac-gas' },
    { consulta: 'workflow em DAG',                             esperado: 'dag-workflow' },
    { consulta: 'agente de whatsapp com IA',                   esperado: 'whatsapp-ai-agent' }
  ];

  function posicao(consulta, esperado, centralizar) {
    var res = [];
    try { res = Semantica.buscar(consulta, k, { centralizar: centralizar }) || []; } catch (e) { return { erro: e.message }; }
    var alvo = String(esperado).toLowerCase();
    for (var i = 0; i < res.length; i++) {
      if (String(res[i].caminho || '').toLowerCase().indexOf(alvo) !== -1) {
        return { pos: i + 1, score: Number(res[i].score.toFixed(4)) };
      }
    }
    return { pos: null, score: null };            // não apareceu no top-k
  }

  // SEPARAÇÃO: quanto o 1º se destaca do 2º. É o que a anisotropia rouba — o ranking pode estar
  // certo e mesmo assim frágil, com todo mundo empatado tecnicamente. Aqui a melhora aparece
  // mesmo quando a posição não muda.
  function margem(consulta, centralizar) {
    try {
      var r = Semantica.buscar(consulta, 5, { centralizar: centralizar }) || [];
      if (r.length < 2) return null;
      return Number((r[0].score - r[1].score).toFixed(4));
    } catch (e) { return null; }
  }

  var linhas = [], somaCru = 0, somaCen = 0, achouCru = 0, achouCen = 0, melhorou = 0, piorou = 0;
  var somaMcru = 0, somaMcen = 0, nM = 0;
  casos.forEach(function (c) {
    var cru = posicao(c.consulta, c.esperado, false);
    var cen = posicao(c.consulta, c.esperado, true);
    // não achou no top-k conta como k+1 (penalidade), senão a média mente
    var pC = cru.pos || (k + 1), pN = cen.pos || (k + 1);
    somaCru += pC; somaCen += pN;
    if (cru.pos) achouCru++;
    if (cen.pos) achouCen++;
    if (pN < pC) melhorou++; else if (pN > pC) piorou++;
    var mCru = margem(c.consulta, false), mCen = margem(c.consulta, true);
    if (mCru !== null && mCen !== null) { somaMcru += mCru; somaMcen += mCen; nM++; }
    linhas.push({ consulta: c.consulta, esperado: c.esperado,
                  posCru: cru.pos, posCentrado: cen.pos,
                  scoreCru: cru.score, scoreCentrado: cen.score,
                  margemCru: mCru, margemCentrado: mCen,
                  delta: pC - pN });
  });

  var n = casos.length;
  return { ok: true, k: k, casos: n,
           mediaPosicaoCru: Number((somaCru / n).toFixed(2)),
           mediaPosicaoCentrado: Number((somaCen / n).toFixed(2)),
           achouNoTopK: { cru: achouCru, centrado: achouCen },
           melhorou: melhorou, piorou: piorou, empatou: n - melhorou - piorou,
           margemMedia: nM ? { cru: Number((somaMcru / nM).toFixed(4)), centrado: Number((somaMcen / nM).toFixed(4)) } : null,
           veredito: (somaCen < somaCru) ? 'centralizacao MELHOROU'
                   : (somaCen > somaCru) ? 'centralizacao PIOROU — deixar SEMANTICA_CENTRALIZAR=off'
                   : 'empate',
           detalhe: linhas };
}

/** Liga/desliga a centralização. args {ligar:true|false}. */
function configurarCentralizacao(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.ligar === false) p.setProperty('SEMANTICA_CENTRALIZAR', 'off');
  else p.deleteProperty('SEMANTICA_CENTRALIZAR');
  return { ok: true, centralizando: p.getProperty('SEMANTICA_CENTRALIZAR') !== 'off' };
}

/** Handler do gatilho de indexação incremental (a cada 30 min). Bate o coração no Heartbeat. */
function jobIndexarWiki() {
  try { if (typeof Heartbeat !== 'undefined' && Heartbeat.bater) Heartbeat.bater('indexWiki'); } catch (e) {}
  var r = Semantica.indexarNovos({ maxArquivos: 8 });
  Logger.log('[indexarNovos] ' + JSON.stringify(r));
  return r;
}

/** Liga/desliga o job. args {ligar:false} desliga · {minutos} muda a cadência (padrão 30). */
function configurarIndexacaoAutomatica(args) {
  args = args || {};
  var min = Number(args.minutos || 30);
  var achou = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'jobIndexarWiki') { ScriptApp.deleteTrigger(t); achou++; }
  });
  if (args.ligar === false) return { ok: true, ligado: false, removidos: achou };
  ScriptApp.newTrigger('jobIndexarWiki').timeBased().everyMinutes(min === 15 || min === 30 ? min : 30).create();
  return { ok: true, ligado: true, cadenciaMin: min, removidos: achou };
}

/** Diag: {} estado · {simular:true} mostra o que reindexaria · {rodar:true} roda agora · {resetar:true} */
function diagIndexacao(args) {
  args = args || {};
  var p = PropertiesService.getScriptProperties();
  if (args.resetar === true) { p.deleteProperty('SEMANTICA_ULTIMA_VARREDURA'); return { ok: true, resetado: true, nota: 'próxima varredura reindexa TUDO' }; }
  if (args.rodar === true) return Semantica.indexarNovos({ maxArquivos: Number(args.maxArquivos || 8) });
  if (args.simular !== false) {
    var r = Semantica.indexarNovos({ simular: true });
    r.gatilhoAtivo = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'jobIndexarWiki'; });
    return r;
  }
  return { ok: true };
}