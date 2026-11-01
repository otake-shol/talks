#!/usr/bin/env node
/**
 * Marp が出力した deck.html に、ページ同期機能（live-sync.js）と聴衆向け QR コードを埋め込む。
 *
 * 使い方:
 *   node tools/live-sync/inject.mjs <deck.html> --url <公開URL> [--out <出力先>] [--topic <ntfyトピック>]
 *                                   [--strip-notes] [--copy-assets] [--glossary <glossary.md>] [--font-css <URL>]
 *
 * - --strip-notes: 発表者ノートを HTML から除く（公開用。ノートには非公開の話が入りうる）
 * - --copy-assets: HTML が参照しているローカル画像だけを出力先へコピーする（使っていない原画像を出さない）
 * - --glossary: 聴衆向けの用語解説（glossary.js）を足す。書式は parseGlossary を参照
 * - --font-css: Web フォントの CSS（Google Fonts など）を読み込む。テーマの書体を入れていない端末でも同じ見た目にする
 *
 * - 出力は1ファイルで完結する HTML（既定は deck.html と同じフォルダの index.html。画像の相対パスを保つため同じフォルダに出す）
 * - QR コード画像は同じフォルダに qr.svg としても書き出す（スライド本文に貼りたいとき用）
 * - トピックを省略すると公開 URL から決まった値を作る（同じ URL なら毎回同じトピック）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SERVER = "https://ntfy.sh";

/**
 * 公開 URL から推測されにくいトピック名を作る。
 * @param {string} url
 * @returns {string}
 */
export function topicFromUrl(url) {
  return `otakeya-slides-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

/**
 * HTML の </body> 直前にスクリプトを差し込む。既に差し込み済みなら置き換える。
 * @param {string} html
 * @param {string} snippet
 * @returns {string}
 */
export function injectBeforeBodyEnd(html, snippet) {
  const marked = `<!-- live-sync:start -->${snippet}<!-- live-sync:end -->`;
  const existing = /<!-- live-sync:start -->[\s\S]*?<!-- live-sync:end -->/;
  if (existing.test(html)) return html.replace(existing, () => marked);
  const index = html.lastIndexOf("</body>");
  if (index === -1) throw new Error("</body> が見つかりません。Marp の HTML 出力を指定してください");
  return html.slice(0, index) + marked + html.slice(index);
}

/**
 * HTML の </head> 直前に要素を差し込む。既に差し込み済みなら置き換える。
 * @param {string} html
 * @param {string} snippet
 * @returns {string}
 */
export function injectBeforeHeadEnd(html, snippet) {
  const marked = `<!-- live-sync-head:start -->${snippet}<!-- live-sync-head:end -->`;
  const existing = /<!-- live-sync-head:start -->[\s\S]*?<!-- live-sync-head:end -->/;
  if (existing.test(html)) return html.replace(existing, () => marked);
  const index = html.indexOf("</head>");
  if (index === -1) throw new Error("</head> が見つかりません。Marp の HTML 出力を指定してください");
  return html.slice(0, index) + marked + html.slice(index);
}

/**
 * Web フォントの CSS を読み込む link 要素を作る。
 * @param {string} url
 * @returns {string}
 */
export function fontLinks(url) {
  const { origin } = new URL(url);
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const links = [`<link rel="preconnect" href="${origin}">`];
  if (origin === "https://fonts.googleapis.com") links.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  links.push(`<link rel="stylesheet" href="${escaped}">`);
  return links.join("");
}

/**
 * Marp の HTML から発表者ノート（.bespoke-marp-note）を除く。
 * ノートは Markdown 由来の p / ul などだけで div を入れ子にしないので、最初の </div> までを消す。
 * @param {string} html
 * @returns {string}
 */
export function stripNotes(html) {
  const stripped = html.replace(/<div class="bespoke-marp-note"[^>]*>[\s\S]*?<\/div>/g, "");
  if (stripped.includes("<div class=\"bespoke-marp-note\"")) throw new Error("発表者ノートを除ききれませんでした");
  return stripped;
}

/**
 * HTML が src / href で参照している相対パスのファイルを重複なしで返す（外部URL・アンカー・data URI は除く）。
 * @param {string} html
 * @returns {string[]}
 */
export function listLocalAssets(html) {
  const paths = new Set();
  for (const [, , path] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/|\/)/i.test(path)) continue;
    paths.add(decodeURI(path.split(/[?#]/)[0]));
  }
  return [...paths];
}

/**
 * 用語集の Markdown を読む。書式:
 *
 *   ## 用語 | 別名 | 別名
 *   解説（次の見出しまで。改行はつなげる）
 *
 * 最初の「## 」より前と、「# 」の題名行は無視する。
 * @param {string} markdown
 * @returns {{ term: string, aliases: string[], desc: string }[]}
 */
export function parseGlossary(markdown) {
  const entries = [];
  let current = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const [term, ...aliases] = heading[1].split("|").map((s) => s.trim()).filter(Boolean);
      current = { term, aliases, lines: [] };
      entries.push(current);
    } else if (current && line && !line.startsWith("#")) {
      current.lines.push(line);
    }
  }
  return entries.map(({ term, aliases, lines }) => {
    if (lines.length === 0) throw new Error(`用語「${term}」に解説がありません`);
    return { term, aliases, desc: lines.join("") };
  });
}

/**
 * qrcode パッケージの CLI で QR コードの SVG を作る（依存を package.json に足さないため npx 経由）。
 * @param {string} text
 * @returns {string}
 */
function makeQrSvg(text) {
  const dir = mkdtempSync(join(tmpdir(), "live-sync-"));
  try {
    const file = join(dir, "qr.svg");
    execFileSync("npx", ["--yes", "qrcode@1.5.4", "-t", "svg", "-e", "M", "-o", file, text], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(file, "utf8").replace(/<\?xml[^>]*\?>\s*/, "").replace(/<!DOCTYPE[^>]*>\s*/i, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      out: { type: "string" },
      topic: { type: "string" },
      "strip-notes": { type: "boolean", default: false },
      "copy-assets": { type: "boolean", default: false },
      glossary: { type: "string" },
      "font-css": { type: "string" },
    },
  });
  const [input] = positionals;
  if (!input || !values.url) {
    console.error("使い方: node tools/live-sync/inject.mjs <deck.html> --url <公開URL> [--out <出力先>] [--topic <トピック>]");
    process.exit(1);
  }

  const out = resolve(values.out ?? join(dirname(input), "index.html"));
  const topic = values.topic ?? topicFromUrl(values.url);
  const qrSvg = makeQrSvg(values.url);
  const runtime = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "live-sync.js"), "utf8");
  const config = { server: SERVER, topic, publicUrl: values.url, qrSvg };

  // </script> を含む文字列で script 要素が途切れないようにエスケープする
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  let snippet = `<script>window.LIVE_SYNC=${json};</script><script>${runtime}</script>`;
  if (values.glossary) {
    const entries = parseGlossary(readFileSync(values.glossary, "utf8"));
    const glossaryJs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "glossary.js"), "utf8");
    const glossaryJson = JSON.stringify(entries).replace(/</g, "\\u003c");
    snippet += `<script>window.SLIDE_GLOSSARY=${glossaryJson};</script><script>${glossaryJs}</script>`;
    console.log(`用語集: ${entries.length}語`);
  }
  let source = readFileSync(input, "utf8");
  if (values["strip-notes"]) source = stripNotes(source);
  let html = injectBeforeBodyEnd(source, snippet);
  if (values["font-css"]) html = injectBeforeHeadEnd(html, fontLinks(values["font-css"]));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  if (values["copy-assets"]) {
    for (const asset of listLocalAssets(source)) {
      const to = join(dirname(out), asset);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(dirname(input), asset), to);
    }
  }
  writeFileSync(join(dirname(out), "qr.svg"), qrSvg);

  console.log(`出力: ${out}`);
  console.log(`聴衆用:   ${values.url}`);
  console.log(`発表者用: ${values.url}${values.url.includes("?") ? "&" : "?"}live=present`);
  console.log(`トピック: ${topic}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
