# log

何をいつ ingest したか。新しい方を上に足す。

## 2026-10-28 — デプロイ着手、認証で止まる

`wrangler deploy --dry-run` は通る(バンドル 15.23 KiB)が、作業機が未認証でデプロイできない。
「認証が何のために必要か」を先に書いた → [[deploy]]

分かったこと:

- バインディングがあるだけなら R2 / D1 の権限は要らない。
  今回要るのはバケットと DB を**作って migration を流す**から。
  2回目以降の deploy は Workers 権限だけで回る
- **R2 の有効化には支払い方法の登録が要る**(無料枠内でも)。使用量にキャップが無いため。
  これが最初の関門
- `wrangler login` の OAuth は localhost:8976 へコールバックするので、SSH 越しの作業機では成立しない

Phase 0 のデプロイ先は workers.dev に決めた(独自ドメインは後)。

## 2026-10-28 — Phase 0 の設計と実装のセッション

ソース: Claude Code との作業セッション(2026-10-27〜28)。
commit `aaab8ea`(設計方針)と `90a2f61`(Phase 0 実装)。

この wiki を作成。以下 8 ページを新規作成した。

- `paste-image` / `item-not-image` / `searchable-images`
- `capability-url` / `content-addressed-storage`
- `cloudflare-workers-constraints`
- `svg-upload-risk` / `image-header-dimensions`

このセッションで判断が変わったところ:

- スキーマを `images` → `items` にした。画像専用に作ると作り直しになるため → [[item-not-image]]
- 削除と export を Phase 1 から **Phase 0 に繰り上げた**。
  capability URL は漏れたら取り消せず、単一ベンダ上にしか存在しない状態は後から高くつくため
- content-addressed にしたことで、「同じ図を貼ったページが繋がる」が
  実装の副産物として射程に入った → [[content-addressed-storage]]

未決のまま残っているもの(次に読む人へ):

- ドメイン。ページと生画像を別ホストにするか、パス分割のままにするか。
  [[svg-upload-risk]] の「将来 SVG を入れたくなったら」と繋がっている
- 原本保持か webp 変換か → [[cloudflare-workers-constraints]]
- OCR / キャプションの実装手段 → [[searchable-images]]
