// =========================================================
//  auth.js — авторизация и хранение данных игрока
//  Использует Firebase Auth + Firestore
// =========================================================

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signInWithPopup,
         signInAnonymously, GoogleAuthProvider,
         onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, setDoc,
         getDoc, updateDoc, serverTimestamp }   from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig                           from "./firebase-config.js";

// ── Инициализация ──────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
auth.languageCode = 'ru';

// ── Создать профиль игрока в Firestore ────────────────────
async function createPlayerProfile(user, displayName) {
  const ref = doc(db, "players", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;              // уже есть — не перезаписываем

  await setDoc(ref, {
    uid:         user.uid,
    displayName: displayName || user.displayName || "Безымянный странник",
    email:       user.email || null,
    isAnonymous: user.isAnonymous,
    createdAt:   serverTimestamp(),
    lastSeen:    serverTimestamp(),
    games: []                             // список сохранённых игр
  });
}

// ── Обновить время последнего входа ───────────────────────
async function touchLastSeen(uid) {
  try {
    await updateDoc(doc(db, "players", uid), { lastSeen: serverTimestamp() });
  } catch {}
}

// ── Регистрация через Email ────────────────────────────────
export async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await createPlayerProfile(cred.user, name);
  return cred.user;
}

// ── Вход через Email ──────────────────────────────────────
export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await touchLastSeen(cred.user.uid);
  return cred.user;
}

// ── Вход через Google ─────────────────────────────────────
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred     = await signInWithPopup(auth, provider);
  await createPlayerProfile(cred.user);
  await touchLastSeen(cred.user.uid);
  return cred.user;
}

// ── Анонимный вход (гость) ────────────────────────────────
export async function loginAsGuest() {
  const cred = await signInAnonymously(auth);
  await createPlayerProfile(cred.user, "Безымянный странник");
  return cred.user;
}

// ── Выход ─────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ── Загрузить данные игрока ───────────────────────────────
export async function getPlayerData(uid) {
  const snap = await getDoc(doc(db, "players", uid));
  return snap.exists() ? snap.data() : null;
}

// ── Сохранить состояние игры ──────────────────────────────
// gameId — уникальный ключ сессии (например, timestamp)
// history — массив сообщений [{role, content}, ...]
export async function saveGameState(uid, gameId, history, title = "Без названия") {
  await setDoc(doc(db, "players", uid, "games", gameId), {
    gameId,
    title,
    history,
    savedAt: serverTimestamp()
  });
}

// ── Загрузить состояние игры ──────────────────────────────
export async function loadGameState(uid, gameId) {
  const snap = await getDoc(doc(db, "players", uid, "games", gameId));
  return snap.exists() ? snap.data() : null;
}

// ── Слушатель изменения авторизации ──────────────────────
// Используй в index.html и game.html:
//   import { onAuthChange } from "./auth.js";
//   onAuthChange(user => { /* user или null */ });
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── Текущий пользователь (синхронно) ─────────────────────
export function currentUser() {
  return auth.currentUser;
}
