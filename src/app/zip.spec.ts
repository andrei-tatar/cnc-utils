import { crc32, createZip } from './zip';

describe('createZip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes each file stored, with a central directory', async () => {
    const zip = createZip([
      { name: 'a.nc', data: 'G0 X0\n' },
      { name: 'b.nc', data: 'G1 X1\n' },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // End of central directory: two entries.
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('G0 X0');
    expect(text).toContain('b.nc');
  });
});
