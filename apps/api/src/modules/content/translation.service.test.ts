import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TestTranslator } from '../../integrations/testing/test-translator.js';
import { createNoDatabasePrisma } from '../../test/listener-app.js';
import {
  isUsableTranslation,
  sourceHashOf,
  TranslationService,
  type TranslationSource,
} from './translation.service.js';

const SOURCE: TranslationSource = {
  entityType: 'ROOM_TYPE',
  entityId: '6f1c2a7e-5b8d-4c3e-9a1f-2d4b6c8e0a13',
  field: 'description',
  textJa: '32㎡の客室です。',
};

describe('原文の指紋（translations.source_hash）', () => {
  it('[16.4] 日本語の原文の SHA-256（16進）で、同じ原文なら同じ値、違えば違う値', () => {
    expect(sourceHashOf('朝食')).toBe(createHash('sha256').update('朝食', 'utf8').digest('hex'));
    expect(sourceHashOf('朝食')).toBe(sourceHashOf('朝食'));
    expect(sourceHashOf('朝食')).not.toBe(sourceHashOf('朝食 '));
  });
});

describe('保存した翻訳文をそのまま使えるか', () => {
  const current = sourceHashOf(SOURCE.textJa);
  const outdated = sourceHashOf('変更する前の説明です。');

  it('[16.4] 機械翻訳の文は、今の原文から作ったもの（source_hash が一致）だけを使う', () => {
    expect(isUsableTranslation({ sourceHash: current, isEdited: false }, SOURCE.textJa)).toBe(true);
    expect(isUsableTranslation({ sourceHash: outdated, isEdited: false }, SOURCE.textJa)).toBe(
      false,
    );
  });

  it('[16.4][21.5] スタッフが直した文（is_edited）は、原文が変わっていても使う（上書きしない）', () => {
    expect(isUsableTranslation({ sourceHash: current, isEdited: true }, SOURCE.textJa)).toBe(true);
    expect(isUsableTranslation({ sourceHash: outdated, isEdited: true }, SOURCE.textJa)).toBe(true);
  });
});

describe('TranslationService.localize（日本語）', () => {
  it('[16.4] 日本語では原文をそのまま返し、データベースも翻訳サービスも使わない', async () => {
    const translator = new TestTranslator();
    const service = new TranslationService(translator);
    const other: TranslationSource = { ...SOURCE, field: 'name', textJa: 'スタンダード キング' };
    await expect(
      service.localize(createNoDatabasePrisma(), [SOURCE, other], 'ja'),
    ).resolves.toEqual(['32㎡の客室です。', 'スタンダード キング']);
    expect(translator.calls).toEqual([]);
  });

  it('翻訳する文章がなければ、データベースを使わずに空の一覧を返す', async () => {
    const translator = new TestTranslator();
    const service = new TranslationService(translator);
    await expect(service.localize(createNoDatabasePrisma(), [], 'en')).resolves.toEqual([]);
    await expect(service.createMissing(createNoDatabasePrisma(), [])).resolves.toBe(0);
    expect(translator.calls).toEqual([]);
  });
});
