//! The scanner panel: a thin wrapper around the 9-bot grid + shared
// banner. Mounts as a left column of the bot-builder page.
//
// The "Live" toggle flips the dry-run flag OFF — use with caution
// because it sends real purchases.
import React, { memo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import ScannerStore from '@/stores/scanner-store';
import { ALL_BOTS } from '@/pages/bots';
import BotCard from './bot-card';
import './scanner.scss';

export const ScannerPanel = observer(() => {
    const { scanner, client } = useStore();
    const s = scanner as unknown as ScannerStore;
    const currency = client.getCurrency() || 'USD';

    useEffect(() => {
        return () => { s.stop(); };
    }, [s]);

    const masterPnl = Object.values(s.bots).reduce((acc, b: any) => acc + b.pnl, 0);

    return (
        <aside className="ss-panel">
            <div className="ss-banner">
                <div className="ss-banner__head">
                    <div className="ss-banner__switch">
                        <button
                            type="button"
                            className={`ss-pill ${s.scanning ? 'is-on' : ''}`}
                            onClick={async () => { if (s.scanning) await s.stop(); else await s.start({}, currency); }}
                        >
                            {s.scanning ? 'Scan ON' : 'Scan OFF'}
                        </button>
                        <button type="button" className="ss-pill" onClick={async () => s.start({}, currency)}>Start all</button>
                        <button type="button" className="ss-pill" onClick={async () => s.stop()}>Stop all</button>
                    </div>
                    <div className="ss-banner__meta">
                        <span className={`ss-runpill ${s.simulation ? 'ss-runpill--sim' : 'ss-runpill--live'}`}>
                            {s.simulation ? 'SIMULATION' : 'LIVE'}
                        </span>
                        <button type="button" className="ss-pill" onClick={s.toggleSimulation}>
                            {s.simulation ? 'Flip to Live' : 'Flip to Sim'}
                        </button>
                    </div>
                </div>

                <div className="ss-banner__pick">
                    <span className="ss-label">best</span>
                    <span className="ss-mono">{s.best_market_id ?? '—'}</span>
                    <span className="ss-mono">score {s.best_score.toFixed(3)}</span>
                    <span className="ss-mono ss-warmup">{s.warmup_done ? 'warmed' : 'warming…'}</span>
                </div>

                <div className="ss-banner__markets">
                    {(s.availableMarkets ?? []).map((m: any) => (
                        <div
                            key={m.id}
                            className={`ss-market ${m.id === s.best_market_id ? 'is-best' : ''} ${m.flat ? 'is-flat' : ''} ${m.stale ? 'is-stale' : ''}`}
                            style={{ ['--heat' as string]: Math.min(1, s.best_score || 0) }}
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
                    <button type="button" className="ss-pill" onClick={s.resetMaster}>Reset master</button>
                    <button type="button" className="ss-pill" onClick={s.clearJournal}>Clear journal</button>
                </div>
            </div>

            <div className="ss-grid">
                {ALL_BOTS.map(bot => (
                    <BotCard
                        key={bot.id}
                        id={bot.id}
                        name={bot.name}
                        state={(s.bots as any)[bot.id]?.state ?? 'IDLE'}
                        stateReason={(s.bots as any)[bot.id]?.stateReason ?? ''}
                        arming={(s.bots as any)[bot.id]?.arming ?? false}
                        needsDigit={!!bot.requiresDigit}
                        digit={(s.bots as any)[bot.id]?.digit ?? null}
                        parity={(s.bots as any)[bot.id]?.parity ?? 'odd'}
                        stake={(s.bots as any)[bot.id]?.stake ?? 1}
                        pnl={(s.bots as any)[bot.id]?.pnl ?? 0}
                        trades={(s.bots as any)[bot.id]?.trades ?? 0}
                        currency={currency}
                        onArm={() => s.arm(bot.id)}
                        onDisarm={() => s.disarm(bot.id)}
                        onDigit={(d) => s.setDigit(bot.id, d)}
                        onParity={(p) => s.setParity(bot.id, p)}
                        onStake={st => s.setStake(bot.id, st)}
                    />
                ))}
            </div>
        </aside>
    );
});

export default memo(ScannerPanel);