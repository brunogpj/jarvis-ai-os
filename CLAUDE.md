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

## Implantações (`clasp deployments`, 28/09/2026)

| Deployment ID | Versão | Descrição |
|---|---|---|
| `<DEPLOYMENT_ID>` | **@454** | **ATIVA** — "briefing: notícias locais". É esta que o celular e os scripts de diagnóstico usam. |
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
| `Briefing.js` | Briefings falados com **dados buscados pelo código** (agenda, tarefas, notícias locais e nacionais, tempo, versículo); o modelo só redige notícias — ver "Briefings" |
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
`janela_notificacoes` / `fala_direta` / `config_fala` / `ler_debug` (todas com
`VOICE_API_TOKEN`) → diag (`DIAG_TOKEN`). `config_fala` troca, por HTTP, só uma
lista fechada de chaves da entrega da fala (`FALA_PROATIVA_LOCAL`,
`FALA_RESPOSTAS_LOCAL`, `MODO_FALA_VOZ`, `FALA_VOLUME_DB` 0–16, `FALA_FORMATO`).

## Voz no Android (estado em 28/09/2026)

**O `/exec` perde respostas.** O POST responde 302 para
`script.googleusercontent.com`, e esse segundo salto devolve 404 em ~40% dos
pedidos em horários ruins — **depois** de o comando já ter executado. Nunca
repetir um `voice_command` às cegas (o resumo de e-mails já saiu 3x). A
Conversa manda `rid` (`{system_time_ms}`); o servidor guarda a resposta por
`rid`+hash da mensagem (10 min) e devolve a mesma sem re-executar
(`voz:repeticao` nos eventos). `rid` não numérico é ignorado
(`voz:rid_invalido`).

**Voz premium da nuvem, um arquivo por fala.** Estado ligado em 28/09:
`FALA_PROATIVA_LOCAL=nao`, `FALA_RESPOSTAS_LOCAL=nao`, `MODO_FALA_VOZ=auto`
(confirmações rápidas de ação — "Abrindo o WhatsApp" — ainda saem pelo TTS do
celular, que não chega atrasado; conteúdo, briefings e avisos vão pela nuvem).
`controlarDispositivo('falar')` sintetiza (Cloud/Gemini TTS), grava no MESMO
arquivo do Drive (ID estável) e dispara `jarvis_falar?id=<drive>&arq=<nome>`. A
macro Falar v6 baixa pelo `{lv=id}` para `Download/Jarvis/{lv=arq}`
(`jarvis_AAAA-MM-DD_HH-mm-ss[_briefing].ogg`) e toca esse arquivo — o dono
reabre qualquer fala para ouvir de novo.

**O volume baixo era o canal, não o arquivo** (medido por adb em 28/09). A ação
"Tocar som" do MacroDroid é `MediaPlayer.setAudioStreamType(canal)`. No canal 3
(música) o Android usa uma saída **DIRECT** (`AudioOut_485`, type 1), fora do
mixer onde o Xiaomi aplica o reforço de alto-falante: quase inaudível. O mesmo
arquivo aberto no Files (AudioTrack) vai pelo **MIXER** e soa alto. A Falar v6
toca no canal de **alarme** (4) → `USAGE_ALARM`, mixer `AudioOut_D`, volume
confirmado de ouvido. Efeitos: toca mesmo no silencioso e sai no alto-falante
mesmo com fone Bluetooth. Para medir: `dumpsys audio` (player do MacroDroid
`state:started`, `usage=`) e a thread ativa em `dumpsys media.audio_flinger`.

Os ramos de fala pelo TTS do celular (`jarvis_falar_direto?texto_fala=` e
`jarvis_falar_texto?id=` + `fala_texto`) continuam na macro; voltar a eles =
`config_fala` com `FALA_*_LOCAL=sim`.

**Cadeia determinística antes do modelo** (Code.js, `voice_command`): fato
(hora/agenda/e-mails) → financeiro → turno → insight → lembrete condicional →
**lembrete relativo** ("daqui a N minutos" → `AlertasVoz.criar({emMinutos})`,
alerta de uma vez só) → rotinas → controles nativos (mídia pausar/tocar/
próxima são comandos distintos) → Bíblia → Spotify/YouTube/Google/rota →
abrir app → JEV (TypeSafe) → LLM. O evento `voz:<rota>` diz quem atendeu.

**Alertas de voz** (`AlertasVoz.js`): `emMinutos` ou `unico:true` gravam
`data`; o tick só dispara nesse dia e **remove** o alerta depois de falar.
Sem isso o alerta é diário.

**Briefings** (`Briefing.js`, tags `briefing*` dos alertas). Até 27/09 eram um
`Jarvis.ask(prompt)` e o modelo decidia se consultava: os de 25/09 e 28/09 à
noite saíram **sem nenhuma ferramenta**, com o mesmo texto fabricado e
compromissos que não existiam ("nunca invente" estava no prompt). Agora o
código busca tudo (agenda do calendário padrão — "amanhã" é o dia seguinte
inteiro; Google Tasks; `Gemini.pesquisarWeb` para notícias **locais**
(`BRIEFING_REGIAO`, padrão BH + região metropolitana + MG, lidas primeiro) e
nacionais e para o tempo; versículo de uma lista curta via `lerBiblia`). Frases
de agenda e tarefas são montadas no código; o modelo só redige as notícias, sem
ferramentas e com `_thinking:'low'`. Frases dele sobre "sua agenda / você tem"
e saudação repetida são cortadas. Sem volta para o ask em caso de falha: fala
que não conseguiu. Cada briefing deixa o evento `briefing:fontes` (o que foi
consultado e ms por etapa). Ensaiar sem falar: `ler_debug` com
`ensaioBriefing:'<tag>'`.

**Trava de agenda inventada no chat e na voz** (`_hookAgendaSemFonte`, pós-hook):
frase que afirma agenda/tarefas do dono sem ferramenta de agenda com sucesso
no MESMO turno é cortada, com aviso; evento `hook:agenda_sem_fonte`.

**Notificações do celular** entram numa fila (`_notifEnfileirar`) e são
processadas por loopback + tick de 1 min; janela de fala padrão 06:00–22:00.

**Links para a macro** passam por `_urlParaMacro`: a ação "Abrir página" do
MacroDroid re-codifica a URL, então o termo vai cru com `+` nos espaços, e
`spotify:search:` vira o App Link https.

### Macros em uso (MacroDroid, Redmi Note 11, Android 13)

Conversa Premium **v6** (voz → `voice_command` com `rid`, 2 repetições),
Falar **v6** (`jarvis_falar` premium → `Download/Jarvis/{arq}` no canal de alarme,
`jarvis_falar_direto` / `jarvis_falar_texto` / navegar / abrirurl),
Mídia **v4**, Notificações Premium (com repetição), Notificar, Ponto (só
Sisponto), Não Perturbe, Volume, Lanterna, Telemetria, Viagem. Os `.macro`
**não** ficam no repo (têm o token e a URL do webhook): as cópias geradas vão
para `/sdcard/Download` no celular.

Peculiaridades medidas via ADB:
- "Simular botão de mídia" manda broadcast `MEDIA_BUTTON`, que o Android 13
  bloqueia. O modo "sessão de mídia" exige o pacote exato do app. A Mídia v4
  usa "enviar comandos ao player" (`dispatchMediaKeyEvent`).
- Query string do webhook preenche a variável local de mesmo nome.
- Magic text vale no caminho de gravação do HTTP (`saveResponseAllFilesAccessPath`)
  e no nome do arquivo do "Tocar som" (`allFilesFilename`) — conferido no DEX.
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
`Heartbeat.medir` soma por dia execuções, tempo, maior duração e erros de cada
gatilho na property `DIARIO_GATILHOS` (`ler_debug` com `gatilhos:true`).

**Tudo parou de uma vez, com os gatilhos instalados? Reautorização.** Em 29/09,
das ~18:10 às ~00:45, o Apps Script esperou um novo consentimento de
permissões. Os gatilhos pararam, e o `/exec` também (ele roda como
`USER_DEPLOYING`). As notificações do celular desse intervalo se perderam,
entre elas a recarga do Swile. Primeiro passo: abrir o editor ou o Web App e
aceitar o pedido de permissão.

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
  LinkedIn e o README do perfil do GitHub citam "147 testes automatizados"
  (o repo tem 167 desde 01/10 — a frase segue verdadeira como piso);
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

167 testes offline (sem cota, sem rede) sobre a lógica determinística: MODO
DIRETO, gate sem-cota, hooks, parsing de turno/briefing, validação de prefs,
ordenação dos cards, cadeia da voz, lembrete relativo e alertas de uma vez só,
`_urlParaMacro`, `lerBiblia`, briefing com dados reais e trava de agenda
inventada (`tests-local/briefing.test.js`), despertador composto, teto de
caracteres da voz no briefing e autodiagnóstico sem alarme de app raro
(`tests-local/dia-0110.test.js`). `tests-local/gas-shims.js` simula as
APIs do GAS (`formatDate` é fixo: teste que depende de horário injeta o seu).
Estado em 01/10/2026: **167/167 passando**.

Contra o sistema vivo, pelo terminal: `ler_debug` (POST com `VOICE_API_TOKEN`,
`n` até 200, `alertas:true`, `notificacoes:N`, `ensaioBriefing:'<tag>'`, `gatilhos:true`,
`saude:true`, `testarTick:true|'agenda'`, `callbacks:N`) lê os eventos em `agente_eventos` — `voz:<rota>`,
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
