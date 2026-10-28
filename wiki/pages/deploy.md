# デプロイに何が必要か

`wrangler deploy` が何をする操作で、なぜ資格情報が要るのか。2026-10-28 時点。

## デプロイは4つのリソースを作る操作

`wrangler deploy` 一発で終わるわけではなく、Cloudflare アカウント上に4つの状態を作る。

| # | 作るもの | コマンド |
|---|---|---|
| 1 | R2 バケット(画像の本体を置く) | `wrangler r2 bucket create paste-image` |
| 2 | D1 データベース(items テーブル) | `wrangler d1 create paste-image` → 出た id を `wrangler.jsonc` に書く |
| 3 | スキーマ | `wrangler d1 migrations apply paste-image --remote` |
| 4 | secret(`UPLOAD_TOKEN`) | `wrangler secret put UPLOAD_TOKEN` |
| 5 | Worker 本体 + 静的アセット | `wrangler deploy` |

**どれもアカウントの状態を変える。** だから認証が要る。
`wrangler dev` と `wrangler deploy --dry-run` が認証なしで動くのは、
前者がローカルのエミュレータ(miniflare)で完結し、後者がバンドルを作るだけで API を叩かないから。
wrangler はビルドツールの顔をしているが、deploy 以降は **Cloudflare API のクライアント**。

## 認証の2つの経路

### `wrangler login`(OAuth)

ブラウザが開き、認可後に **`localhost:8976` へコールバックが返る**。
手元のマシンなら一番簡単だが、**SSH 越しの作業機では成立しない**
(ブラウザ側から作業機の 8976 に到達できないため、ポートフォワードが要る)。

OAuth フローは細かい権限指定(granular permissions)に対応しておらず、権限を絞れない。

### `CLOUDFLARE_API_TOKEN` 環境変数

dash.cloudflare.com → My Profile → API Tokens で作り、環境変数で渡す。
headless な環境ではこちら。権限を絞れるのが利点。

## どの権限が何のために要るか

| 操作 | 必要な権限 | なぜ |
|---|---|---|
| Worker を**新規作成**する | Workers 製品スコープの **Admin** | 既存 Worker の更新だけなら Editor で足りる。初回は「作る」ので Admin |
| R2 バケットを作る | Workers R2 Storage: Edit | |
| D1 を作る / migration を流す | D1: Edit | |
| secret を置く | Workers 製品スコープの Editor | |
| 独自ドメインの routes を触る | 対象 zone の Workers Routes: Write | **workers.dev だけなら不要** |

重要な誤解しやすい点:
**バインディングがあるだけなら R2 / D1 の権限は要らない。**
Worker が R2 や D1 を bind していても、デプロイするだけなら Workers 権限で足りる。
今回それらが要るのは、**バケットと DB を作り、migration を流す**から
(= リソースへの直接アクセス)。
2回目以降の「コードを直して deploy するだけ」なら Workers 権限だけで回る。

出典: [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)

## R2 には支払い方法の登録が要る

**無料枠の範囲で使うつもりでも、R2 の有効化には支払い方法の登録が要る。**
理由は、R2 の使用量に上限キャップが無く、無料枠を超えた分は課金されるから
(+ 不正防止 / KYC)。ここが最初の関門になる。

- 手順: Storage & databases → R2 → Overview でサブスクリプションを追加する
- 使用量は自動では止まらない。無料枠は「超えたら止まる」ではなく「超えた分が請求される」
- 使用量ベースのサービスなので、カードへの事前承認(与信)が走ることがある。
  カードが失効すると**バケットにアクセスできなくなる**

出典: [R2 Get started](https://developers.cloudflare.com/r2/get-started/) /
[Billing policy](https://developers.cloudflare.com/billing/understand/billing-policy/)

無料枠の数値は [[cloudflare-workers-constraints]]。

## secret はどこに行くか

`wrangler secret put UPLOAD_TOKEN` で渡した値は Cloudflare 側に暗号化して保存され、
**wrangler からは読み出せない**(上書きと削除だけできる)。手元に控えておく必要がある。

ローカル開発用の `.dev.vars` は別物で、Cloudflare には送られない。`.gitignore` 済み。

## やり直せること / やり直せないこと

| | |
|---|---|
| `r2 bucket create` / `d1 create` | 同名で2回目はエラー。作られたものは残るので、状態を確認してから進む |
| `d1 migrations apply` | 適用済みの migration は飛ばす。何度流してもよい |
| `deploy` | 上書き。前のバージョンへロールバックできる |
| **公開された URL** | **取り消せない。** 一度出回った [[capability-url]] は無効化できない |
| **R2 に上がった画像** | 消せるが、既に見られた分は取り返せない |

コードは何度でもやり直せる。やり直せないのは**外に出た URL と画像**の方で、
だから削除 API を Phase 0 に入れてある。

## 最初のデプロイ先

Phase 0 は **workers.dev で動かす**と決めた(2026-10-28)。
`paste-image.<subdomain>.workers.dev` に出る。独自ドメインは後。

ただし workers.dev は共有ドメインで、
UI が localStorage にアップロードトークンを置く構成とは本来相性が悪い
([[cloudflare-workers-constraints]] の「独自ドメインは必須」、[[svg-upload-risk]])。
**試作の間だけの割り切り**であることを忘れないこと。
常用に移す前に独自ドメインへ移すか、トークンを localStorage から外す。

## 関連

- [[paste-image]]
- [[cloudflare-workers-constraints]]
- [[capability-url]]
