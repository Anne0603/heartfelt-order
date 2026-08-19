// ============================================================
// 商品與庫存頁面 UI（合併版）
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import {
  listItems, createItem, updateItem, setItemArchived,
  addPurchaseBatch, stocktakeAdjust,
  listPurchases, listUsages, listStocktakes,
  voidRecord, permanentlyDelete,
  computeStock, computeAvgCost, calcItemCost, buildItemsIndex,
  TYPE_LABELS, ORDERABLE_TYPES, STOCK_TRACKED_TYPES,
} from "./items.js";
import { listCategories } from "./categories.js";
import { getCloudinarySettings, uploadImageToCloudinary } from "./settings.js";
import { openModal } from "./modal-ui.js";
import { openSearchPicker } from "./picker-ui.js";

const TYPE_HINTS = {
  self_made: "自己現做的東西，客戶可訂購。不追蹤庫存量，成本只算主料（原料/人工每月算在「利潤總覽」）。",
  resale: "直接進貨轉賣的東西，客戶可訂購。會追蹤庫存量與進貨均價。",
  packaging: "幕後消耗品（緞帶、盒子），客戶不會直接訂購，會追蹤庫存與均價。",
  bundle: "由好幾種包材組成的一組（例如禮盒），庫存/成本即時從組成的包材算出來，不用另外採購。",
};

function canSeeCost() {
  return ["superadmin", "admin", "viewer"].includes(currentSession.member?.role);
}
function canWrite() {
  return ["superadmin", "admin", "order_staff"].includes(currentSession.member?.role);
}
function canWriteType(type) {
  const r = currentSession.member?.role;
  if (["superadmin", "admin"].includes(r)) return true;
  if (r === "order_staff") return type !== "self_made"; // 自製商品的定價由管理員以上決定
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
  let categories = [];
  let filterType = initialFilter?.type || "all";
  let searchText = "";
  let showArchived = false;

  container.innerHTML = `
    <div class="page-header">
      <h2>商品與庫存</h2>
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
          <option value="self_made">自製商品</option>
          <option value="resale">現貨商品</option>
          <option value="packaging">包材</option>
          <option value="bundle">組合包</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text-muted);">
          <input type="checkbox" id="show-archived" /> 顯示已停用/下架
        </label>
      </div>
    </div>
    <div id="items-list"></div>
  `;

  container.querySelector("#filter-type").value = filterType;
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
      [items, categories] = await Promise.all([
        listItems({ includeArchived: showArchived }),
        listCategories("items"),
      ]);
      itemsById = buildItemsIndex(items);
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
      const isArchived = item.status === "archived";
      const isBundle = item.type === "bundle";
      const stock = computeStock(item, itemsById);
      const isLow = STOCK_TRACKED_TYPES.includes(item.type) && item.lowStockThreshold > 0 && stock <= item.lowStockThreshold;
      const calc = calcItemCost(item, itemsById);

      return `
        <div class="card" style="margin-bottom:10px;${isArchived ? "opacity:0.55;" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div style="display:flex;gap:12px;">
              ${item.photoUrl ? `<img src="${item.photoUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;">` : `<div style="width:44px;height:44px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`}
              <div>
                <div style="font-weight:700;font-size:16px;color:var(--ink);">${item.name} ${isArchived ? `<span class="hint">(已停用)</span>` : ""}</div>
                <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[item.type]}${item.category ? " · " + item.category : ""}</div>
                ${isBundle ? `<div class="hint" style="margin-top:4px;">內含：${(item.components || []).map(c => `${itemsById.get(c.itemId)?.name || "?"} x${c.qty}`).join("、")}</div>` : ""}
              </div>
            </div>
            <div style="text-align:right;">
              ${ORDERABLE_TYPES.includes(item.type) ? `<div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--ink);">$${item.price}</div>` : ""}
              ${STOCK_TRACKED_TYPES.includes(item.type) || isBundle ? `<div style="font-family:var(--font-mono);font-size:${ORDERABLE_TYPES.includes(item.type) ? "12px" : "18px"};font-weight:700;color:${isLow ? "var(--rose)" : "var(--ink)"};">庫存 ${stock}</div>` : ""}
              ${canSeeCost() && calc ? `<div style="font-size:12px;color:${calc.profit >= 0 ? "var(--jade)" : "var(--rose)"};">毛利 $${calc.profit.toFixed(1)}${calc.isFullCost ? "" : "*"}</div>` : ""}
            </div>
          </div>
          ${isLow ? `<div class="seal-badge bad" style="margin-top:8px;"><span class="dot"></span>低於庫存門檻(${item.lowStockThreshold})</div>` : ""}
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            ${canSeeCost() && calc ? `<button class="btn btn-secondary" data-costdetail="${item.id}" style="padding:7px 14px;font-size:13px;">成本明細</button>` : ""}
            ${STOCK_TRACKED_TYPES.includes(item.type) ? `<button class="btn btn-secondary" data-detail="${item.id}" style="padding:7px 14px;font-size:13px;">記錄</button>` : ""}
            ${canWriteType(item.type) ? `<button class="btn btn-secondary" data-edit="${item.id}" style="padding:7px 14px;font-size:13px;">編輯</button>` : ""}
            ${canWriteType(item.type) ? `<button class="btn btn-secondary" data-archive="${item.id}" style="padding:7px 14px;font-size:13px;">${isArchived ? "恢復使用" : "停用"}</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
    if (items.some((i) => i.type === "self_made") && canSeeCost()) {
      listEl.insertAdjacentHTML("beforeend", `<div class="hint" style="text-align:center;margin-top:6px;">* 自製商品的毛利未扣原料/人工，那些算在「利潤總覽」</div>`);
    }

    listEl.querySelectorAll("[data-costdetail]").forEach((btn) => {
      btn.addEventListener("click", () => openCostDetailModal(btn.getAttribute("data-costdetail")));
    });
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

  // ---------- 新增 / 編輯項目 ----------
  function openItemModal(item = null) {
    const isEdit = !!item;
    const initialType = item?.type || "self_made";
    let componentRows = isEdit && item.type === "bundle"
      ? (item.components || []).map((c) => ({ itemId: c.itemId, qty: c.qty }))
      : [{ itemId: "", qty: 1 }];
    let selectedMainItem = item?.mainItemId ? items.find((i) => i.id === item.mainItemId) : null;

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯項目" : "新增項目"}</h3>

      <div style="text-align:center;margin-bottom:16px;">
        <div id="photo-box" style="width:80px;height:80px;border-radius:12px;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-direction:column;">
          ${item?.photoUrl
            ? `<img src="${item.photoUrl}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="font-size:20px;">📷</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;">點擊上傳</div>`
          }
        </div>
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
              <option value="bundle">組合包</option>
            </select>`
        }
        <div class="hint" id="m-type-hint">${TYPE_HINTS[initialType]}</div>
      </div>
      <div class="field"><label>分類（選填）</label>
        <select id="m-category">
          <option value="">不分類</option>
          ${categories.map((c) => `<option value="${c.name}" ${c.name === item?.category ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        ${categories.length === 0 ? `<div class="hint">尚未建立任何分類，可以到「系統設定 → 分類管理」新增。</div>` : ""}
      </div>

      <div class="field" id="m-price-field" style="display:${ORDERABLE_TYPES.includes(initialType) ? "block" : "none"};">
        <label>售價</label><input type="number" id="m-price" value="${item?.price ?? ""}" />
      </div>

      <div class="field" id="m-mainitem-field" style="display:${initialType === "self_made" ? "block" : "none"};">
        <label>這個商品要扣哪個包材（選填）</label>
        <button type="button" id="m-main-item-btn" class="picker-trigger">${selectedMainItem ? selectedMainItem.name : "點選包材（不使用可略過）"}</button>
      </div>
      <div class="field" id="m-qty-field" style="display:${selectedMainItem ? "block" : "none"};">
        <label>用幾個</label>
        <input type="number" id="m-main-qty" value="${item?.mainItemQty || 1}" />
        <div class="hint">例如這個商品出貨一次要用掉 1 個緞帶，這裡就填 1。</div>
      </div>

      <div id="m-bundle-section" style="display:${initialType === "bundle" ? "block" : "none"};">
        <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin-bottom:6px;">組成內容</label>
        <div id="m-component-rows"></div>
        <button class="btn btn-secondary" id="m-add-component" type="button" style="margin:6px 0 14px;">+ 新增一項</button>
      </div>

      <div class="field" id="m-threshold-field" style="display:${STOCK_TRACKED_TYPES.includes(initialType) ? "block" : "none"};">
        <label>低庫存提醒門檻（選填）</label><input type="number" id="m-threshold" value="${item?.lowStockThreshold || ""}" />
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="m-save">儲存</button>
      </div>
    `);

    overlay.querySelectorAll(".picker-trigger").forEach((el) => {
      el.style.cssText = "width:100%;text-align:left;padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:15px;cursor:pointer;color:var(--text-primary);";
    });

    function syncTypeFields(type) {
      overlay.querySelector("#m-price-field").style.display = ORDERABLE_TYPES.includes(type) ? "block" : "none";
      overlay.querySelector("#m-mainitem-field").style.display = type === "self_made" ? "block" : "none";
      overlay.querySelector("#m-qty-field").style.display = (type === "self_made" && selectedMainItem) ? "block" : "none";
      overlay.querySelector("#m-bundle-section").style.display = type === "bundle" ? "block" : "none";
      overlay.querySelector("#m-threshold-field").style.display = STOCK_TRACKED_TYPES.includes(type) ? "block" : "none";
      overlay.querySelector("#m-type-hint").textContent = TYPE_HINTS[type];
    }
    if (!isEdit) {
      overlay.querySelector("#m-type").addEventListener("change", (e) => syncTypeFields(e.target.value));
    }

    const mainItemBtn = overlay.querySelector("#m-main-item-btn");
    if (mainItemBtn) {
      mainItemBtn.addEventListener("click", () => {
        const candidates = items.filter((i) => ["packaging", "bundle"].includes(i.type) && i.status !== "archived");
        openSearchPicker({
          title: "選擇包材",
          items: candidates,
          renderLabel: (i) => i.name,
          renderSub: (i) => TYPE_LABELS[i.type],
          emptyText: "還沒有任何包材，請先新增",
          onSelect: (i) => {
            selectedMainItem = i;
            mainItemBtn.textContent = i.name;
            overlay.querySelector("#m-qty-field").style.display = "block";
          },
        });
      });
    }

    // 組合包組件列
    const nonBundleItems = items.filter((i) => i.type === "packaging" && i.status !== "archived");
    function renderComponentRows() {
      const rowsEl = overlay.querySelector("#m-component-rows");
      if (!rowsEl) return;
      rowsEl.innerHTML = componentRows.map((r, idx) => {
        const comp = nonBundleItems.find((i) => i.id === r.itemId);
        return `
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;" data-crow="${idx}">
            <button type="button" class="c-item-btn picker-trigger" style="flex:2;padding:8px 10px;text-align:left;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:14px;cursor:pointer;">${comp ? comp.name : "點選包材"}</button>
            <input type="number" class="c-qty" placeholder="用量" value="${r.qty}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
            ${componentRows.length > 1 ? `<button class="btn btn-danger c-remove" type="button" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
          </div>
        `;
      }).join("");
      rowsEl.querySelectorAll("[data-crow]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-crow"));
        rowEl.querySelector(".c-item-btn").addEventListener("click", () => {
          openSearchPicker({
            title: "選擇包材",
            items: nonBundleItems,
            renderLabel: (i) => i.name,
            emptyText: "還沒有任何包材，請先新增",
            onSelect: (i) => { componentRows[idx].itemId = i.id; renderComponentRows(); },
          });
        });
        rowEl.querySelector(".c-qty").addEventListener("input", (e) => componentRows[idx].qty = Number(e.target.value));
        const rmBtn = rowEl.querySelector(".c-remove");
        if (rmBtn) rmBtn.addEventListener("click", () => { componentRows.splice(idx, 1); renderComponentRows(); });
      });
    }
    renderComponentRows();
    overlay.querySelector("#m-add-component")?.addEventListener("click", () => {
      componentRows.push({ itemId: "", qty: 1 });
      renderComponentRows();
    });

    let uploadedPhotoUrl = item?.photoUrl || "";
    const photoBox = overlay.querySelector("#photo-box");
    const photoInput = overlay.querySelector("#m-photo-input");
    photoBox.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBox.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">上傳中…</div>`;
      try {
        const cloud = await getCloudinarySettings();
        if (!cloud.cloudName || !cloud.uploadPreset) throw new Error("尚未設定 Cloudinary");
        uploadedPhotoUrl = await uploadImageToCloudinary(file);
        photoBox.innerHTML = `<img src="${uploadedPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) {
        showToast("照片上傳失敗：" + err.message, "error");
        photoBox.innerHTML = `<div style="font-size:20px;">📷</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;">點擊上傳</div>`;
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
      const validComponents = componentRows.filter((r) => r.itemId && r.qty > 0);
      if (type === "bundle" && validComponents.length === 0) {
        showToast("組合包至少要選一項組成內容", "error"); return;
      }

      const data = {
        name,
        category: overlay.querySelector("#m-category").value,
        photoUrl: uploadedPhotoUrl,
        price: overlay.querySelector("#m-price")?.value,
        mainItemId: selectedMainItem?.id || null,
        mainItemQty: overlay.querySelector("#m-main-qty")?.value,
        components: validComponents,
        lowStockThreshold: overlay.querySelector("#m-threshold")?.value,
      };

      btn.disabled = true;
      try {
        if (isEdit) await updateItem(item.id, data, type);
        else await createItem({ ...data, type });
        showToast("已儲存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 採購登記（批次，只能選 resale / packaging） ----------
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
            <button type="button" class="row-item-btn picker-trigger" style="flex:2;padding:8px 10px;text-align:left;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:14px;cursor:pointer;">${item ? item.name : "選擇項目"}</button>
            <input type="number" class="row-qty" placeholder="數量" value="${r.qty}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
            <input type="number" class="row-amount" placeholder="金額" value="${r.amount}" style="width:90px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
            ${rows.length > 1 ? `<button class="btn btn-danger row-remove" style="padding:6px 10px;font-size:12px;">刪</button>` : ""}
          </div>
        `;
      }).join("");

      rowsEl.querySelectorAll("[data-row]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-row"));
        rowEl.querySelector(".row-item-btn").addEventListener("click", () => {
          openSearchPicker({
            title: "選擇項目",
            items: purchasable,
            renderLabel: (i) => i.name,
            renderSub: (i) => TYPE_LABELS[i.type],
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
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 盤點 ----------
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
      <div class="field"><label>備註（選填）</label><input type="text" id="s-note" /></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="s-submit">確認校正</button>
      </div>
    `);
    overlay.querySelectorAll(".picker-trigger").forEach((el) => {
      el.style.cssText = "width:100%;text-align:left;padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:15px;cursor:pointer;color:var(--text-primary);";
    });
    overlay.querySelector("#s-item-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇項目",
        items: stocktakable,
        renderLabel: (i) => i.name,
        renderSub: (i) => `系統目前：${computeStock(i, itemsById)}`,
        onSelect: (i) => { selectedItem = i; overlay.querySelector("#s-item-btn").textContent = i.name; },
      });
    });
    overlay.querySelector("#s-submit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const counted = overlay.querySelector("#s-counted").value;
      if (!selectedItem) { showToast("請選擇項目", "error"); return; }
      if (counted === "") { showToast("請輸入盤點數量", "error"); return; }
      btn.disabled = true;
      try {
        await stocktakeAdjust({ itemId: selectedItem.id, countedQty: counted, note: overlay.querySelector("#s-note").value });
        showToast("已校正庫存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 成本明細 ----------
  function openCostDetailModal(itemId) {
    const item = items.find((i) => i.id === itemId);
    const calc = calcItemCost(item, itemsById);
    openModal(`
      <h3 style="margin-bottom:4px;">${item.name}</h3>
      ${!calc.isFullCost ? `<div class="hint" style="margin-bottom:14px;">這是包材成本，還沒扣原料/人工，那些每月算在「利潤總覽」。</div>` : ""}
      <table class="simple-table">
        ${calc.breakdown.map((b) => `<tr><td>${b.label}</td><td style="text-align:right;font-family:var(--font-mono);">$${b.amount.toFixed(2)}</td></tr>`).join("")}
        <tr style="font-weight:700;"><td>成本合計</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.cost.toFixed(2)}</td></tr>
        <tr><td>售價</td><td style="text-align:right;font-family:var(--font-mono);">$${item.price}</td></tr>
        <tr style="font-weight:700;color:${calc.profit>=0?"var(--jade)":"var(--rose)"};"><td>毛利（${(calc.margin*100).toFixed(1)}%）</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.profit.toFixed(2)}</td></tr>
      </table>
    `);
  }

  // ---------- 進貨/領用/盤點記錄 ----------
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
      <button id="modal-close-x" aria-label="關閉" style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:none;background:var(--paper);color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1;z-index:1;">✕</button>
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
    overlay.querySelector("#modal-close-x").addEventListener("click", () => overlay.remove());
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
