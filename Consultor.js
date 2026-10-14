// ===================================================================================
// Consultor.js — FASE 4 da caderneta: o Jarvis como consultor da ESTRATÉGIA DO PRÓPRIO DONO (só leitura, 100% no código).
//
// Não é um modelo opinando sobre investimentos. A estratégia vem da caderneta: a distribuição-alvo fica na config do app
// (`meta_alocacao`, devolvida em /api/jarvis/resumo como `metaAlocacao`), e as contas são feitas aqui, com os números do
// resumo. O Jarvis responde: como a carteira está contra o alvo, quanto dá para aportar este mês e onde pôr (aporte
// direcionado, nunca vender), simulações (aporte × tempo × taxa), reserva contra o alvo e progresso das metas. Estimativa,
// nunca promessa: a taxa é um parâmetro (CONSULTOR_TAXA_MES) que ele pode mudar. Nada aqui passa pelo Gemini.
// Parâmetros (Script Properties, nada pessoal no repositório): CONSULTOR_MARGEM (R$ que fica na conta, padrão 300),
// CONSULTOR_TAXA_MES (padrão 0,008 = 0,8% ao mês), CONSULTOR_RESERVA_ALVO (meses, padrão 6), CONSULTOR_PAUSA_ATE (AAAA-MM-DD,
// rebalanceamento pausado), CONSULTOR_METAS (JSON [{nome, alvo, ate}], gravado por voz com confirmação).
// ===================================================================================

var Consultor = (function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }
  function _num(k, padrao, min, max) {
    var v = Number(String(_p(k) || '').replace(',', '.'));
    return (isFinite(v) && v >= min && v <= max && _p(k) !== null && _p(k) !== '') ? v : padrao;
  }

  /** Parâmetros do consultor. PURA a partir das Script Properties. */
  function cfg() {
    var metas = [];
    try { metas = JSON.parse(_p('CONSULTOR_METAS') || '[]') || []; } catch (e) { metas = []; }
    return {
      margem: _num('CONSULTOR_MARGEM', 300, 0, 100000),
      taxaMes: _num('CONSULTOR_TAXA_MES', 0.008, 0, 0.05),
      reservaAlvo: _num('CONSULTOR_RESERVA_ALVO', 6, 1, 36),
      pausaAte: /^\d{4}-\d{2}-\d{2}$/.test(String(_p('CONSULTOR_PAUSA_ATE') || '')) ? String(_p('CONSULTOR_PAUSA_ATE')) : '',
      // para onde vai o aporte INTEIRO enquanto o rebalanceamento está pausado: {rotulo:'no cofrinho do Mercado Pago', descricao:'Cofrinho do Mercado Pago'} ou null
      destinoPausa: (function () {
        try {
          var x = JSON.parse(_p('CONSULTOR_DESTINO_PAUSA') || 'null');
          return (x && typeof x.rotulo === 'string' && x.rotulo && typeof x.descricao === 'string' && x.descricao) ? { rotulo: x.rotulo.slice(0, 80), descricao: x.descricao.slice(0, 60) } : null;
        } catch (e) { return null; }
      })(),
      metas: Array.isArray(metas) ? metas : []
    };
  }

  // ── formatação ────────────────────────────────────────────────────────────────────
  function brl(v) {
    var n = Math.abs(Number(v) || 0), partes = n.toFixed(2).split('.');
    return 'R$ ' + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + partes[1];
  }
  function pc(x) { return String(Math.round(x)).replace('.', ',') + '%'; }
  function nomeCat(c) { return String(c).replace(/\s*\/\s*(.)/g, function (m, x) { return ' e ' + x.toLowerCase(); }).replace(/^FIIs$/, 'fundos imobiliários'); }
  function taxaFalada(t) { return String(Math.round(t * 10000) / 100).replace('.', ',') + '% ao mês'; }
  function anosMeses(n) {
    var a = Math.floor(n / 12), m = n % 12, partes = [];
    if (a) partes.push(a + (a === 1 ? ' ano' : ' anos'));
    if (m) partes.push(m + (m === 1 ? ' mês' : ' meses'));
    return partes.join(' e ') || '0 mês';
  }
  function _mesFalado(ym) { return MESES[Number(String(ym).slice(5, 7)) - 1] + ' de ' + String(ym).slice(0, 4); }

  // ── matemática (PURA) ─────────────────────────────────────────────────────────────
  /** Valor futuro: saldo inicial P com aporte mensal A no fim de cada mês, n meses, taxa r ao mês. */
  function valorFuturo(P, A, r, n) {
    if (n <= 0) return P;
    if (!(r > 0)) return P + A * n;
    var f = Math.pow(1 + r, n);
    return P * f + A * (f - 1) / r;
  }
  /** Meses até chegar em `alvo`; null se passar de 100 anos. */
  function mesesAteAlvo(P, A, r, alvo) {
    if (P >= alvo) return 0;
    for (var n = 1; n <= 1200; n++) if (valorFuturo(P, A, r, n) >= alvo) return n;
    return null;
  }
  /** Aporte mensal que leva P a `alvo` em n meses. */
  function aporteNecessario(P, r, n, alvo) {
    if (n <= 0) return null;
    var sem = valorFuturo(P, 0, r, n);
    if (sem >= alvo) return 0;
    if (!(r > 0)) return (alvo - P) / n;
    var f = Math.pow(1 + r, n);
    return (alvo - sem) * r / (f - 1);
  }
  /**
   * Divide o aporte A pelas categorias para aproximar do alvo, SEM vender nada: cada categoria recebe segundo o quanto falta para o alvo
   * da carteira DEPOIS do aporte; se o aporte sobra, o excedente vai pelos pesos do alvo. Em centavos, fechando a soma.
   */
  function dividirAporte(atual, alvo, A) {
    var cats = Object.keys(alvo), total = 0;
    cats.forEach(function (c) { total += Number(atual[c]) || 0; });
    Object.keys(atual).forEach(function (c) { if (cats.indexOf(c) === -1) total += Number(atual[c]) || 0; });
    var T = total + A, falta = {}, soma = 0;
    cats.forEach(function (c) { falta[c] = Math.max(0, alvo[c] / 100 * T - (Number(atual[c]) || 0)); soma += falta[c]; });
    var parte = {}, usado = 0;
    cats.forEach(function (c) {
      var v = soma >= A ? (soma > 0 ? A * falta[c] / soma : 0) : falta[c] + (A - soma) * alvo[c] / 100;
      parte[c] = Math.floor(v * 100) / 100; usado += parte[c];
    });
    var resto = Math.round((A - usado) * 100) / 100;   // centavos que sobraram do arredondamento vão para a maior parte
    if (resto > 0 && cats.length) {
      var maior = cats.slice().sort(function (a, b) { return parte[b] - parte[a]; })[0];
      parte[maior] = Math.round((parte[maior] + resto) * 100) / 100;
    }
    return parte;
  }

  // ── respostas ─────────────────────────────────────────────────────────────────────
  function _inv(d) { return (d && d.investimentos) || {}; }
  function _pausado(c, hojeISO) { return !!c.pausaAte && String(hojeISO) < c.pausaAte; }
  function _alvo(d) {
    var a = d && d.metaAlocacao;
    if (!a || typeof a !== 'object') return null;
    var soma = 0, ok = {};
    Object.keys(a).forEach(function (k) { var v = Number(a[k]); if (isFinite(v) && v > 0) { ok[k] = v; soma += v; } });
    return (soma > 0 && Math.abs(soma - 100) < 0.5) ? ok : null;
  }

  function carteira(d, c, hojeISO) {
    var inv = _inv(d), total = Number(inv.total) || 0, por = inv.porCategoria || {};
    if (!(total > 0)) return 'Não há investimentos cadastrados na caderneta.';
    var alvo = _alvo(d);
    var cats = Object.keys(por).filter(function (k) { return Number(por[k]) > 0; }).sort(function (a, b) { return por[b] - por[a]; });
    if (!alvo) {
      return 'Sua carteira soma ' + brl(total) + ': ' + cats.slice(0, 4).map(function (k) { return nomeCat(k) + ' ' + pc(por[k] / total * 100); }).join(', ') +
             '. Não há distribuição-alvo cadastrada na caderneta para comparar.';
    }
    var todas = {};
    Object.keys(alvo).forEach(function (k) { todas[k] = 1; });
    cats.forEach(function (k) { todas[k] = 1; });
    var linhas = Object.keys(todas).map(function (k) {
      var at = (Number(por[k]) || 0) / total * 100;
      return { cat: k, at: at, alvo: alvo[k] || 0, gap: (alvo[k] || 0) - at };
    }).sort(function (a, b) { return b.gap - a.gap; });
    var t = 'Sua carteira soma ' + brl(total) + '. ' + linhas.filter(function (l) { return l.at > 0 || l.alvo > 0; }).map(function (l) {
      return nomeCat(l.cat) + ' está em ' + pc(l.at) + (l.alvo ? ', alvo ' + pc(l.alvo) : ', fora do alvo');
    }).join('; ') + '.';
    var abaixo = linhas[0];
    if (abaixo && abaixo.gap >= 1) t += ' A mais abaixo do alvo é ' + nomeCat(abaixo.cat) + ', por ' + Math.round(abaixo.gap) + ' pontos percentuais.';
    else t += ' Está bem perto do alvo.';
    if (_pausado(c, hojeISO)) t += ' O rebalanceamento está pausado até ' + _mesFalado(c.pausaAte.slice(0, 7)) + ', então isto é só acompanhamento.';
    return t;
  }

  /**
   * O plano de aporte do mês: quanto dá (livre previsto − margem) e como dividir pelo alvo sem vender nada.
   * → {ok, livreFim, aPagar, pode, partes:[{cat, valor}] (maior primeiro), texto} ; `ok:false` + `texto` quando não dá / não leu. PURA.
   */
  function plano(d, c, hojeISO) {
    var livreFim = Number(d && d.livreFim), aPagar = Number(d && d.aPagar) || 0;
    if (!isFinite(livreFim)) return { ok: false, texto: 'Não consegui ler a previsão do fim do mês na caderneta.' };
    var pode = Math.floor((livreFim - c.margem) * 100) / 100;
    if (!(pode > 0)) {
      return { ok: false, livreFim: livreFim, pode: 0, partes: [],
               texto: 'Pela previsão do fim do mês você fica com ' + (livreFim < 0 ? 'negativo em ' : '') + brl(livreFim) + ', e eu deixo ' + brl(c.margem) + ' de margem na conta. Este mês não sobra para aportar.' };
    }
    var t = 'Pela previsão do fim do mês você terá ' + brl(livreFim) + ' livres' + (aPagar > 0 ? ', já descontando o que falta pagar' : '') +
            '. Deixando ' + brl(c.margem) + ' de margem, dá para aportar até ' + brl(pode) + '.';
    // PAUSA DO REBALANCEAMENTO com destino configurado: o aporte INTEIRO vai para ele (a decisão dele), não para o alvo. Passada a pausa, volta a dividir pelo alvo.
    if (_pausado(c, hojeISO) && c.destinoPausa) {
      return { ok: true, livreFim: livreFim, aPagar: aPagar, pode: pode, pausa: true,
               partes: [{ cat: 'Liquidez/Reserva', valor: pode, destino: c.destinoPausa }],
               texto: t + ' O rebalanceamento está pausado até ' + _mesFalado(c.pausaAte.slice(0, 7)) + ', então o aporte inteiro vai ' + c.destinoPausa.rotulo + '.' };
    }
    var alvo = _alvo(d), por = _inv(d).porCategoria || {}, partes = [];
    if (alvo) {
      var parte = dividirAporte(por, alvo, pode);
      partes = Object.keys(parte).filter(function (k) { return parte[k] >= 0.01; }).sort(function (a, b) { return parte[b] - parte[a]; })
        .map(function (k) { return { cat: k, valor: parte[k] }; });
      var itens = partes.map(function (x) { return brl(x.valor) + ' em ' + nomeCat(x.cat); });
      if (itens.length) {
        t += _pausado(c, hojeISO)
          ? ' O rebalanceamento está pausado até ' + _mesFalado(c.pausaAte.slice(0, 7)) + '; seguindo o alvo, o aporte iria assim, sem vender nada: ' + itens.join(', ') + '.'
          : ' Para chegar ao alvo sem vender nada: ' + itens.join(', ') + '.';
      }
    }
    return { ok: true, livreFim: livreFim, aPagar: aPagar, pode: pode, partes: partes, texto: t };
  }
  function aporte(d, c, hojeISO) { return plano(d, c, hojeISO).texto; }

  // ── AVISO PROATIVO DO CONSULTOR (uma vez por mês) ─────────────────────────────────────
  // Quando o livre PREVISTO para o fim do mês passa da margem (e do mínimo), o Jarvis notifica E fala quanto dá para aportar e onde, e deixa a
  // sugestão guardada (FIN_APORTE_SUGERIDO, 3 dias) para o "aportei" registrar com confirmação. Só avisa depois que as receitas fixas do mês foram
  // marcadas como recebidas (antes disso a previsão conta um salário que ainda não caiu) ou a partir do dia 20. Roda no tick de 15 min, das 9h às 20h.
  // A marca do mês é gravada ANTES de enviar: no máximo um aviso por mês. Desliga com CONSULTOR_AVISO_ATIVO=nao. Mínimo: CONSULTOR_AVISO_MIN (R$, padrão 100).
  var AVISO_HORAS = [9, 20];

  function _salvarSugestao(s) { try { PropertiesService.getScriptProperties().setProperty('FIN_APORTE_SUGERIDO', JSON.stringify(s)); } catch (e) {} }
  /** A sugestão de aporte guardada (até 3 dias) ou null. */
  function sugestaoAporte() {
    try {
      var s = JSON.parse(_p('FIN_APORTE_SUGERIDO') || 'null');
      return (s && s.partes && s.partes.length && Date.now() - s.em <= 3 * 86400000) ? s : null;
    } catch (e) { return null; }
  }
  function limparSugestao() { try { PropertiesService.getScriptProperties().deleteProperty('FIN_APORTE_SUGERIDO'); } catch (e) {} }

  /**
   * opts.ensaio = só devolve o que avisaria (não envia, não grava); opts.teste = envia um aviso de TESTE com números inventados (não grava a marca do
   * mês; a sugestão fica marcada `teste` e o "aportei" não registra nada). Nunca lança.
   */
  function verificarAporte(opts) {
    opts = opts || {};
    try {
      var sp = PropertiesService.getScriptProperties();
      var agora = new Date(), hojeISO = Utilities.formatDate(agora, TZ, 'yyyy-MM-dd'), mes = hojeISO.slice(0, 7);
      var c = cfg();
      if (opts.teste) {
        var dt = { hoje: hojeISO, livreFim: c.margem + 2000, aPagar: 300, metaAlocacao: { 'Renda fixa': 60, 'Tesouro Direto': 20, 'FIIs': 15, 'Liquidez/Reserva': 5 },
                   investimentos: { total: 10000, porCategoria: { 'Renda fixa': 7000, 'Tesouro Direto': 1500, 'FIIs': 500, 'Liquidez/Reserva': 1000 } } };
        var pt = plano(dt, c, hojeISO), tx = 'Teste do aviso do consultor. ' + pt.texto + ' Quando aportar, diga: aportei.';
        _salvarSugestao({ em: Date.now(), mes: mes, valor: pt.pode, partes: pt.partes, teste: true });
        var rt = (typeof _avisarDono === 'function')
          ? _avisarDono({ origem: 'consultor', titulo: 'Consultor (teste)', texto: tx, falar: tx, falarLocal: true, logResumo: 'consultor: aviso de TESTE [valores não registrados]' }) : { ok: false };
        return { ok: !!(rt && rt.ok), teste: true, texto: tx, plano: pt };
      }
      if (!opts.ensaio && String(sp.getProperty('CONSULTOR_AVISO_ATIVO') || 'sim').toLowerCase() === 'nao') return { ok: true, pulou: 'desligado' };
      if (typeof Financas === 'undefined' || !Financas.configurado()) return { ok: true, pulou: 'não configurado' };
      var h = Number(Utilities.formatDate(agora, TZ, 'H'));
      if (!opts.ensaio && (h < AVISO_HORAS[0] || h > AVISO_HORAS[1])) return { ok: true, pulou: 'fora da janela' };
      if (!opts.ensaio && sp.getProperty('CONSULTOR_AVISO_MES') === mes) return { ok: true, pulou: 'já avisou este mês' };
      var r = Financas.resumo();
      if (!r.ok) return { ok: false, erro: r.erro };
      var d = r.dados, dia = Number(hojeISO.slice(8, 10));
      var pendentes = (d.receitas || []).filter(function (x) { return !x.recebido && Number(x.valor) > 0; });
      if (pendentes.length && dia < 20) return { ok: true, pulou: 'receita fixa ainda não recebida (' + pendentes.length + ')', ensaio: !!opts.ensaio };
      var minimo = _num('CONSULTOR_AVISO_MIN', 100, 0, 1000000);
      var pl = plano(d, c, hojeISO);
      if (!pl.ok || pl.pode < minimo) return { ok: true, pulou: 'não sobra o suficiente', pode: pl.pode || 0, minimo: minimo };
      var texto = pl.texto + ' Quando aportar, diga: aportei.';
      if (opts.ensaio) return { ok: true, avisaria: true, texto: texto, plano: pl };
      sp.setProperty('CONSULTOR_AVISO_MES', mes);   // ANTES de enviar: no máximo um aviso por mês
      _salvarSugestao({ em: Date.now(), mes: mes, valor: pl.pode, partes: pl.partes });
      if (typeof _avisarDono === 'function') {
        _avisarDono({ origem: 'consultor', titulo: 'Consultor: dá para aportar', texto: texto, falar: texto, falarLocal: true, logResumo: 'consultor: aviso de aporte do mês [valores não registrados]' });
      }
      return { ok: true, avisou: true, mes: mes };
    } catch (e) {
      try { Logger.log('[Consultor.avisos] ' + e.message); } catch (e2) {}
      return { ok: false, erro: e.message };
    }
  }

  function simular(d, c, q) {
    var P = Number(_inv(d).total) || 0, r = q.taxa != null ? q.taxa : c.taxaMes, n = q.meses;
    if (q.aporte == null || !(q.aporte >= 0) || !(n > 0)) return 'Diga o aporte mensal e o prazo, por exemplo: se eu aportar mil por mês durante cinco anos.';
    if (n > 1200) return 'Esse prazo passa de cem anos. Diga um prazo menor.';
    var fv = valorFuturo(P, q.aporte, r, n), aportes = q.aporte * n;
    return 'Aportando ' + brl(q.aporte) + ' por mês durante ' + anosMeses(n) + ', a ' + taxaFalada(r) + ', seus investimentos iriam de ' + brl(P) + ' para cerca de ' + brl(fv) +
           ': ' + brl(aportes) + ' de aportes e ' + brl(Math.max(0, fv - P - aportes)) + ' de rendimento. É uma estimativa, não uma promessa.';
  }

  function tempo(d, c, q) {
    var P = Number(_inv(d).total) || 0, r = q.taxa != null ? q.taxa : c.taxaMes;
    if (!(q.alvo > 0)) return 'Diga o valor que você quer juntar, por exemplo: em quanto tempo chego a cem mil aportando mil por mês.';
    if (q.aporte == null || !(q.aporte >= 0)) return 'Diga quanto aporta por mês, por exemplo: em quanto tempo chego a ' + brl(q.alvo) + ' aportando mil por mês.';
    var n = mesesAteAlvo(P, q.aporte, r, q.alvo);
    if (n === 0) return 'Você já tem ' + brl(P) + ' investidos, acima de ' + brl(q.alvo) + '.';
    if (n === null) return 'Com ' + brl(q.aporte) + ' por mês a ' + taxaFalada(r) + ' você não chega a ' + brl(q.alvo) + ' em cem anos.';
    return 'Com ' + brl(P) + ' hoje e ' + brl(q.aporte) + ' por mês, a ' + taxaFalada(r) + ', você chega a ' + brl(q.alvo) + ' em cerca de ' + anosMeses(n) + '. É uma estimativa, não uma promessa.';
  }

  function reservaAlvo(d, c) {
    var inv = _inv(d), meses = d.reservaMeses, liq = Number(inv.liquidezDiaria) || 0;
    if (meses == null || !(liq > 0)) return 'Não consegui calcular a reserva: falta custo mensal ou investimento com resgate diário na caderneta.';
    var custo = liq / Number(meses), alvoR = c.reservaAlvo * custo, dif = liq - alvoR;
    var m = String(Math.round(Number(meses) * 10) / 10).replace('.', ',');
    return 'Sua reserva com resgate diário é de ' + brl(liq) + ' e cobre cerca de ' + m + ' meses dos seus gastos. O alvo é de ' + c.reservaAlvo + ' meses, ' + brl(alvoR) + '. ' +
           (dif >= 0 ? 'Você está ' + brl(dif) + ' acima do alvo.' : 'Faltam ' + brl(-dif) + ' para o alvo.');
  }

  function metas(d, c, hojeISO) {
    if (!c.metas.length) return 'Você ainda não cadastrou metas. Diga, por exemplo: minha meta é casa própria, 150 mil, até 2030.';
    var P = Number(_inv(d).total) || 0, hoje = String(hojeISO || '').slice(0, 7);
    var capac = Number(d.livreFim) - c.margem;
    return c.metas.slice(0, 3).map(function (m) {
      var alvo = Number(m.alvo), ate = String(m.ate || ''), pcj = Math.min(100, P / alvo * 100);
      var fim = /^\d{4}$/.test(ate) ? ate + '-12' : (/^\d{4}-\d{2}$/.test(ate) ? ate : '');
      var t = m.nome + ': você tem ' + brl(P) + ' de ' + brl(alvo) + ', ' + pc(pcj);
      if (P >= alvo) return t + ', meta atingida.';
      if (fim) {
        var n = (Number(fim.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + (Number(fim.slice(5, 7)) - Number(hoje.slice(5, 7)));
        if (n > 0) {
          var a = aporteNecessario(P, c.taxaMes, n, alvo);
          t += '. Até ' + _mesFalado(fim) + ' faltam ' + anosMeses(n) + '; precisa aportar cerca de ' + brl(a) + ' por mês a ' + taxaFalada(c.taxaMes);
          if (capac > 0) t += (a <= capac ? ', e a previsão deste mês comporta isso' : ', e a previsão deste mês comporta só ' + brl(capac));
        } else t += '. O prazo de ' + _mesFalado(fim) + ' já passou';
      }
      return t + '.';
    }).join(' ');
  }

  /** Frase para uma consulta do consultor. `q` = o que o interpretar devolveu. */
  function falar(tipo, d, q) {
    var c = cfg(), hojeISO = (d && d.hoje) || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    if (!d) return 'Não consegui consultar a caderneta agora.';
    if (tipo === 'carteira') return carteira(d, c, hojeISO);
    if (tipo === 'aporte') return aporte(d, c, hojeISO);
    if (tipo === 'simular') return simular(d, c, q || {});
    if (tipo === 'tempo') return tempo(d, c, q || {});
    if (tipo === 'reserva_alvo') return reservaAlvo(d, c);
    if (tipo === 'metas') return metas(d, c, hojeISO);
    return null;
  }

  // ── interpretação da fala ─────────────────────────────────────────────────────────
  /** "150 mil" → 150000 · "1,5 milhão" → 1500000 · "1.000" → 1000 · "70" → 70. Devolve todos os valores da frase, em ordem. */
  function numerosFalados(s) {
    var out = [], re = /(\d[\d.,]*)\s*(milhoes|milhao|mil)?\b/g, m;
    while ((m = re.exec(s)) !== null) {
      var t = m[1].replace(/[.,]+$/, ''), n;
      if (/,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
      else if (/^\d{1,3}(\.\d{3})+$/.test(t) || /^\d{1,3}(,\d{3})+$/.test(t)) n = Number(t.replace(/[.,]/g, ''));
      else n = Number(t.replace(',', '.'));
      if (!isFinite(n)) continue;
      if (m[2] === 'mil') n *= 1000; else if (m[2]) n *= 1000000;
      out.push({ valor: n, pos: m.index, fim: m.index + m[0].length });
    }
    return out;
  }

  /** Frase → {tipo, ...} | null. Conservadora: só o que é inequívoco do consultor. `s` já normalizada (minúscula, sem acento). */
  function interpretar(s) {
    s = String(s || '');
    if (!s) return null;
    var nums = numerosFalados(s);
    // simulação: "se eu aportar 1000 por mês durante 5 anos" · "quanto vou ter aportando 500 por mês em 10 anos"
    var per = s.match(/\b(\d+)\s*(anos?|meses)\b/);
    var temAporteVerbo = /\b(aportar|aportando|investir|investindo|guardar|guardando|poupar|poupando|colocar|colocando|juntar)\b/.test(s);
    if (per && temAporteVerbo && /\b(se eu|simul\w*|quanto (eu )?(vou|vai|terei|teria|fico|ficaria)|quanto fica|quanto rende|quanto tenho)\b/.test(s)) {
      var meses = Number(per[1]) * (/^anos?$/.test(per[2]) ? 12 : 1);
      var cand = nums.filter(function (n) { return !(n.pos >= per.index && n.pos < per.index + per[0].length); });
      var ap = cand.length ? cand[0].valor : null;
      var taxa = s.match(/\ba\s+(\d+(?:[.,]\d+)?)\s*%\s*(?:ao|por)\s*mes\b/);
      return { tipo: 'simular', aporte: ap, meses: meses, taxa: taxa ? Number(taxa[1].replace(',', '.')) / 100 : null };
    }
    // tempo: "em quanto tempo chego a 100 mil aportando 1000 por mês"
    if (/\bem quanto tempo\b|\bquanto tempo\b.*\b(chego|junto|alcanco|atinjo|consigo)\b/.test(s) && /\d/.test(s)) {
      var alvoN = nums.length ? nums.slice().sort(function (a, b) { return b.valor - a.valor; })[0] : null;
      var outro = nums.filter(function (n) { return alvoN && n !== alvoN; });
      return { tipo: 'tempo', alvo: alvoN ? alvoN.valor : null, aporte: outro.length ? outro[0].valor : null };
    }
    if (/\b(carteira|distribuicao|alocacao|composicao)\b/.test(s) && /\b(como|esta|estao|qual|equilibrad\w*|balanceada|alvo|meta|certa)\b/.test(s) && !/\baporte|aportar\b/.test(s)) return { tipo: 'carteira' };
    if (/\b(aportar|aporte|investir|aplicar|aplico|invisto|aporto)\b/.test(s) && /\b(quanto|onde|como|posso|devo|da pra|dá pra|esse mes|este mes|neste mes|do mes)\b/.test(s) &&
        !/\b(quanto (eu )?tenho|ja investi|investido)\b/.test(s)) return { tipo: 'aporte' };
    if (/\breserva\b/.test(s) && /\b(alvo|ideal|suficiente|falta|faltam|meta|basta|esta boa)\b/.test(s)) return { tipo: 'reserva_alvo' };
    if (/\b(minhas? metas?|metas)\b/.test(s) && !/\b(defin\w*|cri[ae]\w*|cadastr\w*|mud\w*|troc\w*)\b/.test(s)) return { tipo: 'metas' };
    if (/\bquanto falta\b.*\b(casa|aposentadoria|meta)\b|\bcasa propria\b.*\b(quanto falta|como estou|progresso)\b|\baposentadoria\b.*\b(quanto falta|como estou|progresso)\b/.test(s)) return { tipo: 'metas' };
    return null;
  }

  return { cfg: cfg, valorFuturo: valorFuturo, mesesAteAlvo: mesesAteAlvo, aporteNecessario: aporteNecessario, dividirAporte: dividirAporte,
           falar: falar, interpretar: interpretar, numerosFalados: numerosFalados, brl: brl,
           plano: plano, verificarAporte: verificarAporte, sugestaoAporte: sugestaoAporte, limparSugestao: limparSugestao };
})();
