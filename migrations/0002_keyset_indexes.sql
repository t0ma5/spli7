-- Covering indexes for keyset pagination (date/time + id).

DROP INDEX IF EXISTS idx_expenses_group_date;
CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date DESC, created_at DESC, id DESC);

DROP INDEX IF EXISTS idx_activities_group_time;
CREATE INDEX idx_activities_group_time ON activities(group_id, time DESC, id DESC);
