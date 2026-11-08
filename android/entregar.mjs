#!/usr/bin/env node
/**
 * Compila o app e deixa o APK na pasta Download do celular, para o dono instalar pelo Arquivos.
 *
 *   node android/entregar.mjs              compila e copia
 *   node android/entregar.mjs --sem-build  copia o APK já compilado
 *
 * Por que o dono instala: o Google Play Protect bloqueou como "app nocivo" uma versão do app que se atualizava sozinha
 * (permissão REQUEST_INSTALL_PACKAGES, 08/11/2026), e o MIUI exige o toque do dono em instalações vindas do ADB. O caminho
 * que funciona é copiar o arquivo e instalar pelo Arquivos. Este script só cuida da parte do computador e confere a versão.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ADB = process.env.ADB || "C:/Users/Bruno/Android/Sdk/platform-tools/adb.exe";
const SDK = process.env.ANDROID_HOME || "C:/Users/Bruno/Android/Sdk";
const APK = path.join(AQUI, "app/build/outputs/apk/debug/app-debug.apk");
const ENV = { ...process.env, MSYS_NO_PATHCONV: "1", ANDROID_HOME: SDK };
const adb = (args) => execFileSync(ADB, args, { encoding: "utf8", env: ENV });
const falha = (m) => { console.error("✖ " + m); process.exit(1); };

const versao = (fs.readFileSync(path.join(AQUI, "app/build.gradle.kts"), "utf8").match(/versionName\s*=\s*"([^"]+)"/) || [])[1];
if (!versao) falha("não achei versionName em app/build.gradle.kts");

const dispositivos = adb(["devices"]).split("\n").slice(1).filter((l) => l.trim());
if (!dispositivos.some((l) => /\sdevice$/.test(l.trim()))) {
  falha("nenhum celular autorizado: " + (dispositivos[0] || "nada conectado") + ". Se disser 'unauthorized', rode 'adb kill-server' e aceite o aviso no celular.");
}

if (!process.argv.includes("--sem-build")) {
  console.log("compilando " + versao + "…");
  const r = spawnSync(path.join(AQUI, "gradlew.bat"), ["assembleDebug", "--no-daemon", "-q"], { cwd: AQUI, env: ENV, encoding: "utf8", shell: true });
  if (r.status !== 0) falha("a compilação falhou:\n" + (r.stdout || "") + (r.stderr || "").split("\n").slice(-15).join("\n"));
}
if (!fs.existsSync(APK)) falha("APK não encontrado: " + APK);

adb(["push", APK, "/sdcard/Download/jarvis-fase1.apk"]);
const tam = adb(["shell", "stat", "-c", "%s", "/sdcard/Download/jarvis-fase1.apk"]).trim();
if (Number(tam) !== fs.statSync(APK).size) falha(`cópia incompleta (${tam} de ${fs.statSync(APK).size} bytes)`);
const instalada = (adb(["shell", "dumpsys", "package", "dev.jarvis.companion"]).match(/versionName=(\S+)/) || [])[1] || "(não instalado)";
console.log(`✔ Download/jarvis-fase1.apk = ${versao} (${(Number(tam) / 1024 / 1024).toFixed(1)} MB). Instalada hoje: ${instalada}.`);
console.log("Instale pelo app Arquivos → Download → jarvis-fase1.apk. Depois confira a versão por ADB.");
