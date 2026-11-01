import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fontLinks,
  injectBeforeBodyEnd,
  injectBeforeHeadEnd,
  listLocalAssets,
  parseGlossary,
  stripNotes,
  topicFromUrl,
} from "./inject.mjs";

test("topicFromUrl: 同じURLなら同じトピック、違うURLなら別のトピック", () => {
  const a = topicFromUrl("https://example.com/a/");
  assert.equal(a, topicFromUrl("https://example.com/a/"));
  assert.notEqual(a, topicFromUrl("https://example.com/b/"));
  assert.match(a, /^otakeya-slides-[0-9a-f]{20}$/);
});

test("injectBeforeBodyEnd: </body> の直前に差し込む", () => {
  const html = injectBeforeBodyEnd("<html><body><p>x</p></body></html>", "<script>1</script>");
  assert.equal(
    html,
    "<html><body><p>x</p><!-- live-sync:start --><script>1</script><!-- live-sync:end --></body></html>",
  );
});

test("injectBeforeBodyEnd: 2回目は前回の差し込みを置き換える", () => {
  const once = injectBeforeBodyEnd("<body></body>", "<script>old</script>");
  const twice = injectBeforeBodyEnd(once, "<script>new$&</script>");
  assert.equal(twice, "<body><!-- live-sync:start --><script>new$&</script><!-- live-sync:end --></body>");
});

test("injectBeforeBodyEnd: </body> が無いHTMLはエラー", () => {
  assert.throws(() => injectBeforeBodyEnd("<p>no body</p>", "x"), /<\/body>/);
});

test("stripNotes: 発表者ノートだけを除き、スライド本体は残す", () => {
  const html =
    '<section>本文</section><div class="bespoke-marp-note" data-index="0" tabindex="0"><p>秘密A</p><ul><li>秘密B</li></ul></div>' +
    '<section>本文2</section><div class="bespoke-marp-note" data-index="1" tabindex="0"><p>秘密C</p></div>';
  const out = stripNotes(html);
  assert.equal(out, "<section>本文</section><section>本文2</section>");
});

test("listLocalAssets: 相対パスの画像だけを重複なしで返す", () => {
  const html =
    '<img src="assets/a.png"><img src="assets/a.png"><img src="assets/b%20c.png?v=1">' +
    '<a href="https://example.com"></a><a href="#3"></a><img src="data:image/png;base64,xx"><img src="/abs.png">';
  assert.deepEqual(listLocalAssets(html), ["assets/a.png", "assets/b c.png"]);
});

test("parseGlossary: 見出しを用語と別名、次の見出しまでを解説として読む", () => {
  const md = "# 用語集\n\nメモ\n\n## effort | エフォート\nどれだけ考えるか\nを決める設定。\n\n## CLI\n文字で操作する画面。\n";
  assert.deepEqual(parseGlossary(md), [
    { term: "effort", aliases: ["エフォート"], desc: "どれだけ考えるかを決める設定。" },
    { term: "CLI", aliases: [], desc: "文字で操作する画面。" },
  ]);
});

test("parseGlossary: 解説のない用語はエラー", () => {
  assert.throws(() => parseGlossary("## effort\n\n## CLI\n説明"), /effort/);
});

test("injectBeforeHeadEnd: </head> の直前に差し込み、2回目は置き換える", () => {
  const once = injectBeforeHeadEnd("<head><title>t</title></head><body></body>", "<link a>");
  assert.equal(once, "<head><title>t</title><!-- live-sync-head:start --><link a><!-- live-sync-head:end --></head><body></body>");
  assert.equal(injectBeforeHeadEnd(once, "<link b>").match(/<link/g).length, 1);
});

test("fontLinks: Google Fonts は gstatic にも事前接続し、& をエスケープする", () => {
  const html = fontLinks("https://fonts.googleapis.com/css2?family=A&family=B&display=swap");
  assert.match(html, /href="https:\/\/fonts.gstatic.com" crossorigin/);
  assert.match(html, /family=A&amp;family=B&amp;display=swap/);
});
