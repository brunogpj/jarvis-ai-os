// privacidade-ui.test.js — o modo privacidade do frontend (14/10/2026) depende de classes que o resto da interface usa. Se alguém renomear
// `msg__text` ou `dash-card`, o borrão some sem erro nenhum e o vídeo de demonstração vaza dado. Estes testes amarram os seletores à interface.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var ler = function (f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); };
var CSS = ler('Stylesheet.html'), JS = ler('Javascript.html'), HTML = ler('Index.html');

function bloquePriv() {
  var i = CSS.indexOf('html.priv .msg__text');
  assert.ok(i !== -1, 'bloco do modo privacidade no CSS');
  return CSS.slice(i, CSS.indexOf('}', i));
}

test('Privacidade: o botão, o atalho e a persistência existem e falam do mesmo id e da mesma classe', function () {
  assert.match(HTML, /id="privToggle"/);
  assert.match(JS, /getElementById\("privToggle"\)/);
  assert.match(JS, /root\.classList\.toggle\("priv"/);
  assert.match(JS, /e\.ctrlKey && e\.shiftKey && \(e\.key === "P" \|\| e\.key === "p"\)/);
  assert.match(JS, /localStorage\.setItem\("jarvis-priv"/);
  assert.match(CSS, /html\.priv \.topbar__priv/);
});

test('Privacidade: cada seletor borrado corresponde a uma classe/id que a interface realmente gera', function () {
  var b = bloquePriv();
  var existe = {
    'msg__text': function () { return /msg__text/.test(CSS) && /msg__text/.test(JS); },
    'msg__img': function () { return /msg__img/.test(JS); },
    'dash-card': function () { return /dash-card/.test(JS); },
    'dash-card__head': function () { return /dash-card__head/.test(JS); },
    'dashResumoDia': function () { return /id="dashResumoDia"/.test(HTML); },
    'conv-list': function () { return /class="conv-list"/.test(HTML); },
    'who': function () { return /class="who"/.test(HTML); },
    'popover__head': function () { return /class="popover__head"/.test(HTML); },
    'wpp-instances': function () { return /class="wpp-instances"/.test(HTML); }
  };
  Object.keys(existe).forEach(function (k) {
    assert.ok(b.indexOf(k) !== -1, 'o CSS borra ' + k);
    assert.ok(existe[k](), 'a interface ainda gera ' + k + ' (renomeou? atualize o modo privacidade)');
  });
  assert.match(b, /filter: blur\(/);
  assert.match(b, /pointer-events: none/, 'não dá para clicar em dado borrado');
});

test('Privacidade: o texto digitado pelo apresentador continua visível (o campo de mensagem não é borrado)', function () {
  var b = bloquePriv();
  assert.doesNotMatch(b, /#input|textarea|composer/);
});
