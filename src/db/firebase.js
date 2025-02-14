// src/db/firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const gangchanWordsRef = db.collection("gangchanWords");
const adminSettingsRef = db.collection("adminSettings");

// 관리자 체크 함수
async function isAdmin(userId, guildId) {
  try {
    const settingsDoc = await adminSettingsRef.doc(guildId).get();
    if (!settingsDoc.exists) return false;

    const settings = settingsDoc.data();
    return settings.adminId === userId;
  } catch (error) {
    console.error("관리자 체크 중 에러:", error);
    return false;
  }
}

// 관리자 설정 함수
async function setAdmin(userId, guildId) {
  try {
    await adminSettingsRef.doc(guildId).set({
      adminId: userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error("관리자 설정 중 에러:", error);
    return false;
  }
}

module.exports = { db, gangchanWordsRef, adminSettingsRef, isAdmin, setAdmin };
