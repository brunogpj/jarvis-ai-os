#!/usr/bin/env node
/**
 * Gerador de imagens e vídeos pelo Google Gemini. Substitui o kie.mjs da skill
 * scroll-craft (mesmos comandos e flags), mas fala com a API do Google.
 *
 *   still  <prompt> <out.png> [--ar 16:9] [--ref a.png ...] [--model id]
 *          Nano Banana (generateContent). --ref pode repetir (edição/composição).
 *
 *   shot   <prompt> <head.png> <out.mp4> [--tail b.png] [--dur 5] [--ar 16:9]
 *          [--res 720p] [--model id]
 *          gemini-omni-1.2-flash (Interactions API), imagem -> vídeo. --tail fixa
 *          o ÚLTIMO quadro (duração de 3 a 10 s nesse modo; sem --tail, 3 a 15 s).
 *
 *   probe  confere a chave e os dois modelos, sem gerar nada (custo zero).
 *
 * Chave: lida de GEMINI_ENV_FILE, senão do primeiro .env.googleAPI achado
 * subindo a partir desta pasta e da pasta atual. Aceita "GEMINI_API_KEY=...",
 * "GOOGLE_API_KEY=..." ou a linha "Chave de API = ...". A chave NUNCA é impressa.
 * Modelos: GEMINI_IMAGE_MODEL / GEMINI_VIDEO_MODEL sobrescrevem os padrões.
 *
 * Por que a chave vem do arquivo e não da cascata do Jarvis: aqui é uso local,
 * a chave é a de faturamento (vídeo não tem camada gratuita).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://generativelanguage.googleapis.com/v1beta";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || "gemini-omni-1.2-flash";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- chave ----
function achaEnv() {
  if (process.env.GEMINI_ENV_FILE) return process.env.GEMINI_ENV_FILE;
  for (const inicio of [HERE, process.cwd()]) {
    let dir = path.resolve(inicio);
    for (let i = 0; i < 8; i++) {
      const p = path.join(dir, ".env.googleAPI");
      if (fs.existsSync(p)) return p;
      const acima = path.dirname(dir);
      if (acima === dir) break;
      dir = acima;
    }
  }
  return null;
}

function carregaChave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const arq = achaEnv();
  if (!arq || !fs.existsSync(arq)) {
    throw new Error("Arquivo .env.googleAPI não encontrado (defina GEMINI_ENV_FILE ou GEMINI_API_KEY).");
  }
  for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY|Chave de API)\s*[=:]\s*(.+?)\s*$/i);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("Nenhuma chave (GEMINI_API_KEY, GOOGLE_API_KEY ou 'Chave de API') em " + arq);
}

let KEY_CACHE = null;
const key = () => (KEY_CACHE ||= carregaChave());
const cabecalho = () => ({ "Content-Type": "application/json", "x-goog-api-key": key() });

// -------------------------------------------------------------- ajudantes ----
function flag(args, nome, padrao) {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : padrao;
}
function flags(args, nome) {
  const r = [];
  args.forEach((a, i) => { if (a === nome && args[i + 1] !== undefined) r.push(args[i + 1]); });
  return r;
}
// Remove as flags (e o valor de cada uma) para sobrarem só os argumentos posicionais.
function posicionais(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) { i++; continue; }
    out.push(args[i]);
  }
  return out;
}
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
function lerImagem(arq) {
  if (!fs.existsSync(arq)) throw new Error("Imagem não encontrada: " + arq);
  const mime = MIME[path.extname(arq).toLowerCase()];
  if (!mime) throw new Error("Formato de imagem não suportado (use png, jpg ou webp): " + arq);
  return { mime, data: fs.readFileSync(arq).toString("base64") };
}
function salvar(arq, buffer) {
  fs.mkdirSync(path.dirname(path.resolve(arq)), { recursive: true });
  fs.writeFileSync(arq, buffer);
  console.log(`salvo: ${arq} (${(buffer.length / 1024).toFixed(0)} KB)`);
}
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// Chamada com nova tentativa só para 429 e 5xx. Erro 4xx (prompt recusado, modelo
// inexistente) volta na hora com a mensagem do Google, sem a chave.
async function chama(url, opcoes, rotulo, tentativas = 3) {
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    const res = await fetch(url, opcoes);
    if (res.ok) return res;
    let msg = await res.text();
    try { msg = JSON.parse(msg).error?.message || msg; } catch { /* texto cru */ }
    ultimo = `${rotulo} falhou (HTTP ${res.status}): ${String(msg).slice(0, 300)}`;
    if (res.status === 429 && /spending cap|monthly/i.test(msg)) {
      throw new Error(ultimo + "\n→ Teto de gasto do projeto no Google atingido: ajuste em ai.studio/spend.");
    }
    if (res.status !== 429 && res.status < 500) break;
    if (t < tentativas) await dorme(2000 * t * t);
  }
  throw new Error(ultimo);
}

// ------------------------------------------------------------------ still ----
async function still(args) {
  const [prompt, out] = posicionais(args);
  if (!prompt || !out) throw new Error('uso: still "<prompt>" <out.png> [--ar 16:9] [--ref a.png ...] [--model id]');
  const modelo = flag(args, "--model", IMAGE_MODEL);
  const parts = [{ text: prompt }];
  for (const r of flags(args, "--ref")) {
    const im = lerImagem(r);
    parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
  }
  const generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
  const ar = flag(args, "--ar");
  if (ar) generationConfig.imageConfig = { aspectRatio: ar };
  const res = await chama(`${API}/models/${modelo}:generateContent`, {
    method: "POST", headers: cabecalho(),
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
  }, `imagem (${modelo})`);
  const j = await res.json();
  const partes = j.candidates?.[0]?.content?.parts || [];
  const img = partes.find((p) => (p.inlineData || p.inline_data)?.data);
  if (!img) {
    const motivo = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || "sem imagem na resposta";
    throw new Error(`O modelo ${modelo} não devolveu imagem (${motivo}). Reformule o prompt.`);
  }
  salvar(out, Buffer.from((img.inlineData || img.inline_data).data, "base64"));
}

// ------------------------------------------------------------------- shot ----
function acharVideo(obj) {
  // Resposta REST: steps[] -> model_output -> content[] -> {type:"video", data|uri}
  const passos = obj.steps || [];
  for (const p of passos) {
    if (p.type !== "model_output") continue;
    for (const c of p.content || []) if (c.type === "video") return c;
  }
  return null;
}

async function shot(args) {
  const [prompt, head, out] = posicionais(args);
  if (!prompt || !head || !out) {
    throw new Error('uso: shot "<prompt>" <head.png> <out.mp4> [--tail b.png] [--dur 5] [--ar 16:9] [--res 720p]');
  }
  const modelo = flag(args, "--model", VIDEO_MODEL);
  const tail = flag(args, "--tail");
  const dur = Number(flag(args, "--dur", "5"));
  const maximo = tail ? 10 : 15;
  if (!Number.isInteger(dur) || dur < 3 || dur > maximo) {
    throw new Error(`--dur deve ser um inteiro de 3 a ${maximo} segundos${tail ? " (com --tail)" : ""}.`);
  }
  const input = [];
  const h = lerImagem(head);
  input.push({ type: "image", data: h.data, mime_type: h.mime });
  if (tail) {
    const t = lerImagem(tail);
    input.push({ type: "image", data: t.data, mime_type: t.mime });
  }
  input.push({ type: "text", text: prompt });

  const response_format = { type: "video", duration: `${dur}s` };
  const ar = flag(args, "--ar");
  if (ar) response_format.aspect_ratio = ar;
  const res_ = flag(args, "--res");
  if (res_) response_format.resolution = res_;

  console.log(`gerando vídeo (${modelo}, ${dur}s${tail ? ", com quadro final" : ""})… pode levar alguns minutos`);
  const res = await chama(`${API}/interactions`, {
    method: "POST", headers: cabecalho(),
    body: JSON.stringify({ model: modelo, input, response_format }),
  }, `vídeo (${modelo})`, 2);
  const j = await res.json();
  const v = acharVideo(j);
  if (!v) {
    const resumo = JSON.stringify(j).replace(key(), "<chave>").slice(0, 400);
    throw new Error("A resposta não trouxe vídeo. Início da resposta: " + resumo);
  }
  if (v.data) return salvar(out, Buffer.from(v.data, "base64"));
  if (v.uri) {
    // Arquivos grandes (> 4 MB) podem vir por URI no Files API; baixa com a chave.
    const alvo = v.uri.includes("?") ? v.uri : v.uri + (v.uri.includes(":download") ? "?alt=media" : "");
    const r = await chama(alvo, { headers: { "x-goog-api-key": key() } }, "download do vídeo");
    return salvar(out, Buffer.from(await r.arrayBuffer()));
  }
  throw new Error("O item de vídeo veio sem 'data' nem 'uri'.");
}

// ------------------------------------------------------------------ probe ----
async function probe() {
  console.log("chave: encontrada (não exibida)");
  for (const [rotulo, modelo] of [["imagem", IMAGE_MODEL], ["vídeo", VIDEO_MODEL]]) {
    const r = await fetch(`${API}/models/${modelo}`, { headers: cabecalho() });
    console.log(`${rotulo}: ${modelo} → ${r.ok ? "disponível" : "HTTP " + r.status}`);
  }
}

// ------------------------------------------------------------------- main ----
const [cmd, ...resto] = process.argv.slice(2);
try {
  if (cmd === "still") await still(resto);
  else if (cmd === "shot") await shot(resto);
  else if (cmd === "probe") await probe();
  else {
    console.log(`uso:
  node gemini-midia.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref ref.png ...]
  node gemini-midia.mjs shot  "<prompt>" <head.png> <out.mp4> [--tail tail.png] [--dur 5] [--ar 16:9] [--res 720p]
  node gemini-midia.mjs probe`);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  let msg = String(e.message);
  if (KEY_CACHE) msg = msg.split(KEY_CACHE).join("<chave>");   // rede de segurança: a chave nunca sai no erro
  console.error("erro: " + msg);
  process.exit(1);
}
