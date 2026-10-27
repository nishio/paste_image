# paste_image — 個人用 Gyazo / LLM Wiki 基盤 設計方針

最終更新: 2026-10-27

## 0. 目的と位置づけ

- **最終目標**: LLM が読み書きできる個人 Wiki。
- **最初に作るもの**: ブラウザから paste すると保存され、URL を知っている人が閲覧できる画像置き場。加えて upload API。
- **試作環境**: Cloudflare (Workers + R2 + D1)。

重要な前提: 画像置き場は「LLM Wiki の最初の 1 ブロック種別」であって、画像専用システムとして設計しない。
最初に画像専用のスキーマ・URL 体系を作ると、テキストやリンクを足す段階で ID 体系ごと作り直しになる。

## 1. 基本方針(決定事項)

| # | 方針 | 理由 |
|---|---|---|
| D1 | 公開モデルは **capability URL**(推測不能 ID を知っている人だけが見られる) | 「URL を知ってる人が閲覧できる」という要件そのもの。ACL もログインも作らない |
| D2 | **書き込みは必ず認証、読み出しは無認証** | 書き込みを開けると即座に野良アップローダになる |
| D3 | データモデルは `image` ではなく **`item`**(kind = image / text / link ...) | Wiki への拡張で migration が発生しない |
| D4 | blob は **content-addressed**(key = sha256) | 重複排除が無料で手に入り、immutable キャッシュが正当化される |
| D5 | **閲覧ページ(HTML)と生画像(raw)は別 URL** | OGP 展開・Cosense/Slack 貼り付け・`<img src>` 直参照を同時に満たす |
| D6 | クライアント(paste UI)は薄く、**API が本体** | スクショ自動アップロード・CLI・LLM エージェントが同じ口を使う |
| D7 | **全件エクスポートを Phase 0 から持つ** | 一生使う Wiki にするなら、単一ベンダ上にしか存在しない状態を作らない |
| D8 | Cloudflare 固有 API への依存は薄く保つ | R2 は S3 互換、D1 は SQLite。移植先を常に残す |

## 2. 構成

```
ブラウザ(paste UI) ─┐
CLI / スクショ監視 ─┼─> Workers (単一 Worker, static assets 同梱)
LLM エージェント ───┘          ├─ R2   : blob 本体 (blobs/<sha256>)
                                └─ D1   : items メタデータ + 全文検索
```

- **Pages ではなく Workers + static assets** を使う(新規は Workers 側が標準)。
- **独自ドメイン必須**。`*.workers.dev` は共有ドメインで、ブロックリスト巻き込み・Cookie 境界の問題がある。
  - 例: `w.example.com`(ページ) / `i.example.com`(生画像)。少なくともパスで分ける。

## 3. URL 設計

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/` | 要 | paste UI(貼る・一覧・削除) |
| GET | `/{id}` | 不要 | 閲覧ページ。OGP メタ付き HTML |
| GET | `/i/{id}.{ext}` | 不要 | 生画像。`Cache-Control: immutable` |
| POST | `/api/items` | 要 | アップロード。body = 生バイト列、`Content-Type` で種別判定 |
| GET | `/api/items` | 要 | 一覧(新しい順、cursor ページング) |
| GET | `/api/items/{id}` | 要 | メタデータ JSON |
| PATCH | `/api/items/{id}` | 要 | title / note / tags 更新 |
| DELETE | `/api/items/{id}` | 要 | 削除(論理削除 → 後で GC) |
| GET | `/api/export` | 要 | 全 item の JSONL(D7) |

- **ID**: `crypto.randomUUID()` のハイフンを除いた 32 hex(122 bit)。Gyazo と同じ形で、追加コードゼロ。
- 生画像に拡張子を付けるのは、拡張子を見て判断する貼り付け先(Cosense、各種 Markdown プレビュー)のため。
- `/{id}` は Accept ヘッダで分岐させない。分岐させるとキャッシュが壊れる。

## 4. データモデル(D1)

```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,      -- 32 hex
  kind        TEXT NOT NULL,         -- 'image' | 'text' | 'link'  (D3)
  blob_hash   TEXT,                  -- sha256 hex, R2 key。kind='text' なら NULL
  content_type TEXT,
  bytes       INTEGER,
  width       INTEGER,
  height      INTEGER,
  title       TEXT,
  body        TEXT,                  -- 本文 / メモ。将来の Wiki 本体
  ocr_text    TEXT,                  -- Phase 3: 画像から抽出した文字
  caption     TEXT,                  -- Phase 3: LLM による説明
  source_url  TEXT,                  -- paste 元のページ URL(あれば)
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX items_created ON items(created_at DESC);
CREATE INDEX items_hash    ON items(blob_hash);

-- Phase 3 で有効化。title / body / ocr_text / caption を横断検索
CREATE VIRTUAL TABLE items_fts USING fts5(title, body, ocr_text, caption, content=items);
```

`ocr_text` と `caption` を最初からスキーマに置いておくのは、
「画像が検索できない」のが個人 Gyazo 最大の不満で、そこが LLM Wiki への接続点だから。

## 5. アップロードフロー

1. ブラウザが `paste` イベントで `ClipboardItem` から Blob を取り出す。
2. (任意)canvas で webp に変換。スクショ PNG 3MB → 300KB 程度。原本保持を優先するなら Phase 0 ではやらない。
3. `POST /api/items` に生バイト列を投げる。multipart にしない — ストリームのまま R2 に流せるのと、CLI から `curl --data-binary @foo.png` で叩けるのが効く。
4. Worker 側: `crypto.subtle.digest('SHA-256')` → 既存 hash なら R2 への PUT をスキップ → `items` に 1 行 INSERT → `{id, page_url, raw_url}` を返す。
5. UI は raw_url をクリップボードに自動コピー。**Cosense 貼り付け形式 `[raw_url]` も 1 クリックで出す**(ここが自分用に作る実利)。

実装上の注意:
- Free plan の CPU は **10 ms/request**。sha256 は native なので数 MB でも収まるが、**Worker 内での画像リサイズ・再エンコードはやらない**。やるならクライアント側か、有料プラン($5/月、CPU 30s)か、Cloudflare Images。
- body は `request.body`(ReadableStream)のまま R2 に渡し、メモリに全部載せない。ただし sha256 を取るなら一度読む必要があるので、Phase 0 は `arrayBuffer()` で妥協し、10 MB 程度の上限を付ける。

## 6. 認証

- Phase 0〜1: **Bearer トークン 1 本**。Worker secret に置き、定数時間比較。UI は localStorage に保持。
  - CLI・スクショ監視・LLM エージェントがそのまま使えるのが利点。
- Phase 2 以降で UI だけ **Cloudflare Access**(無料枠 50 ユーザ、Google ログイン)を前に置くと、UI のトークン管理が消える。
- `/i/`・`/{id}` は Access の対象外にする(ここが public でないと要件を満たさない)。

## 7. キャッシュと費用

- `/i/{id}.{ext}` は `Cache-Control: public, max-age=31536000, immutable`。ID は不変なので安全。
- R2 への GET を毎回走らせない。Cache API (`caches.default`) で明示的に包むか、Cache Rules を設定する。これをやらないと Class B 操作が閲覧数そのままに増える。
- 費用感(2026-10 時点の無料枠):
  - R2: 10 GB-月 / Class A 100万 / Class B 1000万、**下り転送無料**
  - Workers: 10万リクエスト/日、CPU 10 ms/リクエスト
  - D1: 5 GB、読み 500万行/日、書き 10万行/日
  - 個人用途なら無料枠に収まる。画像ホスティングで egress 無料は決定的に効く。

## 8. フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | paste → 保存 → URL 閲覧、Bearer 認証、`/api/export` | 自分が毎日使い始められる |
| 1 | upload API の外部利用(CLI / スクショ監視 / ShareX 相当)、削除 | Gyazo を置き換えられる |
| 2 | 一覧 UI、タグ、タイトル、ページ内メモ(`body` を使い始める) | 「Wiki」になり始める |
| 3 | OCR・自動キャプション(Workers AI もしくは外部 LLM API)、FTS5 検索 | 画像が検索できる |
| 4 | `/mcp` エンドポイント、item 間リンク、Cosense 連携 | LLM が読み書きする Wiki |

Phase 0 は週末 1 日で動く規模にする。これが延びる設計なら設計が間違っている。

## 9. 考察: この案の評価

### 妥当だと考える点

1. **スコープの切り方が正しい。** 「paste して保存、URL で閲覧」はユーザ 1 人で価値が閉じている。
   共有・権限・アカウントを作らずに毎日使える状態に到達できる。LLM Wiki という大きな目標に対して、
   最初の一歩が「毎日自分が使うもの」になっているのは、途中で死なない構成。
2. **capability URL は要件に対して適正な選択。** 認証もセッションも作らずに「URL を知ってる人が見られる」が
   実現でき、かつ ID が 122 bit なら総当たりは非現実的。Gyazo / Google Drive リンク共有と同じモデル。
3. **upload API を最初から要件に入れたのが効いている。** Gyazo の本当の価値は「貼る」ことではなく
   「スクショした瞬間に URL になる」こと。ブラウザ paste だけでは Gyazo の代替にならないが、
   API があれば OS 側のスクショ監視スクリプトを後から足して代替に到達できる。
4. **Cloudflare は用途に合っている。** 画像ホストの支配的コストは egress で、R2 はそれが無料。
   Workers・R2・D1 が 1 回の `wrangler deploy` で出るので、個人の試作に対して運用負荷がほぼゼロ。

### 弱い点・先に手を打つべき点

1. **「LLM Wiki」と「個人用 Gyazo」の距離が、この案だとまだ埋まっていない。**
   画像を置いただけでは LLM から使えない(バイナリは検索できない)。
   橋渡しになるのは「画像に対する**テキスト**(OCR・キャプション・自分のメモ)を同じ item に持つこと」で、
   これは Phase 3 でよいが、**スキーマと URL 体系は Phase 0 で先に用意しておく**(D3 / §4)。
   ここを「あとで考える」にすると、画像専用 DB が出来上がって作り直しになる。
2. **バックアップが Phase 0 に必要。** 一生もののノートにするつもりなら、
   R2 の中にしか存在しない状態は許容できない。`/api/export` + `rclone sync r2:bucket ./backup` を最初から置く。
   これは機能追加ではなく、この企画が成立する前提条件。
3. **機密情報が必ず混ざる。** スクショ置き場は、遅かれ早かれ社内画面やトークンの写ったウィンドウを含む。
   capability URL は漏れたら取り消せないので、**削除 API を Phase 1 ではなく Phase 0 に入れる**。
   任意 TTL(`expires_at`)も安い保険として検討に値する。
4. **ID 総当たり・ホットリンクへの備えが薄い。** 読み出しが完全 public なので、
   404 連打に対するレート制限(Cloudflare の WAF ルールで十分)と、`X-Robots-Tag: noindex` を入れておく。
   インデックスされると capability URL が capability でなくなる。
5. **Free plan の CPU 10 ms は画像処理をさせてくれない。** リサイズ・形式変換を Worker でやる前提で
   設計すると詰まる。クライアント側で変換するか、有料プランに上げるかを早めに決める。
6. **モバイルからの paste は実質使えない。** iOS Safari のクリップボード API は貼りづらい。
   ファイル選択・ドラッグ&ドロップ・(Android なら)PWA の share_target を併設する前提で UI を作る。

### 保留してよい点(いま決めなくてよい)

- 画像の圧縮戦略(原本保持 vs webp 変換)。まず原本を保存し、容量が問題になってから考える。
- Cloudflare Images を使うか。Phase 0 では不要。
- 複数ユーザ・共有設定。個人用と言い切っているうちは作らない。
- ID の短縮。32 hex は長いが、手打ちする URL ではないので実害がない。

### 結論

**この案で進めてよい。** 変更を推奨するのは 2 点だけ:

- データモデルを `image` ではなく **`item`** にし、`body` / `ocr_text` / `caption` を最初からスキーマに置く(LLM Wiki への接続点を塞がないため)。
- **削除 API と全件エクスポートを Phase 0 に含める**(機密混入と単一ベンダ依存は、後から直すのが高くつくため)。

## 10. 未決事項

- [ ] ドメインを何にするか(ページと生画像を別ホストにするか、パス分割で済ませるか)
- [ ] 原本保持か webp 変換か
- [ ] Phase 3 の OCR / キャプションを Workers AI でやるか外部 LLM API でやるか
- [ ] Cosense との連携方式(URL を貼るだけか、API 連携まで行くか)
