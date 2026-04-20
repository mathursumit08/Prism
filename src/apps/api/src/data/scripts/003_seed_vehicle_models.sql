BEGIN;

SET CONSTRAINTS ALL DEFERRED;

-- models.csv
INSERT INTO vehicle_models (model_id, model, manufacturer, segment, launch_year)
VALUES
  ('MDL001', 'Hatch X', 'Apex Auto', 'Hatchback', '2022'),
  ('MDL002', 'City Lite', 'Apex Auto', 'Hatchback', '2022'),
  ('MDL003', 'Sedan Z', 'Apex Auto', 'Sedan', '2022'),
  ('MDL004', 'Urban Glide', 'Apex Auto', 'Sedan', '2022'),
  ('MDL005', 'SUV Max', 'Apex Auto', 'SUV', '2022'),
  ('MDL006', 'Trail Hawk', 'Apex Auto', 'SUV', '2022'),
  ('MDL007', 'Crossover Q', 'Apex Auto', 'Compact SUV', '2022'),
  ('MDL008', 'Adventure One', 'Apex Auto', 'Compact SUV', '2022'),
  ('MDL009', 'Family Tourer', 'Apex Auto', 'MPV', '2022'),
  ('MDL010', 'RoadFlex', 'Apex Auto', 'MPV', '2022'),
  ('MDL011', 'EV Spark', 'Apex Electric', 'EV', '2023'),
  ('MDL012', 'Volt Prime', 'Apex Electric', 'EV', '2023')
ON CONFLICT (model_id) DO UPDATE SET model = EXCLUDED.model, manufacturer = EXCLUDED.manufacturer, segment = EXCLUDED.segment, launch_year = EXCLUDED.launch_year;

COMMIT;
