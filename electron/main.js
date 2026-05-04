const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fork } = require("child_process");

// Automatic Backend Startup
let backendProcess = null;
function startBackend() {
  const isPackaged = app.isPackaged;
  let backendPath = isPackaged
    ? path.join(__dirname, "backend", "src", "server.js")
    : path.join(__dirname, "..", "backend", "src", "server.js");

  if (isPackaged) {
    backendPath = backendPath.replace("app.asar", "app.asar.unpacked");
  }

  if (fs.existsSync(backendPath)) {
    console.log("Starting backend at:", backendPath);
    backendProcess = fork(backendPath, [], {
      cwd: path.dirname(backendPath),
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit"
    });

    backendProcess.on("error", (err) => {
      console.error("Backend process error:", err);
    });

    backendProcess.on("exit", (code) => {
      console.log("Backend process exited with code:", code);
    });
  } else {
    console.error("Backend server file not found at:", backendPath);
  }
}

const devUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Vedha Mobile Billing System",
    icon: path.join(__dirname, "frontend-dist", "vm-logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const iconPath = path.join(__dirname, "frontend-dist", "vm-logo.png");
  win.webContents.setWindowOpenHandler(() => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        icon: iconPath,
        autoHideMenuBar: true
      }
    };
  });

  win.loadURL("https://vedha-billing-frontend.vercel.app/");
}

app.whenReady().then(() => {
  // WHY webContents.print() instead of printToPDF + shell.openPath:
  //
  // printToPDF + shell.openPath only opens a PDF viewer (Edge, Chrome, etc.)
  // for VIEWING — the user has to click print manually inside that viewer.
  //
  // webContents.print({ silent: false }) shows the NATIVE Windows print dialog
  // directly, so the user immediately sees the printer selection dialog.
  // The @media print CSS in styles.css handles hiding the app UI and showing
  // only the receipt at the correct paper size.
  //
  ipcMain.handle("print-receipt", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;

    try {
      // Resolve paper size to exact microns so the print dialog
      // defaults to the correct paper.
      const pageSizeInput = options.pageSize || "A4";
      let pageSize;
      if (pageSizeInput === "A5") {
        pageSize = { width: 148000, height: 210000 };
      } else if (pageSizeInput === "80mm") {
        pageSize = { width: 80000, height: 297000 };
      } else {
        pageSize = { width: 210000, height: 297000 }; // A4
      }

      // webContents.print() shows the NATIVE Windows print dialog directly.
      // silent:false means the print dialog opens for the user to pick a printer.
      // The @media print CSS injected by electron.js handles hiding the app UI
      // and showing only the receipt at the correct paper size.
      return await new Promise((resolve) => {
        win.webContents.print(
          {
            silent: false,
            printBackground: true,
            color: true,
            margins: { marginType: "none" },
            pageSize,
            landscape: false
          },
          (success, failureReason) => {
            if (!success) {
              console.error("webContents.print failed:", failureReason);
              resolve(false);
            } else {
              resolve(true);
            }
          }
        );
      });
    } catch (err) {
      console.error("print-receipt error:", err);
      return false;
    }
  });

  // Capture just the receipt element area as a PNG and open it in the image viewer
  ipcMain.handle("capture-receipt-png", async (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    try {
      // bounds: { x, y, width, height } in CSS pixels from getBoundingClientRect()
      const rect = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      };
      const image = await win.webContents.capturePage(rect);
      const tmpPath = path.join(os.tmpdir(), `vedha-bill-${Date.now()}.png`);
      fs.writeFileSync(tmpPath, image.toPNG());
      const err = await shell.openPath(tmpPath);
      if (err) {
        console.error("shell.openPath PNG failed:", err);
        return false;
      }
      // Clean up after 60 seconds
      setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch (_) {} }, 60000);
      return true;
    } catch (err) {
      console.error("capture-receipt-png error:", err);
      return false;
    }
  });

  startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

