import { HOWVIBE_SYNC_DESCRIPTION, HOWVIBE_SYNC_META_FILE } from './constants.js';
import { createSyncMeta, parseSyncMeta, type SyncMeta } from './schema.js';

type GistFileRef = {
  filename?: string;
  raw_url?: string;
  content?: string;
  truncated?: boolean;
};

type GistResponse = {
  id: string;
  description: string | null;
  public: boolean;
  updated_at?: string;
  files: Record<string, GistFileRef>;
};

type GistListResponse = Array<Pick<GistResponse, 'id' | 'description' | 'public' | 'files'>>;

type GistPatchFiles = Record<string, { content: string } | null>;

export type SyncGist = {
  id: string;
  files: Record<string, GistFileRef>;
};

async function parseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  return `HTTP ${res.status}: ${text.slice(0, 200)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class GistClient {
  constructor(private readonly token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'howvibe-cli',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async listGists(): Promise<GistListResponse> {
    const all: GistListResponse = [];
    let page = 1;
    const maxPages = 10; // Safety limit: 1000 gists max

    while (page <= maxPages) {
      const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Failed to list gists: ${await parseError(res)}`);
      const batch = (await res.json()) as GistListResponse;
      all.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    return all;
  }

  async getGist(gistId: string): Promise<SyncGist> {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Failed to get gist ${gistId}: ${await parseError(res)}`);
    const body = (await res.json()) as GistResponse;
    return { id: body.id, files: body.files ?? {} };
  }

  async createGist(files: GistPatchFiles, description = HOWVIBE_SYNC_DESCRIPTION): Promise<SyncGist> {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        public: false,
        files,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Failed to create gist: ${await parseError(res)}`);
    const body = (await res.json()) as GistResponse;
    return { id: body.id, files: body.files ?? {} };
  }

  async patchGist(gistId: string, files: GistPatchFiles): Promise<SyncGist> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const body = (await res.json()) as GistResponse;
        return { id: body.id, files: body.files ?? {} };
      }

      if (res.status === 409 && attempt < maxAttempts) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }

      throw new Error(`Failed to patch gist ${gistId}: ${await parseError(res)}`);
    }

    throw new Error(`Failed to patch gist ${gistId}: exhausted retry attempts`);
  }

  async downloadRawFile(rawUrl: string): Promise<string> {
    // Validate URL domain to prevent token exfiltration via malicious raw_url
    const ALLOWED_PREFIXES = [
      'https://gist.githubusercontent.com/',
      'https://api.github.com/',
    ];
    if (!ALLOWED_PREFIXES.some((prefix) => rawUrl.startsWith(prefix))) {
      throw new Error(`Refusing to send auth header to untrusted URL: ${rawUrl}`);
    }

    const res = await fetch(rawUrl, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Failed to download gist raw file: ${await parseError(res)}`);
    return await res.text();
  }
}

function hasSyncMetaFile(gist: { files: Record<string, GistFileRef> }): boolean {
  return Boolean(gist.files[HOWVIBE_SYNC_META_FILE]);
}

export async function findExistingSyncGist(client: GistClient): Promise<SyncGist | null> {
  const gists = await client.listGists();
  for (const gist of gists) {
    if (!hasSyncMetaFile(gist) || gist.public) continue;
    try {
      const full = await client.getGist(gist.id);
      const meta = full.files[HOWVIBE_SYNC_META_FILE];
      if (!meta?.content && !meta?.raw_url) continue;
      const metaRaw = meta.content ?? (await client.downloadRawFile(meta.raw_url!));
      parseSyncMeta(JSON.parse(metaRaw));
      return full;
    } catch {
      // Continue scanning other gists.
    }
  }
  return null;
}

export async function findOrCreateSyncGist(client: GistClient): Promise<{ gist: SyncGist; meta: SyncMeta }> {
  const existing = await findExistingSyncGist(client);
  if (existing) {
    try {
      const metaFile = existing.files[HOWVIBE_SYNC_META_FILE];
      const raw = metaFile?.content ?? (metaFile?.raw_url ? await client.downloadRawFile(metaFile.raw_url) : null);
      if (raw) {
        return {
          gist: existing,
          meta: parseSyncMeta(JSON.parse(raw)),
        };
      }
    } catch {
      // Fall through and rewrite meta.
    }
    const meta = createSyncMeta();
    const patched = await client.patchGist(existing.id, {
      [HOWVIBE_SYNC_META_FILE]: { content: JSON.stringify(meta, null, 2) },
    });
    return { gist: patched, meta };
  }

  const meta = createSyncMeta();
  const created = await client.createGist({
    [HOWVIBE_SYNC_META_FILE]: { content: JSON.stringify(meta, null, 2) },
  });
  return { gist: created, meta };
}
