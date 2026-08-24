<script lang="ts">
	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();
</script>

<svg
	class={className}
	viewBox="0 0 60 30"
	width="20"
	height="14"
	aria-hidden="true"
	focusable="false"
>
	<rect width="60" height="30" fill="#fff" />
	<rect width="60" height="15" y="15" fill="#d7141a" />
	<path d="M0,0 30,15 0,30 Z" fill="#11457e" />
</svg>
