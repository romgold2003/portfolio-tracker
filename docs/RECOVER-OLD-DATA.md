# Recovering a journal from the old single-file version

## Why this is needed

`localStorage` is scoped to an **origin**. The original `portfolio_tracker_pro.html`
was opened by double-clicking it, so its origin was `file://`. The restructured
app is served over `http://localhost:4173`. Those are two different origins with
two separate storage buckets.

Nothing is deleted or overwritten. The old journal is still sitting in the
`file://` bucket; the new app simply cannot see it, so on first run it seeded the
demo book instead.

This is a one-time migration. Once the data is in the new app, use
**⚙ Live price settings → Export backup** from then on.

## Step 1 — get the data out of the old page

Open `portfolio_tracker_pro.html` the way you always did (double-click it), in the
**same browser** where your positions show up. Confirm your real positions are on
screen before continuing.

Press **F12** to open DevTools, go to the **Console** tab, paste this, and press
Enter:

```js
(function(){var g=function(k,d){try{var v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}};var b={app:'portfolio-tracker',format:1,exportedAt:new Date().toISOString(),data:{positions:g('pt_pos',[]),cash:parseFloat(localStorage.getItem('pt_cash'))||0,snapshots:g('pt_snaps',[]),priceLog:g('pt_plog',{})}};var t=JSON.stringify(b,null,2);try{var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'application/json'}));a.download='portfolio-backup.json';a.click()}catch(e){}console.log('Positions found:',b.data.positions.length,'| Cash:',b.data.cash);return t})()
```

It does two things:

- Downloads `portfolio-backup.json` to your Downloads folder.
- Prints `Positions found: N | Cash: X` so you can check the count matches what
  is on screen.

**If Chrome blocks the download** (some builds refuse blob downloads on
`file://`), the JSON is also the return value printed in the console. Right-click
it → **Copy string contents**, or run this instead to put it on the clipboard:

```js
copy(JSON.stringify({app:'portfolio-tracker',format:1,data:{positions:JSON.parse(localStorage.getItem('pt_pos')||'[]'),cash:parseFloat(localStorage.getItem('pt_cash'))||0,snapshots:JSON.parse(localStorage.getItem('pt_snaps')||'[]'),priceLog:JSON.parse(localStorage.getItem('pt_plog')||'{}')}}))
```

The snippet only **reads**. It writes nothing, so the old page is left exactly as
it was and you can repeat it as often as you like.

## Step 2 — load it into the new app

1. Start the app: `npm start`, then open <http://localhost:4173>.
2. Sidebar → **⚙ Live price settings**.
3. Under **Your journal**, click **↑ Import backup**.
4. Either choose `portfolio-backup.json`, or paste the JSON into the box.
5. Check the green confirmation line — it should read something like
   `✓ Found 15 positions (15 open, 0 closed) · cash $7,356.44`. If the numbers do
   not match your old screen, stop and re-check step 1.
6. Click **Replace journal** and confirm.

The page reloads with your real book.

## Step 3 — re-enter your API key

The backup deliberately excludes your Finnhub API key, because a backup file is
the kind of thing people email to themselves and a secret should not ride along.

Paste it again in **⚙ Live price settings**, and prices for stocks and ETFs come
straight back.

## Notes

- Keep `portfolio_tracker_pro.html` on your Desktop until you have confirmed the
  import looks right. It is your fallback.
- Do not clear browser data for the old page before step 2 succeeds.
- The import accepts either the full backup object or a bare array of positions,
  so a partially hand-recovered file still loads.
