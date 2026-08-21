// ============================================================
// 利潤總覽
// 銷貨成本 = 包材（自製商品用掉的物料）+ 進貨成本（現貨商品本身的採購成本）
//          + 其他（手動登記的銷貨成本支出，例如原料）
// 毛利 = 營收 − 銷貨成本
// 淨利 = 毛利 − 營業費用
// 只有超級管理員/管理員/唯讀主管看得到（跟 MODULES 的角色設定一致）
// 支出的登記/查詢/編輯在獨立的「支出管理」頁面，這裡只看計算結果。
// 版面採用會計報表慣例：項目靠左、金額靠右，明細緊接在對應的
// 總額下面；每一行明細都能點看更細的拆解。
// ============================================================
import { listOrders } from "./orders.js";
import { listExpensesInRange } from "./expenses.js";
import { renderDateRangePicker } from "./date-range-ui.js";
import { computePackagingCostBreakdown } from "./items.js";
import { openModal } from "./modal-ui.js";
import { linkifyErrorMessage } from "./utils.js";

export async function renderProfitPage(container, navigateTo) {
  container.innerHTML = `
    <div class="page-header"><h2>利潤總覽</h2></div>
    <div id="range-picker"></div>
    <div id="profit-summary"></div>
  `;

  const { getRange } = renderDateRangePicker(container.querySelector("#range-picker"), (range) => load(range));
  await load(getRange());

  // ---------- 會計報表慣例的一行：項目靠左，金額靠右 ----------
  function ledgerRow({ label, sub, amount, size = 16, weight = 700, color = "var(--ink)" }) {
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:9px 0;">
        <div>
          <div style="font-size:14.5px;color:var(--ink);">${label}</div>
          ${sub ? `<div class="hint">${sub}</div>` : ""}
        </div>
        <div style="font-family:var(--font-mono);font-size:${size}px;font-weight:${weight};color:${color};text-align:right;white-space:nowrap;">$${amount.toFixed(0)}</div>
      </div>
    `;
  }

  // ---------- 可點擊的子項目一行（縮排、灰階、右邊帶箭頭） ----------
  function subRow({ label, amount, onClickAttrs = "" }) {
    return `
      <button class="profit-sub-row" ${onClickAttrs} style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:8px 0 8px 14px;border:none;background:transparent;text-align:left;cursor:pointer;font-family:var(--font-body);">
        <span style="color:var(--text-muted);font-size:13.5px;">${label}</span>
        <span style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text-muted);">$${amount.toFixed(0)}</span>
          <span style="color:var(--text-muted);font-size:12px;">→</span>
        </span>
      </button>
    `;
  }

  function categoryRows(list, costType) {
    const byCategory = {};
    list.forEach((e) => {
      const label = e.category || "（未分類）";
      byCategory[label] = (byCategory[label] || 0) + e.amount;
    });
    const entries = Object.entries(byCategory);
    if (entries.length === 0) return "";
    return entries.map(([label, amt]) =>
      subRow({ label, amount: amt, onClickAttrs: `class="expense-cat-row" data-costtype="${costType}" data-category="${label === "（未分類）" ? "" : label}"` })
    ).join("");
  }

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

      // 包材（自製商品用掉的物料）跟進貨成本（現貨商品本身）是兩件不同的事，分開算
      let packagingCost = 0;
      let resaleCost = 0;
      ordersInRange.forEach((o) => {
        o.lineItems.forEach((li) => {
          const cost = li.unitCost * li.qty;
          if (li.productType === "resale") resaleCost += cost;
          else packagingCost += cost;
        });
      });

      const cogsExpenses = expenses.filter((e) => e.costType === "cogs");
      const opexExpenses = expenses.filter((e) => e.costType !== "cogs");
      const cogsExtra = cogsExpenses.reduce((s, e) => s + e.amount, 0);
      const opexTotal = opexExpenses.reduce((s, e) => s + e.amount, 0);
      const totalCOGS = packagingCost + resaleCost + cogsExtra;

      const grossProfit = revenue - totalCOGS;
      const netProfit = grossProfit - opexTotal;
      const grossMarginText = revenue > 0 ? `${((grossProfit / revenue) * 100).toFixed(1)}%` : "—";
      const netMarginText = revenue > 0 ? `${((netProfit / revenue) * 100).toFixed(1)}%` : "—";

      summaryEl.innerHTML = `
        <div class="card">
          ${ledgerRow({ label: "營收", amount: revenue, size: 20 })}

          <div style="border-top:1px solid var(--paper-line);margin-top:4px;padding-top:4px;">
            ${ledgerRow({ label: "銷貨成本", amount: totalCOGS, size: 18 })}
            ${subRow({ label: "包材", amount: packagingCost, onClickAttrs: `id="btn-packaging-detail"` })}
            ${subRow({ label: "進貨成本", amount: resaleCost, onClickAttrs: `id="btn-resale-detail"` })}
            ${categoryRows(cogsExpenses, "cogs")}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "毛利", sub: `毛利率 ${grossMarginText}`, amount: grossProfit, size: 22, weight: 900, color: grossProfit>=0?"var(--ink)":"var(--rose)" })}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "營業費用", amount: opexTotal, size: 18 })}
            ${categoryRows(opexExpenses, "opex")}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "淨利", sub: `淨利率 ${netMarginText}`, amount: netProfit, size: 24, weight: 900, color: netProfit>=0?"var(--ink)":"var(--rose)" })}
          </div>

          <div class="hint" style="margin-top:12px;">共 ${ordersInRange.length} 張訂單（不含作廢）· ${range.start} ～ ${range.end}</div>
        </div>
      `;

      summaryEl.querySelector("#btn-packaging-detail").addEventListener("click", () => {
        openPackagingDetailModal(range, ordersInRange);
      });
      summaryEl.querySelector("#btn-resale-detail").addEventListener("click", () => {
        openResaleDetailModal(range, ordersInRange);
      });
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
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  // ---------- 明細表格（簡單表格，靠右對齊金額，跟主卡片同一套視覺語言） ----------
  function detailTable(entries, emptyText) {
    if (entries.length === 0) return `<div class="hint" style="padding:8px 0;">${emptyText}</div>`;
    return `<table class="simple-table">${entries.map(([label, amt, extra]) =>
      `<tr><td>${label}${extra ? `<span class="hint"> · ${extra}</span>` : ""}</td><td style="text-align:right;font-family:var(--font-mono);font-weight:600;">$${amt.toFixed(0)}</td></tr>`
    ).join("")}</table>`;
  }

  async function openPackagingDetailModal(range, ordersInRange) {
    const overlay = openModal(`
      <h3 style="margin-bottom:4px;">包材成本拆解</h3>
      <div class="hint" style="margin-bottom:16px;">${range.start} ～ ${range.end}</div>
      <div style="font-weight:600;color:var(--ink);margin-bottom:8px;">依商品</div>
      <div id="packaging-by-product" style="margin-bottom:20px;"></div>
      <div style="font-weight:600;color:var(--ink);margin-bottom:8px;">依包材項目</div>
      <div id="packaging-by-item">載入中…</div>
    `, 460);

    const byProduct = new Map();
    ordersInRange.forEach((o) => {
      o.lineItems.forEach((li) => {
        if (li.productType === "resale") return;
        const cost = li.unitCost * li.qty;
        if (cost <= 0) return;
        byProduct.set(li.productName, (byProduct.get(li.productName) || 0) + cost);
      });
    });
    const productEntries = [...byProduct.entries()].sort((a, b) => b[1] - a[1]);
    overlay.querySelector("#packaging-by-product").innerHTML = detailTable(productEntries, "這段期間沒有資料");

    try {
      const breakdown = await computePackagingCostBreakdown(range.start, range.end);
      const itemEntries = breakdown.map((b) => [b.itemName, b.cost, `用了 ${b.qty}`]);
      overlay.querySelector("#packaging-by-item").innerHTML = detailTable(itemEntries, "這段期間沒有資料");
    } catch (err) {
      overlay.querySelector("#packaging-by-item").innerHTML = `<div class="hint" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  function openResaleDetailModal(range, ordersInRange) {
    const byProduct = new Map();
    ordersInRange.forEach((o) => {
      o.lineItems.forEach((li) => {
        if (li.productType !== "resale") return;
        const cost = li.unitCost * li.qty;
        if (cost <= 0) return;
        byProduct.set(li.productName, (byProduct.get(li.productName) || 0) + cost);
      });
    });
    const entries = [...byProduct.entries()].sort((a, b) => b[1] - a[1]);
    openModal(`
      <h3 style="margin-bottom:4px;">進貨成本拆解</h3>
      <div class="hint" style="margin-bottom:16px;">${range.start} ～ ${range.end}　·　依商品</div>
      ${detailTable(entries, "這段期間沒有資料")}
    `, 420);
  }
}
