# Tally Viewer

An installable, offline web app for Android (and any modern browser) that loads
**TallyPrime XML exports** and gives you an interactive dashboard, ledgers, day
book and reports for as many companies as you like. Nothing is uploaded
anywhere: files are parsed on the phone and kept in the browser's storage.

## Three ways to get data in

1. **Open the Tally data folder directly** (no export, no PC software): copy a
   company folder such as `100000` from TallyPrime's data directory to the
   phone, or ZIP it, and open it in the app. The app decodes the `.1800`
   files itself. See *Data folder format* below.
2. **Sync over Wi-Fi** from a running TallyPrime (Android app only).
3. **Import TallyPrime XML exports** (Master.xml, Daybook.xml).

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

Nothing is installed on the PC and the phone never talks to anything but the
address you type. The sync feature needs the Android app because browsers block
plain-HTTP requests from an HTTPS page.

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
   the app. The company name is read from the file, so files for different
   companies can be imported together. Re-importing the same period updates
   vouchers (matched by Tally GUID) instead of duplicating them.

## Android APK

A signed, installable APK is in `../releases/`, built from the native shell in
`../android/` (see its README for Android Studio instructions). The APK bundles
this folder as-is and needs no network.

## Using it

Host the `tally-viewer/` folder on any static web server (GitHub Pages works)
and open it in Chrome on the phone. Chrome offers *Add to Home screen*; after
that it opens full-screen and works with no network.

Screens:

- **Home** – net profit, sales, purchases, receivables, payables, cash, bank,
  expenses, a monthly sales vs purchases chart, top receivables, latest vouchers.
- **Ledgers** – search and filter (debtors, creditors, cash & bank, income,
  expenses); each ledger shows opening/closing, contact details, pending bills
  and a statement with running balance.
- **Day Book** – all vouchers with search and type filter; each voucher shows its
  ledger entries and inventory lines.
- **Reports** – Trial Balance, Profit & Loss, Balance Sheet, Receivables,
  Payables, Cash & Bank, Stock Summary, Monthly Summary, Voucher Register.
- **Period** – tap the chip in the top bar: financial years, last month, this
  month, all data, or a custom range.
- **Export** – any ledger statement, the ledger balance list (with the current
  filter and search), receivables and payables can be saved as Excel (.xlsx)
  or PDF. Both files are generated on the phone by `js/export.js` without any
  library; in the Android app the file goes to Downloads/TallyViewer and the
  share sheet opens, in a browser it downloads.
- **Entries** – pass journal, payment, receipt, contra, sales, purchase, credit
  and debit note vouchers on the phone (＋ on Home or Day Book). They post into
  the app's books at once. *More → Entries made in app* lists them; send them to
  TallyPrime either as a Tally import XML file (Gateway of Tally → Import →
  Vouchers) or directly over Wi-Fi (Android app). Ledgers must already exist in
  Tally with the same names.
- **GST sales invoice and e-invoice** – a dedicated form (party, GSTIN, place
  of supply, items with HSN/SAC and GST rate, CGST+SGST or IGST worked out
  automatically, round off). From the saved invoice: a GST tax invoice PDF, and
  the NIC e-invoice JSON (schema 1.1) ready for bulk IRN generation on the
  e-invoice portal (einvoice1.gst.gov.in → e-Invoice → Bulk Upload). Enter the
  IRN and acknowledgement the portal returns and they print on the PDF.
  Seller details live under *More → Company GST details* (prefilled from the
  data folder where available).
- **WhatsApp and letters** – every ledger has a WhatsApp action: PDF or Excel
  statement, a confirmation-of-account letter, a balance summary text or a
  payment reminder, sent to the party's number from the master. Reports and
  app-made invoices share the same way. Ledgers can be pinned to Home.
- **More reports** – Ratio Analysis, Comparative P&L (vs the same period last
  year), Cash Flow (cash and bank by month), Receivables and Payables Ageing
  (bills matched FIFO from ledger entries, five age buckets), GST Summary
  (output vs input tax by month from supply vouchers, outward supplies by
  party GSTIN). Every report exports to Excel and PDF.
- **Home rankings** – top expenses and top customers for the period.
- **Entries** – auto-numbering keeps your prefix pattern (e.g. 25-26/RENT/026);
  any app entry can be duplicated.
- **Backup, restore, app lock** – a company (including entries made here) can
  be saved to a file and restored; a 4–6 digit PIN can be required on launch.
- **Tools tab** (works without a company): GSTIN check (format, state,
  embedded PAN, checksum), PAN check (format, holder type, name initial), IFSC
  lookup (offline bank table, online branch details via the Razorpay IFSC
  API), CIN decoder, Aadhaar checksum; GST, TDS, EMI, interest-between-dates,
  margin/markup and amount-in-words calculators; compliance calendar with
  upcoming due dates, HSN chapter / SAC search, TDS rate table. "More" sits
  behind the ⚙ chip in the top bar.
- **More** – switch, rename or delete companies; imported file log; theme.
- **Classic Tally look** – the window icon in the top bar (or More → Look)
  switches the whole app to a TallyPrime-style interface: a Gateway of Tally
  home with Masters / Transactions / Utilities / Reports and red hotkey
  letters, the K: Company · G: Go To · E: Export · F1: Help menu strip, a
  report header band with company, title and period, and Tally's grey
  function-key button bar (G Gateway, L Ledgers, D Day Book, R Reports,
  T Tools, F2 Period, F3 Company, V Voucher, E Export, F12 Configure) along
  the bottom on phones and down the right on tablets. Lists lose their
  rounded cards and chevrons, ledgers under groups go italic, totals get the
  double rule, focused fields turn Tally yellow. With a keyboard, the Gateway
  hotkeys, F2/F3/F12, Alt+G (Go To) and Esc (back) work. "Modern UI" in the
  menu strip switches back; the choice is remembered on the phone.

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
- Profit figures are movement in income and expense ledgers. **Opening and
  closing stock are not valued**, so where stock changes materially Tally's net
  profit will differ. Stock Summary reports quantities only.
- Trial balance and balance sheet show a "Difference in opening balances" line
  when the imported opening balances do not tie, exactly like Tally does.

## Files

```
tally-viewer/
  index.html            app shell
  manifest.webmanifest  PWA manifest
  sw.js                 service worker (offline cache)
  css/app.css           modern design system
  css/classic.css       classic Tally look (html[data-ui="classic"])
  js/classic.js         Gateway of Tally, menu strip, button bar, Go To
  js/tallyparse.js      streaming Tally XML tokenizer + object extraction
  js/parser.worker.js   runs the parser off the main thread
  js/model.js           groups, balances, reports, import merge
  js/db.js              IndexedDB wrapper
  js/app.js             UI, routing, import flow
  icons/
```

No build step and no external dependencies. The parser and model also run in
Node, which is how they are tested.
