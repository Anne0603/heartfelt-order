// ============================================================
// 利潤總覽
// 淨利 = 訂單毛利加總(已鎖住成本) − 營業支出(原料/人事/電費/房租/其他)
// 只有超級管理員/管理員/唯讀主管看得到（跟 MODULES 的角色設定一致）
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import { listOrders } from "./orders.js";
import { listExpensesInRange, addExpense, deleteExpense, EXPENSE_CATEGORY_LABELS } from "./expenses.js";
import { renderDateRangePicker } from "./date-range-ui.js";
import { confirmDialog } from "./modal-ui.js";

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

      summaryEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">營收</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">$${revenue.toFixed(0)}</div></div>
            <div><div class="hint">訂單毛利（含包材成本）</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:${grossProfit>=0?"var(--jade)":"var(--rose)"};">$${grossProfit.toFixed(0)}</div></div>
            <div><div class="hint">營業支出</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--rose);">$${totalExpense.toFixed(0)}</div></div>
            <div><div class="hint">淨利</div><div style="font-family:var(--font-mono);font-size:26px;font-weight:900;color:${netProfit>=0?"var(--jade)":"var(--rose)"};">$${netProfit.toFixed(0)}</div></div>
          </div>
          <div class="hint" style="margin-top:10px;">共 ${ordersInRange.length} 張訂單（不含作廢）· ${range.start} ～ ${range.end}</div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:10px;">支出明細</h3>
          ${Object.keys(expenseByCategory).length === 0
            ? `<div class="hint">這段期間沒有登記任何支出</div>`
            : `<table class="simple-table">
                ${Object.entries(expenseByCategory).map(([label, amt]) => `<tr><td>${label}</td><td style="text-align:right;font-family:var(--font-mono);">$${amt.toFixed(0)}</td></tr>`).join("")}
              </table>`
          }
        </div>

        ${canManageExpenses() ? `
          <div class="card">
            <h3 style="font-size:15px;margin-bottom:10px;">登記支出</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
              <select id="exp-category" style="padding:8px;border:1px solid var(--paper-line);border-radius:8px;">
                ${Object.entries(EXPENSE_CATEGORY_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join("")}
              </select>
              <input type="text" id="exp-custom-label" placeholder="項目名稱（選其他才需要）" style="display:none;flex:1;min-width:120px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              <input type="number" id="exp-amount" placeholder="金額" style="width:100px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              <input type="text" id="exp-date" value="${new Date().toISOString().slice(0,10)}" style="width:120px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
              <button class="btn btn-primary" id="exp-add" style="padding:8px 16px;">登記</button>
            </div>
            <div id="exp-list"></div>
          </div>
        ` : ""}
      `;

      if (canManageExpenses()) {
        const categorySelect = summaryEl.querySelector("#exp-category");
        const customLabelInput = summaryEl.querySelector("#exp-custom-label");
        categorySelect.addEventListener("change", () => {
          customLabelInput.style.display = categorySelect.value === "other" ? "block" : "none";
        });

        summaryEl.querySelector("#exp-add").addEventListener("click", async (e) => {
          const amount = summaryEl.querySelector("#exp-amount").value;
          if (!amount) { showToast("請輸入金額", "error"); return; }
          e.currentTarget.disabled = true;
          try {
            await addExpense({
              category: categorySelect.value,
              customLabel: customLabelInput.value,
              amount,
              date: summaryEl.querySelector("#exp-date").value,
            });
            showToast("已登記", "success");
            await load(range);
          } catch (err) {
            showToast("失敗：" + err.message, "error");
            e.currentTarget.disabled = false;
          }
        });

        const listEl = summaryEl.querySelector("#exp-list");
        listEl.innerHTML = expenses.length === 0 ? "" : expenses.map((exp) => {
          const label = exp.category === "other" && exp.customLabel ? exp.customLabel : EXPENSE_CATEGORY_LABELS[exp.category];
          return `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--paper-line);font-size:14px;">
              <span>${exp.date} · ${label} · $${exp.amount}</span>
              <button class="btn btn-danger" data-del-exp="${exp.id}" style="padding:3px 10px;font-size:12px;">刪除</button>
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
      }
    } catch (err) {
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }
}
