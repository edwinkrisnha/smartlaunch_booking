-- Abuse protection: request counters for rate limits (login attempts, sign-ups,
-- bookings) and short per-customer locks so one customer's booking requests run
-- one after another.

CREATE TABLE rate_limits (
	key TEXT PRIMARY KEY,
	count INTEGER NOT NULL,
	-- Unix seconds when the current window ends and the count starts again.
	reset_at INTEGER NOT NULL
);

CREATE TABLE locks (
	key TEXT PRIMARY KEY,
	-- Unix seconds; the lock is free again after this even if its holder never released it.
	until INTEGER NOT NULL
);
