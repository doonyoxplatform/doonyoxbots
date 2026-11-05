// Candidate Volatility + Jump index markets for the scanner.
// These are the Deriv symbol codes (already used by chart-api / active-symbols).
export const DEFAULT_MARKETS = [
    { id: 'R_10', label: 'Volatility 10', group: 'volatility' },
    { id: 'R_25', label: 'Volatility 25', group: 'volatility' },
    { id: 'R_50', label: 'Volatility 50', group: 'volatility' },
    { id: 'R_75', label: 'Volatility 75', group: 'volatility' },
    { id: 'R_100', label: 'Volatility 100', group: 'volatility' },
    { id: '1HZ10V', label: 'Jump 10', group: 'jump' },
    { id: '1HZ25V', label: 'Jump 25', group: 'jump' },
    { id: '1HZ50V', label: 'Jump 50', group: 'jump' },
    { id: '1HZ75V', label: 'Jump 75', group: 'jump' },
    { id: '1HZ100V', label: 'Jump 100', group: 'jump' },
];

export const DEFAULT_WARMUP_TICKS = 100;
export const DEFAULT_HYSTERESIS_MS = 500;

export const getMarketById = id => DEFAULT_MARKETS.find(m => m.id === id) ?? null;