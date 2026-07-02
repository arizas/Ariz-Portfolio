import { buildSampleDates } from "./portfolio-data.js";

describe('portfolio value-over-time sampling (buildSampleDates)', () => {
    it('monthly: one point per month, first is the from date, last is today', () => {
        const dates = buildSampleDates('2026-01-01', '2026-07-02', 'month');
        expect(dates).to.deep.equal([
            '2026-01-01', '2026-02-01', '2026-03-01',
            '2026-04-01', '2026-05-01', '2026-06-01',
            '2026-07-01', '2026-07-02'
        ]);
    });

    it('monthly: a mid-month from date is kept as the first point', () => {
        const dates = buildSampleDates('2026-01-15', '2026-03-10', 'month');
        expect(dates[0]).to.equal('2026-01-15');
        expect(dates).to.include('2026-02-01');
        expect(dates).to.include('2026-03-01');
        expect(dates[dates.length - 1]).to.equal('2026-03-10');
    });

    it('weekly: steps 7 days and always ends on today', () => {
        const dates = buildSampleDates('2026-01-01', '2026-01-20', 'week');
        expect(dates).to.deep.equal([
            '2026-01-01', '2026-01-08', '2026-01-15', '2026-01-20'
        ]);
    });

    it('weekly: no duplicate final point when today lands on the step', () => {
        const dates = buildSampleDates('2026-01-01', '2026-01-15', 'week');
        expect(dates).to.deep.equal(['2026-01-01', '2026-01-08', '2026-01-15']);
    });

    it('daily: every calendar day inclusive', () => {
        const dates = buildSampleDates('2026-02-26', '2026-03-02', 'day');
        expect(dates).to.deep.equal([
            '2026-02-26', '2026-02-27', '2026-02-28',
            '2026-03-01', '2026-03-02'
        ]);
    });

    it('handles a from date equal to today (single point)', () => {
        const dates = buildSampleDates('2026-07-02', '2026-07-02', 'month');
        expect(dates).to.deep.equal(['2026-07-02']);
    });

    it('handles a from date after today gracefully (clamps to today)', () => {
        const dates = buildSampleDates('2026-08-01', '2026-07-02', 'month');
        expect(dates).to.deep.equal(['2026-07-02']);
    });
});
