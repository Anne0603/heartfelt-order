// ============================================================
// 操作紀錄頁面：誰、什麼時候、對哪筆資料做了什麼
// 只有超級管理員/管理員看得到
// ============================================================
import { listActivityLog, MODULE_LABELS } from "./activity-log.js";
import { toJSDate } from "./utils.js";

const ACTION_LABELS = {
  create: "新增", update: "編輯", archive: "停用", restore: "恢復使用",
  void: "作廢", delete: "刪除", status: "狀態變更",
};
function actionBadgeClass(action) {
  if (action === "create") return "ok";
  if (action === "delete" || action === "void") return "bad";
  if (action === "archive") return "muted";
  return "warn";
}

export async function renderActivityLogPage(container) {
  let logs = [];
  let searchText = "";
  let filterModule = "all";

  container.innerHTML = `
    <div class="page-header"><h2>操作紀錄</h2></div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋操作內容/人員" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <select id="filter-module" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;">
          <option value="all">全部項目</option>
          ${Object.entries(MODULE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="log-list"></div>
    <div class="hint" style="text-align:center;margin-top:10px;">只顯示最近 100 筆</div>
  `;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-module").addEventListener("change", (e) => {
    filterModule = e.target.value;
    renderList();
  });

  const listEl = container.querySelector("#log-list");
  listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
  try {
    logs = await listActivityLog(100);
    renderList();
  } catch (err) {
    listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
  }

  function renderList() {
    let filtered = logs;
    if (filterModule !== "all") filtered = filtered.filter((l) => l.module === filterModule);
    if (searchText) {
      filtered = filtered.filter((l) =>
        (l.summary || "").toLowerCase().includes(searchText) ||
        (l.performedByName || "").toLowerCase().includes(searchText)
      );
    }
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有符合的紀錄</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((l) => {
      const when = toJSDate(l.createdAt);
      const whenText = when ? when.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      return `
        <div class="card" style="margin-bottom:8px;padding:14px 16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-size:14.5px;color:var(--ink);">${l.summary || ""}</div>
              <div class="hint" style="margin-top:3px;">${l.performedByName || "未知"} · ${whenText}</div>
            </div>
            <span class="seal-badge ${actionBadgeClass(l.action)}" style="flex-shrink:0;"><span class="dot"></span>${ACTION_LABELS[l.action] || l.action}</span>
          </div>
        </div>
      `;
    }).join("");
  }
}
