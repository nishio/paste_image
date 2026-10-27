/**
 * paste_image — 個人用 Gyazo / LLM Wiki 基盤 (Phase 0)
 * 方針は DESIGN.md を参照。
 *
 *   GET    /            paste UI (static asset)
 *   GET    /{id}        閲覧ページ (public, OGP 付き)
 *   GET    /i/{id}.ext  生画像 (public, immutable)
 *   POST   /api/items   アップロード (要認証, body = 生バイト列)
 *   GET    /api/items   一覧 (要認証)
 *   GET    /api/items/{id}    メタデータ (要認証)
 *   PATCH  /api/items/{id}    title / body / source_url 更新 (要認証)
 *   DELETE /api/items/{id}    削除 (要認証)
 *   GET    /api/export  全件 JSONL (要認証)
 */

const MAX_BYTES = 10 * 1024 * 1024;

// SVG は同一オリジンでスクリプトを実行できるため Phase 0 では受け付けない (DESIGN.md §9)
const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/items') {
        if (request.method === 'POST') return guard(request, env, () => upload(request, env, url));
        if (request.method === 'GET') return guard(request, env, () => list(env, url));
        return err(405, 'method_not_allowed');
      }

      if (path === '/api/export') {
        if (request.method !== 'GET') return err(405, 'method_not_allowed');
        return guard(request, env, () => exportAll(env));
      }

      const apiItem = /^\/api\/items\/([0-9a-f]{32})$/.exec(path);
      if (apiItem) {
        const id = apiItem[1];
        if (request.method === 'GET') return guard(request, env, () => getItem(env, id));
        if (request.method === 'PATCH') return guard(request, env, () => patchItem(request, env, id));
        if (request.method === 'DELETE') return guard(request, env, () => deleteItem(env, id));
        return err(405, 'method_not_allowed');
      }

      const raw = /^\/i\/([0-9a-f]{32})(?:\.[a-z0-9]+)?$/.exec(path);
      if (raw) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method_not_allowed');
        return serveRaw(request, env, ctx, raw[1]);
      }

      const page = /^\/([0-9a-f]{32})$/.exec(path);
      if (page) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method_not_allowed');
        return servePage(env, url, page[1]);
      }

      return err(404, 'not_found');
    } catch (e) {
      console.error(e);
      return err(500, 'internal_error', String(e && e.message ? e.message : e));
    }
  },
};

/* ---------------------------------------------------------------- auth */

/** Bearer トークン 1 本。比較は sha256 したうえで定数時間で行う (DESIGN.md §6)。 */
async function guard(request, env, fn) {
  const expected = env.UPLOAD_TOKEN;
  if (!expected) return err(500, 'token_not_configured', 'UPLOAD_TOKEN secret が未設定です');

  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  const given = m ? m[1].trim() : '';
  if (!given || !(await secretEquals(given, expected))) {
    return err(401, 'unauthorized', null, { 'WWW-Authenticate': 'Bearer' });
  }
  return fn();
}

async function secretEquals(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

/* -------------------------------------------------------------- upload */

async function upload(request, env, url) {
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT_BY_TYPE[contentType]) {
    return err(415, 'unsupported_media_type', `対応形式: ${Object.keys(EXT_BY_TYPE).join(', ')}`);
  }

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return err(413, 'too_large', `上限 ${MAX_BYTES} bytes`);

  // Phase 0 は sha256 を取るために一度メモリに載せる (DESIGN.md §5)
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength === 0) return err(400, 'empty_body');
  if (buf.byteLength > MAX_BYTES) return err(413, 'too_large', `上限 ${MAX_BYTES} bytes`);

  const hash = await sha256hex(buf);
  const key = `blobs/${hash}`;

  // content-addressed なので、同じ内容なら PUT を省ける (DESIGN.md D4)
  const existing = await env.BLOBS.head(key);
  if (!existing) {
    await env.BLOBS.put(key, buf, { httpMetadata: { contentType } });
  }

  const size = imageSize(buf, contentType) || {};
  const id = newId();
  const now = Date.now();
  const title = trimOrNull(url.searchParams.get('title'));
  const sourceUrl = trimOrNull(url.searchParams.get('source') || request.headers.get('X-Source-Url'));

  await env.DB.prepare(
    `INSERT INTO items (id, kind, blob_hash, content_type, bytes, width, height, title, source_url, created_at)
     VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, hash, contentType, buf.byteLength, size.width ?? null, size.height ?? null, title, sourceUrl, now)
    .run();

  return json(
    {
      ...publicItem({
        id,
        kind: 'image',
        content_type: contentType,
        bytes: buf.byteLength,
        width: size.width ?? null,
        height: size.height ?? null,
        title,
        source_url: sourceUrl,
        created_at: now,
      }, url.origin),
      deduped: Boolean(existing),
    },
    201
  );
}

/* ---------------------------------------------------------------- read */

async function list(env, url) {
  const limit = clamp(Number(url.searchParams.get('limit') || 50), 1, 200);
  const before = Number(url.searchParams.get('before') || 0);

  const sql = before
    ? `SELECT * FROM items WHERE deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`;
  const stmt = before ? env.DB.prepare(sql).bind(before, limit) : env.DB.prepare(sql).bind(limit);

  const { results } = await stmt.all();
  const items = results.map((r) => publicItem(r, url.origin));
  const next = results.length === limit ? results[results.length - 1].created_at : null;
  return json({ items, next_before: next });
}

async function getItem(env, id) {
  const row = await live(env, id);
  if (!row) return err(404, 'not_found');
  return json(publicItem(row, null));
}

async function patchItem(request, env, id) {
  const row = await live(env, id);
  if (!row) return err(404, 'not_found');

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid_json');
  }

  const fields = ['title', 'body', 'source_url'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (f in body) {
      sets.push(`${f} = ?`);
      vals.push(trimOrNull(body[f]));
    }
  }
  if (!sets.length) return err(400, 'nothing_to_update', `更新できるのは ${fields.join(', ')}`);

  vals.push(id);
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return getItem(env, id);
}

/** 論理削除。同じ blob を参照する item が無くなったら R2 からも消す。 */
async function deleteItem(env, id) {
  const row = await live(env, id);
  if (!row) return err(404, 'not_found');

  await env.DB.prepare(`UPDATE items SET deleted_at = ? WHERE id = ?`).bind(Date.now(), id).run();

  if (row.blob_hash) {
    const still = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items WHERE blob_hash = ? AND deleted_at IS NULL`
    ).bind(row.blob_hash).first();
    if (!still || still.n === 0) await env.BLOBS.delete(`blobs/${row.blob_hash}`);
  }

  return json({ id, deleted: true });
}

/** 全件 JSONL。単一ベンダ上にしか存在しない状態を作らないための口 (DESIGN.md D7)。 */
function exportAll(env) {
  const enc = new TextEncoder();
  let cursor = 0;
  let done = false;

  const stream = new ReadableStream({
    async pull(controller) {
      if (done) return controller.close();
      const { results } = await env.DB.prepare(
        `SELECT rowid AS _rowid, * FROM items WHERE rowid > ? ORDER BY rowid LIMIT 500`
      ).bind(cursor).all();

      if (!results.length) {
        done = true;
        return controller.close();
      }
      cursor = results[results.length - 1]._rowid;
      let chunk = '';
      for (const r of results) {
        delete r._rowid;
        chunk += JSON.stringify(r) + '\n';
      }
      controller.enqueue(enc.encode(chunk));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="paste_image-export-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------- serving */

async function serveRaw(request, env, ctx, id) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const row = await live(env, id);
  if (!row || !row.blob_hash) return err(404, 'not_found');

  const etag = `"${row.blob_hash}"`;
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: rawHeaders(row, etag) });
  }

  const obj = await env.BLOBS.get(`blobs/${row.blob_hash}`);
  if (!obj) return err(404, 'blob_missing');

  const res = new Response(obj.body, { headers: rawHeaders(row, etag) });
  // R2 への GET を閲覧数ぶん走らせない (DESIGN.md §7)
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

function rawHeaders(row, etag) {
  const ext = EXT_BY_TYPE[row.content_type] || 'bin';
  return {
    'Content-Type': row.content_type || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${row.id}.${ext}"`,
    // ID は不変なので永続キャッシュしてよい
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Robots-Tag': 'noindex, nofollow',
    'Access-Control-Allow-Origin': '*',
  };
}

async function servePage(env, url, id) {
  const row = await live(env, id);
  if (!row) return err(404, 'not_found');

  const rawUrl = rawUrlOf(row, url.origin);
  const title = row.title || `${row.id.slice(0, 8)} — paste_image`;
  const h = esc;

  const body = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${h(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${h(title)}">
<meta property="og:image" content="${h(rawUrl)}">
${row.width ? `<meta property="og:image:width" content="${row.width}">` : ''}
${row.height ? `<meta property="og:image:height" content="${row.height}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${h(rawUrl)}">
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#667; --line:#e3e3e8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14151a; --fg:#e8e8ec; --muted:#9a9aa8; --line:#2a2b33; } }
  html,body { margin:0; background:var(--bg); color:var(--fg); }
  body { font:14px/1.6 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
         min-height:100vh; display:flex; flex-direction:column; }
  main { flex:1; display:grid; place-items:center; padding:16px; }
  img { max-width:100%; max-height:88vh; height:auto; display:block;
        border-radius:6px; box-shadow:0 1px 12px rgba(0,0,0,.18); }
  footer { border-top:1px solid var(--line); padding:10px 16px; color:var(--muted);
           display:flex; gap:12px; flex-wrap:wrap; font-size:12px; }
  a { color:inherit; }
</style>
<main><a href="${h(rawUrl)}"><img src="${h(rawUrl)}" alt="${h(row.title || '')}"></a></main>
<footer>
  <span>${new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
  <span>${row.width && row.height ? `${row.width}×${row.height}` : ''}</span>
  <span>${fmtBytes(row.bytes)}</span>
  ${row.source_url ? `<a href="${h(row.source_url)}" rel="noreferrer nofollow">source</a>` : ''}
  <a href="${h(rawUrl)}">raw</a>
</footer>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/* --------------------------------------------------------------- utils */

function live(env, id) {
  return env.DB.prepare(`SELECT * FROM items WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
}

function publicItem(row, origin) {
  return {
    id: row.id,
    kind: row.kind,
    content_type: row.content_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    title: row.title ?? null,
    body: row.body ?? null,
    source_url: row.source_url ?? null,
    created_at: row.created_at,
    page_url: origin ? `${origin}/${row.id}` : `/${row.id}`,
    raw_url: rawUrlOf(row, origin),
  };
}

function rawUrlOf(row, origin) {
  const ext = EXT_BY_TYPE[row.content_type] || 'bin';
  return `${origin || ''}/i/${row.id}.${ext}`;
}

function newId() {
  return crypto.randomUUID().replaceAll('-', '');
}

async function sha256hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function err(status, code, detail = null, extra = {}) {
  return new Response(JSON.stringify({ error: code, detail }, null, 2) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function trimOrNull(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, 2000);
}

function clamp(n, lo, hi) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;
}

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * ヘッダだけ見て寸法を取る。OGP に width/height を入れるため、
 * また curl から叩くクライアントは寸法を送ってくれないため。
 */
function imageSize(b, type) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === 'image/png' && b.byteLength > 24) {
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (type === 'image/gif' && b.byteLength > 10) {
      return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }
    if (type === 'image/jpeg') {
      let o = 2;
      while (o + 9 < b.byteLength) {
        if (b[o] !== 0xff) break;
        const marker = b[o + 1];
        const len = dv.getUint16(o + 2);
        // SOF0..SOF15 のうち DHT(C4) / JPG(C8) / DAC(CC) を除く
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5) };
        }
        o += 2 + len;
      }
      return null;
    }
    if (type === 'image/webp' && b.byteLength > 30) {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === 'VP8X') {
        const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
        const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
        return { width: w, height: h };
      }
      if (chunk === 'VP8 ') {
        return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* 壊れたヘッダは寸法不明として扱う */
  }
  return null;
}
