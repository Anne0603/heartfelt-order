// ============================================================
// 營業支出（原料總帳、人事、電費、房租、其他），供「利潤總覽」使用
// 分項登記，每筆有日期，報表用日期區間去篩選加總
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, addDoc, deleteDoc, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js";

const expensesCol = collection(db, "expenses");

export const EXPENSE_CATEGORY_LABELS = {
  material: "原料",
  labor: "人事",
  utility: "電費",
  rent: "房租",
  other: "其他",
};

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: getDisplayName(),
  };
}

export async function listExpensesInRange(startDate, endDate) {
  const q = query(expensesCol, where("date", ">=", startDate), where("date", "<=", endDate));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}

export async function addExpense({ category, customLabel, amount, date, note }) {
  const who = whoAmI();
  await addDoc(expensesCol, {
    category,
    customLabel: category === "other" ? (customLabel?.trim() || "") : "",
    amount: Number(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    note: note || "",
    createdBy: who.email,
    createdByName: who.name,
    createdAt: serverTimestamp(),
  });
}

export async function deleteExpense(id) {
  await deleteDoc(doc(db, "expenses", id));
}
