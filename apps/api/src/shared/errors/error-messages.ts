// エラーの既定の文言（5言語。要件 16.2、設計の補足 L-11）。
// 業務エラーを投げる側が文言を渡さなかったときと、フレームワークが出す例外（URL が見つからない、JSON の形式の誤りなど）に使う。
// 公開用 API は要求の言語（shared/i18n/request-locale.ts）で、社内用 API は日本語で返す。
// 日本語の文言は design.md「Error Handling」の表の「画面の動き」と設計の補足（L-1・L-33）に合わせる。
//
// 業務ルールごとに別の文言が要るときは、BusinessError に5言語の文言（LocalizedText）を渡す。
// 日本語だけの文言（文字列）を渡すと、公開用 API の日本語以外の要求では、ここの既定の文言になる。
import { FORBIDDEN_MESSAGE, type ErrorCode, type Locale } from '@hotel/contracts';

/** 5言語の文言 */
export type LocalizedText = Readonly<Record<Locale, string>>;

const ERROR_MESSAGES: Readonly<Record<ErrorCode, LocalizedText>> = {
  VALIDATION_FAILED: {
    ja: '入力内容に誤りがあります',
    en: 'Some of the information you entered is invalid.',
    ko: '입력 내용에 오류가 있습니다.',
    'zh-Hans': '输入的内容有误。',
    'zh-Hant': '輸入的內容有誤。',
  },
  UNAUTHENTICATED: {
    ja: 'ログインしてください',
    en: 'Please log in.',
    ko: '로그인해 주세요.',
    'zh-Hans': '请登录。',
    'zh-Hant': '請登入。',
  },
  TOKEN_INVALID: {
    ja: 'このリンクは無効か、有効期限が切れています。もう一度手続きをやり直してください',
    en: 'This link is invalid or has expired. Please start the procedure again.',
    ko: '이 링크는 유효하지 않거나 기한이 지났습니다. 처음부터 다시 진행해 주세요.',
    'zh-Hans': '此链接无效或已过期。请重新办理。',
    'zh-Hant': '此連結無效或已過期。請重新辦理。',
  },
  INVALID_CREDENTIALS: {
    ja: 'メールアドレスまたはパスワードが違います',
    en: 'The email address or password is incorrect.',
    ko: '이메일 주소 또는 비밀번호가 올바르지 않습니다.',
    'zh-Hans': '电子邮件地址或密码不正确。',
    'zh-Hant': '電子郵件地址或密碼不正確。',
  },
  EMAIL_NOT_VERIFIED: {
    ja: 'メールアドレスの確認が済んでいません。確認メールのリンクを開いてください',
    en: 'Your email address has not been verified. Please open the link in the confirmation email.',
    ko: '이메일 주소 확인이 완료되지 않았습니다. 확인 메일의 링크를 열어 주세요.',
    'zh-Hans': '您的电子邮件地址尚未验证。请打开确认邮件中的链接。',
    'zh-Hant': '您的電子郵件地址尚未驗證。請開啟確認郵件中的連結。',
  },
  FORBIDDEN: {
    // 社内用 API の FORBIDDEN の文言（要件 2.4、設計の補足 L-33）
    ja: FORBIDDEN_MESSAGE,
    en: 'You do not have permission.',
    ko: '권한이 없습니다.',
    'zh-Hans': '没有权限。',
    'zh-Hant': '沒有權限。',
  },
  NOT_FOUND: {
    ja: '見つかりません',
    en: 'Not found.',
    ko: '찾을 수 없습니다.',
    'zh-Hans': '未找到。',
    'zh-Hant': '找不到。',
  },
  EMAIL_ALREADY_REGISTERED: {
    ja: 'このメールアドレスはすでに登録されています。ログインするか、パスワードを再設定してください',
    en: 'This email address is already registered. Please log in or reset your password.',
    ko: '이미 등록된 이메일 주소입니다. 로그인하거나 비밀번호를 재설정해 주세요.',
    'zh-Hans': '该电子邮件地址已被注册。请登录或重设密码。',
    'zh-Hant': '此電子郵件地址已被註冊。請登入或重設密碼。',
  },
  PHONE_ALREADY_REGISTERED: {
    ja: 'この電話番号はすでに登録されています。ログインするか、パスワードを再設定してください',
    en: 'This phone number is already registered. Please log in or reset your password.',
    ko: '이미 등록된 전화번호입니다. 로그인하거나 비밀번호를 재설정해 주세요.',
    'zh-Hans': '该电话号码已被注册。请登录或重设密码。',
    'zh-Hant': '此電話號碼已被註冊。請登入或重設密碼。',
  },
  NO_AVAILABILITY: {
    ja: 'ご希望の条件で空いている部屋がありません',
    en: 'No rooms are available for the requested conditions.',
    ko: '요청하신 조건으로 이용 가능한 객실이 없습니다.',
    'zh-Hans': '没有符合所选条件的空房。',
    'zh-Hant': '沒有符合所選條件的空房。',
  },
  ALREADY_CONFIRMED: {
    ja: 'この予約はすでに確定しています',
    en: 'This reservation has already been confirmed.',
    ko: '이 예약은 이미 확정되었습니다.',
    'zh-Hans': '此预订已经确认。',
    'zh-Hant': '此預訂已經確認。',
  },
  HOLD_ALREADY_EXISTS: {
    ja: 'お支払いが済んでいない予約がほかにあります。先にその予約のお支払いを済ませてください',
    en: 'You have another reservation awaiting payment. Please complete the payment for that reservation first.',
    ko: '결제가 완료되지 않은 다른 예약이 있습니다. 먼저 해당 예약의 결제를 완료해 주세요.',
    'zh-Hans': '您还有其他待付款的预订。请先完成该预订的付款。',
    'zh-Hant': '您還有其他待付款的預訂。請先完成該預訂的付款。',
  },
  HOLD_EXPIRED: {
    ja: 'お部屋を確保できる時間（15分）を過ぎました。予約の入力からやり直してください',
    en: 'The 15-minute room hold has expired. Please start your reservation again.',
    ko: '객실 확보 시간(15분)이 지났습니다. 예약 입력부터 다시 진행해 주세요.',
    'zh-Hans': '客房保留时间（15分钟）已过。请重新填写预订信息。',
    'zh-Hant': '客房保留時間（15分鐘）已過。請重新填寫預訂資料。',
  },
  PRICE_CHANGED: {
    ja: '料金または条件が変わりました。新しい料金を確認してください',
    en: 'The price or conditions have changed. Please check the new price.',
    ko: '요금 또는 조건이 변경되었습니다. 새 요금을 확인해 주세요.',
    'zh-Hans': '价格或条件已变更。请确认新的价格。',
    'zh-Hant': '價格或條件已變更。請確認新的價格。',
  },
  QUOTE_OUTDATED: {
    ja: '見積もりの後に内容が変わりました。最新の見積もりを確認してください',
    en: 'The details have changed since the quote was issued. Please check the latest quote.',
    ko: '견적 이후 내용이 변경되었습니다. 최신 견적을 확인해 주세요.',
    'zh-Hans': '报价后内容已变更。请确认最新的报价。',
    'zh-Hant': '報價後內容已變更。請確認最新的報價。',
  },
  ROOM_OCCUPIED: {
    ja: '移動先の部屋は使用中です',
    en: 'The destination room is occupied.',
    ko: '이동할 객실이 사용 중입니다.',
    'zh-Hans': '目标客房正在使用中。',
    'zh-Hant': '目標客房正在使用中。',
  },
  ROOM_OUT_OF_ORDER: {
    ja: '移動先の部屋は故障中です',
    en: 'The destination room is out of order.',
    ko: '이동할 객실이 고장 중입니다.',
    'zh-Hans': '目标客房故障停用中。',
    'zh-Hant': '目標客房故障停用中。',
  },
  EXTENSION_ROOM_UNAVAILABLE: {
    ja: '延ばした日に同じ部屋が空いていないため、延長できません。フロントにお問い合わせください',
    en: 'The stay cannot be extended because the same room is not available on the added nights. Please contact the front desk.',
    ko: '연장한 날에 같은 객실이 비어 있지 않아 연장할 수 없습니다. 프런트에 문의해 주세요.',
    'zh-Hans': '延长的日期同一客房没有空房，无法延长。请联系前台。',
    'zh-Hant': '延長的日期同一客房沒有空房，無法延長。請聯絡櫃檯。',
  },
  OUT_OF_BOOKING_WINDOW: {
    ja: '予約できるのは365日先までです',
    en: 'Reservations can be made up to 365 days in advance.',
    ko: '예약은 365일 후까지만 가능합니다.',
    'zh-Hans': '最多只能预订365天以内的日期。',
    'zh-Hant': '最多只能預訂365天以內的日期。',
  },
  SAME_DAY_CUTOFF_PASSED: {
    ja: '当日の予約の受付時間を過ぎました',
    en: 'The deadline for same-day reservations has passed.',
    ko: '당일 예약 접수 시간이 지났습니다.',
    'zh-Hans': '已超过当日预订的受理时间。',
    'zh-Hant': '已超過當日預訂的受理時間。',
  },
  CAPACITY_EXCEEDED: {
    ja: '人数が客室の定員を超えています',
    en: 'The number of guests exceeds the room capacity.',
    ko: '인원이 객실 정원을 초과합니다.',
    'zh-Hans': '入住人数超过客房的容纳人数。',
    'zh-Hant': '入住人數超過客房的容納人數。',
  },
  ROOMS_EXCEED_ADULTS: {
    ja: '各部屋に大人が1名以上必要です。部屋数を大人の人数以下にしてください',
    en: 'Each room requires at least one adult. Please book no more rooms than the number of adults.',
    ko: '각 객실에 성인이 1명 이상 필요합니다. 객실 수를 성인 인원 이하로 해 주세요.',
    'zh-Hans': '每间客房至少需要1名成人。客房数不能超过成人人数。',
    'zh-Hant': '每間客房至少需要1名成人。客房數不能超過成人人數。',
  },
  MIXED_ROOM_TYPES_NOT_ALLOWED: {
    ja: '1つの予約に異なる客室タイプを含めることはできません。予約を分けてください',
    en: 'A reservation cannot include different room types. Please make separate reservations.',
    ko: '하나의 예약에 다른 객실 타입을 포함할 수 없습니다. 예약을 나누어 주세요.',
    'zh-Hans': '一个预订不能包含不同的客房类型。请分开预订。',
    'zh-Hant': '一個預訂不能包含不同的客房類型。請分開預訂。',
  },
  EARLY_BIRD_REQUIRES_PREPAID: {
    ja: '早期割は事前決済の場合だけ利用できます。支払い方法を選び直してください',
    en: 'The early bird discount is available only with prepayment. Please choose a different payment method.',
    ko: '조기 예약 할인은 사전 결제 시에만 이용할 수 있습니다. 결제 방법을 다시 선택해 주세요.',
    'zh-Hans': '早鸟优惠仅适用于预先付款。请重新选择付款方式。',
    'zh-Hant': '早鳥優惠僅適用於預先付款。請重新選擇付款方式。',
  },
  TERMS_NOT_AGREED: {
    ja: '宿泊約款に同意してください',
    en: 'Please agree to the terms and conditions of accommodation.',
    ko: '숙박 약관에 동의해 주세요.',
    'zh-Hans': '请同意住宿条款。',
    'zh-Hant': '請同意住宿條款。',
  },
  UNDER_CAPACITY_CONFIRMATION_REQUIRED: {
    ja: '移動先の部屋の定員が人数より少なくなります。確認してください',
    en: "The destination room's capacity is less than the number of guests. Please confirm.",
    ko: '이동할 객실의 정원이 인원보다 적습니다. 확인해 주세요.',
    'zh-Hans': '目标客房的容纳人数少于入住人数。请确认。',
    'zh-Hant': '目標客房的容納人數少於入住人數。請確認。',
  },
  UPGRADE_KIND_REQUIRED: {
    ja: '上位タイプへの移動は、無償か有償かを選んでください',
    en: 'Please choose whether the upgrade is free of charge or paid.',
    ko: '상위 타입으로 이동할 때는 무상인지 유상인지 선택해 주세요.',
    'zh-Hans': '升级到更高房型时，请选择免费或付费。',
    'zh-Hant': '升級到更高房型時，請選擇免費或付費。',
  },
  CHECKED_IN_ROOM_CHANGE_NOT_ALLOWED: {
    ja: 'チェックインの後は、故障中の部屋からの移動だけができます',
    en: 'After check-in, a room can be changed only when the current room is out of order.',
    ko: '체크인 후에는 고장 중인 객실에서의 이동만 가능합니다.',
    'zh-Hans': '入住后，仅可从故障停用的客房更换。',
    'zh-Hant': '入住後，僅可從故障停用的客房更換。',
  },
  ROSTER_INCOMPLETE: {
    ja: '宿泊者名簿の入力が終わっていません',
    en: 'The guest register has not been completed.',
    ko: '숙박자 명부 입력이 완료되지 않았습니다.',
    'zh-Hans': '住宿登记尚未填写完成。',
    'zh-Hant': '住宿登記尚未填寫完成。',
  },
  ROOM_NOT_CLEAN: {
    ja: '部屋の清掃が終わっていません',
    en: 'The room has not been cleaned yet.',
    ko: '객실 청소가 끝나지 않았습니다.',
    'zh-Hans': '客房尚未清扫完毕。',
    'zh-Hant': '客房尚未清掃完畢。',
  },
  UNSETTLED_BALANCE: {
    ja: '精算が済んでいない金額があります',
    en: 'There is an unsettled balance.',
    ko: '정산되지 않은 금액이 있습니다.',
    'zh-Hans': '尚有未结清的金额。',
    'zh-Hant': '尚有未結清的金額。',
  },
  STATUS_TRANSITION_NOT_ALLOWED: {
    ja: 'この状態には変更できません',
    en: 'The status cannot be changed to this value.',
    ko: '이 상태로 변경할 수 없습니다.',
    'zh-Hans': '无法变更为此状态。',
    'zh-Hant': '無法變更為此狀態。',
  },
  HAS_ACTIVE_RESERVATION: {
    ja: '今後の予約があるため退会できません。先に予約をキャンセルしてください',
    en: 'You cannot cancel your membership because you have upcoming reservations. Please cancel them first.',
    ko: '앞으로의 예약이 있어 탈퇴할 수 없습니다. 먼저 예약을 취소해 주세요.',
    'zh-Hans': '您还有今后的预订，无法注销会员。请先取消预订。',
    'zh-Hant': '您還有今後的預訂，無法取消會員資格。請先取消預訂。',
  },
  HAS_UNPAID_BALANCE: {
    ja: 'お支払いいただいていない金額があるため退会できません。先にお支払いをお願いします',
    en: 'You cannot cancel your membership because you have an unpaid balance. Please pay it first.',
    ko: '미납 금액이 있어 탈퇴할 수 없습니다. 먼저 결제해 주세요.',
    'zh-Hans': '您有未付的金额，无法注销会员。请先付款。',
    'zh-Hant': '您有未付的金額，無法取消會員資格。請先付款。',
  },
  NOT_CANCELLABLE: {
    ja: 'この予約はキャンセルできません',
    en: 'This reservation cannot be cancelled.',
    ko: '이 예약은 취소할 수 없습니다.',
    'zh-Hans': '此预订无法取消。',
    'zh-Hant': '此預訂無法取消。',
  },
  NOT_MODIFIABLE: {
    ja: 'この予約は変更できません',
    en: 'This reservation cannot be changed.',
    ko: '이 예약은 변경할 수 없습니다.',
    'zh-Hans': '此预订无法变更。',
    'zh-Hant': '此預訂無法變更。',
  },
  EARLY_CHECKOUT_REQUIRED: {
    ja: '出発日より前にチェックアウトするときは、早期チェックアウトの手続きをしてください',
    en: 'To check out before the departure date, please complete the early check-out procedure.',
    ko: '출발일 이전에 체크아웃하려면 조기 체크아웃 절차를 진행해 주세요.',
    'zh-Hans': '在离店日期之前退房时，请办理提前退房手续。',
    'zh-Hant': '在離店日期之前退房時，請辦理提前退房手續。',
  },
  RESERVATION_STATUS_INVALID: {
    ja: '予約の状態または日時が、この操作の条件に合いません',
    en: "The reservation's status or date and time do not allow this operation.",
    ko: '예약 상태 또는 일시가 이 작업의 조건에 맞지 않습니다.',
    'zh-Hans': '预订的状态或日期时间不符合此操作的条件。',
    'zh-Hant': '預訂的狀態或日期時間不符合此操作的條件。',
  },
  OVERLAPPING_PERIOD: {
    ja: 'ほかの期間と重なっています',
    en: 'The period overlaps with another period.',
    ko: '다른 기간과 겹칩니다.',
    'zh-Hans': '与其他期间重叠。',
    'zh-Hant': '與其他期間重疊。',
  },
  AMOUNT_EXCEEDS_BALANCE: {
    ja: '残高を超えています',
    en: 'The amount exceeds the balance.',
    ko: '잔액을 초과합니다.',
    'zh-Hans': '金额超过余额。',
    'zh-Hant': '金額超過餘額。',
  },
  MEMBER_REQUIRED: {
    ja: '予約者に会員を選んでください',
    en: 'Please select a member as the person making the reservation.',
    ko: '예약자로 회원을 선택해 주세요.',
    'zh-Hans': '请选择会员作为预订人。',
    'zh-Hant': '請選擇會員作為預訂人。',
  },
  PAYMENT_DECLINED: {
    ja: 'カードでのお支払いができませんでした。別のカードをお試しください',
    en: 'Your card was declined. Please try a different card.',
    ko: '카드 결제가 거절되었습니다. 다른 카드를 이용해 주세요.',
    'zh-Hans': '您的信用卡付款未成功。请尝试使用其他信用卡。',
    'zh-Hant': '您的信用卡付款未成功。請嘗試使用其他信用卡。',
  },
  PAYMENT_GATEWAY_UNAVAILABLE: {
    ja: '決済サービスに接続できませんでした。しばらく時間をおいてから、もう一度お試しください',
    en: 'We could not connect to the payment service. Please wait a while and try again.',
    ko: '결제 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    'zh-Hans': '无法连接支付服务。请稍后再试。',
    'zh-Hant': '無法連線至付款服務。請稍後再試。',
  },
  RATE_LIMITED: {
    ja: 'しばらく時間をおいてから、もう一度お試しください',
    en: 'Too many attempts. Please wait a while and try again.',
    ko: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    'zh-Hans': '操作过于频繁。请稍后再试。',
    'zh-Hant': '操作過於頻繁。請稍後再試。',
  },
  INTERNAL: {
    ja: 'システムでエラーが発生しました。しばらく時間をおいてから、もう一度お試しください',
    en: 'A system error occurred. Please wait a while and try again.',
    ko: '시스템 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    'zh-Hans': '系统发生错误。请稍后再试。',
    'zh-Hant': '系統發生錯誤。請稍後再試。',
  },
};

/** エラーコードの既定の文言（指定した言語） */
export function errorMessage(code: ErrorCode, locale: Locale): string {
  return ERROR_MESSAGES[code][locale];
}

/** エラーコードの既定の文言（日本語。スタッフ向けとサーバーのログの文言） */
export function defaultErrorMessage(code: ErrorCode): string {
  return errorMessage(code, 'ja');
}
