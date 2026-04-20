BEGIN;

SET CONSTRAINTS ALL DEFERRED;

-- dealers.csv
INSERT INTO dealers (dealer_id, dealer_name, region, city, state, dealer_type, sales_capacity_per_month)
VALUES
  ('DLR001', 'Metro Wheels New Delhi', 'North', 'New Delhi', 'Delhi', 'Metro', '540'),
  ('DLR002', 'Capital Auto Noida', 'North', 'Noida', 'Uttar Pradesh', 'Urban', '470'),
  ('DLR003', 'Punjab Drive Chandigarh', 'North', 'Chandigarh', 'Chandigarh', 'Urban', '430'),
  ('DLR004', 'Himalaya Motors Dehradun', 'North', 'Dehradun', 'Uttarakhand', 'Tier-2', '360'),
  ('DLR005', 'Royal Rides Jaipur', 'North', 'Jaipur', 'Rajasthan', 'Tier-2', '380'),
  ('DLR006', 'Ludhiana Auto Hub Ludhiana', 'North', 'Ludhiana', 'Punjab', 'Tier-2', '340'),
  ('DLR007', 'Coastal Drive Mumbai', 'West', 'Mumbai', 'Maharashtra', 'Metro', '540'),
  ('DLR008', 'Central Auto Pune', 'West', 'Pune', 'Maharashtra', 'Urban', '470'),
  ('DLR009', 'Sapphire Wheels Ahmedabad', 'West', 'Ahmedabad', 'Gujarat', 'Urban', '430'),
  ('DLR010', 'Desert Motors Surat', 'West', 'Surat', 'Gujarat', 'Tier-2', '360'),
  ('DLR011', 'Harbor Mobility Navi Mumbai', 'West', 'Navi Mumbai', 'Maharashtra', 'Urban', '470'),
  ('DLR012', 'Vadodara Velocity Vadodara', 'West', 'Vadodara', 'Gujarat', 'Tier-2', '340'),
  ('DLR013', 'Tech Auto Bengaluru', 'South', 'Bengaluru', 'Karnataka', 'Metro', '540'),
  ('DLR014', 'Coral Cars Chennai', 'South', 'Chennai', 'Tamil Nadu', 'Metro', '560'),
  ('DLR015', 'Cyber Motors Hyderabad', 'South', 'Hyderabad', 'Telangana', 'Metro', '520'),
  ('DLR016', 'Spice Route Auto Kochi', 'South', 'Kochi', 'Kerala', 'Tier-2', '360'),
  ('DLR017', 'Mysuru Wheels Mysuru', 'South', 'Mysuru', 'Karnataka', 'Tier-2', '380'),
  ('DLR018', 'Coimbatore Drive Coimbatore', 'South', 'Coimbatore', 'Tamil Nadu', 'Tier-2', '340'),
  ('DLR019', 'Eastern Mobility Kolkata', 'East', 'Kolkata', 'West Bengal', 'Metro', '540'),
  ('DLR020', 'Riverfront Motors Bhubaneswar', 'East', 'Bhubaneswar', 'Odisha', 'Tier-2', '380'),
  ('DLR021', 'Tea Garden Auto Guwahati', 'East', 'Guwahati', 'Assam', 'Tier-2', '340'),
  ('DLR022', 'Patna Prime Cars Patna', 'East', 'Patna', 'Bihar', 'Urban', '450'),
  ('DLR023', 'Ranchi Roadsters Ranchi', 'East', 'Ranchi', 'Jharkhand', 'Tier-2', '380'),
  ('DLR024', 'Siliguri Wheels Siliguri', 'East', 'Siliguri', 'West Bengal', 'Tier-2', '340'),
  ('DLR025', 'Lakeview Motors Lucknow', 'North', 'Lucknow', 'Uttar Pradesh', 'Urban', '450'),
  ('DLR026', 'Gateway Auto Nashik', 'West', 'Nashik', 'Maharashtra', 'Tier-2', '380'),
  ('DLR027', 'Pearl Drive Madurai', 'South', 'Madurai', 'Tamil Nadu', 'Tier-2', '340'),
  ('DLR028', 'Sunrise Motors Durgapur', 'East', 'Durgapur', 'West Bengal', 'Tier-2', '360'),
  ('DLR029', 'Aravali Auto Jodhpur', 'North', 'Jodhpur', 'Rajasthan', 'Tier-2', '380'),
  ('DLR030', 'Western Trails Rajkot', 'West', 'Rajkot', 'Gujarat', 'Tier-2', '340')
ON CONFLICT (dealer_id) DO UPDATE SET dealer_name = EXCLUDED.dealer_name, region = EXCLUDED.region, city = EXCLUDED.city, state = EXCLUDED.state, dealer_type = EXCLUDED.dealer_type, sales_capacity_per_month = EXCLUDED.sales_capacity_per_month;

COMMIT;
