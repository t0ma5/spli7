-- Ways each participant can be paid (SEPA, MobilePay, Swish, Bizum, Venmo,
-- PayPal.me, Revolut.me). JSON array validated by src/lib/payment-methods.
ALTER TABLE participants ADD COLUMN payment_methods TEXT;
