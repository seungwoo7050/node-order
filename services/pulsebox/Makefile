PYTHON ?= /opt/homebrew/opt/python@3.14/bin/python3.14

.PHONY: test lint typecheck fmt clean

test:
	$(PYTHON) -m pytest -v

lint:
	$(PYTHON) -m ruff check pulsebox tests

typecheck:
	$(PYTHON) -m mypy pulsebox tests

fmt:
	$(PYTHON) -m ruff format pulsebox tests

clean:
	rm -rf build dist *.egg-info .pytest_cache .mypy_cache .ruff_cache
