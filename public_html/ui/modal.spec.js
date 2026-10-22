import { modal, modalAlert, modalYesNo } from './modal.js';

// The buttons used inline onclick, which the Content-Security-Policy blocks
// like any injected handler. They resolve through listeners now.
function shown() {
    const el = [...document.querySelectorAll('common-modal')].at(-1);
    return el.shadowRoot;
}

describe('a dialog answers through its buttons', () => {
    it('dismisses an alert', async () => {
        const answer = modalAlert('Title', 'Text');
        shown().querySelector('button').click();
        expect(await answer).to.equal(true);
    });

    it('answers yes and no', async () => {
        const no = modalYesNo('Sure?', 'Really?');
        shown().querySelector('[data-result="false"]').click();
        expect(await no).to.equal(false);
        const yes = modalYesNo('Sure?', 'Really?');
        shown().querySelector('[data-result="true"]').click();
        expect(await yes).to.equal(true);
    });

    it('lets the caller read the dialog before it closes', async () => {
        const answer = modal(`<input type="checkbox" id="remember" checked>
            <button data-result="continue">Continue</button>`, {
            continue: (root) => ({ proceed: true, remember: root.getElementById('remember').checked }),
        });
        shown().querySelector('[data-result="continue"]').click();
        expect(await answer).to.deep.equal({ proceed: true, remember: true });
    });

    it('has no inline handler left', async () => {
        const answer = modalYesNo('Sure?', 'Really?');
        expect(shown().innerHTML).to.not.match(/\son[a-z]+=/);
        shown().querySelector('[data-result="true"]').click();
        await answer;
    });
});
