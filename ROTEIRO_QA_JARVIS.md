# ✅ Roteiro de Execução — QA do Jarvis (ordem ideal + o que observar)

> Companheiro do `TESTES_JARVIS.md`. Aqui está a **ordem ideal de execução** de uma rodada completa e, em cada bloco, **o que observar** (o sinal de "passou" e a **assinatura de bug**). Marque o Status direto no `TESTES_JARVIS.md`.
>
> **Build alvo:** b37 · **URL:** `/exec` `<DEPLOYMENT_ID>` (NUNCA testar no `/dev`).
> **Princípio:** começar barato (leitura) → escrita reversível → ações externas (com confirmação) → assíncrono → segundo número. **Dispare o que é assíncrono cedo** (Jobs/Objetivos avisam no WhatsApp ~1-2 min depois) e siga testando enquanto roda.

---

## 🔁 Fluxo macro (visão de 1 tela)

```
Fase 0  Saúde do ambiente (editor)        ── porteiro: se algo falhar aqui, pare e conserte
Fase 1  Smoke UI (sem IA)
Fase 2  Cérebro/leitura (wiki, web, conversa)
Fase 3  Multimodal (anexos)
Fase 4  Imagem
Fase 5  Workspace + CT-e (escrita reversível)
Fase 6  Skills/subagentes
⏳ DISPARE AQUI os assíncronos da Fase 8 (objetivo + ingestão grande) e siga ↓
Fase 7  Confirmação P2 + WhatsApp saída
Fase 8  Segundo plano (Jobs + Objetivos) — colher os avisos no WhatsApp
Fase 9  Proatividade (forçar ticks no editor)
Fase 10 WhatsApp inbound (segundo número)
Fase 11 Histórico + Segurança/Zero-Trust
```

---

## Fase 0 — Saúde do ambiente _(editor GAS, ~5 min)_ 🚪

**Roda os diagnósticos antes de qualquer chat.** Se um falhar, conserte antes de seguir.

| Ordem | Função                      | ✅ Passou se…                                     | 🐞 Bug se…                                  |
| ----- | --------------------------- | ------------------------------------------------- | ------------------------------------------- |
| 0.1   | `diagGemini()`              | "Teste ao vivo OK via …/gemini-2.5-flash"         | erro de chave/modelo, ou modelo ≠ flash     |
| 0.2   | `testarFirestore()`         | "Firestore OK"                                    | 4xx/timeout (SA/regra)                      |
| 0.3   | `testarWikiMemoryService()` | lista pastas + index.md                           | wiki vazia / ID errado                      |
| 0.4   | `listarSkillsJarvis()`      | N skills (>0)                                     | 0 skills (BASE_CONHECIMENTO_DRIVE_ID)       |
| 0.5   | `testarVoz()`               | "✅ OK" (OGG gerado)                              | 401 (SA/escopo TTS)                         |
| 0.6   | `autorizarGatilhos()`       | "permissão concedida"                             | pede re-auth → conceda e feche/reabra a aba |
| 0.7   | Painel WhatsApp             | **MyInstance `open`** + número + **✅ Bot ativo** | `close`/sem número → reconectar QR          |

> **Observar geral:** `usarModeloRobusto()` ativo (flash). Se o editor mostrar código antigo, **feche e reabra a aba** (Ctrl+R não basta).

---

## Fase 1 — Smoke UI (sem IA) _(~3 min)_

**Testes:** 1.1→1.8.
**Observar:** tema ☀️/🌙 persiste no reload; sidebar anima e mantém estado; **cada balão tem `HH:MM:SS`** e o do assistente tem **`⏱ respondido em X.Xs`**. 🐞 _Bug:_ timestamp some ao reabrir conversa salva (ver 9.2).

---

## Fase 2 — Cérebro / leitura _(chat barato, ~6 min)_

**Ordem:** 2.1 → 2.2 → 2.4 → 2.3 → 2.5 → 7c.1 → 7c.2 → 7c.3 → 7c.4.
**O que observar (o ponto central da inteligência):**

- 2.1–2.5: **chama `listarWiki`/`buscarNoWiki`/`lerWiki`** e **cita a página**. 🐞 _Bug:_ responde de cabeça sem ir à wiki, ou inventa nome de arquivo.
- 7c.1/7c.2: **chama `pesquisarWeb`** e **traz fontes** (links). 🐞 _Bug:_ responde info desatualizada sem buscar.
- 7c.3: responde **rico, sem forçar wiki** (conhecimento geral). 🐞 _Bug:_ tenta `buscarNoWiki` numa pergunta conceitual genérica.
- 7c.4: **vai à wiki** (memória pessoal).
- **Escolha de fonte correta** (web=atual · próprio=geral · wiki=pessoal) é o critério-chave desta fase.
  Bloco A — Memória/Wiki (deve ir ao wiki)
  2.1

Liste o que existe no meu wiki.
→ tool listarWiki · espera estrutura de pastas. 🐞 se inventar pastas.

2.2

O que existe na pasta concepts do wiki?
→ listarWiki("concepts") · lista os .md. 🐞 se "não encontrei" (verificar se a pasta existe).

2.4

Leia a página concepts/function-calling.md
→ lerWiki · conteúdo do arquivo. (se esse arquivo não existir no seu wiki, troque pelo nome de um .md que apareceu no 2.2)

2.3

O que você sabe sobre function calling?
→ buscarNoWiki→lerWiki · resposta citando a página. 🐞 se responder de cabeça sem buscar.

2.5

Resuma o projeto Soft Web App em 3 frases.
→ buscarNoWiki/lerWiki · resumo coerente baseado na wiki.

Bloco B — Conhecimento atual/conversa (NÃO deve forçar wiki)
7c.1

Qual a última versão dos modelos Gemini e o que mudou?
→ pesquisarWeb · resposta atual com fontes/links. 🐞 se responder desatualizado sem buscar.

7c.2

Quais as principais notícias de IA desta semana?
→ pesquisarWeb · manchetes recentes + fontes.

7c.3

Explique com profundidade RAG vs fine-tuning, com exemplos.
→ conhecimento próprio (sem tool) · resposta rica. 🐞 se ficar forçando buscarNoWiki numa pergunta conceitual.

7c.4

O que você sabe sobre o meu projeto Soft Web App?
→ buscarNoWiki · vai à memória pessoal (wiki).

Memória (escrita + ingestão)
2.6

Anote no wiki: validei a edição e composição de imagens hoje (Fase 4 ok).
→ escreverWiki + append no log.

2.7 — dispara job de 2º plano

(anexe um PDF) → Resuma e faça a ingestão na wiki.
→ botão "📥 Ingerir na wiki" / ingestão async → colher o aviso depois (Fase 8).

---

## Fase 3 — Multimodal (anexos) _(~6 min)_

**Ordem:** 6.8 (credencial — faça primeiro p/ confirmar o bloqueio) → 6.1 → 6.2 → 6.3 → 6.4 → 6.5.
**Observar:**

- 6.8: anexo com cara de segredo → **🔒 bloqueado**, NÃO sobe ao Drive nem à IA. 🐞 _Bug crítico:_ passou.
- 6.1/6.2 (imagem): OCR/descrição coerentes. 6.3 (PDF): síntese fiel. 6.4 (CSV): lê colunas + insights.
- 6.5 (áudio .ogg/.mp3/.wav): **transcreve e responde ao conteúdo**. 🐞 _Bug:_ responde "[áudio]" sem transcrever. **.m4a do celular pode falhar** (esperado — usar WhatsApp/OGG).
- 🎤 (6.6/6.7): opcional; desktop pode cair no seletor de arquivo (esperado).
  6.8 — Bloqueio de credencial (faça PRIMEIRO)
  Anexe um arquivo com cara de segredo — ex.: um .json de service account, ou um .txt contendo algo como private*key/AIza.../ghp*....

(só anexar; pode mandar sem texto ou com "ingira isso")
✅ Passou: 🔒 bloqueado — não vai à IA nem ao Drive (chip de aviso).
🐞 Bug crítico: se ele processar/subir. (Use um arquivo fake, não um segredo real.)

6.1 — OCR (imagem com texto)
Anexe uma imagem com texto (print, nota, placa).

Faça OCR e me diga o que diz.
✅ texto extraído fielmente.

6.2 — Visão (descrição)
Anexe uma foto qualquer.

Descreva a imagem e me diga se há algo de errado.
✅ descrição visual coerente.

6.3 — PDF
Anexe um PDF (artigo/relatório).

Quais os pontos principais deste documento?
✅ síntese fiel ao conteúdo.

6.4 — CSV/planilha
Anexe um .csv.

Resuma as colunas e me dê 3 insights.
✅ análise tabular (entende colunas/linhas).

6.5 — Áudio (transcrição)
Anexe um áudio .ogg / .mp3 / .wav / .aac (sem digitar texto).

(só anexar o áudio)
✅ transcreve e responde ao que foi falado.
⚠️ .m4a do celular pode falhar (esperado) — se quiser testar o caminho confiável, mande um áudio pelo WhatsApp (isso entra na Fase 10).
(6.6/6.7 — botão 🎤 — são opcionais; no desktop pode cair no seletor de arquivo, o que é esperado.)

🎙️ Comando /voz (novo)
No chat, digite:

## /voz

## Fase 4 — Geração de imagem _(~3 min)_

**Teste:** 7.1 (sem enviar).
**Observar:** **miniatura aparece no balão** (clique = lightbox) + arquivo em `raw/assets`. 🐞 _Bug (já corrigido em b34):_ só vem o link, sem miniatura. _(7.2 com envio fica para a Fase 7 — exige confirmação.)_
#1/#2: anexe sua foto → "Use essa imagem e me coloque ao lado de um robô Jarvis futurista." → deve compor com você na imagem.
#3: logo em seguida → "Agora deixe o fundo em neon roxo." → edita a anterior.
#4: "Gere um banner do Jarvis em 16:9."
7.1 (imagem inline)

Gere uma imagem de um robô assistente neon futurista.
✅ miniatura no balão (clique = lightbox) + salva em raw/assets.

7.2 (imagem + envio, com confirmação P2)

Gere um logo "Jarvis" futurista e me envie no WhatsApp.
✅ deve pedir confirmação (envio externo) → "sim" → imagem chega no seu WhatsApp. (usa o "eu" que corrigimos)

---

## Fase 5 — Workspace + CT-e _(escrita reversível, ~6 min)_

**Ordem:** 3.1 → 3.3 → 3.2 → 3.4 → 3.5 → 4.1 → 4.2 → 2.6 (anota no wiki) → 2.7 (anexo+ingerir, **dispara job — colher na Fase 8**).
**Observar:**

- 3.1/3.3: lê Calendar/Gmail. 3.2: **evento criado** (confira no Calendar). 3.4: **rascunho no Gmail (não envia)**. 3.5: pasta criada + link.
- 4.1: retorna nº CT-e/emissão/frete/cliente. 4.2 (NF inexistente): **mensagem clara**, sem stacktrace.
- 2.6: cria/atualiza página + **append no log** (não sobrescreve). 🐞 _Bug:_ log sobrescrito.

Google Workspace 🔑
3.1

Quais meus próximos compromissos da semana?
→ listarProximosEventos · lista de eventos.

3.3

Quantos e-mails não lidos eu tenho? Resuma os 3 principais.
→ listarEmailsNaoLidos · contagem + resumo.

3.2

Crie um evento "Gravar vídeo do Jarvis" amanhã às 11h.
→ criarEventoCalendar · confira no Google Calendar se criou certo.

3.4

Crie um rascunho de e-mail para bruno.teste@exemplo.com sobre a proposta do projeto Jarvis.
→ criarRascunhoEmail · rascunho no Gmail (NÃO envia) — confira em Rascunhos.

3.5

Crie uma pasta no Drive chamada "Carros 2026".
→ criarPastaDrive · pasta criada + link.

Quais são minhas tarefas?
Adicione uma tarefa: comprar café, para amanhã.
Conclua a tarefa "retirar o lixo".
Busque o contato Luciana e me diga o telefone dela.
Crie um formulário "Feedback do Jarvis" com: nome (texto), nota de 1 a 5 (escala) e comentário (parágrafo).

---

## Fase 6 — Skills & subagentes _(~5 min)_

**Ordem:** 5.1 → 5.2 → 5.3 → 5.4. (5.5 `run_dynamic_script` exige confirmação → Fase 7.)
**Observar:** escolhe a **skill certa**; `invoke_agent` volta com resposta **coerente e isolada**. 🐞 _Bug:_ alucina nome de tool/skill (deve auto-corrigir com a lista de nomes válidos).

5.1 — descoberta

Quais habilidades (skills) você tem?
→ discoverSkills · lista de skills do Drive (espera ~32).

5.2 — ativar skill + aplicar

Ative a skill MentorTecnico e me ensine sobre RAG.
→ activate_skill · carrega as instruções da skill e responde no "personagem" dela.

5.3 — outra skill (revisão de código)

Use a skill clean-code para revisar este trecho:
function f(x){var y=x+1;return y}
→ activate_skill (clean-code) · revisão guiada pela skill.

teste rápido do 5.4 (Ctrl+Shift+R)
Delegue ao subagente AnalistaFinanceiro: explique em 5 linhas como avaliar um FII (dividend yield, vacância, liquidez, P/VP).

5.5 — executar script de skill (dispara confirmação P2)

## Liste os scripts disponíveis e rode um script de alguma skill que você tenha.

## ⏳ Disparar assíncronos agora

Antes da Fase 7, **lance os de segundo plano** e siga testando — eles avisam no WhatsApp:

1. **Objetivo (7e.1→7e.2):** _"Me envie em áudio no WhatsApp as novidades do Gemini"_ → confirme com **"sim"** → deve responder **"executo em 2º plano"** na hora.
2. **Ingestão grande (7b.1 / item 2.7):** já disparada na Fase 5.

---

## Fase 7 — Confirmação (P2) + WhatsApp saída _(~10 min)_

**Faça a confirmação ANTES dos envios livres** (evita disparo acidental).

**7-A · Confirmação (P2):** 10.5 → 10.6 → 10.7 → 10.8 → 5.5 → 7.2.

- 10.5: _"Envie 'oi' para o Douglas"_ → **🔐 mostra resumo (destino+texto) e pergunta** — **não envia**. 🐞 _Bug:_ envia direto (P2 furada).
- 10.6: _"sim"_ → **agora envia**.
- 10.7: imagem **com envio** → pede confirmação. 10.8: imagem **sem envio** → gera direto (não confirma).
- 5.5 / 7.2: `run_dynamic_script` e `gerarImagem(enviarPara)` também pedem confirmação.

**7-B · WhatsApp leitura/saída (8a):** 8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6 → 8.7 → 8.8 → 8.9.

- 8.1–8.3: instância/conversas. 8.4: lê texto. **8.5 `ouvirAudiosWhatsApp`** transcreve áudios; **8.6 `verImagensWhatsApp`** descreve imagens. 8.

9: **resumo consolidado** (combina as 3).

- 8.7/8.8: envio de texto/voz (passam pela confirmação 7-A). **Confira a entrega no celular.**
- **Auto-referência (7e.6):** _"me envie no WhatsApp"_ **sem número** → vai pro **seu próprio número**, **sem inventar contato**. 🐞 _Bug (corrigido b36):_ inventa "Grupo IA" ou usa e-mail como contato.

7-A · Camada de confirmação (P2)
10.5 — deve mostrar resumo e PERGUNTAR (não enviar)

Envie "oi, teste do Jarvis" para o Bruno Marques Link.
10.6 — confirmar o de cima

sim
→ só agora envia (confira a entrega no WhatsApp).

10.7 — imagem com envio (confirma)

Gere um gato astronauta e envie pro Bruno Marques Link.
10.8 — imagem sem envio (gera direto, sem confirmar)

Gere um gato astronauta.
👀 Observe: nada é enviado/gerado-pra-enviar antes do "sim"; e não pode aparecer "aguarde/enviando…" e parar (regra nova). Só diz "enviado" se realmente entregou.

7-B · WhatsApp — leitura e saída (comandando pelo chat)
8.1

Qual o número conectado no WhatsApp?
8.3

Liste minhas conversas do WhatsApp.
8.4 — leitura de texto

Leia as últimas mensagens do Douglas Mecânico Vila Cemig.
8.5 — ouvir áudios (use um contato que te manda áudio)

Ouça os áudios da Luciana e me resuma.
8.6 — ver imagens

Veja as imagens que a Ana me mandou e descreva.
8.7 — responder (texto) (P2 confirma)

Responda o Bruno Marques Link: "Já te retorno, obrigado!"
8.8 — responder em voz (P2 confirma + usa a voz nova Neural2)

Mande um áudio para o Bruno Marques Link dizendo que chego em 10 minutos.
8.9 — resumo consolidado (texto+áudio+imagem)

Resuma a conversa com a Luciana (mensagens, áudios e imagens).

Gere um camaleão com chapéu de caipira e envie pro Bruno Marques Link.
sim
Mande um áudio para o Bruno Marques Link dizendo que chego em 10 minutos.
sim
Resuma a conversa com a Luciana.

Poste no meu status: "Testando o Jarvis no status!"
sim
Gere um camaleão com chapéu de caipira e poste no meu status.
sim
Baixe as fotos que o número 5511999999999 me mandou.
Reaja com ❤️ à última mensagem do Bruno Marques Link.

Gere um camaleão com chapéu de caipira dando joia e poste no meu status.
sim

---

## Fase 8 — Segundo plano (colher resultados) _(~5 min de observação)_

**Observar os avisos no WhatsApp** dos assíncronos disparados:

- **Objetivo (7e.2):** ~1-2 min depois chega **"🎯 Objetivo concluído"** com a síntese + áudio (se pedido). `Liste meus objetivos` (7e.3) → `em_andamento`→`concluido`. 🐞 _Bug:_ nada chega (gatilho/`script.scriptapp`), ou **aviso duplicado**.
- **Ingestão (7b.1):** conclui sem estourar 6 min; **append no `log.md`**; aviso no WhatsApp.
- **Lote (7b.2):** _"Envie 'Bom dia' para Douglas e Luciana"_ → "enfileirado" → as duas recebem → resumo no log.
- **Firestore (7b.3):** coleção `jobs` `pendente`→`concluido`; coleção `objetivos` com `plano/passoAtual/resultados`.

---

## Fase 9 — Proatividade (forçar ticks) _(editor, ~5 min)_

**Ordem:** 7d.1 (agendar p/ hora atual) → `testarAgenda()` (7d.2) → 7d.5 (monitor) → `testarMonitorGmail()` (7d.6) → 7d.3/7d.4/7d.7.
**Observar:** 7d.2 → entrega **"⏰ Tarefa agendada"** no WhatsApp + `[tarefa]` no log. 7d.6 → **"📬 Monitor de e-mail"** + `[monitor-gmail]`. 🐞 _Bug:_ tick não dispara (escopo) ou `from:` com nome em vez de e-mail.

---

## Fase 10 — WhatsApp inbound (segundo número) _(~5 min)_

**Ordem:** 8.10 (texto) → 8.11 (áudio) → 8.12 (imagem) → 8.13 (número não-dono).
**Observar:** responde sozinho com **contexto das últimas msgs**; **áudio → responde em voz (espelho)**; **não-dono → modo leitura** (sem poderes). 🐞 _Bug:_ bot não responde (webhook caiu → reativar 8.16) ou dá poderes a não-dono.

---

## Fase 11 — Histórico + Segurança _(~5 min)_

**Ordem:** 9.1→9.5, depois 10.1→10.4.
**Observar:** 9.2 abre conversa antiga **com horários salvos**; 9.3 erros antigos **não poluem** o contexto. 10.2: **usuário comum** (logar com conta não-dono) → "restrito ao proprietário". 10.3: webhook sem `?wh=` → rejeitado. 10.4: A2A em **modo leitura**.

---

## Fase 12 — Recursos recentes: Voz no Android · Segundo Cérebro · Dashboard acionável · Custo _(sessão 2026-06, ~12 min)_ 🆕

> Cobre a **§15** do `TESTES_JARVIS.md`. São os recursos de maior efeito no vídeo. **Pré:** macro **"Jarvis Falar"** ativa no celular (canal Alarme) + `MACRODROID_WEBHOOK_URL` setada. Comece pelo som (mais visual), depois agendados, contatos, cérebro, dashboard e custo.

**Ordem:** 15.1 → 15.2 → (WhatsApp) 15.3 → 15.5/15.6 → 15.9–15.13 → 15.15 → 15.18–15.23 → 15.24 → 15.25.

| Bloco | ✅ Passou se… | 🐞 Bug se… |
| --- | --- | --- |
| **12a · Voz no Android** (15.1–15.4) | `fala "x" no android` → celular fala o eco; `me fala sobre Y no android` → fala o **conteúdo gerado**; 2× rápido → toca **1×** (dedupe) | toca o comando cru ("me sobre…"); não toca; toca em dobro |
| **12b · Alertas de voz** (15.5–15.8) | agenda confirma; no minuto certo o celular fala; card ▶/✏️/🗑️/＋ funciona | dispara no minuto errado/duplicado; card não age |
| **12c · Avisos de contato** (15.9–15.14) | anuncia com **nome salvo** + **voz por gênero**; assunto sensível → **discreto** (só o nome) | expõe conteúdo sensível; usa pushName; voz trocada |
| **12d · Segundo cérebro** (15.15–15.17) | `salva no meu cérebro: <url>` → cartão estruturado arquivado; depois `buscarConhecimento` acha | não estrutura; não arquiva; não recupera |
| **12e · Dashboard acionável** (15.18–15.23) | cada card executa a ação + toast + reload; gated ao dono | ação não roda; erro de sessão; card só lê |
| **12f · Recusa sem vazar** (15.24) | contato recebe recusa **natural** | aparece "o proprietário não autorizou" (VAZAMENTO) |
| **12g · Custo 100% free** (15.25–15.28) | `pingGemini` → `tier: free` / `gemini-2.5-flash`; AI Studio mostra **R$0** | tier=faturamento; gasto > 0 |

> **Observar geral:** nada de áudio duplicado (idempotência); a voz sai **alta** (canal Alarme); o dono nunca é exposto ao contato.

---

## 📋 Checklist de "o que provar" no fim da rodada

- [ ] **Orquestração:** cada pedido dispara a **tool certa** (não responde "de cabeça" o que exige tool).
- [ ] **Fonte certa:** web=atual · próprio=geral · wiki=pessoal.
- [ ] **Segurança:** credencial bloqueada · não-dono sem poderes · **P2 confirma antes de enviar/executar**.
- [ ] **Autonomia:** tarefa agendada + monitor + **objetivo em 2º plano** entregam no WhatsApp.
- [ ] **Multimodal:** OCR/PDF/CSV/áudio + imagem inline + voz (espelho).
- [ ] **Voz no Android:** "no android, me fala X" → o celular fala (alto, canal Alarme); sem áudio duplicado.
- [ ] **Segundo cérebro:** "salva no meu cérebro: <url>" → cartão estruturado + recuperável.
- [ ] **Dashboard acionável:** cards executam ações (tarefas/autorizações/secretária/alertas/agendadas/monitores).
- [ ] **Privacidade da voz:** assunto sensível de contato → aviso discreto; recusa de autorização nunca cita o dono.
- [ ] **Robustez:** sem `finishReason STOP` vazio · sem aviso duplicado · latências aceitáveis.
- [ ] **Custo:** `pingGemini` → `tier: free` (gemini-2.5-flash); painel AI Studio em **R$0** (modo 100% free).

---

_Roteiro vivo — 2026-06-03 (build b37). Atualize junto com o `TESTES_JARVIS.md`._
