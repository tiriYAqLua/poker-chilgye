-- Initial PostgreSQL schema. Apply transactionally before accepting traffic.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  balance BIGINT NOT NULL CHECK (balance BETWEEN 0 AND 9007199254740991),
  last_grant BIGINT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS google_identities (
  subject TEXT PRIMARY KEY,
  account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS google_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS display_names (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friend_codes (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  code TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL REFERENCES accounts(id),
  recipient TEXT NOT NULL REFERENCES accounts(id),
  created_order BIGINT GENERATED ALWAYS AS IDENTITY,
  UNIQUE(sender, recipient), CHECK(sender <> recipient)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair ON friend_requests (LEAST(sender, recipient), GREATEST(sender, recipient));
CREATE TABLE IF NOT EXISTS friendships (
  left_id TEXT NOT NULL REFERENCES accounts(id),
  right_id TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY(left_id, right_id), CHECK(left_id < right_id)
);
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL REFERENCES accounts(id),
  receiver TEXT NOT NULL REFERENCES accounts(id),
  amount BIGINT NOT NULL CHECK(amount > 0)
);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  room TEXT NOT NULL,
  stack BIGINT NOT NULL CHECK(stack BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hand_history (
  hand_id TEXT NOT NULL REFERENCES settlements(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  room TEXT NOT NULL,
  change BIGINT NOT NULL,
  finished_at BIGINT NOT NULL,
  created_order BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(hand_id, account_id)
);
CREATE INDEX IF NOT EXISTS hand_history_account ON hand_history(account_id, finished_at DESC, created_order DESC);
CREATE TABLE IF NOT EXISTS active_hands (
  account_id TEXT PRIMARY KEY REFERENCES seats(account_id),
  hand_id TEXT NOT NULL,
  room TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hand_snapshots (
  hand_id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version >= 0),
  nonce BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  ciphertext BYTEA NOT NULL
);
