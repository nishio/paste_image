#!/usr/bin/env bash
# wiki の機械的 Lint。README.md の「Lint」の機械的な部分を実行する。
#   - 壊れた [[リンク]]  (バッククォート内の例示は除外)
#   - index.md に未登録のページ
#   - どこからもリンクされていないページ
set -u
cd "$(dirname "$0")"
status=0

links_in() { sed 's/`[^`]*`//g' "$1" | grep -o '\[\[[^]]*\]\]' | sed 's/\[\[\(.*\)\]\]/\1/' | sort -u; }

echo "== broken links =="
for f in *.md pages/*.md; do
  for n in $(links_in "$f"); do
    if [ ! -f "pages/$n.md" ] && [ ! -f "$n.md" ]; then echo "  $f -> [[$n]]"; status=1; fi
  done
done

echo "== not in index.md =="
for f in pages/*.md; do
  if ! grep -q "$(basename "$f")" index.md; then echo "  $f"; status=1; fi
done

echo "== orphan pages (nothing links here) =="
for f in pages/*.md; do
  n=$(basename "$f" .md)
  if ! grep -rl -- "\[\[$n\]\]" *.md pages/*.md 2>/dev/null | grep -qv "^$f$"; then
    echo "  $f"; status=1
  fi
done

if [ $status -eq 0 ]; then echo "ok"; else echo "(上記を直すか、意図的なら README.md の方針を更新する)"; fi
exit $status
