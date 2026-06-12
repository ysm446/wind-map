import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fetchGfsWind } from './nomads';

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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
