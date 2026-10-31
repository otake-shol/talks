#!/bin/bash
# 非公開の slides リポジトリのデッキから、公開用 HTML（ページ同期つき）を talks/<slug>/ に作る。
#
# 使い方: scripts/publish.sh <slug>
#   <slug> は slides リポジトリの slides/<slug>/deck.md のフォルダ名
#
# - slides/<slug>/public.sed があれば、公開前にその置換をかける（消したい記述は非公開側に置く）
# - 発表者ノートは除く。参照している画像だけをコピーする
# - 発表者用にノート付きの <slug>/presenter.local.html も作る（.gitignore 済み・公開しない）
set -euo pipefail

main() {
  local slug="${1:?使い方: scripts/publish.sh <slug>}"
  local root slides_repo deck_dir url tmp_md tmp_html
  root="$(cd "$(dirname "$0")/.." && pwd)"
  slides_repo="${SLIDES_REPO:-$HOME/01_development/slides/repository}"
  deck_dir="$slides_repo/slides/$slug"
  url="https://otake-shol.github.io/talks/$slug/"

  [[ -f "$deck_dir/deck.md" ]] || { echo "見つかりません: $deck_dir/deck.md" >&2; exit 1; }

  # 画像の相対パスを保つため、一時ファイルはデッキと同じフォルダに置く
  tmp_md="$deck_dir/.talks-public.tmp.md"
  tmp_html="$deck_dir/.talks-public.tmp.html"
  # shellcheck disable=SC2064 # 関数を抜けると local 変数が消えるので、パスはここで展開しておく
  trap "rm -f '$tmp_md' '$tmp_html'" EXIT

  if [[ -f "$deck_dir/public.sed" ]]; then
    sed -f "$deck_dir/public.sed" "$deck_dir/deck.md" >"$tmp_md"
  else
    cp "$deck_dir/deck.md" "$tmp_md"
  fi

  npx --yes @marp-team/marp-cli@4 --no-stdin --theme-set "$slides_repo/themes" --html --allow-local-files \
    "$tmp_md" -o "$tmp_html"

  rm -rf "${root:?}/$slug"
  node "$root/tools/live-sync/inject.mjs" "$tmp_html" --url "$url" --out "$root/$slug/index.html" \
    --strip-notes --copy-assets

  # 発表者用（ノート付き・ローカル専用）。トピックは公開版と同じなので聴衆と同期する
  cp "$deck_dir/deck.md" "$tmp_md"
  npx --yes @marp-team/marp-cli@4 --no-stdin --theme-set "$slides_repo/themes" --html --allow-local-files \
    "$tmp_md" -o "$tmp_html"
  node "$root/tools/live-sync/inject.mjs" "$tmp_html" --url "$url" --out "$root/$slug/presenter.local.html" \
    >/dev/null

  echo
  echo "公開版:   $root/$slug/index.html（${url}）"
  echo "発表者用: $root/$slug/presenter.local.html?live=present（ノート付き。ブラウザで直接開く）"
}

main "$@"
