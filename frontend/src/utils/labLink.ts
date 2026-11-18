/**
 * Open a project from a link: the `/lab` route.
 *
 * A classroom site (or anyone) can hand Velxio a ready-made project — board,
 * code, circuit — as a normal .vlx snapshot (File → Export project (.vlx)) and
 * get a link that opens it in the editor:
 *
 *   /lab#project=<base64url of the .vlx JSON>   the project travels in the link
 *                                                (a URL fragment is never sent
 *                                                to any server)
 *   /lab?src=<https url of a .vlx file>         Velxio fetches it. The host
 *                                                must allow it with CORS.
 *
 * Nothing is saved by this route: it is the same as the user importing the file.
 */

import { applyVlxPayload, parseVlxText, VlxParseError, type VlxPayload } from './vlxFile';

/** A project bigger than this is refused (a .vlx with code and a circuit is a few KB). */
export const MAX_LAB_BYTES = 2 * 1024 * 1024;

export type LabSource = { kind: 'hash'; text: string } | { kind: 'src'; url: string };

/** UTF-8 text ⇄ base64url (no padding), the form used in `#project=`. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new VlxParseError('The project link is not valid.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new VlxParseError('The project link is not valid.');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** What the page's address asks for, or null when it names no project. The fragment wins over `?src=`. */
export function labSourceFromLocation(search: string, hash: string): LabSource | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('project');
  if (fromHash) {
    if (fromHash.length > Math.ceil((MAX_LAB_BYTES * 4) / 3)) throw new VlxParseError('The project is too large.');
    return { kind: 'hash', text: fromHash };
  }
  const src = new URLSearchParams(search).get('src');
  return src ? { kind: 'src', url: src } : null;
}

/**
 * Whether a project may be fetched from this address: https, or plain http only
 * for a local machine (development); never one with a user name or password in it.
 */
export function isAllowedLabSrc(raw: string, pageOrigin: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, pageOrigin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && (local || url.origin === pageOrigin))) return url;
  return null;
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_LAB_BYTES) throw new VlxParseError('The project is too large.');
  const text = await res.text();
  if (new TextEncoder().encode(text).length > MAX_LAB_BYTES) throw new VlxParseError('The project is too large.');
  return text;
}

/** Fetch / decode the project a link names and parse it (does not touch the stores). */
export async function readLabProject(
  source: LabSource,
  opts: { origin?: string; fetchImpl?: typeof fetch } = {},
): Promise<VlxPayload> {
  if (source.kind === 'hash') return parseVlxText(fromBase64Url(source.text));
  const url = isAllowedLabSrc(source.url, opts.origin ?? window.location.origin);
  if (!url) throw new VlxParseError('The project address must be an https link.');
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url.toString(), { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  } catch {
    throw new VlxParseError('The project could not be downloaded (the site may not allow it).');
  }
  if (!res.ok) throw new VlxParseError(`The project could not be downloaded (HTTP ${res.status}).`);
  return parseVlxText(await readCapped(res));
}

/** Read the project the current address names and load it into the editor; null when it names none. */
export async function loadLabFromLocation(loc: { search: string; hash: string }): Promise<VlxPayload | null> {
  const source = labSourceFromLocation(loc.search, loc.hash);
  if (!source) return null;
  const payload = await readLabProject(source);
  applyVlxPayload(payload);
  return payload;
}
