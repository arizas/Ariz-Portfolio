import { browserLocale, __resetBrowserLocale } from "./locale.js";

describe('browserLocale', () => {
    let original;
    const pretend = tag => Object.defineProperty(navigator, 'language', { value: tag, configurable: true });

    beforeEach(() => { original = navigator.language; __resetBrowserLocale(); });
    afterEach(() => { pretend(original); __resetBrowserLocale(); });

    it('passes a well-formed tag straight through', () => {
        pretend('nb-NO');
        expect(browserLocale()).to.equal('nb-NO');
    });

    // A Chromium started without a locale — which is what a container does —
    // reports this, and Intl rejects it. Every formatter built from it threw,
    // and the panel using it failed to render at all.
    it('falls back for a tag Intl cannot parse', () => {
        pretend('en-US@posix');
        expect(browserLocale()).to.equal(undefined);
        expect(() => new Intl.NumberFormat(browserLocale())).to.not.throw();
    });

    it('falls back when there is no language at all', () => {
        pretend('');
        expect(browserLocale()).to.equal(undefined);
    });

    it('answers the same way twice', () => {
        pretend('en-GB');
        expect(browserLocale()).to.equal('en-GB');
        expect(browserLocale()).to.equal('en-GB');
    });
});
