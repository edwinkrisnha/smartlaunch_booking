# Smartlaunch Booking

A website where customers of a Smartlaunch center can book PCs online.

Customers can:

- log in with their Smartlaunch account, or create a new one
- pick a day, a start time and how long they want to play
- choose free PCs on a map of the center, and book them
- see and cancel their bookings
- add money to their account balance
- pay for a booking online, if the center charges for bookings

The website talks to the center's Smartlaunch server. Accounts, bookings and balances stay in Smartlaunch. Staff see online bookings in the admin program, like any other booking.

Each center runs its own copy of the website, on Cloudflare's free plan. It is built with SvelteKit.

**Contents**

- [Setting up a center](#setting-up-a-center)
- [The center folder](#the-center-folder)
- [All settings](#all-settings)
- [Prices](#prices)
- [Environment variables](#environment-variables)
- [Payments](#payments)
- [Deploying](#deploying)
- [Running it on your computer](#running-it-on-your-computer)
- [Problems and fixes](#problems-and-fixes)
- [Look and languages](#look-and-languages)
- [For developers](#for-developers)

## Setting up a center

You need:

- a Smartlaunch server
- a Cloudflare account
- Node.js 22.18 or newer on your computer

Steps:

1. **Turn on the REST API on the Smartlaunch server.** The REST API is how the website talks to the server. Set `RESTBaseAddressPort` in the server settings. If `RESTEnableSecurity` is on, write down `RESTBasicUsername` and `RESTBasicPassword`.
2. **Let Cloudflare reach the server** using a web address (not an IP address). See [Reaching the server](#reaching-the-server).
3. **Make a folder for your center.** Copy `centers/default` to `centers/<your-center>`. Change the files in it. See [The center folder](#the-center-folder).
4. **Check your settings.** Run `npm install`, then `npm test`. It tells you about any mistake.
5. **Put the website online.** See [Deploying](#deploying). It explains which of three ways fits your center.
6. **Optional:** turn on [online payments](#payments). Also add a Cloudflare rate-limiting rule for `/login`, `/api/login`, `/signup` and `/api/signup`. This slows down people who try to guess passwords or make many accounts.

Want to try it first? See [Running it on your computer](#running-it-on-your-computer).

## The center folder

Everything about your center is in one folder:

```
centers/<your-center>/
	config.jsonc    the settings: name, time zone, booking rules, prices, payments, sign-up
	theme.css       how the website looks (colours, fonts)
	favicon.svg     the small icon in the browser tab
```

The `CENTER` variable tells the website which folder to use. For example, `CENTER=gamezone` uses `centers/gamezone`.

**Missing files are fine.** If your folder has no `config.jsonc`, `theme.css` or `favicon.svg`, the website uses the one from `centers/default`. So you can change only the look, or only the settings.

**Passwords are not in this folder.** They are [environment variables](#environment-variables).

### The settings file

`config.jsonc` has five parts:

| Part | What it controls |
| --- | --- |
| `center` | Name, time zone, currency, language |
| `booking` | How long a booking can be, which times can be picked, how many PCs, which PCs can't be booked online |
| `pricing` | Prices. Leave it as `null` to show no prices |
| `payments` | Top-up amounts, and how long PCs are kept while a customer pays |
| `signup` | Whether people can make an account on the website |

You only need to write the settings you want to change. Everything else uses the default. A small file can look like this:

```jsonc
{
	"center": { "name": "Game Zone", "timezone": "Asia/Jakarta", "currency": "IDR" },
	"booking": { "durations": [1, 2, 3, 4], "excludedPcs": ["PC29", "PC30"] }
}
```

How to write values:

- **Money:** a number. `2.5` means 2.50.
- **Times:** `"17:00"`. Use `"24:00"` for midnight at the end of a day.
- **Days:** `"mon"`, `"tue"` … `"sun"`, or a range like `"mon-fri"`.
- **Comments:** lines starting with `//` are notes and are ignored.

`centers/default/config.jsonc` explains every setting, and has an example price list.

**Mistakes stop the website.** If a setting is spelled wrong or a value is wrong, the website does not start. The error message lists every mistake. This is on purpose: it is better than taking bookings with wrong prices. Run `npm test` before you deploy; it finds the same mistakes.

**Changes need a new deploy.** The settings are built into the website. After you change them, deploy again.

## All settings

Every setting is optional, unless it says **required**.

### `center`

| Setting | Default | What it does |
| --- | --- | --- |
| `name` | `"Smartlaunch"` | The name at the top of the page and in the browser tab |
| `timezone` | `null` | The center's time zone, like `"Europe/Berlin"` or `"Asia/Jakarta"`. Without it, the server does not block bookings that start too early |
| `currency` | `"EUR"` | Three-letter currency code, like `EUR`, `DKK` or `IDR`. Must be the same as your payment account |
| `defaultLanguage` | `"en"` | `en`, `de` or `da`. Used when the visitor's browser wants another language |

### `booking`

| Setting | Default | What it does |
| --- | --- | --- |
| `minMinutes` | `30` | Shortest booking, in minutes |
| `maxMinutes` | `1440` | Longest booking, in minutes (1440 = 24 hours) |
| `durations` | `[1, 2, 3, 4, 5, 6, 8, 10, 12]` | Lengths a customer can choose, in hours. `0.5` = 30 minutes |
| `defaultDuration` | `2` | Length already chosen when the page opens. Must be in `durations` |
| `arrivalStepMinutes` | `15` | Start times go up in steps of this many minutes (15 → 14:00, 14:15, 14:30 …) |
| `startGridMinutes` | `60` | Together with `leadMinutes`: the earliest start time. See below |
| `leadMinutes` | `0` | How many minutes ahead a booking must start. See below |
| `maxStationsPerBooking` | `50` | Most PCs in one booking |
| `maxUpcomingBookings` | `10` | Most future bookings one customer can have |
| `excludedPcs` | `[]` | PCs that can't be booked online, by name or number, like `["PC29", "PC30"]` |

**Earliest start time.** The website takes the time now, adds `leadMinutes`, and moves up to the next step of `startGridMinutes`.

- Default (`60` and `0`): bookings start from the next full hour. At 14:20, the earliest start is 15:00.
- `30` and `120`: bookings start at least 2 hours ahead, on the hour or half hour.

### `pricing`

The default is `null`: no prices. See [Prices](#prices) for how to write a price list.

| Setting | Default | What it does |
| --- | --- | --- |
| `version` | `""` | A name for this price list, like `"2026-1"`. It is saved with each booking |
| `periods` | none | Named times of the week, like a `"peak"` time |
| `plans` | **required** | The prices. At least one plan |
| `zones` | `[]` | Groups of PCs with other prices, like a VIP room |
| `defaultPlan` | the first plan | The plan for customers who don't belong to any plan |
| `guestPlan` | `null` | The plan for the extra PCs in a booking (for friends) |
| `oneDiscountAtATime` | `false` | `true`: a customer gets their plan price on only one booking at a time |
| `rooms` | `[]` | Prices for booking a whole room. Not shown on the website yet |

Each **plan**:

| Setting | Default | What it does |
| --- | --- | --- |
| `id` | **required** | Short name, like `"member"`. Letters, numbers, `-` and `_` only |
| `name` | same as `id` | The name customers see |
| `rate` | **required** | Price per PC per hour |
| `rates` | `[]` | Other prices at certain times. The first one that fits is used |
| `groups` | the plan's `id` and `name` | Smartlaunch user groups that get this plan. A group can give only one plan |
| `zones` | `{}` | Other prices for PCs in a zone, like `{ "vip": { "rate": 8 } }` |

Each **zone**:

| Setting | Default | What it does |
| --- | --- | --- |
| `id` | **required** | Short name, like `"vip"` |
| `name` | same as `id` | The name customers see next to the price |
| `groups` | `[]` | Smartlaunch PC groups (as named in the admin program) in this zone |
| `pcs` | `[]` | Single PCs in this zone, by name or number |

A zone needs `groups` or `pcs`. If a PC fits more than one zone, the first zone is used.

Each **room**: `id`, `capacity` and `hours` are **required**. Also `name`, `rate` and `rates` (price per seat), and `cateringPerGuest` (default `0`). The room price is the number of seats × the seat price.

### `payments`

Used only when online payments are on (`PAYMENT_PROVIDER`).

| Setting | Default | What it does |
| --- | --- | --- |
| `topupAmounts` | `[10, 20, 50]` | Amounts on the quick buttons of the top-up page |
| `topupMin` | `5` | Smallest top-up |
| `topupMax` | `200` | Biggest top-up |
| `holdMinutes` | `15` | How long PCs are kept for a customer who is paying |
| `maxOpenHolds` | `2` | How many unpaid bookings one customer can have at the same time |
| `maxUnpaidHoldsPerHour` | `4` | After this many unpaid bookings in one hour, the customer must wait |
| `topupsPerHour` | `10` | How many top-ups one customer can start per hour |

### `signup`

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Whether people can make an account on the website |
| `minAge` | `5` | Youngest age allowed |

## Prices

If `pricing` is set, the booking page shows the price. The price is also written in the booking in Smartlaunch, like this:

```
Price EUR 16.00 (2026-1: 1 x member/vip EUR 8.00, 1 x standard EUR 8.00).
```

- **With online payments on**, customers must pay this price to book.
- **Without online payments**, the booking is made unpaid. The customer pays at the center.
- **With `"pricing": null`**, no prices are shown.

### The parts of a price list

- **Plan:** a price per hour. A plan can have other prices at certain times (`rates`).
- **Period:** a named time, like `"peak"` = weekdays 17:00–22:00. A period can't go past midnight. Split it in two instead (for example 22:00–24:00 and 00:00–02:00).
- **Which plan a customer gets:** it comes from the customer's **user group** in Smartlaunch. To change a customer's plan, move them to another user group in the admin program. Customers without a plan get `defaultPlan`.
- **Zone:** a group of PCs with other prices, like a VIP room or consoles.
- **Guest plan:** when a customer books more than one PC, the extra PCs are for friends. Friends pay the guest plan price. The customer's own price goes on the PC where it saves the most money.
- **One discount at a time:** if a customer already has a booking at the same time, the new one costs the default price.
- **Version:** change it when your prices change. Each booking then shows which prices were used.

### Example, step by step

A center wants:

- €4 per hour, and €5 in the evenings and at weekends
- €3 for members
- a VIP room that costs more

**Step 1. Name the price list and the busy times.**

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

**Step 2. Mark the VIP PCs.** All PCs in the Smartlaunch PC group "VIP" are in the zone. To add single PCs, use `"pcs": [...]`.

```jsonc
	"zones": [{ "id": "vip", "name": "VIP", "groups": ["VIP"] }],
```

**Step 3. Add the plans.** The first plan is the default. Everyone who is not in the "Members" user group pays Standard.

```jsonc
	"plans": [
		{ "id": "standard", "name": "Standard", "rate": 4, "rates": [{ "period": "peak", "rate": 5 }],
		  "zones": { "vip": { "rate": 6, "rates": [{ "period": "peak", "rate": 7 }] } } },
		{ "id": "member", "name": "Member", "groups": ["Members"], "rate": 3,
		  "zones": { "vip": { "rate": 4 } } }
	],
```

**Step 4. Choose what friends pay.** A member's price is for one PC. Friends pay Standard.

```jsonc
	"guestPlan": "standard"
}
```

What customers pay:

| Booking | Price |
| --- | --- |
| Standard, 1 PC, Friday 16:00–18:00 | €4 + €5 (peak starts at 17:00) = **€9** |
| Standard, 1 VIP PC, Saturday 14:00–16:00 | 2 × €7 = **€14** |
| Member, 1 PC, Friday 16:00–18:00 | 2 × €3 = **€6** (the member plan has no peak price) |
| Member and a friend, 1 PC + 1 VIP PC, Monday 12:00–14:00 | Member price on the VIP PC (it saves the most): 2 × €4. Friend on the normal PC: 2 × €4. Total **€16** |

After editing, run `npm test`. It shows any mistake and where it is, for example `pricing.plans[1].zones.vpi: unknown setting`.

### How the price is counted

- **The time is split where the price changes.** One hour from 16:30, with €5 before 17:00 and €6 after, costs €2.50 + €3.00 = €5.50.
- **Each PC's price is rounded once**, to whole cents.
- **The website always counts the price itself.** It never trusts a price sent by the browser.

### A real example

The folder `centers/esportsnord` is a real center (eSports Nord), included as an example. Its price list has five plans, peak times, a cheap time for members, guest prices and rooms. `npm test` checks it against that center's price tables. Nothing in the code needs it, but this repo's `wrangler.jsonc` deploys it.

## Environment variables

These are the passwords and connection details. They are not in the center folder.

Set them in Cloudflare (*Settings → Variables and Secrets*). On your computer, put them in the file `.env`. Use the **Secret** type for the ones marked "yes".

| Variable | Secret? | What it is |
| --- | --- | --- |
| `CENTER` | no | The name of your center folder, like `gamezone`. Default: `default` |
| `SL_API_URL` | no | The web address of the Smartlaunch REST API, like `https://booking-api.example.com` |
| `SL_API_USERNAME` | yes | The REST API username (`RESTBasicUsername`), or a staff login if `RESTUseEmployeeLoginAsSecurity` is on |
| `SL_API_PASSWORD` | yes | The password for that username |
| `SESSION_SECRET` | yes | A long random text (32 characters or more). It protects login cookies. Make one with `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"` |
| `SL_LICENSE_EMAIL` | no | Only needed if your server is reached through a relay that uses the license email |
| `PAYMENT_PROVIDER` | no | `sumup` turns online payments on. Empty = off |
| `SUMUP_API_KEY` | yes | Your SumUp API key |
| `SUMUP_MERCHANT_CODE` | no | Your SumUp merchant code |
| `SUMUP_API_URL` | no | Only for testing. Default: `https://api.sumup.com` |
| `TURNSTILE_SITE_KEY` | no | Cloudflare Turnstile key. Adds a "not a robot" check to sign-up |
| `TURNSTILE_SECRET_KEY` | yes | The secret Turnstile key |

**Old variables.** Older versions used variables for settings like the center name and prices (`PUBLIC_CENTER_NAME`, `CENTER_TIMEZONE`, `DEFAULT_LANGUAGE`, `THEME`, `PAYMENT_CURRENCY`, `PUBLIC_ALLOW_SIGNUP`, `EXCLUDED_PCS`, `PRICE_RULES`, `PLAN_GROUPS`, `TOPUP_*`). They don't work anymore. If one is still set, the log tells you where to put it in `config.jsonc`. Then delete the variable.

### Reaching the server

Cloudflare can't connect to an IP address like `192.168.1.10`. It needs a web address like `booking-api.example.com`.

The easiest free way is a **Cloudflare Tunnel** on the server PC. You don't need to open ports on your router. It also adds HTTPS.

```sh
cloudflared tunnel login
cloudflared tunnel create smartlaunch-api
cloudflared tunnel route dns smartlaunch-api booking-api.example.com
cloudflared tunnel run --url http://localhost:7833 smartlaunch-api   # use your REST port
```

Then set `SL_API_URL=https://booking-api.example.com`.

## Payments

When online payments are on:

- customers can add money to their balance on the **Top up** page
- if the center has [prices](#prices), customers **must pay online** to book

The money goes to the center's payment account. The website keeps a record of each payment in its database.

Right now the website supports **SumUp**.

### Setting up SumUp

1. In the SumUp Dashboard, open *Developers* and make an **API key**. Find your **merchant code** in your profile (it looks like `MH4H92C7`). For testing, use a SumUp test (sandbox) account.
2. Set `PAYMENT_PROVIDER=sumup`, `SUMUP_API_KEY` (as a secret) and `SUMUP_MERCHANT_CODE`.
3. Check that `currency` in `config.jsonc` is the same as your SumUp account's currency.
4. Deploy. You don't need to set anything else in SumUp.

SumUp sends updates to the website only if the website uses `https`. On your computer, the website checks payments in other ways instead.

### How a top-up works

1. The customer chooses an amount. The website saves an order and sends the customer to SumUp to pay.
2. The website asks SumUp if the payment is done. It asks when the customer comes back, when SumUp sends an update, and every 10 minutes.
3. When SumUp says it's paid, the money is added to the customer's Smartlaunch balance.
4. If the Smartlaunch server is offline, the website tries again later. It keeps trying until it works.

**Money is never added twice,** even if the website tries more than once.

A SumUp payment page stays open for 30 minutes. A failed payment can be tried again on that page, so the website waits an hour before it marks it as failed. Payments that never happen are closed after a day.

### How a paid booking works

The PCs are kept first. Then the customer pays. This way, two people can never get the same PC.

1. **Keep:** the customer confirms. The website books the PCs in Smartlaunch as **unpaid**. Nobody else can book them now.
2. **Pay:** the customer pays on the SumUp page. They have `holdMinutes` to do it (15 minutes by default).
3. **Done:** when the payment arrives, the booking is marked **paid**. The customer sees the booking number.
4. **Free again:** if the customer does not pay, goes back, or runs out of time, the booking is cancelled. The PCs are free again.

**Late payments.** Sometimes a payment arrives just after the time runs out. The website watches for this for one more hour:

- If the PCs are still free, it books them again. All good.
- If someone else took them, the order gets the status `needs_refund`. The customer is asked to contact the center. Give the money back in the SumUp dashboard.

### Finding a payment

Three numbers connect a payment to its booking:

| Number | Example | Where you find it |
| --- | --- | --- |
| Booking number | `#1234` | Smartlaunch booking, SumUp payment description, customer's confirmation page |
| Order number | `BKX7K2M9QP4RT8WZ3N` | Smartlaunch booking description, SumUp payment description, customer's confirmation page |
| SumUp transaction code | `TEENSK4W2K` | Smartlaunch booking description (after payment), SumUp transaction, customer's SumUp receipt |

In the admin program's booking calendar, an online booking shows as `#1234 username`. Open it to see the order number and SumUp code. **Paid** says NO while the customer is paying (or will pay at the center) and YES after they paid online. This needs a recent admin program and server. Older servers show every online booking as paid.

To see orders that are stuck, failed, or need a refund:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id, username, kind, amount_cents, status, attempts, last_error FROM orders WHERE status NOT IN ('delivered', 'expired') ORDER BY created_at DESC"
```

## Deploying

### Which way do you need?

It depends on two questions:

1. Is your domain's DNS managed by Cloudflare? (DNS is where your domain name is set up.)
2. Do you use online payments?

| DNS on Cloudflare? | Online payments? | What to deploy |
| --- | --- | --- |
| Yes | yes or no | **[A: one Worker](#a-one-worker)** |
| No | no | **[B: one Pages project](#b-one-pages-project)** |
| No | yes | **[C: Pages and a Worker](#c-pages-and-a-worker)**: you deploy twice |

Why? A Cloudflare **Worker** can only use your own domain if its DNS is on Cloudflare. **Pages** can use a domain from anywhere, but it can't run the job every 10 minutes that finishes payments. So option C uses Pages for the website and a Worker just for that job.

### First: make the database (all options)

Do this once per center:

```sh
npx wrangler login
npx wrangler d1 create smartlaunch-booking
```

1. Copy the `database_id` it prints into `wrangler.jsonc`.
2. In `wrangler.jsonc`, under `vars`, set `"CENTER": "<your-center>"`.
3. Make the tables:

   ```sh
   npm run db:migrate
   ```

Run `npm run db:migrate` again when a new file appears in the `migrations/` folder.

### A: one Worker

**From GitHub (easiest).** In Cloudflare, go to *Workers & Pages → Create → Workers → Import a repository*. Use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `smartlaunch_booking` (only if the project is inside a bigger repo)

Then add the [environment variables](#environment-variables) under the Worker's *Settings → Variables and Secrets*, and deploy again. After that, every push to GitHub updates the website.

**Or from your computer:**

```sh
npm run deploy
npx wrangler secret put SL_API_USERNAME          # do this for each secret
```

The website is now at `https://smartlaunch-booking.<your-subdomain>.workers.dev`. To use your own domain, add it under the Worker's *Settings → Domains & Routes*.

### B: one Pages project

1. In Cloudflare, create a **Pages** project from your GitHub repo. Build command: `npm run build`.
2. Under *Settings → Variables and Secrets*, add all the [environment variables](#environment-variables), **including `CENTER`**. Pages does not read `wrangler.jsonc`.
3. Under *Settings → Bindings*, add the database you made, with the name `DB`.
4. Under *Custom domains*, add your domain. Then add the CNAME record it shows at your DNS provider.

Every push to GitHub updates the website.

### C: Pages and a Worker

You deploy the same code twice:

- **Pages shows the website.** Set it up like [option B](#b-one-pages-project).
- **A Worker runs the payment job** every 10 minutes. Deploy it from your computer with `npm run deploy`, and add the same secrets. It stays on its `workers.dev` address; nobody visits it. Both use the same database.

**Keep them the same:**

- After each change, push to GitHub (Pages updates) **and** run `npm run deploy` (the Worker updates).
- When you change a secret, change it in both places.
- Pages uses new variables only after its next deploy.

## Running it on your computer

1. Turn on the REST API on a Smartlaunch server you can reach (see step 1 of [Setting up a center](#setting-up-a-center)).
2. Install and set up:

   ```sh
   npm install
   cp .env.example .env        # on Windows: copy .env.example .env
   ```

   Open `.env` and fill it in. On your computer, `SL_API_URL` can be an IP address:

   ```
   SL_API_URL=http://192.168.1.10:7833
   SL_API_USERNAME=<RESTBasicUsername>
   SL_API_PASSWORD=<RESTBasicPassword>
   SESSION_SECRET=<random text, 32+ characters>
   CENTER=default
   ```

3. Make the local database: `npm run db:migrate:local`. Do it again when new files appear in `migrations/`.
4. Start: `npm run dev`. Open http://localhost:5173 and log in with a Smartlaunch customer account.

**To test like on Cloudflare** (including the 10-minute job): put the same values in a file called `.dev.vars`. Then run `npm run build && npm run preview` and open http://localhost:4173. Or run `npx wrangler dev --test-scheduled` and open http://localhost:8787/__scheduled to run the job once.

| Command | What it does |
| --- | --- |
| `npm test` | Checks every center's settings and the price maths. Doesn't need a server |
| `npm run check` | Checks the code for type errors |
| `npm run gen` | Updates `worker-configuration.d.ts` after you change `wrangler.jsonc` |

### With DDEV

[DDEV](https://ddev.com) runs everything in a container, so you don't have to install Node yourself. Make the `.env` file as above, then:

```sh
ddev start                  # installs, makes the local database, starts the website
                            # https://smartlaunch-booking.ddev.site:5173
ddev preview                # like on Cloudflare: https://smartlaunch-booking.ddev.site:4173
ddev exec npm test          # run any npm command through ddev exec
```

- Use the server's network address in `SL_API_URL`, not `localhost`. The website runs inside the container.
- After you change `.env`, the website restarts by itself. If not, run `ddev restart`.
- Run `wrangler login`, online database changes and deploys on your own computer, not in DDEV.

## Problems and fixes

| What you see | Why, and what to do |
| --- | --- |
| Every page shows an error, and the log mentions `centers/<name>/config.jsonc` | There is a mistake in your settings. The log lists each one. Fix them and deploy again |
| The website says "Smartlaunch" and looks plain | `CENTER` is not set, or it is spelled wrong. The log says `centers/<name>/config.jsonc not found`. On Pages, set `CENTER` in the dashboard |
| The log says `… is set but no longer read` | An old variable is still set. Move its value into `config.jsonc`, then delete the variable |
| "The booking service is misconfigured" | `SL_API_URL` is an IP address (Cloudflare blocks these), or the username or password is wrong. The log says which |
| "The center server could not be reached" | `SL_API_URL` is wrong, the server is off, or a firewall blocks it |
| It works on your computer but not on Cloudflare | `SL_API_URL` is an IP address. See [Reaching the server](#reaching-the-server) |
| `SESSION_SECRET must be set…` | `SESSION_SECRET` is missing or too short (it needs 32+ characters) |
| "The payment could not be started" | The SumUp key or merchant code is wrong, or `currency` doesn't match your SumUp account. The log shows SumUp's answer |
| No "Top up" link | `PAYMENT_PROVIDER` is empty, or a SumUp setting is missing (the log says which) |
| `The D1 database binding DB is missing` | The `database_id` in `wrangler.jsonc` is missing, `npm run db:migrate` was not run, or (on Pages) the `DB` binding was not added |
| Paid bookings don't work at all | The Smartlaunch server is too old. Paid bookings need a server with `BookingStore` |

## Look and languages

### The look (theme)

The look comes from `theme.css` and `favicon.svg` in your center folder. If your folder doesn't have them, the ones in `centers/default` are used.

| Folder | Look |
| --- | --- |
| `default` | Simple and neutral, blue. Switches between light and dark with the visitor's device |
| `esportsnord` | Bold and dark, red, with slanted shapes. A good start for a strongly branded look |

`theme.css` sets the colours, fonts and shapes. `centers/default/theme.css` lists every option, with notes.

To make your own look, create `centers/<your-center>/theme.css`. Start from the default and change only what you want:

```css
/* Web fonts must come first. */
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap');
@import '../default/theme.css';

/* :root:root also wins over the default's dark mode. Use plain :root to keep dark mode. */
:root:root {
	--font-display: 'Poppins', sans-serif;
	--font-body: 'Poppins', sans-serif;
	--accent: #e11d48;
	--accent-hover: #be123c;
	--seat-picked: var(--accent);
	--pass-bg: #4c0519;
}
```

Then deploy again.

- To start from another center's look, import its file instead: `@import '../esportsnord/theme.css';`
- Pictures go in your center folder. Use them with `url(...)`.
- For a font that isn't on Google Fonts: put the font files in your center folder, add an `@font-face` in `theme.css`, and put the font first in `--font-display`.
- Fonts or pictures from other websites (not Google Fonts) are blocked for safety. Add that website to the Content-Security-Policy in `vite.config.ts`.

### Languages

The website is in English, German and Danish. Visitors change the language with the flags at the top. The website remembers their choice for a year.

If the visitor hasn't chosen, the website uses their browser's language. If that is not available, it uses `defaultLanguage` from your settings.

To add a language (for developers): all texts are in `src/lib/i18n/`. Copy `en.ts` to a new file, like `fr.ts`, and translate it. Then add it to `LOCALES`, `LANGUAGE_NAMES`, `INTL_LOCALES` and the dictionaries in `src/lib/i18n/index.ts`. Give it a flag in `src/routes/+layout.svelte`. `npm run check` tells you if a text is missing.

## For developers

### How it fits together

```
Browser ──► Cloudflare Worker (SvelteKit pages + /api/*) ──Basic auth──► Smartlaunch server REST API
                    │        ▲
                    ▼        │ webhooks
              D1 (orders)   Payment provider (SumUp)
```

- The REST API (`sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb`) uses one shared username and password. So the browser never calls it directly. The Worker keeps the password secret and offers only what customers need.
- Logins are signed cookies.
- The D1 database stores payments, rate limits and locks. Accounts, bookings and balances stay on the Smartlaunch server.

| Website endpoint | Smartlaunch REST calls |
| --- | --- |
| `POST /api/login` `{username, password}` | `GET /users/{username}/check?password=`, `GET /users/{username}` |
| `POST /api/signup` `{username, password, email, mobilePhone?, firstName, lastName, address, zip, city, gender, birthday}` | `GET /users/{username}` (is it taken?), `POST /users/create`, then the login calls |
| `POST /api/logout`, `GET /api/me` | none |
| `GET /api/layouts` | `GET /layoutgroups` |
| `GET /api/computerlayoutpositions` | `GET /computerlayoutpositions` |
| `GET /api/computers` | `GET /computers` (only id, name, group, console type) |
| `GET /api/booking/getbooked?start=YYYY-MM-DDTHH:mm&minutes=N`<br>or `?startdate=yyyyMMddHHmm&enddate=yyyyMMddHHmm` | `GET /booking/getbooked` |
| `GET /api/quote?start=…&minutes=N&pcs=1;2;3` | `GET /users/{username}`, `GET /usergroups`, `GET /bookings`; with zones also `GET /computers`, `GET /computergroups` |
| `GET /api/bookings` | `GET /bookings`, only the customer's own |
| `POST /api/bookings` `{start, minutes, computerIds, orderCode?}` | `POST /bookings`; when paid online, `POST /bookings/create` and a checkout |
| `POST /api/bookings/{order}/cancel` | `DELETE /bookings/{id}` for an unpaid booking |
| `POST /api/payments/webhook/{provider}` | after checking with the provider: `POST /users/{username}/addmoney`, or `PUT /bookings/{id}` |
| `POST /api/payments/sweep` (the 10-minute job) | the same, for orders that are not finished |

Pages: `/login`, `/signup`, `/` (book), `/bookings` (my bookings), `/topup`, `/topup/return` and `/book/return` (where SumUp sends customers back).

**The Worker.** SvelteKit builds the app into `.svelte-kit/cloudflare/_worker.js` (set up by `wrangler.sveltekit.jsonc`, used only by the build). The deployed Worker is set up by `wrangler.jsonc` and starts at `worker/index.js`. That file passes requests to the app and adds the 10-minute job. The job calls `/api/payments/sweep`, using `SESSION_SECRET` as its key.

**The center folder.** `src/lib/config.ts` reads and checks `config.jsonc` and fills in defaults. It has no framework imports, so `npm test` can use it. `src/lib/server/center.ts` loads the folder named by `CENTER`. `src/lib/theme.ts` picks the theme and icon. `src/lib/pricing.ts` does the price maths.

### Good to know

- **Times are the center's local time.** The server turns booking times into dates without any time zone. The website does the same (`src/lib/time.ts`). So 18:00 on the website is 18:00 in Smartlaunch, wherever Cloudflare runs.
- **The whole booking time is checked.** Before booking, the website checks that the PCs are free for the whole time. Newer servers (with `BookingStore`) also check this themselves, and keep PCs free for `BookingBufferMinutes` (in server.inf) after each booking. Older servers only check the start time, so the website's own check protects them.
- **Safe text.** The server builds some database commands by joining text. So the website doubles quotes in all text, allows only numbers as PC IDs and order codes of `A-Z` and `0-9`, and allows only letters, numbers, `.`, `-` and `_` in usernames.
- **Sign-up.** New accounts go into the server's "members" group (or its first group). Name, street and number, ZIP code, city, gender and birthday are required. The mobile number is optional. Smartlaunch only knows female (0) and male (1). Non-binary is saved as 2; the server keeps it, but the admin program shows it as female. The server may refuse a username it finds rude; the website then asks for another.
- **No double bookings from retries.** Each booking sends a code from the browser. The website mixes it with the username into the booking's `OrderCode`. If the same request is sent twice, the second one finds the first booking.
- **Whose booking is it?** Staff can type any name on a booking. So a booking counts as a customer's only if it has their username **and** was made by them on this website or has their phone number.

### Limits against abuse

Counters are kept in the database, so they work across all of Cloudflare's servers. A customer who hits a limit is told how long to wait.

| What | Limit |
| --- | --- |
| Login | 30 tries per IP address, and 10 wrong passwords per username, per 15 minutes |
| Sign-up | 5 accounts per IP address per hour, plus the optional Turnstile check |
| Booking | 20 tries per hour; `maxUpcomingBookings` future bookings (10); one request at a time per customer |
| Unpaid bookings | `maxOpenHolds` at once (2); after `maxUnpaidHoldsPerHour` (4) unpaid in an hour, wait an hour |
| Top-up | `topupsPerHour` per hour (10) |
| Free PCs, prices, booking list | 120 requests per minute per customer |

The limits with a setting name can be changed in `config.jsonc`. The others are in `src/lib/server/booking.ts`, `orders.ts` and the API routes. Booking and top-up also check that the customer's Smartlaunch account still exists. If it was deleted, the customer is logged out.

The website also sends security headers: a Content-Security-Policy (in `vite.config.ts`), HSTS on https, `X-Frame-Options: DENY` and `nosniff`.

### Adding another payment provider

Payment providers are in `src/lib/server/payments/`. To add one (like Stripe or Adyen):

1. Make `src/lib/server/payments/<name>.ts`. It must have three functions from `PaymentProvider` in `provider.ts`:
   - `createCheckout`: create a payment page and return its id and address
   - `getCheckout`: read a payment's status, amount, currency and reference
   - `parseWebhook`: get the payment id from an update the provider sends

   Use `sumup.ts` as an example.
2. Add a `case '<name>'` to `create()` in `payments/index.ts`. Add its settings to `src/env.ts`.
3. Set `PAYMENT_PROVIDER=<name>`.

Nothing else needs to change. Updates from the provider arrive at `/api/payments/webhook/<name>`. The website never trusts them alone; it always asks the provider again. So providers without signed updates are fine. SvelteKit blocks updates sent as forms or with no content type from other websites, so such a provider needs a different route.
