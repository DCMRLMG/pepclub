# Retail order app (serverless) — reps, inventory, admin

Single form, three rep entry points, one central Supabase backend, and a password-gated
admin page that runs each order through its lifecycle. Products sell in 5/10-packs plus
kits; inventory decrements atomically; a custom date-based invoice page is generated.
No messaging and no payment processor are wired in — you handle texting and payment
directly.

## The workflow

1. **Link is texted** — you send a rep's link to the customer (you do this directly).
2. **Form is submitted** — customer picks items, enters details, chooses cash/Venmo.
3. **Data stored centrally** — the order lands in the Supabase `orders` table, tagged
   with the rep, and inventory is decremented. An invoice number + link are generated.
4. **Order paid** — you mark it `paid` in the admin once payment arrives.
5. **Order fulfilled** — mark `fulfilled` when it goes out.
6. **Order closed** — mark `closed` to end the workflow.

Statuses: **pending → paid → fulfilled → closed** (each sets a timestamp).

## Rep-directed ordering (one form, not three)

Same page, parameterized by URL — no duplicated code:

- `/?rep=dennis` · `/?rep=ryan` · `/?rep=mike`   (paths like `/dennis` also work)

The page shows the rep's name and stamps every order with `rep`; the server re-validates
it. Reps are a fixed list in `reps.js`.

## Central storage & management

One Supabase `orders` table is the source of truth. The admin console (`/admin.html`):

- Sign in with the shared `ADMIN_PASSWORD`.
- Filter by rep and status; see counts and paid+ revenue.
- Move each order through the lifecycle with a dropdown.

## Inventory model

`catalog.js` defines products, pack variants, and kits (whose `components` consume base
SKUs). On submit, all lines convert to base-SKU units and pass to the `consume_inventory`
Postgres function, which decrements everything in one transaction and rejects the whole
order if any SKU would go negative. Kits and loose packs share the same pool.

## Files

```
public/index.html    the order form (reads ?rep=, loads catalog from /api/catalog)
public/admin.html    the management console
api/catalog.js       serves the catalog to the form as JSON
api/catalog-data.js  products, variants, kits, pricing + consumption logic (SINGLE SOURCE)
api/reps.js          fixed rep list (dennis, ryan, mike)
api/submit-order.js  validate -> consume inventory -> store -> return invoice link
api/invoice.js       hosted custom invoice page
api/admin-orders.js  list + status update (password-gated)
schema.sql           inventory + orders tables, consume_inventory function
package.json         dependencies
```

To change products/prices, edit `api/catalog-data.js` (the single source).

## Setup & launch

1. **Supabase:** create a project → SQL Editor → run `schema.sql`. Copy the Project URL
   and service_role key from Settings → API.
2. **Env:** copy `.env.example` → `.env.local`; fill in Supabase, `ADMIN_PASSWORD`,
   `BUSINESS_NAME`/`BUSINESS_VENMO`.
3. **Local test:**
   ```bash
   npm install
   npm i -g vercel
   vercel dev            # serves at http://localhost:3000
   ```
   - Open `/?rep=dennis`, place an order, confirm it appears in Supabase `orders`.
   - Confirm `inventory` dropped by the right amount.
   - Open `/admin.html`, sign in, run the order pending → paid → fulfilled → closed.
4. **Deploy:**
   ```bash
   vercel --prod
   ```
   Add every env var in Vercel (Settings → Environment Variables), set `PUBLIC_BASE_URL`
   to your live URL, redeploy so invoice links are absolute.
5. **Hand out links:** `https://YOUR-APP.vercel.app/?rep=dennis` (etc.).

## Notes

- Server reprices/re-validates every line and the rep — the client is never trusted.
- Invoice numbers are date-based (`2026-08-29-01`).
- The invoice link is returned from `submit-order` and rendered at `/api/invoice?id=...`;
  copy it to the customer however you text them.
- Admin auth is a single shared password checked server-side; for production, add real
  per-user auth in front.
- Neutral demo catalog (coffee). Swap in any lawful products via `catalog.js` + `inventory`.
- Product names/prices/packs live ONLY in `catalog.js`; the form loads them from
  `/api/catalog` at runtime, so there's no second copy to edit. Keep each `sku` stable
  (it ties orders to `inventory`); add an `inventory` row for any new SKU. Edits show on
  the form within ~1 minute (short cache) or immediately on hard refresh.
