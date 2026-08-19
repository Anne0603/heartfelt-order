// ============================================================
// 採購與庫存頁面 UI
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import {
  listItems, createItem, updateItem, setItemArchived,
  addPurchaseBatch, stocktakeAdjust,
  listPurchases, listUsages, listStocktakes,
  voidRecord, permanentlyDelete,
  computeStock, computeAvgCost, buildItemsIndex,
} from "./inventory.js";
import { listCategories } from "./categories.js";
import { openModal } from "./modal-ui.js";

const TYPE_LABELS = { packaging: "包材", bundle: "組合包", resale: "現貨商品" };

function canWrite() {
  const r = currentSession.member?.role;
  return ["superadmin", "admin", "order_staff"].includes(r);
}
function canVoid() {
  const r = currentSession.member?.role;
  return ["superadmin", "admin"].includes(r);
}
function canDelete() {
  return currentSession.member?.role === "superadmin";
}

export async function renderInventoryPage(container) {
  let items = [];
  let itemsById = new Map();
  let inventoryCategories = [];
  let filterType = "all";
  let searchText = "";
  let showArchived = false;

  container.innerHTML = `
    <div class="page-header">
      <h2>採購與庫存</h2>
      ${canWrite() ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-open-stocktake">盤點</button>
          <button class="btn btn-primary" id="btn-open-purchase">採購登記</button>
          <button class="btn btn-primary" id="btn-open-new-item">新增項目</button>
        </div>
      ` : ""}
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋名稱" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <select id="filter-type" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;">
          <option value="all">全部類型</option>
          <option value="packaging">包材</option>
          <option value="bundle">組合包</option>
          <option value="resale">現貨商品</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text-muted);">
          <input type="checkbox" id="show-archived" /> 顯示已停用
        </label>
      </div>
    </div>
    <div id="items-list"></div>
  `;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-type").addEventListener("change", (e) => {
    filterType = e.target.value;
    renderList();
  });
  container.querySelector("#show-archived").addEventListener("change", async (e) => {
    showArchived = e.target.checked;
    await reload();
  });

  if (canWrite()) {
    container.querySelector("#btn-open-new-item").addEventListener("click", () => openItemModal());
    container.querySelector("#btn-open-purchase").addEventListener("click", () => openPurchaseModal());
    container.querySelector("#btn-open-stocktake").addEventListener("click", () => openStocktakeModal());
  }

  async function reload() {
    const listEl = container.querySelector("#items-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      items = await listItems({ includeArchived: showArchived });
      itemsById = buildItemsIndex(items);
      inventoryCategories = await listCategories("inventory");
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#items-list");
    let filtered = items;
    if (filterType !== "all") filtered = filtered.filter((i) => i.type === filterType);
    if (searchText) filtered = filtered.filter((i) => (i.name || "").toLowerCase().includes(searchText));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有項目</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((item) => {
      const stock = computeStock(item, itemsById);
      const avgCost = computeAvgCost(item, itemsById);
      const isLow = item.lowStockThreshold > 0 && stock <= item.lowStockThreshold;
      const isArchived = item.status === "archived";
      const isBundle = item.type === "bundle";
      return `
        <div class="card" style="margin-bottom:10px;${isArchived ? "opacity:0.55;" : ""}" data-item-row="${item.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:16px;color:var(--ink);">${item.name} ${isArchived ? `<span class="hint">(已停用)</span>` : ""}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[item.type] || item.type}${item.category ? " · " + item.category : ""}</div>
              ${isBundle ? `<div class="hint" style="margin-top:4px;">內含：${(item.components || []).map(c => `${itemsById.get(c.itemId)?.name || "?"} x${c.qty}`).join("、")}</div>` : ""}
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:${isLow ? "var(--rose)" : "var(--ink)"};">${stock}${isBundle ? "（可組）" : ""}</div>
              <div style="font-size:12px;color:var(--text-muted);">均價 $${avgCost.toFixed(2)}</div>
            </div>
          </div>
          ${isLow ? `<div class="seal-badge bad" style="margin-top:8px;"><span class="dot"></span>低於庫存門檻(${item.lowStockThreshold})</div>` : ""}
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            ${!isBundle ? `<button class="btn btn-secondary" data-detail="${item.id}" style="padding:7px 14px;font-size:13px;">記錄</button>` : ""}
            ${canWrite() ? `<button class="btn btn-secondary" data-edit="${item.id}" style="padding:7px 14px;font-size:13px;">編輯</button>` : ""}
            ${canWrite() ? `<button class="btn btn-secondary" data-archive="${item.id}" style="padding:7px 14px;font-size:13px;">${isArchived ? "恢復使用" : "停用"}</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => openDetailModal(btn.getAttribute("data-detail")));
    });
    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((i) => i.id === btn.getAttribute("data-edit"));
        openItemModal(item);
      });
    });
    listEl.querySelectorAll("[data-archive]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = items.find((i) => i.id === btn.getAttribute("data-archive"));
        const willArchive = item.status !== "archived";
        if (willArchive && !confirm(`確定要停用「${item.name}」嗎？`)) return;
        try {
          await setItemArchived(item.id, willArchive);
          showToast(willArchive ? "已停用" : "已恢復使用", "success");
          await reload();
        } catch (err) {
          showToast("操作失敗：" + err.message, "error");
        }
      });
    });
  }

  // ---------- 新增/編輯項目 ----------
  function openItemModal(item = null) {
    const isEdit = !!item;
    let componentRows = isEdit && item.type === "bundle"
      ? (item.components || []).map((c) => ({ itemId: c.itemId, qty: c.qty }))
      : [{ itemId: "", qty: 1 }];

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯項目" : "新增項目"}</h3>
      <div class="field"><label>名稱</label><input type="text" id="m-name" value="${item?.name || ""}" /></div>
      ${!isEdit ? `
        <div class="field"><label>類型</label>
          <select id="m-type">
            <option value="packaging">包材（單一項目）</option>
            <option value="bundle">組合包（由好幾種包材組成，例如禮盒）</option>
            <option value="resale">現貨商品（進貨轉賣）</option>
          </select>
        </div>
      ` : `<div class="hint" style="margin-bottom:14px;">類型：${TYPE_LABELS[item.type]}（建立後不能改類型）</div>`}
      <div class="field"><label>分類（選填）</label>
        <select id="m-category">
          <option value="">不分類</option>
          ${inventoryCategories.map((c) => `<option value="${c.name}" ${c.name === item?.category ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        ${inventoryCategories.length === 0 ? `<div class="hint">尚未建立任何分類，可以到「系統設定 → 分類管理」新增。</div>` : ""}
      </div>
      <div id="m-bundle-section" style="display:${(isEdit ? item.type : "packaging") === "bundle" ? "block" : "none"};">
        <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin-bottom:6px;">組成內容</label>
        <div id="m-component-rows"></div>
        <button class="btn btn-secondary" id="m-add-component" type="button" style="margin:6px 0 14px;">+ 新增一項</button>
      </div>
      <div class="field" id="m-threshold-field"><label>低庫存提醒門檻（選填）</label><input type="number" id="m-threshold" value="${item?.lowStockThreshold || ""}" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-primary" id="m-save">儲存</button>
      </div>
    `);

    const nonBundleItems = items.filter((i) => i.type !== "bundle" && i.status !== "archived");
    function componentItemOptions(selected) {
      return `<option value="">選擇包材</option>` + nonBundleItems.map((i) =>
        `<option value="${i.id}" ${i.id === selected ? "selected" : ""}>${i.name}</option>`
      ).join("");
    }
    function renderComponentRows() {
      const rowsEl = overlay.querySelector("#m-component-rows");
      rowsEl.innerHTML = componentRows.map((r, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:8px;" data-crow="${idx}">
          <select class="c-item" style="flex:2;padding:8px;border:1px solid var(--paper-line);border-radius:8px;">${componentItemOptions(r.itemId)}</select>
          <input type="number" class="c-qty" placeholder="用量" value="${r.qty}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
          ${componentRows.length > 1 ? `<button class="btn btn-danger c-remove" type="button" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
        </div>
      `).join("");
      rowsEl.querySelectorAll("[data-crow]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-crow"));
        rowEl.querySelector(".c-item").addEventListener("change", (e) => componentRows[idx].itemId = e.target.value);
        rowEl.querySelector(".c-qty").addEventListener("input", (e) => componentRows[idx].qty = Number(e.target.value));
        const rmBtn = rowEl.querySelector(".c-remove");
        if (rmBtn) rmBtn.addEventListener("click", () => { componentRows.splice(idx, 1); renderComponentRows(); });
      });
    }
    renderComponentRows();

    if (!isEdit) {
      overlay.querySelector("#m-type").addEventListener("change", (e) => {
        const isBundleType = e.target.value === "bundle";
        overlay.querySelector("#m-bundle-section").style.display = isBundleType ? "block" : "none";
        overlay.querySelector("#m-threshold-field").style.display = isBundleType ? "none" : "block";
      });
    } else if (item.type === "bundle") {
      overlay.querySelector("#m-threshold-field").style.display = "none";
    }

    overlay.querySelector("#m-add-component").addEventListener("click", () => {
      componentRows.push({ itemId: "", qty: 1 });
      renderComponentRows();
    });
    overlay.querySelector("#m-save").addEventListener("click", async () => {
      const name = overlay.querySelector("#m-name").value.trim();
      const category = overlay.querySelector("#m-category").value;
      const threshold = overlay.querySelector("#m-threshold")?.value;
      if (!name) { showToast("請輸入名稱", "error"); return; }
      const type = isEdit ? item.type : overlay.querySelector("#m-type").value;
      const validComponents = componentRows.filter((r) => r.itemId && r.qty > 0);
      if (type === "bundle" && validComponents.length === 0) {
        showToast("組合包至少要選一項組成內容", "error");
        return;
      }
      try {
        if (isEdit) {
          await updateItem(item.id, { name, category, lowStockThreshold: threshold, components: validComponents, type });
        } else {
          await createItem({ name, type, category, lowStockThreshold: threshold, components: validComponents });
        }
        showToast("已儲存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
      }
    });
  }

  // ---------- 採購登記（批次，只能選 packaging / resale） ----------
  function openPurchaseModal() {
    let rows = [{ itemId: "", qty: "", amount: "", note: "" }];
    const purchasable = items.filter((i) => i.type !== "bundle" && i.status !== "archived");
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">採購登記</h3>
      <div class="field"><label>日期</label><input type="text" id="p-date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div id="p-rows"></div>
      <button class="btn btn-secondary" id="p-add-row" style="margin:8px 0;">+ 新增一列</button>
      <div class="field"><label>運費（選填，會依數量分攤到各項目）</label><input type="number" id="p-freight" value="0" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-primary" id="p-submit">送出，一次登記完成</button>
      </div>
    `);

    function itemOptions(selected) {
      return `<option value="">選擇項目</option>` + purchasable.map((i) =>
        `<option value="${i.id}" ${i.id === selected ? "selected" : ""}>${i.name}</option>`
      ).join("");
    }

    function renderRows() {
      const rowsEl = overlay.querySelector("#p-rows");
      rowsEl.innerHTML = rows.map((r, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;" data-row="${idx}">
          <select class="row-item" style="flex:2;padding:8px;border:1px solid var(--paper-line);border-radius:8px;">${itemOptions(r.itemId)}</select>
          <input type="number" class="row-qty" placeholder="數量" value="${r.qty}" style="flex:1;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
          <input type="number" class="row-amount" placeholder="金額" value="${r.amount}" style="flex:1;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
          ${rows.length > 1 ? `<button class="btn btn-danger row-remove" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
        </div>
      `).join("");

      rowsEl.querySelectorAll("[data-row]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-row"));
        rowEl.querySelector(".row-item").addEventListener("change", (e) => rows[idx].itemId = e.target.value);
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
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 盤點（只能選 packaging / resale） ----------
  function openStocktakeModal() {
    const stocktakable = items.filter((i) => i.type !== "bundle" && i.status !== "archived");
    if (stocktakable.length === 0) {
      showToast("沒有可以盤點的項目", "error");
      return;
    }
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">盤點</h3>
      <div class="field"><label>項目</label>
        <select id="s-item">${stocktakable.map((i) => `<option value="${i.id}">${i.name}（系統目前：${computeStock(i, itemsById)}）</option>`).join("")}</select>
      </div>
      <div class="field"><label>實際盤點數量</label><input type="number" id="s-counted" /></div>
      <div class="field"><label>備註（選填）</label><input type="text" id="s-note" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-primary" id="s-submit">確認校正</button>
      </div>
    `);
    overlay.querySelector("#s-submit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const itemId = overlay.querySelector("#s-item").value;
      const counted = overlay.querySelector("#s-counted").value;
      if (counted === "") { showToast("請輸入盤點數量", "error"); return; }
      btn.disabled = true;
      try {
        await stocktakeAdjust({ itemId, countedQty: counted, note: overlay.querySelector("#s-note").value });
        showToast("已校正庫存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 詳細記錄 ----------
  async function openDetailModal(itemId) {
    const item = items.find((i) => i.id === itemId);
    const overlay = openModal(`<div style="color:var(--text-muted);">載入中…</div>`);
    const [purchases, usages, stocktakes] = await Promise.all([
      listPurchases(itemId), listUsages(itemId), listStocktakes(itemId),
    ]);

    function recordRow(rec, kind) {
      const isVoid = rec.status === "void";
      const label = kind === "purchase" ? `進貨 +${rec.qty}（$${rec.amount}）` : `領用 -${rec.qty}${rec.source === "order" ? "（出貨自動）" : ""}`;
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--paper-line);${isVoid ? "opacity:0.5;" : ""}">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:14px;">${rec.date} · ${label}${isVoid ? "（已作廢）" : ""}</span>
            ${!isVoid && canVoid() ? `<button class="btn btn-secondary" data-void="${kind}:${rec.id}" style="padding:3px 10px;font-size:12px;">作廢</button>` : ""}
            ${isVoid && canDelete() ? `<button class="btn btn-danger" data-delete="${kind}:${rec.id}" style="padding:3px 10px;font-size:12px;">刪除</button>` : ""}
          </div>
          ${rec.note ? `<div class="hint">${rec.note}</div>` : ""}
          <div class="hint">${rec.createdByName || rec.createdBy || ""}</div>
        </div>
      `;
    }

    overlay.querySelector("#modal-box").innerHTML = `
      <h3 style="margin-bottom:4px;">${item.name}</h3>
      <div class="hint" style="margin-bottom:14px;">目前庫存 ${computeStock(item, itemsById)} · 均價 $${computeAvgCost(item, itemsById).toFixed(2)}</div>
      <h4 style="font-size:13px;color:var(--text-muted);margin:14px 0 4px;">進貨記錄</h4>
      ${purchases.length ? purchases.map((r) => recordRow(r, "purchase")).join("") : `<div class="hint">尚無記錄</div>`}
      <h4 style="font-size:13px;color:var(--text-muted);margin:14px 0 4px;">領用記錄</h4>
      ${usages.length ? usages.map((r) => recordRow(r, "usage")).join("") : `<div class="hint">尚無記錄</div>`}
      <h4 style="font-size:13px;color:var(--text-muted);margin:14px 0 4px;">盤點記錄</h4>
      ${stocktakes.length ? stocktakes.map((s) => `
        <div style="padding:8px 0;border-bottom:1px solid var(--paper-line);">
          <div style="font-size:14px;">${s.date} · 盤點為 ${s.countedQty}（原 ${s.systemQtyBefore}，差 ${s.diff > 0 ? "+" : ""}${s.diff}）</div>
          ${s.note ? `<div class="hint">${s.note}</div>` : ""}
        </div>
      `).join("") : `<div class="hint">尚無記錄</div>`}
    `;
    overlay.querySelectorAll("[data-void]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [kind, id] = btn.getAttribute("data-void").split(":");
        if (!confirm("確定要作廢這筆記錄嗎？")) return;
        try {
          await voidRecord(kind, id);
          showToast("已作廢", "success");
          overlay.remove();
          await reload();
          openDetailModal(itemId);
        } catch (err) {
          showToast("失敗：" + err.message, "error");
        }
      });
    });
    overlay.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [kind, id] = btn.getAttribute("data-delete").split(":");
        if (!confirm("確定要永久刪除這筆記錄嗎？這個動作無法復原。")) return;
        try {
          await permanentlyDelete(kind, id);
          showToast("已刪除", "success");
          overlay.remove();
          await reload();
        } catch (err) {
          showToast("失敗：" + err.message, "error");
        }
      });
    });
  }

  await reload();
}
