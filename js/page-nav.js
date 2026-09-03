// ============================================================
// 共用的頁面標頭：左邊返回箭頭、標題置中，跟手機 App 常見的
// 導覽列同一種樣式。除了首頁，其他所有頁面都用這個。
// 「返回」用瀏覽器原生的上一頁機制（history.back()），不用自己
// 額外記一套瀏覽紀錄。
// 頁面本身如果有動作按鈕（匯出、篩選…），放在這個標頭下面自己一排。
// ============================================================
import { ICONS } from "./icons.js?v=20260830-96";

export function pageNavHtml(title, rightActionHtml = "") {
  return `
    <div class="page-nav">
      <button class="page-nav-back" id="page-nav-back" aria-label="返回">${ICONS.arrowLeft}</button>
      <h2 class="page-nav-title">${title}</h2>
      ${rightActionHtml ? `<div class="page-nav-right">${rightActionHtml}</div>` : ""}
    </div>
  `;
}

export function wirePageNav(container, onBack = null) {
  const btn = container.querySelector("#page-nav-back");
  if (btn) btn.addEventListener("click", () => (onBack ? onBack() : window.history.back()));
}
