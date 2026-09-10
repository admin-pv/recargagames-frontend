# Recarga Games — Frontend Reference (full, current state)

Location: `Frontend Final/HTMLs/` (pages) + `Frontend Final/shared/` (data + store logic).

This is a complete reference to what exists today, how it works, and what still needs a real backend — written for whoever is connecting the backend next. It describes current behavior only (not a changelog of who built what when).

**The one-line summary: this is a static, no-backend prototype.** Every page is plain HTML/CSS/JS (no build step, no framework). All "persistence" — login session, orders, linked game accounts, offer completions — lives in the browser's `localStorage` via one shared script (`shared/js/store.js`). There is no server, no database, no real payment gateway, no real email, and no real auth. Every place that looks like it's calling an API is actually reading/writing `localStorage` and simulating a delay with `setTimeout`.

## 1. Folder structure & how pages link together

```
Frontend Final/
  HANDOVER.md              ← this file
  HTMLs/                   ← every page, plain .html, all linked by filename
  shared/
    data/products.js       ← window.RECARGA_PRODUCTS (full catalog)
    data/orders.js         ← window.RECARGA_SEED_ORDERS (seed order history)
    data/offers.js         ← window.RECARGA_SEED_OFFERS (seed Offerwall offers)
    data/coupons.js        ← window.RECARGA_SEED_COUPONS (demo discount codes)
    js/store.js            ← window.RecargaStore (all read/write logic, localStorage-backed)
```

Pages link to each other by exact filename — keep these if renaming anything (grep for the old name across `*.html`):

| File | Role |
|---|---|
| `index.html` | Homepage / catalog. Client-side search + category filter over the full product list. |
| `product.html` | Product detail + purchase. `?id=<productId>` selects the product. Collects redemption fields, delivery method, payment method, then creates + completes an order. |
| `checkout.html` | Retry-payment page for a failed order only. `?retry=<orderId>` (optionally `&method=pix`). Not part of a first-time purchase. |
| `order-details.html` | Single order status/receipt. `?id=<orderId>`, plus `&new=1` / `&retried=1` to show a success banner. |
| `my-orders.html` | Order history list for the current (fake) session. |
| `account-login.html` | Login / signup (tabbed, one page), forgot-password UI, and a 3-step post-signup onboarding wizard. `?redirect=<url>` sends the user somewhere specific after login. |
| `account-profile.html` | Account settings — 5 tabs (Dados pessoais, IDs de jogos, Pagamento, Segurança, Notificações) plus a Pedidos summary. LGPD data-export/delete actions. |
| `campaign.html` | "Página de campanha" = Offerwall — user completes a rewarded offer, earns store credit. See §6. |
| `404.html` | Not-found page. |
| `coming-soon.html` | Generic placeholder — anything not built yet links here with `?from=Label`. |
| `about.html`, `contact.html`, `faq.html`, `help-center.html`, `terms.html`, `privacy-policy.html`, `cookie-policy.html`, `refund-policy.html` | Static/skeleton pages — see §7. |
| `recarga_games_cadastro_master_orange_final_balanced_divider_last_one.html` (in `HTMLs/`, listed elsewhere as `Landing Page.html`) | Standalone Brazil early-access/waitlist landing page. Intentionally **not** linked into the site nav — separate campaign asset, own header, not part of the shared data layer. |

`index.html` and `404.html` keep those exact names on purpose (default document / default error page for most static hosts). Everything else uses plain descriptive names.

Nav: every page except `account-login.html` and the standalone landing page carries the same `desktop-nav` (Loja · Todos os jogos · Ganhe créditos · Meus pedidos · Suporte) and the same footer, copy-pasted per page (no shared header/footer partial/template — there's no build system to support one). If you change the nav or footer, you currently have to change it in every `.html` file by hand (or introduce templating).

## 2. Visual system

- Fonts: Google Fonts `Barlow` (400–900) + `Barlow Condensed` (700–900), loaded per-page via `<link>`.
- Color tokens (CSS custom properties, redeclared per-page in each `<style>` block — not a shared stylesheet):
  `--void:#0D0F1A` `--page:#090C14` `--surface:#1A1D2E` `--surface-2:#151A2A` `--warm:#F5F4F0` `--muted:#9B99A8` `--muted-2:#777588` `--border:#2E3047` `--border-2:#454967` `--orange:#F5700A` `--orange-hi:#FF8C2A` `--lime:#2ECC8A` `--gold:#F0B429` `--danger:#FF5C47`.
- Every page's CSS/JS is inline in the `.html` file itself — nothing is bundled or shared except the 4 scripts in `shared/`.
- Recurring components you'll see re-implemented per page: `.card`, the "handover-box" dashed-orange callout (used on unfinished pages to flag what's pending), the cart-empty modal, a "processing…" spinner modal.

## 3. `shared/js/store.js` — full `RecargaStore` API

Everything is backed by two `localStorage` keys: `recarga_orders_v1` (orders) and `recarga_user_v1` (the single "current user" — this prototype only ever supports one logged-in user per browser, no multi-account switching).

| Function | What it does today (localStorage) | What a real backend needs to do |
|---|---|---|
| `getParam(name)` | Reads a query-string param. | n/a — pure utility, keep as-is. |
| `formatBRL(value)` | `Intl`-formats a number as `R$ x,xx`. | n/a — pure utility. |
| `formatDate(iso)` | Formats an ISO date, pt-BR. | n/a — pure utility. |
| `getProducts()` | Returns `window.RECARGA_PRODUCTS`. | Replace with a real catalog fetch (`GET /products`). |
| `getProductById(id)` | Finds one product in that array. | `GET /products/:id`. |
| `relatedProducts(product, max)` | Picks from `product.related` then backfills with other products. | Can stay client-side once real product data has the same shape, or move server-side. |
| `getOrders()` | Reads `recarga_orders_v1` (seeding it from `RECARGA_SEED_ORDERS` on first read), sorted newest first. | `GET /orders` (scoped to the logged-in user). |
| `getOrderById(id)` | Finds one order in that list. | `GET /orders/:id`. |
| `generateOrderId()` | `"RG-" + random 5 digits`. | Real order IDs come from the backend. |
| `createOrder(order)` | Unshifts a new order (`status: "processing"`) into the list. | `POST /orders` — **this is where a real payment/fulfillment call has to happen.** Today this call and `completeOrder()` below are two separate steps with a fake delay in between; a real integration will likely collapse them into one request whose response tells the page whether it succeeded, failed, or needs the retry flow. |
| `completeOrder(id)` | Marks an order `completed`, sets `completedAt`, auto-generates a redeem code (see below) for code/gift-card products if missing. | Should reflect a real payment-gateway callback/webhook, not be callable directly by the client. |
| `generateRedeemCode()` | Random `XXXX-XXXX-XXXX-XXXX` string. | Real code issuance (from the game/gift-card publisher's API) has to happen server-side; this is purely a prototype stand-in. |
| `getUser()` / `isLoggedIn()` | Reads/checks `recarga_user_v1`. | Real session/auth check. |
| `login(user)` | **Does not check a password at all.** Just writes `{name, email, memberSince, ...}` to `localStorage`. See §5 — the login/signup forms validate password length client-side but never send or store the password anywhere. | Real authentication. This is the biggest gap — there is currently zero password verification in this prototype. |
| `logout()` | Clears `recarga_user_v1`. | Real session invalidation. |
| `updateUser(patch)` | Shallow-merges into the stored user object. | `PATCH /me`. |
| `getLinkedAccounts()` / `getLinkedAccountsForProduct(id)` | Reads `user.linkedAccounts` (saved player IDs per game, so `product.html` can offer a pre-fill). | Could stay as a `PATCH /me` sub-resource, or become its own `/me/linked-accounts` endpoint. |
| `addLinkedAccount(entry)` / `removeLinkedAccount(id)` | Push/filter on `user.linkedAccounts`, then `updateUser`. | Same as above. |
| `statusLabel(status)` | Maps `completed/processing/failed` → pt-BR label. | n/a — pure utility. |
| `getOffers()` | Returns `window.RECARGA_SEED_OFFERS`. | See §6 — real offers should come from the rewarded-traffic partner (TyrAds). |
| `getOfferById(id)` | Finds one offer. | Same. |
| `getCompletedOfferIds()` | Reads `user.completedOfferIds`. | Same. |
| `completeOffer(id)` | Pushes onto `user.completedOfferIds` via `updateUser`. **No verification of any kind** — anyone can call this from the browser console and "complete" any offer. | Must become a server-verified step (partner postback/callback) before crediting anything real. |
| `getCoupons()` | Returns `window.RECARGA_SEED_COUPONS`. | Real catalog fetch — see §4a. |
| `getCouponByCode(code)` | Case-insensitive lookup in that array. Used by `product.html`'s coupon field (§5). | `POST /coupons/validate` (or similar) — needs usage limits, expiry, per-user restriction, none of which exist client-side today. |

**Missing from `RecargaStore` today:** `getTodayOrderCount()`. `product.html` calls it (defensively — `typeof RecargaStore.getTodayOrderCount === 'function'`) to show a "+N recargas hoje" trust badge; since the function doesn't exist, the badge just never renders. Nothing is broken, but if that badge is wanted, this needs implementing against real order data (and only with real numbers — there's a comment in the code explicitly flagging fabricated stats as a CDC/consumer-law risk).

## 4. `shared/data/*.js` — data shapes

### `products.js` → `window.RECARGA_PRODUCTS`
Array of ~22 top-level products (Mobile Legends, Free Fire, PUBG Mobile, Honkai Star Rail, Valorant, Genshin Impact, Arena Breakout, ZZZ, Blood Strike, Marvel Rivals, League of Legends, Roblox, Candy Crush, Steam, PlayStation, Google Play, Nintendo eShop, Xbox, Apple, Razer Gold, plus two Free Fire "weekly/monthly pass" variants), each shaped like:

```js
{
  id, name, short, category, type,        // type: "direct" | "code" | "giftcard"
  platform, color, popular, status,
  teaserPrice, art, search,
  redemption: {
    fields: [                              // empty array for code/giftcard products
      { key, label, placeholder, pattern, help }   // e.g. playerId, zoneId, riotId
    ]
  },
  paymentFees: { pix, boleto, card, operadora },   // multipliers applied to price (e.g. card: 1.03 = +3%)
  packages: [
    { id, label, detail, price, originalPrice, tag, tagClass }
  ],
  related: [ /* other product ids */ ]
}
```
`type` drives a lot of page behavior: `"direct"` products (12 of them) need in-game IDs (`redemption.fields`) and go through the player-ID collection flow; `"code"`/`"giftcard"` products (3 + 7) have no fields and instead offer the "receive by e-mail or WhatsApp" choice and get an auto-generated redeem code on completion.

### `orders.js` → `window.RECARGA_SEED_ORDERS`
6 seed orders (used only the first time `getOrders()` runs on a fresh browser, before any real order exists). Shape:
```js
{ id, productId, packageId, packageLabel, packageDetail, qty, amount, paymentMethod,
  status,            // "completed" | "processing" | "failed"
  createdAt, completedAt?, failedAt?, failReason?,
  playerId?, zoneId?, riotId?,  // whichever redemption fields that product needs
  email, code? }                // code present for completed code/giftcard orders
```

### `offers.js` → `window.RECARGA_SEED_OFFERS`
3 seed Offerwall offers — see §6.

### `coupons.js` → `window.RECARGA_SEED_COUPONS` (§4a)
```js
{ code, type, value, label }   // type: "percent" | "fixed"
```
2 demo codes today (`BEMVINDO10` = 10% off, `RECARGA5` = R$5 off). Used by `product.html`'s coupon field via `RecargaStore.getCouponByCode()`. No usage limits, expiry, or per-user restriction — anyone can read this file and see every valid code, so real coupon logic has to move server-side before launch.

## 5. Page-by-page detail

### `index.html`
Client-side catalog: renders from `RECARGA_PRODUCTS`, with a search box (`state.query`, matches against each product's `search` field) and category filter chips (`state.filter`), all client-side, no pagination/API. "Meus pedidos", "Entrar/Cadastre-se" and **"Suporte"** nav buttons all go to real pages now (`my-orders.html`, `account-profile.html`, `help-center.html`) — the Suporte link used to send to `coming-soon.html` instead of `help-center.html`, inconsistent with every other page; **fixed**. There's also a leftover `openDrawer()` function with dead code paths for `account`/`orders`/`support` (unreachable — those three now short-circuit to a real page before ever reaching the drawer); only the `language` and `product`-preview drawer content is still actually used, and the language drawer is decorative (PT-BR only, "Inglês e espanhol entram depois").

### `product.html`
`?id=<productId>` selects the product (falls back to the first product in the catalog if missing/invalid). Key behaviors:
- **Delivery method** (code/giftcard products only — `redemption.fields.length === 0`): choice between e-mail and **WhatsApp**. In WhatsApp mode the phone field becomes the required contact field and the e-mail field is hidden/inactive, and vice versa.
- **Redemption fields** (direct products only): rendered dynamically from `redemption.fields`, each with its own pattern-based validation and a `help` hint.
- **Saved account pre-fill**: if the buyer is logged in and has a `RecargaStore.getLinkedAccountsForProduct()` match, a `<select>` offers to pre-fill the ID fields instead of retyping them.
- **Coupon field** (`#coupon`, "Tenho um cupom de desconto"): now functional as a client-side demo. "Aplicar" (or Enter) looks the code up via `RecargaStore.getCouponByCode()` against `shared/data/coupons.js` (2 demo codes today — see §4a), applies a percent/fixed discount through `applyCouponDiscount()`, and that discount flows into every price shown on the page (per-payment prices, card installment note, summary total, sticky bar total) plus the final order (`couponCode`/`discountAmount` fields on the object passed to `createOrder`). Still entirely client-side — no usage limits, expiry, or per-user restriction; real validation needs to move server-side (§3, `getCouponByCode`).
- **Checkout**: `handleCheckout()` validates everything, shows a processing overlay, then calls `RecargaStore.createOrder(...)` immediately followed by `RecargaStore.completeOrder(order.id)` (i.e., in this prototype every purchase "succeeds" instantly — there's no simulated failure path from `product.html` itself; failures only exist in the seed data / via `checkout.html`'s retry flow), then redirects to `order-details.html?id=...&new=1`.
- **"+N recargas hoje" trust badge**: calls the still-missing `RecargaStore.getTodayOrderCount()` — see §3.
- No cart, no quantity selector — one product, one package, one unit, straight through. If multi-unit purchasing is ever wanted for direct-topup products, that needs a backend decision first: a single atomic top-up call for the full amount is safe, but a naive "call the publisher's API N times" risks partial fulfillment (charged for 5, receives 4) with no partial-refund/retry mechanism in this data model today.

### `checkout.html`
Retry-only, reached via `?retry=<orderId>` (optionally `&method=pix`). Looks up the order via `RecargaStore.getOrderById()`; if not found (e.g., `order-details.html`/real orders aren't wired up in whatever environment this runs in, or the ID is bogus), falls back to a bundled `DEMO_ORDER` so the page always previews something. Lets the buyer pick Pix/Cartão/Boleto (defaults to the failed order's own method, or Pix if the failed method was card), shows a processing overlay, calls `RecargaStore.completeOrder()`, redirects to `order-details.html?id=...&retried=1`. Note: there is a stale in-code comment here claiming `order-details.html` isn't wired to real data yet — that's out of date, `order-details.html` has read real order data via `?id=` for a while; the comment just wasn't updated.

### `order-details.html`
Pure read: `?id=` → `RecargaStore.getOrderById()` + `getProductById()`. Shows a proper "pedido não encontrado" empty state if the ID doesn't resolve, instead of fabricating data. Success banner only shows with `?new=1` or `?retried=1` in the URL (not on every revisit). Field rendering (player ID, zone ID, etc. on the receipt) is generic, driven off `redemption.fields`, so it doesn't need per-product code.

### `my-orders.html`
Straight list from `RecargaStore.getOrders()` (already sorted newest-first by the store). Has an empty state, order-count stats, and per-order action buttons ("Comprar novamente" → `product.html?id=...`, "Tentar novamente" on a failed order → `checkout.html?retry=<id>`).

### `account-login.html`
Tabbed Login / Cadastro / Esqueci senha, all one page/one form-set shown/hidden by JS (`setMode()`), plus a **3-step onboarding wizard shown right after signup only** (not on login): step 1 confirms name/e-mail/phone, step 2 is a multi-select "favorite games" chip grid, step 3 asks nickname + language + a marketing opt-in checkbox. On finish, all of it gets merged into the user object via `RecargaStore.updateUser()`. This onboarding flow isn't mentioned anywhere else in the codebase — it's easy to miss if you're only skimming `account-profile.html`.

**Login and signup do not perform any real authentication — and this is intentionally left as-is, not stubbed with fake verification.** `loginForm`'s submit handler validates that the e-mail looks like an e-mail and that a password was typed (any non-empty value), then calls `RecargaStore.login({name: email.split('@')[0], email})` — the password itself is never read into that call, never stored, never checked against anything. Signup is the same: name/e-mail/password-length/terms-checkbox are validated client-side, but the password again never leaves the form. Both spots (plus `RecargaStore.login()` itself in `store.js`) now carry an explicit `NOT REAL AUTH` comment block explaining this, so it can't be mistaken for a working check. This needs a real `POST /login` / `POST /signup` wired in before launch — deliberately not simulated here, since a fake client-side credential check would be actively misleading about how much security exists.

"Esqueci minha senha" swaps in an e-mail field, then always shows the same "Verifique seu e-mail" confirmation regardless of whether that e-mail exists (deliberate — avoids leaking which addresses are registered). No e-mail is actually sent.

`?redirect=<url>` on this page's URL sends the user there after a successful login/signup instead of `index.html`.

### `account-profile.html`
Five tabs:
- **Dados pessoais** — name/e-mail/etc. form, saved via `RecargaStore.updateUser()`.
- **IDs de jogos** — manage linked game accounts (`addLinkedAccount`/`removeLinkedAccount`/`getLinkedAccounts`), used by `product.html`'s pre-fill.
- **Pagamento** — **decorative only**, "Nenhum cartão salvo ainda" / "Adicionar cartão" button is `disabled` with an "Em breve" badge. No saved-card storage exists anywhere.
- **Segurança** — password-change form. **Entirely fake**: validates current/new/confirm client-side, then just clears the fields and shows a "Senha atualizada" success banner. Nothing is sent or stored anywhere.
- **Notificações** — toggle switches for order e-mail / order WhatsApp / promo notifications. Used to only mutate an in-memory `user.notifications` object without ever calling `RecargaStore.updateUser()`, so changes were lost on reload; **fixed** — the toggle handler now persists via `updateUser({ notifications: user.notifications })`.

Also has LGPD actions: **Baixar meus dados** (downloads a JSON blob of `RecargaStore.getUser()` + `getOrders()`, entirely client-side) and **Excluir minha conta** (a `window.confirm()` dialog, then `RecargaStore.logout()` and redirect — order history is deliberately *not* deleted, per a code comment about tax/financial retention requirements; a real implementation should soft-delete/anonymize the profile rather than hard-delete, and that approach should be confirmed with legal).

### `campaign.html` — "página de campanha" = Offerwall
Full context: `claude/campaign-offerwall-context.md` in the Claude project (background on the TyrAds conversation this came from). Current state:
- Offers come from `shared/data/offers.js` (`RECARGA_SEED_OFFERS`, 3 seed offers), read via `RecargaStore.getOffers()` — deliberately data-driven rather than hardcoded HTML, since the TyrAds "rewarded traffic" model expects reward structures to be tested per user segment rather than fixed.
- "Iniciar oferta" shows a processing overlay (same visual pattern as `checkout.html`'s payment overlay), waits ~1.2s, then calls `RecargaStore.completeOffer(id)`, which marks it done on `user.completedOfferIds`.
- **No real TyrAds (or any partner) integration exists.** `completeOffer()` has zero verification — it's directly callable and immediately "succeeds." A real integration needs: (a) redirecting to/embedding the actual partner offer instead of a fake timer, and (b) only calling `completeOffer()` from a server-verified postback/callback, never directly from the browser.
- Whether completing an offer should require login first is an open question — today it doesn't, and will silently create a partial `user` object in `localStorage` (no name/e-mail) if none exists yet.
- The real offer catalog/reward amounts are still pending more detail from Vinícius.
- The "Ganhe créditos" nav link now points here from every other page (added across the whole site — see the nav table in §1); the offer itself is not connected to anything real yet.

## 6. What's actually static (no logic at all)

`about.html`, `contact.html`, `faq.html`, `help-center.html`, `terms.html`, `privacy-policy.html`, `cookie-policy.html`, `refund-policy.html`. Each has the real site header/footer already in place, plus a dashed-orange "Para quem for finalizar esta página" box listing exactly what that specific page still needs (legal copy, content source, etc.) — read that box on each page rather than duplicating it here. Two worth flagging:
- **`refund-policy.html`**: added because a store selling non-returnable digital goods (game credits, gift cards) generally needs a stated trocas/reembolso policy under Brazil's CDC.
- **`terms.html`**: the signup checkbox on `account-login.html` is *required* and points here — this page's content is a hard launch blocker, not a nice-to-have.

`404.html` and `coming-soon.html` (`?from=Label` customizes the message) are also fully static.

## 7. Consolidated list of known gaps / decisions needed

- **No real auth anywhere.** Passwords are validated client-side (length only) and never transmitted or stored. This is the single biggest thing to replace.
- **No real payment gateway.** Every "payment" is a `setTimeout` + `completeOrder()`. Pix/Cartão/Boleto/Operadora are just labels with a fee multiplier, not integrations.
- **No real fulfillment.** Redeem codes are randomly generated client-side; direct top-ups never actually call a game publisher's API.
- **No cart / no multi-unit purchase.** Every purchase is one product, one package, one unit. See `product.html` notes in §5 for the specific risk (partial fulfillment on direct top-ups) if this changes.
- ~~Notification toggle bug: changes on the Notificações tab weren't persisted.~~ **Fixed.**
- ~~`index.html`'s "Suporte" link went to `coming-soon.html` instead of `help-center.html`.~~ **Fixed.**
- ~~Coupon field on `product.html` was decorative.~~ **Fixed as a client-side demo** (§4a, §5) — still needs real server-side validation before launch.
- **`RecargaStore.getTodayOrderCount()`** doesn't exist — the trust badge on `product.html` silently never shows.
- **Placeholder WhatsApp numbers** (`55XXXXXXXXXXX` / `5500000000000`) still in `product.html`/`index.html` — need the real support number before launch.
- **Offerwall (`campaign.html`)**: no real TyrAds integration, no server-side verification, login requirement undecided, real offer catalog pending.
- **"Pagamento" tab / saved cards** on `account-profile.html`: not built, explicitly marked "Em breve."
- **Password change** on `account-profile.html`: fake success, nothing persisted.
- **No shared header/footer template** — every page duplicates the same markup; changing nav/footer site-wide currently means editing every `.html` file.

## 8. Suggested order of work

1. Real auth (login/signup/session) — this blocks almost everything else being meaningful.
2. Replace `shared/js/store.js`'s localStorage calls with real API calls, keeping the same function names/signatures so the pages themselves don't need to change (`getOrders`, `createOrder`, `completeOrder`, `getUser`, `updateUser`, `getOffers`, `completeOffer`, etc.).
3. Real payment gateway wired into `product.html`'s `handleCheckout()` and `checkout.html`'s retry flow, replacing the instant-success `setTimeout`.
4. Real fulfillment: redeem-code issuance and direct top-up calls to each game's publisher API, plus a decision on the multi-unit/DTU risk in §5 before any cart or quantity feature is added.
5. TyrAds (or whichever partner) integration for `campaign.html`, with server-side offer verification before `completeOffer()` is ever called, and a decision on whether login is required first.
6. Real coupon validation server-side (usage limits, expiry, per-user restriction) to replace the `shared/data/coupons.js` demo list.
7. Decide the FAQ/Help Center content model (static vs. admin-editable), get final legal copy into the 4 legal pages, wire up real e-mail delivery for the forgot-password flow, and drop in real WhatsApp/support contact details.
8. Saved-card / "Pagamento" tab on the profile page, if wanted — currently entirely unbuilt.
