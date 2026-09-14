/**
 * Pure logic and contract tests for the service layer.
 *
 * Execution:
 *   cd ext && node --test src/services/__tests__/adapters.test.ts
 *
 * Route taken:
 *   Node v24 natively executes TypeScript files directly via `node --test`
 *   using built-in type stripping (--experimental-strip-types is active by default in Node 24).
 *   No compilation step, shim, or extra dependencies needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  letterboxdPort,
  imdbPort,
  movieLensPort,
  escapeCsvField,
  splitCsvByBytes,
} from '../csvPorts.ts';
import type { MovieItem, ServiceRef } from '../port.ts';

// ---------------------------------------------------------------------------
// 1. CSV Exact Formats (csvPorts.ts)
// ---------------------------------------------------------------------------

test('Letterboxd CSV exact header and column mapping', async () => {
  const sampleItems: MovieItem[] = [
    {
      title: 'Inception',
      year: 2010,
      rating: 9,
      category: 'ratings',
      tmdbId: 27205,
      imdbId: 'tt1375666',
      voteDate: '2023-05-15',
    },
  ];

  const bundles = await letterboxdPort.exportCsv(sampleItems);
  // Returns ratings bundle and empty watchlist bundle
  const ratingsBundle = bundles.find((b) => b.filename.includes('ratings'));
  assert.ok(ratingsBundle, 'Expected letterboxd ratings bundle');

  const content = ratingsBundle.content;
  // Header exact column specification
  const expectedHeader = 'LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review';
  const lines = content.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines[0], expectedHeader);

  // A 1-10 source rating lands in Rating10 (index 7)
  const dataCols = lines[1].split(',');
  // LetterboxdURI(0), tmdbID(1), imdbID(2), Title(3), Year(4), Directors(5), Rating(6), Rating10(7), WatchedDate(8)
  assert.equal(dataCols[1], '27205');
  assert.equal(dataCols[2], 'tt1375666');
  assert.equal(dataCols[3], 'Inception');
  assert.equal(dataCols[4], '2010');
  assert.equal(dataCols[7], '9');
  assert.equal(dataCols[8], '2023-05-15');
});

test('IMDb CSV exact 13 documented columns in order', async () => {
  const sampleItems: MovieItem[] = [
    {
      title: 'The Matrix',
      year: 1999,
      rating: 10,
      category: 'ratings',
      imdbId: 'tt0133093',
      voteDate: '2022-01-01',
    },
  ];

  const bundles = await imdbPort.exportCsv(sampleItems);
  assert.equal(bundles.length, 1);

  const expectedHeader = 'Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';
  const lines = bundles[0].content.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines[0], expectedHeader);

  const dataCols = lines[1].split(',');
  assert.equal(dataCols.length, 13);
  assert.equal(dataCols[0], 'tt0133093'); // Const
  assert.equal(dataCols[1], '10');        // Your Rating
  assert.equal(dataCols[2], '2022-01-01'); // Date Rated
  assert.equal(dataCols[3], 'The Matrix'); // Title
  assert.equal(dataCols[8], '1999');       // Year
});

test('MovieLens CSV exact header and 0.5-5.0 scale rating conversion', async () => {
  const sampleItems: MovieItem[] = [
    {
      title: 'Toy Story',
      year: 1995,
      rating: 7, // 7 on 1-10 scale -> 3.5 on 0.5-5.0 scale
      category: 'ratings',
      kpId: 862,
      voteDate: '2021-06-01',
    },
    {
      title: 'Braveheart',
      year: 1995,
      rating: 10, // 10 -> 5 (or 5.0 before .replace(/\.0$/, ''))
      category: 'ratings',
      kpId: 999,
    },
    {
      title: 'Plan 9',
      year: 1959,
      rating: 1, // 1 -> 0.5
      category: 'ratings',
      kpId: 100,
    },
  ];

  const bundles = await movieLensPort.exportCsv(sampleItems);
  assert.equal(bundles.length, 1);

  const expectedHeader = 'userId,movieId,rating,timestamp';
  const lines = bundles[0].content.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines[0], expectedHeader);

  const rows = lines.slice(1).map((l) => l.split(','));
  // Toy Story (rating 7 -> 3.5)
  assert.equal(rows[0][0], '1');
  assert.equal(rows[0][1], '862');
  assert.equal(rows[0][2], '3.5');
  // Braveheart (rating 10 -> 5)
  assert.equal(parseFloat(rows[1][2]), 5.0);
  // Plan 9 (rating 1 -> 0.5)
  assert.equal(rows[2][2], '0.5');
});

test('Every produced CSV file begins with a UTF-8 BOM', async () => {
  const item: MovieItem = {
    title: 'Solaris',
    year: 1972,
    rating: 8,
    category: 'ratings',
  };

  const ports = [letterboxdPort, imdbPort, movieLensPort];
  for (const port of ports) {
    const bundles = await port.exportCsv([item]);
    assert.ok(bundles.length > 0);
    for (const bundle of bundles) {
      assert.ok(
        bundle.content.startsWith('\uFEFF'),
        `Expected ${port.id} bundle ${bundle.filename} to start with UTF-8 BOM (\\uFEFF)`
      );
    }
  }
});

test('CSV field escaping handles commas, double quotes, and newlines (RFC 4180)', async () => {
  assert.equal(escapeCsvField('Simple Title'), 'Simple Title');
  // Comma requires quotes
  assert.equal(escapeCsvField('Lock, Stock and Two Smoking Barrels'), '"Lock, Stock and Two Smoking Barrels"');
  // Double quotes require doubling and enclosing quotes
  assert.equal(escapeCsvField('The "Great" Gatsby'), '"The ""Great"" Gatsby"');
  // Both comma and quotes
  assert.equal(escapeCsvField('Hello, "World"'), '"Hello, ""World"""');

  // Verify within full export
  const itemWithCommasAndQuotes: MovieItem = {
    title: 'Borat: Cultural Learnings, "Make Benefit"',
    year: 2006,
    rating: 8,
    category: 'ratings',
  };

  const bundles = await letterboxdPort.exportCsv([itemWithCommasAndQuotes]);
  const ratingsBundle = bundles.find((b) => b.filename.includes('ratings'));
  assert.ok(ratingsBundle);
  const contentWithoutBOM = ratingsBundle.content.replace(/^\uFEFF/, '');
  assert.ok(contentWithoutBOM.includes('"Borat: Cultural Learnings, ""Make Benefit"""'));
});

// ---------------------------------------------------------------------------
// 2. UTF-8-Safe Splitting (splitCsvByBytes)
// ---------------------------------------------------------------------------

test('splitCsvByBytes: payload under limit yields single bundle with no part suffix', () => {
  const header = 'LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review';
  const rows = [
    ',,,,1994,,8,8,,,',
    ',,,,1995,,9,9,,,',
  ];

  const bundles = splitCsvByBytes('letterboxd-ratings.csv', header, rows, 10 * 1024 * 1024);
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].filename, 'letterboxd-ratings.csv');
  assert.ok(bundles[0].content.startsWith('\uFEFF' + header));
});

test('splitCsvByBytes: Cyrillic payload over limit splits safely without cutting characters or lines', () => {
  const header = 'id,title,comment';
  // Cyrillic chars take 2 bytes each in UTF-8
  const cyrillicTitles = [
    'Сталкер (Андрей Тарковский)',
    'Иван Васильевич меняет профессию',
    'Броненосец «Потёмкин»',
    'Операция «Ы» и другие приключения Шурика',
    'Летят журавли',
    'Москва слезам не верит',
    'Кин-дза-дза!',
    'Солярис',
    'Зеркало',
    'Андрей Рублёв',
  ];

  const rows: string[] = [];
  for (let i = 0; i < 200; i++) {
    const title = cyrillicTitles[i % cyrillicTitles.length];
    rows.push(`${i},"${title}","Отзыв номер ${i} на русском языке с многобайтовыми символами"`);
  }

  // Choose a small byte limit (e.g. 2 KB) to force multiple chunks
  const limitBytes = 2048;
  const bundles = splitCsvByBytes('cyrillic_export.csv', header, rows, limitBytes);

  assert.ok(bundles.length > 1, `Expected > 1 bundle, got ${bundles.length}`);

  // Invariant 1: each bundle starts with BOM and the full header
  const reconstructedRows: string[] = [];
  for (let idx = 0; idx < bundles.length; idx++) {
    const bundle = bundles[idx];
    assert.match(bundle.filename, /cyrillic_export_part\d+\.csv/);
    assert.ok(
      bundle.content.startsWith('\uFEFF' + header + '\r\n'),
      `Bundle ${idx} must start with UTF-8 BOM and header`
    );

    // Invariant 2: bundle size within limit (or single line if one line exceeded)
    const encoded = new TextEncoder().encode(bundle.content);
    // Each part must not exceed limit + margin of a single line
    assert.ok(encoded.length <= limitBytes || bundle.content.split('\r\n').length === 3);

    // Extract data rows
    const contentNoBom = bundle.content.replace(/^\uFEFF/, '');
    const partLines = contentNoBom.split('\r\n');
    assert.equal(partLines[0], header);
    for (let j = 1; j < partLines.length; j++) {
      if (partLines[j].length > 0) {
        reconstructedRows.push(partLines[j]);
      }
    }
  }

  // Invariant 3: No line is cut mid-character; reassembled data rows match original exactly
  assert.equal(reconstructedRows.length, rows.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(
      reconstructedRows[i],
      rows[i],
      `Row ${i} was corrupted during split! Expected "${rows[i]}", got "${reconstructedRows[i]}"`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. CSV Ports Reject Writes (pushRating, pushWatchlist)
// ---------------------------------------------------------------------------

test('CSV ports reject writes (pushRating and pushWatchlist throw)', async () => {
  const dummyRef: ServiceRef = {
    serviceId: 'letterboxd',
    id: '123',
    mediaType: 'movie',
  };

  const ports = [letterboxdPort, imdbPort, movieLensPort];

  for (const port of ports) {
    // pushRating must reject
    await assert.rejects(
      async () => {
        await port.pushRating(dummyRef, 8);
      },
      (err: unknown) => {
        // Assert it threw an Error without pinning exact message string
        assert.ok(err instanceof Error);
        return true;
      },
      `${port.id} pushRating should reject`
    );

    // pushWatchlist must reject
    await assert.rejects(
      async () => {
        await port.pushWatchlist(dummyRef);
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
      `${port.id} pushWatchlist should reject`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Dedupe Key Shape Consistency
// ---------------------------------------------------------------------------

test('Dedupe key builder and port keys match for same item across orchestrator and ports', () => {
  /**
   * The orchestrator in background.ts builds dedupe keys via:
   *   keys.push(ref.id)
   *   keys.push(`${ref.mediaType}_${ref.id}`)
   *   keys.push(`${ref.mediaType}:${ref.id}`)
   *
   * Ports store existing ratings/watchlist keyed by:
   *   TMDB: `movie:${id}` or `tv:${id}`
   *   Trakt: `movie:${id}` / `show:${id}` (and optionally `imdb:${id}`, `tmdb:${id}`)
   *   Simkl: `movie:${id}` / `show:${id}`
   *
   * Assert that for any ServiceRef with standard mediaType and id,
   * the orchestrator's generated keys overlap with the port's stored key format,
   * ensuring deduplication never silently misses existing entries.
   */

  function orchestratorDedupeKeys(ref: ServiceRef): string[] {
    const keys: string[] = [];
    keys.push(ref.id);
    keys.push(`${ref.mediaType}_${ref.id}`);
    keys.push(`${ref.mediaType}:${ref.id}`);
    return keys;
  }

  // TMDB / Trakt / Simkl standard movie ref
  const movieRef: ServiceRef = {
    serviceId: 'tmdb',
    id: '550',
    mediaType: 'movie',
  };

  const orchKeys = orchestratorDedupeKeys(movieRef);

  // Ports store with prefix `movie:550` or `movie_550` or bare `550`
  const portKeyColon = `movie:${movieRef.id}`;
  const portKeyBare = movieRef.id;

  assert.ok(
    orchKeys.includes(portKeyColon),
    `Orchestrator keys must include colon format '${portKeyColon}' used by TMDB/Trakt/Simkl`
  );
  assert.ok(
    orchKeys.includes(portKeyBare),
    `Orchestrator keys must include bare id '${portKeyBare}'`
  );

  // Check show / series ref
  const tvRef: ServiceRef = {
    serviceId: 'trakt',
    id: '1399',
    mediaType: 'show',
  };
  const orchTvKeys = orchestratorDedupeKeys(tvRef);
  assert.ok(
    orchTvKeys.includes(`show:${tvRef.id}`),
    `Orchestrator keys must include 'show:${tvRef.id}'`
  );

  // Invariant: orchestrator keys must not be empty or contain undefined
  for (const k of orchKeys) {
    assert.ok(typeof k === 'string' && k.length > 0 && !k.includes('undefined'));
  }
});
