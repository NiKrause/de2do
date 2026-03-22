import { createPublicClient, encodeFunctionData, http, keccak256, parseUnits, toBytes, zeroAddress } from 'viem';
import { todoEscrowAbi } from './escrowAbi.js';
import { getAppChain, getEscrowAddress, getRpcUrl, getUsdtAddress } from '../chain/config.js';
import { getPasskeySmartAccountClient, sendPasskeyBundlerCall } from '../wallet/passkey-wallet.js';

/** Plain `eth_sendTransaction` receipt (Anvil EIP-7702 delegated path). */
function isFailedTxStatus(status) {
  return status === 'reverted' || status === 0n || status === 0;
}

function isSuccessTxStatus(status) {
  return status === 'success' || status === 1n || status === 1;
}

/**
 * Ensures lock/release/refund actually succeeded on-chain.
 * Viem resolves `waitForTransactionReceipt` even when a tx reverts; without this check the UI could
 * still mark escrow "released" while no ETH moved.
 *
 * @param {{ receipt?: unknown }} txResult - return value of `sendPasskeyBundlerCall`
 * @param {string} label
 */
function assertPasskeyEscrowTxSuccess(txResult, label) {
  const top = txResult?.receipt;
  if (!top || typeof top !== 'object') {
    throw new Error(`${label}: missing transaction receipt`);
  }

  // UserOperation receipt shape from `waitForUserOperationReceipt`
  if ('success' in top && typeof top.success === 'boolean') {
    if (!top.success) {
      throw new Error(`${label}: user operation failed (success=false)`);
    }
    const inner = top.receipt;
    if (inner && isFailedTxStatus(inner.status)) {
      throw new Error(`${label}: bundled transaction reverted`);
    }
    return;
  }

  // Plain transaction receipt
  if (!('status' in top)) {
    throw new Error(`${label}: unrecognized receipt shape`);
  }
  const status = /** @type {{ status: unknown }} */ (top).status;
  if (isFailedTxStatus(status)) {
    throw new Error(`${label}: transaction reverted`);
  }
  if (!isSuccessTxStatus(status)) {
    throw new Error(`${label}: unexpected receipt status ${String(status)}`);
  }
}

const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
];

function buildTodoId(todoKey) {
  return keccak256(toBytes(String(todoKey)));
}

function resolvePayout(estimatedCosts) {
  if (estimatedCosts?.usd) {
    const usdtAddress = getUsdtAddress();
    if (!usdtAddress) throw new Error('VITE_USDT_ADDRESS is not configured');
    return {
      token: usdtAddress,
      amount: parseUnits(String(estimatedCosts.usd), 6),
      currency: 'usd'
    };
  }
  if (estimatedCosts?.eth) {
    return {
      token: zeroAddress,
      amount: parseUnits(String(estimatedCosts.eth), 18),
      currency: 'eth'
    };
  }
  throw new Error('No payout amount found (usd or eth required)');
}

async function sendEscrowCall({ creatorAddress, calls }) {
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) throw new Error('VITE_ESCROW_CONTRACT is not configured');

  const smartAccountClient = await getPasskeySmartAccountClient(creatorAddress);
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) throw new Error('VITE_RPC_URL is not configured');

  const publicClient = createPublicClient({
    chain: getAppChain(),
    transport: http(rpcUrl)
  });
  return await sendPasskeyBundlerCall({ smartAccountClient, publicClient, calls });
}

export async function lockEscrowForTodo({
  todoKey,
  estimatedCosts,
  beneficiary,
  creatorAddress,
  deadline
}) {
  if (!beneficiary) throw new Error('Beneficiary wallet address is required');
  const todoId = buildTodoId(todoKey);
  const payout = resolvePayout(estimatedCosts);

  const deadlineValue = deadline ? BigInt(deadline) : 0n;
  const lockCallData = payout.token === zeroAddress
    ? encodeFunctionData({
        abi: todoEscrowAbi,
        functionName: 'lockEth',
        args: [todoId, beneficiary, deadlineValue]
      })
    : encodeFunctionData({
        abi: todoEscrowAbi,
        functionName: 'lockToken',
        args: [todoId, payout.token, payout.amount, beneficiary, deadlineValue]
      });

  const calls = [];
  if (payout.token === zeroAddress) {
    calls.push({
      to: getEscrowAddress(),
      value: payout.amount,
      data: lockCallData
    });
  } else {
    const approveData = encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [getEscrowAddress(), payout.amount]
    });
    calls.push({ to: payout.token, value: 0n, data: approveData });
    calls.push({ to: getEscrowAddress(), value: 0n, data: lockCallData });
  }

  const txResult = await sendEscrowCall({ creatorAddress, calls });
  assertPasskeyEscrowTxSuccess(txResult, 'Lock escrow');

  return {
    todoId,
    payout,
    deadline: deadlineValue,
    txHash: txResult.hash,
    receipt: txResult.receipt
  };
}

export async function releaseEscrowForTodo({ todoKey, creatorAddress }) {
  const todoId = buildTodoId(todoKey);
  const callData = encodeFunctionData({
    abi: todoEscrowAbi,
    functionName: 'release',
    args: [todoId]
  });
  const txResult = await sendEscrowCall({
    creatorAddress,
    calls: [{ to: getEscrowAddress(), value: 0n, data: callData }]
  });
  assertPasskeyEscrowTxSuccess(txResult, 'Release escrow');
  return { todoId, txHash: txResult.hash, receipt: txResult.receipt };
}

export async function refundEscrowForTodo({ todoKey, creatorAddress }) {
  const todoId = buildTodoId(todoKey);
  const callData = encodeFunctionData({
    abi: todoEscrowAbi,
    functionName: 'refund',
    args: [todoId]
  });
  const txResult = await sendEscrowCall({
    creatorAddress,
    calls: [{ to: getEscrowAddress(), value: 0n, data: callData }]
  });
  assertPasskeyEscrowTxSuccess(txResult, 'Refund escrow');
  return { todoId, txHash: txResult.hash, receipt: txResult.receipt };
}
