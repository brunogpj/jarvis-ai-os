# 🤖 Jarvis — Sistema Operacional de IA Pessoal

> Um assistente de IA de nível **"AI OS"** construído **100% em Google Apps Script** — sem servidor próprio, sem app nativo.
> Conversa no **chat** e no **WhatsApp**, **fala em voz alta no Android**, tem um **segundo cérebro** (RAG) e um **dashboard que age**.
>
> **Autor:** Bruno Felipe dos Santos Marques — Desenvolvedor de Automações · Belo Horizonte/MG
> **Status:** em produção / evolução contínua. Projeto de portfólio.

---

## ✨ O que é

O Jarvis não é um chatbot — é um **agente que age**. Frontend e backend rodam em **Apps Script (HtmlService)**; a memória é **Cloud Firestore** (REST + service account, JWT assinado no próprio GAS); a inteligência é o **Gemini**, orquestrado por um **loop de agente (ReAct)** construído do zero. A interface usa **neumorphism + glassmorphism**, com tema claro/escuro.

Ele fala três interfaces ao mesmo tempo: **chat web**, **WhatsApp** (via Evolution API) e **voz no Android** (Cloud TTS + MacroDroid).

## 🧩 Capacidades

| Área | O que faz |
|---|---|
| 🧠 **Agente de IA** | Loop ReAct com dezenas de ferramentas (Gmail, Agenda, Tarefas, Drive, web grounding, URL context, RAG). "MODO DIRETO" (leituras determinísticas sem LLM) + **roteador de intenção** (busca RAG antes do ReAct → menos latência/tokens/alucinação). |
| 🔊🎙️ **Voz no Android (mão dupla)** | *"no android, me fala minha agenda"* → o **celular fala em voz alta** (Cloud TTS Chirp3-HD, via webhook do MacroDroid, sem app nativo). E **ouve**: você manda um **áudio no WhatsApp**, ele **transcreve (Cloud Speech), entende e responde**. |
| 🔔 **Alertas de voz agendados** | *"todo dia às 8h30, me fale meus e-mails no android"* → no horário, **gera o conteúdo e fala** no celular. |
| 📩 **WhatsApp + Modo Secretária** | Recebe/responde no WhatsApp; rascunha respostas de contatos para **aprovação** do dono; ponte de **autorização** human-in-the-loop. |
| 🔒 **Avisos de contato com privacidade** | Anuncia em voz quem mandou mensagem (nome salvo + voz por gênero); **esconde o conteúdo** se o assunto é sensível. |
| 🗂️ **Segundo cérebro (RAG)** | *"salva isso no meu cérebro: <link>"* → lê, **estrutura (saídas estruturadas)**, arquiva na wiki; recupera por **significado** (busca híbrida com RRF). |
| 🎛️ **Dashboard acionável** | Cards interativos: tarefas, autorizações, pendências (modo secretária), alertas de voz, mensagens agendadas, monitores web. |
| 👁️ **Multimodal** | OCR de imagens, leitura de PDF/CSV, transcrição de áudio, geração de imagem. |
| ⚙️ **Autonomia** | Tarefas agendadas, monitor de Gmail por evento e **autonomia por objetivo** (planeja → confirma → executa em 2º plano → sintetiza). |

## 🏗️ Arquitetura & stack

- **Google Apps Script** — frontend (HtmlService) + backend (`doGet`/`doPost`) + automações por gatilho de tempo.
- **Cloud Firestore** (REST + service account, JWT RS256 assinado no GAS; token OAuth cacheado).
- **Gemini** — geração + function calling, com **cascata de chaves/modelos** e engenharia de custo (free tier first).
- **Cloud Text-to-Speech** (vozes Chirp3-HD) · **Evolution API** (WhatsApp) · **MacroDroid** (atuador no Android via webhook) · **People API** (contatos).
- **RAG híbrido** (embeddings + palavra-chave, fundidos por Reciprocal Rank Fusion).
- **Broker assíncrono** (`AsyncBroker.js`) — "1-second timeout hack" (loopback à própria `/exec`) p/ escapar do limite de 6 min do GAS: trabalho pesado em janelas isoladas, com token-bucket, dead-letter recovery, reducer e MapReduce multi-agente. Resolve a escalabilidade **sem Cloud Run**.

## 🛡️ Segurança (Zero-Trust por design)

Postura **Zero-Trust** com cada defesa mapeada ao **OWASP Top 10 for LLMs** (mapa completo em **`SEGURANCA_OWASP_JARVIS.md`**):
- Owner-gating + confirmação humana (P2); segredos **só em Script Properties**; ponte de autorização (o contato **nunca** sabe do fluxo interno).
- **Prompt injection (LLM01)**: guardrails que tratam conteúdo externo como dado, não instrução. Regra inegociável: **a IA nunca fabrica resultado de ferramenta**.
- **Replay attack**: idempotência por chave de dedup (webhooks/falas). **SSRF**: anti-SSRF que barra IP interno + metadados de nuvem.
- **Sandbox de código dinâmico** (`run_dynamic_script`): APIs envolvidas (`_wrapped*`) + allowlist → sem exfiltração/phishing/traversal.
- **Hardening de borda**: webhooks **assinados** (MacroDroid/WhatsApp), **rate limiting** no `/exec`, **crachás efêmeros** (A2ABadge), **log de auditoria à prova de adulteração** (hash-chain SHA-256).
- Discrição de assunto sensível na voz; **nunca responde em grupos** de WhatsApp.

## 💸 Custo

Opera no **free tier** do Gemini por engenharia de cascata (free-first, múltiplas chaves free que se revezam, modelo e thinking ajustáveis). A chave paga é último recurso — ou excluída por completo (`GEMINI_FREE_ONLY`).

## 🧪 Testes / QA

Catálogo completo em **`TESTES_JARVIS.md`** (o que pedir × tool esperada × resultado) e a ordem de execução em **`ROTEIRO_QA_JARVIS.md`** (Fases 0–11 + §15 dos recursos recentes). Harness automatizado: `rodarQA()` (saúde funcional) e **`rodarEvals()`** (testes de *comportamento* do agente: Gate P2 não burlável, anti-injeção, anti-alucinação, vazamento de chave — via `toolTrace` real). Testes locais offline: `node tests-local/jarvis.test.js`.

## 🚀 Deploy

```bash
clasp push -f
clasp deploy -i <deploymentId> -d "descrição"
# sempre testar no /exec (a URL /dev serve cache antigo)
```
Segredos e config ficam em **Script Properties** (nunca no código). Diagnósticos no editor: `statusJarvis`, `diagGemini`, `testarFirestore`, `pingGemini`, etc.

## 📂 Documentação do projeto

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Este front-door. |
| `DOCUMENTACAO.md` | Documentação técnica completa (arquitetura, ferramentas, segurança, deploy). |
| `TESTES_JARVIS.md` | Catálogo de testes (inclui §15 — recursos recentes). |
| `ROTEIRO_QA_JARVIS.md` | Ordem ideal de execução do QA. |
| `MELHORIAS_JARVIS.md` | Roadmap e melhorias (rastreabilidade ideia→implementação). |
| `SEGURANCA_OWASP_JARVIS.md` | Modelo de ameaças + mapa das defesas contra o OWASP Top 10 for LLMs. |
| `PROMPT_REUSO_DESENVOLVEDOR.md` | Como reutilizar os blocos do Jarvis em outro projeto. |
| `LINKEDIN_JARVIS.md` | Post + roteiro de narração para o vídeo de portfólio. |

---

> Construído com engenharia de agentes, RAG, integração de múltiplas APIs, idempotência, segurança Zero-Trust e engenharia de custo — tudo dentro do ecossistema Google. É o projeto que mostra o nível técnico real: **de quem escreve scripts a quem arquiteta sistemas de IA.**
