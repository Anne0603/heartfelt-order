// ============================================================
// 商品定價頁面 UI
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import { listProducts, createProduct, updateProduct, setProductArchived, calcProductCost } from "./products.js";
import { listItems, buildItemsIndex, computeStock } from "./inventory.js";
import { listCategories } from "./categories.js";
import { getCloudinarySettings, uploadImageToCloudinary } from "./settings.js";
import { openModal } from "./modal-ui.js";
import { openSearchPicker } from "./picker-ui.js";

const TYPE_LABELS = { self_made: "自製商品", resale: "現貨商品" };
const TYPE_HINTS = {
  self_made: "自製商品，成本只算包材（原料/人工等費用直接計算金額）。",
  resale: "直接進貨轉賣的東西，成本跟庫存都直接抓「採購與庫存」裡的資料。",
};

function canSeeCost() {
  const r = currentSession.member?.role;
  return ["superadmin", "admin", "viewer"].includes(r);
}
function canWrite() {
  const r = currentSession.member?.role;
  return ["superadmin", "admin"].includes(r);
}

export async function renderProductsPage(container) {
  let products = [];
  let invItems = [];
  let itemsById = new Map();
  let productCategories = [];
  let searchText = "";
  let showArchived = false;

  container.innerHTML = `
    <div class="page-header">
      <h2>商品定價</h2>
      ${canWrite() ? `<button class="btn btn-primary" id="btn-new-product">新增商品</button>` : ""}
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋名稱" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text-muted);">
          <input type="checkbox" id="show-archived" /> 顯示已下架
        </label>
      </div>
    </div>
    <div id="products-list"></div>
  `;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#show-archived").addEventListener("change", async (e) => {
    showArchived = e.target.checked;
    await reload();
  });
  if (canWrite()) {
    container.querySelector("#btn-new-product").addEventListener("click", () => openProductModal());
  }

  async function reload() {
    const listEl = container.querySelector("#products-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [products, invItems, productCategories] = await Promise.all([
        listProducts({ includeArchived: showArchived }),
        listItems({ includeArchived: true }),
        listCategories("products"),
      ]);
      itemsById = buildItemsIndex(invItems);
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#products-list");
    let filtered = products;
    if (searchText) filtered = filtered.filter((p) => (p.name || "").toLowerCase().includes(searchText));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有商品</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((p) => {
      const calc = calcProductCost(p, itemsById);
      const isArchived = p.status === "archived";
      return `
        <div class="card" style="margin-bottom:10px;${isArchived ? "opacity:0.55;" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div style="display:flex;gap:12px;">
              ${p.photoUrl ? `<img src="${p.photoUrl}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;">` : `<div style="width:48px;height:48px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`}
              <div>
                <div style="font-weight:700;font-size:16px;color:var(--ink);">${p.name} ${isArchived ? `<span class="hint">(已下架)</span>` : ""}</div>
                <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[p.productType]}${p.category ? " · " + p.category : ""}${p.productType === "resale" ? ` · 庫存 ${calc.stock ?? 0}` : ""}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--ink);">$${p.price}</div>
              ${canSeeCost() ? `<div style="font-size:12px;color:${calc.profit >= 0 ? "var(--jade)" : "var(--rose)"};">毛利 $${calc.profit.toFixed(1)}${calc.isFullCost ? "" : "*"}</div>` : ""}
            </div>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            ${canSeeCost() ? `<button class="btn btn-secondary" data-costdetail="${p.id}" style="padding:7px 14px;font-size:13px;">成本明細</button>` : ""}
            ${canWrite() ? `<button class="btn btn-secondary" data-edit="${p.id}" style="padding:7px 14px;font-size:13px;">編輯</button>` : ""}
            ${canWrite() ? `<button class="btn btn-secondary" data-archive="${p.id}" style="padding:7px 14px;font-size:13px;">${isArchived ? "恢復上架" : "下架"}</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
    if (products.some((p) => p.productType === "self_made") && canSeeCost()) {
      listEl.insertAdjacentHTML("beforeend", `<div class="hint" style="text-align:center;margin-top:6px;">* 自製商品的毛利未扣原料/人工，那些算在「利潤總覽」</div>`);
    }

    listEl.querySelectorAll("[data-costdetail]").forEach((btn) => {
      btn.addEventListener("click", () => openCostDetailModal(btn.getAttribute("data-costdetail")));
    });
    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = products.find((x) => x.id === btn.getAttribute("data-edit"));
        openProductModal(p);
      });
    });
    listEl.querySelectorAll("[data-archive]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = products.find((x) => x.id === btn.getAttribute("data-archive"));
        const willArchive = p.status !== "archived";
        if (willArchive && !confirm(`確定要下架「${p.name}」嗎？`)) return;
        try {
          await setProductArchived(p.id, willArchive);
          showToast(willArchive ? "已下架" : "已恢復上架", "success");
          await reload();
        } catch (err) {
          showToast("失敗：" + err.message, "error");
        }
      });
    });
  }

  // ---------- 新增 / 編輯商品 ----------
  function openProductModal(product = null) {
    const isEdit = !!product;
    const packagingLikeItems = invItems.filter((i) => i.type !== "resale" && i.status !== "archived");
    const resaleItemOptions = invItems.filter((i) => i.type === "resale" && i.status !== "archived");
    const initialType = product?.productType || "self_made";
    let selectedMainItem = product?.mainItemId ? invItems.find((i) => i.id === product.mainItemId) : null;
    let selectedLinkedItem = product?.linkedInventoryItemId ? invItems.find((i) => i.id === product.linkedInventoryItemId) : null;

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯商品" : "新增商品"}</h3>

      <div class="card" style="background:var(--paper);box-shadow:none;margin-bottom:16px;">
        <div class="hint" style="margin-bottom:12px;font-weight:600;color:var(--ink);">基本資料（必填）</div>

        <div style="text-align:center;margin-bottom:16px;">
          <div id="photo-box" style="width:88px;height:88px;border-radius:12px;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-direction:column;">
            ${product?.photoUrl
              ? `<img src="${product.photoUrl}" style="width:100%;height:100%;object-fit:cover;">`
              : `<div style="font-size:22px;">📷</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;">點擊上傳</div>`
            }
          </div>
          <input type="file" accept="image/*" id="m-photo-input" style="display:none;" />
        </div>

        <div class="field"><label>商品名稱</label><input type="text" id="m-name" value="${product?.name || ""}" /></div>
        <div class="field">
          <label>商品類型</label>
          <select id="m-type" ${isEdit ? "disabled" : ""}>
            <option value="self_made" ${initialType === "self_made" ? "selected" : ""}>自製商品</option>
            <option value="resale" ${initialType === "resale" ? "selected" : ""}>現貨商品</option>
          </select>
          <div class="hint" id="m-type-hint">${TYPE_HINTS[initialType]}</div>
        </div>
        <div class="field"><label>分類（選填）</label>
          <select id="m-category">
            <option value="">不分類</option>
            ${productCategories.map((c) => `<option value="${c.name}" ${c.name === product?.category ? "selected" : ""}>${c.name}</option>`).join("")}
          </select>
          ${productCategories.length === 0 ? `<div class="hint">尚未建立任何分類，可以到「系統設定 → 分類管理」新增。</div>` : ""}
        </div>
        <div class="field"><label>售價</label><input type="number" id="m-price" value="${product?.price ?? ""}" /></div>
      </div>

      <div class="card" style="background:var(--paper);box-shadow:none;margin-bottom:16px;" id="m-selfmade-section">
        <div class="hint" style="margin-bottom:10px;font-weight:600;color:var(--ink);">自製商品設定</div>
        <div class="field"><label>這個商品要扣哪個包材（選填）</label>
          ${packagingLikeItems.length === 0
            ? `<div class="hint">你還沒建立任何包材，<a href="#/inventory" style="color:var(--gold-deep);">點這裡先去新增</a>。</div>`
            : `<button type="button" id="m-main-item-btn" class="picker-trigger">${selectedMainItem ? selectedMainItem.name : "點選包材（不使用可略過）"}</button>`
          }
        </div>
        <div class="field" id="m-qty-field" style="display:${selectedMainItem ? "block" : "none"};">
          <label>用幾個</label>
          <input type="number" id="m-main-qty" value="${product?.mainItemQty || 1}" />
          <div class="hint">例如這個商品出貨一次要用掉 1 個緞帶，這裡就填 1。</div>
        </div>
      </div>

      <div class="card" style="background:var(--paper);box-shadow:none;margin-bottom:16px;" id="m-resale-section">
        <div class="hint" style="margin-bottom:10px;font-weight:600;color:var(--ink);">現貨商品設定</div>
        <div class="field"><label>對應「採購與庫存」的現貨項目</label>
          ${resaleItemOptions.length === 0
            ? `<div class="hint">你還沒建立任何現貨商品項目，<a href="#/inventory" style="color:var(--gold-deep);">點這裡先去新增</a>。</div>`
            : `<button type="button" id="m-linked-item-btn" class="picker-trigger">${selectedLinkedItem ? selectedLinkedItem.name : "點選現貨項目"}</button>
              <div class="hint">成本與庫存都會直接抓那個項目的資料。</div>`
          }
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="m-save">儲存</button>
      </div>
    `);

    overlay.querySelectorAll(".picker-trigger").forEach((el) => {
      el.style.cssText = "width:100%;text-align:left;padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:15px;cursor:pointer;color:var(--text-primary);";
    });

    function syncTypeSections(type) {
      overlay.querySelector("#m-selfmade-section").style.display = type === "self_made" ? "block" : "none";
      overlay.querySelector("#m-resale-section").style.display = type === "resale" ? "block" : "none";
      overlay.querySelector("#m-type-hint").textContent = TYPE_HINTS[type];
    }
    syncTypeSections(initialType);
    overlay.querySelector("#m-type").addEventListener("change", (e) => syncTypeSections(e.target.value));

    const mainItemBtn = overlay.querySelector("#m-main-item-btn");
    if (mainItemBtn) {
      mainItemBtn.addEventListener("click", () => {
        openSearchPicker({
          title: "選擇包材",
          items: packagingLikeItems,
          renderLabel: (i) => i.name,
          renderSub: (i) => i.type === "bundle" ? "組合包" : "包材",
          onSelect: (i) => {
            selectedMainItem = i;
            mainItemBtn.textContent = i.name;
            overlay.querySelector("#m-qty-field").style.display = "block";
          },
        });
      });
    }

    const linkedItemBtn = overlay.querySelector("#m-linked-item-btn");
    if (linkedItemBtn) {
      linkedItemBtn.addEventListener("click", () => {
        openSearchPicker({
          title: "選擇現貨項目",
          items: resaleItemOptions,
          renderLabel: (i) => i.name,
          onSelect: (i) => {
            selectedLinkedItem = i;
            linkedItemBtn.textContent = i.name;
          },
        });
      });
    }

    let uploadedPhotoUrl = product?.photoUrl || "";
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
        photoBox.innerHTML = `<div style="font-size:22px;">📷</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;">點擊上傳</div>`;
      }
    });

    overlay.querySelector("#m-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const name = overlay.querySelector("#m-name").value.trim();
      const price = overlay.querySelector("#m-price").value;
      if (!name) { showToast("請輸入名稱", "error"); return; }
      if (!price) { showToast("請輸入售價", "error"); return; }

      const productType = isEdit ? product.productType : overlay.querySelector("#m-type").value;
      const data = {
        name,
        category: overlay.querySelector("#m-category").value,
        photoUrl: uploadedPhotoUrl,
        productType,
        price,
      };
      if (productType === "self_made") {
        data.mainItemId = selectedMainItem?.id || null;
        data.mainItemQty = overlay.querySelector("#m-main-qty")?.value || 1;
      } else {
        data.linkedInventoryItemId = selectedLinkedItem?.id || null;
      }

      btn.disabled = true;
      try {
        if (isEdit) await updateProduct(product.id, data);
        else await createProduct(data);
        showToast("已儲存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 成本明細 ----------
  function openCostDetailModal(productId) {
    const product = products.find((p) => p.id === productId);
    const calc = calcProductCost(product, itemsById);
    openModal(`
      <h3 style="margin-bottom:4px;">${product.name}</h3>
      ${!calc.isFullCost ? `<div class="hint" style="margin-bottom:14px;">這是包材成本，還沒扣原料/人工。原料每月一筆總帳、人工算進「利潤總覽」的營業費用。</div>` : ""}
      <table class="simple-table">
        ${calc.breakdown.map((b) => `<tr><td>${b.label}</td><td style="text-align:right;font-family:var(--font-mono);">$${b.amount.toFixed(2)}</td></tr>`).join("")}
        <tr style="font-weight:700;"><td>成本合計</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.cost.toFixed(2)}</td></tr>
        <tr><td>售價</td><td style="text-align:right;font-family:var(--font-mono);">$${product.price}</td></tr>
        <tr style="font-weight:700;color:${calc.profit>=0?"var(--jade)":"var(--rose)"};"><td>毛利（${(calc.margin*100).toFixed(1)}%）</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.profit.toFixed(2)}</td></tr>
      </table>
    `);
  }

  await reload();
}
