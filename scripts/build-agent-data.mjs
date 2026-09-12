#!/usr/bin/env node
// build-agent-data.mjs — שכבת "קריא לסוכני AI וזוחלים" לאתר של קרן (carmeldevries.co.il).
//
// הבעיה: המוצרים באתר נטענים ב-JavaScript מה-Apps Script, ולכן זוחל/סוכן שלא מריץ JS
// רואה עמוד בלי מוצרים (או רשימת חירום ישנה שכתובה בקוד). הסקריפט הזה רץ ב-GitHub Action
// פעם בשעה (וידנית), מושך את המוצרים מאותו מקור שהאתר קורא ממנו, ומטמיע אותם בקבצים סטטיים:
//
//   index.html   בין סימונים בלבד (לא נוגע בשום דבר אחר):
//                 <!-- agent-data:head -->      JSON-LD (schema.org: Bakery + OfferCatalog + Product/Offer)
//                 <!-- agent-data:products -->  כרטיסי המוצרים כ-HTML אמיתי (אותו מבנה שה-JS מייצר; ה-JS מחליף אותם מיד עם הנתונים החיים)
//                 /*agent-data:fallback-start*/ רשימת החירום של ה-JS (PRODUCTS_FALLBACK) — מעודכנת, לא ישנה יותר
//   products.json  תמונת-מצב ציבורית ומתועדת של העסק, כללי ההזמנה והמוצרים
//   llms.txt       תיאור העסק לסוכני שפה (llmstxt.org)
//   sitemap.xml    מפת אתר
//
// אין סודות: כל המקורות ציבוריים (האתר עצמו קורא מהם בדפדפן). אין תלות בחבילות חיצוניות.
// כשל בשליפה = יציאה עם שגיאה בלי לכתוב כלום (לא דורסים נתונים טובים בנתונים חסרים).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── הגדרות העסק (קבועות, לא מהגיליון) ─────────────────────────────
const SITE = 'https://carmeldevries.co.il/';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw2KPB_GWD7T4ylM9DiCKpimqWEx7oDyd4WoYwyzDCGw53t9_C-MivKQf4dYF036psjDg/exec';
const FEED_URL = 'https://carmel-agent.vercel.app/api/catalog-feed'; // פיד הקטלוג לוואטסאפ — מקור לקישורי התמונות (Blob ציבורי)

const BIZ = {
  name: 'Carmel De-vries',
  altNames: ['קרן אפייה ביתית', 'Carmel De Vries Sweets', 'Carmel De-vries · אפייה ביתית באהבה'],
  owner: 'קרן',
  phoneDisplay: '052-4809393',
  phoneE164: '+972524809393',
  whatsappPersonal: 'https://wa.me/972524809393',
  whatsappBusinessDisplay: '054-9668819',           // וואטסאפ עסקי "קרן אפייה ביתית" — עם קטלוג הזמנות
  whatsappBusinessE164: '+972549668819',
  whatsappBusiness: 'https://wa.me/972549668819',
  street: 'אורים 20',
  city: 'אופקים',
  country: 'IL',
  deliveryFee: 10,
  freeDeliveryFrom: 150,
  payments: ['מזומן', 'ביט (bit)', 'פייבוקס (PayBox)'],
  kosherNote: 'כל המוצרים מיוצרים מחומרי גלם כשרים, אך לעסק אין תעודת כשרות. הייצור נעשה בימי חול. ליד כל מוצר מסומן חלבי / פרווה.',
  allergenNote: 'המאפים מכילים או עלולים להכיל גלוטן, אגוזים, בוטנים, שומשום, ביצים, חלב וסויה. הייצור במטבח ביתי שאינו נקי מאלרגנים.',
  image: SITE + 'images/group.jpg',
  logo: SITE + 'icons/icon-512.png',
  sameAs: [], // אינסטגרם / פייסבוק — להוסיף כאן כתובות אם קיימות
};
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

// ───────────────────────────── שליפה עם ניסיונות חוזרים ─────────────────────────────
async function fetchText(url, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 (carmel-agent-data)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 800 + i * 600));
    }
  }
  throw new Error('fetch failed ' + url + ': ' + (lastErr && lastErr.message));
}
async function fetchJson(url) {
  const t = await fetchText(url);
  try { return JSON.parse(t); } catch { throw new Error('non-json from ' + url); }
}

// ───────────────────────────── עיצוב מוצר — זהה ללוגיקת האתר (shapeProduct) ─────────────────────────────
function shapeProduct(p) {
  const get = (k) => (p[k] !== undefined && p[k] !== null ? p[k] : '');
  const list = Number(get('price')) || 0;
  const sale = Number(get('salePrice')) || 0;
  const onSale = sale > 0 && sale < list;
  const productQty = Number(get('qty')) || 0;
  const flavors = String(get('flavors') || '').split('|').map((x) => x.trim()).filter(Boolean).map((piece) => {
    const ci = piece.lastIndexOf(':');
    if (ci > 0 && /^\d+$/.test(piece.slice(ci + 1).trim())) {
      return { name: piece.slice(0, ci).trim(), qty: parseInt(piece.slice(ci + 1).trim(), 10) || 0 };
    }
    return { name: piece, qty: productQty };
  });
  const pv = get('published');
  return {
    id: String(get('id') || ''),
    name: String(get('name') || ''),
    desc: String(get('desc') || ''),
    price: onSale ? sale : list,
    listPrice: onSale ? list : 0,
    salePrice: onSale ? sale : 0,
    unit: String(get('unit') || ''),
    qty: productQty,
    kosher: String(get('kosher') || ''),
    img: '',
    published: pv === 1 || pv === '1' || pv === true || String(pv).toLowerCase() === 'true',
    sortOrder: Number(get('sortOrder')) || 100,
    minOrder: Number(get('minOrder')) || 0,
    minNote: String(get('minNote') || ''),
    flavors,
    updatedAt: String(get('updatedAt') || ''),
  };
}
function formatUnit(p) {
  const u = String(p.unit || '').trim();
  if (u) { if (/^\d+(\.\d+)?$/.test(u)) return 'מארז של ' + u + ' יח׳'; return u; }
  if (p.minOrder) return 'ליחידה';
  return 'מארז';
}
function isSoldOut(p) {
  if (p.flavors && p.flavors.length) return p.flavors.every((f) => (f.qty || 0) <= 0);
  return p.qty <= 0;
}

// ───────────────────────────── CSV של הפיד → מפה id → קישור תמונה ─────────────────────────────
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
function imageMapFromFeed(csv) {
  const rows = parseCsv(csv);
  const head = rows.shift() || [];
  const iId = head.indexOf('id'); const iImg = head.indexOf('image_link');
  const m = new Map();
  if (iId < 0 || iImg < 0) return m;
  for (const r of rows) if (r[iId] && r[iImg]) m.set(r[iId], r[iImg]);
  return m;
}

// ───────────────────────────── הגדרות הזמנה (Settings) ─────────────────────────────
function parseSettings(raw) {
  const s = raw || {};
  const out = { acceptingOrders: true, leadDays: 2, closedMessage: '', hours: null, overrides: [] };
  if (s.acceptingOrders !== undefined) {
    const v = String(s.acceptingOrders).trim().toLowerCase();
    out.acceptingOrders = !(v === '0' || v === 'false' || v === 'no' || v === '');
  }
  if (s.leadDays !== undefined && String(s.leadDays).trim() !== '') out.leadDays = Math.max(0, parseInt(s.leadDays, 10) || 0);
  if (s.closedMessage) out.closedMessage = String(s.closedMessage);
  try { const h = typeof s.hours === 'string' ? JSON.parse(s.hours) : s.hours; if (Array.isArray(h) && h.length >= 7) out.hours = h; } catch {}
  try { const o = typeof s.overrides === 'string' ? JSON.parse(s.overrides) : s.overrides; if (Array.isArray(o)) out.overrides = o; } catch {}
  return out;
}
function hoursLines(hours) {
  // שורה לכל יום: "ראשון: כל היום" / "שישי: 13:00–00:00" / "שבת: סגור"
  const lines = [];
  for (let d = 0; d < 7; d++) {
    const h = hours && hours[d];
    if (!h || !h.open) { lines.push({ day: d, text: 'סגור', open: false }); continue; }
    const allDay = (h.from === '00:00' && (h.to === '23:59' || h.to === '00:00' || h.to === '24:00'));
    lines.push({ day: d, text: allDay ? 'כל היום' : `${h.from}–${h.to}`, open: true, from: h.from, to: h.to });
  }
  return lines;
}
function hoursSummary(hours) {
  // מקבץ ימים רצופים עם אותו טקסט: "א׳–ה׳: כל היום · ו׳: 13:00–00:00 · שבת: סגור"
  const lines = hoursLines(hours);
  const parts = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && lines[j + 1].text === lines[i].text) j++;
    const label = i === j ? DAY_SHORT[i] : `${DAY_SHORT[i]}–${DAY_SHORT[j]}`;
    parts.push(`${label}: ${lines[i].text}`);
    i = j + 1;
  }
  return parts.join(' · ');
}
function upcomingClosedDates(overrides, today) {
  const t = today.toISOString().slice(0, 10);
  return (overrides || []).filter((o) => o && o.open === false && String(o.date) >= t).map((o) => String(o.date)).sort();
}

// ───────────────────────────── עזרי HTML ─────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// כרטיס מוצר — אותו מבנה בדיוק שהפונקציה render() באתר מייצרת (מצב התחלתי, כמות 0),
// כדי שההחלפה ע"י ה-JS תהיה בלתי-נראית. ההבדל היחיד: כאן הטקסט מוברח (escape).
function qtyRow(id, flav) {
  return '<div class="qc"><button class="qb" data-id="' + esc(id) + '" data-flav="' + esc(flav) + '" data-act="dec" aria-label="הפחת כמות">−</button><input class="qi" type="number" min="0" value="0" data-id="' + esc(id) + '" data-flav="' + esc(flav) + '" inputmode="numeric"><button class="qb" data-id="' + esc(id) + '" data-flav="' + esc(flav) + '" data-act="inc" aria-label="הוסף כמות">+</button></div>';
}
function cardHtml(p) {
  let qtyHtml = '';
  if (p.flavors && p.flavors.length) {
    qtyHtml = '<div class="flavs"><div class="flavs-title">בחירת טעמים</div>';
    for (const f of p.flavors) {
      const fQty = f.qty || 0; const sold = fQty <= 0; const low = fQty > 0 && fQty <= 3;
      const stockTxt = sold
        ? '<span style="font-family:Heebo,sans-serif;color:#bf360c;font-size:11px;font-weight:600;margin-inline-start:6px">אזל</span>'
        : (low ? '<span style="font-family:Heebo,sans-serif;color:#bf360c;font-size:11px;margin-inline-start:6px;font-variant-numeric:lining-nums tabular-nums;font-feature-settings:\'lnum\' 1,\'tnum\' 1">נותרו ' + fQty + '</span>' : '');
      qtyHtml += '<div class="flav-row" ' + (sold ? 'style="opacity:.45"' : '') + '><span class="flav-name">' + esc(f.name) + stockTxt + '</span><div class="flav-qc"><button class="qb" ' + (sold ? 'disabled' : '') + ' data-id="' + esc(p.id) + '" data-flav="' + esc(f.name) + '" data-act="dec" aria-label="הפחת כמות">−</button><input class="qi" type="number" min="0" max="' + fQty + '" value="0" ' + (sold ? 'disabled' : '') + ' data-id="' + esc(p.id) + '" data-flav="' + esc(f.name) + '" inputmode="numeric"><button class="qb" ' + (sold ? 'disabled' : '') + ' data-id="' + esc(p.id) + '" data-flav="' + esc(f.name) + '" data-act="inc" aria-label="הוסף כמות">+</button></div></div>';
    }
    qtyHtml += '</div>';
  } else {
    const sold = p.qty <= 0;
    qtyHtml = '<div class="qty"' + (sold ? ' style="opacity:.45"' : '') + '><span class="ql">כמות' + (sold ? ' · אזל' : '') + '</span>' + (sold ? '' : qtyRow(p.id, '')) + '</div>';
  }
  if (isSoldOut(p)) qtyHtml += '<button type="button" class="notify-link" data-nid="' + esc(p.id) + '">🔔 עדכני אותי כשחוזר</button>';
  const kbadge = p.kosher === 'חלבי' ? '<span class="kbadge dairy">חלבי</span>'
    : (p.kosher === 'פרווה' ? '<span class="kbadge parve">פרווה</span>'
      : (p.kosher === 'חלבי ופרווה' ? '<span class="kbadge mixed">חלבי ופרווה</span>' : ''));
  const stockBadge = (p.qty > 0 && p.qty <= 3) ? '<span class="soldout">נותרו <bdi>' + p.qty + '</bdi> במלאי</span>' : '';
  const onSale = p.listPrice > 0 && p.listPrice > p.price;
  const priceHtml = onSale
    ? '<div class="pp"><span style="text-decoration:line-through;color:#aaa;font-size:20px;font-weight:400"><span class="cu">₪</span>' + p.listPrice + '</span> <span style="background:#fce4d6;color:#c0392b;border-radius:8px;padding:2px 10px;font-size:26px;font-weight:700"><span class="cu" style="font-size:16px">₪</span>' + p.price + '</span></div><div style="font-size:12px;color:#c0392b;font-weight:600;margin-top:2px">✨ מחיר הכרות לזמן מוגבל</div>'
    : '<div class="pp"><span class="cu">₪</span>' + p.price + '</div>';
  const pic = p.img
    ? '<div class="pi has"><img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" oncontextmenu="return false" draggable="false"><span class="copyr">© Carmel De-vries · כל הזכויות שמורות</span></div>'
    : '<div class="pi"><span class="copyr">© Carmel De-vries · כל הזכויות שמורות</span></div>';
  return '<article class="product" data-id="' + esc(p.id) + '">' + pic + '<div class="pb"><div class="pn">' + esc(p.name) + kbadge + stockBadge + '</div><div class="pd">' + esc(p.desc).replace(/\r?\n/g, ' ') + '</div><div class="pr">' + priceHtml + '<div class="pu">' + esc(formatUnit(p)) + '</div></div>' + qtyHtml + (p.minNote ? '<div class="mn">' + esc(p.minNote) + '</div>' : '') + '</div></article>';
}

// ───────────────────────────── JSON-LD (schema.org) ─────────────────────────────
function buildJsonLd(products, ordering) {
  const bizId = SITE + '#business';
  const catalogId = SITE + '#catalog';
  const prices = products.map((p) => p.price).filter((n) => n > 0);
  const priceRange = prices.length ? `₪${Math.min(...prices)}–₪${Math.max(...prices)}` : '₪';
  const leadTxt = ordering.leadDays > 0 ? `יש להזמין לפחות ${ordering.leadDays} ימים מראש.` : '';
  const openTxt = ordering.acceptingOrders ? '' : ' כרגע האתר לא מקבל הזמנות חדשות.';
  const description = `${BIZ.owner} — אפייה ביתית באהבה: עוגיות, מארזים ועוגות בעבודת יד מ${BIZ.city}. ` +
    `הזמנה דרך האתר או בוואטסאפ ${BIZ.phoneDisplay}. ${leadTxt} ` +
    `איסוף עצמי ברח׳ ${BIZ.street}, ${BIZ.city} בתיאום מראש, או משלוח ב${BIZ.city} ב-${BIZ.deliveryFee} ₪ (חינם בהזמנה מעל ${BIZ.freeDeliveryFrom} ₪). ` +
    `תשלום: ${BIZ.payments.join(', ')}. שעות קבלת הזמנות באתר: ${hoursSummary(ordering.hours)}. ` +
    `${BIZ.kosherNote}${openTxt}`;

  const productNodes = products.map((p, i) => {
    const pid = SITE + '#product-' + encodeURIComponent(p.id);
    const inStock = !isSoldOut(p);
    const props = [];
    if (p.kosher) props.push({ '@type': 'PropertyValue', name: 'כשרות', value: p.kosher });
    props.push({ '@type': 'PropertyValue', name: 'יחידת מכירה', value: formatUnit(p) });
    if (p.flavors.length) props.push({ '@type': 'PropertyValue', name: 'טעמים', value: p.flavors.map((f) => f.name + ((f.qty || 0) <= 0 ? ' (אזל)' : '')).join(', ') });
    const offer = {
      '@type': 'Offer',
      url: pid,
      price: String(p.price),
      priceCurrency: 'ILS',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': bizId },
      availableDeliveryMethod: ['http://purl.org/goodrelations/v1#DeliveryModePickUp', 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet'],
      areaServed: { '@type': 'City', name: BIZ.city },
    };
    if (p.listPrice > 0 && p.listPrice > p.price) {
      offer.priceSpecification = [
        { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: String(p.listPrice), priceCurrency: 'ILS' },
        { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/SalePrice', price: String(p.price), priceCurrency: 'ILS' },
      ];
    }
    if (p.minOrder > 0) offer.eligibleQuantity = { '@type': 'QuantitativeValue', minValue: p.minOrder };
    const node = {
      '@type': 'Product',
      '@id': pid,
      name: oneLine(p.name),
      description: oneLine(p.desc) || oneLine(p.name),
      sku: p.id,
      category: 'מאפים ביתיים',
      brand: { '@type': 'Brand', name: BIZ.altNames[0] },
      additionalProperty: props,
      offers: offer,
    };
    if (p.img) node.image = p.img;
    return { '@type': 'ListItem', position: i + 1, item: node };
  });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Bakery',
        '@id': bizId,
        name: BIZ.name,
        alternateName: BIZ.altNames,
        description,
        url: SITE,
        image: BIZ.image,
        logo: BIZ.logo,
        telephone: BIZ.phoneE164,
        contactPoint: [
          { '@type': 'ContactPoint', contactType: 'customer service', telephone: BIZ.phoneE164, url: BIZ.whatsappPersonal, availableLanguage: ['he'], description: 'טלפון / וואטסאפ להזמנות ושאלות' },
          { '@type': 'ContactPoint', contactType: 'sales', telephone: BIZ.whatsappBusinessE164, url: BIZ.whatsappBusiness, availableLanguage: ['he'], description: 'וואטסאפ עסקי עם קטלוג הזמנות' },
        ],
        address: { '@type': 'PostalAddress', streetAddress: BIZ.street, addressLocality: BIZ.city, addressCountry: BIZ.country },
        areaServed: { '@type': 'City', name: BIZ.city },
        servesCuisine: 'מאפים ביתיים, עוגיות, עוגות',
        priceRange,
        currenciesAccepted: 'ILS',
        paymentAccepted: 'Cash, Bit, PayBox',
        ...(BIZ.sameAs.length ? { sameAs: BIZ.sameAs } : {}),
        hasOfferCatalog: { '@id': catalogId },
        potentialAction: {
          '@type': 'OrderAction',
          target: { '@type': 'EntryPoint', urlTemplate: SITE, actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform'], inLanguage: 'he' },
          deliveryMethod: ['http://purl.org/goodrelations/v1#DeliveryModePickUp', 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet'],
        },
      },
      { '@type': 'WebSite', '@id': SITE + '#website', url: SITE, name: BIZ.name, alternateName: BIZ.altNames[0], inLanguage: 'he', publisher: { '@id': bizId } },
      { '@type': 'OfferCatalog', '@id': catalogId, name: 'התפריט של ' + BIZ.owner, numberOfItems: products.length, itemListOrder: 'https://schema.org/ItemListOrderAscending', itemListElement: productNodes },
    ],
  };
}

// ───────────────────────────── products.json ─────────────────────────────
function buildProductsJson(products, ordering, today) {
  return {
    _about: 'תמונת-מצב ציבורית של האתר carmeldevries.co.il, מתעדכנת אוטומטית פעם בשעה מאותו מקור שהאתר קורא ממנו. לזמינות בזמן-אמת ראו links.live_products.',
    business: {
      name: BIZ.name, alternateNames: BIZ.altNames, owner: BIZ.owner,
      phone: BIZ.phoneDisplay, phoneE164: BIZ.phoneE164, whatsapp: BIZ.whatsappPersonal,
      whatsappBusiness: { phone: BIZ.whatsappBusinessDisplay, url: BIZ.whatsappBusiness, note: 'וואטסאפ עסקי עם קטלוג הזמנות' },
      address: { street: BIZ.street, city: BIZ.city, country: BIZ.country, note: 'איסוף עצמי בתיאום מראש בלבד — זה עסק ביתי, לא חנות' },
      kosher: BIZ.kosherNote, allergens: BIZ.allergenNote, website: SITE,
    },
    ordering: {
      acceptingOrders: ordering.acceptingOrders,
      closedMessage: ordering.acceptingOrders ? '' : ordering.closedMessage,
      leadDays: ordering.leadDays,
      leadDaysNote: ordering.leadDays > 0 ? `יש להזמין לפחות ${ordering.leadDays} ימים מראש (התאריך המבוקש חייב להיות לפחות ${ordering.leadDays} ימים מהיום).` : 'אין דרישת הזמנה מראש.',
      orderWindow: {
        note: 'שעות שבהן האתר מקבל הזמנות (לא שעות פתיחה לקהל — איסוף בתיאום מראש). יום 0 = ראשון.',
        summary: hoursSummary(ordering.hours),
        days: hoursLines(ordering.hours).map((l) => ({ day: l.day, name: DAY_NAMES[l.day], open: l.open, ...(l.open && l.text !== 'כל היום' ? { from: l.from, to: l.to } : {}) })),
      },
      closedDates: upcomingClosedDates(ordering.overrides, today),
      fulfillment: {
        pickup: { available: true, address: `${BIZ.street}, ${BIZ.city}`, note: 'בתיאום מראש' },
        delivery: { available: true, area: BIZ.city, fee: BIZ.deliveryFee, freeFrom: BIZ.freeDeliveryFrom, currency: 'ILS', note: `משלוח רק בתוך ${BIZ.city}` },
      },
      payment: BIZ.payments,
      howToOrder: [
        `באתר ${SITE}: בוחרים מוצרים וכמויות, ממלאים שם, טלפון, סוג קבלה (משלוח/איסוף), תאריך, אמצעי תשלום — ולוחצים "שליחת הזמנה". ההזמנה נקלטת ומאושרת בוואטסאפ.`,
        `בוואטסאפ: הודעה ל-${BIZ.phoneDisplay} או לוואטסאפ העסקי ${BIZ.whatsappBusinessDisplay} (עם קטלוג הזמנות).`,
        'ההזמנה סופית רק לאחר אישור בכתב מהעסק. ביטול אפשרי רק לפני תחילת ההכנה.',
      ],
    },
    products: products.map((p) => ({
      id: p.id,
      name: oneLine(p.name),
      description: p.desc,
      price: p.price,
      currency: 'ILS',
      ...(p.listPrice > 0 ? { listPrice: p.listPrice, onSale: true } : {}),
      unit: formatUnit(p),
      kosher: p.kosher || null,
      availability: isSoldOut(p) ? 'out_of_stock' : 'in_stock',
      ...(p.flavors.length ? { flavors: p.flavors.map((f) => ({ name: f.name, availability: (f.qty || 0) <= 0 ? 'out_of_stock' : 'in_stock' })) } : {}),
      ...(p.minOrder > 0 ? { minOrder: p.minOrder, minOrderNote: p.minNote || null } : {}),
      image: p.img || null,
      url: SITE + '#product-' + encodeURIComponent(p.id),
    })),
    links: {
      website: SITE,
      policy: SITE + 'policy.html',
      accessibility: SITE + 'accessibility.html',
      llms_txt: SITE + 'llms.txt',
      live_products: { url: APPS_SCRIPT_URL + '?action=products', note: 'JSON חי (אותו מקור שהאתר קורא): products[] עם id,name,desc,price,salePrice,unit,qty,kosher,flavors,published. שורות עם id "__settings__" הן הגדרות, לא מוצרים. התמונות בו הן base64 (כבד) — עדיף להשתמש בקישורי image שכאן.' },
      live_settings: { url: APPS_SCRIPT_URL + '?action=settings', note: 'הגדרות הזמנה חיות: acceptingOrders, leadDays, hours, overrides, closedMessage.' },
    },
  };
}

// ───────────────────────────── llms.txt ─────────────────────────────
function buildLlmsTxt(products, ordering, today) {
  const closed = upcomingClosedDates(ordering.overrides, today);
  const inStock = products.filter((p) => !isSoldOut(p));
  const soldOut = products.filter((p) => isSoldOut(p));
  const line = (p) => {
    const price = p.listPrice > 0 ? `${p.price} ₪ (במקום ${p.listPrice} ₪, מחיר הכרות)` : `${p.price} ₪`;
    const flav = p.flavors.length ? ` · טעמים: ${p.flavors.map((f) => f.name + ((f.qty || 0) <= 0 ? ' (אזל)' : '')).join(', ')}` : '';
    const min = p.minOrder > 0 ? ` · מינימום ${p.minOrder} יח׳` : '';
    return `- **${oneLine(p.name)}** — ${price} · ${formatUnit(p)}${p.kosher ? ' · ' + p.kosher : ''}${flav}${min}. ${oneLine(p.desc)}`;
  };
  const L = [];
  L.push(`# ${BIZ.name} · ${BIZ.altNames[0]}`);
  L.push('');
  L.push(`> עסק אפייה ביתי של ${BIZ.owner} מ${BIZ.city}: עוגיות, מארזים ועוגות בעבודת יד, בהזמנה מראש דרך האתר או בוואטסאפ. איסוף עצמי ב${BIZ.city} בתיאום מראש, או משלוח בתוך ${BIZ.city}.`);
  L.push('');
  L.push(`Carmel De-vries ("Keren – homemade baking") is a home bakery in Ofakim, Israel, selling handmade cookies, gift boxes and cakes by advance order through the website or WhatsApp. Pickup in Ofakim by appointment, or local delivery within Ofakim. Site language: Hebrew. Prices in ILS (₪).`);
  L.push('');
  L.push('## פרטי העסק');
  L.push(`- טלפון / וואטסאפ: ${BIZ.phoneDisplay} (${BIZ.whatsappPersonal})`);
  L.push(`- וואטסאפ עסקי עם קטלוג הזמנות: ${BIZ.whatsappBusinessDisplay} (${BIZ.whatsappBusiness})`);
  L.push(`- כתובת לאיסוף עצמי: רח׳ ${BIZ.street}, ${BIZ.city} — בתיאום מראש בלבד (עסק ביתי, לא חנות)`);
  L.push(`- אתר: ${SITE}`);
  L.push(`- כשרות: ${BIZ.kosherNote}`);
  L.push(`- אלרגנים: ${BIZ.allergenNote}`);
  L.push('');
  L.push('## איך מזמינים');
  L.push(`- באתר: בוחרים מוצרים וכמויות, ממלאים שם, טלפון, סוג קבלה (משלוח / איסוף), תאריך ואמצעי תשלום, ולוחצים "שליחת הזמנה". ההזמנה נקלטת במערכת ומאושרת בוואטסאפ.`);
  L.push(`- בוואטסאפ: הודעה ל-${BIZ.phoneDisplay}, או לוואטסאפ העסקי ${BIZ.whatsappBusinessDisplay} שבו יש קטלוג עם עגלה.`);
  L.push(`- הזמנה מראש: ${ordering.leadDays > 0 ? `לפחות ${ordering.leadDays} ימים מראש` : 'אין דרישת הזמנה מראש'}. הזמנות גדולות — כדאי לתאם מוקדם יותר.`);
  L.push(`- שעות קבלת הזמנות באתר (לא שעות פתיחה): ${hoursSummary(ordering.hours)}.`);
  if (closed.length) L.push(`- ימים סגורים קרובים (לא ניתן לבחור אותם כתאריך): ${closed.join(', ')}.`);
  if (!ordering.acceptingOrders) L.push(`- ⚠️ כרגע האתר לא מקבל הזמנות חדשות: ${ordering.closedMessage}`);
  L.push(`- משלוח: רק בתוך ${BIZ.city}, ${BIZ.deliveryFee} ₪; חינם בהזמנה מעל ${BIZ.freeDeliveryFrom} ₪.`);
  L.push(`- איסוף עצמי: רח׳ ${BIZ.street}, ${BIZ.city}, בתיאום מראש.`);
  L.push(`- תשלום: ${BIZ.payments.join(' / ')}. ההזמנה סופית רק אחרי אישור בכתב מהעסק. ביטול אפשרי רק לפני תחילת ההכנה.`);
  L.push('');
  L.push(`## התפריט — ${inStock.length} מוצרים במלאי${soldOut.length ? `, ${soldOut.length} אזלו` : ''}`);
  L.push('המחירים בשקלים. "מארז של כ-N יח׳" = כמות משוערת במארז. הזמינות מתעדכנת אוטומטית פעם בשעה; לזמינות בזמן-אמת ראו הקישורים למטה.');
  L.push('');
  L.push('### במלאי');
  for (const p of inStock) L.push(line(p));
  if (soldOut.length) {
    L.push('');
    L.push('### אזל כרגע (אפשר להירשם באתר לעדכון כשחוזר)');
    for (const p of soldOut) L.push(line(p));
  }
  L.push('');
  L.push('## קישורים');
  L.push(`- [האתר](${SITE}): קטלוג, הזמנה ותאריכים פנויים`);
  L.push(`- [products.json](${SITE}products.json): כל המידע שבקובץ הזה כ-JSON מובנה (עסק, כללי הזמנה, מוצרים, זמינות, תמונות)`);
  L.push(`- [מוצרים בזמן-אמת (JSON)](${APPS_SCRIPT_URL}?action=products): המקור החי שהאתר קורא ממנו — כולל qty (מלאי) ו-flavors; שורות "__settings__" הן הגדרות ולא מוצרים; התמונות בו base64 (כבד)`);
  L.push(`- [הגדרות הזמנה בזמן-אמת (JSON)](${APPS_SCRIPT_URL}?action=settings): acceptingOrders, leadDays, hours, overrides`);
  L.push(`- [תקנון ומדיניות](${SITE}policy.html): כשרות, אלרגנים, ביטולים, פרטיות`);
  L.push(`- [הצהרת נגישות](${SITE}accessibility.html)`);
  L.push(`- [מפת אתר](${SITE}sitemap.xml)`);
  L.push('');
  return L.join('\n') + '\n';
}

// ───────────────────────────── sitemap.xml ─────────────────────────────
function buildSitemap(lastmod) {
  const u = (loc, extra = '') => `  <url><loc>${loc}</loc>${extra}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    u(SITE, `<lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority>`),
    u(SITE + 'policy.html', '<changefreq>yearly</changefreq><priority>0.3</priority>'),
    u(SITE + 'accessibility.html', '<changefreq>yearly</changefreq><priority>0.2</priority>'),
    u(SITE + 'llms.txt', `<lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq><priority>0.5</priority>`),
    '</urlset>',
    '',
  ].join('\n');
}

// ───────────────────────────── הזרקה בין סימונים ─────────────────────────────
function replaceBetween(src, start, end, inner, label) {
  const a = src.indexOf(start); const b = src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`marker missing in index.html: ${label}`);
  if (src.indexOf(start, a + 1) >= 0) throw new Error(`marker duplicated in index.html: ${label}`);
  return src.slice(0, a + start.length) + inner + src.slice(b);
}
function writeIfChanged(file, content) {
  const abs = path.join(ROOT, file);
  const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (old === content) { console.log(`= ${file} (unchanged)`); return false; }
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`✎ ${file} (${content.length} chars)`);
  return true;
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  const today = new Date();
  const [prodRaw, settingsRaw, feedCsv] = await Promise.all([
    fetchJson(APPS_SCRIPT_URL + '?action=products&t=' + Date.now()),
    fetchJson(APPS_SCRIPT_URL + '?action=settings&t=' + Date.now()).catch((e) => { console.warn('settings endpoint failed, falling back to __settings__ row:', e.message); return null; }),
    fetchText(FEED_URL),
  ]);
  const rows = Array.isArray(prodRaw) ? prodRaw : (prodRaw && prodRaw.products);
  if (!Array.isArray(rows) || !rows.length) throw new Error('products endpoint returned no rows');

  // הגדרות: מהנתיב הייעודי, ואם נפל — משורת __settings__ החדשה ביותר (כמו האתר)
  let settingsSrc = settingsRaw && settingsRaw.ok && settingsRaw.settings && Object.keys(settingsRaw.settings).length ? settingsRaw.settings : null;
  if (!settingsSrc) {
    const sr = rows.filter((r) => r && String(r.id) === '__settings__' && r.desc).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (sr) { try { settingsSrc = JSON.parse(String(sr.desc)); } catch {} }
  }
  const ordering = parseSettings(settingsSrc);

  // מוצרים: מפורסמים בלבד, בסדר של האתר (במלאי קודם, ואז sortOrder)
  const images = imageMapFromFeed(feedCsv);
  const products = rows.map(shapeProduct)
    .filter((p) => p.id && p.id !== '__settings__' && p.name && p.published)
    .sort((a, b) => { const sa = a.qty <= 0 ? 1 : 0; const sb = b.qty <= 0 ? 1 : 0; if (sa !== sb) return sa - sb; return a.sortOrder - b.sortOrder; });
  if (!products.length) throw new Error('no published products — refusing to write empty data');
  for (const p of products) {
    p.img = images.get(p.id) || '';
    if (!p.img) { const legacy = path.join(ROOT, 'images', p.id + '.jpg'); if (fs.existsSync(legacy)) p.img = 'images/' + p.id + '.jpg'; }
  }
  const noImg = products.filter((p) => !p.img).map((p) => p.id);
  if (noImg.length) console.warn('products without image url:', noImg.join(', '));
  if (images.size === 0) throw new Error('feed returned no image links — refusing to write cards without images');

  const lastmod = products.map((p) => p.updatedAt).filter(Boolean).sort().pop()?.slice(0, 10) || today.toISOString().slice(0, 10);

  // 1) index.html — שלושה בלוקים בין סימונים
  const indexPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const EOL = html.includes('\r\n') ? '\r\n' : '\n'; // שומרים על סוף-השורה של הקובץ (CRLF בעותק ווינדוס, LF בריפו)
  const jsonLd = buildJsonLd(products, ordering);
  JSON.parse(JSON.stringify(jsonLd)); // ודאות שזה JSON תקין
  const headBlock = EOL + '<script type="application/ld+json">' + JSON.stringify(jsonLd).replace(/<\/script/gi, '<\\/script') + '</script>' + EOL;
  const cardsBlock = products.map(cardHtml).join('');
  // רשימת החירום של ה-JS: אותה צורה שהאתר בונה ב-shapeProduct, עם קישורי תמונה במקום base64
  const fallback = products.map((p) => ({ id: p.id, name: p.name, desc: p.desc, price: p.price, listPrice: p.listPrice, salePrice: p.salePrice, unit: p.unit, qty: p.qty, kosher: p.kosher, img: p.img, published: true, sortOrder: p.sortOrder, minOrder: p.minOrder, minNote: p.minNote, flavors: p.flavors.map((f) => ({ name: f.name, qty: f.qty })) }));
  const fallbackBlock = JSON.stringify(fallback).replace(/<\/script/gi, '<\\/script');
  html = replaceBetween(html, '<!-- agent-data:head -->', '<!-- /agent-data:head -->', headBlock, 'head');
  html = replaceBetween(html, '<!-- agent-data:products -->', '<!-- /agent-data:products -->', cardsBlock, 'products');
  html = replaceBetween(html, '/*agent-data:fallback-start*/', '/*agent-data:fallback-end*/', fallbackBlock, 'fallback');
  let changed = writeIfChanged('index.html', html);

  // 2) products.json 3) llms.txt 4) sitemap.xml
  changed = writeIfChanged('products.json', JSON.stringify(buildProductsJson(products, ordering, today), null, 2) + '\n') || changed;
  changed = writeIfChanged('llms.txt', buildLlmsTxt(products, ordering, today)) || changed;
  changed = writeIfChanged('sitemap.xml', buildSitemap(lastmod)) || changed;

  console.log(`done: ${products.length} products (${products.filter((p) => !isSoldOut(p)).length} in stock), leadDays=${ordering.leadDays}, accepting=${ordering.acceptingOrders}, changed=${changed}`);
}

main().catch((e) => { console.error('build-agent-data FAILED:', e.message); process.exit(1); });
