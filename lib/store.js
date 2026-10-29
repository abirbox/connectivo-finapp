// Thin wrapper around Cloudflare KV — the "database" for this app. One JSON
// value per collection (a map of {docId: docBody}), and files/attachments
// stored as base64 under a "file:" prefix in the same namespace. This keeps
// setup down to ONE KV namespace with ONE binding to configure.
'use strict';

const DATA_PREFIX = 'data:';
const FILE_PREFIX = 'file:';
const FILEMETA_PREFIX = 'filemeta:';

export async function readCollection(env, name) {
  const raw = await env.DB.get(DATA_PREFIX + name, { type: 'json' });
  return raw || {};
}
export async function writeCollection(env, name, obj) {
  await env.DB.put(DATA_PREFIX + name, JSON.stringify(obj));
}

export async function putFile(env, id, base64Data, meta) {
  await env.DB.put(FILE_PREFIX + id, base64Data);
  await env.DB.put(FILEMETA_PREFIX + id, JSON.stringify(meta));
}
export async function getFile(env, id) {
  const [data, metaRaw] = await Promise.all([
    env.DB.get(FILE_PREFIX + id),
    env.DB.get(FILEMETA_PREFIX + id, { type: 'json' }),
  ]);
  if (data == null) return null;
  return { base64: data, meta: metaRaw || {} };
}
