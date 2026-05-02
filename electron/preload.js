const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posPrinter", {
  printReceipt: (options) => ipcRenderer.invoke("print-receipt", options),
  captureReceiptPng: (bounds) => ipcRenderer.invoke("capture-receipt-png", bounds)
});
