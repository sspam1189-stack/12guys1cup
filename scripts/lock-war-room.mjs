/**
 * Wraps the draft war room in a password gate for the public site.
 *
 * The site is static, so there is no server to check a password against. Instead
 * the whole app is AES-256-GCM encrypted here and decrypted in the browser with a
 * key derived from the password. The published file is ciphertext: without the
 * password there is nothing to read, even in view-source.
 *
 *   npm run lock:war-room                             prompts for the password
 *   WAR_ROOM_PASSWORD=… npm run lock:war-room         non-interactive
 *
 * Reads  tools/draft-war-room/draft-war-room.html  (git-ignored — keeping the
 *        plaintext in this public repo would defeat the whole exercise)
 * Writes public/war-room/index.html                (encrypted, safe to commit)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'tools/draft-war-room/draft-war-room.html');
const OUT_DIR = resolve(root, 'public/war-room');
const OUT = resolve(OUT_DIR, 'index.html');

// Must match the values the browser side derives with.
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const b64 = (buf) => Buffer.from(buf).toString('base64');

async function promptPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write('Password for the war room page: ');
  rl.output.write = () => {}; // keep the password off the screen
  const answer = await new Promise((res) => rl.question('', res));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  // Gzip first: the app is ~300 KB of mostly-repetitive bundle, and ciphertext
  // is incompressible over the wire, so this has to happen before encryption.
  const packed = gzipSync(Buffer.from(plaintext, 'utf8'), { level: 9 });
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed);

  return { salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext), packedBytes: packed.length };
}

function page({ salt, iv, ciphertext }) {
  const payload = JSON.stringify({ salt, iv, ct: ciphertext, iter: ITERATIONS });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>War Room</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0A100D; color: #E9F0EA;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  form {
    width: min(20rem, calc(100vw - 3rem));
    background: #101A15; border: 1px solid #22332A; border-radius: 10px;
    padding: 1.5rem; display: grid; gap: 0.85rem;
  }
  h1 {
    margin: 0; font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase;
    color: #7C9186; font-weight: 700;
  }
  input[type=password] {
    width: 100%; box-sizing: border-box; padding: 0.6rem 0.7rem;
    background: #16231C; border: 1px solid #22332A; border-radius: 6px;
    color: #E9F0EA; font-size: 1rem;
  }
  input[type=password]:focus { outline: 2px solid #F2B441; outline-offset: 1px; }
  button {
    padding: 0.6rem; border: 0; border-radius: 6px; background: #F2B441;
    color: #141007; font-weight: 700; font-size: 0.9rem; cursor: pointer;
  }
  button[disabled] { opacity: 0.6; cursor: progress; }
  label { display: flex; gap: 0.5rem; align-items: center; font-size: 0.75rem; color: #7C9186; }
  p.msg { margin: 0; font-size: 0.75rem; min-height: 1rem; color: #E2694F; }
</style>
</head>
<body>
<form id="gate" autocomplete="on">
  <h1>War Room</h1>
  <input id="pw" type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus />
  <label><input id="remember" type="checkbox" checked /> Keep me unlocked on this device</label>
  <button id="go" type="submit">Unlock</button>
  <p class="msg" id="msg" role="status"></p>
</form>
<script type="application/json" id="payload">${payload}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('payload').textContent);
  var STORE = 'war-room-key';
  var form = document.getElementById('gate');
  var pw = document.getElementById('pw');
  var go = document.getElementById('go');
  var msg = document.getElementById('msg');
  var remember = document.getElementById('remember');

  function bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function unlock(password) {
    var baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(DATA.salt), iterations: DATA.iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    // A wrong password fails the GCM tag check here and throws.
    var packed = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(DATA.iv) }, key, bytes(DATA.ct));
    var stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }

  function show(html) {
    document.open();
    document.write(html);
    document.close();
  }

  async function attempt(password, fromStorage) {
    go.disabled = true;
    msg.style.color = '#7C9186';
    msg.textContent = 'Unlocking…';
    try {
      var html = await unlock(password);
      if (remember.checked) { try { localStorage.setItem(STORE, password); } catch (e) {} }
      show(html);
    } catch (e) {
      if (fromStorage) { try { localStorage.removeItem(STORE); } catch (e2) {} }
      go.disabled = false;
      msg.style.color = '#E2694F';
      msg.textContent = fromStorage ? 'Saved password no longer works.' : 'Wrong password.';
      pw.value = '';
      pw.focus();
    }
  }

  if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') {
    msg.textContent = 'This browser is too old to unlock the page.';
    go.disabled = true;
    return;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (pw.value) attempt(pw.value, false);
  });

  var saved = null;
  try { saved = localStorage.getItem(STORE); } catch (e) {}
  if (saved) attempt(saved, true);
})();
</script>
</body>
</html>
`;
}

const password = process.env.WAR_ROOM_PASSWORD || (await promptPassword());
if (!password) {
  console.error('No password given — nothing written.');
  process.exit(1);
}

const plaintext = readFileSync(SOURCE, 'utf8');
const result = await encrypt(plaintext, password);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, page(result), 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Locked ${kb(Buffer.byteLength(plaintext))} → ${kb(result.packedBytes)} gzipped → ${kb(Buffer.byteLength(page(result)))} page`);
console.log(`Wrote public/war-room/index.html (PBKDF2-SHA256 ${ITERATIONS.toLocaleString()} iters, AES-256-GCM)`);
