PYTHON ?= /opt/homebrew/opt/python@3.14/bin/python3.14

.PHONY: test lint typecheck format check clean

test:
	$(PYTHON) -m pytest -v

lint:
	$(PYTHON) -m ruff check .

format:
	$(PYTHON) -m ruff format .

typecheck:
	$(PYTHON) -m mypy ingestguard

check: lint typecheck test

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache __pycache__ ingestguard/__pycache__ tests/__pycache__ *.db
