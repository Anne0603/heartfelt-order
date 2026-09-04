// ============================================================
// 主程式：登入流程 + 側邊導覽 + 簡易路由
// ============================================================
import { loginWithGoogle, logout, watchAuthState, currentSession, ROLE_LABELS, getDisplayName, consumeRedirectResult, signInWithGoogleCredential } from "./auth.js?v=20260830-99";
import { iconHtml } from "./icons.js?v=20260830-99";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-99";
import { openProfileModal, openHomeScreenTipModal } from "./profile-ui.js?v=20260830-99";
import { renderCloudinaryPage, renderPendingPage, renderMembersPage, renderCategoriesPage, renderUnitsPage, renderBackupPage, getPendingCount } from "./settings.js?v=20260830-99";
import { renderPrepListPage } from "./prep-ui.js?v=20260830-99";
import { renderRecalcCostPage } from "./recalc-ui.js?v=20260830-99";
import { renderFaqPage } from "./faq-ui.js?v=20260830-99";
import { renderHomePage } from "./home.js?v=20260830-99";
import { renderItemsPage } from "./items-ui.js?v=20260830-99";
import { clearFab } from "./fab-ui.js?v=20260830-99";
import { renderContactsPage } from "./contacts-ui.js?v=20260830-99";
import { renderOrdersPage } from "./orders-ui.js?v=20260830-99";
import { renderReportsPage } from "./reports-ui.js?v=20260830-99";
import { renderProfitPage } from "./profit-ui.js?v=20260830-99";
import { renderActivityLogPage } from "./activity-log-ui.js?v=20260830-99";
import { renderExpensesPage } from "./expenses-ui.js?v=20260830-99";
import { lowStockItems } from "./items.js?v=20260830-99";
import { listOrders, getPaymentStatus, normalizeShipStatus } from "./orders.js?v=20260830-99";
import { showToast, friendlyErrorMessage } from "./utils.js?v=20260830-99";
import { db } from "./firebase-config.js?v=20260830-99";
import { openModal } from "./modal-ui.js?v=20260830-99";
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
  { id: "faq",       label: "常見問題",       icon: "bulb", group: "", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "訂單管理",       icon: "clipboard", group: "日常", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "items",     label: "商品與庫存",     icon: "box", group: "日常", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "prep",      label: "備料清單",       icon: "grain", group: "日常", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "contacts",  label: "客戶與廠商",     icon: "idcard", group: "日常", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "reports",   label: "統計報表",       icon: "chart", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "profit",    label: "利潤總覽",       icon: "coin", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "expenses",  label: "支出管理",       icon: "cash", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "cloudinary", label: "Cloudinary",   icon: "cloud", group: "超級管理員", roles: ["superadmin"] },
  { id: "categories", label: "分類管理",       icon: "tag", group: "超級管理員", roles: ["superadmin"] },
  { id: "units",      label: "單位管理",       icon: "ruler", group: "超級管理員", roles: ["superadmin"] },
  { id: "backup",     label: "資料備份",       icon: "download", group: "超級管理員", roles: ["superadmin"] },
  { id: "recalc",     label: "重算訂單成本",   icon: "refresh", group: "超級管理員", roles: ["superadmin"] },
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
    const result = await loginWithGoogle();
    // result 為 null 代表已改走整頁轉跳（signInWithRedirect），頁面即將離開，
    // 不用在這裡處理任何後續，也不要恢復按鈕狀態，避免畫面在轉跳前閃一下。
    if (result === null) return;
  } catch (err) {
    console.error(err);
    loginError.textContent = "登入失敗：" + (err.code ? `[${err.code}] ` : "") + (friendlyErrorMessage(err) || "未知錯誤");
    loginError.classList.add("show");
  } finally {
    loginLoading.classList.remove("show");
    btnGoogleLogin.disabled = false;
  }
});
btnLogout.addEventListener("click", () => logout());
btnPendingLogout.addEventListener("click", () => logout());

// ---------- 版本更新紀錄（給使用者看的簡易版，不是技術細節） ----------
// 每次有新功能上線，在陣列最前面加一條新的即可，最新的放最上面。
const CHANGELOG = [
  { date: "2026-08-30", items: [
    "第一次登入會自動跳出「加到主畫面」教學，常見問題頁面也收錄同樣內容",
  ]},
  { date: "2026-08-30", items: [
    "成員管理頁面新增「最後上線時間」，方便看出誰已經很久沒用系統了",
  ]},
  { date: "2026-08-30", items: [
    "通知鈴鐺加入「待確認」訂單提醒，已出貨的訂單不會再提醒（東西都寄出去了，提醒也沒用）",
  ]},
  { date: "2026-08-30", items: [
    "還沒設定暱稱的成員，登入後會自動跳出提醒設定，避免畫面上顯示看不懂的英文/數字帳號",
  ]},
  { date: "2026-08-30", items: [
    "角色名稱「訂單進出貨人員」改為「小幫手」",
  ]},
  { date: "2026-08-30", items: [
    "新增「常見問題」說明頁面，內容依角色自動篩選",
    "側邊欄「營運」改名為「日常」",
    "備料清單排版改成卡片式，看禮盒展開的內容更清楚",
  ]},
  { date: "2026-08-30", items: [
    "自製商品配方支援「巢狀配方」：禮盒可以直接設定裡面裝了哪些單顆商品，成本、庫存、備料清單都會自動正確計算",
    "新增「重算訂單成本」功能（超級管理員），配方調整後可以一鍵更新還沒出貨的訂單",
  ]},
  { date: "2026-08-30", items: [
    "訂單新增「待確認」標記，方便找出還有資訊要跟客戶核對的訂單，可以直接篩選出來",
    "新增「備料清單」功能，一次看清楚要準備多少商品跟原料",
    "出貨單/批次清單新增橫向列印、待確認提示",
  ]},
  { date: "2026-08-30", items: [
    "新增退貨功能，可以登記部分/全部退貨、選擇要不要加回庫存",
    "新增一鍵資料備份、加到手機主畫面（像 App 一樣開啟）",
    "修正手機上輸入框自動放大、彈窗背景會跟著滑動等問題，操作起來更像原生 App",
  ]},
  { date: "2026-08-29", items: [
    "全站畫面整體放大，側邊欄、按鈕都更適合手機操作",
    "登入流程改為自動容錯，手機瀏覽器封鎖彈跳視窗時會自動改用整頁轉跳",
  ]},
];

function openChangelogModal() {
  const html = CHANGELOG.map((entry) => `
    <div style="margin-bottom:16px;">
      <div style="font-family:var(--font-mono);font-size:13px;color:var(--text-muted);margin-bottom:6px;">${entry.date}</div>
      <ul style="margin:0;padding-left:18px;">
        ${entry.items.map((it) => `<li style="font-size:14.5px;line-height:1.7;margin-bottom:2px;">${it}</li>`).join("")}
      </ul>
    </div>
  `).join("");
  openModal(`<h3 style="margin-bottom:14px;">版本更新紀錄</h3>${html}`, 460);
}
document.getElementById("btn-open-changelog")?.addEventListener("click", openChangelogModal);

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
  if (currentModule === "backup") return renderBackupPage(mainContent);
  if (currentModule === "recalc") return renderRecalcCostPage(mainContent);
  if (currentModule === "faq") return renderFaqPage(mainContent);
  if (currentModule === "prep") return renderPrepListPage(mainContent);
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
function showPendingScreen(user, member) {
  loginScreen.style.display = "none";
  pendingScreen.style.display = "flex";
  appShell.classList.remove("show");
  pendingEmailText.textContent = member?.status === "rejected"
    ? `${user.email} 的存取申請已被拒絕，請聯絡管理員`
    : `${user.email} 的存取申請已送出，審核中，請聯絡管理員核准後再回來登入`;
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

  // 版本更新紀錄只給管理員以上看，一般成員不需要知道系統背後做了哪些調整
  const btnChangelog = document.getElementById("btn-open-changelog");
  if (btnChangelog) btnChangelog.style.display = ["superadmin", "admin"].includes(myRole) ? "block" : "none";

  handleHashRoute();

  // 沒設定過暱稱的話，登入後自動跳出提示——靠使用者自己想起來效果
  // 通常不好，主動提醒一次比較有效。使用者還是可以關掉這個視窗跳過，
  // 但下次登入還是會再跳出來，直到真的設定為止。
  //
  // 「加到主畫面」教學是完全獨立的另一個彈窗，不跟暱稱設定塞在一起——
  // 已經設定過暱稱的人，如果同一個彈窗又跳出「還要做什麼」的內容，
  // 會顯得很突兀。只有在「暱稱已經設定好、但還沒看過教學」時，
  // 才會單獨跳出教學彈窗；如果暱稱還沒設定，這次登入只會看到暱稱
  // 提醒，等暱稱存檔（會整頁重新整理）之後，下次載入才會接著看到
  // 教學彈窗，不用在這裡手動串接兩個彈窗的先後順序。
  const needsNickname = !member.nickname;
  const needsHomeScreenTip = !member.hasSeenHomeScreenTip;
  if (needsNickname) {
    openProfileModal({
      brandLogoUrl,
      onBrandUpdated: (url) => {
        brandLogoUrl = url;
        applyBrandLogoToDom(url);
        try { localStorage.setItem(BRAND_LOGO_CACHE_KEY, url); } catch (err) { /* 忽略 */ }
      },
      mandatory: true,
    });
  } else if (needsHomeScreenTip) {
    openHomeScreenTipModal();
  }
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

    let overdueCount = 0, todayCount = 0, unpaidShippedCount = 0, needsConfirmationCount = 0, voidReviewCount = 0;
    try {
      const orders = await listOrders();
      const active = orders.filter((o) => !o.voided);
      const today = new Date().toISOString().slice(0, 10);
      overdueCount = active.filter((o) => o.expectedDate && o.expectedDate < today && normalizeShipStatus(o.shipStatus) !== "shipped").length;
      todayCount = active.filter((o) => o.expectedDate === today && normalizeShipStatus(o.shipStatus) !== "shipped").length;
      unpaidShippedCount = active.filter((o) => normalizeShipStatus(o.shipStatus) === "shipped" && getPaymentStatus(o) !== "paid").length;
      // 已經出貨的訂單不用再提醒待確認——東西都已經寄出去了，
      // 不管當初有沒有確認清楚，再提醒也於事無補
      needsConfirmationCount = active.filter((o) => o.needsConfirmation && normalizeShipStatus(o.shipStatus) !== "shipped").length;
      // 管理員作廢的訂單，要讓超級管理員確認一下不是誤觸
      if (myRole === "superadmin") {
        voidReviewCount = orders.filter((o) => o.voided && (o.voidReviewStatus === "pending" || (!o.voidReviewStatus && o.needsVoidReview))).length;
      }
    } catch (err) {
      // 訂單載入失敗不影響其他通知照常顯示
    }

    const total = low.length + pendingCount + overdueCount + todayCount + unpaidShippedCount + needsConfirmationCount + voidReviewCount;
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
    if (unpaidShippedCount > 0) items.push({ label: `${iconHtml("coin")}${unpaidShippedCount} 張已出貨但未收款`, target: "orders", filter: { quick: "unpaid_shipped" } });
    if (needsConfirmationCount > 0) items.push({ label: `${iconHtml("bulb")}${needsConfirmationCount} 張訂單還有資訊待確認`, target: "orders", filter: { quick: "needs_confirmation" } });
    if (voidReviewCount > 0) items.push({ label: `<span class="notif-dot" style="background:var(--rose);"></span>${voidReviewCount} 張訂單被管理員作廢，待確認`, target: "orders", filter: { quick: "void_review" } });
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

// 從 Google 轉跳登入頁回來後，先把結果讀出來一次：
// 主要是為了在轉跳流程本身失敗時（例如使用者中途取消）能看到明確錯誤訊息，
// 正常成功的情況會由下面的 watchAuthState / onAuthStateChanged 自動接手顯示畫面。
let hadPendingRedirect = false;
try { hadPendingRedirect = localStorage.getItem("pendingGoogleRedirect") === "1"; } catch (err) { /* 忽略 */ }
try { localStorage.removeItem("pendingGoogleRedirect"); } catch (err) { /* 忽略 */ }

consumeRedirectResult().then((result) => {
  // 只有在「剛剛真的有嘗試過整頁轉跳登入」的情況下才顯示這個診斷訊息，
  // 避免每次正常打開網頁都跳出來很煩。不管成功或失敗都會顯示，
  // 這樣使用者遇到問題時能直接截圖給我看，不會是完全看不出發生什麼事的
  // 靜默失敗。
  if (hadPendingRedirect) {
    if (result && result.user) {
      showToast("✅ 登入轉跳成功，帳號：" + result.user.email, "success");
    } else {
      showToast("⚠️ 登入轉跳沒有帶回帳號資訊（診斷訊息，請截圖回報）", "error");
    }
  }
}).catch((err) => {
  console.error(err);
  showToast("登入失敗：" + (err.code ? `[${err.code}] ` : "") + (friendlyErrorMessage(err) || "未知錯誤"), "error");
});

// ---------- 獨立模式（加到主畫面）專用登入：Google Identity Services ----------
// popup 在獨立模式下常常完全沒反應，redirect 在獨立模式下又常常轉跳
// 回來後遺失登入結果，這兩個都試過而且都失敗了。這裡改用 Google 官方
// 的 Identity Services 元件，不透過 Firebase 的 popup/redirect 機制，
// 理論上比較有機會在獨立模式下正常運作。只在獨立模式下啟用，一般
// Safari 分頁維持原本正常運作的登入方式不變。
const GOOGLE_CLIENT_ID = "497539783911-5m8nr09pirodb5ngd4vt0q5hvcfj7dha.apps.googleusercontent.com";

function isStandaloneModeForGIS() {
  return window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
}

if (isStandaloneModeForGIS()) {
  document.getElementById("normal-login-guide").style.display = "none";
  const guide = document.getElementById("standalone-login-guide");
  guide.style.display = "block";
  const errEl = document.getElementById("standalone-login-error");

  // Google 的官方腳本是用 async defer 載入的，這裡不能保證它已經載入
  // 完成，用輪詢的方式等它準備好，最多等 8 秒，超過就顯示錯誤訊息。
  let waited = 0;
  const waitForGis = setInterval(() => {
    waited += 200;
    if (window.google?.accounts?.id) {
      clearInterval(waitForGis);
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            errEl.textContent = "";
            try {
              await signInWithGoogleCredential(response.credential);
              // 登入成功後，watchAuthState / onAuthStateChanged 會自動接手顯示主畫面
            } catch (err) {
              console.error(err);
              errEl.textContent = "登入失敗：" + (err.code ? `[${err.code}] ` : "") + (friendlyErrorMessage(err) || "未知錯誤");
            }
          },
        });
        window.google.accounts.id.renderButton(
          document.getElementById("g_id_button_container"),
          { type: "standard", theme: "outline", size: "large", width: 280, text: "signin_with", locale: "zh_TW" }
        );
      } catch (err) {
        console.error(err);
        errEl.textContent = "Google 登入元件初始化失敗，請截圖回報。";
      }
    } else if (waited >= 8000) {
      clearInterval(waitForGis);
      errEl.textContent = "Google 登入元件載入逾時，請檢查網路連線後重新整理。";
    }
  }, 200);
}

watchAuthState({
  onSignedOut: () => showLoginScreen(),
  onActive: (user, member) => showApp(user, member),
  onPending: (user, member) => showPendingScreen(user, member),
  onRevoked: () => {
    showToast("你的帳號權限已被異動（可能是被移除或角色被更改），已自動登出", "error");
  },
  onError: (err) => {
    console.error(err);
    showToast("讀取權限資料失敗：" + friendlyErrorMessage(err), "error");
  }
});
