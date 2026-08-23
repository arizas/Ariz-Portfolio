import './portfolio-page.component.js';

// The element wires its shadow-DOM references in the constructor, so the render
// methods can be exercised on a detached instance with no FIFO pass, no OPFS and
// no network.
function makePage(decomposition) {
    const el = document.createElement('portfolio-page');
    el.currentCurrency = 'nok';
    el.currentFromDate = '2026-01-01';
    el.__calculateFlowDecomposition = async () => decomposition;
    return el;
}

const base = {
    ok: true, currency: 'nok', fromDate: '2026-01-01',
    opening: 155541, closing: 303974,
    deposits: 120000, income: 2400, withdrawals: 10000,
    netFlow: 112400, gain: 36033, yieldReceived: 0,
    stakingRewards: 0, rewards: 0, valueChange: 36033,
    internal: [], ignoredNoMarket: [],
    reconciliation: { available: true, agrees: true, difference: 0 },
};

describe('where the money came from', () => {
    it('answers whether the money was added or earned', async () => {
        const el = makePage(base);
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(el.flowsSection.hidden).to.equal(false);
        expect(text).to.include('was money you added');
        expect(text).to.include('was earned');
    });

    // "Earned" covered two things that are not alike: rewards you were paid,
    // and the price moving. On one real year that was 11 512 received against
    // 80 951 of price, under one word that reads as income.
    it('separates what was paid to you from what merely changed in value', async () => {
        const el = makePage({ ...base, rewards: 11511.62, valueChange: 80951.29, gain: 92462.91 });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('Rewards received');
        expect(text).to.include('Value change');
        expect(text).to.include('was paid to you as rewards');
        expect(text).to.include('gained');
    });

    it('says rewards are yours and a change in value is not certain', async () => {
        const el = makePage({ ...base, rewards: 500, valueChange: 35533 });
        await el.renderFlows();
        expect(el.flowsEl.textContent.replace(/\s+/g, ' '))
            .to.include('neither received nor certain');
    });

    it('keeps the plain wording when nothing was paid out', async () => {
        const el = makePage(base);
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.not.include('Rewards received');
        expect(text).to.include('was earned');
    });

    it('names a fall in value as a loss', async () => {
        const el = makePage({ ...base, rewards: 300, valueChange: -4000, gain: -3700 });
        await el.renderFlows();
        expect(el.flowsEl.textContent.replace(/\s+/g, ' ')).to.include('lost in value');
    });

    it('shows the pieces that make up the change', async () => {
        const el = makePage(base);
        await el.renderFlows();
        const text = el.flowsEl.textContent;
        expect(text).to.include('Opening');
        expect(text).to.include('Added in');
        expect(text).to.include('Income received');
        expect(text).to.include('Taken out');
        expect(text).to.include('Added, net');
        expect(text).to.include('Value change');
    });

    it('leaves out rows that are zero', async () => {
        const el = makePage({ ...base, income: 0, withdrawals: 0 });
        await el.renderFlows();
        expect(el.flowsEl.textContent).to.not.include('Income received');
        expect(el.flowsEl.textContent).to.not.include('Taken out');
    });

    // How many swaps were recognised does not change how far to trust the rows
    // above — swaps never appear in them, so saying they were excluded can only
    // suggest something is missing that is not. It belongs in the year report's
    // combined view, where the reader can see both.
    it('does not report its own bookkeeping', async () => {
        const el = makePage({ ...base, internal: [{}, {}, {}, {}], transfers: [{}, {}] });
        await el.renderFlows();
        const text = el.flowsEl.textContent;
        expect(text).to.not.include('recognised and excluded');
        expect(text).to.not.include('between your own buckets');
    });

    it('still says what was left out of the figures', async () => {
        const el = makePage({ ...base, ignoredNoMarket: ['SCAM'] });
        await el.renderFlows();
        expect(el.flowsEl.textContent).to.include('left out');
        expect(el.flowsEl.textContent).to.include('SCAM');
    });

    // Gas is deductible, and today it is buried in the value change rather than
    // shown as a cost. Saying so is the difference between a figure a reader can
    // use and one they cannot.
    it('says where gas ended up', async () => {
        const el = makePage({ ...base, transactionCosts: [{ symbol: 'NEAR', value: 0.4 }] });
        await el.renderFlows();
        expect(el.flowsEl.textContent.replace(/\s+/g, ' '))
            .to.include('inside the value change rather than shown as a cost');
    });

    // The row itself says rewards were received; repeating the mechanics under
    // it told the reader nothing about whether to trust the number.
    it('says rewards are yours and a value change is not certain', async () => {
        const el = makePage({ ...base, yieldReceived: 250, rewards: 250, valueChange: 35783 });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('Rewards received');
        expect(text).to.include('neither received nor certain');
    });

    it('names tokens it ignored for having no market', async () => {
        const el = makePage({ ...base, ignoredNoMarket: ['SCAM', 'LONK'] });
        await el.renderFlows();
        expect(el.flowsEl.textContent).to.include('SCAM, LONK');
    });

    it('reads a fall as money taken out plus a loss', async () => {
        const el = makePage({
            ...base, opening: 300000, closing: 200000,
            deposits: 0, income: 0, withdrawals: 60000, netFlow: -60000, gain: -40000,
        });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('decrease');
        expect(text).to.include('was money you took out');
        expect(text).to.include('was lost');
    });
});

describe('when it will not answer', () => {
    it('refuses rather than guessing at an unpriced movement', async () => {
        const el = makePage({
            ok: false, reason: 'unpriced-flows',
            unpriced: [{ token: 'nbtc.bridge.near', symbol: 'BTC', date: '2026-07-08', units: 1 }],
        });
        await el.renderFlows();
        expect(el.flowsSection.hidden).to.equal(false);
        expect(el.flowsEl.textContent).to.include('Not calculated');
        expect(el.flowsEl.textContent).to.include('BTC');
    });

    // A bare "does not match" is not actionable. The usual cause is one side
    // priced from the wrong asset, so the refusal has to name the sides.
    it('names the transactions it could not tell apart from a swap', async () => {
        const el = makePage({
            ok: false, reason: 'ambiguous-swap',
            suspect: [{
                swapKey: 'x', date: '2026-05-02', gap: 0.9,
                inValue: 1000, outValue: 100, net: 900, legs: 2,
                outTokens: ['MOON'], inTokens: ['NEAR'],
            }],
        });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('Not calculated');
        expect(text).to.include('too far apart to be a swap');
        expect(text).to.include('2026-05-02');
        expect(text).to.include('MOON');
        expect(text).to.include('NEAR');
        expect(text).to.include('90 % apart');
    });

    it('caps how many it lists and says how many more there are', async () => {
        const suspect = Array.from({ length: 11 }, (_, i) => ({
            swapKey: `k${i}`, date: '2026-05-02', gap: 0.9, inValue: 10, outValue: 1,
            outTokens: ['A'], inTokens: ['B'],
        }));
        const el = makePage({ ok: false, reason: 'ambiguous-swap', suspect });
        await el.renderFlows();
        expect(el.flowsEl.querySelectorAll('.flow-row').length).to.equal(8);
        expect(el.flowsEl.textContent).to.include('and 3 more');
    });

    // A disagreement is shown rather than hidden, and does not guess at a cause.
    // The one that shipped this warning for a while turned out to be the check's
    // own blind spot, not the figures — see the one-sided movements above.
    it('surfaces a disagreement with the FIFO ledger', async () => {
        const el = makePage({
            ...base,
            reconciliation: { available: true, agrees: false, difference: -4200 },
        });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('may be wrong by as much as');
        expect(text).to.include('do not rely on the split');
    });

    it('says nothing about reconciliation when the two agree', async () => {
        const el = makePage(base);
        await el.renderFlows();
        expect(el.flowsEl.textContent).to.not.include('may be wrong by as much as');
    });

    it('hides itself when the calculation throws', async () => {
        const el = document.createElement('portfolio-page');
        el.currentCurrency = 'nok';
        el.currentFromDate = '2026-01-01';
        el.__calculateFlowDecomposition = async () => { throw new Error('offline'); };
        await el.renderFlows();
        expect(el.flowsSection.hidden).to.equal(true);
    });
});

describe('movements it could not price but could bound', () => {
    it('says what was skipped and what it could be worth at most', async () => {
        const el = makePage({
            ...base,
            immaterial: [
                { token: 'npro.nearmobile.near', symbol: 'NPRO', date: '2026-08-19', units: 20, estimatedValue: 40 },
                { token: 'aa-harvest-moon.near', symbol: 'MOON', date: '2026-08-19', units: 100, estimatedValue: 2.3 },
            ],
        });
        await el.renderFlows();
        const text = el.flowsEl.textContent.replace(/\s+/g, ' ');
        expect(text).to.include('2 movements in NPRO, MOON had no price on the day');
        expect(text).to.include('too little to change the split');
    });

    it('says nothing when everything was priced', async () => {
        const el = makePage(base);
        await el.renderFlows();
        expect(el.flowsEl.textContent).to.not.include('had no price on the day');
    });
});

describe('gas', () => {
    it('counts the transactions gas was paid on', async () => {
        const el = makePage({ ...base, transactionCosts: [{ symbol: 'NEAR', value: 0.4 }, { symbol: 'NEAR', value: 0.2 }] });
        await el.renderFlows();
        expect(el.flowsEl.textContent.replace(/\s+/g, ' ')).to.include('Gas on 2 transactions');
    });
});

// The year report's combined view shows the same two figures, computed by the
// same code. Putting the two pages side by side, the numbers matched and the
// words did not, which makes one look like a different measurement.
describe('the same figure is called the same thing', () => {
    it('uses the words the combined year report uses', async () => {
        const el = makePage(base);
        await el.renderFlows();
        const text = el.flowsEl.textContent;
        expect(text).to.include('Added in');
        expect(text).to.include('Taken out');
        expect(text).to.not.include('Deposits in');
        expect(text).to.not.include('Withdrawals out');
    });
});
