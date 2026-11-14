// A model's answer, laid out from the little Markdown every model writes:
// paragraphs, headings, bullet and numbered lists, tables, **bold** and `code`.
// Built with createElement and textContent only, never innerHTML, so nothing
// in the answer can become markup. Links and images stay plain text: the page's
// policy allows images from any https host, and an image in the answer would
// send whatever its URL carried to that host.

const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Text with **bold** and `code` as elements, everything else as text nodes. */
function inline(doc, text) {
    const fragment = doc.createDocumentFragment();
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    for (let match; (match = pattern.exec(text));) {
        if (match.index > last) fragment.append(doc.createTextNode(text.slice(last, match.index)));
        const element = doc.createElement(match[1] !== undefined ? 'strong' : 'code');
        element.textContent = match[1] ?? match[2];
        fragment.append(element);
        last = pattern.lastIndex;
    }
    if (last < text.length) fragment.append(doc.createTextNode(text.slice(last)));
    return fragment;
}

const cells = (line) => line.match(TABLE_ROW)[1].split('|').map((cell) => cell.trim());

function table(doc, lines) {
    const element = doc.createElement('table');
    element.className = 'table table-sm w-auto';
    const hasHeader = lines.length > 1 && TABLE_RULE.test(lines[1]);
    const rows = lines.filter((line, index) => !(hasHeader && index === 1));
    rows.forEach((line, index) => {
        const header = hasHeader && index === 0;
        const section = header
            ? (element.tHead ?? element.createTHead())
            : (element.tBodies[0] ?? element.createTBody());
        const row = section.insertRow();
        for (const text of cells(line)) {
            const cell = doc.createElement(header ? 'th' : 'td');
            cell.append(inline(doc, text));
            row.append(cell);
        }
    });
    return element;
}

/**
 * The answer as a fragment of block elements. Lines that are none of the
 * recognised blocks are kept as paragraph text, line breaks included.
 */
export function renderAnswer(text, doc = document) {
    const fragment = doc.createDocumentFragment();
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }
        if (TABLE_ROW.test(line)) {
            const block = [];
            while (i < lines.length && (TABLE_ROW.test(lines[i]) || (block.length === 1 && TABLE_RULE.test(lines[i])))) block.push(lines[i++]);
            fragment.append(table(doc, block));
            continue;
        }
        const listKind = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
        if (listKind) {
            const list = doc.createElement(listKind === BULLET ? 'ul' : 'ol');
            while (i < lines.length && listKind.test(lines[i])) {
                const item = doc.createElement('li');
                item.append(inline(doc, lines[i++].match(listKind)[1]));
                list.append(item);
            }
            fragment.append(list);
            continue;
        }
        if (HEADING.test(line)) {
            const heading = doc.createElement('p');
            const strong = doc.createElement('strong');
            strong.append(inline(doc, line.match(HEADING)[1]));
            heading.append(strong);
            fragment.append(heading);
            i++;
            continue;
        }
        const paragraph = doc.createElement('p');
        const block = [];
        while (i < lines.length && lines[i].trim() !== '' && !TABLE_ROW.test(lines[i])
            && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !HEADING.test(lines[i])) block.push(lines[i++]);
        block.forEach((part, index) => {
            if (index > 0) paragraph.append(doc.createElement('br'));
            paragraph.append(inline(doc, part));
        });
        fragment.append(paragraph);
    }
    return fragment;
}
