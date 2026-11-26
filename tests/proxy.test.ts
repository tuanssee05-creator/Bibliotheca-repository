import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedHost, validateTargetUrl } from '../api/proxy.js';

test('validateTargetUrl accepts whitelisted open-library domains', () => {
  assert.equal(validateTargetUrl('https://www.gutenberg.org/ebooks/1342.epub').valid, true);
  assert.equal(validateTargetUrl('https://gutendex.com/books/').valid, true);
  assert.equal(validateTargetUrl('https://ia800100.us.archive.org/10/items/foo/foo.pdf').valid, true);
  assert.equal(validateTargetUrl('https://covers.openlibrary.org/b/id/123-M.jpg').valid, true);
});

test('validateTargetUrl blocks SSRF vectors, private IPs, and non-whitelisted domains', () => {
  assert.equal(validateTargetUrl('http://127.0.0.1:3000/secret').valid, false);
  assert.equal(validateTargetUrl('http://localhost/admin').valid, false);
  assert.equal(validateTargetUrl('http://169.254.169.254/latest/meta-data/').valid, false);
  assert.equal(validateTargetUrl('https://gutenberg.org.attacker.com/evil.epub').valid, false);
  assert.equal(validateTargetUrl('file:///etc/passwd').valid, false);
  assert.equal(validateTargetUrl('https://user:pass@www.gutenberg.org/ebooks/1.epub').valid, false);
  assert.equal(isBlockedHost('192.168.1.1'), true);
  assert.equal(isBlockedHost('[::1]'), true);
});
