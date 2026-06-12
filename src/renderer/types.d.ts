interface WindApiResult {
  source: 'cache' | 'sample';
  records: unknown;
}

interface Window {
  windApi: {
    getWindData(): Promise<WindApiResult | null>;
  };
}

declare module '*.json' {
  const value: unknown;
  export default value;
}
