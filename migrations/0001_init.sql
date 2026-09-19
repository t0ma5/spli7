-- spli7 schema. Normalized rows + version column for optimistic concurrency.

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  information TEXT,
  currency TEXT NOT NULL DEFAULT '$',
  currency_code TEXT,
  pin_hash TEXT,
  default_split_mode TEXT NOT NULL DEFAULT 'EVENLY',
  fixed_expense_date_groups INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_activity_at TEXT,
  last_seen_at TEXT,
  deleted_at TEXT
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL,
  original_amount INTEGER,
  original_currency TEXT,
  conversion_rate REAL,
  is_reimbursement INTEGER NOT NULL DEFAULT 0,
  split_mode TEXT NOT NULL DEFAULT 'EVENLY',
  created_at TEXT NOT NULL,
  notes TEXT,
  recurrence_rule TEXT
);

CREATE TABLE expense_paid_by (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  amount INTEGER NOT NULL,
  PRIMARY KEY (expense_id, participant_id)
);

CREATE TABLE expense_paid_for (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  shares INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (expense_id, participant_id)
);

CREATE TABLE expense_documents (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);

CREATE TABLE recurring_expense_links (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  current_frame_expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
  next_expense_created_at TEXT,
  next_expense_date TEXT NOT NULL
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  participant_id TEXT,
  expense_id TEXT,
  data TEXT
);

CREATE TABLE pin_attempts (
  group_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER,
  PRIMARY KEY (group_id, client_key)
);

CREATE INDEX idx_participants_group ON participants(group_id, sort_order);
CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date DESC, created_at DESC);
CREATE INDEX idx_activities_group_time ON activities(group_id, time DESC);
CREATE INDEX idx_recurring_due ON recurring_expense_links(next_expense_date);
CREATE INDEX idx_groups_cleanup ON groups(deleted_at, last_activity_at, last_seen_at);
