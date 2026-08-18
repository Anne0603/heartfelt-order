// ============================================================
// 主程式：登入流程 + 側邊導覽 + 簡易路由
// ============================================================
import { loginWithGoogle, logout, watchAuthState, currentSession, ROLE_LABELS } from "./auth.js";
import { renderCloudinaryPage, renderPendingPage, renderMembersPage, renderCategoriesPage, uploadImageToCloudinary, saveBrandLogoUrl, getPendingCount } from "./settings.js";
import { renderHomePage } from "./home.js";
import { renderInventoryPage } from "./inventory-ui.js";
import { renderProductsPage } from "./products-ui.js";
import { lowStockItems } from "./inventory.js";
import { showToast } from "./utils.js";
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- 品牌圖案：統一套用在登入頁 / 側邊欄 / 每個人的頭像位置 ----------
let brandLogoUrl = null;

async function loadAndApplyBrandLogo() {
  try {
    const snap = await getDoc(doc(db, "publicSettings", "brand"));
    brandLogoUrl = snap.exists() ? (snap.data().logoUrl || null) : null;
  } catch (err) {
    brandLogoUrl = null;
  }
  if (brandLogoUrl) {
    document.querySelectorAll(".login-seal, .brand-seal, .user-avatar").forEach((el) => {
      el.innerHTML = `<img src="${brandLogoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    });
  }
}
loadAndApplyBrandLogo();

const MODULES = [
  { id: "home",      label: "首頁",           icon: "🏠", group: "", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "訂單管理",       icon: "📋", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "products",  label: "商品定價",       icon: "🏷️", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "inventory", label: "採購與庫存",     icon: "📦", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "customers", label: "客戶名單",       icon: "🙋", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "reports",   label: "統計報表",       icon: "📊", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "profit",    label: "利潤總覽",       icon: "💰", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "cloudinary", label: "Cloudinary",   icon: "☁️", group: "超級管理員", roles: ["superadmin"] },
  { id: "categories", label: "分類管理",       icon: "🏷️", group: "超級管理員", roles: ["superadmin"] },
  { id: "pending",    label: "待審核申請",     icon: "🕓", group: "超級管理員", roles: ["superadmin"] },
  { id: "members",    label: "成員",         icon: "👥", group: "超級管理員", roles: ["superadmin"] },
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
const avatarFileInput = document.getElementById("avatar-file-input");
const btnLogout = document.getElementById("btn-logout");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const btnMenuToggle = document.getElementById("btn-menu-toggle");
const btnTopbarHome = document.getElementById("btn-topbar-home");
const btnRefreshDesktop = document.getElementById("btn-refresh-desktop");
const btnNotifBell = document.getElementById("btn-notif-bell");
const notifBadge = document.getElementById("notif-badge");
const notifDropdown = document.getElementById("notif-dropdown");

let currentModule = "home";
let myRole = null;

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
          <span class="nav-icon">${m.icon}</span><span>${m.label}</span>
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

function goToModule(id) {
  currentModule = id;
  location.hash = `#/${currentModule}`;
  renderNav();
  renderCurrentModule();
  if (isMobileViewport()) closeMobileDrawer();
}

// ---------- 頁面內容 ----------
async function renderCurrentModule() {
  const meta = MODULES.find((m) => m.id === currentModule) || MODULES[0];

  if (!meta.roles.includes(myRole)) {
    mainContent.innerHTML = `
      <div class="page-header"><h2>沒有權限</h2></div>
      <div class="card placeholder-page">
        <div class="icon-badge">心</div>
        <h3>無法使用這個功能</h3>
      </div>
    `;
    return;
  }

  if (currentModule === "home") return renderHomePage(mainContent, goToModule);
  if (currentModule === "inventory") {
    await renderInventoryPage(mainContent);
    refreshNotifBell();
    return;
  }
  if (currentModule === "products") return renderProductsPage(mainContent);
  if (currentModule === "cloudinary") return renderCloudinaryPage(mainContent);
  if (currentModule === "categories") return renderCategoriesPage(mainContent);
  if (currentModule === "pending") {
    await renderPendingPage(mainContent);
    if (myRole === "superadmin") refreshNotifBell();
    return;
  }
  if (currentModule === "members") return renderMembersPage(mainContent);

  mainContent.innerHTML = `
    <div class="page-header"><h2>${meta.label}</h2></div>
    <div class="card placeholder-page">
      <div class="icon-badge">心</div>
      <h3>${meta.label}即將推出</h3>
    </div>
  `;
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
}
function showPendingScreen(user) {
  loginScreen.style.display = "none";
  pendingScreen.style.display = "flex";
  appShell.classList.remove("show");
  pendingEmailText.textContent = `${user.email} 的存取申請已送出，審核中，請聯絡管理員核准後再回來登入`;
}
function showApp(user, member) {
  loginScreen.style.display = "none";
  pendingScreen.style.display = "none";
  appShell.classList.add("show");

  myRole = member.role;
  userChipName.textContent = user.displayName || user.email;
  userChipRole.textContent = ROLE_LABELS[member.role] || member.role;
  if (brandLogoUrl) {
    userAvatar.innerHTML = `<img src="${brandLogoUrl}" alt="">`;
  } else {
    userAvatar.textContent = "心";
  }

  const canEditBrand = member.role === "superadmin" || member.role === "admin";
  document.querySelectorAll(".app-brand-seal").forEach((el) => {
    el.classList.toggle("clickable-seal", canEditBrand);
    el.title = canEditBrand ? "點擊更換品牌圖案" : "";
  });

  btnNotifBell.style.display = "flex";
  refreshNotifBell();

  handleHashRoute();
}

async function refreshNotifBell() {
  try {
    const low = await lowStockItems();
    let pendingCount = 0;
    if (myRole === "superadmin") {
      pendingCount = await getPendingCount();
    }
    const total = low.length + pendingCount;
    if (total > 0) {
      notifBadge.textContent = total;
      notifBadge.style.display = "flex";
    } else {
      notifBadge.style.display = "none";
    }
    notifDropdown.innerHTML = "";
    if (low.length === 0 && pendingCount === 0) {
      notifDropdown.innerHTML = `<div class="notif-empty">目前沒有通知</div>`;
      return;
    }
    let html = "";
    if (low.length > 0) {
      html += `<button class="notif-item" data-goto="inventory">📦 ${low.length} 項庫存偏低</button>`;
    }
    if (pendingCount > 0) {
      html += `<button class="notif-item" data-goto="pending">🕓 ${pendingCount} 筆待審核申請</button>`;
    }
    notifDropdown.innerHTML = html;
    notifDropdown.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        notifDropdown.classList.remove("show");
        goToModule(btn.getAttribute("data-goto"));
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

document.querySelectorAll(".app-brand-seal").forEach((el) => {
  el.addEventListener("click", () => {
    if (!el.classList.contains("clickable-seal")) return;
    avatarFileInput.click();
  });
});

avatarFileInput.addEventListener("change", async () => {
  const file = avatarFileInput.files?.[0];
  if (!file) return;
  try {
    const url = await uploadImageToCloudinary(file);
    await saveBrandLogoUrl(url);
    showToast("品牌圖案已更新", "success");
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    avatarFileInput.value = "";
  }
});

watchAuthState({
  onSignedOut: () => showLoginScreen(),
  onActive: (user, member) => showApp(user, member),
  onPending: (user) => showPendingScreen(user),
  onError: (err) => {
    console.error(err);
    showToast("讀取權限資料失敗：" + err.message, "error");
  }
});
