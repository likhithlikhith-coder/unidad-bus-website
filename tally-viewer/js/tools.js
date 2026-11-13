/* Business tools: validators, calculators and references. Works without a company loaded. */
(function () {
  'use strict';
  var A = window.TVApp, S = A.S, SCREENS = A.SCREENS, esc = A.esc, fmt = A.fmt, toast = A.toast, go = A.go;
  var B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function cash(n) { return A.cur ? A.cur(n) : '₹' + fmt(n); }

  /* ---- validators -------------------------------------------------------- */
  function gstinCheck(g) {
    g = String(g || '').trim().toUpperCase();
    var r = { input: g, ok: false, issues: [], fields: [] };
    if (!/^[0-9A-Z]{15}$/.test(g)) { r.issues.push(g.length !== 15 ? 'A GSTIN has 15 characters (this has ' + g.length + ').' : 'Only letters and digits are allowed.'); return r; }
    var state = g.slice(0, 2), pan = g.slice(2, 12), entity = g[12], z = g[13], chk = g[14];
    var sname = TVEntry.STATE_NAMES[state];
    if (!sname) r.issues.push('State code ' + state + ' is not a GST state code.'); else r.fields.push(['State', state + ' · ' + sname]);
    var p = panCheck(pan);
    if (!p.ok) r.issues.push('Embedded PAN ' + pan + ' is not a valid PAN format.'); else { r.fields.push(['PAN', pan]); r.fields.push(['Holder type', p.type]); }
    if (!/[1-9A-Z]/.test(entity)) r.issues.push('13th character must be 1-9 or A-Z.'); else r.fields.push(['Registration no. in state', entity]);
    if (z !== 'Z') r.issues.push('14th character must be Z.');
    var sum = 0;
    for (var i = 0; i < 14; i++) { var v = B36.indexOf(g[i]), prod = v * (i % 2 ? 2 : 1); sum += Math.floor(prod / 36) + prod % 36; }
    var expect = B36[(36 - sum % 36) % 36];
    if (chk !== expect) r.issues.push('Checksum fails: the last character should be ' + expect + ' for these 14 characters. Likely a typo.'); else r.fields.push(['Checksum', 'Valid']);
    r.ok = r.issues.length === 0;
    return r;
  }
  var PAN_TYPES = { P: 'Individual', C: 'Company', H: 'Hindu Undivided Family', F: 'Partnership firm / LLP', A: 'Association of persons', T: 'Trust', B: 'Body of individuals', L: 'Local authority', J: 'Artificial juridical person', G: 'Government', K: 'Krish (deprecated)' };
  function panCheck(p, name) {
    p = String(p || '').trim().toUpperCase();
    var r = { input: p, ok: false, issues: [], fields: [], type: '' };
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p)) { r.issues.push('PAN format is AAAAA9999A: five letters, four digits, one letter.'); return r; }
    r.type = PAN_TYPES[p[3]] || 'Unknown holder type (' + p[3] + ')';
    if (!PAN_TYPES[p[3]]) r.issues.push('4th character ' + p[3] + ' is not a known holder type.'); else r.fields.push(['Holder type', r.type]);
    r.fields.push(['Name initial (5th char)', p[4] + (p[3] === 'P' ? ' · first letter of surname' : ' · first letter of entity name')]);
    if (name) { var n = String(name).trim().toUpperCase(); var first = (p[3] === 'P' ? n.split(/\s+/).pop() : n)[0]; if (first && first !== p[4]) r.issues.push('5th character ' + p[4] + ' does not match the name (expected ' + first + ' from "' + name + '").'); else if (first) r.fields.push(['Name check', 'Matches']); }
    r.ok = r.issues.length === 0;
    return r;
  }
  var BANKS = { SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IOBA: 'Indian Overseas Bank', IDIB: 'Indian Bank', BKID: 'Bank of India', CBIN: 'Central Bank of India', MAHB: 'Bank of Maharashtra', UCBA: 'UCO Bank', PSIB: 'Punjab & Sind Bank', YESB: 'Yes Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank', SIBL: 'South Indian Bank', KARB: 'Karnataka Bank', KVBL: 'Karur Vysya Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank', DLXB: 'Dhanlaxmi Bank', CSBK: 'CSB Bank', RATN: 'RBL Bank', IDFB: 'IDFC First Bank', BDBL: 'Bandhan Bank', AUBL: 'AU Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank', ESFB: 'Equitas Small Finance Bank', JAKA: 'Jammu & Kashmir Bank', SRCB: 'Saraswat Co-operative Bank', DCBL: 'DCB Bank', IBKL: 'IDBI Bank', PYTM: 'Paytm Payments Bank', AIRP: 'Airtel Payments Bank', FINO: 'Fino Payments Bank', HSBC: 'HSBC', SCBL: 'Standard Chartered Bank', CITI: 'Citibank', DEUT: 'Deutsche Bank', KCCB: 'Kerala Gramin / Co-op', SYNB: 'Syndicate Bank (now Canara Bank)', CORP: 'Corporation Bank (now Union Bank)', ANDB: 'Andhra Bank (now Union Bank)', ORBC: 'Oriental Bank of Commerce (now PNB)', UTBI: 'United Bank of India (now PNB)', ALLA: 'Allahabad Bank (now Indian Bank)', VIJB: 'Vijaya Bank (now Bank of Baroda)', DENA: 'Dena Bank (now Bank of Baroda)', LAVB: 'Lakshmi Vilas Bank (now DBS)', DBSS: 'DBS Bank India', SURY: 'Suryoday Small Finance Bank', JSFB: 'Jana Small Finance Bank', CLBL: 'Capital Small Finance Bank', FSFB: 'Fincare Small Finance Bank', NSPB: 'NSDL Payments Bank', IPOS: 'India Post Payments Bank', GSCB: 'Gujarat State Co-op Bank', TNSC: 'Tamil Nadu State Apex Co-op Bank', APGB: 'Andhra Pradesh Grameena Vikas Bank', KGRB: 'Karnataka Gramin Bank', PRTH: 'Prathama UP Gramin Bank', BRGB: 'Baroda Rajasthan Kshetriya Gramin Bank', SGBA: 'Saurashtra Gramin Bank', MSCI: 'Maharashtra State Co-op Bank', COSB: 'Cosmos Co-operative Bank', ABHY: 'Abhyudaya Co-op Bank', TJSB: 'TJSB Sahakari Bank', NKGS: 'NKGSB Co-op Bank', SVCB: 'SVC Co-operative Bank', BACB: 'Bassein Catholic Co-op Bank', KAIJ: 'Kalyan Janata Sahakari Bank' };
  function ifscCheck(c) {
    c = String(c || '').trim().toUpperCase();
    var r = { input: c, ok: false, issues: [], fields: [] };
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(c)) { r.issues.push('IFSC is 11 characters: 4 letters (bank), 0, then 6 letters/digits (branch).'); return r; }
    var bank = BANKS[c.slice(0, 4)];
    r.fields.push(['Bank', bank || 'Code ' + c.slice(0, 4) + ' (not in the offline list; use online lookup)']);
    r.fields.push(['Branch code', c.slice(5)]);
    r.ok = true; return r;
  }
  var CIN_TYPES = { PLC: 'Public limited company', PTC: 'Private limited company', FLC: 'Financial lease company (public)', FTC: 'Subsidiary of a foreign company (private)', GAP: 'General association (public)', GAT: 'General association (private)', NPL: 'Not-for-profit (Section 8) company', OPC: 'One person company', SGC: 'State government company', GOI: 'Government of India company', ULL: 'Unlimited liability (public)', ULT: 'Unlimited liability (private)' };
  var ROC_STATES = { AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh', CT: 'Chhattisgarh', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HP: 'Himachal Pradesh', HR: 'Haryana', JH: 'Jharkhand', JK: 'Jammu & Kashmir', KA: 'Karnataka', KL: 'Kerala', MH: 'Maharashtra', ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan', SK: 'Sikkim', TG: 'Telangana', TN: 'Tamil Nadu', TR: 'Tripura', UP: 'Uttar Pradesh', UR: 'Uttarakhand', WB: 'West Bengal', LD: 'Lakshadweep', DN: 'Dadra & Nagar Haveli', DD: 'Daman & Diu', AN: 'Andaman & Nicobar' };
  function cinCheck(c) {
    c = String(c || '').trim().toUpperCase();
    var r = { input: c, ok: false, issues: [], fields: [] };
    var m = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/.exec(c);
    if (!m) { r.issues.push('CIN is 21 characters: L/U + 5-digit industry code + 2-letter state + 4-digit year + 3-letter type + 6-digit registration number.'); return r; }
    r.fields.push(['Listing', m[1] === 'L' ? 'Listed' : 'Unlisted'], ['Industry code (NIC)', m[2]], ['Registered in', ROC_STATES[m[3]] ? m[3] + ' · ' + ROC_STATES[m[3]] : m[3] + ' (unknown ROC code)'], ['Year of incorporation', m[4]], ['Company type', CIN_TYPES[m[5]] || m[5] + ' (unknown)'], ['Registration no.', m[6]]);
    var yr = +m[4]; if (yr < 1850 || yr > new Date().getFullYear()) r.issues.push('Year ' + yr + ' looks wrong.');
    if (!ROC_STATES[m[3]]) r.issues.push('State code ' + m[3] + ' not recognised.');
    r.ok = r.issues.length === 0; return r;
  }
  // Verhoeff checksum (Aadhaar)
  var VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  var VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  function aadhaarCheck(a) {
    a = String(a || '').replace(/\s+/g, '');
    var r = { input: a, ok: false, issues: [], fields: [] };
    if (!/^\d{12}$/.test(a)) { r.issues.push('Aadhaar is 12 digits.'); return r; }
    if (/^[01]/.test(a)) r.issues.push('Aadhaar never starts with 0 or 1.');
    var c = 0, digits = a.split('').reverse();
    for (var i = 0; i < digits.length; i++) c = VD[c][VP[i % 8][+digits[i]]];
    if (c !== 0) r.issues.push('Checksum fails (Verhoeff). Likely a typo.'); else r.fields.push(['Checksum', 'Valid']);
    r.fields.push(['Masked', 'XXXX XXXX ' + a.slice(8)]);
    r.ok = r.issues.length === 0; return r;
  }

  /* ---- references -------------------------------------------------------- */
  var HSN = [['01','Live animals'],['02','Meat'],['03','Fish, seafood'],['04','Dairy, eggs, honey'],['05','Other animal products'],['06','Live plants, flowers'],['07','Vegetables'],['08','Fruits, nuts'],['09','Coffee, tea, spices'],['10','Cereals'],['11','Milling products, flour, malt'],['12','Oil seeds'],['13','Gums, resins'],['14','Vegetable plaiting materials'],['15','Fats and oils'],['16','Meat/fish preparations'],['17','Sugar, confectionery'],['18','Cocoa, chocolate'],['19','Cereal preparations, bakery'],['20','Vegetable/fruit preparations'],['21','Misc. edible (tea/coffee extracts, sauces, soups)'],['22','Beverages, spirits'],['23','Animal feed'],['24','Tobacco'],['25','Salt, cement, stone'],['26','Ores'],['27','Mineral fuels, oils'],['28','Inorganic chemicals'],['29','Organic chemicals'],['30','Pharmaceuticals'],['31','Fertilisers'],['32','Dyes, paints'],['33','Cosmetics, perfumery'],['34','Soap, detergents, waxes'],['35','Starches, glues'],['36','Explosives, matches'],['37','Photographic goods'],['38','Misc. chemical products'],['39','Plastics'],['40','Rubber'],['41','Raw hides, leather'],['42','Leather articles, bags'],['43','Furskins'],['44','Wood'],['45','Cork'],['46','Basketware'],['47','Pulp'],['48','Paper, paperboard'],['49','Printed books, newspapers'],['50','Silk'],['51','Wool'],['52','Cotton'],['53','Other vegetable fibres'],['54','Man-made filaments'],['55','Man-made staple fibres'],['56','Wadding, felt, ropes'],['57','Carpets'],['58','Special woven fabrics'],['59','Coated textiles'],['60','Knitted fabrics'],['61','Knitted apparel'],['62','Woven apparel'],['63','Other textile articles'],['64','Footwear'],['65','Headgear'],['66','Umbrellas'],['67','Feathers, artificial flowers'],['68','Stone, plaster, cement articles'],['69','Ceramics'],['70','Glass'],['71','Pearls, jewellery, precious metals'],['72','Iron and steel'],['73','Iron/steel articles'],['74','Copper'],['75','Nickel'],['76','Aluminium'],['78','Lead'],['79','Zinc'],['80','Tin'],['81','Other base metals'],['82','Tools, cutlery'],['83','Misc. metal articles'],['84','Machinery, mechanical appliances, computers'],['85','Electrical machinery, electronics, phones'],['86','Railway'],['87','Vehicles'],['88','Aircraft'],['89','Ships'],['90','Optical, medical instruments'],['91','Clocks, watches'],['92','Musical instruments'],['93','Arms'],['94','Furniture, lighting'],['95','Toys, sports goods'],['96','Misc. manufactured (pens, brushes)'],['97','Art, antiques'],['99','Services (SAC)']];
  var SAC = [['9954','Construction services'],['995411','Construction of residential buildings'],['9961','Wholesale trade services'],['9962','Retail trade services'],['9963','Accommodation, food and beverage'],['996331','Restaurant services'],['9964','Passenger transport'],['9965','Goods transport'],['996511','Road transport of goods (GTA)'],['9966','Rental of transport vehicles'],['9967','Supporting transport services'],['9968','Postal and courier'],['9971','Financial and related services'],['9972','Real estate services'],['997212','Rental or leasing of own property (rent)'],['9973','Leasing or rental without operator'],['9981','Research and development'],['9982','Legal and accounting'],['998212','Legal advisory'],['998221','Accounting and bookkeeping'],['998222','Auditing'],['9983','Other professional, technical, business'],['998311','Management consulting'],['998313','IT consulting and support'],['998314','IT design and development'],['998315','Hosting and IT infrastructure'],['998361','Advertising'],['998399','Other professional services'],['9984','Telecommunications, broadcasting'],['9985','Support services'],['998511','Executive/retained personnel search'],['998512','Permanent placement'],['998513','Contract staffing'],['998596','Events, exhibitions'],['998599','Other support services'],['9986','Agriculture, forestry, fishing support'],['9987','Maintenance, repair and installation'],['998713','Repair of computers'],['998714','Repair of vehicles'],['9988','Manufacturing services on physical inputs (job work)'],['9989','Other manufacturing, publishing, printing'],['998912','Printing'],['9991','Public administration'],['9992','Education'],['9993','Human health and social care'],['9994','Sewage, waste, sanitation'],['9995','Membership organisations'],['9996','Recreation, culture, sport'],['9997','Other services'],['999721','Beauty and physical well-being'],['999711','Laundry'],['9998','Domestic services']];
  // r = main rate, r2 = alternate rate (194C individual/HUF payee; 194I plant & machinery; 194J technical / call centre), sub = labels for the alternate control
  var TDS = [
    { sec: '192', what: 'Salary', rate: 'Slab rates', threshold: 'Basic exemption limit', r: null },
    { sec: '194A', what: 'Interest (other than securities)', rate: '10%', threshold: 'Senior citizens ₹1,00,000; bank / co-op society / post office ₹50,000; others ₹10,000', r: 10 },
    { sec: '194C', what: 'Contractor / sub-contractor', rate: '1% individual/HUF · 2% others', threshold: '₹30,000 single payment or ₹1,00,000 in a year', r: 2, r2: 1 },
    { sec: '194H', what: 'Commission or brokerage', rate: '2% (from 1 Oct 2024)', threshold: '₹20,000 per year', r: 2 },
    { sec: '194I', what: 'Rent', rate: '10% land/building/furniture · 2% plant & machinery', threshold: '₹6,00,000 per year (₹50,000 per month)', r: 10, r2: 2, sub: ['Land / building / furniture (10%)', 'Plant & machinery (2%)'] },
    { sec: '194J', what: 'Professional fees · technical services', rate: '10% professional · 2% technical / call centre', threshold: '₹50,000 per year', r: 10, r2: 2, sub: ['Professional fees (10%)', 'Technical / call centre (2%)'] },
    { sec: '194Q', what: 'Purchase of goods', rate: '0.1%', threshold: 'On value above ₹50 lakh in a year (buyer turnover > ₹10 Cr)', r: 0.1, noPan: 5 },
    { sec: '194O', what: 'E-commerce participants', rate: '0.1%', threshold: '₹5,00,000 (individual/HUF)', r: 0.1, noPan: 5 },
    { sec: '194T', what: "Partners' salary, commission, interest (from FY 2025-26)", rate: '10%', threshold: '₹20,000 per year', r: 10 },
    { sec: '194DA', what: 'Life insurance policy payout', rate: '2%', threshold: '₹1,00,000', r: 2 },
    { sec: '194K', what: 'Income from mutual fund units', rate: '10%', threshold: '₹10,000', r: 10 },
    { sec: '194S', what: 'Virtual digital assets', rate: '1%', threshold: '₹50,000 (specified persons) / ₹10,000', r: 1 },
    { sec: '195', what: 'Payments to non-residents', rate: 'As per Act / DTAA', threshold: 'None', r: null }
  ];
  // Pure rate rule for the calculator. o: { ind (individual/HUF payee), sub ('a' main rate | 'b' alternate), noPan }.
  // The sub-rate (194I/194J) and the 194C payee rate are chosen first; section 206AA then lifts the rate to 20%,
  // or to 5% for 194Q and 194O, when the payee has no PAN.
  function tdsRate(sec, o) {
    var t = typeof sec === 'string' ? TDS.filter(function (x) { return x.sec === sec; })[0] : sec; o = o || {};
    if (!t || t.r == null) return null;
    var rate = t.r;
    if (t.sec === '194C' && o.ind && t.r2 != null) rate = t.r2;
    if (t.sub && o.sub === 'b' && t.r2 != null) rate = t.r2;
    if (o.noPan) rate = Math.max(t.noPan || 20, rate);
    return rate;
  }
  // GSTR-3B for quarterly (QRMP) filers: 22nd for group 1 states (south, west, central), 24th for group 2 (north, east, north-east).
  var QRMP_24 = { '01': 1, '02': 1, '03': 1, '04': 1, '05': 1, '06': 1, '07': 1, '08': 1, '09': 1, '10': 1, '11': 1, '12': 1, '13': 1, '14': 1, '15': 1, '16': 1, '17': 1, '18': 1, '19': 1, '20': 1, '21': 1, '38': 1 };
  function companyStateCode() {
    var c = A.S.company; if (!c) return '';
    var st = A.companySettings ? A.companySettings().state : ((c.settings && c.settings.state) || (c.info && c.info.state) || '');
    return TVEntry.stateCode(st) || '';
  }
  function qrmpDay() { var sc = companyStateCode(); return sc && QRMP_24[sc] ? 24 : 22; }
  // day may be a function; `days` maps month → day for exceptions (TDS for March is due 30 Apr; AOC-4 30 Oct vs MGT-7 29 Nov)
  var CAL = [
    { name: 'GSTR-1 (monthly)', day: 11, every: 'month', who: 'Outward supplies for the previous month' },
    { name: 'GSTR-3B (monthly)', day: 20, every: 'month', who: 'Summary return and tax payment' },
    { name: 'GSTR-1 / IFF (QRMP)', day: 13, every: 'quarter', who: 'Quarterly filers; IFF optional monthly' },
    { name: 'GSTR-3B (QRMP)', day: qrmpDay, every: 'quarter', who: 'Quarterly filers (22nd or 24th by state)' },
    { name: 'PMT-06 (QRMP tax)', day: 25, months: [2, 3, 5, 6, 8, 9, 11, 12], who: 'Monthly tax payment for quarterly filers (first two months of each quarter)' },
    { name: 'TDS / TCS payment', day: 7, every: 'month', days: { 4: 30 }, who: 'Tax deducted in the previous month (TDS for March by 30 Apr; TCS by 7 Apr)' },
    { name: 'TDS return (24Q/26Q)', months: [7, 10, 1, 5], day: 31, who: 'Quarterly: 31 Jul, 31 Oct, 31 Jan, 31 May' },
    { name: 'Advance tax', months: [6, 9, 12, 3], day: 15, who: '15%, 45%, 75%, 100% cumulative' },
    { name: 'PF (ECR) and ESI', day: 15, every: 'month', who: 'Contributions for the previous month' },
    { name: 'Professional tax', day: 20, every: 'month', who: 'Varies by state' },
    { name: 'GSTR-9 / 9C annual return', months: [12], day: 31, who: 'For the previous financial year' },
    { name: 'ITR (non-audit)', months: [7], day: 31, who: 'Individuals, firms not under audit' },
    { name: 'Tax audit report', months: [9], day: 30, who: 'Form 3CA/3CB-3CD' },
    { name: 'ITR (audit cases)', months: [10], day: 31, who: 'Companies and audited taxpayers' },
    { name: 'MCA annual filings (AOC-4 / MGT-7)', months: [10, 11], day: 29, days: { 10: 30 }, who: 'Companies: AOC-4 within 30 days (30 Oct), MGT-7 within 60 days (29 Nov) of a 30 Sep AGM' }
  ];
  function appliesIn(c, mo) { return c.every === 'month' || (c.every === 'quarter' && [1, 4, 7, 10].indexOf(mo) !== -1) || (c.months && c.months.indexOf(mo) !== -1); }
  function dueDay(c, mo) { if (c.days && c.days[mo] != null) return c.days[mo]; return typeof c.day === 'function' ? c.day() : c.day; }
  // Next due date of every entry, compared midnight to midnight so "today" / "in N d" is right at any hour.
  function upcoming(n, now) {
    now = now || new Date();
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), out = [];
    CAL.forEach(function (c) {
      for (var k = 0; k < 14; k++) {
        var d = new Date(t0.getFullYear(), t0.getMonth() + k, 1), mo = d.getMonth() + 1;
        if (!appliesIn(c, mo)) continue;
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        var due = new Date(d.getFullYear(), d.getMonth(), Math.min(dueDay(c, mo), last));
        if (due >= t0) { out.push({ name: c.name, who: c.who, due: due, days: Math.round((due - t0) / 86400000) }); break; }
      }
    });
    return out.sort(function (a, b) { return a.due - b.due; }).slice(0, n || 12);
  }

  /* ---- UI ------------------------------------------------------------------- */
  var TOOLS = [
    ['Verify', [['gstin', 'GSTIN check', 'Format, state, PAN and checksum', 'ledger'], ['pan', 'PAN check', 'Format and holder type', 'receivable'], ['ifsc', 'IFSC lookup', 'Bank, branch; online details', 'bank'], ['cin', 'CIN decoder', 'Company identification number', 'report'], ['aadhaar', 'Aadhaar check', 'Verhoeff checksum', 'entry']]],
    ['Calculate', [['gstcalc', 'GST calculator', 'Inclusive or exclusive, split', 'sales'], ['tds', 'TDS calculator', 'By section, with thresholds', 'expense'], ['emi', 'EMI / loan', 'Instalment and schedule', 'bank'], ['interest', 'Interest on dues', 'Between two dates', 'profit'], ['margin', 'Margin & markup', 'Cost, price, profit', 'purchase'], ['words', 'Amount in words', 'For cheques and invoices', 'vouchers']]],
    ['Reference', [['calendar', 'Compliance calendar', 'Upcoming due dates', 'report'], ['hsn', 'HSN / SAC search', 'Chapters and service codes', 'ledger'], ['tdsrates', 'TDS rate table', 'FY 2025-26 (verify)', 'expense']]]
  ];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function icon(k) { return (A.ICONS[k] || '').replace('<svg', '<svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"'); }
  SCREENS.tools = function () {
    A.topbar({ title: 'Tools', sub: 'Verify, calculate, remember', period: false, right: '<button class="chip" data-go="more" aria-label="More">' + (A.ICONS.gear || '⚙') + '</button>' });
    var up = upcoming(3);
    var h = '<div class="card"><h2><a class="more" href="#/tool/calendar">All ›</a>Due soon</h2>' + up.map(function (u) { return '<div class="kv"><span>' + esc(u.name) + '<div class="small faint">' + esc(u.who) + '</div></span><span><b>' + u.due.getDate() + ' ' + MON[u.due.getMonth()] + '</b><div class="small ' + (u.days <= 3 ? 'dr' : 'faint') + '">' + (u.days === 0 ? 'today' : 'in ' + u.days + ' d') + '</div></span></div>'; }).join('') + '</div>';
    TOOLS.forEach(function (sec) {
      h += '<div class="section-title">' + sec[0] + '</div><div class="tools">' + sec[1].map(function (t) { return '<a class="tool" href="#/tool/' + t[0] + '"><span class="ico">' + icon(t[3]) + '</span><span class="t">' + esc(t[1]) + '</span><span class="s">' + esc(t[2]) + '</span></a>'; }).join('') + '</div>';
    });
    A.$view().innerHTML = h;
  };
  function result(r, links) {
    var h = '<div class="card"><div class="verdict ' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓ Looks valid' : '✕ ' + (r.issues.length ? 'Problems found' : 'Invalid')) + '</div>';
    r.issues.forEach(function (i) { h += '<div class="kv"><span class="dr">' + esc(i) + '</span></div>'; });
    r.fields.forEach(function (f) { h += '<div class="kv"><span class="muted">' + esc(f[0]) + '</span><span>' + esc(f[1]) + '</span></div>'; });
    if (links) h += '<div class="btn-row">' + links.map(function (l) { return '<a class="btn" href="' + l[1] + '" target="_blank" rel="noopener">' + esc(l[0]) + ' ↗</a>'; }).join('') + '</div>';
    return h + '</div>';
  }
  function field(id, label, value, attrs) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" value="' + esc(value || '') + '" ' + (attrs || '') + '></div>'; }
  // Segmented control: opts = [[value, label], ...]; the first is selected unless `on` says otherwise
  function seg(id, opts, on, label) { return '<div class="seg" id="' + id + '" role="group"' + (label ? ' aria-label="' + esc(label) + '"' : '') + '>' + opts.map(function (o, i) { var isOn = on ? o[0] === on : i === 0; return '<button type="button" class="' + (isOn ? 'on' : '') + '" data-m="' + esc(o[0]) + '" aria-pressed="' + (isOn ? 'true' : 'false') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function segValue(id) { var b = $(id) && $(id).querySelector('.on'); return b ? b.getAttribute('data-m') : ''; }
  function wireSeg(id, onChange) {
    var box = $(id); if (!box) return;
    box.querySelectorAll('button').forEach(function (b) { b.onclick = function () { box.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); if (onChange) onChange(b.getAttribute('data-m')); }; });
  }
  function $(id) { return document.getElementById(id); }
  var TOOL = {};
  TOOL.gstin = { title: 'GSTIN check', render: function () { return '<div class="card">' + field('t-in', 'GSTIN', '', 'placeholder="29AAAFK8047M1ZU" style="text-transform:uppercase" autocomplete="off" autocapitalize="characters"') + '<button class="btn primary block" id="t-go">Check</button></div><div id="t-out"></div>'; }, run: function () { var v = $('t-in').value; $('t-out').innerHTML = result(gstinCheck(v), [['Verify on GST portal', 'https://services.gst.gov.in/services/searchtp']]); } };
  TOOL.pan = { title: 'PAN check', render: function () { return '<div class="card">' + field('t-in', 'PAN', '', 'placeholder="AAAFK8047M" style="text-transform:uppercase" autocomplete="off" autocapitalize="characters"') + field('t-name', 'Name on PAN (optional, to check the 5th character)', '', 'placeholder="Kirana Trading Co"') + '<button class="btn primary block" id="t-go">Check</button></div><div id="t-out"></div>'; }, run: function () { $('t-out').innerHTML = result(panCheck($('t-in').value, $('t-name').value), [['Verify on e-filing portal', 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/verifyYourPAN']]); } };
  TOOL.ifsc = { title: 'IFSC lookup', render: function () { return '<div class="card">' + field('t-in', 'IFSC code', '', 'placeholder="CNRB0000440" style="text-transform:uppercase" autocomplete="off" autocapitalize="characters"') + '<div class="btn-row"><button class="btn primary" id="t-go">Check</button><button class="btn" id="t-online">Look up branch online</button></div></div><div id="t-out"></div>'; },
    run: function () { $('t-out').innerHTML = result(ifscCheck($('t-in').value)); },
    extra: function () { $('t-online').onclick = function () { var c = $('t-in').value.trim().toUpperCase(), r = ifscCheck(c); if (!r.ok) { $('t-out').innerHTML = result(r); return; } $('t-out').innerHTML = '<div class="card muted">Looking up ' + esc(c) + '…</div>';
      fetch('https://ifsc.razorpay.com/' + encodeURIComponent(c)).then(function (x) { if (!x.ok) throw new Error(x.status === 404 ? 'IFSC not found' : 'Lookup failed (' + x.status + ')'); return x.json(); }).then(function (j) { r.fields = [['Bank', j.BANK], ['Branch', j.BRANCH], ['Address', j.ADDRESS], ['City / State', [j.CITY, j.STATE].filter(Boolean).join(', ')], ['MICR', j.MICR || '—'], ['NEFT / RTGS / IMPS / UPI', [j.NEFT && 'NEFT', j.RTGS && 'RTGS', j.IMPS && 'IMPS', j.UPI && 'UPI'].filter(Boolean).join(' · ') || '—']]; $('t-out').innerHTML = result(r); announceOut(); }).catch(function (e) { r.issues.push('Online lookup: ' + e.message + ' (needs internet).'); r.ok = false; $('t-out').innerHTML = result(r); announceOut(); }); }; } };
  TOOL.cin = { title: 'CIN decoder', render: function () { return '<div class="card">' + field('t-in', 'CIN', '', 'placeholder="U72200KA2015PTC082034" style="text-transform:uppercase" autocomplete="off" autocapitalize="characters"') + '<button class="btn primary block" id="t-go">Decode</button></div><div id="t-out"></div>'; }, run: function () { $('t-out').innerHTML = result(cinCheck($('t-in').value), [['Look up on MCA', 'https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html']]); } };
  TOOL.aadhaar = { title: 'Aadhaar check', render: function () { return '<div class="card">' + field('t-in', 'Aadhaar number', '', 'placeholder="2345 6789 0123" inputmode="numeric" autocomplete="off"') + '<button class="btn primary block" id="t-go">Check</button><p class="small muted" style="margin-top:10px">Checks the number\'s own checksum only. Nothing is sent anywhere.</p></div><div id="t-out"></div>'; }, run: function () { $('t-out').innerHTML = result(aadhaarCheck($('t-in').value)); } };
  TOOL.gstcalc = { title: 'GST calculator', render: function () { return '<div class="card">' + field('t-amt', 'Amount', '', 'type="number" inputmode="decimal" placeholder="10000"') + '<div class="field"><label for="t-rate">GST rate</label><select id="t-rate">' + [0, 0.25, 3, 5, 12, 18, 28].map(function (r) { return '<option value="' + r + '"' + (r === 18 ? ' selected' : '') + '>' + r + '%</option>'; }).join('') + '</select></div>' + seg('t-mode', [['excl', 'Amount is before tax'], ['incl', 'Amount includes tax']], 'excl', 'Amount basis') + seg('t-sup', [['intra', 'Within state'], ['inter', 'Inter-state']], 'intra', 'Supply type') + '<button class="btn primary block" id="t-go">Calculate</button></div><div id="t-out"></div>'; },
    run: function () { var amt = +$('t-amt').value || 0, rate = +$('t-rate').value, incl = segValue('t-mode') === 'incl', inter = segValue('t-sup') === 'inter'; var base = incl ? amt / (1 + rate / 100) : amt, tax = base * rate / 100, total = base + tax; var r2 = function (n) { return Math.round(n * 100) / 100; };
      var tx = inter ? r2(tax) : 2 * r2(tax / 2); if (incl) base = amt - tx; else total = r2(base) + tx; // the rounded parts shown must add up to the total
      $('t-out').innerHTML = '<div class="card"><div class="kv"><span>Taxable value</span><span class="num">' + fmt(r2(base)) + '</span></div>' + (inter ? '<div class="kv"><span>IGST @ ' + rate + '%</span><span class="num">' + fmt(r2(tax)) + '</span></div>' : '<div class="kv"><span>CGST @ ' + rate / 2 + '%</span><span class="num">' + fmt(r2(tax / 2)) + '</span></div><div class="kv"><span>SGST @ ' + rate / 2 + '%</span><span class="num">' + fmt(r2(tax / 2)) + '</span></div>') + '<div class="kv"><span><b>Total</b></span><span class="num" style="font-weight:800">' + cash(r2(total)) + '</span></div><div class="small muted" style="margin-top:6px">' + esc(TVEntry.amountInWords(r2(total))) + '</div></div>'; },
    extra: function () { wireSeg('t-mode'); wireSeg('t-sup'); } };
  TOOL.tds = { title: 'TDS calculator', render: function () {
      var first = TDS.filter(function (t) { return t.r != null; })[0];
      return '<div class="card"><div class="field"><label for="t-sec">Section</label><select id="t-sec">' + TDS.filter(function (t) { return t.r != null; }).map(function (t) { return '<option value="' + t.sec + '">' + t.sec + ' · ' + esc(t.what) + '</option>'; }).join('') + '</select></div>' + field('t-amt', 'Payment amount', '', 'type="number" inputmode="decimal" placeholder="50000"') +
        seg('t-who', [['other', 'Company / firm payee'], ['ind', 'Individual / HUF payee']], 'other', 'Payee type') +
        '<div id="t-subwrap"' + (first && first.sub ? '' : ' hidden') + '>' + seg('t-sub', [['a', first && first.sub ? first.sub[0] : ''], ['b', first && first.sub ? first.sub[1] : '']], 'a', 'Nature of payment') + '</div>' +
        '<label class="chk"><input type="checkbox" id="t-nopan"> Payee has no PAN (20% under section 206AA; 5% for 194Q / 194O)</label><button class="btn primary block" id="t-go">Calculate</button></div><div id="t-out"></div>';
    },
    run: function () {
      var sec = TDS.filter(function (t) { return t.sec === $('t-sec').value; })[0], amt = +$('t-amt').value || 0, ind = segValue('t-who') === 'ind', sub = segValue('t-sub') || 'a', noPan = $('t-nopan').checked;
      var rate = tdsRate(sec, { ind: ind, sub: sub, noPan: noPan }), tds = Math.round(amt * rate) / 100;
      var basis = sec.sub ? sec.sub[sub === 'b' ? 1 : 0] : (sec.sec === '194C' ? (ind ? 'Individual / HUF payee (1%)' : 'Company / firm payee (2%)') : '');
      $('t-out').innerHTML = '<div class="card"><div class="kv"><span>Section</span><span>' + sec.sec + ' · ' + esc(sec.what) + '</span></div>' + (basis ? '<div class="kv"><span>Basis</span><span>' + esc(basis) + '</span></div>' : '') + '<div class="kv"><span>Rate applied</span><span>' + rate + '%' + (noPan ? ' (no PAN, s.206AA)' : '') + '</span></div><div class="kv"><span>TDS to deduct</span><span class="num" style="font-weight:800">' + cash(tds) + '</span></div><div class="kv"><span>Net payable to payee</span><span class="num">' + cash(amt - tds) + '</span></div><div class="kv"><span class="muted">Threshold</span><span class="small">' + esc(sec.threshold) + '</span></div><p class="small muted" style="margin-top:8px">Rate card: ' + esc(sec.rate) + '. Without a PAN, section 206AA lifts the rate to 20% (5% for 194Q and 194O). Rates as commonly applied for FY 2025-26; verify against the current Finance Act.</p></div>';
    },
    extra: function () {
      wireSeg('t-who'); wireSeg('t-sub');
      $('t-sec').onchange = function () {
        var sec = TDS.filter(function (t) { return t.sec === $('t-sec').value; })[0], wrap = $('t-subwrap'), btns = $('t-sub').querySelectorAll('button');
        wrap.hidden = !(sec && sec.sub);
        if (sec && sec.sub) { btns[0].textContent = sec.sub[0]; btns[1].textContent = sec.sub[1]; }
        btns.forEach(function (b, i) { b.classList.toggle('on', i === 0); b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'); });
      };
    } };
  TOOL.emi = { title: 'EMI / loan', render: function () { return '<div class="card">' + field('t-p', 'Loan amount', '', 'type="number" inputmode="decimal" placeholder="500000"') + field('t-r', 'Interest rate (% per year)', '', 'type="number" inputmode="decimal" placeholder="10.5" step="0.01"') + field('t-n', 'Tenure (months)', '', 'type="number" inputmode="numeric" placeholder="36"') + '<button class="btn primary block" id="t-go">Calculate</button></div><div id="t-out"></div>'; },
    run: function () { var P = +$('t-p').value || 0, r = (+$('t-r').value || 0) / 1200, n = +$('t-n').value || 0; if (!P || !n) { toast('Enter amount and tenure'); return; } var emi = r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n, bal = P, rows = '', ti = 0; for (var i = 1; i <= n; i++) { var intr = bal * r, pr = emi - intr; bal -= pr; ti += intr; if (i <= 12 || i === n) rows += '<tr><td>' + i + '</td><td class="n">' + fmt(pr) + '</td><td class="n">' + fmt(intr) + '</td><td class="n">' + fmt(Math.max(0, bal)) + '</td></tr>'; else if (i === 13) rows += '<tr><td colspan="4" class="faint small">…</td></tr>'; }
      $('t-out').innerHTML = '<div class="tiles"><div class="tile"><div class="label">Monthly EMI</div><div class="value num">' + cash(Math.round(emi * 100) / 100) + '</div></div><div class="tile"><div class="label">Total interest</div><div class="value num">' + A.compact(ti) + '</div><div class="sub">Total paid ' + A.compact(P + ti) + '</div></div></div><div class="card scroll" style="overflow:auto"><h2>Schedule</h2><table class="tbl"><tr><th>#</th><th class="n">Principal</th><th class="n">Interest</th><th class="n">Balance</th></tr>' + rows + '</table></div>'; } };
  TOOL.interest = { title: 'Interest on dues', render: function () { var t = new Date(); return '<div class="card">' + field('t-p', 'Amount', '', 'type="number" inputmode="decimal" placeholder="100000"') + field('t-r', 'Rate (% per year)', '18', 'type="number" inputmode="decimal" step="0.01"') + '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="t-from">From</label><input type="date" id="t-from"></div><div class="field" style="flex:1"><label for="t-to">To</label><input type="date" id="t-to" value="' + A.toISO(t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate()) + '"></div></div>' + seg('t-kind', [['simple', 'Simple'], ['monthly', 'Compound monthly'], ['yearly', 'Compound yearly']], 'simple', 'Interest method') + '<button class="btn primary block" id="t-go">Calculate</button></div><div id="t-out"></div>'; },
    run: function () { var P = +$('t-p').value || 0, R = +$('t-r').value || 0, f = new Date($('t-from').value), t = new Date($('t-to').value); if (!P || isNaN(f) || isNaN(t)) { toast('Enter amount and both dates'); return; } var days = Math.round((t - f) / 86400000), kind = segValue('t-kind'), yrs = days / 365, I = kind === 'simple' ? P * R / 100 * yrs : kind === 'monthly' ? P * (Math.pow(1 + R / 1200, days / 30.4167) - 1) : P * (Math.pow(1 + R / 100, yrs) - 1);
      $('t-out').innerHTML = '<div class="card"><div class="kv"><span>Days</span><span class="num">' + days + '</span></div><div class="kv"><span>Interest</span><span class="num" style="font-weight:800">' + cash(Math.round(I * 100) / 100) + '</span></div><div class="kv"><span>Amount with interest</span><span class="num">' + cash(Math.round((P + I) * 100) / 100) + '</span></div></div>'; },
    extra: function () { wireSeg('t-kind'); } };
  TOOL.margin = { title: 'Margin & markup', render: function () { return '<div class="card">' + field('t-c', 'Cost price', '', 'type="number" inputmode="decimal" placeholder="800"') + field('t-s', 'Selling price (leave blank to compute from margin)', '', 'type="number" inputmode="decimal" placeholder="1000"') + field('t-m', 'Target margin % (on selling price)', '', 'type="number" inputmode="decimal" placeholder="20"') + '<button class="btn primary block" id="t-go">Calculate</button></div><div id="t-out"></div>'; },
    run: function () { var c = +$('t-c').value || 0, s = +$('t-s').value || 0, m = +$('t-m').value || 0; if (!s && m) s = c / (1 - m / 100); if (!c || !s) { toast('Enter cost and price or margin'); return; } var p = s - c; $('t-out').innerHTML = '<div class="card"><div class="kv"><span>Selling price</span><span class="num">' + cash(s) + '</span></div><div class="kv"><span>Profit</span><span class="num ' + (p < 0 ? 'dr' : 'cr') + '">' + cash(p) + '</span></div><div class="kv"><span>Margin (on price)</span><span class="num">' + (p / s * 100).toFixed(2) + '%</span></div><div class="kv"><span>Markup (on cost)</span><span class="num">' + (p / c * 100).toFixed(2) + '%</span></div></div>'; } };
  TOOL.words = { title: 'Amount in words', render: function () { return '<div class="card">' + field('t-amt', 'Amount', '', 'type="number" inputmode="decimal" placeholder="2213800.57" step="0.01"') + '<button class="btn primary block" id="t-go">Convert</button></div><div id="t-out"></div>'; }, run: function () { var a = +$('t-amt').value || 0, w = TVEntry.amountInWords(a); $('t-out').innerHTML = '<div class="card"><div style="font-size:17px;font-weight:700;line-height:1.5">' + esc(w) + '</div><div class="small muted" style="margin-top:8px">' + cash(a) + '</div><div class="btn-row"><button class="btn" id="t-copy">Copy</button></div></div>'; $('t-copy').onclick = function () { navigator.clipboard && navigator.clipboard.writeText(w).then(function () { toast('Copied'); }); }; } };
  TOOL.calendar = { title: 'Compliance calendar', render: function () {
      var up = upcoming(20), sc = companyStateCode(), sname = sc ? TVEntry.STATE_NAMES[sc] : '';
      var qnote = sc ? 'GSTR-3B (QRMP) is shown on the ' + qrmpDay() + 'th for ' + sname + '.' : 'GSTR-3B (QRMP) is shown on the 22nd; it is the 24th in the northern, eastern and north-eastern states (HP, Punjab, Uttarakhand, Haryana, Rajasthan, UP, Bihar, Sikkim, the north-east, West Bengal, Jharkhand, Odisha, J&K, Ladakh, Chandigarh, Delhi). Set the company state under Company GST details to pick the right date.';
      return '<div class="list">' + up.map(function (u) { return '<div class="row static"><div class="main"><div class="t">' + esc(u.name) + '</div><div class="s">' + esc(u.who) + '</div></div><div class="amt"><div class="v">' + u.due.getDate() + ' ' + MON[u.due.getMonth()] + '</div><div class="s ' + (u.days <= 3 ? 'dr' : '') + '">' + (u.days === 0 ? 'today' : 'in ' + u.days + ' day' + (u.days === 1 ? '' : 's')) + '</div></div></div>'; }).join('') + '</div><p class="small muted">Standard due dates; extensions announced by notification are not tracked. ' + esc(qnote) + ' GST late fee is ₹50 per day (₹20 for nil returns), capped by turnover.</p>';
    }, run: function () {} };
  TOOL.hsn = { title: 'HSN / SAC search', render: function () { return '<div class="search"><input type="search" id="t-q" aria-label="Search HSN and SAC codes" placeholder="Search e.g. rent, cement, 9972, 84"></div><div id="t-out"></div>'; }, run: function () {}, extra: function () { var q = $('t-q'); function draw() { var t = q.value.trim().toLowerCase(), rows = HSN.concat(SAC).filter(function (x) { return !t || x[0].indexOf(t) === 0 || x[1].toLowerCase().indexOf(t) !== -1; }).slice(0, 60); $('t-out').innerHTML = '<div class="list">' + rows.map(function (x) { return '<div class="row static"><span class="badge" data-base="' + (x[0].length >= 4 && x[0][0] === '9' ? 'Journal' : 'Sales') + '">' + x[0] + '</span><div class="main"><div class="t" style="white-space:normal">' + esc(x[1]) + '</div><div class="s">' + (x[0].length >= 4 && x[0][0] === '9' ? 'SAC · services' : 'HSN chapter') + '</div></div></div>'; }).join('') + '</div>' + (t ? '' : '<p class="small muted">Chapter level for goods; common service codes. Use the exact 6/8-digit code from your supplier or the GST rate finder for rates.</p>'); } q.oninput = draw; draw(); } };
  TOOL.tdsrates = { title: 'TDS rate table', render: function () { return '<div class="list">' + TDS.map(function (t) { return '<div class="row static"><span class="badge" data-base="Payment">' + t.sec + '</span><div class="main"><div class="t" style="white-space:normal">' + esc(t.what) + '</div><div class="s" style="white-space:normal">' + esc(t.rate) + ' · ' + esc(t.threshold) + '</div></div></div>'; }).join('') + '</div><p class="small muted">As commonly applied for FY 2025-26 (Finance Act 2025 thresholds). Verify before relying on it. Without a PAN the rate is 20% under section 206AA, or 5% for 194Q and 194O.</p>'; }, run: function () {} };
  function announceOut() { if (!A.announce) return; var out = $('t-out'); if (out) A.announce(out.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)); }
  SCREENS.tool = function (r) {
    var t = TOOL[r.arg]; if (!t) { go('#/tools'); return; }
    A.topbar({ title: t.title, back: true, period: false });
    A.$view().innerHTML = t.render();
    var g = $('t-go'); if (g) { var run = function () { t.run(); announceOut(); }; g.onclick = run; A.$view().querySelectorAll('input').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); }); }); }
    if (t.extra) t.extra();
    var first = A.$view().querySelector('input'); if (first && r.arg !== 'interest') setTimeout(function () { first.focus(); }, 80);
  };
  window.TVTools = { gstinCheck: gstinCheck, panCheck: panCheck, ifscCheck: ifscCheck, cinCheck: cinCheck, aadhaarCheck: aadhaarCheck, upcoming: upcoming, tdsRate: tdsRate, qrmpDay: qrmpDay, dueDay: dueDay, CAL: CAL, TDS: TDS };
})();
