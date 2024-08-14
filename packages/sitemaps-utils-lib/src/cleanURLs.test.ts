//cleanURLs.test.ts
/// <reference types="jest" />
import {
  escapeColonInPathInput,
  escapePercentInPathInput,
  escapeProhibitedPathChars,
  utf8EncodePath,
} from './cleanURLs';

describe('cleanURLs', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('escapePercentInPathInput', () => {
    it('should escape %', () => {
      const path = '/search/55%+off';
      const escapedPath = escapePercentInPathInput(path);
      expect(escapedPath).toBe('/search/55%25+off');
    });

    it('should escape %', () => {
      const path = '/search/55%+off+10%+annual';
      const escapedPath = escapePercentInPathInput(path);
      expect(escapedPath).toBe('/search/55%25+off+10%25+annual');
    });
  });

  describe('escapeColonInPathInput', () => {
    it('should escape colon', () => {
      const path = '/search/abstract:art';
      const expected = '/search/abstract%3aart';
      expect(escapeColonInPathInput(path)).toBe(expected);
    });

    it('should escape multiple colons', () => {
      const path = '/search/abstract:art:painting';
      const expected = '/search/abstract%3aart%3apainting';
      expect(escapeColonInPathInput(path)).toBe(expected);
    });
  });

  describe('escapeProhibitedPathChars', () => {
    it.each([
      [':', '%3a'],
      ['$', '%24'],
      ['[', '%5b'],
      [']', '%5d'],
    ])('escapes single %s to %s', (char, charEscaped) => {
      const url = new URL(`https://www.example.com/search/abstract${char}art`);
      const escapedUrl = escapeProhibitedPathChars(url);
      expect(escapedUrl.toString()).toBe(
        `https://www.example.com/search/abstract${charEscaped}art`,
      );
    });

    it.each([
      [':', '%3a'],
      ['$', '%24'],
      ['[', '%5b'],
      [']', '%5d'],
    ])('escapes multiple %s to %s', (char, charEscaped) => {
      const url = new URL(`https://www.example.com/search/abstract${char}art${char}painting`);
      const escapedUrl = escapeProhibitedPathChars(url);
      expect(escapedUrl.toString()).toBe(
        `https://www.example.com/search/abstract${charEscaped}art${charEscaped}painting`,
      );
    });
  });

  describe('utf8EncodePath', () => {
    it('should re-encode path', () => {
      const encodedUrl = utf8EncodePath('/cs/search/abstraktn%ed');
      expect(encodedUrl).toBe('/cs/search/abstraktn%c3%ad');
    });

    it('should not modify utf-8 encoded path', () => {
      const encodedUrl = utf8EncodePath('/search/%e5%8a%a8%e7%89%a9');
      expect(encodedUrl).toBe('/search/%e5%8a%a8%e7%89%a9');
    });
  });
});
