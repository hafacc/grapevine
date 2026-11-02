<script lang="ts" module>
  import type {
    ImportRow,
    ImportSource,
    NetflixFile,
    Outcome,
    Reading,
  } from "grapevine-shared/import";
  import type {
    FileRefusal,
    ImportStanding,
    ImportThing,
    Saved,
  } from "../utils/import";
  import { SOURCE_NAMES } from "../utils/import";

  const count = (value: number): string => value.toLocaleString("en-US");

  const SOURCES: readonly {
    source: ImportSource;
    comes: string;
    how: readonly string[];
  }[] = [
    {
      source: "imdb",
      comes: "films and series you rated",
      how: [
        "on imdb.com, on a computer, open your ratings and choose export.",
        "imdb then offers the file on its exports page. download it and choose it here.",
      ],
    },
    {
      source: "letterboxd",
      comes: "films you rated or liked",
      how: [
        "on letterboxd.com, open settings, then data, and export your data.",
        "choose the zip here, as it is.",
      ],
    },
    {
      source: "trakt",
      comes: "films and series you rated",
      how: [
        "on trakt.tv, open settings, then data, and export your data.",
        "choose the zip here, as it is.",
      ],
    },
    {
      source: "netflix",
      comes: "films and series you rated",
      how: [
        "on netflix.com, open your account, then download your personal information, and request it.",
        "netflix emails you when it's ready, which can take up to 30 days. choose the zip here, as it is.",
      ],
    },
    {
      source: "goodreads",
      comes: "books you rated",
      how: [
        "on goodreads.com, on a computer, open my books, then import and export, and export your library.",
        "download the file and choose it here.",
      ],
    },
    {
      source: "storygraph",
      comes: "books you rated",
      how: [
        "on app.thestorygraph.com, open manage account, then manage your data, and export your library.",
        "generate the export, refresh the page when it's ready, then download it and choose it here.",
      ],
    },
    {
      source: "google-maps",
      comes: "places you reviewed",
      how: [
        "at takeout.google.com, deselect all, tick maps (your places), and create the export.",
        "google emails you when it's ready. choose the zip here, as it is.",
      ],
    },
    {
      source: "spotify",
      comes: "music you liked, saved or followed",
      how: [
        "on spotify.com, open your account's privacy page and request your account data.",
        "spotify emails you when it's ready, which can take a few days. choose the zip here, as it is.",
      ],
    },
  ];

  // What a source's things are called, and where they are looked for.
  const KINDS: Readonly<
    Record<ImportSource, { things: string; index: string; wait: string }>
  > = {
    imdb: {
      things: "films",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    letterboxd: {
      things: "films",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    goodreads: {
      things: "books",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    "google-maps": {
      things: "places",
      index: "openstreetmap",
      wait: "places take a few seconds each, and save as they're found.",
    },
    storygraph: {
      things: "books",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    netflix: {
      things: "films",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    trakt: {
      things: "films",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
    spotify: {
      things: "music",
      index: "wikipedia",
      wait: "a long list takes a minute or two.",
    },
  };

  const REFUSALS: Readonly<
    Record<FileRefusal, { title: string; body: string }>
  > = {
    unreadable: {
      title: "grapevine can't read that file",
      body: "it takes the ratings file from imdb, goodreads or storygraph, the zip from letterboxd, trakt, netflix or spotify, or google's takeout zip, as downloaded.",
    },
    "letterboxd-list": {
      title: "no ratings in that file",
      body: "it's a letterboxd watchlist. grapevine imports ratings and likes, so choose the whole zip.",
    },
    "imdb-list": {
      title: "no ratings in that file",
      body: "it's an imdb list. export from your ratings page instead.",
    },
    "takeout-without-reviews": {
      title: "no ratings in that file",
      body: "that takeout has no maps reviews in it.",
    },
    "trakt-without-ratings": {
      title: "no ratings in that file",
      body: "that trakt export has no ratings in it.",
    },
    "netflix-without-ratings": {
      title: "no ratings in that file",
      body: "that netflix download has no ratings in it.",
    },
    tgz: {
      title: "grapevine can't read that file",
      body: "choose the .zip takeout, not the .tgz.",
    },
    "cannot-unzip": {
      title: "this browser can't open zips",
      body: "unzip it and choose ratings.csv.",
    },
  };

  function alreadyImported(
    source: ImportSource,
    standing: ImportStanding | undefined,
  ): { title: string; body: string } {
    const days = standing?.daysUntilNext ?? 30;
    return {
      title: `you've already imported from ${SOURCE_NAMES[source]}`,
      body: `you can import from it again in ${days === 1 ? "1 day" : `${days} days`}.`,
    };
  }

  // An import under way: what its file held and how far it has got.
  type Found = {
    readonly source: ImportSource;
    readonly rows: readonly ImportRow[];
    // Every rating the file held, imported or not.
    readonly total: number;
    // Rows dealt with: matched, and their clean matches saved.
    readonly at: number;
    // The rows after `at` already matched, when a stop came mid-way.
    readonly outcomes: readonly (Outcome | null)[];
    // Matched and not yet saved, when the save is what stopped.
    readonly unsaved: readonly ImportThing[] | null;
    readonly saved: Saved;
  };

  type Phase =
    | { readonly at: "choose" }
    // Reading, matching and saving are one stretch of work with one mark.
    | { readonly at: "reading" }
    // Netflix's file holds every profile on the account: which are the
    // person's is the one thing an import asks, and only of a file with more
    // than one. Kept for the run alone.
    | {
        readonly at: "profiles";
        readonly reading: Reading;
        readonly file: NetflixFile;
        readonly chosen: ReadonlySet<string>;
      }
    | { readonly at: "matching"; readonly done: number }
    | { readonly at: "offline" }
    | { readonly at: "unreachable"; readonly done: number }
    | { readonly at: "nothing" }
    | { readonly at: "done"; readonly saved: Saved }
    | { readonly at: "stopped"; readonly limit: boolean };

  const NOTHING: Saved = { saved: 0, kept: 0, refused: 0, over: 0 };

  // Where on the title bar's rule the matching starts.
  const MATCHING_FROM = 0.04;

  // Rows matched and then saved together, so a run that is left keeps what it
  // had found: a place takes seconds, a film a fiftieth of one.
  const segmentOf = (source: ImportSource): number =>
    source === "google-maps" ? 20 : 500;
</script>

<script lang="ts">
  import { matchRows, netflixReading } from "grapevine-shared/import";
  import { onMount } from "svelte";
  import {
    canImport,
    createAsk,
    fetchImportStandings,
    ImportStopped,
    isImportClosed,
    orderThings,
    readImportCatalog,
    readImportFile,
    resolveImport,
    saveImport,
  } from "../utils/import";
  import { importResume, setImportResume } from "../utils/import-resume";
  import { lookupSettings } from "../utils/lookup";
  import { reloadMyRatings } from "../utils/ratings";
  import { refreshMyRecs } from "../utils/recs";
  import { useMyRecs } from "../utils/recs.svelte";
  import { grapevine } from "../utils/store.svelte";
  import { DAILY_LIMIT_MESSAGE, isDailyLimit } from "../utils/supabase";
  import type { Ratings, RatingValue } from "../utils/types";
  import Said from "./import-said.svelte";
  import Button from "./ui/button.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuCheck, LuChevronLeft, LuX } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";
  import Sheet from "./ui/sheet.svelte";

  /**
   * Importing ratings from another service (DESIGN §1 "Importing"): choose a
   * source and its file, which is read and matched on this device, and every
   * clean match is saved as the run goes. Nothing is asked in between.
   */
  const recs = useMyRecs();
  let picker: HTMLInputElement | undefined = $state();

  let phase = $state.raw<Phase>({ at: "choose" });
  let standings = $state.raw<ReadonlyMap<ImportSource, ImportStanding>>(
    new Map(),
  );
  let how = $state<ImportSource | null>(null);
  let notice = $state.raw<{ title: string; body: string } | null>(null);
  let found = $state.raw<Found | null>(null);
  // One run at a time, and none finishing after the screen has moved on.
  let runs = 0;
  onMount(() => () => {
    runs += 1;
  });

  // Importing cannot match with lookups off, and its ways in are gone then.
  onMount(() => {
    if (!lookupSettings().lookUp) grapevine.home();
  });

  onMount(() => {
    fetchImportStandings()
      .then((fresh) => {
        standings = fresh;
      })
      .catch((error) => console.error("import: standings", error));
  });

  // Only for the order things are sent in: a feed that could not be read
  // orders by the catalog alone.
  const inList = $derived(
    new Set(recs.failed ? [] : recs.entries.map((entry) => entry.itemId)),
  );

  async function refreshStanding(
    source: ImportSource,
  ): Promise<ImportStanding | undefined> {
    try {
      const fresh = await fetchImportStandings();
      standings = fresh;
      return fresh.get(source);
    } catch (error) {
      console.error("import: standings", error);
      return standings.get(source);
    }
  }

  // Matches a segment of rows, saves its clean matches, and goes on to the
  // next, from wherever `from` had got to.
  async function work(from: Found): Promise<void> {
    runs += 1;
    const mine = runs;
    const live = (): boolean => runs === mine;
    const uid = grapevine.user?.uid ?? "";
    const listed = inList;
    const { source, rows } = from;
    let { at, outcomes, unsaved, saved } = from;
    const keep = (): Found => ({ ...from, at, outcomes, unsaved, saved });
    const share = (matched: number): number =>
      (at + matched) / Math.max(1, rows.length);
    found = from;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      phase = { at: "offline" };
      return;
    }
    phase = { at: "matching", done: share(0) };
    const ask = createAsk();
    let ratings: Ratings;
    try {
      ratings = await reloadMyRatings();
    } catch (error) {
      console.error("import: ratings", error);
      if (live()) phase = { at: "unreachable", done: share(0) };
      return;
    }
    // What this run has rated, beside what was rated before it.
    const rated: Record<string, { "": RatingValue }> = {};
    const size = segmentOf(source);
    while (live() && (unsaved !== null || at < rows.length)) {
      if (unsaved === null) {
        const segment = rows.slice(at, at + size);
        const matching = await matchRows(
          segment,
          ask,
          (done) => {
            if (live())
              phase = { at: "matching", done: share(done * segment.length) };
          },
          outcomes,
        );
        if (!live()) return;
        outcomes = matching.outcomes;
        if (matching.stopped) {
          found = keep();
          phase = {
            at: "unreachable",
            done: share(outcomes.filter((outcome) => outcome !== null).length),
          };
          return;
        }
        try {
          unsaved = orderThings(
            resolveImport(
              segment,
              outcomes,
              await readImportCatalog(outcomes),
              { ...ratings, ...rated },
            ),
            listed,
          );
        } catch (error) {
          console.error("import: catalog", error);
          if (!live()) return;
          found = keep();
          phase = { at: "unreachable", done: share(segment.length) };
          return;
        }
      }
      let counts = NOTHING;
      let failure: unknown = null;
      try {
        counts = await saveImport(source, unsaved);
        for (const thing of unsaved) rated[thing.itemId] = { "": thing.value };
        unsaved = null;
      } catch (error) {
        console.error("import: save", error);
        if (!(error instanceof ImportStopped)) throw error;
        counts = error.done;
        unsaved = error.left;
        failure = error.cause;
      }
      saved = {
        saved: saved.saved + counts.saved,
        kept: saved.kept + counts.kept,
        refused: saved.refused + counts.refused,
        over: saved.over + counts.over,
      };
      if (unsaved !== null) {
        if (!live()) return;
        found = keep();
        if (saved.saved > 0)
          await reloadMyRatings().catch((error) => console.error(error));
        if (isImportClosed(failure)) {
          notice = alreadyImported(source, await refreshStanding(source));
          phase = { at: "choose" };
        } else {
          phase = { at: "stopped", limit: isDailyLimit(failure) };
        }
        return;
      }
      at = Math.min(rows.length, at + size);
      outcomes = [];
      setImportResume(uid, { source, total: from.total, done: at });
      // The import's allowance is spent: nothing after this would be saved.
      if (saved.over > 0) break;
    }
    if (!live()) return;
    setImportResume(uid, null);
    found = keep();
    if (saved.saved > 0) {
      await reloadMyRatings().catch((error) => console.error(error));
      void refreshMyRecs().catch((error) => console.error(error));
    }
    if (!live()) return;
    phase =
      saved.saved === 0 && saved.over === 0
        ? { at: "nothing" }
        : { at: "done", saved };
  }

  async function choose(file: File): Promise<void> {
    runs += 1;
    const mine = runs;
    how = null;
    phase = { at: "reading" };
    const reading = await readImportFile(file);
    if (runs !== mine) return;
    if (typeof reading === "string") {
      notice = REFUSALS[reading];
      phase = { at: "choose" };
      return;
    }
    const standing = await refreshStanding(reading.source);
    if (runs !== mine) return;
    if (!canImport(standing)) {
      notice = alreadyImported(reading.source, standing);
      phase = { at: "choose" };
      return;
    }
    const netflix = reading.netflix;
    if (netflix !== undefined && netflix.profiles.length > 1) {
      phase = {
        at: "profiles",
        reading,
        file: netflix,
        chosen: new Set(netflix.profiles),
      };
      return;
    }
    await start(reading);
  }

  async function start(reading: Reading): Promise<void> {
    const uid = grapevine.user?.uid ?? "";
    const total = reading.rows.length + reading.leftOut;
    await work({
      source: reading.source,
      rows: reading.rows,
      total,
      // The same file, chosen again after a run that was left.
      at: importResume(uid, reading.source, total),
      outcomes: [],
      unsaved: null,
      saved: NOTHING,
    });
  }

  const kind = $derived(KINDS[found?.source ?? "imdb"]);
  const bar = $derived(
    phase.at === "reading"
      ? MATCHING_FROM
      : phase.at === "matching" || phase.at === "unreachable"
        ? MATCHING_FROM + phase.done * (1 - MATCHING_FROM)
        : null,
  );
  // The file's ratings that were not saved, for whatever reason.
  const rest = $derived(
    phase.at === "done"
      ? Math.max(0, (found?.total ?? 0) - phase.saved.saved)
      : 0,
  );
  const matched = $derived(
    phase.at === "matching" && found !== null
      ? Math.floor(phase.done * found.rows.length)
      : 0,
  );
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <!-- The title bar every screen but the list carries. Progress fills its
       bottom rule in the accent: the one progress mark an import has. -->
  <header
    class="relative flex h-[56px] shrink-0 items-center gap-1 border-b border-border bg-surface pr-2.5 pl-1"
  >
    <button
      type="button"
      aria-label="back"
      onclick={grapevine.back}
      class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm bg-surface text-text focus-visible:outline-offset-[-2px]"
    >
      <Icon icon={LuChevronLeft} size={20} aria-hidden="true" />
    </button>
    <h1
      class="font-display min-w-0 flex-grow truncate text-[22px] font-semibold text-text"
    >
      import ratings
    </h1>
    {#if bar !== null}
      <span
        role="progressbar"
        aria-label="progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bar * 100)}
        class="absolute -bottom-px left-0 h-[2px] bg-accent transition-[width]"
        style:width={`${bar * 100}%`}
      ></span>
    {/if}
  </header>
  <div
    data-import={phase.at}
    class={[
      "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
      phase.at === "choose" ? "" : "md:bg-surface",
    ]}
  >
    {#if phase.at === "choose"}
      <!-- The line over a list's first row, as the list's first-run hint is
           drawn. -->
      <p
        class="flex min-h-[52px] items-center border-b border-border px-4 py-3 text-[15px] text-muted"
      >
        from a file you download from the other app. it's read on this device
        and never uploaded.
      </p>
      {#each SOURCES as entry (entry.source)}
        {@const standing = standings.get(entry.source)}
        {@const closed = !canImport(standing)}
        <!-- A row that opens something: a name and a line under it, as a
             reported name is drawn. -->
        <button
          type="button"
          data-row={entry.source}
          onclick={() => {
            if (closed) notice = alreadyImported(entry.source, standing);
            else how = entry.source;
          }}
          class="flex min-h-[64px] w-full shrink-0 items-center bg-surface px-4 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
        >
          <span class="min-w-0 flex-grow">
            <span
              class={[
                "block text-[17px] font-medium [overflow-wrap:anywhere]",
                closed ? "text-muted" : "",
              ]}
            >
              {SOURCE_NAMES[entry.source]}
            </span>
            <span class="block text-[15px] text-muted">
              {closed
                ? alreadyImported(entry.source, standing).body
                : entry.comes}
            </span>
          </span>
        </button>
      {/each}
    {/if}

    {#if phase.at === "profiles"}
      {@const asked = phase}
      <p
        class="flex min-h-[52px] items-center border-b border-border px-4 py-3 text-[15px] text-muted"
      >
        this file has every profile on the netflix account. turn off the ones
        that aren't yours.
      </p>
      {#each asked.file.profiles as profile (profile)}
        {@const on = asked.chosen.has(profile)}
        <RateRow
          subject={profile}
          value={null}
          sides={on ? "no" : "yes"}
          labels={on
            ? { no: { word: "turn off", icon: LuX } }
            : { yes: { word: "turn on", icon: LuCheck } }}
          onRate={() => {
            const chosen = new Set(asked.chosen);
            if (on) chosen.delete(profile);
            else chosen.add(profile);
            phase = { ...asked, chosen };
          }}
          frameClass="bg-surface"
        >
          <p
            data-profile={profile}
            class={[
              "flex min-h-[56px] items-center px-4 py-2.5 text-[16px] [overflow-wrap:anywhere]",
              on ? "" : "text-muted",
            ]}
          >
            {profile}
          </p>
        </RateRow>
      {/each}
      <div class="p-4">
        <Button
          class="w-full"
          disabled={asked.chosen.size === 0}
          onclick={() => void start(netflixReading(asked.file, asked.chosen))}
        >
          import
        </Button>
      </div>
    {/if}
    {#if phase.at === "reading"}
      <Said working line="reading your file…" />
    {/if}
    {#if phase.at === "matching" && found !== null}
      <Said
        working
        line={`finding your ${kind.things} on ${kind.index}…`}
        under={`keep grapevine open. ${kind.wait}`}
        extra={`${count(matched)} of ${count(found.rows.length)}`}
      />
    {/if}

    {#if phase.at === "offline"}
      <Said
        line="you're offline."
        under={`finding your ${kind.things} needs a connection. your file is still here.`}
      >
        <Button class="w-full" onclick={() => found && void work(found)}>
          try again
        </Button>
      </Said>
    {/if}
    {#if phase.at === "unreachable"}
      <Said
        line={`couldn't reach ${kind.index} just now.`}
        under="what was found so far is kept."
      >
        <Button class="w-full" onclick={() => found && void work(found)}>
          try again
        </Button>
      </Said>
    {/if}
    {#if phase.at === "nothing"}
      <Said
        line="nothing new in that file."
        under="everything in it is already rated here, rated in between, or wasn't found."
      >
        <Button
          variant="secondary"
          class="w-full"
          onclick={() => {
            phase = { at: "choose" };
          }}
        >
          choose another file
        </Button>
      </Said>
    {/if}

    {#if phase.at === "done"}
      <Said
        line={phase.saved.over > 0
          ? `${count(phase.saved.saved)} saved. that's the most one import takes.`
          : phase.saved.saved === 1
            ? "1 rating saved. it's in your list now."
            : `${count(phase.saved.saved)} ratings saved. they're in your list now.`}
        under={phase.saved.over > 0
          ? "the rest weren't imported."
          : rest > 0
            ? "the rest couldn't be matched, were rated in between, or are already rated here."
            : undefined}
      >
        <Button class="w-full" onclick={grapevine.home}>see your list</Button>
      </Said>
    {/if}
    {#if phase.at === "stopped"}
      {#if phase.limit}
        <Said
          line={DAILY_LIMIT_MESSAGE}
          under="what was saved is in your list. an import can be finished until a day after it starts."
        >
          <Button class="w-full" onclick={grapevine.home}>see your list</Button>
        </Said>
      {:else}
        <Said
          line={(found?.saved.saved ?? 0) > 0
            ? "saved some, then lost the connection."
            : "couldn't save. check your connection."}
          under="the rest is still here. an import can be finished until a day after it starts."
        >
          <Button class="w-full" onclick={() => found && void work(found)}>
            try again
          </Button>
        </Said>
      {/if}
    {/if}
  </div>

  <input
    bind:this={picker}
    type="file"
    accept=".csv,.zip,.json,text/csv,application/zip,application/json"
    class="hidden"
    onchange={(event) => {
      const [file] = event.currentTarget.files ?? [];
      // Cleared, so choosing the same file again is a change.
      event.currentTarget.value = "";
      if (file) void choose(file);
    }}
  />
  {#if how !== null}
    {@const source = how}
    <Sheet
      open
      onClose={() => {
        how = null;
      }}
      title={`from ${SOURCE_NAMES[source]}`}
    >
      <div class="flex flex-col gap-3 text-[0.9375rem] text-muted">
        {#each SOURCES.find((entry) => entry.source === source)?.how ??
          [] as step (step)}
          <p>{step}</p>
        {/each}
        <!-- Nothing is asked after the file is chosen, so it is said here. -->
        <p>
          your ratings save as soon as they're matched. you can import from
          {SOURCE_NAMES[source]}
          once every 30 days.
        </p>
      </div>
      <div class="flex justify-end gap-2 pt-5">
        <Button
          variant="ghost"
          onclick={() => {
            how = null;
          }}
        >
          cancel
        </Button>
        <Button onclick={() => picker?.click()}>choose file</Button>
      </div>
    </Sheet>
  {/if}
  {#if notice !== null}
    {@const said = notice}
    <Sheet
      open
      onClose={() => {
        notice = null;
      }}
      title={said.title}
    >
      <p class="text-[0.9375rem] text-muted">{said.body}</p>
      <div class="flex justify-end gap-2 pt-5">
        <Button
          onclick={() => {
            notice = null;
          }}
        >
          ok
        </Button>
      </div>
    </Sheet>
  {/if}
</div>
