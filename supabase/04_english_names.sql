-- =====================================================================
-- 04 — English display names + US$ exchange rate (2026-11-16)
-- One-time update for a database that was set up before this change.
-- Safe: adds columns and fills them; no other data changes. Safe to re-run.
-- (New setups don't need this: 01/03 already include it.)
-- =====================================================================
alter table items add column if not exists name_en text;
alter table locations add column if not exists name_en text;
update items set name_en = v.n from (values
  ('FG01', 'Women''s V-Neck Tee, Short Sleeve · Black · S'),
  ('FG02', 'Women''s V-Neck Tee, Short Sleeve · Black · M'),
  ('FG03', 'Women''s V-Neck Tee, Short Sleeve · Black · L'),
  ('FG04', 'Women''s V-Neck Tee, Short Sleeve · Black · XL'),
  ('FG05', 'Women''s V-Neck Tee, Short Sleeve · Bone · M'),
  ('FG06', 'Women''s V-Neck Tee, Short Sleeve · Bone · L'),
  ('FG07', 'Women''s V-Neck Tee, Short Sleeve · Lilac · M'),
  ('FG08', 'Women''s V-Neck Tee, Short Sleeve · Lilac · L'),
  ('FG09', 'Women''s V-Neck Tee, Short Sleeve · Crystal Blue · M'),
  ('FG10', 'Women''s V-Neck Tee, Short Sleeve · Crystal Blue · L'),
  ('FG11', 'Men''s Crew-Neck Tee, Short Sleeve · Black · M'),
  ('FG12', 'Women''s Crew-Neck Tee, Long Sleeve · Black · M'),
  ('FG13', 'Women''s Rib Racerback Tank · Black · M'),
  ('FG14', 'Women''s Short Dress with Pockets · Black · M'),
  ('KIT01', 'Women''s V-Neck Tee 3-Pack · M (Black / Bone / Lilac)'),
  ('C01', 'Jersey Fabric, 100% Cotton · Black'),
  ('C02', 'Jersey Fabric, 100% Cotton · Bone'),
  ('C03', 'Jersey Fabric, 100% Cotton · Lilac'),
  ('C04', 'Jersey Fabric, 100% Cotton · Crystal Blue'),
  ('C05', 'Rib Fabric for Collars · Black'),
  ('C06', 'Rib Fabric for Collars · Bone'),
  ('C07', 'Rib Fabric for Collars · Lilac'),
  ('C08', 'Rib Fabric for Collars · Crystal Blue'),
  ('C09', 'Rib Fabric for Tank Tops · Black'),
  ('C10', 'Polyester Sewing Thread (5,000 yd cone)'),
  ('C11', 'Woven Brand Label'),
  ('C12', 'Size Label'),
  ('C13', 'Care & Content Label'),
  ('C14', 'Printed Hangtag'),
  ('C15', 'Self-Seal Polybag'),
  ('C16', 'Printed 3-Pack Box')
) v(id, n) where items.id = v.id;
update locations set name_en = v.n from (values
  ('LOC01', 'Fabric & Trims Warehouse'),
  ('LOC02', 'Cutting & Sewing Workshop'),
  ('LOC03', 'Finished Goods Warehouse'),
  ('LOC04', 'Gamarra Retail Store'),
  ('LOC05', 'Quality Hold')
) v(id, n) where locations.id = v.id;
insert into settings(key, value, label, unit, description)
values ('usd_rate', 3.70, 'Exchange rate (S/ per US$)', 'S/ per 1 US$', 'Only used for the ≈ US$ notes next to big totals. Update it to the current rate before the demo.')
on conflict (key) do nothing;
