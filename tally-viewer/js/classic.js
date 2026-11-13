/* Tally Viewer – Classic Tally look.
   Renders the TallyPrime-style chrome when html[data-ui="classic"] is set: the Alt+ menu strip
   (K Company, Y Data, Z Exchange, G Go To, O Import, E Export, M Share, P Print, F1 Help), a report
   header band with a breadcrumb status line, a screen-aware function-key button bar, the Gateway of
   Tally home screen, and Tally's keyboard model: red hotkey letters on menu-like lists and sheets,
   Up/Down cursor with Enter, F2/F3/F12, Alt+F1 Detailed on reports, F4–F9 voucher types and Ctrl+A
   on entry screens. Everything else keeps the same DOM and is restyled by css/classic.css. The toggle
   (data-act="ui") lives in the top bar of both looks; the preference is stored in localStorage under tv.ui. */
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
    A.toast(toClassic ? 'Classic Tally look · "Modern UI" in the menu strip switches back' : 'Modern look', 3200);
  }
  // wraps the hotkey letter inside a label: hot('Banking', 'n') → Ba<b>n</b>king
  function hot(label, key) {
    var i = label.toLowerCase().indexOf(key.toLowerCase());
    if (i === -1) return '<b>' + esc(key) + '</b>: ' + esc(label);
    return esc(label.slice(0, i)) + '<b>' + esc(label.charAt(i)) + '</b>' + esc(label.slice(i + 1));
  }
  // Tally-style unique hotkey: the first letter (or digit) of the label not yet used on this screen.
  // Returns { key, html } with the letter wrapped in <b class="hk">; key is '' when every letter is taken.
  function hotLabel(label, used) {
    label = String(label || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < label.length; i++) {
      var c = label.charAt(i).toLowerCase();
      if (/[a-z0-9]/.test(c) && !used[c]) { used[c] = 1; return { key: c, html: esc(label.slice(0, i)) + '<b class="hk">' + esc(label.charAt(i)) + '</b>' + esc(label.slice(i + 1)) }; }
    }
    return { key: '', html: esc(label) };
  }
  function topSheet() { var all = document.querySelectorAll('.sheet-bg'); return all.length ? all[all.length - 1] : null; }
  function isTyping(el) { var tag = (el && el.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(el && el.isContentEditable); }
  function isEntryScreen() { return !!(S.route && (S.route.name === 'entry' || S.route.name === 'invoice')); }

  /* ---- top bar: Tally menu strip + report header + status line ----------------- */
  // Tally's top menu in Tally's order. Every item is Alt+<letter> on a keyboard (data-menu holds the letter).
  var STRIP = [
    ['k', 'act', 'company', 'K', 'Company'],
    ['y', 'act', 'cldata', 'Y', 'Data'],
    ['z', 'go', 'pending', 'Z', 'Exchange'],
    ['g', 'act', 'goto', 'G', 'Go To'],
    ['o', 'go', 'import', 'O', 'Import'],
    ['e', 'act', 'clexport', 'E', 'Export'],
    ['m', 'act', 'clshare', 'M', 'Share'],
    ['p', 'act', 'clprint', 'P', 'Print'],
    ['f1', 'go', 'help', 'F1', 'Help']
  ];
  function stripDisabled(target) {
    if (target === 'company') return !S.companies.length;
    if (target === 'pending' || target === 'clexport') return !S.book;
    return false;
  }
  // Tally's bottom line: where you are, from the current route ("Gateway of Tally → Display More Reports → Balance Sheet")
  var GATEWAY_REPORTS = { bs: 1, pl: 1, stock: 1, ratios: 1 };
  function crumb(opts) {
    var r = S.route || { name: 'home' }, t = opts.title || '', parts;
    switch (r.name) {
      case 'companies': return 'Tally Viewer → Select Company';
      case 'home': parts = []; break;
      case 'ledgers': parts = ['Chart of Accounts']; break;
      case 'ledger': parts = ['Chart of Accounts', t]; break;
      case 'vouchers': parts = ['Day Book']; break;
      case 'voucher': parts = ['Day Book', t]; break;
      case 'reports': parts = ['Display More Reports']; break;
      case 'report': parts = GATEWAY_REPORTS[r.arg] ? [t] : ['Display More Reports', t]; break;
      case 'stock': parts = ['Stock Summary', t]; break;
      case 'tools': parts = ['Tools']; break;
      case 'tool': parts = ['Tools', t]; break;
      case 'entry': case 'invoice': parts = ['Vouchers', t]; break;
      case 'pending': parts = ['Exchange', t]; break;
      case 'import': parts = ['Import', t]; break;
      case 'sync': parts = ['Data', t]; break;
      case 'gst': parts = ['Configure', t]; break;
      case 'more': parts = ['Configure']; break;
      case 'help': parts = ['Help']; break;
      default: parts = t ? [t] : [];
    }
    return ['Gateway of Tally'].concat(parts.filter(Boolean)).join(' → ');
  }
  function topbar(opts) {
    var $top = document.getElementById('top');
    var h = '<div class="cl-menu">' + STRIP.map(function (m) {
      return '<button data-' + m[1] + '="' + m[2] + '" data-menu="' + m[0] + '"' + (stripDisabled(m[2]) ? ' disabled' : '') + ' title="Alt+' + m[3] + '"><b>' + m[3] + '</b>: ' + m[4] + '</button>';
    }).join('') + '<button class="cl-switch" data-act="ui" title="Switch to the modern look">Modern UI</button></div>';
    h += '<div class="cl-head">' + (opts.back ? '<button class="back" data-act="back" aria-label="Back">‹</button>' : '') + '<div class="main">';
    if (S.company && opts.title !== S.company.name) h += '<div class="co">' + esc(S.company.name) + '</div>';
    h += '<div class="ttl">' + esc(opts.title) + '</div>' + (opts.sub && !(S.company && opts.sub === S.company.name) ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>';
    if (opts.period !== false && S.book) { var per = tDate(S.period.from) + ' to ' + tDate(S.period.to); h += '<button class="per" data-act="period" aria-label="Period: ' + esc(per) + '"><small>Period</small>' + esc(per) + '</button>'; }
    h += '</div>' + (opts.extra || '');
    h += '<div class="cl-status"><span>' + esc(crumb(opts)) + '</span><span>Tally Viewer ' + esc(A.VERSION || window.TV_VERSION || '') + '</span></div>';
    $top.innerHTML = h;
  }

  /* ---- button bar (screen-aware) --------------------------------------------- */
  var NAVC = [['home', 'G', 'Gateway'], ['ledgers', 'L', 'Ledgers'], ['vouchers', 'D', 'Day Book'], ['reports', 'R', 'Reports'], ['tools', 'T', 'Tools']];
  // [kind, target, key, label, needsBook]
  var BAR_BASE = [['act', 'period', 'F2', 'Period', true], ['act', 'company', 'F3', 'Company', false], ['act', 'clexport', 'E', 'Export', true], ['go', 'more', 'F12', 'Configure', false]];
  var BAR_REPORT = [['act', 'period', 'F2', 'Period', true], ['act', 'company', 'F3', 'Company', false], ['act', 'cldetail', 'Alt+F1', 'Detailed', true], ['act', 'clexport', 'E', 'Export', true], ['go', 'more', 'F12', 'Configure', false]];
  var VTYPES = [['F4', 'Contra'], ['F5', 'Payment'], ['F6', 'Receipt'], ['F7', 'Journal'], ['F8', 'Sales'], ['F9', 'Purchase']];
  function barFor(r) {
    var n = r && r.name;
    if (n === 'report' || n === 'ledger' || n === 'stock') return BAR_REPORT;
    if (n === 'entry' || n === 'invoice') return VTYPES.map(function (v) { return ['go', 'entry?type=' + encodeURIComponent(v[1]), v[0], v[1], true]; }).concat([['act', 'clsave', 'Ctrl+A', 'Save', true]]);
    return BAR_BASE;
  }
  function nav(r, cur) {
    var h = '<div class="r">' + NAVC.map(function (n) { return '<button data-go="' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '><b>' + n[1] + '</b><span>' + n[2] + '</span></button>'; }).join('') + '</div>';
    var curType = '';
    if (r && r.name === 'entry') { var d = S.draft; curType = d && d.type && S.book && S.book.baseType ? S.book.baseType(d.type) : (r.q && r.q.type) || ''; }
    h += '<div class="r">' + barFor(r).map(function (x) {
      var dis = (x[4] && !S.book) || (x[1] === 'company' && !S.companies.length);
      var isOn = !!(r && x[1] === r.name) || (x[0] === 'go' && x[1].indexOf('entry?type=') === 0 && curType === x[3]);
      return '<button data-' + x[0] + '="' + x[1] + '" data-fk="' + x[2] + '"' + (dis ? ' disabled' : '') + (isOn ? ' class="on"' : '') + '><b>' + x[2] + '</b><span>' + x[3] + '</span></button>';
    }).join('') + '</div>';
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
      '<div class="l"><div class="k">Current period</div><div class="v">' + tDate(p.from) + ' to ' + tDate(p.to) + '</div></div>' +
      '<div><div class="k">Current date</div><div class="v">' + DAYS[now.getDay()] + ', ' + now.getDate() + '-' + MON[now.getMonth()] + '-' + now.getFullYear() + '</div></div>' +
      '<button class="co" data-act="company"><div class="k">Name of company</div><div class="v">' + esc(c.name) + '</div></button>' +
      '<div class="l"><div class="k">Books beginning from</div><div class="v">' + (ci.booksFrom ? tDate(ci.booksFrom) : b.minDate ? tDate(b.minDate) : '—') + '</div></div>' +
      '<div><div class="k">Date of last entry</div><div class="v">' + (b.maxDate ? tDate(b.maxDate) : '—') + '</div></div>' +
      '<div class="l"><div class="k">Vouchers</div><div class="v">' + A.pluralize(b.vouchers.length, 'voucher') + '</div></div>' +
      '<div><div class="k">Ledgers</div><div class="v">' + A.pluralize(b.ledgerNames.length, 'ledger') + '</div></div>' +
      '</div>';
    h += '<div class="cl-panel"><div class="cl-panel-title">Gateway of Tally</div>' + MENU.map(function (m) {
      if (m[0] === 'sec') return '<div class="cl-sec">' + m[1] + '</div>';
      return '<button class="cl-item' + (m[3] === 'Quit' ? ' quit' : '') + '" data-' + m[0] + '="' + m[1] + '" data-key="' + m[2].toLowerCase() + '">' + hot(m[3], m[2]) + '</button>';
    }).join('') + '</div></div>';
    A.$view().innerHTML = h;
  }

  /* ---- after every render: hotkeys on menu-like lists, strip state, cursor reset ---- */
  var HOT_SCREENS = { reports: 1, tools: 1, more: 1, companies: 1 };
  function hotkeys(root) {
    var used = {};
    Array.prototype.forEach.call(root.querySelectorAll('.row .t, .tool .t'), function (t) {
      var row = t.closest('.row, .tool');
      if (!row || row.hasAttribute('data-key') || row.classList.contains('static')) return;
      if (!row.matches('button, a, [data-go], [data-act], [data-faction], [data-company], [data-ledger]')) return;
      var hl = hotLabel(t.textContent, used);
      if (!hl.key) return;
      row.setAttribute('data-key', hl.key);
      t.innerHTML = hl.html;
    });
  }
  var SHARE_RE = /^whatsapp$/i, PRINT_RE = /pdf$/i;
  function actionButtons() { return Array.prototype.slice.call(document.querySelectorAll('#view .actions .act, #view [data-export]')); }
  function findAction(re) { var bts = actionButtons(); for (var i = 0; i < bts.length; i++) if (re.test(bts[i].textContent.trim())) return bts[i]; return null; }
  function refreshStrip() {
    var m = document.querySelector('.cl-menu [data-act="clshare"]'), p = document.querySelector('.cl-menu [data-act="clprint"]');
    if (m) m.disabled = !findAction(SHARE_RE);
    if (p) p.disabled = !findAction(PRINT_RE);
  }
  function after(r) {
    document.documentElement.setAttribute('data-screen', r.name);
    cursor = null;
    if (!on()) return;
    if (HOT_SCREENS[r.name]) hotkeys(A.$view());
    refreshStrip();
  }

  /* ---- G: Go To ------------------------------------------------------------- */
  function gotoSheet() {
    var dests = [];
    A.REPORTS.forEach(function (r) { dests.push({ t: r[1], s: 'Report · ' + r[2], h: '#/report/' + r[0] }); });
    [['Gateway of Tally', 'home'], ['Chart of Accounts', 'ledgers'], ['Day Book', 'vouchers'], ['Display More Reports', 'reports'], ['Tools', 'tools'], ['Companies', 'companies'], ['Import Tally data', 'import'], ['Sync over Wi-Fi', 'sync'], ['Entries made in app', 'pending'], ['Company GST details', 'gst'], ['Configure', 'more'], ['Help', 'help']]
      .forEach(function (x) { dests.push({ t: x[0], s: 'Screen', h: '#/' + x[1] }); });
    var b = S.book;
    var bg = A.sheet('<h3>Go To</h3><input type="search" id="cl-goto" placeholder="Report, screen or ledger name" aria-label="Go to" autocomplete="off"><div class="list" id="cl-goto-list" style="margin-top:8px"></div>', function (ev, bg) {
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

  /* ---- Y: Data (backup, restore, import, sync) -------------------------------- */
  // features.js listens for [data-faction] clicks on the document; fire one from a throwaway element so
  // the same handler (and its user-gesture) runs as if the More screen's row had been tapped
  function faction(key) { var b = document.createElement('button'); b.type = 'button'; b.className = 'hidden'; b.setAttribute('data-faction', key); document.body.appendChild(b); b.click(); b.remove(); }
  function dataSheet() {
    var used = {}, items = [
      S.book ? ['backup', 'Backup this company', 'Everything incl. entries made here, as a file'] : null,
      ['restore', 'Restore from backup', 'Load a Tally Viewer backup file'],
      ['import', 'Import Tally data', 'Data folder, ZIP or XML exports'],
      ['sync', 'Sync from Tally over Wi-Fi', 'Pull masters and vouchers from TallyPrime']
    ].filter(Boolean);
    A.sheet('<h3>Data</h3>' + items.map(function (it) { var hl = hotLabel(it[1], used); return '<button class="opt" data-d="' + it[0] + '"' + (hl.key ? ' data-key="' + hl.key + '"' : '') + '>' + hl.html + ' <span class="faint small">' + esc(it[2]) + '</span></button>'; }).join(''), function (ev, bg) {
      var o = ev.target.closest('[data-d]'); if (!o) return;
      var d = o.getAttribute('data-d'); bg.remove();
      if (d === 'import') go('#/import');
      else if (d === 'sync') go('#/sync');
      else if (d === 'backup') faction('backup');
      else if (d === 'restore') {
        // the restore handler reads #restore-file (normally rendered by the More screen); provide one here
        if (!document.getElementById('restore-file')) { var inp = document.createElement('input'); inp.type = 'file'; inp.id = 'restore-file'; inp.className = 'hidden'; inp.accept = '.json,application/json'; inp.setAttribute('aria-label', 'Restore backup file'); document.body.appendChild(inp); }
        faction('restore');
      }
    });
  }

  /* ---- E: Export (export-like actions of the current screen) ------------------- */
  var EXPORT_RE = /^(Excel|PDF|WhatsApp|Tally XML|Invoice PDF|Credit note PDF|E-invoice JSON|Confirmation)$/i;
  function exportSheet() {
    var btns = actionButtons().filter(function (bt) { return bt.hasAttribute('data-export') || EXPORT_RE.test(bt.textContent.trim()); });
    if (!btns.length) { A.toast('Nothing to export here. Open a ledger, the ledger list, a voucher or a report.', 3200); return; }
    var used = {};
    A.sheet('<h3>Export</h3>' + btns.map(function (bt, i) {
      var hl = hotLabel(bt.textContent, used);
      return '<button class="opt" data-i="' + i + '"' + (hl.key ? ' data-key="' + hl.key + '"' : '') + '>' + hl.html + '</button>';
    }).join(''), function (ev, bg) {
      var o = ev.target.closest('.opt'); if (!o) return; bg.remove(); btns[parseInt(o.getAttribute('data-i'), 10)].click();
    });
  }
  // M: Share / P: Print click the current screen's WhatsApp / PDF action
  function clickAction(re, what) {
    var bt = findAction(re);
    if (bt) bt.click(); else A.toast('Nothing to ' + what + ' on this screen · open a ledger, a voucher or a report', 3200);
  }
  // Alt+F1: Detailed / Condensed toggles every group tree on the screen
  function toggleDetailed() {
    var ds = Array.prototype.slice.call(document.querySelectorAll('#view details.grp'));
    if (!ds.length) { A.toast('No groups to expand on this screen', 2200); return; }
    var expand = ds.some(function (d) { return !d.open; });
    ds.forEach(function (d) { d.open = expand; });
    var sp = document.querySelector('#nav [data-fk="Alt+F1"] span'); if (sp) sp.textContent = expand ? 'Condensed' : 'Detailed';
  }
  // Ctrl+A: accept (save) the voucher or invoice being entered
  function saveEntry() { var b = document.getElementById('en-save') || document.getElementById('iv-save'); if (b && !b.disabled) b.click(); }

  /* ---- arrow-key cursor (Tally's yellow bar) ---------------------------------- */
  var cursor = null;
  var CURSOR_SEL = '.row, .cl-item, details.grp > summary, .tool, tr[data-voucher]';
  var SHEET_SEL = '.opt, .row, [data-h]';
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function cursorItems() {
    var open = topSheet(), root = open || A.$view(), sel = open ? SHEET_SEL : CURSOR_SEL;
    return Array.prototype.filter.call(root.querySelectorAll(sel), function (el) { return visible(el) && !el.disabled && !el.classList.contains('static'); });
  }
  function setCursor(el) {
    if (cursor && cursor !== el) cursor.classList.remove('cur');
    cursor = el || null;
    if (!cursor) return;
    cursor.classList.add('cur');
    try { cursor.scrollIntoView({ block: 'nearest' }); } catch (e) { cursor.scrollIntoView(); }
    if (/^(BUTTON|A|SUMMARY)$/.test(cursor.tagName) || cursor.tabIndex >= 0) { try { cursor.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
  }
  function moveCursor(step, edge) {
    var items = cursorItems(); if (!items.length) return;
    var i = cursor ? items.indexOf(cursor) : -1;
    if (edge === 'home') i = 0;
    else if (edge === 'end') i = items.length - 1;
    else if (i === -1) i = step > 0 ? 0 : items.length - 1;
    else i = Math.max(0, Math.min(items.length - 1, i + step));
    setCursor(items[i]);
  }

  /* ---- events ---------------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act="ui"],[data-act="goto"],[data-act="clexport"],[data-act="cldata"],[data-act="clshare"],[data-act="clprint"],[data-act="cldetail"],[data-act="clsave"]');
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    if (act === 'ui') toggle();
    else if (act === 'goto') gotoSheet();
    else if (act === 'clexport') exportSheet();
    else if (act === 'cldata') dataSheet();
    else if (act === 'clshare') clickAction(SHARE_RE, 'share');
    else if (act === 'clprint') clickAction(PRINT_RE, 'print');
    else if (act === 'cldetail') toggleDetailed();
    else if (act === 'clsave') saveEntry();
  });
  // Tally-style keyboard (hardware keyboards and desktop): Alt+letter = menu strip, plain letters = hotkeys on the
  // screen then the button bar, F-keys = button bar, Up/Down/Home/End/Enter = cursor, Esc = back
  document.addEventListener('keydown', function (ev) {
    if (!on() || ev.metaKey || document.body.classList.contains('locked')) return;
    var typing = isTyping(ev.target), tag = (ev.target && ev.target.tagName || '').toLowerCase();
    var open = topSheet(), k = ev.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      if (ev.altKey || ev.ctrlKey) return;
      // from a sheet's search box the arrows move into its results; everywhere else leave fields alone
      // (date and number fields keep their own Up/Down stepping)
      if (typing && !(open && tag === 'input' && /^(search|text)$/.test(ev.target.type) && (k === 'ArrowDown' || k === 'ArrowUp'))) return;
      ev.preventDefault();
      moveCursor(k === 'ArrowDown' ? 1 : -1, k === 'Home' ? 'home' : k === 'End' ? 'end' : '');
      return;
    }
    if (k === 'Enter') { if (cursor && !typing && document.contains(cursor) && document.activeElement !== cursor) { ev.preventDefault(); cursor.click(); } return; }
    if (k === 'Escape') { if (open) return; /* app.js closes the sheet */ if (!typing && S.route && S.route.name !== 'home') { ev.preventDefault(); if (history.length > 1) history.back(); else go('#/home'); } return; }
    var lk = k.length === 1 ? k.toLowerCase() : '';
    if (ev.altKey && /^Key[A-Z]$/.test(ev.code || '')) lk = ev.code.slice(3).toLowerCase();
    if (ev.ctrlKey) { if (lk === 'a' && !ev.altKey && isEntryScreen() && tag !== 'textarea' && !open) { ev.preventDefault(); saveEntry(); } return; }
    if (k === 'F1') { ev.preventDefault(); if (ev.altKey) { if (!open) toggleDetailed(); } else go('#/help'); return; }
    if (/^F([2-9]|1[0-2])$/.test(k)) {
      if (open) return;
      var bt = document.querySelector('#nav [data-fk="' + k + '"]');
      if (bt) { ev.preventDefault(); if (!bt.disabled) bt.click(); }
      return;
    }
    if (!/^[a-z0-9]$/.test(lk)) return; // hotkeys are letters and digits; a quote or backslash would be an invalid selector below
    if (ev.altKey) { var mi = document.querySelector('.cl-menu [data-menu="' + lk + '"]'); if (mi) { ev.preventDefault(); if (!mi.disabled) mi.click(); } return; }
    if (open) { if (!typing) { var so = open.querySelector('[data-key="' + lk + '"]'); if (so) { ev.preventDefault(); so.click(); } } return; }
    if (typing) return;
    var item = document.querySelector('#view [data-key="' + lk + '"]');
    if (item) { ev.preventDefault(); item.click(); return; }
    var n = { g: 'home', l: 'ledgers', d: 'vouchers', r: 'reports', t: 'tools' }[lk];
    if (n) { ev.preventDefault(); go('#/' + n); }
  });

  apply();
  window.TVClassic = { on: on, apply: apply, toggle: toggle, topbar: topbar, nav: nav, gateway: gateway, after: after, gotoSheet: gotoSheet, exportSheet: exportSheet, dataSheet: dataSheet, tDate: tDate };
})();
