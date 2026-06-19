/* track.js — מעקב אנונימי לאתר Carmel De-vries.
 * עיקרון על: לעולם לא לשבור את האתר. כל הקובץ עטוף ב-try/catch, שולח באמצעות
 * navigator.sendBeacon (שגר-ושכח, בלי לחכות לתשובה, בלי preflight), ואם משהו
 * נכשל — פשוט לא קורה כלום. אין עוגיות, אין שמירת זהות, מזהה סשן אקראי בלבד
 * שחי רק בכרטיסייה הנוכחית.
 */
(function () {
  try {
    var ENDPOINT = 'https://carmel-agent.vercel.app/api/track';
    var THRESH = 600;        // מינ' שהייה (מ"ש) כדי לספור צפייה במוצר
    var HB_MS = 20000;       // פעימת "אונליין" כל 20 שניות
    var TICK_MS = 1000;

    // --- אופט-אאוט לבעלים (קרן/טל) — לא לספור אותם בכניסות ---
    // ביקור עם ?notrack=1 מסמן את המכשיר הזה כ"בעלים" (נשמר ב-localStorage)
    // ומפסיק כל מעקב על המכשיר. ?notrack=0 מבטל. פר-דפדפן, אנונימי.
    try {
      var _q = location.search || '';
      if (_q.indexOf('notrack') > -1) {
        if (/notrack=(0|off|false)/i.test(_q)) { try { localStorage.removeItem('ca_notrack'); } catch (e) {} }
        else { try { localStorage.setItem('ca_notrack', '1'); } catch (e) {} }
      }
      if (localStorage.getItem('ca_notrack') === '1') return; // מכשיר של הבעלים — לא עוקבים בכלל
    } catch (e) {}

    // --- מזהה סשן אנונימי (כרטיסייה בלבד) ---
    var sid;
    try {
      sid = sessionStorage.getItem('ca_sid');
      if (!sid) {
        sid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        sessionStorage.setItem('ca_sid', sid);
      }
    } catch (e) { sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

    function localDate() {
      try {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      } catch (e) { return ''; }
    }

    function send(ev) {
      try {
        ev.sid = sid;
        ev.d = localDate();
        var body = JSON.stringify(ev);
        var ok = false;
        if (navigator && typeof navigator.sendBeacon === 'function') {
          var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
          ok = navigator.sendBeacon(ENDPOINT, blob);
        }
        if (!ok && typeof fetch === 'function') {
          fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, mode: 'no-cors' }).catch(function () {});
        }
      } catch (e) { /* שגר-ושכח */ }
    }

    function deviceKind() {
      try {
        if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) return 'm';
        if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return 'm';
        return 'd';
      } catch (e) { return 'm'; }
    }

    // מאחד מקור תנועה לטוקן קנוני אחד: כל כתובות-המשנה של פייסבוק → facebook,
    // וואטסאפ (כולל com.whatsapp באנדרואיד) → whatsapp, וכן הלאה.
    function normSrc(h) {
      h = String(h || '').toLowerCase();
      if (!h) return '';
      if (h.indexOf('facebook') > -1 || h === 'fb' || h.indexOf('fb.com') > -1 || h.indexOf('fb.me') > -1) return 'facebook';
      if (h.indexOf('instagram') > -1 || h === 'ig') return 'instagram';
      if (h.indexOf('whatsapp') > -1 || h === 'wa' || h.indexOf('wa.me') > -1) return 'whatsapp';
      if (h.indexOf('google') > -1) return 'google';
      if (h.indexOf('t.co') > -1 || h.indexOf('twitter') > -1 || h === 'x.com') return 'twitter';
      if (h.indexOf('tiktok') > -1) return 'tiktok';
      if (h.indexOf('youtube') > -1 || h.indexOf('youtu.be') > -1) return 'youtube';
      return h;
    }

    // מקור הביקור: (1) תיוג מפורש בקישור ?s= / ?utm_source= — הכי אמין, היחיד
    // שתופס וואטסאפ בוודאות; (2) ה-referrer של הדפדפן; (3) אין מקור → כניסה ישירה.
    function source() {
      try {
        var sp = new URLSearchParams(location.search || '');
        var tag = (sp.get('s') || sp.get('utm_source') || '').trim();
        if (tag) return normSrc(tag) || 'direct';
        if (document.referrer) {
          var u = new URL(document.referrer);
          var host = u.hostname || '';
          if (host && host.indexOf(location.hostname) === -1) return normSrc(host) || host;
        }
        return 'direct';
      } catch (e) { return 'direct'; }
    }

    // --- pageview (המקור נספר פעם אחת לכל ביקור, לא בכל רענון/מעבר עמוד) ---
    var firstPv = true;
    try { if (sessionStorage.getItem('ca_pv1')) firstPv = false; else sessionStorage.setItem('ca_pv1', '1'); } catch (e) {}
    send({ t: 'pv', ref: firstPv ? source() : '', dev: deviceKind() });

    // --- heartbeat ("אונליין עכשיו") ---
    setInterval(function () { try { if (!document.hidden) send({ t: 'hb' }); } catch (e) {} }, HB_MS);

    // --- צפייה/שהייה במוצרים (polling — עמיד לרינדור מחדש של הקטלוג) ---
    var prods = {}; // pid -> { acc, since, name }

    function nameOf(el) {
      try {
        var pn = el.querySelector('.pn');
        if (pn && pn.firstChild && pn.firstChild.textContent) return pn.firstChild.textContent.trim().slice(0, 80);
      } catch (e) {}
      return '';
    }
    function rectVisible(el) {
      try {
        var r = el.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        if (r.bottom <= 0 || r.top >= vh) return false;
        var visH = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        return visH > 40 && visH >= Math.min(r.height, vh) * 0.5;
      } catch (e) { return false; }
    }
    function flushPid(pid, now) {
      var p = prods[pid];
      if (!p) return;
      if (p.since != null) { p.acc += now - p.since; p.since = null; }
      if (p.acc >= THRESH) { send({ t: 'view', pid: pid, name: p.name || '', ms: p.acc }); p.acc = 0; }
    }
    function tick() {
      try {
        var now = Date.now();
        var hidden = document.hidden;
        var els = document.querySelectorAll('.product[data-id]');
        var visibleNow = {};
        if (!hidden) {
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var pid = el.getAttribute('data-id');
            if (!pid) continue;
            if (rectVisible(el)) {
              visibleNow[pid] = 1;
              if (!prods[pid]) prods[pid] = { acc: 0, since: null, name: nameOf(el) };
              if (!prods[pid].name) prods[pid].name = nameOf(el);
              if (prods[pid].since == null) prods[pid].since = now;
            }
          }
        }
        for (var k in prods) {
          if (!Object.prototype.hasOwnProperty.call(prods, k)) continue;
          var p = prods[k];
          if (p.since != null && !visibleNow[k]) { flushPid(k, now); }   // יצא מהמסך → סגור צפייה
        }
      } catch (e) {}
    }
    setInterval(tick, TICK_MS);

    function flushAll() {
      try { var now = Date.now(); for (var k in prods) { if (Object.prototype.hasOwnProperty.call(prods, k)) flushPid(k, now); } } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);

    // --- הוספה לסל (פעם אחת לכל מוצר בסשן) + התחלת הזמנה ---
    var addedPids = {}, checkoutSent = false;
    document.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var inc = t.closest('.qb[data-act="inc"]');
        if (inc) {
          var card = inc.closest('.product[data-id]');
          var pid = card ? card.getAttribute('data-id') : (inc.getAttribute('data-id') || '');
          if (pid && !addedPids[pid]) { addedPids[pid] = 1; send({ t: 'add', pid: pid, name: card ? nameOf(card) : '' }); }
          return;
        }
        var sb = t.closest('#sb, #bsb');
        if (sb && !checkoutSent) { checkoutSent = true; send({ t: 'co' }); }
      } catch (err) {}
    }, true);
  } catch (e) { /* מעקב כבוי בשקט אם משהו נכשל */ }
})();
