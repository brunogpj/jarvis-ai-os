# Firebase (FCM) para o app Android do Jarvis — o que fazer uma vez

O app recebe as ordens do Jarvis por push (FCM). Isso exige um projeto Firebase na conta Google do dono. Nada abaixo vai para o repositório (ele é público).

## 1. Projeto Firebase

Escolha UMA das duas formas:

- **Usar o projeto Google Cloud que o Jarvis já usa** (o do Firestore): no https://console.firebase.google.com, "Adicionar projeto", escolha o projeto existente e confirme "Adicionar o Firebase". A conta de serviço atual continua valendo.
- **Projeto novo** só para o FCM: mais simples de apagar depois, mas aí a conta de serviço precisa ser outra (propriedade `ANDROID_SA`).

## 2. Registrar o app Android

Em "Configurações do projeto → Seus apps → Adicionar app → Android":
- Nome do pacote: `dev.jarvis.companion`
- Apelido: Jarvis
- Não precisa baixar o `google-services.json` nem adicionar o SDK: o app já está pronto.

Anote os quatro valores (aba Geral, no app Android; e "Cloud Messaging" para o remetente):
- `apiKey` (Chave de API da Web / "current_key" do google-services)
- `appId` (formato `1:123456789:android:abcdef...`)
- `projectId`
- `senderId` (número do projeto, "ID do remetente")

## 3. Permissão da conta de serviço do Jarvis

No Google Cloud, em IAM, dê à conta de serviço (`FIRESTORE_SA`, ou a `ANDROID_SA`) o papel **Administrador da API Firebase Cloud Messaging** (`roles/firebasecloudmessaging.admin`). Confirme que a API "Firebase Cloud Messaging API" está ativada no projeto.

## 4. Propriedades no Apps Script (o Jarvis)

Nenhuma é obrigatória se a conta de serviço for a do Firestore e o projeto for o mesmo. Caso contrário:
- `ANDROID_FCM_PROJECT` = id do projeto do Firebase
- `ANDROID_SA` = JSON da conta de serviço (se for outra)

O canal só passa a ser usado para falar quando `ANDROID_FALAR=sim` (via `config_fala`) e há aparelho registrado.

## 5. Parear o celular

1. Crie `android/pareamento.json` (está no `.gitignore`) com a URL do `/exec`, o `VOICE_API_TOKEN` e os quatro valores do passo 2 (formato em `android/parear.mjs`).
2. Com o celular no cabo: `node android/parear.mjs`
3. Na tela do app deve aparecer "pareado: sim" e, nos eventos, "aparelho registrado no Jarvis".

Teste de ponta a ponta, sem ligar o canal: `ler_debug` com `androidTeste:true` (o celular fala pela voz dele e o servidor mostra a confirmação) e `androidStatus:true` (estado do canal).
