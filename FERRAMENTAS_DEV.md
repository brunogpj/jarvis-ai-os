# 🛠️ Ferramentas de Desenvolvimento (Kanshi Tanaike + gas-fakes)

> Tooling do **workflow de build/teste e automação Workspace** — reduz a cota de **desenvolvimento**
> (testar offline, usar quota do Apps Script/Workspace separada da API Gemini). **Não** muda a cota
> de runtime do app. Fontes: [[wiki/sources/2026-06-15_antigravity-cli-workspace-tanaike]] e
> [[wiki/sources/2026-06-15_loop-engineering-agentes-codificacao]].

## Instalado (✅ já no PATH — `C:\Users\Visitante\AppData\Roaming\npm`)

| Ferramenta | Versão | Comando | Precisa OAuth? |
|---|---|---|---|
| **gas-fakes** | (npm) | `gas-fakes` | Só p/ emular Workspace real (ADC) |
| **gws** (Google Workspace CLI) | 0.22.5 | `gws` | **Sim** |
| **goodls** | v3.4.0 | `goodls` | Não (arquivos públicos) |
| **ggsrun** | v5.2.4 | `ggsrun` | **Sim** |

`GASADK`/`GoogleApiApp` (L5) rodam na nuvem (GAS) — instalação só quando partirmos para o L5.

---

## L2 · Testes locais (offline, ZERO cota) — `tests-local/`

Roda a **lógica determinística** do projeto (MODO DIRETO, gate sem-cota, etc.) em Node, sem deploy,
sem nuvem, sem cota. Pega regressões antes do `clasp push` (ex.: o sumiço de `dashboardResumo`/`_rotaDireta`).

```powershell
cd C:\Users\Visitante\Documents\Web_App_Projeto\tests-local
node --test          # roda todos os *.test.js  (~0.2s, 13 testes)
```

- `gas-shims.js` — mocks leves dos globais GAS (PropertiesService, GmailApp, CalendarApp, etc.) com dados canônicos por teste.
- `load.js` — carrega `Code.js` real num contexto `vm` com os shims (Code.js é só declarações de função → eval seguro).
- `jarvis.test.js` — asserções (`node:test`, embutido no Node, **zero dependências**).
- **Não vai para o deploy** (fora do allowlist do `.claspignore`).

**Como adicionar um teste:** copie um bloco `test(...)` em `jarvis.test.js`, passe dados via `code({ emails:[...], tarefas:[...] })` e asserte a saída de `_rotaDireta`/`_semCotaFallback`.

**Fidelidade total (opcional, gas-fakes real):** para emular Drive/Sheets/Gmail de verdade (não mocks),
autentique o gas-fakes com ADC e troque o shim pelo `@mcpher/gas-fakes` no `gas-shims.js`:
```powershell
gas-fakes init --auth-type adc
gas-fakes auth
```

---

## L4 · ggsrun — automação de Drive/Workspace pelo TERMINAL

**Setup (v5.2.4 — validado 2026-06-15):**
1. No GCP (projeto `meus-projetos-gas`): habilite **Apps Script API** + **Drive API**; tela de consentimento OAuth (Externo, adicione seu e-mail em "Usuários de teste"); crie **ID do cliente OAuth → App para computador**; baixe o JSON como `C:\Users\Visitante\.ggsrun\client_secret.json`.
2. Autentique (⚠️ é `auth`, **não** `setup` — a v5 não tem `setup`):
   ```powershell
   ggsrun auth --cred "C:\Users\Visitante\.ggsrun\client_secret.json"
   ```
   - No prompt "diretório p/ salvar ggsrun.cfg", informe `C:\Users\Visitante\.ggsrun` (NÃO deixe cair na pasta do projeto — o cfg contém o token).
   - No prompt "Script ID", cole o Script ID real (`1lL_WaUR...`), **não** o e-mail.
3. Valide:
   ```powershell
   ggsrun status --conf "C:\Users\Visitante\.ggsrun"   # → "Authentication successful!"
   ggsrun di     --conf "C:\Users\Visitante\.ggsrun"   # → quota + usuário do Drive
   ```

**✅ Use o ggsrun para operações de DRIVE (não-invasivas):**
```powershell
$cfg="C:\Users\Visitante\.ggsrun"
ggsrun ls --conf $cfg                       # lista arquivos do Drive
ggsrun sf --conf $cfg ...                    # busca arquivos
ggsrun d  --conf $cfg ...                    # download paralelo
ggsrun u  --conf $cfg ...                    # upload resumável
```

**⚠️ NÃO use `ggsrun e1`/`e2` no projeto de produção.** Para executar um script, o ggsrun **injeta a biblioteca dele e REESCREVE o `appsscript.json`** do projeto-alvo (visto em teste: "Updating appsscript.json manifest…"). Isso altera o nosso projeto vivo. Se rodar por engano, restaure com `clasp push -f` (devolve o HEAD ao código local).

### Dispatcher de diagnóstico (rodar funções do terminal SEM invadir o projeto) — b108

Em vez do `ggsrun e1/e2` (invasivo), o `doPost` tem uma rota de diagnóstico **própria** (lista branca + token):

1. No editor: `configurarDiagToken()` → gera o **DIAG_TOKEN** (guarde) e imprime um comando pronto.
2. Do PowerShell (lista branca: `statusJarvis`, `testarFirestore`, `diagGemini`, `testarModoReserva`, `testarVoz`, `listarSkillsJarvis`, `configurarLoopBudget`, `rodarQA`, `indexarWikiSemantico`, `indexarMemoriaConversas`, `testarBuscaSemantica`, `testarMemoriaConversas`):
   ```powershell
   $exec = "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
   $body = @{ token = "<DIAG_TOKEN>"; run = "statusJarvis" } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri $exec -ContentType "application/json" -Body $body
   # com argumento:
   $body = @{ token="<DIAG_TOKEN>"; run="configurarLoopBudget"; args=@{ steps=10; tools=12 } } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri $exec -ContentType "application/json" -Body $body
   ```
   - Retorna `{ ok, run, ms, resultado }`. Nome fora da lista → `{ ok:false, permitidas:[...] }` (sem execução arbitrária).
   - Funções que só logam (sem `return`) devolvem "(sem retorno; cheque os logs)".
   - ⚠️ `rodarQA`/`indexar*` consomem cota do Gemini — use com parcimônia.

---

## gws · Google Workspace CLI (admin/Workspace)

```powershell
gws auth setup     # configura o projeto GCP + habilita APIs (navegador)
gws auth login     # OAuth da sua conta
gws drive files list --params '{"pageSize": 5}'
```
Uso: auditar permissões de Drives, provisionar usuários, aplicar políticas — direto do terminal.

## goodls · download rápido do Drive (RAG sem API)

```powershell
goodls -u "https://docs.google.com/document/d/<ID>/edit"   # arquivo público → baixa direto
# privado: setx GOODLS_APIKEY "..."  (uma vez)
```
Uso: ingestão veloz de documentos compartilhados para a wiki/Semântica, sem OAuth nem quota da Drive API.

---

## Mapa: ferramenta → ganho de quota

| Camada | Ferramenta | Ganho |
|---|---|---|
| Local (offline) | **gas-fakes / harness L2** | testa sem deploy nem chamadas de nuvem → **zero cota de dev** |
| Híbrida | **ggsrun** | executa GAS pela **quota do Apps Script** (separada da API Gemini) |
| Nuvem | **GASADK/GoogleApiApp** (L5) | descarrega trabalho pesado p/ a nuvem GAS, contorna timeout local |
| Ingestão | **goodls** | RAG **sem API** (não gasta quota da Drive API) |
| Admin | **gws** | ops de Workspace via REST direto |

⚠️ Nenhuma delas reduz a cota de **runtime** do Gemini do app — isso é o **L1/L3** (orçamento de loop) + MODO DIRETO + Q2/Q3.
