import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWriteJson, safeReadJson, withLock } from '../server/store.ts';

describe('atomicWriteJson', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes valid JSON that can be read back', async () => {
    const path = join(tempDir, 'test.json');
    const data = { id: '123', name: 'test', nested: { a: 1 } };
    await atomicWriteJson(path, data);
    const raw = await readFile(path, 'utf-8');
    expect(JSON.parse(raw)).toEqual(data);
  });

  it('overwrites existing file atomically', async () => {
    const path = join(tempDir, 'test.json');
    await atomicWriteJson(path, { version: 1 });
    await atomicWriteJson(path, { version: 2 });
    const raw = await readFile(path, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });
});

describe('safeReadJson', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null for non-existent file', async () => {
    const result = await safeReadJson(join(tempDir, 'nope.json'));
    expect(result).toBeNull();
  });

  it('reads valid JSON', async () => {
    const path = join(tempDir, 'test.json');
    await atomicWriteJson(path, { hello: 'world' });
    const result = await safeReadJson<{ hello: string }>(path);
    expect(result).toEqual({ hello: 'world' });
  });

  it('recovers from truncated JSON', async () => {
    const path = join(tempDir, 'corrupt.json');
    const { writeFile: wf } = await import('node:fs/promises');
    // Valid JSON followed by garbage
    await wf(path, '{"id":"abc","status":"todo"}GARBAGE');
    const result = await safeReadJson<{ id: string }>(path);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('abc');
  });

  it('returns null for completely invalid content', async () => {
    const path = join(tempDir, 'bad.json');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(path, 'this is not json at all');
    const result = await safeReadJson(path);
    expect(result).toBeNull();
  });
});

describe('withLock', () => {
  it('serializes concurrent writes to the same key', async () => {
    const order: number[] = [];
    const p1 = withLock('test', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
      return 1;
    });
    const p2 = withLock('test', async () => {
      order.push(2);
      return 2;
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]); // p1 completes before p2 starts
  });

  it('allows concurrent writes to different keys', async () => {
    const order: string[] = [];
    const p1 = withLock('key-a', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push('a');
    });
    const p2 = withLock('key-b', async () => {
      order.push('b');
    });
    await Promise.all([p1, p2]);
    // b should finish before a since they run concurrently
    expect(order).toEqual(['b', 'a']);
  });

  it('releases lock even on error', async () => {
    await withLock('err-key', async () => {
      throw new Error('boom');
    }).catch(() => {});
    // Should not deadlock — second call should succeed
    const result = await withLock('err-key', async () => 'ok');
    expect(result).toBe('ok');
  });
});
