// ============================================================
// 操作紀錄：誰、什麼時候、對哪筆資料做了什麼
// 只記錄「動作摘要」，不逐欄位比對差異（保持簡單、足夠回答
// 「這筆資料是誰改的」這個核心問題），記錄本身不可修改/刪除，
// 保持稽核紀錄的完整性。
// ============================================================
import { db } from "./firebase-config.js?v=20260826-8";
import {
  collection, addDoc, getDocs, query, where, orderBy, limit as fbLimit, startAfter, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js?v=20260826-8";

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

/**
 * 分頁載入操作紀錄，可以一直往回翻，不會被卡在只看得到最近一批。
 * 傳入上一批最後一筆的原始 doc snapshot 當作 startAfterDoc，就能接著往回讀。
 */
export async function listActivityLogPage({ pageSize = 100, startAfterDoc = null } = {}) {
  const q = startAfterDoc
    ? query(logCol, orderBy("createdAt", "desc"), startAfter(startAfterDoc), fbLimit(pageSize))
    : query(logCol, orderBy("createdAt", "desc"), fbLimit(pageSize));
  const snap = await getDocs(q);
  const list = [];
  let lastDoc = null;
  snap.forEach((d) => { list.push({ id: d.id, ...d.data() }); lastDoc = d; });
  return { list, lastDoc, hasMore: snap.size === pageSize };
}

/**
 * 依日期區間查詢操作紀錄（一次撈出整段期間，不分頁），
 * 用來回答「我要找某段特定時間發生的事」這種查詢方式。
 */
export async function listActivityLogByDateRange(startDateStr, endDateStr) {
  const start = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T23:59:59.999`);
  const q = query(
    logCol,
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<=", Timestamp.fromDate(end)),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}
