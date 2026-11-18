import { cncjsAddress, CncjsError, cncjsPorts, loadInCncjs } from './cncjs';

describe('cncjs', () => {
  it('reads an address as typed', () => {
    expect(cncjsAddress(' cncjs.lan:8001 ')).toBe('http://cncjs.lan:8001');
    expect(cncjsAddress('http://192.168.1.20:8000/')).toBe(
      'http://192.168.1.20:8000',
    );
    expect(cncjsAddress('https://cnc.example/cncjs/')).toBe(
      'https://cnc.example/cncjs',
    );
    expect(cncjsAddress('')).toBe('');
    expect(cncjsAddress('ftp://cncjs.lan')).toBe('');
    expect(cncjsAddress('not an address')).toBe('');
  });

  describe('talking to it', () => {
    let calls: { url: string; init: RequestInit }[];
    let respond: (url: string, init: RequestInit) => Response | Promise<never>;

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    beforeEach(() => {
      calls = [];
      spyOn(window, 'fetch').and.callFake(((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve().then(() => respond(url, init));
      }) as typeof fetch);
    });

    it('signs in, lists the open ports and loads a program', async () => {
      respond = (url) =>
        url.endsWith('/api/signin')
          ? json({ enabled: false, token: 'abc' })
          : url.endsWith('/api/controllers')
            ? json([{ port: '/dev/ttyUSB0', controller: { type: 'Grbl' } }])
            : json({ ok: true });
      const { token, ports } = await cncjsPorts('http://cncjs.lan:8001');
      expect(ports).toEqual([{ port: '/dev/ttyUSB0', controller: 'Grbl' }]);

      await loadInCncjs(
        'http://cncjs.lan:8001',
        token,
        ports[0].port,
        'a.nc',
        'G0 X1',
      );
      const load = calls[calls.length - 1];
      expect(load.url).toBe('http://cncjs.lan:8001/api/gcode');
      expect(
        (load.init.headers as Record<string, string>)['Authorization'],
      ).toBe('Bearer abc');
      expect(JSON.parse(load.init.body as string)).toEqual({
        port: '/dev/ttyUSB0',
        name: 'a.nc',
        gcode: 'G0 X1',
      });
    });

    it('says when cncjs wants a user, or refuses', async () => {
      respond = () => json({ msg: 'Authentication failed' }, 401);
      await expectAsync(cncjsPorts('http://a')).toBeRejectedWithError(
        CncjsError,
        /user name and password/,
      );
      respond = (url) =>
        url.endsWith('/api/signin')
          ? json({ token: 'abc' })
          : json({ msg: 'Controller is not ready' }, 400);
      await expectAsync(
        loadInCncjs('http://a', 'abc', 'p', 'a.nc', ''),
      ).toBeRejectedWithError(CncjsError, /Controller is not ready/);
    });
  });
});
