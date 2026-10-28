# SVG を受け付けない理由

アップロードを受ける画像形式から SVG を外した判断。

## 理由

SVG は `<script>` を持てる**実行可能なドキュメント**であり、画像ではない。
同一オリジンから配信すると、そのオリジンの DOM とストレージに触れる。

paste_image の UI は `/` で動き、**アップロードトークンを localStorage に置いている**。
同じオリジンの `/i/{id}.svg` を踏ませれば、そのトークンを読んで外部に送れる。
capability URL は「見られる」だけのつもりだったのに、「書ける」に昇格してしまう。

つまりこれは SVG 一般の話ではなく、**書き込みトークンを持つ UI と同一オリジンで
ユーザ提供コンテンツを配信している**という構成の話。

## 対応

- 受け付ける形式を png / jpeg / gif / webp / avif に限定(`Content-Type` で判定、415 を返す)
- raw 配信に `X-Content-Type-Options: nosniff` — 宣言した型以外に解釈させない
- raw 配信に `Content-Security-Policy: default-src 'none'; sandbox` — 万一通っても実行させない

形式の制限だけに頼らず、ヘッダ側でも塞いでおく(宣言された型を信じている部分が残るため)。

## 将来 SVG を入れたくなったら

- 生画像を**別オリジン**(`i.example.com`)から配信する。これが本筋
- または UI のトークンを localStorage から Cloudflare Access に移し、
  同一オリジンに盗める秘密を置かない

どちらも Phase 0 の範囲外。入れる時はこのページを読み直すこと。

## 関連

- [[capability-url]]
- [[cloudflare-workers-constraints]]
