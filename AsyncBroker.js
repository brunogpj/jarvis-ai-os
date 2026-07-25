// ===================================================================================
// AsyncBroker.js — BROKER ASSÍNCRONO (P8.1 · portado/adaptado do projeto-irmão "Antigravity").
// ===================================================================================
// "1-Second Timeout Hack" (Kanshi Tanaike): dispara POSTs de loopback para a PRÓPRIA URL /exec
// com timeoutSeconds:1 — a exceção de timeout é engolida no chamador, mas o contêiner-alvo executa
// até concluir numa janela ISOLADA de 6 min. Resultado: contorna o limite de 6 min e o teto de
// ~90 min/dia de gatilhos (o P7.1 SEM Cloud Run). Camadas: token-bucket (concorrência), dead-letter
// (recupera worker travado), retries, reducer (síntese), auto-continuação (handler que pede "continuar").
//
// ADAPTAÇÕES ao Jarvis (≠ Antigravity):
//   • Estado em FIRESTORE (coleção 'broker_fila'), não em Sheets (Jarvis é Firestore-native).
//   • Loopback assinado por HMAC-SHA256 (BROKER_SECRET) — validado no doPost (rota __broker).
//   • LLM via Gemini.gerar (free tier) com retry; LockService.getScriptLock().
//   • HANDLERS genéricos (BROKER_HANDLERS): qualquer trabalho pesado registra um handler. 1º uso:
//     'reindexRAG' = encadeia Semantica.indexar() até terminar (fim do "rode de novo no editor").
//   • MapReduce multi-agente (blueprint) construído SOBRE o motor genérico.
//
// Schema 'broker_fila':
//   META  id=<jobId>__meta  : {tipo:'meta', jobId, status:ACTIVE|DONE, kind:'tasks'|'mapreduce',
//                              userEmail, title, turn, maxTurns, blueprint?, reducer?, ts, output?}
//   TASK  id=<jobId>__<tid> : {tipo:'task', jobId, taskId, handler?, agentId?, input, status:
//                              PENDING|RUNNING|COMPLETED|ERROR|CANCELLED, output, retries, ts, msg, turn}
// ===================================================================================

var BROKER_COL = 'broker_fila';
var BROKER_CFG = {
  MAX_CONCURRENT: Number(PropertiesService.getScriptProperties().getProperty('BROKER_MAX_CONCURRENT') || '2'),
  DEAD_LETTER_MS: 8 * 60 * 1000,   // RUNNING travado > 8 min → recupera
  WORKER_DELAY_MS: 800,            // respiro antes do worker (espalha picos de quota)
  MAX_RETRIES: 2,
  MAX_TASKS_POR_JOB: 100,          // trava de segurança contra auto-continuação infinita
  TIMEOUT_S: 1,                    // o "golpe de 1 segundo"
  LOCK_MS: 28000
};

// ── HANDLERS genéricos: nome → função(input) → {ok, output, continuar?, proximoInput?} ──────────
var BROKER_HANDLERS = {
  // Indexação semântica do wiki, ENCADEADA: cada lote roda num contêiner isolado; enquanto houver
  // 'restantes', o broker re-enfileira a continuação. Termina sozinho (sem editor).
  reindexRAG: function (input) {
    if (typeof Semantica === 'undefined' || !Semantica.indexar) return { ok: false, output: 'Semantica indisponível.' };
    var r = Semantica.indexar({}) || {};
    if (r.status === 'continuar') {
      return { ok: true, continuar: true, proximoInput: {}, output: '+' + (r.arquivos || 0) + ' arq · ' + (r.trechos || 0) + ' trechos · restantes ' + (r.restantes || 0) };
    }
    if (r.status === 'abortado') return { ok: false, output: 'abortado: ' + (r.motivo || '') + (r.erro1 ? (' · ' + r.erro1) : '') };
    return { ok: r.status === 'success', output: (r.status || '?') + ' · ' + (r.arquivos || 0) + ' arq · ' + (r.trechos || 0) + ' trechos' + (r.erro1 ? (' · erro1=' + r.erro1) : '') };
  },
  // Handler de teste (diag): dorme um pouco e ecoa o input.
  brokerEcho: function (input) { Utilities.sleep(500); return { ok: true, output: 'echo: ' + JSON.stringify(input || {}).substring(0, 120) }; }
};

// ── Infra: URL do loopback + assinatura HMAC ────────────────────────────────────────────────────
function _brokerUrl() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  if (!url) throw new Error('URL do Web App indisponível. Publique como Web App.');
  return url.replace(/\/dev$/, '/exec');
}
function _brokerSecret() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('BROKER_SECRET');
  if (!s) { s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); p.setProperty('BROKER_SECRET', s); }
  return s;
}
function _brokerSig(tipo, jobId, taskId) {
  var msg = [tipo, jobId || '', String(taskId || '')].join('|');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, _brokerSecret()));
}
function _brokerAuthHeader() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }

/** Valida a assinatura de um loopback (chamado pelo doPost). */
function brokerVerificarAssinatura(payload) {
  if (!payload || !payload.__broker) return false;
  var esperado = _brokerSig(payload.__broker, payload.jobId, payload.taskId);
  return payload.signature === esperado;
}

// Loopback de 1s para o DISPATCHER (fire-and-forget).
function _brokerFireDispatch(jobId) {
  try {
    UrlFetchApp.fetch(_brokerUrl(), {
      method: 'post', contentType: 'application/json', headers: _brokerAuthHeader(),
      payload: JSON.stringify({ __broker: 'DISPATCH', jobId: jobId, signature: _brokerSig('DISPATCH', jobId, '') }),
      timeoutSeconds: BROKER_CFG.TIMEOUT_S, muteHttpExceptions: true
    });
  } catch (e) { /* timeout esperado — o alvo segue executando */ }
}
// Loopback de 1s em LOTE para os WORKERS (fan-out paralelo).
function _brokerFireWorkers(tasks) {
  if (!tasks || !tasks.length) return;
  var auth = _brokerAuthHeader();
  var reqs = tasks.map(function (t) {
    return {
      url: _brokerUrl(), method: 'post', contentType: 'application/json', headers: auth,
      payload: JSON.stringify({ __broker: 'WORKER', jobId: t.jobId, taskId: t.taskId, signature: _brokerSig('WORKER', t.jobId, t.taskId) }),
      timeoutSeconds: BROKER_CFG.TIMEOUT_S, muteHttpExceptions: true
    };
  });
  try { UrlFetchApp.fetchAll(reqs); } catch (e) { /* timeouts esperados */ }
}

// ── Firestore: leitura/escrita do estado do job ────────────────────────────────────────────────
function _brokerReadJob(jobId) {
  var docs = [];
  try { docs = Firestore.listDocs(BROKER_COL, 400); } catch (e) { docs = []; }
  var meta = null, tasks = [];
  docs.forEach(function (d) {
    var x = d.dados || {};
    if (x.jobId !== jobId) return;
    if (x.tipo === 'meta') meta = x;
    else if (x.tipo === 'task') tasks.push(x);
  });
  return { meta: meta, tasks: tasks };
}
function _brokerSetTask(jobId, taskId, doc) { try { Firestore.setDoc(BROKER_COL, jobId + '__' + taskId, doc); } catch (e) { Logger.log('[Broker] setTask: ' + e.message); } }
function _brokerUpdTask(jobId, taskId, upd) { try { Firestore.updateDoc(BROKER_COL, jobId + '__' + taskId, upd); } catch (e) { try { var j = _brokerReadJob(jobId); } catch (e2) {} Logger.log('[Broker] updTask: ' + e.message); } }
function _brokerSetMeta(jobId, doc) { try { Firestore.setDoc(BROKER_COL, jobId + '__meta', doc); } catch (e) { Logger.log('[Broker] setMeta: ' + e.message); } }
function _brokerUpdMeta(jobId, upd) { try { Firestore.updateDoc(BROKER_COL, jobId + '__meta', upd); } catch (e) { Logger.log('[Broker] updMeta: ' + e.message); } }

// ===================================================================================
// DISPATCHER — token-bucket + dead-letter + avanço de turno (mapreduce) + reducer
// ===================================================================================
function _brokerDispatch(jobId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BROKER_CFG.LOCK_MS)) { _brokerFireDispatch(jobId); return; } // não perde o "despertar"
  var workersToFire = [], fireDispatchAfter = false, reduceCtx = null;
  try {
    var job = _brokerReadJob(jobId);
    if (!job.meta || job.meta.status === 'DONE') return;
    var meta = job.meta, now = Date.now();

    // Kill switch
    if (PropertiesService.getScriptProperties().getProperty('BROKER_KILL_' + jobId) === 'true') {
      job.tasks.forEach(function (t) { if (t.status === 'PENDING' || t.status === 'RUNNING') _brokerUpdTask(jobId, t.taskId, { status: 'CANCELLED', msg: 'kill switch' }); });
      _brokerUpdMeta(jobId, { status: 'DONE', output: 'cancelado (kill switch)' });
      PropertiesService.getScriptProperties().deleteProperty('BROKER_KILL_' + jobId);
      return;
    }

    // Dead-letter: RUNNING travado → retry/ERROR
    job.tasks.forEach(function (t) {
      if (t.status !== 'RUNNING') return;
      if ((now - Number(t.ts || 0)) <= BROKER_CFG.DEAD_LETTER_MS) return;
      if ((Number(t.retries) || 0) < BROKER_CFG.MAX_RETRIES) { t.status = 'PENDING'; t.retries = (Number(t.retries) || 0) + 1; _brokerUpdTask(jobId, t.taskId, { status: 'PENDING', retries: t.retries, msg: 'dead-letter retry ' + t.retries }); }
      else { t.status = 'ERROR'; _brokerUpdTask(jobId, t.taskId, { status: 'ERROR', msg: 'excedeu retries (dead-letter)' }); }
    });

    var turn = Number(meta.turn) || 1;
    var curr = job.tasks.filter(function (t) { return (Number(t.turn) || 1) === turn; });
    var running = curr.filter(function (t) { return t.status === 'RUNNING'; });
    var pending = curr.filter(function (t) { return t.status === 'PENDING'; });

    if (pending.length === 0 && running.length === 0 && curr.length > 0) {
      // Turno concluído.
      if (meta.kind === 'mapreduce' && turn < (Number(meta.maxTurns) || 1)) {
        // Avança turno: 1 tarefa por agente no próximo turno.
        var prox = turn + 1, ts = new Date().toISOString();
        (meta.blueprint.AGENTS || []).forEach(function (ag) {
          _brokerSetTask(jobId, ag.id + '_T' + prox, { tipo: 'task', jobId: jobId, taskId: ag.id + '_T' + prox, agentId: ag.id, input: '{}', status: 'PENDING', output: '', retries: 0, ts: ts, msg: 'aguardando turno ' + prox, turn: prox });
        });
        _brokerUpdMeta(jobId, { turn: prox });
        fireDispatchAfter = true;
      } else {
        // Fim → REDUCER (síntese) fora do lock.
        reduceCtx = { meta: meta, tasks: job.tasks };
      }
    } else {
      // Token-bucket: despacha até preencher MAX_CONCURRENT.
      var slots = BROKER_CFG.MAX_CONCURRENT - running.length;
      if (slots > 0 && pending.length > 0) {
        pending.slice(0, slots).forEach(function (t) {
          _brokerUpdTask(jobId, t.taskId, { status: 'RUNNING', ts: Date.now(), msg: 'despachado' });
          workersToFire.push({ jobId: jobId, taskId: t.taskId });
        });
      }
    }
  } finally { lock.releaseLock(); }

  // Fora do lock: rede (loopback / LLM do reducer).
  if (workersToFire.length) _brokerFireWorkers(workersToFire);
  if (fireDispatchAfter) _brokerFireDispatch(jobId);
  if (reduceCtx) _brokerReduzir(jobId, reduceCtx.meta, reduceCtx.tasks);
}

// Síntese final + marca DONE + notifica o dono + limpa as tarefas (mantém o META com o resultado).
function _brokerReduzir(jobId, meta, tasks) {
  var saida = '';
  try {
    if (meta.kind === 'mapreduce' && meta.blueprint && meta.blueprint.REDUCER) {
      // Última contribuição COMPLETED de cada agente.
      var blocos = (meta.blueprint.AGENTS || []).map(function (ag) {
        var row = tasks.filter(function (t) { return t.agentId === ag.id && t.status === 'COMPLETED'; }).sort(function (a, b) { return (Number(b.turn) || 0) - (Number(a.turn) || 0); })[0];
        return '### ' + ag.id + '\n' + ((row && row.output) || '(sem contribuição)');
      }).join('\n\n');
      saida = _brokerLLMRetry('Você é um sintetizador executivo. Produza um relatório único, coeso e acionável em português do Brasil.', meta.blueprint.REDUCER.prompt + '\n\n' + blocos, []) || '(síntese vazia)';
    } else {
      // Jobs de tarefas: concatena os outputs.
      var ok = tasks.filter(function (t) { return t.status === 'COMPLETED'; });
      var err = tasks.filter(function (t) { return t.status === 'ERROR'; });
      saida = '✅ ' + ok.length + ' tarefa(s) concluída(s)' + (err.length ? (' · ⚠️ ' + err.length + ' com erro') : '') + '.\n'
        + ok.map(function (t) { return '• ' + (t.output || ''); }).join('\n');
    }
  } catch (e) { saida = 'Falha no reducer: ' + e.message; }

  _brokerUpdMeta(jobId, { status: 'DONE', output: String(saida).substring(0, 40000), fimTs: Date.now() });
  // Limpeza: remove os docs de tarefa (mantém o META). Coleção enxuta.
  try { tasks.forEach(function (t) { Firestore.deleteDoc(BROKER_COL, jobId + '__' + t.taskId); }); } catch (e) {}
  try { if (typeof WikiMemoryService !== 'undefined') WikiMemoryService.registrarNoLog('[broker] job ' + jobId + ' concluído: ' + String(saida).substring(0, 120)); } catch (e) {}
  // Notifica o dono no WhatsApp (preview).
  try {
    var p = PropertiesService.getScriptProperties(), num = p.getProperty('WHATSAPP_OWNER_NUMBER');
    if (num && typeof WhatsApp !== 'undefined') WhatsApp.enviar(num, '🤖 *Broker — ' + (meta.title || jobId) + ' concluído*\n\n' + String(saida).substring(0, 700));
  } catch (e) {}
}

// ===================================================================================
// WORKER — executa UMA tarefa (handler genérico ou turno de agente do mapreduce)
// ===================================================================================
function _brokerWorker(payload) {
  if (BROKER_CFG.WORKER_DELAY_MS > 0) Utilities.sleep(BROKER_CFG.WORKER_DELAY_MS);
  var jobId = payload.jobId, taskId = payload.taskId, out = '', erro = null, res = null;
  try {
    var job = _brokerReadJob(jobId);
    if (!job.meta) throw new Error('META ausente');
    var task = job.tasks.filter(function (t) { return t.taskId === taskId; })[0];
    if (!task) throw new Error('tarefa ' + taskId + ' ausente');

    if (job.meta.kind === 'mapreduce') {
      // Turno de agente: monta histórico dos turnos anteriores e chama o LLM.
      var bp = job.meta.blueprint, ag = (bp.AGENTS || []).filter(function (a) { return a.id === task.agentId; })[0];
      if (!ag) throw new Error('agente ' + task.agentId + ' fora do blueprint');
      var hist = [];
      for (var tn = 1; tn < (Number(task.turn) || 1); tn++) {
        var prev = job.tasks.filter(function (x) { return x.agentId === ag.id && (Number(x.turn) || 1) === tn; })[0];
        hist.push({ role: 'user', text: _brokerPromptTurno(bp, ag, tn) });
        hist.push({ role: 'model', text: (prev && prev.output) || '(sem saída)' });
      }
      var sys = 'Você é o agente "' + ag.id + '" numa rede colaborativa. Missão: ' + (bp.MISSION || bp.TITLE || '') + '. Responda em pt-BR, objetivo e fundamentado.';
      out = _brokerLLMRetry(sys, _brokerPromptTurno(bp, ag, Number(task.turn) || 1), hist);
      res = { ok: true, output: out };
    } else {
      // Handler genérico.
      var fn = BROKER_HANDLERS[task.handler];
      if (!fn) throw new Error('handler "' + task.handler + '" não registrado');
      res = fn(_safeParse(task.input)) || { ok: false, output: '(handler sem retorno)' };
      out = String(res.output || '');
    }
  } catch (e) { erro = e.message; Logger.log('[Broker] worker ' + jobId + '/' + taskId + ': ' + e.message); }

  // Escrita do resultado.
  if (erro === null && res && res.ok !== false) {
    _brokerUpdTask(jobId, taskId, { status: 'COMPLETED', output: String(out).substring(0, 40000), msg: 'ok' });
    // Auto-continuação (ex.: reindexRAG enquanto houver 'restantes') — herda o handler da tarefa atual.
    if (res && res.continuar && task && task.handler) {
      try {
        var jb = _brokerReadJob(jobId);
        if (jb.tasks.length < BROKER_CFG.MAX_TASKS_POR_JOB) {
          var nid = 'cont_' + Utilities.getUuid().slice(0, 6);
          _brokerSetTask(jobId, nid, { tipo: 'task', jobId: jobId, taskId: nid, handler: task.handler, input: JSON.stringify(res.proximoInput || {}), status: 'PENDING', output: '', retries: 0, ts: new Date().toISOString(), msg: 'continuação', turn: 1 });
        }
      } catch (eC) { Logger.log('[Broker] auto-continuação: ' + eC.message); }
    }
  } else {
    var task2 = _brokerReadJob(jobId).tasks.filter(function (t) { return t.taskId === taskId; })[0] || {};
    var retries = Number(task2.retries) || 0;
    if (retries < BROKER_CFG.MAX_RETRIES) _brokerUpdTask(jobId, taskId, { status: 'PENDING', retries: retries + 1, msg: 'retry ' + (retries + 1) + ': ' + (erro || (res && res.output) || 'erro') });
    else _brokerUpdTask(jobId, taskId, { status: 'ERROR', msg: 'erro permanente: ' + (erro || (res && res.output) || '') });
  }
  _brokerFireDispatch(jobId); // acorda o dispatcher (reação em cadeia)
}

// ── LLM (mapreduce) via Gemini, com retry exponencial em erro transitório ──────────────────────
function _brokerLLM(sys, user, hist) {
  var contents = [];
  (hist || []).forEach(function (m) { if (m && m.text) contents.push({ role: (m.role === 'model' || m.role === 'assistant') ? 'model' : 'user', parts: [{ text: String(m.text) }] }); });
  contents.push({ role: 'user', parts: [{ text: String(user || '') }] });
  var r = Gemini.gerar({ systemInstruction: { parts: [{ text: String(sys || '') }] }, contents: contents, generationConfig: { temperature: 0.3, maxOutputTokens: 1200 } });
  try { return r.json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim(); } catch (e) { return ''; }
}
function _brokerLLMRetry(sys, user, hist) {
  var attempt = 0;
  while (true) {
    try { var t = _brokerLLM(sys, user, hist); if (t) return t; throw new Error('resposta vazia'); }
    catch (e) {
      attempt++;
      var transit = /429|quota|rate.?limit|RESOURCE_EXHAUSTED|timeout|deadline|503|unavailable|vazia|indispon/i.test(e.message || '');
      if (!transit || attempt >= 4) throw e;
      Utilities.sleep(Math.min(30000, 3000 * Math.pow(2, attempt - 1)));
    }
  }
}
function _brokerPromptTurno(bp, ag, turn) {
  if (turn <= 1) return ag.initialPrompt;
  var tp = bp.TURN_PROMPTS || {};
  return tp[String(turn)] || tp[turn] || ('Turno ' + turn + ': refine o plano com base no histórico, mais concreto e acionável.');
}
function _safeParse(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

// ===================================================================================
// API PÚBLICA
// ===================================================================================

/** Enfileira um JOB de tarefas genéricas. handler ∈ BROKER_HANDLERS; inputs = lista (1 tarefa cada). */
function brokerEnfileirar(handler, inputs, opts) {
  opts = opts || {};
  if (!BROKER_HANDLERS[handler]) return { ok: false, erro: 'handler "' + handler + '" não registrado.' };
  inputs = (Array.isArray(inputs) && inputs.length) ? inputs : [{}];
  var jobId = 'JOB-' + Utilities.getUuid().split('-')[0].toUpperCase();
  var ts = new Date().toISOString();
  _brokerSetMeta(jobId, { tipo: 'meta', jobId: jobId, status: 'ACTIVE', kind: 'tasks', userEmail: opts.userEmail || _brokerOwner(), title: opts.title || handler, turn: 1, ts: ts });
  inputs.forEach(function (inp, i) {
    var tid = 't' + i;
    _brokerSetTask(jobId, tid, { tipo: 'task', jobId: jobId, taskId: tid, handler: handler, input: JSON.stringify(inp || {}), status: 'PENDING', output: '', retries: 0, ts: ts, msg: 'aguardando', turn: 1 });
  });
  _brokerFireDispatch(jobId);
  return { ok: true, jobId: jobId, tarefas: inputs.length, title: opts.title || handler };
}

/** Inicia uma rede multi-agente assíncrona (MapReduce) a partir de um blueprint. */
function brokerStartMultiAgente(blueprint, userEmail) {
  var bp = blueprint || _blueprintFromBriefing({});
  if (!bp.AGENTS || !bp.AGENTS.length) return { ok: false, erro: 'blueprint sem agentes.' };
  var jobId = 'JOB-' + Utilities.getUuid().split('-')[0].toUpperCase();
  var ts = new Date().toISOString();
  _brokerSetMeta(jobId, { tipo: 'meta', jobId: jobId, status: 'ACTIVE', kind: 'mapreduce', userEmail: userEmail || _brokerOwner(), title: bp.TITLE || 'Rede multi-agente', turn: 1, maxTurns: Number(bp.MAX_TURNS) || 1, blueprint: bp, ts: ts });
  bp.AGENTS.forEach(function (ag) {
    _brokerSetTask(jobId, ag.id + '_T1', { tipo: 'task', jobId: jobId, taskId: ag.id + '_T1', agentId: ag.id, input: '{}', status: 'PENDING', output: '', retries: 0, ts: ts, msg: 'aguardando turno 1', turn: 1 });
  });
  _brokerFireDispatch(jobId);
  return { ok: true, jobId: jobId, title: bp.TITLE, agentes: bp.AGENTS.length, turnos: Number(bp.MAX_TURNS) || 1 };
}

/** Monta um blueprint a partir de um briefing em linguagem natural. */
function _blueprintFromBriefing(p) {
  p = p || {};
  var objetivo = p.objetivo || p.tema || 'Planejar uma iniciativa.';
  var turnos = Math.max(1, Math.min(5, Number(p.turnos) || 2));
  var papeis = (Array.isArray(p.agentes) && p.agentes.length) ? p.agentes.map(String) : ['Estrategista', 'Especialista Técnico', 'Analista de Riscos'];
  var agents = papeis.map(function (nome) {
    var id = String(nome).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 20) || 'AGENTE';
    return { id: id, initialPrompt: 'Você é "' + nome + '". Sobre o objetivo a seguir, apresente sua análise e plano inicial.\nObjetivo: ' + objetivo };
  });
  var tp = {}; for (var t = 2; t <= turnos; t++) tp[t] = 'Turno ' + t + ': refine e aprofunde considerando os demais agentes; seja concreto e acionável.';
  return { TITLE: ('Rede: ' + objetivo).substring(0, 80), MISSION: objetivo, MAX_TURNS: turnos, MAX_RETRIES: 2, AGENTS: agents, TURN_PROMPTS: tp, REDUCER: { prompt: 'Sintetize as contribuições finais num único plano coeso e acionável sobre: ' + objetivo } };
}

/** Status de um job (para UI/diag). */
function brokerStatus(jobId) {
  var job = _brokerReadJob(jobId);
  if (!job.meta) return { ok: false, erro: 'job não encontrado: ' + jobId };
  return { ok: true, jobId: jobId, title: job.meta.title, status: job.meta.status, kind: job.meta.kind, turno: job.meta.turn, done: job.meta.status === 'DONE', resultado: job.meta.output || '', tarefas: job.tasks.map(function (t) { return { taskId: t.taskId, agentId: t.agentId, status: t.status, turn: t.turn, preview: String(t.output || '').substring(0, 120) }; }) };
}

/** Lista os jobs (META) mais recentes. */
function brokerListJobs() {
  var docs = []; try { docs = Firestore.listDocs(BROKER_COL, 400); } catch (e) {}
  return docs.map(function (d) { return d.dados; }).filter(function (x) { return x && x.tipo === 'meta'; })
    .sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); })
    .map(function (m) { return { jobId: m.jobId, title: m.title, status: m.status, kind: m.kind, turno: m.turn, ts: m.ts }; });
}

/** Parada de emergência de um job. */
function emergencyHaltBroker(jobId) {
  PropertiesService.getScriptProperties().setProperty('BROKER_KILL_' + jobId, 'true');
  _brokerFireDispatch(jobId);
  return { ok: true, jobId: jobId };
}

function _brokerOwner() { return PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'owner'; }

// ── Conveniências / diag (editor) ──────────────────────────────────────────────────────────────
/** 1º USO: indexação RAG encadeada e assíncrona (substitui o "rode indexarWikiSemantico de novo"). */
function brokerReindexRAG() {
  var r = brokerEnfileirar('reindexRAG', [{}], { title: 'Reindexação RAG (assíncrona)' });
  Logger.log('🚀 ' + JSON.stringify(r) + '\nAcompanhe com brokerStatus("' + r.jobId + '") ou brokerListJobs().');
  return r;
}
/** Diag do motor SEM custo de LLM: roda 3 tarefas brokerEcho em paralelo. */
function testarBroker() {
  var r = brokerEnfileirar('brokerEcho', [{ n: 1 }, { n: 2 }, { n: 3 }], { title: 'Teste do broker' });
  Logger.log('🧪 ' + JSON.stringify(r) + '\nEm alguns segundos: brokerStatus("' + r.jobId + '")');
  return r;
}
/** Gera/mostra o BROKER_SECRET (criado automaticamente no 1º uso). */
function configurarBrokerSecret() { var s = _brokerSecret(); Logger.log('✅ BROKER_SECRET pronto (' + s.length + ' chars).'); return { ok: true }; }
