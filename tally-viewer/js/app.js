/* Tally Viewer – UI, routing, import. Depends on tallyparse.js (via worker), model.js, db.js */
(function () {
  'use strict';
  var Book = TVModel.Book;
  var S = { companies: [], company: null, book: null, period: null, route: null, jobs: [], loading: false };
  var $view, $top, $nav, worker = null;

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
  function fmtDate(d) { if (!d) return ''; var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + ' ' + (MON[m - 1] || m) + ' ' + String(y).slice(2); }
  function fmtDateLong(d) { if (!d) return ''; var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + ' ' + (MON[m - 1] || m) + ' ' + y; }
  function fmtMonth(mk) { return (MON[(mk % 100) - 1] || '') + ' ' + String(Math.floor(mk / 100)).slice(2); }
  function toISO(d) { return Math.floor(d / 10000) + '-' + String(Math.floor(d / 100) % 100).padStart(2, '0') + '-' + String(d % 100).padStart(2, '0'); }
  function fromISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? parseInt(m[1] + m[2] + m[3], 10) : 0; }
  // signed balance → "1,00,000.00 Dr"
  function bal(n, cls) {
    if (Math.abs(n) < 0.005) return '<span class="num faint">0.00</span>';
    return '<span class="num ' + (cls === false ? '' : (n < 0 ? 'dr' : 'cr')) + '">' + fmt(Math.abs(n)) + ' ' + (n < 0 ? 'Dr' : 'Cr') + '</span>';
  }
  function money(n) { return '<span class="num">' + fmt(n) + '</span>'; }
  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }
  function go(hash) { location.hash = hash; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pluralize(n, w) { return n + ' ' + (n === 1 ? w : (/y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's')); }

  /* ---- state -------------------------------------------------------------- */
  function loadCompanies() { return TVDB.listCompanies().then(function (list) { S.companies = list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); return list; }); }

  function selectCompany(id) {
    if (S.company && S.company.id === id && S.book) return Promise.resolve(S.book);
    var c = null;
    for (var i = 0; i < S.companies.length; i++) if (S.companies[i].id === id) c = S.companies[i];
    if (!c) { S.company = null; S.book = null; return Promise.resolve(null); }
    S.loading = true;
    return TVDB.getData(id).then(function (data) {
      S.company = c; S.book = new Book(data || TVModel.emptyData(id));
      lsSet('tv.company', id);
      S.period = defaultPeriod(S.book, lsGet('tv.period.' + id, null));
      S.loading = false;
      return S.book;
    });
  }
  function defaultPeriod(book, saved) {
    if (saved && saved.from && saved.to) return saved;
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

  function render() {
    var r = parseHash(); S.route = r;
    if (NEEDS_BOOK[r.name] && !S.book) {
      if (!S.companies.length) { r = S.route = { name: 'companies', arg: '', q: {} }; }
      else { var id = lsGet('tv.company', S.companies[0].id); selectCompany(id).then(function (b) { if (!b) return selectCompany(S.companies[0].id); }).then(render); return; }
    }
    var fn = SCREENS[r.name] || SCREENS.home;
    window.scrollTo(0, 0);
    fn(r);
    renderNav(r);
  }

  function topbar(opts) {
    var h = '<div class="topbar-row">';
    if (opts.back) h += '<button class="back" data-act="back" aria-label="Back">‹</button>';
    h += '<div class="title"><h1>' + esc(opts.title) + '</h1>' + (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>';
    if (opts.period !== false && S.book) h += '<button class="chip" data-act="period">' + esc(S.period.label) + '</button>';
    if (opts.right) h += opts.right;
    h += '</div>' + (opts.extra || '');
    $top.innerHTML = h;
  }
  var NAV = [
    ['home', 'Home', '<svg viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg>'],
    ['ledgers', 'Ledgers', '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5"/></svg>'],
    ['vouchers', 'Day Book', '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6"/></svg>'],
    ['reports', 'Reports', '<svg viewBox="0 0 24 24"><path d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2"/></svg>'],
    ['more', 'More', '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>']
  ];
  function renderNav(r) {
    var cur = r.name === 'ledger' ? 'ledgers' : r.name === 'voucher' ? 'vouchers' : (r.name === 'report' || r.name === 'stock') ? 'reports' : (r.name === 'companies' || r.name === 'import' || r.name === 'help' || r.name === 'sync') ? 'more' : r.name;
    $nav.innerHTML = NAV.map(function (n) { return '<button data-go="' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '">' + n[2] + '<span>' + n[1] + '</span></button>'; }).join('');
  }

  /* ---- screens ------------------------------------------------------------ */
  var SCREENS = {};

  SCREENS.companies = function () {
    topbar({ title: 'Companies', period: false });
    var h = '';
    if (!S.companies.length) {
      h += '<div class="empty"><div class="big">📒</div><p><b>No company data yet.</b></p><p class="small" style="margin-top:6px">Export your masters and vouchers from TallyPrime as XML, copy the files to this phone, then import them here. Everything stays on this device.</p></div>';
    } else {
      h += '<div class="list">' + S.companies.map(function (c) {
        return '<button class="row" data-company="' + esc(c.id) + '"><div class="main"><div class="t">' + esc(c.name) + '</div><div class="s">' +
          pluralize(c.counts ? c.counts.vouchers : 0, 'voucher') + ' · ' + pluralize(c.counts ? c.counts.ledgers : 0, 'ledger') +
          (c.minDate ? ' · ' + fmtDate(c.minDate) + ' – ' + fmtDate(c.maxDate) : '') + '</div></div>' +
          (S.company && S.company.id === c.id ? '<span class="badge">Open</span>' : '') + '<span class="chev">›</span></button>';
      }).join('') + '</div>';
    }
    h += '<div class="btn-row"><button class="btn primary block" data-go="sync">⟳ Sync from Tally over Wi-Fi</button></div>';
    h += '<div class="btn-row"><button class="btn block" data-go="import">＋ Import Tally XML files</button></div>';
    h += '<div class="btn-row"><button class="btn block" data-go="help">Setup guide</button></div>';
    $view.innerHTML = h;
  };

  SCREENS.help = function () {
    topbar({ title: 'Setup guide', back: true, period: false });
    $view.innerHTML =
      '<div class="card"><h2>Option A · Sync over Wi-Fi (Android app)</h2><ol class="steps">' +
      '<li>In TallyPrime press <kbd>F1</kbd> (Help) → <b>Settings</b> → <b>Connectivity</b> → <b>Client/Server configuration</b>. Set <b>TallyPrime acts as</b> to <b>Both</b> (or Server), <b>Enable ODBC server</b> Yes, port <b>9000</b>. Restart Tally if asked.</li>' +
      '<li>Allow it through Windows Firewall: Start → "Allow an app through Windows Firewall" → tick TallyPrime for Private networks. If Tally is not listed, add an inbound rule for TCP port 9000.</li>' +
      '<li>Find the PC\'s address: Start → type <kbd>cmd</kbd> → run <kbd>ipconfig</kbd> and note the IPv4 Address (e.g. 192.168.1.10).</li>' +
      '<li>Open the companies you want in Tally. On the phone (same Wi-Fi) open <b>Sync from Tally</b>, enter the address, Connect, pick companies and period, Sync.</li></ol>' +
      '<p class="small muted">Nothing is installed on the PC. The phone sends Tally the same export requests the Export menu uses and reads the replies.</p></div>' +
      '<div class="section-title">Option B · XML files</div>' +
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
      '<li>Send both files to the phone (WhatsApp, Google Drive, email, USB cable).</li>' +
      '<li>In this app tap <b>Import Tally XML</b>, pick the files (both at once is fine) and save.</li>' +
      '<li>Re-export and re-import any time. Vouchers are matched by their Tally GUID, so importing the same period again updates rather than duplicates.</li></ol>' +
      '<p class="small muted">Prefer one click? The repository ships <b>tools/tally-export.cmd</b> for the PC: double-click it while Tally is open and it writes Master and Daybook XML for every open company into a folder.</p></div>' +
      '<div class="card"><h2>Notes</h2><p class="small muted">A TallyPrime backup (.900 data folder or TBK file) cannot be read by any outside app, which is why XML export is used. Reports here are computed from the ledgers and vouchers you import; profit figures exclude stock valuation, so they may differ from Tally where closing stock is material.</p></div>';
  };

  /* ---- import ------------------------------------------------------------- */
  SCREENS.import = function () {
    topbar({ title: 'Import Tally XML', back: true, period: false });
    var opts = '<option value="auto">Auto-detect from file (recommended)</option><option value="new">Create new company…</option>' +
      S.companies.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    var h = '<div class="card"><div class="field"><label>Import into</label><select id="imp-target">' + opts + '</select></div>' +
      '<div class="field hidden" id="imp-newname-wrap"><label>New company name</label><input id="imp-newname" placeholder="Company name"></div>' +
      '<label class="file-drop"><input type="file" id="imp-files" multiple><div style="font-size:30px">📂</div><div><b>Choose XML file(s)</b></div><div class="small">Master.xml, Daybook.xml or any TallyPrime XML export</div></label>' +
      '<div id="imp-jobs"></div>' +
      '<div class="btn-row"><button class="btn primary block hidden" id="imp-save">Save to company</button></div></div>' +
      '<p class="small muted">Files are parsed on this phone and never uploaded anywhere. Large day books (50–100 MB) can take a minute.</p>' +
      '<div class="btn-row"><button class="btn block" data-go="sync">Or sync directly from Tally over Wi-Fi</button></div>';
    $view.innerHTML = h;
    S.jobs = [];
    document.getElementById('imp-target').onchange = function () { document.getElementById('imp-newname-wrap').classList.toggle('hidden', this.value !== 'new'); };
    document.getElementById('imp-files').onchange = function () { queueFiles(this.files); };
    document.getElementById('imp-save').onclick = saveJobs;
  };

  /* ---- parsing in the worker --------------------------------------------- */
  var pendingParse = {};
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
    worker.onerror = function (e) { toast('Parser error: ' + e.message); };
    return worker;
  }
  function parseInWorker(buffer, onProgress) {
    return new Promise(function (resolve, reject) {
      var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      pendingParse[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
      getWorker().postMessage({ id: id, buffer: buffer }, [buffer]);
    });
  }
  function describeResult(r) {
    return [r.vouchers.length && pluralize(r.vouchers.length, 'voucher'), r.ledgers.length && pluralize(r.ledgers.length, 'ledger'), r.groups.length && pluralize(r.groups.length, 'group'), r.stockItems.length && pluralize(r.stockItems.length, 'stock item')].filter(Boolean).join(', ');
  }

  /* ---- storing parsed results into companies ---------------------------- */
  function findCompanyByName(name) {
    var n = (name || '').trim().toLowerCase();
    return S.companies.filter(function (c) { return c.name.toLowerCase() === n; })[0] || null;
  }
  // groups: [{ id: existing company id or null, name, items: [{ result, meta }] }] → Promise<last company id>
  function storeResults(groups) {
    var lastId = null, chain = Promise.resolve();
    groups.forEach(function (g) {
      chain = chain.then(function () {
        var company = g.id ? S.companies.filter(function (c) { return c.id === g.id; })[0] : null, created = false;
        if (!company) { company = { id: uid(), name: g.name, createdAt: Date.now() }; created = true; }
        return (created ? Promise.resolve(null) : TVDB.getData(company.id)).then(function (data) {
          data = data || TVModel.emptyData(company.id);
          g.items.forEach(function (it) { TVModel.mergeImport(data, it.result, it.meta); });
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
  function queueFiles(files) {
    var box = document.getElementById('imp-jobs');
    Array.prototype.forEach.call(files, function (f) {
      var job = { id: 'j' + Date.now() + Math.random().toString(36).slice(2, 6), file: f, state: 'queued', progress: 0, result: null };
      S.jobs.push(job);
      var el = document.createElement('div'); el.id = job.id; box.appendChild(el);
      updateJob(job);
    });
    nextJob();
  }
  function nextJob() {
    if (S.jobs.some(function (j) { return j.state === 'running'; })) return;
    var job = S.jobs.filter(function (j) { return j.state === 'queued'; })[0];
    if (!job) { var btn = document.getElementById('imp-save'); if (btn) btn.classList.toggle('hidden', !S.jobs.some(function (j) { return j.state === 'done'; })); return; }
    job.state = 'running'; updateJob(job);
    job.file.arrayBuffer()
      .then(function (buf) { return parseInWorker(buf, function (p) { job.progress = p; updateJob(job); }); })
      .then(function (r) { job.result = r; job.state = 'done'; job.progress = 1; }, function (e) { job.state = 'error'; job.error = String(e.message || e); })
      .then(function () { updateJob(job); nextJob(); });
  }
  function updateJob(job) {
    var el = document.getElementById(job.id); if (!el) return;
    var r = job.result, s;
    if (job.state === 'done') {
      s = (r.company ? '<b>' + esc(r.company) + '</b> · ' : '') + describeResult(r);
      if (!r.vouchers.length && !r.ledgers.length && !r.groups.length) s += '<span class="dr">Nothing recognised in this file. Is it a TallyPrime XML export?</span>';
      if (r.warnings.length) s += '<div class="dr small">' + r.warnings.map(esc).join('<br>') + '</div>';
    } else if (job.state === 'error') s = '<span class="dr">Failed: ' + esc(job.error) + '</span>';
    else s = job.state === 'running' ? 'Parsing… ' + Math.round(job.progress * 100) + '%' : 'Waiting';
    el.innerHTML = '<div class="kv" style="display:block"><div><b>' + esc(job.file.name) + '</b> <span class="faint small">' + (job.file.size / 1048576).toFixed(1) + ' MB</span></div><div class="small muted">' + s + '</div><div class="progress"><div style="width:' + Math.round(job.progress * 100) + '%"></div></div></div>';
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
      byKey[key].items.push({ result: j.result, meta: { name: j.file.name, bytes: j.file.size } });
    });
    storeResults(groups).then(function () { S.jobs = []; toast('Imported ' + pluralize(done.length, 'file')); go('#/home'); })
      .catch(function (e) { toast('Save failed: ' + e.message, 5000); btn.disabled = false; btn.textContent = 'Save to company'; });
  }

  /* ---- sync from TallyPrime over Wi-Fi ----------------------------------- */
  var bridgePending = {};
  window.TallyBridgeDone = function (id, ok, result) {
    var p = bridgePending[id]; if (!p) return; delete bridgePending[id];
    if (!ok) { p.reject(new Error(result)); return; }
    var url = /^(blob:|https?:)/.test(result) ? result : '/cache/' + result + '.xml';
    fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Could not read Tally reply (' + r.status + ')'); return r.arrayBuffer(); })
      .then(function (buf) { try { window.TallyBridge.discard(id); } catch (e) { /* ignore */ } p.resolve(buf); }, p.reject);
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
      h += '<div class="notice">Direct sync needs the Tally Viewer Android app (APK). In a browser, use <a href="#/import">Import XML</a> instead, or run the one-click exporter on the PC.</div>';
    }
    h += '<div class="card"><h2>TallyPrime computer</h2><div class="field"><label>PC address on your Wi-Fi (IPv4)</label><input id="sync-host" inputmode="decimal" placeholder="192.168.1.10" value="' + esc(saved.host) + '"></div>' +
      '<div class="field"><label>Port</label><input id="sync-port" inputmode="numeric" value="' + esc(saved.port) + '"></div>' +
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
      h += '<div class="card"><h2>Vouchers to fetch</h2><div class="field"><label>From</label><input type="date" id="sync-from" value="' + toISO(fy.from) + '"></div><div class="field"><label>To</label><input type="date" id="sync-to" value="' + toISO(fy.to) + '"></div>' +
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
          g.items.push({ result: mr, meta: { name: 'Tally sync masters', bytes: 0 } });
        }
        var months = monthRanges(cFrom, cTo), count = 0;
        for (var mi = 0; mi < months.length; mi++) {
          var rng = months[mi];
          log('<b>' + esc(co.name) + '</b>: vouchers ' + fmtMonth(Math.floor(rng[0] / 100)) + ' (' + (mi + 1) + '/' + months.length + ')…');
          var vr = await parseInWorker(await tallyRequest(host, port, TALLY_REQ.vouchers(co.name, rng[0], rng[1])));
          if (mi === 0 && !vr.vouchers.length && vr.preview && /error|could not|invalid/i.test(vr.preview)) throw new Error('Tally said: ' + vr.preview);
          count += vr.vouchers.length;
          setLast('<b>' + esc(co.name) + '</b>: ' + fmtMonth(Math.floor(rng[0] / 100)) + ' – ' + pluralize(vr.vouchers.length, 'voucher') + ' (' + count + ' so far)');
          if (vr.vouchers.length) g.items.push({ result: vr, meta: { name: 'Tally sync ' + fmtMonth(Math.floor(rng[0] / 100)), bytes: 0 } });
        }
        groups.push(g);
      }
      log('Saving…');
      await storeResults(groups);
      toast('Synced ' + pluralize(chosen.length, 'company'));
      go('#/home');
    } catch (e) {
      log('<span class="dr">Failed: ' + esc(e.message) + '</span>');
      run.disabled = false; run.textContent = 'Sync now';
    }
  }

  /* ---- home --------------------------------------------------------------- */
  SCREENS.home = function () {
    var b = S.book, p = S.period, s = b.summary(p.from, p.to);
    topbar({ title: S.company.name, sub: fmtDate(p.from) + ' – ' + fmtDate(p.to), right: '<button class="chip" data-act="company">⇄</button>' });
    var h = '';
    if (!b.vouchers.length) h += '<div class="notice">No vouchers imported for this company yet. Import a Daybook.xml to see activity.</div>';
    else if (Object.keys(b.data.groups).length === 0) h += '<div class="notice">Masters not imported: ledgers can\'t be grouped, so balance sheet and P&amp;L will be incomplete. Import Master.xml too.</div>';
    var inPeriod = b.vouchersIn(p.from, p.to).length;
    h += '<div class="tiles">' +
      tile('Net profit', compact(s.netProfit), s.netProfit < 0 ? 'loss, excl. stock valuation' : 'excl. stock valuation', 'hero wide') +
      tile('Sales', compact(s.sales), 'for period') + tile('Purchases', compact(s.purchases), 'for period') +
      tile('Receivables', compact(s.receivables), pluralize(s.debtors.filter(function (d) { return d.closing < 0; }).length, 'party')) +
      tile('Payables', compact(s.payables), pluralize(s.creditors.filter(function (d) { return d.closing > 0; }).length, 'party')) +
      tile('Cash in hand', compact(s.cash), 'as on ' + fmtDate(p.to)) + tile('Bank', compact(s.bank), s.bank < 0 ? 'overdrawn' : 'as on ' + fmtDate(p.to)) +
      tile('Expenses', compact(s.expenses), 'direct + indirect') + tile('Vouchers', NF0.format(inPeriod), 'in period') +
      '</div>';
    h += '<div class="card"><h2>Monthly sales vs purchases</h2>' + chart(s.monthly) + '</div>';
    var top = s.debtors.filter(function (d) { return d.closing < 0; }).slice(0, 5);
    if (top.length) h += '<div class="card" style="padding:0"><h2 style="padding:14px 14px 0"><a class="more" href="#/report/receivables">All ›</a>Top receivables</h2><div>' + top.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div></div>';
    var recent = b.vouchersIn(p.from, p.to).slice(-5).reverse();
    if (recent.length) h += '<div class="card" style="padding:0"><h2 style="padding:14px 14px 0"><a class="more" href="#/vouchers">All ›</a>Latest vouchers</h2><div>' + recent.map(voucherRow).join('') + '</div></div>';
    $view.innerHTML = h;
    bindChart();
  };
  function tile(label, value, sub, cls) { return '<div class="tile ' + (cls || '') + '"><div class="label">' + esc(label) + '</div><div class="value num">' + esc(value) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'; }

  function chart(months) {
    if (!months.length) return '<p class="muted small">No activity in this period.</p>';
    var data = months.slice(-12), W = 600, H = 200, padL = 8, padR = 8, padT = 10, padB = 24;
    var max = 0; data.forEach(function (m) { max = Math.max(max, m.sales, m.purchases); });
    if (max <= 0) max = 1;
    var innerW = W - padL - padR, innerH = H - padT - padB, gw = innerW / data.length, bw = Math.min(22, (gw - 8) / 2);
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" id="chart" role="img" aria-label="Monthly sales and purchases">';
    for (var g = 0; g <= 4; g++) { var y = padT + innerH - innerH * g / 4; svg += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>'; }
    data.forEach(function (m, i) {
      var x0 = padL + gw * i, cx = x0 + gw / 2;
      svg += '<g class="mg" data-i="' + i + '"><rect class="hit" x="' + x0 + '" y="0" width="' + gw + '" height="' + H + '" fill="transparent"/>';
      var hs = innerH * m.sales / max, hp = innerH * m.purchases / max;
      svg += '<rect class="bar" x="' + (cx - bw - 1) + '" y="' + (padT + innerH - Math.max(0, hs)) + '" width="' + bw + '" height="' + Math.max(0, hs) + '" fill="var(--series-1)"/>';
      svg += '<rect class="bar" x="' + (cx + 1) + '" y="' + (padT + innerH - Math.max(0, hp)) + '" width="' + bw + '" height="' + Math.max(0, hp) + '" fill="var(--series-2)"/>';
      svg += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(fmtMonth(m.month)) + '</text></g>';
    });
    svg += '</svg>';
    var legend = '<div class="legend"><span><i style="background:var(--series-1)"></i>Sales</span><span><i style="background:var(--series-2)"></i>Purchases</span><span class="faint" style="margin-left:auto">max ' + esc(compact(max)) + '</span></div>';
    var last = data[data.length - 1];
    return legend + svg + '<div class="chart-tip" id="chart-tip" data-months="' + esc(JSON.stringify(data.map(function (m) { return [m.month, m.sales, m.purchases, m.expenses]; }))) + '">' + chartTip(last) + '</div>';
  }
  function chartTip(m) { return '<b>' + esc(fmtMonth(m.month || m[0])) + '</b><span>Sales ' + esc(compact(m.sales !== undefined ? m.sales : m[1])) + '</span><span>Purchases ' + esc(compact(m.purchases !== undefined ? m.purchases : m[2])) + '</span><span>Expenses ' + esc(compact(m.expenses !== undefined ? m.expenses : m[3])) + '</span>'; }
  function bindChart() {
    var svg = document.getElementById('chart'); if (!svg) return;
    var tip = document.getElementById('chart-tip'), months = JSON.parse(tip.getAttribute('data-months'));
    function pick(ev) {
      var g = ev.target.closest('.mg'); if (!g) return;
      var i = parseInt(g.getAttribute('data-i'), 10);
      tip.innerHTML = chartTip(months[i]);
      svg.querySelectorAll('.hit').forEach(function (r, k) { r.setAttribute('fill', k === i ? 'var(--accent-soft)' : 'transparent'); });
    }
    svg.addEventListener('pointerdown', pick); svg.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse') pick(ev); });
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
  SCREENS.ledgers = function (r) {
    var b = S.book, p = S.period, f = r.q.f || 'all', q = (r.q.q || '').toLowerCase(), showNil = r.q.nil === '1';
    topbar({ title: 'Ledgers', sub: S.company.name, extra: '<div class="chips">' + LFILTERS.map(function (x) { return '<button class="chip ' + (f === x[0] ? 'on' : '') + '" data-filter="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' });
    var rows = [], total = 0, hidden = 0;
    b.ledgerNames.forEach(function (n) {
      var led = b.ledgers[n];
      if (!ledgerMatchesFilter(led, f)) return;
      if (q && n.toLowerCase().indexOf(q) === -1 && (led.parent || '').toLowerCase().indexOf(q) === -1 && !(led.info.aliases || []).some(function (a) { return a.toLowerCase().indexOf(q) !== -1; })) return;
      var bl = b.ledgerBalance(n, p.from, p.to);
      if (!showNil && Math.abs(bl.closing) < 0.005 && !bl.count) { hidden++; return; }
      total++;
      rows.push(ledgerRow(n, bl.closing, led.parent || (led.implicit ? 'Not in masters' : 'Primary')));
    });
    var h = '<div class="search"><input type="search" id="lsearch" placeholder="Search ' + b.ledgerNames.length + ' ledgers" value="' + esc(r.q.q || '') + '"></div>';
    h += rows.length ? '<div class="list" id="llist">' + rows.slice(0, 300).join('') + '</div>' : '<div class="empty">No ledgers match.</div>';
    if (rows.length > 300) h += '<button class="btn block" id="lmore">Show all ' + rows.length + '</button>';
    if (hidden) h += '<p class="small muted" style="text-align:center">' + hidden + ' ledgers with no balance and no transactions hidden · <a href="#/ledgers?f=' + f + '&nil=1&q=' + encodeURIComponent(r.q.q || '') + '">show</a></p>';
    $view.innerHTML = h;
    var inp = document.getElementById('lsearch'), t;
    inp.oninput = function () { clearTimeout(t); var v = inp.value; t = setTimeout(function () { history.replaceState(null, '', '#/ledgers?f=' + f + '&q=' + encodeURIComponent(v) + (showNil ? '&nil=1' : '')); render(); var i2 = document.getElementById('lsearch'); i2.focus(); i2.setSelectionRange(v.length, v.length); }, 250); };
    var more = document.getElementById('lmore'); if (more) more.onclick = function () { document.getElementById('llist').innerHTML = rows.join(''); more.remove(); };
    $top.querySelectorAll('[data-filter]').forEach(function (c) { c.onclick = function () { go('#/ledgers?f=' + c.getAttribute('data-filter') + '&q=' + encodeURIComponent(r.q.q || '')); }; });
  };
  function ledgerRow(name, closing, sub) {
    return '<button class="row" data-ledger="' + esc(name) + '"><div class="main"><div class="t">' + esc(name) + '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div><div class="amt"><div class="v">' + bal(closing) + '</div></div><span class="chev">›</span></button>';
  }

  SCREENS.ledger = function (r) {
    var b = S.book, p = S.period, name = r.arg, led = b.ledgers[name];
    if (!led) { topbar({ title: 'Ledger', back: true }); $view.innerHTML = '<div class="empty">Ledger not found.</div>'; return; }
    var st = b.ledgerStatement(name, p.from, p.to), bl = st.balance, info = led.info || {};
    topbar({ title: name, sub: led.chain.length ? led.chain.join(' › ') : (led.implicit ? 'Not in masters' : 'Primary'), back: true });
    var h = '<div class="tiles"><div class="tile"><div class="label">Opening</div><div class="value" style="font-size:16px">' + bal(bl.opening) + '</div></div><div class="tile"><div class="label">Closing</div><div class="value" style="font-size:16px">' + bal(bl.closing) + '</div></div>' +
      '<div class="tile"><div class="label">Debits</div><div class="value num" style="font-size:16px">' + fmt(bl.debit) + '</div></div><div class="tile"><div class="label">Credits</div><div class="value num" style="font-size:16px">' + fmt(bl.credit) + '</div></div></div>';
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
    if (st.rows.length) {
      var rows = st.rows.slice().reverse().map(function (x) {
        var v = x.voucher;
        return '<button class="row" data-voucher="' + v.idx + '"><div class="main"><div class="t">' + esc(x.others.slice(0, 2).join(', ') || v.party || v.type) + '</div><div class="s">' + fmtDate(x.date) + ' · ' + esc(v.type) + (v.number ? ' #' + esc(v.number) : '') + (v.narration ? ' · ' + esc(v.narration) : '') + '</div></div><div class="amt"><div class="v">' + bal(x.amount) + '</div><div class="s">' + bal(x.balance, false).replace(/<[^>]+>/g, '') + '</div></div></button>';
      });
      h += '<div class="list" id="lrows">' + rows.slice(0, 200).join('') + '</div>';
      if (rows.length > 200) h += '<button class="btn block" id="lmore">Show all ' + rows.length + '</button>';
    } else h += '<div class="empty small">No transactions in this period.</div>';
    $view.innerHTML = h;
    var more = document.getElementById('lmore'); if (more) more.onclick = function () { document.getElementById('lrows').innerHTML = rows.join(''); more.remove(); };
  };

  /* ---- vouchers ----------------------------------------------------------- */
  SCREENS.vouchers = function (r) {
    var b = S.book, p = S.period, q = r.q.q || '', type = r.q.type || '';
    topbar({ title: 'Day Book', sub: S.company.name });
    var list = b.vouchersIn(p.from, p.to, { q: q, type: type });
    var types = Object.keys(b.typeCounts).sort();
    var h = '<div class="search"><input type="search" id="vsearch" placeholder="Search party, narration, number, ledger" value="' + esc(q) + '"></div>' +
      '<div class="filters"><select id="vtype"><option value="">All types (' + b.vouchers.length + ')</option>' + types.map(function (t) { return '<option value="' + esc(t) + '"' + (t === type ? ' selected' : '') + '>' + esc(t) + ' (' + b.typeCounts[t] + ')</option>'; }).join('') + '</select></div>';
    var total = 0; list.forEach(function (v) { if (v.affects) total += v.total; });
    h += '<p class="small muted" style="margin:0 2px 8px">' + pluralize(list.length, 'voucher') + ' · total ₹' + fmt(total) + '</p>';
    if (!list.length) h += '<div class="empty">No vouchers match.</div>';
    else {
      var rows = [], lastDate = 0;
      for (var i = list.length - 1; i >= 0; i--) {
        var v = list[i];
        if (v.date !== lastDate) { rows.push('<div class="date-head">' + fmtDateLong(v.date) + '</div>'); lastDate = v.date; }
        rows.push(voucherRow(v));
      }
      h += '<div class="list" id="vlist">' + rows.slice(0, 250).join('') + '</div>';
      if (rows.length > 250) h += '<button class="btn block" id="vmore">Show all ' + list.length + '</button>';
    }
    $view.innerHTML = h;
    var inp = document.getElementById('vsearch'), t;
    inp.oninput = function () { clearTimeout(t); var val = inp.value; t = setTimeout(function () { history.replaceState(null, '', '#/vouchers?type=' + encodeURIComponent(type) + '&q=' + encodeURIComponent(val)); render(); var i2 = document.getElementById('vsearch'); i2.focus(); i2.setSelectionRange(val.length, val.length); }, 250); };
    document.getElementById('vtype').onchange = function () { go('#/vouchers?type=' + encodeURIComponent(this.value) + '&q=' + encodeURIComponent(q)); };
    var more = document.getElementById('vmore'); if (more) more.onclick = function () { document.getElementById('vlist').innerHTML = rows.join(''); more.remove(); };
  };
  function voucherRow(v) {
    var who = v.party || (v.entries[0] ? v.entries[0].ledger : '');
    var flag = v.cancelled ? ' · cancelled' : v.optional ? ' · optional' : !v.affects ? ' · no effect' : '';
    return '<button class="row" data-voucher="' + v.idx + '"><span class="badge">' + esc(v.type) + '</span><div class="main"><div class="t">' + esc(who) + '</div><div class="s">' + fmtDate(v.date) + (v.number ? ' · #' + esc(v.number) : '') + flag + (v.narration ? ' · ' + esc(v.narration) : '') + '</div></div><div class="amt"><div class="v num">' + fmt(v.total) + '</div></div></button>';
  }

  SCREENS.voucher = function (r) {
    var b = S.book, v = b.vouchers[parseInt(r.arg, 10)];
    if (!v) { topbar({ title: 'Voucher', back: true }); $view.innerHTML = '<div class="empty">Voucher not found.</div>'; return; }
    topbar({ title: v.type + (v.number ? ' #' + v.number : ''), sub: fmtDateLong(v.date), back: true });
    var h = '<div class="card"><div class="voucher-head"><div><div class="muted small">' + (v.party ? 'Party' : 'Voucher') + '</div><div style="font-weight:600">' + esc(v.party || v.type) + '</div></div><div style="text-align:right"><div class="muted small">Amount</div><div class="big num">₹' + fmt(v.total) + '</div></div></div>';
    if (v.cancelled) h += '<div class="notice" style="margin-top:10px">Cancelled voucher – not counted in balances.</div>';
    else if (v.optional) h += '<div class="notice" style="margin-top:10px">Optional voucher – not counted in balances.</div>';
    else if (!v.affects) h += '<div class="notice" style="margin-top:10px">' + esc(v.base) + ' – does not affect ledger balances.</div>';
    if (v.unbalanced) h += '<div class="notice" style="margin-top:10px">Entries do not balance by ' + fmt(v.unbalanced) + '. The export may be incomplete for this voucher.</div>';
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
    $view.innerHTML = h;
  };

  /* ---- reports ------------------------------------------------------------ */
  var REPORTS = [
    ['tb', 'Trial Balance', 'Group-wise closing balances'], ['pl', 'Profit & Loss', 'Income and expenses for the period'], ['bs', 'Balance Sheet', 'As on period end'],
    ['receivables', 'Receivables', 'Sundry debtors outstanding'], ['payables', 'Payables', 'Sundry creditors outstanding'], ['cashbank', 'Cash & Bank', 'Cash and bank balances'],
    ['stock', 'Stock Summary', 'Item quantities in and out'], ['monthly', 'Monthly Summary', 'Sales, purchases, expenses by month'], ['register', 'Voucher Register', 'Counts and totals by voucher type']
  ];
  SCREENS.reports = function () {
    topbar({ title: 'Reports', sub: S.company.name });
    $view.innerHTML = '<div class="list">' + REPORTS.map(function (r) { return '<a class="row" href="#/report/' + r[0] + '"><div class="main"><div class="t">' + r[1] + '</div><div class="s">' + r[2] + '</div></div><span class="chev">›</span></a>'; }).join('') + '</div>';
  };
  SCREENS.report = function (r) {
    var fn = REPORT_FN[r.arg];
    if (!fn) { go('#/reports'); return; }
    var meta = REPORTS.filter(function (x) { return x[0] === r.arg; })[0];
    topbar({ title: meta[1], sub: fmtDate(S.period.from) + ' – ' + fmtDate(S.period.to), back: true });
    $view.innerHTML = fn(S.book, S.period.from, S.period.to);
  };
  function groupNode(n, depth) {
    var h = '<details class="grp"' + (depth === 0 ? '' : '') + '><summary><span class="arrow">▶</span><span class="main">' + esc(n.name) + '</span><span class="amt">' + bal(n.closing) + '</span></summary><div class="inner">';
    n.groups.forEach(function (g) { h += groupNode(g, depth + 1); });
    n.ledgers.forEach(function (l) { h += ledgerRow(l.name, l.closing); });
    if (!n.groups.length && !n.ledgers.length) h += '<div class="row static small muted">No ledgers</div>';
    return h + '</div></details>';
  }
  var REPORT_FN = {
    tb: function (b, from, to) {
      var t = b.tree(from, to), dr = 0, cr = 0;
      function walk(n) { n.ledgers.forEach(function (l) { if (l.closing < 0) dr += -l.closing; else cr += l.closing; }); n.groups.forEach(walk); }
      t.roots.forEach(walk); t.primaryLedgers.forEach(function (l) { if (l.closing < 0) dr += -l.closing; else cr += l.closing; });
      var h = '<div class="list">' + t.roots.map(function (n) { return groupNode(n, 0); }).join('') + t.primaryLedgers.map(function (l) { return ledgerRow(l.name, l.closing, 'Primary'); }).join('') + '</div>';
      h += '<div class="card"><div class="kv"><span>Total debit</span><span class="num">' + fmt(dr) + '</span></div><div class="kv"><span>Total credit</span><span class="num">' + fmt(cr) + '</span></div>' + (Math.abs(dr - cr) > 0.01 ? '<div class="kv dr"><span>Difference in opening balances</span><span class="num">' + fmt(Math.abs(dr - cr)) + '</span></div>' : '') + '</div>';
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
      h += '<div class="section-title">Income statement</div><div class="list">' + line(ii) + line(ie) + otherI.concat(otherE).map(function (n) { return line(n); }).join('') + total('Net profit', np, true) + '</div>';
      h += '<p class="small muted">Movement for the period only. Opening and closing stock are not included, so where stock changes materially Tally\'s figure will differ.</p>';
      return h;
    },
    bs: function (b, from, to) {
      var t = b.tree(from, to);
      var liab = t.roots.filter(function (n) { return n.nature === 'L'; }), assets = t.roots.filter(function (n) { return n.nature === 'A'; }), unknown = t.roots.filter(function (n) { return n.nature === 'U'; });
      var plLedger = 0, plOther = [];
      t.primaryLedgers.forEach(function (l) { if (l.nature === 'P') plLedger += l.closing; else plOther.push(l); });
      var revenue = 0; t.roots.forEach(function (n) { if (n.nature === 'I' || n.nature === 'E') revenue += n.closing; });
      var pl = plLedger + revenue;
      var L = 0, A = 0;
      liab.forEach(function (n) { L += n.closing; }); assets.forEach(function (n) { A += -n.closing; });
      plOther.forEach(function (l) { if (l.closing > 0) L += l.closing; else A += -l.closing; });
      L += pl;
      var diff = L - A;
      var h = '<div class="section-title">Liabilities</div><div class="list">' + liab.map(function (n) { return groupNode(n, 0); }).join('') +
        '<div class="row static"><div class="main"><div class="t">Profit &amp; Loss A/c</div><div class="s">Opening ' + fmt(Math.abs(plLedger)) + ' + current period ' + fmt(Math.abs(revenue)) + (revenue < 0 ? ' (loss)' : '') + '</div></div><div class="amt"><div class="v">' + bal(pl) + '</div></div></div>' +
        plOther.filter(function (l) { return l.closing > 0; }).map(function (l) { return ledgerRow(l.name, l.closing); }).join('') +
        (diff < -0.01 ? '<div class="row static"><div class="main"><div class="t dr">Difference in opening balances</div></div><div class="amt"><div class="v num">' + fmt(-diff) + '</div></div></div>' : '') +
        '<div class="row static"><div class="main"><div class="t" style="font-weight:700">Total</div></div><div class="amt"><div class="v num">' + fmt(Math.max(L, A)) + '</div></div></div></div>';
      h += '<div class="section-title">Assets</div><div class="list">' + assets.map(function (n) { return groupNode(n, 0); }).join('') +
        plOther.filter(function (l) { return l.closing < 0; }).map(function (l) { return ledgerRow(l.name, l.closing); }).join('') +
        (diff > 0.01 ? '<div class="row static"><div class="main"><div class="t dr">Difference in opening balances</div></div><div class="amt"><div class="v num">' + fmt(diff) + '</div></div></div>' : '') +
        '<div class="row static"><div class="main"><div class="t" style="font-weight:700">Total</div></div><div class="amt"><div class="v num">' + fmt(Math.max(L, A)) + '</div></div></div></div>';
      if (unknown.length) h += '<div class="section-title">Unclassified groups</div><div class="list">' + unknown.map(function (n) { return groupNode(n, 0); }).join('') + '</div><p class="small muted">These groups are not under a standard Tally primary group. Import Master.xml so they can be classified.</p>';
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
      return (rows.length ? '<div class="list">' + rows.join('') + '</div>' : '<div class="empty">No cash or bank ledgers found.</div>') + '<div class="card"><div class="kv"><span>Net cash &amp; bank</span><span class="num">' + fmt(total) + '</span></div></div>';
    },
    stock: function (b, from, to) {
      var items = b.stockSummary(from, to);
      if (!items.length) return '<div class="empty">No stock items or inventory vouchers imported.</div>';
      return '<div class="list">' + items.map(function (it) {
        return '<button class="row" data-stock="' + esc(it.name) + '"><div class="main"><div class="t">' + esc(it.name) + '</div><div class="s">in ' + fmtQ(it.inward) + ' · out ' + fmtQ(it.outward) + (it.group ? ' · ' + esc(it.group) : '') + '</div></div><div class="amt"><div class="v num ' + (it.closing < 0 ? 'dr' : '') + '">' + fmtQ(it.closing) + ' ' + esc(it.unit) + '</div><div class="s">closing</div></div><span class="chev">›</span></button>';
      }).join('') + '</div><p class="small muted">Quantities only. Opening from masters plus inward minus outward for the period\'s vouchers. Negative closing usually means older vouchers were not imported.</p>';
    },
    monthly: function (b, from, to) {
      var m = b.monthly(from, to);
      if (!m.length) return '<div class="empty">No activity in this period.</div>';
      var ts = 0, tp = 0, te = 0, tc = 0;
      var h = '<div class="card" style="overflow:auto"><table class="tbl"><tr><th>Month</th><th class="n">Sales</th><th class="n">Purchases</th><th class="n">Expenses</th><th class="n">Vch</th></tr>';
      m.forEach(function (x) { ts += x.sales; tp += x.purchases; te += x.expenses; tc += x.count; h += '<tr><td>' + fmtMonth(x.month) + '</td><td class="n">' + fmt(x.sales) + '</td><td class="n">' + fmt(x.purchases) + '</td><td class="n">' + fmt(x.expenses) + '</td><td class="n">' + x.count + '</td></tr>'; });
      h += '<tr class="total"><td>Total</td><td class="n">' + fmt(ts) + '</td><td class="n">' + fmt(tp) + '</td><td class="n">' + fmt(te) + '</td><td class="n">' + tc + '</td></tr></table></div>';
      return h;
    },
    register: function (b, from, to) {
      var byType = {};
      b.vouchersIn(from, to).forEach(function (v) { var x = byType[v.type] || (byType[v.type] = { n: 0, total: 0 }); x.n++; x.total += v.total; });
      var keys = Object.keys(byType).sort();
      if (!keys.length) return '<div class="empty">No vouchers in this period.</div>';
      return '<div class="list">' + keys.map(function (k) { return '<a class="row" href="#/vouchers?type=' + encodeURIComponent(k) + '"><div class="main"><div class="t">' + esc(k) + '</div><div class="s">' + esc(b.baseType(k)) + ' · ' + pluralize(byType[k].n, 'voucher') + '</div></div><div class="amt"><div class="v num">' + fmt(byType[k].total) + '</div></div><span class="chev">›</span></a>'; }).join('') + '</div>';
    }
  };
  function partyReport(list, kind, to) {
    if (!list.length) return '<div class="empty">No ' + kind + 's with a balance.</div>';
    var out = 0, opp = 0, main = [], other = [];
    list.forEach(function (d) { var isMain = kind === 'debtor' ? d.closing < 0 : d.closing > 0; if (isMain) { out += Math.abs(d.closing); main.push(d); } else { opp += Math.abs(d.closing); other.push(d); } });
    var h = '<div class="card"><div class="kv"><span>' + (kind === 'debtor' ? 'Total receivable' : 'Total payable') + '</span><span class="num" style="font-weight:700">' + fmt(out) + '</span></div><div class="kv"><span>' + pluralize(main.length, 'party') + ' as on ' + fmtDate(to) + '</span><span></span></div></div>';
    h += '<div class="list">' + main.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div>';
    if (other.length) h += '<div class="section-title">' + (kind === 'debtor' ? 'Debtors with credit balance' : 'Creditors with debit balance') + ' · ' + fmt(opp) + '</div><div class="list">' + other.map(function (d) { return ledgerRow(d.name, d.closing); }).join('') + '</div>';
    return h;
  }

  SCREENS.stock = function (r) {
    var b = S.book, name = r.arg, it = b.stock[name];
    if (!it) { go('#/report/stock'); return; }
    var m = b.stockMoves(name, S.period.from, S.period.to);
    topbar({ title: name, sub: it.group || 'Stock item', back: true });
    var h = '<div class="tiles"><div class="tile"><div class="label">Opening</div><div class="value num" style="font-size:16px">' + fmtQ(m.opening) + ' ' + esc(it.unit) + '</div></div><div class="tile"><div class="label">Closing</div><div class="value num" style="font-size:16px">' + fmtQ(m.closing) + ' ' + esc(it.unit) + '</div></div></div>';
    if (m.rows.length) h += '<div class="list">' + m.rows.slice().reverse().map(function (x) { var v = x.voucher; return '<button class="row" data-voucher="' + v.idx + '"><div class="main"><div class="t">' + esc(v.party || v.type) + '</div><div class="s">' + fmtDate(x.date) + ' · ' + esc(v.type) + (v.number ? ' #' + esc(v.number) : '') + '</div></div><div class="amt"><div class="v num ' + (x.qty < 0 ? 'dr' : 'cr') + '">' + (x.qty > 0 ? '+' : '') + fmtQ(x.qty) + '</div><div class="s">bal ' + fmtQ(x.balance) + '</div></div></button>'; }).join('') + '</div>';
    else h += '<div class="empty small">No movement in this period.</div>';
    $view.innerHTML = h;
  };

  /* ---- more --------------------------------------------------------------- */
  SCREENS.more = function () {
    topbar({ title: 'More', period: false });
    var c = S.company, b = S.book, h = '';
    if (c && b) {
      h += '<div class="card"><h2>Current company</h2><div class="kv"><span>Name</span><span><b>' + esc(c.name) + '</b></span></div>' +
        '<div class="kv"><span>Data range</span><span>' + (b.minDate ? fmtDate(b.minDate) + ' – ' + fmtDate(b.maxDate) : '–') + '</span></div>' +
        '<div class="kv"><span>Vouchers</span><span>' + NF0.format(b.vouchers.length) + '</span></div><div class="kv"><span>Ledgers / groups</span><span>' + Object.keys(b.data.ledgers).length + ' / ' + Object.keys(b.data.groups).length + '</span></div>' +
        '<div class="kv"><span>Stock items</span><span>' + Object.keys(b.data.stockItems).length + '</span></div>' +
        '<div class="btn-row"><button class="btn" data-go="import">Import more XML</button><button class="btn" data-act="rename">Rename</button><button class="btn danger" data-act="delete">Delete company</button></div></div>';
      if (b.data.files.length) h += '<div class="card"><h2>Imported files</h2>' + b.data.files.slice().reverse().slice(0, 10).map(function (f) { return '<div class="kv"><span>' + esc(f.name) + '<div class="small faint">' + new Date(f.at).toLocaleString() + '</div></span><span class="small muted">' + [f.counts.vouchers.added + f.counts.vouchers.updated ? (f.counts.vouchers.added + f.counts.vouchers.updated) + ' vch' : '', f.counts.ledgers.added + f.counts.ledgers.updated ? (f.counts.ledgers.added + f.counts.ledgers.updated) + ' ledgers' : ''].filter(Boolean).join(', ') + '</span></div>'; }).join('') + '</div>';
    }
    h += '<div class="list"><button class="row" data-go="companies"><div class="main"><div class="t">Companies</div><div class="s">' + pluralize(S.companies.length, 'company') + ' on this phone</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="sync"><div class="main"><div class="t">Sync from Tally over Wi-Fi</div><div class="s">Pull masters and vouchers straight from TallyPrime</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="import"><div class="main"><div class="t">Import Tally XML files</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-go="help"><div class="main"><div class="t">How to export from TallyPrime</div></div><span class="chev">›</span></button>' +
      '<button class="row" data-act="theme"><div class="main"><div class="t">Theme</div><div class="s">' + esc(lsGet('tv.theme', 'auto')) + '</div></div><span class="chev">›</span></button></div>';
    h += '<p class="small faint" style="text-align:center">Tally Viewer · offline · all data stays in this browser\'s storage<span id="storage"></span></p>';
    $view.innerHTML = h;
    TVDB.estimate().then(function (e) { if (e && e.usage) document.getElementById('storage').textContent = ' · ' + (e.usage / 1048576).toFixed(1) + ' MB used'; });
  };

  /* ---- sheets ------------------------------------------------------------- */
  function sheet(html, onClick) {
    var bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.innerHTML = '<div class="sheet">' + html + '</div>';
    bg.addEventListener('click', function (ev) { if (ev.target === bg) bg.remove(); else if (onClick) onClick(ev, bg); });
    document.body.appendChild(bg);
    return bg;
  }
  function periodSheet() {
    var b = S.book, cur = S.period, h = '<h3>Period</h3>';
    var opts = b.periods().concat([{ from: b.minDate || 20000401, to: b.maxDate || 20991231, label: 'All data' }]);
    var now = new Date(), tm = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100;
    opts.unshift({ from: tm + 1, to: tm + 31, label: 'This month' });
    if (b.maxDate) { var lm = Math.floor(b.maxDate / 100) * 100; opts.unshift({ from: lm + 1, to: lm + 31, label: 'Last month with data (' + fmtMonth(Math.floor(b.maxDate / 100)) + ')' }); }
    h += opts.map(function (o, i) { return '<button class="opt ' + (cur.from === o.from && cur.to === o.to ? 'on' : '') + '" data-i="' + i + '">' + esc(o.label) + ' <span class="faint small">' + fmtDate(o.from) + ' – ' + fmtDate(o.to) + '</span></button>'; }).join('');
    h += '<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px"><div class="field"><label>From</label><input type="date" id="pfrom" value="' + toISO(cur.from) + '"></div><div class="field"><label>To</label><input type="date" id="pto" value="' + toISO(cur.to) + '"></div><button class="btn primary block" id="papply">Apply custom period</button></div>';
    sheet(h, function (ev, bg) {
      var o = ev.target.closest('.opt');
      if (o) { bg.remove(); setPeriod(opts[parseInt(o.getAttribute('data-i'), 10)]); return; }
      if (ev.target.id === 'papply') {
        var f = fromISO(document.getElementById('pfrom').value), t = fromISO(document.getElementById('pto').value);
        if (!f || !t || f > t) { toast('Pick a valid from/to'); return; }
        bg.remove(); setPeriod({ from: f, to: t, label: fmtDate(f) + ' – ' + fmtDate(t) });
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
    var cur = lsGet('tv.theme', 'auto');
    sheet('<h3>Theme</h3>' + ['auto', 'light', 'dark'].map(function (t) { return '<button class="opt ' + (cur === t ? 'on' : '') + '" data-t="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</button>'; }).join(''), function (ev, bg) {
      var o = ev.target.closest('.opt'); if (!o) return;
      bg.remove(); lsSet('tv.theme', o.getAttribute('data-t')); applyTheme(); render();
    });
  }
  function applyTheme() {
    var t = lsGet('tv.theme', 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#ffffff');
  }

  /* ---- global events ------------------------------------------------------ */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-go],[data-act],[data-ledger],[data-voucher],[data-company],[data-stock]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { ev.preventDefault(); go('#/' + el.getAttribute('data-go')); return; }
    if (el.hasAttribute('data-ledger')) { go('#/ledger/' + encodeURIComponent(el.getAttribute('data-ledger'))); return; }
    if (el.hasAttribute('data-voucher')) { go('#/voucher/' + el.getAttribute('data-voucher')); return; }
    if (el.hasAttribute('data-stock')) { go('#/stock/' + encodeURIComponent(el.getAttribute('data-stock'))); return; }
    if (el.hasAttribute('data-company')) { var id = el.getAttribute('data-company'); S.book = null; S.company = null; selectCompany(id).then(function () { go('#/home'); }); return; }
    var act = el.getAttribute('data-act');
    if (act === 'back') { if (history.length > 1) history.back(); else go('#/home'); }
    else if (act === 'period') periodSheet();
    else if (act === 'company') companySheet();
    else if (act === 'theme') themeSheet();
    else if (act === 'rename') {
      var name = prompt('Company name', S.company.name);
      if (name && name.trim()) { S.company.name = name.trim(); S.company.updatedAt = Date.now(); TVDB.putCompany(S.company).then(loadCompanies).then(render); }
    } else if (act === 'delete') {
      if (confirm('Delete "' + S.company.name + '" and all its imported data from this phone? This cannot be undone.')) {
        var cid = S.company.id;
        TVDB.deleteCompany(cid).then(function () { S.company = null; S.book = null; localStorage.removeItem('tv.period.' + cid); localStorage.removeItem('tv.company'); return loadCompanies(); }).then(function () { toast('Company deleted'); go('#/companies'); });
      }
    }
  });
  window.addEventListener('hashchange', render);

  /* ---- boot --------------------------------------------------------------- */
  function boot() {
    $view = document.getElementById('view'); $top = document.getElementById('top'); $nav = document.getElementById('nav');
    applyTheme();
    loadCompanies().then(function () {
      if (!location.hash || location.hash === '#/' ) location.hash = S.companies.length ? '#/home' : '#/companies';
      render();
    }).catch(function (e) { $view.innerHTML = '<div class="empty">Storage unavailable: ' + esc(e.message) + '<br><span class="small">Private/incognito mode may block IndexedDB.</span></div>'; });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          nw && nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) { toast('Update ready – reopen the app to use it', 5000); } });
        });
      }).catch(function () { /* offline install unavailable */ });
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
