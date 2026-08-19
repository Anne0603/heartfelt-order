// ============================================================
// 支出管理頁面（獨立功能區，不再塞在利潤總覽裡）
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import { listExpenses, addExpense, updateExpense, deleteExpense, PAYMENT_METHODS } from "./expenses.js";
import { listCategories } from "./categories.js";
import { openModal, confirmDialog } from "./modal-ui.js";
import { getCloudinarySettings, uploadImageToCloudinary } from "./settings.js";

function canWrite() {
  return ["superadmin", "admin"].includes(currentSession.member?.role);
}

export async function renderExpensesPage(container) {
  let expenses = [];
  let categories = [];
  let searchText = "";
  let filterCategory = "all";
  let rangeStart = "";
  let rangeEnd = "";

  container.innerHTML = `
    <div class="page-header">
      <h2>支出管理</h2>
      ${canWrite() ? `<button class="btn btn-primary" id="btn-new-expense">新增支出</button>` : ""}
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋備註" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <select id="filter-category" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;">
          <option value="all">全部類別</option>
        </select>
        <input type="date" id="filter-start" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <span class="hint">～</span>
        <input type="date" id="filter-end" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
      </div>
    </div>
    <div id="expenses-total" class="hint" style="margin-bottom:10px;"></div>
    <div id="expenses-list"></div>
  `;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-category").addEventListener("change", (e) => {
    filterCategory = e.target.value;
    renderList();
  });
  container.querySelector("#filter-start").addEventListener("change", (e) => {
    rangeStart = e.target.value;
    renderList();
  });
  container.querySelector("#filter-end").addEventListener("change", (e) => {
    rangeEnd = e.target.value;
    renderList();
  });
  if (canWrite()) {
    container.querySelector("#btn-new-expense").addEventListener("click", () => openExpenseModal(null, reload));
  }

  async function reload() {
    const listEl = container.querySelector("#expenses-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [expenses, categories] = await Promise.all([listExpenses(), listCategories("expenses")]);
      const catSelect = container.querySelector("#filter-category");
      catSelect.innerHTML = `<option value="all">全部類別</option>` + categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }

  function getFiltered() {
    let filtered = expenses;
    if (filterCategory !== "all") filtered = filtered.filter((e) => e.category === filterCategory);
    if (rangeStart) filtered = filtered.filter((e) => e.date >= rangeStart);
    if (rangeEnd) filtered = filtered.filter((e) => e.date <= rangeEnd);
    if (searchText) filtered = filtered.filter((e) => (e.note || "").toLowerCase().includes(searchText));
    return filtered;
  }

  function renderList() {
    const listEl = container.querySelector("#expenses-list");
    const filtered = getFiltered();
    const total = filtered.reduce((s, e) => s + e.amount, 0);
    container.querySelector("#expenses-total").textContent = `共 ${filtered.length} 筆，合計 $${total.toFixed(0)}`;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有符合的支出記錄</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((exp) => `
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;gap:12px;">
            ${exp.receiptUrl
              ? `<img src="${exp.receiptUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
              : `<div style="width:44px;height:44px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`
            }
            <div>
              <div style="font-weight:700;font-size:16px;color:var(--ink);">${exp.category || "（未分類）"}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${exp.date}${exp.paymentMethod ? " · " + exp.paymentMethod : ""}${exp.note ? " · " + exp.note : ""}</div>
            </div>
          </div>
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--rose);">$${exp.amount}</div>
        </div>
        ${canWrite() ? `
          <div style="margin-top:10px;display:flex;gap:8px;">
            <button class="btn btn-secondary" data-edit="${exp.id}" style="padding:7px 14px;font-size:13px;">編輯</button>
            <button class="btn btn-danger" data-del="${exp.id}" style="padding:7px 14px;font-size:13px;">刪除</button>
          </div>
        ` : ""}
      </div>
    `).join("");

    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const exp = expenses.find((x) => x.id === btn.getAttribute("data-edit"));
        openExpenseModal(exp, reload);
      });
    });
    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmDialog("確定要刪除這筆支出嗎？", { confirmLabel: "刪除", danger: true })) return;
        try {
          await deleteExpense(btn.getAttribute("data-del"));
          await reload();
        } catch (err) {
          showToast("失敗：" + err.message, "error");
        }
      });
    });
  }

  // ---------- 新增 / 編輯支出 ----------
  function openExpenseModal(exp, onSaved) {
    const isEdit = !!exp;
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯支出" : "新增支出"}</h3>

      <div style="text-align:center;margin-bottom:16px;">
        <div id="ee-photo-box" style="width:88px;height:88px;border-radius:12px;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-direction:column;">
          ${exp?.receiptUrl
            ? `<img src="${exp.receiptUrl}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="font-size:22px;">🧾</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">收據照片</div>`
          }
        </div>
        <input type="file" accept="image/*" id="ee-photo-input" style="display:none;" />
      </div>

      <div class="field"><label>類別</label>
        <select id="ee-category">
          <option value="">不分類</option>
          ${categories.map((c) => `<option value="${c.name}" ${exp?.category === c.name ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        ${categories.length === 0 ? `<div class="hint">尚未建立任何支出類別，可以到「系統設定 → 分類管理」新增。</div>` : ""}
      </div>
      <div class="field"><label>金額</label><input type="number" id="ee-amount" value="${exp?.amount ?? ""}" /></div>
      <div class="field"><label>日期</label><input type="date" id="ee-date" value="${exp?.date || new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>付款方式（選填）</label>
        <select id="ee-payment">
          <option value="">不指定</option>
          ${PAYMENT_METHODS.map((m) => `<option value="${m}" ${exp?.paymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>備註（選填）</label><input type="text" id="ee-note" value="${exp?.note || ""}" /></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="ee-save">儲存</button>
      </div>
    `, 440);

    let uploadedReceiptUrl = exp?.receiptUrl || "";
    const photoBox = overlay.querySelector("#ee-photo-box");
    const photoInput = overlay.querySelector("#ee-photo-input");
    photoBox.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBox.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">上傳中…</div>`;
      try {
        const cloud = await getCloudinarySettings();
        if (!cloud.cloudName || !cloud.uploadPreset) throw new Error("尚未設定 Cloudinary");
        uploadedReceiptUrl = await uploadImageToCloudinary(file);
        photoBox.innerHTML = `<img src="${uploadedReceiptUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) {
        showToast("照片上傳失敗：" + err.message, "error");
        photoBox.innerHTML = `<div style="font-size:22px;">🧾</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">收據照片</div>`;
      }
    });

    overlay.querySelector("#ee-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const amount = overlay.querySelector("#ee-amount").value;
      if (!amount) { showToast("請輸入金額", "error"); return; }
      btn.disabled = true;
      try {
        const data = {
          category: overlay.querySelector("#ee-category").value,
          amount,
          date: overlay.querySelector("#ee-date").value,
          paymentMethod: overlay.querySelector("#ee-payment").value,
          note: overlay.querySelector("#ee-note").value,
          receiptUrl: uploadedReceiptUrl,
        };
        if (isEdit) await updateExpense(exp.id, data);
        else await addExpense(data);
        showToast("已儲存", "success");
        overlay.remove();
        onSaved();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  await reload();
}
