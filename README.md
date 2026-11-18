# Smartlaunch Booking

An online booking site for a Smartlaunch center. Customers log in with their Smartlaunch account (or create one), pick a date, time and duration, choose free PCs on the center's floor plan, and book them. They can see and cancel their bookings, and top up their account balance online. If the center charges for bookings, customers see the price and pay online before the PCs are theirs.

Each center runs its own copy: one Cloudflare deployment, one database and one config file per center. The site talks to the center's Smartlaunch server through its REST API, so accounts, bookings and balances stay in Smartlaunch, and staff see online bookings in the admin program like any other.

It is built with SvelteKit and runs on Cloudflare's free tier.

**Contents**

- [Setting up a center](#setting-up-a-center)
- [Center settings](#center-settings)
  - [Settings reference](#settings-reference)
  - [Writing a price list, step by step](#writing-a-price-list-step-by-step)
- [Booking prices](#booking-prices)
- [Environment variables](#environment-variables)
- [Payments](#payments)
- [Deploying](#deploying)
- [Running locally](#running-locally)
- [Troubleshooting](#troubleshooting)
- [Looks and languages](#looks-and-languages)
- [How it works](#how-it-works)

## Setting up a center

You need a Smartlaunch server with the REST API turned on, a Cloudflare account, and Node.js 22.18 or later.

1. **Turn on the REST API** on the Smartlaunch server: set `RESTBaseAddressPort` in the server settings. If `RESTEnableSecurity` is on, note `RESTBasicUsername` and `RESTBasicPassword`. Bookings that are paid online need a server with `BookingStore` (`POST /bookings/create`, `PUT` and `DELETE /bookings/{id}`).
2. **Make the API reachable from Cloudflare** under a hostname, for example with a Cloudflare Tunnel; see [Reaching the center server](#reaching-the-center-server).
3. **Create the center's config:** copy `centers/default` to `centers/<your-center>` and edit `config.jsonc` (name, time zone, currency, booking rules, prices). Every setting is described in the file. See [Center settings](#center-settings).
4. **Pick or make a theme** under `src/themes/` and name it in the config; see [Themes](#themes).
5. **Check it:** `npm install && npm test`. The tests load every center's config and fail on any mistake in it.
6. **Deploy** to Cloudflare, create the database and set the [environment variables](#environment-variables), including `CENTER=<your-center>`; see [Deploying](#deploying).
7. **Optional:** turn on [online payments](#payments), and add a Cloudflare rate-limiting rule on `/login`, `/api/login`, `/signup` and `/api/signup` to slow down password guessing and bulk sign-ups.

To try it first on your own machine, see [Running locally](#running-locally).

## Center settings

Everything a center decides lives in one file, `centers/<name>/config.jsonc`. The `CENTER` variable picks which folder a deployment uses (`default` if unset). Credentials and connection details are not in the file; they are [environment variables](#environment-variables).

| Section | What it sets |
| --- | --- |
| `center` | Name in the header, time zone, currency, default language, theme |
| `booking` | Shortest and longest booking, the durations offered, arrival time step, earliest start, PCs per booking, upcoming bookings per customer, PCs that can't be booked online |
| `pricing` | Price plans, hourly rates and peak times, PCs priced differently (zones), which user group gets which plan, whole rooms. `null` shows no prices |
| `payments` | Top-up amounts and limits, how long PCs stay held while a customer pays, limits on unpaid holds |
| `signup` | Whether visitors can create accounts, minimum age |

`centers/default/config.jsonc` documents every setting and its default, and includes a commented example price list. A setting left out of a center's file gets the default, so a small center's file can be short:

```jsonc
{
	"center": { "name": "Game Zone", "timezone": "Asia/Jakarta", "currency": "IDR", "theme": "default" },
	"booking": { "durations": [1, 2, 3, 4], "excludedPcs": ["PC29", "PC30"] }
}
```

The file allows comments and trailing commas. Amounts are in whole currency units (`2.5` is 2.50), times are the center's local time (`"17:00"`, or `"24:00"` for midnight at the end of a day), and days are `"mon"` to `"sun"` or ranges such as `"mon-fri"`.

**Mistakes stop the site.** The file is checked when the site starts. A misspelled setting, a bad time or an unknown plan stops the site with a message listing every problem, rather than taking bookings with the wrong rules. `npm test` runs the same checks, so run it before deploying. The config is bundled into the build, so a change needs a new build and deploy.

### Settings reference

Every setting is optional unless marked **required**. Defaults are the ones `centers/default/config.jsonc` shows.

**`center`**

| Setting | Default | What it does |
| --- | --- | --- |
| `name` | `"Smartlaunch"` | Name in the page header and the browser tab |
| `timezone` | `null` | IANA time zone, e.g. `"Europe/Berlin"` or `"Asia/Jakarta"`. Needed for the server to reject bookings before the earliest start, and for dates on the top-up page |
| `currency` | `"EUR"` | Three-letter ISO code of all prices and payments; must match the payment account |
| `defaultLanguage` | `"en"` | `en`, `de` or `da`, for visitors whose browser asks for none of them |
| `theme` | `"default"` | Folder under `src/themes`; see [Themes](#themes) |

**`booking`**

| Setting | Default | What it does |
| --- | --- | --- |
| `minMinutes`, `maxMinutes` | `30`, `1440` | Shortest and longest booking, in minutes |
| `durations` | `[1, 2, 3, 4, 5, 6, 8, 10, 12]` | Durations customers can pick, in hours (`0.5` = 30 minutes); each must be between `minMinutes` and `maxMinutes` |
| `defaultDuration` | `2` | Duration picked when the page opens; one of `durations` |
| `arrivalStepMinutes` | `15` | Arrival times the time picker offers (every 15 minutes); must divide a day evenly |
| `startGridMinutes`, `leadMinutes` | `60`, `0` | Earliest start: the first multiple of `startGridMinutes` after now plus `leadMinutes`. The defaults mean "from the next full hour" (at 14:20, from 15:00); `30` and `120` mean "at least two hours ahead, on the half hour" |
| `maxStationsPerBooking` | `50` | Most PCs in one booking |
| `maxUpcomingBookings` | `10` | Most upcoming bookings one customer may have |
| `excludedPcs` | `[]` | PCs that can't be booked online, by name or ID, e.g. `["PC29", "PC30"]`; they show as unavailable |

**`pricing`** (default `null`: no prices)

| Setting | Default | What it does |
| --- | --- | --- |
| `version` | `""` | Name of the price list, written into every booking it priced |
| `periods` | none | Named time windows: `"peak": [{ "days": ["mon-fri"], "from": "17:00", "to": "22:00" }]`. `days` defaults to every day |
| `plans` | **required** | At least one plan; see below |
| `zones` | `[]` | PCs priced differently; see below |
| `defaultPlan` | first plan | Plan of customers whose user group gives no plan |
| `guestPlan` | `null` | Plan that extra PCs in one booking are charged at; `null` charges every PC at the customer's plan |
| `oneDiscountAtATime` | `false` | `true`: a booking that overlaps another of the customer's is charged at the default plan |
| `rooms` | `[]` | Whole rooms, priced but not offered on the site yet; see below |

Each **plan**:

| Setting | Default | What it does |
| --- | --- | --- |
| `id` | **required** | Short name: letters, digits, `-` and `_`; written into bookings |
| `name` | the id | Name customers see, in every language |
| `rate` | **required** | Hourly rate per PC |
| `rates` | `[]` | Rates at certain times, first match wins: `{ "period": "peak", "rate": 6 }`, or `{ "days": ["sat"], "from": "10:00", "to": "14:00", "rate": 3 }` |
| `groups` | the plan's id and name | Smartlaunch user groups (any case) whose members get this plan; a group may give only one plan |
| `zones` | `{}` | Rates for PCs in a zone, by zone id: `{ "vip": { "rate": 8, "rates": [...] } }`. A zone not listed costs the plan's normal rate |

Each **zone**:

| Setting | Default | What it does |
| --- | --- | --- |
| `id` | **required** | Short name, used in plans' `zones` and written into bookings |
| `name` | the id | Name customers see next to the price |
| `groups` | `[]` | Smartlaunch PC groups (as named in the admin program) whose PCs are in the zone |
| `pcs` | `[]` | PC names or IDs in the zone, whatever their group. A zone needs `groups` or `pcs`; a PC in several zones belongs to the first |

Each **room**: `id` and `capacity` (**required**), `name`, `hours` (whole hours it can be booked for, **required**), `rate` and `rates` per seat (the room fee is capacity × seat rate), and `cateringPerGuest` (default `0`).

**`payments`** (used when `PAYMENT_PROVIDER` is set)

| Setting | Default | What it does |
| --- | --- | --- |
| `topupAmounts` | `[10, 20, 50]` | Quick-pick top-up amounts; each between `topupMin` and `topupMax` |
| `topupMin`, `topupMax` | `5`, `200` | Smallest and largest amount a customer can enter |
| `holdMinutes` | `15` | How long PCs stay held while a customer pays for a booking |
| `maxOpenHolds` | `2` | Bookings one customer may have waiting for payment at once |
| `maxUnpaidHoldsPerHour` | `4` | Holds one customer may let run out unpaid in an hour before they have to wait |
| `topupsPerHour` | `10` | Top-ups one customer may start per hour |

**`signup`**

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Whether visitors can create an account at `/signup` |
| `minAge` | `5` | Youngest age allowed to sign up |

### Writing a price list, step by step

Say a center charges €4 an hour, €5 on weekday evenings and weekend afternoons, gives members €3, and has a VIP room that costs more. Its `pricing` section, built up in order:

**1. Name the price list and the busy times.**

```jsonc
"pricing": {
	"version": "2026-1",
	"periods": {
		"peak": [
			{ "days": ["mon-fri"], "from": "17:00", "to": "22:00" },
			{ "days": ["sat", "sun"], "from": "12:00", "to": "24:00" }
		]
	},
```

**2. Mark the VIP PCs.** All PCs in the Smartlaunch PC group "VIP" are in the zone; add `"pcs": [...]` to include single PCs.

```jsonc
	"zones": [{ "id": "vip", "name": "VIP", "groups": ["VIP"] }],
```

**3. Add the plans.** The first plan is the default, so everyone not in the "Members" user group pays Standard.

```jsonc
	"plans": [
		{ "id": "standard", "name": "Standard", "rate": 4, "rates": [{ "period": "peak", "rate": 5 }],
		  "zones": { "vip": { "rate": 6, "rates": [{ "period": "peak", "rate": 7 }] } } },
		{ "id": "member", "name": "Member", "groups": ["Members"], "rate": 3,
		  "zones": { "vip": { "rate": 4 } } }
	],
```

**4. Decide what friends pay.** With a guest plan, a member's rate covers one PC and the others cost Standard.

```jsonc
	"guestPlan": "standard"
}
```

What customers then pay:

| Booking | Price |
| --- | --- |
| Standard, one PC, Friday 16:00–18:00 | €4 + €5 (peak from 17:00) = **€9** |
| Standard, one VIP PC, Saturday 14:00–16:00 | 2 × €7 = **€14** |
| Member, one PC, Friday 16:00–18:00 | 2 × €3 (no peak in the member plan) = **€6** |
| Member with a friend, one PC and one VIP PC, Monday 12:00–14:00 | Member rate on the VIP PC, where it saves most: 2 × €4; the friend's PC at Standard: 2 × €4 = **€16** |

Run `npm test` after editing: it reports any mistake with the setting's path, such as `pricing.plans[1].zones.vpi: unknown setting`.

## Booking prices

With a `pricing` section, the booking page shows what the selected PCs cost, and the price is written into the booking's description in Smartlaunch, e.g. `Price EUR 16.00 (2026-1: 1 x member/vip EUR 8.00, 1 x standard EUR 8.00).` If [online payments](#payments) are on as well, customers pay that price to book. Without them, bookings are made unpaid and the page says nothing is charged online. With `"pricing": null`, no prices appear anywhere.

A price list is built from:

- **Plans.** Each has an hourly `rate`, and optional `rates` that override it at certain times. The first matching entry wins.
- **Periods.** Named time windows that rates refer to, such as `"peak": [{ "days": ["mon-thu"], "from": "17:00", "to": "20:00" }]`. A rate can also give its own `days`, `from` and `to`. A window can't run past midnight; split it in two.
- **Which plan a customer gets.** It comes from their Smartlaunch user group. A plan's `groups` lists the group names that give it; without `groups`, a group named like the plan's id or name (any case) does. Everyone else gets `defaultPlan`. To change a customer's plan, move them to another user group in the admin program.
- **Zones.** PCs priced differently, such as a VIP room or consoles. A zone lists Smartlaunch PC groups (`groups`) and/or PC names or IDs (`pcs`); a PC in several zones belongs to the first. A plan's `zones` give a zone its own rates, e.g. `"zones": { "vip": { "rate": 8 } }`. A zone a plan doesn't list costs that plan's normal rate.
- **`guestPlan`.** When a customer books several PCs, the extra ones are for friends and cost this plan's rate. The customer's own rate goes on the PC where it saves the most. Without a guest plan, every PC gets the customer's rate.
- **`oneDiscountAtATime`.** A customer who already has a booking at that time pays the default plan's rate for the new one.
- **`version`.** The price list's name, written into every booking it priced. Change it when prices change, so each booking shows which prices it was made under.

How prices are worked out:

- **A booking is split wherever the rate changes,** and each PC's price is rounded once to whole cents. One hour from 16:30 at €5, or €6 from 17:00, costs €2.50 + €3.00 = €5.50.
- **The server always works out the price.** The browser never sends an amount.
- **Whole rooms** (`rooms`) are priced by the engine but not offered on the site yet: capacity × the room's seat rate, for the whole hours the room allows, plus optional catering per guest.

The repo also contains a real center as an example: `centers/esportsnord` (with the `esportsnord` theme), whose price list has five plans, peak times, a members' low-rate window, guest and one-discount rules, and rooms. `npm test` checks it against that center's price tables. It is only an example: no code depends on it, though this repo's `wrangler.jsonc` deploys it.

## Environment variables

Set these in Cloudflare (*Settings → Variables and Secrets*) or, locally, in `.env`. Use the **Secret** type for anything marked secret.

| Variable | Secret? | Description |
| --- | --- | --- |
| `CENTER` | no | Folder under `centers/` with this center's settings; defaults to `default` |
| `SL_API_URL` | no | Base URL of the Smartlaunch REST API, e.g. `https://booking-api.example.com`. Must be a hostname on Cloudflare |
| `SL_API_USERNAME` | yes | `RESTBasicUsername`, or an employee login if `RESTUseEmployeeLoginAsSecurity` is on |
| `SL_API_PASSWORD` | yes | Matching password |
| `SESSION_SECRET` | yes | Random string of 32+ characters for signing login cookies, e.g. `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"` |
| `SL_LICENSE_EMAIL` | no | Only for servers reached through a relay that routes by license; adds `?licenseemail=` to every call |
| `PAYMENT_PROVIDER` | no | `sumup` turns on online payments; empty turns them off |
| `SUMUP_API_KEY` | yes | SumUp secret API key |
| `SUMUP_MERCHANT_CODE` | no | SumUp merchant code that receives the payments |
| `SUMUP_API_URL` | no | Only for testing against a mock; defaults to `https://api.sumup.com` |
| `TURNSTILE_SITE_KEY` | no | Cloudflare Turnstile site key; with the secret, sign-up asks visitors to prove they're not a robot |
| `TURNSTILE_SECRET_KEY` | yes | Turnstile secret key |

Older versions read the center's settings from variables (`PUBLIC_CENTER_NAME`, `CENTER_TIMEZONE`, `DEFAULT_LANGUAGE`, `THEME`, `PAYMENT_CURRENCY`, `PUBLIC_ALLOW_SIGNUP`, `EXCLUDED_PCS`, `PRICE_RULES`, `PLAN_GROUPS`, `TOPUP_*`). These are no longer read. If one is still set, the server logs where it belongs in the config; delete it.

### Reaching the center server

Cloudflare can't call a bare IP address, so `SL_API_URL` must use a hostname. The simplest free option is a **Cloudflare Tunnel** on the server PC: it needs no port forwarding, gives you HTTPS, and keeps the REST port off the public internet.

```sh
cloudflared tunnel login
cloudflared tunnel create smartlaunch-api
cloudflared tunnel route dns smartlaunch-api booking-api.example.com
cloudflared tunnel run --url http://localhost:7833 smartlaunch-api   # use your REST port
```

Then set `SL_API_URL=https://booking-api.example.com`.

## Payments

With `PAYMENT_PROVIDER` set, customers can top up their Smartlaunch balance on `/topup`: they pick an amount, pay on the provider's payment page, and return to the site. If the center also has [prices](#booking-prices), **bookings must be paid online** too. Payments are recorded in the site's database; the money itself goes to the center's payment account.

### SumUp

1. In the SumUp Dashboard, go to *Developers* and create an **API key**, and note your **merchant code** (in your profile, e.g. `MH4H92C7`). For testing, use a sandbox merchant account and its key.
2. Set `PAYMENT_PROVIDER=sumup`, `SUMUP_API_KEY` (as a secret) and `SUMUP_MERCHANT_CODE`. Make sure `center.currency` in the config is your SumUp account's currency.
3. Deploy. SumUp is told to send status updates to `https://<your site>/api/payments/webhook/sumup`; nothing needs registering in the dashboard. Updates are only sent to `https` sites, so local runs rely on the return page and the scheduled job.

SumUp's payment page stays open for 30 minutes per checkout. A checkout SumUp reports as failed can still be retried on that page, so the order is only marked `failed` after an hour; checkouts never paid are marked `expired` after a day.

### Top-ups

1. `/topup` records an order (`pending`), creates a checkout at the provider with the order number as reference, and sends the customer to the payment page.
2. The customer's return page, the provider's webhook and a job that runs every 10 minutes each **ask the provider** for the checkout's status. A webhook alone is never taken as proof of payment.
3. Once the provider reports it paid, with the order's amount, currency and reference, the money is added with `POST /users/{username}/addmoney`, using the order number as Smartlaunch `OrderCode`.
4. If the center server is offline, the order stays `paid` and is retried with growing delays (1, 2, 4 … minutes, at most 6 hours) until it's `delivered`.

Money is never added twice: only one worker at a time may deliver an order, and the Smartlaunch server ignores an `OrderCode` it has already credited. A checkout paid for a different amount or currency than its order is marked `failed` and not credited.

### Paid bookings

A booking is held first and paid second, so the same PCs are never sold twice:

1. **Hold.** When the customer confirms, the site prices the booking and books the PCs in Smartlaunch, unpaid, with `POST /bookings/create`. The description says `Awaiting online payment, order BK…; cancelled if unpaid.` Nobody else can book those PCs now.
2. **Pay.** The customer pays on the provider's page. The checkout expires when the hold does, `payments.holdMinutes` later (15 by default).
3. **Confirm.** Once the payment is confirmed, the booking is updated to `Paid online, order BK…, SumUp TEENSK4W2K. Price EUR 9.50 (…).` and marked paid. The customer sees the result and the booking number.
4. **Release.** If the payment fails, the customer goes back without paying, or the hold runs out, the booking is cancelled and the PCs are free again.

A payment can still arrive just as a hold is released, so released orders are watched for another hour. If the PCs are still free, they are booked again and the order is delivered. If someone else has taken them, the order becomes `needs_refund`, the log shows `PAID AFTER ITS HOLD ENDED`, and the customer is asked to contact the center; refund them in the SumUp dashboard.

### Finding a payment

Three numbers link a payment to its booking:

| Number | Example | In Smartlaunch | In SumUp | The customer sees it |
| --- | --- | --- | --- | --- |
| Booking number | `#1234` | the booking's number | payment description | confirmation page, My bookings |
| Order number | `BKX7K2M9QP4RT8WZ3N` | booking description and order code | payment description and reference | confirmation page |
| SumUp transaction code | `TEENSK4W2K` | booking description, once paid | transaction details | SumUp receipt |

In the admin program's booking calendar, each online booking shows as `#1234 username`; opening it shows the order number and SumUp code in the note, and **Paid**: NO while it waits for payment (or is to be paid at the venue), YES once paid online. This needs matching admin and server builds; older servers show every website booking as paid. SumUp describes the payment as `Booking #1234, 2026-11-05 17:00, 2 stations, Pro, order BK…`, and top-ups as `Top-up <username>, order TU…`.

Orders that are stuck, failed or need a refund:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id, username, kind, amount_cents, status, attempts, last_error FROM orders WHERE status NOT IN ('delivered', 'expired') ORDER BY created_at DESC"
```

## Deploying

The site runs as a Cloudflare Worker. It isn't a plain Pages site because Pages can't run the 10-minute job that finishes payments.

**1. Create the database** (once per center):

```sh
npx wrangler login
npx wrangler d1 create smartlaunch-booking
```

Put the printed `database_id` and `"CENTER": "<your-center>"` (under `vars`) into `wrangler.jsonc`, then create the tables:

```sh
npm run db:migrate
```

Run `npm run db:migrate` again whenever a new file appears in `migrations/`.

**2a. Deploy from Git (recommended).** Push the repo, then in Cloudflare go to *Workers & Pages → Create → Workers → Import a repository* with:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `smartlaunch_booking`, if it lives in a larger repo

Add the [environment variables](#environment-variables) under the Worker's *Settings → Variables and Secrets* and redeploy. Each push then deploys.

**2b. Or deploy from your machine:**

```sh
npm run deploy
npx wrangler secret put SL_API_USERNAME          # repeat for each secret
```

The site is then at `https://smartlaunch-booking.<your-subdomain>.workers.dev`; add your own domain under the Worker's *Settings → Domains & Routes*.

### When the domain's DNS isn't on Cloudflare

A Worker custom domain needs the domain's DNS in your Cloudflare account; a CNAME to `workers.dev` doesn't work. Pages accepts an outside CNAME, so the site can run on both:

- **Pages serves the site.** Connect the repo as a Pages project with build command `npm run build`. Under *Settings → Variables and Secrets* add every variable, including `CENTER`, because Pages ignores `wrangler.jsonc`. Under *Settings → Bindings* add the D1 database as `DB`. Add the domain under *Custom domains* and create the CNAME it shows at your DNS provider.
- **The Worker only runs the payment job.** Deploy it with `npm run deploy`, with the same secrets. It stays on `workers.dev`; both use the same database.
- **Keep them in step.** After a change, push (Pages builds) and run `npm run deploy` (Worker). Change a secret in both places. Pages applies changed variables only at its next deployment.

## Running locally

1. Turn on the REST API on a Smartlaunch server you can reach (see [Setting up a center](#setting-up-a-center), step 1).
2. Install and configure:

   ```sh
   npm install
   cp .env.example .env        # Windows: copy .env.example .env
   ```

   Edit `.env`. Locally, `SL_API_URL` can be a LAN address:

   ```
   SL_API_URL=http://192.168.1.10:7833
   SL_API_USERNAME=<RESTBasicUsername>
   SL_API_PASSWORD=<RESTBasicPassword>
   SESSION_SECRET=<random string, 32+ characters>
   CENTER=default
   ```

3. Create the local database (repeat after new migrations): `npm run db:migrate:local`
4. Start it: `npm run dev`, then open http://localhost:5173 and log in with a customer account from Smartlaunch.

To run in the real Workers runtime, including the scheduled job, put the same values in `.dev.vars` and run `npm run build && npm run preview` (http://localhost:4173). With `npx wrangler dev --test-scheduled` instead, opening http://localhost:8787/__scheduled runs the job once.

| Script | What it does |
| --- | --- |
| `npm test` | Checks every center's config and the price engine; needs no server |
| `npm run check` | Type check |
| `npm run gen` | Regenerates `worker-configuration.d.ts` after editing `wrangler.jsonc` |

### With DDEV

Instead of installing Node yourself, you can use [DDEV](https://ddev.com) (Node 24; the database stays local SQLite under `.wrangler/`). Create `.env` as above, then:

```sh
ddev start                  # installs packages, applies local migrations, starts Vite
                            # https://smartlaunch-booking.ddev.site:5173
ddev preview                # Workers runtime: https://smartlaunch-booking.ddev.site:4173 (/__scheduled runs the job)
ddev exec npm test          # any npm script works through ddev exec
```

`SL_API_URL` is called from inside the container, so use the server's LAN address, not `localhost`. Vite restarts by itself when `.env` changes; if it doesn't, run `ddev restart`. Run `wrangler login`, remote migrations and deploys on the host.

## Troubleshooting

| Message | Cause |
| --- | --- |
| Every page shows an error; the log names `centers/<name>/config.jsonc` | The center's config has a mistake (each problem is listed), or `CENTER` names a folder that doesn't exist |
| Site shows "Smartlaunch" and default settings | `CENTER` isn't set, so the `default` config is used (on Pages, set it in the dashboard) |
| `… is set but no longer read` in the log | An old settings variable is still set; move its value into the config and delete it |
| "The booking service is misconfigured" | On Cloudflare with an IP address in `SL_API_URL`: Cloudflare blocks bare IPs (error 1003); use a hostname. Otherwise the server rejected `SL_API_USERNAME` / `SL_API_PASSWORD`. The logs say which |
| "The center server could not be reached" | `SL_API_URL` is wrong, the server is down, or a firewall blocks the port |
| Works locally, fails after deploy | `SL_API_URL` is a LAN or bare IP address; see [Reaching the center server](#reaching-the-center-server) |
| `SESSION_SECRET must be set…` | `SESSION_SECRET` is missing or shorter than 32 characters |
| "The payment could not be started" | `SUMUP_API_KEY` or `SUMUP_MERCHANT_CODE` is wrong, or `center.currency` isn't your SumUp account's currency. The logs show SumUp's answer |
| "Top up" link missing | `PAYMENT_PROVIDER` is empty, or its settings are incomplete (logged at startup) |
| `The D1 database binding DB is missing` | `database_id` in `wrangler.jsonc` isn't set, the migrations weren't applied, or (on Pages) the `DB` binding wasn't added |
| No booking can be made with payments on | The server has no `BookingStore` and answers 404 to `/bookings/create` |

## Looks and languages

### Themes

The site's look comes from a theme in `src/themes/<name>/`, chosen with `center.theme` in the config. If the folder doesn't exist, the `default` theme is used and the server logs a warning.

| Theme | Look |
| --- | --- |
| `default` | Neutral: system fonts, blue accent, rounded corners; follows the visitor's light/dark setting |
| `esportsnord` | The example center's brand: red header, slanted buttons and panel cuts, hazard stripes, display fonts; dark only. A good starting point for a heavily styled theme |

A theme folder has a `theme.css` (required) that sets CSS variables for colours, fonts and shapes and can add its own rules, an optional `favicon.svg`, and any images the CSS uses (with relative `url(...)` paths). `src/themes/default/theme.css` defines every variable with comments, so it doubles as the reference.

To make your own, create `src/themes/mytheme/theme.css`, start from the default theme and override what you want:

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

Then set `"theme": "mytheme"` in the center's config and rebuild. To change an existing theme, copy it under a new name first, so updates to the original don't overwrite your changes. A theme that loads fonts or images from anywhere other than Google Fonts needs that host added to the Content-Security-Policy in `vite.config.ts`.

To use a licensed font that isn't on Google Fonts, put its files in the theme folder, add an `@font-face` for them in `theme.css`, and put that family first in `--font-display`.

### Languages

The site is in English, German and Danish. Visitors switch with the flags in the header; the choice is kept for a year. Otherwise the site follows the browser's languages, then `center.defaultLanguage`, then English. Error messages from the API come back in the same language.

All text is in `src/lib/i18n/`: `en.ts` is the reference, and `de.ts` and `da.ts` must define every key it has (the type check fails otherwise). To add a language, add a file such as `fr.ts`, register it in `LOCALES`, `LANGUAGE_NAMES`, `INTL_LOCALES` and the dictionaries in `src/lib/i18n/index.ts`, and give it a flag in `src/routes/+layout.svelte`.

## How it works

```
Browser ──► Cloudflare Worker (SvelteKit pages + /api/*) ──Basic auth──► Smartlaunch server REST API
                    │        ▲
                    ▼        │ webhooks
              D1 (orders)   Payment provider (SumUp)
```

The REST API (`sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb`) is protected by one shared Basic-auth credential, so the browser never calls it directly. The Worker holds the credential as a secret and exposes only what a customer needs. Sessions are signed cookies. The D1 database records payments, rate limits and locks; accounts, bookings and balances stay on the Smartlaunch server.

| Site endpoint | Smartlaunch REST calls |
| --- | --- |
| `POST /api/login` `{username, password}` | `GET /users/{username}/check?password=`, `GET /users/{username}` |
| `POST /api/signup` `{username, password, email, mobilePhone?, firstName, lastName, address, zip, city, gender, birthday}` | `GET /users/{username}` (is it taken?), `POST /users/create`, then the login calls |
| `POST /api/logout`, `GET /api/me` | none |
| `GET /api/layouts` | `GET /layoutgroups` |
| `GET /api/computerlayoutpositions` | `GET /computerlayoutpositions` |
| `GET /api/computers` | `GET /computers` (trimmed to id, name, group, console type) |
| `GET /api/booking/getbooked?start=YYYY-MM-DDTHH:mm&minutes=N`<br>or `?startdate=yyyyMMddHHmm&enddate=yyyyMMddHHmm` | `GET /booking/getbooked` |
| `GET /api/quote?start=…&minutes=N&pcs=1;2;3` | `GET /users/{username}`, `GET /usergroups`, `GET /bookings`; with zones also `GET /computers`, `GET /computergroups` |
| `GET /api/bookings` | `GET /bookings`, filtered to the logged-in customer |
| `POST /api/bookings` `{start, minutes, computerIds, orderCode?}` | `POST /bookings`; when paid online, `POST /bookings/create` and a checkout |
| `POST /api/bookings/{order}/cancel` | `DELETE /bookings/{id}` for an unpaid hold |
| `POST /api/payments/webhook/{provider}` | after checking with the provider: `addmoney`, or `PUT /bookings/{id}` |
| `POST /api/payments/sweep` (the 10-minute job) | the same, for orders not finished yet |

The pages are `/login`, `/signup`, `/` (book), `/bookings` (my bookings), `/topup`, `/topup/return` and `/book/return` (where the payment provider sends customers back).

**The Worker.** The SvelteKit adapter writes the app to `.svelte-kit/cloudflare/_worker.js` (configured by `wrangler.sveltekit.jsonc`, read only by the adapter). The deployed Worker, configured in `wrangler.jsonc`, starts at `worker/index.js`, which passes requests to the app and adds the scheduled job; the job calls `/api/payments/sweep` with `SESSION_SECRET` as its key.

**The center config.** `src/lib/config.ts` parses and checks `config.jsonc` and fills in defaults; it has no framework imports, so `npm test` can load it. `src/lib/server/center.ts` bundles every `centers/*/config.jsonc` at build time and loads the one `CENTER` names. `src/lib/pricing.ts` does the price arithmetic from the parsed rules.

### Things worth knowing

- **Times are center wall-clock time.** The server converts booking timestamps with `New DateTime(1970,1,1).AddSeconds(ts)`, with no time zone. The site sends and reads them as naive wall-clock seconds (`src/lib/time.ts`), so `18:00` in the form is `18:00` in Smartlaunch whatever zone Cloudflare runs in.
- **Availability is checked over the whole booking.** The site checks the whole window with `/booking/getbooked` before booking. Servers with `BookingStore` also check it themselves, atomically, and keep PCs blocked for `BookingBufferMinutes` (server.inf) after a booking ends. Older servers only reject a PC whose existing booking covers the new *start* time, so the site's own check is what protects them.
- **SQL escaping.** The server builds the booking `INSERT` and the sign-up `UPDATE` by string concatenation. The site doubles quotes in every text field, allows only numeric PC IDs, restricts order codes to `[A-Z0-9]`, and restricts usernames to letters, numbers, `.`, `-` and `_`.
- **Sign-up.** New accounts go into the server's "members" group (or its first group). Name, street and number, ZIP code, city, gender and date of birth are required; the mobile number is optional. Smartlaunch only knows female (0) and male (1); non-binary is stored as 2, which the server keeps, but the admin program shows it as female. The server may refuse a username through its profanity filter; the site then asks for another.
- **Duplicate protection.** Each confirm sends a code from the browser, hashed with the username into the booking's `OrderCode`, so a retried request lands on the same booking and one customer's code can never match another's.
- **Which bookings are a customer's.** Staff can type any name on a booking, so a booking counts as a customer's only if it has their username *and* was made by them on this site or carries their phone number.

### Abuse limits

Counters are kept in D1, so they hold across all Worker instances. A customer who hits one is told how long to wait.

| What | Limit |
| --- | --- |
| Login | 30 tries per IP address and 10 wrong passwords per username, per 15 minutes |
| Sign-up | 5 accounts per IP address per hour, plus the optional Turnstile check |
| Booking | 20 attempts per hour; `booking.maxUpcomingBookings` upcoming bookings (10); one request at a time per customer |
| Paid booking holds | `payments.maxOpenHolds` waiting for payment (2); after `payments.maxUnpaidHoldsPerHour` unpaid holds (4), wait an hour |
| Top-up | `payments.topupsPerHour` checkouts per hour (10) |
| Availability, prices, booking list | 120 requests per minute per customer |

Limits named after a setting are in the [center config](#center-settings); the rest are constants in `src/lib/server/booking.ts`, `orders.ts` and the API routes. Booking and top-up also check that the customer's Smartlaunch account still exists; if it was deleted, the session ends.

The site sends a Content-Security-Policy (set in `vite.config.ts`), HSTS over https, `X-Frame-Options: DENY` and `nosniff`.

### Adding a payment provider

Providers live in `src/lib/server/payments/`. To add one (Adyen, Stripe, Square, …):

1. Write `src/lib/server/payments/<name>.ts` implementing `PaymentProvider` from `provider.ts`: `createCheckout` (create a hosted checkout, return its id and payment page URL), `getCheckout` (read its status, amount, currency and reference) and `parseWebhook` (get the checkout id from a webhook request). See `sumup.ts`.
2. Add a `case '<name>'` to `create()` in `payments/index.ts`, and its settings to `src/env.ts`.
3. Set `PAYMENT_PROVIDER=<name>`.

The order logic, pages and database don't change. Webhooks arrive at `/api/payments/webhook/<name>` and are only a hint to re-check the checkout, so providers without signed webhooks are fine; one that signs them can check the signature in `parseWebhook`. SvelteKit rejects cross-site POSTs with no content type or a form content type, so a provider that posts webhooks that way needs a different route.
