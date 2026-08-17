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
