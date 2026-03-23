/**
 * CloudBase 数据库连接器
 * 仅国内版使用（DEFAULT_LANGUAGE=zh）
 */

export interface CloudBaseConnectorConfig {
  envId?: string;
  secretId?: string;
  secretKey?: string;
}

let cachedClient: any = null;
let cachedDb: any = null;
let initPromise: Promise<void> | null = null;

export class CloudBaseConnector {
  private client: any = null;
  private initialized = false;

  constructor(private config: CloudBaseConnectorConfig = {}) {}

  async initialize(): Promise<void> {
    if (cachedClient && cachedDb) {
      this.client = cachedClient;
      this.initialized = true;
      return;
    }
    if (initPromise) {
      await initPromise;
      this.client = cachedClient;
      this.initialized = true;
      return;
    }

    // 动态加载，避免打包到 edge runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cloudbase = require("@cloudbase/node-sdk");

    const env = this.config.envId || process.env.WECHAT_CLOUDBASE_ID;
    const secretId = this.config.secretId || process.env.CLOUDBASE_SECRET_ID;
    const secretKey = this.config.secretKey || process.env.CLOUDBASE_SECRET_KEY;

    if (!env || !secretId || !secretKey) {
      throw new Error(
        "Missing CloudBase env vars: WECHAT_CLOUDBASE_ID, CLOUDBASE_SECRET_ID, CLOUDBASE_SECRET_KEY"
      );
    }

    initPromise = (async () => {
      const client = cloudbase.init({
        env,
        secretId,
        secretKey,
      });
      cachedClient = client;
      cachedDb = client.database();
    })();

    await initPromise;

    this.client = cachedClient;
    this.initialized = true;
  }

  getClient(): any {
    if (!this.client || !this.initialized) {
      throw new Error("CloudBase client not initialized");
    }
    return cachedDb || this.client.database();
  }

  getApp(): any {
    if (!this.client || !this.initialized) {
      throw new Error("CloudBase client not initialized");
    }
    return cachedClient || this.client;
  }
}
