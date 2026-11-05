//! The scanner panel: a thin wrapper around the 9-bot grid + shared
// banner. Mounts as a left column of the bot-builder page.
//
// The "Live" toggle flips the dry-run flag OFF — use with caution
// because it sends real purchases.
import React, { memo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import rootStore from '../../stores/root-store';
import ScannerStore, { ALL_BOTS } from '../../stores/scanner-store';
import BotCard from './bot-card';
import './scanner.scss';

export const ScannerPanel = observer(() => {
    const scanner = rootStore.scanner as ScannerStore;
    const client = rootStore.client;
    const currency = client.getCurrency() || 'USD';

    useEffect(() => {
        const s = scanner;
        return () => { s.dispose(); };
    }, [scanner]);

    const masterPnl = Object.values(scanner.bots).reduce((acc, b: any) => acc + b.pnl, 0);

    return (
        <aside className="ss-panel">
            <div className="ss-banner">
                <div className="ss-banner__head">
                    <div className="ss-banner__switch">
                        <button
                            type="button"
                            className={`ss-pill ${scanner.scanning ? 'is-on' : ''}`}
                            onClick={async () => { if (scanner.scanning) await scanner.stop(); else await scanner.start({}, currency); }}
                        >
                            {scanner.scanning ? 'Scan ON' : 'Scan OFF'}
                        </button>
                        <button type="button" className="ss-pill" onClick={async () => scanner.start({}, currency)}>Start all</button>
                        <button type="button" className="ss-pill" onClick={async () => scanner.stop()}>Stop all</button>
                    </div>
                    <div className="ss-banner__meta">
                        <span className={`ss-runpill ${scanner.simulation ? 'ss-runpill--sim' : 'ss-runpill--live'}`}>
                            {scanner.simulation ? 'SIMULATION' : 'LIVE'}
                        </span>
                        <button type="button" className="ss-pill" onClick={scanner.toggleSimulation}>
                            {scanner.simulation ? 'Flip to Live' : 'Flip to Sim'}
                        </button>
                    </div>
                </div>

                <div className="ss-banner__pick">
                    <span className="ss-label">best</span>
                    <span className="ss-mono">{scanner.best_market_id ?? '—'}</span>
                    <span className="ss-mono">score {scanner.best_score.toFixed(3)}</span>
                    <span className="ss-mono ss-warmup">{scanner.warmup_done ? 'warmed' : 'warming…'}</span>
                </div>

                <div className="ss-banner__markets">
                    {(scanner.availableMarkets ?? []).map((m: any) => (
                        <div
                            key={m.id}
                            className={`ss-market ${m.id === scanner.best_market_id ? 'is-best' : ''} ${m.flat ? 'is-flat' : ''} ${m.stale ? 'is-stale' : ''}`}
                            style={{ ['--heat' as string]: Math.min(1, scanner.best_score || 0) }}
                        >
                            <div className="ss-market__label">{m.label}</div>
                            <div className="ss-market__quote">{m.last !== undefined ? Number(m.last).toFixed(m.pip_size) : '—'}</div>
                        </div>
                    ))}
                </div>

                <div className="ss-banner__tally">
                    <span>
                        Master P/L{' '}
                        <b className={`ss-pnl ${masterPnl >= 0 ? 'pos' : 'neg'}`}>
                            {masterPnl >= 0 ? '+' : ''}{masterPnl.toFixed(2)} {currency}
                        </b>
                    </span>
                    <button type="button" className="ss-pill" onClick={scanner.resetMaster}>Reset master</button>
                    <button type="button" className="ss-pill" onClick={scanner.clearJournal}>Clear journal</button>
                </div>
            </div>

            <div className="ss-grid">
                {ALL_BOTS.map(bot => (
                    <BotCard
                        key={bot.id}
                        id={bot.id}
                        name={bot.name}
                        state={(scanner.bots as any)[bot.id]?.state ?? 'IDLE'}
                        stateReason={(scanner.bots as any)[bot.id]?.stateReason ?? ''}
                        arming={(scanner.bots as any)[bot.id]?.arming ?? false}
                        needsDigit={!!bot.requiresDigit}
                        digit={(scanner.bots as any)[bot.id]?.digit ?? null}
                        parity={(scanner.bots as any)[bot.id]?.parity ?? 'odd'}
                        stake={(scanner.bots as any)[bot.id]?.stake ?? 1}
                        pnl={(scanner.bots as any)[bot.id]?.pnl ?? 0}
                        trades={(scanner.bots as any)[bot.id]?.trades ?? 0}
                        currency={currency}
                        onArm={() => scanner.arm(bot.id)}
                        onDisarm={() => scanner.disarm(bot.id)}
                        onDigit={(d) => scanner.setDigit(bot.id, d)}
                        onParity={(p) => scanner.setParity(bot.id, p)}
                        onStake={s => scanner.setStake(bot.id, s)}
                    />
                ))}
            </div>
        </aside>
    );
});

export default memo(ScannerPanel);