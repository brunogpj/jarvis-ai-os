# App Android do Jarvis (substitui o MacroDroid) — plano inicial

Rascunho de 08/11/2026. Decisões já tomadas com o dono: **app Android próprio**, instalado só no celular dele (sem Play Store), e o **REA só para verificar** (comportamento do Android no Xiaomi, permissões, depuração do nosso APK), não para copiar código de app fechado.

## Por que sair do MacroDroid

| Problema medido | Origem |
|---|---|
| O `/exec` perde respostas (302 → 404 em ~40% dos pedidos em horário ruim) e o macro não sabe repetir com segurança | o MacroDroid só vê o HTTP; o `rid` e a repetição foram remendos no servidor |
| O Android matou o MacroDroid depois de uma atualização do WebView (13/10) | app de terceiros sem controle do serviço de fundo |
| Macros com o token e a URL do webhook dentro (não podem ir para o repositório) | configuração vive no arquivo `.macro` |
| Notificação de erro mostrava uma página HTML do Google (despertador, 07/11) | a macro não valida a resposta |
| Duas notificações de banco nunca chegaram (hipótese: sem sinal na viagem, a macro não reenvia) | sem fila offline |
| Volume baixo da fala: o canal de áudio certo só foi descoberto medindo por ADB | o MacroDroid escolhe o canal pela ação |

## O que o MacroDroid faz hoje

1. **Entrada de voz:** Conversa Premium → `voice_command` com `rid`.
2. **Captura de notificações:** Swile, Mercado Pago, Bradesco, Itaú, Sisponto, Bíblia → `notificacao`; telemetria, viagem, lista de apps.
3. **Ordens do Jarvis** (`controlarDispositivo`): `falar`, `volume`, `midia`, `lanterna`, `naoperturbe`, `abrirapp`, `abrirurl`, `navegar`, `intent`, `notificacao_interativa`.

## Arquitetura alvo (a confirmar)

- **Jarvis → celular:** push por **FCM** (HTTP v1, assinado com a conta de serviço que o Jarvis já usa para o Firestore, com o escopo de mensagens). Troca o webhook do MacroDroid. A ordem leva um `id`, e o app confirma o recebimento (ack).
- **Celular → Jarvis:** HTTPS para o `doPost` já existente (mesmos contratos: `voice_command`, `notificacao`, `telemetria`), com `rid`, **fila local e reenvio** (Room/WorkManager). Nenhuma resposta perdida some em silêncio.
- **Notificações:** `NotificationListenerService` com filtro por pacote configurável **no app** (não mais nas macros).
- **Fala:** baixa o arquivo, toca com `AudioAttributes` de **alarme** (a descoberta de 28/09) e respeita a fila de falas.
- **Controles:** lanterna (`CameraManager`), volume (`AudioManager`), mídia (`MediaSession`), não perturbar (exige permissão do usuário), intents para abrir app, URL e navegação.
- **Voz:** botão e widget "pressionar para falar" no início (`SpeechRecognizer` ou gravação + transcrição no servidor). Palavra de ativação fica para depois.
- **Segredos:** token e URL num armazenamento cifrado do app (EncryptedSharedPreferences), preenchidos por um QR de pareamento. Nada no repositório.

## Fases propostas

0. **Preparar o ambiente (FEITO em 08/11/2026):** Android SDK (command-line tools), Gradle, um projeto Kotlin vazio que compila e instala por ADB. Estado hoje: JDK 21 presente; **sem Android SDK nem Gradle**.
1. **Receber ordens e falar:** FCM + `falar` + ack. Substitui a macro Falar. É onde está a dor maior (volume, fila, arquivo).
2. **Notificações:** captura com fila offline e reenvio. Substitui "Notificações Premium" e Sisponto.
3. **Voz de entrada:** widget e `voice_command` com `rid` e repetição segura.
4. **Controles restantes:** volume, mídia, lanterna, não perturbar, abrir app, URL, navegação, notificação interativa.
5. **Desligar o MacroDroid** por macro, com o app novo rodando em paralelo antes do corte.

## Riscos e pontos em aberto

- **Xiaomi mata serviços de fundo.** Foreground service com notificação fixa, isenção de bateria e autostart; verificar por `dumpsys` e ADB (aqui o REA ajuda).
- **Android 13:** permissão de notificações, acesso às notificações de terceiros e execução em primeiro plano precisam de cada consentimento do usuário.
- **FCM exige um projeto Firebase** (gratuito) e o arquivo de configuração no app. A conta de serviço atual pode não ter o escopo de mensagens.
- **Assinar o APK:** chave local, guardada fora do repositório. Atualização só por sideload.
- **Segurança:** o app aceita ordens do servidor, então cada ordem precisa de assinatura/token e lista fechada de ações (mesmo princípio do Gate P2). Nenhuma ação nova sem lista.
- **Repositório público:** o app entra no repositório sem token, sem Firebase config real e sem a chave de assinatura (usar marcadores e `.gitignore`).

## Perguntas para a entrevista (próxima rodada)

1. FCM (Firebase) ou prefere algo sem Google no caminho (ex.: ntfy auto-hospedado)?
2. Voz: apertar para falar basta no começo, ou a palavra de ativação é obrigatória?
3. Onde guardar o código: pasta `android/` neste repositório ou repositório separado?
4. Quanto tempo de convivência com o MacroDroid antes de desligá-lo?


## Fase 0 — resultado (08/11/2026)

App vazio `dev.jarvis.companion` v0.0.1-fase0 compilou (AGP 8.13.2, Gradle 8.14.6, Kotlin 2.2.20, compileSdk 35, targetSdk 34, minSdk 26) e abriu no Redmi Note 11 (2201117TL, Android 13, API 33), confirmado por captura de tela. Projeto em `C:UsersBrunoprojetosjarvis-android` (repositório local, fora deste). SDK em `C:UsersBrunoAndroidSdk`.

Achados do Xiaomi/MIUI que valem para as próximas fases:
- `adb install` e `pm install` falham com `INSTALL_FAILED_USER_RESTRICTED` mesmo com Depuração USB, Instalar via USB e Config. de segurança ligadas: o MIUI abre uma tela de verificação com tempo curto e protegida contra captura. **Caminho que funcionou:** `adb push` do APK para `/sdcard/Download` e instalar pelo app Arquivos (instalador do pacote), sem pressa.
- `adb shell input tap` falha com SecurityException (INJECT_EVENTS): não dá para tocar na tela por ADB. O scrcpy usa o mesmo canal e tem a mesma limitação. A captura (`adb exec-out screencap -p`) funciona, exceto em telas protegidas.
- `sdk.dir` do `local.properties` precisa de barras normais (`C:/Users/...`).
- Há dois `adb` na máquina (`D:Documentsplatform-tools` e o do SDK); usar um só por vez para não derrubar o servidor um do outro.
