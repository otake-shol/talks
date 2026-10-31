/**
 * Marp の HTML スライドに「発表者のページ位置を聴衆のスマホへ同期する」機能を足すランタイム。
 *
 * - 発表者: URL に ?live=present を付けて開く。ページを送るたびに位置を中継サーバへ送る。
 *           q キーで聴衆向け QR コードを全画面表示する。
 * - 聴衆:   普通に URL を開くだけ。発表者のページへ自動で追従する。
 *           自分でページを送ると追従を止め、「発表者のページへ戻る」ボタンを出す。
 *
 * 中継は ntfy.sh（登録不要の pub/sub）。Marp の HTML は URL の #番号 でページを切り替えるので、
 * 受け取った番号を location.hash に書くだけで同期できる。
 *
 * 設定は inject.mjs が window.LIVE_SYNC に埋め込む: { server, topic, publicUrl, qrSvg }
 */
(() => {
  const config = window.LIVE_SYNC;
  if (!config || !config.topic) return;

  const params = new URLSearchParams(location.search);
  // Marp の発表者ビュー（?view=presenter）と次ページのプレビュー（?view=next）では動かさない。
  // 元のウィンドウもページが連動するので、送信はそこからの1か所だけにする（重複送信の防止）
  if (params.has("view")) return;
  const isPresenter = params.get("live") === "present";
  const endpoint = `${config.server.replace(/\/$/, "")}/${encodeURIComponent(config.topic)}`;
  /** これより古い位置情報は「今は発表中ではない」とみなす */
  const STALE_MS = 2 * 60 * 1000;
  const HEARTBEAT_MS = 30 * 1000;

  /**
   * 現在のページ番号（1始まり）を URL のハッシュから読む。
   * @returns {number}
   */
  const currentPage = () => {
    const n = Number.parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  /**
   * ページが変わったら呼ぶ。Marp はページ送りで hashchange を出さずに URL を書き換えるので、
   * hashchange に加えて短い間隔で URL を見に行く。
   * @param {(page: number) => void} callback
   */
  const onPageChange = (callback) => {
    let last = currentPage();
    const check = () => {
      const page = currentPage();
      if (page === last) return;
      last = page;
      callback(page);
    };
    window.addEventListener("hashchange", check);
    setInterval(check, 200);
  };

  /** スライドの総枚数（範囲外の番号を弾くのに使う） */
  const totalPages = () => document.querySelectorAll("svg[data-marpit-svg]").length || Infinity;

  const style = document.createElement("style");
  style.textContent = `
    .ls-badge{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;gap:8px;align-items:center;
      font:600 13px/1 system-ui,-apple-system,sans-serif;color:#fff;background:rgba(20,20,20,.72);
      padding:8px 12px;border-radius:999px;backdrop-filter:blur(6px);pointer-events:none;transition:opacity .3s}
    .ls-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af}
    .ls-on .ls-dot{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.3)}
    .ls-hidden{opacity:0}
    .ls-top{top:12px;bottom:auto}
    .ls-return{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483001;
      font:700 15px/1 system-ui,-apple-system,sans-serif;color:#fff;background:#2563eb;border:0;
      padding:14px 20px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}
    .ls-qr{position:fixed;inset:0;z-index:2147483002;display:flex;flex-direction:column;gap:24px;
      align-items:center;justify-content:center;background:rgba(255,255,255,.97);
      font:700 clamp(18px,3vw,36px)/1.4 system-ui,-apple-system,sans-serif;color:#111}
    .ls-qr svg{width:min(60vh,60vw);height:auto}
    .ls-qr small{font-weight:500;font-size:.55em;color:#555}
  `;
  document.head.appendChild(style);

  const badge = document.createElement("div");
  badge.className = "ls-badge ls-hidden";
  badge.innerHTML = '<span class="ls-dot"></span><span class="ls-text"></span>';
  document.body.appendChild(badge);

  /**
   * 左下のバッジ表示を切り替える。
   * @param {string} text
   * @param {boolean} on 赤い点を点けるか
   */
  const setBadge = (text, on) => {
    badge.querySelector(".ls-text").textContent = text;
    badge.classList.toggle("ls-on", on);
    badge.classList.remove("ls-hidden");
  };

  isPresenter ? startPresenter() : startAudience();

  /** 発表者モード: ページ位置を送信し、q キーで QR を出す */
  function startPresenter() {
    let timer;

    const publish = () => {
      fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ s: currentPage() }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          setBadge(`LIVE 配信中 ${currentPage()}`, true);
        })
        .catch(() => {
          setBadge("LIVE 送信失敗（再試行します）", false);
        });
    };
    // 連打でページを送ったときは最後の位置だけ送る
    const schedule = (delay = 250) => {
      clearTimeout(timer);
      timer = setTimeout(publish, delay);
    };

    onPageChange(() => schedule());
    setInterval(() => schedule(0), HEARTBEAT_MS);
    schedule(0);

    if (config.qrSvg) {
      const overlay = document.createElement("div");
      overlay.className = "ls-qr";
      overlay.hidden = true;
      overlay.innerHTML = `${config.qrSvg}<div>スマホで読み取ると、発表中のページに自動で追従します</div><small>${config.publicUrl}</small>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", () => (overlay.hidden = true));
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "q" && !e.metaKey && !e.ctrlKey && !e.altKey) {
            overlay.hidden = !overlay.hidden;
            e.stopPropagation();
          } else if (e.key === "Escape" && !overlay.hidden) {
            overlay.hidden = true;
            e.stopPropagation();
          }
        },
        true,
      );
    }
  }

  /** 聴衆モード: 発表者の位置を購読して追従する */
  function startAudience() {
    let following = true;
    let livePage = null;
    let lastSeen = 0;
    /** 自分で移動させた先のページ。ページ変化が自分由来か利用者の操作かを見分ける */
    let expectedPage = null;

    badge.classList.add("ls-top"); // 下は「戻る」ボタンの場所にする
    const returnButton = document.createElement("button");
    returnButton.className = "ls-return";
    returnButton.hidden = true;
    document.body.appendChild(returnButton);

    const isLive = () => Date.now() - lastSeen < STALE_MS;

    const render = () => {
      if (!isLive() || livePage == null) {
        badge.classList.add("ls-hidden");
        returnButton.hidden = true;
        return;
      }
      setBadge(following ? "LIVE 発表に追従中" : "LIVE 自由閲覧中", following);
      returnButton.hidden = following || currentPage() === livePage;
      returnButton.textContent = `発表中の${livePage}枚目へ戻る`;
    };

    const goTo = (page) => {
      if (currentPage() === page) return;
      expectedPage = page;
      location.hash = `#${page}`;
    };

    onPageChange((page) => {
      if (page === expectedPage) {
        expectedPage = null;
      } else if (isLive()) {
        // 利用者が自分でページを送った → 追従を止める（発表者と同じページに来たら再開）
        following = page === livePage;
      }
      render();
    });

    returnButton.addEventListener("click", () => {
      following = true;
      if (livePage != null) goTo(livePage);
      render();
    });

    // 鮮度は中継サーバの時刻どうしで比べる（発表者と聴衆の端末の時計ズレに左右されないため）
    let serverOpenedAt = 0;
    const source = new EventSource(`${endpoint}/sse?since=latest`);
    source.addEventListener("message", (event) => {
      let envelope;
      let payload;
      try {
        envelope = JSON.parse(event.data);
        if (envelope.event === "open") {
          serverOpenedAt = envelope.time * 1000;
          return;
        }
        payload = JSON.parse(envelope.message);
      } catch {
        return;
      }
      const page = Number(payload?.s);
      if (!Number.isInteger(page) || page < 1 || page > totalPages()) return;
      if (serverOpenedAt - envelope.time * 1000 > STALE_MS) return; // 発表終了後に残った古い位置

      lastSeen = Date.now();
      livePage = page;
      if (following) goTo(page);
      render();
    });

    // 発表が止まったらバッジを消す
    setInterval(render, 10 * 1000);
  }
})();
