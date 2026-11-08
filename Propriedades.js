/**
 * Propriedades.js — manutenção das Script Properties (08/11/2026).
 *
 * O Apps Script só edita propriedades pela interface até 50; passou disso a lista fica SOMENTE LEITURA e o
 * gerenciamento tem que ser por código. Estas funções rodam no editor (menu de funções → Executar).
 *
 * Regras de segurança, de propósito:
 *  - auditarPropriedades() só LÊ e só mostra NOMES, tamanho e tipo. Nunca imprime um valor (há credenciais aqui).
 *  - limparPropriedades() começa em ENSAIO. Só apaga com EXECUTAR = true, e antes grava um BACKUP COM OS VALORES num
 *    arquivo do Drive do dono (privado), para dar para restaurar com restaurarPropriedades().
 *  - Chaves que parecem credencial (_SA, _TOKEN, _SECRET, API_KEY, URL de webhook) NÃO saem pela lista comum:
 *    precisam estar em FORCAR_CREDENCIAIS, dito de propósito. O código-fonte é público: a lista de remoção vive só
 *    no editor do dono e nunca é commitada com valores.
 */
var Propriedades = (function () {
  var TZ = 'America/Sao_Paulo';
  var PARECE_CREDENCIAL = /(_SA$|^TTS_SA|_TOKEN|_SECRET|API_KEY|_PASS|PRIVATE|_URL$|OWNER|WEBHOOK)/i;

  function _todas() { return PropertiesService.getScriptProperties().getProperties(); }
  function _tipo(v) {
    var s = String(v == null ? '' : v);
    if (/^[\[{]/.test(s)) return 'json';
    if (/^https?:\/\//.test(s)) return 'url';
    if (/^[0-9a-f]{32,}$/i.test(s)) return 'hex';
    return s.length > 60 ? 'texto-longo' : 'texto';
  }

  /** Só leitura: total e, por chave, tamanho e tipo. NUNCA o valor. */
  function auditar() {
    var p = _todas(), chaves = Object.keys(p).sort();
    var itens = chaves.map(function (k) { var v = String(p[k]); return { chave: k, tamanho: v.length, tipo: _tipo(v), credencial: PARECE_CREDENCIAL.test(k) }; });
    return { total: itens.length, itens: itens };
  }

  /** Grava o backup (com valores) num arquivo do Drive do dono e devolve o id. */
  function _backup(chaves) {
    var p = _todas(), obj = {};
    chaves.forEach(function (k) { if (k in p) obj[k] = p[k]; });
    var nome = 'backup_propriedades_removidas_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HH-mm') + '.json';
    var f = DriveApp.createFile(nome, JSON.stringify(obj, null, 1), 'application/json');
    return { id: f.getId(), nome: nome };
  }

  /**
   * @param {string[]} chaves  as que o dono aprovou apagar
   * @param {boolean}  executar  false = ensaio (não mexe em nada)
   * @param {string[]} forcarCredenciais  chaves com cara de credencial que o dono também quer apagar, nomeadas
   */
  function limpar(chaves, executar, forcarCredenciais) {
    var p = _todas(), forcar = forcarCredenciais || [], apagar = [], recusadas = [], inexistentes = [];
    (chaves || []).forEach(function (k) {
      if (!(k in p)) { inexistentes.push(k); return; }
      if (PARECE_CREDENCIAL.test(k) && forcar.indexOf(k) === -1) { recusadas.push(k); return; }
      apagar.push(k);
    });
    var saida = { ensaio: !executar, apagariam: apagar, recusadas_por_parecer_credencial: recusadas, nao_existem: inexistentes, total_antes: Object.keys(p).length };
    if (!executar || !apagar.length) return saida;
    var bk = _backup(apagar);
    var sp = PropertiesService.getScriptProperties();
    apagar.forEach(function (k) { sp.deleteProperty(k); });
    saida.backup = bk;
    saida.apagadas = apagar.length;
    saida.total_depois = Object.keys(_todas()).length;
    return saida;
  }

  /** Devolve ao Script Properties o que um backup guardou (só chaves que hoje NÃO existem; não sobrescreve nada). */
  function restaurar(idArquivo) {
    var obj = JSON.parse(DriveApp.getFileById(idArquivo).getBlob().getDataAsString());
    var sp = PropertiesService.getScriptProperties(), existentes = sp.getKeys(), voltou = [];
    Object.keys(obj).forEach(function (k) { if (existentes.indexOf(k) === -1) { sp.setProperty(k, String(obj[k])); voltou.push(k); } });
    return { restauradas: voltou };
  }

  return { auditar: auditar, limpar: limpar, restaurar: restaurar };
})();

/* ---- Pontos de entrada para o editor (o menu de funções só lista funções SEM parâmetros) ---- */

/** Roda e olhe o "Registro de execução": nomes, tamanhos e tipos. Nunca valores. */
function auditarPropriedades() {
  var r = Propriedades.auditar();
  Logger.log('TOTAL DE PROPRIEDADES: ' + r.total);
  r.itens.forEach(function (i) { Logger.log(i.chave + ' | ' + i.tamanho + ' | ' + i.tipo + (i.credencial ? ' | CREDENCIAL?' : '')); });
}

/**
 * Lista de remoção APROVADA pelo dono. Fica vazia no repositório. O Claude preenche no editor depois da auditoria e da
 * conferência contra o código, e o dono confere antes de rodar com EXECUTAR = true.
 */
var PROPRIEDADES_PARA_REMOVER = [];
var PROPRIEDADES_CREDENCIAIS_PARA_REMOVER = [];

/** PONTO_COBRADO_<aaaa-mm-dd>_<min>: só a do dia corrente é lida. As de dias passados são lixo (acumularam 190 até 08/11/2026). */
function _pontoCobradoAntigas() {
  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  return PropertiesService.getScriptProperties().getKeys().filter(function (k) { return /^PONTO_COBRADO_[0-9]{4}-[0-9]{2}-[0-9]{2}_/.test(k) && k.indexOf('PONTO_COBRADO_' + hoje + '_') !== 0; });
}

/** Ensaio da limpeza das marcas antigas do ponto: mostra quantas e quais sairiam, sem apagar. */
function limparPontoCobradoEnsaio() {
  var r = Propriedades.limpar(_pontoCobradoAntigas(), false, []);
  Logger.log('APAGARIAM ' + r.apagariam.length + ' de ' + r.total_antes + ' propriedades. Exemplos: ' + r.apagariam.slice(0, 3).join(', ') + ' ... ' + r.apagariam.slice(-2).join(', '));
}

/** Apaga de verdade as marcas antigas do ponto (grava o backup no Drive antes). */
function limparPontoCobradoExecutar() {
  var r = Propriedades.limpar(_pontoCobradoAntigas(), true, []);
  Logger.log('APAGADAS ' + (r.apagadas || 0) + '. Antes: ' + r.total_antes + ', depois: ' + (r.total_depois || r.total_antes) + '. Backup: ' + (r.backup ? r.backup.nome + ' (' + r.backup.id + ')' : 'nenhum'));
}

/** Ensaio: mostra o que seria apagado, sem apagar. */
function limparPropriedadesEnsaio() {
  Logger.log(JSON.stringify(Propriedades.limpar(PROPRIEDADES_PARA_REMOVER, false, PROPRIEDADES_CREDENCIAIS_PARA_REMOVER), null, 1));
}

/** Apaga de verdade (depois de gravar o backup no Drive). */
function limparPropriedadesExecutar() {
  Logger.log(JSON.stringify(Propriedades.limpar(PROPRIEDADES_PARA_REMOVER, true, PROPRIEDADES_CREDENCIAIS_PARA_REMOVER), null, 1));
}
