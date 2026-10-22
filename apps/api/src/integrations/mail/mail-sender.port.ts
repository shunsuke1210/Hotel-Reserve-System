// メール送信サービスのインターフェース（design.md Components and Interfaces「PaymentGateway・Translator・MailSender」、ADR-05）。
// メールは MailService が作って mail_outbox に入れ、定時処理 outbox がこのインターフェースで送る（P-15）。
// 業務のコードはこのインターフェースだけを使い、模擬実装（mock-mail-sender.ts）を直接読み込まない。
//
// 送信の結果は Promise で返す：resolve したら送信済み（outbox の行を SENT にしてよい）、
// reject したら送信できなかった（outbox の行の attempts を増やし、次の回に再送する）。

export interface OutgoingMail {
  /** 宛先のメールアドレス */
  to: string;
  subject: string;
  body: string;
}

export abstract class MailSender {
  /** メールを1通送る。送信できなければ reject する */
  abstract send(mail: OutgoingMail): Promise<void>;
}
