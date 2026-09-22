// ===================================================================================
// DriveUploads.js — Salva anexos do chat na Base de Conhecimento (Drive /raw/<categoria>)
// + classificação automática por tipo/nome + detector de credenciais (bloqueio de segurança).
// ===================================================================================

var DriveUploads = {

  // Sem fallback: o ID da pasta e do DONO, nao do projeto. Vive em RAW_DRIVE_ID.
  // ID da pasta raw/ — Script Property RAW_DRIVE_ID (definida por configurarBaseConhecimento) tem prioridade.
  _rawRootId: function () {
    var id = PropertiesService.getScriptProperties().getProperty('RAW_DRIVE_ID');
    if (!id) throw new Error('RAW_DRIVE_ID nao configurado nas Script Properties (pasta BaseConhecimento/raw).');
    return id;
  },
  // Nomes canônicos das subpastas (case-insensitive na resolução para evitar duplicatas)
  CATEGORIAS: ['articles', 'assets', 'dados_Internet', 'datasets', 'notes', 'papers', 'repos', 'transcripts'],
  // Categorias que valem sugerir ingestão na wiki (conteúdo de conhecimento)
  INGERIVEIS: ['articles', 'papers', 'notes', 'transcripts', 'dados_Internet'],

  /** Detecta se um anexo provavelmente contém credenciais/segredos. */
  pareceCredencial: function (nome, amostra) {
    var n = String(nome || '').toLowerCase();
    if (/\.(pem|key|p12|pfx|keystore|jks)$/.test(n)) return true;
    var t = String(amostra || '');
    var padroes = [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /-----BEGIN OPENSSH PRIVATE KEY-----/,
      /"private_key"\s*:/,
      /"type"\s*:\s*"service_account"/,
      /AIza[0-9A-Za-z_\-]{30,}/,                 // Google API key
      /\bAKIA[0-9A-Z]{16}\b/,                     // AWS access key id
      /xox[baprs]-[0-9A-Za-z\-]{10,}/,            // Slack token
      /gh[pousr]_[0-9A-Za-z]{20,}/,               // GitHub PAT/token
      /\bsk-(?:or-)?[0-9A-Za-z\-]{20,}\b/,        // OpenAI / OpenRouter
      /client_secret/i,
      /\bbearer\s+[0-9A-Za-z._\-]{20,}/i,         // Authorization: Bearer ...
      /\b\d{8,10}:[A-Za-z0-9_\-]{30,}\b/,         // Telegram bot token
      // Campo JSON de segredo com valor não-trivial (token/secret/senha/apikey/botToken/access_token...)
      /"(?:bot_?token|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|bearer)"\s*:\s*"[^"]{12,}"/i
    ];
    for (var i = 0; i < padroes.length; i++) if (padroes[i].test(t)) return true;
    return false;
  },

  /** Classifica o anexo numa das categorias da base de conhecimento. */
  classificar: function (anexo) {
    var nome = String(anexo.nome || '').toLowerCase();
    var mime = String(anexo.mimeType || '').toLowerCase();
    var ext = (nome.match(/\.([a-z0-9]+)$/) || [])[1] || '';

    if (anexo.tipo === 'inline' && mime.indexOf('image/') === 0) return 'assets';
    if (['csv', 'tsv', 'xlsx', 'xls', 'parquet'].indexOf(ext) !== -1) return 'datasets';
    if (['zip', 'tar', 'gz', 'js', 'ts', 'py', 'java', 'go', 'rs', 'rb', 'sql', 'ipynb', 'sh'].indexOf(ext) !== -1 || /(^|[-_ ])(repo|code|src)([-_ ]|$)/.test(nome)) return 'repos';
    if (['srt', 'vtt'].indexOf(ext) !== -1 || /transcri|legenda|caption/.test(nome)) return 'transcripts';
    if (/paper|preprint|arxiv|doi|cientif/.test(nome)) return 'papers';
    if (ext === 'pdf') return 'papers';
    if (ext === 'md' || ext === 'txt' || /note|anota|resumo/.test(nome)) return 'notes';
    if (/article|artigo|blog|post/.test(nome) || mime.indexOf('text/html') !== -1) return 'articles';
    if (ext === 'json') return 'datasets';
    return 'dados_Internet';
  },

  /** Classifica via Gemini (mais preciso). Retorna uma categoria válida ou null (cai no heurístico). */
  classificarIA: function (anexo) {
    try {
      if (typeof Gemini === 'undefined' || !Gemini.temChave()) return null;
      var ctx = 'Nome do arquivo: "' + (anexo.nome || '') + '"\nMIME: ' + (anexo.mimeType || (anexo.tipo === 'texto' ? 'texto' : '')) + '\n';
      if (anexo.tipo === 'texto') ctx += 'Trecho do conteúdo:\n' + String(anexo.texto || '').substring(0, 1500);
      var prompt =
        'Classifique o arquivo abaixo em UMA categoria de uma base de conhecimento. Responda SOMENTE com o nome exato da categoria.\n' +
        'Categorias e definições:\n' +
        '- articles: artigos, posts, blog\n- assets: imagens e mídia\n- dados_Internet: páginas/recortes da web ou genérico\n' +
        '- datasets: dados tabulares (CSV/TSV/JSON/planilhas)\n- notes: anotações e resumos\n- papers: documentos longos, PDFs, artigos científicos\n' +
        '- repos: código-fonte e repositórios\n- transcripts: transcrições e legendas\n\n' + ctx;
      var c = Gemini.gerar({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 12 } }).json;
      var cand = c.candidates && c.candidates[0];
      var txt = (cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '').trim().toLowerCase();
      if (!txt) return null;
      for (var i = 0; i < this.CATEGORIAS.length; i++) {
        if (txt.indexOf(this.CATEGORIAS[i].toLowerCase()) !== -1) return this.CATEGORIAS[i];
      }
      return null;
    } catch (e) { return null; }
  },

  _subpasta: function (categoria) {
    var raiz = DriveApp.getFolderById(this._rawRootId());
    var alvo = String(categoria).toLowerCase();
    var it = raiz.getFolders();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().toLowerCase() === alvo) return f;
    }
    return raiz.createFolder(categoria); // cria com o nome canônico se não existir
  },

  /** Salva o anexo na subpasta da categoria. Retorna { id, url, nome, categoria }. */
  salvar: function (anexo) {
    var categoria = this.classificarIA(anexo) || this.classificar(anexo); // IA primeiro, heurística como fallback
    var pasta = this._subpasta(categoria);
    var nome = anexo.nome || ('anexo-' + Date.now());
    var blob;
    if (anexo.tipo === 'inline') {
      blob = Utilities.newBlob(Utilities.base64Decode(anexo.data), anexo.mimeType || 'application/octet-stream', nome);
    } else {
      blob = Utilities.newBlob(String(anexo.texto || ''), 'text/plain', nome);
    }
    var file = pasta.createFile(blob);
    return { id: file.getId(), url: file.getUrl(), nome: nome, categoria: categoria };
  },

  sugereIngestao: function (categoria) {
    return this.INGERIVEIS.indexOf(categoria) !== -1;
  }
};
