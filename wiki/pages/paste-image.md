# paste_image

ブラウザから paste すると保存され、URL を知っている人が閲覧できる画像置き場。個人用 Gyazo。

## 何を作っているか

最終目標は「LLM が読み書きできる個人 Wiki」で、画像置き場はその最初の 1 ブロック種別。
**画像専用システムとして設計しない**というのが、この repo の一番上位の制約。

その帰結が [[item-not-image]] で、スキーマを `images` ではなく
`items(kind, body, ocr_text, caption)` にしてある。

## なぜ既製品ではないのか

Gyazo も imgur も既にある。それでも自作する理由は 2 つ。

- **LLM から読める形で手元に置きたい。** 画像だけ置いても LLM からは使えない。
  画像に対するテキスト(OCR・キャプション・自分のメモ)が同じ item に乗って初めて、
  Wiki の一部になる([[searchable-images]])。
- **content-addressed にすると副産物が付いてくる。** [[content-addressed-storage]] 参照。

## 現在地

- Phase 0 完了(2026-10-27): paste → 保存 → URL 閲覧、upload API、削除、export
- 未デプロイ。ドメインが未決([[cloudflare-workers-constraints]] の「独自ドメイン」)

Phase の定義は [DESIGN.md](../../DESIGN.md) §8。

## 関連

- [[capability-url]] — 公開モデル
- [[content-addressed-storage]] — 保存方式
- [[cloudflare-workers-constraints]] — 実行環境の制約
- [[svg-upload-risk]] — 受け付ける形式を絞った理由
