# 🚀 Melhorias do Jarvis — derivadas de 2 trabalhos de referência

> Análise técnica que mapeia ideias dos artigos ingeridos na BaseConhecimento → melhorias **concretas** no projeto GAS atual (Jarvis · Soft Web App).
> Fontes: **Kanshi Tanaike** — "Executando o GAS em agendamentos complexos usando Vibe Coding" (TriggerApp + MCP); **Erick Roberto Furst Brito** — "Agentes de IA plug-and-play com arquiteturas serverless".
> Data: 2026-06-03.

---

## 1. O que cada trabalho ensina (resumo aplicável)

### A) Tanaike — TriggerApp / MCP / Vibe Coding
- **Daisy-chain de gatilhos**: contorna o limite de 20 gatilhos usando só 2 slots (agendamento *Just-In-Time*, recursivo).
- **Quebra do limite de 6 min**: enfileira lotes de execução futuros (`installTriggersByData`) → tarefas longas continuam em execuções subsequentes.
- **Agendamento declarativo (JSON)**: schedules complexos (dias úteis, janelas de horário) sem poluir a lógica de negócio.
- **Simular antes de executar**: a IA projeta o resultado (timestamps ISO) e o humano audita antes do commit — trava contra alucinação.
- **GAS como servidor MCP**: `doPost` JSON-RPC expõe o GAS para agentes externos (Claude Desktop, Antigravity) orquestrarem por linguagem natural.

### B) Brito — Agentes serverless plug-and-play
- **Serverless-first + stateless**: execução sem estado, escalável e barata (é o que o GAS já é).
- **Agente como API (plug-and-play)**: módulos de IA expostos como endpoints reutilizáveis.
- **HTTP API vs REST API**: escolher conforme maturidade/governança.
- **Auto-crítica / reflexão**: o agente valida a própria saída antes de entregar (confiabilidade).
- **Da prototipagem à produção**: escalabilidade, custo e complexidade operacional como cidadãos de primeira classe.

---

## 2. Melhorias priorizadas para o Jarvis (atual)

### 🟥 P0 — Correções rápidas (resolvem bugs vistos hoje)

**P0.1 — Auto-correção de ferramenta desconhecida** *(reflexão — Brito)*
- **Problema:** no teste de 10:47 o modelo chamou `ingestirFonte` (nome errado) → "ferramenta não encontrada" → depois `STOP` vazio.
- **Proposta:** em `Jarvis._execTool`, no `default` (tool desconhecida), retornar a **lista de ferramentas válidas** + sugestão do nome mais próximo, em vez de só "desconhecida". Assim o modelo se autocorrige no próximo passo. Adicionar alias óbvio (`ingestirFonte`→`ingerirFonte`).
- **Arquivos:** `Jarvis.js` (`_execTool` default + alias). **Impacto: alto · Esforço: baixo.**

**P0.2 — Ingestão de anexo usa `escreverWiki`, não `ingerirFonte`** *(clareza de protocolo)*
- **Problema:** ao anexar um arquivo e pedir ingestão, o conteúdo já vai inline + a URL do raw no contexto; `ingerirFonte` é para reler um arquivo que JÁ está no raw por fileId. O modelo se confunde.
- **Proposta:** no system prompt deixar explícito: *"para ingerir um arquivo ANEXADO, use escreverWiki direto (você já tem o conteúdo + a URL do raw); ingerirFonte é só para fontes já no raw sem conteúdo inline."*
- **Arquivos:** `Jarvis.js` (system prompt). **Impacto: alto · Esforço: baixo.**

### 🟧 P1 — Alto impacto (resolvem dor recorrente + nova capacidade matadora)

**P1.1 — Continuação Just-In-Time (quebrar o limite de 6 min)** *(daisy-chain — Tanaike)*
- **Problema:** ingestão e tarefas multi-passo pesadas estouram o limite de 6 min do GAS (vimos "Tempo máximo de execução excedido" e `STOP` vazio).
- **Proposta:** quando uma tarefa do servidor se aproxima de ~5 min, **persistir o estado** (Firestore/Properties) e **agendar um gatilho temporal** para continuar — processando o trabalho em lotes. Aplicar primeiro à **ingestão de documentos grandes** (1 página por execução) e a **lotes de WhatsApp**.
- **Implementação:** ou um módulo próprio `Continuation.js` (cria trigger efêmero +1-2 min, lê estado, continua), ou linkar a **biblioteca TriggerApp** (`1LihDPPHWBCcadYVBI3oZ4vOt7XqlowoHyBLdaDgRIx_5OpRBREA7Z1QB`).
- **Arquivos:** novo `Continuation.js` + ganchos em `Code.js`/`WikiMemoryService.js`. **Impacto: muito alto · Esforço: médio-alto.**

**P1.2 — Tarefas agendadas (o "OS pessoal" de verdade)** *(agendamento declarativo — Tanaike)*
- **Problema:** o Jarvis só age sob demanda; não consegue *"todo dia útil às 8h, resuma meus e-mails não lidos e me mande no WhatsApp"*.
- **Proposta:** ferramenta `agendarTarefa({descricao, quando})` que grava a diretiva em linguagem natural + cria um gatilho temporal; um handler global executa `Jarvis.ask(diretiva)` no disparo. Para schedules complexos (dias úteis/janelas), usar o TriggerApp (com daisy-chain respeitando o limite de 20).
- **Arquivos:** `Jarvis.js` (tool + handler), `Code.js` (trigger). **Impacto: muito alto (demo!) · Esforço: médio.**

### 🟨 P2 — Confiabilidade & segurança

**P2.1 — Simular/confirmar antes de executar** *(DevOps safety — Tanaike)* — ✅ **IMPLEMENTADO (b33 @33, 2026-06-03)**
- **Problema:** o Jarvis envia WhatsApp / agenda / exclui direto; já vimos envio para número errado e alucinação. Risco em ações irreversíveis/externas.
- **Solução entregue:** camada de confirmação em `Jarvis.js` — ações sensíveis (`enviarWhatsApp`, `enviarAudioWhatsApp`, `enviarWhatsAppEmLote`, `run_dynamic_script`, `gerarImagem` com envio externo) retornam `{status:'confirmacao_requerida', resumo}` no **chat interativo** (sem `confirmado:true`); o Jarvis mostra o preview e pergunta, e só re-chama com `confirmado:true` após o "sim" do dono. System prompt: seção CONFIRMAÇÃO DE AÇÕES. Contextos autônomos (Agenda/Monitor/Jobs/inbound) passam `interativo:false` e seguem executando (pré-autorizados). Decls de ferramenta ganharam o param `confirmado`.
- **Arquivos:** `Jarvis.js`, `Code.js`, `Agenda.js`, `Monitor.js`, `SkillsManager.js`. **Impacto: médio-alto · Esforço: médio.**

**P2.2 — Passo de auto-crítica (reflexão)** *(Brito)*
- **Proposta:** antes de finalizar respostas sobre conhecimento, o agente verifica se **consultou o wiki** (já reforçado por regra); estender para uma checagem leve: se a tarefa exigia uma tool e nenhuma foi chamada, re-tentar com nudge. (Complementa P0.1.)
- **Impacto: médio · Esforço: baixo-médio.**

### 🟦 P4 — Autonomia por OBJETIVO (goal-driven) — ✅ **IMPLEMENTADO (b35 @35, 2026-06-03)**
- **Proposta entregue:** o usuário define uma META de alto nível composta; o Jarvis **planeja** os passos, **mostra o plano p/ confirmar**, **executa cada passo sozinho** (reusa o loop ReAct via `Jarvis.ask(..., {interativo:false})`), **acumula** resultados e **sintetiza** o desfecho — entregue no WhatsApp + log.
- **Arquivos:** `Objetivos.js` (novo), `Jarvis.js` (tools `definirObjetivo`/`listarObjetivos`/`cancelarObjetivo` + `_definirObjetivo` + prompt OBJETIVOS). Estado em Firestore `objetivos`. V1 síncrono (≤4 passos); **próximo:** backgrounding via Jobs (daisy-chain) p/ metas longas. **Impacto: alto · Esforço: médio.**

### 🟩 P3 — Arquitetura & interoperabilidade

**P3.1 — Jarvis como servidor MCP** *(Tanaike + "agente como API" — Brito)*
- **Proposta:** evoluir o `doPost` A2A atual para falar **MCP JSON-RPC** (`tools/list`, `tools/call`), expondo as ferramentas seguras do Jarvis para clientes MCP externos (Claude Desktop, Antigravity CLI). Reaproveita as `getToolDeclarations()`.
- **Arquivos:** `Code.js` (`doPost`). **Impacto: médio (portfólio/interop) · Esforço: médio-alto.**

**P3.2 — Skills/subagentes como APIs plug-and-play** *(Brito)*
- **Proposta:** padronizar contrato de entrada/saída de cada skill/subagente e expô-los individualmente via A2A/MCP (modulares, stateless). Alinha com P3.1.
- **Impacto: médio · Esforço: médio.**

**P3.3 — Idempotência em ações externas** *(stateless/produção — Brito)*
- **Proposta:** chave de idempotência em envios (WhatsApp/e-mail) para evitar duplicidade quando há retry. **Impacto: baixo-médio · Esforço: baixo.**

---

### 🟪 P5 — Enriquecimento a partir de 3 papers (Créalo Digital · XR/WWW'26 · atas WWW'26) — 2026-06-05

**P5.1 — Busca SEMÂNTICA na wiki (embeddings + RAG real)** ⭐ *(Créalo Digital — agente WhatsApp com embeddings)*
- **Hoje:** `buscarNoWiki` usa busca por PALAVRA-CHAVE (Drive `fullText contains`) — lenta (~36s no QA) e perde sinônimos (ex.: não achou "Soft Web App"; "Luciana" homônima). O paper da Créalo mostra que **RAG com embeddings semânticos** (cosine sobre vetores) resolve exatamente isso, com ganhos medidos (pertinência 68%→89%, satisfação +37%).
- **Proposta:** indexar os trechos do wiki com **embeddings do Gemini** (`text-embedding-004`, via UrlFetchApp — sem chave nova) e guardar os vetores no **Firestore** (coleção `wiki_vetores`: {caminho, trecho, vetor[]}). Em `buscarNoWiki`: embeddar a consulta → **similaridade de cosseno** (em JS, sobre algumas centenas de trechos) → top-k. A indexação roda em **2º plano (Jobs/daisy-chain)** que já temos. **Impacto: ALTO (corrige a fraqueza central de retrieval) · Esforço: médio.**

**P5.2 — Busca HÍBRIDA + re-ranking (RRF)** *(XR: Cross-Modal Agents, WWW'26)*
- **Proposta:** combinar o score de **palavra-chave** (atual) com o **semântico** (P5.1) via **Reciprocal Rank Fusion** e um passo de **re-ranking** (o XR mostra ganho de até 38% ao fundir múltiplos sinais em vez de um só). Cobre tanto correspondência literal quanto semântica. **Impacto: médio-alto · Esforço: baixo (depende de P5.1).**

**P5.3 — Agente VERIFICADOR (self-critique antes de finalizar)** *(XR: "question agents" / filtro fino)*
- **Proposta:** para respostas factuais/importantes, um passo leve de **verificação** ("o que afirmei está coberto pelas fontes recuperadas?") antes de entregar — reduz alucinação (o XR usa "question agents" p/ verificação factual). Complementa a regra de auto-crítica (P2.2). **Impacto: médio · Esforço: baixo-médio.**

**P5.4 — Painel de MÉTRICAS / observabilidade** *(Créalo — dashboard administrativo)*
- **Proposta:** uma aba/painel no app com indicadores: nº de interações, documentos ingeridos, embeddings gerados, jobs concluídos, tempo médio de resposta, status dos serviços (Gemini/Firestore/Evolution/TTS). O paper destaca isso como peça-chave de operação. **Impacto: médio (operação + portfólio) · Esforço: médio.**

**P5.5 — Captura de feedback / satisfação** *(Créalo — métrica Likert + emoji)*
- **Proposta:** botão 👍/👎 por resposta no chat (grava no Firestore) p/ medir pertinência e alimentar melhorias. **Impacto: baixo-médio · Esforço: baixo.**

**P5.6 — Conformidade de dados (LGPD)** *(Créalo — marco legal, Ley 1581/GDPR)*
- **Proposta:** documentar e aplicar minimização de dados + consentimento no bot inbound (aviso de que é um agente de IA e como os dados são tratados) + retenção/expurgo de conversas. **Impacto: médio (confiança/produção) · Esforço: baixo-médio.**

> **Contexto (atas WWW'26):** o índice do *ACM Web Conference 2026* confirma que a fronteira é **agentic AI + retrieval-augmented + multimodal** — exatamente a direção do Jarvis. Bom material de posicionamento p/ portfólio.

**Ordem sugerida do P5:** P5.1 (semântica) → P5.2 (RRF) → P5.3 (verificador) → P5.4 (métricas) → P5.5/P5.6.

---

## 3. Ordem de implementação recomendada

1. **P0.1 + P0.2** (1 deploy) — elimina os erros de ingestão de hoje. *Rápido.*
2. **P1.1** (continuação 6 min) — destrava ingestão pesada e lotes; é a base para o resto.
3. **P1.2** (tarefas agendadas) — capacidade nova de maior valor para um "AI Personal OS".
4. **P2.1 + P2.2** (segurança/reflexão) — confiança para ações externas.
5. **P3.x** (MCP/plug-and-play) — interoperabilidade e peso de portfólio.

---

## 4. Mapa ideia-fonte → melhoria (rastreabilidade)

| Ideia (fonte) | Melhoria Jarvis | Prioridade |
|---|---|---|
| Daisy-chain / quebra 6 min (Tanaike) | P1.1 Continuação JIT | Alta |
| Agendamento declarativo (Tanaike) | P1.2 Tarefas agendadas | Alta |
| Simular antes de executar (Tanaike) | P2.1 Confirmar ações | Média-alta |
| GAS como MCP (Tanaike) | P3.1 Servidor MCP | Média |
| Auto-crítica/reflexão (Brito) | P0.1, P2.2 | Alta |
| Agente como API plug-and-play (Brito) | P3.2 | Média |
| Stateless/produção (Brito) | P3.3 idempotência | Baixa-média |

---

## 5. ✅ Status atualizado (sessão 2026-06)

Entregue desde o roadmap original:
- ✅ **P1.2** Tarefas agendadas · ✅ **P2.1** Confirmação P2 · ✅ **P4** Autonomia por objetivo.
- ✅ **P5.1 + P5.2** Busca semântica (embeddings) + híbrida RRF → `buscarConhecimento`.
- ✅ **P5.3** Verificador/auto-crítica (subagente CRÍTICO, opt-in) · ✅ **P5.4** Observabilidade (card Atividade/Provedores/Loop/RAG) · ✅ **P5.5** Feedback 👍/👎.
- ✅ **P3.3** Idempotência em ações externas — **reforçada nesta sessão** (dedup de webhook do WhatsApp por id + dedup de fala/alerta por hash/carimbo).

Capacidades NOVAS (não previstas no roadmap, entregues nesta sessão):
- ✅ **Voz no Android** (Cloud TTS Chirp3-HD + MacroDroid via webhook; disparo determinístico; dedupe).
- ✅ **Alertas de voz agendados** (precisão de minuto; conteúdo fixo ou dinâmico).
- ✅ **Avisos de contato falados** com **nome salvo** (People API), **voz por gênero** e **discrição de assunto sensível**.
- ✅ **Segundo cérebro** — `capturarConhecimento` (url_context + saídas estruturadas + thinking → cartão arquivado na wiki).
- ✅ **Dashboard acionável** — cards interativos (tarefas/autorizações/secretária+toggle/alertas/agendadas/monitores).
- ✅ **Engenharia de custo** — cascata free-first, 2 chaves free, `GEMINI_FREE_ONLY` (modo 100% free, R$0).
- ✅ **Recusa de autorização natural** (nunca vaza dono/autorização ao contato).

---

## 6. 🔭 P6 — Próximas frentes (a priorizar)

- **P6.1 — Entrada de voz Android → Jarvis** (gatilho falado no MacroDroid capta áudio → POST no endpoint mobile). Fecha o ciclo de voz bidirecional. *Alto · médio.*
- **P6.2 — Podcast / Audio Overview nativo** (Gemini gera diálogo de 2 vozes → Cloud TTS Enceladus+Sulafat → áudio). Recurso-assinatura do NotebookLM, dentro do app. *Alto (portfólio) · médio.*
- **P6.3 — Despertador nativo no Android** (ação "Despertador" do MacroDroid; sem root; resolve o SET_ALARM do MIUI). *Médio · baixo.*
- **P6.4 — Card de Pendências com análise de urgência por IA** (priorizar/realçar mensagens críticas no Modo Secretária). *Médio · médio.*
- **P6.5 — Lote 3 do Dashboard** (📅 Eventos criar/excluir · 📧 E-mails marcar lido/responder/rascunho IA). *Médio · médio.*
- **P6.6 — Camada de análise de sensibilidade por IA** (opt-in) p/ pegar assuntos sensíveis que o heurístico não cobre. *Médio · baixo-médio.*
- **P6.7 — Captura multimodal no segundo cérebro** (imagem/PDF/áudio → cartão estruturado). *Médio · médio.*

---

## 7. 🛡️🚀 P7 — Hardening & Escala (análise crítica NotebookLM + revisão de código · 2026-06)

> Origem: podcast de análise crítica gerado no NotebookLM ("Escalabilidade e segurança no sistema Jarvis") + revisão própria. Os 3 pilares: **offload serverless**, **comunicação de segurança (OWASP)** e **roteador de intenção**.
>
> **Status (2026-06):** ✅ **P7.2** (doc OWASP → `SEGURANCA_OWASP_JARVIS.md`), ✅ **P7.1b** (heartbeat → `Heartbeat.js`), ✅ **P7.3** (roteador de conhecimento → `_rotaConhecimento` em `Code.js`), ✅ **P7.4** (hardening: webhook MacroDroid assinado + segredo do webhook WhatsApp + rate limiting; Drive e escopos = risco aceito documentado) — implementados, no deploy e testados. ⏳ Pendente: **P7.1** (Cloud Run/Tasks — infra), agora coberto pelo plano **P8.1 (AsyncBroker)**.

**P7.1 — Offload serverless das filas pesadas (fim da "falha silenciosa") 🔴**
- *Problema:* gatilhos do GAS têm teto (~90 min/dia no consumer). Ao crescer (vetores `wiki_vetores`, monitores, lotes), os gatilhos **param sem avisar** → tarefas perdidas (monitor de Gmail para, páginas não rastreadas, lote de WhatsApp no limbo). "O painel continua lindo, mas o motor parou."
- *Solução (mantendo custo zero — GCP free tier):* **Cloud Run** (free: 2M req/mês, timeout até 60 min) p/ trabalho pesado (`indexarWikiSemantico`/embeddings/chunking, ingestão grande) — GAS faz 1 chamada HTTP async; **Cloud Tasks** (push + retry exponencial) no lugar do **polling** do `agenda.js` (lê Firestore a cada 15 min). *Alto (setup GCP) · muito alto.*

**P7.1b — Anti-falha-silenciosa (quick win, sem sair do GAS) 🟠**
- *Heartbeat:* gravar `ULTIMO_TICK` a cada execução; check avisa o dono se o tick não roda há > X min → a falha vira **notificação**, não silêncio. *Baixo · alto (mata o pior pesadelo).*

**P7.2 — Comunicação de segurança = OWASP / threat model (CAREER-CRITICAL) 🔴**
- *Análise:* as defesas existem e funcionam, mas a doc **subestima** ao não mapeá-las contra ameaças reais → recrutador pode achar que foram "por acaso". A fraqueza está na **comunicação da engenharia**, não no código.
- *Entregável:* `SEGURANCA_OWASP_JARVIS.md` mapeando decisão→ameaça→padrão:
  - Dedup de webhook (CacheService por id) → **idempotência contra Replay Attack**.
  - Hooks pré/pós + guardrail → **mitigação de Prompt Injection / Jailbreak (OWASP LLM01)**.
  - Anti-SSRF (`web.js`) → **proteção contra SSRF / exfiltração de metadados do GCP**.
  - Owner-gating + confirmação P2 → **least privilege + human-in-the-loop**.
  - Bloqueio de credencial em anexo → **Sensitive Information Disclosure (LLM06)**.
  - *Baixo (doc) · muito alto (posicionamento profissional).*

**P7.3 — Roteador de intenção ANTES do loop ReAct (latência + tokens + anti-alucinação) 🟠**
- *Problema:* pergunta de conhecimento entra no ReAct → o Gemini gasta tokens só pra "decidir" chamar `buscarConhecimento` → round-trip de function-calling (+3-5s) + risco de responder de cabeça (alucinação).
- *Solução:* expandir o MODO DIRETO com um **roteador de intenção leve** (heurística OU modelo ultrarrápido do pool, ex.: **Groq**) antes do LLM principal. Intenção = recuperação → faz a busca **RRF primeiro** → injeta os fatos no system prompt ("responda só com base nestes fatos"). Elimina o function-calling, corta latência ~½, ancoragem factual. *Médio · alto.*

**P7.4 — Hardening pontual (da revisão de código) 🟠/🟡**
- Arquivo de fala no Drive `ANYONE_WITH_LINK` → tornar **não-público** (vaza prévia de mensagem).
- Webhook do MacroDroid sem auth → **assinar** (HMAC/secret na query).
- Revisar **escopos OAuth** (least privilege; `drive.file` vs `drive`).
- **Rate limiting** no `/exec`.

**Ordem sugerida:** P7.2 (OWASP doc) → P7.1b (heartbeat) → P7.3 (roteador) → P7.4 (hardening) → P7.1 (Cloud Run/Tasks).

---

## 8. 🔁 P8 — Conceitos portados do projeto-irmão "Antigravity" (transporte/frete · 2026-06)

> Origem: análise cruzada do projeto paralelo `C:\Users\Visitante\Documents\Project_Google_Apps_Script` (ERP de transporte com Assistente Gemini protagonista — o "irmão maior" do Jarvis, que manteve domínios que o Jarvis enxugou). Conceitos maduros lá que **agregam** ao Jarvis.
>
> **Status (2026-06):** ✅ **P8.2** (A2ABadge), ✅ **P8.3** (Evals), ✅ **P8.4** (hash-chain + Registry), ✅ **P8.1** (AsyncBroker — port completo: Firestore + loopback 1s + HMAC + token-bucket + dead-letter + reducer + auto-continuação + MapReduce multi-agente; **validado em produção** via `testarBroker` no deploy @180; 1º uso = `brokerReindexRAG`, **wired**: tool `reindexarConhecimento` (chat/WhatsApp) + auto-reindex debounced pós-`capturarConhecimento` + grupo TSI de conhecimento). **P8 concluído.** Com o P8.1, o **P7.1 está resolvido sem Cloud Run**.

**P8.1 — `AsyncBroker` · MapReduce assíncrono nativo no GAS (resolve o P7.1 SEM Cloud Run) 🚩🔴**
- *Técnica:* "1-Second Timeout Hack" (Kanshi Tanaike) — POSTs de loopback à própria URL do Web App com `timeoutSeconds:1`: a exceção é engolida no chamador, mas o contêiner-alvo roda **6 min isolados**. Em cima: **MapReduce multi-agente** (N agentes em paralelo → fase *reducer* sintetiza) + **dead-letter recovery** (RUNNING travado > 8 min recuperado) + `BROKER_MAX_CONCURRENT` (free=2).
- *Aplicação no Jarvis:* offload do `indexarWikiSemantico`/embeddings e lotes de WhatsApp para janelas de 6 min; **briefing das 8:30 em paralelo** (e-mails+notícias+agenda → reducer); o dead-letter é **mais uma camada anti-falha-silenciosa** (casa com o Heartbeat/P7.1b).
- *É o meio-termo que o podcast não viu:* fica no GAS, custo zero, antes de migrar pra Cloud Run/Tasks. **Esforço: médio-alto** (lá é Sheets-backed; no Jarvis = rota `__broker` no `doPost` + estado em Firestore).

**P8.2 — `A2ABadge` · crachás efêmeros de escopo mínimo (Zero-Trust) ✅**
- Credencial efêmera (TTL 10 min, CacheService) por chamada interna/agente→agente, com **escopo mínimo** e expiração. Materializa o least-privilege do `SEGURANCA_OWASP_JARVIS.md`. Base para assinar/expirar o webhook (P7.4) e autorizar hops internos (e o futuro AsyncBroker). **Esforço: baixo.**

**P8.3 — `Evals` · testes de COMPORTAMENTO do agente ✅**
- Suíte que roda casos canônicos ao vivo e compara o comportamento REAL (`toolTrace` + resposta) com o esperado: `semTool`, `toolEsperada`, `esperaConfirmacao` (Gate P2 não burlável por texto), `recusaEsperada` (anti-injeção), **vazamento de chave** por regex, anti-alucinação. Complementa o `QA.js` (funcional) com regressão de **segurança/alucinação**. **Esforço: baixo-médio.**

**P8.4 — Observabilidade & ops: hash-chain de telemetria + `Registry` ✅**
- *Telemetry hash-chain:* encadeia **SHA-256** em cada evento (`prevHash`→`GENESIS`) → log à prova de adulteração (*Audit Replay Chain*) — argumento de conformidade/integridade no doc OWASP. Opt-in (`TELEMETRY_HASHCHAIN`), fail-safe.
- *Registry:* ajustar **modelos e trechos de prompt via Script Property** (com log de versão auditável) **sem redeploy**. **Esforço: baixo.**

**Não portados (de propósito):** roteamento **multi-instância** WhatsApp (instance→agente especializado) e **cascata multi-cloud** de 1ª classe (NVIDIA/OpenRouter) — fazem sentido no ERP multi-equipe, mas o Jarvis é assistente pessoal e já tem pool de reserva; revisitar só se virar multi-persona.

**Ordem sugerida:** P8.2 + P8.3 + P8.4 (quick wins) → **P8.1 (AsyncBroker, bandeira)**.

---

## 9. 🛡️ P9 — Hooks de agente & Sandbox (2 artigos de Kanshi Tanaike · 2026-06-29)

> Origem: ingestão no wiki de 2 artigos do Tanaike — *"Guia de Hooks de Agente no Antigravity CLI"* e *"Sandbox para scripts GAS gerados por IA"* (ver `Base_Conhecimento/wiki/sources/2026-06-26_*` e `2026-06-29_*`).

**P9.1 — Sandbox inline do `run_dynamic_script` ✅ (implementado)**
- *Problema:* `SkillsManager.executeScript` faz `new Function(...)` com acesso DIRETO a SpreadsheetApp/DriveApp/UrlFetchApp/MailApp/GmailApp → um script dinâmico (induzido por injeção de prompt) pode **exfiltrar dados, traversal de Drive, phishing** (LLM01→exec, LLM06).
- *Solução (porta do conceito ggsrun):* `Sandbox.js` — `_createSafeWrapper` (clone de protótipo + override só dos métodos sensíveis) + **allowlist** (`SANDBOX_CONFIG`: allowedFileIds/Folders/Emails/Urls + blockedUrls glob). O `executeScript` passa os `_wrapped*` em vez das APIs reais. **Opt-in** via `SANDBOX_DYNAMIC=true`; **fail-open** (erro ao envolver → usa reais). Anti-SSRF baseline sempre ativo. Diag: `testarSandbox`, `configurarSandboxDinamico`, `desligarSandboxDinamico`.
- *Limite conhecido (do artigo):* Serviços Avançados (`Drive.Files.list`) não passam pelo UrlFetchApp → não cobertos. É UMA camada (com Gate P2 + hooks).

**P9.2 — Hooks por tool-call (PreToolUse com matcher + veto) ⏳ (roadmap)**
- O Jarvis tem hooks de **turno** (`_runPreHooks`/`_runPostHooks`). GAP: camada **PreToolUse** por *tool-call* — matcher (regex no nome) + **veto determinístico** antes do `_execTool` (ex.: bloquear `enviarEmail`/`enviarWhatsApp` a destino fora de allowlist sem depender só do P2). *Médio · alto.*

**P9.3 — AfterAgent: censura de credenciais/PII na resposta final ⏳ (roadmap)**
- Pós-hook que redige segredos/PII por regex antes de exibir (caso de uso 5 do artigo). Casa com o `Evals` (que já detecta vazamento de chave). *Baixo · médio.*

**Ordem sugerida:** ✅ P9.1 (sandbox) → P9.3 (censura) → P9.2 (PreToolUse).
