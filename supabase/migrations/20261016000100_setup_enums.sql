-- New cost categories for the financial planner and the accountant pack (16 Oct 2026).
-- Kept in their own migration because a new enum value cannot be used in the same
-- transaction that adds it. These are the lines a Teagasc cash flow budget lists apart
-- (land rent, labour, insurance, accountancy and advisory fees, household drawings).
alter type public.cost_category add value if not exists 'land_rent';
alter type public.cost_category add value if not exists 'labour';
alter type public.cost_category add value if not exists 'insurance';
alter type public.cost_category add value if not exists 'professional_fees';
-- Household drawings: cash out of the farm account, never a farm running cost
alter type public.cost_category add value if not exists 'household';
