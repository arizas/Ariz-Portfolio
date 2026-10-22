import { withContentSecurityPolicy, contentSecurityPolicy, CSP_NONCE_PLACEHOLDER } from './csp.js';

const page = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script async src="https://ga.jspm.io/npm:es-module-shims@1.10.0/dist/es-module-shims.js"></script>
<script type="importmap">{}</script></head><body><script type="module" src="./app.js"></script></body></html>`;

describe('the Content-Security-Policy in the bundle', () => {
    it('comes before every script, right after the charset', () => {
        const html = withContentSecurityPolicy(page);
        const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');
        expect(policyAt).to.be.greaterThan(html.indexOf('<meta charset'));
        expect(policyAt).to.be.lessThan(html.indexOf('<script'));
    });

    it('puts the nonce placeholder on every script tag', () => {
        const tags = withContentSecurityPolicy(page).match(/<script\b[^>]*>/g);
        expect(tags).to.have.length(3);
        for (const tag of tags) expect(tag).to.include(`nonce="${CSP_NONCE_PLACEHOLDER}"`);
    });

    // Served without the per-request nonce step, the page must run nothing —
    // not run with a nonce anyone can read off the published bundle.
    it('uses a placeholder that is not a valid nonce', () => {
        expect(/^[A-Za-z0-9+/_=-]+$/.test(CSP_NONCE_PLACEHOLDER)).to.equal(false);
    });

    // What a token name could carry: an inline handler, a javascript: URL, a
    // <script> or srcdoc. None of them has the nonce.
    it('allows script only by nonce, never inline or by eval', () => {
        const scriptSrc = contentSecurityPolicy.split('; ').find(d => d.startsWith('script-src '));
        expect(scriptSrc).to.include(`'nonce-${CSP_NONCE_PLACEHOLDER}'`);
        expect(scriptSrc).to.include(`'strict-dynamic'`);
        expect(scriptSrc).to.not.include(`'unsafe-inline'`);
        expect(scriptSrc).to.not.include(`'unsafe-eval'`);
        expect(contentSecurityPolicy).to.include(`object-src 'none'`);
        expect(contentSecurityPolicy).to.include(`base-uri 'none'`);
    });

    it('will not build a page with nowhere to put it', () => {
        expect(() => withContentSecurityPolicy('<html><head></head></html>')).to.throw('meta charset');
    });
});
