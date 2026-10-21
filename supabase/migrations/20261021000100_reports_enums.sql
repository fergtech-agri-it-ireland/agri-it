-- Reports module (21 Oct 2026): animals bought get their own cost category, so the profit report
-- can set purchases against sales and the stock movement. Kept in its own migration because a new
-- enum value cannot be used in the transaction that adds it.
alter type public.cost_category add value if not exists 'livestock_purchase';
