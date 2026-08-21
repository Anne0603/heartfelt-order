// ============================================================
// 利潤總覽
// 毛利 = 營收 − 銷貨成本（訂單鎖住的包材成本 + 額外登記的銷貨成本支出）
// 淨利 = 毛利 − 營業費用
// 只有超級管理員/管理員/唯讀主管看得到（跟 MODULES 的角色設定一致）
// 支出的登記/查詢/編輯在獨立的「支出管理」頁面，這裡只看計算結果。
// 分類明細每一行都能點，會直接帶著「這段期間 + 這個類型/類別」跳去
// 支出管理，並且畫面已經套用好篩選，不用自己重新篩一次。
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
      const packagingCost = ordersInRange.reduce((s, o) =>
        s + o.lineItems.reduce((s2, li) => s2 + li.unitCost * li.qty, 0), 0);

      const cogsExpenses = expenses.filter((e) => e.costType === "cogs");
      const opexExpenses = expenses.filter((e) => e.costType !== "cogs");
      const cogsExtra = cogsExpenses.reduce((s, e) => s + e.amount, 0);
      const opexTotal = opexExpenses.reduce((s, e) => s + e.amount, 0);
      const totalCOGS = packagingCost + cogsExtra;

      const grossProfit = revenue - totalCOGS;
      const netProfit = grossProfit - opexTotal;
      const grossMarginText = revenue > 0 ? `${((grossProfit / revenue) * 100).toFixed(1)}%` : "—";
      const netMarginText = revenue > 0 ? `${((netProfit / revenue) * 100).toFixed(1)}%` : "—";

      function categoryRows(list, costType) {
        const byCategory = {};
        list.forEach((e) => {
          const label = e.category || "（未分類）";
          byCategory[label] = (byCategory[label] || 0) + e.amount;
        });
        const entries = Object.entries(byCategory);
        if (entries.length === 0) return `<div class="hint">這段期間沒有登記</div>`;
        return entries.map(([label, amt]) => `
          <button class="expense-cat-row" data-costtype="${costType}" data-category="${label === "（未分類）" ? "" : label}" style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:10px 4px;border:none;background:transparent;text-align:left;cursor:pointer;border-bottom:1px solid var(--paper-line);font-family:var(--font-body);">
            <span style="color:var(--ink);font-size:14.5px;">${label}</span>
            <span style="display:flex;align-items:center;gap:6px;">
              <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--ink);">$${amt.toFixed(0)}</span>
              <span style="color:var(--text-muted);">→</span>
            </span>
          </button>
        `).join("");
      }

      summaryEl.innerHTML = `
        <div class="card">
          <div><div class="hint">營收</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">$${revenue.toFixed(0)}</div></div>
          <div style="margin-top:14px;">
            <div class="hint">銷貨成本（包材 $${packagingCost.toFixed(0)} + 其他 $${cogsExtra.toFixed(0)}）</div>
            <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--ink);">$${totalCOGS.toFixed(0)}</div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--paper-line);">
            <div class="hint">毛利</div>
            <div style="font-family:var(--font-mono);font-size:24px;font-weight:900;color:${grossProfit>=0?"var(--ink)":"var(--rose)"};">$${grossProfit.toFixed(0)}</div>
            <div class="hint">毛利率 ${grossMarginText}</div>
          </div>
          <div style="margin-top:14px;">
            <div class="hint">營業費用</div>
            <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--ink);">$${opexTotal.toFixed(0)}</div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--paper-line);">
            <div class="hint">淨利</div>
            <div style="font-family:var(--font-mono);font-size:26px;font-weight:900;color:${netProfit>=0?"var(--ink)":"var(--rose)"};">$${netProfit.toFixed(0)}</div>
            <div class="hint">淨利率 ${netMarginText}</div>
          </div>
          <div class="hint" style="margin-top:10px;">共 ${ordersInRange.length} 張訂單（不含作廢）· ${range.start} ～ ${range.end}</div>

          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--paper-line);">
            <div class="hint" style="margin-bottom:6px;">銷貨成本明細</div>
            ${categoryRows(cogsExpenses, "cogs")}
          </div>

          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--paper-line);">
            <div class="hint" style="margin-bottom:6px;">營業費用明細</div>
            ${categoryRows(opexExpenses, "opex")}
          </div>
        </div>
      `;

      summaryEl.querySelectorAll(".expense-cat-row").forEach((btn) => {
        btn.addEventListener("click", () => {
          navigateTo("expenses", {
            costType: btn.getAttribute("data-costtype"),
            category: btn.getAttribute("data-category") || "all",
            rangeStart: range.start,
            rangeEnd: range.end,
          });
        });
      });
    } catch (err) {
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }
}
