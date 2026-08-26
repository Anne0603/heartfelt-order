// ============================================================
// 主程式：登入流程 + 側邊導覽 + 簡易路由
// ============================================================
import { loginWithGoogle, logout, watchAuthState, currentSession, ROLE_LABELS, getDisplayName } from "./auth.js";
import { iconHtml } from "./icons.js";
import { pageNavHtml, wirePageNav } from "./page-nav.js";
import { openProfileModal } from "./profile-ui.js";
import { renderCloudinaryPage, renderPendingPage, renderMembersPage, renderCategoriesPage, renderUnitsPage, getPendingCount } from "./settings.js";
import { renderHomePage } from "./home.js";
import { renderItemsPage } from "./items-ui.js";
import { clearFab } from "./fab-ui.js";
import { renderContactsPage } from "./contacts-ui.js";
import { renderOrdersPage } from "./orders-ui.js";
import { renderReportsPage } from "./reports-ui.js";
import { renderProfitPage } from "./profit-ui.js";
import { renderActivityLogPage } from "./activity-log-ui.js";
import { renderExpensesPage } from "./expenses-ui.js";
import { lowStockItems } from "./items.js";
import { listOrders, getPaymentStatus } from "./orders.js";
import { showToast } from "./utils.js";
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- 品牌圖案：統一套用在登入頁 / 側邊欄 / 每個人的頭像位置 ----------
let brandLogoUrl = null;
const BRAND_LOGO_CACHE_KEY = "heartfelt-brand-logo-url";

function applyBrandLogoToDom(url) {
  document.querySelectorAll(".login-seal, .brand-seal, .user-avatar").forEach((el) => {
    el.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  });
}

async function loadAndApplyBrandLogo() {
  // 先用上次記住的圖案立即顯示，不用等資料庫回應才換圖，避免每次打開都閃一下
  try {
    const cached = localStorage.getItem(BRAND_LOGO_CACHE_KEY);
    if (cached) {
      brandLogoUrl = cached;
      applyBrandLogoToDom(cached);
    }
  } catch (err) {
    // localStorage 不可用（例如無痕模式限制）就跳過，不影響後續正常流程
  }

  try {
    const snap = await getDoc(doc(db, "publicSettings", "brand"));
    const fresh = snap.exists() ? (snap.data().logoUrl || null) : null;
    if (fresh && fresh !== brandLogoUrl) {
      brandLogoUrl = fresh;
      applyBrandLogoToDom(fresh);
    }
    try {
      if (fresh) localStorage.setItem(BRAND_LOGO_CACHE_KEY, fresh);
      else localStorage.removeItem(BRAND_LOGO_CACHE_KEY);
    } catch (err) { /* 忽略 */ }
  } catch (err) {
    // 抓不到最新的就先用快取顯示的，不用特別處理
  }
}
loadAndApplyBrandLogo();

const MODULES = [
  { id: "home",      label: "首頁",           icon: "house", group: "", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "訂單管理",       icon: "clipboard", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "items",     label: "商品與庫存",     icon: "box", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "contacts",  label: "客戶與廠商",     icon: "idcard", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "reports",   label: "統計報表",       icon: "chart", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "profit",    label: "利潤總覽",       icon: "coin", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "expenses",  label: "支出管理",       icon: "cash", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "cloudinary", label: "Cloudinary",   icon: "cloud", group: "超級管理員", roles: ["superadmin"] },
  { id: "categories", label: "分類管理",       icon: "tag", group: "超級管理員", roles: ["superadmin"] },
  { id: "units",      label: "單位管理",       icon: "ruler", group: "超級管理員", roles: ["superadmin"] },
  { id: "activity",  label: "操作紀錄",       icon: "scroll", group: "超級管理員", roles: ["superadmin"] },
  { id: "pending",    label: "待審核申請",     icon: "clock", group: "超級管理員", roles: ["superadmin"] },
  { id: "members",    label: "成員",         icon: "users", group: "超級管理員", roles: ["superadmin"] },
];

const loginScreen = document.getElementById("login-screen");
const pendingScreen = document.getElementById("pending-screen");
const appShell = document.getElementById("app-shell");
const loginError = document.getElementById("login-error");
const loginLoading = document.getElementById("login-loading");
const btnGoogleLogin = document.getElementById("btn-google-login");
const pendingEmailText = document.getElementById("pending-email-text");
const btnPendingLogout = document.getElementById("btn-pending-logout");
const navContainer = document.getElementById("nav-container");
const mainContent = document.getElementById("main-content");
const userChipName = document.getElementById("user-chip-name");
const userChipRole = document.getElementById("user-chip-role");
const userAvatar = document.getElementById("user-avatar");
const btnLogout = document.getElementById("btn-logout");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const btnMenuToggle = document.getElementById("btn-menu-toggle");
const btnTopbarHome = document.getElementById("btn-topbar-home");
const topbarGreeting = document.getElementById("topbar-greeting");
const btnOpenProfile = document.getElementById("btn-open-profile");
const btnRefreshDesktop = document.getElementById("btn-refresh-desktop");
const btnNotifBell = document.getElementById("btn-notif-bell");
const notifBadge = document.getElementById("notif-badge");
const notifDropdown = document.getElementById("notif-dropdown");

let currentModule = "home";
let myRole = null;
let pendingModuleFilter = null;

// ---------- 側邊欄：桌面收合 / 手機抽屜 ----------
const SIDEBAR_COLLAPSE_KEY = "heartfelt-order:sidebarCollapsed";
const isMobileViewport = () => window.matchMedia("(max-width: 720px)").matches;

function applyStoredCollapseState() {
  if (isMobileViewport()) return;
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  sidebar.classList.toggle("collapsed", collapsed);
}
function openMobileDrawer() {
  sidebar.classList.add("mobile-open");
  sidebarBackdrop.classList.add("show");
}
function closeMobileDrawer() {
  sidebar.classList.remove("mobile-open");
  sidebarBackdrop.classList.remove("show");
}
function toggleDesktopCollapse() {
  const collapsed = sidebar.classList.toggle("collapsed");
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
}
btnMenuToggle.addEventListener("click", () => {
  if (isMobileViewport()) openMobileDrawer();
  else toggleDesktopCollapse();
});
btnTopbarHome.addEventListener("click", () => goToModule("home"));
sidebarBackdrop.addEventListener("click", closeMobileDrawer);
window.addEventListener("resize", () => {
  if (!isMobileViewport()) {
    closeMobileDrawer();
    applyStoredCollapseState();
  }
});
applyStoredCollapseState();

// ---------- 登入 / 登出 ----------
btnGoogleLogin.addEventListener("click", async () => {
  loginError.classList.remove("show");
  loginLoading.classList.add("show");
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
  } catch (err) {
    console.error(err);
    loginError.textContent = "登入失敗：" + (err.message || "未知錯誤");
    loginError.classList.add("show");
  } finally {
    loginLoading.classList.remove("show");
    btnGoogleLogin.disabled = false;
  }
});
btnLogout.addEventListener("click", () => logout());
btnPendingLogout.addEventListener("click", () => logout());

function hardRefresh() {
  location.reload();
}
btnRefreshDesktop.addEventListener("click", hardRefresh);

// ---------- 側邊導覽（依角色過濾） ----------
function visibleModules() {
  return MODULES.filter((m) => myRole && m.roles.includes(myRole));
}

function renderNav() {
  const mods = visibleModules();
  const groups = [...new Set(mods.map((m) => m.group))];
  navContainer.innerHTML = groups.map((group) => `
    <div class="nav-group">
      ${group ? `<div class="nav-label">${group}</div>` : ""}
      ${mods.filter((m) => m.group === group).map((m) => `
        <div class="nav-item ${m.id === currentModule ? "active" : ""}" data-module="${m.id}">
          <span class="nav-icon">${iconHtml(m.icon)}</span><span>${m.label}</span>
        </div>
      `).join("")}
    </div>
  `).join("");

  navContainer.querySelectorAll("[data-module]").forEach((el) => {
    el.addEventListener("click", () => {
      goToModule(el.getAttribute("data-module"));
    });
  });
}

function goToModule(id, filter = null) {
  pendingModuleFilter = filter;
  const newHash = `#/${id}`;
  if (location.hash === newHash) {
    // hash 沒有變化不會觸發 hashchange，這裡手動渲染一次，避免點同一個項目沒反應
    currentModule = id;
    renderNav();
    renderCurrentModule();
  } else {
    location.hash = newHash; // 交給 hashchange -> handleHashRoute 統一負責渲染，避免同一頁被畫兩次
  }
  if (isMobileViewport()) closeMobileDrawer();
}

// ---------- 頁面內容 ----------
async function renderCurrentModule() {
  clearFab();
  const meta = MODULES.find((m) => m.id === currentModule) || MODULES[0];

  if (!meta.roles.includes(myRole)) {
    mainContent.innerHTML = `
      ${pageNavHtml("沒有權限")}
      <div class="card placeholder-page">
        <div class="icon-badge">心</div>
        <h3>無法使用這個功能</h3>
      </div>
    `;
    wirePageNav(mainContent);
    return;
  }

  if (currentModule === "home") return renderHomePage(mainContent, goToModule);
  if (currentModule === "items") {
    const filter = pendingModuleFilter;
    pendingModuleFilter = null;
    await renderItemsPage(mainContent, filter);
    refreshNotifBell();
    return;
  }
  if (currentModule === "orders") {
    const filter = pendingModuleFilter;
    pendingModuleFilter = null;
    return renderOrdersPage(mainContent, filter);
  }
  if (currentModule === "contacts") return renderContactsPage(mainContent);
  if (currentModule === "reports") return renderReportsPage(mainContent);
  if (currentModule === "profit") return renderProfitPage(mainContent, goToModule);
  if (currentModule === "activity") return renderActivityLogPage(mainContent);
  if (currentModule === "expenses") {
    const filter = pendingModuleFilter;
    pendingModuleFilter = null;
    return renderExpensesPage(mainContent, filter);
  }
  if (currentModule === "cloudinary") return renderCloudinaryPage(mainContent);
  if (currentModule === "categories") return renderCategoriesPage(mainContent);
  if (currentModule === "units") return renderUnitsPage(mainContent);
  if (currentModule === "pending") {
    await renderPendingPage(mainContent);
    if (myRole === "superadmin") refreshNotifBell();
    return;
  }
  if (currentModule === "members") return renderMembersPage(mainContent);

  mainContent.innerHTML = `
    ${pageNavHtml(meta.label)}
    <div class="card placeholder-page">
      <div class="icon-badge">心</div>
      <h3>${meta.label}即將推出</h3>
    </div>
  `;
  wirePageNav(mainContent);
}

function handleHashRoute() {
  const hash = location.hash.replace("#/", "");
  const mods = visibleModules();
  const valid = mods.some((m) => m.id === hash);
  currentModule = valid ? hash : (mods.find(m=>m.id==='home') ? 'home' : (mods[0]?.id || "orders"));
  renderNav();
  renderCurrentModule();
}
window.addEventListener("hashchange", handleHashRoute);

// ---------- 畫面狀態切換 ----------
function showLoginScreen() {
  loginScreen.style.display = "flex";
  pendingScreen.style.display = "none";
  appShell.classList.remove("show");
  clearFab();
}
function showPendingScreen(user) {
  loginScreen.style.display = "none";
  pendingScreen.style.display = "flex";
  appShell.classList.remove("show");
  pendingEmailText.textContent = `${user.email} 的存取申請已送出，審核中，請聯絡管理員核准後再回來登入`;
  clearFab();
}
function showApp(user, member) {
  loginScreen.style.display = "none";
  pendingScreen.style.display = "none";
  appShell.classList.add("show");

  myRole = member.role;
  const displayName = getDisplayName();
  userChipName.textContent = displayName;
  userChipRole.textContent = ROLE_LABELS[member.role] || member.role;
  topbarGreeting.textContent = `Hi, ${displayName}`;
  if (brandLogoUrl) {
    userAvatar.innerHTML = `<img src="${brandLogoUrl}" alt="">`;
  } else {
    userAvatar.textContent = "心";
  }

  btnNotifBell.style.display = "flex";
  refreshNotifBell();

  handleHashRoute();
}

btnOpenProfile.addEventListener("click", () => {
  openProfileModal({
    brandLogoUrl,
    onBrandUpdated: (url) => {
      brandLogoUrl = url;
      applyBrandLogoToDom(url);
      try { localStorage.setItem(BRAND_LOGO_CACHE_KEY, url); } catch (err) { /* 忽略 */ }
    },
  });
});

async function refreshNotifBell() {
  try {
    const low = await lowStockItems();
    let pendingCount = 0;
    if (myRole === "superadmin") {
      pendingCount = await getPendingCount();
    }

    let overdueCount = 0, todayCount = 0, unpaidDoneCount = 0;
    try {
      const orders = await listOrders();
      const active = orders.filter((o) => !o.voided);
      const today = new Date().toISOString().slice(0, 10);
      overdueCount = active.filter((o) => o.expectedDate && o.expectedDate < today && !["shipped", "done"].includes(o.shipStatus)).length;
      todayCount = active.filter((o) => o.expectedDate === today && !["shipped", "done"].includes(o.shipStatus)).length;
      unpaidDoneCount = active.filter((o) => o.shipStatus === "done" && getPaymentStatus(o) !== "paid").length;
    } catch (err) {
      // 訂單載入失敗不影響其他通知照常顯示
    }

    const total = low.length + pendingCount + overdueCount + todayCount + unpaidDoneCount;
    if (total > 0) {
      notifBadge.textContent = total;
      notifBadge.style.display = "flex";
    } else {
      notifBadge.style.display = "none";
    }
    notifDropdown.innerHTML = "";
    if (total === 0) {
      notifDropdown.innerHTML = `<div class="notif-empty">目前沒有通知</div>`;
      return;
    }
    const items = [];
    if (overdueCount > 0) items.push({ label: `<span class="notif-dot" style="background:var(--rose);"></span>${overdueCount} 張訂單已逾期未出貨`, target: "orders", filter: { quick: "overdue" } });
    if (todayCount > 0) items.push({ label: `<span class="notif-dot" style="background:var(--gold-deep);"></span>${todayCount} 張訂單今天應出貨`, target: "orders", filter: { quick: "today" } });
    if (unpaidDoneCount > 0) items.push({ label: `${iconHtml("coin")}${unpaidDoneCount} 張已完成但未收款`, target: "orders", filter: { quick: "unpaid_done" } });
    if (low.length > 0) items.push({ label: `${iconHtml("box")}${low.length} 項庫存偏低`, target: "items", filter: null });
    if (pendingCount > 0) items.push({ label: `${iconHtml("clock")}${pendingCount} 筆待審核申請`, target: "pending", filter: null });

    notifDropdown.innerHTML = items.map((it, idx) => `<button class="notif-item" data-notif-idx="${idx}">${it.label}</button>`).join("");
    notifDropdown.querySelectorAll("[data-notif-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = items[Number(btn.getAttribute("data-notif-idx"))];
        notifDropdown.classList.remove("show");
        goToModule(it.target, it.filter);
      });
    });
  } catch (err) {
    notifBadge.style.display = "none";
  }
}
btnNotifBell.addEventListener("click", (e) => {
  e.stopPropagation();
  notifDropdown.classList.toggle("show");
});
document.addEventListener("click", () => notifDropdown.classList.remove("show"));

// ---------- 離線提示：斷網時顯示橫幅，避免操作靜默失敗使用者不知道 ----------
const offlineBanner = document.getElementById("offline-banner");
function updateOnlineStatus() {
  offlineBanner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

watchAuthState({
  onSignedOut: () => showLoginScreen(),
  onActive: (user, member) => showApp(user, member),
  onPending: (user) => showPendingScreen(user),
  onError: (err) => {
    console.error(err);
    showToast("讀取權限資料失敗：" + err.message, "error");
  }
});
