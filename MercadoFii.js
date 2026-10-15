/**
 * MercadoFii — dados de MERCADO dos FIIs (cotação, P/VP, valor patrimonial, último rendimento, DY) lidos da página pública do Funds Explorer, no CÓDIGO.
 *
 * Por quê (15/10): o botão "Relatório FIIs" fazia o modelo improvisar e ele inventou uma tabela do IFIX sem dado nenhum. Aqui o número vem do HTML da página
 * (o mesmo que o navegador mostra), com a URL e a data da leitura, e quando a página muda de formato o campo some em vez de virar chute. NÃO é recomendação:
 * é leitura de dado público. A página não informa a HORA da cotação; o relatório diz "lido em <data/hora>" e os rendimentos trazem data-com e pagamento próprios.
 * Cache de 15 min (CacheService). Fail-open: página fora do ar → {ok:false}, e o relatório continua só com a caderneta.
 */
var MercadoFii = (function () {
  var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var CACHE_S = 900;

  function _num(s) {
    if (s == null) return null;
    var n = Number(String(s).replace(/\./g, '').replace(',', '.').trim());
    return isFinite(n) ? n : null;
  }
  function _iso(s) { var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }

  /** "KNRI11" → o ticker se tiver o formato de FII (4 letras + 11/12/13). null caso contrário. */
  function tickerValido(t) { t = String(t || '').toUpperCase().trim(); return /^[A-Z]{4}1[1-3]$/.test(t) ? t : null; }

  /** Lê o HTML do Funds Explorer. PURA. → {ticker, cotacao, variacao, pvp, vp, dy12, rendimento:{valor, dataCom, pagamento}} (campos que não aparecem ficam null). */
  function parse(html, ticker) {
    html = String(html || '');
    var out = { ticker: ticker, cotacao: null, variacao: null, pvp: null, vp: null, dy12: null, rendimento: null };
    var m = html.match(/headerTicker__content__price">\s*<p>\s*R\$\s*([\d.,]+)\s*<\/p>\s*<span[^>]*>\s*([-+]?[\d.,]+)\s*%/);
    if (m) { out.cotacao = _num(m[1]); out.variacao = _num(m[2]); }
    else { var m2 = html.match(/headerTicker__content__price">\s*<p>\s*R\$\s*([\d.,]+)/); if (m2) out.cotacao = _num(m2[1]); }
    // caixas de indicadores: <p>Rótulo</p> <p> ...<b> valor </b>
    function caixa(rotulo) {
      var re = new RegExp('<p>\\s*' + rotulo + '\\s*</p>\\s*<p>([\\s\\S]*?)</p>', 'i'), r = html.match(re);
      if (!r) return null;
      var n = r[1].replace(/<small>[^<]*<\/small>/g, ' ').replace(/<[^>]+>/g, ' ').match(/-?[\d.]+,\d+|-?\d+/);
      return n ? _num(n[0]) : null;
    }
    out.pvp = caixa('P\\/VP');
    out.vp = caixa('Valor Patrimonial');
    out.dy12 = caixa('Dividend Yield');
    // último rendimento: o JSON embutido na página traz valor, data-com (pr_database) e pagamento
    var v = html.match(/"pr_valor":\s*([\d.]+)/), dc = html.match(/"pr_database":\s*"([^"]+)"/), pg = html.match(/"pr_datapagamento":\s*"([^"]+)"/);
    if (v && Number(v[1]) > 0) out.rendimento = { valor: Math.round(Number(v[1]) * 10000) / 10000, dataCom: dc ? _iso(dc[1]) : null, pagamento: pg ? _iso(pg[1]) : null };
    else { var ur = caixa('Último Rendimento'); if (ur) out.rendimento = { valor: ur, dataCom: null, pagamento: null }; }
    return out;
  }

  function _url(t) { return 'https://www.fundsexplorer.com.br/funds/' + String(t).toLowerCase(); }

  /** Um ticker. → {ok, ...parse, fonte, lidoEm(ms)} | {ok:false, ticker, erro}. */
  function consultar(ticker) {
    var t = tickerValido(ticker);
    if (!t) return { ok: false, ticker: ticker, erro: 'ticker inválido' };
    var ck = 'mfii_' + t;
    try { var c = CacheService.getScriptCache().get(ck); if (c) return JSON.parse(c); } catch (e0) {}
    var res;
    try { res = UrlFetchApp.fetch(_url(t), { method: 'get', headers: { 'User-Agent': _UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, muteHttpExceptions: true, followRedirects: true }); }
    catch (e) { return { ok: false, ticker: t, erro: 'sem conexão' }; }
    if (res.getResponseCode() !== 200) return { ok: false, ticker: t, erro: 'HTTP ' + res.getResponseCode() };
    var d = parse(res.getContentText(), t);
    if (d.cotacao == null) return { ok: false, ticker: t, erro: 'a página mudou de formato' };
    d.ok = true; d.fonte = _url(t); d.lidoEm = Date.now();
    try { CacheService.getScriptCache().put(ck, JSON.stringify(d), CACHE_S); } catch (e1) {}
    return d;
  }

  /** Vários tickers, em ordem. → {TICKER: resultado}. */
  function consultarVarios(tickers) {
    var o = {};
    (tickers || []).forEach(function (t) { var k = tickerValido(t); if (k && !o[k]) o[k] = consultar(k); });
    return o;
  }

  return { parse: parse, consultar: consultar, consultarVarios: consultarVarios, tickerValido: tickerValido };
})();
