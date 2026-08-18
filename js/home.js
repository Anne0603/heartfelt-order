// ============================================================
// 首頁儀表板
// 第一層：今天要做的事（全部角色，不含金額）
// 第二層：快速操作按鈕（依角色顯示）
// ============================================================
import { currentSession } from "./auth.js";
import { lowStockItems } from "./inventory.js";

const QUICK_ACTIONS = [
  { id: "orders",    label: "新增訂單",     icon: "📝", roles: ["superadmin","admin","order_staff"] },
  { id: "inventory", label: "採購入庫",     icon: "📦", roles: ["superadmin","admin","order_staff"] },
  { id: "orders",    label: "訂單列表",     icon: "🔍", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "今日出貨",     icon: "🚚", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "products",  label: "商品管理",     icon: "🏷️", roles: ["superadmin","admin"] },
  { id: "customers", label: "客戶列表",     icon: "📇", roles: ["superadmin","admin","order_staff","viewer"] },
];

export async function renderHomePage(container, navigateTo) {
  const role = currentSession.member?.role;

  container.innerHTML = `
    <div class="page-header"><h2>首頁</h2></div>
    <div id="home-stats" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
      <div class="card" style="padding:16px;">
        <div class="hint">待處理訂單</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);">－</div>
      </div>
      <div class="card" style="padding:16px;">
        <div class="hint">今日應出貨</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);">－</div>
      </div>
      <div class="card" style="padding:16px;grid-column:span 2;" id="low-stock-card">
        <div class="hint">低庫存項目</div>
        <div style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);" id="low-stock-count">載入中…</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;" id="quick-actions"></div>
  `;

  const actionsEl = container.querySelector("#quick-actions");
  actionsEl.innerHTML = QUICK_ACTIONS.filter((a) => a.roles.includes(role)).map((a) => `
    <button class="card" data-goto="${a.id}" style="cursor:pointer;border:none;text-align:center;padding:18px 8px;font-family:var(--font-body);">
      <div style="font-size:26px;margin-bottom:6px;">${a.icon}</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--ink);">${a.label}</div>
    </button>
  `).join("");
  actionsEl.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.getAttribute("data-goto")));
  });

  // 低庫存數量
  try {
    const low = await lowStockItems();
    const countEl = container.querySelector("#low-stock-count");
    countEl.textContent = low.length;
    countEl.style.color = low.length > 0 ? "var(--rose)" : "var(--ink)";
    const card = container.querySelector("#low-stock-card");
    card.style.cursor = "pointer";
    card.addEventListener("click", () => navigateTo("inventory"));
  } catch (err) {
    container.querySelector("#low-stock-count").textContent = "—";
  }
}
