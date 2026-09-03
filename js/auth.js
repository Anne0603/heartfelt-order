// ============================================================
// 登入 / 登出 / 角色狀態
//
// 流程：
// 1. Google 登入成功
// 2. 讀 Firestore members/{email}
//    - 不存在 -> 自動建立一筆 status:'pending' 的申請紀錄，
//      畫面顯示「審核中」，登出
//    - 存在但 status 是 'pending' -> 顯示「審核中」，登出
//    - 存在且 status 是 'active' -> 放行，帶著 role 一起進系統
// ============================================================
import { auth, db, googleProvider, authPersistenceReady } from "./firebase-config.js?v=20260830-98";
import {
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  ORDER_STAFF: "order_staff",
  VIEWER: "viewer",
};

export const ROLE_LABELS = {
  superadmin: "超級管理員",
  admin: "管理員",
  order_staff: "小幫手",
  viewer: "唯讀成員",
};

export const currentSession = {
  user: null,
  member: null, // { status, role, nickname, ... }
};

/** 顯示名稱：優先用自己設定的暱稱，沒有的話退回 Google 顯示名稱 */
export function getDisplayName() {
  return currentSession.member?.nickname || currentSession.user?.displayName || currentSession.user?.email || "未知";
}

export async function updateMyNickname(nickname) {
  if (!currentSession.user?.email) throw new Error("尚未登入");
  const email = currentSession.user.email.toLowerCase();
  const trimmed = nickname.trim();
  await updateDoc(doc(db, "members", email), { nickname: trimmed });
  // 同步寫一份到公開可查的 publicProfiles，讓其他成員能查到「現在」的暱稱，
  // 但這份資料不含角色等敏感資訊。
  await setDoc(doc(db, "publicProfiles", email), { nickname: trimmed }, { merge: true });
  currentSession.member = { ...currentSession.member, nickname: trimmed };
}

/**
 * 標記「這個人已經看過加到主畫面的教學了」，不管是按儲存還是直接關掉
 * 彈窗都算看過，之後就不會再自動跳出來。目前既有的帳號（不管有沒有
 * 設定過暱稱）都還沒有這個欄位，所以都會被當成「第一次」看到一次。
 */
export async function markHomeScreenTipSeen() {
  if (!currentSession.user?.email) return;
  const email = currentSession.user.email.toLowerCase();
  try {
    await updateDoc(doc(db, "members", email), { hasSeenHomeScreenTip: true });
    currentSession.member = { ...currentSession.member, hasSeenHomeScreenTip: true };
  } catch (err) {
    // 標記失敗不影響使用者繼續使用，安靜忽略即可，最多下次登入再看到一次教學
  }
}

async function loadMemberDoc(email) {
  const ref = doc(db, "members", email.toLowerCase());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// ---------- 顯示名稱解析：平常抓即時暱稱，人不在名單裡了才退回當初存的快照名稱 ----------
// 查的是 publicProfiles（只有暱稱，不含角色），不是 members（含角色，不能隨便給人查）。
const nicknameCache = new Map(); // email -> 目前暱稱 | null（null 代表查過了、但查不到）

export async function resolveDisplayName(email, fallbackName) {
  if (!email) return fallbackName || "未知";
  const key = email.toLowerCase();
  if (nicknameCache.has(key)) {
    const cached = nicknameCache.get(key);
    return cached || fallbackName || "未知";
  }
  try {
    const snap = await getDoc(doc(db, "publicProfiles", key));
    if (snap.exists() && snap.data().nickname) {
      const nickname = snap.data().nickname;
      nicknameCache.set(key, nickname);
      return nickname;
    }
    nicknameCache.set(key, null); // 這個人從沒設定過暱稱、或已經不在名單裡，快取起來避免重複查詢
    return fallbackName || "未知";
  } catch (err) {
    // 查不到（例如離線）就安靜退回快照名稱，不要讓畫面壞掉
    return fallbackName || "未知";
  }
}

/**
 * 掃描 container 裡所有帶 data-resolve-email 的元素，非同步把顯示文字
 * 升級成「現在」的暱稱；查不到的話維持原本畫面上已經顯示的快照名稱，
 * 使用者感覺不到任何延遲或閃爍。
 */
export function wireNameResolution(container) {
  container.querySelectorAll("[data-resolve-email]").forEach((el) => {
    const email = el.getAttribute("data-resolve-email");
    const fallback = el.textContent;
    resolveDisplayName(email, fallback).then((resolved) => {
      if (resolved && resolved !== fallback) el.textContent = resolved;
    });
  });
}

async function createPendingRequest(user) {
  const ref = doc(db, "members", user.email.toLowerCase());
  await setDoc(ref, {
    status: "pending",
    role: null,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    requestedAt: serverTimestamp(),
  });
}

/**
 * 用 Google Identity Services（GIS，Google 官方的登入元件，不透過
 * Firebase 的 popup/redirect 機制）拿到的 id_token，換成 Firebase
 * 的登入憑證完成登入。
 *
 * 這是專門給「加到主畫面」的獨立模式用的另一條路——popup 在獨立模式
 * 下常常完全沒反應，redirect 在獨立模式下又常常轉跳回來後遺失登入
 * 結果，這兩個之前都試過而且都失敗了。GIS 用的是不同的底層機制
 * （不需要整頁轉跳、也不是傳統的跳出視窗），理論上比較有機會在
 * 獨立模式下正常運作。
 */
export async function signInWithGoogleCredential(idToken) {
  await authPersistenceReady;
  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}

export async function loginWithGoogle() {
  // 確保「登入狀態要怎麼記住」這個設定已經真的生效，才進行登入——
  // 避免設定還沒完成、頁面就先跳走，導致回來後系統認不出剛剛登入過。
  await authPersistenceReady;

  // 這裡只服務「一般瀏覽器分頁」的登入（獨立模式現在有自己專屬的
  // 引導畫面，根本不會走到這個函式）。單純用整頁轉跳，不嘗試跳窗——
  // 跳窗會讓瀏覽器跳出「網站正嘗試打開彈出式視窗」的原生詢問，
  // 打擾使用者；整頁轉跳從頭到尾都運作得很穩定，不需要多此一舉。
  try { localStorage.setItem("pendingGoogleRedirect", "1"); } catch (e) { /* 忽略 */ }
  await signInWithRedirect(auth, googleProvider);
  return null; // 頁面即將轉跳離開，不會執行到這行之後
}

// 從 Google 轉跳回來後，把登入結果撈出來（純粹是為了讓轉跳流程本身的錯誤，
// 例如使用者中途取消，能被上層看到；正常成功時 onAuthStateChanged 會自動觸發）
export function consumeRedirectResult() {
  return getRedirectResult(auth);
}

export function logout() {
  return signOut(auth);
}

/**
 * onActive(user, member)       -> status active，放行
 * onPending(user)               -> 已送出申請，等待審核
 * onSignedOut()                 -> 尚未登入 / 已登出
 * onError(err)
 * onRevoked()                   -> 原本是 active，但被即時偵測到權限被拿掉
 *                                   （移除/角色被清空/狀態改變），系統即將
 *                                   自動登出。上層可以用這個時機跳個提示，
 *                                   讓使用者知道為什麼突然被登出，而不是
 *                                   毫無說明地被踢回登入畫面。
 */
let unsubscribeMemberWatch = null;

export function watchAuthState({ onActive, onPending, onSignedOut, onError, onRevoked }) {
  onAuthStateChanged(auth, async (user) => {
    // 每次認證狀態變化都先停掉舊的即時監聽，避免同時疊加多個監聽器
    // （例如重新登入、切換帳號時），造成重複觸發或監聽到別人的資料。
    if (unsubscribeMemberWatch) {
      unsubscribeMemberWatch();
      unsubscribeMemberWatch = null;
    }

    if (!user) {
      currentSession.user = null;
      currentSession.member = null;
      onSignedOut && onSignedOut();
      return;
    }
    try {
      let member = await loadMemberDoc(user.email);
      if (!member) {
        await createPendingRequest(user);
        member = { status: "pending", role: null };
      }
      currentSession.user = user;
      currentSession.member = member;

      if (member.status === "active" && member.role) {
        // 記錄「最後上線時間」，方便超級管理員在成員管理頁面看出誰
        // 已經很久沒用系統了。不等這次寫入完成才放行，避免拖慢登入
        // 速度——寫失敗也不影響正常使用，安靜忽略即可。
        updateDoc(doc(db, "members", user.email.toLowerCase()), { lastLoginAt: serverTimestamp() }).catch(() => {});
        onActive && onActive(user, member);
        // 只有在「目前是有效成員」的狀態下才需要即時盯著資料變化——
        // 這是這次要修的重點：如果超級管理員把這個人移除、或改了角色，
        // 不用等這個人自己重新整理頁面才發現，系統會主動偵測到並登出。
        watchMembershipLive(user.email, onRevoked);
      } else {
        onPending && onPending(user, member);
      }
    } catch (err) {
      onError && onError(err);
    }
  });
}

function watchMembershipLive(email, onRevoked) {
  const ref = doc(db, "members", email.toLowerCase());
  unsubscribeMemberWatch = onSnapshot(ref, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    const stillActive = data && data.status === "active" && !!data.role;
    if (!stillActive) {
      // 權限被拿掉了（被移除、被改成待審核、被拒絕、或角色被清空）。
      // 主動登出，讓使用者立刻看到正確的畫面，而不是留在已經失效的
      // 畫面上，操作到一半才發現全部失敗。
      if (unsubscribeMemberWatch) {
        unsubscribeMemberWatch();
        unsubscribeMemberWatch = null;
      }
      onRevoked && onRevoked();
      signOut(auth).catch(() => {});
    } else if (data.role !== currentSession.member?.role) {
      // 角色被改了（例如從一般成員升成管理員），但沒有被拿掉權限——
      // 更新暫存的角色資料，讓畫面上的權限判斷跟著同步，不用重新登入。
      currentSession.member = { ...currentSession.member, ...data };
    }
  }, () => {
    // 監聽本身出錯（例如網路問題）不用特別處理，安靜忽略即可，
    // 不影響使用者當下的操作，下次重新整理時仍會走一般的登入流程重新確認。
  });
}
