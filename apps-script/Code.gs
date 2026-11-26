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

// --- דמי משלוח ---
// אותו כלל כמו באתר (index.html: FEE=10, FREE=150): משלוח באופקים 10 ₪, חינם מ-150 ₪.
// האתר מציג ללקוח סכום כולל משלוח; כאן מוסיפים את השורה להזמנה עצמה, כך שהגיליון, הדשבורד,
// ההתראה, האישור ללקוח והקבלה — כולם מראים בדיוק מה שהלקוח ראה ושילם.
var DELIVERY_FEE = 10;
var DELIVERY_FREE_FROM = 150;
var DELIVERY_ITEM_NAME = 'משלוח באופקים';

// --- גרסת הקוד ---
// GET בלי action מחזיר אותה — כך בודקים מבחוץ איזו גרסה פרוסה בפועל.
var CODE_VERSION = '2026-11-26';

// מזהה האפליקציה של הדשבורד בגוגל. אישור כניסה מתקבל רק אם הונפק לאפליקציה הזו (לא לאפליקציה אחרת כלשהי).
var ADMIN_CLIENT_ID = '564598491904-8afmllpcgue97fd0hrht9ejkjut70m6f.apps.googleusercontent.com';

// אמצעי התשלום שהלקוח בוחר באתר (מפתח → תווית). נשמר בעמודת payChoice; קרן עדיין מסמנת "שולם" בעצמה.
var PAY_CHOICE_LABELS = { cash: 'מזומן', paybox: 'פייבוקס', bit: 'ביט' };

// טקסט חופשי של לקוח שמתחיל ב- = + - @ היה נכתב לגיליון כנוסחה. גרש מוביל הופך אותו לטקסט רגיל
// (הגיליון לא מציג את הגרש).
function safeText_(s) {
  s = String(s === null || s === undefined ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// האם שורת פריט היא שורת המשלוח. לפי המזהה או השם המדויק — לא לפי המילה "משלוח" בתוך שם של מוצר.
function isDeliveryItem_(it) {
  return String((it && it.id) || '') === 'delivery' || String((it && it.name) || '') === DELIVERY_ITEM_NAME;
}

// הגבלת קצב פשוטה לפעולות ציבוריות (הרשמה לעדכונים / לרשימת המתנה): עד max בקשות בכל 10 דקות, לכל האתר.
// תנועה אמיתית רחוקה מזה; סקריפט שמציף מספרי טלפון נעצר. תקלה במטמון לא חוסמת לקוח אמיתי.
function rateLimited_(key, max) {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'rl:' + key + ':' + Math.floor(Date.now() / 600000);
    var n = parseInt(cache.get(k), 10) || 0;
    if (n >= max) return true;
    cache.put(k, String(n + 1), 900);
    return false;
  } catch (err) { return false; }
}

// ההגדרות של קרן כמפה (מפתח → ערך). null כשאי אפשר לקרוא — ואז לא אוכפים כלום (לא חוסמים הזמנה אמיתית).
function readSettings_(ss) {
  try {
    var sh = ss.getSheetByName('Settings');
    if (!sh) return null;
    var data = sh.getDataRange().getDisplayValues();
    var s = {};
    for (var r = 1; r < data.length; r++) {
      var k = String(data[r][0] || '').trim();
      if (k) s[k] = data[r][1];
    }
    return s;
  } catch (err) { return null; }
}

// בודק את תאריך האיסוף/משלוח לפי שעון ישראל וההגדרות של קרן — אותם כללים כמו באתר (dateLeadOK + dateDayOpen):
// לא בעבר, מספר הימים מראש, ויום פתוח (תאריך מיוחד גובר על היום בשבוע). מחזיר הודעה ללקוח, או null כשתקין.
function orderDateProblem_(ss, dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return 'התאריך שנבחר לא תקין.';
  var utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (utc.getUTCFullYear() !== +m[1] || utc.getUTCMonth() !== +m[2] - 1 || utc.getUTCDate() !== +m[3]) return 'התאריך שנבחר לא תקין.';
  try {
    var t = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd').split('-');
    var diff = Math.round((utc.getTime() - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000);
    if (diff < 0) return 'התאריך שנבחר כבר עבר.';
    var s = readSettings_(ss);
    if (!s) return null;
    var lead = (s.leadDays !== undefined && String(s.leadDays).trim() !== '') ? Math.max(0, parseInt(s.leadDays, 10) || 0) : 2;
    if (diff < lead) return 'לתאריך הזה כבר אי אפשר להזמין — צריך להזמין ' + (lead === 1 ? 'יום' : (lead === 2 ? 'יומיים' : lead + ' ימים')) + ' מראש לפחות.';
    var closedMsg = 'ביום שנבחר לא מקבלים הזמנות.';
    var ov = null;
    try { ov = JSON.parse(s.overrides || '[]'); } catch (e1) { ov = null; }
    if (Array.isArray(ov)) {
      for (var i = 0; i < ov.length; i++) {
        if (ov[i] && ov[i].date === dateStr) return ov[i].open ? null : closedMsg;
      }
    }
    var h = null;
    try { h = JSON.parse(s.hours || 'null'); } catch (e2) { h = null; }
    if (Array.isArray(h) && h.length >= 7) {
      var day = h[utc.getUTCDay()];
      if (!(day && day.open)) return closedMsg;
    }
    return null;
  } catch (err) { return null; }
}

// --- תמונות מוצרים כקבצים (19.11.2026) ---
// התמונות שמורות בגיליון כ-base64 (כ-40KB למוצר), ולכן רשימת המוצרים שקלה כ-600KB.
// carmel-agent משכפל כל תמונה ל-Vercel Blob בשם שנגזר מהתוכן:
//   catalog/<id>-<10 תווים ראשונים של sha1 על תא התמונה>.<סיומת>
// עם ?light=1 הסקריפט מחזיר את הקישור לקובץ במקום התמונה עצמה (כ-10KB לכל הרשימה).
// אם הקובץ עדיין לא שם (תמונה שהועלתה הרגע), הדפדפן מבקש את התמונה עצמה ב-?action=image&id=...
// הגיליון עצמו לא משתנה — התמונות נשארות בו כמקור.
var IMAGE_BLOB_BASE = 'https://kqp7xrcdaulgm1ep.public.blob.vercel-storage.com/catalog/';

// טלפון נייד ישראלי תקין -> "05XXXXXXXX"; אחרת "". מקבל 050-1234567 / +972 50 123 4567 / 501234567 (בלי 0 מוביל).
// זהות הלקוח = הטלפון, לכן טעות הקלדה = "לקוח" נוסף; מכאן ההקשחה (החלטת טל 12.09).
function normalizeIlMobile_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) === '5') d = '0' + d;
  return /^05\d{8}$/.test(d) ? d : '';
}


// מחזיר עותק של הפריטים עם שורת משלוח כשרלוונטי (משלוח, סכום מוצרים בין 0 ל-150, ואין כבר שורה כזו).
function withDeliveryLine_(order) {
  var items = (order.items || []).slice();
  if (String(order.fulfillment || '') !== 'delivery') return items;
  var sum = 0;
  items.forEach(function (it) { sum += (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 0); });
  if (!(sum > 0) || sum >= DELIVERY_FREE_FROM) return items;
  for (var i = 0; i < items.length; i++) { if (isDeliveryItem_(items[i])) return items; }
  items.push({ id: 'delivery', name: DELIVERY_ITEM_NAME, flavor: '', qty: 1, price: DELIVERY_FEE });
  return items;
}

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
  // תחזוקה: בנייה מחדש של מאגר הלקוחות מההזמנות (טלפון = זהות). דורש את סוד הבוט. תומך dryRun.
  if (payload && payload.action === 'rebuild_customers') {
    return rebuildCustomers_(payload);
  }
  // תחזוקה: מיזוג לקוחות כפולים (זוגות from→into). דורש את סוד הבוט. תומך dryRun.
  if (payload && payload.action === 'merge_customers') {
    return mergeCustomers_(payload);
  }
  // רשימת המתנה למוצר שאזל (האתר כותב בלי סוד; הבוט מסמן עם סוד)
  if (payload && payload.action === 'waitlist_add') {
    return waitlistAdd_(payload);
  }
  if (payload && payload.action === 'waitlist_mark') {
    return waitlistMark_(payload);
  }
  if (payload && payload.action === 'waitlist_delete') {
    return waitlistDelete_(payload);
  }
  // רשימת "עדכונים בוואטסאפ": הצטרפות/הסרה. הבוט (עם הסוד) כשהלקוח כותב "כן"/"הסר" ל-054.
  if (payload && payload.action === 'updates_set') {
    return updatesSet_(payload);
  }
  // "עדכנו אותי" מהאתר בלי הזמנה — ציבורי (כמו waitlist_add): נייד תקין, בלי סוד, יצירה/סימון בלבד.
  if (payload && payload.action === 'updates_optin') {
    return updatesOptin_(payload);
  }
  // מחיקת הזמנה מהדשבורד: הזמנה שעוד לא נמסרה — הפריטים חוזרים למלאי (כולל לפי טעם). נמסרה — מחיקה בלבד.
  if (payload && payload.action === 'delete_order') {
    return deleteOrder_(payload);
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
  // רק נייד ישראלי תקין; נשמר מנורמל (05XXXXXXXX) כדי שטלפון = זהות לקוח אחת
  var ph0 = normalizeIlMobile_(c0.phone);
  if (!ph0) return json({ ok: false, error: 'bad_phone' });
  c0.phone = ph0;
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
  // שעת האיסוף/משלוח שהלקוח בחר: "HH:MM" או "בתיאום". כל דבר אחר נזרק (לא נכתב טקסט חופשי לגיליון).
  var tm0 = String(payload.time || '').trim();
  payload.time = (/^([01]\d|2[0-3]):[0-5]\d$/.test(tm0) || tm0 === 'בתיאום') ? tm0 : '';
  // אמצעי התשלום שהלקוח בחר — רק אחד מהמוכרים.
  payload.payChoice = PAY_CHOICE_LABELS[String(payload.payment || '')] || '';
  // שורה עם כמות 0 לא נרשמת בהזמנה; טעם נחתך לאורך סביר.
  its0 = its0.filter(function (it) { return it && (parseInt(it.qty, 10) || 0) > 0; });
  its0.forEach(function (it) { if (it.flavor) it.flavor = String(it.flavor).slice(0, 60); });
  if (!its0.length) return json({ ok: false, error: 'bad_order' });
  payload.items = its0;
  // תיבת "אשמח לקבל עדכונים" בטופס ההזמנה — אישור מפורש של הלקוח לרשימת העדכונים בוואטסאפ
  payload.updates = payload.updates === true || payload.updates === 1 || payload.updates === '1';

  // בדיקה יבשה: מחזיר את הפריטים והסכום כפי שהיו נרשמים (כולל שורת משלוח) — בלי לכתוב ובלי לגעת במלאי.
  if (payload.dryRun) {
    var dItems = withDeliveryLine_(payload), dTotal = 0;
    dItems.forEach(function (it) { dTotal += (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 0); });
    return json({ ok: true, dryRun: true, fulfillment: payload.fulfillment || 'pickup', items: dItems, total: dTotal });
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

    // הגרסה שהלקוח מצהיר עליה. v>=2 = האתר החדש, שיודע להציג "המחיר התעדכן" ו"סגור".
    // לקוחות ישנים (לשונית פתוחה מלפני העדכון, קטלוג הוואטסאפ) לא מקבלים קודי שגיאה חדשים.
    var clientV = parseInt(order.v, 10) || 1;

    // אותה בקשה פעמיים (הרשת נפלה אחרי שההזמנה כבר נרשמה והלקוח לחץ שוב) — לא נרשמת פעמיים.
    // הבדיקה בתוך הנעילה, כך ששתי בקשות זהות בו-זמנית לא עוברות שתיהן.
    var reqId = String(order.reqId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    var reqCache = null;
    if (reqId) {
      try {
        reqCache = CacheService.getScriptCache();
        var doneId = reqCache.get('req:' + reqId);
        if (doneId) return json({ ok: true, duplicate: true, id: doneId });
      } catch (errCache) { reqCache = null; }
    }

    // החנות סגורה (המתג הראשי בדשבורד) — לשונית שנשארה פתוחה מלפני הסגירה לא יכולה להזמין.
    // siteV>=2 = האתר מ-26.11.2026 ואילך: מכיר גם "תאריך לא תקין" ו"כמות מינימום". עליו "סגור" נאכף תמיד
    // (גם כשהוא שולח v=1 אחרי שתי דחיות מחיר). קטלוג הוואטסאפ ולשוניות ישנות לא מקבלים קודים חדשים.
    var siteV = parseInt(order.site, 10) || 0;
    if (clientV >= 2 || siteV >= 2) {
      var closedMsg = shopClosedMessage_(ss);
      if (closedMsg) return json({ ok: false, error: 'closed', message: closedMsg });
    }
    if (siteV >= 2) {
      var dateMsg = orderDateProblem_(ss, order.date);
      if (dateMsg) return json({ ok: false, error: 'bad_date', message: dateMsg });
    }
    var qtyByProduct = {}; // row -> סך היחידות שהוזמנו מהמוצר (כל הטעמים) — לבדיקת כמות מינימום

    // המחיר הקובע = מה שבגיליון ברגע ההזמנה, בדיוק כפי שהאתר מציג אותו (אותו חישוב כמו shapeProduct).
    var priceDisp = ci.price !== undefined ? prod.getRange(1, ci.price + 1, data.length, 1).getDisplayValues() : null;
    var saleDisp = ci.salePrice !== undefined ? prod.getRange(1, ci.salePrice + 1, data.length, 1).getDisplayValues() : null;
    var priceChanges = [];

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

      // מוצר שהוסר מהאתר (לא מפורסם) לא ניתן להזמנה, גם אם נשאר לו מלאי.
      if (ci.published !== undefined && !isPublished_(data[row][ci.published])) {
        problems.push({ name: it.name || it.id, reason: 'unavailable' }); return;
      }

      // מחיר: מה שבגיליון קובע, לא מה שהדפדפן שלח. מחיר 0/לא קריא בגיליון — לא אוכפים (לא חוסמים הזמנה).
      var sp = serverPrice_(priceDisp, saleDisp, row);
      if (sp > 0) {
        var cp = parseFloat(it.price);
        if (isNaN(cp) || Math.abs(cp - sp) >= 0.005) {
          priceChanges.push({ id: String(it.id), name: String((ci.name !== undefined && data[row][ci.name]) || it.name || it.id), flavor: String(it.flavor || ''), was: isNaN(cp) ? null : cp, now: sp });
        }
        it.price = sp;
      } else {
        // אין מחיר קריא בגיליון — מקבלים את המחיר מהדפדפן, אבל לעולם לא שלילי.
        it.price = Math.max(0, parseFloat(it.price) || 0);
      }
      // שם הפריט בהזמנה = השם שבגיליון (לא טקסט שהדפדפן שלח).
      if (ci.name !== undefined && String(data[row][ci.name] || '').trim()) it.name = String(data[row][ci.name]);
      qtyByProduct[row] = (qtyByProduct[row] || 0) + qtyReq;

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

    // כמות מינימום למוצר (עד עכשיו נבדקה רק בדפדפן). רק לאתר החדש, שיודע להציג את ההודעה.
    if (siteV >= 2 && ci.minOrder !== undefined) {
      Object.keys(qtyByProduct).forEach(function (rs) {
        var r = parseInt(rs, 10);
        var minQ = parseInt(data[r][ci.minOrder], 10) || 0;
        if (minQ > 0 && qtyByProduct[r] < minQ) {
          problems.push({ name: String((ci.name !== undefined && data[r][ci.name]) || ''), reason: 'min_order', min: minQ });
        }
      });
    }

    if (problems.length) return json({ ok: false, error: 'stock', problems: problems });

    if (priceChanges.length) {
      // האתר החדש: לא רושמים — מחזירים את המחירים המעודכנים, הלקוח רואה את הסכום החדש ומאשר.
      if (clientV >= 2) return json({ ok: false, error: 'price_changed', changes: priceChanges });
      // לקוח ישן: ההזמנה נרשמת במחיר שבגיליון (כבר עודכן בפריטים), עם הערה לקרן על הפער.
      order._priceNote = '[מחיר עודכן לפי המחירון: ' + priceChanges.map(function (c) {
        return c.name + ' ' + (c.was === null ? '?' : c.was) + '→' + c.now + ' ₪';
      }).join(', ') + ']';
    }

    var now = new Date().toISOString();

    // Record the order FIRST, before touching stock. If recording throws, we
    // return an error and stock stays untouched — an order can never go missing.
    // (Worst case becomes: order recorded but stock not reduced — visible & fixable.)
    var saved = appendOrder(ss, order, now) || {};

    // זוכרים את הבקשה מיד אחרי הרישום (ולא רק בסוף): אם עדכון המלאי נכשל והלקוח לוחץ שוב,
    // ההזמנה שכבר נרשמה לא נרשמת פעם שנייה.
    if (reqCache && reqId) { try { reqCache.put('req:' + reqId, String(saved.id || '1'), 21600); } catch (errPut0) {} }

    // Then commit stock changes.
    Object.keys(changed).forEach(function (rs) {
      var r = parseInt(rs, 10);
      prod.getRange(r + 1, ci.qty + 1).setValue(data[r][ci.qty]);
      prod.getRange(r + 1, ci.flavors + 1).setValue(data[r][ci.flavors]);
      if (ci.updatedAt !== undefined) prod.getRange(r + 1, ci.updatedAt + 1).setValue(now);
    });

    // (וואטסאפ לקרן נשלח ע"י carmel-bot שסורק את הגיליון כל 2 דקות —
    //  ה-hook הישן הוסר כדי לא להתריע פעמיים ולא לעכב את התשובה ללקוח.)

    // זוכרים את הבקשה 6 שעות — שליחה חוזרת של אותה הזמנה תקבל "כבר נרשמה".
    if (reqCache && reqId) { try { reqCache.put('req:' + reqId, String(saved.id || '1'), 21600); } catch (errPut) {} }

    return json({ ok: true, id: saved.id || '', total: saved.total });
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
  if (p.action === 'image') return getImage_(p);
  if (p.action === 'orders') return getOrders_(p);
  if (p.action === 'settings') return getSettings_();
  if (p.action === 'waitlist') return getWaitlist_(p);
  if (p.action === 'optins') return getOptins_(p);
  if (p.action === 'backup') return getBackup_(p);
  if (p.action === 'set_secret') return setSecret_(p);
  return json({ ok: true, service: 'carmel-order-intake', version: CODE_VERSION });
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
  // light=1: קישור לקובץ התמונה במקום התמונה עצמה. imgFile=1 מסמן לדפדפן שיש גיבוי ב-?action=image.
  if (String(p.light || '') === '1') {
    rows.forEach(function (o) {
      var url = imageFileUrl_(o.id, o.img);
      if (url) { o.img = url; o.imgFile = 1; }
    });
  }
  // version: האתר יודע לפיה אם הסקריפט כבר מזהה הזמנה כפולה (reqId).
  return json({ ok: true, products: rows, version: CODE_VERSION });
}

function isPublished_(v) {
  return v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true';
}

// המחיר שהאתר מציג ומחייב: מחיר מבצע אם קיים ונמוך מהמחיר הרגיל, אחרת המחיר הרגיל.
// חייב להישאר זהה ל-shapeProduct ב-index.html (Number() על הערך המוצג בתא).
function serverPrice_(priceDisp, saleDisp, row) {
  var list = priceDisp ? (Number(priceDisp[row][0]) || 0) : 0;
  var sale = saleDisp ? (Number(saleDisp[row][0]) || 0) : 0;
  return (sale > 0 && sale < list) ? sale : list;
}

// החנות סגורה? מחזיר את הודעת הסגירה, או null כשפתוח. אותו כלל כמו parseSettings באתר.
// תקלה בקריאת ההגדרות לא חוסמת הזמנה אמיתית (מחזיר null).
function shopClosedMessage_(ss) {
  try {
    var sh = ss.getSheetByName('Settings');
    if (!sh) return null;
    var data = sh.getDataRange().getDisplayValues();
    var s = {};
    for (var r = 1; r < data.length; r++) {
      var k = String(data[r][0] || '').trim();
      if (k) s[k] = data[r][1];
    }
    if (s.acceptingOrders === undefined) return null;
    var v = String(s.acceptingOrders).trim().toLowerCase();
    if (!(v === '0' || v === 'false' || v === 'no' || v === '')) return null;
    return String(s.closedMessage || '').trim() || 'כרגע איננו מקבלים הזמנות 💛 נשמח לקבל את הזמנתכם כשנפתח שוב.';
  } catch (err) { return null; }
}

function sha1Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, String(s), Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

// כתובת קובץ התמונה ב-Blob. אותו חישוב בדיוק כמו carmel-agent/lib/catalog.js (safeId + shortHash) —
// שינוי באחד מחייב שינוי בשני. מחזיר '' כשהתא אינו תמונת base64.
function imageFileUrl_(id, img) {
  var m = String(img || '').match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  if (!m) return '';
  var ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  var safe = String(id || 'x').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return IMAGE_BLOB_BASE + safe + '-' + sha1Hex_(img).slice(0, 10) + '.' + ext;
}

// תמונה אחת כפי שהיא בגיליון — גיבוי לדפדפן כשקובץ התמונה עוד לא קיים. מוצר לא מפורסם: רק עם הסוד.
function getImage_(p) {
  var id = String(p.id || '');
  if (!id) return json({ ok: false, error: 'no_id' });
  var all = botSecretOk_(p.secret);
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Products');
  if (!sh) return json({ ok: false, error: 'no_products_sheet' });
  var rows = sheetObjects_(sh, false);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) !== id) continue;
    if (!all && !isPublished_(rows[i].published)) break;
    return json({ ok: true, id: id, img: String(rows[i].img || '') });
  }
  return json({ ok: false, error: 'not_found' });
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
    // האישור חייב להיות של הדשבורד עצמו — אישור של אחת המנהלות שהונפק לאפליקציה אחרת לא מתקבל.
    if (String(info.aud || '') !== ADMIN_CLIENT_ID && String(info.azp || '') !== ADMIN_CLIENT_ID) return false;
    return ALLOWED_UPLOADERS.indexOf(String(info.email || '').toLowerCase()) !== -1;
  } catch (err) { return false; }
}

function appendOrder(ss, order, now) {
  var sheet = ss.getSheetByName('Orders');
  // בלי לשונית Orders אין לאן לרשום: עוצרים בשגיאה (לפני שנוגעים במלאי), במקום להחזיר "נקלטה" על הזמנה שלא נרשמה.
  if (!sheet) throw new Error('no_orders_sheet');
  var c = order.customer || {};
  var lineItems = withDeliveryLine_(order); // כולל שורת משלוח כשרלוונטי
  var itemsText = lineItems.map(function (it) {
    return it.name + (it.flavor ? ' (' + it.flavor + ')' : '') + ' × ' + it.qty;
  }).join(', ');
  // Exact total + full item detail, captured now while we still have accurate prices.
  // The receipt bot reads these instead of guessing from the text (names there can be ambiguous).
  var total = 0;
  lineItems.forEach(function (it) {
    total += (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 0);
  });
  var itemsJSON = JSON.stringify(lineItems);

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
  // שעת האיסוף/משלוח ואמצעי התשלום שהלקוח בחר באתר (26.11.2026) — עמודות R ו-S.
  if (hdr.indexOf('time') === -1) sheet.getRange(1, 18).setValue('time');
  if (hdr.indexOf('payChoice') === -1) sheet.getRange(1, 19).setValue('payChoice');

  var id = 'o-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  // Columns: id,customerId,name,phone,address,fulfillment,date,items,notes,status,createdAt,updatedAt,paid,paymentMethod,total,itemsJSON,receiptUrl,time,payChoice
  sheet.appendRow([
    id, customerId, safeText_(c.name || ''), c.phone || '', safeText_(c.address || ''),
    order.fulfillment || 'pickup', order.date || '', safeText_(itemsText),
    safeText_((c.notes || '') + ' [הזמנת אתר]' + (order._priceNote ? ' ' + order._priceNote : '')), 'new', now, now,
    '0', '', // paid=false, paymentMethod=blank — set later by Keren in dashboard
    total, itemsJSON, '', // receiptUrl — filled by the bot once the receipt is issued
    '', order.payChoice || ''
  ]);
  var newRow = sheet.getLastRow();
  // הטלפון כטקסט, כדי שה-0 המוביל לא ייעלם (הגיליון הופך "0526…" למספר)
  try { sheet.getRange(newRow, 4).setNumberFormat('@').setValue(String(c.phone || '')); } catch (e) {}
  // השעה כטקסט ("16:30" כמו שהוא), כדי שהגיליון לא יהפוך אותה לערך-שעה שמוצג אחרת
  try { if (order.time) sheet.getRange(newRow, 18).setNumberFormat('@').setValue(String(order.time)); } catch (e2) {}
  return { id: id, total: total };
}

// Create or update a customer card by phone. Returns the customer id (or '').
// order.updates=true (תיבת "אשמח לקבל עדכונים" באתר) → מסמן אישור בעמודות updatesAt/updatesSource,
// רק אם עוד לא מאושר. הזמנה לעולם לא מנקה אישור קיים (הסרה = רק "הסר" בוואטסאפ או קרן בדשבורד).
function upsertCustomer(ss, order, now) {
  try {
    var sheet = ss.getSheetByName('Customers');
    if (!sheet) return '';
    var c = order.customer || {};
    var phone = String(c.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    var norm = phone.slice(-9); // compare by last 9 digits (handles leading 0 / 972)
    var wantUpd = !!order.updates;
    var uc = wantUpd ? customerUpdateCols_(sheet) : null; // מוודא כותרות I/J רק כשצריך לכתוב
    var data = sheet.getDataRange().getValues();
    var hdr = data[0].map(function (h) { return String(h).trim(); });
    var idCol = hdr.indexOf('id'); if (idCol === -1) idCol = 0;
    var phCol = hdr.indexOf('phone'); if (phCol === -1) phCol = 2;
    var loCol = hdr.indexOf('lastOrder'); if (loCol === -1) loCol = 7;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][phCol] || '').replace(/\D/g, '').slice(-9) === norm) {
        sheet.getRange(r + 1, loCol + 1).setValue(now); // touch lastOrder
        if (uc && !String(data[r][uc.at] || '').trim()) {
          sheet.getRange(r + 1, uc.at + 1).setValue(now);
          sheet.getRange(r + 1, uc.src + 1).setValue('site');
        }
        return String(data[r][idCol] || '');
      }
    }
    var cid = 'c-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    // Customers cols: id,name,phone,address,allergies,notes,createdAt,lastOrder[,updatesAt,updatesSource]
    var row = [cid, safeText_(c.name || ''), c.phone || '', safeText_(c.address || ''), '', safeText_(c.notes || ''), now, now];
    if (uc) { while (row.length < Math.max(uc.at, uc.src) + 1) row.push(''); row[uc.at] = now; row[uc.src] = 'site'; }
    sheet.appendRow(row);
    try { sheet.getRange(sheet.getLastRow(), 3).setNumberFormat('@').setValue(String(c.phone || '')); } catch (e) {}
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


// --- מאגר לקוחות: טלפון = זהות ---
// בונה מחדש את לשונית Customers מתוך ההזמנות: לקוח אחד לכל מספר טלפון (9 ספרות אחרונות),
// שומר לקוחות קיימים אמיתיים (עם אלרגיות/הערות), זורק שורות זבל (בלי טלפון ובלי מזהה),
// ומיישר את customerId בכל הזמנה. לפני שכתוב — גיבוי הלשונית הנוכחית ללשונית Customers_bak_<תאריך>.
// חישוב טהור (ניתן לבדיקה): מחזיר {list, junk, kept, orderUpdates}
function computeCustomers_(orders, custRows) {
  function key(p) { var d = String(p || '').replace(/\D/g, ''); return d ? d.slice(-9) : ''; }
  var byKey = {}, junk = 0, kept = 0;
  (custRows || []).forEach(function (c) {
    var k = key(c.phone);
    var realId = /^c-\d+/.test(String(c.id || ''));
    if (!k && !realId) { junk++; return; }
    var kk = k || ('id:' + c.id);
    if (byKey[kk]) { junk++; return; } // כפילות של אותו טלפון — שומרים את הראשון
    byKey[kk] = { id: c.id || '', name: c.name || '', phone: c.phone || '', address: c.address || '', allergies: c.allergies || '', notes: c.notes || '', createdAt: c.createdAt || '', lastOrder: c.lastOrder || '', updatesAt: c.updatesAt || '', updatesSource: c.updatesSource || '' };
    kept++;
  });
  var sorted = (orders || []).slice().sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
  var usedIds = {}; Object.keys(byKey).forEach(function (k) { if (byKey[k].id) usedIds[byKey[k].id] = true; });
  var orderUpdates = [];
  sorted.forEach(function (o) {
    var k = key(o.phone); if (!k) return;
    var c = byKey[k];
    if (!c) {
      var oid = String(o.customerId || '');
      var id = (/^c-\d+/.test(oid) && !usedIds[oid]) ? oid : ('c-' + Date.now() + '-' + Math.floor(Math.random() * 100000));
      usedIds[id] = true;
      c = { id: id, name: o.name || '', phone: o.phone || '', address: o.address || '', allergies: '', notes: '', createdAt: o.createdAt || '', lastOrder: o.createdAt || '', updatesAt: '', updatesSource: '' };
      byKey[k] = c;
    } else {
      if (!c.id) { c.id = 'c-' + Date.now() + '-' + Math.floor(Math.random() * 100000); usedIds[c.id] = true; }
      if (!c.name && o.name) c.name = o.name;
      if (!c.address && o.address) c.address = o.address;
      if (!c.createdAt) c.createdAt = o.createdAt || '';
      if (String(o.createdAt || '') > String(c.lastOrder || '')) c.lastOrder = o.createdAt;
    }
    if (String(o.customerId || '') !== c.id) orderUpdates.push({ id: o.id, customerId: c.id });
  });
  var list = Object.keys(byKey).map(function (k) { return byKey[k]; })
    .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
  return { list: list, junk: junk, kept: kept, orderUpdates: orderUpdates };
}

function rebuildCustomers_(payload) {
  if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var os = ss.getSheetByName('Orders'), cs = ss.getSheetByName('Customers');
  if (!os || !cs) return json({ ok: false, error: 'no_sheet' });
  var res = computeCustomers_(sheetObjects_(os, true), sheetObjects_(cs, false));
  var summary = { customers: res.list.length, junkRows: res.junk, keptExisting: res.kept, orderUpdates: res.orderUpdates.length };
  if (payload.dryRun) { summary.dryRun = true; summary.sample = res.list.slice(0, 5); return json(Object.assign({ ok: true }, summary)); }
  var bakName = 'Customers_bak_' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMdd_HHmm');
  cs.copyTo(ss).setName(bakName);
  var hdr = ['id', 'name', 'phone', 'address', 'allergies', 'notes', 'createdAt', 'lastOrder', 'updatesAt', 'updatesSource'];
  var out = [hdr].concat(res.list.map(function (c) { return [c.id, c.name, c.phone, c.address, c.allergies || '', c.notes || '', c.createdAt || '', c.lastOrder || '', c.updatesAt || '', c.updatesSource || '']; }));
  cs.clearContents();
  cs.getRange(1, 1, out.length, hdr.length).setValues(out);
  var od = os.getDataRange().getValues();
  var oh = od[0].map(function (h) { return String(h).trim(); });
  var idC = oh.indexOf('id'); if (idC === -1) idC = 0;
  var cidC = oh.indexOf('customerId'); if (cidC === -1) cidC = 1;
  var updated = 0;
  res.orderUpdates.forEach(function (u) {
    for (var r = 1; r < od.length; r++) {
      if (String(od[r][idC]) === String(u.id)) { os.getRange(r + 1, cidC + 1).setValue(u.customerId); updated++; break; }
    }
  });
  summary.orderUpdates = updated; summary.backup = bakName;
  return json(Object.assign({ ok: true }, summary));
}


// --- מיזוג לקוחות כפולים (למשל טלפון עם טעות הקלדה יצר לקוח שני) ---
// payload: { action:'merge_customers', secret, dryRun?, pairs:[{from:<id של הכפול>, into:<id של הלקוח הנכון>}] }
// לכל זוג: ההזמנות של "from" (לפי customerId או לפי הטלפון שלו) עוברות ל-"into" ומקבלות את הטלפון הנכון,
// אלרגיות/הערות/כתובת שחסרות ב-into מושלמות מ-from, ושורת from נמחקת. לפני כתיבה — גיבוי הלשונית.
function planMerge_(pairs, customers, orders) {
  function key(p) { var d = String(p || '').replace(/\D/g, ''); return d ? d.slice(-9) : ''; }
  var byId = {}; customers.forEach(function (c) { if (c.id) byId[String(c.id)] = c; });
  var plan = [], errors = [];
  (pairs || []).forEach(function (pr) {
    var from = byId[String(pr.from || '')], into = byId[String(pr.into || '')];
    if (!from || !into) { errors.push('לא נמצא: ' + (from ? '' : pr.from) + ' ' + (into ? '' : pr.into)); return; }
    if (from.id === into.id) { errors.push('אותו לקוח: ' + from.id); return; }
    var fk = key(from.phone), ik = key(into.phone);
    var moved = orders.filter(function (o) { return String(o.customerId || '') === from.id || (fk && key(o.phone) === fk); })
      .map(function (o) { return { id: o.id, name: o.name, oldPhone: o.phone, oldCid: o.customerId }; });
    var fill = {};
    ['address', 'allergies', 'notes', 'updatesAt', 'updatesSource'].forEach(function (f) { if (!String(into[f] || '').trim() && String(from[f] || '').trim()) fill[f] = from[f]; });
    plan.push({ from: { id: from.id, name: from.name, phone: from.phone }, into: { id: into.id, name: into.name, phone: into.phone }, orders: moved, fill: fill });
  });
  return { plan: plan, errors: errors };
}

function mergeCustomers_(payload) {
  if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var os = ss.getSheetByName('Orders'), cs = ss.getSheetByName('Customers');
  if (!os || !cs) return json({ ok: false, error: 'no_sheet' });
  var res = planMerge_(payload.pairs || [], sheetObjects_(cs, false), sheetObjects_(os, true));
  if (payload.dryRun) return json({ ok: true, dryRun: true, plan: res.plan, errors: res.errors });
  if (res.errors.length || !res.plan.length) return json({ ok: false, error: 'bad_pairs', errors: res.errors });
  var bakName = 'Customers_bak_' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMdd_HHmm') + 'm';
  cs.copyTo(ss).setName(bakName);
  // הזמנות: customerId + טלפון
  var od = os.getDataRange().getValues();
  var oh = od[0].map(function (h) { return String(h).trim(); });
  var idC = oh.indexOf('id'); if (idC === -1) idC = 0;
  var cidC = oh.indexOf('customerId'); if (cidC === -1) cidC = 1;
  var phC = oh.indexOf('phone'); if (phC === -1) phC = 3;
  var movedTotal = 0;
  res.plan.forEach(function (p) {
    var ids = {}; p.orders.forEach(function (o) { ids[String(o.id)] = true; });
    for (var r = 1; r < od.length; r++) {
      if (ids[String(od[r][idC])]) {
        os.getRange(r + 1, cidC + 1).setValue(p.into.id);
        os.getRange(r + 1, phC + 1).setValue(p.into.phone);
        movedTotal++;
      }
    }
  });
  // לקוחות: השלמת שדות ב-into, מחיקת from (מהשורה האחרונה למעלה, כדי שהאינדקסים לא יזוזו)
  var cd = cs.getDataRange().getValues();
  var ch = cd[0].map(function (h) { return String(h).trim(); });
  var cIdC = ch.indexOf('id'); if (cIdC === -1) cIdC = 0;
  var rowsToDelete = [];
  res.plan.forEach(function (p) {
    for (var r = 1; r < cd.length; r++) {
      var rid = String(cd[r][cIdC]);
      if (rid === p.into.id) {
        Object.keys(p.fill).forEach(function (f) { var c = ch.indexOf(f); if (c !== -1) cs.getRange(r + 1, c + 1).setValue(p.fill[f]); });
      }
      if (rid === p.from.id) rowsToDelete.push(r + 1);
    }
  });
  rowsToDelete.sort(function (a, b) { return b - a; }).forEach(function (rowNum) { cs.deleteRow(rowNum); });
  return json({ ok: true, merged: res.plan.length, ordersMoved: movedTotal, customersDeleted: rowsToDelete.length, backup: bakName });
}

// --- "עדכונים בוואטסאפ" — רשימת המאושרים ---
// לשונית Customers, עמודות I/J: updatesAt (מתי אישר/ה, ISO; ריק = לא מאושר) | updatesSource (site | whatsapp | dashboard).
// אישור נרשם רק ביוזמת הלקוח (תיבת סימון בהזמנה באתר, "כן" בוואטסאפ ל-054) או ידנית ע"י קרן בדשבורד.
// "הסר" בוואטסאפ מנקה את שתי העמודות. השליחה עצמה: הבוט, רק בלחיצה של קרן בדשבורד (לא יותר מפעם בשבוע).

// מאתר (ויוצר אם חסר) את עמודות updatesAt/updatesSource לפי שם הכותרת. מחזיר אינדקסים 0-based.
function customerUpdateCols_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var at = hdr.indexOf('updatesAt'), src = hdr.indexOf('updatesSource');
  if (at === -1) {
    at = hdr[8] ? hdr.length : 8; // I פנויה → I; אחרת אחרי העמודה האחרונה (לא דורסים כותרת קיימת)
    sheet.getRange(1, at + 1).setValue('updatesAt');
    hdr[at] = 'updatesAt';
  }
  if (src === -1) {
    src = hdr[at + 1] ? hdr.length : at + 1;
    sheet.getRange(1, src + 1).setValue('updatesSource');
  }
  return { at: at, src: src };
}

// הליבה: מסמן/מנקה אישור לטלפון. on=true ולקוח לא קיים → כרטיס מינימלי (טלפון = זהות). מחזיר אובייקט תוצאה.
function setUpdates_(sheet, phone, on, source, name) {
  var uc = customerUpdateCols_(sheet);
  var data = sheet.getDataRange().getValues();
  var hdr = data[0].map(function (h) { return String(h).trim(); });
  var idCol = hdr.indexOf('id'); if (idCol === -1) idCol = 0;
  var nameCol = hdr.indexOf('name'); if (nameCol === -1) nameCol = 1;
  var phCol = hdr.indexOf('phone'); if (phCol === -1) phCol = 2;
  var norm = phone.slice(-9), now = new Date().toISOString();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][phCol] || '').replace(/\D/g, '').slice(-9) !== norm) continue;
    var was = !!String(data[r][uc.at] || '').trim();
    if (on && !was) { sheet.getRange(r + 1, uc.at + 1).setValue(now); sheet.getRange(r + 1, uc.src + 1).setValue(source); }
    if (!on && was) { sheet.getRange(r + 1, uc.at + 1).setValue(''); sheet.getRange(r + 1, uc.src + 1).setValue(''); }
    if (on && name && !String(data[r][nameCol] || '').trim()) sheet.getRange(r + 1, nameCol + 1).setValue(name);
    return { ok: true, found: true, was: was, now: on, changed: was !== on, id: String(data[r][idCol] || ''), name: String(data[r][nameCol] || '') };
  }
  if (!on) return { ok: true, found: false, was: false, now: false, changed: false };
  var cid = 'c-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  var row = [cid, name || '', phone, '', '', '', now, ''];
  while (row.length < Math.max(uc.at, uc.src) + 1) row.push('');
  row[uc.at] = now; row[uc.src] = source;
  sheet.appendRow(row);
  try { sheet.getRange(sheet.getLastRow(), phCol + 1).setNumberFormat('@').setValue(phone); } catch (e) {}
  return { ok: true, found: false, created: true, was: false, now: true, changed: true, id: cid, name: name || '' };
}

// הצטרפות/הסרה ע"י הבוט. payload: {action:'updates_set', secret, phone, value: 1|0, source?: 'whatsapp', name?}
function updatesSet_(payload) {
  if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var phone = normalizeIlMobile_(payload.phone);
  if (!phone) return json({ ok: false, error: 'bad_phone' });
  var on = payload.value === 1 || payload.value === '1' || payload.value === true;
  var source = String(payload.source || 'whatsapp').replace(/[^a-z]/g, '').slice(0, 20) || 'whatsapp';
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return json({ ok: false, error: 'busy' }); }
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Customers');
    if (!sheet) return json({ ok: false, error: 'no_sheet' });
    return json(setUpdates_(sheet, phone, on, source, String(payload.name || '').slice(0, 60)));
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  } finally { lock.releaseLock(); }
}

// "עדכנו אותי" מהאתר (בלי הזמנה, בלי סוד). payload: {action:'updates_optin', phone, name?, hp?}
// רק הצטרפות (לעולם לא הסרה בלי סוד). honeypot כמו בהזמנה. תקרה על גודל הלשונית.
function updatesOptin_(payload) {
  try {
    if (payload.hp) return json({ ok: true, added: true });
    var phone = normalizeIlMobile_(payload.phone);
    if (!phone) return json({ ok: false, error: 'bad_phone' });
    if (rateLimited_('optin', 40)) return json({ ok: false, error: 'busy' });
    var name = safeText_(String(payload.name || '').slice(0, 60));
    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) { return json({ ok: false, error: 'busy' }); }
    try {
      var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Customers');
      if (!sheet) return json({ ok: false, error: 'no_sheet' });
      if (sheet.getLastRow() > 5000) return json({ ok: false, error: 'full' });
      var r = setUpdates_(sheet, phone, true, 'site', name);
      return json({ ok: true, already: !!r.was, added: !r.was });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  }
}

// רשימת המאושרים (לבוט, לפני שליחת עדכון): ?action=optins&secret=...  — רק טלפונים ניידים תקינים.
function getOptins_(p) {
  if (!botSecretOk_(p.secret)) return json({ ok: false, error: 'unauthorized' });
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Customers');
  if (!sh) return json({ ok: true, optins: [], total: 0 });
  var out = [];
  sheetObjects_(sh, false).forEach(function (c) {
    var ph = normalizeIlMobile_(c.phone);
    if (!ph || !String(c.updatesAt || '').trim()) return;
    out.push({ id: c.id || '', name: c.name || '', phone: ph, updatesAt: c.updatesAt, updatesSource: c.updatesSource || '' });
  });
  return json({ ok: true, optins: out, total: out.length });
}


// --- "עדכני אותי כשחוזר" (רשימת המתנה למוצר שאזל) ---
// לשונית Waitlist: id | productId | productName | phone | name | createdAt | notifiedAt | status
// האתר כותב בלי סוד (כמו הזמנה): רק נייד ישראלי תקין, רק מוצר שקיים, בלי כפילות (אותו מוצר+טלפון שטרם עודכן).
// הבוט קורא עם הסוד ומסמן מי עודכן.
var WAITLIST_SHEET = 'Waitlist';
var WAITLIST_HEADERS = ['id', 'productId', 'productName', 'phone', 'name', 'createdAt', 'notifiedAt', 'status'];

function waitlistSheet_(ss) {
  var sh = ss.getSheetByName(WAITLIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(WAITLIST_SHEET);
    sh.getRange(1, 1, 1, WAITLIST_HEADERS.length).setValues([WAITLIST_HEADERS]);
    sh.getRange(1, 4).setNumberFormat('@'); // טלפון כטקסט (0 מוביל)
  }
  return sh;
}

// מוסיף ממתין. payload: {productId, productName?, phone, name?}
function waitlistAdd_(payload) {
  try {
    if (payload.hp) return json({ ok: true, added: true }); // שדה מלכודת, כמו בהזמנה
    var phone = normalizeIlMobile_(payload.phone);
    if (!phone) return json({ ok: false, error: 'bad_phone' });
    if (rateLimited_('waitlist', 40)) return json({ ok: false, error: 'busy' });
    var pid = String(payload.productId || '').trim().slice(0, 60);
    if (!pid) return json({ ok: false, error: 'bad_product' });

    var ss = SpreadsheetApp.openById(SHEET_ID);
    // המוצר חייב להיות קיים בגיליון (מונע זבל), ושמו נלקח משם
    var prod = ss.getSheetByName('Products');
    var pname = '';
    if (prod) {
      var pd = prod.getDataRange().getDisplayValues();
      var ph = pd[0].map(function (h) { return String(h).trim(); });
      var pi = ph.indexOf('id'), pn = ph.indexOf('name');
      for (var r = 1; r < pd.length; r++) {
        if (String(pd[r][pi]) === pid) { pname = String(pd[r][pn] || ''); break; }
      }
    }
    if (!pname) return json({ ok: false, error: 'product_not_found' });

    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) { return json({ ok: false, error: 'busy' }); }
    try {
      var sh = waitlistSheet_(ss);
      var data = sh.getDataRange().getDisplayValues();
      var hdr = data[0].map(function (h) { return String(h).trim(); });
      var ci = {}; hdr.forEach(function (h, i) { ci[h] = i; });
      // כבר רשום וטרם עודכן? מחזירים already (בלי שורה נוספת)
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][ci.productId]) === pid &&
            normalizeIlMobile_(data[i][ci.phone]) === phone &&
            !String(data[i][ci.notifiedAt] || '').trim()) {
          return json({ ok: true, already: true, product: pname });
        }
      }
      if (data.length > 3000) return json({ ok: false, error: 'full' });
      var now = new Date().toISOString();
      var id = 'w-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      sh.appendRow([id, pid, pname, phone, safeText_(String(payload.name || '').slice(0, 60)), now, '', 'waiting']);
      sh.getRange(sh.getLastRow(), 4).setNumberFormat('@').setValue(phone);
      return json({ ok: true, added: true, product: pname });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  }
}

// קריאה לבוט/דשבורד: ?action=waitlist&secret=...  (רק ממתינים שטרם עודכנו, אלא אם all=1)
function getWaitlist_(p) {
  if (!botSecretOk_(p.secret)) return json({ ok: false, error: 'unauthorized' });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(WAITLIST_SHEET);
  if (!sh) return json({ ok: true, waitlist: [] });
  var rows = sheetObjects_(sh, false);
  if (String(p.all || '') !== '1') rows = rows.filter(function (r) { return !String(r.notifiedAt || '').trim(); });
  return json({ ok: true, waitlist: rows });
}

// סימון שנשלח. payload: {action:'waitlist_mark', secret, ids:[...], status?}
function waitlistMark_(payload) {
  if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var ids = payload.ids || [];
  if (!ids.length) return json({ ok: true, marked: 0 });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(WAITLIST_SHEET);
  if (!sh) return json({ ok: false, error: 'no_sheet' });
  var data = sh.getDataRange().getDisplayValues();
  var hdr = data[0].map(function (h) { return String(h).trim(); });
  var idC = hdr.indexOf('id'), nC = hdr.indexOf('notifiedAt'), sC = hdr.indexOf('status');
  if (idC === -1 || nC === -1) return json({ ok: false, error: 'bad_header' });
  var want = {}; ids.forEach(function (x) { want[String(x)] = true; });
  var now = new Date().toISOString(), marked = 0;
  for (var r = 1; r < data.length; r++) {
    if (want[String(data[r][idC])] && !String(data[r][nC] || '').trim()) {
      sh.getRange(r + 1, nC + 1).setValue(now);
      if (sC !== -1) sh.getRange(r + 1, sC + 1).setValue(String(payload.status || 'notified'));
      marked++;
    }
  }
  return json({ ok: true, marked: marked });
}


// מחיקת שורות מרשימת ההמתנה (תחזוקה/ניקוי בדיקות). payload: {action:'waitlist_delete', secret, ids:[...]}
function waitlistDelete_(payload) {
  if (!botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var ids = payload.ids || [];
  if (!ids.length) return json({ ok: true, deleted: 0 });
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(WAITLIST_SHEET);
  if (!sh) return json({ ok: false, error: 'no_sheet' });
  var data = sh.getDataRange().getDisplayValues();
  var idC = data[0].map(function (h) { return String(h).trim(); }).indexOf('id');
  if (idC === -1) return json({ ok: false, error: 'bad_header' });
  var want = {}; ids.forEach(function (x) { want[String(x)] = true; });
  var rows = [];
  for (var r = 1; r < data.length; r++) if (want[String(data[r][idC])]) rows.push(r + 1);
  rows.sort(function (a, b) { return b - a; }).forEach(function (n) { sh.deleteRow(n); });
  return json({ ok: true, deleted: rows.length });
}


// גיבוי מלא: כל הלשוניות כ-JSON (לשרת/לארכיון). ?action=backup&secret=...
// כולל את מה שלא חשוף בנתיבים הרגילים (לקוחות, מתכונים, הוצאות) — כדי שגיבוי יומי יכסה הכל.
function getBackup_(p) {
  if (!botSecretOk_(p.secret)) return json({ ok: false, error: 'unauthorized' });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var out = {}, names = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (/^Customers_bak_/.test(name)) return; // לשוניות גיבוי ישנות — לא מכפילים
    names.push(name);
    try { out[name] = sh.getDataRange().getDisplayValues(); } catch (e) { out[name] = null; }
  });
  return json({ ok: true, takenAt: new Date().toISOString(), sheets: names, data: out });
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

// ── מחיקת הזמנה + החזרת מלאי ─────────────────────────────────────────────────
// payload: {action:'delete_order', id, token (מנהלת) | secret (הבוט)}
// הזמנה שלא נמסרה (status != delivered): הפריטים חוזרים למלאי — לפי טעם אם יש, אחרת לכמות המוצר;
// מוצר ללא הגבלת מלאי (qty ריק) — אין מה להחזיר. שורת המשלוח מדולגת. ואז השורה נמחקת.
function deleteOrder_(payload) {
  if (!uploaderOk_(payload.token) && !botSecretOk_(payload.secret)) return json({ ok: false, error: 'unauthorized' });
  var id = String(payload.id || '').trim();
  if (!id) return json({ ok: false, error: 'no_id' });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { return json({ ok: false, error: 'busy' }); }
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('Orders');
    if (!sh) return json({ ok: false, error: 'no_orders_sheet' });
    var data = sh.getDataRange().getDisplayValues();
    var hdr = data[0].map(function (h) { return String(h).trim(); });
    var col = function (name, fallback) { var i = hdr.indexOf(name); return i === -1 ? fallback : i; };
    var idC = col('id', 0), statusC = col('status', 9), itemsC = col('items', 7), itemsJsonC = col('itemsJSON', 15);
    var r = -1;
    for (var i = 1; i < data.length; i++) { if (String(data[i][idC]) === id) { r = i; break; } }
    if (r < 0) return json({ ok: false, error: 'not_found' });
    var status = String(data[r][statusC] || '');
    var restocked = [];
    if (status !== 'delivered' && payload.restock !== false) {
      restocked = restockItems_(ss, parseOrderItems_(data[r][itemsJsonC], data[r][itemsC]));
    }
    sh.deleteRow(r + 1);
    return json({ ok: true, deleted: id, status: status, restocked: restocked });
  } catch (err) {
    return json({ ok: false, error: 'exception', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// פריטי ההזמנה: מ-itemsJSON (מדויק), ובהזמנות ישנות — מהטקסט "שם (טעם) × כמות" לפי שם המוצר.
function parseOrderItems_(itemsJson, itemsText) {
  try {
    var arr = JSON.parse(String(itemsJson || ''));
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (e) {}
  var out = [];
  String(itemsText || '').split(',').forEach(function (part) {
    var m = String(part).trim().match(/^(.*?)(?:\s*\((.*?)\))?\s*×\s*(\d+)\s*$/);
    if (m) out.push({ id: '', name: m[1].trim(), flavor: (m[2] || '').trim(), qty: parseInt(m[3], 10) || 0 });
  });
  return out;
}

// מחזיר כמויות למוצרים. מחזיר רשימה של מה שהוחזר בפועל [{id, name, flavor, qty, productQty, flavors}].
function restockItems_(ss, items) {
  var prod = ss.getSheetByName('Products');
  if (!prod) return [];
  var data = prod.getDataRange().getValues();
  var headers = data[0];
  var ci = {};
  headers.forEach(function (h, i) { ci[String(h).trim()] = i; });
  if (ci.id === undefined || ci.qty === undefined) return [];
  var now = new Date().toISOString();
  var changed = {}, out = [];
  (items || []).forEach(function (it) {
    if (!it) return;
    var qty = parseInt(it.qty, 10) || 0;
    if (qty <= 0) return;
    if (isDeliveryItem_(it)) return;
    var row = -1;
    for (var r = 1; r < data.length; r++) {
      if (it.id && String(data[r][ci.id]) === String(it.id)) { row = r; break; }
    }
    if (row < 0 && it.name && ci.name !== undefined) {
      for (var r2 = 1; r2 < data.length; r2++) { if (String(data[r2][ci.name]).trim() === String(it.name).trim()) { row = r2; break; } }
    }
    if (row < 0) return;
    var flavorsStr = ci.flavors !== undefined ? String(data[row][ci.flavors] || '') : '';
    if (flavorsStr && it.flavor) {
      var flavs = parseFlavors(flavorsStr, data[row][ci.qty]);
      var f = null;
      for (var k = 0; k < flavs.length; k++) { if (flavs[k].name === it.flavor) { f = flavs[k]; break; } }
      if (!f) return;
      f.qty += qty;
      data[row][ci.flavors] = flavs.map(function (x) { return x.name + ':' + x.qty; }).join('|');
      data[row][ci.qty] = flavs.reduce(function (s, x) { return s + x.qty; }, 0);
      changed[row] = true;
      out.push({ id: String(data[row][ci.id]), name: String(data[row][ci.name] || it.name || ''), flavor: it.flavor, qty: qty, productQty: data[row][ci.qty], flavors: data[row][ci.flavors] });
    } else {
      var raw = data[row][ci.qty];
      if (raw === '' || raw === null || raw === undefined || isNaN(parseInt(raw, 10))) return; // ללא הגבלת מלאי — אין מה להחזיר
      data[row][ci.qty] = (parseInt(raw, 10) || 0) + qty;
      changed[row] = true;
      out.push({ id: String(data[row][ci.id]), name: String(data[row][ci.name] || it.name || ''), flavor: '', qty: qty, productQty: data[row][ci.qty] });
    }
  });
  Object.keys(changed).forEach(function (rs) {
    var r = parseInt(rs, 10);
    prod.getRange(r + 1, ci.qty + 1).setValue(data[r][ci.qty]);
    if (ci.flavors !== undefined) prod.getRange(r + 1, ci.flavors + 1).setValue(data[r][ci.flavors]);
    if (ci.updatedAt !== undefined) prod.getRange(r + 1, ci.updatedAt + 1).setValue(now);
  });
  return out;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
