<script>
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import { currentIdentityStore } from '$lib/stores.js';
	import { showToast } from '$lib/toast-store.js';
	import { createPublicClient, http } from 'viem';
	import { getStoredCredentialInfo } from '@le-space/orbitdb-ui';
	import {
		getIdentityProfile,
		setWalletAddressForCurrentIdentity,
		setIdentityProfile
	} from '$lib/identity/profile.js';
	import {
		consolidatePasskeyCredentials,
		createPasskeySmartAccount,
		createPasskeyWalletCredential,
		getPasskeyWalletCredentialSource,
		importWalletCredentialFromIdentityPasskey
	} from '$lib/wallet/passkey-wallet.js';
	import {
		fundLocalAnvilSmartAccount,
		getAccountEthBalance,
		getEscrowContractEthBalance,
		getRecentAccountTransactions,
		probePasskeySmartAccountDeployed
	} from '$lib/wallet/account-insights.js';
	import { formatEtherFullDecimals } from '$lib/wallet/format-eth-display.js';
	import {
		getAddressExplorerLink,
		getAppChain,
		getBundlerUrl,
		getEntryPointAddress,
		getEscrowAddress,
		getImplementationAddress,
		getLocalDevFunderPrivateKey,
		getPaymasterUrl,
		getRpcUrl,
		isPaymasterEnabled
	} from '$lib/chain/config.js';

	/**
	 * @typedef {{
	 *   hash: string,
	 *   blockNumber: bigint | number | null,
	 *   timestamp: number,
	 *   from: string | null,
	 *   to: string | null,
	 *   value: bigint,
	 *   direction: string,
	 *   escrowGrossWei?: bigint,
	 *   escrowFeeWei?: bigint
	 * }} RecentTransaction
	 */

	let walletAddress = '';
	let hasCredential = false;
	let loading = false;
	/** @type {string[]} */
	let missingConfig = [];
	/** @type {string[]} */
	let missingEscrowConfig = [];
	/** @type {string[]} */
	let missingOptionalConfig = [];
	let creatingSmartAccount = false;
	let smartAccountAddress = '';
	/** @type {boolean | null} */
	let smartAccountDeployed = null;

	$: smartAccountExplorerLink = smartAccountAddress
		? getAddressExplorerLink(smartAccountAddress)
		: null;
	/** @type {Record<string, unknown> | null} */
	let smartAccountDebug = null;
	let smartAccountWarningVisible = false;
	/** @type {string | null} */
	let identityPasskeyMode = null;
	/** @type {string | null} */
	let walletPasskeySource = null;
	/** @type {boolean | null} */
	let entryPointReady = null;
	/** @type {boolean | null} */
	let implementationReady = null;
	let aaAddressMismatch = false;
	/** @type {bigint | null} */
	let smartAccountBalance = null;
	/** @type {bigint | null} */
	let escrowContractBalance = null;
	/** @type {RecentTransaction[]} */
	let recentTransactions = [];
	let loadingAccountInsights = false;
	let fundingLocalAccount = false;
	let localFunderConfigured = false;
	let currentDidPreview = 'unknown';

	/** @param {unknown} error */
	function getErrorMessage(error) {
		return error instanceof Error ? error.message : String(error);
	}

	/** @param {unknown} value */
	function stringifyDebug(value) {
		return JSON.stringify(
			value,
			(_key, currentValue) =>
				typeof currentValue === 'bigint' ? currentValue.toString() : currentValue,
			2
		);
	}

	/** @param {unknown} unixSeconds */
	function formatTimestamp(unixSeconds) {
		return new Date(Number(unixSeconds) * 1000).toLocaleString();
	}

	/** @param {string | null | undefined} value */
	function shortenHash(value, left = 10, right = 8) {
		if (!value || value.length <= left + right) return value || '';
		return `${value.slice(0, left)}...${value.slice(-right)}`;
	}

	/**
	 * @param {string} label
	 * @param {string | null | undefined} addr
	 */
	function formatAddrLine(label, addr) {
		const a = addr && String(addr).trim() ? String(addr).trim() : '—';
		return `${label}: ${a}`;
	}

	async function refreshSmartAccountInsights(address = smartAccountAddress) {
		const rpcUrlProbe = getRpcUrl();
		if (!address || !rpcUrlProbe) return;
		const addressHex = /** @type {`0x${string}`} */ (address);

		try {
			loadingAccountInsights = true;
			const [balance, transactions, escrowBal] = await Promise.all([
				getAccountEthBalance(addressHex),
				getRecentAccountTransactions(addressHex),
				getEscrowContractEthBalance()
			]);
			smartAccountBalance = balance;
			recentTransactions = transactions;
			escrowContractBalance = escrowBal;

			try {
				const { deployed } = await probePasskeySmartAccountDeployed(addressHex, { transactions });
				smartAccountDeployed = deployed;
				const profile = (await getIdentityProfile()) || {};
				if (profile.passkeySmartAccountAddress?.toLowerCase() === addressHex.toLowerCase()) {
					await setIdentityProfile({
						...profile,
						passkeySmartAccountDeployed: deployed
					});
				}
			} catch (probeErr) {
				console.warn('Smart-account deployment probe failed:', probeErr);
			}
		} catch (error) {
			console.warn('Failed to refresh smart-account insights:', error);
		} finally {
			loadingAccountInsights = false;
		}
	}

	const loadProfile = async () => {
		try {
			const profile = await getIdentityProfile();
			walletAddress = profile?.walletAddress || '';
			smartAccountAddress = profile?.passkeySmartAccountAddress || '';
			smartAccountDeployed = profile?.passkeySmartAccountDeployed ?? null;
			/** @type {any} */
			const currentIdentity = get(currentIdentityStore);
			currentDidPreview = String(currentIdentity?.id || 'unknown').slice(0, 18);
			if (profile?.passkeySmartAccountAddress) {
				await refreshSmartAccountInsights(profile.passkeySmartAccountAddress);
			}
		} catch (error) {
			console.warn('Failed to load identity profile:', error);
		}
	};

	onMount(async () => {
		await loadProfile();
		const storedIdentityCredential = getStoredCredentialInfo();
		identityPasskeyMode = storedIdentityCredential?.authMode || null;
		const { walletCredential } = await consolidatePasskeyCredentials();
		hasCredential = Boolean(walletCredential);
		walletPasskeySource = getPasskeyWalletCredentialSource();
		missingConfig = /** @type {string[]} */ (
			[
				!getRpcUrl() && 'VITE_RPC_URL',
				!getBundlerUrl() && 'VITE_BUNDLER_URL',
				!getEntryPointAddress() && 'VITE_ENTRY_POINT_ADDRESS',
				!getImplementationAddress() && 'VITE_IMPLEMENTATION_CONTRACT'
			].filter(Boolean)
		);
		missingEscrowConfig = /** @type {string[]} */ (
			[!getEscrowAddress() && 'VITE_ESCROW_CONTRACT'].filter(Boolean)
		);
		missingOptionalConfig = isPaymasterEnabled()
			? /** @type {string[]} */ ([!getPaymasterUrl() && 'VITE_PAYMASTER_URL'].filter(Boolean))
			: [];
		localFunderConfigured = Boolean(getLocalDevFunderPrivateKey());

		const entryPointAddress = getEntryPointAddress();
		const implementationAddress = getImplementationAddress();
		aaAddressMismatch = Boolean(
			entryPointAddress &&
				implementationAddress &&
				entryPointAddress.toLowerCase() === implementationAddress.toLowerCase()
		);

		if (!entryPointAddress || !implementationAddress || aaAddressMismatch) {
			entryPointReady = null;
			implementationReady = null;
			return;
		}

		try {
			const rpcUrl = getRpcUrl();
			if (!rpcUrl) return;
			const entryPointHex = /** @type {`0x${string}`} */ (entryPointAddress);
			const implementationHex = /** @type {`0x${string}`} */ (implementationAddress);
			const publicClient = createPublicClient({
				chain: getAppChain(),
				transport: http(rpcUrl)
			});
			const [entryCode, implementationCode] = await Promise.all([
				publicClient.getBytecode({ address: entryPointHex }),
				publicClient.getBytecode({ address: implementationHex })
			]);
			entryPointReady = Boolean(entryCode && entryCode !== '0x');
			implementationReady = Boolean(implementationCode && implementationCode !== '0x');
		} catch (error) {
			console.warn('Failed to verify AA contract deployment status:', error);
			entryPointReady = null;
			implementationReady = null;
		}
	});

	async function handleSave() {
		if (!walletAddress || !walletAddress.startsWith('0x')) {
			showToast('Enter a valid 0x wallet address', 'warning', 2500);
			return;
		}
		try {
			await setWalletAddressForCurrentIdentity(walletAddress.trim());
			showToast('✅ Wallet address saved to profile', 'success', 2000);
		} catch (error) {
			console.error(error);
			showToast(`❌ Failed to save wallet address: ${getErrorMessage(error)}`, 'error', 3000);
		}
	}

	async function handleCreatePasskey() {
		try {
			loading = true;
			const imported = importWalletCredentialFromIdentityPasskey();
			if (imported) {
				const { walletCredential } = await consolidatePasskeyCredentials();
				hasCredential = Boolean(walletCredential);
				walletPasskeySource = getPasskeyWalletCredentialSource();
				showToast('✅ Reused identity passkey for wallet signing', 'success', 2500);
				return;
			}
			if (!walletAddress || !walletAddress.startsWith('0x')) {
				showToast(
					'Enter a valid 0x wallet address before creating a wallet passkey',
					'warning',
					2500
				);
				return;
			}
			const credential = await createPasskeyWalletCredential(walletAddress.trim());
			const existing = (await getIdentityProfile()) || {};
			await setIdentityProfile({
				...existing,
				walletAddress: walletAddress.trim(),
				passkeyCredentialId: credential.id,
				passkeyPublicKey: { x: credential.x, y: credential.y }
			});
			await consolidatePasskeyCredentials();
			hasCredential = true;
			walletPasskeySource = getPasskeyWalletCredentialSource();
			showToast('✅ Passkey wallet credential created', 'success', 2000);
		} catch (error) {
			console.error(error);
			showToast(`❌ Failed to create passkey: ${getErrorMessage(error)}`, 'error', 3000);
		} finally {
			loading = false;
		}
	}

	async function handleCreateSmartAccount() {
		if (missingConfig.length > 0) {
			showToast(`Missing config: ${missingConfig.join(', ')}`, 'warning', 3000);
			return;
		}
		if (!smartAccountWarningVisible) {
			showToast('Please confirm the smart account warning before continuing', 'warning', 2500);
			return;
		}

		try {
			creatingSmartAccount = true;
			const {
				address,
				credential,
				smartAccountClient,
				signedAuthorization,
				userOperationHash,
				userOperation,
				receipt
			} = await createPasskeySmartAccount();
			const accountAddress = smartAccountClient.account?.address || address;
			smartAccountAddress = accountAddress;
			walletAddress = accountAddress;
			// Direct EIP-7702 bootstrap returns a normal tx receipt (no UserOp). Any chain: true.
			const direct7702Bootstrap = !userOperation && Boolean(receipt?.transactionHash);

			let deployed = null;
			const rpcUrl = getRpcUrl();
			if (rpcUrl) {
				const probe = await probePasskeySmartAccountDeployed(
					/** @type {`0x${string}`} */ (accountAddress),
					{ transactions: [] }
				);
				deployed = probe.deployed;
				if (deployed === false && direct7702Bootstrap) {
					deployed = null;
				}
				smartAccountDeployed = deployed;
			}

			const existing = (await getIdentityProfile()) || {};
			await setIdentityProfile({
				...existing,
				walletAddress: accountAddress,
				passkeyCredentialId: credential.id,
				passkeyPublicKey: { x: credential.x, y: credential.y },
				passkeySmartAccountAddress: accountAddress,
				passkeySmartAccountDeployed: deployed
			});

			smartAccountDebug = {
				address: accountAddress,
				userOperationHash,
				userOperation,
				signedAuthorization,
				receipt
			};
			await refreshSmartAccountInsights(accountAddress);

			hasCredential = true;
			if (deployed === false) {
				showToast('⚠️ Passkey smart account is not deployed on-chain yet', 'warning', 3500);
			} else if (direct7702Bootstrap && deployed == null) {
				showToast('✅ EIP-7702 bootstrap transaction succeeded', 'success', 2500);
			} else {
				showToast('✅ Passkey smart account ready', 'success', 2000);
			}
		} catch (error) {
			console.error(error);
			showToast(`❌ Failed to create smart account: ${getErrorMessage(error)}`, 'error', 3000);
		} finally {
			creatingSmartAccount = false;
		}
	}

	async function handleFundLocalAccount() {
		if (!smartAccountAddress) {
			showToast('Create a smart account first', 'warning', 2500);
			return;
		}

		try {
			fundingLocalAccount = true;
			const addressHex = /** @type {`0x${string}`} */ (smartAccountAddress);
			const { hash } = await fundLocalAnvilSmartAccount(addressHex, '2');
			// Toast before refresh so E2E / Playwright --debug don’t wait on block scans + getLogs.
			showToast(`✅ Funded smart account (tx ${shortenHash(hash)})`, 'success', 3000);
			await refreshSmartAccountInsights(smartAccountAddress);
		} catch (error) {
			console.error(error);
			showToast(`❌ Failed to fund local account: ${getErrorMessage(error)}`, 'error', 3500);
		} finally {
			fundingLocalAccount = false;
		}
	}
</script>

<div
	class="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
	data-testid="wallet-profile"
>
	<div class="mb-2 text-sm font-semibold text-gray-700">Passkey Wallet Profile</div>
	<div class="text-xs text-gray-500">
		Link your DID to a wallet address and wallet passkey used for escrow payouts. Creating a smart
		account will generate a new address. If available, we reuse your existing identity passkey.
	</div>
	{#if identityPasskeyMode}
		<div class="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
			Identity passkey detected ({identityPasskeyMode} mode) for DID login. Wallet passkey is separate
			and used for smart-account signing.
		</div>
	{/if}
	<div class="mt-2 text-xs text-gray-600">
		Wallet passkey status:
		{#if hasCredential}
			{#if walletPasskeySource === 'identity'}
				using identity passkey
			{:else if walletPasskeySource === 'dedicated'}
				dedicated wallet passkey
			{:else}
				configured (legacy source)
			{/if}
		{:else}
			not configured
		{/if}
	</div>
	{#if !hasCredential && identityPasskeyMode === 'worker'}
		<div class="mt-1 text-xs text-amber-700">
			Worker identity passkeys secure your DID keystore (ed25519) and usually cannot be reused as
			wallet signing keys. Create Wallet Passkey once to enable smart-account actions.
		</div>
	{/if}
	{#if missingConfig.length > 0}
		<div
			class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
		>
			Missing smart-account config: {missingConfig.join(', ')}.
		</div>
	{/if}
	{#if aaAddressMismatch}
		<div class="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
			`VITE_ENTRY_POINT_ADDRESS` and `VITE_IMPLEMENTATION_CONTRACT` must be different addresses.
		</div>
	{/if}
	{#if entryPointReady === false}
		<div class="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
			EntryPoint is not deployed at <code class="rounded bg-red-100 px-1">{getEntryPointAddress() ?? '—'}</code> on the
			current chain. Set <code class="rounded bg-red-100 px-1">VITE_ENTRY_POINT_ADDRESS</code> and rebuild if wrong.
		</div>
	{/if}
	{#if implementationReady === false}
		<div class="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
			Implementation contract is not deployed at <code class="rounded bg-red-100 px-1">{getImplementationAddress() ?? '—'}</code> on the
			current chain. Run <code class="rounded bg-red-100 px-1">setup-local-aa</code> with the same env file you use for
			<code class="rounded bg-red-100 px-1">build:test</code> (e.g. <code class="rounded bg-red-100 px-1">.env.test</code>), then rebuild.
		</div>
	{/if}
	{#if missingEscrowConfig.length > 0}
		<div
			class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
		>
			Missing escrow config: {missingEscrowConfig.join(', ')}.
		</div>
	{/if}
	{#if missingOptionalConfig.length > 0}
		<div
			class="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
		>
			Optional config missing: {missingOptionalConfig.join(', ')} (paymaster is optional, but recommended).
		</div>
	{/if}
	<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
		<input
			type="text"
			name="walletAddress"
			data-testid="wallet-address-input"
			autocomplete="off"
			bind:value={walletAddress}
			placeholder="0x..."
			class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
		/>
		<button
			type="button"
			on:click={handleSave}
			class="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
		>
			Save
		</button>
		<button
			type="button"
			data-testid="wallet-create-passkey"
			on:click={handleCreatePasskey}
			disabled={loading}
			class="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
		>
			{hasCredential
				? 'Update Wallet Passkey'
				: identityPasskeyMode === 'worker'
					? 'Create Wallet Passkey (Required)'
					: 'Create Wallet Passkey'}
		</button>
		<button
			type="button"
			data-testid="wallet-create-smart-account"
			on:click={handleCreateSmartAccount}
			disabled={creatingSmartAccount || !smartAccountWarningVisible || missingConfig.length > 0}
			class="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
		>
			{creatingSmartAccount ? 'Creating...' : 'Create Passkey Smart Account'}
		</button>
	</div>
	<div class="mt-2 flex items-center gap-2 text-xs text-amber-800">
		<input
			id="smart-account-warning"
			type="checkbox"
			data-testid="wallet-smart-account-warning"
			bind:checked={smartAccountWarningVisible}
			class="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
		/>
		<label for="smart-account-warning">
			I understand this will generate a new smart account address and override the wallet address
			field.
		</label>
	</div>
	{#if smartAccountAddress}
		<div
			class="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
			data-testid="wallet-smart-account-summary"
		>
			Smart account: <span data-testid="wallet-smart-account-address">{smartAccountAddress}</span>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- external https:// block explorer only -->
			{#if smartAccountExplorerLink}
				<a
					href={smartAccountExplorerLink.url}
					target="_blank"
					rel="noopener noreferrer"
					class="ml-1.5 inline-flex items-baseline gap-0.5 text-emerald-800 underline decoration-emerald-600/50 underline-offset-2 hover:text-emerald-950"
					title="Open address on {smartAccountExplorerLink.name}"
					data-testid="wallet-smart-account-explorer"
				>
					<span class="whitespace-nowrap">{smartAccountExplorerLink.name}</span>
					<span class="text-[10px] leading-none opacity-80" aria-hidden="true">↗</span>
					<span class="sr-only"> (opens in new tab)</span>
				</a>
			{/if}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{#if smartAccountDeployed === true}
				(on-chain: passkey account active)
			{:else if smartAccountDeployed === false}
				(not initialized on-chain yet)
			{:else}
				(could not confirm — try Refresh after a few seconds)
			{/if}
		</div>
		<div
			class="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
		>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div>
						Balance (native ETH at this address):
						{#if smartAccountBalance != null}
							{formatEtherFullDecimals(smartAccountBalance)} ETH
						{:else}
							unknown
						{/if}
					</div>
					<p class="mt-1 max-w-prose text-[11px] leading-snug text-slate-600">
						This is not your “net worth” across escrow. After <strong>Lock funds</strong>, ETH
						leaves this address and sits in the <strong>TodoEscrow</strong> contract until
						<strong>Confirm &amp; Pay</strong> (release) or refund. As beneficiary, your balance here
						rises on release, not when Alice locks.
					</p>
					{#if getEscrowAddress() && escrowContractBalance != null}
						<div
							class="mt-1.5 font-mono text-[11px] text-slate-800"
							data-testid="wallet-escrow-contract-balance"
						>
							TodoEscrow contract (network total):
							{formatEtherFullDecimals(escrowContractBalance)} ETH
						</div>
					{/if}
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						data-testid="wallet-refresh-balance-txs"
						on:click={() => refreshSmartAccountInsights()}
						disabled={loadingAccountInsights}
						class="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{loadingAccountInsights ? 'Refreshing...' : 'Refresh balance + txs'}
					</button>
					{#if getAppChain().id === 31337 && localFunderConfigured}
						<button
							type="button"
							data-testid="wallet-fund-anvil"
							on:click={handleFundLocalAccount}
							disabled={fundingLocalAccount}
							class="rounded-md border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs text-emerald-900 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
						>
							{fundingLocalAccount ? 'Funding...' : 'Fund 2 ETH (Anvil #2)'}
						</button>
					{/if}
				</div>
			</div>
			{#if getAppChain().id === 31337 && !localFunderConfigured}
				<div class="mt-2 text-slate-500">
					Local fund button is disabled until `VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY` is configured.
				</div>
			{/if}
			<div class="mt-3" data-testid="wallet-recent-transactions-section">
				<div class="font-semibold text-slate-700">Latest transactions</div>
				{#if recentTransactions.length === 0}
					<div class="mt-1 text-slate-500" data-testid="wallet-recent-tx-empty">
						No recent transactions found in the scanned local block range.
					</div>
				{:else}
					<div class="mt-2 space-y-2">
						{#each recentTransactions as tx (tx.hash + String(tx.direction))}
							<div
								class="rounded border border-slate-200 bg-white px-2 py-2"
								data-testid="wallet-recent-tx-row"
								title={tx.hash}
							>
								<div class="font-mono text-[11px] text-slate-900">
									Tx {shortenHash(tx.hash, 14, 10)}
								</div>
								<div
									class="mt-1 space-y-0.5 font-mono text-[10px] leading-snug break-all text-slate-800"
								>
									<div>{formatAddrLine('From', tx.from)}</div>
									<div>{formatAddrLine('To (target)', tx.to)}</div>
								</div>
								<div class="mt-1 text-slate-600">
									{tx.direction} | block {tx.blockNumber?.toString?.() || tx.blockNumber}
								</div>
								<div class="mt-0.5 font-mono text-[11px] text-slate-900">
									Value: {formatEtherFullDecimals(tx.value)} ETH
								</div>
								{#if tx.escrowFeeWei != null && tx.escrowGrossWei != null && tx.escrowFeeWei > 0n}
									<div
										class="mt-1 max-w-prose font-mono text-[10px] leading-snug text-slate-600"
										data-testid="wallet-recent-tx-escrow-fee-breakdown"
									>
										Escrow gross {formatEtherFullDecimals(tx.escrowGrossWei)} ETH · protocol fee
										{formatEtherFullDecimals(tx.escrowFeeWei)} ETH (net above is what you received)
									</div>
								{/if}
								<div class="text-slate-500">{formatTimestamp(tx.timestamp)}</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if smartAccountDebug}
		<details
			class="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
		>
			<summary class="cursor-pointer font-semibold">Debug: EIP-7702 init payload</summary>
			<pre
				class="mt-2 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{stringifyDebug(
					smartAccountDebug
				)}</pre>
		</details>
	{/if}
	<div class="mt-2 text-xs text-gray-500">
		Current DID: {currentDidPreview}...
	</div>
</div>
