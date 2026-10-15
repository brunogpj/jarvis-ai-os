// ===================================================================================
// BuscaDrive.js — BUSCA SEMÂNTICA nos arquivos do Google Drive ("acha o documento sobre X"). 14/10/2026.
// Ideia do post "Serverless Multimodal Vector Search" (Kanshi Tanaike): guardar o file_id do Drive JUNTO do vetor, para o resultado abrir o
// arquivo VIVO (e não um trecho solto). A parte do BigQuery/Iceberg do post fica de fora de propósito: em escala pessoal (alguns milhares
// de arquivos) um índice compacto num arquivo do Drive responde em ~1 s e não custa nada além dos embeddings.
//
// Diferenças deliberadas de Semantica.js (a busca da WIKI, que continua como está):
//   • 1 vetor por ARQUIVO (nome + tipo + começo do texto), não por trecho: serve para ACHAR o arquivo, não para responder de dentro dele.
//   • Vetor QUANTIZADO em int8 + escala (~800 bytes por arquivo em vez de ~10 KB): 3.000 arquivos cabem em ~3 MB e a busca lê UM arquivo.
//   • Fonte da verdade é o próprio arquivo de índice (sem Firestore, sem o teto de 1.000 docs). Escrita sob LockService.
//   • PRIVACIDADE: o texto dos arquivos vai ao Gemini SÓ pela chave de faturamento (opts.soPago em Gemini.embeddar) — a gratuita pode usar o
//     conteúdo para melhorar produtos. O índice guarda nome, tipo, data, link e o vetor; NUNCA o texto.
//   • Só entra texto que o Workspace lê de graça: Docs, Slides, Sheets (cabeçalho + primeiras linhas), .txt/.md/.csv. PDF e imagem entram só
//     pelo NOME (marcados `parcial`): ler o conteúdo exigiria OCR/visão e queimaria cota a cada arquivo.
//   • Fora do índice: lixeira, a pasta da wiki (já tem a busca dela) e nomes que casam com BUSCA_DRIVE_EXCLUIR (regex, Script Property).
//
// Liga com BUSCA_DRIVE_ATIVA=sim: o tick de 15 min (Agenda.js) chama tick(), que indexa um lote pequeno e retoma sozinho (token do iterador).
// ===================================================================================

var BuscaDrive = (function () {
  'use strict';

  var P_IDX = 'BUSCA_DRIVE_INDICE_FILE_ID', P_TOKEN = 'BUSCA_DRIVE_TOKEN', P_ULT = 'BUSCA_DRIVE_ULTIMA', P_FULL = 'BUSCA_DRIVE_ULTIMA_FULL', P_SW = 'BUSCA_DRIVE_VARREDURA';
  var MIME = {
    doc: 'application/vnd.google-apps.document', planilha: 'application/vnd.google-apps.spreadsheet',
    apresentacao: 'application/vnd.google-apps.presentation', pdf: 'application/pdf'
  };
  var TEXTO_EXT = /\.(txt|md|markdown|csv)$/i;
  var MAX_TEXTO = 2500;        // caracteres do conteúdo que entram no vetor
  var MAX_BYTES = 5 * 1024 * 1024;

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
  function _sp(k, v) { try { PropertiesService.getScriptProperties().setProperty(k, String(v)); } catch (e) {} }
  function _dp(k) { try { PropertiesService.getScriptProperties().deleteProperty(k); } catch (e) {} }
  function ativa() { return String(_p('BUSCA_DRIVE_ATIVA') || 'nao').toLowerCase() === 'sim'; }
  function _max() { var n = Number(_p('BUSCA_DRIVE_MAX') || 3000); return (isFinite(n) && n >= 50 && n <= 8000) ? n : 3000; }
  function _norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /* ── vetor int8 ─────────────────────────────────────────────────────────────────── */
  /** Float[] → { q: base64 de int8, s: escala }. O ranking por cosseno sobrevive à quantização (erro < 1%). */
  function _quantizar(vec) {
    var max = 0, i;
    for (i = 0; i < vec.length; i++) { var a = Math.abs(vec[i]); if (a > max) max = a; }
    var s = max / 127 || 1, bytes = new Array(vec.length);
    for (i = 0; i < vec.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / s)));
    return { q: Utilities.base64Encode(bytes), s: Math.round(s * 1e8) / 1e8 };
  }
  function _decodificar(item) {
    var b = Utilities.base64Decode(item.q), v = new Array(b.length);
    for (var i = 0; i < b.length; i++) v[i] = b[i] * item.s;
    return v;
  }

  /* ── arquivo de índice ──────────────────────────────────────────────────────────── */
  function _lerIndice() {
    var id = _p(P_IDX);
    if (!id) return { itens: [], id: null };
    try {
      var arr = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
      return { itens: Array.isArray(arr) ? arr : [], id: id };
    } catch (e) { return { itens: [], id: null, erro: e.message }; }
  }
  function _gravarIndice(itens, id) {
    var json = JSON.stringify(itens);
    if (id) { try { DriveApp.getFileById(id).setContent(json); return id; } catch (e) { id = null; } }
    var pasta = DriveUploads._subpasta('assets');
    id = pasta.createFile('indice-busca-drive.json', json, 'application/json').getId();
    _sp(P_IDX, id);
    return id;
  }

  /* ── o que entra ────────────────────────────────────────────────────────────────── */
  function _tipoDe(mime, nome) {
    if (mime === MIME.doc) return 'documento';
    if (mime === MIME.planilha) return 'planilha';
    if (mime === MIME.apresentacao) return 'apresentacao';
    if (mime === MIME.pdf) return 'pdf';
    if (TEXTO_EXT.test(nome || '')) return 'texto';
    return null;
  }
  function _linkDe(id, mime) {
    if (mime === MIME.doc) return 'https://docs.google.com/document/d/' + id + '/edit';
    if (mime === MIME.planilha) return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
    if (mime === MIME.apresentacao) return 'https://docs.google.com/presentation/d/' + id + '/edit';
    return 'https://drive.google.com/file/d/' + id + '/view';
  }

  /** Texto que representa o arquivo no vetor. Só leitura por API do Workspace (custo zero de IA). '' = só o nome. */
  function _textoDe(file, mime, tipo) {
    var id = file.getId();
    try {
      if (tipo === 'documento') return String(DocumentApp.openById(id).getBody().getText() || '').slice(0, MAX_TEXTO);
      if (tipo === 'apresentacao') {
        var out = [];
        SlidesApp.openById(id).getSlides().slice(0, 12).forEach(function (sl) {
          sl.getShapes().forEach(function (sh) { try { var t = sh.getText().asString(); if (t && t.trim()) out.push(t.trim()); } catch (e) {} });
        });
        return out.join('\n').slice(0, MAX_TEXTO);
      }
      if (tipo === 'planilha') {
        var ss = SpreadsheetApp.openById(id), partes = [];
        ss.getSheets().slice(0, 3).forEach(function (sh) {
          var nl = Math.min(sh.getLastRow(), 6), nc = Math.min(sh.getLastColumn(), 12);
          partes.push('Aba ' + sh.getName());
          if (nl > 0 && nc > 0) sh.getRange(1, 1, nl, nc).getDisplayValues().forEach(function (l) { partes.push(l.join(' | ')); });
        });
        return partes.join('\n').slice(0, MAX_TEXTO);
      }
      if (tipo === 'texto') { if (file.getSize() > MAX_BYTES) return ''; return String(file.getBlob().getDataAsString('UTF-8') || '').slice(0, MAX_TEXTO); }
    } catch (e) { /* sem permissão/arquivo corrompido: entra só pelo nome */ }
    return '';
  }

  var _ROTULO = { documento: 'documento', planilha: 'planilha', apresentacao: 'apresentação', pdf: 'PDF', texto: 'arquivo de texto' };

  /** IDs das pastas que NÃO entram (a wiki inteira tem busca própria). Cache de 6 h. */
  function _pastasExcluidas() {
    var ck = 'busca_drive_excl';
    try { var h = CacheService.getScriptCache().get(ck); if (h) return JSON.parse(h); } catch (e) {}
    var ids = {};
    ['WIKI_DRIVE_ID', 'BASE_CONHECIMENTO_DRIVE_ID'].forEach(function (k) {
      var raiz = _p(k); if (!raiz) return;
      try { (function walk(f) { ids[f.getId()] = 1; var s = f.getFolders(); while (s.hasNext()) walk(s.next()); })(DriveApp.getFolderById(raiz)); } catch (e) {}
    });
    try { CacheService.getScriptCache().put(ck, JSON.stringify(ids), 21600); } catch (e) {}
    return ids;
  }
  function _naWiki(file, excl) {
    try { var ps = file.getParents(); while (ps.hasNext()) { if (excl[ps.next().getId()]) return true; } } catch (e) {}
    return false;
  }
  function _excluidoPorNome(nome) {
    var rx = String(_p('BUSCA_DRIVE_EXCLUIR') || '').trim();
    if (!rx) return false;
    try { return new RegExp(rx, 'i').test(nome); } catch (e) { return false; }
  }

  /* ── indexação ─────────────────────────────────────────────────────────────────── */
  function _consulta(desdeISO) {
    var m = [MIME.doc, MIME.planilha, MIME.apresentacao, MIME.pdf].map(function (x) { return "mimeType = '" + x + "'"; });
    m.push("(mimeType = 'text/plain' or mimeType = 'text/markdown' or mimeType = 'text/csv')");
    var q = 'trashed = false and (' + m.join(' or ') + ')';
    if (desdeISO) q += " and modifiedDate > '" + desdeISO + "'";
    return q;
  }

  /**
   * Indexa um lote e retoma na próxima chamada (token do iterador em Script Property). RESUMÍVEL e barata quando nada mudou.
   * @param {Object} [opts] { budgetMs (padrão 90 s), maxArquivos (padrão 60), simular, forcarCompleta }
   * @return { status:'success'|'continuar'|'simulado'|'abortado', novos, atualizados, pulados, removidos, total }
   */
  function indexar(opts) {
    opts = opts || {};
    var inicio = Date.now(), budget = opts.budgetMs || 90000, maxArq = opts.maxArquivos || 60;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { status: 'ocupado' };
    try {
      var idx = _lerIndice(), porId = {};
      idx.itens.forEach(function (it) { porId[it.id] = it; });
      var token = _p(P_TOKEN), varredura = Number(_p(P_SW) || 0) || 0;
      var ultima = Number(_p(P_ULT) || 0), ultimaFull = Number(_p(P_FULL) || 0);
      var completa = !!opts.forcarCompleta || !ultima || (Date.now() - ultimaFull > 7 * 86400000);
      var iter;
      if (token) { try { iter = DriveApp.continueFileIterator(token); } catch (eT) { token = null; } }
      if (!token) {
        varredura = Math.max(Date.now(), (Number(_p(P_SW)) || 0) + 1); _sp(P_SW, varredura);   // sempre cresce: duas varreduras nunca compartilham o marcador `sw`
        var desde = completa ? null : new Date(ultima - 3600000).toISOString().slice(0, 19);
        _sp('BUSCA_DRIVE_VARREDURA_COMPLETA', completa ? '1' : '0');
        iter = DriveApp.searchFiles(_consulta(desde));
      } else { completa = _p('BUSCA_DRIVE_VARREDURA_COMPLETA') === '1'; }
      var excl = _pastasExcluidas();
      var novos = 0, atualizados = 0, pulados = 0, exame = 0, erro1 = '', teto = _max();
      var simular = !!opts.simular, abortou = false;

      while (iter.hasNext()) {
        if (Date.now() - inicio > budget || exame >= maxArq) break;
        var f = iter.next(); exame++;
        var id = f.getId(), nome = f.getName(), mime = ''; try { mime = f.getMimeType(); } catch (e) {}
        var tipo = _tipoDe(mime, nome);
        if (!tipo || _excluidoPorNome(nome) || _naWiki(f, excl)) continue;
        var mod = 0; try { mod = f.getLastUpdated().getTime(); } catch (e) {}
        var ant = porId[id];
        if (ant && ant.mod >= mod) { ant.sw = varredura; pulados++; continue; }   // não mudou: só marca como visto
        if (!ant && idx.itens.length >= teto) { pulados++; continue; }
        if (simular) { if (ant) atualizados++; else novos++; continue; }
        var texto = _textoDe(f, mime, tipo);
        var base = nome + '\n' + _ROTULO[tipo] + (texto ? '\n' + texto : '');
        var vec;
        try { vec = Gemini.embeddar(base, { tipo: 'RETRIEVAL_DOCUMENT', soPago: true }); }
        catch (eE) {
          var msg = String(eE && eE.message || eE); if (!erro1) erro1 = msg;
          if (/\b429\b|spending cap|quota|RESOURCE_EXHAUSTED|exceeded|chave paga/i.test(msg)) { abortou = true; break; }
          continue;
        }
        if (!vec || !vec.length) { if (!erro1) erro1 = 'embeddar retornou vetor vazio'; continue; }
        var qv = _quantizar(vec);
        var item = { id: id, nome: nome, mime: mime, tipo: tipo, mod: mod, parcial: !texto, q: qv.q, s: qv.s, sw: varredura };
        if (ant) { for (var k = 0; k < idx.itens.length; k++) if (idx.itens[k].id === id) { idx.itens[k] = item; break; } atualizados++; }
        else { idx.itens.push(item); novos++; }
        porId[id] = item;
      }

      var terminou = !iter.hasNext() && !abortou && exame < maxArq && (Date.now() - inicio <= budget);
      var removidos = 0;
      if (!simular) {
        if (!terminou) { try { _sp(P_TOKEN, iter.getContinuationToken()); } catch (eC) {} }
        else {
          _dp(P_TOKEN);
          if (completa) {   // varredura COMPLETA terminada: o que não foi visto saiu do Drive (ou foi para a lixeira/wiki)
            var antes = idx.itens.length;
            idx.itens = idx.itens.filter(function (it) { return it.sw === varredura; });
            removidos = antes - idx.itens.length; _sp(P_FULL, Date.now());
          }
          _sp(P_ULT, varredura);
        }
        _gravarIndice(idx.itens, idx.id);
      }
      return { status: abortou ? 'abortado' : (simular ? 'simulado' : (terminou ? 'success' : 'continuar')), novos: novos, atualizados: atualizados, pulados: pulados,
               removidos: removidos, total: idx.itens.length, completa: completa, erro1: erro1 };
    } finally { try { lock.releaseLock(); } catch (eL) {} }
  }

  /** Chamado pelo tick de 15 min (Agenda.js). Desligado por padrão; nunca derruba o tick. */
  function tick() {
    if (!ativa()) return { status: 'desligada' };
    try { return indexar({ budgetMs: 70000, maxArquivos: 40 }); } catch (e) { Logger.log('[BuscaDrive.tick] ' + e.message); return { status: 'erro', erro: e.message }; }
  }

  /* ── busca ──────────────────────────────────────────────────────────────────────── */
  var _STOP = { 'para': 1, 'sobre': 1, 'documento': 1, 'arquivo': 1, 'planilha': 1, 'aquele': 1, 'aquela': 1, 'tenho': 1, 'achar': 1, 'procurar': 1 };
  function _tokens(s) { return _norm(s).split(/[^a-z0-9]+/).filter(function (t) { return t.length >= 4 && !_STOP[t]; }); }

  /**
   * @param {string} consulta  o que ele procura, em linguagem natural
   * @param {Object} [opts]    { k (padrão 5, máx 10), tipo: documento|planilha|apresentacao|pdf|texto }
   * @return { ok, itens:[{nome, tipo, link, score, modificado, parcial}], indexados } | { ok:false, erro }
   */
  function buscar(consulta, opts) {
    opts = opts || {};
    var k = Math.max(1, Math.min(10, Number(opts.k) || 5));
    consulta = String(consulta || '').trim();
    if (!consulta) return { ok: false, erro: 'Diga o que procurar.' };
    var idx = _lerIndice();
    if (!idx.itens.length) return { ok: false, vazio: true, erro: 'O índice de arquivos do Drive ainda está vazio.' };
    var qv;
    try { qv = Gemini.embeddar(consulta, { tipo: 'RETRIEVAL_QUERY' }); } catch (e) { return { ok: false, erro: 'Não consegui gerar o vetor da busca: ' + e.message }; }
    if (!qv || !qv.length) return { ok: false, erro: 'Vetor da busca vazio.' };

    var itens = idx.itens;
    if (opts.tipo && opts.tipo !== 'todos') itens = itens.filter(function (it) { return it.tipo === opts.tipo; });
    if (!itens.length) return { ok: true, itens: [], indexados: idx.itens.length };

    // Centralização (mesma correção da Semantica.js): tira a direção média do corpus, que deixa todo cosseno alto à toa.
    var vs = itens.map(_decodificar), n = qv.length, mu = new Array(n), i, j;
    for (j = 0; j < n; j++) mu[j] = 0;
    for (i = 0; i < vs.length; i++) for (j = 0; j < n; j++) mu[j] += (vs[i][j] || 0);
    for (j = 0; j < n; j++) mu[j] /= vs.length;
    var qc = qv.map(function (x, j2) { return x - mu[j2]; }), nq = 0;
    for (j = 0; j < n; j++) nq += qc[j] * qc[j];
    nq = Math.sqrt(nq) || 1;
    var toks = _tokens(consulta);
    var res = itens.map(function (it, ii) {
      var v = vs[ii], dot = 0, nv = 0;
      for (var d = 0; d < n; d++) { var x = (v[d] || 0) - mu[d]; dot += x * qc[d]; nv += x * x; }
      var cos = dot / (nq * (Math.sqrt(nv) || 1));
      var nm = _norm(it.nome), bonus = 0;
      toks.forEach(function (t) { if (nm.indexOf(t) !== -1) bonus += 0.08; });
      return { it: it, score: cos + Math.min(bonus, 0.16) };
    });
    res.sort(function (a, b) { return b.score - a.score; });
    return { ok: true, indexados: idx.itens.length, itens: res.slice(0, k).map(function (r) {
      return { nome: r.it.nome, tipo: r.it.tipo, link: _linkDe(r.it.id, r.it.mime), score: Math.round(r.score * 1000) / 1000,
               modificado: r.it.mod ? new Date(r.it.mod).toISOString().slice(0, 10) : null, parcial: !!r.it.parcial };
    }) };
  }

  /** Plano B quando o índice ainda não existe: a busca de TEXTO do próprio Drive (lexical), para a pergunta não ficar sem resposta. */
  function buscaLexical(consulta, k) {
    var out = [];
    try {
      var q = String(consulta || '').replace(/['\\]/g, ' ').trim();
      if (!q) return out;
      var it = DriveApp.searchFiles("fullText contains '" + q + "' and trashed = false");
      var excl = _pastasExcluidas();
      while (it.hasNext() && out.length < (k || 5)) {
        var f = it.next(), nome = f.getName(), mime = ''; try { mime = f.getMimeType(); } catch (e) {}
        if (_naWiki(f, excl) || _excluidoPorNome(nome)) continue;
        out.push({ nome: nome, tipo: _tipoDe(mime, nome) || 'arquivo', link: _linkDe(f.getId(), mime), score: null, modificado: f.getLastUpdated().toISOString().slice(0, 10), parcial: false });
      }
    } catch (e) {}
    return out;
  }

  function status() {
    var idx = _lerIndice(), porTipo = {}, parciais = 0;
    idx.itens.forEach(function (it) { porTipo[it.tipo] = (porTipo[it.tipo] || 0) + 1; if (it.parcial) parciais++; });
    return { ativa: ativa(), indexados: idx.itens.length, porTipo: porTipo, soPeloNome: parciais, varreduraEmAndamento: !!_p(P_TOKEN),
             ultimaVarredura: Number(_p(P_ULT) || 0) ? new Date(Number(_p(P_ULT))).toISOString() : null, max: _max() };
  }

  function limpar() { _dp(P_TOKEN); _dp(P_ULT); _dp(P_FULL); _dp(P_SW); var idx = _lerIndice(); if (idx.id) { try { DriveApp.getFileById(idx.id).setContent('[]'); } catch (e) {} } return { ok: true }; }

  return { indexar: indexar, tick: tick, buscar: buscar, buscaLexical: buscaLexical, status: status, limpar: limpar, ativa: ativa,
           _quantizar: _quantizar, _decodificar: _decodificar, _tipoDe: _tipoDe, _linkDe: _linkDe };
})();

/** Diagnóstico no editor/ler_debug: {} → status · {consulta} → busca · {rodar:true} → indexa um lote · {simular:true} → conta sem gravar. */
function diagBuscaDrive(args) {
  args = args || {};
  if (args.limpar === true) return BuscaDrive.limpar();
  if (args.rodar === true) return BuscaDrive.indexar({ maxArquivos: Number(args.maxArquivos || 40), budgetMs: 100000, forcarCompleta: !!args.completa });
  if (args.simular === true) return BuscaDrive.indexar({ simular: true, maxArquivos: Number(args.maxArquivos || 200), budgetMs: 100000 });
  if (args.consulta) return BuscaDrive.buscar(String(args.consulta), { k: Number(args.k || 5), tipo: args.tipo });
  return BuscaDrive.status();
}
