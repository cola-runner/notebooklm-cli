import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertUploadFileSupported,
  buildRegisterFileParams,
  buildUploadStartBody,
  extractFileSourceId,
  guessUploadContentType,
  validateResumableUploadUrl,
} from '../../src/api/sourceUpload.js';

describe('buildRegisterFileParams', () => {
  it('matches the upstream ADD_SOURCE_FILE param shape', () => {
    // Golden shape from notebooklm-py upload_payloads.build_register_file_source_params.
    expect(buildRegisterFileParams('report.pdf', 'NB_001')).toEqual([
      [['report.pdf']],
      'NB_001',
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]);
  });
});

describe('buildUploadStartBody', () => {
  it('emits the PROJECT_ID / SOURCE_NAME / SOURCE_ID JSON body', () => {
    expect(JSON.parse(buildUploadStartBody('NB_001', 'report.pdf', 'SRC_9'))).toEqual({
      PROJECT_ID: 'NB_001',
      SOURCE_NAME: 'report.pdf',
      SOURCE_ID: 'SRC_9',
    });
  });
});

describe('guessUploadContentType', () => {
  it('maps known extensions to MIME types (case-insensitive)', () => {
    expect(guessUploadContentType('a.pdf')).toBe('application/pdf');
    expect(guessUploadContentType('A.PNG')).toBe('image/png');
    expect(guessUploadContentType('notes.md')).toBe('text/markdown');
    expect(guessUploadContentType('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(guessUploadContentType('mystery.xyz')).toBe('application/octet-stream');
  });

  it('honors an explicit override and rejects a blank one', () => {
    expect(guessUploadContentType('a.pdf', 'application/x-custom')).toBe('application/x-custom');
    expect(() => guessUploadContentType('a.pdf', '   ')).toThrow(/cannot be empty/);
  });
});

describe('assertUploadFileSupported', () => {
  it('rejects HTML by extension and by content type', () => {
    expect(() => assertUploadFileSupported('page.html', 'text/plain')).toThrow(/HTML file uploads/);
    expect(() => assertUploadFileSupported('page', 'text/html')).toThrow(/HTML file uploads/);
  });

  it('accepts non-HTML files', () => {
    expect(() => assertUploadFileSupported('report.pdf', 'application/pdf')).not.toThrow();
  });
});

describe('validateResumableUploadUrl', () => {
  const ok = 'https://notebook.google.com/upload/_/?upload_id=ABC123';

  it('accepts a same-host upload URL with exactly one upload_id', () => {
    expect(validateResumableUploadUrl(ok)).toBe(ok);
  });

  it('rejects untrusted hosts, non-https, and missing/duplicate upload_id', () => {
    expect(() => validateResumableUploadUrl('https://evil.example/upload/_/?upload_id=x')).toThrow(
      /host is not trusted/,
    );
    expect(() =>
      validateResumableUploadUrl('http://notebook.google.com/upload/_/?upload_id=x'),
    ).toThrow(/must use https/);
    expect(() => validateResumableUploadUrl('https://notebook.google.com/upload/_/')).toThrow(
      /exactly one non-empty upload_id/,
    );
    expect(() =>
      validateResumableUploadUrl('https://notebook.google.com/upload/_/?upload_id=a&upload_id=b'),
    ).toThrow(/exactly one non-empty upload_id/);
  });

  it('rejects a path outside the upload endpoint', () => {
    expect(() =>
      validateResumableUploadUrl('https://notebook.google.com/steal/?upload_id=x'),
    ).toThrow(/path is not trusted/);
  });
});

describe('extractFileSourceId', () => {
  it('pulls the id from the [[id]] singleton envelope (golden response)', () => {
    // Decoded ADD_SOURCE_FILE response per rpc_golden/ADD_SOURCE_FILE.json.
    expect(extractFileSourceId([['7b3e9c10-1f2a-4d5e-8a9b-0c1d2e3f4a5b']], 'report.pdf')).toBe(
      '7b3e9c10-1f2a-4d5e-8a9b-0c1d2e3f4a5b',
    );
  });

  it('accepts an id-ish (non-UUID) token and ignores the filename', () => {
    expect(extractFileSourceId([['report.pdf'], ['src_000123']], 'report.pdf')).toBe('src_000123');
  });

  it('returns undefined when absent or ambiguous', () => {
    expect(extractFileSourceId([[]], 'report.pdf')).toBeUndefined();
    expect(extractFileSourceId(null, 'report.pdf')).toBeUndefined();
    expect(extractFileSourceId([['id-aaaa-1'], ['id-bbbb-2']], 'report.pdf')).toBeUndefined();
  });
});

describe('validateResumableUploadUrl with a custom base URL', () => {
  beforeEach(() => {
    process.env['GEMINI_NOTEBOOK_BASE_URL'] = 'https://notebooklm.google.com';
  });
  afterEach(() => {
    process.env['GEMINI_NOTEBOOK_BASE_URL'] = undefined;
  });

  it('still validates against the configured endpoint', () => {
    const url = 'https://notebooklm.google.com/upload/_/?upload_id=Z';
    expect(validateResumableUploadUrl(url)).toBe(url);
  });
});
