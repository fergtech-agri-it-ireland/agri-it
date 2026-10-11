-- New enum values for the review fixes (Oct 2026). Kept in their own migration because a
-- new enum value cannot be used in the same transaction that adds it.

-- Loans and capital purchases are cash going out but not running costs of the farm.
alter type public.cost_category add value if not exists 'loan_repayment' after 'other';
alter type public.cost_category add value if not exists 'capital' after 'loan_repayment';

-- A farm worker can record feeding, deliveries and jobs but does not see the farm's money.
alter type public.member_role add value if not exists 'worker' after 'member';

-- A routine occurrence put off to another day ("move to tomorrow").
alter type public.completion_status add value if not exists 'moved';
