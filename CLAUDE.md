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
| Dono | <seu-email> |
| Pasta local | `C:\Users\Bruno\projetos\Web_App_Projeto` |
| Runtime | V8, timezone `America/Sao_Paulo` |
| Web App | `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` |
| Repositório | https://github.com/brunogpj/jarvis-ai-os — **público** (ver "Repositório público" em Segurança) |

## Implantações (`clasp deployments`, 25/09/2026)

| Deployment ID | Versão | Descrição |
|---|---|---|
| `<DEPLOYMENT_ID>` | **@449** | **ATIVA** — "ferramenta lerBiblia". É esta que o celular e os scripts de diagnóstico usam. |
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

Interfaces: **chat web** e **voz no Android** (MacroDroid via webhook, sem app
nativo). O **WhatsApp** (Evolution API) está **desligado por decisão do dono**
desde 24/09/2026 — sem chip, risco de ban. O projeto no Railway foi mantido;
religar = pagar o Railway e gravar `WHATSAPP_ATIVO=sim`. Com ele desligado, as
ferramentas de WhatsApp somem do modelo e devolvem o motivo; **não reativar nem
sugerir canal de mensagem**. Avisos proativos saem pelo celular (`_avisarDono`).

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
| `Code.js` | 8481 | `doGet`/`doPost`, todas as rotas do Web App, UI-bridge (`google.script.run`), dashboard, cadeia determinística da voz, e ~300 funções de feature/diagnóstico |
| `Jarvis.js` | 3677 | O agente: system prompt, declaração de ferramentas, `_execTool`, loop ReAct (`ask`), hooks pré/pós, `controlarDispositivo` (webhooks do MacroDroid) |
| `Index.html` / `Javascript.html` / `Stylesheet.html` | 527 / 2721 / 1188 | Frontend (neumorphism + glassmorphism, tema claro/escuro) |
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
`painel_interativa`, `callback_interativa`, `fala_texto` (texto de uma fala
proativa guardado por id no CacheService, 10 min), e polling da fila do
dispositivo (`?dispositivo=fila`, entrega *at-most-once*, esvazia ao ler).

**`doPost`** — ordem importa: rota `__broker` (HMAC, **antes** do rate limit, é
tráfego interno; inclui `NOTIF` da fila de notificações) → rate limit global
(240/min) → webhook da Evolution (`body.event`) → `get_voice_token` /
`telemetria` / `viagem` / `notificacao` / `voice_command` / `apps_celular` /
`janela_notificacoes` / `fala_direta` / `ler_debug` (todas com
`VOICE_API_TOKEN`) → diag (`DIAG_TOKEN`).

## Voz no Android (estado em 25/09/2026)

**O `/exec` perde respostas.** O POST responde 302 para
`script.googleusercontent.com`, e esse segundo salto devolve 404 em ~40% dos
pedidos em horários ruins — **depois** de o comando já ter executado. Nunca
repetir um `voice_command` às cegas (o resumo de e-mails já saiu 3x). A
Conversa manda `rid` (`{system_time_ms}`); o servidor guarda a resposta por
`rid`+hash da mensagem (10 min) e devolve a mesma sem re-executar
(`voz:repeticao` nos eventos). `rid` não numérico é ignorado
(`voz:rid_invalido`).

**Tudo é falado pelo TTS do próprio celular.** O áudio da nuvem, tocado pelo
MediaPlayer, ia para a saída DIRECT do Redmi (fora do reforço de alto-falante)
e soava baixo em WAV ou OGG. Agora:
- Respostas (`FALA_RESPOSTAS_LOCAL`, padrão sim): o corpo do `voice_command` é
  o texto que a macro Conversa fala.
- Proativas (`FALA_PROATIVA_LOCAL`, padrão sim): `controlarDispositivo('falar')`
  manda o texto curto direto no webhook `jarvis_falar_direto?texto_fala=`
  (`FALA_TEXTO_DIRETO=sim`, ~7 s) ou, se longo, `jarvis_falar_texto?id=` e a
  macro busca em `fala_texto` (14–26 s, com repetição).

**Cadeia determinística antes do modelo** (Code.js, `voice_command`): fato
(hora/agenda/e-mails) → financeiro → turno → insight → lembrete condicional →
**lembrete relativo** ("daqui a N minutos" → `AlertasVoz.criar({emMinutos})`,
alerta de uma vez só) → rotinas → controles nativos (mídia pausar/tocar/
próxima são comandos distintos) → Bíblia → Spotify/YouTube/Google/rota →
abrir app → JEV (TypeSafe) → LLM. O evento `voz:<rota>` diz quem atendeu.

**Alertas de voz** (`AlertasVoz.js`): `emMinutos` ou `unico:true` gravam
`data`; o tick só dispara nesse dia e **remove** o alerta depois de falar.
Sem isso o alerta é diário.

**Notificações do celular** entram numa fila (`_notifEnfileirar`) e são
processadas por loopback + tick de 1 min; janela de fala padrão 06:00–22:00.

**Links para a macro** passam por `_urlParaMacro`: a ação "Abrir página" do
MacroDroid re-codifica a URL, então o termo vai cru com `+` nos espaços, e
`spotify:search:` vira o App Link https.

### Macros em uso (MacroDroid, Redmi Note 11, Android 13)

Conversa Premium **v6** (voz → `voice_command` com `rid`, 2 repetições),
Falar **v4** (`jarvis_falar_direto` / `jarvis_falar_texto` / navegar / abrirurl),
Mídia **v4**, Notificações Premium (com repetição), Notificar, Ponto (só
Sisponto), Não Perturbe, Volume, Lanterna, Telemetria, Viagem. Os `.macro`
**não** ficam no repo (têm o token e a URL do webhook): as cópias geradas vão
para `/sdcard/Download` no celular.

Peculiaridades medidas via ADB:
- "Simular botão de mídia" manda broadcast `MEDIA_BUTTON`, que o Android 13
  bloqueia. O modo "sessão de mídia" exige o pacote exato do app. A Mídia v4
  usa "enviar comandos ao player" (`dispatchMediaKeyEvent`).
- Query string do webhook preenche a variável local de mesmo nome.
- Testar pelo ADB: `cmd media_session dispatch play`, `dumpsys media_session`
  (estado 2 = pausado, 3 = tocando), logcat de `SetVolumeActivity` (macro
  Falar começou) e `SynthHandler` (TTS falando).
- scrcpy com áudio disputa o microfone com a macro: usar `--no-audio`.

## Gatilhos de tempo

| Handler | Cadência | O quê |
|---|---|---|
| `executarTarefasAgendadas` | 15 min | Tick da Agenda + monitor de Gmail |
| `tickAlertasVoz` | 1 min | Alertas de voz (precisão de minuto) + fila de notificações pendentes |
| `jobInsightDiario` | diário | Curadoria/insight (condicional: só se ligada) |
| `jobIndexarWiki`, `jobMemoriaConversas`, `jobAutoDiagnostico`, `pingTelemetria` | — | Indexação, memória, autodiagnóstico, telemetria (15 min) |

`statusHeartbeat()` mostra o que está atrasado; o Heartbeat re-arma sozinho.

## Segurança (não afrouxar sem pensar)

- **Gate P2**: ações sensíveis (enviar WhatsApp/e-mail, excluir, `run_dynamic_script`) devolvem `confirmacao_requerida`; o modelo **nunca** passa `confirmado:true` sem "sim" explícito do usuário.
- **Owner-gating**: quase toda ferramenta é `isOwner ? ... : _denied(name)`.
- Webhooks **assinados** (MacroDroid/WhatsApp), idempotência por chave de dedup, rate limiting no `/exec`, crachás efêmeros (`A2ABadge`), log de auditoria em hash-chain SHA-256.
- Conteúdo externo é **dado, nunca instrução** (hooks anti-injeção, inclusive multimodal). Regra inegociável: **a IA nunca fabrica resultado de ferramenta**.
- Segredos **só** em Script Properties. Nunca no `.gs`, nunca no git.

### Repositório público (desde 26/09/2026)

O `jarvis-ai-os` é público e virou vitrine: o projeto Jarvis e o post sobre ele
no LinkedIn apontam para o repo, e ele está fixado no perfil do GitHub
(`brunogpj`, com README de perfil). Tudo que entra no git é público, inclusive
o histórico. Então:

- Nada de Script ID, Deployment ID, e-mail, telefone, token, URL de webhook,
  nome de contato ou lista de apps do celular. Use marcadores, como este
  arquivo faz (`<SCRIPT_ID>`, `<DEPLOYMENT_ID>`, `<seu-email>`); o dado real
  fica em Script Properties ou só na máquina.
- Testes usam dados genéricos (o commit `eee2398` trocou um contato real por um
  genérico no teste do lembrete relativo).
- O `README.md` é o que um recrutador lê primeiro. O projeto Jarvis no
  LinkedIn e o README do perfil do GitHub citam "147 testes automatizados";
  se a contagem mudar muito, avise o dono para atualizar lá também.
- Nada sobre o empregador nem sobre sistemas internos de trabalho entra aqui.

## Setup da máquina (uma vez)

```powershell
node -v                                  # Node 20+
npm install -g @google/clasp             # se a CLI divergir, usar @2.4.2
clasp login                              # entrar como <seu-email>
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

O git é separado do clasp: depois de commitar, `git push origin master` publica
no GitHub (credenciais pelo Git Credential Manager; o `gh` não está logado).
Antes do push, conferir o diff atrás de dado pessoal (ver "Repositório
público").

## Testes

```bash
cd tests-local && node --test
```

147 testes offline (sem cota, sem rede) sobre a lógica determinística: MODO
DIRETO, gate sem-cota, hooks, parsing de turno/briefing, validação de prefs,
ordenação dos cards, cadeia da voz, lembrete relativo e alertas de uma vez só,
`_urlParaMacro`, `lerBiblia`. `tests-local/gas-shims.js` simula as APIs do GAS
(`formatDate` é fixo: teste que depende de horário injeta o seu).
Estado em 25/09/2026: **147/147 passando**.

Contra o sistema vivo, pelo terminal: `ler_debug` (POST com `VOICE_API_TOKEN`,
`n` até 200, `alertas:true`) lê os eventos em `agente_eventos` — `voz:<rota>`,
`voz:entrega:local · rid`, `alertaVoz:*`, `notif:processada`. É por eles que se
confirma o que aconteceu no celular. Roteiro manual de testes (voz, ações e web
app): artifact "Roteiro de Testes Jarvis" (76 testes, todos passando em
25/09/2026).

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
