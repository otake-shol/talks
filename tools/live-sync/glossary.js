/**
 * 聴衆向けの用語解説。今のページに出てくる専門用語に点線の下線を引き、
 * 右上の「用語」ボタンか下線をタップすると解説を下から出す。
 *
 * 用語集は inject.mjs が window.SLIDE_GLOSSARY に埋め込む: [{ term, aliases, desc }]
 * 発表者モード（?live=present）と Marp の発表者ビュー（?view=...）では動かさない（スクリーンに出さない）。
 */
(() => {
  const glossary = window.SLIDE_GLOSSARY;
  if (!Array.isArray(glossary) || glossary.length === 0) return;
  const params = new URLSearchParams(location.search);
  if (params.has("view") || params.get("live") === "present") return;

  const slides = [...document.querySelectorAll("svg[data-marpit-svg] > foreignObject > section")];
  if (slides.length === 0) return;

  /** 表記ゆれ（別名）から用語の番号を引く。英数字は大文字小文字を区別しない */
  const indexByName = new Map();
  for (const [i, entry] of glossary.entries()) {
    for (const name of [entry.term, ...(entry.aliases ?? [])]) indexByName.set(name.toLowerCase(), i);
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 長い表記から先に当てる（「Claude Code」を「Claude」より優先）。英数字の語は単語の途中では当てない
  const pattern = new RegExp(
    [...indexByName.keys()]
      .sort((a, b) => b.length - a.length)
      .map((name) => {
        const body = escape(name);
        const head = /^[a-z0-9_]/i.test(name) ? "(?<![A-Za-z0-9_])" : "";
        const tail = /[a-z0-9_]$/i.test(name) ? "(?![A-Za-z0-9_])" : "";
        return head + body + tail;
      })
      .join("|"),
    "gi",
  );

  /**
   * ページ内の用語に下線用の span を付け、出てきた用語の番号を返す（同じ用語の下線はページで最初の1回だけ）。
   * @param {Element} section
   * @returns {number[]}
   */
  const markTerms = (section) => {
    const found = new Set();
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement.closest("style, script, a, .ls-term") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const text = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const index = indexByName.get(match[0].toLowerCase());
        if (index === undefined || found.has(index)) continue;
        found.add(index);
        fragment.append(text.slice(last, match.index));
        const span = document.createElement("span");
        span.className = "ls-term";
        span.dataset.term = String(index);
        span.textContent = match[0];
        fragment.append(span);
        last = match.index + match[0].length;
      }
      if (last === 0) continue;
      fragment.append(text.slice(last));
      node.replaceWith(fragment);
    }
    return [...found];
  };

  const termsByPage = slides.map(markTerms);

  const style = document.createElement("style");
  style.textContent = `
    .ls-term{text-decoration:underline dotted;text-decoration-thickness:.08em;text-underline-offset:.18em;cursor:pointer}
    .ls-gl-btn{position:fixed;right:12px;top:12px;z-index:2147483000;font:700 13px/1 system-ui,-apple-system,sans-serif;
      color:#fff;background:rgba(20,20,20,.72);border:0;padding:9px 13px;border-radius:999px;backdrop-filter:blur(6px);cursor:pointer}
    .ls-gl-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483003;max-height:60vh;overflow:auto;
      background:#fff;color:#111;border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.25);
      padding:8px 20px 24px;font:15px/1.65 system-ui,-apple-system,"Hiragino Sans",sans-serif}
    .ls-gl-head{position:sticky;top:0;display:flex;gap:8px;align-items:center;background:#fff;padding:10px 0}
    .ls-gl-tab{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:999px;padding:6px 12px;font:600 13px/1 inherit;cursor:pointer}
    .ls-gl-tab[aria-pressed="true"]{background:#111;border-color:#111;color:#fff}
    .ls-gl-close{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;color:#6b7280;cursor:pointer}
    .ls-gl-sheet dl{margin:0}
    .ls-gl-sheet dt{font-weight:700;margin-top:14px}
    .ls-gl-sheet dd{margin:2px 0 0;color:#374151}
    .ls-gl-sheet .ls-gl-hit{background:#fef3c7;border-radius:6px;padding:0 4px;margin-left:-4px}
  `;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.className = "ls-gl-btn";
  button.hidden = true;
  const sheet = document.createElement("div");
  sheet.className = "ls-gl-sheet";
  sheet.hidden = true;
  sheet.innerHTML = `<div class="ls-gl-head">
      <button class="ls-gl-tab" data-tab="page">このページ</button>
      <button class="ls-gl-tab" data-tab="all">すべての用語</button>
      <button class="ls-gl-close" aria-label="閉じる">×</button>
    </div><dl></dl>`;
  document.body.append(button, sheet);

  // シートやボタンの操作でスライドが送られないようにする（スワイプ・キー操作）
  for (const el of [button, sheet]) {
    for (const type of ["click", "touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "keydown", "wheel"]) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  const currentPage = () => {
    const n = Number.parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const pageTerms = () => termsByPage[currentPage() - 1] ?? [];

  let tab = "page";
  /**
   * 解説シートを描く。
   * @param {number | null} highlight 強調する用語の番号
   */
  const renderSheet = (highlight = null) => {
    const ids = tab === "page" ? pageTerms() : glossary.map((_, i) => i);
    for (const t of sheet.querySelectorAll(".ls-gl-tab")) t.setAttribute("aria-pressed", String(t.dataset.tab === tab));
    const dl = sheet.querySelector("dl");
    dl.replaceChildren();
    for (const i of ids) {
      const dt = document.createElement("dt");
      const name = document.createElement("span");
      name.textContent = glossary[i].term;
      if (i === highlight) name.className = "ls-gl-hit";
      dt.append(name);
      const dd = document.createElement("dd");
      dd.textContent = glossary[i].desc;
      dl.append(dt, dd);
      if (i === highlight) requestAnimationFrame(() => dt.scrollIntoView({ block: "nearest" }));
    }
    if (ids.length === 0) dl.innerHTML = '<dd style="margin-top:12px">このページに解説つきの用語はありません</dd>';
  };

  const renderButton = () => {
    const count = pageTerms().length;
    button.hidden = count === 0;
    button.textContent = `用語 ${count}`;
    if (!sheet.hidden && tab === "page") renderSheet();
  };

  button.addEventListener("click", () => {
    tab = "page";
    renderSheet();
    sheet.hidden = !sheet.hidden;
  });
  sheet.querySelector(".ls-gl-close").addEventListener("click", () => (sheet.hidden = true));
  for (const t of sheet.querySelectorAll(".ls-gl-tab")) {
    t.addEventListener("click", () => {
      tab = t.dataset.tab;
      renderSheet();
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      const term = e.target instanceof Element && e.target.closest(".ls-term");
      if (!term) return;
      e.stopPropagation();
      tab = "page";
      renderSheet(Number(term.dataset.term));
      sheet.hidden = false;
    },
    true,
  );

  // Marp はページ送りで hashchange を出さずに URL を書き換えるので、URL も見に行く
  let last = currentPage();
  const check = () => {
    if (currentPage() === last) return;
    last = currentPage();
    renderButton();
  };
  window.addEventListener("hashchange", check);
  setInterval(check, 200);
  renderButton();
})();
