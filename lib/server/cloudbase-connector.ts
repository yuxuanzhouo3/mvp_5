import "server-only";

export interface CloudBaseConnectorConfig {
  envId?: string;
  secretId?: string;
  secretKey?: string;
}

let cachedClient: any = null;
let cachedDb: any = null;
let initPromise: Promise<void> | null = null;

function resolveCloudBaseConfig(config?: CloudBaseConnectorConfig) {
  const envId =
    config?.envId?.trim() ||
    process.env.WECHAT_CLOUDBASE_ID?.trim() ||
    process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID?.trim() ||
    process.env.CLOUDBASE_ENV_ID?.trim() ||
    "";
  const secretId =
    config?.secretId?.trim() ||
    process.env.CLOUDBASE_SECRET_ID?.trim() ||
    "";
  const secretKey =
    config?.secretKey?.trim() ||
    process.env.CLOUDBASE_SECRET_KEY?.trim() ||
    "";

  if (!envId || !secretId || !secretKey) {
    throw new Error(
      "CloudBase 配置缺失：需要 WECHAT_CLOUDBASE_ID/CLOUDBASE_SECRET_ID/CLOUDBASE_SECRET_KEY。",
    );
  }

  return { envId, secretId, secretKey };
}

export async function getCloudBaseAdminDb(config?: CloudBaseConnectorConfig) {
  if (cachedDb) {
    return cachedDb;
  }

  if (initPromise) {
    await initPromise;
    return cachedDb;
  }

  initPromise = (async () => {
    // 动态加载，避免进入不需要 CloudBase 的打包路径
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cloudbase = require("@cloudbase/node-sdk");
    const { envId, secretId, secretKey } = resolveCloudBaseConfig(config);

    const client = cloudbase.init({
      env: envId,
      secretId,
      secretKey,
    });

    cachedClient = client;
    cachedDb = client.database();
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }

  return cachedDb;
}

export async function getCloudBaseAdminApp(config?: CloudBaseConnectorConfig) {
  await getCloudBaseAdminDb(config);
  return cachedClient;
}
