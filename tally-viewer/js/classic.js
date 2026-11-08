/* Tally Viewer – Classic Tally look.
   Renders the TallyPrime-style chrome when html[data-ui="classic"] is set: the top menu strip
   (K: Company, G: Go To, E: Export, F1: Help), a report header band, the function-key button bar
   and the Gateway of Tally home screen with red hotkey letters. Everything else keeps the same DOM
   and is restyled by css/classic.css. The toggle (data-act="ui") lives in the top bar of both looks;
   the preference is stored in localStorage under tv.ui. */
(function () {
  'use strict';
  var A = window.TVApp, S = A.S, esc = A.esc, go = A.go, lsGet = A.lsGet, lsSet = A.lsSet;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Tally writes dates as 1-Apr-24
  function tDate(d) { if (!d) return ''; var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + '-' + (MON[m - 1] || m) + '-' + String(y).slice(2); }
  function on() { return document.documentElement.getAttribute('data-ui') === 'classic'; }
  function apply() {
    var classic = lsGet('tv.ui', 'modern') === 'classic';
    if (classic) document.documentElement.setAttribute('data-ui', 'classic'); else document.documentElement.removeAttribute('data-ui');
    if (classic) { var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', '#F7F9FB'); }
  }
  function toggle() {
    var toClassic = !on();
    lsSet('tv.ui', toClassic ? 'classic' : 'modern');
    apply(); A.applyTheme(); A.render();
    A.toast(toClassic ? 'Classic Tally look · tap "Modern UI" at the top to switch back' : 'Modern look', 3200);
  }
  // wraps the hotkey letter inside a label: hot('Banking', 'n') → Ba<b>n</b>king
  function hot(label, key) {
    var i = label.toLowerCase().indexOf(key.toLowerCase());
    if (i === -1) return '<b>' + esc(key) + '</b>: ' + esc(label);
    return esc(label.slice(0, i)) + '<b>' + esc(label.charAt(i)) + '</b>' + esc(label.slice(i + 1));
  }

  /* ---- top bar: Tally menu strip + report header ------------------------- */
  function topbar(opts) {
    var $top = document.getElementById('top');
    var h = '<div class="cl-menu">' +
      '<button data-act="company"' + (S.companies.length ? '' : ' disabled') + '><b>K</b>: Company</button>' +
      '<button data-act="goto"><b>G</b>: Go To</button>' +
      '<button data-act="clexport"><b>E</b>: Export</button>' +
      '<button data-go="help"><b>F1</b>: Help</button>' +
      '<button class="cl-switch" data-act="ui" title="Switch to the modern look">Modern UI</button></div>';
    h += '<div class="cl-head">' + (opts.back ? '<button class="back" data-act="back" aria-label="Back">‹</button>' : '') + '<div class="main">';
    if (S.company && opts.title !== S.company.name) h += '<div class="co">' + esc(S.company.name) + '</div>';
    h += '<div class="ttl">' + esc(opts.title) + '</div>' + (opts.sub && !(S.company && opts.sub === S.company.name) ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>';
    if (opts.period !== false && S.book) h += '<button class="per" data-act="period"><small>F2: Period</small>' + esc(tDate(S.period.from)) + ' to ' + esc(tDate(S.period.to)) + '</button>';
    h += '</div>' + (opts.extra || '');
    $top.innerHTML = h;
  }

  /* ---- button bar ----------------------------------------------------------- */
  var NAVC = [['home', 'G', 'Gateway'], ['ledgers', 'L', 'Ledgers'], ['vouchers', 'D', 'Day Book'], ['reports', 'R', 'Reports'], ['tools', 'T', 'Tools']];
  var BAR = [['act', 'period', 'F2', 'Period', true], ['act', 'company', 'F3', 'Company', false], ['act', 'newentry', 'V', 'Voucher', true], ['act', 'clexport', 'E', 'Export', false], ['go', 'more', 'F12', 'Configure', false]];
  function nav(r, cur) {
    var h = NAVC.map(function (n) { return '<button data-go="' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '"><b>' + n[1] + '</b><span>' + n[2] + '</span></button>'; }).join('');
    h += BAR.map(function (x) { var dis = (x[4] && !S.book) || (x[1] === 'company' && !S.companies.length); return '<button data-' + x[0] + '="' + x[1] + '"' + (dis ? ' disabled' : '') + (cur === x[1] ? ' class="on"' : '') + '><b>' + x[2] + '</b><span>' + x[3] + '</span></button>'; }).join('');
    document.getElementById('nav').innerHTML = h;
  }

  /* ---- Gateway of Tally ----------------------------------------------------- */
  var MENU = [
    ['sec', 'Masters'],
    ['go', 'ledgers', 'C', 'Chart of Accounts'],
    ['sec', 'Transactions'],
    ['act', 'newentry', 'V', 'Vouchers'],
    ['go', 'vouchers', 'D', 'Day Book'],
    ['sec', 'Utilities'],
    ['go', 'report/cashbank', 'n', 'Banking'],
    ['go', 'pending', 'x', 'Exchange'],
    ['go', 'tools', 'T', 'Tools'],
    ['sec', 'Reports'],
    ['go', 'report/bs', 'B', 'Balance Sheet'],
    ['go', 'report/pl', 'P', 'Profit & Loss A/c'],
    ['go', 'report/stock', 'S', 'Stock Summary'],
    ['go', 'report/ratios', 'R', 'Ratio Analysis'],
    ['go', 'reports', 'M', 'Display More Reports'],
    ['go', 'companies', 'Q', 'Quit']
  ];
  function gateway() {
    var b = S.book, p = S.period, c = S.company, ci = c.info || {}, now = new Date();
    topbar({ title: c.name });
    var h = '<div class="cl-gw"><div class="cl-info">' +
      '<div><div class="k">Current period</div><div class="v">' + tDate(p.from) + ' to ' + tDate(p.to) + '</div></div>' +
      '<div><div class="k">Current date</div><div class="v">' + DAYS[now.getDay()] + ', ' + now.getDate() + '-' + MON[now.getMonth()] + '-' + now.getFullYear() + '</div></div>' +
      '<button class="co" data-act="company"><div class="k">Name of company</div><div class="v">' + esc(c.name) + '</div></button>' +
      '<div><div class="k">Books beginning from</div><div class="v">' + (ci.booksFrom ? tDate(ci.booksFrom) : b.minDate ? tDate(b.minDate) : '—') + '</div></div>' +
      '<div><div class="k">Date of last entry</div><div class="v">' + (b.maxDate ? tDate(b.maxDate) : '—') + '</div></div>' +
      '</div>';
    h += '<div class="cl-panel"><div class="cl-panel-title">Gateway of Tally</div>' + MENU.map(function (m) {
      if (m[0] === 'sec') return '<div class="cl-sec">' + m[1] + '</div>';
      return '<button class="cl-item' + (m[3] === 'Quit' ? ' quit' : '') + '" data-' + m[0] + '="' + m[1] + '" data-key="' + m[2].toLowerCase() + '">' + hot(m[3], m[2]) + '</button>';
    }).join('') + '</div></div>';
    h += '<div class="cl-status"><span>Tally Viewer → Gateway of Tally</span><span>' + A.pluralize(b.vouchers.length, 'voucher') + ' · ' + A.pluralize(b.ledgerNames.length, 'ledger') + '</span></div>';
    A.$view().innerHTML = h;
  }

  function after(r) { document.documentElement.setAttribute('data-screen', r.name); }

  /* ---- G: Go To ------------------------------------------------------------- */
  function gotoSheet() {
    var dests = [];
    A.REPORTS.forEach(function (r) { dests.push({ t: r[1], s: 'Report · ' + r[2], h: '#/report/' + r[0] }); });
    [['Gateway of Tally', 'home'], ['Chart of Accounts', 'ledgers'], ['Day Book', 'vouchers'], ['Display More Reports', 'reports'], ['Tools', 'tools'], ['Companies', 'companies'], ['Import Tally data', 'import'], ['Sync over Wi-Fi', 'sync'], ['Entries made in app', 'pending'], ['Company GST details', 'gst'], ['Configure', 'more'], ['Help', 'help']]
      .forEach(function (x) { dests.push({ t: x[0], s: 'Screen', h: '#/' + x[1] }); });
    var b = S.book;
    var bg = A.sheet('<h3>Go To</h3><input type="search" id="cl-goto" placeholder="Report, screen or ledger name" autocomplete="off"><div class="list" id="cl-goto-list" style="margin-top:8px"></div>', function (ev, bg) {
      var o = ev.target.closest('[data-h]'); if (!o) return; bg.remove(); go(o.getAttribute('data-h'));
    });
    var inp = bg.querySelector('#cl-goto'), list = bg.querySelector('#cl-goto-list');
    function fill() {
      var q = inp.value.trim().toLowerCase(), out = [];
      dests.forEach(function (d) { if (!q || d.t.toLowerCase().indexOf(q) !== -1) out.push(d); });
      if (b && q) { var n = 0; for (var i = 0; i < b.ledgerNames.length && n < 30; i++) { var nm = b.ledgerNames[i]; if (nm.toLowerCase().indexOf(q) !== -1) { out.push({ t: nm, s: 'Ledger · ' + (b.ledgers[nm].parent || 'Primary'), h: '#/ledger/' + encodeURIComponent(nm) }); n++; } } }
      list.innerHTML = out.slice(0, 40).map(function (d) { return '<button class="row" data-h="' + esc(d.h) + '"><div class="main"><div class="t">' + esc(d.t) + '</div><div class="s">' + esc(d.s) + '</div></div></button>'; }).join('') || '<div class="empty small">Nothing matches.</div>';
    }
    inp.oninput = fill; fill();
    inp.onkeydown = function (ev) { if (ev.key === 'Enter') { var first = list.querySelector('[data-h]'); if (first) { bg.remove(); go(first.getAttribute('data-h')); } } };
    setTimeout(function () { inp.focus(); }, 60);
  }

  /* ---- E: Export (whatever the current screen offers) ----------------------- */
  function exportSheet() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('#view .actions .act, #view [data-export]'));
    if (!btns.length) { A.toast('Nothing to export here. Open a ledger, the ledger list or a report.', 3200); return; }
    A.sheet('<h3>Export</h3>' + btns.map(function (bt, i) { return '<button class="opt" data-i="' + i + '">' + esc(bt.textContent.trim()) + '</button>'; }).join(''), function (ev, bg) {
      var o = ev.target.closest('.opt'); if (!o) return; bg.remove(); btns[parseInt(o.getAttribute('data-i'), 10)].click();
    });
  }

  /* ---- events ---------------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act="ui"],[data-act="goto"],[data-act="clexport"]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'ui') toggle(); else if (act === 'goto') gotoSheet(); else if (act === 'clexport') exportSheet();
  });
  // Tally-style keyboard: hotkeys on the Gateway, F2/F3/F12, Esc to go back (hardware keyboards and desktop)
  document.addEventListener('keydown', function (ev) {
    if (!on() || ev.ctrlKey || ev.metaKey) return;
    var tag = (ev.target && ev.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    var open = document.querySelector('.sheet-bg');
    if (ev.key === 'Escape') { if (open) { open.remove(); ev.preventDefault(); } else if (!typing && S.route && S.route.name !== 'home') { ev.preventDefault(); if (history.length > 1) history.back(); else go('#/home'); } return; }
    if (typing || open) return;
    var nav = document.getElementById('nav'), bt = null;
    if (ev.key === 'F2') bt = nav.querySelector('[data-act="period"]'); else if (ev.key === 'F3') bt = nav.querySelector('[data-act="company"]'); else if (ev.key === 'F12') bt = nav.querySelector('[data-go="more"]'); else if (ev.key === 'F1') { ev.preventDefault(); go('#/help'); return; }
    if (bt) { ev.preventDefault(); if (!bt.disabled) bt.click(); return; }
    if (ev.key.length !== 1) return;
    var k = ev.key.toLowerCase();
    if (ev.altKey) { if (k === 'g') { ev.preventDefault(); gotoSheet(); } return; }
    if (S.route && S.route.name === 'home') { var item = document.querySelector('.cl-item[data-key="' + k + '"]'); if (item) { ev.preventDefault(); item.click(); } return; }
    if (k === 'k' && S.companies.length) { ev.preventDefault(); document.querySelector('.cl-menu [data-act="company"]').click(); return; }
    var n = { g: 'home', l: 'ledgers', d: 'vouchers', r: 'reports', t: 'tools' }[k];
    if (n) { ev.preventDefault(); go('#/' + n); }
  });

  apply();
  window.TVClassic = { on: on, apply: apply, toggle: toggle, topbar: topbar, nav: nav, gateway: gateway, after: after, gotoSheet: gotoSheet, exportSheet: exportSheet, tDate: tDate };
})();
