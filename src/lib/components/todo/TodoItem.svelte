<script>
	import { createEventDispatcher } from 'svelte';
	import { formatPeerId } from '../../utils.js';
	import { FolderPlus, Edit2, X } from 'lucide-svelte';
	import {
		lockEscrowForTodo,
		releaseEscrowForTodo,
		refundEscrowForTodo
	} from '$lib/escrow/escrowClient.js';
	import { getIdentityProfile } from '$lib/identity/profile.js';
	import { showToast } from '$lib/toast-store.js';
	import { hasPasskeyWalletCredential } from '$lib/wallet/passkey-wallet.js';
	import {
		getBundlerUrl,
		getEntryPointAddress,
		getEscrowAddress,
		getRpcUrl
	} from '$lib/chain/config.js';
	import { formatEthNumberFullDecimals } from '$lib/wallet/format-eth-display.js';
	import AddTodoForm from './AddTodoForm.svelte';
	import { updateTodo } from '../../db-actions.js';
	import { currentIdentityStore } from '../../stores.js';

	export let text;
	export let description = '';
	export let priority = null;
	export let completed = false;
	export let assignee = null;
	export let createdBy;
	export let createdByIdentity = null;
	export let delegation = null;
	export let todoKey;
	export let estimatedTime = null;
	export let estimatedCosts = {};
	export let escrow = null;
	export let allowEdit = true;
	export let delegationEnabled = true;

	let isEditing = false;

	const dispatch = createEventDispatcher();

	function handleToggleComplete() {
		dispatch('toggleComplete', { key: todoKey });
	}

	function handleDelete() {
		dispatch('delete', { key: todoKey });
	}

	function handleCreateSubList() {
		dispatch('createSubList', { text, key: todoKey });
	}

	function handleRevokeDelegation() {
		dispatch('revokeDelegation', { key: todoKey });
	}

	function startEdit() {
		isEditing = true;
	}

	function cancelEdit() {
		isEditing = false;
	}

	function toDateTimeLocal(value) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const pad = (n) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
			date.getHours()
		)}:${pad(date.getMinutes())}`;
	}

	async function saveEdit(event) {
		const {
			text: nextText,
			description: nextDescription,
			priority: nextPriority,
			estimatedTime: nextEstimatedTime,
			estimatedCosts: nextEstimatedCosts,
			delegateDid,
			delegateWalletAddress,
			delegationExpiresAt
		} = event.detail || {};
		if (!nextText || !nextText.trim()) {
			return;
		}

		const updates = {
			text: nextText.trim(),
			description: (nextDescription || '').trim(),
			priority: nextPriority || null,
			estimatedTime: nextEstimatedTime ? parseFloat(nextEstimatedTime) : null,
			estimatedCosts:
				nextEstimatedCosts && Object.keys(nextEstimatedCosts).length > 0 ? nextEstimatedCosts : {}
		};
		if (isOwner && delegationEnabled) {
			if (delegateDid && delegateDid.trim()) {
				const normalizedDelegateDid = delegateDid.trim();
				const grantedAt =
					delegation?.delegateDid === normalizedDelegateDid && delegation?.grantedAt
						? delegation.grantedAt
						: new Date().toISOString();
				updates.delegation = {
					delegateDid: normalizedDelegateDid,
					grantedBy: currentIdentityId || createdByIdentity || createdBy || null,
					grantedAt,
					expiresAt: delegationExpiresAt ? new Date(delegationExpiresAt).toISOString() : null,
					delegateWalletAddress: delegateWalletAddress
						? delegateWalletAddress.trim()
						: delegation?.delegateWalletAddress || null,
					revokedAt: null
				};
			}
		}

		const success = await updateTodo(todoKey, updates);
		if (success) {
			isEditing = false;
			// Props will be updated automatically when loadTodos() refreshes the data
		}
	}

	async function handleLockEscrow() {
		try {
			if (!delegation?.delegateWalletAddress) {
				showToast('Set a delegate wallet address before locking funds', 'warning', 2500);
				return;
			}
			const profile = await getIdentityProfile();
			const creatorAddress = profile?.walletAddress;
			if (!creatorAddress) {
				showToast('Save your wallet address in the Passkey Wallet Profile first', 'warning', 3000);
				return;
			}
			const deadlineSeconds = delegation?.expiresAt
				? Math.floor(Date.parse(delegation.expiresAt) / 1000)
				: 0;
			const result = await lockEscrowForTodo({
				todoKey,
				estimatedCosts,
				beneficiary: delegation.delegateWalletAddress,
				creatorAddress,
				deadline: deadlineSeconds
			});
			await updateTodo(todoKey, {
				escrow: {
					status: 'locked',
					todoId: result.todoId,
					txHash: result.txHash,
					token: result.payout.token,
					amount: result.payout.amount.toString(),
					currency: result.payout.currency,
					beneficiary: delegation.delegateWalletAddress,
					deadline: result.deadline ? result.deadline.toString() : null
				}
			});
			showToast('✅ Escrow locked', 'success', 2000);
		} catch (error) {
			console.error(error);
			showToast('❌ Failed to lock escrow: ' + error.message, 'error', 3500);
		}
	}

	async function handleReleaseEscrow() {
		try {
			const profile = await getIdentityProfile();
			const creatorAddress = profile?.walletAddress;
			if (!creatorAddress) {
				showToast('Save your wallet address in the Passkey Wallet Profile first', 'warning', 3000);
				return;
			}
			const result = await releaseEscrowForTodo({ todoKey, creatorAddress });
			await updateTodo(todoKey, {
				escrow: {
					...(escrow || {}),
					status: 'released',
					releaseTxHash: result.txHash
				}
			});
			showToast('✅ Escrow released', 'success', 2000);
		} catch (error) {
			console.error(error);
			showToast('❌ Failed to release escrow: ' + error.message, 'error', 3500);
		}
	}

	async function handleRefundEscrow() {
		try {
			const profile = await getIdentityProfile();
			const creatorAddress = profile?.walletAddress;
			if (!creatorAddress) {
				showToast('Save your wallet address in the Passkey Wallet Profile first', 'warning', 3000);
				return;
			}
			const result = await refundEscrowForTodo({ todoKey, creatorAddress });
			await updateTodo(todoKey, {
				escrow: {
					...(escrow || {}),
					status: 'refunded',
					refundTxHash: result.txHash
				}
			});
			showToast('✅ Escrow refunded', 'success', 2000);
		} catch (error) {
			console.error(error);
			showToast('❌ Failed to refund escrow: ' + error.message, 'error', 3500);
		}
	}

	function getPriorityColor(priority) {
		if (priority === 'A') return 'bg-red-100 text-red-800 border-red-300';
		if (priority === 'B') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
		if (priority === 'C') return 'bg-green-100 text-green-800 border-green-300';
		return '';
	}

	function hasActiveDelegationFor(identityId) {
		if (!delegation?.delegateDid || !identityId) return false;
		if (delegation.revokedAt) return false;
		if (delegation.expiresAt && Date.parse(delegation.expiresAt) < Date.now()) return false;
		return delegation.delegateDid === identityId;
	}

	$: payoutConfigured = Boolean(estimatedCosts?.usd || estimatedCosts?.eth);
	$: escrowStatus = escrow?.status || null;
	$: escrowDeadline = escrow?.deadline ? Number(escrow.deadline) : 0;
	$: deadlinePassed = escrowDeadline > 0 && Date.now() / 1000 > escrowDeadline;
	// Re-run when identity changes (config getters read env; comma ties to reactive store)
	$: escrowConfigOk =
		($currentIdentityStore,
		Boolean(getRpcUrl() && getBundlerUrl() && getEntryPointAddress() && getEscrowAddress()));
	$: hasPasskeyCredential = ($currentIdentityStore, hasPasskeyWalletCredential());
	$: lockEnabled =
		isOwner &&
		payoutConfigured &&
		delegation?.delegateWalletAddress &&
		!escrowStatus &&
		escrowConfigOk &&
		hasPasskeyCredential;
	$: releaseEnabled =
		isOwner &&
		payoutConfigured &&
		completed &&
		escrowStatus === 'locked' &&
		escrowConfigOk &&
		hasPasskeyCredential;
	$: refundEnabled =
		isOwner &&
		escrowStatus === 'locked' &&
		deadlinePassed &&
		escrowConfigOk &&
		hasPasskeyCredential;
	$: currentIdentityId = $currentIdentityStore?.id || null;
	$: isOwner = Boolean(
		currentIdentityId && createdByIdentity && currentIdentityId === createdByIdentity
	);
	$: canToggleComplete =
		allowEdit && (isOwner || hasActiveDelegationFor(currentIdentityId) || !createdByIdentity);
	$: delegationIsActive = Boolean(hasActiveDelegationFor(delegation?.delegateDid || null));
	$: canEditDelegation = Boolean(isOwner && delegationEnabled);
	/** After payout or refund, revoking delegation is misleading; match post-release UI (no Revoke). */
	$: canRevokeDelegationUi =
		isOwner &&
		delegation?.delegateDid &&
		!delegation.revokedAt &&
		escrowStatus !== 'released' &&
		escrowStatus !== 'refunded';
</script>

<div
	class="rounded-md border border-gray-200 p-4 transition-colors hover:bg-gray-50"
	data-testid="todo-item"
	data-todo-key={todoKey}
	data-escrow-todo-id={escrow?.todoId || ''}
>
	{#if isEditing}
		<!-- Edit Mode -->
		<div>
			<AddTodoForm
				mode="edit"
				showTitle={false}
				placeholder="Edit todo..."
				initialText={text}
				initialDescription={description || ''}
				initialPriority={priority || ''}
				initialEstimatedTime={estimatedTime}
				initialEstimatedCosts={estimatedCosts || {}}
				initialDelegateDid={delegation?.delegateDid || ''}
				initialDelegationExpiresAt={toDateTimeLocal(delegation?.expiresAt)}
				initialDelegateWalletAddress={delegation?.delegateWalletAddress || ''}
				delegationEnabled={canEditDelegation}
				on:save={saveEdit}
			/>
			<div class="flex gap-2">
				<button
					on:click={cancelEdit}
					class="flex items-center gap-1 rounded-md bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300"
				>
					<X class="h-4 w-4" />
					Cancel
				</button>
			</div>
		</div>
	{:else}
		<!-- View Mode -->
		<div class="flex items-start gap-3">
			<input
				type="checkbox"
				data-testid="todo-complete-checkbox"
				checked={completed}
				on:change={handleToggleComplete}
				disabled={!canToggleComplete}
				class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
			/>
			<div class="min-w-0 flex-1">
				<div class="mb-1 flex items-start gap-2">
					<span
						data-testid="todo-text"
						data-todo-text={text}
						class={completed
							? 'flex-1 text-gray-500 line-through'
							: 'flex-1 font-medium text-gray-800'}
					>
						{text}
					</span>
					{#if priority}
						<span
							class="rounded border px-2 py-1 text-xs font-semibold {getPriorityColor(priority)}"
						>
							{priority}
						</span>
					{/if}
					{#if description}
						<p class="mt-1 mb-2 text-sm text-gray-600">{description}</p>
					{/if}
					<div class="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
						{#if estimatedTime}
							<span>⏱️ {estimatedTime}h</span>
						{/if}
						{#if estimatedCosts}
							{#if estimatedCosts.usd}
								<span>💰 ${estimatedCosts.usd.toFixed(2)} USD</span>
							{:else if estimatedCosts.eth}
								<span>💰 {formatEthNumberFullDecimals(estimatedCosts.eth)} ETH</span>
							{:else if estimatedCosts.btc}
								<span>💰 {estimatedCosts.btc.toFixed(8)} BTC</span>
							{/if}
						{/if}
						{#if assignee}
							<span
								>Assigned to: <code class="rounded bg-gray-100 px-1">{formatPeerId(assignee)}</code
								></span
							>
						{:else}
							<span class="text-orange-600">Unassigned</span>
						{/if}
						<span
							>Created by: <code class="rounded bg-gray-100 px-1">{formatPeerId(createdBy)}</code
							></span
						>
						{#if delegation?.delegateDid}
							<span>
								Delegated to:
								<code class="rounded bg-blue-100 px-1">{delegation.delegateDid}</code>
								{#if delegation.expiresAt}
									(until {new Date(delegation.expiresAt).toLocaleString()})
								{/if}
								{#if delegation.revokedAt}
									<span class="text-red-600"> revoked</span>
								{:else if delegationIsActive}
									<span class="text-green-600"> active</span>
								{/if}
							</span>
						{/if}
						{#if delegation?.delegateWalletAddress}
							<span>
								Wallet: <code class="rounded bg-green-100 px-1"
									>{delegation.delegateWalletAddress}</code
								>
							</span>
						{/if}
						{#if escrowStatus}
							<span class="text-indigo-600">Escrow: {escrowStatus}</span>
						{/if}
						{#if escrowStatus === 'locked' && escrow?.txHash}
							<span class="block w-full min-w-0 text-xs text-slate-600">
								Lock tx:
								<code
									data-testid="todo-lock-tx-hash"
									class="font-mono text-[10px] break-all text-slate-800">{escrow.txHash}</code
								>
							</span>
						{/if}
						{#if escrowStatus === 'released' && escrow?.releaseTxHash}
							<span class="block w-full min-w-0 text-xs text-slate-600">
								Release tx:
								<code
									data-testid="todo-release-tx-hash"
									class="font-mono text-[10px] break-all text-slate-800"
									>{escrow.releaseTxHash}</code
								>
							</span>
						{/if}
						{#if escrowDeadline}
							<span class={deadlinePassed ? 'text-red-600' : 'text-gray-500'}>
								Escrow deadline: {new Date(escrowDeadline * 1000).toLocaleString()}
							</span>
						{/if}
					</div>
				</div>
				<div class="flex gap-2">
					{#if allowEdit}
						<button
							on:click={startEdit}
							class="flex min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation items-center gap-1 rounded-md px-3 py-2 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100"
							title="Edit todo"
						>
							<Edit2 class="h-4 w-4" />
							<span class="hidden sm:inline">Edit</span>
						</button>
					{/if}
					<button
						on:click={handleCreateSubList}
						class="flex min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation items-center gap-1 rounded-md px-3 py-2 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100"
						title="Create sub-list from this todo"
					>
						<FolderPlus class="h-4 w-4" />
						<span class="hidden sm:inline">Sub-list</span>
					</button>
					{#if allowEdit}
						<button
							on:click={handleDelete}
							class="min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation rounded-md px-3 py-2 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 active:bg-red-100"
						>
							Delete
						</button>
						{#if isOwner && payoutConfigured && delegation?.delegateWalletAddress && !escrowStatus}
							<button
								data-testid="todo-lock-funds"
								on:click={handleLockEscrow}
								disabled={!lockEnabled}
								title={lockEnabled
									? 'Lock funds in escrow'
									: 'Missing escrow config or passkey credential'}
								class="min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation rounded-md px-3 py-2 text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 active:bg-emerald-100"
							>
								Lock Funds
							</button>
						{/if}
						{#if isOwner && payoutConfigured && completed && escrowStatus === 'locked'}
							<button
								data-testid="todo-confirm-pay"
								on:click={handleReleaseEscrow}
								disabled={!releaseEnabled}
								title={releaseEnabled
									? 'Release payout to delegate'
									: 'Missing escrow config or passkey credential'}
								class="min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation rounded-md px-3 py-2 text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-800 active:bg-indigo-100"
							>
								Confirm & Pay
							</button>
						{/if}
						{#if isOwner && escrowStatus === 'locked' && deadlinePassed}
							<button
								on:click={handleRefundEscrow}
								disabled={!refundEnabled}
								title={refundEnabled
									? 'Refund escrow to creator'
									: 'Missing escrow config or passkey credential'}
								class="min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation rounded-md px-3 py-2 text-orange-700 transition-colors hover:bg-orange-50 hover:text-orange-800 active:bg-orange-100"
							>
								Refund
							</button>
						{/if}
						{#if canRevokeDelegationUi}
							<button
								on:click={handleRevokeDelegation}
								class="min-h-[44px] min-w-[44px] cursor-pointer touch-manipulation rounded-md px-3 py-2 text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800 active:bg-amber-100"
							>
								Revoke
							</button>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
