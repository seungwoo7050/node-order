WITH root AS (
  INSERT INTO categories (name, parent_id) VALUES ('대량', NULL) RETURNING id
), l1 AS (
  INSERT INTO categories (name, parent_id) SELECT '대량-' || i, root.id FROM root, generate_series(1, 5) AS i RETURNING id, name
), l2 AS (
  INSERT INTO categories (name, parent_id) SELECT l1.name || '-' || i, l1.id FROM l1, generate_series(1, 5) AS i RETURNING id, name
)
INSERT INTO categories (name, parent_id) SELECT l2.name || '-' || i, l2.id FROM l2, generate_series(1, 5) AS i;
SELECT count(*) AS categories FROM categories;