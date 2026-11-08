#!/usr/bin/env node
/**
 * Pareia o app Android com o Jarvis, pelo computador (nada digitado no celular).
 *
 *   node android/parear.mjs [android/pareamento.json]
 *
 * O arquivo de pareamento NÃO vai para o repositório (o .gitignore cobre android/pareamento*.json). Formato:
 *   { "url": "https://script.google.com/macros/s/<ID>/exec", "token": "<VOICE_API_TOKEN>",
 *     "fcm": { "apiKey": "...", "appId": "1:...:android:...", "projectId": "...", "senderId": "..." } }
 *
 * Manda o JSON em base64 para a tela do app por `am start --es config_b64` (sem aspas de shell para estragar).
 * Usa o adb do SDK (C:\Users\Bruno\Android\Sdk\platform-tools); defina ADB para usar outro.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const arq = process.argv[2] || path.join(AQUI, "pareamento.json");
const ADB = process.env.ADB || "C:/Users/Bruno/Android/Sdk/platform-tools/adb.exe";

if (!fs.existsSync(arq)) { console.error("não achei " + arq + " (veja docs/android-app/FIREBASE.md)"); process.exit(1); }
const json = JSON.parse(fs.readFileSync(arq, "utf8"));   // falha cedo se o JSON estiver quebrado
for (const k of ["url", "token"]) if (!json[k]) { console.error("falta o campo " + k); process.exit(1); }
for (const k of ["apiKey", "appId", "projectId", "senderId"]) if (!json.fcm?.[k]) { console.error("falta fcm." + k); process.exit(1); }

const b64 = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
const saida = execFileSync(ADB, ["shell", "am", "start", "-n", "dev.jarvis.companion/.MainActivity", "--es", "config_b64", b64],
  { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
console.log(saida.trim().split("\n").slice(-1)[0]);
console.log("enviado. Veja a tela do app: 'pareado: sim' e, nos eventos, 'aparelho registrado no Jarvis'.");
