# Smartlaunch Booking

Customer-facing PC booking site for a Smartlaunch center. Built with SvelteKit and deployed to Cloudflare Pages (free tier).

It talks to the center's Smartlaunch server REST API (`sl4_server/Classes/Connections/RESTful/ISmartlaunchRESTService.vb`), the same API the MVC web client uses. Customers log in with their Smartlaunch account, pick a date, time and duration, choose free PCs on the center layout, and confirm.

## How it works

```
Browser ──► Cloudflare Pages (SvelteKit pages + /api/* Functions) ──Basic auth──► Smartlaunch server REST API
```

The REST API is protected by one shared Basic-auth credential, so the browser never calls it directly. The Pages Functions hold that credential as a secret and expose only what a customer needs. Sessions are HMAC-signed cookies, so no KV or database is needed.

| App endpoint | Smartlaunch REST call |
| --- | --- |
| `POST /api/login` `{username, password}` | `GET /users/{username}/check?password=` then `GET /users/{username}` |
| `POST /api/logout` | none |
| `GET /api/layouts` | `GET /layoutgroups` |
| `GET /api/computerlayoutpositions` | `GET /computerlayoutpositions` |
| `GET /api/computers` | `GET /computers` (trimmed to id, name, group) |
| `GET /api/booking/getbooked?startdate=yyyyMMddHHmm&enddate=yyyyMMddHHmm`<br>or `?start=YYYY-MM-DDTHH:mm&minutes=N` | `GET /booking/getbooked` |
| `GET /api/bookings` | `GET /bookings`, filtered to the logged-in customer |
| `POST /api/bookings` `{start, minutes, computerIds, orderCode?}` | `POST /bookings` |

The pages are `/login`, `/` (book) and `/bookings` (my bookings).

### Things worth knowing

- **Times are center wall-clock time.** The server converts booking timestamps with `New DateTime(1970,1,1).AddSeconds(ts)`, with no time zone involved. The app sends and reads timestamps as naive wall-clock seconds (`src/lib/time.ts`), so `18:00` in the form becomes `18:00` in Smartlaunch whatever zone Cloudflare runs in.
- **Availability is re-checked before booking.** `APIParser.BookingAdd` only rejects a PC whose existing booking covers the new *start* time. The app first checks the whole window with `/booking/getbooked`, as the MVC client does.
- **SQL escaping.** The server builds the booking `INSERT` by string concatenation. The app doubles quotes in every text field, allows only numeric PC IDs, and restricts order codes to `[A-Z0-9]`.
- **Duplicate protection.** Each confirm sends an `OrderCode`; the server ignores a second booking with the same code.
- **Payments are out of scope.** Unlike the MVC client's flow, which goes through the payment providers and the Azure DB, this app writes the booking straight to the center server.

## Themes

The site's look comes from a theme in `src/themes/<name>/`. Pick one with `THEME=<name>` in `.env` (or in Cloudflare Pages). If `THEME` is unset or names a folder that doesn't exist, the `default` theme is used and the server logs a warning.

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
3. Set `THEME=mytheme` and rebuild. Themes are bundled at build time, so a new or changed theme needs a new build and deploy.

To customise an existing theme, copy its folder under a new name and edit that, so updates to the original don't overwrite your changes.

The `esportsnord` theme uses Unbounded as a free stand-in for INTEGRAL CF. To use the licensed font, put the font files in the theme folder, add an `@font-face` for them in its `theme.css`, and put that family first in `--font-display`.

## Configuration

| Variable | Secret? | Description |
| --- | --- | --- |
| `SL_API_URL` | no | Base URL of the REST API, e.g. `https://booking-api.example.com` |
| `SL_API_USERNAME` | yes | `RESTBasicUsername`, or an employee login if `RESTUseEmployeeLoginAsSecurity` is on |
| `SL_API_PASSWORD` | yes | Matching password |
| `SESSION_SECRET` | yes | Random string of 32+ characters for signing session cookies |
| `CENTER_TIMEZONE` | no | Optional IANA zone (e.g. `Asia/Jakarta`); rejects past start times server-side |
| `SL_LICENSE_EMAIL` | no | Optional; adds `?licenseemail=` for relay setups |
| `PUBLIC_CENTER_NAME` | no | Name shown in the header |
| `THEME` | no | Theme folder under `src/themes`; defaults to `default` (see [Themes](#themes)) |

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

**3. Start it.**

```sh
npm run dev                 # http://localhost:5173
```

Log in with a customer account from Smartlaunch.

To run in the real Cloudflare Workers runtime, put the same values in `.dev.vars`, then run `npm run build && npm run preview` (http://localhost:4173).

Other scripts:

```sh
npm run check               # type check
npm run gen                 # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

### Troubleshooting

| Message | Cause |
| --- | --- |
| "The booking service is misconfigured" | The server rejected `SL_API_USERNAME` / `SL_API_PASSWORD` |
| "The center server could not be reached" | `SL_API_URL` is wrong, the server is down, or a firewall blocks the port |
| `SESSION_SECRET must be set…` in the console | `SESSION_SECRET` is missing or shorter than 32 characters |
| Works locally, fails after deploy | `SL_API_URL` is a LAN or bare IP address; see *Reaching the center server from Cloudflare* |

## Deploying to Cloudflare Pages

**Option A: Git integration (recommended).** Push this folder to a Git repo, then in Cloudflare go to *Workers & Pages → Create → Pages → Connect to Git* and use:

- Framework preset: SvelteKit
- Build command: `npm run build`
- Build output directory: `.svelte-kit/cloudflare`
- Root directory: `smartlaunch_booking`, if it lives in a larger repo

Then add the variables above under *Settings → Variables and Secrets*, using the **Secret** type for the credentials, and redeploy.

**Option B: from your machine.**

```sh
npx wrangler login
npm run deploy                                   # first run creates the "smartlaunch-booking" project
npx wrangler pages secret put SL_API_USERNAME    # repeat for each variable
```

**Recommended:** add a free Cloudflare rate-limiting rule on `/api/login` and `/login` to slow down password guessing.
