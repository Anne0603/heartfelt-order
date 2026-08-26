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
import { auth, db, googleProvider } from "./firebase-config.js?v=20260826-10";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
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
  viewer: "唯讀主管",
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
  const ref = doc(db, "members", currentSession.user.email.toLowerCase());
  await updateDoc(ref, { nickname: nickname.trim() });
  currentSession.member = { ...currentSession.member, nickname: nickname.trim() };
}

async function loadMemberDoc(email) {
  const ref = doc(db, "members", email.toLowerCase());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
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

export function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

/**
 * onActive(user, member)       -> status active，放行
 * onPending(user)               -> 已送出申請，等待審核
 * onSignedOut()                 -> 尚未登入 / 已登出
 * onError(err)
 */
export function watchAuthState({ onActive, onPending, onSignedOut, onError }) {
  onAuthStateChanged(auth, async (user) => {
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
      } else {
        onPending && onPending(user);
      }
    } catch (err) {
      onError && onError(err);
    }
  });
}
