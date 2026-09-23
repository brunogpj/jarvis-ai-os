// ===================================================================================
// AlertasVoz.js — ALERTAS DE ÁUDIO agendados no celular (o Jarvis FALA no Android em
// horários definidos). Precisão de MINUTO via um tick dedicado (a cada 1 min) — separado
// do tick de 15 min da Agenda (que entrega no WhatsApp por hora). Armazena em Script Property
// (leve p/ ler a cada minuto). Cada alerta: {id, hora, minuto, dias[], texto, dinamico, ativo, ult}.
//  - texto fixo  → fala o texto literal.
//  - dinamico    → trata o texto como pedido e fala a RESPOSTA que o Jarvis gerar (ex.: "minha agenda de hoje").
// ===================================================================================

var AlertasVoz = (function () {
  'use strict';

  var KEY = 'ALERTAS_VOZ';
  var TICK = 'tickAlertasVoz';
  var TZ = 'America/Sao_Paulo';

  function _ler() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(KEY) || '[]'); } catch (e) { return []; } }
  function _salvar(arr) { PropertiesService.getScriptProperties().setProperty(KEY, JSON.stringify(arr || [])); }
  function _owner() { return PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'owner'; }

  // Garante o gatilho de 1 min (idempotente; respeita o limite de gatilhos).
  function _garantirTick() {
    try {
      var ts = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === TICK; });
      if (ts.length === 0) ScriptApp.newTrigger(TICK).timeBased().everyMinutes(1).create();
      else for (var i = 1; i < ts.length; i++) ScriptApp.deleteTrigger(ts[i]); // remove DUPLICADOS, mantém 1
    } catch (e) { Logger.log('[AlertasVoz] tick: ' + e.message); }
  }

  /** Cria um alerta. o:{hora 0-23, minuto 0-59, dias[0=Dom..6=Sáb] (vazio=todos), texto, dinamico?} */
  function criar(o) {
    o = o || {};
    var h = Number(o.hora);
    if (!isFinite(h) || h < 0 || h > 23) return { ok: false, erro: 'Informe a hora (0-23).' };
    var m = Number(o.minuto || 0); if (!isFinite(m) || m < 0 || m > 59) m = 0;
    var texto = String(o.texto || '').trim();
    if (!texto) return { ok: false, erro: 'Informe o texto do alerta.' };
    var dias = Array.isArray(o.dias) ? o.dias.map(Number).filter(function (x) { return x >= 0 && x <= 6; }) : [];
    /* TEXTO FIXO NAO PODE CONGELAR O TEMPO.
     * Tres alertas orfaos ja nasceram assim, todos criados pelo modelo: 'Que alegria te acordar
     * nesta quinta-feira, 27 de agosto' e 'Sao 06:00 da manha de uma...'. O modelo gera a
     * saudacao UMA vez, ela vira texto literal, e o alerta repete a data velha todo dia.
     * A correcao nao e proibir: e converter para dinamico, que e o que o dono queria de fato --
     * uma saudacao gerada na hora. So se aplica a texto FIXO; dinamico ja resolve isso sozinho.
     * Datas no texto de um alerta dinamico sao instrucao, nao conteudo, e ficam intactas. */
    var _dinamico = !!o.dinamico;
    if (!_dinamico) {
      var _sT = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var _temDiaSemana = /(segunda|terca|quarta|quinta|sexta|sabado|domingo)-?(feira)?/.test(_sT);
      var _temMes = /(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(_sT);
      var _temHoraEscrita = /[0-9]{1,2}[ ]*:[ ]*[0-9]{2}|[0-9]{1,2}[ ]*(horas|hora)([^a-z]|$)/.test(_sT);
      if (_temDiaSemana || _temMes || _temHoraEscrita) _dinamico = true;
    }

    /* TAG OBRIGATORIA, inferida quando nao vier.
     * A tag e o que permite tratar cada alerta pelo PAPEL: 'ponto' entra na pausa de ferias,
     * 'briefing' acompanha o turno, os demais ficam fixos. A tool do modelo nao expunha `tag`,
     * entao TODO alerta que ele criava nascia sem papel -- e escapava de toda limpeza, porque
     * as rotinas filtram por tag. Foi assim que os 4 pontos da manha sobreviveram a uma troca
     * de turno e o Bruno foi cobrado nos dois turnos ao mesmo tempo.
     * Inferir pelo texto e melhor que exigir do modelo: funciona mesmo quando ele esquece. */
    var _tag = o.tag ? String(o.tag) : '';
    /* 'briefing' É RESERVADO. É o papel do briefing que ACOMPANHA O TURNO: reposicionarBriefing
     * move TODO alerta com essa tag para 30 min antes do ponto, e a regra de colisão do tick o
     * suprime perto de outros briefings. Em 23/09 o modelo criou "às 9h me fala o tempo" com
     * tag briefing — na próxima troca de turno o alerta de clima pularia sozinho para 07:30.
     * Quem cria o briefing do turno é o próprio sistema; vindo de fora, a tag é reinferida. */
    if (_tag === 'briefing') _tag = '';
    if (!_tag) {
      var _sG = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/marcar (o )?ponto|ponto de (inicio|retorno|fim)|bater (o )?ponto/.test(_sG)) _tag = 'ponto';
      else if (/noticias|manchetes|briefing|panorama|resumo do dia|fechamento do dia/.test(_sG)) _tag = 'briefing_extra';
      else _tag = 'avulso';
    }

    /* NÃO DUPLICA. Em 23/09 um único pedido ("todo dia útil às 9h me fala o tempo") gerou DOIS
     * alertas idênticos — o modelo chamou a ferramenta duas vezes no mesmo turno. Cada um falaria
     * no mesmo minuto: a repetição que o dono já tinha pedido para eliminar. Mesmo horário, mesmos
     * dias e mesmo texto = o mesmo alerta; devolve o que já existe em vez de criar outro. */
    var arr = _ler();
    var _normT = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); };
    var _diasKey = dias.slice().sort().join(',');
    for (var _i = 0; _i < arr.length; _i++) {
      var _a = arr[_i];
      if (_a.ativo === false) continue;
      if (Number(_a.hora) === h && Number(_a.minuto || 0) === m &&
          (_a.dias || []).slice().sort().join(',') === _diasKey && _normT(_a.texto) === _normT(texto)) {
        return { ok: true, alerta: _a, duplicado: true,
                 info: 'Esse alerta já existia às ' + _hhmm(h, m) + ' — não criei outro igual.' };
      }
    }
    var item = { id: Utilities.getUuid().slice(0, 8), hora: h, minuto: m, dias: dias, texto: texto, dinamico: _dinamico, ativo: true, ult: '', tag: _tag };
    arr.push(item); _salvar(arr); _garantirTick();
    return { ok: true, alerta: item, info: 'Alerta de voz às ' + _hhmm(h, m) + (dias.length ? (' (' + dias.map(_nomeDia).join(',') + ')') : ' (todos os dias)') + ' criado.' };
  }

  function listar() { return _ler().filter(function (a) { return a.ativo !== false; }); }

  /** Edita um alerta pelo id. campos: {hora?, minuto?, dias?, texto?, dinamico?, ativo?}. */
  function editar(id, campos) {
    campos = campos || {};
    var arr = _ler(), achou = null;
    arr.forEach(function (a) {
      if (a.id !== id) return;
      if (campos.hora !== undefined && isFinite(Number(campos.hora))) a.hora = Math.max(0, Math.min(23, Number(campos.hora)));
      if (campos.minuto !== undefined && isFinite(Number(campos.minuto))) a.minuto = Math.max(0, Math.min(59, Number(campos.minuto)));
      if (Array.isArray(campos.dias)) a.dias = campos.dias.map(Number).filter(function (x) { return x >= 0 && x <= 6; });
      if (campos.texto !== undefined && String(campos.texto).trim()) a.texto = String(campos.texto).trim();
      if (campos.dinamico !== undefined) a.dinamico = !!campos.dinamico;
      if (campos.ativo !== undefined) a.ativo = !!campos.ativo;
      a.ult = ''; // reseta o dedup-do-dia (mudou de horário/estado)
      achou = a;
    });
    if (!achou) return { ok: false, erro: 'Alerta não encontrado.' };
    _salvar(arr); _garantirTick();
    return { ok: true, alerta: achou };
  }

  /** Dispara um alerta AGORA (prévia): fala o texto (ou gera, se dinâmico) no celular. */
  function testar(id) {
    var a = null, arr = _ler();
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { a = arr[i]; break; } }
    if (!a) return { ok: false, erro: 'Alerta não encontrado.' };
    var fala = a.texto;
    if (a.dinamico) { try { fala = String(Jarvis.ask(_owner(), a.texto, [], null, { interativo: false }) || a.texto); } catch (e) { fala = a.texto; } }
    try { if (typeof _prepararTextoFala === 'function') fala = _prepararTextoFala(fala); } catch (e) {}
    var r; try { r = Jarvis.controlarDispositivo({ acao: 'falar', texto: fala }); } catch (e) { return { ok: false, erro: e.message }; }
    return { ok: !!(r && r.status === 'success'), enviado: true };
  }

  function cancelar(idOuTrecho) {
    var alvo = String(idOuTrecho || '').toLowerCase().trim();
    if (!alvo) return { ok: false, erro: 'Informe o id ou um trecho do texto.' };
    var arr = _ler(), saiu = [];
    arr = arr.filter(function (a) {
      var casa = (a.id === idOuTrecho || String(a.texto || '').toLowerCase().indexOf(alvo) !== -1);
      if (casa) saiu.push({ id: a.id, hora: _hhmm(Number(a.hora), Number(a.minuto || 0)), texto: String(a.texto || '').substring(0, 60) });
      return !casa;
    });
    /* HONESTO SOBRE O QUE FEZ. Devolvia { ok: true } mesmo sem remover nada — e o modelo lia "ok" e
     * anunciava sucesso. Em 23/09 ele pediu para cancelar dois alertas, passou um id só, removeu UM
     * e respondeu "os alertas foram cancelados". Agora: nada removido = ok:false com o motivo; e a
     * lista exata do que saiu, para não dar margem a generalizar. */
    if (!saiu.length) return { ok: false, removidos: 0, erro: 'Nenhum alerta encontrado com "' + idOuTrecho + '". Nada foi cancelado.' };
    _salvar(arr);
    return { ok: true, removidos: saiu.length, cancelados: saiu };
  }

  // Handler do tick (1 min): dispara os alertas cujo HH:MM (e dia) batem agora.
  function tick() {
    /* O LOCK AQUI E CONVENIENCIA, NAO CORRETUDE -- e por isso NAO pode abortar o tick.
     * Era `if (!tryLock(1500)) return;`: o tick desistia calado quando o lock global estava
     * ocupado. Isso foi inofensivo por meses, ate 20/08, quando _governanca passou a pegar o
     * MESMO lock global para fechar a corrida do aviso de bateria. Com pingTelemetria a cada
     * 15 min, doPost e jobs concorrendo, o lock passou a viver ocupado e o tick simplesmente
     * parou de disparar alertas -- sem UMA linha de erro, porque desistir nao e falhar.
     * Em 15/09 nenhum alerta saiu o dia inteiro enquanto a pagina de execucoes mostrava
     * tickAlertasVoz 'Concluido' a cada minuto.
     * Agora espera mais e, se ainda assim nao conseguir, SEGUE. O que garante que o alerta nao
     * sai duas vezes e o dedup por dia (a.ult) mais a guarda atomica do CacheService la embaixo
     * -- os dois independem deste lock. */
    var lock = null;
    try { lock = LockService.getScriptLock(); if (!lock.tryLock(8000)) lock = null; } catch (eLk) { lock = null; }
    try {
      var agora = new Date();
      var h = Number(Utilities.formatDate(agora, TZ, 'H'));
      var m = Number(Utilities.formatDate(agora, TZ, 'm'));
      var dow = Number(Utilities.formatDate(agora, TZ, 'u')) % 7; // 1=Seg..7=Dom → %7: Dom=0..Sáb=6
      // JANELA DE TOLERÂNCIA em vez de minuto exato. O gatilho de 1 minuto do GAS não é
      // garantido: atrasa ou pula sob carga/cota. Com a comparação exata, UM tick perdido
      // matava o alerta para sempre — foi o que aconteceu com o ponto das 23:00 de 30/07,
      // que ficou com ult=29/07 mesmo sendo dia útil e estando ativo.
      // Agora o alerta dispara se o horário JÁ passou e ainda está dentro da janela, e o dedup
      // é por DIA (não por minuto) — então ele sai uma vez só, mesmo com vários ticks na janela.
      var TOLERANCIA_MIN = Number(PropertiesService.getScriptProperties().getProperty('ALERTA_TOLERANCIA_MIN') || 10);
      var dia = Utilities.formatDate(agora, TZ, 'yyyy-MM-dd');
      var minutosAgora = h * 60 + m;
      var arr = _ler(), mudou = false;
      // PAUSA DE PONTO (ferias, folga, atestado). Ate agora o unico jeito de calar os lembretes
      // era APAGAR os alertas — e ai voltar do periodo exigia recria-los na mao, ou lembrar de
      // redefinir o turno. Em 20/08 o Bruno estava de ferias desde 17/08 e continuou sendo
      // cobrado de manha E de tarde. A pausa tem DATA DE FIM: acaba sozinha, sem depender de
      // ele lembrar. Vale so para ponto — briefing e demais alertas seguem normais, porque
      // ferias nao e motivo para deixar de receber as noticias do dia.
      var _pausaAte = String(PropertiesService.getScriptProperties().getProperty('PONTO_PAUSA_ATE') || '');
      var _pontoPausado = !!_pausaAte && (dia <= _pausaAte);
      arr.forEach(function (a) {
        if (a.ativo === false) return;
        // Reconhece ponto pela tag OU pelo texto: o conjunto da manha de 20/08 tinha sido criado
        // pelo LLM sem tag nenhuma, e por isso escapava de toda limpeza que so olhava a tag.
        if (_pontoPausado && (a.tag === 'ponto' || /marcar (o )?ponto/i.test(String(a.texto || '')))) return;
        var alvo = Number(a.hora) * 60 + Number(a.minuto || 0);
        var atraso = minutosAgora - alvo;
        if (atraso < 0 || atraso > TOLERANCIA_MIN) return;   // ainda não deu a hora, ou passou demais
        if (a.dias && a.dias.length && a.dias.indexOf(dow) === -1) return;
        var carimbo = dia + 'T' + a.hora + ':' + (a.minuto || 0);   // uma vez por dia, por alerta
        if (a.ult === carimbo) return;
        /* COLISÃO DE BRIEFINGS. O 'briefing' (tag) ACOMPANHA O TURNO: com turno da tarde ele cai às
         * 13:30, antes do expediente — papel distinto, útil. Com turno da MANHÃ cai às 07:30 e
         * colide com o briefing_manha das 08:30: as mesmas manchetes duas vezes em uma hora.
         * Medido de 20 a 23/09, todos os dias. E o das 07:30 era o pior dos dois: sem limite de
         * tamanho, gerou o áudio de 8,8 MB e 199 s que quase bateu no teto do GAS.
         * Regra: havendo um briefing_manha ativo no MESMO dia a até 120 min, o do turno cede.
         * Na tarde não há colisão e ele segue normal — por isso é regra, não exclusão do alerta.
         * Marca o dia como resolvido para não reavaliar a cada tick da janela, e deixa rastro. */
        if (a.tag === 'briefing') {
          var _colide = arr.some(function (b) {
            // Qualquer briefing de horário FIXO (briefing_manha, _tarde, _noite, _extra) — não só
            // o da manhã. O incidente de 14/09 foi com um briefing_tarde.
            if (b === a || b.ativo === false || String(b.tag || '').indexOf('briefing_') !== 0) return false;
            if (b.dias && b.dias.length && b.dias.indexOf(dow) === -1) return false;
            return Math.abs((Number(b.hora) * 60 + Number(b.minuto || 0)) - alvo) <= 120;
          });
          if (_colide) {
            a.ult = carimbo; mudou = true;
            try {
              if (typeof Jarvis !== 'undefined' && Jarvis.registrarEvento) Jarvis.registrarEvento({
                tool: 'alertaVoz:suprimido', ok: true, ms: 0,
                resumo: 'briefing ' + _hhmm(Number(a.hora), Number(a.minuto || 0)) + ' cede a um briefing de horario fixo (mesmas noticias em menos de 2h)'
              });
            } catch (eSp) {}
            return;
          }
        }
        // GUARDA DE CORRIDA (CacheService, atômico entre execuções): impede dois ticks simultâneos
        // de falarem o mesmo alerta. TTL CURTO de propósito — 90s, não 30 min. Com 30 min, uma fala
        // que falhasse ficava bloqueada para o resto da janela de tolerância e o alerta simplesmente
        // não acontecia naquele dia. Quem garante "uma vez por dia" é o a.ult abaixo, e ele agora só
        // é gravado quando a fala DEU CERTO — então falha vira retentativa no minuto seguinte.
        /* GUARDA ATOMICA -- e a UNICA protecao contra fala dupla desde que o tick deixou de
         * abortar por lock (6338088). O TTL precisa cobrir a SINTESE INTEIRA, nao a media:
         * enquanto o alerta sintetiza, `a.ult` ainda nao foi gravado e o proximo tick ve tudo
         * livre. Com 90 s, o briefing de 15/09 21:05 (232 s de sintese) teve a guarda expirada
         * no meio do caminho e saiu DUAS vezes, com 77 s de intervalo.
         * 600 s cobre com folga o pior caso ja medido (248 s) e ainda cabe na janela de
         * tolerancia de 10 min -- passou disso, o alerta perdeu o horario de qualquer forma.
         * A guarda e escrita ANTES da fala de proposito: e o unico ponto em que a decisao de
         * falar fica visivel para outras execucoes antes de o trabalho lento comecar. */
        try { var _ck = CacheService.getScriptCache(), _ckk = 'av_' + a.id + '_' + carimbo; if (_ck.get(_ckk)) return; _ck.put(_ckk, '1', 600); } catch (eAv) {}
        var fala = a.texto;
        if (a.dinamico) {
          // Em alerta dinâmico o a.texto é a INSTRUÇÃO ("me dê as notícias do dia"), não a fala.
          // O fallback antigo era `fala = a.texto`: quando o Jarvis.ask falhava, o aparelho
          // recitava o próprio prompt em voz alta. Melhor admitir a falha do que ler a ordem.
          var gerado = '';
          try { gerado = String(Jarvis.ask(_owner(), a.texto, [], null, { interativo: false }) || ''); } catch (e) { gerado = ''; }
          var limpo = (typeof _prepararTextoFala === 'function') ? _prepararTextoFala(gerado) : gerado;
          fala = (limpo && limpo.length >= 15) ? limpo : 'Bruno, não consegui montar isso agora. Me pergunte daqui a pouco.';
        }
        try { if (typeof _prepararTextoFala === 'function') fala = _prepararTextoFala(fala); } catch (e) {}
        // O RESULTADO DA FALA IMPORTA. Antes era `try { falar } catch {}` seguido de `a.ult = carimbo`:
        // o alerta era marcado como feito mesmo se a fala explodisse, e ninguém nunca ficava sabendo —
        // nem o Bruno (que não ouviu), nem o log (que não registrava). Foi o buraco que impediu de
        // diagnosticar o ponto perdido das 19:00 de 12/08: o `ult` dizia "disparou", sem provar nada.
        var _t0 = Date.now(), _res = null, _erro = null;
        try { _res = Jarvis.controlarDispositivo({ acao: 'falar', texto: fala }); }
        catch (eF) { _erro = eF.message; }
        // 'dedupe' conta como sucesso: quer dizer que a MESMA fala acabou de sair por outro caminho.
        var _ok = !!(_res && (_res.status === 'success' || _res.via === 'dedupe'));
        if (!_ok && !_erro) _erro = (_res && (_res.erro || _res.status)) || 'sem resposta do dispositivo';
        a.ultResultado = { em: Utilities.formatDate(agora, TZ, 'yyyy-MM-dd HH:mm:ss'),
                           ok: _ok, erro: _ok ? null : String(_erro).substring(0, 140) };
        // Entra no MESMO log das ferramentas (agente_eventos). Sem isto, alerta falado era o único
        // caminho de fala invisível no sistema — dava para ver conversa e proativo, nunca alerta.
        try {
          if (Jarvis.registrarEvento) Jarvis.registrarEvento({
            tool: 'alertaVoz:' + (a.tag || (a.dinamico ? 'dinamico' : 'fixo')),
            ok: _ok, ms: Date.now() - _t0, userEmail: _owner(),
            spans: (_res && _res.spans) || null,   // onde o tempo foi: lock, espera, sintese, drive
            resumo: _ok ? fala : ('FALHOU: ' + _erro)
          });
        } catch (eEv) {}
        // SÓ marca o dia como resolvido se falou. Falhou → o próximo tick tenta de novo, dentro da
        // janela de tolerância. É a diferença entre perder o alerta do dia e atrasá-lo um minuto.
        // Quando falha, LIBERA a guarda do cache junto: sem isso o alerta ficaria bloqueado pelos
        // 10 min do TTL e a retentativa que este bloco promete nunca aconteceria.
        if (_ok) a.ult = carimbo;
        else { try { CacheService.getScriptCache().remove(_ckk); } catch (eRm) {} }
        mudou = true;
      });
      if (mudou) _salvar(arr);
      // Auto-limpeza: sem alertas ativos → remove o gatilho de 1 min (criar() recria quando precisar).
      if (!arr.some(function (a) { return a.ativo !== false; })) {
        try { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === TICK) ScriptApp.deleteTrigger(t); }); } catch (e) {}
      }
    } finally { if (lock) { try { lock.releaseLock(); } catch (eRl) {} } }   // lock pode ser null: o tick segue sem ele
  }

  function _hhmm(h, m) { return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m); }
  function _nomeDia(d) { return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d] || d; }

  // ── TURNO DE TRABALHO (ponto) ────────────────────────────────────────────────
  // "Jarvis, essa semana vou trabalhar no turno da manhã/tarde" → reconfigura os 4
  // alertas falados de ponto (Seg–Sex) num comando só. Alertas de ponto levam tag:'ponto'
  // (e, por compatibilidade, alertas antigos são reconhecidos pelo texto "marcar o ponto").
  var _TURNOS = {
    manha: {
      nome: 'da manhã',
      pontos: [[8, 0, 'início da jornada de trabalho'], [12, 0, 'início do intervalo de almoço'],
               [13, 0, 'retorno do intervalo de almoço'], [16, 45, 'fim da jornada de trabalho']]
    },
    tarde: {
      nome: 'da tarde',
      pontos: [[14, 0, 'início da jornada de trabalho'], [19, 0, 'início do intervalo de janta'],
               [20, 0, 'retorno do intervalo de janta'], [23, 0, 'fim da jornada de trabalho']]
    }
  };

  /** Interpreta o turno a partir de texto livre ("turno da manhã", "vespertino"...). PURA (testável). */
  function interpretarTurno(texto) {
    var t = String(texto || '').toLowerCase();
    if (/tarde|vespertin|noturn|noite/.test(t)) return 'tarde';
    if (/manh|matutin|cedo/.test(t)) return 'manha';
    return null;
  }

  /** Define o turno da semana: remove os alertas de ponto atuais e cria os 4 do turno (Seg–Sex). */
  function definirTurno(turno) {
    var t = _TURNOS[turno] ? turno : interpretarTurno(turno);
    if (!t || !_TURNOS[t]) return { ok: false, erro: 'Turno não reconhecido. Diga "turno da manhã" ou "turno da tarde".' };
    var def = _TURNOS[t];
    var arr = _ler().filter(function (a) { return a.tag !== 'ponto' && !/marcar (o )?ponto/i.test(String(a.texto || '')); });
    def.pontos.forEach(function (p) {
      arr.push({ id: Utilities.getUuid().slice(0, 8), hora: p[0], minuto: p[1], dias: [1, 2, 3, 4, 5],
                 texto: 'Bruno, lembre-se de marcar o ponto de ' + p[2] + '.', dinamico: false, ativo: true, ult: '', tag: 'ponto' });
    });
    _salvar(arr); _garantirTick();
    var horarios = def.pontos.map(function (p) { return _hhmm(p[0], p[1]); }).join(', ');
    try { PropertiesService.getScriptProperties().setProperty('TURNO_TRABALHO_ATUAL', t); } catch (e) {}
    // O briefing ACOMPANHA o turno: sempre X min antes do ponto de entrada (nunca mais fixo às 08:20).
    // UMA chamada só. Havia duas aqui, com `var _brf` declarado duas vezes -- resquício de edição
    // antiga que passou despercebido enquanto era inofensivo. Deixou de ser quando a anti-colisão
    // entrou: a segunda passada via o horário já ocupado pelo briefing que a PRIMEIRA acabou de
    // mover, e o deslocava mais 15 min. Duas trocas de turno seguidas empurravam o briefing meia
    // hora para frente sem ninguém pedir.
    var _brf = null;
    try { _brf = reposicionarBriefing(t); } catch (eB) { Logger.log('[Briefing] ' + eB.message); }
    // Memória de longo prazo: registra a decisão na wiki (o Jarvis "aprende" a rotina do dono).
    try {
      if (typeof WikiMemoryService !== 'undefined' && WikiMemoryService.registrarNoLog) {
        WikiMemoryService.registrarNoLog('Bruno definiu por comando o turno de trabalho ' + def.nome.toUpperCase() +
          ' para esta semana. Alertas de ponto (Seg–Sex) reconfigurados para: ' + horarios + '.');
      }
    } catch (e) {}
    return { ok: true, turno: t, briefing: _brf,
      resumo: 'Entendido, Bruno! Turno ' + def.nome + ' ativado. Vou te lembrar do ponto de segunda a sexta às ' + horarios + '.' +
              (_brf && _brf.ok ? ' Seu briefing também mudou para as ' + _brf.briefing + ', ' + _brf.antecedenciaMin + ' minutos antes do ponto.' : '') };
  }

  /**
   * BRIEFING ATRELADO AO TURNO. O briefing (alerta dinâmico) vivia num horário FIXO (08:20), o que
   * ficava errado — e até depois do ponto — quando o turno virava tarde. Agora ele é reposicionado
   * para X minutos ANTES do ponto de ENTRADA do turno vigente (X = BRIEFING_ANTECEDENCIA_MIN, 30).
   * NÃO mexe no texto nem nos dias do alerta (é o briefing que o dono escreveu) — só na hora.
   * @return {Object} {ok, turno, hora, movidos:[...]}
   */
  function reposicionarBriefing(turno) {
    var t = _TURNOS[turno] ? turno : (interpretarTurno(turno) || turnoAtual());
    if (!t || !_TURNOS[t]) return { ok: false, erro: 'Turno não definido — rode definirTurno primeiro.' };
    var entrada = _TURNOS[t].pontos[0];                        // [hora, minuto, rótulo] = ponto de ENTRADA
    var ante = Number(PropertiesService.getScriptProperties().getProperty('BRIEFING_ANTECEDENCIA_MIN') || 30);
    var tot = entrada[0] * 60 + entrada[1] - ante;
    if (tot < 0) tot += 24 * 60;                               // antecedência que cruza a meia-noite
    var h = Math.floor(tot / 60), m = tot % 60;
    var arr = _ler(), movidos = [];
    arr.forEach(function (a) {
      // SO o briefing atrelado ao turno se move. Antes o filtro pegava QUALQUER alerta
      // dinamico -- com tres briefings no dia (manha, tarde, noite) os tres seriam
      // arrastados para o mesmo horario na primeira troca de turno. Os de horario fixo
      // usam tag briefing_manha / briefing_noite e ficam onde estao.
      if (a.tag === 'briefing') {
        // ANTI-COLISAO: o briefing do turno segue o ponto de entrada, e o destino pode ja estar
        // ocupado por um briefing de horario fixo. Em 14/09 o turno virou TARDE, este alerta foi
        // para 13:30 e caiu em cima do briefing_tarde -- dois briefings completos em 43 segundos,
        // com conteudo quase igual. Desloca 15 min quando o horario ja tem outro briefing.
        var _ocupado = arr.some(function (o) {
          return o.id !== a.id && o.ativo !== false &&
                 Number(o.hora) === h && Number(o.minuto || 0) === m &&
                 String(o.tag || '').indexOf('briefing') === 0;
        });
        if (_ocupado) { m = m + 15; if (m >= 60) { m -= 60; h = (h + 1) % 24; } }
        a.hora = h; a.minuto = m; a.tag = 'briefing';          // marca p/ achar com precisão depois
        movidos.push({ id: a.id, hora: _hhmm(h, m), texto: String(a.texto || '').substring(0, 60), deslocado: _ocupado });
      }
    });
    if (!movidos.length) return { ok: false, erro: 'Nenhum alerta dinâmico/briefing encontrado para mover.', turno: t };
    _salvar(arr); _garantirTick();
    // `briefing` e `entrada` são os nomes que definirTurno LÊ ("seu briefing mudou para as X");
    // `hora` e `entradaPonto` ficam por compatibilidade. Havia uma SEGUNDA cópia desta função
    // logo abaixo, mais antiga e sem o anti-colisão — em JS a última declaração vence, então
    // o anti-colisão escrito depois do incidente de 14/09 NUNCA rodou. Removida em 23/09.
    return { ok: true, turno: t, entrada: _hhmm(entrada[0], entrada[1]), entradaPonto: _hhmm(entrada[0], entrada[1]),
             antecedenciaMin: ante, briefing: _hhmm(h, m), hora: _hhmm(h, m), movidos: movidos };
  }


  /** Turno vigente ('manha'|'tarde'|null) — lido da property gravada em definirTurno. */
  function turnoAtual() {
    try { return PropertiesService.getScriptProperties().getProperty('TURNO_TRABALHO_ATUAL') || null; } catch (e) { return null; }
  }

  return { criar: criar, listar: listar, editar: editar, testar: testar, cancelar: cancelar, tick: tick,
           reposicionarBriefing: reposicionarBriefing,
           definirTurno: definirTurno, interpretarTurno: interpretarTurno, turnoAtual: turnoAtual };
})();

/** Handler do gatilho temporal de 1 min (alertas de voz no celular). NÃO renomear. */
function tickAlertasVoz() {
  try { if (typeof Heartbeat !== 'undefined') Heartbeat.bater('alertasVoz'); } catch (e) {}
  try { AlertasVoz.tick(); } catch (e) { Logger.log('[tickAlertasVoz] ' + e.message); }
}
