interface WindApiResult {
  source: 'cache' | 'sample' | 'nomads';
  records: unknown;
}

interface Window {
  windApi: {
    getWindData(): Promise<WindApiResult | null>;
    fetchWind(forecastHour: number): Promise<WindApiResult>;
  };
}

declare module '*.json' {
  const value: unknown;
  export default value;
}
