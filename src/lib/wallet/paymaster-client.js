import { deepHexlify } from './openfort/utils.js';

export function createPaymasterClient({ paymasterUrl, entryPointAddress }) {
  if (!paymasterUrl) return undefined;

  async function sponsorUserOperation(args) {
    const userOperation = args?.userOperation ?? args;
    const response = await fetch(paymasterUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'pm_sponsorUserOperation',
        params: [deepHexlify(userOperation), entryPointAddress, null]
      })
    });
    const data = await response.json().catch(() => null);
    if (data?.error) {
      throw new Error(data.error?.message || JSON.stringify(data.error) || 'Paymaster error');
    }
    if (!response.ok) {
      throw new Error(`Paymaster HTTP ${response.status}`);
    }
    return data.result;
  }

  return {
    // Viem uses stub data during gas estimation. For the local mock paymaster,
    // the sponsor RPC already returns the paymaster fields we need, so we can
    // reuse it for both estimation and final submission.
    async getPaymasterStubData(args) {
      return sponsorUserOperation(args);
    },

    async getPaymasterData(args) {
      return sponsorUserOperation(args);
    }
  };
}
