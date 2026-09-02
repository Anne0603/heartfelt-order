// ============================================================
// 商品與庫存頁面 UI（合併版）
// ============================================================
import { showToast, linkifyErrorMessage, friendlyErrorMessage } from "./utils.js?v=20260830-83";
import { currentSession, wireNameResolution } from "./auth.js?v=20260830-83";
import {
  listItems, createItem, updateItem, setItemArchived, deleteItemPermanently,
  addPurchaseBatch, stocktakeAdjust, disposeStock,
  listPurchases, listUsages, listStocktakes,
  voidRecord, permanentlyDelete,
  computeStock, computeAvgCost, calcItemCost, buildItemsIndex,
  TYPE_LABELS, ORDERABLE_TYPES, STOCK_TRACKED_TYPES,
} from "./items.js?v=20260830-83";
import { listCategories } from "./categories.js?v=20260830-83";
import { listUnits } from "./units.js?v=20260830-83";
import { uploadImageToCloudinary } from "./settings.js?v=20260830-83";
import { openModal, confirmDialog, openImageLightbox } from "./modal-ui.js?v=20260830-83";
import { openSearchPicker } from "./picker-ui.js?v=20260830-83";
import { exportItems } from "./export-xlsx.js?v=20260830-83";
import { setFab } from "./fab-ui.js?v=20260830-83";
import { iconHtml } from "./icons.js?v=20260830-83";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-83";

const TYPE_HINTS = {
  self_made: "自己現做的東西，客戶可訂購。不追蹤庫存量，成本 = 配方裡每一項包材的成本加總（原料/人工每月算在「利潤總覽」）。",
  resale: "直接進貨轉賣的東西，客戶可訂購。會追蹤庫存量與進貨均價。",
  packaging: "幕後消耗品（緞帶、盒子），客戶不會直接訂購，會追蹤庫存與均價。",
};

function canSeeCost() {
  return ["superadmin", "admin", "viewer"].includes(currentSession.member?.role);
}
// 毛利比成本更敏感，管理員日常操作(出貨/上架)時不會直接看到，
// 但報表頁面（利潤總覽/統計報表）本來就有自己的角色限制，管理員
// 主動去看報表還是看得到，這裡只限制「順手就會看到」的畫面。
function canSeeProfit() {
  return currentSession.member?.role === "superadmin";
}
function canWrite() {
  return ["superadmin", "admin", "order_staff"].includes(currentSession.member?.role);
}
function canWriteType(type) {
  const r = currentSession.member?.role;
  if (["superadmin", "admin"].includes(r)) return true;
  if (r === "order_staff") return type !== "self_made";
  return false;
}
function canVoid() {
  return ["superadmin", "admin"].includes(currentSession.member?.role);
}
function canDelete() {
  return currentSession.member?.role === "superadmin";
}

export async function renderItemsPage(container, initialFilter = null) {
  let items = [];
  let itemsById = new Map();
  let categoriesByType = { self_made: [], resale: [], packaging: [] };
  let units = [];
  let filterType = initialFilter?.type || "all";
  let filterCategory = "all";
  let searchText = "";
  let statusTab = "active"; // 'active' | 'archived'

  async function loadData() {
    const [itemsResult, selfMadeCats, resaleCats, packagingCats, unitsResult] = await Promise.all([
      listItems({ includeArchived: true }),
      listCategories("items_self_made"),
      listCategories("items_resale"),
      listCategories("items_packaging"),
      listUnits(),
    ]);
    items = itemsResult;
    categoriesByType = { self_made: selfMadeCats, resale: resaleCats, packaging: packagingCats };
    units = unitsResult;
    itemsById = buildItemsIndex(items);
  }

  // 全部分類（三種類型合併，篩選用；依名稱排序、避免重複名稱重複列出）
  function allCategoriesMerged() {
    const seen = new Map();
    [...categoriesByType.self_made, ...categoriesByType.resale, ...categoriesByType.packaging].forEach((c) => {
      if (!seen.has(c.name)) seen.set(c.name, c);
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function unitOptions(selected) {
    const list = units.length ? units.map((u) => u.name) : ["個"];
    return list.map((u) => `<option value="${u}" ${u === selected ? "selected" : ""}>${u}</option>`).join("");
  }

  // ============================================================
  // 列表畫面
  // ============================================================
  async function renderListView() {
    container.innerHTML = `
      ${pageNavHtml("商品與庫存", `<button class="btn btn-secondary" id="btn-export-items" style="padding:7px 12px;font-size:13px;">匯出</button>`)}
      <div class="pill-toggle" id="status-toggle">
        <button class="pill-toggle-btn ${statusTab === "active" ? "active" : ""}" data-status="active">使用中</button>
        <button class="pill-toggle-btn ${statusTab === "archived" ? "active" : ""}" data-status="archived">已停用</button>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <input type="text" id="search-input" placeholder="搜尋名稱" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:10px;" />
        <div style="display:flex;gap:10px;">
          <button type="button" id="filter-type-btn" class="picker-trigger" style="flex:1;">全部類型</button>
          <button type="button" id="filter-category-btn" class="picker-trigger" style="flex:1;">全部分類</button>
        </div>
      </div>
      <div id="items-list"></div>
    `;

    const TYPE_OPTIONS = [
      { id: "all", name: "全部類型" },
      { id: "self_made", name: "自製商品" },
      { id: "resale", name: "現貨商品" },
      { id: "packaging", name: "包材" },
    ];
    function updateTypeBtnLabel() {
      container.querySelector("#filter-type-btn").textContent = TYPE_OPTIONS.find((t) => t.id === filterType)?.name || "全部類型";
    }
    function updateCategoryBtnLabel() {
      container.querySelector("#filter-category-btn").textContent = filterCategory === "all" ? "全部分類" : filterCategory;
    }
    updateTypeBtnLabel();
    updateCategoryBtnLabel();

    container.querySelector("#search-input").addEventListener("input", (e) => {
      searchText = e.target.value.trim().toLowerCase();
      renderList();
    });
    container.querySelector("#filter-type-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇類型",
        items: TYPE_OPTIONS,
        renderLabel: (t) => t.name,
        onSelect: (t) => {
          filterType = t.id;
          filterCategory = "all"; // 換類型後，分類篩選重置，避免留著不屬於新類型的分類
          updateTypeBtnLabel();
          updateCategoryBtnLabel();
          renderList();
        },
      });
    });
    container.querySelector("#filter-category-btn").addEventListener("click", () => {
      const catList = filterType === "all" ? allCategoriesMerged() : categoriesByType[filterType] || [];
      openSearchPicker({
        title: "選擇分類",
        items: [{ id: "all", name: "全部分類" }, ...catList],
        renderLabel: (c) => c.name,
        emptyText: "這個類型還沒有建立任何分類",
        onSelect: (c) => { filterCategory = c.id === "all" ? "all" : c.name; updateCategoryBtnLabel(); renderList(); },
      });
    });
    wirePageNav(container);
    container.querySelector("#status-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status]");
      if (!btn) return;
      statusTab = btn.getAttribute("data-status");
      container.querySelectorAll("#status-toggle [data-status]").forEach((b) => b.classList.toggle("active", b === btn));
      renderList();
    });
    container.querySelector("#btn-export-items").addEventListener("click", () => {
      openExportModal();
    });

    if (canWrite()) {
      setFab([
        { icon: "add", label: "新增項目", onClick: () => openItemModal() },
        { icon: "cart", label: "採購登記", onClick: () => openPurchaseModal() },
        { icon: "clipboard", label: "盤點", onClick: () => openStocktakeModal() },
        { icon: "trash", label: "報廢/損耗", onClick: () => openDisposeModal() },
      ]);
    }

    renderList();
  }

  function getFilteredItems() {
    let filtered = items.filter((i) => (statusTab === "archived") === (i.status === "archived"));
    if (filterType !== "all") filtered = filtered.filter((i) => i.type === filterType);
    if (filterCategory !== "all") filtered = filtered.filter((i) => i.category === filterCategory);
    if (searchText) filtered = filtered.filter((i) => (i.name || "").toLowerCase().includes(searchText));
    return filtered;
  }

  async function reload() {
    const listEl = container.querySelector("#items-list");
    if (listEl) listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      await loadData();
      renderList();
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(friendlyErrorMessage(err))}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#items-list");
    if (!listEl) return;
    const filtered = getFilteredItems();

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">${statusTab === "archived" ? "沒有已停用的項目" : "沒有項目"}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((item) => {
      const stock = computeStock(item);
      const isLow = STOCK_TRACKED_TYPES.includes(item.type) && item.lowStockThreshold > 0 && stock <= item.lowStockThreshold;
      const calc = calcItemCost(item, itemsById);

      return `
        <div class="card" style="margin-bottom:10px;cursor:pointer;" data-open="${item.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div style="display:flex;gap:12px;min-width:0;flex:1;">
              ${item.photoUrl ? `<img src="${item.photoUrl}" data-preview="${item.photoUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;cursor:pointer;">` : `<div style="width:44px;height:44px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`}
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:16px;color:var(--ink);word-break:break-word;">${item.name}</div>
                <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[item.type]}${item.category ? " · " + item.category : ""}</div>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              ${ORDERABLE_TYPES.includes(item.type) ? `<div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--ink);white-space:nowrap;">$${item.price}</div>` : ""}
              ${STOCK_TRACKED_TYPES.includes(item.type) ? `<div style="font-family:var(--font-mono);font-size:${ORDERABLE_TYPES.includes(item.type) ? "12px" : "18px"};font-weight:700;color:${isLow ? "var(--rose)" : "var(--ink)"};white-space:nowrap;">庫存 ${stock} ${item.unit || "個"}</div>` : ""}
              ${canSeeProfit() && calc ? `<div style="font-size:12px;color:${calc.profit >= 0 ? "var(--jade)" : "var(--rose)"};white-space:nowrap;">毛利 $${calc.profit.toFixed(1)}${calc.isFullCost ? "" : "*"}</div>` : ""}
            </div>
          </div>
          ${isLow ? `<div class="seal-badge bad" style="margin-top:8px;"><span class="dot"></span>低於庫存門檻(${item.lowStockThreshold})</div>` : ""}
        </div>
      `;
    }).join("");
    if (statusTab === "active" && items.some((i) => i.type === "self_made") && canSeeProfit()) {
      listEl.insertAdjacentHTML("beforeend", `<div class="hint" style="text-align:center;margin-top:6px;">* 自製商品的毛利未扣原料/人工，那些算在「利潤總覽」</div>`);
    }

    listEl.querySelectorAll("[data-preview]").forEach((img) => {
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        openImageLightbox(img.getAttribute("data-preview"));
      });
    });
    listEl.querySelectorAll("[data-open]").forEach((card) => {
      card.addEventListener("click", () => renderDetailView(card.getAttribute("data-open")));
    });
  }

  // ============================================================
  // 匯出前先選要匯出哪些資料
  // ============================================================
  function openExportModal() {
    let expStatus = "all";
    let expType = filterType;
    let expCategory = filterCategory;

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">匯出 Excel</h3>
      <div class="field"><label>狀態</label>
        <select id="exp-status">
          <option value="all">全部（使用中＋已停用）</option>
          <option value="active">只匯出使用中</option>
          <option value="archived">只匯出已停用</option>
        </select>
      </div>
      <div class="field"><label>類型</label>
        <select id="exp-type">
          <option value="all">全部類型</option>
          <option value="self_made">自製商品</option>
          <option value="resale">現貨商品</option>
          <option value="packaging">包材</option>
        </select>
      </div>
      <div class="field"><label>分類</label>
        <select id="exp-category">
          <option value="all">全部分類</option>
          ${allCategoriesMerged().map((c) => `<option value="${c.name}">${c.name}</option>`).join("")}
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="exp-confirm">確認匯出</button>
      </div>
    `, 400);

    overlay.querySelector("#exp-type").value = expType;
    overlay.querySelector("#exp-category").value = expCategory;

    function refreshExpCategoryOptions(type) {
      const catSelect = overlay.querySelector("#exp-category");
      const list = type === "all" ? allCategoriesMerged() : (categoriesByType[type] || []);
      catSelect.innerHTML = `<option value="all">全部分類</option>` + list.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
    }
    overlay.querySelector("#exp-type").addEventListener("change", (e) => refreshExpCategoryOptions(e.target.value));

    overlay.querySelector("#exp-confirm").addEventListener("click", () => {
      expStatus = overlay.querySelector("#exp-status").value;
      expType = overlay.querySelector("#exp-type").value;
      expCategory = overlay.querySelector("#exp-category").value;

      let filtered = items;
      if (expStatus !== "all") filtered = filtered.filter((i) => (expStatus === "archived") === (i.status === "archived"));
      if (expType !== "all") filtered = filtered.filter((i) => i.type === expType);
      if (expCategory !== "all") filtered = filtered.filter((i) => i.category === expCategory);

      if (filtered.length === 0) { showToast("沒有符合條件的項目可以匯出", "error"); return; }
      exportItems(filtered, { includeCost: canSeeCost() });
      overlay.remove();
    });
  }

  // ============================================================
  // 詳細畫面（取代原本的小彈跳視窗，可編輯、可查記錄、可搜尋）
  // ============================================================
  async function renderDetailView(itemId) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const calc = calcItemCost(item, itemsById);
    const isTracked = STOCK_TRACKED_TYPES.includes(item.type);

    container.innerHTML = `
      ${pageNavHtml(item.name)}
      ${item.status === "archived" ? `<div class="seal-badge muted" style="margin-bottom:12px;"><span class="dot"></span>已停用</div>` : ""}

      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;gap:14px;align-items:flex-start;">
          ${item.photoUrl ? `<img src="${item.photoUrl}" data-preview="${item.photoUrl}" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;cursor:pointer;">` : `<div style="width:64px;height:64px;border-radius:10px;background:var(--paper);flex-shrink:0;"></div>`}
          <div>
            <div style="font-weight:700;font-size:19px;color:var(--ink);">${item.name}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[item.type]}${item.category ? " · " + item.category : ""}</div>
          </div>
        </div>
        <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:14px;">
          ${ORDERABLE_TYPES.includes(item.type) ? `<div><div class="hint">售價</div><div style="font-family:var(--font-mono);font-size:17px;font-weight:700;">$${item.price}</div></div>` : ""}
          ${isTracked ? `<div><div class="hint">庫存</div><div style="font-family:var(--font-mono);font-size:17px;font-weight:700;">${computeStock(item)} ${item.unit || "個"}</div></div>` : ""}
          ${isTracked ? `<div><div class="hint">均價</div><div style="font-family:var(--font-mono);font-size:17px;font-weight:700;">$${computeAvgCost(item).toFixed(2)}</div></div>` : ""}
          ${canSeeProfit() && calc ? `<div><div class="hint">毛利</div><div style="font-family:var(--font-mono);font-size:17px;font-weight:700;color:${calc.profit>=0?"var(--jade)":"var(--rose)"};">$${calc.profit.toFixed(1)}</div></div>` : ""}
        </div>
        ${canWriteType(item.type) ? `
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--paper-line);">
            <button class="btn btn-secondary" id="btn-edit-item" style="padding:7px 14px;font-size:13px;">編輯</button>
            <button class="btn ${item.status === "archived" ? "btn-success" : "btn-secondary"}" id="btn-archive-item" style="padding:7px 14px;font-size:13px;">${item.status === "archived" ? "恢復使用" : "停用"}</button>
          </div>
        ` : ""}
        ${item.status === "archived" && currentSession.member?.role === "superadmin" ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--paper-line);">
            <button class="btn btn-danger" id="btn-delete-item-permanent" style="width:100%;">永久刪除</button>
          </div>
        ` : ""}
      </div>

      ${canSeeCost() && calc ? `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:10px;">成本明細</h3>
          <table class="simple-table">
            ${calc.breakdown.map((b) => `<tr><td>${b.label}</td><td style="text-align:right;font-family:var(--font-mono);">$${b.amount.toFixed(2)}</td></tr>`).join("")}
            <tr style="font-weight:700;"><td>成本合計</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.cost.toFixed(2)}</td></tr>
          </table>
          ${!calc.isFullCost ? `<div class="hint" style="margin-top:8px;">未扣原料/人工，那些每月算在「利潤總覽」。</div>` : ""}
        </div>
      ` : ""}

      ${isTracked ? `
        <div class="settings-tabs" id="record-tabs"></div>
        <div id="record-content"></div>
      ` : ""}
    `;

    wirePageNav(container, renderListView);
    container.querySelector("[data-preview]")?.addEventListener("click", () => openImageLightbox(item.photoUrl));
    if (canWriteType(item.type)) {
      container.querySelector("#btn-edit-item").addEventListener("click", () => openItemModal(item));
      container.querySelector("#btn-archive-item").addEventListener("click", async () => {
        const willArchive = item.status !== "archived";
        if (willArchive && !await confirmDialog(`確定要停用「${item.name}」嗎？`)) return;
        try {
          await setItemArchived(item.id, willArchive, item.name);
          showToast(willArchive ? "已停用" : "已恢復使用", "success");
          await loadData();
          renderDetailView(itemId);
        } catch (err) {
          showToast("操作失敗：" + friendlyErrorMessage(err), "error");
        }
      });
    }
    container.querySelector("#btn-delete-item-permanent")?.addEventListener("click", () => {
      openDeleteItemModal(item, itemId);
    });

    if (isTracked) {
      await renderRecordTabs(itemId);
    }
  }

  // 永久刪除商品是不可逆的動作，要求輸入「確認」兩個字才會真的執行
  function openDeleteItemModal(item, itemId) {
    const overlay = openModal(`
      <h3 style="margin-bottom:4px;">確認永久刪除</h3>
      <div class="hint" style="margin-bottom:14px;">${item.name}</div>
      <div class="hint" style="color:var(--rose);margin-bottom:14px;">刪除後這個項目會完全消失，其他人也看不到，連同它的進貨/領用/盤點記錄一起刪除，無法復原。</div>
      <div class="field"><label>確定要刪除的話，請輸入「確認」兩個字</label><input type="text" id="di-confirm-text" placeholder="確認" /></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-secondary" id="di-cancel">取消</button>
        <button class="btn btn-danger" id="di-confirm">永久刪除</button>
      </div>
    `, 400);
    overlay.querySelector("#di-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#di-confirm").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const text = overlay.querySelector("#di-confirm-text").value.trim();
      if (text !== "確認") { showToast("請輸入「確認」兩個字才能執行", "error"); return; }
      btn.disabled = true;
      try {
        await deleteItemPermanently(itemId);
        showToast("已永久刪除", "success");
        overlay.remove();
        await loadData();
        renderListView();
      } catch (err) {
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });
  }

  async function renderRecordTabs(itemId) {
    const tabsEl = container.querySelector("#record-tabs");
    const contentEl = container.querySelector("#record-content");
    if (!tabsEl) return;

    const RECORD_TABS = [
      { id: "purchases", label: "進貨記錄" },
      { id: "usages", label: "領用記錄" },
      { id: "stocktakes", label: "盤點記錄" },
    ];
    let activeTab = "purchases";
    let allRecords = { purchases: [], usages: [], stocktakes: [] };
    let recSearch = "";

    [allRecords.purchases, allRecords.usages, allRecords.stocktakes] = await Promise.all([
      listPurchases(itemId), listUsages(itemId), listStocktakes(itemId),
    ]);

    function renderTabButtons() {
      tabsEl.innerHTML = RECORD_TABS.map((t) => `
        <button class="settings-tab-btn ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}（${allRecords[t.id].length}）</button>
      `).join("");
      tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeTab = btn.getAttribute("data-tab");
          recSearch = "";
          renderTabButtons();
          renderTabContent();
        });
      });
    }

    function matchesSearch(r, kw) {
      const lower = kw.toLowerCase();
      return (r.date || "").includes(kw)
        || (r.note || "").toLowerCase().includes(lower)
        || (r.createdByName || "").toLowerCase().includes(lower)
        || String(r.amount ?? "").includes(kw)
        || String(r.qty ?? "").includes(kw)
        || String(r.countedQty ?? "").includes(kw);
    }

    function renderTabContent() {
      const records = allRecords[activeTab];

      contentEl.innerHTML = `
        <div class="card">
          <input type="text" id="rec-search" placeholder="搜尋日期/金額/備註/人員" value="${recSearch}" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:12px;" />
          <div id="rec-list"></div>
        </div>
      `;
      contentEl.querySelector("#rec-search").addEventListener("input", (e) => {
        recSearch = e.target.value.trim();
        renderRecList();
      });
      renderRecList();

      function renderRecList() {
        const filtered2 = recSearch ? records.filter((r) => matchesSearch(r, recSearch)) : records;
        const listEl = contentEl.querySelector("#rec-list");
        if (filtered2.length === 0) {
          listEl.innerHTML = `<div class="hint" style="text-align:center;padding:16px 0;">沒有符合的記錄</div>`;
          return;
        }
        if (activeTab === "stocktakes") {
          listEl.innerHTML = filtered2.map((s) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--paper-line);">
              <div style="font-size:14px;">${s.date} · 盤點為 ${s.countedQty}（原 ${s.systemQtyBefore}，差 ${s.diff > 0 ? "+" : ""}${s.diff}）</div>
              ${s.note ? `<div class="hint">${s.note}</div>` : ""}
              <div class="hint" data-resolve-email="${s.createdBy || ""}">${s.createdByName || ""}</div>
            </div>
          `).join("");
          wireNameResolution(listEl);
          return;
        }
        const kind = activeTab === "purchases" ? "purchase" : "usage";
        listEl.innerHTML = filtered2.map((rec) => {
          const isVoid = rec.status === "void";
          let label;
          if (kind === "purchase") {
            label = `進貨 +${rec.qty}（$${rec.amount}）`;
          } else if (rec.source === "return") {
            label = `退貨回補 +${rec.qty}`;
          } else {
            label = `領用 -${rec.qty}${rec.source === "order" ? "（出貨自動）" : ""}`;
          }
          return `
            <div style="padding:10px 0;border-bottom:1px solid var(--paper-line);${isVoid ? "opacity:0.5;" : ""}">
              <div style="display:flex;justify-content:space-between;">
                <span style="font-size:14px;">${rec.date} · ${label}${isVoid ? "（已作廢）" : ""}</span>
                ${!isVoid && canVoid() ? `<button class="btn btn-secondary" data-void="${kind}:${rec.id}" style="padding:3px 10px;font-size:12px;">作廢</button>` : ""}
                ${isVoid && canDelete() ? `<button class="btn btn-danger" data-delete="${kind}:${rec.id}" style="padding:3px 10px;font-size:12px;">刪除</button>` : ""}
              </div>
              ${rec.note ? `<div class="hint">${rec.note}</div>` : ""}
              <div class="hint" data-resolve-email="${rec.createdBy || ""}">${rec.createdByName || rec.createdBy || ""}</div>
            </div>
          `;
        }).join("");
        wireNameResolution(listEl);

        listEl.querySelectorAll("[data-void]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const [k, id] = btn.getAttribute("data-void").split(":");
            if (!await confirmDialog("確定要作廢這筆記錄嗎？")) return;
            try {
              await voidRecord(k, id);
              showToast("已作廢", "success");
              await loadData();
              renderDetailView(itemId);
            } catch (err) {
              showToast("失敗：" + friendlyErrorMessage(err), "error");
            }
          });
        });
        listEl.querySelectorAll("[data-delete]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const [k, id] = btn.getAttribute("data-delete").split(":");
            if (!await confirmDialog("確定要永久刪除這筆記錄嗎？這個動作無法復原。", { confirmLabel: "刪除", danger: true })) return;
            try {
              await permanentlyDelete(k, id);
              showToast("已刪除", "success");
              await loadData();
              renderDetailView(itemId);
            } catch (err) {
              showToast("失敗：" + friendlyErrorMessage(err), "error");
            }
          });
        });
      }
    }

    renderTabButtons();
    renderTabContent();
  }

  // ============================================================
  // 新增 / 編輯項目
  // ============================================================
  function openItemModal(item = null) {
    const isEdit = !!item;
    const initialType = item?.type || "self_made";
    // 配方可以選「包材」或「其他自製商品」（例如禮盒裡面裝了哪些單顆
    // 商品），但不能選自己——排除自己是為了避免最單純的「直接自我引用」
    // 這種一眼就看得出來的循環設定；更深層的循環（A用到B、B又用到A）
    // 這裡沒辦法完全防住，交給 calcItemCost 算成本時的循環偵測機制擋下來。
    const recipeOptions = items.filter((i) =>
      (i.type === "packaging" || i.type === "self_made") &&
      i.status !== "archived" &&
      i.id !== item?.id
    );
    let recipeRows = isEdit && item.type === "self_made"
      ? (item.recipe || []).map((r) => ({ itemId: r.itemId, qty: r.qty, excludePackaging: !!r.excludePackaging }))
      : [{ itemId: "", qty: 1 }];

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯項目" : "新增項目"}</h3>

      <div style="text-align:center;margin-bottom:16px;">
        <div id="photo-box" style="width:112px;height:112px;border-radius:14px;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-direction:column;">
          ${item?.photoUrl
            ? `<img src="${item.photoUrl}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="color:var(--text-muted);">${iconHtml("camera", "--icon-size:28px;")}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">點擊上傳</div>`
          }
        </div>
        ${item?.photoUrl ? `
          <div style="display:flex;gap:12px;justify-content:center;margin-top:6px;">
            <button type="button" id="photo-change" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">更換照片</button>
            <button type="button" id="photo-view" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">放大看照片</button>
          </div>
        ` : ""}
        <input type="file" accept="image/*" id="m-photo-input" style="display:none;" />
      </div>

      <div class="field"><label>名稱</label><input type="text" id="m-name" value="${item?.name || ""}" /></div>
      <div class="field">
        <label>類型</label>
        ${isEdit
          ? `<div class="hint" style="margin-bottom:0;">${TYPE_LABELS[item.type]}（建立後不能改類型）</div>`
          : `<select id="m-type">
              <option value="self_made">自製商品</option>
              <option value="resale">現貨商品</option>
              <option value="packaging">包材</option>
            </select>`
        }
        <div class="hint" id="m-type-hint">${TYPE_HINTS[initialType]}</div>
      </div>
      <div class="field"><label>分類（選填）</label>
        <select id="m-category">
          <option value="">不分類</option>
          ${(categoriesByType[initialType] || []).map((c) => `<option value="${c.name}" ${c.name === item?.category ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        <div class="hint" id="m-category-empty-hint" style="display:${(categoriesByType[initialType] || []).length === 0 ? "block" : "none"};">這個類型還沒有建立任何分類，可以到「系統設定 → 分類管理」新增。</div>
      </div>

      <div class="field" id="m-price-field" style="display:${ORDERABLE_TYPES.includes(initialType) ? "block" : "none"};">
        <label>售價</label><input type="number" id="m-price" value="${item?.price ?? ""}" />
      </div>

      <div id="m-recipe-section" style="display:${initialType === "self_made" ? "block" : "none"};">
        <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin-bottom:6px;">配方（選填，可以列包材，也可以列其他自製商品——例如禮盒裡裝了哪些單顆商品）</label>
        <div style="display:flex;gap:6px;padding:0 2px;margin-bottom:4px;">
          <div style="flex:2;font-size:12px;color:var(--text-muted);">包材／自製商品</div>
          <div style="width:80px;font-size:12px;color:var(--text-muted);">用幾個</div>
        </div>
        <div id="m-recipe-rows"></div>
        <button class="btn btn-secondary" id="m-add-recipe" type="button" style="margin:8px 0 14px;">+ 新增一項包材</button>
      </div>

      <div class="field" id="m-unit-field" style="display:${STOCK_TRACKED_TYPES.includes(initialType) ? "block" : "none"};">
        <label>數量單位</label>
        <select id="m-unit">${unitOptions(item?.unit)}</select>
        ${units.length === 0 ? `<div class="hint">尚未建立任何單位，可以到「系統設定 → 單位管理」新增。</div>` : ""}
      </div>

      <div class="field" id="m-threshold-field" style="display:${STOCK_TRACKED_TYPES.includes(initialType) ? "block" : "none"};">
        <label>低庫存提醒門檻（選填）</label><input type="number" id="m-threshold" value="${item?.lowStockThreshold || ""}" />
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="m-save">儲存</button>
      </div>
    `);

    function syncTypeFields(type) {
      overlay.querySelector("#m-price-field").style.display = ORDERABLE_TYPES.includes(type) ? "block" : "none";
      overlay.querySelector("#m-recipe-section").style.display = type === "self_made" ? "block" : "none";
      overlay.querySelector("#m-unit-field").style.display = STOCK_TRACKED_TYPES.includes(type) ? "block" : "none";
      overlay.querySelector("#m-threshold-field").style.display = STOCK_TRACKED_TYPES.includes(type) ? "block" : "none";
      overlay.querySelector("#m-type-hint").textContent = TYPE_HINTS[type];
      const catList = categoriesByType[type] || [];
      overlay.querySelector("#m-category").innerHTML = `<option value="">不分類</option>` + catList.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
      overlay.querySelector("#m-category-empty-hint").style.display = catList.length === 0 ? "block" : "none";
    }
    if (!isEdit) {
      overlay.querySelector("#m-type").addEventListener("change", (e) => syncTypeFields(e.target.value));
    }

    function renderRecipeRows() {
      const rowsEl = overlay.querySelector("#m-recipe-rows");
      if (!rowsEl) return;
      rowsEl.innerHTML = recipeRows.map((r, idx) => {
        const comp = recipeOptions.find((i) => i.id === r.itemId);
        const compLabel = comp ? `${comp.name}${comp.type === "self_made" ? "（自製）" : ""}` : "點選項目";
        const isSelfMade = comp?.type === "self_made";
        return `
          <div style="margin-bottom:10px;" data-rrow="${idx}">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="r-item-btn picker-trigger compact" style="flex:2;">${compLabel}</button>
              <input type="number" class="r-qty" placeholder="用量" value="${r.qty}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              ${recipeRows.length > 1 ? `<button class="btn btn-danger r-remove" type="button" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
            </div>
            ${isSelfMade ? `
              <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;color:var(--text-muted);cursor:pointer;">
                <input type="checkbox" class="r-exclude-packaging" ${r.excludePackaging ? "checked" : ""} style="width:16px;height:16px;" />
                散裝，不算它自己的包材
              </label>
            ` : ""}
          </div>
        `;
      }).join("");
      rowsEl.querySelectorAll("[data-rrow]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-rrow"));
        rowEl.querySelector(".r-item-btn").addEventListener("click", () => {
          openSearchPicker({
            title: "選擇包材或自製商品",
            items: recipeOptions,
            renderLabel: (i) => i.name,
            renderSub: (i) => i.type === "self_made" ? "自製商品" : `包材・庫存 ${computeStock(i)} ${i.unit || "個"}`,
            renderThumb: (i) => i.photoUrl || null,
            emptyText: "還沒有可以選的包材或自製商品，請先新增",
            onSelect: (i) => {
              recipeRows[idx].itemId = i.id;
              if (i.type !== "self_made") recipeRows[idx].excludePackaging = false; // 改選包材的話，這個設定沒意義，重置掉
              renderRecipeRows();
            },
          });
        });
        rowEl.querySelector(".r-qty").addEventListener("input", (e) => recipeRows[idx].qty = Number(e.target.value));
        rowEl.querySelector(".r-exclude-packaging")?.addEventListener("change", (e) => {
          recipeRows[idx].excludePackaging = e.target.checked;
        });
        const rmBtn = rowEl.querySelector(".r-remove");
        if (rmBtn) rmBtn.addEventListener("click", () => { recipeRows.splice(idx, 1); renderRecipeRows(); });
      });
    }
    renderRecipeRows();
    overlay.querySelector("#m-add-recipe")?.addEventListener("click", () => {
      recipeRows.push({ itemId: "", qty: 1 });
      renderRecipeRows();
    });

    let uploadedPhotoUrl = item?.photoUrl || "";
    const photoBox = overlay.querySelector("#photo-box");
    const photoInput = overlay.querySelector("#m-photo-input");
    photoBox.addEventListener("click", () => photoInput.click());
    overlay.querySelector("#photo-view")?.addEventListener("click", () => openImageLightbox(item.photoUrl));
    overlay.querySelector("#photo-change")?.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBox.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">上傳中…</div>`;
      try {
        // 不在這裡自己先查一次 Cloudinary 設定再檢查——uploadImageToCloudinary
        // 內部本來就會查、也會檢查，多查一次除了浪費一次資料庫請求，
        // 手機網路不穩時還多一個環節可能出錯（曾經在手機上出現過
        // 「明明有設定卻被當作沒設定」的情況，拿掉這次重複查詢就穩定了）。
        uploadedPhotoUrl = await uploadImageToCloudinary(file);
        photoBox.innerHTML = `<img src="${uploadedPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) {
        showToast("照片上傳失敗：" + friendlyErrorMessage(err), "error");
        photoBox.innerHTML = `<div style="color:var(--text-muted);">${iconHtml("camera", "--icon-size:28px;")}</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">點擊上傳</div>`;
      }
    });

    overlay.querySelector("#m-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const name = overlay.querySelector("#m-name").value.trim();
      if (!name) { showToast("請輸入名稱", "error"); return; }
      const type = isEdit ? item.type : overlay.querySelector("#m-type").value;

      if (ORDERABLE_TYPES.includes(type) && !overlay.querySelector("#m-price").value) {
        showToast("請輸入售價", "error"); return;
      }

      if (!isEdit) {
        const dup = items.find((i) => i.status !== "archived" && (i.name || "").trim().toLowerCase() === name.toLowerCase());
        if (dup) {
          const proceed = await confirmDialog(`已經有一筆叫「${dup.name}」的項目了（${TYPE_LABELS[dup.type]}），確定要繼續新增嗎？`, { confirmLabel: "繼續新增" });
          if (!proceed) return;
        }
      }

      const data = {
        name,
        category: overlay.querySelector("#m-category").value,
        photoUrl: uploadedPhotoUrl,
        price: overlay.querySelector("#m-price")?.value,
        recipe: recipeRows.filter((r) => r.itemId && r.qty > 0),
        unit: overlay.querySelector("#m-unit")?.value,
        lowStockThreshold: overlay.querySelector("#m-threshold")?.value,
      };

      btn.disabled = true;
      try {
        if (isEdit) await updateItem(item.id, data, type);
        else await createItem({ ...data, type });
        showToast("已儲存", "success");
        overlay.remove();
        await loadData();
        if (isEdit) renderDetailView(item.id);
        else renderList();
      } catch (err) {
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });

  }

  // ============================================================
  // 採購登記（批次）
  // ============================================================
  function openPurchaseModal() {
    let rows = [{ itemId: "", qty: "", amount: "", note: "" }];
    const purchasable = items.filter((i) => STOCK_TRACKED_TYPES.includes(i.type) && i.status !== "archived");
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">採購登記</h3>
      <div class="field"><label>日期</label><input type="date" id="p-date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div style="display:flex;gap:6px;padding:0 2px;margin-bottom:4px;">
        <div style="flex:2;font-size:12px;color:var(--text-muted);">項目</div>
        <div style="width:80px;font-size:12px;color:var(--text-muted);">數量</div>
        <div style="width:90px;font-size:12px;color:var(--text-muted);">金額</div>
      </div>
      <div id="p-rows"></div>
      <button class="btn btn-secondary" id="p-add-row" style="margin:8px 0;">+ 新增一列</button>
      <div class="field"><label>運費（選填，會依數量分攤到各項目）</label><input type="number" id="p-freight" value="0" /></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-primary" id="p-submit">送出，一次登記完成</button>
      </div>
    `);

    function renderRows() {
      const rowsEl = overlay.querySelector("#p-rows");
      rowsEl.innerHTML = rows.map((r, idx) => {
        const item = purchasable.find((i) => i.id === r.itemId);
        return `
          <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;" data-row="${idx}">
            <button type="button" class="row-item-btn picker-trigger compact" style="flex:2;">${item ? item.name : "選擇項目"}</button>
            <input type="number" class="row-qty" placeholder="數量" value="${r.qty}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
            <input type="number" class="row-amount" placeholder="金額" value="${r.amount}" style="width:90px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
            ${rows.length > 1 ? `<button class="btn btn-danger row-remove" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
          </div>
          ${item ? `<div class="hint" style="margin:-4px 0 8px;">目前庫存 ${computeStock(item)} ${item.unit || "個"} · 均價 $${computeAvgCost(item).toFixed(2)}</div>` : ""}
        `;
      }).join("");

      rowsEl.querySelectorAll("[data-row]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-row"));
        rowEl.querySelector(".row-item-btn").addEventListener("click", () => {
          openSearchPicker({
            title: "選擇項目",
            items: purchasable,
            renderLabel: (i) => i.name,
            renderSub: (i) => `${TYPE_LABELS[i.type]} · 目前庫存 ${computeStock(i)} ${i.unit || "個"}`,
            renderThumb: (i) => i.photoUrl || null,
            emptyText: "沒有可採購的項目",
            onSelect: (i) => { rows[idx].itemId = i.id; renderRows(); },
          });
        });
        rowEl.querySelector(".row-qty").addEventListener("input", (e) => rows[idx].qty = e.target.value);
        rowEl.querySelector(".row-amount").addEventListener("input", (e) => rows[idx].amount = e.target.value);
        const removeBtn = rowEl.querySelector(".row-remove");
        if (removeBtn) removeBtn.addEventListener("click", () => { rows.splice(idx, 1); renderRows(); });
      });
    }
    renderRows();

    overlay.querySelector("#p-add-row").addEventListener("click", () => {
      rows.push({ itemId: "", qty: "", amount: "", note: "" });
      renderRows();
    });
    overlay.querySelector("#p-submit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const validRows = rows.filter((r) => r.itemId && Number(r.qty) > 0);
      if (validRows.length === 0) { showToast("請至少填一列", "error"); return; }
      btn.disabled = true;
      try {
        await addPurchaseBatch(validRows, {
          date: overlay.querySelector("#p-date").value,
          freightTotal: Number(overlay.querySelector("#p-freight").value || 0),
        });
        showToast("採購登記完成", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });
  }

  // ============================================================
  // 盤點
  // ============================================================
  function openStocktakeModal() {
    const stocktakable = items.filter((i) => STOCK_TRACKED_TYPES.includes(i.type) && i.status !== "archived");
    if (stocktakable.length === 0) {
      showToast("沒有可以盤點的項目", "error");
      return;
    }
    let selectedItem = null;
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">盤點</h3>
      <div class="field"><label>項目</label>
        <button type="button" id="s-item-btn" class="picker-trigger">點選項目</button>
      </div>
      <div class="field"><label>實際盤點數量</label><input type="number" id="s-counted" /></div>
      <div id="s-preview"></div>
      <div class="field"><label>備註（選填）</label><textarea id="s-note" rows="3" style="resize:vertical;"></textarea></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="s-submit">確認校正</button>
      </div>
    `);

    function updatePreview() {
      const previewEl = overlay.querySelector("#s-preview");
      const counted = overlay.querySelector("#s-counted").value;
      if (!selectedItem || counted === "") { previewEl.innerHTML = ""; return; }
      const systemQty = computeStock(selectedItem);
      const diff = Number(counted) - systemQty;
      if (diff === 0) {
        previewEl.innerHTML = `<div class="hint" style="margin-bottom:10px;">跟系統數量一致，沒有差異。</div>`;
      } else if (diff > 0) {
        previewEl.innerHTML = `<div class="hint" style="margin-bottom:10px;color:var(--jade);">比系統多 ${diff} 個。</div>`;
      } else {
        const lossAmount = Math.abs(diff) * computeAvgCost(selectedItem);
        previewEl.innerHTML = `
          <div class="hint" style="margin-bottom:6px;color:var(--rose);">比系統少 ${Math.abs(diff)} 個，用均價估算損失 $${lossAmount.toFixed(0)}。</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--ink);margin-bottom:10px;cursor:pointer;">
            <input type="checkbox" id="s-record-loss" checked style="width:16px;height:16px;" />
            自動記一筆「存貨報廢」支出（損益表會反映這筆損失）
          </label>
        `;
      }
    }

    overlay.querySelector("#s-item-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇項目",
        items: stocktakable,
        renderLabel: (i) => i.name,
        renderSub: (i) => `${TYPE_LABELS[i.type]} · 系統目前：${computeStock(i)} ${i.unit || "個"}`,
        renderThumb: (i) => i.photoUrl || null,
        onSelect: (i) => { selectedItem = i; overlay.querySelector("#s-item-btn").textContent = i.name; updatePreview(); },
      });
    });
    overlay.querySelector("#s-counted").addEventListener("input", updatePreview);

    overlay.querySelector("#s-submit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const counted = overlay.querySelector("#s-counted").value;
      if (!selectedItem) { showToast("請選擇項目", "error"); return; }
      if (counted === "") { showToast("請輸入盤點數量", "error"); return; }
      const recordLossCb = overlay.querySelector("#s-record-loss");
      const recordLoss = recordLossCb ? recordLossCb.checked : true;
      btn.disabled = true;
      try {
        const result = await stocktakeAdjust({ itemId: selectedItem.id, countedQty: counted, note: overlay.querySelector("#s-note").value, recordLoss });
        showToast(result.lossAmount > 0 ? `已校正庫存，並記錄 $${result.lossAmount.toFixed(0)} 報廢損失` : "已校正庫存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });
  }

  // 報廢/損耗登記：只填數量，系統自動用均價算損失金額
  function openDisposeModal() {
    const disposable = items.filter((i) => STOCK_TRACKED_TYPES.includes(i.type) && i.status !== "archived" && computeStock(i) > 0);
    if (disposable.length === 0) {
      showToast("沒有庫存大於 0 的項目可以報廢", "error");
      return;
    }
    let selectedItem = null;
    const overlay = openModal(`
      <h3 style="margin-bottom:4px;">報廢/損耗登記</h3>
      <div class="hint" style="margin-bottom:16px;">東西真的壞了、丟了、不是賣掉的，才用這個。</div>
      <div class="field"><label>項目</label>
        <button type="button" id="d-item-btn" class="picker-trigger">點選項目</button>
      </div>
      <div class="field"><label>報廢數量</label><input type="number" id="d-qty" /></div>
      <div id="d-preview"></div>
      <div class="field"><label>備註（選填）</label><textarea id="d-note" rows="3" style="resize:vertical;" placeholder="例如：受潮壞掉"></textarea></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-danger" id="d-submit">確認報廢</button>
      </div>
    `);

    function updateDisposePreview() {
      const previewEl = overlay.querySelector("#d-preview");
      const qty = overlay.querySelector("#d-qty").value;
      if (!selectedItem || qty === "" || Number(qty) <= 0) { previewEl.innerHTML = ""; return; }
      const lossAmount = Number(qty) * computeAvgCost(selectedItem);
      previewEl.innerHTML = `<div class="hint" style="margin-bottom:10px;color:var(--rose);">用均價估算，這筆會記錄 $${lossAmount.toFixed(0)} 的存貨報廢損失。</div>`;
    }

    overlay.querySelector("#d-item-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇項目",
        items: disposable,
        renderLabel: (i) => i.name,
        renderSub: (i) => `${TYPE_LABELS[i.type]} · 目前庫存：${computeStock(i)} ${i.unit || "個"}`,
        renderThumb: (i) => i.photoUrl || null,
        onSelect: (i) => { selectedItem = i; overlay.querySelector("#d-item-btn").textContent = i.name; updateDisposePreview(); },
      });
    });
    overlay.querySelector("#d-qty").addEventListener("input", updateDisposePreview);

    overlay.querySelector("#d-submit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const qty = overlay.querySelector("#d-qty").value;
      if (!selectedItem) { showToast("請選擇項目", "error"); return; }
      if (qty === "" || Number(qty) <= 0) { showToast("請輸入報廢數量", "error"); return; }
      btn.disabled = true;
      try {
        const lossAmount = await disposeStock({ itemId: selectedItem.id, qty: Number(qty), note: overlay.querySelector("#d-note").value });
        showToast(`已登記報廢，記錄 $${lossAmount.toFixed(0)} 損失`, "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });
  }

  await loadData();
  await renderListView();
}
