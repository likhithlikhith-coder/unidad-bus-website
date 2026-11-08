# Tally Viewer

An installable, offline web app for Android (and any modern browser) that reads
**TallyPrime company data** (the data folder itself, a Wi-Fi sync, or XML exports)
and gives you an interactive dashboard, ledgers, day book, GST and reports for as
many companies as you like, in a modern look or a classic Tally look.

Offline by design: nothing is uploaded by the app and every file is parsed and
kept on the phone. The only network calls are three you start yourself: the IFSC
lookup (the code you type goes to Razorpay's public IFSC API when you tap *Look
up branch online*), WhatsApp sharing (the message text and file go to WhatsApp),
and LAN sync (the Android app talks to the TallyPrime PC whose address you type,
over plain HTTP on your own Wi-Fi). Nothing else leaves the device.

## Three ways to get data in

1. **Open the Tally data folder directly** (no export, no PC software): copy a
   company folder such as `100000` from TallyPrime's data directory to the
   phone, or ZIP it, and open it in the app. The app decodes the `.1800`
   files itself. See *Data folder format* below.
2. **Sync over Wi-Fi** from a running TallyPrime (Android app only).
3. **Import TallyPrime XML exports** (Master.xml, Daybook.xml), or share /
   "Open with" an XML file into the Android app.

## Getting data in

### Option A: the Tally data folder

TallyPrime stores each company as a numbered folder (`100000`, `100001`, …)
under its data path (F1 → Settings → Data path; usually
`C:\Users\Public\TallyPrime\data`). Copy that folder to the phone, or ZIP it
and send it, then in the app choose **Open Tally data folder** (Android app) or
pick `Manager.1800`, `TranMgr.1800` and `Company.1800` (or the ZIP) in the
file picker. Picking the whole Tally Data folder, or a ZIP containing several
numbered company folders, loads every company at once. Nothing is written
back to the folder.

Opening a folder again is a full snapshot: the company's Tally data is replaced
with the fresh copy, so vouchers and masters deleted or renamed in Tally
disappear here too. Entries made in this app are kept.

### Option B: sync over Wi-Fi (Android app)

TallyPrime runs an XML server on port 9000 while it is open. The Android app
can ask it directly for all masters and all vouchers, so no files are involved:

1. In TallyPrime: `F1` (Help) → Settings → Connectivity → Client/Server
   configuration. Set *TallyPrime acts as* to **Both**, *Enable ODBC server*
   **Yes**, port **9000**.
2. Allow TallyPrime (or TCP port 9000) through Windows Firewall for private
   networks.
3. Note the PC's IPv4 address (`ipconfig`), open the companies in Tally, and on
   the phone open **Sync from Tally**, enter the address, Connect, pick
   companies and a period, Sync. Vouchers are fetched one month at a time so a
   full year shows progress as it goes.

Nothing is installed on the PC and the phone only talks to the address you type;
the app refuses anything that is not a private LAN address. The sync feature
needs the Android app because browsers block plain-HTTP requests from an HTTPS
page.

### Option C: XML files

`tools/tally-export.cmd` (Windows) does the same requests from the PC itself and
writes `<Company>-Master.xml` and `<Company>-Daybook.xml` to a folder on the
Desktop; send those to the phone and import them. Or export by hand:

1. **Masters** – Gateway of Tally → `Alt+E` → *Masters* → Configure: Format **XML**,
   Type **All Masters** → Export. Produces `Master.xml`.
2. **Transactions** – `Alt+E` → *Transactions* → Configure: Format **XML**,
   period (a financial year is fine), Type **All Vouchers** → Export. Produces
   `Daybook.xml`.
3. Copy both files to the phone (WhatsApp, Drive, email, USB) and import them in
   the app, or share them straight to Tally Viewer from the file manager. The
   company name is read from the file, so files for different companies can be
   imported together. Re-importing the same period updates vouchers (matched by
   Tally GUID) instead of duplicating them.

Entries made in this app and later posted to Tally are recognised when they come
back in a sync or import (same date, type, number and amount), so they are shown
once, marked "in Tally · matched", instead of being counted twice.

## Android APK

A signed, installable APK is in `../releases/`, built from the native shell in
`../android/` (see its README for Android Studio instructions). The APK bundles
this folder as-is and needs no network. In the Android app the service worker is
not used: the shell serves the bundled files itself, so an app update takes
effect the moment it is installed and no cached copy can run stale code.

## Using it

Host the `tally-viewer/` folder on any static web server (GitHub Pages works)
and open it in Chrome on the phone. Chrome offers *Add to Home screen*; after
that it opens full-screen and works with no network. When a new version is
published the app shows an "Update ready" toast with a Reload button.

Screens:

- **Home** – profit before stock (with the after-stock figure when the data
  carries stock values), sales, purchases, receivables, payables, cash, bank,
  expenses, a monthly chart, top expenses and customers, latest vouchers.
- **Ledgers** – search and filter (debtors, creditors, cash & bank, income,
  expenses); each ledger shows opening/closing, contact details, pending bills
  and a statement with running balance. Balances are shown neutrally with a
  small Dr/Cr; only abnormal balances (an asset in credit, a liability in
  debit) are coloured.
- **Day Book** – all vouchers with search and type filter; each voucher shows its
  ledger entries and inventory lines. Searching re-filters the list in place.
- **Reports** – Trial Balance, Profit & Loss, Balance Sheet, Receivables,
  Payables, Cash & Bank, Stock Summary, Monthly Summary, Voucher Register.
- **Period** – tap the chip in the top bar: financial years, last month, this
  month, all data, or a custom range.
- **Export** – any ledger statement, the ledger balance list (with the current
  filter and search), receivables and payables can be saved as Excel (.xlsx)
  or PDF. Both files are generated on the phone by `js/export.js` without any
  library; in the Android app the file is saved to Downloads/TallyViewer (the
  WhatsApp and share actions open the share sheet when you want it), in a
  browser it downloads.
- **Entries** – pass journal, payment, receipt, contra, sales, purchase, credit
  and debit note vouchers on the phone (＋ on Home or Day Book). They post into
  the app's books at once and unsaved drafts survive leaving the screen. *More
  → Entries made in app* lists them with their state (pending, sent to Tally,
  in Tally · matched); send them to TallyPrime either as a Tally import XML
  file (Gateway of Tally → Import → Vouchers) or directly over Wi-Fi (Android
  app). Ledgers must already exist in Tally with the same names.
- **GST invoice, credit note, e-invoice** – a dedicated form (party,
  GSTIN, place of supply, items with HSN/SAC and GST rate, CGST+SGST or IGST
  worked out automatically, round off). A credit note raised from the form
  credits the customer and reverses sales and output tax, and carries the
  original invoice number and date (Rule 53); debit notes are passed as
  accounting vouchers. From the saved document: a tax invoice / credit note
  PDF with the Rule 46 particulars (reverse
  charge statement, document title, reference to the original invoice), and
  the NIC e-invoice JSON (schema 1.1) ready for bulk IRN generation on the
  e-invoice portal (einvoice1.gst.gov.in → e-Invoice → Bulk Upload), after
  pre-checks that mirror the IRP's validations (HSN length, document number
  format, UQC codes, PIN, dates). Enter the IRN and acknowledgement the portal
  returns and they print on the PDF. The Tally XML for these vouchers carries
  the GST particulars (party GSTIN, place of supply, registration type,
  bill-wise reference) so TallyPrime places them in GSTR-1. Seller details live
  under *More → Company GST details* (prefilled from the data folder where
  available).
- **WhatsApp and letters** – every ledger has a WhatsApp action: PDF or Excel
  statement, a confirmation-of-account letter, a balance summary text or a
  payment reminder, sent to the party's number from the master. Reports and
  app-made invoices share the same way. Ledgers can be pinned to Home.
- **More reports** – Ratio Analysis, Comparative P&L (vs the same period last
  year), Cash Flow (cash and bank by month; contra transfers between cash and
  bank are excluded), Receivables and Payables Ageing (bills matched FIFO from
  ledger entries, five age buckets), GST Summary (output vs input tax by month
  from supply vouchers, outward supplies by party GSTIN, with the list of tax
  ledgers it recognised). Every report exports to Excel and PDF.
- **Home rankings** – top expenses and top customers for the period.
- **Entries** – auto-numbering keeps your prefix pattern and financial-year
  suffix (e.g. 25-26/RENT/026 → 25-26/RENT/027); any app entry can be duplicated.
- **Backup, restore, app lock** – a company (including entries made here) can
  be saved to a file and restored (the file is checked before anything is
  written, and unposted entries absent from the backup are kept). The app lock
  is a keypad PIN (4–6 digits, stored as a PBKDF2 hash) asked for on launch and
  again after the app has been in the background for a minute; wrong attempts
  back off, a *Forgot PIN?* path offers a backup and then resets the lock, and
  on Android the screen is kept out of the recents thumbnail while a PIN is
  set.
- **Tools tab** (works without a company): GSTIN check (format, state,
  embedded PAN, checksum), PAN check (format, holder type, name initial), IFSC
  lookup (offline bank table, online branch details via the Razorpay IFSC
  API), CIN decoder, Aadhaar checksum; GST, TDS (current 194A thresholds,
  194I/194J sub-rates, 5 % no-PAN rule for 194Q/194O), EMI,
  interest-between-dates, margin/markup and amount-in-words calculators;
  compliance calendar with upcoming due dates (QRMP dates by state), HSN
  chapter / SAC search, TDS rate table. "More" sits behind the gear chip in
  the top bar.
- **More** – switch, rename or delete companies; imported file log; theme;
  look; backup and restore; app lock; the app version.
- **Classic Tally look** – the window icon in the top bar on Home (or More →
  Look) switches the whole app to a TallyPrime-style interface: a Gateway of
  Tally home with Masters / Transactions / Utilities / Reports and red hotkey
  letters, Tally's top menu strip (K Company · Y Data · Z Exchange · G Go To ·
  O Import · E Export · M Share · P Print · F1 Help, each `Alt+letter` on a
  keyboard), a report header band with company, title and period and a status
  line with the Tally-style path ("Gateway of Tally → Display More Reports →
  Balance Sheet"), and Tally's grey function-key button bar that changes with
  the screen: G Gateway, L Ledgers, D Day Book, R Reports, T Tools everywhere,
  F2 Period · F3 Company · Alt+F1 Detailed · E Export · F12 Configure on
  reports and ledgers, F4–F9 Contra/Payment/Receipt/Journal/Sales/Purchase and
  Ctrl+A Save on entry screens. Dates read 1-Apr-24 everywhere, no ₹ symbols,
  the Ledger Vouchers screen is Tally's Date / Particulars / Vch Type / Vch
  No. / Debit / Credit table with Opening Balance, Current Total and Closing
  Balance, the Day Book runs oldest first, and the Balance Sheet shows
  Liabilities and Assets side by side from tablet width. Lists lose their
  rounded cards and chevrons, ledgers under groups go italic, totals get the
  double rule, focused fields turn Tally yellow. With a keyboard the red
  letters on Reports, Tools, More and Companies really open their item,
  Up/Down move Tally's yellow cursor bar with Enter to open, Home/End jump,
  and Esc goes back. "Modern UI" in the menu strip switches back; the choice
  is remembered on the phone.

## Data folder format

`js/tallydb.js` is a reverse-engineered reader for TallyPrime Release 3+
company folders (`.1800` files), worked out from a real company folder. What
is known so far:

- Every file is a 512-byte header followed by 512-byte pages. Each page starts
  with `[hash][object id][pages in chain][next page][page type][record no]`.
  Object pages (type 11) carry a ~64-byte variable header; all other pages and
  all continuation pages carry a 28-byte header.
- Values are a tag-length-value stream: `[flags u16][tag u16][0][type u8]`
  then the payload. Types seen: empty, flag, u32 references, i32, date (days
  since 31-Dec-1899), 8-byte amounts and rates scaled by 100,000, quantity
  (amount + unit id), rate (value, per quantity, unit id), UTF-16 strings with
  a 2-byte length, nested records with a 2-byte length (and an optional u32 key
  when flag 0x400 is set), and an 8-byte timestamp.
- `Manager.1800` holds masters, one object per page chain. Tag 3 (i32) is the
  object kind: 2 group, 3 ledger, 6 godown, 7 stock group, 9 stock item,
  10 voucher type, 12 unit. Names are in tag 503 or a language record keyed
  1033. A ledger's parent group is tag 3 (u32 reference) → group object id.
  Opening balance is tag 2603. Voucher types carry their base type code in
  tag 4002.
- `TranMgr.1800` holds vouchers. Each voucher object id has a header record
  (page type 66, record 1: date in tag 3, voucher type and party as object ids,
  number) and a posting record (page type 66, record 2) whose tail is a tag
  stream with the ledger lines: tag 10003 lists, each line a ledger id and an
  amount; negative = debit. Vouchers edited in TallyPrime also have page-type-5
  chains, one per version, indexed by a page-type-3 record; the highest version
  is current and provides narration, bill and bank details. A voucher whose
  posting record has no lines is deleted or empty and is skipped.
- `Company.1800` holds the company name, address, PAN and books-from date.

- Voucher identity: Tally's GUID is the company GUID plus eight hex digits of
  the object's counter (tag 3004), so a folder import and an XML export of the
  same company match up and update rather than duplicate.
- Header flags: tag 1503 marks a cancelled voucher and the pair 2003+2005
  (without 1532) an optional one; both carry their lines only in the editable
  chain and post nothing, which is exactly how Tally treats them.
- A ledger line's nested record 510 is the bank allocation (instrument,
  transaction type such as NEFT, reference, date).

E-invoice note: the app produces the JSON the portal (or any GSP tool) consumes.
It does not call the IRP API itself; direct API access needs GSP credentials and
is not part of this app.

Not yet seen in sample data and therefore unverified: inventory lines on
sales/purchase vouchers, cost centres, bill-wise references, and
TallyVault-encrypted companies (those cannot be read).

## How figures are computed

- Sign convention follows Tally XML: negative = debit, positive = credit.
- Ledger closing = opening balance from masters + all voucher entries up to the
  period end. Cancelled, optional and non-accounting vouchers (orders, delivery
  and receipt notes, memorandum, reversing journals) are excluded.
- Invoice-mode vouchers keep the sales/purchase ledger inside the item's
  accounting allocations; these are added only when the voucher would otherwise
  not balance, so accounting-mode vouchers are not double counted.
- Group natures come from Tally's reserved group names (Capital Account, Current
  Assets, Sales Accounts, …) walking up the group chain, so user-created groups
  are classified by their parent.
- Profit figures are movement in income and expense ledgers, labelled **profit
  before stock**. Where stock items carry values, the app also shows an
  after-stock figure using a weighted-average valuation of opening and closing
  stock (rate = (opening value + inward value) / (opening qty + inward qty));
  Tally's own valuation method may differ, so treat it as an estimate.
- Trial balance and balance sheet split any difference into "Difference in
  opening balances" (the imported opening balances do not tie, exactly like
  Tally) and "Unclassified groups / unbalanced vouchers" (groups not under a
  standard primary group, or vouchers whose lines do not balance).
- Cash Flow counts each voucher's cash/bank side once and skips contra vouchers
  and transfers between cash and bank ledgers.
- GST Summary recognises a tax ledger only when it sits under Duties & Taxes
  *and* its name contains GST, CGST, SGST, UTGST, IGST or cess.

## Files

```
tally-viewer/
  index.html            app shell (CSP, live region, skeleton, deferred scripts)
  manifest.webmanifest  PWA manifest
  sw.js                 service worker (shell-only offline cache, browser builds only)
  package.json          npm test → node --test
  css/app.css           modern design system (tokens, light + dark)
  css/classic.css       classic Tally look (html[data-ui="classic"])
  js/version.js         TV_VERSION and TV_DATA_SCHEMA (loaded first, imported by sw.js)
  js/model.js           groups, balances, reports, import merge, stock valuation
  js/db.js              IndexedDB wrapper
  js/export.js          .xlsx and PDF writers (no libraries)
  js/tallyparse.js      streaming Tally XML tokenizer + object extraction
  js/tallydb.js         TallyPrime .1800 data folder decoder
  js/parser.worker.js   runs the parsers off the main thread
  js/entry.js           voucher entry model, invoice maths, Tally XML, PDFs, e-invoice JSON
  js/app.js             UI, routing, import flow, sheets, toasts
  js/entryui.js         voucher entry, GST invoice, pending entries, GST settings screens
  js/features.js        reports, WhatsApp, backup/restore, app lock
  js/tools.js           verification and calculator tools, compliance calendar
  js/classic.js         Gateway of Tally, menu strip, button bar, keyboard, Go To
  test/                 node:test suites for the DOM-free core
  fonts/  icons/
```

No build step and no external dependencies.

## Tests

The DOM-free core (version, model, entry, export, parser, data-folder decoder)
runs in Node:

```
cd tally-viewer && npm test
```

The suite covers import matching and superseded app entries, snapshot resets,
voucher numbering with financial-year suffixes, cash flow with contra vouchers,
GST ledger recognition, month ends, stock valuation, invoice maths and
credit-note signs, e-invoice pre-checks, GST fields in the Tally XML, parser
entity handling, spreadsheet escaping, and a decode of a real company folder
whose trial balance must tie.

## Release notes

### 1.9.0

A fix release driven by a full review of 1.8.0.

- **Correctness** – app entries posted to Tally are matched when they come back
  in a sync or import and no longer counted twice; a folder import is a full
  snapshot so deletions in Tally are reflected; "This month" / "Last month"
  periods end on the real last day; the hero sparkline plots the same series as
  the hero figure; auto-numbering understands financial-year suffixes; Cash
  Flow no longer counts contra transfers twice; GST Summary only treats real
  GST ledgers as tax; profit is labelled "before stock" with an after-stock
  figure where stock values exist; the TB/BS difference line is split into
  opening-balance difference and unclassified/unbalanced items.
- **Statutory** – credit notes from the invoice form post and export with the
  right signs and reference the original invoice; invoice PDFs carry the Rule
  46 particulars; Tally XML for invoices carries GST fields; e-invoice
  pre-checks match the IRP; TDS table and calculator use the current 194A
  thresholds, 194I/194J sub-rates and the 5 % no-PAN rule for 194Q/194O; the
  compliance calendar fixes TDS, AOC-4, PMT-06 and QRMP dates.
- **Security and privacy** – a Content-Security-Policy on the page; report
  tables escape every cell (a crafted GSTIN in imported data could previously
  run script); the app lock is a masked keypad with PBKDF2 hashing, relock on
  return, attempt back-off, a recovery path and a secure window on Android;
  backups are validated before restore; the Android bridge only talks to LAN
  addresses, blocks third-party hosts, disables cloud backup of the books and
  no longer signs release builds with the debug key.
- **Reliability** – saves go to IndexedDB before the screen updates and
  report failures; a parser worker crash fails the job instead of wedging the
  queue; unhandled errors surface as a toast; drafts autosave; the service
  worker caches only the app shell (never synced XML or opened data files),
  names its cache by version, and is not used inside the Android app; the
  browser shows an "Update ready → Reload" toast.
- **Android** – back button closes sheets and respects the PIN screen;
  "Open with" / "Share to Tally Viewer" for XML files works; edge-to-edge with
  proper insets; exports are saved without forcing a share sheet; versionCode
  10, newer target SDK and AndroidX libraries.
- **Design** – light theme fixed (readable primary buttons and selected chips,
  AA contrast on labels, links and badges in both themes); centred toast that
  reuses one host and can carry a Reload action; bottom sheets are real
  dialogs with a close button, focus handling and Escape; 44 px touch targets;
  money values never truncate; aligned tree reports; sticky first column and a
  scroll hint on wide tables; gold reserved for actions and state; a type and
  radius scale; a live region for announcements; reduced-motion support; the
  heavy blur and fixed-background effects removed for smoother scrolling;
  SVG icons replace emoji glyphs; empty and loading states designed.
- **Classic look** – the red hotkey letters on Reports, Tools, More and
  Companies now work and are unique; Tally's full Alt+ menu strip (Data,
  Exchange, Import, Share, Print added); a screen-aware button bar (Alt+F1
  Detailed, F4–F9 voucher types, Ctrl+A Save); Up/Down cursor with Enter;
  a persistent breadcrumb status line; Tally dates and no ₹ on every screen;
  Tally's Ledger Vouchers table; oldest-first Day Book; two-column Balance
  Sheet on tablets; 44 px function keys; a plain "Modern UI" strip item.
- **Tests** – `npm test` runs a node:test suite over the core modules,
  including a decode of a real company folder.
