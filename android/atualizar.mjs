#!/usr/bin/env node
/**
 * Atualiza o app do Jarvis no celular, sem ninguém tocar em Arquivos.
 *
 *   node android/atualizar.mjs            compila, copia e instala o APK de debug
 *   node android/atualizar.mjs --sem-build  usa o APK que já está compilado
 *
 * Como funciona (ver Atualizador.kt): o APK vai para a pasta PRIVADA do app (run-as, o app de debug permite), o app é
 * aberto com atualizar=true e instala por uma sessão do PackageInstaller. O Android só aceita se a assinatura for a mesma.
 * Silencioso quando o Android deixa; a PRIMEIRA vez, sobre um app instalado pelo Arquivos, pede uma confirmação na tela.
 *
 * Requisitos: celular no cabo (depuração USB), uma vez "Instalar apps desconhecidos" liberado para o Jarvis.
 * Use ADB e ANDROID_HOME para apontar outras ferramentas.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ADB = process.env.ADB || "C:/Users/Bruno/Android/Sdk/platform-tools/adb.exe";
const SDK = process.env.ANDROID_HOME || "C:/Users/Bruno/Android/Sdk";
const PKG = "dev.jarvis.companion";
const APK = path.join(AQUI, "app/build/outputs/apk/debug/app-debug.apk");
const ENV = { ...process.env, MSYS_NO_PATHCONV: "1", ANDROID_HOME: SDK };

const adb = (args, opc = {}) => execFileSync(ADB, args, { encoding: "utf8", env: ENV, ...opc });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const versaoPlanejada = () => (fs.readFileSync(path.join(AQUI, "app/build.gradle.kts"), "utf8").match(/versionName\s*=\s*"([^"]+)"/) || [])[1];
const versaoInstalada = () => ((adb(["shell", "dumpsys", "package", PKG]).match(/versionName=(\S+)/) || [])[1]) || "(não instalado)";

function falha(msg) { console.error("✖ " + msg); process.exit(1); }

const alvo = versaoPlanejada();
if (!alvo) falha("não achei versionName em app/build.gradle.kts");

// 1) celular
const disp = adb(["devices"]).split("\n").slice(1).filter((l) => /\sdevice$/.test(l.trim()));
if (!disp.length) falha("nenhum celular em modo device. Cabo, depuração USB e a autorização do computador no celular.");
const antes = versaoInstalada();
console.log(`celular ok · instalado: ${antes} · a instalar: ${alvo}`);
if (antes === alvo && !process.argv.includes("--forcar")) { console.log("já está na versão " + alvo + ". Suba o versionName (ou use --forcar)."); process.exit(0); }

// 2) compilar
if (!process.argv.includes("--sem-build")) {
  console.log("compilando…");
  const r = spawnSync(path.join(AQUI, "gradlew.bat"), ["assembleDebug", "--no-daemon", "-q"], { cwd: AQUI, env: ENV, encoding: "utf8", shell: true });
  if (r.status !== 0) falha("a compilação falhou:\n" + (r.stdout || "") + (r.stderr || "").split("\n").slice(-15).join("\n"));
}
if (!fs.existsSync(APK)) falha("APK não encontrado: " + APK);
const bytes = fs.readFileSync(APK);
console.log(`APK ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);

// 3) copiar para a pasta privada do app (a entrada vai pelo stdin do run-as, sem passar por /sdcard)
adb(["shell", "run-as", PKG, "mkdir", "-p", "files/update"]);
adb(["exec-in", "run-as", PKG, "sh", "-c", "cat > files/update/app.apk"], { input: bytes, maxBuffer: 1 << 28 });
const tam = adb(["shell", "run-as", PKG, "wc", "-c", "files/update/app.apk"]).trim().split(/\s+/)[0];
if (Number(tam) !== bytes.length) falha(`cópia incompleta (${tam} de ${bytes.length} bytes)`);

// 4) mandar o app instalar
adb(["shell", "am", "start", "-n", PKG + "/.MainActivity", "--ez", "atualizar", "true"]);
console.log("pedido enviado ao app. Aguardando a instalação…");

// 5) esperar a versão mudar
let avisouConfirmacao = false;
for (let i = 0; i < 45; i++) {
  await dorme(2000);
  let v = "";
  try { v = versaoInstalada(); } catch { continue; }
  if (v === alvo) { console.log("✔ atualizado para " + v); process.exit(0); }
  if (!avisouConfirmacao && i >= 3) {
    let ev = "";
    try { ev = adb(["shell", "run-as", PKG, "cat", "shared_prefs/jarvis_estado.xml"]); } catch {}
    if (/aguarda UMA confirma/.test(ev)) { avisouConfirmacao = true; console.log("⚠ o Android pediu UMA confirmação na tela do celular: toque em Instalar/Atualizar."); }
    const falhou = ev.match(/atualização (não começou|falhou)[^<\n]*/);
    if (falhou) falha(falhou[0]);
  }
}
falha("a versão não mudou em 90 s (instalada: " + versaoInstalada() + "). Veja os eventos na tela do app.");
