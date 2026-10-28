// セッションの種類ごとの決まり（design.md Security Considerations・Data Models の sessions、research.md ADR-04）。
// 会員とスタッフは別の種類のセッション（sessions.realm）で、別の名前の Cookie で受け渡す。

/** セッションの種類（sessions.realm） */
export type SessionRealm = 'MEMBER' | 'STAFF';

export interface SessionPolicy {
  /**
   * Cookie の名前。接頭辞 __Host- により、ブラウザは Secure・Path=/・Domain なしのときだけ受け付ける
   * （ほかのサブドメインから同じ名前の Cookie を上書きされない）
   */
  cookieName: string;
  /** Cookie の SameSite */
  sameSite: 'lax' | 'strict';
  /** 最後の操作からこの時間で失効する（ちょうどの時刻で無効：DT-M1） */
  idleTimeoutMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

export const SESSION_POLICIES: Readonly<Record<SessionRealm, SessionPolicy>> = {
  MEMBER: {
    cookieName: '__Host-hotel-member-session',
    sameSite: 'lax',
    idleTimeoutMs: 7 * 24 * HOUR_MS,
  },
  STAFF: {
    cookieName: '__Host-hotel-staff-session',
    sameSite: 'strict',
    idleTimeoutMs: 12 * HOUR_MS,
  },
};
