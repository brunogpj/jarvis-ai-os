/**
 * Midia.js — "me mostra fotos / vídeos / links de X" SEM o Gemini (11/11).
 *
 * POR QUÊ: em 11/11 o dono pediu por voz "notícias, vídeos e fotos" do GTA 6 e o pedido foi ao modelo, que não mostra imagem nem vídeo e ainda perguntou
 * "qual jogo?". Raspar a página de resultados do Google não é opção (exige JavaScript, bloqueia robô, e o layout muda em silêncio) e a Custom Search JSON API
 * foi fechada para clientes novos e desliga em 01/01/2027. O que sobra, de graça e estável:
 *   · VÍDEOS: YouTube Data API v3 (chave YOUTUBE_API_KEY, cota própria: ~100 buscas por dia). Sem chave, só o link da busca.
 *   · FOTOS: Wikipédia (imagem da página) e Wikimedia Commons, sem chave.
 *   · LINKS: a busca do Google já pronta (imagens udm=2, vídeos udm=7, notícias tbm=nws). Custo zero: quem abre é o navegador dele.
 * O texto ("quando lança?") continua com o agente e a pesquisa do Gemini; aqui não se redige nada, só se lista o que as fontes devolveram.
 */
var Midia = (function () {
  var TTL = 21600;   // 6 h: o mesmo pedido não gasta cota do YouTube de novo
  var UA = { 'User-Agent': 'JarvisAssistente/1.0 (uso pessoal)' };   // a Wikimedia pede um User-Agent identificável

  function _norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function _cache() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }

  /** Guarda o assunto da conversa por 10 min: "fotos do novo jogo" logo depois de "quando lança o GTA 6" vale para o GTA 6. */
  function lembrarTema(tema) {
    try { var t = String(tema || '').trim().substring(0, 80); var c = _cache(); if (t && c) c.put('midia_tema', t, 600); } catch (e) {}
  }
  function _temaRecente() { try { var c = _cache(); return (c && c.get('midia_tema')) || ''; } catch (e) { return ''; } }

  var _RE_VERBO = /\b(mostr\w*|ver|veja|vejo|traz|traga\w*|busc\w*|procur\w*|ach\w*|tem|temos|manda\w*|quero|queria|exib\w*|pesquis\w*|lista\w*)\b/;
  var _RE_MIDIA = /\b(fotos?|imagens?|videos?|trailers?)\b/;
  // Fora: coisa DELE (Drive, galeria, anexo), geração/edição de imagem, e o que já tem rota própria (YouTube, Spotify).
  var _RE_FORA = /\b(minhas?|meus?|drive|galeria|anexo|anexei|print|whatsapp|gera\w*|crie|cria\w*|desenh\w*|edit\w*|youtube|spotify|camera|tira\w*|grav\w*)\b/;
  var _VAGO = /\b(o|a|os|as|um|uma|novo|nova|esse|essa|este|esta|isso|disso|disto|aquele|aquela|jogo|filme|serie|ele|ela|dele|dela|assunto|tema|mesmo|la|ai|aqui)\b/g;

  /** Entende o pedido. Devolve {termo, fotos, videos, noticias} ou null (não é pedido de mídia, ou não dá para saber de quê). */
  function interpretar(msg) {
    var orig = String(msg || '').trim();
    var n = _norm(orig).replace(/[?!.;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n || n.length > 160) return null;
    if (!_RE_MIDIA.test(n) || !_RE_VERBO.test(n) || _RE_FORA.test(n)) return null;
    // o assunto é o que vem depois do ÚLTIMO "fotos/vídeos/notícias/links de|do|da|sobre"
    var re = /\b(?:fotos?|imagens?|videos?|trailers?|noticias?|links?)\s+(?:d[eoa]s?|sobre)\s+/g, m, fim = -1;
    while ((m = re.exec(n)) !== null) fim = m.index + m[0].length;
    if (fim < 0) return null;
    var termo = n.substring(fim);
    // o assunto acaba onde começa outra pergunta ou outro pedido: "do GTA 6 e o que tem de novo…", "do GTA 6, quando lança", "do GTA 6 que saiu hoje" (11/11: o assunto falado virou a frase inteira)
    termo = termo.split(/,| e (?:o |a |os |as |me |tambem |quando |qual |quais |como |onde |porque |por que |se )| (?:que|quando|qual|onde|porque|pois) /)[0];
    termo = termo.replace(/\b(por favor|pra mim|para mim|no chat|agora)\b/g, ' ').replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
    var semVago = termo.replace(_VAGO, ' ').replace(/\s+/g, ' ').trim();
    if (semVago.length < 2) {            // "do novo jogo", "disso": vale o assunto que acabou de ser falado, se houver
      termo = _temaRecente();
      if (!termo) return null;
    } else termo = semVago;
    if (termo.length > 80) return null;
    return { termo: termo, fotos: /\b(fotos?|imagens?)\b/.test(n), videos: /\b(videos?|trailers?)\b/.test(n), noticias: /\b(noticias?|links?)\b/.test(n) };
  }

  /** Links prontos da busca do Google (o navegador dele é quem abre: custo zero). */
  function linksGoogle(termo) {
    var q = encodeURIComponent(termo);
    return { imagens: 'https://www.google.com/search?q=' + q + '&udm=2', videos: 'https://www.google.com/search?q=' + q + '&udm=7',
             noticias: 'https://www.google.com/search?q=' + q + '&tbm=nws', youtube: 'https://www.youtube.com/results?search_query=' + q };
  }

  // O YouTube devolve o título com entidades HTML ("GTA 6&#39;s"); o chat escapa de novo e o código aparecia cru.
  function _entidades(s) { return String(s || '').replace(/&#(\d{2,5});/g, function (m, d) { return String.fromCharCode(Number(d)); }).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  function _limpo(s, n) { return _entidades(s).replace(/<[^>]*>/g, '').replace(/[\[\]\(\)\|\n\r]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, n || 90); }

  /** Busca nas fontes (uma rodada em paralelo). Nunca lança: fonte que falha fica vazia e é dita como tal. */
  function buscar(q) {
    var termo = q.termo, chave = 'midia_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, _norm(termo) + '|' + (q.videos ? 'v' : '') + (q.fotos ? 'f' : ''))).substring(0, 20);
    var c = _cache();
    try { var g = c && c.get(chave); if (g) return JSON.parse(g); } catch (e0) {}
    var key = '';
    try { key = String(PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY') || '').trim(); } catch (e1) {}
    var e = encodeURIComponent(termo), reqs = [], papel = [];
    function wiki(l) { return 'https://' + l + '.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&gsrsearch=' + e +
      '&prop=pageimages%7Cextracts%7Cinfo&piprop=thumbnail&pithumbsize=480&pilicense=any&exintro=1&explaintext=1&exsentences=2&exlimit=3&inprop=url'; }
    reqs.push({ url: wiki('pt'), headers: UA, muteHttpExceptions: true }); papel.push('wiki');
    reqs.push({ url: wiki('en'), headers: UA, muteHttpExceptions: true }); papel.push('wiki');
    if (q.fotos) { reqs.push({ url: 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=' + e +
      '&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=480', headers: UA, muteHttpExceptions: true }); papel.push('commons'); }
    if (q.videos && key) { reqs.push({ url: 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=4&relevanceLanguage=pt&q=' + e + '&key=' + encodeURIComponent(key), muteHttpExceptions: true }); papel.push('youtube'); }
    var r = { termo: termo, resumo: '', fonteResumo: '', fotos: [], videos: [], semChave: !!(q.videos && !key), falhas: [] };
    var res = [];
    try { res = UrlFetchApp.fetchAll(reqs); } catch (eF) { r.falhas.push('rede'); return r; }
    var visto = {};
    res.forEach(function (h, i) {
      var tipo = papel[i], j = null;
      try { if (h.getResponseCode() === 200) j = JSON.parse(h.getContentText()); } catch (eJ) {}
      if (!j) { if (r.falhas.indexOf(tipo) < 0) r.falhas.push(tipo); return; }
      if (tipo === 'youtube') {
        (j.items || []).forEach(function (it) {
          var id = it.id && it.id.videoId; if (!id || !/^[\w-]{6,20}$/.test(id)) return;
          r.videos.push({ titulo: _limpo((it.snippet || {}).title, 90), canal: _limpo((it.snippet || {}).channelTitle, 40), url: 'https://youtu.be/' + id, capa: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' });
        });
      } else {
        var pgs = (j.query && j.query.pages) || {}, lista = Object.keys(pgs).map(function (k) { return pgs[k]; }).sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        lista.forEach(function (p) {
          if (tipo === 'wiki') {
            if (!r.resumo && p.extract && p.index === 1) { r.resumo = _limpo(p.extract, 420); r.fonteResumo = String(p.fullurl || ''); }
            var t = p.thumbnail && p.thumbnail.source;
            if (t && /^https:\/\/upload\.wikimedia\.org\//.test(t) && !visto[t] && r.fotos.length < 6) { visto[t] = 1; r.fotos.push({ legenda: _limpo(p.title, 60), img: t, pagina: String(p.fullurl || '') }); }
          } else {
            var ii = (p.imageinfo || [])[0]; if (!ii || !/^image\/(jpeg|png|webp)$/.test(String(ii.mime || ''))) return;
            var u = ii.thumburl || '';
            if (/^https:\/\/upload\.wikimedia\.org\//.test(u) && !visto[u] && r.fotos.length < 6) { visto[u] = 1; r.fotos.push({ legenda: _limpo(String(p.title || '').replace(/^File:/, '').replace(/\.\w{3,4}$/, ''), 60), img: u, pagina: String(ii.descriptionurl || '') }); }
          }
        });
      }
    });
    try { if (c && !r.falhas.length) c.put(chave, JSON.stringify(r), TTL); } catch (e2) {}
    return r;
  }

  /** Resposta para o CHAT (markdown; o chat só mostra imagem de i.ytimg.com e upload.wikimedia.org). */
  function relatorio(q) {
    var r = buscar(q), g = linksGoogle(q.termo), L = [];
    lembrarTema(q.termo);
    L.push('## ' + _limpo(q.termo, 80) + ': ' + [q.videos ? 'vídeos' : '', q.fotos ? 'fotos' : '', 'links'].filter(Boolean).join(', '));
    if (r.resumo) { L.push(''); L.push('> ' + r.resumo + (r.fonteResumo ? ' ([Wikipédia](' + r.fonteResumo + '))' : '')); }
    if (q.videos) {
      L.push(''); L.push('### Vídeos');
      if (r.videos.length) r.videos.forEach(function (v) { L.push(''); L.push('[![' + v.titulo + '](' + v.capa + ')](' + v.url + ')'); L.push('**' + v.titulo + '**' + (v.canal ? ' · ' + v.canal : '') + ' · [abrir](' + v.url + ')'); });
      else L.push(r.semChave ? 'A busca de vídeos por aqui precisa da chave do YouTube (YOUTUBE_API_KEY), que não está configurada. Por enquanto: [vídeos no YouTube](' + g.youtube + ').'
                             : (r.falhas.indexOf('youtube') >= 0 ? 'O YouTube não respondeu agora. ' : 'Não achei vídeos por aqui. ') + '[Buscar no YouTube](' + g.youtube + ').');
    }
    if (q.fotos) {
      L.push(''); L.push('### Fotos');
      if (r.fotos.length) { L.push(''); L.push(r.fotos.map(function (f) { return f.pagina && /^https:\/\//.test(f.pagina) ? '[![' + f.legenda + '](' + f.img + ')](' + f.pagina + ')' : '![' + f.legenda + '](' + f.img + ')'; }).join(' ')); L.push(''); L.push('_Imagens da Wikipédia e do Wikimedia Commons; para mais, use o botão de imagens abaixo._'); }
      else L.push('A Wikipédia e o Wikimedia Commons não têm imagem para isso. Veja nas [imagens do Google](' + g.imagens + ').');
    }
    L.push(''); L.push('### No Google');
    L.push('[Imagens](' + g.imagens + ') · [Vídeos](' + g.videos + ') · [Notícias](' + g.noticias + ') · [YouTube](' + g.youtube + ')');
    if (q.noticias) { L.push(''); L.push('_Para um resumo das notícias, peça "resuma as notícias de ' + _limpo(q.termo, 60) + '" (essa parte usa a pesquisa paga)._'); }
    try { if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({ tool: 'midia:busca', ok: true, ms: 0, resumo: 'videos=' + r.videos.length + ' fotos=' + r.fotos.length + (r.semChave ? ' semChaveYT' : '') + (r.falhas.length ? ' falhas=' + r.falhas.join('+') : '') }); } catch (e) {}
    return L.join('\n');
  }

  /** Para o CHAT DO APP ANDROID (cartões nativos): os mesmos dados do relatório, em JSON. O app só carrega imagem de i.ytimg.com e upload.wikimedia.org. */
  function dados(q) {
    var r = buscar(q), g = linksGoogle(q.termo);
    lembrarTema(q.termo);
    try { if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({ tool: 'midia:app', ok: true, ms: 0, resumo: 'videos=' + r.videos.length + ' fotos=' + r.fotos.length + (r.semChave ? ' semChaveYT' : '') + (r.falhas.length ? ' falhas=' + r.falhas.join('+') : '') }); } catch (e) {}
    return { termo: _limpo(q.termo, 80), resumo: r.resumo, fonteResumo: r.fonteResumo, pediuVideos: !!q.videos, pediuFotos: !!q.fotos,
             videos: q.videos ? r.videos : [], fotos: q.fotos ? r.fotos : [], semChave: r.semChave,
             links: [{ rotulo: 'Imagens', url: g.imagens }, { rotulo: 'Vídeos', url: g.videos }, { rotulo: 'Notícias', url: g.noticias }, { rotulo: 'YouTube', url: g.youtube }] };
  }

  /** Para a VOZ: não busca nada (resposta na hora); devolve o link a abrir no celular e a frase. */
  function paraVoz(q) {
    var g = linksGoogle(q.termo);
    lembrarTema(q.termo);
    var soVideos = q.videos && !q.fotos;
    return { url: soVideos ? g.videos : g.imagens,
             fala: soVideos ? 'Abri no celular os vídeos de ' + q.termo + '.'
                            : 'Abri no celular as imagens de ' + q.termo + '.' + (q.videos ? ' Para os vídeos, toque em Vídeos na mesma página.' : '') };
  }

  return { interpretar: interpretar, buscar: buscar, relatorio: relatorio, dados: dados, paraVoz: paraVoz, linksGoogle: linksGoogle, lembrarTema: lembrarTema };
})();
