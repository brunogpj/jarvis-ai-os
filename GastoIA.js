// ===================================================================================
// GastoIA.js — quanto o Gemini está custando no mês, e o TETO que o dono definiu.
//
// O Google só mostra o custo horas (às vezes dias) depois, e não corta sozinho: o limite de R$ 1.482,74 da conta
// é do nível dele, não um teto de gasto. Aqui cada chamada soma tokens × preço (da tabela abaixo, copiada da página
// de preços da Gemini API em 14/10/2026), e o total do mês fica em Script Properties. Estimativa, não fatura:
// pode errar para menos se duas execuções gravarem no mesmo instante, e o câmbio (GEMINI_USD_BRL) é aproximado.
//
// Teto: GEMINI_ORCAMENTO_BRL (padrão 29,65 = 2% do limite). Avisa em 50%, 80% e 100% (uma vez por mês cada).
// Ao chegar em 100%, a chave de FATURAMENTO sai da cascata (Gemini._tentativas) até o mês virar.
// ===================================================================================

var GastoIA = (function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';
  var CHAVE = 'GEMINI_GASTO';
  var BUSCAS_GRATIS_MES = 5000;   // Gemini 3 e mais novos: 5.000 consultas de busca/mês grátis; depois US$ 14 por 1.000
  var BUSCA_USD = 0.014;

  /* Preços em dólar por 1 milhão de tokens. i = entrada de texto/imagem/vídeo, ia = entrada de áudio, o = saída
   * (inclui os tokens de raciocínio), oa = saída de ÁUDIO ou IMAGEM (modelos de TTS e de imagem).
   * dobraEm: a partir dessa data o preço dobra (anunciado na página de preços). O primeiro padrão que casar vale. */
  var PRECOS = [
    { re: /^gemini-3\.8-flash-lite-tts/,   i: 0.50, o: 0.50, oa: 6.00,  dobraEm: '2027-01-01' },
    { re: /^gemini-3\.8-flash-tts/,        i: 0.50, o: 0.50, oa: 9.00,  dobraEm: '2027-01-01' },
    { re: /tts/,                           i: 0.50, o: 0.50, oa: 10.00 },
    { re: /^gemini-3\.1-flash-lite-image/, i: 0.25, o: 1.50, oa: 30.00 },
    { re: /^gemini-3\.1-flash-image/,      i: 0.50, o: 3.00, oa: 60.00 },
    { re: /^gemini-3-pro-image/,           i: 2.00, o: 12.00, oa: 120.00 },
    { re: /^gemini-2\.5-flash-image/,      i: 0.30, o: 2.50, oa: 30.00 },
    { re: /^gemini-nano-banana/,           i: 1.50, o: 7.50, oa: 30.00 },
    { re: /^gemini-embedding/,             i: 0.20, o: 0 },
    { re: /^gemini-4-argon/,               i: 2.00, o: 10.00, dobraEm: '2026-12-01' },
    { re: /^gemini-3\.1-pro/,              i: 2.00, o: 12.00 },
    { re: /^gemini-3-flash-preview/,       i: 0.50, ia: 1.00, o: 3.00 },
    { re: /^gemini-3\.5-flash-lite/,       i: 0.30, o: 2.50 },
    { re: /^gemini-3\.1-flash-lite/,       i: 0.25, ia: 0.50, o: 1.50 },
    { re: /^gemini-3\.[5-8]-flash/,        i: 0.75, o: 3.75, dobraEm: '2027-01-01' },
    { re: /^gemini-2\.5-pro/,              i: 1.25, o: 10.00 },
    { re: /^gemini-2\.5-flash-lite/,       i: 0.10, ia: 0.30, o: 0.40 },
    { re: /^gemini-2\.5-flash/,            i: 0.30, ia: 1.00, o: 2.50 },
  ];
  // Modelo que não está na tabela: cobra como o Flash mais caro, para o gasto nunca ficar subestimado.
  var PRECO_DESCONHECIDO = { i: 0.75, o: 3.75, oa: 9.00, dobraEm: '2027-01-01' };

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
  function _hoje() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

  function _preco(modelo, hojeISO) {
    var m = String(modelo || '').toLowerCase(), p = PRECO_DESCONHECIDO;
    for (var i = 0; i < PRECOS.length; i++) { if (PRECOS[i].re.test(m)) { p = PRECOS[i]; break; } }
    var f = (p.dobraEm && String(hojeISO || _hoje()) >= p.dobraEm) ? 2 : 1;
    return { i: p.i * f, ia: (p.ia != null ? p.ia : p.i) * f, o: p.o * f, oa: (p.oa != null ? p.oa : p.o) * f };
  }

  function _tok(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  /**
   * Custo em DÓLAR de uma chamada, a partir do usageMetadata da resposta. PURA.
   * Saída = tokens da resposta + tokens de raciocínio (cobrados como saída). O que for de áudio/imagem na saída
   * usa o preço oa; entrada de áudio usa ia. Busca (grounding) é cobrada à parte, em registrar().
   */
  function custoUSD(modelo, uso, hojeISO) {
    uso = uso || {};
    var p = _preco(modelo, hojeISO);
    var entradaTotal = _tok(uso.promptTokenCount) + _tok(uso.toolUsePromptTokenCount);
    var entradaAudio = 0;
    (uso.promptTokensDetails || []).forEach(function (d) { if (/AUDIO/i.test(String(d.modality))) entradaAudio += _tok(d.tokenCount); });
    entradaAudio = Math.min(entradaAudio, entradaTotal);
    var saidaTotal = _tok(uso.candidatesTokenCount) + _tok(uso.thoughtsTokenCount);
    var saidaMidia = 0;
    (uso.candidatesTokensDetails || []).forEach(function (d) { if (/AUDIO|IMAGE/i.test(String(d.modality))) saidaMidia += _tok(d.tokenCount); });
    // TTS sem detalhe por modalidade: toda a saída é áudio
    if (!saidaMidia && /tts/i.test(String(modelo))) saidaMidia = saidaTotal;
    saidaMidia = Math.min(saidaMidia, saidaTotal);
    return ((entradaTotal - entradaAudio) * p.i + entradaAudio * p.ia + (saidaTotal - saidaMidia) * p.o + saidaMidia * p.oa) / 1e6;
  }

  function _mes() { return _hoje().slice(0, 7); }
  function _ler() {
    var d = null;
    try { d = JSON.parse(_p(CHAVE) || 'null'); } catch (e) {}
    if (!d || d.mes !== _mes()) d = { mes: _mes(), usd: 0, n: 0, buscas: 0, porModelo: {}, avisos: {}, ant: d ? { mes: d.mes, usd: d.usd } : null };
    return d;
  }
  function _gravar(d) { try { PropertiesService.getScriptProperties().setProperty(CHAVE, JSON.stringify(d)); } catch (e) {} }

  function cambio() { var c = Number(_p('GEMINI_USD_BRL')); return (isFinite(c) && c > 0) ? c : 5.7; }
  function teto() { var t = Number(_p('GEMINI_ORCAMENTO_BRL')); return (isFinite(t) && t > 0) ? t : 29.65; }

  /** Registra o custo de uma chamada. NUNCA lança (gasto é telemetria; não pode derrubar a resposta). */
  function registrar(modelo, uso, extras) {
    try {
      extras = extras || {};
      var d = _ler();
      var usd = custoUSD(modelo, uso);
      var buscas = _tok(extras.buscas);
      if (buscas && /^gemini-[34]/.test(String(modelo))) {
        var antes = Math.max(0, d.buscas - BUSCAS_GRATIS_MES), depois = Math.max(0, d.buscas + buscas - BUSCAS_GRATIS_MES);
        usd += (depois - antes) * BUSCA_USD;
      }
      d.usd += usd; d.n += 1; d.buscas += buscas;
      var m = String(modelo || '?');
      var pm = d.porModelo[m] || (d.porModelo[m] = { n: 0, usd: 0 });
      pm.n += 1; pm.usd += usd;
      d.ultimo = Date.now();
      _gravar(d);
      _avisarLimiares(d);
    } catch (e) { try { Logger.log('[GastoIA] ' + e.message); } catch (e2) {} }
  }

  function _avisarLimiares(d) {
    var pct = d.usd * cambio() / teto() * 100, mudou = false;
    [50, 80, 100].forEach(function (lim) {
      if (pct >= lim && !d.avisos['a' + lim]) {
        d.avisos['a' + lim] = Date.now(); mudou = true;
        try {
          var brl = (d.usd * cambio()).toFixed(2).replace('.', ',');
          var tx = lim >= 100
            ? 'O gasto estimado do Gemini neste mês chegou a R$ ' + brl + ', o teto definido. Desliguei a chave paga até o mês virar.'
            : 'O gasto estimado do Gemini neste mês está em R$ ' + brl + ', ' + lim + '% do teto.';
          if (typeof _avisarDono === 'function') _avisarDono({ origem: 'gasto_ia', titulo: 'Gasto do Gemini: ' + lim + '% do teto', texto: tx });
        } catch (e) {}
      }
    });
    if (mudou) _gravar(d);
  }

  /** Resumo do mês para o painel/ler_debug/voz. */
  function estado() {
    var d = _ler(), c = cambio(), t = teto();
    var brl = d.usd * c, dia = Number(_hoje().slice(8, 10));
    var diasMes = new Date(Date.UTC(Number(_hoje().slice(0, 4)), Number(_hoje().slice(5, 7)), 0)).getUTCDate();
    var porModelo = {};
    Object.keys(d.porModelo).forEach(function (k) { porModelo[k] = { chamadas: d.porModelo[k].n, brl: Math.round(d.porModelo[k].usd * c * 100) / 100 }; });
    return { mes: d.mes, gastoBRL: Math.round(brl * 100) / 100, tetoBRL: t, pct: Math.round(brl / t * 1000) / 10,
             projecaoBRL: Math.round(brl / Math.max(dia, 1) * diasMes * 100) / 100, chamadas: d.n, buscas: d.buscas,
             porModelo: porModelo, cambio: c, esgotado: brl >= t, mesAnterior: d.ant || null };
  }

  /** O teto do mês foi atingido? (GEMINI_ORCAMENTO_ATIVO=nao desliga a trava.) */
  function esgotado() {
    try {
      if (String(_p('GEMINI_ORCAMENTO_ATIVO') || 'sim').toLowerCase() === 'nao') return false;
      var d = _ler();
      return d.usd * cambio() >= teto();
    } catch (e) { return false; }
  }

  return { registrar: registrar, custoUSD: custoUSD, estado: estado, esgotado: esgotado, cambio: cambio, teto: teto, PRECOS: PRECOS };
})();
