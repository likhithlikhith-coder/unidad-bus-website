/* Voucher entry, GST sales invoice, e-invoice and pending-entries screens. Uses the TVApp bridge from app.js. */
(function () {
  'use strict';
  var A = window.TVApp, S = A.S, SCREENS = A.SCREENS, esc = A.esc, fmt = A.fmt, toast = A.toast, go = A.go;
  var GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28];
  var ENTRY_TYPES = ['Journal', 'Payment', 'Receipt', 'Contra', 'Sales', 'Purchase', 'Credit Note', 'Debit Note'];
  A.NEEDS_BOOK.entry = 1; A.NEEDS_BOOK.invoice = 1; A.NEEDS_BOOK.pending = 1; A.NEEDS_BOOK.gst = 1;

  /* ---- persistence -------------------------------------------------------- */
  function companySettings() { var c = S.company, info = (c && c.info) || {}; var st = (c && c.settings) || {}; return {
    gstin: st.gstin || info.gstin || '', legalName: st.legalName || (c ? c.name : ''), tradeName: st.tradeName || (c ? c.name : ''),
    address1: st.address1 || info.address || '', address2: st.address2 || '', city: st.city || info.city || '', pin: st.pin || info.pin || '', state: st.state || info.state || '',
    phone: st.phone || info.phone || '', email: st.email || '', salesLedger: st.salesLedger || '', cgstLedger: st.cgstLedger || '', sgstLedger: st.sgstLedger || '', igstLedger: st.igstLedger || '', roundOffLedger: st.roundOffLedger || ''
  }; }
  function saveSettings(st) { S.company.settings = st; S.company.updatedAt = Date.now(); return TVDB.putCompany(S.company).then(A.loadCompanies); }
  // Upsert (or delete) an app-created voucher in the open company and rebuild the book.
  function persistVoucher(v, remove) {
    var data = S.book.data, idx = -1;
    for (var i = 0; i < data.vouchers.length; i++) if (data.vouchers[i].id === v.id) { idx = i; break; }
    if (remove) { if (idx >= 0) data.vouchers.splice(idx, 1); }
    else { v.updatedAt = Date.now(); if (idx >= 0) data.vouchers[idx] = v; else { v.createdAt = v.createdAt || Date.now(); data.vouchers.push(v); } }
    data.vouchers.sort(function (a, b) { return a.date - b.date || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); });
    var book = new TVModel.Book(data); S.book = book;
    var c = S.company; c.updatedAt = Date.now();
    c.counts = { vouchers: data.vouchers.length, ledgers: Object.keys(data.ledgers).length, groups: Object.keys(data.groups).length, stockItems: Object.keys(data.stockItems).length };
    c.minDate = book.minDate; c.maxDate = book.maxDate;
    return TVDB.putData(data).then(function () { return TVDB.putCompany(c); }).then(A.loadCompanies);
  }
  function appVouchers() { return S.book.vouchers.filter(function (v) { return v.source === 'app'; }); }
  function today() { var n = new Date(); return n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(); }
  function recentLedgers() { return A.lsGet('tv.recentLedgers.' + S.company.id, []); }
  function touchLedger(n) { var r = recentLedgers().filter(function (x) { return x !== n; }); r.unshift(n); A.lsSet('tv.recentLedgers.' + S.company.id, r.slice(0, 12)); }

  /* ---- ledger picker ------------------------------------------------------ */
  function pickLedger(title, cb, filter) {
    var b = S.book;
    var bg = A.sheet('<h3>' + esc(title) + '</h3><input type="search" id="lp-q" placeholder="Type to search ' + b.ledgerNames.length + ' ledgers" autocomplete="off"><div id="lp-list" class="list" style="margin-top:10px;max-height:55vh;overflow:auto"></div>', function (ev, bgEl) {
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

  /* ---- new entry chooser -------------------------------------------------- */
  A.newEntrySheet = function () {
    var h = '<h3>New entry</h3>' + ENTRY_TYPES.map(function (t) { return '<button class="opt" data-ne="' + t + '">' + t + (t === 'Sales' ? ' (accounting voucher)' : '') + '</button>'; }).join('') + '<button class="opt" data-ne="__invoice"><b>GST sales invoice</b> · e-invoice JSON + tax invoice PDF</button>';
    A.sheet(h, function (ev, bg) { var o = ev.target.closest('[data-ne]'); if (!o) return; bg.remove(); var t = o.getAttribute('data-ne'); go(t === '__invoice' ? '#/invoice' : '#/entry?type=' + encodeURIComponent(t)); });
  };

  /* ---- generic voucher entry --------------------------------------------- */
  function blankDraft(type) {
    var d = { id: 'app:' + A.uid(), source: 'app', type: type || 'Journal', date: today(), number: '', party: '', narration: '', lines: [] };
    var sides = { Payment: ['Dr', 'Cr'], Receipt: ['Cr', 'Dr'], Contra: ['Dr', 'Cr'], Journal: ['Dr', 'Cr'], Sales: ['Dr', 'Cr'], Purchase: ['Cr', 'Dr'], 'Credit Note': ['Cr', 'Dr'], 'Debit Note': ['Dr', 'Cr'] }[d.type] || ['Dr', 'Cr'];
    d.lines = [{ side: sides[0], ledger: '', amount: 0 }, { side: sides[1], ledger: '', amount: 0 }];
    return d;
  }
  function draftFromVoucher(v) {
    return { id: v.id, source: 'app', type: v.type, date: v.date, number: v.number, party: v.party, narration: v.narration, createdAt: v.createdAt, posted: v.posted, postedAt: v.postedAt,
      lines: v.entries.map(function (e) { return { side: e.amount < 0 ? 'Dr' : 'Cr', ledger: e.ledger, amount: Math.abs(e.amount) }; }), invoice: v.invoice };
  }
  function draftTotals(d) { var dr = 0, cr = 0; d.lines.forEach(function (l) { var a = +l.amount || 0; if (l.side === 'Dr') dr += a; else cr += a; }); return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100, diff: Math.round((dr - cr) * 100) / 100 }; }
  function voucherTypeOptions(sel) {
    var names = Object.keys(S.book.data.voucherTypes), out = [], seen = {};
    ENTRY_TYPES.concat(names).forEach(function (n) { if (seen[n]) return; seen[n] = 1; var base = S.book.baseType(n); if (TVModel.NON_ACCOUNTING[base]) return; out.push(n); });
    return out.map(function (n) { return '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(n) + (S.book.baseType(n) !== n ? ' (' + esc(S.book.baseType(n)) + ')' : '') + '</option>'; }).join('');
  }
  SCREENS.entry = function (r) {
    var b = S.book, editing = r.q.edit ? b.vouchers.filter(function (v) { return v.id === r.q.edit; })[0] : null;
    if (r.q.edit && (!editing || editing.source !== 'app')) { toast('Only entries made in this app can be edited'); go('#/vouchers'); return; }
    if (!S.draft || S.draft.id !== (editing ? editing.id : S.draftNewId)) { S.draft = editing ? draftFromVoucher(editing) : blankDraft(r.q.type); S.draftNewId = editing ? null : S.draft.id; }
    var d = S.draft;
    A.topbar({ title: (editing ? 'Edit ' : 'New ') + d.type, sub: S.company.name, back: true, period: false });
    var h = '<div class="card"><div class="field"><label>Voucher type</label><select id="en-type">' + voucherTypeOptions(d.type) + '</select></div>' +
      '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Date</label><input type="date" id="en-date" value="' + A.toISO(d.date) + '"></div><div class="field" style="flex:1"><label>Number</label><input id="en-number" placeholder="Auto: ' + b.nextNumber(d.type) + '" value="' + esc(d.number) + '"></div></div>' +
      '<div class="field"><label>Party (optional)</label><button class="btn pick" data-pick="party">' + (d.party ? esc(d.party) : '<span class="muted">Choose ledger…</span>') + '</button></div></div>';
    h += '<div class="card"><h2>Entries</h2><div id="en-lines"></div><div class="btn-row"><button class="btn" id="en-add">＋ Add line</button></div>' +
      '<div class="kv" style="margin-top:8px"><span>Debit total</span><span class="num" id="en-dr"></span></div><div class="kv"><span>Credit total</span><span class="num" id="en-cr"></span></div><div class="kv"><span>Difference</span><span class="num" id="en-diff"></span></div></div>';
    h += '<div class="card"><div class="field"><label>Narration</label><textarea id="en-narr" rows="3" style="width:100%;border:1px solid var(--border);background:var(--surface-2);border-radius:10px;padding:10px 12px">' + esc(d.narration) + '</textarea></div></div>';
    h += '<div class="btn-row"><button class="btn primary" id="en-save">Save entry</button>' + (editing ? '<button class="btn danger" id="en-delete">Delete</button>' : '') + '</div>' +
      '<p class="small muted">Saved entries post into this app\'s books at once. Send them to TallyPrime from <a href="#/pending">Entries made in app</a> (Tally XML file or Wi-Fi).</p>';
    A.$view().innerHTML = h;
    renderLines();
    document.getElementById('en-type').onchange = function () { d.type = this.value; document.getElementById('en-number').placeholder = 'Auto: ' + b.nextNumber(d.type); A.topbar({ title: (editing ? 'Edit ' : 'New ') + d.type, sub: S.company.name, back: true, period: false }); };
    document.getElementById('en-date').onchange = function () { d.date = A.fromISO(this.value) || d.date; };
    document.getElementById('en-number').oninput = function () { d.number = this.value.trim(); };
    document.getElementById('en-narr').oninput = function () { d.narration = this.value; };
    document.getElementById('en-add').onclick = function () { var t = draftTotals(d); d.lines.push({ side: t.diff > 0 ? 'Cr' : 'Dr', ledger: '', amount: Math.abs(t.diff) || 0 }); renderLines(); };
    document.getElementById('en-save').onclick = function () { saveEntry(d, editing); };
    var del = document.getElementById('en-delete'); if (del) del.onclick = function () { if (confirm('Delete this entry?')) persistVoucher(editing, true).then(function () { S.draft = null; toast('Entry deleted'); go('#/pending'); }); };
    function renderLines() {
      var box = document.getElementById('en-lines');
      box.innerHTML = d.lines.map(function (l, i) {
        return '<div class="line"><select data-side="' + i + '"><option' + (l.side === 'Dr' ? ' selected' : '') + '>Dr</option><option' + (l.side === 'Cr' ? ' selected' : '') + '>Cr</option></select>' +
          '<button class="btn pick" data-pick="line:' + i + '">' + (l.ledger ? esc(l.ledger) : '<span class="muted">Ledger…</span>') + '</button>' +
          '<input type="number" inputmode="decimal" step="0.01" min="0" data-amt="' + i + '" value="' + (l.amount || '') + '" placeholder="0.00">' +
          '<button class="x" data-rm="' + i + '" aria-label="Remove">✕</button></div>';
      }).join('');
      box.querySelectorAll('[data-side]').forEach(function (el) { el.onchange = function () { d.lines[+el.getAttribute('data-side')].side = el.value; totals(); }; });
      box.querySelectorAll('[data-amt]').forEach(function (el) { el.oninput = function () { d.lines[+el.getAttribute('data-amt')].amount = parseFloat(el.value) || 0; totals(); }; });
      box.querySelectorAll('[data-rm]').forEach(function (el) { el.onclick = function () { d.lines.splice(+el.getAttribute('data-rm'), 1); renderLines(); }; });
      totals();
    }
    function totals() {
      var t = draftTotals(d);
      document.getElementById('en-dr').textContent = fmt(t.dr); document.getElementById('en-cr').textContent = fmt(t.cr);
      var el = document.getElementById('en-diff'); el.textContent = t.diff ? fmt(Math.abs(t.diff)) + (t.diff > 0 ? ' (Cr short)' : ' (Dr short)') : 'Balanced ✓'; el.className = 'num ' + (t.diff ? 'dr' : 'cr');
    }
    A.$view().addEventListener('click', function (ev) {
      var p = ev.target.closest('[data-pick]'); if (!p) return;
      var what = p.getAttribute('data-pick');
      if (what === 'party') pickLedger('Party ledger', function (n) { d.party = n; p.innerHTML = esc(n); });
      else { var i = +what.split(':')[1]; pickLedger('Ledger for line ' + (i + 1), function (n) { d.lines[i].ledger = n; renderLines(); }); }
    });
  };
  function saveEntry(d, editing) {
    var lines = d.lines.filter(function (l) { return l.ledger && +l.amount > 0; });
    if (lines.length < 2) { toast('Enter at least two lines with a ledger and an amount'); return; }
    var t = draftTotals({ lines: lines }); if (Math.abs(t.diff) > 0.005) { toast('Debit and credit totals must match'); return; }
    if (!d.date) { toast('Pick a date'); return; }
    var v = {
      id: d.id, source: 'app', date: d.date, type: d.type, number: d.number || String(S.book.nextNumber(d.type)), ref: '', narration: d.narration || '',
      party: d.party || '', cancelled: false, optional: false, postDated: false, action: 'Create', items: [], createdAt: d.createdAt, posted: !!d.posted && !!editing, postedAt: d.postedAt,
      entries: lines.map(function (l) { return { ledger: l.ledger, amount: l.side === 'Dr' ? -(+l.amount) : +l.amount }; })
    };
    if (editing && editing.posted) v.posted = false; // edited after posting → needs re-sending
    persistVoucher(v).then(function () { S.draft = null; toast('Entry saved'); go('#/voucher/' + v.idx); });
  }

  /* ---- GST sales invoice -------------------------------------------------- */
  function blankInvoice() {
    var st = companySettings();
    return { id: 'app:' + A.uid(), source: 'app', type: 'Sales', date: today(), number: String(S.book.nextNumber('Sales')), narration: '',
      buyerLedger: '', buyer: { gstin: '', name: '', address1: '', address2: '', city: '', pin: '', state: '', pos: '', phone: '', email: '' },
      items: [{ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: 18 }], roundOff: true,
      salesLedger: st.salesLedger, cgstLedger: st.cgstLedger, sgstLedger: st.sgstLedger, igstLedger: st.igstLedger, roundOffLedger: st.roundOffLedger, irn: '', ackNo: '', ackDate: '' };
  }
  function invoiceInterState(inv) { var st = companySettings(); var sc = TVEntry.stateCode(st.state) || TVEntry.stateFromGstin(st.gstin); var pc = TVEntry.stateCode(inv.buyer.pos || inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin); return !!(sc && pc && sc !== pc); }
  function stateSelect(id, value) { var codes = Object.keys(TVEntry.STATE_NAMES).sort(); return '<select id="' + id + '"><option value="">State…</option>' + codes.map(function (c) { var nm = TVEntry.STATE_NAMES[c]; var selv = TVEntry.stateCode(value) === c; return '<option value="' + c + '"' + (selv ? ' selected' : '') + '>' + c + ' · ' + esc(nm) + '</option>'; }).join('') + '</select>'; }
  SCREENS.invoice = function (r) {
    var b = S.book, editing = r.q.edit ? b.vouchers.filter(function (v) { return v.id === r.q.edit; })[0] : null;
    if (r.q.edit && (!editing || !editing.invoice)) { toast('Not an invoice made in this app'); go('#/vouchers'); return; }
    if (!S.inv || S.inv.id !== (editing ? editing.id : S.invNewId)) { S.inv = editing ? JSON.parse(JSON.stringify(editing.invoice)) : blankInvoice(); if (editing) { S.inv.id = editing.id; S.inv.posted = editing.posted; S.inv.createdAt = editing.createdAt; } S.invNewId = editing ? null : S.inv.id; }
    var inv = S.inv, st = companySettings();
    A.topbar({ title: (editing ? 'Edit' : 'New') + ' GST invoice', sub: S.company.name, back: true, period: false });
    var h = '';
    if (!st.gstin) h += '<div class="notice">Company GSTIN is not set. <a href="#/gst">Set company GST details</a> for a valid e-invoice.</div>';
    h += '<div class="card"><div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Invoice no</label><input id="iv-number" value="' + esc(inv.number) + '"></div><div class="field" style="flex:1"><label>Date</label><input type="date" id="iv-date" value="' + A.toISO(inv.date) + '"></div></div>' +
      '<div class="field"><label>Voucher type</label><select id="iv-type">' + voucherTypeOptions(inv.type) + '</select></div></div>';
    h += '<div class="card"><h2>Buyer</h2><div class="field"><label>Party ledger</label><button class="btn pick" id="iv-buyer">' + (inv.buyerLedger ? esc(inv.buyerLedger) : '<span class="muted">Choose debtor…</span>') + '</button></div>' +
      '<div class="field"><label>GSTIN</label><input id="iv-gstin" value="' + esc(inv.buyer.gstin) + '" placeholder="29ABCDE1234F1Z5" style="text-transform:uppercase"></div>' +
      '<div class="field"><label>Legal name</label><input id="iv-bname" value="' + esc(inv.buyer.name) + '"></div>' +
      '<div class="field"><label>Address</label><input id="iv-addr1" value="' + esc(inv.buyer.address1) + '" placeholder="Line 1"><input id="iv-addr2" value="' + esc(inv.buyer.address2) + '" placeholder="Line 2" style="margin-top:6px"></div>' +
      '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>City</label><input id="iv-city" value="' + esc(inv.buyer.city) + '"></div><div class="field" style="flex:1"><label>PIN</label><input id="iv-pin" inputmode="numeric" value="' + esc(inv.buyer.pin) + '"></div></div>' +
      '<div class="field"><label>State</label>' + stateSelect('iv-state', inv.buyer.state || TVEntry.stateFromGstin(inv.buyer.gstin)) + '</div>' +
      '<div class="field"><label>Place of supply</label>' + stateSelect('iv-pos', inv.buyer.pos || inv.buyer.state || TVEntry.stateFromGstin(inv.buyer.gstin)) + '</div>' +
      '<div class="kv"><span>Tax type</span><span id="iv-taxtype"></span></div></div>';
    h += '<div class="card"><h2>Items</h2><div id="iv-items"></div><div class="btn-row"><button class="btn" id="iv-add">＋ Add item</button></div></div>';
    h += '<div class="card"><h2>Ledgers to post</h2>' +
      '<div class="field"><label>Sales ledger</label><button class="btn pick" data-ivpick="salesLedger">' + (inv.salesLedger ? esc(inv.salesLedger) : '<span class="muted">Choose…</span>') + '</button></div>' +
      '<div id="iv-taxledgers"></div>' +
      '<div class="field"><label>Round off ledger (optional)</label><button class="btn pick" data-ivpick="roundOffLedger">' + (inv.roundOffLedger ? esc(inv.roundOffLedger) : '<span class="muted">None (no rounding)</span>') + '</button></div></div>';
    h += '<div class="card" id="iv-totals"></div>';
    h += '<div class="card"><div class="field"><label>Narration</label><input id="iv-narr" value="' + esc(inv.narration) + '"></div></div>';
    h += '<div class="btn-row"><button class="btn primary" id="iv-save">Save invoice</button>' + (editing ? '<button class="btn danger" id="iv-delete">Delete</button>' : '') + '</div>';
    A.$view().innerHTML = h;
    var $ = function (id) { return document.getElementById(id); };
    function bindBuyer() {
      $('iv-number').oninput = function () { inv.number = this.value.trim(); };
      $('iv-date').onchange = function () { inv.date = A.fromISO(this.value) || inv.date; };
      $('iv-type').onchange = function () { inv.type = this.value; };
      $('iv-gstin').oninput = function () { inv.buyer.gstin = this.value.trim().toUpperCase(); var sc = TVEntry.stateFromGstin(inv.buyer.gstin); if (sc && !inv.buyer.state) { inv.buyer.state = sc; $('iv-state').value = sc; } if (sc && !inv.buyer.pos) { inv.buyer.pos = sc; $('iv-pos').value = sc; } refresh(); };
      ['bname:name', 'addr1:address1', 'addr2:address2', 'city:city', 'pin:pin'].forEach(function (p) { var id = p.split(':')[0], k = p.split(':')[1]; $('iv-' + id).oninput = function () { inv.buyer[k] = this.value; }; });
      $('iv-state').onchange = function () { inv.buyer.state = this.value; if (!inv.buyer.pos || $('iv-pos').value === '') { inv.buyer.pos = this.value; $('iv-pos').value = this.value; } refresh(); };
      $('iv-pos').onchange = function () { inv.buyer.pos = this.value; refresh(); };
      $('iv-narr').oninput = function () { inv.narration = this.value; };
      $('iv-buyer').onclick = function () { pickLedger('Buyer (debtor) ledger', function (n) {
        inv.buyerLedger = n; var info = b.ledgers[n].info || {};
        if (!inv.buyer.name) inv.buyer.name = n;
        if (info.gstin && !inv.buyer.gstin) inv.buyer.gstin = info.gstin.toUpperCase();
        if (info.address && !inv.buyer.address1) inv.buyer.address1 = info.address;
        if (info.state && !inv.buyer.state) inv.buyer.state = info.state;
        var sc = TVEntry.stateCode(inv.buyer.state) || TVEntry.stateFromGstin(inv.buyer.gstin); if (sc) { inv.buyer.state = sc; if (!inv.buyer.pos) inv.buyer.pos = sc; }
        SCREENS.invoice(r);
      }); };
      $('iv-add').onclick = function () { inv.items.push({ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: inv.items.length ? inv.items[inv.items.length - 1].gstRate : 18 }); renderItems(); };
      $('iv-save').onclick = function () { saveInvoice(inv, editing); };
      var del = $('iv-delete'); if (del) del.onclick = function () { if (confirm('Delete this invoice?')) persistVoucher(editing, true).then(function () { S.inv = null; toast('Invoice deleted'); go('#/pending'); }); };
      A.$view().addEventListener('click', function (ev) {
        var p = ev.target.closest('[data-ivpick]'); if (!p) return; var k = p.getAttribute('data-ivpick');
        pickLedger(k.replace('Ledger', ' ledger'), function (n) { inv[k] = n; p.innerHTML = esc(n); refresh(); });
      });
    }
    function renderItems() {
      var box = $('iv-items');
      box.innerHTML = inv.items.map(function (it, i) {
        return '<div class="item"><div class="item-head"><b>Item ' + (i + 1) + '</b><button class="x" data-irm="' + i + '">✕</button></div>' +
          '<input data-if="desc:' + i + '" value="' + esc(it.desc) + '" placeholder="Description">' +
          '<div class="grid3"><input data-if="hsn:' + i + '" value="' + esc(it.hsn) + '" placeholder="HSN/SAC" inputmode="numeric"><label class="chk"><input type="checkbox" data-if="isService:' + i + '"' + (it.isService ? ' checked' : '') + '> Service</label><select data-if="gstRate:' + i + '">' + GST_RATES.map(function (g) { return '<option value="' + g + '"' + (+it.gstRate === g ? ' selected' : '') + '>GST ' + g + '%</option>'; }).join('') + '</select></div>' +
          '<div class="grid3"><input data-if="qty:' + i + '" type="number" inputmode="decimal" step="0.001" value="' + (it.qty || '') + '" placeholder="Qty"><input data-if="unit:' + i + '" value="' + esc(it.unit) + '" placeholder="Unit"><input data-if="rate:' + i + '" type="number" inputmode="decimal" step="0.01" value="' + (it.rate || '') + '" placeholder="Rate"></div>' +
          '<div class="grid3"><input data-if="discount:' + i + '" type="number" inputmode="decimal" step="0.01" value="' + (it.discount || '') + '" placeholder="Discount ₹"><div class="kv" style="grid-column:span 2"><span>Taxable</span><span class="num" data-itax="' + i + '"></span></div></div></div>';
      }).join('');
      box.querySelectorAll('[data-if]').forEach(function (el) {
        var k = el.getAttribute('data-if').split(':')[0], i = +el.getAttribute('data-if').split(':')[1];
        el[el.type === 'checkbox' || el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = function () {
          var it = inv.items[i];
          if (el.type === 'checkbox') { it.isService = el.checked; if (it.isService && it.unit === 'NOS') { it.unit = 'OTH'; } }
          else if (k === 'qty' || k === 'rate' || k === 'discount' || k === 'gstRate') it[k] = parseFloat(el.value) || 0;
          else it[k] = el.value;
          refresh();
        };
      });
      box.querySelectorAll('[data-irm]').forEach(function (el) { el.onclick = function () { inv.items.splice(+el.getAttribute('data-irm'), 1); if (!inv.items.length) inv.items.push({ desc: '', hsn: '', isService: false, qty: 1, unit: 'NOS', rate: 0, discount: 0, gstRate: 18 }); renderItems(); }; });
      refresh();
    }
    function refresh() {
      var inter = invoiceInterState(inv); inv.interState = inter; inv.roundOff = !!inv.roundOffLedger;
      var calc = TVEntry.computeInvoice(inv), t = calc.totals;
      $('iv-taxtype').textContent = inter ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST';
      calc.items.forEach(function (it, i) { var el = document.querySelector('[data-itax="' + i + '"]'); if (el) el.textContent = fmt(it.taxable) + ' + tax ' + fmt(it.cgst + it.sgst + it.igst); });
      $('iv-taxledgers').innerHTML = inter
        ? '<div class="field"><label>IGST ledger</label><button class="btn pick" data-ivpick="igstLedger">' + (inv.igstLedger ? esc(inv.igstLedger) : '<span class="muted">Choose…</span>') + '</button></div>'
        : '<div class="field"><label>CGST ledger</label><button class="btn pick" data-ivpick="cgstLedger">' + (inv.cgstLedger ? esc(inv.cgstLedger) : '<span class="muted">Choose…</span>') + '</button></div><div class="field"><label>SGST ledger</label><button class="btn pick" data-ivpick="sgstLedger">' + (inv.sgstLedger ? esc(inv.sgstLedger) : '<span class="muted">Choose…</span>') + '</button></div>';
      $('iv-totals').innerHTML = '<h2>Totals</h2><div class="kv"><span>Taxable value</span><span class="num">' + fmt(t.taxable) + '</span></div>' +
        (inter ? '<div class="kv"><span>IGST</span><span class="num">' + fmt(t.igst) + '</span></div>' : '<div class="kv"><span>CGST</span><span class="num">' + fmt(t.cgst) + '</span></div><div class="kv"><span>SGST</span><span class="num">' + fmt(t.sgst) + '</span></div>') +
        (t.roundOff ? '<div class="kv"><span>Round off</span><span class="num">' + fmt(t.roundOff) + '</span></div>' : '') +
        '<div class="kv"><span><b>Invoice total</b></span><span class="num" style="font-weight:700">₹' + fmt(t.total) + '</span></div><div class="small muted">' + esc(TVEntry.amountInWords(t.total)) + '</div>';
    }
    bindBuyer(); renderItems();
  };
  function invoiceEntries(inv) {
    var calc = TVEntry.computeInvoice(inv), t = calc.totals, e = [];
    e.push({ ledger: inv.buyerLedger, amount: -t.total });
    e.push({ ledger: inv.salesLedger, amount: t.taxable });
    if (inv.interState) { if (t.igst) e.push({ ledger: inv.igstLedger, amount: t.igst }); }
    else { if (t.cgst) e.push({ ledger: inv.cgstLedger, amount: t.cgst }); if (t.sgst) e.push({ ledger: inv.sgstLedger, amount: t.sgst }); }
    if (t.roundOff && inv.roundOffLedger) e.push({ ledger: inv.roundOffLedger, amount: t.roundOff });
    return e;
  }
  function saveInvoice(inv, editing) {
    var need = ['buyerLedger', 'salesLedger'].concat(inv.interState ? ['igstLedger'] : ['cgstLedger', 'sgstLedger']);
    for (var i = 0; i < need.length; i++) if (!inv[need[i]]) { toast('Choose the ' + need[i].replace('Ledger', ' ledger')); return; }
    if (!inv.items.some(function (it) { return +it.qty > 0 && +it.rate > 0; })) { toast('Add at least one item with quantity and rate'); return; }
    if (!inv.number) { toast('Invoice number is required'); return; }
    inv.interState = invoiceInterState(inv); inv.roundOff = !!inv.roundOffLedger;
    var entries = invoiceEntries(inv), sum = 0; entries.forEach(function (x) { sum += x.amount; });
    if (Math.abs(sum) > 0.01) { toast('Internal error: invoice does not balance'); return; }
    var v = { id: inv.id, source: 'app', date: inv.date, type: inv.type, number: inv.number, ref: '', narration: inv.narration || '', party: inv.buyerLedger, cancelled: false, optional: false, postDated: false, action: 'Create', items: [], entries: entries, invoice: inv, createdAt: inv.createdAt, posted: false };
    delete inv.posted; delete inv.createdAt;
    persistVoucher(v).then(function () { S.inv = null; toast('Invoice saved'); go('#/voucher/' + v.idx); });
  }

  /* ---- e-invoice JSON, invoice PDF, IRN -------------------------------- */
  function einvoiceDoc(v) {
    var st = companySettings(), inv = v.invoice;
    return { number: v.number, date: v.date, docType: /credit/i.test(v.type) ? 'CRN' : /debit/i.test(v.type) ? 'DBN' : 'INV', items: inv.items, interState: inv.interState, roundOff: inv.roundOff,
      seller: { gstin: st.gstin, name: st.legalName, tradeName: st.tradeName, address1: st.address1, address2: st.address2, city: st.city, pin: st.pin, state: st.state, phone: st.phone, email: st.email },
      buyer: inv.buyer, irn: inv.irn, ackNo: inv.ackNo, ackDate: inv.ackDate, narration: v.narration };
  }
  A.exportEInvoice = function (v) {
    var doc = einvoiceDoc(v), problems = TVEntry.eInvoiceChecks(doc);
    if (problems.length && !confirm('The IRP will reject this e-invoice:\n\n' + problems.join('\n') + '\n\nGenerate the JSON anyway?')) return;
    var json = JSON.stringify([TVEntry.eInvoiceJson(doc)], null, 2);
    A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - e-invoice ' + v.number + '.json'), new Blob([json], { type: 'application/json' })));
  };
  A.exportInvoicePdf = function (v) { A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - Invoice ' + v.number + '.pdf'), TVEntry.invoicePdf(einvoiceDoc(v), TVExport))); };
  A.enterIrn = function (v) {
    var inv = v.invoice;
    A.sheet('<h3>IRN details from the e-invoice portal</h3><div class="field"><label>IRN (64 characters)</label><input id="irn-irn" value="' + esc(inv.irn || '') + '"></div><div class="field"><label>Acknowledgement no.</label><input id="irn-ack" value="' + esc(inv.ackNo || '') + '"></div><div class="field"><label>Acknowledgement date</label><input id="irn-date" value="' + esc(inv.ackDate || '') + '" placeholder="dd/mm/yyyy hh:mm"></div><button class="btn primary block" id="irn-save">Save</button>', function (ev, bg) {
      if (ev.target.id !== 'irn-save') return;
      inv.irn = document.getElementById('irn-irn').value.trim(); inv.ackNo = document.getElementById('irn-ack').value.trim(); inv.ackDate = document.getElementById('irn-date').value.trim();
      bg.remove(); persistVoucher(v).then(function () { toast('IRN saved'); A.render(); });
    });
  };

  /* ---- sending entries to Tally ------------------------------------------ */
  A.exportTallyXml = function (list) {
    if (!list.length) { toast('Nothing to export'); return; }
    var xml = TVEntry.tallyXml(list, S.company.name);
    A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - ' + list.length + ' vouchers for Tally.xml'), new Blob([xml], { type: 'text/xml' })));
  };
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
        list.forEach(function (v) { v.posted = true; v.postedAt = Date.now(); });
        return TVDB.putData(S.book.data).then(function () { toast('Tally accepted ' + (created + altered) + ' voucher(s)'); A.render(); });
      }
      toast('Tally created ' + created + ', errors ' + errors + (lineErr ? ': ' + lineErr.slice(0, 160) : ''), 8000);
    }).catch(function (e) { toast('Could not reach Tally: ' + e.message, 6000); });
  };

  /* ---- pending list ------------------------------------------------------- */
  SCREENS.pending = function () {
    var list = appVouchers().slice().reverse(), pending = list.filter(function (v) { return !v.posted; });
    A.topbar({ title: 'Entries made in app', sub: S.company.name, back: true, period: false });
    var h = '<div class="btn-row"><button class="btn primary" data-act2="new">＋ New entry</button></div>';
    if (!list.length) h += '<div class="empty"><div class="big">✍️</div>No entries yet. Pass a journal, payment, receipt or a GST invoice and it shows up here.</div>';
    else {
      h += '<div class="card"><div class="kv"><span>Not yet in Tally</span><span><b>' + pending.length + '</b></span></div><div class="btn-row"><button class="btn" data-act2="xml">⤓ Tally XML (' + pending.length + ')</button><button class="btn" data-act2="post">⇡ Post to Tally over Wi-Fi</button><button class="btn" data-act2="markall">Mark all as imported</button></div>' +
        '<p class="small muted" style="margin-top:8px">Tally XML: import on the PC via Gateway of Tally → Import → Vouchers. Ledgers must already exist in Tally with the same names.</p></div>';
      h += '<div class="list">' + list.map(function (v) {
        return '<button class="row" data-voucher="' + v.idx + '"><span class="badge">' + esc(v.type) + '</span><div class="main"><div class="t">' + esc(v.party || v.entries[0].ledger) + (v.invoice && v.invoice.irn ? ' · IRN ✓' : '') + '</div><div class="s">' + A.fmtDate(v.date) + ' · #' + esc(v.number) + ' · ' + (v.posted ? 'in Tally' : 'pending') + '</div></div><div class="amt"><div class="v num">' + fmt(v.total) + '</div></div><span class="chev">›</span></button>';
      }).join('') + '</div>';
    }
    A.$view().innerHTML = h;
    A.$view().querySelectorAll('[data-act2]').forEach(function (el) { el.onclick = function () {
      var a = el.getAttribute('data-act2');
      if (a === 'new') A.newEntrySheet(); else if (a === 'xml') A.exportTallyXml(pending); else if (a === 'post') A.postToTally(pending);
      else if (a === 'markall') { if (confirm('Mark all ' + pending.length + ' pending entries as already imported into Tally?')) { pending.forEach(function (v) { v.posted = true; v.postedAt = Date.now(); }); TVDB.putData(S.book.data).then(function () { A.render(); }); } }
    }; });
  };

  /* ---- company GST settings ---------------------------------------------- */
  SCREENS.gst = function () {
    var st = companySettings();
    A.topbar({ title: 'Company GST details', sub: S.company.name, back: true, period: false });
    function f(id, label, val, extra) { return '<div class="field"><label>' + label + '</label><input id="gs-' + id + '" value="' + esc(val || '') + '"' + (extra || '') + '></div>'; }
    var h = '<div class="card"><h2>Seller details (printed on invoices, used in e-invoice JSON)</h2>' + f('gstin', 'GSTIN', st.gstin, ' style="text-transform:uppercase"') + f('legalName', 'Legal name', st.legalName) + f('tradeName', 'Trade name', st.tradeName) + f('address1', 'Address line 1', st.address1) + f('address2', 'Address line 2', st.address2) + f('city', 'City', st.city) + f('pin', 'PIN code', st.pin, ' inputmode="numeric"') +
      '<div class="field"><label>State</label>' + stateSelect('gs-state', st.state) + '</div>' + f('phone', 'Phone', st.phone) + f('email', 'Email', st.email) + '</div>';
    h += '<div class="card"><h2>Default ledgers for invoices</h2>' + ['salesLedger:Sales ledger', 'cgstLedger:Output CGST ledger', 'sgstLedger:Output SGST ledger', 'igstLedger:Output IGST ledger', 'roundOffLedger:Round off ledger'].map(function (p) { var k = p.split(':')[0], l = p.split(':')[1]; return '<div class="field"><label>' + l + '</label><button class="btn pick" data-gspick="' + k + '">' + (st[k] ? esc(st[k]) : '<span class="muted">Choose…</span>') + '</button></div>'; }).join('') + '</div>';
    h += '<div class="btn-row"><button class="btn primary" id="gs-save">Save</button></div>';
    A.$view().innerHTML = h;
    A.$view().addEventListener('click', function (ev) { var p = ev.target.closest('[data-gspick]'); if (!p) return; var k = p.getAttribute('data-gspick'); pickLedger(k.replace('Ledger', ' ledger'), function (n) { st[k] = n; p.innerHTML = esc(n); }); });
    document.getElementById('gs-save').onclick = function () {
      ['gstin', 'legalName', 'tradeName', 'address1', 'address2', 'city', 'pin', 'phone', 'email'].forEach(function (k) { st[k] = document.getElementById('gs-' + k).value.trim(); });
      st.gstin = st.gstin.toUpperCase(); st.state = document.getElementById('gs-state').value;
      if (st.gstin && !TVEntry.validGstin(st.gstin)) { toast('GSTIN format looks wrong'); return; }
      saveSettings(st).then(function () { toast('Saved'); history.back(); });
    };
  };

  A.appVouchers = appVouchers; A.persistVoucher = persistVoucher; A.companySettings = companySettings;
})();
