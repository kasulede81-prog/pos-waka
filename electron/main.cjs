"use strict";

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { registerRemoteSupportIpc, stopAllRemoteSupportTransports } = require("./remoteSupport/ipcHandlers.cjs");
const { registerPrinterIpc } = require("./hardware/printerIpc.cjs");
const { classifyNavigation, isHttpOrHttps } = require("./shell/navigationSecurity.cjs");
const { sanitizeShellError } = require("./shell/errors.cjs");

const APP_NAME = "WAKA POS";
const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWindow = null;
let isQuitting = false;
let rendererRecoveryInFlight = false;
let remoteSupportQuitCleanupStarted = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });
}

function getIndexHtmlPath() {
  return path.join(__dirname, "..", "dist", "index.html");
}

function getRecoveryHtmlPath() {
  return path.join(__dirname, "shell", "recovery.html");
}

function focusMainWindow() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function logShell(level, message, detail) {
  const line = detail == null ? message : `${message} ${sanitizeShellError(detail, "")}`.trim();
  if (level === "error") console.error(`[${APP_NAME}]`, line);
  else if (isDev) console.log(`[${APP_NAME}]`, line);
}

function openExternalSafely(url) {
  if (!isHttpOrHttps(url)) {
    logShell("error", "Blocked non-http(s) external open");
    return;
  }
  void shell.openExternal(url).catch((err) => {
    logShell("error", "openExternal failed", err?.message || err);
  });
}

function getAllowedHtmlPaths() {
  return [getIndexHtmlPath(), getRecoveryHtmlPath()];
}

function attachNavigationGuards(win) {
  const allowedHtml = getAllowedHtmlPaths();

  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url, allowedHtml);
    if (decision.action === "open-external") {
      openExternalSafely(url);
    } else if (decision.action === "allow") {
      // Deny popups for in-app URLs; SPA stays in the main window.
      logShell("info", "Denied in-app window.open; keeping single window");
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const decision = classifyNavigation(url, allowedHtml);
    if (decision.action === "allow") return;
    event.preventDefault();
    if (decision.action === "open-external") {
      openExternalSafely(url);
    } else {
      logShell("error", "Blocked navigation", url);
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    const decision = classifyNavigation(url, allowedHtml);
    if (decision.action === "allow") return;
    event.preventDefault();
    if (decision.action === "open-external") {
      openExternalSafely(url);
    } else {
      logShell("error", "Blocked redirect", url);
    }
  });
}

function attachLifecycleGuards(win) {
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    const reason = sanitizeShellError(details?.reason || "crashed", "crashed");
    logShell("error", `Renderer gone (${reason})`);
    void recoverRenderer(win, "crash");
  });

  win.webContents.on("unresponsive", () => {
    logShell("error", "Renderer unresponsive");
  });

  win.webContents.on("responsive", () => {
    logShell("info", "Renderer responsive again");
  });

  if (isDev) {
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level >= 2) console.error("[renderer]", message, sourceId, line);
    });
  }
}

async function loadApp(win) {
  const indexPath = getIndexHtmlPath();
  if (!fs.existsSync(indexPath)) {
    logShell("error", "Missing packaged index.html");
    await showRecoveryPage(win);
    return { ok: false, error: "Missing application files" };
  }

  try {
    await win.loadFile(indexPath);
    return { ok: true };
  } catch (err) {
    logShell("error", "loadFile failed", err?.message || err);
    await showRecoveryPage(win);
    return { ok: false, error: "Failed to load application" };
  }
}

async function showRecoveryPage(win) {
  if (!win || win.isDestroyed()) return;
  const recoveryPath = getRecoveryHtmlPath();
  if (!fs.existsSync(recoveryPath)) {
    logShell("error", "Recovery page missing");
    return;
  }
  try {
    await win.loadFile(recoveryPath);
  } catch (err) {
    logShell("error", "Failed to show recovery page", err?.message || err);
  }
}

async function recoverRenderer(win, reason) {
  if (!win || win.isDestroyed() || rendererRecoveryInFlight || isQuitting) return;
  rendererRecoveryInFlight = true;
  logShell("info", `Controlled renderer recovery (${reason})`);
  try {
    // Do not wipe IndexedDB / auth / device identity — only reload UI surfaces.
    await showRecoveryPage(win);
  } finally {
    rendererRecoveryInFlight = false;
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return mainWindow;
  }

  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const hasIcon = fs.existsSync(iconPath);

  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f4f7fb",
    autoHideMenuBar: true,
    show: false,
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Packaged POS must not depend on remote content.
      webSecurity: true,
    },
  });

  mainWindow = win;
  attachLifecycleGuards(win);
  attachNavigationGuards(win);

  win.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // Ignore aborts from intentional navigations (e.g. recovery → app).
    if (code === -3) return;
    logShell("error", `did-fail-load code=${code}`, description || validatedURL);
    void showRecoveryPage(win);
  });

  // Production: never auto-open DevTools. Dev may open manually.
  void loadApp(win);
  return win;
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
        else {
          resolve({
            ok: false,
            error: sanitizeShellError(failureReason, "Print failed"),
          });
        }
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

/**
 * Desktop-only recovery: reload packaged index.html without clearing storage.
 * Named channel only — no generic invoke surface.
 */
ipcMain.handle("waka:shell:reload-app", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!win || win.isDestroyed()) {
    return { ok: false, error: "No window" };
  }
  const result = await loadApp(win);
  if (!result.ok) {
    return { ok: false, error: sanitizeShellError(result.error, "Reload failed") };
  }
  return { ok: true };
});

registerPrinterIpc(ipcMain);
registerRemoteSupportIpc(ipcMain);

app.setName(APP_NAME);

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on("before-quit", (event) => {
    isQuitting = true;
    if (remoteSupportQuitCleanupStarted) return;
    remoteSupportQuitCleanupStarted = true;
    event.preventDefault();
    void stopAllRemoteSupportTransports()
      .catch(() => {})
      .finally(() => {
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
