# 📣 LinkedIn — Jarvis (AI Personal OS) · Post + Roteiro de Narração

> Material para o vídeo de apresentação do projeto. Baseado em `TESTES_JARVIS.md`.
> Autor: **Bruno Felipe dos Santos Marques** · dono@exemplo.com

---

## ⭐ 0) FLAGSHIP 2026-06 v2 — versão atual (+ Segurança OWASP · Escala serverless · Voz de mão dupla)

> **Use esta como a versão principal.** O roteiro de gravação detalhado está em **`Roteiro_Video5_Jarvis_LinkedIn.docx`** (pasta Downloads) — atualizado com as cenas novas (segurança OWASP-LLM, broker assíncrono, voz de mão dupla). Ver também a §0.1 abaixo (roteiro v6). As seções 1–6 são a versão anterior (referência).

### Post (legenda do vídeo)

🤖 **Construí um Sistema Operacional de IA pessoal — 100% em Google Apps Script. Seguro e escalável.**

O **Jarvis** não é um chatbot: é um **agente que age**. Conversa comigo no chat e no **WhatsApp**, e — o pulo do gato — **fala E ouve por voz no meu Android**, com voz premium na nuvem, sem nenhum app nativo.

O que ele faz:
🧠 **Agente de IA** — loop de raciocínio (ReAct) com dezenas de ferramentas (Gmail, agenda, tarefas, web, RAG). Um *roteador de intenção* busca o conhecimento antes de pensar — menos latência, menos alucinação.
🔊🎙️ **Voz no Android (mão dupla)** — *"no android, me fala minha agenda"* → o celular fala; e eu mando um **áudio no WhatsApp** → ele **transcreve, entende e responde** (até com voz).
🗂️ **Segundo cérebro (RAG)** — mando um link, ele lê, estrutura, arquiva; depois eu pesquiso por significado.
🎛️ **Dashboard que age** — cards interativos + **saúde do motor** (se um processo de fundo para, ele me avisa).
🔐 **Segurança como arquitetura** — Zero-Trust mapeado ao **OWASP Top 10 for LLMs**: defesa contra injeção de prompt, replay, SSRF, e um **sandbox** que contém o código dinâmico. A regra inegociável: a IA **nunca finge** ter feito o que não fez.
🚀 **Escala sem Cloud Run** — um **broker assíncrono** que vence o limite de 6 min do Apps Script com um loopback de 1 segundo. Engenharia, não infra cara.
💸 **Custo zero** — roda no **free tier** por engenharia de cascata de chaves/modelos.

Backend, frontend, banco (Firestore), automações e segurança — tudo no mesmo ecossistema Google, com o Gemini orquestrado por um loop de agente que eu mesmo construí.

👉 Demo no vídeo. Link no primeiro comentário. 🎬

Aberto a conversas sobre **IA aplicada, engenharia de agentes, segurança de LLMs e automação**. 🚀

#InteligenciaArtificial #GoogleAppsScript #Gemini #AIAgents #RAG #SegurancaDaInformacao #OWASP #AutomacaoDeProcessos #CloudFirestore #WhatsAppAPI #DesenvolvimentoDeSoftware #Inovacao

---

## ⭐ 0.1) ROTEIRO DE NARRAÇÃO v6 — flagship 2026-06 (vídeo ~6–7 min)

> Formato: **[tempo] CENA — fala (o que mostrar)**. Narração por cima fica mais profissional. Borre dados sensíveis (números/e-mails de terceiros). Versão também em `Roteiro_Video5_Jarvis_LinkedIn.docx`.

### [0:00–0:30] Abertura — o gancho
🎙️ *"E se um assistente de IA pudesse rodar inteiro dentro do Google — sem servidor próprio, sem app nativo — e ainda assim ser seguro e escalável de verdade? Esse é o Jarvis, e eu construí do zero."*
🖥️ Login → entrar → alternar tema claro/escuro → recolher a sidebar. (Destaque o visual neumorphism + glassmorphism.)

### [0:30–1:15] O agente que age (e é eficiente)
🎙️ *"O Jarvis não conversa — ele age. Um loop de raciocínio decide quais ferramentas usar nas minhas contas Google."*
🖥️ *"Tenho e-mails não lidos? Resuma os principais."* (mostra leitura) · *"O que tenho na agenda esta semana?"*
🎙️ *"E é otimizado: leituras simples respondem sem gastar o modelo, e perguntas sobre o meu conhecimento buscam a base ANTES de pensar — menos latência e menos alucinação."*

### [1:15–2:00] Segundo cérebro (RAG)
🎙️ *"Ele tem memória que aprende. Mando um link e ele lê, estrutura e arquiva no meu segundo cérebro."*
🖥️ *"Salva isso no meu cérebro: [link]"* → mostra o cartão estruturado. Depois: *"O que está documentado no meu wiki sobre [tema]?"* (recupera por significado).
🎙️ *"A indexação semântica roda em segundo plano — fica pesquisável sozinho."*

### [2:00–3:00] Voz no Android — de mão dupla (o recurso-assinatura)
🎙️ *"Agora o pulo do gato: a web faz o meu celular falar."*
🖥️ No chat: *"no android, me fala minha agenda de hoje"* → o **celular toca a resposta em voz alta** (voz premium na nuvem).
🎙️ *"E não é só falar — ele ouve. Mando um áudio no WhatsApp e ele transcreve, entende e responde, até com voz."*
🖥️ Enviar um áudio no WhatsApp (self-chat) → resposta do Jarvis. (Tocar o áudio.)

### [3:00–3:45] WhatsApp + Modo Secretária + privacidade
🎙️ *"Ele orquestra meu WhatsApp com responsabilidade. No Modo Secretária, rascunha a resposta e espera a minha aprovação — e o contato nunca sabe que existe esse fluxo."*
🖥️ Dashboard → card de pendência (aprovar/editar). 
🎙️ *"E protege a privacidade: quando alguém me escreve um assunto sensível, ele avisa quem mandou, mas não fala o conteúdo em voz alta."*

### [3:45–4:30] Dashboard que age + saúde do motor
🎙️ *"O painel não é só leitura — é um centro de comando. E ele se vigia: se um processo de fundo para, eu sou avisado."*
🖥️ Cards interativos (tarefas, autorizações, alertas de voz) + o indicador de saúde (heartbeat).

### [4:30–5:30] 🆕 Segurança como arquitetura (o diferencial de senioridade)
🎙️ *"Tratei segurança como requisito de arquitetura, não recurso opcional. Cada defesa está mapeada contra uma ameaça real do OWASP Top 10 para LLMs."*
🖥️ Mostrar o `SEGURANCA_OWASP_JARVIS.md` (ou um slide).
🎙️ *"Mitigo injeção de prompt tratando todo conteúdo externo como dado, não instrução; tenho idempotência contra replay attacks; bloqueio SSRF contra exfiltração de metadados de nuvem; e um sandbox que contém o código dinâmico — ele só toca recursos de uma allowlist."* 
🎙️ *"E a regra inegociável: a IA nunca fabrica um resultado de ferramenta. Se não executou, não finge."*

### [5:30–6:15] 🆕 Escalabilidade serverless (sem Cloud Run)
🎙️ *"O Apps Script tem um limite de 6 minutos por execução. Em vez de migrar para uma nuvem cara, resolvi com engenharia: um broker assíncrono que dispara um loopback de 1 segundo para a própria URL — a chamada estoura, mas o contêiner-alvo roda 6 minutos isolados. Encadeando, o trabalho pesado escala sem sair do Google."*
🖥️ Mostrar a reindexação do conhecimento rodando em segundo plano (o broker).

### [6:15–7:00] Fechamento — quem sou e CTA
🎙️ *"Tudo isso no free tier, por engenharia de custo. Esse projeto me levou de quem escreve scripts a quem arquiteta sistemas de IA — seguros e escaláveis."*
🎙️ *"Se você trabalha com IA aplicada, automação ou segurança de LLMs, me chama. Bora construir."*
🖥️ Tela final com nome, contato e o app aberto.

---

## 1) POST — versão principal (storytelling + impacto)

> Use esta como legenda do vídeo.

---

🤖 **Eu construí um "Jarvis" de verdade — e ele roda 100% dentro do Google, sem servidor próprio.**

Há algumas semanas comecei um desafio pessoal: criar um **AI Personal OS** de nível comercial usando **apenas Google Apps Script** no back-end e no front-end, **Cloud Firestore** como banco (nada de planilha) e o **Gemini** como cérebro.

O resultado é o **Jarvis** — um assistente que não só conversa, mas **age**:

🧠 **Memória que aprende** — uma wiki versionada no Drive. Ele consulta o próprio conhecimento antes de responder e documenta novos aprendizados sozinho.
🗂️ **Executa no Google Workspace** — cria eventos no Calendar, rascunhos no Gmail, pastas no Drive.
🚚 **Resolve trabalho real** — transformei uma consulta de CT-e que eu fazia manualmente (de um sistema legado em HTA) numa skill conversacional.
👁️ **Multimodal** — faz OCR de imagens, lê PDFs e CSVs, e até **gera imagens** (modelo de imagem do Gemini).
📱 **Orquestra meu WhatsApp pessoal** — lê conversas, responde por mim, e o melhor: **recebe um áudio, transcreve, entende e responde falando** (voz neural via Google Cloud TTS).
🔐 **Arquitetura Zero-Trust** — nenhuma credencial no código, ações sensíveis liberadas só para o dono, anexos com segredo são bloqueados automaticamente.

Tudo isso com uma interface premium em **neumorphism + glassmorphism**, tema claro/escuro e histórico de conversas persistido.

O que mais me marcou nesse projeto não foi a tecnologia isolada — foi perceber que dá para **orquestrar um ecossistema inteiro** (IA + Workspace + WhatsApp) com engenharia de contexto, *function calling* e uma boa arquitetura, sem infra cara.

👉 No vídeo eu mostro o Jarvis funcionando de ponta a ponta. Dá o play. 🎬

Aberto a conversas sobre **IA aplicada, automação e engenharia de agentes**. Se sua empresa quer transformar processos manuais em fluxos inteligentes, vamos trocar ideia. 🚀

#InteligenciaArtificial #GoogleAppsScript #Gemini #IAGenerativa #AutomacaoDeProcessos #AIAgents #CloudFirestore #DesenvolvimentoDeSoftware #LowCode #Inovacao #FunctionCalling #WhatsAppAPI

---

## 2) POST — versão curta (punchy)

🤖 Construí um **Jarvis** que roda 100% no Google (Apps Script + Firestore + Gemini).

Ele lê minha wiki pessoal, agenda no Calendar, consulta CT-e, gera imagens e **orquestra meu WhatsApp** — recebe áudio, transcreve e **responde falando**.

Sem servidor próprio. Arquitetura Zero-Trust. UI em neumorphism + glassmorphism.

Vídeo no play 👇 Bora falar de **IA aplicada e automação**? 🚀

#IA #GoogleAppsScript #Gemini #AIAgents #Automacao #Inovacao

---

## 3) ROTEIRO DE NARRAÇÃO (vídeo 8–10 min)

> Formato: **[tempo] CENA — fala (o que mostrar)**. Fale em tom natural, como quem demonstra orgulho do que construiu.

### [0:00–0:40] Abertura — o gancho
🎙️ *"E se um assistente de IA pudesse rodar inteiro dentro do Google, sem servidor próprio, e ainda assim gerenciar sua agenda, seu conhecimento e até seu WhatsApp? Esse é o Jarvis — e eu construí do zero."*
🖥️ **Mostrar:** tela de login → entrar → alternar tema claro/escuro → recolher/expandir a sidebar. (Destacar o visual neumorphism + glassmorphism.)

### [0:40–2:00] O cérebro: memória + conhecimento
🎙️ *"O Jarvis tem memória de verdade — uma wiki versionada no meu Drive. Antes de responder, ele consulta o que já sabe."*
🖥️ **Mostrar:** digitar *"O que você sabe sobre function calling?"* → ele busca no wiki e responde citando as próprias páginas.
🎙️ *"E ele aprende: posso pedir para anotar algo novo e ele documenta sozinho, mantendo índice e log."*
🖥️ **Mostrar (opcional):** *"Anote no wiki: validei a transcrição de áudio hoje."*

### [2:00–3:20] Ele executa no Google Workspace
🎙️ *"Mais do que falar, ele age na minha conta Google."*
🖥️ **Mostrar:** *"Crie um evento 'Gravar vídeo LinkedIn' amanhã às 15h."* → abrir o Calendar e mostrar o evento criado.
🖥️ **Mostrar:** *"Tenho e-mails não lidos? Resuma os 3 principais."*

### [3:20–4:20] Caso real: do legado à IA (CT-e)
🎙️ *"No meu dia a dia eu consultava CT-e num sistema antigo, manualmente. Transformei isso numa habilidade conversacional."*
🖥️ **Mostrar:** *"Consulte o CT-e da nota fiscal X."* → resultado com número do CT-e, valor do frete, cliente.
🎙️ *"A mesma rotina, agora em linguagem natural — e com as credenciais seguras, fora do código."*

### [4:20–5:30] Multimodal + geração de imagem
🎙️ *"Ele enxerga."*
🖥️ **Mostrar:** arrastar uma imagem → *"Faça OCR e me diga o que diz."*
🎙️ *"E cria imagens."*
🖥️ **Mostrar:** *"Gere uma imagem de um robô assistente em estilo neon futurista."* → miniatura aparece no chat.

### [5:30–7:30] O clímax: orquestração do WhatsApp + voz
🎙️ *"Agora a parte que mais me empolga: ele orquestra o meu WhatsApp pessoal."*
🖥️ **Mostrar:** painel WhatsApp → instância conectada + "Bot ativo".
🖥️ **Mostrar:** *"Liste minhas conversas"* → *"Leia as últimas mensagens do contato X."*
🎙️ *"E ele não só lê texto — ele ouve. Recebi um áudio; o Jarvis transcreveu, entendeu o pedido e respondeu… falando."*
🖥️ **Mostrar:** enviar um áudio no WhatsApp (de outro número) → o Jarvis responde com uma **nota de voz**. (Tocar o áudio de resposta.)

### [7:30–8:30] Confiança: segurança + arquitetura
🎙️ *"Tudo isso com responsabilidade: arquitetura Zero-Trust, nenhuma credencial no código, ações sensíveis só para o dono."*
🖥️ **Mostrar:** tentar anexar um arquivo com 'credencial' → bloqueio automático. Mencionar histórico persistido no Firestore com horário de cada mensagem.

### [8:30–9:30] Fechamento — quem sou e CTA
🎙️ *"Esse projeto é o resultado de juntar engenharia de software, IA aplicada e muita curiosidade. Roda em Google Apps Script, Firestore e Gemini — escalável e de baixo custo."*
🎙️ *"Se você trabalha com automação, IA ou quer transformar processos manuais em fluxos inteligentes, me chama. Bora construir."*
🖥️ **Mostrar:** tela final com seu nome, contato e o app aberto.

---

## 4) Dicas de gravação
- **Grave em 1080p**, janela do navegador limpa (sem abas/extensões à mostra).
- **Esconda dados sensíveis** (números de WhatsApp de terceiros, e-mails) — borre na edição se aparecerem.
- **Corte os tempos de espera**: acelere/edite enquanto o Jarvis "pensa".
- **Áudio narrado por cima** fica mais profissional que voz ao vivo.
- Para o **clímax do WhatsApp**, use dois aparelhos (ou app + celular) lado a lado, para mostrar a mensagem chegando e a resposta em voz.

## 5) Texto para a miniatura (thumbnail)
- Linha 1 (grande): **JARVIS**
- Linha 2: *Meu assistente de IA — 100% no Google*
- Selo/canto: *Apps Script · Gemini · WhatsApp · Voz*

## 6) Primeiro comentário fixado (boost de alcance)
> Stack: Google Apps Script (front + back) · Cloud Firestore · Gemini (Function Calling + multimodal) · Google Cloud Text-to-Speech · Evolution API (WhatsApp). Arquitetura de agente com loop ReAct, memória em wiki (RAG), skills com divulgação progressiva e orquestração multi-plataforma. Perguntas técnicas? Manda nos comentários. 👇
