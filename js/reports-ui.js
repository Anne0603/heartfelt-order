// ============================================================
// 統計報表：商品銷售排行、客戶消費排名、出貨量趨勢、平均客單價、
// 訂購管道分析、收款狀況總覽、新客戶 vs 回購客戶、商品分類銷售占比
// ============================================================
import { listOrders } from "./orders.js";
import { listItems, buildItemsIndex } from "./items.js";
import { PAYMENT_STATUS_LABELS } from "./orders.js";
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
      const [allOrders, items] = await Promise.all([listOrders(), listItems({ includeArchived: true })]);
      const itemsById = buildItemsIndex(items);
      const inRange = allOrders.filter((o) => !o.voided && o.orderDate >= range.start && o.orderDate <= range.end);

      // ---------- 概覽數字 ----------
      const revenue = inRange.reduce((s, o) => s + o.totalAmount, 0);
      const avgOrderValue = inRange.length > 0 ? revenue / inRange.length : 0;

      // ---------- 商品銷售排行 ----------
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

      // ---------- 商品分類銷售占比 ----------
      const categoryStats = new Map();
      inRange.forEach((o) => {
        o.lineItems.forEach((li) => {
          const item = itemsById.get(li.productId);
          const cat = item?.category || "未分類";
          categoryStats.set(cat, (categoryStats.get(cat) || 0) + li.subtotal);
        });
      });
      const topCategories = [...categoryStats.entries()].sort((a, b) => b[1] - a[1]);
      const maxCategoryRevenue = topCategories.length ? topCategories[0][1] : 0;

      // ---------- 客戶消費排名 ----------
      const customerStats = new Map();
      inRange.forEach((o) => {
        const name = o.contactName || "（未指定客戶）";
        customerStats.set(name, (customerStats.get(name) || 0) + o.totalAmount);
      });
      const topCustomers = [...customerStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const maxCustomerRevenue = topCustomers.length ? topCustomers[0][1] : 0;

      // ---------- 訂購管道分析 ----------
      const channelStats = new Map();
      inRange.forEach((o) => {
        const ch = o.orderChannel || "未指定";
        const cur = channelStats.get(ch) || { count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += o.totalAmount;
        channelStats.set(ch, cur);
      });
      const topChannels = [...channelStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
      const maxChannelRevenue = topChannels.length ? topChannels[0][1].revenue : 0;

      // ---------- 收款狀況總覽 ----------
      const paymentStats = { unpaid: { count: 0, amount: 0 }, deposit: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 } };
      inRange.forEach((o) => {
        paymentStats[o.paymentStatus].count += 1;
        paymentStats[o.paymentStatus].amount += o.totalAmount;
      });

      // ---------- 新客戶 vs 回購客戶 ----------
      const firstOrderDateByCustomer = new Map();
      allOrders.filter((o) => !o.voided && o.contactId).forEach((o) => {
        const cur = firstOrderDateByCustomer.get(o.contactId);
        if (!cur || o.orderDate < cur) firstOrderDateByCustomer.set(o.contactId, o.orderDate);
      });
      const newCustomers = new Set();
      const repeatCustomers = new Set();
      let newRevenue = 0, repeatRevenue = 0;
      inRange.filter((o) => o.contactId).forEach((o) => {
        const firstDate = firstOrderDateByCustomer.get(o.contactId);
        if (firstDate >= range.start) {
          newCustomers.add(o.contactId);
          newRevenue += o.totalAmount;
        } else {
          repeatCustomers.add(o.contactId);
          repeatRevenue += o.totalAmount;
        }
      });

      // ---------- 出貨量趨勢 ----------
      const shipStats = new Map();
      inRange.filter((o) => ["shipped", "done"].includes(o.shipStatus)).forEach((o) => {
        shipStats.set(o.orderDate, (shipStats.get(o.orderDate) || 0) + 1);
      });
      const shipDates = [...shipStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const maxShipCount = shipDates.length ? Math.max(...shipDates.map((d) => d[1])) : 0;

      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">訂單數</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">${inRange.length}</div></div>
            <div><div class="hint">平均客單價</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">$${avgOrderValue.toFixed(0)}</div></div>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">收款狀況總覽</h3>
          <table class="simple-table">
            <tr><td>未收款</td><td>${paymentStats.unpaid.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--rose);">$${paymentStats.unpaid.amount.toFixed(0)}</td></tr>
            <tr><td>已收訂金</td><td>${paymentStats.deposit.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--gold-deep);">$${paymentStats.deposit.amount.toFixed(0)}</td></tr>
            <tr><td>已付清</td><td>${paymentStats.paid.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--jade);">$${paymentStats.paid.amount.toFixed(0)}</td></tr>
          </table>
          <div class="hint" style="margin-top:8px;">「已收訂金」的金額是整張訂單金額，不是實際訂金數字，僅供參考還有哪些單沒收齊。</div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">新客戶 vs 回購客戶</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">新客戶</div><div style="font-family:var(--font-mono);font-size:20px;font-weight:700;">${newCustomers.size} 人</div><div class="hint">營收 $${newRevenue.toFixed(0)}</div></div>
            <div><div class="hint">回購客戶</div><div style="font-family:var(--font-mono);font-size:20px;font-weight:700;">${repeatCustomers.size} 人</div><div class="hint">營收 $${repeatRevenue.toFixed(0)}</div></div>
          </div>
          <div class="hint" style="margin-top:8px;">只統計有指定客戶的訂單；「新」指這是該客戶有史以來第一次在這段期間下單。</div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">訂購管道分析</h3>
          ${topChannels.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            topChannels.map(([ch, s]) => barRow(`${ch}（${s.count} 張）`, s.revenue, maxChannelRevenue, (v) => `$${v.toFixed(0)}`)).join("")}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">商品分類銷售占比</h3>
          ${topCategories.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            topCategories.map(([cat, revenue]) => barRow(cat, revenue, maxCategoryRevenue, (v) => `$${v.toFixed(0)}`)).join("")}
        </div>

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
