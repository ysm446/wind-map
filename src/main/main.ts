import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fetchGfsWind } from './nomads';
import { fetchArchiveWind } from './archive';

// 風データの探索順: ユーザーキャッシュ → アプリ同梱サンプル
function getWindDataCandidates(): Array<{ source: string; filePath: string }> {
  return [
    {
      source: 'cache',
      filePath: path.join(app.getPath('userData'), 'wind-cache', 'current-wind.json'),
    },
    {
      source: 'sample',
      filePath: path.join(app.getAppPath(), 'assets', 'data', 'current-wind.json'),
    },
  ];
}

ipcMain.handle('wind:get', async () => {
  for (const { source, filePath } of getWindDataCandidates()) {
    try {
      if (fs.existsSync(filePath)) {
        const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { source, records };
      }
    } catch (err) {
      console.error(`wind data load failed: ${filePath}`, err);
    }
  }
  return null;
});

// NOMADS から最新の GFS 地上風を取得してキャッシュする
ipcMain.handle('wind:fetch', async (_event, opts: { forecastHour?: number } | undefined) => {
  const forecastHour = typeof opts?.forecastHour === 'number' ? opts.forecastHour : 0;
  const result = await fetchGfsWind(forecastHour);
  const cacheDir = path.join(app.getPath('userData'), 'wind-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'current-wind.json'), JSON.stringify(result.records));
  return { source: 'nomads', records: result.records };
});

// AWS の GFS アーカイブから過去日時の地上風を取得してキャッシュする
ipcMain.handle('wind:fetch-archive', async (_event, opts: { time?: string } | undefined) => {
  if (!opts?.time) throw new Error('日時が指定されていません');
  const result = await fetchArchiveWind(opts.time);
  const cacheDir = path.join(app.getPath('userData'), 'wind-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'current-wind.json'), JSON.stringify(result.records));
  return { source: 'archive', records: result.records };
});

// UI 設定はアプリ直下の data/settings.json に保存する (ポータブル運用を想定)
function settingsPath(): string {
  return path.join(app.getAppPath(), 'data', 'settings.json');
}

ipcMain.handle('settings:get', async () => {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return null; // 初回起動などファイルが無い場合
  }
});

ipcMain.handle('settings:set', async (_event, settings: unknown) => {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    useContentSize: true,
    backgroundColor: '#0a0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 動作検証用: WINDMAP_SCREENSHOT にパスを指定すると、描画後に
  // スクリーンショットを保存して終了する。
  const screenshotPath = process.env.WINDMAP_SCREENSHOT;
  if (screenshotPath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(screenshotPath, image.toPNG());
          const debug = await win.webContents
            .executeJavaScript('typeof __windmapDebug === "function" ? __windmapDebug() : null')
            .catch(() => null);
          fs.writeFileSync(
            `${screenshotPath}.txt`,
            JSON.stringify({ bounds: win.getBounds(), debug }),
          );
        } catch (err) {
          console.error('screenshot failed', err);
        } finally {
          app.quit();
        }
      }, 4000);
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
