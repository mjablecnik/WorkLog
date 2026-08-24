<script lang="ts">
	/**
	 * Takes the shape and radius of the block it stands in — never a bare spinner
	 * (design.md, "Surfaces the artboards do not draw" › Skeleton; task 9.1). The
	 * caller sizes it (width/height come from its own layout, typically `width:
	 * 100%; height: <the real block's height>`); this component only supplies the
	 * `--panel` ground, the shimmer, and one of the design's closed set of radii.
	 *
	 * `radius` picks a CSS class via a `data-radius` attribute rather than an
	 * inline `style="border-radius: …"` — the production CSP carries no
	 * `unsafe-inline` for `style-src`, so a per-instance dynamic value can only be
	 * expressed as a class (or attribute selector), never as a style attribute.
	 */
	const RADII = [2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 20, 9999] as const;
	type Radius = (typeof RADII)[number];

	interface Props {
		/** One of the design's closed radius list; omit for a square corner (0). */
		radius?: Radius;
		class?: string;
	}

	let { radius, class: className = '' }: Props = $props();
</script>

<span class="skeleton {className}" data-radius={radius} aria-hidden="true"></span>

<style>
	/* The shimmer is a `background-image` layered over `background-color`, not a
	   `::after` — `theme.css`'s `prefers-reduced-motion` block turns this into a
	   flat `--panel` fill with `animation: none; background: var(--panel)`, and
	   the shorthand `background` there also clears the gradient layer, which it
	   could not do if the shimmer lived on a pseudo-element instead. */
	.skeleton {
		display: block;
		width: 100%;
		height: 100%;
		background-color: var(--panel);
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.08) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer var(--dur-shimmer) linear infinite;
	}

	.skeleton[data-radius='2'] {
		border-radius: var(--radius-2);
	}
	.skeleton[data-radius='3'] {
		border-radius: var(--radius-3);
	}
	.skeleton[data-radius='4'] {
		border-radius: var(--radius-4);
	}
	.skeleton[data-radius='5'] {
		border-radius: var(--radius-5);
	}
	.skeleton[data-radius='7'] {
		border-radius: var(--radius-7);
	}
	.skeleton[data-radius='8'] {
		border-radius: var(--radius-8);
	}
	.skeleton[data-radius='9'] {
		border-radius: var(--radius-9);
	}
	.skeleton[data-radius='10'] {
		border-radius: var(--radius-10);
	}
	.skeleton[data-radius='11'] {
		border-radius: var(--radius-11);
	}
	.skeleton[data-radius='12'] {
		border-radius: var(--radius-12);
	}
	.skeleton[data-radius='14'] {
		border-radius: var(--radius-14);
	}
	.skeleton[data-radius='20'] {
		border-radius: var(--radius-20);
	}
	.skeleton[data-radius='9999'] {
		border-radius: var(--radius-9999);
	}

	@keyframes skeleton-shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
</style>
