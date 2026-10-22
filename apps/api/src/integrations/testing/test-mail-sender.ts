// テスト専用の模擬のメール。本番の結び付け（integrations.module.ts）には使わない。
// 固定しない間は MockMailSender と同じく、送信の記録を残して成功する。
// 結合テストで「MailSender が失敗を返すようにテスト用に差し替える」（TC-MB-269〜273）前提を作るときに、
// overrideProvider(MailSender).useValue(new TestMailSender()) で差し替えて使う。
import type { OutgoingMail } from '../mail/mail-sender.port.js';
import { MockMailSender } from '../mail/mock-mail-sender.js';

export class TestMailSender extends MockMailSender {
  private failure: Error | null = null;

  /** 以後の送信を、指定したエラーで失敗させる（失敗した送信は記録しない）。null なら解除する */
  failWith(error: Error | null): void {
    this.failure = error;
  }

  override async send(mail: OutgoingMail): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    await super.send(mail);
  }
}
