// load.js — carrega um arquivo GAS (.js) num contexto vm com os shims, expondo suas funções
// globais para teste. Code.js é só declarações de função (sem IIFE de topo), então o eval é seguro.
var fs = require('fs');
var vm = require('vm');
var path = require('path');

function loadGasFile(nomeArquivo, sandbox) {
  var code = fs.readFileSync(path.join(__dirname, '..', nomeArquivo), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: nomeArquivo });
  return sandbox;
}

module.exports = { loadGasFile };
