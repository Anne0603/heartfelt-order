// ============================================================
// Firebase 初始化
// 這裡的值是「公開設定值」，本來就設計成給前端瀏覽器讀取，不是密鑰。
// 真正需要保密的東西（API Secret 之類）完全不會出現在這個檔案。
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQF4J3WMLZjE4dHAif7WH6vU3hu9XKm6s",
  authDomain: "heartfelt-order.firebaseapp.com",
  projectId: "heartfelt-order",
  storageBucket: "heartfelt-order.firebasestorage.app",
  messagingSenderId: "497539783911",
  appId: "1:497539783911:web:be4349eae143828cec9642"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
