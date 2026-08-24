// ============================================================
// 操作紀錄：誰、什麼時候、對哪筆資料做了什麼
// 只記錄「動作摘要」，不逐欄位比對差異（保持簡單、足夠回答
// 「這筆資料是誰改的」這個核心問題），記錄本身不可修改/刪除，
// 保持稽核紀錄的完整性。
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, orderBy, limit as fbLimit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js";

const logCol = collection(db, "activityLog");

export const MODULE_LABELS = {
  items: "商品與庫存",
  orders: "訂單",
  contacts: "客戶與廠商",
  expenses: "支出",
};

/**
 * 記錄一筆操作。刻意設計成「就算記錄失敗也不能擋住原本的操作」，
 * 所以呼叫端要用 fire-and-forget 的方式呼叫（不要 await 卡住主流程），
 * 內部已經自己吃掉錯誤。
 */
export function logActivity({ module, action, summary }) {
  const email = currentSession.user?.email || null;
  const name = getDisplayName();
  addDoc(logCol, {
    module,
    action, // 'create' | 'update' | 'archive' | 'restore' | 'void' | 'delete' | 'status'
    summary,
    performedBy: email,
    performedByName: name,
    createdAt: serverTimestamp(),
  }).catch(() => {
    // 記錄失敗不影響原本的操作，安靜失敗就好
  });
}

export async function listActivityLog(max = 100) {
  const q = query(logCol, orderBy("createdAt", "desc"), fbLimit(max));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}
