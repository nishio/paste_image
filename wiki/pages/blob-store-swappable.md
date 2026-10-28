# blob ストアは差し替えられる

画像の本体をどこに置くかは、20行程度で差し替えられる。何に依存していないかの話。

## 依存しているのは4つの操作だけ

コードが blob ストアに対してやっているのは、key を決めて次の4つを呼ぶことだけ。

```js
await env.BLOBS.head(key)          // 既にあるか (重複排除の判定)
await env.BLOBS.put(key, bytes)    // 置く
await env.BLOBS.get(key)           // 読む (body は ReadableStream)
await env.BLOBS.delete(key)        // 消す (参照が0になった時)
```

バケットもプレフィックスも list もソートも使っていない。
**key は [[content-addressed-storage]] で sha256 に決まっている**ので、
ストア側に ID を採番してもらう必要もない。

`contentType` は R2 の `httpMetadata` に渡してはいるが、**依存はしていない**。
配信時に使う `content_type` は D1 の `items` が持っているので、
メタデータを持てないストアに移しても困らない。
([[item-not-image]] でメタデータを全部 D1 に寄せた副次効果)

これは設計方針 D8「Cloudflare 固有 API への依存を薄く保つ」の具体形。
抽象レイヤを書いたのではなく、**使う機能を減らした**結果そうなっている。

## 候補の比較

| | R2 | Workers KV | S3 / 互換 |
|---|---|---|---|
| 無料枠の容量 | 10 GB-月 | **1 GB** | — |
| 1値の上限 | 実質なし | **25 MiB** | — |
| 書き込み | Class A 100万/月 | **1,000/日** | — |
| 読み出し | Class B 1000万/月 | 10万/日 | — |
| 下り転送 | **無料** | 無料 | **有料(ここが効く)** |
| 支払い方法の登録 | **要る**([[deploy]]) | 不要 | 要る |
| 超過した時 | **課金される** | **その操作が失敗する** | 課金される |
| 整合性 | 強い | 結果整合性(最大60秒) | 強い |

出典: [KV limits](https://developers.cloudflare.com/kv/platform/limits/) /
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) /
[R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## KV の結果整合性は、ここでは無害

KV は書き込みが全世界に伝播するまで最大60秒かかる。普通はこれが採用を止める理由になる。

paste_image では問題にならない。**key が内容の hash なので、key の中身が変わることが原理的にない**。
起こりうるのは「上げた直後に別リージョンからまだ読めない」だけで、
「古い中身が読める」は起こらない。しかも上げた直後に読むのは上げた本人で、同じ場所にいる。

content-addressed にしたことが、ここでも効いている。

## どちらを選ぶか

- **長く使うなら R2。** 1 GB はスクリーンショット置き場としては小さい。
  10 GB でも数年で埋まる可能性があり、容量が本命の軸
- **まず動かすだけなら KV。** 支払い方法の登録を保留できる。
  書き込み 1,000/日 は個人用途には十分で、
  超過しても課金されず**その操作が失敗するだけ**なのは、試作中はむしろ安心材料

Phase 0 の時点では R2 を前提に実装してある。KV に移す必要が出たら、
`upload` / `serveRaw` / `deleteItem` の3箇所を触る。

## 関連

- [[content-addressed-storage]]
- [[deploy]]
- [[cloudflare-workers-constraints]]
