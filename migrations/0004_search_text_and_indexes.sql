-- Search column lowercased by the app (SQLite LOWER() only folds ASCII, so a
-- search for "äiti" never matched "Äiti"). The backfill below covers ASCII;
-- run scripts/backfill-search-text.mjs once to redo old rows with JS rules.
ALTER TABLE expenses ADD COLUMN search_text TEXT;
UPDATE expenses SET search_text = LOWER(title) || char(10) || LOWER(IFNULL(notes, ''));

-- Every expense hydrate reads a group's recurring links; this was a full scan.
CREATE INDEX IF NOT EXISTS idx_recurring_group ON recurring_expense_links(group_id);

-- Cleanup prunes rate-limit rows by age.
CREATE INDEX IF NOT EXISTS idx_pin_attempts_window ON pin_attempts(window_start);
