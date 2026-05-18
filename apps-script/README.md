# Carmel — Web App להורדת מלאי אוטומטית

הקובץ `Code.gs` הוא סקריפט קטן שרץ בתוך Google שמקבל הזמנה מהאתר,
מוריד את הכמות מ-`Products` באופן אטומי (נעילה נגד הזמנות במקביל),
ורושם את ההזמנה ב-`Orders`.

## פריסה — פעם אחת

1. לפתוח את הגיליון `Carmel De-vries — Master` ב-Google Sheets.
2. תפריט **Extensions → Apps Script**.
3. למחוק את כל מה שיש בעורך, להדביק את כל התוכן של `Code.gs`, לשמור (Ctrl+S).
4. **Deploy → New deployment**.
   - גלגל השיניים ליד "Select type" → **Web app**.
   - Description: `carmel order intake`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - **Deploy** → לאשר את ההרשאות (Authorize access → לבחור את החשבון → Advanced → Go to project → Allow).
5. להעתיק את ה-**Web app URL** (מסתיים ב-`/exec`).
6. למסור את ה-URL הזה — הוא נכנס ל-`index.html` בשורה `const WEBAPP_URL=''`.

## עדכון אחרי שינוי קוד

Deploy → **Manage deployments** → עיפרון (Edit) → Version: **New version** → Deploy.
ה-URL נשאר אותו דבר.

## בדיקה

לפתוח את ה-`/exec` URL בדפדפן — צריך להחזיר `{"ok":true,"service":"carmel-order-intake"}`.
