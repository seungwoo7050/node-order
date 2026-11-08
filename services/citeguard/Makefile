PYTHON ?= /opt/homebrew/opt/python@3.14/bin/python3.14

.PHONY: test lint typecheck format check docker-up docker-init clean

test:
	$(PYTHON) -m pytest -v tests/

lint:
	$(PYTHON) -m ruff check citeguard tests

format:
	$(PYTHON) -m ruff format citeguard tests

typecheck:
	$(PYTHON) -m mypy citeguard tests

check: lint typecheck test

docker-up:
	docker compose up -d

docker-init:
	bash scripts/init_ollama.sh

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache __pycache__ citeguard/__pycache__ tests/__pycache__ build dist *.egg-info *.db
