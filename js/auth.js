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
import { auth, db, googleProvider } from "./firebase-config.js?v=20260830-60";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
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
  order_staff: "訂單進出貨人員",
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

// 會導致 popup 走不通、需要自動改用整頁轉跳的錯誤代碼
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

export async function loginWithGoogle() {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (POPUP_FALLBACK_CODES.has(err.code)) {
      // Safari（尤其 iPhone）常見的封鎖彈出視窗情況：改用整頁轉跳，
      // 轉跳回來後由 watchAuthState + getRedirectResult 接手完成登入。
      await signInWithRedirect(auth, googleProvider);
      return null; // 頁面即將轉跳離開，不會執行到這行之後
    }
    throw err;
  }
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
