// diagnostico_jev.js — revisão dos eventos REAIS do JEV (lê, não muda nada). Uso: node diagnostico_jev.js [horas=24]
// A URL do /exec e o token vêm de diagnostico.js (que está no .gitignore): este arquivo não guarda segredo nenhum.
const fs = require('fs');
const path = require('path');
const horas = Number(process.argv[2] || 24);
const raw = fs.readFileSync(path.join(__dirname, 'diagnostico.js'), 'utf8');
const base = raw.match(/"(https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec)/)[1];
const token = raw.match(/token=([A-Za-z0-9_-]+)/)[1];

const ROTULOS = /^(gate:jev:ferramentas|gate:jev:agenda|confirma:jev|hook:(acao_sem_fonte|injecao_conteudo|agenda_sem_fonte)|monitor:triagem|web:triagem|rota:jev)/;

async function lerEventos() {
  for (let i = 0; i < 6; i++) {   // o /exec perde respostas (302→404): repete só a LEITURA
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ler_debug', token, n: 200 }), redirect: 'follow', signal: AbortSignal.timeout(200000) });
      const t = await r.text();
      if (!/^\s*</.test(t) && /eventos/.test(t)) return (JSON.parse(t).eventos || []).map((e) => e.dados || e);
    } catch (e) { /* tenta de novo */ }
    await new Promise((z) => setTimeout(z, 5000));
  }
  return null;
}

(async () => {
  const ev = await lerEventos();
  if (!ev) { console.log('FALHA: não consegui ler os eventos (o /exec não respondeu 6 vezes).'); process.exit(1); }
  const corte = Date.now() - horas * 3600e3;
  const tempo = (x) => Number(x.ts || x.quando || x.criadoEm || x.timestamp || 0);
  const recentes = ev.filter((x) => !tempo(x) || tempo(x) >= corte);
  const jev = recentes.filter((x) => ROTULOS.test(x.tool || ''));
  const cont = {};
  jev.forEach((x) => { cont[x.tool] = (cont[x.tool] || 0) + 1; });
  console.log(`Janela: últimas ${horas} h · eventos lidos: ${ev.length} (200 mais recentes) · na janela: ${recentes.length} · do JEV: ${jev.length}`);
  console.log('Por tipo:', JSON.stringify(cont));
  const ms = jev.filter((x) => /^(gate:jev:ferramentas|confirma:jev|rota:jev)/.test(x.tool) && x.ms > 0).map((x) => x.ms).sort((a, b) => a - b);
  if (ms.length) console.log(`Latência do JEV (n=${ms.length}): mediana ${ms[Math.floor(ms.length / 2)]} ms · p90 ${ms[Math.floor(ms.length * 0.9)]} ms · máx ${ms[ms.length - 1]} ms`);
  const voz = {};
  recentes.filter((x) => /^voz:/.test(x.tool || '') && !/^voz:entrega/.test(x.tool)).forEach((x) => { voz[x.tool] = (voz[x.tool] || 0) + 1; });
  console.log('Quem atendeu a voz:', JSON.stringify(voz));
  console.log('\nEventos do JEV (mais recentes primeiro, até 40):');
  jev.slice(0, 40).forEach((x) => console.log(`  ${String(x.tool).padEnd(26)} ${String(x.ms).padStart(5)}ms | ${String(x.resumo || '').slice(0, 130)}`));
})();
