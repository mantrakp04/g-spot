# Benchmarks

MemoryBench wrapper for the local g-spot memory architecture.

## Setup

```sh
cd packages/benchmarks/memorybench
bun install
```

## Run

Set `OPENROUTER_API_KEY` in your shell, then from the repo root:

```sh
bun run --filter @g-spot/benchmarks bench:smoke
```

The wrapper defaults to:

- provider: `gspot`
- benchmark: `locomo`
- judge/answering model: `openrouter-deepseek-v4-pro`
- OpenRouter model id: `deepseek/deepseek-v4-pro`
- OpenRouter provider routing: unset by default; OpenRouter chooses the provider
