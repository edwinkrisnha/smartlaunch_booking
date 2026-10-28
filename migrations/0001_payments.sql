-- Online payments. The Smartlaunch server stays the source of truth for balances;
-- these tables only track what was paid and whether it has been delivered there.

CREATE TABLE orders (
	-- Also the Smartlaunch OrderCode and the provider's checkout reference: letters and digits only.
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('topup')),
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	currency TEXT NOT NULL,
	-- pending -> paid -> delivering -> delivered; pending -> failed | expired.
	-- "delivering" is a short lease so two workers never credit the same order at once.
	status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'delivering', 'delivered', 'failed', 'expired')),
	provider TEXT NOT NULL,
	provider_ref TEXT,
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER,
	lease_until INTEGER,
	last_error TEXT,
	-- Unix seconds (UTC).
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	paid_at INTEGER,
	delivered_at INTEGER
);

CREATE UNIQUE INDEX orders_provider_ref ON orders (provider, provider_ref);
CREATE INDEX orders_username ON orders (username, created_at);
CREATE INDEX orders_status ON orders (status, next_attempt_at);

-- Raw provider notifications, kept for support and auditing.
CREATE TABLE payment_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	provider TEXT NOT NULL,
	provider_ref TEXT,
	event_type TEXT,
	payload TEXT NOT NULL,
	received_at INTEGER NOT NULL
);
