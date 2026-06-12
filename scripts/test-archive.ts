// AWS GFS アーカイブ取得の動作確認用スクリプト。
//   npm run test:archive -- 2023-01-15T06:00:00Z
// 日時を省略すると 1 年前の 00:00 UTC を使う。
import { fetchArchiveWind } from '../src/main/archive';

async function main(): Promise<void> {
  const arg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}T/.test(a));
  const target =
    arg ??
    (() => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()),
      ).toISOString();
    })();

  console.log(`fetching archive wind for ${target}...`);
  const result = await fetchArchiveWind(target);

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

  const [uRec, vRec] = result.records;
  console.log(`refTime: ${result.refTime} (+${result.forecastHour}h)`);
  console.log(`u: n=${uRec.data.length} ${stats(uRec.data)}`);
  console.log(`v: n=${vRec.data.length} ${stats(vRec.data)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
