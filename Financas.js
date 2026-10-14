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
              'o que vence, quanto falta pagar, o orçamento do mercado e quanto está investido. Como consultor, também falo da distribuição da carteira, ' +
              'de quanto aportar este mês, de simulações, da reserva e das suas metas.';

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
    // CONSULTOR (fase 4): distribuição da carteira, quanto aportar, simulação, reserva contra o alvo, metas. Recebe a frase SEM tirar
    // vírgula e ponto (são decimais e milhar: "1,5 milhão", "1.000") e vem antes das regras abaixo, que cortam esses sinais.
    if (typeof Consultor !== 'undefined') {
      var cs = Consultor.interpretar(_norm(msg));
      if (cs) return cs;
    }
    // Swile / vale: é da outra rota (_interpretarFinanceiro)
    if (/\b(swile|suav|suail|voucher|vale|mobilidade|alimentacao|refeicao|combustivel)\b/.test(s)) return null;
    // comando/ação que não é consulta (registrar, criar, cancelar...): fica para fases seguintes / modelo
    if (/\b(cri[ae]|agend\w*|cancel\w*|exclu\w*|apag\w*|regist\w*|lanc\w*|anot\w*|adicion\w*|coloc\w*|marc[ae]|paguei|gastei|recebi|apliquei|resgatei)\b/.test(s) &&
        !/\bquanto (eu )?gastei n[oa] (super)?mercado\b/.test(s)) return null;
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
    // "supermercado" também é mercado: "como estão os gastos de supermercado" caía no Swile (histórico de compras)
    if (/\b(super)?mercado\b/.test(s) && /\b(orcamento|resta|restam|sobra|sobrou|gastei|usei|gastos?)\b/.test(s) && (pergunta || /\borcamento\b/.test(s))) return { tipo: 'orcamento' };
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
      if (consulta.tipo === 'mes') {
        // "como foi o mês" (ou "como foi setembro"): o resumo do mês pedido e, para comparar, o do mês anterior
        var alvoMes = r.dados;
        if (consulta.mesNum) {
          var anoRef = Number(String(r.dados.mes).slice(0, 4)), mesRef = Number(String(r.dados.mes).slice(5, 7));
          var anoM = consulta.mesNum > mesRef ? anoRef - 1 : anoRef;   // "setembro" dito em outubro = este ano; "dezembro" dito em outubro = o do ano passado
          var ym = anoM + '-' + (consulta.mesNum < 10 ? '0' : '') + consulta.mesNum;
          if (ym !== r.dados.mes) { var rm = resumo(ym); if (!rm.ok) return 'Não consegui consultar esse mês na caderneta agora.'; alvoMes = rm.dados; }
        }
        var ma = Number(String(alvoMes.mes).slice(5, 7)) - 1, aa = Number(String(alvoMes.mes).slice(0, 4));
        if (ma < 1) { ma = 12; aa--; }
        var ra = resumo(aa + '-' + (ma < 10 ? '0' : '') + ma);
        return (typeof Consultor !== 'undefined') ? Consultor.mes(alvoMes, ra.ok ? ra.dados : null) : AJUDA;
      }
      if (/^(carteira|aporte|simular|tempo|reserva_alvo|metas|indices)$/.test(consulta.tipo)) {
        return (typeof Consultor !== 'undefined') ? (Consultor.falar(consulta.tipo, r.dados, consulta) || AJUDA) : AJUDA;
      }
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

  // ── FASE 2: avisos proativos (só leitura, o Jarvis fala/notifica sozinho) ──────────────────────
  // Duas janelas por dia, no tick de 15 min: MANHÃ (9–11h: vence hoje, atrasadas, saldo negativo, orçamento) e
  // NOITE (19–21h: o que vence amanhã). Cada aviso tem uma CHAVE e só sai uma vez (FIN_AVISOS), senão o tick de
  // 15 min repetiria a mesma frase oito vezes. Nenhum número vai para o log (só a contagem).
  var JANELAS = { manha: [9, 11], noite: [19, 21] };

  /**
   * Avisos que valem agora. PURA. `d` = resumo do mês, `proximo` = resumo do mês seguinte (só p/ "amanhã" na virada),
   * `janela` = 'manha' | 'noite'. → [{chave, texto}] (ainda sem filtrar os já enviados).
   */
  function avisos(d, proximo, janela) {
    var out = [];
    if (!d || !d.hoje) return out;
    var hojeISO = String(d.hoje), mes = hojeISO.slice(0, 7), hojeDia = _diaDe(hojeISO), fim = _diasNoMes(hojeISO);
    var pend = _pendentes(d).filter(function (o) { return o.dia; });
    function lista(arr) { return arr.slice(0, 4).map(function (o) { return _item(o, false); }).join('; ') + (arr.length > 4 ? '; e mais ' + (arr.length - 4) : ''); }

    if (janela === 'noite') {
      var amanha = hojeDia + 1 <= fim ? pend.filter(function (o) { return o.dia === hojeDia + 1; })
                                      : _pendentes(proximo || {}).filter(function (o) { return o.dia === 1; });
      if (amanha.length) {
        var dt = new Date(Date.UTC(Number(hojeISO.slice(0, 4)), Number(hojeISO.slice(5, 7)) - 1, hojeDia + 1)).toISOString().slice(0, 10);
        out.push({ chave: 'venc_amanha:' + dt, texto: 'Amanhã ' + (amanha.length > 1 ? 'vencem' : 'vence') + ': ' + lista(amanha) + '.' });
      }
      return out;
    }

    var hoje = pend.filter(function (o) { return o.dia === hojeDia; });
    if (hoje.length) out.push({ chave: 'venc_hoje:' + hojeISO, texto: 'Hoje ' + (hoje.length > 1 ? 'vencem' : 'vence') + ': ' + lista(hoje) + '.' });
    pend.filter(function (o) { return o.dia < hojeDia; }).forEach(function (o) {
      out.push({ chave: 'atraso:' + mes + ':' + o.nome, texto: 'Atenção, está atrasada: ' + _item(o, true) + '.' });
    });
    if (Number(d.livreHoje) < 0) out.push({ chave: 'hoje_neg:' + hojeISO, texto: 'Seu saldo livre está negativo em ' + _brl(d.livreHoje) + ' hoje.' });
    else if (Number(d.livreFim) < 0) out.push({ chave: 'fim_neg:' + mes, texto: 'A previsão para o fim do mês é ficar negativo em ' + _brl(d.livreFim) + '.' });
    (d.orcamentos || []).forEach(function (o) {
      var prev = Number(o.previsto), uso = Number(o.usado);
      if (!(prev > 0)) return;
      if (uso >= prev) out.push({ chave: 'orc100:' + mes + ':' + o.nome, texto: 'O orçamento de ' + o.nome + ' estourou: ' + _brl(uso) + ' de ' + _brl(prev) + '.' });
      else if (uso >= prev * 0.8) out.push({ chave: 'orc80:' + mes + ':' + o.nome, texto: 'O orçamento de ' + o.nome + ' já está em ' + Math.round(uso / prev * 100) + '%: ' + _brl(uso) + ' de ' + _brl(prev) + '.' });
    });
    return out;
  }

  /** Janela do momento ('manha' | 'noite' | null), pela hora de Brasília. */
  function _janelaAgora(agora) {
    var h = Number(Utilities.formatDate(agora || new Date(), TZ, 'H'));
    var j = null;
    Object.keys(JANELAS).forEach(function (k) { if (h >= JANELAS[k][0] && h <= JANELAS[k][1]) j = k; });
    return j;
  }

  /**
   * Roda no tick de 15 min. Fora das janelas não faz nada (nem chamada de rede); dentro, consulta UMA vez por janela.
   * opts.ensaio = só devolve o que avisaria (não envia, não grava); opts.janela força a janela (ensaio/teste).
   * Nunca lança.
   */
  function verificarAvisos(opts) {
    opts = opts || {};
    try {
      // TESTE REAL de entrega: passa pelos MESMOS _avisarDono/fala, mas com dados inventados e rotulado como teste.
      // Não consulta a caderneta, não grava chave e não consome a janela do dia.
      if (opts.teste) {
        var dt = { hoje: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), livreHoje: 1, livreFim: 1,
                   obrigacoes: [{ nome: 'Conta de teste', dia: Number(Utilities.formatDate(new Date(), TZ, 'd')), valor: 10, pago: false, outroPaga: false }] };
        var at = avisos(dt, null, 'manha');
        var tx = 'Teste do aviso da caderneta. ' + at.map(function (a) { return a.texto; }).join(' ');
        var rt = (typeof _avisarDono === 'function')
          ? _avisarDono({ origem: 'caderneta', titulo: 'Caderneta (teste)', texto: tx, falar: tx, logResumo: 'caderneta: aviso de TESTE [valores não registrados]' })
          : { ok: false };
        return { ok: !!(rt && rt.ok), teste: true, texto: tx, notificacao: rt && rt.notificacao, fala: rt && rt.fala };
      }
      var sp = PropertiesService.getScriptProperties();
      if (!opts.ensaio && String(sp.getProperty('FIN_AVISOS_ATIVO') || 'sim').toLowerCase() === 'nao') return { ok: true, pulou: 'desligado' };
      if (!configurado()) return { ok: true, pulou: 'não configurado' };
      var janela = opts.janela || _janelaAgora();
      if (!janela) return { ok: true, pulou: 'fora da janela' };
      var hojeISO = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), marca = hojeISO + ':' + janela;
      if (!opts.ensaio && sp.getProperty('FIN_AVISOS_JANELA') === marca) return { ok: true, pulou: 'janela já verificada' };
      var r = resumo();
      if (!r.ok) return { ok: false, erro: r.erro };
      var proximo = null;
      if (janela === 'noite' && _diaDe(r.dados.hoje) + 1 > _diasNoMes(r.dados.hoje)) {
        var y = Number(String(r.dados.hoje).slice(0, 4)), m = Number(String(r.dados.hoje).slice(5, 7)) + 1;
        if (m > 12) { m = 1; y++; }
        var rn = resumo(y + '-' + (m < 10 ? '0' : '') + m);
        if (rn.ok) proximo = rn.dados;
      }
      var enviados = {};
      try { enviados = JSON.parse(sp.getProperty('FIN_AVISOS') || '{}'); } catch (eJ) {}
      var novos = avisos(r.dados, proximo, janela).filter(function (a) { return !enviados[a.chave]; });
      if (opts.ensaio) return { ok: true, janela: janela, avisos: novos };
      // grava ANTES de enviar: no máximo uma vez (um aviso perdido é melhor que o mesmo repetido a cada 15 min)
      sp.setProperty('FIN_AVISOS_JANELA', marca);
      if (!novos.length) return { ok: true, janela: janela, enviados: 0 };
      var corte = Utilities.formatDate(new Date(Date.now() - 40 * 86400000), TZ, 'yyyy-MM-dd');
      Object.keys(enviados).forEach(function (k) { if (enviados[k] < corte) delete enviados[k]; });
      novos.forEach(function (a) { enviados[a.chave] = hojeISO; });
      sp.setProperty('FIN_AVISOS', JSON.stringify(enviados));
      var texto = novos.map(function (a) { return a.texto; }).join(' ');
      if (typeof _avisarDono === 'function') {
        _avisarDono({ origem: 'caderneta', titulo: 'Caderneta', texto: texto, falar: texto,
                      logResumo: 'caderneta: ' + novos.length + ' aviso(s) [valores não registrados]' });
      }
      return { ok: true, janela: janela, enviados: novos.length };
    } catch (e) {
      Logger.log('[Financas.avisos] ' + e.message);
      return { ok: false, erro: e.message };
    }
  }

  // ── SWILE NA CADERNETA (14/10): a compra aprovada do Swile vira um gasto no voucher da caderneta ─────────────
  // A ÚNICA escrita do Jarvis na caderneta: criar (ou desfazer) uma Despesa paga com voucher/mobilidade. Idempotente
  // pela chave (o id do lançamento do Firestore). A recarga continua sendo informada por ele (app ou, no futuro, voz).

  /** POST autenticado no Worker. → {ok, dados} | {ok:false, erro, codigo}. Nunca lança. */
  function _post(caminho, corpo) {
    var url = String(_p('FIN_API_URL') || '').replace(/\/+$/, ''), token = _p('FIN_API_TOKEN');
    if (!url || !token) return { ok: false, erro: 'não configurado', codigo: 'nao_configurado' };
    var res;
    try {
      res = UrlFetchApp.fetch(url + caminho, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo),
        headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    } catch (e) { return { ok: false, erro: 'sem conexão', codigo: 'rede' }; }
    var code = res.getResponseCode(), dados = null;
    try { dados = JSON.parse(res.getContentText()); } catch (eJ) {}
    if (code !== 200) return { ok: false, erro: (dados && dados.erro) || ('HTTP ' + code), codigo: code };
    try { CacheService.getScriptCache().remove('fin_resumo_atual'); } catch (eC) {}   // o saldo mudou: a próxima pergunta não pode ler o cache
    return { ok: true, dados: dados };
  }

  /** g = {chave, data, carteira:'voucher'|'mobilidade', valor, estabelecimento}. → {ok, criado} | {ok:false, erro, definitivo}. */
  function registrarGastoSwile(g) {
    var r = _post('/api/jarvis/gasto-voucher', { chave: g.chave, data: g.data, carteira: g.carteira, valor: g.valor, estabelecimento: g.estabelecimento || '' });
    if (r.ok) return { ok: true, criado: r.dados.criado !== false };
    // 4xx (menos 429) = a caderneta recusou o conteúdo: tentar de novo não adianta. Rede/5xx/429 = vale tentar depois.
    var c = Number(r.codigo);
    return { ok: false, erro: r.erro, definitivo: c >= 400 && c < 500 && c !== 429 && c !== 401 };
  }

  /** Desfaz um gasto que o próprio Jarvis criou (só id sw_). */
  function desfazerGastoSwile(chave) {
    var r = _post('/api/jarvis/gasto-voucher/desfazer', { chave: chave });
    return r.ok ? { ok: true, removido: Number(r.dados.removido) || 0 } : { ok: false, erro: r.erro };
  }

  var _MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var _CART = { voucher: { em: 'no voucher', o: 'o voucher', neg: 'negativo', nome: 'voucher' }, mobilidade: { em: 'na mobilidade', o: 'a mobilidade', neg: 'negativa', nome: 'mobilidade' } };

  /** Frase do saldo do Swile, lida da caderneta (a fonte única). `carteira` = 'voucher' | 'mobilidade' | null (as duas). null se não deu. */
  function falarSaldoSwile(carteira) {
    if (!configurado()) return null;
    var r = resumo();
    if (!r.ok || !r.dados || !r.dados.vouchers) return null;
    var mes = _MESES[Number(String(r.dados.mes).slice(5, 7)) - 1] || r.dados.mes;
    var lista = r.dados.vouchers.filter(function (v) { return !carteira || v.carteira === carteira; });
    if (!lista.length) return null;
    var partes = [], semRecarga = [];
    lista.forEach(function (v) {
      if (!(Number(v.recebido) > 0)) { semRecarga.push(_CART[v.carteira].nome); return; }
      var k = _CART[v.carteira];
      partes.push(v.saldo < 0 ? k.o + ' está ' + k.neg + ' em ' + _brl(v.saldo) : _brl(v.saldo) + ' ' + k.em);
    });
    var t = partes.length ? 'Saldo do Swile: ' + partes.join('; e ') + '.' : '';
    if (semRecarga.length) {
      t += (t ? ' ' : '') + 'Ainda não há recarga de ' + mes + ' registrada na caderneta para ' + semRecarga.join(' e ') + ', então não consigo dizer o saldo.';
    }
    return t;
  }

  // ── AÇÕES POR VOZ COM CONFIRMAÇÃO (14/10) ─────────────────────────────────────────────────────────────────
  // Padrão para tudo que ESCREVE na caderneta por voz (a recarga do Swile é a primeira; bancos e ações seguem o mesmo molde):
  //   1. PROPOR: entende a frase, guarda a proposta (3 min) e REPETE o que vai gravar, pedindo "sim" ou "não".
  //   2. CONFIRMAR: só um "sim" explícito executa. "Não", ou o tempo passar, descarta sem tocar em nada.
  //   3. DESFAZER: "desfaz" nos 10 min seguintes tira o que foi gravado.
  // Cada tipo de ação é um objeto { propor(msg), descrever(p), executar(p), desfazer(u), resumo(...) } no registro ACOES.
  // Nada aqui passa pelo Gemini, e o valor falado/gravado sai do código.
  var PEND_S = 180, DESFAZ_MIN = 10;

  function _norm(msg) { return String(msg || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[?!;:]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function _cacheGet(k) { try { var v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function _cachePut(k, o, s) { try { CacheService.getScriptCache().put(k, JSON.stringify(o), s); } catch (e) {} }
  function _cacheDel(k) { try { CacheService.getScriptCache().remove(k); } catch (e) {} }

  /** "1.002,50" · "1002,50" · "1.000" (milhar) · "70" → número. Troca o texto por decimais simples ("1002.5") p/ o leitor de rótulos. */
  function _numerosSimples(txt) {
    return String(txt || '').replace(/\d[\d.,]*/g, function (t) {
      t = t.replace(/[.,]+$/, '');
      var n;
      if (/,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
      else if (/^\d{1,3}(\.\d{3})+$/.test(t) || /^\d{1,3}(,\d{3})+$/.test(t)) n = Number(t.replace(/[.,]/g, ''));
      else n = Number(t.replace(/,/g, ''));
      return isFinite(n) ? String(n) : t;
    });
  }

  var _NOMES_MES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function _mesFalado(ref) { return _MESES[Number(ref.slice(5, 7)) - 1] || ref; }

  /** Mês de uso da recarga: o citado na frase ("recarga de novembro") ou, sem citar, o seguinte quando já é dia 20 ou mais. */
  function _referenciaRecarga(s, hojeISO) {
    var y = Number(hojeISO.slice(0, 4)), m = Number(hojeISO.slice(5, 7)), d = Number(hojeISO.slice(8, 10));
    for (var i = 0; i < _NOMES_MES.length; i++) {
      if (new RegExp('\\b(de|para|pra|do mes de|em)\\s+' + _NOMES_MES[i] + '\\b').test(s) || new RegExp('^' + _NOMES_MES[i] + '\\b').test(s)) {
        var mm = i + 1, yy = y;
        if (mm < m - 6) yy = y + 1; else if (mm > m + 6) yy = y - 1;   // "janeiro" dito em dezembro = ano que vem
        return yy + '-' + (mm < 10 ? '0' : '') + mm;
      }
    }
    if (d >= 20) { m++; if (m > 12) { m = 1; y++; } }
    return y + '-' + (m < 10 ? '0' : '') + m;
  }

  /**
   * "caiu 1.002,50 no voucher e 67,98 na mobilidade" → {itens:[{carteira, valor}], referencia} | {erro} | null.
   * Conservadora: exige verbo de recarga + carteira do Swile + valor. Pergunta ("quanto caiu?") não entra.
   */
  function interpretarRecarga(msg) {
    var s = _norm(msg).replace(/[?]/g, '');
    if (!s) return null;
    if (/\b(quanto|qual|quais|quando|sera que)\b/.test(s)) return null;
    if (/\b(gastei|paguei|comprei|gasto|compra)\b/.test(s)) return null;
    var verbo = /\b(recarga|recarreg\w*|cre?ditou|creditaram|caiu|cairam|entrou|entraram|depositou|depositaram|liberou|liberaram|chegou|chegaram)\b/.test(s);
    var carteira = /\b(voucher|vouchers|alimentacao|refeicao|mobilidade|combustivel|swile|suav|suail|beneficio|beneficios)\b/.test(s);
    if (!verbo || !carteira) return null;
    if (typeof _finLerSaldoDeTexto !== 'function') return null;
    var lido = _finLerSaldoDeTexto(_numerosSimples(msg));
    if (!lido) return { erro: 'Não entendi o valor da recarga. Diga, por exemplo: caiu mil no voucher e setenta na mobilidade, em números.' };
    if (!lido.porRotulo) return { erro: 'Diga o valor junto com a carteira, por exemplo: caiu 1000 no voucher e 70 na mobilidade.' };
    var itens = [];
    if (lido.voucher !== null && lido.voucher > 0) itens.push({ carteira: 'voucher', valor: Math.round(lido.voucher * 100) / 100 });
    if (lido.mobilidade !== null && lido.mobilidade > 0) itens.push({ carteira: 'mobilidade', valor: Math.round(lido.mobilidade * 100) / 100 });
    if (!itens.length) return { erro: 'Não entendi o valor da recarga.' };
    if (itens.some(function (i) { return i.valor > 5000; })) return { erro: 'Esse valor passa de cinco mil reais, o limite do Jarvis. Registre direto na caderneta.' };
    return { itens: itens, referencia: _referenciaRecarga(s, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) };
  }

  /** Recarga do voucher/mobilidade no Worker. → {ok, dados} | {ok:false, erro, codigo} (cru, para diagnóstico também). */
  function registrarRecarga(chave, carteira, valor, referencia) {
    return _post('/api/jarvis/recarga-voucher', { chave: chave, carteira: carteira, valor: valor, referencia: referencia });
  }
  function desfazerRecarga(carteira, referencia) {
    return _post('/api/jarvis/recarga-voucher/desfazer', { carteira: carteira, referencia: referencia });
  }

  function _frasearItens(itens) {
    return itens.map(function (i) { return _brl(i.valor) + (i.carteira === 'mobilidade' ? ' na mobilidade' : ' no voucher'); }).join(' e ');
  }

  var ACOES = {
    recarga: {
      propor: function (msg) {
        var r = interpretarRecarga(msg);
        if (!r) return null;
        if (r.erro) return { resp: r.erro };
        var total = r.itens.reduce(function (t, i) { return t + i.valor; }, 0);
        var p = { tipo: 'recarga', itens: r.itens, referencia: r.referencia, id: Utilities.getUuid().replace(/-/g, '').slice(0, 12) };
        return { pend: p, resp: (total >= 3000 ? 'Esse valor é alto. ' : '') + 'Confirma a recarga de ' + _mesFalado(r.referencia) + ': ' + _frasearItens(r.itens) + '? Diga sim ou não.' };
      },
      executar: function (p) {
        var criados = [], jaExistia = [], falhou = [];
        p.itens.forEach(function (i) {
          var r = registrarRecarga(p.id, i.carteira, i.valor, p.referencia);
          if (!r.ok) { falhou.push(i); return; }
          if (r.dados.criado === false) jaExistia.push({ carteira: i.carteira, valor: i.valor, existente: r.dados.existente }); else criados.push(i);
        });
        var partes = [];
        if (criados.length) partes.push('Registrei a recarga de ' + _mesFalado(p.referencia) + ': ' + _frasearItens(criados) + '. Para desfazer, diga desfaz.');
        jaExistia.forEach(function (j) {
          partes.push('Já existe recarga de ' + _mesFalado(p.referencia) + (j.existente != null ? ' de ' + _brl(j.existente) : '') + ' ' + (j.carteira === 'mobilidade' ? 'na mobilidade' : 'no voucher') + ', então não mudei. Se estiver errada, corrija na caderneta.');
        });
        if (falhou.length) partes.push('Não consegui registrar ' + _frasearItens(falhou) + ' agora. Não gravei nada disso; tente de novo daqui a pouco.');
        return { resp: partes.join(' '), desfazer: criados.length ? { tipo: 'recarga', itens: criados, referencia: p.referencia, em: Date.now() } : null };
      },
      desfazer: function (u) {
        var feitos = 0;
        u.itens.forEach(function (i) { var r = desfazerRecarga(i.carteira, u.referencia); if (r.ok && Number(r.dados.removido) > 0) feitos++; });
        return feitos ? 'Desfeito: tirei a recarga de ' + _mesFalado(u.referencia) + ' que acabei de registrar.' : 'Não consegui desfazer. Ajuste na caderneta.';
      }
    }
  };

  // ── GASTO AVULSO por voz e por notificação do banco (14/10) ──────────────────────────────────────────────────
  // "Gastei 35 reais no mercado no débito" → propõe, repete e espera o "sim". Da notificação do banco (Mercado Pago,
  // Bradesco) o Code.js registra sozinho e guarda o "desfaz". Cartão de crédito já está na fatura: o app não soma de novo no
  // livre; Pix/débito e dinheiro descontam do livre. Voucher e mobilidade vão pelo endpoint do Swile.

  /** Categoria do app (a lista do formulário de gasto) pelo nome do lugar. Palavras fixas, sem modelo; sem pista = 'Outros'. */
  var _CATEGORIAS_PALAVRAS = [
    ['Trabalho',    /\b(google cloud|google|anthropic|claude|openai|github|vercel|cloudflare|dominio|hospedagem|aws|azure)\b/],
    ['Compras',     /\b(shopee|mercado livre|amazon|magalu|americanas|shein|aliexpress|loja\w*|roupa\w*|sapato\w*|tenis|presente\w*)\b/],
    ['Mercado',     /\b(mercado|supermercado\w*|atacad\w*|atacarejo|assai|carrefour|sam s club|sams club|epa|verdemar|hortifruti|acougue|sacolao)\b/],
    ['Alimentação', /\b(padaria|lanche\w*|restaurante|ifood|pizza\w*|lanchonete|acai|cafe|cafeteria|bar|almoco|janta\w*|sorvete\w*|hamburguer\w*|churrasc\w*|salgado\w*|marmit\w*|doceria|sushi|pastel\w*)\b/],
    ['Transporte',  /\b(uber|99|posto|gasolina|etanol|combustivel|estacionamento|pedagio|onibus|metro|shell|ipiranga|taxi|oficina|mecanic\w*)\b/],
    ['Saúde',       /\b(farmacia|drogaria|drogasil|pacheco|raia|hospital|clinica|medic\w*|dentista|laboratorio|exame\w*|remedio\w*|consulta)\b/],
    ['Lazer',       /\b(cinema|netflix|spotify|ingresso\w*|parque|show|steam|playstation|xbox|jogo\w*|viagem|hotel)\b/],
    ['Educação',    /\b(curso\w*|escola|faculdade|livro\w*|livraria|udemy|alura)\b/],
    ['Casa',        /\b(leroy|construcao|moveis|conserto\w*|eletricista|encanador|limpeza)\b/]
  ];
  function categoriaDe(texto) {
    var s = _norm(texto);
    for (var i = 0; i < _CATEGORIAS_PALAVRAS.length; i++) if (_CATEGORIAS_PALAVRAS[i][1].test(s)) return _CATEGORIAS_PALAVRAS[i][0];
    return 'Outros';
  }

  /** Gasto geral no Worker (cartão, débito, Pix, dinheiro, boleto). g = {origem:'mp'|'bd'|'vz', chave, data, valor, meio, categoria, descricao}. */
  function registrarGasto(g) {
    var r = _post('/api/jarvis/gasto', g);
    if (r.ok) return { ok: true, criado: r.dados.criado !== false, motivo: r.dados.motivo || null, existente: r.dados.existente || null };
    var c = Number(r.codigo);
    return { ok: false, erro: r.erro, definitivo: c >= 400 && c < 500 && c !== 429 && c !== 401 };
  }
  function desfazerGasto(origem, chave) {
    var r = _post('/api/jarvis/gasto/desfazer', { origem: origem, chave: chave });
    return r.ok ? { ok: true, removido: Number(r.dados.removido) || 0 } : { ok: false, erro: r.erro };
  }
  /** O Code.js chama isto depois de registrar um gasto vindo de notificação, para o "desfaz" valer também para ele. */
  // LOG DE AÇÕES DESFAZÍVEIS (14/10). Antes o "desfaz" morria com o cache, em 10 min. Agora cada ação que grava na caderneta deixa um registro em
  // Script Property (até 20, por 3 dias). Dentro de 10 minutos o "desfaz" é direto; depois, o Jarvis diz O QUE foi e HÁ QUANTO TEMPO e pergunta
  // antes de desfazer (a recarga ainda pode ser desfeita no Worker por 72 h). Nada de dado financeiro além do que a própria ação precisa para desfazer.
  var LOG_DIAS = 3, LOG_MAX = 20;
  function _lerLog() { try { var l = JSON.parse(_p('FIN_LOG_ACOES') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function _gravarLog(l) { try { PropertiesService.getScriptProperties().setProperty('FIN_LOG_ACOES', JSON.stringify(l)); } catch (e) {} }
  function _logRecente() { var corte = Date.now() - LOG_DIAS * 86400000; return _lerLog().filter(function (x) { return x && x.em >= corte && x.tipo; }); }
  function _ultimaAcao() { var l = _logRecente(); return l.length ? l[l.length - 1] : null; }
  function _tirarDoLog(em) { _gravarLog(_lerLog().filter(function (x) { return x.em !== em; })); }
  function _quando(em) {
    var min = Math.max(0, Math.round((Date.now() - em) / 60000));
    if (min < 60) return 'há ' + min + (min === 1 ? ' minuto' : ' minutos');
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
    var d = Math.round(h / 24);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }
  function _descAcao(u) {
    var v = u.valor != null ? _brl(u.valor) : '';
    switch (u.tipo) {
      case 'gasto': return 'o gasto de ' + v + (u.descricao ? ' em ' + u.descricao : '');
      case 'receita': return 'a receita de ' + v + (u.descricao ? ' de ' + nomeCurto(u.descricao) : '');
      case 'recarga': return 'a recarga de ' + (u.referencia ? _mesFalado(u.referencia) : 'um mês');
      case 'pagar': return 'o pagamento de ' + (u.nome || 'uma conta');
      case 'receber': return 'o recebimento de ' + (u.nome || 'uma receita');
      case 'meta': return 'a alteração da meta ' + (u.nome || '');
      case 'aplicar': return (u.mov === 'Resgate' ? 'o resgate de ' : 'a aplicação de ') + v + (u.descricao ? ' em ' + u.descricao : '');
      case 'aporte': return 'o aporte de ' + v;
      // u.acao é o que o DESFAZ faz: desfazer um fechamento = reabrir, então a ação original foi o fechamento
      case 'fecharMes': return (u.acao === 'reabrir' ? 'o fechamento de ' : 'a reabertura de ') + (u.nome || 'um mês');
      case 'saldoInvest': return 'a atualização do saldo de ' + (u.nome || 'um investimento');
      case 'consultor': return 'o ajuste ' + (u.rotulo || 'do consultor');
      default: return 'a última ação';
    }
  }
  /** Registra uma ação desfazível (as ações novas e o Code.js, para o gasto que veio de notificação do banco). */
  function guardarDesfazer(u) {
    u.em = Date.now(); u.desc = _descAcao(u);
    var l = _logRecente(); l.push(u);
    if (l.length > LOG_MAX) l = l.slice(l.length - LOG_MAX);
    _gravarLog(l);
  }

  var _MEIOS_FALADOS = [
    // [regex, meio do app, rótulo falado, carteira]
    [/\b(mobilidade)\b/, null, 'na mobilidade', 'mobilidade'],
    [/\b(voucher|vouchers|swile|vale)\b/, null, 'no voucher', 'voucher'],
    [/\b(credito)\b/, 'Cartão de crédito', 'no crédito', null],
    [/\b(debito)\b/, 'Pix / débito', 'no débito', null],
    [/\b(pix)\b/, 'Pix / débito', 'no pix', null],
    [/\b(dinheiro|especie)\b/, 'Dinheiro', 'em dinheiro', null],
    [/\b(boleto)\b/, 'Boleto', 'no boleto', null],
    [/\b(alimentacao|refeicao)\b/, null, 'no voucher', 'voucher']   // só vale se nenhuma forma de pagar foi dita
  ];
  function _meioDe(s) {
    for (var i = 0; i < _MEIOS_FALADOS.length; i++) if (_MEIOS_FALADOS[i][0].test(s)) return { meio: _MEIOS_FALADOS[i][1], rotulo: _MEIOS_FALADOS[i][2], carteira: _MEIOS_FALADOS[i][3] };
    return null;
  }
  var _PARADAS = /^(gastei|paguei|comprei|passei|reais?|real|r|hoje|ontem|um|uma|uns|umas|de|do|da|dos|das|no|na|nos|nas|em|com|para|pra|pro|o|a|os|as|e|que|eu|aqui|agora|cartao|credito|debito|pix|dinheiro|especie|boleto|voucher|vale|swile|mobilidade|alimentacao|refeicao|foram|foi|saiu|total|pelo|pela|via|por|ai)$/;

  /** "gastei 35 reais no mercado no débito" → {valor, meio, rotulo, carteira, descricao, categoria, dias} | {erro} | null. */
  function interpretarGasto(msg) {
    var s = _norm(msg).replace(/[?]/g, '');
    if (!/\b(gastei|paguei|comprei)\b/.test(s)) return null;
    if (/\b(quanto|qual|quais|quando|onde|quantos)\b/.test(s)) return null;
    // contas fixas e fatura têm a previsão própria na caderneta: lançar como gasto avulso contaria duas vezes
    if (/\b(fatura|parcela|aluguel|financiamento|condominio|iptu|ipva|luz|energia|agua|internet|telefone|plano de saude|dizimo)\b/.test(s)) return null;
    var simples = _numerosSimples(msg);
    var mv = simples.match(/(\d+(?:\.\d+)?)/);
    if (!mv) return null;
    var valor = Math.round(Number(mv[1]) * 100) / 100;
    if (!(valor > 0)) return null;
    if (valor > 20000) return { erro: 'Esse valor passa de vinte mil reais, o limite do Jarvis. Registre direto na caderneta.' };
    var m = _meioDe(_norm(simples).replace(/\d+(\.\d+)?/g, ' '));
    var palavras = _norm(simples).split(' ').map(function (t, i) { return t; });
    var original = simples.split(/\s+/);
    var descr = original.filter(function (t) {
      var n = _norm(t).replace(/[^a-z0-9]/g, '');
      return n && !/^\d/.test(n) && !_PARADAS.test(n);
    }).join(' ').slice(0, 50);
    var dias = /\bontem\b/.test(s) ? 1 : 0;
    return { valor: valor, meio: m ? m.meio : null, rotulo: m ? m.rotulo : null, carteira: m ? m.carteira : null,
             descricao: descr, categoria: categoriaDe(descr || s), dias: dias, temMeio: !!m };
  }

  function _fraseGasto(p) {
    var dia = p.dias === 1 ? 'ontem' : 'hoje';
    var onde = p.descricao ? ' em ' + p.descricao : '';
    var cat = p.carteira ? '' : ', categoria ' + p.categoria;
    return 'Confirma o gasto de ' + _brl(p.valor) + onde + ', ' + p.rotulo + cat + ', ' + dia + '? Diga sim ou não.';
  }
  function _dataGasto(dias) {
    return Utilities.formatDate(new Date(Date.now() - dias * 86400000), TZ, 'yyyy-MM-dd');
  }

  ACOES.gasto = {
    propor: function (msg) {
      var g = interpretarGasto(msg);
      if (!g) return null;
      if (g.erro) return { resp: g.erro };
      var p = { tipo: 'gasto', valor: g.valor, meio: g.meio, rotulo: g.rotulo, carteira: g.carteira, descricao: g.descricao,
                categoria: g.categoria, dias: g.dias, id: Utilities.getUuid().replace(/-/g, '').slice(0, 12) };
      if (!g.temMeio) { p.aguarda = 'meio'; return { pend: p, resp: 'Gasto de ' + _brl(p.valor) + (p.descricao ? ' em ' + p.descricao : '') + '. Foi no débito, no crédito, no pix, em dinheiro ou no voucher?' }; }
      return { pend: p, resp: (p.valor >= 500 ? 'Esse valor é alto. ' : '') + _fraseGasto(p) };
    },
    executar: function (p) {
      var data = _dataGasto(p.dias || 0), r, via;
      if (p.carteira) {
        via = 'swile';
        r = registrarGastoSwile({ chave: p.id, data: data, carteira: p.carteira, valor: p.valor, estabelecimento: p.descricao });
      } else {
        via = p.origem || 'vz';   // 'it' quando vem de uma notificação do Itaú confirmada por voz (com dedup contra o que ele digitou)
        r = registrarGasto({ origem: via, chave: p.id, data: data, valor: p.valor, meio: p.meio, categoria: p.categoria, descricao: p.descricao });
      }
      if (!r.ok) return { resp: 'Não consegui registrar o gasto agora. Não gravei nada; tente de novo daqui a pouco.' };
      if (r.criado === false) return { resp: r.motivo === 'ja_existe' ? 'Já havia um gasto igual na caderneta, então não dupliquei.' : 'Esse gasto já estava registrado.' };
      var quando = p.dias === 1 ? ' de ontem' : '';
      return { resp: 'Registrei o gasto' + quando + ' de ' + _brl(p.valor) + (p.descricao ? ' em ' + p.descricao : '') + ', ' + p.rotulo + '. Para desfazer, diga desfaz.',
               desfazer: { tipo: 'gasto', via: via, chave: p.id, valor: p.valor, descricao: p.descricao || '' } };
    },
    desfazer: function (u) {
      var r = u.via === 'swile' ? desfazerGastoSwile(u.chave) : desfazerGasto(u.via, u.chave);
      return (r.ok && r.removido > 0) ? 'Desfeito: tirei o gasto de ' + _brl(u.valor) + (u.descricao ? ' em ' + u.descricao : '') + '.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── ENTRADAS: receita extra (Pix recebido, "recebi 450 da Maria") — SEMPRE com confirmação ──────────────────────
  // Dinheiro que entra mexe no livre e pode nem ser renda (transferência entre as contas dele, reembolso). Por isso nunca é automático:
  // a notificação do banco vira uma pergunta falada ("Registro como receita extra?") que fica 15 min esperando o sim.
  var _CATS_RECEITA = [
    ['Reembolso', /\b(reembols\w*|devolu\w*|estorno)\b/],
    ['Venda', /\b(vend\w*)\b/],
    ['Presente ou doação recebida', /\b(presente|doacao|doei|ganhei)\b/],
    ['Ajuda da esposa nas despesas', /\b(ajuda|esposa|esposo)\b/],
    ['Serviço extra', /\b(servico|freela\w*|trabalho extra|bico)\b/]
  ];
  function _categoriaReceita(s) {
    var n = _norm(s);
    for (var i = 0; i < _CATS_RECEITA.length; i++) if (_CATS_RECEITA[i][1].test(n)) return _CATS_RECEITA[i][0];
    return null;
  }

  /** O remetente é o próprio dono? Compara com FIN_NOME_DONO (Script Property; o nome não vai para o repositório): 2+ palavras em comum. */
  function ehDoDono(nome) {
    var dono = _norm(_p('FIN_NOME_DONO') || '').split(' ').filter(function (t) { return t.length > 2; });
    if (dono.length < 2) return false;
    var n = ' ' + _norm(nome) + ' ';
    return dono.filter(function (t) { return n.indexOf(' ' + t + ' ') !== -1; }).length >= 2;
  }

  function registrarReceita(r) {
    var x = _post('/api/jarvis/receita', r);
    if (x.ok) return { ok: true, criado: x.dados.criado !== false, motivo: x.dados.motivo || null };
    var c = Number(x.codigo);
    return { ok: false, erro: x.erro, definitivo: c >= 400 && c < 500 && c !== 429 && c !== 401 };
  }
  function desfazerReceita(chave) {
    var x = _post('/api/jarvis/receita/desfazer', { chave: chave });
    return x.ok ? { ok: true, removido: Number(x.dados.removido) || 0 } : { ok: false, erro: x.erro };
  }

  /**
   * Notificação de banco SEM parser exato (Itaú) → guarda a proposta de gasto (15 min, `fin_pend_banco`) e devolve a frase que o Code.js notifica E fala.
   * Sem a forma de pagar no texto, a frase pergunta "crédito, débito ou pix?" e a resposta completa a proposta; o "sim" grava (origem it).
   */
  function proporBancoGenerico(g) {
    var rotulo = g.meio === 'Cartão de crédito' ? 'no crédito' : (g.meio ? 'no débito ou pix' : null);
    var desc = String(g.descricao || '').trim();
    var p = { tipo: 'gasto', valor: g.valor, meio: g.meio || null, rotulo: rotulo, carteira: null, descricao: desc, categoria: categoriaDe(desc), dias: 0, id: g.chave, origem: g.origem || 'it', aguarda: g.meio ? null : 'meio' };
    _cachePut('fin_pend_banco', p, 900);
    var base = 'No Itaú: gasto de ' + _brl(g.valor) + (desc ? ' em ' + desc : '');
    return g.meio ? base + ', ' + rotulo + '. Registro na caderneta, categoria ' + p.categoria + '? Diga sim ou não.'
                  : base + '. Foi no crédito, no débito ou no pix?';
  }

  /** Notificação de Pix recebido → guarda a proposta (15 min) e devolve a frase que o Code.js notifica E fala. */
  function proporEntrada(e) {
    _cachePut('fin_pend_entrada', { tipo: 'receita', valor: e.valor, descricao: e.remetente, chave: e.chave, data: e.data, origem: e.origem, categoria: null }, 900);
    return 'Você recebeu um Pix de ' + _brl(e.valor) + ' de ' + nomeCurto(e.remetente) + '. Registro como receita extra? Diga sim ou não.';
  }
  function nomeCurto(n) { return String(n || '').toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\bD([aeo]s?)\b/g, 'd$1'); }

  function _fraseReceita(p) { return _brl(p.valor) + ' de ' + nomeCurto(p.descricao) + (p.categoria ? ' (' + p.categoria + ')' : ''); }

  ACOES.receita = {
    // por voz: "recebi 450 da Maria no pix" → propõe. Salário e rendimento têm previsão própria na caderneta: ficam de fora.
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (!/\b(recebi|ganhei)\b/.test(s)) return null;
      if (/\b(quanto|qual|quais|quando|salario|rendimento|rendimentos|recarga|voucher|swile|vale|mobilidade|dividendo\w*|aluguel)\b/.test(s)) return null;
      var mv = _numerosSimples(msg).match(/(\d+(?:\.\d+)?)/);
      if (!mv) return null;
      var valor = Math.round(Number(mv[1]) * 100) / 100;
      if (!(valor > 0)) return null;
      if (valor > 20000) return { resp: 'Esse valor passa de vinte mil reais, o limite do Jarvis. Registre direto na caderneta.' };
      var md = _norm(_numerosSimples(msg)).match(/\b(?:de|do|da|dos|das)\s+([a-z ]{2,40}?)(?:\s+(?:no|na|em|por|via|pelo|pela)\b|$)/);
      var quem = md ? md[1].trim() : '';
      var p = { tipo: 'receita', valor: valor, descricao: quem || 'Receita extra', categoria: _categoriaReceita(s), origem: 'vz', data: _dataGasto(/\bontem\b/.test(s) ? 1 : 0),
                chave: Utilities.getUuid().replace(/-/g, '').slice(0, 12) };
      return { pend: p, resp: (valor >= 500 ? 'Esse valor é alto. ' : '') + 'Confirma a receita extra de ' + _fraseReceita(p) + ', ' + (/\bontem\b/.test(s) ? 'ontem' : 'hoje') + '? Diga sim ou não.' };
    },
    executar: function (p) {
      var r = registrarReceita({ origem: p.origem, chave: p.chave, data: p.data, valor: p.valor, categoria: p.categoria || 'Outros', descricao: p.descricao });
      if (!r.ok) return { resp: 'Não consegui registrar a receita agora. Não gravei nada; tente de novo daqui a pouco.' };
      if (!r.criado) return { resp: r.motivo === 'ja_existe' ? 'Já havia uma receita igual na caderneta, então não dupliquei.' : 'Essa receita já estava registrada.' };
      return { resp: 'Registrei a receita extra de ' + _fraseReceita(Object.assign({}, p, { categoria: p.categoria || 'Outros' })) + '. Para desfazer, diga desfaz.',
               desfazer: { tipo: 'receita', chave: p.chave, valor: p.valor, descricao: p.descricao } };
    },
    desfazer: function (u) {
      var r = desfazerReceita(u.chave);
      return (r.ok && r.removido > 0) ? 'Desfeito: tirei a receita de ' + _brl(u.valor) + ' de ' + nomeCurto(u.descricao) + '.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── MARCAR CONTA COMO PAGA por voz ("paguei o aluguel", "paguei a fatura do Itaú") — com confirmação ───────────────
  // Mesmo efeito do check do app: a conta sai das pendências e desconta do livre. Só contas que existem no mês (despesa, fatura, parcela).
  // O gasto avulso ignora essas palavras de propósito (lançar de novo contaria duas vezes): quem as trata é esta ação.
  var _PARADAS_PAGAR = /^(paguei|pagou|pagamos|pago|paga|pagar|quitei|quitou|ja|marca|marcar|marque|marcou|como|baixa|dar|da|de|do|das|dos|na|no|nas|nos|a|o|as|os|um|uma|conta|contas|mes|este|esse|essa|meu|minha|hoje|ontem|aqui|ai|reais?|real|valor|pelo|pela|com|foi|ta|esta|eh|que|e|em|para|pra|tambem|agora|ja|tudo)$/;
  function _tokensConta(texto) {
    return _norm(texto).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(function (t) { return t.length > 2 && !/^\d/.test(t) && !_PARADAS_PAGAR.test(t); });
  }
  function _tokenCasa(q, t) { return q === t || (q.length >= 4 && t.length >= 4 && (q.indexOf(t) === 0 || t.indexOf(q) === 0)); }

  ACOES.pagar = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (/\b(quanto|qual|quais|quando|onde|vence|vencem|falta|faltam)\b/.test(s)) return null;
      var verbo = /\b(paguei|pagou|pagamos|quitei|quitou)\b/.test(s) || (/\bmarca\w*\b/.test(s) && /\bpag[ao]s?\b/.test(s)) || /\bja (foi|esta|ta) pag[ao]\b/.test(s) || /\bdar? baixa\b/.test(s);
      if (!verbo) return null;
      var q = _tokensConta(msg);
      if (!q.length) return null;
      var r = resumo();
      if (!r.ok || !r.dados || !r.dados.obrigacoes) return null;   // sem a caderneta, deixa seguir (o aviso de falha vem do fluxo normal)
      var mes = r.dados.mes;
      var casam = r.dados.obrigacoes.filter(function (o) {
        if (!o.chave) return false;
        var ti = _tokensConta(o.nome);
        return q.every(function (qq) { return ti.some(function (t) { return _tokenCasa(qq, t); }); });
      });
      if (!casam.length) return { resp: 'Não achei essa conta entre as de ' + (_MESES[Number(mes.slice(5, 7)) - 1] || mes) + ' na caderneta. Para um gasto avulso, diga o valor e onde foi.' };
      var abertas = casam.filter(function (o) { return !o.pago; });
      if (!abertas.length) return { resp: casam[0].nome + ' já está marcada como paga.' };
      var minhas = abertas.filter(function (o) { return !o.outroPaga; });
      if (!minhas.length) return { resp: abertas[0].nome + ' é paga por outra pessoa na caderneta, então não marco como paga por você.' };
      if (minhas.length > 1) return { resp: 'Achei mais de uma: ' + minhas.slice(0, 3).map(function (o) { return o.nome; }).join(', ') + '. Diga o nome completo da que você pagou.' };
      var o = minhas[0];
      var dito = _numerosSimples(msg).match(/(\d+(?:\.\d+)?)/);
      var aviso = '';
      if (dito && Number(o.valor) > 0 && Math.abs(Number(dito[1]) - Number(o.valor)) / Number(o.valor) > 0.01) {
        aviso = ' Você falou ' + _brl(Number(dito[1])) + ', mas na caderneta está ' + _brl(o.valor) + '.';
      }
      var p = { tipo: 'pagar', mes: mes, chave: o.chave, nome: o.nome, valor: o.valor, id: Utilities.getUuid().replace(/-/g, '').slice(0, 12) };
      return { pend: p, resp: 'Marco como paga: ' + o.nome + ', ' + _brl(o.valor) + (o.dia ? ', dia ' + o.dia : '') + '.' + aviso + ' Diga sim ou não.' };
    },
    executar: function (p) {
      var x = _post('/api/jarvis/pagamento', { mes: p.mes, chave: p.chave, pago: true });
      if (!x.ok) return { resp: 'Não consegui marcar como paga agora. Não mudei nada; tente de novo daqui a pouco.' };
      var livre = '';
      var r = resumo();
      if (r.ok && r.dados && r.dados.livreHoje != null) livre = ' Seu livre hoje agora é ' + _brl(r.dados.livreHoje) + (Number(r.dados.livreHoje) < 0 ? ' negativo' : '') + '.';
      if (!x.dados.mudou) return { resp: p.nome + ' já estava marcada como paga.' };
      return { resp: 'Marquei ' + p.nome + ' como paga.' + livre + ' Para desfazer, diga desfaz.', desfazer: { tipo: 'pagar', mes: p.mes, chave: p.chave, nome: p.nome } };
    },
    desfazer: function (u) {
      var x = _post('/api/jarvis/pagamento', { mes: u.mes, chave: u.chave, pago: false });
      return (x.ok && x.dados.mudou) ? 'Desfeito: ' + u.nome + ' voltou a ficar pendente.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── META por voz ("minha meta é casa própria, 150 mil, até 2030") — com confirmação; fica nas Script Properties (CONSULTOR_METAS) ──
  function _lerMetas() { try { var m = JSON.parse(_p('CONSULTOR_METAS') || '[]'); return Array.isArray(m) ? m : []; } catch (e) { return []; } }
  function _gravarMetas(m) { try { PropertiesService.getScriptProperties().setProperty('CONSULTOR_METAS', JSON.stringify(m)); return true; } catch (e) { return false; } }

  // Criar ("minha meta é casa própria, 150 mil, até 2030"), EDITAR ("muda a meta casa para 180 mil", "a meta casa agora é até 2032") e APAGAR
  // ("apaga a meta casa"), sempre com confirmação. A meta existente é achada pelas palavras do nome, então "casa" acha "Casa própria".
  var _LIGA_META = { 'é': 1, e: 1, eh: 1, de: 1, da: 1, do: 1, seria: 1, para: 1, pra: 1, a: 1, o: 1, uma: 1, um: 1, em: 1, por: 1, ate: 1, 'até': 1, agora: 1, que: 1, valor: 1, prazo: 1, ano: 1, anos: 1, mil: 1, milhao: 1, milhoes: 1, 'milhão': 1, 'milhões': 1, minha: 1, meu: 1 };
  function _acharMeta(s, metas) {
    var depois = s.split(/\bmeta\b/).slice(1).join(' ');
    var q = depois.replace(/[0-9.,]+/g, ' ').split(/\s+/).filter(function (t) { return t.length > 2 && !_LIGA_META[t]; });
    return metas.filter(function (m) {
      var ti = _norm(m.nome).split(' ').filter(function (t) { return t.length > 2; });
      return q.some(function (qq) { return ti.some(function (t) { return _tokenCasa(qq, t); }); });
    });
  }
  function _valorEAno(s) {
    var ano = s.match(/\b(20\d{2})\b/);
    var nums = Consultor.numerosFalados(s).filter(function (n) { return !(ano && String(n.valor) === ano[1]); });
    var anos = s.match(/\bem (\d+) anos?\b/);
    var valor = nums.length ? nums.slice().sort(function (a, b) { return b.valor - a.valor; })[0].valor : null;
    var anoAlvo = ano ? ano[1] : (anos ? String(Number(Utilities.formatDate(new Date(), TZ, 'yyyy')) + Number(anos[1])) : '');
    return { valor: valor, ano: anoAlvo };
  }

  ACOES.meta = {
    propor: function (msg) {
      var s = _norm(msg);
      if (typeof Consultor === 'undefined' || /\b(quanto falta|como estou|quais|como estao)\b/.test(s)) return null;
      var remover = /\b(apag\w+|remov\w+|exclu\w+|delet\w+|tire|tira)\b.*\bmeta\b/.test(s);
      var editar = !remover && /\b(muda\w*|alter\w*|ajust\w*|atualiz\w*|troc\w*|corrig\w*)\b.*\bmeta\b/.test(s);
      var criar = !remover && !editar && /\b(minha meta|nova meta|defin\w* (a |uma )?meta|cadastr\w* (a |uma )?meta|meta (e|eh|seria))\b/.test(s);
      if (!remover && !editar && !criar) return null;
      var metas = _lerMetas();

      if (remover || editar) {
        var casam = _achar_meta_seguro(s, metas);
        if (!casam.length) return { resp: metas.length ? 'Não achei essa meta. Você tem: ' + metas.map(function (m) { return m.nome; }).join(', ') + '.' : 'Você não tem metas cadastradas.' };
        if (casam.length > 1) return { resp: 'Achei mais de uma: ' + casam.map(function (m) { return m.nome; }).join(', ') + '. Diga o nome completo.' };
        var m0 = casam[0];
        if (remover) return { pend: { tipo: 'meta', acao: 'remover', nome: m0.nome }, resp: 'Confirma apagar a meta ' + m0.nome + ' (' + _brl(m0.alvo) + ' até ' + m0.ate + ')? Diga sim ou não.' };
        var ve = _valorEAno(s);
        if ((ve.valor === null || ve.valor < 1000) && !ve.ano) return { resp: 'Diga o novo valor ou o novo ano da meta ' + m0.nome + ', por exemplo: muda a meta ' + m0.nome.toLowerCase() + ' para 180 mil até 2031.' };
        var novoAlvo = (ve.valor !== null && ve.valor >= 1000) ? Math.round(ve.valor) : m0.alvo, novoAte = ve.ano || m0.ate;
        if (novoAlvo > 100000000) return { resp: 'Esse valor passa de cem milhões. Diga um valor menor.' };
        return { pend: { tipo: 'meta', acao: 'editar', nome: m0.nome, alvo: novoAlvo, ate: novoAte },
                 resp: 'Confirma mudar a meta ' + m0.nome + ' de ' + _brl(m0.alvo) + ' até ' + m0.ate + ' para ' + _brl(novoAlvo) + ' até ' + novoAte + '? Diga sim ou não.' };
      }

      var v = _valorEAno(s);
      if (v.valor === null) return null;
      var bruto = String(msg || '').toLowerCase().split(/\bmeta\b/).slice(1).join(' meta ').split(/\d/)[0];
      // (\b do JavaScript não enxerga "é" como letra: por isso o filtro é por palavra inteira, não por regex)
      var nome = bruto.replace(/[,;:]/g, ' ').split(/\s+/).filter(function (t) { return t && !_LIGA_META[t]; }).join(' ');
      if (!(v.valor >= 1000) || !v.ano || nome.length < 3) {
        return { resp: 'Para cadastrar uma meta, diga o nome, o valor e o ano, por exemplo: minha meta é casa própria, 150 mil, até 2030.' };
      }
      if (v.valor > 100000000) return { resp: 'Esse valor passa de cem milhões. Diga um valor menor.' };
      nome = nome.charAt(0).toUpperCase() + nome.slice(1);
      var p = { tipo: 'meta', acao: 'criar', nome: nome.slice(0, 40), alvo: Math.round(v.valor), ate: v.ano };
      return { pend: p, resp: 'Confirma a meta ' + p.nome + ': ' + _brl(p.alvo) + ' até ' + p.ate + '? Diga sim ou não.' };
    },
    executar: function (p) {
      var antes = _lerMetas(), depois;
      if (p.acao === 'remover') {
        depois = antes.filter(function (m) { return _norm(m.nome) !== _norm(p.nome); });
      } else {
        depois = antes.filter(function (m) { return _norm(m.nome) !== _norm(p.nome); });
        depois.push({ nome: p.nome, alvo: p.alvo, ate: p.ate });
        if (depois.length > 5) depois = depois.slice(depois.length - 5);
      }
      if (!_gravarMetas(depois)) return { resp: 'Não consegui gravar a meta agora. Não mudei nada.' };
      var frase = p.acao === 'remover' ? 'Apaguei a meta ' + p.nome + '.'
        : (p.acao === 'editar' ? 'Mudei a meta ' + p.nome + ' para ' + _brl(p.alvo) + ' até ' + p.ate + '.' : 'Cadastrei a meta ' + p.nome + ': ' + _brl(p.alvo) + ' até ' + p.ate + '. Pergunte "como estão minhas metas" quando quiser.');
      return { resp: frase + ' Para desfazer, diga desfaz.', desfazer: { tipo: 'meta', antes: antes, nome: p.nome } };
    },
    desfazer: function (u) {
      return _gravarMetas(u.antes || []) ? 'Desfeito: a meta ' + u.nome + ' voltou ao que era.' : 'Não consegui desfazer a meta.';
    }
  };
  function _achar_meta_seguro(s, metas) { try { return _acharMeta(s, metas); } catch (e) { return []; } }

  // ── RECEBI O SALÁRIO (receita fixa marcada como recebida) — com confirmação ────────────────────────────────────────
  // Mesmo check do app ("recebido"): o valor passa a contar no livre de hoje. Só receitas fixas que EXISTEM na caderneta; "recebi 450 da Maria"
  // (receita extra) segue o fluxo da receita extra. Ambígua pede o nome; já recebida não marca de novo.
  ACOES.receber = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (!/\b(recebi|caiu|cairam|entrou|chegou|recebido)\b/.test(s)) return null;
      if (/\b(quanto|qual|quais|quando|voucher|vale|swile|mobilidade|recarga|pix|rendimento)\b/.test(s)) return null;
      var q = _tokensConta(msg);
      if (!q.length) return null;
      var r = resumo();
      if (!r.ok || !r.dados || !r.dados.receitas) return null;
      var casam = r.dados.receitas.filter(function (o) {
        var ti = _tokensConta(o.nome);
        return q.some(function (qq) { return ti.some(function (t) { return _tokenCasa(qq, t); }); });
      });
      if (!casam.length) return null;   // não é uma receita fixa: deixa a receita extra ou o modelo
      var abertas = casam.filter(function (o) { return !o.recebido; });
      if (!abertas.length) return { resp: casam[0].nome + ' já está marcado como recebido.' };
      if (abertas.length > 1) return { resp: 'Achei mais de uma: ' + abertas.slice(0, 3).map(function (o) { return o.nome; }).join(', ') + '. Diga o nome completo da que você recebeu.' };
      var o = abertas[0];
      var dito = _numerosSimples(msg).match(/(\d+(?:\.\d+)?)/);
      var aviso = (dito && Number(o.valor) > 0 && Math.abs(Number(dito[1]) - Number(o.valor)) / Number(o.valor) > 0.01)
        ? ' Você falou ' + _brl(Number(dito[1])) + ', mas na caderneta está ' + _brl(o.valor) + '.' : '';
      var p = { tipo: 'receber', mes: r.dados.mes, chave: o.chave, nome: o.nome, valor: o.valor };
      return { pend: p, resp: 'Marco ' + o.nome + ' como recebido: ' + _brl(o.valor) + '.' + aviso + ' Isso entra no seu livre de hoje. Diga sim ou não.' };
    },
    executar: function (p) {
      var x = _post('/api/jarvis/pagamento', { mes: p.mes, chave: p.chave, pago: true });
      if (!x.ok) return { resp: 'Não consegui marcar como recebido agora. Não mudei nada; tente de novo daqui a pouco.' };
      if (!x.dados.mudou) return { resp: p.nome + ' já estava marcado como recebido.' };
      var r = resumo(), livre = (r.ok && r.dados && r.dados.livreHoje != null) ? ' Seu livre hoje agora é ' + _brl(r.dados.livreHoje) + (Number(r.dados.livreHoje) < 0 ? ' negativo' : '') + '.' : '';
      return { resp: 'Marquei ' + p.nome + ' como recebido.' + livre + ' Para desfazer, diga desfaz.', desfazer: { tipo: 'receber', mes: p.mes, chave: p.chave, nome: p.nome } };
    },
    desfazer: function (u) {
      var x = _post('/api/jarvis/pagamento', { mes: u.mes, chave: u.chave, pago: false });
      return (x.ok && x.dados.mudou) ? 'Desfeito: ' + u.nome + ' voltou a ficar como não recebido.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── APLICAÇÃO / RESGATE e SALDO DE INVESTIMENTO por voz — com confirmação ─────────────────────────────────────────
  // "Apliquei 500 no cofrinho" lança uma Aplicação (o dinheiro sai do livre). NÃO mexe no saldo do investimento: esse ele atualiza do extrato, com
  // "atualiza o saldo do CDB para 20.800" (outro comando, também confirmado). Assim o mesmo dinheiro nunca é contado duas vezes.
  var _PARADAS_INV = /^(apliquei|investi|aportei|guardei|joguei|coloquei|resgatei|saquei|tirei|atualiza\w*|atualize|saldo|agora|esta|estao|para|pra|ficou|virou|eh|em|no|na|nos|nas|do|da|de|dos|das|o|a|os|as|um|uma|reais?|real|hoje|ontem|meu|minha|valor|que|e|com|por|pelo|pela|aplicacao|investimento|investimentos)$/;
  function _acharInvestimento(msg, itens) {
    var q = _norm(msg).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(function (t) { return t.length > 2 && !/^\d/.test(t) && !_PARADAS_INV.test(t); });
    if (!q.length || !itens || !itens.length) return { achados: [], q: q };
    var pont = itens.map(function (i) {
      var ti = _norm([i.nome, i.instituicao, i.categoria].join(' ')).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(function (t) { return t.length > 2; });
      var n = q.filter(function (qq) { return ti.some(function (t) { return _tokenCasa(qq, t); }); }).length;
      return { i: i, n: n };
    }).filter(function (x) { return x.n > 0; });
    if (!pont.length) return { achados: [], q: q };
    var max = Math.max.apply(null, pont.map(function (x) { return x.n; }));
    return { achados: pont.filter(function (x) { return x.n === max; }).map(function (x) { return x.i; }), q: q };
  }
  function _valorDaFrase(msg) {
    if (typeof Consultor === 'undefined') return null;
    var nums = Consultor.numerosFalados(_norm(msg).replace(/(\d)\s*r\$|r\$\s*/g, '$1 '));
    return nums.length ? nums[0].valor : null;
  }

  ACOES.aplicar = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      var aplic = /\b(apliquei|investi|aportei|guardei|joguei)\b/.test(s);
      var resg = /\b(resgatei|saquei)\b/.test(s) || (/\btirei\b/.test(s) && /\b(cofrinho|investimento|cdb|tesouro|aplicacao|fii)\b/.test(s));
      if (!aplic && !resg) return null;
      if (/\b(quanto|qual|quais|quando|onde)\b/.test(s)) return null;
      var valor = _valorDaFrase(msg);
      if (!(valor > 0)) return null;
      if (valor > 1000000) return { resp: 'Esse valor passa de um milhão. Registre direto na caderneta.' };
      var r = resumo();
      var itens = (r.ok && r.dados && r.dados.investimentos && r.dados.investimentos.itens) || [];
      var ach = _acharInvestimento(msg, itens);
      var onde;
      var _nomeExato = false;
      if (ach.achados.length === 1) { onde = ach.achados[0].nome; _nomeExato = true; }
      else if (ach.achados.length > 1) return { resp: 'Achei mais de um: ' + ach.achados.slice(0, 3).map(function (i) { return i.nome; }).join(', ') + '. Diga qual.' };
      else {
        // destino que não é um investimento da caderneta: fica como ele disse (com acento), sem verbos e sem número
        onde = String(msg || '').split(/\s+/).filter(function (t) {
          var n = _norm(t).replace(/[^a-z0-9]/g, '');
          return n && !/^\d/.test(n) && !_PARADAS_INV.test(n);
        }).slice(0, 4).join(' ').replace(/[.,;:!?]+$/, '');
      }
      if (!onde && aplic) onde = '';
      var p = { tipo: 'aplicar', mov: resg ? 'Resgate' : 'Aplicação', valor: Math.round(valor * 100) / 100, descricao: onde ? (_nomeExato ? onde : nomeCurto(onde)) : '',
                dias: /\bontem\b/.test(s) ? 1 : 0, id: Utilities.getUuid().replace(/-/g, '').slice(0, 12) };
      return { pend: p, resp: (valor >= 5000 ? 'Esse valor é alto. ' : '') + 'Confirma ' + (resg ? 'o resgate' : 'a aplicação') + ' de ' + _brl(p.valor) + (p.descricao ? (resg ? ' de ' : ' em ') + p.descricao : '') +
        ', ' + (p.dias === 1 ? 'ontem' : 'hoje') + '? ' + (resg ? 'Isso volta para o seu livre.' : 'Isso sai do seu livre.') + ' Diga sim ou não.' };
    },
    executar: function (p) {
      var x = _post('/api/jarvis/aplicacao', { chave: p.id, tipo: p.mov, data: _dataGasto(p.dias || 0), valor: p.valor, descricao: p.descricao });
      if (!x.ok) return { resp: 'Não consegui registrar agora. Não gravei nada; tente de novo daqui a pouco.' };
      var r = resumo(), livre = (r.ok && r.dados && r.dados.livreHoje != null) ? ' Seu livre hoje agora é ' + _brl(r.dados.livreHoje) + (Number(r.dados.livreHoje) < 0 ? ' negativo' : '') + '.' : '';
      return { resp: 'Registrei ' + (p.mov === 'Resgate' ? 'o resgate' : 'a aplicação') + ' de ' + _brl(p.valor) + (p.descricao ? (p.mov === 'Resgate' ? ' de ' : ' em ') + p.descricao : '') + '.' + livre +
               ' O saldo do investimento não mudou; atualize com o extrato. Para desfazer, diga desfaz.',
               desfazer: { tipo: 'aplicar', mov: p.mov, chave: p.id, valor: p.valor, descricao: p.descricao } };
    },
    desfazer: function (u) {
      var x = _post('/api/jarvis/aplicacao/desfazer', { chave: u.chave });
      return (x.ok && Number(x.dados.removido) > 0) ? 'Desfeito: tirei ' + (u.mov === 'Resgate' ? 'o resgate' : 'a aplicação') + ' de ' + _brl(u.valor) + '.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  ACOES.saldoInvest = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (/\b(quanto|qual|quais|quando|onde)\b/.test(s)) return null;
      if (!(/\batualiz\w*\b/.test(s) || (/\bsaldo\b/.test(s) && /\b(agora|esta em|ficou|virou|eh de|e de|para)\b/.test(s)))) return null;
      var valor = _valorDaFrase(msg);
      if (!(valor >= 0) || valor === null) return null;
      var r = resumo();
      var itens = (r.ok && r.dados && r.dados.investimentos && r.dados.investimentos.itens) || [];
      var ach = _acharInvestimento(msg, itens);
      if (!ach.achados.length) return null;   // não é um investimento da caderneta ("saldo do voucher" etc. seguem as outras rotas)
      if (ach.achados.length > 1) return { resp: 'Achei mais de um: ' + ach.achados.slice(0, 3).map(function (i) { return i.nome; }).join(', ') + '. Diga o nome completo.' };
      var i = ach.achados[0], novo = Math.round(valor * 100) / 100, antes = Number(i.saldo) || 0, dif = novo - antes;
      var grande = antes > 0 && Math.abs(dif) / antes > 0.3;
      var p = { tipo: 'saldoInvest', id: i.id, nome: i.nome, antes: antes, novo: novo };
      return { pend: p, resp: (grande ? 'A mudança é grande. ' : '') + 'Atualizo o saldo de ' + i.nome + ' de ' + _brl(antes) + ' para ' + _brl(novo) + ' (' + (dif >= 0 ? 'mais ' : 'menos ') + _brl(Math.abs(dif)) + ')? Diga sim ou não.' };
    },
    executar: function (p) {
      var x = _post('/api/jarvis/investimento', { id: p.id, saldo: p.novo });
      if (!x.ok) return { resp: 'Não consegui atualizar o saldo agora. Não mudei nada.' };
      return { resp: 'Atualizei o saldo de ' + p.nome + ' para ' + _brl(x.dados.depois) + '. Para desfazer, diga desfaz.', desfazer: { tipo: 'saldoInvest', id: p.id, nome: p.nome, antes: x.dados.antes, atualizadoAntes: x.dados.atualizadoAntes || null, valor: x.dados.depois } };
    },
    desfazer: function (u) {
      var x = _post('/api/jarvis/investimento', { id: u.id, saldo: u.antes, atualizado: u.atualizadoAntes || undefined });
      return x.ok ? 'Desfeito: o saldo de ' + u.nome + ' voltou para ' + _brl(u.antes) + '.' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── AJUSTAR O CONSULTOR por voz ("muda a margem para 500", "taxa de 1% ao mês", "retoma o rebalanceamento") — com confirmação ───────────
  var _CFG_CONSULTOR = {
    margem:  { chave: 'CONSULTOR_MARGEM',       rotulo: 'da margem',          padrao: '300',   fmt: function (v) { return _brl(Number(v)); } },
    taxa:    { chave: 'CONSULTOR_TAXA_MES',     rotulo: 'da taxa mensal',     padrao: '0.008', fmt: function (v) { return String(Math.round(Number(v) * 10000) / 100).replace('.', ',') + '% ao mês'; } },
    reserva: { chave: 'CONSULTOR_RESERVA_ALVO', rotulo: 'da reserva-alvo',    padrao: '6',     fmt: function (v) { return v + ' meses'; } },
    pausa:   { chave: 'CONSULTOR_PAUSA_ATE',    rotulo: 'da pausa do rebalanceamento', padrao: '', fmt: function (v) { return v ? 'até ' + _mesFalado(String(v).slice(0, 7)) : 'sem pausa'; } },
    destino: { chave: 'CONSULTOR_DESTINO_PAUSA', rotulo: 'do destino da pausa', padrao: '', fmt: function (v) { try { return v ? JSON.parse(v).rotulo : 'nenhum destino'; } catch (e) { return 'nenhum destino'; } } }
  };
  ACOES.consultor = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (/\b(quanto|qual|quais|como esta|esta em)\b/.test(s)) return null;
      var campo = null, valor = null;
      var mn = s.match(/\b(\d+(?:[.,]\d+)?)\b/);
      if (/\bdestino\b/.test(s) && /\bpausa\b/.test(s)) {
        // "o destino da pausa é o cofrinho do Mercado Pago" · "tira o destino da pausa"
        if (/\b(tire|tira|remov\w+|limp\w+|apag\w+|sem destino)\b/.test(s)) { campo = 'destino'; valor = ''; }
        else {
          var depoisTxt = String(msg || '').split(/destino da pausa/i)[1];
          if (depoisTxt === undefined) depoisTxt = String(msg || '').split(/\bpausa\b/i).slice(1).join(' ');
          var _CONEC = { 'é': 1, e: 1, eh: 1, para: 1, pra: 1, seja: 1, seria: 1, como: 1, vai: 1, ser: 1, 'será': 1, agora: 1, de: 1 };
          var toks = depoisTxt.replace(/[,;:.!?]/g, ' ').split(/\s+/).filter(function (t) { return t; });
          while (toks.length && _CONEC[toks[0].toLowerCase()]) toks.shift();
          var art = null, _ART = { o: 'no', a: 'na', os: 'nos', as: 'nas', um: 'em um', uma: 'em uma' };
          if (toks.length && _ART[toks[0].toLowerCase()]) art = _ART[toks.shift().toLowerCase()];
          var resto = toks.join(' ').trim();
          if (resto.length < 3 || resto.length > 60) return { resp: 'Diga qual é o destino, por exemplo: o destino da pausa é o cofrinho do Mercado Pago.' };
          campo = 'destino';
          valor = JSON.stringify({ rotulo: (art || 'em') + ' ' + resto, descricao: resto.charAt(0).toUpperCase() + resto.slice(1) });
        }
      }
      else if (/\b(muda\w*|alter\w*|ajust\w*|defin\w*|coloc\w*|troc\w*|use|usa)\b/.test(s) && /\bmargem\b/.test(s) && mn) { campo = 'margem'; valor = String(Math.round(Number(mn[1].replace(',', '.')))); }
      else if (/\btaxa\b/.test(s) && /\b(muda\w*|alter\w*|ajust\w*|defin\w*|coloc\w*|troc\w*|use|usa|de)\b/.test(s) && /%|por cento/.test(s) && mn) {
        var t = Number(mn[1].replace(',', '.')) / 100;
        if (!(t >= 0 && t <= 0.05)) return { resp: 'A taxa mensal precisa ficar entre zero e cinco por cento.' };
        campo = 'taxa'; valor = String(Math.round(t * 10000) / 10000);
      }
      else if (/\breserva\b/.test(s) && /\b(alvo|ideal|meta)\b/.test(s) && /\b(muda\w*|alter\w*|ajust\w*|defin\w*|coloc\w*|troc\w*|de|para)\b/.test(s) && mn) {
        var mm = Number(mn[1]);
        if (!(mm >= 1 && mm <= 36)) return { resp: 'A reserva-alvo precisa ficar entre 1 e 36 meses.' };
        campo = 'reserva'; valor = String(Math.round(mm));
      }
      else if (/\b(retom\w+|reativ\w+|volt\w+|tire a pausa|tira a pausa|sem pausa)\b/.test(s) && /\brebalanc\w+\b/.test(s)) { campo = 'pausa'; valor = ''; }
      else if (/\b(paus\w+|suspend\w+|segur\w+)\b/.test(s) && /\brebalanc\w+\b/.test(s)) {
        var ym = null, nomes = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        var ano = s.match(/\b(20\d{2})\b/);
        for (var k = 0; k < 12; k++) if (new RegExp('\\b' + nomes[k] + '\\b').test(s)) ym = k + 1;
        if (!ym || !ano) return { resp: 'Diga até quando, por exemplo: pausa o rebalanceamento até janeiro de 2027.' };
        campo = 'pausa'; valor = ano[1] + '-' + (ym < 10 ? '0' : '') + ym + '-01';
      }
      if (!campo) return null;
      var def = _CFG_CONSULTOR[campo], atual = _p(def.chave);
      if (atual === null || atual === undefined || atual === '') atual = def.padrao;
      var p = { tipo: 'consultor', campo: campo, valor: valor, antes: _p(def.chave) };
      if (campo === 'destino') {
        return { pend: p, resp: valor === '' ? 'Confirma tirar o destino da pausa? Durante a pausa o aporte volta a ser dividido pelo alvo. Diga sim ou não.'
                                              : 'Confirma: durante a pausa do rebalanceamento, o aporte inteiro vai ' + def.fmt(valor) + '? Diga sim ou não.' };
      }
      return { pend: p, resp: 'Confirma mudar o valor ' + def.rotulo + ' do consultor de ' + def.fmt(atual) + ' para ' + def.fmt(valor === '' ? '' : valor) + '? Diga sim ou não.' };
    },
    executar: function (p) {
      var def = _CFG_CONSULTOR[p.campo];
      try {
        var sp = PropertiesService.getScriptProperties();
        if (p.valor === '') sp.deleteProperty(def.chave); else sp.setProperty(def.chave, p.valor);
      } catch (e) { return { resp: 'Não consegui gravar o ajuste agora. Não mudei nada.' }; }
      if (p.campo === 'destino') {
        return { resp: (p.valor === '' ? 'Tirei o destino da pausa.' : 'Pronto: durante a pausa do rebalanceamento, o aporte inteiro vai ' + def.fmt(p.valor) + '.') + ' Para desfazer, diga desfaz.',
                 desfazer: { tipo: 'consultor', campo: p.campo, antes: p.antes, rotulo: def.rotulo } };
      }
      return { resp: 'Ajustei o valor ' + def.rotulo + ': ' + def.fmt(p.valor === '' ? '' : p.valor) + '. Para desfazer, diga desfaz.', desfazer: { tipo: 'consultor', campo: p.campo, antes: p.antes, rotulo: def.rotulo } };
    },
    desfazer: function (u) {
      var def = _CFG_CONSULTOR[u.campo];
      try {
        var sp = PropertiesService.getScriptProperties();
        if (u.antes === null || u.antes === undefined || u.antes === '') sp.deleteProperty(def.chave); else sp.setProperty(def.chave, u.antes);
      } catch (e) { return 'Não consegui desfazer o ajuste.'; }
      return 'Desfeito: o valor ' + def.rotulo + ' voltou ao que era.';
    }
  };

  // "Desfaz" depois dos 10 minutos: o Jarvis disse o que foi e há quanto tempo; o "sim" executa por aqui.
  ACOES.desfazer_antigo = {
    propor: function () { return null; },
    executar: function (p) {
      var e = _lerLog().filter(function (x) { return x.em === p.em; })[0];
      if (!e || !ACOES[e.tipo]) return { resp: 'Essa ação já não está mais no registro. Ajuste na caderneta.' };
      _tirarDoLog(e.em);
      return { resp: ACOES[e.tipo].desfazer(e) };
    }
  };
  // ── REGISTRAR O APORTE SUGERIDO ("aportei", "fiz o aporte") — com confirmação ─────────────────────────────────────────
  // O aviso mensal do consultor deixa a sugestão (quanto e onde, por categoria da estratégia). Quando ele diz que aportou, o Jarvis repete a divisão e,
  // no "sim", lança uma Aplicação por destino. Se ele disser um valor ("aportei 800"), a divisão é refeita na mesma proporção. Sem sugestão guardada,
  // calcula o plano de agora; se também não sobra nada, pede o valor e o destino. "Aportei 500 no tesouro" (com destino) é a aplicação normal.
  ACOES.aporte = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      if (!/\b(aportei|fiz (o )?aporte|apliquei o aporte|registr\w+ o aporte|ja aportei|aporte feito)\b/.test(s)) return null;
      if (/\b(cdb|tesouro|fii|fiis|cofrinho|renda fixa|acoes|poupanca|mercado pago|itau|bolsa|cripto)\b/.test(s)) return null;
      if (typeof Consultor === 'undefined') return null;
      var sug = Consultor.sugestaoAporte();
      if (!sug) {
        var r = resumo();
        if (r.ok && r.dados) {
          var pl = Consultor.plano(r.dados, Consultor.cfg(), r.dados.hoje);
          if (pl.ok && pl.partes.length) sug = { valor: pl.pode, partes: pl.partes, calculado: true };
        }
      }
      if (!sug) {
        if (_valorDaFrase(msg)) return null;   // "aportei 500" sem sugestão: é uma aplicação comum, quem trata é a ação de aplicar
        return { resp: 'Não tenho um aporte sugerido agora. Diga o valor e onde, por exemplo: apliquei 800 no tesouro.' };
      }
      var total = sug.partes.reduce(function (t, x) { return t + x.valor; }, 0), dito = _valorDaFrase(msg), partes = sug.partes;
      if (dito && dito > 0 && Math.abs(dito - total) > 0.01) {
        var f = dito / total, acum = 0;
        partes = sug.partes.map(function (x, i) {
          var v = (i === sug.partes.length - 1) ? Math.round((dito - acum) * 100) / 100 : Math.round(x.valor * f * 100) / 100;
          acum += v; return { cat: x.cat, valor: v, destino: x.destino };
        }).filter(function (x) { return x.valor >= 0.01; });
        total = dito;
      }
      if (total > 1000000) return { resp: 'Esse valor passa de um milhão. Registre direto na caderneta.' };
      var p = { tipo: 'aporte', partes: partes, total: Math.round(total * 100) / 100, teste: !!sug.teste, id: Utilities.getUuid().replace(/-/g, '').slice(0, 10) };
      var _fp = function (x) { return _brl(x.valor) + ' ' + (x.destino ? x.destino.rotulo : 'em ' + (x.cat === 'FIIs' ? 'fundos imobiliários' : String(x.cat).replace(/\s*\/\s*(.)/g, function (m, c) { return ' e ' + c.toLowerCase(); }))); };
      if (partes.length === 1) {
        // um destino só (ex.: durante a pausa do rebalanceamento): não repete o valor
        return { pend: p, resp: 'Confirma registrar o aporte ' + _fp(partes[0]).replace(/^R\$ [\d.]+,\d{2} /, 'de ' + _brl(partes[0].valor) + ' ') + ', hoje? Isso sai do seu livre. Diga sim ou não.' };
      }
      return { pend: p, resp: 'Confirma registrar o aporte de ' + _brl(p.total) + ': ' + partes.map(function (x) { return _brl(x.valor) + ' ' + (x.destino ? x.destino.rotulo : 'em ' + (x.cat === 'FIIs' ? 'fundos imobiliários' : String(x.cat).replace(/\s*\/\s*(.)/g, function (m, c) { return ' e ' + c.toLowerCase(); }))); }).join(', ') +
                              ', hoje? Isso sai do seu livre. Diga sim ou não.' };
    },
    executar: function (p) {
      if (p.teste) return { resp: 'Isso foi só o aviso de teste do consultor, então não registrei nada.' };
      var feitos = [], falhou = false;
      p.partes.forEach(function (x, i) {
        var chave = p.id + '_' + i;
        var r = _post('/api/jarvis/aplicacao', { chave: chave, tipo: 'Aplicação', data: _dataGasto(0), valor: x.valor, descricao: x.destino ? x.destino.descricao : String(x.cat).replace(/\s*\/\s*/g, ' e ') });
        if (r.ok) feitos.push({ chave: chave, valor: x.valor }); else falhou = true;
      });
      if (!feitos.length) return { resp: 'Não consegui registrar o aporte agora. Não gravei nada; tente de novo daqui a pouco.' };
      try { Consultor.limparSugestao(); } catch (e) {}
      var r2 = resumo(), livre = (r2.ok && r2.dados && r2.dados.livreHoje != null) ? ' Seu livre hoje agora é ' + _brl(r2.dados.livreHoje) + (Number(r2.dados.livreHoje) < 0 ? ' negativo' : '') + '.' : '';
      return { resp: (falhou ? 'Registrei só parte do aporte (' + feitos.length + ' de ' + p.partes.length + '); o resto não foi gravado.' : 'Registrei o aporte de ' + _brl(p.total) + ' em ' + feitos.length + (feitos.length === 1 ? ' destino' : ' destinos') + '.') +
                      livre + ' O saldo dos investimentos não mudou; atualize com o extrato. Para desfazer, diga desfaz.',
               desfazer: { tipo: 'aporte', chaves: feitos.map(function (x) { return x.chave; }), valor: p.total } };
    },
    desfazer: function (u) {
      var tirados = 0;
      (u.chaves || []).forEach(function (ch) { var r = _post('/api/jarvis/aplicacao/desfazer', { chave: ch }); if (r.ok && Number(r.dados.removido) > 0) tirados++; });
      return tirados ? 'Desfeito: tirei o aporte de ' + _brl(u.valor) + ' (' + tirados + (tirados === 1 ? ' lançamento' : ' lançamentos') + ').' : 'Não consegui desfazer. Ajuste na caderneta.';
    }
  };

  // ── FECHAR / REABRIR O MÊS por voz ("fecha setembro", "fecha o mês", "reabre setembro") — com confirmação ───────────────────────
  // Mesmo retrato do botão "Fechar mês" do app (o Worker usa o snapshot com teste de paridade contra o app.js). O livre de um mês fechado fica CONGELADO e vira o
  // ponto de partida do seguinte, por isso a confirmação repete os números e avisa das contas ainda sem marcar como paga. Só mês que já terminou; mês já fechado
  // não é refeito por aqui (atualizar o retrato é no app). "Desfaz" de um fechamento reabre; "desfaz" de uma reabertura fecha de novo.
  var _NOMES_MES_FM = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function _mesCurto(ym) { return (_MESES[Number(String(ym).slice(5, 7)) - 1] || ym); }
  function _mesAnterior(ym) { var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1; if (m < 1) { m = 12; a--; } return a + '-' + (m < 10 ? '0' : '') + m; }
  function _mesSeguinte(ym) { var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1; if (m > 12) { m = 1; a++; } return a + '-' + (m < 10 ? '0' : '') + m; }

  ACOES.fecharMes = {
    propor: function (msg) {
      var s = _norm(msg).replace(/[?]/g, '');
      var fechar = /\b(fech\w+|encerr\w+)\b/.test(s), reabrir = /\b(reabr\w+|reabert\w+)\b/.test(s);
      if (!fechar && !reabrir) return null;
      var mnum = null;
      for (var k = 0; k < 12; k++) if (new RegExp('\\b' + _NOMES_MES_FM[k] + '\\b').test(s)) mnum = k + 1;
      if (!mnum && !/\b(mes|mes passado|mes anterior)\b/.test(s)) return null;      // "fecha a porta" não é com a caderneta
      if (/\b(quanto|qual|quais|quando|como|onde)\b/.test(s)) return null;
      var r = resumo();
      if (!r.ok || !r.dados || !r.dados.mes) return null;
      var atual = r.dados.mes, ym;
      if (mnum) { var ano = Number(atual.slice(0, 4)); if (mnum > Number(atual.slice(5, 7))) ano--; ym = ano + '-' + (mnum < 10 ? '0' : '') + mnum; }
      else ym = _mesAnterior(atual);
      var nome = _mesCurto(ym);
      if (ym >= atual) return { resp: 'Só dá para mexer em mês que já terminou. ' + _mesCurto(atual).charAt(0).toUpperCase() + _mesCurto(atual).slice(1) + ' ainda está em curso.' };
      var rm = resumo(ym);
      if (!rm.ok || !rm.dados) return { resp: 'Não consegui consultar ' + nome + ' na caderneta agora.' };
      var d = rm.dados;
      if (d.inicio && ym < d.inicio) return { resp: 'A caderneta só começa em ' + _mesFalado(d.inicio) + ', então não há ' + nome + ' para mexer.' };
      var proximo = _mesCurto(_mesSeguinte(ym));
      var p = { tipo: 'fecharMes', acao: reabrir ? 'reabrir' : 'fechar', mes: ym, nome: nome, proximo: proximo, livreFim: d.livreFim };
      if (reabrir) {
        if (!d.fechado) return { resp: nome.charAt(0).toUpperCase() + nome.slice(1) + ' não está fechado.' };
        return { pend: p, resp: 'Reabro ' + nome + '? O livre que passa para ' + proximo + ' volta a ser calculado em vez de ficar congelado. Diga sim ou não.' };
      }
      if (d.fechado) return { resp: nome.charAt(0).toUpperCase() + nome.slice(1) + ' já está fechado. Para atualizar o retrato, use o app; para reabrir, diga reabre ' + nome + '.' };
      var abertas = (d.obrigacoes || []).filter(function (o) { return !o.pago && !o.outroPaga && Number(o.valor) > 0; });
      var aviso = abertas.length ? 'Atenção: ainda há ' + abertas.length + (abertas.length === 1 ? ' conta' : ' contas') + ' sem marcar como paga em ' + nome + ': ' +
                  abertas.slice(0, 3).map(function (o) { return o.nome; }).join(', ') + (abertas.length > 3 ? ' e mais ' + (abertas.length - 3) : '') + '. ' : '';
      return { pend: p, resp: aviso + 'Fecho ' + nome + '? Renda ' + _brl(d.receita) + ', saídas ' + _brl(d.saidas) + ', sobra de ' + (Number(d.sobra) < 0 ? 'menos ' : '') + _brl(d.sobra) +
        ', e o livre que passa para ' + proximo + ' é ' + (Number(d.livreFim) < 0 ? 'menos ' : '') + _brl(d.livreFim) + '. Isso congela os números de ' + nome + '. Diga sim ou não.' };
    },
    executar: function (p) {
      var x = _post('/api/jarvis/fechar-mes', { mes: p.mes, acao: p.acao });
      if (!x.ok) return { resp: 'Não consegui ' + (p.acao === 'fechar' ? 'fechar' : 'reabrir') + ' ' + p.nome + ' agora. Não mudei nada.' };
      if (!x.dados.mudou) return { resp: p.nome.charAt(0).toUpperCase() + p.nome.slice(1) + (p.acao === 'fechar' ? ' já estava fechado.' : ' já estava aberto.') };
      if (p.acao === 'fechar') {
        var livre = x.dados.livreFim != null ? x.dados.livreFim : p.livreFim;
        return { resp: 'Fechei ' + p.nome + '. O livre que passa para ' + p.proximo + ' é ' + (Number(livre) < 0 ? 'menos ' : '') + _brl(livre) + '. Para reabrir, diga desfaz.',
                 desfazer: { tipo: 'fecharMes', acao: 'reabrir', mes: p.mes, nome: p.nome } };
      }
      return { resp: 'Reabri ' + p.nome + '. Para fechar de novo, diga desfaz.', desfazer: { tipo: 'fecharMes', acao: 'fechar', mes: p.mes, nome: p.nome } };
    },
    desfazer: function (u) {
      var x = _post('/api/jarvis/fechar-mes', { mes: u.mes, acao: u.acao });
      return (x.ok && x.dados.mudou) ? (u.acao === 'reabrir' ? 'Desfeito: reabri ' + u.nome + '.' : 'Desfeito: fechei ' + u.nome + ' de novo.') : 'Não consegui desfazer. Ajuste no app.';
    }
  };

  var ORDEM_ACOES = ['recarga', 'receber', 'gasto', 'receita', 'pagar', 'fecharMes', 'aporte', 'aplicar', 'saldoInvest', 'consultor', 'meta'];

  var _SIM = /^(sim|isso|isso mesmo|confirmo|confirma|confirmado|pode|pode registrar|pode confirmar|pode gravar|esta certo|ta certo|certo|correto|exato|positivo|com certeza|claro)\b/;
  var _NAO = /^(nao|negativo|cancela|cancelar|cancelado|deixa|deixa pra la|esquece|errado|nao precisa|para|pare)\b/;
  var _FILLER = /^(ok|okay|beleza|entao|bom|ta bom|ta|e ai|eai|pois|bem|enfim|ah|hum|uhum)[,.\s]+/;

  /**
   * Ponto de entrada da voz. → {resp} se a frase era desta conversa (proposta, "sim", "não", "desfaz"), senão null.
   * Com proposta pendente, só "sim"/"não" são tratados; qualquer outra frase segue o fluxo normal (e a proposta expira).
   */
  function conversar(msg) {
    try {
      if (!configurado()) return null;
      var s = _norm(msg), tentativas = 0;
      while (tentativas++ < 3 && _FILLER.test(s)) s = s.replace(_FILLER, '');
      if (!s) return null;
      var pend = _cacheGet('fin_pendente');
      if (pend && pend.aguarda === 'meio') {
        // falta só a forma de pagamento: a próxima frase responde isso (ou cancela)
        if (_NAO.test(s)) { _cacheDel('fin_pendente'); return { resp: 'Certo, não registrei nada.' }; }
        // ele repetiu o gasto inteiro em vez de só dizer como pagou (a resposta do /exec se perde às vezes e o app tenta de novo):
        // refaz a proposta em vez de deixar a frase cair no modelo, que já inventou "registrei o gasto" (14/10).
        var refeito = interpretarGasto(msg);
        if (refeito && !refeito.erro) {
          var np = ACOES.gasto.propor(msg);
          if (np && np.pend) { _cachePut('fin_pendente', np.pend, PEND_S); return { resp: np.resp }; }
        }
        var mm = _meioDe(s);
        if (!mm) return null;
        pend.meio = mm.meio; pend.rotulo = mm.rotulo; pend.carteira = mm.carteira; pend.aguarda = null;
        _cachePut('fin_pendente', pend, PEND_S);
        return { resp: (pend.valor >= 500 ? 'Esse valor é alto. ' : '') + _fraseGasto(pend) };
      }
      if (pend) {
        if (_SIM.test(s)) {
          _cacheDel('fin_pendente');
          var acao = ACOES[pend.tipo];
          if (!acao) return null;
          var out = acao.executar(pend);
          if (out.desfazer) guardarDesfazer(out.desfazer);
          return { resp: out.resp };
        }
        if (_NAO.test(s)) { _cacheDel('fin_pendente'); return { resp: 'Certo, não registrei nada.' }; }
      }
      // Pix recebido esperando o sim (a notificação do banco perguntou "registro como receita extra?"). Só vale sem outra proposta aberta.
      var pe = pend ? null : _cacheGet('fin_pend_entrada');
      if (pe) {
        var catR = _categoriaReceita(s);
        if (_SIM.test(s) || (catR && !_NAO.test(s) && s.split(' ').length <= 4)) {
          _cacheDel('fin_pend_entrada');
          if (catR) pe.categoria = catR;
          var outR = ACOES.receita.executar(pe);
          if (outR.desfazer) guardarDesfazer(outR.desfazer);
          return { resp: outR.resp };
        }
        if (_NAO.test(s)) { _cacheDel('fin_pend_entrada'); return { resp: 'Certo, não registrei a receita.' }; }
      }
      // Gasto de banco sem parser exato (Itaú) esperando a forma de pagar ou o sim. Só vale sem outra proposta aberta.
      var pb = pend ? null : _cacheGet('fin_pend_banco');
      if (pb) {
        if (_NAO.test(s)) { _cacheDel('fin_pend_banco'); return { resp: 'Certo, não registrei esse gasto do Itaú.' }; }
        if (pb.aguarda === 'meio') {
          var mb = _meioDe(s);
          if (mb && mb.meio) { pb.meio = mb.meio; pb.rotulo = mb.rotulo; pb.aguarda = null; _cachePut('fin_pend_banco', pb, 900); return { resp: _fraseGasto(pb) }; }
        } else if (_SIM.test(s)) {
          _cacheDel('fin_pend_banco');
          var outB = ACOES.gasto.executar(pb);
          if (outB.desfazer) guardarDesfazer(outB.desfazer);
          return { resp: outB.resp };
        }
      }
      var ult = _ultimaAcao();
      if (/^(desfaz|desfazer|desfaca|volta atras|(cancela|apaga|tira|remove) (a recarga|o gasto|esse gasto|o ultimo gasto|a receita|o pagamento|a aplicacao))\b/.test(s)) {
        if (ult && ACOES[ult.tipo]) {
          // dentro de 10 min o desfaz é direto; depois, diz o que foi e há quanto tempo e pergunta antes
          if (Date.now() - ult.em <= DESFAZ_MIN * 60000) { _tirarDoLog(ult.em); return { resp: ACOES[ult.tipo].desfazer(ult) }; }
          _cachePut('fin_pendente', { tipo: 'desfazer_antigo', em: ult.em }, PEND_S);
          return { resp: 'A última ação foi ' + _quando(ult.em) + ': ' + (ult.desc || 'uma ação') + '. Desfaço? Diga sim ou não.' };
        }
        if (/recarga|gasto|receita|meta|pagamento|aplicacao/.test(s) || s.split(' ').length <= 2) return { resp: 'Não há nada para desfazer nos últimos ' + LOG_DIAS + ' dias. Ajuste direto na caderneta.' };
        return null;   // (um "desfaz" seco NÃO pode cair no modelo: em 14/10 ele respondeu "ação cancelada, não registrei nada" sem saber de que ação falava)
      }
      // "o que você registrou?" — as últimas ações, com a hora
      if (/\b(ultimas? acoes?|ultimos? (lancamentos?|registros?)|o que (voce )?(registrou|lancou|anotou|gravou))\b/.test(s) && !/\b(desfaz\w*|apag\w*)\b/.test(s)) {
        var rec = _logRecente().slice(-3).reverse();
        if (!rec.length) return { resp: 'Não registrei nada na caderneta nos últimos ' + LOG_DIAS + ' dias.' };
        return { resp: 'Das últimas ações: ' + rec.map(function (x) { return x.desc + ', ' + _quando(x.em); }).join('; ') + '.' };
      }
      var tipos = ORDEM_ACOES.filter(function (k) { return ACOES[k] && ACOES[k].propor; });
      for (var i = 0; i < tipos.length; i++) {
        var pr = ACOES[tipos[i]].propor(msg);
        if (!pr) continue;
        if (pr.pend) _cachePut('fin_pendente', pr.pend, PEND_S); else _cacheDel('fin_pendente');
        return { resp: pr.resp };
      }
      return null;
    } catch (e) {
      Logger.log('[Financas.conversar] ' + e.message);
      return null;
    }
  }

  return { configurado: configurado, resumo: resumo, falar: falar, interpretar: interpretar, responder: responder, AJUDA: AJUDA,
           avisos: avisos, verificarAvisos: verificarAvisos,
           registrarGastoSwile: registrarGastoSwile, desfazerGastoSwile: desfazerGastoSwile, falarSaldoSwile: falarSaldoSwile,
           interpretarRecarga: interpretarRecarga, conversar: conversar, registrarRecarga: registrarRecarga, desfazerRecarga: desfazerRecarga,
           interpretarGasto: interpretarGasto, categoriaDe: categoriaDe, registrarGasto: registrarGasto, desfazerGasto: desfazerGasto, guardarDesfazer: guardarDesfazer,
           _postBruto: _post, ehDoDono: ehDoDono, proporEntrada: proporEntrada, proporBancoGenerico: proporBancoGenerico, registrarReceita: registrarReceita, desfazerReceita: desfazerReceita };
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
