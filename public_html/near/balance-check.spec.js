import { checkBalancesAgainstChain, lastStoredRows, tokenKind } from './balance-check.js';

// A chain whose balances are given per token: a function of the block, or 'final'.
function fakeChain(balances, { intents = [] } = {}) {
    return {
        finalHeight: async () => 1000,
        balance: async (account, token, block) => {
            const of = balances[token];
            if (!of) throw new Error(`no contract ${token}`);
            return String(of(block));
        },
        intentsTokens: async () => intents,
    };
}

const fastNear = (full) => async (url) => {
    expect(url).to.equal('https://api.fastnear.com/v1/account/a.near/full');
    return new Response(JSON.stringify(full), { status: 200 });
};

const row = (token_id, block_height, balance_after) => ({ token_id, block_height, balance_after, block_timestamp: '2026-01-01T00:00:00Z' });

describe('stored balances against the chain', () => {
    it('names how each kind of token is read', () => {
        expect(['near', 'nep141:wrap.near', 'nep245:v2_1.omni.hot.tg:56_11111111111111111111', 'astro-stakers.poolv1.near', 'aurora.pool.near', 'wrap.near', 'lst-pool.near'].map(tokenKind))
            .to.deep.equal(['near', 'intents', 'intents', 'staking pool', 'staking pool', 'fungible token', 'fungible token']);
    });

    it('takes the last row of each token, by block, and the later row on a tie', () => {
        const rows = lastStoredRows([row('near', 5, '1'), row('near', 9, '2'), row('near', 9, '3'), row('wrap.near', 2, '7'), row('near', 7, '4')]);
        expect(rows.map((r) => [r.token_id, r.balance_after])).to.deep.equal([['near', '3'], ['wrap.near', '7']]);
    });

    it('tells current, behind and wrong apart', async () => {
        const out = await checkBalancesAgainstChain('a.near', [
            row('near', 100, '50'),
            // Settles one block after its record, as transfers through a contract do,
            // then moves again later.
            row('wrap.near', 200, '30'),
            // Never held what the store ends on.
            row('usdc.near', 300, '999'),
            row('gone.near', 400, '1'),
        ], {
            chain: fakeChain({
                near: () => 50,
                'wrap.near': (block) => (block === 'final' ? 10 : block >= 201 ? 30 : 20),
                'usdc.near': () => 400,
            }),
            fetchFn: fastNear({ tokens: [], pools: [] }),
        });
        const by = Object.fromEntries(out.tokens.map((t) => [t.token, t]));
        expect(by.near.status).to.equal('current');
        expect(by['wrap.near']).to.include({ status: 'behind', now: '10', difference: '-20' });
        expect(by['wrap.near']).to.not.have.property('atLastStoredBlock');
        expect(by['usdc.near']).to.include({ status: 'wrong', atLastStoredBlock: '400', difference: '-599' });
        expect(by['gone.near'].status).to.equal('unknown');
        expect(by['gone.near'].error).to.match(/no contract/);
    });

    it('lists what is held now with no stored row, and leaves out what is empty', async () => {
        const out = await checkBalancesAgainstChain('a.near', [row('near', 1, '5')], {
            chain: fakeChain({
                near: () => 5,
                'new.poolv1.near': () => 70,
                'old.poolv1.near': () => 0,
                'nep141:lst-pool.near': () => 982,
            }, { intents: ['nep141:lst-pool.near'] }),
            fetchFn: fastNear({
                tokens: [{ contract_id: 'meta-pool.near', balance: '287' }, { contract_id: 'empty.near', balance: '0' }],
                pools: [{ pool_id: 'new.poolv1.near' }, { pool_id: 'old.poolv1.near' }],
            }),
        });
        expect(out.holdingsListed).to.equal(true);
        expect(out.heldButNotStored.map((h) => [h.token, h.kind, h.now])).to.deep.equal([
            ['meta-pool.near', 'fungible token', '287'],
            ['new.poolv1.near', 'staking pool', '70'],
            ['nep141:lst-pool.near', 'intents', '982'],
        ]);
    });

    it('says so when it could not list the holdings, rather than reporting none', async () => {
        const out = await checkBalancesAgainstChain('a.near', [row('near', 1, '5')], {
            chain: fakeChain({ near: () => 5 }),
            fetchFn: async () => new Response('busy', { status: 503 }),
        });
        expect(out.holdingsListed).to.equal(false);
        expect(out.holdingsError).to.match(/503/);
    });
});
