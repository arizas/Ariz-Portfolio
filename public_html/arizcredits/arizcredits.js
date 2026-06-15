import { callViewFunction } from '../near/rpc.js';

// Shared ARIZ-credits helpers: constants, amount formatting, on-chain view
// helpers, and wallet-selector action builders. Used by both the Ariz credits
// page and the Accounts page.

export const ARIZCREDITS_CONTRACT_ID = 'arizcredits.near';
// The operator a user authorises is the contract account itself (the contract's
// deduct uses operator === current_account_id).
export const OPERATOR_ACCOUNT = ARIZCREDITS_CONTRACT_ID;
export const ARIZ_DECIMALS = 6;

const GAS = '300000000000000'; // 300 Tgas
const HALF_NEAR = '500000000000000000000000'; // 0.5 NEAR — buy_tokens_for_near price
const ONE_YOCTO = '1'; // ft_transfer requires exactly 1 yoctoNEAR
const STORAGE_DEPOSIT = '1250000000000000000000'; // 0.00125 NEAR — NEP-145 registration

/** Format a raw 6-decimal ARIZ amount (string) as a human-readable number. */
export function formatAriz(raw) {
    const n = BigInt(raw ?? '0');
    const base = 10n ** BigInt(ARIZ_DECIMALS);
    const whole = n / base;
    const frac = (n % base).toString().padStart(ARIZ_DECIMALS, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a human ARIZ amount ("1.5") to a raw 6-decimal integer string. */
export function parseAriz(value) {
    const [w, f = ''] = String(value).trim().split('.');
    const frac = (f + '0'.repeat(ARIZ_DECIMALS)).slice(0, ARIZ_DECIMALS);
    return (BigInt(w || '0') * 10n ** BigInt(ARIZ_DECIMALS) + BigInt(frac || '0')).toString();
}

// ---- on-chain view helpers ----

export async function getArizBalance(accountId) {
    return (await callViewFunction(ARIZCREDITS_CONTRACT_ID, 'ft_balance_of', { account_id: accountId }).catch(() => '0')) ?? '0';
}

export async function getAuthorisation(accountId) {
    return callViewFunction(ARIZCREDITS_CONTRACT_ID, 'view_js_func', {
        function_name: 'view_authorisation', user: accountId, operator_account: OPERATOR_ACCOUNT,
    }).catch(() => null);
}

export async function getSpentSinceReset(accountId) {
    return (await callViewFunction(ARIZCREDITS_CONTRACT_ID, 'view_js_func', {
        function_name: 'view_spent_since_reset', user: accountId, operator_account: OPERATOR_ACCOUNT,
    }).catch(() => '0')) ?? '0';
}

/** NEP-145 storage balance (null when the account isn't registered to hold ARIZ). */
export async function getStorageBalance(accountId) {
    return callViewFunction(ARIZCREDITS_CONTRACT_ID, 'storage_balance_of', { account_id: accountId }).catch(() => null);
}

// ---- wallet-selector action builders ----

/** A FunctionCall action that dispatches an on-chain JS method via call_js_func. */
export function jsFunctionCall(functionName, extraArgs = {}, deposit = '0') {
    return {
        type: 'FunctionCall',
        params: { methodName: 'call_js_func', args: { function_name: functionName, ...extraArgs }, gas: GAS, deposit },
    };
}

export function buyTokensAction() {
    return jsFunctionCall('buy_tokens_for_near', {}, HALF_NEAR);
}

export function authorizeAction(maxAmountPerDayRaw) {
    return jsFunctionCall('authorize_deduction', { operator_account: OPERATOR_ACCOUNT, max_amount_per_day: maxAmountPerDayRaw });
}

export function revokeAction() {
    return jsFunctionCall('revoke_deduction', { operator_account: OPERATOR_ACCOUNT });
}

/** Standard NEP-141 ft_transfer of ARIZ to a receiver. */
export function ftTransferAction(receiverId, amountRaw) {
    return {
        type: 'FunctionCall',
        params: { methodName: 'ft_transfer', args: { receiver_id: receiverId, amount: amountRaw }, gas: GAS, deposit: ONE_YOCTO },
    };
}

/** Register an account for ARIZ storage so it can receive tokens. */
export function storageDepositAction(accountId) {
    return {
        type: 'FunctionCall',
        params: { methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: GAS, deposit: STORAGE_DEPOSIT },
    };
}
