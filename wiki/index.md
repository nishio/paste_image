# index

全ページ。新しいページを作ったらここに1行足す([[README]] の Lint)。

## プロジェクト

- [paste_image](pages/paste-image.md) — 何を作っているか、なぜ既製品ではないか、現在地
- [item であって image ではない](pages/item-not-image.md) — スキーマの中心概念を先に決めた判断と、やりすぎないための線引き
- [画像を検索可能にする](pages/searchable-images.md) — 個人用 Gyazo の最大の不満であり、LLM Wiki への接続点

## 設計の概念

- [Capability URL](pages/capability-url.md) — 推測不能 URL を権限とみなす公開モデル。成立条件と、削除を Phase 0 に入れた理由
- [blob ストアは差し替えられる](pages/blob-store-swappable.md) — 依存しているのは4操作だけ。R2 / KV / S3 の比較と、結果整合性が無害な理由
- [content-addressed storage](pages/content-addressed-storage.md) — sha256 を key にして得たもの、代償、同じ画像を貼ったページが繋がる副産物

## プラットフォーム

- [Cloudflare Workers の制約](pages/cloudflare-workers-constraints.md) — 無料枠、CPU 10 ms、キャッシュ、独自ドメイン、wrangler dev で踏んだこと

## 運用

- [デプロイに何が必要か](pages/deploy.md) — deploy が作る4つのリソース、認証経路と必要な権限、R2 の支払い方法、やり直せないこと

## 実装で分かったこと

- [SVG を受け付けない理由](pages/svg-upload-risk.md) — 書き込みトークンを持つ UI と同一オリジンで配信する構成の話
- [画像の寸法をヘッダから読む](pages/image-header-dimensions.md) — 形式ごとの位置と、踏みやすい点
