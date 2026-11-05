// Bot registry for the scanner panel.
// Each bot is a Blockly marble (XML) that lives in /bots/<name>.xml in the public folder,
// plus metadata the scanner uses to drive its per-bot state machine.

export interface BotDefinition {
    /** Unique bot id — also the filename (without extension) in public/bots/ */
    id: string;
    /** Human-friendly display name shown on the scanner card */
    name: string;
    /**
     * The marble (Blockly XML) filename in the public /bots/ folder.
     * Loaded by the scanner via fetch to drive the bot.
     */
    marble: string;
    /**
     * Whether this bot needs a specific digit prediction (0-9) to be configured
     * before arming. Bots that always predict (e.g. odd/even) don't need this.
     */
    requiresDigit?: boolean;
    /**
     * Default parity target ('odd' | 'even') — only present for bots that
     * predict a parity rather than a specific digit.
     */
    parity?: 'odd' | 'even';
    /** Default stake in account currency */
    stake?: number;
    /** Optional contract duration override in ticks */
    duration?: number;
}

export const ALL_BOTS: BotDefinition[] = [
    {
        id: 'smart-differ',
        name: 'Smart Differ',
        marble: 'smart-differ.xml',
        requiresDigit: true,
        stake: 0.55,
        duration: 2,
    },
    {
        id: 'digit-differ',
        name: 'Digit Differ',
        marble: 'digit-differ.xml',
        requiresDigit: true,
        stake: 1,
        duration: 5,
    },
    {
        id: 'digit-matches',
        name: 'Digit Matches',
        marble: 'digit-matches.xml',
        requiresDigit: true,
        stake: 1,
        duration: 5,
    },
    {
        id: 'odd-even-bot',
        name: 'Odd/Even Bot',
        marble: 'odd-even.xml',
        parity: 'odd',
        stake: 1,
        duration: 5,
    },
    {
        id: 'rise-fall',
        name: 'Rise/Fall',
        marble: 'rise-fall.xml',
        stake: 1,
        duration: 5,
    },
    {
        id: 'over-under',
        name: 'Over/Under',
        marble: 'over-under.xml',
        requiresDigit: true,
        stake: 1,
        duration: 5,
    },
    {
        id: 'even-odd-alternate',
        name: 'Even/Odd Alternate',
        marble: 'even-odd-alternate.xml',
        stake: 1,
        duration: 3,
    },
    {
        id: 'last-digit-pattern',
        name: 'Last Digit Pattern',
        marble: 'last-digit-pattern.xml',
        requiresDigit: true,
        stake: 0.85,
        duration: 10,
    },
    {
        id: 'martingale-differ',
        name: 'Martingale Differ',
        marble: 'martingale-differ.xml',
        requiresDigit: true,
        stake: 0.35,
        duration: 5,
    },
];
