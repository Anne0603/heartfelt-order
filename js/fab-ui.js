// ============================================================
// 浮動「+」新增按鈕（右下角）
// 一個動作：點了直接觸發
// 多個動作：點「+」向上展開成好幾個獨立按鈕，點旁邊收回去
// 每次呼叫 setFab() 會自動清掉上一個頁面留下的按鈕，不用每個頁面自己清
// 圖示用 SVG 畫（不用手機表情符號），不同裝置顯示才會一致、顏色才可控
// ============================================================
let fabContainer = null;

const ICONS = {
  add: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none"/><path d="M2.5 3h2.4l2.1 11.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.96-1.6l1.4-7.4H6"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="4" width="13" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><line x1="8.5" y1="10.5" x2="15.5" y2="10.5"/><line x1="8.5" y1="14" x2="15.5" y2="14"/><line x1="8.5" y1="17.5" x2="12.5" y2="17.5"/></svg>`,
};
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
 * actions: [{ icon, label, onClick }]  — icon 是 ICONS 裡的鍵名（'add' | 'cart' | 'clipboard'）
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
