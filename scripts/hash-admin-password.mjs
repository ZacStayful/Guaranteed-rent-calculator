#!/usr/bin/env node
// Generate an ADMIN_PASSWORD_HASHES entry.
//
//   node scripts/hash-admin-password.mjs zac@stayful.co.uk
//
// Prompts for the password (never taken as an argument, so it can't end up in
// shell history), prints the "email:hash:salt" entry to paste into the env var,
// and never stores the password anywhere.

import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { stdin, stdout, argv, exit } from 'node:process';

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (hidden) {
      // Suppress echo while typing the password.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(char.toString())) {
          stdin.removeListener('data', onData);
        } else {
          stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
        }
      };
      stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) stdout.write('\n');
      resolve(answer);
    });
  });
}

const email = (argv[2] ?? '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/hash-admin-password.mjs <email>');
  exit(1);
}
if (!email.endsWith('@stayful.co.uk')) {
  console.error('Admin emails must be on @stayful.co.uk — the allowlist rejects anything else.');
  exit(1);
}

const password = await prompt('Password: ', { hidden: true });
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  exit(1);
}
const confirm = await prompt('Confirm:  ', { hidden: true });
if (password !== confirm) {
  console.error('Passwords did not match.');
  exit(1);
}

const salt = randomBytes(16);
const hash = await scrypt(password, salt, KEY_LENGTH);

console.log('\nAdd this to ADMIN_PASSWORD_HASHES (comma-separate multiple entries):\n');
console.log(`${email}:${hash.toString('hex')}:${salt.toString('hex')}\n`);
console.log('And make sure the address is also listed in ADMIN_EMAILS.');
