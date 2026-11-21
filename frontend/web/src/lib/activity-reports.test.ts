import { expect, it } from 'vitest';
import { pollReport, questionReport } from './activity-reports';

it('exports aggregate counts, including zero-vote options', () => {
    expect(pollReport([{ question: 'Budget?', closed: true, options: ['Yes', 'No'], counts: [3, 0] }]))
        .toContain('"Budget?","Closed","Yes","3"\r\n"Budget?","Closed","No","0"');
});

it('keeps voter IDs private and safely quotes spreadsheet formulas, quotes and line breaks', () => {
    const report = questionReport([{ text: '=SUM(1,2)', authorName: 'A "B"', voters: ['private-id'], answer: 'line1\nline2' }]);
    expect(report).toContain(`"'=SUM(1,2)","A ""B""","1","line1\nline2"`);
    expect(report).not.toContain('private-id');
});
