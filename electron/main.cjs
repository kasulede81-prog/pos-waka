const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_NAME = "WAKA POS";
let mainWindow = null;

function createMainWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const hasIcon = fs.existsSync(iconPath);

  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    autoHideMenuBar: true,
    show: false,
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const indexPath = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error("[WAKA POS] Missing dist/index.html at", indexPath);
  }
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error("[WAKA POS] did-fail-load", code, description, url);
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error("[renderer]", message, sourceId, line);
  });
  void win.loadFile(indexPath);
}

ipcMain.handle("waka-print", async (_event, opts) => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  if (!win) return { ok: false, error: "No window" };
  return new Promise((resolve) => {
    win.webContents.print(
      {
        silent: Boolean(opts?.silent),
        printBackground: true,
      },
      (success, failureReason) => {
        if (success) resolve({ ok: true });
        else resolve({ ok: false, error: failureReason || "Print failed" });
      },
    );
  });
});

ipcMain.handle("waka-printer-diagnostics", async () => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  return {
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    hasWindow: Boolean(win),
    printApi: true,
  };
});

app.setName(APP_NAME);

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
