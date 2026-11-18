# Smartlaunch Booking

Customer-facing PC booking site for a Smartlaunch center. Built with SvelteKit and deployed as a Cloudflare Worker (free tier), with a Cloudflare D1 database for online payments.

It talks to the center's Smartlaunch server REST API (`sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb`), the same API the MVC web client uses. Customers log in with their Smartlaunch account, pick a date, time and duration, choose free PCs on the center layout, and confirm. They can also top up their account balance online (SumUp for now; see [Payments](#payments)).

## How it works

```
Browser ──► Cloudflare Worker (SvelteKit pages + /api/*) ──Basic auth──► Smartlaunch server REST API
                    │        ▲
                    ▼        │ webhooks
              D1 (orders)   Payment provider (SumUp)
```

The REST API is protected by one shared Basic-auth credential, so the browser never calls it directly. The Worker holds that credential as a secret and exposes only what a customer needs. Sessions are HMAC-signed cookies. The D1 database only records payments; balances, bookings and accounts stay on the Smartlaunch server.

| App endpoint | Smartlaunch REST call |
| --- | --- |
| `POST /api/login` `{username, password}` | `GET /users/{username}/check?password=` then `GET /users/{username}` |
| `POST /api/signup` `{username, password, email, mobilePhone?, firstName, lastName, address, zip, city, gender, birthday}` | `GET /users/{username}` (is it taken?), `POST /users/create`, then the login calls |
| `POST /api/logout` | none |
| `GET /api/layouts` | `GET /layoutgroups` |
| `GET /api/computerlayoutpositions` | `GET /computerlayoutpositions` |
| `GET /api/computers` | `GET /computers` (trimmed to id, name, group) |
| `GET /api/booking/getbooked?startdate=yyyyMMddHHmm&enddate=yyyyMMddHHmm`<br>or `?start=YYYY-MM-DDTHH:mm&minutes=N` | `GET /booking/getbooked` |
| `GET /api/bookings` | `GET /bookings`, filtered to the logged-in customer |
| `POST /api/bookings` `{start, minutes, computerIds, orderCode?}` | `POST /bookings`, or `POST /bookings/create` when paid online |
| `POST /api/payments/webhook/{provider}` (from the payment provider) | `POST /users/{username}/addmoney` once the payment is confirmed |
| `POST /api/payments/sweep` (from the scheduled job) | `POST /users/{username}/addmoney` for paid orders not yet delivered |

The pages are `/login`, `/signup` (create an account), `/` (book), `/bookings` (my bookings), `/topup` (top up the balance) and `/topup/return` (where the payment provider sends customers back). The flags in the header post to `/lang` to switch language.

### Things worth knowing

- **Times are center wall-clock time.** The server converts booking timestamps with `New DateTime(1970,1,1).AddSeconds(ts)`, with no time zone involved. The app sends and reads timestamps as naive wall-clock seconds (`src/lib/time.ts`), so `18:00` in the form becomes `18:00` in Smartlaunch whatever zone Cloudflare runs in.
- **Availability is re-checked before booking.** The app checks the whole window with `/booking/getbooked` before booking. Smartlaunch servers with `BookingStore` also check the whole interval themselves, atomically, and keep each booking's computers blocked for `BookingBufferMinutes` (server.inf) after it ends, both in `/booking/getbooked` and when booking. Older servers only reject a PC whose existing booking covers the new *start* time, so the app's own check is what protects them.
- **SQL escaping.** The server builds the booking `INSERT` and the sign-up profile `UPDATE` by string concatenation. The app doubles quotes in every text field, allows only numeric PC IDs, restricts order codes to `[A-Z0-9]`, and restricts usernames to letters, numbers, `.`, `-` and `_`.
- **Sign-up.** New accounts go into the server's "members" group (or its first group). First name, last name, street and number, ZIP code, city, gender and date of birth are required (the birthday so age limits on apps keep working); the mobile number is optional. Smartlaunch only knows female (0) and male (1); non-binary is stored as 2, which the server keeps, but the admin program shows it as female and saving the user there turns it into female or male. The server may refuse a username through its profanity filter; the app then asks for another one.
- **Duplicate protection.** Each confirm sends a code from the browser. The app hashes it with the username into the booking's `OrderCode`, so a retried request lands on the same booking and one customer's code can never match another's.
- **Bookings are free** unless prices and a payment provider are both set up (see [Paid bookings](#paid-bookings)).
- **Which bookings are a customer's.** Staff can type any name on a booking, so a booking counts as a customer's only if it has their username *and* was made by them on this site or carries their phone number.

### Abuse limits

Counters live in D1 (`migrations/0003_limits.sql`), so they hold across all Worker instances. A customer who hits one gets a message saying how long to wait.

| What | Limit |
| --- | --- |
| Login | 30 tries per IP address and 10 wrong passwords per username, per 15 minutes |
| Sign-up | 5 accounts per IP address per hour, plus the optional Turnstile check (`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`) |
| Booking | 20 attempts per hour; at most 10 upcoming bookings (`booking.maxUpcomingBookings`); one request at a time per customer |
| Paid booking holds | At most 2 waiting for payment (`payments.maxOpenHolds`); after 4 unpaid holds in an hour, wait an hour (`payments.maxUnpaidHoldsPerHour`) |
| Top-up | 10 checkouts per hour (`payments.topupsPerHour`) |
| Availability, prices, booking list | 120 requests per minute per customer |

The ones named in brackets are set in the [center config](#center-settings); the rest are constants in `booking.ts`, `orders.ts` and the API routes. Booking and top-up also check that the customer's Smartlaunch account still exists; if it was deleted, the session ends.

The site sends a Content-Security-Policy (set in `vite.config.ts`), HSTS over https, `X-Frame-Options: DENY` and `nosniff`. A theme that loads fonts or images from anywhere other than Google Fonts needs that host added to the policy.

## Payments

Customers top up their Smartlaunch balance on `/topup`: they pick an amount, pay on the provider's hosted payment page, and come back to `/topup/return`. Payments are off until `PAYMENT_PROVIDER` is set; the "Top up" link only shows when they're on.

When the center has booking prices as well (see [Booking prices](#booking-prices)), **bookings must be paid online**. See [Paid bookings](#paid-bookings).

### How an order flows

1. `/topup` stores an order in D1 (`pending`) and creates a checkout at the provider with the order id as reference, then redirects the customer to the provider's payment page.
2. When the checkout changes, three things may look at the order: the customer's return page, the provider's webhook, and a scheduled job that runs every 10 minutes. Each one **asks the provider's API** for the checkout's status; a webhook alone is never taken as proof of payment.
3. When the provider reports it paid, and amount, currency and reference match the order, the order becomes `paid` and is credited with `POST /users/{username}/addmoney`, using the order id as Smartlaunch `OrderCode`.
4. If the center server is offline, the order stays `paid` and is retried with growing delays (1, 2, 4 … minutes, at most 6 hours) until it's `delivered`.

Orders are never credited twice:

- **One credit at a time:** a short lease (`delivering`) in D1 lets only one worker credit an order.
- **Retries are safe:** the Smartlaunch server ignores an `OrderCode` it has already credited (`APIParser.UserAddMoney`).
- **Wrong amounts stop:** a checkout paid for a different amount or currency than the order is marked `failed` and not credited; check `last_error` in D1.

To see stuck or failed orders:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id, username, amount_cents, status, attempts, last_error FROM orders WHERE status NOT IN ('delivered', 'expired') ORDER BY created_at DESC"
```

### Paid bookings

A booking is held first and paid second, so the same PCs are never sold twice:

1. **Hold.** When the customer confirms, the server prices the booking and books the PCs in Smartlaunch with `POST /bookings/create`. The description says `Awaiting online payment, order BK…; cancelled if unpaid.` Nobody else can book those PCs now.
2. **Pay.** The customer goes to the provider's payment page. The checkout expires when the hold does, 15 minutes later (`BOOKING_HOLD_MINUTES` in `orders.ts`).
3. **Confirm.** Once the provider reports the payment, the booking is updated with `PUT /bookings/{id}` to `Paid online, order BK…, SumUp TEENSK4W2K. Price EUR 9.50 (R7: …).` The customer lands on `/book/return`, which shows the result and the booking number.
4. **Release.** If the payment fails or the hold runs out, the booking is cancelled with `DELETE /bookings/{id}` and the PCs are free again. The return page, the webhook and the 10-minute scheduled job all do this, whichever comes first.

A payment can still slip through just as a hold is released. Released orders are checked for an hour afterwards:

- **The PCs are still free:** they are booked again and the order is delivered.
- **Someone else has taken them:** the order becomes `needs_refund`, the log shows `PAID AFTER ITS HOLD ENDED`, and the customer is asked to contact the center. Refund them in the SumUp dashboard. Find these orders with:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id, username, amount_cents, created_at FROM orders WHERE status = 'needs_refund'"
```

**Matching a payment to its booking.** Three numbers link them:

| Number | Example | In Smartlaunch | In SumUp | Customer sees it |
| --- | --- | --- | --- | --- |
| Booking number | `#1234` | the booking's number | payment description | confirmation page, My bookings |
| Order number | `BKX7K2M9QP4RT8WZ3N` | booking description and order code | payment description and checkout reference | confirmation page |
| SumUp transaction code | `TEENSK4W2K` | booking description, once paid | transaction details | SumUp receipt |

In the Smartlaunch admin program, the booking calendar labels each booking `#1234 username`; clicking it shows the number and name at the top, the order number and SumUp code in the note, and **Paid**: NO while the booking waits for payment (or is to be paid at the venue), YES once paid online. Showing the number and setting Paid need the matching admin and server builds; older servers ignore the paid state and show every website booking as paid.

The SumUp payment description reads `Booking #1234, 2026-11-05 17:00, 2 stations, Pro, order BK…`. In D1, `orders` holds all three (`booking_id`, `id`, `provider_txn`). If a late payment is booked again under a new booking number, the order number and transaction code still match. Top-up payments are described as `Top-up <username>, order TU…`. Migration `0004_transaction_code.sql` adds `provider_txn`.

This needs a Smartlaunch server with `BookingStore`, which provides `/bookings/create`, `PUT` and `DELETE /bookings/{id}`. Older servers answer 404 and no booking can be made. Run `npm run db:migrate` (and `db:migrate:local`) for migration `0002_booking_orders.sql`.

### SumUp

1. In the SumUp Dashboard, go to *Developers* and create an **API key**, and note your **merchant code** (shown in your profile, e.g. `MH4H92C7`). For testing, create a sandbox merchant account and use its key.
2. Set `PAYMENT_PROVIDER=sumup`, `SUMUP_API_KEY` (as a secret) and `SUMUP_MERCHANT_CODE`, and make sure `center.currency` in the [center config](#center-settings) is the currency of your SumUp account (e.g. `EUR` or `DKK`).
3. Deploy. Checkouts tell SumUp to send status webhooks to `https://<your site>/api/payments/webhook/sumup`; nothing needs to be registered in the dashboard. Webhooks are only sent when the site runs on `https`, so local runs rely on the return page and the scheduled job.

SumUp's payment page is available for 30 minutes per checkout. A checkout that SumUp reports as failed can still be retried on that page, so the order is only marked `failed` after an hour; checkouts never paid are marked `expired` after a day.

### Adding a payment provider

Providers live in `src/lib/server/payments/`. To add one (Adyen, Stripe, Square, Bambora, …):

1. Write `src/lib/server/payments/<name>.ts` implementing `PaymentProvider` from `provider.ts`: `createCheckout` (create a hosted checkout, return its id and payment page URL), `getCheckout` (read its current status, amount, currency and reference) and `parseWebhook` (pull the checkout id out of a webhook request). See `sumup.ts`.
2. Add a `case '<name>'` to `create()` in `payments/index.ts`, and its settings to `src/env.ts`.
3. Set `PAYMENT_PROVIDER=<name>`.

The order logic (`src/lib/server/orders.ts`), pages and database don't change. Webhooks arrive at `/api/payments/webhook/<name>`. They are only used as a hint to re-check the checkout, so providers without signed webhooks are fine. A provider that signs its webhooks can check the signature in `parseWebhook` as well. SvelteKit rejects cross-site POSTs that have no content type or a form content type, so a provider that posts webhooks that way needs a different route.

## Center settings

Everything a center customizes lives in one file, `centers/<name>/config.jsonc`, and the `CENTER` variable picks which folder a deployment uses (`default` if unset). One deployment serves one center, with its own database and its own config file. The file holds:

| Section | What it sets |
| --- | --- |
| `center` | Name in the header, time zone, currency, default language, theme |
| `booking` | Shortest and longest booking, the durations offered, arrival time step, earliest start (start grid and lead time), PCs per booking, upcoming bookings per customer, PCs excluded from online booking |
| `pricing` | Price plans, their hourly rates and peak times, zones of PCs priced differently (e.g. VIP), which user group gives which plan, guest and one-discount rules, whole rooms; `null` for no prices |
| `payments` | Top-up amounts and range, how long PCs stay held while a customer pays, hold and top-up limits |
| `signup` | Whether visitors can create accounts, minimum age |

`centers/default/config.jsonc` documents every setting with its default; a setting left out of a center's file gets that default. To set up a new center, copy `centers/default` to `centers/<your-center>`, edit the copy, and set `CENTER=<your-center>`. Credentials and connection details are not in the file; they stay in [environment variables](#configuration).

The file is checked when the site starts. A typo in a setting name, a bad time or an unknown plan stops the site with a message listing every problem, rather than taking bookings with the wrong rules. `npm test` checks every center's file too, so run it before deploying. The config is bundled at build time, so a change needs a new build and deploy.

Variables that used to hold these settings (`PUBLIC_CENTER_NAME`, `CENTER_TIMEZONE`, `DEFAULT_LANGUAGE`, `THEME`, `PAYMENT_CURRENCY`, `PUBLIC_ALLOW_SIGNUP`, `EXCLUDED_PCS`, `PRICE_RULES`, `PLAN_GROUPS`, `TOPUP_*`) are no longer read. If one is still set, the server logs where it now belongs in the config.

## Booking prices

When the center's config has a `pricing` section, the booking page shows what the selected stations cost, and the price is written into the booking's description in Smartlaunch (e.g. `Price EUR 15.50 (R7: 1 x campus EUR 3.50, 1 x rookie EUR 12.00).`). If a payment provider is set up too, customers pay that price online to book (see [Paid bookings](#paid-bookings)). Without one, bookings are made unpaid and the page says nothing is charged online. With `"pricing": null`, no prices appear anywhere.

A price list is made of:

- **Periods:** named time windows, e.g. `"peak": [{ "days": ["mon-thu"], "from": "17:00", "to": "20:00" }, ...]`. A window can't run past midnight; split it in two.
- **Plans:** each has an hourly `rate` and optional `rates` that override it during a period (or inline days and times). The first matching entry wins.
- **Zones:** PCs priced differently, such as a VIP room or consoles. A zone lists Smartlaunch PC groups (`groups`) and/or PC names or IDs (`pcs`); a PC in several zones belongs to the first. A plan's `zones` give a zone its own `rate` and `rates`, e.g. `"zones": { "vip": { "rate": 8 } }`. A zone a plan doesn't list costs that plan's normal rate, and PCs in no zone always do. The price shown and written into the booking names the zone (`1 x rookie/vip EUR 8.00`).
- **Which plan a customer gets:** from their Smartlaunch user group. A plan's `groups` lists the group names that give it; without `groups`, a group named like the plan's id or name (any case) does. Anyone else gets `defaultPlan`. To change a customer's plan, move them to another user group in the admin program.
- **`guestPlan`:** extra stations in the same booking are for friends and cost this plan's rate. The customer's own rate goes on the station where it saves the most (so a member booking a normal and a VIP PC gets their rate on the VIP one). Without a guest plan, every station gets the customer's own rate.
- **`oneDiscountAtATime`:** a customer who already has a booking at that time gets the default plan's rate for the new one.
- **`version`:** the price list's name, written into each booking it priced. Change it when you change prices, so bookings show which prices they were made under.

Prices are worked out the same way for every center:

- **A booking is split wherever the rate changes**, and each station's price is rounded once to whole cents. Fri 16:30–17:30 at €5, or €6 from 17:00, is €2.50 + €3.00 = €5.50.
- **The server always recalculates the price.** The browser never sends an amount.
- **Whole-room prices are in the engine but not on the site yet.** `quoteRoom` prices the config's `rooms`: capacity × the room's seat rate over each segment, for the whole hours it allows, plus optional catering per guest.

`centers/esportsnord/config.jsonc` is the eSports Nord HUB price list, revision R7 (November 2026):

| Plan | Per station per hour (PC or console) |
| --- | --- |
| Rookie | €5, or €6 at peak: Mon–Thu 17:00–20:00, Fri 17:00–22:00, Sat–Sun 15:00–22:00 |
| Campus | €1 Mon–Fri 13:00–18:00, otherwise €2.50; no peak surcharge |
| Pro | €2.50 at all times |
| Alpha | €1 at all times |
| TEAM | €2 at all times (private use; included training is arranged by staff) |

Extra stations cost the Rookie rate, and a member gets one discounted session at a time. The rooms (MIXED ZONE 10, BATTLE ARENA 12, CONSOLE ZONE 6, CINEMA LOUNGE 4) cost €4 per seat per hour (€5 at peak, the R6 room prices) for 2–6 whole hours, plus optional catering at €10 per guest.

`npm test` prices the arithmetic cases of the R6 acceptance tables (P, E and R series, with the station prices updated to R7) from that file, so it proves the file states the HUB's rules. It doesn't need a server.

## Languages

The site is available in English, German and Danish. Visitors switch with the flags in the header; the choice is kept in a `lang` cookie for a year. Without that cookie the site follows the browser's preferred languages, then the center's `center.defaultLanguage`, then English.

Error messages from the app's API (`/api/*`) come back in the same language.

All text lives in `src/lib/i18n/`: `en.ts` is the reference, and `de.ts` and `da.ts` must define every key it has (the type check fails otherwise). To add a language, add a file such as `fr.ts`, then register it in `LOCALES`, `LANGUAGE_NAMES`, `INTL_LOCALES` and the dictionaries in `src/lib/i18n/index.ts`, and give it a flag in `src/routes/+layout.svelte`.

## Themes

The site's look comes from a theme in `src/themes/<name>/`. Pick one with `center.theme` in the [center config](#center-settings). If it names a folder that doesn't exist, the `default` theme is used and the server logs a warning.

| Theme | Look |
| --- | --- |
| `default` | Neutral: system fonts, blue accent, rounded corners; follows the visitor's light/dark setting |
| `esportsnord` | eSports Nord brand: red header with a Saffron strip, slanted buttons and panel cuts, hazard stripes, Unbounded / Zen Dots / Montserrat fonts; dark only |

A theme folder contains:

- `theme.css` (required): sets the CSS variables for colours, fonts and shapes, and can add its own rules.
- `favicon.svg` (optional): falls back to the default theme's icon.
- Any images the CSS uses, referenced with relative `url(...)` paths.

`src/themes/default/theme.css` defines every variable with comments, so it doubles as the reference. `src/app.css` and the pages contain only structure.

### Making your own theme

1. Create `src/themes/mytheme/theme.css`, starting from the default theme and overriding only what you want:

   ```css
   /* Web fonts, if any, must come first. */
   @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap');
   @import '../default/theme.css';

   /* :root:root also beats the default theme's dark-mode block; use plain :root to keep it. */
   :root:root {
   	--font-display: 'Poppins', sans-serif;
   	--font-body: 'Poppins', sans-serif;
   	--accent: #e11d48;
   	--accent-hover: #be123c;
   	--seat-picked: var(--accent);
   	--pass-bg: #4c0519;
   }
   ```

2. Optionally add `src/themes/mytheme/favicon.svg`.
3. Set `"theme": "mytheme"` in your center's config and rebuild. Themes are bundled at build time, so a new or changed theme needs a new build and deploy.

To customise an existing theme, copy its folder under a new name and edit that, so updates to the original don't overwrite your changes.

The `esportsnord` theme uses Unbounded as a free stand-in for INTEGRAL CF. To use the licensed font, put the font files in the theme folder, add an `@font-face` for them in its `theme.css`, and put that family first in `--font-display`.

## Configuration

Environment variables hold only credentials, connection details and the choice of center. Prices, booking rules, top-up amounts and the center's name and look are in the [center config](#center-settings).

| Variable | Secret? | Description |
| --- | --- | --- |
| `SL_API_URL` | no | Base URL of the REST API, e.g. `https://booking-api.example.com` |
| `SL_API_USERNAME` | yes | `RESTBasicUsername`, or an employee login if `RESTUseEmployeeLoginAsSecurity` is on |
| `SL_API_PASSWORD` | yes | Matching password |
| `SESSION_SECRET` | yes | Random string of 32+ characters for signing session cookies |
| `CENTER` | no | Folder under `centers/` with this center's settings; defaults to `default` (see [Center settings](#center-settings)) |
| `SL_LICENSE_EMAIL` | no | Optional; adds `?licenseemail=` for relay setups |
| `TURNSTILE_SITE_KEY` | no | Cloudflare Turnstile site key; with the secret below, sign-up asks visitors to prove they're not a robot |
| `TURNSTILE_SECRET_KEY` | yes | Turnstile secret key |
| `PAYMENT_PROVIDER` | no | `sumup` turns on online payments; empty turns them off (see [Payments](#payments)) |
| `SUMUP_API_KEY` | yes | SumUp secret API key |
| `SUMUP_MERCHANT_CODE` | no | SumUp merchant code that receives the payments |
| `SUMUP_API_URL` | no | Only for testing against a mock; defaults to `https://api.sumup.com` |

### Reaching the center server from Cloudflare

Cloudflare Workers cannot fetch bare IP addresses, so `SL_API_URL` must use a hostname. The simplest free option is a **Cloudflare Tunnel** on the server PC. It needs no port forwarding, gives you HTTPS, and keeps the REST port off the public internet:

```sh
cloudflared tunnel login
cloudflared tunnel create smartlaunch-api
cloudflared tunnel route dns smartlaunch-api booking-api.example.com
cloudflared tunnel run --url http://localhost:7833 smartlaunch-api   # use your REST port
```

Then set `SL_API_URL=https://booking-api.example.com`.

## Running locally

Requires Node.js 20 or later, and a Smartlaunch server you can reach from your machine.

**1. Enable the REST API on the Smartlaunch server.** Set `RESTBaseAddressPort` in the server settings; the API then listens on `http://<server IP>:<port>`. If `RESTEnableSecurity` is on, note `RESTBasicUsername` and `RESTBasicPassword`.

**2. Configure the app.**

```sh
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`. For local runs, `SL_API_URL` can be a LAN address:

```
SL_API_URL=http://192.168.1.10:7833
SL_API_USERNAME=<RESTBasicUsername>
SL_API_PASSWORD=<RESTBasicPassword>
SESSION_SECRET=<random string, 32+ characters>
```

**3. Create the local database** (only needed for payments; repeat after adding migrations):

```sh
npm run db:migrate:local
```

**4. Start it.**

```sh
npm run dev                 # http://localhost:5173
```

Log in with a customer account from Smartlaunch.

To run in the real Cloudflare Workers runtime, including the scheduled job, put the same values in `.dev.vars`, then run `npm run build && npm run preview` (http://localhost:4173). With `npx wrangler dev --test-scheduled` instead of `npm run preview`, opening http://localhost:8787/__scheduled runs the scheduled job once.

Other scripts:

```sh
npm run check               # type check
npm run gen                 # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

### With DDEV

Instead of installing Node yourself, you can run the app in [DDEV](https://ddev.com) (Node 24, no MySQL container; D1 stays local SQLite under `.wrangler/`). Do step 1 and create `.env` as in step 2, then:

```sh
ddev start                  # installs packages, applies local migrations, starts Vite
                            # https://smartlaunch-booking.ddev.site:5173
ddev preview                # Workers runtime: https://smartlaunch-booking.ddev.site:4173 (/__scheduled runs the job)
ddev exec npm test          # any npm script works through ddev exec
```

`SL_API_URL` is called from inside the container, so use the server's LAN address, not `localhost`. Vite restarts by itself after you edit `.env`. If it doesn't, run `ddev restart`. Run `wrangler login`, remote migrations and deploys on the host.

**How the Worker is put together:** the SvelteKit adapter writes the app's Worker to `.svelte-kit/cloudflare/_worker.js` (configured by `wrangler.sveltekit.jsonc`, read only by the adapter). The deployed Worker, configured in `wrangler.jsonc`, starts at `worker/index.js`. That file passes requests to the app's Worker and adds the scheduled job, which calls `/api/payments/sweep` with `SESSION_SECRET` as its key.

### Troubleshooting

| Message | Cause |
| --- | --- |
| "The booking service is misconfigured" | On Cloudflare with an IP address in `SL_API_URL`: Cloudflare blocks requests to bare IPs (error 1003); use a hostname. Otherwise the server rejected `SL_API_USERNAME` / `SL_API_PASSWORD`. The Cloudflare logs say which. |
| "The center server could not be reached" | `SL_API_URL` is wrong, the server is down, or a firewall blocks the port |
| `SESSION_SECRET must be set…` in the console | `SESSION_SECRET` is missing or shorter than 32 characters |
| Works locally, fails after deploy | `SL_API_URL` is a LAN or bare IP address; see *Reaching the center server from Cloudflare* |
| "The payment could not be started" | `SUMUP_API_KEY` or `SUMUP_MERCHANT_CODE` is wrong, or `center.currency` in the center config isn't your SumUp account's currency. The Worker logs show SumUp's answer. |
| "Top up" link missing | `PAYMENT_PROVIDER` is empty, or its settings are incomplete (logged at startup) |
| `The D1 database binding DB is missing` | `database_id` in `wrangler.jsonc` isn't set, or the migrations weren't applied |

## Deploying to Cloudflare Workers

The app runs as a Worker, not on Cloudflare Pages, because Pages can't run the scheduled job that finishes payments.

**1. Create the database** (once):

```sh
npx wrangler login
npx wrangler d1 create smartlaunch-booking
```

Copy the printed `database_id` into `wrangler.jsonc`, commit it, then create the tables:

```sh
npm run db:migrate
```

Run `npm run db:migrate` again whenever a new file appears in `migrations/`.

**2a. Deploy with Git integration (recommended).** Push this folder to a Git repo, then in Cloudflare go to *Workers & Pages → Create → Workers → Import a repository* and use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `smartlaunch_booking`, if it lives in a larger repo

Then add the variables above under the Worker's *Settings → Variables and Secrets*, using the **Secret** type for the credentials, and redeploy.

**2b. Or deploy from your machine:**

```sh
npm run deploy
npx wrangler secret put SL_API_USERNAME          # repeat for each secret
```

The site is then at `https://smartlaunch-booking.<your-subdomain>.workers.dev`; add your own domain under the Worker's *Settings → Domains & Routes*.

**Moving from Cloudflare Pages:** create the Worker as above, copy the variables over from the Pages project, move any custom domain to the Worker, then delete the Pages project.

**When the domain's DNS isn't on Cloudflare** (eSports Nord: `booking.esportsnord.com`, DNS at agenturserver). A Worker custom domain needs the domain's DNS in your Cloudflare account, and a CNAME to `workers.dev` doesn't work. Pages does accept an outside CNAME, so the site runs on both:

- **Pages serves the site.** Connect the repo as a Pages project with build command `npm run build`. Under *Settings → Variables and Secrets* add every variable from [Configuration](#configuration), and the plain settings from `vars` in `wrangler.jsonc` too, because Pages ignores that file. Under *Settings → Bindings* add the D1 database as `DB`; without it every login fails with `The D1 database binding DB is missing`. Retry the deployment after changing settings. Add the domain under *Custom domains*, then create the CNAME it shows at your DNS provider.
- **The Worker only runs the 10-minute payment job.** Deploy it with `npm run deploy`, with the same secrets. It stays on `workers.dev`; both use the same D1 database.
- **Keep them in step:** after a change, push (Pages) and run `npm run deploy` (Worker), and change a secret in both places.

**Recommended:** add a free Cloudflare rate-limiting rule on `/login`, `/api/login`, `/signup` and `/api/signup` to slow down password guessing and bulk sign-ups.
