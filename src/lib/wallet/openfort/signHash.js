import { hashMessage, recoverAddress } from 'viem';

export async function getHashAndSig(account) {
	const message = 'Hello OPF7702';

	if (!account.signMessage) {
		throw new Error('Account does not support signing messages');
	}

	const signatureInit = await account.signMessage({ message });
	const messageHash = hashMessage(message);

	await recoverAddress({
		hash: messageHash,
		signature: signatureInit
	});

	return { messageHash, signatureInit };
}
