<script lang="ts">
	/**
	 * The `KPI_Row`'s third card meter — a `--h-meter` (4 px) track filled to `percent`
	 * (Requirement 12.2: "the described share of `Tracked_Time` as a percentage over a
	 * meter"; design.md's `Statistics` section: "podíl popsaného (percentage plus a 4 px
	 * meter)"). Composed inside `KpiRow`, and available standalone wherever else a
	 * single ratio needs a bar rather than a chart (design.md's component table: "one
	 * ratio reads better as a figure with a bar than as a chart").
	 *
	 * Renders as an inline `<svg>` with `<rect>` presentation attributes rather than a
	 * CSS-percentage width. The production CSP (`style-src 'self' 'nonce-…'`, no
	 * `unsafe-inline` — `svelte.config.js`) forbids an inline `style=` attribute
	 * outright, and a continuous 0-100 value is not one of the small closed sets
	 * design.md's "Applying Tokens Without Inline Styles" reserves a precompiled class
	 * for (project colour's eight slots, the block-height ladder). SVG geometry
	 * attributes are unaffected by the CSP ("§3: SVG is unaffected"), so the fill is a
	 * `<rect width="{percent}%">` inside a `viewBox="0 0 100 4"` — a percentage width
	 * against a 100-wide viewBox resolves to exactly the percentage itself, no inline
	 * style involved.
	 *
	 * `.meter-fill`'s width transition is the exact class `theme.css`'s
	 * `prefers-reduced-motion` block already targets ("`.meter-fill`, `.bar-fill` —
	 * width transitions removed"), so reduced motion is handled for free and this
	 * component repeats none of that media query itself.
	 *
	 * Decorative: the percentage this meter draws is always printed as text beside it
	 * by the caller (Requirement 12.13 — every chart's numbers also appear as text), so
	 * the SVG itself carries no accessible name and is hidden from assistive tech
	 * rather than duplicating that text as an `aria-label`.
	 */
	interface Props {
		/** 0-100. Values outside the range are clamped rather than overflowing the track. */
		percent: number;
		class?: string;
	}

	let { percent, class: className = '' }: Props = $props();

	const clamped = $derived(Math.max(0, Math.min(100, percent)));
</script>

<svg
	class="meter {className}"
	viewBox="0 0 100 4"
	preserveAspectRatio="none"
	role="presentation"
	aria-hidden="true"
>
	<rect class="meter-track" x="0" y="0" width="100" height="4" rx="2" ry="2" />
	<rect class="meter-fill" x="0" y="0" width="{clamped}%" height="4" rx="2" ry="2" />
</svg>

<style>
	.meter {
		display: block;
		width: 100%;
		height: var(--h-meter);
	}

	.meter-track {
		fill: var(--meter-track);
	}

	.meter-fill {
		fill: var(--accent);
		transition: width var(--dur-panel) var(--ease-standard);
	}
</style>
