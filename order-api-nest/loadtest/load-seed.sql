INSERT INTO products (name, price, stock)
SELECT '부하용 상품 ' || i, 1000, 1000000 FROM generate_series(1, 50) AS i;
UPDATE products SET stock = 1000000 WHERE id = 5;
SELECT count(*) AS products, sum(stock) AS total_stock FROM products;
