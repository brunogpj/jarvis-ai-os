# Soft Web App Aplication — Documentação Técnica

> **Jarvis · AI Personal OS** — aplicação web premium (neumorphism + glassmorphism) com login real, **assistente de IA orquestrador**, memória cumulativa (wiki), integração ao Google Workspace, **orquestração do WhatsApp** (ler/enviar, ouvir áudios, ver imagens, responder em voz, agendar, status, localização, contato), **geração de imagem**, **síntese de voz em arquivo**, **leitura/monitoramento de páginas web** e **busca semântica** — construída **100% em Google Apps Script + Firestore**, sem servidor próprio.

**Versão do documento:** 2026-06-06 (build **b73** · deploy **@73**) · **Projeto GAS:** App_Web_Aplication (`<SCRIPT_ID>`)
**URL /exec atual:** `…/macros/s/<DEPLOYMENT_ID>/exec`

---

## 1. Propósito geral

Aplicação de classe comercial que une **UI premium** a um **assistente de IA pessoal ("Jarvis")** que **age** — não só conversa. O usuário faz login, conversa, anexa documentos (imagem/PDF/CSV/áudio), recebe respostas com visão/OCR/transcrição, e o sistema mantém **memória de longo prazo** (wiki no Drive), **histórico persistente** e **orquestra o WhatsApp pessoal** com **camada de segurança Zero-Trust + confirmação humana**. Todo o front e back rodam em Apps Script; Firestore é o banco.

**Perfis de acesso:**

- **Usuário comum (logado):** conversa, anexa arquivos, visão/OCR, histórico próprio, leitura da wiki, busca web/semântica, e **solicitação de autorização** ao proprietário.
- **Proprietário (`OWNER_EMAIL`):** tudo acima + Google Workspace completo (Calendar, Gmail avançado, Drive, Tasks, Contatos, Forms), escrita na wiki, skills/subagentes, scripts dinâmicos, **WhatsApp completo**, geração de imagem/áudio, monitoramento web, criação de skills, autonomia (agenda/monitor/objetivos).

---

## 2. Arquitetura

```
Navegador (HtmlService)                    Google Apps Script (backend, 1 projeto)
┌───────────────────────────┐   google.     ┌──────────────────────────────────────────────┐
│ Index.html  (estrutura)   │   script.run  │ Code.js     → doGet/doPost, askIA, auth,       │
│ Stylesheet.html (CSS)     │ ───────────►  │               histórico, webhook WhatsApp      │
│ Javascript.html (UI/lógica)│ ◄─────────── │ Auth.js     → login/sessão (hash+salt)         │
└───────────────────────────┘   (objeto)    │ Jarvis.js   → motor ReAct / Function Calling   │
                                            │ Gemini.js   → caller central + embeddings      │
                                            │ Firestore.js→ wrapper REST (SA/JWT)            │
                                            │ WikiMemoryService.js · Semantica.js (RAG)      │
                                            │ SkillsManager.js → skills Drive-RAG + criar    │
                                            │ DriveUploads.js → salvar + classificar         │
                                            │ WhatsApp.js · Gmail.js · Voz.js · Web.js       │
                                            │ Tarefas.js · Contatos.js · Formularios.js      │
                                            │ Jobs.js · Agenda.js · Monitor.js · Objetivos.js│
                                            │ Autorizacoes.js · Secretaria.js                │
                                            └───────────┬────────────────────────────────────┘
              ┌─────────────┬───────────────┬──────────┼──────────┬───────────────┬──────────┐
              ▼             ▼               ▼          ▼          ▼               ▼          ▼
        Cloud Firestore  Gemini API    Google Drive  Workspace  Evolution API  Cloud TTS   Web
        (usuários,       (2.5-flash,   (raw/+wiki/   (Calendar, (WhatsApp:      (voz OGG/   (UrlFetch:
         sessões,         multimodal,   +uploads+     Gmail,     QR,enviar,      MP3/WAV     ler/monitorar
         conversas,       FC, imagem,   assets +      Tasks,     ler,status,     via SA)     páginas)
         jobs,            embeddings)   vetores)      People,    webhook,
         objetivos,                                   Forms)     localização)
         autorizações,
         tarefas,
         msgs_agendadas,
         web_monitores,
         wiki_vetores)
```

- **Frontend:** HtmlService, app único modular (`<?!= include() ?>`).
- **Backend:** ~23 arquivos `.gs/.js` no mesmo projeto; cliente chama por `google.script.run`.
- **Banco:** Cloud Firestore (Native, São Paulo) via REST + **service account** (JWT RS256).
- **IA:** Gemini com **Function Calling** (loop ReAct) + **multimodal** (imagem/PDF/áudio) + **embeddings** (busca semântica). Caller central com **cascata de chaves/modelos**.
- **WhatsApp:** Evolution API (Railway, Baileys — não-oficial) via `UrlFetchApp` — saída + webhook de entrada.
- **Voz:** Google Cloud Text-to-Speech (OGG/MP3/WAV, via SA).

---

## 3. Stack e arquivos (26 no total)

| Arquivo                            | Responsabilidade                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| `Code.js`                          | `doGet` (serve app), `doPost` (webhook WhatsApp + A2A), `include`, `askIA` (anexo→pré-transcrição/Drive/credencial→Jarvis→persistência; só arquiva no Drive sob pedido explícito), histórico, `ingerirAnexoWiki`, painel WhatsApp, `configurarBotInbound(auto                                                                                                               | secretaria | off)`, `diagWebhookJarvis`, `testarInbound`, setups. |
| `Auth.js`                          | Cadastro/login/logout/sessão/`updateProfile`. SHA-256 ×10.000 + salt; token 7 dias.                                                                                                                                                                                                                                                                                         |
| `Firestore.js`                     | Wrapper REST via SA: `getDoc/setDoc/createDoc/updateDoc/deleteDoc/listDocs`. Codifica number/array (vetores).                                                                                                                                                                                                                                                               |
| `Gemini.js`                        | **Caller central** `gerar(payload)` com cascata; `gerarImagem(prompt)`; **`embeddar(texto)`** (gemini-embedding-001 @768). Diagnósticos.                                                                                                                                                                                                                                    |
| `Jarvis.js`                        | **Motor do agente**: system prompt (modos + WhatsApp + mídia + atendimento a terceiros), declarações de tools, loop ReAct, **gate de confirmação P2**, gating por OWNER, helpers de Workspace/imagem/áudio/arquivo.                                                                                                                                                         |
| `WikiMemoryService.js`             | Memória cumulativa no Drive: `lerWiki/listarWiki/buscarNoWiki`(keyword)`/escreverWiki/registrarNoLog/ingerirFonte`.                                                                                                                                                                                                                                                         |
| `Semantica.js`                     | **Busca semântica (RAG, P5.1)**: `indexar` (resumível) embeda trechos do wiki → Firestore `wiki_vetores`; `buscar` por cosseno. Editor: `indexarWikiSemantico()`, `testarBuscaSemantica()`.                                                                                                                                                                                 |
| `SkillsManager.js`                 | Skills dinâmicas (Drive-RAG): descoberta recursiva (cache 1h), `activate_skill`/`read_skill_resource`/`run_dynamic_script`/`invoke_agent` + **`criarSkill`** (scaffold de SKILL.md).                                                                                                                                                                                        |
| `DriveUploads.js`                  | Salva anexos em `raw/<categoria>`, classifica (IA + heurística), detecta credenciais (incl. tokens Telegram/bearer/sk-).                                                                                                                                                                                                                                                    |
| `WhatsApp.js`                      | Conector Evolution: `enviar`/`enviarMidia`/`enviarAudio`, instâncias/QR/estado, `findChats`/`findMessages`, `postarStatus`, `baixarMidiasConversa` (galeria), `reagir`, `enviarPresenca`, **`enviarLocalizacao`**, **`enviarContato`**, **agendamento** (`agendarEnvio`/`listarAgendadas`/`cancelarAgendada`/`enviarAgendadasDevidas`), webhook, `_resolverJid` (nome→jid). |
| `Gmail.js`                         | **Pacote Gmail avançado** (nativo, sem IA): `pesquisar`, `ler`, `enviar`, `responder`, `encaminhar`, `marcar`, `arquivar`, `excluir`, `rotulos`, `spam`, `anexos`. Opera por id de mensagem.                                                                                                                                                                                |
| `Voz.js`                           | `sintetizar(texto,{formato,voz,velocidade,tom,volume})` → OGG/MP3/WAV (Cloud TTS, SSML); `listarVozes`. Comando `/voz`.                                                                                                                                                                                                                                                     |
| `Web.js`                           | **Web (UrlFetch, sem IA)**: `lerPagina(url)` (extrai texto/JSON, anti-SSRF), monitor de mudança (`monitorar`/`listar`/`parar`/`verificarMudancas`).                                                                                                                                                                                                                         |
| `Tarefas.js`                       | Google **Tasks**: `listar/adicionar/concluir/deletar`.                                                                                                                                                                                                                                                                                                                      |
| `Contatos.js`                      | Google **People** (contacts.readonly): `buscar/listar/telefoneDe`.                                                                                                                                                                                                                                                                                                          |
| `Formularios.js`                   | Google **Forms**: `criar(titulo,desc,perguntas)`, `respostas`.                                                                                                                                                                                                                                                                                                              |
| `Jobs.js`                          | **Continuação JIT (daisy-chain)**: fila Firestore (`jobs`), gatilho recursivo (~4,5 min), tipos `ingestao`/`loteWhatsApp`.                                                                                                                                                                                                                                                  |
| `Agenda.js`                        | **Tick compartilhado** `executarTarefasAgendadas` (15 min): tarefas agendadas + Monitor + msgs WhatsApp agendadas + monitor web + limpeza de autorizações/secretária. Coleção `tarefas`.                                                                                                                                                                                    |
| `Monitor.js`                       | **Autonomia por evento**: monitora Gmail (filtro) e aciona o Jarvis ao chegar e-mail.                                                                                                                                                                                                                                                                                       |
| `Objetivos.js`                     | **Autonomia por OBJETIVO**: planeja (JSON ≤6 passos), confirma, executa em 2º plano (Jobs, resumível), sintetiza. Coleção `objetivos`.                                                                                                                                                                                                                                      |
| `Autorizacoes.js`                  | **Ponte de autorização** (human-in-the-loop p/ terceiros): `solicitar/listar/autorizar/negar/limparExpiradas`. Coleção `autorizacoes`.                                                                                                                                                                                                                                      |
| `Secretaria.js`                    | **Modo secretária**: rascunha resposta + registra pendência p/ aprovação do dono. Coleção `secretaria`.                                                                                                                                                                                                                                                                     |
| `Index/Stylesheet/Javascript.html` | UI completa (login, chat, composer 🎤, sidebar, painel WhatsApp, modais, lightbox, timestamps/latência com data).                                                                                                                                                                                                                                                           |
| `appsscript.json`                  | Manifesto + OAuth scopes.                                                                                                                                                                                                                                                                                                                                                   |

---

## 4. Capacidades do Jarvis (mapa de ferramentas)

> Todas executam no servidor via Function Calling. 🔑 = somente proprietário.

### 4.1 Memória & Conhecimento

- **Wiki (keyword):** `lerWiki` · `listarWiki` · `buscarNoWiki` · 🔑`escreverWiki` · 🔑`registrarNoLog` · 🔑`ingerirFonte`.
- **Busca semântica (RAG):** `buscarSemantico(consulta)` — encontra por **significado** (embeddings + cosseno). _Requer indexação prévia (`indexarWikiSemantico`) — pendente de quota._

### 4.2 Google Workspace 🔑

- **Calendar:** `criarEventoCalendar` · `listarProximosEventos` · `editarEventoCalendar` · `excluirEventoCalendar` (P2).
- **Gmail básico:** `listarEmailsNaoLidos` · `criarRascunhoEmail` (com anexo do Drive).
- **Gmail avançado:** `pesquisarEmails` · `lerEmail` · `enviarEmail` (P2) · `responderEmail` (P2) · `encaminharEmail` (P2) · `marcarEmail` · `arquivarEmail` · `excluirEmail` (P2) · `gerenciarRotulosEmail` · `verificarSpam` · `gerenciarAnexosEmail` (listar/baixar p/ Drive).
- **Drive:** `criarPastaDrive`.
- **Tarefas (Tasks):** `listarTarefas` · `adicionarTarefa` · `concluirTarefa` · `excluirTarefa`.
- **Contatos (People):** `buscarContato` · `listarContatos`.
- **Formulários (Forms):** `criarFormulario` · `verRespostasFormulario`.

### 4.3 WhatsApp 🔑 (Evolution)

- **Mensagens:** `enviarWhatsApp` (P2) · `enviarAudioWhatsApp` (TTS→PTT, P2) · `enviarWhatsAppEmLote` (P2, 2º plano) · `enviarArquivoWhatsApp` (P2) · `lerMensagensWhatsApp` · `ouvirAudiosWhatsApp` · `verImagensWhatsApp`.
- **Pro:** `postarStatusWhatsApp` (status/stories, P2) · galeria de mídias (`baixarMidiasConversa`) · `reagirWhatsApp` · presença ("digitando").
- **Novos:** `enviarLocalizacaoWhatsApp` (P2) · `enviarContatoWhatsApp` (P2) · **agendamento** `agendarMensagemWhatsApp` (P2) / `listarMensagensAgendadas` / `cancelarMensagemAgendada`.
- **Conexão:** `listarInstanciasWhatsApp` · `statusInstanciaWhatsApp` · `listarConversasWhatsApp`.
- Aceitam **nome do contato/grupo** (resolvido p/ jid) ou número.

### 4.4 Mídia 🔑

- **Imagem:** `gerarImagem(prompt, usarUltimaImagem?, aspecto?, enviarPara?, legenda?)` — `gemini-2.5-flash-image` (nano banana). Gera, **edita/compõe** (image-to-image da imagem anexada), edita iterativamente, transferência de estilo, "pincel mágico" por descrição, variações. Proporção via `aspecto`. _(NÃO faz vídeo/GIF/upscaling.)_
- **Áudio:** `gerarAudio(texto, formato, voz, velocidade, tom, volume)` — TTS → **arquivo no Drive** (mp3/wav/ogg, SSML), anexável a e-mail. Comando `/voz` p/ ouvir/escolher vozes.

### 4.5 Web (todos os usuários) 🔑(monitor)

- `pesquisarWeb(consulta)` — busca atual via **grounding do Google Search** (fontes).
- `lerPagina(url)` — extrai o texto/JSON de uma página (HTTP estático; anti-SSRF).
- `monitorarPagina(url, descricao)` / `listarMonitoresPagina` / `pararMonitorPagina` — avisa no WhatsApp quando a página muda (tick 15 min, hash MD5, sem IA).

### 4.6 Orquestração / Skills 🔑

`activate_skill` · `read_skill_resource` · `run_dynamic_script` (P2) · `invoke_agent` (subagente síncrono) · **`criarSkill(nome, descricao, instrucoes)`** (cria esqueleto de habilidade).

### 4.7 Proatividade & autonomia 🔑

- `agendarTarefa` + `listarTarefasAgendadas` / `cancelarTarefaAgendada` (recorrentes, entrega no WhatsApp).
- `monitorarGmail` + `pararMonitorGmail` (autonomia por evento).
- `definirObjetivo` + `listarObjetivos` / `cancelarObjetivo` (goal-driven, planeja+confirma+executa em 2º plano).
- **Tick único (15 min):** Agenda + Monitor Gmail + msgs WhatsApp agendadas + monitor de páginas web + limpeza de autorizações/secretária.

### 4.8 Ponte de autorização (human-in-the-loop) — todos

`solicitarAutorizacao` (terceiro pede ação restrita → dono recebe 🔐 e aprova/nega no app) · 🔑`listarAutorizacoes`/`autorizarPedido`/`negarPedido`. Execução **discreta e humanizada** (o contato não percebe a aprovação interna).

### 4.9 Modo secretária 🔑

`configurarBotInbound("secretaria")`: o bot rascunha respostas e registra pendências; o dono aprova. Tools `listarPendentes`/`responderPendente`/`ignorarPendente`. _(Modo padrão é `auto`: responde conversa normal na hora e só escala ações sensíveis.)_

### 4.10 Recursos do chat (app)

Multimodal (imagem/PDF/CSV/áudio), microfone 🎤, geração de imagem (lightbox), **timestamps + data + latência** por balão, histórico persistente (nova/abrir/excluir), bloqueio de credenciais, anexo→Drive sob pedido.

### 4.11 Bot de WhatsApp (entrada — `doPost`)

Webhook Evolution → valida `WHATSAPP_WEBHOOK_SECRET`, **IGNORA grupos/broadcast/newsletter** (regra dura), allowlist opcional, **Zero-Trust** (só `WHATSAPP_OWNER_NUMBER` tem poderes; terceiros = leitura + ponte de autorização). Texto→texto; áudio→voz (espelho); imagem→descreve.

### 4.12 A2A (Agent-to-Agent)

`doPost` com `A2A_API_TOKEN` → modo leitura (agente não-proprietário).

---

## 5. Modelos de IA

| Camada         | Chave            | Modelo (default)                     | Observação                                                    |
| -------------- | ---------------- | ------------------------------------ | ------------------------------------------------------------- |
| Texto/FC       | `GEMINI_API_KEY` | **`gemini-2.5-flash`** (robusto)     | FC confiável; `flash-lite` retornava `STOP` vazio / alucinava |
| Imagem         | `GEMINI_API_KEY` | `gemini-2.5-flash-image`             | nano banana (`GEMINI_IMAGE_MODEL`)                            |
| **Embeddings** | `GEMINI_API_KEY` | **`gemini-embedding-001`** @768 dims | `GEMINI_EMBED_MODEL`/`GEMINI_EMBED_DIMS`; cosseno (P5)        |
| Voz            | service account  | Cloud TTS `pt-BR-Neural2-B`          | OGG/MP3/WAV                                                   |

- **Ordem:** `GEMINI_ORDER` = `billing_first` (padrão) ou `free_first`. Cascata multi-modelo por chave.
- **Alternar:** `usarModeloRobusto()` (atual) vs `usarModeloRapido()`.

---

## 6. Segurança

- **Senhas:** SHA-256 ×10.000 + salt; hash nunca vai ao cliente. **Sessão:** token TTL 7 dias.
- **Zero-Trust por proprietário:** Workspace, Gmail avançado, escrita na wiki, scripts, WhatsApp, imagem/áudio, monitor web e criação de skills são **owner-only**. Usuário não-dono: conversa/lê/pesquisa + pode **solicitar autorização** (validado no QA Fase 11).
- **Confirmação (P2):** ações sensíveis exigem **confirmação explícita do dono no chat** — `enviarWhatsApp`, `enviarAudioWhatsApp`, `enviarWhatsAppEmLote`, `enviarArquivoWhatsApp`, `postarStatusWhatsApp`, `enviarLocalizacaoWhatsApp`, `enviarContatoWhatsApp`, `agendarMensagemWhatsApp`, `enviarEmail`, `responderEmail`, `encaminharEmail`, `excluirEmail`, `excluirEventoCalendar`, `run_dynamic_script`, `gerarImagem` com envio. Sem `confirmado:true` → `{status:'confirmacao_requerida', resumo}`. Contextos autônomos (Agenda/Monitor/Jobs/inbound) são pré-autorizados.
- **NUNCA em grupos:** o bot ignora `@g.us`/`@broadcast`/`@newsletter` (após um ban real em grupo).
- **Bloqueio de credenciais** em anexos (chaves, service_account, tokens Telegram/bearer/sk-, .pem/.key).
- **Anti-SSRF** no `lerPagina`/monitor (bloqueia localhost/IPs privados/não-http).
- **Webhook** protegido por `WHATSAPP_WEBHOOK_SECRET` (`?wh=`). **Firestore** "negar tudo" p/ cliente; backend por SA.
- **Segredos:** sempre em **Script Properties**, nunca no código/Git.

---

## 7. Configuração (Script Properties)

| Propriedade                                                                                 | Função                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `FIRESTORE_SA`                                                                              | JSON da service account (Firestore + TTS)   |
| `GEMINI_API_KEY` / `GEMINI_API_KEY_FALLBACK`                                                | chaves Gemini                               |
| `GEMINI_MODEL` / `GEMINI_IMAGE_MODEL` / `GEMINI_EMBED_MODEL` / `GEMINI_EMBED_DIMS`          | modelos (texto / imagem / embedding / dims) |
| `GEMINI_ORDER`                                                                              | `billing_first` (padrão) ou `free_first`    |
| `OWNER_EMAIL`                                                                               | e-mail do proprietário                      |
| `BASE_ROOT_ID` / `WIKI_DRIVE_ID` / `RAW_DRIVE_ID` / `BASE_CONHECIMENTO_DRIVE_ID`            | pastas base / wiki / raw / skills           |
| `A2A_API_TOKEN`                                                                             | token A2A                                   |
| `EVOLUTION_API_URL`/`_KEY`/`_INSTANCE_NAME`, `EVOLUTION_INSTANCES`                          | Evolution/WhatsApp                          |
| `WHATSAPP_OWNER_NUMBER`, `WHATSAPP_ALLOWED`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_BOT_MODE` | bot WhatsApp                                |
| `TTS_SA` (opcional), `TTS_VOICE`, `TTS_LANG`                                                | voz                                         |

**Escopos OAuth:** `script.external_request`, `script.scriptapp`, `drive`, `calendar`, `https://mail.google.com/`, `tasks`, `contacts.readonly`, `forms`.

**Setups (editor):** `configurarJarvis()`, `configurarBaseConhecimento('<BASE_ROOT_ID>')`, `configurarModelosGemini()`, `usarModeloRobusto()`, `configurarVoz()`, `configurarWhatsApp(...)`, `configurarA2A()`, `configurarBotInbound('auto'|'secretaria'|'off')`.
**Diagnóstico:** `diagGemini()`, `testarVoz()`, `testarFirestore()`, `testarWikiMemoryService()`, `listarSkillsJarvis()`, `apontarWebhookJarvis()`, `autorizarGatilhos()`, `testarJobs()`, `testarGmailAvancado()`, `testarLerPagina(url)`, `listarModelosEmbedding()`, `diagSemantica()`, `indexarWikiSemantico()`.

---

## 8. Deploy (clasp) — e armadilhas

```bash
clasp push -f                                   # envia o código (HEAD / URL /dev)
clasp deploy -i <deploymentId> -d "descrição"   # atualiza a implantação versionada (/exec)
```

- **Use sempre a URL `/exec`** versionada. A `/dev` pode servir cache antigo. **`ScriptApp.getService().getUrl()` é não-confiável aqui** — o `/exec` canônico está fixado em `WhatsApp._execUrl()`.
- Após `clasp push`, rode `clasp deploy -i <id>`. Webhook do WhatsApp aponta para o `/exec`; se mudar, repon­te (`apontarWebhookJarvis()`).
- **Desenvolvimento do projeto:** feito via **clasp + assistente de código** (este ambiente), com git na máquina local — não há edição de código de dentro do próprio app (por segurança).

---

## 9. Design (UI/UX)

Glassmorphism nas camadas flutuantes + Neumorphism nos controles. Sidebar recolhível, tema claro/escuro persistido, responsivo, lightbox, drag-and-drop, timestamps (com data quando não é hoje) + latência por balão. Base teórica na wiki.

---

## 10. Verificação / testes

**QA estruturado completo (Fases 0→11) validado** — ver `ROTEIRO_QA_JARVIS.md` e `TESTES_JARVIS.md`. Cobertura: ambiente, UI, cérebro/leitura, multimodal, imagem, Workspace, skills/subagentes, confirmação P2 + WhatsApp saída, 2º plano (Jobs/Objetivos), proatividade, **WhatsApp inbound** (texto/áudio→voz/imagem, grupos blindados, escalonamento natural, ponte de autorização), **Histórico + Segurança/Zero-Trust** (não-dono recusado, credencial bloqueada, webhook com secret).

---

## 11. Pendente de quota (teto de gasto Gemini)

O projeto Gemini atingiu o **teto de gasto mensal** (`429 — monthly spending cap`). Tudo que usa o modelo está **temporariamente bloqueado** até ajustar em **https://ai.studio/spend** (ou reset mensal). Afeta:

- **Busca semântica (P5):** indexação (`indexarWikiSemantico`) e `buscarSemantico` — código pronto, aguarda quota.
- **Geração/edição de imagem** (nano banana).
- **Análise via IA:** transcrição de áudio, resumo/sentimento de conversas, síntese multi-fonte da web, planejamento de objetivos.

**Funciona SEM quota Gemini** (testável agora): pacote **Gmail**, **gerarAudio** (Cloud TTS), **WhatsApp** (agendar/localização/contato/status/galeria/reação), **Web** (lerPagina/monitor), **criarSkill**, Workspace (Calendar/Tasks/Contatos/Forms), histórico, login.

---

## 12. Limitações conhecidas e roadmap

- **Limite de 6 min do GAS:** mitigado pela continuação JIT (`Jobs.js`) — ingestão/lotes/objetivos/indexação rodam em 2º plano e se reagendam.
- **Inviável no GAS (declarado):** navegação web autônoma (sem navegador/JS), automação online (login/compras/redes), edição de áudio (cortar/mixar/denoise), geração de música, integração Git (sem shell), scraping de páginas que dependem de JS.
- **Não implementado por segurança:** auto-modificação de código/skills; criação/moderação de grupos no WhatsApp (risco de ban); HTTP genérico irrestrito (SSRF).
- **Áudio `.m4a`** do celular pode falhar no Gemini → preferir OGG/WhatsApp.
- **Microfone no navegador** bloqueado pelo sandbox → fallback p/ seletor de arquivo.
- **Roadmap (`MELHORIAS_JARVIS.md`):** P5 busca semântica (indexação assim que houver quota → integrar ao `buscarNoWiki` com fallback; RRF híbrido; reindex automático na escrita); P3 servidor MCP; modo "profundo" (gemini-2.5-pro).
- **Pendências de segurança:** rotacionar segredos expostos no desenvolvimento (SA, Evolution apikey) e **remover páginas com credencial vazada** (openclaw: tokens Telegram/gateway).

---

## Segurança, escala e confiabilidade (P7–P9, 2026-06)

- **Segurança Zero-Trust mapeada ao OWASP Top 10 for LLMs** (`SEGURANCA_OWASP_JARVIS.md`): prompt injection (LLM01, guardrails dado≠instrução), replay attack (idempotência por dedup), SSRF (anti-metadados de nuvem), excessive agency (owner-gating + P2 + ponte de autorização), regra "a IA nunca fabrica resultado de ferramenta".
- **Sandbox de código dinâmico (`Sandbox.js`, P9):** `run_dynamic_script` roda com APIs envolvidas (`_wrapped*`) + allowlist (`SANDBOX_CONFIG`: allowedFileIds/Folders/Emails/Urls + blockedUrls glob), bloqueando exfiltração/phishing/traversal. Opt-in (`SANDBOX_DYNAMIC`), fail-open. Limite: Serviços Avançados burlam o filtro de URL.
- **Hardening de borda (P7.4):** webhooks **assinados** (`MACRODROID_WEBHOOK_SECRET` via `&sig=`; `WHATSAPP_WEBHOOK_SECRET` via `?wh=`), **rate limiting** no `doPost` (`_rateLimit`, fail-open), **crachás efêmeros** (`A2ABadge.js`).
- **Escala serverless (`AsyncBroker.js`, P8.1):** "1-second timeout hack" (loopback à própria `/exec`, `timeoutSeconds:1`) + fila Firestore + token-bucket (`BROKER_MAX_CONCURRENT`) + dead-letter + reducer + MapReduce multi-agente. Vence o limite de 6 min **sem Cloud Run**. 1º uso: `brokerReindexRAG` (reindexação RAG encadeada e incremental). Rota `__broker` no `doPost`, autenticada por HMAC (`BROKER_SECRET`).
- **Anti-falha-silenciosa (`Heartbeat.js`, P7.1b):** cada tick grava heartbeat; verificação re-arma gatilho morto + avisa o dono; o dashboard expõe a saúde (`out.saude`).
- **Observabilidade & qualidade:** telemetria `agente_eventos` com **hash-chain SHA-256** opt-in (`TELEMETRY_HASHCHAIN`, verificador `verificarCadeiaTelemetria`); **Evals de comportamento** (`Evals.js`: `rodarEvals`/`rodarEvalsSeguranca`); `Registry.js` (modelos/prompts sem redeploy).
- **Roteador de intenção (P7.3):** `_rotaConhecimento` faz a busca RAG (RRF) antes do ReAct para consultas à base pessoal → resposta ancorada, menos latência/tokens/alucinação.
- **BaseConhecimento (RAG):** o Jarvis lê/indexa a base no **Drive** (`WIKI_DRIVE_ID`/`RAW_DRIVE_ID` sob `BaseConhecimento`); `Semantica._arquivosWiki` varre todo o `wiki/` recursivo (pula `raw/`); `WikiMemoryService.listarRaw` enumera a `raw/` e marca ingeridos. Diags: `diagRaw`, `diagIndice`.

> Padrões maduros (A2A, broker MapReduce, evals, hash-chain, sandbox) foram **portados/adaptados** do projeto-irmão de transporte (ERP + agente Gemini) e da base de conhecimento (artigos de Kanshi Tanaike).

---

_Documento de referência técnica e material de portfólio. Última revisão: 2026-06-29 (P7 hardening · P8 AsyncBroker · P9 sandbox · deploy `@191` · /exec `<DEPLOYMENT_ID>…`). Construído com Google Apps Script + Cloud Firestore + Gemini, sem servidor próprio._
