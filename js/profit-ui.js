// ============================================================
// 利潤總覽
// 淨利 = 訂單毛利加總(已鎖住成本) − 營業支出(原料/人事/電費/房租/其他)
// 只有超級管理員/管理員/唯讀主管看得到（跟 MODULES 的角色設定一致）
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import { listOrders } from "./orders.js";
import { listExpensesInRange, addExpense, updateExpense, deleteExpense, EXPENSE_CATEGORY_LABELS } from "./expenses.js";
import { renderDateRangePicker } from "./date-range-ui.js";
import { openModal, confirmDialog } from "./modal-ui.js";
import { getCloudinarySettings, uploadImageToCloudinary } from "./settings.js";

const CATEGORY_ICONS = { material: "🌾", labor: "🧑‍🍳", utility: "💡", rent: "🏠", other: "📌" };

function canManageExpenses() {
  return ["superadmin", "admin"].includes(currentSession.member?.role);
}

export async function renderProfitPage(container) {
  container.innerHTML = `
    <div class="page-header"><h2>利潤總覽</h2></div>
    <div id="range-picker"></div>
    <div id="profit-summary"></div>
  `;

  const { getRange } = renderDateRangePicker(container.querySelector("#range-picker"), (range) => load(range));
  await load(getRange());

  async function load(range) {
    const summaryEl = container.querySelector("#profit-summary");
    summaryEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const [orders, expenses] = await Promise.all([
        listOrders(),
        listExpensesInRange(range.start, range.end),
      ]);
      const ordersInRange = orders.filter((o) => !o.voided && o.orderDate >= range.start && o.orderDate <= range.end);
      const revenue = ordersInRange.reduce((s, o) => s + o.totalAmount, 0);
      const grossProfit = ordersInRange.reduce((s, o) =>
        s + o.lineItems.reduce((s2, li) => s2 + (li.subtotal - li.unitCost * li.qty), 0), 0);

      const expenseByCategory = {};
      let totalExpense = 0;
      expenses.forEach((e) => {
        const label = e.category === "other" && e.customLabel ? e.customLabel : EXPENSE_CATEGORY_LABELS[e.category];
        expenseByCategory[label] = (expenseByCategory[label] || 0) + e.amount;
        totalExpense += e.amount;
      });
      const netProfit = grossProfit - totalExpense;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

      const expensesSorted = [...expenses].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

      summaryEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">營收</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">$${revenue.toFixed(0)}</div></div>
            <div><div class="hint">訂單毛利（含包材成本）</div>
              <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:${grossProfit>=0?"var(--jade)":"var(--rose)"};">$${grossProfit.toFixed(0)}</div>
              <div class="hint">毛利率 ${grossMargin.toFixed(1)}%</div>
            </div>
            <div><div class="hint">營業支出</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--rose);">$${totalExpense.toFixed(0)}</div></div>
            <div><div class="hint">淨利</div>
              <div style="font-family:var(--font-mono);font-size:26px;font-weight:900;color:${netProfit>=0?"var(--jade)":"var(--rose)"};">$${netProfit.toFixed(0)}</div>
              <div class="hint">淨利率 ${netMargin.toFixed(1)}%</div>
            </div>
          </div>
          <div class="hint" style="margin-top:10px;">共 ${ordersInRange.length} 張訂單（不含作廢）· ${range.start} ～ ${range.end}</div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:10px;">支出分類小計</h3>
          ${Object.keys(expenseByCategory).length === 0
            ? `<div class="hint">這段期間沒有登記任何支出</div>`
            : `<table class="simple-table">
                ${Object.entries(expenseByCategory).map(([label, amt]) => `<tr><td>${label}</td><td style="text-align:right;font-family:var(--font-mono);">$${amt.toFixed(0)}</td></tr>`).join("")}
              </table>`
          }
        </div>

        <div class="page-header" style="margin-bottom:14px;">
          <h3 style="font-size:16px;">支出明細</h3>
          ${canManageExpenses() ? `<button class="btn btn-primary" id="btn-new-expense">新增支出</button>` : ""}
        </div>
        <div id="expense-list"></div>
      `;

      if (canManageExpenses()) {
        summaryEl.querySelector("#btn-new-expense").addEventListener("click", () => openExpenseModal(null, () => load(range)));
      }

      const listEl = summaryEl.querySelector("#expense-list");
      listEl.innerHTML = expensesSorted.length === 0
        ? `<div class="card" style="color:var(--text-muted);text-align:center;">這段期間沒有登記任何支出</div>`
        : expensesSorted.map((exp) => {
            const label = exp.category === "other" && exp.customLabel ? exp.customLabel : EXPENSE_CATEGORY_LABELS[exp.category];
            return `
              <div class="card" style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                  <div style="display:flex;gap:12px;">
                    ${exp.receiptUrl
                      ? `<img src="${exp.receiptUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
                      : `<div style="width:44px;height:44px;border-radius:8px;background:var(--paper);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;">${CATEGORY_ICONS[exp.category] || "📌"}</div>`
                    }
                    <div>
                      <div style="font-weight:700;font-size:16px;color:var(--ink);">${label}</div>
                      <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${exp.date}${exp.note ? " · " + exp.note : ""}</div>
                    </div>
                  </div>
                  <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--rose);">$${exp.amount}</div>
                </div>
                ${canManageExpenses() ? `
                  <div style="margin-top:10px;display:flex;gap:8px;">
                    <button class="btn btn-secondary" data-edit-exp="${exp.id}" style="padding:7px 14px;font-size:13px;">編輯</button>
                    <button class="btn btn-danger" data-del-exp="${exp.id}" style="padding:7px 14px;font-size:13px;">刪除</button>
                  </div>
                ` : ""}
              </div>
            `;
          }).join("");

      listEl.querySelectorAll("[data-del-exp]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!await confirmDialog("確定要刪除這筆支出嗎？", { confirmLabel: "刪除", danger: true })) return;
          try {
            await deleteExpense(btn.getAttribute("data-del-exp"));
            await load(range);
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
      listEl.querySelectorAll("[data-edit-exp]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const exp = expenses.find((x) => x.id === btn.getAttribute("data-edit-exp"));
          openExpenseModal(exp, () => load(range));
        });
      });
    } catch (err) {
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
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
          ${Object.entries(EXPENSE_CATEGORY_LABELS).map(([k,v]) => `<option value="${k}" ${exp?.category === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field" id="ee-custom-field" style="display:${exp?.category === "other" ? "block" : "none"};">
        <label>項目名稱</label><input type="text" id="ee-custom-label" value="${exp?.customLabel || ""}" />
      </div>
      <div class="field"><label>金額</label><input type="number" id="ee-amount" value="${exp?.amount ?? ""}" /></div>
      <div class="field"><label>日期</label><input type="date" id="ee-date" value="${exp?.date || new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>備註（選填）</label><input type="text" id="ee-note" value="${exp?.note || ""}" /></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="ee-save">儲存</button>
      </div>
    `, 440);

    overlay.querySelector("#ee-category").addEventListener("change", (e) => {
      overlay.querySelector("#ee-custom-field").style.display = e.target.value === "other" ? "block" : "none";
    });

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
          customLabel: overlay.querySelector("#ee-custom-label")?.value,
          amount,
          date: overlay.querySelector("#ee-date").value,
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
}
