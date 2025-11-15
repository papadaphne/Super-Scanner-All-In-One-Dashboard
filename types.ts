
export interface Signal {
  id: string;
  mode: 'scalper' | 'micro_pump' | 'breakout' | 'accumulation' | 'rebound' | 'lowcap';
  pair: string;
  time: string;
  entry: number;
  tp: number;
  sl: number;
  priority: number;
  ghost: number;
  news: boolean;
}
