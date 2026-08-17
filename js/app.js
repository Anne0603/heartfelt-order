// ============================================================
// 主程式：登入流程 + 側邊導覽 + 簡易路由
// ============================================================
import { loginWithGoogle, logout, watchAuthState, currentSession } from "./auth.js";
import { renderSettingsPage } from "./settings.js";
import { showToast } from "./utils.js";

const MODULES = [
  { id: "orders",    label: "訂單管理",       icon: "📋", group: "營運" },
  { id: "products",  label: "商品定價",       icon: "🏷️", group: "營運" },
  { id: "packaging", label: "包材採購與庫存", icon: "📦", group: "營運" },
  { id: "customers", label: "客戶名單",       icon: "🙋", group: "營運" },
  { id: "reports",   label: "統計報表",       icon: "📊", group: "分析" },
  { id: "profit",    label: "利潤總覽",       icon: "💰", group: "分析" },
  { id: "settings",  label: "系統設定",       icon: "⚙️", group: "管理" },
];

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginError = document.getElementById("login-error");
const loginLoading = document.getElementById("login-loading");
const btnGoogleLogin = document.getElementById("btn-google-login");
const navContainer = document.getElementById("nav-container");
const mainContent = document.getElementById("main-content");
const userChipName = document.getElementById("user-chip-name");
const userChipRole = document.getElementById("user-chip-role");
const userAvatar = document.getElementById("user-avatar");
const btnLogout = document.getElementById("btn-logout");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const btnSidebarToggle = document.getElementById("btn-sidebar-toggle");
const btnMobileMenu = document.getElementById("btn-mobile-menu");

let currentModule = "orders";

// ---------- 側邊欄：桌面收合 / 手機抽屜 ----------
const SIDEBAR_COLLAPSE_KEY = "heartfelt-order:sidebarCollapsed";
const isMobileViewport = () => window.matchMedia("(max-width: 720px)").matches;

function applyStoredCollapseState() {
  if (isMobileViewport()) return;
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  sidebar.classList.toggle("collapsed", collapsed);
  btnSidebarToggle.textContent = collapsed ? "▸" : "◂";
}

function toggleDesktopCollapse() {
  const collapsed = sidebar.classList.toggle("collapsed");
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  btnSidebarToggle.textContent = collapsed ? "▸" : "◂";
}

function openMobileDrawer() {
  sidebar.classList.add("mobile-open");
  sidebarBackdrop.classList.add("show");
}
function closeMobileDrawer() {
  sidebar.classList.remove("mobile-open");
  sidebarBackdrop.classList.remove("show");
}

btnSidebarToggle.addEventListener("click", toggleDesktopCollapse);
btnMobileMenu.addEventListener("click", openMobileDrawer);
sidebarBackdrop.addEventListener("click", closeMobileDrawer);
window.addEventListener("resize", () => {
  if (!isMobileViewport()) {
    closeMobileDrawer();
    applyStoredCollapseState();
  }
});
applyStoredCollapseState();

// ---------- 登入按鈕 ----------
btnGoogleLogin.addEventListener("click", async () => {
  loginError.classList.remove("show");
  loginLoading.classList.add("show");
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
    // 後續畫面切換交給 watchAuthState 處理
  } catch (err) {
    console.error(err);
    loginError.textContent = "登入失敗：" + (err.message || "未知錯誤");
    loginError.classList.add("show");
  } finally {
    loginLoading.classList.remove("show");
    btnGoogleLogin.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  await logout();
});

// ---------- 側邊導覽 ----------
function renderNav() {
  const groups = [...new Set(MODULES.map((m) => m.group))];
  navContainer.innerHTML = groups.map((group) => `
    <div class="nav-group">
      <div class="nav-label">${group}</div>
      ${MODULES.filter((m) => m.group === group).map((m) => `
        <div class="nav-item ${m.id === currentModule ? "active" : ""}" data-module="${m.id}">
          <span class="nav-icon">${m.icon}</span><span>${m.label}</span>
        </div>
      `).join("")}
    </div>
  `).join("");

  navContainer.querySelectorAll("[data-module]").forEach((el) => {
    el.addEventListener("click", () => {
      currentModule = el.getAttribute("data-module");
      location.hash = `#/${currentModule}`;
      renderNav();
      renderCurrentModule();
      if (isMobileViewport()) closeMobileDrawer();
    });
  });
}

// ---------- 頁面內容 ----------
async function renderCurrentModule() {
  const meta = MODULES.find((m) => m.id === currentModule) || MODULES[0];

  if (currentModule === "settings") {
    await renderSettingsPage(mainContent);
    return;
  }

  // 其餘模組目前為佔位頁面，之後依序開發
  mainContent.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${meta.label}</h2>
        <div class="desc">這個模組還在製作中</div>
      </div>
    </div>
    <div class="card placeholder-page">
      <div class="moon-badge"></div>
      <h3>${meta.label}即將推出</h3>
      <p>骨架已經搭好，接下來會依照約定的順序陸續完成這個模組。</p>
    </div>
  `;
}

function handleHashRoute() {
  const hash = location.hash.replace("#/", "");
  const valid = MODULES.some((m) => m.id === hash);
  currentModule = valid ? hash : "orders";
  renderNav();
  renderCurrentModule();
}
window.addEventListener("hashchange", handleHashRoute);

// ---------- 登入狀態切換 ----------
function showLogin() {
  loginScreen.style.display = "flex";
  appShell.classList.remove("show");
}

function showApp(user, member) {
  loginScreen.style.display = "none";
  appShell.classList.add("show");

  userChipName.textContent = user.displayName || user.email;
  userChipRole.textContent = member.role === "admin" ? "管理員" : "一般成員";
  if (user.photoURL) {
    userAvatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
  } else {
    userAvatar.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();
  }

  handleHashRoute();
}

watchAuthState({
  onSignedOut: () => {
    showLogin();
  },
  onAuthorized: (user, member) => {
    showApp(user, member);
  },
  onUnauthorized: async (user) => {
    loginError.textContent = `此 Google 帳號（${user.email}）尚未被加入系統成員名單，請聯絡管理員。`;
    loginError.classList.add("show");
    await logout();
  },
  onError: (err) => {
    console.error(err);
    showToast("讀取權限資料失敗：" + err.message, "error");
  }
});
