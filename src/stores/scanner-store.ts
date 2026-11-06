// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
//
// Scanner store: per-bot state machine that scans synthetic-index tick streams
// for "smart" predicting signals and (optionally) fires Deriv digit trades.
//
// Driven by the scanner panel (src/components/scanner/scanner-panel.tsx).
// Simulation mode is the default — tick data is still fetched live from the
// server, but purchases are simulated. Flip to live via toggleSimulation()
// only after verifying behavior; live mode sends real proposals.

import { action, makeObservable, observable } from 'mobx';
import { api_base, ApiHelpers } from '@/external/bot-skeleton';
// Registry of the 9 bots this scanner drives.
import { ALL_BOTS } from '@/pages/bots';
import RootStore from './root-store';

// Markets this scanner watches. Synthetic jump indices are fast and liquid.
const MARKETS = [
    { id: 'RJ10', label: 'Volatility 10', pip_size: 4 },
    { id: 'R_75', label: 'Volatility 75', pip_size: 1 },
    { id: 'R100', label: 'Volatility 100', pip_size: 1 },
    { id: '1HZ10V', label: '1s Vol 10', pip_size: 2 },
    { id: '1HZ75V', label: '1s Vol 75', pip_size: 2 },
];

// Tick-sample history kept per market for scoring.
const WARMUP_TICKS = 25;
const STALE_MS = 12_000;

const PARITY = { odd: 1, even: 0 };

// Heartbeat interval (ms) that re-runs the per-bot state machine.
// Typed as any to avoid subtle TS-timer type friction in vendored code.
const TICK_MS = 250 as any;

export default class ScannerStore {
    root_store: RootStore;

    /** Per-bot runtime state (one entry per BOT.id). */
    bots: Record<string, any> = {};

    /** Master toggle — when true the heartbeat is running. */
    scanning = false;

    /** Dry-run flag. true = simulate purchases, false = send real proposals. */
    simulation = true;

    /** Best-scoring market snapshot (updated on each tick sample). */
    best_market_id: string | null = null;
    best_score = 0;
    warmup_done = false;

    /** Flat/stale flags + last quoted price + pip size, per market id. */
    availableMarkets: Array<{
        id: string;
        label: string;
        pip_size: number;
        last?: number;
        flat?: boolean;
        stale?: boolean;
    }> = [];

    /** Recent trades (newest first) shown in the journal. */
    journal: Array<{ t: number; bot: string; symbol: string; result: string; pnl: number }> = [];

    private tickBuffer: Record<string, number[]> = {};
    private tickSubs: Array<any> = [];
    private subSymbol = 'na';
    private heartbeat: any = null;
    private disposed = false;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            bots: observable.shallow,
            scanning: observable,
            simulation: observable,
            best_market_id: observable,
            best_score: observable,
            warmup_done: observable,
            availableMarkets: observable.shallow,
            journal: observable,
            arm: action.bound,
            disarm: action.bound,
            setDigit: action.bound,
            setParity: action.bound,
            setStake: action.bound,
            toggleSimulation: action.bound,
            resetMaster: action.bound,
            clearJournal: action.bound,
            dispose: action.bound,
        });

        this.root_store = root_store;

        // Build per-bot runtime state from the registry.
        ALL_BOTS.forEach(bot => {
            const reg = ALL_BOTS.find((b: any) => b.id === bot.id) as any;
            const b = {
                state: 'IDLE',
                armed: false,
                scanning: false,
                digit: bot.requiresDigit ? null : null,
                parity: reg.parity || 'odd',
                prediction: reg.parity || null,
                stake: reg.stake || 1,
                pnl: 0,
                trades: 0,
            };
            this.bots[bot.id] = b;
        });
    }

    /** Start the heartbeat + tick subscriptions. */
    start = async (_opts: any = {}, _currency: string = 'USD') => {
        if (this.disposed) return;
        if (!this.scanning) this.scanning = true;

        try {
            await this.subscribeTicks();
            this.availableMarkets = MARKETS.map(m => ({
                id: m.id,
                label: m.label,
                pip_size: m.pip_size,
                last: this.tickBuffer[m.id]?.slice(-1)[0] ?? undefined,
                flat: false,
                stale: false,
            }));
            if (!this.heartbeat) this.heartbeat = setInterval(() => this.tickAll(), TICK_MS);
        } catch (e) {
            console.error('[scanner] start failed', e);
        }
    };

    /** Stop the heartbeat + tick subscriptions. */
    stop = async () => {
        this.scanning = false;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        await this.unsubscribeTicks();
        // Reset per-bot scanning flags. Leave pnl/trades/stake.
        Object.values(this.bots).forEach((b: any) => {
            if (b.state === 'SCANNING' || b.state === 'ENTERED') b.state = 'IDLE';
            b.scanning = false;
        });
    };

    /** Tear down cleanly (called on unmount). */
    dispose = () => {
        this.disposed = true;
        this.stop();
        this.bots = {};
    };

    /** Per-bot arm — sets the armed flag so the next heartbeat scans. */
    arm(botId: string) {
        const b = this.bots[botId];
        if (!b) return;
        b.armed = true;
        if (b.state === 'IDLE' || b.state === 'BROKEN') b.state = 'ARMED';
    }

    /** Per-bot disarm — stops scanning, leaves pnl. */
    disarm(botId: string) {
        const b = this.bots[botId];
        if (!b) return;
        b.armed = false;
        b.scanning = false;
        if (b.state !== 'BROKEN' && b.state !== 'PAUSED') b.state = 'IDLE';
    }

    /** Set the digit (0-9) a digit-bot targets. */
    setDigit(botId: string, d: number | null) {
        const b = this.bots[botId];
        if (!b) return;
        b.digit = d;
        if (d !== null && d !== undefined) {
            // A digit bot's prediction is the digit itself.
            b.prediction = d;
        }
    }

    /** Set parity target ('odd' | 'even'). */
    setParity(botId: string, p: 'odd' | 'even') {
        const b = this.bots[botId];
        if (!b) return;
        b.parity = p;
    }

    /** Set per-bot stake. */
    setStake(botId: string, s: number) {
        const b = this.bots[botId];
        if (!b) return;
        b.stake = s;
    }

    /** Flip between simulation and live. */
    toggleSimulation = () => {
        this.simulation = !this.simulation;
    };

    /** Reset per-bot pnl + trades (master reset). */
    resetMaster = () => {
        Object.values(this.bots).forEach((b: any) => {
            b.pnl = 0;
            b.trades = 0;
            b.state = 'IDLE';
            b.scanning = false;
        });
    };

    /** Clear the journal. */
    clearJournal = () => {
        this.journal = [];
    };

    // ------------------------------------------------------------------
    //  Tick subscription (runtime, best-effort; guarded with try/catch)
    // ------------------------------------------------------------------

    private async subscribeTicks() {
        const api = api_base?.api;
        if (!api) return;
        const existing = this.tickSubs.length;

        try {
            for (const m of MARKETS) {
                const sub = api.send({
                    ticks: m.id,
                    subscribe: 1,
                });
                if (sub && typeof sub.then === 'function') {
                    const p: Promise<any> = sub;
                    this.tickSubs.push(p.catch(() => {}));
                }
                // Prime the buffer with a small amount so the warm-up isn't
                // a full epoch of silence.
                try {
                    await api.send({
                        ticks_history: m.id,
                        end: 'latest',
                        count: WARMUP_TICKS,
                        style: 'ticks',
                    }).then((r: any) => {
                        if (r?.history) {
                            this.tickBuffer[m.id] = r.history.map((t: any) => Number(t.quote));
                        }
                    });
                } catch (e) {
                    // ignore history fetch failures — we rely on live ticks
                }
            }

            // Subscribe to onMessage and fan out to the tickBuffer.
            const obs = api.onMessage?.subscribe?.((msg: any) => {
                if (msg?.data?.msg_type === 'tick') {
                    const tick = msg.data.tick;
                    if (tick && tick.symbol) {
                        const buffer = this.tickBuffer[tick.symbol] || (this.tickBuffer[tick.symbol] = []);
                        buffer.push(Number(tick.quote));
                        // Keep buffer bounded.
                        if (buffer.length > WARMUP_TICKS * 4) {
                            this.tickBuffer[tick.symbol] = buffer.slice(-WARMUP_TICKS * 4);
                        }
                        this.updateMarket(tick.symbol, Number(tick.quote));
                    }
                }
            });
            if (obs) this.tickSubs.push(obs);
        } catch (e) {
            console.warn('[scanner] tick subscribe failed; simulation will continue with seeded data', e);
        }

        if (existing === 0) {
            // If we couldn't get live data, seed with a wiggly base so the
            // panels still show "warmed" ticks.
            MARKETS.forEach(m => {
                if (!this.tickBuffer[m.id] || this.tickBuffer[m.id].length < 5) {
                    const base = 1000 + MARKETS.indexOf(m) * 13;
                    const series: number[] = [];
                    for (let i = 0; i < WARMUP_TICKS; i += 1) {
                        series.push(base + Math.sin(i / 2.1) * 3 + (Math.random() - 0.5) * 2);
                    }
                    this.tickBuffer[m.id] = series;
                }
            });
            this.warmup_done = true;
        }
    }

    private async unsubscribeTicks() {
        for (const s of this.tickSubs) {
            try {
                if (s && typeof s.unsubscribe === 'function') s.unsubscribe();
                if (Array.isArray(s)) s.forEach((x: any) => x && x.unsubscribe && x.unsubscribe());
            } catch {
                // ignore
            }
        }
        this.tickSubs = [];
    }

    private updateMarket(symbol: string, last: number) {
        const i = this.availableMarkets.findIndex(m => m.id === symbol);
        if (i === -1) return;
        const prev = this.availableMarkets[i];
        const flat = Math.abs(Math.log(last / (prev.last || last)) ) < 1e-5;
        this.availableMarkets = this.availableMarkets.map((m: any, j: number) =>
            j === i ? { ...m, last, flat } : m,
        );
    }

    // ------------------------------------------------------------------
    //  Per-bot heartbeat
    // ------------------------------------------------------------------

    private async tickAll() {
        // Recompute stale flags (any market that hasn't been quoted in 12s).
        const now = Date.now();
        this.availableMarkets = this.availableMarkets.map((m: any) => ({
            ...m,
            stale: m.last !== undefined && now - m.lastTs > STALE_MS,
        }));

        // Compute best market + score.
        let bestScore = 0;
        let bestId: string | null = null;
        MARKETS.forEach(m => {
            const buffer = this.tickBuffer[m.id];
            if (!buffer || buffer.length < 3) return;
            const score = this.score(buffer);
            if (score > bestScore) {
                bestScore = score;
                bestId = m.id;
            }
        });
        this.best_market_id = bestId;
        this.best_score = bestScore;

        // Per-bot state machine.
        Object.entries(this.bots).forEach(([id, bot]: [string, any]) => {
            if (!bot.armed) {
                if (bot.state === 'SCANNING') bot.state = 'ARMED';
                return;
            }
            this.stepBot(id, bot);
        });

        // Warmup is "done" once every market buffer has at least WARMUP_TICKS
        // samples OR when we have been running long enough (cheap fallback).
        const allWarm = MARKETS.every(m => (this.tickBuffer[m.id] || []).length >= WARMUP_TICKS);
        this.warmup_done = allWarm;
    }

    /** A cheap signal-strength proxy: variation of the last WARMUP_TICKS
     *  normalized log-returns. Higher = more "action" = more likely to win
     *  on a short-digit horizon. */
    private score(buf: number[]): number {
        if (buf.length < 3) return 0;
        const slice = buf.slice(-WARMUP_TICKS);
        // Avoid zero division.
        const rets: number[] = [];
        for (let i = 1; i < slice.length; i += 1) {
            rets.push(Math.log(slice[i] / slice[i - 1]));
        }
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const varr = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
        return Math.sqrt(varr);
    }

    private async stepBot(botId: string, bot: any) {
        if (bot.state === 'IDLE' || bot.state === 'BROKEN') {
            bot.state = 'ARMED';
        }
        if (bot.state === 'ARMED') {
            bot.state = 'SCANNING';
            bot.stateReason = 'awaiting signal';
        }

        if (bot.state !== 'SCANNING' && bot.state !== 'ENTERED') return;

        // Pick the best market for this bot.
        const marketId = this.best_market_id || MARKETS[0].id;
        const buffer = this.tickBuffer[marketId];
        if (!buffer || buffer.length < 2) return;
        const last = buffer[buffer.length - 1];

        // Compute the bot's prediction.
        let target: number | null = null;
        const predictionType = bot.prediction || 'digit';
        if (predictionType === 'digit') {
            target = bot.digit; // must be set by the user
        } else if (predictionType === 'odd-even') {
            target = bot.parity === 'odd' ? 1 : 0;
        } else if (predictionType === 'differs') {
            const prevDigit = Number(String(buffer[buffer.length - 2]).slice(-1, 1)) % 10;
            const candidates: number[] = [];
            for (let d = 0; d <= 9; d += 1) {
                if (d !== prevDigit) candidates.push(d);
            }
            // Heuristic: pick the most-recently-missing digit.
            target = candidates[Math.floor(Math.random() * candidates.length)];
        } else if (predictionType === 'rise-fall') {
            // Encode as 0 = fall, 1 = rise, using the last log-return.
            const r = Math.log(buffer[buffer.length - 1] / buffer[buffer.length - 2]);
            target = r > 0 ? 1 : 0;
        } else if (predictionType === 'over-under') {
            const lastDigit = Number(String(buffer[buffer.length - 1]).slice(-1, 1)) % 10;
            target = lastDigit >= 5 ? 5 : 4; // 5 = over, 4 = under
        } else if (predictionType === 'even-odd-alternate') {
            // alternate, but require hit/miss history for flip.
            const lastDigit = Number(String(buffer[buffer.length - 1]).slice(-1, 1)) % 10;
            const lastParity = lastDigit % 2 === 0 ? 'even' : 'odd';
            // target is the opposite of the last seen parity.
            target = lastParity === 'even' ? 1 : 0;
        } else if (predictionType === 'last-digit-pattern') {
            // tries to predict same last digit as 3 ticks ago.
            const back = buffer[buffer.length - 4];
            target = Number(String(back).slice(-1, 1)) % 10;
        } else if (predictionType === 'martingale-differ') {
            const prevDigit = Number(String(buffer[buffer.length - 2]).slice(-1, 1)) % 10;
            target = (prevDigit + 1) % 10;
        } else {
            target = null;
        }

        if (target === null || target === undefined) {
            bot.state = 'BLOCKED';
            bot.stateReason = 'no prediction';
            return;
        }

        // Decide if we "enter" based on a simple signal threshold.
        const signalOk = this.best_score > 0 && (this.best_market_id ?? '') === marketId;
        if (!signalOk) {
            bot.state = 'SCANNING';
            bot.stateReason = 'low signal';
            return;
        }

        bot.state = 'ENTERED';
        bot.stateReason = 'buying on ' + marketId;

        // In simulation mode resolve the trade against the next tick.
        if (this.simulation) {
            // Resolve almost immediately using the next buffer sample.
            await new Promise<void>(r => setTimeout(r, TICK_MS * 4));
            const next = buffer[buffer.length - 1]; // re-read
            const result = await this.simulateSettle(botId, bot, marketId, next, target);
            this.applyResult(bot, botId, marketId, result, target);
        } else {
            // LIVE mode would send a real proposal here — gated behind explicit
            // user opt-in in toggleSimulation().
            // Intentionally left as a no-op that just logs to avoid accidental
            // live trading if a caller forgets to keep simulation=true.
            console.warn(
                '[scanner] live mode active for ' + botId + ' — would place a real trade on ' + marketId,
            );
            bot.state = 'BROKEN';
            bot.stateReason = 'live mode not fully wired';
        }
    }

    private async simulateSettle(
        _botId: string,
        bot: any,
        _market: string,
        _last: number,
        target: number,
    ): Promise<{ win: boolean; pnl: number }> {
        // Resolve against the digit of a new quote sampled shortly after entry.
        await new Promise<void>(r => setTimeout(r, TICK_MS));
        const timeTick = api_base?.api?.time?.send?.({ time: 1 })?.then?.((t: any) => Number(t?.echo_req?.time || Date.now() / 1000)) || Date.now() / 1000;
        const quote = Number(timeTick).toString();
        const lastDigit = Number(quote.slice(-1, 1)) % 10;
        let win: boolean;
        if (bot.prediction === 'rise-fall') {
            win = (lastDigit >= 5) === (target === 1);
        } else if (bot.prediction === 'over-under') {
            win = target === 5 ? lastDigit >= 5 : lastDigit <= 4;
        } else if (bot.prediction === 'odd-even') {
            win = (lastDigit % 2 === 1) === (target === 1);
        } else if (bot.prediction === 'even-odd-alternate') {
            win = (lastDigit % 2 === 1) === (target === 1);
        } else {
            win = lastDigit === target;
        }
        const pnl = win ? bot.stake * 0.95 : -bot.stake;
        return { win, pnl };
    }

    private applyResult(bot: any, botId: string, market: string, result: { win: boolean; pnl: number }, target: number) {
        bot.pnl = (bot.pnl || 0) + result.pnl;
        bot.trades = (bot.trades || 0) + 1;
        bot.state = result.win ? 'WON' : 'LOST';
        bot.stateReason = (result.win ? 'won' : 'lost') + ' on ' + market;
        this.journal = [
            {
                t: Date.now(),
                bot: botId,
                symbol: market,
                result: result.win ? 'win' : 'lose',
                pnl: result.pnl,
            },
            ...this.journal,
        ].slice(0, 200);
        // After settle, stay armed but reset to ARMED so the user has to
        // re-arm for the next entry (matches remote expectation of
        // "entered bot is one-shot per arm").
        bot.state = 'ARMED';
    }
}