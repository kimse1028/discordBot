const admin = require("firebase-admin");
require("dotenv").config();

const serviceAccount = {
  type: process.env.FIREBASE_TYPE?.replace(/"/g, ""),
  project_id: process.env.FIREBASE_PROJECT_ID?.replace(/"/g, ""),
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID?.replace(/"/g, ""),
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/"/g, "").replace(
    /\\n/g,
    "\n",
  ),
  client_email: process.env.FIREBASE_CLIENT_EMAIL?.replace(/"/g, ""),
  client_id: process.env.FIREBASE_CLIENT_ID?.replace(/"/g, ""),
  auth_uri: process.env.FIREBASE_AUTH_URI?.replace(/"/g, ""),
  token_uri: process.env.FIREBASE_TOKEN_URI?.replace(/"/g, ""),
  auth_provider_x509_cert_url:
    process.env.FIREBASE_AUTH_PROVIDER_CERT_URL?.replace(/"/g, ""),
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL?.replace(/"/g, ""),
  universe_domain: (
    process.env.FIREBASE_UNIVERSE_DOMAIN || "googleapis.com"
  )?.replace(/"/g, ""),
};

// Firebase 초기화 전에 필수 환경변수 체크
const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const ggckWordsRef = db.collection("ggckWords");
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
      updatedAt: new Date(), // serverTimestamp() 대신 new Date() 사용
    });
    return true;
  } catch (error) {
    console.error("관리자 설정 중 에러:", error);
    return false;
  }
}

module.exports = { db, ggckWordsRef, adminSettingsRef, isAdmin, setAdmin };
