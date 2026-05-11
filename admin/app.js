// =============================================
// Carmel De-vries Admin Dashboard
// =============================================
const PASSWORD='carmel2026';
const STORE_KEY='carmel_admin_v1';

// === Products catalog (matches main site) ===
const PRODUCTS=[
  {id:'maroc',name:'עוגיות מכונה מרוקאיות',price:55,unit:'מארז של כ-30 יח׳',flavors:[]},
  {id:'choco',name:'כדורי שוקולד',price:4,unit:'ליחידה',flavors:['קוקוס','סוכריות']},
  {id:'rolled',name:'מגולגלות במילויים',price:75,unit:'מארז של כ-12 יח׳',flavors:['פיסטוק','קינדר','נוטלה']},
  {id:'tahini',name:'עוגיות טחינה קלאסיות',price:55,unit:'מארז של כ-30 יח׳',flavors:[]},
  {id:'almond',name:'עוגיות חמאה שקדים',price:35,unit:'מארז של כ-11 יח׳',flavors:[]},
  {id:'yoyo',name:'עוגיות יויו',price:4,unit:'ליחידה',flavors:[],minOrder:30}
];
const FEE=10, FREE=150;
const STATUSES=[
  {id:'new',label:'חדש',ic:'🆕',color:'new'},
  {id:'confirmed',label:'אושר',ic:'✓',color:'confirmed'},
  {id:'baking',label:'באפייה',ic:'🔥',color:'baking'},
  {id:'ready',label:'מוכן',ic:'📦',color:'ready'},
  {id:'delivered',label:'נמסר',ic:'🚚',color:'delivered'}
];

// === Data layer ===
let DB={orders:[],customers:[]};

function load(){
  try{const d=localStorage.getItem(STORE_KEY);if(d)DB=JSON.parse(d);}
  catch(e){console.error('load err',e);DB={orders:[],customers:[]};}
  if(!DB.orders)DB.orders=[];
  if(!DB.customers)DB.customers=[];
}
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(DB));}
function uid(){return Date.now().toString(36)+Math.random().toString(36).substr(2,5);}

// === Auth ===
function checkAuth(){
  if(sessionStorage.getItem('carmel_auth')==='1'){
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').style.display='flex';
    init();
  }
}
document.getElementById('gate-btn').onclick=()=>{
  const pw=document.getElementById('gate-pw').value;
  if(pw===PASSWORD){
    sessionStorage.setItem('carmel_auth','1');
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').style.display='flex';
    init();
  }else{
    document.getElementById('gate-err').textContent='סיסמה שגויה';
    document.getElementById('gate-pw').value='';
  }
};
document.getElementById('gate-pw').addEventListener('keypress',e=>{if(e.key==='Enter')document.getElementById('gate-btn').click();});
document.getElementById('logout-btn').onclick=()=>{
  if(confirm('להתנתק מהדשבורד?')){
    sessionStorage.removeItem('carmel_auth');
    location.reload();
  }
};

// === Utils ===
const fmt=n=>Math.round(Number(n)||0).toLocaleString('he-IL');
const fmtNIS=n=>'₪'+fmt(n);
const todayISO=()=>new Date().toISOString().split('T')[0];
function fmtDate(iso){
  if(!iso)return '';
  const d=new Date(iso);
  return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear();
}
function fmtDay(iso){
  if(!iso)return '';
  const days=['א','ב','ג','ד','ה','ו','ש'];
  const d=new Date(iso);
  return 'יום '+days[d.getDay()]+', '+fmtDate(iso);
}
function daysFromNow(iso){
  if(!iso)return 999;
  const t=new Date();t.setHours(0,0,0,0);
  const d=new Date(iso);d.setHours(0,0,0,0);
  return Math.ceil((d-t)/86400000);
}
function toast(msg,ms=2200){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.classList.remove('show'),ms);
}
function calcOrderTotal(o){
  let sub=0;
  (o.items||[]).forEach(it=>{sub+=(it.qty||0)*(it.price||0);});
  const d=o.fulfillment==='pickup'?0:(sub>=FREE||sub===0?0:FEE);
  return {sub,delivery:d,total:sub+d};
}
function setupTodayTitle(){
  const days=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const d=new Date();
  document.getElementById('today-title').textContent='היום · '+'יום '+days[d.getDay()]+', '+fmtDate(d.toISOString());
}

// === Navigation ===
const PAGES=['today','orders','customers','calendar','new-order'];
function goTo(p){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('act',t.dataset.page===p));
  document.querySelectorAll('.page').forEach(pg=>pg.classList.toggle('act',pg.id==='page-'+p));
  if(p==='today')renderToday();
  if(p==='orders')renderKanban();
  if(p==='customers')renderCustomers();
  if(p==='calendar')renderCalendar();
  if(p==='new-order')resetNewOrder();
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>goTo(t.dataset.page));

// === Today screen ===
function renderToday(){
  setupTodayTitle();
  const active=DB.orders.filter(o=>['new','confirmed','baking','ready'].includes(o.status));
  const urgent=active.filter(o=>{const d=daysFromNow(o.date);return d<=2&&d>=0;}).sort((a,b)=>daysFromNow(a.date)-daysFromNow(b.date));
  
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0];
  const monthRevenue=DB.orders.filter(o=>o.status==='delivered'&&o.createdAt>=monthStart).reduce((s,o)=>s+calcOrderTotal(o).total,0);

  document.getElementById('kpi-active').textContent=active.length;
  document.getElementById('kpi-urgent').textContent=urgent.length;
  document.getElementById('kpi-revenue').textContent=fmtNIS(monthRevenue);
  document.getElementById('kpi-customers').textContent=DB.customers.length;
  
  document.getElementById('urgent-list').innerHTML=urgent.length?
    urgent.map(o=>orderCardHTML(o,true)).join(''):
    '<div class="list-empty">אין הזמנות דחופות 🎉</div>';
  document.getElementById('active-list').innerHTML=active.length?
    active.sort((a,b)=>daysFromNow(a.date)-daysFromNow(b.date)).map(o=>orderCardHTML(o)).join(''):
    '<div class="list-empty">אין הזמנות פעילות</div>';
}
function orderCardHTML(o,markUrgent){
  const t=calcOrderTotal(o);
  const days=daysFromNow(o.date);
  let cls='order-card';
  if(markUrgent||days<=1)cls+=' urgent';
  else if(days<=3)cls+=' soon';
  const st=STATUSES.find(s=>s.id===o.status)||STATUSES[0];
  const items=(o.items||[]).slice(0,3).map(i=>i.name+(i.flavor?' ('+i.flavor+')':'')+' × '+i.qty).join('<br>');
  const more=(o.items||[]).length>3?'<br><span class="muted">+'+((o.items||[]).length-3)+' עוד</span>':'';
  let dayLbl=fmtDay(o.date);
  if(days===0)dayLbl='היום · '+dayLbl;
  else if(days===1)dayLbl='מחר · '+dayLbl;
  else if(days===-1)dayLbl='אתמול · '+dayLbl;
  else if(days>0&&days<=7)dayLbl='בעוד '+days+' ימים';
  return '<div class="'+cls+'" onclick="openOrder(\''+o.id+'\')">'+
    '<div class="oc-top"><span class="status-pill '+st.color+'">'+st.ic+' '+st.label+'</span><span class="oc-phone">'+(o.phone||'')+'</span></div>'+
    '<div class="oc-name">'+(o.name||'לקוח')+'</div>'+
    '<div class="oc-date">📅 '+dayLbl+'</div>'+
    '<div class="oc-items">'+items+more+'</div>'+
    '<div class="oc-foot"><span class="oc-fulfill">'+(o.fulfillment==='pickup'?'🏠 איסוף':'🚚 משלוח')+'</span><span class="oc-tot">'+fmtNIS(t.total)+'</span></div>'+
    '</div>';
}

// === Kanban ===
function renderKanban(){
  const html=STATUSES.map(s=>{
    const items=DB.orders.filter(o=>o.status===s.id).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    let cardsHtml=items.length?items.map(o=>kanbanCardHTML(o)).join(''):'<div class="kanban-empty">ריק</div>';
    return '<div class="kanban-col" data-status="'+s.id+'" ondragover="kanbanOver(event)" ondrop="kanbanDrop(event,\''+s.id+'\')">'+
      '<div class="kanban-col-h"><div class="kanban-col-title">'+s.ic+' '+s.label+'</div><div class="kanban-col-count">'+items.length+'</div></div>'+
      cardsHtml+'</div>';
  }).join('');
  document.getElementById('kanban').innerHTML=html;
}
function kanbanCardHTML(o){
  const t=calcOrderTotal(o);
  const days=daysFromNow(o.date);
  let dayLbl=fmtDate(o.date);
  if(days===0)dayLbl='היום';
  else if(days===1)dayLbl='מחר';
  return '<div class="kanban-card" draggable="true" ondragstart="kanbanStart(event,\''+o.id+'\')" ondragend="kanbanEnd(event)" onclick="openOrder(\''+o.id+'\')">'+
    '<div class="kanban-card-name">'+(o.name||'לקוח')+'</div>'+
    '<div class="kanban-card-date">📅 '+dayLbl+'</div>'+
    '<div style="font-size:11px;color:var(--ix);line-height:1.4">'+((o.items||[]).map(i=>i.name.substring(0,15)).slice(0,2).join(', '))+'</div>'+
    '<div class="kanban-card-tot">'+fmtNIS(t.total)+'</div>'+
    '</div>';
}
let _drag=null;
function kanbanStart(e,id){_drag=id;e.dataTransfer.effectAllowed='move';e.target.classList.add('dragging');}
function kanbanOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';}
function kanbanEnd(e){e.target.classList.remove('dragging');}
function kanbanDrop(e,status){
  e.preventDefault();
  if(!_drag)return;
  const o=DB.orders.find(x=>x.id===_drag);
  if(o&&o.status!==status){
    o.status=status;
    o.updatedAt=new Date().toISOString();
    save();renderKanban();
    toast('סטטוס עודכן: '+STATUSES.find(s=>s.id===status).label);
  }
  _drag=null;
}

// === Customers ===
function renderCustomers(){
  const q=document.getElementById('cust-search').value.trim().toLowerCase();
  let list=DB.customers.slice().sort((a,b)=>(b.lastOrder||'').localeCompare(a.lastOrder||''));
  if(q)list=list.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.phone||'').includes(q));
  // enrich with stats
  list.forEach(c=>{
    const orders=DB.orders.filter(o=>o.customerId===c.id);
    c._count=orders.length;
    c._total=orders.reduce((s,o)=>s+calcOrderTotal(o).total,0);
  });
  if(!list.length){
    document.getElementById('cust-list').innerHTML='<div class="list-empty">'+(q?'לא נמצאו תוצאות':'אין לקוחות עדיין')+'</div>';
    return;
  }
  document.getElementById('cust-list').innerHTML=list.map(c=>{
    return '<div class="list-item" onclick="openCustomerModal(\''+c.id+'\')">'+
      '<div class="li-main">'+
        '<div class="li-name">'+(c.name||'')+'</div>'+
        '<div class="li-meta">'+
          '<span>📞 <span dir="ltr">'+(c.phone||'')+'</span></span>'+
          (c.address?'<span>📍 '+c.address+'</span>':'')+
          (c.allergies?'<span>🥜 '+c.allergies+'</span>':'')+
        '</div>'+
        '<div class="li-meta">'+c._count+' הזמנות · אחרונה: '+(c.lastOrder?fmtDate(c.lastOrder):'-')+'</div>'+
      '</div>'+
      '<div class="li-stat">'+fmtNIS(c._total)+'</div>'+
    '</div>';
  }).join('');
}
document.getElementById('cust-search').addEventListener('input',renderCustomers);

let _editingCust=null;
function openCustomerModal(id){
  _editingCust=id||null;
  document.getElementById('cust-modal-title').textContent=id?'עריכת לקוח':'לקוח חדש';
  document.getElementById('cm-del').style.display=id?'inline-flex':'none';
  if(id){
    const c=DB.customers.find(x=>x.id===id);
    if(c){
      document.getElementById('cm-name').value=c.name||'';
      document.getElementById('cm-phone').value=c.phone||'';
      document.getElementById('cm-address').value=c.address||'';
      document.getElementById('cm-allergies').value=c.allergies||'';
      document.getElementById('cm-notes').value=c.notes||'';
      const ords=DB.orders.filter(o=>o.customerId===id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
      document.getElementById('cm-history').innerHTML=ords.length?
        '<div style="font-size:13px;font-weight:600;color:var(--ix);margin-bottom:6px">היסטוריית הזמנות ('+ords.length+'):</div>'+
        ords.slice(0,5).map(o=>'<div style="padding:6px 10px;background:var(--cream);border-radius:6px;font-size:12.5px;margin-bottom:4px;display:flex;justify-content:space-between"><span>'+fmtDate(o.date)+' · '+STATUSES.find(s=>s.id===o.status).label+'</span><span style="font-weight:600">'+fmtNIS(calcOrderTotal(o).total)+'</span></div>').join('')
        :'';
    }
  }else{
    ['cm-name','cm-phone','cm-address','cm-allergies','cm-notes'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('cm-history').innerHTML='';
  }
  document.getElementById('cust-modal').classList.add('show');
}
function closeModal(id){document.getElementById(id).classList.remove('show');}
function saveCustomer(){
  const name=document.getElementById('cm-name').value.trim();
  const phone=document.getElementById('cm-phone').value.trim();
  if(!name){toast('שם חובה');return;}
  const data={
    name,phone,
    address:document.getElementById('cm-address').value.trim(),
    allergies:document.getElementById('cm-allergies').value.trim(),
    notes:document.getElementById('cm-notes').value.trim()
  };
  if(_editingCust){
    Object.assign(DB.customers.find(c=>c.id===_editingCust),data);
    toast('לקוח עודכן');
  }else{
    data.id=uid();data.createdAt=new Date().toISOString();
    DB.customers.push(data);
    toast('לקוח נוסף');
  }
  save();closeModal('cust-modal');renderCustomers();
}
function deleteCustomer(){
  if(!_editingCust)return;
  if(!confirm('למחוק את הלקוח? לא ניתן לשחזר.'))return;
  DB.customers=DB.customers.filter(c=>c.id!==_editingCust);
  save();closeModal('cust-modal');renderCustomers();
  toast('לקוח נמחק');
}

// === Calendar ===
let _calWeek=0; // 0 = current week
function startOfWeek(d){
  const x=new Date(d);x.setHours(0,0,0,0);
  const dow=x.getDay();
  x.setDate(x.getDate()-dow);
  return x;
}
function renderCalendar(){
  const base=startOfWeek(new Date());
  base.setDate(base.getDate()+_calWeek*7);
  const days=[];
  for(let i=0;i<7;i++){const d=new Date(base);d.setDate(d.getDate()+i);days.push(d);}
  const dayNames=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const today=new Date();today.setHours(0,0,0,0);
  document.getElementById('cal-week-label').textContent=fmtDate(days[0].toISOString())+' — '+fmtDate(days[6].toISOString());
  document.getElementById('cal-grid').innerHTML=days.map(d=>{
    const iso=d.toISOString().split('T')[0];
    const isToday=d.getTime()===today.getTime();
    const isPast=d<today;
    const orders=DB.orders.filter(o=>o.date===iso).sort((a,b)=>STATUSES.findIndex(s=>s.id===a.status)-STATUSES.findIndex(s=>s.id===b.status));
    let cls='cal-day';
    if(isToday)cls+=' today';
    else if(isPast)cls+=' past';
    return '<div class="'+cls+'">'+
      '<div class="cal-day-h"><div class="cal-day-name">'+dayNames[d.getDay()]+'</div><div class="cal-day-num">'+d.getDate()+'</div></div>'+
      orders.map(o=>'<div class="cal-evt s-'+o.status+'" onclick="openOrder(\''+o.id+'\')" title="'+(o.name||'')+'">'+(o.name||'')+' · '+(o.items||[]).reduce((s,i)=>s+i.qty,0)+'×</div>').join('')+
      '</div>';
  }).join('');
}
function prevWeek(){_calWeek--;renderCalendar();}
function nextWeek(){_calWeek++;renderCalendar();}

// === New Order page ===
function resetNewOrder(){
  document.getElementById('no-name').value='';
  document.getElementById('no-phone').value='';
  document.getElementById('no-address').value='';
  document.getElementById('no-fulfill').value='delivery';
  document.getElementById('no-notes').value='';
  document.getElementById('no-date').value='';
  document.getElementById('wa-paste').value='';
  _noItems={};
  renderNoItems();
  updateNoTotal();
  updateNoAddrVis();
}
let _noItems={}; // {productId: {flavor: qty}}
function renderNoItems(){
  const html=PRODUCTS.map(p=>{
    if(p.flavors&&p.flavors.length){
      return '<div style="background:var(--cream);padding:10px 12px;border-radius:8px;margin-bottom:6px">'+
        '<div style="font-weight:600;margin-bottom:6px">'+p.name+' · ₪'+p.price+' '+p.unit+'</div>'+
        p.flavors.map(f=>{
          const q=(_noItems[p.id]&&_noItems[p.id][f])||0;
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">'+
            '<span style="font-size:13px">'+f+'</span>'+
            '<div style="display:flex;align-items:center;gap:5px">'+
              '<button class="btn sm ghost" onclick="noQty(\''+p.id+'\',\''+f+'\',-1)">−</button>'+
              '<input type="number" min="0" value="'+q+'" style="width:50px;text-align:center;padding:5px;border:1px solid rgba(176,141,87,.3);border-radius:6px" onchange="noSetQty(\''+p.id+'\',\''+f+'\',this.value)">'+
              '<button class="btn sm ghost" onclick="noQty(\''+p.id+'\',\''+f+'\',1)">+</button>'+
            '</div>'+
          '</div>';
        }).join('')+
        '</div>';
    }
    const q=(_noItems[p.id]&&_noItems[p.id][''])||0;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--cream);border-radius:8px;margin-bottom:6px">'+
      '<span style="font-size:13.5px"><b>'+p.name+'</b> · ₪'+p.price+' '+p.unit+'</span>'+
      '<div style="display:flex;align-items:center;gap:5px">'+
        '<button class="btn sm ghost" onclick="noQty(\''+p.id+'\',\'\',-1)">−</button>'+
        '<input type="number" min="0" value="'+q+'" style="width:50px;text-align:center;padding:5px;border:1px solid rgba(176,141,87,.3);border-radius:6px" onchange="noSetQty(\''+p.id+'\',\'\',this.value)">'+
        '<button class="btn sm ghost" onclick="noQty(\''+p.id+'\',\'\',1)">+</button>'+
      '</div>'+
    '</div>';
  }).join('');
  document.getElementById('no-items').innerHTML=html;
}
function noQty(pid,flav,delta){
  const cur=(_noItems[pid]&&_noItems[pid][flav])||0;
  noSetQty(pid,flav,cur+delta);
}
function noSetQty(pid,flav,q){
  q=Math.max(0,Math.floor(Number(q)||0));
  if(!_noItems[pid])_noItems[pid]={};
  if(q===0){delete _noItems[pid][flav];if(!Object.keys(_noItems[pid]).length)delete _noItems[pid];}
  else _noItems[pid][flav]=q;
  renderNoItems();updateNoTotal();
}
function updateNoTotal(){
  let sub=0;
  Object.entries(_noItems).forEach(([pid,fm])=>{
    const p=PRODUCTS.find(x=>x.id===pid);
    Object.entries(fm).forEach(([f,q])=>{sub+=q*p.price;});
  });
  const ful=document.getElementById('no-fulfill').value;
  const dl=ful==='pickup'?0:(sub>=FREE||sub===0?0:FEE);
  document.getElementById('no-sub').textContent=fmtNIS(sub);
  document.getElementById('no-del').textContent=ful==='pickup'?'איסוף':(dl===0?'חינם':fmtNIS(dl));
  document.getElementById('no-total').textContent=fmtNIS(sub+dl);
}
function updateNoAddrVis(){
  document.getElementById('no-addr-row').style.display=document.getElementById('no-fulfill').value==='delivery'?'':'none';
}
document.getElementById('no-fulfill').addEventListener('change',()=>{updateNoAddrVis();updateNoTotal();});

function saveNewOrder(){
  const name=document.getElementById('no-name').value.trim();
  const phone=document.getElementById('no-phone').value.trim();
  if(!name||!phone){toast('שם וטלפון חובה');return;}
  const items=[];
  Object.entries(_noItems).forEach(([pid,fm])=>{
    const p=PRODUCTS.find(x=>x.id===pid);
    Object.entries(fm).forEach(([f,q])=>{items.push({productId:pid,name:p.name,flavor:f,qty:q,price:p.price});});
  });
  if(!items.length){toast('הוסיפי לפחות פריט אחד');return;}
  // upsert customer
  let cust=DB.customers.find(c=>c.phone===phone);
  if(!cust){
    cust={id:uid(),name,phone,address:document.getElementById('no-address').value.trim(),createdAt:new Date().toISOString()};
    DB.customers.push(cust);
  }else{
    // update lastOrder
    cust.name=name;
    const addr=document.getElementById('no-address').value.trim();
    if(addr)cust.address=addr;
  }
  cust.lastOrder=document.getElementById('no-date').value||todayISO();
  const order={
    id:uid(),
    customerId:cust.id,
    name,phone,
    address:document.getElementById('no-address').value.trim(),
    fulfillment:document.getElementById('no-fulfill').value,
    date:document.getElementById('no-date').value||todayISO(),
    items,
    notes:document.getElementById('no-notes').value.trim(),
    status:'new',
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  DB.orders.push(order);
  save();
  toast('הזמנה נשמרה ✓');
  goTo('orders');
}

// === WhatsApp parser ===
function parseWA(){
  const txt=document.getElementById('wa-paste').value;
  if(!txt.trim()){toast('הדבק טקסט קודם');return;}
  // Try to extract name, phone, items
  const lines=txt.split('\n');
  let name='',phone='',date='',notes='',addr='',fulfill='delivery';
  const items={};
  
  lines.forEach(l=>{
    l=l.trim();
    const mName=l.match(/^שם:\s*(.+)$/);if(mName)name=mName[1].trim();
    const mPhone=l.match(/^טלפון:\s*(.+)$/);if(mPhone)phone=mPhone[1].trim();
    const mDate=l.match(/^תאריך מבוקש:\s*(.+)$/);if(mDate)date=mDate[1].trim();
    const mAddr=l.match(/^כתובת:\s*(.+)$/);if(mAddr){addr=mAddr[1].replace(/,?\s*אופקים\s*$/,'').trim();}
    const mNotes=l.match(/^הערות:\s*(.+)$/);if(mNotes)notes=mNotes[1].trim();
    if(l.includes('איסוף'))fulfill='pickup';
    
    // Items: "• name × qty = price ₪" or "• name (flavor) × qty = price ₪"
    const mItem=l.match(/^[•·\-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*[×x*]\s*(\d+)/);
    if(mItem){
      const pname=mItem[1].trim();
      const flavor=mItem[2]?mItem[2].trim():'';
      const qty=parseInt(mItem[3]);
      const p=PRODUCTS.find(p=>p.name===pname||pname.includes(p.name));
      if(p){
        if(!items[p.id])items[p.id]={};
        items[p.id][flavor]=qty;
      }
    }
  });
  
  if(name)document.getElementById('no-name').value=name;
  if(phone)document.getElementById('no-phone').value=phone;
  if(addr)document.getElementById('no-address').value=addr;
  if(notes)document.getElementById('no-notes').value=notes;
  document.getElementById('no-fulfill').value=fulfill;
  if(date){
    // try to parse Hebrew date or ISO
    const isoMatch=date.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(isoMatch)document.getElementById('no-date').value=date;
    else{
      const d=date.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
      if(d){
        let y=d[3];if(y.length===2)y='20'+y;
        document.getElementById('no-date').value=y+'-'+d[2].padStart(2,'0')+'-'+d[1].padStart(2,'0');
      }
    }
  }
  _noItems=items;
  renderNoItems();updateNoTotal();updateNoAddrVis();
  const found=Object.keys(items).length;
  toast(found?'זוהו '+found+' מוצרים — בדקי ושמרי':'לא זיהיתי פריטים — מלאי ידנית');
}

// === Order detail modal ===
let _editingOrder=null;
function openOrder(id){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  _editingOrder=id;
  const t=calcOrderTotal(o);
  const st=STATUSES.find(s=>s.id===o.status);
  const items=(o.items||[]).map(i=>'<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>'+i.name+(i.flavor?' · '+i.flavor:'')+' × '+i.qty+'</span><span>'+fmtNIS(i.qty*i.price)+'</span></div>').join('');
  document.getElementById('order-modal-body').innerHTML=
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
      STATUSES.map(s=>'<button class="btn sm '+(s.id===o.status?'':'ghost')+'" onclick="setOrderStatus(\''+o.id+'\',\''+s.id+'\')">'+s.ic+' '+s.label+'</button>').join('')+
    '</div>'+
    '<div style="background:var(--cream);padding:14px;border-radius:10px;margin-bottom:12px">'+
      '<div style="font-weight:600;margin-bottom:6px">👤 '+(o.name||'')+'</div>'+
      '<div style="font-size:13px;color:var(--ix)">'+
        '<div>📞 <a href="https://wa.me/972'+(o.phone||'').replace(/\D/g,'').replace(/^0/,'')+'" target="_blank" dir="ltr">'+(o.phone||'')+'</a></div>'+
        (o.address?'<div>📍 '+o.address+', אופקים</div>':'')+
        '<div>📅 '+fmtDay(o.date)+'</div>'+
        '<div>'+(o.fulfillment==='pickup'?'🏠 איסוף עצמי':'🚚 משלוח')+'</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-bottom:12px">'+
      '<div style="font-weight:600;margin-bottom:6px">פריטים:</div>'+
      items+
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px dashed rgba(176,141,87,.3);margin-top:6px;font-size:13px"><span>סכום:</span><span>'+fmtNIS(t.sub)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>משלוח:</span><span>'+(o.fulfillment==='pickup'?'איסוף':(t.delivery===0?'חינם':fmtNIS(t.delivery)))+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--gold);margin-top:6px;font-weight:700;font-size:16px"><span>סה"כ:</span><span style="color:var(--gd)">'+fmtNIS(t.total)+'</span></div>'+
    '</div>'+
    (o.notes?'<div style="background:#fff8e7;padding:10px;border-radius:8px;font-size:13px;border-right:3px solid var(--warn)"><b>הערות:</b><br>'+o.notes+'</div>':'');
  document.getElementById('order-modal').classList.add('show');
}
function setOrderStatus(id,status){
  const o=DB.orders.find(x=>x.id===id);if(!o)return;
  o.status=status;o.updatedAt=new Date().toISOString();save();
  toast('סטטוס עודכן');
  openOrder(id);
  if(document.getElementById('page-today').classList.contains('act'))renderToday();
  if(document.getElementById('page-orders').classList.contains('act'))renderKanban();
  if(document.getElementById('page-calendar').classList.contains('act'))renderCalendar();
}
function deleteCurrentOrder(){
  if(!_editingOrder)return;
  if(!confirm('למחוק את ההזמנה? לא ניתן לשחזר.'))return;
  DB.orders=DB.orders.filter(o=>o.id!==_editingOrder);
  save();closeModal('order-modal');toast('הזמנה נמחקה');
  renderToday();renderKanban();renderCalendar();renderCustomers();
}

// === Export / Import ===
document.getElementById('export-btn').onclick=()=>{
  const data=JSON.stringify(DB,null,2);
  const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='carmel-backup-'+todayISO()+'.json';
  a.click();
  toast('גיבוי הורד');
};
document.getElementById('import-btn').onclick=()=>document.getElementById('import-file').click();
document.getElementById('import-file').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      if(!confirm('לשחזר '+(d.orders?.length||0)+' הזמנות ו-'+(d.customers?.length||0)+' לקוחות? יחליף את הנתונים הקיימים.'))return;
      DB=d;save();renderToday();renderCustomers();
      toast('הנתונים שוחזרו');
    }catch(err){toast('קובץ לא תקין');}
  };
  r.readAsText(f);
};

// === Init ===
function init(){
  load();
  renderToday();
}
checkAuth();
