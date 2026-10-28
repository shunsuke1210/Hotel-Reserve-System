import { hash as argon2Hash, verify as argon2Verify } from 'argon2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

// 本物の argon2 をそのまま呼びつつ、呼び出しを確かめられるようにする
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, hash: vi.fn(actual.hash), verify: vi.fn(actual.verify) };
});

const hashSpy = vi.mocked(argon2Hash);
const verifySpy = vi.mocked(argon2Verify);

describe('PasswordHasher（パスワードのハッシュ化。design.md Security Considerations、research.md ADR-04）', () => {
  const hasher = new PasswordHasher();

  afterEach(() => {
    // 呼び出しの記録と、使われなかった mockRejectedValueOnce を消す（実装は本物の argon2 に戻る）
    hashSpy.mockReset();
    verifySpy.mockReset();
  });

  it('[2.1] Argon2id（RFC 9106 の推奨：メモリ 64 MiB・3回・並列4）でハッシュ化し、元のパスワードを含めない', async () => {
    const hash = await hasher.hash('Staff0pass1');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    expect(hash).not.toContain('Staff0pass1');
  });

  it('同じパスワードでも、ハッシュは毎回異なる（ソルトを使う）', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('Passw0rd12'),
      hasher.hash('Passw0rd12'),
    ]);
    expect(first).not.toBe(second);
  });

  it('[2.1] 正しいパスワードなら true、誤りなら false', async () => {
    const hash = await hasher.hash('Passw0rd12');
    await expect(hasher.verify(hash, 'Passw0rd12')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'Wrongpass99')).resolves.toBe(false);
    await expect(hasher.verify(hash, 'passw0rd12')).resolves.toBe(false);
    await expect(hasher.verify(hash, '')).resolves.toBe(false);
  });

  describe('ハッシュがない（存在しない ID・停止中のスタッフ・退会した会員）とき', () => {
    it('起動時に作ったダミーのハッシュで Argon2 の照合を行ってから false を返す（ハッシュを新しく作る計算はしない）', async () => {
      const started = new PasswordHasher();
      await started.onModuleInit();
      expect(hashSpy).toHaveBeenCalledTimes(1);
      hashSpy.mockClear();

      for (const missing of [null, undefined, '']) {
        verifySpy.mockClear();
        await expect(started.verify(missing, 'Passw0rd12')).resolves.toBe(false);
        expect(verifySpy).toHaveBeenCalledTimes(1);
        expect(verifySpy).toHaveBeenCalledWith(
          expect.stringMatching(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/),
          'Passw0rd12',
        );
      }
      // 最初のログインでもダミーのハッシュを作らない（ハッシュがあるときと同じ計算の量にする）
      expect(hashSpy).not.toHaveBeenCalled();
    });

    it('ダミーのハッシュは毎回同じものを使う', async () => {
      const started = new PasswordHasher();
      await started.onModuleInit();
      await started.verify(null, 'first');
      await started.verify(null, 'second');
      const [first, second] = verifySpy.mock.calls.map(([dummy]) => dummy);
      expect(first).toBeDefined();
      expect(second).toBe(first);
    });

    it('起動時にダミーのハッシュを作れなくても起動は止めず、失敗を覚えずに次に使うときに作り直す', async () => {
      const started = new PasswordHasher();
      hashSpy.mockRejectedValueOnce(new Error('メモリが足りません'));
      await expect(started.onModuleInit()).resolves.toBeUndefined();
      expect(hashSpy).toHaveBeenCalledTimes(1);

      await expect(started.verify(null, 'Passw0rd12')).resolves.toBe(false);
      expect(hashSpy).toHaveBeenCalledTimes(2);
      expect(verifySpy).toHaveBeenCalledTimes(1);

      // 作り直したハッシュは覚えておく
      await expect(started.verify(null, 'Passw0rd12')).resolves.toBe(false);
      expect(hashSpy).toHaveBeenCalledTimes(2);
    });

    it('照合の時にもダミーのハッシュを作れなければ例外を投げ（認証の失敗にしない）、次の照合で作り直す', async () => {
      const notStarted = new PasswordHasher();
      const failure = new Error('メモリが足りません');
      hashSpy.mockRejectedValueOnce(failure);
      await expect(notStarted.verify(null, 'Passw0rd12')).rejects.toBe(failure);
      await expect(notStarted.verify(null, 'Passw0rd12')).resolves.toBe(false);
      expect(hashSpy).toHaveBeenCalledTimes(2);
    });
  });
});
