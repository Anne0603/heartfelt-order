// ============================================================
// 共用的「可搜尋、置中彈跳」選擇視窗
// 取代普通下拉選單，選項多的時候（客戶、商品）比較好用
// ============================================================
export function openSearchPicker({ title, items, renderLabel, renderSub, onSelect, emptyText = "沒有可選的項目" }) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:100%;max-height:75vh;display:flex;flex-direction:column;padding:16px;">
      <h3 style="margin-bottom:10px;">${title}</h3>
      <input type="text" id="picker-search" placeholder="輸入關鍵字搜尋" style="padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;" />
      <div id="picker-list" style="overflow-y:auto;flex:1;"></div>
      <button class="btn btn-secondary" id="picker-cancel" style="margin-top:10px;">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#picker-cancel").addEventListener("click", () => overlay.remove());

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
      <button class="picker-item" data-idx="${idx}" style="display:block;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--paper-line);padding:12px 6px;cursor:pointer;font-family:var(--font-body);">
        <div style="font-size:15px;color:var(--ink);">${renderLabel(it)}</div>
        ${renderSub ? `<div class="hint">${renderSub(it)}</div>` : ""}
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
