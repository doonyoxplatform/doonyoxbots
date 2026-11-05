// Market scanner: subscribes to a list of Vol/Jump markets, buffers their
// ticks, scores them with the configured weights, and emits `TRADE_TICK`
// when the top scorer crosses a configurable threshold with hysteresis so
// we don't re-enter on every tick. Callers wire up `emitter` callbacks.
//
// IMPORTANT: the scores are entry filters, not predictors. They will not
// beat the base payout on a random-walk product; they exist to (a) keep the
// bot out of obvious no-signal zones, (b) give the user a visible reason
// for each entry so they can tune the weights, and (c) slot into the same
// signal/score plumbing that a proper predictive model would use later.
import { api_base } from '../api-base';
import { DEFAULT_HYSTERESIS_MS, DEFAULT_MARKETS, DEFAULT_WARMUP_TICKS, getMarketById } from './symbols';
import { ALL_SCORERS } from './score';
import { append as journalAppend } from './journal';
import { START_SCAN, STOP_SCAN, TRADE_TICK, WARMUP_DONE } from './events';

export class MarketScanner {
    constructor({ emitter, markets = DEFAULT_MARKETS, dryRun = false, pipSizeFallback = 2 } = {}) {
        if (!emitter) throw new Error('MarketScanner: emitter is required');
        this.emitter = emitter;
        this.markets = markets.map(m => ({ ...m, quotes: [], pip_size: pipSizeFallback, streamKey: null, warmup_done: false }));
        this.state = {
            is_scanning: false,
            dry_run: !!dryRun,
            warmup_done: false,
            best_market_id: null,
            best_score: 0,
            best_reason: '',
            pending_event: null,
            pending_since: 0,
            stale_ms: new Map(),
            exclusion_until: new Map(),
        };
        this.options = {
            weights: { momentum: 1 },
            direction: 'rise',
            threshold: 0.6,
            hysteresis_ms: DEFAULT_HYSTERESIS_MS,
            warmup_ticks: DEFAULT_WARMUP_TICKS,
            pip_size: 2,
            tickHandler: null,
        };
        this._unsubscribes = [];
    }

    /**
     * start(options: {
     *   weights: { momentum?: number, runLength?: number, digitAnomaly?: number, rsi?: number },
     *   direction: 'rise' | 'fall',
     *   threshold: number (0..1),
     *   hysteresis_ms: number,
     *   warmup_ticks: number,
     *   pip_size: number,
     *   tickHandler?: (payload) => void,
     * })
     */
    async start(options = {}) {
        if (this.state.is_scanning) return;
        this.options = {
            ...this.options,
            weights: options.weights || this.options.weights,
            direction: options.direction || this.options.direction,
            threshold: typeof options.threshold === 'number' ? options.threshold : this.options.threshold,
            hysteresis_ms: options.hysteresis_ms ?? this.options.hysteresis_ms,
            warmup_ticks: options.warmup_ticks ?? this.options.warmup_ticks,
            pip_size: options.pip_size ?? this.options.pip_size,
            tickHandler: options.tickHandler || null,
        };
        this.state.is_scanning = true;
        this.state.warmup_done = false;
        this.state.best_market_id = null;
        this.state.best_score = 0;
        this.state.best_reason = '';
        this.state.stale_ms.clear();
        this.state.exclusion_until.clear();
        this.markets.forEach(m => {
            m.warmup_done = false;
            m.quotes = [];
        });

        // Hydrate pip sizes from api_base if available (chart preloads them).
        try {
            const active_symbols = api_base.active_symbols?.active_symbols;
            if (Array.isArray(active_symbols)) {
                active_symbols.forEach(a => {
                    const m = this.markets.find(mm => mm.id === a.symbol);
                    if (m) m.pip_size = a.pip_size || this.options.pip_size;
                });
            }
        } catch {
            // no-op
        }

        if (!api_base.api) {
            this.emitter.emit(STOP_SCAN, { reason: 'api-not-ready' });
            this.state.is_scanning = false;
            return;
        }

        // Subscribe each market via the raw Deriv API.
        let subscribedCount = 0;
        await Promise.all(
            this.markets.map(async m => {
                try {
                    const requestObject = { ticks: m.id, subscribe: 1, style: 'ticks', count: this.options.warmup_ticks };
                    const r = await api_base.api.send(requestObject);
                    m.streamKey = r?.subscription?.id ?? m.streamKey;
                    // Register the per-market message handler (equivalent to what
                    // the bot-skeleton's TicksService does when it calls
                    // `api_base.api.onMessage().subscribe(...)`). We only do this
                    // once per scanner.start() call, so each start/stop cycle is
                    // idempotent.
                    if (!m._handlerAttached) {
                        const sub = api_base.api.onMessage().subscribe(msg => {
                            if (msg?.data?.msg_type === 'tick' && msg?.data?.tick?.symbol === m.id) {
                                const t = msg.data.tick;
                                m.quotes = this._pushQuote(m.quotes, { quote: Number(t.quote), epoch: Number(t.epoch) });
                                this.handleTick(m);
                            }
                        });
                        if (sub?.unsubscribe) this._unsubscribes.push(sub);
                        m._handlerAttached = true;
                    }
                    subscribedCount += 1;
                } catch (error) {
                    // Market may be closed or auth-less; skip silently.
                    if (error?.error?.code !== 'AlreadySubscribed') {
                        // eslint-disable-next-line no-console
                        console.warn(`[MarketScanner] failed to subscribe ${m.id}:`, error?.error?.message);
                    }
                }
            })
        );

        if (subscribedCount === 0) {
            this.emitter.emit(STOP_SCAN, { reason: 'no-subscriptions' });
            this.state.is_scanning = false;
            return;
        }
        this.emitter.emit(START_SCAN, {
            markets: this.markets.map(m => m.id),
            direction: this.options.direction,
            threshold: this.options.threshold,
            hysteresis_ms: this.options.hysteresis_ms,
            weights: this.options.weights,
        });
    }

    _pushQuote(existing, newQuote) {
        if (!Array.isArray(existing)) return [newQuote];
        if (existing.length > 0 && existing[existing.length - 1].epoch >= newQuote.epoch) return existing;
        const next = [...existing.slice(1), newQuote];
        return next.length > 3000 ? next.slice(next.length - 3000) : next;
    }

    handleTick(market) {
        if (!this.state.is_scanning || !market.warmup_done === true && market.warmup_done === false) {
            // tick arrives during warm-up is fine, but we still want to record
            // warmup completeness.
        }
        if (!this.state.is_scanning) return;
        if (!Array.isArray(market.quotes) || market.quotes.length === 0) return;
        const last = market.quotes[market.quotes.length - 1];
        if (last?.epoch) this.state.stale_ms.set(market.id, Date.now() - Number(last.epoch) * 1000);

        if (!market.warmup_done && market.quotes.length >= this.options.warmup_ticks) market.warmup_done = true;
        if (!this.state.warmup_done && this.markets.every(mm => mm.warmup_done)) {
            this.state.warmup_done = true;
            this.emitter.emit(WARMUP_DONE, {});
        }

        // Circuit breaker: stale market => skip.
        const now = Date.now();
        const exclusion = this.state.exclusion_until.get(market.id) ?? 0;
        if (exclusion > now) return;

        // Jump-spike exclusion for Jump indices.
        if (market.group === 'jump') {
            const recent = market.quotes.slice(-50);
            if (recent.length >= 30) {
                const quotes = recent.map(t => Number(t.quote)).sort((a, b) => a - b);
                const median = quotes[Math.floor(quotes.length / 2)];
                const range = quotes[quotes.length - 1] - quotes[0] || 1;
                const spike = Math.abs(Number(last.quote) - median);
                if (spike / range > 0.5) {
                    this.state.exclusion_until.set(market.id, now + 60_000);
                    return;
                }
            }
        }

        if (!this.state.warmup_done) return;
        this.score();
    }

    score() {
        if (!this.state.is_scanning) return;
        const { weights, direction, threshold, hysteresis_ms } = this.options;

        const scoredMarkets = this.markets
            .map(m => {
                const q = m.quotes;
                const parts = [];
                let totalWeight = 0;
                let weightedSum = 0;
                if (weights.momentum) {
                    const s = ALL_SCORERS.momentum(q, { direction, window: 20 });
                    parts.push({ name: 'momentum', value: s });
                    weightedSum += s * weights.momentum;
                    totalWeight += weights.momentum;
                }
                if (weights.runLength) {
                    const s = ALL_SCORERS.runLength(q, { direction, window: 10 });
                    parts.push({ name: 'runLength', value: s });
                    weightedSum += s * weights.runLength;
                    totalWeight += weights.runLength;
                }
                if (weights.digitAnomaly) {
                    const s = ALL_SCORERS.digitAnomaly(q, { mode: 'rare', window: 50, pip_size: m.pip_size });
                    parts.push({ name: 'digitAnomaly', value: s });
                    weightedSum += s * weights.digitAnomaly;
                    totalWeight += weights.digitAnomaly;
                }
                if (weights.rsi) {
                    const s = ALL_SCORERS.rsi(q, { direction, period: 14 });
                    parts.push({ name: 'rsi', value: s });
                    weightedSum += s * weights.rsi;
                    totalWeight += weights.rsi;
                }
                const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
                return { id: m.id, label: m.label, score, parts, pip_size: m.pip_size, last: q[q.length - 1] };
            })
            .filter(m => m.score > 0)
            .sort((a, b) => b.score - a.score);

        const top = scoredMarkets[0];
        if (!top) {
            if (this.state.best_score > 0) {
                this.state.best_market_id = null;
                this.state.best_score = 0;
                this.state.best_reason = '';
            }
            return;
        }

        // Update in-memory best before the hysteresis gate.
        this.state.best_market_id = top.id;
        this.state.best_score = top.score;
        this.state.best_reason = top.parts.map(p => `${p.name}=${p.value.toFixed(2)}`).join(', ');

        const now = Date.now();
        if (top.score >= threshold) {
            if (this.state.pending_event === null) {
                this.state.pending_event = top.id;
                this.state.pending_since = now;
            } else if (this.state.pending_event === top.id && now - this.state.pending_since >= hysteresis_ms) {
                this.emitTradeSignal(top);
                this.state.pending_event = null;
            } else if (this.state.pending_event !== top.id) {
                this.state.pending_since = now;
            }
        } else {
            this.state.pending_event = null;
        }
    }

    emitTradeSignal(top) {
        const market = getMarketById(top.id);
        const entry = {
            ts: Date.now(),
            market: top.id,
            market_label: top.label,
            direction: this.options.direction,
            score: top.score,
            last_quote: top.last?.quote,
            parts: top.parts,
            dry_run: this.state.dry_run,
        };
        this.emitter.emit(TRADE_TICK, entry);
        journalAppend(entry).catch(() => {});
    }

    stop() {
        if (!this.state.is_scanning) return;
        this.state.is_scanning = false;
        this.state.best_market_id = null;
        this.state.best_score = 0;
        this.state.best_reason = '';
        this.state.pending_event = null;
        if (api_base.api) {
            try {
                api_base.api.forgetAll('ticks');
            } catch (e) {
                // best-effort forget
            }
        }
        // Drop the per-market handler registrations so they don't leak.
        this._unsubscribes.forEach(sub => sub?.unsubscribe?.());
        this._unsubscribes = [];
        this.markets.forEach(m => (m._handlerAttached = false));
        this.emitter.emit(STOP_SCAN, {});
    }

    setStatus(key, value) {
        if (Object.prototype.hasOwnProperty.call(this.state, key)) this.state[key] = value;
    }

    getSnapshot() {
        return {
            is_scanning: this.state.is_scanning,
            best_market_id: this.state.best_market_id,
            best_score: this.state.best_score,
            best_reason: this.state.best_reason,
            warmup_done: this.state.warmup_done,
            dry_run: this.state.dry_run,
            markets: this.markets.map(m => ({
                id: m.id,
                label: m.label,
                last: m.quotes?.[m.quotes.length - 1]?.quote,
                pip_size: m.pip_size,
                warmup_done: !!m.warmup_done,
            })),
        };
    }
}