# item であって image ではない

スキーマを `images` ではなく `items(kind, ...)` にした判断。

## 何をしたか

```sql
CREATE TABLE items (
  id, kind,                      -- 'image' | 'text' | 'link'
  blob_hash, content_type, bytes, width, height,
  title, body,                   -- body = 本文 / メモ。Phase 2 で使い始める
  ocr_text, caption,             -- Phase 3 で埋める。Phase 0 では常に NULL
  source_url, created_at, deleted_at
);
```

Phase 0 で実際に使うのは画像に関する列だけ。
`body` / `ocr_text` / `caption` は**最初から置いてあるが使っていない**。

## なぜ使わない列を最初に置くのか

最終目標が「LLM が読み書きできる個人 Wiki」だから。
画像専用のスキーマと URL 体系を先に作ると、テキストやリンクを足す段階で
ID 体系ごと作り直しになる。ID は外部に配った capability URL なので、**作り直せない**。

列を足すだけなら後からでもできるが、
「画像という概念を中心に据えてしまった設計」は後から直せない。
だから列ではなく**中心概念を先に決めた**。

## やりすぎないための線引き

将来を見越して置いたのは、**ID 体系・テーブルの中心概念・URL の形**だけ。
以下は意図的に作っていない。

- `tags` テーブル(Phase 2 まで不要、形も決まっていない)
- FTS5 の仮想テーブル(Phase 3。中身が無いうちは索引する対象がない)
- item 間リンク(Phase 4)

後から足せるものは足さない。後から直せないものだけ先に決める。

## 関連

- [[paste-image]]
- [[searchable-images]]
