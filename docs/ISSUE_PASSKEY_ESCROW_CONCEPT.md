# Passkey Wallet Escrow Integration (Concept)

## Goal
Enable todo-linked escrow payouts on Ethereum using passkey wallets:
- Alice locks ETH or USDT for a delegated todo.
- Bob completes the todo (off-chain in OrbitDB).
- Alice confirms; funds are released to Bob.
- No on-chain transaction required when Bob completes (libp2p-only).
 - Optional refund if deadline passes.

## Scope
- Escrow contract (ETH + ERC20)
- Optional deadline + refund
- Front-end integration to lock + release based on todo state
- Passkey wallet signing (EIP-7702/Openfort-style smart account)
- DID -> wallet address profile storage in OrbitDB registry DB

## Proposed Flow
1. **Profile setup**
   - Store wallet address inside the identity registry DB under `profile`.
   - Create a passkey credential for the wallet (WebAuthn P-256).

2. **Todo creation**
   - Alice creates todo with estimated cost (USD or ETH) and delegates to Bob.
   - Alice adds Bob’s wallet address in the delegation metadata.

3. **Escrow lock**
   - Alice triggers `lockEth` or `lockToken` for the todo.
   - Store escrow metadata on the todo (`status: locked`, `txHash`, `token`, `amount`).
   - Optionally store a `deadline` for refunds.

4. **Bob completion (off-chain)**
   - Bob toggles completion in OrbitDB (delegation action).

5. **Alice confirmation (on-chain)**
   - Alice presses “Confirm & Pay”.
   - Escrow `release(todoId)` sends payout to Bob.
   - If the deadline passes, Alice can use `refund(todoId)`.

## Contract
- `contracts/TodoEscrow.sol`
- Stores `Escrow { creator, beneficiary, token, amount, released, refunded, deadline }` by `todoId`.
- No WebAuthn verification on-chain; relies on passkey smart account to call `release`.

## Front-End
- `WalletProfile` panel to set wallet address + create passkey credential.
- `WalletProfile` includes "Create Passkey Smart Account" flow (bind passkey + verify config).
- `TodoItem` adds actions:
  - `Lock Funds` (owner + delegate wallet + cost)
  - `Confirm & Pay` (owner + completed + escrow locked)
  - `Refund` (owner + escrow locked + deadline passed)

## Notes / Risks
- USDT requires approval before `lockToken`.
- Requires bundler + entry point + deployed smart account contract.
- Requires `VITE_IMPLEMENTATION_CONTRACT` for EIP-7702 initialization.
- RP ID must match for passkey use across UI flows.

## Open Questions
- Which smart account implementation will be used on mainnet?
- Paymaster strategy for gasless UX?
- Should we auto-set the deadline from the todo form?
