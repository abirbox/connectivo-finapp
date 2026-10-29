#!/usr/bin/env node
// Run this locally whenever you need to set or change a login password:
//   node scripts/hash-password.cjs "TheNewPassword"
// It prints a "iterations:saltHex:hashHex" string — paste that (the whole
// string) as the value of the matching AUTH_..._HASH variable in the
// Cloudflare Pages dashboard. Needs nothing but Node itself (no npm install)
// — the actual app verifies this same PBKDF2 format using the browser-
// standard Web Crypto API, which Node's crypto.pbkdf2Sync matches exactly.
'use strict';
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.cjs "YourPassword"');
  process.exit(1);
}

// 100,000 is Cloudflare Workers' actual maximum for PBKDF2 via crypto.subtle
// — going higher throws NotSupportedError at verify time. This isn't a
// judgment call, it's a hard platform limit.
const ITERATIONS = 100000;
const salt = crypto.randomBytes(16);
const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
console.log(`${ITERATIONS}:${salt.toString('hex')}:${derived.toString('hex')}`);
