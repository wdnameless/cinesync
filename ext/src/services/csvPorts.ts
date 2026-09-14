import type {
  CsvBundle,
  MediaServicePort,
  MovieItem,
  ServiceCapabilities,
  ServiceId,
  ServiceRef,
} from './port';

const UTF8_BOM = '\uFEFF';
const LETTERBOXD_MAX_BYTES = 1048576; // 1 MB (1 048 576 bytes)

/**
 * Escapes a field according to standard CSV formatting rules (RFC 4180):
 * If the value contains a comma, quotation mark, or newline (CR/LF),
 * wrap it in double quotes and escape internal double quotes by doubling them.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parses a date string (e.g. ISO 8601 or YYYY-MM-DD) into YYYY-MM-DD.
 * Returns an empty string if date is missing or invalid.
 */
export function formatWatchedDate(dateStr?: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';
  // Check if it already starts with YYYY-MM-DD
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

/**
 * Converts a date string or current time to UTC epoch timestamp in seconds.
 */
export function parseTimestampSeconds(dateStr?: string): number {
  if (dateStr) {
    const parsed = new Date(dateStr.trim());
    if (!isNaN(parsed.getTime())) {
      return Math.floor(parsed.getTime() / 1000);
    }
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * Splits CSV rows into multiple bundles if the total UTF-8 byte length exceeds maxBytes.
 * Size splitting is UTF-8 safe: byte length is measured with TextEncoder, and split
 * points only occur at full line boundaries.
 *
 * Each part repeats the full header row and carries its own UTF-8 BOM (\uFEFF).
 * If payload fits in maxBytes, exactly one file is produced with no suffix.
 * If payload exceeds maxBytes, parts are suffixed with `_part1`, `_part2`, etc.
 */
export function splitCsvByBytes(
  baseFilename: string,
  headerRow: string,
  dataRows: string[],
  maxBytes: number
): CsvBundle[] {
  if (dataRows.length === 0) {
    return [
      {
        filename: baseFilename,
        content: `${UTF8_BOM}${headerRow}\r\n`,
      },
    ];
  }

  const encoder = new TextEncoder();
  const bomBytes = encoder.encode(UTF8_BOM).length;
  const headerLine = `${headerRow}\r\n`;
  const headerBytes = encoder.encode(headerLine).length;
  const overheadPerPart = bomBytes + headerBytes;

  if (overheadPerPart >= maxBytes) {
    throw new Error(
      `CSV header overhead (${overheadPerPart} bytes) exceeds maximum file size limit (${maxBytes} bytes).`
    );
  }

  // Pre-encode all rows with \r\n to measure byte sizes accurately
  const rowLines: string[] = [];
  const rowByteSizes: number[] = [];

  for (const row of dataRows) {
    const line = `${row}\r\n`;
    const bytes = encoder.encode(line).length;
    rowLines.push(line);
    rowByteSizes.push(bytes);
  }

  // First pass: chunk into parts respecting line boundaries and byte limit
  const parts: string[][] = [];
  let currentPartLines: string[] = [];
  let currentPartBytes = overheadPerPart;

  for (let i = 0; i < rowLines.length; i++) {
    const line = rowLines[i];
    const bytes = rowByteSizes[i];

    if (currentPartLines.length > 0 && currentPartBytes + bytes > maxBytes) {
      parts.push(currentPartLines);
      currentPartLines = [];
      currentPartBytes = overheadPerPart;
    }

    currentPartLines.push(line);
    currentPartBytes += bytes;
  }

  if (currentPartLines.length > 0) {
    parts.push(currentPartLines);
  }

  // Determine naming: single file has no suffix; multiple files get _partN
  const extDotIndex = baseFilename.lastIndexOf('.');
  const baseName = extDotIndex !== -1 ? baseFilename.slice(0, extDotIndex) : baseFilename;
  const ext = extDotIndex !== -1 ? baseFilename.slice(extDotIndex) : '.csv';

  if (parts.length <= 1) {
    const content = `${UTF8_BOM}${headerLine}${parts[0] ? parts[0].join('') : ''}`;
    return [
      {
        filename: baseFilename,
        content,
      },
    ];
  }

  return parts.map((partLines, index) => {
    const partFilename = `${baseName}_part${index + 1}${ext}`;
    const content = `${UTF8_BOM}${headerLine}${partLines.join('')}`;
    return {
      filename: partFilename,
      content,
    };
  });
}

/**
 * Base class for CSV-only media service ports.
 * Provides standard implementations for ping, push operations, and pre-fetching.
 */
abstract class BaseCsvPort implements MediaServicePort {
  abstract readonly id: ServiceId;
  abstract readonly label: string;
  abstract readonly capabilities: ServiceCapabilities;

  /**
   * ping() resolves true without network access because there are no credentials
   * to authenticate for CSV-only export services.
   */
  async ping(): Promise<boolean> {
    return true;
  }

  /**
   * Resolving items against a remote API is not supported by CSV-only export services.
   * CSV export writes existing IDs directly from MovieItem into the CSV columns.
   */
  async resolve(_item: MovieItem): Promise<ServiceRef | null> {
    return null;
  }

  /**
   * pushRating MUST throw an explicit unsupported error naming the service,
   * because CSV ports do not support live API writes.
   */
  async pushRating(_ref: ServiceRef, _rating: number): Promise<void> {
    throw new Error(`pushRating is not supported for CSV service '${this.id}'`);
  }

  /**
   * pushWatchlist MUST throw an explicit unsupported error naming the service,
   * because CSV ports do not support live API writes.
   */
  async pushWatchlist(_ref: ServiceRef): Promise<void> {
    throw new Error(`pushWatchlist is not supported for CSV service '${this.id}'`);
  }

  /**
   * fetchExistingRatings returns an empty collection.
   * These are export-only services, and returning empty is correct (not a stub)
   * because the orchestrator never writes to them or needs to deduplicate against their remote state.
   */
  async fetchExistingRatings(): Promise<Map<string, number>> {
    return new Map();
  }

  /**
   * fetchExistingWatchlist returns an empty collection.
   * These are export-only services, and returning empty is correct (not a stub)
   * because the orchestrator never writes to them or needs to deduplicate against their remote state.
   */
  async fetchExistingWatchlist(): Promise<Set<string>> {
    return new Set();
  }

  abstract exportCsv(items: MovieItem[]): CsvBundle[];
}

/**
 * Letterboxd CSV Port
 *
 * Header, in this exact order:
 * LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review
 *
 * Use Rating10 for the 1–10 integer rating.
 * WatchedDate is YYYY-MM-DD when date is available, otherwise empty.
 * Produces two separate bundles — one for ratings, one for watchlist — distinguished by filename.
 * Size splitting is enforced against 1 048 576 UTF-8 bytes on line boundaries.
 */
export class LetterboxdPort extends BaseCsvPort {
  readonly id: ServiceId = 'letterboxd';
  readonly label = 'Letterboxd';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: false,
    writeMode: 'csv',
    exportOnly: false, // A real import path exists on Letterboxd
    maxFileBytes: LETTERBOXD_MAX_BYTES,
  };

  private static readonly HEADER =
    'LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review';

  private buildRow(item: MovieItem, isRating: boolean): string {
    const letterboxdURI = '';
    const tmdbID = item.tmdbId ? String(item.tmdbId) : '';
    const imdbID = item.imdbId ?? '';
    const title = item.title ?? '';
    const year = item.year ? String(item.year) : '';
    const directors = '';
    const rating5 = isRating && item.rating ? (item.rating / 2).toFixed(1).replace(/\.0$/, '') : '';
    const rating10 = isRating && item.rating ? String(Math.round(item.rating)) : '';
    const watchedDate = isRating ? formatWatchedDate(item.voteDate) : '';
    const rewatch = '';
    const tags = '';
    const review = '';

    const cols = [
      escapeCsvField(letterboxdURI),
      escapeCsvField(tmdbID),
      escapeCsvField(imdbID),
      escapeCsvField(title),
      escapeCsvField(year),
      escapeCsvField(directors),
      escapeCsvField(rating5),
      escapeCsvField(rating10),
      escapeCsvField(watchedDate),
      escapeCsvField(rewatch),
      escapeCsvField(tags),
      escapeCsvField(review),
    ];

    return cols.join(',');
  }

  exportCsv(items: MovieItem[]): CsvBundle[] {
    const ratingsItems = items.filter(
      (item) => item.category === 'ratings' || (item.category === undefined && item.rating !== undefined)
    );
    const watchlistItems = items.filter((item) => item.category === 'watchlist');

    const ratingsRows = ratingsItems.map((item) => this.buildRow(item, true));
    const watchlistRows = watchlistItems.map((item) => this.buildRow(item, false));

    const ratingBundles = splitCsvByBytes(
      'letterboxd_ratings.csv',
      LetterboxdPort.HEADER,
      ratingsRows,
      LETTERBOXD_MAX_BYTES
    );

    const watchlistBundles = splitCsvByBytes(
      'letterboxd_watchlist.csv',
      LetterboxdPort.HEADER,
      watchlistRows,
      LETTERBOXD_MAX_BYTES
    );

    return [...ratingBundles, ...watchlistBundles];
  }
}

/**
 * IMDb CSV Port
 *
 * Header, in this exact order:
 * Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
 *
 * Const is the tt… id.
 * Since exportCsv receives MovieItem[] which carries only a subset of these columns,
 * emit the columns you can populate (Const, Your Rating, Date Rated, Title, Year, URL, Title Type)
 * and leave the rest (IMDb Rating, Runtime (mins), Genres, Num Votes, Release Date, Directors)
 * as empty strings — an empty cell is correct here, a fabricated value is not.
 */
export class ImdbPort extends BaseCsvPort {
  readonly id: ServiceId = 'imdb';
  readonly label = 'IMDb';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: false,
    writeMode: 'csv',
    exportOnly: true, // IMDb has no supported CSV import mechanism
  };

  private static readonly HEADER =
    'Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';

  private mapTitleType(type?: string): string {
    if (!type) return '';
    if (type === 'film' || type === 'movie') return 'Movie';
    if (type === 'series' || type === 'tv') return 'TV Series';
    return type;
  }

  exportCsv(items: MovieItem[]): CsvBundle[] {
    const rows = items.map((item) => {
      const constId = item.imdbId ?? '';
      const yourRating = item.rating !== undefined ? String(Math.round(item.rating)) : '';
      const dateRated = formatWatchedDate(item.voteDate);
      const title = item.title ?? '';
      const url = item.url ?? (item.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : '');
      const titleType = this.mapTitleType(item.type);
      // Unpopulated columns left as empty strings per specification
      const imdbRating = '';
      const runtimeMins = '';
      const year = item.year ? String(item.year) : '';
      const genres = '';
      const numVotes = '';
      const releaseDate = '';
      const directors = '';

      const cols = [
        escapeCsvField(constId),
        escapeCsvField(yourRating),
        escapeCsvField(dateRated),
        escapeCsvField(title),
        escapeCsvField(url),
        escapeCsvField(titleType),
        escapeCsvField(imdbRating),
        escapeCsvField(runtimeMins),
        escapeCsvField(year),
        escapeCsvField(genres),
        escapeCsvField(numVotes),
        escapeCsvField(releaseDate),
        escapeCsvField(directors),
      ];

      return cols.join(',');
    });

    const content = `${UTF8_BOM}${ImdbPort.HEADER}\r\n${rows.length > 0 ? rows.join('\r\n') + '\r\n' : ''}`;

    return [
      {
        filename: 'imdb_ratings.csv',
        content,
      },
    ];
  }
}

/**
 * MovieLens CSV Port
 *
 * Header, in this exact order:
 * userId,movieId,rating,timestamp
 *
 * Rating is on the 0.5–5.0 scale, converted by halving the 1–10 source rating.
 * timestamp is UTC epoch seconds.
 * movieId is an internal dataset namespace unresolvable without links.csv;
 * we emit empty string or kpId if available.
 */
export class MovieLensPort extends BaseCsvPort {
  readonly id: ServiceId = 'movielens';
  readonly label = 'MovieLens';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: false,
    requiresAuth: false,
    writeMode: 'csv',
    exportOnly: true, // Internal namespace unresolvable without links.csv
  };

  private static readonly HEADER = 'userId,movieId,rating,timestamp';

  exportCsv(items: MovieItem[]): CsvBundle[] {
    const rows = items.map((item) => {
      const userId = '1';
      // movieId is internal to MovieLens dataset; without links.csv emit empty or kpId
      const movieId = item.id ?? item.kpId ?? '';
      // Convert 1-10 scale to 0.5-5.0 scale (half)
      const rating = item.rating !== undefined ? (item.rating / 2).toFixed(1).replace(/\.0$/, '') : '';
      const timestamp = String(parseTimestampSeconds(item.voteDate));

      const cols = [
        escapeCsvField(userId),
        escapeCsvField(movieId),
        escapeCsvField(rating),
        escapeCsvField(timestamp),
      ];

      return cols.join(',');
    });

    const content = `${UTF8_BOM}${MovieLensPort.HEADER}\r\n${rows.length > 0 ? rows.join('\r\n') + '\r\n' : ''}`;

    return [
      {
        filename: 'ratings.csv',
        content,
      },
    ];
  }
}

export const letterboxdPort = new LetterboxdPort();
export const imdbPort = new ImdbPort();
export const movieLensPort = new MovieLensPort();
