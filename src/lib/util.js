import { STORES, db } from './db.js';

/** Shrinks a camera photo to a reasonable size before storing it on the device. */
export function compressImage(file, maxSide = 1400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

export async function exportBackup() {
  const data = { app: 'csa-assistant', version: 1, exportedAt: Date.now(), stores: {} };
  for (const s of STORES) {
    data.stores[s] = s === 'settings' ? await db.entries(s) : await db.all(s);
  }
  // Never put API keys in a file that might get shared.
  data.stores.settings = data.stores.settings.filter(([k]) => !['tbaKey', 'nexusKey'].includes(k));
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'csa-assistant') throw new Error('This file is not a CSA Assistant backup.');
  for (const s of STORES) {
    const rows = data.stores?.[s] ?? [];
    if (s === 'settings') {
      for (const [k, v] of rows) await db.put('settings', v, k);
    } else if (rows.length) {
      await db.putMany(s, rows);
    }
  }
}

/** Deletes a set of tickets and strips links to them from any ticket that survives, so
 *  links stay two-way. Returns how many were deleted. */
export async function deleteTickets(ids) {
  const gone = new Set(ids);
  if (!gone.size) return 0;
  const all = await db.all('tickets');
  const touched = all
    .filter((t) => !gone.has(t.id) && t.links?.some((l) => gone.has(l)))
    .map((t) => ({ ...t, links: t.links.filter((l) => !gone.has(l)) }));
  if (touched.length) await db.putMany('tickets', touched);
  for (const id of gone) await db.del('tickets', id);
  return gone.size;
}

export function toast(message) {
  window.dispatchEvent(new CustomEvent('csa-toast', { detail: message }));
}

/** Copies text to the clipboard, falling back to a hidden textarea where the async
 *  Clipboard API isn't available (older WebViews, or non-secure contexts). */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
