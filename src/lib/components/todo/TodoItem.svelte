<script>
import { createEventDispatcher } from 'svelte';
import { formatPeerId } from '../../utils.js';
import { FolderPlus, Edit2, Save, X } from 'lucide-svelte';
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
	export let allowEdit = true;

	let isEditing = false;
	let editText = text;
	let editDescription = description || '';
	let editPriority = priority || '';
	let editEstimatedTime = estimatedTime ? String(estimatedTime) : '';

	// Determine current cost and currency from estimatedCosts
	let editCost = '';
	let editCostCurrency = 'usd';

	// Update editCost and editCostCurrency from props, but only when not editing
	$: if (!isEditing && estimatedCosts) {
		if (estimatedCosts.usd) {
			editCost = String(estimatedCosts.usd);
			editCostCurrency = 'usd';
		} else if (estimatedCosts.eth) {
			editCost = String(estimatedCosts.eth);
			editCostCurrency = 'eth';
		} else if (estimatedCosts.btc) {
			editCost = String(estimatedCosts.btc);
			editCostCurrency = 'btc';
		} else {
			editCost = '';
			editCostCurrency = 'usd';
		}
	} else if (!isEditing) {
		editCost = '';
		editCostCurrency = 'usd';
	}

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
		editText = text;
		editDescription = description || '';
		editPriority = priority || '';
		editEstimatedTime = estimatedTime ? String(estimatedTime) : '';
		// editCost and editCostCurrency are set by reactive statement
	}

	function cancelEdit() {
		isEditing = false;
	}

	async function saveEdit() {
		if (!editText.trim()) {
			return;
		}

		const estimatedCosts = {};
		if (editCost) {
			const costValue = parseFloat(editCost) || 0;
			if (costValue > 0) {
				estimatedCosts[editCostCurrency] = costValue;
			}
		}

		const updates = {
			text: editText.trim(),
			description: editDescription.trim(),
			priority: editPriority || null,
			estimatedTime: editEstimatedTime ? parseFloat(editEstimatedTime) : null,
			estimatedCosts: Object.keys(estimatedCosts).length > 0 ? estimatedCosts : {}
		};

		const success = await updateTodo(todoKey, updates);
		if (success) {
			isEditing = false;
			// Props will be updated automatically when loadTodos() refreshes the data
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

	$: currentIdentityId = $currentIdentityStore?.id || null;
	$: isOwner = Boolean(currentIdentityId && createdByIdentity && currentIdentityId === createdByIdentity);
	$: canToggleComplete =
		allowEdit && (isOwner || hasActiveDelegationFor(currentIdentityId) || !createdByIdentity);
	$: delegationIsActive = Boolean(hasActiveDelegationFor(delegation?.delegateDid || null));
</script>

<div class="rounded-md border border-gray-200 p-4 transition-colors hover:bg-gray-50">
	{#if isEditing}
		<!-- Edit Mode -->
		<div class="space-y-4">
			<div>
				<label for="edit-title-{todoKey}" class="mb-1 block text-sm font-medium text-gray-700"
					>Title</label
				>
				<input
					id="edit-title-{todoKey}"
					type="text"
					bind:value={editText}
					class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
				/>
			</div>
			<div>
				<label for="edit-description-{todoKey}" class="mb-1 block text-sm font-medium text-gray-700"
					>Description</label
				>
				<textarea
					id="edit-description-{todoKey}"
					bind:value={editDescription}
					rows="3"
					class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
				></textarea>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="edit-priority-{todoKey}" class="mb-1 block text-sm font-medium text-gray-700"
						>Priority</label
					>
					<select
						id="edit-priority-{todoKey}"
						bind:value={editPriority}
						class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
					>
						<option value="">None</option>
						<option value="A">A (High)</option>
						<option value="B">B (Medium)</option>
						<option value="C">C (Low)</option>
					</select>
				</div>
				<div>
					<label for="edit-time-{todoKey}" class="mb-1 block text-sm font-medium text-gray-700"
						>Estimated Time (hours)</label
					>
					<input
						id="edit-time-{todoKey}"
						type="number"
						bind:value={editEstimatedTime}
						placeholder="e.g., 2.5"
						min="0"
						step="0.1"
						class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
					/>
				</div>
			</div>
			<div>
				<label for="edit-cost-{todoKey}" class="mb-2 block text-sm font-medium text-gray-700"
					>Estimated Cost</label
				>
				<div class="flex gap-2">
					<input
						id="edit-cost-{todoKey}"
						type="number"
						bind:value={editCost}
						placeholder="0.00"
						min="0"
						step="0.01"
						class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
					/>
					<select
						id="edit-cost-currency-{todoKey}"
						bind:value={editCostCurrency}
						class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
					>
						<option value="usd">USD ($)</option>
						<option value="eth">ETH</option>
						<option value="btc">BTC</option>
					</select>
				</div>
			</div>
			<div class="flex gap-2">
				<button
					on:click={saveEdit}
					class="flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
				>
					<Save class="h-4 w-4" />
					Save
				</button>
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
				</div>
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
							<span>💰 {estimatedCosts.eth.toFixed(4)} ETH</span>
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
					{#if isOwner && delegation?.delegateDid && !delegation.revokedAt}
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
	{/if}
</div>
