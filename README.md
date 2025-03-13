# Burn

Burn is a Solana-based on-chain trading platform that leverages an improved “Super Curve” mechanism, eliminating reliance on liquidity providers (LPs) and ensuring continuous, non-removable liquidity.

## Program Deployments

| Program         | Mainnet                                       | Devnet                                        |
| --------------- | --------------------------------------------- | --------------------------------------------- |
| Fee Distributor | `burnfZzJfuR8b8yMRGgZfLAq7P2eCuMdRgGooQjPjua` | `burnfZzJfuR8b8yMRGgZfLAq7P2eCuMdRgGooQjPjua` |
| Hooks           | `burnhzSCeNMFuTsQJRC8dc1EPffWAecnYk8CxxRuQzT` | `burnhzSCeNMFuTsQJRC8dc1EPffWAecnYk8CxxRuQzT` |
| Burn            | `burnpzY5Sy2j4ZyQmjdQbBFiJW9T99GxDykASG2QrMu` | `burnpzY5Sy2j4ZyQmjdQbBFiJW9T99GxDykASG2QrMu` |

## Pre-requisites

1. Install the Rust
2. Install the Solana CLI tools
3. Install the Anchor CLI tools

You can find more information on how to install these tools at the following location: [Installation](https://www.anchor-lang.com/docs/installation)

## Build

Clone the repository and run the following commands:

```bash
$ cd contracts
$ yarn install
$ anchor keys sync
$ anchor build
```

## Test

```bash
$ anchor test
```

## Deploy on Devnet

### Deploy program

```bash
$ anchor deploy --provider.cluster Devnet -p fee_distributor
$ anchor deploy --provider.cluster Devnet -p hooks
$ anchor deploy --provider.cluster Devnet -p burn
```

### Initialize Fee Distributor

```bash
$ anchor run deploy-fee-distributor --provider.cluster Devnet -- devnet
$ cat deployments/fee-distributor-devnet.json
```

### Initialize Burn

```bash
$ anchor run deploy-burn --provider.cluster Devnet -- devnet
$ cat deployments/devnet.json
```

### Initialize market

```bash
$ yarn run initialize-market
```

## License

Burn is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full license text.
