// ============================================================
// 共用的「可搜尋、置中彈跳」選擇視窗
// 取代普通下拉選單，選項多的時候（客戶、商品）比較好用
// ============================================================
import { mountOverlay } from "./modal-ui.js?v=20260830-84";

export function openSearchPicker({ title, items, renderLabel, renderSub, renderThumb, onSelect, emptyText = "沒有可選的項目" }) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:100%;max-height:75vh;display:flex;flex-direction:column;padding:16px;position:relative;">
      <button id="picker-close-x" aria-label="關閉" style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:none;background:var(--paper);color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1;">✕</button>
      <h3 style="margin-bottom:10px;padding-right:30px;">${title}</h3>
      <input type="text" id="picker-search" placeholder="輸入關鍵字搜尋" style="padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:10px;" />
      <div id="picker-list" style="overflow-y:auto;flex:1;"></div>
    </div>
  `;
  // 背景頁面捲動鎖定的邏輯統一放在 modal-ui.js 的 mountOverlay 裡，
  // 這裡直接用，跟全站其他彈窗共用同一套機制、同一個計數器，
  // 才能正確處理「彈窗疊彈窗」的情況（例如這個選擇視窗如果剛好是從
  // 另一個表單彈窗裡開出來的）。
  mountOverlay(overlay);
  overlay.querySelector("#picker-close-x").addEventListener("click", () => overlay.remove());

  const searchInput = overlay.querySelector("#picker-search");
  const listEl = overlay.querySelector("#picker-list");

  function renderList(filterText) {
    const filtered = filterText
      ? items.filter((it) => renderLabel(it).toLowerCase().includes(filterText.toLowerCase()))
      : items;
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="hint" style="text-align:center;padding:20px 0;">${emptyText}</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((it, idx) => `
      <button class="picker-item" data-idx="${idx}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--paper-line);padding:10px 6px;cursor:pointer;font-family:var(--font-body);">
        ${renderThumb ? (renderThumb(it)
            ? `<img src="${renderThumb(it)}" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
            : `<div style="width:38px;height:38px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`
          ) : ""}
        <div>
          <div style="font-size:15px;color:var(--ink);">${renderLabel(it)}</div>
          ${renderSub ? `<div class="hint">${renderSub(it)}</div>` : ""}
        </div>
      </button>
    `).join("");
    listEl.querySelectorAll("[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = filtered[Number(btn.getAttribute("data-idx"))];
        overlay.remove();
        onSelect(item);
      });
      btn.addEventListener("mouseenter", () => btn.style.background = "var(--paper)");
      btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
    });
  }

  searchInput.addEventListener("input", (e) => renderList(e.target.value.trim()));
  renderList("");
  searchInput.focus();
}
