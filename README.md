# paste_image

個人用 Gyazo。ブラウザから paste すると保存され、URL を知っている人が閲覧できる。
Cloudflare Workers + R2 + D1 の単一 Worker で動く。

最終目標は「LLM が読み書きできる個人 Wiki」で、これはその Phase 0。
設計の根拠と判断の記録は [DESIGN.md](DESIGN.md)。

作業から得た知識は [wiki/](wiki/) に filing back している([index](wiki/index.md))。
仕様は DESIGN.md、使い方はこの README、**なぜそうしたか**は wiki にある。

## できること (Phase 0)

- ブラウザで `Ctrl/⌘+V` / ドラッグ&ドロップ / ファイル選択 → アップロード、URL を自動コピー
- raw URL / page URL / Markdown / Cosense 記法 / `<img>` をワンクリックでコピー
- `POST /api/items` に生バイト列を投げるだけのアップロード API(CLI・スクショ監視から使える)
- 削除(論理削除 + 参照の消えた blob を R2 から回収)
- 全件 JSONL エクスポート

## API

認証は Bearer トークン 1 本。読み出し(`/{id}`、`/i/{id}.ext`)だけ無認証。

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| `GET` | `/` | 要 | paste UI |
| `GET` | `/{id}` | 不要 | 閲覧ページ(OGP 付き) |
| `GET` | `/i/{id}.{ext}` | 不要 | 生画像(`immutable` キャッシュ) |
| `POST` | `/api/items` | 要 | アップロード。body = 生バイト列、`?title=`・`?source=` 任意 |
| `GET` | `/api/items` | 要 | 一覧。`?limit=50&before=<created_at>` |
| `GET` | `/api/items/{id}` | 要 | メタデータ |
| `PATCH` | `/api/items/{id}` | 要 | `title` / `body` / `source_url` を更新 |
| `DELETE` | `/api/items/{id}` | 要 | 削除 |
| `GET` | `/api/export` | 要 | 全件 JSONL |

```sh
curl -X POST "https://example.com/api/items?title=screenshot" \
  -H "Authorization: Bearer $PASTE_IMAGE_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @shot.png
# => {"id":"...","page_url":"https://example.com/<id>","raw_url":"https://example.com/i/<id>.png", ...}
```

対応形式は png / jpeg / gif / webp / avif、上限 10 MB。
SVG は同一オリジンでスクリプトを実行できるため受け付けない。

## セットアップ

```sh
npm install

# R2 バケットと D1 を作る
npx wrangler r2 bucket create paste-image
npx wrangler d1 create paste-image     # 出力された database_id を wrangler.jsonc に書く

# スキーマを流す
npx wrangler d1 migrations apply paste-image --remote

# アップロード用トークン(任意の長いランダム文字列)
openssl rand -base64 32 | npx wrangler secret put UPLOAD_TOKEN

npx wrangler deploy
```

本番では独自ドメインを割り当てること。`*.workers.dev` は共有ドメインで、
ブロックリストの巻き込みと Cookie 境界の問題がある(wrangler.jsonc の `routes` を参照)。

### ローカル開発

```sh
echo 'UPLOAD_TOKEN=dev-token' > .dev.vars
npx wrangler d1 migrations apply paste-image --local
npx wrangler dev
```

## バックアップ

単一ベンダの上にしか存在しない状態を作らない(DESIGN.md D7)。

```sh
# メタデータ
curl -H "Authorization: Bearer $PASTE_IMAGE_TOKEN" https://example.com/api/export > backup/items.jsonl
# 画像本体 (rclone に R2 を S3 互換として設定しておく)
rclone sync r2:paste-image backup/blobs
```

## 次のフェーズ

- Phase 1: OS 側のスクショ監視からの自動アップロード
- Phase 2: 一覧 UI の強化、タグ、`body`(メモ)の活用
- Phase 3: OCR / 自動キャプション、FTS5 で画像を検索可能に
- Phase 4: `/mcp` エンドポイント、item 間リンク、Cosense 連携
