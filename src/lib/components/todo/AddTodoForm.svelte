<script>
	import { createEventDispatcher } from 'svelte';
	import { Save } from 'lucide-svelte';

	export let mode = 'add'; // add | edit
	export let title = '';
	export let showTitle = true;
	export let placeholder = 'What needs to be done?';
	export let buttonText = '';
	export let disabled = false;
	export let delegationEnabled = true;
	export let initialText = '';
	export let initialDescription = '';
	export let initialPriority = '';
	export let initialEstimatedTime = '';
	export let initialEstimatedCosts = {};
	export let initialDelegateDid = '';
	export let initialDelegationExpiresAt = '';

	let inputText = initialText || '';
	let description = initialDescription || '';
	let priority = initialPriority || '';
	let estimatedTime = initialEstimatedTime ? String(initialEstimatedTime) : '';
	let estimatedCost = '';
	let estimatedCostCurrency = 'usd';
	let delegateDid = initialDelegateDid || '';
	let delegationExpiresAt = initialDelegationExpiresAt || '';
	let showAdvanced = mode === 'edit';

	const dispatch = createEventDispatcher();
	$: resolvedButtonText = buttonText || (mode === 'edit' ? 'Save' : 'Add');
	$: resolvedTitle = title || (mode === 'edit' ? 'Edit TODO' : 'Add New TODO');

	// Initialize currency + value from existing estimatedCosts.
	if (initialEstimatedCosts?.usd) {
		estimatedCost = String(initialEstimatedCosts.usd);
		estimatedCostCurrency = 'usd';
	} else if (initialEstimatedCosts?.eth) {
		estimatedCost = String(initialEstimatedCosts.eth);
		estimatedCostCurrency = 'eth';
	} else if (initialEstimatedCosts?.btc) {
		estimatedCost = String(initialEstimatedCosts.btc);
		estimatedCostCurrency = 'btc';
	}

	function handleSubmit() {
		if (!inputText || inputText.trim() === '') return;

		const estimatedCosts = {};
		if (estimatedCost) {
			const costValue = parseFloat(estimatedCost) || 0;
			if (costValue > 0) {
				estimatedCosts[estimatedCostCurrency] = costValue;
			}
		}

		const payload = {
			text: inputText.trim(),
			description: description.trim(),
			priority: priority || null,
			estimatedTime: estimatedTime ? parseFloat(estimatedTime) : null,
			estimatedCosts: Object.keys(estimatedCosts).length > 0 ? estimatedCosts : {},
			delegateDid: delegationEnabled ? delegateDid.trim() || null : null,
			delegationExpiresAt: delegationEnabled ? delegationExpiresAt || null : null
		};
		dispatch(mode === 'edit' ? 'save' : 'add', payload);
		dispatch('submit', payload);

		if (mode === 'add') {
			// Reset form after add only.
			inputText = '';
			description = '';
			priority = '';
			estimatedTime = '';
			estimatedCost = '';
			estimatedCostCurrency = 'usd';
			delegateDid = '';
			delegationExpiresAt = '';
			showAdvanced = false;
		}
	}

	function handleKeydown(event) {
		if (event.key === 'Enter' && !event.shiftKey && !showAdvanced) {
			event.preventDefault();
			handleSubmit();
		}
	}
</script>

<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
	{#if showTitle}
		<h2 class="mb-4 text-xl font-semibold">{resolvedTitle}</h2>
	{/if}
	<div class="space-y-4">
		<div>
			<input
				type="text"
				bind:value={inputText}
				{placeholder}
				{disabled}
				data-testid="todo-input"
				class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
				on:keydown={handleKeydown}
			/>
		</div>

		<button
			type="button"
			on:click={() => (showAdvanced = !showAdvanced)}
			class="text-sm text-blue-600 underline hover:text-blue-800"
		>
			{showAdvanced ? 'Hide' : 'Show'} Advanced Fields
		</button>

		{#if showAdvanced}
			<div class="space-y-4 rounded-md border border-gray-200 bg-gray-50 p-4">
				<div>
					<label for="add-todo-description" class="mb-1 block text-sm font-medium text-gray-700">
						Description
					</label>
					<textarea
						id="add-todo-description"
						bind:value={description}
						{disabled}
						placeholder="Add a detailed description..."
						rows="3"
						class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
					></textarea>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="add-todo-priority" class="mb-1 block text-sm font-medium text-gray-700">
							Priority
						</label>
						<select
							id="add-todo-priority"
							bind:value={priority}
							{disabled}
							class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						>
							<option value="">None</option>
							<option value="A">A (High)</option>
							<option value="B">B (Medium)</option>
							<option value="C">C (Low)</option>
						</select>
					</div>

					<div>
						<label for="add-todo-time" class="mb-1 block text-sm font-medium text-gray-700">
							Estimated Time (hours)
						</label>
						<input
							id="add-todo-time"
							type="number"
							bind:value={estimatedTime}
							{disabled}
							placeholder="e.g., 2.5"
							min="0"
							step="0.1"
							class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						/>
					</div>
				</div>

				<div>
					<label for="add-todo-cost" class="mb-2 block text-sm font-medium text-gray-700">
						Estimated Cost
					</label>
					<div class="flex gap-2">
						<input
							id="add-todo-cost"
							type="number"
							bind:value={estimatedCost}
							{disabled}
							placeholder="0.00"
							min="0"
							step="0.01"
							class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						/>
						<select
							id="add-todo-cost-currency"
							bind:value={estimatedCostCurrency}
							{disabled}
							class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						>
							<option value="usd">USD ($)</option>
							<option value="eth">ETH</option>
							<option value="btc">BTC</option>
						</select>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="add-todo-delegate-did" class="mb-1 block text-sm font-medium text-gray-700">
							Delegate DID
						</label>
						<input
							id="add-todo-delegate-did"
							type="text"
							bind:value={delegateDid}
							disabled={disabled || !delegationEnabled}
							placeholder="did:key:..."
							class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						/>
					</div>

					<div>
						<label
							for="add-todo-delegation-expiry"
							class="mb-1 block text-sm font-medium text-gray-700"
						>
							Delegation Expires At
						</label>
						<input
							id="add-todo-delegation-expiry"
							type="datetime-local"
							bind:value={delegationExpiresAt}
							disabled={disabled || !delegationEnabled}
							class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						/>
					</div>
				</div>
				{#if !delegationEnabled}
					<p class="text-xs text-amber-700">
						Delegation is disabled for this list because it uses legacy access control.
					</p>
				{/if}
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleSubmit}
				{disabled}
				data-testid="add-todo-button"
				class="flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
			>
				<Save class="h-4 w-4" />
				{resolvedButtonText}
			</button>
		</div>
	</div>
</div>
