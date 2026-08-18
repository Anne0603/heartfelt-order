// ============================================================
// 統計報表：商品銷售排行、出貨量趨勢、客戶消費排名
// ============================================================
import { listOrders } from "./orders.js";
import { renderDateRangePicker } from "./date-range-ui.js";

function barRow(label, value, maxValue, formatValue) {
  const pct = maxValue > 0 ? Math.max(4, (value / maxValue) * 100) : 0;
  return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
        <span>${label}</span><span style="font-family:var(--font-mono);">${formatValue(value)}</span>
      </div>
      <div style="background:var(--paper);border-radius:6px;height:8px;overflow:hidden;">
        <div style="background:var(--gold-deep);height:100%;width:${pct}%;"></div>
      </div>
    </div>
  `;
}

export async function renderReportsPage(container) {
  container.innerHTML = `
    <div class="page-header"><h2>統計報表</h2></div>
    <div id="range-picker"></div>
    <div id="reports-content"></div>
  `;

  const { getRange } = renderDateRangePicker(container.querySelector("#range-picker"), (range) => load(range));
  await load(getRange());

  async function load(range) {
    const contentEl = container.querySelector("#reports-content");
    contentEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const orders = await listOrders();
      const inRange = orders.filter((o) => !o.voided && o.orderDate >= range.start && o.orderDate <= range.end);

      // 商品銷售排行
      const productStats = new Map();
      inRange.forEach((o) => {
        o.lineItems.forEach((li) => {
          const cur = productStats.get(li.productName) || { qty: 0, revenue: 0 };
          cur.qty += li.qty;
          cur.revenue += li.subtotal;
          productStats.set(li.productName, cur);
        });
      });
      const topProducts = [...productStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
      const maxProductRevenue = topProducts.length ? topProducts[0][1].revenue : 0;

      // 客戶消費排名
      const customerStats = new Map();
      inRange.forEach((o) => {
        const name = o.contactName || "（未指定客戶）";
        customerStats.set(name, (customerStats.get(name) || 0) + o.totalAmount);
      });
      const topCustomers = [...customerStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const maxCustomerRevenue = topCustomers.length ? topCustomers[0][1] : 0;

      // 出貨量趨勢（依日期分組，只算已出貨/已完成）
      const shipStats = new Map();
      inRange.filter((o) => ["shipped", "done"].includes(o.shipStatus)).forEach((o) => {
        shipStats.set(o.orderDate, (shipStats.get(o.orderDate) || 0) + 1);
      });
      const shipDates = [...shipStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const maxShipCount = shipDates.length ? Math.max(...shipDates.map((d) => d[1])) : 0;

      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">商品銷售排行（依營收）</h3>
          ${topProducts.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            topProducts.map(([name, s]) => barRow(`${name}（${s.qty} 份）`, s.revenue, maxProductRevenue, (v) => `$${v.toFixed(0)}`)).join("")}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">客戶消費排名</h3>
          ${topCustomers.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            topCustomers.map(([name, revenue]) => barRow(name, revenue, maxCustomerRevenue, (v) => `$${v.toFixed(0)}`)).join("")}
        </div>

        <div class="card">
          <h3 style="font-size:15px;margin-bottom:12px;">出貨量趨勢（依日期）</h3>
          ${shipDates.length === 0 ? `<div class="hint">這段期間沒有已出貨的訂單</div>` :
            shipDates.map(([date, count]) => barRow(date, count, maxShipCount, (v) => `${v} 張`)).join("")}
        </div>
      `;
    } catch (err) {
      contentEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }
}
