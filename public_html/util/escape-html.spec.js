import { escapeHtml, escapeUrlComponent } from './escape-html.js';

// A token's symbol is whoever minted it writing whatever they like. This store
// holds ones carrying a whole URL and a sentence where a ticker should be, and
// they reach the screen whether or not the token has a price.
describe('text that came from somewhere else', () => {
    it('cannot open a tag', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>'))
            .to.equal('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('cannot close an attribute, single or double quoted', () => {
        expect(escapeHtml('" onmouseover="alert(1)')).to.not.include('"');
        expect(escapeHtml("' onmouseover='alert(1)")).to.not.include("'");
    });

    // Escaping the ampersand first, so an already-escaped entity is not
    // reassembled into a live one.
    it('escapes the ampersand before anything that produces one', () => {
        expect(escapeHtml('&lt;script&gt;')).to.equal('&amp;lt;script&amp;gt;');
    });

    it('leaves ordinary text alone', () => {
        expect(escapeHtml('wNEAR ( NEAR Intents / NEAR )')).to.equal('wNEAR ( NEAR Intents / NEAR )');
    });

    it('survives nothing at all', () => {
        expect(escapeHtml(undefined)).to.equal('');
        expect(escapeHtml(null)).to.equal('');
    });
});

// A hash goes into an href, where escaping is not enough: the danger is not how
// it reads but where it points.
describe('a value going into a URL', () => {
    it('cannot leave the path it was put in', () => {
        expect(escapeUrlComponent('../../evil?x=1')).to.not.include('/');
        expect(escapeUrlComponent('../../evil?x=1')).to.not.include('?');
    });

    it('cannot become a scheme of its own', () => {
        expect(escapeUrlComponent('javascript:alert(1)')).to.not.include(':');
    });

    it('leaves a real transaction hash usable', () => {
        const hash = 'G9YYdkxWbbJMy7FcSNjo3HRicVBgot2ici4mAXyhMYwu';
        expect(escapeUrlComponent(hash)).to.equal(hash);
    });
});
