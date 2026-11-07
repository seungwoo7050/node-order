.PHONY: all build test race vet clean

all: vet test build

build:
	go build -v -o bin/idemguard ./cmd/idemguard

test:
	go test -v ./...

race:
	go test -v -race ./...

vet:
	go vet ./...

clean:
	rm -rf bin/
