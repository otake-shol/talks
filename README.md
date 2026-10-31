# talks

竹内 尊紀（おたけ）の登壇資料。GitHub Pages で公開している。

- 一覧: https://otake-shol.github.io/talks/
- スライドの原稿（Marp）は非公開の slides リポジトリで管理し、公開版の HTML だけをここに置く

## 発表中のページを聴衆のスマホへ同期

公開版の HTML には、発表者のページ位置を聴衆へ同期する機能（[tools/live-sync](tools/live-sync/README.md)）が入っている。
聴衆は QR コードを読むだけで、発表中のページへ自動で追従する。
聴衆の画面では、ページに出てくる専門用語に点線の下線が付き、タップすると解説が出る（用語集がある資料のみ）。

## 公開の手順

```bash
scripts/publish.sh <slug>   # slides リポジトリの slides/<slug>/deck.md から <slug>/ を作る
npm run verify              # テスト
```

- `slides/<slug>/public.sed`（非公開側）があれば、公開前にその置換をかける
- `slides/<slug>/glossary.md`（非公開側）があれば、用語解説を付ける。書式は「`## 用語 | 別名`」の下に解説
- 発表者ノートは公開版から除く。参照している画像だけをコピーする
- 発表者用のノート付き版 `<slug>/presenter.local.html` も作る（コミットしない）
- 新しいデッキを足したら `index.html` の一覧にも追加する

## 当日の操作

1. 発表者は `<slug>/presenter.local.html?live=present` をブラウザで開く（`p` で Marp の発表者ビュー）
2. `q` で聴衆向けの QR コードを全画面表示する（スクリーンに映っているウィンドウで押す）
3. 聴衆は QR から公開版を開くだけ
