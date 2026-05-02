# Vedha Mobile Billing System - Master Deployment Plan

This document outlines the complete process for setting up the software in your shop, including Windows PCs, Android devices, and the central database server.

---

## 🖥️ Phase 1: Build Windows .exe Installer
This creates the setup file for your billing counter PCs.

1.  **Set the Server URL:** Open `frontend/src/api.js` and ensure it points to your server.
    *   If running on the same PC: Use `http://localhost:5000`
    *   If connecting to a central shop PC: Use `http://192.168.1.XX:5000` (replace with the Server PC's IP)
2.  **Generate Installer:** Run this command in the main project folder:
    ```bash
    npm run build:windows
    ```
3.  **Install:** Copy the `.exe` from `electron/dist/` to your shop PCs and run it.

---

## 🌐 Phase 2: Central Production Server Setup
Follow these steps on the PC that will act as the "Main Server" (the one that stores all data).

1.  **Database:** Ensure your Neon PostgreSQL `DATABASE_URL` is ready.
2.  **Server Files:** Copy the `backend/` folder to the server PC.
3.  **Environment:** Create a `.env` file in the `backend/` folder:
    ```env
    DATABASE_URL=your_postgresql_url
    PORT=5000
    JWT_SECRET=your_secret_key
    ```
4.  **Start:** Run `npm install` and then `npm start`.
5.  **Firewall:** Ensure Windows Firewall allows incoming connections on Port 5000 so other PCs can connect.

---

## 📱 Phase 3: Android App Setup (Capacitor)
This creates the app for mobile phones/tablets used in the shop.

1.  **Prepare Frontend:**
    ```bash
    npm run build:frontend
    ```
2.  **Sync to Capacitor:**
    ```bash
    npm run android:copy
    ```
3.  **Open in Android Studio:**
    ```bash
    npm run android:open
    ```
4.  **Build APK:** In Android Studio, go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5.  **Deploy:** Copy the generated APK to your Android devices and install it.

---

## 📋 Full Shop Workflow Summary

1.  **One Central Server:** All data is stored in the Postgres database.
2.  **Windows PCs:** Connect to the server IP via the `.exe` app for billing.
3.  **Android Phones:** Connect to the same server IP via the APK for inventory/viewing.
4.  **Synchronized:** All devices see the same stock, sales, and customer data in real-time.

---

### Important Checklist
*   [ ] **Server IP:** Check `ipconfig` on the server PC to find its local IP address.
*   [ ] **Network:** All devices (PCs and Phones) must be on the **same Wi-Fi** or network.
*   [ ] **Backups:** Regularly export your data from the Reports page as a backup.
