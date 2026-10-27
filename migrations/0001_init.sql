-- items: 画像専用ではなく「Wiki の 1 要素」(DESIGN.md D3)
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,      -- 32 hex (crypto.randomUUID のハイフン除去)
  kind         TEXT NOT NULL,         -- 'image' | 'text' | 'link'
  blob_hash    TEXT,                  -- sha256 hex。R2 key = blobs/<hash>
  content_type TEXT,
  bytes        INTEGER,
  width        INTEGER,
  height       INTEGER,
  title        TEXT,
  body         TEXT,                  -- 本文 / メモ。Phase 2 で使い始める
  ocr_text     TEXT,                  -- Phase 3
  caption      TEXT,                  -- Phase 3
  source_url   TEXT,
  created_at   INTEGER NOT NULL,      -- epoch ms
  deleted_at   INTEGER
);

CREATE INDEX IF NOT EXISTS items_created ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS items_hash    ON items(blob_hash);
