/* Voucher entry, GST sales invoice / credit note, e-invoice and pending-entries screens. Uses the TVApp bridge from app.js. */
(function () {
  'use strict';
  var A = window.TVApp, S = A.S, SCREENS = A.SCREENS, esc = A.esc, fmt = A.fmt, toast = A.toast, go = A.go;
  var GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28];
  var ENTRY_TYPES = ['Journal', 'Payment', 'Receipt', 'Contra', 'Sales', 'Purchase', 'Credit Note', 'Debit Note'];
  var INVOICE_BASES = { Sales: 1, 'Credit Note': 1 };
  A.NEEDS_BOOK.entry = 1; A.NEEDS_BOOK.invoice = 1; A.NEEDS_BOOK.pending = 1; A.NEEDS_BOOK.gst = 1;
  // Active screen state for the one delegated picker handler below. Each screen sets the parts it uses when it renders.
  var cur = { draft: null, renderLines: null, inv: null, refresh: null, gst: null, resumedDraft: null, resumedInv: null };
  function ico(k) { return (A.ICONS && A.ICONS[k]) || ''; }
  function cash(n) { return A.cur ? A.cur(n) : '₹' + fmt(n); }

  /* ---- persistence -------------------------------------------------------- */
  function companySettings() { var c = S.company, info = (c && c.info) || {}; var st = (c && c.settings) || {}; return {
    gstin: st.gstin || info.gstin || '', legalName: st.legalName || (c ? c.name : ''), tradeName: st.tradeName || (c ? c.name : ''),
    address1: st.address1 || info.address || '', address2: st.address2 || '', city: st.city || info.city || '', pin: st.pin || info.pin || '', state: st.state || info.state || '',
    phone: st.phone || info.phone || '', email: st.email || '', salesLedger: st.salesLedger || '', cgstLedger: st.cgstLedger || '', sgstLedger: st.sgstLedger || '', igstLedger: st.igstLedger || '', roundOffLedger: st.roundOffLedger || ''
  }; }
  function saveSettings(st) { S.company.settings = st; S.company.updatedAt = Date.now(); return TVDB.putCompany(S.company).then(A.loadCompanies); }
  function voucherSort(a, b) { return TVModel.voucherSort ? TVModel.voucherSort(a, b) : (a.date - b.date || String(a.number || '').localeCompare(String(b.number || ''), undefined, { numeric: true })); }
  // Upsert (or delete) an app-created voucher in the open company. The next vouchers array is written to IndexedDB
  // first (data, then company record); memory (S.book, counts) is swapped only after both writes succeed, so a failed
  // write leaves the screen exactly as it was. Rejections are toasted here and re-thrown flagged; callers use saveFail.
  function persistVoucher(v, remove) {
    var data = S.book.data, next = data.vouchers.slice(), idx = -1;
    for (var i = 0; i < next.length; i++) if (next[i].id === v.id) { idx = i; break; }
    if (remove) { if (idx >= 0) next.splice(idx, 1); }
    else { v.updatedAt = Date.now(); if (idx >= 0) next[idx] = v; else { v.createdAt = v.createdAt || Date.now(); next.push(v); } }
    next.sort(voucherSort);
    var nextData = {}; Object.keys(data).forEach(function (k) { nextData[k] = data[k]; }); nextData.vouchers = next;
    var c = S.company, book = null;
    return TVDB.putData(nextData).then(function () {
      book = new TVModel.Book(nextData);
      var nc = {}; Object.keys(c).forEach(function (k) { nc[k] = c[k]; });
      nc.updatedAt = Date.now();
      nc.counts = { vouchers: next.length, ledgers: Object.keys(nextData.ledgers).length, groups: Object.keys(nextData.groups).length, stockItems: Object.keys(nextData.stockItems).length };
      nc.minDate = book.minDate; nc.maxDate = book.maxDate;
      return TVDB.putCompany(nc).then(function () { return nc; });
    }).then(function (nc) {
      Object.keys(nc).forEach(function (k) { c[k] = nc[k]; });
      S.book = book;
      return A.loadCompanies();
    }).catch(function (e) {
      toast('Could not save: ' + ((e && e.message) || e), 6000);
      var err = e instanceof Error ? e : new Error(String(e)); err.tvHandled = true; throw err;
    });
  }
  function saveFail(e) { if (e && e.tvHandled) return; toast('Could not save: ' + ((e && e.message) || e), 6000); }
  // entries raised here, including those Tally has since taken over (fromApp)
  function appVouchers() { return S.book.vouchers.filter(function (v) { return v.source === 'app' || v.fromApp; }); }
  function today() { var n = new Date(); return n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(); }
  function recentLedgers() { return A.lsGet('tv.recentLedgers.' + S.company.id, []); }
  function touchLedger(n) { var r = recentLedgers().filter(function (x) { return x !== n; }); r.unshift(n); A.lsSet('tv.recentLedgers.' + S.company.id, r.slice(0, 12)); }
  // Unsaved drafts survive a reload / WebView restart: tv.draft.<companyId> and tv.inv.<companyId>.
  function draftKey(kind) { return 'tv.' + kind + '.' + S.company.id; }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function draftHasContent(d) { return !!(d && (d.party || d.narration || d.number || (d.lines || []).some(function (l) { return l.ledger || +l.amount > 0; }))); }
  function invHasContent(inv) { return !!(inv && (inv.buyerLedger || inv.narration || inv.refNumber || (inv.buyer && (inv.buyer.gstin || inv.buyer.name || inv.buyer.address1)) || (inv.items || []).some(function (it) { return it.desc || it.hsn || +it.rate > 0; }))); }
  function stashDraft() { var d = S.draft; if (!d) return; if (draftHasContent(d)) A.lsSet(draftKey('draft'), d); else lsRemove(draftKey('draft')); }
  function stashInv() { var inv = S.inv; if (!inv) return; if (invHasContent(inv)) A.lsSet(draftKey('inv'), inv); else lsRemove(draftKey('inv')); }
  function resumeNotice(id, what) { return '<div class="notice" id="' + id + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>Resuming unsaved ' + esc(what) + '</span><button class="btn" data-discard style="padding:6px 12px">Discard</button></div>'; }

  /* ---- ledger picker ------------------------------------------------------ */
  function pickLedger(title, cb, filter) {
    var b = S.book;
    var bg = A.sheet('<h3>' + esc(title) + '</h3><input type="search" id="lp-q" aria-label="Search ledgers" placeholder="Type to search ' + b.ledgerNames.length + ' ledgers" autocomplete="off"><div id="lp-list" class="list" style="margin-top:10px;max-height:55vh;overflow:auto"></div>', function (ev, bgEl) {
      var row = ev.target.closest('[data-lp]'); if (!row) return;
      var name = row.getAttribute('data-lp'); touchLedger(name); bgEl.remove(); cb(name);
    });
    var q = bg.querySelector('#lp-q'), list = bg.querySelector('#lp-list');
    function draw() {
      var t = q.value.trim().toLowerCase().replace(/\s+/g, ' '), names = [], seen = {};
      function norm(n) { return n.toLowerCase().replace(/\s+/g, ' '); }
      if (!t) recentLedgers().forEach(function (n) { if (b.ledgers[n] && (!filter || filter(b.ledgers[n]))) { names.push(n); seen[n] = 1; } });
      for (var i = 0; i < b.ledgerNames.length && names.length < 40; i++) {
        var n = b.ledgerNames[i];
        if (seen[n] || (t && norm(n).indexOf(t) === -1)) continue;
        if (filter && !filter(b.ledgers[n])) continue;
        names.push(n);
      }
      list.innerHTML = names.length ? names.map(function (n) { var led = b.ledgers[n]; return '<button class="row" data-lp="' + esc(n) + '"><div class="main"><div class="t">' + esc(n) + '</div><div class="s">' + esc(led.parent || 'Primary') + (led.info && led.info.gstin ? ' · ' + esc(led.info.gstin) : '') + '</div></div></button>'; }).join('') : '<div class="empty small">No ledger matches. Ledgers must already exist in Tally.</div>';
    }
    q.oninput = draw; draw(); setTimeout(function () { q.focus(); }, 50);
  }
  // Delegated picker handler: one listener for the lifetime of the page, reading the active screen state from `cur`.
  document.addEventListener('click', function (ev) {
    var p = ev.target.closest('[data-pick],[data-ivpick],[data-gspick]'); if (!p || !S.book) return;
    var view = A.$view(); if (view && !view.contains(p)) return;
    if (p.hasAttribute('data-pick')) {
      var d = cur.draft; if (!d) return;
      var what = p.getAttribute('data-pick');
      if (what === 'party') pickLedger('Party ledger', function (n) { d.party = n; p.innerHTML = esc(n); stashDraft(); });
      else { var i = +what.split(':')[1]; if (!d.lines[i]) return; pickLedger('Ledger for line ' + (i + 1), function (n) { d.lines[i].ledger = n; stashDraft(); if (cur.renderLines) cur.renderLines(); }); }
    } else if (p.hasAttribute('data-ivpick')) {
      var inv = cur.inv; if (!inv) return;
      var k = p.getAttribute('data-ivpick');
      if (k === 'buyerLedger') { pickLedger('Buyer (debtor) ledger', function (n) { applyBuyer(inv, n); p.innerHTML = esc(n); stashInv(); if (cur.syncBuyer) cur.syncBuyer(); if (cur.refresh) cur.refresh(); }); return; }
      pickLedger(k.replace('Ledger', ' ledger'), function (n) { inv[k] = n; p.innerHTML = esc(n); stashInv(); if (cur.refresh) cur.refresh(); });
    } else {
      var st = cur.gst; if (!st) return;
      var gk = p.getAttribute('data-gspick');
      pickLedger(gk.replace('Ledger', ' ledger'), function (n) { st[gk] = n; p.innerHTML = esc(n); });
    }
  });

  /* ---- new entry chooser -------------------------------------------------- */
  A.newEntrySheet = function () {
    var h = '<h3>New entry</h3>' + ENTRY_TYPES.map(function (t) { return '<button class="opt" data-ne="' + t + '">' + t + (t === 'Sales' ? ' (accounting voucher)' : '') + '</button>'; }).join('') + '<button class="opt" data-ne="__invoice"><b>GST sales invoice / credit note</b> · e-invoice JSON + tax invoice PDF</button>';
    A.sheet(h, function (ev, bg) { var o = ev.target.closest('[data-ne]'); if (!o) return; bg.remove(); var t = o.getAttribute('data-ne'); go(t === '__invoice' ? '#/invoice' : '#/entry?type=' + encodeURIComponent(t)); });
  };

  /* ---- generic voucher entry --------------------------------------------- */
  function blankDraft(type) {
    var d = { id: 'app:' + A.uid(), source: 'app', type: type || 'Journal', date: today(), number: '', party: '', narration: '', lines: [], edit: null };
    var sides = { Payment: ['Dr', 'Cr'], Receipt: ['Cr', 'Dr'], Contra: ['Dr', 'Cr'], Journal: ['Dr', 'Cr'], Sales: ['Dr', 'Cr'], Purchase: ['Cr', 'Dr'], 'Credit Note': ['Cr', 'Dr'], 'Debit Note': ['Dr', 'Cr'] }[S.book.baseType(d.type)] || ['Dr', 'Cr'];
    d.lines = [{ side: sides[0], ledger: '', amount: 0 }, { side: sides[1], ledger: '', amount: 0 }];
    return d;
  }
  function draftFromVoucher(v) {
    return { id: v.id, source: 'app', type: v.type, date: v.date, number: v.number, party: v.party, narration: v.narration, createdAt: v.createdAt, posted: v.posted, postedAt: v.postedAt, edit: v.id,
      lines: v.entries.map(function (e) { return { side: e.amount < 0 ? 'Dr' : 'Cr', ledger: e.ledger, amount: Math.abs(e.amount) }; }), invoice: v.invoice };
  }
  function draftTotals(d) { var dr = 0, cr = 0; d.lines.forEach(function (l) { var a = +l.amount || 0; if (l.side === 'Dr') dr += a; else cr += a; }); return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100, diff: Math.round((dr - cr) * 100) / 100 }; }
  // filter(base) limits the list (the invoice form only takes Sales / Credit Note types)
  function voucherTypeOptions(sel, filter) {
    var names = Object.keys(S.book.data.voucherTypes), out = [], seen = {};
    ENTRY_TYPES.concat(names).forEach(function (n) { if (seen[n]) return; seen[n] = 1; var base = S.book.baseType(n); if (TVModel.NON_ACCOUNTING[base]) return; if (filter && !filter(base)) return; out.push(n); });
    if (sel && !seen[sel]) out.push(sel);
    return out.map(function (n) { return '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(n) + (S.book.baseType(n) !== n ? ' (' + esc(S.book.baseType(n)) + ')' : '') + '</option>'; }).join('');
  }
  function numberPlaceholder(type) { var n = S.book.nextNumber(type); return n ? 'Auto: ' + n : 'Enter number'; }
  function pickBtn(id, attr, value, empty, aria) { return '<button class="btn pick" id="' + id + '" ' + attr + (aria ? ' aria-label="' + esc(aria) + '"' : '') + '>' + (value ? esc(value) : '<span class="muted">' + empty + '</span>') + '</button>'; }
  SCREENS.entry = function (r) {
    var b = S.book, editing = r.q.edit ? b.vouchers.filter(function (v) { return v.id === r.q.edit; })[0] : null;
    if (r.q.edit && (!editing || editing.source !== 'app')) { toast('Only entries made in this app can be edited'); go('#/vouchers'); return; }
    var want = r.q.type || '', resumed = false;
    // Reuse the in-memory draft only for the same voucher being edited, or a new draft of the same base type.
    var reuse = S.draft && (editing ? S.draft.id === editing.id : (S.draft.id === S.draftNewId && !S.draft.edit && (!want || b.baseType(S.draft.type) === b.baseType(want))));
    if (!reuse) {
      var saved = S.draft ? null : A.lsGet(draftKey('draft'), null);
      if (saved && draftHasContent(saved) && (editing ? saved.edit === editing.id : !saved.edit)) { S.draft = saved; cur.resumedDraft = saved.id; }
      else S.draft = editing ? draftFromVoucher(editing) : blankDraft(want);
      S.draftNewId = editing ? null : S.draft.id;
    }
    var d = S.draft; cur.draft = d; resumed = cur.resumedDraft === d.id;
    function title() { return (editing ? 'Edit ' : 'New ') + d.type; }
    A.topbar({ title: title(), sub: S.company.name, back: true, period: false });
    var h = resumed ? resumeNotice('en-resume', d.type) : '';
    h += '<div class="card"><div class="field"><label for="en-type">Voucher type</label><select id="en-type">' + voucherTypeOptions(d.type) + '</select></div>' +
      '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="en-date">Date</label><input type="date" id="en-date" value="' + A.toISO(d.date) + '"></div><div class="field" style="flex:1"><label for="en-number">Number</label><input id="en-number" placeholder="' + esc(numberPlaceholder(d.type)) + '" value="' + esc(d.number) + '"></div></div>' +
      '<div class="field"><label for="en-party">Party (optional)</label>' + pickBtn('en-party', 'data-pick="party"', d.party, 'Choose ledger…') + '</div></div>';
    h += '<div class="card"><h2>Entries</h2><div id="en-lines"></div><div class="btn-row"><button class="btn" id="en-add">' + ico('plus') + 'Add line</button></div>' +
      '<div class="kv" style="margin-top:8px"><span>Debit total</span><span class="num" id="en-dr"></span></div><div class="kv"><span>Credit total</span><span class="num" id="en-cr"></span></div><div class="kv" aria-live="polite"><span>Difference</span><span class="num" id="en-diff"></span></div></div>';
    h += '<div class="card"><div class="field"><label for="en-narr">Narration</label><textarea id="en-narr" rows="3" style="width:100%;border:1px solid var(--border);background:var(--surface-2);border-radius:10px;padding:10px 12px">' + esc(d.narration) + '</textarea></div></div>';
    h += '<div class="btn-row"><button class="btn primary" id="en-save">Save entry</button>' + (editing ? '<button class="btn danger" id="en-delete">Delete</button>' : '') + '</div>' +
      '<p class="small muted">Saved entries post into this app\'s books at once. Send them to TallyPrime from <a href="#/pending">Entries made in app</a> (Tally XML file or Wi-Fi).</p>';
    A.$view().innerHTML = h;
    renderLines();
    var resume = document.getElementById('en-resume');
    if (resume) resume.querySelector('[data-discard]').onclick = function () { lsRemove(draftKey('draft')); S.draft = null; S.draftNewId = null; cur.resumedDraft = null; A.render(); };
    document.getElementById('en-type').onchange = function () { d.type = this.value; document.getElementById('en-number').placeholder = numberPlaceholder(d.type); A.topbar({ title: title(), sub: S.company.name, back: true, period: false }); stashDraft(); };
    document.getElementById('en-date').onchange = function () { d.date = A.fromISO(this.value) || d.date; stashDraft(); };
    document.getElementById('en-number').oninput = function () { d.number = this.value.trim(); stashDraft(); };
    document.getElementById('en-narr').oninput = function () { d.narration = this.value; stashDraft(); };
    document.getElementById('en-add').onclick = function () { var t = draftTotals(d); d.lines.push({ side: t.diff > 0 ? 'Cr' : 'Dr', ledger: '', amount: Math.abs(t.diff) || 0 }); stashDraft(); renderLines(); };
    document.getElementById('en-save').onclick = function () { saveEntry(d, editing); };
    var del = document.getElementById('en-delete'); if (del) del.onclick = function () { if (confirm('Delete this entry?')) persistVoucher(editing, true).then(function () { S.draft = null; lsRemove(draftKey('draft')); toast('Entry deleted'); go('#/pending'); }).catch(saveFail); };
    function renderLines() {
      var box = document.getElementById('en-lines'); if (!box) return;
      box.innerHTML = d.lines.map(function (l, i) {
        var n = i + 1;
        return '<div class="line"><select data-side="' + i + '" aria-label="Line ' + n + ' side"><option value="Dr"' + (l.side === 'Dr' ? ' selected' : '') + '>Dr</option><option value="Cr"' + (l.side === 'Cr' ? ' selected' : '') + '>Cr</option></select>' +
          '<button class="btn pick" data-pick="line:' + i + '" aria-label="Line ' + n + ' ledger">' + (l.ledger ? esc(l.ledger) : '<span class="muted">Ledger…</span>') + '</button>' +
          '<input type="number" inputmode="decimal" step="0.01" min="0" data-amt="' + i + '" value="' + (l.amount || '') + '" placeholder="0.00" aria-label="Line ' + n + ' amount">' +
          '<button class="x" data-rm="' + i + '" aria-label="Remove line ' + n + '">✕</button></div>';
      }).join('');
      box.querySelectorAll('[data-side]').forEach(function (el) { el.onchange = function () { d.lines[+el.getAttribute('data-side')].side = el.value; stashDraft(); totals(); }; });
      box.querySelectorAll('[data-amt]').forEach(function (el) { el.oninput = function () { d.lines[+el.getAttribute('data-amt')].amount = parseFloat(el.value) || 0; stashDraft(); totals(); }; });
      box.querySelectorAll('[data-rm]').forEach(function (el) { el.onclick = function () { d.lines.splice(+el.getAttribute('data-rm'), 1); stashDraft(); renderLines(); }; });
      totals();
    }
    cur.renderLines = renderLines;
    function totals() {
      var t = draftTotals(d);
      document.getElementById('en-dr').textContent = fmt(t.dr); document.getElementById('en-cr').textContent = fmt(t.cr);
      var el = document.getElementById('en-diff'); el.textContent = t.diff ? fmt(Math.abs(t.diff)) + (t.diff > 0 ? ' (Cr short)' : ' (Dr short)') : 'Balanced ✓'; el.className = 'num ' + (t.diff ? 'dr' : 'cr');
    }
  };
  function saveEntry(d, editing) {
    var lines = d.lines.filter(function (l) { return l.ledger || +l.amount > 0; });
    for (var i = 0; i < lines.length; i++) {
      var ln = d.lines.indexOf(lines[i]) + 1;
      if (!lines[i].ledger) { toast('Line ' + ln + ': choose a ledger'); return; }
      if (!(+lines[i].amount > 0)) { toast('Line ' + ln + ': enter an amount'); return; }
      if (!S.book.ledgers[lines[i].ledger]) { toast('Line ' + ln + ': ledger "' + lines[i].ledger + '" is not in this company'); return; }
    }
    if (d.party && !S.book.ledgers[d.party]) { toast('Party ledger "' + d.party + '" is not in this company'); return; }
    if (lines.length < 2) { toast('Enter at least two lines with a ledger and an amount'); return; }
    var t = draftTotals({ lines: lines }); if (Math.abs(t.diff) > 0.005) { toast('Debit and credit totals must match'); return; }
    if (!d.date) { toast('Pick a date'); return; }
    var number = d.number || String(S.book.nextNumber(d.type) || '');
    var v = {
      id: d.id, source: 'app', date: d.date, type: d.type, number: number, ref: '', narration: d.narration || '',
      party: d.party || '', cancelled: false, optional: false, postDated: false, action: 'Create', items: [], createdAt: d.createdAt, posted: !!d.posted && !!editing, postedAt: d.postedAt,
      entries: lines.map(function (l) { return { ledger: l.ledger, amount: l.side === 'Dr' ? -(+l.amount) : +l.amount }; })
    };
    if (editing && editing.posted) v.posted = false; // edited after posting → needs re-sending
    persistVoucher(v).then(function () { S.draft = null; S.draftNewId = null; cur.resumedDraft = null; lsRemove(draftKey('draft')); toast('Entry saved'); go('#/voucher/' + v.idx); }).catch(saveFail);
  }

  /* ---- GST sales invoice / credit note ------------------------------------ */
  function blankInvoice() {
    var st = companySettings();
    return { id: 'app:' + A.uid(), source: 'app', type: 'Sales', date: today(), number: String(S.book.nextNumber('Sales') || ''), narration: '', refNumber: '', refDate: 0,
      buyerLedger: '', buyer: { gstin: '', name: '', address1: '', address2: '', city: '', pin: '', state: '', pos: '', phone: '', email: '' },
      items: [{ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: 18 }], roundOff: true,
      salesLedger: st.salesLedger, cgstLedger: st.cgstLedger, sgstLedger: st.sgstLedger, igstLedger: st.igstLedger, roundOffLedger: st.roundOffLedger, irn: '', ackNo: '', ackDate: '', edit: null };
  }
  function invoiceInterState(inv) { var st = companySettings(); var sc = TVEntry.stateCode(st.state) || TVEntry.stateFromGstin(st.gstin); var pc = TVEntry.stateCode(inv.buyer.pos || inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin); return !!(sc && pc && sc !== pc); }
  function isCreditNote(type) { return S.book.baseType(type) === 'Credit Note'; }
  function stateSelect(id, value) { var codes = Object.keys(TVEntry.STATE_NAMES).sort(); return '<select id="' + id + '"><option value="">State…</option>' + codes.map(function (c) { var nm = TVEntry.STATE_NAMES[c]; var selv = TVEntry.stateCode(value) === c; return '<option value="' + c + '"' + (selv ? ' selected' : '') + '>' + c + ' · ' + esc(nm) + '</option>'; }).join('') + '</select>'; }
  // Fill empty buyer fields from the chosen debtor ledger's master
  function applyBuyer(inv, n) {
    inv.buyerLedger = n; var info = (S.book.ledgers[n] && S.book.ledgers[n].info) || {};
    if (!inv.buyer.name) inv.buyer.name = n;
    if (info.gstin && !inv.buyer.gstin) inv.buyer.gstin = String(info.gstin).toUpperCase();
    if (info.address && !inv.buyer.address1) inv.buyer.address1 = info.address;
    if (info.state && !inv.buyer.state) inv.buyer.state = info.state;
    if (info.pin && !inv.buyer.pin) inv.buyer.pin = String(info.pin);
    if (info.phone && !inv.buyer.phone) inv.buyer.phone = String(info.phone);
    var sc = TVEntry.stateCode(inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin); if (sc) { inv.buyer.state = sc; if (!inv.buyer.pos) inv.buyer.pos = sc; }
  }
  SCREENS.invoice = function (r) {
    var b = S.book, editing = r.q.edit ? b.vouchers.filter(function (v) { return v.id === r.q.edit; })[0] : null;
    if (r.q.edit && (!editing || !editing.invoice)) { toast('Not an invoice made in this app'); go('#/vouchers'); return; }
    var resumed = false;
    var reuse = S.inv && (editing ? S.inv.id === editing.id : (S.inv.id === S.invNewId && !S.inv.edit));
    if (!reuse) {
      var saved = S.inv ? null : A.lsGet(draftKey('inv'), null);
      if (saved && invHasContent(saved) && (editing ? saved.edit === editing.id : !saved.edit)) { S.inv = saved; cur.resumedInv = saved.id; }
      else {
        S.inv = editing ? JSON.parse(JSON.stringify(editing.invoice)) : blankInvoice();
        if (editing) { S.inv.id = editing.id; S.inv.posted = editing.posted; S.inv.createdAt = editing.createdAt; S.inv.edit = editing.id; S.inv.type = editing.type; S.inv.number = editing.number; S.inv.date = editing.date; S.inv.narration = editing.narration; }
      }
      S.invNewId = editing ? null : S.inv.id;
    }
    var inv = S.inv, st = companySettings(); cur.inv = inv; resumed = cur.resumedInv === inv.id;
    if (!inv.buyer) inv.buyer = blankInvoice().buyer;
    function title() { return (editing ? 'Edit' : 'New') + (isCreditNote(inv.type) ? ' credit note' : ' GST invoice'); }
    A.topbar({ title: title(), sub: S.company.name, back: true, period: false });
    var h = resumed ? resumeNotice('iv-resume', isCreditNote(inv.type) ? 'credit note' : 'GST invoice') : '';
    if (!st.gstin) h += '<div class="notice">Company GSTIN is not set. <a href="#/gst">Set company GST details</a> for a valid e-invoice.</div>';
    h += '<div class="card"><div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="iv-number" id="iv-number-l">' + (isCreditNote(inv.type) ? 'Note no' : 'Invoice no') + '</label><input id="iv-number" value="' + esc(inv.number) + '" placeholder="' + esc(numberPlaceholder(inv.type)) + '"></div><div class="field" style="flex:1"><label for="iv-date">Date</label><input type="date" id="iv-date" value="' + A.toISO(inv.date) + '"></div></div>' +
      '<div class="field"><label for="iv-type">Voucher type</label><select id="iv-type">' + voucherTypeOptions(inv.type, function (base) { return !!INVOICE_BASES[base]; }) + '</select></div>' +
      '<div id="iv-ref"' + (isCreditNote(inv.type) ? '' : ' hidden') + '><div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="iv-refno">Against invoice no.</label><input id="iv-refno" value="' + esc(inv.refNumber || '') + '"></div><div class="field" style="flex:1"><label for="iv-refdate">Against invoice date</label><input type="date" id="iv-refdate" value="' + (inv.refDate ? A.toISO(inv.refDate) : '') + '"></div></div><p class="small muted" style="margin-top:-6px">A credit note credits the customer and reverses sales and output tax (Rule 53 asks for the original invoice).</p></div></div>';
    h += '<div class="card"><h2>Buyer</h2><div class="field"><label for="iv-buyer">Party ledger</label>' + pickBtn('iv-buyer', 'data-ivpick="buyerLedger"', inv.buyerLedger, 'Choose debtor…') + '</div>' +
      '<div class="field"><label for="iv-gstin">GSTIN</label><input id="iv-gstin" value="' + esc(inv.buyer.gstin) + '" placeholder="29ABCDE1234F1Z5" style="text-transform:uppercase" autocapitalize="characters"></div>' +
      '<div class="field"><label for="iv-bname">Legal name</label><input id="iv-bname" value="' + esc(inv.buyer.name) + '"></div>' +
      '<div class="field"><label for="iv-addr1">Address</label><input id="iv-addr1" value="' + esc(inv.buyer.address1) + '" placeholder="Line 1"><input id="iv-addr2" aria-label="Address line 2" value="' + esc(inv.buyer.address2) + '" placeholder="Line 2" style="margin-top:6px"></div>' +
      '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="iv-city">City</label><input id="iv-city" value="' + esc(inv.buyer.city) + '"></div><div class="field" style="flex:1"><label for="iv-pin">PIN</label><input id="iv-pin" inputmode="numeric" value="' + esc(inv.buyer.pin) + '"></div></div>' +
      '<div class="field"><label for="iv-state">State</label>' + stateSelect('iv-state', inv.buyer.state || TVEntry.stateFromGstin(inv.buyer.gstin)) + '</div>' +
      '<div class="field"><label for="iv-pos">Place of supply</label>' + stateSelect('iv-pos', inv.buyer.pos || inv.buyer.state || TVEntry.stateFromGstin(inv.buyer.gstin)) + '</div>' +
      '<div class="kv"><span>Tax type</span><span id="iv-taxtype"></span></div></div>';
    h += '<div class="card"><h2>Items</h2><div id="iv-items"></div><div class="btn-row"><button class="btn" id="iv-add">' + ico('plus') + 'Add item</button></div></div>';
    h += '<div class="card"><h2>Ledgers to post</h2>' +
      '<div class="field"><label for="iv-sales">Sales ledger</label>' + pickBtn('iv-sales', 'data-ivpick="salesLedger"', inv.salesLedger, 'Choose…') + '</div>' +
      '<div id="iv-taxledgers"></div>' +
      '<div class="field"><label for="iv-round">Round off ledger (optional)</label>' + pickBtn('iv-round', 'data-ivpick="roundOffLedger"', inv.roundOffLedger, 'None (no rounding)') + '</div></div>';
    h += '<div class="card" id="iv-totals"></div>';
    h += '<div class="card"><div class="field"><label for="iv-narr">Narration</label><input id="iv-narr" value="' + esc(inv.narration) + '"></div></div>';
    h += '<div class="btn-row"><button class="btn primary" id="iv-save">' + (isCreditNote(inv.type) ? 'Save credit note' : 'Save invoice') + '</button>' + (editing ? '<button class="btn danger" id="iv-delete">Delete</button>' : '') + '</div>';
    A.$view().innerHTML = h;
    var $ = function (id) { return document.getElementById(id); };
    function bind() {
      var resume = $('iv-resume');
      if (resume) resume.querySelector('[data-discard]').onclick = function () { lsRemove(draftKey('inv')); S.inv = null; S.invNewId = null; cur.resumedInv = null; A.render(); };
      $('iv-number').oninput = function () { inv.number = this.value.trim(); stashInv(); };
      $('iv-date').onchange = function () { inv.date = A.fromISO(this.value) || inv.date; stashInv(); };
      $('iv-type').onchange = function () {
        inv.type = this.value; var cn = isCreditNote(inv.type);
        $('iv-ref').hidden = !cn; $('iv-number-l').textContent = cn ? 'Note no' : 'Invoice no'; $('iv-number').placeholder = numberPlaceholder(inv.type); $('iv-save').textContent = cn ? 'Save credit note' : 'Save invoice';
        A.topbar({ title: title(), sub: S.company.name, back: true, period: false }); stashInv();
      };
      $('iv-refno').oninput = function () { inv.refNumber = this.value.trim(); stashInv(); };
      $('iv-refdate').onchange = function () { inv.refDate = A.fromISO(this.value) || 0; stashInv(); };
      $('iv-gstin').oninput = function () { inv.buyer.gstin = this.value.trim().toUpperCase(); var sc = TVEntry.stateFromGstin(inv.buyer.gstin); if (sc && !inv.buyer.state) { inv.buyer.state = sc; $('iv-state').value = sc; } if (sc && !inv.buyer.pos) { inv.buyer.pos = sc; $('iv-pos').value = sc; } stashInv(); refresh(); };
      ['bname:name', 'addr1:address1', 'addr2:address2', 'city:city', 'pin:pin'].forEach(function (p) { var id = p.split(':')[0], k = p.split(':')[1]; $('iv-' + id).oninput = function () { inv.buyer[k] = this.value; stashInv(); }; });
      $('iv-state').onchange = function () { inv.buyer.state = this.value; if (!inv.buyer.pos || $('iv-pos').value === '') { inv.buyer.pos = this.value; $('iv-pos').value = this.value; } stashInv(); refresh(); };
      $('iv-pos').onchange = function () { inv.buyer.pos = this.value; stashInv(); refresh(); };
      $('iv-narr').oninput = function () { inv.narration = this.value; stashInv(); };
      $('iv-add').onclick = function () { inv.items.push({ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: inv.items.length ? inv.items[inv.items.length - 1].gstRate : 18 }); stashInv(); renderItems(); };
      $('iv-save').onclick = function () { saveInvoice(inv, editing); };
      var del = $('iv-delete'); if (del) del.onclick = function () { if (confirm('Delete this ' + (isCreditNote(inv.type) ? 'credit note' : 'invoice') + '?')) persistVoucher(editing, true).then(function () { S.inv = null; lsRemove(draftKey('inv')); toast('Deleted'); go('#/pending'); }).catch(saveFail); };
    }
    // Buyer pick: refresh the buyer inputs in place (no re-render of the whole form)
    function syncBuyerInputs() {
      $('iv-gstin').value = inv.buyer.gstin || ''; $('iv-bname').value = inv.buyer.name || ''; $('iv-addr1').value = inv.buyer.address1 || ''; $('iv-addr2').value = inv.buyer.address2 || '';
      $('iv-city').value = inv.buyer.city || ''; $('iv-pin').value = inv.buyer.pin || '';
      $('iv-state').value = TVEntry.stateCode(inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin) || ''; $('iv-pos').value = TVEntry.stateCode(inv.buyer.pos || inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin) || '';
    }
    var UQC_LIST = '<datalist id="iv-uqc">' + (TVEntry.UQC || ['NOS', 'PCS', 'KGS', 'LTR', 'MTR', 'OTH']).map(function (u) { return '<option value="' + u + '">'; }).join('') + '</datalist>';
    function renderItems() {
      var box = $('iv-items');
      box.innerHTML = UQC_LIST + inv.items.map(function (it, i) {
        var n = i + 1;
        return '<div class="item"><div class="item-head"><b>Item ' + n + '</b><button class="x" data-irm="' + i + '" aria-label="Remove item ' + n + '">✕</button></div>' +
          '<input data-if="desc:' + i + '" value="' + esc(it.desc) + '" placeholder="Description" aria-label="Item ' + n + ' description">' +
          '<div class="grid3"><input data-if="hsn:' + i + '" value="' + esc(it.hsn) + '" placeholder="HSN/SAC" inputmode="numeric" aria-label="Item ' + n + ' HSN or SAC"><label class="chk"><input type="checkbox" data-if="isService:' + i + '"' + (it.isService ? ' checked' : '') + '> Service</label><select data-if="gstRate:' + i + '" aria-label="Item ' + n + ' GST rate">' + GST_RATES.map(function (g) { return '<option value="' + g + '"' + (+it.gstRate === g ? ' selected' : '') + '>GST ' + g + '%</option>'; }).join('') + '</select></div>' +
          '<div class="grid3"><input data-if="qty:' + i + '" type="number" inputmode="decimal" step="0.001" value="' + (it.qty || '') + '" placeholder="Qty" aria-label="Item ' + n + ' quantity"><input data-if="unit:' + i + '" list="iv-uqc" value="' + esc(it.unit) + '" placeholder="Unit" autocapitalize="characters" aria-label="Item ' + n + ' unit"><input data-if="rate:' + i + '" type="number" inputmode="decimal" step="0.01" value="' + (it.rate || '') + '" placeholder="Rate" aria-label="Item ' + n + ' rate"></div>' +
          '<div class="grid3"><input data-if="discount:' + i + '" type="number" inputmode="decimal" step="0.01" value="' + (it.discount || '') + '" placeholder="Discount ₹" aria-label="Item ' + n + ' discount"><div class="kv" style="grid-column:span 2"><span>Taxable</span><span class="num" data-itax="' + i + '"></span></div></div></div>';
      }).join('');
      box.querySelectorAll('[data-if]').forEach(function (el) {
        var k = el.getAttribute('data-if').split(':')[0], i = +el.getAttribute('data-if').split(':')[1];
        el[el.type === 'checkbox' || el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = function () {
          var it = inv.items[i];
          if (el.type === 'checkbox') { it.isService = el.checked; if (it.isService && it.unit === 'NOS') { it.unit = 'OTH'; } }
          else if (k === 'qty' || k === 'rate' || k === 'discount' || k === 'gstRate') it[k] = parseFloat(el.value) || 0;
          else if (k === 'unit') it.unit = el.value.trim().toUpperCase();
          else it[k] = el.value;
          stashInv(); refresh();
        };
      });
      box.querySelectorAll('[data-irm]').forEach(function (el) { el.onclick = function () { inv.items.splice(+el.getAttribute('data-irm'), 1); if (!inv.items.length) inv.items.push({ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: 18 }); stashInv(); renderItems(); }; });
      refresh();
    }
    function refresh() {
      if (!$('iv-totals')) return;
      var inter = invoiceInterState(inv); inv.interState = inter; inv.roundOff = !!inv.roundOffLedger;
      var calc = TVEntry.computeInvoice(inv), t = calc.totals, cn = isCreditNote(inv.type);
      $('iv-taxtype').textContent = inter ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST';
      calc.items.forEach(function (it, i) { var el = document.querySelector('[data-itax="' + i + '"]'); if (el) el.textContent = fmt(it.taxable) + ' + tax ' + fmt(it.cgst + it.sgst + it.igst); });
      $('iv-taxledgers').innerHTML = inter
        ? '<div class="field"><label for="iv-igst">IGST ledger</label>' + pickBtn('iv-igst', 'data-ivpick="igstLedger"', inv.igstLedger, 'Choose…') + '</div>'
        : '<div class="field"><label for="iv-cgst">CGST ledger</label>' + pickBtn('iv-cgst', 'data-ivpick="cgstLedger"', inv.cgstLedger, 'Choose…') + '</div><div class="field"><label for="iv-sgst">SGST ledger</label>' + pickBtn('iv-sgst', 'data-ivpick="sgstLedger"', inv.sgstLedger, 'Choose…') + '</div>';
      $('iv-totals').innerHTML = '<h2>Totals</h2><div class="kv"><span>Taxable value</span><span class="num">' + fmt(t.taxable) + '</span></div>' +
        (inter ? '<div class="kv"><span>IGST</span><span class="num">' + fmt(t.igst) + '</span></div>' : '<div class="kv"><span>CGST</span><span class="num">' + fmt(t.cgst) + '</span></div><div class="kv"><span>SGST</span><span class="num">' + fmt(t.sgst) + '</span></div>') +
        (t.roundOff ? '<div class="kv"><span>Round off</span><span class="num">' + fmt(t.roundOff) + '</span></div>' : '') +
        '<div class="kv"><span><b>' + (cn ? 'Credit note total' : 'Invoice total') + '</b></span><span class="num" style="font-weight:700">' + cash(t.total) + '</span></div><div class="small muted">' + esc(TVEntry.amountInWords(t.total)) + (cn ? ' · credited to the customer' : '') + '</div>';
    }
    cur.refresh = refresh; cur.syncBuyer = syncBuyerInputs;
    bind(); renderItems();
  };
  function invoiceEntries(inv) { return TVEntry.invoiceEntries(inv, isCreditNote(inv.type) ? -1 : 1); }
  function saveInvoice(inv, editing) {
    var cn = isCreditNote(inv.type);
    var need = [['buyerLedger', 'party ledger'], ['salesLedger', 'sales ledger']].concat(inv.interState ? [['igstLedger', 'IGST ledger']] : [['cgstLedger', 'CGST ledger'], ['sgstLedger', 'SGST ledger']]);
    for (var i = 0; i < need.length; i++) {
      if (!inv[need[i][0]]) { toast('Choose the ' + need[i][1]); return; }
      if (!S.book.ledgers[inv[need[i][0]]]) { toast('The ' + need[i][1] + ' "' + inv[need[i][0]] + '" is not in this company'); return; }
    }
    if (inv.roundOffLedger && !S.book.ledgers[inv.roundOffLedger]) { toast('The round off ledger "' + inv.roundOffLedger + '" is not in this company'); return; }
    if (!inv.items.some(function (it) { return +it.qty > 0 && +it.rate > 0; })) { toast('Add at least one item with quantity and rate'); return; }
    if (!inv.number) { toast((cn ? 'Note' : 'Invoice') + ' number is required'); return; }
    if (!inv.date) { toast('Pick a date'); return; }
    inv.interState = invoiceInterState(inv); inv.roundOff = !!inv.roundOffLedger;
    var entries = invoiceEntries(inv), sum = 0; entries.forEach(function (x) { sum += x.amount; });
    if (Math.abs(sum) > 0.01) { toast('Internal error: ' + (cn ? 'credit note' : 'invoice') + ' does not balance'); return; }
    var v = { id: inv.id, source: 'app', date: inv.date, type: inv.type, number: inv.number, ref: cn && inv.refNumber ? inv.refNumber : '', narration: inv.narration || '', party: inv.buyerLedger, cancelled: false, optional: false, postDated: false, action: 'Create', items: [], entries: entries, invoice: inv, createdAt: inv.createdAt, posted: false };
    delete inv.posted; delete inv.createdAt; delete inv.edit;
    if (!cn) { inv.refNumber = ''; inv.refDate = 0; }
    persistVoucher(v).then(function () { S.inv = null; S.invNewId = null; cur.resumedInv = null; lsRemove(draftKey('inv')); toast(cn ? 'Credit note saved' : 'Invoice saved'); go('#/voucher/' + v.idx); }).catch(saveFail);
  }

  /* ---- e-invoice JSON, invoice PDF, IRN -------------------------------- */
  function einvoiceDoc(v) {
    var st = companySettings(), inv = v.invoice, base = S.book.baseType(v.type);
    return { number: v.number, date: v.date, docType: base === 'Credit Note' ? 'CRN' : base === 'Debit Note' ? 'DBN' : 'INV', refNumber: inv.refNumber || '', refDate: inv.refDate || 0, items: inv.items, interState: inv.interState, roundOff: inv.roundOff,
      seller: { gstin: st.gstin, name: st.legalName, tradeName: st.tradeName, address1: st.address1, address2: st.address2, city: st.city, pin: st.pin, state: st.state, phone: st.phone, email: st.email },
      buyer: inv.buyer, irn: inv.irn, ackNo: inv.ackNo, ackDate: inv.ackDate, narration: v.narration };
  }
  A.exportEInvoice = function (v) {
    var doc = einvoiceDoc(v), problems = TVEntry.eInvoiceChecks(doc);
    if (problems.length && !confirm('The IRP will reject this e-invoice:\n\n' + problems.join('\n') + '\n\nGenerate the JSON anyway?')) return;
    var json = JSON.stringify([TVEntry.eInvoiceJson(doc)], null, 2);
    A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - e-invoice ' + v.number + '.json'), new Blob([json], { type: 'application/json' })));
  };
  A.exportInvoicePdf = function (v) { var doc = einvoiceDoc(v); A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - ' + (doc.docType === 'CRN' ? 'Credit note ' : 'Invoice ') + v.number + '.pdf'), TVEntry.invoicePdf(doc, TVExport))); };
  A.enterIrn = function (v) {
    var inv = v.invoice;
    A.sheet('<h3>IRN details from the e-invoice portal</h3><div class="field"><label for="irn-irn">IRN (64 characters)</label><input id="irn-irn" value="' + esc(inv.irn || '') + '"></div><div class="field"><label for="irn-ack">Acknowledgement no.</label><input id="irn-ack" value="' + esc(inv.ackNo || '') + '"></div><div class="field"><label for="irn-date">Acknowledgement date</label><input id="irn-date" value="' + esc(inv.ackDate || '') + '" placeholder="dd/mm/yyyy hh:mm"></div><button class="btn primary block" id="irn-save">Save</button>', function (ev, bg) {
      if (ev.target.id !== 'irn-save') return;
      var irn = document.getElementById('irn-irn').value.trim(), ack = document.getElementById('irn-ack').value.trim(), dt = document.getElementById('irn-date').value.trim();
      if (irn && !/^[0-9a-f]{64}$/i.test(irn)) { toast('An IRN is 64 hexadecimal characters'); return; }
      var prev = { irn: inv.irn, ackNo: inv.ackNo, ackDate: inv.ackDate };
      inv.irn = irn; inv.ackNo = ack; inv.ackDate = dt;
      bg.remove(); persistVoucher(v).then(function () { toast('IRN saved'); A.render(); }).catch(function (e) { inv.irn = prev.irn; inv.ackNo = prev.ackNo; inv.ackDate = prev.ackDate; saveFail(e); });
    });
  };

  /* ---- sending entries to Tally ------------------------------------------ */
  A.exportTallyXml = function (list) {
    if (!list.length) { toast('Nothing to export'); return; }
    var xml = TVEntry.tallyXml(list, S.company.name);
    A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - ' + list.length + ' vouchers for Tally.xml'), new Blob([xml], { type: 'text/xml' })));
  };
  // Flip posted flags on the shared voucher objects, write, and roll back if the write fails.
  function markPosted(list) {
    var prev = list.map(function (v) { return { posted: v.posted, postedAt: v.postedAt }; });
    list.forEach(function (v) { v.posted = true; v.postedAt = Date.now(); });
    return TVDB.putData(S.book.data).then(function () { S.book = new TVModel.Book(S.book.data); }).catch(function (e) {
      list.forEach(function (v, i) { v.posted = prev[i].posted; v.postedAt = prev[i].postedAt; });
      throw e;
    });
  }
  A.postToTally = function (list) {
    if (!list.length) { toast('Nothing to post'); return; }
    if (!A.hasBridge()) { toast('Posting over Wi-Fi needs the Android app. Export Tally XML instead.', 5000); return; }
    var sync = A.lsGet('tv.sync', { host: '', port: '9000' });
    if (!sync.host) { toast('Set the PC address in Sync from Tally first', 4000); go('#/sync'); return; }
    toast('Posting ' + list.length + ' voucher(s) to Tally…');
    A.tallyRequest(sync.host, sync.port, TVEntry.tallyXml(list, S.company.name)).then(function (buf) {
      var txt = TallyParse.decodeBuffer(buf).text, created = +((/<CREATED>(\d+)<\/CREATED>/.exec(txt) || [])[1] || 0), altered = +((/<ALTERED>(\d+)<\/ALTERED>/.exec(txt) || [])[1] || 0), errors = +((/<ERRORS>(\d+)<\/ERRORS>/.exec(txt) || [])[1] || 0);
      var lineErr = (/<LINEERROR>([\s\S]*?)<\/LINEERROR>/.exec(txt) || [])[1];
      if (created + altered >= list.length && !errors) {
        return markPosted(list).then(function () { toast('Tally accepted ' + (created + altered) + ' voucher(s)'); A.render(); }, function (e) { toast('Tally accepted the vouchers but the status could not be saved: ' + e.message, 7000); });
      }
      toast('Tally created ' + created + ', errors ' + errors + (lineErr ? ': ' + lineErr.slice(0, 160) : ''), 8000);
    }).catch(function (e) { toast('Could not reach Tally: ' + e.message, 6000); });
  };

  /* ---- pending list ------------------------------------------------------- */
  function voucherStatus(v) { return v.fromApp || v.superseded ? 'in Tally · matched' : v.posted ? 'sent to Tally' : 'pending'; }
  SCREENS.pending = function () {
    var list = appVouchers().slice().reverse(), pending = list.filter(function (v) { return v.source === 'app' && !v.posted && !v.superseded; });
    A.topbar({ title: 'Entries made in app', sub: S.company.name, back: true, period: false });
    var newBtn = '<button class="btn primary" data-act2="new">' + ico('plus') + 'New entry</button>';
    var h = '';
    if (!list.length) h += A.emptyState ? A.emptyState('entry', 'No entries yet', 'Pass a journal, payment, receipt or a GST invoice and it shows up here, ready to send to TallyPrime.', '<div class="btn-row" style="justify-content:center">' + newBtn + '</div>') : '<div class="empty"><p><b>No entries yet</b></p><p class="small">Pass a journal, payment, receipt or a GST invoice and it shows up here.</p>' + newBtn + '</div>';
    else {
      h += '<div class="btn-row">' + newBtn + '</div>';
      h += '<div class="card"><div class="kv"><span>Not yet in Tally</span><span><b>' + pending.length + '</b></span></div><div class="btn-row"><button class="btn" data-act2="xml">Tally XML (' + pending.length + ')</button><button class="btn" data-act2="post">Post to Tally over Wi-Fi</button><button class="btn" data-act2="markall">Mark all as imported</button></div>' +
        '<p class="small muted" style="margin-top:8px">Tally XML: import on the PC via Gateway of Tally → Import → Vouchers. Ledgers must already exist in Tally with the same names. Entries marked "in Tally · matched" were found in the data copied back from Tally and are counted only once.</p></div>';
      h += '<div class="list">' + list.map(function (v) {
        return '<button class="row" data-voucher="' + v.idx + '"><span class="badge" data-base="' + esc(v.base || '') + '">' + esc(v.type) + '</span><div class="main"><div class="t">' + esc(v.party || (v.entries[0] && v.entries[0].ledger) || v.type) + (v.invoice && v.invoice.irn ? ' · IRN ✓' : '') + '</div><div class="s">' + A.fmtDate(v.date) + ' · #' + esc(v.number) + ' · ' + voucherStatus(v) + '</div></div><div class="amt"><div class="v num">' + fmt(v.total) + '</div></div><span class="chev">›</span></button>';
      }).join('') + '</div>';
    }
    A.$view().innerHTML = h;
    A.$view().querySelectorAll('[data-act2]').forEach(function (el) { el.onclick = function () {
      var a = el.getAttribute('data-act2');
      if (a === 'new') A.newEntrySheet(); else if (a === 'xml') A.exportTallyXml(pending); else if (a === 'post') A.postToTally(pending);
      else if (a === 'markall') { if (pending.length && confirm('Mark all ' + pending.length + ' pending entries as already imported into Tally?')) markPosted(pending).then(function () { toast('Marked as imported'); A.render(); }).catch(saveFail); }
    }; });
  };

  /* ---- company GST settings ---------------------------------------------- */
  SCREENS.gst = function () {
    var st = companySettings(); cur.gst = st;
    A.topbar({ title: 'Company GST details', sub: S.company.name, back: true, period: false });
    function f(id, label, val, extra) { return '<div class="field"><label for="gs-' + id + '">' + label + '</label><input id="gs-' + id + '" value="' + esc(val || '') + '"' + (extra || '') + '></div>'; }
    var h = '<div class="card"><h2>Seller details (printed on invoices, used in e-invoice JSON)</h2>' + f('gstin', 'GSTIN', st.gstin, ' style="text-transform:uppercase" autocapitalize="characters"') + f('legalName', 'Legal name', st.legalName) + f('tradeName', 'Trade name', st.tradeName) + f('address1', 'Address line 1', st.address1) + f('address2', 'Address line 2', st.address2) + f('city', 'City', st.city) + f('pin', 'PIN code', st.pin, ' inputmode="numeric"') +
      '<div class="field"><label for="gs-state">State</label>' + stateSelect('gs-state', st.state) + '</div>' + f('phone', 'Phone', st.phone, ' inputmode="tel"') + f('email', 'Email', st.email, ' inputmode="email"') + '</div>';
    h += '<div class="card"><h2>Default ledgers for invoices</h2>' + ['salesLedger:Sales ledger', 'cgstLedger:Output CGST ledger', 'sgstLedger:Output SGST ledger', 'igstLedger:Output IGST ledger', 'roundOffLedger:Round off ledger'].map(function (p) { var k = p.split(':')[0], l = p.split(':')[1]; return '<div class="field"><label for="gs-' + k + '">' + l + '</label>' + pickBtn('gs-' + k, 'data-gspick="' + k + '"', st[k], 'Choose…') + '</div>'; }).join('') + '</div>';
    h += '<div class="btn-row"><button class="btn primary" id="gs-save">Save</button></div>';
    A.$view().innerHTML = h;
    document.getElementById('gs-save').onclick = function () {
      ['gstin', 'legalName', 'tradeName', 'address1', 'address2', 'city', 'pin', 'phone', 'email'].forEach(function (k) { st[k] = document.getElementById('gs-' + k).value.trim(); });
      st.gstin = st.gstin.toUpperCase(); st.state = document.getElementById('gs-state').value;
      if (st.gstin && !TVEntry.validGstin(st.gstin)) { toast('GSTIN format looks wrong'); return; }
      if (st.pin && !/^\d{6}$/.test(st.pin)) { toast('PIN code must be 6 digits'); return; }
      saveSettings(st).then(function () { toast('Saved'); history.back(); }).catch(saveFail);
    };
  };

  A.appVouchers = appVouchers; A.persistVoucher = persistVoucher; A.companySettings = companySettings; A.einvoiceDoc = einvoiceDoc; A.isCreditNote = isCreditNote;
})();
