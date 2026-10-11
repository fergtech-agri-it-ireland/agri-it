-- Silage dry matter help (11 Oct 2026, rule silage-dm@1.0, src/lib/forecast/silageDm.ts)
-- cut: which cut the silage is from (1 first, 2 second, 3 third or later)
-- dm_test: Teagasc yard test result when there is no lab figure (a band, the farmer's estimate)
-- density_basis: 'teagasc_25dm' when the pit density is Teagasc's published figure for silage
--   of about 25% DM; the winter budget then shows Medium confidence and says why.
alter table public.silage_stores
  add column if not exists cut smallint check (cut between 1 and 3),
  add column if not exists dm_test text check (dm_test in ('squeeze_lt20', 'squeeze_20_25', 'squeeze_25_30', 'ball_lt25', 'ball_25_30', 'ball_30_40', 'ball_gt40')),
  add column if not exists density_basis text check (density_basis in ('own', 'teagasc_25dm'));

insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S16', 'A guide to storing silage and managing effluent collection (Today''s Farm, May-June 2024)', 'Teagasc', 'https://teagasc.ie/wp-content/uploads/media/website/publications/2024/A-guide-to-storing-silage-and-managing-effluent-collection.pdf', '2024-05-01', '2026-10-11'),
('S17', 'Visual Assessment of Silage (factsheet)', 'Teagasc', 'https://teagasc.ie/wp-content/uploads/2025/05/Visual-Assessment-of-Silage-Factsheet.pdf', null, '2026-10-11'),
('S18', 'First cut silage better quality than in 2024 (feed trade data)', 'Irish Farmers Journal', 'https://www.farmersjournal.ie/more/northern-ireland/first-cut-silage-better-quality-than-in-2024-890435', '2025-10-22', '2026-10-11'),
('S19', 'Northern Ireland: First-cut silage has average DM of just 24% (United Feeds analysis)', 'Agriland', 'https://www.agriland.ie/farming-news/northern-ireland-first-cut-silage-has-average-dm-of-just-24/', '2022-10-26', '2026-10-11')
on conflict (code) do nothing;
