export class KPClient {
  private apiKey: string;
  private lastRequestTime = 0;
  private minIntervalMs = 500; // 2 req/sec to stay within KP API limits

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  public async getFilmDetails(filmId: string | number): Promise<{ nameRu?: string; nameOriginal?: string; year?: number; imdbId?: string } | null> {
    await this.rateLimitWait();
    try {
      const response = await fetch(`https://kinopoiskapiunofficial.tech/api/v2.2/films/${filmId}`, {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        nameRu: data.nameRu,
        nameOriginal: data.nameOriginal,
        year: data.year,
        imdbId: data.imdbId,
      };
    } catch {
      return null;
    }
  }

  public async pingKey(): Promise<boolean> {
    await this.rateLimitWait();
    try {
      // Query a well-known movie (301 = The Matrix) to test API key validity
      const response = await fetch('https://kinopoiskapiunofficial.tech/api/v2.2/films/301', {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
