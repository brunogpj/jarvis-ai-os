// ===================================================================================
// Briefing.js — briefings falados montados a partir de DADOS REAIS, não da memória do modelo.
// ===================================================================================
// POR QUÊ EXISTE. Até 28/09 o briefing era um `Jarvis.ask(prompt)`: o modelo decidia sozinho
// se ia consultar agenda, tarefas e notícias. O prompt dizia "use as ferramentas" e "nunca
// invente" — e mesmo assim o briefing_noite de 25/09 e o de 28/09 saíram SEM NENHUMA chamada
// de ferramenta, com o MESMO texto palavra por palavra ("debates intensos sobre a reforma
// tributária..."), e com compromissos que não existiam. O de 26/09 pesquisou notícias mas não
// olhou a agenda de amanhã, que ele mesmo anunciou. Instrução no prompt não é garantia.
//
// COMO FICOU. Quem busca é o código, sempre:
//   1. intencoes()  — lê o texto do alerta e decide o que buscar (agenda, tarefas, notícias,
//                     tempo, versículo). Pura.
//   2. coletar()    — CalendarApp, Google Tasks, pesquisa web com grounding e bible-api.
//                     Cada fonte falha sozinha e deixa rastro; nada é "preenchido" pelo modelo.
//   3. A AGENDA e as TAREFAS viram frase no próprio código (fraseAgenda/fraseTarefas): o modelo
//      nunca escreve sobre compromisso do dono. O VERSÍCULO é lido como veio da API.
//   4. O modelo só REDIGE as notícias/tempo a partir do texto da pesquisa, sem ferramentas, e
//      qualquer frase dele que fale de "sua agenda / você tem / suas tarefas" é cortada
//      (removerFrasesPessoais) — segunda trava, caso ele desobedeça.
// ===================================================================================

var Briefing = (function () {
  'use strict';
  var TZ = 'America/Sao_Paulo';

  function _norm(s) {
    var t = String(s || '');
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return t.toLowerCase();
  }

  /** O que o texto do alerta pede. PURA (testável). */
  function intencoes(texto) {
    // O bloco "REGRAS:" dos alertas cita agenda, tarefas e notícias como EXEMPLO ("use as
    // ferramentas para buscar os dados reais (agenda, tarefas, noticias)"). Lido junto, faria o
    // briefing da noite — que não pede tarefas — ler a lista de tarefas. Só o pedido conta.
    texto = String(texto || '').split(/\bREGRAS\s*:/i)[0];
    var t = _norm(texto);
    var cidade = 'Belo Horizonte';
    var mC = String(texto || '').match(/tempo (?:para|em|de) ([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú]?[\wÀ-ú]+){0,3})/);
    if (mC) cidade = mC[1].replace(/[.,;:].*$/, '').trim();
    // "e-mails não" / "resuma meus e-mails não" é recusa, não pedido.
    var emails = /e-?mails?/.test(t) && !/e-?mails?\s*,?\s*n[aã]o\b/.test(t) && !/n[aã]o\s+(me\s+)?(resuma|fale|leia)\s+(os\s+|meus\s+)?e-?mails?/.test(t);
    return {
      agenda:   /agenda|compromiss|reuni|evento/.test(t),
      periodo:  /(agenda|compromiss|evento|reuni)[^.]{0,40}amanha|amanha[^.]{0,40}(agenda|compromiss|evento|reuni)/.test(t) ? 'amanha' : 'hoje',
      tarefas:  /tarefa/.test(t),
      noticias: /noticia|manchete|aconteceu|no brasil e no mundo|do mundo/.test(t),
      tempo:    /previsao do tempo|clima|temperatura/.test(t),
      cidade:   cidade,
      biblia:   /bibli|versicul|salmo|reflexao/.test(t),
      emails:   emails
    };
  }

  function _hora(d) {
    var h = Number(Utilities.formatDate(d, TZ, 'H')), m = Number(Utilities.formatDate(d, TZ, 'm'));
    return h + 'h' + (m ? (m < 10 ? '0' + m : String(m)) : '');
  }

  function _juntar(itens) {
    if (itens.length <= 1) return itens.join('');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }

  /**
   * Frase da agenda a partir dos eventos REAIS. PURA quando `formatarHora` é injetado (testes).
   * eventos: [{titulo, inicio:Date, diaInteiro:boolean}] · periodo: 'hoje' | 'amanha' · erro: string|null
   */
  function fraseAgenda(eventos, periodo, erro, formatarHora) {
    var quando = periodo === 'amanha' ? 'amanhã' : 'hoje';
    if (erro) return 'Não consegui consultar sua agenda de ' + quando + ' agora.';
    var ev = (eventos || []).filter(function (e) { return e && e.titulo; });
    if (!ev.length) return periodo === 'amanha' ? 'Para amanhã, não há nada marcado na sua agenda.' : 'Sua agenda de hoje está livre.';
    var fh = formatarHora || _hora;
    var itens = ev.slice(0, 6).map(function (e) {
      return e.diaInteiro ? (e.titulo + ', o dia todo') : (e.titulo + ' às ' + fh(e.inicio));
    });
    var extra = ev.length > 6 ? ' Tem mais ' + (ev.length - 6) + ' depois disso.' : '';
    return 'Na sua agenda de ' + quando + ': ' + _juntar(itens) + '.' + extra;
  }

  /** Frase das tarefas pendentes a partir do Google Tasks. PURA. hojeISO = 'yyyy-MM-dd'. */
  function fraseTarefas(tarefas, hojeISO, erro) {
    if (erro) return 'Não consegui consultar suas tarefas agora.';
    var pend = (tarefas || []).filter(function (t) { return t && t.titulo && t.status !== 'completed'; });
    if (!pend.length) return 'Você não tem tarefas pendentes.';
    var vencendo = pend.filter(function (t) { return t.vencimento && String(t.vencimento).slice(0, 10) <= hojeISO; });
    var n = pend.length;
    var base = n === 1 ? 'Você tem uma tarefa pendente' : ('Você tem ' + n + ' tarefas pendentes');
    if (vencendo.length) {
      return base + '. Para hoje ou atrasadas: ' + _juntar(vencendo.slice(0, 3).map(function (t) { return t.titulo; })) + '.';
    }
    return base + ': ' + _juntar(pend.slice(0, 3).map(function (t) { return t.titulo; })) + (n > 3 ? ', entre outras.' : '.');
  }

  /* Frases em que o modelo fala da vida do dono (agenda, compromisso, tarefa). Ele só recebe
   * notícias e tempo; se ainda assim escrever isso, é invenção. Estreito de propósito: "reunião
   * do G20" é notícia e fica; "você tem uma reunião" sai. */
  var _RE_PESSOAL = /\b(voc[eê] tem|sua agenda|seus? compromissos?|sua reuni[aã]o|suas reuni[oõ]es|suas tarefas|sua lista de tarefas|tarefas? pendentes?|est[aá] marcad[oa] para (voc[eê]|amanh[aã]|hoje))\b/i;

  /* O modelo cumprimenta mesmo mandado não cumprimentar: no ensaio de 28/09 saiu "Boa noite,
   * Bruno. Bruno, boa noite." (a saudação do código + a dele). Tira a dele do começo. PURA. */
  function tirarSaudacao(texto) {
    return String(texto || '')
      .replace(/^\s*((ol[aá]|oi|e a[ií])\s*,?\s*)?(bruno\s*,?\s*)?(bom dia|boa tarde|boa noite)(\s*,?\s*bruno)?\s*[.!,]?\s*/i, '')
      .replace(/^\s*(ol[aá]|oi),?\s*bruno\s*[.!,]?\s*/i, '')
      .trim();
  }

  /* VERSÍCULO PARA REFLEXÃO. O sorteio da bible-api pega qualquer versículo da Bíblia, e fora de
   * contexto a maioria não faz sentido como fechamento do dia — no ensaio de 28/09 saiu Jó 13:11
   * ("Não vos amedrontará a sua majestade?"). Lista curta de versículos que se sustentam sozinhos,
   * sorteada a cada briefing. Referências no formato que o _interpretarBiblia entende. */
  var VERSICULOS_REFLEXAO = ['Salmos 23:1', 'Salmos 27:1', 'Salmos 34:18', 'Salmos 37:5', 'Salmos 46:1',
    'Salmos 55:22', 'Salmos 90:12', 'Salmos 118:24', 'Salmos 121:2', 'Salmos 139:14', 'Salmos 30:5',
    'Proverbios 3:5', 'Proverbios 16:3', 'Proverbios 17:22', 'Eclesiastes 3:1', 'Isaias 26:3', 'Isaias 40:31',
    'Isaias 41:10', 'Jeremias 29:11', 'Lamentacoes 3:22', 'Josue 1:9', 'Miqueias 6:8', 'Mateus 5:9',
    'Mateus 6:34', 'Mateus 11:28', 'Joao 14:27', 'Joao 16:33', 'Romanos 8:28', 'Romanos 12:12',
    '1 Corintios 13:4', '2 Corintios 12:9', 'Galatas 6:9', 'Efesios 4:32', 'Filipenses 4:6', 'Filipenses 4:13',
    'Colossenses 3:23', '1 Tessalonicenses 5:18', 'Tiago 1:5', '1 Pedro 5:7', '1 Joao 4:18'];

  /** Remove frases que falam da agenda/tarefas do dono. PURA. */
  function removerFrasesPessoais(texto) {
    var s = String(texto || '').trim();
    if (!s) return '';
    var frases = s.split(/(?<=[.!?])\s+/);
    return frases.filter(function (f) { return !_RE_PESSOAL.test(f); }).join(' ').trim();
  }

  function _saudacao(agora) {
    var h = Number(Utilities.formatDate(agora, TZ, 'H'));
    return h < 12 ? 'Bom dia, Bruno.' : (h < 18 ? 'Boa tarde, Bruno.' : 'Boa noite, Bruno.');
  }

  function _dataExtenso(d) {
    var meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return Number(Utilities.formatDate(d, TZ, 'd')) + ' de ' + meses[Number(Utilities.formatDate(d, TZ, 'M')) - 1] + ' de ' + Utilities.formatDate(d, TZ, 'yyyy');
  }

  function _janela(periodo, agora) {
    var dia = Utilities.formatDate(agora, TZ, 'yyyy-MM-dd');
    var ini = new Date(dia + 'T00:00:00-03:00');   // Brasil sem horário de verão desde 2019
    if (periodo === 'amanha') ini = new Date(ini.getTime() + 86400000);
    var fim = new Date(ini.getTime() + 86400000);
    if (periodo !== 'amanha') ini = agora;          // hoje: só o que ainda vem pela frente
    return { ini: ini, fim: fim };
  }

  /** Busca os dados reais. Cada fonte isolada: uma falha não derruba as outras. */
  function coletar(it, agora) {
    agora = agora || new Date();
    var f = { agenda: null, agendaErro: null, tarefas: null, tarefasErro: null,
              locais: null, locaisFontes: [], locaisErro: null, regiao: '',
              noticias: null, noticiasFontes: [], noticiasErro: null,
              tempo: null, tempoErro: null, versiculo: null, versiculoErro: null };
    if (it.agenda) {
      try {
        var j = _janela(it.periodo, agora);
        f.agenda = CalendarApp.getDefaultCalendar().getEvents(j.ini, j.fim).map(function (e) {
          return { titulo: e.getTitle(), inicio: e.getStartTime(), diaInteiro: e.isAllDayEvent() };
        });
      } catch (e) { f.agendaErro = e.message; }
    }
    if (it.tarefas) {
      try { f.tarefas = Tarefas.listar({}); } catch (e) { f.tarefasErro = e.message; }
    }
    var data = _dataExtenso(agora);
    /* NOTÍCIAS LOCAIS (pedido do Bruno, 28/09): os briefings traziam só Brasil e mundo, e o que está
     * em pauta na região dele é o que mais importa no dia a dia. Pesquisa SEPARADA — numa pesquisa
     * única, o nacional domina e o local some. Região em BRIEFING_REGIAO (Script Property); o padrão
     * cobre onde ele mora e trabalha. BRIEFING_NOTICIAS_LOCAIS=nao desliga. */
    var _pr = PropertiesService.getScriptProperties();
    var regiao = String(_pr.getProperty('BRIEFING_REGIAO') || 'Belo Horizonte, a região metropolitana (Contagem, Betim e arredores) e Minas Gerais');
    f.regiao = regiao;
    if (it.noticias && String(_pr.getProperty('BRIEFING_NOTICIAS_LOCAIS') || 'sim').toLowerCase() !== 'nao') {
      try {
        var rl = Gemini.pesquisarWeb('Quais são as notícias locais mais importantes e mais atuais de hoje, ' + data + ', em ' + regiao +
          '? Priorize o que está em pauta na região: trânsito e transporte, segurança, saúde, obras, clima e chuvas, serviços públicos, ' +
          'decisões da prefeitura e do governo do estado e acontecimentos que afetam quem mora lá. Traga de 3 a 5 fatos concretos, cada um em uma frase, ' +
          'dizendo a cidade de cada um. Não inclua notícias nacionais nem de dias anteriores.');
        f.locais = String((rl && rl.texto) || '').trim() || null;
        f.locaisFontes = (rl && rl.fontes) || [];
        if (!f.locais) f.locaisErro = 'pesquisa sem resultado';
      } catch (e) { f.locaisErro = e.message; }
    }
    if (it.noticias) {
      try {
        var r = Gemini.pesquisarWeb('Quais são as principais notícias do Brasil e do mundo publicadas hoje, ' + data +
          '? Traga de 4 a 6 fatos concretos e recentes, cada um em uma frase, com o nome das pessoas e lugares envolvidos. Não inclua fatos de dias anteriores.');
        f.noticias = String((r && r.texto) || '').trim() || null;
        f.noticiasFontes = (r && r.fontes) || [];
        if (!f.noticias) f.noticiasErro = 'pesquisa sem resultado';
      } catch (e) { f.noticiasErro = e.message; }
    }
    if (it.tempo) {
      try {
        var rt = Gemini.pesquisarWeb('Previsão do tempo para ' + it.cidade + ' hoje, ' + data + ': temperatura mínima e máxima e chance de chuva. Responda em uma frase.');
        f.tempo = String((rt && rt.texto) || '').trim() || null;
        if (!f.tempo) f.tempoErro = 'pesquisa sem resultado';
      } catch (e) { f.tempoErro = e.message; }
    }
    if (it.biblia) {
      try {
        var refV = VERSICULOS_REFLEXAO[Math.floor(Math.random() * VERSICULOS_REFLEXAO.length)];
        var b = (typeof lerBiblia === 'function') ? lerBiblia({ referencia: refV }) : { ok: false, erro: 'lerBiblia indisponível' };
        // Referência da lista falhou na API → sorteio da bible-api, como antes (melhor que nada).
        if (!(b && b.ok) && typeof lerBiblia === 'function') b = lerBiblia({ aleatorio: true });
        if (b && b.ok && b.texto) f.versiculo = { ref: b.ref, texto: b.texto };
        else f.versiculoErro = (b && b.erro) || 'sem versículo';
      } catch (e) { f.versiculoErro = e.message; }
    }
    return f;
  }

  /** O modelo só redige notícias e tempo a partir do texto da pesquisa. Sem ferramentas. */
  function _redigir(pedido, f, agora, maxPalavras) {
    var blocos = [];
    if (f.locais) blocos.push('[NOTÍCIAS LOCAIS — ' + (f.regiao || 'região do Bruno') + ', pesquisa de hoje]\n' + f.locais);
    if (f.noticias) blocos.push('[NOTÍCIAS DO BRASIL E DO MUNDO — pesquisa de hoje]\n' + f.noticias);
    if (f.tempo) blocos.push('[TEMPO]\n' + f.tempo);
    if (!blocos.length) return '';
    var sys = 'Você é o Jarvis, assistente pessoal do Bruno, e escreve um texto para ser FALADO em voz alta pelo celular. ' +
      'Tom caloroso e tranquilo, como alguém próximo contando as novidades: frases curtas, linguagem simples, sem listas, sem títulos, sem markdown, sem emojis. ' +
      'Use SOMENTE as informações do bloco de fatos; não acrescente nenhum fato, número, nome ou data que não esteja lá. Se um fato estiver vago, deixe-o de fora. ' +
      'Se houver notícias locais, COMECE por elas (é a região onde o Bruno mora e trabalha, e é o que mais o afeta), dizendo a cidade de cada fato; depois passe para Brasil e mundo com uma transição natural. ' +
      'Não fale de agenda, compromissos, reuniões, tarefas ou e-mails do Bruno: isso é tratado à parte. ' +
      'Não cumprimente e não se despeça (a saudação é colocada à parte). Não comece com "Com certeza" nem repita o pedido.';
    var user = 'Pedido original do Bruno (só para o tom e o foco): "' + String(pedido || '').slice(0, 500) + '"\n\n' +
      blocos.join('\n\n') + '\n\nEscreva o texto falado em até ' + maxPalavras + ' palavras.';
    // _thinking 'low': é só redação. Sem o hint o 2.5-flash pensa à vontade e o raciocínio COME o
    // maxOutputTokens — no ensaio de 28/09 o texto saiu com 28 palavras, cortado no meio da frase,
    // e a previsão do tempo nem entrou. Teto folgado pelo mesmo motivo (Gemini 3 ainda pensa um pouco).
    var r = Gemini.gerar({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      _thinking: 'low'
    });
    var cand = r && r.json && r.json.candidates && r.json.candidates[0];
    var txt = (cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '').trim();
    // Ainda assim cortado → fica até a última frase completa. Frase pela metade soa como defeito.
    if (cand && cand.finishReason === 'MAX_TOKENS') txt = txt.replace(/[^.!?]*$/, '').trim();
    return txt;
  }

  /** Junta as partes na ordem de leitura. PURA. */
  function montar(p) {
    return [p.saudacao, p.corpo, p.agenda, p.tarefas, p.aviso, p.versiculo]
      .filter(function (x) { return x && String(x).trim(); }).join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Gera o texto do briefing de um alerta dinâmico. Nunca lança: devolve {texto, rastro}.
   * rastro diz de onde veio cada parte — vai para o evento, para ver depois o que foi consultado.
   */
  function gerar(alerta) {
    var agora = new Date();
    var pedido = String((alerta && alerta.texto) || '');
    var it = intencoes(pedido);
    var t0 = Date.now();
    var f = coletar(it, agora);
    var msColeta = Date.now() - t0;
    var corpo = '', erroRedacao = null;
    // "no máximo dois minutos" ≈ 260 palavras no total; o resto é agenda, tarefas e versículo.
    // Com as notícias locais o bloco cresce um pouco (2 min ≈ 260 palavras no total).
    var maxPalavras = /dois minutos|2 minutos/.test(_norm(pedido)) ? 200 : 260;
    var t1 = Date.now();
    try { corpo = removerFrasesPessoais(tirarSaudacao(_redigir(pedido, f, agora, maxPalavras))); } catch (e) { erroRedacao = e.message; }
    var msRedacao = Date.now() - t1;
    var aviso = '';
    if (it.noticias && !f.noticias && !f.locais) aviso = 'Não consegui buscar as notícias agora.';
    else if (it.noticias && !corpo) aviso = 'As notícias chegaram, mas não consegui organizá-las a tempo.';
    var hojeISO = Utilities.formatDate(agora, TZ, 'yyyy-MM-dd');
    var partes = {
      saudacao: _saudacao(agora),
      corpo: corpo,
      agenda: it.agenda ? fraseAgenda(f.agenda, it.periodo, f.agendaErro) : '',
      tarefas: it.tarefas ? fraseTarefas(f.tarefas, hojeISO, f.tarefasErro) : '',
      aviso: aviso,
      versiculo: (it.biblia && f.versiculo) ? ('Para encerrar, ' + f.versiculo.ref + ': ' + f.versiculo.texto) : ''
    };
    return {
      texto: montar(partes),
      rastro: {
        agenda: it.agenda ? (f.agendaErro ? 'erro' : (f.agenda || []).length + ' evento(s) ' + it.periodo) : '-',
        tarefas: it.tarefas ? (f.tarefasErro ? 'erro' : (f.tarefas || []).length + ' pendente(s)') : '-',
        locais: it.noticias ? (f.locais ? (f.locaisFontes.length + ' fonte(s)') : (f.locaisErro ? 'erro: ' + f.locaisErro : 'desligado')) : '-',
        noticias: it.noticias ? (f.noticias ? (f.noticiasFontes.length + ' fonte(s)') : 'erro: ' + f.noticiasErro) : '-',
        tempo: it.tempo ? (f.tempo ? 'ok' : 'erro') : '-',
        versiculo: it.biblia ? (f.versiculo ? f.versiculo.ref : 'erro') : '-',
        redacao: erroRedacao ? ('erro: ' + String(erroRedacao).slice(0, 80)) : (corpo ? corpo.split(/\s+/).length + ' palavras' : 'vazia'),
        msColeta: msColeta, msRedacao: msRedacao
      }
    };
  }

  return { gerar: gerar, intencoes: intencoes, fraseAgenda: fraseAgenda, fraseTarefas: fraseTarefas,
           removerFrasesPessoais: removerFrasesPessoais, tirarSaudacao: tirarSaudacao, montar: montar, coletar: coletar,
           VERSICULOS_REFLEXAO: VERSICULOS_REFLEXAO };
})();
