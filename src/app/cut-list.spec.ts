import { cutListCsv } from './cut-list';

describe('cutListCsv', () => {
  it('writes a header and quotes where needed', () => {
    const csv = cutListCsv([
      {
        part: 'side, left',
        copy: 1,
        length: 720,
        width: 560.04,
        thickness: 18,
        sheet: 1,
        x: 10,
        y: 10,
        turned: false,
        note: '',
      },
    ]);
    const [header, row] = csv.trim().split('\n');
    expect(header.startsWith('Part,Copy,Length (mm)')).toBeTrue();
    expect(row).toBe('"side, left",1,720,560,18,1,10,10,no,');
  });
});
