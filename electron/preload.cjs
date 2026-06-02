const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("wakaDesktop", {
  platform: process.platform,
});
