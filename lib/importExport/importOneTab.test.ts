import { describe, expect, it } from 'vitest';
import { parseOneTabExport } from './importOneTab';

describe('parseOneTabExport', () => {
  it('parses url | title lines into groups split on blank lines', () => {
    const text = [
      'https://a.com/x | Page A',
      'https://b.com/y | Page B',
      '',
      'https://c.com/z | Page C',
    ].join('\n');
    const { groups } = parseOneTabExport(text);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.tabs.map((t) => t.title)).toEqual(['Page A', 'Page B']);
    expect(groups[1]!.tabs[0]!.url).toBe('https://c.com/z');
  });

  it('handles CRLF and multiple blank lines', () => {
    const text = 'https://a.com | A\r\n\r\n\r\nhttps://b.com | B\r\n';
    const { groups } = parseOneTabExport(text);
    expect(groups).toHaveLength(2);
  });

  it('treats bare URLs as title-less entries', () => {
    const { groups } = parseOneTabExport('https://a.com/path');
    expect(groups[0]!.tabs[0]!.title).toBe('https://a.com/path');
  });

  it('keeps titles containing pipes intact', () => {
    const { groups } = parseOneTabExport('https://a.com | Title | with pipe');
    expect(groups[0]!.tabs[0]!.title).toBe('Title | with pipe');
  });

  it('skips dangerous and non-URL lines', () => {
    const { groups, skippedLines } = parseOneTabExport(
      ['javascript:alert(1) | evil', 'not a url at all', 'https://ok.com | fine'].join('\n'),
    );
    expect(groups[0]!.tabs).toHaveLength(1);
    expect(skippedLines).toHaveLength(2);
  });

  it('returns nothing for empty input', () => {
    expect(parseOneTabExport('  \n \n').groups).toHaveLength(0);
  });
});
