// ============================================================
// 共用工具函數
// 日期處理寫法參考「開發教訓清單」第 1 點：
// 一律用本地時間 getter 組字串，不要用 toISOString（會被轉成 UTC，
// 在台灣時區容易少一天）。
// ============================================================

/**
 * 把 Date 物件轉成 YYYY-MM-DD（本地時間，零填充），用於排序 / 篩選 / 存 Firestore。
 */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 把「可能是 Firestore Timestamp、可能是字串、可能已經是 Date」的值
 * 統一轉成 JS Date 物件。
 */
export function toJSDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate(); // Firestore Timestamp
  if (val instanceof Date) return val;
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 把常見的技術性錯誤（特別是 Firestore 權限被拒）轉成使用者看得懂的
 * 中文說明，而不是直接把英文的技術錯誤代碼丟給使用者看。
 *
 * 「權限不足」是最容易讓人誤會「系統壞了」的一種錯誤——實際上是規則
 * 正常運作、正確地擋下了這個角色不該做的操作，只是原始錯誤訊息完全
 * 沒說明原因，所以特別處理這一種。其他錯誤维持顯示原本的訊息
 * （通常已經是我們自己 throw 出來、寫成中文的提示，不用再轉一次）。
 */
export function friendlyErrorMessage(err) {
  const raw = (err?.message || String(err) || "").toLowerCase();
  if (err?.code === "permission-denied" || raw.includes("missing or insufficient permissions")) {
    return "你目前的帳號角色沒有權限執行這個操作，如果覺得應該要有權限，請洽詢管理員確認角色設定。";
  }
  if (raw.includes("network") || raw.includes("failed to fetch") || raw.includes("unavailable")) {
    return "網路連線異常，請確認網路狀況後再試一次。";
  }
  return err?.message || String(err);
}

/**
 * 顯示底部 toast 提示。type: 'default' | 'success' | 'error'
 */
export function showToast(message, type = "default", duration = 2600) {
  let el = document.getElementById("global-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${type === "default" ? "" : type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove("show");
  }, duration);
}

/**
 * 簡單的 email 格式檢查（給成員管理用）。
 */
export function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str).trim());
}

/**
 * 把錯誤訊息裡的網址（例如 Firebase 要求建立索引時附的連結）轉成真的
 * 可以點擊的連結，不管畫面上怎麼換行，點下去都會帶著完整網址跳轉，
 * 不用使用者自己選取複製（容易漏字、複製到一半斷掉）。
 */
export function linkifyErrorMessage(message) {
  return String(message).replace(/(https?:\/\/[^\s]+)/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener" style="color:var(--gold-deep);text-decoration:underline;word-break:break-all;">${url}</a>`
  );
}
