// lib/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBJ6Bam_md2r-8RMAYLsU9IFh6GRvdWVC4",
  authDomain: "smart-energy-meter-474c1.firebaseapp.com",
  databaseURL: "https://smart-energy-meter-474c1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-energy-meter-474c1",
  storageBucket: "smart-energy-meter-474c1.firebasestorage.app",
  messagingSenderId: "865796831696",
  appId: "1:865796831696:web:6a3396fe47e2df227121d5",
  measurementId: "G-JBXP96HS3B"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);