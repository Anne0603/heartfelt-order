// ============================================================
// 登入 / 登出 / 成員白名單檢查
//
// 資安設計：
// Google 登入本身任何人都能通過（只要有 Google 帳號）。
// 所以登入成功後，還要再檢查 Firestore 的 members/{email} 這筆資料
// 存不存在——不存在就視為「沒有權限」，直接登出、不給看任何頁面。
// 這一層判斷同時也寫進 Firestore Rules 裡（雙重防護：前端擋一次，
// 後端規則再擋一次，就算有人繞過前端畫面也讀不到資料）。
// ============================================================
import { auth, db, googleProvider } from "./firebase-config.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// 目前登入者的完整資訊（member 文件內容 + firebase user）
export const currentSession = {
  user: null,   // firebase auth user 物件
  member: null  // Firestore members/{email} 文件內容，例如 { role: 'admin' }
};

/**
 * 依 email 讀取 members collection，判斷是否為授權成員。
 */
async function loadMemberDoc(email) {
  const ref = doc(db, "members", email.toLowerCase());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

/**
 * 註冊登入狀態監聽。
 * onAuthorized(user, member)：通過白名單檢查後呼叫
 * onUnauthorized(user)：登入成功但不在白名單裡
 * onSignedOut()：尚未登入 / 已登出
 */
export function watchAuthState({ onAuthorized, onUnauthorized, onSignedOut, onError }) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      currentSession.user = null;
      currentSession.member = null;
      onSignedOut && onSignedOut();
      return;
    }
    try {
      const member = await loadMemberDoc(user.email);
      if (!member) {
        currentSession.user = user;
        currentSession.member = null;
        onUnauthorized && onUnauthorized(user);
        return;
      }
      currentSession.user = user;
      currentSession.member = member;
      onAuthorized && onAuthorized(user, member);
    } catch (err) {
      onError && onError(err);
    }
  });
}
