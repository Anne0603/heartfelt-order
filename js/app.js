// ============================================================
// 主程式：登入流程 + 側邊導覽 + 簡易路由
// ============================================================
import { loginWithGoogle, logout, watchAuthState, currentSession, ROLE_LABELS } from "./auth.js";
import { renderSettingsPage } from "./settings.js";
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
    document.querySelectorAll(".login-seal, .brand-seal").forEach((el) => {
      el.innerHTML = `<img src="${brandLogoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    });
  }
}
loadAndApplyBrandLogo();

const MODULES = [
  { id: "orders",    label: "訂單管理",       icon: "📋", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "products",  label: "商品定價",       icon: "🏷️", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "packaging", label: "包材採購與庫存", icon: "📦", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "customers", label: "客戶名單",       icon: "🙋", group: "營運", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "reports",   label: "統計報表",       icon: "📊", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "profit",    label: "利潤總覽",       icon: "💰", group: "分析", roles: ["superadmin","admin","viewer"] },
  { id: "settings",  label: "系統設定",       icon: "⚙️", group: "管理", roles: ["superadmin","admin"] },
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
const btnSidebarToggle = document.getElementById("btn-sidebar-toggle");
const btnMobileMenu = document.getElementById("btn-mobile-menu");
const btnRefreshDesktop = document.getElementById("btn-refresh-desktop");

let currentModule = "orders";
let myRole = null;

// ---------- 側邊欄：桌面收合 / 手機抽屜 ----------
const SIDEBAR_COLLAPSE_KEY = "heartfelt-order:sidebarCollapsed";
const isMobileViewport = () => window.matchMedia("(max-width: 720px)").matches;

function applyStoredCollapseState() {
  if (isMobileViewport()) return;
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  sidebar.classList.toggle("collapsed", collapsed);
}
function toggleDesktopCollapse() {
  const collapsed = sidebar.classList.toggle("collapsed");
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
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
      <div class="nav-label">${group}</div>
      ${mods.filter((m) => m.group === group).map((m) => `
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

  if (!meta.roles.includes(myRole)) {
    mainContent.innerHTML = `
      <div class="page-header"><h2>沒有權限</h2></div>
      <div class="card placeholder-page">
        <div class="icon-badge">心</div>
        <h3>你目前的角色無法使用這個模組</h3>
        <p>如需要調整權限，請聯絡超級管理員。</p>
      </div>
    `;
    return;
  }

  if (currentModule === "settings") {
    await renderSettingsPage(mainContent);
    return;
  }

  mainContent.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${meta.label}</h2>
        <div class="desc">這個模組還在製作中</div>
      </div>
    </div>
    <div class="card placeholder-page">
      <div class="icon-badge">心</div>
      <h3>${meta.label}即將推出</h3>
      <p>骨架已經搭好，接下來會依照約定的順序陸續完成這個模組。</p>
    </div>
  `;
}

function handleHashRoute() {
  const hash = location.hash.replace("#/", "");
  const mods = visibleModules();
  const valid = mods.some((m) => m.id === hash);
  currentModule = valid ? hash : (mods[0]?.id || "orders");
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

  handleHashRoute();
}

watchAuthState({
  onSignedOut: () => showLoginScreen(),
  onActive: (user, member) => showApp(user, member),
  onPending: (user) => showPendingScreen(user),
  onError: (err) => {
    console.error(err);
    showToast("讀取權限資料失敗：" + err.message, "error");
  }
});
