// ============================================================
// 商品定價頁面 UI
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import {
  listProducts, createProduct, updateProduct, setProductArchived,
  calcProductCost, addActualCostLog, listActualCostLogs, deleteActualCostLog,
} from "./products.js";
import { listItems, buildItemsIndex, computeStock } from "./inventory.js";
import { getCloudinarySettings, uploadImageToCloudinary } from "./settings.js";

const TYPE_LABELS = { self_made: "自製", resale: "現貨" };

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
      [products, invItems] = await Promise.all([
        listProducts({ includeArchived: showArchived }),
        listItems({ includeArchived: true }),
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
              ${p.photoUrl ? `<img src="${p.photoUrl}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;">` : ""}
              <div>
                <div style="font-weight:700;font-size:16px;color:var(--ink);">${p.name} ${isArchived ? `<span class="hint">(已下架)</span>` : ""}</div>
                <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${TYPE_LABELS[p.productType]}${p.category ? " · " + p.category : ""}${p.productType === "resale" ? ` · 庫存 ${calc.stock ?? 0}` : ""}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--ink);">$${p.price}</div>
              ${canSeeCost() ? `<div style="font-size:12px;color:${calc.profit >= 0 ? "var(--jade)" : "var(--rose)"};">毛利 $${calc.profit.toFixed(1)}（${(calc.margin*100).toFixed(0)}%）</div>` : ""}
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

  function openModal(innerHtml) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `<div class="card" style="max-width:560px;width:100%;max-height:88vh;overflow-y:auto;" id="modal-box">${innerHtml}</div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  // ---------- 新增 / 編輯商品 ----------
  function openProductModal(product = null) {
    const isEdit = !!product;
    const mainItemOptions = invItems.filter((i) => i.status !== "archived");
    const resaleItemOptions = invItems.filter((i) => i.type === "resale" && i.status !== "archived");

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯商品" : "新增商品"}</h3>
      <div class="field"><label>商品照片（選填）</label>
        <div style="display:flex;align-items:center;gap:12px;">
          <div id="photo-preview" style="width:56px;height:56px;border-radius:8px;overflow:hidden;background:var(--paper);flex-shrink:0;">
            ${product?.photoUrl ? `<img src="${product.photoUrl}" style="width:100%;height:100%;object-fit:cover;">` : ""}
          </div>
          <input type="file" accept="image/*" id="m-photo-input" />
        </div>
      </div>
      <div class="field"><label>名稱</label><input type="text" id="m-name" value="${product?.name || ""}" /></div>
      <div class="field"><label>分類（選填）</label><input type="text" id="m-category" value="${product?.category || ""}" /></div>
      ${!isEdit ? `
        <div class="field"><label>商品類型</label>
          <select id="m-type">
            <option value="self_made">自製（現做）</option>
            <option value="resale">現貨（進貨轉賣）</option>
          </select>
        </div>
      ` : `<div class="hint" style="margin-bottom:14px;">類型：${TYPE_LABELS[product.productType]}（建立後不能改）</div>`}
      <div class="field"><label>售價</label><input type="number" id="m-price" value="${product?.price || ""}" /></div>

      <div id="m-selfmade-fields" style="display:${(isEdit ? product.productType : "self_made") === "self_made" ? "block" : "none"};">
        <div class="field"><label>原料成本（試算，手動輸入）</label><input type="number" id="m-raw-cost" value="${product?.rawMaterialCost || ""}" /></div>
        <div class="field"><label>主料（選填）</label>
          <select id="m-main-item">
            <option value="">不使用</option>
            ${mainItemOptions.map((i) => `<option value="${i.id}" ${i.id === product?.mainItemId ? "selected" : ""}>${i.name}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>主料用量</label><input type="number" id="m-main-qty" value="${product?.mainItemQty || 1}" /></div>
        <div class="field"><label>人工成本比例（%）</label><input type="number" id="m-labor" value="${product?.laborPercent ?? 30}" /></div>
        <div class="field"><label>損耗比例（%）</label><input type="number" id="m-waste" value="${product?.wastePercent ?? 8}" /></div>
      </div>

      <div id="m-resale-fields" style="display:${(isEdit ? product.productType : "self_made") === "resale" ? "block" : "none"};">
        <div class="field"><label>對應「採購與庫存」的現貨商品</label>
          <select id="m-linked-item">
            <option value="">選擇項目</option>
            ${resaleItemOptions.map((i) => `<option value="${i.id}" ${i.id === product?.linkedInventoryItemId ? "selected" : ""}>${i.name}</option>`).join("")}
          </select>
          <div class="hint">成本與庫存都會直接抓那個項目的資料，這裡不用另外設定。</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-secondary" id="m-cancel">取消</button>
        <button class="btn btn-primary" id="m-save">儲存</button>
      </div>
    `);

    let uploadedPhotoUrl = product?.photoUrl || "";

    overlay.querySelector("#m-photo-input").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const preview = overlay.querySelector("#photo-preview");
      preview.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:4px;">上傳中…</div>`;
      try {
        const cloud = await getCloudinarySettings();
        if (!cloud.cloudName || !cloud.uploadPreset) throw new Error("尚未設定 Cloudinary");
        uploadedPhotoUrl = await uploadImageToCloudinary(file);
        preview.innerHTML = `<img src="${uploadedPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) {
        showToast("照片上傳失敗：" + err.message, "error");
        preview.innerHTML = "";
      }
    });

    if (!isEdit) {
      overlay.querySelector("#m-type").addEventListener("change", (e) => {
        const isSelfMade = e.target.value === "self_made";
        overlay.querySelector("#m-selfmade-fields").style.display = isSelfMade ? "block" : "none";
        overlay.querySelector("#m-resale-fields").style.display = isSelfMade ? "none" : "block";
      });
    }

    overlay.querySelector("#m-cancel").addEventListener("click", () => overlay.remove());
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
        data.rawMaterialCost = overlay.querySelector("#m-raw-cost").value;
        data.mainItemId = overlay.querySelector("#m-main-item").value || null;
        data.mainItemQty = overlay.querySelector("#m-main-qty").value;
        data.laborPercent = overlay.querySelector("#m-labor").value;
        data.wastePercent = overlay.querySelector("#m-waste").value;
      } else {
        data.linkedInventoryItemId = overlay.querySelector("#m-linked-item").value || null;
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

  // ---------- 成本明細 + 實際成本記錄 ----------
  async function openCostDetailModal(productId) {
    const product = products.find((p) => p.id === productId);
    const calc = calcProductCost(product, itemsById);
    const overlay = openModal(`<div style="color:var(--text-muted);">載入中…</div>`);
    const logs = product.productType === "self_made" ? await listActualCostLogs(productId) : [];

    function render() {
      overlay.querySelector("#modal-box").innerHTML = `
        <h3 style="margin-bottom:4px;">${product.name}</h3>
        <div class="hint" style="margin-bottom:14px;">試算成本明細（訂單成立時會把這組數字鎖進訂單，之後調整不會動到舊訂單）</div>
        <table class="simple-table" style="margin-bottom:14px;">
          ${calc.breakdown.map((b) => `<tr><td>${b.label}</td><td style="text-align:right;font-family:var(--font-mono);">$${b.amount.toFixed(2)}</td></tr>`).join("")}
          <tr style="font-weight:700;"><td>試算成本合計</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.cost.toFixed(2)}</td></tr>
          <tr><td>售價</td><td style="text-align:right;font-family:var(--font-mono);">$${product.price}</td></tr>
          <tr style="font-weight:700;color:${calc.profit>=0?"var(--jade)":"var(--rose)"};"><td>毛利（${(calc.margin*100).toFixed(1)}%）</td><td style="text-align:right;font-family:var(--font-mono);">$${calc.profit.toFixed(2)}</td></tr>
        </table>

        ${product.productType === "self_made" ? `
          <h4 style="font-size:13px;color:var(--text-muted);margin:14px 0 8px;">實際成本記錄（校準用，不影響訂單/報表）</h4>
          <div id="actual-log-list">
            ${logs.length ? logs.map((l) => `
              <div style="padding:8px 0;border-bottom:1px solid var(--paper-line);display:flex;justify-content:space-between;">
                <div>
                  <div style="font-size:14px;">${l.date} · 花費 $${l.actualAmount} ÷ ${l.batchQty} 份 = 單位 $${l.unitCost.toFixed(2)}</div>
                  ${l.note ? `<div class="hint">${l.note}</div>` : ""}
                </div>
                ${canWrite() ? `<button class="btn btn-danger" data-del-log="${l.id}" style="padding:3px 10px;font-size:12px;">刪除</button>` : ""}
              </div>
            `).join("") : `<div class="hint">尚無記錄</div>`}
          </div>
          ${canWrite() ? `
            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
              <input type="number" id="log-amount" placeholder="這次花費" style="flex:1;min-width:90px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              <input type="number" id="log-qty" placeholder="做了幾份" style="flex:1;min-width:90px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              <button class="btn btn-secondary" id="log-add" style="padding:8px 14px;">登記</button>
            </div>
          ` : ""}
        ` : ""}

        <div style="display:flex;justify-content:flex-end;margin-top:14px;">
          <button class="btn btn-secondary" id="d-close">關閉</button>
        </div>
      `;
      overlay.querySelector("#d-close").addEventListener("click", () => overlay.remove());
      const addBtn = overlay.querySelector("#log-add");
      if (addBtn) {
        addBtn.addEventListener("click", async () => {
          const amount = overlay.querySelector("#log-amount").value;
          const qty = overlay.querySelector("#log-qty").value;
          if (!amount || !qty) { showToast("請填花費跟份數", "error"); return; }
          try {
            await addActualCostLog({ productId, actualAmount: amount, batchQty: qty });
            showToast("已登記", "success");
            const newLogs = await listActualCostLogs(productId);
            logs.length = 0;
            logs.push(...newLogs);
            render();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      }
      overlay.querySelectorAll("[data-del-log]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("確定要刪除這筆記錄嗎？")) return;
          try {
            await deleteActualCostLog(btn.getAttribute("data-del-log"));
            const newLogs = await listActualCostLogs(productId);
            logs.length = 0;
            logs.push(...newLogs);
            render();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
    }
    render();
  }

  await reload();
}
