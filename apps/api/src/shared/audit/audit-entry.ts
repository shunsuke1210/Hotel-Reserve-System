// 操作履歴（audit_logs）の1行の形と、その組み立て（tasks.md 3.3、要件 18.1〜18.3、design.md audit_logs）。
//
// 記録するのは「誰が・いつ・何をしたか」だけ：
//   - 操作した人：スタッフは staff_id とスタッフ番号（actor_label）。定時処理は staff_id が空で、actor_label は
//     「SYSTEM:処理の名前」（「システム」による操作）
//   - 日時（at）・操作の名前（action）・対象の種類と ID（target_type・target_id）
//   - 操作の内容（detail）：次の欄だけ（設計の補足 DT-M34・L-42・L-49）
//       fields             登録・変更・削除した項目の名前（例：'rateBp'、'familyName'）。値は書かない
//       refs               関係する行の ID（名前は「…Id」「…Ids」、値は UUID）。例：部屋の入れ替えのもう一方の予約
//                          { otherReservationId }、移動先の部屋 { toRoomId }、入金の行 { paymentId }
//       roomStatusChanges  同じ操作で変わった部屋の状態（{ roomId, from, to }。ROOM_STATUSES の値）
//       jobRunId           定時処理の行だけ：その回の job_runs の ID（自動で入れる）
//
// 個人情報（氏名・住所・連絡先・旅券番号・メールアドレスなど）の値は、どの欄にも入らないように形で検査する（18.3）：
// ID は UUID だけ、項目の名前は英字の識別子だけ（数字・空白・記号・日本語を含めない）、部屋の状態は決めた値だけ、
// detail に決めた欄以外があれば断る。金額・日付・入力の文字列などの値は、それを持つ行の ID（refs）で辿る。
// 形に合わなければ RangeError（プログラムの誤り）。例外の文言はサーバーのログに出るので、渡された値を含めない。
import { ROOM_STATUSES, type RoomStatus } from '@hotel/contracts';
import type { JobContext } from '../jobs/scheduled-job.js';
import type { StaffPrincipal } from '../session/principals.js';

/**
 * 操作の名前（audit_logs.action）。社内用 API の登録・変更・削除の操作（design.md 社内用 API の表）と定時処理の操作。
 * 1つの操作（API の1回の要求）につき1行で、そのときに変わる部屋の状態などは detail に入れる（L-42）。
 * 新しい操作を作るときは、ここに名前を加える（画面 A07 で一覧にするため、名前を決めた一覧に限る）。
 */
export const AUDIT_ACTIONS = [
  // 予約（POST /reservations、/reservations/{id}/changes・cancel）
  'RESERVATION_CREATE',
  'RESERVATION_CHANGE',
  'RESERVATION_CANCEL',
  // 時間外（PUT /reservation-rooms/{id}/off-hours）
  'OFF_HOURS_UPDATE',
  // 部屋の移動・入れ替え（POST /reservation-rooms/{id}/move、/room-swaps。入れ替えは操作した側の予約が対象：L-49）
  'ROOM_MOVE',
  'ROOM_SWAP',
  // ノーショー（POST /reservations/{id}/no-show/defer・revert）と、定時処理 no-show の判定
  'NO_SHOW_DEFER',
  'NO_SHOW_REVERT',
  'NO_SHOW',
  // チェックイン・チェックアウト（部屋の状態の変化は detail に入れる）
  'CHECK_IN',
  'CHECK_OUT',
  // 入金・払い戻しの記録（POST /reservations/{id}/payments の direction が RECEIPT・REFUND）
  'PAYMENT_RECEIPT',
  'PAYMENT_REFUND',
  // 名簿（PUT /reservations/{id}/roster）
  'ROSTER_UPDATE',
  // お知らせの解決（POST /notices/{id}/resolve）
  'NOTICE_RESOLVE',
  // 部屋の状態の変更（POST /rooms/{id}/status と、定時処理 morning-status の変更）
  'ROOM_STATUS_CHANGE',
  // 故障中（POST /rooms/{id}/out-of-order、PATCH /out-of-order/{id}、POST /out-of-order/{id}/end）
  'OUT_OF_ORDER_CREATE',
  'OUT_OF_ORDER_UPDATE',
  'OUT_OF_ORDER_END',
  // 特定期間割増（POST・PATCH・DELETE /special-surcharges）
  'SPECIAL_SURCHARGE_CREATE',
  'SPECIAL_SURCHARGE_UPDATE',
  'SPECIAL_SURCHARGE_DELETE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 対象の種類（audit_logs.target_type。テーブルの行の種類。target_id はその行の UUID） */
export const AUDIT_TARGET_TYPES = [
  'reservation',
  'room',
  'out_of_order_period',
  'special_surcharge_period',
  'notice',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** 定時処理の actor_label の接頭辞（後ろに処理の名前を付ける。例：'SYSTEM:no-show'） */
export const SYSTEM_ACTOR_LABEL_PREFIX = 'SYSTEM:';

/** 操作した人 */
export type AuditActor =
  | {
      readonly kind: 'STAFF';
      readonly staffId: string;
      /** スタッフ番号（actor_label に記録する） */
      readonly staffNumber: string;
    }
  | {
      readonly kind: 'SYSTEM';
      /** 定時処理の名前 */
      readonly job: string;
      /** その回の job_runs の ID */
      readonly runId: string;
    };

/** スタッフの操作（コントローラーで @CurrentStaff() が返すスタッフ） */
export function staffActor(staff: Pick<StaffPrincipal, 'staffId' | 'staffNumber'>): AuditActor {
  return { kind: 'STAFF', staffId: staff.staffId, staffNumber: staff.staffNumber };
}

/** 定時処理の操作（「システム」。ScheduledJob.execute が受け取る文脈） */
export function systemActor(ctx: Pick<JobContext, 'job' | 'runId'>): AuditActor {
  return { kind: 'SYSTEM', job: ctx.job, runId: ctx.runId };
}

/** 同じ操作で変わった部屋の状態 */
export interface AuditRoomStatusChange {
  readonly roomId: string;
  readonly from: RoomStatus;
  readonly to: RoomStatus;
}

/** 操作の内容（記録できる欄。値は書かない：先頭の説明を参照） */
export interface AuditDetail {
  /** 登録・変更・削除した項目の名前（英字の識別子。'.' で区切ってもよい。例：'rateBp'、'companion.contact'） */
  readonly fields?: readonly string[];
  /** 関係する行の ID。名前は「…Id」（1つ）・「…Ids」（複数）、値は UUID */
  readonly refs?: Readonly<Record<string, string | readonly string[]>>;
  /** 同じ操作で変わった部屋の状態（部屋の状態の変更の行を別に作らない：L-42） */
  readonly roomStatusChanges?: readonly AuditRoomStatusChange[];
}

/** 記録する1つの操作 */
export interface AuditEntry {
  action: AuditAction;
  target: { readonly type: AuditTargetType; readonly id: string };
  detail?: AuditDetail;
  /**
   * 操作の時刻（省略時は業務の時計の今）。変更した行の時刻（checked_in_at など）とそろえるときに、
   * その操作で使った時刻を渡す
   */
  at?: Date;
}

/** audit_logs.detail に保存する形 */
export interface AuditLogDetail {
  fields?: string[];
  refs?: Record<string, string | string[]>;
  roomStatusChanges?: { roomId: string; from: RoomStatus; to: RoomStatus }[];
  jobRunId?: string;
}

/** audit_logs に追加する1行（id・created_at はデータベースが決める） */
export interface AuditLogRow {
  staffId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  detail: AuditLogDetail;
  at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 項目の名前：英字で始まる英字と _ の識別子を '.' でつないだもの（数字・空白・@・日本語などを含めない） */
const FIELD_NAME = /^[a-z][A-Za-z_]*(\.[a-z][A-Za-z_]*)*$/;
/** 関係する行の ID の名前：英字だけで、Id または Ids で終わる（例：otherReservationId、rosterEntryIds） */
const REF_NAME = /^[a-z][A-Za-z]*Ids?$/;
const MAX_NAME_LENGTH = 64;
const MAX_JOB_NAME_LENGTH = 64;
const DETAIL_KEYS: ReadonlySet<string> = new Set(['fields', 'refs', 'roomStatusChanges']);
const ROOM_STATUS_CHANGE_KEYS: ReadonlySet<string> = new Set(['roomId', 'from', 'to']);
const ACTIONS: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
const TARGET_TYPES: ReadonlySet<string> = new Set(AUDIT_TARGET_TYPES);
const ROOM_STATUS_VALUES: ReadonlySet<string> = new Set(ROOM_STATUSES);

/** 形の誤り。文言には欄の位置と規則だけを書き、渡された値は書かない */
function invalid(path: string, rule: string): RangeError {
  return new RangeError(`操作履歴の ${path} が正しくありません（${rule}）`);
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(path, 'UUID にする');
  return value.toLowerCase();
}

function fieldName(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_NAME_LENGTH || !FIELD_NAME.test(value)) {
    throw invalid(path, '項目の名前（英字の識別子）にする。値は書かない');
  }
  return value;
}

function roomStatus(value: unknown, path: string): RoomStatus {
  if (typeof value !== 'string' || !ROOM_STATUS_VALUES.has(value)) {
    throw invalid(path, 'ROOM_STATUSES の値にする');
  }
  return value as RoomStatus;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actorColumns(actor: AuditActor): Pick<AuditLogRow, 'staffId' | 'actorLabel'> {
  if (actor.kind === 'STAFF') {
    if (typeof actor.staffNumber !== 'string' || actor.staffNumber.trim() === '') {
      throw invalid('actor.staffNumber', 'スタッフ番号を入れる');
    }
    return { staffId: uuid(actor.staffId, 'actor.staffId'), actorLabel: actor.staffNumber };
  }
  if (actor.kind === 'SYSTEM') {
    if (
      typeof actor.job !== 'string' ||
      actor.job === '' ||
      actor.job.length > MAX_JOB_NAME_LENGTH
    ) {
      throw invalid('actor.job', '定時処理の名前を入れる');
    }
    return { staffId: null, actorLabel: `${SYSTEM_ACTOR_LABEL_PREFIX}${actor.job}` };
  }
  throw invalid('actor.kind', "'STAFF' か 'SYSTEM' にする");
}

function detailColumn(detail: AuditDetail | undefined, actor: AuditActor): AuditLogDetail {
  const result: AuditLogDetail = {};
  if (detail !== undefined) {
    if (!isPlainObject(detail)) throw invalid('detail', 'オブジェクトにする');
    Object.keys(detail).forEach((key, index) => {
      if (!DETAIL_KEYS.has(key)) {
        throw invalid(
          `detail の ${index + 1} 番目の欄`,
          'fields・refs・roomStatusChanges だけにする',
        );
      }
    });

    if (detail.fields !== undefined) {
      if (!Array.isArray(detail.fields)) throw invalid('detail.fields', '配列にする');
      const fields = [
        ...new Set(detail.fields.map((name, i) => fieldName(name, `detail.fields[${i}]`))),
      ];
      if (fields.length > 0) result.fields = fields;
    }

    if (detail.refs !== undefined) {
      if (!isPlainObject(detail.refs)) throw invalid('detail.refs', 'オブジェクトにする');
      const refs: Record<string, string | string[]> = {};
      Object.entries(detail.refs).forEach(([name, value], index) => {
        const path = `detail.refs の ${index + 1} 番目`;
        if (name.length > MAX_NAME_LENGTH || !REF_NAME.test(name)) {
          throw invalid(`${path}の名前`, '「…Id」「…Ids」の英字の名前にする');
        }
        if (name.endsWith('Ids')) {
          if (!Array.isArray(value)) throw invalid(path, '「…Ids」は UUID の配列にする');
          refs[name] = value.map((id: unknown, i) => uuid(id, `${path}[${i}]`));
        } else {
          refs[name] = uuid(value, path);
        }
      });
      if (Object.keys(refs).length > 0) result.refs = refs;
    }

    if (detail.roomStatusChanges !== undefined) {
      if (!Array.isArray(detail.roomStatusChanges)) {
        throw invalid('detail.roomStatusChanges', '配列にする');
      }
      const changes = detail.roomStatusChanges.map((change: unknown, i) => {
        const path = `detail.roomStatusChanges[${i}]`;
        if (!isPlainObject(change)) throw invalid(path, 'オブジェクトにする');
        if (Object.keys(change).some((key) => !ROOM_STATUS_CHANGE_KEYS.has(key))) {
          throw invalid(path, 'roomId・from・to だけにする');
        }
        return {
          roomId: uuid(change.roomId, `${path}.roomId`),
          from: roomStatus(change.from, `${path}.from`),
          to: roomStatus(change.to, `${path}.to`),
        };
      });
      if (changes.length > 0) result.roomStatusChanges = changes;
    }
  }
  if (actor.kind === 'SYSTEM') result.jobRunId = uuid(actor.runId, 'actor.runId');
  return result;
}

/**
 * 操作履歴の1行を組み立てる（形を検査し、個人情報の値が入らないようにする）。
 * @param at 操作の時刻
 * @throws RangeError 形に合わないとき（プログラムの誤り。文言に渡された値を含めない）
 */
export function buildAuditLogRow(actor: AuditActor, entry: AuditEntry, at: Date): AuditLogRow {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw invalid('at', '正しい時刻にする');
  if (!ACTIONS.has(entry.action)) throw invalid('action', 'AUDIT_ACTIONS の値にする');
  if (!isPlainObject(entry.target)) throw invalid('target', 'オブジェクトにする');
  if (!TARGET_TYPES.has(entry.target.type)) {
    throw invalid('target.type', 'AUDIT_TARGET_TYPES の値にする');
  }
  return {
    ...actorColumns(actor),
    action: entry.action,
    targetType: entry.target.type,
    targetId: uuid(entry.target.id, 'target.id'),
    detail: detailColumn(entry.detail, actor),
    at,
  };
}
