// ============================================================
// 浮動「+」新增按鈕（右下角）
// 一個動作：點了直接觸發
// 多個動作：點「+」向上展開成好幾個獨立按鈕，點旁邊收回去
// 每次呼叫 setFab() 會自動清掉上一個頁面留下的按鈕，不用每個頁面自己清
// ============================================================
import { ICONS } from "./icons.js?v=20260830-62";

let fabContainer = null;

function iconSvg(name) {
  return `<span class="fab-icon-svg">${ICONS[name] || ICONS.add}</span>`;
}

export function clearFab() {
  if (fabContainer) {
    fabContainer.remove();
    fabContainer = null;
  }
}

/**
 * actions: [{ icon, label, onClick }]  — icon 是 icons.js 裡的鍵名
 */
export function setFab(actions) {
  clearFab();
  if (!actions || actions.length === 0) return;

  fabContainer = document.createElement("div");
  fabContainer.className = "fab-container";
  document.body.appendChild(fabContainer);

  if (actions.length === 1) {
    fabContainer.innerHTML = `<button class="fab-main" aria-label="${actions[0].label}" title="${actions[0].label}">${iconSvg(actions[0].icon)}</button>`;
    fabContainer.querySelector(".fab-main").addEventListener("click", actions[0].onClick);
    return;
  }

  let open = false;
  function render() {
    fabContainer.innerHTML = `
      ${actions.map((a) => `
        <div class="fab-sub-row ${open ? "show" : ""}">
          <span class="fab-sub-label">${a.label}</span>
          <button class="fab-sub-btn" data-idx aria-label="${a.label}">${iconSvg(a.icon)}</button>
        </div>
      `).join("")}
      <button class="fab-main ${open ? "open" : ""}" aria-label="新增">${iconSvg(open ? "close" : "add")}</button>
    `;
    fabContainer.querySelector(".fab-main").addEventListener("click", () => {
      open = !open;
      render();
    });
    fabContainer.querySelectorAll("[data-idx]").forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        open = false;
        render();
        actions[idx].onClick();
      });
    });
  }
  render();
}
