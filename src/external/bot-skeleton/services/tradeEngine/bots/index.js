// The 9 tap-to-run bot cards. Each is a small config: id, display name,
// fixed Deriv contract type, duration, and (where applicable) a `digitSource`
// tag the UI uses to decide whether to auto-pick a digit from the scanner
// or show a 0..9 dropdown.
//
// IMPORTANT: none of these are "edge" bots. They pick the scanner's best
// market, enter a fixed-type trade, and stop (or continue) based on the
// user's configured stop rules (SessionGuard in scanner-store).
//
// Contract types use string values the Deriv API expects:
//   CALL, PUT, DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD
// (see the TRADE_TYPE_TO_CONTRACT_CATEGORY_MAPPING in constants/config:
//  callput → CALL/PUT; matchesdiffers → DIGITMATCH/DIGITDIFF;
//  evenodd → DIGITEVEN/DIGITODD).

export const RISE_BOT = {
    id: 'RISE_BOT',
    name: 'Rise',
    group: 'callput',
    contract_type: 'CALL',
    duration: 1,
    duration_unit: 't',
};

export const FALL_BOT = {
    id: 'FALL_BOT',
    name: 'Fall',
    group: 'callput',
    contract_type: 'PUT',
    duration: 1,
    duration_unit: 't',
};

export const HIGHER_BOT = {
    id: 'HIGHER_BOT',
    name: 'Higher',
    group: 'higherlower',
    contract_type: 'CALL',
    duration: 1,
    duration_unit: 'm',
};

export const LOWER_BOT = {
    id: 'LOWER_BOT',
    name: 'Lower',
    group: 'higherlower',
    contract_type: 'PUT',
    duration: 1,
    duration_unit: 'm',
};

export const DIFFERS_AUTO_BOT = {
    id: 'DIFFERS_AUTO_BOT',
    name: 'Differs · auto-digit',
    group: 'matchesdiffers',
    contract_type: 'DIGITDIFF',
    duration: 1,
    duration_unit: 't',
    digitSource: 'least_frequent',
};

export const DIFFERS_MANUAL_BOT = {
    id: 'DIFFERS_MANUAL_BOT',
    name: 'Differs · manual-digit',
    group: 'matchesdiffers',
    contract_type: 'DIGITDIFF',
    duration: 1,
    duration_unit: 't',
    digitSource: 'manual',
};

export const MATCHES_AUTO_BOT = {
    id: 'MATCHES_AUTO_BOT',
    name: 'Matches · auto-digit',
    group: 'matchesdiffers',
    contract_type: 'DIGITMATCH',
    duration: 1,
    duration_unit: 't',
    digitSource: 'most_frequent',
};

export const MATCHES_MANUAL_BOT = {
    id: 'MATCHES_MANUAL_BOT',
    name: 'Matches · manual-digit',
    group: 'matchesdiffers',
    contract_type: 'DIGITMATCH',
    duration: 1,
    duration_unit: 't',
    digitSource: 'manual',
};

export const ODD_EVEN_BOT = {
    id: 'ODD_EVEN_BOT',
    name: 'Odd / Even',
    group: 'evenodd',
    contract_type: 'DIGITEVEN', // default; the loop flips this via `parity`
    duration: 1,
    duration_unit: 't',
    digitSource: 'parity',
};

export const ALL_BOTS = [
    RISE_BOT,
    FALL_BOT,
    HIGHER_BOT,
    LOWER_BOT,
    DIFFERS_AUTO_BOT,
    DIFFERS_MANUAL_BOT,
    MATCHES_AUTO_BOT,
    MATCHES_MANUAL_BOT,
    ODD_EVEN_BOT,
];

export const getBotById = id => ALL_BOTS.find(b => b.id === id) ?? null;

/**
 * Build a Deriv trade option for the next tick:
 *   { contract_type, underlying_symbol, currency, amount, basis,
 *     duration, duration_unit, digit? }
 * The return is passed verbatim to Proposal + Purchase.
 *
 * For digit bots (Differs/Matches) `digit` must be a number 0..9 — the UI
 * either resolved it from the scanner's digit-frequency or from the user's
 * override. When missing, returns { option: null, needsDigit: true } so
 * the UI can show "pick a digit" and not fire.
 *
 * For Odd/Even the `parity` arg picks DIGITODD vs DIGITEVEN.
 */
export const buildTradeOption = (bot, ctx) => {
    const {
        market_id,
        pip_size,
        digit,
        parity,
        currency = 'USD',
        amount = 1,
        basis = 'stake',
    } = ctx || {};

    if (!market_id) return { option: null, error: 'no_market' };

    let contract_type = bot.contract_type;
    if (bot.id === 'ODD_EVEN_BOT' && parity === 'odd') contract_type = 'DIGITODD';
    if (bot.id === 'ODD_EVEN_BOT' && parity === 'even') contract_type = 'DIGITEVEN';

    const option = {
        contract_type,
        underlying_symbol: market_id,
        currency,
        amount,
        basis,
        duration: bot.duration,
        duration_unit: bot.duration_unit,
    };
    if (typeof pip_size === 'number' && pip_size > 0) option.pip_size = pip_size;

    if (bot.group === 'matchesdiffers') {
        if (typeof digit !== 'number' || digit < 0 || digit > 9) {
            return { option: null, needsDigit: true };
        }
        option.digit = digit;
    }
    return { option };
};

export default ALL_BOTS;