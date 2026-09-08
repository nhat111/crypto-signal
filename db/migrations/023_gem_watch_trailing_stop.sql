-- Alert when a winner gives its gains back.
--
-- The existing triggers both measure from a fixed point: the stop-loss from
-- the entry price, the take-profit from the entry price. That leaves a
-- round trip inside those two bounds completely silent. A token bought at
-- 100, running to 140 and sliding back to 100 never reaches the
-- take-profit (150) and never reaches the stop-loss (75), so nothing is
-- ever sent — the whole 40% gain is handed back without one alert.
--
-- A trailing stop measures from the highest price seen since entry, which
-- is the only reference that moves with the position, so it needs that
-- high stored per watch rather than recomputed: the worker samples prices
-- every 15 minutes and keeps no history of what it saw, so a peak not
-- written down is gone.

ALTER TABLE gem_watches
  ADD COLUMN IF NOT EXISTS trailing_stop_pct DOUBLE PRECISION,
  -- How far up the position must have been before the trailing stop
  -- applies at all. Without it the peak starts at the entry price and the
  -- trailing stop is simply a second stop-loss, firing on the same dump and
  -- reporting one event twice.
  ADD COLUMN IF NOT EXISTS trailing_arm_pct DOUBLE PRECISION,
  -- The highest price observed since the watch was armed. Seeded to the
  -- entry price rather than left null: before the position has ever been
  -- up, "the best it has done" IS the entry, and a null here would make
  -- every consumer invent that rule for itself.
  ADD COLUMN IF NOT EXISTS peak_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ;

-- Existing watches keep working, with their peak starting where they
-- entered. The pair of defaults is chosen together: armed at +25% with a
-- 20% trailing distance, the earliest possible trigger is 20% below a peak
-- of 125, which is the entry price itself. So a position that was properly
-- up cannot slide all the way back to a loss without an alert.
--
-- Worth stating because it is the mistake this pairing was built to avoid:
-- a giveback is smaller than the gain that produced it. Running to +40% and
-- returning to breakeven is a 28.6% fall from the peak, so a trailing
-- distance of 30% would sleep through it.
UPDATE gem_watches
   SET peak_price = entry_price,
       trailing_stop_pct = 20,
       trailing_arm_pct = 25
 WHERE peak_price IS NULL;
