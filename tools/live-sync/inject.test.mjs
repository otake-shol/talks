import assert from "node:assert/strict";
import { test } from "node:test";
import { injectBeforeBodyEnd, listLocalAssets, stripNotes, topicFromUrl } from "./inject.mjs";

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
