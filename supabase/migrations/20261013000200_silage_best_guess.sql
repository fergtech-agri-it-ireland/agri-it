-- Silage best guess (13 Oct 2026, rule silage-dm@1.2, src/lib/forecast/silageDm.ts)
-- Most farmers never test silage. A measured pit with no dry matter now gets tonnes from typical
-- silage (Teagasc S16 for ROI, 2025 cut averages S18 for NI), and unweighed bales a typical
-- 600 kg bale (S22). Both are labelled a best guess and the winter plan shows Low confidence.
-- Nothing is stored: the guess is worked out each time, so a squeeze test or weighed bale replaces it.
insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S22', 'Have you enough silage on your suckler farm? (Aurivo advice: bale weights)', 'Agriland', 'https://www.agriland.ie/farming-news/have-you-enough-silage-on-your-suckler-farm/', '2018-01-05', '2026-10-13')
on conflict (code) do nothing;
