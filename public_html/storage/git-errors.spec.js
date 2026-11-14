import { requireGitSuccess } from './gitstorage.js';

describe('requireGitSuccess', () => {
    it('passes a successful command through', () => {
        const ok = { code: 0, stdout: 'done\n', stderr: '' };
        expect(requireGitSuccess('git clone', ok)).to.equal(ok);
    });
    it('turns a failed clone into an error with what libgit2 said, not its progress lines', () => {
        const progress = Array.from({ length: 40 }, (_, i) => `net  ${i}% (117887 kb, 2899/2997)  /  idx  31%`).join('\n');
        const failed = {
            code: 1,
            stdout: `${progress}\n\nERROR 15: duplicate object ee0248ecf11b75d9267d55f5fbe3509064cbbd1a found in pack\n`,
            stderr: 'Bad news:\n duplicate object ee0248ecf11b75d9267d55f5fbe3509064cbbd1a found in pack\n',
        };
        expect(() => requireGitSuccess('git clone', failed)).to.throw(/git clone failed:\nBad news:\n duplicate object ee0248ec/);
    });
    it('falls back to stdout, then to the exit code', () => {
        expect(() => requireGitSuccess('git push', { code: 1, stdout: 'line 1\nrejected\n', stderr: '' })).to.throw(/git push failed:\nline 1\nrejected/);
        expect(() => requireGitSuccess('git push', { code: 128, stdout: '', stderr: '  ' })).to.throw('git push failed:\nexit code 128');
    });
    it('keeps only the end of a long message', () => {
        const stderr = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
        let message = '';
        try { requireGitSuccess('git clone', { code: 1, stdout: '', stderr }); } catch (e) { message = e.message; }
        expect(message).to.contain('line 29');
        expect(message).to.not.contain('line 23\n');
    });
});
