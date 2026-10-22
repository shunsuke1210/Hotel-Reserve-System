-- データの定義と処理の食い違いを、処理に合わせて直す（design.md 設計の補足 L-52〜L-55。tasks.md 1.4）。
-- schema.prisma から prisma migrate diff で作った SQL。

-- L-55：メールアドレスの変更（DT-M4）の確認前の新しいアドレス（purpose は VERIFY_EMAIL。会員登録の確認では空）
-- AlterTable
ALTER TABLE "auth_tokens" ADD COLUMN     "new_email" TEXT;

-- L-53：パスワードは退会で消す（要件 1.11）
-- AlterTable
ALTER TABLE "members" ALTER COLUMN "password_hash" DROP NOT NULL;

-- L-52：予約番号は確定の時点で発行する（確保の間と期限切れの予約では空。一意は空でない行の中で：既存の一意インデックスのまま）
-- AlterTable
ALTER TABLE "reservations" ALTER COLUMN "reservation_number" DROP NOT NULL;

-- L-54：名簿の氏名・住所・連絡先は、途中保存（L-19）のために空を許す（age_category は必須のまま）
-- AlterTable
ALTER TABLE "roster_entries" ALTER COLUMN "family_name" DROP NOT NULL,
ALTER COLUMN "given_name" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "contact" DROP NOT NULL;
