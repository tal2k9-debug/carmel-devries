/* Carmel De-vries Admin - Google Sheets + Sign-in version */
const CLIENT_ID = '564598491904-8afmllpcgue97fd0hrht9ejkjut70m6f.apps.googleusercontent.com';
const SHEET_ID = '1NOdPG_jdhVfD_Du24E6i3fWTOjPSqfoarJ1tkq6OIRk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const ALLOWLIST = ['tal2k9@gmail.com', 'kerencarmel8@gmail.com'];
const CACHE_KEY = 'carmel_cache_v2';
const PRICING_KEY = 'carmel_pricing_v1';
// כתובת המוח החכם (פרויקט Vercel נפרד). מתעדכן אחרי פריסה.
const AGENT_URL = 'https://carmel-agent.vercel.app';
const STATUSES = [
  {id:'new', label:'חדש', color:'new'},
  {id:'confirmed', label:'מאושר', color:'confirmed'},
  {id:'baking', label:'באפייה', color:'baking'},
  {id:'ready', label:'מוכן', color:'ready'},
  {id:'delivered', label:'נמסר', color:'delivered'}
];
// Default products — used to seed the Products sheet on first load if it's empty.
// After seeding, the sheet is the source of truth.
const PRODUCTS_SEED = [
  {id:'maroc',  name:'עוגיות מכונה מרוקאיות', desc:'עוגיות נוסטלגיות פריכות ומוארכות בשילוב קוקוס ושומשום.', price:55, unit:'מארז של כ-30 יח׳', qty:10, kosher:'פרווה', img:'images/maroc.jpg',     published:1, sortOrder:10,  minOrder:0,  minNote:'', flavors:''},
  {id:'choco',  name:'כדורי שוקולד',           desc:'כדורים עשירים בכל טוב, מצופים לבחירה.',                  price:4,  unit:'ליחידה',           qty:80, kosher:'פרווה', img:'images/chocoballs.jpg',published:1, sortOrder:20,  minOrder:0,  minNote:'', flavors:'קוקוס|סוכריות'},
  {id:'rolled', name:'מגולגלות במילויים',      desc:'בצק עדין וניחוח במילוי עשיר וטעים, 3 טעמים לבחירה.',     price:75, unit:'מארז של כ-12 יח׳', qty:6,  kosher:'פרווה', img:'images/rolled.jpg',    published:1, sortOrder:30,  minOrder:0,  minNote:'', flavors:'פיסטוק|קינדר|נוטלה'},
  {id:'tahini', name:'עוגיות טחינה קלאסיות',   desc:'מרקם נימוח שנמס בפה.',                                   price:55, unit:'מארז של כ-30 יח׳', qty:10, kosher:'פרווה', img:'images/tahini.jpg',    published:1, sortOrder:40,  minOrder:0,  minNote:'', flavors:''},
  {id:'almond', name:'עוגיות חמאה שקדים',      desc:'עוגיות פריכות על בסיס שקדים וחמאה.',                     price:35, unit:'מארז של כ-11 יח׳', qty:8,  kosher:'חלבי',  img:'images/almond.jpg',    published:1, sortOrder:50,  minOrder:0,  minNote:'', flavors:''},
  {id:'yoyo',   name:'עוגיות יויו',             desc:'עוגיות טבולות בסירופ מתוק עטופות בקוקוס.',               price:4,  unit:'ליחידה',           qty:60, kosher:'פרווה', img:'images/yoyo.jpg',      published:1, sortOrder:60,  minOrder:30, minNote:'* מינימום להזמנה כ-30 יח׳', flavors:''}
];

let tokenClient, accessToken=null, user=null, _tokenRefreshResolve=null;
let db = {customers:[], orders:[], expenses:[], recipes:[], products:[], settings:{}};
let calCursor = new Date();
let editingCustId=null, editingExpId=null, editingProdId=null;
let pendingWrites = []; // queue for offline

/* ============ GOOGLE SIGN-IN (Single-button OAuth flow) ============ */
window.addEventListener('load', initApp);

async function initApp() {
  let tries = 0;
  while (!window.google && tries < 50) { await sleep(100); tries++; }
  if (!window.google) { showLoginError('שגיאה בטעינת Google'); return; }
  console.log('[Carmel] google loaded');

  // Initialize OAuth2 token client (gives us access_token directly)
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: handleToken,
    error_callback: (err) => { console.error('[Carmel] oauth error', err); if (_tokenRefreshResolve) { const r=_tokenRefreshResolve; _tokenRefreshResolve=null; r(false); return; } showLoginError('שגיאת הרשאות: ' + (err.type || err.message || JSON.stringify(err))); }
  });

  // Render a simple "Sign in with Google" button that triggers OAuth popup directly
  const btnEl = document.getElementById('g-signin-btn');
  btnEl.innerHTML = '<button id="myGoogleBtn" style="background:#4285F4;color:#fff;padding:14px 28px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:10px;box-shadow:0 4px 12px rgba(66,133,244,.3)"><svg width="20" height="20" viewBox="0 0 18 18"><path fill="#fff" d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.55-2.49C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z" opacity=".9"/><path fill="#fff" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z" opacity=".7"/><path fill="#fff" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z" opacity=".5"/><path fill="#fff" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z" opacity=".8"/></svg>כניסה באמצעות Google</button>';
  document.getElementById('myGoogleBtn').onclick = () => {
    console.log('[Carmel] sign-in clicked');
    try {
      tokenClient.requestAccessToken({prompt:'consent'});
    } catch(e) {
      console.error('[Carmel] requestAccessToken threw', e);
      showLoginError('שגיאה: ' + e.message);
    }
  };

  loadCache();

  // Restore session if token still valid
  const saved = localStorage.getItem('carmel_user');
  if (saved) {
    try {
      const su = JSON.parse(saved);
      if (su.expiry && su.expiry > Date.now()) {
        user = su;
        accessToken = su.token;
        showApp();
        return;
      }
    } catch(e){}
  }
}

async function handleToken(resp) {
  console.log('[Carmel] token resp', resp);
  if (resp.error) {
    if (_tokenRefreshResolve) { const r=_tokenRefreshResolve; _tokenRefreshResolve=null; r(false); return; }
    showLoginError('שגיאה: ' + resp.error + ' - ' + (resp.error_description||''));
    return;
  }
  accessToken = resp.access_token;
  // Fetch user info using the token
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers:{Authorization:'Bearer '+accessToken}}).then(r=>r.json());
    console.log('[Carmel] userinfo', ui);
    if (!ALLOWLIST.includes((ui.email||'').toLowerCase())) {
      showLoginError(`האימייל ${ui.email} לא מורשה. רק טל וקרן יכולים להיכנס.`);
      accessToken = null;
      return;
    }
    user = {email: ui.email, name: ui.name, picture: ui.picture, token: accessToken, expiry: Date.now() + (resp.expires_in*1000) - 60000};
    localStorage.setItem('carmel_user', JSON.stringify(user));
    if (typeof gapi !== 'undefined' && gapi.client) { try { gapi.client.setToken({access_token: accessToken}); } catch(e){} }
    // Silent refresh path: token renewed mid-session — resolve and skip re-rendering the app.
    if (_tokenRefreshResolve) { const r=_tokenRefreshResolve; _tokenRefreshResolve=null; r(true); return; }
    showApp();
  } catch(e) {
    console.error('[Carmel] userinfo failed', e);
    if (_tokenRefreshResolve) { const r=_tokenRefreshResolve; _tokenRefreshResolve=null; r(false); return; }
    showLoginError('שגיאה בטעינת פרופיל: ' + e.message);
  }
}

// Ensure a valid access token before a write. If expired, silently refresh
// (no popup while the Google session is alive). Resolves false if it can't —
// callers then alert the user to re-login, so a click is never lost silently.
function ensureToken() {
  return new Promise((resolve) => {
    if (accessToken && user && user.expiry && user.expiry > Date.now() + 10000) { resolve(true); return; }
    _tokenRefreshResolve = resolve;
    try { tokenClient.requestAccessToken({ prompt: '' }); }
    catch (e) { _tokenRefreshResolve = null; resolve(false); return; }
    setTimeout(() => { if (_tokenRefreshResolve) { _tokenRefreshResolve = null; resolve(false); } }, 8000);
  });
}

function signOut() {
  localStorage.removeItem('carmel_user');
  if (google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  if (accessToken) google.accounts.oauth2.revoke(accessToken, ()=>{});
  user = null; accessToken = null;
  location.reload();
}

async function showApp() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email;
  bindUI();
  setSync('syncing', 'מסנכרן...');
  try {
    await loadGapi();
    await ensureTabs();
    await syncAll();
    setSync('ok', 'מסונכרן');
  } catch (e) {
    console.error('Sync error', e);
    setSync('err', 'אופליין - נטען מהמטמון');
    renderAll();
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.style.display = 'block';
}

function parseJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }
  catch(e){ return null; }
}

/* ============ GAPI CLIENT ============ */
async function loadGapi() {
  return new Promise((res,rej)=>{
    gapi.load('client', async ()=>{
      try {
        await gapi.client.init({discoveryDocs:['https://sheets.googleapis.com/$discovery/rest?version=v4']});
        gapi.client.setToken({access_token: accessToken});
        res();
      } catch(e){ rej(e); }
    });
  });
}

async function ensureTabs() {
  try {
    const meta = await gapi.client.sheets.spreadsheets.get({spreadsheetId: SHEET_ID});
    const existing = meta.result.sheets.map(s=>s.properties.title);
    const toAdd = [];
    if (!existing.includes('Expenses')) toAdd.push({addSheet:{properties:{title:'Expenses'}}});
    if (!existing.includes('Recipes'))  toAdd.push({addSheet:{properties:{title:'Recipes'}}});
    if (!existing.includes('Products')) toAdd.push({addSheet:{properties:{title:'Products'}}});
    if (!existing.includes('Settings')) toAdd.push({addSheet:{properties:{title:'Settings'}}});
    if (toAdd.length){
      await gapi.client.sheets.spreadsheets.batchUpdate({spreadsheetId:SHEET_ID, resource:{requests:toAdd}});
    }
    if (!existing.includes('Expenses')) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: 'Expenses!A1:F1', valueInputOption: 'RAW',
        resource: {values:[['id','date','category','description','amount','vendor']]}
      });
    }
    if (!existing.includes('Recipes')) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: 'Recipes!A1:H1', valueInputOption: 'RAW',
        resource: {values:[['id','name','yield','hours','rate','over','mult','ingredients_json']]}
      });
    }
    if (!existing.includes('Products')) {
      // Header + seed initial 6 products so the site keeps working immediately
      const header = ['id','name','desc','price','unit','qty','kosher','img','published','sortOrder','minOrder','minNote','flavors','updatedAt'];
      const rows = [header, ...PRODUCTS_SEED.map(p => prodToRow(Object.assign({updatedAt:new Date().toISOString()}, p)))];
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: 'Products!A1:N' + rows.length, valueInputOption: 'RAW',
        resource: {values: rows}
      });
    }
    if (!existing.includes('Settings')) {
      // Seed "always open, 2 days lead" so the public site behaves exactly as before.
      await writeSettings(DEFAULT_SETTINGS);
    }
  } catch(e){ console.warn('ensureTabs', e); }
}

async function readRange(range) {
  const r = await gapi.client.sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID, range});
  return r.result.values || [];
}

async function appendRow(sheetName, row) {
  return gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {values:[row]}
  });
}

async function updateRow(sheetName, rowNum, row) {
  const endCol = String.fromCharCode(64 + row.length);
  return gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowNum}:${endCol}${rowNum}`,
    valueInputOption: 'RAW',
    resource: {values:[row]}
  });
}

/* ============ SYNC ============ */
async function syncAll() {
  setSync('syncing', 'מסנכרן...');
  try {
    const [cust, ord, exp, rec, prod, setg] = await Promise.all([
      readRange('Customers!A2:H'),
      readRange('Orders!A2:N'),
      readRange('Expenses!A2:F').catch(()=>[]),
      readRange('Recipes!A2:H').catch(()=>[]),
      readRange('Products!A2:N').catch(()=>[]),
      readRange('Settings!A2:B').catch(()=>[])
    ]);
    db.customers = cust.map(r => rowToCust(r));
    db.orders = ord.map(r => rowToOrder(r));
    db.expenses = exp.map(r => rowToExp(r));
    db.recipes = rec.map(r => rowToRecipe(r));
    db.products = prod.map(r => rowToProd(r));
    db.settings = settingsRowsToObj(setg);
    // Make sure the public-facing "__settings__" row exists so the live site reads
    // the open hours/days with NO Apps Script deploy. Only writes when missing —
    // afterwards saveOrderSettings keeps it in sync. This auto-publishes whatever
    // Keren already saved, just by opening the dashboard (no extra click).
    try {
      if (!(db.products||[]).some(p=>p.id==='__settings__') && db.settings && Object.keys(db.settings).length) {
        await writeSettingsProductRow({
          acceptingOrders: String(db.settings.acceptingOrders!=null?db.settings.acceptingOrders:'1'),
          leadDays:        String(db.settings.leadDays!=null?db.settings.leadDays:'2'),
          closedMessage:   String(db.settings.closedMessage||DEFAULT_SETTINGS.closedMessage),
          hours:           String(db.settings.hours||DEFAULT_SETTINGS.hours),
          overrides:       String(db.settings.overrides||'[]')
        });
      }
    } catch(e){ console.warn('settings row migrate', e); }
    refreshRecipesList();
    saveCache();
    renderAll();
    setSync('ok', 'מסונכרן');
  } catch(e) {
    console.error('syncAll', e);
    setSync('err', 'שגיאת סנכרון');
    throw e;
  }
}

function setSync(kind, txt) {
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + kind;
  el.textContent = txt;
}

function loadCache() {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (c) db = JSON.parse(c);
    if (!db.customers) db.customers = [];
    if (!db.orders) db.orders = [];
    if (!db.expenses) db.expenses = [];
    if (!db.recipes) db.recipes = [];
    if (!db.products) db.products = [];
    if (!db.settings) db.settings = {};
  } catch(e){}
}
function saveCache(){ localStorage.setItem(CACHE_KEY, JSON.stringify(db)); }

function rowToCust(r){ return {id:r[0]||'', name:r[1]||'', phone:r[2]||'', address:r[3]||'', allergies:r[4]||'', notes:r[5]||'', createdAt:r[6]||'', lastOrder:r[7]||''}; }
function custToRow(c){ return [c.id, c.name, c.phone, c.address, c.allergies, c.notes, c.createdAt, c.lastOrder]; }
function rowToOrder(r){ return {id:r[0]||'', customerId:r[1]||'', name:r[2]||'', phone:r[3]||'', address:r[4]||'', fulfillment:r[5]||'pickup', date:r[6]||'', items:r[7]||'', notes:r[8]||'', status:r[9]||'new', createdAt:r[10]||'', updatedAt:r[11]||'', paid:(r[12]==='1'||r[12]===1||r[12]===true||String(r[12]).toLowerCase()==='true'), paymentMethod:r[13]||'', total:r[14]||'', receiptUrl:r[16]||''}; }
function orderToRow(o){ return [o.id, o.customerId, o.name, o.phone, o.address, o.fulfillment, o.date, o.items, o.notes, o.status, o.createdAt, o.updatedAt, o.paid?'1':'0', o.paymentMethod||'']; }
// Israeli phone -> wa.me format (972XXXXXXXXX): handles leading 0 and 9-digit (no-0) forms.
function waPhone(p){ let d=String(p||'').replace(/\D/g,''); if(d.startsWith('972'))return d; if(d.startsWith('0'))return '972'+d.slice(1); if(d.length===9)return '972'+d; return d; }
const PAYMENT_METHODS = ['מזומן','ביט','העברה בנקאית','אשראי','צ׳ק','אחר'];
function rowToExp(r){ return {id:r[0]||'', date:r[1]||'', category:r[2]||'', description:r[3]||'', amount:parseFloat(r[4])||0, vendor:r[5]||''}; }
function expToRow(e){ return [e.id, e.date, e.category, e.description, String(e.amount), e.vendor]; }
function rowToRecipe(r){ let ing=[]; try{ ing=JSON.parse(r[7]||'[]'); }catch(e){} return {id:r[0]||'', name:r[1]||'', yield:r[2]||'30', hours:r[3]||'2', rate:r[4]||'50', over:r[5]||'15', mult:r[6]||'2.5', ingredients:ing}; }
function recipeToRow(r){ return [r.id, r.name, String(r.yield), String(r.hours), String(r.rate), String(r.over), String(r.mult), JSON.stringify(r.ingredients||[])]; }
function rowToProd(r){
  return {
    id:        r[0]||'',
    name:      r[1]||'',
    desc:      r[2]||'',
    price:     parseFloat(r[3])||0,
    unit:      r[4]||'',
    qty:       parseInt(r[5])||0,
    kosher:    r[6]||'',
    img:       r[7]||'',
    published: (r[8]==='1'||r[8]===1||r[8]===true||String(r[8]).toLowerCase()==='true') ? 1 : 0,
    sortOrder: parseInt(r[9])||100,
    minOrder:  parseInt(r[10])||0,
    minNote:   r[11]||'',
    flavors:   r[12]||'',
    updatedAt: r[13]||''
  };
}
function prodToRow(p){
  return [
    p.id||'', p.name||'', p.desc||'',
    String(p.price||0), p.unit||'',
    String(p.qty||0), p.kosher||'',
    p.img||'', String(p.published?1:0),
    String(p.sortOrder||100),
    String(p.minOrder||0), p.minNote||'',
    p.flavors||'', p.updatedAt||''
  ];
}
// === FLAVORS HELPERS ===
// Format on disk: "name:qty|name:qty|..."
// Legacy format (no colon): "name|name|..." — when parsed, each flavor inherits productQty as fallback
//   so existing data keeps working until the admin opens & re-saves the product.
function parseFlavors(str, productQty) {
  if (!str) return [];
  return String(str).split('|').map(s => s.trim()).filter(Boolean).map(piece => {
    const colonIdx = piece.lastIndexOf(':');
    if (colonIdx > 0 && /^\d+$/.test(piece.slice(colonIdx+1).trim())) {
      return {name: piece.slice(0, colonIdx).trim(), qty: parseInt(piece.slice(colonIdx+1).trim())||0};
    }
    return {name: piece, qty: parseInt(productQty)||0};
  });
}
function serializeFlavors(arr) {
  if (!arr || !arr.length) return '';
  return arr.filter(f => f.name).map(f => `${f.name}:${Math.max(0, parseInt(f.qty)||0)}`).join('|');
}
function flavorsTotalQty(arr) {
  return (arr || []).reduce((s, f) => s + (parseInt(f.qty)||0), 0);
}

/* ============ ORDER SETTINGS (open hours / lead time / closed message) ============ */
// Keren controls when the public site accepts orders. Stored as key/value rows in
// a "Settings" sheet; the public site reads them through the Apps Script. Defaults
// below = "always open, 2 days lead" so nothing changes on the site until she edits.
const SETTINGS_DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']; // index = getDay() (0=Sunday)
let _overrides = []; // working list of special-date overrides [{date,open}] for the settings form
const DEFAULT_SETTINGS = {
  acceptingOrders: '1',
  leadDays: '2',
  closedMessage: 'כרגע איננו מקבלים הזמנות 💛 נשמח לקבל את הזמנתכם כשנפתח שוב.',
  overrides: '[]',
  hours: JSON.stringify([
    {open:true,from:'00:00',to:'23:59'},{open:true,from:'00:00',to:'23:59'},
    {open:true,from:'00:00',to:'23:59'},{open:true,from:'00:00',to:'23:59'},
    {open:true,from:'00:00',to:'23:59'},{open:true,from:'00:00',to:'23:59'},
    {open:true,from:'00:00',to:'23:59'}
  ])
};
function settingsRowsToObj(rows){ const o={}; (rows||[]).forEach(r=>{ const k=String(r[0]||'').trim(); if(k) o[k]=r[1]; }); return o; }
function isAcceptingValue(v){ const s=String(v==null?'':v).trim().toLowerCase(); return !(s==='0'||s==='false'||s==='no'||s===''); }

function renderSettings(){
  const s = Object.assign({}, DEFAULT_SETTINGS, db.settings||{});
  const acc = document.getElementById('setAccepting'); if (acc) acc.checked = isAcceptingValue(s.acceptingOrders);
  const lead = document.getElementById('setLeadDays'); if (lead) lead.value = parseInt(s.leadDays,10)||0;
  const msg = document.getElementById('setClosedMsg'); if (msg) msg.value = s.closedMessage||'';
  let hours; try { hours = JSON.parse(s.hours); } catch(e) { hours = null; }
  if (!Array.isArray(hours) || hours.length < 7) hours = JSON.parse(DEFAULT_SETTINGS.hours);
  const el = document.getElementById('hoursRows');
  if (el) el.innerHTML = SETTINGS_DAYS.map((dn,i)=>{
    const d = hours[i] || {open:false, from:'09:00', to:'20:00'};
    return `<div class="hours-row" data-day="${i}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 0;border-bottom:1px solid #f0e0d0">
      <label style="display:flex;align-items:center;gap:8px;min-width:110px;cursor:pointer;font-weight:600">
        <input type="checkbox" class="h-open" ${d.open?'checked':''} style="width:18px;height:18px;cursor:pointer"> ${dn}
      </label>
      <input type="time" class="h-from" value="${esc(d.from||'09:00')}" style="padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:#fff">
      <span style="color:var(--mute)">עד</span>
      <input type="time" class="h-to" value="${esc(d.to||'20:00')}" style="padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:#fff">
    </div>`;
  }).join('');
  try { _overrides = JSON.parse(s.overrides); } catch(e) { _overrides = []; }
  if (!Array.isArray(_overrides)) _overrides = [];
  renderOverridesList();
}

// Hebrew weekday + DD/MM label for a yyyy-mm-dd date.
function fmtOverrideDate(iso){
  const p = String(iso).split('-'); if (p.length!==3) return iso;
  const d = new Date(+p[0], +p[1]-1, +p[2]);
  return SETTINGS_DAYS[d.getDay()] + ' · ' + p[2] + '/' + p[1] + '/' + p[0];
}
function renderOverridesList(){
  const el = document.getElementById('overridesList');
  if (!el) return;
  const list = (_overrides||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if (!list.length) { el.innerHTML = '<div style="color:var(--mute);font-size:13px">אין תאריכים מיוחדים. הכל לפי שעות הפתיחה הקבועות.</div>'; return; }
  el.innerHTML = list.map(o=>{
    const isOpen = !!o.open;
    const tag = isOpen
      ? '<span class="tag ready">פתוח</span>'
      : '<span class="tag" style="background:#ffebee;color:var(--err)">סגור</span>';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0e0d0">
      <span style="min-width:170px;font-weight:600">${esc(fmtOverrideDate(o.date))}</span>
      ${tag}
      <button class="btn btn-d" style="padding:4px 10px;font-size:12px;margin-inline-start:auto" onclick="removeOverride('${esc(o.date)}')">הסר</button>
    </div>`;
  }).join('');
}
function addOverride(){
  const date = (document.getElementById('ovDate')||{}).value;
  const open = (document.getElementById('ovOpen')||{}).value === '1';
  if (!date) { toast('בחרי תאריך','err'); return; }
  _overrides = (_overrides||[]).filter(o=>o.date!==date); // one entry per date
  _overrides.push({date, open});
  document.getElementById('ovDate').value = '';
  renderOverridesList();
}
function removeOverride(date){
  _overrides = (_overrides||[]).filter(o=>o.date!==date);
  renderOverridesList();
}

// Write the 4 known settings rows (+ header) to the Settings sheet. Always the same
// shape, so it overwrites cleanly with no stale rows.
async function writeSettings(s){
  const rows = [
    ['key','value'],
    ['acceptingOrders', s.acceptingOrders],
    ['leadDays', s.leadDays],
    ['closedMessage', s.closedMessage],
    ['hours', s.hours],
    ['overrides', s.overrides || '[]']
  ];
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: 'Settings!A1:B'+rows.length, valueInputOption: 'RAW',
    resource: { values: rows }
  });
}

// Mirror the settings into a hidden "__settings__" row in the Products sheet, so
// the PUBLIC site can read them through the already-deployed products endpoint
// (?action=products) with no Apps Script deploy. The public site hides this row.
async function writeSettingsProductRow(s){
  const now = new Date().toISOString();
  const row = prodToRow({
    id:'__settings__', name:'__settings__', desc: JSON.stringify(s),
    price:0, unit:'', qty:0, kosher:'', img:'', published:1,
    sortOrder:99999, minOrder:0, minNote:'', flavors:'', updatedAt:now
  });
  const idx = (db.products||[]).findIndex(p=>p.id==='__settings__');
  if (idx >= 0) {
    await updateRow('Products', idx+2, row);
  } else {
    await appendRow('Products', row);
    db.products = db.products || [];
    db.products.push(rowToProd(row)); // keep a local copy so the next save updates instead of appending again
  }
}

async function saveOrderSettings(){
  const accepting = document.getElementById('setAccepting').checked ? '1' : '0';
  const leadDays = String(Math.max(0, parseInt(document.getElementById('setLeadDays').value,10)||0));
  const closedMessage = document.getElementById('setClosedMsg').value.trim() || DEFAULT_SETTINGS.closedMessage;
  const hours = Array.from(document.querySelectorAll('#hoursRows .hours-row')).map(row=>({
    open: row.querySelector('.h-open').checked,
    from: row.querySelector('.h-from').value || '00:00',
    to:   row.querySelector('.h-to').value   || '23:59'
  }));
  const s = { acceptingOrders: accepting, leadDays, closedMessage, hours: JSON.stringify(hours), overrides: JSON.stringify(_overrides||[]) };
  db.settings = s; saveCache();
  const ok = await ensureToken();
  if (!ok || !accessToken) { setSync('err','צריך להתחבר מחדש'); alert('ההתחברות לגוגל פגה — ההגדרות לא נשמרו לגיליון. רענני (F5), התחברי מחדש, ונסי שוב.'); return; }
  setSync('syncing','שומר...');
  try {
    if (typeof gapi !== 'undefined' && gapi.client) gapi.client.setToken({access_token: accessToken});
    await writeSettings(s);
    await writeSettingsProductRow(s);
    setSync('ok','מסונכרן'); toast('ההגדרות נשמרו ✓','ok');
  } catch(e) { console.error(e); setSync('err','שגיאת שמירה'); alert('שמירת ההגדרות נכשלה (אולי תקלת רשת). נסי שוב.'); }
}

/* ============ UI BINDING ============ */
function bindUI() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.page));
  document.getElementById('oFulfill').onchange = (e) => {
    document.getElementById('addrField').style.display = e.target.value === 'delivery' ? 'block' : 'none';
  };
  document.getElementById('custSearch').oninput = renderCustomers;
  // Init pricing rows + show initial overhead total
  for (let i=0; i<5; i++) addIngrRow();
  updateOverTotal();
  // Init P&L month select
  initMonthSelect();
  // Init recipes dropdown
  refreshRecipesList();
}

function switchTab(page) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page===page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id==='page-'+page));
  if (page==='calendar') renderCalendar();
  if (page==='pnl') renderPL();
  if (page==='expenses') renderExpenses();
  if (page==='shopping') generateShoppingList();
  if (page==='products') renderProducts();
  if (page==='settings') renderSettings();
  if (page==='assistant') initAssistant();
  if (page==='analytics') renderAnalytics();
}

function renderAll() {
  renderToday(); renderKanban(); renderCustomers(); renderProducts();
  if (document.getElementById('page-calendar').classList.contains('active')) renderCalendar();
  if (document.getElementById('page-pnl').classList.contains('active')) renderPL();
  if (document.getElementById('page-expenses').classList.contains('active')) renderExpenses();
  if (document.getElementById('page-settings').classList.contains('active')) renderSettings();
}

/* ============ TODAY ============ */
function renderToday() {
  const today = todayStr(), tomorrow = addDaysStr(today, 1);
  const open = db.orders.filter(o => o.status!=='delivered');
  const todayOrd = db.orders.filter(o => o.date===today);
  const tomorrowOrd = db.orders.filter(o => o.date===tomorrow);
  const monthRev = db.orders.filter(o => o.date && o.date.startsWith(today.slice(0,7))).reduce((s,o)=>s+orderTotal(o), 0);

  const kp = [
    {l:'הזמנות פתוחות', v:open.length, s:''},
    {l:'היום', v:todayOrd.length, s:todayOrd.length?'🔥':'', cls: todayOrd.length?'urgent':''},
    {l:'מחר', v:tomorrowOrd.length, s:''},
    {l:'הכנסות החודש', v:'₪'+Math.round(monthRev), s:'', cls:'good'},
    {l:'סה״כ לקוחות', v:db.customers.length, s:''}
  ];
  document.getElementById('kpis').innerHTML = kp.map(k=>`<div class="kpi ${k.cls||''}"><div class="lab">${k.l}</div><div class="val">${k.v}</div><div class="sub">${k.s}</div></div>`).join('');

  const urgent = [...todayOrd, ...tomorrowOrd].filter(o=>o.status!=='delivered').slice(0,8);
  document.getElementById('urgentOrders').innerHTML = urgent.length ?
    urgent.map(o=>`<div style="padding:10px;border-bottom:1px solid #f0e0d0;cursor:pointer" onclick="showOrder('${o.id}')"><strong>${esc(o.name)}</strong> · ${esc(o.date)} · ${esc(o.items.slice(0,50))}${o.items.length>50?'...':''} <span class="tag ${o.status}">${stLabel(o.status)}</span></div>`).join('') :
    '<div style="color:var(--mute)">אין הזמנות דחופות</div>';

  const recent = [...db.orders].sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||'')).slice(0,5);
  document.getElementById('activity').innerHTML = recent.length ?
    recent.map(o=>`<div style="padding:8px 0;border-bottom:1px solid #f0e0d0;font-size:13px"><strong>${esc(o.name)}</strong> · <span class="tag ${o.status}">${stLabel(o.status)}</span> · ${esc(o.date)}</div>`).join('') :
    '<div style="color:var(--mute)">אין פעילות</div>';
}

// Match an order-item line to a product in db.products. Returns {product, qty} or null.
// Heuristics: numeric qty + substring match on product name (first 4 chars) or known aliases.
const PRODUCT_ALIASES = {
  maroc:  ['מרוק'],
  choco:  ['שוקול'],
  rolled: ['מגולגל'],
  tahini: ['טחינ'],
  almond: ['חמאה','שקד'],
  butter: ['חמאה','שקד'], // legacy id
  yoyo:   ['יויו']
};
function matchProductLine(line) {
  const m = line.match(/(\d+)\s*(מארז|יח׳?|כדור|יחידות)?/);
  if (!m) return null;
  const qty = parseInt(m[1]);
  if (!qty) return null;
  for (const p of (db.products||[])) {
    if (!p.name) continue;
    const aliases = PRODUCT_ALIASES[p.id] || [];
    if (line.includes(p.name.slice(0,4)) || aliases.some(a => line.includes(a))) {
      return {product:p, qty};
    }
  }
  return null;
}
function orderTotal(o) {
  let total = 0;
  if (!o.items) return 0;
  o.items.split(/[,\n]/).forEach(line => {
    const m = matchProductLine(line);
    if (m) total += m.qty * m.product.price;
  });
  return total;
}

/* ============ KANBAN ============ */
function renderKanban() {
  const k = document.getElementById('kanban');
  k.innerHTML = STATUSES.map(s => {
    const ords = db.orders.filter(o => o.status === s.id);
    return `<div class="kcol" data-status="${s.id}" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropOrder(event,'${s.id}')">
      <h3>${s.label} <span class="count">${ords.length}</span></h3>
      ${ords.map(o => kanbanCard(o)).join('')}
    </div>`;
  }).join('');
}

function kanbanCard(o) {
  const today = todayStr();
  let cls = '';
  if (o.date === today) cls = 'today';
  else if (o.date < today && o.status !== 'delivered') cls = 'urgent';
  const payBadge = o.paid
    ? `<span style="background:#e8f5e9;color:var(--ok);font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px">₪ שולם${o.paymentMethod?' · '+esc(o.paymentMethod):''}</span>`
    : `<span style="background:#ffebee;color:var(--err);font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px">₪ חוב פתוח</span>`;
  return `<div class="kcard ${cls}" draggable="true" ondragstart="event.dataTransfer.setData('id','${o.id}');this.classList.add('dragging')" ondragend="this.classList.remove('dragging')" onclick="showOrder('${o.id}')">
    <div class="n">${esc(o.name)}</div>
    <div class="d">📅 ${esc(o.date)} · ${o.fulfillment==='delivery'?'🚚 משלוח':'🏠 איסוף'}</div>
    <div class="it">${esc(o.items.slice(0,80))}${o.items.length>80?'...':''}</div>
    <div class="ph">📞 ${esc(o.phone)}</div>
    <div style="margin-top:6px">${payBadge}</div>
  </div>`;
}

async function dropOrder(ev, status) {
  ev.preventDefault();
  document.querySelectorAll('.kcol').forEach(c => c.classList.remove('drag-over'));
  const id = ev.dataTransfer.getData('id');
  const o = db.orders.find(x => x.id === id);
  if (!o || o.status === status) return;
  o.status = status;
  o.updatedAt = new Date().toISOString();
  saveCache();
  renderAll();
  await updateOrderRow(o);
}

async function updateOrderRow(o) {
  const idx = db.orders.findIndex(x => x.id === o.id);
  if (idx < 0) return;
  const ok = await ensureToken();
  if (!ok || !accessToken) {
    setSync('err','צריך להתחבר מחדש');
    alert('ההתחברות לגוגל פגה ולכן השינוי לא נשמר.\nרענני את הדף (F5), היכנסי מחדש לגוגל, וסמני שוב.');
    return;
  }
  setSync('syncing', 'שומר...');
  try {
    if (typeof gapi !== 'undefined' && gapi.client) gapi.client.setToken({access_token: accessToken});
    await updateRow('Orders', idx + 2, orderToRow(o));
    setSync('ok', 'מסונכרן');
  } catch(e) { console.error(e); setSync('err','שגיאת שמירה'); alert('השמירה נכשלה (תקלת רשת?). נסי שוב.'); }
}

/* ============ ORDER DETAIL ============ */
function showOrder(id) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  document.getElementById('omTitle').textContent = 'הזמנה: ' + o.name;
  const methodOpts = ['<option value="">— לא צוין —</option>']
    .concat(PAYMENT_METHODS.map(m => `<option value="${esc(m)}" ${o.paymentMethod===m?'selected':''}>${m}</option>`)).join('');
  document.getElementById('omBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
      <div><strong>שם:</strong> ${esc(o.name)}</div>
      <div><strong>טלפון:</strong> <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
      <div><strong>תאריך:</strong> ${esc(o.date)}</div>
      <div><strong>מסירה:</strong> ${o.fulfillment==='delivery'?'משלוח':'איסוף'}</div>
      ${o.address?`<div style="grid-column:span 2"><strong>כתובת:</strong> ${esc(o.address)}</div>`:''}
    </div>
    <div style="margin-bottom:14px"><strong>פריטים:</strong><br>${esc(o.items).replace(/\n/g,'<br>')}</div>
    ${o.notes?`<div style="margin-bottom:14px;background:#fff3e0;padding:10px;border-radius:8px"><strong>הערות:</strong> ${esc(o.notes)}</div>`:''}
    <div style="margin-bottom:6px;font-weight:600;color:var(--ink2);font-size:13px">סטטוס הכנה</div>
    <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">
      ${STATUSES.map(s=>`<button class="btn ${o.status===s.id?'btn-p':'btn-s'}" onclick="setOrderStatus('${o.id}','${s.id}')">${s.label}</button>`).join('')}
    </div>
    <div style="background:#FAF1E8;padding:14px;border-radius:10px;margin-bottom:14px">
      <div style="font-weight:600;color:var(--ink2);font-size:13px;margin-bottom:8px">תשלום</div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px;font-size:14px">
        <input type="checkbox" id="omPaid" ${o.paid?'checked':''} onchange="setOrderPaid('${o.id}', this.checked)" style="width:20px;height:20px;cursor:pointer">
        <strong style="${o.paid?'color:var(--ok)':'color:var(--err)'}">${o.paid?'שולם ✓':'לא שולם — חוב פתוח'}</strong>
      </label>
      <div style="display:flex;align-items:center;gap:8px;font-size:13px">
        <span style="color:var(--mute)">אופן תשלום:</span>
        <select onchange="setOrderPaymentMethod('${o.id}', this.value)" style="padding:6px 10px;border:1px solid var(--bd);border-radius:6px;background:#fff;font-size:13px">${methodOpts}</select>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${o.receiptUrl ? `<a class="btn btn-p" href="${o.receiptUrl}" target="_blank">📄 קבלה</a>
      <a class="btn btn-s" href="https://wa.me/${waPhone(o.phone)}?text=${encodeURIComponent('שלום! מצורפת הקבלה על ההזמנה שלך מ-Carmel De-vries 🍪\n'+o.receiptUrl)}" target="_blank">📤 שלח קבלה ללקוח</a>` : ''}
      <a class="btn btn-s" href="https://wa.me/${waPhone(o.phone)}" target="_blank">📱 WhatsApp</a>
      <button class="btn btn-d" onclick="deleteOrder('${o.id}')">🗑 מחק</button>
    </div>`;
  document.getElementById('orderModal').classList.add('show');
}

async function setOrderPaid(id, val) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  o.paid = !!val;
  o.updatedAt = new Date().toISOString();
  saveCache(); renderAll(); showOrder(id);
  await updateOrderRow(o);
}
async function setOrderPaymentMethod(id, method) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  o.paymentMethod = method;
  o.updatedAt = new Date().toISOString();
  saveCache();
  await updateOrderRow(o);
}

async function setOrderStatus(id, status) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  o.status = status; o.updatedAt = new Date().toISOString();
  saveCache(); renderAll(); showOrder(id);
  await updateOrderRow(o);
}

async function deleteOrder(id) {
  if (!confirm('למחוק את ההזמנה?')) return;
  const idx = db.orders.findIndex(x => x.id === id);
  if (idx < 0) return;
  db.orders.splice(idx,1);
  saveCache(); closeModal('orderModal'); renderAll();
  if (accessToken) {
    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource:{requests:[{deleteDimension:{range:{sheetId:await getSheetId('Orders'),dimension:'ROWS',startIndex:idx+1,endIndex:idx+2}}}]}
      });
      toast('נמחק', 'ok');
    } catch(e){ console.error(e); toast('שגיאת מחיקה','err'); }
  }
}

async function getSheetId(name) {
  const meta = await gapi.client.sheets.spreadsheets.get({spreadsheetId:SHEET_ID});
  const s = meta.result.sheets.find(x=>x.properties.title===name);
  return s ? s.properties.sheetId : null;
}

/* ============ CUSTOMERS ============ */
function renderCustomers() {
  const q = (document.getElementById('custSearch')?.value||'').toLowerCase();
  const list = db.customers.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));
  if (!list.length) { document.getElementById('custList').innerHTML='<div style="text-align:center;padding:40px;color:var(--mute)">אין לקוחות עדיין</div>'; return; }
  document.getElementById('custList').innerHTML = `<table><thead><tr><th>שם</th><th>טלפון</th><th>כתובת</th><th>אלרגיות</th><th>הזמנות</th><th>פעולות</th></tr></thead><tbody>
    ${list.map(c=>{
      const ord = db.orders.filter(o=>o.customerId===c.id).length;
      return `<tr><td><strong>${esc(c.name)}</strong></td><td><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></td><td>${esc(c.address||'-')}</td><td>${esc(c.allergies||'-')}</td><td>${ord}</td><td class="row-actions"><button class="btn btn-s" style="padding:4px 10px;font-size:12px" onclick="editCust('${c.id}')">ערוך</button><a class="btn btn-s" style="padding:4px 10px;font-size:12px" href="https://wa.me/${c.phone.replace(/\D/g,'')}" target="_blank">📱</a></td></tr>`;
    }).join('')}</tbody></table>`;
}

function showCustModal(){ editingCustId=null; document.getElementById('cmTitle').textContent='לקוח חדש'; ['cName','cPhone','cAddr','cAllergy','cNotes'].forEach(i=>document.getElementById(i).value=''); document.getElementById('custModal').classList.add('show'); }
function editCust(id){ const c=db.customers.find(x=>x.id===id); if(!c)return; editingCustId=id; document.getElementById('cmTitle').textContent='עריכת '+c.name; document.getElementById('cName').value=c.name; document.getElementById('cPhone').value=c.phone; document.getElementById('cAddr').value=c.address; document.getElementById('cAllergy').value=c.allergies; document.getElementById('cNotes').value=c.notes; document.getElementById('custModal').classList.add('show'); }
async function saveCust() {
  const name=document.getElementById('cName').value.trim();
  const phone=document.getElementById('cPhone').value.trim();
  if(!name||!phone){toast('שם וטלפון חובה','err');return;}
  const c = editingCustId ? db.customers.find(x=>x.id===editingCustId) : {id:uid('c'),createdAt:new Date().toISOString(),lastOrder:''};
  c.name=name; c.phone=phone;
  c.address=document.getElementById('cAddr').value.trim();
  c.allergies=document.getElementById('cAllergy').value.trim();
  c.notes=document.getElementById('cNotes').value.trim();
  if (editingCustId) {
    const idx=db.customers.findIndex(x=>x.id===editingCustId);
    saveCache(); closeModal('custModal'); renderCustomers();
    const ok = await ensureToken();
    if (ok && accessToken) { setSync('syncing','שומר...'); try{ await updateRow('Customers', idx+2, custToRow(c)); setSync('ok','מסונכרן'); toast('עודכן','ok'); }catch(e){setSync('err','שגיאה');} }
    else { setSync('err','צריך להתחבר מחדש'); alert('ההתחברות לגוגל פגה — השינוי לא נשמר לגיליון. רענני (F5) והתחברי מחדש.'); }
  } else {
    db.customers.push(c);
    saveCache(); closeModal('custModal'); renderCustomers();
    const ok = await ensureToken();
    if (ok && accessToken) { setSync('syncing','שומר...'); try{ await appendRow('Customers', custToRow(c)); setSync('ok','מסונכרן'); toast('נשמר','ok'); }catch(e){setSync('err','שגיאה');} }
    else { setSync('err','צריך להתחבר מחדש'); alert('ההתחברות לגוגל פגה — הלקוח לא נשמר לגיליון. רענני (F5) והתחברי מחדש.'); }
  }
}

/* ============ CALENDAR ============ */
function calNav(d) { if(d===0) calCursor=new Date(); else calCursor.setDate(calCursor.getDate()+d*7); renderCalendar(); }
function renderCalendar() {
  const start = new Date(calCursor); start.setDate(start.getDate() - start.getDay());
  const days = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
  document.getElementById('calLabel').textContent = `${start.toLocaleDateString('he')} - ${addDays(start,6).toLocaleDateString('he')}`;
  let html = '';
  for (let i=0;i<7;i++) {
    const d=addDays(start,i), ds=isoDate(d), today=ds===todayStr();
    const ords = db.orders.filter(o=>o.date===ds);
    html += `<div class="cal-day ${today?'today':''} ${i===5?'fri':''}"><div class="dt">${days[i]} · ${d.getDate()}/${d.getMonth()+1}</div>${ords.map(o=>`<div class="cal-item" onclick="showOrder('${o.id}')"><div class="name">${esc(o.name)}</div><div class="info">${esc(o.items.slice(0,30))}${o.items.length>30?'...':''}</div></div>`).join('')}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
}

/* ============ NEW ORDER ============ */
async function saveNewOrder() {
  const name=document.getElementById('oName').value.trim();
  const phone=document.getElementById('oPhone').value.trim();
  const items=document.getElementById('oItems').value.trim();
  const date=document.getElementById('oDate').value;
  if (!name||!phone||!items||!date) { toast('שדות חובה חסרים','err'); return; }
  const ful=document.getElementById('oFulfill').value;
  // find or create customer
  let c = db.customers.find(x=>x.phone===phone);
  let isNewCust=false;
  if (!c) {
    c={id:uid('c'),name,phone,address:document.getElementById('oAddress').value.trim(),allergies:'',notes:'',createdAt:new Date().toISOString(),lastOrder:date};
    db.customers.push(c); isNewCust=true;
  } else { c.lastOrder=date; }
  const o = {id:uid('o'),customerId:c.id,name,phone,address:document.getElementById('oAddress').value.trim(),fulfillment:ful,date,items,notes:document.getElementById('oNotes').value.trim(),status:'new',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  db.orders.push(o);
  saveCache(); clearOrderForm(); renderAll(); switchTab('orders');
  let saved = false;
  const ok = await ensureToken();
  if (ok && accessToken) {
    setSync('syncing','שומר...');
    try {
      if (isNewCust) await appendRow('Customers', custToRow(c));
      else {
        const ci=db.customers.findIndex(x=>x.id===c.id);
        await updateRow('Customers', ci+2, custToRow(c));
      }
      await appendRow('Orders', orderToRow(o));
      setSync('ok','מסונכרן'); toast('הזמנה נשמרה ✓','ok'); saved=true;
    } catch(e){ console.error(e); setSync('err','שגיאת שמירה'); alert('ההזמנה לא נשמרה לגיליון (אולי תקלת רשת). היא שמורה מקומית — בדקי חיבור ונסי שוב.'); }
  } else {
    setSync('err','צריך להתחבר מחדש'); alert('ההתחברות לגוגל פגה — ההזמנה לא נשמרה לגיליון. רענני (F5), התחברי מחדש לגוגל, ונסי שוב.');
  }
  // Decrement inventory ONLY if the order actually saved to the sheet — otherwise
  // stock would drop for an order that doesn't exist.
  if (saved) {
    try {
      const dec = await decrementProductsForOrder(o);
      if (dec.length) {
        const summary = dec.map(d => `${d.name} −${d.qty} (נשאר ${d.remaining})`).join(' · ');
        toast('עודכן מלאי: ' + summary, 'ok');
      }
    } catch(e) { console.error('decrement failed', e); }
  }
}

function clearOrderForm() {
  ['oName','oPhone','oItems','oDate','oAddress','oNotes','waPaste'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('oFulfill').value='pickup';
  document.getElementById('addrField').style.display='none';
}

function parseWA() {
  const t = document.getElementById('waPaste').value;
  if (!t.trim()) return;
  const nameM=t.match(/שם[:\s]+([^\n]+)/); if(nameM)document.getElementById('oName').value=nameM[1].trim();
  const phM=t.match(/(05\d[-\s]?\d{7})/); if(phM)document.getElementById('oPhone').value=phM[1].replace(/\D/g,'');
  if (t.includes('משלוח')) document.getElementById('oFulfill').value='delivery';
  const addM=t.match(/כתובת[:\s]+([^\n]+)/); if(addM){document.getElementById('oAddress').value=addM[1].trim(); document.getElementById('addrField').style.display='block';}
  const dM=t.match(/(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4})/);
  if (dM) {
    const p=dM[1].split(/[\/\.]/);
    document.getElementById('oDate').value = `${p[2].length===2?'20'+p[2]:p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  }
  // Extract items section
  const im=t.match(/פריטים?[:\s\n]+([\s\S]+?)(?:הערות|תאריך|סה|$)/);
  if (im) document.getElementById('oItems').value=im[1].trim();
  toast('פוענח ✓','ok');
}

/* ============ PRICING ============ */
// Units are presented to the user as their natural label (גרם, ק"ג ...);
// pricing math always converts to a "base unit" — kg for mass, liter for volume,
// unit for count — so the price field always means "price per base unit".
const UNIT_OPTIONS = ['גרם','ק"ג','מ"ל','ליטר','יח׳'];
function normalizeUnit(s) {
  if (!s) return 'ק"ג';
  s = String(s).trim();
  if (/^(ק"ג|ק״ג|קג|kg)$/i.test(s)) return 'ק"ג';
  if (/^(גרם|גר|gram|g)$/i.test(s)) return 'גרם';
  if (/^(ליטר|ל'?|liter|litre|l)$/i.test(s)) return 'ליטר';
  if (/^(מ"ל|מ״ל|מל|ml)$/i.test(s)) return 'מ"ל';
  if (/^(יח'?|יח׳|יחידה|unit|pc|pcs)$/i.test(s)) return 'יח׳';
  return 'ק"ג';
}
function unitToBase(u) {
  // Multiply qty by this to convert into the base unit price refers to.
  switch (u) {
    case 'גרם': return 0.001;
    case 'ק"ג': return 1;
    case 'מ"ל': return 0.001;
    case 'ליטר': return 1;
    case 'יח׳': return 1;
  }
  return 1;
}
function unitBaseLabel(u) {
  if (u === 'גרם' || u === 'ק"ג') return 'ק"ג';
  if (u === 'מ"ל' || u === 'ליטר') return 'ליטר';
  return 'יח׳';
}
function fmtCost(c) {
  if (!c) return '₪0';
  if (c < 0.01) return '₪' + c.toFixed(4);
  if (c < 1)    return '₪' + c.toFixed(3);
  return '₪' + c.toFixed(2);
}

// === OVERHEAD BREAKDOWN ===
// Total overhead % is the sum of 4 named categories so the user can see
// what each part is and tune them independently.
function computeOverTotal() {
  return ['ovGas','ovPack','ovMarket','ovOther'].reduce((s, id) => {
    return s + (parseFloat((document.getElementById(id) || {}).value) || 0);
  }, 0);
}
function updateOverTotal() {
  const total = computeOverTotal();
  const el = document.getElementById('ovTotal');
  if (el) el.textContent = total + '%';
  updatePricingRowsTotal();
}
// Serialise breakdown so we can round-trip it through the existing `over`
// column in the Recipes sheet without a schema change.
function serializeOverbreakdown() {
  return 'gas:'  + (document.getElementById('ovGas')   .value || 0) +
         '|pack:'+ (document.getElementById('ovPack')  .value || 0) +
         '|market:'+(document.getElementById('ovMarket').value || 0) +
         '|other:'+(document.getElementById('ovOther') .value || 0);
}
function parseOverbreakdown(s) {
  s = String(s || '');
  const def = {gas:3, pack:5, market:0, other:7};
  if (!s) return def;
  if (s.indexOf(':') >= 0) {
    const obj = {gas:0, pack:0, market:0, other:0};
    s.split('|').forEach(p => {
      const [k, v] = p.split(':');
      if (k in obj) obj[k] = parseFloat(v) || 0;
    });
    return obj;
  }
  // Legacy: a single number — keep it as "other" so the total preserves.
  return {gas:0, pack:0, market:0, other: parseFloat(s) || 0};
}
function applyOverbreakdown(breakdown) {
  document.getElementById('ovGas').value    = breakdown.gas;
  document.getElementById('ovPack').value   = breakdown.pack;
  document.getElementById('ovMarket').value = breakdown.market;
  document.getElementById('ovOther').value  = breakdown.other;
  updateOverTotal();
}

// Cost = (used / bought) × bought_price, with both qty's converted to the
// same base unit (kg / liter / unit). Works whether you bought a 1kg bag and
// use 200g, or bought 200g and use all of it.
function rowCostBoughtUsed(ing) {
  const usedBase   = (parseFloat(ing.q)  || 0) * unitToBase(ing.u);
  const boughtBase = (parseFloat(ing.bq) || 0) * unitToBase(ing.bu);
  if (!boughtBase) return 0;
  return (usedBase / boughtBase) * (parseFloat(ing.bp) || 0);
}

// Bring any stored ingredient — old shape {n,q,u,p} or new shape — into the
// new {n, bq, bu, bp, q, u} form. Legacy `p` is treated as "price per base
// unit" (the previous meaning), which the conversion reproduces faithfully.
function normalizeIngr(ing) {
  ing = ing || {};
  if (ing.bp !== undefined || ing.bq !== undefined || ing.bu !== undefined) {
    return {
      n:  ing.n || '',
      bq: parseFloat(ing.bq) || 1,
      bu: normalizeUnit(ing.bu),
      bp: parseFloat(ing.bp) || 0,
      q:  parseFloat(ing.q) || 0,
      u:  normalizeUnit(ing.u)
    };
  }
  const u = normalizeUnit(ing.u);
  return {
    n:  ing.n || '',
    bq: 1,
    bu: unitBaseLabel(u), // ק"ג / ליטר / יח׳
    bp: parseFloat(ing.p) || 0,
    q:  parseFloat(ing.q) || 0,
    u:  u
  };
}

function addIngrRow(prefill) {
  const ing = normalizeIngr(prefill);
  const div = document.createElement('div');
  div.className = 'pricing-row';
  const opts = (sel) => UNIT_OPTIONS.map(u => `<option value="${esc(u)}" ${u===sel?'selected':''}>${u}</option>`).join('');
  div.innerHTML = `
    <input placeholder="מצרך" class="ingr-name" value="${esc(ing.n)}">
    <input type="number" placeholder="כמות" step="0.01" min="0" class="ingr-bq" value="${ing.bq||''}" title="כמה קניתי באריזה">
    <select class="ingr-bu" title="יחידת המידה של האריזה">${opts(ing.bu)}</select>
    <input type="number" placeholder="₪" step="0.01" min="0" class="ingr-bp" value="${ing.bp||''}" title="כמה שילמתי על האריזה הזאת">
    <input type="number" placeholder="כמות" step="0.01" min="0" class="ingr-q" value="${ing.q||''}" title="כמה משתמשים במתכון הזה">
    <select class="ingr-u" title="יחידת מידה במתכון">${opts(ing.u)}</select>
    <div class="ingr-cost">—</div>
    <button class="btn btn-d" style="padding:6px 10px" onclick="this.parentElement.remove();updatePricingRowsTotal()" title="הסר">✕</button>`;
  document.getElementById('ingrList').appendChild(div);
  div.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('input',  () => updatePricingRow(div));
    el.addEventListener('change', () => updatePricingRow(div));
  });
  updatePricingRow(div);
}

function readIngrRow(div) {
  return {
    n:  div.querySelector('.ingr-name').value.trim(),
    bq: parseFloat(div.querySelector('.ingr-bq').value) || 0,
    bu: div.querySelector('.ingr-bu').value,
    bp: parseFloat(div.querySelector('.ingr-bp').value) || 0,
    q:  parseFloat(div.querySelector('.ingr-q').value) || 0,
    u:  div.querySelector('.ingr-u').value
  };
}

function updatePricingRow(div) {
  const ing = readIngrRow(div);
  const c = rowCostBoughtUsed(ing);
  div.querySelector('.ingr-cost').textContent = (ing.bq && ing.bp && ing.q) ? fmtCost(c) : '—';
  updatePricingRowsTotal();
}

function updatePricingRowsTotal() {
  // Recompute the summary block live if it's already showing
  if (document.getElementById('prSummary').innerHTML.trim()) calcPricing();
}

function clearPricing(){
  document.getElementById('ingrList').innerHTML='';
  for(let i=0;i<5;i++)addIngrRow();
  document.getElementById('prSummary').innerHTML='';
  ['prName','prYield','prHours'].forEach(i=>document.getElementById(i).value=i==='prYield'?'30':i==='prHours'?'2':'');
  applyOverbreakdown({gas:3, pack:5, market:0, other:7});
}
function newRecipe(){
  const name = document.getElementById('prName').value.trim();
  if (name && !confirm('להתחיל מתכון חדש? כל מה שלא נשמר ב"'+name+'" יאבד.')) return;
  clearPricing();
  const sel = document.getElementById('recipeLoad');
  if (sel) sel.value = '';
  document.getElementById('prName').focus();
}
function calcPricing() {
  const rows=document.querySelectorAll('#ingrList .pricing-row');
  let ingredCost=0; const items=[];
  rows.forEach(r=>{
    const ing = readIngrRow(r);
    if (ing.n && ing.bq && ing.bp && ing.q) {
      const c = rowCostBoughtUsed(ing);
      ingredCost += c;
      items.push(Object.assign({c}, ing));
    }
  });
  const hours=parseFloat(document.getElementById('prHours').value)||0;
  const rate=parseFloat(document.getElementById('prRate').value)||0;
  const labor=hours*rate;
  const overPct=computeOverTotal();
  const overhead=(ingredCost+labor)*(overPct/100);
  const totalCost=ingredCost+labor+overhead;
  const mult=parseFloat(document.getElementById('prMult').value)||1;
  const sellPrice=totalCost*mult;
  const yld=parseFloat(document.getElementById('prYield').value)||1;
  const perUnit=sellPrice/yld;
  const profit=sellPrice-totalCost;
  document.getElementById('prSummary').innerHTML=`
    <div class="line"><span>מצרכים</span><span>₪${ingredCost.toFixed(2)}</span></div>
    <div class="line"><span>עבודה (${hours}ש׳ × ₪${rate})</span><span>₪${labor.toFixed(2)}</span></div>
    <div class="line"><span>תקורה (${overPct}%)</span><span>₪${overhead.toFixed(2)}</span></div>
    <div class="line"><span><strong>סה״כ עלות</strong></span><span><strong>₪${totalCost.toFixed(2)}</strong></span></div>
    <div class="line"><span>מכפיל רווח ×${mult}</span><span>+₪${profit.toFixed(2)}</span></div>
    <div class="line total"><span>מחיר מכירה (×${mult})</span><span>₪${sellPrice.toFixed(2)}</span></div>
    <div class="line"><span>מחיר ליחידה (תפוקה ${yld})</span><span><strong>₪${perUnit.toFixed(2)}</strong></span></div>
    <div class="line" style="color:var(--ok)"><span>רווח</span><span>₪${profit.toFixed(2)} (${(profit/sellPrice*100).toFixed(0)}%)</span></div>`;
}

/* ============ EXPENSES ============ */
function showExpModal(){ editingExpId=null; document.getElementById('emTitle').textContent='הוצאה חדשה'; document.getElementById('eDate').value=todayStr(); ['eDesc','eAmt','eVendor'].forEach(i=>document.getElementById(i).value=''); document.getElementById('expModal').classList.add('show'); }
function editExp(id){ const e=db.expenses.find(x=>x.id===id); if(!e)return; editingExpId=id; document.getElementById('emTitle').textContent='עריכת הוצאה'; document.getElementById('eDate').value=e.date; document.getElementById('eCat').value=e.category; document.getElementById('eDesc').value=e.description; document.getElementById('eAmt').value=e.amount; document.getElementById('eVendor').value=e.vendor; document.getElementById('expModal').classList.add('show'); }
async function saveExp(){
  const amt=parseFloat(document.getElementById('eAmt').value);
  if(!amt||amt<=0){toast('סכום לא תקין','err');return;}
  const e = editingExpId ? db.expenses.find(x=>x.id===editingExpId) : {id:uid('e')};
  e.date=document.getElementById('eDate').value;
  e.category=document.getElementById('eCat').value;
  e.description=document.getElementById('eDesc').value.trim();
  e.amount=amt;
  e.vendor=document.getElementById('eVendor').value.trim();
  if (editingExpId){
    const idx=db.expenses.findIndex(x=>x.id===editingExpId);
    saveCache(); closeModal('expModal'); renderExpenses();
    if (accessToken) { setSync('syncing','שומר...'); try{ await updateRow('Expenses', idx+2, expToRow(e)); setSync('ok','מסונכרן'); toast('עודכן','ok'); }catch(err){setSync('err','שגיאה');} }
  } else {
    db.expenses.push(e);
    saveCache(); closeModal('expModal'); renderExpenses();
    if (accessToken) { setSync('syncing','שומר...'); try{ await appendRow('Expenses', expToRow(e)); setSync('ok','מסונכרן'); toast('נשמר','ok'); }catch(err){setSync('err','שגיאה');} }
  }
}
async function deleteExp(id){
  if(!confirm('למחוק?'))return;
  const idx=db.expenses.findIndex(x=>x.id===id);
  if (idx<0) return;
  db.expenses.splice(idx,1);
  saveCache(); renderExpenses();
  if (accessToken) { try{ await gapi.client.sheets.spreadsheets.batchUpdate({spreadsheetId:SHEET_ID,resource:{requests:[{deleteDimension:{range:{sheetId:await getSheetId('Expenses'),dimension:'ROWS',startIndex:idx+1,endIndex:idx+2}}}]}}); toast('נמחק','ok'); }catch(e){toast('שגיאה','err');} }
}
function renderExpenses(){
  const now=new Date(), thisMo=now.toISOString().slice(0,7);
  const lastMoDate=new Date(now.getFullYear(),now.getMonth()-1,1), lastMo=lastMoDate.toISOString().slice(0,7);
  const yr=now.getFullYear()+'';
  const thisSum=db.expenses.filter(e=>e.date&&e.date.startsWith(thisMo)).reduce((s,e)=>s+e.amount,0);
  const lastSum=db.expenses.filter(e=>e.date&&e.date.startsWith(lastMo)).reduce((s,e)=>s+e.amount,0);
  const yrSum=db.expenses.filter(e=>e.date&&e.date.startsWith(yr)).reduce((s,e)=>s+e.amount,0);
  document.getElementById('expThis').textContent='₪'+Math.round(thisSum);
  document.getElementById('expLast').textContent='₪'+Math.round(lastSum);
  document.getElementById('expYear').textContent='₪'+Math.round(yrSum);
  const list=[...db.expenses].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!list.length){document.getElementById('expList').innerHTML='<div style="text-align:center;padding:40px;color:var(--mute)">אין הוצאות עדיין</div>';return;}
  document.getElementById('expList').innerHTML=`<table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>תיאור</th><th>ספק</th><th>סכום</th><th></th></tr></thead><tbody>${list.map(e=>`<tr><td>${esc(e.date)}</td><td><span class="tag confirmed">${esc(e.category)}</span></td><td>${esc(e.description||'-')}</td><td>${esc(e.vendor||'-')}</td><td><strong>₪${e.amount.toFixed(2)}</strong></td><td class="row-actions"><button class="btn btn-s" style="padding:4px 10px;font-size:12px" onclick="editExp('${e.id}')">✎</button><button class="btn btn-d" style="padding:4px 10px;font-size:12px" onclick="deleteExp('${e.id}')">🗑</button></td></tr>`).join('')}</tbody></table>`;
}

/* ============ PRODUCTS ============ */
function renderProducts() {
  const el = document.getElementById('prodList');
  if (!el) return;
  // The hidden "__settings__" row carries order-availability settings to the
  // public site (so it needs no Apps Script deploy); never show it as a product.
  const list = (db.products||[]).filter(p=>p.id!=='__settings__').sort((a,b)=>(a.sortOrder||100)-(b.sortOrder||100));
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--mute)">אין מוצרים עדיין. לחצי "➕ מוצר חדש".</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr>'
    + '<th style="width:60px">פעיל</th>'
    + '<th style="width:60px">תמונה</th>'
    + '<th>שם</th>'
    + '<th style="width:80px">מחיר</th>'
    + '<th style="width:160px">כמות זמינה</th>'
    + '<th style="width:80px">כשרות</th>'
    + '<th style="width:120px">פעולות</th>'
    + '</tr></thead><tbody>'
    + list.map(p => {
        const flavors = parseFlavors(p.flavors, p.qty);
        const hasFlavors = flavors.length > 0;
        const totalQty = hasFlavors ? flavorsTotalQty(flavors) : p.qty;
        const lowStock = p.published && totalQty>0 && totalQty<=3;
        const outOfStock = p.published && totalQty<=0;
        const qtyStyle = outOfStock ? 'color:var(--err);font-weight:700' : (lowStock ? 'color:var(--warn);font-weight:700' : '');
        const imgCell = p.img
          ? `<img src="${esc(adminImgSrc(p.img))}" alt="" style="width:46px;height:46px;border-radius:6px;object-fit:cover;border:1px solid var(--bd)" onerror="this.style.display='none'">`
          : '<span style="color:var(--mute);font-size:11px">—</span>';
        const kosherTag = p.kosher
          ? `<span class="tag ${p.kosher==='חלבי'?'baking':'ready'}">${esc(p.kosher)}</span>`
          : '<span style="color:var(--mute);font-size:11px">—</span>';
        const stockBadge = outOfStock ? ' · אזל ✖' : (lowStock ? ' · עומד להיגמר ⚠' : '');
        const subtitle = hasFlavors
          ? esc(p.unit||'') + ' · ' + flavors.length + ' טעמים'
          : esc(p.unit||'');
        let qtyCell;
        if (hasFlavors) {
          // For products with flavors, show ± per flavor inline
          qtyCell = `<div style="display:flex;flex-direction:column;gap:4px">
            ${flavors.map((f, i) => {
              const fQtyStyle = f.qty<=0 ? 'color:var(--err);font-weight:600' : (f.qty<=3 ? 'color:var(--warn);font-weight:600' : '');
              return `<div style="display:grid;grid-template-columns:1fr 24px 50px 24px;gap:4px;align-items:center">
                <span style="font-size:12px;color:var(--ink2);text-align:start;padding-inline-start:4px">${esc(f.name)}</span>
                <button class="btn btn-d" style="padding:2px 0;font-size:12px" onclick="adjustFlavorQty('${esc(p.id)}', ${i}, -1)" title="−1">−</button>
                <input type="number" value="${f.qty}" min="0" onchange="setFlavorQty('${esc(p.id)}', ${i}, this.value)" style="padding:2px 4px;border:1px solid var(--bd);border-radius:4px;text-align:center;font-size:12px;${fQtyStyle}">
                <button class="btn btn-ok" style="padding:2px 0;font-size:12px" onclick="adjustFlavorQty('${esc(p.id)}', ${i}, 1)" title="+1">+</button>
              </div>`;
            }).join('')}
            <div style="font-size:11px;color:var(--mute);text-align:center;border-top:1px dashed var(--bd);padding-top:3px;margin-top:2px;${qtyStyle}">סה״כ: ${totalQty}${stockBadge}</div>
          </div>`;
        } else {
          qtyCell = `
            <div style="display:flex;align-items:center;gap:4px">
              <button class="btn btn-d" style="padding:4px 8px;font-size:13px" onclick="adjustQty('${esc(p.id)}', -1)" title="הורדה ב-1">−</button>
              <input type="number" value="${p.qty}" min="0" onchange="setQtyDirect('${esc(p.id)}', this.value)" style="width:60px;padding:4px 6px;border:1px solid var(--bd);border-radius:6px;text-align:center;${qtyStyle}">
              <button class="btn btn-ok" style="padding:4px 8px;font-size:13px" onclick="adjustQty('${esc(p.id)}', 1)" title="הוספה ב-1">+</button>
            </div>
            <div style="font-size:11px;color:var(--mute);margin-top:2px;text-align:center">${stockBadge}</div>`;
        }
        return `<tr>
          <td><label style="display:inline-flex;align-items:center;cursor:pointer" title="הצג/הסתר באתר">
            <input type="checkbox" ${p.published?'checked':''} onchange="togglePublish('${esc(p.id)}', this.checked)" style="width:20px;height:20px;cursor:pointer">
          </label></td>
          <td>${imgCell}</td>
          <td><div style="font-weight:600">${esc(p.name)}</div><div style="font-size:11px;color:var(--mute)">${subtitle}</div></td>
          <td><strong>₪${p.price}</strong></td>
          <td>${qtyCell}</td>
          <td>${kosherTag}</td>
          <td class="row-actions">
            <button class="btn btn-s" style="padding:4px 10px;font-size:12px" onclick="editProduct('${esc(p.id)}')">✎ ערוך</button>
          </td>
        </tr>`;
      }).join('')
    + '</tbody></table>';
}

function showProductModal() {
  editingProdId = null;
  document.getElementById('pmTitle').textContent = 'מוצר חדש';
  document.getElementById('pmDelBtn').style.display = 'none';
  ['pName','pPrice','pUnit','pDesc','pImg'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('pQty').value = 0;
  document.getElementById('pSort').value = 100;
  document.getElementById('pMinOrder').value = '';
  document.getElementById('pKosher').value = '';
  document.getElementById('pPublished').checked = true;
  document.getElementById('pImgFile').value = '';
  document.getElementById('pImgStatus').textContent = '';
  updateImagePreview('');
  setFlavorRows([]);
  document.getElementById('prodModal').classList.add('show');
}
function editProduct(id) {
  const p = (db.products||[]).find(x => x.id === id); if (!p) return;
  editingProdId = id;
  document.getElementById('pmTitle').textContent = 'עריכת ' + p.name;
  document.getElementById('pmDelBtn').style.display = 'inline-flex';
  document.getElementById('pName').value = p.name;
  document.getElementById('pPrice').value = p.price;
  document.getElementById('pUnit').value = p.unit;
  document.getElementById('pQty').value = p.qty;
  document.getElementById('pKosher').value = p.kosher;
  document.getElementById('pSort').value = p.sortOrder;
  document.getElementById('pDesc').value = p.desc;
  document.getElementById('pImg').value = p.img;
  document.getElementById('pImgFile').value = '';
  document.getElementById('pImgStatus').textContent = '';
  updateImagePreview(p.img);
  setFlavorRows(parseFlavors(p.flavors, p.qty));
  document.getElementById('pMinOrder').value = p.minOrder || '';
  document.getElementById('pPublished').checked = !!p.published;
  document.getElementById('prodModal').classList.add('show');
}

function setFlavorRows(arr) {
  const c = document.getElementById('pFlavorRows');
  c.innerHTML = '';
  (arr||[]).forEach(f => addFlavorRow(f.name, f.qty));
}
function addFlavorRow(name, qty) {
  const c = document.getElementById('pFlavorRows');
  const row = document.createElement('div');
  row.className = 'flavor-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 90px auto;gap:8px;align-items:center';
  row.innerHTML = `
    <input class="fr-name" placeholder="שם הטעם" value="${esc(name||'')}" style="padding:8px 10px;border:1px solid var(--bd);border-radius:6px;background:#fff">
    <input class="fr-qty" type="number" min="0" placeholder="כמות" value="${qty!=null?qty:''}" style="padding:8px 10px;border:1px solid var(--bd);border-radius:6px;background:#fff;text-align:center">
    <button type="button" class="btn btn-d" style="padding:6px 10px;font-size:13px" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(row);
}
function readFlavorsFromForm() {
  return Array.from(document.querySelectorAll('#pFlavorRows .flavor-row')).map(r => ({
    name: r.querySelector('.fr-name').value.trim(),
    qty:  Math.max(0, parseInt(r.querySelector('.fr-qty').value)||0)
  })).filter(f => f.name);
}

// === IMAGE UPLOAD ===
// Preferred path: upload via the Apps Script Web App to a shared Drive folder
// (no per-cell size limit, faster page loads, ~2 MB ceiling).
// Fallback: encode as base64 data URL — capped at Sheets' 50,000 char cell limit.
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbw2KPB_GWD7T4ylM9DiCKpimqWEx7oDyd4WoYwyzDCGw53t9_C-MivKQf4dYF036psjDg/exec';
const IMG_MAX_DIM_DRIVE = 1200;        // when we upload to Drive — keep more detail
const IMG_QUALITY_DRIVE = 0.85;
const IMG_MAX_DIM_BASE64 = 600;        // small fallback so it can fit in a cell
const IMG_MAX_DATAURL_CHARS = 45000;

// Admin page lives at /admin/, so relative paths like "images/maroc.jpg" need
// "../" to resolve against the site root. Data URLs and absolute URLs are kept as-is.
function adminImgSrc(src) {
  if (!src) return '';
  if (/^(https?:|data:|\/\/|\/)/.test(src)) return src;
  return '../' + src;
}

function updateImagePreview(src) {
  const el = document.getElementById('pImgPreview');
  const removeBtn = document.getElementById('pImgRemoveBtn');
  if (src && src.length > 0) {
    el.innerHTML = `<img src="${esc(adminImgSrc(src))}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';this.parentElement.textContent='טעינה נכשלה'">`;
    if (removeBtn) removeBtn.style.display = 'inline-flex';
  } else {
    el.innerHTML = 'בלי תמונה';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}
function clearImage() {
  document.getElementById('pImg').value = '';
  document.getElementById('pImgFile').value = '';
  document.getElementById('pImgStatus').textContent = '';
  updateImagePreview('');
}

async function handleImageUpload(file) {
  if (!file) return;
  const status = document.getElementById('pImgStatus');
  status.textContent = 'מעבד תמונה...';
  status.style.color = 'var(--mute)';
  try {
    if (file.size > 10 * 1024 * 1024) {
      status.textContent = 'הקובץ גדול מ-10MB, בחרי קובץ קטן יותר';
      status.style.color = 'var(--err)';
      return;
    }
    // 1) Try the Drive path — keeps the image high-quality and the cell tiny.
    if (WEBAPP_URL) {
      try {
        const big = await resizeToDataUrl(file, IMG_MAX_DIM_DRIVE, IMG_QUALITY_DRIVE);
        status.textContent = 'מעלה ל-Drive...';
        const resp = await fetch(WEBAPP_URL, {
          method: 'POST',
          headers: {'Content-Type': 'text/plain;charset=utf-8'},
          // token: the upload endpoint verifies the caller is a signed-in admin
          body: JSON.stringify({ action:'image_upload', token: accessToken, data: big, filename: file.name ? file.name.replace(/\.[^.]+$/, '') : ('carmel-' + Date.now()) })
        });
        const data = await resp.json();
        if (data && data.ok && data.url) {
          document.getElementById('pImg').value = data.url;
          updateImagePreview(data.url);
          const kb = Math.round(big.length * 0.75 / 1024);
          status.textContent = `הועלה ל-Drive ✓ (${kb} KB)`;
          status.style.color = 'var(--ok)';
          return;
        }
        // 'bad_data_url' / 'too_large' / etc. — fall through to base64
        console.warn('Drive upload returned', data);
      } catch (driveErr) {
        // Most common cause: Apps Script hasn't been re-deployed with image_upload yet
        console.warn('Drive upload failed, falling back to base64:', driveErr);
      }
    }
    // 2) Fallback: small base64 in the cell
    const dataUrl = await resizeImageToFit(file, IMG_MAX_DIM_BASE64);
    document.getElementById('pImg').value = dataUrl;
    updateImagePreview(dataUrl);
    const kb = Math.round(dataUrl.length * 0.75 / 1024);
    status.textContent = `נשמר בתא ✓ (${kb} KB) — Drive לא זמין כרגע`;
    status.style.color = 'var(--warn)';
  } catch (e) {
    console.error('image upload failed:', e);
    status.textContent = 'שגיאה בעיבוד התמונה: ' + (e.message||'');
    status.style.color = 'var(--err)';
  }
}

// Resize without the cell-size constraint — used before upload to Drive.
async function resizeToDataUrl(file, maxDim, quality) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('פורמט לא נתמך')); img.src = url; });
    let {width: w, height: h} = img;
    if (w > maxDim || h > maxDim) {
      const r = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Resize an image to fit within maxDim and the Sheets cell char ceiling.
// Tries a ladder of (dimension × quality) combos until the data URL string
// length fits IMG_MAX_DATAURL_CHARS. Throws if nothing fits so the user gets
// a clear error rather than a silent save failure later.
async function resizeImageToFit(file, maxDim) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('פורמט לא נתמך')); img.src = url; });
    let {width: w, height: h} = img;
    if (w > maxDim || h > maxDim) {
      const r = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    const attempts = [
      {scale:1.0,  q:0.85},
      {scale:1.0,  q:0.75},
      {scale:1.0,  q:0.65},
      {scale:1.0,  q:0.55},
      {scale:0.8,  q:0.70},
      {scale:0.65, q:0.65},
      {scale:0.5,  q:0.60},
      {scale:0.4,  q:0.55}
    ];
    for (const a of attempts) {
      const sw = Math.max(64, Math.round(w * a.scale));
      const sh = Math.max(64, Math.round(h * a.scale));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, 0, 0, sw, sh);
      const dataUrl = c.toDataURL('image/jpeg', a.q);
      if (dataUrl.length <= IMG_MAX_DATAURL_CHARS) return dataUrl;
    }
    throw new Error('התמונה גדולה מדי גם אחרי דחיסה. נסי תמונה קטנה יותר או בפורמט אחר.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveProduct() {
  const name = document.getElementById('pName').value.trim();
  const price = parseFloat(document.getElementById('pPrice').value);
  if (!name) { toast('שם חובה','err'); return; }
  if (!(price>0)) { toast('מחיר לא תקין','err'); return; }
  const flavors = readFlavorsFromForm();
  const p = editingProdId
    ? db.products.find(x => x.id === editingProdId)
    : {id: uid('p')};
  p.name = name;
  p.price = price;
  p.unit = document.getElementById('pUnit').value.trim();
  p.kosher = document.getElementById('pKosher').value;
  p.sortOrder = parseInt(document.getElementById('pSort').value)||100;
  p.desc = document.getElementById('pDesc').value.trim();
  p.img = document.getElementById('pImg').value.trim();
  p.flavors = serializeFlavors(flavors);
  p.minOrder = parseInt(document.getElementById('pMinOrder').value)||0;
  // Auto-derive the note from minOrder so the user only has to fill one field.
  p.minNote = p.minOrder > 0 ? `* מינימום להזמנה ${p.minOrder} יח׳` : '';
  p.published = document.getElementById('pPublished').checked ? 1 : 0;
  // When flavors exist, total qty = sum of per-flavor qty (auto). Otherwise read from pQty input.
  p.qty = flavors.length
    ? flavorsTotalQty(flavors)
    : Math.max(0, parseInt(document.getElementById('pQty').value)||0);
  p.updatedAt = new Date().toISOString();
  if (editingProdId) {
    const idx = db.products.findIndex(x => x.id === editingProdId);
    saveCache(); closeModal('prodModal'); renderProducts();
    if (accessToken) { setSync('syncing','שומר...'); try { await updateRow('Products', idx+2, prodToRow(p)); setSync('ok','מסונכרן'); toast('עודכן','ok'); } catch(e){ console.error('saveProduct update failed:', e); setSync('err','שגיאה'); toast('שגיאת שמירה: '+(e.result&&e.result.error&&e.result.error.message||e.message||'unknown'),'err'); } }
  } else {
    db.products.push(p);
    saveCache(); closeModal('prodModal'); renderProducts();
    if (accessToken) { setSync('syncing','שומר...'); try { await appendRow('Products', prodToRow(p)); setSync('ok','מסונכרן'); toast('נשמר','ok'); } catch(e){ console.error('saveProduct append failed:', e); setSync('err','שגיאה'); toast('שגיאת שמירה: '+(e.result&&e.result.error&&e.result.error.message||e.message||'unknown'),'err'); } }
  }
}

async function deleteProduct() {
  if (!editingProdId) return;
  const p = db.products.find(x => x.id === editingProdId);
  if (!p) return;
  if (!confirm(`למחוק את "${p.name}"? המוצר יוסר מהאתר ומהדשבורד.`)) return;
  const idx = db.products.findIndex(x => x.id === editingProdId);
  db.products.splice(idx, 1);
  saveCache(); closeModal('prodModal'); renderProducts();
  if (accessToken) {
    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {requests: [{deleteDimension: {range: {sheetId: await getSheetId('Products'), dimension:'ROWS', startIndex:idx+1, endIndex:idx+2}}}]}
      });
      toast('נמחק','ok');
    } catch(e){ console.error(e); toast('שגיאת מחיקה','err'); }
  }
}

async function togglePublish(id, val) {
  const p = db.products.find(x => x.id === id); if (!p) return;
  p.published = val ? 1 : 0;
  p.updatedAt = new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
}
async function adjustQty(id, delta) {
  const p = db.products.find(x => x.id === id); if (!p) return;
  p.qty = Math.max(0, (parseInt(p.qty)||0) + delta);
  p.updatedAt = new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
}
async function setQtyDirect(id, v) {
  const p = db.products.find(x => x.id === id); if (!p) return;
  p.qty = Math.max(0, parseInt(v)||0);
  p.updatedAt = new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
}
async function adjustFlavorQty(id, flavorIdx, delta) {
  const p = db.products.find(x => x.id === id); if (!p) return;
  const flavors = parseFlavors(p.flavors, p.qty);
  if (!flavors[flavorIdx]) return;
  flavors[flavorIdx].qty = Math.max(0, (parseInt(flavors[flavorIdx].qty)||0) + delta);
  p.flavors = serializeFlavors(flavors);
  p.qty = flavorsTotalQty(flavors);
  p.updatedAt = new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
}
async function setFlavorQty(id, flavorIdx, v) {
  const p = db.products.find(x => x.id === id); if (!p) return;
  const flavors = parseFlavors(p.flavors, p.qty);
  if (!flavors[flavorIdx]) return;
  flavors[flavorIdx].qty = Math.max(0, parseInt(v)||0);
  p.flavors = serializeFlavors(flavors);
  p.qty = flavorsTotalQty(flavors);
  p.updatedAt = new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
}
async function persistProductRow(p) {
  const idx = db.products.findIndex(x => x.id === p.id);
  if (idx < 0) return;
  if (!accessToken) {
    setSync('err','לא מחובר');
    toast('⚠️ לא מחוברים לגוגל — השינוי נשמר רק במכשיר ולא יופיע באתר. רענני את הדף והתחברי מחדש, ואז עדכני שוב.','err');
    return;
  }
  setSync('syncing','שומר...');
  try { await updateRow('Products', idx+2, prodToRow(p)); setSync('ok','מסונכרן'); }
  catch(e){ console.error(e); setSync('err','שגיאת שמירה'); toast('⚠️ השמירה לגיליון נכשלה — רענני והתחברי מחדש, ואז עדכני שוב.','err'); }
}

// Decrement product quantities based on parsed order items.
// Best-effort: matches by name prefix or aliases. For products with flavors, also tries
// to match a flavor name in the same line and decrement only that flavor.
// Returns array of {name, qty, remaining} actually decremented.
async function decrementProductsForOrder(o) {
  if (!o.items || !db.products.length) return [];
  const decremented = [];
  const touched = new Set(); // product ids whose row needs to be persisted once
  o.items.split(/[,\n]/).forEach(line => {
    const m = matchProductLine(line);
    if (!m) return;
    const flavors = parseFlavors(m.product.flavors, m.product.qty);
    if (flavors.length) {
      // Try to match a flavor name in the same line
      const matchedFlavor = flavors.find(f => f.name && line.includes(f.name));
      if (matchedFlavor) {
        matchedFlavor.qty = Math.max(0, matchedFlavor.qty - m.qty);
        m.product.flavors = serializeFlavors(flavors);
        m.product.qty = flavorsTotalQty(flavors);
        decremented.push({name:`${m.product.name} (${matchedFlavor.name})`, qty:m.qty, remaining:matchedFlavor.qty});
      } else {
        // No specific flavor — split decrement evenly across flavors with stock (best-effort)
        let remaining = m.qty;
        for (const f of flavors) {
          if (remaining <= 0) break;
          const take = Math.min(f.qty, remaining);
          f.qty -= take; remaining -= take;
        }
        m.product.flavors = serializeFlavors(flavors);
        m.product.qty = flavorsTotalQty(flavors);
        decremented.push({name:m.product.name+' (לא צוין טעם)', qty:m.qty, remaining:m.product.qty});
      }
    } else {
      m.product.qty = Math.max(0, (parseInt(m.product.qty)||0) - m.qty);
      decremented.push({name:m.product.name, qty:m.qty, remaining:m.product.qty});
    }
    m.product.updatedAt = new Date().toISOString();
    touched.add(m.product.id);
  });
  if (!decremented.length) return [];
  saveCache(); renderProducts();
  if (accessToken) {
    await Promise.all(Array.from(touched).map(id => {
      const p = db.products.find(x => x.id === id);
      return p ? persistProductRow(p) : null;
    }));
  }
  return decremented;
}

/* ============ P&L ============ */
function initMonthSelect(){
  const sel=document.getElementById('plMonth');
  const now=new Date(); const opts=[];
  for(let i=0;i<12;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const v=d.toISOString().slice(0,7);
    opts.push(`<option value="${v}">${d.toLocaleDateString('he',{year:'numeric',month:'long'})}</option>`);
  }
  sel.innerHTML=opts.join('');
}
function renderPL(){
  const mo=document.getElementById('plMonth').value||new Date().toISOString().slice(0,7);
  const ords=db.orders.filter(o=>o.date&&o.date.startsWith(mo));
  const exps=db.expenses.filter(e=>e.date&&e.date.startsWith(mo));
  const rev=ords.reduce((s,o)=>s+orderTotal(o),0);
  const expSum=exps.reduce((s,e)=>s+e.amount,0);
  const net=rev-expSum;
  document.getElementById('plRev').textContent='₪'+Math.round(rev);
  document.getElementById('plOrders').textContent=`${ords.length} הזמנות`;
  document.getElementById('plExp').textContent='₪'+Math.round(expSum);
  document.getElementById('plNet').textContent='₪'+Math.round(net);
  document.getElementById('plMargin').textContent = rev>0 ? `שולי רווח: ${((net/rev)*100).toFixed(1)}%` : '';
  document.getElementById('plOrderList').innerHTML = ords.length ?
    `<table><thead><tr><th>תאריך</th><th>לקוח</th><th>פריטים</th><th>סטטוס</th><th>סכום מוערך</th></tr></thead><tbody>${ords.map(o=>`<tr><td>${esc(o.date)}</td><td>${esc(o.name)}</td><td>${esc(o.items.slice(0,40))}...</td><td><span class="tag ${o.status}">${stLabel(o.status)}</span></td><td><strong>₪${orderTotal(o).toFixed(0)}</strong></td></tr>`).join('')}</tbody></table>`
    : '<div style="color:var(--mute);text-align:center;padding:20px">אין הזמנות</div>';
  // Expenses grouped by category
  const byCat={};
  exps.forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+e.amount; });
  document.getElementById('plExpList').innerHTML = Object.keys(byCat).length ?
    Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,s])=>`<div style="display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #f0e0d0"><span><strong>${esc(c)}</strong></span><span>₪${s.toFixed(0)}</span></div>`).join('')
    : '<div style="color:var(--mute);text-align:center;padding:20px">אין הוצאות</div>';
}

/* ============ ANALYTICS ============ */
// Returns a predicate that keeps orders inside the selected range.
function anRangeFilter(){
  const sel = (document.getElementById('anRange')||{}).value || 'all';
  const today = todayStr();
  if (sel==='month'){ const mo = today.slice(0,7); return o => o.date && o.date.startsWith(mo); }
  if (sel==='30' || sel==='90'){ const from = addDaysStr(today, -parseInt(sel,10)); return o => o.date && o.date >= from; }
  return () => true;
}
// Dependency-free horizontal bars. items: [{label,value,sub?}]. opts: {money,unit,alt}.
function anBars(items, opts){
  opts = opts || {};
  if (!items || !items.length) return '<div class="an-empty">אין נתונים בטווח</div>';
  const max = Math.max.apply(null, items.map(i=>i.value).concat([1]));
  return items.map(i=>{
    const pct = Math.max(2, Math.round((i.value/max)*100));
    const val = opts.money ? '₪'+Math.round(i.value).toLocaleString('he-IL')
                           : (Math.round(i.value).toLocaleString('he-IL')+(opts.unit||''));
    const sub = i.sub ? ' <span style="color:var(--mute);font-weight:400;font-size:12px">'+esc(i.sub)+'</span>' : '';
    return '<div class="an-row"><span class="an-lab" title="'+esc(i.label)+'">'+esc(i.label)+'</span>'+
           '<span class="an-track"><span class="an-fill'+(opts.alt?' alt':'')+'" style="width:'+pct+'%"></span></span>'+
           '<span class="an-val">'+val+sub+'</span></div>';
  }).join('');
}
function anMonthLabel(m){
  const MN=['ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ'];
  const p=String(m).split('-'); return (MN[(+p[1])-1]||p[1])+' '+(p[0]||'').slice(2);
}
function renderAnalytics(){
  // ---- Orders analytics (from data already loaded — no backend, no risk) ----
  try {
    const f = anRangeFilter();
    const ords = db.orders.filter(f);
    const revenue = ords.reduce((s,o)=>s+orderTotal(o), 0);
    const cnt = ords.length;
    const aov = cnt ? revenue/cnt : 0;
    const paidCnt = ords.filter(o=>o.paid).length;
    const byCust = {};
    ords.forEach(o=>{ const k=o.customerId||o.phone||o.name; if(k) byCust[k]=(byCust[k]||0)+1; });
    const custCnt = Object.keys(byCust).length;
    const repeat = Object.values(byCust).filter(n=>n>1).length;
    const kp = [
      {l:'הזמנות', v:cnt},
      {l:'הכנסות', v:'₪'+Math.round(revenue).toLocaleString('he-IL'), cls:'good'},
      {l:'הזמנה ממוצעת', v:'₪'+Math.round(aov).toLocaleString('he-IL')},
      {l:'לקוחות חוזרים', v: repeat + (custCnt? ' / '+custCnt : ''), cls: repeat?'urgent':''},
      {l:'שולמו', v: paidCnt + ' / ' + cnt}
    ];
    document.getElementById('anOrderKpis').innerHTML = kp.map(k=>'<div class="kpi '+(k.cls||'')+'"><div class="lab">'+k.l+'</div><div class="val">'+k.v+'</div><div class="sub"></div></div>').join('');

    const revMo = {};
    db.orders.forEach(o=>{ if(o.date){ const m=o.date.slice(0,7); revMo[m]=(revMo[m]||0)+orderTotal(o); }});
    const months = Object.keys(revMo).sort().slice(-8);
    document.getElementById('anRevByMonth').innerHTML = anBars(months.map(m=>({label:anMonthLabel(m), value:revMo[m]})), {money:true});

    const byProd = {};
    ords.forEach(o=>{ (o.items||'').split(/[,\n]/).forEach(line=>{ const m=matchProductLine(line); if(m){ const id=m.product.id; if(!byProd[id]) byProd[id]={name:m.product.name, qty:0, rev:0}; byProd[id].qty+=m.qty; byProd[id].rev+=m.qty*m.product.price; }}); });
    const prodArr = Object.values(byProd);
    const topQty = prodArr.slice().sort((a,b)=>b.qty-a.qty).slice(0,8);
    const topRev = prodArr.slice().sort((a,b)=>b.rev-a.rev).slice(0,8);
    document.getElementById('anTopQty').innerHTML = anBars(topQty.map(p=>({label:p.name, value:p.qty})), {unit:' יח׳'});
    document.getElementById('anTopRev').innerHTML = anBars(topRev.map(p=>({label:p.name, value:p.rev})), {money:true, alt:true});

    const pickup = ords.filter(o=>o.fulfillment!=='delivery').length;
    const delivery = ords.filter(o=>o.fulfillment==='delivery').length;
    document.getElementById('anFulfill').innerHTML = anBars([{label:'איסוף 🏠', value:pickup},{label:'משלוח 🚚', value:delivery}], {});

    const pay = {};
    ords.forEach(o=>{ const k=o.paymentMethod || 'לא צויין'; pay[k]=(pay[k]||0)+1; });
    document.getElementById('anPayment').innerHTML = anBars(Object.entries(pay).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:k, value:v})), {alt:true});

    const dow=[0,0,0,0,0,0,0];
    ords.forEach(o=>{ if(o.date){ const p=o.date.split('-'); const d=new Date(+p[0],+p[1]-1,+p[2]); if(!isNaN(d.getTime())) dow[d.getDay()]++; }});
    const DOWN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    document.getElementById('anWeekday').innerHTML = anBars(dow.map((v,i)=>({label:DOWN[i], value:v})), {alt:true});
  } catch(e){ console.warn('renderAnalytics orders', e); }
  // ---- Web traffic (from carmel-agent) — isolated; never blocks the above ----
  anLoadWeb();
}
function anWebUnavailable(msg){
  const k=document.getElementById('anWebKpis'); if(k) k.innerHTML='';
  ['anTopViewed','anTopDwell','anReferrers'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML='<div class="an-empty">—</div>'; });
  const note=document.getElementById('anWebNote'); if(note) note.textContent=msg||'';
}
function anRefLabel(h){
  h=String(h||'').toLowerCase();
  if(!h||h==='direct') return 'ישיר / נשמר';
  if(h.indexOf('whatsapp')>-1||h==='wa') return 'וואטסאפ';
  if(h.indexOf('instagram')>-1||h==='ig') return 'אינסטגרם';
  if(h.indexOf('facebook')>-1||h==='fb') return 'פייסבוק';
  if(h.indexOf('google')>-1) return 'גוגל';
  if(h.indexOf('t.co')>-1||h.indexOf('twitter')>-1||h.indexOf('x.com')>-1) return 'X/טוויטר';
  return h;
}
async function anLoadWeb(){
  try {
    const sel=(document.getElementById('anRange')||{}).value||'all';
    const days = sel==='month' ? 31 : (sel==='all' ? 365 : (parseInt(sel,10)||30));
    let ok=false; try{ ok=await ensureToken(); }catch(e){}
    if(!ok || !accessToken){ anWebUnavailable('צריך להתחבר מחדש לגוגל כדי לראות נתוני צפיות.'); return; }
    const resp = await fetch(AGENT_URL.replace(/\/$/,'')+'/api/analytics', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+accessToken },
      body: JSON.stringify({ days })
    });
    if(!resp.ok){ anWebUnavailable('מעקב הצפיות עדיין לא הופעל.'); return; }
    let d={}; try{ d=await resp.json(); }catch(e){}
    if(!d || d.configured===false){ anWebUnavailable((d&&d.note) ? d.note : 'מעקב הצפיות עדיין לא הופעל (צריך לחבר את מאגר הנתונים).'); return; }
    const online=d.onlineNow||0;
    const wk=[
      {l:'אונליין עכשיו', v:online, live:true},
      {l:'מבקרים (טווח)', v:(d.visitors||0).toLocaleString('he-IL')},
      {l:'צפיות בדפים', v:(d.pageviews||0).toLocaleString('he-IL')},
      {l:'התחילו הזמנה', v:(d.checkouts||0).toLocaleString('he-IL')},
      {l:'נייד / מחשב', v:(d.mobile||0)+' / '+(d.desktop||0)}
    ];
    document.getElementById('anWebKpis').innerHTML = wk.map(k=>'<div class="kpi"><div class="lab">'+k.l+'</div><div class="val">'+(k.live?'<span class="an-live"><span class="an-dot '+(online>0?'on':'')+'"></span>'+k.v+'</span>':k.v)+'</div><div class="sub"></div></div>').join('');
    document.getElementById('anTopViewed').innerHTML = anBars((d.topViewed||[]).map(p=>({label:p.name||p.pid, value:p.views})), {unit:' צפ׳'});
    document.getElementById('anTopDwell').innerHTML  = anBars((d.topDwell||[]).map(p=>({label:p.name||p.pid, value:Math.round((p.avgMs||0)/1000)})), {unit:' שנ׳', alt:true});
    document.getElementById('anReferrers').innerHTML = anBars((d.referrers||[]).map(r=>({label:anRefLabel(r.host), value:r.count})), {alt:true});
    const note=document.getElementById('anWebNote');
    if(note) note.textContent='נאסף אנונימית, בלי עוגיות ובלי שמירת זהות.';
  } catch(e){ anWebUnavailable('לא הצלחתי לטעון נתוני צפיות כרגע.'); }
}

/* ============ SHOPPING LIST ============ */
function generateShoppingList(){
  const open = db.orders.filter(o=>o.status==='new'||o.status==='confirmed'||o.status==='baking');
  if(!open.length){
    document.getElementById('shopList').innerHTML='<div style="color:var(--mute);text-align:center;padding:20px">אין הזמנות פתוחות</div>';
    return;
  }
  if (!db.recipes || db.recipes.length===0){
    document.getElementById('shopList').innerHTML='<div style="background:#fff3e0;padding:14px;border-radius:8px;color:var(--ink2);text-align:center">⚠️ אין מתכונים שמורים עדיין.<br>היכנסי ל-🧮 תמחור, מלאי מתכון, ולחצי "💾 שמירת מתכון".<br>אחר כך הרשימה כאן תחושב אוטומטית מהמתכונים האמיתיים שלך.</div>';
    return;
  }
  // For each open order, match items to recipes
  const batchesPerRecipe = {}; // recipeId -> batches
  const unmatched = []; // {orderName, line}
  open.forEach(o=>{
    const lines = (o.items||'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
    lines.forEach(line=>{
      const m = line.match(/(\d+(?:\.\d+)?)/);
      if (!m) { unmatched.push({order:o.name, line}); return; }
      const qty = parseFloat(m[1]);
      // Match recipe by name substring
      const lt = line;
      // Match by best word overlap. All recipes share "עוגיות", so comparing a
      // 5-char prefix can't tell them apart — compare the full name's words and
      // pick the recipe whose words best match this order line.
      let recipe = null, _bestHits = 0;
      db.recipes.forEach(r => {
        if (!r.name) return;
        const words = r.name.split(/\s+/).map(w => w.trim()).filter(w => w.length >= 2);
        if (!words.length) return;
        const hits = words.filter(w => lt.includes(w)).length;
        if (hits > _bestHits) { _bestHits = hits; recipe = r; }
      });
      if (!recipe || _bestHits === 0){ unmatched.push({order:o.name, line}); return; }
      // Convert the ordered quantity into actual units. A product sold by the
      // package (unit text like "מארז של כ-30 יח׳") means each ordered qty is a
      // package of N units — so multiply. "ליחידה" means qty already = units.
      const prod = (db.products||[]).find(p => p.name && lt.includes(p.name));
      let unitsOrdered = qty;
      if (prod){
        const u = String(prod.unit||'');
        const um = u.match(/(\d+)/);
        if (um && /מארז|מארזי/.test(u)) unitsOrdered = qty * parseInt(um[1], 10);
      }
      const y = parseFloat(recipe.yield) || 30;
      const batches = unitsOrdered / y;
      batchesPerRecipe[recipe.id] = (batchesPerRecipe[recipe.id]||0) + batches;
    });
  });
  // Aggregate ingredients
  const need = {}; // "name|unit" -> qty
  const recipeBatches = []; // for display
  Object.entries(batchesPerRecipe).forEach(([rid, batches])=>{
    const r = db.recipes.find(x=>x.id===rid);
    if (!r) return;
    recipeBatches.push({name:r.name, batches:batches, yield:r.yield});
    (r.ingredients||[]).forEach(ing=>{
      const q = parseFloat(ing.q) || 0;
      if (q===0) return;
      const key = ing.n + '|' + (ing.u||'');
      need[key] = (need[key]||0) + (q * batches);
    });
  });

  let html = '<div class="shop-grp"><h3>📦 לאפות</h3>';
  html += '<div style="font-size:13px;color:var(--ink2);padding:2px 0 10px;line-height:1.65">כמה לאפות מכל סוג, מחושב אוטומטית מההזמנות הפתוחות.<br>המספר המודגש = כמות היחידות לאפייה. בסוגריים = איזה חלק ממתכון מלא להכין.</div><ul>';
  if (recipeBatches.length === 0){
    html += '<li style="color:var(--mute)">לא נמצאו התאמות בין ההזמנות למתכונים השמורים</li>';
  } else {
    recipeBatches.forEach(rb=>{
      const units = Math.round(rb.batches*(parseFloat(rb.yield)||30));
      html += `<li><span><strong>${esc(rb.name)}</strong></span><span><strong>${units} יח׳</strong> <span style="color:var(--mute);font-size:13px">(${rb.batches.toFixed(2)} ממתכון)</span></span></li>`;
    });
  }
  html += '</ul></div>';

  html += '<div class="shop-grp"><h3>🛒 מצרכים לקנות</h3><ul>';
  if (Object.keys(need).length === 0){
    html += '<li style="color:var(--mute)">לא נמצאו מצרכים — ודאי שיש מתכונים שמורים</li>';
  } else {
    Object.entries(need).sort().forEach(([key,amt])=>{
      const [n,u] = key.split('|');
      html += `<li><span>${esc(n)}</span><span><strong>${amt.toFixed(2)} ${esc(u)}</strong></span></li>`;
    });
  }
  html += '</ul></div>';

  if (unmatched.length){
    html += '<div class="shop-grp"><h3>⚠️ לא זוהו (חסר מתכון)</h3><ul>';
    unmatched.forEach(u=>{ html += `<li><span>${esc(u.order)}</span><span style="color:var(--mute);font-size:12px">${esc(u.line)}</span></li>`; });
    html += '</ul><div style="font-size:13px;color:var(--ink2);padding:8px">הוסיפי מתכון תואם ב-🧮 תמחור כדי שאלה יחושבו אוטומטית.</div></div>';
  }
  document.getElementById('shopList').innerHTML = html;
}

function copyShoppingList(){
  const txt=document.getElementById('shopList').innerText;
  navigator.clipboard.writeText(txt).then(()=>toast('הועתק ✓','ok'));
}


/* ============ RECIPES (saved in Google Sheets) ============ */
async function saveRecipe(){
  const name = document.getElementById('prName').value.trim();
  if (!name) { toast('יש למלא שם מוצר','err'); return; }
  const rows=document.querySelectorAll('#ingrList .pricing-row');
  const ingredients=[];
  rows.forEach(r=>{
    const ing = readIngrRow(r);
    if (ing.n) ingredients.push(ing);
  });
  const existing = db.recipes.find(r => r.name === name);
  const recipe = {
    id: existing ? existing.id : uid('r'),
    name,
    yield: document.getElementById('prYield').value,
    hours: document.getElementById('prHours').value,
    rate: document.getElementById('prRate').value,
    over: serializeOverbreakdown(),
    mult: document.getElementById('prMult').value,
    ingredients
  };
  if (existing) {
    const idx = db.recipes.findIndex(r => r.id === existing.id);
    db.recipes[idx] = recipe;
    saveCache(); refreshRecipesList();
    if (accessToken){
      setSync('syncing','שומר...');
      try{ await updateRow('Recipes', idx+2, recipeToRow(recipe)); setSync('ok','מסונכרן'); toast('המתכון "'+name+'" עודכן ✓','ok'); }
      catch(e){ setSync('err','שגיאה'); toast('שגיאת שמירה: '+((e&&e.result&&e.result.error&&e.result.error.message)||e.message||'unknown'),'err'); console.error('saveRecipe failed:',e); }
    } else { toast('נשמר במטמון','ok'); }
  } else {
    db.recipes.push(recipe);
    saveCache(); refreshRecipesList();
    if (accessToken){
      setSync('syncing','שומר...');
      try{ await appendRow('Recipes', recipeToRow(recipe)); setSync('ok','מסונכרן'); toast('המתכון "'+name+'" נשמר ✓','ok'); }
      catch(e){ setSync('err','שגיאה'); toast('שגיאת שמירה: '+((e&&e.result&&e.result.error&&e.result.error.message)||e.message||'unknown'),'err'); console.error('saveRecipe failed:',e); }
    } else { toast('נשמר במטמון','ok'); }
  }
}

function loadRecipe(name){
  if (!name) return;
  const r = db.recipes.find(x => x.name === name);
  if (!r) { toast('לא נמצא','err'); return; }
  document.getElementById('prName').value = r.name;
  document.getElementById('prYield').value = r.yield;
  document.getElementById('prHours').value = r.hours;
  document.getElementById('prRate').value = r.rate;
  applyOverbreakdown(parseOverbreakdown(r.over));
  document.getElementById('prMult').value = r.mult;
  document.getElementById('ingrList').innerHTML='';
  // normalizeIngr inside addIngrRow handles both old {n,q,u,p} and new shapes.
  (r.ingredients||[]).forEach(ing => addIngrRow(ing));
  if (!r.ingredients || r.ingredients.length===0) for (let i=0;i<3;i++) addIngrRow();
  calcPricing();
  toast('נטען: '+name,'ok');
}

async function deleteRecipe(){
  const name = document.getElementById('prName').value.trim();
  if (!name) { toast('בחר/י קודם מתכון לטעון','err'); return; }
  if (!confirm('למחוק את המתכון "'+name+'"?')) return;
  const idx = db.recipes.findIndex(r => r.name === name);
  if (idx < 0) { toast('לא נמצא','err'); return; }
  db.recipes.splice(idx,1);
  saveCache(); refreshRecipesList(); clearPricing();
  if (accessToken){
    try{
      await gapi.client.sheets.spreadsheets.batchUpdate({spreadsheetId:SHEET_ID,resource:{requests:[{deleteDimension:{range:{sheetId:await getSheetId('Recipes'),dimension:'ROWS',startIndex:idx+1,endIndex:idx+2}}}]}});
      toast('המתכון נמחק','ok');
    } catch(e){ console.error(e); toast('שגיאת מחיקה','err'); }
  }
}

function refreshRecipesList(){
  const sel = document.getElementById('recipeLoad');
  if (!sel) return;
  const names = (db.recipes||[]).map(r=>r.name).sort();
  sel.innerHTML = '<option value="">-- טען מתכון שמור --</option>' + names.map(n=>`<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');
}

/* ============ HELPERS ============ */
function closeModal(id){document.getElementById(id).classList.remove('show');}
function toast(msg,kind){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show '+(kind||'');setTimeout(()=>t.classList.remove('show'),2500);}
function esc(s){return String(s||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
function uid(p){return p+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);}

/* ============ AI ASSISTANT (chat) ============ */
let _asstHistory = [];   // [{role:'user'|'assistant'|'sys', content}]
let _asstInited = false;
let _asstBusy = false;

function initAssistant(){
  if (_asstInited) return;
  _asstInited = true;
  asstRender();
  asstAddBot('היי קרן 🍪 איך אפשר לעזור? אפשר לשאול אותי על האתר, על המלאי או על ההגדרות, לדבר 🎙️ או לצרף צילום מסך 🖼️ — או לבקש לשנות משהו.');
  // הדבקת תמונה (Ctrl+V) ישירות לצ'אט
  const inp=document.getElementById('asstInput');
  if(inp && !inp._pasteWired){ inp._pasteWired=true; inp.addEventListener('paste',(e)=>{
    const items=(e.clipboardData&&e.clipboardData.items)||[];
    for(const it of items){ if(it.type && it.type.indexOf('image')===0){ const f=it.getAsFile(); if(f){ e.preventDefault(); asstSetImage(f); break; } } }
  }); }
}

// מרנדר מרקדאון בסיסי בבטחה (מודגש, קישורים, שורות) — קודם בריחה, ואז המרה.
function asstMd(s){
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--p);text-decoration:underline">$1</a>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\n/g, '<br>');
  return h;
}
function asstContentHtml(m){
  if (Array.isArray(m.content)){
    return m.content.map(b=>{
      if(b && b.type==='image' && b.source) return '<img class="chatimg" src="data:'+b.source.media_type+';base64,'+b.source.data+'">';
      if(b && b.type==='text') return m.role==='assistant' ? asstMd(b.text) : esc(b.text).replace(/\n/g,'<br>');
      return '';
    }).join('');
  }
  return m.role==='assistant' ? asstMd(m.content) : esc(m.content).replace(/\n/g,'<br>');
}
function asstRender(){
  const box = document.getElementById('asstMsgs');
  if (!box) return;
  box.innerHTML = _asstHistory.map(m=>{
    const cls = m.role==='user' ? 'me' : (m.role==='sys' ? 'sys' : 'bot');
    return '<div class="asst-b '+cls+'">'+asstContentHtml(m)+'</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function asstAddBot(text){ _asstHistory.push({role:'assistant', content:text}); asstRender(); }
function asstAddSys(text){ _asstHistory.push({role:'sys', content:text}); asstRender(); }

function asstQuick(q){
  const inp = document.getElementById('asstInput');
  if (inp) inp.value = q;
  sendAssistantMessage();
}

// צילום-מצב קומפקטי של הנתונים שהמוח צריך כדי לענות ולפעול.
function buildAssistantSnapshot(){
  const products = (db.products||[]).filter(p=>p.id!=='__settings__').map(p=>({
    id:p.id, name:p.name, price:p.price, qty:p.qty, published:!!p.published,
    kosher:p.kosher, unit:p.unit, sortOrder:p.sortOrder, minOrder:p.minOrder,
    flavors:p.flavors||''
  }));
  const s = Object.assign({}, DEFAULT_SETTINGS, db.settings||{});
  let hours, overrides;
  try { hours = JSON.parse(s.hours); } catch(e){ hours = null; }
  try { overrides = JSON.parse(s.overrides); } catch(e){ overrides = []; }
  return {
    settings: {
      acceptingOrders: isAcceptingValue(s.acceptingOrders),
      leadDays: parseInt(s.leadDays,10)||0,
      closedMessage: s.closedMessage||'',
      hours: hours, overrides: overrides
    },
    products: products,
    dayNames: ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'],
    today: todayStr()
  };
}

async function sendAssistantMessage(){
  if (_asstBusy) return;
  const inp = document.getElementById('asstInput');
  if (!inp) return;
  const text = (inp.value||'').trim();
  const img = _asstPendingImg;
  if (!text && !img) return;
  inp.value = '';
  let content;
  if (img){
    content = [{ type:'image', source:{ type:'base64', media_type:img.mediaType, data:img.data } },
               { type:'text', text: text || 'מה את/ה רואה בצילום הזה? עזרי לי לפי מה שרואים.' }];
  } else { content = text; }
  asstClearImage();
  _asstHistory.push({role:'user', content});
  asstRender();
  asstSetBusy(true);
  asstShowTyping(true);
  try {
    const ok = await ensureToken();
    if (!ok || !accessToken){ asstShowTyping(false); asstAddSys('צריך להתחבר מחדש לגוגל כדי שאוכל לעבוד. רענני (F5) והתחברי שוב.'); asstSetBusy(false); return; }
    const apiMsgs = _asstHistory.filter(m=>m.role==='user'||m.role==='assistant').map(m=>({role:m.role, content:m.content}));
    const resp = await fetch(AGENT_URL.replace(/\/$/,'') + '/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+accessToken },
      body: JSON.stringify({ messages: apiMsgs, snapshot: buildAssistantSnapshot() })
    });
    asstShowTyping(false);
    if (!resp.ok){
      let msg = 'שגיאה ('+resp.status+').';
      if (resp.status===401||resp.status===403) msg = 'אין לי הרשאה כרגע. רענני והתחברי מחדש.';
      else if (resp.status>=500) msg = 'המוח לא זמין כרגע, נסי שוב עוד רגע.';
      asstAddSys(msg); asstSetBusy(false); return;
    }
    const data = await resp.json();
    if (data.reply) asstAddBot(data.reply);
    if (data.pendingActions && data.pendingActions.actions && data.pendingActions.actions.length){
      asstShowConfirm(data.pendingActions);
    }
    if (data.pendingCode && data.pendingCode.edits && data.pendingCode.edits.length){
      asstShowCodeConfirm(data.pendingCode, data.codeEnabled);
    }
  } catch(e){
    asstShowTyping(false);
    asstAddSys('לא הצלחתי להתחבר למוח. בדקי חיבור אינטרנט ונסי שוב.');
    console.error('[assistant]', e);
  } finally {
    asstSetBusy(false);
  }
}

function asstSetBusy(b){ _asstBusy=b; const btn=document.getElementById('asstSend'); if(btn) btn.disabled=b; }
let _asstTypingTimer=null;
function asstShowTyping(on){
  const box=document.getElementById('asstMsgs'); if(!box) return;
  let t=document.getElementById('asstTyping');
  if(on){
    if(!t){ t=document.createElement('div'); t.id='asstTyping'; t.className='asst-typing'; t.textContent='כותב/ת...'; box.appendChild(t);}
    box.scrollTop=box.scrollHeight;
    clearTimeout(_asstTypingTimer);
    // אם זה לוקח זמן — כנראה מחפש/ת באינטרנט; להראות שזה עובד.
    _asstTypingTimer=setTimeout(()=>{ const e=document.getElementById('asstTyping'); if(e) e.textContent='מחפש/ת מידע… (כמה שניות)'; }, 5000);
  } else {
    clearTimeout(_asstTypingTimer);
    if(t){ t.remove(); }
  }
}

// ---- הקלטה קולית (זיהוי דיבור מובנה של הדפדפן, עברית) ----
let _asstRec=null, _asstRecording=false, _asstRecBase='';
function asstMicSupported(){ return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window); }
function asstMicUI(on){ const b=document.getElementById('asstMic'); if(b){ b.classList.toggle('rec',on); b.textContent= on?'⏹️':'🎙️'; } }
function asstStopMic(){ if(_asstRec){ try{ _asstRec.stop(); }catch(e){} } _asstRecording=false; asstMicUI(false); }
function toggleAsstMic(){
  if(!asstMicSupported()){
    initAssistant();
    asstAddSys('הקלטה קולית לא נתמכת בדפדפן הזה. נסי בכרום במחשב או באנדרואיד (אם את על אייפון — תגידו לטל ונוסיף תמיכה).');
    return;
  }
  if(_asstRecording){ asstStopMic(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang='he-IL'; r.continuous=true; r.interimResults=true;
  const inp=document.getElementById('asstInput');
  _asstRecBase = inp && inp.value ? inp.value.replace(/\s+$/,'')+' ' : '';
  let finalText='';
  r.onresult=(e)=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText+=t+' '; else interim+=t;
    }
    if(inp) inp.value = _asstRecBase + finalText + interim;
  };
  r.onerror=(e)=>{ const err=e&&e.error; asstStopMic(); if(err && err!=='no-speech' && err!=='aborted'){ initAssistant(); asstAddSys('בעיה בהקלטה: '+(err==='not-allowed'?'אין הרשאת מיקרופון — אשרי גישה למיקרופון בדפדפן':err)); } };
  r.onend=()=>{ _asstRecording=false; _asstRec=null; asstMicUI(false); };
  _asstRec=r; _asstRecording=true; asstMicUI(true);
  try{ r.start(); }catch(e){ _asstRecording=false; _asstRec=null; asstMicUI(false); }
}

// ---- צירוף צילום מסך / תמונה (Claude קורא אותה) ----
let _asstPendingImg=null; // {data(base64), mediaType, dataUrl}
function asstResizeImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      const max=1400; if(w>max||h>max){ const s=Math.min(max/w,max/h); w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s)); }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const dataUrl=c.toDataURL('image/jpeg',0.85);
      resolve({ data:dataUrl.split(',')[1], mediaType:'image/jpeg', dataUrl });
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src=url;
  });
}
async function asstSetImage(file){
  try{
    if(!file || !/^image\//.test(file.type||'')) return;
    const r=await asstResizeImage(file);
    _asstPendingImg=r;
    const prev=document.getElementById('asstImgPreview');
    if(prev){ prev.style.display='flex'; prev.innerHTML='<img src="'+r.dataUrl+'"><span style="flex:1;font-size:13px;color:var(--ink2)">צילום מצורף — יישלח עם ההודעה</span><button type="button" onclick="asstClearImage()">הסר</button>'; }
    const inp=document.getElementById('asstInput'); if(inp) inp.focus();
  }catch(e){ initAssistant(); asstAddSys('לא הצלחתי לקרוא את התמונה. נסי קובץ אחר.'); }
}
function asstClearImage(){
  _asstPendingImg=null;
  const prev=document.getElementById('asstImgPreview');
  if(prev){ prev.style.display='none'; prev.innerHTML=''; }
}

// כרטיס אישור: אישור → מבצע; ביטול → מודיע שבוטל.
function asstShowConfirm(pending){
  const box=document.getElementById('asstMsgs'); if(!box) return;
  const div=document.createElement('div');
  div.className='asst-confirm';
  div.innerHTML = '<div class="q">'+esc(pending.summary||'לבצע את השינוי?')+'</div>'+
    '<div class="acts">'+
      '<button class="btn btn-ok" type="button">✓ אשרי וביצוע</button>'+
      '<button class="btn btn-s" type="button">ביטול</button>'+
    '</div>';
  const btns = div.querySelectorAll('button');
  btns[0].onclick = async ()=>{ div.remove(); await applyAssistantActions(pending); };
  btns[1].onclick = ()=>{ div.remove(); asstAddSys('בוטל — לא שונה כלום.'); };
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// מבצע את הפעולות המאושרות דרך הפונקציות הקיימות (עם ההרשאה של קרן).
async function applyAssistantActions(pending){
  const actions = pending.actions||[];
  const done = [];
  try {
    for (const a of actions){
      if (a.type==='order_settings'){ await applyAsstSettings(a); done.push('הגדרות הזמנות'); }
      else if (a.type==='product_update'){ const nm = await applyAsstProduct(a); done.push('מוצר: '+nm); }
    }
    asstAddSys('✓ בוצע: '+done.join(' · '));
  } catch(e){
    console.error('[assistant apply]', e);
    asstAddSys('⚠️ '+(e.message||'משהו השתבש בביצוע')+(done.length?(' (כן בוצע: '+done.join(', ')+')'):''));
  }
}

// הגדרות הזמנות — ממלא את הטופס ומריץ את saveOrderSettings הקיים (מיזוג עם המצב הנוכחי).
async function applyAsstSettings(a){
  renderSettings();
  if (a.acceptingOrders!=null){ const el=document.getElementById('setAccepting'); if(el) el.checked=!!a.acceptingOrders; }
  if (a.leadDays!=null){ const el=document.getElementById('setLeadDays'); if(el) el.value=String(Math.max(0,parseInt(a.leadDays,10)||0)); }
  if (a.closedMessage!=null){ const el=document.getElementById('setClosedMsg'); if(el) el.value=String(a.closedMessage); }
  if (Array.isArray(a.days)){
    a.days.forEach(d=>{
      const row=document.querySelector('#hoursRows .hours-row[data-day="'+(d.day)+'"]');
      if(!row) return;
      if(d.open!=null) row.querySelector('.h-open').checked=!!d.open;
      if(d.from) row.querySelector('.h-from').value=d.from;
      if(d.to) row.querySelector('.h-to').value=d.to;
    });
  }
  if (Array.isArray(a.specialDates)){
    a.specialDates.forEach(o=>{
      if(!o.date) return;
      _overrides=(_overrides||[]).filter(x=>x.date!==o.date);
      _overrides.push({date:o.date, open:!!o.open});
    });
    renderOverridesList();
  }
  await saveOrderSettings();
}

// מוצר — מאתר לפי id/שם ומעדכן ישירות דרך persistProductRow הקיים.
async function applyAsstProduct(a){
  const list=(db.products||[]).filter(p=>p.id!=='__settings__');
  let p = a.productId ? list.find(x=>x.id===a.productId) : null;
  if (!p && a.productName){
    const nm=String(a.productName).trim();
    p = list.find(x=>x.name===nm) || list.find(x=>String(x.name).includes(nm)) || list.find(x=>nm.includes(String(x.name)));
  }
  if (!p) throw new Error('לא מצאתי את המוצר "'+(a.productName||a.productId||'')+'"');
  const set=a.set||{};
  if (set.price!=null){ const v=parseFloat(set.price); if(v>0) p.price=v; }
  if (set.unit!=null) p.unit=String(set.unit);
  if (set.desc!=null) p.desc=String(set.desc);
  if (set.kosher!=null) p.kosher=String(set.kosher);
  if (set.sortOrder!=null) p.sortOrder=parseInt(set.sortOrder,10)||p.sortOrder;
  if (set.minOrder!=null){ p.minOrder=Math.max(0,parseInt(set.minOrder,10)||0); p.minNote=p.minOrder>0?('* מינימום להזמנה '+p.minOrder+' יח׳'):''; }
  if (set.published!=null) p.published = set.published?1:0;
  if (set.qty!=null){
    const flavors=parseFlavors(p.flavors,p.qty);
    if(!flavors.length) p.qty=Math.max(0,parseInt(set.qty,10)||0);
    else asstAddSys('שמתי לב ש"'+p.name+'" מחולק לטעמים — את הכמות הכוללת לא שיניתי. עדכני טעם ספציפי דרך מסך המוצרים.');
  }
  p.updatedAt=new Date().toISOString();
  saveCache(); renderProducts();
  await persistProductRow(p);
  return p.name;
}

// ---- שלב 2: שינוי קוד קל + החזרה אחורה ----
async function asstPost(path, body){
  const ok = await ensureToken();
  if (!ok || !accessToken) throw new Error('צריך להתחבר מחדש לגוגל');
  const resp = await fetch(AGENT_URL.replace(/\/$/,'') + path, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+accessToken },
    body: JSON.stringify(body||{})
  });
  let data={}; try{ data=await resp.json(); }catch(e){}
  return { status: resp.status, data };
}

function asstShowCodeConfirm(pending, codeEnabled){
  const box=document.getElementById('asstMsgs'); if(!box) return;
  const div=document.createElement('div');
  div.className='asst-confirm';
  if (codeEnabled === false){
    div.innerHTML = '<div class="q">✏️ '+esc(pending.summary||'שינוי בקוד')+'</div>'+
      '<div style="font-size:13px;color:var(--mute)">עריכת קוד עוד לא חוברה (ממתין שטל יוסיף טוקן GitHub). בינתיים אפשר לשנות הגדרות ומוצרים.</div>';
    box.appendChild(div); box.scrollTop=box.scrollHeight; return;
  }
  div.innerHTML = '<div class="q">✏️ שינוי בקוד האתר: '+esc(pending.summary||'')+'</div>'+
    '<div style="font-size:12px;color:var(--mute);margin-bottom:8px">'+esc((pending.edits||[]).map(e=>e.path).join(', '))+'</div>'+
    '<div class="acts">'+
      '<button class="btn btn-ok" type="button">✓ אשרי ושנה</button>'+
      '<button class="btn btn-s" type="button">ביטול</button>'+
    '</div>';
  const btns=div.querySelectorAll('button');
  btns[0].onclick=async ()=>{ div.remove(); await asstApplyCode(pending); };
  btns[1].onclick=()=>{ div.remove(); asstAddSys('בוטל — הקוד לא שונה.'); };
  box.appendChild(div); box.scrollTop=box.scrollHeight;
}

async function asstApplyCode(pending){
  asstAddSys('משנה את הקוד...');
  try {
    const { status, data } = await asstPost('/api/apply-code', { summary: pending.summary, edits: pending.edits });
    if (data && data.ok){
      asstAddSys('✓ '+(data.message||'השינוי נדחף.')+' ('+((data.changedFiles||[]).join(', '))+')');
      asstVerifyDeploy();
    } else {
      asstAddSys('⚠️ '+((data && (data.message||data.error)) || ('שגיאה '+status))+'. לא שונה כלום.');
    }
  } catch(e){ asstAddSys('⚠️ '+(e.message||'שגיאת רשת')); }
}

// בדיקה שהאתר עדיין נטען אחרי השינוי (GitHub Pages לוקח ~דקה). אם נראה שבור — החזרה אוטומטית.
async function asstVerifyDeploy(){
  asstAddSys('בודק שהאתר נטען כשורה (כדקה)...');
  let okSite=false;
  for (const waitMs of [70000, 28000]){
    await new Promise(r=>setTimeout(r, waitMs));
    try {
      const r = await fetch('/index.html?cb='+Date.now(), { cache:'no-store' });
      const t = await r.text();
      if (r.ok && /<\/html>/i.test(t) && /Carmel/i.test(t)) { okSite=true; break; }
    } catch(e){ /* ננסה שוב */ }
  }
  if (okSite){ asstAddSys('✓ האתר נטען כרגיל. אם משהו לא נראה לך — אפשר תמיד "↩️ החזר".'); }
  else { asstAddSys('⚠️ האתר לא נראה תקין אחרי השינוי — מחזיר אוטומטית למצב הקודם...'); await asstRollback(true); }
}

async function asstRollback(auto){
  if (!auto) asstAddSys('מחזיר את האתר למצב לפני שינוי-הקוד האחרון...');
  try {
    const { status, data } = await asstPost('/api/rollback', {});
    if (data && data.ok) asstAddSys('↩️ '+(data.message||'הוחזר למצב הקודם.'));
    else asstAddSys('ℹ️ '+((data && (data.message||data.error)) || ('לא הוחזר ('+status+')')));
  } catch(e){ asstAddSys('⚠️ '+(e.message||'שגיאת רשת בהחזרה')); }
}
function todayStr(){return new Date().toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function addDaysStr(s,n){const d=new Date(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function isoDate(d){return d.toISOString().slice(0,10);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function stLabel(id){const s=STATUSES.find(x=>x.id===id);return s?s.label:id;}
