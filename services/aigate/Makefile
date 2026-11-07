.PHONY: all build test race vet clean

all: build test

build:
	go build -v ./...

test:
	go test -v ./...

race:
	go test -v -race ./...

vet:
	go vet ./...

clean:
	rm -rf bin
