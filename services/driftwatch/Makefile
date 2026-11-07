PYTHON ?= /opt/homebrew/opt/python@3.14/bin/python3.14

.PHONY: test lint typecheck check clean

test:
	$(PYTHON) -m pytest -v tests/

lint:
	$(PYTHON) -m ruff check driftwatch tests

format:
	$(PYTHON) -m ruff format driftwatch tests

typecheck:
	$(PYTHON) -m mypy driftwatch tests

check: lint typecheck test

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache build dist *.egg-info
