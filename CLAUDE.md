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

## Implantações (`clasp deployments`, 14/10/2026)

| Deployment ID | Versão | Descrição |
|---|---|---|
| `<DEPLOYMENT_ID>` | **@518** | **ATIVA** — "TTS: estilo da voz deixa de ser falado" |
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
| `Consultor.js` | Fase 4 da caderneta: o consultor da estratégia do dono (carteira × alvo, aporte do mês, simulações, reserva, metas), só leitura, 100% no código |
| `Briefing.js` | Briefings falados com **dados buscados pelo código** (agenda, tarefas, notícias locais e nacionais, tempo, versículo); o modelo só redige notícias — ver "Briefings" |
| `BuscaDrive.js` | Busca SEMÂNTICA nos arquivos do Drive ("acha o documento sobre X"): 1 vetor int8 por arquivo num índice único no Drive, com o `file_id` para abrir o arquivo vivo — ver "Busca semântica no Drive" |
| `Evals.js` / `QA.js` | `rodarEvals()` (comportamento, via `toolTrace` real) e `rodarQA()` (saúde funcional) |

### Integrações

`WhatsApp.js` (Evolution API), `Voz.js` (Cloud TTS, OAuth via `TTS_SA` — TTS
**não** aceita API key), `AlertasVoz.js` (falas agendadas, tick de 1 min),
`Gmail.js`, `Agenda.js` (tarefas agendadas, tick de 15 min), `Tarefas.js`
(Google Tasks), `Contatos.js` (People API), `Formularios.js`, `Web.js` (leitura
+ monitor de páginas, com anti-SSRF), `Monitor.js` (monitor de Gmail),
`DriveUploads.js`, `Autorizacoes.js`, `Secretaria.js`, `A2ABadge.js`, `Financas.js`
(a **caderneta**, o app de finanças pessoais do dono, só leitura — ver "Caderneta").

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
`janela_notificacoes` / `fala_direta` / `config_fala` / `config_financas` / `config_gemini` / `ler_debug` (todas com
`VOICE_API_TOKEN`) → diag (`DIAG_TOKEN`). `config_fala` troca, por HTTP, só uma
lista fechada de chaves da entrega da fala (`FALA_PROATIVA_LOCAL`,
`FALA_RESPOSTAS_LOCAL`, `MODO_FALA_VOZ`, `FALA_VOLUME_DB` 0–16, `FALA_FORMATO`, `FALA_ARQUIVO_UNICO`, `ROTA_JEV_NOVAS` sim|nao, `FIN_AVISOS_ATIVO` sim|nao, `FIN_NOME_DONO`, `FIN_CPF_DONO`).

## Voz no Android (estado em 28/09/2026)

**O `/exec` perde respostas.** O POST responde 302 para
`script.googleusercontent.com`, e esse segundo salto devolve 404 em ~40% dos
pedidos em horários ruins — **depois** de o comando já ter executado. Nunca
repetir um `voice_command` às cegas (o resumo de e-mails já saiu 3x). A
Conversa manda `rid` (`{system_time_ms}`); o servidor guarda a resposta por
`rid`+hash da mensagem (10 min) e devolve a mesma sem re-executar
(`voz:repeticao` nos eventos). `rid` não numérico é ignorado
(`voz:rid_invalido`).

**Voz premium da nuvem, num arquivo só no celular.** Estado ligado em 28/09:
`FALA_PROATIVA_LOCAL=nao`, `FALA_RESPOSTAS_LOCAL=nao`, `MODO_FALA_VOZ=auto`
(confirmações rápidas de ação — "Abrindo o WhatsApp" — ainda saem pelo TTS do
celular, que não chega atrasado; conteúdo, briefings e avisos vão pela nuvem).
`controlarDispositivo('falar')` sintetiza (Cloud/Gemini TTS), grava no MESMO
arquivo do Drive (ID estável) e dispara `jarvis_falar?id=<drive>&arq=<nome>`. A
macro Falar v6 baixa pelo `{lv=id}` para `Download/Jarvis/{lv=arq}` e toca esse
arquivo. Desde 02/10 o `arq` é sempre `jarvis-fala.wav`: cada fala sobrescreve a
anterior. Um arquivo por fala, com data e hora no nome, enchia o gerenciador de
arquivos. O conteúdo pode ser OGG ou WAV; o Android reconhece pelo conteúdo, não
pela extensão. Para voltar a um arquivo por fala, gravar `FALA_ARQUIVO_UNICO=nao`
pelo `config_fala`.

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

**Caderneta (fase 1, só leitura, desde 14/10).** `Financas.js` consulta o Worker da
caderneta (`GET /api/jarvis/resumo`, `Authorization: Bearer`) e fala: livre hoje, previsão do
fim do mês, o que vence (hoje/amanhã/semana, com atrasadas), quanto falta pagar, orçamento do
mercado, investido e reserva. **O número vem do código**: a caderneta calcula no servidor
(`src/calculos.js`, igual ao `app.js`, com teste de paridade) e o Jarvis só formata a frase.
Nenhuma resposta passa pelo Gemini e o modelo não ganhou ferramenta financeira. A rota de voz
`caderneta` vem ANTES do Swile e só pega o inequívoco ("livre", "vence", "falta pagar",
"orçamento do mercado", "investido"); "saldo do voucher" e "quanto gastei essa semana" seguem no
Swile. Fala no aparelho (`caderneta` está em `FALA_LOCAL_ROTAS`) e o log guarda
"[resposta financeira não registrada]", sem o valor. Endereço e token ficam em Script Properties
(`FIN_API_URL`, `FIN_API_TOKEN`), gravados pela rota `config_financas` (token da voz) a partir do
`provisionar-jarvis.mjs` da caderneta, que gera o token e não o mostra. `ler_debug` com
`caderneta:true` mostra o que ele responderia a cada pergunta, sem falar. Fases seguintes
(avisos, registro por voz com confirmação) ainda não existem; escrita só por ações estreitas.

**Gemini pago e teto de gasto (desde 14/10).** Tudo roda no plano pago: `GEMINI_FREE_ONLY=false`,
`GEMINI_ORDER=billing_first` (as chaves gratuitas ficam de reserva), agente em `gemini-3.8-flash`
(reserva `gemini-2.5-flash`), busca em `gemini-3.5-flash-lite`, voz em `gemini-3.8-flash-lite-tts`
(o `gemini-2.5-flash-preview-tts` desliga em 17/11/2026), imagem em `gemini-3.1-flash-lite-image`.
O `gemini-2.0-flash` foi desligado em 01/06/2026 e saiu das reservas. `GastoIA.js` soma tokens ×
preço de cada chamada (tabela copiada da página de preços; o preço do 3.8 Flash e da voz dobra em
01/01/2027) e guarda o mês em `GEMINI_GASTO`. **Teto** `GEMINI_ORCAMENTO_BRL` (padrão 29,65 = 2% do
limite de R$ 1.482,74), câmbio `GEMINI_USD_BRL` (padrão 5,70). Avisa em 50%, 80% e 100%; aos 100% a
chave de faturamento sai da cascata até o mês virar (`GEMINI_ORCAMENTO_ATIVO=nao` desliga a trava).
É estimativa, não fatura: o Google só mostra o custo horas depois. O teto real da Google é o
pré-pagamento. Rota `config_gemini` (token da voz) troca modelos, ordem e teto numa lista fechada
(nunca chaves de API nem o modelo de embedding, que exigiria reindexar). `ler_debug` com `gemini:true`
mostra a configuração e o gasto; com `geminiTeste:true` roda um ensaio vivo (texto, chamada de função
com thoughtSignature, busca, voz, embedding) e diz quanto ele custou.

**Roteador semântico (JEV) para caderneta, rota, repetir briefing e folga (desde 14/10).**
Só roda DEPOIS que a cadeia de padrões falhou (`_rotaSemantica` em Code.js, TypeSafe `perguntar`
com todas as perguntas numa requisição só). Intenções novas: `cad_livre`, `cad_vencimentos`,
`cad_falta_pagar`, `cad_mercado`, `cad_investido`, `repetir_briefing`, `folga_ponto`, `navegar`
(as quatro últimas só por voz/ação). Leitura exige confiança 0,70 (`ROTA_LIMIAR_LEITURA`), ação
(folga, navegar, repetir) 0,85 (`ROTA_LIMIAR_ACAO`). Pergunta financeira que nenhuma intenção cobre mas
com `financas` ≥ 0,85 responde "Ainda não sei responder isso pela caderneta" + ajuda, em vez de cair
no Gemini (que poderia inventar número); evento `rota:jev:cad_guarda`. Resposta de caderneta pelo
JEV é mascarada no log como a da rota fixa. **Interruptor** `ROTA_JEV_NOVAS=nao` (via `config_fala`)
desliga só as intenções novas. **Medir antes de ligar**: `ler_debug` com `rotaJev:['frase',…]`
devolve regex × JEV por frase sem executar nada (medido em 14/10: 24/24 positivos certos, 0 falso
positivo acima do limiar em 16 controles).

**Swile na caderneta (desde 14/10).** A compra aprovada do Swile ("Compra aprovada de R$ X na carteira … no estabelecimento Y")
é interpretada por `_finParse` e vira um **gasto no voucher/mobilidade da caderneta** (`_finParaCaderneta` →
`Financas.registrarGastoSwile` → `POST /api/jarvis/gasto-voucher`). É a **única escrita** do Jarvis na caderneta, e estreita:
só cria uma Despesa paga com voucher (id `sw_<chave>`; a chave é o id do lançamento do Firestore, então reenvio não duplica),
valor até R$ 5.000, data de hoje ±45 dias, no máximo 60 por 24 h; `/desfazer` só apaga o que o próprio Jarvis criou (`sw_`).
Categoria "Alimentação" (voucher) ou "Transporte" (mobilidade), descrição = estabelecimento. Caderneta fora do ar → o doc
fica `caderneta:'pendente'` e o tick de 15 min reenvia (3 dias); 4xx → `recusado`; estorno → só avisa (`estorno_manual`).
O saldo do Swile falado passa a vir da caderneta (`resumo.vouchers` = recarga informada − gastos do mês); o saldo antigo do
Firestore fica de reserva (`SWILE_FONTE=firestore` volta a ele). A **recarga** ele informa por voz (ver "Ações por voz na caderneta") ou
na caderneta: a notificação de recarga só avisa para registrar. Interruptores: `SWILE_PARA_CADERNETA=nao`,
`SWILE_AVISO_REGISTRO=nao` (notificação "Registrei R$ X em Y"). Teste vivo sem sujar a caderneta: `ler_debug` com
`swileCadernetaTeste:true` (cria R$ 0,01, repete, desfaz) e `swileCaderneta:{titulo,texto}` (mostra o que enviaria). O extrato
("onde gastei") ainda sai do Firestore (só compras com notificação). Código do Worker em `src/swile.js` do app da caderneta.

**Ações por voz na caderneta, com confirmação (desde 14/10) — o molde das fases futuras.** `Financas.conversar` fica no
INÍCIO da cadeia da voz (`_afn`, rota `caderneta_acao`; calada no log e falada pelo aparelho, nunca pela nuvem/Drive). Três
tempos, sempre: **propor** (entende a frase, guarda a proposta 3 min e REPETE o que vai gravar, pedindo sim/não), **confirmar**
(só um "sim" explícito executa; "não" ou o tempo descartam sem tocar em nada), **desfazer** ("desfaz" nos 10 min seguintes).
Cada tipo é um objeto no registro `ACOES` (`propor/executar/desfazer`); banco, ação, gasto por voz entram ali. A primeira é a
**recarga do Swile**: "caiu 1.002,50 no voucher e 67,98 na mobilidade" (ou "recarga de novembro, …"). O mês de uso é o citado
ou, sem citar, o seguinte a partir do dia 20. No Worker (`POST /api/jarvis/recarga-voucher`, `src/swile.js`) usa o MESMO id do
app (`voucher<AAAAMM><alim|mob>`): uma recarga por carteira e mês, e se já existe NÃO altera (devolve o valor que está lá);
mês de uso só anterior/atual/seguinte, até R$ 5.000, 6 por dia; o desfazer só remove recarga criada na última hora. Exige o
rótulo (voucher/mobilidade) junto do número e números em dígitos ("mil" por extenso pede de novo). Fora do JEV de propósito:
extrair valor de fala livre é seleção de número no código, não julgamento. Teste vivo: `ler_debug` com `recargaTeste:true`
(cria R$ 0,01 no mês seguinte, repete, desfaz).

**Gastos avulsos e bancos → caderneta (desde 14/10).** Duas portas para o mesmo `POST /api/jarvis/gasto` do Worker
(`src/gasto.js`; Despesa e só despesa, meios Pix/débito, Cartão de crédito, Dinheiro, Boleto; categorias do formulário do app;
ids `mp_`/`bd_`/`vz_` + chave; até R$ 20.000, 60 por dia; `/desfazer` só apaga esses prefixos):
- **Notificação do banco** (`_bancoParse` + `_bancoParaCaderneta`, chamado ANTES das regras em `_notifAplicarRegras`): registra sozinho
  só os formatos já vistos — Mercado Pago "Você pagou R$ X a Y / vai entrar na próxima fatura" (crédito) e Bradesco "compra com seu
  cartão de débito|crédito final N, de R$ X, em: Y". Pix enviado e "Você pagou" sem a linha da fatura ficam `aguarda_validacao`
  (avisa; ele diz o gasto por voz). Pix recebido, saque, extrato e promoção não são gasto e seguem as regras de sempre. Antes de criar, o
  Worker procura um gasto igual DIGITADO por ele (mesmo valor e meio, ±1 dia, id que não é do Jarvis) e não duplica. Categoria por
  palavras do lugar (`Financas.categoriaDe`), sem pista = Outros. Crédito não mexe no livre (já está na fatura); débito/Pix descontam.
  Mesmo esquema de pendente/recusado/retentativa do Swile; `BANCOS_PARA_CADERNETA=nao` desliga; teste/reprocesso:
  `ler_debug` com `bancoSimular:{app,titulo,texto,executar?,em?}`.
- **Voz com confirmação** (`ACOES.gasto`): "gastei 35 reais no mercado no débito" → "Confirma o gasto de R$ 35,00 em mercado, no débito,
  categoria Mercado, hoje? Diga sim ou não." Sem a forma de pagar ele pergunta; "ontem" muda a data; voucher/mobilidade vão pelo endpoint do
  Swile. Não pega pergunta ("quanto gastei"), nem fatura, aluguel, luz, água, internet, dízimo (têm previsão própria; lançar de novo contaria
  duas vezes). O "desfaz" vale também para o gasto que veio de notificação.

**Aviso financeiro = notificação do MacroDroid + o MESMO texto falado (14/10).** Todo aviso de gasto/entrada/recarga/falha
sai por `_finAvisarCaderneta` → `_avisarDono({falar: texto, falarLocal: true})`: a notificação e a fala são a mesma frase, a fala
vai pela voz do celular (`a.local` em `controlarDispositivo('falar')`; nunca vira arquivo no Drive) e fica só a notificação na janela de
silêncio (22:30–07:00). Cobre: registro de gasto (banco e Swile, com "Diga desfaz para tirar"), estorno, Pix de você mesmo, Pix
recebido (pergunta), recarga do Swile ("Diga os valores…") e falha ao falar com a caderneta (fica pendente e reenvia no tick).

**Entradas (Pix recebido) e receita por voz — sempre com confirmação.** `Pix recebido` do Bradesco/Mercado Pago NUNCA vira receita
sozinho (pode ser transferência entre as contas dele, reembolso, venda): o Jarvis avisa "Você recebeu um Pix de R$ X de Y. Registro como
receita extra? Diga sim ou não." e a proposta espera 15 min (`fin_pend_entrada`). "Sim" grava (`POST /api/jarvis/receita`, tipo
Receita, id `rc_`, categorias do formulário "Receita extra"; "sim, é reembolso" escolhe a categoria; dedup contra receita digitada
igual); "não" descarta. Se o remetente é ele mesmo (`FIN_NOME_DONO`, Script Property com 2+ palavras do nome; não vai ao repositório),
avisa que é transferência entre contas e não pergunta. Por voz: "recebi 450 da Maria no pix" propõe do mesmo jeito (salário,
rendimento, recarga e aluguel têm previsão própria e ficam de fora). "Desfaz" vale para a receita.

**O modelo não grava na caderneta.** Se uma frase de gasto/receita/recarga chegar ao LLM e ele responder "registrei/anotei…", a
resposta é trocada por "Não registrei nada" (14/10: ele disse "Anotado! Registrei o gasto de 35 reais" sem registrar). Repetir o gasto
inteiro enquanto o Jarvis espera a forma de pagar (o `/exec` perde respostas e o app repete) refaz a proposta em vez de cair no modelo.

**Consultor (fase 4, desde 14/10) — a estratégia do dono, não a opinião do modelo.** `Consultor.js`, só leitura e sem Gemini. A
distribuição-alvo vem da própria caderneta (config `meta_alocacao`, devolvida em `resumo.metaAlocacao`); as contas são feitas no código com os
números do resumo. Responde por voz (rota `caderneta`, sempre no aparelho): **"como está minha carteira"** (cada categoria × alvo e qual está mais
abaixo), **"quanto posso aportar este mês"** (livre do fim do mês − margem, dividido pelo alvo SEM vender nada: `dividirAporte`), **simulação**
("se eu aportar 1000 por mês durante 5 anos…", "em quanto tempo chego a 100 mil aportando 1000"), **reserva contra o alvo** ("minha reserva está
suficiente") e **metas** ("como estão minhas metas": progresso e aporte mensal necessário). Taxa e margem são parâmetros, e toda projeção diz
que é estimativa. Parâmetros em Script Properties (via `config_fala`): `CONSULTOR_MARGEM` (R$, padrão 300), `CONSULTOR_TAXA_MES` (padrão
0,008), `CONSULTOR_RESERVA_ALVO` (meses, padrão 6), `CONSULTOR_PAUSA_ATE` (data; o rebalanceamento pausado aparece na resposta). Metas:
"minha meta é casa própria, 150 mil, até 2030" → confirma → `CONSULTOR_METAS` (desfaz restaura). Nada pessoal no repositório.

**Marcar conta como paga por voz (14/10).** "Paguei o aluguel" / "paguei a fatura do Itaú" → o Jarvis acha a conta pelas pendências do mês
(`resumo.obrigacoes[].chave`), repete nome, valor e dia (e avisa se o valor falado difere do da caderneta) e só o "sim" chama
`POST /api/jarvis/pagamento` (mesmo efeito do check do app; só chaves d:/c:/v: que existem naquele mês, mês anterior/atual/seguinte,
idempotente). Ambígua pede o nome; já paga ou paga por outra pessoa não marca; depois diz o livre novo; "desfaz" desmarca. Teste vivo sem
mexer no mês atual: `ler_debug` com `pagamentoTeste:true` (marca/desmarca no mês seguinte). Os handlers do Worker têm teste contra um D1 falso
(`test/handlers.test.js`): uma regex sem barras ("d{4}") deixou o endpoint recusando tudo e só um teste desse nível pega isso.

**"Desfaz" seco nunca vai para o modelo** (ele respondeu "ação cancelada" sem saber de quê): sem nada recente, diz que não há o que desfazer.

**Mais ações por voz na caderneta (14/10), todas no molde propor → "sim" → "desfaz"** (`ORDEM_ACOES` em `Financas.js`):
- **Salário recebido** ("recebi o salário", "caiu o salário"): marca a receita fixa como recebida (`resumo.receitas[].chave` = `r:<id>`, mesmo check do app,
  entra no livre de hoje) por `POST /api/jarvis/pagamento` (que agora aceita `r:` para receitas que existem). Já recebida não marca; "recebi 450 da Maria"
  segue como receita extra.
- **Aplicação e resgate** ("apliquei 500 no cofrinho", "resgatei 300 do CDB"): acha o investimento pelo nome (`resumo.investimentos.itens`), ambíguo pede qual,
  e lança uma Aplicação/Resgate do mês (`POST /api/jarvis/aplicacao`, id `ap_`; o dinheiro sai ou volta para o livre). **Não mexe no saldo do investimento**
  (ele atualiza do extrato), para o mesmo dinheiro não ser contado duas vezes. Destino fora da lista fica como ele disse.
- **Saldo de investimento** ("atualiza o saldo do CDB para 20.800"): mostra antes → depois (e avisa se a mudança passa de 30%), o sim troca o saldo de UM
  investimento que existe (`POST /api/jarvis/investimento`, `src/movimentos.js`); o desfaz devolve saldo E data de atualização de antes.
- **Ajustar o consultor** ("muda a margem para 500", "taxa de 1% ao mês", "reserva alvo de 8 meses", "pausa o rebalanceamento até janeiro de 2027", "retoma o
  rebalanceamento"): grava as `CONSULTOR_*` com confirmação; desfaz restaura.
- **Metas**: criar, **editar** ("muda a meta casa para 180 mil até 2031", acha por nome parcial) e **apagar** ("apaga a meta casa"), com confirmação.

**"Desfaz" com log de 3 dias.** Cada ação que grava deixa um registro em `FIN_LOG_ACOES` (até 20, 3 dias, com a descrição). Dentro de 10 min "desfaz" é direto;
depois, o Jarvis diz o que foi e há quanto tempo ("A última ação foi há 2 horas: a aplicação de R$ 500,00 em CDB Plus. Desfaço?") e só o "sim" desfaz.
"O que você registrou" lista as últimas três. O Worker deixa desfazer recarga por 72 h (antes 1 h). Sem nada no registro: "Não há nada para desfazer nos últimos 3 dias".

**Consultor via JEV (14/10).** `cad_carteira`, `cad_aporte`, `cad_reserva_alvo` e `cad_metas` entram no roteador semântico (limiar de leitura 0,70, mesmo interruptor
`ROTA_JEV_NOVAS`, resposta mascarada no log). Simulação e "em quanto tempo chego a X" ficam só nos padrões (precisam de número). Medido com `rotaJev` em 30
frases: as 19 positivas (paráfrases de carteira, aporte, reserva, metas e as perguntas de sempre) acertaram; nenhum dos controles ("me dá uma ideia de
investimento", "devo comprar fundo imobiliário", "qual o melhor investimento pra mim", "minha meta é viajar 20 mil", simulação…) acionou intenção de consultor.

**Aviso mensal do consultor e "aportei" (14/10).** `Consultor.verificarAporte`, no tick de 15 min, das 9h às 20h: quando o livre PREVISTO para o fim do mês
passa da margem (e de `CONSULTOR_AVISO_MIN`, R$ 100), o Jarvis notifica E fala o mesmo texto — quanto dá para aportar e onde, pelo alvo e sem vender nada —
**uma vez por mês** (`CONSULTOR_AVISO_MES`, gravado ANTES de enviar). Só avisa depois que as receitas fixas do mês foram marcadas como recebidas (a previsão
conta um salário que ainda não caiu) ou a partir do dia 20. Guarda a sugestão em `FIN_APORTE_SUGERIDO` (3 dias). Quando ele diz **"aportei"** / "fiz o aporte",
o Jarvis repete a divisão e, no "sim", lança uma Aplicação por destino (`ap_<id>_<n>`); "aportei 800" refaz a divisão na mesma proporção; "aportei 500 no tesouro"
(com destino) é a aplicação comum; sem sugestão guardada calcula o plano de agora; "desfaz" tira todos os lançamentos do aporte. Interruptor
`CONSULTOR_AVISO_ATIVO=nao`; `ler_debug` com `consultorAviso:'ensaio'` mostra o que avisaria agora (sem enviar nem gravar) e `'teste'` envia de verdade um aviso
com números inventados (o "aportei" que se segue não grava nada).

**Destino do aporte durante a pausa do rebalanceamento (14/10).** Com `CONSULTOR_PAUSA_ATE` no futuro e `CONSULTOR_DESTINO_PAUSA` configurado, o plano de aporte (aviso mensal e "aportei") manda o aporte INTEIRO para esse destino em vez de dividir pelo alvo: "…O rebalanceamento está pausado até janeiro de 2027, então o aporte inteiro vai no cofrinho do Mercado Pago." O "aportei" confirma um destino só e lança UMA Aplicação com o nome dele. Passada a pausa (ou sem destino configurado) volta a dividir pelo alvo. O destino é `{rotulo, descricao}` e se configura por voz, com confirmação e desfaz: "o destino da pausa é o cofrinho do Mercado Pago" (o rótulo vira "no cofrinho do Mercado Pago"); "tira o destino da pausa" remove. Estado em 14/10: destino = cofrinho do Mercado Pago, pausa até 01/01/2027.

**Acompanhamento: comparação com a inflação e resumo do mês (14/10).** Duas respostas novas do consultor, só leitura:
- **Rendimento × IPCA, CDI e poupança** ("meus investimentos estão rendendo mais que a inflação?", "bati o CDI esse ano", "quanto rendeu minha carteira esse ano"): o rendimento do ano vem da
  caderneta (`investimentos.rendimentoAno`) e o percentual é APROXIMADO (rendimento ÷ saldo de começo, sem descontar aportes — a frase diz isso). Os índices são as séries PÚBLICAS do
  Banco Central (SGS: IPCA 433, CDI mensal 4391, poupança 195, ponto do dia 1), acumulados no ano e em cache por 6 h. **O BCB só responde com `User-Agent` de navegador** (sem ele devolve uma
  página HTML). Rede ou série fora do ar → compara só com o que veio, ou diz que não conseguiu os índices; nunca inventa.
- **Resumo do mês** ("como foi o mês", "balanço do mês", "como foi setembro"): renda, saídas, sobra antes de aplicar, aplicado/resgatado (`resumo.aplicado`) e previsão do fim do mês,
  com a comparação da sobra com o mês anterior (só se o anterior tem dados). Mês nomeado usa o resumo daquele mês (o futuro cai no ano passado).
Os dois também entram no JEV (`cad_indices`, `cad_mes`), com o mesmo interruptor `ROTA_JEV_NOVAS`. Ainda sem notificações do **Itaú** no Jarvis: só chegam Swile, Mercado Pago e Bradesco; para espelhar o
Itaú (e ações) é preciso incluir o app no filtro da macro e ver o texto REAL das notificações antes de escrever o parser. `ler_debug` com `financeiroAmostra:true` mostra, por app, os formatos guardados.

**Fechar e reabrir o mês por voz (14/10).** "Fecha setembro" / "fecha o mês" (o anterior) → o Jarvis repete renda, saídas, sobra e o livre que passa para o mês seguinte,
avisa das contas ainda sem marcar como paga ("Atenção: ainda há 2 contas…") e só o "sim" fecha (`POST /api/jarvis/fechar-mes`, `acao: fechar|reabrir`). O retrato é o MESMO do botão
do app: `snapshot()` em `src/calculos.js`, com teste de paridade contra o `app.js` (`test/paridade.test.js`), porque o livre de um mês fechado fica congelado e vira o ponto de partida
do seguinte. Regras do Worker: só mês que já terminou, desde o início da caderneta (`config.saldo_inicio`) e até 12 meses atrás; mês já fechado NÃO é refeito por voz
("Atualizar retrato" é no app). "Desfaz" de um fechamento reabre; "desfaz" de uma reabertura fecha de novo. `ler_debug` com `fecharMesProva:true` prova que o endpoint
recusa fechar o mês em curso / futuro / ação inválida sem mexer em nada. **Não houve fechamento real por voz ainda**: setembro já estava fechado e refazê-lo trocaria o retrato histórico;
o primeiro real será outubro, a partir de 1º de novembro.

**Itaú (14/10).** O app do Itaú entrou no filtro da macro, mas as primeiras notificações reais ainda não tinham chegado quando isto foi escrito; o parser exato foi escrito
em cima dos textos REAIS da caixa de notificações do app (título + corpo): "Pix recebido | Você recebeu R$ X de NOME, CPF XXX.nnn.nnn-XX." · "Feito. Pix enviado | Você enviou R$ X para NOME, CPF …" ·
"Pagamento recebido! | Recebemos o pagamento no valor de R$ X!…" (pagamento da FATURA do cartão). Fechamento de fatura, "fatura fechou" e boleto seguem as regras de sempre. O CPF vem mascarado:
os 6 dígitos do meio, comparados com `FIN_CPF_DONO` (Script Property), identificam o Pix para ELE MESMO (transferência entre contas: só avisa, não vira receita nem gasto).
Nada do Itaú registra sozinho: Pix recebido de outra pessoa pergunta a receita extra; Pix enviado a outra pessoa pergunta o gasto (origem `it`, id `it_`, com dedup); **pagamento recebido** acha a fatura ABERTA
de mesmo valor e pergunta "Marco Fatura X como paga?" (o sim usa a mesma ação de "paguei a fatura"; sem fatura de mesmo valor só avisa). Compra no cartão do Itaú ainda não apareceu em texto real:
segue o caminho genérico (um valor + palavra de compra, pergunta a forma de pagar). Valor que não dá para interpretar guarda o texto bruto (`tipo:banco_desconhecido`) e avisa. O app Itaú Investimentos
fica de fora (ações vêm depois). Se o texto do PUSH diferir do da caixa de notificações, cai no genérico/desconhecido em vez de errar; `ler_debug` com `financeiroAmostra:true` mostra os textos guardados.

**JEV além da caderneta (14/10).** O JEV (TypeSafe) deixou de ser só o roteador de intenções e ganhou cinco papéis, todos com interruptor em Script Property
(trocável por `config_fala`, lista fechada) e todos em fail-open: sem chave ou sem rede, vale exatamente o comportamento anterior.
1. **Pré-filtro de ferramentas** (`FERRAMENTAS_JEV` = `nao`|`adiciona`|`sim`, ligado em `sim`): o filtro por intenção de `_toolsPermitidas` era só regex. Agora uma requisição ao JEV
pergunta, por domínio (agenda, e-mail, Drive, tarefas, contatos, formulários, imagem, dispositivo, celular, Bíblia, web, lembrete por lugar, Swile, notificações, objetivos, segundo
cérebro), "o pedido precisa destas ferramentas?". `adiciona` abre o que a regex perdeu (≥ 0,60); `sim` também FECHA o que ela abriu à toa (≤ 0,08). O núcleo nunca sai; autorizações
e skills/scripts ficam só na regex (segurança); agendamento segue com o portão próprio. A pergunta recebe as últimas 3 mensagens, senão "e amanhã?" seria cortado. Medido ao vivo:
~300–550 ms, fechou 11 de 11 grupos que não eram necessários (14→10 ferramentas) e achou as paráfrases sem palavra-chave. Evento `gate:jev:ferramentas` (+abriu/−fechou);
`ler_debug` com `ferramentasJev:[frase | {frase, anterior:[...]}]` mede sem chamar o Gemini.
2. **Sim/não por intenção** (`TypeSafe.respostaSimNao`, `CONFIRMA_JEV`): com proposta aberta (gasto, Pix recebido, compra do Itaú, oferta de insight) e a regex sem pegar
("manda ver", "fechado", "melhor deixar quieto"), o JEV julga com a pergunta como contexto. "Sim" exige confiança 0,85 (grava dinheiro); "não" 0,70; dúvida ou "outra coisa" segue o
fluxo normal. Frases de mais de 12 palavras e "desfaz" não vão ao JEV. Evento `confirma:jev`.
3. **Categoria de gasto** (`CATEGORIA_JEV`): lugar que a lista de palavras não conhece vai ao JEV, que escolhe entre as categorias do app com "outros" de saída (≥ 0,80).
4. **Anti-injeção em 2ª camada** (`INJECAO_JEV`): onde a regex `_RE_INJECAO` dá negativo, o JEV julga se o texto dá ordens a uma IA. (a) Canal não confiável (anexo/terceiro): vira a
nota defensiva de sempre. (b) Resultado de `lerPagina`/`lerEmail`: ganha o campo `aviso_seguranca`; o texto não é alterado. Medido: 12/12. Nunca bloqueia; evento `hook:injecao_conteudo`.
5. **Anti-ação-inventada** (`ACAO_JEV`): pós-hook que generaliza o da agenda. Resposta curta com verbo de ação feita ("enviei", "agendei", "registrei") em turno SEM ferramenta bem-sucedida:
o JEV confirma se ela afirma ter executado algo (≥ 0,85) e então recebe o aviso "essa ação NÃO foi executada". Medido: 10/10. Evento `hook:acao_sem_fonte`.
6. **Controles do celular no roteador** (mesmo interruptor `ROTA_JEV_NOVAS`): `midia_pausar`, `midia_tocar`, `midia_proxima`, `midia_anterior`, `volume` (nível numa pergunta própria: mudo/baixo/médio/alto;
"indefinido" não age), `lanterna`, `naoperturbe_ligar`/`_desligar`. A regex de `_ctl` só pega "pausa/pula/volume" literais; "chega de música por agora", "tá alto demais", "preciso de uma luz aqui" iam ao modelo (20 a 160 s).
Agora o JEV só diz QUAL comando e o código chama `controlarDispositivo` com os mesmos argumentos e as mesmas frases da regex. Ação: limiar 0,85, só por voz; falha do celular é dita ("Não consegui agora"), nunca afirmada.
Medido em 33 frases: 20 de 23 positivas agiram (as 3 abaixo de 0,85 seguem para o modelo), 0 falso positivo em 10 controles ("toca Legião Urbana", "abre o spotify", "a lanterna está ligada?"). Evento `rota:jev:<intenção>`.
7. **Triagem do monitor de Gmail** (`Monitor.triar`, `MONITOR_GMAIL_JEV`, corte `MONITOR_GMAIL_JEV_CORTE` 0,15): os e-mails novos passam por UMA requisição ao JEV ("merece avisar o dono, dado o objetivo do monitor?"). Newsletter,
promoção e vaga genérica (JEV ≤ 0,15) não gastam o Gemini nem geram notificação; na dúvida avisa; sem chave/rede nada é descartado; o corte de tempo avança mesmo quando tudo é ruído. Medido: 4 ruídos descartados de 10
e-mails, todos os relevantes mantidos (boleto, colega, alerta de segurança, escola, Pix). Evento `monitor:triagem`; `ler_debug` com `triagemGmail:[{de,assunto,trecho}]` mostra sem avisar.
8. **Triagem do monitor de páginas** (`Web.julgarMudanca`, `WEB_MONITOR_JEV`, corte `WEB_MONITOR_JEV_CORTE` 0,15): o monitor passou a guardar o TEXTO da página (`texto`, 6000 caracteres) além do hash. Quando o hash muda,
compara as linhas que entraram e saíram e o JEV julga se a mudança importa para o que o dono descreveu ao monitorar ("preço do monitor Dell"). Data, contador, anúncio, banner de cookies e itens recomendados trocados (≤ 0,15) não notificam
(evento `web:triagem`); mudança real notifica COM o resumo das linhas novas ("Mudou: Preço: R$ 999,90"). Monitor antigo, sem texto guardado, avisa como antes na primeira mudança e passa a guardar o texto; sem chave/rede, avisa.
Medido: 7/7 (preço, estoque e inscrição aberta avisam; visitas, hora, ofertas e cookies calam; "ofertas do dia" ficou em 0,11, perto do corte).
9. **Voto do insight por JEV** (`TypeSafe.votoFeedback`, limiar 0,80, mesmo `CONFIRMA_JEV`): dentro da janela de feedback e com frase curta, "foi bem legal essa dica" vira 👍 e "já sabia disso" vira 👎 quando a regex não pegou. Medido: 17/18
(só "para de falar desse assunto" ficou sem voto; nenhuma frase de controle votou). A regex "bom dia" não vota mais 👍.
10. **Portão de agendamento com contexto**: o portão antigo (`_intencaoAgendamento`) também recebe as últimas 3 mensagens. Achado ao acompanhar os eventos reais: "e amanhã também" abria `agendarAlertaVoz`; com a conversa, não abre mais
(sem conversa continua ambíguo, e a ferramenta só é oferecida, o modelo decide).
Diagnósticos: `ler_debug` com `ferramentasJev` (agora mostra `criaAgenda`), `injecaoJev:[textos]`, `acaoJev:[respostas]`, `categoriaJev:[lugares]`, `triagemGmail`, `triagemPagina:[{antigo,novo,descricao}]`, `votoJev:[frases]` (nada é executado).
**Controle otimista nas escritas da caderneta (14/10, do post "Bidirectional Writeback" de Tanaike).** Entre o Jarvis repetir a proposta e o "sim" passam até 3 min (15 nas de banco); se o dado mudou no app nesse
intervalo, gravar pisaria na correção. Agora a proposta carrega o que foi dito e o Worker confere: `/api/jarvis/investimento` aceita `saldo_esperado` (a condição vai NO UPDATE, atômica: `WHERE ABS(saldo - ?) < 0.005`) e
`/api/jarvis/pagamento` aceita `valor_esperado` (o valor que ele ouviu da conta ou do salário). Divergência → **409** com `{conflito:true, atual}`, NADA é gravado, e o Jarvis diz o valor novo ("O saldo de X mudou na caderneta desde que
eu falei (agora R$ …)"). O "desfaz" do saldo também confere (só volta se o saldo ainda é o que o Jarvis gravou). Sem o campo, o Worker se comporta como antes (compatível com um Jarvis antigo). Prova ao vivo sem gravar:
`ler_debug` com `occProva:true` (409 nos dois endpoints). Meta e ajustes do consultor vivem em Script Properties, não no Worker, e ficaram de fora.

**Modo privacidade no web app (14/10).** Botão do olho na barra superior (ou **Ctrl+Shift+P**), lembrado em `localStorage` (`jarvis-priv`): borra o CONTEÚDO (texto e imagem das mensagens, cartões do dashboard, resumo do dia, lista de conversas, nome e
e-mail, instâncias do WhatsApp) e deixa a interface legível, para gravar demonstração (o repositório é vitrine). O que o apresentador digita no campo de mensagem continua visível. `html.priv` em `Stylesheet.html`; qualquer elemento novo entra com
`data-sensivel`. `tests-local/privacidade-ui.test.js` amarra cada seletor borrado a uma classe que a interface realmente gera (renomear `msg__text` sem atualizar o CSS faria o vídeo vazar dado sem erro nenhum).

**Busca semântica no Drive (`BuscaDrive.js`, 14/10, do post "Serverless Multimodal Vector Search" de Tanaike, sem BigQuery/Iceberg).** Ferramenta do agente `buscarArquivosDrive({consulta, tipo?, max?})` (só dono): devolve nome, tipo, data e o LINK do arquivo vivo,
por SIGNIFICADO ("o documento sobre o aluguel"). A Semantica.js continua sendo a busca da wiki. Diferenças deliberadas: 1 vetor por ARQUIVO (nome + tipo + 2.500 caracteres do texto), **quantizado em int8** (~1 KB por arquivo em vez de ~10 KB), guardado num
índice único `indice-busca-drive.json` no Drive (`BUSCA_DRIVE_INDICE_FILE_ID`), sem Firestore e sem o teto de 1.000 docs; a busca lê UM arquivo, centraliza os vetores (mesma correção de anisotropia da Semantica) e dá um empurrão pequeno a nome que contém a palavra.
Só entra texto que o Workspace lê de graça: Docs, Slides, Sheets (cabeçalho + primeiras linhas), .txt/.md/.csv; **PDF e imagem entram só pelo nome** (`parcial:true`; ler o conteúdo exigiria OCR e queimaria cota). Ficam de fora a lixeira, a pasta da wiki e nomes que casam
com `BUSCA_DRIVE_EXCLUIR` (regex em Script Property). **Privacidade:** o texto vai ao Gemini SÓ pela chave de faturamento (`Gemini.embeddar(..., {soPago:true})` recusa se só houver chave gratuita, que pode usar conteúdo para melhorar produtos); o índice guarda vetor, nunca texto.
Indexação: `BuscaDrive.tick()` no tick de 15 min (Agenda.js), **desligada por padrão** (`BUSCA_DRIVE_ATIVA=sim` liga, via `config_fala`); lote de ~40 arquivos / 70 s, RESUMÍVEL por token do iterador, incremental por `modifiedDate`, com varredura completa a cada 7 dias que remove o que saiu do Drive.
Medido ao vivo: ~6 s por arquivo (leitura do Workspace + embedding), então um Drive de milhares de arquivos leva dias no tick; 120 arquivos indexados à mão em 14/10. Sem índice, a ferramenta cai na busca de texto do próprio Drive e avisa que é por palavra-chave. `ler_debug` com `buscaDrive`:
`true` (status) · `{consulta,k,tipo}` (busca) · `{rodar:true,maxArquivos}` (indexa um lote) · `{simular:true}` (conta sem gravar) · `{limpar:true}`.

**Correções achadas nos logs reais de 14–15/10 (primeira compra do Swile depois da migração: registrou certo; o resto do log mostrou isto).**
- **`buscarConhecimento` levava 13–16 s** em perguntas simples ("o que falta eu fazer"): o agente passava a FRASE inteira como termo, o Drive não a achava e `WikiMemoryService.buscarNoWiki` caía numa varredura recursiva de 30 arquivos que nunca poderia
  casá-la (12,9 s medidos por `ler_debug` com `tempoConhecimento`). Frase de mais de 4 palavras agora volta vazia SEM varrer (35 ms); o semântico cobre linguagem natural.
- **Ferramentas de conhecimento fora do núcleo quando o JEV tem certeza** (modo `sim`): nova pergunta "precisa consultar o que ele guardou?"; com probabilidade ≤ `FERRAMENTAS_JEV_REMOVE_CONH` (0,15 em produção) saem `buscarConhecimento`,
  `buscarSemantico`, `lembrarDeConversas` e `buscarNoWiki`. Medido em 18 frases: nenhuma pergunta sobre o que ele anotou/guardou perdeu a ferramenta; pedidos de agenda, spotify, lanterna e hora perderam. "o que falta eu fazer" ainda não é cortada (o JEV a acha ambígua).
- **Rota com o pedido repetido pelo reconhecimento de voz** ("Rua José rota para Rua José Pereira 185 no Estoril" virou o destino inteiro): `_destinoDoPedido` agora usa o que vem depois do ÚLTIMO "rota/ir/me leva … para".
- **Monitor de páginas:** título decodificado ("&amp;" → "&") e resumo da notificação com as linhas mais informativas (a notificação veio com três datas, "Sep 15, 2026 | …").
- **Gastos por categoria na caderneta** (pedido real que caiu em "Ainda não sei responder" e depois no modelo): o Worker passou a mandar `resumo.gastosMes` (total, por categoria com quantidade e maior lançamento, 5 maiores; só DESPESAS lançadas no mês, inclusive as pagas no voucher; faturas e contas fixas ficam de fora).
  O Jarvis responde "liste os gastos fora de mercado e alimentação", "quanto gastei com saúde", "gastos por categoria" (padrão em `Financas._interpretarGastos`, antes da exclusão do Swile, só com sinal explícito) e, por paráfrase, a intenção JEV `cad_gastos` com a categoria numa pergunta própria.
  "Quanto gastei essa semana" e "onde gastei" continuam sendo do Swile; mercado continua no orçamento.
- **Instrumentação:** `Heartbeat.medir` guarda QUANDO foi o pico de cada gatilho (`maxEm`). Ontem o `tickAlertasVoz` teve um pico de 220 s sem causa conhecida; compare `maxEm` com os eventos.

**O Gemini TTS FALAVA a instrução de estilo (15/10).** O briefing da manhã abria com "Leia em voz alta em tom de narrador sério estilo jornalista de telejornal. Bom dia, Bruno…". `Voz.sintetizarGemini` montava `'Leia em voz alta em ' + estilo + ': ' + texto` e o modelo lite lia o prefixo
como se fosse texto. Provado transcrevendo o áudio com Cloud Speech (`ler_debug` com `ttsEco`, que sintetiza a abertura com variantes de prompt, transcreve e, com `julgarTom:true`, pede ao Gemini que OUÇA e classifique o tom). Medido: "Leia em voz alta em …:" e "Diga em …:" → falados;
"Say in …:" → falado e deturpado; `[tag]` → não fala mas o tom é inconstante; `systemInstruction` → HTTP 400 neste modelo; **perfil + transcrição** (`# PERFIL DE ÁUDIO
Estilo: …

## TRANSCRIÇÃO
<texto>`) → não fala E o tom obedece. Agora é o formato de `_promptTts`; vale para TODA fala pelo Gemini TTS
(briefings, despertador, lembrete de ponto e o que mais usar o motor gemini), que tinham o mesmo prefixo. Sem estilo, a voz Iapetus já soa séria; o `TTS_STYLE` em produção era "tom de narrador serio, estilo jornalista de telejornal" e passou a "caloroso, simpático e acolhedor, como quem dá bom dia a um amigo"
(`config_fala` aceita `TTS_STYLE`, até 120 letras; voltar é só gravar o texto antigo). O conteúdo do briefing (a 1ª frase sobre tempo e alertas) não foi mexido.

**Acompanhar o JEV na produção:** `ler_debug` com `n:200` e filtrar os eventos `gate:jev:ferramentas`, `gate:jev:agenda`, `confirma:jev`, `hook:acao_sem_fonte`, `hook:injecao_conteudo`, `monitor:triagem`, `web:triagem`, `rota:jev:*`
(os `hook:acao_sem_fonte` de 14/10 22:02 são do ensaio `acaoJev`, não de uso real).
Revisão diária automática: tarefa agendada `revisao-diaria-jev` (todo dia ~08:40, só leitura, roda enquanto o app Claude estiver aberto; se estiver fechado, roda na próxima abertura). Ela executa `node diagnostico_jev.js 24` (lê os eventos, sem segredo no arquivo: o token vem do `diagnostico.js`, que está no .gitignore) e relata acertos, falsos positivos e latência.

**Fila de falas** (`controlarDispositivo('falar')`): a fala nova espera a anterior
acabar, **fora do lock**, em passos de 15 s, até 110 s. A duração vem do áudio (WAV
do Gemini = bytes/48 ms; OGG ≈ 14 caracteres/s; teto 150 s). Antes dormia no
máximo 30 s com o lock na mão e passava por cima de briefings longos (13/10).
Briefing perdido: `ULTIMO_BRIEFING` guarda o texto do último falado, e a voz
"repete o briefing" (`repetir_briefing`) agenda a repetição em 1 min; sem nada
guardado, refaz um novo. Se o áudio parar no meio sem fala por cima, procurar
`Killing ... com.arlosoft.macrodroid` no `adb logcat`: em 13/10 a Play Store
atualizou o WebView e o Android matou o MacroDroid.

**Lembrete de ponto cede ao Sisponto (14/10).** Ele bateu o ponto às 14:00:29 e o lembrete das 14:00 saiu às 14:01
(o tick é de 1 min). Agora o tick de `AlertasVoz`, antes de falar um alerta `tag:'ponto'`, pergunta a `_pontoJaRegistrado`
se o Sisponto notificou entre 30 min antes do horário e agora; se sim, cala, marca o dia e deixa o evento
`alertaVoz:suprimido`. Fail-open: sem ler as notificações, lembra como antes. A cobrança de ausência já olhava isso.

**Folga e feriado** (`folga_ponto`): "hoje é feriado / não trabalho hoje / amanhã
estou de folga" grava o dia em `PONTO_FOLGAS` ("cancela a folga de amanhã" tira); o tick e a cobrança "ponto
ausente" calam nesse dia. O Jarvis não pula o ponto sozinho em feriado (ele pode
trabalhar); o despertador só avisa "Hoje é feriado nacional: X". `PONTO_PAUSA_ATE`
continua valendo para férias.

**Briefing sem fonte não entra**: pesquisa sem páginas lidas é descartada, e as
três buscas rodam em paralelo (`Gemini.pesquisarWebVarias`). Evento
`briefing:inicio` marca o começo; início sem `alertaVoz:briefing*` depois = a
execução morreu no teto de 6 min.

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
  (o repo tem 366 desde 14/10 — a frase segue verdadeira como piso);
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

366 testes offline (sem cota, sem rede) sobre a lógica determinística: MODO
DIRETO, gate sem-cota, hooks, parsing de turno/briefing, validação de prefs,
ordenação dos cards, cadeia da voz, lembrete relativo e alertas de uma vez só,
`_urlParaMacro`, `lerBiblia`, briefing com dados reais e trava de agenda
inventada (`tests-local/briefing.test.js`), despertador composto, teto de
caracteres da voz no briefing e autodiagnóstico sem alarme de app raro
(`tests-local/dia-0110.test.js`). `tests-local/gas-shims.js` simula as
APIs do GAS (`formatDate` é fixo: teste que depende de horário injeta o seu).
`tests-local/jev-caderneta.test.js` cobre o roteador semântico novo (JEV simulado, interruptor, máscara de log).
Estado em 14/10/2026: **366/366 passando** (mais 34 do Worker da caderneta, `npm test` na pasta `app`).

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
