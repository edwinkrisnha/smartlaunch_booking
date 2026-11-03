-- Paid online bookings. SQLite can't change a CHECK constraint, so the orders table
-- is rebuilt with the new kind and status, plus the columns a booking order needs.

CREATE TABLE orders_new (
	-- Also the provider's checkout reference: letters and digits only.
	-- Top-ups start with TU (and are the Smartlaunch OrderCode), bookings with BK.
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('topup', 'booking')),
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	currency TEXT NOT NULL,
	-- pending -> paid -> delivering -> delivered; pending -> failed | expired.
	-- needs_refund: a booking was paid after its hold ended and the stations had been taken.
	status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'delivering', 'delivered', 'failed', 'expired', 'needs_refund')),
	provider TEXT NOT NULL,
	provider_ref TEXT,
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER,
	lease_until INTEGER,
	last_error TEXT,
	-- Bookings: the Smartlaunch BookingID holding the stations, the booking as JSON,
	-- and when an unpaid hold is released (Unix seconds).
	booking_id TEXT,
	details TEXT,
	hold_until INTEGER,
	-- Unix seconds (UTC).
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	paid_at INTEGER,
	delivered_at INTEGER
);

INSERT INTO orders_new (id, username, kind, amount_cents, currency, status, provider, provider_ref, attempts,
	next_attempt_at, lease_until, last_error, created_at, updated_at, paid_at, delivered_at)
SELECT id, username, kind, amount_cents, currency, status, provider, provider_ref, attempts,
	next_attempt_at, lease_until, last_error, created_at, updated_at, paid_at, delivered_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE UNIQUE INDEX orders_provider_ref ON orders (provider, provider_ref);
CREATE INDEX orders_username ON orders (username, created_at);
CREATE INDEX orders_status ON orders (status, next_attempt_at);
