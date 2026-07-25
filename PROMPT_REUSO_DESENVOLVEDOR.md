# 🧩 PROMPT PARA O DESENVOLVEDOR — Reúso das funcionalidades do "Jarvis" em um novo projeto

> **Como usar este documento:** entregue este prompt ao desenvolvedor (humano ou agente de código) **junto com os 5 arquivos de referência** abaixo. Ele é o índice + instrução; os arquivos são a fonte de verdade detalhada.

## 📎 Arquivos de referência (anexar ao prompt)

1. `neumorph-glass-gas-app.md` — memória/histórico de evolução do projeto (decisões, builds b30→b83, lições aprendidas).
2. `DOCUMENTACAO.md` — documentação técnica completa (arquitetura, stack, mapa de ferramentas, segurança, config, deploy).
3. `MELHORIAS_JARVIS.md` — roadmap e melhorias propostas (P2…P5, prioridades).
4. `ROTEIRO_QA_JARVIS.md` — roteiro de QA estruturado (Fases 0–11, o que observar em cada teste).
5. `TESTES_JARVIS.md` — catálogo de testes (o que pedir, qual tool deve rodar, resultado esperado).

---

## 🎯 Sua tarefa

Estude os 5 arquivos e **reutilize os blocos de construção abaixo** no novo projeto. O Jarvis é um **AI Personal OS construído 100% em Google Apps Script + Cloud Firestore + Gemini, sem servidor próprio** — um agente que **age** (não só conversa), com UI premium, memória de longo prazo, integração ao Google Workspace e orquestração de WhatsApp, sob uma camada de **segurança Zero-Trust + confirmação humana** e **guardrails éticos**.

Para cada bloco: **entenda o padrão, copie o módulo correspondente, adapte ao novo domínio.** Não reinvente o que já está resolvido. Mantenha as convenções (ES5/V8, módulos por IIFE `var X = (function(){…})()`, segredos só em Script Properties, deploy via clasp no `/exec`).

---

## 1) Fundação (sempre reutilizar)

- **Backend 100% GAS:** `doGet` serve o app (HtmlService), `doPost` recebe webhooks/API; cliente chama por `google.script.run`. → `Code.js`.
- **Banco Firestore via REST + Service Account (JWT RS256):** wrapper `getDoc/setDoc/createDoc/updateDoc/deleteDoc/listDocs`, com **codificação de number/array** (necessária p/ vetores). → `Firestore.js`. *(Token OAuth cacheado; regras "negar tudo" no cliente.)*
- **Autenticação própria:** cadastro/login/sessão com **SHA-256 ×10.000 + salt**, token com TTL em `localStorage` validado no servidor. → `Auth.js`.
- **UI premium (neumorphism + glassmorphism):** app único modular (`<?!= include() ?>`), tema claro/escuro persistido, responsivo, lightbox, timestamps+latência por balão. → `Index.html` / `Stylesheet.html` / `Javascript.html`.

## 2) Núcleo de IA (motor do agente)

- **Caller central do LLM com cascata de chaves/modelos:** `gerar(payload)` tenta `[chaves FREE (uma ou mais), chave faturamento só se não free-only] × [modelo, fallback]`; **free-first por padrão**; trata 404/429. (Ver §9 — engenharia de custo.) **Function Calling** + **multimodal** (imagem/PDF/áudio) + **embeddings** (`embeddar` com `gemini-embedding-001 @768`). → `Gemini.js`.
  - *Lição:* use `gemini-2.5-flash` (robusto) p/ Function Calling — `flash-lite` retorna `STOP` vazio; `thinkingBudget:0` quebra FC.
- **Motor ReAct / Function Calling:** system prompt **modular** (por seções e por perfil), declarações de ferramentas, loop com `MAX_STEPS`, dispatch central, retry de resposta vazia. → `Jarvis.js`.

## 3) Memória & Conhecimento (RAG)

- **Wiki Drive-RAG (LLM Wiki Pattern):** `raw/` imutável + `wiki/` mantido pela IA (`index.md`/`log.md`); `ler/listar/buscar/escrever/registrarNoLog/ingerirFonte`. → `WikiMemoryService.js`.
- **Busca semântica (embeddings + cosseno):** indexação **resumível** dos trechos do wiki → Firestore `wiki_vetores`; `buscar` por similaridade. → `Semantica.js`.

## 4) Integrações (ferramentas de ação)

- **Google Workspace:** Calendar (criar/editar/excluir eventos), **Gmail avançado** (`pesquisar/ler/enviar/responder/encaminhar/marcar/arquivar/excluir/rotulos/spam/anexos`, por id de mensagem) → `Gmail.js`; Drive; **Tasks** → `Tarefas.js`; **Contatos/People** → `Contatos.js`; **Forms** → `Formularios.js`.
- **WhatsApp (Evolution API / não-oficial):** enviar texto/mídia/áudio/**status**/reação/**presença**/**localização**/**contato**; **agendamento recorrente** (repetirMeses/Dias); resolução **nome→jid**; parser de **webhook inbound**; galeria de mídias. → `WhatsApp.js`.
- **Voz (Cloud TTS via SA):** `sintetizar(texto,{formato:ogg/mp3/wav, voz, velocidade, tom, volume})`, SSML; arquivo salvável no Drive. → `Voz.js`.
- **Web (UrlFetchApp, sem IA):** `lerPagina(url)` (extrai texto/JSON, **anti-SSRF**) + **monitor de mudança** de página. → `Web.js`.
- **Imagem (nano banana / `gemini-2.5-flash-image`):** gerar/editar/compor/iterar/aspect-ratio; salva no Drive, exibe miniatura, envia no WhatsApp. → helper em `Jarvis.js` + `Gemini.gerarImagem`.
- **Skills dinâmicas (Drive-RAG):** `activate_skill / read_skill_resource / run_dynamic_script / invoke_agent` + `criarSkill` (scaffold). → `SkillsManager.js`.
- **Upload classificado + bloqueio de credenciais:** salva anexos em `raw/<categoria>`, classifica (IA+heurística), **barra arquivos com cara de segredo**. → `DriveUploads.js`.

## 5) Autonomia & segundo plano (contornar o limite de 6 min do GAS)

- **Continuação JIT (daisy-chain):** fila no Firestore + gatilho recursivo com orçamento ~4,5 min; tarefas pesadas se reagendam. → `Jobs.js`.
- **Tick único compartilhado (a cada 15 min):** dispara tarefas agendadas + monitor de Gmail + mensagens de WhatsApp agendadas + monitor de páginas web + limpezas. → `Agenda.js` (`executarTarefasAgendadas`).
- **Autonomia por evento** (monitorar Gmail) → `Monitor.js`. **Autonomia por objetivo** (planeja→confirma→executa em 2º plano→sintetiza) → `Objetivos.js`.

## 6) Segurança & governança (Zero-Trust + human-in-the-loop) — **não opcional**

- **Gating por proprietário:** ações de escrita/externas restritas a `OWNER_EMAIL` / `WHATSAPP_OWNER_NUMBER`; demais usuários = leitura/conversa.
- **Confirmação P2 de ações sensíveis:** a ferramenta devolve `{status:'confirmacao_requerida', resumo}` e só executa após "sim"; **cache dos argumentos** no preview p/ recuperar args que o modelo esqueça na re-chamada.
- **Ponte de autorização (terceiros):** terceiro pede ação restrita → dono aprova/nega → executa como dono → entrega ao solicitante; com **acompanhamento** (re-lembra o dono e tranquiliza o contato se demorar). → `Autorizacoes.js`. **Modo secretária** (rascunho+aprovação) → `Secretaria.js`.
- **Outros:** bloqueio de credenciais em anexos; **NUNCA responder em grupos de WhatsApp** (risco de ban); webhook protegido por secret; **anti-SSRF**; segredos **só em Script Properties**.

## 7) Guardrails éticos (derivados de papers — manter no novo projeto)

- **Anti-ban / cadência humana:** throttle de envios (limite por minuto/hora + intervalo mínimo variável) — evita assinatura de bot. → `WhatsApp._throttle`.
- **Anti-fofoca/difamação (Regra 12):** nunca inventar fatos/avaliações negativas sobre pessoas reais; não repassar boato não verificado.
- **Bem-estar/segurança (Regra 13, prioridade máxima):** em crise/sofrimento/ideação suicida → acolher, incentivar ajuda humana/profissional, informar canais (Brasil: **CVV 188 / SAMU 192**); nunca instruir dano nem desencorajar ajuda.
- **Transparência/não-manipulação/minimização de dados (Regra 14):** assumir que é IA com limites; não fingir sentimentos; não criar dependência; guardar só o necessário.
- **Degradação graciosa:** falha de dependência (quota/Firestore/TTS/WhatsApp) → **aviso claro + o que ainda funciona**, em vez de erro cru. → `_erroAmigavel` em `Code.js`.

## 8) Operação, QA e armadilhas (replicar a disciplina)

- **Deploy:** `clasp push -f` → `clasp deploy -i <id> -d "…"`; **sempre testar no `/exec`** (a URL `/dev` serve cache antigo). `getService().getUrl()` é **não-confiável** — fixe a `/exec`.
- **Diagnósticos no editor:** padrão de funções `diag*`/`testar*` (ex.: `diagGemini`, `testarFirestore`, `statusJarvis` painel de saúde, `diagAntiBan`). Replique para cada dependência.
- **QA estruturado:** siga o modelo de **Fases 0–11** (`ROTEIRO_QA_JARVIS.md` + `TESTES_JARVIS.md`): ambiente → UI → leitura → multimodal → imagem → Workspace → skills → confirmação/saída → 2º plano → proatividade → inbound → segurança.
- **Resiliência a quota:** tenha **recursos que NÃO usam IA** (Gmail, agenda, WhatsApp, voz, web) funcionando mesmo com o LLM bloqueado por teto de gasto.
- **Ingestão de PDFs escaneados:** se faltar OCR (sem tesseract/python/pdftoppm), use **OCR nativo do Windows** (`Windows.Data.Pdf` + `Windows.Media.Ocr` via PowerShell) — técnica registrada na memória.

---

## 9) Blocos recentes (2026-06) — voz no celular, segundo cérebro, dashboard acionável, custo

> Capacidades adicionadas depois da v1. Mesmo princípio: **entenda o padrão, copie o módulo, adapte.**

- **🔊 Voz no Android (web → celular fala), sem app nativo:** o backend **sintetiza** o áudio (Cloud TTS, voz premium Chirp3-HD), salva num arquivo de **ID estável** no Drive (sobrescreve o conteúdo via Drive media upload PATCH com `ScriptApp.getOAuthToken()` → URL fixa) e dispara um **webhook do MacroDroid**, que toca o áudio no aparelho. *Lições:* o player interno do MacroDroid pode sair abafado em alguns OEMs → use o **canal Alarme**; a URL precisa ser **fixa** (ID estável) p/ evitar magic-text frágil; um **disparo determinístico** (rota própria + pós-passo) garante a fala **independente** de o LLM chamar a tool. → `_falarNoCelular` / `_controlarDispositivo(acao:'falar')` em `Jarvis.js` + `Voz.js`.
- **🔔 Alertas de voz agendados (precisão de minuto):** Script Property como store + **gatilho dedicado de 1 min** (separado do tick de 15 min) que dispara a fala no horário; conteúdo **fixo ou dinâmico** (gera via `Jarvis.ask` no disparo); auto-remove o gatilho quando não há alertas. → `AlertasVoz.js`.
- **📩 Avisos de contato falados com privacidade:** quando um contato escreve, o celular anuncia em voz — usando o **nome salvo** (People API: número→nome) e **voz por gênero** (heurística de nome/parentesco); **discrição de assunto sensível** (regex de dinheiro/senha/saúde/jurídico/RH/localização/íntimo → fala só *quem* mandou, sem expor o conteúdo). *Princípio:* na dúvida, esconde. → `_avisarContatoNoCelular` / `Contatos.nomeDe` / `_generoPorNome` / `_assuntoSensivel`.
- **🧠 Segundo cérebro — captura de conhecimento:** `capturarConhecimento({fonte})` lê uma URL (**url_context**) ou texto, extrai um **cartão estruturado** (título/resumo/tags/insights/entidades/conexões) com **saídas estruturadas (`responseSchema`)** + thinking, e arquiva na wiki por categoria → fica pesquisável por `buscarConhecimento`. → `Jarvis.js` (tool) + `Gemini.lerUrl`/`gerar` + `WikiMemoryService.escreverWiki`.
- **🎛️ Dashboard ACIONÁVEL (cards que agem, não só leem):** mini-framework no front — `act-card` (`data-cardkey`/`data-act`/`data-id`) + registry `IC_REG[card][act]={fn}` + `wireActCard` (delegação de clique) + funções `ui*` no servidor **gated por sessão+owner** (`getSessionUser(token)`). *Lição crítica:* chamar a função do servidor por nome dinâmico exige `runner[fn].apply(runner, args)` — o `this` DEVE ser o runner do `google.script.run`. → `Javascript.html` + `Code.js` (`uiTarefa*`, `uiAutorizar/uiNegar`, `uiPendencia*`, `uiAlerta*`, `uiMonitor*`).
- **💸 Engenharia de custo (free tier first):** a cascata usa **as chaves FREE primeiro** (e várias delas, que se revezam no 429); a paga é **último recurso** — ou **excluída por completo** com `GEMINI_FREE_ONLY=true`. Um seletor central (`_keyDireta`) aplica a regra também nas chamadas **diretas** (embeddings, grounding, url_context, imagem), que antes furavam a cascata e batiam no pago. Modelo `gemini-2.5-flash` (free) e thinking ajustável. → `Gemini.js` (`_tentativas`/`_keyDireta`) + `modoEconomiaGemini()`/`permitirFaturamentoGemini()`/`pingGemini()`.
- **🛡️ Idempotência (sem ação em dobro):** dedup de **webhook do WhatsApp** por id de mensagem (CacheService) e de **fala/alerta** por hash/carimbo — webhooks reenviados (retry da Evolution) e gatilhos repetidos não duplicam respostas/áudio.

---

## ✅ Critérios de aceite (o novo projeto deve)

1. Rodar 100% em GAS + Firestore (SA/JWT), sem servidor próprio.
2. Ter caller de LLM com cascata + Function Calling + degradação graciosa.
3. Reutilizar memória RAG (wiki) e, se houver base, busca semântica.
4. Implementar Zero-Trust (gating por owner) + confirmação P2 nas ações sensíveis/externas.
5. Carregar os **guardrails éticos** (anti-fofoca, bem-estar/crise, transparência, anti-ban).
6. Ter diagnósticos por dependência + um roteiro de QA por fases.
7. Manter segredos só em Script Properties e deploy/teste no `/exec`.
8. **Engenharia de custo:** free tier primeiro e opção `*_FREE_ONLY` (zero faturamento) — inclusive nas chamadas diretas (embeddings/grounding/url_context/imagem), não só na cascata.
9. **Idempotência** em entradas repetidas (webhooks/gatilhos) — nenhuma ação ou resposta em dobro.
10. **Segurança como arquitetura (OWASP Top 10 for LLMs):** mapeie cada defesa a uma ameaça nomeada (LLM01 injeção, replay attack, SSRF, excessive agency). Doc-modelo: `SEGURANCA_OWASP_JARVIS.md`.
11. **Sandbox de código dinâmico (`Sandbox.js`):** ao executar JS gerado/induzido (`new Function`), passe APIs **envolvidas** (`_wrapped*`) com allowlist (IDs/e-mails/URLs glob) em vez das nativas — `createSafeWrapper` clona o protótipo e sobrescreve só o sensível. Opt-in, fail-open.
12. **Escala serverless sem Cloud Run (`AsyncBroker.js`):** "1-second timeout hack" (loopback à própria `/exec` com `timeoutSeconds:1`) + token-bucket + dead-letter + reducer → vence o limite de 6 min do GAS. Auto-continuação para jobs longos (ex.: reindexação RAG).
13. **Anti-falha-silenciosa (`Heartbeat.js`):** cada gatilho "bate o coração"; um vigia re-arma e avisa o dono. O dashboard é o observador fora dos gatilhos.
14. **Hardening de borda + qualidade:** webhooks assinados, rate limiting no `/exec`, crachás efêmeros (`A2ABadge.js`), audit log com hash-chain SHA-256; **Evals de comportamento** (`Evals.js`) que conferem o `toolTrace` real.

> **Princípio-guia:** um agente que **age com segurança e responsabilidade** — reversível por padrão (P2), transparente nas falhas (degradação graciosa), justo com pessoas (anti-fofoca) e cuidadoso com quem está vulnerável (bem-estar). Copie os módulos, preserve os guardrails.
