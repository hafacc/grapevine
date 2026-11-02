-- Four more services an import reads: StoryGraph's library CSV, Netflix's
-- personal information download, Trakt's own export zip and Spotify's account
-- data. The keys are the ones
-- `shared/src/import/formats.ts` gives a recognized file; `import_thumbs`
-- refuses any source not in this table.
insert into private.import_sources (source) values
  ('storygraph'), ('netflix'), ('trakt'), ('spotify');
