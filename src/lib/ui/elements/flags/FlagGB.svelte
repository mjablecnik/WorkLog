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
	<clipPath id="flag-gb-clip">
		<rect width="60" height="30" />
	</clipPath>
	<g clip-path="url(#flag-gb-clip)">
		<rect width="60" height="30" fill="#00247d" />
		<path d="M0,0 60,30 M60,0 0,30" stroke="#fff" stroke-width="6" />
		<path d="M0,0 60,30 M60,0 0,30" stroke="#cf142b" stroke-width="2" />
		<path d="M30,0 30,30 M0,15 60,15" stroke="#fff" stroke-width="10" />
		<path d="M30,0 30,30 M0,15 60,15" stroke="#cf142b" stroke-width="6" />
	</g>
</svg>
