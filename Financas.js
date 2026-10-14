// ===================================================================================
// Financas.js — Jarvis ouve e responde sobre a CADERNETA (app de finanças pessoais). FASE 1: SÓ LEITURA.
//
// Regra do projeto: número financeiro vem do CÓDIGO, nunca do modelo. A caderneta calcula tudo no
// Worker dela (src/calculos.js, igual ao app) e devolve /api/jarvis/resumo; aqui só se formata a
// frase. Nenhuma resposta passa pelo Gemini, e nenhuma ferramenta financeira é dada ao modelo.
// O endereço e o token ficam em Script Properties (FIN_API_URL, FIN_API_TOKEN) — nunca no repositório.
// ===================================================================================

var Financas = (function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';
  var CACHE_S = 60;   // a caderneta muda pouco entre duas perguntas seguidas; evita bater no Worker toda hora

  var AJUDA = 'Sobre a caderneta, posso dizer quanto você tem livre hoje, a previsão do fim do mês, ' +
              'o que vence, quanto falta pagar, o orçamento do mercado e quanto está investido.';

  function _p(k) { try { return PropertiesService.getScriptProperties().getProperty(k); } catch (e) { return null; } }

  function configurado() { return !!(_p('FIN_API_URL') && _p('FIN_API_TOKEN')); }

  /** Busca o resumo do mês (AAAA-MM; vazio = mês atual no servidor). → {ok, dados} | {ok:false, erro, codigo}. */
  function resumo(mes) {
    var url = String(_p('FIN_API_URL') || '').replace(/\/+$/, '');
    var token = _p('FIN_API_TOKEN');
    if (!url || !token) return { ok: false, erro: 'não configurado', codigo: 'nao_configurado' };
    var chave = 'fin_resumo_' + (mes || 'atual');
    try {
      var c = CacheService.getScriptCache().get(chave);
      if (c) return { ok: true, dados: JSON.parse(c), cache: true };
    } catch (eC) {}
    var res;
    try {
      res = UrlFetchApp.fetch(url + '/api/jarvis/resumo' + (mes ? '?mes=' + encodeURIComponent(mes) : ''),
        { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    } catch (e) { return { ok: false, erro: 'sem conexão', codigo: 'rede' }; }
    var code = res.getResponseCode();
    if (code !== 200) { Logger.log('[Financas] HTTP ' + code); return { ok: false, erro: 'HTTP ' + code, codigo: code }; }
    var dados;
    try { dados = JSON.parse(res.getContentText()); } catch (eJ) { return { ok: false, erro: 'resposta inválida', codigo: 'json' }; }
    try { CacheService.getScriptCache().put(chave, JSON.stringify(dados), CACHE_S); } catch (eP) {}
    return { ok: true, dados: dados };
  }

  // ── formatação (PURA) ─────────────────────────────────────────────────────────────
  function _brl(v) {
    var n = Math.abs(Number(v) || 0), partes = n.toFixed(2).split('.');
    return 'R$ ' + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + partes[1];
  }
  function _meses(v) {
    var n = Math.round(Number(v) * 10) / 10;
    return String(n).replace('.', ',');
  }
  function _diaDe(hoje) { return Number(String(hoje).slice(8, 10)); }
  function _diasNoMes(hoje) { return new Date(Date.UTC(Number(String(hoje).slice(0, 4)), Number(String(hoje).slice(5, 7)), 0)).getUTCDate(); }

  /** Itens ainda a pagar (não pagos, não de outra pessoa, com valor), ordenados pelo dia. */
  function _pendentes(d) {
    return (d.obrigacoes || []).filter(function (o) { return !o.pago && !o.outroPaga && Number(o.valor) > 0; })
      .sort(function (a, b) { return (a.dia || 99) - (b.dia || 99); });
  }
  function _item(o, comDia) { return o.nome + (comDia && o.dia ? ', dia ' + o.dia : '') + ', ' + _brl(o.valor); }

  /**
   * Frase falável para uma consulta. `extra.proximo` = resumo do mês seguinte (vencimentos perto da virada).
   * Nunca inventa: tudo sai de `d`.
   */
  function falar(tipo, d, extra) {
    extra = extra || {};
    if (!d) return 'Não consegui consultar a caderneta agora.';
    var hojeDia = _diaDe(d.hoje), fimMes = _diasNoMes(d.hoje);

    if (tipo === 'livre_hoje') {
      var v = Number(d.livreHoje);
      var t = v < 0 ? 'Seu saldo livre está negativo em ' + _brl(v) + ' hoje.' : 'Você tem ' + _brl(v) + ' livres na conta hoje.';
      if (Math.abs(Number(d.livreFim) - v) >= 0.005) {
        t += Number(d.livreFim) < 0 ? ' A previsão para o fim do mês é ficar negativo em ' + _brl(d.livreFim) + '.'
                                    : ' A previsão para o fim do mês é de ' + _brl(d.livreFim) + '.';
      }
      return t;
    }

    if (tipo === 'livre_fim') {
      var f = Number(d.livreFim);
      var t2 = f < 0 ? 'A previsão para o fim do mês é ficar negativo em ' + _brl(f) + '.' : 'A previsão para o fim do mês é de ' + _brl(f) + ' livres.';
      if (Number(d.aPagar) > 0) t2 += ' Ainda faltam pagar ' + _brl(d.aPagar) + '.';
      return t2;
    }

    if (tipo === 'falta_pagar') {
      var pend = _pendentes(d);
      if (!pend.length) return 'Não há nada pendente de pagar neste mês.';
      var tot = pend.reduce(function (s, o) { return s + Number(o.valor); }, 0);
      var lista = pend.slice(0, 4).map(function (o) { return _item(o, true); }).join('; ');
      return 'Faltam pagar ' + _brl(tot) + ' este mês, em ' + pend.length + (pend.length > 1 ? ' itens' : ' item') + ': ' + lista +
             (pend.length > 4 ? '; e mais ' + (pend.length - 4) + '.' : '.');
    }

    if (tipo === 'vencimentos') {
      var periodo = extra.periodo || 'semana';
      var pd = _pendentes(d).filter(function (o) { return o.dia; });
      var atrasadas = pd.filter(function (o) { return o.dia < hojeDia; });
      var alvo, rotulo;
      if (periodo === 'hoje') { alvo = pd.filter(function (o) { return o.dia === hojeDia; }); rotulo = 'Hoje'; }
      else if (periodo === 'amanha') {
        if (hojeDia + 1 <= fimMes) alvo = pd.filter(function (o) { return o.dia === hojeDia + 1; });
        else alvo = _pendentes(extra.proximo || {}).filter(function (o) { return o.dia === 1; });
        rotulo = 'Amanhã';
      } else {
        alvo = pd.filter(function (o) { return o.dia >= hojeDia && o.dia <= hojeDia + 7; });
        var sobra = hojeDia + 7 - fimMes;
        if (sobra > 0) alvo = alvo.concat(_pendentes(extra.proximo || {}).filter(function (o) { return o.dia && o.dia <= sobra; }));
        rotulo = 'Nos próximos sete dias';
      }
      var out = alvo.length
        ? rotulo + (periodo === 'hoje' || periodo === 'amanha' ? ' vence' + (alvo.length > 1 ? 'm' : '') : ' vencem') + ': ' +
          alvo.slice(0, 5).map(function (o) { return _item(o, periodo === 'semana'); }).join('; ') + (alvo.length > 5 ? '; e mais ' + (alvo.length - 5) + '.' : '.')
        : (periodo === 'semana' ? 'Nada vence nos próximos sete dias.' : 'Nada vence ' + rotulo.toLowerCase() + '.');
      if (atrasadas.length && periodo !== 'amanha') {
        out += ' Atenção, ' + (atrasadas.length > 1 ? 'estão atrasadas' : 'está atrasada') + ': ' + atrasadas.slice(0, 3).map(function (o) { return _item(o, true); }).join('; ') + '.';
      }
      return out;
    }

    if (tipo === 'orcamento') {
      var orc = d.orcamentos || [];
      if (!orc.length) {
        // Sem orçamento cadastrado: soma os lançamentos de Mercado e Alimentação do mês (a caderneta calcula).
        var m = d.mercado;
        if (!m || !(Number(m.n) > 0)) return 'Ainda não há gastos de mercado ou alimentação lançados neste mês.';
        var t4 = 'Neste mês você gastou ' + _brl(m.total) + ' com mercado e alimentação, em ' + m.n + (m.n > 1 ? ' lançamentos' : ' lançamento');
        if (Number(m.noVoucher) > 0 && Number(m.outros) > 0) t4 += ': ' + _brl(m.noVoucher) + ' no voucher e ' + _brl(m.outros) + ' em outros meios';
        else if (Number(m.noVoucher) > 0) t4 += ', todos no voucher';
        return t4 + '.';
      }
      return orc.map(function (o) {
        return o.estourou
          ? 'O orçamento de ' + o.nome + ' estourou: você usou ' + _brl(o.usado) + ' de ' + _brl(o.previsto) + '.'
          : 'No orçamento de ' + o.nome + ', você usou ' + _brl(o.usado) + ' de ' + _brl(o.previsto) + ' e restam ' + _brl(o.resta) + '.';
      }).join(' ');
    }

    if (tipo === 'investido') {
      var inv = d.investimentos || {};
      var t3 = 'Você tem ' + _brl(inv.total) + ' investidos';
      if (Number(inv.liquidezDiaria) > 0) t3 += ', dos quais ' + _brl(inv.liquidezDiaria) + ' com resgate diário';
      t3 += '.';
      if (d.reservaMeses != null) t3 += ' A reserva cobre cerca de ' + _meses(d.reservaMeses) + ' meses de gastos.';
      return t3;
    }

    if (tipo === 'reserva') {
      var liq = (d.investimentos || {}).liquidezDiaria;
      if (d.reservaMeses == null) return 'Não consegui calcular a reserva, porque não há custo mensal informado.';
      return 'Sua reserva com resgate diário é de ' + _brl(liq) + ' e cobre cerca de ' + _meses(d.reservaMeses) + ' meses dos seus gastos.';
    }

    return AJUDA;
  }

  // ── interpretação da fala (PURA) ──────────────────────────────────────────────────
  /**
   * Frase → {tipo, periodo?} ou null. Conservadora de propósito: só pega o que é inequívoco da caderneta, para não
   * roubar frases do Swile ("saldo do voucher", "quanto gastei essa semana") nem de outras rotas.
   * "caderneta" sem pergunta reconhecida → {tipo:'ajuda'}, em vez de deixar o modelo inventar número.
   */
  function interpretar(msg) {
    var s = String(msg || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    // Swile / vale: é da outra rota (_interpretarFinanceiro)
    if (/\b(swile|suav|suail|voucher|vale|mobilidade|alimentacao|refeicao|combustivel)\b/.test(s)) return null;
    // comando/ação que não é consulta (registrar, criar, cancelar...): fica para fases seguintes / modelo
    if (/\b(cri[ae]|agend\w*|cancel\w*|exclu\w*|apag\w*|regist\w*|lanc\w*|anot\w*|adicion\w*|coloc\w*|marc[ae]|paguei|gastei|recebi|apliquei|resgatei)\b/.test(s) &&
        !/\bquanto (eu )?gastei no mercado\b/.test(s)) return null;
    var pergunta = /\b(quanto|quantos|quanta|qual|quais|me (diga|fale|fala|conta|mostre|mostra)|o que|como (esta|estao)|tem algo|tenho algo)\b/.test(s);
    var caderneta = /\bcaderneta\b/.test(s);

    // vencimentos / contas a pagar
    if (/\b(vence|vencem|vencimento|vencimentos|vencendo)\b/.test(s)) {
      var per = /\bamanha\b/.test(s) ? 'amanha' : /\bhoje\b/.test(s) ? 'hoje' : 'semana';
      return { tipo: 'vencimentos', periodo: per };
    }
    if (/\b(falta|faltam|falta eu|resta|restam)\b.*\bpagar\b|\bcontas? (a|para) pagar\b|\b(contas?|faturas?|boletos?)\b.*\b(a|para) pagar\b|\bo que (eu )?(preciso|tenho que|devo) pagar\b/.test(s)) return { tipo: 'falta_pagar' };

    // livre
    if (/\blivres?\b/.test(s) && (pergunta || caderneta || /\bsaldo\b/.test(s))) {
      if (/\b(fim|final) do mes\b|\bate o fim\b|\bvai sobrar\b|\bsobrara\b|\bprevisao\b/.test(s)) return { tipo: 'livre_fim' };
      return { tipo: 'livre_hoje' };
    }
    if (/\b(fim|final) do mes\b|\bvai sobrar\b|\bsobrara\b/.test(s) && /\b(sobra|sobrar|sobrara|livre|fica|ficar|ficara)\b/.test(s) && pergunta) return { tipo: 'livre_fim' };

    // orçamento / mercado
    if (/\bmercado\b/.test(s) && /\b(orcamento|resta|restam|sobra|sobrou|gastei|usei|gasto)\b/.test(s) && (pergunta || /\borcamento\b/.test(s))) return { tipo: 'orcamento' };
    if (/\borcamento\b/.test(s) && pergunta) return { tipo: 'orcamento' };

    // investimentos / reserva
    if (pergunta && /\breserva( de emergencia)?\b/.test(s)) return { tipo: 'reserva' };
    if (pergunta && /\b(investido|investidos|investimentos?|patrimonio|aplicado|aplicados|aplicacoes)\b/.test(s)) return { tipo: 'investido' };

    if (caderneta) return { tipo: 'ajuda' };
    return null;
  }

  /** Consulta pronta para falar: busca na caderneta e monta a frase. Nunca lança. */
  function responder(consulta) {
    try {
      if (!consulta) return AJUDA;
      if (consulta.tipo === 'ajuda') return AJUDA;
      if (!configurado()) return 'A caderneta ainda não está conectada ao Jarvis.';
      var r = resumo();
      if (!r.ok) return r.codigo === 401 ? 'A caderneta recusou o acesso do Jarvis. Preciso que o acesso seja reconfigurado.' : 'Não consegui consultar a caderneta agora.';
      var extra = { periodo: consulta.periodo };
      if (consulta.tipo === 'vencimentos' && consulta.periodo !== 'hoje') {
        var d = r.dados, hojeDia = _diaDe(d.hoje), fim = _diasNoMes(d.hoje);
        var precisa = consulta.periodo === 'amanha' ? hojeDia + 1 > fim : hojeDia + 7 > fim;
        if (precisa) {
          var y = Number(String(d.hoje).slice(0, 4)), m = Number(String(d.hoje).slice(5, 7)) + 1;
          if (m > 12) { m = 1; y++; }
          var rn = resumo(y + '-' + (m < 10 ? '0' : '') + m);
          if (rn.ok) extra.proximo = rn.dados;
        }
      }
      return falar(consulta.tipo, r.dados, extra);
    } catch (e) {
      Logger.log('[Financas] ' + e.message);
      return 'Não consegui consultar a caderneta agora.';
    }
  }

  return { configurado: configurado, resumo: resumo, falar: falar, interpretar: interpretar, responder: responder, AJUDA: AJUDA };
})();

/** Diagnóstico no editor: mostra se está conectado e o que ele responderia, sem falar no celular. */
function diagFinancas() {
  var out = { configurado: Financas.configurado() };
  if (!out.configurado) { out.nota = 'Rode o provisionamento da caderneta (provisionar-jarvis.mjs) ou grave FIN_API_URL e FIN_API_TOKEN.'; return out; }
  out.respostas = {};
  ['livre_hoje', 'livre_fim', 'falta_pagar', 'orcamento', 'investido', 'reserva'].forEach(function (t) { out.respostas[t] = Financas.responder({ tipo: t }); });
  out.respostas.vencimentos_semana = Financas.responder({ tipo: 'vencimentos', periodo: 'semana' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
