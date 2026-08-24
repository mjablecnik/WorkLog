<script lang="ts" module>
	/**
	 * Inline SVG icon registry. No icon package is used — Requirement 14.6/17.19 require
	 * every icon's geometry to come from `.design/artboards/*.dc.html`, which is the source
	 * of truth for it. Geometry below is pulled verbatim from the artboards via
	 * `grep -n "<svg" .design/artboards/*.dc.html`, one icon per artboard occurrence, except
	 * where noted — see the porting report for which icons are verbatim and which are a
	 * documented fallback (search, sun, moon, check) for a name the artboards never draw.
	 */
	export type IconName =
		| 'settings'
		| 'close'
		| 'chevron-left'
		| 'chevron-right'
		| 'chevron-down'
		| 'plus'
		| 'pencil'
		| 'trash'
		| 'sun'
		| 'moon'
		| 'logout'
		| 'warning'
		| 'info'
		| 'check'
		| 'search'
		| 'eye'
		| 'timer'
		| 'day'
		| 'projects'
		| 'stats'
		| 'archive'
		| 'more';

	type IconDef = {
		/** Always `0 0 24 24` for the extracted set — kept explicit per icon in case a future
		 * addition draws from an artboard with a different box. */
		viewBox: string;
		strokeWidth: number;
		/** One `<path d="…">` per entry; most icons are a single path, a few (pencil, logout,
		 * warning) are drawn from the artboard as multiple subpaths. */
		paths: string[];
		circles?: { cx: number; cy: number; r: number }[];
		rects?: { x: number; y: number; width: number; height: number; rx?: number }[];
	};

	const ICONS: Record<IconName, IconDef> = {
		// verbatim — Main.dc.html / DayCollapsed.dc.html / Settings.dc.html / Stats.dc.html / Projects.dc.html (settings gear chip)
		settings: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.7,
			circles: [{ cx: 12, cy: 12, r: 3.2 }],
			paths: [
				'M19.1 14.4a1.7 1.7 0 0 0 .35 1.87l.06.07a2 2 0 1 1-2.83 2.83l-.06-.07a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.07a2 2 0 1 1-2.83-2.83l.06-.07A1.7 1.7 0 0 0 4.9 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.66 8.9a1.7 1.7 0 0 0-.35-1.87l-.06-.07a2 2 0 1 1 2.83-2.83l.06.07A1.7 1.7 0 0 0 9 4.55 1.7 1.7 0 0 0 10.06 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.35l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.35 1.88V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.56 1.03z'
			]
		},
		// verbatim — AddTask.dc.html / AddTaskMobile.dc.html / AddTaskLight.dc.html / SessionEdit.dc.html dialog close button
		close: {
			viewBox: '0 0 24 24',
			strokeWidth: 2,
			paths: ['M18 6L6 18M6 6l12 12']
		},
		// verbatim — DayCollapsed.dc.html / DayCollapsedLight.dc.html day-nav control
		'chevron-left': {
			viewBox: '0 0 24 24',
			strokeWidth: 1.9,
			paths: ['M15 5l-7 7 7 7']
		},
		// verbatim — DayCollapsed.dc.html / DayCollapsedLight.dc.html day-nav control
		'chevron-right': {
			viewBox: '0 0 24 24',
			strokeWidth: 1.9,
			paths: ['M9 5l7 7-7 7']
		},
		// verbatim — AddTask.dc.html field disclosure chevron
		'chevron-down': {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M6 9l6 6 6-6']
		},
		// verbatim — DayCollapsed.dc.html "úsek" pill / Projects.dc.html add-project control
		plus: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.9,
			paths: ['M12 5v14M5 12h14']
		},
		// verbatim — Main.dc.html edit control / Projects.dc.html row action
		pencil: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
		},
		// verbatim — Projects.dc.html / SessionEdit.dc.html row action
		trash: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6']
		},
		// verbatim — Settings.dc.html / SettingsLight.dc.html / SettingsMobile*.dc.html logout row
		logout: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']
		},
		// verbatim — AddTask*.dc.html / SessionEdit.dc.html / Projects.dc.html untracked-policy note
		warning: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M12 9v4M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']
		},
		// verbatim — AddTask*.dc.html anchor-explanation note
		info: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 12, cy: 12, r: 9 }],
			paths: ['M12 11v5M12 8h.01']
		},
		// verbatim — AddTask*.dc.html / AddTaskMobile.dc.html "uloží se takto" preview heading
		eye: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 12, cy: 12, r: 2.5 }],
			paths: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z']
		},
		// FALLBACK — not drawn in any artboard. Own geometry, same round-cap / 1.8 stroke
		// convention as the extracted set. Flag against the Design_Contract if a search
		// affordance is ever drawn.
		search: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 11, cy: 11, r: 7 }],
			paths: ['M21 21l-4.3-4.3']
		},
		// FALLBACK — no theme-switcher icon is drawn in any artboard (the Settings_Menu's
		// Theme_Switcher is described in design.md but never rendered with its icons).
		sun: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 12, cy: 12, r: 4 }],
			paths: [
				'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41'
			]
		},
		// FALLBACK — see `sun` above.
		moon: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z']
		},
		// FALLBACK — no circle-check / success glyph is drawn in any artboard.
		check: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 12, cy: 12, r: 9 }],
			paths: ['M8 12.5l2.5 2.5 5-5']
		},
		// verbatim — TimerMobile.dc.html / DayMobile.dc.html bottom-nav tab bar (task 1.10)
		timer: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [{ cx: 12, cy: 13, r: 8 }],
			paths: ['M12 9v4l2.5 2', 'M9 2h6']
		},
		// verbatim — TimerMobile.dc.html / DayMobile.dc.html bottom-nav tab bar (task 1.10)
		day: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			rects: [{ x: 3, y: 5, width: 18, height: 16, rx: 2 }],
			paths: ['M3 10h18M8 3v4M16 3v4']
		},
		// verbatim — TimerMobile.dc.html / DayMobile.dc.html bottom-nav tab bar (task 1.10)
		projects: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']
		},
		// verbatim — TimerMobile.dc.html / DayMobile.dc.html bottom-nav tab bar (task 1.10)
		stats: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			paths: ['M4 20V10M10 20V4M16 20v-7M22 20H2']
		},
		// verbatim — Projects.dc.html row action (the archive/unarchive control)
		archive: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			rects: [{ x: 3, y: 4, width: 18, height: 4, rx: 1 }],
			paths: ['M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4']
		},
		// FALLBACK — no mobile artboard exists for Projects (design.md's "Statistics and
		// Projects, Mobile" section is a written contract, not a drawing), so the row's
		// single 32 px overflow button that opens the settings-sheet-style action sheet
		// (tasks.md 7.1) has no artboard geometry to pull from. Own geometry, same
		// round-cap / 1.8 stroke convention as the rest of the extracted set.
		more: {
			viewBox: '0 0 24 24',
			strokeWidth: 1.8,
			circles: [
				{ cx: 5, cy: 12, r: 1.2 },
				{ cx: 12, cy: 12, r: 1.2 },
				{ cx: 19, cy: 12, r: 1.2 }
			],
			paths: []
		}
	};
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
		color?: string;
		class?: string;
	}

	let { name, size = 20, color, class: className = '' }: Props = $props();

	const def = $derived(ICONS[name]);
</script>

{#if def}
	<svg
		width={size}
		height={size}
		viewBox={def.viewBox}
		fill="none"
		stroke={color ?? 'currentColor'}
		stroke-width={def.strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		class={className}
		aria-hidden="true"
		focusable="false"
	>
		{#each def.circles ?? [] as circle, i (i)}
			<circle cx={circle.cx} cy={circle.cy} r={circle.r} />
		{/each}
		{#each def.rects ?? [] as rect, i (i)}
			<rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={rect.rx} />
		{/each}
		{#each def.paths as d, i (i)}
			<path {d} />
		{/each}
	</svg>
{/if}
