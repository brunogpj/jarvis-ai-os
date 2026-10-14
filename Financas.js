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
  function guardarDesfazer(u) { _cachePut('fin_ultima_acao', u, DESFAZ_MIN * 60); }

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
        via = 'vz';
        r = registrarGasto({ origem: 'vz', chave: p.id, data: data, valor: p.valor, meio: p.meio, categoria: p.categoria, descricao: p.descricao });
      }
      if (!r.ok) return { resp: 'Não consegui registrar o gasto agora. Não gravei nada; tente de novo daqui a pouco.' };
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
          if (out.desfazer) _cachePut('fin_ultima_acao', out.desfazer, DESFAZ_MIN * 60);
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
          if (outR.desfazer) _cachePut('fin_ultima_acao', outR.desfazer, DESFAZ_MIN * 60);
          return { resp: outR.resp };
        }
        if (_NAO.test(s)) { _cacheDel('fin_pend_entrada'); return { resp: 'Certo, não registrei a receita.' }; }
      }
      var ult = _cacheGet('fin_ultima_acao');
      if (/^(desfaz|desfazer|desfaca|volta atras|(cancela|apaga|tira|remove) (a recarga|o gasto|esse gasto|o ultimo gasto|a receita))\b/.test(s)) {
        if (ult && ACOES[ult.tipo]) { _cacheDel('fin_ultima_acao'); return { resp: ACOES[ult.tipo].desfazer(ult) }; }
        if (/recarga|gasto/.test(s)) return { resp: 'Não há nada recente para desfazer. Passou dos ' + DESFAZ_MIN + ' minutos, ajuste na caderneta.' };
        return null;
      }
      var tipos = Object.keys(ACOES);
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
           ehDoDono: ehDoDono, proporEntrada: proporEntrada, registrarReceita: registrarReceita, desfazerReceita: desfazerReceita };
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
