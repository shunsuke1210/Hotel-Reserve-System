// 模擬のメール送信（design.md MailSender の模擬、research.md ADR-05）。
// 実際には送らず、送信の記録をメモリに残して、送信に成功したものとして返す。
// 送信済みとしての記録（mail_outbox の行を SENT にする）は、send が resolve した後に定時処理 outbox が行う。
// 開発用の一覧（/dev/mails）は mail_outbox を見るので、この記録には頼らない。
//
// 記録には宛先・本文などの個人情報が入るので、新しいものから MOCK_MAIL_RECORD_LIMIT 通だけを残し、
// メモリに貯め続けない。ログにも出さない。
// テストで送信を失敗させたいときは、testing/test-mail-sender.ts を使う（本番の結び付けには使わない）。
import { MailSender, type OutgoingMail } from './mail-sender.port.js';

/** 模擬のメールが残す送信の記録 */
export type SentMail = OutgoingMail;

/** 送信の記録を残す通数（これより古いものは捨てる） */
export const MOCK_MAIL_RECORD_LIMIT = 100;

export class MockMailSender extends MailSender {
  private readonly sent: SentMail[] = [];

  override async send(mail: OutgoingMail): Promise<void> {
    this.sent.push({ to: mail.to, subject: mail.subject, body: mail.body });
    if (this.sent.length > MOCK_MAIL_RECORD_LIMIT) {
      this.sent.splice(0, this.sent.length - MOCK_MAIL_RECORD_LIMIT);
    }
  }

  /** 送信したメール（古い順。直近の MOCK_MAIL_RECORD_LIMIT 通まで） */
  sentMails(): SentMail[] {
    return this.sent.map((mail) => ({ ...mail }));
  }
}
