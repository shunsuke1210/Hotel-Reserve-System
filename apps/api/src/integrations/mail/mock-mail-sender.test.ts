import { describe, expect, it } from 'vitest';
import { MOCK_MAIL_RECORD_LIMIT, MockMailSender } from './mock-mail-sender.js';

describe('MockMailSender（模擬のメール送信）', () => {
  it('送信したメール（宛先・件名・本文）を、送信の記録として残す', async () => {
    const sender = new MockMailSender();
    await expect(
      sender.send({ to: 'a@example.com', subject: '予約完了', body: '本文1' }),
    ).resolves.toBeUndefined();
    await sender.send({ to: 'b@example.com', subject: '入金完了', body: '本文2' });
    expect(sender.sentMails()).toEqual([
      { to: 'a@example.com', subject: '予約完了', body: '本文1' },
      { to: 'b@example.com', subject: '入金完了', body: '本文2' },
    ]);
  });

  it('記録は送信の時点の写しで、渡したメールや取り出した一覧を書き換えても変わらない', async () => {
    const sender = new MockMailSender();
    const mail = { to: 'a@example.com', subject: '件名', body: '本文' };
    await sender.send(mail);
    mail.body = '書き換えた本文';
    const listed = sender.sentMails();
    listed[0]!.subject = '書き換えた件名';
    listed.length = 0;
    expect(sender.sentMails()).toEqual([{ to: 'a@example.com', subject: '件名', body: '本文' }]);
  });

  it(`記録は新しい順に ${MOCK_MAIL_RECORD_LIMIT} 通まで残し、古いものから捨てる（メモリに個人情報を貯め続けない）`, async () => {
    const sender = new MockMailSender();
    for (let i = 1; i <= MOCK_MAIL_RECORD_LIMIT + 5; i++) {
      await sender.send({ to: `m${i}@example.com`, subject: `件名${i}`, body: `本文${i}` });
    }
    const mails = sender.sentMails();
    expect(mails).toHaveLength(MOCK_MAIL_RECORD_LIMIT);
    expect(mails[0]?.to).toBe('m6@example.com');
    expect(mails.at(-1)?.to).toBe(`m${MOCK_MAIL_RECORD_LIMIT + 5}@example.com`);
  });
});
