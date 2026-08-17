import { describe, expect, it } from 'vitest';
import { isDangerous, isRestorable } from './urls';

describe('isRestorable', () => {
  it('allows normal web pages', () => {
    expect(isRestorable('https://example.com/a')).toBe(true);
    expect(isRestorable('http://example.com')).toBe(true);
    expect(isRestorable('file:///Users/x/doc.pdf')).toBe(true);
    expect(isRestorable('chrome://bookmarks')).toBe(true);
    expect(isRestorable('about:blank')).toBe(true);
  });
  it('rejects script and data schemes', () => {
    expect(isRestorable('javascript:alert(1)')).toBe(false);
    expect(isRestorable('data:text/html,<b>x</b>')).toBe(false);
    expect(isRestorable('vbscript:x')).toBe(false);
    expect(isRestorable('chrome-extension://abc/page.html')).toBe(false);
    expect(isRestorable('not a url')).toBe(false);
  });
});

describe('isDangerous', () => {
  it('flags executable schemes case-insensitively with whitespace', () => {
    expect(isDangerous('javascript:alert(1)')).toBe(true);
    expect(isDangerous('  JavaScript:alert(1)')).toBe(true);
    expect(isDangerous('DATA:text/html,x')).toBe(true);
    expect(isDangerous('https://example.com')).toBe(false);
  });
});
