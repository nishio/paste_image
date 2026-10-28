# Cloudflare Workers の制約

paste_image を載せる実行環境の、設計を曲げる側の性質。2026-10 時点。

## 無料枠

| | 無料枠 |
|---|---|
| Workers | 10万リクエスト/日、**CPU 10 ms/リクエスト**、subrequest 50/リクエスト |
| R2 | 10 GB-月、Class A(書き/list) 100万、Class B(読み) 1000万、**下り転送無料** |
| D1 | 5 GB、読み 500万行/日、書き 10万行/日 |

出典: [R2 Pricing](https://developers.cloudflare.com/r2/pricing/) /
[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) /
[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

画像ホストの支配的コストは egress で、R2 はそこが無料。この一点でプラットフォームが決まった。

## CPU 10 ms が設計を決める

無料プランでは **Worker 内で画像のリサイズ・再エンコードができない**。
sha256 は native 実装なので数 MB でも収まるが、デコードを伴う処理は収まらない。

選べるのは 3 つ。

1. クライアント側で変換する(canvas → webp。スクショ PNG 3MB → 300KB 程度)
2. 有料プラン($5/月、CPU 30 s)に上げる
3. Cloudflare Images に投げる

Phase 0 は**どれもやらず原本を保存**した。原本には証拠性があり、容量が問題になってから決めればいい。
決めていないという状態を自覚しておくためにここに書く。

デコードを伴わない処理なら収まる。画像の寸法は
[[image-header-dimensions]] のようにヘッダだけ読めば取れる。

## R2 への GET はキャッシュしないと閲覧数ぶん走る

Worker から R2 binding を叩いても自動ではキャッシュされない。
`caches.default` で明示的に包むか、Cache Rules を設定する必要がある。
これを忘れると Class B 操作が閲覧数そのままに増える。

paste_image は `/i/{id}.{ext}` を Cache API で包み、`ctx.waitUntil(cache.put(...))` で裏に回している。

## 静的アセット

`wrangler.jsonc` の `assets.directory` を指定すると、
**アセットが存在するパスは Worker を起動せずに配信され、無いパスだけ Worker に落ちる**。
`/` は `public/index.html`、`/{32hex}` は Worker、と自然に分かれる。
Pages ではなく Workers + static assets を使う(新規はこちらが標準)。

## 独自ドメインは必須

`*.workers.dev` は共有ドメインなので、

- 他人の Worker が理由でブロックリストに載る巻き添えを食う
- Cookie やストレージの境界を他の Worker と共有する

paste_image は UI が localStorage にアップロードトークンを置くので、後者が実害になる。

## wrangler dev で踏んだこと

- **ポート衝突に気づきにくい。** 既に別のサーバが 8787 にいると
  `Address already in use` は出るが、curl は**そのサーバ**に通る。
  テストが全部 404 を返して実装を疑うことになった。先に何が listen しているか見る
- **`ENOSPC: System limit for number of file watchers reached`** が出ても dev server 自体は起動する。
  ホットリロードが効かなくなるだけ
- ローカルの D1 は `database_id` がプレースホルダ文字列のままでも動く。
  `wrangler d1 migrations apply <name> --local` → `wrangler dev` で完結する

## 関連

- [[paste-image]]
- [[content-addressed-storage]]
