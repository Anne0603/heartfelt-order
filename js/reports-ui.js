// ============================================================
// 統計報表：分成「總覽」「銷售分析」「客戶分析」「出貨趨勢」四個分頁籤
// ============================================================
import { listOrders, getPaymentStatus, normalizeShipStatus } from "./orders.js?v=20260826-15";
import { listItems, buildItemsIndex } from "./items.js?v=20260826-15";
import { renderDateRangePicker } from "./date-range-ui.js?v=20260826-15";
import { linkifyErrorMessage } from "./utils.js?v=20260826-15";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260826-15";

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

const TABS = [
  { id: "overview", label: "總覽" },
  { id: "sales", label: "銷售分析" },
  { id: "customers", label: "客戶分析" },
  { id: "shipping", label: "出貨趨勢" },
];

export async function renderReportsPage(container) {
  let activeTab = "overview";

  container.innerHTML = `
    ${pageNavHtml("統計報表")}
    <div id="range-picker"></div>
    <div class="settings-tabs" id="report-tabs"></div>
    <div id="reports-content"></div>
  `;
  wirePageNav(container);

  const tabsEl = container.querySelector("#report-tabs");
  const contentEl = container.querySelector("#reports-content");

  function renderTabButtons() {
    tabsEl.innerHTML = TABS.map((t) => `
      <button class="settings-tab-btn ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>
    `).join("");
    tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.getAttribute("data-tab");
        renderTabButtons();
        renderTabContent();
      });
    });
  }

  let currentStats = null;

  const { getRange } = renderDateRangePicker(container.querySelector("#range-picker"), (range) => load(range));
  await load(getRange());

  async function load(range) {
    contentEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const [allOrders, items] = await Promise.all([listOrders(), listItems({ includeArchived: true })]);
      currentStats = computeStats(allOrders, items, range);
      renderTabButtons();
      renderTabContent();
    } catch (err) {
      contentEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  function computeStats(allOrders, items, range) {
    const itemsById = buildItemsIndex(items);
    const inRange = allOrders.filter((o) => !o.voided && o.orderDate >= range.start && o.orderDate <= range.end);

    const revenue = inRange.reduce((s, o) => s + o.totalAmount, 0);
    const avgOrderValue = inRange.length > 0 ? revenue / inRange.length : 0;

    // 商品銷售排行
    const productStats = new Map();
    inRange.forEach((o) => {
      o.lineItems.forEach((li) => {
        const cur = productStats.get(li.productName) || { qty: 0, revenue: 0, cost: 0 };
        cur.qty += li.qty;
        cur.revenue += li.subtotal;
        cur.cost += li.unitCost * li.qty;
        productStats.set(li.productName, cur);
      });
    });
    const topProducts = [...productStats.entries()].sort((a, b) => b[1].qty - a[1].qty);

    // 商品分類銷售占比
    const categoryStats = new Map();
    inRange.forEach((o) => {
      o.lineItems.forEach((li) => {
        const item = itemsById.get(li.productId);
        const cat = item?.category || "未分類";
        categoryStats.set(cat, (categoryStats.get(cat) || 0) + li.subtotal);
      });
    });
    const topCategories = [...categoryStats.entries()].sort((a, b) => b[1] - a[1]);

    // 客戶消費排名
    const customerStats = new Map();
    inRange.forEach((o) => {
      const name = o.contactName || "（未指定客戶）";
      customerStats.set(name, (customerStats.get(name) || 0) + o.totalAmount);
    });
    const topCustomers = [...customerStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    // 訂購管道分析
    const channelStats = new Map();
    inRange.forEach((o) => {
      const ch = o.orderChannel || "未指定";
      const cur = channelStats.get(ch) || { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += o.totalAmount;
      channelStats.set(ch, cur);
    });
    const topChannels = [...channelStats.entries()].sort((a, b) => b[1].revenue - a[1].revenue);

    // 收款狀況總覽（用實收金額精準計算）
    const paymentStats = { unpaid: { count: 0, amount: 0 }, deposit: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 } };
    let outstandingTotal = 0;
    inRange.forEach((o) => {
      const status = getPaymentStatus(o);
      paymentStats[status].count += 1;
      paymentStats[status].amount += o.totalAmount;
      outstandingTotal += o.totalAmount - (o.amountReceived || 0);
    });

    // 新客戶 vs 回購客戶
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
      if (firstDate >= range.start) { newCustomers.add(o.contactId); newRevenue += o.totalAmount; }
      else { repeatCustomers.add(o.contactId); repeatRevenue += o.totalAmount; }
    });

    // 出貨量趨勢
    const shipStats = new Map();
    inRange.filter((o) => normalizeShipStatus(o.shipStatus) === "shipped").forEach((o) => {
      shipStats.set(o.orderDate, (shipStats.get(o.orderDate) || 0) + 1);
    });
    const shipDates = [...shipStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    return {
      range, orderCount: inRange.length, revenue, avgOrderValue,
      topProducts, topCategories, topCustomers, topChannels,
      paymentStats, outstandingTotal,
      newCustomers, repeatCustomers, newRevenue, repeatRevenue,
      shipDates,
    };
  }

  function renderTabContent() {
    const s = currentStats;
    if (activeTab === "overview") {
      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">訂單數</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">${s.orderCount}</div></div>
            <div><div class="hint">平均客單價</div><div style="font-family:var(--font-mono);font-size:22px;font-weight:700;">$${s.avgOrderValue.toFixed(0)}</div></div>
          </div>
        </div>
        <div class="card">
          <h3 style="font-size:15px;margin-bottom:12px;">收款狀況總覽</h3>
          <table class="simple-table">
            <tr><td>未收款</td><td>${s.paymentStats.unpaid.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--rose);">$${s.paymentStats.unpaid.amount.toFixed(0)}</td></tr>
            <tr><td>已收訂金</td><td>${s.paymentStats.deposit.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--gold-deep);">$${s.paymentStats.deposit.amount.toFixed(0)}</td></tr>
            <tr><td>已付清</td><td>${s.paymentStats.paid.count} 張</td><td style="text-align:right;font-family:var(--font-mono);color:var(--jade);">$${s.paymentStats.paid.amount.toFixed(0)}</td></tr>
          </table>
          <div class="hint" style="margin-top:10px;font-weight:600;color:var(--rose);">應收帳款總額：$${s.outstandingTotal.toFixed(0)}</div>
        </div>
      `;
    } else if (activeTab === "sales") {
      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:4px;">商品銷售排行</h3>
          <div class="hint" style="margin-bottom:10px;">依數量排序（賣得動的東西，不只是賺得多的東西）</div>
          ${s.topProducts.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` : `
            <table class="simple-table">
              <thead><tr><th>商品</th><th style="text-align:right;">數量</th><th style="text-align:right;">營收</th><th style="text-align:right;">毛利</th></tr></thead>
              <tbody>
                ${s.topProducts.map(([name, st]) => `
                  <tr>
                    <td>${name}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${st.qty}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">$${st.revenue.toFixed(0)}</td>
                    <td style="text-align:right;font-family:var(--font-mono);color:${st.revenue-st.cost>=0?"var(--jade)":"var(--rose)"};">$${(st.revenue-st.cost).toFixed(0)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `}
        </div>
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">商品分類銷售占比</h3>
          ${s.topCategories.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            s.topCategories.map(([cat, revenue]) => barRow(cat, revenue, s.topCategories[0][1], (v) => `$${v.toFixed(0)}`)).join("")}
        </div>
        <div class="card">
          <h3 style="font-size:15px;margin-bottom:12px;">訂購管道分析</h3>
          ${s.topChannels.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            s.topChannels.map(([ch, st]) => barRow(`${ch}（${st.count} 張）`, st.revenue, s.topChannels[0][1].revenue, (v) => `$${v.toFixed(0)}`)).join("")}
        </div>
      `;
    } else if (activeTab === "customers") {
      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:15px;margin-bottom:12px;">新客戶 vs 回購客戶</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
            <div><div class="hint">新客戶</div><div style="font-family:var(--font-mono);font-size:20px;font-weight:700;">${s.newCustomers.size} 人</div><div class="hint">營收 $${s.newRevenue.toFixed(0)}</div></div>
            <div><div class="hint">回購客戶</div><div style="font-family:var(--font-mono);font-size:20px;font-weight:700;">${s.repeatCustomers.size} 人</div><div class="hint">營收 $${s.repeatRevenue.toFixed(0)}</div></div>
          </div>
          <div class="hint" style="margin-top:8px;">只統計有指定客戶的訂單；「新」指這是該客戶有史以來第一次在這段期間下單。</div>
        </div>
        <div class="card">
          <h3 style="font-size:15px;margin-bottom:12px;">客戶消費排名</h3>
          ${s.topCustomers.length === 0 ? `<div class="hint">這段期間沒有訂單資料</div>` :
            s.topCustomers.map(([name, revenue]) => barRow(name, revenue, s.topCustomers[0][1], (v) => `$${v.toFixed(0)}`)).join("")}
        </div>
      `;
    } else if (activeTab === "shipping") {
      contentEl.innerHTML = `
        <div class="card">
          <h3 style="font-size:15px;margin-bottom:4px;">出貨量趨勢（依日期）</h3>
          <div class="hint" style="margin-bottom:12px;">看哪幾天出貨特別集中，方便你提前備貨、安排人手。</div>
          ${s.shipDates.length === 0 ? `<div class="hint">這段期間沒有已出貨的訂單</div>` :
            s.shipDates.map(([date, count]) => barRow(date, count, Math.max(...s.shipDates.map((d) => d[1])), (v) => `${v} 張`)).join("")}
        </div>
      `;
    }
  }
}
