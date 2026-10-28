# Capability URL

推測不能な URL を知っていること自体を権限とみなす公開モデル。

## 採用理由

「URL を知ってる人が閲覧できる」という要件に対して、
ACL もログインもセッションも作らずに済む唯一の素直な解。
Gyazo、Google Drive のリンク共有、Dropbox の共有リンクと同じモデル。

paste_image では ID を `crypto.randomUUID()` のハイフン除去 = 32 hex(122 bit)にした。
Gyazo と同じ形で、追加の実装がいらない。

## 成立条件

capability URL は「推測できない」だけでは足りない。**漏れない**ことも要る。

| 条件 | paste_image での対応 |
|---|---|
| ID が推測不能 | 122 bit の CSPRNG。連番や時刻由来にしない |
| 総当たりできない | 404 連打へのレート制限(WAF ルール)。**Phase 0 では未実施** |
| 検索に載らない | 全公開レスポンスに `X-Robots-Tag: noindex, nofollow` |
| Referer で漏れない | 閲覧ページに `Referrer-Policy: no-referrer` |
| ディレクトリ列挙がない | 一覧 API は認証必須 |

インデックスされた瞬間に capability URL は capability でなくなる。
noindex は飾りではなく、このモデルの構成要素。

## 弱点と、そこから出た判断

**漏れたら取り消せない。** 一度出回った URL を後から無効化する手段がない。

スクリーンショット置き場は、遅かれ早かれ社内画面やトークンの写ったウィンドウを含む。
だから**削除 API を Phase 1 ではなく Phase 0 に入れた**。
capability URL を採用するということは、削除を最初から持つということとセット。

任意 TTL(`expires_at`)は安い保険として検討中。未実装。

## 関連

- [[paste-image]]
- nishio の Cosense に同名ページがある: https://scrapbox.io/nishio/Capability_URL
