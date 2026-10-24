-- Balance ledger. Each paid-for row stores its exact owed amount (the
-- largest-remainder split from src/lib/shares), and participant_balances keeps
-- per-participant sums, rebuilt in the same transaction as every expense write.
-- Balance reads then touch one row per participant instead of every expense.
ALTER TABLE expense_paid_for ADD COLUMN owed INTEGER;

CREATE TABLE participant_balances (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  owed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, participant_id)
);

-- 1 once every paid-for row of the group has `owed`. Older groups stay 0 and
-- fall back to the full scan until their first read fills them.
ALTER TABLE groups ADD COLUMN balances_ready INTEGER NOT NULL DEFAULT 0;

-- Groups with no expenses have nothing to fill.
UPDATE groups SET balances_ready = 1
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE expenses.group_id = groups.id);
