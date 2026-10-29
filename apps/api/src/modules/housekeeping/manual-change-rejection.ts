// 状態の変更（スタッフの手動の変更。POST /rooms/{id}/status、C03 のボタン）を断るときの理由と文言
// （design.md Error Handling の STATUS_TRANSITION_NOT_ALLOWED「理由を表示（12.3）」、P-12、設計の補足 L-23、
// brief.md ST-01c・ST-03b）。
//
// 許すかどうかは domain/room-status の canChangeManually（2.5）が決める。ここでは断るときに、画面に出す理由を決める。
// 社内用 API の文言は常に日本語（要件 16.6）。部屋の状態の値と決まった文だけで、個人情報を含めない。
import type { RoomStatus, StaffRole } from '@hotel/contracts';
import { roomStatusRules } from '../../domain/room-status/transitions.js';

/** 断った理由（ApiError.details.reason） */
export type ManualChangeRejectionReason =
  /** 故障中への変更・故障中からの変更（どの役割でも、故障中の画面だけで行う：L-23） */
  | 'OUT_OF_ORDER'
  /** 清掃員の「来客なし」からの変更は「清掃完了」だけ（12.7、ST-03b） */
  | 'NO_ARRIVAL_ONLY_TO_CLEAN'
  /** 清掃員の「その他」のグループの中の変更（ST-01c） */
  | 'OTHER_GROUP'
  /** 清掃員のグループをまたぐ変更（12.3） */
  | 'CROSS_GROUP';

export interface ManualChangeRejection {
  reason: ManualChangeRejectionReason;
  /** 画面に出す文言（日本語） */
  message: string;
}

const MESSAGES: Readonly<Record<ManualChangeRejectionReason, string>> = {
  OUT_OF_ORDER:
    '故障中への変更と故障中からの変更は、ここではできません。故障中の設定と修理の完了は、フロント以上が故障中の画面で行います',
  NO_ARRIVAL_ONLY_TO_CLEAN: '清掃員が「来客なし」から変えられるのは「清掃完了」だけです',
  OTHER_GROUP:
    '「その他」のグループ（チェックイン済み・チェックアウト待ち・来客なし・故障中）の中の変更は、フロント以上が行います',
  CROSS_GROUP: 'グループをまたぐ状態の変更は、フロント以上が行います',
};

/**
 * スタッフの手動の変更で from → to を断る理由。許される変更なら null。
 * 同じ状態（from = to）は変更ではない（呼び出し側が「何もしない」として扱う）ので、ここでは受け付けない。
 * @throws RangeError 同じ状態、または役割・部屋の状態でない値
 */
export function manualChangeRejection(
  role: StaffRole,
  from: RoomStatus,
  to: RoomStatus,
): ManualChangeRejection | null {
  if (from === to) throw new RangeError('同じ状態への変更は、断る理由の判定の対象ではありません');
  if (roomStatusRules.canChangeManually(role, from, to)) return null;
  const reason = rejectionReason(from, to);
  return { reason, message: MESSAGES[reason] };
}

/**
 * canChangeManually が断った変更の理由。フロント以上が断られるのは故障中に関わる変更だけ（L-23）なので、
 * それ以外は清掃員の変更として理由を決める
 */
function rejectionReason(from: RoomStatus, to: RoomStatus): ManualChangeRejectionReason {
  if (from === 'OUT_OF_ORDER' || to === 'OUT_OF_ORDER') return 'OUT_OF_ORDER';
  if (from === 'NO_ARRIVAL') return 'NO_ARRIVAL_ONLY_TO_CLEAN';
  const fromGroup = roomStatusRules.groupOf(from);
  if (fromGroup === 'OTHER' && fromGroup === roomStatusRules.groupOf(to)) return 'OTHER_GROUP';
  return 'CROSS_GROUP';
}
