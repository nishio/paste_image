# 画像の寸法をヘッダから読む

デコードせずに width / height を得る。Worker の CPU 10 ms 制約下で寸法が要る時の手段。

## なぜ必要か

- OGP に `og:image:width` / `og:image:height` を入れたい(Slack 等の展開が安定する)
- UI 側で測って送ることもできるが、**curl から叩くクライアントは送ってこない**。
  API を本体にする以上、サーバ側で取れないと欠測になる

デコードは CPU を食うが、**寸法はどの形式も先頭数十バイトに書いてある**。

## 各形式の位置

| 形式 | 位置 |
|---|---|
| PNG | IHDR 固定。offset 16 から u32be で width、20 から height |
| GIF | offset 6 から u16**le** で width、8 から height |
| JPEG | セグメントを辿る。SOF0〜SOF15(`0xFFC0`〜`0xFFCF`、ただし `C4`(DHT) / `C8` / `CC`(DAC) を除く)を見つけ、**height が先**(offset+5)、width が後(offset+7) |
| WebP | offset 12 の 4 バイトで分岐。`VP8X` は offset 24/27 から u24le で (値+1)、`VP8 ` は 26/28 から u16le を `& 0x3fff`、`VP8L` は 21 からの u32le をビット分解して 14 bit ずつ |

踏みやすい点:

- GIF と WebP は **little endian**、PNG と JPEG は big endian
- **JPEG だけ height が先**。逆に書いても正方形の画像では気づけない
- JPEG の SOF 判定で `0xC4` を除外し忘れると、ハフマンテーブルを寸法として読む

## 実装方針

- `DataView` で読み、壊れたヘッダは try/catch で握って **null(寸法不明)として扱う**。
  寸法が取れないことはアップロードの失敗ではない
- AVIF は未対応。ISOBMFF のボックスを辿る必要があり、割に合わないと判断した。
  受け付けはするが寸法は NULL になる

実装は `src/index.js` の `imageSize()`。
PNG(120×80)と最小 JPEG(64×48)で検証済み。

## 関連

- [[cloudflare-workers-constraints]]
- [[paste-image]]
