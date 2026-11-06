// @ts-nocheck — vendored bot code with known upstream type gaps
import React, { memo } from 'react';
import classNames from 'classnames';

type BotCardProps = {
    id: string;
    name: string;
    state: string;
    stateReason?: string;
    arming: boolean;
    needsDigit: boolean;
    digit: number | null;
    parity: 'odd' | 'even';
    stake: number;
    pnl: number;
    trades: number;
    currency: string;
    onArm: () => void;
    onDisarm: () => void;
    onDigit: (d: number | null) => void;
    onParity: (p: 'odd' | 'even') => void;
    onStake: (s: number) => void;
};

const BotCard = memo((props: BotCardProps) => {
    const {
        id,
        name,
        state,
        stateReason,
        arming,
        needsDigit,
        digit,
        parity,
        stake,
        pnl,
        trades,
        currency,
        onArm,
        onDisarm,
        onDigit,
        onParity,
        onStake,
    } = props;

    const stateClass = `ss-bot-state--${state.toLowerCase().replace(/-/g, '-') || 'idle'}`;
    const stateLabel =
        state === 'IDLE' ? 'idle' :
        state === 'ARMED' ? 'armed' :
        state === 'SCANNING' ? 'scanning' :
        state === 'ENTERED' ? 'entered' :
        state === 'WON' ? 'won' :
        state === 'LOST' ? 'lost' :
        state === 'BROKEN' ? 'broken' :
        state === 'PAUSED' ? 'paused' :
        state === 'BLOCKED' ? 'blocked' :
        state === 'STALE-MARKET' ? 'stale' :
        state;

    return (
        <div className={classNames('ss-bot', { 'ss-bot--armed': arming })}>
            <div className="ss-bot__head">
                <span className="ss-bot__name" title={id}>{name}</span>
                <label className="ss-arm-toggle">
                    <input
                        type="checkbox"
                        checked={arming}
                        onChange={() => (arming ? onDisarm() : onArm())}
                    />
                    <span className="ss-arm-toggle__label">{arming ? 'On' : 'Off'}</span>
                </label>
            </div>

            <div className={classNames('ss-bot__state', stateClass)}>
                {stateLabel}
                {stateReason ? <span className="ss-bot__reason"> · {stateReason}</span> : null}
            </div>

            <div className="ss-bot__row">
                <span className="ss-bot__row-label">P/L</span>
                <span className={`ss-bot__row-val ${pnl >= 0 ? 'pos' : 'neg'}`}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} {currency}
                </span>
            </div>

            <div className="ss-bot__row">
                <span className="ss-bot__row-label">Trades</span>
                <span className="ss-bot__row-val">{trades}</span>
            </div>

            {needsDigit && (
                <div className="ss-bot__row">
                    <label className="ss-bot__row-label" htmlFor={`${id}-digit`}>Digit</label>
                    <select
                        id={`${id}-digit`}
                        className="ss-bot__digit"
                        value={digit === null ? '' : String(digit)}
                        onChange={e => onDigit(e.target.value === '' ? null : Number(e.target.value))}
                    >
                        <option value=''>—</option>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>
            )}

            {id === 'odd-even-bot' && (
                <div className="ss-bot__row">
                    <label className="ss-bot__row-label">Parity</label>
                    <div className="ss-bot__parity">
                        <button type="button" className={parity === 'odd' ? 'on' : ''} onClick={() => onParity('odd')}>Odd</button>
                        <button type="button" className={parity === 'even' ? 'on' : ''} onClick={() => onParity('even')}>Even</button>
                    </div>
                </div>
            )}

            <div className="ss-bot__row">
                <label className="ss-bot__row-label" htmlFor={`${id}-stake`}>Stake</label>
                <input
                    id={`${id}-stake`}
                    className="ss-bot__stake"
                    type="number"
                    min="0.35"
                    step="0.01"
                    value={stake}
                    onChange={e => onStake(Number(e.target.value) || 1)}
                />
            </div>
        </div>
    );
});

export default BotCard;