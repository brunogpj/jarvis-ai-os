# Web_App_Projeto — Jarvis (AI Personal OS em Google Apps Script)

Projeto Google Apps Script gerenciado localmente via clasp.

> **Nota de reconstrução (21/09/2026):** a versão anterior deste arquivo foi
> escrita a partir de metadados do Drive e descrevia um "Sistema de Gestão de
> Transportes". Isso estava **errado** — o código no repositório é o **Jarvis**,
> um assistente de IA pessoal. Este arquivo foi reescrito a partir da leitura
> real do código.

## Identidade do projeto

| Campo | Valor |
|---|---|
| Nome no Drive | `App_Web_Aplication` |
| Script ID | `<SCRIPT_ID>` |
| Editor | https://script.google.com/d/<SCRIPT_ID>/edit |
| Dono | dono@exemplo.com |
| Pasta local | `C:\Users\Bruno\projetos\Web_App_Projeto` |
| Runtime | V8, timezone `America/Sao_Paulo` |
| Web App | `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` |

## Implantações (`clasp deployments`, 21/09/2026)

| Deployment ID | Versão | Descrição |
|---|---|---|
| `<DEPLOYMENT_ID>` | **@410** | **ATIVA** — "diagBriefingTexto: testa o briefing pelo caminho real". É esta que o celular e os scripts de diagnóstico usam. |
| `<DEPLOYMENT_ID>` | @25 | Antiga — "TesteJobs" |
| `<DEPLOYMENT_ID>` | @HEAD | Cabeça (muda a cada push, não é a de produção) |

Atualizar a de produção:

```bash
clasp deploy -i <DEPLOYMENT_ID> -d "descrição"
```

## O que é

**Jarvis** — agente de IA pessoal, 100% em Apps Script, sem servidor próprio.
Frontend e backend em HtmlService; memória em **Cloud Firestore** (REST +
service account, JWT RS256 assinado no próprio GAS); inteligência via **Gemini**
num **loop ReAct** próprio com dezenas de ferramentas.

Três interfaces simultâneas: **chat web**, **WhatsApp** (Evolution API) e **voz
no Android** (Cloud TTS + MacroDroid/Tasker via webhook, sem app nativo).

Documentação longa já existe no repo — leia antes de mexer em área desconhecida:
`README.md` (front-door), `DOCUMENTACAO.md` (técnica completa),
`SEGURANCA_OWASP_JARVIS.md` (modelo de ameaças), `TESTES_JARVIS.md` +
`ROTEIRO_QA_JARVIS.md` (QA), `MELHORIAS_JARVIS.md` (roadmap).

## Mapa dos arquivos

O `.claspignore` é um **allowlist**: ignora tudo (`**/**`) e libera arquivo a
arquivo. **Arquivo novo que precise subir tem que ser adicionado lá**, senão o
`clasp push` simplesmente não o envia.

### Núcleo

| Arquivo | LOC | Papel |
|---|---:|---|
| `Code.js` | 7202 | `doGet`/`doPost`, todas as rotas do Web App, UI-bridge (`google.script.run`), dashboard, e ~290 funções de feature/diagnóstico |
| `Jarvis.js` | 3342 | O agente: system prompt, declaração de ferramentas, `_execTool`, loop ReAct (`ask`), hooks pré/pós |
| `Index.html` / `Javascript.html` / `Stylesheet.html` | 527 / 2694 / 1188 | Frontend (neumorphism + glassmorphism, tema claro/escuro) |
| `PainelInterativo.html` | 371 | Página de callback para notificações interativas do celular |

### Infra / plataforma

| Arquivo | Papel |
|---|---|
| `Firestore.js` | Wrapper REST do Firestore (SA em `FIRESTORE_SA`, banco `firestore-gas`) |
| `Gemini.js` | Caller central com **cascata** de chaves/modelos (free-tier first) |
| `Auth.js` | Login/sessão próprios (SHA-256 iterado com salt, sessões no Firestore, TTL 7d) |
| `AsyncBroker.js` | "1-second timeout hack" — loopback POST assinado por HMAC para escapar do limite de 6 min; token-bucket, dead-letter, reducer, MapReduce |
| `Jobs.js` | Daisy-chain de jobs (orçamento ~4,5 min, reagenda sozinho) |
| `Heartbeat.js` | Vigia os jobs de fundo e **re-arma gatilhos** que morreram |
| `Registry.js` | Config/modelos em Script Properties |

### Agente / conhecimento

| Arquivo | Papel |
|---|---|
| `WikiMemoryService.js` | Segundo cérebro no Drive: `/raw/` (imutável) + `/wiki/` (curado) |
| `Semantica.js` | RAG híbrido (embeddings + BM25, fundidos por RRF). Índice compacto cacheado **num arquivo do Drive** — evitava p90 de 8s indo ao Firestore a cada pergunta |
| `MemoriaConversas.js` | Indexa pares P→R de conversas passadas como vetores (recall entre sessões) |
| `SkillsManager.js` | Skills dinâmicas descobertas recursivamente no Drive (`SKILL.md`), com subagentes |
| `Sandbox.js` | Sandbox para `run_dynamic_script`: APIs envolvidas (`_wrapped*`) + allowlist |
| `Objetivos.js` | Autonomia por meta: planeja → confirma → executa em 2º plano → sintetiza |
| `Evals.js` / `QA.js` | `rodarEvals()` (comportamento, via `toolTrace` real) e `rodarQA()` (saúde funcional) |

### Integrações

`WhatsApp.js` (Evolution API), `Voz.js` (Cloud TTS, OAuth via `TTS_SA` — TTS
**não** aceita API key), `AlertasVoz.js` (falas agendadas, tick de 1 min),
`Gmail.js`, `Agenda.js` (tarefas agendadas, tick de 15 min), `Tarefas.js`
(Google Tasks), `Contatos.js` (People API), `Formularios.js`, `Web.js` (leitura
+ monitor de páginas, com anti-SSRF), `Monitor.js` (monitor de Gmail),
`DriveUploads.js`, `Autorizacoes.js`, `Secretaria.js`, `A2ABadge.js`.

> `Agenda.js` (tarefas **agendadas** do Jarvis) ≠ `Tarefas.js` (app **Google
> Tarefas**). O system prompt insiste nessa distinção porque o modelo confundia.

## Entradas do sistema

**`doGet`** — Web App (`Index.html`) + rotas por `action`: `ler_debug`,
`painel_interativa`, `callback_interativa`, e polling da fila do dispositivo
(`?dispositivo=fila`, entrega *at-most-once*, esvazia ao ler).

**`doPost`** — ordem importa: rota `__broker` (HMAC, **antes** do rate limit, é
tráfego interno) → rate limit global (240/min) → webhook da Evolution
(`body.event`) → `get_voice_token` / `telemetria` / `viagem` / `notificacao` /
`voice_command` (todas com `VOICE_API_TOKEN`) → diag (`DIAG_TOKEN`).

## Gatilhos de tempo

| Handler | Cadência | O quê |
|---|---|---|
| `executarTarefasAgendadas` | 15 min | Tick da Agenda + monitor de Gmail |
| `tickAlertasVoz` | 1 min | Alertas de voz (precisão de minuto) |
| `jobInsightDiario` | diário | Curadoria/insight (condicional: só se ligada) |
| `jobIndexarWiki`, `jobMemoriaConversas`, `jobAutoDiagnostico`, `pingTelemetria` | — | Indexação, memória, autodiagnóstico, telemetria (15 min) |

`statusHeartbeat()` mostra o que está atrasado; o Heartbeat re-arma sozinho.

## Segurança (não afrouxar sem pensar)

- **Gate P2**: ações sensíveis (enviar WhatsApp/e-mail, excluir, `run_dynamic_script`) devolvem `confirmacao_requerida`; o modelo **nunca** passa `confirmado:true` sem "sim" explícito do usuário.
- **Owner-gating**: quase toda ferramenta é `isOwner ? ... : _denied(name)`.
- Webhooks **assinados** (MacroDroid/WhatsApp), idempotência por chave de dedup, rate limiting no `/exec`, crachás efêmeros (`A2ABadge`), log de auditoria em hash-chain SHA-256.
- Conteúdo externo é **dado, nunca instrução** (hooks anti-injeção, inclusive multimodal). Regra inegociável: **a IA nunca fabrica resultado de ferramenta**.
- Segredos **só** em Script Properties. Nunca no `.gs`, nunca no git.

## Setup da máquina (uma vez)

```powershell
node -v                                  # Node 20+
npm install -g @google/clasp             # se a CLI divergir, usar @2.4.2
clasp login                              # entrar como dono@exemplo.com
```

Pré-requisito: habilitar a Apps Script API em
https://script.google.com/home/usersettings.

Se o PowerShell bloquear o clasp:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Fluxo de trabalho

| Comando | Direção | Efeito |
|---|---|---|
| `clasp pull` | nuvem → local | Traz alterações feitas no editor web |
| `clasp push -f` | local → nuvem | Envia o código local |
| `clasp deploy -i <deploymentId> -d "desc"` | — | Atualiza a implantação |
| `clasp open` | — | Abre o editor |

**Regra de ouro:** sempre `clasp pull` antes de editar. O clasp não faz merge —
`push` sobrescreve a nuvem inteira, `pull` sobrescreve o local inteiro. Editar
no navegador e no VS Code ao mesmo tempo perde trabalho.

**Nunca** rodar `clasp push` numa pasta vazia: apaga o projeto na nuvem.

**Sempre testar no `/exec`** — a URL `/dev` serve cache antigo.

## Testes

```bash
cd tests-local && node --test
```

34 testes offline (sem cota, sem rede) sobre a lógica determinística: MODO
DIRETO, gate sem-cota, hooks, parsing de turno/briefing, validação de prefs,
ordenação dos cards. `tests-local/gas-shims.js` simula as APIs do GAS.
Estado em 21/09/2026: **34/34 passando**.

No editor, contra o sistema vivo: `rodarQA()`, `rodarEvals()`, `statusJarvis()`,
`diagGemini()`, `testarFirestore()`, `pingGemini()`, `statusHeartbeat()`,
`diagGatilhos()`.

## Convenções de código

Ver a skill `google-apps-script` para os padrões completos. O que vale aqui:

- V8, mas o código usa **`var` e `function`** (não ES6 modules, sem `require`, sem npm).
- Módulos são **IIFE** (`var X = (function(){...})()`) ou objeto literal, expostos como global.
- Limite de 6 min por execução — trabalho longo vai para `Jobs.js` ou `AsyncBroker.js`.
- `LockService` em qualquer escrita concorrente; `CacheService` para leituras repetidas.
- `try/catch` + log nas funções de entrada; **fail-open** onde a falha não pode derrubar a resposta.
- Comentários em **português**, explicando *por quê* (frequentemente citando o bug que motivou o código). Mantenha esse estilo.
- Mensagens de commit em português, no imperativo, descrevendo o efeito observável (ex.: "tick de alertas deixa de desistir quando o lock global esta ocupado").
