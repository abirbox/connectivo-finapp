// Account profiles: usernames, display names, avatars, and password hashes
// now live in KV (editable at runtime) instead of only in env var secrets
// (which can only be changed via `wrangler secret put`, never from inside
// the running app). Env var secrets remain the ONE-TIME seed for each
// account's very first password — after that, everything routes through
// here and KV becomes the live source of truth.
'use strict';
import { ACCOUNTS, hashPassword, verifyPasswordHash } from './auth.js';
import { readCollection, writeCollection } from './store.js';

const COLLECTION = 'accountProfiles';

/** Ensures every account in ACCOUNTS has a KV profile, seeding any missing
 * one from its env var secret. Safe to call on every request — a no-op
 * once all three exist. Returns the full {uid: profile} map. */
export async function ensureSeeded(env) {
  const profiles = await readCollection(env, COLLECTION);
  let changed = false;
  for (const acct of ACCOUNTS) {
    if (!profiles[acct.uid]) {
      const seedHash = env[acct.hashEnv] || acct.seedHash;
      if (!seedHash) continue; // nothing to seed from; login will simply fail for this account until an env var is set
      profiles[acct.uid] = {
        username: acct.username,
        name: acct.name,
        role: acct.role,
        hash: String(seedHash).trim(),
        avatarId: null,
      };
      changed = true;
    }
  }
  if (changed) await writeCollection(env, COLLECTION, profiles);
  return profiles;
}

export async function findProfileByUsername(env, username) {
  const u = String(username || '').trim().toLowerCase();
  const profiles = await ensureSeeded(env);
  const entry = Object.entries(profiles).find(([, p]) => p.username.toLowerCase() === u);
  return entry ? { uid: entry[0], ...entry[1] } : null;
}

export async function getProfile(env, uid) {
  const profiles = await ensureSeeded(env);
  return profiles[uid] ? { uid, ...profiles[uid] } : null;
}

/** Non-sensitive directory listing (no password hashes) — used by the
 * Users & Access screen so it reflects real, possibly-changed usernames
 * rather than the original hardcoded ones. */
export async function listProfilesSafe(env) {
  const profiles = await ensureSeeded(env);
  return Object.entries(profiles).map(([uid, p]) => ({ uid, username: p.username, name: p.name, role: p.role, avatarId: p.avatarId || null, perms: p.perms || null, createdAt: p.createdAt || null }));
}

// ---- Staff accounts: created by CEO / Super Admin / Developer, with their own page access ----
// Page keys a staff account can be granted (sensitive areas — Salary portal, Payroll Import,
// Users & Access, Settings, Developer Console — are never grantable).
export const GRANTABLE_PAGES = [
  '#/dashboard', '#/transactions', '#/income', '#/expense', '#/transfers',
  '#/accounts', '#/categories', '#/documents',
  '#/reports/summary', '#/reports/pl', '#/reports/journal', '#/reports/cashflow', '#/reports/balancesheet',
  '#/reports/cashbook', '#/reports/income', '#/reports/expense', '#/reports/historical', '#/audit',
];
function cleanPerms(pages, edit) {
  const set = new Set(Array.isArray(pages) ? pages.filter((x) => GRANTABLE_PAGES.includes(x)) : []);
  return { pages: GRANTABLE_PAGES.filter((x) => set.has(x)), edit: !!edit };
}
function checkUsername(u, profiles, selfUid) {
  u = String(u || '').trim().toLowerCase();
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (!/^[a-z0-9._-]+$/.test(u)) return 'Username can only contain letters, numbers, dots, underscores and hyphens.';
  if (Object.entries(profiles).some(([id, p]) => id !== selfUid && p.username.toLowerCase() === u)) return 'That username is already in use.';
  return null;
}
export async function createStaffUser(env, { username, name, password, pages, edit }) {
  const profiles = await ensureSeeded(env);
  const err = checkUsername(username, profiles, null);
  if (err) return { ok: false, error: err };
  const n = String(name || '').trim().slice(0, 100);
  if (!n) return { ok: false, error: 'Please enter the person\'s name.' };
  if (String(password || '').length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  const uid = 'user-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');
  profiles[uid] = {
    username: String(username).trim().toLowerCase(), name: n, role: 'staff',
    hash: await hashPassword(password), avatarId: null, perms: cleanPerms(pages, edit), createdAt: new Date().toISOString(),
  };
  await writeCollection(env, COLLECTION, profiles);
  return { ok: true, uid };
}
export async function updateStaffUser(env, uid, { name, username, newPassword, pages, edit }) {
  const profiles = await ensureSeeded(env);
  const p = profiles[uid];
  if (!p || p.role !== 'staff') return { ok: false, error: 'Only staff accounts can be changed here.' };
  if (typeof username === 'string' && username.trim().toLowerCase() !== p.username) {
    const err = checkUsername(username, profiles, uid); if (err) return { ok: false, error: err };
    p.username = username.trim().toLowerCase();
  }
  if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 100);
  if (newPassword) {
    if (String(newPassword).length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    p.hash = await hashPassword(newPassword);
  }
  if (pages !== undefined || edit !== undefined) p.perms = cleanPerms(pages !== undefined ? pages : (p.perms || {}).pages, edit !== undefined ? edit : (p.perms || {}).edit);
  profiles[uid] = p;
  await writeCollection(env, COLLECTION, profiles);
  return { ok: true };
}
export async function deleteStaffUser(env, uid) {
  const profiles = await ensureSeeded(env);
  if (!profiles[uid] || profiles[uid].role !== 'staff') return { ok: false, error: 'Only staff accounts can be removed here.' };
  delete profiles[uid];
  await writeCollection(env, COLLECTION, profiles);
  return { ok: true };
}

export async function checkCredentials(username, password, env) {
  const profile = await findProfileByUsername(env, username);
  if (!profile) {
    await verifyPasswordHash(password || '', `100000:${'00'.repeat(16)}:${'00'.repeat(32)}`); // timing hygiene
    return null;
  }
  const ok = await verifyPasswordHash(password, profile.hash);
  return ok ? profile : null;
}

/** Updates the caller's own profile — requires their current password.
 * Returns {ok:true, profile} or {ok:false, error}. */
export async function updateOwnProfile(env, uid, { currentPassword, newUsername, newName, newPassword, newAvatarId }) {
  const profiles = await ensureSeeded(env);
  const mine = profiles[uid];
  if (!mine) return { ok: false, error: 'Account not found.' };

  const passOk = await verifyPasswordHash(currentPassword, mine.hash);
  if (!passOk) return { ok: false, error: 'Current password is incorrect.' };

  const next = { ...mine };

  if (newUsername) {
    const u = String(newUsername).trim().toLowerCase();
    if (u.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (!/^[a-z0-9._-]+$/.test(u)) return { ok: false, error: 'Username can only contain letters, numbers, dots, underscores and hyphens.' };
    const taken = Object.entries(profiles).some(([otherUid, p]) => otherUid !== uid && p.username.toLowerCase() === u);
    if (taken) return { ok: false, error: 'That username is already in use.' };
    next.username = u;
  }
  if (newName) {
    const n = String(newName).trim();
    if (n.length < 1) return { ok: false, error: 'Name cannot be empty.' };
    next.name = n.slice(0, 100);
  }
  if (newPassword) {
    if (String(newPassword).length < 8) return { ok: false, error: 'New password must be at least 8 characters.' };
    next.hash = await hashPassword(newPassword);
  }
  if (typeof newAvatarId !== 'undefined') {
    next.avatarId = newAvatarId || null;
  }

  profiles[uid] = next;
  await writeCollection(env, COLLECTION, profiles);
  return { ok: true, profile: { uid, ...next } };
}
