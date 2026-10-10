import { getSetting, setSetting } from './db.js';

// Google Drive access for cross-device sync (see cloudSync.js), entirely in the browser:
// Google Identity Services issues a short-lived access token, and the Drive v3 REST API
// reads/writes one JSON file. Scope `drive.file` only lets the app see files it created
// itself — never the rest of your Drive.
//
// Needs a Google OAuth "Web application" client ID whose authorized JavaScript origins
// include the site's origin. It comes from the build (VITE_GOOGLE_CLIENT_ID, e.g. set in the
// GitHub Pages workflow) or, failing that, from Settings. See the README.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'CSA Assistant sync.json';
const TOKEN_KEY = 'csa-drive-token'; // localStorage: { token, exp }
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const BUILT_IN_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export async function getClientId() {
  return BUILT_IN_CLIENT_ID || (await getSetting('googleClientId', '')).trim();
}
export async function driveConfigured() {
  return !!(await getClientId());
}

// ---------- Access token ----------
// Kept in localStorage until it expires (about an hour) so a reload doesn't need another
// Google popup. It can only touch files this app created (drive.file).

function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null');
    return t && t.exp > Date.now() + 60_000 ? t.token : null;
  } catch {
    return null;
  }
}
function saveToken(token, expiresInSec) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + expiresInSec * 1000 }));
  } catch {
    // Storage blocked: the token still works for this page load via `memoryToken`.
  }
  memoryToken = token;
}
function forgetToken() {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to remove.
  }
}
let memoryToken = null;
export const hasValidToken = () => !!(readToken() ?? memoryToken);

let gisPromise = null;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Loads Google's sign-in script ahead of time, so tapping Connect/Sync can open the popup
 *  immediately (browsers block popups that open too long after the tap). */
export function preloadGoogleSignIn() {
  loadGis().catch(() => {});
}

/** Opens Google's sign-in/consent popup (must run from a tap) and stores the token. */
export async function signIn({ firstTime = false } = {}) {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Add a Google OAuth client ID in Settings first.');
  await loadGis();
  const token = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.error) reject(new Error(`Google sign-in failed: ${res.error_description || res.error}`));
        else {
          saveToken(res.access_token, Number(res.expires_in) || 3600);
          resolve(res.access_token);
        }
      },
      error_callback: (err) =>
        reject(new Error(err?.type === 'popup_closed' ? 'Google sign-in was closed before finishing.'
          : err?.type === 'popup_failed_to_open' ? 'The Google sign-in popup was blocked. Allow popups for this site.'
          : `Google sign-in failed: ${err?.message || err?.type || 'unknown error'}`)),
    });
    client.requestAccessToken({ prompt: firstTime ? 'consent' : '' });
  });
  await setSetting('driveConnected', true);
  return token;
}

/** Forgets the token and Drive file, and revokes the app's access with Google. The file
 *  itself stays in Drive. */
export async function disconnect() {
  const token = readToken() ?? memoryToken;
  forgetToken();
  await setSetting('driveConnected', false);
  await setSetting('driveFileId', '');
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
}

// ---------- Drive REST ----------

function signInError(message) {
  const e = new Error(message);
  e.needsSignIn = true;
  return e;
}

async function driveFetch(url, opts = {}) {
  const token = readToken() ?? memoryToken;
  if (!token) throw signInError('Sign in to Google Drive to sync.');
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    throw new Error("Couldn't reach Google Drive. Check your connection.");
  }
  if (res.status === 401) {
    forgetToken();
    throw signInError('Your Google Drive sign-in expired. Tap Sync to sign in again.');
  }
  if (!res.ok) throw new Error(`Google Drive request failed (${res.status}).`);
  return res;
}

/** The sync file's ID: remembered, or found by name (drive.file only lists our own files). */
async function findFileId() {
  const known = await getSetting('driveFileId', '');
  if (known) return known;
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const res = await driveFetch(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`);
  const id = (await res.json()).files?.[0]?.id ?? '';
  if (id) await setSetting('driveFileId', id);
  return id;
}

/** The parsed sync file, or null if there isn't one yet. */
export async function downloadSyncFile() {
  let id = await findFileId();
  if (!id) return null;
  try {
    const res = await driveFetch(`${API}/files/${id}?alt=media`);
    return await res.json();
  } catch (e) {
    // The remembered file was deleted or trashed in Drive: look it up again by name.
    if (/\((403|404)\)/.test(e.message)) {
      await setSetting('driveFileId', '');
      id = await findFileId();
      if (!id) return null;
      return (await driveFetch(`${API}/files/${id}?alt=media`)).json();
    }
    throw e;
  }
}

export async function uploadSyncFile(data) {
  const body = JSON.stringify(data);
  const id = await findFileId();
  if (id) {
    await driveFetch(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return;
  }
  const boundary = `csa${Date.now().toString(36)}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', description: 'CSA Assistant data, synced between your devices.' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  await setSetting('driveFileId', (await res.json()).id);
}
