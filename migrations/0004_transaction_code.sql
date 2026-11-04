-- The provider's code for the payment itself (SumUp: transaction_code, e.g. TEENSK4W2K).
-- It is on the customer's receipt and in the SumUp dashboard, and is written into the
-- paid booking's description in Smartlaunch, so staff can match the two.

ALTER TABLE orders ADD COLUMN provider_txn TEXT;
