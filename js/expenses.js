// ============================================================
// 營業支出（原料總帳、人事、電費、房租...等，類別由系統設定管理）
// 供「利潤總覽」計算淨利使用，登記/查詢/編輯在獨立的「支出管理」頁面
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js";

const expensesCol = collection(db, "expenses");

export const PAYMENT_METHODS = ["現金", "轉帳", "其他"];

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: getDisplayName(),
  };
}

export async function listExpenses() {
  const snap = await getDocs(expensesCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}

export async function listExpensesInRange(startDate, endDate) {
  const q = query(expensesCol, where("date", ">=", startDate), where("date", "<=", endDate));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}

export async function addExpense({ category, amount, date, paymentMethod, note, receiptUrl }) {
  const who = whoAmI();
  await addDoc(expensesCol, {
    category: category || "",
    amount: Number(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    paymentMethod: paymentMethod || "",
    note: note || "",
    receiptUrl: receiptUrl || "",
    createdBy: who.email,
    createdByName: who.name,
    createdAt: serverTimestamp(),
  });
}

export async function updateExpense(id, { category, amount, date, paymentMethod, note, receiptUrl }) {
  await updateDoc(doc(db, "expenses", id), {
    category: category || "",
    amount: Number(amount) || 0,
    date,
    paymentMethod: paymentMethod || "",
    note: note || "",
    receiptUrl: receiptUrl || "",
  });
}

export async function deleteExpense(id) {
  await deleteDoc(doc(db, "expenses", id));
}
