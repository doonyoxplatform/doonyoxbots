// Pure scoring functions for the market scanner.
// Each scorer takes a buffer of ticks and returns a value in [0, 1].
// 0 === no signal, 1 === strongest signal in the chosen direction.
//
// IMPORTANT: these are entry filters, not predictive models. On a random
// walk the long-term win rate will still be the base payout. They are here
// to make entries feel "on signal" and to keep the user out of the worst
// parts of the random walk.

/**
 * Momentum score: direction bias of the last `window` ticks, normalised.
 * direction: 'rise' | 'fall'
 *   0   => zero or against-direction bias
 *   1   => 100% biased in the chosen direction
 */
export const scoreMomentum = (ticks, { window = 20, direction = 'rise' } = {}) => {
    if (!Array.isArray(ticks) || ticks.length < 2) return 0;
    const slice = ticks.slice(-window);
    let ups = 0;
    let downs = 0;
    for (let i = 1; i < slice.length; i += 1) {
        if (slice[i].quote > slice[i - 1].quote) ups += 1;
        else if (slice[i].quote < slice[i - 1].quote) downs += 1;
    }
    const total = slice.length - 1;
    if (total === 0) return 0;
    const ratio = direction === 'rise' ? ups / total : downs / total;
    const inFavour = direction === 'rise' ? ups >= downs : downs >= ups;
    return inFavour ? ratio : 0;
};

/**
 * Run-length score: length of the trailing run in the chosen direction,
 * normalised by the window size.
 */
export const scoreRunLength = (ticks, { window = 10, direction = 'rise' } = {}) => {
    if (!Array.isArray(ticks) || ticks.length < 2) return 0;
    const slice = ticks.slice(-(window + 1));
    let run = 0;
    for (let i = slice.length - 1; i >= 1; i -= 1) {
        const cur = slice[i].quote >= slice[i - 1].quote ? 'rise' : 'fall';
        if (cur === 'equal' || slice[i].quote === slice[i - 1].quote) break;
        if (cur === direction) run += 1;
        else break;
    }
    return Math.min(run / window, 1);
};

/**
 * Last-digit anomaly score: frequency of a digit in the last `window` ticks
 * vs the expected 0.1 baseline.
 *   mode 'rare'   -> score = 1 - (count / expected)  (clamped to [0,1]); higher = rarer
 *   mode 'common' -> score = min(count / expected, 2) / 2;     higher = more common
 * Returns the score of the best matching digit.
 */
export const scoreDigitAnomaly = (ticks, { window = 50, mode = 'rare', pip_size = 2 } = {}) => {
    if (!Array.isArray(ticks) || ticks.length < 2) return 0;
    const slice = ticks.slice(-window);
    const counts = new Array(10).fill(0);
    slice.forEach(t => {
        const v = Number(t.quote).toFixed(pip_size);
        const d = v[v.length - 1] - 0;
        if (!Number.isNaN(d)) counts[d] += 1;
    });
    const total = slice.length;
    if (total === 0) return 0;
    const expected = total / 10;
    if (expected === 0) return 0;
    let bestScore = 0;
    for (let d = 0; d < 10; d += 1) {
        const ratio = counts[d] / expected;
        const score = mode === 'rare' ? Math.max(0, 1 - ratio) : Math.min(ratio, 2) / 2;
        if (score > bestScore) bestScore = score;
    }
    return bestScore;
};

/**
 * RSI of tick prices (Wilder's smoothing, default period 14).
 * Direction 'rise': score high when RSI < 30 (oversold).
 * Direction 'fall': score high when RSI > 70 (overbought).
 */
export const scoreRSI = (ticks, { period = 14, direction = 'rise' } = {}) => {
    if (!Array.isArray(ticks) || ticks.length < period + 1) return 0;
    const slice = ticks.slice(-(period + 10)).map(t => Number(t.quote));
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < period + 1; i += 1) {
        const d = slice[i] - slice[i - 1];
        if (d >= 0) gains += d;
        else losses -= d;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < slice.length; i += 1) {
        const d = slice[i] - slice[i - 1];
        const gain = d >= 0 ? d : 0;
        const loss = d < 0 ? -d : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    if (direction === 'rise') {
        if (rsi >= 30) return 0;
        return (30 - rsi) / 30;
    }
    if (rsi <= 70) return 0;
    return (rsi - 70) / 30;
};

export const ALL_SCORERS = {
    momentum: scoreMomentum,
    runLength: scoreRunLength,
    digitAnomaly: scoreDigitAnomaly,
    rsi: scoreRSI,
};

export default ALL_SCORERS;