// ============================================================
// 利潤總覽
// 淨利 = 訂單毛利加總(已鎖住成本) − 營業支出(類別由系統設定管理)
// 只有超級管理員/管理員/唯讀主管看得到（跟 MODULES 的角色設定一致）
// 支出的登記/查詢/編輯在獨立的「支出管理」頁面，這裡只看計算結果。
// ============================================================
import { listOrders } from "./orders.js";
import { listExpensesInRange } from "./expenses.js";
import { renderDateRangePicker } from "./date-range-ui.js";

export async function renderProfitPage(container, navigateTo) {
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
        const label = e.category || "（未分類）";
        expenseByCategory[label] = (expenseByCategory[label] || 0) + e.amount;
        totalExpense += e.amount;
      });
      const netProfit = grossProfit - totalExpense;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

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

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h3 style="font-size:15px;">支出分類小計</h3>
            <button class="btn btn-secondary" id="btn-goto-expenses" style="padding:7px 14px;font-size:13px;">前往支出管理 →</button>
          </div>
          ${Object.keys(expenseByCategory).length === 0
            ? `<div class="hint">這段期間沒有登記任何支出</div>`
            : `<table class="simple-table">
                ${Object.entries(expenseByCategory).map(([label, amt]) => `<tr><td>${label}</td><td style="text-align:right;font-family:var(--font-mono);">$${amt.toFixed(0)}</td></tr>`).join("")}
              </table>`
          }
        </div>
      `;

      summaryEl.querySelector("#btn-goto-expenses").addEventListener("click", () => navigateTo("expenses"));
    } catch (err) {
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }
}
