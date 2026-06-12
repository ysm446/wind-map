// NOMADS 取得の動作確認用スクリプト。
//   npm run test:nomads            -- 取得して統計を表示
//   npm run test:nomads -- --write-cache  -- アプリのキャッシュにも保存
import fs from 'node:fs';
import path from 'node:path';
import { fetchGfsWind } from '../src/main/nomads';

async function main(): Promise<void> {
  const fh = 0;
  console.log(`fetching GFS 1.0deg surface wind (f${String(fh).padStart(3, '0')})...`);
  const result = await fetchGfsWind(fh);

  const [uRec, vRec] = result.records;
  const stats = (data: number[]) => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of data) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += Math.abs(v);
    }
    return `min=${min.toFixed(1)} max=${max.toFixed(1)} mean|v|=${(sum / data.length).toFixed(1)}`;
  };

  console.log(`refTime: ${result.refTime} (+${result.forecastHour}h)`);
  console.log(`u: n=${uRec.data.length} ${stats(uRec.data)}`);
  console.log(`v: n=${vRec.data.length} ${stats(vRec.data)}`);

  if (process.argv.includes('--write-cache')) {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA not set');
    const cacheDir = path.join(appData, 'wind-map', 'wind-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = path.join(cacheDir, 'current-wind.json');
    fs.writeFileSync(file, JSON.stringify(result.records));
    console.log(`cache written: ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
