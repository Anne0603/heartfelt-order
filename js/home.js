// ============================================================
// 首頁儀表板
// 第一層：統計卡片（全部角色，不含金額）
// 第二層：快速操作按鈕（依角色顯示）
// ============================================================
import { currentSession } from "./auth.js?v=20260830-81";
import { lowStockItems } from "./items.js?v=20260830-81";
import { listOrders, normalizeShipStatus } from "./orders.js?v=20260830-81";
import { iconHtml } from "./icons.js?v=20260830-81";

const QUICK_ACTIONS = [
  { id: "orders",    label: "新增訂單",     icon: "pencil", roles: ["superadmin","admin","order_staff"], filter: "openNew" },
  { id: "items",     label: "商品與庫存",   icon: "box", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "訂單列表",     icon: "search", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "expenses",  label: "支出管理",     icon: "cash", roles: ["superadmin","admin","viewer"] },
  { id: "contacts",  label: "客戶與廠商",   icon: "idcard", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "profit",    label: "利潤總覽",     icon: "coin", roles: ["superadmin","admin","viewer"] },
];

export async function renderHomePage(container, navigateTo) {
  const role = currentSession.member?.role;

  container.innerHTML = `
    <div id="home-stats" style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:26px;">
      <div class="card" style="padding:22px;cursor:pointer;position:relative;" id="pending-card">
        <div class="hint" style="font-size:14px;">待處理訂單</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:34px;font-weight:700;color:var(--ink);" id="pending-count">載入中</div>
        <span style="position:absolute;top:18px;right:18px;color:var(--text-muted);font-size:18px;">→</span>
      </div>
      <div class="card" style="padding:22px;cursor:pointer;position:relative;" id="today-ship-card">
        <div class="hint" style="font-size:14px;">今日應出貨</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:34px;font-weight:700;color:var(--ink);" id="today-ship-count">載入中</div>
        <span style="position:absolute;top:18px;right:18px;color:var(--text-muted);font-size:18px;">→</span>
      </div>
      <div class="card" style="padding:22px;cursor:pointer;position:relative;" id="overdue-card">
        <div class="hint" style="font-size:14px;">已逾期未出貨</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:34px;font-weight:700;color:var(--rose);" id="overdue-count">載入中</div>
        <span style="position:absolute;top:18px;right:18px;color:var(--text-muted);font-size:18px;">→</span>
      </div>
      <div class="card" style="padding:22px;cursor:pointer;position:relative;" id="low-stock-card">
        <div class="hint" style="font-size:14px;">低庫存項目</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:34px;font-weight:700;color:var(--ink);" id="low-stock-count">載入中</div>
        <span style="position:absolute;top:18px;right:18px;color:var(--text-muted);font-size:18px;">→</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:20px;" id="quick-actions"></div>
  `;

  const actionsEl = container.querySelector("#quick-actions");
  actionsEl.innerHTML = QUICK_ACTIONS.filter((a) => a.roles.includes(role)).map((a) => `
    <button class="card" data-goto="${a.id}" data-filter="${a.filter || ""}" style="cursor:pointer;border:none;text-align:center;padding:26px 12px;font-family:var(--font-body);box-sizing:border-box;">
      <div style="margin-bottom:12px;color:var(--gold-deep);">${iconHtml(a.icon, "--icon-size:38px;")}</div>
      <div style="font-size:17px;font-weight:600;color:var(--ink);">${a.label}</div>
    </button>
  `).join("");
  actionsEl.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-goto");
      const filter = btn.getAttribute("data-filter");
      let filterObj = null;
      if (filter === "today") filterObj = { quick: "today" };
      else if (filter === "openNew") filterObj = { openNew: true };
      navigateTo(id, filterObj);
    });
  });

  container.querySelector("#pending-card").addEventListener("click", () => navigateTo("orders", { shipStatus: "pending" }));
  container.querySelector("#today-ship-card").addEventListener("click", () => navigateTo("orders", { quick: "today" }));
  container.querySelector("#overdue-card").addEventListener("click", () => navigateTo("orders", { quick: "overdue" }));
  container.querySelector("#low-stock-card").addEventListener("click", () => navigateTo("items"));

  try {
    const orders = await listOrders();
    const active = orders.filter((o) => !o.voided);
    const today = new Date().toISOString().slice(0, 10);
    const pendingEl = container.querySelector("#pending-count");
    const todayEl = container.querySelector("#today-ship-count");
    const overdueEl = container.querySelector("#overdue-count");
    [pendingEl, todayEl, overdueEl].forEach((el) => el.classList.remove("stat-loading"));
    const overdueOrders = active.filter((o) => o.expectedDate && o.expectedDate < today && normalizeShipStatus(o.shipStatus) !== "shipped");
    const todayOrders = active.filter((o) => o.expectedDate === today && normalizeShipStatus(o.shipStatus) !== "shipped");
    pendingEl.textContent = active.filter((o) => normalizeShipStatus(o.shipStatus) === "pending").length;
    todayEl.textContent = todayOrders.length;
    overdueEl.textContent = overdueOrders.length;
  } catch (err) {
    ["#pending-count", "#today-ship-count", "#overdue-count"].forEach((sel) => {
      const el = container.querySelector(sel);
      el.classList.remove("stat-loading");
      el.textContent = "—";
    });
  }

  try {
    const low = await lowStockItems();
    const countEl = container.querySelector("#low-stock-count");
    countEl.classList.remove("stat-loading");
    countEl.textContent = low.length;
    countEl.style.color = low.length > 0 ? "var(--rose)" : "var(--ink)";
  } catch (err) {
    const countEl = container.querySelector("#low-stock-count");
    countEl.classList.remove("stat-loading");
    countEl.textContent = "—";
  }
}
