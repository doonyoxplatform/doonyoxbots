// Robustness checks for the market scanner:
// (a) sanity  — reject clearly bogus ticks (NaN, 0, massive recent move);
// (b) flat-tape — detect a market that is pegged (no genuine direction);
// (c) re-entry  — enforce a "no re-entry until pattern re-arms" cooldown;
// (d) pacing    — at most N entries in a rolling 60s window (global);
// (e) stale     — reject markets whose last tick is older than `stale_ms`;
// (f) payout    — skip if the live payout is unrealistically high (bot-bot).
//
// (a)/(b)/(e)/(f) are tick-level. (c)/(d) are session-level and stateful,
// so they live as tiny classes here.

// ---------- (a) tick sanity ----------
// Quote must be finite and not a rounding blow-up relative to its own
// running median in the last 30 ticks. Volatility feeds normally move at
// most a few pips between consecutive ticks; a >10x jump almost always
// means the symbol reset or the feed restarted while we still hold the
// subscription (common when a market is swapped at 11:00 UTC).
export function isSaneTick(quotes, { window = 30, min = 1e-6, max = 1e12, moveRatio = 10 } = {}) {
    if (!Array.isArray(quotes) || quotes.length === 0) return false;
    const a = Number(quotes[quotes.length - 1]?.quote);
    if (!Number.isFinite(a) || a <= min || a >= max) return false;
    const w = window, head = quotes.length - w < 0 ? 0 : quotes.length - w;
    const sample = quotes.slice(head, -1);
    if (sample.length < 3) return true;
    const xs = sample.map(t => Number(t?.quote)).filter(Number.isFinite).sort((p, q) => p - q);
    const median = xs[Math.floor((xs.length - 1) / 2)];
    if (!Number.isFinite(median) || Math.abs(median) < min) return true;
    const ratio = Math.abs(a - median) / Math.abs(median);
    return ratio < moveRatio;
}

// ---------- (b) flat-tape ----------
// For N most recent ticks require at least `min_turns` sign changes in
// direction AND `min_range_pips` of total range. Below either threshold
// the market is "pegged" and a directional signal is noise.
export function isFlatTape(quotes, { window = 20, min_turns = 2, min_range = 4, pip_size = 2 } = {}) {
    if (!Array.isArray(quotes) || quotes.length < 2) return false;
    const w = window;
    const tail = quotes.slice(-w);
    let turns = 0;
    for (let i = 1; i < tail.length; i += 1) {
        const prev = Number(tail[i - 1]?.quote);
        const cur = Number(tail[i]?.quote);
        if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
        if ((prev - cur) * (i > 1 ? Number(tail[i].quote) - Number(tail[i - 1].quote) : 1) < 0) turns += 1;
        if ((cur - prev) * (i > 1 ? Number(tail[i].quote) - Number(tail[i - 1].quote) : 1) > 0 && turns > 0 && i > 2) {
            // ignore; we count direction flips only once per change
        }
    }
    // Recompute turnovers more simply: count sign flips.
    let turnovers = 0;
    let lastDelta = null;
    for (let i = 1; i < tail.length; i += 1) {
        const prev = Number(tail[i - 1]?.quote);
        const cur = Number(tail[i]?.quote);
        if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
        const d = Math.sign(cur - prev);
        if (lastDelta !== null && d !== 0 && lastDelta !== 0 && d !== lastDelta) turnovers += 1;
        if (d !== 0) lastDelta = d;
    }

    const lo = Math.min(...tail.map(t => Number(t?.quote)).filter(Number.isFinite));
    const hi = Math.max(...tail.map(t => Number(t?.quote)).filter(Number.isFinite));
    const rangePips = (hi - lo) / pip_size;
    return turnovers < min_turns || rangePips < min_range;
}

// ---------- (e) stale ----------
export function isStale(market, { ms = 10_000 } = {}) {
    if (!market || !Array.isArray(market.quotes) || market.quotes.length === 0) return true;
    const last = market.quotes[market.quotes.length - 1];
    if (!Number.isFinite(last?.epoch)) return true;
    return Date.now() - Number(last.epoch) * 1000 > ms;
}

// ---------- (f) payout ----------
// A fair Euclidean option's ask price is the risk-free probability of a
// "win" times the payout. A base 0.97-type payout for a 50/50 product
// would be ~0.5. Anything above 0.75 is either a bot-bot auction or a
// temporarily mis-priced state — skip those.
export function payoutSanity(payout, { min = 0.1, max = 0.75 } = {}) {
    const p = Number(payout);
    if (!Number.isFinite(p)) return { ok: false, reason: 'not-finite' };
    if (p < min) return { ok: false, reason: 'too-low' };
    if (p > max) return { ok: false, reason: 'too-high' };
    return { ok: true, reason: null };
}

// ---------- (c) re-entry cooldown ----------
// After N re-entries within a rolling window, require a full cycle: we
// re-arm only when the score goes back below the threshold for at least
// `coolDownMs` (default 60s). Implement robot-independently; the store
// consumes this on each tick.
export class ReEntryCooldown {
    constructor({ count = 3, ms = 60_000 } = {}) {
        this.count = count;
        this.ms = ms;
        this._events = new Map(); // market -> Array<ts>
        this._blockedUntil = new Map(); // market -> ts (when re-arm)
    }

    // Returns true if entry is currently blocked for this market.
    isBlocked(marketId) {
        const until = this._blockedUntil.get(marketId) ?? 0;
        return Date.now() < until;
    }

    // Called by the store when a trade happens. Increments and may block.
    mark(marketId) {
        const list = (this._events.get(marketId) ?? []).filter(ts => Date.now() - ts < this.ms);
        list.push(Date.now());
        this._events.set(marketId, list);
        if (list.length >= this.count) {
            this._blockedUntil.set(marketId, Date.now() + this.ms);
            this._events.set(marketId, []);
        }
    }

    // Called by the store on each tick; returns true if the cooldown lifts.
    release(marketId) {
        const until = this._blockedUntil.get(marketId) ?? 0;
        if (until > 0 && Date.now() >= until) {
            this._blockedUntil.set(marketId, 0);
            this._events.set(marketId, []);
            return true;
        }
        return false;
    }

    reset() {
        this._events.clear();
        this._blockedUntil.clear();
    }
}

// ---------- (d) pacing ----------
// Global rolling 60s cap. Returns true (and records) if the entry fits,
// false if we would exceed the cap (caller should treat as "skip / paced").
export class PacingGuard {
    constructor({ window = 60_000, limit = 10 }) {
        this.window = window;
        this.limit = limit;
        this._events = [];
    }

    // Returns true if the entry is allowed (and records the event);
    // false if pacing gate would be exceeded (no recording).
    check() {
        const now = Date.now();
        this._events = this._events.filter(ts => now - ts < this.window);
        return this._events.length < this.limit;
    }

    mark() {
        this._events.push(Date.now());
    }

    // Convenience: combined "can we enter?" then "record the entry".
    bump() {
        if (!this.check()) return true; // "exceeds"
        this.mark();
        return false;
    }

    reset() {
        this._events = [];
    }
}

// ---------- (extra) digit/parity auto-pickers ----------
// For DIGITMATCH/DIGITDIFF bots that don't have a user-set digit: we
// want the least likely      digit for "DIFFER" and the most likely digit
// for "MATCHES". The digit of a price is derived by
//   floor(price * 10^pip_size) % 10
export function pickDigit(quotes, { mode = 'rarest', window = 100, pip_size = 0 } = {}) {
    if (!Array.isArray(quotes) || quotes.length === 0) return null;
    const tail = quotes.slice(-window).map(q => Number(q?.quote)).filter(Number.isFinite);
    if (tail.length === 0) return null;
    const fs = Math.max(0, pip_size);
    const factor = Math.pow(10, fs);
    const counts = new Array(10).fill(0);
    tail.forEach(p => {
        const d = Math.floor(Math.abs(p) * factor) % 10;
        counts[d] += 1;
    });
    const order = counts.map((c, d) => ({ d, c })).sort((a, b) => (mode === 'most_common' ? b.c - a.c : a.c - b.c));
    // Ties resolved by last-seen frequency only; we return the first.
    return order[0]?.d ?? null;
}

// For ODD/EVEN: prefer the rare parity (the side that gives >50/50 base
// edge). The first 0-indexed tick in the tail defines the parity since
// what the user holds is a 0/1 comparison tick, not an asset price.
export function pickParity(quotes, { window = 100, pip_size = 0, prefer = 'rare' } = {}) {
    if (!Array.isArray(quotes) || quotes.length === 0) return 'odd';
    const tail = quotes.slice(-window).map(q => Number(q?.quote)).filter(Number.isFinite);
    if (tail.length === 0) return 'odd';
    const fs = Math.max(0, pip_size);
    const factor = Math.pow(10, fs);
    let odd = 0;
    let even = 0;
    tail.forEach(p => {
        const d = Math.floor(Math.abs(p) * factor) % 10;
        if (d % 2 === 0) even += 1;
        else odd += 1;
    });
    if (odd === even) return 'odd';
    return prefer === 'rare' ? (odd < even ? 'odd' : 'even') : (odd >= even ? 'odd' : 'even');
}