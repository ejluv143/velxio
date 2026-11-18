// @vitest-environment jsdom
/**
 * /lab opens a project from a link: `#project=<base64url .vlx>` or `?src=<https url>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../store/useEditorStore';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { buildVlxPayload } from '../utils/vlxFile';
import {
  MAX_LAB_BYTES,
  fromBase64Url,
  isAllowedLabSrc,
  labSourceFromLocation,
  loadLabFromLocation,
  readLabProject,
  toBase64Url,
} from '../utils/labLink';

const SKETCH = '// Blink 💡\nvoid setup(){pinMode(13,OUTPUT);}\nvoid loop(){}\n';

function seedStores() {
  useSimulatorStore.setState({
    components: [],
    wires: [],
    boards: [
      {
        id: 'arduino-uno',
        boardKind: 'arduino-uno',
        x: 0,
        y: 0,
        activeFileGroupId: 'group-arduino-uno',
        languageMode: 'arduino',
      } as never,
    ],
    activeBoardId: 'arduino-uno',
  } as never);
  // createFileGroup is a no-op for a group that exists, so replace the groups outright.
  useEditorStore.getState().replaceFileGroups({ 'group-arduino-uno': [{ name: 'sketch.ino', content: SKETCH }] });
}

beforeEach(seedStores);

describe('base64url', () => {
  it('round-trips text, including non-ASCII, with no padding or +/ characters', () => {
    const text = JSON.stringify({ a: 'héllo 💡 ' + 'x'.repeat(100000) });
    const enc = toBase64Url(text);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(enc)).toBe(text);
  });

  it('refuses a value that is not base64url', () => {
    expect(() => fromBase64Url('not valid!')).toThrow(/not valid/);
    expect(() => fromBase64Url('/+==')).toThrow(/not valid/);
  });
});

describe('labSourceFromLocation', () => {
  it('reads the fragment, then ?src=, and returns null for neither', () => {
    expect(labSourceFromLocation('', '#project=abc')).toEqual({ kind: 'hash', text: 'abc' });
    expect(labSourceFromLocation('?src=https%3A%2F%2Fa.example%2Fp.vlx', '')).toEqual({
      kind: 'src',
      url: 'https://a.example/p.vlx',
    });
    // The fragment wins when both are present.
    expect(labSourceFromLocation('?src=https%3A%2F%2Fa.example%2Fp.vlx', '#project=abc')?.kind).toBe('hash');
    expect(labSourceFromLocation('', '')).toBeNull();
    expect(labSourceFromLocation('?other=1', '#x=1')).toBeNull();
  });

  it('refuses an oversized fragment', () => {
    expect(() => labSourceFromLocation('', '#project=' + 'a'.repeat(MAX_LAB_BYTES * 2))).toThrow(/too large/);
  });
});

describe('isAllowedLabSrc', () => {
  const page = 'https://velxio.example';
  it('allows https, same-origin http and local http only', () => {
    expect(isAllowedLabSrc('https://classes.example/lab/1.vlx', page)).not.toBeNull();
    expect(isAllowedLabSrc('http://localhost:3000/lab/1.vlx', page)).not.toBeNull();
    expect(isAllowedLabSrc('http://127.0.0.1:3000/p.vlx', page)).not.toBeNull();
    expect(isAllowedLabSrc('/p.vlx', page)).not.toBeNull();
    expect(isAllowedLabSrc('http://classes.example/p.vlx', page)).toBeNull();
    expect(isAllowedLabSrc('javascript:alert(1)', page)).toBeNull();
    expect(isAllowedLabSrc('data:application/json,{}', page)).toBeNull();
    expect(isAllowedLabSrc('file:///etc/passwd', page)).toBeNull();
    expect(isAllowedLabSrc('https://user:pw@classes.example/p.vlx', page)).toBeNull();
  });
});

describe('readLabProject / loadLabFromLocation', () => {
  it('loads a project that travels in the link into the stores', async () => {
    const payload = buildVlxPayload({ name: 'Blink' });
    const hash = '#project=' + toBase64Url(JSON.stringify(payload));

    // A different board and file are loaded first, so the load must replace them.
    useSimulatorStore.setState({ boards: [], components: [], wires: [], activeBoardId: null } as never);
    useEditorStore.getState().replaceFileGroups({ 'group-arduino-uno': [{ name: 'old.ino', content: 'old' }] });

    const loaded = await loadLabFromLocation({ search: '', hash });
    expect(loaded?.name).toBe('Blink');
    expect(useSimulatorStore.getState().boards.map((b) => b.boardKind)).toEqual(['arduino-uno']);
    expect(useEditorStore.getState().fileGroups['group-arduino-uno']?.[0]?.content).toBe(SKETCH);
  });

  it('fetches ?src= with no credentials, and refuses what is not a project', async () => {
    const payload = buildVlxPayload({ name: 'Remote' });
    const ok = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const got = await readLabProject({ kind: 'src', url: 'https://classes.example/lab.vlx' }, { origin: 'https://velxio.example', fetchImpl: ok as never });
    expect(got.name).toBe('Remote');
    expect(ok).toHaveBeenCalledWith('https://classes.example/lab.vlx', expect.objectContaining({ credentials: 'omit' }));

    const opts = (r: Response) => ({ origin: 'https://velxio.example', fetchImpl: (async () => r) as never });
    await expect(readLabProject({ kind: 'src', url: 'https://classes.example/x' }, opts(new Response('nope', { status: 404 })))).rejects.toThrow(/HTTP 404/);
    await expect(readLabProject({ kind: 'src', url: 'https://classes.example/x' }, opts(new Response('{"hello":1}')))).rejects.toThrow(/Not a Velxio project/);
    await expect(readLabProject({ kind: 'src', url: 'https://classes.example/x' }, opts(new Response('not json')))).rejects.toThrow(/Invalid JSON/);
    await expect(readLabProject({ kind: 'src', url: 'http://classes.example/x' }, opts(new Response('{}')))).rejects.toThrow(/https/);
    const huge = new Response('x', { headers: { 'content-length': String(MAX_LAB_BYTES + 1) } });
    await expect(readLabProject({ kind: 'src', url: 'https://classes.example/x' }, opts(huge))).rejects.toThrow(/too large/);
    const failing = { origin: 'https://velxio.example', fetchImpl: (async () => { throw new TypeError('blocked'); }) as never };
    await expect(readLabProject({ kind: 'src', url: 'https://classes.example/x' }, failing)).rejects.toThrow(/could not be downloaded/);
  });

  it('returns null when the address names no project, and a bad fragment is an error, not a crash', async () => {
    expect(await loadLabFromLocation({ search: '', hash: '' })).toBeNull();
    await expect(loadLabFromLocation({ search: '', hash: '#project=!!!' })).rejects.toThrow(/not valid/);
    await expect(loadLabFromLocation({ search: '', hash: '#project=' + toBase64Url('{"format":"other"}') })).rejects.toThrow(/Not a Velxio project/);
  });
});
