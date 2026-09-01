// ============================================================
// 支出管理頁面（獨立功能區）
// 每筆支出分「銷貨成本」或「營業費用」，各自有自己的分類清單
// ============================================================
import { showToast, linkifyErrorMessage, friendlyErrorMessage } from "./utils.js?v=20260830-58";
import { currentSession } from "./auth.js?v=20260830-58";
import { listExpenses, addExpense, updateExpense, deleteExpense, PAYMENT_METHODS, COST_TYPE_LABELS } from "./expenses.js?v=20260830-58";
import { listCategories } from "./categories.js?v=20260830-58";
import { openModal, confirmDialog, openImageLightbox } from "./modal-ui.js?v=20260830-58";
import { uploadImageToCloudinary } from "./settings.js?v=20260830-58";
import { setFab } from "./fab-ui.js?v=20260830-58";
import { iconHtml } from "./icons.js?v=20260830-58";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-58";

function canWrite() {
  return ["superadmin", "admin"].includes(currentSession.member?.role);
}

export async function renderExpensesPage(container, initialFilter = null) {
  let expenses = [];
  let cogsCategories = [];
  let opexCategories = [];
  let searchText = "";
  let filterCostType = initialFilter?.costType || "all";
  let filterCategory = initialFilter?.category || "all";
  function currentMonthRange() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return { start: fmt(start), end: fmt(end) };
  }
  const defaultRange = currentMonthRange();
  let rangeStart = initialFilter?.rangeStart || defaultRange.start;
  let rangeEnd = initialFilter?.rangeEnd || defaultRange.end;

  container.innerHTML = `
    ${pageNavHtml("支出管理")}
    <div class="card" style="margin-bottom:16px;">
      <input type="text" id="search-input" placeholder="搜尋備註/金額" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:10px;" />
      <select id="filter-costtype" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:10px;">
        <option value="all">全部</option>
        <option value="cogs">銷貨成本</option>
        <option value="opex">營業費用</option>
      </select>
      <select id="filter-category" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:10px;">
        <option value="all">全部類別</option>
      </select>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="date" id="filter-start" value="${rangeStart}" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <span class="hint">～</span>
        <input type="date" id="filter-end" value="${rangeEnd}" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
      </div>
    </div>
    <div id="expenses-total" class="hint" style="margin-bottom:10px;"></div>
    <div id="expenses-list"></div>
  `;

  wirePageNav(container);
  container.querySelector("#filter-costtype").value = filterCostType;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-costtype").addEventListener("change", (e) => {
    filterCostType = e.target.value;
    filterCategory = "all";
    updateCategoryFilterOptions();
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
    setFab([{ icon: "add", label: "新增支出", onClick: () => openExpenseModal(null, reload) }]);
  }

  function updateCategoryFilterOptions() {
    const catSelect = container.querySelector("#filter-category");
    const list = filterCostType === "cogs" ? cogsCategories : filterCostType === "opex" ? opexCategories : [...cogsCategories, ...opexCategories];
    catSelect.innerHTML = `<option value="all">全部類別</option>` + list.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
    catSelect.value = filterCategory;
  }

  async function reload() {
    const listEl = container.querySelector("#expenses-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [expenses, cogsCategories, opexCategories] = await Promise.all([
        listExpenses(),
        listCategories("expense_cogs"),
        listCategories("expense_opex"),
      ]);
      updateCategoryFilterOptions();
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(friendlyErrorMessage(err))}</div>`;
    }
  }

  function getFiltered() {
    let filtered = expenses;
    if (filterCostType !== "all") filtered = filtered.filter((e) => e.costType === filterCostType);
    if (filterCategory !== "all") filtered = filtered.filter((e) => e.category === filterCategory);
    if (rangeStart) filtered = filtered.filter((e) => e.date >= rangeStart);
    if (rangeEnd) filtered = filtered.filter((e) => e.date <= rangeEnd);
    if (searchText) filtered = filtered.filter((e) => (e.note || "").toLowerCase().includes(searchText) || String(e.amount ?? "").includes(searchText));
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
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="display:flex;gap:12px;flex:1;min-width:0;">
            ${exp.receiptUrl
              ? `<img src="${exp.receiptUrl}" data-preview="${exp.receiptUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;cursor:pointer;">`
              : `<div style="width:44px;height:44px;border-radius:8px;background:var(--paper);flex-shrink:0;"></div>`
            }
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:16px;color:var(--ink);">${exp.category || "（未分類）"}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">
                <span class="seal-badge ${exp.costType === "cogs" ? "warn" : "ok"}" style="padding:1px 8px 1px 3px;font-size:11px;"><span class="dot"></span>${COST_TYPE_LABELS[exp.costType] || "營業費用"}</span>
                ${exp.date}${exp.paymentMethod ? " · " + exp.paymentMethod : ""}
              </div>
            </div>
          </div>
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--rose);flex-shrink:0;">$${exp.amount}</div>
        </div>
        ${exp.note ? `<div class="hint" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;">${exp.note}</div>` : ""}
        ${canWrite() ? `
          <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px;">
            <button class="btn btn-secondary" data-edit="${exp.id}" style="padding:7px 14px;font-size:13px;">編輯</button>
            <button class="btn btn-danger" data-del="${exp.id}" style="padding:7px 14px;font-size:13px;">刪除</button>
          </div>
        ` : ""}
      </div>
    `).join("");

    listEl.querySelectorAll("[data-preview]").forEach((img) => {
      img.addEventListener("click", () => openImageLightbox(img.getAttribute("data-preview")));
    });
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
          const exp = expenses.find((x) => x.id === btn.getAttribute("data-del"));
          await deleteExpense(btn.getAttribute("data-del"), exp?.category, exp?.amount);
          await reload();
        } catch (err) {
          showToast("失敗：" + friendlyErrorMessage(err), "error");
        }
      });
    });
  }

  // ---------- 新增 / 編輯支出 ----------
  function openExpenseModal(exp, onSaved) {
    const isEdit = !!exp;
    const initialCostType = exp?.costType || "cogs";

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯支出" : "新增支出"}</h3>

      <div style="text-align:center;margin-bottom:16px;">
        <div id="ee-photo-box" style="width:88px;height:88px;border-radius:12px;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-direction:column;">
          ${exp?.receiptUrl
            ? `<img src="${exp.receiptUrl}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="color:var(--text-muted);">${iconHtml("receipt", "--icon-size:26px;")}</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">收據照片</div>`
          }
        </div>
        ${exp?.receiptUrl ? `
          <div style="display:flex;gap:12px;justify-content:center;margin-top:6px;">
            <button type="button" id="ee-photo-change" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">更換照片</button>
            <button type="button" id="ee-photo-view" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">放大看收據</button>
          </div>
        ` : ""}
        <input type="file" accept="image/*" id="ee-photo-input" style="display:none;" />
      </div>

      <div class="field"><label>類型</label>
        <select id="ee-costtype">
          <option value="cogs" ${initialCostType === "cogs" ? "selected" : ""}>銷貨成本</option>
          <option value="opex" ${initialCostType === "opex" ? "selected" : ""}>營業費用</option>
        </select>
      </div>
      <div class="field"><label>類別</label>
        <select id="ee-category"></select>
        <div class="hint" id="ee-category-empty-hint" style="display:none;">尚未建立任何類別，可以到「系統設定 → 分類管理」新增。</div>
      </div>
      <div class="field"><label>金額</label><input type="number" id="ee-amount" value="${exp?.amount ?? ""}" /></div>
      <div class="field"><label>日期</label><input type="date" id="ee-date" value="${exp?.date || new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>付款方式（選填）</label>
        <select id="ee-payment">
          <option value="">不指定</option>
          ${PAYMENT_METHODS.map((m) => `<option value="${m}" ${exp?.paymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>備註（選填）</label><textarea id="ee-note" rows="3" style="resize:vertical;">${exp?.note || ""}</textarea></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="ee-save">儲存</button>
      </div>
    `, 440);

    function syncCategoryOptions(costType) {
      const list = costType === "cogs" ? cogsCategories : opexCategories;
      const catSelect = overlay.querySelector("#ee-category");
      catSelect.innerHTML = `<option value="">不分類</option>` + list.map((c) => `<option value="${c.name}" ${exp?.category === c.name ? "selected" : ""}>${c.name}</option>`).join("");
      overlay.querySelector("#ee-category-empty-hint").style.display = list.length === 0 ? "block" : "none";
    }
    syncCategoryOptions(initialCostType);
    overlay.querySelector("#ee-costtype").addEventListener("change", (e) => syncCategoryOptions(e.target.value));

    let uploadedReceiptUrl = exp?.receiptUrl || "";
    const photoBox = overlay.querySelector("#ee-photo-box");
    const photoInput = overlay.querySelector("#ee-photo-input");
    photoBox.addEventListener("click", () => photoInput.click());
    overlay.querySelector("#ee-photo-view")?.addEventListener("click", () => openImageLightbox(exp.receiptUrl));
    overlay.querySelector("#ee-photo-change")?.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBox.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">上傳中…</div>`;
      try {
        // 不在這裡自己先查一次 Cloudinary 設定再檢查——uploadImageToCloudinary
        // 內部本來就會查、也會檢查，多查一次除了浪費一次資料庫請求，
        // 手機網路不穩時還多一個環節可能出錯。
        uploadedReceiptUrl = await uploadImageToCloudinary(file);
        photoBox.innerHTML = `<img src="${uploadedReceiptUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      } catch (err) {
        showToast("照片上傳失敗：" + friendlyErrorMessage(err), "error");
        photoBox.innerHTML = `<div style="color:var(--text-muted);">${iconHtml("receipt", "--icon-size:26px;")}</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">收據照片</div>`;
      }
    });

    overlay.querySelector("#ee-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const amount = overlay.querySelector("#ee-amount").value;
      if (!amount) { showToast("請輸入金額", "error"); return; }
      btn.disabled = true;
      try {
        const data = {
          costType: overlay.querySelector("#ee-costtype").value,
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
        showToast("失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
      }
    });
  }

  await reload();
}
