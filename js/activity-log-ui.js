// ============================================================
// 操作紀錄頁面：誰、什麼時候、對哪筆資料做了什麼
// 只有超級管理員/管理員看得到。
// 分頁籤依項目分類；預設用「載入更多」往回翻，也可以切到日期
// 區間篩選，直接查某段特定期間發生的事。
// ============================================================
import { listActivityLogPage, listActivityLogByDateRange, MODULE_LABELS } from "./activity-log.js?v=20260830-67";
import { renderDateRangePicker } from "./date-range-ui.js?v=20260830-67";
import { toJSDate, friendlyErrorMessage } from "./utils.js?v=20260830-67";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-67";
import { wireNameResolution } from "./auth.js?v=20260830-67";

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

const TABS = [
  { id: "all", label: "全部" },
  ...Object.entries(MODULE_LABELS).map(([id, label]) => ({ id, label })),
];

export async function renderActivityLogPage(container) {
  let logs = [];
  let lastDoc = null;
  let hasMore = true;
  let loadingMore = false;
  let searchText = "";
  let activeTab = "all";
  let dateMode = false; // false = 載入更多模式；true = 日期區間模式
  let currentRange = null;

  container.innerHTML = `
    ${pageNavHtml("操作紀錄")}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
      <input type="text" id="search-input" placeholder="搜尋操作內容/人員" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
      <button class="btn btn-secondary" id="btn-toggle-date" style="padding:9px 14px;font-size:13px;">依日期篩選</button>
    </div>
    <div id="date-range-area" style="display:none;margin-bottom:10px;"></div>
    <div class="settings-tabs" id="log-tabs"></div>
    <div class="hint" id="log-hint" style="margin-bottom:8px;"></div>
    <div id="log-list"></div>
    <div style="text-align:center;margin-top:14px;">
      <button class="btn btn-secondary" id="btn-load-more">載入更多</button>
    </div>
  `;

  wirePageNav(container);
  const tabsEl = container.querySelector("#log-tabs");
  const listEl = container.querySelector("#log-list");
  const hintEl = container.querySelector("#log-hint");
  const loadMoreBtn = container.querySelector("#btn-load-more");
  const dateAreaEl = container.querySelector("#date-range-area");

  function renderTabs() {
    tabsEl.innerHTML = TABS.map((t) => `<button class="settings-tab-btn ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
    tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.getAttribute("data-tab");
        renderTabs();
        renderList();
      });
    });
  }
  renderTabs();

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#btn-load-more").addEventListener("click", () => loadMorePage());
  container.querySelector("#btn-toggle-date").addEventListener("click", () => {
    dateMode = !dateMode;
    if (dateMode) {
      dateAreaEl.style.display = "block";
      loadMoreBtn.style.display = "none";
      const { getRange } = renderDateRangePicker(dateAreaEl, (range) => { currentRange = range; loadByDateRange(); });
      currentRange = getRange();
      loadByDateRange();
    } else {
      dateAreaEl.style.display = "none";
      dateAreaEl.innerHTML = "";
      logs = [];
      lastDoc = null;
      hasMore = true;
      loadMorePage();
    }
  });

  await loadMorePage();

  async function loadMorePage() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "載入中…";
    if (logs.length === 0) listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const { list, lastDoc: newLastDoc, hasMore: more } = await listActivityLogPage({ pageSize: 100, startAfterDoc: lastDoc });
      logs = logs.concat(list);
      lastDoc = newLastDoc;
      hasMore = more;
      hintEl.textContent = "搜尋/分頁籤只會比對「已經載入」的紀錄，資料多的話可以先點「載入更多」把想找的範圍都載進來再搜尋。";
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${friendlyErrorMessage(err)}</div>`;
    } finally {
      loadingMore = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "載入更多";
      loadMoreBtn.style.display = dateMode ? "none" : (hasMore ? "inline-flex" : "none");
    }
  }

  async function loadByDateRange() {
    if (!currentRange) return;
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      logs = await listActivityLogByDateRange(currentRange.start, currentRange.end);
      hintEl.textContent = `顯示 ${currentRange.start} ～ ${currentRange.end} 這段期間的所有紀錄，共 ${logs.length} 筆。`;
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${friendlyErrorMessage(err)}</div>`;
    }
  }

  function renderList() {
    let filtered = logs;
    if (activeTab !== "all") filtered = filtered.filter((l) => l.module === activeTab);
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
              <div class="hint" style="margin-top:3px;"><span data-resolve-email="${l.performedBy || ""}">${l.performedByName || "未知"}</span> · ${whenText}</div>
            </div>
            <span class="seal-badge ${actionBadgeClass(l.action)}" style="flex-shrink:0;"><span class="dot"></span>${ACTION_LABELS[l.action] || l.action}</span>
          </div>
        </div>
      `;
    }).join("");
    wireNameResolution(listEl);
  }
}
