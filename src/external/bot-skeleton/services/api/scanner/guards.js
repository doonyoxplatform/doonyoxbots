// SessionGuard: per-bot stop conditions. Catches the classic human
// failure modes: chasing every reversal, letting a losing streak run,
// and staying in until the bread is stale.
export class SessionGuard {
    constructor({ max_pnl_loss = 25, max_trades = 60, max_minutes = 60 } = {}) {
        this.max_pnl_loss = max_pnl_loss;
        this.max_trades = max_trades;
        this.max_minutes = max_minutes;
        this.reset();
    }

    reset() {
        this.started_at = Date.now();
        this.trades = 0;
        this.realised_pnl = 0;
    }

    record(pnl) {
        this.trades += 1;
        this.realised_pnl += pnl;
    }

    check() {
        // Returns { fired, reason }.
        if (this.realised_pnl <= -this.max_pnl_loss) return { fired: true, reason: 'max_pnl_loss' };
        if (this.trades >= this.max_trades) return { fired: true, reason: 'max_trades' };
        if (Date.now() - this.started_at > this.max_minutes * 60_000) return { fired: true, reason: 'max_minutes' };
        return { fired: false, reason: null };
    }
}