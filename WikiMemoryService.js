// ===================================================================================
// WikiMemoryService.js — Memória Cumulativa via Google Drive Wiki
// v1.0.0 — Protocolo LLM.md: /raw/ (imutável) + /wiki/ (mantido pelo Jarvis)
// ===================================================================================
//
// Script Property obrigatória: WIKI_DRIVE_ID
// Valor: ID da pasta "wiki" no Google Drive (ex: <WIKI_DRIVE_ID>)
//
// Estrutura esperada no Drive:
//   wiki/
//     index.md
//     log.md
//     sources/
//     concepts/
//     entities/
//     outputs/
// ===================================================================================

const WikiMemoryService = {

  _folderId: null,

  // ── Cache interno de handles de pasta para evitar chamadas repetidas ao Drive ──
  _folderCache: {},

  _getWikiFolderId: function() {
    if (this._folderId) return this._folderId;
    const id = PropertiesService.getScriptProperties().getProperty('WIKI_DRIVE_ID');
    if (!id) throw new Error('WIKI_DRIVE_ID não configurado nas Script Properties. Use o ID: <WIKI_DRIVE_ID>');
    this._folderId = id;
    return id;
  },

  _getWikiRoot: function() {
    return DriveApp.getFolderById(this._getWikiFolderId());
  },

  // Navega para uma subpasta por caminho relativo (ex: "concepts" ou "sources")
  // Cria as pastas intermediárias se não existirem
  _navegarPasta: function(caminhoPasta) {
    const partes = caminhoPasta.split('/').filter(Boolean);
    let pasta = this._getWikiRoot();
    for (let i = 0; i < partes.length; i++) {
      const nome = partes[i];
      const cacheKey = pasta.getId() + '/' + nome;
      if (this._folderCache[cacheKey]) {
        pasta = this._folderCache[cacheKey];
        continue;
      }
      const iter = pasta.getFoldersByName(nome);
      if (iter.hasNext()) {
        pasta = iter.next();
      } else {
        pasta = pasta.createFolder(nome);
        Logger.log('[WikiMemoryService] Pasta criada: ' + nome);
      }
      this._folderCache[cacheKey] = pasta;
    }
    return pasta;
  },

  // ── Parseia caminho "conceitos/redes-neurais.md" → { pasta: "conceitos", arquivo: "redes-neurais.md" }
  _parsearCaminho: function(caminho) {
    const partes = caminho.replace(/^\//, '').split('/');
    const nomeArquivo = partes.pop();
    const caminhoPasta = partes.join('/');
    return { caminhoPasta: caminhoPasta, nomeArquivo: nomeArquivo };
  },

  // ===================================================================================
  // FERRAMENTAS PÚBLICAS (chamadas pelo AgenteJarvis via Function Calling)
  // ===================================================================================

  /**
   * Lê um arquivo do wiki pelo caminho relativo.
   * Ex: lerWiki("concepts/redes-neurais.md")
   * Ex: lerWiki("index.md")
   */
  lerWiki: function(caminho) {
    try {
      Logger.log('[WikiMemoryService] lerWiki: ' + caminho);
      const { caminhoPasta, nomeArquivo } = this._parsearCaminho(caminho);
      const pasta = caminhoPasta ? this._navegarPasta(caminhoPasta) : this._getWikiRoot();

      const iter = pasta.getFilesByName(nomeArquivo);
      if (!iter.hasNext()) {
        return { status: 'not_found', mensagem: 'Arquivo "' + caminho + '" não encontrado no wiki.' };
      }
      const arquivo = iter.next();
      const conteudo = arquivo.getBlob().getDataAsString();
      return {
        status: 'success',
        caminho: caminho,
        conteudo: conteudo,
        tamanho: conteudo.length,
        ultimaModificacao: arquivo.getLastUpdated().toISOString()
      };
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro lerWiki: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Lista arquivos de uma pasta do wiki.
   * Ex: listarWiki("concepts") → lista todos os .md em concepts/
   * Ex: listarWiki("") → lista a raiz
   */
  listarWiki: function(pasta) {
    try {
      Logger.log('[WikiMemoryService] listarWiki: ' + (pasta || 'raiz'));
      const folder = pasta ? this._navegarPasta(pasta) : this._getWikiRoot();

      const arquivos = [];
      const iterFiles = folder.getFiles();
      while (iterFiles.hasNext()) {
        const f = iterFiles.next();
        arquivos.push({ nome: f.getName(), tamanho: f.getSize(), modificado: f.getLastUpdated().toISOString() });
      }

      const subpastas = [];
      const iterFolders = folder.getFolders();
      while (iterFolders.hasNext()) {
        const sub = iterFolders.next();
        subpastas.push({ nome: sub.getName(), tipo: 'pasta' });
      }

      return { status: 'success', pasta: pasta || 'raiz', arquivos: arquivos, subpastas: subpastas };
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro listarWiki: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Busca arquivos relevantes no wiki por termo de busca.
   * Busca nos nomes dos arquivos e nas primeiras 500 chars do conteúdo.
   * Retorna até 5 resultados mais relevantes com trechos.
   */
  // Caminho relativo de um arquivo dentro do wiki (ex.: "concepts/x.md") ou null se não estiver no wiki.
  _caminhoRelativo: function(file, wikiId) {
    try {
      const partes = [file.getName()];
      let it = file.getParents();
      let guard = 0;
      while (it.hasNext() && guard < 20) {
        guard++;
        const p = it.next();
        if (p.getId() === wikiId) return partes.join('/');
        partes.unshift(p.getName());
        it = p.getParents();
      }
    } catch (e) {}
    return null; // não está sob a pasta do wiki
  },

  buscarNoWiki: function(termo) {
    try {
      Logger.log('[WikiMemoryService] buscarNoWiki: ' + termo);
      const termoLower = String(termo).toLowerCase();
      // Cache do resultado por termo (30min) — abrir arquivos do Drive p/ o trecho é o que custava ~40s.
      const _ck = 'wiki_kw_' + (function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); })(termoLower);
      const _cache = CacheService.getScriptCache();
      try { var _hit = _cache.get(_ck); if (_hit) return JSON.parse(_hit); } catch (eH) {}
      const resultados = [];
      const wikiId = this._getWikiFolderId();
      const self = this;

      // ── 1) Busca NATIVA do Drive (server-side, rápida): só lê o conteúdo dos arquivos que casam ──
      try {
        const q = 'fullText contains "' + String(termo).replace(/["\\]/g, ' ') + '" and trashed = false';
        const it = DriveApp.searchFiles(q);
        let examinados = 0;
        while (it.hasNext() && examinados < 8 && resultados.length < 6) { // abre só os mais relevantes (o Drive já ordena)
          const f = it.next(); examinados++;
          const nome = f.getName();
          if (!/\.(md|txt)$/i.test(nome)) continue;
          if (typeof ehMetaArquivoWiki === 'function' && ehMetaArquivoWiki(nome)) continue; // pula manual/índice/log
          const caminho = self._caminhoRelativo(f, wikiId);
          if (!caminho || caminho.toLowerCase().indexOf('raw/') === 0) continue; // fora do wiki ou em raw/
          let conteudo = '';
          try { conteudo = f.getBlob().getDataAsString().substring(0, 1500); } catch (e) { continue; }
          const cl = conteudo.toLowerCase();
          const idx = cl.indexOf(termoLower);
          const ocorr = (cl.match(new RegExp(termoLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          const trecho = (idx >= 0 ? conteudo.substring(Math.max(0, idx - 100), Math.max(0, idx - 100) + 300) : conteudo.substring(0, 240)).replace(/\n/g, ' ');
          resultados.push({ caminho: caminho, relevancia: (nome.toLowerCase().indexOf(termoLower) !== -1 ? 10 : 0) + ocorr * 2 + 3, trecho: trecho });
        }
      } catch (eNativa) { Logger.log('[WikiMemoryService] busca nativa indisponível: ' + eNativa.message); }

      if (resultados.length) {
        resultados.sort(function (a, b) { return b.relevancia - a.relevancia; });
        var _r1 = { status: 'success', termo: termo, total_encontrados: resultados.length, resultados: resultados.slice(0, 5), via: 'drive-fulltext' };
        try { _cache.put(_ck, JSON.stringify(_r1), 1800); } catch (eP) {}
        return _r1;
      }

      // ── 2) Fallback: varredura recursiva (se a busca nativa não retornou nada) ──
      const MAX_ARQUIVOS = 30;       // limite de varredura (cada leitura é uma chamada ao Drive → mantém rápido)
      const estado = { lidos: 0 };

      const _buscarEmPasta = function(folder, prefixo) {
        if (estado.lidos >= MAX_ARQUIVOS) return;
        const iterFiles = folder.getFiles();
        while (iterFiles.hasNext() && estado.lidos < MAX_ARQUIVOS) {
          const f = iterFiles.next();
          const nome = f.getName();
          if (!nome.endsWith('.md') && !nome.endsWith('.txt')) continue;
          if (typeof ehMetaArquivoWiki === 'function' && ehMetaArquivoWiki(nome)) continue; // pula manual/índice/log
          estado.lidos++;

          const caminho = prefixo ? prefixo + '/' + nome : nome;
          let relevancia = 0;

          // Relevância por nome do arquivo
          if (nome.toLowerCase().indexOf(termoLower) !== -1) relevancia += 10;

          // Relevância por conteúdo (lê apenas primeiros 2000 chars)
          try {
            const conteudo = f.getBlob().getDataAsString().substring(0, 1200);
            const ocorrencias = (conteudo.toLowerCase().match(new RegExp(termoLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            relevancia += ocorrencias * 2;

            if (relevancia > 0) {
              // Extrai trecho relevante (janela de 300 chars ao redor da primeira ocorrência)
              const idx = conteudo.toLowerCase().indexOf(termoLower);
              const inicio = Math.max(0, idx - 100);
              const trecho = conteudo.substring(inicio, inicio + 300).replace(/\n/g, ' ');
              resultados.push({ caminho: caminho, relevancia: relevancia, trecho: trecho });
            }
          } catch (e) { /* ignora arquivos ilegíveis */ }
        }

        // Busca recursiva nas subpastas (pula 'raw' — clippings brutos volumosos)
        const iterFolders = folder.getFolders();
        while (iterFolders.hasNext() && estado.lidos < MAX_ARQUIVOS) {
          const sub = iterFolders.next();
          if (sub.getName().toLowerCase() === 'raw') continue;
          _buscarEmPasta(sub, prefixo ? prefixo + '/' + sub.getName() : sub.getName());
        }
      };

      _buscarEmPasta(this._getWikiRoot(), '');

      // Ordena por relevância e retorna top 5
      resultados.sort(function(a, b) { return b.relevancia - a.relevancia; });
      const top5 = resultados.slice(0, 5);

      var _r2 = { status: 'success', termo: termo, total_encontrados: resultados.length, resultados: top5 };
      try { _cache.put(_ck, JSON.stringify(_r2), 1800); } catch (eP2) {}
      return _r2;
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro buscarNoWiki: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Adiciona (APPEND) uma entrada datada ao log.md — NUNCA apaga o conteúdo existente.
   * Use isto para registrar no log, em vez de escreverWiki (que sobrescreve).
   */
  registrarNoLog: function(entrada) {
    try {
      const root = this._getWikiRoot();
      const it = root.getFilesByName('log.md');
      let atual = '', arquivo = null;
      if (it.hasNext()) { arquivo = it.next(); atual = arquivo.getBlob().getDataAsString(); }
      const carimbo = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
      const linha = '- [' + carimbo + '] ' + String(entrada || '').trim();
      const novo = atual && atual.trim()
        ? (atual.replace(/\s+$/, '') + '\n' + linha + '\n')
        : ('# Log\n\n' + linha + '\n');
      if (arquivo) arquivo.setContent(novo); else root.createFile('log.md', novo, 'text/plain');
      Logger.log('[WikiMemoryService] registrarNoLog: ' + linha);
      return { status: 'success', registrado: linha };
    } catch (err) {
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Cria ou atualiza um arquivo no wiki.
   * Segue o protocolo LLM.md: nomenclatura com hífens, sem acentos em nomes de arquivo.
   * Modo 'anexar' faz APPEND (preserva o conteúdo); padrão substitui.
   * Ex: escreverWiki("concepts/function-calling.md", "# Function Calling\n\n...")
   */
  escreverWiki: function(caminho, conteudo, modo) {
    try {
      Logger.log('[WikiMemoryService] escreverWiki: ' + caminho);
      const { caminhoPasta, nomeArquivo } = this._parsearCaminho(caminho);

      // Validação: só permite escrever em /wiki/, nunca em /raw/
      if (caminho.indexOf('raw/') !== -1) {
        return { status: 'blocked', mensagem: 'Escrita em /raw/ é proibida. O raw/ é imutável pelo protocolo LLM.md.' };
      }

      const pasta = caminhoPasta ? this._navegarPasta(caminhoPasta) : this._getWikiRoot();
      const iter = pasta.getFilesByName(nomeArquivo);

      const anexar = String(modo || '').toLowerCase() === 'anexar';
      let arquivo;
      let acao;
      if (iter.hasNext()) {
        arquivo = iter.next();
        if (anexar) {
          const base = arquivo.getBlob().getDataAsString();
          arquivo.setContent((base ? base.replace(/\s+$/, '') + '\n\n' : '') + conteudo);
          acao = 'anexado';
        } else {
          arquivo.setContent(conteudo);
          acao = 'atualizado';
        }
      } else {
        arquivo = pasta.createFile(nomeArquivo, conteudo, 'text/plain');
        acao = 'criado';
      }

      Logger.log('[WikiMemoryService] Arquivo ' + acao + ': ' + caminho);
      return {
        status: 'success',
        acao: acao,
        caminho: caminho,
        fileId: arquivo.getId(),
        url: arquivo.getUrl()
      };
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro escreverWiki: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Ingere uma fonte do /raw/ e cria a página correspondente em /wiki/sources/.
   * Segue o fluxo do LLM.md §2d. O agente lê o raw, extrai estrutura e escreve no wiki.
   * @param {string} fileId - ID do arquivo no Drive (em /raw/)
   * @param {string} instrucoes - Ângulos ou temas específicos a enfatizar (opcional)
   */
  ingerirFonte: function(fileId, instrucoes) {
    try {
      Logger.log('[WikiMemoryService] ingerirFonte: ' + fileId);
      const arquivo = DriveApp.getFileById(fileId);
      const blob = arquivo.getBlob();
      const mime = blob.getContentType() || '';
      const nomeArquivo = arquivo.getName();

      // Arquivos binários (PDF/imagem) não podem ser lidos como texto simples.
      if (mime === 'application/pdf' || mime.indexOf('image/') === 0) {
        return {
          status: 'binario',
          nome: nomeArquivo,
          fileId: fileId,
          mimeType: mime,
          mensagem: 'Arquivo binário (' + mime + '): não é possível extrair texto por leitura simples. ' +
            'A ingestão de PDF/imagem é feita de forma multimodal pelo botão "Ingerir na wiki" do chat (que envia o arquivo ao modelo). ' +
            'Peça ao usuário para usar esse botão, ou para reanexar o arquivo no chat.'
        };
      }

      const conteudoRaw = blob.getDataAsString().substring(0, 8000); // Limita para caber no contexto

      return {
        status: 'success',
        nome: nomeArquivo,
        fileId: fileId,
        conteudo_parcial: conteudoRaw,
        instrucoes: instrucoes || '',
        proximos_passos: [
          '1. Leia o conteudo_parcial acima',
          '2. Crie um resumo seguindo o template sources/ do LLM.md',
          '3. Use escreverWiki("sources/YYYY-MM-DD_slug.md", conteudo) para salvar',
          '4. Identifique entidades e conceitos → crie/atualize páginas em entities/ e concepts/',
          '5. Atualize index.md e log.md via escreverWiki'
        ]
      };
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro ingerirFonte: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  /**
   * Lista os arquivos da pasta /raw/ (recursivo, irmã da wiki/ via RAW_DRIVE_ID) e marca quais JÁ
   * foram ingeridos — i.e., têm página em /wiki/sources/ que referencia o nome do bruto. Resolve
   * "o que na raw ainda não foi ingerido?". Antes, o agente não tinha como ENXERGAR a raw.
   * @param {Object} [opts] { somenteNaoIngeridos?:boolean, max?:number }
   */
  listarRaw: function(opts) {
    opts = opts || {};
    var rawId = PropertiesService.getScriptProperties().getProperty('RAW_DRIVE_ID');
    if (!rawId) return { status: 'error', erro: 'RAW_DRIVE_ID não configurado. Rode configurarBaseConhecimento(<ID da BaseConhecimento>) no editor.' };
    var rawFolder;
    try { rawFolder = DriveApp.getFolderById(rawId); } catch (e) { return { status: 'error', erro: 'Pasta raw inacessível (RAW_DRIVE_ID=' + rawId + '): ' + e.message }; }

    // 1) Nomes de brutos JÁ referenciados por páginas sources/ (= ingeridos). Heurística por nome.
    var refs = {}, srcLidas = 0;
    try {
      var srcIt = this._navegarPasta('sources').getFiles();
      while (srcIt.hasNext() && srcLidas < 400) {
        var sf = srcIt.next(); srcLidas++;
        var txt = ''; try { txt = sf.getBlob().getDataAsString().substring(0, 4000); } catch (e) {}
        (txt.match(/raw\/[^)\]\s"']+/gi) || []).forEach(function (m) {
          var nome = m.split('/').pop(); try { nome = decodeURIComponent(nome); } catch (e) {}
          refs[nome.toLowerCase()] = true;
        });
      }
    } catch (e) {}

    // 2) Caminhada recursiva pela raw (subpastas: dados_Internet, papers, repos, assets...).
    var itens = [], max = Number(opts.max) || 300;
    function walk(folder, prefixo) {
      var fit = folder.getFiles();
      while (fit.hasNext() && itens.length < max) {
        var f = fit.next(), nome = f.getName();
        itens.push({ nome: nome, id: f.getId(), pasta: prefixo || '(raiz)', mime: f.getMimeType(), ingerido: !!refs[nome.toLowerCase()] });
      }
      var dit = folder.getFolders();
      while (dit.hasNext() && itens.length < max) { var d = dit.next(); walk(d, (prefixo ? prefixo + '/' : '') + d.getName()); }
    }
    walk(rawFolder, '');

    var naoIng = itens.filter(function (i) { return !i.ingerido; });
    return {
      status: 'success', total: itens.length, ingeridos: itens.length - naoIng.length, nao_ingeridos: naoIng.length,
      sources_lidas_no_drive: srcLidas, refs_de_raw_encontradas: Object.keys(refs).length,
      itens: opts.somenteNaoIngeridos ? naoIng : itens,
      dica: naoIng.length ? 'Para ingerir um não-ingerido: ingerirFonte(fileId) com o id retornado, depois escreverWiki nas páginas (sources/entities/concepts) + registrarNoLog. NÃO ingira LLM.md/index.md/log.md (são o manual/índice).' : 'Tudo na raw já tem página em sources/.'
    };
  },

  /**
   * Promove um arquivo .md do /raw/ para a estrutura /wiki/ sem custo de LLM.
   * Ideal para notas já formatadas ou organizadas pelo NotebookLM.
   * @param {string} caminhoRawOuId - Nome/caminho do arquivo em /raw/ ou o fileId no Drive.
   * @param {string} [subpastaWiki] - Subpasta destino em /wiki/ (ex: "sources", "entities", "concepts"). Padrão "sources".
   */
  promoverRawParaWiki: function(caminhoRawOuId, subpastaWiki) {
    try {
      subpastaWiki = subpastaWiki || 'sources';
      let f;
      if (/^[a-zA-Z0-9_-]{20,}$/.test(String(caminhoRawOuId))) {
        f = DriveApp.getFileById(caminhoRawOuId);
      } else {
        const rawId = PropertiesService.getScriptProperties().getProperty('RAW_DRIVE_ID');
        if (!rawId) return { status: 'error', erro: 'RAW_DRIVE_ID não configurado.' };
        const rawFolder = DriveApp.getFolderById(rawId);
        const { caminhoPasta, nomeArquivo } = this._parsearCaminho(caminhoRawOuId);
        const pastaTarget = caminhoPasta ? this._navegarPasta(caminhoPasta) : rawFolder;
        const it = pastaTarget.getFilesByName(nomeArquivo);
        if (!it.hasNext()) return { status: 'error', erro: 'Arquivo bruto "' + caminhoRawOuId + '" não encontrado.' };
        f = it.next();
      }

      const nome = f.getName();
      const conteudo = f.getBlob().getDataAsString('UTF-8');
      const slug = nome.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
      const destinoCaminho = subpastaWiki.replace(/^\/|\/$/g, '') + '/' + (slug.endsWith('.md') ? slug : (slug + '.md'));

      const res = this.escreverWiki(destinoCaminho, conteudo);
      this.registrarNoLog('Promovido de raw para wiki: "' + nome + '" → "' + destinoCaminho + '"');

      return {
        status: 'success',
        origem: nome,
        destino: destinoCaminho,
        tamanho: conteudo.length,
        detalhes: res
      };
    } catch (err) {
      Logger.log('[WikiMemoryService] Erro promoverRawParaWiki: ' + err.message);
      return { status: 'error', erro: err.message };
    }
  },

  // ===================================================================================
  // DECLARAÇÕES FC (Function Calling declarations para o Gemini)
  // ===================================================================================

  getToolDeclarations: function() {
    return [
      {
        name: 'promoverRawParaWiki',
        description: 'Promove um arquivo da pasta /raw/ (bruto) para o /wiki/ (fontes/conceitos) sem custo de LLM. Ideal para notas e resumos gerados pelo NotebookLM.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caminhoRawOuId: { type: 'STRING', description: 'Nome/caminho do arquivo em /raw/ ou o ID no Drive.' },
            subpastaWiki: { type: 'STRING', description: 'Subpasta destino no wiki. Ex: "sources", "entities", "concepts". Padrão "sources".' }
          },
          required: ['caminhoRawOuId']
        }
      },
      {
        name: 'lerWiki',
        description: 'Lê o conteúdo de um arquivo da base de conhecimento wiki. Use antes de responder perguntas sobre qualquer conceito, ferramenta, pessoa ou projeto que possa estar documentado. Sempre prefira ler o wiki antes de depender apenas do conhecimento interno do LLM.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caminho: { type: 'STRING', description: 'Caminho relativo do arquivo no wiki. Ex: "concepts/function-calling.md", "index.md", "entities/tool_langchain.md"' }
          },
          required: ['caminho']
        }
      },
      {
        name: 'listarWiki',
        description: 'Lista os arquivos e subpastas de uma seção do wiki. Use para descobrir o que está documentado antes de buscar ou ler.',
        parameters: {
          type: 'OBJECT',
          properties: {
            pasta: { type: 'STRING', description: 'Nome da pasta. Ex: "concepts", "entities", "sources", "outputs". Deixe vazio para listar a raiz.' }
          },
          required: []
        }
      },
      {
        name: 'buscarNoWiki',
        description: 'Busca arquivos relevantes no wiki por um termo. Retorna os 5 arquivos mais relevantes com trechos. Use quando não souber o caminho exato do arquivo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            termo: { type: 'STRING', description: 'Termo de busca. Ex: "redes neurais", "Google Apps Script", "RAG", "Kanshi Tanaike"' }
          },
          required: ['termo']
        }
      },
      {
        name: 'escreverWiki',
        description: 'Cria ou atualiza um arquivo no wiki (conceitos, entidades, fontes, index.md). ATENÇÃO: o modo padrão SOBRESCREVE o arquivo inteiro — para index.md, leia antes (lerWiki) e reescreva o conteúdo completo mesclado, ou use modo "anexar". NUNCA use escreverWiki para o log.md (use registrarNoLog). Nomes de arquivo em minúsculas com hífens, sem acentos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caminho:  { type: 'STRING', description: 'Caminho relativo. Ex: "concepts/attention-mechanism.md", "sources/2026-05-30_titulo-fonte.md", "index.md"' },
            conteudo: { type: 'STRING', description: 'Conteúdo em Markdown.' },
            modo:     { type: 'STRING', description: 'Opcional: "anexar" para acrescentar ao final preservando o existente; omita para substituir.' }
          },
          required: ['caminho', 'conteudo']
        }
      },
      {
        name: 'registrarNoLog',
        description: 'Adiciona uma entrada datada ao log.md do wiki SEM apagar o histórico (append). Use SEMPRE isto para registrar ações/aprendizados no log — nunca escreverWiki em log.md.',
        parameters: {
          type: 'OBJECT',
          properties: { entrada: { type: 'STRING', description: 'Texto da entrada de log (1-3 linhas).' } },
          required: ['entrada']
        }
      },
      {
        name: 'listarRaw',
        description: 'Lista os arquivos da pasta /raw/ (fontes BRUTAS: artigos, papers, imagens — irmã da wiki/) e marca quais JÁ foram ingeridos no wiki (têm página em sources/). USE para responder "o que na raw ainda não foi ingerido?" e para DESCOBRIR o fileId de um bruto antes de chamar ingerirFonte. Retorna nome, id, pasta e ingerido(true/false). NÃO confunda raw/ com a wiki/ (listarWiki).',
        parameters: {
          type: 'OBJECT',
          properties: {
            somenteNaoIngeridos: { type: 'BOOLEAN', description: 'true = retorna apenas os arquivos ainda NÃO ingeridos.' }
          },
          required: []
        }
      },
      {
        name: 'ingerirFonte',
        description: 'Ingere um arquivo de fonte bruta do Google Drive (/raw/) para o wiki. O agente lê o conteúdo e cria as páginas correspondentes em /wiki/sources/, /wiki/concepts/ e /wiki/entities/ seguindo o fluxo LLM.md §2d. Descubra o fileId com listarRaw.',
        parameters: {
          type: 'OBJECT',
          properties: {
            fileId:     { type: 'STRING', description: 'ID do arquivo no Google Drive (em /raw/)' },
            instrucoes: { type: 'STRING', description: 'Ângulos, temas ou conceitos específicos que o usuário quer enfatizar na ingestão (opcional)' }
          },
          required: ['fileId']
        }
      }
    ];
  }
};


// ===================================================================================
// SETUP: Configura a Script Property WIKI_DRIVE_ID
// Execute UMA VEZ no editor GAS após criar o projeto.
// ===================================================================================
function configurarWikiDriveId() {
  const WIKI_ID = '<WIKI_DRIVE_ID>'; // ID da pasta wiki no Drive
  PropertiesService.getScriptProperties().setProperty('WIKI_DRIVE_ID', WIKI_ID);
  Logger.log('✅ WIKI_DRIVE_ID configurado: ' + WIKI_ID);

  // Testa acesso
  try {
    const folder = DriveApp.getFolderById(WIKI_ID);
    Logger.log('✅ Acesso ao Drive confirmado. Pasta: ' + folder.getName());
  } catch (e) {
    Logger.log('❌ Erro ao acessar a pasta: ' + e.message + '. Verifique se o ID está correto e se o script tem permissão de acesso.');
  }
}

// Teste rápido das ferramentas do WikiMemoryService
function testarWikiMemoryService() {
  Logger.log('=== TESTE WikiMemoryService ===');

  // 1. Listar raiz
  const lista = WikiMemoryService.listarWiki('');
  Logger.log('Listar raiz: ' + JSON.stringify(lista).substring(0, 200));

  // 2. Ler index.md
  const index = WikiMemoryService.lerWiki('index.md');
  Logger.log('Ler index.md: ' + (index.status === 'success' ? '✅ OK (' + index.tamanho + ' chars)' : '❌ ' + index.mensagem));

  // 3. Busca
  const busca = WikiMemoryService.buscarNoWiki('IA');
  Logger.log('Buscar "IA": ' + busca.total_encontrados + ' resultados');

  Logger.log('=== FIM DO TESTE ===');
}
