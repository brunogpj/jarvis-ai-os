// gas-shims.js — mocks leves dos globais do Google Apps Script p/ rodar a LÓGICA do projeto
// em Node, SEM deploy, SEM nuvem e SEM cota. (Para fidelidade total de Drive/Sheets/Gmail,
// dá p/ plugar o gas-fakes depois — exige ADC; ver README.) Cada teste passa `o` com dados canônicos.

function makeSandbox(o) {
  o = o || {};
  var props = Object.assign({ OWNER_EMAIL: 'dono@exemplo.com' }, o.props || {});
  var cache = {};
  var sandbox = {
    console: console,
    Logger: { log: function () {} },
    Utilities: {
      formatDate: function () { return '01/01 10:00'; },
      getUuid: function () { return 'uuid-' + Math.random().toString(36).slice(2); },
      sleep: function () {}
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return (k in props) ? props[k] : null; },
          setProperty: function (k, v) { props[k] = String(v); }
        };
      }
    },
    CacheService: {
      getScriptCache: function () {
        return { get: function (k) { return (k in cache) ? cache[k] : null; }, put: function (k, v) { cache[k] = v; } };
      }
    },
    GmailApp: {
      getInboxUnreadCount: function () { return (o.emails || []).length; },
      search: function () {
        return (o.emails || []).map(function (e) {
          return { getMessages: function () { return [{ getSubject: function () { return e.assunto; }, getFrom: function () { return e.de; } }]; } };
        });
      }
    },
    CalendarApp: {
      getDefaultCalendar: function () {
        return { getEvents: function () { return (o.eventos || []).map(function (t) { return { getStartTime: function () { return new Date(); }, getTitle: function () { return t; } }; }); } };
      }
    },
    DriveApp: {},
    // Rede: o teste passa `o.fetch(url, params)` e recebe de volta o que quiser.
    // Devolvendo {code, body} o shim embrulha no formato do HTTPResponse; devolvendo um objeto
    // com getResponseCode o stub assume o controle total. SEM stub, estoura de propósito —
    // um teste que bate na rede de verdade não é teste offline.
    UrlFetchApp: {
      fetch: function (url, params) {
        if (typeof o.fetch !== 'function') throw new Error('UrlFetchApp.fetch sem stub (passe o.fetch no teste)');
        var r = o.fetch(url, params) || {};
        if (typeof r.getResponseCode === 'function') return r;
        return {
          getResponseCode: function () { return r.code === undefined ? 200 : r.code; },
          getContentText: function () { return typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {}); }
        };
      }
    },
    Tarefas: { listar: function () { return (o.tarefas || []).map(function (t) { return { titulo: t }; }); } },
    Autorizacoes: { listar: function () { return (o.autorizacoes || []); } },
    WhatsApp: { listarAgendadas: function () { return (o.agendadas || []); } },
    Web: { listar: function () { return (o.monitores || []); } },
    Gemini: { gerarTextoFallback: function () { return (o.reserva !== undefined ? o.reserva : 'resposta de conversa'); } },
    Jarvis: { registrarEvento: function () {}, _isOwner: function (e) { return e === props.OWNER_EMAIL; } },
    Firestore: { listDocs: function () { return o.docs || []; }, getDoc: function () { return null; }, setDoc: function () { return true; } }
  };
  return sandbox;
}

module.exports = { makeSandbox };
