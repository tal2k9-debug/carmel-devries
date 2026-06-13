/**
 * Carmel De-vries — web order intake.
 *
 * Receives an order from the public site, atomically decrements stock in the
 * Products sheet, and records the order in the Orders sheet — so a purchase
 * made on the website reduces inventory immediately, with no manual step.
 *
 * LockService serialises concurrent orders, so two customers buying the last
 * units of the same product at the same moment cannot both succeed.
 *
 * --- DEPLOY (one time) ---
 * 1. Open the spreadsheet → Extensions → Apps Script.
 * 2. Delete whatever is there, paste this whole file, Save.
 * 3. Deploy → New deployment → type: Web app.
 *      Description: carmel order intake
 *      Execute as: Me
 *      Who has access: Anyone
 *    → Deploy → Authorize.
 * 4. Copy the Web app URL (ends with /exec).
 * 5. Paste that URL into index.html as WEBAPP_URL, commit, push.
 *
 * Re-deploying after edits: Deploy → Manage deployments → edit (pencil) →
 * Version: New version → Deploy. The /exec URL stays the same.
 */

// The Products / Orders spreadsheet — opened by ID so the script works whether
// it is container-bound or a standalone project.
var SHEET_ID = '1NOdPG_jdhVfD_Du24E6i3fWTOjPSqfoarJ1tkq6OIRk';

// Drive folder where uploaded product images are stored (auto-created on first use).
var DRIVE_FOLDER_NAME = 'Carmel — תמונות אתר';
// Max bytes per uploaded image (decoded). 10 MB ceiling.
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// --- אבטחה ---
// הגיליון פרטי (לא משותף לציבור). כל קריאה ציבורית עוברת דרך הסקריפט הזה,
// שרץ בהרשאות הבעלים: מוצרים מפורסמים בלבד פתוחים לאתר; הזמנות/קבלות דורשות
// סוד משותף (Script Properties → CARMEL_HOOK_SECRET) שמחזיק רק הבוט בשרת.
// העלאת תמונות דורשת טוקן גוגל של אחת המנהלות (נבדק מול tokeninfo).
var ALLOWED_UPLOADERS = ['tal2k9@gmail.com', 'kerencarmel8@gmail.com'];

function doPost(e) {
  var payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok:false, error:'bad_json' }); }

  // Route by action; default action (no action field) is "order".
  if (payload && payload.action === 'image_upload') {
    return handleImageUpload(payload);
  }
  // The receipt bot calls this to attach the Rivhit receipt PDF link to the order.
  if (payload && payload.action === 'save_receipt') {
    return saveReceipt(payload);
  }

  // --- הגנות בסיסיות על קליטת הזמנה (ספאם/זבל) ---
  // Honeypot: שדה נסתר שאדם אמיתי לא רואה ולא ממלא. בוט שמילא אותו מקבל
  // "הצלחה" מזויפת — בלי לכתוב כלום לגיליון ובלי לרמוז שנחסם.
  if (payload && payload.hp) return json({ ok: true });
  var c0 = (payload && payload.customer) || {};
  var its0 = (payload && payload.items) || [];
  if (!String(c0.name || '').trim() || String(c0.phone || '').replace(/\D/g, '').length < 9) {
    return json({ ok: false, error: 'bad_order' });
  }
  if (!its0.length || its0.length > 40) return json({ ok: false, error: 'bad_order' });
  for (var v0 = 0; v0 < its0.length; v0++) {
    var q0 = parseInt(its0[v0].qty, 10) || 0;
    if (q0 < 0 || q0 > 100) return json({ ok: false, error: 'bad_order' });
  }
  // קיצוץ טקסטים חופשיים כדי שאי אפשר להציף את הגיליון בתוכן ענק.
  ['name', 'phone', 'address', 'notes'].forEach(function (f) {
    if (c0[f]) c0[f] = String(c0[f]).slice(0, 300);
  });
  if (payload.date) payload.date = String(payload.date).slice(0, 20);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json({ ok: false, error: 'busy', message: 'המערכת עמוסה כרגע, נסו שוב בעוד רגע' });
  }
  try {
    var order = payload;
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var prod = ss.getSheetByName('Products');
    if (!prod) return json({ ok: false, error: 'no_products_sheet' });

    var data = prod.getDataRange().getValues();
    var headers = data[0];
    var ci = {};
    headers.forEach(function (h, i) { ci[String(h).trim()] = i; });
    for (var need = ['id', 'name', 'qty', 'flavors'], n = 0; n < need.length; n++) {
      if (ci[need[n]] === undefined) return json({ ok: false, error: 'bad_header', missing: need[n] });
    }

    var items = order.items || [];
    var problems = [];
    var changed = {}; // rowIndex -> true

    // Validate + mutate the in-memory snapshot. Nothing is written to the
    // sheet unless every line passes, so the whole order is all-or-nothing.
    items.forEach(function (it) {
      var qtyReq = parseInt(it.qty, 10) || 0;
      if (qtyReq <= 0) return;

      var row = -1;
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][ci.id]) === String(it.id)) { row = r; break; }
      }
      if (row < 0) { problems.push({ name: it.name || it.id, reason: 'not_found' }); return; }

      var flavorsStr = String(data[row][ci.flavors] || '');
      if (flavorsStr && it.flavor) {
        var flavs = parseFlavors(flavorsStr, data[row][ci.qty]);
        var f = null;
        for (var k = 0; k < flavs.length; k++) { if (flavs[k].name === it.flavor) { f = flavs[k]; break; } }
        if (!f) { problems.push({ name: (it.name || '') + ' ' + it.flavor, reason: 'flavor_not_found' }); return; }
        if (f.qty < qtyReq) { problems.push({ name: (it.name || '') + ' (' + it.flavor + ')', reason: 'out_of_stock', available: f.qty }); return; }
        f.qty -= qtyReq;
        data[row][ci.flavors] = flavs.map(function (x) { return x.name + ':' + x.qty; }).join('|');
        data[row][ci.qty] = flavs.reduce(function (s, x) { return s + x.qty; }, 0);
      } else {
        var avail = parseInt(data[row][ci.qty], 10) || 0;
        if (avail < qtyReq) { problems.push({ name: it.name || it.id, reason: 'out_of_stock', available: avail }); return; }
        data[row][ci.qty] = avail - qtyReq;
      }
      changed[row] = true;
    });

    if (problems.length) return json({ ok: false, error: 'stock', problems: problems });

    var now = new Date().toISOString();

    // Record the order FIRST, before touching stock. If recording throws, we
    // return an error and stock stays untouched — an order can never go missing.
    // (Worst case becomes: order recorded but stock not reduced — visible & fixable.)
    appendOrder(ss, order, now);

    // Then commit stock changes.
    Object.keys(changed).forEach(function (rs) {
      var r = parseInt(rs, 10);
      prod.getRange(r + 1, ci.qty + 1).setValue(data[r][ci.qty]);
      prod.getRange(r + 1, ci.flavors + 1).setValue(data[r][ci.flavors]);
      if (ci.updatedAt !== undefined) prod.getRange(r + 1, ci.updatedAt + 1).setValue(now);
    });

    // (וואטסאפ לקרן נשלח ע"י carmel-bot שסורק את הגיליון כל 2 דקות —
    //  ה-hook הישן הוסר כדי לא להתריע פעמיים ולא לעכב את התשובה ללקוח.)

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// GET serves read-only data. The spreadsheet itself is PRIVATE — this script
// (running as the owner) is the only public window into it, and it exposes:
//   ?action=products             → published products only (for the public site)
//   ?action=products&secret=...  → all products incl. unpublished (for the bot)
//   ?action=orders&secret=...    → recent orders (bot only; replaces public gviz)
//   ?action=set_secret&value=... → one-time bootstrap of the shared secret
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'products') return getProducts_(p);
  if (p.action === 'orders') return getOrders_(p);
  if (p.action === 'settings') return getSettings_();
  if (p.action === 'set_secret') return setSecret_(p);
  return json({ ok: true, service: 'carmel-order-intake' });
}

// Order-availability settings (open days/hours, lead time, closed message) that
// Keren edits in the dashboard. These are NOT sensitive — the public site needs
// them to know when ordering is open — so no secret is required. Returns a flat
// {key: value} map from the Settings sheet; an empty map if the tab is missing
// (the site then falls back to its "always open" defaults).
function getSettings_() {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Settings');
    if (!sh) return json({ ok: true, settings: {} });
    var data = sh.getDataRange().getDisplayValues();
    var out = {};
    for (var r = 1; r < data.length; r++) {
      var k = String(data[r][0] || '').trim();
      if (k) out[k] = data[r][1];
    }
    return json({ ok: true, settings: out });
  } catch (err) {
    return json({ ok: true, settings: {} });
  }
}

function botSecretOk_(s) {
  var sec = PropertiesService.getScriptProperties().getProperty('CARMEL_HOOK_SECRET');
  return !!(sec && s && s === sec);
}

// One-time bootstrap: stores the shared secret so it never has to be typed into
// the Apps Script UI by hand. Once set, the value can only be confirmed, never
// changed or read back through this endpoint.
function setSecret_(p) {
  var props = PropertiesService.getScriptProperties();
  var cur = props.getProperty('CARMEL_HOOK_SECRET');
  var v = String(p.value || '');
  if (!v || v.length < 10) return json({ ok: false, error: 'bad_value' });
  if (cur) return json({ ok: cur === v, already: true });
  props.setProperty('CARMEL_HOOK_SECRET', v);
  return json({ ok: true, set: true });
}

// getDisplayValues keeps cells exactly as shown in the sheet (dates stay
// "2026-06-15", not JS Date objects) — matching what gviz CSV used to return.
function sheetObjects_(sheet, fixHeaders) {
  var data = sheet.getDataRange().getDisplayValues();
  if (data.length < 1) return [];
  var hdr = data[0].map(function (h) { return String(h).trim(); });
  if (fixHeaders) {
    // Historical Orders sheets have blank headers on M/N — name them by position.
    if (!hdr[12]) hdr[12] = 'paid';
    if (!hdr[13]) hdr[13] = 'paymentMethod';
  }
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var o = {};
    for (var i = 0; i < hdr.length; i++) { if (hdr[i]) o[hdr[i]] = data[r][i]; }
    out.push(o);
  }
  return out;
}

function getProducts_(p) {
  var all = botSecretOk_(p.secret);
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Products');
  if (!sh) return json({ ok: false, error: 'no_products_sheet' });
  var rows = sheetObjects_(sh, false);
  if (!all) {
    rows = rows.filter(function (o) {
      var v = o.published;
      return v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true';
    });
  }
  return json({ ok: true, products: rows });
}

function getOrders_(p) {
  if (!botSecretOk_(p.secret)) return json({ ok: false, error: 'unauthorized' });
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Orders');
  if (!sh) return json({ ok: false, error: 'no_orders_sheet' });
  var rows = sheetObjects_(sh, true);
  rows.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  var limit = Math.max(1, Math.min(500, parseInt(p.limit, 10) || 200));
  return json({ ok: true, orders: rows.slice(0, limit) });
}

// Upload an image to a dedicated Drive folder and return a public CDN URL.
// Expects payload.data to be a "data:image/...;base64,..." string.
function handleImageUpload(payload) {
  try {
    // Only the dashboard (signed-in admin) may upload — otherwise anyone could
    // fill the owner's Drive with junk through this public endpoint.
    if (!uploaderOk_(payload.token) && !botSecretOk_(payload.secret)) {
      return json({ ok:false, error:'unauthorized' });
    }
    var match = String(payload.data || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return json({ ok:false, error:'bad_data_url' });
    var mime = match[1];
    var b64  = match[2];
    var binary = Utilities.base64Decode(b64);
    if (binary.length > MAX_IMAGE_BYTES) {
      return json({ ok:false, error:'too_large', max_mb: MAX_IMAGE_BYTES / (1024*1024) });
    }
    var ext = (mime.split('/')[1] || 'jpg').replace(/^jpeg$/, 'jpg');
    var fname = (payload.filename || ('carmel-' + Date.now())) + '.' + ext;
    var blob = Utilities.newBlob(binary, mime, fname);

    var folder = getOrCreateFolder(DRIVE_FOLDER_NAME);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Drive's thumbnail endpoint serves any size up to ~2000px and is browser-cacheable.
    var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200';
    return json({ ok:true, url: url, fileId: file.getId() });
  } catch (err) {
    return json({ ok:false, error:'exception', message: String(err) });
  }
}

function getOrCreateFolder(name) {
  var iter = DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(name);
}

// Validates a Google OAuth access token and checks the email is an allowed admin.
function uploaderOk_(token) {
  if (!token) return false;
  try {
    var r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (r.getResponseCode() !== 200) return false;
    var info = JSON.parse(r.getContentText());
    return ALLOWED_UPLOADERS.indexOf(String(info.email || '').toLowerCase()) !== -1;
  } catch (err) { return false; }
}

function appendOrder(ss, order, now) {
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return;
  var c = order.customer || {};
  var itemsText = (order.items || []).map(function (it) {
    return it.name + (it.flavor ? ' (' + it.flavor + ')' : '') + ' × ' + it.qty;
  }).join(', ');
  // Exact total + full item detail, captured now while we still have accurate prices.
  // The receipt bot reads these instead of guessing from the text (names there can be ambiguous).
  var total = 0;
  (order.items || []).forEach(function (it) {
    total += (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 0);
  });
  var itemsJSON = JSON.stringify(order.items || []);

  // Link this order to a customer card (create or update by phone). Enables the
  // customer history view in the dashboard.
  var customerId = upsertCustomer(ss, order, now);

  // Ensure column headers (one-time, auto). Includes paid/paymentMethod whose
  // headers were historically blank — naming them lets tools read by name.
  var lastCol = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  if (hdr.indexOf('paid') === -1) sheet.getRange(1, 13).setValue('paid');
  if (hdr.indexOf('paymentMethod') === -1) sheet.getRange(1, 14).setValue('paymentMethod');
  if (hdr.indexOf('total') === -1) sheet.getRange(1, 15).setValue('total');
  if (hdr.indexOf('itemsJSON') === -1) sheet.getRange(1, 16).setValue('itemsJSON');
  if (hdr.indexOf('receiptUrl') === -1) sheet.getRange(1, 17).setValue('receiptUrl');

  var id = 'o-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  // Columns: id,customerId,name,phone,address,fulfillment,date,items,notes,status,createdAt,updatedAt,paid,paymentMethod,total,itemsJSON,receiptUrl
  sheet.appendRow([
    id, customerId, c.name || '', c.phone || '', c.address || '',
    order.fulfillment || 'pickup', order.date || '', itemsText,
    (c.notes || '') + ' [הזמנת אתר]', 'new', now, now,
    '0', '', // paid=false, paymentMethod=blank — set later by Keren in dashboard
    total, itemsJSON, '' // receiptUrl — filled by the bot once the receipt is issued
  ]);
}

// Create or update a customer card by phone. Returns the customer id (or '').
function upsertCustomer(ss, order, now) {
  try {
    var sheet = ss.getSheetByName('Customers');
    if (!sheet) return '';
    var c = order.customer || {};
    var phone = String(c.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    var norm = phone.slice(-9); // compare by last 9 digits (handles leading 0 / 972)
    var data = sheet.getDataRange().getValues();
    var hdr = data[0].map(function (h) { return String(h).trim(); });
    var idCol = hdr.indexOf('id'); if (idCol === -1) idCol = 0;
    var phCol = hdr.indexOf('phone'); if (phCol === -1) phCol = 2;
    var loCol = hdr.indexOf('lastOrder'); if (loCol === -1) loCol = 7;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][phCol] || '').replace(/\D/g, '').slice(-9) === norm) {
        sheet.getRange(r + 1, loCol + 1).setValue(now); // touch lastOrder
        return String(data[r][idCol] || '');
      }
    }
    var cid = 'c-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    // Customers cols: id,name,phone,address,allergies,notes,createdAt,lastOrder
    sheet.appendRow([cid, c.name || '', c.phone || '', c.address || '', '', c.notes || '', now, now]);
    return cid;
  } catch (err) { return ''; }
}

// Attach a receipt PDF link to an order (called by the bot after issuing a receipt).
function saveReceipt(payload) {
  try {
    // Only the bot (which holds the shared secret) may attach receipts.
    if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Orders');
    if (!sheet) return json({ ok: false, error: 'no_orders_sheet' });
    var data = sheet.getDataRange().getValues();
    var hdr = data[0].map(function (h) { return String(h).trim(); });
    var idCol = hdr.indexOf('id'); if (idCol === -1) idCol = 0;
    var rCol = hdr.indexOf('receiptUrl');
    if (rCol === -1) { sheet.getRange(1, 17).setValue('receiptUrl'); rCol = 16; }
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][idCol]) === String(payload.orderId)) {
        sheet.getRange(r + 1, rCol + 1).setValue(payload.receiptUrl || '');
        return json({ ok: true });
      }
    }
    return json({ ok: false, error: 'order_not_found' });
  } catch (err) { return json({ ok: false, error: 'exception', message: String(err) }); }
}

// "name:qty|name:qty"  (legacy "name|name" → each flavor inherits productQty)
function parseFlavors(str, productQty) {
  if (!str) return [];
  return String(str).split('|').map(function (s) { return s.trim(); }).filter(String).map(function (p) {
    var i = p.lastIndexOf(':');
    if (i > 0 && /^\d+$/.test(p.slice(i + 1).trim())) {
      return { name: p.slice(0, i).trim(), qty: parseInt(p.slice(i + 1).trim(), 10) || 0 };
    }
    return { name: p, qty: parseInt(productQty, 10) || 0 };
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
