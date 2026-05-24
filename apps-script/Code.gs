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

function doPost(e) {
  var payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok:false, error:'bad_json' }); }

  // Route by action; default action (no action field) is "order".
  if (payload && payload.action === 'image_upload') {
    return handleImageUpload(payload);
  }

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

    // Commit stock changes.
    var now = new Date().toISOString();
    Object.keys(changed).forEach(function (rs) {
      var r = parseInt(rs, 10);
      prod.getRange(r + 1, ci.qty + 1).setValue(data[r][ci.qty]);
      prod.getRange(r + 1, ci.flavors + 1).setValue(data[r][ci.flavors]);
      if (ci.updatedAt !== undefined) prod.getRange(r + 1, ci.updatedAt + 1).setValue(now);
    });

    // Record the order so it shows up in Keren's dashboard.
    appendOrder(ss, order, now);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// GET is only used to confirm the deployment is reachable.
function doGet() {
  return json({ ok: true, service: 'carmel-order-intake' });
}

// Upload an image to a dedicated Drive folder and return a public CDN URL.
// Expects payload.data to be a "data:image/...;base64,..." string.
function handleImageUpload(payload) {
  try {
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

function appendOrder(ss, order, now) {
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) return;
  var c = order.customer || {};
  var itemsText = (order.items || []).map(function (it) {
    return it.name + (it.flavor ? ' (' + it.flavor + ')' : '') + ' × ' + it.qty;
  }).join(', ');
  var id = 'o-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  // Columns: id,customerId,name,phone,address,fulfillment,date,items,notes,status,createdAt,updatedAt,paid,paymentMethod
  sheet.appendRow([
    id, '', c.name || '', c.phone || '', c.address || '',
    order.fulfillment || 'pickup', order.date || '', itemsText,
    (c.notes || '') + ' [הזמנת אתר]', 'new', now, now,
    '0', '' // paid=false, paymentMethod=blank — set later by Keren in dashboard
  ]);
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
