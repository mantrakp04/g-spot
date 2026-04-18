import { BrowserWindow, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if the web dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return DEV_SERVER_URL;
    } catch {
    }
  }

  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

new BrowserWindow({
  title: "g-spot",
  url,
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  },
});
