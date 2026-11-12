import { checkBalancesAgainstChain, createGatewayChain, lastStoredRows, tokenKind } from './balance-check.js';

// The gateway's balances API over a chain whose balances are given per token: a
// function of the block, or 'final'. Each request is kept, to count them.
function fakeChain(balances, { holdings = { tokens: [], pools: [], intents: [] } } = {}) {
    const requests = [];
    const request = async (path, { body } = {}) => {
        requests.push({ path, body });
        if (path.endsWith('/holdings')) {
            if (holdings instanceof Error) throw holdings;
            return holdings;
        }
        expect(path).to.equal('/api/balances/a.near');
        return {
            accountId: 'a.near',
            finalHeight: 1000,
            balances: body.reads.map((read) => {
                const of = balances[read.token];
                return of ? { ...read, balance: String(of(read.block)) } : { ...read, error: `query: no contract ${read.token}` };
            }),
        };
    };
    return { chain: createGatewayChain({ request }), requests };
}

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

    it('tells current, behind and wrong apart, in two requests', async () => {
        const fake = fakeChain({
            near: () => 50,
            'wrap.near': (block) => (block === 'final' ? 10 : block >= 201 ? 30 : 20),
            'usdc.near': () => 400,
        });
        const said = [];
        const out = await checkBalancesAgainstChain('a.near', [
            row('near', 100, '50'),
            // Settles one block after its record, as transfers through a contract do,
            // then moves again later.
            row('wrap.near', 200, '30'),
            // Never held what the store ends on.
            row('usdc.near', 300, '999'),
            row('gone.near', 400, '1'),
        ], {
            chain: fake.chain,
            progress: (message) => said.push(message),
        });
        const by = Object.fromEntries(out.tokens.map((t) => [t.token, t]));
        expect(by.near.status).to.equal('current');
        expect(by['wrap.near']).to.include({ status: 'behind', now: '10', difference: '-20' });
        expect(by['wrap.near']).to.not.have.property('atLastStoredBlock');
        expect(by['usdc.near']).to.include({ status: 'wrong', atLastStoredBlock: '400', difference: '-599' });
        expect(by['gone.near'].status).to.equal('unknown');
        expect(by['gone.near'].error).to.match(/no contract/);
        // Every token now, then the moved ones at their last stored blocks, then the holdings.
        expect(fake.requests.map((r) => r.body?.reads.length ?? 'holdings')).to.deep.equal([4, 6, 'holdings']);
        expect(fake.requests[0].body.reads.map((r) => r.kind)).to.deep.equal(['near', 'ft', 'ft', 'ft']);
        expect(fake.requests[1].body.reads.map((r) => r.block)).to.deep.equal([200, 201, 203, 300, 301, 303]);
        // Each request is said while it is waited for.
        expect(said).to.deep.equal([
            'Asking the gateway for 4 balances of a.near now',
            'Asking the gateway for 6 balances of a.near at the last stored blocks of the 2 tokens that moved',
            'Asking the gateway what a.near holds now',
        ]);
    });

    it('sends at most 300 reads in one request', async () => {
        const many = Array.from({ length: 450 }, (_, i) => row(`t${i}.near`, 1, '1'));
        const fake = fakeChain(Object.fromEntries(many.map((r) => [r.token_id, () => 1])));
        const out = await checkBalancesAgainstChain('a.near', many, { chain: fake.chain });
        expect(out.tokens.every((t) => t.status === 'current')).to.equal(true);
        expect(fake.requests.map((r) => r.body?.reads.length ?? 'holdings')).to.deep.equal([300, 150, 'holdings']);
    });

    it('lists what is held now with no stored row, and leaves out what is empty', async () => {
        const out = await checkBalancesAgainstChain('a.near', [row('near', 1, '5')], {
            chain: fakeChain({
                near: () => 5,
                'new.poolv1.near': () => 70,
                'old.poolv1.near': () => 0,
                'nep141:lst-pool.near': () => 982,
            }, {
                holdings: {
                    tokens: [{ token: 'meta-pool.near', balance: '287' }, { token: 'empty.near', balance: '0' }],
                    pools: ['new.poolv1.near', 'old.poolv1.near'],
                    intents: ['nep141:lst-pool.near'],
                },
            }).chain,
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
            chain: fakeChain({ near: () => 5 }, { holdings: new Error('502 Bad Gateway: busy') }).chain,
        });
        expect(out.holdingsListed).to.equal(false);
        expect(out.holdingsError).to.match(/502/);
    });
});
