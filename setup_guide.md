# Setup and Deployment Guide

This guide explains how to install and run the **Vedha Mobile Billing System** on a new computer.

## Prerequisites
1.  **Node.js (LTS Version):** Required to run the backend and build the software.
2.  **Internet Connection:** Required for the cloud database (Neon Postgres).

## 1. Build the Standalone Installer (.exe)
Since this is an Electron application, you can create a single installation file that you can copy to other PCs.

1.  Open the terminal in the project root folder.
2.  Run the following command to build the frontend and package the Electron app:
    ```bash
    npm run build:frontend
    cd electron
    npm install
    npm run dist:win
    ```
3.  Once finished, you will find an installer file (e.g., `Vedha Mobile Billing System Setup.exe`) in the `electron/dist/` folder.
4.  Copy this `.exe` file to the other PC and run it to install the software.

## 2. Setting Up the Database
The software uses a cloud database (Neon).
1.  Ensure you have your `DATABASE_URL` from your Neon dashboard.
2.  On the new PC, you will need to provide this URL to the backend.

## 3. Running the Backend Server
The software requires the backend server to be running (usually on port 5000).

### Option: Running from Source
1.  Copy the `backend/` folder to the new PC.
2.  Open a terminal in the `backend/` folder.
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Create a `.env` file in the `backend/` folder and add your database URL:
    ```env
    DATABASE_URL=your_neon_database_url_here
    PORT=5000
    JWT_SECRET=your_secret_key
    ```
5.  Start the backend:
    ```bash
    npm start
    ```

---

### Pro Tip: "One-Click" Setup
If you want, I can modify the software so that the **Backend starts automatically** whenever you open the Desktop app. This would mean you only have to run the `.exe` file and everything will work instantly without opening extra terminals.
