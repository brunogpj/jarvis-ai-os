# Jarvis — Sistema Operacional de IA Pessoal

> **Resumo executivo para portfólio.** Documento-fonte otimizado para gerar vídeo, apresentação e áudio (NotebookLM).
> **Autor / desenvolvedor:** Bruno Felipe dos Santos Marques — Desenvolvedor de Automações (Belo Horizonte, MG).
> **Stack-núcleo:** Google Apps Script · JavaScript · Gemini · Cloud Firestore · Cloud Text-to-Speech · Evolution/WhatsApp API · MacroDroid (Android).
> **Uma frase:** Um assistente de IA pessoal de nível "AI OS" — agente que conversa no chat e no WhatsApp, **fala em voz alta no Android**, organiza conhecimento (segundo cérebro com RAG) e vira um centro de comando — **construído 100% dentro do ecossistema Google**, com **segurança Zero-Trust mapeada ao OWASP Top 10 for LLMs** e **escalabilidade serverless**, sem servidor próprio.

---

## 1. O problema e a visão

A maioria dos "assistentes" é uma caixa de chat isolada. O **Jarvis** foi construído com outra ambição: ser um **sistema operacional de IA pessoal** — um ponto único onde a IA *entende*, *age* e *lembra* através das ferramentas que a pessoa já usa todo dia (Gmail, Agenda, Drive, Tarefas, WhatsApp) e até no **celular físico**.

A pergunta de engenharia foi: *é possível entregar uma experiência de "AI OS" — agente com ferramentas, voz, memória de longo prazo, interface premium, **segurança de produção e escala** — usando apenas Google Apps Script, sem backend dedicado e sem app nativo?* O Jarvis é a resposta: **sim, e em produção.**

---

## 2. O que é o Jarvis

Um assistente proativo com **identidade de produto**, não um script. Frontend e backend rodam em **Google Apps Script (HtmlService)**; o banco é **Cloud Firestore** (acesso REST com service account + JWT assinado no próprio GAS); a inteligência é o **Gemini**, orquestrado por um **loop de agente (ReAct)** que o autor construiu do zero. A interface adota **neumorphism + glassmorphism**, com tema claro/escuro.

O Jarvis fala três "idiomas" de interface ao mesmo tempo:
- **Chat web** (o app HtmlService);
- **WhatsApp** (via Evolution API — recebe e responde, inclusive por **voz**: você manda um áudio e ele transcreve, entende e responde);
- **Voz no Android** (o assistente fala em voz alta no celular do dono).

---

## 3. Arquitetura e stack (o que sustenta tudo)

- **Google Apps Script** — frontend (HtmlService) + backend (`doGet`/`doPost`) + automações por gatilho de tempo, no mesmo projeto.
- **Cloud Firestore (REST + service account)** — memória persistente, sem biblioteca externa: JWT assinado com `Utilities.computeRsaSha256Signature`, access token cacheado no `CacheService`.
- **Gemini** — geração e function-calling, com **cascata de chaves e modelos** (free tier primeiro; tolerância a falha/cota) e controle de "thinking".
- **Cloud Text-to-Speech** — síntese de voz premium (vozes Chirp3-HD), seleção de voz por contexto; **Cloud Speech-to-Text** para transcrever áudios.
- **Evolution API (WhatsApp)** — webhook de entrada e envio; respeito estrito a conversas 1:1 (nunca grupos).
- **MacroDroid (Android)** — atuador no celular: recebe um webhook do Jarvis e executa ações nativas **sem nenhum app programado** — só configuração.
- **RAG semântico** — embeddings + busca por significado, fundidos com palavra-chave (Reciprocal Rank Fusion).
- **Broker assíncrono serverless** — um MapReduce nativo no GAS que **escapa do limite de 6 minutos** sem Cloud Run (ver §5).

**Decisão de design recorrente:** preferir o ecossistema Google e soluções "sem servidor" — o que o autor já domina — e resolver o resto com **engenharia** (assinatura de JWT na mão, cascata de provedores, idempotência, broker assíncrono), não com infra extra.

---

## 4. Capacidades (as funcionalidades que importam)

### 4.1 Agente de IA com ferramentas
Um **loop de raciocínio (ReAct)** que decide quais ferramentas chamar: ler/resumir Gmail, consultar Agenda e Tarefas, pesquisar na web (grounding), ler URLs (URL context), buscar na base de conhecimento (RAG) e agir. Dois aceleradores de eficiência: o **"MODO DIRETO"** (leituras inequívocas — e-mails não lidos, agenda, tarefas — respondidas **deterministicamente, sem gastar LLM**) e um **roteador de intenção** que, para consultas de conhecimento, faz a busca RAG **antes** do loop e responde ancorado nos fatos — cortando latência, tokens e alucinação.

### 4.2 Voz no Android — "a web faz o celular falar"
O recurso-assinatura. O dono pede — no chat ou no WhatsApp — *"no Android, me fala minha agenda de hoje"* e o **celular responde em voz alta**, com **voz premium sintetizada na nuvem** (Cloud TTS Chirp3-HD). O Jarvis sintetiza o áudio, publica num arquivo de **ID estável** no Drive e dispara um **webhook do MacroDroid**, que toca o áudio. Tudo **via web/GAS**, sem app nativo. Um disparo determinístico garante que funcione **sempre**, independente da "vontade" do modelo. *(E ele se auto-protege: se o arquivo de voz mudar de ID no Drive, o sistema avisa o dono com a URL nova — falha deixa de ser silenciosa.)*

### 4.3 Conversa por voz (de mão dupla)
Além de falar, o Jarvis **ouve**: o dono manda um **áudio no WhatsApp** e ele **transcreve (Cloud Speech), entende e responde** — inclusive devolvendo voz. Um canal de conversa por voz natural, sem depender de reconhecimento de fala do aparelho.

### 4.4 WhatsApp + Modo Secretária (human-in-the-loop)
Integração bidirecional. No **Modo Secretária**, quando um contato escreve, o Jarvis **rascunha** a resposta e **pede aprovação** ao dono (uma "caixa de entrada de decisões"). Ações em nome do dono passam por uma **ponte de autorização**: o Jarvis nunca executa sozinho; registra, avisa e aguarda o "sim". Regra de ouro: **o contato nunca sabe** que existe aprovação/recusa — as respostas são naturais e humanizadas.

### 4.5 Segundo cérebro (capturar, organizar, recuperar)
*"Salva isso no meu cérebro: [link]"* → o Gemini **lê a página (URL context), extrai um cartão estruturado** (título, resumo, tags, insights, entidades, conexões) com **saídas estruturadas (responseSchema)** e **arquiva organizado** numa wiki por categoria. Depois, a pessoa pergunta por **significado** e o RAG recupera. A **reindexação semântica roda em segundo plano** (via broker), e o segundo cérebro fica pesquisável sem trabalho manual.

### 4.6 Avisos falados de contato (com privacidade)
Quando um contato manda mensagem, o Android **anuncia em voz alta** quem foi — usando o **nome como o dono salvou** ("Mãe", "Tia Jaque", via Google Contatos) e **voz por gênero**. E há uma **camada de discrição**: se o assunto é sensível (dinheiro, senha, saúde, jurídico, RH/salário, localização, íntimo…), o aviso **fala só quem mandou, sem expor o conteúdo**. Filosofia: *na dúvida, esconde.*

### 4.7 Alertas de voz agendados & Dashboard acionável
O dono agenda em linguagem natural (*"todo dia às 8h30, me fale minha agenda e e-mails no Android"*) e o Jarvis **gera o conteúdo em tempo real e fala** no horário. E o **dashboard** virou **centro de comando**: cards interativos de Tarefas, Autorizações, Modo Secretária, Alertas de voz, Mensagens agendadas e Monitores web — com **saúde do motor** (heartbeat) visível.

---

## 5. Engenharia, escala e confiabilidade (sinais de senioridade)

- **Loop de agente próprio (ReAct)** com governança: tetos de passos/chamadas por turno, detecção de repetição/não-progresso e cortes por orçamento.
- **Tool gating por intenção** — só expõe ao modelo as ferramentas relevantes à mensagem, reduzindo tokens e erro.
- **Idempotência** de ponta a ponta: dedup de webhooks do WhatsApp (por ID), de falas e de alertas (por hash/carimbo) — sem ações em dobro.
- **Cascata de provedores e modelos** com **engenharia de custo**: free tier primeiro, múltiplas chaves free que se revezam, modelo/"thinking" ajustáveis; a chave paga é último recurso (ou excluída por completo). *(Após um incidente de custo, o sistema foi reestruturado para operar 100% no free tier.)*
- **Broker assíncrono serverless (o "1-Second Timeout Hack"):** dispara POSTs de loopback para a própria `/exec` com `timeoutSeconds:1` — a exceção é engolida no chamador, mas o contêiner-alvo roda **6 min isolados**. Sobre isso: **token-bucket** (concorrência), **dead-letter recovery**, retries e um **MapReduce multi-agente**. Resultado: **escapa do limite de 6 min do GAS sem Cloud Run** — resolve a escalabilidade ficando no ecossistema Google.
- **Anti-falha-silenciosa (heartbeat):** cada job de fundo "bate o coração"; um vigia detecta gatilhos parados, **re-arma** e **avisa o dono** — o dashboard é o observador fora do sistema de gatilhos. Falha invisível vira notificação.
- **RAG híbrido (RRF)**: funde semântico + palavra-chave; semântica é *lazy* (só embeda quando a busca barata vem fraca), economizando cota.
- **Qualidade verificável:** um harness de QA funcional **e** uma suíte de **Evals de comportamento** (testa o `toolTrace` real: Gate de confirmação não burlável, anti-injeção, anti-alucinação, vazamento de chave), além de testes locais offline.

---

## 6. Segurança e privacidade — Zero-Trust mapeado ao OWASP Top 10 for LLMs

A postura é **Zero-Trust por design** (nada é confiável por padrão — nem o usuário, nem a entrada, nem a saída do LLM, nem a rede), e cada defesa é **nomeada contra a ameaça real** (documento dedicado `SEGURANCA_OWASP_JARVIS.md`):

- **Prompt Injection / Jailbreak (LLM01):** guardrails que tratam conteúdo externo (e-mails, páginas, mensagens) como **dado, não instrução**; pré/pós-hooks defensivos.
- **A regra inegociável:** **a IA nunca fabrica resultado de ferramenta** — se não executou, não finge (integridade de saída).
- **Excessive Agency (LLM06):** owner-gating + **confirmação humana (P2)** para ações sensíveis; **ponte de autorização** (o contato nunca sabe do fluxo); bloqueio de credenciais em anexos.
- **Replay Attack:** **idempotência por chave de deduplicação** (CacheService) nos webhooks e falas.
- **SSRF:** validação anti-SSRF que barra IPs internos/loopback e o endpoint de **metadados da nuvem** — evita exfiltração de credenciais.
- **Sandbox de código dinâmico:** scripts gerados/induzidos por injeção rodam com **APIs envolvidas (`_wrapped*`) + allowlist** (IDs de arquivo, e-mails, URLs) — não exfiltram, não fazem phishing nem traversal de Drive (porta do conceito de sandbox de Kanshi Tanaike).
- **Hardening de borda:** webhooks **assinados** (MacroDroid e WhatsApp), **rate limiting** no `/exec`, **crachás efêmeros de escopo mínimo** (A2ABadge) para chamadas internas e **log de auditoria à prova de adulteração** (telemetria com hash-chain SHA-256).
- **Privacidade:** discrição de assunto sensível na voz; **nunca responde em grupos**; segredos só em Script Properties.

---

## 7. Resultados e impacto

- Um **AI OS pessoal funcional e em uso** — chat, WhatsApp, voz de mão dupla no celular, segundo cérebro e dashboard acionável — **sem servidor próprio nem app nativo**.
- **Segurança de nível de produção:** defesas mapeadas ao **OWASP Top 10 for LLMs**, sandbox de execução, webhooks assinados, auditoria imutável — comunicadas como um arquiteto de segurança faria.
- **Escalabilidade resolvida na engenharia:** broker assíncrono que vence o limite de 6 min do GAS **sem Cloud Run** — e anti-falha-silenciosa que torna o sistema confiável.
- **Custo sob controle:** operação no **free tier** por engenharia de cascata de chaves/modelos.
- **Transferência de conhecimento entre projetos:** padrões maduros (A2A, broker MapReduce, evals, hash-chain) foram **portados de um projeto-irmão** (ERP de transporte com agente Gemini) — sinal de visão de arquitetura, não só de feature.
- **QA passando**, incluindo casos adversariais (jailbreak, não-fabricação). Prova de que **Google Apps Script** aguenta arquitetura de agente séria.

---

## 8. O desenvolvedor por trás do Jarvis

**Bruno Felipe dos Santos Marques** está em transição consolidada de **Assistente Administrativo → Desenvolvedor de Automações**. Vem da **logística e do faturamento** — uma combinação rara que faz ele construir ferramentas que as pessoas **realmente usam** na operação. Domina **Google Apps Script, JavaScript, integração de APIs REST, VBScript/HTA e VBA**, e tem sistemas **em produção** numa transportadora (consulta de CT-e via API, sistema operacional em Excel/VBA com 25 módulos).

O **Jarvis é o ápice** dessa trajetória: aqui ele exercitou **arquitetura de agentes de IA, RAG, engenharia de prompt, integração de múltiplas APIs, idempotência, escalabilidade serverless, segurança Zero-Trust mapeada ao OWASP, sandboxing, engenharia de custo e engenharia de produto (UX premium)**. É o projeto que mostra o **nível técnico real** — de alguém que constrói, integra, **protege**, **escala** e comunica.

> **Objetivo profissional:** recolocação como desenvolvedor de automações / analista de sistemas (júnior-pleno), em Belo Horizonte ou remoto.

---

## 9. Frases de destaque (para a narração / slides)

- *"Construí um Sistema Operacional de IA pessoal — 100% em Google Apps Script."*
- *"A web faz o meu celular falar: peço, e o Android responde em voz alta, com voz premium na nuvem — e ainda converso por voz pelo WhatsApp."*
- *"Não é um chatbot. É um agente que entende, age nas minhas ferramentas e lembra — com um segundo cérebro de RAG."*
- *"Tratei segurança como arquitetura: cada defesa mapeada ao OWASP Top 10 for LLMs — injeção de prompt, replay, SSRF — e um sandbox que contém o código dinâmico."*
- *"Resolvi a escalabilidade sem Cloud Run: um broker assíncrono que vence o limite de 6 minutos do Apps Script, ficando no ecossistema Google."*
- *"Privacidade de verdade: num assunto sensível, o assistente avisa quem mandou, mas não fala o conteúdo em voz alta."*
- *"A regra inegociável: a IA nunca finge ter feito o que não fez."*
- *"Esse projeto me levou de quem escreve scripts a quem arquiteta sistemas de IA — seguros e escaláveis."*
