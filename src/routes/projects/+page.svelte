<script lang="ts">
	/**
	 * The projects route — tasks.md 7.1. A thin wrapper: `+page.server.ts`'s `load`
	 * already shaped everything `ProjectsPage.svelte` needs, and every write action's
	 * feedback is owned locally by the form that submitted it (see `ProjectsPage.svelte`
	 * and `ProjectRow.svelte`'s doc comments), so this file has nothing else to do.
	 */
	import type { PageData } from './$types';
	import ProjectsPage from '$modules/projects/pages/ProjectsPage.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<ProjectsPage
	projects={data.projects}
	totalCoveredSeconds={data.totalCoveredSeconds}
	activeCount={data.activeCount}
/>
