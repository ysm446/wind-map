interface WindApiResult {
  source: 'cache' | 'sample' | 'nomads' | 'archive';
  records: unknown;
}

interface Window {
  windApi: {
    getWindData(): Promise<WindApiResult | null>;
    fetchWind(forecastHour: number): Promise<WindApiResult>;
    fetchArchiveWind(time: string): Promise<WindApiResult>;
  };
}

declare module '*.json' {
  const value: unknown;
  export default value;
}
