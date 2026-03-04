DO $$
DECLARE
  last_id integer := 0;
  max_id  integer;
BEGIN
  SELECT coalesce(max(id), 0) INTO max_id FROM orders;
  WHILE last_id < max_id LOOP
    UPDATE orders SET total_amount = price
     WHERE id > last_id AND id <= last_id + 10000 AND total_amount IS NULL;
    last_id := last_id + 10000;
    COMMIT;
  END LOOP;
END $$;
