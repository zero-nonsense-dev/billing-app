import fs   from 'node:fs';
import path from 'node:path';

export interface LicenseRecord {
  plan:            string;
  accountId:       number;
  accountType:     string;          // 'User' | 'Organization'
  accountLogin:    string;
  onFreeTrial:     boolean;
  freeTrialEndsOn: string | null;
  unitCount:       number | null;   // for per-seat plans
  effectiveDate:   string | null;   // when a pending change / cancellation activates
  pendingCancel:   boolean;
  updatedAt:       string;
}

/**
 * Minimal async store interface – swap JsonFileStore for any durable backend
 * without touching the rest of the application.
 *
 * Azure Table Storage (production recommendation):
 *   npm install @azure/data-tables
 *   PartitionKey = accountType, RowKey = String(accountId)
 *   class AzureTableStore implements ILicenseStore { … }
 *
 * Postgres / Neon / Supabase:
 *   npm install postgres   (or pg / drizzle-orm)
 *   CREATE TABLE licenses (
 *     key        TEXT PRIMARY KEY,
 *     data       JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */
export interface ILicenseStore {
  get(key: string): Promise<LicenseRecord | undefined>;
  set(key: string, record: LicenseRecord): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<Record<string, LicenseRecord>>;
}

type StoreData = Record<string, LicenseRecord>;

/**
 * JSON-file store – adequate for development and single-instance deployments.
 *
 * Writes are atomic (write-to-temp-file + rename) to guard against data
 * corruption if the process is killed mid-write.
 *
 * Limitations:
 *   - Not safe for horizontal scaling (multiple instances share no state)
 *   - File lives on ephemeral disk on most managed platforms – use a mounted
 *     volume or replace with a networked store before going to production.
 */
export class JsonFileStore implements ILicenseStore {
  private readonly dbPath: string;
  private cache: StoreData;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.cache  = this.load();
  }

  private load(): StoreData {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) as StoreData;
    } catch {
      return {};
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    // Atomic write: write to a temp file first, then rename
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
    fs.renameSync(tmp, this.dbPath);
  }

  async get(key: string): Promise<LicenseRecord | undefined> {
    return this.cache[key];
  }

  async set(key: string, record: LicenseRecord): Promise<void> {
    this.cache[key] = record;
    this.persist();
  }

  async delete(key: string): Promise<void> {
    delete this.cache[key];
    this.persist();
  }

  async all(): Promise<Record<string, LicenseRecord>> {
    return { ...this.cache };
  }
}
