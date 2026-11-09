GOCACHE ?= /tmp/go-build

.PHONY: all build test race clean

all: build

build:
	GOCACHE=$(GOCACHE) go build -v ./cmd/rolltrace

test:
	GOCACHE=$(GOCACHE) go test -v ./...

race:
	GOCACHE=$(GOCACHE) go test -v -race ./...

clean:
	rm -f rolltrace
