import {
    getDisplaySymbol,
    isIntentsToken,
    isConfidentialToken,
    stripConfidentialPrefix,
    resolveDisplaySymbol,
    resolveDecimals,
    CONFIDENTIAL_TOKEN_PREFIX,
} from './intents-tokens.js';

describe('intents-tokens (bucket classification and display)', () => {
    before(() => {
        // Serve the token-metadata API from a fixture so resolution is hermetic.
        const realFetch = window.fetch;
        window.fetch = async (url, init) => {
            if (String(url) === 'https://1click.chaindefuser.com/v0/tokens') {
                return new Response(JSON.stringify([
                    { assetId: 'nep141:btc.omft.near', symbol: 'BTC', decimals: 8, blockchain: 'btc' },
                ]), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return realFetch(url, init);
        };
    });

    it('classifies token ids into the three buckets', () => {
        expect(isIntentsToken('usdc.near')).to.equal(false);
        expect(isIntentsToken('nep141:btc.omft.near')).to.equal(true);
        expect(isIntentsToken(`${CONFIDENTIAL_TOKEN_PREFIX}nep141:btc.omft.near`)).to.equal(true);
        expect(isConfidentialToken('nep141:btc.omft.near')).to.equal(false);
        expect(isConfidentialToken(`${CONFIDENTIAL_TOKEN_PREFIX}nep141:btc.omft.near`)).to.equal(true);
        expect(stripConfidentialPrefix(`${CONFIDENTIAL_TOKEN_PREFIX}nep141:btc.omft.near`))
            .to.equal('nep141:btc.omft.near');
        expect(stripConfidentialPrefix('nep141:btc.omft.near')).to.equal('nep141:btc.omft.near');
    });

    it('labels each custody form of the same asset distinctly', () => {
        expect(getDisplaySymbol('btc-native', 'BTC')).to.equal('BTC');
        expect(getDisplaySymbol('nep141:btc.omft.near', 'BTC', 'btc'))
            .to.equal('BTC ( NEAR Intents / Bitcoin )');
        expect(getDisplaySymbol('confidential:nep141:btc.omft.near', 'BTC', 'btc'))
            .to.equal('BTC ( Confidential / Bitcoin )');
        expect(getDisplaySymbol('confidential:nep141:btc.omft.near', 'BTC'))
            .to.equal('BTC ( Confidential )');
    });

    it('resolves metadata for confidential ids via the underlying intents asset', async () => {
        expect(await resolveDisplaySymbol('confidential:nep141:btc.omft.near', 'confidential:nep141:btc.omft.near'))
            .to.equal('BTC ( Confidential / Bitcoin )');
        expect(await resolveDecimals('confidential:nep141:btc.omft.near')).to.equal(8);
        // The public bucket keeps its label.
        expect(await resolveDisplaySymbol('nep141:btc.omft.near', 'nep141:btc.omft.near'))
            .to.equal('BTC ( NEAR Intents / Bitcoin )');
    });
});
