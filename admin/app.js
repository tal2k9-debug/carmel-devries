/* Carmel De-vries Admin - Google Sheets + Sign-in version */
const CLIENT_ID = '564598491904-8afmllpcgue97fd0hrht9ejkjut70m6f.apps.googleusercontent.com';
const SHEET_ID = '1NOdPG_jdhVfD_Du24E6i3fWTOjPSqfoarJ1tkq6OIRk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const ALLOWLIST = ['tal2k9@gmail.com', 'kerencarmel8@gmail.com'];
const CACHE_KEY = 'carmel_cache_v2';
const PRICING_KEY = 'carmel_pricing_v1';
const STATUSES = [
  {id:'new', label:'חדש', color:'new'},
  {id:'confirmed', label:'מאושר', color:'confirmed'},
  {id:'baking', label:'באפייה', color:'baking'},
  {id:'ready', label:'מוכן', color:'ready'},
  {id:'delivered', label:'נמסר', color:'delivered'}
];
const PRODUCTS = [
  {id:'maroc', n:'עוגיות מכונה מרוקאיות', price:55},
  {id:'choco', n:'כדורי שוקולד', price:4, flavors:['קוקוס','סוכריות']},
  {id:'rolled', n:'מגולגלות במילויים', price:75, flavors:['פיסטוק','קינדר','נוטלה']},
  {id:'tahini', n:'עוגיות טחינה', price:55},
  {id:'butter', n:'עוגיות חמאה שקדים', price:35},
  {id:'yoyo', n:'עוגיות יויו', price:4}
];

let tokenClient, accessToken=null, user=null;
let db = {customers:[], orders:[], expenses:[]};
let calCursor = new Date();
let editingCustId=null, editingExpId=null;
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
    error_callback: (err) => { console.error('[Carmel] oauth error', err); showLoginError('שגיאת הרשאות: ' + (err.type || err.message || JSON.stringify(err))); }
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
    showApp();
  } catch(e) {
    console.error('[Carmel] userinfo failed', e);
    showLoginError('שגיאה בטעינת פרופיל: ' + e.message);
  }
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
    await ensureExpensesTab();
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

async function ensureExpensesTab() {
  try {
    const meta = await gapi.client.sheets.spreadsheets.get({spreadsheetId: SHEET_ID});
    const sheets = meta.result.sheets.map(s=>s.properties.title);
    if (!sheets.includes('Expenses')) {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {requests:[{addSheet:{properties:{title:'Expenses'}}}]}
      });
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: 'Expenses!A1:F1',
        valueInputOption: 'RAW',
        resource: {values:[['id','date','category','description','amount','vendor']]}
      });
    }
  } catch(e){ console.warn('ensureExpensesTab', e); }
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
    const [cust, ord, exp] = await Promise.all([
      readRange('Customers!A2:H'),
      readRange('Orders!A2:L'),
      readRange('Expenses!A2:F').catch(()=>[])
    ]);
    db.customers = cust.map(r => rowToCust(r));
    db.orders = ord.map(r => rowToOrder(r));
    db.expenses = exp.map(r => rowToExp(r));
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
  } catch(e){}
}
function saveCache(){ localStorage.setItem(CACHE_KEY, JSON.stringify(db)); }

function rowToCust(r){ return {id:r[0]||'', name:r[1]||'', phone:r[2]||'', address:r[3]||'', allergies:r[4]||'', notes:r[5]||'', createdAt:r[6]||'', lastOrder:r[7]||''}; }
function custToRow(c){ return [c.id, c.name, c.phone, c.address, c.allergies, c.notes, c.createdAt, c.lastOrder]; }
function rowToOrder(r){ return {id:r[0]||'', customerId:r[1]||'', name:r[2]||'', phone:r[3]||'', address:r[4]||'', fulfillment:r[5]||'pickup', date:r[6]||'', items:r[7]||'', notes:r[8]||'', status:r[9]||'new', createdAt:r[10]||'', updatedAt:r[11]||''}; }
function orderToRow(o){ return [o.id, o.customerId, o.name, o.phone, o.address, o.fulfillment, o.date, o.items, o.notes, o.status, o.createdAt, o.updatedAt]; }
function rowToExp(r){ return {id:r[0]||'', date:r[1]||'', category:r[2]||'', description:r[3]||'', amount:parseFloat(r[4])||0, vendor:r[5]||''}; }
function expToRow(e){ return [e.id, e.date, e.category, e.description, String(e.amount), e.vendor]; }

/* ============ UI BINDING ============ */
function bindUI() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.page));
  document.getElementById('oFulfill').onchange = (e) => {
    document.getElementById('addrField').style.display = e.target.value === 'delivery' ? 'block' : 'none';
  };
  document.getElementById('custSearch').oninput = renderCustomers;
  // Init pricing rows
  for (let i=0; i<5; i++) addIngrRow();
  // Init P&L month select
  initMonthSelect();
}

function switchTab(page) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page===page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id==='page-'+page));
  if (page==='calendar') renderCalendar();
  if (page==='pnl') renderPL();
  if (page==='expenses') renderExpenses();
  if (page==='shopping') generateShoppingList();
}

function renderAll() {
  renderToday(); renderKanban(); renderCustomers();
  if (document.getElementById('page-calendar').classList.contains('active')) renderCalendar();
  if (document.getElementById('page-pnl').classList.contains('active')) renderPL();
  if (document.getElementById('page-expenses').classList.contains('active')) renderExpenses();
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

function orderTotal(o) {
  // Rough estimate: try to parse numeric prefixes from items text
  let total = 0;
  if (!o.items) return 0;
  const lines = o.items.split(/[,\n]/);
  lines.forEach(line => {
    const m = line.match(/(\d+)\s*(מארז|יח׳?|כדור|יחידות)?/);
    if (!m) return;
    const qty = parseInt(m[1]);
    const lt = line.toLowerCase();
    for (const p of PRODUCTS) {
      if (lt.includes(p.n.slice(0,4)) || (p.id==='maroc' && lt.includes('מרוק')) || (p.id==='choco' && lt.includes('שוקול')) || (p.id==='rolled' && lt.includes('מגולגל')) || (p.id==='tahini' && lt.includes('טחינ')) || (p.id==='butter' && (lt.includes('חמאה')||lt.includes('שקד'))) || (p.id==='yoyo' && lt.includes('יויו'))) {
        total += qty * p.price;
        return;
      }
    }
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
  return `<div class="kcard ${cls}" draggable="true" ondragstart="event.dataTransfer.setData('id','${o.id}');this.classList.add('dragging')" ondragend="this.classList.remove('dragging')" onclick="showOrder('${o.id}')">
    <div class="n">${esc(o.name)}</div>
    <div class="d">📅 ${esc(o.date)} · ${o.fulfillment==='delivery'?'🚚 משלוח':'🏠 איסוף'}</div>
    <div class="it">${esc(o.items.slice(0,80))}${o.items.length>80?'...':''}</div>
    <div class="ph">📞 ${esc(o.phone)}</div>
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
  if (!accessToken) { toast('נשמר במטמון בלבד','err'); return; }
  setSync('syncing', 'שומר...');
  try {
    await updateRow('Orders', idx + 2, orderToRow(o));
    setSync('ok', 'מסונכרן');
  } catch(e) { console.error(e); setSync('err','שגיאת שמירה'); }
}

/* ============ ORDER DETAIL ============ */
function showOrder(id) {
  const o = db.orders.find(x => x.id === id); if (!o) return;
  document.getElementById('omTitle').textContent = 'הזמנה: ' + o.name;
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
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      ${STATUSES.map(s=>`<button class="btn ${o.status===s.id?'btn-p':'btn-s'}" onclick="setOrderStatus('${o.id}','${s.id}')">${s.label}</button>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <a class="btn btn-s" href="https://wa.me/${o.phone.replace(/\D/g,'')}" target="_blank">📱 WhatsApp</a>
      <button class="btn btn-d" onclick="deleteOrder('${o.id}')">🗑 מחק</button>
    </div>`;
  document.getElementById('orderModal').classList.add('show');
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
    if (accessToken) { setSync('syncing','שומר...'); try{ await updateRow('Customers', idx+2, custToRow(c)); setSync('ok','מסונכרן'); toast('עודכן','ok'); }catch(e){setSync('err','שגיאה');} }
  } else {
    db.customers.push(c);
    saveCache(); closeModal('custModal'); renderCustomers();
    if (accessToken) { setSync('syncing','שומר...'); try{ await appendRow('Customers', custToRow(c)); setSync('ok','מסונכרן'); toast('נשמר','ok'); }catch(e){setSync('err','שגיאה');} }
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
  if (accessToken) {
    setSync('syncing','שומר...');
    try {
      if (isNewCust) await appendRow('Customers', custToRow(c));
      else {
        const ci=db.customers.findIndex(x=>x.id===c.id);
        await updateRow('Customers', ci+2, custToRow(c));
      }
      await appendRow('Orders', orderToRow(o));
      setSync('ok','מסונכרן'); toast('הזמנה נשמרה ✓','ok');
    } catch(e){ console.error(e); setSync('err','שגיאת שמירה'); }
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
function addIngrRow() {
  const div=document.createElement('div');
  div.className='pricing-row';
  div.innerHTML=`<input placeholder="מצרך" class="ingr-name"><input type="number" placeholder="כמות" step="0.01" class="ingr-qty"><input placeholder="ק״ג/יח׳" class="ingr-unit" value="ק״ג"><input type="number" placeholder="₪/יח׳" step="0.01" class="ingr-price"><button class="btn btn-d" style="padding:6px 10px" onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById('ingrList').appendChild(div);
}
function clearPricing(){ document.getElementById('ingrList').innerHTML=''; for(let i=0;i<5;i++)addIngrRow(); document.getElementById('prSummary').innerHTML=''; ['prName','prYield','prHours'].forEach(i=>document.getElementById(i).value=i==='prYield'?'30':i==='prHours'?'2':''); }
function calcPricing() {
  const rows=document.querySelectorAll('#ingrList .pricing-row');
  let ingredCost=0; const items=[];
  rows.forEach(r=>{
    const n=r.querySelector('.ingr-name').value.trim();
    const q=parseFloat(r.querySelector('.ingr-qty').value)||0;
    const u=r.querySelector('.ingr-unit').value;
    const p=parseFloat(r.querySelector('.ingr-price').value)||0;
    if(n&&q&&p){ const c=q*p; ingredCost+=c; items.push({n,q,u,p,c}); }
  });
  const hours=parseFloat(document.getElementById('prHours').value)||0;
  const rate=parseFloat(document.getElementById('prRate').value)||0;
  const labor=hours*rate;
  const overPct=parseFloat(document.getElementById('prOver').value)||0;
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

/* ============ SHOPPING LIST ============ */
function generateShoppingList(){
  // From open orders, estimate ingredients
  const open=db.orders.filter(o=>o.status==='new'||o.status==='confirmed'||o.status==='baking');
  if(!open.length){document.getElementById('shopList').innerHTML='<div style="color:var(--mute);text-align:center;padding:20px">אין הזמנות פתוחות</div>';return;}
  // Aggregate by product
  const tally={};
  open.forEach(o=>{
    const lines=(o.items||'').split(/[,\n]/);
    lines.forEach(line=>{
      const m=line.match(/(\d+)\s*(מארז|יח׳?|כדור|יחידות)?/);
      if(!m)return;
      const qty=parseInt(m[1]);
      const lt=line.toLowerCase();
      for(const p of PRODUCTS){
        if(lt.includes(p.n.slice(0,4))||(p.id==='maroc'&&lt.includes('מרוק'))||(p.id==='choco'&&lt.includes('שוקול'))||(p.id==='rolled'&&lt.includes('מגולגל'))||(p.id==='tahini'&&lt.includes('טחינ'))||(p.id==='butter'&&(lt.includes('חמאה')||lt.includes('שקד')))||(p.id==='yoyo'&&lt.includes('יויו'))){
          tally[p.id]=(tally[p.id]||0)+qty; return;
        }
      }
    });
  });
  // Estimate ingredients per product (rough)
  const INGRED = {
    maroc: [{n:'קמח',u:'ק״ג',per:0.012},{n:'סוכר',u:'ק״ג',per:0.008},{n:'מרגרינה',u:'ק״ג',per:0.01},{n:'ביצים',u:'יח׳',per:0.03}],
    choco: [{n:'ביסקויטים',u:'ק״ג',per:0.02},{n:'קקאו',u:'ק״ג',per:0.005},{n:'חלב מרוכז',u:'יח׳',per:0.02},{n:'קוקוס/סוכריות',u:'ק״ג',per:0.005}],
    rolled: [{n:'בצק עלים',u:'ק״ג',per:0.05},{n:'מילוי (פיסטוק/קינדר/נוטלה)',u:'ק״ג',per:0.03},{n:'ביצים',u:'יח׳',per:0.5}],
    tahini: [{n:'קמח',u:'ק״ג',per:0.012},{n:'טחינה',u:'ק״ג',per:0.015},{n:'סוכר',u:'ק״ג',per:0.008}],
    butter: [{n:'קמח',u:'ק״ג',per:0.015},{n:'חמאה',u:'ק״ג',per:0.012},{n:'שקדים',u:'ק״ג',per:0.008},{n:'אבקת סוכר',u:'ק״ג',per:0.005}],
    yoyo: [{n:'קמח',u:'ק״ג',per:0.01},{n:'ריבת חלב',u:'ק״ג',per:0.005},{n:'שמן',u:'ל׳',per:0.005}]
  };
  const need={};
  Object.entries(tally).forEach(([pid,qty])=>{
    (INGRED[pid]||[]).forEach(ing=>{
      const key=ing.n+'|'+ing.u;
      need[key]=(need[key]||0)+(qty*ing.per);
    });
  });
  // Group products and ingredients
  let html=`<div class="shop-grp"><h3>📦 מוצרים להכין</h3><ul>`;
  Object.entries(tally).forEach(([pid,qty])=>{
    const p=PRODUCTS.find(x=>x.id===pid);
    html+=`<li><span><strong>${p?p.n:pid}</strong></span><span>${qty} ${pid==='choco'||pid==='yoyo'?'יח׳':'מארזים'}</span></li>`;
  });
  html+=`</ul></div><div class="shop-grp"><h3>🛒 מצרכים לקנות (אומדן)</h3><ul>`;
  Object.entries(need).sort().forEach(([key,amt])=>{
    const [n,u]=key.split('|');
    html+=`<li><span>${n}</span><span><strong>${amt.toFixed(2)} ${u}</strong></span></li>`;
  });
  html+=`</ul></div><div style="background:#fff3e0;padding:12px;border-radius:8px;font-size:13px;color:var(--ink2)">💡 האומדנים הם ממוצעים כלליים. בדקי את המתכון שלך לפני קנייה.</div>`;
  document.getElementById('shopList').innerHTML=html;
}

function copyShoppingList(){
  const txt=document.getElementById('shopList').innerText;
  navigator.clipboard.writeText(txt).then(()=>toast('הועתק ✓','ok'));
}

/* ============ HELPERS ============ */
function closeModal(id){document.getElementById(id).classList.remove('show');}
function toast(msg,kind){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show '+(kind||'');setTimeout(()=>t.classList.remove('show'),2500);}
function esc(s){return String(s||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
function uid(p){return p+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);}
function todayStr(){return new Date().toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function addDaysStr(s,n){const d=new Date(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function isoDate(d){return d.toISOString().slice(0,10);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function stLabel(id){const s=STATUSES.find(x=>x.id===id);return s?s.label:id;}
