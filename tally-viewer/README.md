# Tally Viewer

An installable, offline web app for Android (and any modern browser) that loads
**TallyPrime XML exports** and gives you an interactive dashboard, ledgers, day
book and reports for as many companies as you like. Nothing is uploaded
anywhere: files are parsed on the phone and kept in the browser's storage.

## Why XML export and not the Tally backup?

TallyPrime's data folder (`*.900` files) and TBK backups are a proprietary,
undocumented format. No outside app can read them. TallyPrime's XML export,
however, contains every master and every voucher and is two key presses per
company, so that is what this app reads.

## Exporting from TallyPrime

1. **Masters** – Gateway of Tally → `Alt+E` → *Masters* → Configure: Format **XML**,
   Type **All Masters** → Export. Produces `Master.xml`.
2. **Transactions** – `Alt+E` → *Transactions* → Configure: Format **XML**,
   period (a financial year is fine), Type **All Vouchers** → Export. Produces
   `Daybook.xml`.
3. Copy both files to the phone (WhatsApp, Drive, email, USB) and import them in
   the app. The company name is read from the file, so files for different
   companies can be imported together. Re-importing the same period updates
   vouchers (matched by Tally GUID) instead of duplicating them.

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
- **More** – switch, rename or delete companies; imported file log; theme.

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
  css/app.css
  js/tallyparse.js      streaming Tally XML tokenizer + object extraction
  js/parser.worker.js   runs the parser off the main thread
  js/model.js           groups, balances, reports, import merge
  js/db.js              IndexedDB wrapper
  js/app.js             UI, routing, import flow
  icons/
```

No build step and no external dependencies. The parser and model also run in
Node, which is how they are tested.
