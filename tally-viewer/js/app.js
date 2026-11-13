/* Tally Viewer – UI, routing, import. Depends on tallyparse.js (via worker), model.js, db.js */
(function () {
  'use strict';
  var Book = TVModel.Book;
  var S = { companies: [], company: null, book: null, period: null, route: null, jobs: [], loading: false, draft: null, inv: null };
  var $view, $top, $nav, worker = null;
  var VERSION = window.TV_VERSION || '1.9.0';

  /* ---- helpers ------------------------------------------------------------ */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var NF2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var NF0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var NFQ = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
  function fmt(n) { return NF2.format(Math.abs(n) < 0.005 ? 0 : n); }
  function fmtQ(n) { return NFQ.format(n); }
  function compact(n) {
    var a = Math.abs(n), s;
    if (a >= 1e7) s = (a / 1e7).toFixed(2) + ' Cr';
    else if (a >= 1e5) s = (a / 1e5).toFixed(2) + ' L';
    else s = NF0.format(a);
    return (n < 0 ? '-' : '') + '₹' + s;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // classic Tally look active? (classic.js loads after app.js, so check at call time)
  function isClassic() { return !!(window.TVClassic && TVClassic.on()); }
  function fmtDate(d) { if (!d) return ''; if (isClassic()) return TVClassic.tDate(d); var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + ' ' + (MON[m - 1] || m) + ' ' + String(y).slice(2); }
  function fmtDateLong(d) { if (!d) return ''; if (isClassic()) return TVClassic.tDate(d); var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + ' ' + (MON[m - 1] || m) + ' ' + y; }
  function fmtMonth(mk) { return (MON[(mk % 100) - 1] || '') + ' ' + String(Math.floor(mk / 100)).slice(2); }
  // "1 Apr 25 – 31 Mar 26" in the modern look, "1-Apr-25 to 31-Mar-26" in classic
  function dateRange(from, to) { return fmtDate(from) + (isClassic() ? ' to ' : ' – ') + fmtDate(to); }
  // ₹ only in the modern look; Tally never prints a currency symbol
  function cur(n) { return (isClassic() ? '' : '₹') + fmt(n); }
  function fmtStamp(ms) { var d = new Date(ms); return fmtDateLong(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function toISO(d) { return Math.floor(d / 10000) + '-' + String(Math.floor(d / 100) % 100).padStart(2, '0') + '-' + String(d % 100).padStart(2, '0'); }
  function fromISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? parseInt(m[1] + m[2] + m[3], 10) : 0; }
  // yyyymm → yyyymmdd of the last day of that month
  function monthEnd(mk) { var y = Math.floor(mk / 100), m = mk % 100; return mk * 100 + new Date(y, m, 0).getDate(); }
  // clamp a yyyymmdd whose day overruns the month (31 Nov → 30 Nov)
  function clampDate(d) { if (!d) return d; var mk = Math.floor(d / 100), last = monthEnd(mk) % 100, dd = d % 100; return dd > last ? mk * 100 + last : dd < 1 ? mk * 100 + 1 : d; }
  // signed balance → "1,00,000.00 Dr". Neutral by default; `led` (a Book ledger with .nature) marks
  // abnormal balances (asset in credit, liability in debit) with .abn. cls === false → never .abn.
  function bal(n, cls, led) {
    if (Math.abs(n) < 0.005) return '<span class="num faint">0.00</span>';
    var abn = cls !== false && led && ((led.nature === 'A' && n > 0) || (led.nature === 'L' && n < 0));
    return '<span class="num' + (abn ? ' abn' : '') + '">' + fmt(Math.abs(n)) + ' <span class="drcr">' + (n < 0 ? 'Dr' : 'Cr') + '</span></span>';
  }
  function money(n) { return '<span class="num">' + fmt(n) + '</span>'; }
  // polite live region for screen readers (cleared first so a repeated message is re-announced)
  function announce(text) {
    var l = document.getElementById('live');
    if (!l) { l = document.createElement('div'); l.id = 'live'; l.className = 'sr-only'; l.setAttribute('role', 'status'); l.setAttribute('aria-live', 'polite'); l.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap'; document.body.appendChild(l); }
    l.textContent = '';
    setTimeout(function () { l.textContent = String(text == null ? '' : text); }, 40);
  }
  // single reusable toast host; ms === 0 keeps it until dismissed; opts.action = { label, fn } adds a button
  var toastTimer = 0;
  function hideToast() { clearTimeout(toastTimer); toastTimer = 0; var t = document.getElementById('toast'); if (t) t.remove(); }
  function toast(msg, ms, opts) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.classList.remove('show'); t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    t.textContent = '';
    var span = document.createElement('span'); span.className = 'msg'; span.textContent = msg; t.appendChild(span);
    if (opts && opts.action) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'act'; b.textContent = opts.action.label;
      b.onclick = function (ev) { ev.stopPropagation(); hideToast(); if (typeof opts.action.fn === 'function') opts.action.fn(); };
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = ms === 0 ? 0 : setTimeout(hideToast, ms || 2600);
    announce(msg);
    return t;
  }
  function go(hash) { location.hash = hash; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pluralize(n, w) { return (typeof n === 'number' ? NF0.format(n) : n) + ' ' + (n === 1 ? w : (/y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's')); }
  function emptyState(iconKey, title, hint, ctaHtml) { return '<div class="empty"><div class="big">' + (ICONS[iconKey] || '') + '</div><p><b>' + esc(title) + '</b></p>' + (hint ? '<p class="small">' + esc(hint) + '</p>' : '') + (ctaHtml || '') + '</div>'; }
  var FOLDER_HINT = 'Copy your company folder, e.g. 100000, from C:\\Users\\Public\\TallyPrime\\data to this phone, then Open Tally data folder.';
  // was this company loaded from a TallyPrime data folder (as opposed to XML / Wi-Fi sync)?
  function fromFolder(b) { return !!(b && b.data && (b.data.snapshotAt || (b.data.files || []).some(function (f) { return f.source === 'tally-folder' || /\.1800\b|tally folder/i.test(f.name || ''); }))); }
  // incremental "Show 300 more" paging: appends the next slice of pre-built row strings
  var PAGE = 300;
  function moreBtn(id, rows, page) { page = page || PAGE; return rows.length > page ? '<button class="btn block" id="' + id + '">Show ' + Math.min(page, rows.length - page) + ' more</button>' : ''; }
  function pageMore(btnId, listId, rows, page) {
    page = page || PAGE;
    var more = document.getElementById(btnId); if (!more) return;
    var shown = page;
    more.onclick = function () {
      var next = rows.slice(shown, shown + page), list = document.getElementById(listId);
      if (list) list.insertAdjacentHTML('beforeend', next.join(''));
      shown += next.length;
      var left = rows.length - shown;
      if (left > 0) more.textContent = 'Show ' + Math.min(page, left) + ' more'; else more.remove();
    };
  }

  /* ---- state -------------------------------------------------------------- */
  function loadCompanies() { return TVDB.listCompanies().then(function (list) { S.companies = list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); return list; }); }

  var curCompanyId = null;
  function selectCompany(id) {
    if (S.company && S.company.id === id && S.book) return Promise.resolve(S.book);
    var c = null;
    for (var i = 0; i < S.companies.length; i++) if (S.companies[i].id === id) c = S.companies[i];
    if (!c) { S.company = null; S.book = null; return Promise.resolve(null); }
    if (curCompanyId && curCompanyId !== id) { S.draft = null; S.inv = null; }
    S.loading = true;
    return TVDB.getData(id).then(function (data) {
      S.company = c; S.book = new Book(data || TVModel.emptyData(id));
      curCompanyId = id;
      lsSet('tv.company', id);
      S.period = defaultPeriod(S.book, lsGet('tv.period.' + id, null));
      S.loading = false;
      return S.book;
    });
  }
  function defaultPeriod(book, saved) {
    if (saved && saved.from && saved.to) {
      var p = { from: clampDate(saved.from), to: clampDate(saved.to), label: saved.label || '' };
      if ((p.from !== saved.from || p.to !== saved.to) && /\d/.test(p.label)) p.label = dateRange(p.from, p.to);
      if (p.from <= p.to) return p;
    }
    var fys = book.periods();
    if (fys.length) return fys[0];
    return { from: book.minDate || 20000401, to: book.maxDate || 20991231, label: 'All data' };
  }
  function setPeriod(p) { S.period = p; if (S.company) lsSet('tv.period.' + S.company.id, p); render(); }

  /* ---- routing ------------------------------------------------------------ */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {}, qi = h.indexOf('?');
    if (qi !== -1) { h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, qi); }
    var parts = h.split('/');
    return { name: parts[0] || 'home', arg: parts.length > 1 ? decodeURIComponent(parts.slice(1).join('/')) : '', q: q };
  }
  var NEEDS_BOOK = { home: 1, ledgers: 1, ledger: 1, vouchers: 1, voucher: 1, reports: 1, report: 1, stock: 1 };

  function skeleton() {
    var h = '<div class="skeleton" style="height:150px;border-radius:22px;margin-bottom:12px"></div>';
    for (var i = 0; i < 6; i++) h += '<div class="skeleton" style="height:62px;border-radius:14px;margin-bottom:8px"></div>';
    return h;
  }
  // move focus to the screen title and name the document after it (screen readers learn where they are)
  function focusTitle() {
    var hd = $top.querySelector('h1, .ttl');
    var tt = hd ? (hd.querySelector('.tt') || hd) : null, text = tt ? tt.textContent.replace(/\s+/g, ' ').trim() : '';
    document.title = (text ? text + ' · ' : '') + 'Tally Viewer';
    if (!hd) return;
    hd.setAttribute('tabindex', '-1');
    try { hd.focus({ preventScroll: true }); } catch (e) { try { hd.focus(); } catch (e2) { /* ignore */ } }
  }
  function render() {
    var r = parseHash(); S.route = r;
    closeSheets();
    if (NEEDS_BOOK[r.name] && !S.book) {
      if (!S.companies.length) { r = S.route = { name: 'companies', arg: '', q: {} }; }
      else { var id = lsGet('tv.company', S.companies[0].id); $view.innerHTML = skeleton(); selectCompany(id).then(function (b) { if (!b) return selectCompany(S.companies[0].id); }).then(render); return; }
    }
    var fn = SCREENS[r.name] || SCREENS.home;
    window.scrollTo(0, 0);
    $view.classList.remove('in');
    fn(r);
    if (window.TVClassic) TVClassic.after(r);
    void $view.offsetWidth; $view.classList.add('in');
    renderNav(r);
    focusTitle();
  }

  function iconChip(key, attrs) { return '<button class="chip icon" ' + attrs + '>' + ICONS[key] + '</button>'; }
  function gearChip() { return iconChip('gear', 'data-go="more" aria-label="More" title="More"'); }
  function topbar(opts) {
    if (isClassic()) { TVClassic.topbar(opts); return; }
    var h = '<div class="topbar-row">';
    if (opts.back) h += '<button class="back" data-act="back" aria-label="Back">‹</button>';
    h += '<div class="title' + (opts.look ? ' two' : '') + '"' + (opts.titleAct ? ' data-act="' + opts.titleAct + '" role="button" tabindex="0" aria-label="' + esc(opts.title) + ' – switch company"' : '') + '><h1><span class="tt">' + esc(opts.title) + '</span>' + (opts.titleAct ? '<span class="caret">▾</span>' : '') + '</h1>' + (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>';
    if (opts.look) h += '<button class="chip ui-toggle" data-act="ui" aria-label="Classic Tally look" title="Classic Tally look">' + UI_ICON + '</button>';
    if (opts.period !== false && S.book) h += '<button class="chip" data-act="period" aria-label="Period: ' + esc(S.period.label) + '">' + esc(S.period.label) + '</button>';
    if (opts.right) h += opts.right;
    h += '</div>' + (opts.extra || '');
    $top.innerHTML = h;
  }
  var UI_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h6M7 16h4"/></svg>';
  // new icons carry presentation attributes so they render sized and stroked even before CSS targets them
  var SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    profit: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    sales: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
    purchase: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
    receivable: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8h5M19.5 5.5v5"/></svg>',
    payable: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8h5"/></svg>',
    cash: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8"/><path d="M3 20h18"/></svg>',
    expense: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 7l1.5 12h9L18 7"/><path d="M10 11v4M14 11v4"/></svg>',
    vouchers: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    entry: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    ledger: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    report: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    export: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    folder: SVG + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    sync: SVG + '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>',
    gear: SVG + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus: SVG + '<path d="M12 5v14M5 12h14"/></svg>',
    info: SVG + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    lock: SVG + '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    check: SVG + '<path d="M5 12l5 5L20 7"/></svg>',
    close: SVG + '<path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  // an icon sized inline (for places no stylesheet rule covers, e.g. file-drop zones)
  function svgIcon(key, px) { return (ICONS[key] || '').replace('<svg ', '<svg style="width:' + px + 'px;height:' + px + 'px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" '); }
  var NAV = [
    ['home', 'Home', '<svg viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg>'],
    ['ledgers', 'Ledgers', '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5"/></svg>'],
    ['vouchers', 'Day Book', '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6"/></svg>'],
    ['reports', 'Reports', '<svg viewBox="0 0 24 24"><path d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2"/></svg>'],
    ['tools', 'Tools', '<svg viewBox="0 0 24 24"><path d="M14.5 5.5a3.5 3.5 0 0 0 4 4L21 7l-2-2-2.5 2.5"/><path d="M14 10 4 20l-1-1 10-10"/><path d="M8 5l3 3M5 8l3 3"/></svg>']
  ];
  function renderNav(r) {
    var cur = r.name === 'ledger' ? 'ledgers' : (r.name === 'voucher' || r.name === 'entry' || r.name === 'invoice') ? 'vouchers' : (r.name === 'report' || r.name === 'stock') ? 'reports' : r.name === 'tool' ? 'tools' : r.name;
    if (isClassic()) { TVClassic.nav(r, cur); return; }
    $nav.innerHTML = NAV.map(function (n) { return '<button data-go="' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + n[2] + '<span>' + n[1] + '</span></button>'; }).join('');
  }

  /* ---- screens ------------------------------------------------------------ */
  var SCREENS = {};

  SCREENS.companies = function () {
    topbar({ title: 'Companies', period: false });
    var h = '';
    if (!S.companies.length) {
      h += emptyState('folder', 'No company data yet', FOLDER_HINT + ' TallyPrime XML exports also work. Everything stays on this device.', '');
    } else {
      h += '<div class="list">' + S.companies.map(function (c) {
        return '<button class="row" data-company="' + esc(c.id) + '"><span class="avatar">' + esc(c.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase() || '#') + '</span><div class="main"><div class="t">' + esc(c.name) + '</div><div class="s">' +
          pluralize(c.counts ? c.counts.vouchers : 0, 'voucher') + ' · ' + pluralize(c.counts ? c.counts.ledgers : 0, 'ledger') +
          (c.minDate ? ' · ' + dateRange(c.minDate, c.maxDate) : '') + '</div></div>' +
          (S.company && S.company.id === c.id ? '<span class="badge">Open</span>' : '') + '<span class="chev">›</span></button>';
      }).join('') + '</div>';
    }
    h += '<div class="btn-row"><button class="btn primary block" data-go="import">' + ICONS.folder + ' Open Tally data folder / files</button></div>';
    h += '<div class="btn-row"><button class="btn block" data-go="sync">' + ICONS.sync + ' Sync from Tally over Wi-Fi</button></div>';
    h += '<div class="btn-row"><button class="btn block" data-go="help">Setup guide</button></div>';
    h += '<p class="small muted" style="text-align:center;margin-top:14px">The <a href="#/tools">Tools</a> tab (GSTIN, PAN, IFSC checks, GST/TDS/EMI calculators, compliance calendar) works without any company loaded.</p>';
    $view.innerHTML = h;
  };

  SCREENS.help = function () {
    topbar({ title: 'Setup guide', back: true, period: false });
    $view.innerHTML =
      '<div class="card"><h2>Option A · Open the Tally data folder (no export)</h2><ol class="steps">' +
      '<li>On the PC, open TallyPrime\'s data directory (shown under F1 → Settings → Data path; usually <b>C:\\Users\\Public\\TallyPrime\\data</b>). Each company is a numbered folder such as <b>100000</b>.</li>' +
      '<li>Copy that company folder to the phone, or ZIP it and send it over WhatsApp or Drive. Only Manager.1800, TranMgr.1800 and Company.1800 are read.</li>' +
      '<li>In the app tap <b>Open Tally data folder</b> and pick either one company folder or the whole Data folder: every company inside is loaded. Or pick the three files, or a ZIP. Company names are read from the data.</li></ol>' +
      '<p class="small muted">Works with TallyPrime Release 3 and later (.1800 data files). Deleted vouchers are skipped; stock movements are read where present. Copying the folder is safe: the app never writes to it. Opening the folder again replaces the company\'s Tally data with the fresh copy (entries made in this app are kept).</p></div>' +
      '<div class="card"><h2>Option B · Sync over Wi-Fi (Android app)</h2><ol class="steps">' +
      '<li>In TallyPrime press <kbd>F1</kbd> (Help) → <b>Settings</b> → <b>Connectivity</b> → <b>Client/Server configuration</b>. Set <b>TallyPrime acts as</b> to <b>Both</b> (or Server), <b>Enable ODBC server</b> Yes, port <b>9000</b>. Restart Tally if asked.</li>' +
      '<li>Allow it through Windows Firewall: Start → "Allow an app through Windows Firewall" → tick TallyPrime for Private networks. If Tally is not listed, add an inbound rule for TCP port 9000.</li>' +
      '<li>Find the PC\'s address: Start → type <kbd>cmd</kbd> → run <kbd>ipconfig</kbd> and note the IPv4 Address (e.g. 192.168.1.10).</li>' +
      '<li>Open the companies you want in Tally. On the phone (same Wi-Fi) open <b>Sync from Tally</b>, enter the address, Connect, pick companies and period, Sync.</li></ol>' +
      '<p class="small muted">Nothing is installed on the PC. The phone sends Tally the same export requests the Export menu uses and reads the replies.</p></div>' +
      '<div class="section-title">Option C · XML files</div>' +
      '<div class="card"><h2>1. Masters (ledgers, groups, items)</h2><ol class="steps">' +
      '<li>Open the company in TallyPrime and go to the Gateway of Tally.</li>' +
      '<li>Press <kbd>Alt</kbd>+<kbd>E</kbd> (Export) and choose <b>Masters</b>.</li>' +
      '<li>Press <kbd>C</kbd> (Configure): File Format <b>XML</b>, Type of Masters <b>All Masters</b>.</li>' +
      '<li>Press <kbd>E</kbd> (Send / Export). Note the folder shown as the export location. The file is usually <b>Master.xml</b>.</li></ol></div>' +
      '<div class="card"><h2>2. Transactions (vouchers)</h2><ol class="steps">' +
      '<li>Press <kbd>Alt</kbd>+<kbd>E</kbd> again and choose <b>Transactions</b>.</li>' +
      '<li>Configure: File Format <b>XML</b>, set the period (a full financial year is fine), Type of Transactions <b>All Vouchers</b>.</li>' +
      '<li>Export. The file is usually <b>Daybook.xml</b>. One file per company per year keeps sizes manageable.</li></ol>' +
      '<p class="small muted">Older TallyPrime builds: Day Book → <kbd>Alt</kbd>+<kbd>E</kbd> → XML, and Chart of Accounts → <kbd>Alt</kbd>+<kbd>E</kbd> → XML.</p></div>' +
      '<div class="card"><h2>3. Copy to phone and import</h2><ol class="steps">' +
      '<li>Send both files to the phone (WhatsApp, Google Drive, email, USB cable). On Android you can also share an XML file straight to Tally Viewer.</li>' +
      '<li>In this app tap <b>Open Tally data folder / files</b>, pick the XML files (both at once is fine) and save.</li>' +
      '<li>Re-export and re-import any time. Vouchers are matched by their Tally GUID, so importing the same period again updates rather than duplicates.</li></ol>' +
      '<p class="small muted">Prefer one click? The repository ships <b>tools/tally-export.cmd</b> for the PC: double-click it while Tally is open and it writes Master and Daybook XML for every open company into a folder.</p></div>' +
      '<div class="card"><h2>Notes</h2><p class="small muted">A TallyPrime backup (TBK file) cannot be read by any outside app; copy the live data folder or export XML instead. Reports here are computed from the ledgers and vouchers you load; profit figures are shown before stock valuation, so they may differ from Tally where closing stock is material.</p></div>';
  };

  /* ---- import ------------------------------------------------------------- */
  SCREENS.import = function () {
    topbar({ title: 'Load Tally data', back: true, period: false });
    var opts = '<option value="auto">Auto-detect from file (recommended)</option><option value="new">Create new company…</option>' +
      S.companies.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    var h = '<div class="card"><h2>Tally company data folder</h2>' +
      (hasBridge() && typeof window.TallyBridge.pickFolder === 'function' ? '<button class="btn primary block" id="imp-folder">' + ICONS.folder + ' Open Tally data folder</button><p class="small muted" style="margin-top:8px">Pick the company folder (e.g. <b>100000</b>) from Tally\'s Data directory copied to this phone.</p>' : '') +
      '<label class="file-drop" style="margin-top:10px"><input type="file" id="imp-tally" multiple aria-label="Choose Tally data files"><div>' + svgIcon('folder', 30) + '</div><div><b>Choose Manager.1800, TranMgr.1800, Company.1800</b></div><div class="small">or a ZIP of one or more company folders</div></label>' +
      (hasBridge() ? '' : '<label class="file-drop"><input type="file" id="imp-tallydir" webkitdirectory multiple aria-label="Choose a Tally data folder"><div><b>Choose a folder</b></div><div class="small">a company folder, or the whole Tally Data folder</div></label>') +
      '<p class="small muted">Reads TallyPrime\'s own data files directly. No export needed. Opening a folder again refreshes the company from it.</p></div>' +
      '<div class="card"><h2>Tally XML export</h2><div class="field"><label for="imp-target">Import into</label><select id="imp-target">' + opts + '</select></div>' +
      '<div class="field hidden" id="imp-newname-wrap"><label for="imp-newname">New company name</label><input id="imp-newname" placeholder="Company name"></div>' +
      '<label class="file-drop"><input type="file" id="imp-files" multiple aria-label="Choose XML files"><div>' + svgIcon('vouchers', 30) + '</div><div><b>Choose XML file(s)</b></div><div class="small">Master.xml, Daybook.xml or any TallyPrime XML export</div></label></div>' +
      '<div id="imp-jobs"></div>' +
      '<div class="btn-row"><button class="btn primary block hidden" id="imp-save">Save to company</button></div>' +
      '<p class="small muted">Everything is read on this phone and never uploaded anywhere.</p>' +
      '<div class="btn-row"><button class="btn block" data-go="sync">Or sync directly from Tally over Wi-Fi</button></div>';
    $view.innerHTML = h;
    S.jobs = [];
    document.getElementById('imp-target').onchange = function () { document.getElementById('imp-newname-wrap').classList.toggle('hidden', this.value !== 'new'); };
    document.getElementById('imp-files').onchange = function () { queueFiles(this.files); };
    document.getElementById('imp-tally').onchange = function () { queueTallyFiles(this.files); };
    var dirInput = document.getElementById('imp-tallydir'); if (dirInput) dirInput.onchange = function () { queueTallyFiles(this.files); };
    var fb = document.getElementById('imp-folder'); if (fb) fb.onclick = pickTallyFolder;
    document.getElementById('imp-save').onclick = saveJobs;
    if (pendingOpen.length) drainPendingOpen();
  };

  /* ---- parsing in the worker --------------------------------------------- */
  var pendingParse = {};
  // a dead worker (importScripts failure, OOM) must not leave jobs at "Parsing…" forever:
  // reject everything pending, drop the worker and let the next call create a fresh one
  function workerFailed(msg) {
    var err = new Error(msg || 'Parser crashed'), pend = pendingParse; pendingParse = {};
    Object.keys(pend).forEach(function (k) { try { pend[k].reject(err); } catch (e) { /* ignore */ } });
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('js/parser.worker.js');
    worker.onmessage = function (ev) {
      var m = ev.data, p = pendingParse[m.id];
      if (!p) return;
      if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.pos / Math.max(1, m.total)); }
      else if (m.type === 'done') { delete pendingParse[m.id]; p.resolve(m.result); }
      else if (m.type === 'error') { delete pendingParse[m.id]; p.reject(new Error(m.error)); }
    };
    worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); workerFailed('Parser error: ' + (e && e.message ? e.message : 'the parser stopped unexpectedly')); };
    worker.onmessageerror = function () { workerFailed('Parser error: could not read the parser\'s reply'); };
    return worker;
  }
  function parseInWorker(buffer, onProgress) {
    return new Promise(function (resolve, reject) {
      var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      pendingParse[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
      getWorker().postMessage({ id: id, buffer: buffer }, [buffer]);
    });
  }
  // folder: { 'Manager.1800': ArrayBuffer, ... } → decoded result
  function decodeFolderInWorker(folder, onProgress) {
    return new Promise(function (resolve, reject) {
      var id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      pendingParse[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
      var transfer = Object.keys(folder).map(function (k) { return folder[k]; });
      getWorker().postMessage({ id: id, folder: folder }, transfer);
    });
  }
  var TALLY_FILES = ['manager.1800', 'tranmgr.1800', 'company.1800'];
  function isTallyFile(name) { return /\.1800$/i.test(name); }
  // Minimal ZIP reader (stored + deflate via DecompressionStream) for a zipped company folder.
  // Returns { folderKey: { fileName: ArrayBuffer } } grouped by the directory inside the ZIP.
  function unzipTallyFiles(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), out = {}, jobs = [];
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 5 && u8[i + 3] === 6) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error('Not a ZIP file'));
    var count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true), o = cd;
    for (var n = 0; n < count && o + 46 <= u8.length; n++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break;
      var method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
      var nlen = dv.getUint16(o + 28, true), elen = dv.getUint16(o + 30, true), clen = dv.getUint16(o + 32, true), lho = dv.getUint32(o + 42, true);
      var name = new TextDecoder().decode(u8.subarray(o + 46, o + 46 + nlen)); o += 46 + nlen + elen + clen;
      var parts = name.split('/'), base = parts.pop(), dir = parts.join('/');
      if (TALLY_FILES.indexOf(base.toLowerCase()) === -1) continue;
      var lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true), start = lho + 30 + lnlen + lelen;
      var data = u8.subarray(start, start + csize);
      var folder = out[dir] || (out[dir] = {});
      if (method === 0) folder[base] = data.slice().buffer;
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        jobs.push((function (folder, base, data) {
          return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (ab) { folder[base] = ab; });
        })(folder, base, data));
      } else return Promise.reject(new Error('ZIP entry ' + base + ' uses an unsupported compression'));
    }
    return Promise.all(jobs).then(function () { return out; });
  }
  function describeResult(r) {
    return [r.vouchers.length && pluralize(r.vouchers.length, 'voucher'), r.ledgers.length && pluralize(r.ledgers.length, 'ledger'), r.groups.length && pluralize(r.groups.length, 'group'), r.stockItems.length && pluralize(r.stockItems.length, 'stock item')].filter(Boolean).join(', ');
  }

  /* ---- storing parsed results into companies ---------------------------- */
  function findCompanyByName(name) {
    var n = (name || '').trim().toLowerCase();
    return S.companies.filter(function (c) { return c.name.toLowerCase() === n; })[0] || null;
  }
  var lastMatched = 0; // app entries matched to Tally vouchers by the last storeResults()
  function matchedText() { return lastMatched ? ' · ' + lastMatched + ' app ' + (lastMatched === 1 ? 'entry' : 'entries') + ' matched to Tally' : ''; }
  // groups: [{ id: existing company id or null, name, items: [{ result, meta }] }] → Promise<last company id>
  function storeResults(groups) {
    var lastId = null, chain = Promise.resolve();
    lastMatched = 0;
    groups.forEach(function (g) {
      chain = chain.then(function () {
        var company = g.id ? S.companies.filter(function (c) { return c.id === g.id; })[0] : null, created = false;
        if (!company) { company = { id: uid(), name: g.name, createdAt: Date.now() }; created = true; }
        return (created ? Promise.resolve(null) : TVDB.getData(company.id)).then(function (data) {
          data = data || TVModel.emptyData(company.id);
          // a data folder is a full snapshot of the company: Tally-side masters and vouchers are replaced
          // (entries made in this app are kept and re-matched by mergeImport); folder results go first
          var items = g.items.slice().sort(function (a, b) { return (b.result.source === 'tally-folder' ? 1 : 0) - (a.result.source === 'tally-folder' ? 1 : 0); });
          if (items.length && items[0].result.source === 'tally-folder' && typeof TVModel.resetForSnapshot === 'function') TVModel.resetForSnapshot(data);
          items.forEach(function (it) {
            var counts = TVModel.mergeImport(data, it.result, it.meta);
            if (counts && counts.vouchers && counts.vouchers.matched) lastMatched += counts.vouchers.matched;
            if (it.result.companyInfo) company.info = it.result.companyInfo;
          });
          var book = new Book(data);
          company.updatedAt = Date.now();
          company.counts = { vouchers: data.vouchers.length, ledgers: Object.keys(data.ledgers).length, groups: Object.keys(data.groups).length, stockItems: Object.keys(data.stockItems).length };
          company.minDate = book.minDate; company.maxDate = book.maxDate;
          return TVDB.putData(data).then(function () { return TVDB.putCompany(company); }).then(function () {
            if (S.company && S.company.id === company.id) { S.book = book; S.period = defaultPeriod(book, lsGet('tv.period.' + company.id, null)); }
            lastId = company.id;
          });
        });
      });
    });
    return chain.then(function () { return TVDB.persist(); }).then(loadCompanies).then(function () {
      if (lastId) { S.book = null; S.company = null; return selectCompany(lastId); }
    }).then(function () { return lastId; });
  }

  /* ---- file import jobs -------------------------------------------------- */
  function addJob(job) {
    var box = document.getElementById('imp-jobs'); if (!box) return;
    job.id = 'j' + Date.now() + Math.random().toString(36).slice(2, 6); job.state = 'queued'; job.progress = 0; job.result = null;
    S.jobs.push(job);
    var el = document.createElement('div'); el.id = job.id; box.appendChild(el);
    updateJob(job); nextJob();
  }
  function queueFiles(files) {
    Array.prototype.forEach.call(files, function (f) { addJob({ file: f }); });
  }
  // Tally data files chosen from the picker: group .1800 files by folder, unzip ZIPs, pass XML through.
  function queueTallyFiles(files) {
    var groups = {}, xml = [], zips = [], bak = 0;
    Array.prototype.forEach.call(files, function (f) {
      if (/\.zip$/i.test(f.name)) zips.push(f);
      else if (/\.900$/i.test(f.name)) bak++;   // TallyPrime backup / older data: the decoder cannot read it
      else if (isTallyFile(f.name)) { var dir = (f.webkitRelativePath || '').split('/').slice(0, -1).join('/'); (groups[dir] || (groups[dir] = [])).push(f); }
      else if (!f.webkitRelativePath || /\.xml$/i.test(f.name)) xml.push(f);   // a picked folder also holds .TSF / desktop.ini: not import files
    });
    if (xml.length) queueFiles(xml);
    Object.keys(groups).forEach(function (dir) {
      var list = groups[dir];
      addFolderJob((dir ? dir.split('/').pop() + ': ' : '') + list.map(function (f) { return f.name; }).join(', '), function () {
        var folder = {};
        return Promise.all(list.map(function (f) { return f.arrayBuffer().then(function (b) { folder[f.name] = b; }); })).then(function () { return folder; });
      }, list.reduce(function (a, f) { return a + f.size; }, 0));
    });
    zips.forEach(function (z) {
      addFolderJob(z.name, function () { return z.arrayBuffer().then(unzipTallyFiles).then(function (byDir) {
        var dirs = Object.keys(byDir);
        if (!dirs.length) throw new Error('No Tally data files (Manager.1800, TranMgr.1800) inside the ZIP');
        // first folder runs in this job; any other company folders become their own jobs
        dirs.slice(1).forEach(function (dir) { addFolderJob(z.name + ' › ' + (dir.split('/').pop() || 'root'), function () { return Promise.resolve(byDir[dir]); }, 0); });
        return byDir[dirs[0]];
      }); }, z.size);
    });
    if (bak) toast('Tally backup (.900) files cannot be read. Pick Manager.1800, TranMgr.1800 and Company.1800 from the company folder.', 6000);
    else if (!xml.length && !Object.keys(groups).length && !zips.length) toast('Pick Manager.1800, TranMgr.1800 and Company.1800, or a ZIP of the folder');
  }
  function addFolderJob(label, getFolder, size) { addJob({ file: { name: label, size: size || 0 }, getFolder: getFolder }); }
  function discardCache(id) { try { if (window.TallyBridge && typeof window.TallyBridge.discard === 'function') window.TallyBridge.discard(id); } catch (e) { /* ignore */ } }
  function pickTallyFolder() {
    var id = 'd' + Date.now().toString(36);
    bridgePending[id] = { resolve: function (names) {
      if (!names || !names.length) { toast('No Tally data files found in that folder. Pick the company folder (e.g. 100000) or the Data folder that holds them.', 5000); return; }
      var groups = {};
      names.forEach(function (n) { var parts = n.split('/'); var base = parts.pop(), sub = parts.join('/'); (groups[sub] || (groups[sub] = [])).push({ name: base, cache: id + '-' + (sub ? sub.replace(/\//g, '_') + '-' : '') + base }); });
      var keys = Object.keys(groups);
      keys.forEach(function (sub, i) {
        addFolderJob(sub ? 'Tally folder ' + sub : 'Tally folder (' + groups[sub].length + ' files)', function () {
          var folder = {};
          return Promise.all(groups[sub].map(function (f) { return fetch('/cache/' + f.cache, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Could not read ' + f.name); return r.arrayBuffer(); }).then(function (b) { folder[f.name] = b; }); }))
            .then(function () { if (i === keys.length - 1) discardCache(id); return folder; });
        }, 0);
      });
    }, reject: function (e) { toast(e.message, 4000); } };
    window.TallyBridge.pickFolder(id);
  }
  window.TallyBridgeFolder = function (id, ok, result) {
    var p = bridgePending[id]; if (!p) return; delete bridgePending[id];
    if (!ok) { p.reject(new Error(result || 'Folder not opened')); return; }
    p.resolve(String(result).split('|').filter(Boolean));
  };
  // Android copied a shared / "opened with" XML file into its cache as <id>.xml: queue it as an import job
  var pendingOpen = [];
  window.TallyBridgeOpen = function (id, displayName) {
    id = String(id == null ? '' : id);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return;
    pendingOpen.push({ id: id, name: String(displayName || (id + '.xml')) });
    if (S.route && S.route.name === 'import' && document.getElementById('imp-jobs')) drainPendingOpen();
    else if (location.hash.replace(/\?.*$/, '') === '#/import') render();
    else go('#/import');
  };
  function drainPendingOpen() {
    pendingOpen.splice(0).forEach(function (o) {
      addJob({ file: { name: o.name, size: 0 }, work: function (onProgress) {
        return fetch('/cache/' + o.id + '.xml', { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('Could not read ' + o.name + ' (' + r.status + ')'); return r.arrayBuffer(); })
          .then(function (buf) { return parseInWorker(buf, onProgress); })
          .then(function (res) { discardCache(o.id); return res; }, function (e) { discardCache(o.id); throw e; });
      } });
    });
  }
  function nextJob() {
    if (S.jobs.some(function (j) { return j.state === 'running'; })) return;
    var job = S.jobs.filter(function (j) { return j.state === 'queued'; })[0];
    if (!job) { var btn = document.getElementById('imp-save'); if (btn) btn.classList.toggle('hidden', !S.jobs.some(function (j) { return j.state === 'done'; })); return; }
    job.state = 'running'; updateJob(job);
    var onProgress = function (p) { job.progress = p; updateJob(job); };
    var work = Promise.resolve().then(function () {
      if (job.work) return job.work(onProgress);
      if (job.getFolder) return job.getFolder().then(function (folder) {
        var have = Object.keys(folder).map(function (k) { return k.toLowerCase(); });
        if (have.indexOf('manager.1800') === -1 && have.indexOf('tranmgr.1800') === -1) throw new Error('No Manager.1800 or TranMgr.1800 found. Pick the files inside the company folder (e.g. 100000).');
        return decodeFolderInWorker(folder, onProgress);
      });
      return job.file.arrayBuffer().then(function (buf) { return parseInWorker(buf, onProgress); });
    });
    work
      .then(function (r) { job.result = r; job.state = 'done'; job.progress = 1; }, function (e) { job.state = 'error'; job.error = String(e && e.message || e); })
      .then(function () { updateJob(job); nextJob(); });
  }
  function updateJob(job) {
    var el = document.getElementById(job.id); if (!el) return;
    var r = job.result, s;
    if (job.state === 'done') {
      s = (r.company ? '<b>' + esc(r.company) + '</b> · ' : '') + describeResult(r);
      if (!r.vouchers.length && !r.ledgers.length && !r.groups.length) s += '<span class="dr">Nothing recognised in this file. Is it a TallyPrime XML export or data folder?</span>';
      if (r.source === 'tally-folder') s += '<div class="small faint">Decoded from TallyPrime data files' + (r.companyInfo && r.companyInfo.booksFrom ? ' · books from ' + fmtDate(r.companyInfo.booksFrom) : '') + ' · replaces this company\'s Tally data on save</div>';
      if (r.warnings.length) s += '<div class="dr small">' + r.warnings.map(esc).join('<br>') + '</div>';
    } else if (job.state === 'error') s = '<span class="dr">Failed: ' + esc(job.error) + '</span>';
    else s = job.state === 'running' ? 'Parsing… ' + Math.round(job.progress * 100) + '%' : 'Waiting';
    el.innerHTML = '<div class="kv" style="display:block"><div><b>' + esc(job.file.name) + '</b> <span class="faint small">' + (job.file.size ? (job.file.size / 1048576).toFixed(1) + ' MB' : '') + '</span></div><div class="small muted">' + s + '</div><div class="progress"><div style="width:' + Math.round(job.progress * 100) + '%"></div></div></div>';
  }
  function saveJobs() {
    var target = document.getElementById('imp-target').value, newName = (document.getElementById('imp-newname').value || '').trim();
    var btn = document.getElementById('imp-save'); btn.disabled = true; btn.textContent = 'Saving…';
    var done = S.jobs.filter(function (j) { return j.state === 'done'; });
    if (target === 'new' && !newName) newName = done.map(function (j) { return j.result.company; }).filter(Boolean)[0] || done[0].file.name.replace(/\.xml$/i, '');
    var groups = [], byKey = {};
    done.forEach(function (j) {
      var key, g;
      if (target === 'auto') { var nm = j.result.company || j.file.name.replace(/\.xml$/i, ''); var ex = findCompanyByName(nm); key = ex ? ex.id : 'new:' + nm.toLowerCase(); g = { id: ex ? ex.id : null, name: ex ? ex.name : nm }; }
      else if (target === 'new') { key = 'new:' + newName.toLowerCase(); g = { id: null, name: newName }; }
      else { key = target; g = { id: target, name: '' }; }
      if (!byKey[key]) { byKey[key] = g; g.items = []; groups.push(g); }
      byKey[key].items.push({ result: j.result, meta: { name: j.file.name, bytes: j.file.size, source: j.result.source || 'xml' } });
    });
    storeResults(groups).then(function () { S.jobs = []; toast('Imported ' + pluralize(done.length, 'file') + matchedText(), lastMatched ? 5000 : undefined); go('#/home'); })
      .catch(function (e) { toast('Save failed: ' + e.message, 5000); btn.disabled = false; btn.textContent = 'Save to company'; });
  }

  /* ---- sync from TallyPrime over Wi-Fi ----------------------------------- */
  var bridgePending = {};
  window.TallyBridgeDone = function (id, ok, result) {
    var p = bridgePending[id]; if (!p) return; delete bridgePending[id];
    if (!ok) { p.reject(new Error(result)); return; }
    var url = /^(blob:|https?:)/.test(result) ? result : '/cache/' + result + '.xml';
    fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Could not read Tally reply (' + r.status + ')'); return r.arrayBuffer(); })
      .then(function (buf) { discardCache(id); p.resolve(buf); }, p.reject);
  };
  function hasBridge() { return !!(window.TallyBridge && typeof window.TallyBridge.request === 'function'); }
  function tallyRequest(host, port, xml) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      bridgePending[id] = { resolve: resolve, reject: reject };
      window.TallyBridge.request(id, 'http://' + host + ':' + port + '/', xml);
    });
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var TALLY_REQ = {
    companies: function () {
      return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TVCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="TVCompanies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, STARTINGFROM, BOOKSFROM</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';
    },
    masters: function (co) {
      return '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + xmlEsc(co) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>';
    },
    vouchers: function (co, from, to) {
      return '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + xmlEsc(co) + '</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE TYPE="Date">' + from + '</SVFROMDATE><SVTODATE TYPE="Date">' + to + '</SVTODATE><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>';
    }
  };
  function monthRanges(from, to) {
    var out = [], y = Math.floor(from / 10000), m = Math.floor(from / 100) % 100;
    while (y * 10000 + m * 100 + 1 <= to) {
      var last = new Date(y, m, 0).getDate();
      var a = Math.max(from, y * 10000 + m * 100 + 1), b = Math.min(to, y * 10000 + m * 100 + last);
      out.push([a, b]);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  function currentFY() { var n = new Date(), fy = (n.getMonth() + 1) >= 4 ? n.getFullYear() : n.getFullYear() - 1; return { from: fy * 10000 + 401, to: n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate() }; }

  SCREENS.sync = function () {
    topbar({ title: 'Sync from Tally', sub: 'over Wi-Fi', back: true, period: false });
    var saved = lsGet('tv.sync', { host: '', port: '9000' });
    var h = '';
    if (!hasBridge()) {
      h += '<div class="notice">Direct sync needs the Tally Viewer Android app (APK). In a browser, <a href="#/import">load the Tally data folder or XML files</a> instead, or run the one-click exporter on the PC.</div>';
    }
    h += '<div class="card"><h2>TallyPrime computer</h2><div class="field"><label for="sync-host">PC address on your Wi-Fi (IPv4)</label><input id="sync-host" inputmode="decimal" placeholder="192.168.1.10" value="' + esc(saved.host) + '"></div>' +
      '<div class="field"><label for="sync-port">Port</label><input id="sync-port" inputmode="numeric" value="' + esc(saved.port) + '"></div>' +
      '<button class="btn primary block" id="sync-connect"' + (hasBridge() ? '' : ' disabled') + '>Connect</button>' +
      '<p class="small muted" style="margin-top:10px">Tally must be open on the PC with the companies loaded, and both devices on the same Wi-Fi. See <a href="#/help">setup</a> for the Tally and firewall settings.</p></div>' +
      '<div id="sync-companies"></div><div id="sync-progress"></div>';
    $view.innerHTML = h;
    document.getElementById('sync-connect').onclick = syncConnect;
  };
  function syncConnect() {
    var host = document.getElementById('sync-host').value.trim(), port = document.getElementById('sync-port').value.trim() || '9000';
    if (!host) { toast('Enter the PC address'); return; }
    lsSet('tv.sync', { host: host, port: port });
    var btn = document.getElementById('sync-connect'); btn.disabled = true; btn.textContent = 'Connecting…';
    var box = document.getElementById('sync-companies'); box.innerHTML = '';
    tallyRequest(host, port, TALLY_REQ.companies()).then(function (buf) { return parseInWorker(buf); }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Connect';
      if (!r.companies.length) { box.innerHTML = '<div class="notice">Tally answered but listed no open companies. Open the company in TallyPrime first.' + (r.preview ? '<div class="small" style="margin-top:6px">' + esc(r.preview) + '</div>' : '') + '</div>'; return; }
      var fy = currentFY();
      var h = '<div class="card"><h2>Companies open in Tally</h2>' + r.companies.map(function (c, i) {
        return '<label class="kv" style="cursor:pointer"><span><input type="checkbox" class="sync-co" data-i="' + i + '" checked> ' + esc(c.name) + '</span><span class="small muted">books from ' + fmtDate(c.booksFrom || c.startingFrom) + '</span></label>';
      }).join('') + '</div>';
      h += '<div class="card"><h2>Vouchers to fetch</h2><div class="field"><label for="sync-from">From</label><input type="date" id="sync-from" value="' + toISO(fy.from) + '"></div><div class="field"><label for="sync-to">To</label><input type="date" id="sync-to" value="' + toISO(fy.to) + '"></div>' +
        '<label class="kv" style="cursor:pointer"><span><input type="checkbox" id="sync-all"> Everything since books beginning</span><span></span></label>' +
        '<label class="kv" style="cursor:pointer"><span><input type="checkbox" id="sync-masters" checked> Also fetch masters (ledgers, groups, items)</span><span></span></label>' +
        '<button class="btn primary block" id="sync-run" style="margin-top:10px">Sync now</button></div>';
      box.innerHTML = h;
      document.getElementById('sync-run').onclick = function () { runSync(host, port, r.companies); };
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Connect';
      box.innerHTML = '<div class="notice"><b>Could not reach Tally at ' + esc(host + ':' + port) + '.</b><br>' + esc(e.message) + '<br><span class="small">Check that TallyPrime is open, acting as a server on port ' + esc(port) + ', the Windows firewall allows it, and the phone is on the same Wi-Fi.</span></div>';
    });
  }
  async function runSync(host, port, companies) {
    var chosen = []; document.querySelectorAll('.sync-co:checked').forEach(function (cb) { chosen.push(companies[parseInt(cb.getAttribute('data-i'), 10)]); });
    if (!chosen.length) { toast('Pick at least one company'); return; }
    var all = document.getElementById('sync-all').checked, withMasters = document.getElementById('sync-masters').checked;
    var from = fromISO(document.getElementById('sync-from').value), to = fromISO(document.getElementById('sync-to').value);
    if (!all && (!from || !to || from > to)) { toast('Pick a valid from/to'); return; }
    var run = document.getElementById('sync-run'); run.disabled = true; run.textContent = 'Syncing…';
    var prog = document.getElementById('sync-progress'), lines = [], groups = [];
    function log(msg, cls) { lines.push('<div class="kv' + (cls ? ' ' + cls : '') + '"><span>' + msg + '</span></div>'); prog.innerHTML = '<div class="card"><h2>Progress</h2>' + lines.slice(-12).join('') + '</div>'; }
    function setLast(msg) { lines[lines.length - 1] = '<div class="kv"><span>' + msg + '</span></div>'; prog.innerHTML = '<div class="card"><h2>Progress</h2>' + lines.slice(-12).join('') + '</div>'; }
    try {
      for (var ci = 0; ci < chosen.length; ci++) {
        var co = chosen[ci], ex = findCompanyByName(co.name), g = { id: ex ? ex.id : null, name: ex ? ex.name : co.name, items: [] };
        var cFrom = all ? (co.booksFrom || co.startingFrom || from) : from, cTo = all ? (currentFY().to) : to;
        if (withMasters) {
          log('<b>' + esc(co.name) + '</b>: fetching masters…');
          var mr = await parseInWorker(await tallyRequest(host, port, TALLY_REQ.masters(co.name)));
          if (!mr.ledgers.length && !mr.groups.length) throw new Error('Tally returned no masters for ' + co.name + (mr.preview ? ': ' + mr.preview : ''));
          setLast('<b>' + esc(co.name) + '</b>: masters – ' + describeResult(mr));
          g.items.push({ result: mr, meta: { name: 'Tally sync masters', bytes: 0, source: 'tally-sync' } });
        }
        var months = monthRanges(cFrom, cTo), count = 0;
        for (var mi = 0; mi < months.length; mi++) {
          var rng = months[mi];
          log('<b>' + esc(co.name) + '</b>: vouchers ' + fmtMonth(Math.floor(rng[0] / 100)) + ' (' + (mi + 1) + '/' + months.length + ')…');
          var vr = await parseInWorker(await tallyRequest(host, port, TALLY_REQ.vouchers(co.name, rng[0], rng[1])));
          if (mi === 0 && !vr.vouchers.length && vr.preview && /error|could not|invalid/i.test(vr.preview)) throw new Error('Tally said: ' + vr.preview);
          count += vr.vouchers.length;
          setLast('<b>' + esc(co.name) + '</b>: ' + fmtMonth(Math.floor(rng[0] / 100)) + ' – ' + pluralize(vr.vouchers.length, 'voucher') + ' (' + count + ' so far)');
          if (vr.vouchers.length) g.items.push({ result: vr, meta: { name: 'Tally sync ' + fmtMonth(Math.floor(rng[0] / 100)), bytes: 0, source: 'tally-sync' } });
        }
        groups.push(g);
      }
      log('Saving…');
      await storeResults(groups);
      toast('Synced ' + pluralize(chosen.length, 'company') + matchedText(), lastMatched ? 5000 : undefined);
      go('#/home');
    } catch (e) {
      log('<span class="dr">Failed: ' + esc(e.message) + '</span>');
      run.disabled = false; run.textContent = 'Sync now';
    }
  }

  /* ---- home --------------------------------------------------------------- */
  // profit figures exclude opening/closing stock; when the model can estimate stock values show the adjusted figure too
  function stockAdj(b, from, to) {
    var sv = typeof b.stockValuation === 'function' ? b.stockValuation(from, to) : null;
    return sv ? { opening: sv.opening, closing: sv.closing, method: sv.method, delta: sv.closing - sv.opening } : null;
  }
  SCREENS.home = function () {
    if (isClassic()) { TVClassic.gateway(); return; }
    var b = S.book, p = S.period, s = b.summary(p.from, p.to);
    // the quick row right below already offers New entry, so the top bar keeps only look / period / More and the company name gets the room
    topbar({ title: S.company.name, titleAct: 'company', sub: dateRange(p.from, p.to), look: true, right: gearChip() });
    var h = '', folder = fromFolder(b);
    if (!b.vouchers.length) h += '<div class="notice">' + (folder ? 'No vouchers were found in the Tally data folder for this company. Copy the company folder from the PC again to refresh.' : 'No vouchers loaded for this company yet. ' + esc(FOLDER_HINT) + ' A Daybook XML export also works.') + '</div>';
    else if (Object.keys(b.data.groups).length === 0) h += '<div class="notice">' + (folder ? 'Masters were not found in the Tally data folder: ledgers can\'t be grouped, so the balance sheet and P&amp;L will be incomplete. Copy the company folder from the PC again to refresh.' : 'Masters not loaded: ledgers can\'t be grouped, so the balance sheet and P&amp;L will be incomplete. Open the Tally data folder, or import Master.xml too.') + '</div>';
    var inPeriod = b.vouchersIn(p.from, p.to).length;
    // previous period of the same length, one year earlier
    var prev = b.summary(p.from - 10000, p.to - 10000), np = s.netProfit, pp = prev.netProfit;
    var delta = (Math.abs(pp) > 0.005) ? Math.round((np - pp) / Math.abs(pp) * 100) : null;
    var deltaText = delta === null ? '' : (pp < 0 && np >= 0) ? '▲ Back to profit' : (pp >= 0 && np < 0) ? '▼ Into loss' : (np >= pp ? '▲ ' : '▼ ') + Math.abs(delta) + '% vs last year';
    // same definition as the headline: sales + other income − purchases − expenses, per month
    var spark = sparkline(s.monthly.map(function (m) { return m.sales + m.income - m.purchases - m.expenses; }));
    var adj = stockAdj(b, p.from, p.to), after = adj && Math.abs(adj.delta) >= 1 ? np + adj.delta : null;
    var info = '<button class="info-chip" data-act="stockinfo" aria-label="Why before stock?" title="Why before stock?" style="display:inline-grid;place-items:center;width:28px;height:28px;padding:0;margin-left:6px;border-radius:50%;border:1px solid currentColor;background:transparent;color:inherit;opacity:.75;vertical-align:middle">' + svgIcon('info', 15) + '</button>';
    h += '<div class="hero"><div class="hero-in"><div class="label">' + (np < 0 ? 'Loss before stock' : 'Profit before stock') + ' · ' + esc(p.label) + info + '</div>' +
      '<div class="value num' + (np < 0 ? ' neg' : '') + '">' + esc(compact(Math.abs(np))) + '</div>' +
      (after !== null ? '<div class="meta"><span>After stock adj. ' + (after < 0 ? 'loss ' : '') + esc(compact(Math.abs(after))) + '</span></div>' : '') +
      '<div class="meta"><span>Income ' + esc(compact(s.sales + s.directIncome + s.indirectIncome)) + ' · Expenses ' + esc(compact(s.expenses + s.purchases)) + '</span>' +
      (deltaText ? '<span class="delta' + (np < pp ? ' down' : '') + '">' + deltaText + '</span>' : '') + '</div>' + spark + '</div></div>';
    h += '<div class="quick"><button data-act="newentry"><span class="ico">' + ICONS.entry + '</span>New entry</button><button data-go="vouchers"><span class="ico">' + ICONS.vouchers + '</span>Day book</button><button data-go="ledgers"><span class="ico">' + ICONS.ledger + '</span>Ledgers</button><button data-go="reports"><span class="ico">' + ICONS.report + '</span>Reports</button></div>';
    h += '<div class="tiles">' +
      tile('Sales', compact(s.sales), 'for period', '', ICONS.sales) + tile('Purchases', compact(s.purchases), 'for period', '', ICONS.purchase) +
      tile('Receivables', compact(s.receivables), pluralize(s.debtors.filter(function (d) { return d.closing < 0; }).length, 'party'), '', ICONS.receivable) +
      tile('Payables', compact(s.payables), pluralize(s.creditors.filter(function (d) { return d.closing > 0; }).length, 'party'), '', ICONS.payable) +
      tile('Cash in hand', compact(s.cash), 'as on ' + fmtDate(p.to), '', ICONS.cash) + tile('Bank', compact(s.bank), s.bank < 0 ? 'overdrawn' : 'as on ' + fmtDate(p.to), '', ICONS.bank) +
      tile('Expenses', compact(s.expenses), 'direct + indirect', '', ICONS.expense) + tile('Vouchers', NF0.format(inPeriod), 'in period', '', ICONS.vouchers) +
      '</div>';
    h += '<div class="card"><h2>Monthly sales vs purchases</h2>' + chart(s.monthly) + '</div>';
    h += TVF.homeWidgets();
    var top = s.debtors.filter(function (d) { return d.closing < 0; }).slice(0, 5);
    if (top.length) h += '<div class="card" style="padding:0"><h2 style="padding:14px 14px 0"><a class="more" href="#/report/receivables">All ›</a>Top receivables</h2><div>' + top.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div></div>';
    var recent = b.vouchersIn(p.from, p.to).slice(-5).reverse();
    if (recent.length) h += '<div class="card" style="padding:0"><h2 style="padding:14px 14px 0"><a class="more" href="#/vouchers">All ›</a>Latest vouchers</h2><div>' + recent.map(voucherRow).join('') + '</div></div>';
    $view.innerHTML = h;
    bindChart();
  };
  function tile(label, value, sub, cls, icon) { return '<div class="tile ' + (cls || '') + '">' + (icon ? '<div class="ico">' + icon + '</div>' : '') + '<div class="label">' + esc(label) + '</div><div class="value num">' + esc(value) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'; }
  function sparkline(vals) {
    if (vals.length < 2) return '';
    var W = 300, H = 44, min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)]; });
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6, c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    var last = pts[pts.length - 1];
    // dashed zero line when the monthly figure crosses zero
    var zero = (min < 0 && max > 0) ? '<line x1="0" x2="' + W + '" y1="' + (H - 4 - ((0 - min) / span) * (H - 8)).toFixed(1) + '" y2="' + (H - 4 - ((0 - min) / span) * (H - 8)).toFixed(1) + '" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>' : '';
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#sg)"/>' + zero + '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="var(--accent)"/></svg>';
  }

  // monthly bars: 1 SVG unit ≈ 1 CSS px on a phone, month labels as an HTML row under the SVG (legible at any width)
  function chart(months) {
    if (!months.length) return '<p class="muted small">No activity in this period.</p>';
    var data = months.slice(-12), W = 348, H = 160, padL = 6, padR = 6, padT = 16, padB = 4;
    var max = 0; data.forEach(function (m) { max = Math.max(max, m.sales, m.purchases); });
    if (max <= 0) max = 1;
    var innerW = W - padL - padR, innerH = H - padT - padB, gw = innerW / data.length, bw = Math.min(14, Math.max(3, (gw - 6) / 2));
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" id="chart" role="img" aria-label="Monthly sales and purchases">';
    for (var g = 0; g <= 4; g++) { var y = padT + innerH - innerH * g / 4; svg += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>'; }
    svg += '<text class="axis ylab" x="' + (W - padR) + '" y="' + (padT - 5) + '" text-anchor="end">' + esc(compact(max)) + '</text>';
    svg += '<text class="axis ylab" x="' + (W - padR) + '" y="' + (padT + innerH - 4) + '" text-anchor="end">0</text>';
    data.forEach(function (m, i) {
      var x0 = padL + gw * i, cx = x0 + gw / 2;
      svg += '<g class="mg" data-i="' + i + '"><rect class="hit" x="' + x0 + '" y="0" width="' + gw + '" height="' + H + '" fill="transparent"/>';
      var hs = innerH * m.sales / max, hp = innerH * m.purchases / max;
      svg += '<rect class="bar" x="' + (cx - bw - 1) + '" y="' + (padT + innerH - Math.max(0, hs)) + '" width="' + bw + '" height="' + Math.max(0, hs) + '" fill="var(--series-1)"/>';
      svg += '<rect class="bar" x="' + (cx + 1) + '" y="' + (padT + innerH - Math.max(0, hp)) + '" width="' + bw + '" height="' + Math.max(0, hp) + '" fill="var(--series-2)"/></g>';
    });
    svg += '</svg>';
    var axis = '<div class="axis-row" id="chart-axis">' + data.map(function (m, i) { return '<span data-i="' + i + '" title="' + esc(fmtMonth(m.month)) + '">' + esc(data.length > 6 ? (MON[(m.month % 100) - 1] || '') : fmtMonth(m.month)) + '</span>'; }).join('') + '</div>';
    var legend = '<div class="legend"><span><i style="background:var(--series-1)"></i>Sales</span><span><i style="background:var(--series-2)"></i>Purchases</span></div>';
    var last = data[data.length - 1];
    return legend + svg + axis + '<div class="chart-tip" id="chart-tip" data-months="' + esc(JSON.stringify(data.map(function (m) { return [m.month, m.sales, m.purchases, m.expenses]; }))) + '">' + chartTip(last) + '</div>';
  }
  function chartTip(m) { return '<b>' + esc(fmtMonth(m.month || m[0])) + '</b><span>Sales ' + esc(compact(m.sales !== undefined ? m.sales : m[1])) + '</span><span>Purchases ' + esc(compact(m.purchases !== undefined ? m.purchases : m[2])) + '</span><span>Expenses ' + esc(compact(m.expenses !== undefined ? m.expenses : m[3])) + '</span>'; }
  function bindChart() {
    var svg = document.getElementById('chart'); if (!svg) return;
    var tip = document.getElementById('chart-tip'), axis = document.getElementById('chart-axis'), months = JSON.parse(tip.getAttribute('data-months'));
    function select(i) {
      if (!(i >= 0 && i < months.length)) return;
      tip.innerHTML = chartTip(months[i]);
      svg.querySelectorAll('.hit').forEach(function (r, k) { r.setAttribute('fill', k === i ? 'var(--accent-soft)' : 'transparent'); });
      if (axis) axis.querySelectorAll('span').forEach(function (s, k) { s.classList.toggle('on', k === i); });
    }
    function pick(ev) { var g = ev.target.closest('[data-i]'); if (g) select(parseInt(g.getAttribute('data-i'), 10)); }
    svg.addEventListener('pointerdown', pick); svg.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse') pick(ev); });
    if (axis) axis.addEventListener('click', pick);
  }


  /* ---- exports (Excel / PDF) ---------------------------------------------- */
  function drcr(n) { return Math.abs(n) < 0.005 ? '' : (n < 0 ? 'Dr' : 'Cr'); }
  function balText(n) { return Math.abs(n) < 0.005 ? '0.00' : fmt(Math.abs(n)) + ' ' + drcr(n); }
  function periodLabel() { return fmtDate(S.period.from) + ' to ' + fmtDate(S.period.to); }
  function exportName(kind, what) { return (S.company ? S.company.name + ' - ' : '') + what + ' - ' + fmtDate(S.period.from).replace(/ /g, '') + ' to ' + fmtDate(S.period.to).replace(/ /g, '') + (kind === 'xlsx' ? '.xlsx' : '.pdf'); }
  function afterSave(p) {
    p.then(function (r) { toast(r.where && r.where !== 'download' ? 'Saved to ' + r.where : 'Export ready: ' + r.name, 4000); })
     .catch(function (e) { toast('Export failed: ' + e.message, 5000); });
  }
  function exportButtons(key) {
    return '<div class="actions"><button class="act" data-export="' + key + ':xlsx"><span class="ico">' + TVF_ICON('excel') + '</span>Excel</button><button class="act" data-export="' + key + ':pdf"><span class="ico">' + TVF_ICON('pdf') + '</span>PDF</button></div>';
  }
  function TVF_ICON(k) { return k === 'excel' ? '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l8 8M16 9l-8 8"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/></svg>'; }
  // Ledger statement: one ledger, all transactions in the period with running balance
  function exportLedger(name, kind) { var e = buildLedgerExport(name, kind); afterSave(TVExport.save(e.name, e.blob)); }
  function buildLedgerExport(name, kind) {
    var b = S.book, p = S.period, led = b.ledgers[name], st = b.ledgerStatement(name, p.from, p.to), bl = st.balance;
    var meta = ['Period: ' + periodLabel(), 'Group: ' + (led.chain.length ? led.chain.join(' > ') : 'Primary')];
    if (led.info && led.info.gstin) meta.push('GSTIN: ' + led.info.gstin);
    var totalsDr = 0, totalsCr = 0;
    var rows = st.rows.map(function (x) {
      var v = x.voucher, dr = x.amount < 0 ? -x.amount : 0, cr = x.amount > 0 ? x.amount : 0;
      totalsDr += dr; totalsCr += cr;
      var part = x.others.length === 1 ? x.others[0] : x.others.length ? x.contra.map(function (c) { return c.ledger + ' ' + fmt(Math.abs(c.amount)); }).join('; ') : (v.party || v.type);
      return { date: fmtDate(x.date), part: part, type: v.type, no: v.number, dr: dr, cr: cr, bal: x.balance, narr: v.narration };
    });
    if (kind === 'xlsx') {
      var sheet = {
        name: 'Ledger', title: [name, S.company.name, meta.join('  |  ')],
        columns: [{ title: 'Date', width: 11 }, { title: 'Particulars', width: 40 }, { title: 'Vch Type', width: 14 }, { title: 'Vch No', width: 10 }, { title: 'Debit', width: 15, type: 'num' }, { title: 'Credit', width: 15, type: 'num' }, { title: 'Balance', width: 16, type: 'num' }, { title: 'Dr/Cr', width: 6 }, { title: 'Narration', width: 50 }],
        rows: [[fmtDate(p.from), 'Opening balance', '', '', null, null, Math.abs(bl.opening), drcr(bl.opening), '']].concat(rows.map(function (r) { return [r.date, r.part, r.type, r.no, r.dr || null, r.cr || null, Math.abs(r.bal), drcr(r.bal), r.narr]; })),
        totals: [['', 'Total', '', '', totalsDr, totalsCr, null, '', ''], [fmtDate(p.to), 'Closing balance', '', '', null, null, Math.abs(bl.closing), drcr(bl.closing), '']]
      };
      return { name: exportName('xlsx', name), blob: TVExport.xlsx([sheet]) };
    } else {
      var doc = {
        title: name, subtitle: S.company.name, meta: meta,
        columns: [{ title: 'Date', width: 52, align: 'l' }, { title: 'Particulars', width: 170, align: 'l' }, { title: 'Vch Type', width: 62, align: 'l' }, { title: 'No', width: 38, align: 'l' }, { title: 'Debit', width: 72, align: 'r' }, { title: 'Credit', width: 72, align: 'r' }, { title: 'Balance', width: 86, align: 'r' }],
        rows: [[fmtDate(p.from), 'Opening balance', '', '', '', '', balText(bl.opening)]].concat(rows.map(function (r) { return [r.date, r.part, r.type, r.no, r.dr ? fmt(r.dr) : '', r.cr ? fmt(r.cr) : '', balText(r.bal)]; })),
        totals: [['', 'Total', '', '', fmt(totalsDr), fmt(totalsCr), ''], [fmtDate(p.to), 'Closing balance', '', '', '', '', balText(bl.closing)]]
      };
      return { name: exportName('pdf', name), blob: TVExport.pdf(doc) };
    }
  }
  // Ledger balances: a list of ledgers with opening, movement and closing for the period
  function exportLedgerList(names, label, kind) {
    var b = S.book, p = S.period, tDr = 0, tCr = 0;
    var rows = names.map(function (n) {
      var led = b.ledgers[n], bl = b.ledgerBalance(n, p.from, p.to); tDr += bl.debit; tCr += bl.credit;
      return { name: n, group: led.parent || (led.implicit ? 'Not in masters' : 'Primary'), bl: bl };
    });
    if (kind === 'xlsx') {
      var sheet = {
        name: 'Ledgers', title: [label, S.company.name, 'Period: ' + periodLabel()],
        columns: [{ title: 'Ledger', width: 40 }, { title: 'Group', width: 24 }, { title: 'Opening', width: 15, type: 'num' }, { title: 'Dr/Cr', width: 6 }, { title: 'Debit', width: 15, type: 'num' }, { title: 'Credit', width: 15, type: 'num' }, { title: 'Closing', width: 15, type: 'num' }, { title: 'Dr/Cr', width: 6 }],
        rows: rows.map(function (r) { return [r.name, r.group, Math.abs(r.bl.opening) || null, drcr(r.bl.opening), r.bl.debit || null, r.bl.credit || null, Math.abs(r.bl.closing) || null, drcr(r.bl.closing)]; }),
        totals: [['Total', '', null, '', tDr, tCr, null, '']]
      };
      afterSave(TVExport.save(exportName('xlsx', label), TVExport.xlsx([sheet])));
    } else {
      var doc = {
        title: label, subtitle: S.company.name, meta: ['Period: ' + periodLabel(), pluralize(rows.length, 'ledger')],
        columns: [{ title: 'Ledger', width: 170, align: 'l' }, { title: 'Group', width: 95, align: 'l' }, { title: 'Opening', width: 80, align: 'r' }, { title: 'Debit', width: 70, align: 'r' }, { title: 'Credit', width: 70, align: 'r' }, { title: 'Closing', width: 82, align: 'r' }],
        rows: rows.map(function (r) { return [r.name, r.group, balText(r.bl.opening), r.bl.debit ? fmt(r.bl.debit) : '', r.bl.credit ? fmt(r.bl.credit) : '', balText(r.bl.closing)]; }),
        totals: [['Total', '', '', fmt(tDr), fmt(tCr), '']]
      };
      afterSave(TVExport.save(exportName('pdf', label), TVExport.pdf(doc)));
    }
  }
  var LFILTER_LABEL = { all: 'All ledgers', debtors: 'Sundry debtors', creditors: 'Sundry creditors', cashbank: 'Cash and bank', income: 'Income ledgers', expense: 'Expense ledgers', other: 'Other ledgers' };
  function runExport(key, kind) {
    var parts = key.split('/'), what = parts[0], arg = parts.slice(1).join('/');
    if (!S.book) return;
    if (what === 'ledger') exportLedger(decodeURIComponent(arg), kind);
    else if (what === 'ledgers') { var sel = JSON.parse(decodeURIComponent(arg)); exportLedgerList(S.lastLedgerList || [], (LFILTER_LABEL[sel.f] || 'Ledgers') + (sel.q ? ' matching "' + sel.q + '"' : ''), kind); }
    else if (what === 'receivables' || what === 'payables') exportLedgerList(S.lastPartyList || [], what === 'receivables' ? 'Receivables (Sundry debtors)' : 'Payables (Sundry creditors)', kind);
  }

  /* ---- ledgers ------------------------------------------------------------ */
  var LFILTERS = [['all', 'All'], ['debtors', 'Debtors'], ['creditors', 'Creditors'], ['cashbank', 'Cash & Bank'], ['income', 'Income'], ['expense', 'Expenses'], ['other', 'Others']];
  function ledgerMatchesFilter(led, f) {
    switch (f) {
      case 'debtors': return led.chain.indexOf('Sundry Debtors') !== -1;
      case 'creditors': return led.chain.indexOf('Sundry Creditors') !== -1;
      case 'cashbank': return led.chain.indexOf('Cash-in-Hand') !== -1 || led.chain.indexOf('Bank Accounts') !== -1 || led.chain.indexOf('Bank OD A/c') !== -1;
      case 'income': return led.nature === 'I';
      case 'expense': return led.nature === 'E';
      case 'other': return !(led.chain.indexOf('Sundry Debtors') !== -1 || led.chain.indexOf('Sundry Creditors') !== -1 || led.chain.indexOf('Cash-in-Hand') !== -1 || led.chain.indexOf('Bank Accounts') !== -1 || led.nature === 'I' || led.nature === 'E');
      default: return true;
    }
  }
  // Search filters in place: typing re-renders only the list, the counts and the export button
  // (hash kept with replaceState; no render(), no scroll reset, no entrance animation).
  SCREENS.ledgers = function (r) {
    var b = S.book, p = S.period, f = r.q.f || 'all', q = r.q.q || '', showNil = r.q.nil === '1';
    topbar({ title: 'Ledgers', sub: S.company.name, right: gearChip(), extra: '<div class="chips">' + LFILTERS.map(function (x) { var on = f === x[0]; return '<button class="chip ' + (on ? 'on' : '') + '" data-filter="' + x[0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + x[1] + '</button>'; }).join('') + '</div>' });
    var st = { rows: [], names: [], hidden: 0 };
    function nilHref() { return '#/ledgers?f=' + f + '&nil=1&q=' + encodeURIComponent(q); }
    function compute() {
      var ql = q.toLowerCase(), rows = [], names = [], hidden = 0;
      b.ledgerNames.forEach(function (n) {
        var led = b.ledgers[n];
        if (!ledgerMatchesFilter(led, f)) return;
        if (ql && n.toLowerCase().indexOf(ql) === -1 && (led.parent || '').toLowerCase().indexOf(ql) === -1 && !((led.info && led.info.aliases) || []).some(function (a) { return a.toLowerCase().indexOf(ql) !== -1; })) return;
        var bl = b.ledgerBalance(n, p.from, p.to);
        if (!showNil && Math.abs(bl.closing) < 0.005 && !bl.count) { hidden++; return; }
        names.push(n);
        rows.push(ledgerRow(n, bl.closing, led.parent || (led.implicit ? 'Not in masters' : 'Primary')));
      });
      st.rows = rows; st.names = names; st.hidden = hidden;
      S.lastLedgerList = names;
    }
    function body() {
      var rows = st.rows, h = '';
      if (!rows.length) return emptyState('ledger', 'No ledgers match', q ? 'Try a shorter search or another filter.' : 'Nothing under this filter' + (st.hidden ? ' has a balance or a transaction in ' + S.period.label : '') + '.', st.hidden ? '<a class="btn" href="' + nilHref() + '">Show ' + NF0.format(st.hidden) + ' nil-balance ledgers</a>' : '');
      h += '<div class="list" id="llist">' + rows.slice(0, PAGE).join('') + '</div>' + moreBtn('lmore', rows);
      if (st.hidden) h += '<p class="small muted" style="text-align:center">' + NF0.format(st.hidden) + ' ledgers with no balance and no transactions hidden · <a href="' + nilHref() + '">show</a></p>';
      h += '<p class="small muted" style="margin:14px 2px 4px">Export ' + pluralize(rows.length, 'ledger') + ' with balances for ' + esc(S.period.label) + '</p>' + exportButtons('ledgers/' + encodeURIComponent(JSON.stringify({ f: f, q: q })));
      return h;
    }
    compute();
    $view.innerHTML = '<div class="search"><input type="search" id="lsearch" aria-label="Search ledgers" placeholder="Search ' + NF0.format(b.ledgerNames.length) + ' ledgers" value="' + esc(q) + '"></div><div id="lbody">' + body() + '</div>';
    pageMore('lmore', 'llist', st.rows);
    var inp = document.getElementById('lsearch'), t;
    inp.oninput = function () {
      clearTimeout(t); var v = inp.value;
      t = setTimeout(function () {
        if (!document.contains(inp)) return;   // navigated away before the debounce fired: leave the new screen's hash alone
        q = v; if (S.route && S.route.q) S.route.q.q = q;
        history.replaceState(null, '', '#/ledgers?f=' + f + '&q=' + encodeURIComponent(q) + (showNil ? '&nil=1' : ''));
        compute();
        var lb = document.getElementById('lbody'); if (!lb) return;
        lb.innerHTML = body(); pageMore('lmore', 'llist', st.rows);
        announce(pluralize(st.rows.length, 'ledger') + ' match');
      }, 200);
    };
    $top.querySelectorAll('[data-filter]').forEach(function (c) { c.onclick = function () { go('#/ledgers?f=' + c.getAttribute('data-filter') + '&q=' + encodeURIComponent(q) + (showNil ? '&nil=1' : '')); }; });
  };
  function ledgerRow(name, closing, sub) {
    var led = S.book ? S.book.ledgers[name] : null;
    return '<button class="row" data-ledger="' + esc(name) + '"><div class="main"><div class="t">' + esc(name) + '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div><div class="amt"><div class="v">' + bal(closing, undefined, led) + '</div></div><span class="chev">›</span></button>';
  }

  SCREENS.ledger = function (r) {
    var b = S.book, p = S.period, name = r.arg, led = b.ledgers[name];
    if (!led) { topbar({ title: 'Ledger', back: true }); $view.innerHTML = emptyState('ledger', 'Ledger not found', 'It may have been renamed or removed in Tally.', '<button class="btn" data-go="ledgers">All ledgers</button>'); return; }
    var st = b.ledgerStatement(name, p.from, p.to), bl = st.balance, info = led.info || {}, classic = isClassic();
    topbar({ title: name, sub: led.chain.length ? led.chain.join(' › ') : (led.implicit ? 'Not in masters' : 'Primary'), back: true });
    var h = '';
    if (!classic) h += '<div class="tiles"><div class="tile"><div class="label">Opening</div><div class="value" style="font-size:16px">' + bal(bl.opening, undefined, led) + '</div></div><div class="tile"><div class="label">Closing</div><div class="value" style="font-size:16px">' + bal(bl.closing, undefined, led) + '</div></div>' +
      '<div class="tile"><div class="label">Debits</div><div class="value num" style="font-size:16px">' + fmt(bl.debit) + '</div></div><div class="tile"><div class="label">Credits</div><div class="value num" style="font-size:16px">' + fmt(bl.credit) + '</div></div></div>';
    h += TVF.ledgerActions(name, led);
    h += TVF.ledgerMonthlyCard(name);
    var contact = [];
    if (info.gstin) contact.push(['GSTIN', info.gstin]);
    if (info.phone) contact.push(['Phone', '<a href="tel:' + esc(info.phone) + '">' + esc(info.phone) + '</a>']);
    if (info.contact) contact.push(['Contact', esc(info.contact)]);
    if (info.email) contact.push(['Email', esc(info.email)]);
    if (info.address) contact.push(['Address', esc(info.address)]);
    if (info.state) contact.push(['State', esc(info.state)]);
    if (info.aliases && info.aliases.length) contact.push(['Alias', esc(info.aliases.join(', '))]);
    if (contact.length) h += '<div class="card">' + contact.map(function (c) { return '<div class="kv"><span class="muted">' + c[0] + '</span><span>' + (c[0] === 'GSTIN' ? esc(c[1]) : c[1]) + '</span></div>'; }).join('') + '</div>';
    if (info.billwise) {
      var bills = b.bills(name, p.to);
      if (bills.length) h += '<div class="card"><h2>Pending bills as on ' + fmtDate(p.to) + '</h2><table class="tbl"><tr><th>Bill</th><th>Date</th><th class="n">Amount</th></tr>' + bills.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + fmtDate(x.date) + '</td><td class="n">' + bal(x.amount) + '</td></tr>'; }).join('') + '</table></div>';
    }
    h += '<div class="section-title">' + pluralize(st.rows.length, 'transaction') + ' in period</div>';
    var rows;
    if (classic) {
      // Tally's Ledger Vouchers: ascending, Debit/Credit columns, Opening Balance first, Current Total and Closing Balance last
      var tDr = 0, tCr = 0;   // Tally's Current Total is the period's movement only; the opening is its own row
      rows = st.rows.map(function (x) {
        var v = x.voucher, dr = x.amount < 0 ? -x.amount : 0, cr = x.amount > 0 ? x.amount : 0; tDr += dr; tCr += cr;
        var part = x.others.length === 1 ? x.others[0] : x.others.length ? 'As per details (' + x.others.length + ' ledgers)' : (v.party || v.type);
        return '<tr data-voucher="' + v.idx + '"><td style="white-space:nowrap">' + fmtDate(x.date) + '</td><td>' + esc(part) + (v.narration ? '<div class="small faint" style="max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v.narration) + '</div>' : '') + '</td><td style="white-space:nowrap">' + esc(v.type) + '</td><td>' + esc(v.number || '') + '</td><td class="n" style="white-space:nowrap">' + (dr ? fmt(dr) : '') + '</td><td class="n" style="white-space:nowrap">' + (cr ? fmt(cr) : '') + '</td></tr>';
      });
      h += '<div class="card scroll" style="padding:0"><table class="tbl cl-ledger"><thead><tr><th>Date</th><th>Particulars</th><th style="white-space:nowrap">Vch Type</th><th style="white-space:nowrap">Vch No.</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead>' +
        '<tbody id="lrows"><tr class="opening"><td style="white-space:nowrap">' + fmtDate(p.from) + '</td><td>Opening Balance</td><td></td><td></td><td class="n" style="white-space:nowrap">' + (bl.opening < 0 ? fmt(-bl.opening) : '') + '</td><td class="n" style="white-space:nowrap">' + (bl.opening > 0 ? fmt(bl.opening) : '') + '</td></tr>' + rows.slice(0, PAGE).join('') + '</tbody>' +
        '<tfoot><tr class="total"><td></td><td>Current Total</td><td></td><td></td><td class="n" style="white-space:nowrap">' + fmt(tDr) + '</td><td class="n" style="white-space:nowrap">' + fmt(tCr) + '</td></tr>' +
        '<tr class="total"><td style="white-space:nowrap">' + fmtDate(p.to) + '</td><td>Closing Balance</td><td></td><td></td><td class="n" style="white-space:nowrap">' + (bl.closing < 0 ? fmt(-bl.closing) : '') + '</td><td class="n" style="white-space:nowrap">' + (bl.closing > 0 ? fmt(bl.closing) : '') + '</td></tr></tfoot></table></div>' + moreBtn('lmore', rows);
    } else if (st.rows.length) {
      rows = st.rows.slice().reverse().map(function (x) {
        var v = x.voucher, particulars = x.others.length === 1 ? x.others[0] : x.others.length ? 'As per details (' + x.others.length + ' ledgers)' : (v.party || v.type);
        var detail = x.others.length > 1 ? x.contra.map(function (c) { return esc(c.ledger) + ' ' + fmt(Math.abs(c.amount)); }).join(' · ') : '';
        return '<button class="row" data-voucher="' + v.idx + '"><div class="main"><div class="t">' + esc(particulars) + '</div><div class="s">' + fmtDate(x.date) + ' · ' + esc(v.type) + (v.number ? ' #' + esc(v.number) : '') + (v.source === 'app' ? ' · app' : '') + (detail ? ' · ' + detail : (v.narration ? ' · ' + esc(v.narration) : '')) + '</div></div><div class="amt"><div class="v">' + bal(x.amount) + '</div><div class="s">' + bal(x.balance, false).replace(/<[^>]+>/g, '') + '</div></div></button>';
      });
      h += '<div class="list" id="lrows">' + rows.slice(0, PAGE).join('') + '</div>' + moreBtn('lmore', rows);
    } else { rows = []; h += '<div class="empty small">No transactions in this period.</div>'; }
    $view.innerHTML = h;
    pageMore('lmore', 'lrows', rows);
  };

  /* ---- vouchers ----------------------------------------------------------- */
  SCREENS.vouchers = function (r) {
    var b = S.book, p = S.period, q = r.q.q || '', type = r.q.type || '', classic = isClassic();
    topbar({ title: 'Day Book', sub: S.company.name, right: '<button class="chip" data-act="newentry">' + ICONS.plus + 'Entry</button>' + gearChip() });
    // the type filter shows counts for the selected period, not for all data
    var inPeriod = b.vouchersIn(p.from, p.to), tc = {};
    inPeriod.forEach(function (v) { tc[v.type] = (tc[v.type] || 0) + 1; });
    if (type && !tc[type]) tc[type] = 0;
    var types = Object.keys(tc).sort();
    var st = { list: [], rows: [], total: 0 };
    function compute() {
      var list = (q || type) ? b.vouchersIn(p.from, p.to, { q: q, type: type }) : inPeriod, rows = [], lastDate = 0, total = 0, n = list.length;
      list.forEach(function (v) { if (v.affects) total += v.total; });
      // Tally's Day Book runs oldest-first; the modern look keeps newest-first
      for (var k = 0; k < n; k++) {
        var v = list[classic ? k : n - 1 - k];
        if (v.date !== lastDate) { rows.push('<div class="date-head">' + fmtDateLong(v.date) + '</div>'); lastDate = v.date; }
        rows.push(voucherRow(v));
      }
      st.list = list; st.rows = rows; st.total = total;
    }
    function body() {
      var h = '<p class="small muted" id="vcount" style="margin:0 2px 8px">' + pluralize(st.list.length, 'voucher') + ' · affecting total ' + esc(cur(st.total)) + '</p>';
      if (!st.list.length) h += emptyState('vouchers', 'No vouchers match', (q || type) ? 'Try another search or voucher type.' : 'No vouchers in ' + S.period.label + '.', '<button class="btn" data-act="period">Change period</button>');
      else h += '<div class="list" id="vlist">' + st.rows.slice(0, PAGE).join('') + '</div>' + moreBtn('vmore', st.rows);
      return h;
    }
    compute();
    $view.innerHTML = '<div class="search"><input type="search" id="vsearch" aria-label="Search vouchers" placeholder="Search party, narration, number, ledger" value="' + esc(q) + '"></div>' +
      '<div class="filters"><select id="vtype" aria-label="Voucher type"><option value="">All types (' + NF0.format(inPeriod.length) + ')</option>' + types.map(function (t) { return '<option value="' + esc(t) + '"' + (t === type ? ' selected' : '') + '>' + esc(t) + ' (' + NF0.format(tc[t]) + ')</option>'; }).join('') + '</select></div>' +
      '<div id="vbody">' + body() + '</div>';
    pageMore('vmore', 'vlist', st.rows);
    var inp = document.getElementById('vsearch'), t;
    inp.oninput = function () {
      clearTimeout(t); var val = inp.value;
      t = setTimeout(function () {
        if (!document.contains(inp)) return;   // navigated away before the debounce fired: leave the new screen's hash alone
        q = val; if (S.route && S.route.q) S.route.q.q = q;
        history.replaceState(null, '', '#/vouchers?type=' + encodeURIComponent(type) + '&q=' + encodeURIComponent(q));
        compute();
        var vb = document.getElementById('vbody'); if (!vb) return;
        vb.innerHTML = body(); pageMore('vmore', 'vlist', st.rows);
        announce(pluralize(st.list.length, 'voucher') + ' match');
      }, 200);
    };
    document.getElementById('vtype').onchange = function () { go('#/vouchers?type=' + encodeURIComponent(this.value) + '&q=' + encodeURIComponent(q)); };
  };
  function voucherRow(v) {
    var who = v.party || (v.entries[0] ? v.entries[0].ledger : '');
    var flag = (v.cancelled ? ' · cancelled' : v.optional ? ' · optional' : v.superseded ? '' : !v.affects ? ' · no effect' : '') + (v.source === 'app' ? (v.superseded ? ' · app · in Tally' : v.posted ? ' · app · sent to Tally' : ' · app · pending') : '');
    return '<button class="row" data-voucher="' + v.idx + '"><span class="badge" data-base="' + esc(v.base || '') + '">' + esc(v.type) + '</span><div class="main"><div class="t">' + esc(who) + '</div><div class="s">' + fmtDate(v.date) + (v.number ? ' · #' + esc(v.number) : '') + flag + (v.narration ? ' · ' + esc(v.narration) : '') + '</div></div><div class="amt"><div class="v num">' + fmt(v.total) + '</div></div></button>';
  }

  SCREENS.voucher = function (r) {
    var b = S.book, v = b.vouchers[parseInt(r.arg, 10)];
    if (!v) { topbar({ title: 'Voucher', back: true }); $view.innerHTML = emptyState('vouchers', 'Voucher not found', 'It may have been removed or the data was reloaded.', '<button class="btn" data-go="vouchers">Day Book</button>'); return; }
    topbar({ title: v.type + (v.number ? ' #' + v.number : ''), sub: fmtDateLong(v.date), back: true });
    var h = '<div class="card"><div class="voucher-head"><div><div class="muted small">' + (v.party ? 'Party' : 'Voucher') + '</div><div style="font-weight:600">' + esc(v.party || v.type) + '</div></div><div style="text-align:right"><div class="muted small">Amount</div><div class="big num">' + esc(cur(v.total)) + '</div></div></div>';
    if (v.cancelled) h += '<div class="notice" style="margin-top:10px">Cancelled voucher – not counted in balances.</div>';
    else if (v.optional) h += '<div class="notice" style="margin-top:10px">Optional voucher – not counted in balances.</div>';
    else if (v.superseded) h += '<div class="notice" style="margin-top:10px">This app entry was matched to a voucher now in Tally – the Tally copy is counted, not this one.</div>';
    else if (!v.affects) h += '<div class="notice" style="margin-top:10px">' + esc(v.base) + ' – does not affect ledger balances.</div>';
    if (v.unbalanced) h += '<div class="notice" style="margin-top:10px">Entries do not balance by ' + fmt(v.unbalanced) + '. The export may be incomplete for this voucher.</div>';
    if (v.source === 'app' || v.fromApp) {
      h += '<div class="notice" style="margin-top:10px;background:var(--accent-soft);color:var(--text)">Entered in this app · ' + (v.fromApp || v.superseded ? 'in Tally · matched' : v.posted ? 'sent to Tally' : 'not yet in Tally') + (v.invoice && v.invoice.irn ? ' · IRN ' + esc(v.invoice.irn.slice(0, 12)) + '…' : '') + '</div>';
      h += TVF.voucherActions(v);
    }
    if (v.ref) h += '<div class="kv" style="margin-top:8px"><span class="muted">Reference</span><span>' + esc(v.ref) + '</span></div>';
    if (v.narration) h += '<div class="kv"><span class="muted">Narration</span><span>' + esc(v.narration) + '</span></div>';
    h += '</div>';
    h += '<div class="card"><h2>Ledger entries</h2><table class="tbl"><tr><th>Particulars</th><th class="n">Debit</th><th class="n">Credit</th></tr>';
    var dr = 0, cr = 0;
    v.entries.forEach(function (e) {
      if (e.amount < 0) dr += -e.amount; else cr += e.amount;
      h += '<tr><td><a href="#/ledger/' + encodeURIComponent(e.ledger) + '">' + esc(e.ledger) + '</a>' + (e.bills ? '<div class="small faint">' + e.bills.map(function (x) { return esc(x.type + ': ' + x.name); }).join(', ') + '</div>' : '') + '</td><td class="n">' + (e.amount < 0 ? money(-e.amount) : '') + '</td><td class="n">' + (e.amount > 0 ? money(e.amount) : '') + '</td></tr>';
    });
    h += '<tr class="total"><td>Total</td><td class="n">' + money(dr) + '</td><td class="n">' + money(cr) + '</td></tr></table></div>';
    if (v.items.length) {
      h += '<div class="card"><h2>Inventory</h2><table class="tbl"><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>';
      v.items.forEach(function (it) {
        h += '<tr><td>' + (b.stock[it.item] ? '<a href="#/stock/' + encodeURIComponent(it.item) + '">' + esc(it.item) + '</a>' : esc(it.item)) + (it.godown ? '<div class="small faint">' + esc(it.godown) + '</div>' : '') + '</td><td class="n">' + fmtQ(it.qty) + ' ' + esc(it.unit) + '</td><td class="n">' + (it.rate ? fmt(it.rate) : '') + '</td><td class="n">' + fmt(Math.abs(it.amount)) + '</td></tr>';
      });
      h += '</table></div>';
    }
    if (v.invoice) {
      var ci = TVEntry.computeInvoice(v.invoice);
      h += '<div class="card"><h2>Invoice items</h2><table class="tbl"><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th><th class="n">GST</th></tr>' + ci.items.map(function (it) { return '<tr><td>' + esc(it.desc) + '<div class="small faint">HSN ' + esc(it.hsn) + ' · ' + it.gstRate + '%</div></td><td class="n">' + it.qty + ' ' + esc(it.unit) + '</td><td class="n">' + fmt(it.rate) + '</td><td class="n">' + fmt(it.taxable) + '</td><td class="n">' + fmt(it.cgst + it.sgst + it.igst) + '</td></tr>'; }).join('') + '</table>' +
        '<div class="kv" style="margin-top:8px"><span>Buyer GSTIN</span><span>' + esc(v.invoice.buyer.gstin || '—') + '</span></div>' + (v.invoice.irn ? '<div class="kv"><span>IRN</span><span class="small" style="word-break:break-all">' + esc(v.invoice.irn) + '</span></div><div class="kv"><span>Ack</span><span>' + esc(v.invoice.ackNo) + ' · ' + esc(v.invoice.ackDate) + '</span></div>' : '') + '</div>';
    }
    $view.innerHTML = h;
    $view.querySelectorAll('[data-vact]').forEach(function (el) { el.onclick = function () {
      var a = el.getAttribute('data-vact');
      if (a === 'xml') TVApp.exportTallyXml([v]); else if (a === 'post') TVApp.postToTally([v]); else if (a === 'pdf') TVApp.exportInvoicePdf(v); else if (a === 'einv') TVApp.exportEInvoice(v); else if (a === 'irn') TVApp.enterIrn(v);
    }; });
  };

  /* ---- reports ------------------------------------------------------------ */
  var REPORTS = [
    ['tb', 'Trial Balance', 'Group-wise closing balances'], ['pl', 'Profit & Loss', 'Income and expenses for the period'], ['bs', 'Balance Sheet', 'As on period end'],
    ['receivables', 'Receivables', 'Sundry debtors outstanding'], ['payables', 'Payables', 'Sundry creditors outstanding'], ['cashbank', 'Cash & Bank', 'Cash and bank balances'],
    ['stock', 'Stock Summary', 'Item quantities in and out'], ['monthly', 'Monthly Summary', 'Sales, purchases, expenses by month'], ['register', 'Voucher Register', 'Counts and totals by voucher type']
  ];
  SCREENS.reports = function () {
    topbar({ title: 'Reports', sub: S.company.name, right: gearChip() });
    $view.innerHTML = TVF.reportSections();
  };
  SCREENS.report = function (r) {
    var fn = REPORT_FN[r.arg];
    if (!fn) { go('#/reports'); return; }
    var meta = REPORTS.filter(function (x) { return x[0] === r.arg; })[0];
    topbar({ title: meta[1], sub: dateRange(S.period.from, S.period.to), back: true });
    $view.innerHTML = TVF.reportActions(r.arg) + fn(S.book, S.period.from, S.period.to);
  };
  function groupNode(n, depth) {
    var h = '<details class="grp"' + (depth === 0 ? '' : '') + '><summary><span class="arrow">▶</span><span class="main">' + esc(n.name) + '</span><span class="amt">' + bal(n.closing) + '</span></summary><div class="inner">';
    n.groups.forEach(function (g) { h += groupNode(g, depth + 1); });
    n.ledgers.forEach(function (l) { h += ledgerRow(l.name, l.closing); });
    if (!n.groups.length && !n.ledgers.length) h += '<div class="row static small muted">No ledgers</div>';
    return h + '</div></details>';
  }
  // Split a trial-balance / balance-sheet difference (signed Σ closing, Cr positive) into the part that is
  // genuinely in the opening balances (Σ led.opening) and the rest (unclassified groups, unbalanced vouchers).
  function diffParts(b, net) {
    if (Math.abs(net) <= 0.01) return [];
    if (typeof b.openingDifference !== 'function') return [{ label: 'Difference in opening balances', amount: net }];
    var od = b.openingDifference(), rem = net - od, out = [];
    if (Math.abs(od) > 0.01) out.push({ label: 'Difference in opening balances', amount: od });
    if (Math.abs(rem) > 0.01) out.push({ label: 'Unclassified groups / unbalanced vouchers', amount: rem });
    return out;
  }
  var REPORT_FN = {
    tb: function (b, from, to) {
      var t = b.tree(from, to), dr = 0, cr = 0;
      function walk(n) { n.ledgers.forEach(function (l) { if (l.closing < 0) dr += -l.closing; else cr += l.closing; }); n.groups.forEach(walk); }
      t.roots.forEach(walk); t.primaryLedgers.forEach(function (l) { if (l.closing < 0) dr += -l.closing; else cr += l.closing; });
      var h = '<div class="list">' + t.roots.map(function (n) { return groupNode(n, 0); }).join('') + t.primaryLedgers.map(function (l) { return ledgerRow(l.name, l.closing, 'Primary'); }).join('') + '</div>';
      // the balancing figure sits on the side opposite to the excess (credits exceed debits → shown as Dr)
      var parts = diffParts(b, cr - dr).map(function (x) { return '<div class="kv dr"><span>' + x.label + '</span><span class="num">' + fmt(Math.abs(x.amount)) + ' ' + (x.amount > 0 ? 'Dr' : 'Cr') + '</span></div>'; }).join('');
      h += '<div class="card"><div class="kv"><span>Total debit</span><span class="num">' + fmt(dr) + '</span></div><div class="kv"><span>Total credit</span><span class="num">' + fmt(cr) + '</span></div>' + parts + '</div>';
      return h;
    },
    pl: function (b, from, to) {
      var t = b.tree(from, to);
      function g(name) { return t.byName[name] || { name: name, closing: 0, debit: 0, credit: 0, groups: [], ledgers: [] }; }
      function mv(n, sign) { return sign * (n.credit - n.debit); }
      var sales = g('Sales Accounts'), purch = g('Purchase Accounts'), di = g('Direct Incomes'), de = g('Direct Expenses'), ii = g('Indirect Incomes'), ie = g('Indirect Expenses');
      var otherI = t.roots.filter(function (n) { return n.nature === 'I' && ['Sales Accounts', 'Direct Incomes', 'Indirect Incomes'].indexOf(n.name) === -1; });
      var otherE = t.roots.filter(function (n) { return n.nature === 'E' && ['Purchase Accounts', 'Direct Expenses', 'Indirect Expenses'].indexOf(n.name) === -1; });
      var gp = mv(sales, 1) + mv(di, 1) + mv(purch, 1) + mv(de, 1);
      var np = gp + mv(ii, 1) + mv(ie, 1);
      otherI.concat(otherE).forEach(function (n) { np += mv(n, 1); });
      function line(n, label) { var m = n.credit - n.debit; return '<details class="grp"><summary><span class="arrow">▶</span><span class="main">' + esc(label || n.name) + '</span><span class="amt num">' + fmt(Math.abs(m)) + '</span></summary><div class="inner">' + n.groups.map(function (x) { return groupNode(x, 1); }).join('') + n.ledgers.map(function (l) { return ledgerRow(l.name, l.credit - l.debit); }).join('') + '</div></details>'; }
      function total(label, v, strong) { return '<div class="row static"><div class="main"><div class="t" style="font-weight:' + (strong ? 700 : 600) + '">' + label + '</div></div><div class="amt"><div class="v num ' + (v < 0 ? 'dr' : 'cr') + '">' + fmt(Math.abs(v)) + (v < 0 ? ' loss' : '') + '</div></div></div>'; }
      var h = '<div class="section-title">Trading account</div><div class="list">' + line(sales) + line(di) + line(purch) + line(de) + total('Gross profit', gp, true) + '</div>';
      h += '<div class="section-title">Income statement</div><div class="list">' + line(ii) + line(ie) + otherI.concat(otherE).map(function (n) { return line(n); }).join('') + total('Net profit (before stock)', np, true) + '</div>';
      var adj = stockAdj(b, from, to);
      h += '<p class="small muted">Movement for the period only. Opening and closing stock are not included, so where stock changes materially Tally\'s figure will differ.' +
        (adj ? ' Estimated stock (' + esc(adj.method || 'weighted average') + '): opening ' + esc(cur(adj.opening)) + ', closing ' + esc(cur(adj.closing)) + (Math.abs(adj.delta) >= 1 ? '. Net profit after stock adjustment: ' + esc(cur(Math.abs(np + adj.delta))) + (np + adj.delta < 0 ? ' loss' : '') + '.' : ' – no change in stock value this period, so the figure above stands.') : '') +
        ' <a href="#/report/stock">Stock Summary ›</a></p>';
      return h;
    },
    bs: function (b, from, to) {
      var t = b.tree(from, to);
      var liab = t.roots.filter(function (n) { return n.nature === 'L'; }), assets = t.roots.filter(function (n) { return n.nature === 'A'; }), unknown = t.roots.filter(function (n) { return n.nature === 'U'; });
      var plLedger = 0, plOther = [];
      t.primaryLedgers.forEach(function (l) { if (l.nature === 'P') plLedger += l.closing; else plOther.push(l); });
      // revenue roots: closing is cumulative since books began; credit − debit is the period's own movement
      var revenue = 0, plCur = 0; t.roots.forEach(function (n) { if (n.nature === 'I' || n.nature === 'E') { revenue += n.closing; plCur += n.credit - n.debit; } });
      var pl = plLedger + revenue, plOpen = pl - plCur;
      var L = 0, A = 0;
      liab.forEach(function (n) { L += n.closing; }); assets.forEach(function (n) { A += -n.closing; });
      plOther.forEach(function (l) { if (l.closing > 0) L += l.closing; else A += -l.closing; });
      L += pl;
      var diff = L - A, parts = diffParts(b, diff);
      function diffRow(x) { return '<div class="row static"><div class="main"><div class="t dr">' + x.label + '</div></div><div class="amt"><div class="v num">' + fmt(Math.abs(x.amount)) + '</div></div></div>'; }
      var h = '<div class="bs-cols"><div><div class="section-title">Liabilities</div><div class="list">' + liab.map(function (n) { return groupNode(n, 0); }).join('') +
        '<div class="row static"><div class="main"><div class="t">Profit &amp; Loss A/c</div><div class="s">Opening ' + fmt(Math.abs(plOpen)) + (plOpen < 0 ? ' (loss)' : '') + ' + current period ' + fmt(Math.abs(plCur)) + (plCur < 0 ? ' (loss)' : '') + '</div></div><div class="amt"><div class="v">' + bal(pl) + '</div></div></div>' +
        plOther.filter(function (l) { return l.closing > 0; }).map(function (l) { return ledgerRow(l.name, l.closing); }).join('') +
        parts.filter(function (x) { return x.amount < 0; }).map(diffRow).join('') +
        '<div class="row static"><div class="main"><div class="t" style="font-weight:700">Total</div></div><div class="amt"><div class="v num">' + fmt(Math.max(L, A)) + '</div></div></div></div></div>';
      h += '<div><div class="section-title">Assets</div><div class="list">' + assets.map(function (n) { return groupNode(n, 0); }).join('') +
        plOther.filter(function (l) { return l.closing < 0; }).map(function (l) { return ledgerRow(l.name, l.closing); }).join('') +
        parts.filter(function (x) { return x.amount > 0; }).map(diffRow).join('') +
        '<div class="row static"><div class="main"><div class="t" style="font-weight:700">Total</div></div><div class="amt"><div class="v num">' + fmt(Math.max(L, A)) + '</div></div></div></div></div></div>';
      if (unknown.length) h += '<div class="section-title">Unclassified groups</div><div class="list">' + unknown.map(function (n) { return groupNode(n, 0); }).join('') + '</div><p class="small muted">These groups are not under a standard Tally primary group. Load the masters (Tally data folder or Master.xml) so they can be classified.</p>';
      return h;
    },
    receivables: function (b, from, to) { return partyReport(b.summary(from, to).debtors, 'debtor', to); },
    payables: function (b, from, to) { return partyReport(b.summary(from, to).creditors, 'creditor', to); },
    cashbank: function (b, from, to) {
      var rows = [], total = 0;
      b.ledgerNames.forEach(function (n) {
        var led = b.ledgers[n];
        if (ledgerMatchesFilter(led, 'cashbank')) { var bl = b.ledgerBalance(n, from, to); total += -bl.closing; rows.push(ledgerRow(n, bl.closing, led.parent)); }
      });
      return (rows.length ? '<div class="list">' + rows.join('') + '</div>' : emptyState('bank', 'No cash or bank ledgers', 'Load the masters so Cash-in-Hand and Bank Accounts can be grouped.', '')) + '<div class="card"><div class="kv"><span>Net cash &amp; bank</span><span class="num">' + fmt(total) + '</span></div></div>';
    },
    stock: function (b, from, to) {
      var items = b.stockSummary(from, to);
      if (!items.length) return emptyState('vouchers', 'No stock items', 'No stock items or inventory vouchers have been loaded.', '');
      return '<div class="list">' + items.map(function (it) {
        return '<button class="row" data-stock="' + esc(it.name) + '"><div class="main"><div class="t">' + esc(it.name) + '</div><div class="s">in ' + fmtQ(it.inward) + ' · out ' + fmtQ(it.outward) + (it.group ? ' · ' + esc(it.group) : '') + '</div></div><div class="amt"><div class="v num' + (it.closing < 0 ? ' abn' : '') + '">' + fmtQ(it.closing) + ' ' + esc(it.unit) + '</div><div class="s">closing</div></div><span class="chev">›</span></button>';
      }).join('') + '</div><p class="small muted">Quantities only. Opening from masters plus inward minus outward for the period\'s vouchers. Negative closing usually means older vouchers were not loaded.</p>';
    },
    monthly: function (b, from, to) {
      var m = b.monthly(from, to);
      if (!m.length) return emptyState('report', 'No activity in this period', 'Pick another period to see month-wise figures.', '<button class="btn" data-act="period">Change period</button>');
      var ts = 0, tp = 0, te = 0, tc = 0;
      var h = '<div class="card scroll" style="overflow:auto"><table class="tbl"><tr><th>Month</th><th class="n">Sales</th><th class="n">Purchases</th><th class="n">Expenses</th><th class="n">Vch</th></tr>';
      m.forEach(function (x) { ts += x.sales; tp += x.purchases; te += x.expenses; tc += x.count; h += '<tr><td>' + fmtMonth(x.month) + '</td><td class="n">' + fmt(x.sales) + '</td><td class="n">' + fmt(x.purchases) + '</td><td class="n">' + fmt(x.expenses) + '</td><td class="n">' + x.count + '</td></tr>'; });
      h += '<tr class="total"><td>Total</td><td class="n">' + fmt(ts) + '</td><td class="n">' + fmt(tp) + '</td><td class="n">' + fmt(te) + '</td><td class="n">' + tc + '</td></tr></table></div>';
      return h;
    },
    register: function (b, from, to) {
      var byType = {};
      b.vouchersIn(from, to).forEach(function (v) { var x = byType[v.type] || (byType[v.type] = { n: 0, total: 0 }); x.n++; x.total += v.total; });
      var keys = Object.keys(byType).sort();
      if (!keys.length) return emptyState('vouchers', 'No vouchers in this period', '', '<button class="btn" data-act="period">Change period</button>');
      return '<div class="list">' + keys.map(function (k) { return '<a class="row" href="#/vouchers?type=' + encodeURIComponent(k) + '"><div class="main"><div class="t">' + esc(k) + '</div><div class="s">' + esc(b.baseType(k)) + ' · ' + pluralize(byType[k].n, 'voucher') + '</div></div><div class="amt"><div class="v num">' + fmt(byType[k].total) + '</div></div><span class="chev">›</span></a>'; }).join('') + '</div>';
    }
  };
  function partyReport(list, kind, to) {
    if (!list.length) return emptyState('receivable', 'No ' + kind + 's with a balance', 'Nothing outstanding as on ' + fmtDate(to) + '.', '<button class="btn" data-act="period">Change period</button>');
    var out = 0, opp = 0, main = [], other = [];
    list.forEach(function (d) { var isMain = kind === 'debtor' ? d.closing < 0 : d.closing > 0; if (isMain) { out += Math.abs(d.closing); main.push(d); } else { opp += Math.abs(d.closing); other.push(d); } });
    var h = '<div class="card"><div class="kv"><span>' + (kind === 'debtor' ? 'Total receivable' : 'Total payable') + '</span><span class="num" style="font-weight:700">' + fmt(out) + '</span></div><div class="kv"><span>' + pluralize(main.length, 'party') + ' as on ' + fmtDate(to) + '</span><span></span></div></div>';
    h += '<div class="list">' + main.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div>';
    if (other.length) h += '<div class="section-title">' + (kind === 'debtor' ? 'Debtors with credit balance' : 'Creditors with debit balance') + ' · ' + fmt(opp) + '</div><div class="list">' + other.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div>';
    S.lastPartyList = main.concat(other).map(function (d) { return d.name; });
    h += exportButtons(kind === 'debtor' ? 'receivables' : 'payables');
    return h;
  }

  SCREENS.stock = function (r) {
    var b = S.book, name = r.arg, it = b.stock[name];
    if (!it) { go('#/report/stock'); return; }
    var m = b.stockMoves(name, S.period.from, S.period.to);
    topbar({ title: name, sub: it.group || 'Stock item', back: true });
    var h = '<div class="tiles"><div class="tile"><div class="label">Opening</div><div class="value num" style="font-size:16px">' + fmtQ(m.opening) + ' ' + esc(it.unit) + '</div></div><div class="tile"><div class="label">Closing</div><div class="value num' + (m.closing < 0 ? ' abn' : '') + '" style="font-size:16px">' + fmtQ(m.closing) + ' ' + esc(it.unit) + '</div></div></div>';
    if (m.rows.length) h += '<div class="list">' + m.rows.slice().reverse().map(function (x) { var v = x.voucher; return '<button class="row" data-voucher="' + v.idx + '"><div class="main"><div class="t">' + esc(v.party || v.type) + '</div><div class="s">' + fmtDate(x.date) + ' · ' + esc(v.type) + (v.number ? ' #' + esc(v.number) : '') + '</div></div><div class="amt"><div class="v num">' + (x.qty > 0 ? '+' : '') + fmtQ(x.qty) + '</div><div class="s">bal ' + fmtQ(x.balance) + '</div></div></button>'; }).join('') + '</div>';
    else h += '<div class="empty small">No movement in this period.</div>';
    $view.innerHTML = h;
  };

  /* ---- more --------------------------------------------------------------- */
  function pendingCount(b) { return b ? b.vouchers.filter(function (v) { return v.source === 'app' && !v.posted && !v.superseded; }).length : 0; }
  SCREENS.more = function () {
    topbar({ title: 'More', period: false });
    var c = S.company, b = S.book, h = '';
    if (c && b) {
      var ci = c.info || {};
      h += '<div class="card"><h2>Current company</h2><div class="kv"><span>Name</span><span><b>' + esc(c.name) + '</b></span></div>' +
        (ci.booksFrom ? '<div class="kv"><span>Books from</span><span>' + fmtDateLong(ci.booksFrom) + '</span></div>' : '') +
        (ci.pan ? '<div class="kv"><span>PAN</span><span>' + esc(ci.pan) + '</span></div>' : '') +
        (ci.address ? '<div class="kv"><span>Address</span><span>' + esc(ci.address) + (ci.pin ? ' - ' + esc(ci.pin) : '') + '</span></div>' : '') +
        (ci.tallyVersion ? '<div class="kv"><span>Data from</span><span>' + esc(ci.tallyVersion) + '</span></div>' : '') +
        '<div class="kv"><span>Data range</span><span>' + (b.minDate ? dateRange(b.minDate, b.maxDate) : '–') + '</span></div>' +
        (b.data.snapshotAt ? '<div class="kv"><span>Folder loaded</span><span>' + fmtStamp(b.data.snapshotAt) + '</span></div>' : '') +
        '<div class="kv"><span>Vouchers</span><span>' + NF0.format(b.vouchers.length) + '</span></div><div class="kv"><span>Ledgers / groups</span><span>' + NF0.format(Object.keys(b.data.ledgers).length) + ' / ' + NF0.format(Object.keys(b.data.groups).length) + '</span></div>' +
        '<div class="kv"><span>Stock items</span><span>' + NF0.format(Object.keys(b.data.stockItems).length) + '</span></div>' +
        '<div class="btn-row"><button class="btn" data-go="import">' + ICONS.folder + ' Load more data</button><button class="btn" data-act="rename">Rename</button><button class="btn danger" data-act="delete">Delete company</button></div></div>';
      if (b.data.files.length) h += '<div class="card"><h2>Loaded files</h2>' + b.data.files.slice().reverse().slice(0, 10).map(function (f) { var vc = f.counts.vouchers; return '<div class="kv"><span>' + esc(f.name) + '<div class="small faint">' + fmtStamp(f.at) + '</div></span><span class="small muted">' + [vc.added + vc.updated ? (vc.added + vc.updated) + ' vch' : '', f.counts.ledgers.added + f.counts.ledgers.updated ? (f.counts.ledgers.added + f.counts.ledgers.updated) + ' ledgers' : '', vc.matched ? vc.matched + ' matched' : ''].filter(Boolean).join(', ') + '</span></div>'; }).join('') + '</div>';
    }
    var pend = pendingCount(b);
    h += '<div class="list"><button class="row" data-go="companies"><div class="main"><div class="t">Companies</div><div class="s">' + pluralize(S.companies.length, 'company') + ' on this phone</div></div><span class="chev">›</span></button>' +
      TVF.moreRows() +
      '<button class="row" data-go="pending"><div class="main"><div class="t">Entries made in app</div><div class="s">' + (b ? pluralize(pend, 'entry').replace('entrys', 'entries') + ' not yet in Tally' : '') + '</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="gst"><div class="main"><div class="t">Company GST details</div><div class="s">GSTIN, address and default ledgers for invoices and e-invoices</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="sync"><div class="main"><div class="t">Sync from Tally over Wi-Fi</div><div class="s">Pull masters and vouchers straight from TallyPrime</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="import"><div class="main"><div class="t">Open Tally data folder / XML files</div><div class="s">Reads Manager.1800, TranMgr.1800, Company.1800 directly</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="help"><div class="main"><div class="t">Setup guide</div><div class="s">Copying the data folder, Wi-Fi sync, XML export</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-act="ui"><div class="main"><div class="t">Look</div><div class="s">' + (lsGet('tv.ui', 'modern') === 'classic' ? 'Classic Tally · tap to switch to the modern look' : 'Modern · tap to switch to the classic Tally look') + '</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-act="theme"><div class="main"><div class="t">Theme</div><div class="s">' + esc(lsGet('tv.theme', 'dark')) + '</div></div><span class="chev">›</span></button></div>';
    h += '<p class="small faint" style="text-align:center">Tally Viewer ' + esc(VERSION) + ' · offline · all data stays in this browser\'s storage<span id="storage"></span></p>';
    $view.innerHTML = h;
    TVDB.estimate().then(function (e) { if (e && e.usage) { var st = document.getElementById('storage'); if (st) st.textContent = ' · ' + (e.usage / 1048576).toFixed(1) + ' MB used'; } }).catch(function () { /* ignore */ });
  };

  /* ---- sheets ------------------------------------------------------------- */
  // Bottom sheets are dialogs: role/aria-modal, a Close button, focus moved in and restored on close,
  // the page beneath made inert, Escape closes the top one. bg.remove() is overridden per instance so
  // every existing bg.remove() call in any module closes the sheet properly.
  var openSheets = [], sheetSeq = 0;
  function setInert(on) {
    ['top', 'view', 'nav'].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); } else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }
  function sheet(html, onClick) {
    var bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><button class="x sheet-close" data-close aria-label="Close">✕</button>' + html + '</div>';
    var sh = bg.firstChild, h3 = sh.querySelector('h3');
    if (h3) { if (!h3.id) h3.id = 'sheet-h' + (++sheetSeq); sh.setAttribute('aria-labelledby', h3.id); }
    var prevFocus = document.activeElement, closed = false;
    bg.remove = function () {
      if (closed) return; closed = true;
      var i = openSheets.indexOf(bg); if (i !== -1) openSheets.splice(i, 1);
      Element.prototype.remove.call(bg);
      if (!openSheets.length) setInert(false);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus) && !(document.body.classList.contains('locked'))) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };
    bg.addEventListener('click', function (ev) {
      if (ev.target === bg || ev.target.closest('[data-close]')) { bg.remove(); return; }
      if (onClick) onClick(ev, bg);
    });
    document.body.appendChild(bg);
    openSheets.push(bg);
    setInert(true);
    var first = sh.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.sheet-close), a[href], [tabindex]:not([tabindex="-1"])') || sh.querySelector('.sheet-close');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    return bg;
  }
  function closeSheets() {
    while (openSheets.length) openSheets[openSheets.length - 1].remove();
    document.querySelectorAll('.sheet-bg').forEach(function (el) { el.remove(); });
    setInert(false);
  }
  function periodSheet() {
    var b = S.book, cur = S.period, h = '<h3>Period</h3>';
    var opts = b.periods().concat([{ from: b.minDate || 20000401, to: b.maxDate || 20991231, label: 'All data' }]);
    var now = new Date(), tmk = now.getFullYear() * 100 + (now.getMonth() + 1);
    opts.unshift({ from: tmk * 100 + 1, to: monthEnd(tmk), label: 'This month' });
    if (b.maxDate) { var lmk = Math.floor(b.maxDate / 100); opts.unshift({ from: lmk * 100 + 1, to: monthEnd(lmk), label: 'Last month with data (' + fmtMonth(lmk) + ')' }); }
    h += opts.map(function (o, i) { return '<button class="opt ' + (cur.from === o.from && cur.to === o.to ? 'on' : '') + '" data-i="' + i + '"' + (cur.from === o.from && cur.to === o.to ? ' aria-current="true"' : '') + '>' + esc(o.label) + ' <span class="faint small">' + esc(dateRange(o.from, o.to)) + '</span></button>'; }).join('');
    h += '<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px"><div class="field"><label for="pfrom">From</label><input type="date" id="pfrom" value="' + toISO(cur.from) + '"></div><div class="field"><label for="pto">To</label><input type="date" id="pto" value="' + toISO(cur.to) + '"></div><button class="btn primary block" id="papply">Apply custom period</button></div>';
    sheet(h, function (ev, bg) {
      var o = ev.target.closest('.opt');
      if (o) { bg.remove(); setPeriod(opts[parseInt(o.getAttribute('data-i'), 10)]); return; }
      if (ev.target.id === 'papply') {
        var f = fromISO(document.getElementById('pfrom').value), t = fromISO(document.getElementById('pto').value);
        if (!f || !t || f > t) { toast('Pick a valid from/to'); return; }
        bg.remove(); setPeriod({ from: f, to: t, label: dateRange(f, t) });
      }
    });
  }
  function companySheet() {
    var h = '<h3>Switch company</h3>' + S.companies.map(function (c) { return '<button class="opt ' + (S.company && S.company.id === c.id ? 'on' : '') + '" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>'; }).join('') + '<button class="opt" data-id="__manage">Manage companies…</button>';
    sheet(h, function (ev, bg) {
      var o = ev.target.closest('.opt'); if (!o) return;
      bg.remove();
      var id = o.getAttribute('data-id');
      if (id === '__manage') { go('#/companies'); return; }
      S.book = null; S.company = null;
      selectCompany(id).then(function () { if (S.route.name === 'home') render(); else go('#/home'); });
    });
  }
  function themeSheet() {
    var cur = lsGet('tv.theme', 'dark');
    sheet('<h3>Theme</h3>' + ['dark', 'light', 'auto'].map(function (t) { return '<button class="opt ' + (cur === t ? 'on' : '') + '" data-t="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</button>'; }).join(''), function (ev, bg) {
      var o = ev.target.closest('.opt'); if (!o) return;
      bg.remove(); lsSet('tv.theme', o.getAttribute('data-t')); applyTheme(); render();
    });
  }
  // why the headline says "before stock": the ledgers alone cannot value opening/closing stock the way Tally's P&L does
  function stockInfoSheet() {
    var b = S.book, p = S.period, adj = b ? stockAdj(b, p.from, p.to) : null, s = b ? b.summary(p.from, p.to) : null;
    var h = '<h3>Profit before stock</h3>' +
      '<p>This figure is income minus expenses for the period, taken from the ledgers alone. TallyPrime\'s Profit &amp; Loss also adds opening stock and deducts closing stock, so where stock changes materially Tally\'s net profit will differ – by the full change in inventory.</p>';
    if (adj && s) h += '<p>Estimated from the stock items loaded (' + esc(adj.method || 'weighted average') + ' rate): opening stock ' + esc(cur(adj.opening)) + ', closing stock ' + esc(cur(adj.closing)) + '. ' + (Math.abs(adj.delta) >= 1 ? 'After this adjustment: <b>' + esc(cur(Math.abs(s.netProfit + adj.delta))) + (s.netProfit + adj.delta < 0 ? ' loss' : ' profit') + '</b>.' : 'Stock value did not change in this period, so the adjustment is nil.') + ' Treat it as an estimate; Tally uses the valuation method set per item.</p>';
    else h += '<p class="small muted">Stock values could not be estimated from the loaded data (items carry no rates or values), so only the before-stock figure is shown.</p>';
    h += '<a class="btn block" href="#/report/stock">Open Stock Summary</a>';
    sheet(h);
  }
  function applyTheme() {
    var t = lsGet('tv.theme', 'dark');
    if (t === 'auto') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#07080B');
    if (window.TVClassic) TVClassic.apply();
    // Android shell: paint the system bars to match and pick dark/light status icons
    if (window.TallyBridge && typeof window.TallyBridge.setChrome === 'function') {
      try {
        var bgc = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#07080B';
        var lightBars = t === 'light' || !!(window.TVClassic && TVClassic.on());
        window.TallyBridge.setChrome(/^#[0-9a-fA-F]{6}$/.test(bgc) ? bgc : (lightBars ? '#F2F3F6' : '#07080B'), lightBars);
      } catch (e) { /* ignore */ }
    }
  }

  /* ---- global events ------------------------------------------------------ */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-go],[data-act],[data-ledger],[data-voucher],[data-company],[data-stock],[data-export]');
    if (!el) return;
    if (el.hasAttribute('data-export')) { var ex = el.getAttribute('data-export').split(':'); try { runExport(ex[0], ex[1]); } catch (e) { toast('Export failed: ' + e.message, 5000); } return; }
    if (el.hasAttribute('data-go')) { ev.preventDefault(); go('#/' + el.getAttribute('data-go')); return; }
    if (el.hasAttribute('data-ledger')) { go('#/ledger/' + encodeURIComponent(el.getAttribute('data-ledger'))); return; }
    if (el.hasAttribute('data-voucher')) { go('#/voucher/' + el.getAttribute('data-voucher')); return; }
    if (el.hasAttribute('data-stock')) { go('#/stock/' + encodeURIComponent(el.getAttribute('data-stock'))); return; }
    if (el.hasAttribute('data-company')) { var id = el.getAttribute('data-company'); S.book = null; S.company = null; selectCompany(id).then(function () { go('#/home'); }); return; }
    var act = el.getAttribute('data-act');
    if (act === 'back') { if (history.length > 1) history.back(); else go('#/home'); }
    else if (act === 'period') periodSheet();
    else if (act === 'newentry') TVApp.newEntrySheet();
    else if (act === 'company') companySheet();
    else if (act === 'theme') themeSheet();
    else if (act === 'stockinfo') stockInfoSheet();
    else if (act === 'rename') {
      var name = prompt('Company name', S.company.name);
      if (name && name.trim()) { S.company.name = name.trim(); S.company.updatedAt = Date.now(); TVDB.putCompany(S.company).then(loadCompanies).then(render); }
    } else if (act === 'delete') {
      var pend = pendingCount(S.book);
      if (confirm('Delete "' + S.company.name + '" and all its data from this phone?' + (pend ? ' ' + pluralize(pend, 'entry').replace('entrys', 'entries') + ' made in this app ' + (pend === 1 ? 'is' : 'are') + ' not yet in Tally and will be lost.' : '') + ' This cannot be undone.')) {
        var cid = S.company.id;
        TVDB.deleteCompany(cid).then(function () { S.company = null; S.book = null; S.draft = null; S.inv = null; curCompanyId = null; ['tv.period.', 'tv.draft.', 'tv.inv.', 'tv.pins.', 'tv.recentLedgers.'].forEach(function (k) { try { localStorage.removeItem(k + cid); } catch (e) { /* ignore */ } }); localStorage.removeItem('tv.company'); return loadCompanies(); }).then(function () { toast('Company deleted'); go('#/companies'); });
      }
    }
  });
  // Escape closes the top sheet in both skins (capture phase, so classic.js's own Escape handler does not also go back);
  // Enter/Space activate the role=button title (company switcher) for keyboard users
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && openSheets.length) { ev.preventDefault(); ev.stopPropagation(); openSheets[openSheets.length - 1].remove(); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute && ev.target.getAttribute('role') === 'button' && ev.target.hasAttribute('data-act') && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); ev.target.click(); }
  }, true);
  window.addEventListener('hashchange', render);

  /* ---- Android shell hooks ------------------------------------------------ */
  // Back: true when handled here (a sheet was closed, or the PIN lock is showing so back is swallowed)
  window.TVBack = function () {
    var lock = document.querySelector('.lock');
    if (lock && (document.body.classList.contains('locked') || lock.getClientRects().length)) return true;
    if (openSheets.length) { openSheets[openSheets.length - 1].remove(); return true; }
    var stray = document.querySelector('.sheet-bg'); if (stray) { stray.remove(); setInert(false); return true; }
    return false;
  };
  // Resume: the lock module decides whether enough time has passed to ask for the PIN again
  window.TVRelock = function () { if (window.TVF && typeof TVF.relock === 'function') TVF.relock(); };

  /* ---- bridge for entryui.js ---------------------------------------------- */
  window.TVApp = { S: S, SCREENS: SCREENS, NEEDS_BOOK: NEEDS_BOOK, REPORTS: REPORTS, REPORT_FN: REPORT_FN, ICONS: ICONS, VERSION: VERSION, topbar: topbar, toast: toast, announce: announce, go: go, esc: esc, fmt: fmt, fmtQ: fmtQ, fmtDate: fmtDate, fmtDateLong: fmtDateLong, fmtMonth: fmtMonth, dateRange: dateRange, cur: cur, monthEnd: monthEnd, toISO: toISO, fromISO: fromISO, sheet: sheet, closeSheets: closeSheets, emptyState: emptyState, isClassic: isClassic, lsGet: lsGet, lsSet: lsSet, uid: uid, pluralize: pluralize, bal: bal, money: money, drcr: drcr, compact: compact, periodLabel: periodLabel, exportName: exportName, ledgerRow: ledgerRow, voucherRow: voucherRow, buildLedgerExport: buildLedgerExport, afterSave: afterSave, tallyRequest: tallyRequest, hasBridge: hasBridge, loadCompanies: loadCompanies, selectCompany: selectCompany, render: render, applyTheme: applyTheme, $view: function () { return $view; } };

  /* ---- boot --------------------------------------------------------------- */
  function boot() {
    $view = document.getElementById('view'); $top = document.getElementById('top'); $nav = document.getElementById('nav');
    applyTheme();
    if (window.TVF) TVF.showLock();
    window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; toast('Error: ' + (r && r.message || r), 5000); });
    loadCompanies().then(function () {
      if (!location.hash || location.hash === '#/' ) location.hash = S.companies.length ? '#/home' : '#/companies';
      render();
    }).catch(function (e) { $view.innerHTML = '<div class="empty">Storage unavailable: ' + esc(e.message) + '<br><span class="small">Private/incognito mode may block IndexedDB.</span></div>'; });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      if (/TallyViewerApp\//.test(navigator.userAgent)) {
        // the APK serves its own bundled files: a service worker would only duplicate them and run stale code after an update
        navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () { /* ignore */ });
      } else {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
          reg.addEventListener('updatefound', function () {
            var nw = reg.installing;
            nw && nw.addEventListener('statechange', function () {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready', 0, { action: { label: 'Reload', fn: function () { location.reload(); } } });
            });
          });
        }).catch(function () { /* offline install unavailable */ });
      }
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
