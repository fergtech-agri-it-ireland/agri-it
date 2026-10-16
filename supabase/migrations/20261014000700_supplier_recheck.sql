-- Supplier directory upkeep (advisory board G08, 14 Oct 2026).
-- Every directory supplier and branch is rechecked six months after verified_on; the app works
-- that date out (lib/suppliers.ts recheckBy) and the build fails 30 days after it. No new column:
-- verified_on stays the one date to keep right.
-- Lakeland was tried again on 14 Oct 2026; its website still blocks automated checks, so its
-- numbers stay not verified. Star Fuels' website still showed "account suspended": no number.
-- No deletes or drops.

update public.suppliers
   set local_contact_method = 'These numbers come from the September 2026 product document and could not be re-checked on 11 or 14 Oct 2026 (its website blocks automated checks). Check them on the Lakeland contact page before relying on them.'
 where id = '10000000-0000-0000-0000-000000000003' and verified_on is null;
