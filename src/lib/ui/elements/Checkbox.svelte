<script lang="ts">
	interface Props {
		checked?: boolean;
		disabled?: boolean;
		label: string;
		class?: string;
		onchange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		disabled = false,
		label,
		class: className = '',
		onchange
	}: Props = $props();

	const uid = $props.id();
	const inputId = `checkbox-${uid}`;

	function handleChange(event: Event): void {
		checked = (event.currentTarget as HTMLInputElement).checked;
		onchange?.(checked);
	}
</script>

<label class="checkbox {className}" for={inputId} class:checkbox--disabled={disabled}>
	<input
		id={inputId}
		type="checkbox"
		class="checkbox__input"
		bind:checked
		{disabled}
		onchange={handleChange}
	/>
	<span class="checkbox__box" class:checkbox__box--checked={checked} aria-hidden="true">
		{#if checked}
			<svg class="checkbox__check" viewBox="0 0 16 16" fill="none">
				<path
					d="M3.5 8.5L6.5 11.5L12.5 4.5"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
	</span>
	<span class="checkbox__label">{label}</span>
</label>

<style>
	.checkbox {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		cursor: pointer;
	}

	.checkbox--disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.checkbox__input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.checkbox__box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		border: 1px solid var(--divider);
		border-radius: 4px;
		background-color: var(--field);
		color: var(--ink-on-accent);
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.checkbox:not(.checkbox--disabled):hover .checkbox__box {
		background-color: rgb(from var(--field) r g b / calc(alpha + 0.03));
	}

	.checkbox:not(.checkbox--disabled):active .checkbox__box {
		background-color: rgb(from var(--field) r g b / calc(alpha + 0.06));
	}

	.checkbox__box--checked {
		background-color: var(--accent);
		border-color: var(--accent);
	}

	.checkbox:not(.checkbox--disabled):hover .checkbox__box--checked {
		background-color: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.checkbox:not(.checkbox--disabled):active .checkbox__box--checked {
		background-color: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.checkbox__input:focus-visible + .checkbox__box {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	.checkbox__check {
		width: 12px;
		height: 12px;
	}

	.checkbox__label {
		font-size: 0.875rem;
		line-height: 1.4;
		color: var(--text);
	}
</style>
