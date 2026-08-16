import './portfolio-page.component.js';

// The element wires up all its shadow-DOM references in the constructor, so the
// render methods can be exercised on a detached instance without triggering the
// FIFO pass or any network access.
function makePage() {
    return document.createElement('portfolio-page');
}
const money = v => `kr ${Math.round(v)}`;

// A NEAR-dominated account: four NEAR-flavoured tokens plus staking, and one
// small BTC position. The token table shows five rows; the exposure is two.
const portfolio = {
    holdings: [
        { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 380, value: 628, costBasis: 500 },
        { token: 'meta-pool.near', symbol: 'STNEAR', displaySymbol: 'stNEAR', amount: 254, value: 623, costBasis: 400, excluded: true },
        { token: 'wrap.near', symbol: 'WNEAR', displaySymbol: 'wNEAR', amount: 61, value: 101, costBasis: 90 },
        { token: 'confidential:nep141:nbtc.bridge.near', symbol: 'BTC', displaySymbol: 'BTC ( Confidential )', amount: 0.00696, value: 439, costBasis: 452 },
    ],
    stakedAmount: 8728,
    stakedValue: 14364,
    stakedCostBasis: 9000,
    totalValue: 1168,
};

describe('portfolio concentration panel', () => {
    it('shows the grouped exposure, not the largest token row', () => {
        const el = makePage();
        el.renderConcentration(portfolio, money);
        const text = el.concentrationEl.textContent;
        expect(el.concentrationSection.hidden).to.equal(false);
        // 97.3 % grouped, versus 88.9 % for the largest single row.
        expect(text).to.include('NEAR 97.3%');
        expect(text).to.not.include('88.9%');
    });

    it('lists the tokens that make up each exposure', () => {
        const el = makePage();
        el.renderConcentration(portfolio, money);
        const members = el.concentrationEl.querySelector('.conc-members').textContent;
        expect(members).to.include('NEAR (staked)');
        expect(members).to.include('stNEAR');
        expect(members).to.include('wNEAR');
    });

    it('renders one row per economic asset with a bar sized to the weight', () => {
        const el = makePage();
        el.renderConcentration(portfolio, money);
        const rows = el.concentrationEl.querySelectorAll('.conc-row');
        expect(rows.length).to.equal(2);
        const widths = [...el.concentrationEl.querySelectorAll('.conc-fill')].map(f => f.style.width);
        expect(widths[0]).to.equal('97.3%');
        expect(widths[1]).to.equal('2.7%');
    });

    it('reports the effective number of positions', () => {
        const el = makePage();
        el.renderConcentration(portfolio, money);
        // Herfindahl 0.973^2 + 0.027^2 = 0.948 -> about 1.1 positions.
        expect(el.concentrationEl.textContent).to.include('1.1 equally weighted positions');
    });

    it('says "position" singular only when there is exactly one', () => {
        const el = makePage();
        el.renderConcentration({
            holdings: [{ token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 1, value: 100, costBasis: 90 }],
        }, money);
        expect(el.concentrationEl.textContent).to.include('1.0 equally weighted position ');
    });

    it('does not put a single-token exposure through the member list', () => {
        const el = makePage();
        el.renderConcentration({
            holdings: [{ token: 'zec.omft.near', symbol: 'ZEC', displaySymbol: 'ZEC ( NEAR Intents )', amount: 1, value: 100, costBasis: 90 }],
        }, money);
        expect(el.concentrationEl.querySelector('.conc-members')).to.equal(null);
        expect(el.concentrationEl.textContent).to.include('ZEC 100.0%');
    });

    it('names the holdings it could not price instead of dropping them silently', () => {
        const el = makePage();
        el.renderConcentration({
            holdings: [
                { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 100, value: 165, costBasis: 100 },
                { token: 'x.near', symbol: 'SHITZU', displaySymbol: 'SHITZU', amount: 42, value: null, costBasis: 0 },
            ],
        }, money);
        expect(el.concentrationEl.textContent).to.include('SHITZU');
        expect(el.concentrationEl.textContent).to.include('No current price');
    });

    it('explains why its total differs from the hero total', () => {
        const el = makePage();
        el.renderConcentration(portfolio, money);
        const text = el.concentrationEl.textContent;
        expect(text).to.include('higher than');
        expect(text).to.include('stNEAR');
    });

    it('says nothing about the hero total when no holding is excluded from it', () => {
        const el = makePage();
        el.renderConcentration({
            holdings: [{ token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 1, value: 100, costBasis: 90 }],
        }, money);
        expect(el.concentrationEl.textContent).to.not.include('higher than');
    });

    it('hides the section when there is nothing priced to group', () => {
        const el = makePage();
        el.renderConcentration({ holdings: [] }, money);
        expect(el.concentrationSection.hidden).to.equal(true);
    });

    it('escapes token names rather than injecting them as markup', () => {
        const el = makePage();
        el.renderConcentration({
            holdings: [
                { token: 'a.near', symbol: 'AAA', displaySymbol: 'AAA', amount: 1, value: 100, costBasis: 1 },
                { token: 'b.near', symbol: 'AAA', displaySymbol: '<img src=x onerror=alert(1)>', amount: 1, value: 100, costBasis: 1 },
            ],
        }, money);
        expect(el.concentrationEl.querySelector('img')).to.equal(null);
        expect(el.concentrationEl.textContent).to.include('<img src=x onerror=alert(1)>');
    });
});

describe('portfolio risk panel', () => {
    // A price map with a known per-observation volatility, one point per day.
    function priceMap(n, sigma, seed) {
        let a = seed >>> 0;
        const u = () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const normal = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
        const out = {};
        let price = 100;
        for (let i = 0; i < n; i++) {
            price *= Math.exp(sigma * normal());
            out[new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)] = price;
        }
        return out;
    }

    it('renders volatility, the dominant risk share and the reduction curve', async () => {
        const el = makePage();
        // Stub the price lookup the panel uses.
        const byToken = {
            '': priceMap(400, 0.05, 3),                                     // NEAR
            'confidential:nep141:nbtc.bridge.near': priceMap(400, 0.02, 4), // BTC
        };
        el.__getEODPriceMap = async (_cur, token) => byToken[token] ?? byToken[''];
        await el.renderRisk({ ...portfolio, currency: 'nok' });
        const text = el.riskEl.textContent;
        expect(el.riskEl.hidden).to.equal(false);
        expect(text).to.include('Portfolio volatility');
        expect(text).to.include('per year');
        expect(text).to.include('NEAR');
        expect(text).to.include('of that risk on');
        expect(el.riskEl.querySelectorAll('.risk-curve span').length).to.be.greaterThan(3);
    });

    it('stays hidden when there is not enough price history', async () => {
        const el = makePage();
        el.__getEODPriceMap = async () => ({ '2025-01-01': 1, '2025-01-02': 1.01 });
        await el.renderRisk({ ...portfolio, currency: 'nok' });
        expect(el.riskEl.hidden).to.equal(true);
    });

    it('stays hidden rather than throwing when the price service fails', async () => {
        const el = makePage();
        el.__getEODPriceMap = async () => { throw new Error('offline'); };
        await el.renderRisk({ ...portfolio, currency: 'nok' });
        expect(el.riskEl.hidden).to.equal(true);
    });
});

describe('risk share rounding', () => {
    it('never claims 100 % of the risk while other positions still contribute', async () => {
        const el = makePage();
        function flat(n, sigma, seed) {
            let a = seed >>> 0;
            const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
            const normal = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
            const out = {}; let price = 100;
            for (let i = 0; i < n; i++) { price *= Math.exp(sigma * normal());
                out[new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)] = price; }
            return out;
        }
        // A 99.99 %-dominant position: the share must render as 99.9, not 100.0.
        el.__getEODPriceMap = async (_c, token) => token === '' ? flat(400, 0.06, 9) : flat(400, 0.001, 8);
        await el.renderRisk({
            currency: 'nok',
            holdings: [
                { token: '', symbol: 'NEAR', displaySymbol: 'NEAR', amount: 1, value: 99990, costBasis: 1 },
                { token: 'zec.omft.near', symbol: 'ZEC', displaySymbol: 'ZEC', amount: 1, value: 10, costBasis: 1 },
            ],
        });
        expect(el.riskEl.textContent).to.not.include('100.0');
        expect(el.riskEl.textContent).to.include('99.9');
    });
});
