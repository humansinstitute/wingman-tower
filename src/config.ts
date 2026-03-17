export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  directHttpsUrl: (process.env.SUPERBASED_DIRECT_HTTPS_URL || 'https://sb4.otherstuff.studio').trim(),
  adminNpub: (
    process.env.ADMIN_NPUB
    || 'npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy'
  ).trim(),
  storage: {
    s3Endpoint: (process.env.STORAGE_S3_ENDPOINT || 'http://127.0.0.1:9000').trim(),
    s3PublicEndpoint: (process.env.STORAGE_S3_ENDPOINT_PUBLIC || 'https://storage.otherstuff.studio').trim(),
    s3Region: (process.env.STORAGE_S3_REGION || 'us-east-1').trim(),
    s3AccessKey: (process.env.STORAGE_S3_ACCESS_KEY || 'superbased').trim(),
    s3SecretKey: (process.env.STORAGE_S3_SECRET_KEY || 'superbased-secret').trim(),
    s3Bucket: (process.env.STORAGE_S3_BUCKET || 'superbased-storage').trim(),
    s3ForcePathStyle: !/^(false|0|no)$/i.test((process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true').trim()),
    presignUploadTtlSeconds: parseInt(process.env.STORAGE_PRESIGN_UPLOAD_TTL_SECONDS || '900', 10),
    presignDownloadTtlSeconds: parseInt(process.env.STORAGE_PRESIGN_DOWNLOAD_TTL_SECONDS || '900', 10),
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'coworker_v4',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  },
  service: {
    nsec: process.env.SUPERBASED_SERVICE_NSEC || '',
    pubkeyHex: process.env.SUPERBASED_SERVICE_PUBKEY_HEX || '',
    npub: process.env.SUPERBASED_SERVICE_NPUB || '',
  },
};
