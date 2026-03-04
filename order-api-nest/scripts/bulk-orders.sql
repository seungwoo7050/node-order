WITH inserted AS (
  INSERT INTO orders (user_id, total_amount, paid, created_at)
  SELECT (ARRAY['kim', 'lee', 'park', 'choi'])[1 + i % 4],
         (ARRAY[150000, 30000, 90000, 40000])[1 + i % 4],
         i % 10 <> 0,
         now() - interval '2 years' + i * interval '210 seconds'
  FROM generate_series(1, 300000) AS i
  RETURNING id, total_amount
)
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT inserted.id, p.id, 1, inserted.total_amount
FROM inserted JOIN products p ON p.price = inserted.total_amount AND p.id BETWEEN 5 AND 8;

ANALYZE orders;
ANALYZE order_items;
SELECT user_id, count(*) AS orders FROM orders GROUP BY user_id ORDER BY user_id;
